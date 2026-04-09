begin;

create or replace function public.get_next_invoice_number(p_lodge_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_year int := extract(year from now())::int;
  v_next int;
  v_invoice_number text;
begin
  loop
    insert into public.invoice_sequences (lodge_id, year, last_number)
    values (p_lodge_id, v_year, 1)
    on conflict (lodge_id, year)
    do update
      set last_number = public.invoice_sequences.last_number + 1
    returning last_number into v_next;

    v_invoice_number := 'INV-' || v_year || '-' || lpad(v_next::text, 4, '0');

    exit when not exists (
      select 1
        from public.invoices i
       where i.lodge_id = p_lodge_id
         and i.invoice_number = v_invoice_number
      union all
      select 1
        from public.bookings b
       where b.lodge_id = p_lodge_id
         and b.invoice_number = v_invoice_number
    );
  end loop;

  return v_invoice_number;
end;
$function$;

create or replace function public.get_booking_payments(
  p_booking_id uuid,
  p_lodge_id uuid
) returns table (
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
  refund_retained_amount numeric
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if not exists (
    select 1
      from public.bookings b
     where b.id = p_booking_id
       and b.lodge_id = p_lodge_id
  ) then
    return;
  end if;

  return query
  select
    p.id,
    p.booking_id,
    p.lodge_id,
    p.amount,
    p.method,
    p.type,
    p.paid_at,
    p.recorded_by,
    coalesce(p.notes, '') as notes,
    p.created_at,
    null::numeric as refund_base_amount,
    null::numeric as refund_retained_percent,
    null::numeric as refund_retained_amount
  from public.payments p
  where p.booking_id = p_booking_id
    and p.lodge_id = p_lodge_id
  order by p.paid_at desc, p.created_at desc;
end;
$function$;

create or replace function public.add_booking_charge(
  p_booking_id  uuid,
  p_lodge_id    uuid,
  p_description text,
  p_category    text    default 'other',
  p_quantity    numeric default 1,
  p_unit_price  numeric default 0,
  p_outlet_id   uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_charge_id uuid;
  v_amount numeric;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if coalesce(p_unit_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Charge unit price must be greater than zero');
  end if;

  if not exists (
    select 1
      from public.bookings
     where id = p_booking_id
       and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
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
$function$;

create or replace function public.delete_booking_charge(
  p_charge_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  delete from public.booking_charges
   where id = p_charge_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Charge not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

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

  if v_room_id is null then
    return jsonb_build_object('success', false, 'error', 'Room is required');
  end if;
  if v_check_in is null or v_check_out is null then
    return jsonb_build_object('success', false, 'error', 'Check-in and check-out dates are required');
  end if;
  if v_check_out <= v_check_in then
    return jsonb_build_object('success', false, 'error', 'Check-out must be after check-in');
  end if;
  if v_check_in < current_date then
    return jsonb_build_object('success', false, 'error', 'Check-in date cannot be in the past');
  end if;
  if v_first_name = '' or v_last_name = '' then
    return jsonb_build_object('success', false, 'error', 'Guest name is required');
  end if;
  if v_email = '' or v_email not like '%@%' then
    return jsonb_build_object('success', false, 'error', 'A valid email address is required');
  end if;
  if v_adults < 1 then
    v_adults := 1;
  end if;

  select *
    into v_room
  from public.rooms r
  where r.id = v_room_id
    and r.lodge_id = v_lodge_id
    and r.status not in ('maintenance')
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found or unavailable');
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
    id,
    lodge_id,
    customer_id,
    room_id,
    check_in,
    check_out,
    adults,
    children,
    total_amount,
    amount_paid,
    payment_status,
    status,
    source,
    invoice_number,
    notes,
    deposit_amount,
    is_exclusive_event,
    event_daily_rate,
    created_at,
    updated_at,
    create_idempotency_key
  ) values (
    v_booking_id,
    v_lodge_id,
    v_customer_id,
    v_room_id,
    v_check_in,
    v_check_out,
    v_adults,
    v_children,
    v_total,
    0,
    'unpaid',
    'pending',
    'online',
    v_invoice_number,
    case
      when v_notes = '' then 'Online booking request'
      else 'Online booking request: ' || v_notes
    end,
    0,
    false,
    0,
    now(),
    now(),
    v_idem_key
  );

  insert into public.invoices (
    booking_id,
    lodge_id,
    invoice_number,
    issued_at,
    due_date
  ) values (
    v_booking_id,
    v_lodge_id,
    v_invoice_number,
    now(),
    v_check_in
  )
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

do $$
declare
  v_booking record;
  v_invoice_number text;
begin
  for v_booking in
    with duplicate_booking_numbers as (
      select lodge_id, invoice_number
        from public.bookings
       where coalesce(invoice_number, '') <> ''
       group by lodge_id, invoice_number
      having count(*) > 1
    )
    select distinct
      b.id,
      b.lodge_id
      from public.bookings b
      left join duplicate_booking_numbers dbn
        on dbn.lodge_id = b.lodge_id
       and dbn.invoice_number = b.invoice_number
      left join public.invoices existing_invoice
        on existing_invoice.lodge_id = b.lodge_id
       and existing_invoice.invoice_number = b.invoice_number
       and existing_invoice.booking_id is distinct from b.id
     where coalesce(b.invoice_number, '') = ''
        or dbn.invoice_number is not null
        or existing_invoice.id is not null
     order by coalesce(b.created_at, now()), b.id
  loop
    v_invoice_number := public.get_next_invoice_number(v_booking.lodge_id);

    update public.bookings
       set invoice_number = v_invoice_number
     where id = v_booking.id;
  end loop;
end;
$$;

insert into public.invoices (
  booking_id,
  lodge_id,
  invoice_number,
  issued_at,
  due_date,
  created_at
)
select
  b.id,
  b.lodge_id,
  b.invoice_number,
  coalesce(i.issued_at, b.created_at, now()),
  b.check_in,
  coalesce(b.created_at, now())
from public.bookings b
left join public.invoices i
  on i.booking_id = b.id
where coalesce(b.invoice_number, '') <> ''
  and i.id is null;

notify pgrst, 'reload schema';

commit;
