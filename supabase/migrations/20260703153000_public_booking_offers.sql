-- Public booking offers for the hosted booking site.
-- Lodges can choose which public products appear on their slug. Accommodation
-- bookings can be single-room, multi-room, or full-lodge requests.

alter table public.settings
  add column if not exists public_offer_rooms boolean not null default true,
  add column if not exists public_offer_multi_room boolean not null default true,
  add column if not exists public_offer_full_lodge boolean not null default false,
  add column if not exists public_offer_day_use boolean not null default false,
  add column if not exists public_offer_events boolean not null default false;

create or replace function public.get_public_booking_offers(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_settings public.settings%rowtype;
  v_features jsonb;
  v_enabled boolean;
  v_day_use public.day_use_config%rowtype;
  v_event_resources jsonb := '[]'::jsonb;
begin
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Slug is required');
  end if;

  select *
    into v_settings
  from public.settings s
  where lower(btrim(coalesce(s.slug, ''))) = v_slug
    and coalesce(s.deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_settings.lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);
  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking is not available for this property');
  end if;

  select *
    into v_day_use
  from public.day_use_config duc
  where duc.lodge_id = v_settings.lodge_id
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', resource_key,
    'name', resource_name_snapshot,
    'type', resource_type_snapshot
  ) order by resource_name_snapshot), '[]'::jsonb)
    into v_event_resources
  from (
    select distinct on (lower(resource_key))
      resource_key,
      coalesce(nullif(resource_name_snapshot, ''), resource_key) as resource_name_snapshot,
      coalesce(nullif(resource_type_snapshot, ''), 'venue') as resource_type_snapshot
    from public.event_booking_resources
    where lodge_id = v_settings.lodge_id
      and nullif(btrim(coalesce(resource_key, '')), '') is not null
    order by lower(resource_key), created_at desc
  ) resources;

  return jsonb_build_object(
    'success', true,
    'offers', jsonb_build_object(
      'rooms', coalesce(v_settings.public_offer_rooms, true),
      'multi_room', coalesce(v_settings.public_offer_multi_room, true),
      'full_lodge', coalesce(v_settings.public_offer_full_lodge, false),
      'day_use', coalesce(v_settings.public_offer_day_use, false)
        and coalesce(jsonb_array_length(coalesce(v_day_use.templates, '[]'::jsonb)), 0) > 0,
      'events', coalesce(v_settings.public_offer_events, false)
    ),
    'day_use', jsonb_build_object(
      'templates', coalesce(v_day_use.templates, '[]'::jsonb),
      'resources', coalesce(v_day_use.resources, '[]'::jsonb)
    ),
    'events', jsonb_build_object(
      'resources', v_event_resources
    )
  );
end;
$$;

create or replace function public.create_online_booking(p_slug text, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_lodge_name text;
  v_currency text;
  v_offer_rooms boolean;
  v_offer_multi_room boolean;
  v_offer_full_lodge boolean;
  v_check_in date;
  v_check_out date;
  v_first_name text;
  v_last_name text;
  v_email text;
  v_phone text;
  v_notes text;
  v_features jsonb;
  v_enabled boolean;
  v_customer_id uuid;
  v_nights int;
  v_rate_limit_error text;
  v_booking_type text;
  v_room_lines jsonb;
  v_room_line jsonb;
  v_room public.rooms%rowtype;
  v_room_id uuid;
  v_adults int;
  v_children int;
  v_total_guests int;
  v_total numeric := 0;
  v_booking_total numeric;
  v_booking_id uuid;
  v_booking_ids uuid[] := array[]::uuid[];
  v_confirmation_token text;
  v_reference text;
  v_group_key text;
  v_group_result jsonb;
  v_invoice_number text;
  v_idem_key text;
  v_conflict uuid;
  v_first_room_number text;
  v_first_room_type text;
  v_full_lodge_room_count int := 0;
  v_full_lodge_total numeric := 0;
begin
  if v_slug = '' then return jsonb_build_object('success', false, 'error', 'Invalid lodge'); end if;

  select
    s.lodge_id,
    coalesce(s.lodge_name, s.company_name),
    coalesce(s.currency, 'P'),
    coalesce(s.public_offer_rooms, true),
    coalesce(s.public_offer_multi_room, true),
    coalesce(s.public_offer_full_lodge, false)
    into v_lodge_id, v_lodge_name, v_currency, v_offer_rooms, v_offer_multi_room, v_offer_full_lodge
  from public.settings s
  where lower(btrim(coalesce(s.slug, ''))) = v_slug
    and coalesce(s.deleted, false) = false
  limit 1;

  if not found then return jsonb_build_object('success', false, 'error', 'Lodge not found'); end if;

  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);
  if not v_enabled then return jsonb_build_object('success', false, 'error', 'Online booking is not available for this property'); end if;

  v_booking_type := lower(coalesce(nullif(payload->>'booking_type', ''), 'room'));
  v_check_in := nullif(payload->>'check_in', '')::date;
  v_check_out := nullif(payload->>'check_out', '')::date;
  v_first_name := btrim(coalesce(payload->>'guest_first_name', ''));
  v_last_name := btrim(coalesce(payload->>'guest_last_name', ''));
  v_email := lower(btrim(coalesce(payload->>'guest_email', '')));
  v_phone := btrim(coalesce(payload->>'guest_phone', ''));
  v_notes := btrim(coalesce(payload->>'notes', ''));

  if v_booking_type not in ('room', 'multi_room', 'full_lodge') then
    return jsonb_build_object('success', false, 'error', 'Unsupported online booking type');
  end if;
  if v_booking_type = 'room' and not v_offer_rooms then
    return jsonb_build_object('success', false, 'error', 'Online room booking is not available for this property');
  end if;
  if v_booking_type = 'multi_room' and not v_offer_multi_room then
    return jsonb_build_object('success', false, 'error', 'Online multi-room booking is not available for this property');
  end if;
  if v_booking_type = 'full_lodge' and not v_offer_full_lodge then
    return jsonb_build_object('success', false, 'error', 'Online full-lodge booking is not available for this property');
  end if;
  if v_check_in is null or v_check_out is null then return jsonb_build_object('success', false, 'error', 'Check-in and check-out dates are required'); end if;
  if v_check_out <= v_check_in then return jsonb_build_object('success', false, 'error', 'Check-out must be after check-in'); end if;
  if v_check_in < current_date then return jsonb_build_object('success', false, 'error', 'Check-in date cannot be in the past'); end if;
  if v_first_name = '' or v_last_name = '' then return jsonb_build_object('success', false, 'error', 'Guest name is required'); end if;
  if v_email = '' or v_email !~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$' then
    return jsonb_build_object('success', false, 'error', 'A valid email address is required');
  end if;
  if v_phone = '' or length(v_phone) < 7 or v_phone !~ '^[+0-9()\-\s]+$' then
    return jsonb_build_object('success', false, 'error', 'A valid phone number is required');
  end if;
  if length(v_notes) > 2000 then return jsonb_build_object('success', false, 'error', 'Special requests must be 2000 characters or less'); end if;

  v_rate_limit_error := public.check_online_booking_rate_limit(v_lodge_id, v_email, v_phone);
  if v_rate_limit_error is not null then return jsonb_build_object('success', false, 'error', v_rate_limit_error); end if;

  v_nights := v_check_out - v_check_in;
  select id into v_customer_id
  from public.customers
  where lodge_id = v_lodge_id and lower(btrim(coalesce(email, ''))) = v_email
  limit 1;

  if not found then
    insert into public.customers (id, lodge_id, name, email, phone)
    values (gen_random_uuid(), v_lodge_id, v_first_name || ' ' || v_last_name, v_email, nullif(v_phone, ''))
    returning id into v_customer_id;
  end if;

  if v_booking_type = 'full_lodge' then
    select count(*), coalesce(sum(coalesce(r.rate_per_night, 0) * v_nights), 0)
      into v_full_lodge_room_count, v_full_lodge_total
    from public.rooms r
    where r.lodge_id = v_lodge_id
      and coalesce(r.status, '') <> 'maintenance';

    v_room_lines := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'room_id', r.id,
        'adults', coalesce((payload->>'adults')::int, 1),
        'children', coalesce((payload->>'children')::int, 0)
      ) order by r.room_number), '[]'::jsonb)
      from (
        select r.id, r.room_number
        from public.rooms r
        where r.lodge_id = v_lodge_id and coalesce(r.status, '') <> 'maintenance'
        order by r.room_number
        limit 1
      ) r
    );
  elsif jsonb_typeof(payload->'rooms') = 'array' then
    v_room_lines := payload->'rooms';
  else
    v_room_lines := jsonb_build_array(jsonb_build_object(
      'room_id', payload->>'room_id',
      'adults', coalesce((payload->>'adults')::int, 1),
      'children', coalesce((payload->>'children')::int, 0)
    ));
  end if;

  if jsonb_array_length(v_room_lines) = 0 then
    return jsonb_build_object('success', false, 'error', 'Select at least one room');
  end if;

  if v_booking_type = 'room' and jsonb_array_length(v_room_lines) <> 1 then
    if not v_offer_multi_room then
      return jsonb_build_object('success', false, 'error', 'Online multi-room booking is not available for this property');
    end if;
    v_booking_type := 'multi_room';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('online-booking:' || v_lodge_id::text, 0));

  v_idem_key := coalesce(
    nullif(btrim(payload->>'idempotency_key'), ''),
    md5(v_email || '::' || v_booking_type || '::' || v_room_lines::text || '::' || v_check_in::text || '::' || v_check_out::text)
  );

  select b.id, b.online_confirmation_token, b.invoice_number
    into v_booking_id, v_confirmation_token, v_invoice_number
  from public.bookings b
  where b.lodge_id = v_lodge_id
    and b.create_idempotency_key = v_idem_key
  limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'reference', 'ONL-' || upper(substring(v_booking_id::text, 1, 8)),
      'booking_id', v_booking_id,
      'confirmation_token', v_confirmation_token,
      'invoice_number', v_invoice_number,
      'idempotent', true,
      'lodge_name', v_lodge_name,
      'currency', v_currency,
      'check_in', v_check_in,
      'check_out', v_check_out,
      'nights', v_nights,
      'guest_name', v_first_name || ' ' || v_last_name,
      'guest_email', v_email
    );
  end if;

  if v_booking_type = 'full_lodge' and exists (
    select 1 from public.bookings b
    where b.lodge_id = v_lodge_id
      and coalesce(b.status, '') not in ('cancelled', 'checked_out')
      and b.check_in < v_check_out and b.check_out > v_check_in
  ) then
    return jsonb_build_object('success', false, 'error', 'The lodge is not available for exclusive use on those dates');
  end if;

  for v_room_line in select * from jsonb_array_elements(v_room_lines) loop
    v_room_id := nullif(v_room_line->>'room_id', '')::uuid;
    v_adults := greatest(1, coalesce((v_room_line->>'adults')::int, 1));
    v_children := greatest(0, coalesce((v_room_line->>'children')::int, 0));
    if v_room_id is null then return jsonb_build_object('success', false, 'error', 'Room is required'); end if;

    perform public.app_check_room_maintenance(v_lodge_id, v_room_id);
    select * into v_room
    from public.rooms r
    where r.id = v_room_id and r.lodge_id = v_lodge_id and coalesce(r.status, '') <> 'maintenance'
    for update;
    if not found then return jsonb_build_object('success', false, 'error', 'A selected room is not available'); end if;

    v_total_guests := v_adults + v_children;
    if v_total_guests > coalesce(v_room.max_occupancy, 0) then
      return jsonb_build_object('success', false, 'error', 'Room ' || coalesce(v_room.room_number, '') || ' supports up to ' || coalesce(v_room.max_occupancy, 0) || ' guests');
    end if;

    select b.id into v_conflict
    from public.bookings b
    where b.lodge_id = v_lodge_id
      and b.room_id = v_room_id
      and coalesce(b.status, '') not in ('cancelled', 'checked_out')
      and b.check_in < v_check_out and b.check_out > v_check_in
    limit 1;
    if v_conflict is not null then
      return jsonb_build_object('success', false, 'error', 'Room ' || coalesce(v_room.room_number, '') || ' is not available for the selected dates');
    end if;

    v_booking_id := gen_random_uuid();
    v_booking_total := case
      when v_booking_type = 'full_lodge' then v_full_lodge_total
      else coalesce(v_room.rate_per_night, 0) * v_nights
    end;
    v_total := v_total + v_booking_total;
    v_confirmation_token := coalesce(v_confirmation_token, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
    v_invoice_number := public.get_next_invoice_number(v_lodge_id);
    v_first_room_number := coalesce(v_first_room_number, v_room.room_number);
    v_first_room_type := coalesce(v_first_room_type, v_room.room_type);

    insert into public.bookings (
      id, lodge_id, customer_id, room_id, check_in, check_out, adults, children,
      total_amount, amount_paid, payment_status, status, source, invoice_number,
      notes, deposit_amount, is_exclusive_event, event_daily_rate,
      created_at, updated_at, create_idempotency_key, online_confirmation_token
    ) values (
      v_booking_id, v_lodge_id, v_customer_id, v_room_id, v_check_in, v_check_out, v_adults, v_children,
      v_booking_total, 0, 'unpaid', 'pending', 'online', v_invoice_number,
      case
        when v_booking_type = 'full_lodge' and v_notes = '' then 'Online full-lodge booking request [ROOMS:' || v_full_lodge_room_count || ']'
        when v_booking_type = 'full_lodge' then 'Online full-lodge booking request [ROOMS:' || v_full_lodge_room_count || ']: ' || v_notes
        when v_notes = '' then 'Online booking request'
        else 'Online booking request: ' || v_notes
      end,
      0, v_booking_type = 'full_lodge', 0, now(), now(),
      case when array_length(v_booking_ids, 1) is null then v_idem_key else v_idem_key || ':' || v_room_id::text end,
      v_confirmation_token
    );

    insert into invoices (booking_id, lodge_id, invoice_number, issued_at, due_date)
    values (v_booking_id, v_lodge_id, v_invoice_number, now(), v_check_in)
    on conflict do nothing;

    v_booking_ids := array_append(v_booking_ids, v_booking_id);

    exit when v_booking_type = 'full_lodge';
  end loop;

  if array_length(v_booking_ids, 1) > 1 then
    v_group_key := 'online-' || replace(gen_random_uuid()::text, '-', '');
    select public.create_booking_invoice_group(
      v_lodge_id,
      v_group_key,
      v_customer_id,
      v_booking_ids,
      null,
      'Online multi-room booking request',
      null
    ) into v_group_result;
    v_invoice_number := coalesce(v_group_result->>'invoice_number', v_invoice_number);
  end if;

  v_reference := 'ONL-' || upper(substring(v_booking_ids[1]::text, 1, 8));
  return jsonb_build_object(
    'success', true,
    'reference', v_reference,
    'booking_id', v_booking_ids[1],
    'booking_ids', v_booking_ids,
    'group_invoice', array_length(v_booking_ids, 1) > 1,
    'confirmation_token', v_confirmation_token,
    'invoice_number', v_invoice_number,
    'lodge_name', v_lodge_name,
    'currency', v_currency,
    'booking_type', v_booking_type,
    'room_count', case when v_booking_type = 'full_lodge' then v_full_lodge_room_count else array_length(v_booking_ids, 1) end,
    'room_number', case
      when v_booking_type = 'full_lodge' then 'Full Lodge'
      when array_length(v_booking_ids, 1) > 1 then array_length(v_booking_ids, 1)::text || ' rooms'
      else v_first_room_number
    end,
    'room_type', case
      when v_booking_type = 'full_lodge' then 'Exclusive use'
      when array_length(v_booking_ids, 1) > 1 then 'Multi-room stay'
      else v_first_room_type
    end,
    'check_in', v_check_in,
    'check_out', v_check_out,
    'nights', v_nights,
    'total_amount', v_total,
    'guest_name', v_first_name || ' ' || v_last_name,
    'guest_email', v_email
  );
end;
$$;

revoke all on function public.get_public_booking_offers(text) from public;
grant execute on function public.get_public_booking_offers(text) to anon, authenticated;

revoke all on function public.create_online_booking(text, jsonb) from public;
grant execute on function public.create_online_booking(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
