-- A shared Till may only be unlocked by a staff member who is already clocked
-- into attendance. Keep the PIN check, attendance check, Till shift creation,
-- and attendance linkage in one server-authoritative operation.
create or replace function public.activate_shared_till_operator(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_staff_id uuid := nullif(payload->>'staff_user_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_pin text := payload->>'pin';
  v_device_id text := coalesce(nullif(btrim(payload->>'device_id'), ''), 'shared-terminal');
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_actor_id uuid := public.app_current_user_id();
  v_attendance public.restaurant_shifts%rowtype;
  v_staff public.users%rowtype;
  v_open_result jsonb;
  v_pos_shift_id uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin', 'manager', 'supervisor']);

  if v_actor_id is null or not exists (
    select 1 from public.users where id = v_actor_id and lodge_id = v_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Your manager session could not be confirmed. Sign in again before unlocking Till.');
  end if;
  if v_staff_id is null or v_outlet_id is null then
    return jsonb_build_object('success', false, 'error', 'Choose a staff member and outlet before unlocking Till.');
  end if;
  if v_key is null or length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object('success', false, 'error', 'Till unlock needs a valid retry key. Close and reopen the unlock panel, then try again.');
  end if;

  select * into v_staff
    from public.users
   where id = v_staff_id
     and lodge_id = v_lodge_id
     and coalesce(status, 'active') = 'active'
   for key share;
  if not found then
    return jsonb_build_object('success', false, 'error', 'That staff member is not active for this restaurant. Refresh the team list and try again.');
  end if;
  if not public._restaurant_validate_attendance_pin(v_lodge_id, v_staff_id, v_pin, v_device_id) then
    return jsonb_build_object('success', false, 'error', 'Incorrect staff PIN.');
  end if;

  select * into v_attendance
    from public.restaurant_shifts
   where lodge_id = v_lodge_id
     and staff_user_id = v_staff_id
     and status = 'active'
   order by clock_in desc
   limit 1
   for key share;
  if not found then
    return jsonb_build_object(
      'success', false,
      'error', 'Clock in at Clock in/out before unlocking Till. Your PIN opens a Till session only after attendance has started.'
    );
  end if;

  v_open_result := public.open_pos_shift_with_id(jsonb_build_object(
    'shift_id', gen_random_uuid(),
    'lodge_id', v_lodge_id,
    'outlet_id', v_outlet_id,
    'cashier_id', v_staff_id,
    'cashier_name', coalesce(nullif(btrim(v_staff.name), ''), v_staff.email),
    'opening_float', 0,
    'create_idempotency_key', v_key
  ));
  if coalesce((v_open_result->>'success')::boolean, false) = false then
    return v_open_result;
  end if;

  v_pos_shift_id := nullif(v_open_result->'shift'->>'id', '')::uuid;
  if v_pos_shift_id is null then
    return jsonb_build_object('success', false, 'error', 'The Till shift could not be confirmed. Refresh Till and try again.');
  end if;
  update public.pos_shifts
     set attendance_shift_id = v_attendance.id
   where id = v_pos_shift_id
     and lodge_id = v_lodge_id
     and cashier_id = v_staff_id
     and status = 'open';
  if not found then
    return jsonb_build_object('success', false, 'error', 'The Till shift could not be linked to attendance. Do not take payments; refresh and try again.');
  end if;

  select to_jsonb(p) into v_open_result from public.pos_shifts p where p.id = v_pos_shift_id;
  return jsonb_build_object(
    'success', true,
    'staff', jsonb_build_object('id', v_staff.id, 'name', v_staff.name, 'email', v_staff.email),
    'attendance_shift_id', v_attendance.id,
    'shift', v_open_result
  );
end;
$$;

revoke all on function public.activate_shared_till_operator(jsonb) from public;
grant execute on function public.activate_shared_till_operator(jsonb) to authenticated, service_role;
