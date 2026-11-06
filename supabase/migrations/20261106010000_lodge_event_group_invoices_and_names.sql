-- Lodge events, customer identity and consolidated invoices.
--
-- This is a forward-only contract change. It:
--   * stores a customer-name snapshot on accommodation bookings so a missing
--     customer join cannot erase an already captured name;
--   * lets one group invoice own an event and its linked room reservations;
--   * creates exactly one customer-facing invoice per event reservation;
--   * projects event/group invoices (including settled and zero-total rows)
--     through get_invoice_summary for the Manager PWA; and
--   * provides a scoped, dry-run repair contract for historical event rows.
--
-- Child room bookings and their historical invoice numbers remain intact. The
-- group invoice is an additional customer-facing wrapper, not a replacement
-- for availability, housekeeping, payment or refund history.

begin;

-- ── 1. Persisted customer-name snapshots ────────────────────────────────────
alter table public.bookings
  add column if not exists customer_name text;

-- Bind a reused creation key to the original exact command envelope. Existing
-- rows stay nullable because their original client payload is not recoverable.
alter table public.conference_bookings
  add column if not exists create_payload_hash text;

alter table public.booking_invoice_groups
  add column if not exists event_booking_id uuid;

alter table public.booking_invoice_groups
  add column if not exists customer_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'booking_invoice_groups_event_booking_id_fkey'
       and conrelid = 'public.booking_invoice_groups'::regclass
  ) then
    alter table public.booking_invoice_groups
      add constraint booking_invoice_groups_event_booking_id_fkey
      foreign key (event_booking_id)
      references public.conference_bookings(id)
      on delete set null;
  end if;
end;
$$;

create unique index if not exists booking_invoice_groups_event_uidx
  on public.booking_invoice_groups(lodge_id, event_booking_id)
  where event_booking_id is not null;

-- ── 2. One group invoice per event reservation ──────────────────────────────
-- Unlike create_booking_invoice_group, an event group may contain one booking
-- (exclusive lodge) or no room bookings at all (venue-only event). Every
-- booking must already be linked to the event and share the same customer.
create or replace function public.create_event_invoice_group(
  p_lodge_id uuid,
  p_event_id uuid,
  p_group_key text,
  p_customer_id uuid default null,
  p_booking_ids uuid[] default '{}'::uuid[],
  p_invoice_number text default null,
  p_notes text default null,
  p_created_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_group_key text := nullif(btrim(coalesce(p_group_key, '')), '');
  v_invoice_number text := nullif(btrim(coalesce(p_invoice_number, '')), '');
  v_event public.conference_bookings%rowtype;
  v_existing public.booking_invoice_groups%rowtype;
  v_group_id uuid;
  v_booking_count integer := coalesce(array_length(p_booking_ids, 1), 0);
  v_valid_count integer;
  v_idx integer := 1;
  v_booking_id uuid;
  v_customer_name text;
  v_due_date date;
  v_changed boolean := false;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if p_lodge_id is null or p_event_id is null or v_group_key is null then
    return jsonb_build_object('success', false, 'error', 'Lodge, event and group key are required');
  end if;
  if length(v_group_key) < 8 then
    return jsonb_build_object('success', false, 'error', 'Event invoice group key is too short');
  end if;

  select * into v_event
    from public.conference_bookings
   where id = p_event_id
     and lodge_id = p_lodge_id
   for update;
  if v_event.id is null then
    return jsonb_build_object('success', false, 'error', 'Event booking not found in this lodge');
  end if;

  if p_customer_id is not null
     and not exists (
       select 1 from public.customers c
        where c.id = p_customer_id and c.lodge_id = p_lodge_id
     ) then
    return jsonb_build_object('success', false, 'error', 'Customer does not belong to this lodge');
  end if;
  if v_event.customer_id is distinct from p_customer_id then
    return jsonb_build_object(
      'success', false,
      'error', 'The event and its invoice group must share the same customer'
    );
  end if;

  if v_booking_count = 0 then
    if v_event.reservation_scope <> 'venue_only' then
      return jsonb_build_object(
        'success', false,
        'error', 'An accommodation event must have at least one linked room booking'
      );
    end if;
  else
    select count(*) into v_valid_count
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.customer_id is not distinct from p_customer_id
       and b.id = any(p_booking_ids)
       and (
         b.id = v_event.exclusive_booking_id
         or exists (
           select 1 from public.event_booking_rooms r
            where r.event_booking_id = p_event_id
              and r.booking_id = b.id
              and r.lodge_id = p_lodge_id
         )
         or coalesce(b.notes, '') like '%[EVENT:' || p_event_id::text || ']%'
         or coalesce(b.notes, '') like '%[GROUP:evt-' || p_event_id::text || ']%'
       );

    if v_valid_count <> v_booking_count then
      return jsonb_build_object(
        'success', false,
        'error', 'Every group booking must belong to this lodge, customer and event'
      );
    end if;

    -- Never steal a booking from another group invoice silently.
    if exists (
      select 1
        from public.booking_invoice_group_lines l
        join public.booking_invoice_groups g on g.id = l.group_id
       where l.booking_id = any(p_booking_ids)
         and l.lodge_id = p_lodge_id
         and g.event_booking_id is distinct from p_event_id
    ) then
      return jsonb_build_object(
        'success', false,
        'error', 'A linked booking already belongs to a different invoice group'
      );
    end if;
  end if;

  select *
    into v_existing
    from public.booking_invoice_groups g
   where g.lodge_id = p_lodge_id
     and (
       g.group_key = v_group_key
       or g.event_booking_id = p_event_id
     )
   limit 1;

  if found then
    v_group_id := v_existing.id;
    v_invoice_number := v_existing.invoice_number;

    -- The group identity must not silently drift. If membership or customer
    -- changed, fail closed and require an explicit reviewed repair.
    if v_existing.event_booking_id is distinct from p_event_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Existing invoice group is linked to a different event'
      );
    end if;
    if v_existing.customer_id is distinct from p_customer_id then
      return jsonb_build_object(
        'success', false,
        'error', 'Existing invoice group belongs to a different customer'
      );
    end if;

    if exists (
      select 1 from public.booking_invoice_group_lines l
       where l.group_id = v_group_id
         and not (l.booking_id = any(coalesce(p_booking_ids, '{}'::uuid[])))
    ) or exists (
      select 1 from unnest(coalesce(p_booking_ids, '{}'::uuid[])) requested(booking_id)
       where not exists (
         select 1 from public.booking_invoice_group_lines l
          where l.group_id = v_group_id and l.booking_id = requested.booking_id
       )
    ) then
      return jsonb_build_object(
        'success', false,
        'error', 'Existing invoice group membership differs from the requested room set'
      );
    end if;
  else
    if v_invoice_number is null then
      v_invoice_number := public.get_next_invoice_number(p_lodge_id);
    end if;

    select nullif(btrim(coalesce(c.name, '')), '')
      into v_customer_name
      from public.customers c
     where c.id = p_customer_id
       and c.lodge_id = p_lodge_id;

    v_customer_name := coalesce(v_customer_name, nullif(btrim(coalesce(v_event.client_name, '')), ''));

    select coalesce(min(b.check_in), v_event.booking_date)
      into v_due_date
      from public.bookings b
     where b.id = any(p_booking_ids)
       and b.lodge_id = p_lodge_id;

    insert into public.booking_invoice_groups (
      lodge_id, group_key, customer_id, customer_name, event_booking_id,
      invoice_number, due_date, notes, created_by
    ) values (
      p_lodge_id, v_group_key, p_customer_id, v_customer_name, p_event_id,
      v_invoice_number, v_due_date, nullif(p_notes, ''), v_actor
    ) returning id into v_group_id;
    v_changed := true;
  end if;

  -- Backfill the snapshot on the group when it is still blank. Existing names
  -- are preserved; only blank values are filled.
  if v_existing.id is not null and v_existing.customer_name is null and v_customer_name is not null then
    update public.booking_invoice_groups
       set customer_name = v_customer_name,
           updated_at = now()
     where id = v_group_id;
    v_changed := true;
  end if;

  foreach v_booking_id in array coalesce(p_booking_ids, '{}'::uuid[]) loop
    insert into public.booking_invoice_group_lines (
      group_id, booking_id, lodge_id, line_order
    ) values (
      v_group_id, v_booking_id, p_lodge_id, v_idx
    )
    on conflict (booking_id) do update
      set group_id = excluded.group_id,
          lodge_id = excluded.lodge_id,
          line_order = excluded.line_order;
    v_idx := v_idx + 1;
  end loop;

  if v_changed then
    insert into public.financial_audit_log (
      lodge_id, event_booking_id, action, actor_id, idempotency_key,
      after_snapshot
    ) values (
      p_lodge_id, p_event_id, 'event_invoice_group_created', v_actor,
      'event-invoice-group:' || p_event_id::text,
      jsonb_build_object(
        'group_id', v_group_id,
        'group_key', v_group_key,
        'invoice_number', v_invoice_number,
        'booking_ids', to_jsonb(coalesce(p_booking_ids, '{}'::uuid[])),
        'customer_id', p_customer_id
      )
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'group_id', v_group_id,
    'group_key', v_group_key,
    'invoice_number', v_invoice_number,
    'event_id', p_event_id,
    'booking_ids', to_jsonb(coalesce(p_booking_ids, '{}'::uuid[])),
    'idempotent', not v_changed
  );
end;
$$;

revoke all on function public.create_event_invoice_group(uuid, uuid, text, uuid, uuid[], text, text, uuid) from public;
grant execute on function public.create_event_invoice_group(uuid, uuid, text, uuid, uuid[], text, text, uuid)
  to authenticated, service_role;

-- ── 3. Authoritative event creation with one consolidated invoice ───────────
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
  v_daily_rate numeric := nullif(payload->>'event_daily_rate', '')::numeric;
  v_room_count integer := 0;
  v_deposit numeric := greatest(0, coalesce(nullif(payload->>'deposit_amount', '')::numeric, 0));
  v_payment_method text := nullif(btrim(coalesce(payload->>'payment_method', '')), '');
  v_customer_id uuid := nullif(payload->>'customer_id', '')::uuid;
  v_customer_name text := nullif(btrim(coalesce(payload->>'customer_name', payload->>'client_name', '')), '');
  v_event_name text := coalesce(nullif(btrim(coalesce(payload->>'event_name', '')), ''), v_customer_name, 'Event');
  v_client_name text := coalesce(v_customer_name, 'Guest');
  v_exclusive_booking_id uuid;
  v_booking_id uuid;
  v_room_id uuid;
  v_room_ids jsonb := coalesce(payload->'room_ids', '[]'::jsonb);
  v_created_booking_ids uuid[] := '{}'::uuid[];
  v_resource jsonb;
  v_resource_start timestamptz;
  v_resource_end timestamptz;
  v_resource_price numeric;
  v_invoice text;
  v_group_result jsonb;
  v_existing_event_id uuid;
  v_existing_payload_hash text;
  v_payload_hash text := md5((payload - 'idempotency_key')::text);
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
  if v_scope = 'exclusive_lodge' then
    if v_daily_rate is null or v_daily_rate < 0 then
      return jsonb_build_object('success', false, 'error', 'A valid whole-lodge daily rate is required');
    end if;
    v_base := round(v_daily_rate * (v_check_out - v_check_in), 2);
  end if;
  if v_customer_id is not null
     and not exists (
       select 1 from public.customers c
        where c.id = v_customer_id and c.lodge_id = v_lodge_id
     ) then
    return jsonb_build_object('success', false, 'error', 'Customer does not belong to this lodge');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('event-create:' || v_lodge_id::text || ':' || v_key, 0));
  select id, create_payload_hash
    into v_existing_event_id, v_existing_payload_hash
    from public.conference_bookings
   where lodge_id = v_lodge_id and create_idempotency_key = v_key;

  if found then
    if v_existing_payload_hash is null or v_existing_payload_hash is distinct from v_payload_hash then
      return jsonb_build_object('success', false, 'error', 'This event operation key belongs to a different or unverifiable request. Retry the original request or review the existing event.');
    end if;
    select exclusive_booking_id, customer_id, client_name, event_name
      into v_exclusive_booking_id, v_customer_id, v_client_name, v_event_name
      from public.conference_bookings
     where id = v_existing_event_id and lodge_id = v_lodge_id;

    select coalesce(array_agg(distinct booking_id order by booking_id), '{}'::uuid[])
      into v_created_booking_ids
      from (
        select booking_id
          from public.event_booking_rooms
         where event_booking_id = v_existing_event_id and lodge_id = v_lodge_id
        union
        select exclusive_booking_id
          from public.conference_bookings
         where id = v_existing_event_id and exclusive_booking_id is not null
      ) linked;

    v_group_result := public.create_event_invoice_group(
      v_lodge_id, v_existing_event_id, 'event:' || v_existing_event_id::text, v_customer_id,
      v_created_booking_ids, null, v_event_name, v_actor
    );
    if not coalesce((v_group_result->>'success')::boolean, false) then
      return v_group_result;
    end if;

    return jsonb_build_object(
      'success', true,
      'event_id', v_existing_event_id,
      'exclusive_booking_id', v_exclusive_booking_id,
      'invoice_group_id', v_group_result->>'group_id',
      'invoice_number', v_group_result->>'invoice_number',
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

    select count(*)::integer into v_room_count
      from public.rooms room
     where room.lodge_id = v_lodge_id and coalesce(room.status, '') <> 'maintenance';
    select room.id into v_room_id
      from public.rooms room
     where room.lodge_id = v_lodge_id and coalesce(room.status, '') <> 'maintenance'
     order by room.room_number collate "C" nulls last
     limit 1;
    if v_room_id is null then
      return jsonb_build_object('success', false, 'error', 'No rooms are available for an exclusive event');
    end if;

    v_booking_id := gen_random_uuid();
    v_invoice := public.get_next_invoice_number(v_lodge_id);
    insert into public.bookings (
      id, lodge_id, room_id, customer_id, customer_name, check_in, check_out,
      adults, children, total_amount, amount_paid, deposit_amount,
      payment_status, status, invoice_number, notes,
      is_exclusive_event, event_daily_rate, create_idempotency_key,
      created_at, updated_at
    ) values (
      v_booking_id, v_lodge_id, v_room_id, v_customer_id, v_client_name,
      v_check_in, v_check_out,
      greatest(1, coalesce(nullif(payload->>'adults', '')::integer, 1)),
      greatest(0, coalesce(nullif(payload->>'children', '')::integer, 0)),
      v_base, 0, 0, 'unpaid', 'confirmed', v_invoice,
      format('[GROUP:event:%s][ROOMS:%s] Event: %s', v_event_id, v_room_count, v_event_name),
      true, v_daily_rate,
      'event-booking:' || v_event_id::text, now(), now()
    );
    insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at, due_date)
    values (v_booking_id, v_lodge_id, v_invoice, now(), v_check_in)
    on conflict do nothing;
    v_exclusive_booking_id := v_booking_id;
    v_created_booking_ids := array_append(v_created_booking_ids, v_booking_id);
  end if;

  -- Parent first: every resource and room link below references it.
  insert into public.conference_bookings (
    id, lodge_id, customer_id, event_name, event_type, reservation_scope,
    status, booking_date, start_time, end_time, client_name, company,
    attendees, adults, children, setup_type, room_name,
    includes_catering, catering_notes, subtotal, extras_total,
    charges_total, total_amount, amount_paid, deposit_paid, balance_due,
    payment_status, payment_method, currency, exclusive_booking_id,
    quotation_id, create_idempotency_key, create_payload_hash, created_by, notes, updated_at
  ) values (
    v_event_id, v_lodge_id, v_customer_id, v_event_name,
    v_type, v_scope, v_status, v_date, v_start, v_end,
    v_client_name,
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
    v_key, v_payload_hash, v_actor, nullif(payload->>'notes', ''), now()
  );

  if v_base > 0 and v_scope <> 'exclusive_lodge' then
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
        id, lodge_id, room_id, customer_id, customer_name, check_in, check_out,
        adults, children, total_amount, amount_paid, deposit_amount,
        payment_status, status, invoice_number, notes,
        create_idempotency_key, created_at, updated_at
      ) values (
        v_booking_id, v_lodge_id, v_room_id, v_customer_id, v_client_name,
        v_check_in, v_check_out,
        greatest(1, coalesce(nullif(payload->>'adults', '')::integer, 1)),
        greatest(0, coalesce(nullif(payload->>'children', '')::integer, 0)),
        (select room.rate_per_night * greatest(1, v_check_out - v_check_in)
           from public.rooms room where room.id = v_room_id),
        0, 0, 'unpaid', 'confirmed', v_invoice,
        format('[EVENT:%s] %s', v_event_id, v_event_name),
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
      v_created_booking_ids := array_append(v_created_booking_ids, v_booking_id);
    end loop;
  end if;

  -- One customer-facing invoice for the reservation, including venue-only
  -- events with no room lines. Child invoices remain historical.
  v_group_result := public.create_event_invoice_group(
    v_lodge_id, v_event_id, 'event:' || v_event_id::text, v_customer_id,
    v_created_booking_ids, null, v_event_name, v_actor
  );
  if not coalesce((v_group_result->>'success')::boolean, false) then
    raise exception '%', coalesce(v_group_result->>'error', 'Could not create the event invoice group');
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
    'exclusive_booking_id', v_exclusive_booking_id,
    'invoice_group_id', v_group_result->>'group_id',
    'invoice_number', v_group_result->>'invoice_number'
  );
end;
$$;

revoke all on function public.create_event_booking(jsonb) from public;
grant execute on function public.create_event_booking(jsonb) to authenticated, service_role;

-- ── 4. Edits must never silently ignore room/resource assignments ───────────
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
  v_requested_rooms uuid[];
  v_current_rooms uuid[];
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

  -- Assignment edits are not implemented atomically. Reject changed values
  -- instead of silently dropping them; an identical echo is allowed so a form
  -- may resubmit unchanged fields safely.
  if payload ? 'room_ids' and jsonb_typeof(payload->'room_ids') = 'array' then
    select coalesce(array_agg(value::text::uuid), '{}'::uuid[])
      into v_requested_rooms
      from jsonb_array_elements_text(payload->'room_ids');
    select coalesce(array_agg(room_id), '{}'::uuid[])
      into v_current_rooms
      from public.event_booking_rooms
     where event_booking_id = p_event_id and lodge_id = p_lodge_id;
    if (select array_agg(value order by value) from unnest(v_requested_rooms) value)
       is distinct from
       (select array_agg(value order by value) from unnest(v_current_rooms) value) then
      return jsonb_build_object(
        'success', false,
        'error', 'Room assignments cannot be edited after creation. Cancel and recreate the event to change rooms.'
      );
    end if;
  end if;

  if payload ? 'check_in' and nullif(payload->>'check_in', '') is not null then
    if v_record.reservation_scope <> 'venue_only'
       and not exists (
         select 1 from public.bookings b
          where b.id = v_record.exclusive_booking_id
            and b.check_in = nullif(payload->>'check_in', '')::date
       )
       and not exists (
         select 1
           from public.event_booking_rooms r
           join public.bookings b on b.id = r.booking_id
          where r.event_booking_id = p_event_id
            and b.check_in = nullif(payload->>'check_in', '')::date
       ) then
      return jsonb_build_object(
        'success', false,
        'error', 'Room dates cannot be edited after creation. Cancel and recreate the event to change dates.'
      );
    end if;
  end if;

  if payload ? 'check_out' and nullif(payload->>'check_out', '') is not null then
    if v_record.reservation_scope <> 'venue_only'
       and not exists (
         select 1 from public.bookings b
          where b.id = v_record.exclusive_booking_id
            and b.check_out = nullif(payload->>'check_out', '')::date
       )
       and not exists (
         select 1
           from public.event_booking_rooms r
           join public.bookings b on b.id = r.booking_id
          where r.event_booking_id = p_event_id
            and b.check_out = nullif(payload->>'check_out', '')::date
       ) then
      return jsonb_build_object(
        'success', false,
        'error', 'Room dates cannot be edited after creation. Cancel and recreate the event to change dates.'
      );
    end if;
  end if;

  if payload ? 'resources' and jsonb_typeof(payload->'resources') = 'array'
     and jsonb_array_length(payload->'resources') > 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Venue-resource assignments cannot be edited after creation. Cancel and recreate the event to change resources.'
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

  -- Keep the customer-name snapshot on linked room bookings aligned with the
  -- event's current contact name when the snapshot is blank.
  if payload ? 'client_name' then
    update public.bookings b
       set customer_name = coalesce(
             nullif(btrim(b.customer_name), ''),
             nullif(btrim(payload->>'client_name'), '')
           ),
           updated_at = now()
     where b.lodge_id = p_lodge_id
       and (
         b.id = v_record.exclusive_booking_id
         or exists (
           select 1 from public.event_booking_rooms r
            where r.event_booking_id = p_event_id and r.booking_id = b.id
         )
       )
       and nullif(btrim(b.customer_name), '') is null;
  end if;

  insert into public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id, idempotency_key
  ) values (
    p_lodge_id, p_event_id, 'event_updated', v_actor, p_idempotency_key
  );
  return jsonb_build_object('success', true, 'event_id', p_event_id, 'updated_at', v_updated_at);
end;
$$;

revoke all on function public.update_event_booking(uuid, uuid, jsonb, timestamptz, text) from public;
grant execute on function public.update_event_booking(uuid, uuid, jsonb, timestamptz, text)
  to authenticated, service_role;

-- ── 5. Unified invoice projection for the Manager PWA ───────────────────────
drop function if exists public.get_invoice_summary(uuid, uuid);

create or replace function public.get_invoice_summary(
  p_lodge_id uuid,
  p_booking_id uuid default null
)
returns table(
  invoice_id uuid,
  invoice_number text,
  booking_id uuid,
  lodge_id uuid,
  issued_at timestamptz,
  due_date date,
  notes text,
  guest_name text,
  customer_email text,
  check_in date,
  check_out date,
  total_amount numeric,
  charges_total numeric,
  amount_paid numeric,
  balance_due numeric,
  payment_status text,
  booking_status text,
  payment_count bigint,
  last_payment_at timestamptz,
  invoice_kind text,
  group_id uuid,
  event_booking_id uuid,
  event_name text,
  customer_id uuid,
  customer_missing boolean,
  room_count integer,
  reconciliation_required boolean,
  child_invoice_numbers text[]
)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  with group_lines as (
    select l.group_id, l.booking_id, l.line_order,
           b.customer_id, b.total_amount, b.charges_total, b.amount_paid,
           b.check_in, b.check_out, b.status, b.payment_status,
           b.invoice_number, b.customer_name
      from public.booking_invoice_group_lines l
      join public.bookings b
        on b.id = l.booking_id
       and b.lodge_id = p_lodge_id
     where l.lodge_id = p_lodge_id
  ),
  grouped as (
    select gl.group_id,
           (array_agg(gl.booking_id order by gl.line_order))[1] as first_booking_id,
           (array_agg(gl.customer_id order by gl.line_order))[1] as customer_id,
           array_agg(gl.booking_id order by gl.line_order) as booking_ids,
           count(*)::integer as room_count,
           sum(coalesce(gl.total_amount, 0)) as room_total,
           sum(coalesce(gl.charges_total, 0)) as room_charges,
           sum(coalesce(gl.amount_paid, 0)) as room_paid,
           min(gl.check_in) as check_in,
           max(gl.check_out) as check_out,
           min(gl.status) as booking_status
      from group_lines gl
     group by gl.group_id
  ),
  events as (
    select e.* from public.conference_bookings e where e.lodge_id = p_lodge_id
  ),
  group_calc as (
    select g.id as group_id,
           g.invoice_number,
           g.issued_at,
           g.due_date,
           g.notes,
           g.customer_id as group_customer_id,
           g.customer_name as group_customer_name,
           g.event_booking_id,
           coalesce(gd.first_booking_id, g.event_booking_id) as booking_id,
           coalesce(gd.customer_id, e.customer_id, g.customer_id) as resolved_customer_id,
           coalesce(gd.booking_ids, '{}'::uuid[]) as booking_ids,
           coalesce(gd.room_count, 0) as room_count,
           coalesce(gd.room_total, 0) as room_total,
           coalesce(gd.room_charges, 0) as room_charges,
           coalesce(gd.room_paid, 0) as room_paid,
           coalesce(gd.check_in, e.booking_date) as check_in,
           coalesce(gd.check_out, e.booking_date) as check_out,
           coalesce(e.status, gd.booking_status, 'confirmed') as booking_status,
           coalesce(e.total_amount, 0) as event_total,
           coalesce(e.charges_total, 0) as event_charges,
           coalesce(e.amount_paid, 0) as event_paid,
           e.reservation_scope,
           e.event_name,
           e.client_name as event_client_name,
           nullif(btrim(coalesce(c.name, g.customer_name, e.client_name, bc.customer_name)), '') as resolved_name,
           coalesce(c.email, '') as resolved_email,
           round(
             case
               when g.event_booking_id is null then coalesce(gd.room_total, 0)
               when e.reservation_scope = 'exclusive_lodge'
                 then greatest(coalesce(gd.room_total, 0),
                               greatest(0, coalesce(e.total_amount, 0) - coalesce(e.charges_total, 0)))
                      + coalesce(e.charges_total, 0)
               when e.reservation_scope = 'venue_with_rooms'
                 then coalesce(gd.room_total, 0) + coalesce(e.total_amount, 0)
               else coalesce(e.total_amount, 0)
             end, 2) as calculated_total,
           round(coalesce(gd.room_charges, 0), 2) as calculated_charges,
           round(coalesce(gd.room_paid, 0) + coalesce(e.amount_paid, 0), 2) as calculated_paid,
           (
             select count(*) from public.payments p
              where p.lodge_id = p_lodge_id
                and (
                  p.conference_booking_id = g.event_booking_id
                  or p.booking_id = any(coalesce(gd.booking_ids, '{}'::uuid[]))
                )
           ) as payment_count,
           (
             select max(p.paid_at) from public.payments p
              where p.lodge_id = p_lodge_id
                and (
                  p.conference_booking_id = g.event_booking_id
                  or p.booking_id = any(coalesce(gd.booking_ids, '{}'::uuid[]))
                )
           ) as last_payment_at,
           (
             select array_agg(distinct i.invoice_number)
               from public.invoices i
              where i.lodge_id = p_lodge_id
                and i.booking_id = any(coalesce(gd.booking_ids, '{}'::uuid[]))
                and i.invoice_number is not null
           ) as child_invoice_numbers
      from public.booking_invoice_groups g
      left join grouped gd on gd.group_id = g.id
      left join events e on e.id = g.event_booking_id
      left join public.customers c
        on c.id = coalesce(gd.customer_id, e.customer_id, g.customer_id)
       and c.lodge_id = p_lodge_id
      left join public.bookings bc on bc.id = gd.first_booking_id
     where g.lodge_id = p_lodge_id
  ),
  group_rows as (
    select x.group_id as invoice_id,
           x.invoice_number,
           x.booking_id,
           p_lodge_id as lodge_id,
           x.issued_at,
           coalesce(x.due_date, x.check_in) as due_date,
           x.notes,
           x.resolved_name as guest_name,
           x.resolved_email as customer_email,
           x.check_in,
           x.check_out,
           x.calculated_total as total_amount,
           x.calculated_charges as charges_total,
           x.calculated_paid as amount_paid,
           greatest(0, round(x.calculated_total + x.calculated_charges - x.calculated_paid, 2)) as balance_due,
           case
             when x.calculated_total + x.calculated_charges > 0
                  and x.calculated_paid >= x.calculated_total + x.calculated_charges then 'paid'
             when x.calculated_paid > 0 then 'partial'
             else 'unpaid'
           end as payment_status,
           x.booking_status,
           x.payment_count,
           x.last_payment_at,
           case when x.event_booking_id is not null then 'event' else 'accommodation_group' end as invoice_kind,
           x.group_id,
           x.event_booking_id,
           x.event_name,
           x.resolved_customer_id as customer_id,
           (x.resolved_name is null) as customer_missing,
           x.room_count,
           (
             (x.event_booking_id is not null
              and ((x.event_paid > 0.009 and x.room_paid > 0.009)
                or (x.event_paid > 0.009
                  and (x.event_total - x.event_charges) <= 0.009
                  and (x.room_total > 0.009 or x.reservation_scope in ('venue_only', 'exclusive_lodge')))))
             or (x.calculated_paid > x.calculated_total + x.calculated_charges + 0.009)
           ) as reconciliation_required,
           x.child_invoice_numbers
      from group_calc x
     where p_booking_id is null
        or x.booking_id = p_booking_id
        or x.event_booking_id = p_booking_id
        or p_booking_id = any(x.booking_ids)
  ),
  standalone as (
    select i.id as invoice_id,
           i.invoice_number,
           b.id as booking_id,
           b.lodge_id,
           i.issued_at,
           i.due_date,
           i.notes,
           nullif(btrim(coalesce(c.name, b.customer_name)), '') as guest_name,
           coalesce(c.email, '') as customer_email,
           b.check_in,
           b.check_out,
           coalesce(b.total_amount, 0) as total_amount,
           coalesce(b.charges_total, 0) as charges_total,
           coalesce(b.amount_paid, 0) as amount_paid,
           greatest(0, coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)) as balance_due,
           coalesce(b.payment_status, 'unpaid') as payment_status,
           coalesce(b.status, 'confirmed') as booking_status,
           coalesce(pay_agg.payment_count, 0) as payment_count,
           pay_agg.last_payment_at,
           'booking'::text as invoice_kind,
           null::uuid as group_id,
           null::uuid as event_booking_id,
           null::text as event_name,
           b.customer_id,
           (nullif(btrim(coalesce(c.name, b.customer_name)), '') is null) as customer_missing,
           1 as room_count,
           false as reconciliation_required,
           array_remove(array[i.invoice_number], null) as child_invoice_numbers
      from public.invoices i
      join public.bookings b
        on b.id = i.booking_id
       and b.lodge_id = p_lodge_id
      left join public.customers c
        on c.id = b.customer_id
       and c.lodge_id = b.lodge_id
      left join lateral (
        select count(*) as payment_count, max(p.paid_at) as last_payment_at
          from public.payments p
         where p.booking_id = b.id
           and p.lodge_id = p_lodge_id
      ) pay_agg on true
     where i.lodge_id = p_lodge_id
       and not exists (
         select 1 from public.booking_invoice_group_lines l
          where l.booking_id = b.id
       )
       and not exists (
         select 1 from public.conference_bookings e
          where e.lodge_id = p_lodge_id
            and e.exclusive_booking_id = b.id
       )
       and not exists (
         select 1 from public.event_booking_rooms r
          where r.booking_id = b.id
       )
       and (p_booking_id is null or b.id = p_booking_id)
  ),
  legacy_event_bookings as (
    select e.id as event_id,
           e.customer_id as event_customer_id,
           e.client_name as event_client_name,
           e.reservation_scope,
           e.status as event_status,
           e.booking_date,
           coalesce(e.total_amount, 0) as event_total,
           coalesce(e.charges_total, 0) as event_charges,
           coalesce(e.amount_paid, 0) as event_paid,
           b.*
      from public.conference_bookings e
      join public.bookings b
        on b.lodge_id = e.lodge_id
       and (
         b.id = e.exclusive_booking_id
         or exists (
           select 1 from public.event_booking_rooms r
            where r.event_booking_id = e.id and r.booking_id = b.id
         )
         or coalesce(b.notes, '') like '%[EVENT:' || e.id::text || ']%'
         or coalesce(b.notes, '') like '%[GROUP:evt-' || e.id::text || ']%'
       )
     where e.lodge_id = p_lodge_id
       and not exists (
         select 1 from public.booking_invoice_groups g
          where g.lodge_id = p_lodge_id and g.event_booking_id = e.id
       )
       and not exists (
         select 1 from public.booking_invoice_group_lines l
          where l.booking_id = b.id
       )
  ),
  legacy_events as (
    select e.id as event_id,
           e.event_name,
           e.client_name,
           e.customer_id,
           e.reservation_scope,
           e.status,
           e.booking_date,
           coalesce(e.total_amount, 0) as event_total,
           coalesce(e.charges_total, 0) as event_charges,
           coalesce(e.amount_paid, 0) as event_paid,
           count(leb.booking_id)::integer as room_count,
           coalesce(sum(coalesce(leb.total_amount, 0)), 0) as room_total,
           coalesce(sum(coalesce(leb.charges_total, 0)), 0) as room_charges,
           coalesce(sum(coalesce(leb.amount_paid, 0)), 0) as room_paid,
           min(leb.check_in) as check_in,
           max(leb.check_out) as check_out,
           min(leb.status) as booking_status,
           (array_agg(leb.customer_id) filter (where leb.customer_id is not null))[1] as linked_customer_id,
           (array_agg(nullif(btrim(leb.customer_name), '')) filter (where nullif(btrim(leb.customer_name), '') is not null))[1] as linked_customer_name,
           array_remove(array_agg(leb.id order by leb.id), null) as booking_ids,
           array_remove(array_agg(leb.invoice_number order by leb.id), null) as legacy_invoice_numbers
      from public.conference_bookings e
      left join legacy_event_bookings leb on leb.event_id = e.id
     where e.lodge_id = p_lodge_id
       and not exists (
         select 1 from public.booking_invoice_groups g
          where g.lodge_id = p_lodge_id and g.event_booking_id = e.id
       )
       and (
         coalesce(e.total_amount, 0) > 0
         or coalesce(e.amount_paid, 0) > 0
         or e.exclusive_booking_id is not null
         or exists (
           select 1 from public.event_booking_rooms r
            where r.event_booking_id = e.id
         )
       )
     group by e.id, e.event_name, e.client_name, e.customer_id,
              e.reservation_scope, e.status, e.booking_date,
              e.total_amount, e.charges_total, e.amount_paid
  ),
  legacy_rows as (
    select null::uuid as invoice_id,
           null::text as invoice_number,
           e.event_id as booking_id,
           p_lodge_id as lodge_id,
           null::timestamptz as issued_at,
           coalesce(e.check_in, e.booking_date) as due_date,
           'Event invoice not yet consolidated'::text as notes,
           nullif(btrim(coalesce(c.name, e.linked_customer_name, e.client_name)), '') as guest_name,
           coalesce(c.email, '') as customer_email,
           coalesce(e.check_in, e.booking_date) as check_in,
           coalesce(e.check_out, e.booking_date) as check_out,
           round(
             case
               when e.reservation_scope = 'exclusive_lodge'
                 then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
               when e.reservation_scope = 'venue_with_rooms'
                 then e.room_total + e.event_total
               else e.event_total
             end, 2) as total_amount,
           round(e.room_charges, 2) as charges_total,
           round(e.room_paid + e.event_paid, 2) as amount_paid,
           round(
             case
               when e.reservation_scope = 'exclusive_lodge'
                 then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
               when e.reservation_scope = 'venue_with_rooms'
                 then e.room_total + e.event_total
               else e.event_total
             end + e.room_charges - (e.room_paid + e.event_paid), 2) as balance_due,
           case
             when (case when e.reservation_scope = 'exclusive_lodge'
                          then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
                        when e.reservation_scope = 'venue_with_rooms'
                          then e.room_total + e.event_total
                        else e.event_total end) + e.room_charges > 0
                  and (e.room_paid + e.event_paid) >= (case when e.reservation_scope = 'exclusive_lodge'
                          then greatest(e.room_total, greatest(0, e.event_total - e.event_charges)) + e.event_charges
                        when e.reservation_scope = 'venue_with_rooms'
                          then e.room_total + e.event_total
                        else e.event_total end) + e.room_charges then 'paid'
             when e.room_paid + e.event_paid > 0 then 'partial'
             else 'unpaid'
           end as payment_status,
           coalesce(e.status, 'confirmed') as booking_status,
           (select count(*) from public.payments p
             where p.lodge_id = p_lodge_id
               and (p.conference_booking_id = e.event_id
                    or p.booking_id = any(coalesce(e.booking_ids, '{}'::uuid[])))) as payment_count,
           (select max(p.paid_at) from public.payments p
             where p.lodge_id = p_lodge_id
               and (p.conference_booking_id = e.event_id
                    or p.booking_id = any(coalesce(e.booking_ids, '{}'::uuid[])))) as last_payment_at,
           'event_unconsolidated'::text as invoice_kind,
           null::uuid as group_id,
           e.event_id as event_booking_id,
           e.event_name,
           coalesce(e.customer_id, e.linked_customer_id) as customer_id,
           (nullif(btrim(coalesce(c.name, e.linked_customer_name, e.client_name)), '') is null) as customer_missing,
           greatest(e.room_count, 1) as room_count,
           true as reconciliation_required,
           e.legacy_invoice_numbers as child_invoice_numbers
      from legacy_events e
      left join public.customers c
        on c.id = coalesce(e.customer_id, e.linked_customer_id)
       and c.lodge_id = p_lodge_id
     where p_booking_id is null
        or e.event_id = p_booking_id
        or p_booking_id = any(coalesce(e.booking_ids, '{}'::uuid[]))
  )
  select * from group_rows
  union all
  select * from standalone
  union all
  select * from legacy_rows
  order by issued_at desc nulls last;
end;
$$;

revoke all on function public.get_invoice_summary(uuid, uuid) from public;
grant execute on function public.get_invoice_summary(uuid, uuid) to anon, authenticated, service_role;

-- A consolidated event invoice owns the ledger view even though the source
-- receipts remain attached to their original event or room booking rows.
create or replace function public.get_event_invoice_payments(
  p_lodge_id uuid,
  p_event_id uuid
) returns table(
  id uuid,
  booking_id uuid,
  lodge_id uuid,
  amount numeric,
  method text,
  type text,
  paid_at timestamptz,
  recorded_by uuid,
  notes text,
  created_at timestamptz,
  refund_base_amount numeric,
  refund_retained_percent numeric,
  refund_retained_amount numeric,
  event_booking_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );
  if p_event_id is null or not exists (
    select 1 from public.conference_bookings e
     where e.id = p_event_id and e.lodge_id = p_lodge_id
  ) then
    raise exception 'Event invoice not found in this lodge' using errcode = 'P0002';
  end if;

  return query
  select p.id, p.booking_id, p.lodge_id, p.amount, p.method, p.type,
         p.paid_at, p.recorded_by, coalesce(p.notes, ''), p.created_at,
         null::numeric, null::numeric, null::numeric, p.conference_booking_id
    from public.payments p
   where p.lodge_id = p_lodge_id
     and (
       p.conference_booking_id = p_event_id
       or p.booking_id = (
         select e.exclusive_booking_id from public.conference_bookings e
          where e.id = p_event_id and e.lodge_id = p_lodge_id
       )
       or exists (
         select 1 from public.event_booking_rooms r
          where r.event_booking_id = p_event_id
            and r.booking_id = p.booking_id
            and r.lodge_id = p_lodge_id
       )
       or exists (
         select 1 from public.bookings b
          where b.id = p.booking_id and b.lodge_id = p_lodge_id
            and (coalesce(b.notes, '') like '%[EVENT:' || p_event_id::text || ']%'
              or coalesce(b.notes, '') like '%[GROUP:event:' || p_event_id::text || ']%'
              or coalesce(b.notes, '') like '%[GROUP:evt-' || p_event_id::text || ']%')
       )
     )
   order by p.paid_at, p.created_at, p.id;
end;
$$;

revoke all on function public.get_event_invoice_payments(uuid, uuid) from public;
grant execute on function public.get_event_invoice_payments(uuid, uuid)
  to authenticated, service_role;

-- Bind payment idempotency keys to the original amount, method, type and event.
-- The durable desktop envelope is replayed unchanged after an ambiguous result;
-- a caller cannot reuse its key for a different payment or another event.
create or replace function public.update_event_payment(
  p_event_id uuid,
  p_lodge_id uuid,
  p_amount numeric,
  p_method text,
  p_type text default 'payment',
  p_idempotency_key text default null,
  p_recorded_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_event public.conference_bookings%rowtype;
  v_existing public.payments%rowtype;
  v_payment_id uuid;
  v_amount numeric := round(abs(coalesce(p_amount, 0))::numeric, 2);
  v_type text := lower(coalesce(nullif(btrim(p_type), ''), 'payment'));
  v_method text := nullif(btrim(coalesce(p_method, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_signed_amount numeric;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required');
  end if;
  if p_event_id is null or p_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'Event and lodge are required');
  end if;
  if v_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  end if;
  if v_method is null then
    return jsonb_build_object('success', false, 'error', 'Payment method is required');
  end if;
  if v_key is null or length(v_key) < 8 or length(v_key) > 128
     or v_key !~ '^[A-Za-z0-9:_-]+$' then
    return jsonb_build_object('success', false, 'error', 'A valid payment idempotency key is required');
  end if;
  if v_type not in ('payment', 'deposit', 'refund') then
    return jsonb_build_object('success', false, 'error', 'Payment type must be payment, deposit, or refund');
  end if;

  -- Serialize reuse of a key even if callers supply different event IDs.
  perform pg_advisory_xact_lock(hashtext('event-payment:' || v_key));
  select * into v_event
    from public.conference_bookings e
   where e.id = p_event_id and e.lodge_id = p_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Event booking not found in this lodge');
  end if;

  v_signed_amount := case when v_type = 'refund' then -v_amount else v_amount end;
  select * into v_existing
    from public.payments p
   where p.idempotency_key = v_key
   limit 1
   for update;
  if found then
    if v_existing.lodge_id is distinct from p_lodge_id
       or v_existing.conference_booking_id is distinct from p_event_id
       or round(v_existing.amount::numeric, 2) is distinct from v_signed_amount
       or lower(coalesce(v_existing.method, '')) is distinct from lower(v_method)
       or lower(coalesce(v_existing.type, 'payment')) is distinct from v_type then
      return jsonb_build_object('success', false, 'error', 'Payment idempotency key was already used for a different operation');
    end if;
    return jsonb_build_object('success', true, 'idempotent', true, 'payment_id', v_existing.id,
      'amount_paid', v_event.amount_paid, 'balance_due', v_event.balance_due,
      'payment_status', v_event.payment_status);
  end if;

  if v_event.status in ('cancelled', 'completed') then
    return jsonb_build_object('success', false, 'error', 'Cannot record payment on a cancelled or completed event');
  end if;

  v_payment_id := gen_random_uuid();
  insert into public.payments (
    id, lodge_id, conference_booking_id, amount, method, type,
    idempotency_key, recorded_by, paid_at
  ) values (
    v_payment_id, p_lodge_id, p_event_id, v_signed_amount, v_method,
    v_type, v_key, v_actor, now()
  );

  perform public.recalculate_event_totals(p_event_id);
  insert into public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id, amount_delta, idempotency_key
  ) values (
    p_lodge_id, p_event_id, 'event_payment_recorded', v_actor,
    v_signed_amount, v_key
  );

  select * into v_event
    from public.conference_bookings e
   where e.id = p_event_id and e.lodge_id = p_lodge_id;
  return jsonb_build_object(
    'success', true, 'payment_id', v_payment_id,
    'amount_paid', v_event.amount_paid, 'balance_due', v_event.balance_due,
    'payment_status', v_event.payment_status
  );
end;
$$;

revoke all on function public.update_event_payment(uuid, uuid, numeric, text, text, text, uuid) from public;
grant execute on function public.update_event_payment(uuid, uuid, numeric, text, text, text, uuid)
  to authenticated, service_role;

-- Collection against a consolidated event invoice locks the event and every
-- linked accommodation row, recomputes the group balance, then records one
-- event-owned ledger receipt under the same payload-bound idempotency contract.
create or replace function public.record_event_invoice_payment(
  p_lodge_id uuid,
  p_event_id uuid,
  p_amount numeric,
  p_method text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.conference_bookings%rowtype;
  v_booking_ids uuid[] := '{}'::uuid[];
  v_room_total numeric := 0;
  v_room_charges numeric := 0;
  v_room_paid numeric := 0;
  v_event_charges numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_balance numeric := 0;
  v_result jsonb;
  v_existing public.payments%rowtype;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );
  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
    return jsonb_build_object('success', false, 'error', 'Payment amount must be a positive value with at most two decimals');
  end if;

  select * into v_event
    from public.conference_bookings e
   where e.id = p_event_id and e.lodge_id = p_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Event invoice not found in this lodge');
  end if;

  -- An exact retry must resolve before balance validation because its original
  -- receipt already reduced the balance. The underlying RPC rejects key reuse
  -- with any changed event/amount/method/type.
  select * into v_existing
    from public.payments p
   where p.idempotency_key = p_idempotency_key
   limit 1;
  if found then
    return public.update_event_payment(
      p_event_id, p_lodge_id, p_amount, p_method, 'payment', p_idempotency_key, null
    );
  end if;

  select coalesce(array_agg(distinct b.id order by b.id), '{}'::uuid[])
    into v_booking_ids
    from public.bookings b
   where b.lodge_id = p_lodge_id
     and (
       b.id = v_event.exclusive_booking_id
       or exists (
         select 1 from public.event_booking_rooms r
          where r.lodge_id = p_lodge_id
            and r.event_booking_id = p_event_id
            and r.booking_id = b.id
       )
       or coalesce(b.notes, '') like '%[EVENT:' || p_event_id::text || ']%'
       or coalesce(b.notes, '') like '%[GROUP:event:' || p_event_id::text || ']%'
       or coalesce(b.notes, '') like '%[GROUP:evt-' || p_event_id::text || ']%'
     );

  perform 1 from public.bookings b
   where b.lodge_id = p_lodge_id and b.id = any(v_booking_ids)
   order by b.id
   for update;

  select coalesce(sum(b.total_amount), 0),
         coalesce(sum(b.charges_total), 0),
         coalesce(sum(b.amount_paid), 0)
    into v_room_total, v_room_charges, v_room_paid
    from public.bookings b
   where b.lodge_id = p_lodge_id and b.id = any(v_booking_ids);
  v_event_charges := coalesce(v_event.charges_total, 0);

  if coalesce(v_event.amount_paid, 0) > 0
     and (v_room_paid > 0 or coalesce(v_event.total_amount, 0) <= 0) then
    return jsonb_build_object('success', false, 'reconciliation_required', true,
      'error', 'Existing event and room receipts need reconciliation before collection');
  end if;

  v_total := round(
    case
      when v_event.reservation_scope = 'exclusive_lodge'
        then greatest(v_room_total, greatest(0, coalesce(v_event.total_amount, 0) - v_event_charges)) + v_event_charges
      when v_event.reservation_scope = 'venue_with_rooms'
        then v_room_total + coalesce(v_event.total_amount, 0)
      when v_event.reservation_scope is null and cardinality(v_booking_ids) > 0
        then v_room_total + coalesce(v_event.total_amount, 0)
      else coalesce(v_event.total_amount, 0)
    end + v_room_charges, 2);
  v_paid := round(coalesce(v_event.amount_paid, 0) + v_room_paid, 2);
  v_balance := greatest(0, v_total - v_paid);
  if v_balance <= 0 then
    return jsonb_build_object('success', false, 'error', 'This event invoice has no outstanding balance');
  end if;
  if p_amount > v_balance then
    return jsonb_build_object('success', false, 'error', 'Payment exceeds the current consolidated invoice balance',
      'balance_due', v_balance);
  end if;

  v_result := public.update_event_payment(
    p_event_id, p_lodge_id, p_amount, p_method, 'payment', p_idempotency_key, null
  );
  if not coalesce((v_result->>'success')::boolean, false) then
    return v_result;
  end if;
  return v_result || jsonb_build_object(
    'event_invoice_total', v_total,
    'event_invoice_amount_paid', round(v_paid + p_amount, 2),
    'balance_due', greatest(0, round(v_balance - p_amount, 2))
  );
end;
$$;

revoke all on function public.record_event_invoice_payment(uuid, uuid, numeric, text, text) from public;
grant execute on function public.record_event_invoice_payment(uuid, uuid, numeric, text, text)
  to authenticated, service_role;

-- ── 6. Scoped, dry-run historical identity/invoice repair ───────────────────
create or replace function public.repair_event_invoice_identity(
  p_lodge_id uuid,
  p_event_id uuid,
  p_dry_run boolean default true,
  p_customer_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_event public.conference_bookings%rowtype;
  v_customer_id uuid := p_customer_id;
  v_customer_name text;
  v_booking_ids uuid[] := '{}'::uuid[];
  v_invoice_numbers text[] := '{}'::text[];
  v_room_total numeric := 0;
  v_room_paid numeric := 0;
  v_event_total numeric := 0;
  v_event_paid numeric := 0;
  v_existing_group public.booking_invoice_groups%rowtype;
  v_group_result jsonb;
  v_before jsonb;
  v_after jsonb;
  v_receipt_count bigint := 0;
  v_receipt_total numeric := 0;
  v_after_receipt_count bigint := 0;
  v_after_receipt_total numeric := 0;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  if p_lodge_id is null or p_event_id is null then
    return jsonb_build_object('success', false, 'error', 'Lodge and event are required');
  end if;

  select * into v_event
    from public.conference_bookings
   where id = p_event_id and lodge_id = p_lodge_id
   for update;
  if v_event.id is null then
    return jsonb_build_object('success', false, 'error', 'Event booking not found in this lodge');
  end if;
  if v_event.reservation_scope not in ('venue_only', 'venue_with_rooms', 'exclusive_lodge') then
    return jsonb_build_object('success', false, 'error', 'Unsupported event reservation scope');
  end if;

  -- Freeze the reviewed membership and receipt evidence for the duration of
  -- the repair. Lock rows in stable order to avoid competing repair races.
  perform 1 from public.bookings b
   where b.lodge_id = p_lodge_id
     and (b.id = v_event.exclusive_booking_id
          or exists (select 1 from public.event_booking_rooms r where r.lodge_id = p_lodge_id and r.event_booking_id = p_event_id and r.booking_id = b.id)
          or coalesce(b.notes, '') like '%[EVENT:' || p_event_id::text || ']%'
          or coalesce(b.notes, '') like '%[GROUP:evt-' || p_event_id::text || ']%')
   order by b.id
   for update;

  select coalesce(array_agg(distinct booking_id order by booking_id), '{}'::uuid[]),
         coalesce(sum(coalesce(total_amount, 0)), 0),
         coalesce(sum(coalesce(amount_paid, 0)), 0),
         array_remove(array_agg(invoice_number order by invoice_number), null)
    into v_booking_ids, v_room_total, v_room_paid, v_invoice_numbers
    from (
      select b.id as booking_id, b.total_amount, b.amount_paid, b.invoice_number
        from public.bookings b
       where b.lodge_id = p_lodge_id
         and (
           b.id = v_event.exclusive_booking_id
           or exists (
             select 1 from public.event_booking_rooms r
              where r.event_booking_id = p_event_id and r.booking_id = b.id
           )
           or coalesce(b.notes, '') like '%[EVENT:' || p_event_id::text || ']%'
           or coalesce(b.notes, '') like '%[GROUP:evt-' || p_event_id::text || ']%'
         )
    ) linked;

  v_event_total := coalesce(v_event.total_amount, 0);
  v_event_paid := coalesce(v_event.amount_paid, 0);

  perform 1 from public.payments p
   where p.lodge_id = p_lodge_id
     and (p.conference_booking_id = p_event_id or p.booking_id = any(v_booking_ids))
   order by p.id
   for update;

  select count(*), coalesce(sum(amount), 0)
    into v_receipt_count, v_receipt_total
    from public.payments p
   where p.lodge_id = p_lodge_id
     and (p.conference_booking_id = p_event_id
          or p.booking_id = any(v_booking_ids));

  select * into v_existing_group
    from public.booking_invoice_groups g
   where g.lodge_id = p_lodge_id
     and (g.event_booking_id = p_event_id or g.group_key = 'evt-' || p_event_id::text)
   limit 1;

  -- Resolve identity without guessing across unrelated guests.
  if v_customer_id is not null then
    if not exists (
      select 1 from public.customers c
       where c.id = v_customer_id and c.lodge_id = p_lodge_id
    ) then
      return jsonb_build_object('success', false, 'error', 'Customer does not belong to this lodge');
    end if;
  elsif v_event.customer_id is not null then
    v_customer_id := v_event.customer_id;
  else
    v_customer_name := nullif(btrim(coalesce(v_event.client_name, v_event.event_name, '')), '');
  end if;

  -- Every existing booking customer must agree; otherwise stop for review.
  if exists (
    select 1 from public.bookings b
     where b.id = any(v_booking_ids)
       and b.customer_id is not null
       and b.customer_id is distinct from v_customer_id
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'Linked room bookings already reference a different customer. Review before repairing.'
    );
  end if;

  v_before := jsonb_build_object(
    'event_id', p_event_id,
    'event_name', v_event.event_name,
    'client_name', v_event.client_name,
    'reservation_scope', v_event.reservation_scope,
    'customer_id', v_event.customer_id,
    'booking_ids', to_jsonb(v_booking_ids),
    'invoice_numbers', to_jsonb(v_invoice_numbers),
    'room_total', round(v_room_total, 2),
    'room_paid', round(v_room_paid, 2),
    'event_total', round(v_event_total, 2),
    'event_paid', round(v_event_paid, 2),
    'receipt_count', v_receipt_count,
    'receipt_total', round(v_receipt_total, 2),
    'group_id', v_existing_group.id,
    'group_invoice_number', v_existing_group.invoice_number
  );

  if p_dry_run then
    return jsonb_build_object(
      'success', true,
      'dry_run', true,
      'requires_customer_selection', v_customer_id is null and v_customer_name is not null,
      'resolved_customer_id', v_customer_id,
      'customer_name', v_customer_name,
      'would_create_group', v_existing_group.id is null,
      'group_id', v_existing_group.id,
      'invoice_number', v_existing_group.invoice_number,
      'booking_ids', to_jsonb(v_booking_ids),
      'invoice_numbers', to_jsonb(v_invoice_numbers),
      'before', v_before
    );
  end if;

  if v_customer_id is null then
    raise exception 'Select or create a verified lodge customer first, then rerun the reviewed repair';
  end if;

  -- Preserve all booking/ledger IDs and only fill missing identity links.
  update public.conference_bookings
     set customer_id = v_customer_id,
         client_name = coalesce(nullif(btrim(client_name), ''), v_customer_name),
         updated_at = now()
   where id = p_event_id
     and lodge_id = p_lodge_id;

  update public.bookings b
     set customer_id = v_customer_id,
         customer_name = coalesce(
           nullif(btrim(b.customer_name), ''),
           nullif(btrim(v_event.client_name), ''),
           v_customer_name
         ),
         updated_at = now()
   where b.id = any(v_booking_ids)
     and b.lodge_id = p_lodge_id;

  v_group_result := public.create_event_invoice_group(
    p_lodge_id, p_event_id, 'event:' || p_event_id::text, v_customer_id,
    v_booking_ids, v_existing_group.invoice_number, v_event.event_name, v_actor
  );
  if not coalesce((v_group_result->>'success')::boolean, false) then
    raise exception 'Event invoice group repair failed: %', coalesce(v_group_result->>'error', 'unknown error');
  end if;

  select count(*), coalesce(sum(amount), 0)
    into v_after_receipt_count, v_after_receipt_total
    from public.payments p
   where p.lodge_id = p_lodge_id
     and (p.conference_booking_id = p_event_id
          or p.booking_id = any(v_booking_ids));

  if v_after_receipt_count <> v_receipt_count
     or round(v_after_receipt_total, 2) <> round(v_receipt_total, 2) then
    raise exception 'Repair changed the receipt ledger; rolling back';
  end if;

  v_after := jsonb_build_object(
    'customer_id', v_customer_id,
    'group_id', v_group_result->>'group_id',
    'invoice_number', v_group_result->>'invoice_number',
    'booking_ids', to_jsonb(v_booking_ids),
    'receipt_count', v_after_receipt_count,
    'receipt_total', round(v_after_receipt_total, 2)
  );

  insert into public.financial_audit_log (
    lodge_id, event_booking_id, action, actor_id, idempotency_key,
    before_snapshot, after_snapshot
  ) values (
    p_lodge_id, p_event_id, 'event_invoice_identity_repaired', v_actor,
    'event-invoice-repair:' || p_event_id::text,
    v_before, v_after
  );

  return jsonb_build_object(
    'success', true,
    'dry_run', false,
    'customer_id', v_customer_id,
    'group_id', v_group_result->>'group_id',
    'invoice_number', v_group_result->>'invoice_number',
    'booking_ids', to_jsonb(v_booking_ids),
    'invoice_numbers', to_jsonb(v_invoice_numbers),
    'receipt_count', v_after_receipt_count,
    'receipt_total', round(v_after_receipt_total, 2),
    'before', v_before,
    'after', v_after
  );
end;
$$;

revoke all on function public.repair_event_invoice_identity(uuid, uuid, boolean, uuid) from public;
grant execute on function public.repair_event_invoice_identity(uuid, uuid, boolean, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
