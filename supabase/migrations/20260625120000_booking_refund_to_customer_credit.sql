-- Add a cancellation settlement path that transfers the refundable booking balance
-- into the guest's customer-credit ledger instead of recording external cash out.

create or replace function public.approve_booking_refund(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_retained_percent numeric default 0,
  p_method text default 'refund',
  p_notes text default '',
  p_requested_by uuid default null,
  p_approved_by uuid default null,
  p_proof_reference text default '',
  p_approval_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_booking public.bookings%rowtype;
  v_after public.bookings%rowtype;
  v_approver_role text;
  v_refund jsonb;
  v_should_cancel boolean := false;
  v_effective_status text;
  v_retained_amount numeric := 0;
  v_refund_amount numeric := 0;
  v_settled_total numeric := 0;
  v_final_payment_status text := 'unpaid';
  v_method text := coalesce(nullif(p_method, ''), 'refund');
  v_refund_idempotency_key text;
  v_refund_payment_id uuid;
  v_credit_entry_id uuid;
  v_new_credit_balance numeric;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if p_approved_by is null then
    return jsonb_build_object('success', false, 'error', 'Refund approval is required');
  end if;

  select role into v_approver_role
    from public.users
   where id = p_approved_by
     and lodge_id = p_lodge_id
   limit 1;

  if coalesce(v_approver_role, '') not in ('manager', 'admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'Approver does not have refund approval rights');
  end if;

  select * into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if coalesce(v_booking.status, '') in ('checked_in', 'checked_out') then
    return jsonb_build_object('success', false, 'error', 'Refunds are only allowed before check-in or on already-cancelled bookings. Checked-in and checked-out bookings must use a manual finance adjustment workflow.');
  end if;

  if v_method = 'customer_credit_transfer' and v_booking.customer_id is null then
    return jsonb_build_object('success', false, 'error', 'Customer credit transfer requires a guest record on the booking.');
  end if;

  v_should_cancel := coalesce(v_booking.status, '') in ('pending', 'confirmed');
  v_refund_idempotency_key := 'refund-approval:' || p_booking_id::text || ':' || md5(
    coalesce(p_approved_by::text, '') || ':' ||
    coalesce(p_retained_percent::text, '') || ':' ||
    v_method || ':' ||
    coalesce(p_notes, '') || ':' ||
    coalesce(p_proof_reference, '')
  );

  v_refund := public.record_booking_refund(
    p_booking_id,
    p_lodge_id,
    p_retained_percent,
    v_method,
    trim(both from concat(
      coalesce(nullif(p_notes, ''), ''),
      case when coalesce(nullif(p_proof_reference, ''), '') <> '' then ' | Proof: ' || p_proof_reference else '' end,
      case when coalesce(nullif(p_approval_note, ''), '') <> '' then ' | Approval: ' || p_approval_note else '' end
    )),
    p_requested_by,
    v_refund_idempotency_key
  );

  if coalesce((v_refund->>'success')::boolean, false) = false then
    return v_refund;
  end if;

  v_refund_amount := coalesce((v_refund->>'refund_amount')::numeric, 0);
  v_retained_amount := coalesce((v_refund->>'retained_amount')::numeric, 0);
  v_effective_status := case when v_should_cancel or coalesce(v_booking.status, '') = 'cancelled' then 'cancelled' else v_booking.status end;

  if v_method = 'customer_credit_transfer' and v_refund_amount > 0 then
    select id into v_refund_payment_id
      from public.payments
     where booking_id = p_booking_id
       and lodge_id = p_lodge_id
       and idempotency_key = v_refund_idempotency_key
     limit 1;

    if v_refund_payment_id is null then
      return jsonb_build_object('success', false, 'error', 'Refund payment record was not found for customer credit transfer.');
    end if;

    v_credit_entry_id := gen_random_uuid();

    insert into public.customer_credit_ledger (
      id, lodge_id, customer_id, entry_type, amount, method,
      reference, notes, booking_id, payment_id, recorded_by, idempotency_key
    ) values (
      v_credit_entry_id, p_lodge_id, v_booking.customer_id,
      'adjustment_in', round(v_refund_amount, 2), 'customer_credit_transfer',
      'Cancelled booking ' || p_booking_id,
      trim(both from concat(
        'Transfer from cancelled booking refund',
        case when coalesce(nullif(p_notes, ''), '') <> '' then ': ' || p_notes else '' end
      )),
      p_booking_id, v_refund_payment_id, p_approved_by,
      v_refund_idempotency_key || ':credit'
    );

    v_new_credit_balance := public.customer_credit_balance(p_lodge_id, v_booking.customer_id);

    insert into public.financial_audit_log (
      lodge_id, booking_id, customer_id, action, actor_id, amount_delta,
      before_snapshot, after_snapshot, idempotency_key
    ) values (
      p_lodge_id, p_booking_id, v_booking.customer_id,
      'customer_credit_adjusted', p_approved_by, round(v_refund_amount, 2),
      jsonb_build_object('previous_balance', v_new_credit_balance - v_refund_amount),
      jsonb_build_object(
        'new_balance', v_new_credit_balance,
        'entry_id', v_credit_entry_id,
        'source', 'cancelled_booking_refund'
      ),
      v_refund_idempotency_key || ':credit'
    );
  end if;

  if v_effective_status = 'cancelled' then
    v_settled_total := round(greatest(v_retained_amount, 0)::numeric, 2);
    v_final_payment_status := case when v_settled_total > 0 then 'paid' else 'unpaid' end;

    update public.bookings
       set status = 'cancelled',
           total_amount = v_settled_total,
           payment_status = v_final_payment_status,
           updated_at = now()
     where id = p_booking_id
       and lodge_id = p_lodge_id
    returning * into v_after;

    insert into public.financial_audit_log (
      lodge_id, booking_id, action, actor_id, amount_delta, before_snapshot, after_snapshot
    ) values (
      p_lodge_id,
      p_booking_id,
      'booking_total_edited',
      p_approved_by,
      null,
      jsonb_build_object(
        'status', v_booking.status,
        'total_amount', v_booking.total_amount,
        'amount_paid', v_booking.amount_paid,
        'payment_status', v_booking.payment_status
      ),
      jsonb_build_object(
        'status', v_after.status,
        'total_amount', v_after.total_amount,
        'amount_paid', v_after.amount_paid,
        'payment_status', v_after.payment_status,
        'reason', 'refund_retained_settlement'
      )
    );
  end if;

  insert into public.refund_approval_log (
    lodge_id,
    booking_id,
    approved_by,
    requested_by,
    refund_amount,
    retained_amount,
    retained_percent,
    method,
    notes,
    proof_reference,
    approval_note
  ) values (
    p_lodge_id,
    p_booking_id,
    p_approved_by,
    p_requested_by,
    v_refund_amount,
    v_retained_amount,
    coalesce((v_refund->>'retained_percent')::numeric, 0),
    v_method,
    nullif(p_notes, ''),
    nullif(p_proof_reference, ''),
    nullif(p_approval_note, '')
  );

  return v_refund || jsonb_build_object(
    'approved_by', p_approved_by,
    'booking_status', v_effective_status,
    'settled_total_amount', v_settled_total,
    'final_payment_status', v_final_payment_status,
    'credit_transfer', v_method = 'customer_credit_transfer',
    'credit_entry_id', v_credit_entry_id,
    'credit_balance', v_new_credit_balance
  );
end;
$$;

grant execute on function public.approve_booking_refund(uuid, uuid, numeric, text, text, uuid, uuid, text, text)
  to anon, authenticated, service_role;
