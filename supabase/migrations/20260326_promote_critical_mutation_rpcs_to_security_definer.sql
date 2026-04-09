create or replace function public.create_booking(
  p_lodge_id uuid,
  p_customer_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_total_amount numeric,
  p_invoice_number text default null,
  p_notes text default '',
  p_created_by uuid default null,
  p_deposit_amount numeric default 0,
  p_booking_id uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_conflict    int;
  v_existing_id uuid;
  v_id          uuid := coalesce(p_booking_id, gen_random_uuid());
begin
  if p_idempotency_key is not null then
    select b.id
      into v_existing_id
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.create_idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return jsonb_build_object(
        'success', true,
        'booking_id', v_existing_id,
        'idempotent', true
      );
    end if;
  end if;

  select b.id
    into v_existing_id
  from public.bookings b
  where b.lodge_id = p_lodge_id
    and b.id = v_id
  limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'booking_id', v_existing_id,
      'idempotent', true
    );
  end if;

  select count(*)
    into v_conflict
  from public.bookings
  where room_id = p_room_id
    and lodge_id = p_lodge_id
    and status != 'cancelled'
    and not (check_out <= p_check_in or check_in >= p_check_out);

  if v_conflict > 0 then
    return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
  end if;

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

  insert into public.invoices (
    booking_id, lodge_id, invoice_number, issued_at
  ) values (
    v_id, p_lodge_id, p_invoice_number, now()
  )
  on conflict do nothing;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$function$;

create or replace function public.update_booking_payment(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_amount numeric,
  p_method text,
  p_type text default 'payment',
  p_idempotency_key text default null,
  p_recorded_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking  bookings%rowtype;
  v_new_paid numeric;
  v_status   text;
begin
  if p_idempotency_key is not null then
    if exists (select 1 from payments where idempotency_key = p_idempotency_key) then
      select amount_paid, payment_status into v_new_paid, v_status
        from bookings where id = p_booking_id;
      return jsonb_build_object(
        'success',        true,
        'amount_paid',    v_new_paid,
        'payment_status', v_status,
        'idempotent',     true
      );
    end if;
  end if;

  select * into v_booking from bookings
    where id = p_booking_id and lodge_id = p_lodge_id
    for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_new_paid := coalesce(v_booking.amount_paid, 0) + p_amount;

  v_status := case
    when v_new_paid >= v_booking.total_amount then 'paid'
    when v_new_paid > 0                       then 'partial'
    else 'unpaid'
  end;

  update bookings set
    amount_paid    = v_new_paid,
    payment_status = v_status,
    payment_method = coalesce(p_method, payment_method),
    updated_at     = now()
  where id = p_booking_id and lodge_id = p_lodge_id;

  insert into payments (
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

create or replace function public.convert_quotation_to_booking(
  p_quotation_id uuid,
  p_lodge_id uuid,
  p_deposit_amount numeric default 0,
  p_payment_method text default 'cash',
  p_created_by uuid default null
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
  v_year       int := extract(year from now());
  v_seq        int;
begin
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

  return json_build_object(
    'success',        true,
    'booking_id',     v_booking_id,
    'invoice_number', v_inv_number
  );
end;
$function$;
