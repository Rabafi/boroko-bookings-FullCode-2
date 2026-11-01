-- SQL NULL comparisons must not turn a missing approval binding into a match.
-- Keep the existing scope, expiry, single-use and maker/checker enforcement.
ALTER FUNCTION bar_local.consume_approval(uuid, text, text, uuid, uuid, uuid)
  RENAME TO consume_approval_before_hash_guard;
REVOKE ALL ON FUNCTION bar_local.consume_approval_before_hash_guard(uuid, text, text, uuid, uuid, uuid)
  FROM PUBLIC, bar_local_runtime;

CREATE FUNCTION bar_local.consume_approval(
  p_approval_id uuid, p_operation_hash text, p_capability text,
  p_business_id uuid, p_outlet_id uuid, p_actor_staff_id uuid
) RETURNS uuid LANGUAGE plpgsql SET search_path = pg_catalog, bar_local AS $$
BEGIN
  IF p_approval_id IS NOT NULL AND (p_operation_hash IS NULL OR p_operation_hash !~ '^[0-9a-f]{64}$') THEN
    PERFORM bar_local.raise_business('APPROVAL_SCOPE_MISMATCH',
      'Approval requires the exact original operation hash. Refresh the action and obtain a new approval; do not bypass its binding.');
  END IF;
  RETURN bar_local.consume_approval_before_hash_guard(p_approval_id, p_operation_hash,
    p_capability, p_business_id, p_outlet_id, p_actor_staff_id);
END;
$$;
REVOKE ALL ON FUNCTION bar_local.consume_approval(uuid, text, text, uuid, uuid, uuid)
  FROM PUBLIC, bar_local_runtime;
