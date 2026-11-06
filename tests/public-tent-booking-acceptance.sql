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

-- Invoke the public RPC with the actual PostgreSQL request role, not merely a
-- caller-controlled JWT role claim while retaining the privileged SQL role.
-- The fixture owner is restored before inspecting persisted records. This is
-- an invoker helper (SET ROLE is legal here; PostgreSQL bars it in SECURITY
-- DEFINER functions), and reset runs on both success and error paths.
create function pg_temp.luna_create_online_booking_as_anon(p_slug text, p_payload jsonb)
returns jsonb
language plpgsql
as $public_call$
declare
  v_result jsonb;
  v_session text := current_setting('app.session_token', true);
  v_claim_role text := current_setting('request.jwt.claim.role', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_headers text := current_setting('request.headers', true);
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', '{}', true);
  perform set_config('app.session_token', '', true);
  begin
    v_result := public.create_online_booking(p_slug, p_payload);
  exception when others then
    execute 'reset role';
    perform set_config('app.session_token', coalesce(v_session, ''), true);
    perform set_config('request.jwt.claim.role', coalesce(v_claim_role, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.headers', coalesce(v_headers, '{}'), true);
    raise;
  end;
  execute 'reset role';
  perform set_config('app.session_token', coalesce(v_session, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_claim_role, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.headers', coalesce(v_headers, '{}'), true);
  return v_result;
end
$public_call$;

create function pg_temp.luna_commit_property_type_as_admin(
  p_lodge_id uuid, p_session_token text, p_expected_property_type text,
  p_target_property_type text, p_expected_updated_at timestamptz, p_operation_key text
) returns jsonb
language plpgsql
as $transition_call$
declare
  v_result jsonb;
  v_session text := current_setting('app.session_token', true);
  v_claim_role text := current_setting('request.jwt.claim.role', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_headers text := current_setting('request.headers', true);
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', '{}', true);
  perform set_config('app.session_token', p_session_token, true);
  begin
    v_result := public.commit_property_type_change(
      p_lodge_id, p_target_property_type, p_expected_property_type, p_expected_updated_at,
      p_operation_key, 'public booking acceptance preservation'
    );
  exception when others then
    execute 'reset role';
    perform set_config('app.session_token', coalesce(v_session, ''), true);
    perform set_config('request.jwt.claim.role', coalesce(v_claim_role, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.headers', coalesce(v_headers, '{}'), true);
    raise;
  end;
  execute 'reset role';
  perform set_config('app.session_token', coalesce(v_session, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_claim_role, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.headers', coalesce(v_headers, '{}'), true);
  return v_result;
end
$transition_call$;

create function pg_temp.luna_call_booking_invoice_group_as_anon(
  p_lodge_id uuid, p_group_key text, p_customer_id uuid, p_booking_ids uuid[], p_session_token text
) returns jsonb
language plpgsql
as $staff_group_call$
declare
  v_result jsonb;
  v_sqlstate text;
  v_error text;
  v_session text := current_setting('app.session_token', true);
  v_claim_role text := current_setting('request.jwt.claim.role', true);
  v_claims text := current_setting('request.jwt.claims', true);
  v_headers text := current_setting('request.headers', true);
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', '{}', true);
  perform set_config('app.session_token', coalesce(p_session_token, ''), true);
  begin
    begin
      v_result := public.create_booking_invoice_group(
        p_lodge_id, p_group_key, p_customer_id, p_booking_ids, null,
        'Disposable custom-session transport acceptance', null
      );
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_error = message_text;
      v_result := jsonb_build_object('success', false, 'sqlstate', v_sqlstate, 'error', v_error);
    end;
  exception when others then
    execute 'reset role';
    perform set_config('app.session_token', coalesce(v_session, ''), true);
    perform set_config('request.jwt.claim.role', coalesce(v_claim_role, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.headers', coalesce(v_headers, '{}'), true);
    raise;
  end;
  execute 'reset role';
  perform set_config('app.session_token', coalesce(v_session, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_claim_role, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.headers', coalesce(v_headers, '{}'), true);
  return v_result;
end
$staff_group_call$;

create function pg_temp.luna_try_public_booking_invoice_group(
  p_lodge_id uuid, p_group_key text, p_customer_id uuid, p_booking_ids uuid[], p_operation_key text
) returns jsonb
language plpgsql
as $private_group_probe$
declare
  v_result jsonb;
  v_sqlstate text;
  v_error text;
begin
  begin
    v_result := public._create_public_booking_invoice_group(
      p_lodge_id, p_group_key, p_customer_id, p_booking_ids, p_operation_key
    );
    return v_result;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_error = message_text;
    return jsonb_build_object('success', false, 'sqlstate', v_sqlstate, 'error', v_error);
  end;
end
$private_group_probe$;

do $acceptance$
declare
  v_lodge uuid := gen_random_uuid();
  v_slug text := 'luna-f1-' || replace(gen_random_uuid()::text, '-', '');
  v_rooms uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_room uuid := gen_random_uuid();
  v_room2 uuid := gen_random_uuid();
  v_uncapped_room uuid := gen_random_uuid();
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
  v_saved_group_result jsonb;
  v_saved_group_token text;
  v_token_count integer;
  v_child_tokens text[];
  v_before_bookings integer;
  v_before_details integer;
  v_before_group_lines integer;
  v_before_groups integer;
  v_before_invoices integer;
  v_preserved_rows_before jsonb;
  v_preserved_rows_after jsonb;
  v_aggregate record;
  v_admin_id uuid := gen_random_uuid();
  v_admin_token text := 'pub-accept-admin-' || replace(gen_random_uuid()::text, '-', '');
  v_operation_key text;
  v_staff_booking_ids uuid[];
  v_staff_customer_id uuid;
  v_staff_result jsonb;
  v_staff_group_id uuid;
  v_staff_group_key text;
  v_other_customer_id uuid;
  v_private_wrong_lodge_key text;
  v_private_wrong_lodge uuid;
  v_staff_email text;
  v_settings_updated_at timestamptz;
  v_rooms_before integer;
  v_payments_before integer;
  v_inventory_before integer;
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
     or position('public._create_public_booking_invoice_group' in v_legacy_definition) = 0
     or position('gen_random_uuid()' in v_legacy_definition) = 0
     or position('booking_accommodation_details' in v_wrapper_definition) = 0
     or position('vehicles_count is distinct from' in v_wrapper_definition) = 0
     or position('jsonb_typeof(v_payload->''rooms'') is distinct from ''array''' in lower(v_wrapper_definition)) = 0 then
    raise exception 'F1 current public booking migrations are not installed; this acceptance script does not apply migrations';
  end if;
  v_checks := v_checks + 1;

  insert into public.settings(
    lodge_id, slug, lodge_name, currency, business_type, property_type,
    public_offer_rooms, public_offer_multi_room, public_offer_full_lodge, trial_started_at, setup_complete
  ) values (v_lodge, v_slug, 'Disposable F1 Tent Lodge', 'P', 'lodge', 'camp', true, true, true, null, true);

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

  insert into public.rooms(
    id, lodge_id, room_number, room_type, rate_per_night, max_occupancy, status,
    accommodation_kind, capacity_adults, capacity_children
  ) values (v_room2, v_lodge, '102', 'standard', 300, 2, 'available', 'room', null, null);

  insert into public.rooms(
    id, lodge_id, room_number, room_type, rate_per_night, max_occupancy, status,
    accommodation_kind, rate_mode, rate_per_person, rate_per_tent, rate_per_vehicle,
    capacity_adults, capacity_children, max_tents, max_vehicles
  ) values (
    v_uncapped_room, v_lodge, 'U1', 'Permanent tent', 100, 2, 'available',
    'tent', 'site', 70, 50, 30, null, null, null, null
  );

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
    v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, v_payload);
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
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, jsonb_build_object(
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

  -- Verify a live property classification transition preserves representative
  -- bookings, accommodation receipts, invoices and inventory. A separate
  -- post-group transition below checks populated group rows as well.
  insert into public.users(id, lodge_id, name, email, role, password_hash, status)
  values (v_admin_id, v_lodge, 'public acceptance admin', v_admin_id::text || '@example.invalid',
          'admin', 'not-a-login-hash', 'active');
  insert into public.app_sessions(token_hash, session_type, user_id, lodge_id, role, expires_at)
  values (public.app_hash_token(v_admin_token), 'desktop', v_admin_id, v_lodge, 'admin', now() + interval '20 minutes');
  insert into public.inventory_items(lodge_id, name, category, unit, current_stock, reorder_level, latest_unit_cost, selling_price)
  values (v_lodge, 'Property transition preservation fixture', 'General', 'unit', 4, 1, 25, 0);
  insert into public.invoices(booking_id, lodge_id, invoice_number, issued_at, due_date)
  values (v_booking_id, v_lodge, public.get_next_invoice_number(v_lodge), now(), v_start + 72);

  select count(*) into v_before_bookings from public.bookings where lodge_id = v_lodge;
  select count(*) into v_before_details from public.booking_accommodation_details where lodge_id = v_lodge;
  select count(*) into v_before_invoices from public.invoices where lodge_id = v_lodge;
  select count(*) into v_rooms_before from public.rooms where lodge_id = v_lodge;
  select count(*) into v_payments_before from public.payments where lodge_id = v_lodge;
  select count(*) into v_inventory_before from public.inventory_items where lodge_id = v_lodge;
  select jsonb_build_object(
    'bookings', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from public.bookings b where b.lodge_id = v_lodge),
    'inventory', (select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb) from public.inventory_items i where i.lodge_id = v_lodge),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb) from public.invoices i where i.lodge_id = v_lodge),
    'accommodation_details', (select coalesce(jsonb_agg(to_jsonb(d) order by d.booking_id), '[]'::jsonb) from public.booking_accommodation_details d where d.lodge_id = v_lodge)
  ) into v_preserved_rows_before;
  select updated_at into v_settings_updated_at from public.settings where lodge_id = v_lodge;
  v_operation_key := gen_random_uuid()::text;
  v_result := pg_temp.luna_commit_property_type_as_admin(
    v_lodge, v_admin_token, 'camp', 'lodge', v_settings_updated_at, v_operation_key
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->'data'->>'changed')::boolean, false) is not true then
    raise exception 'property transition preservation fixture did not commit: %', v_result;
  end if;
  if (select property_type from public.settings where lodge_id = v_lodge) is distinct from 'lodge'
     or (select count(*) from public.bookings where lodge_id = v_lodge) <> v_before_bookings
     or (select count(*) from public.booking_accommodation_details where lodge_id = v_lodge) <> v_before_details
     or (select count(*) from public.invoices where lodge_id = v_lodge) <> v_before_invoices
     or (select count(*) from public.rooms where lodge_id = v_lodge) <> v_rooms_before
     or (select count(*) from public.payments where lodge_id = v_lodge) <> v_payments_before
     or (select count(*) from public.inventory_items where lodge_id = v_lodge) <> v_inventory_before then
    raise exception 'property transition changed booking, inventory, invoice, group or accommodation fixture records';
  end if;
  select jsonb_build_object(
    'bookings', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from public.bookings b where b.lodge_id = v_lodge),
    'inventory', (select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb) from public.inventory_items i where i.lodge_id = v_lodge),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb) from public.invoices i where i.lodge_id = v_lodge),
    'accommodation_details', (select coalesce(jsonb_agg(to_jsonb(d) order by d.booking_id), '[]'::jsonb) from public.booking_accommodation_details d where d.lodge_id = v_lodge)
  ) into v_preserved_rows_after;
  if v_preserved_rows_after is distinct from v_preserved_rows_before then
    raise exception 'property transition changed stored booking, inventory, invoice or accommodation-detail values';
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
    v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, v_payload);
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
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, jsonb_build_object(
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

  -- Vehicle-priced capacity requires at least one vehicle; zero vehicles is
  -- invalid even when every independent capacity field has room.
  v_key := 'luna-f1-zero-vehicle-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'room', 'room_id', v_rooms[4],
    'check_in', v_start + 42, 'check_out', v_start + 44,
    'adults', 1, 'children', 0, 'tents', 0, 'vehicles', 0,
    'guest_first_name', 'Luna', 'guest_last_name', 'ZeroVehicle',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not false then
    raise exception 'vehicle rate mode accepted a zero-vehicle stay: %', v_result;
  end if;
  select count(*) into v_count from public.bookings
   where lodge_id = v_lodge and create_idempotency_key = v_key;
  if v_count <> 0 then raise exception 'zero-vehicle rejection left a booking row'; end if;
  v_checks := v_checks + 2;

  -- NULL capacity fields mean uncapped. The requested occupancy exceeds the
  -- fixture's generic max_occupancy but is valid for this tent inventory.
  v_key := 'luna-f1-null-capacity-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'room', 'room_id', v_uncapped_room,
    'check_in', v_start + 80, 'check_out', v_start + 82,
    'adults', 5, 'children', 4, 'tents', 4, 'vehicles', 3,
    'guest_first_name', 'Luna', 'guest_last_name', 'Uncapped',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'NULL capacity must remain uncapped: %', v_result;
  end if;
  v_booking_id := (v_result->>'booking_id')::uuid;
  select b.adults, b.children, b.tents_count, b.vehicles_count
    into v_details from public.bookings b where b.id = v_booking_id and b.lodge_id = v_lodge;
  if v_details.adults is distinct from 5 or v_details.children is distinct from 4
     or v_details.tents_count is distinct from 4 or v_details.vehicles_count is distinct from 3 then
    raise exception 'NULL capacity booking did not preserve its exact occupancy';
  end if;
  v_checks := v_checks + 2;

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
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, v_payload);
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
  if v_result->>'booking_id' is distinct from v_group_ids[1]::text then
    raise exception 'mixed group lead booking_id does not match booking_ids[1]';
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
  select sum(d.adults)::integer as total_adults, sum(d.children)::integer as total_children,
         sum(d.tents)::integer as total_tents, sum(d.vehicles)::integer as total_vehicles
    into v_aggregate
    from public.booking_accommodation_details d
   where d.booking_id = any(v_group_ids) and d.lodge_id = v_lodge;
  if v_aggregate.total_adults is null then
    raise exception 'mixed group aggregate occupancy receipt is missing';
  end if;
  if v_aggregate.total_adults is distinct from 3 or v_aggregate.total_children is distinct from 1
     or v_aggregate.total_tents is distinct from 2 or v_aggregate.total_vehicles is distinct from 0 then
    raise exception 'mixed group aggregate occupancy did not preserve adults=3, children=1, tents=2, vehicles=0';
  end if;
  v_saved_group_result := v_result;
  v_saved_group_token := v_result->>'confirmation_token';
  select count(distinct b.online_confirmation_token), array_agg(b.online_confirmation_token order by b.id)
    into v_token_count, v_child_tokens
    from public.bookings b where b.id = any(v_group_ids) and b.lodge_id = v_lodge;
  if v_token_count <> 2 or cardinality(v_child_tokens) <> 2
     or v_child_tokens[1] is null or v_child_tokens[2] is null
     or v_saved_group_token is null then
    raise exception 'mixed group child confirmation tokens are not distinct and non-null';
  end if;
  if not exists (
    select 1 from public.bookings b
     where b.id = v_group_ids[1] and b.lodge_id = v_lodge
       and b.online_confirmation_token = v_saved_group_token
  ) then
    raise exception 'public confirmation token is not bound to the lead booking';
  end if;
  -- The form uses guest_email; the first child keeps the bare operation key.
  -- Later children use exactly their room-suffixed key.
  if (select array_agg(b.create_idempotency_key order by u.ordinality)
        from unnest(v_group_ids) with ordinality as u(booking_id, ordinality)
        join public.bookings b on b.id = u.booking_id and b.lodge_id = v_lodge)
       is distinct from array[v_key, v_key || ':' || v_room::text]::text[] then
    raise exception 'public group children do not retain the first bare key and later room-suffixed key';
  end if;
  v_checks := v_checks + 7;

  -- Exact group replay retains the ordered receipt and does not add children,
  -- accommodation evidence, invoice rows, invoice groups or group lines.
  select count(*) into v_before_bookings from public.bookings where id = any(v_group_ids) and lodge_id = v_lodge;
  select count(*) into v_before_details from public.booking_accommodation_details where booking_id = any(v_group_ids) and lodge_id = v_lodge;
  select count(*) into v_before_group_lines from public.booking_invoice_group_lines where booking_id = any(v_group_ids) and lodge_id = v_lodge;
  select count(*) into v_before_groups from public.booking_invoice_groups g where g.lodge_id = v_lodge;
  select count(*) into v_before_invoices from public.invoices where lodge_id = v_lodge;
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, v_payload);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'idempotent')::boolean, false) is not true
     or array(select jsonb_array_elements_text(v_result->'booking_ids')::uuid) is distinct from v_group_ids
     or (v_result - 'idempotent') is distinct from (v_saved_group_result - 'idempotent')
     or v_result->>'confirmation_token' is distinct from v_saved_group_token then
    raise exception 'exact group replay did not return its original ordered lead-bound receipt: %', v_result;
  end if;
  if (select count(*) from public.bookings where id = any(v_group_ids) and lodge_id = v_lodge) <> v_before_bookings
     or (select count(*) from public.booking_accommodation_details where booking_id = any(v_group_ids) and lodge_id = v_lodge) <> v_before_details
     or (select count(*) from public.booking_invoice_group_lines where booking_id = any(v_group_ids) and lodge_id = v_lodge) <> v_before_group_lines
     or (select count(*) from public.booking_invoice_groups g where g.lodge_id = v_lodge) <> v_before_groups
     or (select count(*) from public.invoices where lodge_id = v_lodge) <> v_before_invoices then
    raise exception 'exact group replay created duplicate booking, detail, invoice or grouping records';
  end if;
  v_checks := v_checks + 2;

  -- The staff RPC must remain callable over the desktop anon-key transport,
  -- with authorization enforced by its custom app session. First create two
  -- independent public bookings for one customer, then check both boundaries.
  v_key := 'luna-f1-staff-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, jsonb_build_object(
    'idempotency_key', v_key || '-a', 'booking_type', 'room', 'room_id', v_room,
    'check_in', v_start + 90, 'check_out', v_start + 95,
    'adults', 1, 'children', 0, 'guest_first_name', 'Desktop', 'guest_last_name', 'Transport',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'first desktop transport booking fixture failed: %', v_result;
  end if;
  v_staff_email := v_key || '@example.invalid';
  v_phone_counter := v_phone_counter + 1;
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, jsonb_build_object(
    'idempotency_key', v_key || '-b', 'booking_type', 'room', 'room_id', v_room2,
    'check_in', v_start + 90, 'check_out', v_start + 95,
    'adults', 1, 'children', 0, 'guest_first_name', 'Desktop', 'guest_last_name', 'Transport',
    'guest_email', v_staff_email, 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'second desktop transport booking fixture failed: %', v_result;
  end if;
  select array_agg(b.id order by case b.create_idempotency_key when v_key || '-a' then 1 else 2 end),
         (array_agg(b.customer_id order by case b.create_idempotency_key when v_key || '-a' then 1 else 2 end))[1]
    into v_staff_booking_ids, v_staff_customer_id
    from public.bookings b
   where b.lodge_id = v_lodge and b.create_idempotency_key in (v_key || '-a', v_key || '-b');
  if cardinality(v_staff_booking_ids) <> 2
     or (select count(distinct b.customer_id) from public.bookings b where b.id = any(v_staff_booking_ids)) <> 1 then
    raise exception 'desktop transport fixture does not contain two bookings for one customer';
  end if;

  -- Probe private-helper binding rules against an actual guest_email-shaped
  -- envelope and real public child bookings. Each rejection runs in a PL/pgSQL
  -- exception subtransaction, so failed probes cannot poison this acceptance
  -- transaction or leave partial group rows behind.
  v_key := gen_random_uuid()::text;
  update public.bookings
     set create_idempotency_key = case
       when id = v_staff_booking_ids[1] then v_key
       else v_key || ':' || v_room2::text
     end
   where lodge_id = v_lodge and id = any(v_staff_booking_ids);
  insert into public.public_booking_idempotency(
    lodge_id, idempotency_key, request_hash, effective_idempotency_key,
    booking_ids, result, original_request
  ) values (
    v_lodge, v_key, repeat('a', 64), v_key, '{}'::uuid[], null,
    jsonb_build_object(
      'lodge_id', v_lodge, 'slug', v_slug,
      'payload', jsonb_build_object(
        'rooms', jsonb_build_array(
          jsonb_build_object('room_id', v_room, 'adults', 1, 'children', 0, 'tents', 0, 'vehicles', 0),
          jsonb_build_object('room_id', v_room2, 'adults', 1, 'children', 0, 'tents', 0, 'vehicles', 0)
        ),
        'check_in', v_start + 90, 'check_out', v_start + 95,
        'guest_email', v_staff_email
      )
    )
  );
  v_staff_group_key := 'online-' || substring(encode(sha256(convert_to(
    'public-invoice-group:' || v_lodge::text || ':' || v_key, 'UTF8')), 'hex') from 1 for 32);
  v_other_customer_id := (select b.customer_id from public.bookings b
    where b.lodge_id = v_lodge and b.customer_id is distinct from v_staff_customer_id limit 1);
  if v_other_customer_id is null then
    raise exception 'substitution fixture requires a second lodge-scoped customer';
  end if;
  v_staff_result := pg_temp.luna_try_public_booking_invoice_group(
    v_lodge, v_staff_group_key, v_staff_customer_id,
    array[v_staff_booking_ids[2], v_staff_booking_ids[1]], v_key
  );
  if v_staff_result->>'success' is not distinct from 'true'
     or v_staff_result->>'sqlstate' is distinct from 'P0001' then
    raise exception 'substituted/reordered public child IDs were not rejected: %', v_staff_result;
  end if;
  v_staff_result := pg_temp.luna_try_public_booking_invoice_group(
    v_lodge, v_staff_group_key, v_other_customer_id, v_staff_booking_ids, v_key
  );
  if v_staff_result->>'success' is not distinct from 'true'
     or v_staff_result->>'sqlstate' is distinct from 'P0001' then
    raise exception 'substituted public customer was not rejected: %', v_staff_result;
  end if;
  v_private_wrong_lodge := gen_random_uuid();
  v_private_wrong_lodge_key := 'online-' || substring(encode(sha256(convert_to(
    'public-invoice-group:' || v_private_wrong_lodge::text || ':' || v_key, 'UTF8')), 'hex') from 1 for 32);
  v_staff_result := pg_temp.luna_try_public_booking_invoice_group(
    v_private_wrong_lodge, v_private_wrong_lodge_key, v_staff_customer_id, v_staff_booking_ids, v_key
  );
  if v_staff_result->>'success' is not distinct from 'true'
     or v_staff_result->>'sqlstate' is distinct from 'P0001' then
    raise exception 'wrong-lodge public group call was not rejected: %', v_staff_result;
  end if;
  v_checks := v_checks + 3;

  v_staff_group_key := 'desktop-' || replace(gen_random_uuid()::text, '-', '');
  if has_function_privilege('anon', 'public.create_booking_invoice_group(uuid,text,uuid,uuid[],text,text,uuid)', 'EXECUTE') is not true then
    raise exception 'anon API-key role has no execute grant for the guarded desktop staff RPC';
  end if;
  v_staff_result := pg_temp.luna_call_booking_invoice_group_as_anon(
    v_lodge, v_staff_group_key, v_staff_customer_id, v_staff_booking_ids, ''
  );
  if coalesce((v_staff_result->>'success')::boolean, true) is not false
     or v_staff_result->>'sqlstate' is distinct from '42501' then
    raise exception 'unauthenticated anon staff grouping is denied: %', v_staff_result;
  end if;
  v_checks := v_checks + 2;
  v_staff_result := pg_temp.luna_call_booking_invoice_group_as_anon(
    v_lodge, v_staff_group_key, v_staff_customer_id, v_staff_booking_ids, v_admin_token
  );
  if coalesce((v_staff_result->>'success')::boolean, false) is not true
     or cardinality(array(select jsonb_array_elements_text(v_staff_result->'booking_ids')::uuid)) <> 2 then
    raise exception 'authorized desktop staff grouping via anon transport failed: %', v_staff_result;
  end if;
  v_staff_group_id := (v_staff_result->>'group_id')::uuid;
  if (select count(*) from public.booking_invoice_group_lines l
       where l.group_id = v_staff_group_id and l.lodge_id = v_lodge) <> 2 then
    raise exception 'authorized desktop staff grouping did not persist both scoped lines';
  end if;
  v_checks := v_checks + 2;

  -- A real public group and a separate staff-created group now exist. Changing
  -- the property classification must preserve all populated group rows and
  -- their booking, invoice, and accommodation evidence exactly.
  select jsonb_build_object(
    'groups', (select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb) from public.booking_invoice_groups g where g.lodge_id = v_lodge),
    'group_lines', (select coalesce(jsonb_agg(to_jsonb(l) order by l.group_id, l.line_order), '[]'::jsonb) from public.booking_invoice_group_lines l where l.lodge_id = v_lodge),
    'bookings', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from public.bookings b where b.lodge_id = v_lodge),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb) from public.invoices i where i.lodge_id = v_lodge),
    'accommodation_details', (select coalesce(jsonb_agg(to_jsonb(d) order by d.booking_id), '[]'::jsonb) from public.booking_accommodation_details d where d.lodge_id = v_lodge)
  ) into v_preserved_rows_before;
  select updated_at into v_settings_updated_at from public.settings where lodge_id = v_lodge;
  v_operation_key := gen_random_uuid()::text;
  v_result := pg_temp.luna_commit_property_type_as_admin(
    v_lodge, v_admin_token, 'lodge', 'camp', v_settings_updated_at, v_operation_key
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->'data'->>'changed')::boolean, false) is not true then
    raise exception 'populated-group preservation transition did not commit: %', v_result;
  end if;
  select jsonb_build_object(
    'groups', (select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb) from public.booking_invoice_groups g where g.lodge_id = v_lodge),
    'group_lines', (select coalesce(jsonb_agg(to_jsonb(l) order by l.group_id, l.line_order), '[]'::jsonb) from public.booking_invoice_group_lines l where l.lodge_id = v_lodge),
    'bookings', (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb) from public.bookings b where b.lodge_id = v_lodge),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb) from public.invoices i where i.lodge_id = v_lodge),
    'accommodation_details', (select coalesce(jsonb_agg(to_jsonb(d) order by d.booking_id), '[]'::jsonb) from public.booking_accommodation_details d where d.lodge_id = v_lodge)
  ) into v_preserved_rows_after;
  if v_preserved_rows_after is distinct from v_preserved_rows_before then
    raise exception 'property transition changed populated group or related booking receipt rows';
  end if;
  v_checks := v_checks + 1;

  -- A valid first room followed by an invalid second line fails atomically.
  v_key := 'luna-f1-invalid-second-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  select count(*) into v_before_bookings from public.bookings where lodge_id = v_lodge;
  select count(*) into v_before_details from public.booking_accommodation_details where lodge_id = v_lodge;
  select count(*) into v_before_group_lines from public.booking_invoice_group_lines where lodge_id = v_lodge;
  select count(*) into v_before_groups from public.booking_invoice_groups where lodge_id = v_lodge;
  select count(*) into v_before_invoices from public.invoices where lodge_id = v_lodge;
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'multi_room',
    'rooms', jsonb_build_array(
      jsonb_build_object('room_id', v_rooms[2], 'adults', 1, 'children', 0, 'tents', 1, 'vehicles', 0),
      jsonb_build_object('room_id', gen_random_uuid(), 'adults', 1, 'children', 0, 'tents', 0, 'vehicles', 0)
    ),
    'check_in', v_start + 62, 'check_out', v_start + 64,
    'adults', 2, 'children', 0, 'tents', 1, 'vehicles', 0,
    'guest_first_name', 'Luna', 'guest_last_name', 'InvalidSecond',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not false then
    raise exception 'group with invalid second line unexpectedly succeeded: %', v_result;
  end if;
  if (select count(*) from public.bookings where lodge_id = v_lodge) <> v_before_bookings
     or (select count(*) from public.booking_accommodation_details where lodge_id = v_lodge) <> v_before_details
     or (select count(*) from public.booking_invoice_group_lines where lodge_id = v_lodge) <> v_before_group_lines
     or (select count(*) from public.booking_invoice_groups where lodge_id = v_lodge) <> v_before_groups
     or (select count(*) from public.invoices where lodge_id = v_lodge) <> v_before_invoices then
    raise exception 'invalid second line left a partial booking, detail, invoice or group record';
  end if;
  v_checks := v_checks + 2;

  -- Compatibility: a multi-line room array remains a group when the wrapper
  -- says booking_type='room', matching existing callers that omit the special
  -- multi_room label.
  v_key := 'luna-f1-room-array-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'room',
    'rooms', jsonb_build_array(
      jsonb_build_object('room_id', v_room, 'adults', 1, 'children', 0),
      jsonb_build_object('room_id', v_room2, 'adults', 1, 'children', 0)
    ),
    'check_in', v_start + 65, 'check_out', v_start + 67,
    'adults', 2, 'children', 0, 'tents', 0, 'vehicles', 0,
    'guest_first_name', 'Luna', 'guest_last_name', 'RoomArray',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'group_invoice')::boolean, false) is not true
     or cardinality(array(select jsonb_array_elements_text(v_result->'booking_ids')::uuid)) <> 2
     or (v_result->>'total_amount')::numeric is distinct from 1200 then
    raise exception 'ordinary room array compatibility failed: %', v_result;
  end if;
  v_checks := v_checks + 1;

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
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, v_payload);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'initial replay fixture failed: %', v_result;
  end if;
  v_booking_id := (v_result->>'booking_id')::uuid;
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, v_payload);
  v_replay_id := (v_result->>'booking_id')::uuid;
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'idempotent')::boolean, false) is not true
     or v_replay_id is distinct from v_booking_id then
    raise exception 'exact replay did not return its saved booking receipt: %', v_result;
  end if;
  v_checks := v_checks + 2;
  v_payload := v_payload || jsonb_build_object('check_in', v_start + 53, 'check_out', v_start + 55, 'guest_email', 'clash-' || v_key || '@example.invalid');
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, v_payload);
  if coalesce((v_result->>'success')::boolean, false) is not false
     or v_result->>'code' is distinct from 'idempotency_conflict' then
    raise exception 'mismatched key reuse did not conflict: %', v_result;
  end if;
  v_checks := v_checks + 1;

  -- A single room booking omits `rooms`; receipt validation still runs on the
  -- null/missing-array path fixed by the forward migration.
  v_key := 'luna-f1-single-receipt-' || replace(gen_random_uuid()::text, '-', '');
  v_phone_counter := v_phone_counter + 1;
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, jsonb_build_object(
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
  v_result := pg_temp.luna_create_online_booking_as_anon(v_slug, jsonb_build_object(
    'idempotency_key', v_key, 'booking_type', 'full_lodge',
    'check_in', v_start + 70, 'check_out', v_start + 72,
    'adults', 1, 'children', 0, 'tents', 0, 'vehicles', 0,
    'guest_first_name', 'Luna', 'guest_last_name', 'Exclusive',
    'guest_email', v_key || '@example.invalid', 'guest_phone', '+267700' || lpad(v_phone_counter::text, 5, '0'), 'notes', ''
  ));
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result->>'total_amount')::numeric is distinct from 2200 then
    raise exception 'full-lodge total should retain all configured room rates: %', v_result;
  end if;
  v_booking_id := (v_result->>'booking_id')::uuid;
  select b.total_amount, b.is_exclusive_event into v_receipt
    from public.bookings b where b.id = v_booking_id and b.lodge_id = v_lodge;
  select count(*) into v_count from public.bookings
   where lodge_id = v_lodge and create_idempotency_key = v_key;
  if v_count <> 1 or v_receipt.total_amount is distinct from 2200 or v_receipt.is_exclusive_event is not true then
    raise exception 'full-lodge receipt did not retain its whole-property total/exclusive flag';
  end if;
  v_checks := v_checks + 2;

  if has_function_privilege('anon', 'public.create_online_booking(text,jsonb)', 'EXECUTE') is not true
     or has_function_privilege('anon', 'public.create_online_booking_legacy(text,jsonb)', 'EXECUTE') is not false
     or has_function_privilege('anon', 'public._is_campsite_priced_kind(text)', 'EXECUTE') is not false
     or has_function_privilege('authenticated', 'public._is_campsite_priced_kind(text)', 'EXECUTE') is not false
     or has_function_privilege('anon', 'public._create_public_booking_invoice_group(uuid,text,uuid,uuid[],text)', 'EXECUTE') is not false
     or has_function_privilege('authenticated', 'public._create_public_booking_invoice_group(uuid,text,uuid,uuid[],text)', 'EXECUTE') is not false
     or has_function_privilege('anon', 'public.create_booking_invoice_group(uuid,text,uuid,uuid[],text,text,uuid)', 'EXECUTE') is not true
     or has_function_privilege('authenticated', 'public.create_booking_invoice_group(uuid,text,uuid,uuid[],text,text,uuid)', 'EXECUTE') is not true then
    raise exception 'public envelope/private-helper/staff-anon-key grants do not match the public contract';
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
