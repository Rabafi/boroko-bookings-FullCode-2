begin;

-- When a refund is approved with a retention percentage, the retained amount was previously
-- only implicit (original deposit minus refund row = net retained). This patch adds an explicit
-- 'retention_fee' payment row so the ledger is unambiguous for auditing and reporting.
--
-- After this change, the payments ledger for a cancelled booking with 10% retention looks like:
--   +100  payment   (original deposit)
--    -90  refund    (money returned to guest)
--    +10  retention_fee  (cancellation fee kept by lodge)
--   ─────
--    +10  net                       ← matches total_amount / amount_paid on the booking

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
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_approver_role text;
  v_refund jsonb;
  v_should_cancel boolean := false;
  v_effective_status text;
  v_retained_amount numeric := 0;
  v_settled_total numeric := 0;
  v_final_payment_status text := 'unpaid';
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if p_approved_by is null then
    return jsonb_build_object('success', false, 'error', 'Refund approval is required');
  end if;

  select role
    into v_approver_role
    from public.users
   where id = p_approved_by
     and lodge_id = p_lodge_id
   limit 1;

  if coalesce(v_approver_role, '') not in ('manager', 'admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'Approver does not have refund approval rights');
  end if;

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if coalesce(v_booking.status, '') in ('checked_in', 'checked_out') then
    return jsonb_build_object(
      'success', false,
      'error', 'Refunds are only allowed before check-in or on already-cancelled bookings. Checked-in and checked-out bookings must use a manual finance adjustment workflow.'
    );
  end if;

  v_should_cancel := coalesce(v_booking.status, '') in ('pending', 'confirmed');

  v_refund := public.record_booking_refund(
    p_booking_id,
    p_lodge_id,
    p_retained_percent,
    p_method,
    trim(both from concat(
      coalesce(nullif(p_notes, ''), ''),
      case
        when coalesce(nullif(p_proof_reference, ''), '') <> '' then ' | Proof: ' || p_proof_reference
        else ''
      end,
      case
        when coalesce(nullif(p_approval_note, ''), '') <> '' then ' | Approval: ' || p_approval_note
        else ''
      end
    )),
    p_requested_by,
    'refund-approval:' || p_booking_id::text || ':' || md5(
      coalesce(p_approved_by::text, '') || ':' ||
      coalesce(p_retained_percent::text, '') || ':' ||
      coalesce(p_method, '') || ':' ||
      coalesce(p_notes, '') || ':' ||
      coalesce(p_proof_reference, '')
    )
  );

  if coalesce((v_refund->>'success')::boolean, false) = false then
    return v_refund;
  end if;

  v_retained_amount := coalesce((v_refund->>'retained_amount')::numeric, 0);
  v_effective_status := case
    when v_should_cancel or coalesce(v_booking.status, '') = 'cancelled' then 'cancelled'
    else v_booking.status
  end;

  if v_effective_status = 'cancelled' then
    v_settled_total := round(greatest(v_retained_amount, 0)::numeric, 2);
    v_final_payment_status := case
      when v_settled_total > 0 then 'paid'
      else 'unpaid'
    end;

    update public.bookings
       set status = 'cancelled',
           total_amount = v_settled_total,
           amount_paid = v_settled_total,
           payment_status = v_final_payment_status,
           updated_at = now()
     where id = p_booking_id
       and lodge_id = p_lodge_id;

    -- Insert an explicit retention fee row so the ledger is unambiguous.
    -- Without this, the retained amount is only implicit (sum of all payment rows
    -- would net to the retained amount, but no single row represents it as income).
    -- This row makes it clear that the lodge kept this amount as a cancellation fee.
    if v_retained_amount > 0 then
      insert into public.payments (
        booking_id,
        lodge_id,
        amount,
        method,
        type,
        paid_at,
        recorded_by,
        notes,
        idempotency_key
      ) values (
        p_booking_id,
        p_lodge_id,
        v_retained_amount,
        coalesce(nullif(p_method, ''), 'refund'),
        'retention_fee',
        now(),
        p_approved_by,
        concat(
          'Refund retention fee: ',
          round(coalesce(p_retained_percent, 0)::numeric, 2),
          '% of paid amount kept by lodge',
          case
            when coalesce(nullif(p_notes, ''), '') <> '' then ' | ' || p_notes
            else ''
          end
        ),
        -- Idempotency key ensures replaying this RPC never double-inserts the retention row
        'retention-fee:' || p_booking_id::text || ':' || md5(
          coalesce(p_approved_by::text, '') || ':' ||
          coalesce(p_retained_percent::text, '') || ':' ||
          coalesce(p_method, '')
        )
      )
      on conflict (idempotency_key) do nothing;
    end if;

    insert into public.financial_audit_log (
      lodge_id,
      booking_id,
      action,
      actor_id,
      amount_delta,
      before_snapshot,
      after_snapshot
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
        'status', 'cancelled',
        'total_amount', v_settled_total,
        'amount_paid', v_settled_total,
        'payment_status', v_final_payment_status,
        'retained_amount', v_retained_amount,
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
    coalesce((v_refund->>'refund_amount')::numeric, 0),
    v_retained_amount,
    coalesce((v_refund->>'retained_percent')::numeric, 0),
    coalesce(nullif(p_method, ''), 'refund'),
    nullif(p_notes, ''),
    nullif(p_proof_reference, ''),
    nullif(p_approval_note, '')
  );

  return v_refund || jsonb_build_object(
    'approved_by', p_approved_by,
    'booking_status', v_effective_status,
    'settled_total_amount', v_settled_total,
    'final_payment_status', v_final_payment_status
  );
end;
$function$;

grant execute on function public.approve_booking_refund(uuid, uuid, numeric, text, text, uuid, uuid, text, text)
to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
