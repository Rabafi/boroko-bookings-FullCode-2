begin;

create or replace function public.app_reject_pwa_financial_mutation()
returns void
language plpgsql
security definer
set search_path = public
as $app_guard$
declare
  v_session public.app_sessions%rowtype;
begin
  select *
    into v_session
    from public.app_current_session_row();

  if v_session.id is not null and v_session.session_type = 'pwa' then
    raise exception 'This action is only available in the Front Desk system.'
      using errcode = '42501';
  end if;
end;
$app_guard$;

revoke all on function public.app_reject_pwa_financial_mutation() from public, anon, authenticated;

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
         start_time        = case when payload ? 'start_time' then payload->>'start_time' else start_time end,
         end_time          = case when payload ? 'end_time' then payload->>'end_time' else end_time end,
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

create or replace function public.delete_conference_booking(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $delete_conf$
declare
  v_deleted uuid;
begin
  perform public.app_reject_pwa_financial_mutation();

  delete from public.conference_bookings
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$delete_conf$;

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
  v_inv_id     uuid;
  v_year       int := extract(year from now());
  v_seq        int;
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

  select coalesce(max(cast(substring(invoice_number from '[0-9]+$') as int)), 0) + 1
    into v_seq
    from invoices
   where lodge_id = p_lodge_id
     and invoice_number like 'INV-' || v_year || '-%';

  v_inv_number := 'INV-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  v_booking_id := gen_random_uuid();
  v_inv_id := gen_random_uuid();

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

create or replace function public.create_quotation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $create_quote$
declare
  v_id uuid := (payload->>'id')::uuid;
  v_existing uuid;
begin
  perform public.app_reject_pwa_financial_mutation();

  select id
    into v_existing
    from public.quotations
   where id = v_id
     and lodge_id = (payload->>'lodge_id')::uuid
   limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'id', v_existing,
      'quotation_number', payload->>'quotation_number',
      'idempotent', true
    );
  end if;

  insert into public.quotations (
    id, quotation_number, lodge_id, customer_id, customer_name, customer_phone,
    room_id, room_name, check_in, check_out, adults, children,
    subtotal, tax_amount, total_amount, currency, notes, status,
    valid_until, parent_quotation_id, created_by, created_at, updated_at
  ) values (
    v_id,
    payload->>'quotation_number',
    (payload->>'lodge_id')::uuid,
    nullif(payload->>'customer_id', '')::uuid,
    coalesce(payload->>'customer_name', ''),
    coalesce(payload->>'customer_phone', ''),
    nullif(payload->>'room_id', '')::uuid,
    coalesce(payload->>'room_name', ''),
    nullif(payload->>'check_in', '')::date,
    nullif(payload->>'check_out', '')::date,
    coalesce((payload->>'adults')::integer, 1),
    coalesce((payload->>'children')::integer, 0),
    coalesce((payload->>'subtotal')::numeric, 0),
    coalesce((payload->>'tax_amount')::numeric, 0),
    coalesce((payload->>'total_amount')::numeric, 0),
    coalesce(payload->>'currency', 'BWP'),
    coalesce(payload->>'notes', ''),
    coalesce(payload->>'status', 'draft'),
    nullif(payload->>'valid_until', '')::date,
    nullif(payload->>'parent_quotation_id', '')::uuid,
    nullif(payload->>'created_by', '')::uuid,
    coalesce((payload->>'created_at')::timestamptz, now()),
    coalesce((payload->>'updated_at')::timestamptz, now())
  );

  return jsonb_build_object(
    'success', true,
    'id', v_id,
    'quotation_number', payload->>'quotation_number'
  );
end;
$create_quote$;

create or replace function public.update_quotation(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $update_quote$
declare
  v_updated uuid;
begin
  perform public.app_reject_pwa_financial_mutation();

  update public.quotations
     set customer_id = case when payload ? 'customer_id' then nullif(payload->>'customer_id', '')::uuid else customer_id end,
         customer_name = case when payload ? 'customer_name' then coalesce(payload->>'customer_name', '') else customer_name end,
         customer_phone = case when payload ? 'customer_phone' then coalesce(payload->>'customer_phone', '') else customer_phone end,
         room_id = case when payload ? 'room_id' then nullif(payload->>'room_id', '')::uuid else room_id end,
         room_name = case when payload ? 'room_name' then coalesce(payload->>'room_name', '') else room_name end,
         check_in = case when payload ? 'check_in' then nullif(payload->>'check_in', '')::date else check_in end,
         check_out = case when payload ? 'check_out' then nullif(payload->>'check_out', '')::date else check_out end,
         adults = case when payload ? 'adults' then coalesce((payload->>'adults')::integer, 1) else adults end,
         children = case when payload ? 'children' then coalesce((payload->>'children')::integer, 0) else children end,
         subtotal = case when payload ? 'subtotal' then coalesce((payload->>'subtotal')::numeric, 0) else subtotal end,
         tax_amount = case when payload ? 'tax_amount' then coalesce((payload->>'tax_amount')::numeric, 0) else tax_amount end,
         total_amount = case when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0) else total_amount end,
         currency = case when payload ? 'currency' then coalesce(payload->>'currency', 'BWP') else currency end,
         notes = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
         status = case when payload ? 'status' then payload->>'status' else status end,
         valid_until = case when payload ? 'valid_until' then nullif(payload->>'valid_until', '')::date else valid_until end,
         updated_at = case when payload ? 'updated_at' then coalesce((payload->>'updated_at')::timestamptz, now()) else now() end
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Quotation not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$update_quote$;

create or replace function public.mark_quotation_sent(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $mark_quote_sent$
declare
  v_updated uuid;
begin
  perform public.app_reject_pwa_financial_mutation();

  update public.quotations
     set status = 'sent',
         updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id
     and status = 'draft'
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', true, 'id', p_id, 'noop', true);
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$mark_quote_sent$;

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
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $create_booking$
declare
  v_conflict    int;
  v_existing_id uuid;
  v_id          uuid := coalesce(p_booking_id, gen_random_uuid());
  v_is_existing boolean := false;
  v_dep_result  jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();

  if p_deposit_amount > 0 and p_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

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

  if not v_is_existing then
    select b.id into v_existing_id
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.id = v_id
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if p_invoice_number is null and not v_is_existing then
    p_invoice_number := get_next_invoice_number(p_lodge_id);
  end if;

  if not v_is_existing then
    select count(*) into v_conflict
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

    insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at)
    values (v_id, p_lodge_id, p_invoice_number, now())
    on conflict do nothing;
  end if;

  if p_deposit_amount > 0 and p_deposit_method is not null then
    select public.update_booking_payment(
      v_id, p_lodge_id, p_deposit_amount, p_deposit_method,
      'deposit', 'payment:deposit:' || v_id, p_created_by
    ) into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      if v_is_existing then
        return jsonb_build_object(
          'success', true,
          'booking_id', v_id,
          'depositWarning', coalesce(v_dep_result->>'error', 'Deposit could not be recorded')
        );
      end if;

      raise exception using
        message = 'Deposit failed',
        detail = coalesce(v_dep_result->>'error', 'unknown'),
        errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$create_booking$;

create or replace function public.create_booking_record(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $create_booking_record$
declare
  v_id             uuid := coalesce((payload->>'id')::uuid, gen_random_uuid());
  v_lodge_id       uuid := (payload->>'lodge_id')::uuid;
  v_room_id        uuid := (payload->>'room_id')::uuid;
  v_check_in       date := (payload->>'check_in')::date;
  v_check_out      date := (payload->>'check_out')::date;
  v_status         text := coalesce(payload->>'status', 'confirmed');
  v_conflict       uuid;
  v_existing_id    uuid;
  v_invoice_number text := nullif(payload->>'invoice_number', '');
  v_room_status    text;
  v_is_existing    boolean := false;
  v_deposit_amount numeric := coalesce((payload->>'deposit_amount')::numeric, 0);
  v_deposit_method text := nullif(payload->>'deposit_method', '');
  v_dep_result     jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();

  if v_deposit_amount > 0 and v_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

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

  if not v_is_existing then
    select b.id into v_existing_id
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.id = v_id
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if v_invoice_number is null and not v_is_existing then
    v_invoice_number := get_next_invoice_number(v_lodge_id);
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
       where id = v_room_id
         and lodge_id = v_lodge_id;
    end if;
  end if;

  if v_deposit_amount > 0 and v_deposit_method is not null then
    select public.update_booking_payment(
      v_id, v_lodge_id, v_deposit_amount, v_deposit_method,
      'deposit', 'payment:deposit:' || v_id,
      nullif(payload->>'created_by', '')::uuid
    ) into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      if v_is_existing then
        return jsonb_build_object(
          'success', true,
          'booking_id', v_id,
          'depositWarning', coalesce(v_dep_result->>'error', 'Deposit could not be recorded')
        );
      end if;

      raise exception using
        message = 'Deposit failed',
        detail = coalesce(v_dep_result->>'error', 'unknown'),
        errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$create_booking_record$;

create or replace function public.update_booking(
  p_id       uuid,
  p_lodge_id uuid,
  payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $update_booking$
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
  perform public.app_reject_pwa_financial_mutation();

  select *
    into v_current
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_room_id := coalesce((payload->>'room_id')::uuid, v_current.room_id);
  v_check_in := coalesce((payload->>'check_in')::date, v_current.check_in);
  v_check_out := coalesce((payload->>'check_out')::date, v_current.check_out);

  v_new_total := case
    when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0)
    else v_current.total_amount
  end;

  v_total_owed := v_new_total + coalesce(v_current.charges_total, 0);
  if v_total_owed < coalesce(v_current.amount_paid, 0) then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Cannot reduce booking total to %s: guest has already paid %s. Record a refund first, then adjust the total.',
        round(v_new_total::numeric, 2),
        round(coalesce(v_current.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

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

  v_new_status := public.compute_payment_status(
    coalesce(v_current.amount_paid, 0),
    v_new_total,
    coalesce(v_current.charges_total, 0)
  );

  update public.bookings
     set customer_id = coalesce((payload->>'customer_id')::uuid, customer_id),
         room_id = v_room_id,
         check_in = v_check_in,
         check_out = v_check_out,
         adults = case when payload ? 'adults' then coalesce((payload->>'adults')::int, 1) else adults end,
         children = case when payload ? 'children' then coalesce((payload->>'children')::int, 0) else children end,
         total_amount = v_new_total,
         payment_status = v_new_status,
         notes = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
         updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id, 'payment_status', v_new_status);
end;
$update_booking$;

create or replace function public.update_booking_status(
  p_id uuid,
  p_lodge_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $update_booking_status$
declare
  v_current_status text;
  v_room_id uuid;
  v_allowed boolean := false;
  v_room_status text;
begin
  perform public.app_reject_pwa_financial_mutation();

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
    return jsonb_build_object('success', false, 'error', format('Cannot transition booking from %s to %s', v_current_status, p_status));
  end if;

  update public.bookings
     set status = p_status,
         updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id;

  v_room_status := case
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
$update_booking_status$;

create or replace function public.add_booking_charge(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_description text,
  p_category text default 'other',
  p_quantity numeric default 1,
  p_unit_price numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $add_charge$
declare
  v_charge_id uuid;
  v_amount numeric;
begin
  perform public.app_reject_pwa_financial_mutation();

  if coalesce(p_unit_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Charge unit price must be greater than zero');
  end if;

  if not exists (
    select 1 from public.bookings
    where id = p_booking_id
      and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_amount := coalesce(p_quantity, 1) * coalesce(p_unit_price, 0);

  insert into public.booking_charges (
    booking_id, lodge_id, description, category, quantity, unit_price, amount
  ) values (
    p_booking_id,
    p_lodge_id,
    p_description,
    coalesce(nullif(p_category, ''), 'other'),
    coalesce(p_quantity, 1),
    coalesce(p_unit_price, 0),
    v_amount
  )
  returning id into v_charge_id;

  return jsonb_build_object('success', true, 'id', v_charge_id);
end;
$add_charge$;

create or replace function public.delete_booking_charge(
  p_charge_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $delete_charge$
declare
  v_deleted uuid;
begin
  perform public.app_reject_pwa_financial_mutation();

  delete from public.booking_charges
   where id = p_charge_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Charge not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$delete_charge$;

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
as $update_payment$
declare
  v_booking    public.bookings%rowtype;
  v_new_paid   numeric;
  v_total_owed numeric;
  v_status     text;
begin
  perform public.app_reject_pwa_financial_mutation();

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

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_new_paid := round((coalesce(v_booking.amount_paid, 0) + p_amount)::numeric, 2);
  v_total_owed := round((coalesce(v_booking.total_amount, 0) + coalesce(v_booking.charges_total, 0))::numeric, 2);

  if v_new_paid < 0 then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Adjustment of %s would reduce amount paid below zero (current: %s). Use the refund flow to reduce a guest''s paid balance.',
        round(p_amount::numeric, 2),
        round(coalesce(v_booking.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

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
$update_payment$;

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
as $refund_booking$
declare
  v_booking          public.bookings%rowtype;
  v_paid             numeric;
  v_retained_percent numeric;
  v_refund_amount    numeric;
  v_retained_amount  numeric;
  v_new_paid         numeric;
  v_status           text;
begin
  perform public.app_reject_pwa_financial_mutation();

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
  v_refund_amount := round((v_paid * ((100 - v_retained_percent) / 100.0))::numeric, 2);
  v_retained_amount := round((v_paid - v_refund_amount)::numeric, 2);

  if v_refund_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Retained percentage leaves nothing to refund');
  end if;

  v_new_paid := round(greatest(v_paid - v_refund_amount, 0)::numeric, 2);
  v_status := public.compute_payment_status(
    v_new_paid,
    v_booking.total_amount,
    v_booking.charges_total
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
    'success',          true,
    'booking_id',       p_booking_id,
    'refund_amount',    v_refund_amount,
    'retained_amount',  v_retained_amount,
    'retained_percent', v_retained_percent,
    'amount_paid',      v_new_paid,
    'payment_status',   v_status
  );
end;
$refund_booking$;

notify pgrst, 'reload schema';

commit;
