-- Cashiers may read only promotions active for the authority's business date.
-- The command still revalidates every condition atomically at commit time.
CREATE OR REPLACE FUNCTION bar_local.query_cashier_promotions(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_data jsonb;
  v_discount_policy jsonb;
  v_watermark bigint;
  v_business_date date;
  v_scope jsonb;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.view');
  v_business_date := bar_local.current_business_date();
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'promotion_id', p.id, 'code', p.code, 'name', p.name,
    'discount_type', p.discount_type, 'percent', p.percent::text,
    'amount', to_char(p.amount, 'FM999999999999990.00'),
    'minimum_subtotal', to_char(p.minimum_subtotal, 'FM999999999999990.00'),
    'scope', p.scope, 'product_id', p.product_id, 'category', p.category,
    'starts_on', p.starts_on, 'ends_on', p.ends_on, 'version', p.version
  ) ORDER BY p.code, p.id), '[]'::jsonb)
  INTO v_data
  FROM bar_local.promotions p
  WHERE p.business_id = v_ctx.business_id AND p.active
    AND (p.starts_on IS NULL OR p.starts_on <= v_business_date)
    AND (p.ends_on IS NULL OR p.ends_on >= v_business_date);

  SELECT jsonb_build_object(
    'approval_threshold_percent', COALESCE((SELECT value #>> '{}' FROM bar_local.settings WHERE key = 'discount_approval_threshold_percent'), '10'),
    'maximum_percent', COALESCE((SELECT value #>> '{}' FROM bar_local.settings WHERE key = 'discount_max_percent'), '25')
  ) INTO v_discount_policy;

  RETURN jsonb_build_object('data', jsonb_build_object('promotions', v_data, 'discount_policy', v_discount_policy), 'complete', true, 'unavailable', '[]'::jsonb,
    'snapshot_watermark', v_watermark, 'scope', v_scope,
    'as_of', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;

ALTER FUNCTION bar_local.query_cashier_promotions(text, uuid, uuid, bigint) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_cashier_promotions(text, uuid, uuid, bigint) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_cashier_promotions(text, uuid, uuid, bigint) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_cashier_promotions(text, uuid, uuid, bigint) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb)
  RENAME TO query_dispatch_before_cashier_promotions;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_query = 'menu.promotions' THEN
    IF COALESCE(p_filters, '{}'::jsonb) <> '{}'::jsonb THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Cashier promotion query does not accept caller filters.');
    END IF;
    RETURN bar_local.query_cashier_promotions(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  END IF;
  RETURN bar_local.query_dispatch_before_cashier_promotions(
    p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
  );
END;
$$;

ALTER FUNCTION bar_local.query_dispatch_before_cashier_promotions(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_before_cashier_promotions(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_cashier_promotions(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC, bar_local_runtime;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
