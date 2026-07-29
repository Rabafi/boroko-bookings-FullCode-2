-- Blind operator cash-up.  Cashiers must count what is physically in the
-- drawer without receiving the server expectation or a live variance.  The
-- existing full preview is retained under a private name so the authoritative
-- submission/finalisation functions continue to calculate from server data.
begin;

alter function public.get_pos_shift_cashup_preview_v2(uuid, uuid)
  rename to _get_pos_shift_cashup_preview_full_v1;

create or replace function public.get_pos_shift_cashup_preview_v2(
  p_shift_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_full jsonb;
  v_cashier_id uuid;
  v_actor uuid := public.app_current_user_id();
  v_role text := lower(coalesce(public.app_current_role(), ''));
begin
  v_full := public._get_pos_shift_cashup_preview_full_v1(p_shift_id, p_lodge_id);
  if coalesce((v_full->>'success')::boolean, false) = false then
    return v_full;
  end if;

  select cashier_id into v_cashier_id
  from public.pos_shifts
  where id = p_shift_id and lodge_id = p_lodge_id;

  -- The manager/supervisor review path retains the complete server preview.
  -- Only the active cashier/bartender operator is blind, and only while the
  -- shift is still open.  A shared terminal cannot bypass this by selecting a
  -- worker because its manager session is not an operator role.
  if v_cashier_id is not distinct from v_actor
     and v_role in ('cashier', 'bar', 'bartender', 'operator', 'waiter')
     and coalesce(v_full->>'status', '') = 'open' then
    return jsonb_build_object(
      'success', true,
      'shift_id', p_shift_id,
      'status', v_full->'status',
      'business_date', v_full->'business_date',
      'opening_float', v_full->'opening_float',
      'order_count', v_full->'order_count',
      'return_count', v_full->'return_count',
      'void_count', v_full->'void_count',
      'blind', true
    );
  end if;
  return v_full;
end;
$$;

-- The old preview is intentionally callable only by trusted stored functions;
-- those functions retain their dependency by function OID after the rename.
revoke all on function public._get_pos_shift_cashup_preview_full_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_pos_shift_cashup_preview_v2(uuid, uuid)
  to anon, authenticated, service_role;

-- Never trust a client-provided card/mobile/other tender count.  The drawer is
-- the only physical count the operator supplies; server-recorded non-cash
-- tenders are copied into the stored comparison so manager review stays
-- meaningful without revealing them to the operator.
create or replace function public._blind_cashup_counts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cash numeric;
begin
  if jsonb_typeof(coalesce(new.counted_by_method, '{}'::jsonb)) <> 'object'
     or not (new.counted_by_method ? 'cash') then
    raise exception 'A physical cash count is required before submitting cash-up.';
  end if;
  begin
    v_cash := round((new.counted_by_method->>'cash')::numeric, 2);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Enter a valid physical cash count.';
  end;
  if v_cash is null then
    raise exception 'Enter a valid physical cash count.';
  end if;
  if v_cash < 0 then
    raise exception 'Physical cash count cannot be negative.';
  end if;
  new.counted_by_method := coalesce(new.expected_by_method, '{}'::jsonb)
    || jsonb_build_object('cash', v_cash);
  return new;
end;
$$;

drop trigger if exists blind_cashup_counts on public.pos_cashup_submissions;
create trigger blind_cashup_counts
before insert or update of counted_by_method, expected_by_method
on public.pos_cashup_submissions
for each row execute function public._blind_cashup_counts();
revoke all on function public._blind_cashup_counts() from public, anon, authenticated;

-- A cashier can see only their status, physical cash count and notes after
-- submission.  Expected drawer and retained-tip totals remain manager-only.
create or replace function public.get_my_pos_cashup_submission(
  p_lodge_id uuid,
  p_shift_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_shift public.pos_shifts%rowtype;
  v_row public.pos_cashup_submissions%rowtype;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['cashier','supervisor','manager','admin','super_admin']
  );
  select * into v_shift
  from public.pos_shifts
  where id = p_shift_id and lodge_id = p_lodge_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Shift not found');
  end if;
  if v_shift.cashier_id is distinct from v_actor then
    return jsonb_build_object('success', false, 'error', 'You can only view your own cash-up submission.');
  end if;
  select * into v_row
  from public.pos_cashup_submissions
  where lodge_id = p_lodge_id and shift_id = p_shift_id;
  if not found then
    return jsonb_build_object('success', true, 'submission', null);
  end if;
  return jsonb_build_object(
    'success', true,
    'submission', jsonb_build_object(
      'id', v_row.id,
      'status', v_row.status,
      'counted_by_method', jsonb_build_object('cash', v_row.counted_by_method->'cash'),
      'submitted_at', v_row.submitted_at,
      'notes', v_row.notes,
      'review_notes', v_row.review_notes
    )
  );
end;
$$;

revoke all on function public.get_my_pos_cashup_submission(uuid, uuid) from public;
grant execute on function public.get_my_pos_cashup_submission(uuid, uuid)
  to authenticated, service_role;

-- Rebind the cashier submission contract to the private full preview and
-- normalise the audit payload as well as the stored row.  This prevents a
-- caller from smuggling fabricated card/mobile counts into review evidence.
create or replace function public.submit_pos_shift_cashup(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_raw_counted jsonb := coalesce(payload->'counted_by_method', '{}'::jsonb);
  v_counted jsonb;
  v_cash numeric;
  v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_actor_id uuid := public.app_current_user_id();
  v_shift public.pos_shifts%rowtype;
  v_preview jsonb;
  v_existing public.pos_cashup_submissions%rowtype;
  v_submission_id uuid;
begin
  if v_lodge_id is null or v_shift_id is null or v_key is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id, shift_id and idempotency_key are required');
  end if;
  if jsonb_typeof(v_raw_counted) <> 'object' or not (v_raw_counted ? 'cash') then
    return jsonb_build_object('success', false, 'error', 'Enter the physical cash count before submitting cash-up.');
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
  v_counted := jsonb_build_object('cash', v_cash);
  perform public.app_require_lodge_role(v_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);

  select * into v_shift from public.pos_shifts
   where id = v_shift_id and lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'This shift was not found.'); end if;
  if v_shift.cashier_id is distinct from v_actor_id then
    return jsonb_build_object('success', false, 'error', 'You can only submit cash-up for your own shift.');
  end if;
  if v_shift.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'This shift is already closed.');
  end if;

  select * into v_existing from public.pos_cashup_submissions
   where lodge_id = v_lodge_id and idempotency_key = v_key;
  if found then
    return jsonb_build_object('success', true, 'submission_id', v_existing.id, 'status', v_existing.status, 'replayed', true);
  end if;
  select * into v_existing from public.pos_cashup_submissions
   where lodge_id = v_lodge_id and shift_id = v_shift_id for update;
  if found and v_existing.status in ('submitted', 'approved') then
    return jsonb_build_object('success', false, 'error', 'This shift already has a cash-up awaiting review or has been closed.');
  end if;

  v_preview := public._get_pos_shift_cashup_preview_full_v1(v_shift_id, v_lodge_id);
  if coalesce((v_preview->>'success')::boolean, false) = false then return v_preview; end if;
  if found then
    update public.pos_cashup_submissions set
      counted_by_method = v_counted, notes = v_notes, expected_by_method = coalesce(v_preview->'expected_by_method', '{}'::jsonb),
      expected_cash_drawer = coalesce((v_preview->>'expected_cash_drawer')::numeric, 0), status = 'submitted',
      submitted_by = v_actor_id, submitted_at = now(), reviewed_by = null, reviewed_at = null, review_notes = null,
      idempotency_key = v_key
    where id = v_existing.id returning id into v_submission_id;
  else
    insert into public.pos_cashup_submissions (
      lodge_id, shift_id, outlet_id, cashier_id, expected_by_method, expected_cash_drawer,
      counted_by_method, notes, submitted_by, idempotency_key
    ) values (
      v_lodge_id, v_shift_id, v_shift.outlet_id, v_shift.cashier_id, coalesce(v_preview->'expected_by_method', '{}'::jsonb),
      coalesce((v_preview->>'expected_cash_drawer')::numeric, 0), v_counted, v_notes, v_actor_id, v_key
    ) returning id into v_submission_id;
  end if;
  insert into public.pos_audit_log (lodge_id, outlet_id, shift_id, actor_id, operator_id, action, entity_type, entity_id, staff_id, amount_delta, idempotency_key, after_snapshot, details)
  values (v_lodge_id, v_shift.outlet_id, v_shift_id, v_actor_id, v_shift.cashier_id, 'cashup_submitted', 'pos_cashup_submission', v_submission_id, v_actor_id, 0, v_key, jsonb_build_object('preview', v_preview, 'counted_by_method', v_counted), jsonb_build_object('notes', v_notes));
  return jsonb_build_object('success', true, 'submission_id', v_submission_id, 'status', 'submitted');
end;
$$;

revoke all on function public.submit_pos_shift_cashup(jsonb) from public;
grant execute on function public.submit_pos_shift_cashup(jsonb) to authenticated, service_role;

commit;
