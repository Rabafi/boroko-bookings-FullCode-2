begin;

alter table public.users
add column if not exists auth_user_id uuid;

create index if not exists users_auth_user_id_idx
on public.users (auth_user_id)
where auth_user_id is not null;

create unique index if not exists users_lodge_auth_user_uidx
on public.users (lodge_id, auth_user_id)
where auth_user_id is not null;

create or replace function public.app_authenticated_user_id()
returns uuid
language sql
stable
as $function$
  select auth.uid();
$function$;

create or replace function public.app_authenticated_email()
returns text
language sql
stable
as $function$
  select lower(btrim(coalesce(auth.jwt()->>'email', '')));
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
  v_auth_user_id uuid := public.app_authenticated_user_id();
  v_email text := public.app_authenticated_email();
  v_user public.users;
begin
  if v_auth_user_id is null then
    return query
    select
      2,
      false,
      false,
      null::uuid,
      ''::text,
      v_email,
      null::text,
      p_lodge_id,
      null::timestamptz,
      null::text,
      null::timestamptz;
    return;
  end if;

  select u.*
    into v_user
  from public.users u
  where u.lodge_id = p_lodge_id
    and (
      u.auth_user_id = v_auth_user_id
      or (
        u.auth_user_id is null
        and lower(btrim(u.email)) = v_email
      )
    )
  order by case when u.auth_user_id = v_auth_user_id then 0 else 1 end
  limit 1;

  if v_user.id is null then
    return query
    select
      2,
      false,
      false,
      null::uuid,
      ''::text,
      v_email,
      null::text,
      p_lodge_id,
      null::timestamptz,
      null::text,
      null::timestamptz;
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
    v_user.lodge_id,
    v_user.created_at,
    issued.session_token,
    issued.session_expires_at
  from public.issue_app_session(
    v_user.id,
    v_user.lodge_id,
    v_user.role,
    coalesce(nullif(lower(btrim(p_session_type)), ''), 'desktop'),
    jsonb_build_object('email', lower(btrim(v_user.email)), 'auth_user_id', v_auth_user_id)
  ) as issued(session_token, session_expires_at);
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
        or (
          u.auth_user_id is null
          and lower(btrim(u.email)) = v_email
        )
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
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
      and (
        u.auth_user_id = v_auth_user_id
        or (
          u.auth_user_id is null
          and lower(btrim(u.email)) = v_email
        )
      )
  )
  select
    2,
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
      jsonb_build_object('email', c.email, 'auth_user_id', v_auth_user_id)
    ) as issued_row(session_token, session_expires_at)
    where c.pwa_enabled = true
      and c.pwa_feature_enabled = true
      and (v_match_count = 1 or p_lodge_id is not null)
  ) issued on true
  order by c.lodge_display_name;
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
  v_auth_user_id uuid := nullif(payload->>'auth_user_id', '')::uuid;
  v_pwa_enabled boolean := coalesce((payload->>'pwa_enabled')::boolean, false);
  v_pwa_password_hash text := nullif(payload->>'pwa_password_hash', '');
  v_pwa_disabled_reason text := nullif(payload->>'pwa_disabled_reason', '');
  v_pwa_password_reset_by uuid := nullif(payload->>'pwa_password_reset_by', '')::uuid;
begin
  if exists (
    select 1
      from public.users
     where id = (payload->>'id')::uuid
       and lodge_id = v_lodge_id
  ) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  if exists (
    select 1
      from public.users
     where lodge_id = v_lodge_id
  ) then
    perform public.app_require_lodge_role(v_lodge_id, array['admin', 'manager', 'super_admin']);
  end if;

  v_email := lower(btrim(coalesce(payload->>'email', '')));

  if exists (
    select 1
      from public.users
     where lodge_id = v_lodge_id
       and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object(
      'success', false,
      'error', format('A user with the email "%s" already exists in this lodge.', v_email)
    );
  end if;

  if v_auth_user_id is not null and exists (
    select 1
      from public.users
     where lodge_id = v_lodge_id
       and auth_user_id = v_auth_user_id
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'That Supabase Auth account is already linked to a user in this lodge.'
    );
  end if;

  select coalesce(array_agg(elem::uuid), '{}'::uuid[])
    into v_outlet_ids
    from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;

  if v_role in ('cashier', 'supervisor') and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Cashier and supervisor roles require at least one outlet assignment.'
    );
  end if;

  if v_pwa_enabled and not public._is_pwa_role_eligible(v_role) then
    return jsonb_build_object(
      'success', false,
      'error', 'Only Manager and Admin roles can receive Manager PWA access.'
    );
  end if;

  insert into public.users (
    id,
    auth_user_id,
    lodge_id,
    name,
    email,
    password_hash,
    role,
    allowed_outlet_ids,
    pin_hash,
    pwa_enabled,
    pwa_password_hash,
    pwa_password_set_at,
    pwa_password_reset_by,
    pwa_disabled_reason
  ) values (
    (payload->>'id')::uuid,
    v_auth_user_id,
    v_lodge_id,
    payload->>'name',
    v_email,
    payload->>'password_hash',
    v_role,
    v_outlet_ids,
    nullif(payload->>'pin_hash', ''),
    v_pwa_enabled,
    v_pwa_password_hash,
    case when v_pwa_password_hash is not null then now() else null end,
    case when v_pwa_password_hash is not null then v_pwa_password_reset_by else null end,
    case
      when v_pwa_enabled then null
      else coalesce(v_pwa_disabled_reason, 'Manager PWA access has been turned off.')
    end
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'auth_user_id', v_auth_user_id);
end;
$function$;

revoke all on function public.authenticate_user_from_supabase(uuid, text) from public;
grant execute on function public.authenticate_user_from_supabase(uuid, text) to authenticated;

revoke all on function public.authenticate_manager_from_supabase(uuid) from public;
grant execute on function public.authenticate_manager_from_supabase(uuid) to authenticated;

revoke all on function public.create_user(jsonb) from public;
grant execute on function public.create_user(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
