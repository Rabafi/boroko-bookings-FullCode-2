-- Shared restaurant terminals: a manager operates the board, but each person
-- proves their own attendance with a private PIN. The PIN is never returned or
-- stored in the client, and each attempt is audit/rate-limit visible.
create or replace function public._restaurant_validate_attendance_pin(
  p_lodge_id uuid, p_staff_id uuid, p_pin text, p_device_id text default 'shared-terminal'
) returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_hash text; v_locked boolean; v_success boolean := false;
begin
  select count(*) >= 5 into v_locked from public.pos_pin_attempts
   where lodge_id=p_lodge_id and staff_id=p_staff_id and device_id=coalesce(nullif(btrim(p_device_id),''),'shared-terminal')
     and capability='attendance.clock' and succeeded=false and attempted_at >= now() - interval '15 minutes';
  if v_locked then raise exception 'Too many unsuccessful PIN attempts. Try again in 15 minutes.' using errcode='42501'; end if;
  select pin_hash into v_hash from public.users where id=p_staff_id and lodge_id=p_lodge_id and coalesce(status,'active')='active' for update;
  v_success := v_hash is not null and nullif(btrim(coalesce(p_pin,'')),'') is not null and extensions.crypt(p_pin,v_hash)=v_hash;
  insert into public.pos_pin_attempts(lodge_id,staff_id,device_id,capability,succeeded) values (p_lodge_id,p_staff_id,coalesce(nullif(btrim(p_device_id),''),'shared-terminal'),'attendance.clock',v_success);
  return v_success;
end;
$$;

create or replace function public.clock_in_staff_with_attendance_pin(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid; v_staff_id uuid:=nullif(payload->>'staff_user_id','')::uuid; v_pin text:=payload->>'pin'; v_actor uuid:=public.app_current_user_id(); v_result jsonb;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin','manager','supervisor']);
  if v_actor is null or not exists(select 1 from public.users where id=v_actor and lodge_id=v_lodge_id) then return jsonb_build_object('success',false,'error','Your manager session could not be confirmed. Sign in again.'); end if;
  if v_staff_id is null then return jsonb_build_object('success',false,'error','Choose a staff member from the active team.'); end if;
  if not public._restaurant_validate_attendance_pin(v_lodge_id,v_staff_id,v_pin,coalesce(payload->>'device_id','shared-terminal')) then return jsonb_build_object('success',false,'error','Incorrect staff PIN.'); end if;
  v_result := public.clock_in_staff(jsonb_build_object('lodge_id',v_lodge_id,'staff_user_id',v_staff_id,'role',payload->>'role','expected_hours',payload->>'expected_hours','idempotency_key',payload->>'idempotency_key'));
  return v_result;
end;
$$;

create or replace function public.clock_out_staff_with_attendance_pin(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid; v_shift_id uuid:=nullif(payload->>'shift_id','')::uuid; v_pin text:=payload->>'pin'; v_actor uuid:=public.app_current_user_id(); v_shift public.restaurant_shifts%rowtype; v_result jsonb;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin','manager','supervisor']);
  select * into v_shift from public.restaurant_shifts where id=v_shift_id and lodge_id=v_lodge_id and status='active' for update;
  if not found then return jsonb_build_object('success',false,'error','Active attendance shift not found. Refresh and try again.'); end if;
  if not public._restaurant_validate_attendance_pin(v_lodge_id,v_shift.staff_user_id,v_pin,coalesce(payload->>'device_id','shared-terminal')) then return jsonb_build_object('success',false,'error','Incorrect staff PIN.'); end if;
  v_result := public.clock_out_staff(jsonb_build_object('lodge_id',v_lodge_id,'shift_id',v_shift_id,'notes',payload->>'notes'));
  return v_result;
end;
$$;

create or replace function public.clock_out_staff(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid; v_shift_id uuid:=nullif(payload->>'shift_id','')::uuid; v_notes text:=nullif(btrim(coalesce(payload->>'notes','')),''); v_actor uuid:=public.app_current_user_id(); v_shift public.restaurant_shifts%rowtype;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id,array['cashier','supervisor','manager','admin','super_admin']);
  select * into v_shift from public.restaurant_shifts where id=v_shift_id and lodge_id=v_lodge_id and status='active' for update;
  if not found then return jsonb_build_object('success',false,'error','Active attendance shift not found. Refresh the list and try again.'); end if;
  if v_shift.staff_user_id is distinct from v_actor then perform public.app_require_restaurant_lodge(v_lodge_id,array['admin','manager','supervisor']); end if;
  update public.restaurant_shifts set clock_out=now(), status='completed', notes=coalesce(v_notes,notes), clocked_out_by=v_actor where id=v_shift_id;
  return jsonb_build_object('success',true);
end;
$$;

create or replace function public.get_active_shifts(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.app_require_lodge_role(p_lodge_id,array['cashier','supervisor','manager','admin','super_admin']);
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'staff_user_id',s.staff_user_id,'staff_name',s.staff_name,'role',s.role,'clock_in',s.clock_in,'expected_hours',s.expected_hours,'status',s.status) order by s.clock_in desc) from public.restaurant_shifts s where s.lodge_id=p_lodge_id and s.status='active'),'[]'::jsonb);
end;
$$;

revoke all on function public._restaurant_validate_attendance_pin(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.clock_in_staff_with_attendance_pin(jsonb), public.clock_out_staff_with_attendance_pin(jsonb) from public;
grant execute on function public.clock_in_staff_with_attendance_pin(jsonb), public.clock_out_staff_with_attendance_pin(jsonb) to authenticated, service_role;
