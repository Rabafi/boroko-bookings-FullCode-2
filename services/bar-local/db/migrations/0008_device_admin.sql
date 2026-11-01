-- Local service administration reads. Runtime table access remains revoked.
CREATE OR REPLACE FUNCTION bar_local.service_devices(p_token_hash text, p_device_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
BEGIN
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'device_id', d.id,
      'name', d.name,
      'platform', d.platform,
      'status', d.status,
      'paired_at', d.paired_at,
      'revoked_at', d.revoked_at,
      'is_current', d.id = v_ctx.device_id
    ) ORDER BY d.paired_at), '[]'::jsonb)
      FROM bar_local.devices d
     WHERE d.business_id = v_ctx.business_id
       AND d.outlet_id = v_ctx.outlet_id
  );
END;
$$;

ALTER FUNCTION bar_local.service_devices(text, uuid) SECURITY DEFINER;
ALTER FUNCTION bar_local.service_devices(text, uuid) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.service_devices(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.service_devices(text, uuid) TO bar_local_runtime;
