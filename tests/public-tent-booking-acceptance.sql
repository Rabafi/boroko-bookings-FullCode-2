-- Disposable, transaction-rolled-back acceptance for F1 public tent parity.
-- Run only after the property adaptation feature migrations are installed on
-- the verified disposable target. This script never applies migrations.
begin;

-- This artifact is approved only for the verified, mutation-marked disposable
-- project supplied for the supervised review. Fail before fixture changes on
-- any other database, including production and historical projects.
do $target_guard$
declare
  v_count integer;
  v_marker text;
  v_environment text;
  v_database text;
  v_project text;
  v_allow_mutation boolean;
begin
  select count(*) into v_count from public.luna_remediation_db_marker where singleton is true;
  select marker, environment_kind, database_name, project_ref, allow_mutation
    into v_marker, v_environment, v_database, v_project, v_allow_mutation
    from public.luna_remediation_db_marker where singleton is true;
  if v_count <> 1
     or v_marker is distinct from 'LUNA-REMEDIATION-DISPOSABLE-v1'
     or v_environment is distinct from 'disposable'
     or v_database is distinct from current_database()
     or v_project is distinct from 'repsrmlomedqrmrdsbga'
     or v_allow_mutation is distinct from true then
    raise exception 'Refusing public booking acceptance: approved disposable target marker does not match';
  end if;
end
$target_guard$;

create temporary table luna_public_booking_acceptance_summary (
  suite text not null,
  checks integer not null,
  lodge_id uuid not null
) on commit drop;

do $acceptance$
declare
  v_lodge uuid := gen_random_uuid();
  v_slug text := 'luna-f1-' || replace(gen_random_uuid()::text, '-', '');
  v_rooms uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_room uuid := gen_random_uuid();
  v_modes text[] := array['site', 'person', 'tent', 'vehicle', 'composite'];
  v_mode text;
  v_index integer;
  v_start date := current_date + 14;
  v_result jsonb;
  v_payload jsonb;
  v_booking_id uuid;
  v_replay_id uuid;
  v_key text;
  v_phone_counter integer := 0;
  v_expected numeric[] := array[200, 280, 200, 60, 740];
  v_total numeric;
  v_count integer;
  v_details record;
  v_receipt record;
  v_group_ids uuid[];
  v_no_booking_key text;
  v_checks integer := 0;
  v_legacy_definition text;
  v_wrapper_definition text;
begin
  select pg_get_functiondef('public.create_online_booking_legacy(text,jsonb)'::regprocedure)
    into v_legacy_definition;
  select pg_get_functiondef('public.create_online_booking(text,jsonb)'::regprocedure)
    into v_wrapper_definition;
  if position('public._is_campsite_priced_kind(v_room.accommodation_kind)' in v_legacy_definition) = 0
     or position('v_room.capacity_adults' in v_legacy_definition) = 0
     or position('booking_accommodation_details' in v_wrapper_definition) = 0
     or position('vehicles_count is distinct from' in v_wrapper_definition) = 0
     or position('jsonb_typeof(v_payload->''rooms'') is distinct from ''array''' in lower(v_wrapper_definition)) = 0 then
    raise exception 'F1 current public booking migrations are not installed; this acceptance script does not apply migrations';
  end if;
  v_checks := v_checks + 1;

  insert into public.settings(
    lodge_id, slug, lodge_name, currency, business_type, property_type,
    public_offer_rooms, public_offer_multi_room, public_offer_full_lodge, trial_started_at
  ) values (v_lodge, v_slug, 'Disposable F1 Tent Lodge', 'P', 'lodge', 'camp', true, true, true, null);

  foreach v_mode in array v_modes loop
    v_index := array_position(v_modes, v_mode);
    insert into public.rooms(
      id, lodge_id, room_number, room_type, rate_per_night, max_occupancy, status,
      accommodation_kind, rate_mode, rate_per_person, rate_per_tent, rate_per_vehicle,
      capacity_adults, capacity_children, max_tents, max_vehicles
    ) values (
      v_rooms[v_index], v_lodge, 'T' || v_index, 'Permanent tent', 100, 2, 'available',
      'tent', v_mode, 70, 50, 30, 2, 2, 3, 2
    );
  end loop;

  insert into public.rooms(
    id, lodge_id, room_number, room_type, rate_per_night, max_occupancy, status,
    accommodation_kind, capacity_adults, capacity_children
  ) values (v_room, v_lodge, '101', 'standard', 300, 2, 'available', 'room', null, null);

  -- Exercise the public RPC as an anonymous caller while retaining the
  -- existing grants and role setup. The direct SQL fixture queries below use
  -- the already verified disposable session.
  perform set_config('request.jwt.claim.role', 'anon', true);

  -- Every permanent-tent rate mode prices through the same public envelope.
  for v_index in 1..5 loop
    v_mode := v_modes[v_index];
    v_key := 'luna-f1-mode-' || v_mode || '-' || replace(gen_random_uuid()::text, '-', '');
    v_phone_counter := v_phone_counter + 1;
    v_payload := jsonb_build_object(
      'idempotency_key', v_key,
      'booking_type', 'room',
      'room_id', v_rooms[v_index],
      'check_in', v_start + ((v_index - 1) * 3),
      'check_out', v_start + ((v_index - 1) * 3) + 2,
      'adults', case when v_mode = 'vehicle' then 1 else 2 end,
      'children', 0,
      'tents', case when v_mode in ('tent', 'composite') then 2 else 0 end,
      'vehicles', case when v_mode in ('vehicle', 'composite') then 1 else 0 end,
      'guest_first_name', 'Luna', 'guest_last_name', 'F1',
      'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
    );
    v_result := public.create_online_booking(v_slug, v_payload);
    if coalesce((v_result->>'success')::boolean, false) is not true then
      raise exception 'single tent mode % failed: %', v_mode, v_result;
    end if;
    v_total := (v_result->>'total_amount')::numeric;
    if v_total is distinct from v_expected[v_index] then
      raise exception 'single tent mode % total %, expected %', v_mode, v_total, v_expected[v_index];
    end if;
    v_booking_id := (v_result->>'booking_id')::uuid;
    select b.accommodation_kind, b.tents_count, b.vehicles_count, d.rate_mode, d.tents, d.vehicles
      into v_receipt
      from public.bookings b
      join public.booking_accommodation_details d on d.booking_id = b.id and d.lodge_id = b.lodge_id
     where b.id = v_booking_id and b.lodge_id = v_lodge;
    if v_receipt.accommodation_kind is distinct from 'campsite'
       or v_receipt.rate_mode is distinct from v_mode
       or v_receipt.tents is distinct from (case when v_mode in ('tent', 'composite') then 2 else 0 end)
       or v_receipt.vehicles is distinct from (case when v_mode in ('vehicle', 'composite') then 1 else 0 end) then
      raise exception 'single tent mode % receipt did not conserve its kind and occupancy', v_mode;
    end if;
    v_checks := v_checks + 3;
  end loop;

  -- The SQL contract gives tents independent adult/child caps. One child may
  -- exceed the old generic max_occupancy while remaining inside both caps.
  v_key := 'luna-f1-independent-cap-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_result := public.create_online_booking(v_slug, jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'room', 'room_id', v_rooms[1],
    'check_in', v_start + 20, 'check_out', v_start + 22,
    'adults', 2, 'children', 1, 'tents', 1, 'vehicles', 0,
    'guest_first_name', 'Luna', 'guest_last_name', 'Capacity',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception '2 adult + 1 child tent stay should pass explicit independent caps: %', v_result;
  end if;
  v_booking_id := (v_result->>'booking_id')::uuid;
  select b.adults, b.children into v_details from public.bookings b where b.id = v_booking_id;
  if v_details.adults is distinct from 2 or v_details.children is distinct from 1 then
    raise exception 'independent-cap stay did not preserve submitted adults/children';
  end if;
  v_checks := v_checks + 2;

  -- Adult, child, tent and vehicle caps reject without a booking row.
  for v_index in 1..4 loop
    v_key := 'luna-f1-overcap-' || v_index || '-' || replace(gen_random_uuid()::text, '-', '');
    v_phone_counter := v_phone_counter + 1;
    v_payload := jsonb_build_object(
      'idempotency_key', v_key, 'booking_type', 'room', 'room_id', v_rooms[1],
      'check_in', v_start + 24 + (v_index * 3), 'check_out', v_start + 26 + (v_index * 3),
      'adults', case when v_index = 1 then 3 else 1 end,
      'children', case when v_index = 2 then 3 else 0 end,
      'tents', case when v_index = 3 then 4 else 1 end,
      'vehicles', case when v_index = 4 then 3 else 0 end,
      'guest_first_name', 'Luna', 'guest_last_name', 'Overcap',
      'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
    );
    v_result := public.create_online_booking(v_slug, v_payload);
    if coalesce((v_result->>'success')::boolean, false) is not false then
      raise exception 'capacity case % unexpectedly succeeded: %', v_index, v_result;
    end if;
    select count(*) into v_count from public.bookings
     where lodge_id = v_lodge and create_idempotency_key = v_key;
    if v_count <> 0 then
      raise exception 'capacity case % left a booking row', v_index;
    end if;
    v_checks := v_checks + 2;
  end loop;

  -- A tent-priced unit cannot be booked with zero tents.
  v_key := 'luna-f1-zero-tent-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_result := public.create_online_booking(v_slug, jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'room', 'room_id', v_rooms[3],
    'check_in', v_start + 40, 'check_out', v_start + 42,
    'adults', 1, 'children', 0, 'tents', 0, 'vehicles', 0,
    'guest_first_name', 'Luna', 'guest_last_name', 'ZeroTent',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not false then
    raise exception 'tent rate mode accepted a zero-tent stay: %', v_result;
  end if;
  v_checks := v_checks + 1;

  -- One priced tent plus one room must retain the exact per-line receipt.
  v_key := 'luna-f1-group-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_payload := jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'multi_room',
    'rooms', jsonb_build_array(
      jsonb_build_object('room_id', v_rooms[1], 'adults', 2, 'children', 1, 'tents', 2, 'vehicles', 0),
      jsonb_build_object('room_id', v_room, 'adults', 1, 'children', 0, 'tents', 0, 'vehicles', 0)
    ),
    'check_in', v_start + 45, 'check_out', v_start + 47,
    'adults', 3, 'children', 1, 'tents', 2, 'vehicles', 0,
    'guest_first_name', 'Luna', 'guest_last_name', 'Group',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  );
  v_result := public.create_online_booking(v_slug, v_payload);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'group_invoice')::boolean, false) is not true then
    raise exception 'mixed tent/room group failed: %', v_result;
  end if;
  if (v_result->>'total_amount')::numeric is distinct from 800 then
    raise exception 'mixed group total % did not preserve authoritative per-line rates 800', v_result->>'total_amount';
  end if;
  v_group_ids := array(select jsonb_array_elements_text(v_result->'booking_ids')::uuid);
  if cardinality(v_group_ids) <> 2 then
    raise exception 'mixed group did not return exactly two booking receipts';
  end if;
  select count(*) into v_count
    from public.booking_accommodation_details d
   where d.booking_id = any(v_group_ids) and d.lodge_id = v_lodge;
  if v_count <> 2 then raise exception 'mixed group details receipts missing'; end if;
  select b.tents_count, b.accommodation_kind into v_receipt
    from public.bookings b where b.id = v_group_ids[1] and b.lodge_id = v_lodge;
  if v_receipt.tents_count is distinct from 2 or v_receipt.accommodation_kind is distinct from 'campsite' then
    raise exception 'tent group line did not preserve tents and priced-family kind';
  end if;
  select d.adults, d.children, d.tents, d.vehicles into v_details
    from public.booking_accommodation_details d
   where d.booking_id = v_group_ids[1] and d.lodge_id = v_lodge;
  if v_details.adults is distinct from 2 or v_details.children is distinct from 1
     or v_details.tents is distinct from 2 or v_details.vehicles is distinct from 0 then
    raise exception 'mixed group tent line did not preserve its exact submitted occupancy';
  end if;
  v_checks := v_checks + 5;

  -- Exact single-booking retry returns the same receipt; key reuse with a
  -- changed payload is a conflict.
  v_key := 'luna-f1-replay-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_payload := jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'room', 'room_id', v_rooms[1],
    'check_in', v_start + 52, 'check_out', v_start + 54,
    'adults', 2, 'children', 0, 'tents', 1, 'vehicles', 0,
    'guest_first_name', 'Luna', 'guest_last_name', 'Replay',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  );
  v_result := public.create_online_booking(v_slug, v_payload);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'initial replay fixture failed: %', v_result;
  end if;
  v_booking_id := (v_result->>'booking_id')::uuid;
  v_result := public.create_online_booking(v_slug, v_payload);
  v_replay_id := (v_result->>'booking_id')::uuid;
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'idempotent')::boolean, false) is not true
     or v_replay_id is distinct from v_booking_id then
    raise exception 'exact replay did not return its saved booking receipt: %', v_result;
  end if;
  v_checks := v_checks + 2;
  v_payload := v_payload || jsonb_build_object('check_in', v_start + 53, 'check_out', v_start + 55, 'guest_email', 'clash-' || v_key || '@example.invalid');
  v_result := public.create_online_booking(v_slug, v_payload);
  if coalesce((v_result->>'success')::boolean, false) is not false
     or v_result->>'code' is distinct from 'idempotency_conflict' then
    raise exception 'mismatched key reuse did not conflict: %', v_result;
  end if;
  v_checks := v_checks + 1;

  -- A single room booking omits `rooms`; receipt validation still runs on the
  -- null/missing-array path fixed by the forward migration.
  v_key := 'luna-f1-single-receipt-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_result := public.create_online_booking(v_slug, jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'room', 'room_id', v_rooms[1],
    'check_in', v_start + 58, 'check_out', v_start + 60,
    'adults', 2, 'children', 0, 'tents', 1, 'vehicles', 0,
    'guest_first_name', 'Luna', 'guest_last_name', 'Receipt',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'single room receipt binding rejected a valid non-array payload: %', v_result;
  end if;
  v_checks := v_checks + 1;

  -- Full-lodge stays have one exclusive booking receipt, omit `rooms`, and
  -- keep the authoritative whole-property sum (all active room rates x nights).
  v_key := 'luna-f1-full-lodge-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_result := public.create_online_booking(v_slug, jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'full_lodge',
    'check_in', v_start + 70, 'check_out', v_start + 72,
    'adults', 1, 'children', 0, 'tents', 0, 'vehicles', 0,
    'guest_first_name', 'Luna', 'guest_last_name', 'Exclusive',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result->>'total_amount')::numeric is distinct from 1600 then
    raise exception 'full-lodge total should retain all configured room rates: %', v_result;
  end if;
  v_booking_id := (v_result->>'booking_id')::uuid;
  select b.total_amount, b.is_exclusive_event into v_receipt
    from public.bookings b where b.id = v_booking_id and b.lodge_id = v_lodge;
  if v_receipt.total_amount is distinct from 1600 or v_receipt.is_exclusive_event is not true then
    raise exception 'full-lodge receipt did not retain its whole-property total/exclusive flag';
  end if;
  v_checks := v_checks + 2;

  if has_function_privilege('anon', 'public.create_online_booking(text,jsonb)', 'EXECUTE') is not true
     or has_function_privilege('anon', 'public.create_online_booking_legacy(text,jsonb)', 'EXECUTE') is not false
     or has_function_privilege('anon', 'public._is_campsite_priced_kind(text)', 'EXECUTE') is not false then
    raise exception 'public envelope/legacy/helper grants do not match the public contract';
  end if;

  v_checks := v_checks + 1;
  insert into pg_temp.luna_public_booking_acceptance_summary(suite, checks, lodge_id)
    values ('public-tent-booking', v_checks, v_lodge);
end
$acceptance$;

select suite, checks,
       (select count(*) from public.bookings b where b.lodge_id = s.lodge_id) as fixture_bookings
  from pg_temp.luna_public_booking_acceptance_summary s;

rollback;
