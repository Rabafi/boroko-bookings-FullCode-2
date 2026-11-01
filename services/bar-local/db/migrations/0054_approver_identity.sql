-- Verifiers remain inside the trusted service boundary, never API responses.
CREATE FUNCTION bar_local.service_approval_candidates(
 p_token_hash text,p_device_id uuid,p_capability text,p_staff_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE v_ctx bar_local.session_context;v_data jsonb;
BEGIN
 v_ctx:=bar_local.service_session(p_token_hash,p_device_id);
 IF p_capability IS NULL OR p_capability NOT IN ('pos.discount','pos.void','pos.manage','pos.cashup',
  'inventory.approve','vouchers.manage','staff.manage','accounting.approve') THEN
  PERFORM bar_local.raise_business('APPROVAL_INVALID','This approval capability is not available.');
 END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_data FROM (
  SELECT s.id,s.display_name,s.role,s.capabilities,s.pin_hash,s.pin_salt,s.pin_iterations,s.status,s.locked_until
  FROM bar_local.staff s WHERE s.business_id=v_ctx.business_id AND s.status='active'
   AND (s.capabilities @> ARRAY[p_capability] OR s.id=v_ctx.staff_id)
   AND (s.locked_until IS NULL OR s.locked_until<=now() OR s.id=v_ctx.staff_id)
   AND (p_staff_id IS NULL OR s.id=p_staff_id)
  ORDER BY s.id LIMIT 129
 ) x;
 RETURN v_data;
END;
$$;
REVOKE ALL ON FUNCTION bar_local.service_approval_candidates(text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.service_approval_candidates(text,uuid,text,uuid) TO bar_local_runtime;
INSERT INTO bar_local.runtime_function_allowlist(function_name) VALUES('service_approval_candidates');

-- Revocation after PIN verification must also invalidate an unused proof.
ALTER FUNCTION bar_local.consume_approval(uuid,text,text,uuid,uuid,uuid) RENAME TO consume_approval_before_actor_guard;
REVOKE ALL ON FUNCTION bar_local.consume_approval_before_actor_guard(uuid,text,text,uuid,uuid,uuid) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.consume_approval(
 p_approval_id uuid,p_operation_hash text,p_capability text,p_business_id uuid,p_outlet_id uuid,p_actor_staff_id uuid
) RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog,bar_local AS $$
DECLARE v_proof bar_local.approvals%ROWTYPE;v_staff bar_local.staff%ROWTYPE;
BEGIN
 IF p_approval_id IS NOT NULL THEN
  SELECT * INTO v_proof FROM bar_local.approvals WHERE id=p_approval_id;
  IF FOUND AND v_proof.business_id=p_business_id AND v_proof.outlet_id=p_outlet_id THEN
   SELECT * INTO v_staff FROM bar_local.staff WHERE id=v_proof.approved_by AND business_id=p_business_id FOR SHARE;
   IF NOT FOUND OR v_staff.status<>'active' OR NOT(v_staff.capabilities @> ARRAY[p_capability]) THEN
    PERFORM bar_local.raise_business('APPROVAL_INVALID','The approving identity is suspended, unavailable or no longer authorised. Obtain a fresh approval.');
   END IF;
  END IF;
 END IF;
 RETURN bar_local.consume_approval_before_actor_guard(p_approval_id,p_operation_hash,p_capability,p_business_id,p_outlet_id,p_actor_staff_id);
END;
$$;
REVOKE ALL ON FUNCTION bar_local.consume_approval(uuid,text,text,uuid,uuid,uuid) FROM PUBLIC,bar_local_runtime;
