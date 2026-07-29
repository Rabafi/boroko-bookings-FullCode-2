-- A signed-in manager session can exist on a shared terminal. Require that
-- same manager's private PIN for every decision that approves or returns a
-- cashier's financial handover; do not trust a visible manager page alone.
create or replace function public._restaurant_validate_manager_cashup_pin(
  p_lodge_id uuid, p_manager_id uuid, p_pin text, p_device_id text default 'shared-terminal'
) returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_hash text; v_locked boolean; v_success boolean := false;
begin
  select count(*) >= 5 into v_locked from public.pos_pin_attempts
   where lodge_id=p_lodge_id and staff_id=p_manager_id and device_id=coalesce(nullif(btrim(p_device_id),''),'shared-terminal')
     and capability='cashup.review' and succeeded=false and attempted_at >= now() - interval '15 minutes';
  if v_locked then raise exception 'Too many unsuccessful manager PIN attempts. Try again in 15 minutes.' using errcode='42501'; end if;

  select pin_hash into v_hash from public.users
   where id=p_manager_id and lodge_id=p_lodge_id and coalesce(status,'active')='active' for update;
  v_success := v_hash is not null and nullif(btrim(coalesce(p_pin,'')),'') is not null and extensions.crypt(p_pin,v_hash)=v_hash;
  insert into public.pos_pin_attempts(lodge_id,staff_id,device_id,capability,succeeded)
   values (p_lodge_id,p_manager_id,coalesce(nullif(btrim(p_device_id),''),'shared-terminal'),'cashup.review',v_success);
  return v_success;
end;
$$;

create or replace function public.review_pos_cashup_submission(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_submission_id uuid := nullif(payload->>'submission_id', '')::uuid;
  v_decision text := lower(nullif(btrim(coalesce(payload->>'decision', '')), ''));
  v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_pin text := payload->>'manager_pin';
  v_actor uuid := public.app_current_user_id(); v_row public.pos_cashup_submissions%rowtype; v_result jsonb;
begin
  if v_lodge_id is null or v_submission_id is null or v_decision not in ('approve','reject') then return jsonb_build_object('success', false, 'error', 'lodge_id, submission_id and a valid decision are required'); end if;
  perform public.app_require_lodge_role(v_lodge_id, array['supervisor','manager','admin','super_admin']);
  if v_actor is null then return jsonb_build_object('success',false,'error','Your manager session could not be confirmed. Sign in again.'); end if;
  if not public._restaurant_validate_manager_cashup_pin(v_lodge_id,v_actor,v_pin,coalesce(payload->>'device_id','shared-terminal')) then return jsonb_build_object('success',false,'error','Incorrect manager PIN.'); end if;
  select * into v_row from public.pos_cashup_submissions where id=v_submission_id and lodge_id=v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Cash-up submission not found.'); end if;
  if v_row.status <> 'submitted' then return jsonb_build_object('success', false, 'error', 'This cash-up has already been reviewed.'); end if;
  if v_decision = 'reject' then
    if v_notes is null then return jsonb_build_object('success', false, 'error', 'Enter a return-for-correction note so the staff member knows what to fix.'); end if;
    update public.pos_cashup_submissions set status='rejected', reviewed_by=v_actor, reviewed_at=now(), review_notes=v_notes where id=v_row.id;
    insert into public.pos_audit_log (lodge_id,outlet_id,shift_id,actor_id,operator_id,action,entity_type,entity_id,staff_id,amount_delta,idempotency_key,details) values (v_lodge_id,v_row.outlet_id,v_row.shift_id,v_actor,v_row.cashier_id,'cashup_rejected','pos_cashup_submission',v_row.id,v_actor,0,'cashup-review-reject:'||v_row.id::text,jsonb_build_object('notes',v_notes,'manager_pin_verified',true));
    return jsonb_build_object('success', true, 'status', 'rejected');
  end if;
  v_result := public.finalize_pos_shift_cashup_v2(jsonb_build_object('lodge_id',v_lodge_id,'shift_id',v_row.shift_id,'cashup_id',v_row.id,'idempotency_key','cashup-review:'||v_row.id::text,'counted_by_method',v_row.counted_by_method,'notes',concat_ws(E'\n', v_row.notes, v_notes)));
  if coalesce((v_result->>'success')::boolean, false) = false then return v_result; end if;
  update public.pos_cashup_submissions set status='approved', reviewed_by=v_actor, reviewed_at=now(), review_notes=v_notes, cashup_session_id=(v_result->>'cashup_id')::uuid where id=v_row.id;
  insert into public.pos_audit_log (lodge_id,outlet_id,shift_id,actor_id,operator_id,action,entity_type,entity_id,staff_id,amount_delta,idempotency_key,details) values (v_lodge_id,v_row.outlet_id,v_row.shift_id,v_actor,v_row.cashier_id,'cashup_approved','pos_cashup_submission',v_row.id,v_actor,0,'cashup-review-approve:'||v_row.id::text,jsonb_build_object('notes',v_notes,'manager_pin_verified',true));
  return v_result || jsonb_build_object('submission_id',v_row.id,'status','approved');
end;
$$;

revoke all on function public._restaurant_validate_manager_cashup_pin(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.review_pos_cashup_submission(jsonb) from public;
grant execute on function public.review_pos_cashup_submission(jsonb) to authenticated, service_role;
