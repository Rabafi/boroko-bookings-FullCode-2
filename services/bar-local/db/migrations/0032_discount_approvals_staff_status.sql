-- Discount approval policy and staff-status escalation hardening.
INSERT INTO bar_local.settings (key, value, version)
VALUES
  ('discount_approval_threshold_percent', '"10.0000"'::jsonb, 1),
  ('discount_max_percent', '"25.0000"'::jsonb, 1)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION bar_local.validate_setting_value(p_key text, p_value jsonb)
RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_text text;
  v_numeric numeric;
BEGIN
  IF p_key IN ('business_name', 'receipt_footer') THEN
    IF jsonb_typeof(p_value) <> 'string' OR length(btrim(p_value #>> '{}')) = 0 OR length(p_value #>> '{}') > 500 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'This setting must be a non-empty string of at most 500 characters.');
    END IF;
  ELSIF p_key = 'receipt_series' THEN
    v_text := p_value #>> '{}';
    IF jsonb_typeof(p_value) <> 'string' OR v_text !~ '^[A-Za-z0-9_-]{1,8}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The receipt series must be 1 to 8 letters, digits, hyphens or underscores.');
    END IF;
  ELSIF p_key = 'currency' THEN
    v_text := p_value #>> '{}';
    IF jsonb_typeof(p_value) <> 'string' OR v_text !~ '^[A-Z]{3}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Currency must be a three-letter uppercase ISO code.');
    END IF;
  ELSIF p_key = 'timezone' THEN
    v_text := p_value #>> '{}';
    IF jsonb_typeof(p_value) <> 'string' OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_text) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The timezone must be a valid IANA timezone name.');
    END IF;
  ELSIF p_key IN ('tax_inclusive', 'allow_negative_stock') THEN
    IF jsonb_typeof(p_value) <> 'boolean' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'This setting must be a boolean value.');
    END IF;
  ELSIF p_key IN ('discount_approval_threshold_percent', 'discount_max_percent') THEN
    IF jsonb_typeof(p_value) NOT IN ('number', 'string') THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'This discount policy setting must be a number between 0 and 100.');
    END IF;
    IF jsonb_typeof(p_value) = 'string' AND (p_value #>> '{}') !~ '^[0-9]+(\.[0-9]+)?$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'This discount policy setting must be a number between 0 and 100.');
    END IF;
    v_numeric := (p_value #>> '{}')::numeric;
    IF v_numeric < 0 OR v_numeric > 100 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'This discount policy setting must be between 0 and 100 percent.');
    END IF;
  ELSIF p_key = 'default_tax_rate' THEN
    IF jsonb_typeof(p_value) <> 'number' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The default tax rate must be a number.');
    END IF;
    v_numeric := (p_value #>> '{}')::numeric;
    IF v_numeric < 0 OR v_numeric > 1 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The default tax rate must be between 0 and 1.');
    END IF;
  ELSE
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The setting is not recognised.');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.assert_discount_policy(
  p_business_id uuid, p_outlet_id uuid, p_actor_staff_id uuid,
  p_subtotal numeric, p_discount numeric, p_approval_id uuid, p_approval_hash text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_threshold numeric := 10;
  v_max numeric := 25;
  v_gross numeric;
  v_percent numeric;
  v_capabilities text[];
BEGIN
  IF COALESCE(p_discount, 0) <= 0 THEN
    RETURN;
  END IF;

  SELECT capabilities INTO v_capabilities FROM bar_local.staff
   WHERE id = p_actor_staff_id AND business_id = p_business_id AND status = 'active';
  IF NOT COALESCE('pos.discount' = ANY(v_capabilities), false) THEN
    PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'This staff member is not authorised to apply a discount or promotion discount.');
  END IF;

  SELECT COALESCE((value #>> '{}')::numeric, 10) INTO v_threshold
    FROM bar_local.settings WHERE key = 'discount_approval_threshold_percent';
  v_threshold := COALESCE(v_threshold, 10);
  SELECT COALESCE((value #>> '{}')::numeric, 25) INTO v_max
    FROM bar_local.settings WHERE key = 'discount_max_percent';
  v_max := COALESCE(v_max, 25);

  v_gross := COALESCE(p_subtotal, 0) + COALESCE(p_discount, 0);
  IF v_gross <= 0 THEN
    RETURN;
  END IF;
  v_percent := (COALESCE(p_discount, 0) / v_gross) * 100;

  IF v_percent > v_max THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED',
      format('Discount of %s%% exceeds the configured maximum of %s%%.', round(v_percent, 2), round(v_max, 2)));
  END IF;

  IF v_percent > v_threshold THEN
    PERFORM bar_local.consume_approval(p_approval_id, p_approval_hash, 'pos.discount',
      p_business_id, p_outlet_id, p_actor_staff_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.enforce_sale_discount_capability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_capabilities text[];
  v_discount numeric;
  v_max numeric := 25;
  v_gross numeric;
  v_percent numeric;
BEGIN
  v_discount := GREATEST(COALESCE(NEW.discount, 0), COALESCE(NEW.promotion_discount, 0));
  IF v_discount > 0 THEN
    SELECT capabilities INTO v_capabilities FROM bar_local.staff
     WHERE id = NEW.actor_staff_id AND business_id = NEW.business_id AND status = 'active';
    IF NOT COALESCE('pos.discount' = ANY(v_capabilities), false) THEN
      PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'This staff member is not authorised to apply a discount or promotion discount.');
    END IF;

    SELECT COALESCE((value #>> '{}')::numeric, 25) INTO v_max
      FROM bar_local.settings WHERE key = 'discount_max_percent';
    v_max := COALESCE(v_max, 25);
    v_gross := COALESCE(NEW.subtotal, 0) + v_discount;
    IF v_gross > 0 THEN
      v_percent := (v_discount / v_gross) * 100;
      IF v_percent > v_max THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED',
          format('Discount of %s%% exceeds the configured maximum of %s%%.', round(v_percent, 2), round(v_max, 2)));
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_discount_capability_guard ON bar_local.sales;
CREATE TRIGGER sales_discount_capability_guard
  BEFORE INSERT OR UPDATE OF discount, promotion_discount ON bar_local.sales
  FOR EACH ROW EXECUTE FUNCTION bar_local.enforce_sale_discount_capability();

CREATE OR REPLACE FUNCTION bar_local.cmd_sale_commit(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_shift bar_local.shifts%ROWTYPE;
  v_tab bar_local.tabs%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_sale_id uuid;
  v_receipt jsonb;
  v_result jsonb;
  v_series text;
  v_subtotal numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_discount numeric(14,2) := 0;
  v_tip numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_change numeric(14,2) := 0;
  v_customer uuid;
  v_line_no integer := 0;
  v_tab_id uuid := NULLIF(v_payload->>'tab_id', '')::uuid;
  v_events jsonb;
  v_promotion_code text := NULLIF(btrim(COALESCE(v_payload->>'promotion_code', '')), '');
  v_promotion_result jsonb;
  v_promotion jsonb;
  v_promotion_discount numeric(14,2) := 0;
  v_line_promo numeric(14,2);
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence(true);
  BEGIN
    v_shift := bar_local.require_open_shift(v_ctx.business_id, v_ctx.outlet_id, (v_payload->>'shift_id')::uuid, v_ctx.staff_id, true);
    v_customer := NULLIF(v_payload->>'customer_id', '')::uuid;
    v_discount := COALESCE((v_payload->>'discount_amount')::numeric, 0);
    v_tip := COALESCE((v_payload->>'tip_amount')::numeric, 0);
    IF v_discount < 0 OR v_tip < 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Discount and tip cannot be negative.');
    END IF;

    IF v_tab_id IS NOT NULL THEN
      SELECT * INTO v_tab FROM bar_local.tabs WHERE id = v_tab_id FOR UPDATE;
      IF NOT FOUND OR v_tab.business_id <> v_ctx.business_id OR v_tab.outlet_id <> v_ctx.outlet_id THEN
        PERFORM bar_local.raise_business('TAB_NOT_FOUND', 'The tab could not be found in this outlet.');
      END IF;
      IF v_tab.status <> 'open' THEN
        PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'This tab is already settled or voided.');
      END IF;
      IF v_tab.version <> (v_payload->>'expected_tab_version')::integer THEN
        PERFORM bar_local.raise_business('TAB_VERSION_CONFLICT', 'The tab changed on another till. Refresh before settling.');
      END IF;
      IF v_tab.owner_staff_id <> v_ctx.staff_id AND v_ctx.role NOT IN ('owner', 'manager') THEN
        PERFORM bar_local.raise_business('TAB_NOT_OWNED', 'This tab belongs to another operator.');
      END IF;
      IF jsonb_array_length(COALESCE(v_payload->'items', '[]'::jsonb)) > 0 THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_lines
          FROM bar_local.price_and_deplete_items(v_ctx.business_id, v_ctx.outlet_id, v_payload->'items',
               (p_envelope->>'operation_id')::uuid, v_shift.business_date, true) p;
        SELECT COALESCE(MAX(line_number), 0) INTO v_line_no FROM bar_local.tab_lines WHERE tab_id = v_tab_id;
        FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
        LOOP
          v_line_no := v_line_no + 1;
          INSERT INTO bar_local.tab_lines
            (tab_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
             line_subtotal, line_tax, line_total, notes, modifier_snapshot, recipe_cost, recipe_snapshot, operation_id)
          VALUES (v_tab_id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
                  (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
                  (v_line->>'line_subtotal')::numeric, (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
                  v_line->>'notes', COALESCE(v_line->'modifier_snapshot', '[]'::jsonb),
                  COALESCE((v_line->>'recipe_cost')::numeric, 0), COALESCE(v_line->'recipe_snapshot', '[]'::jsonb),
                  (p_envelope->>'operation_id')::uuid);
        END LOOP;
      END IF;
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'tab_line_id', tl.id, 'line_number', tl.line_number, 'product_id', tl.product_id,
        'name', tl.name_snapshot, 'sku', tl.sku_snapshot, 'quantity', tl.quantity,
        'unit_price', tl.unit_price, 'tax_rate', tl.tax_rate, 'line_subtotal', tl.line_subtotal,
        'line_tax', tl.line_tax, 'line_total', tl.line_total, 'notes', tl.notes,
        'category', p.category, 'modifier_snapshot', tl.modifier_snapshot,
        'recipe_cost', tl.recipe_cost, 'recipe_snapshot', tl.recipe_snapshot,
        'promotion_code', tl.promotion_code, 'promotion_discount', 0
        ) ORDER BY tl.line_number), '[]'::jsonb) INTO v_lines
        FROM bar_local.tab_lines tl
        JOIN bar_local.products p ON p.id = tl.product_id
       WHERE tl.tab_id = v_tab_id AND tl.status = 'open';
      IF jsonb_array_length(v_lines) = 0 THEN
        PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'This tab has no lines to settle.');
      END IF;
    ELSE
      SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_lines
        FROM bar_local.price_and_deplete_items(v_ctx.business_id, v_ctx.outlet_id, v_payload->'items',
             (p_envelope->>'operation_id')::uuid, v_shift.business_date, true) p;
    END IF;

    IF v_promotion_code IS NOT NULL THEN
      v_promotion_result := bar_local.allocate_promotion_discount(
        v_promotion_code, v_ctx.business_id, v_shift.business_date, v_lines);
      v_lines := v_promotion_result->'lines';
      v_promotion := v_promotion_result->'promotion';
      v_promotion_discount := (v_promotion_result->>'discount')::numeric;
    END IF;
    v_lines := bar_local.finalize_line_discounts(v_lines, v_discount);
    v_discount := v_discount + v_promotion_discount;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_subtotal := v_subtotal + ((v_line->>'line_subtotal')::numeric - (v_line->>'line_discount')::numeric);
      v_tax := v_tax + (v_line->>'line_tax')::numeric;
    END LOOP;
    v_total := v_subtotal + v_tax + v_tip;

    PERFORM bar_local.assert_discount_policy(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id,
      v_subtotal, v_discount, NULLIF(v_payload->>'approval_id', '')::uuid, p_approval_hash);

    SELECT COALESCE(value #>> '{}', 'BAR') INTO v_series FROM bar_local.settings WHERE key = 'receipt_series';
    v_series := COALESCE(v_series, 'BAR');

    INSERT INTO bar_local.sales
      (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number,
       receipt_series, business_date, subtotal, discount, tax, tip, total, customer_id,
       walk_in_name, note, promotion_code, promotion_discount, promotion_snapshot, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_shift.id, v_ctx.device_id, v_ctx.staff_id, v_tab_id,
       v_seq.receipt_sequence, v_series, v_shift.business_date, v_subtotal, v_discount, v_tax, v_tip, v_total,
       v_customer, v_payload->>'walk_in_name', v_payload->>'note',
       v_promotion_code, v_promotion_discount, v_promotion, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_sale_id;

    v_line_no := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_line_no := v_line_no + 1;
      v_line_promo := COALESCE((v_line->>'promotion_discount')::numeric, 0);
      INSERT INTO bar_local.sale_lines
        (sale_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
         line_subtotal, line_discount, line_tax, line_total, notes, modifier_snapshot, recipe_cost,
         recipe_snapshot, promotion_code, promotion_discount, promotion_snapshot, operation_id)
      VALUES
        (v_sale_id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
         (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
         (v_line->>'line_subtotal')::numeric, (v_line->>'line_discount')::numeric,
         (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
         v_line->>'notes', COALESCE(v_line->'modifier_snapshot', '[]'::jsonb),
         COALESCE((v_line->>'recipe_cost')::numeric, 0), COALESCE(v_line->'recipe_snapshot', '[]'::jsonb),
         CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion_code END,
         v_line_promo,
         CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion END,
         (p_envelope->>'operation_id')::uuid);
    END LOOP;

    IF v_promotion_code IS NOT NULL THEN
      INSERT INTO bar_local.promotion_redemptions
        (business_id, promotion_id, sale_id, code_snapshot, discount, operation_id)
      VALUES
        (v_ctx.business_id, (v_promotion->>'promotion_id')::uuid, v_sale_id,
         v_promotion_code, v_promotion_discount, (p_envelope->>'operation_id')::uuid);
    END IF;

    v_change := bar_local.apply_tenders(v_ctx, v_sale_id, v_shift.id, v_shift.business_date,
      v_payload->'tenders', v_total, v_customer, (p_envelope->>'operation_id')::uuid);

    IF v_tab_id IS NOT NULL THEN
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
      LOOP
        v_line_promo := COALESCE((v_line->>'promotion_discount')::numeric, 0);
        UPDATE bar_local.tab_lines
           SET promotion_code = CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion_code END,
               promotion_discount = v_line_promo,
               promotion_snapshot = CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion END
         WHERE id = (v_line->>'tab_line_id')::uuid;
      END LOOP;
      UPDATE bar_local.tab_lines SET status = 'settled' WHERE tab_id = v_tab_id AND status = 'open';
      UPDATE bar_local.tabs
         SET status = 'settled', closed_at = now(), version = version + 1, settled_sale_id = v_sale_id
       WHERE id = v_tab_id;
    END IF;

    v_receipt := bar_local.build_receipt(v_sale_id) || jsonb_build_object('change', v_change, 'replayed', false);
    INSERT INTO bar_local.print_jobs (business_id, outlet_id, operation_id, sale_id, payload)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, (p_envelope->>'operation_id')::uuid, v_sale_id, v_receipt);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'sale.committed', (p_envelope->>'operation_id')::uuid, NULL, v_receipt);
    v_events := jsonb_build_array(jsonb_build_object(
      'event_type', 'sale.committed',
      'payload', jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt, 'shift_id', v_shift.id, 'tab_id', v_tab_id)
    ));
    v_result := jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt, 'change', v_change,
      'promotion_code', v_promotion_code, 'promotion_discount', v_promotion_discount);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_receipt, v_events, v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_tab_settle(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_tab bar_local.tabs%ROWTYPE;
  v_shift bar_local.shifts%ROWTYPE;
  v_lines jsonb;
  v_line jsonb;
  v_sale_id uuid;
  v_receipt jsonb;
  v_series text;
  v_subtotal numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_discount numeric(14,2) := COALESCE((v_payload->>'discount_amount')::numeric, 0);
  v_tip numeric(14,2) := COALESCE((v_payload->>'tip_amount')::numeric, 0);
  v_total numeric(14,2) := 0;
  v_change numeric(14,2) := 0;
  v_customer uuid := NULLIF(v_payload->>'customer_id', '')::uuid;
  v_line_no integer := 0;
  v_promotion_code text := NULLIF(btrim(COALESCE(v_payload->>'promotion_code', '')), '');
  v_promotion_result jsonb;
  v_promotion jsonb;
  v_promotion_discount numeric(14,2) := 0;
  v_line_promo numeric(14,2);
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence(true);
  BEGIN
    SELECT * INTO v_tab FROM bar_local.tabs WHERE id = (v_payload->>'tab_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_tab.business_id <> v_ctx.business_id OR v_tab.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('TAB_NOT_FOUND', 'The tab could not be found in this outlet.');
    END IF;
    IF v_tab.status <> 'open' THEN
      PERFORM bar_local.raise_business('DUPLICATE_SETTLEMENT', 'This tab has already been settled.');
    END IF;
    IF v_tab.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('TAB_VERSION_CONFLICT', 'The tab changed on another till. Refresh before settling.');
    END IF;
    IF v_tab.owner_staff_id <> v_ctx.staff_id AND v_ctx.role NOT IN ('owner', 'manager') THEN
      PERFORM bar_local.raise_business('TAB_NOT_OWNED', 'This tab belongs to another operator.');
    END IF;
    SELECT * INTO v_shift FROM bar_local.shifts
     WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND staff_id = v_ctx.staff_id AND status = 'open'
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open a shift before settling tabs.');
    END IF;
    IF v_discount < 0 OR v_tip < 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Discount and tip cannot be negative.');
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'tab_line_id', tl.id, 'line_number', tl.line_number, 'product_id', tl.product_id,
        'name', tl.name_snapshot, 'sku', tl.sku_snapshot, 'quantity', tl.quantity,
        'unit_price', tl.unit_price, 'tax_rate', tl.tax_rate, 'line_subtotal', tl.line_subtotal,
        'line_tax', tl.line_tax, 'line_total', tl.line_total, 'notes', tl.notes,
        'category', p.category, 'modifier_snapshot', tl.modifier_snapshot,
        'recipe_cost', tl.recipe_cost, 'recipe_snapshot', tl.recipe_snapshot,
        'promotion_code', tl.promotion_code, 'promotion_discount', 0
      ) ORDER BY tl.line_number), '[]'::jsonb) INTO v_lines
      FROM bar_local.tab_lines tl
      JOIN bar_local.products p ON p.id = tl.product_id
     WHERE tl.tab_id = v_tab.id AND tl.status = 'open';
    IF jsonb_array_length(v_lines) = 0 THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'This tab has no lines to settle.');
    END IF;

    IF v_promotion_code IS NOT NULL THEN
      v_promotion_result := bar_local.allocate_promotion_discount(
        v_promotion_code, v_ctx.business_id, v_shift.business_date, v_lines);
      v_lines := v_promotion_result->'lines';
      v_promotion := v_promotion_result->'promotion';
      v_promotion_discount := (v_promotion_result->>'discount')::numeric;
    END IF;
    v_lines := bar_local.finalize_line_discounts(v_lines, v_discount);
    v_discount := v_discount + v_promotion_discount;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_subtotal := v_subtotal + ((v_line->>'line_subtotal')::numeric - (v_line->>'line_discount')::numeric);
      v_tax := v_tax + (v_line->>'line_tax')::numeric;
    END LOOP;
    v_total := v_subtotal + v_tax + v_tip;

    PERFORM bar_local.assert_discount_policy(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id,
      v_subtotal, v_discount, NULLIF(v_payload->>'approval_id', '')::uuid, p_approval_hash);

    SELECT COALESCE(value #>> '{}', 'BAR') INTO v_series FROM bar_local.settings WHERE key = 'receipt_series';
    INSERT INTO bar_local.sales
      (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number,
       receipt_series, business_date, subtotal, discount, tax, tip, total, customer_id,
       promotion_code, promotion_discount, promotion_snapshot, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_shift.id, v_ctx.device_id, v_ctx.staff_id, v_tab.id,
       v_seq.receipt_sequence, COALESCE(v_series, 'BAR'), v_shift.business_date, v_subtotal, v_discount,
       v_tax, v_tip, v_total, v_customer, v_promotion_code, v_promotion_discount, v_promotion,
       (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_sale_id;

    v_line_no := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_line_no := v_line_no + 1;
      v_line_promo := COALESCE((v_line->>'promotion_discount')::numeric, 0);
      INSERT INTO bar_local.sale_lines
        (sale_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
         line_subtotal, line_discount, line_tax, line_total, notes, modifier_snapshot, recipe_cost,
         recipe_snapshot, promotion_code, promotion_discount, promotion_snapshot, operation_id)
      VALUES
        (v_sale_id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
         (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
         (v_line->>'line_subtotal')::numeric, (v_line->>'line_discount')::numeric,
         (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
         v_line->>'notes', COALESCE(v_line->'modifier_snapshot', '[]'::jsonb),
         COALESCE((v_line->>'recipe_cost')::numeric, 0), COALESCE(v_line->'recipe_snapshot', '[]'::jsonb),
         CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion_code END,
         v_line_promo,
         CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion END,
         (p_envelope->>'operation_id')::uuid);
      UPDATE bar_local.tab_lines
         SET promotion_code = CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion_code END,
             promotion_discount = v_line_promo,
             promotion_snapshot = CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion END
       WHERE id = (v_line->>'tab_line_id')::uuid;
    END LOOP;

    IF v_promotion_code IS NOT NULL THEN
      INSERT INTO bar_local.promotion_redemptions
        (business_id, promotion_id, sale_id, code_snapshot, discount, operation_id)
      VALUES
        (v_ctx.business_id, (v_promotion->>'promotion_id')::uuid, v_sale_id,
         v_promotion_code, v_promotion_discount, (p_envelope->>'operation_id')::uuid);
    END IF;

    v_change := bar_local.apply_tenders(v_ctx, v_sale_id, v_shift.id, v_shift.business_date,
      v_payload->'tenders', v_total, v_customer, (p_envelope->>'operation_id')::uuid);
    UPDATE bar_local.tab_lines SET status = 'settled' WHERE tab_id = v_tab.id AND status = 'open';
    UPDATE bar_local.tabs SET status = 'settled', closed_at = now(), version = version + 1, settled_sale_id = v_sale_id
     WHERE id = v_tab.id;
    v_receipt := bar_local.build_receipt(v_sale_id) || jsonb_build_object('change', v_change, 'replayed', false);
    INSERT INTO bar_local.print_jobs (business_id, outlet_id, operation_id, sale_id, payload)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, (p_envelope->>'operation_id')::uuid, v_sale_id, v_receipt);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'tab.settled', (p_envelope->>'operation_id')::uuid, NULL, v_receipt);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt,
        'promotion_code', v_promotion_code, 'promotion_discount', v_promotion_discount),
      v_receipt, jsonb_build_array(jsonb_build_object('event_type','sale.committed','payload',v_receipt)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt,
      'result', jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt,
        'promotion_code', v_promotion_code, 'promotion_discount', v_promotion_discount));
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_staff_status(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_target bar_local.staff%ROWTYPE;
  v_active_owners integer;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_target FROM bar_local.staff
     WHERE id = (v_payload->>'staff_id')::uuid AND business_id = v_ctx.business_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('STAFF_NOT_FOUND', 'The staff identity was not found in this business.');
    END IF;
    IF v_target.role = 'owner' AND v_ctx.role <> 'owner' THEN
      PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'Only an owner may change an owner identity.');
    END IF;
    IF v_target.role IN ('manager','stock','finance') AND v_ctx.role <> 'owner' THEN
      PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'Only an owner may change manager, stock or finance identities.');
    END IF;
    IF v_target.id = v_ctx.staff_id THEN
      PERFORM bar_local.raise_business('MAKER_CHECKER_VIOLATION', 'You cannot change your own staff status.');
    END IF;
    IF v_target.role = 'owner' AND v_target.status = 'active' AND v_payload->>'status' = 'suspended' THEN
      SELECT count(*) INTO v_active_owners FROM bar_local.staff
       WHERE business_id = v_ctx.business_id AND role = 'owner' AND status = 'active' AND id <> v_target.id;
      IF v_active_owners = 0 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'At least one active owner must remain.');
      END IF;
    END IF;
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'staff.manage',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    UPDATE bar_local.staff
       SET status = v_payload->>'status', version = version + 1, updated_at = now()
     WHERE id = v_target.id;
    UPDATE bar_local.sessions SET revoked_at = now()
     WHERE staff_id = v_target.id AND revoked_at IS NULL;
    v_result := jsonb_build_object('staff_id', v_target.id, 'status', v_payload->>'status');
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'staff.status', (p_envelope->>'operation_id')::uuid,
      jsonb_build_object('status', v_target.status, 'version', v_target.version), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type','staff.status','payload',v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.validate_setting_value(text,jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.assert_discount_policy(uuid,uuid,uuid,numeric,numeric,uuid,text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.enforce_sale_discount_capability() OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.cmd_sale_commit(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.cmd_tab_settle(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.cmd_staff_status(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;

ALTER FUNCTION bar_local.assert_discount_policy(uuid,uuid,uuid,numeric,numeric,uuid,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.assert_discount_policy(uuid,uuid,uuid,numeric,numeric,uuid,text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.enforce_sale_discount_capability() SECURITY DEFINER;
ALTER FUNCTION bar_local.enforce_sale_discount_capability() SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_sale_commit(text,uuid,jsonb,text,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_sale_commit(text,uuid,jsonb,text,text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_tab_settle(text,uuid,jsonb,text,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_tab_settle(text,uuid,jsonb,text,text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_staff_status(text,uuid,jsonb,text,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_staff_status(text,uuid,jsonb,text,text) SET search_path = pg_catalog, bar_local;

REVOKE ALL ON FUNCTION bar_local.validate_setting_value(text,jsonb) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.assert_discount_policy(uuid,uuid,uuid,numeric,numeric,uuid,text) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.enforce_sale_discount_capability() FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cmd_sale_commit(text,uuid,jsonb,text,text) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cmd_tab_settle(text,uuid,jsonb,text,text) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cmd_staff_status(text,uuid,jsonb,text,text) FROM PUBLIC, bar_local_runtime;

GRANT EXECUTE ON FUNCTION bar_local.cmd_sale_commit(text,uuid,jsonb,text,text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_tab_settle(text,uuid,jsonb,text,text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_staff_status(text,uuid,jsonb,text,text) TO bar_local_runtime;
