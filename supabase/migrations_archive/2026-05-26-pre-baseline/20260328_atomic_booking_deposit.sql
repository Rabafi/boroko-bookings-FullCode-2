-- P1-3: Atomic booking creation + initial deposit
--
-- Extends create_booking, create_booking_record, and convert_quotation_to_booking
-- to apply the initial deposit inside the same PL/pgSQL transaction as the booking insert.
--
-- Fresh transaction:  if deposit fails → raise exception → booking insert rolls back → atomic.
-- Idempotent replay:  if deposit fails → return { success: true, depositWarning } → non-fatal.
-- Validation:         deposit_amount > 0 with null method → validation error before any insert.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. create_booking
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.create_booking(
  p_lodge_id        uuid,
  p_customer_id     uuid,
  p_room_id         uuid,
  p_check_in        date,
  p_check_out       date,
  p_adults          integer,
  p_children        integer,
  p_total_amount    numeric,
  p_invoice_number  text    default null,
  p_notes           text    default '',
  p_created_by      uuid    default null,
  p_deposit_amount  numeric default 0,
  p_booking_id      uuid    default null,
  p_idempotency_key text    default null,
  p_deposit_method  text    default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conflict    int;
  v_existing_id uuid;
  v_id          uuid    := coalesce(p_booking_id, gen_random_uuid());
  v_is_existing boolean := false;
  v_dep_result  jsonb;
begin
  -- Validation: deposit amount requires a method
  if p_deposit_amount > 0 and p_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

  -- Idempotency check (booking create key)
  if p_idempotency_key is not null then
    select b.id into v_existing_id
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.create_idempotency_key = p_idempotency_key
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  -- ID collision check
  if not v_is_existing then
    select b.id into v_existing_id
      from public.bookings b
     where b.lodge_id = p_lodge_id and b.id = v_id
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if not v_is_existing then
    -- Room overlap check
    select count(*) into v_conflict
      from public.bookings
     where room_id = p_room_id
       and lodge_id = p_lodge_id
       and status != 'cancelled'
       and not (check_out <= p_check_in or check_in >= p_check_out);

    if v_conflict > 0 then
      return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
    end if;

    -- Insert booking; amount_paid = 0 always — deposit applied below via update_booking_payment
    insert into public.bookings (
      id, lodge_id, customer_id, room_id,
      check_in, check_out, adults, children,
      total_amount, amount_paid, payment_status,
      status, invoice_number, notes, created_by,
      deposit_amount, payment_method,
      created_at, updated_at, create_idempotency_key
    ) values (
      v_id, p_lodge_id, p_customer_id, p_room_id,
      p_check_in, p_check_out, p_adults, p_children,
      p_total_amount, 0, 'unpaid',
      'confirmed', p_invoice_number, p_notes, p_created_by,
      p_deposit_amount, null,
      now(), now(), p_idempotency_key
    );

    insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at)
    values (v_id, p_lodge_id, p_invoice_number, now())
    on conflict do nothing;
  end if;

  -- Deposit: atomic in same transaction.
  -- Idempotency key 'payment:deposit:{id}' prevents double-recording on replay.
  if p_deposit_amount > 0 and p_deposit_method is not null then
    select public.update_booking_payment(
      v_id, p_lodge_id, p_deposit_amount, p_deposit_method,
      'deposit', 'payment:deposit:' || v_id, p_created_by
    ) into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      if v_is_existing then
        -- Idempotent replay: booking pre-existed; deposit failure is non-fatal here.
        -- Frontend P1-2 depositWarning handling picks this up for operator action.
        return jsonb_build_object(
          'success',        true,
          'booking_id',     v_id,
          'depositWarning', coalesce(v_dep_result->>'error', 'Deposit could not be recorded')
        );
      else
        -- Fresh transaction: deposit failure rolls back booking insert too.
        raise exception using
          message = 'Deposit failed',
          detail  = coalesce(v_dep_result->>'error', 'unknown'),
          errcode = 'P0001';
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. create_booking_record (event bookings — JSONB payload variant)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.create_booking_record(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id             uuid    := coalesce((payload->>'id')::uuid, gen_random_uuid());
  v_lodge_id       uuid    := (payload->>'lodge_id')::uuid;
  v_room_id        uuid    := (payload->>'room_id')::uuid;
  v_check_in       date    := (payload->>'check_in')::date;
  v_check_out      date    := (payload->>'check_out')::date;
  v_status         text    := coalesce(payload->>'status', 'confirmed');
  v_conflict       uuid;
  v_existing_id    uuid;
  v_invoice_number text    := nullif(payload->>'invoice_number', '');
  v_room_status    text;
  v_is_existing    boolean := false;
  v_deposit_amount numeric := coalesce((payload->>'deposit_amount')::numeric, 0);
  v_deposit_method text    := nullif(payload->>'deposit_method', '');
  v_dep_result     jsonb;
begin
  -- Validation: deposit amount requires a method
  if v_deposit_amount > 0 and v_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

  -- Idempotency check
  if payload ? 'create_idempotency_key' and nullif(payload->>'create_idempotency_key', '') is not null then
    select b.id into v_existing_id
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.create_idempotency_key = payload->>'create_idempotency_key'
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  -- ID collision check
  if not v_is_existing then
    select b.id into v_existing_id
      from public.bookings b
     where b.lodge_id = v_lodge_id and b.id = v_id
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if not v_is_existing then
    select b.id into v_conflict
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
      id, lodge_id, customer_id, room_id,
      check_in, check_out, adults, children,
      total_amount, amount_paid, payment_status,
      status, invoice_number, notes, created_by,
      deposit_amount, payment_method,
      is_exclusive_event, event_daily_rate,
      created_at, updated_at, create_idempotency_key
    ) values (
      v_id, v_lodge_id, (payload->>'customer_id')::uuid, v_room_id,
      v_check_in, v_check_out,
      coalesce((payload->>'adults')::int, 1),
      coalesce((payload->>'children')::int, 0),
      coalesce((payload->>'total_amount')::numeric, 0),
      0, 'unpaid',
      v_status, v_invoice_number,
      coalesce(payload->>'notes', ''),
      nullif(payload->>'created_by', '')::uuid,
      v_deposit_amount, null,
      coalesce((payload->>'is_exclusive_event')::boolean, false),
      coalesce((payload->>'event_daily_rate')::numeric, 0),
      now(), now(),
      nullif(payload->>'create_idempotency_key', '')
    );

    if v_invoice_number is not null then
      insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at)
      values (v_id, v_lodge_id, v_invoice_number, now())
      on conflict do nothing;
    end if;

    v_room_status := case
      when v_status = 'checked_in' then 'occupied'
      when v_status in ('checked_out', 'cancelled') then 'available'
      else null
    end;

    if v_room_status is not null then
      update public.rooms
         set status = v_room_status
       where id = v_room_id and lodge_id = v_lodge_id;
    end if;
  end if;

  -- Deposit: atomic in same transaction
  if v_deposit_amount > 0 and v_deposit_method is not null then
    select public.update_booking_payment(
      v_id, v_lodge_id, v_deposit_amount, v_deposit_method,
      'deposit', 'payment:deposit:' || v_id,
      nullif(payload->>'created_by', '')::uuid
    ) into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      if v_is_existing then
        return jsonb_build_object(
          'success',        true,
          'booking_id',     v_id,
          'depositWarning', coalesce(v_dep_result->>'error', 'Deposit could not be recorded')
        );
      else
        raise exception using
          message = 'Deposit failed',
          detail  = coalesce(v_dep_result->>'error', 'unknown'),
          errcode = 'P0001';
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$function$;

grant execute on function public.create_booking_record(jsonb) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. convert_quotation_to_booking
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.convert_quotation_to_booking(
  p_quotation_id   uuid,
  p_lodge_id       uuid,
  p_deposit_amount numeric default 0,
  p_payment_method text    default 'cash',
  p_created_by     uuid    default null
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_q          quotations%rowtype;
  v_booking_id uuid;
  v_inv_number text;
  v_inv_id     uuid;
  v_year       int  := extract(year from now());
  v_seq        int;
  v_dep_result jsonb;
begin
  -- Validation: deposit amount requires a method
  if p_deposit_amount > 0 and p_payment_method is null then
    raise exception 'Payment method is required when deposit amount is provided';
  end if;

  select * into v_q
    from quotations
   where id = p_quotation_id and lodge_id = p_lodge_id
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

  if v_q.room_id is not null then
    if exists (
      select 1 from bookings
       where room_id   = v_q.room_id
         and lodge_id  = p_lodge_id
         and status   not in ('cancelled', 'checked_out')
         and check_in  < v_q.check_out
         and check_out > v_q.check_in
    ) then
      raise exception 'Room is not available for the requested dates';
    end if;
  end if;

  select coalesce(max(cast(substring(invoice_number from '[0-9]+$') as int)), 0) + 1
    into v_seq
    from invoices
   where lodge_id       = p_lodge_id
     and invoice_number like 'INV-' || v_year || '-%';

  v_inv_number := 'INV-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  v_booking_id := gen_random_uuid();
  v_inv_id     := gen_random_uuid();

  -- Insert booking; amount_paid = 0 always — deposit applied below via update_booking_payment
  insert into bookings (
    id, lodge_id, room_id, customer_id, customer_name,
    check_in, check_out, adults, children,
    total_amount, amount_paid, payment_status, payment_method,
    status, quotation_id, created_by, created_at, updated_at
  ) values (
    v_booking_id, p_lodge_id, v_q.room_id, v_q.customer_id, v_q.customer_name,
    v_q.check_in, v_q.check_out, v_q.adults, v_q.children,
    v_q.total_amount, 0, 'unpaid', p_payment_method,
    'confirmed', p_quotation_id, p_created_by, now(), now()
  );

  insert into invoices (
    id, lodge_id, booking_id, invoice_number,
    total_amount, amount_paid, status, created_at, updated_at
  ) values (
    v_inv_id, p_lodge_id, v_booking_id, v_inv_number,
    v_q.total_amount, 0, 'unpaid', now(), now()
  );

  update quotations
     set status               = 'converted',
         converted_booking_id = v_booking_id,
         updated_at           = now()
   where id = p_quotation_id;

  -- Deposit: atomic in same transaction (convert has no idempotency key — always a fresh call)
  if p_deposit_amount > 0 then
    select public.update_booking_payment(
      v_booking_id, p_lodge_id, p_deposit_amount, p_payment_method,
      'deposit', 'payment:deposit:' || v_booking_id, p_created_by
    ) into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      raise exception using
        message = 'Deposit failed',
        detail  = coalesce(v_dep_result->>'error', 'unknown'),
        errcode = 'P0001';
    end if;
  end if;

  return json_build_object(
    'success',        true,
    'booking_id',     v_booking_id,
    'invoice_number', v_inv_number
  );
end;
$function$;
