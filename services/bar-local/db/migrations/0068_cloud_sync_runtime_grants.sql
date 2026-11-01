-- Keep the worker's database boundary narrow after restore hardening.
-- These are the only cloud-sync entry points called with the runtime role.
-- The implementation validates the internal worker/session state; helpers and
-- cloud tables remain inaccessible to the runtime role directly.
DO $cloud_sync_runtime_grants$
DECLARE
  v_name text;
  v_function regprocedure;
  v_count integer;
  v_owner text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'cloud_sync_worker_config',
    'cloud_sync_take_batch',
    'cloud_sync_next_batch',
    'cloud_sync_mark_signed',
    'cloud_sync_mark_uploading',
    'cloud_sync_mark_failure',
    'cloud_sync_acknowledge',
    'cloud_sync_record_run',
    'cloud_sync_status',
    'cloud_sync_config_set'
  ] LOOP
    SELECT count(*)::integer
      INTO v_count
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'bar_local'
       AND p.proname = v_name
       AND p.prokind = 'f';

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one bar_local.% function, found %', v_name, v_count;
    END IF;

    SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner)
      INTO v_function, v_owner
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'bar_local'
       AND p.proname = v_name
       AND p.prokind = 'f';

    IF v_owner <> 'bar_local_migrator' THEN
      RAISE EXCEPTION 'bar_local.% must be owned by bar_local_migrator, found %', v_name, v_owner;
    END IF;

    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', v_function);
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, bar_local', v_function);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_function);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM bar_local_runtime', v_function);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO bar_local_runtime', v_function);

    INSERT INTO bar_local.runtime_function_allowlist (function_name)
    VALUES (v_name)
    ON CONFLICT (function_name) DO NOTHING;
  END LOOP;
END;
$cloud_sync_runtime_grants$;
