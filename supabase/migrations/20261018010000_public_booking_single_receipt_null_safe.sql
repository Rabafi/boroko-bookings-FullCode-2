-- F1 forward correction: keep the single-booking occupancy receipt check
-- active when callers omit the optional `rooms` array.
--
-- The F1 migration's `jsonb_typeof(payload->'rooms') <> 'array'` condition
-- evaluates to NULL when `rooms` is absent. In PL/pgSQL, `IF NULL` is not
-- true, so ordinary single-booking requests skipped the receipt binding.
-- `IS DISTINCT FROM` makes absent/null/non-array values take the intended
-- single-booking path while preserving the explicit array and full-lodge
-- branches. This changes no persisted data or financial values.

begin;

do $$
declare
  v_def text;
  v_old text := E'if jsonb_typeof(v_payload->''rooms'')<>''array'' and lower(coalesce(v_payload->>''booking_type'',''room''))<>''full_lodge'' then';
  v_new text := E'if jsonb_typeof(v_payload->''rooms'') is distinct from ''array'' and lower(coalesce(v_payload->>''booking_type'',''room''))<>''full_lodge'' then';
  v_occ integer;
begin
  if to_regprocedure('public.create_online_booking(text,jsonb)') is null then
    raise exception 'public.create_online_booking(text,jsonb) is missing; apply 20261014080000_public_priced_tent_parity.sql first';
  end if;

  select pg_get_functiondef('public.create_online_booking(text,jsonb)'::regprocedure)
    into v_def;
  v_def := replace(v_def, chr(13) || chr(10), chr(10));
  v_occ := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_occ <> 1 then
    raise exception 'Single-booking receipt correction expects exactly one nullable rooms predicate, found %', v_occ;
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

notify pgrst, 'reload schema';

commit;
