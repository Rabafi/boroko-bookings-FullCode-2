-- ============================================================
-- Online Booking Feature
-- Adds public-facing booking site support (Pro tier only)
-- All changes are additive and non-destructive
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Schema additions (all IF NOT EXISTS — safe to re-run)
-- ------------------------------------------------------------

-- Lodge URL slug (e.g. "sunny-lodge" → book.boroko.app/sunny-lodge)
alter table public.settings
  add column if not exists slug text;

create unique index if not exists settings_slug_unique
  on public.settings (lower(btrim(slug)))
  where slug is not null and btrim(slug) <> '';

-- Booking source: 'desktop' (default) | 'online'
alter table public.bookings
  add column if not exists source text not null default 'desktop';

-- Room photo (base64, same pattern as logo in settings)
alter table public.rooms
  add column if not exists photo text;

-- ------------------------------------------------------------
-- 2. Feature flag: add online_booking to plan definitions
-- ------------------------------------------------------------

-- Update _license_plan_features to include online_booking
-- online_booking is Pro-only (false for Starter/Standard, true for Pro)
create or replace function public._license_plan_features(
  p_plan text,
  p_trial boolean default false,
  p_expired boolean default false
) returns jsonb
language plpgsql
immutable
as $function$
declare
  v_plan text := lower(coalesce(btrim(p_plan), 'starter'));
begin
  if p_expired then
    return jsonb_build_object(
      'reports', false, 'expenses', false, 'staff', false, 'pwa', false,
      'audit', false, 'conference', false, 'pool', false, 'import', false,
      'pos', false, 'inventory', false, 'supplies', false,
      'online_booking', false
    );
  end if;
  if p_trial then
    return jsonb_build_object(
      'reports', true, 'expenses', true, 'staff', true, 'pwa', true,
      'audit', true, 'conference', true, 'pool', true, 'import', true,
      'pos', true, 'inventory', true, 'supplies', true,
      'online_booking', true
    );
  end if;
  if v_plan in ('pro', 'premium') then
    return jsonb_build_object(
      'reports', true, 'expenses', true, 'staff', true, 'pwa', true,
      'audit', true, 'conference', true, 'pool', true, 'import', true,
      'pos', true, 'inventory', true, 'supplies', true,
      'online_booking', true
    );
  end if;
  if v_plan = 'standard' then
    return jsonb_build_object(
      'reports', true, 'expenses', true, 'staff', true, 'pwa', false,
      'audit', true, 'conference', true, 'pool', true, 'import', true,
      'pos', false, 'inventory', false, 'supplies', false,
      'online_booking', false
    );
  end if;
  -- Starter
  return jsonb_build_object(
    'reports', false, 'expenses', false, 'staff', false, 'pwa', false,
    'audit', false, 'conference', false, 'pool', false, 'import', false,
    'pos', false, 'inventory', false, 'supplies', false,
    'online_booking', false
  );
end;
$function$;

-- Update subscription_plan_versions rows to include online_booking
update public.subscription_plan_versions
set feature_flags = feature_flags || jsonb_build_object(
  'online_booking',
  case plan_name when 'Pro' then true else false end
)
where plan_name in ('Starter', 'Standard', 'Pro')
  and not (feature_flags ? 'online_booking');

-- Insert new plan version rows that include online_booking from the start
insert into public.subscription_plan_versions (plan_name, version_code, headline, modules, feature_flags, pricing_meta)
values
  ('Starter', '2026.05', 'Run a small lodge day to day',
    '["Dashboard","Bookings","Quotations","Invoices","Room Grid","Calendar","Guests","Rooms","Housekeeping","Maintenance","Settings"]'::jsonb,
    '{"reports":false,"expenses":false,"staff":false,"pwa":false,"audit":false,"conference":false,"pool":false,"import":false,"pos":false,"inventory":false,"supplies":false,"online_booking":false}'::jsonb,
    '{"price_label":"Entry","badge":"Core Operations"}'::jsonb),
  ('Standard', '2026.05', 'See the business, not just the bookings',
    '["Everything in Starter","Reports & Analytics","Expenses Tracking","Staff Management","Night Audit","Data Management","Conference Bookings","Pool / Day Use"]'::jsonb,
    '{"reports":true,"expenses":true,"staff":true,"pwa":false,"audit":true,"conference":true,"pool":true,"import":true,"pos":false,"inventory":false,"supplies":false,"online_booking":false}'::jsonb,
    '{"price_label":"Mid-tier","badge":"Business Control"}'::jsonb),
  ('Pro', '2026.05', 'Monetize more operations from one system',
    '["Everything in Standard","Manager PWA","Point of Sale (POS)","Inventory Management","Room Supplies Tracker","Online Booking Site"]'::jsonb,
    '{"reports":true,"expenses":true,"staff":true,"pwa":true,"audit":true,"conference":true,"pool":true,"import":true,"pos":true,"inventory":true,"supplies":true,"online_booking":true}'::jsonb,
    '{"price_label":"Full Suite","badge":"Revenue Expansion"}'::jsonb)
on conflict (plan_name, version_code) do nothing;

-- ------------------------------------------------------------
-- 3. Public RPC: get_lodge_public_profile
-- Returns ONLY safe public data — no financials, no staff info
-- Callable by anon (SECURITY DEFINER)
-- ------------------------------------------------------------

create or replace function public.get_lodge_public_profile(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_settings public.settings%rowtype;
  v_features jsonb;
  v_enabled boolean;
begin
  if v_slug = '' then
    return jsonb_build_object('found', false, 'error', 'Slug is required');
  end if;

  select *
  into v_settings
  from public.settings s
  where lower(btrim(coalesce(s.slug, ''))) = v_slug
    and coalesce(s.deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('found', false, 'error', 'Lodge not found');
  end if;

  -- Check online_booking feature is enabled for this lodge
  v_features := public.get_lodge_entitlement(v_settings.lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('found', false, 'error', 'Online booking not available for this property');
  end if;

  return jsonb_build_object(
    'found', true,
    'lodge_id', v_settings.lodge_id,
    'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name),
    'logo', v_settings.logo,
    'currency', coalesce(v_settings.currency, 'P'),
    'city', v_settings.city,
    'country', v_settings.country,
    'phone', v_settings.phone,
    'email', v_settings.email,
    'website', v_settings.website
  );
end;
$function$;

-- ------------------------------------------------------------
-- 4. Public RPC: get_available_rooms
-- Returns rooms with no overlapping non-cancelled bookings
-- Callable by anon (SECURITY DEFINER)
-- ------------------------------------------------------------

create or replace function public.get_available_rooms(
  p_slug text,
  p_check_in date,
  p_check_out date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_features jsonb;
  v_enabled boolean;
  v_rooms jsonb;
begin
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Slug is required');
  end if;

  if p_check_in is null or p_check_out is null then
    return jsonb_build_object('success', false, 'error', 'Check-in and check-out dates are required');
  end if;

  if p_check_out <= p_check_in then
    return jsonb_build_object('success', false, 'error', 'Check-out must be after check-in');
  end if;

  -- Resolve lodge
  select lodge_id
  into v_lodge_id
  from public.settings
  where lower(btrim(coalesce(slug, ''))) = v_slug
    and coalesce(deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  -- Check feature enabled
  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking not available');
  end if;

  -- Fetch available rooms (exclude rooms with overlapping non-cancelled bookings)
  select coalesce(jsonb_agg(row_to_json(r.*) order by r.room_number), '[]'::jsonb)
  into v_rooms
  from (
    select
      r.id,
      r.room_number,
      r.room_type,
      r.rate_per_night,
      r.max_occupancy,
      r.description,
      r.photo,
      (p_check_out - p_check_in) as nights,
      r.rate_per_night * (p_check_out - p_check_in) as total_price
    from public.rooms r
    where r.lodge_id = v_lodge_id
      and r.status not in ('maintenance')
      and not exists (
        select 1
        from public.bookings b
        where b.lodge_id = v_lodge_id
          and b.room_id = r.id
          and b.status not in ('cancelled', 'checked_out')
          and not (b.check_out <= p_check_in or b.check_in >= p_check_out)
      )
  ) r;

  return jsonb_build_object(
    'success', true,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'nights', (p_check_out - p_check_in),
    'rooms', v_rooms
  );
end;
$function$;

-- ------------------------------------------------------------
-- 5. Public RPC: create_online_booking
-- Validates slug, feature flag, availability, then creates
-- a pending booking. Source is set to 'online'.
-- Callable by anon (SECURITY DEFINER)
-- ------------------------------------------------------------

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
  v_slug         text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id     uuid;
  v_lodge_name   text;
  v_currency     text;
  v_room_id      uuid;
  v_check_in     date;
  v_check_out    date;
  v_first_name   text;
  v_last_name    text;
  v_email        text;
  v_phone        text;
  v_adults       int;
  v_children     int;
  v_notes        text;
  v_features     jsonb;
  v_enabled      boolean;
  v_customer_id  uuid;
  v_room         public.rooms%rowtype;
  v_nights       int;
  v_total        numeric;
  v_idem_key     text;
  v_booking_result jsonb;
  v_booking_id   uuid;
  v_reference    text;
  v_conflict     uuid;
begin
  -- Validate slug
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Invalid lodge');
  end if;

  -- Resolve lodge
  select s.lodge_id, coalesce(s.lodge_name, s.company_name), coalesce(s.currency, 'P')
  into v_lodge_id, v_lodge_name, v_currency
  from public.settings s
  where lower(btrim(coalesce(s.slug, ''))) = v_slug
    and coalesce(s.deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  -- Check online_booking feature
  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking is not available for this property');
  end if;

  -- Extract and validate payload fields
  v_room_id    := nullif(payload->>'room_id', '')::uuid;
  v_check_in   := nullif(payload->>'check_in', '')::date;
  v_check_out  := nullif(payload->>'check_out', '')::date;
  v_first_name := btrim(coalesce(payload->>'guest_first_name', ''));
  v_last_name  := btrim(coalesce(payload->>'guest_last_name', ''));
  v_email      := lower(btrim(coalesce(payload->>'guest_email', '')));
  v_phone      := btrim(coalesce(payload->>'guest_phone', ''));
  v_adults     := coalesce((payload->>'adults')::int, 1);
  v_children   := coalesce((payload->>'children')::int, 0);
  v_notes      := btrim(coalesce(payload->>'notes', ''));

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

  -- Lock and fetch room (prevents race conditions)
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

  if (v_adults + v_children) > v_room.max_occupancy then
    return jsonb_build_object('success', false, 'error', format('This room supports up to %s guests. You have %s guests selected.', v_room.max_occupancy, v_adults + v_children));
  end if;

  -- Check availability with same logic as create_booking_record
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

  -- Calculate total
  v_nights := v_check_out - v_check_in;
  v_total  := v_room.rate_per_night * v_nights;

  -- Idempotency key: email + room + check_in + check_out (prevents duplicate submissions)
  v_idem_key := coalesce(
    nullif(btrim(payload->>'idempotency_key'), ''),
    encode(
      extensions.digest(v_email || '::' || v_room_id::text || '::' || v_check_in::text || '::' || v_check_out::text, 'sha256'),
      'hex'
    )
  );

  -- Idempotency check — return existing booking if already submitted
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

  -- Upsert customer by email within this lodge
  select id
  into v_customer_id
  from public.customers
  where lodge_id = v_lodge_id
    and lower(btrim(coalesce(email, ''))) = v_email
  limit 1;

  if not found then
    insert into public.customers (id, lodge_id, first_name, last_name, email, phone, created_at, updated_at)
    values (gen_random_uuid(), v_lodge_id, v_first_name, v_last_name, v_email, nullif(v_phone, ''), now(), now())
    returning id into v_customer_id;
  end if;

  -- Create the booking (pending, source=online)
  v_booking_id := gen_random_uuid();
  v_reference  := 'ONL-' || upper(substring(v_booking_id::text, 1, 8));

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

  return jsonb_build_object(
    'success', true,
    'reference', v_reference,
    'booking_id', v_booking_id,
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

-- ------------------------------------------------------------
-- 6. Grants — allow anon to call the 3 public RPCs only
-- SECURITY DEFINER ensures they cannot access tables directly
-- ------------------------------------------------------------

grant execute on function public.get_lodge_public_profile(text) to anon, authenticated;
grant execute on function public.get_available_rooms(text, date, date) to anon, authenticated;
grant execute on function public.create_online_booking(text, jsonb) to anon, authenticated;

-- Revoke direct table access from anon for tables touched by online booking
-- (settings, rooms, bookings, customers are already restricted by existing migrations)
-- No additional grants needed — SECURITY DEFINER handles access

commit;
