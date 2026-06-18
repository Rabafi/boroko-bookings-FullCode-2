-- Add whole-lodge event quotations and make their conversion atomic.
-- The database remains authoritative for event totals, overlap checks, invoices,
-- quotation state, and deposits.

alter table public.quotations
  add column if not exists quotation_type text not null default 'room',
  add column if not exists event_name text,
  add column if not exists event_daily_rate numeric(12, 2);

alter table public.quotations
  drop constraint if exists quotations_type_check,
  add constraint quotations_type_check
    check (quotation_type in ('room', 'exclusive_event')),
  drop constraint if exists quotations_event_daily_rate_check,
  add constraint quotations_event_daily_rate_check
    check (event_daily_rate is null or event_daily_rate >= 0);

create or replace function public.normalize_quotation_booking_type()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_nights integer;
begin
  new.quotation_type := coalesce(nullif(btrim(new.quotation_type), ''), 'room');

  if new.check_in is not null
     and new.check_out is not null
     and new.check_out <= new.check_in then
    raise exception 'Check-out must be after check-in';
  end if;

  if new.quotation_type = 'exclusive_event' then
    if nullif(btrim(coalesce(new.event_name, '')), '') is null then
      raise exception 'Event / group name is required';
    end if;
    if new.check_in is null or new.check_out is null then
      raise exception 'Check-in and check-out dates are required for an event / lodge quotation';
    end if;
    if coalesce(new.event_daily_rate, 0) <= 0 then
      raise exception 'A valid whole-lodge daily rate is required';
    end if;

    v_nights := new.check_out - new.check_in;
    new.room_id := null;
    new.room_name := 'Full Lodge';
    new.adults := 1;
    new.children := 0;
    new.event_name := btrim(new.event_name);
    new.event_daily_rate := round(new.event_daily_rate::numeric, 2);
    new.subtotal := round((new.event_daily_rate * v_nights)::numeric, 2);
    new.tax_amount := 0;
    new.total_amount := new.subtotal;
  else
    new.quotation_type := 'room';
    new.event_name := null;
    new.event_daily_rate := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_quotation_booking_type on public.quotations;
create trigger trg_normalize_quotation_booking_type
before insert or update of
  quotation_type, event_name, event_daily_rate, room_id, room_name,
  check_in, check_out, adults, children, subtotal, tax_amount, total_amount
on public.quotations
for each row
execute function public.normalize_quotation_booking_type();

create or replace function public.guard_exclusive_event_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.lodge_id is null
     or new.check_in is null
     or new.check_out is null
     or coalesce(new.status, '') = 'cancelled' then
    return new;
  end if;

  -- Serialize booking writes for one lodge so a room booking and an exclusive
  -- event cannot both pass their overlap checks in concurrent transactions.
  perform pg_advisory_xact_lock(
    hashtextextended('booking-overlap:' || new.lodge_id::text, 0)
  );

  if coalesce(new.is_exclusive_event, false) then
    if exists (
      select 1
        from public.bookings b
       where b.lodge_id = new.lodge_id
         and b.id is distinct from new.id
         and coalesce(b.status, '') <> 'cancelled'
         and b.check_in < new.check_out
         and b.check_out > new.check_in
    ) then
      raise exception 'Cannot create exclusive event: the lodge already has bookings during these dates';
    end if;
  elsif exists (
    select 1
      from public.bookings b
     where b.lodge_id = new.lodge_id
       and b.id is distinct from new.id
       and coalesce(b.is_exclusive_event, false)
       and coalesce(b.status, '') <> 'cancelled'
       and b.check_in < new.check_out
       and b.check_out > new.check_in
  ) then
    raise exception 'The lodge is fully reserved for an exclusive event on these dates';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_exclusive_event_overlap on public.bookings;
create trigger trg_guard_exclusive_event_overlap
before insert or update of
  lodge_id, check_in, check_out, status, is_exclusive_event
on public.bookings
for each row
execute function public.guard_exclusive_event_overlap();

create or replace function public.create_quotation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (payload->>'id')::uuid;
  v_existing uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    (payload->>'lodge_id')::uuid,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

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
    quotation_type, event_name, event_daily_rate,
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
    coalesce(nullif(payload->>'quotation_type', ''), 'room'),
    nullif(payload->>'event_name', ''),
    nullif(payload->>'event_daily_rate', '')::numeric,
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
$$;

create or replace function public.update_quotation(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.quotations%rowtype;
  v_updated uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  select *
    into v_record
    from public.quotations
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if v_record.id is null then
    return jsonb_build_object('success', false, 'error', 'Quotation not found');
  end if;

  if p_expected_updated_at is not null
     and v_record.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'conflict',
      'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    );
  end if;

  update public.quotations
     set customer_id = case when payload ? 'customer_id' then nullif(payload->>'customer_id', '')::uuid else customer_id end,
         customer_name = case when payload ? 'customer_name' then coalesce(payload->>'customer_name', '') else customer_name end,
         customer_phone = case when payload ? 'customer_phone' then coalesce(payload->>'customer_phone', '') else customer_phone end,
         quotation_type = case when payload ? 'quotation_type' then coalesce(nullif(payload->>'quotation_type', ''), 'room') else quotation_type end,
         event_name = case when payload ? 'event_name' then nullif(payload->>'event_name', '') else event_name end,
         event_daily_rate = case when payload ? 'event_daily_rate' then nullif(payload->>'event_daily_rate', '')::numeric else event_daily_rate end,
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

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;

create or replace function public.update_quotation(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.update_quotation(p_id, p_lodge_id, payload, null::timestamptz);
$$;

create or replace function public.convert_quotation_to_booking(
  p_quotation_id uuid,
  p_lodge_id uuid,
  p_deposit_amount numeric default 0,
  p_payment_method text default 'cash',
  p_created_by uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q public.quotations%rowtype;
  v_booking_id uuid;
  v_room_id uuid;
  v_room_count integer := 0;
  v_inv_number text;
  v_dep_result jsonb;
  v_max_occupancy integer;
  v_is_event boolean;
  v_booking_notes text;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  select *
    into v_q
    from public.quotations
   where id = p_quotation_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    raise exception 'Quotation not found';
  end if;

  if v_q.status = 'converted' and v_q.converted_booking_id is not null then
    select b.invoice_number
      into v_inv_number
      from public.bookings b
     where b.id = v_q.converted_booking_id
       and b.lodge_id = p_lodge_id;

    return json_build_object(
      'success', true,
      'booking_id', v_q.converted_booking_id,
      'invoice_number', v_inv_number,
      'idempotent', true,
      'booking_type', v_q.quotation_type
    );
  end if;

  if v_q.status in ('converted', 'cancelled') then
    raise exception 'Quotation is already % and cannot be converted', v_q.status;
  end if;

  if v_q.status not in ('sent', 'accepted') then
    raise exception 'Quotation must be sent or accepted before conversion';
  end if;

  if v_q.check_in is null
     or v_q.check_out is null
     or v_q.check_out <= v_q.check_in then
    raise exception 'Valid check-in and check-out dates are required before conversion';
  end if;

  if coalesce(p_deposit_amount, 0) < 0 then
    raise exception 'Deposit amount cannot be negative';
  end if;

  if coalesce(p_deposit_amount, 0) > 0
     and nullif(btrim(coalesce(p_payment_method, '')), '') is null then
    raise exception 'Payment method is required when deposit amount is provided';
  end if;

  v_is_event := v_q.quotation_type = 'exclusive_event';

  -- This is the same lock used by the booking overlap trigger.
  perform pg_advisory_xact_lock(
    hashtextextended('booking-overlap:' || p_lodge_id::text, 0)
  );

  if v_is_event then
    if nullif(btrim(coalesce(v_q.event_name, '')), '') is null
       or v_q.check_in is null
       or v_q.check_out is null
       or coalesce(v_q.event_daily_rate, 0) <= 0 then
      raise exception 'Event / lodge quotation details are incomplete';
    end if;

    select count(*)
      into v_room_count
      from public.rooms r
     where r.lodge_id = p_lodge_id
       and coalesce(r.status, '') <> 'maintenance';

    select r.id
      into v_room_id
      from public.rooms r
     where r.lodge_id = p_lodge_id
       and coalesce(r.status, '') <> 'maintenance'
     order by r.room_number::text collate "C", r.id
     limit 1;

    if v_room_id is null or v_room_count = 0 then
      raise exception 'No rooms are available for an exclusive event booking';
    end if;

    if exists (
      select 1
        from public.bookings b
       where b.lodge_id = p_lodge_id
         and coalesce(b.status, '') <> 'cancelled'
         and b.check_in < v_q.check_out
         and b.check_out > v_q.check_in
    ) then
      raise exception 'Cannot create exclusive event: the lodge already has bookings during these dates';
    end if;

    v_booking_notes :=
      format('[GROUP:evt-quotation-%s][ROOMS:%s]', p_quotation_id, v_room_count)
      || E'\nEvent: ' || v_q.event_name
      || case when nullif(btrim(coalesce(v_q.notes, '')), '') is not null
              then E'\n' || v_q.notes
              else ''
         end;
  else
    v_room_id := v_q.room_id;
    v_booking_notes := v_q.notes;

    if v_room_id is not null then
      perform public.app_check_room_maintenance(p_lodge_id, v_room_id);

      select r.max_occupancy
        into v_max_occupancy
        from public.rooms r
       where r.id = v_room_id
         and r.lodge_id = p_lodge_id;

      if v_max_occupancy is not null
         and (v_q.adults + v_q.children) > v_max_occupancy then
        raise exception 'Number of guests exceeds room maximum occupancy';
      end if;

      if exists (
        select 1
          from public.bookings b
         where b.room_id = v_room_id
           and b.lodge_id = p_lodge_id
           and coalesce(b.status, '') <> 'cancelled'
           and b.check_in < v_q.check_out
           and b.check_out > v_q.check_in
      ) then
        raise exception 'Room is not available for the requested dates';
      end if;
    end if;
  end if;

  v_inv_number := public.get_next_invoice_number(p_lodge_id);
  v_booking_id := gen_random_uuid();

  insert into public.bookings (
    id, lodge_id, room_id, customer_id,
    check_in, check_out, adults, children,
    total_amount, amount_paid, deposit_amount, payment_status, payment_method,
    status, invoice_number, quotation_id, created_by, notes,
    is_exclusive_event, event_daily_rate, create_idempotency_key,
    created_at, updated_at
  ) values (
    v_booking_id, p_lodge_id, v_room_id, v_q.customer_id,
    v_q.check_in, v_q.check_out,
    case when v_is_event then 1 else v_q.adults end,
    case when v_is_event then 0 else v_q.children end,
    v_q.total_amount, 0, coalesce(p_deposit_amount, 0), 'unpaid', null,
    'confirmed', v_inv_number, p_quotation_id, p_created_by, v_booking_notes,
    v_is_event,
    case when v_is_event then v_q.event_daily_rate else null end,
    'quotation-conversion:' || p_quotation_id::text,
    now(), now()
  );

  insert into public.invoices (
    booking_id, lodge_id, invoice_number, issued_at, due_date
  ) values (
    v_booking_id, p_lodge_id, v_inv_number, now(), v_q.check_in
  )
  on conflict do nothing;

  update public.quotations
     set status = 'converted',
         converted_booking_id = v_booking_id,
         updated_at = now()
   where id = p_quotation_id
     and lodge_id = p_lodge_id;

  if coalesce(p_deposit_amount, 0) > 0 then
    select public.update_booking_payment(
      v_booking_id,
      p_lodge_id,
      p_deposit_amount,
      p_payment_method,
      'deposit',
      'payment:deposit:' || v_booking_id::text,
      p_created_by
    )
    into v_dep_result;

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
    'invoice_number', v_inv_number,
    'booking_type', v_q.quotation_type,
    'room_count', case when v_is_event then v_room_count else null end
  );
end;
$$;

grant execute on function public.create_quotation(jsonb) to anon, authenticated, service_role;
grant execute on function public.update_quotation(uuid, uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.update_quotation(uuid, uuid, jsonb, timestamptz) to anon, authenticated, service_role;
grant execute on function public.convert_quotation_to_booking(uuid, uuid, numeric, text, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
