-- Phase 2 Financial Hardening
-- ─────────────────────────────────────────────────────────────────────────────
-- Fixes:
--   F1  record_booking_refund: status used total_amount only (charges_total ignored)
--   F2  sync_booking_charges_total trigger: never recalculated payment_status
--   F3  update_booking RPC: trusted client-supplied payment_status verbatim
--   F4  update_booking RPC: no FOR UPDATE lock on concurrent-safe read-modify-write
--   F5  update_booking_payment: no overpayment guardrail
--
-- Deferred (Phase 3):
--   - Retained deposit revenue visibility (needs schema change)
--   - Invoice payment_status sync
--   - Bulk import payment_status
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Canonical payment status helper ───────────────────────────────────────
-- Single authoritative formula used by all RPCs and the trigger.
-- Total owed = total_amount + charges_total.
-- All three callers previously duplicated this inline with subtle differences.

create or replace function public.compute_payment_status(
  p_amount_paid   numeric,
  p_total_amount  numeric,
  p_charges_total numeric
)
returns text
language sql
immutable
as $function$
  select case
    when coalesce(p_amount_paid, 0) >= (coalesce(p_total_amount, 0) + coalesce(p_charges_total, 0))
      then 'paid'
    when coalesce(p_amount_paid, 0) > 0
      then 'partial'
    else 'unpaid'
  end;
$function$;

-- No grant needed — called only from SECURITY DEFINER RPCs and triggers (run as postgres).


-- ── 2. Fix update_booking_payment: overpayment guardrail ─────────────────────
-- F5: A positive payment that would push amount_paid above total_owed is now
-- rejected.  Refunds (negative p_amount) are unaffected.
-- Applies only when total_owed > 0 to allow zero-amount complimentary bookings.
-- Also switches status derivation to compute_payment_status for consistency.

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

  -- Overpayment guardrail (F5): block positive payments that exceed total owed.
  -- Refunds (p_amount < 0) are never blocked here.
  -- Zero-amount bookings (v_total_owed = 0) are skipped to allow complimentary stays.
  if p_amount > 0 and v_total_owed > 0 and v_new_paid > v_total_owed then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Payment of %s would overpay this booking. Total owed: %s, already paid: %s. Adjust the booking total first if a larger payment is intended.',
        round(p_amount::numeric, 2),
        v_total_owed,
        round(coalesce(v_booking.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

  -- Derive status using canonical helper
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


-- ── 3. Fix record_booking_refund: status must use total_amount + charges_total ─
-- F1: The old formula compared v_new_paid only against total_amount.
-- A booking with extra charges (charges_total > 0) could be left marked 'paid'
-- even when balance_due > 0.

create or replace function public.record_booking_refund(
  p_booking_id       uuid,
  p_lodge_id         uuid,
  p_retained_percent numeric default 0,
  p_method           text    default 'refund',
  p_notes            text    default '',
  p_recorded_by      uuid    default null,
  p_idempotency_key  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking          public.bookings%rowtype;
  v_paid             numeric;
  v_retained_percent numeric;
  v_refund_amount    numeric;
  v_retained_amount  numeric;
  v_new_paid         numeric;
  v_status           text;
begin
  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if p_idempotency_key is not null then
    if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
      return jsonb_build_object(
        'success',        true,
        'booking_id',     p_booking_id,
        'amount_paid',    coalesce(v_booking.amount_paid, 0),
        'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
        'idempotent',     true
      );
    end if;
  end if;

  v_paid := greatest(coalesce(v_booking.amount_paid, 0), 0);
  if v_paid <= 0 then
    return jsonb_build_object('success', false, 'error', 'There is no paid balance available to refund');
  end if;

  v_retained_percent := greatest(0, least(100, coalesce(p_retained_percent, 0)));
  v_refund_amount    := round((v_paid * ((100 - v_retained_percent) / 100.0))::numeric, 2);
  v_retained_amount  := round((v_paid - v_refund_amount)::numeric, 2);

  if v_refund_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Retained percentage leaves nothing to refund');
  end if;

  v_new_paid := round(greatest(v_paid - v_refund_amount, 0)::numeric, 2);

  -- F1 FIX: derive status against total_amount + charges_total, not total_amount alone.
  v_status := public.compute_payment_status(
    v_new_paid,
    v_booking.total_amount,
    v_booking.charges_total   -- was missing; caused 'paid' status when charges existed
  );

  update public.bookings
     set amount_paid    = v_new_paid,
         payment_status = v_status,
         payment_method = coalesce(nullif(p_method, ''), payment_method),
         updated_at     = now()
   where id = p_booking_id
     and lodge_id = p_lodge_id;

  insert into public.payments (
    booking_id, lodge_id, amount, method, type,
    paid_at, recorded_by, notes, idempotency_key
  ) values (
    p_booking_id,
    p_lodge_id,
    -v_refund_amount,
    coalesce(nullif(p_method, ''), 'refund'),
    'refund',
    now(),
    p_recorded_by,
    concat(
      'Refunded ', v_refund_amount,
      ' | Retained ', v_retained_amount,
      ' (', v_retained_percent, '%)',
      case when coalesce(p_notes, '') <> '' then ' | ' || p_notes else '' end
    ),
    p_idempotency_key
  );

  return jsonb_build_object(
    'success',         true,
    'booking_id',      p_booking_id,
    'refund_amount',   v_refund_amount,
    'retained_amount', v_retained_amount,
    'retained_percent', v_retained_percent,
    'amount_paid',     v_new_paid,
    'payment_status',  v_status
  );
end;
$function$;


-- ── 4. Fix charges trigger: also recalculate payment_status ──────────────────
-- F2: The trigger updated charges_total but never touched payment_status.
-- Adding a P500 charge to a 'paid' booking left it incorrectly marked 'paid'.
-- Now: charges_total + payment_status are updated atomically in the same row write.

create or replace function public.sync_booking_charges_total()
returns trigger
language plpgsql
as $function$
declare
  v_booking_id     uuid    := coalesce(new.booking_id, old.booking_id);
  v_new_charges    numeric;
begin
  -- Recompute charges_total from the live sum of all charges for this booking
  select greatest(0, coalesce(sum(amount), 0))
    into v_new_charges
    from public.booking_charges
   where booking_id = v_booking_id;

  -- F2 FIX: update both charges_total AND payment_status in one atomic write.
  -- amount_paid and total_amount are read from the current booking row (pre-update values,
  -- which is correct — only charges changed, not a direct payment event).
  update public.bookings
     set charges_total  = v_new_charges,
         payment_status = public.compute_payment_status(
                            coalesce(amount_paid, 0),
                            coalesce(total_amount, 0),
                            v_new_charges
                          ),
         updated_at     = now()
   where id = v_booking_id;

  return coalesce(new, old);
end;
$function$;

-- Re-attach trigger (definition unchanged, function updated above)
drop trigger if exists trg_sync_charges_total on public.booking_charges;
create trigger trg_sync_charges_total
after insert or update or delete on public.booking_charges
for each row execute function public.sync_booking_charges_total();


-- ── 5. Fix update_booking RPC: server-side payment_status, FOR UPDATE ────────
-- F3: The RPC trusted payload->>'payment_status' from the client verbatim.
--     A client computing status without charges_total could silently corrupt it.
-- F4: The initial SELECT had no FOR UPDATE, allowing a payment to sneak in
--     between the read and the write and produce a stale payment_status.
-- Fix: lock the row, compute payment_status server-side from authoritative fields,
--      and strip any client-supplied payment_status from the update entirely.

create or replace function public.update_booking(
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
  v_current    public.bookings%rowtype;
  v_room_id    uuid;
  v_check_in   date;
  v_check_out  date;
  v_new_total  numeric;
  v_new_status text;
  v_conflict   uuid;
begin
  -- F4 FIX: lock row to prevent a concurrent payment from racing the status update
  select *
    into v_current
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_room_id   := coalesce((payload->>'room_id')::uuid, v_current.room_id);
  v_check_in  := coalesce((payload->>'check_in')::date, v_current.check_in);
  v_check_out := coalesce((payload->>'check_out')::date, v_current.check_out);

  -- Overlap check (excludes self)
  select b.id
    into v_conflict
    from public.bookings b
   where b.lodge_id = p_lodge_id
     and b.room_id  = v_room_id
     and b.id      <> p_id
     and b.status  <> 'cancelled'
     and not (b.check_out <= v_check_in or b.check_in >= v_check_out)
   limit 1;

  if v_conflict is not null then
    return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
  end if;

  -- Resolve new total_amount (use payload value if provided, else keep current)
  v_new_total := case
    when payload ? 'total_amount'
      then coalesce((payload->>'total_amount')::numeric, 0)
    else v_current.total_amount
  end;

  -- F3 FIX: derive payment_status server-side.
  -- Client-supplied payment_status in payload is intentionally ignored.
  -- Uses current amount_paid and charges_total (these are not being changed here).
  v_new_status := public.compute_payment_status(
    coalesce(v_current.amount_paid, 0),
    v_new_total,
    coalesce(v_current.charges_total, 0)
  );

  update public.bookings
     set customer_id    = coalesce((payload->>'customer_id')::uuid, customer_id),
         room_id        = v_room_id,
         check_in       = v_check_in,
         check_out      = v_check_out,
         adults         = case when payload ? 'adults'    then coalesce((payload->>'adults')::int,    1) else adults    end,
         children       = case when payload ? 'children'  then coalesce((payload->>'children')::int,  0) else children  end,
         total_amount   = v_new_total,
         payment_status = v_new_status,  -- always server-derived; client value ignored
         notes          = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
         updated_at     = now()
   where id = p_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id, 'payment_status', v_new_status);
end;
$function$;

-- Grants unchanged
grant execute on function public.update_booking(uuid, uuid, jsonb) to anon, authenticated;


-- ── 6. Ensure compute_payment_status is accessible ───────────────────────────
-- Called only from SECURITY DEFINER contexts and triggers; no direct client grant needed.
-- Explicit revoke ensures anon/authenticated cannot call it directly.
revoke all on function public.compute_payment_status(numeric, numeric, numeric) from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
