-- Forward-only campsite completeness guardrails.
--
-- The deployed restore contract remains the source of truth for the seven
-- core tables.  This migration adds the booking campsite scalars and nested
-- booking_accommodation_details without widening the top-level table shape.
-- The nested fields are validated here, stripped only for the delegated v2
-- restore, and then written in the same transaction.  The operation digest is
-- replaced with the full-payload digest before this wrapper returns.

-- ---------------------------------------------------------------------------
-- 1. Strictly strip only the nested campsite extensions for delegation
-- ---------------------------------------------------------------------------
create or replace function public._starter_recovery_strip_campsite_booking_fields(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select case
    when jsonb_typeof(p_payload->'tables'->'bookings') = 'array' then
      jsonb_set(
        p_payload,
        '{tables,bookings}',
        coalesce((
          select jsonb_agg(
                   value
                     - 'tents_count'
                     - 'vehicles_count'
                     - 'accommodation_kind'
                     - 'booking_accommodation_details'
                   order by ordinal
                 )
            from jsonb_array_elements(p_payload->'tables'->'bookings')
                 with ordinality as booking(value, ordinal)
        ), '[]'::jsonb),
        true
      )
    else p_payload
  end;
$$;

revoke all on function public._starter_recovery_strip_campsite_booking_fields(jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Full-payload validation layered over the deployed DTO validator
-- ---------------------------------------------------------------------------
alter function public._starter_recovery_validate_payload(jsonb)
  rename to _starter_recovery_validate_payload_v2;

create or replace function public._starter_recovery_validate_payload(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_base_payload jsonb;
  v_recovery_lodge_id uuid;
  v_booking jsonb;
  v_detail jsonb;
  v_snapshot jsonb;
  v_field text;
  v_value numeric;
  v_allowed_detail_fields text[] := array[
    'booking_id','lodge_id','accommodation_kind','adults','children','tents',
    'vehicles','rate_mode','pricing_snapshot','created_at'
  ];
  v_required_detail_fields text[] := array[
    'booking_id','lodge_id','accommodation_kind','adults','children','tents',
    'vehicles','rate_mode','pricing_snapshot'
  ];
  v_allowed_snapshot_fields text[] := array[
    'nights','site_rate','person_rate','tent_rate','vehicle_rate','people',
    'tents','vehicles','calculated_total'
  ];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Recovery payload must be a JSON object.' using errcode = '22023';
  end if;
  if pg_column_size(p_payload) > 8388608 then
    raise exception 'Recovery payload exceeds the 8 MiB server limit.' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'operation_id'), '') is null
     or p_payload->>'operation_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A UUID v4 operation ID is required.' using errcode = '22023';
  end if;

  v_base_payload := public._starter_recovery_strip_campsite_booking_fields(p_payload);
  -- The deployed v2 validator retains all top-level, table, type, ceiling,
  -- lodge, protected-field, and signed-payment checks for the base DTO.
  perform public._starter_recovery_validate_payload_v2(v_base_payload);
  v_recovery_lodge_id := (p_payload->>'recovery_lodge_id')::uuid;

  if jsonb_typeof(p_payload->'tables'->'bookings') <> 'array' then
    return;
  end if;

  for v_booking in
    select value from jsonb_array_elements(p_payload->'tables'->'bookings')
  loop
    if v_booking ? 'tents_count' then
      if jsonb_typeof(v_booking->'tents_count') <> 'number'
         or v_booking->>'tents_count' !~ '^[0-9]+$'
         or (v_booking->>'tents_count')::numeric > 2147483647 then
        raise exception 'tents_count must be a non-negative 32-bit integer.' using errcode = '22023';
      end if;
    end if;
    if v_booking ? 'vehicles_count' then
      if jsonb_typeof(v_booking->'vehicles_count') <> 'number'
         or v_booking->>'vehicles_count' !~ '^[0-9]+$'
         or (v_booking->>'vehicles_count')::numeric > 2147483647 then
        raise exception 'vehicles_count must be a non-negative 32-bit integer.' using errcode = '22023';
      end if;
    end if;
    if v_booking ? 'accommodation_kind' then
      if jsonb_typeof(v_booking->'accommodation_kind') <> 'string'
         or length(btrim(v_booking->>'accommodation_kind')) not between 1 and 64 then
        raise exception 'accommodation_kind must be a non-empty string.' using errcode = '22023';
      end if;
    end if;

    if not (v_booking ? 'booking_accommodation_details') then
      continue;
    end if;
    v_detail := v_booking->'booking_accommodation_details';
    if jsonb_typeof(v_detail) <> 'object' then
      raise exception 'booking_accommodation_details must be an object.' using errcode = '22023';
    end if;
    foreach v_field in array v_required_detail_fields loop
      if not (v_detail ? v_field)
         or v_detail->v_field is null
         or jsonb_typeof(v_detail->v_field) = 'null' then
        raise exception 'Required campsite detail field % is missing.' , v_field using errcode = '22023';
      end if;
    end loop;
    for v_field in select fields.field from jsonb_object_keys(v_detail) as fields(field) loop
      if not (v_field = any(v_allowed_detail_fields)) then
        raise exception 'Unsupported campsite detail field %.', v_field using errcode = '22023';
      end if;
    end loop;

    if v_detail->>'booking_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (v_detail->>'booking_id')::uuid <> (v_booking->>'id')::uuid then
      raise exception 'Campsite detail booking_id must equal its containing booking ID.' using errcode = '22023';
    end if;
    if v_detail->>'lodge_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (v_detail->>'lodge_id')::uuid <> v_recovery_lodge_id then
      raise exception 'Campsite detail lodge_id must equal the recovery lodge.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_detail->'accommodation_kind') <> 'string'
       or length(btrim(v_detail->>'accommodation_kind')) not between 1 and 64 then
      raise exception 'Campsite detail accommodation_kind must be a non-empty string.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_detail->'rate_mode') <> 'string'
       or length(btrim(v_detail->>'rate_mode')) not between 1 and 64 then
      raise exception 'Campsite detail rate_mode must be a non-empty string.' using errcode = '22023';
    end if;
    foreach v_field in array array['adults','children','tents','vehicles'] loop
      if jsonb_typeof(v_detail->v_field) <> 'number'
         or v_detail->>v_field !~ '^[0-9]+$'
         or (v_detail->>v_field)::numeric > 2147483647 then
        raise exception 'Campsite detail % must be a non-negative 32-bit integer.', v_field using errcode = '22023';
      end if;
    end loop;
    if v_detail ? 'created_at'
       and jsonb_typeof(v_detail->'created_at') <> 'string' then
      raise exception 'Campsite detail created_at must be a timestamp string.' using errcode = '22023';
    end if;

    v_snapshot := v_detail->'pricing_snapshot';
    if jsonb_typeof(v_snapshot) <> 'object' or pg_column_size(v_snapshot) > 65536 then
      raise exception 'pricing_snapshot must be a bounded JSON object.' using errcode = '22023';
    end if;
    for v_field in select fields.field from jsonb_object_keys(v_snapshot) as fields(field) loop
      if not (v_field = any(v_allowed_snapshot_fields)) then
        raise exception 'Unsupported pricing_snapshot field %.', v_field using errcode = '22023';
      end if;
      if jsonb_typeof(v_snapshot->v_field) <> 'number' then
        raise exception 'pricing_snapshot field % must be numeric.', v_field using errcode = '22023';
      end if;
      v_value := (v_snapshot->>v_field)::numeric;
      if v_value < 0 then
        raise exception 'pricing_snapshot field % cannot be negative.', v_field using errcode = '22023';
      end if;
    end loop;

    -- If both representations are present, they must not disagree.
    if v_booking ? 'tents_count'
       and v_booking->>'tents_count' <> v_detail->>'tents' then
      raise exception 'Booking tents_count disagrees with campsite detail tents.' using errcode = '22023';
    end if;
    if v_booking ? 'vehicles_count'
       and v_booking->>'vehicles_count' <> v_detail->>'vehicles' then
      raise exception 'Booking vehicles_count disagrees with campsite detail vehicles.' using errcode = '22023';
    end if;
    if v_booking ? 'accommodation_kind'
       and lower(btrim(v_booking->>'accommodation_kind')) <> lower(btrim(v_detail->>'accommodation_kind')) then
      raise exception 'Booking accommodation_kind disagrees with campsite detail.' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function public._starter_recovery_validate_payload(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public._starter_recovery_validate_payload_v2(jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Full-payload idempotency wrapper and atomic campsite detail restore
-- ---------------------------------------------------------------------------
alter function public.admin_execute_starter_disposable_restore(jsonb)
  rename to _starter_recovery_execute_v2;

create or replace function public.admin_execute_starter_disposable_restore(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation_id text;
  v_source_lodge_id uuid;
  v_recovery_lodge_id uuid;
  v_reason text;
  v_ticket_ref text;
  v_package_sha256 text;
  v_package_bytes integer;
  v_full_payload_sha256 text;
  v_base_payload jsonb;
  v_actor uuid := public.app_current_user_id();
  v_actor_email text;
  v_payload_actor uuid;
  v_existing public.starter_recovery_operations%rowtype;
  v_booking jsonb;
  v_detail jsonb;
  v_result jsonb;
  v_expected_detail_count integer := 0;
  v_actual_detail_count integer := 0;
  v_marker boolean := false;
  v_deleted boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Disposable recovery is restricted to the Command Central service path.' using errcode = '42501';
  end if;
  perform public._starter_recovery_validate_payload(p_payload);

  v_operation_id := p_payload->>'operation_id';
  v_source_lodge_id := (p_payload->>'source_lodge_id')::uuid;
  v_recovery_lodge_id := (p_payload->>'recovery_lodge_id')::uuid;
  v_reason := btrim(p_payload->>'reason');
  v_ticket_ref := btrim(p_payload->>'ticket_ref');
  v_payload_actor := nullif(p_payload->>'actor_id','')::uuid;
  v_actor_email := nullif(lower(btrim(p_payload->>'actor_email')), '');
  if v_payload_actor is not null and v_actor is not null and v_payload_actor <> v_actor then
    raise exception 'Payload actor_id does not match the authenticated operator.' using errcode = '42501';
  end if;
  v_actor := coalesce(v_actor, v_payload_actor);
  v_package_sha256 := p_payload->>'package_sha256';
  v_package_bytes := coalesce((p_payload->>'package_bytes')::integer, pg_column_size(p_payload));
  v_full_payload_sha256 := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  v_base_payload := public._starter_recovery_strip_campsite_booking_fields(p_payload);

  if jsonb_typeof(p_payload->'tables'->'bookings') = 'array' then
    select count(*) filter (where value ? 'booking_accommodation_details')
      into v_expected_detail_count
      from jsonb_array_elements(p_payload->'tables'->'bookings') as booking(value);
  end if;

  -- Compare the full incoming payload while holding the operation lock.  This
  -- branch runs before any target-exists check in the delegated v2 function.
  perform pg_advisory_xact_lock(hashtextextended(v_operation_id, 0));
  select * into v_existing
    from public.starter_recovery_operations
   where operation_id = v_operation_id
   for update;
  if found then
    if v_existing.source_lodge_id is distinct from v_source_lodge_id
       or v_existing.recovery_lodge_id is distinct from v_recovery_lodge_id
       or v_existing.reason is distinct from v_reason
       or v_existing.ticket_ref is distinct from v_ticket_ref
       or v_existing.package_sha256 is distinct from v_package_sha256
       or v_existing.package_bytes is distinct from v_package_bytes
       or v_existing.payload_sha256 is distinct from v_full_payload_sha256
       or v_existing.actor_id is distinct from v_actor
       or v_existing.actor_email is distinct from v_actor_email
       or v_existing.target_mode <> 'disposable' then
      raise exception 'Operation ID was reused with a different full payload.' using errcode = '23505';
    end if;
    if v_existing.status = 'verified' then
      select coalesce(count(*), 0)::integer
        into v_actual_detail_count
        from public.booking_accommodation_details d
       where d.lodge_id = v_recovery_lodge_id;
      select coalesce(s.is_disposable_recovery, false), coalesce(s.deleted, false)
        into v_marker, v_deleted
        from public.settings s
       where s.lodge_id = v_recovery_lodge_id
       limit 1;
      v_marker := coalesce(v_marker, false);
      v_deleted := coalesce(v_deleted, false);
      v_result := coalesce(v_existing.result, '{}'::jsonb)
        || jsonb_build_object(
          'success', coalesce((v_existing.result->>'success')::boolean, true) and v_marker and v_deleted and v_actual_detail_count = v_expected_detail_count,
          'idempotent', true,
          'quarantined', v_marker and v_deleted,
          'deleted', v_deleted,
          'quarantine_complete', v_marker and v_deleted,
          'expected_campsite_detail_count', v_expected_detail_count,
          'actual_campsite_detail_count', v_actual_detail_count,
          'campsite_detail_reconciliation', jsonb_build_object(
            'expected', v_expected_detail_count,
            'actual', v_actual_detail_count,
            'match', v_actual_detail_count = v_expected_detail_count
          )
        );
      update public.starter_recovery_operations
         set result = v_result,
             updated_at = now()
       where operation_id = v_operation_id;
      return v_result;
    end if;
    raise exception 'Recovery operation is not retryable in status %.', v_existing.status using errcode = '55000';
  end if;

  -- The v2 implementation performs the existing source/target checks, FK-safe
  -- base inserts, signed-ledger validation/derivation, and both quarantine
  -- markers.  It receives only the strict base DTO.
  v_result := public._starter_recovery_execute_v2(v_base_payload);

  -- Complete the campsite booking columns only after base bookings exist, and
  -- insert each nested detail under its already-remapped booking ID.  All of
  -- this remains in the caller's transaction with the delegated restore.
  if jsonb_typeof(p_payload->'tables'->'bookings') = 'array' then
    for v_booking in
      select value from jsonb_array_elements(p_payload->'tables'->'bookings')
    loop
      if v_booking ? 'tents_count'
         or v_booking ? 'vehicles_count'
         or v_booking ? 'accommodation_kind'
         or v_booking ? 'booking_accommodation_details' then
        update public.bookings
           set tents_count = coalesce(nullif(v_booking->>'tents_count','')::integer,
                                      nullif(v_booking->'booking_accommodation_details'->>'tents','')::integer,
                                      tents_count),
               vehicles_count = coalesce(nullif(v_booking->>'vehicles_count','')::integer,
                                          nullif(v_booking->'booking_accommodation_details'->>'vehicles','')::integer,
                                          vehicles_count),
               accommodation_kind = coalesce(nullif(v_booking->>'accommodation_kind',''),
                                              nullif(v_booking->'booking_accommodation_details'->>'accommodation_kind',''),
                                              accommodation_kind),
               updated_at = now()
         where id = (v_booking->>'id')::uuid
           and lodge_id = v_recovery_lodge_id;
      end if;
      if v_booking ? 'booking_accommodation_details' then
        v_detail := v_booking->'booking_accommodation_details';
        insert into public.booking_accommodation_details (
          booking_id, lodge_id, accommodation_kind, adults, children, tents,
          vehicles, rate_mode, pricing_snapshot, created_at
        ) values (
          (v_detail->>'booking_id')::uuid,
          v_recovery_lodge_id,
          v_detail->>'accommodation_kind',
          (v_detail->>'adults')::integer,
          (v_detail->>'children')::integer,
          (v_detail->>'tents')::integer,
          (v_detail->>'vehicles')::integer,
          v_detail->>'rate_mode',
          v_detail->'pricing_snapshot',
          coalesce((v_detail->>'created_at')::timestamptz, now())
        );
      end if;
    end loop;
  end if;
  select count(*)::integer into v_actual_detail_count
    from public.booking_accommodation_details
   where lodge_id = v_recovery_lodge_id;

  select coalesce(s.is_disposable_recovery, false), coalesce(s.deleted, false)
    into v_marker, v_deleted
    from public.settings s
   where s.lodge_id = v_recovery_lodge_id
   limit 1;
  v_marker := coalesce(v_marker, false);
  v_deleted := coalesce(v_deleted, false);
  if not v_marker or not v_deleted then
    raise exception 'Disposable recovery target did not receive both quarantine markers.' using errcode = '23514';
  end if;

  v_result := v_result || jsonb_build_object(
    'payload_sha256', v_full_payload_sha256,
    'base_payload_sha256', v_result->>'payload_sha256',
    'expected_campsite_detail_count', v_expected_detail_count,
    'actual_campsite_detail_count', v_actual_detail_count,
    'campsite_detail_reconciliation', jsonb_build_object(
      'expected', v_expected_detail_count,
      'actual', v_actual_detail_count,
      'match', v_actual_detail_count = v_expected_detail_count
    ),
    'quarantined', true,
    'deleted', true,
    'quarantine_complete', true
  );
  update public.starter_recovery_operations
     set payload_sha256 = v_full_payload_sha256,
         result = v_result,
         updated_at = now()
   where operation_id = v_operation_id;

  -- The delegated v2 audit records the stripped base payload.  Append a
  -- second immutable event binding this operation to the full incoming
  -- payload; never mutate the existing audit row.
  insert into public.starter_recovery_audit_log (
    operation_id, lodge_id, recovery_lodge_id, event_type, actor_id, actor_email,
    package_sha256, payload_sha256, table_counts, metadata
  ) values (
    v_operation_id, v_source_lodge_id, v_recovery_lodge_id, 'payload_hardened',
    v_actor, v_actor_email, v_package_sha256, v_full_payload_sha256,
    v_result->'table_counts',
    jsonb_build_object(
      'target_mode', 'disposable',
      'quarantined', true,
      'deleted', true,
      'base_payload_sha256', v_result->'base_payload_sha256',
      'expected_campsite_detail_count', v_expected_detail_count,
      'actual_campsite_detail_count', v_actual_detail_count
    )
  );
  return v_result;
end;
$$;

revoke all on function public._starter_recovery_execute_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_execute_starter_disposable_restore(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_execute_starter_disposable_restore(jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Verification includes campsite-detail reconciliation
-- ---------------------------------------------------------------------------
alter function public.admin_verify_starter_disposable_restore(text)
  rename to _starter_recovery_verify_v2;

create or replace function public.admin_verify_starter_disposable_restore(p_operation_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation public.starter_recovery_operations%rowtype;
  v_result jsonb;
  v_marker boolean := false;
  v_deleted boolean := false;
  v_detail_isolated boolean := false;
  v_expected_detail_count integer := 0;
  v_actual_detail_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Disposable recovery verification is service-role only.' using errcode = '42501';
  end if;
  if p_operation_id is null
     or p_operation_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A UUID v4 operation ID is required.' using errcode = '22023';
  end if;
  select * into v_operation
    from public.starter_recovery_operations
   where operation_id = p_operation_id;
  if not found then
    raise exception 'Recovery operation was not found.' using errcode = '22023';
  end if;

  v_result := public._starter_recovery_verify_v2(p_operation_id);
  v_expected_detail_count := coalesce((v_operation.result->>'expected_campsite_detail_count')::integer, 0);
  select count(*)::integer into v_actual_detail_count
    from public.booking_accommodation_details
   where lodge_id = v_operation.recovery_lodge_id;
  v_detail_isolated := not exists (
    select 1
      from public.booking_accommodation_details d
      left join public.bookings b on b.id = d.booking_id
     where d.lodge_id = v_operation.recovery_lodge_id
       and (b.id is null or b.lodge_id <> v_operation.recovery_lodge_id)
  );
  select coalesce(s.is_disposable_recovery, false), coalesce(s.deleted, false)
    into v_marker, v_deleted
    from public.settings s
   where s.lodge_id = v_operation.recovery_lodge_id
   limit 1;
  v_marker := coalesce(v_marker, false);
  v_deleted := coalesce(v_deleted, false);
  return v_result || jsonb_build_object(
    'success', coalesce((v_result->>'success')::boolean, false)
      and v_marker and v_deleted
      and v_detail_isolated
      and v_actual_detail_count = v_expected_detail_count,
    'quarantined', v_marker and v_deleted,
    'deleted', v_deleted,
    'quarantine_complete', v_marker and v_deleted,
    'isolation_ok', coalesce((v_result->>'isolation_ok')::boolean, false) and v_detail_isolated,
    'expected_campsite_detail_count', v_expected_detail_count,
    'actual_campsite_detail_count', v_actual_detail_count,
    'campsite_detail_reconciliation', jsonb_build_object(
      'expected', v_expected_detail_count,
      'actual', v_actual_detail_count,
      'match', v_actual_detail_count = v_expected_detail_count,
      'isolation_ok', v_detail_isolated
    )
  );
end;
$$;

revoke all on function public._starter_recovery_verify_v2(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_verify_starter_disposable_restore(text)
  from public, anon, authenticated;
grant execute on function public.admin_verify_starter_disposable_restore(text)
  to service_role;

notify pgrst, 'reload schema';
