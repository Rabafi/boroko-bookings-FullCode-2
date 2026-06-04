begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  token_hash text not null unique,
  session_type text not null check (session_type in ('desktop', 'pwa')),
  user_id uuid not null references public.users(id) on delete cascade,
  lodge_id uuid not null,
  role text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists app_sessions_user_idx
on public.app_sessions (user_id, lodge_id, session_type)
where revoked_at is null;

create index if not exists app_sessions_lodge_idx
on public.app_sessions (lodge_id, session_type)
where revoked_at is null;

create or replace function public.app_request_headers()
returns jsonb
language plpgsql
stable
as $function$
declare
  v_headers text;
begin
  v_headers := current_setting('request.headers', true);
  if v_headers is null or btrim(v_headers) = '' then
    return '{}'::jsonb;
  end if;
  return v_headers::jsonb;
exception
  when others then
    return '{}'::jsonb;
end;
$function$;

create or replace function public.app_request_role()
returns text
language sql
stable
as $function$
  select lower(
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('role', true), ''),
      ''
    )
  );
$function$;

create or replace function public.app_is_service_role()
returns boolean
language sql
stable
as $function$
  select public.app_request_role() in ('service_role', 'supabase_admin', 'postgres');
$function$;

create or replace function public.app_session_ttl(p_session_type text)
returns interval
language sql
immutable
as $function$
  select case
    when lower(coalesce(btrim(p_session_type), '')) = 'pwa' then interval '12 hours'
    else interval '7 days'
  end;
$function$;

create or replace function public.app_hash_token(p_token text)
returns text
language sql
immutable
as $function$
  select case
    when nullif(btrim(coalesce(p_token, '')), '') is null then null
    else encode(extensions.digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'), 'hex')
  end;
$function$;

create or replace function public.app_request_session_token(p_token text default null)
returns text
language sql
stable
as $function$
  select nullif(
    btrim(
      coalesce(
        nullif(p_token, ''),
        public.app_request_headers()->>'x-boroko-session',
        public.app_request_headers()->>'x-boroko-session-token',
        public.app_request_headers()->>'x_boroko_session',
        ''
      )
    ),
    ''
  );
$function$;

create or replace function public.issue_app_session(
  p_user_id uuid,
  p_lodge_id uuid,
  p_role text,
  p_session_type text default 'desktop',
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_token text;
  v_session_type text := lower(coalesce(nullif(btrim(p_session_type), ''), 'desktop'));
  v_expires_at timestamptz := now() + public.app_session_ttl(v_session_type);
begin
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.app_sessions (
    token_hash,
    session_type,
    user_id,
    lodge_id,
    role,
    expires_at,
    metadata
  ) values (
    public.app_hash_token(v_token),
    v_session_type,
    p_user_id,
    p_lodge_id,
    lower(coalesce(btrim(p_role), 'receptionist')),
    v_expires_at,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return query
  select v_token, v_expires_at;
end;
$function$;

create or replace function public.app_current_session_row(p_token text default null)
returns public.app_sessions
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_token text := public.app_request_session_token(p_token);
  v_session public.app_sessions;
begin
  if v_token is null then
    return null;
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
    and s.expires_at > now()
    and (
      s.session_type <> 'pwa'
      or (
        public._is_pwa_role_eligible(u.role)
        and coalesce(u.pwa_enabled, false) = true
        and coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) = true
      )
    )
  limit 1;

  if v_session.id is not null then
    update public.app_sessions
    set last_seen_at = now()
    where id = v_session.id
      and last_seen_at < now() - interval '5 minutes';
  end if;

  return v_session;
end;
$function$;

create or replace function public.app_current_user_id(p_token text default null)
returns uuid
language sql
volatile
security definer
set search_path = public
as $function$
  select (public.app_current_session_row(p_token)).user_id;
$function$;

create or replace function public.app_current_lodge_id(p_token text default null)
returns uuid
language sql
volatile
security definer
set search_path = public
as $function$
  select (public.app_current_session_row(p_token)).lodge_id;
$function$;

create or replace function public.app_current_role(p_token text default null)
returns text
language sql
volatile
security definer
set search_path = public
as $function$
  select (public.app_current_session_row(p_token)).role;
$function$;

create or replace function public.app_lodge_access(p_lodge_id uuid, p_token text default null)
returns boolean
language sql
volatile
security definer
set search_path = public
as $function$
  select public.app_is_service_role()
      or (
        p_lodge_id is not null
        and public.app_current_lodge_id(p_token) = p_lodge_id
      );
$function$;

create or replace function public.app_require_lodge_role(
  p_lodge_id uuid,
  p_allowed_roles text[] default array['admin']
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_role text := lower(coalesce(public.app_current_role(), ''));
begin
  if public.app_is_service_role() then
    return;
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied for this lodge.'
      using errcode = '42501';
  end if;

  if coalesce(array_length(p_allowed_roles, 1), 0) = 0 then
    return;
  end if;

  if not (v_role = any(select lower(value) from unnest(p_allowed_roles) as value)) then
    raise exception 'This session is not allowed to perform that action.'
      using errcode = '42501';
  end if;
end;
$function$;

create or replace function public.get_lodge_auth_context(
  p_lodge_id uuid
)
returns table (
  contract_version integer,
  lodge_id uuid,
  lodge_display_name text,
  deleted boolean,
  pwa_feature_enabled boolean,
  pwa_plan text
)
language plpgsql
volatile
security definer
set search_path = public
as $function$
begin
  return query
  select
    2 as contract_version,
    p_lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
    coalesce(s.deleted, false) as deleted,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
    coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan
  from lateral (
    select settings.lodge_name, settings.company_name, settings.deleted
    from public.settings settings
    where settings.lodge_id = p_lodge_id
    order by settings.updated_at desc nulls last, settings.created_at desc nulls last
    limit 1
  ) s
  left join lateral (
    select public.get_lodge_entitlement(p_lodge_id) as entitlement
  ) ent on true;
end;
$function$;

drop function if exists public.authenticate_user(text, uuid);
drop function if exists public.authenticate_user(text, uuid, text, text);

create or replace function public.authenticate_user(
  p_email text,
  p_lodge_id uuid,
  p_password text default null,
  p_session_type text default 'desktop'
)
returns table (
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
as $function$
declare
  v_user public.users%rowtype;
  v_password text := nullif(coalesce(p_password, ''), '');
  v_session_token text := null;
  v_session_expires_at timestamptz := null;
begin
  select *
  into v_user
  from public.users u
  where lower(btrim(u.email)) = lower(btrim(p_email))
    and u.lodge_id = p_lodge_id
  limit 1;

  if v_user.id is null then
    return query
    select
      2 as contract_version,
      false as found,
      false as authenticated,
      null::uuid,
      ''::text,
      lower(btrim(p_email)) as email,
      null::text,
      p_lodge_id,
      null::timestamptz,
      null::text,
      null::timestamptz;
    return;
  end if;

  if v_password is not null
     and nullif(coalesce(v_user.password_hash, ''), '') is not null
     and extensions.crypt(v_password, v_user.password_hash) = v_user.password_hash then
    select session_token, session_expires_at
    into v_session_token, v_session_expires_at
    from public.issue_app_session(
      v_user.id,
      v_user.lodge_id,
      v_user.role,
      p_session_type,
      jsonb_build_object('email', lower(btrim(v_user.email)))
    );
  end if;

  return query
  select
    2 as contract_version,
    true as found,
    v_session_token is not null as authenticated,
    v_user.id,
    v_user.name,
    lower(btrim(v_user.email)) as email,
    v_user.role,
    v_user.lodge_id,
    v_user.created_at,
    v_session_token,
    v_session_expires_at;
end;
$function$;

drop function if exists public.authenticate_manager(text, text);
drop function if exists public.authenticate_manager(text, text, uuid);

create or replace function public.authenticate_manager(
  p_email text,
  p_password text default null,
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
as $function$
declare
  v_match_count integer := 0;
begin
  if nullif(coalesce(p_password, ''), '') is null then
    return;
  end if;

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
      coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
      case
        when nullif(coalesce(u.pwa_password_hash, ''), '') is null then false
        else extensions.crypt(p_password, u.pwa_password_hash) = u.pwa_password_hash
      end as password_ok
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
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
  )
  select count(*)
  into v_match_count
  from candidates
  where password_ok;

  if v_match_count = 0 then
    return;
  end if;

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
      coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
      case
        when nullif(coalesce(u.pwa_password_hash, ''), '') is null then false
        else extensions.crypt(p_password, u.pwa_password_hash) = u.pwa_password_hash
      end as password_ok
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
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
  )
  select
    2 as contract_version,
    issued.session_token is not null as authenticated,
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
    select session_token, session_expires_at
    from public.issue_app_session(
      c.id,
      c.lodge_id,
      c.role,
      'pwa',
      jsonb_build_object('email', c.email)
    )
    where c.password_ok
      and c.pwa_enabled = true
      and c.pwa_feature_enabled = true
      and (v_match_count = 1 or p_lodge_id is not null)
  ) issued on true
  where c.password_ok
  order by c.lodge_display_name;
end;
$function$;

drop function if exists public.get_manager_pwa_profile(uuid, uuid);

create or replace function public.get_manager_pwa_profile(
  p_id uuid,
  p_lodge_id uuid
)
returns table (
  contract_version integer,
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
  pwa_plan text
)
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  if public.app_current_user_id() is distinct from p_id
     or public.app_current_lodge_id() is distinct from p_lodge_id then
    return;
  end if;

  return query
  select
    2 as contract_version,
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
  where u.id = p_id
    and u.lodge_id = p_lodge_id
    and public._is_pwa_role_eligible(u.role)
  limit 1;
end;
$function$;

create or replace function public.validate_app_session(
  p_session_token text default null
)
returns table (
  contract_version integer,
  session_type text,
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
  session_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_session public.app_sessions;
begin
  v_session := public.app_current_session_row(p_session_token);
  if v_session.id is null then
    return;
  end if;

  return query
  select
    2 as contract_version,
    v_session.session_type,
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
    coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
    v_session.expires_at
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
  where u.id = v_session.user_id
    and u.lodge_id = v_session.lodge_id
  limit 1;
end;
$function$;

create or replace function public.revoke_app_session(
  p_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_hash text := public.app_hash_token(public.app_request_session_token(p_session_token));
begin
  if v_hash is null then
    return jsonb_build_object('success', true, 'revoked', false);
  end if;

  update public.app_sessions
  set revoked_at = now()
  where token_hash = v_hash
    and revoked_at is null;

  return jsonb_build_object('success', true, 'revoked', found);
end;
$function$;

create or replace function public.create_user(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_email text;
  v_role text;
  v_pwa_enabled boolean := coalesce((payload->>'pwa_enabled')::boolean, false);
  v_pwa_password_hash text := nullif(btrim(coalesce(payload->>'pwa_password_hash', '')), '');
  v_pwa_disabled_reason text := nullif(btrim(coalesce(payload->>'pwa_disabled_reason', '')), '');
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
begin
  if exists (select 1 from public.users where lodge_id = v_lodge_id) then
    perform public.app_require_lodge_role(v_lodge_id, array['admin', 'manager']);
  end if;

  v_email := lower(btrim(coalesce(payload->>'email', '')));
  v_role := lower(btrim(coalesce(payload->>'role', 'receptionist')));

  if exists (
    select 1
    from public.users
    where lodge_id = v_lodge_id
      and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists in this lodge.', v_email));
  end if;

  if v_pwa_enabled and not public._is_pwa_role_eligible(v_role) then
    return jsonb_build_object('success', false, 'error', 'Only manager and admin roles can receive Manager PWA access.');
  end if;

  if v_pwa_enabled and v_pwa_password_hash is null then
    return jsonb_build_object('success', false, 'error', 'Set a separate Manager PWA password before enabling mobile access.');
  end if;

  insert into public.users (
    id,
    lodge_id,
    name,
    email,
    password_hash,
    role,
    pwa_enabled,
    pwa_password_hash,
    pwa_password_set_at,
    pwa_password_reset_by,
    pwa_disabled_reason
  ) values (
    (payload->>'id')::uuid,
    v_lodge_id,
    payload->>'name',
    v_email,
    payload->>'password_hash',
    v_role,
    v_pwa_enabled,
    v_pwa_password_hash,
    case when v_pwa_password_hash is not null then now() else null end,
    case
      when v_pwa_password_hash is not null and nullif(payload->>'pwa_password_reset_by', '') is not null
        then (payload->>'pwa_password_reset_by')::uuid
      else null
    end,
    case
      when v_pwa_enabled then null
      else coalesce(v_pwa_disabled_reason, null)
    end
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

create or replace function public.update_user_profile(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
  v_email text;
  v_role text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager']);

  if payload ? 'email' then
    v_email := lower(btrim(coalesce(payload->>'email', '')));
    if exists (
      select 1
      from public.users
      where lodge_id = p_lodge_id
        and id <> p_id
        and lower(btrim(email)) = v_email
    ) then
      return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists in this lodge.', v_email));
    end if;
  end if;

  v_role := case
    when payload ? 'role' then lower(btrim(coalesce(payload->>'role', 'receptionist')))
    else null
  end;

  update public.users
  set
    name = case when payload ? 'name' then payload->>'name' else name end,
    email = case when payload ? 'email' then v_email else email end,
    role = case when payload ? 'role' then v_role else role end,
    pwa_enabled = case
      when payload ? 'role' and not public._is_pwa_role_eligible(v_role) then false
      else pwa_enabled
    end,
    pwa_disabled_reason = case
      when payload ? 'role' and not public._is_pwa_role_eligible(v_role) then 'Role is not eligible for manager PWA access.'
      else pwa_disabled_reason
    end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

create or replace function public.set_user_password(
  p_id uuid,
  p_lodge_id uuid,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager']);

  update public.users
  set password_hash = p_password_hash
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

create or replace function public.set_user_pwa_access(
  p_id uuid,
  p_lodge_id uuid,
  p_enabled boolean,
  p_password_hash text default null,
  p_disabled_reason text default null,
  p_reset_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user public.users%rowtype;
  v_password_hash text := nullif(btrim(coalesce(p_password_hash, '')), '');
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager']);

  select *
  into v_user
  from public.users
  where id = p_id
    and lodge_id = p_lodge_id
  limit 1
  for update;

  if v_user.id is null then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  if not public._is_pwa_role_eligible(v_user.role) then
    return jsonb_build_object('success', false, 'error', 'Only manager and admin roles can receive Manager PWA access.');
  end if;

  if p_enabled and coalesce(v_password_hash, nullif(btrim(coalesce(v_user.pwa_password_hash, '')), '')) is null then
    return jsonb_build_object('success', false, 'error', 'Set a separate Manager PWA password before enabling mobile access.');
  end if;

  update public.users
  set
    pwa_enabled = p_enabled,
    pwa_password_hash = case when v_password_hash is not null then v_password_hash else pwa_password_hash end,
    pwa_password_set_at = case when v_password_hash is not null then now() else pwa_password_set_at end,
    pwa_password_reset_by = case when v_password_hash is not null then p_reset_by else pwa_password_reset_by end,
    pwa_disabled_reason = case
      when p_enabled then null
      else coalesce(nullif(btrim(coalesce(p_disabled_reason, '')), ''), 'Manager PWA access disabled.')
    end
  where id = p_id
    and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id, 'pwa_enabled', p_enabled);
end;
$function$;

create or replace function public.delete_user(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager']);

  delete from public.users
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

revoke all on table public.app_sessions from public, anon, authenticated;

revoke all on function public.issue_app_session(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.app_current_session_row(text) from public, anon, authenticated;
revoke all on function public.app_current_user_id(text) from public, anon, authenticated;
revoke all on function public.app_current_lodge_id(text) from public, anon, authenticated;
revoke all on function public.app_current_role(text) from public, anon, authenticated;
revoke all on function public.app_lodge_access(uuid, text) from public, anon, authenticated;
revoke all on function public.app_require_lodge_role(uuid, text[]) from public, anon, authenticated;
grant execute on function public.app_lodge_access(uuid, text) to anon, authenticated;

revoke all on function public.authenticate_user(text, uuid, text, text) from public;
grant execute on function public.authenticate_user(text, uuid, text, text) to anon, authenticated;

revoke all on function public.authenticate_manager(text, text, uuid) from public;
grant execute on function public.authenticate_manager(text, text, uuid) to anon, authenticated;

revoke all on function public.get_manager_pwa_profile(uuid, uuid) from public;
grant execute on function public.get_manager_pwa_profile(uuid, uuid) to anon, authenticated;

revoke all on function public.get_lodge_auth_context(uuid) from public;
grant execute on function public.get_lodge_auth_context(uuid) to anon, authenticated;

revoke all on function public.validate_app_session(text) from public;
grant execute on function public.validate_app_session(text) to anon, authenticated;

revoke all on function public.revoke_app_session(text) from public;
grant execute on function public.revoke_app_session(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
