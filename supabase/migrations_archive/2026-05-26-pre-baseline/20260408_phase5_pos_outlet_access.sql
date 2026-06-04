-- Phase 5: POS roles, outlet access, and permission hardening
-- ─────────────────────────────────────────────────────────────────────────────
-- Goals:
--   1. Add allowed_outlet_ids to users table — controls which POS outlets a
--      cashier or supervisor can access. Empty array = no access for restricted
--      roles. Full-access roles (manager/admin) ignore this field entirely.
--   2. Add get_user_outlet_access RPC — safe read-only fetch called after login
--      to populate the in-memory user object without touching the auth contract.
--   3. Update create_user and update_user_profile to accept allowed_outlet_ids.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─── 1. Add allowed_outlet_ids column ─────────────────────────────────────────

alter table public.users
  add column if not exists allowed_outlet_ids uuid[] not null default '{}';

-- ─── 2. get_user_outlet_access — read-only, security definer ──────────────────
-- Called after successful login to get POS outlet access without changing the
-- authenticate_user contract. Returns empty array if user not found.

create or replace function public.get_user_outlet_access(
  p_user_id  uuid,
  p_lodge_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'allowed_outlet_ids',
    coalesce(
      (select allowed_outlet_ids
         from public.users
        where id = p_user_id
          and lodge_id = p_lodge_id),
      '{}'::uuid[]
    )
  );
$$;

revoke all on function public.get_user_outlet_access(uuid, uuid) from public;
grant execute on function public.get_user_outlet_access(uuid, uuid) to anon, authenticated;

-- ─── 3. Update create_user to accept allowed_outlet_ids ───────────────────────

create or replace function public.create_user(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id   uuid;
  v_email text;
  v_outlet_ids uuid[];
begin
  v_email := lower(btrim(coalesce(payload->>'email', '')));

  if exists (
    select 1
    from public.users
    where lodge_id = (payload->>'lodge_id')::uuid
      and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists in this lodge.', v_email));
  end if;

  -- Parse allowed_outlet_ids from JSON array of UUID strings
  select coalesce(
    array_agg(elem::uuid),
    '{}'::uuid[]
  )
  into v_outlet_ids
  from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;

  insert into public.users (
    id,
    lodge_id,
    name,
    email,
    password_hash,
    role,
    allowed_outlet_ids
  ) values (
    (payload->>'id')::uuid,
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    v_email,
    payload->>'password_hash',
    coalesce(payload->>'role', 'receptionist'),
    v_outlet_ids
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_user(jsonb) to anon, authenticated;

-- ─── 4. Update update_user_profile to accept allowed_outlet_ids ───────────────

create or replace function public.update_user_profile(
  p_id       uuid,
  p_lodge_id uuid,
  payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated    uuid;
  v_email      text;
  v_outlet_ids uuid[];
begin
  if payload ? 'email' then
    v_email := lower(btrim(coalesce(payload->>'email', '')));
    if exists (
      select 1 from public.users
      where lodge_id = p_lodge_id
        and lower(btrim(email)) = v_email
        and id <> p_id
    ) then
      return jsonb_build_object('success', false, 'error', format('A user with the email "%s" already exists.', v_email));
    end if;
  end if;

  update public.users
     set name  = coalesce(nullif(payload->>'name',  ''), name),
         email = coalesce(v_email, email),
         role  = coalesce(nullif(payload->>'role',  ''), role)
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  -- Update allowed_outlet_ids if provided in payload
  if payload ? 'allowed_outlet_ids' then
    select coalesce(
      array_agg(elem::uuid),
      '{}'::uuid[]
    )
    into v_outlet_ids
    from jsonb_array_elements_text(payload->'allowed_outlet_ids') as elem;

    update public.users
       set allowed_outlet_ids = v_outlet_ids
     where id = p_id
       and lodge_id = p_lodge_id;
  end if;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'User not found.');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_user_profile(uuid, uuid, jsonb) to anon, authenticated;

commit;
