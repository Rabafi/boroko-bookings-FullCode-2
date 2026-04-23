begin;

alter table public.pos_orders
  add column if not exists folio_charge_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'pos_orders_folio_charge_id_fkey'
       and conrelid = 'public.pos_orders'::regclass
  ) then
    alter table public.pos_orders
      add constraint pos_orders_folio_charge_id_fkey
      foreign key (folio_charge_id) references public.booking_charges(id) on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'bookings_check_dates_valid'
       and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_check_dates_valid
      check (check_out > check_in);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'bookings_status_valid'
       and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_status_valid
      check (status in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'payments_idempotency_key_format_chk'
       and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_idempotency_key_format_chk
      check (
        idempotency_key is null
        or (
          length(idempotency_key) between 8 and 128
          and idempotency_key ~ '^[A-Za-z0-9:_-]+$'
        )
      );
  end if;
end;
$$;

create table if not exists public.financial_validation_alerts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  alert_type text not null,
  issue_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_validation_alerts_lodge_created_idx
  on public.financial_validation_alerts (lodge_id, created_at desc);

revoke all on table public.financial_validation_alerts from public, anon, authenticated;

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
  v_actor uuid := public.app_current_user_id();
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'finance', 'manager', 'admin', 'super_admin']);

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to record a payment.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Payment idempotency key is required');
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

  if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
    return jsonb_build_object(
      'success', true,
      'amount_paid', coalesce(v_booking.amount_paid, 0),
      'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
      'idempotent', true
    );
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

  begin
    insert into public.payments (
      booking_id, lodge_id, amount, method, type,
      paid_at, recorded_by, idempotency_key
    ) values (
      p_booking_id, p_lodge_id, p_amount, p_method, p_type,
      now(), v_actor, p_idempotency_key
    );
  exception
    when unique_violation then
      select amount_paid, payment_status
        into v_new_paid, v_status
        from public.bookings
       where id = p_booking_id
         and lodge_id = p_lodge_id;
      return jsonb_build_object(
        'success', true,
        'amount_paid', coalesce(v_new_paid, 0),
        'payment_status', coalesce(v_status, 'unpaid'),
        'idempotent', true
      );
  end;

  return jsonb_build_object(
    'success', true,
    'amount_paid', v_new_paid,
    'payment_status', v_status
  );
end;
$update_payment$;

create or replace function public.update_booking_payment(
  p_booking_id          uuid,
  p_lodge_id            uuid,
  p_amount              numeric,
  p_method              text,
  p_type                text    default 'payment',
  p_idempotency_key     text    default null,
  p_recorded_by         uuid    default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $update_payment_with_guard$
declare
  v_booking public.bookings%rowtype;
  v_new_paid numeric;
  v_total_owed numeric;
  v_status text;
  v_actor uuid := public.app_current_user_id();
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'finance', 'manager', 'admin', 'super_admin']);

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to record a payment.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Payment idempotency key is required');
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

  if p_expected_updated_at is not null and v_booking.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh the booking and try again.',
      'stale', true,
      'current_updated_at', v_booking.updated_at
    );
  end if;

  if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
    return jsonb_build_object(
      'success', true,
      'amount_paid', coalesce(v_booking.amount_paid, 0),
      'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
      'idempotent', true
    );
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

  begin
    insert into public.payments (
      booking_id, lodge_id, amount, method, type,
      paid_at, recorded_by, idempotency_key
    ) values (
      p_booking_id, p_lodge_id, p_amount, p_method, p_type,
      now(), v_actor, p_idempotency_key
    );
  exception
    when unique_violation then
      select amount_paid, payment_status
        into v_new_paid, v_status
        from public.bookings
       where id = p_booking_id
         and lodge_id = p_lodge_id;
      return jsonb_build_object(
        'success', true,
        'amount_paid', coalesce(v_new_paid, 0),
        'payment_status', coalesce(v_status, 'unpaid'),
        'idempotent', true
      );
  end;

  return jsonb_build_object(
    'success', true,
    'amount_paid', v_new_paid,
    'payment_status', v_status
  );
end;
$update_payment_with_guard$;

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
  v_actor uuid := public.app_current_user_id();
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to record a refund.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Refund idempotency key is required');
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

  if coalesce(v_booking.status, '') in ('checked_in', 'checked_out') then
    return jsonb_build_object(
      'success', false,
      'error', 'Refunds are only allowed before check-in or on already-cancelled bookings.'
    );
  end if;

  if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
    return jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'amount_paid', coalesce(v_booking.amount_paid, 0),
      'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
      'idempotent', true
    );
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

  begin
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
      v_actor,
      concat(
        'Refunded ', v_refund_amount,
        ' | Retained ', v_retained_amount,
        ' (', v_retained_percent, '%)',
        case when coalesce(p_notes, '') <> '' then ' | ' || p_notes else '' end
      ),
      p_idempotency_key
    );
  exception
    when unique_violation then
      return jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'amount_paid', coalesce(v_booking.amount_paid, 0),
        'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
        'idempotent', true
      );
  end;

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
  v_existing_id uuid;
  v_id uuid := coalesce(p_booking_id, gen_random_uuid());
  v_is_existing boolean := false;
  v_dep_result jsonb;
  v_expected_total numeric;
  v_total_amount numeric := round(coalesce(p_total_amount, 0)::numeric, 2);
  v_invoice_number text := nullif(btrim(coalesce(p_invoice_number, '')), '');
  v_deposit_key text;
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

  if not v_is_existing then
    begin
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
        'confirmed', null, p_notes, p_created_by,
        p_deposit_amount, null,
        now(), now(), p_idempotency_key
      );
    exception
      when exclusion_violation then
        return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
    end;

    if v_invoice_number is null then
      v_invoice_number := public.get_next_invoice_number(p_lodge_id);
    end if;

    update public.bookings
       set invoice_number = v_invoice_number,
           updated_at = now()
     where id = v_id
       and lodge_id = p_lodge_id;

    insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at)
    values (v_id, p_lodge_id, v_invoice_number, now())
    on conflict do nothing;
  end if;

  if p_deposit_amount > 0 and p_deposit_method is not null then
    v_deposit_key := 'payment:deposit:' || v_id;
    if not exists (
      select 1
        from public.payments
       where idempotency_key = v_deposit_key
    ) then
      select public.update_booking_payment(
        v_id, p_lodge_id, p_deposit_amount, p_deposit_method,
        'deposit', v_deposit_key, p_created_by
      ) into v_dep_result;

      if not coalesce((v_dep_result->>'success')::boolean, false) then
        if v_is_existing then
          return jsonb_build_object(
            'success', false,
            'booking_id', v_id,
            'error', coalesce(v_dep_result->>'error', 'Deposit could not be recorded')
          );
        end if;

        raise exception using
          message = 'Deposit failed',
          detail = coalesce(v_dep_result->>'error', 'unknown'),
          errcode = 'P0001';
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$create_booking$;

create or replace function public.add_booking_charge(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_description text,
  p_category text default 'other',
  p_quantity numeric default 1,
  p_unit_price numeric default 0,
  p_outlet_id uuid default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $add_charge$
declare
  v_charge_id uuid;
  v_amount numeric;
  v_booking public.bookings%rowtype;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if coalesce(p_unit_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Charge unit price must be greater than zero');
  end if;

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
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

  v_amount := coalesce(p_quantity, 1) * coalesce(p_unit_price, 0);

  insert into public.booking_charges (
    booking_id,
    lodge_id,
    description,
    category,
    quantity,
    unit_price,
    amount,
    outlet_id
  ) values (
    p_booking_id,
    p_lodge_id,
    p_description,
    coalesce(nullif(p_category, ''), 'other'),
    coalesce(p_quantity, 1),
    coalesce(p_unit_price, 0),
    v_amount,
    p_outlet_id
  )
  returning id into v_charge_id;

  return jsonb_build_object('success', true, 'id', v_charge_id);
end;
$add_charge$;

create or replace function public.create_pos_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id                uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id                uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id               uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_room_id                 uuid := nullif(payload->>'room_id', '')::uuid;
  v_booking_id              uuid := nullif(payload->>'booking_id', '')::uuid;
  v_walk_in_name            text := nullif(payload->>'walk_in_name', '');
  v_notes                   text := nullif(payload->>'notes', '');
  v_payment_method          text := coalesce(nullif(payload->>'payment_method', ''), 'cash');
  v_create_idempotency_key  text := nullif(payload->>'create_idempotency_key', '');
  v_created_at_client       timestamptz := nullif(payload->>'created_at_client', '')::timestamptz;
  v_is_replay               boolean := v_create_idempotency_key is not null or payload ? 'created_at_client';
  v_existing_id             uuid;
  v_existing_total          numeric;
  v_existing_charge_id      uuid;
  v_item                    jsonb;
  v_menu_item_id            uuid;
  v_inv_item_id             uuid;
  v_depletion_qty           numeric;
  v_quantity                numeric;
  v_db_price                numeric;
  v_unit_price              numeric;
  v_item_name               text;
  v_computed_total          numeric := 0;
  v_is_available            boolean;
  v_required_stock          numeric;
  v_new_stock               numeric;
  v_folio_charge_id         uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  if v_payment_method = 'folio' and v_booking_id is null and v_room_id is not null then
    select b.id
      into v_booking_id
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.room_id = v_room_id
       and b.status in ('confirmed', 'checked_in')
       and b.check_in <= current_date
       and b.check_out > current_date
     order by b.check_in desc, b.created_at desc
     limit 1;
  end if;

  if v_payment_method = 'folio' then
    if v_booking_id is null then
      return jsonb_build_object('success', false, 'error', 'Room folio charge requires an active booking');
    end if;

    if not exists (
      select 1
        from public.bookings b
       where b.id = v_booking_id
         and b.lodge_id = v_lodge_id
         and b.status in ('confirmed', 'checked_in')
    ) then
      return jsonb_build_object('success', false, 'error', 'Active booking not found for folio charge');
    end if;
  end if;

  if v_create_idempotency_key is not null then
    select id, total, folio_charge_id
      into v_existing_id, v_existing_total, v_existing_charge_id
      from public.pos_orders
     where lodge_id = v_lodge_id
       and create_idempotency_key = v_create_idempotency_key
     for update;

    if found then
      if coalesce(v_existing_total, 0) <= 0 then
        return jsonb_build_object('success', false, 'error', 'Existing POS order is incomplete and needs review before replay');
      end if;

      if v_payment_method = 'folio' and v_existing_charge_id is null then
        return jsonb_build_object('success', false, 'error', 'Existing folio POS order is missing its booking charge and needs review');
      end if;

      return jsonb_build_object(
        'success', true,
        'id', v_existing_id,
        'total', coalesce(v_existing_total, 0),
        'idempotent', true,
        'replayed', true
      );
    end if;
  end if;

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');

    if v_menu_item_id is not null then
      select price,
             inventory_item_id,
             coalesce(depletion_qty, 1),
             coalesce(is_available, true)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty,
             v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if found then
        if not v_is_available then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;

        v_unit_price := case
          when v_is_replay then coalesce((v_item->>'unit_price')::numeric, 0)
          else v_db_price
        end;
      elsif v_is_replay then
        v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
        v_inv_item_id := null;
        v_depletion_qty := 1;
      else
        raise exception 'POS menu item % not found for lodge % — order rejected', v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id := null;
      v_depletion_qty := 1;
    end if;

    v_computed_total := v_computed_total + (v_quantity * v_unit_price);
  end loop;

  insert into public.pos_orders (
    id,
    lodge_id,
    room_id,
    booking_id,
    walk_in_name,
    total,
    notes,
    payment_method,
    outlet_id,
    status,
    created_at,
    create_idempotency_key,
    folio_charge_id
  ) values (
    v_order_id,
    v_lodge_id,
    v_room_id,
    v_booking_id,
    v_walk_in_name,
    v_computed_total,
    v_notes,
    v_payment_method,
    v_outlet_id,
    'completed',
    coalesce(v_created_at_client, now()),
    v_create_idempotency_key,
    null
  );

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');

    if v_menu_item_id is not null then
      select price,
             inventory_item_id,
             coalesce(depletion_qty, 1),
             coalesce(is_available, true)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty,
             v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if found then
        if not v_is_available then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;

        v_unit_price := case
          when v_is_replay then coalesce((v_item->>'unit_price')::numeric, 0)
          else v_db_price
        end;
      elsif v_is_replay then
        v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
        v_inv_item_id := null;
        v_depletion_qty := 1;
      else
        raise exception 'POS menu item % not found for lodge % — order rejected', v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id := null;
      v_depletion_qty := 1;
    end if;

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id,
      item_name, quantity, unit_price, subtotal
    ) values (
      gen_random_uuid(),
      v_order_id,
      v_lodge_id,
      v_menu_item_id,
      v_item_name,
      v_quantity,
      v_unit_price,
      v_quantity * v_unit_price
    );

    if v_inv_item_id is not null then
      v_required_stock := coalesce(v_depletion_qty, 1) * v_quantity;

      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) - v_required_stock
       where id = v_inv_item_id
         and lodge_id = v_lodge_id
         and coalesce(current_stock, 0) >= v_required_stock
      returning current_stock into v_new_stock;

      if not found then
        raise exception 'Not enough stock left for %. Refresh the POS and try again.', v_item_name;
      end if;
    end if;
  end loop;

  if v_payment_method = 'folio' then
    insert into public.booking_charges (
      booking_id,
      lodge_id,
      description,
      category,
      quantity,
      unit_price,
      amount,
      outlet_id
    ) values (
      v_booking_id,
      v_lodge_id,
      'POS folio charge · order ' || left(v_order_id::text, 8),
      'pos',
      1,
      v_computed_total,
      v_computed_total,
      v_outlet_id
    )
    returning id into v_folio_charge_id;

    update public.pos_orders
       set folio_charge_id = v_folio_charge_id
     where id = v_order_id
       and lodge_id = v_lodge_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'total', v_computed_total,
    'booking_id', v_booking_id,
    'folio_charge_id', v_folio_charge_id
  );
end;
$function$;

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
  v_folio_charge_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['supervisor', 'manager', 'admin', 'super_admin']);

  select status, outlet_id, folio_charge_id
    into v_status, v_outlet_id, v_folio_charge_id
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

  if v_folio_charge_id is not null then
    perform public.delete_booking_charge(v_folio_charge_id, p_lodge_id, 'Voided with POS order');
  end if;

  update public.pos_orders
     set status = 'voided'
   where id = p_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_id);
end;
$function$;

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

  if
    v_current.total_amount is distinct from v_new_total
    or v_current.room_id is distinct from v_room_id
    or v_current.check_in is distinct from v_check_in
    or v_current.check_out is distinct from v_check_out
  then
    insert into public.financial_audit_log (
      lodge_id,
      booking_id,
      action,
      actor_id,
      amount_delta,
      before_snapshot,
      after_snapshot
    ) values (
      p_lodge_id,
      p_id,
      'booking_updated',
      v_actor,
      round((coalesce(v_new_total, 0) - coalesce(v_current.total_amount, 0))::numeric, 2),
      jsonb_build_object(
        'room_id', v_current.room_id,
        'check_in', v_current.check_in,
        'check_out', v_current.check_out,
        'total_amount', v_current.total_amount,
        'payment_status', v_current.payment_status
      ),
      jsonb_build_object(
        'room_id', v_room_id,
        'check_in', v_check_in,
        'check_out', v_check_out,
        'total_amount', v_new_total,
        'payment_status', v_new_status
      )
    );
  end if;

  return jsonb_build_object('success', true, 'id', p_id, 'payment_status', v_new_status, 'updated_at', v_next_updated_at);
end;
$update_booking$;

create or replace function public.verify_refund_approver_pin(
  p_lodge_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_approver record;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if nullif(btrim(coalesce(p_pin, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Approval PIN is required');
  end if;

  select u.id, u.name, u.role
    into v_approver
    from public.users u
   where u.lodge_id = p_lodge_id
     and lower(coalesce(u.role, '')) in ('manager', 'admin', 'super_admin')
     and u.pin_hash is not null
     and extensions.crypt(p_pin, u.pin_hash) = u.pin_hash
   order by u.created_at asc
   limit 1;

  if v_approver.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid approval PIN or unauthorized approver');
  end if;

  return jsonb_build_object(
    'success', true,
    'approved_by', v_approver.id,
    'approved_by_name', v_approver.name,
    'approved_by_role', v_approver.role
  );
end;
$function$;

create or replace function public.approve_booking_refund(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_retained_percent numeric default 0,
  p_method text default 'refund',
  p_notes text default '',
  p_requested_by uuid default null,
  p_approved_by uuid default null,
  p_proof_reference text default '',
  p_approval_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_actor uuid := public.app_current_user_id();
  v_approver_role text;
  v_refund jsonb;
  v_should_cancel boolean := false;
  v_requested_by uuid := public.app_current_user_id();
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to approve a refund.');
  end if;

  if p_approved_by is null then
    return jsonb_build_object('success', false, 'error', 'Refund approval is required');
  end if;

  select role
    into v_approver_role
    from public.users
   where id = p_approved_by
     and lodge_id = p_lodge_id
   limit 1;

  if coalesce(v_approver_role, '') not in ('manager', 'admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'Approver does not have refund approval rights');
  end if;

  if nullif(btrim(coalesce(p_proof_reference, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Refund proof reference is required');
  end if;

  if nullif(btrim(coalesce(p_approval_note, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Refund approval note is required');
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

  if coalesce(v_booking.status, '') in ('checked_in', 'checked_out') then
    return jsonb_build_object(
      'success', false,
      'error', 'Refunds are only allowed before check-in or on already-cancelled bookings. Checked-in and checked-out bookings must use a manual finance adjustment workflow.'
    );
  end if;

  v_should_cancel := coalesce(v_booking.status, '') in ('pending', 'confirmed');

  v_refund := public.record_booking_refund(
    p_booking_id,
    p_lodge_id,
    p_retained_percent,
    p_method,
    trim(both from concat(
      coalesce(nullif(p_notes, ''), ''),
      case
        when coalesce(nullif(p_proof_reference, ''), '') <> '' then ' | Proof: ' || p_proof_reference
        else ''
      end,
      case
        when coalesce(nullif(p_approval_note, ''), '') <> '' then ' | Approval: ' || p_approval_note
        else ''
      end
    )),
    v_requested_by,
    'refund-approval:' || p_booking_id::text || ':' || md5(
      coalesce(p_approved_by::text, '') || ':' ||
      coalesce(p_retained_percent::text, '') || ':' ||
      coalesce(p_method, '') || ':' ||
      coalesce(p_notes, '') || ':' ||
      coalesce(p_proof_reference, '')
    )
  );

  if coalesce((v_refund->>'success')::boolean, false) = false then
    return v_refund;
  end if;

  if v_should_cancel then
    update public.bookings
       set status = 'cancelled',
           updated_at = now()
     where id = p_booking_id
       and lodge_id = p_lodge_id;

    insert into public.financial_audit_log (
      lodge_id,
      booking_id,
      action,
      actor_id,
      amount_delta,
      before_snapshot,
      after_snapshot
    ) values (
      p_lodge_id,
      p_booking_id,
      'booking_status_changed',
      coalesce(v_actor, p_approved_by),
      null,
      jsonb_build_object('status', v_booking.status),
      jsonb_build_object('status', 'cancelled', 'reason', 'refund_approved')
    );
  end if;

  insert into public.refund_approval_log (
    lodge_id,
    booking_id,
    approved_by,
    requested_by,
    refund_amount,
    retained_amount,
    retained_percent,
    method,
    notes,
    proof_reference,
    approval_note
  ) values (
    p_lodge_id,
    p_booking_id,
    p_approved_by,
    v_requested_by,
    coalesce((v_refund->>'refund_amount')::numeric, 0),
    coalesce((v_refund->>'retained_amount')::numeric, 0),
    coalesce((v_refund->>'retained_percent')::numeric, 0),
    coalesce(nullif(p_method, ''), 'refund'),
    nullif(p_notes, ''),
    nullif(p_proof_reference, ''),
    nullif(p_approval_note, '')
  );

  return v_refund || jsonb_build_object(
    'approved_by', p_approved_by,
    'booking_status', case when v_should_cancel then 'cancelled' else v_booking.status end
  );
end;
$function$;

create or replace function public.record_invoice_delivery(
  p_lodge_id uuid,
  p_booking_id uuid default null,
  p_invoice_number text default null,
  p_delivery_type text default 'invoice_email',
  p_delivery_status text default 'completed',
  p_recipient text default null,
  p_file_path text default null,
  p_render_version text default null,
  p_initiated_by uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_actor uuid := public.app_current_user_id();
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to record invoice delivery.');
  end if;

  insert into public.invoice_delivery_log (
    lodge_id,
    booking_id,
    invoice_number,
    delivery_type,
    delivery_status,
    recipient,
    file_path,
    render_version,
    initiated_by,
    metadata
  ) values (
    p_lodge_id,
    p_booking_id,
    nullif(p_invoice_number, ''),
    p_delivery_type,
    p_delivery_status,
    nullif(p_recipient, ''),
    nullif(p_file_path, ''),
    nullif(p_render_version, ''),
    v_actor,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

create or replace function public.record_financial_validation_run(
  p_lodge_id uuid,
  p_trigger_source text default 'manual',
  p_triggered_by uuid default null,
  p_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_actor uuid := coalesce(public.app_current_user_id(), p_triggered_by);
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['finance', 'manager', 'admin', 'super_admin']
  );

  insert into public.financial_validation_runs (
    lodge_id,
    triggered_by,
    trigger_source,
    summary
  ) values (
    p_lodge_id,
    v_actor,
    case
      when p_trigger_source in ('manual', 'scheduled', 'startup') then p_trigger_source
      else 'manual'
    end,
    coalesce(p_summary, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

create or replace function public.delete_booking_charge(
  p_charge_id uuid,
  p_lodge_id uuid,
  p_reason text default null,
  p_expected_booking_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_raw text;
  v_actor uuid;
  v_charge public.booking_charges%rowtype;
  v_booking public.bookings%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  select *
    into v_charge
    from public.booking_charges
   where id = p_charge_id
     and lodge_id = p_lodge_id
   for update;

  if v_charge.id is null then
    return jsonb_build_object('success', false, 'error', 'Charge not found');
  end if;

  if v_charge.voided_at is not null then
    return jsonb_build_object('success', true, 'id', v_charge.id, 'already_voided', true);
  end if;

  select *
    into v_booking
    from public.bookings
   where id = v_charge.booking_id
     and lodge_id = p_lodge_id
   for update;

  if v_booking.id is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if p_expected_booking_updated_at is not null and v_booking.updated_at is distinct from p_expected_booking_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh the booking and try again.',
      'stale', true,
      'current_updated_at', v_booking.updated_at
    );
  end if;

  v_actor_raw := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor := case when v_actor_raw ~ '^[0-9a-f\\-]{36}$' then v_actor_raw::uuid else null end;

  update public.booking_charges
     set voided_at = now(),
         voided_by = v_actor,
         void_reason = coalesce(v_reason, 'Voided by staff')
   where id = v_charge.id;

  insert into public.financial_audit_log (
    lodge_id,
    booking_id,
    action,
    actor_id,
    amount_delta,
    before_snapshot,
    after_snapshot
  ) values (
    v_charge.lodge_id,
    v_charge.booking_id,
    'charge_deleted',
    v_actor,
    -1 * coalesce(v_charge.amount, 0),
    jsonb_build_object(
      'charge_id', v_charge.id,
      'description', v_charge.description,
      'category', v_charge.category,
      'amount', v_charge.amount,
      'quantity', v_charge.quantity,
      'unit_price', v_charge.unit_price
    ),
    jsonb_build_object(
      'voided_at', now(),
      'voided_by', v_actor,
      'void_reason', coalesce(v_reason, 'Voided by staff')
    )
  );

  return jsonb_build_object(
    'success', true,
    'id', v_charge.id,
    'voided', true
  );
end;
$function$;

create or replace function public.delete_booking_charge(
  p_charge_id uuid,
  p_lodge_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return public.delete_booking_charge(p_charge_id, p_lodge_id, p_reason, null);
end;
$function$;

create or replace function public.run_financial_reconciliation_snapshot(
  p_lodge_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inserted integer := 0;
begin
  with scoped_lodges as (
    select s.lodge_id
      from public.settings s
     where coalesce(s.deleted, false) = false
       and (p_lodge_id is null or s.lodge_id = p_lodge_id)
  ),
  payment_totals as (
    select b.lodge_id, b.id as booking_id, round(coalesce(sum(p.amount), 0)::numeric, 2) as ledger_amount
      from public.bookings b
      left join public.payments p
        on p.booking_id = b.id
       and p.lodge_id = b.lodge_id
     where b.lodge_id in (select lodge_id from scoped_lodges)
       and lower(coalesce(b.status, '')) <> 'cancelled'
     group by b.lodge_id, b.id
  ),
  charge_totals as (
    select b.lodge_id, b.id as booking_id, round(coalesce(sum(case when c.voided_at is null then c.amount else 0 end), 0)::numeric, 2) as ledger_amount
      from public.bookings b
      left join public.booking_charges c
        on c.booking_id = b.id
       and c.lodge_id = b.lodge_id
     where b.lodge_id in (select lodge_id from scoped_lodges)
       and lower(coalesce(b.status, '')) <> 'cancelled'
     group by b.lodge_id, b.id
  ),
  invoice_gaps as (
    select b.lodge_id, count(*)::int as issue_count
      from public.bookings b
      left join public.invoices i
        on i.booking_id = b.id
       and i.lodge_id = b.lodge_id
     where b.lodge_id in (select lodge_id from scoped_lodges)
       and lower(coalesce(b.status, '')) <> 'cancelled'
       and (
         nullif(btrim(coalesce(b.invoice_number, '')), '') is null
         or i.id is null
       )
     group by b.lodge_id
  ),
  orphan_invoices as (
    select i.lodge_id, count(*)::int as issue_count
      from public.invoices i
      left join public.bookings b
        on b.id = i.booking_id
       and b.lodge_id = i.lodge_id
     where i.lodge_id in (select lodge_id from scoped_lodges)
       and (i.booking_id is null or b.id is null)
     group by i.lodge_id
  ),
  folio_pos_mismatches as (
    select o.lodge_id, count(*)::int as issue_count
      from public.pos_orders o
      left join public.booking_charges c
        on c.id = o.folio_charge_id
       and c.lodge_id = o.lodge_id
       and c.voided_at is null
     where o.lodge_id in (select lodge_id from scoped_lodges)
       and lower(coalesce(o.payment_method, '')) = 'folio'
       and lower(coalesce(o.status, '')) <> 'voided'
       and (
         o.booking_id is null
         or o.folio_charge_id is null
         or c.id is null
         or round(coalesce(o.total, 0)::numeric, 2) <> round(coalesce(c.amount, 0)::numeric, 2)
       )
     group by o.lodge_id
  ),
  summary_rows as (
    select
      l.lodge_id,
      coalesce(pm.issue_count, 0) as payment_mismatches,
      coalesce(cm.issue_count, 0) as charge_mismatches,
      coalesce(ig.issue_count, 0) as invoice_gaps,
      coalesce(oi.issue_count, 0) as orphan_invoices,
      coalesce(fp.issue_count, 0) as folio_pos_mismatches
    from scoped_lodges l
    left join (
      select p.lodge_id, count(*)::int as issue_count
        from payment_totals p
        join public.bookings b
          on b.id = p.booking_id
         and b.lodge_id = p.lodge_id
       where round(coalesce(b.amount_paid, 0)::numeric, 2) <> p.ledger_amount
       group by p.lodge_id
    ) pm on pm.lodge_id = l.lodge_id
    left join (
      select c.lodge_id, count(*)::int as issue_count
        from charge_totals c
        join public.bookings b
          on b.id = c.booking_id
         and b.lodge_id = c.lodge_id
       where round(coalesce(b.charges_total, 0)::numeric, 2) <> c.ledger_amount
       group by c.lodge_id
    ) cm on cm.lodge_id = l.lodge_id
    left join invoice_gaps ig on ig.lodge_id = l.lodge_id
    left join orphan_invoices oi on oi.lodge_id = l.lodge_id
    left join folio_pos_mismatches fp on fp.lodge_id = l.lodge_id
  )
  insert into public.financial_validation_alerts (
    lodge_id,
    alert_type,
    issue_count,
    summary
  )
  select
    lodge_id,
    'nightly_reconciliation',
    payment_mismatches + charge_mismatches + invoice_gaps + orphan_invoices + folio_pos_mismatches,
    jsonb_build_object(
      'payment_mismatches', payment_mismatches,
      'charge_mismatches', charge_mismatches,
      'invoice_gaps', invoice_gaps,
      'orphan_invoices', orphan_invoices,
      'folio_pos_mismatches', folio_pos_mismatches
    )
  from summary_rows
  where (payment_mismatches + charge_mismatches + invoice_gaps + orphan_invoices + folio_pos_mismatches) > 0;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object('success', true, 'alerts_created', v_inserted);
end;
$function$;

create or replace function public.get_financial_validation_alerts(
  p_lodge_id uuid,
  p_limit int default 50
)
returns table (
  id uuid,
  lodge_id uuid,
  alert_type text,
  issue_count integer,
  summary jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select
    a.id,
    a.lodge_id,
    a.alert_type,
    a.issue_count,
    a.summary,
    a.created_at
  from public.financial_validation_alerts a
  where a.lodge_id = p_lodge_id
  order by a.created_at desc, a.id desc
  limit greatest(coalesce(p_limit, 50), 1);
end;
$function$;

create or replace function public.get_manager_dashboard_snapshot(
  p_lodge_id uuid,
  p_today date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_today date := coalesce(p_today, current_date);
  v_month_start date := date_trunc('month', coalesce(p_today, current_date)::timestamp)::date;
  v_month_end_exclusive date := (date_trunc('month', coalesce(p_today, current_date)::timestamp) + interval '1 month')::date;
  v_next_week date := coalesce(p_today, current_date) + 7;
  v_previous_start date := coalesce(p_today, current_date) - 6;
  v_all_lodge_rooms integer := 0;
  v_occupied integer := 0;
  v_open_maintenance integer := 0;
  v_urgent_maintenance integer := 0;
  v_low_stock_count integer := 0;
  v_unpaid_count integer := 0;
  v_outstanding_total numeric := 0;
  v_month_expenses numeric := 0;
  v_month_gross_collected numeric := 0;
  v_month_refunds numeric := 0;
  v_month_revenue numeric := 0;
  v_quotations_open_count integer := 0;
  v_day_use_revenue numeric := 0;
  v_low_stock jsonb := '[]'::jsonb;
  v_upcoming_arrivals jsonb := '[]'::jsonb;
  v_conference_upcoming jsonb := '[]'::jsonb;
  v_revenue_trend jsonb := '[]'::jsonb;
  v_occupancy_trend jsonb := '[]'::jsonb;
  v_top_balances jsonb := '[]'::jsonb;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select count(*) into v_all_lodge_rooms
  from public.rooms
  where lodge_id = p_lodge_id;

  select count(*) into v_occupied
  from public.bookings
  where lodge_id = p_lodge_id
    and status = 'checked_in';

  select
    count(*) filter (where status = 'open'),
    count(*) filter (where status = 'open' and priority = 'urgent')
    into v_open_maintenance, v_urgent_maintenance
  from public.maintenance_tickets
  where lodge_id = p_lodge_id;

  select count(*)
    into v_low_stock_count
  from public.inventory_items
  where lodge_id = p_lodge_id
    and coalesce(reorder_level, 0) > 0
    and coalesce(current_stock, 0) <= coalesce(reorder_level, 0);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.current_stock asc, t.name asc), '[]'::jsonb)
    into v_low_stock
  from (
    select
      ii.id,
      ii.name,
      ii.category,
      coalesce(ii.current_stock, 0) as current_stock,
      ii.reorder_level,
      ii.unit
    from public.inventory_items ii
    where ii.lodge_id = p_lodge_id
      and coalesce(ii.reorder_level, 0) > 0
      and coalesce(ii.current_stock, 0) <= coalesce(ii.reorder_level, 0)
    order by coalesce(ii.current_stock, 0) asc, ii.name asc
    limit 5
  ) t;

  select
    count(*),
    coalesce(sum(greatest(0, coalesce(total_amount, 0) + coalesce(charges_total, 0) - coalesce(amount_paid, 0))), 0)
    into v_unpaid_count, v_outstanding_total
  from public.bookings
  where lodge_id = p_lodge_id
    and status not in ('cancelled', 'checked_out')
    and coalesce(payment_status, 'unpaid') in ('unpaid', 'partial');

  select coalesce(sum(amount), 0)
    into v_month_gross_collected
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz
    and amount > 0;

  select coalesce(sum(abs(amount)), 0)
    into v_month_refunds
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz
    and (amount < 0 or lower(coalesce(type, '')) = 'refund');

  v_month_revenue := coalesce(v_month_gross_collected, 0) - coalesce(v_month_refunds, 0);

  select coalesce(sum(amount), 0)
    into v_month_expenses
  from public.expenses
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select count(*)
    into v_quotations_open_count
  from public.quotations
  where lodge_id = p_lodge_id
    and status in ('draft', 'sent', 'accepted');

  select coalesce(sum(total), 0)
    into v_day_use_revenue
  from public.pool_day_use
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.check_in asc, t.room_number asc nulls last), '[]'::jsonb)
    into v_upcoming_arrivals
  from (
    select
      b.id,
      coalesce(b.guest_name, c.name, 'Guest') as guest_name,
      coalesce(c.name, b.guest_name, 'Guest') as customer_name,
      b.check_in,
      b.check_out,
      b.room_number,
      b.source,
      b.status,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      case
        when b.source = 'online' and b.status = 'pending' then 'awaiting_front_desk_confirmation'
        else b.status
      end as manager_arrival_status,
      case
        when b.source = 'online' and b.status = 'pending' then 'Online request waiting for front desk confirmation.'
        when b.status = 'confirmed' then 'Confirmed and ready for front desk preparation.'
        when b.status = 'checked_in' then 'Guest is already checked in.'
        when b.status = 'checked_out' then 'Guest has already checked out.'
        else 'Active booking.'
      end as manager_arrival_note
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.status <> 'cancelled'
      and b.check_in >= v_today
      and b.check_in <= v_next_week
    order by b.check_in asc, b.room_number asc nulls last
    limit 6
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.booking_date asc), '[]'::jsonb)
    into v_conference_upcoming
  from (
    select
      cb.id,
      cb.client_name,
      cb.booking_date,
      cb.start_time,
      cb.end_time,
      cb.setup_type,
      coalesce(cb.total_amount, 0) as total_amount,
      coalesce(cb.deposit_paid, 0) as deposit_paid,
      cb.payment_status
    from public.conference_bookings cb
    where cb.lodge_id = p_lodge_id
      and cb.booking_date >= v_today
      and cb.booking_date <= v_next_week
    order by cb.booking_date asc, cb.start_time asc nulls last
    limit 4
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
      'day', to_char(t.day, 'YYYY-MM-DD'),
      'amount', coalesce(t.amount, 0)
    ) order by t.day), '[]'::jsonb)
    into v_revenue_trend
  from (
    select
      d.day::date as day,
      coalesce(sum(p.amount), 0) as amount
    from generate_series(v_previous_start::timestamp, v_today::timestamp, interval '1 day') d(day)
    left join public.payments p
      on p.lodge_id = p_lodge_id
     and p.paid_at >= d.day
     and p.paid_at < (d.day + interval '1 day')
    group by d.day
    order by d.day
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
      'day', to_char(t.day, 'YYYY-MM-DD'),
      'occupied', t.occupied,
      'percent', t.percent
    ) order by t.day), '[]'::jsonb)
    into v_occupancy_trend
  from (
    select
      d.day::date as day,
      count(b.id) as occupied,
      case
        when v_all_lodge_rooms > 0 then round((count(b.id)::numeric / v_all_lodge_rooms::numeric) * 100)
        else 0
      end as percent
    from generate_series(v_previous_start::timestamp, v_today::timestamp, interval '1 day') d(day)
    left join public.bookings b
      on b.lodge_id = p_lodge_id
     and b.status <> 'cancelled'
     and b.check_in <= d.day::date
     and b.check_out > d.day::date
    group by d.day
    order by d.day
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.balance desc, t.check_in asc), '[]'::jsonb)
    into v_top_balances
  from (
    select
      b.id,
      coalesce(b.guest_name, c.name, 'Guest') as guest_name,
      coalesce(c.name, b.guest_name, 'Guest') as customer_name,
      b.check_in,
      b.check_out,
      greatest(0, coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)) as balance
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.status <> 'cancelled'
      and greatest(0, coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)) > 0
    order by balance desc, b.check_in asc
    limit 5
  ) t;

  return jsonb_build_object(
    'totalRooms', v_all_lodge_rooms,
    'occupied', v_occupied,
    'occupancyPercent', case when v_all_lodge_rooms > 0 then round((v_occupied::numeric / v_all_lodge_rooms::numeric) * 100) else 0 end,
    'openMaintenanceCount', v_open_maintenance,
    'urgentMaintenanceCount', v_urgent_maintenance,
    'lowStockCount', v_low_stock_count,
    'unpaidCount', v_unpaid_count,
    'outstandingTotal', coalesce(v_outstanding_total, 0),
    'monthExpenses', coalesce(v_month_expenses, 0),
    'monthGrossCollected', coalesce(v_month_gross_collected, 0),
    'monthRefunds', coalesce(v_month_refunds, 0),
    'monthRevenue', coalesce(v_month_revenue, 0),
    'monthNet', coalesce(v_month_revenue, 0) - coalesce(v_month_expenses, 0),
    'upcomingArrivals', v_upcoming_arrivals,
    'conferenceUpcoming', v_conference_upcoming,
    'quotationsOpenCount', v_quotations_open_count,
    'dayUseRevenue', coalesce(v_day_use_revenue, 0),
    'lowStock', v_low_stock,
    'revenueTrend', v_revenue_trend,
    'occupancyTrend', v_occupancy_trend,
    'topBalances', v_top_balances
  );
end;
$function$;

create or replace function public.get_reports_snapshot(
  p_lodge_id uuid,
  p_today date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_today date := coalesce(p_today, current_date);
  v_week_start date := date_trunc('week', coalesce(p_today, current_date)::timestamp)::date;
  v_month_start date := date_trunc('month', coalesce(p_today, current_date)::timestamp)::date;
  v_month_end date := ((date_trunc('month', coalesce(p_today, current_date)::timestamp) + interval '1 month')::date - 1);
  v_month_end_exclusive date := (date_trunc('month', coalesce(p_today, current_date)::timestamp) + interval '1 month')::date;
  v_last_month_start date := (date_trunc('month', coalesce(p_today, current_date)::timestamp) - interval '1 month')::date;
  v_last_month_end date := (date_trunc('month', coalesce(p_today, current_date)::timestamp)::date - 1);
  v_all_lodge_rooms integer := 0;
  v_current_occ integer := 0;
  v_unpaid_count integer := 0;
  v_unpaid_total numeric := 0;
  v_month_expenses numeric := 0;
  v_pos_revenue numeric := 0;
  v_conference_revenue numeric := 0;
  v_pool_revenue numeric := 0;
  v_today_rev numeric := 0;
  v_week_rev numeric := 0;
  v_month_rev numeric := 0;
  v_last_month_rev numeric := 0;
  v_month_refunds numeric := 0;
  v_last_month_refunds numeric := 0;
  v_month_retained_revenue numeric := 0;
  v_last_month_retained_revenue numeric := 0;
  v_month_retained_count integer := 0;
  v_last_month_retained_count integer := 0;
  v_month_occ integer := 0;
  v_last_month_occ integer := 0;
  v_month_room_nights numeric := 0;
  v_last_month_room_nights numeric := 0;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select count(*) into v_all_lodge_rooms
  from public.rooms
  where lodge_id = p_lodge_id;

  select count(*) into v_current_occ
  from public.bookings
  where lodge_id = p_lodge_id
    and status = 'checked_in';

  select
    count(*),
    coalesce(sum(greatest(0, coalesce(total_amount, 0) + coalesce(charges_total, 0) - coalesce(amount_paid, 0))), 0)
    into v_unpaid_count, v_unpaid_total
  from public.bookings
  where lodge_id = p_lodge_id
    and status <> 'cancelled'
    and coalesce(payment_status, 'unpaid') in ('unpaid', 'partial');

  select coalesce(sum(amount), 0) into v_today_rev
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_today::timestamptz
    and paid_at < (v_today + 1)::timestamptz;

  select coalesce(sum(amount), 0) into v_week_rev
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_week_start::timestamptz
    and paid_at < (v_today + 1)::timestamptz;

  select coalesce(sum(amount), 0) into v_month_rev
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz;

  select coalesce(sum(amount), 0) into v_last_month_rev
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_last_month_start::timestamptz
    and paid_at < v_month_start::timestamptz;

  select coalesce(sum(abs(amount)), 0) into v_month_refunds
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz
    and (amount < 0 or lower(coalesce(type, '')) = 'refund');

  select coalesce(sum(abs(amount)), 0) into v_last_month_refunds
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_last_month_start::timestamptz
    and paid_at < v_month_start::timestamptz
    and (amount < 0 or lower(coalesce(type, '')) = 'refund');

  with cancelled_bookings as (
    select id
    from public.bookings
    where lodge_id = p_lodge_id
      and coalesce(status, '') = 'cancelled'
  )
  select
    coalesce(sum(case
      when p.amount > 0 and lower(coalesce(p.type, '')) <> 'refund' and cb.id is not null then p.amount
      else 0
    end), 0),
    count(distinct case
      when p.amount > 0 and lower(coalesce(p.type, '')) <> 'refund' and cb.id is not null then p.booking_id
      else null
    end)
    into v_month_retained_revenue, v_month_retained_count
  from public.payments p
  left join cancelled_bookings cb on cb.id = p.booking_id
  where p.lodge_id = p_lodge_id
    and p.paid_at >= v_month_start::timestamptz
    and p.paid_at < v_month_end_exclusive::timestamptz;

  with cancelled_bookings as (
    select id
    from public.bookings
    where lodge_id = p_lodge_id
      and coalesce(status, '') = 'cancelled'
  )
  select
    coalesce(sum(case
      when p.amount > 0 and lower(coalesce(p.type, '')) <> 'refund' and cb.id is not null then p.amount
      else 0
    end), 0),
    count(distinct case
      when p.amount > 0 and lower(coalesce(p.type, '')) <> 'refund' and cb.id is not null then p.booking_id
      else null
    end)
    into v_last_month_retained_revenue, v_last_month_retained_count
  from public.payments p
  left join cancelled_bookings cb on cb.id = p.booking_id
  where p.lodge_id = p_lodge_id
    and p.paid_at >= v_last_month_start::timestamptz
    and p.paid_at < v_month_start::timestamptz;

  select coalesce(sum(amount), 0) into v_month_expenses
  from public.expenses
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select coalesce(sum(total), 0) into v_pos_revenue
  from public.pos_orders
  where lodge_id = p_lodge_id
    and status <> 'voided'
    and created_at >= v_month_start::timestamptz
    and created_at < v_month_end_exclusive::timestamptz;

  select coalesce(sum(total_amount), 0) into v_conference_revenue
  from public.conference_bookings
  where lodge_id = p_lodge_id
    and booking_date >= v_month_start
    and booking_date < v_month_end_exclusive
    and coalesce(payment_status, '') <> 'cancelled';

  select coalesce(sum(total), 0) into v_pool_revenue
  from public.pool_day_use
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select coalesce(sum(greatest(
      0,
      least(b.check_out, v_month_end_exclusive) - greatest(b.check_in, v_month_start)
    )), 0)
    into v_month_room_nights
  from public.bookings b
  where b.lodge_id = p_lodge_id
    and b.status <> 'cancelled'
    and b.check_in < v_month_end_exclusive
    and b.check_out > v_month_start;

  select coalesce(sum(greatest(
      0,
      least(b.check_out, v_month_start) - greatest(b.check_in, v_last_month_start)
    )), 0)
    into v_last_month_room_nights
  from public.bookings b
  where b.lodge_id = p_lodge_id
    and b.status <> 'cancelled'
    and b.check_in < v_month_start
    and b.check_out > v_last_month_start;

  v_month_occ := case
    when v_all_lodge_rooms > 0 and (v_month_end - v_month_start + 1) > 0
      then round((v_month_room_nights / (v_all_lodge_rooms::numeric * (v_month_end - v_month_start + 1)::numeric)) * 100)
    else 0
  end;

  v_last_month_occ := case
    when v_all_lodge_rooms > 0 and (v_last_month_end - v_last_month_start + 1) > 0
      then round((v_last_month_room_nights / (v_all_lodge_rooms::numeric * (v_last_month_end - v_last_month_start + 1)::numeric)) * 100)
    else 0
  end;

  return jsonb_build_object(
    'todayRev', coalesce(v_today_rev, 0),
    'weekRev', coalesce(v_week_rev, 0),
    'monthRev', coalesce(v_month_rev, 0),
    'lastMonthRev', coalesce(v_last_month_rev, 0),
    'monthRefunds', coalesce(v_month_refunds, 0),
    'lastMonthRefunds', coalesce(v_last_month_refunds, 0),
    'monthRetainedRevenue', coalesce(v_month_retained_revenue, 0),
    'lastMonthRetainedRevenue', coalesce(v_last_month_retained_revenue, 0),
    'monthRetainedCount', coalesce(v_month_retained_count, 0),
    'lastMonthRetainedCount', coalesce(v_last_month_retained_count, 0),
    'monthOcc', v_month_occ,
    'lastMonthOcc', v_last_month_occ,
    'currentOcc', v_current_occ,
    'totalRooms', v_all_lodge_rooms,
    'unpaidTotal', coalesce(v_unpaid_total, 0),
    'unpaidCount', v_unpaid_count,
    'monthExpenses', coalesce(v_month_expenses, 0),
    'posRevenue', coalesce(v_pos_revenue, 0),
    'conferenceRevenue', coalesce(v_conference_revenue, 0),
    'poolRevenue', coalesce(v_pool_revenue, 0)
  );
end;
$function$;

create or replace function public.get_night_audit_summary(
  p_lodge_id uuid,
  p_audit_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_audit_date date := coalesce(p_audit_date, current_date);
  v_day_start timestamptz := coalesce(p_audit_date, current_date)::timestamptz;
  v_day_end timestamptz := (coalesce(p_audit_date, current_date) + 1)::timestamptz;
  v_check_ins jsonb := '[]'::jsonb;
  v_check_outs jsonb := '[]'::jsonb;
  v_new_bookings jsonb := '[]'::jsonb;
  v_outstanding jsonb := '[]'::jsonb;
  v_pos_orders jsonb := '[]'::jsonb;
  v_pos_revenue numeric := 0;
  v_gross_collected numeric := 0;
  v_refunds_issued numeric := 0;
  v_expenses_total numeric := 0;
  v_outstanding_total numeric := 0;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.room_number asc nulls last), '[]'::jsonb)
    into v_check_ins
  from (
    select
      b.id,
      coalesce(c.name, b.guest_name, 'Guest') as customer_name,
      coalesce(b.guest_name, c.name, 'Guest') as guest_name,
      b.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.check_in = v_audit_date
      and b.status <> 'cancelled'
    order by b.room_number asc nulls last, b.created_at desc
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.room_number asc nulls last), '[]'::jsonb)
    into v_check_outs
  from (
    select
      b.id,
      coalesce(c.name, b.guest_name, 'Guest') as customer_name,
      coalesce(b.guest_name, c.name, 'Guest') as guest_name,
      b.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.check_out = v_audit_date
      and b.status <> 'cancelled'
    order by b.room_number asc nulls last, b.created_at desc
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
    into v_new_bookings
  from (
    select
      b.id,
      coalesce(c.name, b.guest_name, 'Guest') as customer_name,
      coalesce(b.guest_name, c.name, 'Guest') as guest_name,
      b.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status,
      b.created_at
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.created_at >= v_day_start
      and b.created_at < v_day_end
    order by b.created_at desc
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.check_in asc), '[]'::jsonb)
    into v_outstanding
  from (
    select
      b.id,
      coalesce(c.name, b.guest_name, 'Guest') as customer_name,
      coalesce(b.guest_name, c.name, 'Guest') as guest_name,
      b.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.status in ('confirmed', 'checked_in')
      and coalesce(b.payment_status, 'unpaid') <> 'paid'
    order by b.check_in asc, b.room_number asc nulls last
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb),
         coalesce(sum(t.total), 0)
    into v_pos_orders, v_pos_revenue
  from (
    select
      po.id,
      po.created_at,
      po.total,
      po.payment_method,
      po.booking_id,
      po.outlet_id
    from public.pos_orders po
    where po.lodge_id = p_lodge_id
      and po.status = 'completed'
      and po.created_at >= v_day_start
      and po.created_at < v_day_end
    order by po.created_at desc
  ) t;

  select coalesce(sum(amount), 0)
    into v_gross_collected
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_day_start
    and paid_at < v_day_end
    and amount > 0;

  select coalesce(sum(abs(amount)), 0)
    into v_refunds_issued
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_day_start
    and paid_at < v_day_end
    and (amount < 0 or lower(coalesce(type, '')) = 'refund');

  select coalesce(sum(amount), 0)
    into v_expenses_total
  from public.expenses
  where lodge_id = p_lodge_id
    and date = v_audit_date;

  select coalesce(sum(greatest(0, coalesce(total_amount, 0) + coalesce(charges_total, 0) - coalesce(amount_paid, 0))), 0)
    into v_outstanding_total
  from public.bookings
  where lodge_id = p_lodge_id
    and status in ('confirmed', 'checked_in')
    and coalesce(payment_status, 'unpaid') <> 'paid';

  return jsonb_build_object(
    'date', to_char(v_audit_date, 'YYYY-MM-DD'),
    'check_ins', v_check_ins,
    'check_outs', v_check_outs,
    'new_bookings', v_new_bookings,
    'outstanding', v_outstanding,
    'pos_orders', v_pos_orders,
    'pos_revenue', coalesce(v_pos_revenue, 0),
    'gross_collected', coalesce(v_gross_collected, 0),
    'refunds_issued', coalesce(v_refunds_issued, 0),
    'net_collected', coalesce(v_gross_collected, 0) - coalesce(v_refunds_issued, 0),
    'expenses_total', coalesce(v_expenses_total, 0),
    'outstanding_total', coalesce(v_outstanding_total, 0)
  );
end;
$function$;

revoke all on function public.run_financial_reconciliation_snapshot(uuid) from public, anon;
grant execute on function public.run_financial_reconciliation_snapshot(uuid) to authenticated, service_role;

revoke all on function public.get_financial_validation_alerts(uuid, int) from public, anon;
grant execute on function public.get_financial_validation_alerts(uuid, int) to authenticated, service_role;

revoke all on function public.get_manager_dashboard_snapshot(uuid, date) from public, anon;
grant execute on function public.get_manager_dashboard_snapshot(uuid, date) to authenticated, service_role;

revoke all on function public.get_reports_snapshot(uuid, date) from public, anon;
grant execute on function public.get_reports_snapshot(uuid, date) to authenticated, service_role;

revoke all on function public.get_night_audit_summary(uuid, date) from public, anon;
grant execute on function public.get_night_audit_summary(uuid, date) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
      from cron.job
     where jobname = 'boroko-nightly-reconciliation';

    perform cron.schedule(
      'boroko-nightly-reconciliation',
      '15 1 * * *',
      $cmd$select public.run_financial_reconciliation_snapshot(null);$cmd$
    );
  end if;
exception
  when others then
    null;
end;
$$;

revoke all on function public.update_booking_payment(uuid, uuid, numeric, text, text, text, uuid, timestamptz) from public, anon;
grant execute on function public.update_booking_payment(uuid, uuid, numeric, text, text, text, uuid, timestamptz) to authenticated, service_role;

revoke all on function public.update_booking_status(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.update_booking_status(uuid, uuid, text, timestamptz) to authenticated, service_role;

revoke all on function public.add_booking_charge(uuid, uuid, text, text, numeric, numeric, uuid, timestamptz) from public, anon;
grant execute on function public.add_booking_charge(uuid, uuid, text, text, numeric, numeric, uuid, timestamptz) to authenticated, service_role;

revoke all on function public.verify_refund_approver_pin(uuid, text) from public, anon;
grant execute on function public.verify_refund_approver_pin(uuid, text) to authenticated, service_role;

revoke all on function public.delete_booking_charge(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.delete_booking_charge(uuid, uuid, text, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
