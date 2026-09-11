-- Command Central commercial entitlement overrides.
--
-- A package is still the commercial source of truth.  This migration adds a
-- separately auditable, product-scoped exception ledger for a master admin to
-- grant one feature or one numeric allowance for one lodge.  Overrides never
-- change product identity, roles, passwords, sessions, tenancy, audit, ledger,
-- idempotency, or other security/financial invariants.

create table if not exists public.commercial_entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  product_id text not null check (product_id in ('lodge-camp', 'hotel', 'hospitality-pos')),
  feature_key text,
  enabled boolean,
  limit_key text,
  limit_value integer,
  reason text not null check (length(btrim(reason)) >= 8),
  created_by uuid not null,
  created_by_email text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_by_email text,
  revoke_reason text,
  constraint commercial_entitlement_override_one_value check (
    (feature_key is not null and enabled is not null and limit_key is null and limit_value is null)
    or (feature_key is null and enabled is null and limit_key is not null and limit_value is not null and limit_value >= 0)
  ),
  constraint commercial_entitlement_override_feature_key_check check (
    feature_key is null or length(btrim(feature_key)) between 1 and 120
  ),
  constraint commercial_entitlement_override_limit_key_check check (
    limit_key is null or limit_key in ('users', 'rooms', 'monthly_bookings', 'booking_grace', 'monthly_bookings_grace')
  ),
  constraint commercial_entitlement_override_expiry_check check (
    expires_at is null or expires_at > created_at
  ),
  constraint commercial_entitlement_override_revoke_check check (
    (revoked_at is null and revoked_by is null and revoked_by_email is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null and length(btrim(coalesce(revoke_reason, ''))) >= 8)
  )
);

create index if not exists commercial_entitlement_overrides_lookup_idx
  on public.commercial_entitlement_overrides (lodge_id, product_id, created_at desc);
create index if not exists commercial_entitlement_overrides_feature_idx
  on public.commercial_entitlement_overrides (lodge_id, product_id, feature_key, created_at desc)
  where feature_key is not null;
create index if not exists commercial_entitlement_overrides_limit_idx
  on public.commercial_entitlement_overrides (lodge_id, product_id, limit_key, created_at desc)
  where limit_key is not null;

alter table public.commercial_entitlement_overrides enable row level security;
revoke all on public.commercial_entitlement_overrides from public, anon, authenticated;
grant select on public.commercial_entitlement_overrides to service_role;

-- The product identity is deliberately explicit.  A null/unknown product can
-- never be used to grant a feature across Lodge, Hotel, and POS surfaces.
create or replace function public._commercial_valid_product(p_product_id text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_product_id, ''))) in ('lodge-camp', 'hotel', 'hospitality-pos');
$$;

create or replace function public._commercial_non_overridable_feature(p_feature_key text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_feature_key, ''))) in (
    'tenant', 'tenancy', 'tenant_isolation', 'authorization', 'permissions',
    'roles', 'password', 'passwords', 'session', 'sessions', 'auth',
    'authentication', 'security', 'audit', 'audit_log', 'idempotency',
    'ledger', 'financial_truth', 'financial_ledger', 'payment_status',
    'payment_integrity', 'product_id', 'cross_product', 'service_role'
  )
  or lower(btrim(coalesce(p_feature_key, ''))) like '%security%'
  or lower(btrim(coalesce(p_feature_key, ''))) like '%tenant%'
  or lower(btrim(coalesce(p_feature_key, ''))) like '%ledger%'
  or lower(btrim(coalesce(p_feature_key, ''))) like '%idempot%';
$$;

-- A feature exception is only meaningful inside the product catalogue that
-- owns the feature.  Package and add-on included_features are the authoritative
-- allowlist; this prevents a lodge override from manufacturing Hotel/POS
-- capabilities such as hotel_mode, kitchen, or multi_outlet_controls.
create or replace function public._commercial_feature_allowed(
  p_product_id text,
  p_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  with requested as (
    select lower(btrim(coalesce(p_product_id, ''))) as product_id,
           lower(btrim(coalesce(p_feature_key, ''))) as feature_key
  )
  select r.product_id in ('lodge-camp', 'hotel', 'hospitality-pos')
     and r.feature_key <> ''
     and (
       exists (
         select 1
           from requested
           join public.commercial_catalog_versions cv on cv.is_active = true
           join public.commercial_package_prices package_price
             on package_price.catalog_version_id = cv.id
            and package_price.product_id = r.product_id
          cross join lateral jsonb_array_elements_text(
            case when jsonb_typeof(package_price.included_features) = 'array'
                 then package_price.included_features else '[]'::jsonb end
          ) feature(feature_key)
          where lower(btrim(feature.feature_key)) = r.feature_key
       )
       or exists (
         select 1
           from requested
           join public.commercial_catalog_versions cv on cv.is_active = true
           join public.commercial_addon_prices addon
             on addon.catalog_version_id = cv.id
            and addon.product_id = r.product_id
            and addon.active = true
          cross join lateral jsonb_array_elements_text(
            case when jsonb_typeof(addon.included_features) = 'array'
                 then addon.included_features else '[]'::jsonb end
          ) feature(feature_key)
          where lower(btrim(feature.feature_key)) = r.feature_key
       )
       -- LodgingOS still has a legacy Starter/Standard/Pro feature ladder.
       -- Admit keys in its highest in-product plan so aliases such as `pool`
       -- remain overrideable without admitting Hotel Enterprise capabilities.
       or (
         r.product_id = 'lodge-camp'
         and coalesce((public._license_plan_features('Pro', false, false)->>r.feature_key)::boolean, false)
       )
     )
   from requested r;
$$;

revoke all on function public._commercial_feature_allowed(text, text)
  from public, anon, authenticated;
grant execute on function public._commercial_feature_allowed(text, text)
  to service_role;

-- Command Central is normally entered after a fresh local master-admin
-- reauthentication.  Require the actor to be an active master admin and a
-- recent proof timestamp at the database boundary too; a service-role key by
-- itself is not sufficient to manufacture an override audit trail.
create or replace function public._command_central_require_fresh_master_admin(
  p_actor_id uuid,
  p_actor_email text,
  p_fresh_auth_at timestamptz
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.app_is_service_role() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_actor_id is null or nullif(btrim(coalesce(p_actor_email, '')), '') is null then
    raise exception 'A fresh Command Central master-admin identity is required' using errcode = '42501';
  end if;
  if p_fresh_auth_at is null
     or p_fresh_auth_at < now() - interval '15 minutes'
     or p_fresh_auth_at > now() + interval '60 seconds' then
    raise exception 'Command Central reauthentication is missing or too old. Sign in again before changing commercial entitlements' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.master_admins admin
     where admin.id = p_actor_id
       and lower(btrim(admin.email)) = lower(btrim(p_actor_email))
       and coalesce(admin.is_active, true) = true
  ) then
    raise exception 'The override actor is not an active Command Central master administrator' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public._command_central_require_fresh_master_admin(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public._command_central_require_fresh_master_admin(uuid, text, timestamptz)
  to service_role;

-- Numeric package allowances are deliberately centralized here.  Other app
-- families do not inherit Lodge limits merely because their internal plan is
-- Enterprise/Pro-compatible; null means that a limit is not applicable.
create or replace function public._commercial_base_limits(
  p_product_id text,
  p_plan text
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_product text := lower(btrim(coalesce(p_product_id, '')));
  v_plan text := lower(btrim(coalesce(p_plan, 'starter')));
begin
  if v_product <> 'lodge-camp' then
    return jsonb_build_object(
      'users', null::integer,
      'rooms', null::integer,
      'monthly_bookings', null::integer,
      'booking_grace', null::integer,
      'monthly_bookings_grace', null::integer
    );
  end if;
  if v_plan in ('enterprise', 'hotel', 'resort') then
    return jsonb_build_object(
      'users', 25,
      'rooms', 100,
      'monthly_bookings', 2000,
      'booking_grace', 50,
      'monthly_bookings_grace', 50
    );
  elsif v_plan in ('pro', 'premium') then
    return jsonb_build_object('users', 10, 'rooms', 30, 'monthly_bookings', 600, 'booking_grace', 10, 'monthly_bookings_grace', 10);
  elsif v_plan = 'standard' then
    return jsonb_build_object('users', 5, 'rooms', 20, 'monthly_bookings', 400, 'booking_grace', 5, 'monthly_bookings_grace', 5);
  end if;
  return jsonb_build_object('users', 2, 'rooms', 6, 'monthly_bookings', 120, 'booking_grace', 2, 'monthly_bookings_grace', 2);
end;
$$;

-- Return the current winner for each override key.  Older rows remain in the
-- ledger for history; a later active row supersedes it without deleting it.
create or replace function public._commercial_active_override_snapshot(
  p_lodge_id uuid,
  p_product_id text
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with active_rows as (
    select o.*
      from public.commercial_entitlement_overrides o
     where o.lodge_id = p_lodge_id
       and o.product_id = lower(btrim(coalesce(p_product_id, '')))
       and o.revoked_at is null
       and (o.expires_at is null or o.expires_at > now())
  ),
  feature_rows as (
    select distinct on (feature_key) feature_key, enabled
      from active_rows
     where feature_key is not null
     order by feature_key, created_at desc, id desc
  ),
  limit_rows as (
    select distinct on (limit_key) limit_key, limit_value
      from active_rows
     where limit_key is not null
     order by limit_key, created_at desc, id desc
  )
  select jsonb_build_object(
    'features', coalesce((select jsonb_object_agg(feature_key, enabled) from feature_rows), '{}'::jsonb),
    'limits', coalesce((
      select case when limits ? 'booking_grace'
                  then limits || jsonb_build_object('monthly_bookings_grace', limits->'booking_grace')
                  when limits ? 'monthly_bookings_grace'
                  then limits || jsonb_build_object('booking_grace', limits->'monthly_bookings_grace')
                  else limits end
        from (select coalesce(jsonb_object_agg(limit_key, limit_value), '{}'::jsonb) as limits from limit_rows) normalized
    ), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(active_rows) order by created_at desc, id desc) from active_rows), '[]'::jsonb)
  );
$$;

create or replace function public._commercial_target_limits(
  p_lodge_id uuid,
  p_product_id text,
  p_plan text
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select public._commercial_base_limits(p_product_id, p_plan)
      || coalesce(public._commercial_active_override_snapshot(p_lodge_id, p_product_id)->'limits', '{}'::jsonb);
$$;

create or replace function public._commercial_target_feature_map(
  p_lodge_id uuid,
  p_product_id text,
  p_plan text,
  p_catalog_version_id uuid,
  p_package_key text,
  p_trial boolean default false,
  p_expired boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when lower(btrim(coalesce(p_product_id, ''))) = 'lodge-camp'
              then public._license_plan_features(p_plan, p_trial, p_expired)
              else '{}'::jsonb end
      || coalesce((
        select jsonb_object_agg(feature.feature_key, true)
          from public.commercial_package_prices package_price
         cross join lateral jsonb_array_elements_text(
           case when jsonb_typeof(package_price.included_features) = 'array'
                then package_price.included_features else '[]'::jsonb end
         ) feature(feature_key)
         where package_price.catalog_version_id = p_catalog_version_id
           and package_price.product_id = p_product_id
           and package_price.commercial_package_key = p_package_key
      ), '{}'::jsonb)
      || coalesce((
        select jsonb_object_agg(e.feature_key, e.enabled)
          from public.commercial_package_entitlements e
         where e.catalog_version_id = p_catalog_version_id
           and e.product_id = p_product_id
           and e.commercial_package_key = p_package_key
      ), '{}'::jsonb)
      || coalesce(public._commercial_active_override_snapshot(p_lodge_id, p_product_id)->'features', '{}'::jsonb);
$$;

-- Product-aware entitlement is additive and backward compatible.  Existing
-- one-argument callers continue to receive the historical primary licence;
-- new callers can request the exact product and therefore cannot leak a PWA or
-- feature grant from one product into another.
create or replace function public.get_lodge_entitlement(
  p_lodge_id uuid,
  p_product_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_settings public.settings%rowtype;
  v_license public.licenses%rowtype;
  v_overrides jsonb := '{}'::jsonb;
  v_override_snapshot jsonb := '{}'::jsonb;
  v_trial_end timestamptz;
  v_days_left integer;
  v_expired boolean;
  v_plan text;
  v_payment_status text;
  v_subscription_state text;
  v_access_allowed boolean;
  v_grace_days integer;
  v_lease_days integer;
  v_grace_ends_at timestamptz;
  v_offline_valid_until timestamptz;
  v_product text := nullif(lower(btrim(coalesce(p_product_id, ''))), '');
  v_effective_features jsonb;
  v_package_features jsonb := '{}'::jsonb;
  v_catalog_version_id uuid;
  v_effective_limits jsonb;
  v_base_limits jsonb;
begin
  if v_product is not null and not public._commercial_valid_product(v_product) then
    return jsonb_build_object('success', false, 'error', 'Unknown commercial product');
  end if;

  select * into v_settings
    from public.settings s
   where s.lodge_id = p_lodge_id
     and coalesce(s.deleted, false) = false
   order by s.updated_at desc nulls last, s.created_at desc nulls last
   limit 1;

  select * into v_license
    from public.licenses l
   where l.lodge_id = p_lodge_id
     and coalesce(l.is_active, true) = true
     and (
       v_product is null
       or coalesce(nullif(lower(btrim(l.product_id)), ''), 'lodge-camp') = v_product
     )
   order by
     case public._subscription_state(l.payment_status, l.next_due_date, l.expires_at, l.is_active, l.grace_period_days)
       when 'active' then 0 when 'grace_period' then 1 when 'suspended' then 2
       when 'expired' then 3 when 'cancelled' then 4 else 5
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
    v_product := coalesce(nullif(lower(btrim(v_license.product_id)), ''), 'lodge-camp');
    -- lodge_features predates product-aware licensing.  Keep it only for the
    -- Lodge/Camp compatibility path; Hotel and POS must use their own package
    -- catalogue map so a Lodge feature row cannot cross product boundaries.
    if v_product = 'lodge-camp' then
      select coalesce(jsonb_object_agg(lf.feature_name, lf.enabled), '{}'::jsonb)
        into v_overrides
        from public.lodge_features lf
       where lf.lodge_id = p_lodge_id
         and (lf.expires_at is null or lf.expires_at > now());
    end if;
    select cv.id into v_catalog_version_id
      from public.commercial_catalog_versions cv
     where (v_license.commercial_catalog_version is not null and cv.version = v_license.commercial_catalog_version)
        or (v_license.commercial_catalog_version is null and cv.is_active = true)
     order by cv.is_active desc, cv.effective_at desc, cv.created_at desc
     limit 1;
    select coalesce((
             select jsonb_object_agg(feature.feature_key, true)
               from public.commercial_package_prices package_price
              cross join lateral jsonb_array_elements_text(
                case when jsonb_typeof(package_price.included_features) = 'array'
                     then package_price.included_features else '[]'::jsonb end
              ) feature(feature_key)
              where package_price.catalog_version_id = v_catalog_version_id
                and package_price.product_id = v_product
                and package_price.commercial_package_key = v_license.commercial_package_key
           ), '{}'::jsonb)
           || coalesce((
             select jsonb_object_agg(e.feature_key, e.enabled)
               from public.commercial_package_entitlements e
              where e.catalog_version_id = v_catalog_version_id
                and e.product_id = v_product
                and e.commercial_package_key = v_license.commercial_package_key
           ), '{}'::jsonb)
      into v_package_features;
    v_override_snapshot := public._commercial_active_override_snapshot(p_lodge_id, v_product);
    v_base_limits := public._commercial_base_limits(v_product, v_plan);
    v_effective_limits := case when v_access_allowed then v_base_limits || coalesce(v_override_snapshot->'limits', '{}'::jsonb) else '{}'::jsonb end;
    v_effective_features := case
      when v_access_allowed then
        -- Lodge retains the historical plan baseline.  Hotel may use the
        -- Enterprise baseline only when an older licence has no package map;
        -- POS has no plan-limit fallback and must remain package-scoped.
        case when v_product = 'lodge-camp'
                   or (v_product = 'hotel' and v_package_features = '{}'::jsonb)
             then public._license_plan_features(v_plan, false, false)
             else '{}'::jsonb end
        || coalesce(v_package_features, '{}'::jsonb)
        || coalesce(v_overrides, '{}'::jsonb)
        || coalesce(v_override_snapshot->'features', '{}'::jsonb)
      else public._license_plan_features(v_plan, false, true)
    end;

    return jsonb_build_object(
      'lodge_id', p_lodge_id,
      'status', case when v_access_allowed then 'licensed' else 'expired' end,
      'daysLeft', null,
      'expired', not v_access_allowed,
      'plan', v_plan,
      'product_id', v_product,
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
      'lodge_name', coalesce(v_license.lodge_name, v_settings.lodge_name, v_settings.company_name),
      'base_limits', v_base_limits,
      'effective_limits', v_effective_limits,
      'commercial_overrides', v_override_snapshot,
      'effective_features', v_effective_features
    );
  end if;

  v_trial_end := coalesce(v_settings.trial_started_at, now()) + interval '30 days';
  if v_settings.trial_started_at is null then
    v_days_left := 30;
    v_expired := false;
  else
    v_days_left := greatest(0, ceil(extract(epoch from (v_trial_end - now())) / 86400.0))::integer;
    v_expired := v_days_left <= 0;
  end if;
  return jsonb_build_object(
    'lodge_id', p_lodge_id,
    'status', case when v_expired then 'expired' else 'trial' end,
    'daysLeft', v_days_left,
    'expired', v_expired,
    'plan', case when v_expired then null else 'Trial' end,
    'product_id', v_product,
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
    'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name),
    'base_limits', '{}'::jsonb,
    'effective_limits', '{}'::jsonb,
    'commercial_overrides', case when v_product is null then '{}'::jsonb else public._commercial_active_override_snapshot(p_lodge_id, v_product) end,
    'effective_features', public._license_plan_features('Pro', true, v_expired)
  );
end;
$$;

create or replace function public.get_lodge_entitlement(p_lodge_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  -- Existing one-argument callers are still product-aware: infer the lodge's
  -- product family from its authoritative operating profile rather than
  -- accidentally selecting a different active product's licence.
  select public.get_lodge_entitlement(
    p_lodge_id,
    (
      select public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge'))
        from public.settings s
       where s.lodge_id = p_lodge_id
         and coalesce(s.deleted, false) = false
       order by s.updated_at desc nulls last, s.created_at desc nulls last
       limit 1
    )
  );
$$;

revoke all on function public.get_lodge_entitlement(uuid, text) from public, anon, authenticated;
grant execute on function public.get_lodge_entitlement(uuid, text) to anon, authenticated, service_role;

-- Authoritative, read-only preview used by trial/post-trial UI and by the
-- governed assignment wrappers.  It reports every blocker without changing
-- the licence, users, rooms, bookings, sessions, or feature rows.
create or replace function public.get_commercial_transition_preview(
  p_lodge_id uuid,
  p_product_id text,
  p_target_package_key text,
  p_reference_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_product text := lower(btrim(coalesce(p_product_id, '')));
  v_package_key text := lower(btrim(coalesce(p_target_package_key, '')));
  v_catalog public.commercial_catalog_versions%rowtype;
  v_package public.commercial_package_prices%rowtype;
  v_current jsonb;
  v_target_features jsonb;
  v_target_limits jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_lost_features jsonb := '[]'::jsonb;
  v_user_count integer := 0;
  v_room_count integer := 0;
  v_booking_count integer := 0;
  v_admin_count integer := 0;
  v_active_admin_count integer := 0;
  v_unsafe_role_count integer := 0;
  v_permission_override_count integer := 0;
  v_pwa_user_count integer := 0;
  v_active_pwa_session_count integer := 0;
  v_outlet_scope_count integer := 0;
  v_user_limit integer;
  v_room_limit integer;
  v_booking_limit integer;
  v_booking_grace integer;
  v_month_start date := date_trunc('month', coalesce(p_reference_date, current_date)::timestamp)::date;
  v_month_end date := (date_trunc('month', coalesce(p_reference_date, current_date)::timestamp) + interval '1 month')::date;
  v_pwa_target boolean;
  v_current_package text;
begin
  if not public._commercial_valid_product(v_product) then
    return jsonb_build_object('success', false, 'error', 'A valid commercial product is required');
  end if;
  if not public.app_is_service_role() then
    perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  end if;
  select * into v_catalog from public.commercial_catalog_versions where is_active = true order by effective_at desc, created_at desc limit 1;
  if v_catalog.id is null then return jsonb_build_object('success', false, 'error', 'No active commercial catalogue'); end if;
  select * into v_package
    from public.commercial_package_prices
   where catalog_version_id = v_catalog.id
     and product_id = v_product
     and commercial_package_key = v_package_key;
  if not found then return jsonb_build_object('success', false, 'error', 'The selected target package is not in the active commercial catalogue'); end if;

  v_current := public.get_lodge_entitlement(p_lodge_id, v_product);
  v_current_package := nullif(v_current->>'commercial_package_key', '');
  v_target_limits := public._commercial_target_limits(p_lodge_id, v_product, v_package.internal_plan);
  v_target_features := public._commercial_target_feature_map(p_lodge_id, v_product, v_package.internal_plan, v_catalog.id, v_package_key, false, false);
  v_pwa_target := coalesce((v_target_features->>'pwa')::boolean, false);
  v_user_limit := nullif(v_target_limits->>'users', '')::integer;
  v_room_limit := nullif(v_target_limits->>'rooms', '')::integer;
  v_booking_limit := nullif(v_target_limits->>'monthly_bookings', '')::integer;
  v_booking_grace := coalesce(nullif(v_target_limits->>'booking_grace', '')::integer, 0);

  select count(*) filter (where lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where lower(coalesce(role, '')) = 'admin' and lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where lower(coalesce(role, '')) = 'admin' and lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where lower(coalesce(role, '')) not in ('admin', 'receptionist', 'operations') and lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where coalesce(capability_overrides, '{}'::jsonb) <> '{}'::jsonb and lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where coalesce(pwa_enabled, false) and lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where cardinality(coalesce(allowed_outlet_ids, '{}'::uuid[])) > 0 and lower(coalesce(status, 'active')) = 'active')
    into v_user_count, v_admin_count, v_active_admin_count, v_unsafe_role_count,
         v_permission_override_count, v_pwa_user_count, v_outlet_scope_count
    from public.users where lodge_id = p_lodge_id;
  select count(*) into v_room_count from public.rooms where lodge_id = p_lodge_id;
  select count(*) into v_booking_count
    from public.bookings b
   where b.lodge_id = p_lodge_id
     and lower(coalesce(b.status, '')) in ('confirmed', 'checked_in', 'checked_out')
     and coalesce(b.is_exclusive_event, false) = false
     and b.check_in >= v_month_start and b.check_in < v_month_end;
  select count(*) into v_active_pwa_session_count
    from public.app_sessions s
   where s.lodge_id = p_lodge_id and s.session_type = 'pwa'
     and s.revoked_at is null and s.expires_at > now();

  if v_user_limit is not null and v_user_count > v_user_limit then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'users_over_limit', 'used', v_user_count, 'limit', v_user_limit, 'excess', v_user_count - v_user_limit, 'message', format('Select %s active staff account(s) to retain before activating this package.', v_user_limit)));
  end if;
  if v_room_limit is not null and v_room_count > v_room_limit then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'rooms_over_limit', 'used', v_room_count, 'limit', v_room_limit, 'excess', v_room_count - v_room_limit, 'message', format('This package allows %s rooms; existing rooms are preserved and new room creation is paused until remediated.', v_room_limit)));
  end if;
  if v_booking_limit is not null and v_booking_count > v_booking_limit + v_booking_grace then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'bookings_over_limit', 'used', v_booking_count, 'limit', v_booking_limit, 'grace', v_booking_grace, 'month', v_month_start, 'message', 'Existing bookings are preserved; new bookings in this check-in month require remediation or a higher allowance.'));
  end if;
  if v_product = 'lodge-camp' and lower(v_package.internal_plan) = 'starter' then
    if v_user_count > 0 and (v_admin_count <> 1 or v_active_admin_count <> 1) then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'starter_admin_owner', 'message', 'Starter requires exactly one active Admin owner account.'));
    end if;
    if v_unsafe_role_count > 0 then v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'starter_role_templates', 'count', v_unsafe_role_count, 'message', 'Starter additional accounts must use Receptionist or Operations role templates.')); end if;
    if v_permission_override_count > 0 then v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'starter_permission_exceptions', 'count', v_permission_override_count, 'message', 'Clear custom permission exceptions or choose Standard.')); end if;
    if not v_pwa_target and v_pwa_user_count > 0 then v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'starter_pwa_users', 'count', v_pwa_user_count, 'message', 'Disable Manager mobile access or grant a product-scoped PWA override.')); end if;
    if not v_pwa_target and v_outlet_scope_count > 0 then v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'starter_outlet_scopes', 'count', v_outlet_scope_count, 'message', 'Clear outlet-scoped access before activating Starter.')); end if;
  elsif v_product = 'lodge-camp' and lower(v_package.internal_plan) = 'standard' and not v_pwa_target and (v_pwa_user_count > 0 or v_active_pwa_session_count > 0) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'standard_pwa_access', 'users', v_pwa_user_count, 'sessions', v_active_pwa_session_count, 'message', 'Disable Manager mobile access and revoke active mobile sessions, or grant a product-scoped PWA override.'));
  end if;

  select coalesce(jsonb_agg(feature_key order by feature_key), '[]'::jsonb)
    into v_lost_features
    from jsonb_each_text(coalesce(v_current->'effective_features', '{}'::jsonb)) current_features(feature_key, enabled)
   where enabled = 'true' and coalesce((v_target_features->>feature_key)::boolean, false) = false;

  return jsonb_build_object(
    'success', true,
    'status', case when jsonb_array_length(v_blockers) = 0 then 'ready' else 'pending_remediation' end,
    'ready_to_activate', jsonb_array_length(v_blockers) = 0,
    'pending_remediation', jsonb_array_length(v_blockers) > 0,
    'lodge_id', p_lodge_id,
    'product_id', v_product,
    'current_package_key', v_current_package,
    'target_package_key', v_package_key,
    'target_plan', v_package.internal_plan,
    'catalog_version', v_catalog.version,
    'base_limits', public._commercial_base_limits(v_product, v_package.internal_plan),
    'effective_limits', v_target_limits,
    'effective_features', v_target_features,
    'usage', jsonb_build_object('users', v_user_count, 'rooms', v_room_count, 'monthly_bookings', v_booking_count, 'booking_month', v_month_start, 'pwa_users', v_pwa_user_count, 'active_pwa_sessions', v_active_pwa_session_count),
    'feature_changes', jsonb_build_object('features_lost', v_lost_features),
    'blockers', v_blockers,
    'data_policy', 'No users, rooms, bookings, financial records, or feature data are deleted automatically. Excess access is resolved through an explicit remediation workflow.'
  );
end;
$$;

revoke all on function public.get_commercial_transition_preview(uuid, text, text, date) from public, anon, authenticated;
grant execute on function public.get_commercial_transition_preview(uuid, text, text, date) to authenticated, service_role;

create or replace function public.get_commercial_entitlement_overrides(
  p_lodge_id uuid,
  p_product_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.app_is_service_role() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at desc, o.id desc) from public.commercial_entitlement_overrides o where o.lodge_id = p_lodge_id and (p_product_id is null or o.product_id = lower(btrim(p_product_id)))), '[]'::jsonb);
end;
$$;

revoke all on function public.get_commercial_entitlement_overrides(uuid, text) from public, anon, authenticated;
grant execute on function public.get_commercial_entitlement_overrides(uuid, text) to service_role;

-- Shared override mutation.  The operation envelope makes retries replay the
-- original result and the append-only row keeps the before/after history.
create or replace function public.admin_set_commercial_entitlement_override(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_lodge_id uuid := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  v_product text := lower(btrim(coalesce(p_payload->>'product_id', '')));
  v_feature_key text := nullif(lower(btrim(coalesce(p_payload->>'feature_key', ''))), '');
  v_limit_key text := case
    when lower(btrim(coalesce(p_payload->>'limit_key', ''))) in ('monthly_bookings_grace', 'monthlybookingsgrace') then 'booking_grace'
    else nullif(lower(btrim(coalesce(p_payload->>'limit_key', ''))), '')
  end;
  v_enabled boolean;
  v_limit_value integer;
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_actor_id uuid := nullif(btrim(coalesce(p_payload->>'actor_id', '')), '')::uuid;
  v_actor_email text := nullif(btrim(coalesce(p_payload->>'actor_email', '')), '');
  v_fresh_auth_at timestamptz := nullif(btrim(coalesce(p_payload->>'fresh_auth_at', p_payload->>'reauthenticated_at', '')), '')::timestamptz;
  v_expires_at timestamptz := nullif(btrim(coalesce(p_payload->>'expires_at', '')), '')::timestamptz;
  v_claim jsonb;
  v_before jsonb := '{}'::jsonb;
  v_override public.commercial_entitlement_overrides%rowtype;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('success', false, 'error', 'Commercial override payload is required'); end if;
  if v_operation_id is null or v_lodge_id is null or not public._commercial_valid_product(v_product) then return jsonb_build_object('success', false, 'error', 'A valid operation, lodge, and product are required'); end if;
  if v_reason is null or length(v_reason) < 8 then return jsonb_build_object('success', false, 'error', 'An override reason of at least 8 characters is required'); end if;
  perform public._command_central_require_fresh_master_admin(v_actor_id, v_actor_email, v_fresh_auth_at);
  if (v_feature_key is null) = (v_limit_key is null) then return jsonb_build_object('success', false, 'error', 'Provide exactly one feature_key or limit_key'); end if;
  if v_feature_key is not null then
    if public._commercial_non_overridable_feature(v_feature_key) then return jsonb_build_object('success', false, 'error', 'Security, tenancy, product identity, audit, idempotency, and financial controls cannot be overridden'); end if;
    if v_feature_key !~ '^[a-z][a-z0-9_.-]{0,119}$' then return jsonb_build_object('success', false, 'error', 'feature_key contains invalid characters'); end if;
    if not public._commercial_feature_allowed(v_product, v_feature_key) then return jsonb_build_object('success', false, 'error', 'That feature is not part of the selected product catalogue'); end if;
    if not (p_payload ? 'enabled') or jsonb_typeof(p_payload->'enabled') <> 'boolean' then return jsonb_build_object('success', false, 'error', 'Feature overrides require a boolean enabled value'); end if;
    v_enabled := (p_payload->>'enabled')::boolean;
  else
    if v_product <> 'lodge-camp' then return jsonb_build_object('success', false, 'error', 'Numeric usage allowances are not applicable to this product catalogue'); end if;
    if v_limit_key not in ('users', 'rooms', 'monthly_bookings', 'booking_grace') then return jsonb_build_object('success', false, 'error', 'Unsupported commercial numeric limit'); end if;
    if not (p_payload ? 'limit_value') or jsonb_typeof(p_payload->'limit_value') not in ('number', 'string') then return jsonb_build_object('success', false, 'error', 'Numeric overrides require a non-negative integer limit_value'); end if;
    if (p_payload->>'limit_value') !~ '^[0-9]+$' then return jsonb_build_object('success', false, 'error', 'Numeric overrides require a non-negative integer limit_value'); end if;
    v_limit_value := (p_payload->>'limit_value')::integer;
    if v_limit_value < 0 then return jsonb_build_object('success', false, 'error', 'Numeric overrides cannot be negative'); end if;
  end if;
  if v_expires_at is not null and v_expires_at <= now() then return jsonb_build_object('success', false, 'error', 'Override expiry must be in the future'); end if;

  v_claim := public.command_central_claim_operation(v_operation_id, 'commercial_entitlement_override.set', v_lodge_id, v_product, md5(p_payload::text), v_reason, v_actor_id, v_actor_email);
  if coalesce((v_claim->>'ok')::boolean, false) = false then return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim override operation')); end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous override operation has no result')); end if;

  if v_feature_key is not null then
    select to_jsonb(o) into v_before
      from public.commercial_entitlement_overrides o
     where o.lodge_id = v_lodge_id and o.product_id = v_product
       and o.feature_key = v_feature_key and o.revoked_at is null
       and (o.expires_at is null or o.expires_at > now())
     order by o.created_at desc, o.id desc limit 1;
  else
    select to_jsonb(o) into v_before
      from public.commercial_entitlement_overrides o
     where o.lodge_id = v_lodge_id and o.product_id = v_product
       and o.limit_key = v_limit_key and o.revoked_at is null
       and (o.expires_at is null or o.expires_at > now())
     order by o.created_at desc, o.id desc limit 1;
  end if;
  v_before := coalesce(v_before, '{}'::jsonb);

  insert into public.commercial_entitlement_overrides(lodge_id, product_id, feature_key, enabled, limit_key, limit_value, reason, created_by, created_by_email, expires_at)
  values (v_lodge_id, v_product, v_feature_key, v_enabled, v_limit_key, v_limit_value, v_reason, v_actor_id, lower(v_actor_email), v_expires_at)
  returning * into v_override;
  v_result := jsonb_build_object('success', true, 'status', 'active', 'override', to_jsonb(v_override), 'effective_entitlement', public.get_lodge_entitlement(v_lodge_id, v_product));
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email, reason, before_state, after_state)
  values (v_operation_id, 'commercial_entitlement_override_set', v_lodge_id, v_product, v_actor_id, lower(v_actor_email), v_reason, v_before, v_result);
  return v_result;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  v_result := jsonb_build_object('success', false, 'error', 'One of the override identifiers, values, or dates is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', case when sqlstate = '42501' then sqlerrm else 'Commercial entitlement override failed' end);
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

create or replace function public.admin_revoke_commercial_entitlement_override(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_override_id uuid := nullif(btrim(coalesce(p_payload->>'override_id', '')), '')::uuid;
  v_lodge_id uuid := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  v_product text := lower(btrim(coalesce(p_payload->>'product_id', '')));
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_actor_id uuid := nullif(btrim(coalesce(p_payload->>'actor_id', '')), '')::uuid;
  v_actor_email text := nullif(btrim(coalesce(p_payload->>'actor_email', '')), '');
  v_fresh_auth_at timestamptz := nullif(btrim(coalesce(p_payload->>'fresh_auth_at', p_payload->>'reauthenticated_at', '')), '')::timestamptz;
  v_override public.commercial_entitlement_overrides%rowtype;
  v_claim jsonb;
  v_result jsonb;
  v_revoked_sessions integer := 0;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('success', false, 'error', 'Commercial override revoke payload is required'); end if;
  if v_operation_id is null or v_override_id is null or v_lodge_id is null or not public._commercial_valid_product(v_product) then return jsonb_build_object('success', false, 'error', 'A valid operation, override, lodge, and product are required'); end if;
  if v_reason is null or length(v_reason) < 8 then return jsonb_build_object('success', false, 'error', 'A revoke reason of at least 8 characters is required'); end if;
  perform public._command_central_require_fresh_master_admin(v_actor_id, v_actor_email, v_fresh_auth_at);
  select * into v_override from public.commercial_entitlement_overrides where id = v_override_id and lodge_id = v_lodge_id and product_id = v_product for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Commercial entitlement override was not found for this lodge and product'); end if;
  v_claim := public.command_central_claim_operation(v_operation_id, 'commercial_entitlement_override.revoke', v_lodge_id, v_product, md5(p_payload::text), v_reason, v_actor_id, v_actor_email);
  if coalesce((v_claim->>'ok')::boolean, false) = false then return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim override revoke operation')); end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous override revoke operation has no result')); end if;
  if v_override.revoked_at is null then
    update public.commercial_entitlement_overrides
       set revoked_at = now(), revoked_by = v_actor_id, revoked_by_email = lower(v_actor_email), revoke_reason = v_reason
     where id = v_override.id;
  end if;
  if v_override.feature_key = 'pwa' and v_product = 'lodge-camp' and not coalesce((public.get_lodge_entitlement(v_lodge_id, v_product)->'effective_features'->>'pwa')::boolean, false) then
    update public.app_sessions
       set revoked_at = now(), metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('revoked_by_commercial_override', true, 'revoked_reason', v_reason)
     where lodge_id = v_lodge_id and session_type = 'pwa' and revoked_at is null;
    get diagnostics v_revoked_sessions = row_count;
  end if;
  v_result := jsonb_build_object('success', true, 'status', 'revoked', 'override_id', v_override.id, 'revoked_sessions', v_revoked_sessions, 'effective_entitlement', public.get_lodge_entitlement(v_lodge_id, v_product));
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email, reason, before_state, after_state)
  values (v_operation_id, 'commercial_entitlement_override_revoked', v_lodge_id, v_product, v_actor_id, lower(v_actor_email), v_reason, to_jsonb(v_override), v_result);
  return v_result;
exception when invalid_text_representation or datetime_field_overflow then
  v_result := jsonb_build_object('success', false, 'error', 'One of the revoke identifiers or dates is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', case when sqlstate = '42501' then sqlerrm else 'Commercial entitlement override revoke failed' end);
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.admin_set_commercial_entitlement_override(jsonb), public.admin_revoke_commercial_entitlement_override(jsonb) from public, anon, authenticated;
grant execute on function public.admin_set_commercial_entitlement_override(jsonb), public.admin_revoke_commercial_entitlement_override(jsonb) to service_role;

-- Explicit user-capacity remediation. Command Central names the accounts that
-- remain active; overflow accounts are suspended (never deleted), their PWA
-- access is disabled, and all app sessions are revoked atomically.
create or replace function public.admin_apply_commercial_user_remediation(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_lodge_id uuid := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  v_product text := lower(btrim(coalesce(p_payload->>'product_id', '')));
  v_package_key text := lower(btrim(coalesce(p_payload->>'target_package_key', '')));
  v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_actor_id uuid := nullif(btrim(coalesce(p_payload->>'actor_id', '')), '')::uuid;
  v_actor_email text := nullif(btrim(coalesce(p_payload->>'actor_email', '')), '');
  v_fresh_auth_at timestamptz := nullif(btrim(coalesce(p_payload->>'fresh_auth_at', '')), '')::timestamptz;
  v_keep_ids uuid[] := '{}'::uuid[];
  v_catalog public.commercial_catalog_versions%rowtype;
  v_package public.commercial_package_prices%rowtype;
  v_limit integer;
  v_active_count integer;
  v_valid_keep_count integer;
  v_admin_count integer;
  v_unsafe_count integer;
  v_claim jsonb;
  v_before jsonb;
  v_preview jsonb;
  v_result jsonb;
  v_suspended integer := 0;
  v_revoked_sessions integer := 0;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('success', false, 'error', 'User remediation payload is required'); end if;
  if v_operation_id is null or v_lodge_id is null or v_product <> 'lodge-camp' or v_package_key = '' then return jsonb_build_object('success', false, 'error', 'A valid operation, Lodge property, and target package are required'); end if;
  if v_reason is null or length(v_reason) < 8 then return jsonb_build_object('success', false, 'error', 'A remediation reason of at least 8 characters is required'); end if;
  if jsonb_typeof(coalesce(p_payload->'keep_user_ids', '[]'::jsonb)) <> 'array' then return jsonb_build_object('success', false, 'error', 'keep_user_ids must be an array'); end if;
  perform public._command_central_require_fresh_master_admin(v_actor_id, v_actor_email, v_fresh_auth_at);
  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_keep_ids from jsonb_array_elements_text(coalesce(p_payload->'keep_user_ids', '[]'::jsonb));
  if cardinality(v_keep_ids) <> cardinality(array(select distinct unnest(v_keep_ids))) then return jsonb_build_object('success', false, 'error', 'Each retained user may be selected only once'); end if;
  select * into v_catalog from public.commercial_catalog_versions where is_active = true order by effective_at desc, created_at desc limit 1;
  select * into v_package from public.commercial_package_prices where catalog_version_id = v_catalog.id and product_id = v_product and commercial_package_key = v_package_key;
  if not found then return jsonb_build_object('success', false, 'error', 'The target package is not in the active Lodge catalogue'); end if;
  v_limit := nullif(public._commercial_target_limits(v_lodge_id, v_product, v_package.internal_plan)->>'users', '')::integer;
  if v_limit is null then return jsonb_build_object('success', false, 'error', 'The target package does not require user-capacity remediation'); end if;
  perform pg_advisory_xact_lock(hashtextextended('commercial-user-remediation:' || v_lodge_id::text, 0));
  perform 1 from public.users where lodge_id = v_lodge_id for update;
  select count(*) into v_active_count from public.users where lodge_id = v_lodge_id and lower(coalesce(status, 'active')) = 'active';
  if v_active_count <= v_limit then return jsonb_build_object('success', true, 'status', 'already_within_limit', 'active_users', v_active_count, 'limit', v_limit); end if;
  if cardinality(v_keep_ids) <> v_limit then return jsonb_build_object('success', false, 'error', format('Select exactly %s active account(s) to retain', v_limit)); end if;
  select count(*) into v_valid_keep_count from public.users where lodge_id = v_lodge_id and id = any(v_keep_ids) and lower(coalesce(status, 'active')) = 'active';
  if v_valid_keep_count <> cardinality(v_keep_ids) then return jsonb_build_object('success', false, 'error', 'Every retained account must be an active user of this property'); end if;
  if lower(coalesce(v_package.internal_plan, '')) in ('starter', 'basic') then
    select count(*) filter (where lower(coalesce(role, '')) = 'admin'),
           count(*) filter (where lower(coalesce(role, '')) not in ('admin', 'receptionist', 'operations') or coalesce(capability_overrides, '{}'::jsonb) <> '{}'::jsonb or cardinality(coalesce(allowed_outlet_ids, '{}'::uuid[])) > 0)
      into v_admin_count, v_unsafe_count from public.users where lodge_id = v_lodge_id and id = any(v_keep_ids);
    if v_admin_count <> 1 then return jsonb_build_object('success', false, 'error', 'Starter requires exactly one retained Admin owner account'); end if;
    if v_unsafe_count > 0 then return jsonb_build_object('success', false, 'error', 'Retained Starter accounts must use the Admin, Receptionist, or Operations templates without custom permission or outlet exceptions'); end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'role', role, 'status', status, 'pwa_enabled', pwa_enabled) order by id), '[]'::jsonb)
    into v_before from public.users where lodge_id = v_lodge_id and lower(coalesce(status, 'active')) = 'active';
  v_claim := public.command_central_claim_operation(v_operation_id, 'commercial_subscription.user_remediation', v_lodge_id, v_product, md5(p_payload::text), v_reason, v_actor_id, v_actor_email);
  if coalesce((v_claim->>'ok')::boolean, false) = false then return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim user remediation operation')); end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous remediation has no result')); end if;
  update public.users set status = 'suspended', pwa_enabled = false, pwa_disabled_reason = 'Suspended during approved package-capacity remediation', updated_at = now()
   where lodge_id = v_lodge_id and lower(coalesce(status, 'active')) = 'active' and not (id = any(v_keep_ids));
  get diagnostics v_suspended = row_count;
  update public.app_sessions set revoked_at = now(), metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('commercial_user_remediation', true, 'reason', v_reason)
   where lodge_id = v_lodge_id and user_id <> all(v_keep_ids) and revoked_at is null;
  get diagnostics v_revoked_sessions = row_count;
  v_preview := public.get_commercial_transition_preview(v_lodge_id, v_product, v_package_key, current_date);
  v_result := jsonb_build_object('success', true, 'status', 'remediated', 'suspended_users', v_suspended, 'revoked_sessions', v_revoked_sessions, 'retained_user_ids', to_jsonb(v_keep_ids), 'transition_preview', v_preview, 'data_deleted', false);
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email, reason, before_state, after_state)
  values (v_operation_id, 'commercial_subscription_user_remediated', v_lodge_id, v_product, v_actor_id, lower(v_actor_email), v_reason, jsonb_build_object('users', v_before), v_result);
  return v_result;
exception when invalid_text_representation or datetime_field_overflow then
  v_result := jsonb_build_object('success', false, 'error', 'One of the remediation identifiers or dates is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', case when sqlstate = '42501' then sqlerrm else 'Commercial user remediation failed' end);
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.admin_apply_commercial_user_remediation(jsonb) from public, anon, authenticated;
grant execute on function public.admin_apply_commercial_user_remediation(jsonb) to service_role;

-- Starter transition guard: the effective product-scoped limit, not a fixed 2,
-- decides whether existing staff fit.  No user is rewritten or deleted here.
create or replace function public.enforce_starter_license_user_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_new_is_starter boolean := lower(btrim(coalesce(new.subscription_plan, ''))) in ('starter', 'basic')
    and coalesce(nullif(lower(btrim(coalesce(new.product_id, ''))), ''), 'lodge-camp') = 'lodge-camp'
    and coalesce(new.is_active, true) = true;
  v_user_count integer := 0;
  v_user_limit integer := nullif(public._commercial_target_limits(new.lodge_id, 'lodge-camp', 'Starter')->>'users', '')::integer;
  v_admin_count integer := 0;
  v_active_admin_count integer := 0;
  v_unsafe_role_count integer := 0;
  v_override_count integer := 0;
  v_pwa_count integer := 0;
  v_outlet_scope_count integer := 0;
  v_pwa_allowed boolean := coalesce((public._commercial_target_feature_map(new.lodge_id, 'lodge-camp', 'Starter', null::uuid, null::text, false, false)->>'pwa')::boolean, false);
begin
  if not v_new_is_starter then return new; end if;
  if new.lodge_id is null then raise exception 'Cannot activate Starter without a valid lodge. Select the company before assigning the Starter package.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('starter-users:' || new.lodge_id::text, 0));
  select count(*) filter (where lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where lower(coalesce(role, '')) = 'admin' and lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where lower(coalesce(role, '')) = 'admin' and lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where lower(coalesce(role, '')) not in ('admin', 'receptionist', 'operations') and lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where coalesce(capability_overrides, '{}'::jsonb) <> '{}'::jsonb and lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where coalesce(pwa_enabled, false) and lower(coalesce(status, 'active')) = 'active'),
         count(*) filter (where cardinality(coalesce(allowed_outlet_ids, '{}'::uuid[])) > 0 and lower(coalesce(status, 'active')) = 'active')
    into v_user_count, v_admin_count, v_active_admin_count, v_unsafe_role_count, v_override_count, v_pwa_count, v_outlet_scope_count
    from public.users where lodge_id = new.lodge_id;
  if v_user_count = 0 then return new; end if;
  if v_user_limit is not null and v_user_count > v_user_limit then raise exception 'Cannot activate Starter: this lodge has % active user accounts, but the effective Starter allowance is %. Resolve the pending remediation or keep the current package.', v_user_count, v_user_limit; end if;
  if v_admin_count <> 1 or v_active_admin_count <> 1 then raise exception 'Cannot activate Starter: keep exactly one active Admin owner account. Reactivate the owner and change any other privileged accounts to Receptionist or Operations first.'; end if;
  if v_unsafe_role_count > 0 then raise exception 'Cannot activate Starter: every account other than the single Admin owner must use the Receptionist or Operations role template.'; end if;
  if v_override_count > 0 then raise exception 'Cannot activate Starter while custom permission exceptions exist. Clear the overrides before downgrading or keep Standard.'; end if;
  if v_pwa_count > 0 and not v_pwa_allowed then raise exception 'Cannot activate Starter while Manager mobile access is enabled. Disable mobile access or grant a product-scoped PWA override before retrying.'; end if;
  if v_outlet_scope_count > 0 then raise exception 'Cannot activate Starter while outlet-scoped user access exists. Clear outlet assignments before downgrading or keep the current package.'; end if;
  return new;
end;
$$;

drop trigger if exists aaa_starter_license_user_transition_guard on public.licenses;
create trigger aaa_starter_license_user_transition_guard before insert or update of lodge_id, product_id, subscription_plan, is_active on public.licenses for each row execute function public.enforce_starter_license_user_transition();
revoke all on function public.enforce_starter_license_user_transition() from public;
grant execute on function public.enforce_starter_license_user_transition() to service_role;

-- Starter user creation guard consumes the same effective allowance as the
-- licence transition guard, so an override is honoured consistently.
create or replace function public.enforce_starter_users_access_lite()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_starter boolean := false;
  v_existing_count integer := 0;
  v_user_limit integer := null;
  v_role text := lower(coalesce(new.role, ''));
  v_entitlement jsonb;
begin
  select exists (select 1 from public.licenses license where license.lodge_id = new.lodge_id and coalesce(license.is_active, true) = true and lower(btrim(coalesce(license.subscription_plan, ''))) in ('starter', 'basic') and coalesce(nullif(lower(btrim(coalesce(license.product_id, ''))), ''), 'lodge-camp') = 'lodge-camp') into v_is_starter;
  if not v_is_starter then return new; end if;
  if lower(coalesce(new.status, 'active')) <> 'active' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('starter-users:' || new.lodge_id::text, 0));
  v_entitlement := public.get_lodge_entitlement(new.lodge_id, 'lodge-camp');
  v_user_limit := nullif(v_entitlement->'effective_limits'->>'users', '')::integer;
  if tg_op = 'INSERT' then
    select count(*) into v_existing_count from public.users where lodge_id = new.lodge_id and lower(coalesce(status, 'active')) = 'active';
    if v_user_limit is not null and v_existing_count >= v_user_limit then raise exception 'Starter Users & Access allows up to % active users under the effective allowance. Upgrade or apply a Command Central override before adding another user.', v_user_limit; end if;
    if v_existing_count = 0 and v_role <> 'admin' then raise exception 'The first lodge user must use the Admin role template.'; end if;
    if v_existing_count > 0 and v_role not in ('receptionist', 'operations') then raise exception 'Starter additional users must use the Receptionist or Operations role template.'; end if;
  elsif tg_op = 'UPDATE' and lower(coalesce(old.status, 'active')) <> 'active' then
    select count(*) into v_existing_count from public.users where lodge_id = new.lodge_id and lower(coalesce(status, 'active')) = 'active' and id is distinct from new.id;
    if v_user_limit is not null and v_existing_count >= v_user_limit then raise exception 'The effective Starter user allowance is full. Increase it in Command Central before reactivating this account.'; end if;
  elsif tg_op = 'UPDATE' and v_role <> lower(coalesce(old.role, '')) and v_role not in ('receptionist', 'operations') and not (lower(coalesce(old.role, '')) = 'admin' and v_role = 'admin') then
    raise exception 'Starter additional users must use the Receptionist or Operations role template.';
  end if;
  if coalesce(new.capability_overrides, '{}'::jsonb) <> '{}'::jsonb then raise exception 'Starter uses fixed role templates. Custom permission exceptions require Standard.'; end if;
  if coalesce(new.pwa_enabled, false) and not coalesce((v_entitlement->'effective_features'->>'pwa')::boolean, false) then raise exception 'Manager mobile access is not included in Starter. Upgrade to Pro or grant a product-scoped PWA override.'; end if;
  if cardinality(coalesce(new.allowed_outlet_ids, '{}'::uuid[])) > 0 then raise exception 'Outlet-scoped access is not included in Starter Users & Access.'; end if;
  return new;
end;
$$;

drop trigger if exists aaa_starter_users_access_lite_guard on public.users;
create trigger aaa_starter_users_access_lite_guard before insert or update on public.users for each row execute function public.enforce_starter_users_access_lite();
revoke all on function public.enforce_starter_users_access_lite() from public;
grant execute on function public.enforce_starter_users_access_lite() to service_role;

-- Standard's PWA safety rule is still enforced unless the exact Lodge product
-- has an active PWA override. Password and role eligibility remain mandatory.
create or replace function public.enforce_pro_standard_pwa_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target_standard boolean := lower(btrim(coalesce(new.subscription_plan, ''))) = 'standard' and coalesce(nullif(lower(btrim(coalesce(new.product_id, ''))), ''), 'lodge-camp') = 'lodge-camp' and coalesce(new.is_active, true) = true;
  v_pwa_allowed boolean := coalesce((public._commercial_target_feature_map(new.lodge_id, 'lodge-camp', 'Standard', null::uuid, null::text, false, false)->>'pwa')::boolean, false);
  v_pwa_user_count integer := 0;
  v_active_pwa_session_count integer := 0;
begin
  if not v_target_standard or new.lodge_id is null or v_pwa_allowed then return new; end if;
  select count(*) into v_pwa_user_count from public.users where lodge_id = new.lodge_id and coalesce(pwa_enabled, false) = true;
  select count(*) into v_active_pwa_session_count from public.app_sessions where lodge_id = new.lodge_id and session_type = 'pwa' and revoked_at is null and expires_at > now();
  if v_pwa_user_count > 0 or v_active_pwa_session_count > 0 then raise exception 'Cannot activate Standard: % user account(s) still have Manager mobile access enabled and % active mobile session(s) remain. Disable every Manager mobile account before retrying, or grant a product-scoped PWA override.', v_pwa_user_count, v_active_pwa_session_count; end if;
  return new;
end;
$$;

drop trigger if exists aaa_pro_standard_pwa_transition_guard on public.licenses;
create trigger aaa_pro_standard_pwa_transition_guard before insert or update of lodge_id, product_id, subscription_plan, is_active on public.licenses for each row execute function public.enforce_pro_standard_pwa_transition();
revoke all on function public.enforce_pro_standard_pwa_transition() from public;
grant execute on function public.enforce_pro_standard_pwa_transition() to service_role;

-- Usage inserts, room creation, and staff creation all consume current
-- effective limits.  A live trial is intentionally uncapped; its UI uses the
-- preview RPC to explain what the selected post-trial package would change.
create or replace function public.enforce_usage_limits_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitlement jsonb;
  v_limits jsonb;
  v_plan text;
  v_booking_limit integer;
  v_booking_grace integer;
  v_room_limit integer;
  v_user_limit integer;
  v_upgrade_plan text;
  v_used integer;
  v_target_month_start date;
  v_target_month_end date;
  v_effective_booking_limit integer;
  v_target_month_used integer;
begin
  if tg_table_name = 'bookings' and tg_op = 'INSERT' then new.created_at := now(); end if;
  v_entitlement := public.get_lodge_entitlement(new.lodge_id, 'lodge-camp');
  if coalesce(v_entitlement->>'status', '') = 'trial' then return new; end if;
  v_limits := coalesce(v_entitlement->'effective_limits', '{}'::jsonb);
  v_plan := coalesce(v_entitlement->>'plan', 'Starter');
  v_booking_limit := nullif(v_limits->>'monthly_bookings', '')::integer;
  v_booking_grace := coalesce(nullif(v_limits->>'booking_grace', '')::integer, 0);
  v_room_limit := nullif(v_limits->>'rooms', '')::integer;
  v_user_limit := nullif(v_limits->>'users', '')::integer;
  v_upgrade_plan := case when v_plan = 'Starter' then 'Standard' when v_plan = 'Standard' then 'Pro' when v_plan = 'Pro' then 'Enterprise' else null end;
  if tg_table_name = 'bookings' then
    if lower(coalesce(new.status, '')) not in ('confirmed', 'checked_in', 'checked_out') or coalesce(new.is_exclusive_event, false) = true or new.check_in is null or v_booking_limit is null then return new; end if;
    v_target_month_start := date_trunc('month', new.check_in::timestamp)::date;
    v_target_month_end := (v_target_month_start + interval '1 month')::date;
    if tg_op = 'UPDATE' and old.lodge_id is not distinct from new.lodge_id and lower(coalesce(old.status, '')) in ('confirmed', 'checked_in', 'checked_out') and coalesce(old.is_exclusive_event, false) = false and old.check_in is not null and date_trunc('month', old.check_in::timestamp)::date = v_target_month_start then return new; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('booking-usage:' || new.lodge_id::text || ':' || v_target_month_start::text, 0));
    select count(*) into v_target_month_used from public.bookings b where b.lodge_id = new.lodge_id and lower(coalesce(b.status, '')) in ('confirmed', 'checked_in', 'checked_out') and coalesce(b.is_exclusive_event, false) = false and b.check_in >= v_target_month_start and b.check_in < v_target_month_end and (tg_op <> 'UPDATE' or b.id is distinct from new.id);
    v_effective_booking_limit := v_booking_limit + v_booking_grace;
    if v_target_month_used >= v_effective_booking_limit then raise exception 'Booking limit reached for the selected check-in month on % plan. Upgrade to % or apply a Command Central booking allowance override to create more bookings.', v_plan, coalesce(v_upgrade_plan, 'a higher package'); end if;
    return new;
  end if;
  if tg_table_name = 'rooms' and v_room_limit is not null then
    select count(*) into v_used from public.rooms r where r.lodge_id = new.lodge_id;
    if v_used >= v_room_limit then raise exception 'Room limit reached: % allows up to % rooms under the effective allowance. Upgrade to % or apply a Command Central rooms override.', v_plan, v_room_limit, coalesce(v_upgrade_plan, 'a higher package'); end if;
    return new;
  end if;
  if tg_table_name = 'users' and v_user_limit is not null then
    if lower(coalesce(new.status, 'active')) <> 'active' then return new; end if;
    select count(*) into v_used from public.users u where u.lodge_id = new.lodge_id and lower(coalesce(u.status, 'active')) = 'active';
    if v_used >= v_user_limit then raise exception 'User limit reached: % allows up to % staff accounts under the effective allowance. Upgrade to % or apply a Command Central users override.', v_plan, v_user_limit, coalesce(v_upgrade_plan, 'a higher package'); end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_booking_usage_limit on public.bookings;
create trigger trg_enforce_booking_usage_limit before insert or update of status, check_in, lodge_id, is_exclusive_event on public.bookings for each row execute function public.enforce_usage_limits_on_insert();

-- Governed assignment returns a completed, replay-safe pending-remediation
-- result instead of invoking a licence trigger that would roll back the whole
-- Command Central operation.  A ready preview still enters the existing
-- authoritative assignment implementation and its triggers.
create or replace function public.admin_governed_assign_commercial_subscription(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_lodge_id uuid := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  v_product_id text := lower(btrim(coalesce(p_payload->>'product_id', '')));
  v_package_key text := lower(btrim(coalesce(p_payload->>'commercial_package_key', '')));
  v_reason text := nullif(btrim(coalesce(p_payload->>'activation_reason', p_payload->>'reason', '')), '');
  v_claim jsonb;
  v_preview jsonb;
  v_before jsonb;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('success', false, 'error', 'Subscription assignment payload is required'); end if;
  if v_operation_id is null or v_lodge_id is null or v_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then return jsonb_build_object('success', false, 'error', 'A valid operation, company, and product are required'); end if;
  if v_reason is null or length(v_reason) < 8 then return jsonb_build_object('success', false, 'error', 'An assignment reason of at least 8 characters is required'); end if;
  v_claim := public.command_central_claim_operation(v_operation_id, 'commercial_subscription.assign', v_lodge_id, v_product_id, md5(p_payload::text), v_reason, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''));
  if coalesce((v_claim->>'ok')::boolean, false) = false then return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim subscription assignment')); end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous operation has no result')); end if;
  v_preview := public.get_commercial_transition_preview(v_lodge_id, v_product_id, v_package_key, current_date);
  if coalesce((v_preview->>'success')::boolean, false) = false then perform public.command_central_fail_operation(v_operation_id, v_preview); return v_preview; end if;
  if coalesce((v_preview->>'ready_to_activate')::boolean, false) = false then
    v_result := v_preview || jsonb_build_object('success', true, 'status', 'pending_remediation', 'activated', false);
    perform public.command_central_complete_operation(v_operation_id, v_result);
    insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email, reason, before_state, after_state)
    values (v_operation_id, 'commercial_subscription_pending_remediation', v_lodge_id, v_product_id, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''), v_reason, '{}'::jsonb, v_result);
    return v_result;
  end if;
  select jsonb_build_object('license_id', id, 'product_id', product_id, 'package_key', commercial_package_key, 'payment_status', payment_status, 'monthly_fee', monthly_fee, 'currency', currency) into v_before from public.licenses where lodge_id = v_lodge_id and product_id = v_product_id and coalesce(is_active, true) = true order by issued_at desc nulls last limit 1 for update;
  v_result := public.admin_assign_commercial_subscription(p_payload);
  if coalesce((v_result->>'success')::boolean, false) = false then perform public.command_central_fail_operation(v_operation_id, v_result); return v_result; end if;
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email, reason, before_state, after_state)
  values (v_operation_id, 'commercial_subscription_assigned', v_lodge_id, v_product_id, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''), v_reason, coalesce(v_before, '{}'::jsonb), v_result);
  return v_result;
exception when invalid_text_representation then
  v_result := jsonb_build_object('success', false, 'error', 'One of the assignment identifiers is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', case when sqlerrm like 'Cannot activate Starter:%' or sqlerrm like 'Cannot activate Standard:%' then sqlerrm else 'Commercial subscription assignment failed' end);
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

-- Quote activation uses the same preview before its existing request/licence
-- mutation.  The request remains approved and can be retried after explicit
-- remediation; it is never marked activated with an unsafe downgrade.
create or replace function public.admin_governed_activate_subscription_request(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_request_id uuid := nullif(btrim(coalesce(p_payload->>'request_id', '')), '')::uuid;
  v_operation_id uuid := nullif(btrim(coalesce(p_payload->>'operation_id', '')), '')::uuid;
  v_request public.subscription_package_requests%rowtype;
  v_lodge_id uuid;
  v_license_id uuid := nullif(btrim(coalesce(p_payload->>'license_id', '')), '')::uuid;
  v_product_id text;
  v_reason text := nullif(btrim(coalesce(p_payload->>'activation_reason', p_payload->>'reason', '')), '');
  v_claim jsonb;
  v_preview jsonb;
  v_contract_result jsonb;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return jsonb_build_object('success', false, 'error', 'Subscription activation payload is required'); end if;
  if v_request_id is null or v_operation_id is null or v_reason is null or length(v_reason) < 8 then return jsonb_build_object('success', false, 'error', 'A request, stable operation ID, and activation reason are required'); end if;
  select * into v_request from public.subscription_package_requests where id = v_request_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Subscription request was not found'); end if;
  v_lodge_id := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '')::uuid;
  if v_lodge_id is null then v_lodge_id := v_request.lodge_id; end if;
  if v_request.lodge_id is not null and v_lodge_id is distinct from v_request.lodge_id then return jsonb_build_object('success', false, 'error', 'Selected company does not match the subscription request'); end if;
  v_product_id := lower(nullif(btrim(coalesce(p_payload->>'product_id', v_request.product_id, '')), ''));
  if v_lodge_id is null or v_license_id is null or v_product_id is null then return jsonb_build_object('success', false, 'error', 'A company, product, and selected license are required for activation'); end if;
  v_claim := public.command_central_claim_operation(v_operation_id, 'subscription_request.activate', v_lodge_id, v_product_id, md5(p_payload::text), v_reason, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''));
  if coalesce((v_claim->>'ok')::boolean, false) = false then return jsonb_build_object('success', false, 'error', coalesce(v_claim->>'error', 'Could not claim activation operation')); end if;
  if coalesce((v_claim->>'replayed')::boolean, false) then return coalesce(v_claim->'result', jsonb_build_object('success', false, 'error', 'Previous operation has no result')); end if;
  if v_request.commercial_package_key is not null then
    v_preview := public.get_commercial_transition_preview(v_lodge_id, v_product_id, v_request.commercial_package_key, current_date);
    if coalesce((v_preview->>'success')::boolean, false) = false then perform public.command_central_fail_operation(v_operation_id, v_preview); return v_preview; end if;
    if coalesce((v_preview->>'ready_to_activate')::boolean, false) = false then
      v_result := v_preview || jsonb_build_object('success', true, 'status', 'pending_remediation', 'activated', false, 'request_id', v_request_id);
      perform public.command_central_complete_operation(v_operation_id, v_result);
      insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email, reason, before_state, after_state)
      values (v_operation_id, 'subscription_request_pending_remediation', v_lodge_id, v_product_id, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''), v_reason, jsonb_build_object('request_id', v_request_id, 'status', v_request.status), v_result);
      return v_result;
    end if;
  end if;
  if v_request.commercial_package_key is null then
    v_contract_result := public.update_subscription_contract(v_license_id, jsonb_build_object('subscription_plan', coalesce(p_payload->>'plan', v_request.requested_plan, 'Starter'), 'payment_status', coalesce(p_payload->>'payment_status', 'active'), 'notes', coalesce(p_payload->>'notes', 'Activated from a governed Command Central subscription request')));
    if coalesce((v_contract_result->>'success')::boolean, false) = false then perform public.command_central_fail_operation(v_operation_id, v_contract_result); return v_contract_result; end if;
  end if;
  v_result := public.activate_subscription_request(v_request_id, coalesce(nullif(p_payload->>'activated_by', ''), nullif(p_payload->>'actor_email', ''), 'command-central'), p_payload - 'operation_id' - 'request_id' - 'actor_id' - 'actor_email');
  if coalesce((v_result->>'success')::boolean, false) = false then perform public.command_central_fail_operation(v_operation_id, v_result); return v_result; end if;
  perform public.command_central_complete_operation(v_operation_id, v_result);
  insert into public.command_central_audit_events(operation_id, event_type, target_lodge_id, product_id, actor_id, actor_email, reason, before_state, after_state)
  values (v_operation_id, 'subscription_request_activated', v_lodge_id, v_product_id, nullif(p_payload->>'actor_id', '')::uuid, nullif(p_payload->>'actor_email', ''), v_reason, jsonb_build_object('request_id', v_request_id, 'status', v_request.status), v_result);
  return v_result;
exception when invalid_text_representation then
  v_result := jsonb_build_object('success', false, 'error', 'One of the activation identifiers is invalid');
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
when others then
  v_result := jsonb_build_object('success', false, 'error', case when sqlerrm like 'Cannot activate Starter:%' or sqlerrm like 'Cannot activate Standard:%' then sqlerrm else 'Governed subscription activation failed' end);
  if v_operation_id is not null then perform public.command_central_fail_operation(v_operation_id, v_result); end if;
  return v_result;
end;
$$;

revoke all on function public.admin_governed_assign_commercial_subscription(jsonb), public.admin_governed_activate_subscription_request(jsonb) from public, anon, authenticated;
grant execute on function public.admin_governed_assign_commercial_subscription(jsonb), public.admin_governed_activate_subscription_request(jsonb) to service_role;

notify pgrst, 'reload schema';
