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
  v_limit integer;
  v_more boolean := false;
  v_next text;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.view');
  v_outlet := bar_local.query_outlet(v_ctx, COALESCE(p_filters, '{}'::jsonb));
  v_today := bar_local.current_business_date();
  v_limit := bar_local.query_limit(p_filters, 200, 200);
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.movement_id), '[]'::jsonb)
    INTO v_data
    FROM (
      SELECT m.id AS movement_id, m.product_id, p.sku, p.name,
             m.lot_code, m.expires_on, m.delta::text AS received_quantity,
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
         AND (p_filters->>'cursor' IS NULL OR m.id::text > p_filters->>'cursor')
       ORDER BY m.id LIMIT v_limit + 1
    ) x;
  IF jsonb_array_length(v_data) > v_limit THEN
    v_data := v_data - v_limit;
    v_more := true;
    v_next := v_data->-1->>'movement_id';
  END IF;
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_more),
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
REVOKE ALL ON FUNCTION bar_local.stock_lot_expiry_report(text, uuid, uuid, bigint, jsonb) FROM bar_local_runtime;

-- Match cursor and ordering keys: name ordering with an ID cursor skips rows.
CREATE OR REPLACE FUNCTION bar_local.query_stock_list_complete(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_outlet uuid;
  v_data jsonb;
  v_limit integer;
  v_more boolean := false;
  v_next text;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.view');
  v_outlet := bar_local.query_outlet(v_ctx, p_filters);
  v_limit := bar_local.query_limit(p_filters);
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.product_id), '[]'::jsonb) INTO v_data
    FROM (SELECT p.id AS product_id, p.sku, p.name, p.category, p.track_stock, p.active,
                 COALESCE(sb.quantity, 0)::text AS quantity, COALESCE(sb.version, 0) AS version, sb.updated_at
            FROM bar_local.products p
            LEFT JOIN bar_local.stock_balances sb ON sb.product_id = p.id
              AND sb.business_id = p.business_id AND sb.outlet_id = v_outlet
           WHERE p.business_id = v_ctx.business_id
             AND (NOT COALESCE((p_filters->>'low_only')::boolean, false) OR (p.track_stock AND COALESCE(sb.quantity, 0) <= 0))
             AND (p_filters->>'cursor' IS NULL OR p.id::text > p_filters->>'cursor')
           ORDER BY p.id LIMIT v_limit + 1) x;
  IF jsonb_array_length(v_data) > v_limit THEN
    v_data := v_data - v_limit;
    v_more := true;
    v_next := v_data->-1->>'product_id';
  END IF;
  RETURN jsonb_build_object('data', v_data,
    'pagination', jsonb_build_object('has_more', v_more, 'next_cursor', v_next),
    'snapshot_watermark', (SELECT commit_sequence FROM bar_local.authority_counter WHERE singleton),
    'scope', jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_outlet,
      'device_id', v_ctx.device_id, 'actor_staff_id', v_ctx.staff_id),
    'as_of', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'complete', true, 'unavailable', '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_stock_list_complete(text, uuid, uuid, bigint, jsonb) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) RENAME TO query_dispatch_before_complete_stock;
CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint, p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
BEGIN
  IF p_query = 'stock.list' THEN
    RETURN bar_local.query_stock_list_complete(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_filters);
  END IF;
  RETURN bar_local.query_dispatch_before_complete_stock(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters);
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_complete_stock(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;

