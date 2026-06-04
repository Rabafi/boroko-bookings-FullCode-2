-- Fix Conference Booking Time Casts
-- ─────────────────────────────────────────────────────────────────────────────
-- Fixes:
--   - Errors when creating or updating conference bookings where start_time/end_time
--     extractions from JSONB (text) were not explicitly cast to TIME.
--   - Re-applies the latest logic from the PWA lockdown patch with the added casts.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

create or replace function public.create_conference_booking(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $create_conf$
declare
  v_id           uuid;
  v_total_amount numeric;
  v_deposit_paid numeric;
  v_pay_status   text;
begin
  perform public.app_reject_pwa_financial_mutation();

  v_total_amount := coalesce((payload->>'total_amount')::numeric, 0);
  v_deposit_paid := coalesce((payload->>'deposit_paid')::numeric, 0);

  if v_deposit_paid < 0 then
    return jsonb_build_object('success', false, 'error', 'Deposit paid cannot be negative.');
  end if;

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
    v_pay_status,
    nullif(payload->>'payment_method', ''),
    nullif(payload->>'notes', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$create_conf$;

create or replace function public.update_conference_booking(
  p_id       uuid,
  p_lodge_id uuid,
  payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $update_conf$
declare
  v_current           public.conference_bookings%rowtype;
  v_updated           uuid;
  v_total_amount      numeric;
  v_deposit_paid      numeric;
  v_pay_status        text;
  v_financial_changed boolean;
begin
  perform public.app_reject_pwa_financial_mutation();

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

  if v_deposit_paid < 0 then
    return jsonb_build_object('success', false, 'error', 'Deposit paid cannot be negative.');
  end if;

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
     set booking_date      = case when payload ? 'booking_date' then (payload->>'booking_date')::date else booking_date end,
         start_time        = case when payload ? 'start_time' then (payload->>'start_time')::time else start_time end,
         end_time          = case when payload ? 'end_time'   then (payload->>'end_time')::time   else end_time   end,
         client_name       = case when payload ? 'client_name' then payload->>'client_name' else client_name end,
         company           = case when payload ? 'company' then nullif(payload->>'company', '') else company end,
         attendees         = case when payload ? 'attendees' then coalesce((payload->>'attendees')::integer, 0) else attendees end,
         setup_type        = case when payload ? 'setup_type' then coalesce(payload->>'setup_type', 'Theatre') else setup_type end,
         room_name         = case when payload ? 'room_name' then coalesce(payload->>'room_name', 'Conference Room') else room_name end,
         includes_catering = case when payload ? 'includes_catering' then coalesce((payload->>'includes_catering')::boolean, false) else includes_catering end,
         catering_notes    = case when payload ? 'catering_notes' then nullif(payload->>'catering_notes', '') else catering_notes end,
         total_amount      = v_total_amount,
         deposit_paid      = v_deposit_paid,
         payment_status    = v_pay_status,
         payment_method    = case when payload ? 'payment_method' then nullif(payload->>'payment_method', '') else payment_method end,
         notes             = case when payload ? 'notes' then nullif(payload->>'notes', '') else notes end
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated, 'payment_status', v_pay_status);
end;
$update_conf$;

commit;
