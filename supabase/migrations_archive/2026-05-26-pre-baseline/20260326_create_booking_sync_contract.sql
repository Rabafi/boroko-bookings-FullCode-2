-- Sync-hardening for offline booking replay.
-- Keeps the client-generated booking UUID stable across offline -> online sync
-- and makes create_booking idempotent so crash/retry replay does not duplicate
-- bookings or invoices.

alter table public.bookings
add column if not exists create_idempotency_key text;

create unique index if not exists bookings_create_idempotency_key_uidx
on public.bookings (create_idempotency_key)
where create_idempotency_key is not null;

create or replace function public.create_booking(
  p_lodge_id        uuid,
  p_customer_id     uuid,
  p_room_id         uuid,
  p_check_in        date,
  p_check_out       date,
  p_adults          int,
  p_children        int,
  p_total_amount    numeric,
  p_invoice_number  text    default null,
  p_notes           text    default '',
  p_created_by      uuid    default null,
  p_deposit_amount  numeric default 0,
  p_booking_id      uuid    default null,
  p_idempotency_key text    default null
) returns jsonb as $$
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
$$ language plpgsql;
