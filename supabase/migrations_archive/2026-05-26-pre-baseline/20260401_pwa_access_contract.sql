alter table public.users
add column if not exists pwa_enabled boolean not null default false,
add column if not exists pwa_password_hash text,
add column if not exists pwa_password_set_at timestamptz,
add column if not exists pwa_password_reset_by uuid,
add column if not exists pwa_disabled_reason text;

create index if not exists users_pwa_lookup_idx
on public.users (lower(btrim(email)), lodge_id, role);

create or replace function public._is_pwa_role_eligible(p_role text)
returns boolean
language sql
immutable
as $function$
  select lower(coalesce(btrim(p_role), '')) in ('manager', 'admin');
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
begin
  v_email := lower(btrim(coalesce(payload->>'email', '')));
  v_role := lower(btrim(coalesce(payload->>'role', 'receptionist')));

  if exists (
    select 1
    from public.users
    where lodge_id = (payload->>'lodge_id')::uuid
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
    (payload->>'lodge_id')::uuid,
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

grant execute on function public.create_user(jsonb) to anon, authenticated;

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

grant execute on function public.update_user_profile(uuid, uuid, jsonb) to anon, authenticated;

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

grant execute on function public.set_user_pwa_access(uuid, uuid, boolean, text, text, uuid) to anon, authenticated, service_role;

create or replace function public.authenticate_manager(
  p_email text,
  p_password text default null
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
  pwa_password_hash text,
  pwa_password_set_at timestamptz,
  pwa_disabled_reason text,
  pwa_feature_enabled boolean,
  pwa_plan text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  return query
  select
    1 as contract_version,
    u.id,
    u.name,
    lower(btrim(u.email)) as email,
    lower(btrim(u.role)) as role,
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
    coalesce(u.pwa_enabled, false) as pwa_enabled,
    u.pwa_password_hash,
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
  where lower(btrim(u.email)) = lower(btrim(p_email))
    and public._is_pwa_role_eligible(u.role)
  order by coalesce(s.lodge_name, s.company_name, u.name);
end;
$function$;

grant execute on function public.authenticate_manager(text, text) to anon, authenticated, service_role;

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
set search_path to 'public'
as $function$
begin
  return query
  select
    1 as contract_version,
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

grant execute on function public.get_manager_pwa_profile(uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
