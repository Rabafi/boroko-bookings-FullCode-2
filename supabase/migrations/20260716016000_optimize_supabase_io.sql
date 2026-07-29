-- Reduce request, CPU, egress, and write amplification without weakening
-- lodge isolation, PWA entitlement checks, or authoritative financial paths.

begin;

-- Kitchen queries normally constrain lodge + station + active status together.
create index if not exists idx_pos_prep_tickets_lodge_station_status
  on public.pos_prep_tickets (lodge_id, station, status, created_at desc);
create index if not exists idx_pos_prep_tickets_lodge_created
  on public.pos_prep_tickets (lodge_id, created_at desc);

-- Entitlement is read-only and statement-stable. Only select the narrow settings
-- fields it consumes so branding images stored on settings are not detoasted for
-- every access check.
create or replace function public.get_lodge_entitlement(p_lodge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_settings_lodge_name text;
  v_settings_company_name text;
  v_trial_started_at timestamptz;
  v_license public.licenses%rowtype;
  v_overrides jsonb := '{}'::jsonb;
  v_trial_end timestamptz;
  v_days_left int;
  v_expired boolean;
  v_plan text;
  v_payment_status text;
  v_subscription_state text;
  v_access_allowed boolean;
  v_grace_days integer;
  v_lease_days integer;
  v_grace_ends_at timestamptz;
  v_offline_valid_until timestamptz;
begin
  select s.lodge_name, s.company_name, s.trial_started_at
    into v_settings_lodge_name, v_settings_company_name, v_trial_started_at
    from public.settings s
   where s.lodge_id = p_lodge_id
     and coalesce(s.deleted, false) = false
   order by s.updated_at desc nulls last, s.created_at desc nulls last
   limit 1;

  select coalesce(jsonb_object_agg(lf.feature_name, lf.enabled), '{}'::jsonb)
    into v_overrides
    from public.lodge_features lf
   where lf.lodge_id = p_lodge_id
     and (lf.expires_at is null or lf.expires_at > now());

  select *
    into v_license
    from public.licenses l
   where l.lodge_id = p_lodge_id
     and coalesce(l.is_active, true) = true
   order by
     case public._subscription_state(l.payment_status, l.next_due_date, l.expires_at, l.is_active, l.grace_period_days)
       when 'active' then 0
       when 'grace_period' then 1
       when 'suspended' then 2
       when 'expired' then 3
       when 'cancelled' then 4
       else 5
     end,
     l.expires_at desc nulls last,
     l.issued_at desc nulls last
   limit 1;

  if v_license.id is not null then
    v_plan := public._normalize_subscription_plan(v_license.subscription_plan);
    v_payment_status := lower(coalesce(v_license.payment_status, 'active'));
    v_grace_days := greatest(coalesce(v_license.grace_period_days, 7), 0);
    v_lease_days := greatest(least(coalesce(v_license.offline_lease_days, 7), 30), 1);
    v_subscription_state := public._subscription_state(v_payment_status, v_license.next_due_date, v_license.expires_at, v_license.is_active, v_grace_days);
    v_access_allowed := public._subscription_access_allowed(v_subscription_state);
    v_grace_ends_at := case when v_license.next_due_date is null then null else (v_license.next_due_date + v_grace_days)::timestamptz + interval '1 day' end;
    v_offline_valid_until := public._offline_valid_until(v_subscription_state, v_license.expires_at, v_license.next_due_date, v_grace_days, v_lease_days);

    return jsonb_build_object(
      'lodge_id', p_lodge_id,
      'status', case when v_access_allowed then 'licensed' else 'expired' end,
      'daysLeft', null,
      'expired', not v_access_allowed,
      'plan', v_plan,
      'product_id', v_license.product_id,
      'commercial_package_key', v_license.commercial_package_key,
      'commercial_catalog_version', v_license.commercial_catalog_version,
      'commercial_pricing_snapshot', v_license.commercial_pricing_snapshot,
      'plan_version_code', coalesce(v_license.plan_version_code, '2026.04'),
      'payment_status', v_payment_status,
      'subscription_state', v_subscription_state,
      'monthly_fee', coalesce(v_license.monthly_fee, 0),
      'currency', v_license.currency,
      'next_due_date', v_license.next_due_date,
      'expires_at', v_license.expires_at,
      'grace_period_days', v_grace_days,
      'grace_period_ends_at', v_grace_ends_at,
      'offline_lease_days', v_lease_days,
      'offline_valid_until', v_offline_valid_until,
      'source_license_id', v_license.id,
      'lodge_name', coalesce(v_license.lodge_name, v_settings_lodge_name, v_settings_company_name),
      'effective_features', case
        when v_access_allowed then public._license_plan_features(v_plan, false, false) || coalesce(v_overrides, '{}'::jsonb)
        else public._license_plan_features(v_plan, false, true)
      end
    );
  end if;

  v_trial_end := coalesce(v_trial_started_at, now()) + interval '30 days';
  if v_trial_started_at is null then
    v_days_left := 30;
    v_expired := false;
  else
    v_days_left := greatest(0, ceil(extract(epoch from (v_trial_end - now())) / 86400.0))::int;
    v_expired := v_days_left <= 0;
  end if;

  return jsonb_build_object(
    'lodge_id', p_lodge_id,
    'status', case when v_expired then 'expired' else 'trial' end,
    'daysLeft', v_days_left,
    'expired', v_expired,
    'plan', case when v_expired then null else 'Trial' end,
    'product_id', null,
    'commercial_package_key', null,
    'commercial_catalog_version', null,
    'commercial_pricing_snapshot', null,
    'plan_version_code', 'trial',
    'payment_status', case when v_expired then 'expired' else 'trial' end,
    'monthly_fee', 0,
    'currency', null,
    'next_due_date', null,
    'expires_at', case when v_expired then v_trial_end else null end,
    'grace_period_days', 0,
    'grace_period_ends_at', null,
    'offline_lease_days', 30,
    'offline_valid_until', least(v_trial_end, now() + interval '30 days'),
    'source_license_id', null,
    'lodge_name', coalesce(v_settings_lodge_name, v_settings_company_name),
    'effective_features', public._license_plan_features('Pro', true, v_expired)
  );
end;
$function$;

-- Validate a custom session once. Entitlement remains mandatory for PWA
-- sessions, but desktop sessions do not load commercial settings on every read.
create or replace function public.app_current_session_row(p_token text default null::text)
returns public.app_sessions
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_token text := public.app_request_session_token(p_token);
  v_session public.app_sessions;
  v_user_role text;
  v_pwa_enabled boolean;
  v_entitlement jsonb;
begin
  if v_token is null then
    return null;
  end if;

  select s.*
    into v_session
    from public.app_sessions s
   where s.token_hash = public.app_hash_token(v_token)
     and s.revoked_at is null
     and s.expires_at > now()
   limit 1;

  if v_session.id is null then
    return null;
  end if;

  select u.role, coalesce(u.pwa_enabled, false)
    into v_user_role, v_pwa_enabled
    from public.users u
   where u.id = v_session.user_id
     and u.lodge_id = v_session.lodge_id
   limit 1;

  if not found then
    return null;
  end if;

  if v_session.session_type = 'pwa' then
    if not public._is_pwa_role_eligible(v_user_role) or not v_pwa_enabled then
      return null;
    end if;
    v_entitlement := public.get_lodge_entitlement(v_session.lodge_id);
    if not coalesce((v_entitlement->'effective_features'->>'pwa')::boolean, false) then
      return null;
    end if;
  end if;

  return v_session;
end;
$function$;

-- PostgREST invokes this pre-request hook once. Store validated identity in
-- transaction-local GUCs so row policies do not repeat session table work.
create or replace function public.handle_pgrst_request()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
  v_session public.app_sessions;
begin
  perform set_config('app.session_token', '', true);
  perform set_config('app.actor_id', '', true);
  perform set_config('app.lodge_id', '', true);
  perform set_config('app.session_role', '', true);
  perform set_config('app.session_type', '', true);
  perform set_config('app.session_valid', 'false', true);

  v_token := coalesce(
    nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session', '')), ''),
    nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session-token', '')), ''),
    nullif(btrim(coalesce(public.app_request_headers()->>'x_boroko_session', '')), ''),
    ''
  );
  perform set_config('app.session_token', v_token, true);

  if v_token = '' then
    return;
  end if;

  v_session := public.app_current_session_row(v_token);
  if v_session.id is null then
    return;
  end if;

  perform set_config('app.actor_id', v_session.user_id::text, true);
  perform set_config('app.lodge_id', v_session.lodge_id::text, true);
  perform set_config('app.session_role', coalesce(v_session.role, ''), true);
  perform set_config('app.session_type', coalesce(v_session.session_type, ''), true);
  perform set_config('app.session_valid', 'true', true);
end;
$function$;

create or replace function public.app_current_lodge_id(p_token text default null::text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cached text;
begin
  if p_token is null and current_setting('app.session_valid', true) = 'true' then
    v_cached := nullif(current_setting('app.lodge_id', true), '');
    if v_cached is not null then return v_cached::uuid; end if;
  end if;
  return (public.app_current_session_row(p_token)).lodge_id;
end;
$function$;

create or replace function public.app_current_user_id(p_token text default null::text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cached text;
begin
  if p_token is null and current_setting('app.session_valid', true) = 'true' then
    v_cached := nullif(current_setting('app.actor_id', true), '');
    if v_cached is not null then return v_cached::uuid; end if;
  end if;
  return (public.app_current_session_row(p_token)).user_id;
end;
$function$;

create or replace function public.app_current_role(p_token text default null::text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cached text;
begin
  if p_token is null and current_setting('app.session_valid', true) = 'true' then
    v_cached := nullif(current_setting('app.session_role', true), '');
    if v_cached is not null then return v_cached; end if;
  end if;
  return (public.app_current_session_row(p_token)).role;
end;
$function$;

create or replace function public.app_lodge_access(p_lodge_id uuid, p_token text default null::text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cached text;
begin
  if public.app_is_service_role() then return true; end if;
  if p_lodge_id is null then return false; end if;

  if p_token is null and current_setting('app.session_valid', true) = 'true' then
    v_cached := nullif(current_setting('app.lodge_id', true), '');
    return v_cached is not null and v_cached::uuid = p_lodge_id;
  end if;

  return public.app_current_lodge_id(p_token) = p_lodge_id;
end;
$function$;

-- One server round trip replaces separate table, tab, and seating reads.
create or replace function public.get_pos_floor_snapshot(
  p_lodge_id uuid,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tables jsonb;
  v_tabs jsonb;
  v_occupancy jsonb;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  if p_outlet_id is not null and not exists (
    select 1 from public.outlets o
     where o.id = p_outlet_id and o.lodge_id = p_lodge_id
  ) then
    raise exception 'Outlet not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.name), '[]'::jsonb)
    into v_tables
    from public.pos_tables t
   where t.lodge_id = p_lodge_id
     and (p_outlet_id is null or t.outlet_id = p_outlet_id);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at desc), '[]'::jsonb)
    into v_tabs
    from public.pos_tabs t
   where t.lodge_id = p_lodge_id
     and t.status in ('open', 'running', 'ready', 'delivered')
     and (p_outlet_id is null or t.outlet_id = p_outlet_id);

  select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
    into v_occupancy
    from public.get_restaurant_floor_occupancy(p_lodge_id) o
   where p_outlet_id is null
      or exists (
        select 1 from public.pos_tables t
         where t.id = o.table_id
           and t.lodge_id = p_lodge_id
           and t.outlet_id = p_outlet_id
      );

  return jsonb_build_object(
    'tables', v_tables,
    'tabs', v_tabs,
    'occupancy', v_occupancy,
    'as_of', now()
  );
end;
$function$;

revoke all on function public.get_pos_floor_snapshot(uuid, uuid) from public;
grant execute on function public.get_pos_floor_snapshot(uuid, uuid) to anon, authenticated, service_role;

-- Avoid rewriting an unchanged health row more often than the bounded heartbeat.
create or replace function public.upsert_device_health(
  p_lodge_id uuid,
  p_device_id text,
  p_client_type text,
  p_pending_queue_count integer,
  p_failed_queue_count integer,
  p_unresolved_local_count integer,
  p_replay_auth_ready boolean,
  p_last_successful_sync_at timestamptz,
  p_reconciliation_state text,
  p_top_fault_types text[],
  p_raw_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row_count integer := 0;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_device_id, '')), '') is null then
    raise exception 'Device id is required' using errcode = '22023';
  end if;

  insert into public.device_health_reports (
    lodge_id, device_id, client_type, reported_at,
    pending_queue_count, failed_queue_count, unresolved_local_count,
    replay_auth_ready, last_successful_sync_at, reconciliation_state,
    top_fault_types, raw_summary
  ) values (
    p_lodge_id, p_device_id, p_client_type, now(),
    p_pending_queue_count, p_failed_queue_count, p_unresolved_local_count,
    p_replay_auth_ready, p_last_successful_sync_at, p_reconciliation_state,
    coalesce(p_top_fault_types, array[]::text[]), coalesce(p_raw_summary, '{}'::jsonb)
  )
  on conflict (lodge_id, device_id) do update set
    client_type = excluded.client_type,
    reported_at = now(),
    pending_queue_count = excluded.pending_queue_count,
    failed_queue_count = excluded.failed_queue_count,
    unresolved_local_count = excluded.unresolved_local_count,
    replay_auth_ready = excluded.replay_auth_ready,
    last_successful_sync_at = excluded.last_successful_sync_at,
    reconciliation_state = excluded.reconciliation_state,
    top_fault_types = excluded.top_fault_types,
    raw_summary = excluded.raw_summary
  where public.device_health_reports.reported_at < now() - interval '20 minutes'
     or public.device_health_reports.client_type is distinct from excluded.client_type
     or public.device_health_reports.pending_queue_count is distinct from excluded.pending_queue_count
     or public.device_health_reports.failed_queue_count is distinct from excluded.failed_queue_count
     or public.device_health_reports.unresolved_local_count is distinct from excluded.unresolved_local_count
     or public.device_health_reports.replay_auth_ready is distinct from excluded.replay_auth_ready
     or public.device_health_reports.last_successful_sync_at is distinct from excluded.last_successful_sync_at
     or public.device_health_reports.reconciliation_state is distinct from excluded.reconciliation_state
     or public.device_health_reports.top_fault_types is distinct from excluded.top_fault_types
     or public.device_health_reports.raw_summary is distinct from excluded.raw_summary;

  get diagnostics v_row_count = row_count;
  return jsonb_build_object('success', true, 'updated', v_row_count > 0);
exception
  when others then
    return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$function$;

notify pgrst, 'reload schema';

commit;
