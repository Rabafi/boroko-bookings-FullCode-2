-- Stabilization Step 3: Block bookings for rooms under maintenance
-- ─────────────────────────────────────────────────────────────────────────────
-- This migration ensures that rooms with open maintenance tickets cannot be
-- booked through any of the primary booking channels (Direct, Sync, Quotation,
-- or Online). It also adds a trigger to keep the rooms table status in sync
-- with maintenance tickets.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- 1. Helper Function: Check for open maintenance
create or replace function public.app_check_room_maintenance(p_lodge_id uuid, p_room_id uuid)
returns void
language plpgsql
stable
as $function$
begin
  if p_room_id is not null and exists (
    select 1 
    from public.maintenance_tickets 
    where room_id = p_room_id 
      and lodge_id = p_lodge_id 
      and status != 'resolved'
  ) then
    raise exception 'Room is currently under maintenance and cannot be booked.'
      using errcode = 'P0001';
  end if;
end;
$function$;

-- 2. Trigger Function: Sync room status with maintenance
create or replace function public.sync_room_maintenance_status()
returns trigger
language plpgsql
security definer
as $sync_status$
begin
  -- If a room is linked to this ticket...
  if coalesce(new.room_id, old.room_id) is not null then
    -- If there are ANY open tickets for this room, set status to maintenance
    if exists (
      select 1 
      from public.maintenance_tickets 
      where room_id = coalesce(new.room_id, old.room_id)
        and lodge_id = coalesce(new.lodge_id, old.lodge_id)
        and status != 'resolved'
    ) then
      update public.rooms 
         set status = 'maintenance' 
       where id = coalesce(new.room_id, old.room_id)
         and lodge_id = coalesce(new.lodge_id, old.lodge_id);
    else
      -- If no open tickets remain, set it to available (or it will be updated by bookings)
      update public.rooms 
         set status = 'available' 
       where id = coalesce(new.room_id, old.room_id)
         and lodge_id = coalesce(new.lodge_id, old.lodge_id)
         and status = 'maintenance';
    end if;
  end if;
  return coalesce(new, old);
end;
$sync_status$;

-- 3. Install Trigger
drop trigger if exists maintenance_room_status_sync on public.maintenance_tickets;
create trigger maintenance_room_status_sync
  after insert or update of status, room_id or delete
  on public.maintenance_tickets
  for each row
  execute function public.sync_room_maintenance_status();

-- 4. Backfill: Sync existing open tickets to room status
update public.rooms r
   set status = 'maintenance'
 where exists (
   select 1 
     from public.maintenance_tickets t 
    where t.room_id = r.id 
      and t.lodge_id = r.lodge_id 
      and t.status != 'resolved'
 );

-- 5. Update create_booking_record (latest version from 20260426)
create or replace function public.create_booking_record(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $create_booking_record$
declare
  v_id uuid := coalesce((payload->>'id')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_check_in date := (payload->>'check_in')::date;
  v_check_out date := (payload->>'check_out')::date;
  v_status text := coalesce(payload->>'status', 'confirmed');
  v_existing_id uuid;
  v_invoice_number text := nullif(payload->>'invoice_number', '');
  v_room_status text;
  v_is_existing boolean := false;
  v_deposit_amount numeric := round(coalesce((payload->>'deposit_amount')::numeric, 0)::numeric, 2);
  v_deposit_method text := nullif(payload->>'deposit_method', '');
  v_dep_result jsonb;
  v_is_exclusive_event boolean := coalesce((payload->>'is_exclusive_event')::boolean, false);
  v_allow_total_override boolean := coalesce((payload->>'allow_total_override')::boolean, false);
  v_total_amount numeric := round(coalesce((payload->>'total_amount')::numeric, 0)::numeric, 2);
  v_expected_total numeric;
  v_create_key text := nullif(payload->>'create_idempotency_key', '');
  v_created_by uuid := nullif(payload->>'created_by', '')::uuid;
  v_deposit_key text;
begin
  perform public.app_reject_pwa_financial_mutation();

  -- NEW: Maintenance Check
  perform public.app_check_room_maintenance(v_lodge_id, v_room_id);

  if v_deposit_amount > 0 and v_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

  if v_total_amount < 0 then
    return jsonb_build_object('success', false, 'error', 'Booking total cannot be negative');
  end if;

  if not v_is_exclusive_event then
    v_expected_total := public.room_booking_expected_total(v_lodge_id, v_room_id, v_check_in, v_check_out);
    if v_expected_total is null then
      return jsonb_build_object('success', false, 'error', 'Invalid room or stay dates');
    end if;

    if abs(v_total_amount - v_expected_total) > 0.01 then
      if v_allow_total_override then
        perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
      else
        return jsonb_build_object(
          'success', false,
          'error', format(
            'Booking total must match the room rate for this stay. Expected %s, received %s.',
            v_expected_total,
            v_total_amount
          )
        );
      end if;
    end if;
  end if;

  if v_create_key is not null then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.create_idempotency_key = v_create_key
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if not v_is_existing then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.id = v_id
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if not v_is_existing then
    begin
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
        v_total_amount,
        0, 'unpaid',
        v_status, null,
        coalesce(payload->>'notes', ''),
        v_created_by,
        v_deposit_amount, null,
        v_is_exclusive_event,
        coalesce((payload->>'event_daily_rate')::numeric, 0),
        now(), now(),
        v_create_key
      );
    exception
      when exclusion_violation then
        return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
    end;

    if v_invoice_number is null then
      v_invoice_number := get_next_invoice_number(v_lodge_id);
    end if;

    update public.bookings
       set invoice_number = v_invoice_number,
           updated_at = now()
     where id = v_id
       and lodge_id = v_lodge_id;

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
    v_deposit_key := 'payment:deposit:' || v_id::text;

    if not exists (
      select 1
        from public.payments
       where booking_id = v_id
         and lodge_id = v_lodge_id
         and idempotency_key = v_deposit_key
    ) then
      select public.update_booking_payment(
        v_id, v_lodge_id, v_deposit_amount, v_deposit_method,
        'deposit', v_deposit_key,
        v_created_by
      ) into v_dep_result;

      if not coalesce((v_dep_result->>'success')::boolean, false) then
        if not v_is_existing then
          delete from public.bookings
           where id = v_id
             and lodge_id = v_lodge_id;
        end if;

        return jsonb_build_object(
          'success', false,
          'booking_id', v_id,
          'error', coalesce(v_dep_result->>'error', 'Deposit could not be recorded')
        );
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$create_booking_record$;

-- 5. Update update_booking (latest version from 20260426)
create or replace function public.update_booking(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $update_booking$
declare
  v_current public.bookings%rowtype;
  v_room_id uuid;
  v_check_in date;
  v_check_out date;
  v_new_total numeric;
  v_new_status text;
  v_conflict uuid;
  v_total_owed numeric;
  v_allow_total_override boolean := coalesce((payload->>'allow_total_override')::boolean, false);
  v_expected_total numeric;
  v_total_relevant_changed boolean := (payload ? 'total_amount') or (payload ? 'room_id') or (payload ? 'check_in') or (payload ? 'check_out');
  v_expected_updated_at timestamptz := nullif(payload->>'expected_updated_at', '')::timestamptz;
  v_next_updated_at timestamptz := coalesce(nullif(payload->>'updated_at', '')::timestamptz, now());
  v_actor uuid := public.app_current_user_id();
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

  if v_expected_updated_at is not null and v_current.updated_at is distinct from v_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was modified on another device. Refresh and try again.',
      'code', 'BOOKING_CONFLICT',
      'current_updated_at', v_current.updated_at
    );
  end if;

  v_room_id := coalesce((payload->>'room_id')::uuid, v_current.room_id);
  v_check_in := coalesce((payload->>'check_in')::date, v_current.check_in);
  v_check_out := coalesce((payload->>'check_out')::date, v_current.check_out);

  -- NEW: Maintenance Check (if changing room or extending stay in a broken room)
  if v_room_id is distinct from v_current.room_id then
    perform public.app_check_room_maintenance(p_lodge_id, v_room_id);
  end if;

  v_new_total := round((
    case
      when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0)
      else v_current.total_amount
    end
  )::numeric, 2);

  if v_new_total < 0 then
    return jsonb_build_object('success', false, 'error', 'Booking total cannot be negative');
  end if;

  if v_total_relevant_changed and not coalesce(v_current.is_exclusive_event, false) then
    v_expected_total := public.room_booking_expected_total(p_lodge_id, v_room_id, v_check_in, v_check_out);
    if v_expected_total is null then
      return jsonb_build_object('success', false, 'error', 'Invalid room or stay dates');
    end if;

    if abs(v_new_total - v_expected_total) > 0.01 then
      if v_allow_total_override then
        perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
      else
        return jsonb_build_object(
          'success', false,
          'error', format(
            'Booking total must match the room rate for this stay. Expected %s, received %s.',
            v_expected_total,
            v_new_total
          )
        );
      end if;
    end if;
  end if;

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
         updated_at = v_next_updated_at
   where id = p_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id, 'payment_status', v_new_status);
end;
$update_booking$;

-- 6. Update convert_quotation_to_booking (latest version from 20260503)
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
  v_dep_result jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();

  select *
    into v_q
    from quotations
   where id = p_quotation_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    raise exception 'Quotation not found';
  end if;

  -- NEW: Maintenance Check
  perform public.app_check_room_maintenance(p_lodge_id, v_q.room_id);

  if p_deposit_amount > 0 and p_payment_method is null then
    raise exception 'Payment method is required when deposit amount is provided';
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

  v_inv_number := public.get_next_invoice_number(p_lodge_id);
  v_booking_id := gen_random_uuid();

  insert into bookings (
    id, lodge_id, room_id, customer_id,
    check_in, check_out, adults, children,
    total_amount, amount_paid, payment_status, payment_method,
    status, invoice_number, quotation_id, created_by, created_at, updated_at
  ) values (
    v_booking_id, p_lodge_id, v_q.room_id, v_q.customer_id,
    v_q.check_in, v_q.check_out, v_q.adults, v_q.children,
    v_q.total_amount, 0, 'unpaid', p_payment_method,
    'confirmed', v_inv_number, p_quotation_id, p_created_by, now(), now()
  );

  insert into invoices (
    booking_id, lodge_id, invoice_number, issued_at
  ) values (
    v_booking_id, p_lodge_id, v_inv_number, now()
  )
  on conflict do nothing;

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

  return jsonb_build_object('success', true, 'id', v_booking_id, 'invoice_number', v_inv_number);
end;
$convert_quote$;

-- 8. Update update_booking_status (latest version from 20260426)
create or replace function public.update_booking_status(
  p_id uuid,
  p_lodge_id uuid,
  p_status text,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $update_booking_status$
declare
  v_booking public.bookings%rowtype;
  v_allowed boolean := false;
  v_room_status text;
  v_outstanding numeric := 0;
begin
  perform public.app_reject_pwa_financial_mutation();

  select *
    into v_booking
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if v_booking.id is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if p_expected_updated_at is not null and v_booking.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh the booking and try again.',
      'stale', true,
      'current_updated_at', v_booking.updated_at
    );
  end if;

  v_allowed :=
    p_status = v_booking.status
    or (v_booking.status = 'pending' and p_status in ('confirmed', 'cancelled'))
    or (v_booking.status = 'confirmed' and p_status in ('checked_in', 'cancelled'))
    or (v_booking.status = 'checked_in' and p_status in ('checked_out'));

  if not v_allowed then
    return jsonb_build_object(
      'success', false,
      'error', format('Cannot transition booking from %s to %s', v_booking.status, p_status)
    );
  end if;

  -- NEW: Maintenance Check for check-in
  if p_status = 'checked_in' then
    perform public.app_check_room_maintenance(p_lodge_id, v_booking.room_id);
  end if;

  if p_status = 'checked_out' then
    v_outstanding := greatest(
      0,
      coalesce(v_booking.total_amount, 0) + coalesce(v_booking.charges_total, 0) - coalesce(v_booking.amount_paid, 0)
    );
    if v_outstanding > 0 then
      return jsonb_build_object(
        'success', false,
        'error', format('Cannot check out this guest until the full balance is paid. Outstanding balance: %s', round(v_outstanding::numeric, 2))
      );
    end if;
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

  if v_room_status is not null and v_booking.room_id is not null then
    update public.rooms
       set status = v_room_status
     where id = v_booking.room_id
       and lodge_id = p_lodge_id;
  end if;

  return jsonb_build_object('success', true, 'id', p_id, 'status', p_status);
end;
$update_booking_status$;

-- 9. Update create_online_booking
create or replace function public.create_online_booking(
  p_slug text,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_lodge_name text;
  v_currency text;
  v_room_id uuid;
  v_check_in date;
  v_check_out date;
  v_first_name text;
  v_last_name text;
  v_email text;
  v_phone text;
  v_adults int;
  v_children int;
  v_notes text;
  v_features jsonb;
  v_enabled boolean;
  v_customer_id uuid;
  v_room public.rooms%rowtype;
  v_nights int;
  v_total numeric;
  v_idem_key text;
  v_booking_id uuid;
  v_reference text;
  v_conflict uuid;
  v_invoice_number text;
  v_rate_limit_error text;
begin
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Invalid lodge');
  end if;

  select s.lodge_id, coalesce(s.lodge_name, s.company_name), coalesce(s.currency, 'P')
    into v_lodge_id, v_lodge_name, v_currency
  from public.settings s
  where lower(btrim(coalesce(s.slug, ''))) = v_slug
    and coalesce(s.deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking is not available for this property');
  end if;

  v_room_id := nullif(payload->>'room_id', '')::uuid;
  v_check_in := nullif(payload->>'check_in', '')::date;
  v_check_out := nullif(payload->>'check_out', '')::date;
  v_first_name := btrim(coalesce(payload->>'guest_first_name', ''));
  v_last_name := btrim(coalesce(payload->>'guest_last_name', ''));
  v_email := lower(btrim(coalesce(payload->>'guest_email', '')));
  v_phone := btrim(coalesce(payload->>'guest_phone', ''));
  v_adults := coalesce((payload->>'adults')::int, 1);
  v_children := coalesce((payload->>'children')::int, 0);
  v_notes := btrim(coalesce(payload->>'notes', ''));

  if v_room_id is null then return jsonb_build_object('success', false, 'error', 'Room is required'); end if;
  if v_check_in is null or v_check_out is null then return jsonb_build_object('success', false, 'error', 'Check-in and check-out dates are required'); end if;
  if v_check_out <= v_check_in then return jsonb_build_object('success', false, 'error', 'Check-out must be after check-in'); end if;
  if v_check_in < current_date then return jsonb_build_object('success', false, 'error', 'Check-in date cannot be in the past'); end if;
  if v_first_name = '' or v_last_name = '' then return jsonb_build_object('success', false, 'error', 'Guest name is required'); end if;
  if v_email = '' or v_email not like '%@%' then return jsonb_build_object('success', false, 'error', 'A valid email address is required'); end if;

  v_rate_limit_error := public.check_online_booking_rate_limit(v_lodge_id, v_email, v_phone);
  if v_rate_limit_error is not null then
    return jsonb_build_object('success', false, 'error', v_rate_limit_error);
  end if;

  -- NEW: Maintenance Check (Explicit error instead of generic "unavailable")
  perform public.app_check_room_maintenance(v_lodge_id, v_room_id);

  select *
    into v_room
  from public.rooms r
  where r.id = v_room_id
    and r.lodge_id = v_lodge_id
    and r.status not in ('maintenance')
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found or currently unavailable');
  end if;

  select b.id
    into v_conflict
  from public.bookings b
  where b.lodge_id = v_lodge_id
    and b.room_id = v_room_id
    and b.status not in ('cancelled', 'checked_out')
    and not (b.check_out <= v_check_in or b.check_in >= v_check_out)
  limit 1;

  if v_conflict is not null then
    return jsonb_build_object('success', false, 'error', 'This room is not available for the selected dates');
  end if;

  v_nights := v_check_out - v_check_in;
  v_total := v_room.rate_per_night * v_nights;
  v_idem_key := coalesce(
    nullif(btrim(payload->>'idempotency_key'), ''),
    md5(v_email || '::' || v_room_id::text || '::' || v_check_in::text || '::' || v_check_out::text)
  );

  select b.id
    into v_booking_id
  from public.bookings b
  where b.lodge_id = v_lodge_id
    and b.create_idempotency_key = v_idem_key
  limit 1;

  if found then
    v_reference := 'ONL-' || upper(substring(v_booking_id::text, 1, 8));
    return jsonb_build_object(
      'success', true,
      'reference', v_reference,
      'booking_id', v_booking_id,
      'idempotent', true,
      'lodge_name', v_lodge_name,
      'currency', v_currency,
      'room_number', v_room.room_number,
      'room_type', v_room.room_type,
      'check_in', v_check_in,
      'check_out', v_check_out,
      'nights', v_nights,
      'total_amount', v_total,
      'guest_name', v_first_name || ' ' || v_last_name,
      'guest_email', v_email
    );
  end if;

  select id
    into v_customer_id
  from public.customers
  where lodge_id = v_lodge_id
    and lower(btrim(coalesce(email, ''))) = v_email
  limit 1;

  if not found then
    insert into public.customers (id, lodge_id, name, email, phone)
    values (gen_random_uuid(), v_lodge_id, v_first_name || ' ' || v_last_name, v_email, nullif(v_phone, ''))
    returning id into v_customer_id;
  end if;

  v_booking_id := gen_random_uuid();
  v_reference := 'ONL-' || upper(substring(v_booking_id::text, 1, 8));
  v_invoice_number := public.get_next_invoice_number(v_lodge_id);

  insert into public.bookings (
    id, lodge_id, customer_id, room_id,
    check_in, check_out, adults, children,
    total_amount, amount_paid, payment_status, status,
    source, invoice_number, notes, deposit_amount,
    is_exclusive_event, event_daily_rate,
    created_at, updated_at, create_idempotency_key
  ) values (
    v_booking_id, v_lodge_id, v_customer_id, v_room_id,
    v_check_in, v_check_out, v_adults, v_children,
    v_total, 0, 'unpaid', 'pending',
    'online', v_invoice_number,
    case when v_notes = '' then 'Online booking request' else 'Online booking request: ' || v_notes end,
    0, false, 0, now(), now(), v_idem_key
  );

  insert into invoices (booking_id, lodge_id, invoice_number, issued_at, due_date)
  values (v_booking_id, v_lodge_id, v_invoice_number, now(), v_check_in)
  on conflict do nothing;

  return jsonb_build_object(
    'success', true,
    'reference', v_reference,
    'booking_id', v_booking_id,
    'invoice_number', v_invoice_number,
    'lodge_name', v_lodge_name,
    'currency', v_currency,
    'room_number', v_room.room_number,
    'room_type', v_room.room_type,
    'check_in', v_check_in,
    'check_out', v_check_out,
    'nights', v_nights,
    'total_amount', v_total,
    'guest_name', v_first_name || ' ' || v_last_name,
    'guest_email', v_email
  );
end;
$function$;

commit;
