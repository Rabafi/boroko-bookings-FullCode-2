-- Runtime privilege boundary. The runtime role may only execute the allowlisted
-- local service functions. Direct table, sequence and helper-function access is
-- removed, and every callable function is SECURITY DEFINER with a fixed
-- search_path so the migration owner controls table access.
DO $grant$
DECLARE
  v_runtime_oid oid;
  v_schema_owner name;
  v_fn regprocedure;
BEGIN
  SELECT oid INTO v_runtime_oid FROM pg_roles WHERE rolname = 'bar_local_runtime';
  IF v_runtime_oid IS NULL THEN
    RAISE EXCEPTION 'The bar_local_runtime role must exist before the grants migration runs.';
  END IF;
  SELECT pg_get_userbyid(nspowner) INTO v_schema_owner FROM pg_namespace WHERE nspname = 'bar_local';
  IF v_schema_owner IS NULL THEN
    RAISE EXCEPTION 'The bar_local schema must exist before the grants migration runs.';
  END IF;

  FOR v_fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'bar_local'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', v_fn);
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, bar_local', v_fn);
  END LOOP;

  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bar_local FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA bar_local FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA bar_local FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA bar_local FROM bar_local_runtime';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA bar_local FROM bar_local_runtime';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA bar_local FROM bar_local_runtime';
  EXECUTE 'REVOKE ALL ON SCHEMA bar_local FROM PUBLIC';
  EXECUTE 'REVOKE CREATE ON SCHEMA bar_local FROM bar_local_runtime';
  EXECUTE 'GRANT USAGE ON SCHEMA bar_local TO bar_local_runtime';

  FOR v_fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'bar_local'
       AND (p.proname = ANY (ARRAY[
         'commission_owner',
         'query_dispatch',
         'service_authority',
         'service_staff',
         'service_device',
         'service_session',
         'service_login_outcome',
         'service_create_session',
         'service_refresh_session',
         'service_revoke_session',
         'service_create_pairing_code',
         'service_complete_pairing',
         'service_revoke_device',
         'service_create_approval',
         'service_set_entitlement',
         'service_increment_epoch',
         'service_operation_status',
         'service_events',
         'service_readiness'
       ]) OR p.proname LIKE 'cmd\_%')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO bar_local_runtime', v_fn);
  END LOOP;

  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA bar_local REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC';
END;
$grant$;
