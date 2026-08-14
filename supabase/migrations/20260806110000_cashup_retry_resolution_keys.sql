-- Expose only the opaque submission idempotency key needed to correlate a
-- rejected cash-up with the device's durable retry round. Expected drawer,
-- tender totals and variance remain hidden from the cashier contract.
begin;

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
      'review_notes', v_row.review_notes,
      'idempotency_key', v_row.idempotency_key
    )
  );
end;
$$;

create or replace function public.get_staff_pos_cashup_submission(
  p_lodge_id uuid,
  p_shift_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.pos_cashup_submissions%rowtype;
begin
  perform public.app_require_restaurant_lodge(
    p_lodge_id,
    array['admin','manager','supervisor']
  );
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
      'expected_cash_drawer', v_row.expected_cash_drawer,
      'cash_tips_retained', v_row.cash_tips_retained,
      'counted_by_method', v_row.counted_by_method,
      'notes', v_row.notes,
      'review_notes', v_row.review_notes,
      'submitted_at', v_row.submitted_at,
      'reviewed_at', v_row.reviewed_at,
      'idempotency_key', v_row.idempotency_key
    )
  );
end;
$$;

revoke all on function public.get_my_pos_cashup_submission(uuid, uuid) from public;
revoke all on function public.get_staff_pos_cashup_submission(uuid, uuid) from public;
grant execute on function public.get_my_pos_cashup_submission(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_staff_pos_cashup_submission(uuid, uuid) to authenticated, service_role;

commit;
