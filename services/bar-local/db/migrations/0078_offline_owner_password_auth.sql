-- Local-only owner email/password authentication. Never apply to hosted Supabase.
CREATE TABLE bar_local.owner_credentials (
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  staff_id uuid PRIMARY KEY REFERENCES bar_local.staff(id),
  email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 254),
  password_hash text NOT NULL CHECK (password_hash ~ '^[0-9a-f]{64}$'),
  password_salt text NOT NULL CHECK (password_salt ~ '^[0-9a-f]{64}$'),
  password_iterations integer NOT NULL CHECK (password_iterations BETWEEN 600000 AND 2000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, email)
);

REVOKE ALL ON TABLE bar_local.owner_credentials FROM PUBLIC, bar_local_runtime;

CREATE OR REPLACE FUNCTION bar_local.service_owner_credential(p_business_id uuid, p_email text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
  SELECT jsonb_build_object(
    'staff_id', c.staff_id, 'business_id', c.business_id, 'email', c.email,
    'password_hash', c.password_hash, 'password_salt', c.password_salt,
    'password_iterations', c.password_iterations,
    'display_name', s.display_name, 'role', s.role, 'capabilities', s.capabilities,
    'status', s.status, 'locked_until', s.locked_until
  )
  FROM bar_local.owner_credentials c
  JOIN bar_local.staff s ON s.id = c.staff_id AND s.business_id = c.business_id
  WHERE c.business_id = p_business_id AND c.email = lower(btrim(p_email)) AND s.role = 'owner';
$$;

CREATE OR REPLACE FUNCTION bar_local.service_owner_credential_by_staff(p_business_id uuid, p_staff_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
  SELECT jsonb_build_object(
    'staff_id', c.staff_id, 'business_id', c.business_id, 'email', c.email,
    'password_hash', c.password_hash, 'password_salt', c.password_salt,
    'password_iterations', c.password_iterations, 'locked_until', s.locked_until,
    'status', s.status, 'role', s.role
  )
  FROM bar_local.owner_credentials c
  JOIN bar_local.staff s ON s.id = c.staff_id AND s.business_id = c.business_id
  WHERE c.business_id = p_business_id AND c.staff_id = p_staff_id AND s.role = 'owner';
$$;

CREATE OR REPLACE FUNCTION bar_local.commission_owner_credentials_profile_recoverable(
  p_provisioning_id uuid, p_request_hash text, p_device_token_hash text,
  p_authority_id uuid, p_business_id uuid, p_outlet_id uuid,
  p_business_name text, p_outlet_name text, p_owner_name text,
  p_pin_hash text, p_pin_salt text, p_pin_iterations integer,
  p_setup_secret_hash text, p_currency text, p_timezone text,
  p_device_name text, p_device_platform text, p_device_certificate_fingerprint text,
  p_business_profile jsonb, p_owner_email text,
  p_password_hash text, p_password_salt text, p_password_iterations integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_result jsonb;
  v_staff_id uuid;
  v_business_id uuid;
  v_existing bar_local.owner_credentials%ROWTYPE;
BEGIN
  IF p_owner_email IS NULL OR p_owner_email <> lower(btrim(p_owner_email))
     OR length(p_owner_email) > 254 OR p_owner_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR p_password_hash !~ '^[0-9a-f]{64}$' OR p_password_salt !~ '^[0-9a-f]{64}$'
     OR p_password_iterations NOT BETWEEN 600000 AND 2000000 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A valid owner email and protected password verifier are required.');
  END IF;
  v_result := bar_local.commission_owner_profile_recoverable(
    p_provisioning_id, p_request_hash, p_device_token_hash,
    p_authority_id, p_business_id, p_outlet_id, p_business_name, p_outlet_name,
    p_owner_name, p_pin_hash, p_pin_salt, p_pin_iterations, p_setup_secret_hash,
    p_currency, p_timezone, p_device_name, p_device_platform,
    p_device_certificate_fingerprint, p_business_profile
  );
  v_staff_id := (v_result->>'owner_staff_id')::uuid;
  v_business_id := (v_result->>'business_id')::uuid;
  SELECT * INTO v_existing FROM bar_local.owner_credentials WHERE staff_id = v_staff_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.business_id <> v_business_id OR v_existing.email <> p_owner_email THEN
      PERFORM bar_local.raise_business('PROVISIONING_CONFLICT', 'The saved owner account does not match this setup attempt.');
    END IF;
  ELSE
    INSERT INTO bar_local.owner_credentials(business_id, staff_id, email, password_hash, password_salt, password_iterations)
    VALUES (v_business_id, v_staff_id, p_owner_email, p_password_hash, p_password_salt, p_password_iterations);
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_owner_password_change(
  p_session_token_hash text, p_device_id uuid, p_password_hash text,
  p_password_salt text, p_password_iterations integer, p_expected_password_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_session_token_hash, p_device_id);
  v_owner bar_local.staff%ROWTYPE;
  v_revoked integer;
BEGIN
  SELECT * INTO v_owner FROM bar_local.staff WHERE id = v_ctx.staff_id FOR UPDATE;
  v_ctx := bar_local.service_session(p_session_token_hash, p_device_id);
  IF v_owner.role <> 'owner' OR NOT (v_owner.capabilities @> ARRAY['staff.manage']) THEN
    PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'Only the signed-in Bar owner can change the owner password.');
  END IF;
  IF p_password_hash !~ '^[0-9a-f]{64}$' OR p_password_salt !~ '^[0-9a-f]{64}$'
     OR p_password_iterations NOT BETWEEN 600000 AND 2000000 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A valid protected password verifier is required.');
  END IF;
  UPDATE bar_local.owner_credentials SET password_hash = p_password_hash,
         password_salt = p_password_salt, password_iterations = p_password_iterations,
         updated_at = now()
   WHERE staff_id = v_ctx.staff_id AND business_id = v_ctx.business_id
     AND password_hash = p_expected_password_hash;
  IF NOT FOUND THEN PERFORM bar_local.raise_business('AUTH_INVALID', 'The owner credential is unavailable.'); END IF;
  UPDATE bar_local.sessions SET revoked_at = now()
   WHERE staff_id = v_ctx.staff_id AND business_id = v_ctx.business_id
     AND id <> v_ctx.session_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES (v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
          'owner.password_changed', jsonb_build_object('other_sessions_revoked', v_revoked));
  RETURN jsonb_build_object('outcome', 'password_changed', 'other_sessions_revoked', v_revoked);
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_owner_password_recover(
  p_setup_secret_hash text, p_owner_email text, p_password_hash text,
  p_password_salt text, p_password_iterations integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_setup bar_local.setup_state%ROWTYPE;
  v_owner bar_local.owner_credentials%ROWTYPE;
  v_outlet_id uuid;
  v_revoked integer;
BEGIN
  SELECT * INTO v_setup FROM bar_local.setup_state WHERE singleton FOR UPDATE;
  IF NOT FOUND OR v_setup.used_at IS NULL OR v_setup.secret_hash <> p_setup_secret_hash THEN
    PERFORM bar_local.raise_business('OWNER_RECOVERY_UNAVAILABLE', 'The local owner recovery credential is invalid. Use the main Bar computer and contact your administrator if recovery remains unavailable.');
  END IF;
  SELECT * INTO v_owner FROM bar_local.owner_credentials
   WHERE email = lower(btrim(p_owner_email));
  IF NOT FOUND THEN PERFORM bar_local.raise_business('OWNER_RECOVERY_UNAVAILABLE', 'The local owner recovery request could not be verified.'); END IF;
  PERFORM 1 FROM bar_local.staff WHERE id = v_owner.staff_id FOR UPDATE;
  PERFORM 1 FROM bar_local.owner_credentials WHERE staff_id = v_owner.staff_id FOR UPDATE;
  SELECT id INTO v_outlet_id FROM bar_local.outlets
   WHERE business_id = v_owner.business_id AND active
   ORDER BY created_at, id LIMIT 1;
  IF v_outlet_id IS NULL THEN PERFORM bar_local.raise_business('OWNER_RECOVERY_UNAVAILABLE', 'The local Bar outlet could not be verified for the recovery audit.'); END IF;
  IF p_password_hash !~ '^[0-9a-f]{64}$' OR p_password_salt !~ '^[0-9a-f]{64}$'
     OR p_password_iterations NOT BETWEEN 600000 AND 2000000 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A valid protected password verifier is required.');
  END IF;
  UPDATE bar_local.owner_credentials SET password_hash = p_password_hash,
         password_salt = p_password_salt, password_iterations = p_password_iterations,
         updated_at = now() WHERE staff_id = v_owner.staff_id;
  UPDATE bar_local.staff SET failed_login_attempts = 0, locked_until = NULL WHERE id = v_owner.staff_id;
  UPDATE bar_local.sessions SET revoked_at = now()
   WHERE staff_id = v_owner.staff_id AND business_id = v_owner.business_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked = ROW_COUNT;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, action, after)
  VALUES (v_owner.business_id, v_outlet_id, v_owner.staff_id, 'owner.password_recovered',
          jsonb_build_object('sessions_revoked', v_revoked, 'recovery_method', 'main_computer'));
  RETURN jsonb_build_object('outcome', 'password_recovered', 'sessions_revoked', v_revoked);
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_create_owner_session(
  p_staff_id uuid, p_device_id uuid, p_outlet_id uuid, p_token_hash text,
  p_ttl_seconds integer, p_expected_password_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE v_credential bar_local.owner_credentials%ROWTYPE;
BEGIN
  PERFORM 1 FROM bar_local.staff WHERE id = p_staff_id AND role = 'owner' FOR UPDATE;
  IF NOT FOUND THEN PERFORM bar_local.raise_business('AUTH_INVALID', 'The owner identity is unavailable.'); END IF;
  SELECT * INTO v_credential FROM bar_local.owner_credentials WHERE staff_id = p_staff_id FOR UPDATE;
  IF NOT FOUND OR v_credential.password_hash IS DISTINCT FROM p_expected_password_hash THEN
    PERFORM bar_local.raise_business('AUTH_INVALID', 'The owner password changed while signing in. Sign in again.');
  END IF;
  RETURN bar_local.service_create_session(p_staff_id, p_device_id, p_outlet_id, p_token_hash, p_ttl_seconds);
END;
$$;

REVOKE ALL ON FUNCTION bar_local.service_owner_credential(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.service_owner_credential_by_staff(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.commission_owner_credentials_profile_recoverable(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,text,text,jsonb,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.service_owner_password_change(text,uuid,text,text,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.service_create_owner_session(uuid,uuid,uuid,text,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.service_owner_password_recover(text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.service_owner_credential(uuid,text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.service_owner_credential_by_staff(uuid,uuid) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.commission_owner_credentials_profile_recoverable(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,text,text,jsonb,text,text,text,integer) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.service_owner_password_change(text,uuid,text,text,integer,text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.service_create_owner_session(uuid,uuid,uuid,text,integer,text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.service_owner_password_recover(text,text,text,text,integer) TO bar_local_runtime;

INSERT INTO bar_local.runtime_function_allowlist(function_name)
VALUES ('service_owner_credential'), ('service_owner_credential_by_staff'), ('commission_owner_credentials_profile_recoverable'),
       ('service_owner_password_change'), ('service_owner_password_recover'), ('service_create_owner_session')
ON CONFLICT (function_name) DO NOTHING;
