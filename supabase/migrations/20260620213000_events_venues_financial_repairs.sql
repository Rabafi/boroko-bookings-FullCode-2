-- Forward-only repair for Events & Venues.
-- The foundation migrations were applied before the final verification fixes.

begin;

create unique index if not exists event_booking_line_items_source_uidx
  on public.event_booking_line_items (event_booking_id, source_reference)
  where source_reference is not null;

alter table public.event_booking_line_items
  drop constraint if exists event_line_item_non_negative;
alter table public.event_booking_line_items
  add constraint event_line_item_non_negative
  check (
    (line_type = 'pos')
    or (unit_price >= 0 and subtotal >= 0)
  );

create or replace function public.recalculate_event_totals(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resource_total numeric := 0;
  v_extra_total numeric := 0;
  v_pos_total numeric := 0;
  v_amount_paid numeric := 0;
  v_total numeric := 0;
begin
  select coalesce(sum(subtotal), 0)
    into v_resource_total
    from public.event_booking_resources
   where event_booking_id = p_event_id;

  select coalesce(sum(subtotal), 0)
    into v_extra_total
    from public.event_booking_line_items
   where event_booking_id = p_event_id
     and voided_at is null
     and line_type <> 'pos';

  select coalesce(sum(subtotal), 0)
    into v_pos_total
    from public.event_booking_line_items
   where event_booking_id = p_event_id
     and voided_at is null
     and line_type = 'pos';

  select coalesce(sum(
    case
      when lower(coalesce(type, '')) = 'refund' then -abs(amount)
      else amount
    end
  ), 0)
    into v_amount_paid
    from public.payments
   where conference_booking_id = p_event_id;

  v_total := round(v_resource_total + v_extra_total + v_pos_total, 2);

  update public.conference_bookings
     set subtotal = v_resource_total,
         extras_total = v_extra_total,
         charges_total = v_pos_total,
         total_amount = v_total,
         amount_paid = v_amount_paid,
         balance_due = greatest(0, v_total - v_amount_paid),
         deposit_paid = v_amount_paid,
         payment_status = case
           when v_total > 0 and v_amount_paid >= v_total then 'paid'
           when v_amount_paid > 0 then 'partial'
           else 'unpaid'
         end,
         updated_at = now()
   where id = p_event_id;
end;
$$;

-- Compatibility overload for the already-deployed POS function bodies.
create or replace function public.recalculate_event_totals(
  p_event_id uuid,
  p_lodge_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.conference_bookings
    where id = p_event_id and lodge_id = p_lodge_id
  ) then
    raise exception 'Event booking not found';
  end if;
  perform public.recalculate_event_totals(p_event_id);
end;
$$;

create or replace function public.create_event_booking(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_event_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_scope text := coalesce(nullif(btrim(payload->>'reservation_scope'), ''), 'venue_only');
  v_type text := coalesce(nullif(btrim(payload->>'event_type'), ''), 'conference');
  v_status text := coalesce(nullif(btrim(payload->>'status'), ''), 'reserved');
  v_date date := nullif(payload->>'booking_date', '')::date;
  v_start time := nullif(payload->>'start_time', '')::time;
  v_end time := nullif(payload->>'end_time', '')::time;
  v_check_in date := nullif(payload->>'check_in', '')::date;
  v_check_out date := nullif(payload->>'check_out', '')::date;
  v_base numeric := greatest(0, coalesce(nullif(payload->>'total_amount', '')::numeric, 0));
  v_deposit numeric := greatest(0, coalesce(nullif(payload->>'deposit_amount', '')::numeric, 0));
  v_payment_method text := nullif(btrim(coalesce(payload->>'payment_method', '')), '');
  v_exclusive_booking_id uuid;
  v_booking_id uuid;
  v_room_id uuid;
  v_room_ids jsonb := coalesce(payload->'room_ids', '[]'::jsonb);
  v_resource jsonb;
  v_resource_start timestamptz;
  v_resource_end timestamptz;
  v_resource_price numeric;
  v_invoice text;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if v_lodge_id is null or v_key is null or length(v_key) < 8 then
    return jsonb_build_object('success', false, 'error', 'Lodge and idempotency key are required');
  end if;
  if v_date is null or v_start is null or v_end is null or v_end <= v_start then
    return jsonb_build_object('success', false, 'error', 'A valid event date and time range is required');
  end if;
  if v_deposit > 0 and v_payment_method is null then
    return jsonb_build_object('success', false, 'error', 'Payment method is required for a deposit');
  end if;
  if v_scope in ('venue_with_rooms', 'exclusive_lodge')
     and (v_check_in is null or v_check_out is null or v_check_out <= v_check_in) then
    return jsonb_build_object('success', false, 'error', 'Valid room check-in and check-out dates are required');
  end if;

  select id, exclusive_booking_id into v_event_id, v_exclusive_booking_id
    from public.conference_bookings
   where lodge_id = v_lodge_id and create_idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'success', true,
      'event_id', v_event_id,
      'exclusive_booking_id', v_exclusive_booking_id,
      'idempotent', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended('booking-overlap:' || v_lodge_id::text, 0));

  if v_scope = 'exclusive_lodge' then
    if exists (
      select 1 from public.bookings booking
       where booking.lodge_id = v_lodge_id
         and coalesce(booking.status, '') <> 'cancelled'
         and booking.check_in < v_check_out
         and booking.check_out > v_check_in
    ) then
      return jsonb_build_object('success', false, 'error', 'Cannot create exclusive event: the lodge already has bookings during these dates');
    end if;

    select room.id into v_room_id
      from public.rooms room
     where room.lodge_id = v_lodge_id and coalesce(room.status, '') <> 'maintenance'
     order by room.room_number::text collate "C"
     limit 1;
    if v_room_id is null then
      return jsonb_build_object('success', false, 'error', 'No rooms are available for an exclusive event');
    end if;

    v_booking_id := gen_random_uuid();
    v_invoice := public.get_next_invoice_number(v_lodge_id);
    insert into public.bookings (
      id, lodge_id, room_id, customer_id, check_in, check_out,
      adults, children, total_amount, amount_paid, deposit_amount,
      payment_status, status, invoice_number, notes,
      is_exclusive_event, event_daily_rate, create_idempotency_key,
      created_at, updated_at
    ) values (
      v_booking_id, v_lodge_id, v_room_id,
      nullif(payload->>'customer_id', '')::uuid,
      v_check_in, v_check_out,
      greatest(1, coalesce(nullif(payload->>'adults', '')::integer, 1)),
      greatest(0, coalesce(nullif(payload->>'children', '')::integer, 0)),
      v_base, 0, 0, 'unpaid', 'confirmed', v_invoice,
      format('[GROUP:evt-%s] Event: %s', v_event_id, coalesce(payload->>'event_name', 'Exclusive Event')),
      true, nullif(payload->>'event_daily_rate', '')::numeric,
      'event-booking:' || v_event_id::text, now(), now()
    );
    insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at, due_date)
    values (v_booking_id, v_lodge_id, v_invoice, now(), v_check_in)
    on conflict do nothing;
    v_exclusive_booking_id := v_booking_id;
  end if;

  -- Parent first: every resource and room link below references it.
  insert into public.conference_bookings (
    id, lodge_id, customer_id, event_name, event_type, reservation_scope,
    status, booking_date, start_time, end_time, client_name, company,
    attendees, adults, children, setup_type, room_name,
    includes_catering, catering_notes, subtotal, extras_total,
    charges_total, total_amount, amount_paid, deposit_paid, balance_due,
    payment_status, payment_method, currency, exclusive_booking_id,
    quotation_id, create_idempotency_key, created_by, notes, updated_at
  ) values (
    v_event_id, v_lodge_id, nullif(payload->>'customer_id', '')::uuid,
    coalesce(nullif(payload->>'event_name', ''), nullif(payload->>'client_name', ''), 'Event'),
    v_type, v_scope, v_status, v_date, v_start, v_end,
    coalesce(nullif(payload->>'client_name', ''), 'Guest'),
    nullif(payload->>'company', ''),
    greatest(0, coalesce(nullif(payload->>'adults', '')::integer, 0) + coalesce(nullif(payload->>'children', '')::integer, 0)),
    greatest(0, coalesce(nullif(payload->>'adults', '')::integer, 0)),
    greatest(0, coalesce(nullif(payload->>'children', '')::integer, 0)),
    coalesce(nullif(payload->>'setup_type', ''), 'Default'),
    nullif(payload->>'room_name', ''),
    coalesce(nullif(payload->>'includes_catering', '')::boolean, false),
    nullif(payload->>'catering_notes', ''),
    0, 0, 0, 0, 0, 0, 0, 'unpaid', v_payment_method,
    coalesce(nullif(payload->>'currency', ''), 'BWP'),
    v_exclusive_booking_id, nullif(payload->>'quotation_id', '')::uuid,
    v_key, v_actor, nullif(payload->>'notes', ''), now()
  );

  if v_base > 0 then
    insert into public.event_booking_line_items (
      lodge_id, event_booking_id, line_type, description, category,
      quantity, unit_price, subtotal, source_reference, created_by
    ) values (
      v_lodge_id, v_event_id, 'venue', 'Event / venue fee', 'venue',
      1, v_base, v_base, 'event-base:' || v_event_id::text, v_actor
    );
  end if;

  for v_resource in
    select value from jsonb_array_elements(coalesce(payload->'resources', '[]'::jsonb))
  loop
    if nullif(btrim(coalesce(v_resource->>'resource_key', '')), '') is null then
      raise exception 'Every event resource requires a resource key';
    end if;
    v_resource_start := coalesce(
      nullif(v_resource->>'start_at', '')::timestamptz,
      (v_date::text || ' ' || v_start::text)::timestamp at time zone 'Africa/Gaborone'
    );
    v_resource_end := coalesce(
      nullif(v_resource->>'end_at', '')::timestamptz,
      (v_date::text || ' ' || v_end::text)::timestamp at time zone 'Africa/Gaborone'
    );
    if exists (
      select 1
        from public.event_booking_resources resource
        join public.conference_bookings event on event.id = resource.event_booking_id
       where resource.lodge_id = v_lodge_id
         and resource.resource_key = v_resource->>'resource_key'
         and event.status not in ('cancelled', 'completed')
         and resource.start_at < v_resource_end
         and resource.end_at > v_resource_start
    ) then
      raise exception 'Venue resource is already reserved: %', coalesce(v_resource->>'resource_name', v_resource->>'resource_key');
    end if;
    v_resource_price := greatest(0, coalesce(nullif(v_resource->>'unit_price', '')::numeric, 0));
    insert into public.event_booking_resources (
      lodge_id, event_booking_id, resource_key, resource_name_snapshot,
      resource_type_snapshot, start_at, end_at, quantity, exclusive_use,
      unit_price_snapshot, subtotal, created_by
    ) values (
      v_lodge_id, v_event_id, v_resource->>'resource_key',
      coalesce(nullif(v_resource->>'resource_name', ''), v_resource->>'resource_key'),
      coalesce(nullif(v_resource->>'resource_type', ''), 'venue'),
      v_resource_start, v_resource_end,
      greatest(1, coalesce(nullif(v_resource->>'quantity', '')::integer, 1)),
      coalesce(nullif(v_resource->>'exclusive_use', '')::boolean, true),
      v_resource_price,
      round(greatest(1, coalesce(nullif(v_resource->>'quantity', '')::integer, 1)) * v_resource_price, 2),
      v_actor
    );
  end loop;

  if v_scope = 'venue_with_rooms' then
    for v_room_id in
      select value::text::uuid from jsonb_array_elements_text(v_room_ids)
    loop
      perform public.app_check_room_maintenance(v_lodge_id, v_room_id);
      if not exists (select 1 from public.rooms where id = v_room_id and lodge_id = v_lodge_id) then
        raise exception 'Selected room does not belong to this lodge';
      end if;
      if exists (
        select 1 from public.bookings booking
         where booking.room_id = v_room_id
           and booking.lodge_id = v_lodge_id
           and coalesce(booking.status, '') <> 'cancelled'
           and booking.check_in < v_check_out
           and booking.check_out > v_check_in
      ) then
        raise exception 'Selected room is not available';
      end if;
      v_booking_id := gen_random_uuid();
      v_invoice := public.get_next_invoice_number(v_lodge_id);
      insert into public.bookings (
        id, lodge_id, room_id, customer_id, check_in, check_out,
        adults, children, total_amount, amount_paid, deposit_amount,
        payment_status, status, invoice_number, notes,
        create_idempotency_key, created_at, updated_at
      ) values (
        v_booking_id, v_lodge_id, v_room_id,
        nullif(payload->>'customer_id', '')::uuid,
        v_check_in, v_check_out,
        greatest(1, coalesce(nullif(payload->>'adults', '')::integer, 1)),
        greatest(0, coalesce(nullif(payload->>'children', '')::integer, 0)),
        (select room.rate_per_night * greatest(1, v_check_out - v_check_in)
           from public.rooms room where room.id = v_room_id),
        0, 0, 'unpaid', 'confirmed', v_invoice,
        format('[EVENT:%s] %s', v_event_id, coalesce(payload->>'event_name', 'Event Room')),
        'event-room:' || v_event_id::text || ':' || v_room_id::text,
        now(), now()
      );
      insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at, due_date)
      values (v_booking_id, v_lodge_id, v_invoice, now(), v_check_in)
      on conflict do nothing;
      insert into public.event_booking_rooms (
        lodge_id, event_booking_id, booking_id, room_id,
        relationship_type, created_by
      ) values (
        v_lodge_id, v_event_id, v_booking_id, v_room_id, 'guest_room', v_actor
      );
    end loop;
  end if;

  if v_deposit > 0 then
    insert into public.payments (
      lodge_id, conference_booking_id, amount, method, type,
      idempotency_key, recorded_by, paid_at
    ) values (
      v_lodge_id, v_event_id, v_deposit, v_payment_method, 'deposit',
      'event-deposit:' || v_event_id::text, v_actor, now()
    );
  end if;

  perform public.recalculate_event_totals(v_event_id);
  insert into public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id, idempotency_key
  ) values (
    v_lodge_id, v_event_id, 'event_created', v_actor, v_key
  );

  return jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'exclusive_booking_id', v_exclusive_booking_id
  );
end;
$$;

create or replace function public.update_event_payment(
  p_event_id uuid,
  p_lodge_id uuid,
  p_amount numeric,
  p_method text,
  p_type text default 'payment',
  p_idempotency_key text default null,
  p_recorded_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_effective_actor uuid;
  v_record public.conference_bookings%rowtype;
  v_payment_id uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  v_effective_actor := coalesce(p_recorded_by, v_actor);
  if v_effective_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required');
  end if;
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  end if;
  if nullif(btrim(coalesce(p_method, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Payment method is required');
  end if;
  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Idempotency key is required');
  end if;
  if lower(coalesce(p_type, 'payment')) not in ('payment', 'deposit', 'refund') then
    return jsonb_build_object('success', false, 'error', 'Payment type must be payment, deposit, or refund');
  end if;

  select * into v_record
    from public.conference_bookings
   where id = p_event_id and lodge_id = p_lodge_id
   for update;

  if v_record.id is null then
    return jsonb_build_object('success', false, 'error', 'Event booking not found');
  end if;
  if v_record.status in ('cancelled', 'completed') then
    return jsonb_build_object('success', false, 'error', 'Cannot record payment on a cancelled or completed event');
  end if;

  select id into v_payment_id
    from public.payments
   where lodge_id = p_lodge_id
     and conference_booking_id = p_event_id
     and idempotency_key = p_idempotency_key
   limit 1;
  if v_payment_id is not null then
    return jsonb_build_object('success', true, 'idempotent', true, 'payment_id', v_payment_id);
  end if;

  v_payment_id := gen_random_uuid();
  insert into public.payments (
    id, lodge_id, conference_booking_id, amount, method, type,
    idempotency_key, recorded_by, paid_at
  ) values (
    v_payment_id, p_lodge_id, p_event_id,
    case when lower(p_type) = 'refund' then -abs(p_amount) else abs(p_amount) end,
    p_method, lower(p_type), p_idempotency_key, v_effective_actor, now()
  );

  perform public.recalculate_event_totals(p_event_id);

  insert into public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id, amount_delta, idempotency_key
  ) values (
    p_lodge_id, p_event_id, 'event_payment_recorded', v_actor,
    case when lower(p_type) = 'refund' then -abs(p_amount) else abs(p_amount) end,
    p_idempotency_key
  );

  select * into v_record
    from public.conference_bookings
   where id = p_event_id;

  return jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'amount_paid', v_record.amount_paid,
    'balance_due', v_record.balance_due,
    'payment_status', v_record.payment_status
  );
end;
$$;

create or replace function public.update_event_booking(
  p_event_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_record public.conference_bookings%rowtype;
  v_updated_at timestamptz;
  v_base numeric;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  select * into v_record
    from public.conference_bookings
   where id = p_event_id and lodge_id = p_lodge_id
   for update;
  if v_record.id is null then
    return jsonb_build_object('success', false, 'error', 'Event booking not found');
  end if;
  if p_expected_updated_at is not null and v_record.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false, 'error', 'conflict', 'conflict', true,
      'message', 'This event was updated on another device. Refresh and reapply your change.'
    );
  end if;
  if payload ? 'reservation_scope'
     and nullif(btrim(payload->>'reservation_scope'), '') is distinct from v_record.reservation_scope then
    return jsonb_build_object(
      'success', false,
      'error', 'Reservation scope cannot be changed after creation. Cancel and recreate the event safely.'
    );
  end if;

  update public.conference_bookings
     set event_name = case when payload ? 'event_name' then coalesce(nullif(payload->>'event_name', ''), event_name) else event_name end,
         event_type = case when payload ? 'event_type' then coalesce(nullif(payload->>'event_type', ''), event_type) else event_type end,
         status = case when payload ? 'status' then coalesce(nullif(payload->>'status', ''), status) else status end,
         client_name = case when payload ? 'client_name' then coalesce(nullif(payload->>'client_name', ''), client_name) else client_name end,
         company = case when payload ? 'company' then nullif(payload->>'company', '') else company end,
         adults = case when payload ? 'adults' then greatest(0, coalesce(nullif(payload->>'adults', '')::integer, adults)) else adults end,
         children = case when payload ? 'children' then greatest(0, coalesce(nullif(payload->>'children', '')::integer, children)) else children end,
         attendees = case when payload ? 'adults' or payload ? 'children'
           then greatest(0, coalesce(nullif(payload->>'adults', '')::integer, adults))
              + greatest(0, coalesce(nullif(payload->>'children', '')::integer, children))
           else attendees end,
         room_name = case when payload ? 'room_name' then nullif(payload->>'room_name', '') else room_name end,
         setup_type = case when payload ? 'setup_type' then coalesce(nullif(payload->>'setup_type', ''), setup_type) else setup_type end,
         includes_catering = case when payload ? 'includes_catering' then coalesce(nullif(payload->>'includes_catering', '')::boolean, includes_catering) else includes_catering end,
         catering_notes = case when payload ? 'catering_notes' then nullif(payload->>'catering_notes', '') else catering_notes end,
         booking_date = case when payload ? 'booking_date' then coalesce(nullif(payload->>'booking_date', '')::date, booking_date) else booking_date end,
         start_time = case when payload ? 'start_time' then coalesce(nullif(payload->>'start_time', '')::time, start_time) else start_time end,
         end_time = case when payload ? 'end_time' then coalesce(nullif(payload->>'end_time', '')::time, end_time) else end_time end,
         currency = case when payload ? 'currency' then coalesce(nullif(payload->>'currency', ''), currency) else currency end,
         notes = case when payload ? 'notes' then nullif(payload->>'notes', '') else notes end,
         updated_at = now()
   where id = p_event_id
   returning updated_at into v_updated_at;

  if payload ? 'total_amount' then
    v_base := coalesce(nullif(payload->>'total_amount', '')::numeric, 0);
    if v_base < 0 then
      raise exception 'Event base amount cannot be negative';
    end if;
    insert into public.event_booking_line_items (
      lodge_id, event_booking_id, line_type, description, category,
      quantity, unit_price, subtotal, source_reference, created_by
    ) values (
      p_lodge_id, p_event_id, 'venue', 'Event / venue fee', 'venue',
      1, round(v_base, 2), round(v_base, 2),
      'event-base:' || p_event_id::text, v_actor
    )
    on conflict (event_booking_id, source_reference)
    where source_reference is not null
    do update set
      unit_price = excluded.unit_price,
      subtotal = excluded.subtotal,
      voided_at = null,
      void_reason = null;
  end if;

  perform public.recalculate_event_totals(p_event_id);
  insert into public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id, idempotency_key
  ) values (
    p_lodge_id, p_event_id, 'event_updated', v_actor, p_idempotency_key
  );
  return jsonb_build_object('success', true, 'event_id', p_event_id, 'updated_at', v_updated_at);
end;
$$;

create or replace function public.add_event_line_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_event_id uuid := nullif(payload->>'event_booking_id', '')::uuid;
  v_line_id uuid;
  v_quantity numeric := coalesce(nullif(payload->>'quantity', '')::numeric, 1);
  v_unit_price numeric := coalesce(nullif(payload->>'unit_price', '')::numeric, 0);
  v_subtotal numeric;
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_inventory_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_depletion numeric := nullif(payload->>'depletion_quantity', '')::numeric;
  v_stock numeric;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if v_event_id is null or v_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'Event and lodge are required');
  end if;
  if v_key is null or length(v_key) < 8 then
    return jsonb_build_object('success', false, 'error', 'Idempotency key is required');
  end if;
  if v_quantity <= 0 or v_unit_price < 0 then
    return jsonb_build_object('success', false, 'error', 'Quantity and price are invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('event-line:' || v_lodge_id::text || ':' || v_key, 0));

  select id into v_line_id
    from public.event_booking_line_items
   where event_booking_id = v_event_id and source_reference = v_key
   limit 1;
  if v_line_id is not null then
    return jsonb_build_object('success', true, 'line_item_id', v_line_id, 'idempotent', true);
  end if;

  perform 1
    from public.conference_bookings
   where id = v_event_id
     and lodge_id = v_lodge_id
     and status not in ('cancelled', 'completed')
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Event not found or in terminal state');
  end if;

  v_subtotal := round(v_quantity * v_unit_price, 2);
  if v_inventory_id is not null then
    v_depletion := coalesce(v_depletion, v_quantity);
    select current_stock into v_stock
      from public.inventory_items
     where id = v_inventory_id and lodge_id = v_lodge_id
     for update;
    if v_stock is null or v_stock < v_depletion then
      return jsonb_build_object('success', false, 'error', 'Insufficient inventory stock');
    end if;
    update public.inventory_items
       set current_stock = current_stock - v_depletion,
           updated_at = now()
     where id = v_inventory_id and lodge_id = v_lodge_id;
  end if;

  v_line_id := gen_random_uuid();
  insert into public.event_booking_line_items (
    id, lodge_id, event_booking_id, line_type, description, category,
    quantity, unit_price, subtotal, inventory_item_id, depletion_quantity,
    source_reference, created_by
  ) values (
    v_line_id, v_lodge_id, v_event_id,
    coalesce(nullif(btrim(payload->>'line_type'), ''), 'manual'),
    coalesce(nullif(btrim(payload->>'description'), ''), 'Event extra'),
    payload->>'category', v_quantity, v_unit_price, v_subtotal,
    v_inventory_id, v_depletion, v_key, v_actor
  );

  perform public.recalculate_event_totals(v_event_id);
  return jsonb_build_object('success', true, 'line_item_id', v_line_id, 'subtotal', v_subtotal);
end;
$$;

create or replace function public.check_event_resource_conflict(
  p_lodge_id uuid,
  p_resource_key text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_exclude_event_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );
  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'A valid event resource time range is required';
  end if;
  return exists (
    select 1
      from public.event_booking_resources resource
      join public.conference_bookings event on event.id = resource.event_booking_id
     where resource.lodge_id = p_lodge_id
       and resource.resource_key = p_resource_key
       and event.status not in ('cancelled', 'completed')
       and resource.start_at < p_end_at
       and resource.end_at > p_start_at
       and (p_exclude_event_id is null or resource.event_booking_id <> p_exclude_event_id)
  );
end;
$$;

create or replace function public.get_event_booking_details(
  p_event_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event jsonb;
  v_resources jsonb;
  v_lines jsonb;
  v_rooms jsonb;
  v_payments jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  select to_jsonb(event.*) into v_event
    from public.conference_bookings event
   where event.id = p_event_id and event.lodge_id = p_lodge_id;
  if v_event is null then
    return jsonb_build_object('success', false, 'error', 'Event not found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(resource.*) order by resource.start_at), '[]'::jsonb)
    into v_resources
    from public.event_booking_resources resource
   where resource.event_booking_id = p_event_id;

  select coalesce(jsonb_agg(to_jsonb(line.*) order by line.created_at), '[]'::jsonb)
    into v_lines
    from public.event_booking_line_items line
   where line.event_booking_id = p_event_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'booking_id', link.booking_id,
    'room_id', link.room_id,
    'room_number', room.room_number,
    'room_type', room.room_type,
    'check_in', booking.check_in,
    'check_out', booking.check_out,
    'total_amount', booking.total_amount,
    'amount_paid', booking.amount_paid,
    'payment_status', booking.payment_status
  )), '[]'::jsonb)
    into v_rooms
    from public.event_booking_rooms link
    join public.bookings booking on booking.id = link.booking_id
    left join public.rooms room on room.id = link.room_id
   where link.event_booking_id = p_event_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', payment.id,
    'amount', payment.amount,
    'method', payment.method,
    'type', payment.type,
    'paid_at', payment.paid_at,
    'recorded_by', payment.recorded_by
  ) order by payment.paid_at), '[]'::jsonb)
    into v_payments
    from public.payments payment
   where payment.conference_booking_id = p_event_id;

  return jsonb_build_object(
    'success', true,
    'event', v_event,
    'resources', v_resources,
    'line_items', v_lines,
    'rooms', v_rooms,
    'payments', v_payments
  );
end;
$$;

-- Repair existing events that were calculated using the old double-counting
-- implementation.
do $$
declare
  v_event_id uuid;
begin
  for v_event_id in select id from public.conference_bookings loop
    perform public.recalculate_event_totals(v_event_id);
  end loop;
end;
$$;

grant execute on function public.recalculate_event_totals(uuid) to service_role;
grant execute on function public.recalculate_event_totals(uuid, uuid) to service_role;
grant execute on function public.create_event_booking(jsonb) to anon, authenticated, service_role;
grant execute on function public.update_event_booking(uuid, uuid, jsonb, timestamptz, text) to anon, authenticated, service_role;
grant execute on function public.update_event_payment(uuid, uuid, numeric, text, text, text, uuid) to anon, authenticated, service_role;
grant execute on function public.add_event_line_item(jsonb) to anon, authenticated, service_role;
grant execute on function public.check_event_resource_conflict(uuid, text, timestamptz, timestamptz, uuid) to anon, authenticated, service_role;
grant execute on function public.get_event_booking_details(uuid, uuid) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
