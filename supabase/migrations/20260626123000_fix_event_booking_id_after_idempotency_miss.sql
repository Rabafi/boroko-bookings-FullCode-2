-- Fix venue-only Events & Venues creation when the idempotency lookup misses.
-- In PL/pgSQL, SELECT ... INTO clears target variables when no row is found.
-- create_event_booking generated v_event_id early, then the idempotency lookup
-- reset it to null before the conference_bookings parent insert.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.create_event_booking(jsonb)'::regprocedure)
    into v_definition;

  if v_definition !~* 'end if;\s+v_event_id\s*:=\s*coalesce\(v_event_id,\s*nullif\(payload->>''id''' then
    v_definition := replace(
      v_definition,
      E'  if found then\n    return jsonb_build_object(\n      ''success'', true,\n      ''event_id'', v_event_id,\n      ''exclusive_booking_id'', v_exclusive_booking_id,\n      ''idempotent'', true\n    );\n  end if;\n\n  perform pg_advisory_xact_lock',
      E'  if found then\n    return jsonb_build_object(\n      ''success'', true,\n      ''event_id'', v_event_id,\n      ''exclusive_booking_id'', v_exclusive_booking_id,\n      ''idempotent'', true\n    );\n  end if;\n\n  v_event_id := coalesce(v_event_id, nullif(payload->>''id'', '''')::uuid, gen_random_uuid());\n\n  perform pg_advisory_xact_lock'
    );
  end if;

  execute v_definition;

  select pg_get_functiondef('public.create_event_booking(jsonb)'::regprocedure)
    into v_definition;

  if v_definition !~* 'end if;\s+v_event_id\s*:=\s*coalesce\(v_event_id,\s*nullif\(payload->>''id''' then
    raise exception 'create_event_booking still clears v_event_id after idempotency lookup miss';
  end if;
end;
$$;
