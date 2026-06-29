-- Ensure Events & Venues creation can never insert a null parent ID.
-- Some deployed function bodies from the first Events & Venues rollout declared
-- v_event_id separately before the parent insert. Keep this as a forward-only
-- guard so venue-only creation remains safe even if an older body is present.

alter table public.conference_bookings
  alter column id set default gen_random_uuid();

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.create_event_booking(jsonb)'::regprocedure)
    into v_definition;

  if v_definition !~* 'v_event_id\s+uuid\s*:=\s*coalesce\([^;]*gen_random_uuid\(\)' then
    v_definition := replace(
      v_definition,
      'v_event_id uuid;',
      'v_event_id uuid := coalesce(nullif(payload->>''id'', '''')::uuid, gen_random_uuid());'
    );
  end if;

  if v_definition !~* 'begin\s+v_event_id\s*:=' then
    v_definition := regexp_replace(
      v_definition,
      'begin\s+perform public\.app_reject_pwa_financial_mutation\(\);',
      E'begin\n  v_event_id := coalesce(v_event_id, nullif(payload->>''id'', '''')::uuid, gen_random_uuid());\n  perform public.app_reject_pwa_financial_mutation();',
      'i'
    );
  end if;

  execute v_definition;

  select pg_get_functiondef('public.create_event_booking(jsonb)'::regprocedure)
    into v_definition;

  if v_definition !~* 'v_event_id\s+uuid\s*:=\s*coalesce\([^;]*gen_random_uuid\(\)'
     and v_definition !~* 'begin\s+v_event_id\s*:=\s*coalesce\([^;]*gen_random_uuid\(\)' then
    raise exception 'create_event_booking still does not guarantee a generated event ID';
  end if;
end;
$$;
