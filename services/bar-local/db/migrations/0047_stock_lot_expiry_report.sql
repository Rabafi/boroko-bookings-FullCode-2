-- Outlet-scoped lot and expiry visibility. These are receipt records, not
-- remaining lot balances: sales are not allocated to lots in the current model.
CREATE OR REPLACE FUNCTION bar_local.stock_lot_expiry_report(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_outlet uuid;
  v_data jsonb;
  v_watermark bigint;
  v_as_of text;
  v_today date;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.view');
  v_outlet := bar_local.query_outlet(v_ctx, COALESCE(p_filters, '{}'::jsonb));
  v_today := bar_local.current_business_date();
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.expires_on, x.name, x.lot_code, x.received_at), '[]'::jsonb)
    INTO v_data
    FROM (
      SELECT m.id AS movement_id, m.product_id, p.sku, p.name,
             m.lot_code, m.expires_on, m.delta AS received_quantity,
             m.unit_cost, m.reference AS supplier_reference, m.reason,
             m.business_date AS received_business_date, m.created_at AS received_at,
             CASE WHEN m.expires_on IS NULL THEN 'no_expiry'
                  WHEN m.expires_on < v_today THEN 'expired'
                  WHEN m.expires_on <= v_today + 30 THEN 'expiring_soon'
                  ELSE 'in_date' END AS expiry_status
        FROM bar_local.stock_movements m
        JOIN bar_local.products p ON p.id = m.product_id AND p.business_id = m.business_id
       WHERE m.business_id = v_ctx.business_id
         AND m.outlet_id = v_outlet
         AND m.delta > 0
         AND m.reason IN ('stock.receive', 'purchase.receive')
         AND (m.lot_code IS NOT NULL OR m.expires_on IS NOT NULL)
       ORDER BY m.expires_on NULLS LAST, p.name, m.lot_code, m.created_at
       LIMIT 500
    ) x;
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
    'snapshot_watermark', v_watermark,
    'scope', jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_outlet,
      'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id),
    'as_of', v_as_of, 'business_date', v_today, 'complete', true,
    'unavailable', '[]'::jsonb,
    'quantity_semantics', 'received_quantity_only; remaining on-hand by lot is not tracked'
  );
END;
$$;

ALTER FUNCTION bar_local.stock_lot_expiry_report(text, uuid, uuid, bigint, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.stock_lot_expiry_report(text, uuid, uuid, bigint, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.stock_lot_expiry_report(text, uuid, uuid, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.stock_lot_expiry_report(text, uuid, uuid, bigint, jsonb) TO bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) RENAME TO query_dispatch_lot_expiry_previous;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_query = 'stock.lot_expiry' THEN
    RETURN bar_local.stock_lot_expiry_report(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_filters);
  END IF;
  RETURN bar_local.query_dispatch_lot_expiry_previous(
    p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
  );
END;
$$;

ALTER FUNCTION bar_local.query_dispatch_lot_expiry_previous(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_lot_expiry_previous(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_lot_expiry_previous(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_lot_expiry_previous(text, uuid, uuid, bigint, text, jsonb) FROM bar_local_runtime;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
