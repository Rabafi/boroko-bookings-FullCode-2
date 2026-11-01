-- Post-close corrections never rewrite a closed trading day. A manager-approved
-- correction posts a current-business-date compensating return, linked to the
-- original sale and its original receipt, so closed-day totals and receipts
-- remain unchanged while the current period carries the refund and stock effect.
ALTER TABLE bar_local.sale_return_line_allocations
  ADD COLUMN post_close_operation_id uuid REFERENCES bar_local.operations(operation_id);
CREATE INDEX sale_return_line_allocations_post_close_idx
  ON bar_local.sale_return_line_allocations (post_close_operation_id)
  WHERE post_close_operation_id IS NOT NULL;

CREATE TABLE bar_local.sale_post_close_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  original_sale_id uuid NOT NULL REFERENCES bar_local.sales(id),
  correction_sale_id uuid NOT NULL UNIQUE REFERENCES bar_local.sales(id),
  correcting_shift_id uuid NOT NULL REFERENCES bar_local.shifts(id),
  requested_by uuid NOT NULL REFERENCES bar_local.staff(id),
  approved_by uuid NOT NULL REFERENCES bar_local.staff(id),
  approval_id uuid NOT NULL REFERENCES bar_local.approvals(id),
  operation_id uuid NOT NULL UNIQUE REFERENCES bar_local.operations(operation_id),
  kind text NOT NULL CHECK (kind IN ('return', 'void')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  original_business_date date NOT NULL,
  business_date date NOT NULL,
  original_status text NOT NULL,
  original_total numeric(14,2) NOT NULL,
  subtotal numeric(14,2) NOT NULL,
  discount numeric(14,2) NOT NULL,
  tax numeric(14,2) NOT NULL,
  tip numeric(14,2) NOT NULL,
  total numeric(14,2) NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_post_close_corrections_original_idx
  ON bar_local.sale_post_close_corrections (original_sale_id, created_at DESC);
CREATE INDEX sale_post_close_corrections_scope_idx
  ON bar_local.sale_post_close_corrections (business_id, outlet_id, business_date DESC);

REVOKE ALL ON bar_local.sale_post_close_corrections FROM PUBLIC;
REVOKE ALL ON bar_local.sale_post_close_corrections FROM bar_local_runtime;

-- The original sale and its closed day are read-only. The correction sale is
-- the only financial mutation, and every quantity/value allocation is recorded
-- against the original line so repeated corrections cannot exceed the original.
CREATE OR REPLACE FUNCTION bar_local.reverse_sale_after_close(
  p_ctx bar_local.session_context,
  p_operation_id uuid,
  p_receipt_sequence bigint,
  p_original_sale_id uuid,
  p_lines jsonb,
  p_reason text,
  p_disposition text,
  p_kind text,
  p_approval_id uuid
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_original bar_local.sales%ROWTYPE;
  v_original_shift bar_local.shifts%ROWTYPE;
  v_correcting_shift bar_local.shifts%ROWTYPE;
  v_original_line bar_local.sale_lines%ROWTYPE;
  v_requested_lines jsonb;
  v_line jsonb;
  v_stored_line jsonb;
  v_recipe_line jsonb;
  v_tender bar_local.sale_tenders%ROWTYPE;
  v_voucher bar_local.vouchers%ROWTYPE;
  v_qty numeric(18,6);
  v_prior_post_close_qty numeric(18,6);
  v_cumulative_qty numeric(18,6);
  v_ratio numeric;
  v_gross_target numeric(14,2);
  v_discount_target numeric(14,2);
  v_tax_target numeric(14,2);
  v_prior_gross numeric(14,2);
  v_prior_discount numeric(14,2);
  v_prior_tax numeric(14,2);
  v_gross numeric(14,2);
  v_discount numeric(14,2);
  v_tax numeric(14,2);
  v_net numeric(14,2);
  v_return_lines jsonb := '[]'::jsonb;
  v_return_subtotal numeric(14,2) := 0;
  v_return_tax numeric(14,2) := 0;
  v_return_tip numeric(14,2) := 0;
  v_tip_remaining numeric(14,2) := 0;
  v_return_total numeric(14,2);
  v_sale_id uuid;
  v_return_line_id uuid;
  v_return_tender_id uuid;
  v_stock_product_id uuid;
  v_stock_qty numeric(18,6);
  v_tender_total numeric(14,2) := 0;
  v_prior_refund_total numeric(14,2) := 0;
  v_cumulative_refund numeric(14,2);
  v_prior_tender_refund numeric(14,2);
  v_tender_capacity numeric(14,2);
  v_tender_target numeric(14,2);
  v_share numeric(14,2);
  v_remaining numeric(14,2);
  v_pass integer;
  v_line_no integer := 0;
  v_series text;
  v_receipt jsonb;
  v_approved_by uuid;
BEGIN
  IF p_kind NOT IN ('return', 'void') THEN
    PERFORM bar_local.raise_business('CORRECTION_KIND_INVALID', 'A post-close correction must be a return or a remaining-sale cancellation.');
  END IF;
  IF p_kind = 'return' AND (jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0) THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'At least one sale line is required for a post-close return.');
  END IF;
  IF p_kind = 'void' AND p_lines IS NOT NULL AND jsonb_typeof(p_lines) = 'array' AND jsonb_array_length(p_lines) > 0 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A remaining-sale cancellation calculates its own lines; do not supply lines.');
  END IF;

  SELECT * INTO v_original FROM bar_local.sales WHERE id = p_original_sale_id FOR UPDATE;
  IF NOT FOUND OR v_original.business_id <> p_ctx.business_id OR v_original.outlet_id <> p_ctx.outlet_id THEN
    PERFORM bar_local.raise_business('SALE_NOT_FOUND', 'The original sale could not be found in this outlet.');
  END IF;
  IF v_original.original_sale_id IS NOT NULL THEN
    PERFORM bar_local.raise_business('POST_CLOSE_ORIGINAL_REQUIRED', 'A correction receipt cannot be corrected again. Select the original sale.');
  END IF;
  IF v_original.status = 'voided' THEN
    PERFORM bar_local.raise_business('SALE_ALREADY_VOIDED', 'This sale has already been cancelled.');
  END IF;

  SELECT * INTO v_original_shift FROM bar_local.shifts WHERE id = v_original.shift_id FOR UPDATE;
  IF NOT FOUND OR v_original_shift.business_id <> p_ctx.business_id OR v_original_shift.outlet_id <> p_ctx.outlet_id THEN
    PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'The original sale shift could not be verified.');
  END IF;
  IF v_original_shift.status = 'open' THEN
    PERFORM bar_local.raise_business('SALE_STILL_OPEN', 'This sale still belongs to an open drawer. Use the normal return or void workflow before the drawer is closed.');
  END IF;

  SELECT * INTO v_correcting_shift FROM bar_local.shifts
   WHERE business_id = p_ctx.business_id AND outlet_id = p_ctx.outlet_id
     AND staff_id = p_ctx.staff_id AND status = 'open'
   ORDER BY opened_at DESC, id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open your own shift drawer before recording a post-close correction.');
  END IF;
  IF EXISTS (
    SELECT 1 FROM bar_local.accounting_periods
     WHERE period = to_char(bar_local.current_business_date(), 'YYYY-MM') AND status = 'closed'
  ) THEN
    PERFORM bar_local.raise_business('PERIOD_LOCKED', 'The current accounting period is closed. The correction cannot be posted to a closed period.');
  END IF;

  IF p_kind = 'void' AND v_original.tip > 0 THEN
    IF EXISTS (SELECT 1 FROM bar_local.tip_allocations WHERE sale_id = v_original.id) THEN
      PERFORM bar_local.raise_business('TIP_RECONCILIATION_REQUIRED',
        'This sale has tips allocated to staff. Reconcile its tip allocations and any payouts before cancelling it. No refund or stock reversal has been recorded.');
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM bar_local.return_allocation_reconciliation
     WHERE original_sale_id = v_original.id
  ) THEN
    PERFORM bar_local.raise_business('RETURN_RECONCILIATION_REQUIRED',
      'Historical return allocations for this sale must be reconciled before another return can be processed.');
  END IF;

  PERFORM 1 FROM bar_local.sale_tenders WHERE sale_id = v_original.id AND amount > 0 FOR UPDATE;
  SELECT COALESCE(sum(amount), 0) INTO v_tender_total FROM bar_local.sale_tenders WHERE sale_id = v_original.id AND amount > 0;
  SELECT COALESCE(sum(amount), 0) INTO v_prior_refund_total
    FROM bar_local.sale_return_tender_allocations WHERE original_sale_id = v_original.id;
  SELECT COALESCE(sum(-s.tip), 0) INTO v_tip_remaining
    FROM bar_local.sales s WHERE s.original_sale_id = v_original.id AND s.tip < 0;
  v_tip_remaining := v_original.tip - v_tip_remaining;

  IF p_kind = 'void' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'sale_line_id', l.id,
        'quantity', l.quantity - l.returned_quantity - COALESCE(pc.quantity, 0))
      ORDER BY l.line_number), '[]'::jsonb) INTO v_requested_lines
      FROM bar_local.sale_lines l
      LEFT JOIN (
        SELECT a.original_sale_line_id, sum(a.quantity) AS quantity
          FROM bar_local.sale_return_line_allocations a
         WHERE a.post_close_operation_id IS NOT NULL
         GROUP BY a.original_sale_line_id
      ) pc ON pc.original_sale_line_id = l.id
     WHERE l.sale_id = v_original.id
       AND l.quantity - l.returned_quantity - COALESCE(pc.quantity, 0) > 0;
    IF jsonb_array_length(v_requested_lines) = 0 AND v_tip_remaining <= 0 THEN
      PERFORM bar_local.raise_business('SALE_ALREADY_VOIDED', 'This sale has no remaining items or unallocated tip to cancel.');
    END IF;
    v_return_tip := greatest(0, v_tip_remaining);
  ELSE
    v_requested_lines := p_lines;
  END IF;

  IF jsonb_typeof(v_requested_lines) IS DISTINCT FROM 'array' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The correction lines are invalid.');
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_requested_lines)) <>
     (SELECT count(DISTINCT value->>'sale_line_id') FROM jsonb_array_elements(v_requested_lines)) THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A sale line may appear only once in a correction request.');
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(v_requested_lines)
  LOOP
    SELECT * INTO v_original_line FROM bar_local.sale_lines
     WHERE id = (v_line->>'sale_line_id')::uuid AND sale_id = v_original.id FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A correction line does not belong to the original sale.');
    END IF;
    SELECT COALESCE(sum(a.quantity), 0) INTO v_prior_post_close_qty
      FROM bar_local.sale_return_line_allocations a
     WHERE a.original_sale_line_id = v_original_line.id AND a.post_close_operation_id IS NOT NULL;
    v_qty := (v_line->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > (v_original_line.quantity - v_original_line.returned_quantity - v_prior_post_close_qty) THEN
      PERFORM bar_local.raise_business('RETURN_EXCEEDS_ORIGINAL', 'Correction quantity exceeds the original quantity remaining after previous returns and corrections.');
    END IF;
    v_cumulative_qty := v_original_line.returned_quantity + v_prior_post_close_qty + v_qty;
    v_ratio := v_cumulative_qty / v_original_line.quantity;
    v_gross_target := CASE WHEN v_cumulative_qty = v_original_line.quantity THEN v_original_line.line_subtotal ELSE round(v_original_line.line_subtotal * v_ratio, 2) END;
    v_discount_target := CASE WHEN v_cumulative_qty = v_original_line.quantity THEN v_original_line.line_discount ELSE round(v_original_line.line_discount * v_ratio, 2) END;
    v_tax_target := CASE WHEN v_cumulative_qty = v_original_line.quantity THEN v_original_line.line_tax ELSE round(v_original_line.line_tax * v_ratio, 2) END;
    SELECT COALESCE(sum(a.gross_amount), 0), COALESCE(sum(a.discount_amount), 0), COALESCE(sum(a.tax_amount), 0)
      INTO v_prior_gross, v_prior_discount, v_prior_tax
      FROM bar_local.sale_return_line_allocations a WHERE a.original_sale_line_id = v_original_line.id;
    v_gross := v_gross_target - v_prior_gross;
    v_discount := v_discount_target - v_prior_discount;
    v_tax := v_tax_target - v_prior_tax;
    v_net := v_gross - v_discount;
    IF v_gross < 0 OR v_discount < 0 OR v_tax < 0 OR v_net < 0 THEN
      PERFORM bar_local.raise_business('RETURN_ALLOCATION_INVALID', 'The remaining original line value cannot be allocated safely.');
    END IF;
    v_return_subtotal := v_return_subtotal + v_net;
    v_return_tax := v_return_tax + v_tax;
    v_return_lines := v_return_lines || jsonb_build_array(jsonb_build_object(
      'sale_line_id', v_original_line.id, 'quantity', v_qty, 'gross', v_gross,
      'discount', v_discount, 'tax', v_tax, 'net', v_net));

    IF p_disposition = 'restock' THEN
      IF jsonb_typeof(v_original_line.recipe_snapshot) = 'array' AND jsonb_array_length(v_original_line.recipe_snapshot) > 0 THEN
        FOR v_recipe_line IN SELECT value FROM jsonb_array_elements(v_original_line.recipe_snapshot)
        LOOP
          v_stock_product_id := (v_recipe_line->>'ingredient_product_id')::uuid;
          IF EXISTS (SELECT 1 FROM bar_local.stock_movements
                      WHERE operation_id = v_original_line.operation_id AND product_id = v_stock_product_id
                        AND reason = 'sale.recipe.depletion') THEN
            v_stock_qty := round((v_recipe_line->>'quantity_per_unit')::numeric * v_qty, 6);
            INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
            VALUES (p_ctx.business_id, p_ctx.outlet_id, v_stock_product_id, 0)
            ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
            UPDATE bar_local.stock_balances SET quantity = quantity + v_stock_qty, version = version + 1, updated_at = now()
             WHERE business_id = p_ctx.business_id AND outlet_id = p_ctx.outlet_id AND product_id = v_stock_product_id;
            INSERT INTO bar_local.stock_movements (business_id, outlet_id, product_id, delta, reason, operation_id, business_date, reference)
            VALUES (p_ctx.business_id, p_ctx.outlet_id, v_stock_product_id, v_stock_qty, 'sale.return.restock', p_operation_id,
              bar_local.current_business_date(), 'post-close:' || p_original_sale_id::text || ':line:' || v_original_line.id::text);
          END IF;
        END LOOP;
      ELSIF EXISTS (SELECT 1 FROM bar_local.stock_movements
                     WHERE operation_id = v_original_line.operation_id AND product_id = v_original_line.product_id
                       AND reason = 'sale.depletion') THEN
        INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
        VALUES (p_ctx.business_id, p_ctx.outlet_id, v_original_line.product_id, 0)
        ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
        UPDATE bar_local.stock_balances SET quantity = quantity + v_qty, version = version + 1, updated_at = now()
         WHERE business_id = p_ctx.business_id AND outlet_id = p_ctx.outlet_id AND product_id = v_original_line.product_id;
        INSERT INTO bar_local.stock_movements (business_id, outlet_id, product_id, delta, reason, operation_id, business_date, reference)
        VALUES (p_ctx.business_id, p_ctx.outlet_id, v_original_line.product_id, v_qty, 'sale.return.restock', p_operation_id,
          bar_local.current_business_date(), 'post-close:' || p_original_sale_id::text || ':line:' || v_original_line.id::text);
      END IF;
    END IF;
  END LOOP;

  v_return_total := v_return_subtotal + v_return_tax + v_return_tip;
  IF v_prior_refund_total + v_return_total > v_tender_total THEN
    PERFORM bar_local.raise_business('RETURN_EXCEEDS_ORIGINAL', 'The correction exceeds the remaining original tender value.');
  END IF;
  IF v_return_total > 0 AND v_tender_total <= 0 THEN
    PERFORM bar_local.raise_business('RETURN_TENDER_UNALLOCATABLE', 'The original sale has no refundable tender balance.');
  END IF;

  SELECT COALESCE(value #>> '{}', 'BAR') INTO v_series FROM bar_local.settings WHERE key = 'receipt_series';
  INSERT INTO bar_local.sales
    (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number, receipt_series,
     business_date, status, subtotal, discount, tax, tip, total, customer_id, note, original_sale_id, operation_id)
  VALUES (p_ctx.business_id, p_ctx.outlet_id, v_correcting_shift.id, p_ctx.device_id, p_ctx.staff_id, NULL,
     p_receipt_sequence, COALESCE(v_series, 'BAR'), bar_local.current_business_date(), 'returned',
     -v_return_subtotal, 0, -v_return_tax, -v_return_tip, -v_return_total, v_original.customer_id,
     p_reason, v_original.id, p_operation_id)
  RETURNING id INTO v_sale_id;

  v_line_no := 0;
  FOR v_stored_line IN SELECT value FROM jsonb_array_elements(v_return_lines)
  LOOP
    v_line_no := v_line_no + 1;
    SELECT * INTO v_original_line FROM bar_local.sale_lines WHERE id = (v_stored_line->>'sale_line_id')::uuid;
    INSERT INTO bar_local.sale_lines
      (sale_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
       line_subtotal, line_discount, line_tax, line_total, notes, modifier_snapshot, recipe_cost, recipe_snapshot,
       promotion_code, promotion_discount, promotion_snapshot, operation_id)
    VALUES (v_sale_id, v_line_no, v_original_line.product_id, v_original_line.name_snapshot, v_original_line.sku_snapshot,
      -(v_stored_line->>'quantity')::numeric, v_original_line.unit_price, v_original_line.tax_rate,
      -(v_stored_line->>'gross')::numeric, -(v_stored_line->>'discount')::numeric, -(v_stored_line->>'tax')::numeric,
      -((v_stored_line->>'net')::numeric + (v_stored_line->>'tax')::numeric), p_reason,
      v_original_line.modifier_snapshot, v_original_line.recipe_cost, v_original_line.recipe_snapshot,
      NULL, 0, NULL, p_operation_id)
    RETURNING id INTO v_return_line_id;
    INSERT INTO bar_local.sale_return_line_allocations
      (business_id, original_sale_id, original_sale_line_id, return_sale_id, return_sale_line_id,
       quantity, gross_amount, discount_amount, tax_amount, post_close_operation_id)
    VALUES (p_ctx.business_id, v_original.id, v_original_line.id, v_sale_id, v_return_line_id,
      (v_stored_line->>'quantity')::numeric, (v_stored_line->>'gross')::numeric,
      (v_stored_line->>'discount')::numeric, (v_stored_line->>'tax')::numeric, p_operation_id);
  END LOOP;

  v_cumulative_refund := v_prior_refund_total + v_return_total;
  v_remaining := v_return_total;
  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_remaining <= 0;
    FOR v_tender IN SELECT * FROM bar_local.sale_tenders WHERE sale_id = v_original.id AND amount > 0 ORDER BY id FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      SELECT COALESCE(sum(amount), 0) INTO v_prior_tender_refund
        FROM bar_local.sale_return_tender_allocations WHERE original_tender_id = v_tender.id;
      v_tender_capacity := v_tender.amount - v_prior_tender_refund;
      IF v_pass = 1 THEN
        v_tender_target := round(v_cumulative_refund * v_tender.amount / v_tender_total, 2);
        v_share := greatest(0, least(v_tender_capacity, v_tender_target - v_prior_tender_refund, v_remaining));
      ELSE
        v_share := greatest(0, least(v_tender_capacity, v_remaining));
      END IF;
      IF v_share > 0 THEN
        INSERT INTO bar_local.sale_tenders
          (sale_id, method, amount, tendered, change_amount, reference, provider_status, voucher_id, customer_id, operation_id)
        VALUES (v_sale_id, v_tender.method, -v_share, NULL, 0, 'post-close:' || v_original.id::text,
          CASE WHEN v_tender.method IN ('card', 'mobile_money', 'bank_transfer', 'external') THEN 'locally_asserted' ELSE 'not_applicable' END,
          v_tender.voucher_id, v_tender.customer_id, p_operation_id)
        RETURNING id INTO v_return_tender_id;
        INSERT INTO bar_local.sale_return_tender_allocations
          (original_sale_id, original_tender_id, return_sale_id, return_tender_id, amount)
        VALUES (v_original.id, v_tender.id, v_sale_id, v_return_tender_id, v_share);
        v_remaining := v_remaining - v_share;
        IF v_tender.method = 'customer_credit' AND v_tender.customer_id IS NOT NULL THEN
          INSERT INTO bar_local.credit_ledger (business_id, customer_id, delta, type, sale_id, operation_id, reference)
          VALUES (p_ctx.business_id, v_tender.customer_id, -v_share, 'sale.return.credit', v_sale_id, p_operation_id, p_original_sale_id::text);
        ELSIF v_tender.method = 'voucher' AND v_tender.voucher_id IS NOT NULL THEN
          SELECT * INTO v_voucher FROM bar_local.vouchers WHERE id = v_tender.voucher_id FOR UPDATE;
          UPDATE bar_local.vouchers SET balance = balance + v_share,
            status = CASE WHEN status = 'redeemed' THEN 'active' ELSE status END, version = version + 1
           WHERE id = v_tender.voucher_id;
          INSERT INTO bar_local.voucher_ledger (voucher_id, delta, type, sale_id, operation_id)
          VALUES (v_tender.voucher_id, v_share, 'sale.return', v_sale_id, p_operation_id);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF v_remaining <> 0 THEN
    PERFORM bar_local.raise_business('RETURN_TENDER_UNALLOCATABLE', 'The correction cannot be allocated within the original tender balances.');
  END IF;

  SELECT approved_by INTO v_approved_by FROM bar_local.approvals WHERE id = p_approval_id;
  INSERT INTO bar_local.sale_post_close_corrections
    (business_id, outlet_id, original_sale_id, correction_sale_id, correcting_shift_id,
     requested_by, approved_by, approval_id, operation_id, kind, reason,
     original_business_date, business_date, original_status, original_total,
     subtotal, discount, tax, tip, total, lines)
  VALUES
    (p_ctx.business_id, p_ctx.outlet_id, v_original.id, v_sale_id, v_correcting_shift.id,
     p_ctx.staff_id, v_approved_by, p_approval_id, p_operation_id, p_kind, p_reason,
     v_original.business_date, bar_local.current_business_date(), v_original.status, v_original.total,
     -v_return_subtotal, 0, -v_return_tax, -v_return_tip, -v_return_total, v_return_lines);

  PERFORM bar_local.post_sale_source_journal(p_ctx, v_sale_id,
    CASE WHEN p_kind = 'void' THEN 'sale.void' ELSE 'sale.return' END, p_operation_id);

  v_receipt := bar_local.build_receipt(v_sale_id);
  RETURN v_receipt || jsonb_build_object(
    'post_close_correction', jsonb_build_object(
      'kind', p_kind,
      'original_sale_id', v_original.id,
      'original_business_date', v_original.business_date,
      'business_date', bar_local.current_business_date(),
      'approved_by', v_approved_by));
END;
$$;
ALTER FUNCTION bar_local.reverse_sale_after_close(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,text,uuid) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.reverse_sale_after_close(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,text,uuid) SECURITY DEFINER;
ALTER FUNCTION bar_local.reverse_sale_after_close(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,text,uuid) SET search_path=pg_catalog,bar_local;
REVOKE ALL ON FUNCTION bar_local.reverse_sale_after_close(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,text,uuid) FROM PUBLIC,bar_local_runtime;

CREATE OR REPLACE FUNCTION bar_local.cmd_sale_correct_after_close(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_original jsonb;
  v_like jsonb;
  v_shift_id uuid;
  v_before numeric;
  v_after numeric;
  v_receipt jsonb;
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
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'pos.void',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    SELECT to_jsonb(s) INTO v_original FROM bar_local.sales s
     WHERE s.id = (v_payload->>'sale_id')::uuid
       AND s.business_id = v_ctx.business_id AND s.outlet_id = v_ctx.outlet_id;
    IF v_original IS NULL THEN
      PERFORM bar_local.raise_business('SALE_NOT_FOUND', 'The original sale could not be found in this outlet.');
    END IF;
    SELECT id INTO v_shift_id FROM bar_local.shifts
     WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
       AND staff_id = v_ctx.staff_id AND status = 'open'
     ORDER BY opened_at DESC, id LIMIT 1;
    IF v_shift_id IS NULL THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open your own shift drawer before recording a post-close correction.');
    END IF;
    v_before := bar_local.expected_shift_cash(v_shift_id);
    v_receipt := bar_local.reverse_sale_after_close(v_ctx, (p_envelope->>'operation_id')::uuid, v_seq.receipt_sequence,
      (v_payload->>'sale_id')::uuid, v_payload->'lines', v_payload->>'reason',
      COALESCE(v_payload->>'disposition', 'restock'), v_payload->>'kind', (v_payload->>'approval_id')::uuid);
    v_after := bar_local.expected_shift_cash(v_shift_id);
    IF v_after < 0 AND v_after < v_before THEN
      PERFORM bar_local.raise_business('DRAWER_AMOUNT_INVALID',
        'This refund exceeds the cash in your current drawer. Reconcile or replenish that drawer before submitting a new authorised correction.');
    END IF;
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'sale.corrected_after_close', (p_envelope->>'operation_id')::uuid,
      jsonb_build_object('sale', v_original, 'payload', v_payload),
      v_receipt);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_receipt, v_receipt,
      jsonb_build_array(jsonb_build_object('event_type', 'sale.corrected_after_close', 'payload', v_receipt)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt, 'result', v_receipt);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;
ALTER FUNCTION bar_local.cmd_sale_correct_after_close(text,uuid,jsonb,text,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_sale_correct_after_close(text,uuid,jsonb,text,text) SET search_path=pg_catalog,bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_sale_correct_after_close(text,uuid,jsonb,text,text) FROM PUBLIC,bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_sale_correct_after_close(text,uuid,jsonb,text,text) TO bar_local_runtime;

INSERT INTO bar_local.runtime_function_allowlist (function_name)
VALUES ('cmd_sale_correct_after_close')
ON CONFLICT (function_name) DO NOTHING;

-- Authenticated correction history for manager review and reports. The query is
-- scoped to the actor's outlet and does not expose table cursors.
CREATE OR REPLACE FUNCTION bar_local.post_close_corrections_list(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_outlet uuid;
  v_limit integer;
  v_cursor text;
  v_cursor_created timestamptz;
  v_cursor_id uuid;
  v_data jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next text;
  v_watermark bigint;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.reports');
  v_outlet := bar_local.query_outlet(v_ctx, v_filters);
  v_limit := LEAST(100, GREATEST(1, COALESCE(NULLIF(v_filters->>'limit', '')::integer, 25)));
  v_cursor := NULLIF(v_filters->>'cursor', '');
  IF v_cursor IS NOT NULL THEN
    IF v_cursor !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f-]{36}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The correction cursor is invalid. Refresh the correction list.');
    END IF;
    v_cursor_created := split_part(v_cursor, '|', 1)::timestamptz;
    v_cursor_id := split_part(v_cursor, '|', 2)::uuid;
  END IF;

  WITH page AS (
    SELECT c.id, c.kind, c.business_date, c.original_business_date, c.reason,
           c.subtotal, c.discount, c.tax, c.tip, c.total, c.lines,
           c.original_sale_id, c.correction_sale_id, c.correcting_shift_id,
           os.receipt_number AS original_receipt_number, os.receipt_series AS original_receipt_series,
           cs.receipt_number AS correction_receipt_number, cs.receipt_series AS correction_receipt_series,
           rs.display_name AS requested_by_name, aps.display_name AS approved_by_name,
           to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM bar_local.sale_post_close_corrections c
      JOIN bar_local.sales os ON os.id = c.original_sale_id
      JOIN bar_local.sales cs ON cs.id = c.correction_sale_id
      JOIN bar_local.staff rs ON rs.id = c.requested_by
      JOIN bar_local.staff aps ON aps.id = c.approved_by
     WHERE c.business_id = v_ctx.business_id AND c.outlet_id = v_outlet
       AND (NULLIF(v_filters->>'from', '') IS NULL OR c.business_date >= (v_filters->>'from')::date)
       AND (NULLIF(v_filters->>'to', '') IS NULL OR c.business_date <= (v_filters->>'to')::date)
       AND (NULLIF(v_filters->>'original_sale_id', '') IS NULL OR c.original_sale_id = (v_filters->>'original_sale_id')::uuid)
       AND (v_cursor IS NULL OR (c.created_at, c.id) < (v_cursor_created, v_cursor_id))
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT v_limit + 1
  )
  SELECT count(*) > v_limit INTO v_has_more FROM page;

  WITH page AS (
    SELECT c.id, c.kind, c.business_date, c.original_business_date, c.reason,
           c.subtotal, c.discount, c.tax, c.tip, c.total, c.lines,
           c.original_sale_id, c.correction_sale_id, c.correcting_shift_id,
           os.receipt_number AS original_receipt_number, os.receipt_series AS original_receipt_series,
           cs.receipt_number AS correction_receipt_number, cs.receipt_series AS correction_receipt_series,
           rs.display_name AS requested_by_name, aps.display_name AS approved_by_name,
           to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM bar_local.sale_post_close_corrections c
      JOIN bar_local.sales os ON os.id = c.original_sale_id
      JOIN bar_local.sales cs ON cs.id = c.correction_sale_id
      JOIN bar_local.staff rs ON rs.id = c.requested_by
      JOIN bar_local.staff aps ON aps.id = c.approved_by
     WHERE c.business_id = v_ctx.business_id AND c.outlet_id = v_outlet
       AND (NULLIF(v_filters->>'from', '') IS NULL OR c.business_date >= (v_filters->>'from')::date)
       AND (NULLIF(v_filters->>'to', '') IS NULL OR c.business_date <= (v_filters->>'to')::date)
       AND (NULLIF(v_filters->>'original_sale_id', '') IS NULL OR c.original_sale_id = (v_filters->>'original_sale_id')::uuid)
       AND (v_cursor IS NULL OR (c.created_at, c.id) < (v_cursor_created, v_cursor_id))
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
    INTO v_data FROM page;

  IF v_has_more AND jsonb_array_length(v_data) > 0 THEN
    v_next := (v_data->(jsonb_array_length(v_data) - 1)->>'created_at') || '|' ||
      (v_data->(jsonb_array_length(v_data) - 1)->>'id');
  END IF;
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
    'snapshot_watermark', v_watermark,
    'scope', jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_outlet,
      'device_id', v_ctx.device_id, 'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role),
    'as_of', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'complete', true, 'unavailable', '[]'::jsonb
  );
END;
$$;
REVOKE ALL ON FUNCTION bar_local.post_close_corrections_list(text,uuid,uuid,bigint,jsonb) FROM PUBLIC,bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb)
  RENAME TO query_dispatch_before_post_close;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_post_close(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint, p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_response jsonb;
  v_sale_id uuid;
  v_original_sale_id uuid;
  v_sale_status text;
  v_lines jsonb;
  v_shift_status text;
  v_tip_remaining numeric(14,2);
  v_remaining_items numeric(18,6);
  v_corrections jsonb;
  v_eligible boolean := false;
BEGIN
  IF p_query = 'reports.post_close_corrections' THEN
    RETURN bar_local.post_close_corrections_list(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_filters);
  END IF;
  v_response := bar_local.query_dispatch_before_post_close(
    p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters);
  IF p_query = 'sale.get' AND (v_response->>'complete')::boolean IS TRUE
     AND jsonb_typeof(v_response->'data') = 'object' THEN
    v_sale_id := (v_response#>>'{data,sale_id}')::uuid;
    SELECT s.original_sale_id, s.status, sh.status
      INTO v_original_sale_id, v_sale_status, v_shift_status
      FROM bar_local.sales s JOIN bar_local.shifts sh ON sh.id = s.shift_id
     WHERE s.id = v_sale_id;
    IF jsonb_typeof(v_response#>'{data,lines}') = 'array' THEN
      SELECT COALESCE(jsonb_agg(e.value || jsonb_build_object(
        'post_close_corrected_quantity', COALESCE(pc.quantity, 0)::text,
        'remaining_quantity', greatest(0, l.quantity - l.returned_quantity - COALESCE(pc.quantity, 0))::text
      ) ORDER BY e.ordinality), '[]'::jsonb) INTO v_lines
      FROM jsonb_array_elements(v_response#>'{data,lines}') WITH ORDINALITY e(value, ordinality)
      JOIN bar_local.sale_lines l ON l.id = (e.value->>'sale_line_id')::uuid AND l.sale_id = v_sale_id
      LEFT JOIN (
        SELECT a.original_sale_line_id, sum(a.quantity) AS quantity
          FROM bar_local.sale_return_line_allocations a
         WHERE a.post_close_operation_id IS NOT NULL
         GROUP BY a.original_sale_line_id
      ) pc ON pc.original_sale_line_id = l.id;
      IF jsonb_array_length(v_lines) <> jsonb_array_length(v_response#>'{data,lines}') THEN
        PERFORM bar_local.raise_business('RETURN_RECONCILIATION_REQUIRED',
          'The receipt lines could not be verified. Keep the original operation and ask a manager to reconcile this sale.');
      END IF;
      v_response := jsonb_set(v_response, '{data,lines}', v_lines);
    END IF;
    SELECT COALESCE(sum(greatest(0, l.quantity - l.returned_quantity - COALESCE(pc.quantity, 0))), 0)
      INTO v_remaining_items
      FROM bar_local.sale_lines l
      LEFT JOIN (
        SELECT a.original_sale_line_id, sum(a.quantity) AS quantity
          FROM bar_local.sale_return_line_allocations a
         WHERE a.post_close_operation_id IS NOT NULL
         GROUP BY a.original_sale_line_id
      ) pc ON pc.original_sale_line_id = l.id
     WHERE l.sale_id = v_sale_id;
    SELECT COALESCE((SELECT s.tip FROM bar_local.sales s WHERE s.id = v_sale_id), 0)
      - COALESCE((
          SELECT sum(-s.tip) FROM bar_local.sales s
           WHERE s.original_sale_id = COALESCE(v_original_sale_id, v_sale_id) AND s.tip < 0
        ), 0)
      INTO v_tip_remaining;
    v_eligible := v_shift_status = 'closed' AND v_original_sale_id IS NULL
      AND v_sale_status <> 'voided' AND (v_remaining_items > 0 OR v_tip_remaining > 0);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'correction_sale_id', c.correction_sale_id,
      'kind', c.kind,
      'business_date', c.business_date,
      'original_business_date', c.original_business_date,
      'original_receipt_number', os.receipt_number,
      'correction_receipt_number', cs.receipt_number,
      'subtotal', c.subtotal, 'discount', c.discount, 'tax', c.tax, 'tip', c.tip, 'total', c.total,
      'reason', c.reason,
      'requested_by_name', rs.display_name,
      'approved_by_name', aps.display_name,
      'created_at', c.created_at,
      'lines', c.lines
    ) ORDER BY c.created_at DESC), '[]'::jsonb) INTO v_corrections
      FROM bar_local.sale_post_close_corrections c
      JOIN bar_local.sales os ON os.id = c.original_sale_id
      JOIN bar_local.sales cs ON cs.id = c.correction_sale_id
      JOIN bar_local.staff rs ON rs.id = c.requested_by
      JOIN bar_local.staff aps ON aps.id = c.approved_by
     WHERE c.original_sale_id = COALESCE(v_original_sale_id, v_sale_id);
    v_response := jsonb_set(v_response, '{data}', (v_response->'data') || jsonb_build_object(
      'shift_status', v_shift_status,
      'post_close_eligible', v_eligible,
      'post_close_tip_remaining', v_tip_remaining,
      'post_close_corrections', v_corrections));
  END IF;
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
