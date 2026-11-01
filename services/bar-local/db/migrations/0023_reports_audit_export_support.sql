ALTER TABLE bar_local.export_batches ALTER COLUMN signature DROP NOT NULL;
ALTER TABLE bar_local.export_batches ALTER COLUMN key_id DROP NOT NULL;
ALTER TABLE bar_local.export_batches
  ADD COLUMN IF NOT EXISTS id uuid GENERATED ALWAYS AS (batch_id) STORED,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'integration_disabled'
    CHECK (status IN ('integration_disabled', 'ready', 'acknowledged', 'failed')),
  ADD COLUMN IF NOT EXISTS checkpoint bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS signature_key_id text,
  ADD COLUMN IF NOT EXISTS signature_status text NOT NULL DEFAULT 'unavailable'
    CHECK (signature_status IN ('unavailable', 'signed', 'verified', 'failed')),
  ADD COLUMN IF NOT EXISTS signature_algorithm text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS transport_status text NOT NULL DEFAULT 'integration_disabled',
  ADD COLUMN IF NOT EXISTS manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS business_id uuid,
  ADD COLUMN IF NOT EXISTS outlet_id uuid,
  ADD COLUMN IF NOT EXISTS authority_id uuid,
  ADD COLUMN IF NOT EXISTS authority_epoch bigint,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES bar_local.staff(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS export_batches_id_key ON bar_local.export_batches (id);
CREATE INDEX IF NOT EXISTS export_batches_created_idx ON bar_local.export_batches (created_at DESC);
CREATE INDEX IF NOT EXISTS export_batches_status_idx ON bar_local.export_batches (status, created_at);

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'export_batches_payload_hash_check'
       AND conrelid = 'bar_local.export_batches'::regclass
  ) THEN
    ALTER TABLE bar_local.export_batches
      ADD CONSTRAINT export_batches_payload_hash_check
      CHECK (payload_hash IS NULL OR payload_hash ~ '^[0-9a-f]{64}$');
  END IF;
END;
$constraint$;

CREATE TABLE IF NOT EXISTS bar_local.export_batch_items (
  batch_id uuid NOT NULL REFERENCES bar_local.export_batches(batch_id) ON DELETE CASCADE,
  commit_sequence bigint NOT NULL,
  event_index integer NOT NULL CHECK (event_index >= 0),
  event_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, commit_sequence, event_index),
  UNIQUE (event_id),
  FOREIGN KEY (commit_sequence, event_index)
    REFERENCES bar_local.outbox(commit_sequence, event_index)
);
CREATE INDEX IF NOT EXISTS export_batch_items_event_idx
  ON bar_local.export_batch_items (commit_sequence, event_index);

CREATE TABLE IF NOT EXISTS bar_local.support_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  operation_id uuid NOT NULL UNIQUE,
  submitted_by uuid NOT NULL REFERENCES bar_local.staff(id),
  category text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 64),
  severity text NOT NULL DEFAULT 'normal' CHECK (severity IN ('low', 'normal', 'high', 'critical')),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 1 AND 200),
  message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 4000),
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(diagnostics) = 'object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  redaction_applied boolean NOT NULL DEFAULT true,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'acknowledged')),
  delivery_status text NOT NULL DEFAULT 'integration_disabled'
    CHECK (delivery_status IN ('integration_disabled', 'pending', 'sent', 'failed')),
  acknowledged_at timestamptz,
  acknowledged_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_reports_scope_idx
  ON bar_local.support_reports (business_id, outlet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_reports_status_idx
  ON bar_local.support_reports (status, delivery_status, created_at);

CREATE VIEW bar_local.stock_report_balance AS
SELECT p.business_id,
       o.id AS outlet_id,
       p.id AS product_id,
       p.sku,
       p.name,
       p.category,
       p.track_stock,
       p.active AS product_active,
       COALESCE(sb.quantity, 0) AS quantity,
       sb.version,
       sb.updated_at
  FROM bar_local.products p
  JOIN bar_local.outlets o
    ON o.business_id = p.business_id
   AND o.active
  LEFT JOIN bar_local.stock_balances sb
    ON sb.business_id = p.business_id
   AND sb.outlet_id = o.id
   AND sb.product_id = p.id
 WHERE p.active;

CREATE VIEW bar_local.stock_report_movements AS
SELECT m.business_id,
       m.outlet_id,
       m.product_id,
       p.sku,
       p.name,
       m.business_date,
       m.reason,
       m.delta,
       m.unit_cost,
       CASE WHEN m.unit_cost IS NULL THEN NULL ELSE round(m.delta * m.unit_cost, 4) END AS cost_amount,
       CASE WHEN m.unit_cost IS NULL THEN 'missing_cost' ELSE 'costed' END AS cost_status,
       m.lot_code,
       m.expires_on,
       m.reference,
       m.operation_id,
       m.created_at
  FROM bar_local.stock_movements m
  JOIN bar_local.products p ON p.id = m.product_id;

CREATE VIEW bar_local.stock_report_low_stock AS
WITH threshold AS (
  SELECT COALESCE(
    (SELECT (value #>> '{}')::numeric FROM bar_local.settings WHERE key = 'low_stock_threshold'),
    0
  ) AS value
)
SELECT b.*, t.value AS low_stock_threshold
  FROM bar_local.stock_report_balance b
 CROSS JOIN threshold t
 WHERE b.track_stock
   AND b.quantity <= t.value;

CREATE VIEW bar_local.stock_report_valuation AS
WITH latest_cost AS (
  SELECT DISTINCT ON (m.business_id, m.outlet_id, m.product_id)
         m.business_id,
         m.outlet_id,
         m.product_id,
         m.unit_cost,
         m.created_at
    FROM bar_local.stock_movements m
   WHERE m.unit_cost IS NOT NULL
   ORDER BY m.business_id, m.outlet_id, m.product_id, m.created_at DESC, m.id DESC
)
SELECT b.*,
       lc.unit_cost,
       lc.created_at AS cost_as_of,
       CASE WHEN lc.unit_cost IS NULL THEN NULL ELSE round(b.quantity * lc.unit_cost, 2) END AS valuation_amount,
       CASE WHEN lc.unit_cost IS NULL THEN 'missing_cost' ELSE 'valued' END AS cost_status
  FROM bar_local.stock_report_balance b
  LEFT JOIN latest_cost lc
    ON lc.business_id = b.business_id
   AND lc.outlet_id = b.outlet_id
   AND lc.product_id = b.product_id;

CREATE OR REPLACE FUNCTION bar_local.stock_report(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb;
  v_outlet uuid;
  v_from date;
  v_to date;
  v_threshold numeric;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
  v_data jsonb;
  v_missing integer;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.reports');
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  v_outlet := bar_local.query_outlet(v_ctx, v_filters);
  v_from := COALESCE(NULLIF(v_filters->>'from', '')::date, bar_local.current_business_date() - 30);
  v_to := COALESCE(NULLIF(v_filters->>'to', '')::date, bar_local.current_business_date());
  IF v_to < v_from THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The report end date cannot be before its start date.');
  END IF;
  v_threshold := COALESCE(
    NULLIF(v_filters->>'threshold', '')::numeric,
    (SELECT (value #>> '{}')::numeric FROM bar_local.settings WHERE key = 'low_stock_threshold'),
    0
  );
  IF v_threshold < 0 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The low-stock threshold cannot be negative.');
  END IF;
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object(
    'business_id', v_ctx.business_id,
    'outlet_id', v_outlet,
    'actor_staff_id', v_ctx.staff_id,
    'role', v_ctx.role,
    'device_id', v_ctx.device_id
  );

  WITH balances AS (
    SELECT * FROM bar_local.stock_report_balance
     WHERE business_id = v_ctx.business_id AND outlet_id = v_outlet
  ), movements AS (
    SELECT * FROM bar_local.stock_report_movements
     WHERE business_id = v_ctx.business_id
       AND outlet_id = v_outlet
       AND business_date BETWEEN v_from AND v_to
  ), low AS (
    SELECT * FROM balances
     WHERE track_stock AND quantity <= v_threshold
  ), valuation AS (
    SELECT * FROM bar_local.stock_report_valuation
     WHERE business_id = v_ctx.business_id AND outlet_id = v_outlet
  ), valuation_totals AS (
    SELECT COALESCE(sum(valuation_amount), 0) AS valued_amount,
           count(*) FILTER (WHERE cost_status = 'valued')::integer AS valued_products,
           count(*) FILTER (WHERE cost_status = 'missing_cost')::integer AS missing_cost_products
      FROM valuation
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'low_stock_threshold', v_threshold,
    'balances', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.name, b.product_id) FROM balances b), '[]'::jsonb),
    'movements', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.business_date, m.created_at, m.product_id) FROM movements m), '[]'::jsonb),
    'low_stock', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.quantity, l.name) FROM low l), '[]'::jsonb),
    'valuation', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.name, v.product_id) FROM valuation v), '[]'::jsonb),
    'valuation_totals', (SELECT to_jsonb(t) FROM valuation_totals t)
  ) INTO v_data;

  SELECT missing_cost_products INTO v_missing FROM (
    SELECT count(*) FILTER (WHERE cost_status = 'missing_cost')::integer AS missing_cost_products
      FROM bar_local.stock_report_valuation
     WHERE business_id = v_ctx.business_id AND outlet_id = v_outlet
  ) x;

  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
    'snapshot_watermark', v_watermark,
    'scope', v_scope,
    'as_of', v_as_of,
    'complete', COALESCE(v_missing, 0) = 0,
    'unavailable', CASE WHEN COALESCE(v_missing, 0) > 0 THEN '["valuation_missing_cost"]'::jsonb ELSE '[]'::jsonb END
  );
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cashup_report(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb;
  v_outlet uuid;
  v_from date;
  v_to date;
  v_shift uuid;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
  v_data jsonb;
  v_complete boolean;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  IF NOT ('pos.cashup' = ANY (COALESCE(v_ctx.capabilities, ARRAY[]::text[]))
       OR 'pos.reports' = ANY (COALESCE(v_ctx.capabilities, ARRAY[]::text[]))) THEN
    PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'This operator does not have the required local capability: pos.cashup or pos.reports');
  END IF;
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  v_outlet := bar_local.query_outlet(v_ctx, v_filters);
  v_from := COALESCE(NULLIF(v_filters->>'from', '')::date, bar_local.current_business_date() - 7);
  v_to := COALESCE(NULLIF(v_filters->>'to', '')::date, bar_local.current_business_date());
  IF v_to < v_from THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The report end date cannot be before its start date.');
  END IF;
  v_shift := NULLIF(v_filters->>'shift_id', '')::uuid;
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object(
    'business_id', v_ctx.business_id,
    'outlet_id', v_outlet,
    'actor_staff_id', v_ctx.staff_id,
    'role', v_ctx.role,
    'device_id', v_ctx.device_id
  );

  WITH scoped AS (
    SELECT sh.*
      FROM bar_local.shifts sh
     WHERE sh.business_id = v_ctx.business_id
       AND sh.outlet_id = v_outlet
       AND sh.business_date BETWEEN v_from AND v_to
       AND (v_shift IS NULL OR sh.id = v_shift)
  ), tenders AS (
    SELECT s.shift_id, t.method, round(sum(t.amount), 2) AS amount, count(*)::integer AS entry_count
      FROM bar_local.sales s
      JOIN bar_local.sale_tenders t ON t.sale_id = s.id
     WHERE s.business_id = v_ctx.business_id
       AND s.outlet_id = v_outlet
       AND s.business_date BETWEEN v_from AND v_to
       AND s.status IN ('completed', 'returned')
       AND (v_shift IS NULL OR s.shift_id = v_shift)
     GROUP BY s.shift_id, t.method
  ), tips AS (
    SELECT s.shift_id, round(sum(s.tip), 2) AS tips
      FROM bar_local.sales s
     WHERE s.business_id = v_ctx.business_id
       AND s.outlet_id = v_outlet
       AND s.business_date BETWEEN v_from AND v_to
       AND s.status IN ('completed', 'returned')
       AND (v_shift IS NULL OR s.shift_id = v_shift)
     GROUP BY s.shift_id
  ), cash_movements AS (
    SELECT cm.shift_id, cm.type, round(sum(cm.amount), 2) AS amount, count(*)::integer AS entry_count
      FROM bar_local.cash_movements cm
     WHERE cm.business_id = v_ctx.business_id
       AND cm.outlet_id = v_outlet
     GROUP BY cm.shift_id, cm.type
  ), tender_json AS (
    SELECT t.shift_id,
           jsonb_agg(jsonb_build_object('method', t.method, 'amount', t.amount, 'entry_count', t.entry_count) ORDER BY t.method) AS tenders
      FROM tenders t
     GROUP BY t.shift_id
  ), movement_json AS (
    SELECT cm.shift_id,
           jsonb_agg(jsonb_build_object('type', cm.type, 'amount', cm.amount, 'entry_count', cm.entry_count) ORDER BY cm.type) AS movements
      FROM cash_movements cm
     GROUP BY cm.shift_id
  ), cashups AS (
    SELECT c.* FROM bar_local.cashups c
     WHERE c.business_id = v_ctx.business_id AND c.outlet_id = v_outlet
  ), report_rows AS (
    SELECT sh.id AS shift_id,
           sh.staff_id,
           sh.status AS shift_status,
           sh.business_date,
           sh.opening_float,
           sh.opened_at,
           sh.closed_at,
           c.id AS cashup_id,
           COALESCE(c.status, 'not_submitted') AS cashup_status,
           COALESCE(c.expected_cash, bar_local.expected_shift_cash(sh.id)) AS expected_cash,
           COALESCE(c.counted_cash, sh.counted_cash) AS counted_cash,
           c.counted_cash AS cashup_counted_cash,
           c.counted_card AS cashup_counted_card,
           c.variance AS cashup_variance,
           COALESCE((SELECT t.amount FROM tenders t WHERE t.shift_id = sh.id AND t.method = 'cash'), 0) AS expected_cash_tenders,
           COALESCE((SELECT t.amount FROM tenders t WHERE t.shift_id = sh.id AND t.method = 'card'), 0) AS expected_card,
           COALESCE(tp.tips, 0) AS tips,
           COALESCE(tj.tenders, '[]'::jsonb) AS tenders,
           COALESCE(mj.movements, '[]'::jsonb) AS cash_movements,
           (c.id IS NOT NULL AND COALESCE(c.counted_cash, sh.counted_cash) IS NOT NULL AND c.counted_card IS NOT NULL) AS local_complete
      FROM scoped sh
      LEFT JOIN cashups c ON c.shift_id = sh.id
      LEFT JOIN tips tp ON tp.shift_id = sh.id
      LEFT JOIN tender_json tj ON tj.shift_id = sh.id
      LEFT JOIN movement_json mj ON mj.shift_id = sh.id
  ), totals AS (
    SELECT count(*)::integer AS shift_count,
           COALESCE(round(sum(expected_cash), 2), 0) AS expected_cash,
           CASE WHEN count(*) FILTER (WHERE counted_cash IS NULL) > 0 THEN NULL ELSE round(sum(counted_cash), 2) END AS counted_cash,
           CASE WHEN count(*) FILTER (WHERE counted_cash IS NULL) > 0 THEN NULL ELSE round(sum(counted_cash - expected_cash), 2) END AS cash_variance,
           COALESCE(round(sum(expected_card), 2), 0) AS expected_card,
           CASE WHEN count(*) FILTER (WHERE cashup_counted_card IS NULL) > 0 THEN NULL ELSE round(sum(cashup_counted_card), 2) END AS counted_card,
           CASE WHEN count(*) FILTER (WHERE cashup_counted_card IS NULL) > 0 THEN NULL ELSE round(sum(cashup_counted_card - expected_card), 2) END AS card_variance,
           COALESCE(round(sum(tips), 2), 0) AS tips,
           COALESCE(bool_and(local_complete), true) AS complete
      FROM report_rows
    )
    SELECT jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'shifts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'shift_id', r.shift_id,
        'staff_id', r.staff_id,
        'shift_status', r.shift_status,
        'business_date', r.business_date,
        'opening_float', r.opening_float,
        'opened_at', r.opened_at,
        'closed_at', r.closed_at,
        'cashup_id', r.cashup_id,
        'cashup_status', r.cashup_status,
        'expected_cash', r.expected_cash,
        'expected_cash_tenders', r.expected_cash_tenders,
        'counted_cash', r.counted_cash,
        'counted_cash_source', CASE
          WHEN r.cashup_counted_cash IS NOT NULL THEN 'cashup'
          WHEN r.counted_cash IS NOT NULL THEN 'shift_close'
          ELSE NULL
        END,
        'cash_variance', CASE WHEN r.counted_cash IS NULL THEN NULL ELSE round(r.counted_cash - r.expected_cash, 2) END,
        'expected_card', r.expected_card,
        'counted_card', r.cashup_counted_card,
        'counted_card_source', CASE WHEN r.cashup_counted_card IS NOT NULL THEN 'cashup' ELSE NULL END,
        'card_variance', CASE WHEN r.cashup_counted_card IS NULL THEN NULL ELSE round(r.cashup_counted_card - r.expected_card, 2) END,
        'tips', r.tips,
        'tenders', r.tenders,
        'cash_movements', r.cash_movements,
        'card_settlement_status', 'unverified_external',
        'complete', r.local_complete,
        'unavailable', '[]'::jsonb
          || CASE WHEN r.cashup_id IS NULL THEN '["cashup_not_submitted"]'::jsonb ELSE '[]'::jsonb END
          || CASE WHEN r.counted_cash IS NULL THEN '["counted_cash_unavailable"]'::jsonb ELSE '[]'::jsonb END
          || CASE WHEN r.cashup_counted_card IS NULL THEN '["counted_card_unavailable"]'::jsonb ELSE '[]'::jsonb END
          || CASE WHEN r.expected_card <> 0 OR r.cashup_counted_card IS NOT NULL THEN '["card_provider_settlement_unverified"]'::jsonb ELSE '[]'::jsonb END
      ) ORDER BY r.business_date, r.opened_at)
      FROM report_rows r
    ), '[]'::jsonb),
    'totals', (SELECT to_jsonb(t) FROM totals t),
    'card_settlement_status', 'unverified_external'
  ) INTO v_data;

  SELECT complete INTO v_complete FROM (
    SELECT COALESCE(bool_and(
      c.id IS NOT NULL
      AND COALESCE(c.counted_cash, sh.counted_cash) IS NOT NULL
      AND c.counted_card IS NOT NULL
    ), true) AS complete
      FROM bar_local.shifts sh
      LEFT JOIN bar_local.cashups c ON c.shift_id = sh.id
     WHERE sh.business_id = v_ctx.business_id
       AND sh.outlet_id = v_outlet
       AND sh.business_date BETWEEN v_from AND v_to
       AND (v_shift IS NULL OR sh.id = v_shift)
  ) x;

  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
    'snapshot_watermark', v_watermark,
    'scope', v_scope,
    'as_of', v_as_of,
    'complete', COALESCE(v_complete, false),
    'unavailable', '["card_provider_settlement_unverified"]'::jsonb
      || CASE WHEN COALESCE(v_complete, false) THEN '[]'::jsonb ELSE '["cashup_incomplete"]'::jsonb END
  );
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.audit_search(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_limit integer;
  v_cursor bigint;
  v_search text;
  v_action text;
  v_actor uuid;
  v_operation uuid;
  v_data jsonb;
  v_has_more boolean;
  v_next bigint;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'settings.manage');
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  v_from := COALESCE(NULLIF(v_filters->>'from', '')::timestamptz, now() - interval '30 days');
  v_to := COALESCE(NULLIF(v_filters->>'to', '')::timestamptz, now());
  IF v_to < v_from THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The audit search end time cannot be before its start time.');
  END IF;
  v_limit := bar_local.query_limit(v_filters, 50, 200);
  v_cursor := NULLIF(v_filters->>'cursor', '')::bigint;
  v_search := NULLIF(btrim(COALESCE(v_filters->>'search', '')), '');
  v_action := NULLIF(btrim(COALESCE(v_filters->>'action', '')), '');
  v_actor := NULLIF(v_filters->>'actor_staff_id', '')::uuid;
  v_operation := NULLIF(v_filters->>'operation_id', '')::uuid;
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object(
    'business_id', v_ctx.business_id,
    'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id,
    'role', v_ctx.role,
    'device_id', v_ctx.device_id
  );

  WITH found AS (
    SELECT a.id, a.action, a.operation_id, a.actor_staff_id, a.device_id, a.before, a.after, a.created_at
      FROM bar_local.audit_log a
     WHERE a.business_id = v_ctx.business_id
       AND a.outlet_id = v_ctx.outlet_id
       AND a.created_at >= v_from
       AND a.created_at <= v_to
       AND (v_cursor IS NULL OR a.id < v_cursor)
       AND (v_action IS NULL OR a.action = v_action)
       AND (v_actor IS NULL OR a.actor_staff_id = v_actor)
       AND (v_operation IS NULL OR a.operation_id = v_operation)
       AND (
         v_search IS NULL
         OR a.action ILIKE '%' || v_search || '%'
         OR a.operation_id::text ILIKE '%' || v_search || '%'
         OR COALESCE(a.before::text, '') ILIKE '%' || v_search || '%'
         OR COALESCE(a.after::text, '') ILIKE '%' || v_search || '%'
       )
     ORDER BY a.id DESC
     LIMIT v_limit + 1
  ), page AS (
    SELECT * FROM found ORDER BY id DESC LIMIT v_limit
  )
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id DESC) FROM page p), '[]'::jsonb),
         (SELECT count(*) > v_limit FROM found),
         (SELECT min(p.id) FROM page p)
    INTO v_data, v_has_more, v_next;

  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object(
      'next_cursor', CASE WHEN v_has_more THEN v_next ELSE NULL END,
      'has_more', COALESCE(v_has_more, false)
    ),
    'snapshot_watermark', v_watermark,
    'scope', v_scope,
    'as_of', v_as_of,
    'complete', NOT COALESCE(v_has_more, false),
    'unavailable', '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.redact_support_json(p_value jsonb, p_depth integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_type text;
  v_key text;
  v_value jsonb;
  v_result jsonb;
  v_text text;
BEGIN
  IF p_depth > 8 THEN
    RETURN '"[truncated]"'::jsonb;
  END IF;
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;
  v_type := jsonb_typeof(p_value);
  IF v_type = 'object' THEN
    v_result := '{}'::jsonb;
    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_value)
    LOOP
      IF v_key ~* '(password|passwd|secret|token|api[_-]?key|authorization|cookie|pin|credential|private[_-]?key|card[_-]?number|cvv)' THEN
        v_result := v_result || jsonb_build_object(v_key, '[redacted]');
      ELSE
        v_result := v_result || jsonb_build_object(v_key, bar_local.redact_support_json(v_value, p_depth + 1));
      END IF;
    END LOOP;
    RETURN v_result;
  ELSIF v_type = 'array' THEN
    SELECT COALESCE(jsonb_agg(bar_local.redact_support_json(element, p_depth + 1) ORDER BY ordinality), '[]'::jsonb)
      INTO v_result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS items(element, ordinality);
    RETURN v_result;
  ELSIF v_type = 'string' THEN
    v_text := p_value #>> '{}';
    IF v_text ~* '^(bearer|basic)\s+' THEN
      RETURN '"[redacted]"'::jsonb;
    END IF;
    RETURN to_jsonb(left(v_text, 4000));
  END IF;
  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_support_report_create(
  p_token_hash text,
  p_device_id uuid,
  p_envelope jsonb,
  p_payload_hash text,
  p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := COALESCE(p_envelope->'payload', '{}'::jsonb);
  v_category text;
  v_severity text;
  v_subject text;
  v_message text;
  v_diagnostics jsonb;
  v_metadata jsonb;
  v_checksum text;
  v_id uuid;
  v_result jsonb;
  v_code text;
  v_message_error text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'settings.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_category := btrim(COALESCE(v_payload->>'category', ''));
    v_severity := COALESCE(NULLIF(v_payload->>'severity', ''), 'normal');
    v_subject := btrim(COALESCE(v_payload->>'subject', ''));
    v_message := btrim(COALESCE(v_payload->>'message', ''));
    IF length(v_category) NOT BETWEEN 1 AND 64 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A support report category of 1 to 64 characters is required.');
    END IF;
    IF v_severity NOT IN ('low', 'normal', 'high', 'critical') THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The support report severity is not supported.');
    END IF;
    IF length(v_subject) NOT BETWEEN 1 AND 200 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A support report subject of 1 to 200 characters is required.');
    END IF;
    IF length(v_message) NOT BETWEEN 1 AND 4000 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A support report message of 1 to 4000 characters is required.');
    END IF;
    IF jsonb_typeof(COALESCE(v_payload->'diagnostics', '{}'::jsonb)) <> 'object' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Support diagnostics must be a JSON object.');
    END IF;
    IF jsonb_typeof(COALESCE(v_payload->'metadata', '{}'::jsonb)) <> 'object' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Support metadata must be a JSON object.');
    END IF;
    v_diagnostics := bar_local.redact_support_json(COALESCE(v_payload->'diagnostics', '{}'::jsonb), 0);
    v_metadata := bar_local.redact_support_json(COALESCE(v_payload->'metadata', '{}'::jsonb), 0);
    IF octet_length(bar_local.canonical_jsonb_text(v_diagnostics) || bar_local.canonical_jsonb_text(v_metadata)) > 65536 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Support diagnostics and metadata must be at most 64 KiB after redaction.');
    END IF;
    v_checksum := bar_local.sha256_hex(bar_local.canonical_jsonb_text(jsonb_build_object(
      'category', v_category,
      'severity', v_severity,
      'subject', v_subject,
      'message', v_message,
      'diagnostics', v_diagnostics,
      'metadata', v_metadata
    )));
    INSERT INTO bar_local.support_reports
      (business_id, outlet_id, operation_id, submitted_by, category, severity, subject, message,
       diagnostics, metadata, redaction_applied, checksum, status, delivery_status)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, (p_envelope->>'operation_id')::uuid, v_ctx.staff_id,
       v_category, v_severity, v_subject, v_message, v_diagnostics, v_metadata, true, v_checksum,
       'recorded', 'integration_disabled')
    RETURNING id INTO v_id;
    v_result := jsonb_build_object(
      'support_report_id', v_id,
      'status', 'recorded',
      'delivery_status', 'integration_disabled',
      'redaction_applied', true,
      'checksum', v_checksum
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'support.report.recorded', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'support.report.recorded', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message_error = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message_error);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_export_bundle_create(
  p_token_hash text,
  p_device_id uuid,
  p_envelope jsonb,
  p_payload_hash text,
  p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := COALESCE(p_envelope->'payload', '{}'::jsonb);
  v_limit integer;
  v_batch_id uuid := gen_random_uuid();
  v_created_ts timestamptz := now();
  v_events jsonb;
  v_from_seq bigint;
  v_to_seq bigint;
  v_count integer;
  v_manifest jsonb;
  v_manifest_hash text;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'export.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF jsonb_typeof(v_payload) <> 'object' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The export command payload must be a JSON object.');
    END IF;
    IF v_payload ? 'limit' AND (v_payload->>'limit') !~ '^[0-9]{1,4}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The export limit must be a whole number between 1 and 1000.');
    END IF;
    v_limit := LEAST(GREATEST(COALESCE(NULLIF(v_payload->>'limit', '')::integer, 200), 1), 1000);
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_payload) AS k(key)
                WHERE k.key IN ('signature', 'signing_key', 'private_key', 'signature_key_id')) THEN
      PERFORM bar_local.raise_business('EXPORT_DISABLED', 'Local export signing is not available in this release. The bundle is recorded unsigned and cloud transport is disabled.');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('bar_local.export_bundle', 0));

    WITH picked AS (
      SELECT o.*
        FROM bar_local.outbox o
       WHERE o.business_id = v_ctx.business_id
         AND o.outlet_id = v_ctx.outlet_id
         AND o.export_batch_id IS NULL
         AND o.commit_sequence < v_seq.commit_sequence
       ORDER BY o.commit_sequence, o.event_index
       LIMIT v_limit
       FOR UPDATE
    ), updated AS (
      UPDATE bar_local.outbox o
         SET export_batch_id = v_batch_id
        FROM picked p
       WHERE o.commit_sequence = p.commit_sequence
         AND o.event_index = p.event_index
      RETURNING o.commit_sequence, o.event_index, o.event_id, o.event_type, o.operation_id,
                o.authority_epoch, o.payload, o.payload_hash, o.created_at
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'event_id', u.event_id,
             'commit_sequence', u.commit_sequence,
             'event_index', u.event_index,
             'event_type', u.event_type,
             'operation_id', u.operation_id,
             'authority_epoch', u.authority_epoch,
             'payload', u.payload,
             'payload_hash', u.payload_hash,
             'created_at', to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ) ORDER BY u.commit_sequence, u.event_index), '[]'::jsonb),
           min(u.commit_sequence), max(u.commit_sequence), count(*)::integer
      INTO v_events, v_from_seq, v_to_seq, v_count
      FROM updated u;

    IF v_count = 0 THEN
      v_result := jsonb_build_object(
        'batch_id', NULL,
        'event_count', 0,
        'checkpoint', v_seq.commit_sequence,
        'status', 'no_pending_events',
        'signature_status', 'unavailable',
        'transport_status', 'integration_disabled'
      );
      v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
        v_result, v_result, '[]'::jsonb, bar_local.current_business_date());
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
    END IF;

    v_manifest := jsonb_build_object(
      'schema', 'bar-local-export-bundle',
      'schema_version', 1,
      'batch_id', v_batch_id,
      'authority_id', (p_envelope->>'authority_id')::uuid,
      'authority_epoch', (p_envelope->>'authority_epoch')::bigint,
      'business_id', v_ctx.business_id,
      'outlet_id', v_ctx.outlet_id,
      'from_sequence', v_from_seq,
      'to_sequence', v_to_seq,
      'checkpoint', v_to_seq,
      'event_count', v_count,
      'created_at', to_char(v_created_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'events', v_events
    );
    v_manifest_hash := bar_local.sha256_hex(bar_local.canonical_jsonb_text(v_manifest));

    INSERT INTO bar_local.export_batches
      (batch_id, from_sequence, to_sequence, event_count, manifest_hash, signature, key_id,
       file_name, status, checkpoint, payload_hash, signature_key_id, signature_status,
       signature_algorithm, signed_at, transport_status, manifest, business_id, outlet_id,
       authority_id, authority_epoch, created_by, created_at, updated_at)
    VALUES
      (v_batch_id, v_from_seq, v_to_seq, v_count, v_manifest_hash, NULL, NULL,
       'bar-export-' || v_batch_id::text || '.json', 'integration_disabled', v_to_seq,
       v_manifest_hash, NULL, 'unavailable', NULL, NULL, 'integration_disabled', v_manifest,
       v_ctx.business_id, v_ctx.outlet_id, (p_envelope->>'authority_id')::uuid,
       (p_envelope->>'authority_epoch')::bigint, v_ctx.staff_id, v_created_ts, v_created_ts);

    INSERT INTO bar_local.export_batch_items (batch_id, commit_sequence, event_index, event_id, payload_hash)
    SELECT v_batch_id, o.commit_sequence, o.event_index, o.event_id, o.payload_hash
      FROM bar_local.outbox o
     WHERE o.export_batch_id = v_batch_id
     ORDER BY o.commit_sequence, o.event_index;

    v_result := jsonb_build_object(
      'batch_id', v_batch_id,
      'event_count', v_count,
      'from_sequence', v_from_seq,
      'to_sequence', v_to_seq,
      'checkpoint', v_to_seq,
      'manifest_hash', v_manifest_hash,
      'status', 'integration_disabled',
      'signature_status', 'unavailable',
      'transport_status', 'integration_disabled'
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'export.bundle.created', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, '[]'::jsonb, bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.stock_report(text, uuid, uuid, bigint, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.stock_report(text, uuid, uuid, bigint, jsonb) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cashup_report(text, uuid, uuid, bigint, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.cashup_report(text, uuid, uuid, bigint, jsonb) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.audit_search(text, uuid, uuid, bigint, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.audit_search(text, uuid, uuid, bigint, jsonb) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.redact_support_json(jsonb, integer) SECURITY DEFINER;
ALTER FUNCTION bar_local.redact_support_json(jsonb, integer) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_support_report_create(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_support_report_create(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_export_bundle_create(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_export_bundle_create(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;

REVOKE ALL ON TABLE bar_local.stock_report_balance FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.stock_report_movements FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.stock_report_low_stock FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.stock_report_valuation FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.export_batch_items FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.support_reports FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.stock_report_balance FROM bar_local_runtime;
REVOKE ALL ON TABLE bar_local.stock_report_movements FROM bar_local_runtime;
REVOKE ALL ON TABLE bar_local.stock_report_low_stock FROM bar_local_runtime;
REVOKE ALL ON TABLE bar_local.stock_report_valuation FROM bar_local_runtime;
REVOKE ALL ON TABLE bar_local.export_batch_items FROM bar_local_runtime;
REVOKE ALL ON TABLE bar_local.support_reports FROM bar_local_runtime;

REVOKE ALL ON FUNCTION bar_local.stock_report(text, uuid, uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cashup_report(text, uuid, uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.audit_search(text, uuid, uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.redact_support_json(jsonb, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_support_report_create(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_export_bundle_create(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.stock_report(text, uuid, uuid, bigint, jsonb) FROM bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cashup_report(text, uuid, uuid, bigint, jsonb) FROM bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.audit_search(text, uuid, uuid, bigint, jsonb) FROM bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.redact_support_json(jsonb, integer) FROM bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cmd_support_report_create(text, uuid, jsonb, text, text) FROM bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cmd_export_bundle_create(text, uuid, jsonb, text, text) FROM bar_local_runtime;

GRANT EXECUTE ON FUNCTION bar_local.stock_report(text, uuid, uuid, bigint, jsonb) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cashup_report(text, uuid, uuid, bigint, jsonb) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.audit_search(text, uuid, uuid, bigint, jsonb) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_support_report_create(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_export_bundle_create(text, uuid, jsonb, text, text) TO bar_local_runtime;
