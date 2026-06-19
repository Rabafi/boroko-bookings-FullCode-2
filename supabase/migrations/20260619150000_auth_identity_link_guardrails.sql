-- Keep Supabase Auth identities and lodge staff profiles consistent.
-- A verified Auth email is the authority for repairing a stale auth_user_id.

create or replace function public.app_validate_staff_auth_identity()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_email text;
begin
  new.email := lower(btrim(new.email));

  if new.auth_user_id is null then
    return new;
  end if;

  select lower(btrim(au.email))
    into v_auth_email
  from auth.users au
  where au.id = new.auth_user_id;

  if v_auth_email is null then
    raise exception 'auth_user_id % does not exist in Supabase Auth', new.auth_user_id;
  end if;

  if v_auth_email is distinct from new.email then
    raise exception 'Supabase Auth identity email does not match the staff profile email';
  end if;

  return new;
end;
$$;

drop trigger if exists users_validate_auth_identity on public.users;
create trigger users_validate_auth_identity
before insert or update of auth_user_id, email
on public.users
for each row
execute function public.app_validate_staff_auth_identity();

-- Repair every unambiguous historical link before enforcing the login resolver.
with email_matches as (
  select
    u.id as user_id,
    u.lodge_id,
    au.id as auth_user_id
  from public.users u
  join auth.users au
    on lower(btrim(au.email)) = lower(btrim(u.email))
  where u.auth_user_id is distinct from au.id
    and not exists (
      select 1
      from public.users conflict
      where conflict.lodge_id = u.lodge_id
        and conflict.auth_user_id = au.id
        and conflict.id <> u.id
    )
)
update public.users u
set auth_user_id = matches.auth_user_id
from email_matches matches
where u.id = matches.user_id
  and u.lodge_id = matches.lodge_id;

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
      3, false, false, null::uuid, ''::text, v_email, null::text, p_lodge_id,
      null::timestamptz, null::text, null::timestamptz;
    return;
  end if;

  select count(*)
    into v_email_match_count
  from public.users u
  where u.lodge_id = v_effective_lodge_id
    and lower(btrim(u.email)) = v_email;

  -- A stale local lodge selection must not strand a uniquely identified account.
  if v_email_match_count = 0 then
    select count(*), (array_agg(u.lodge_id order by u.created_at, u.id))[1]
      into v_email_match_count, v_effective_lodge_id
    from public.users u
    where lower(btrim(u.email)) = v_email;
  end if;

  if v_email_match_count <> 1 then
    return query
    select
      3, false, false, null::uuid, ''::text, v_email, null::text, p_lodge_id,
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
    3,
    true,
    issued.session_token is not null,
    v_user.id,
    v_user.name,
    lower(btrim(v_user.email)),
    lower(btrim(v_user.role)),
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
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
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
begin
  if v_auth_user_id is null or v_email is null then
    return;
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
      and (p_lodge_id is null or target.lodge_id = p_lodge_id)
  ) then
    raise exception 'Supabase Auth identity is already linked to another manager profile in this lodge';
  end if;

  update public.users u
     set auth_user_id = v_auth_user_id
   where lower(btrim(u.email)) = v_email
     and public._is_pwa_role_eligible(u.role)
     and (p_lodge_id is null or u.lodge_id = p_lodge_id)
     and u.auth_user_id is distinct from v_auth_user_id;

  return query
  with candidates as (
    select
      u.id,
      u.name,
      lower(btrim(u.email)) as email,
      lower(btrim(u.role)) as role,
      u.lodge_id,
      coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
      coalesce(u.pwa_enabled, false) as pwa_enabled,
      u.pwa_password_set_at,
      u.pwa_disabled_reason,
      coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
      coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan
    from public.users u
    left join lateral (
      select settings.lodge_name, settings.company_name
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
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
  )
  select
    3,
    issued.session_token is not null,
    c.id,
    c.name,
    c.email,
    c.role,
    c.lodge_id,
    c.lodge_display_name,
    c.pwa_enabled,
    c.pwa_password_set_at,
    c.pwa_disabled_reason,
    c.pwa_feature_enabled,
    c.pwa_plan,
    issued.session_token,
    issued.session_expires_at
  from candidates c
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
        'auth_link_reconciled', true
      )
    ) as issued_row(session_token, session_expires_at)
    where c.pwa_enabled = true
      and c.pwa_feature_enabled = true
  ) issued on true
  order by c.lodge_display_name;
end;
$$;

grant execute on function public.authenticate_manager_from_supabase(uuid)
to authenticated, service_role;
