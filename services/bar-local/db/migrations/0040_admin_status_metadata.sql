-- The runtime role has no direct table access. Administration status needs a
-- narrow, read-only projection for schema identity and device counts so the
-- desktop panel does not silently report zero devices or an unknown schema.
CREATE OR REPLACE FUNCTION bar_local.service_admin_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, bar_local
AS $$
  SELECT jsonb_build_object(
    'schema_migration', (SELECT max(version) FROM bar_local.schema_migrations),
    'devices', (
      SELECT jsonb_build_object(
        'count', count(*)::int,
        'active', count(*) FILTER (WHERE status = 'active')::int
      )
      FROM bar_local.devices
    )
  );
$$;

CREATE OR REPLACE FUNCTION bar_local.service_admin_audit(
  p_business_id uuid,
  p_outlet_id uuid,
  p_actor_staff_id uuid,
  p_device_id uuid,
  p_action text,
  p_after jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, bar_local
AS $$
BEGIN
  IF p_action IS NULL OR p_action !~ '^admin\.[a-z0-9_.]+$' THEN
    RAISE EXCEPTION 'An administrative audit action is required.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO bar_local.audit_log
    (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES
    (p_business_id, p_outlet_id, p_actor_staff_id, p_device_id, p_action, COALESCE(p_after, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION bar_local.service_admin_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.service_admin_status() FROM bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.service_admin_status() TO bar_local_runtime;

REVOKE ALL ON FUNCTION bar_local.service_admin_audit(uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.service_admin_audit(uuid, uuid, uuid, uuid, text, jsonb) FROM bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.service_admin_audit(uuid, uuid, uuid, uuid, text, jsonb) TO bar_local_runtime;

INSERT INTO bar_local.runtime_function_allowlist (function_name)
VALUES ('service_admin_status'), ('service_admin_audit')
ON CONFLICT (function_name) DO NOTHING;
