-- Local Bar only: expose the effective outlet loyalty programme to authorised
-- managers. Programme writes remain the version-checked atomic command.
CREATE OR REPLACE FUNCTION bar_local.query_loyalty_programs_list(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_data jsonb;
  v_as_of text;
  v_watermark bigint;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  IF NOT (v_ctx.capabilities @> ARRAY['accounting.manage'] OR v_ctx.capabilities @> ARRAY['settings.manage']) THEN
    PERFORM bar_local.raise_business('CAPABILITY_DENIED',
      'Loyalty programme details require the accounting.manage or settings.manage capability.');
  END IF;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'program_id', p.id,
    'name', p.name,
    'outlet_id', p.outlet_id,
    'earn_rate', p.earn_rate,
    'redeem_value', p.redeem_value,
    'min_redeem_points', p.min_redeem_points,
    'active', p.active,
    'version', p.version,
    'created_at', p.created_at,
    'updated_at', p.updated_at,
    'scope', CASE WHEN p.outlet_id IS NULL THEN 'business' ELSE 'outlet' END,
    'effective', p.active AND (p.outlet_id IS NULL OR p.outlet_id = v_ctx.outlet_id)
  ) ORDER BY (p.outlet_id IS NOT NULL), p.name), '[]'::jsonb)
    INTO v_data
    FROM bar_local.loyalty_programs p
   WHERE p.business_id = v_ctx.business_id
     AND (p.outlet_id IS NULL OR p.outlet_id = v_ctx.outlet_id);

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

ALTER FUNCTION bar_local.query_loyalty_programs_list(text, uuid, uuid, bigint) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_loyalty_programs_list(text, uuid, uuid, bigint) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_loyalty_programs_list(text, uuid, uuid, bigint) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_loyalty_programs_list(text, uuid, uuid, bigint) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb)
  RENAME TO query_dispatch_before_loyalty_programs_list;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_query = 'loyalty.programs.list' THEN
    IF jsonb_typeof(COALESCE(p_filters, '{}'::jsonb)) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_filters, '{}'::jsonb)) AS k(key)) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'loyalty.programs.list does not accept filters.');
    END IF;
    RETURN bar_local.query_loyalty_programs_list(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  END IF;
  RETURN bar_local.query_dispatch_before_loyalty_programs_list(
    p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
  );
END;
$$;

ALTER FUNCTION bar_local.query_dispatch_before_loyalty_programs_list(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch_before_loyalty_programs_list(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_before_loyalty_programs_list(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_loyalty_programs_list(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
