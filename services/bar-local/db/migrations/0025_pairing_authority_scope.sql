-- Complete pairing responses carry the authority identity needed to persist a
-- correctly scoped client profile. This route is available only with a
-- single-use pairing code; the device token remains returned separately and
-- is never stored in SQL in plaintext.
CREATE OR REPLACE FUNCTION bar_local.service_complete_pairing(
  p_code_hash text,
  p_name text,
  p_platform text,
  p_device_token_hash text,
  p_certificate_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_code bar_local.pairing_codes%ROWTYPE;
  v_device_id uuid;
  v_authority_id uuid;
  v_authority_epoch bigint;
BEGIN
  SELECT * INTO v_code FROM bar_local.pairing_codes WHERE code_hash = p_code_hash FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('PAIRING_CODE_INVALID', 'The pairing code is not valid.');
  END IF;
  IF v_code.used_at IS NOT NULL THEN
    PERFORM bar_local.raise_business('PAIRING_CODE_USED', 'The pairing code has already been used.');
  END IF;
  IF v_code.expires_at <= now() THEN
    PERFORM bar_local.raise_business('PAIRING_CODE_EXPIRED', 'The pairing code has expired.');
  END IF;
  INSERT INTO bar_local.devices (business_id, outlet_id, name, platform, certificate_fingerprint, token_hash, pairing_code_id)
  VALUES (v_code.business_id, v_code.outlet_id, p_name, p_platform, p_certificate_fingerprint, p_device_token_hash, v_code.id)
  RETURNING id INTO v_device_id;
  UPDATE bar_local.pairing_codes SET used_at = now() WHERE id = v_code.id;
  SELECT authority_id, authority_epoch INTO STRICT v_authority_id, v_authority_epoch
    FROM bar_local.authority WHERE singleton;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, action, after)
  VALUES (v_code.business_id, v_code.outlet_id, v_code.created_by, 'device.paired',
          jsonb_build_object('device_id', v_device_id, 'platform', p_platform, 'fingerprint', p_certificate_fingerprint));
  RETURN jsonb_build_object(
    'device_id', v_device_id,
    'business_id', v_code.business_id,
    'outlet_id', v_code.outlet_id,
    'authority_id', v_authority_id,
    'authority_epoch', v_authority_epoch
  );
END;
$$;

REVOKE ALL ON FUNCTION bar_local.service_complete_pairing(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.service_complete_pairing(text, text, text, text, text) TO bar_local_runtime;
