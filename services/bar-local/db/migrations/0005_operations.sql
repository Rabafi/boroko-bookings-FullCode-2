-- Corrections, shifts, cash, stock, customers, catalogue, staff, settings and accounting.
CREATE OR REPLACE FUNCTION bar_local.reverse_sale(
  p_ctx bar_local.session_context,
  p_operation_id uuid,
  p_receipt_sequence bigint,
  p_original_sale_id uuid,
  p_lines jsonb,
  p_reason text,
  p_disposition text,
  p_mark_void boolean
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_original bar_local.sales%ROWTYPE;
  v_line jsonb;
  v_original_line bar_local.sale_lines%ROWTYPE;
  v_qty numeric(18,6);
  v_ratio numeric;
  v_return_subtotal numeric(14,2) := 0;
  v_return_tax numeric(14,2) := 0;
  v_return_total numeric(14,2) := 0;
  v_sale_id uuid;
  v_series text;
  v_tender bar_local.sale_tenders%ROWTYPE;
  v_tender_total numeric(14,2) := 0;
  v_refund_remaining numeric(14,2);
  v_share numeric(14,2);
  v_voucher bar_local.vouchers%ROWTYPE;
  v_line_no integer := 0;
BEGIN
  SELECT * INTO v_original FROM bar_local.sales WHERE id = p_original_sale_id FOR UPDATE;
  IF NOT FOUND OR v_original.business_id <> p_ctx.business_id OR v_original.outlet_id <> p_ctx.outlet_id THEN
    PERFORM bar_local.raise_business('SALE_NOT_FOUND', 'The original sale could not be found in this outlet.');
  END IF;
  IF v_original.status = 'voided' THEN
    PERFORM bar_local.raise_business('SALE_ALREADY_VOIDED', 'This sale has already been voided.');
  END IF;
  IF v_original.status = 'returned' AND NOT p_mark_void THEN
    NULL;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_original_line FROM bar_local.sale_lines
     WHERE id = (v_line->>'sale_line_id')::uuid AND sale_id = v_original.id FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A return line does not belong to the original sale.');
    END IF;
    v_qty := (v_line->>'quantity')::numeric;
    IF v_qty <= 0 OR v_qty > (v_original_line.quantity - v_original_line.returned_quantity) THEN
      PERFORM bar_local.raise_business('RETURN_EXCEEDS_ORIGINAL', 'Return quantity exceeds the original quantity remaining.');
    END IF;
    UPDATE bar_local.sale_lines
       SET returned_quantity = returned_quantity + v_qty
     WHERE id = v_original_line.id;
    v_ratio := v_qty / v_original_line.quantity;
    v_return_subtotal := v_return_subtotal + round((v_original_line.line_subtotal - v_original_line.line_discount) * v_ratio, 2);
    v_return_tax := v_return_tax + round(v_original_line.line_tax * v_ratio, 2);
    IF p_disposition = 'restock' THEN
      INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
      VALUES (p_ctx.business_id, p_ctx.outlet_id, v_original_line.product_id, 0)
      ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
      UPDATE bar_local.stock_balances
         SET quantity = quantity + v_qty, version = version + 1, updated_at = now()
       WHERE business_id = p_ctx.business_id AND outlet_id = p_ctx.outlet_id AND product_id = v_original_line.product_id;
      INSERT INTO bar_local.stock_movements
        (business_id, outlet_id, product_id, delta, reason, operation_id, business_date, reference)
      VALUES (p_ctx.business_id, p_ctx.outlet_id, v_original_line.product_id, v_qty, 'sale.return.restock',
              p_operation_id, v_original.business_date, p_original_sale_id::text);
    END IF;
  END LOOP;

  v_return_total := v_return_subtotal + v_return_tax;
  SELECT COALESCE(value #>> '{}', 'BAR') INTO v_series FROM bar_local.settings WHERE key = 'receipt_series';
  INSERT INTO bar_local.sales
    (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number, receipt_series,
     business_date, status, subtotal, discount, tax, tip, total, customer_id, note, original_sale_id, operation_id)
  VALUES
    (p_ctx.business_id, p_ctx.outlet_id, v_original.shift_id, p_ctx.device_id, p_ctx.staff_id, v_original.tab_id,
     p_receipt_sequence, COALESCE(v_series, 'BAR'), v_original.business_date, 'returned',
     -v_return_subtotal, 0, -v_return_tax, 0, -v_return_total, v_original.customer_id, p_reason,
     v_original.id, p_operation_id)
  RETURNING id INTO v_sale_id;

  v_line_no := 0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_no := v_line_no + 1;
    SELECT * INTO v_original_line FROM bar_local.sale_lines WHERE id = (v_line->>'sale_line_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_ratio := v_qty / v_original_line.quantity;
    INSERT INTO bar_local.sale_lines
      (sale_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
       line_subtotal, line_discount, line_tax, line_total, notes, operation_id)
    VALUES
      (v_sale_id, v_line_no, v_original_line.product_id, v_original_line.name_snapshot, v_original_line.sku_snapshot,
       -v_qty, v_original_line.unit_price, v_original_line.tax_rate,
       -round(v_original_line.line_subtotal * v_ratio, 2), -round(v_original_line.line_discount * v_ratio, 2),
       -round(v_original_line.line_tax * v_ratio, 2), -round(v_original_line.line_total * v_ratio, 2),
       p_reason, p_operation_id);
  END LOOP;

  SELECT COALESCE(sum(amount), 0) INTO v_tender_total FROM bar_local.sale_tenders WHERE sale_id = v_original.id;
  v_refund_remaining := v_return_total;
  FOR v_tender IN SELECT * FROM bar_local.sale_tenders WHERE sale_id = v_original.id ORDER BY id
  LOOP
    IF v_tender_total = 0 THEN
      v_share := 0;
    ELSE
      v_share := round(v_return_total * v_tender.amount / v_tender_total, 2);
    END IF;
    IF v_refund_remaining - v_share < 0 THEN v_share := v_refund_remaining; END IF;
    v_refund_remaining := v_refund_remaining - v_share;
    IF v_share = 0 THEN CONTINUE; END IF;
    INSERT INTO bar_local.sale_tenders
      (sale_id, method, amount, tendered, change_amount, reference, provider_status, voucher_id, customer_id, operation_id)
    VALUES
      (v_sale_id, v_tender.method, -v_share, NULL, 0, 'return:' || v_original.id::text,
       CASE WHEN v_tender.method IN ('card','mobile_money','bank_transfer','external') THEN 'locally_asserted' ELSE 'not_applicable' END,
       v_tender.voucher_id, v_tender.customer_id, p_operation_id);
    IF v_tender.method = 'customer_credit' AND v_tender.customer_id IS NOT NULL THEN
      INSERT INTO bar_local.credit_ledger (business_id, customer_id, delta, type, sale_id, operation_id, reference)
      VALUES (p_ctx.business_id, v_tender.customer_id, -v_share, 'sale.return.credit', v_sale_id, p_operation_id, p_original_sale_id::text);
    ELSIF v_tender.method = 'voucher' AND v_tender.voucher_id IS NOT NULL THEN
      SELECT * INTO v_voucher FROM bar_local.vouchers WHERE id = v_tender.voucher_id FOR UPDATE;
      UPDATE bar_local.vouchers
         SET balance = balance + v_share,
             status = CASE WHEN status = 'redeemed' THEN 'active' ELSE status END,
             version = version + 1
       WHERE id = v_tender.voucher_id;
      INSERT INTO bar_local.voucher_ledger (voucher_id, delta, type, sale_id, operation_id)
      VALUES (v_tender.voucher_id, v_share, 'sale.return', v_sale_id, p_operation_id);
    END IF;
  END LOOP;

  IF p_mark_void THEN
    UPDATE bar_local.sales SET status = 'voided', version = version + 1 WHERE id = v_original.id;
  ELSE
    UPDATE bar_local.sales SET status = 'returned', version = version + 1 WHERE id = v_original.id;
  END IF;

  RETURN bar_local.build_receipt(v_sale_id);
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_sale_return(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
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
    v_receipt := bar_local.reverse_sale(v_ctx, (p_envelope->>'operation_id')::uuid, v_seq.receipt_sequence,
      (v_payload->>'sale_id')::uuid, v_payload->'lines', v_payload->>'reason', v_payload->>'disposition', false);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'sale.returned', (p_envelope->>'operation_id')::uuid, jsonb_build_object('sale_id', v_payload->>'sale_id'), v_receipt);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_receipt, v_receipt, jsonb_build_array(jsonb_build_object('event_type','sale.returned','payload',v_receipt)), (v_receipt->>'business_date')::date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt, 'result', v_receipt);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_sale_void(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_lines jsonb;
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
    SELECT COALESCE(jsonb_agg(jsonb_build_object('sale_line_id', id, 'quantity', quantity - returned_quantity)), '[]'::jsonb)
      INTO v_lines FROM bar_local.sale_lines
     WHERE sale_id = (v_payload->>'sale_id')::uuid AND quantity - returned_quantity > 0;
    IF jsonb_array_length(v_lines) = 0 THEN
      PERFORM bar_local.raise_business('SALE_ALREADY_VOIDED', 'This sale has no remaining lines to void.');
    END IF;
    v_receipt := bar_local.reverse_sale(v_ctx, (p_envelope->>'operation_id')::uuid, v_seq.receipt_sequence,
      (v_payload->>'sale_id')::uuid, v_lines, v_payload->>'reason', 'restock', true);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'sale.voided', (p_envelope->>'operation_id')::uuid, jsonb_build_object('sale_id', v_payload->>'sale_id'), v_receipt);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_receipt, v_receipt, jsonb_build_array(jsonb_build_object('event_type','sale.voided','payload',v_receipt)), (v_receipt->>'business_date')::date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt, 'result', v_receipt);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_shift_open(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_id uuid;
  v_result jsonb;
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
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    INSERT INTO bar_local.shifts (business_id, outlet_id, staff_id, business_date, opening_float, note, operation_id)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, bar_local.current_business_date(),
            (v_payload->>'opening_float')::numeric, v_payload->>'note', (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_id;
    v_result := jsonb_build_object('shift_id', v_id, 'status', 'open', 'business_date', bar_local.current_business_date(),
                                   'opening_float', (v_payload->>'opening_float')::numeric);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'shift.opened', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','shift.opened','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    IF EXISTS (SELECT 1 FROM bar_local.shifts WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND staff_id = v_ctx.staff_id AND status = 'open') THEN
      v_code := 'SHIFT_ALREADY_OPEN'; v_message := 'This operator already has an open shift in this outlet.';
    END IF;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_shift_close(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_shift bar_local.shifts%ROWTYPE;
  v_expected numeric(14,2);
  v_result jsonb;
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
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_shift FROM bar_local.shifts WHERE id = (v_payload->>'shift_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_shift.business_id <> v_ctx.business_id OR v_shift.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'The shift could not be found in this outlet.');
    END IF;
    IF v_shift.status <> 'open' THEN
      PERFORM bar_local.raise_business('SHIFT_CLOSED', 'This shift is already closed.');
    END IF;
    IF v_shift.staff_id <> v_ctx.staff_id AND NOT (v_ctx.role IN ('owner','manager')) THEN
      PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH', 'This shift belongs to another operator.');
    END IF;
    IF EXISTS (SELECT 1 FROM bar_local.tabs
                WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
                  AND owner_staff_id = v_shift.staff_id AND status = 'open') THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'Settle or transfer this operator''s open tabs before closing the shift.');
    END IF;
    v_expected := bar_local.expected_shift_cash(v_shift.id);
    UPDATE bar_local.shifts
       SET status = 'closed', closed_at = now(), counted_cash = (v_payload->>'counted_cash')::numeric,
           expected_cash = v_expected, note = COALESCE(v_payload->>'note', note), version = version + 1
     WHERE id = v_shift.id;
    v_result := jsonb_build_object('shift_id', v_shift.id, 'status', 'closed', 'expected_cash', v_expected,
      'counted_cash', (v_payload->>'counted_cash')::numeric, 'variance', (v_payload->>'counted_cash')::numeric - v_expected);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'shift.closed', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','shift.closed','payload',v_result)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_drawer_movement(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_shift bar_local.shifts%ROWTYPE;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.cashup');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_shift FROM bar_local.shifts WHERE id = (v_payload->>'shift_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_shift.business_id <> v_ctx.business_id OR v_shift.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'The shift could not be found in this outlet.');
    END IF;
    IF v_shift.status <> 'open' THEN
      PERFORM bar_local.raise_business('SHIFT_CLOSED', 'Drawer movements cannot be added to a closed shift.');
    END IF;
    IF v_shift.staff_id <> v_ctx.staff_id AND NOT (v_ctx.role IN ('owner','manager')) THEN
      PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH', 'This drawer belongs to another operator.');
    END IF;
    INSERT INTO bar_local.cash_movements (business_id, outlet_id, shift_id, type, amount, reason, operation_id)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, v_shift.id, v_payload->>'type', (v_payload->>'amount')::numeric,
            v_payload->>'reason', (p_envelope->>'operation_id')::uuid);
    v_result := jsonb_build_object('shift_id', v_shift.id, 'type', v_payload->>'type', 'amount', (v_payload->>'amount')::numeric);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'drawer.movement', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','drawer.movement','payload',v_result)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_cashup_submit(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_shift bar_local.shifts%ROWTYPE;
  v_expected numeric(14,2);
  v_counted numeric(14,2) := (v_payload->>'counted_cash')::numeric;
  v_id uuid;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.cashup');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_shift FROM bar_local.shifts WHERE id = (v_payload->>'shift_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_shift.business_id <> v_ctx.business_id OR v_shift.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'The shift could not be found in this outlet.');
    END IF;
    IF v_shift.status <> 'closed' THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Close the shift before submitting a cash-up.');
    END IF;
    IF v_shift.staff_id <> v_ctx.staff_id AND NOT (v_ctx.role IN ('owner','manager')) THEN
      PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH', 'This shift belongs to another operator.');
    END IF;
    v_expected := bar_local.expected_shift_cash(v_shift.id);
    INSERT INTO bar_local.cashups
      (shift_id, business_id, outlet_id, submitted_by, counted_cash, expected_cash, variance, counted_card,
       notes, proof_refs, operation_id)
    VALUES
      (v_shift.id, v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_counted, v_expected, v_counted - v_expected,
       (v_payload->>'counted_card')::numeric, v_payload->>'notes', COALESCE(v_payload->'proof_refs', '[]'::jsonb),
       (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_id;
    v_result := jsonb_build_object('cashup_id', v_id, 'shift_id', v_shift.id, 'counted_cash', v_counted,
      'expected_cash', v_expected, 'variance', v_counted - v_expected, 'status', 'submitted');
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'cashup.submitted', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','cashup.submitted','payload',v_result)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    IF v_code IS NULL AND EXISTS (SELECT 1 FROM bar_local.cashups WHERE shift_id = (v_payload->>'shift_id')::uuid) THEN
      v_code := 'CASHUP_ALREADY_REVIEWED'; v_message := 'A cash-up has already been submitted for this shift.';
    END IF;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_cashup_review(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_cashup bar_local.cashups%ROWTYPE;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.cashup');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'pos.cashup',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    SELECT * INTO v_cashup FROM bar_local.cashups WHERE id = (v_payload->>'cashup_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_cashup.business_id <> v_ctx.business_id OR v_cashup.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('CASHUP_NOT_FOUND', 'The cash-up could not be found in this outlet.');
    END IF;
    IF v_cashup.status <> 'submitted' THEN
      PERFORM bar_local.raise_business('CASHUP_ALREADY_REVIEWED', 'This cash-up already has a review decision.');
    END IF;
    IF v_cashup.submitted_by = v_ctx.staff_id THEN
      PERFORM bar_local.raise_business('MAKER_CHECKER_VIOLATION', 'The cash-up submitter cannot approve the same cash-up.');
    END IF;
    UPDATE bar_local.cashups
       SET status = v_payload->>'decision', reviewed_at = now(), reviewed_by = v_ctx.staff_id,
           decision_reason = v_payload->>'reason', review_operation_id = (p_envelope->>'operation_id')::uuid
     WHERE id = v_cashup.id;
    v_result := jsonb_build_object('cashup_id', v_cashup.id, 'status', v_payload->>'decision', 'reviewed_by', v_ctx.staff_id);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'cashup.reviewed', (p_envelope->>'operation_id')::uuid, jsonb_build_object('status', 'submitted'), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','cashup.reviewed','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_stock_movement(
  p_kind text,
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_product bar_local.products%ROWTYPE;
  v_qty numeric(18,6);
  v_delta numeric(18,6);
  v_current numeric(18,6);
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF p_kind IN ('adjust', 'waste') THEN
      PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'inventory.approve',
        v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    END IF;
    SELECT * INTO v_product FROM bar_local.products WHERE id = (v_payload->>'product_id')::uuid AND business_id = v_ctx.business_id FOR SHARE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The product could not be found in the local catalogue.');
    END IF;
    IF p_kind = 'transfer' AND (v_payload->>'to_outlet_id')::uuid = v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A stock transfer must target a different outlet.');
    END IF;
    IF p_kind IN ('receive', 'waste', 'transfer') THEN
      v_qty := NULLIF(v_payload->>'quantity', '')::numeric;
      IF v_qty IS NULL OR v_qty <= 0 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Quantity must be greater than zero for this stock movement.');
      END IF;
      IF p_kind = 'transfer' AND NULLIF(v_payload->>'to_outlet_id', '') IS NULL THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A destination outlet is required for a stock transfer.');
      END IF;
    ELSIF p_kind = 'adjust' THEN
      IF NULLIF(v_payload->>'delta', '') IS NULL THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A non-zero stock adjustment delta is required.');
      END IF;
    ELSIF p_kind = 'stocktake' THEN
      v_qty := NULLIF(v_payload->>'counted_quantity', '')::numeric;
      IF v_qty IS NULL OR v_qty < 0 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A non-negative counted quantity is required for a stocktake.');
      END IF;
    END IF;
    INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, v_product.id, 0)
    ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
    SELECT quantity INTO v_current FROM bar_local.stock_balances
     WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND product_id = v_product.id FOR UPDATE;
    IF p_kind = 'receive' THEN
      v_delta := (v_payload->>'quantity')::numeric;
    ELSIF p_kind = 'adjust' THEN
      v_delta := (v_payload->>'delta')::numeric;
    ELSIF p_kind = 'waste' THEN
      v_delta := -(v_payload->>'quantity')::numeric;
    ELSIF p_kind = 'stocktake' THEN
      v_delta := (v_payload->>'counted_quantity')::numeric - v_current;
    ELSIF p_kind = 'transfer' THEN
      v_delta := -(v_payload->>'quantity')::numeric;
    ELSE
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Unknown stock movement kind.');
    END IF;
    IF v_delta = 0 THEN
      v_result := jsonb_build_object('product_id', v_product.id, 'delta', 0, 'quantity', v_current, 'no_change', true);
    ELSE
      IF v_delta < 0 AND v_current + v_delta < 0 THEN
        PERFORM bar_local.raise_business('INSUFFICIENT_STOCK', 'The stock movement would make the local balance negative.');
      END IF;
      UPDATE bar_local.stock_balances
         SET quantity = quantity + v_delta, version = version + 1, updated_at = now()
       WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND product_id = v_product.id;
      INSERT INTO bar_local.stock_movements
        (business_id, outlet_id, product_id, delta, reason, operation_id, business_date, unit_cost, lot_code, expires_on, reference)
      VALUES
        (v_ctx.business_id, v_ctx.outlet_id, v_product.id, v_delta, 'stock.' || p_kind,
         (p_envelope->>'operation_id')::uuid, bar_local.current_business_date(),
         NULLIF(v_payload->>'unit_cost','')::numeric, v_payload->>'lot_code',
         NULLIF(v_payload->>'expires_on','')::date, v_payload->>'supplier_ref');
      IF p_kind = 'transfer' THEN
        IF NOT EXISTS (SELECT 1 FROM bar_local.outlets WHERE id = (v_payload->>'to_outlet_id')::uuid AND business_id = v_ctx.business_id AND active) THEN
          PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'The destination outlet is not active on this local authority.');
        END IF;
        INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
        VALUES (v_ctx.business_id, (v_payload->>'to_outlet_id')::uuid, v_product.id, 0)
        ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
        UPDATE bar_local.stock_balances
           SET quantity = quantity + (v_payload->>'quantity')::numeric, version = version + 1, updated_at = now()
         WHERE business_id = v_ctx.business_id AND outlet_id = (v_payload->>'to_outlet_id')::uuid AND product_id = v_product.id;
        INSERT INTO bar_local.stock_movements
          (business_id, outlet_id, product_id, delta, reason, operation_id, business_date, reference)
        VALUES
          (v_ctx.business_id, (v_payload->>'to_outlet_id')::uuid, v_product.id, (v_payload->>'quantity')::numeric,
           'stock.transfer.in', (p_envelope->>'operation_id')::uuid, bar_local.current_business_date(), v_ctx.outlet_id::text);
      END IF;
      v_result := jsonb_build_object('product_id', v_product.id, 'delta', v_delta, 'quantity', v_current + v_delta);
    END IF;
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'stock.' || p_kind, (p_envelope->>'operation_id')::uuid, jsonb_build_object('quantity', v_current), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','stock.' || p_kind,'payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_stock_receive(p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT bar_local.cmd_stock_movement('receive', p_token_hash, p_device_id, p_envelope, p_payload_hash, p_approval_hash); $$;
CREATE OR REPLACE FUNCTION bar_local.cmd_stock_adjust(p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT bar_local.cmd_stock_movement('adjust', p_token_hash, p_device_id, p_envelope, p_payload_hash, p_approval_hash); $$;
CREATE OR REPLACE FUNCTION bar_local.cmd_stock_stocktake(p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT bar_local.cmd_stock_movement('stocktake', p_token_hash, p_device_id, p_envelope, p_payload_hash, p_approval_hash); $$;
CREATE OR REPLACE FUNCTION bar_local.cmd_stock_waste(p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT bar_local.cmd_stock_movement('waste', p_token_hash, p_device_id, p_envelope, p_payload_hash, p_approval_hash); $$;
CREATE OR REPLACE FUNCTION bar_local.cmd_stock_transfer(p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT bar_local.cmd_stock_movement('transfer', p_token_hash, p_device_id, p_envelope, p_payload_hash, p_approval_hash); $$;

CREATE OR REPLACE FUNCTION bar_local.cmd_customer_create(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_id uuid;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'customers.manage');
  PERFORM bar_local.assert_feature('bar_growth_multi_outlet');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    INSERT INTO bar_local.customers (business_id, name, phone, email, credit_limit)
    VALUES (v_ctx.business_id, v_payload->>'name', v_payload->>'phone', v_payload->>'email',
            COALESCE((v_payload->>'credit_limit')::numeric, 0))
    RETURNING id INTO v_id;
    v_result := jsonb_build_object('customer_id', v_id, 'name', v_payload->>'name');
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'customer.created', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','customer.created','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_credit_payment(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_customer bar_local.customers%ROWTYPE;
  v_outstanding numeric(14,2);
  v_shift bar_local.shifts%ROWTYPE;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'customers.manage');
  PERFORM bar_local.assert_feature('bar_growth_multi_outlet');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_customer FROM bar_local.customers WHERE id = (v_payload->>'customer_id')::uuid AND business_id = v_ctx.business_id FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The customer account is unavailable.');
    END IF;
    SELECT COALESCE(sum(delta), 0) INTO v_outstanding FROM bar_local.credit_ledger WHERE customer_id = v_customer.id;
    IF (v_payload->>'amount')::numeric > v_outstanding THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The payment exceeds the outstanding customer balance.');
    END IF;
    SELECT * INTO v_shift FROM bar_local.shifts WHERE id = (v_payload->>'shift_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_shift.business_id <> v_ctx.business_id OR v_shift.outlet_id <> v_ctx.outlet_id OR v_shift.status <> 'open' THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open a shift to record a customer payment.');
    END IF;
    INSERT INTO bar_local.credit_ledger (business_id, customer_id, delta, type, operation_id, reference)
    VALUES (v_ctx.business_id, v_customer.id, -(v_payload->>'amount')::numeric, 'payment.' || (v_payload->>'method'),
            (p_envelope->>'operation_id')::uuid, v_payload->>'reference');
    IF v_payload->>'method' = 'cash' THEN
      INSERT INTO bar_local.cash_movements (business_id, outlet_id, shift_id, type, amount, reason, operation_id)
      VALUES (v_ctx.business_id, v_ctx.outlet_id, v_shift.id, 'paid_in', (v_payload->>'amount')::numeric,
              'customer.credit.payment', (p_envelope->>'operation_id')::uuid);
    END IF;
    v_result := jsonb_build_object('customer_id', v_customer.id, 'amount', (v_payload->>'amount')::numeric,
      'method', v_payload->>'method', 'outstanding', v_outstanding - (v_payload->>'amount')::numeric);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'customer.credit.payment', (p_envelope->>'operation_id')::uuid, jsonb_build_object('outstanding', v_outstanding), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','customer.credit.payment','payload',v_result)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_voucher_issue(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_code text := NULLIF(v_payload->>'code','');
  v_id uuid;
  v_result jsonb;
  v_code_err text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'vouchers.manage');
  PERFORM bar_local.assert_feature('bar_growth_multi_outlet');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'vouchers.manage',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    IF v_code IS NULL THEN
      v_code := 'V-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    END IF;
    INSERT INTO bar_local.vouchers (business_id, outlet_id, code, initial_amount, balance, customer_id, expires_on)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, v_code, (v_payload->>'amount')::numeric,
            (v_payload->>'amount')::numeric, (v_payload->>'customer_id')::uuid, NULLIF(v_payload->>'expires_on','')::date)
    RETURNING id INTO v_id;
    INSERT INTO bar_local.voucher_ledger (voucher_id, delta, type, operation_id)
    VALUES (v_id, (v_payload->>'amount')::numeric, 'voucher.issued', (p_envelope->>'operation_id')::uuid);
    v_result := jsonb_build_object('voucher_id', v_id, 'code', v_code, 'amount', (v_payload->>'amount')::numeric,
      'balance', (v_payload->>'amount')::numeric, 'expires_on', v_payload->>'expires_on');
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'voucher.issued', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','voucher.issued','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code_err = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code_err, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_catalogue_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_id uuid;
  v_catalogue bigint;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.menu_manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_id := NULLIF(v_payload->>'product_id','')::uuid;
    IF v_id IS NULL THEN
      INSERT INTO bar_local.products (business_id, sku, name, category, price, tax_rate, track_stock, active)
      VALUES (v_ctx.business_id, v_payload->>'sku', v_payload->>'name', v_payload->>'category',
              (v_payload->>'price')::numeric, (v_payload->>'tax_rate')::numeric,
              COALESCE((v_payload->>'track_stock')::boolean, true), COALESCE((v_payload->>'active')::boolean, true))
      RETURNING id INTO v_id;
    ELSE
      UPDATE bar_local.products
         SET sku = v_payload->>'sku', name = v_payload->>'name', category = v_payload->>'category',
             price = (v_payload->>'price')::numeric, tax_rate = (v_payload->>'tax_rate')::numeric,
             track_stock = COALESCE((v_payload->>'track_stock')::boolean, track_stock),
             active = COALESCE((v_payload->>'active')::boolean, active),
             version = version + 1, updated_at = now()
       WHERE id = v_id AND business_id = v_ctx.business_id;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The product to update was not found in this business.');
      END IF;
    END IF;
    UPDATE bar_local.authority SET catalogue_version = catalogue_version + 1 WHERE singleton RETURNING catalogue_version INTO v_catalogue;
    v_result := jsonb_build_object('product_id', v_id, 'catalogue_version', v_catalogue, 'sku', v_payload->>'sku');
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'catalogue.upsert', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','catalogue.upsert','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_staff_create(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text, p_secret jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_caps text[];
  v_id uuid;
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
    IF p_secret IS NULL OR COALESCE(p_secret->>'pin_hash','') = '' OR COALESCE(p_secret->>'pin_salt','') = '' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A local PIN verifier is required.');
    END IF;
    IF jsonb_typeof(v_payload->'capabilities') = 'array' THEN
      SELECT array_agg(value) INTO v_caps FROM jsonb_array_elements_text(v_payload->'capabilities');
    END IF;
    IF v_caps IS NULL THEN
      SELECT array_agg(c) INTO v_caps FROM unnest(CASE v_payload->>'role'
        WHEN 'owner' THEN ARRAY['pos.view','pos.manage','pos.void','pos.discount','pos.cashup','pos.reports','pos.menu_manage','inventory.view','inventory.manage','inventory.approve','customers.manage','vouchers.manage','staff.manage','settings.manage','accounting.read','accounting.manage','accounting.approve','backup.manage','export.manage']
        WHEN 'manager' THEN ARRAY['pos.view','pos.manage','pos.void','pos.discount','pos.cashup','pos.reports','pos.menu_manage','inventory.view','inventory.manage','inventory.approve','customers.manage','vouchers.manage','staff.manage','accounting.read','accounting.manage','export.manage']
        WHEN 'cashier' THEN ARRAY['pos.view','pos.manage','pos.reports','inventory.view','customers.manage']
        WHEN 'stock' THEN ARRAY['pos.view','inventory.view','inventory.manage']
        WHEN 'finance' THEN ARRAY['pos.view','pos.reports','accounting.read','accounting.manage','accounting.approve','export.manage']
        ELSE ARRAY[]::text[] END) c;
    END IF;
    INSERT INTO bar_local.staff (business_id, display_name, role, capabilities, pin_hash, pin_salt, pin_iterations)
    VALUES (v_ctx.business_id, v_payload->>'display_name', v_payload->>'role', v_caps,
            p_secret->>'pin_hash', p_secret->>'pin_salt', (p_secret->>'pin_iterations')::integer)
    RETURNING id INTO v_id;
    v_result := jsonb_build_object('staff_id', v_id, 'display_name', v_payload->>'display_name', 'role', v_payload->>'role');
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'staff.created', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','staff.created','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
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
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'staff.manage',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    IF (v_payload->>'staff_id')::uuid = v_ctx.staff_id THEN
      PERFORM bar_local.raise_business('MAKER_CHECKER_VIOLATION', 'You cannot change your own staff status.');
    END IF;
    UPDATE bar_local.staff SET status = v_payload->>'status', version = version + 1, updated_at = now()
     WHERE id = (v_payload->>'staff_id')::uuid AND business_id = v_ctx.business_id;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The staff identity was not found in this business.');
    END IF;
    UPDATE bar_local.sessions SET revoked_at = now()
     WHERE staff_id = (v_payload->>'staff_id')::uuid AND revoked_at IS NULL;
    v_result := jsonb_build_object('staff_id', (v_payload->>'staff_id')::uuid, 'status', v_payload->>'status');
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'staff.status', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','staff.status','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

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

CREATE OR REPLACE FUNCTION bar_local.cmd_settings_update(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_current integer;
  v_result jsonb;
  v_code text;
  v_message text;
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
    SELECT version INTO v_current FROM bar_local.settings WHERE key = v_payload->>'key' FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The setting is not recognised.');
    END IF;
    PERFORM bar_local.validate_setting_value(v_payload->>'key', v_payload->'value');
    IF v_payload->>'expected_version' IS NOT NULL AND v_current <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('VERSION_CONFLICT', 'The setting changed on another till.');
    END IF;
    UPDATE bar_local.settings
       SET value = v_payload->'value', version = version + 1, updated_at = now()
     WHERE key = v_payload->>'key';
    v_result := jsonb_build_object('key', v_payload->>'key', 'value', v_payload->'value', 'version', v_current + 1);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'settings.updated', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','settings.updated','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_journal_post(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_line jsonb;
  v_debits numeric(14,2) := 0;
  v_credits numeric(14,2) := 0;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_entry_id uuid;
  v_period text := to_char((v_payload->>'entry_date')::date, 'YYYY-MM');
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'accounting.manage');
  PERFORM bar_local.assert_feature('bar_accounting_workforce');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF EXISTS (SELECT 1 FROM bar_local.accounting_periods WHERE period = v_period AND status = 'closed') THEN
      PERFORM bar_local.raise_business('PERIOD_LOCKED', 'The accounting period is closed.');
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_payload->'lines')
    LOOP
      v_debit := COALESCE(NULLIF(v_line->>'debit', '')::numeric, 0);
      v_credit := COALESCE(NULLIF(v_line->>'credit', '')::numeric, 0);
      IF v_debit < 0 OR v_credit < 0 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Journal debits and credits cannot be negative.');
      END IF;
      IF (v_debit > 0) = (v_credit > 0) THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Each journal line must contain exactly one of debit or credit.');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM bar_local.accounting_accounts WHERE code = v_line->>'account_code' AND active) THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A journal account is not active in the local chart.');
      END IF;
      v_debits := v_debits + v_debit;
      v_credits := v_credits + v_credit;
    END LOOP;
    IF round(v_debits, 2) <> round(v_credits, 2) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The journal is not balanced.');
    END IF;
    INSERT INTO bar_local.journal_entries (business_id, entry_date, period, memo, source_type, source_id, operation_id)
    VALUES (v_ctx.business_id, (v_payload->>'entry_date')::date, v_period, v_payload->>'memo',
            v_payload->>'source_type', NULLIF(v_payload->>'source_id','')::uuid, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_entry_id;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_payload->'lines')
    LOOP
      INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
      VALUES (v_entry_id, v_line->>'account_code',
              COALESCE(NULLIF(v_line->>'debit', '')::numeric, 0),
              COALESCE(NULLIF(v_line->>'credit', '')::numeric, 0), v_line->>'description');
    END LOOP;
    v_result := jsonb_build_object('entry_id', v_entry_id, 'period', v_period, 'debits', v_debits, 'credits', v_credits);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.journal.posted', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','accounting.journal.posted','payload',v_result)), (v_payload->>'entry_date')::date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_period_close(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'accounting.manage');
  PERFORM bar_local.assert_feature('bar_accounting_workforce');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'accounting.approve',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    INSERT INTO bar_local.accounting_periods (period, status, closed_at, closed_by, operation_id)
    VALUES (v_payload->>'period', 'closed', now(), v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    ON CONFLICT (period) DO UPDATE SET status = 'closed', closed_at = now(), closed_by = v_ctx.staff_id,
      operation_id = (p_envelope->>'operation_id')::uuid;
    v_result := jsonb_build_object('period', v_payload->>'period', 'status', 'closed');
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.period.closed', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','accounting.period.closed','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;
