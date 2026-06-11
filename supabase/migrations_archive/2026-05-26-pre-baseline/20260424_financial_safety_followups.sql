begin;

alter table public.booking_charges
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid,
  add column if not exists void_reason text;

create index if not exists booking_charges_active_booking_idx
on public.booking_charges (booking_id, created_at)
where voided_at is null;

create table if not exists public.online_booking_rate_limits (
  bucket_key text primary key,
  lodge_id uuid not null,
  bucket_type text not null,
  window_started_at timestamptz not null default now(),
  hit_count integer not null default 0,
  last_request_at timestamptz not null default now(),
  blocked_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists online_booking_rate_limits_lodge_idx
on public.online_booking_rate_limits (lodge_id, bucket_type);

revoke all on table public.online_booking_rate_limits from public, anon, authenticated;

create or replace function public.app_request_ip()
returns text
language sql
stable
as $function$
  select nullif(
    btrim(
      coalesce(
        nullif(split_part(coalesce(public.app_request_headers()->>'cf-connecting-ip', ''), ',', 1), ''),
        nullif(split_part(coalesce(public.app_request_headers()->>'x-forwarded-for', ''), ',', 1), ''),
        nullif(split_part(coalesce(public.app_request_headers()->>'x-real-ip', ''), ',', 1), ''),
        nullif(split_part(coalesce(public.app_request_headers()->>'x-client-ip', ''), ',', 1), ''),
        ''
      )
    ),
    ''
  );
$function$;

create or replace function public.consume_online_booking_limit(
  p_lodge_id uuid,
  p_bucket_type text,
  p_bucket_value text,
  p_max_hits integer,
  p_window interval,
  p_block_for interval
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_bucket_value text := nullif(btrim(coalesce(p_bucket_value, '')), '');
  v_bucket_key text;
  v_hit_count integer;
  v_blocked_until timestamptz;
begin
  if p_lodge_id is null or v_bucket_value is null or coalesce(p_max_hits, 0) <= 0 then
    return true;
  end if;

  v_bucket_key := md5(
    lower(coalesce(p_bucket_type, 'unknown')) || '::' ||
    lower(p_lodge_id::text) || '::' ||
    lower(v_bucket_value)
  );

  insert into public.online_booking_rate_limits (
    bucket_key,
    lodge_id,
    bucket_type,
    window_started_at,
    hit_count,
    last_request_at,
    blocked_until
  ) values (
    v_bucket_key,
    p_lodge_id,
    lower(coalesce(p_bucket_type, 'unknown')),
    v_now,
    1,
    v_now,
    null
  )
  on conflict (bucket_key)
  do update set
    hit_count = case
      when public.online_booking_rate_limits.blocked_until is not null
        and public.online_booking_rate_limits.blocked_until > v_now
        then public.online_booking_rate_limits.hit_count
      when public.online_booking_rate_limits.window_started_at <= (v_now - p_window)
        then 1
      else public.online_booking_rate_limits.hit_count + 1
    end,
    window_started_at = case
      when public.online_booking_rate_limits.blocked_until is not null
        and public.online_booking_rate_limits.blocked_until > v_now
        then public.online_booking_rate_limits.window_started_at
      when public.online_booking_rate_limits.window_started_at <= (v_now - p_window)
        then v_now
      else public.online_booking_rate_limits.window_started_at
    end,
    last_request_at = v_now,
    blocked_until = case
      when public.online_booking_rate_limits.blocked_until is not null
        and public.online_booking_rate_limits.blocked_until > v_now
        then public.online_booking_rate_limits.blocked_until
      when public.online_booking_rate_limits.window_started_at <= (v_now - p_window)
        then null
      when public.online_booking_rate_limits.hit_count + 1 > p_max_hits
        then v_now + p_block_for
      else null
    end
  returning hit_count, blocked_until
    into v_hit_count, v_blocked_until;

  if v_blocked_until is not null and v_blocked_until > v_now then
    return false;
  end if;

  return coalesce(v_hit_count, 0) <= p_max_hits;
end;
$function$;

create or replace function public.check_online_booking_rate_limit(
  p_lodge_id uuid,
  p_email text,
  p_phone text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ip text := public.app_request_ip();
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
begin
  if not public.consume_online_booking_limit(p_lodge_id, 'ip_15m', v_ip, 8, interval '15 minutes', interval '30 minutes') then
    return 'Too many booking attempts were sent from this connection. Please wait 30 minutes and try again.';
  end if;

  if not public.consume_online_booking_limit(p_lodge_id, 'ip_24h', v_ip, 24, interval '24 hours', interval '6 hours') then
    return 'Booking attempts from this connection have been temporarily paused. Please contact the lodge if you need immediate help.';
  end if;

  if not public.consume_online_booking_limit(p_lodge_id, 'email_30m', v_email, 4, interval '30 minutes', interval '30 minutes') then
    return 'Too many booking attempts were sent for this email address. Please wait 30 minutes before trying again.';
  end if;

  if not public.consume_online_booking_limit(p_lodge_id, 'phone_30m', v_phone, 4, interval '30 minutes', interval '30 minutes') then
    return 'Too many booking attempts were sent for this phone number. Please wait 30 minutes before trying again.';
  end if;

  return null;
end;
$function$;

create or replace function public.sync_booking_charges_total()
returns trigger
language plpgsql
as $function$
declare
  v_booking_id uuid := coalesce(new.booking_id, old.booking_id);
  v_new_charges numeric;
begin
  select greatest(0, coalesce(sum(amount), 0))
    into v_new_charges
    from public.booking_charges
   where booking_id = v_booking_id
     and voided_at is null;

  update public.bookings
     set charges_total = v_new_charges,
         payment_status = public.compute_payment_status(
           coalesce(amount_paid, 0),
           coalesce(total_amount, 0),
           v_new_charges
         ),
         updated_at = now()
   where id = v_booking_id;

  return coalesce(new, old);
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
declare
  v_actor_raw text;
  v_actor uuid;
  v_charge public.booking_charges%rowtype;
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

  v_actor_raw := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor := case when v_actor_raw ~ '^[0-9a-f\-]{36}$' then v_actor_raw::uuid else null end;

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
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return public.delete_booking_charge(p_charge_id, p_lodge_id, null);
end;
$function$;

revoke all on function public.delete_booking_charge(uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_booking_charge(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_booking_charge(uuid, uuid) to authenticated, service_role;
grant execute on function public.delete_booking_charge(uuid, uuid, text) to authenticated, service_role;

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

  v_rate_limit_error := public.check_online_booking_rate_limit(v_lodge_id, v_email, v_phone);
  if v_rate_limit_error is not null then
    return jsonb_build_object('success', false, 'error', v_rate_limit_error);
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

notify pgrst, 'reload schema';

commit;
