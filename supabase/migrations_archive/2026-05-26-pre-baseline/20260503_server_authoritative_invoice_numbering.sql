-- =============================================================================
-- Stabilization Step 2: Server-authoritative invoice numbering
-- =============================================================================
-- Problem: convert_quotation_to_booking (20260407) generates invoice numbers via
--   coalesce(max(cast(substring(invoice_number from '[0-9]+$') as int)), 0) + 1
-- This is NOT atomic: two concurrent conversions can read the same max() value and
-- produce duplicate invoice numbers, bypassing the invoice_sequences sequence table.
--
-- create_booking (20260426) and create_booking_record (20260330) already correctly
-- call get_next_invoice_number() when p_invoice_number is null. This migration
-- brings convert_quotation_to_booking into alignment.
--
-- Additionally: insert invoice_number into the bookings row (previously missing
-- from the INSERT column list in this function), aligning with create_booking.
-- =============================================================================

begin;

create or replace function public.convert_quotation_to_booking(
  p_quotation_id   uuid,
  p_lodge_id       uuid,
  p_deposit_amount numeric default 0,
  p_payment_method text    default 'cash',
  p_created_by     uuid    default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $convert_quote$
declare
  v_q          quotations%rowtype;
  v_booking_id uuid;
  v_inv_number text;
  v_dep_result jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();

  if p_deposit_amount > 0 and p_payment_method is null then
    raise exception 'Payment method is required when deposit amount is provided';
  end if;

  select *
    into v_q
    from quotations
   where id = p_quotation_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    raise exception 'Quotation not found';
  end if;

  if v_q.status in ('converted', 'cancelled') then
    raise exception 'Quotation is already % and cannot be converted', v_q.status;
  end if;

  if v_q.status not in ('sent', 'accepted') then
    raise exception 'Quotation must be sent or accepted before conversion';
  end if;

  if v_q.room_id is not null and exists (
    select 1
      from bookings
     where room_id = v_q.room_id
       and lodge_id = p_lodge_id
       and status not in ('cancelled', 'checked_out')
       and check_in < v_q.check_out
       and check_out > v_q.check_in
  ) then
    raise exception 'Room is not available for the requested dates';
  end if;

  -- Use the atomic sequence-backed function — prevents duplicate numbers under concurrency.
  -- Previously this used: coalesce(max(cast(substring(invoice_number from '[0-9]+$') as int)), 0) + 1
  -- which was a non-atomic read-then-increment that could collide under concurrent calls.
  v_inv_number := public.get_next_invoice_number(p_lodge_id);
  v_booking_id := gen_random_uuid();

  insert into bookings (
    id, lodge_id, room_id, customer_id,
    check_in, check_out, adults, children,
    total_amount, amount_paid, payment_status, payment_method,
    status, invoice_number, quotation_id, created_by, created_at, updated_at
  ) values (
    v_booking_id, p_lodge_id, v_q.room_id, v_q.customer_id,
    v_q.check_in, v_q.check_out, v_q.adults, v_q.children,
    v_q.total_amount, 0, 'unpaid', p_payment_method,
    'confirmed', v_inv_number, p_quotation_id, p_created_by, now(), now()
  );

  insert into invoices (
    booking_id, lodge_id, invoice_number, issued_at
  ) values (
    v_booking_id, p_lodge_id, v_inv_number, now()
  )
  on conflict do nothing;

  update quotations
     set status = 'converted',
         converted_booking_id = v_booking_id,
         updated_at = now()
   where id = p_quotation_id;

  if p_deposit_amount > 0 then
    select public.update_booking_payment(
      v_booking_id, p_lodge_id, p_deposit_amount, p_payment_method,
      'deposit', 'payment:deposit:' || v_booking_id, p_created_by
    ) into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      raise exception using
        message = 'Deposit failed',
        detail = coalesce(v_dep_result->>'error', 'unknown'),
        errcode = 'P0001';
    end if;
  end if;

  return json_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'invoice_number', v_inv_number
  );
end;
$convert_quote$;

-- No grant changes needed: function is security definer and existing grants remain valid.

notify pgrst, 'reload schema';

commit;
