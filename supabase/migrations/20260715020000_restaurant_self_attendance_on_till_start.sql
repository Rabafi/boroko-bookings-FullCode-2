-- A service employee's Till shift is work time. Record their own attendance
-- before the Till opens so later cash-up review never distorts paid hours.
create or replace function public.clock_in_self_for_pos(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id','')::uuid;
  v_actor uuid := public.app_current_user_id();
  v_role text := lower(coalesce(nullif(btrim(payload->>'role'),''),'waiter'));
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key','')), '');
  v_shift_id uuid := gen_random_uuid();
  v_existing uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);
  if v_actor is null then return jsonb_build_object('success',false,'error','Your staff identity could not be confirmed. Sign in again before starting your Till shift.'); end if;
  if v_role not in ('waiter','cashier','kitchen','bar','manager') then v_role := 'waiter'; end if;
  select id into v_existing from public.restaurant_shifts where lodge_id=v_lodge_id and staff_user_id=v_actor and status='active' for key share;
  if found then return jsonb_build_object('success',true,'shift_id',v_existing,'already_active',true); end if;
  if v_key is null or length(v_key) < 8 then return jsonb_build_object('success',false,'error','Could not create a safe attendance record. Try starting your shift again.'); end if;
  insert into public.restaurant_shifts(id,lodge_id,staff_user_id,staff_name,role,expected_hours,status,clocked_in_by,idempotency_key)
  select v_shift_id,v_lodge_id,u.id,coalesce(nullif(btrim(u.name),''),u.email),v_role,8,'active',v_actor,v_key
    from public.users u where u.id=v_actor and u.lodge_id=v_lodge_id and coalesce(u.status,'active')='active';
  if not found then return jsonb_build_object('success',false,'error','Your active staff account could not be found for this business. Ask a manager to check Staff Management.'); end if;
  return jsonb_build_object('success',true,'shift_id',v_shift_id);
exception when unique_violation then
  select id into v_existing from public.restaurant_shifts where lodge_id=v_lodge_id and staff_user_id=v_actor and status='active';
  return jsonb_build_object('success',true,'shift_id',v_existing,'already_active',true);
end;
$$;

revoke all on function public.clock_in_self_for_pos(jsonb) from public;
grant execute on function public.clock_in_self_for_pos(jsonb) to authenticated, service_role;
