-- Offline Queue Idempotency: Conference and Pool Day Use
-- Ensures desktop offline replays can safely retry after a crash without
-- creating duplicate conference bookings or day-use entries.

begin;

create or replace function public.create_conference_booking(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $create_conf$
declare
  v_id            uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_total_amount  numeric;
  v_deposit_paid  numeric;
  v_pay_status    text;
begin
  perform public.app_reject_pwa_financial_mutation();

  if exists (
    select 1 from public.conference_bookings
    where id = v_id
      and lodge_id = (payload->>'lodge_id')::uuid
  ) then
    return jsonb_build_object('success', true, 'id', v_id, 'idempotent', true);
  end if;

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
    id, lodge_id, booking_date, start_time, end_time,
    client_name, company, attendees, setup_type, room_name,
    includes_catering, catering_notes,
    total_amount, deposit_paid, payment_status, payment_method, notes
  ) values (
    v_id,
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
  );

  return jsonb_build_object('success', true, 'id', v_id, 'payment_status', v_pay_status);
end;
$create_conf$;

grant execute on function public.create_conference_booking(jsonb) to anon, authenticated;

create or replace function public.add_pool_day_use(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $pool_day_use$
declare
  v_id            uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id      uuid := (payload->>'lodge_id')::uuid;
  v_adults        integer := greatest(coalesce((payload->>'adults')::integer, 1), 0);
  v_children      integer := greatest(coalesce((payload->>'children')::integer, 0), 0);
  v_fee_per_adult numeric := coalesce((payload->>'fee_per_adult')::numeric, 0);
  v_fee_per_child numeric := coalesce((payload->>'fee_per_child')::numeric, 0);
  v_total         numeric;
begin
  if exists (
    select 1 from public.pool_day_use
    where id = v_id
      and lodge_id = v_lodge_id
  ) then
    select total into v_total
    from public.pool_day_use
    where id = v_id
      and lodge_id = v_lodge_id;
    return jsonb_build_object('success', true, 'id', v_id, 'total', v_total, 'idempotent', true);
  end if;

  if v_fee_per_adult < 0 or v_fee_per_adult > 999999.99 then
    raise exception 'Adult day-use fee must be between P0.00 and P999,999.99';
  end if;

  if v_fee_per_child < 0 or v_fee_per_child > 999999.99 then
    raise exception 'Child day-use fee must be between P0.00 and P999,999.99';
  end if;

  v_total := (v_adults * v_fee_per_adult) + (v_children * v_fee_per_child);

  insert into public.pool_day_use (
    id, lodge_id, date, guest_name, phone,
    adults, children, fee_per_adult, fee_per_child,
    total, payment_method, notes
  ) values (
    v_id,
    v_lodge_id,
    (payload->>'date')::date,
    coalesce(payload->>'guest_name', 'Walk-in'),
    nullif(payload->>'phone', ''),
    v_adults,
    v_children,
    v_fee_per_adult,
    v_fee_per_child,
    v_total,
    coalesce(payload->>'payment_method', 'cash'),
    nullif(payload->>'notes', '')
  );

  return jsonb_build_object('success', true, 'id', v_id, 'total', v_total);
end;
$pool_day_use$;

grant execute on function public.add_pool_day_use(jsonb) to anon, authenticated;

commit;
