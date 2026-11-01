-- Prove that a reconnection endpoint holds the original paired device secret
-- before Modern or Legacy releases that credential or an owner PIN.
-- token_hash is returned only to the trusted local service process, never to
-- the unauthenticated HTTP caller. The service signs a fresh nonce and binds
-- it to this device/business/outlet and the promoted authority state.
CREATE OR REPLACE FUNCTION bar_local.service_replacement_challenge(p_device_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, bar_local
AS $$
  SELECT jsonb_build_object(
    'token_hash', d.token_hash,
    'device_id', d.id,
    'device_status', d.status,
    'business_id', d.business_id,
    'outlet_id', d.outlet_id,
    'authority_id', a.authority_id,
    'authority_epoch', a.authority_epoch,
    'promoted_epoch', fs.promoted_epoch,
    'fenced', fs.fenced,
    'in_recovery', pg_is_in_recovery()
  )
  FROM bar_local.devices d
  JOIN bar_local.authority a ON a.singleton AND a.business_id = d.business_id
  JOIN bar_local.failover_state fs ON fs.singleton
  WHERE d.id = p_device_id
    AND d.status = 'active'
    AND a.commissioned_at IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION bar_local.service_replacement_challenge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.service_replacement_challenge(uuid) TO bar_local_runtime;
INSERT INTO bar_local.runtime_function_allowlist (function_name)
VALUES ('service_replacement_challenge')
ON CONFLICT (function_name) DO NOTHING;
