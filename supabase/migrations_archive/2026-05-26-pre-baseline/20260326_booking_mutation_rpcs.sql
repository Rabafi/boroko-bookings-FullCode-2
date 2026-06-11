create or replace function public.create_booking_record(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := coalesce((payload->>'id')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_check_in date := (payload->>'check_in')::date;
  v_check_out date := (payload->>'check_out')::date;
  v_status text := coalesce(payload->>'status', 'confirmed');
  v_conflict uuid;
  v_existing_id uuid;
  v_invoice_number text := nullif(payload->>'invoice_number', '');
  v_room_status text;
begin
  if payload ? 'create_idempotency_key' and nullif(payload->>'create_idempotency_key', '') is not null then
    select b.id
    into v_existing_id
    from public.bookings b
    where b.lodge_id = v_lodge_id
      and b.create_idempotency_key = payload->>'create_idempotency_key'
    limit 1;

    if found then
      return jsonb_build_object('success', true, 'booking_id', v_existing_id, 'idempotent', true);
    end if;
  end if;

  select b.id
  into v_existing_id
  from public.bookings b
  where b.lodge_id = v_lodge_id
    and b.id = v_id
  limit 1;

  if found then
    return jsonb_build_object('success', true, 'booking_id', v_existing_id, 'idempotent', true);
  end if;

  select b.id
  into v_conflict
  from public.bookings b
  where b.lodge_id = v_lodge_id
    and b.room_id = v_room_id
    and b.status <> 'cancelled'
    and not (b.check_out <= v_check_in or b.check_in >= v_check_out)
  limit 1;

  if v_conflict is not null then
    return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
  end if;

  insert into public.bookings (
    id,
    lodge_id,
    customer_id,
    room_id,
    check_in,
    check_out,
    adults,
    children,
    total_amount,
    amount_paid,
    payment_status,
    status,
    invoice_number,
    notes,
    created_by,
    deposit_amount,
    payment_method,
    is_exclusive_event,
    event_daily_rate,
    created_at,
    updated_at,
    create_idempotency_key
  ) values (
    v_id,
    v_lodge_id,
    (payload->>'customer_id')::uuid,
    v_room_id,
    v_check_in,
    v_check_out,
    coalesce((payload->>'adults')::int, 1),
    coalesce((payload->>'children')::int, 0),
    coalesce((payload->>'total_amount')::numeric, 0),
    coalesce((payload->>'amount_paid')::numeric, 0),
    coalesce(payload->>'payment_status', 'unpaid'),
    v_status,
    v_invoice_number,
    coalesce(payload->>'notes', ''),
    nullif(payload->>'created_by', '')::uuid,
    coalesce((payload->>'deposit_amount')::numeric, 0),
    nullif(payload->>'payment_method', ''),
    coalesce((payload->>'is_exclusive_event')::boolean, false),
    coalesce((payload->>'event_daily_rate')::numeric, 0),
    now(),
    now(),
    nullif(payload->>'create_idempotency_key', '')
  );

  if v_invoice_number is not null then
    insert into public.invoices (
      booking_id,
      lodge_id,
      invoice_number,
      issued_at
    ) values (
      v_id,
      v_lodge_id,
      v_invoice_number,
      now()
    )
    on conflict do nothing;
  end if;

  v_room_status :=
    case
      when v_status = 'checked_in' then 'occupied'
      when v_status in ('checked_out', 'cancelled') then 'available'
      else null
    end;

  if v_room_status is not null then
    update public.rooms
    set status = v_room_status
    where id = v_room_id
      and lodge_id = v_lodge_id;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$function$;

grant execute on function public.create_booking_record(jsonb) to anon, authenticated;

create or replace function public.update_booking(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current public.bookings%rowtype;
  v_room_id uuid;
  v_check_in date;
  v_check_out date;
  v_conflict uuid;
begin
  select *
  into v_current
  from public.bookings
  where id = p_id
    and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_room_id := coalesce((payload->>'room_id')::uuid, v_current.room_id);
  v_check_in := coalesce((payload->>'check_in')::date, v_current.check_in);
  v_check_out := coalesce((payload->>'check_out')::date, v_current.check_out);

  select b.id
  into v_conflict
  from public.bookings b
  where b.lodge_id = p_lodge_id
    and b.room_id = v_room_id
    and b.id <> p_id
    and b.status <> 'cancelled'
    and not (b.check_out <= v_check_in or b.check_in >= v_check_out)
  limit 1;

  if v_conflict is not null then
    return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
  end if;

  update public.bookings
  set
    customer_id = coalesce((payload->>'customer_id')::uuid, customer_id),
    room_id = v_room_id,
    check_in = v_check_in,
    check_out = v_check_out,
    adults = case when payload ? 'adults' then coalesce((payload->>'adults')::int, 1) else adults end,
    children = case when payload ? 'children' then coalesce((payload->>'children')::int, 0) else children end,
    total_amount = case when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0) else total_amount end,
    payment_status = case when payload ? 'payment_status' then coalesce(payload->>'payment_status', 'unpaid') else payment_status end,
    notes = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
    updated_at = now()
  where id = p_id
    and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id);
end;
$function$;

grant execute on function public.update_booking(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.update_booking_status(
  p_id uuid,
  p_lodge_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current_status text;
  v_room_id uuid;
  v_allowed boolean := false;
  v_room_status text;
begin
  select status, room_id
  into v_current_status, v_room_id
  from public.bookings
  where id = p_id
    and lodge_id = p_lodge_id;

  if v_current_status is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_allowed :=
    p_status = v_current_status
    or (v_current_status = 'pending' and p_status in ('confirmed', 'cancelled'))
    or (v_current_status = 'confirmed' and p_status in ('checked_in', 'cancelled'))
    or (v_current_status = 'checked_in' and p_status in ('checked_out'));

  if not v_allowed then
    return jsonb_build_object(
      'success', false,
      'error', format('Cannot transition booking from %s to %s', v_current_status, p_status)
    );
  end if;

  update public.bookings
  set
    status = p_status,
    updated_at = now()
  where id = p_id
    and lodge_id = p_lodge_id;

  v_room_status :=
    case
      when p_status = 'checked_in' then 'occupied'
      when p_status in ('checked_out', 'cancelled') then 'available'
      else null
    end;

  if v_room_status is not null and v_room_id is not null then
    update public.rooms
    set status = v_room_status
    where id = v_room_id
      and lodge_id = p_lodge_id;
  end if;

  return jsonb_build_object('success', true, 'id', p_id, 'status', p_status);
end;
$function$;

grant execute on function public.update_booking_status(uuid, uuid, text) to anon, authenticated;
