-- Managers on a shared terminal need a server-authorised view of the selected
-- staff member's currently open Till shift; client table RLS is not sufficient.
create or replace function public.get_staff_open_pos_shift(p_lodge_id uuid, p_staff_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_shift public.pos_shifts%rowtype;
begin
  perform public.app_require_restaurant_lodge(p_lodge_id,array['admin','manager','supervisor']);
  if p_staff_id is null then return jsonb_build_object('success',false,'error','Choose a staff member.'); end if;
  select * into v_shift from public.pos_shifts where lodge_id=p_lodge_id and cashier_id=p_staff_id and status='open' order by opened_at desc limit 1;
  if not found then return jsonb_build_object('success',true,'shift',null); end if;
  return jsonb_build_object('success',true,'shift',jsonb_build_object('id',v_shift.id,'outlet_id',v_shift.outlet_id,'cashier_id',v_shift.cashier_id,'cashier_name',v_shift.cashier_name,'opening_float',v_shift.opening_float,'opened_at',v_shift.opened_at,'status',v_shift.status));
end;
$$;
revoke all on function public.get_staff_open_pos_shift(uuid,uuid) from public;
grant execute on function public.get_staff_open_pos_shift(uuid,uuid) to authenticated,service_role;
