-- Phase 2.2 – Final Financial Safety Patch
-- ─────────────────────────────────────────────────────────────────────────────
-- Fixes:
--   N1  update_booking_payment: allow negative p_amount to push amount_paid < 0
--       → Reject any result where amount_paid would go below zero.
--       → Refunds must go through record_booking_refund (which clamps to v_paid >= 0).
--
--   N2  create/update_conference_booking: allow deposit_paid < 0
--       → Reject negative deposit on both create and update paths.
--       (deposit > total guard from Phase 2.1 is preserved unchanged)
--
-- Deferred / out of scope:
--   - conference booking payment ledger (Phase 3)
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── N1: update_booking_payment – block amount_paid going below zero ────────────
-- The existing overpayment guard (Phase 2) blocks positive payments that exceed
-- total_owed. This patch adds the symmetric lower bound:
--   new_paid < 0  →  reject (use record_booking_refund instead)
-- Negative p_amount up to the current paid balance is still handled by
-- record_booking_refund, which explicitly clamps to 0 and writes a ledger entry.
-- Zero-amount bookings and p_amount = 0 are unaffected.

create or replace function public.update_booking_payment(
  p_booking_id      uuid,
  p_lodge_id        uuid,
  p_amount          numeric,
  p_method          text,
  p_type            text    default 'payment',
  p_idempotency_key text    default null,
  p_recorded_by     uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking    public.bookings%rowtype;
  v_new_paid   numeric;
  v_total_owed numeric;
  v_status     text;
begin
  -- Idempotency: return current state if this key was already processed
  if p_idempotency_key is not null then
    if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
      select amount_paid, payment_status
        into v_new_paid, v_status
        from public.bookings
       where id = p_booking_id;
      return jsonb_build_object(
        'success',        true,
        'amount_paid',    v_new_paid,
        'payment_status', v_status,
        'idempotent',     true
      );
    end if;
  end if;

  -- Row-level lock for atomic concurrent updates
  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_new_paid   := round((coalesce(v_booking.amount_paid, 0) + p_amount)::numeric, 2);
  v_total_owed := round((coalesce(v_booking.total_amount, 0) + coalesce(v_booking.charges_total, 0))::numeric, 2);

  -- N1 FIX: block any adjustment that would push amount_paid below zero.
  -- Callers wanting to reduce amount_paid must use record_booking_refund,
  -- which owns the refund ledger entry and clamps to 0 safely.
  if v_new_paid < 0 then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Adjustment of %s would reduce amount paid below zero (current: %s). '
        'Use the refund flow to reduce a guest''s paid balance.',
        round(p_amount::numeric, 2),
        round(coalesce(v_booking.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

  -- Overpayment guardrail (Phase 2): block positive payments exceeding total owed.
  -- Refunds (p_amount < 0) are never blocked here — they are bounded by the
  -- negative-paid check above instead.
  if p_amount > 0 and v_total_owed > 0 and v_new_paid > v_total_owed then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Payment of %s would overpay this booking. Total owed: %s, already paid: %s. '
        'Adjust the booking total first if a larger payment is intended.',
        round(p_amount::numeric, 2),
        v_total_owed,
        round(coalesce(v_booking.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

  -- Derive status using canonical helper (introduced in Phase 2)
  v_status := public.compute_payment_status(v_new_paid, v_booking.total_amount, v_booking.charges_total);

  update public.bookings
     set amount_paid    = v_new_paid,
         payment_status = v_status,
         payment_method = coalesce(p_method, payment_method),
         updated_at     = now()
   where id = p_booking_id
     and lodge_id = p_lodge_id;

  insert into public.payments (
    booking_id, lodge_id, amount, method, type,
    paid_at, recorded_by, idempotency_key
  ) values (
    p_booking_id, p_lodge_id, p_amount, p_method, p_type,
    now(), p_recorded_by, p_idempotency_key
  );

  return jsonb_build_object(
    'success',        true,
    'amount_paid',    v_new_paid,
    'payment_status', v_status
  );
end;
$function$;


-- ── N2a: create_conference_booking – block negative deposit ───────────────────
-- Negative deposit_paid is financially nonsensical and must be rejected.
-- The deposit > total guard from Phase 2.1 is preserved.

create or replace function public.create_conference_booking(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id           uuid;
  v_total_amount numeric;
  v_deposit_paid numeric;
  v_pay_status   text;
begin
  v_total_amount := coalesce((payload->>'total_amount')::numeric, 0);
  v_deposit_paid := coalesce((payload->>'deposit_paid')::numeric, 0);

  -- N2 FIX: reject negative deposit
  if v_deposit_paid < 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Deposit paid cannot be negative.'
    );
  end if;

  -- Phase 2.1: reject deposit exceeding total
  if v_total_amount > 0 and v_deposit_paid > v_total_amount then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Deposit paid (%s) cannot exceed total amount (%s).',
        round(v_deposit_paid::numeric, 2),
        round(v_total_amount::numeric, 2)
      )
    );
  end if;

  v_pay_status := public.compute_conference_payment_status(v_deposit_paid, v_total_amount);

  insert into public.conference_bookings (
    lodge_id, booking_date, start_time, end_time,
    client_name, company, attendees, setup_type, room_name,
    includes_catering, catering_notes,
    total_amount, deposit_paid, payment_status, payment_method, notes
  ) values (
    (payload->>'lodge_id')::uuid,
    (payload->>'booking_date')::date,
    payload->>'start_time',
    payload->>'end_time',
    payload->>'client_name',
    nullif(payload->>'company', ''),
    coalesce((payload->>'attendees')::integer, 0),
    coalesce(payload->>'setup_type', 'Theatre'),
    coalesce(payload->>'room_name', 'Conference Room'),
    coalesce((payload->>'includes_catering')::boolean, false),
    nullif(payload->>'catering_notes', ''),
    v_total_amount,
    v_deposit_paid,
    v_pay_status,
    nullif(payload->>'payment_method', ''),
    nullif(payload->>'notes', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_conference_booking(jsonb) to anon, authenticated;


-- ── N2b: update_conference_booking – block negative deposit ───────────────────

create or replace function public.update_conference_booking(
  p_id       uuid,
  p_lodge_id uuid,
  payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current           public.conference_bookings%rowtype;
  v_updated           uuid;
  v_total_amount      numeric;
  v_deposit_paid      numeric;
  v_pay_status        text;
  v_financial_changed boolean;
begin
  select *
    into v_current
    from public.conference_bookings
   where id = p_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  v_total_amount := case
    when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0)
    else coalesce(v_current.total_amount, 0)
  end;
  v_deposit_paid := case
    when payload ? 'deposit_paid' then coalesce((payload->>'deposit_paid')::numeric, 0)
    else coalesce(v_current.deposit_paid, 0)
  end;

  -- N2 FIX: reject negative deposit
  if v_deposit_paid < 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Deposit paid cannot be negative.'
    );
  end if;

  -- Phase 2.1: reject deposit exceeding total
  if v_total_amount > 0 and v_deposit_paid > v_total_amount then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Deposit paid (%s) cannot exceed total amount (%s).',
        round(v_deposit_paid::numeric, 2),
        round(v_total_amount::numeric, 2)
      )
    );
  end if;

  v_financial_changed := (payload ? 'total_amount') or (payload ? 'deposit_paid');
  v_pay_status := case
    when v_financial_changed
      then public.compute_conference_payment_status(v_deposit_paid, v_total_amount)
    else v_current.payment_status
  end;

  update public.conference_bookings
     set booking_date      = case when payload ? 'booking_date'      then (payload->>'booking_date')::date                      else booking_date      end,
         start_time        = case when payload ? 'start_time'        then payload->>'start_time'                                else start_time        end,
         end_time          = case when payload ? 'end_time'          then payload->>'end_time'                                  else end_time          end,
         client_name       = case when payload ? 'client_name'       then payload->>'client_name'                               else client_name       end,
         company           = case when payload ? 'company'           then nullif(payload->>'company', '')                       else company           end,
         attendees         = case when payload ? 'attendees'         then coalesce((payload->>'attendees')::integer, 0)         else attendees         end,
         setup_type        = case when payload ? 'setup_type'        then coalesce(payload->>'setup_type', 'Theatre')           else setup_type        end,
         room_name         = case when payload ? 'room_name'         then coalesce(payload->>'room_name', 'Conference Room')    else room_name         end,
         includes_catering = case when payload ? 'includes_catering' then coalesce((payload->>'includes_catering')::boolean, false) else includes_catering end,
         catering_notes    = case when payload ? 'catering_notes'    then nullif(payload->>'catering_notes', '')                else catering_notes    end,
         total_amount      = v_total_amount,
         deposit_paid      = v_deposit_paid,
         payment_status    = v_pay_status,
         payment_method    = case when payload ? 'payment_method'    then nullif(payload->>'payment_method', '')                else payment_method    end,
         notes             = case when payload ? 'notes'             then nullif(payload->>'notes', '')                         else notes             end
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated, 'payment_status', v_pay_status);
end;
$function$;

grant execute on function public.update_conference_booking(uuid, uuid, jsonb) to anon, authenticated;


notify pgrst, 'reload schema';

commit;
