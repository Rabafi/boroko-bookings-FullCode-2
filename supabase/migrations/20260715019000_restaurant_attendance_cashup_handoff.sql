-- Attendance measures time worked. A submitted cashier handover is sufficient
-- for the worker to clock out; supervisory review may complete afterwards.
create or replace function public.clock_out_staff(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id','')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id','')::uuid;
  v_notes text := nullif(btrim(coalesce(payload->>'notes','')), '');
  v_actor uuid := public.app_current_user_id();
  v_shift public.restaurant_shifts%rowtype;
  v_pos_shift_id uuid;
  v_cashup_status text;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);
  select * into v_shift from public.restaurant_shifts where id=v_shift_id and lodge_id=v_lodge_id and status='active' for update;
  if not found then return jsonb_build_object('success',false,'error','Active attendance shift not found. Refresh the list and try again.'); end if;
  if v_shift.staff_user_id is distinct from v_actor then
    perform public.app_require_restaurant_lodge(v_lodge_id,array['admin','manager','supervisor']);
  end if;

  select id into v_pos_shift_id from public.pos_shifts
   where lodge_id=v_lodge_id and cashier_id=v_shift.staff_user_id and status='open'
   order by opened_at desc limit 1 for key share;
  if v_pos_shift_id is not null then
    select status into v_cashup_status from public.pos_cashup_submissions
     where lodge_id=v_lodge_id and shift_id=v_pos_shift_id;
    if coalesce(v_cashup_status, '') not in ('submitted','approved') then
      return jsonb_build_object('success',false,'error','Submit My Cash-up before clocking out. A manager can review it after your attendance is closed.');
    end if;
  end if;

  update public.restaurant_shifts set clock_out=now(), status='completed', notes=coalesce(v_notes,notes), clocked_out_by=v_actor where id=v_shift_id;
  return jsonb_build_object('success',true,'cashup_pending_review',v_cashup_status='submitted');
end;
$$;

revoke all on function public.clock_out_staff(jsonb) from public;
grant execute on function public.clock_out_staff(jsonb) to authenticated, service_role;
