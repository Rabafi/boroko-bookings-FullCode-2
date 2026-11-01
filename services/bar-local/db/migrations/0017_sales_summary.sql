-- Additive sales reporting. Signed return and void rows keep totals reconcilable
-- without rewriting the original sale.

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) RENAME TO query_dispatch_chart;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_query text,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb;
  v_from date;
  v_to date;
  v_shift_id uuid;
  v_data jsonb;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
BEGIN
  IF p_query IS NULL OR p_query IS DISTINCT FROM 'reports.sales_summary' THEN
    RETURN bar_local.query_dispatch_chart(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters);
  END IF;
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.reports');
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  v_from := COALESCE((v_filters->>'from')::date, bar_local.current_business_date());
  v_to := COALESCE((v_filters->>'to')::date, v_from);
  IF v_to < v_from THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The report end date cannot be before its start date.');
  END IF;
  v_shift_id := NULLIF(v_filters->>'shift_id', '')::uuid;
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id);

  WITH scoped AS (
    SELECT s.*, original.status AS original_status
      FROM bar_local.sales s
      LEFT JOIN bar_local.sales original ON original.id = s.original_sale_id
     WHERE s.business_id = v_ctx.business_id
       AND s.outlet_id = v_ctx.outlet_id
       AND s.business_date BETWEEN v_from AND v_to
       AND (v_shift_id IS NULL OR s.shift_id = v_shift_id)
  ), totals_base AS (
    SELECT
      COALESCE(sum(total) FILTER (WHERE original_sale_id IS NULL), 0) AS gross_sales,
      COALESCE(-sum(total) FILTER (WHERE original_sale_id IS NOT NULL AND original_status <> 'voided'), 0) AS returns,
      COALESCE(-sum(total) FILTER (WHERE original_sale_id IS NOT NULL AND original_status = 'voided'), 0) AS voids,
      COALESCE(sum(total), 0) AS net_sales,
      COALESCE(sum(discount), 0) AS discounts,
      COALESCE(sum(tax), 0) AS tax,
      COALESCE(sum(tip), 0) AS tips,
      count(*) FILTER (WHERE original_sale_id IS NULL AND status <> 'voided') AS sale_count
      FROM scoped
  ), totals AS (
    SELECT gross_sales, returns, voids, net_sales, discounts, tax, tips, sale_count,
           round(net_sales / NULLIF(sale_count, 0), 2) AS average_sale
      FROM totals_base
  ), days AS (
    SELECT business_date,
           COALESCE(sum(total) FILTER (WHERE original_sale_id IS NULL), 0) AS gross_sales,
           COALESCE(-sum(total) FILTER (WHERE original_sale_id IS NOT NULL AND original_status <> 'voided'), 0) AS returns,
           COALESCE(-sum(total) FILTER (WHERE original_sale_id IS NOT NULL AND original_status = 'voided'), 0) AS voids,
           COALESCE(sum(total), 0) AS net_sales,
           count(*) FILTER (WHERE original_sale_id IS NULL AND status <> 'voided') AS sale_count
      FROM scoped
     GROUP BY business_date
  ), tenders AS (
    SELECT t.method, COALESCE(sum(t.amount), 0) AS amount, count(*) FILTER (WHERE t.amount > 0) AS entry_count
      FROM scoped s
      JOIN bar_local.sale_tenders t ON t.sale_id = s.id
     GROUP BY t.method
  ), products AS (
    SELECT l.product_id, l.name_snapshot AS name, l.sku_snapshot AS sku,
           COALESCE(sum(l.quantity), 0) AS quantity,
           COALESCE(sum(l.line_total), 0) AS net_sales
      FROM scoped s
      JOIN bar_local.sale_lines l ON l.sale_id = s.id
     GROUP BY l.product_id, l.name_snapshot, l.sku_snapshot
  ), categories AS (
    SELECT p.category, COALESCE(sum(l.quantity), 0) AS quantity,
           COALESCE(sum(l.line_total), 0) AS net_sales
      FROM scoped s
      JOIN bar_local.sale_lines l ON l.sale_id = s.id
      JOIN bar_local.products p ON p.id = l.product_id
     GROUP BY p.category
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'totals', (SELECT to_jsonb(t) FROM totals t),
    'by_day', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.business_date) FROM days d), '[]'::jsonb),
    'by_tender', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.amount DESC, t.method) FROM tenders t), '[]'::jsonb),
    'by_product', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.net_sales DESC, p.name) FROM products p), '[]'::jsonb),
    'by_category', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.net_sales DESC, c.category) FROM categories c), '[]'::jsonb)
  ) INTO v_data;

  RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
    'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);
END;
$$;

ALTER FUNCTION bar_local.query_dispatch_chart(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_chart(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_chart(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_chart(text, uuid, uuid, bigint, text, jsonb) FROM bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
