-- Recover lost commissioning/pairing replies without allowing takeover or
-- returning a credential to a caller who only knows an intent identifier.
CREATE TABLE bar_local.provisioning_intents (
  provisioning_id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('owner', 'pairing')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  credential_hash text NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE bar_local.provisioning_intents FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.provisioning_intents FROM bar_local_runtime;

CREATE OR REPLACE FUNCTION bar_local.commission_owner_recoverable(
  p_provisioning_id uuid,
  p_request_hash text,
  p_device_token_hash text,
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
  p_device_certificate_fingerprint text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_intent bar_local.provisioning_intents%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_provisioning_id IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_device_token_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A stable provisioning identifier and protected device credential are required.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provisioning_id::text, 0));
  SELECT * INTO v_intent FROM bar_local.provisioning_intents
   WHERE provisioning_id = p_provisioning_id FOR UPDATE;
  IF FOUND THEN
    IF v_intent.kind <> 'owner' OR v_intent.request_hash <> p_request_hash
       OR v_intent.credential_hash <> p_device_token_hash THEN
      PERFORM bar_local.raise_business('PROVISIONING_CONFLICT', 'This setup attempt is already bound to different details or device proof.');
    END IF;
    RETURN v_intent.result;
  END IF;
  -- The existing owner function remains the single atomic authority creator
  -- and retains its one-owner fence. Its result and the replay binding commit
  -- in this same transaction.
  v_result := bar_local.commission_owner(
    p_authority_id, p_business_id, p_outlet_id, p_business_name, p_outlet_name,
    p_owner_name, p_pin_hash, p_pin_salt, p_pin_iterations, p_setup_secret_hash,
    p_currency, p_timezone, p_device_name, p_device_platform,
    p_device_certificate_fingerprint, p_device_token_hash
  );
  INSERT INTO bar_local.provisioning_intents
    (provisioning_id, kind, request_hash, credential_hash, result)
  VALUES (p_provisioning_id, 'owner', p_request_hash, p_device_token_hash, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_complete_pairing_recoverable(
  p_provisioning_id uuid,
  p_request_hash text,
  p_device_token_hash text,
  p_code_hash text,
  p_name text,
  p_platform text,
  p_certificate_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_intent bar_local.provisioning_intents%ROWTYPE;
  v_result jsonb;
BEGIN
  IF p_provisioning_id IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_device_token_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A stable provisioning identifier and protected device credential are required.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provisioning_id::text, 0));
  SELECT * INTO v_intent FROM bar_local.provisioning_intents
   WHERE provisioning_id = p_provisioning_id FOR UPDATE;
  IF FOUND THEN
    IF v_intent.kind <> 'pairing' OR v_intent.request_hash <> p_request_hash
       OR v_intent.credential_hash <> p_device_token_hash THEN
      PERFORM bar_local.raise_business('PROVISIONING_CONFLICT', 'This pairing attempt is already bound to different details or device proof.');
    END IF;
    RETURN v_intent.result;
  END IF;
  v_result := bar_local.service_complete_pairing(
    p_code_hash, p_name, p_platform, p_device_token_hash, p_certificate_fingerprint
  );
  v_result := v_result || (
    SELECT jsonb_build_object('authority_id', authority_id, 'authority_epoch', authority_epoch)
      FROM bar_local.authority WHERE singleton
  );
  INSERT INTO bar_local.provisioning_intents
    (provisioning_id, kind, request_hash, credential_hash, result)
  VALUES (p_provisioning_id, 'pairing', p_request_hash, p_device_token_hash, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION bar_local.commission_owner_recoverable(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.commission_owner_recoverable(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,text,text) TO bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.service_complete_pairing_recoverable(uuid,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.service_complete_pairing_recoverable(uuid,text,text,text,text,text,text) TO bar_local_runtime;

INSERT INTO bar_local.runtime_function_allowlist (function_name)
VALUES ('commission_owner_recoverable'), ('service_complete_pairing_recoverable')
ON CONFLICT (function_name) DO NOTHING;
