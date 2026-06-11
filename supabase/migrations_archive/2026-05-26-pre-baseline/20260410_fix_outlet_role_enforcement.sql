-- supabase/migrations/20260410_fix_outlet_role_enforcement.sql
-- Fix F3: enforce minimum-outlet assignment for cashier/supervisor at RPC level.
-- create_user and update_user_profile now reject outlet-scoped roles with no outlets.
-- ─────────────────────────────────────────────────────────────────────────────
-- Why:
--   The Staff.jsx frontend blocks saving a cashier/supervisor with zero outlets,
--   but that check is renderer-only. A direct API call can store
--   allowed_outlet_ids = '{}' for a cashier, leaving the user silently locked
--   out of POS with no error at login time.
--   This adds the same rule at the RPC layer, consistent with how email
--   uniqueness is enforced: returns {success: false, error: '...'} rather than
--   RAISE EXCEPTION, so the JS caller can surface the message in the UI.
-- Changes vs 20260408_phase5_pos_outlet_access.sql:
--   create_user    — validation block added after parsing v_outlet_ids, before INSERT.
--   update_user_profile — outlet IDs parsed once at top (not inside UPDATE block);
--                         two new declare vars (v_current_role, v_current_outlets);
--                         validation block computes effective role + outlets before
--                         either UPDATE runs.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ─── create_user ──────────────────────────────────────────────────────────────

create or replace function public.create_user(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id         uuid;
  v_email      text;
  v_outlet_ids uuid[];
begin
  v_email := lower(btrim(coalesce(payload->>'email', '')));

  -- Email uniqueness check
  if exists (
    select 1
      from public.users
     where lodge_id = (payload->>'lodge_id')::uuid
       and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object(
      'success', false,
      'error',   format('A user with the email "%s" already exists in this lodge.', v_email)
    );
  end if;

  -- Parse allowed_outlet_ids from JSON array of UUID strings
  select coalesce(array_agg(elem::uuid), '{}'::uuid[])
    into v_outlet_ids
    from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;

  -- Validate: outlet-scoped roles require at least one outlet
  if lower(coalesce(payload->>'role', 'receptionist')) in ('cashier', 'supervisor')
     and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object(
      'success', false,
      'error',   'Cashier and supervisor roles require at least one outlet assignment.'
    );
  end if;

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

-- ─── update_user_profile ──────────────────────────────────────────────────────

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
  v_updated         uuid;
  v_email           text;
  v_outlet_ids      uuid[];   -- parsed once at top; reused for validation + UPDATE
  v_current_role    text;     -- current DB values; used to compute effective state
  v_current_outlets uuid[];
begin
  -- ── 1. Email uniqueness ────────────────────────────────────────────────────
  if payload ? 'email' then
    v_email := lower(btrim(coalesce(payload->>'email', '')));
    if exists (
      select 1 from public.users
       where lodge_id = p_lodge_id
         and lower(btrim(email)) = v_email
         and id <> p_id
    ) then
      return jsonb_build_object(
        'success', false,
        'error',   format('A user with the email "%s" already exists.', v_email)
      );
    end if;
  end if;

  -- ── 2. Parse outlet IDs once (reused for both validation and UPDATE) ───────
  if payload ? 'allowed_outlet_ids' then
    select coalesce(array_agg(elem::uuid), '{}'::uuid[])
      into v_outlet_ids
      from jsonb_array_elements_text(payload->'allowed_outlet_ids') as elem;
  end if;

  -- ── 3. Validate outlet requirement for outlet-scoped roles ─────────────────
  --       Compute EFFECTIVE role and outlet list after this update, then check.
  --       This covers three cases:
  --         a) role changed to cashier/supervisor — must also supply outlets
  --         b) outlets cleared on an existing cashier/supervisor — must be rejected
  --         c) both changed in one call — evaluated together
  select role, allowed_outlet_ids
    into v_current_role, v_current_outlets
    from public.users
   where id = p_id and lodge_id = p_lodge_id;

  if lower(coalesce(nullif(payload->>'role', ''), v_current_role, '')) in ('cashier', 'supervisor')
     and cardinality(coalesce(
           case when payload ? 'allowed_outlet_ids' then v_outlet_ids
                else v_current_outlets
           end,
           '{}'::uuid[]
         )) = 0 then
    return jsonb_build_object(
      'success', false,
      'error',   'Cashier and supervisor roles require at least one outlet assignment.'
    );
  end if;

  -- ── 4. Update name, email, role ────────────────────────────────────────────
  update public.users
     set name  = coalesce(nullif(payload->>'name',  ''), name),
         email = coalesce(v_email, email),
         role  = coalesce(nullif(payload->>'role',  ''), role)
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  -- ── 5. Update allowed_outlet_ids if provided ───────────────────────────────
  --       v_outlet_ids already parsed above; no second SELECT needed.
  if payload ? 'allowed_outlet_ids' then
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
