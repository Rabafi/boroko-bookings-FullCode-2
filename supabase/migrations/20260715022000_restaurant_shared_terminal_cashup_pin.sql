-- Shared-terminal handover: the manager session stays open, but the cashier proves
-- the handover with their own attendance PIN. Review authority remains separate.
create or replace function public.submit_pos_shift_cashup_with_attendance_pin(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id','')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id','')::uuid;
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key','')), '');
  v_pin text := payload->>'pin'; v_counted jsonb := coalesce(payload->'counted_by_method','{}'::jsonb);
  v_notes text := nullif(btrim(coalesce(payload->>'notes','')), ''); v_actor uuid := public.app_current_user_id();
  v_shift public.pos_shifts%rowtype; v_existing public.pos_cashup_submissions%rowtype; v_preview jsonb; v_submission_id uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id,array['admin','manager','supervisor']);
  if v_shift_id is null or v_key is null or jsonb_typeof(v_counted) <> 'object' or not (v_counted ? 'cash') then return jsonb_build_object('success',false,'error','Choose the staff member, enter their PIN, and enter the physical cash count.'); end if;
  select * into v_shift from public.pos_shifts where id=v_shift_id and lodge_id=v_lodge_id and status='open' for update;
  if not found then return jsonb_build_object('success',false,'error','This staff member has no open Till shift.'); end if;
  if not public._restaurant_validate_attendance_pin(v_lodge_id,v_shift.cashier_id,v_pin,coalesce(payload->>'device_id','shared-terminal')) then return jsonb_build_object('success',false,'error','Incorrect staff PIN.'); end if;
  select * into v_existing from public.pos_cashup_submissions where lodge_id=v_lodge_id and shift_id=v_shift_id for update;
  if found and v_existing.status in ('submitted','approved') then return jsonb_build_object('success',false,'error','This cash-up has already been submitted or closed.'); end if;
  v_preview := public.get_pos_shift_cashup_preview_v2(v_shift_id,v_lodge_id);
  if coalesce((v_preview->>'success')::boolean,false)=false then return v_preview; end if;
  if found then update public.pos_cashup_submissions set counted_by_method=v_counted,notes=v_notes,expected_by_method=coalesce(v_preview->'expected_by_method','{}'::jsonb),expected_cash_drawer=coalesce((v_preview->>'expected_cash_drawer')::numeric,0),status='submitted',submitted_by=v_shift.cashier_id,submitted_at=now(),reviewed_by=null,reviewed_at=null,review_notes=null,idempotency_key=v_key where id=v_existing.id returning id into v_submission_id;
  else insert into public.pos_cashup_submissions(lodge_id,shift_id,outlet_id,cashier_id,expected_by_method,expected_cash_drawer,counted_by_method,notes,submitted_by,idempotency_key) values(v_lodge_id,v_shift_id,v_shift.outlet_id,v_shift.cashier_id,coalesce(v_preview->'expected_by_method','{}'::jsonb),coalesce((v_preview->>'expected_cash_drawer')::numeric,0),v_counted,v_notes,v_shift.cashier_id,v_key) returning id into v_submission_id; end if;
  insert into public.pos_audit_log(lodge_id,outlet_id,shift_id,actor_id,operator_id,action,entity_type,entity_id,staff_id,amount_delta,idempotency_key,details) values(v_lodge_id,v_shift.outlet_id,v_shift_id,v_actor,v_shift.cashier_id,'cashup_submitted_shared_terminal','pos_cashup_submission',v_submission_id,v_shift.cashier_id,0,v_key,jsonb_build_object('notes',v_notes,'verified_by','attendance_pin'));
  return jsonb_build_object('success',true,'submission_id',v_submission_id,'status','submitted','preview',v_preview);
end;
$$;
revoke all on function public.submit_pos_shift_cashup_with_attendance_pin(jsonb) from public;
grant execute on function public.submit_pos_shift_cashup_with_attendance_pin(jsonb) to authenticated,service_role;
