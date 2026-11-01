-- Local Bar only: read the ledger-maintained current points balance for one
-- customer in the authenticated business. This read never authorises redemption.
CREATE OR REPLACE FUNCTION bar_local.query_loyalty_account_get(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_customer_id uuid;
  v_data jsonb;
  v_as_of text;
  v_watermark bigint;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'customers.manage');
  IF jsonb_typeof(COALESCE(p_filters, '{}'::jsonb)) <> 'object'
     OR NOT (COALESCE(p_filters, '{}'::jsonb) ? 'customer_id')
     OR (COALESCE(p_filters, '{}'::jsonb) - 'customer_id') <> '{}'::jsonb
     OR jsonb_typeof(COALESCE(p_filters, '{}'::jsonb)->'customer_id') <> 'string' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'loyalty.account.get requires only a customer_id.');
  END IF;
  BEGIN
    v_customer_id := (p_filters->>'customer_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'customer_id must be a valid UUID.');
  END;
  IF NOT EXISTS (
    SELECT 1 FROM bar_local.customers c
     WHERE c.id = v_customer_id AND c.business_id = v_ctx.business_id
  ) THEN
    PERFORM bar_local.raise_business('CUSTOMER_NOT_FOUND', 'The customer does not belong to this business.');
  END IF;
  SELECT bar_local.loyalty_account_json(a.id) INTO v_data
    FROM bar_local.loyalty_accounts a
   WHERE a.business_id = v_ctx.business_id AND a.customer_id = v_customer_id;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  RETURN jsonb_build_object(
    'data', v_data,
    'scope', jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
      'actor_staff_id', v_ctx.staff_id, 'device_id', v_ctx.device_id),
    'snapshot_watermark', COALESCE(v_watermark, 0),
    'as_of', v_as_of,
    'complete', true,
    'unavailable', '[]'::jsonb
  );
END;
$$;

ALTER FUNCTION bar_local.query_loyalty_account_get(text, uuid, uuid, bigint, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_loyalty_account_get(text, uuid, uuid, bigint, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_loyalty_account_get(text, uuid, uuid, bigint, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_loyalty_account_get(text, uuid, uuid, bigint, jsonb) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb)
  RENAME TO query_dispatch_before_loyalty_account_get;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_query = 'loyalty.account.get' THEN
    RETURN bar_local.query_loyalty_account_get(
      p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_filters
    );
  END IF;
  RETURN bar_local.query_dispatch_before_loyalty_account_get(
    p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
  );
END;
$$;

ALTER FUNCTION bar_local.query_dispatch_before_loyalty_account_get(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch_before_loyalty_account_get(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_before_loyalty_account_get(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_loyalty_account_get(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
