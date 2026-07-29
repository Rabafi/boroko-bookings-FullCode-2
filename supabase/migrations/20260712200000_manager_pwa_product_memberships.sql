-- Manager PWA product-aware memberships:
-- 1) Server derives authoritative product_family from locked company settings.
-- 2) List memberships without minting app sessions.
-- 3) Issue a lodge-scoped PWA session only after an explicit company choice.
-- Product boundary: motel -> lodge-camp; restaurant/pos_only -> hospitality-pos;
-- hotel/resort -> hotel.

create or replace function public.normalize_settings_property_type(p_property_type text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_property_type, '')))
    when 'pos_only' then 'restaurant'
    when 'campsite' then 'camp'
    when 'camping' then 'camp'
    when 'guesthouse' then 'guest_house'
    when 'guest house' then 'guest_house'
    when 'bed_and_breakfast' then 'bnb'
    when 'bed & breakfast' then 'bnb'
    when 'apartment-hotel' then 'apartment_hotel'
    when 'serviced apartments' then 'serviced_apartments'
    when '' then 'lodge'
    else lower(btrim(p_property_type))
  end;
$$;

create or replace function public.resolve_product_family(p_property_type text)
returns text
language sql
immutable
as $$
  select case public.normalize_settings_property_type(p_property_type)
    when 'restaurant' then 'hospitality-pos'
    when 'hotel' then 'hotel'
    when 'resort' then 'hotel'
    -- motel remains Lodge & Camp (desktop product boundary), not Hotel.
    when 'motel' then 'lodge-camp'
    when 'guest_house' then 'lodge-camp'
    when 'bnb' then 'lodge-camp'
    when 'lodge' then 'lodge-camp'
    when 'camp' then 'lodge-camp'
    when 'apartment_hotel' then 'hotel'
    when 'hostel' then 'lodge-camp'
    when 'serviced_apartments' then 'hotel'
    else 'lodge-camp'
  end;
$$;

create or replace function public.product_family_label(p_product_family text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_product_family, '')))
    when 'lodge-camp' then 'Lodge & Camp'
    when 'hotel' then 'Hotel'
    when 'hospitality-pos' then 'Restaurant & Bar POS'
    else 'Lodge & Camp'
  end;
$$;

create or replace function public.product_family_package_label(
  p_product_family text,
  p_plan text,
  p_commercial_package_key text default null
)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(coalesce(p_commercial_package_key, '')), '') is not null
      then initcap(replace(p_commercial_package_key, '_', ' '))
    when lower(btrim(coalesce(p_plan, ''))) in ('trial', '') then 'Trial'
    when lower(btrim(coalesce(p_product_family, ''))) = 'hotel'
      and lower(btrim(coalesce(p_plan, ''))) = 'enterprise'
      then 'Hotel Core'
    else coalesce(nullif(btrim(p_plan), ''), 'Starter')
  end;
$$;

-- Desktop product memberships: same product_family rules (motel -> lodge-camp, pos_only -> hospitality-pos).
drop function if exists public.list_desktop_product_memberships(text);

create function public.list_desktop_product_memberships(p_product_id text)
returns table (
  lodge_id uuid,
  lodge_display_name text,
  property_type text,
  product_family text,
  role text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := public.app_authenticated_email();
  v_product text := lower(btrim(coalesce(p_product_id, '')));
begin
  if v_email is null then
    return;
  end if;

  if v_product not in ('lodge-camp', 'hotel', 'hospitality-pos') then
    raise exception 'Unsupported Boroko product.' using errcode = '22023';
  end if;

  return query
  select
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Unnamed company') as lodge_display_name,
    public.normalize_settings_property_type(coalesce(s.property_type, s.business_type, 'lodge')) as property_type,
    public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')) as product_family,
    lower(btrim(u.role)) as role
  from public.users u
  join public.settings s on s.lodge_id = u.lodge_id
  where lower(btrim(u.email)) = v_email
    and coalesce(u.status, 'active') = 'active'
    and coalesce(s.deleted, false) = false
    and public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')) = v_product
  order by lodge_display_name, u.lodge_id;
end;
$$;

grant execute on function public.list_desktop_product_memberships(text) to authenticated, service_role;

-- List only: never mints app sessions.
create or replace function public.list_manager_pwa_memberships()
returns table (
  contract_version integer,
  id uuid,
  name text,
  email text,
  role text,
  lodge_id uuid,
  lodge_display_name text,
  property_type text,
  product_family text,
  product_family_label text,
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
  product_id text,
  commercial_package_key text,
  package_label text,
  hospitality_mode text,
  effective_features jsonb
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_user_id uuid := public.app_authenticated_user_id();
  v_email text := public.app_authenticated_email();
begin
  if v_auth_user_id is null or v_email is null then
    return;
  end if;

  -- Reconcile auth identity for eligible manager profiles (no session mint).
  if exists (
    select 1
    from public.users target
    join public.users conflict
      on conflict.lodge_id = target.lodge_id
     and conflict.auth_user_id = v_auth_user_id
     and conflict.id <> target.id
    where lower(btrim(target.email)) = v_email
      and public._is_pwa_role_eligible(target.role)
  ) then
    raise exception 'Supabase Auth identity is already linked to another manager profile in this lodge';
  end if;

  update public.users u
     set auth_user_id = v_auth_user_id
   where lower(btrim(u.email)) = v_email
     and public._is_pwa_role_eligible(u.role)
     and u.auth_user_id is distinct from v_auth_user_id;

  return query
  select
    4 as contract_version,
    u.id,
    u.name,
    lower(btrim(u.email)) as email,
    lower(btrim(u.role)) as role,
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
    public.normalize_settings_property_type(coalesce(s.property_type, s.business_type, 'lodge')) as property_type,
    public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')) as product_family,
    public.product_family_label(
      public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge'))
    ) as product_family_label,
    coalesce(u.pwa_enabled, false) as pwa_enabled,
    u.pwa_password_set_at,
    u.pwa_disabled_reason,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
    coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
    nullif(ent.entitlement->>'product_id', '') as product_id,
    nullif(ent.entitlement->>'commercial_package_key', '') as commercial_package_key,
    public.product_family_package_label(
      public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')),
      coalesce(ent.entitlement->>'plan', 'Starter'),
      nullif(ent.entitlement->>'commercial_package_key', '')
    ) as package_label,
    case
      when public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')) = 'hospitality-pos'
        then coalesce(
          nullif(s.operating_profile->>'hospitality_mode', ''),
          'restaurant_bar'
        )
      else null
    end as hospitality_mode,
    coalesce(ent.entitlement->'effective_features', '{}'::jsonb) as effective_features
  from public.users u
  left join lateral (
    select
      settings.lodge_name,
      settings.company_name,
      settings.property_type,
      settings.business_type,
      settings.operating_profile
    from public.settings settings
    where settings.lodge_id = u.lodge_id
      and coalesce(settings.deleted, false) = false
    order by settings.updated_at desc nulls last, settings.created_at desc nulls last
    limit 1
  ) s on true
  left join lateral (
    select public.get_lodge_entitlement(u.lodge_id) as entitlement
  ) ent on true
  where public._is_pwa_role_eligible(u.role)
    and lower(btrim(u.email)) = v_email
    and u.auth_user_id = v_auth_user_id
    and coalesce(u.status, 'active') = 'active'
  order by lodge_display_name, u.lodge_id;
end;
$$;

grant execute on function public.list_manager_pwa_memberships() to authenticated, service_role;

-- Issue only after an explicit lodge/company choice. Never bulk-mints sessions.
create or replace function public.issue_manager_pwa_session(p_lodge_id uuid)
returns table (
  contract_version integer,
  authenticated boolean,
  id uuid,
  name text,
  email text,
  role text,
  lodge_id uuid,
  lodge_display_name text,
  property_type text,
  product_family text,
  product_family_label text,
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
  product_id text,
  commercial_package_key text,
  package_label text,
  hospitality_mode text,
  effective_features jsonb,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_auth_user_id uuid := public.app_authenticated_user_id();
  v_email text := public.app_authenticated_email();
begin
  if v_auth_user_id is null or v_email is null then
    return;
  end if;

  if p_lodge_id is null then
    raise exception 'A company must be selected before a manager mobile session can be issued.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.users target
    join public.users conflict
      on conflict.lodge_id = target.lodge_id
     and conflict.auth_user_id = v_auth_user_id
     and conflict.id <> target.id
    where lower(btrim(target.email)) = v_email
      and public._is_pwa_role_eligible(target.role)
      and target.lodge_id = p_lodge_id
  ) then
    raise exception 'Supabase Auth identity is already linked to another manager profile in this lodge';
  end if;

  update public.users u
     set auth_user_id = v_auth_user_id
   where lower(btrim(u.email)) = v_email
     and public._is_pwa_role_eligible(u.role)
     and u.lodge_id = p_lodge_id
     and u.auth_user_id is distinct from v_auth_user_id;

  return query
  with candidate as (
    select
      u.id,
      u.name,
      lower(btrim(u.email)) as email,
      lower(btrim(u.role)) as role,
      u.lodge_id,
      coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
      public.normalize_settings_property_type(coalesce(s.property_type, s.business_type, 'lodge')) as property_type,
      public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')) as product_family,
      public.product_family_label(
        public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge'))
      ) as product_family_label,
      coalesce(u.pwa_enabled, false) as pwa_enabled,
      u.pwa_password_set_at,
      u.pwa_disabled_reason,
      coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
      coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
      nullif(ent.entitlement->>'product_id', '') as product_id,
      nullif(ent.entitlement->>'commercial_package_key', '') as commercial_package_key,
      public.product_family_package_label(
        public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')),
        coalesce(ent.entitlement->>'plan', 'Starter'),
        nullif(ent.entitlement->>'commercial_package_key', '')
      ) as package_label,
      case
        when public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')) = 'hospitality-pos'
          then coalesce(nullif(s.operating_profile->>'hospitality_mode', ''), 'restaurant_bar')
        else null
      end as hospitality_mode,
      coalesce(ent.entitlement->'effective_features', '{}'::jsonb) as effective_features
    from public.users u
    left join lateral (
      select
        settings.lodge_name,
        settings.company_name,
        settings.property_type,
        settings.business_type,
        settings.operating_profile
      from public.settings settings
      where settings.lodge_id = u.lodge_id
        and coalesce(settings.deleted, false) = false
      order by settings.updated_at desc nulls last, settings.created_at desc nulls last
      limit 1
    ) s on true
    left join lateral (
      select public.get_lodge_entitlement(u.lodge_id) as entitlement
    ) ent on true
    where public._is_pwa_role_eligible(u.role)
      and lower(btrim(u.email)) = v_email
      and u.auth_user_id = v_auth_user_id
      and u.lodge_id = p_lodge_id
      and coalesce(u.status, 'active') = 'active'
    limit 1
  )
  select
    4,
    issued.session_token is not null,
    c.id,
    c.name,
    c.email,
    c.role,
    c.lodge_id,
    c.lodge_display_name,
    c.property_type,
    c.product_family,
    c.product_family_label,
    c.pwa_enabled,
    c.pwa_password_set_at,
    c.pwa_disabled_reason,
    c.pwa_feature_enabled,
    c.pwa_plan,
    c.product_id,
    c.commercial_package_key,
    c.package_label,
    c.hospitality_mode,
    c.effective_features,
    issued.session_token,
    issued.session_expires_at
  from candidate c
  left join lateral (
    select issued_row.session_token, issued_row.session_expires_at
    from public.issue_app_session(
      c.id,
      c.lodge_id,
      c.role,
      'pwa',
      jsonb_build_object(
        'email', c.email,
        'auth_user_id', v_auth_user_id,
        'auth_link_reconciled', true,
        'product_family', c.product_family,
        'property_type', c.property_type
      )
    ) as issued_row(session_token, session_expires_at)
    where c.pwa_enabled = true
      and c.pwa_feature_enabled = true
  ) issued on true;
end;
$$;

grant execute on function public.issue_manager_pwa_session(uuid) to authenticated, service_role;

-- Compatibility path: never bulk-mint sessions. Without a lodge id, return
-- membership candidates with null session tokens. With a lodge id, issue one.
drop function if exists public.authenticate_manager_from_supabase(uuid);

create function public.authenticate_manager_from_supabase(
  p_lodge_id uuid default null
)
returns table (
  contract_version integer,
  authenticated boolean,
  id uuid,
  name text,
  email text,
  role text,
  lodge_id uuid,
  lodge_display_name text,
  property_type text,
  product_family text,
  product_family_label text,
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
  product_id text,
  commercial_package_key text,
  package_label text,
  hospitality_mode text,
  effective_features jsonb,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
begin
  if p_lodge_id is null then
    return query
    select
      m.contract_version,
      false as authenticated,
      m.id,
      m.name,
      m.email,
      m.role,
      m.lodge_id,
      m.lodge_display_name,
      m.property_type,
      m.product_family,
      m.product_family_label,
      m.pwa_enabled,
      m.pwa_password_set_at,
      m.pwa_disabled_reason,
      m.pwa_feature_enabled,
      m.pwa_plan,
      m.product_id,
      m.commercial_package_key,
      m.package_label,
      m.hospitality_mode,
      m.effective_features,
      null::text as session_token,
      null::timestamptz as session_expires_at
    from public.list_manager_pwa_memberships() m;
    return;
  end if;

  return query
  select
    i.contract_version,
    i.authenticated,
    i.id,
    i.name,
    i.email,
    i.role,
    i.lodge_id,
    i.lodge_display_name,
    i.property_type,
    i.product_family,
    i.product_family_label,
    i.pwa_enabled,
    i.pwa_password_set_at,
    i.pwa_disabled_reason,
    i.pwa_feature_enabled,
    i.pwa_plan,
    i.product_id,
    i.commercial_package_key,
    i.package_label,
    i.hospitality_mode,
    i.effective_features,
    i.session_token,
    i.session_expires_at
  from public.issue_manager_pwa_session(p_lodge_id) i;
end;
$$;

grant execute on function public.authenticate_manager_from_supabase(uuid)
to authenticated, service_role;

-- Refresh returns the same authoritative product identity fields as issue.
drop function if exists public.refresh_pwa_app_session(text);

create function public.refresh_pwa_app_session(p_session_token text default null::text)
returns table (
  contract_version integer,
  authenticated boolean,
  session_type text,
  id uuid,
  name text,
  email text,
  role text,
  lodge_id uuid,
  lodge_display_name text,
  property_type text,
  product_family text,
  product_family_label text,
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
  product_id text,
  commercial_package_key text,
  package_label text,
  hospitality_mode text,
  effective_features jsonb,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text := public.app_request_session_token(p_session_token);
  v_session public.app_sessions%rowtype;
  v_expires_at timestamptz;
begin
  if v_token is null then
    return;
  end if;

  select s.*
    into v_session
    from public.app_sessions s
    join public.users u
      on u.id = s.user_id
     and u.lodge_id = s.lodge_id
    left join lateral (
      select public.get_lodge_entitlement(s.lodge_id) as entitlement
    ) ent on true
   where s.token_hash = public.app_hash_token(v_token)
     and s.revoked_at is null
     and s.session_type = 'pwa'
     and s.created_at > now() - interval '14 days'
     and public._is_pwa_role_eligible(u.role)
     and coalesce(u.pwa_enabled, false) = true
     and coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) = true
   limit 1;

  if v_session.id is null then
    return;
  end if;

  v_expires_at := now() + public.app_session_ttl('pwa');

  update public.app_sessions
     set expires_at = v_expires_at,
         last_seen_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('trusted_device_refreshed_at', now())
   where app_sessions.id = v_session.id;

  return query
  select
    4 as contract_version,
    true as authenticated,
    'pwa'::text as session_type,
    u.id,
    u.name,
    lower(btrim(u.email)) as email,
    lower(btrim(u.role)) as role,
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
    public.normalize_settings_property_type(coalesce(s.property_type, s.business_type, 'lodge')) as property_type,
    public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')) as product_family,
    public.product_family_label(
      public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge'))
    ) as product_family_label,
    coalesce(u.pwa_enabled, false) as pwa_enabled,
    u.pwa_password_set_at,
    u.pwa_disabled_reason,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
    coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
    nullif(ent.entitlement->>'product_id', '') as product_id,
    nullif(ent.entitlement->>'commercial_package_key', '') as commercial_package_key,
    public.product_family_package_label(
      public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')),
      coalesce(ent.entitlement->>'plan', 'Starter'),
      nullif(ent.entitlement->>'commercial_package_key', '')
    ) as package_label,
    case
      when public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')) = 'hospitality-pos'
        then coalesce(nullif(s.operating_profile->>'hospitality_mode', ''), 'restaurant_bar')
      else null
    end as hospitality_mode,
    coalesce(ent.entitlement->'effective_features', '{}'::jsonb) as effective_features,
    v_token as session_token,
    v_expires_at as session_expires_at
  from public.users u
  left join lateral (
    select
      settings.lodge_name,
      settings.company_name,
      settings.property_type,
      settings.business_type,
      settings.operating_profile
    from public.settings settings
    where settings.lodge_id = u.lodge_id
      and coalesce(settings.deleted, false) = false
    order by settings.updated_at desc nulls last, settings.created_at desc nulls last
    limit 1
  ) s on true
  left join lateral (
    select public.get_lodge_entitlement(u.lodge_id) as entitlement
  ) ent on true
  where u.id = v_session.user_id
    and u.lodge_id = v_session.lodge_id
  limit 1;
end;
$$;

grant execute on function public.refresh_pwa_app_session(text) to anon, authenticated, service_role;
