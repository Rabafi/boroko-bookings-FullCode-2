-- Local-only owner contact profile entered during first Bar setup.
-- Never apply this migration to hosted Supabase.
ALTER TABLE bar_local.business
  ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;

REVOKE ALL ON FUNCTION bar_local.commission_owner_recoverable(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,text,text) FROM bar_local_runtime;
DELETE FROM bar_local.runtime_function_allowlist WHERE function_name = 'commission_owner_recoverable';

CREATE OR REPLACE FUNCTION bar_local.commission_owner_profile_recoverable(
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
  p_currency text,
  p_timezone text,
  p_device_name text,
  p_device_platform text,
  p_device_certificate_fingerprint text,
  p_business_profile jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_result jsonb;
  v_intent bar_local.provisioning_intents%ROWTYPE;
  v_key text;
  v_value text;
  v_max_length integer;
  v_raw_value jsonb;
BEGIN
  IF p_provisioning_id IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$'
     OR p_device_token_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A stable provisioning identifier and protected device credential are required.');
  END IF;
  IF jsonb_typeof(p_business_profile) IS DISTINCT FROM 'object' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The Bar contact details must be an object.');
  END IF;
  FOR v_key, v_raw_value IN SELECT key, value FROM jsonb_each(p_business_profile) LOOP
    v_value := v_raw_value #>> '{}';
    v_max_length := CASE v_key
      WHEN 'company_name' THEN 200 WHEN 'address' THEN 240 WHEN 'city' THEN 120
      WHEN 'country' THEN 120 WHEN 'phone' THEN 80 WHEN 'email' THEN 254
      WHEN 'website' THEN 240 WHEN 'vat_number' THEN 80 ELSE 0 END;
    IF jsonb_typeof(v_raw_value) <> 'string'
       OR v_key NOT IN ('company_name','address','city','country','phone','email','website','vat_number')
       OR length(v_value) > v_max_length THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A Bar contact field is unsupported or too long.');
    END IF;
  END LOOP;
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
  v_result := bar_local.commission_owner_recoverable(
    p_provisioning_id, p_request_hash, p_device_token_hash, p_authority_id, p_business_id,
    p_outlet_id, p_business_name, p_outlet_name, p_owner_name, p_pin_hash, p_pin_salt,
    p_pin_iterations, p_setup_secret_hash, p_currency, p_timezone, p_device_name,
    p_device_platform, p_device_certificate_fingerprint
  );
  UPDATE bar_local.business SET profile = p_business_profile
   WHERE id = (v_result->>'business_id')::uuid;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, after)
  VALUES ((v_result->>'business_id')::uuid, (v_result->>'outlet_id')::uuid,
          (v_result->>'owner_staff_id')::uuid, NULL, 'business.profile_saved', p_business_profile);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION bar_local.commission_owner_profile_recoverable(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.commission_owner_profile_recoverable(uuid,text,text,uuid,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,text,text,jsonb) TO bar_local_runtime;
INSERT INTO bar_local.runtime_function_allowlist (function_name)
VALUES ('commission_owner_profile_recoverable')
ON CONFLICT (function_name) DO NOTHING;
