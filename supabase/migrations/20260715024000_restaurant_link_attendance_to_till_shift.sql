alter table public.pos_shifts add column if not exists attendance_shift_id uuid references public.restaurant_shifts(id) on delete restrict;
create index if not exists pos_shifts_attendance_shift_open_idx on public.pos_shifts(attendance_shift_id) where status='open';

create or replace function public.link_my_pos_shift_to_attendance(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid; v_pos_id uuid:=nullif(payload->>'pos_shift_id','')::uuid; v_attendance_id uuid:=nullif(payload->>'attendance_shift_id','')::uuid; v_actor uuid:=public.app_current_user_id();
begin
  perform public.app_require_restaurant_lodge(v_lodge_id,array['cashier','supervisor','manager','admin','super_admin']);
  update public.pos_shifts p set attendance_shift_id=v_attendance_id where p.id=v_pos_id and p.lodge_id=v_lodge_id and p.status='open' and p.cashier_id=v_actor and exists(select 1 from public.restaurant_shifts a where a.id=v_attendance_id and a.lodge_id=v_lodge_id and a.staff_user_id=v_actor and a.status='active');
  if not found then return jsonb_build_object('success',false,'error','Could not link this Till shift to your attendance. Do not take payments; refresh My Shift and try again.'); end if;
  return jsonb_build_object('success',true);
end; $$;

create or replace function public.clock_out_staff(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid; v_shift_id uuid:=nullif(payload->>'shift_id','')::uuid; v_notes text:=nullif(btrim(coalesce(payload->>'notes','')),''); v_actor uuid:=public.app_current_user_id(); v_shift public.restaurant_shifts%rowtype; v_pos_shift_id uuid; v_cashup_status text;
begin
 perform public.app_require_restaurant_lodge(v_lodge_id,array['cashier','supervisor','manager','admin','super_admin']);
 select * into v_shift from public.restaurant_shifts where id=v_shift_id and lodge_id=v_lodge_id and status='active' for update;
 if not found then return jsonb_build_object('success',false,'error','Active attendance shift not found. Refresh the list and try again.'); end if;
 if v_shift.staff_user_id is distinct from v_actor then perform public.app_require_restaurant_lodge(v_lodge_id,array['admin','manager','supervisor']); end if;
 select id into v_pos_shift_id from public.pos_shifts where lodge_id=v_lodge_id and attendance_shift_id=v_shift.id and status='open' order by opened_at desc limit 1 for key share;
 if v_pos_shift_id is null then select id into v_pos_shift_id from public.pos_shifts where lodge_id=v_lodge_id and cashier_id=v_shift.staff_user_id and status='open' order by opened_at desc limit 1 for key share; end if;
 if v_pos_shift_id is not null then select status into v_cashup_status from public.pos_cashup_submissions where lodge_id=v_lodge_id and shift_id=v_pos_shift_id; if coalesce(v_cashup_status,'') not in ('submitted','approved') then return jsonb_build_object('success',false,'error','Submit My Cash-up before clocking out. A manager can review it after your attendance is closed.'); end if; end if;
 update public.restaurant_shifts set clock_out=now(),status='completed',notes=coalesce(v_notes,notes),clocked_out_by=v_actor where id=v_shift_id;
 return jsonb_build_object('success',true,'cashup_pending_review',v_cashup_status='submitted');
end; $$;
revoke all on function public.link_my_pos_shift_to_attendance(jsonb) from public; grant execute on function public.link_my_pos_shift_to_attendance(jsonb) to authenticated,service_role;
