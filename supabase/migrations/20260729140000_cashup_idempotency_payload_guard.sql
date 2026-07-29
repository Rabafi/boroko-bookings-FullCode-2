-- Cash-up idempotency is a payload contract, not only a unique key.
-- Reusing a key for another shift, operator, cash count, or note must fail
-- closed. An exact retry returns the same replay response as the original.
begin;

-- Keep the previously deployed implementation available as a private writer;
-- the public wrapper below performs the stronger idempotency validation before
-- delegating to it. The function OID is intentionally not reused by clients.
alter function public.submit_pos_shift_cashup(jsonb)
  rename to _submit_pos_shift_cashup_v1;

create or replace function public.submit_pos_shift_cashup(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_raw_counted jsonb := coalesce(payload->'counted_by_method', '{}'::jsonb);
  v_cash numeric;
  v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_actor uuid := public.app_current_user_id();
  v_shift public.pos_shifts%rowtype;
  v_existing public.pos_cashup_submissions%rowtype;
  v_existing_cash numeric;
begin
  if v_lodge_id is null or v_shift_id is null or v_key is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id, shift_id and idempotency_key are required');
  end if;
  if jsonb_typeof(v_raw_counted) <> 'object' or not (v_raw_counted ? 'cash') then
    return jsonb_build_object('success', false, 'error', 'Enter the physical cash count before submitting cash-up.');
  end if;
  if coalesce(v_raw_counted->>'cash', '') !~ '^-?[0-9]+(\.[0-9]+)?$' then
    return jsonb_build_object('success', false, 'error', 'Enter a valid physical cash count.');
  end if;
  begin
    v_cash := round((v_raw_counted->>'cash')::numeric, 2);
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('success', false, 'error', 'Enter a valid physical cash count.');
  end;
  if v_cash is null then
    return jsonb_build_object('success', false, 'error', 'Enter a valid physical cash count.');
  end if;
  if v_cash < 0 then
    return jsonb_build_object('success', false, 'error', 'Physical cash count cannot be negative.');
  end if;

  perform public.app_require_lodge_role(v_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);

  -- Serialize retries even when the unique-key row does not exist yet. The
  -- lock scope is lodge + key and does not expose a user-controlled lock key.
  perform pg_advisory_xact_lock(hashtextextended(v_lodge_id::text || ':' || v_key, 0));

  select * into v_shift
  from public.pos_shifts
  where id = v_shift_id and lodge_id = v_lodge_id
  for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'This shift was not found.');
  end if;
  if v_shift.cashier_id is distinct from v_actor then
    return jsonb_build_object('success', false, 'error', 'You can only submit cash-up for your own shift.');
  end if;

  -- Check the key before the open-shift guard so an exact retry after a
  -- successful close remains a replay, not a misleading new-write error.
  select * into v_existing
  from public.pos_cashup_submissions
  where lodge_id = v_lodge_id and idempotency_key = v_key
  for update;
  if found then
    begin
      v_existing_cash := round((v_existing.counted_by_method->>'cash')::numeric, 2);
    exception when invalid_text_representation or numeric_value_out_of_range then
      v_existing_cash := null;
    end;
    if v_existing.shift_id is distinct from v_shift_id
       or v_existing.cashier_id is distinct from v_shift.cashier_id
       or v_existing.submitted_by is distinct from v_actor
       or v_existing_cash is distinct from v_cash
       or v_existing.notes is distinct from v_notes then
      return jsonb_build_object(
        'success', false,
        'error', 'This idempotency key was already used for a different cash-up payload.',
        'code', 'idempotency_conflict'
      );
    end if;
    return jsonb_build_object(
      'success', true,
      'submission_id', v_existing.id,
      'status', v_existing.status,
      'replayed', true
    );
  end if;

  if v_shift.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'This shift is already closed.');
  end if;

  -- The private implementation performs the authoritative preview, atomic
  -- row write, audit, and original response contract.
  return public._submit_pos_shift_cashup_v1(payload);
end;
$$;

revoke all on function public._submit_pos_shift_cashup_v1(jsonb) from public, anon, authenticated;
revoke all on function public.submit_pos_shift_cashup(jsonb) from public;
grant execute on function public.submit_pos_shift_cashup(jsonb) to authenticated, service_role;

-- Shared-terminal cash-up uses the staff attendance PIN, so the operator is
-- the shift cashier while the signed-in manager is the audit actor. Rebind it
-- separately and validate both identities against the original audit event.
alter function public.submit_pos_shift_cashup_with_attendance_pin(jsonb)
  rename to _submit_pos_shift_cashup_with_attendance_pin_v1;

create or replace function public.submit_pos_shift_cashup_with_attendance_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id','')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id','')::uuid;
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key','')), '');
  v_pin text := payload->>'pin';
  v_raw_counted jsonb := coalesce(payload->'counted_by_method','{}'::jsonb);
  v_cash numeric;
  v_notes text := nullif(btrim(coalesce(payload->>'notes','')), '');
  v_actor uuid := public.app_current_user_id();
  v_shift public.pos_shifts%rowtype;
  v_existing public.pos_cashup_submissions%rowtype;
  v_existing_actor uuid;
  v_existing_cash numeric;
  v_preview jsonb;
  v_submission_id uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id,array['admin','manager','supervisor']);
  if v_shift_id is null or v_key is null or jsonb_typeof(v_raw_counted) <> 'object' or not (v_raw_counted ? 'cash') then
    return jsonb_build_object('success',false,'error','Choose the staff member, enter their PIN, and enter the physical cash count.');
  end if;
  if coalesce(v_raw_counted->>'cash', '') !~ '^-?[0-9]+(\.[0-9]+)?$' then
    return jsonb_build_object('success',false,'error','Enter a valid physical cash count.');
  end if;
  begin
    v_cash := round((v_raw_counted->>'cash')::numeric, 2);
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('success',false,'error','Enter a valid physical cash count.');
  end;
  if v_cash is null then
    return jsonb_build_object('success',false,'error','Enter a valid physical cash count.');
  end if;
  if v_cash < 0 then
    return jsonb_build_object('success',false,'error','Physical cash count cannot be negative.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_lodge_id::text || ':' || v_key, 0));
  select * into v_shift
  from public.pos_shifts
  where id=v_shift_id and lodge_id=v_lodge_id
  for update;
  if not found then
    return jsonb_build_object('success',false,'error','This staff member has no Till shift.');
  end if;

  -- PIN verification remains mandatory for every request, including retries.
  if not public._restaurant_validate_attendance_pin(v_lodge_id,v_shift.cashier_id,v_pin,coalesce(payload->>'device_id','shared-terminal')) then
    return jsonb_build_object('success',false,'error','Incorrect staff PIN.');
  end if;

  select * into v_existing
  from public.pos_cashup_submissions
  where lodge_id=v_lodge_id and idempotency_key=v_key
  for update;
  if found then
    begin
      v_existing_cash := round((v_existing.counted_by_method->>'cash')::numeric, 2);
    exception when invalid_text_representation or numeric_value_out_of_range then
      v_existing_cash := null;
    end;
    select actor_id into v_existing_actor
    from public.pos_audit_log
    where lodge_id=v_lodge_id
      and idempotency_key=v_key
      and action='cashup_submitted_shared_terminal'
      and entity_id=v_existing.id
    order by created_at desc
    limit 1;
    if v_existing.shift_id is distinct from v_shift_id
       or v_existing.cashier_id is distinct from v_shift.cashier_id
       or v_existing.submitted_by is distinct from v_shift.cashier_id
       or v_existing_actor is distinct from v_actor
       or v_existing_cash is distinct from v_cash
       or v_existing.notes is distinct from v_notes then
      return jsonb_build_object(
        'success',false,
        'error','This idempotency key was already used for a different cash-up payload.',
        'code','idempotency_conflict'
      );
    end if;
    return jsonb_build_object('success',true,'submission_id',v_existing.id,'status',v_existing.status,'replayed',true);
  end if;

  if v_shift.status <> 'open' then
    return jsonb_build_object('success',false,'error','This staff member has no open Till shift.');
  end if;
  v_preview := public._get_pos_shift_cashup_preview_full_v1(v_shift_id,v_lodge_id);
  if coalesce((v_preview->>'success')::boolean,false)=false then return v_preview; end if;
  insert into public.pos_cashup_submissions(
    lodge_id,shift_id,outlet_id,cashier_id,expected_by_method,expected_cash_drawer,
    counted_by_method,notes,submitted_by,idempotency_key
  ) values(
    v_lodge_id,v_shift_id,v_shift.outlet_id,v_shift.cashier_id,
    coalesce(v_preview->'expected_by_method','{}'::jsonb),
    coalesce((v_preview->>'expected_cash_drawer')::numeric,0),
    jsonb_build_object('cash',v_cash),v_notes,v_shift.cashier_id,v_key
  ) returning id into v_submission_id;
  insert into public.pos_audit_log(
    lodge_id,outlet_id,shift_id,actor_id,operator_id,action,entity_type,entity_id,staff_id,amount_delta,idempotency_key,details
  ) values(
    v_lodge_id,v_shift.outlet_id,v_shift_id,v_actor,v_shift.cashier_id,
    'cashup_submitted_shared_terminal','pos_cashup_submission',v_submission_id,v_shift.cashier_id,0,v_key,
    jsonb_build_object('notes',v_notes,'verified_by','attendance_pin')
  );
  return jsonb_build_object('success',true,'submission_id',v_submission_id,'status','submitted','preview',v_preview);
end;
$$;

revoke all on function public._submit_pos_shift_cashup_with_attendance_pin_v1(jsonb) from public, anon, authenticated;
revoke all on function public.submit_pos_shift_cashup_with_attendance_pin(jsonb) from public;
grant execute on function public.submit_pos_shift_cashup_with_attendance_pin(jsonb) to authenticated, service_role;

commit;
