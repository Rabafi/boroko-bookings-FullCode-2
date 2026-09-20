-- Self-service Staff PIN change for Bar/Restaurant operators.
-- Any active lodge member can change their own PIN after proving the current
-- one. Admin/manager override via update_user_profile is unchanged (that path
-- keeps its own role checks and staff_approval_pin_changed audit trigger).

create or replace function public.change_own_staff_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id','')::uuid;
  v_current_pin text := nullif(btrim(coalesce(payload->>'current_pin','')),'');
  v_new_pin text := nullif(btrim(coalesce(payload->>'new_pin','')),'');
  v_device_id text := coalesce(nullif(btrim(coalesce(payload->>'device_id','')),''),'unknown');
  v_actor uuid := public.app_current_user_id();
  v_user public.users%rowtype;
  v_locked boolean;
begin
  if v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'A business context is required.');
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['cashier','supervisor','receptionist','operations','finance','manager','admin','super_admin','bar','waiter','kitchen','bartender']);
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your session could not be confirmed. Sign in again.');
  end if;
  if v_new_pin is null or v_new_pin !~ '^[0-9]{4,6}$' then
    return jsonb_build_object('success', false, 'error', 'Staff PIN must be 4–6 digits.');
  end if;

  select * into v_user from public.users where id = v_actor and lodge_id = v_lodge_id for update;
  if v_user.id is null then
    return jsonb_build_object('success', false, 'error', 'Staff account not found.');
  end if;
  if coalesce(v_user.status,'active') <> 'active' then
    return jsonb_build_object('success', false, 'error', 'This staff account is not active. Ask an admin to reactivate it.');
  end if;

  -- Rate-limit current-PIN guesses like attendance PINs.
  select count(*) >= 5 into v_locked from public.pos_pin_attempts
    where lodge_id = v_lodge_id and staff_id = v_actor and device_id = v_device_id
      and capability = 'staff_pin.change' and succeeded = false
      and attempted_at >= now() - interval '15 minutes';
  if v_locked then
    return jsonb_build_object('success', false, 'error', 'Too many unsuccessful PIN attempts. Try again in 15 minutes.');
  end if;

  if v_user.pin_hash is not null then
    if v_current_pin is null then
      insert into public.pos_pin_attempts(lodge_id, staff_id, device_id, capability, succeeded)
        values (v_lodge_id, v_actor, v_device_id, 'staff_pin.change', false);
      return jsonb_build_object('success', false, 'error', 'Enter your current Staff PIN to set a new one. If you forgot it, ask an admin to reset it in Staff Management.');
    end if;
    if extensions.crypt(v_current_pin, v_user.pin_hash) <> v_user.pin_hash then
      insert into public.pos_pin_attempts(lodge_id, staff_id, device_id, capability, succeeded)
        values (v_lodge_id, v_actor, v_device_id, 'staff_pin.change', false);
      return jsonb_build_object('success', false, 'error', 'Incorrect current PIN. If you forgot it, ask an admin to reset it in Staff Management.');
    end if;
    if extensions.crypt(v_new_pin, v_user.pin_hash) = v_user.pin_hash then
      return jsonb_build_object('success', false, 'error', 'The new PIN must be different from the current PIN.');
    end if;
  end if;

  update public.users
    set pin_hash = extensions.crypt(v_new_pin, extensions.gen_salt('bf', 10))
    where id = v_actor and lodge_id = v_lodge_id;

  insert into public.pos_pin_attempts(lodge_id, staff_id, device_id, capability, succeeded)
    values (v_lodge_id, v_actor, v_device_id, 'staff_pin.change', true);

  return jsonb_build_object('success', true, 'id', v_actor);
end;
$$;

revoke all on function public.change_own_staff_pin(jsonb) from public;
grant execute on function public.change_own_staff_pin(jsonb) to anon, authenticated, service_role;
