alter table public.users
  add column if not exists status text not null default 'active',
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists last_desktop_sign_in_at timestamptz,
  add column if not exists last_pwa_sign_in_at timestamptz,
  add column if not exists last_activity_at timestamptz,
  add column if not exists invite_sent_at timestamptz,
  add column if not exists password_updated_at timestamptz,
  add column if not exists capability_overrides jsonb not null default '{}'::jsonb;

update public.users
   set status = 'active'
 where coalesce(nullif(btrim(status), ''), 'active') not in ('active', 'suspended', 'archived');

alter table public.users
  drop constraint if exists users_status_check;

alter table public.users
  add constraint users_status_check
  check (status in ('active', 'suspended', 'archived'));

create or replace function public.touch_user_presence(
  p_user_id uuid,
  p_lodge_id uuid,
  p_session_type text default 'desktop',
  p_mark_sign_in boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
begin
  if public.app_current_user_id() is distinct from p_user_id then
    perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager', 'super_admin']);
  end if;

  update public.users
     set last_activity_at = v_now,
         last_sign_in_at = case when p_mark_sign_in then v_now else last_sign_in_at end,
         last_desktop_sign_in_at = case
           when p_mark_sign_in and lower(coalesce(p_session_type, 'desktop')) = 'desktop' then v_now
           else last_desktop_sign_in_at
         end,
         last_pwa_sign_in_at = case
           when p_mark_sign_in and lower(coalesce(p_session_type, 'desktop')) = 'pwa' then v_now
           else last_pwa_sign_in_at
         end
   where id = p_user_id
     and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  return jsonb_build_object('success', true, 'id', p_user_id, 'touched_at', v_now);
end;
$function$;

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
  status text,
  lodge_id uuid,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  last_desktop_sign_in_at timestamptz,
  last_pwa_sign_in_at timestamptz,
  last_activity_at timestamptz,
  invite_sent_at timestamptz,
  password_updated_at timestamptz,
  capability_overrides jsonb,
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
      2, false, false, null::uuid, ''::text, lower(btrim(p_email)), null::text, 'active'::text, p_lodge_id,
      null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz,
      null::timestamptz, null::timestamptz, '{}'::jsonb, null::text, null::timestamptz;
    return;
  end if;

  if coalesce(v_user.status, 'active') = 'active'
     and v_password is not null
     and nullif(coalesce(v_user.password_hash, ''), '') is not null
     and extensions.crypt(v_password, v_user.password_hash) = v_user.password_hash then
    select issued.session_token, issued.session_expires_at
      into v_session_token, v_session_expires_at
      from public.issue_app_session(
        v_user.id,
        v_user.lodge_id,
        v_user.role,
        p_session_type,
        jsonb_build_object('email', lower(btrim(v_user.email)))
      ) as issued(session_token, session_expires_at);
  end if;

  return query
  select
    2,
    true,
    v_session_token is not null,
    v_user.id,
    v_user.name,
    lower(btrim(v_user.email)),
    lower(btrim(v_user.role)),
    coalesce(v_user.status, 'active'),
    v_user.lodge_id,
    v_user.created_at,
    v_user.last_sign_in_at,
    v_user.last_desktop_sign_in_at,
    v_user.last_pwa_sign_in_at,
    v_user.last_activity_at,
    v_user.invite_sent_at,
    v_user.password_updated_at,
    coalesce(v_user.capability_overrides, '{}'::jsonb),
    v_session_token,
    v_session_expires_at;
end;
$function$;

create or replace function public.authenticate_user_from_supabase(
  p_lodge_id uuid,
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
  status text,
  lodge_id uuid,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  last_desktop_sign_in_at timestamptz,
  last_pwa_sign_in_at timestamptz,
  last_activity_at timestamptz,
  invite_sent_at timestamptz,
  password_updated_at timestamptz,
  capability_overrides jsonb,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_auth_user_id uuid := public.app_authenticated_user_id();
  v_email text := public.app_authenticated_email();
  v_user public.users;
begin
  if v_auth_user_id is null then
    return query
    select
      2, false, false, null::uuid, ''::text, v_email, null::text, 'active'::text, p_lodge_id,
      null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz,
      null::timestamptz, null::timestamptz, '{}'::jsonb, null::text, null::timestamptz;
    return;
  end if;

  select u.*
    into v_user
  from public.users u
  where u.lodge_id = p_lodge_id
    and (
      u.auth_user_id = v_auth_user_id
      or (u.auth_user_id is null and lower(btrim(u.email)) = v_email)
    )
  order by case when u.auth_user_id = v_auth_user_id then 0 else 1 end
  limit 1;

  if v_user.id is null then
    return query
    select
      2, false, false, null::uuid, ''::text, v_email, null::text, 'active'::text, p_lodge_id,
      null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz,
      null::timestamptz, null::timestamptz, '{}'::jsonb, null::text, null::timestamptz;
    return;
  end if;

  if v_user.auth_user_id is null then
    update public.users
       set auth_user_id = v_auth_user_id
     where public.users.id = v_user.id
       and public.users.lodge_id = v_user.lodge_id
       and public.users.auth_user_id is null;
  end if;

  return query
  select
    2,
    true,
    issued.session_token is not null,
    v_user.id,
    v_user.name,
    lower(btrim(v_user.email)),
    lower(btrim(v_user.role)),
    coalesce(v_user.status, 'active'),
    v_user.lodge_id,
    v_user.created_at,
    v_user.last_sign_in_at,
    v_user.last_desktop_sign_in_at,
    v_user.last_pwa_sign_in_at,
    v_user.last_activity_at,
    v_user.invite_sent_at,
    v_user.password_updated_at,
    coalesce(v_user.capability_overrides, '{}'::jsonb),
    issued.session_token,
    issued.session_expires_at
  from (select 1) keep_row
  left join lateral (
    select session_token, session_expires_at
    from public.issue_app_session(
      v_user.id,
      v_user.lodge_id,
      v_user.role,
      coalesce(nullif(lower(btrim(p_session_type)), ''), 'desktop'),
      jsonb_build_object('email', lower(btrim(v_user.email)), 'auth_user_id', v_auth_user_id)
    )
    where coalesce(v_user.status, 'active') = 'active'
  ) issued on true;
end;
$function$;

create or replace function public.authenticate_manager_from_supabase(
  p_lodge_id uuid default null
)
returns table (
  contract_version integer,
  authenticated boolean,
  id uuid,
  name text,
  email text,
  role text,
  status text,
  lodge_id uuid,
  lodge_display_name text,
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
  capability_overrides jsonb,
  session_token text,
  session_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_auth_user_id uuid := public.app_authenticated_user_id();
  v_email text := public.app_authenticated_email();
  v_match_count integer := 0;
begin
  if v_auth_user_id is null then
    return;
  end if;

  with candidates as (
    select u.id
    from public.users u
    where public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
      and (
        u.auth_user_id = v_auth_user_id
        or (u.auth_user_id is null and lower(btrim(u.email)) = v_email)
      )
  )
  select count(*) into v_match_count from candidates;

  update public.users u
     set auth_user_id = v_auth_user_id
   where u.auth_user_id is null
     and lower(btrim(u.email)) = v_email
     and public._is_pwa_role_eligible(u.role)
     and (p_lodge_id is null or u.lodge_id = p_lodge_id);

  return query
  with candidates as (
    select
      u.id,
      u.name,
      lower(btrim(u.email)) as email,
      lower(btrim(u.role)) as role,
      coalesce(u.status, 'active') as status,
      u.lodge_id,
      coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
      coalesce(u.pwa_enabled, false) as pwa_enabled,
      u.pwa_password_set_at,
      u.pwa_disabled_reason,
      coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
      coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
      coalesce(u.capability_overrides, '{}'::jsonb) as capability_overrides
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
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
      and (
        u.auth_user_id = v_auth_user_id
        or (u.auth_user_id is null and lower(btrim(u.email)) = v_email)
      )
  )
  select
    2,
    issued.session_token is not null,
    c.id,
    c.name,
    c.email,
    c.role,
    c.status,
    c.lodge_id,
    c.lodge_display_name,
    c.pwa_enabled,
    c.pwa_password_set_at,
    c.pwa_disabled_reason,
    c.pwa_feature_enabled,
    c.pwa_plan,
    c.capability_overrides,
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
      jsonb_build_object('email', c.email, 'auth_user_id', v_auth_user_id)
    ) as issued_row(session_token, session_expires_at)
    where c.pwa_enabled = true
      and c.pwa_feature_enabled = true
      and c.status = 'active'
      and (v_match_count = 1 or p_lodge_id is not null)
  ) issued on true
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
  status text,
  lodge_id uuid,
  lodge_display_name text,
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
  capability_overrides jsonb
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
    2,
    u.id,
    u.name,
    lower(btrim(u.email)),
    lower(btrim(u.role)),
    coalesce(u.status, 'active'),
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge'),
    coalesce(u.pwa_enabled, false),
    u.pwa_password_set_at,
    u.pwa_disabled_reason,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false),
    coalesce(ent.entitlement->>'plan', 'Starter'),
    coalesce(u.capability_overrides, '{}'::jsonb)
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
  status text,
  lodge_id uuid,
  lodge_display_name text,
  pwa_enabled boolean,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text,
  capability_overrides jsonb,
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
    2,
    v_session.session_type,
    u.id,
    u.name,
    lower(btrim(u.email)),
    lower(btrim(u.role)),
    coalesce(u.status, 'active'),
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge'),
    coalesce(u.pwa_enabled, false),
    u.pwa_password_set_at,
    u.pwa_disabled_reason,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false),
    coalesce(ent.entitlement->>'plan', 'Starter'),
    coalesce(u.capability_overrides, '{}'::jsonb),
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
    and coalesce(u.status, 'active') = 'active'
  limit 1;
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
  v_outlet_ids uuid[];
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_role text := lower(coalesce(payload->>'role', 'receptionist'));
  v_status text := lower(coalesce(payload->>'status', 'active'));
  v_auth_user_id uuid := nullif(payload->>'auth_user_id', '')::uuid;
  v_pwa_enabled boolean := coalesce((payload->>'pwa_enabled')::boolean, false);
  v_pwa_password_hash text := nullif(payload->>'pwa_password_hash', '');
  v_pwa_disabled_reason text := nullif(payload->>'pwa_disabled_reason', '');
  v_pwa_password_reset_by uuid := nullif(payload->>'pwa_password_reset_by', '')::uuid;
  v_capability_overrides jsonb := case when jsonb_typeof(payload->'capability_overrides') = 'object' then payload->'capability_overrides' else '{}'::jsonb end;
begin
  if exists (
    select 1
      from public.users
     where id = (payload->>'id')::uuid
       and lodge_id = v_lodge_id
  ) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  if exists (select 1 from public.users where lodge_id = v_lodge_id) then
    perform public.app_require_lodge_role(v_lodge_id, array['admin', 'manager', 'super_admin']);
  end if;

  if v_status not in ('active', 'suspended', 'archived') then
    return jsonb_build_object('success', false, 'error', 'Invalid staff status.');
  end if;

  v_email := lower(btrim(coalesce(payload->>'email', '')));

  if exists (
    select 1 from public.users
     where lodge_id = v_lodge_id
       and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists in this lodge.', v_email));
  end if;

  if v_auth_user_id is not null and exists (
    select 1 from public.users
     where lodge_id = v_lodge_id
       and auth_user_id = v_auth_user_id
  ) then
    return jsonb_build_object('success', false, 'error', 'That Supabase Auth account is already linked to a user in this lodge.');
  end if;

  select coalesce(array_agg(elem::uuid), '{}'::uuid[])
    into v_outlet_ids
    from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;

  if v_role in ('cashier', 'supervisor') and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object('success', false, 'error', 'Cashier and supervisor roles require at least one outlet assignment.');
  end if;

  if v_pwa_enabled and not public._is_pwa_role_eligible(v_role) then
    return jsonb_build_object('success', false, 'error', 'Only Manager and Admin roles can receive Manager PWA access.');
  end if;

  insert into public.users (
    id, auth_user_id, lodge_id, name, email, password_hash, role, status, allowed_outlet_ids, pin_hash,
    pwa_enabled, pwa_password_hash, pwa_password_set_at, pwa_password_reset_by, pwa_disabled_reason,
    invite_sent_at, password_updated_at, last_sign_in_at, last_desktop_sign_in_at, last_pwa_sign_in_at, last_activity_at, capability_overrides
  ) values (
    (payload->>'id')::uuid,
    v_auth_user_id,
    v_lodge_id,
    payload->>'name',
    v_email,
    payload->>'password_hash',
    v_role,
    v_status,
    v_outlet_ids,
    nullif(payload->>'pin_hash', ''),
    v_pwa_enabled,
    v_pwa_password_hash,
    case when v_pwa_password_hash is not null then now() else null end,
    case when v_pwa_password_hash is not null then v_pwa_password_reset_by else null end,
    case when v_pwa_enabled then null else coalesce(v_pwa_disabled_reason, 'Manager PWA access has been turned off.') end,
    null,
    now(),
    null,
    null,
    null,
    null,
    v_capability_overrides
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'auth_user_id', v_auth_user_id);
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
  v_user public.users%rowtype;
  v_updated uuid;
  v_email text;
  v_role text;
  v_status text;
  v_outlet_ids uuid[];
  v_capability_overrides jsonb;
  v_protected_admin_count integer;
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

  v_email := case when payload ? 'email' then lower(btrim(coalesce(payload->>'email', ''))) else lower(btrim(v_user.email)) end;
  v_role := case when payload ? 'role' then lower(btrim(coalesce(payload->>'role', 'receptionist'))) else lower(btrim(v_user.role)) end;
  v_status := case when payload ? 'status' then lower(btrim(coalesce(payload->>'status', 'active'))) else coalesce(v_user.status, 'active') end;
  v_capability_overrides := case when jsonb_typeof(payload->'capability_overrides') = 'object' then payload->'capability_overrides' else coalesce(v_user.capability_overrides, '{}'::jsonb) end;

  if v_status not in ('active', 'suspended', 'archived') then
    return jsonb_build_object('success', false, 'error', 'Invalid staff status.');
  end if;

  if exists (
    select 1 from public.users
     where lodge_id = p_lodge_id
       and id <> p_id
       and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists in this lodge.', v_email));
  end if;

  if public.app_current_user_id() = p_id and v_status <> 'active' then
    return jsonb_build_object('success', false, 'error', 'You cannot suspend or archive the account you are currently signed in with.');
  end if;

  if public.app_current_user_id() = p_id and v_role <> lower(btrim(v_user.role)) then
    return jsonb_build_object('success', false, 'error', 'You cannot change the role of the account you are currently signed in with.');
  end if;

  if lower(btrim(v_user.role)) = 'admin'
     and coalesce(v_user.status, 'active') in ('active', 'suspended')
     and not (v_role = 'admin' and v_status in ('active', 'suspended')) then
    select count(*)
      into v_protected_admin_count
      from public.users u
     where u.lodge_id = p_lodge_id
       and u.id <> p_id
       and lower(btrim(u.role)) = 'admin'
       and coalesce(u.status, 'active') in ('active', 'suspended');

    if v_protected_admin_count = 0 then
      return jsonb_build_object('success', false, 'error', 'You cannot remove or archive the last admin in this lodge.');
    end if;
  end if;

  if payload ? 'allowed_outlet_ids' then
    select coalesce(array_agg(elem::uuid), '{}'::uuid[])
      into v_outlet_ids
      from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;
  else
    v_outlet_ids := coalesce(v_user.allowed_outlet_ids, '{}'::uuid[]);
  end if;

  if v_role in ('cashier', 'supervisor') and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object('success', false, 'error', 'Cashier and supervisor roles require at least one outlet assignment.');
  end if;

  update public.users
     set name = case when payload ? 'name' then payload->>'name' else name end,
         email = v_email,
         role = v_role,
         status = v_status,
         allowed_outlet_ids = v_outlet_ids,
         capability_overrides = v_capability_overrides,
         pin_hash = case when payload ? 'pin_hash' then nullif(payload->>'pin_hash', '') else pin_hash end,
         pwa_enabled = case when not public._is_pwa_role_eligible(v_role) then false else pwa_enabled end,
         pwa_disabled_reason = case
           when not public._is_pwa_role_eligible(v_role) then 'Role is not eligible for manager PWA access.'
           else pwa_disabled_reason
         end
   where id = p_id
     and lodge_id = p_lodge_id
   returning id into v_updated;

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
     set password_hash = p_password_hash,
         password_updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'User not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
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
  v_user public.users%rowtype;
  v_deleted uuid;
  v_protected_admin_count integer;
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

  if public.app_current_user_id() = p_id then
    return jsonb_build_object('success', false, 'error', 'You cannot delete the account you are currently signed in with.');
  end if;

  if lower(btrim(v_user.role)) = 'admin'
     and coalesce(v_user.status, 'active') in ('active', 'suspended') then
    select count(*)
      into v_protected_admin_count
      from public.users u
     where u.lodge_id = p_lodge_id
       and u.id <> p_id
       and lower(btrim(u.role)) = 'admin'
       and coalesce(u.status, 'active') in ('active', 'suspended');
    if v_protected_admin_count = 0 then
      return jsonb_build_object('success', false, 'error', 'You cannot delete the last admin in this lodge.');
    end if;
  end if;

  delete from public.users
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.touch_user_presence(uuid, uuid, text, boolean) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
