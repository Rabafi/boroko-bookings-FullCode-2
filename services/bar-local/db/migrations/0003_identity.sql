-- Commissioning, pairing, sessions and signed-entitlement custody.
DROP FUNCTION IF EXISTS bar_local.commission_owner(uuid, uuid, uuid, text, text, text, text, text, integer, text, text, text);
CREATE OR REPLACE FUNCTION bar_local.commission_owner(
  p_authority_id uuid,
  p_business_id uuid,
  p_outlet_id uuid,
  p_business_name text,
  p_outlet_name text,
  p_owner_name text,
  p_pin_hash text,
  p_pin_salt text,
  p_pin_iterations integer,
  p_setup_secret_hash text,
  p_currency text DEFAULT 'BWP',
  p_timezone text DEFAULT 'Africa/Gaborone',
  p_device_name text DEFAULT NULL,
  p_device_platform text DEFAULT 'modern',
  p_device_certificate_fingerprint text DEFAULT NULL,
  p_device_token_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_caps text[] := ARRAY['pos.view','pos.manage','pos.void','pos.discount','pos.cashup','pos.reports','pos.menu_manage','inventory.view','inventory.manage','inventory.approve','customers.manage','vouchers.manage','staff.manage','settings.manage','accounting.read','accounting.manage','accounting.approve','backup.manage','export.manage'];
  v_owner_id uuid;
  v_device_id uuid;
  v_setup bar_local.setup_state%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM bar_local.authority WHERE singleton) THEN
    PERFORM bar_local.raise_business('AUTHORITY_ALREADY_COMMISSIONED', 'This local Bar authority has already been commissioned. The owner setup endpoint is permanently fenced.');
  END IF;
  IF p_authority_id IS NULL OR p_business_id IS NULL OR p_outlet_id IS NULL THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Authority, business and outlet identifiers are required.');
  END IF;
  IF p_setup_secret_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM bar_local.raise_business('SETUP_SECRET_INVALID', 'A valid local setup secret is required to commission this authority.');
  END IF;
  SELECT * INTO v_setup FROM bar_local.setup_state WHERE singleton FOR UPDATE;
  IF NOT FOUND OR v_setup.used_at IS NOT NULL OR v_setup.expires_at <= now() OR v_setup.secret_hash <> p_setup_secret_hash THEN
    PERFORM bar_local.raise_business('SETUP_SECRET_INVALID', 'The local setup secret is invalid, expired or already used. Use the protected local recovery procedure.');
  END IF;
  IF p_pin_iterations IS NULL OR p_pin_iterations < 100000 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The local PIN verifier must use at least 100000 iterations.');
  END IF;
  IF (p_device_name IS NULL) <> (p_device_token_hash IS NULL) THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A first device name and token must be supplied together.');
  END IF;
  IF p_device_token_hash IS NOT NULL AND p_device_token_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The first device token hash is invalid.');
  END IF;
  IF p_device_platform NOT IN ('modern', 'legacy') THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The first device platform must be modern or legacy.');
  END IF;
  INSERT INTO bar_local.business (id, name, currency, timezone)
  VALUES (p_business_id, p_business_name, p_currency, p_timezone);
  INSERT INTO bar_local.outlets (id, business_id, name, code)
  VALUES (p_outlet_id, p_business_id, p_outlet_name, 'MAIN');
  INSERT INTO bar_local.authority (singleton, authority_id, authority_epoch, business_id, commissioned_at)
  VALUES (true, p_authority_id, 1, p_business_id, now());
  INSERT INTO bar_local.staff (business_id, display_name, role, capabilities, pin_hash, pin_salt, pin_iterations)
  VALUES (p_business_id, p_owner_name, 'owner', v_caps, p_pin_hash, p_pin_salt, p_pin_iterations)
  RETURNING id INTO v_owner_id;
  IF p_device_token_hash IS NOT NULL THEN
    INSERT INTO bar_local.devices (business_id, outlet_id, name, platform, certificate_fingerprint, token_hash)
    VALUES (p_business_id, p_outlet_id, p_device_name, p_device_platform, p_device_certificate_fingerprint, p_device_token_hash)
    RETURNING id INTO v_device_id;
  END IF;
  UPDATE bar_local.settings SET value = to_jsonb(p_business_name), version = version + 1 WHERE key = 'business_name';
  UPDATE bar_local.settings SET value = to_jsonb(p_currency), version = version + 1 WHERE key = 'currency';
  UPDATE bar_local.settings SET value = to_jsonb(p_timezone), version = version + 1 WHERE key = 'timezone';
  UPDATE bar_local.setup_state SET used_at = now() WHERE singleton;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES (p_business_id, p_outlet_id, v_owner_id, v_device_id, 'authority.commissioned',
          jsonb_build_object('authority_id', p_authority_id, 'epoch', 1, 'device_id', v_device_id));
  RETURN jsonb_build_object(
    'authority_id', p_authority_id, 'business_id', p_business_id, 'outlet_id', p_outlet_id,
    'owner_staff_id', v_owner_id, 'device_id', v_device_id, 'authority_epoch', 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_device(p_token_hash text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'device_id', id, 'business_id', business_id, 'outlet_id', outlet_id,
    'name', name, 'platform', platform, 'status', status
  )
  FROM bar_local.devices WHERE token_hash = p_token_hash;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_authority()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'authority_id', a.authority_id, 'authority_epoch', a.authority_epoch,
    'business_id', a.business_id, 'commissioned', a.commissioned_at IS NOT NULL,
    'catalogue_version', a.catalogue_version, 'entitlement_version', a.entitlement_version,
    'entitlement_features', a.entitlement_features, 'export_key_id', a.export_key_id,
    'business_name', b.name, 'currency', b.currency, 'timezone', b.timezone
  )
  FROM bar_local.authority a JOIN bar_local.business b ON b.id = a.business_id
  WHERE a.singleton;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_staff(p_business_id uuid, p_staff_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id', id, 'display_name', display_name, 'role', role, 'capabilities', capabilities,
    'pin_hash', pin_hash, 'pin_salt', pin_salt, 'pin_iterations', pin_iterations, 'status', status,
    'locked_until', locked_until
  ) FROM bar_local.staff WHERE business_id = p_business_id AND id = p_staff_id;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_login_outcome(p_staff_id uuid, p_success boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_staff bar_local.staff%ROWTYPE;
  v_locked timestamptz;
  v_attempts integer;
BEGIN
  SELECT * INTO v_staff FROM bar_local.staff WHERE id = p_staff_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTH_INVALID', 'The operator credential is invalid.');
  END IF;
  IF p_success THEN
    UPDATE bar_local.staff
       SET failed_login_attempts = 0, locked_until = NULL, updated_at = now()
     WHERE id = p_staff_id;
    RETURN jsonb_build_object('locked_until', NULL, 'failed_login_attempts', 0);
  END IF;
  v_attempts := v_staff.failed_login_attempts + 1;
  IF v_attempts >= 5 THEN
    v_locked := now() + interval '15 minutes';
    UPDATE bar_local.staff
       SET failed_login_attempts = 0, locked_until = v_locked, updated_at = now()
     WHERE id = p_staff_id;
  ELSE
    UPDATE bar_local.staff
       SET failed_login_attempts = v_attempts, updated_at = now()
     WHERE id = p_staff_id;
  END IF;
  RETURN jsonb_build_object('locked_until', v_locked, 'failed_login_attempts', CASE WHEN v_locked IS NULL THEN v_attempts ELSE 0 END);
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_session(p_token_hash text, p_device_id uuid)
RETURNS bar_local.session_context LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_result bar_local.session_context;
BEGIN
  SELECT s.id, st.id, st.business_id, s.outlet_id, st.role, st.capabilities, st.display_name, d.id
    INTO v_result
    FROM bar_local.sessions s
    JOIN bar_local.devices d ON d.id = s.device_id
    JOIN bar_local.staff st ON st.id = s.staff_id
   WHERE s.token_hash = p_token_hash AND s.device_id = p_device_id
     AND s.revoked_at IS NULL AND s.expires_at > now()
     AND d.status = 'active' AND st.status = 'active';
  IF v_result.staff_id IS NULL THEN
    PERFORM bar_local.raise_business('AUTH_INVALID', 'The local session credential is invalid, expired, revoked or the device/staff is suspended.');
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_create_session(
  p_staff_id uuid,
  p_device_id uuid,
  p_outlet_id uuid,
  p_token_hash text,
  p_ttl_seconds integer DEFAULT 43200
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_staff bar_local.staff%ROWTYPE;
  v_device bar_local.devices%ROWTYPE;
  v_authority bar_local.authority%ROWTYPE;
  v_session_id uuid;
  v_expires timestamptz;
BEGIN
  SELECT * INTO v_authority FROM bar_local.authority WHERE singleton;
  SELECT * INTO v_staff FROM bar_local.staff WHERE id = p_staff_id FOR SHARE;
  IF NOT FOUND OR v_staff.status <> 'active' THEN
    PERFORM bar_local.raise_business('AUTH_INVALID', 'The staff identity is unavailable.');
  END IF;
  IF v_staff.locked_until IS NOT NULL AND v_staff.locked_until > now() THEN
    PERFORM bar_local.raise_business('ACCOUNT_LOCKED', 'This operator is temporarily locked after repeated credential failures.');
  END IF;
  SELECT * INTO v_device FROM bar_local.devices WHERE id = p_device_id FOR SHARE;
  IF NOT FOUND OR v_device.status <> 'active' THEN
    PERFORM bar_local.raise_business('DEVICE_REVOKED', 'The device is not paired or has been revoked.');
  END IF;
  IF v_device.business_id <> v_staff.business_id OR v_device.outlet_id <> p_outlet_id THEN
    PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'The staff identity and device are not scoped to the selected outlet.');
  END IF;
  v_expires := now() + make_interval(secs => GREATEST(60, LEAST(p_ttl_seconds, 604800)));
  INSERT INTO bar_local.sessions (token_hash, business_id, staff_id, device_id, outlet_id, authority_epoch, expires_at)
  VALUES (p_token_hash, v_staff.business_id, p_staff_id, p_device_id, p_outlet_id, v_authority.authority_epoch, v_expires)
  RETURNING id INTO v_session_id;
  UPDATE bar_local.staff SET failed_login_attempts = 0, locked_until = NULL WHERE id = p_staff_id;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES (v_staff.business_id, p_outlet_id, p_staff_id, p_device_id, 'session.created', jsonb_build_object('session_id', v_session_id, 'expires_at', v_expires));
  RETURN jsonb_build_object('session_id', v_session_id, 'expires_at', v_expires, 'authority_epoch', v_authority.authority_epoch);
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_refresh_session(
  p_token_hash text,
  p_device_id uuid,
  p_new_token_hash text,
  p_ttl_seconds integer DEFAULT 43200
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
  v_expires timestamptz;
BEGIN
  IF p_new_token_hash IS NULL OR p_new_token_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A hashed replacement session token is required.');
  END IF;
  v_expires := now() + make_interval(secs => GREATEST(60, LEAST(p_ttl_seconds, 604800)));
  UPDATE bar_local.sessions
     SET token_hash = p_new_token_hash, expires_at = v_expires, last_seen_at = now()
   WHERE token_hash = p_token_hash AND device_id = p_device_id AND revoked_at IS NULL;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES (v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id, 'session.refreshed',
          jsonb_build_object('session_id', v_ctx.session_id, 'expires_at', v_expires));
  RETURN jsonb_build_object('expires_at', v_expires, 'authority_epoch', (SELECT authority_epoch FROM bar_local.authority WHERE singleton));
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_revoke_session(p_token_hash text, p_device_id uuid, p_target_session_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
  v_target bar_local.sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_target FROM bar_local.sessions WHERE id = p_target_session_id FOR UPDATE;
  IF NOT FOUND OR v_target.business_id <> v_ctx.business_id THEN
    PERFORM bar_local.raise_business('SESSION_INVALID', 'The session to revoke is outside this business scope.');
  END IF;
  IF v_target.staff_id <> v_ctx.staff_id AND NOT (v_ctx.capabilities @> ARRAY['staff.manage']) THEN
    PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'Only a staff manager can revoke another operator session.');
  END IF;
  UPDATE bar_local.sessions SET revoked_at = now() WHERE id = p_target_session_id;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES (v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id, 'session.revoked', jsonb_build_object('session_id', p_target_session_id));
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_create_pairing_code(
  p_token_hash text,
  p_device_id uuid,
  p_code_hash text,
  p_ttl_seconds integer DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
BEGIN
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
  INSERT INTO bar_local.pairing_codes (business_id, outlet_id, code_hash, created_by, expires_at)
  VALUES (v_ctx.business_id, v_ctx.outlet_id, p_code_hash, v_ctx.staff_id, now() + make_interval(secs => GREATEST(60, LEAST(p_ttl_seconds, 900))));
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES (v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id, 'device.pairing_started', '{}'::jsonb);
  RETURN jsonb_build_object('expires_in', GREATEST(60, LEAST(p_ttl_seconds, 900)));
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_complete_pairing(
  p_code_hash text,
  p_name text,
  p_platform text,
  p_device_token_hash text,
  p_certificate_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_code bar_local.pairing_codes%ROWTYPE;
  v_device_id uuid;
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
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, action, after)
  VALUES (v_code.business_id, v_code.outlet_id, v_code.created_by, 'device.paired',
          jsonb_build_object('device_id', v_device_id, 'platform', p_platform, 'fingerprint', p_certificate_fingerprint));
  RETURN jsonb_build_object('device_id', v_device_id, 'business_id', v_code.business_id, 'outlet_id', v_code.outlet_id);
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_revoke_device(
  p_token_hash text, p_device_id uuid, p_target_device_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
  v_target bar_local.devices%ROWTYPE;
BEGIN
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
  SELECT * INTO v_target FROM bar_local.devices WHERE id = p_target_device_id FOR UPDATE;
  IF NOT FOUND OR v_target.business_id <> v_ctx.business_id THEN
    PERFORM bar_local.raise_business('DEVICE_UNKNOWN', 'The device is outside this business scope.');
  END IF;
  UPDATE bar_local.devices SET status = 'revoked', revoked_at = now() WHERE id = p_target_device_id;
  UPDATE bar_local.sessions SET revoked_at = now() WHERE device_id = p_target_device_id AND revoked_at IS NULL;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES (v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id, 'device.revoked', jsonb_build_object('device_id', p_target_device_id));
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_create_approval(
  p_token_hash text,
  p_device_id uuid,
  p_approver_staff_id uuid,
  p_capability text,
  p_operation_hash text,
  p_target_type text,
  p_target_id uuid,
  p_ttl_seconds integer DEFAULT 300
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
  v_approver bar_local.staff%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_approver FROM bar_local.staff WHERE id = p_approver_staff_id FOR SHARE;
  IF NOT FOUND OR v_approver.status <> 'active' OR v_approver.business_id <> v_ctx.business_id THEN
    PERFORM bar_local.raise_business('APPROVAL_INVALID', 'The approving operator is unavailable.');
  END IF;
  IF v_approver.id <> v_ctx.staff_id THEN
    PERFORM bar_local.raise_business('MAKER_CHECKER_VIOLATION', 'An approval must be created from the approving operator''s own authenticated session.');
  END IF;
  PERFORM bar_local.assert_capability(v_approver.capabilities, p_capability);
  IF p_operation_hash IS NULL OR p_operation_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A canonical operation hash is required for approval.');
  END IF;
  INSERT INTO bar_local.approvals (business_id, outlet_id, approved_by, device_id, capability, operation_hash, target_type, target_id, expires_at)
  VALUES (v_ctx.business_id, v_ctx.outlet_id, p_approver_staff_id, p_device_id, p_capability, p_operation_hash, p_target_type, p_target_id,
          now() + make_interval(secs => GREATEST(30, LEAST(p_ttl_seconds, 600))))
  RETURNING id INTO v_id;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES (v_ctx.business_id, v_ctx.outlet_id, p_approver_staff_id, p_device_id, 'approval.created',
          jsonb_build_object('approval_id', v_id, 'capability', p_capability, 'target_type', p_target_type, 'target_id', p_target_id));
  RETURN jsonb_build_object('approval_id', v_id, 'expires_in', GREATEST(30, LEAST(p_ttl_seconds, 600)));
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_set_entitlement(
  p_token_hash text,
  p_device_id uuid,
  p_version bigint,
  p_features text[],
  p_key_id text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
  v_current bigint;
BEGIN
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'settings.manage');
  SELECT entitlement_version INTO v_current FROM bar_local.authority WHERE singleton FOR UPDATE;
  IF p_version < v_current THEN
    PERFORM bar_local.raise_business('ENTITLEMENT_VERSION_STALE', 'A newer signed entitlement is already installed.');
  END IF;
  UPDATE bar_local.authority
     SET entitlement_version = p_version, entitlement_features = p_features, export_key_id = COALESCE(p_key_id, export_key_id)
   WHERE singleton;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES (v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id, 'entitlement.updated',
          jsonb_build_object('version', p_version, 'features', p_features, 'key_id', p_key_id));
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_increment_epoch(
  p_token_hash text,
  p_device_id uuid,
  p_expected_epoch bigint
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
  v_epoch bigint;
BEGIN
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'settings.manage');
  UPDATE bar_local.authority
     SET authority_epoch = authority_epoch + 1
   WHERE singleton AND authority_epoch = p_expected_epoch
  RETURNING authority_epoch INTO v_epoch;
  IF v_epoch IS NULL THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY_EPOCH', 'The expected authority epoch no longer matches.');
  END IF;
  UPDATE bar_local.sessions SET revoked_at = now() WHERE revoked_at IS NULL;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES (v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id, 'authority.epoch_incremented', jsonb_build_object('epoch', v_epoch));
  RETURN jsonb_build_object('authority_epoch', v_epoch);
END;
$$;
