-- Guest CRM: profiles, VIP, preferences, stay history, consent, blacklist
-- Enhances enterprise_guest_crm_notes table from enterprise_operations_contracts

create table if not exists public.guest_crm_profiles (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  customer_id uuid not null,
  vip_level text not null default 'standard',
  vip_approved_by uuid,
  stay_count int not null default 0,
  lifetime_value numeric(12,2) not null default 0,
  preferred_room_type_id uuid,
  preferences jsonb not null default '{}'::jsonb,
  blacklisted boolean not null default false,
  blacklist_reason text,
  watchlisted boolean not null default false,
  watchlist_reason text,
  company_affiliation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id)
);

create table if not exists public.guest_stay_history (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  customer_id uuid not null,
  booking_id uuid,
  check_in date not null,
  check_out date not null,
  room_type text,
  total_amount numeric(12,2) default 0,
  paid_amount numeric(12,2) default 0,
  incidents text[] default '{}',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.guest_consent_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  customer_id uuid not null,
  consent_type text not null,
  granted boolean not null,
  granted_at timestamptz not null default now(),
  ip_address text,
  notes text
);

create index if not exists guest_crm_profiles_lodge_idx
  on public.guest_crm_profiles(lodge_id, customer_id);
create index if not exists guest_crm_profiles_vip_idx
  on public.guest_crm_profiles(lodge_id, vip_level);
create index if not exists guest_crm_profiles_blacklist_idx
  on public.guest_crm_profiles(lodge_id, blacklisted);
create index if not exists guest_stay_history_customer_idx
  on public.guest_stay_history(lodge_id, customer_id, created_at desc);
create index if not exists guest_consent_log_customer_idx
  on public.guest_consent_log(lodge_id, customer_id, granted_at desc);

alter table public.guest_crm_profiles enable row level security;
alter table public.guest_stay_history enable row level security;
alter table public.guest_consent_log enable row level security;

-- RPC: get guest CRM profile
create or replace function public.get_guest_crm_profile(
  p_customer_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile jsonb;
  v_consents jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  select jsonb_build_object(
    'profile', row_to_json(p)::jsonb,
    'customer', row_to_json(c)::jsonb
  ) into v_profile
    from public.guest_crm_profiles p
    join public.customers c on c.id = p.customer_id
   where p.customer_id = p_customer_id and p.lodge_id = p_lodge_id;

  if v_profile is null then
    return jsonb_build_object('success', false, 'error', 'CRM profile not found');
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', cl.id,
      'consent_type', cl.consent_type,
      'granted', cl.granted,
      'granted_at', cl.granted_at,
      'ip_address', cl.ip_address,
      'notes', cl.notes
    ) order by cl.granted_at desc
  ) into v_consents
    from public.guest_consent_log cl
   where cl.customer_id = p_customer_id and cl.lodge_id = p_lodge_id;

  return jsonb_build_object(
    'success', true,
    'profile', v_profile->'profile',
    'customer', v_profile->'customer',
    'consents', coalesce(v_consents, '[]'::jsonb)
  );
end;
$$;

-- RPC: update (upsert) guest CRM profile
create or replace function public.update_guest_crm_profile(
  p_customer_id uuid,
  p_lodge_id uuid,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  insert into public.guest_crm_profiles (
    lodge_id, customer_id,
    vip_level, stay_count, lifetime_value, preferred_room_type_id,
    preferences, blacklisted, blacklist_reason, watchlisted, watchlist_reason,
    company_affiliation_id
  )
  values (
    p_lodge_id, p_customer_id,
    coalesce(nullif(p_data->>'vip_level', ''), 'standard'),
    greatest(0, coalesce((p_data->>'stay_count')::int, 0)),
    greatest(0, coalesce((p_data->>'lifetime_value')::numeric, 0)),
    nullif(p_data->>'preferred_room_type_id', '')::uuid,
    coalesce(p_data->'preferences', '{}'::jsonb),
    coalesce((p_data->>'blacklisted')::boolean, false),
    nullif(p_data->>'blacklist_reason', ''),
    coalesce((p_data->>'watchlisted')::boolean, false),
    nullif(p_data->>'watchlist_reason', ''),
    nullif(p_data->>'company_affiliation_id', '')::uuid
  )
  on conflict (customer_id)
  do update set
    vip_level            = coalesce(nullif(p_data->>'vip_level', ''), guest_crm_profiles.vip_level),
    stay_count           = greatest(0, coalesce((p_data->>'stay_count')::int, guest_crm_profiles.stay_count)),
    lifetime_value       = greatest(0, coalesce((p_data->>'lifetime_value')::numeric, guest_crm_profiles.lifetime_value)),
    preferred_room_type_id = coalesce(nullif(p_data->>'preferred_room_type_id', '')::uuid, guest_crm_profiles.preferred_room_type_id),
    preferences          = coalesce(p_data->'preferences', guest_crm_profiles.preferences),
    blacklisted          = coalesce((p_data->>'blacklisted')::boolean, guest_crm_profiles.blacklisted),
    blacklist_reason     = coalesce(nullif(p_data->>'blacklist_reason', ''), guest_crm_profiles.blacklist_reason),
    watchlisted          = coalesce((p_data->>'watchlisted')::boolean, guest_crm_profiles.watchlisted),
    watchlist_reason     = coalesce(nullif(p_data->>'watchlist_reason', ''), guest_crm_profiles.watchlist_reason),
    company_affiliation_id = coalesce(nullif(p_data->>'company_affiliation_id', '')::uuid, guest_crm_profiles.company_affiliation_id),
    updated_at           = now();

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: set VIP level
create or replace function public.set_vip_level(
  p_customer_id uuid,
  p_lodge_id uuid,
  p_level text,
  p_approved_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid_levels text[] := array['standard', 'silver', 'gold', 'platinum'];
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  if not (p_level = any(v_valid_levels)) then
    return jsonb_build_object('success', false, 'error', 'Invalid VIP level. Must be standard, silver, gold, or platinum');
  end if;

  insert into public.guest_crm_profiles (lodge_id, customer_id, vip_level, vip_approved_by)
  values (p_lodge_id, p_customer_id, p_level, p_approved_by)
  on conflict (customer_id)
  do update set
    vip_level = p_level,
    vip_approved_by = coalesce(p_approved_by, guest_crm_profiles.vip_approved_by),
    updated_at = now();

  return jsonb_build_object('success', true, 'vip_level', p_level);
end;
$$;

-- RPC: add guest preference
create or replace function public.add_guest_preference(
  p_customer_id uuid,
  p_lodge_id uuid,
  p_preference_key text,
  p_preference_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_prefs jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  select coalesce(preferences, '{}'::jsonb) into v_current_prefs
    from public.guest_crm_profiles
   where customer_id = p_customer_id;

  if not found then
    v_current_prefs := '{}'::jsonb;
  end if;

  v_current_prefs := jsonb_set(
    coalesce(v_current_prefs, '{}'::jsonb),
    array[p_preference_key],
    to_jsonb(p_preference_value)
  );

  insert into public.guest_crm_profiles (lodge_id, customer_id, preferences)
  values (p_lodge_id, p_customer_id, v_current_prefs)
  on conflict (customer_id)
  do update set
    preferences = v_current_prefs,
    updated_at = now();

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: set blacklist status
create or replace function public.set_blacklist_status(
  p_customer_id uuid,
  p_lodge_id uuid,
  p_blacklisted boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  insert into public.guest_crm_profiles (lodge_id, customer_id, blacklisted, blacklist_reason)
  values (p_lodge_id, p_customer_id, coalesce(p_blacklisted, false), nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (customer_id)
  do update set
    blacklisted = coalesce(p_blacklisted, guest_crm_profiles.blacklisted),
    blacklist_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    updated_at = now();

  return jsonb_build_object('success', true, 'blacklisted', p_blacklisted);
end;
$$;

-- RPC: get guest stay history
create or replace function public.get_guest_stay_history(
  p_customer_id uuid,
  p_lodge_id uuid
)
returns setof public.guest_stay_history
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  return query
    select *
      from public.guest_stay_history
     where customer_id = p_customer_id
       and lodge_id = p_lodge_id
     order by check_in desc;
end;
$$;

-- RPC: record guest consent
create or replace function public.record_guest_consent(
  p_customer_id uuid,
  p_lodge_id uuid,
  p_consent_type text,
  p_granted boolean,
  p_ip_address text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_valid_types text[] := array['marketing', 'communication', 'data_processing'];
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  if not (p_consent_type = any(v_valid_types)) then
    return jsonb_build_object('success', false, 'error', 'Invalid consent type. Must be marketing, communication, or data_processing');
  end if;

  insert into public.guest_consent_log (lodge_id, customer_id, consent_type, granted, ip_address)
  values (p_lodge_id, p_customer_id, p_consent_type, coalesce(p_granted, false), nullif(btrim(coalesce(p_ip_address, '')), ''));

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: search guests CRM
create or replace function public.search_guests_crm(
  p_lodge_id uuid,
  p_search text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_results jsonb;
  v_search_term text := '%' || coalesce(nullif(btrim(p_search), ''), '') || '%';
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  if nullif(btrim(p_search), '') is null then
    return jsonb_build_object('success', true, 'results', '[]'::jsonb);
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'customer_id', c.id,
      'name', c.name,
      'email', c.email,
      'phone', c.phone,
      'vip_level', coalesce(p.vip_level, 'standard'),
      'blacklisted', coalesce(p.blacklisted, false),
      'watchlisted', coalesce(p.watchlisted, false),
      'stay_count', coalesce(p.stay_count, 0),
      'lifetime_value', coalesce(p.lifetime_value, 0),
      'preferences', coalesce(p.preferences, '{}'::jsonb)
    ) order by c.name
  ) into v_results
    from public.customers c
    left join public.guest_crm_profiles p on p.customer_id = c.id and p.lodge_id = c.lodge_id
   where c.lodge_id = p_lodge_id
     and (c.name ilike v_search_term or c.email ilike v_search_term or c.phone ilike v_search_term)
   limit 50;

  return jsonb_build_object('success', true, 'results', coalesce(v_results, '[]'::jsonb));
end;
$$;

-- RPC: get VIP list
create or replace function public.get_vip_list(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_results jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  select jsonb_agg(
    jsonb_build_object(
      'customer_id', p.customer_id,
      'name', c.name,
      'email', c.email,
      'phone', c.phone,
      'vip_level', p.vip_level,
      'vip_approved_by', p.vip_approved_by,
      'stay_count', p.stay_count,
      'lifetime_value', p.lifetime_value,
      'preferences', p.preferences
    ) order by
      case p.vip_level
        when 'platinum' then 1
        when 'gold' then 2
        when 'silver' then 3
        else 4
      end,
      c.name
  ) into v_results
    from public.guest_crm_profiles p
    join public.customers c on c.id = p.customer_id
   where p.lodge_id = p_lodge_id
     and p.vip_level in ('silver', 'gold', 'platinum')
     and p.blacklisted = false;

  return jsonb_build_object('success', true, 'vip_list', coalesce(v_results, '[]'::jsonb));
end;
$$;

revoke all on function public.get_guest_crm_profile(uuid, uuid) from public;
revoke all on function public.update_guest_crm_profile(uuid, uuid, jsonb) from public;
revoke all on function public.set_vip_level(uuid, uuid, text, uuid) from public;
revoke all on function public.add_guest_preference(uuid, uuid, text, text) from public;
revoke all on function public.set_blacklist_status(uuid, uuid, boolean, text) from public;
revoke all on function public.get_guest_stay_history(uuid, uuid) from public;
revoke all on function public.record_guest_consent(uuid, uuid, text, boolean, text) from public;
revoke all on function public.search_guests_crm(uuid, text) from public;
revoke all on function public.get_vip_list(uuid) from public;

grant execute on function public.get_guest_crm_profile(uuid, uuid) to authenticated, service_role;
grant execute on function public.update_guest_crm_profile(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_vip_level(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.add_guest_preference(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.set_blacklist_status(uuid, uuid, boolean, text) to authenticated, service_role;
grant execute on function public.get_guest_stay_history(uuid, uuid) to authenticated, service_role;
grant execute on function public.record_guest_consent(uuid, uuid, text, boolean, text) to authenticated, service_role;
grant execute on function public.search_guests_crm(uuid, text) to authenticated, service_role;
grant execute on function public.get_vip_list(uuid) to authenticated, service_role;
