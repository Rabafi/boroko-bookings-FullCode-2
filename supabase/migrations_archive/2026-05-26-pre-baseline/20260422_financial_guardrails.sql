-- Financial guardrails and mutation hardening

begin;

create or replace function public.room_booking_expected_total(
  p_lodge_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rate numeric;
begin
  if p_room_id is null or p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    return null;
  end if;

  select rate_per_night
    into v_rate
    from public.rooms
   where id = p_room_id
     and lodge_id = p_lodge_id
   limit 1;

  if not found then
    return null;
  end if;

  return round((coalesce(v_rate, 0) * (p_check_out - p_check_in))::numeric, 2);
end;
$function$;

alter table public.payments
  drop constraint if exists payments_booking_id_fkey;

alter table public.payments
  add constraint payments_booking_id_fkey
  foreign key (booking_id) references public.bookings(id) on delete restrict;

alter table public.invoices
  drop constraint if exists invoices_booking_id_fkey;

alter table public.invoices
  add constraint invoices_booking_id_fkey
  foreign key (booking_id) references public.bookings(id) on delete restrict;

create or replace function public.undo_import_batch(p_batch_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_batch record;
  v_deleted_bookings int;
  v_deleted_customers int;
begin
  select *
    into v_batch
    from public.import_batches
   where id = p_batch_id
     and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Import batch not found');
  end if;

  if exists (
    select 1
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where b.import_batch_id = p_batch_id
       and b.lodge_id = p_lodge_id
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'This import batch includes bookings with recorded payments and cannot be undone automatically.'
    );
  end if;

  delete from public.invoices i
   using public.bookings b
   where i.booking_id = b.id
     and b.import_batch_id = p_batch_id
     and b.lodge_id = p_lodge_id;

  delete from public.bookings
   where import_batch_id = p_batch_id
     and lodge_id = p_lodge_id;
  get diagnostics v_deleted_bookings = row_count;

  delete from public.customers c
   where c.import_batch_id = p_batch_id
     and c.lodge_id = p_lodge_id
     and not exists (
       select 1
         from public.bookings b
        where b.customer_id = c.id
     );
  get diagnostics v_deleted_customers = row_count;

  delete from public.import_batches
   where id = p_batch_id;

  return jsonb_build_object(
    'success', true,
    'deleted_bookings', v_deleted_bookings,
    'deleted_customers', v_deleted_customers
  );
end;
$function$;

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
  v_conflict int;
  v_existing_id uuid;
  v_id uuid := coalesce(p_booking_id, gen_random_uuid());
  v_is_existing boolean := false;
  v_dep_result jsonb;
  v_expected_total numeric;
  v_total_amount numeric := round(coalesce(p_total_amount, 0)::numeric, 2);
begin
  perform public.app_reject_pwa_financial_mutation();

  if p_deposit_amount > 0 and p_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

  if v_total_amount < 0 then
    return jsonb_build_object('success', false, 'error', 'Booking total cannot be negative');
  end if;

  v_expected_total := public.room_booking_expected_total(p_lodge_id, p_room_id, p_check_in, p_check_out);
  if v_expected_total is null then
    return jsonb_build_object('success', false, 'error', 'Invalid room or stay dates');
  end if;

  if abs(v_total_amount - v_expected_total) > 0.01 then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Booking total must match the room rate for this stay. Expected %s, received %s.',
        v_expected_total,
        v_total_amount
      )
    );
  end if;

  if p_idempotency_key is not null then
    select b.id
      into v_existing_id
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
    select b.id
      into v_existing_id
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
      v_total_amount, 0, 'unpaid',
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
  v_is_existing boolean := false;
  v_deposit_amount numeric := coalesce((payload->>'deposit_amount')::numeric, 0);
  v_deposit_method text := nullif(payload->>'deposit_method', '');
  v_dep_result jsonb;
  v_is_exclusive_event boolean := coalesce((payload->>'is_exclusive_event')::boolean, false);
  v_allow_total_override boolean := coalesce((payload->>'allow_total_override')::boolean, false);
  v_total_amount numeric := round(coalesce((payload->>'total_amount')::numeric, 0)::numeric, 2);
  v_expected_total numeric;
begin
  perform public.app_reject_pwa_financial_mutation();

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

  if payload ? 'create_idempotency_key' and nullif(payload->>'create_idempotency_key', '') is not null then
    select b.id
      into v_existing_id
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

  if v_invoice_number is null and not v_is_existing then
    v_invoice_number := get_next_invoice_number(v_lodge_id);
  end if;

  if not v_is_existing then
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
      v_status, v_invoice_number,
      coalesce(payload->>'notes', ''),
      nullif(payload->>'created_by', '')::uuid,
      v_deposit_amount, null,
      v_is_exclusive_event,
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
         updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id, 'payment_status', v_new_status);
end;
$update_booking$;

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
  v_booking public.bookings%rowtype;
  v_new_paid numeric;
  v_total_owed numeric;
  v_status text;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'finance', 'manager', 'admin', 'super_admin']);

  if p_idempotency_key is not null then
    if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
      select amount_paid, payment_status
        into v_new_paid, v_status
        from public.bookings
       where id = p_booking_id;
      return jsonb_build_object(
        'success', true,
        'amount_paid', v_new_paid,
        'payment_status', v_status,
        'idempotent', true
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
     set amount_paid = v_new_paid,
         payment_status = v_status,
         payment_method = coalesce(p_method, payment_method),
         updated_at = now()
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
    'success', true,
    'amount_paid', v_new_paid,
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
  v_booking public.bookings%rowtype;
  v_paid numeric;
  v_retained_percent numeric;
  v_refund_amount numeric;
  v_retained_amount numeric;
  v_new_paid numeric;
  v_status text;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

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
        'success', true,
        'booking_id', p_booking_id,
        'amount_paid', coalesce(v_booking.amount_paid, 0),
        'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
        'idempotent', true
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
     set amount_paid = v_new_paid,
         payment_status = v_status,
         payment_method = coalesce(nullif(p_method, ''), payment_method),
         updated_at = now()
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
    'success', true,
    'booking_id', p_booking_id,
    'refund_amount', v_refund_amount,
    'retained_amount', v_retained_amount,
    'retained_percent', v_retained_percent,
    'amount_paid', v_new_paid,
    'payment_status', v_status
  );
end;
$refund_booking$;

create or replace function public.void_pos_order(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_outlet_id uuid;
  v_line record;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['supervisor', 'manager', 'admin', 'super_admin']);

  select status, outlet_id
    into v_status, v_outlet_id
    from public.pos_orders
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  perform public.app_require_pos_outlet_access(p_lodge_id, v_outlet_id);

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  for v_line in
    select poi.quantity,
           pmi.inventory_item_id,
           coalesce(pmi.depletion_qty, 1) as depletion_qty
      from public.pos_order_items poi
      left join public.pos_menu_items pmi
        on pmi.id = poi.menu_item_id
       and pmi.lodge_id = p_lodge_id
     where poi.order_id = p_id
       and poi.lodge_id = p_lodge_id
  loop
    if v_line.inventory_item_id is not null then
      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) + (coalesce(v_line.depletion_qty, 1) * coalesce(v_line.quantity, 0))
       where id = v_line.inventory_item_id
         and lodge_id = p_lodge_id;
    end if;
  end loop;

  update public.pos_orders
     set status = 'voided'
   where id = p_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id);
end;
$function$;

create or replace function public.approve_pos_void_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id uuid := (payload->>'order_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_requested_by uuid := public.app_current_user_id();
  v_approved_by uuid := nullif(payload->>'approved_by', '')::uuid;
  v_reason text := nullif(payload->>'reason', '');
  v_payload_outlet uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_order_outlet_id uuid;
  v_status text;
  v_line record;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select status, outlet_id
    into v_status, v_order_outlet_id
    from public.pos_orders
   where id = v_order_id
     and lodge_id = v_lodge_id
   for update;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  perform public.app_require_pos_outlet_access(v_lodge_id, coalesce(v_order_outlet_id, v_payload_outlet));

  if not exists (
    select 1
      from public.users u
     where u.id = v_approved_by
       and u.lodge_id = v_lodge_id
       and lower(coalesce(u.role, '')) in ('supervisor', 'manager', 'admin', 'super_admin')
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid approver');
  end if;

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  for v_line in
    select poi.quantity,
           pmi.inventory_item_id,
           coalesce(pmi.depletion_qty, 1) as depletion_qty
      from public.pos_order_items poi
      left join public.pos_menu_items pmi
        on pmi.id = poi.menu_item_id
       and pmi.lodge_id = v_lodge_id
     where poi.order_id = v_order_id
       and poi.lodge_id = v_lodge_id
  loop
    if v_line.inventory_item_id is not null then
      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) + (coalesce(v_line.depletion_qty, 1) * coalesce(v_line.quantity, 0))
       where id = v_line.inventory_item_id
         and lodge_id = v_lodge_id;
    end if;
  end loop;

  update public.pos_orders
     set status = 'voided'
   where id = v_order_id
     and lodge_id = v_lodge_id;

  insert into public.pos_override_log (
    lodge_id,
    order_id,
    action,
    requested_by,
    approved_by,
    reason,
    outlet_id
  ) values (
    v_lodge_id,
    v_order_id,
    'void',
    v_requested_by,
    v_approved_by,
    v_reason,
    coalesce(v_order_outlet_id, v_payload_outlet)
  );

  return jsonb_build_object('success', true, 'id', v_order_id);
end;
$function$;

notify pgrst, 'reload schema';

commit;
