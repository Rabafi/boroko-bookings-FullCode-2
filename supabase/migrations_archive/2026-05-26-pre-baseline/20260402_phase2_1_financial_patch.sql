-- Phase 2.1 – Targeted Financial Patch
-- ─────────────────────────────────────────────────────────────────────────────
-- Fixes:
--   B1  update_booking: allow editing total below amount_paid (creates silent
--       overpaid state with no refund record). Now blocked with a clear error.
--   C1  create_conference_booking: trusts client payment_status verbatim.
--   C2  update_conference_booking: trusts client payment_status verbatim.
--       Both now derive payment_status server-side from deposit_paid / total_amount.
--       Also validates deposit_paid <= total_amount to block invalid overpaid states.
--
-- Deferred / out of scope for this patch:
--   - Conference bookings do not use the payments table; no ledger entries added here.
--   - Conference booking full payment ledger migration is Phase 3.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── helper: canonical conference payment status ───────────────────────────────
-- Separate from compute_payment_status because conference bookings use a
-- 3-value vocabulary: pending / deposit_paid / paid  (not unpaid/partial/paid).
-- 'paid'         → deposit_paid >= total_amount (fully settled)
-- 'deposit_paid' → deposit_paid > 0 and < total_amount
-- 'pending'      → no deposit at all
-- Zero-total bookings are treated as 'pending' by convention.

create or replace function public.compute_conference_payment_status(
  p_deposit_paid  numeric,
  p_total_amount  numeric
)
returns text
language sql
immutable
as $function$
  select case
    when coalesce(p_total_amount, 0) <= 0
      then 'pending'
    when coalesce(p_deposit_paid, 0) >= coalesce(p_total_amount, 0)
      then 'paid'
    when coalesce(p_deposit_paid, 0) > 0
      then 'deposit_paid'
    else
      'pending'
  end;
$function$;

-- No direct client grant — called only from SECURITY DEFINER RPCs.
revoke all on function public.compute_conference_payment_status(numeric, numeric)
  from public, anon, authenticated;


-- ── B1: update_booking – block total edit below amount_paid ───────────────────
-- Phase 2 added server-side payment_status derivation and FOR UPDATE lock.
-- Missing guard: if staff lowered total_amount below amount_paid the booking
-- would flip to 'paid' with a silent liability (overpaid, no refund record).
-- Fix: reject the edit and return a human-readable error message.

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
  v_total_owed numeric;
begin
  -- Lock row to prevent a concurrent payment from racing the status update
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

  -- Resolve new total_amount (use payload value if provided, else keep current)
  v_new_total := case
    when payload ? 'total_amount'
      then coalesce((payload->>'total_amount')::numeric, 0)
    else v_current.total_amount
  end;

  -- B1 FIX: reject a total edit that would create a silent overpaid state.
  -- total_owed = new_total + current charges_total (charges are not being changed here).
  -- If amount_paid already exceeds the new total owed, the edit is invalid —
  -- the correct workflow is to record a refund first, then reduce the total.
  v_total_owed := v_new_total + coalesce(v_current.charges_total, 0);
  if v_total_owed < coalesce(v_current.amount_paid, 0) then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Cannot reduce booking total to %s: guest has already paid %s. '
        'Record a refund first, then adjust the total.',
        round(v_new_total::numeric, 2),
        round(coalesce(v_current.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

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

  -- Derive payment_status server-side (client-supplied value intentionally ignored)
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
         adults         = case when payload ? 'adults'   then coalesce((payload->>'adults')::int,   1) else adults   end,
         children       = case when payload ? 'children' then coalesce((payload->>'children')::int, 0) else children end,
         total_amount   = v_new_total,
         payment_status = v_new_status,
         notes          = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
         updated_at     = now()
   where id = p_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id, 'payment_status', v_new_status);
end;
$function$;

grant execute on function public.update_booking(uuid, uuid, jsonb) to anon, authenticated;


-- ── C1: create_conference_booking – server-side payment_status ────────────────
-- Old: INSERT passed payload->>'payment_status' verbatim — any value accepted.
-- New:
--   1. Validate deposit_paid <= total_amount (reject overpaid states).
--   2. Derive payment_status via compute_conference_payment_status.
--   3. Client-supplied payment_status is silently ignored.

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

  -- C1 FIX: reject deposit that exceeds total (invalid overpaid state).
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

  -- C1 FIX: derive payment_status server-side; ignore client-supplied value.
  v_pay_status := public.compute_conference_payment_status(v_deposit_paid, v_total_amount);

  insert into public.conference_bookings (
    lodge_id,
    booking_date,
    start_time,
    end_time,
    client_name,
    company,
    attendees,
    setup_type,
    room_name,
    includes_catering,
    catering_notes,
    total_amount,
    deposit_paid,
    payment_status,
    payment_method,
    notes
  ) values (
    (payload->>'lodge_id')::uuid,
    (payload->>'booking_date')::date,
    (payload->>'start_time')::time,
    (payload->>'end_time')::time,
    payload->>'client_name',
    nullif(payload->>'company', ''),
    coalesce((payload->>'attendees')::integer, 0),
    coalesce(payload->>'setup_type', 'Theatre'),
    coalesce(payload->>'room_name', 'Conference Room'),
    coalesce((payload->>'includes_catering')::boolean, false),
    nullif(payload->>'catering_notes', ''),
    v_total_amount,
    v_deposit_paid,
    v_pay_status,           -- server-derived; client value ignored
    nullif(payload->>'payment_method', ''),
    nullif(payload->>'notes', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_conference_booking(jsonb) to anon, authenticated;


-- ── C2: update_conference_booking – server-side payment_status ───────────────
-- Old: UPDATE set payment_status from payload verbatim when present.
-- New:
--   1. Resolve effective total_amount and deposit_paid (payload or current).
--   2. Validate deposit_paid <= total_amount.
--   3. Always recompute payment_status server-side when either financial field
--      is touched; otherwise preserve existing value without touching it
--      (avoids unnecessary writes on non-financial updates).

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
  v_current       public.conference_bookings%rowtype;
  v_updated       uuid;
  v_total_amount  numeric;
  v_deposit_paid  numeric;
  v_pay_status    text;
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

  -- Resolve effective financial values
  v_total_amount := case
    when payload ? 'total_amount'  then coalesce((payload->>'total_amount')::numeric,  0)
    else coalesce(v_current.total_amount, 0)
  end;
  v_deposit_paid := case
    when payload ? 'deposit_paid'  then coalesce((payload->>'deposit_paid')::numeric,  0)
    else coalesce(v_current.deposit_paid, 0)
  end;

  -- C2 FIX: block deposit > total on update too
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

  -- Only recompute payment_status when a financial field is actually being changed.
  -- Use existing payment_status otherwise (avoids silent overwrites).
  v_financial_changed := (payload ? 'total_amount') or (payload ? 'deposit_paid');
  v_pay_status := case
    when v_financial_changed
      then public.compute_conference_payment_status(v_deposit_paid, v_total_amount)
    else v_current.payment_status
  end;

  update public.conference_bookings
     set booking_date      = case when payload ? 'booking_date'     then (payload->>'booking_date')::date         else booking_date      end,
         start_time        = case when payload ? 'start_time'       then (payload->>'start_time')::time                   else start_time        end,
         end_time          = case when payload ? 'end_time'         then (payload->>'end_time')::time                     else end_time          end,
         client_name       = case when payload ? 'client_name'      then payload->>'client_name'                  else client_name       end,
         company           = case when payload ? 'company'          then nullif(payload->>'company', '')           else company          end,
         attendees         = case when payload ? 'attendees'        then coalesce((payload->>'attendees')::integer, 0) else attendees    end,
         setup_type        = case when payload ? 'setup_type'       then coalesce(payload->>'setup_type', 'Theatre')  else setup_type   end,
         room_name         = case when payload ? 'room_name'        then coalesce(payload->>'room_name', 'Conference Room') else room_name end,
         includes_catering = case when payload ? 'includes_catering' then coalesce((payload->>'includes_catering')::boolean, false) else includes_catering end,
         catering_notes    = case when payload ? 'catering_notes'   then nullif(payload->>'catering_notes', '')    else catering_notes   end,
         total_amount      = v_total_amount,
         deposit_paid      = v_deposit_paid,
         payment_status    = v_pay_status,   -- server-derived; client value ignored
         payment_method    = case when payload ? 'payment_method'   then nullif(payload->>'payment_method', '')    else payment_method   end,
         notes             = case when payload ? 'notes'            then nullif(payload->>'notes', '')             else notes            end
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
