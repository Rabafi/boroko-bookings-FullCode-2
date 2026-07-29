-- A suspended or archived staff member is still a real company membership.
-- It must reach the authoritative account-status check so the login screen can
-- tell the person how to recover, rather than incorrectly claiming that the
-- company assignment disappeared.

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
    and coalesce(s.deleted, false) = false
    and public.resolve_product_family(coalesce(s.property_type, s.business_type, 'lodge')) = v_product
  order by lodge_display_name, u.lodge_id;
end;
$$;

grant execute on function public.list_desktop_product_memberships(text) to authenticated, service_role;

drop function if exists public.authenticate_user_from_supabase(uuid, text);

create function public.authenticate_user_from_supabase(
  p_lodge_id uuid,
  p_session_type text default 'desktop'
)
returns table(
  contract_version integer,
  found boolean,
  authenticated boolean,
  id uuid,
  name text,
  email text,
  role text,
  status text,
  lodge_id uuid,
  created_at timestamptz,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := public.app_authenticated_user_id();
  v_email text := public.app_authenticated_email();
  v_user public.users%rowtype;
  v_email_match_count integer := 0;
  v_effective_lodge_id uuid := p_lodge_id;
begin
  if v_auth_user_id is null or v_email is null then
    return query
    select
      4, false, false, null::uuid, ''::text, v_email, null::text, null::text, p_lodge_id,
      null::timestamptz, null::text, null::timestamptz;
    return;
  end if;

  select count(*)
    into v_email_match_count
  from public.users u
  where u.lodge_id = v_effective_lodge_id
    and lower(btrim(u.email)) = v_email;

  if v_email_match_count = 0 then
    select count(*), (array_agg(u.lodge_id order by u.created_at, u.id))[1]
      into v_email_match_count, v_effective_lodge_id
    from public.users u
    where lower(btrim(u.email)) = v_email;
  end if;

  if v_email_match_count <> 1 then
    return query
    select
      4, false, false, null::uuid, ''::text, v_email, null::text, null::text, p_lodge_id,
      null::timestamptz, null::text, null::timestamptz;
    return;
  end if;

  select u.*
    into v_user
  from public.users u
  where u.lodge_id = v_effective_lodge_id
    and lower(btrim(u.email)) = v_email
  for update;

  if exists (
    select 1
    from public.users conflict
    where conflict.lodge_id = v_effective_lodge_id
      and conflict.auth_user_id = v_auth_user_id
      and conflict.id <> v_user.id
  ) then
    raise exception 'Supabase Auth identity is already linked to another staff profile in this lodge';
  end if;

  if v_user.auth_user_id is distinct from v_auth_user_id then
    update public.users
       set auth_user_id = v_auth_user_id
     where public.users.id = v_user.id
       and public.users.lodge_id = v_user.lodge_id;
    v_user.auth_user_id := v_auth_user_id;
  end if;

  return query
  select
    4,
    true,
    issued.session_token is not null,
    v_user.id,
    v_user.name,
    lower(btrim(v_user.email)),
    lower(btrim(v_user.role)),
    lower(btrim(coalesce(v_user.status, 'active'))),
    v_user.lodge_id,
    v_user.created_at,
    issued.session_token,
    issued.session_expires_at
  from (select 1) keep_row
  left join lateral (
    select issued_row.session_token, issued_row.session_expires_at
    from public.issue_app_session(
      v_user.id,
      v_user.lodge_id,
      v_user.role,
      coalesce(nullif(lower(btrim(p_session_type)), ''), 'desktop'),
      jsonb_build_object(
        'email', lower(btrim(v_user.email)),
        'auth_user_id', v_auth_user_id,
        'auth_link_reconciled', true
      )
    ) as issued_row(session_token, session_expires_at)
    where coalesce(v_user.status, 'active') = 'active'
  ) issued on true;
end;
$$;

grant execute on function public.authenticate_user_from_supabase(uuid, text)
to authenticated, service_role;
