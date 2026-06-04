begin;

-- Defense-in-depth for subscription management RPCs that may already exist in
-- deployed databases. These RPCs are Command Central/server-only operations.
revoke execute on function public.issue_subscription_contract(jsonb) from anon, authenticated;
revoke execute on function public.update_subscription_contract(uuid, jsonb) from anon, authenticated;
grant execute on function public.issue_subscription_contract(jsonb) to service_role;
grant execute on function public.update_subscription_contract(uuid, jsonb) to service_role;

alter table public.bookings
  add column if not exists online_confirmation_token text;

create unique index if not exists bookings_online_confirmation_token_uidx
  on public.bookings (online_confirmation_token)
  where online_confirmation_token is not null;

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
  v_confirmation_token text;
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

  perform public.app_check_room_maintenance(v_lodge_id, v_room_id);

  select *
    into v_room
  from public.rooms r
  where r.id::text = v_room_id::text
    and r.lodge_id::text = v_lodge_id::text
    and r.status not in ('maintenance')
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found or currently unavailable');
  end if;

  select b.id
    into v_conflict
  from public.bookings b
  where b.lodge_id::text = v_lodge_id::text
    and b.room_id::text = v_room_id::text
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

  select b.id, b.online_confirmation_token
    into v_booking_id, v_confirmation_token
  from public.bookings b
  where b.lodge_id::text = v_lodge_id::text
    and b.create_idempotency_key = v_idem_key
  limit 1;

  if found then
    v_reference := 'ONL-' || upper(substring(v_booking_id::text, 1, 8));
    return jsonb_build_object(
      'success', true,
      'reference', v_reference,
      'booking_id', v_booking_id,
      'confirmation_token', v_confirmation_token,
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
  where lodge_id::text = v_lodge_id::text
    and lower(btrim(coalesce(email, ''))) = v_email
  limit 1;

  if not found then
    insert into public.customers (id, lodge_id, name, email, phone)
    values (gen_random_uuid(), v_lodge_id, v_first_name || ' ' || v_last_name, v_email, nullif(v_phone, ''))
    returning id into v_customer_id;
  end if;

  v_booking_id := gen_random_uuid();
  v_reference := 'ONL-' || upper(substring(v_booking_id::text, 1, 8));
  v_confirmation_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_invoice_number := public.get_next_invoice_number(v_lodge_id);

  insert into public.bookings (
    id, lodge_id, customer_id, room_id,
    check_in, check_out, adults, children,
    total_amount, amount_paid, payment_status, status,
    source, invoice_number, notes, deposit_amount,
    is_exclusive_event, event_daily_rate,
    created_at, updated_at, create_idempotency_key, online_confirmation_token
  ) values (
    v_booking_id, v_lodge_id, v_customer_id, v_room_id,
    v_check_in, v_check_out, v_adults, v_children,
    v_total, 0, 'unpaid', 'pending',
    'online', v_invoice_number,
    case when v_notes = '' then 'Online booking request' else 'Online booking request: ' || v_notes end,
    0, false, 0, now(), now(), v_idem_key, v_confirmation_token
  );

  insert into invoices (booking_id, lodge_id, invoice_number, issued_at, due_date)
  values (v_booking_id, v_lodge_id, v_invoice_number, now(), v_check_in)
  on conflict do nothing;

  return jsonb_build_object(
    'success', true,
    'reference', v_reference,
    'booking_id', v_booking_id,
    'confirmation_token', v_confirmation_token,
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

grant execute on function public.create_online_booking(text, jsonb) to anon, authenticated;

commit;
