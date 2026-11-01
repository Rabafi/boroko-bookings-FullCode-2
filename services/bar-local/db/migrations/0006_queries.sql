-- Scoped read model. All queries are allowlisted, session-authenticated and
-- capability/scope-checked in the database. Clients never receive table cursors.
CREATE OR REPLACE FUNCTION bar_local.query_session(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint
) RETURNS bar_local.session_context LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_authority bar_local.authority%ROWTYPE;
  v_ctx bar_local.session_context;
BEGIN
  SELECT * INTO v_authority FROM bar_local.authority WHERE singleton;
  IF NOT FOUND OR v_authority.commissioned_at IS NULL THEN
    PERFORM bar_local.raise_business('AUTHORITY_NOT_COMMISSIONED', 'The local Bar authority has not been commissioned.');
  END IF;
  IF v_authority.authority_id <> p_authority_id THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY', 'This query targets a different local authority.');
  END IF;
  IF v_authority.authority_epoch <> p_authority_epoch THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY_EPOCH', 'This query targets an expired local authority epoch.');
  END IF;
  v_ctx := bar_local.service_session(p_token_hash, p_device_id);
  IF v_ctx.business_id <> v_authority.business_id THEN
    PERFORM bar_local.raise_business('TENANT_SCOPE_MISMATCH', 'The session does not belong to this local authority business.');
  END IF;
  RETURN v_ctx;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.query_outlet(
  p_ctx bar_local.session_context,
  p_filters jsonb
) RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_outlet uuid := NULLIF(p_filters->>'outlet_id', '')::uuid;
BEGIN
  IF v_outlet IS NULL THEN
    RETURN p_ctx.outlet_id;
  END IF;
  IF v_outlet <> p_ctx.outlet_id THEN
    PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'The requested outlet is outside the authenticated session scope.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bar_local.outlets WHERE id = v_outlet AND business_id = p_ctx.business_id AND active) THEN
    PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'The requested outlet is not active on this local authority.');
  END IF;
  RETURN v_outlet;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.query_limit(p_filters jsonb, p_default integer DEFAULT 50, p_max integer DEFAULT 200)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(GREATEST(COALESCE(NULLIF(p_filters->>'limit', '')::integer, p_default), 1), p_max);
$$;

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
  v_outlet uuid;
  v_limit integer;
  v_data jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next text;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
  v_filters jsonb;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
                                'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role,
                                'device_id', v_ctx.device_id);

  IF p_query = 'bootstrap' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.view');
    v_data := jsonb_build_object(
      'authority', (SELECT jsonb_build_object(
          'authority_id', a.authority_id, 'authority_epoch', a.authority_epoch,
          'business_id', a.business_id, 'catalogue_version', a.catalogue_version,
          'entitlement_version', a.entitlement_version, 'entitlement_features', a.entitlement_features,
          'export_key_id', a.export_key_id)
        FROM bar_local.authority a WHERE a.singleton),
      'business', (SELECT jsonb_build_object('id', b.id, 'name', b.name, 'currency', b.currency, 'timezone', b.timezone)
        FROM bar_local.business b WHERE b.id = v_ctx.business_id),
      'outlet', (SELECT jsonb_build_object('id', o.id, 'name', o.name, 'code', o.code)
        FROM bar_local.outlets o WHERE o.id = v_ctx.outlet_id),
      'outlets', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'code', o.code) ORDER BY o.code), '[]'::jsonb)
        FROM bar_local.outlets o WHERE o.business_id = v_ctx.business_id AND o.active),
      'operator', jsonb_build_object('staff_id', v_ctx.staff_id, 'display_name', v_ctx.display_name,
                                     'role', v_ctx.role, 'capabilities', v_ctx.capabilities),
      'settings', (SELECT COALESCE(jsonb_object_agg(s.key, jsonb_build_object('value', s.value, 'version', s.version)), '{}'::jsonb)
        FROM bar_local.settings s),
      'current_shift', (SELECT jsonb_build_object('shift_id', sh.id, 'status', sh.status, 'business_date', sh.business_date,
                                                  'opening_float', sh.opening_float, 'version', sh.version, 'opened_at', sh.opened_at)
        FROM bar_local.shifts sh
        WHERE sh.business_id = v_ctx.business_id AND sh.outlet_id = v_ctx.outlet_id
          AND sh.staff_id = v_ctx.staff_id AND sh.status = 'open'),
      'open_tabs', (SELECT count(*) FROM bar_local.tabs t
        WHERE t.business_id = v_ctx.business_id AND t.outlet_id = v_ctx.outlet_id AND t.status = 'open'),
      'server_version', '1.0.0'
    );
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'menu.list' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.view');
    v_outlet := v_ctx.outlet_id;
    v_limit := bar_local.query_limit(v_filters);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.sku), '[]'::jsonb) INTO v_data
      FROM (SELECT p.id AS product_id, p.sku, p.name, p.category, p.price, p.tax_rate, p.track_stock, p.active,
                   p.version, COALESCE(sb.quantity, 0) AS stock_quantity
              FROM bar_local.products p
              LEFT JOIN bar_local.stock_balances sb
                ON sb.product_id = p.id AND sb.business_id = p.business_id AND sb.outlet_id = v_outlet
             WHERE p.business_id = v_ctx.business_id
               AND (COALESCE((v_filters->>'include_inactive')::boolean, false) OR p.active)
               AND (v_filters->>'cursor' IS NULL OR p.sku > v_filters->>'cursor')
             ORDER BY p.sku LIMIT v_limit + 1) x;
    v_data := COALESCE(v_data, '[]'::jsonb);
    IF jsonb_array_length(v_data) > v_limit THEN
      v_data := v_data - v_limit;
      v_has_more := true;
      v_next := v_data->-1->>'sku';
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'tabs.list' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.view');
    v_outlet := bar_local.query_outlet(v_ctx, v_filters);
    v_limit := bar_local.query_limit(v_filters);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_data
      FROM (SELECT t.id AS tab_id, t.table_label, t.owner_staff_id, st.display_name AS owner_name,
                   t.status, t.version, t.opened_at, t.note,
                   (SELECT count(*) FROM bar_local.tab_lines l WHERE l.tab_id = t.id AND l.status = 'open') AS line_count,
                   (SELECT COALESCE(round(sum(l.line_subtotal + l.line_tax), 2), 0)
                      FROM bar_local.tab_lines l WHERE l.tab_id = t.id AND l.status = 'open') AS gross_total
              FROM bar_local.tabs t JOIN bar_local.staff st ON st.id = t.owner_staff_id
             WHERE t.business_id = v_ctx.business_id AND t.outlet_id = v_outlet
               AND (v_filters->>'status' IS NULL OR t.status = v_filters->>'status')
               AND (v_filters->>'cursor' IS NULL OR t.id::text > v_filters->>'cursor')
             ORDER BY t.opened_at, t.id LIMIT v_limit + 1) x;
    IF jsonb_array_length(v_data) > v_limit THEN
      v_data := v_data - v_limit;
      v_has_more := true;
      v_next := v_data->-1->>'tab_id';
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'tab.get' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.view');
    v_data := (SELECT jsonb_build_object(
      'tab_id', t.id, 'table_label', t.table_label, 'owner_staff_id', t.owner_staff_id,
      'status', t.status, 'version', t.version, 'opened_at', t.opened_at, 'closed_at', t.closed_at,
      'settled_sale_id', t.settled_sale_id, 'note', t.note,
      'lines', COALESCE((SELECT jsonb_agg(row_to_json(l)::jsonb ORDER BY l.line_number) FROM (
          SELECT tl.id AS tab_line_id, tl.line_number, tl.product_id, tl.name_snapshot AS name, tl.sku_snapshot AS sku,
                 tl.quantity, tl.unit_price, tl.tax_rate, tl.line_subtotal, tl.line_tax, tl.line_total, tl.notes, tl.status
            FROM bar_local.tab_lines tl WHERE tl.tab_id = t.id) l), '[]'::jsonb),
      'gross_total', COALESCE((SELECT round(sum(tl.line_subtotal + tl.line_tax), 2) FROM bar_local.tab_lines tl
                                WHERE tl.tab_id = t.id AND tl.status = 'open'), 0)
    ) FROM bar_local.tabs t
     WHERE t.id = NULLIF(v_filters->>'tab_id', '')::uuid
       AND t.business_id = v_ctx.business_id AND t.outlet_id = v_ctx.outlet_id);
    IF v_data IS NULL THEN
      PERFORM bar_local.raise_business('TAB_NOT_FOUND', 'The tab could not be found in this outlet.');
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'sales.list' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.reports');
    v_outlet := bar_local.query_outlet(v_ctx, v_filters);
    v_limit := bar_local.query_limit(v_filters);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_data
      FROM (SELECT s.id AS sale_id, s.receipt_number, s.receipt_series, s.business_date, s.status, s.subtotal,
                   s.discount, s.tax, s.tip, s.total, s.created_at, s.original_sale_id, s.actor_staff_id,
                   (SELECT COALESCE(jsonb_agg(jsonb_build_object('method', t.method, 'amount', t.amount)), '[]'::jsonb)
                      FROM bar_local.sale_tenders t WHERE t.sale_id = s.id) AS tenders
              FROM bar_local.sales s
             WHERE s.business_id = v_ctx.business_id AND s.outlet_id = v_outlet
               AND s.business_date >= COALESCE(NULLIF(v_filters->>'from', '')::date, bar_local.current_business_date() - 6)
               AND s.business_date <= COALESCE(NULLIF(v_filters->>'to', '')::date, bar_local.current_business_date())
               AND (v_filters->>'cursor' IS NULL OR s.receipt_number < (v_filters->>'cursor')::bigint)
             ORDER BY s.business_date DESC, s.receipt_number DESC LIMIT v_limit + 1) x;
    IF jsonb_array_length(v_data) > v_limit THEN
      v_data := v_data - v_limit;
      v_has_more := true;
      v_next := v_data->-1->>'receipt_number';
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'sale.get' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.view');
    IF NULLIF(v_filters->>'sale_id', '') IS NOT NULL THEN
      v_data := bar_local.build_receipt((v_filters->>'sale_id')::uuid);
    ELSE
      SELECT bar_local.build_receipt(s.id) INTO v_data FROM bar_local.sales s
       WHERE s.business_id = v_ctx.business_id AND s.outlet_id = v_ctx.outlet_id
         AND s.receipt_series = COALESCE(v_filters->>'receipt_series', (SELECT value #>> '{}' FROM bar_local.settings WHERE key = 'receipt_series'))
         AND s.receipt_number = NULLIF(v_filters->>'receipt_number', '')::bigint;
    END IF;
    IF v_data IS NULL THEN
      PERFORM bar_local.raise_business('SALE_NOT_FOUND', 'The sale could not be found in this outlet.');
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'shift.current' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.view');
    v_outlet := bar_local.query_outlet(v_ctx, v_filters);
    v_data := (SELECT jsonb_build_object('shift_id', sh.id, 'staff_id', sh.staff_id, 'status', sh.status,
                  'business_date', sh.business_date, 'opening_float', sh.opening_float, 'expected_cash', sh.expected_cash,
                  'counted_cash', sh.counted_cash, 'opened_at', sh.opened_at, 'closed_at', sh.closed_at, 'version', sh.version)
      FROM bar_local.shifts sh
      WHERE sh.business_id = v_ctx.business_id AND sh.outlet_id = v_outlet
        AND sh.staff_id = v_ctx.staff_id AND sh.status = 'open');
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'cashup.summary' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.cashup');
    v_outlet := bar_local.query_outlet(v_ctx, v_filters);
    v_data := (SELECT jsonb_build_object(
        'shift_id', sh.id, 'status', sh.status, 'business_date', sh.business_date, 'opening_float', sh.opening_float,
        'expected_cash', bar_local.expected_shift_cash(sh.id),
        'cash_sales', COALESCE((SELECT round(sum(st.amount), 2) FROM bar_local.sale_tenders st
            JOIN bar_local.sales sa ON sa.id = st.sale_id
           WHERE sa.shift_id = sh.id AND sa.status IN ('completed','returned') AND st.method = 'cash'), 0),
        'card_sales', COALESCE((SELECT round(sum(st.amount), 2) FROM bar_local.sale_tenders st
            JOIN bar_local.sales sa ON sa.id = st.sale_id
           WHERE sa.shift_id = sh.id AND sa.status IN ('completed','returned') AND st.method = 'card'), 0),
        'cash_movements', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', cm.type, 'amount', cm.amount, 'reason', cm.reason, 'created_at', cm.created_at))
            FROM bar_local.cash_movements cm WHERE cm.shift_id = sh.id), '[]'::jsonb),
        'cashup', (SELECT jsonb_build_object('cashup_id', c.id, 'counted_cash', c.counted_cash, 'expected_cash', c.expected_cash,
            'variance', c.variance, 'counted_card', c.counted_card, 'status', c.status, 'notes', c.notes)
          FROM bar_local.cashups c WHERE c.shift_id = sh.id))
      FROM bar_local.shifts sh
      WHERE sh.id = COALESCE(NULLIF(v_filters->>'shift_id', '')::uuid,
                             (SELECT s2.id FROM bar_local.shifts s2 WHERE s2.business_id = v_ctx.business_id
                               AND s2.outlet_id = v_outlet AND s2.status = 'open' ORDER BY s2.opened_at DESC LIMIT 1))
        AND sh.business_id = v_ctx.business_id AND sh.outlet_id = v_outlet);
    IF v_data IS NULL THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'No shift matches this cash-up summary in the outlet.');
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'stock.list' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.view');
    v_outlet := bar_local.query_outlet(v_ctx, v_filters);
    v_limit := bar_local.query_limit(v_filters);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.name, x.product_id), '[]'::jsonb) INTO v_data
      FROM (SELECT p.id AS product_id, p.sku, p.name, p.category, p.track_stock, p.active,
                   COALESCE(sb.quantity, 0) AS quantity, COALESCE(sb.version, 0) AS version, sb.updated_at
              FROM bar_local.products p
              LEFT JOIN bar_local.stock_balances sb
                ON sb.product_id = p.id AND sb.business_id = p.business_id AND sb.outlet_id = v_outlet
             WHERE p.business_id = v_ctx.business_id
               AND (NOT COALESCE((v_filters->>'low_only')::boolean, false) OR (p.track_stock AND COALESCE(sb.quantity, 0) <= 0))
               AND (v_filters->>'cursor' IS NULL OR p.id::text > v_filters->>'cursor')
             ORDER BY p.name, p.id LIMIT v_limit + 1) x;
    IF jsonb_array_length(v_data) > v_limit THEN
      v_data := v_data - v_limit;
      v_has_more := true;
      v_next := v_data->-1->>'product_id';
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'customers.list' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'customers.manage');
    v_limit := bar_local.query_limit(v_filters);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.name, x.customer_id), '[]'::jsonb) INTO v_data
      FROM (SELECT c.id AS customer_id, c.name, c.phone, c.email, c.credit_limit, c.status,
                   COALESCE((SELECT round(sum(cl.delta), 2) FROM bar_local.credit_ledger cl WHERE cl.customer_id = c.id), 0) AS outstanding
              FROM bar_local.customers c
             WHERE c.business_id = v_ctx.business_id
               AND (v_filters->>'search' IS NULL OR c.name ILIKE '%' || v_filters->>'search' || '%'
                    OR COALESCE(c.phone, '') ILIKE '%' || v_filters->>'search' || '%')
               AND (v_filters->>'cursor' IS NULL OR c.id::text > v_filters->>'cursor')
             ORDER BY c.name, c.id LIMIT v_limit + 1) x;
    IF jsonb_array_length(v_data) > v_limit THEN
      v_data := v_data - v_limit;
      v_has_more := true;
      v_next := v_data->-1->>'customer_id';
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'vouchers.list' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'vouchers.manage');
    PERFORM bar_local.assert_feature('bar_growth_multi_outlet');
    v_limit := bar_local.query_limit(v_filters);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.code), '[]'::jsonb) INTO v_data
      FROM (SELECT v.id AS voucher_id, v.code, v.initial_amount, v.balance, v.status, v.customer_id,
                   v.expires_on, v.version, v.created_at
              FROM bar_local.vouchers v
             WHERE v.business_id = v_ctx.business_id AND v.outlet_id = v_ctx.outlet_id
               AND (v_filters->>'status' IS NULL OR v.status = v_filters->>'status')
               AND (v_filters->>'cursor' IS NULL OR v.code > v_filters->>'cursor')
             ORDER BY v.code LIMIT v_limit + 1) x;
    IF jsonb_array_length(v_data) > v_limit THEN
      v_data := v_data - v_limit;
      v_has_more := true;
      v_next := v_data->-1->>'code';
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'reports.sales_summary' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.reports');
    v_outlet := bar_local.query_outlet(v_ctx, v_filters);
    v_data := jsonb_build_object(
      'from', COALESCE(NULLIF(v_filters->>'from', '')::date, bar_local.current_business_date() - 30),
      'to', COALESCE(NULLIF(v_filters->>'to', '')::date, bar_local.current_business_date()),
      'days', COALESCE((SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.business_date) FROM (
          SELECT s.business_date,
                 count(*) FILTER (WHERE s.status = 'completed') AS sale_count,
                 count(*) FILTER (WHERE s.status IN ('returned','voided')) AS correction_count,
                 COALESCE(round(sum(s.subtotal), 2), 0) AS subtotal,
                 COALESCE(round(sum(s.discount), 2), 0) AS discount,
                 COALESCE(round(sum(s.tax), 2), 0) AS tax,
                 COALESCE(round(sum(s.tip), 2), 0) AS tip,
                 COALESCE(round(sum(s.total), 2), 0) AS total
            FROM bar_local.sales s
           WHERE s.business_id = v_ctx.business_id AND s.outlet_id = v_outlet
             AND s.business_date >= COALESCE(NULLIF(v_filters->>'from', '')::date, bar_local.current_business_date() - 30)
             AND s.business_date <= COALESCE(NULLIF(v_filters->>'to', '')::date, bar_local.current_business_date())
           GROUP BY s.business_date) x), '[]'::jsonb),
      'tenders', COALESCE((SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.method) FROM (
          SELECT st.method, round(sum(st.amount), 2) AS amount, count(*) AS entries
            FROM bar_local.sale_tenders st JOIN bar_local.sales s ON s.id = st.sale_id
           WHERE s.business_id = v_ctx.business_id AND s.outlet_id = v_outlet
             AND s.business_date >= COALESCE(NULLIF(v_filters->>'from', '')::date, bar_local.current_business_date() - 30)
             AND s.business_date <= COALESCE(NULLIF(v_filters->>'to', '')::date, bar_local.current_business_date())
           GROUP BY st.method) x), '[]'::jsonb),
      'cloud_export', 'integration_disabled'
    );
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'staff.list' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.display_name), '[]'::jsonb) INTO v_data
      FROM (SELECT st.id AS staff_id, st.display_name, st.role, st.capabilities, st.status, st.version,
                   st.created_at, st.updated_at
              FROM bar_local.staff st
             WHERE st.business_id = v_ctx.business_id
               AND (COALESCE((v_filters->>'include_suspended')::boolean, true) OR st.status = 'active')
             ORDER BY st.display_name) x;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'audit.search' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'settings.manage');
    v_limit := bar_local.query_limit(v_filters);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_data
      FROM (SELECT a.id, a.action, a.operation_id, a.actor_staff_id, a.device_id, a.before, a.after, a.created_at
              FROM bar_local.audit_log a
             WHERE a.business_id = v_ctx.business_id
               AND a.outlet_id = v_ctx.outlet_id
               AND a.created_at >= COALESCE(NULLIF(v_filters->>'from', '')::timestamptz, now() - interval '30 days')
               AND a.created_at <= COALESCE(NULLIF(v_filters->>'to', '')::timestamptz, now())
               AND (v_filters->>'action' IS NULL OR a.action = v_filters->>'action')
               AND (v_filters->>'operation_id' IS NULL OR a.operation_id = (v_filters->>'operation_id')::uuid)
               AND (v_filters->>'cursor' IS NULL OR a.id < (v_filters->>'cursor')::bigint)
             ORDER BY a.id DESC LIMIT v_limit + 1) x;
    IF jsonb_array_length(v_data) > v_limit THEN
      v_data := v_data - v_limit;
      v_has_more := true;
      v_next := v_data->-1->>'id';
    END IF;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'outbox.status' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'export.manage');
    v_data := jsonb_build_object(
      'pending_events', (SELECT count(*) FROM bar_local.outbox o WHERE o.export_batch_id IS NULL),
      'exported_unacknowledged', (SELECT count(*) FROM bar_local.outbox o WHERE o.export_batch_id IS NOT NULL),
      'oldest_pending_sequence', (SELECT min(o.commit_sequence) FROM bar_local.outbox o WHERE o.export_batch_id IS NULL),
      'latest_commit_sequence', v_watermark,
      'batches', COALESCE((SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC) FROM (
          SELECT b.batch_id, b.from_sequence, b.to_sequence, b.event_count, b.manifest_hash, b.key_id,
                 b.created_at, b.acknowledged_at
            FROM bar_local.export_batches b ORDER BY b.created_at DESC LIMIT 50) x), '[]'::jsonb),
      'cloud_transport', 'disabled'
    );
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);

  ELSIF p_query = 'accounting.trial_balance' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'accounting.read');
    PERFORM bar_local.assert_feature('bar_accounting_workforce');
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.account_code), '[]'::jsonb) INTO v_data
      FROM (SELECT aa.code AS account_code, aa.name, aa.type,
                   COALESCE(round(sum(jl.debit), 2), 0) AS debit,
                   COALESCE(round(sum(jl.credit), 2), 0) AS credit,
                   COALESCE(round(sum(jl.debit - jl.credit), 2), 0) AS balance
              FROM bar_local.accounting_accounts aa
              LEFT JOIN (
                SELECT line.account_code, line.debit, line.credit
                  FROM bar_local.journal_lines line
                  JOIN bar_local.journal_entries entry ON entry.id = line.entry_id
                 WHERE entry.entry_date >= COALESCE(NULLIF(v_filters->>'from', '')::date, date '1970-01-01')
                   AND entry.entry_date <= COALESCE(NULLIF(v_filters->>'to', '')::date, bar_local.current_business_date())
              ) jl ON jl.account_code = aa.code
             WHERE aa.active
             GROUP BY aa.code, aa.name, aa.type) x;
    RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);
  END IF;

  PERFORM bar_local.raise_business('QUERY_NOT_REGISTERED', 'The local query is not registered: ' || COALESCE(p_query, ''));
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_events(
  p_token_hash text,
  p_device_id uuid,
  p_after_sequence bigint DEFAULT 0,
  p_limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  v_events jsonb;
  v_count integer;
  v_next bigint;
  v_latest bigint;
  v_latest_event bigint;
  v_floor bigint;
BEGIN
  IF p_after_sequence IS NULL OR p_after_sequence < 0 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The event cursor must be zero or a non-negative commit sequence.');
  END IF;
  SELECT commit_sequence INTO v_latest FROM bar_local.authority_counter WHERE singleton;
  SELECT max(commit_sequence) INTO v_latest_event FROM bar_local.outbox;
  SELECT min(commit_sequence) INTO v_floor FROM bar_local.outbox;
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.commit_sequence, x.event_index), '[]'::jsonb),
         count(*)
    INTO v_events, v_count
    FROM (
      SELECT o.commit_sequence, o.event_index, o.event_type, o.operation_id, o.payload, o.payload_hash, o.created_at
        FROM bar_local.outbox o
       WHERE o.business_id = v_ctx.business_id AND o.outlet_id = v_ctx.outlet_id
         AND o.commit_sequence > p_after_sequence
       ORDER BY o.commit_sequence, o.event_index
       LIMIT v_limit
    ) x;
  SELECT max((value->>'commit_sequence')::bigint) INTO v_next FROM jsonb_array_elements(v_events);
  RETURN jsonb_build_object(
    'events', v_events,
    'event_count', v_count,
    'next_cursor', COALESCE(v_next, p_after_sequence),
    'latest_commit_sequence', v_latest,
    'latest_event_sequence', v_latest_event,
    'retention_floor_sequence', v_floor,
    'gap_detected', p_after_sequence > 0 AND v_floor IS NOT NULL AND p_after_sequence < v_floor - 1,
    'complete', COALESCE(v_next, p_after_sequence) >= COALESCE(v_latest_event, 0),
    'scope', jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id, 'device_id', v_ctx.device_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_operation_status(
  p_token_hash text,
  p_device_id uuid,
  p_operation_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
  v_operation bar_local.operations%ROWTYPE;
BEGIN
  SELECT * INTO v_operation FROM bar_local.operations WHERE operation_id = p_operation_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('OPERATION_NOT_FOUND', 'No local operation receipt exists for this identifier.');
  END IF;
  IF v_operation.business_id <> v_ctx.business_id OR v_operation.outlet_id <> v_ctx.outlet_id THEN
    PERFORM bar_local.raise_business('TENANT_SCOPE_MISMATCH', 'The operation is outside this authenticated business or outlet.');
  END IF;
  IF v_operation.actor_staff_id <> v_ctx.staff_id
     AND NOT (v_ctx.capabilities @> ARRAY['pos.manage'] OR v_ctx.capabilities @> ARRAY['settings.manage']) THEN
    PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'Only the original operator or a local manager can inspect this operation receipt.');
  END IF;
  RETURN jsonb_build_object(
    'operation_id', v_operation.operation_id,
    'command', v_operation.command,
    'status', v_operation.status,
    'outcome', v_operation.outcome,
    'receipt', v_operation.receipt,
    'result', v_operation.result,
    'error', v_operation.error,
    'commit_sequence', v_operation.commit_sequence,
    'business_date', v_operation.business_date,
    'created_at', v_operation.created_at,
    'committed_at', v_operation.committed_at,
    'refused_at', v_operation.refused_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.service_readiness(
  p_token_hash text,
  p_device_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
  v_authority bar_local.authority%ROWTYPE;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_authority FROM bar_local.authority WHERE singleton;
  IF NOT FOUND OR v_authority.commissioned_at IS NULL THEN
    v_blockers := v_blockers || '"authority_not_commissioned"'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bar_local.staff WHERE business_id = v_ctx.business_id AND status = 'active') THEN
    v_blockers := v_blockers || '"no_active_staff"'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bar_local.products WHERE business_id = v_ctx.business_id AND active) THEN
    v_blockers := v_blockers || '"empty_catalogue"'::jsonb;
  END IF;
  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_blockers) = 0,
    'authority_epoch', v_authority.authority_epoch,
    'authority_id', v_authority.authority_id,
    'business_id', v_ctx.business_id,
    'outlet_id', v_ctx.outlet_id,
    'schema_version', (SELECT max(version) FROM bar_local.schema_migrations),
    'commit_sequence', (SELECT commit_sequence FROM bar_local.authority_counter WHERE singleton),
    'blockers', v_blockers,
    'cloud_export', 'integration_disabled'
  );
END;
$$;
