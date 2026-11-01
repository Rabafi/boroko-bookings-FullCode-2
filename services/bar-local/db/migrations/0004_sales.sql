-- Authoritative local pricing, sale, tab and receipt functions.
CREATE OR REPLACE FUNCTION bar_local.price_and_deplete_items(
  p_business_id uuid,
  p_outlet_id uuid,
  p_items jsonb,
  p_operation_id uuid,
  p_business_date date,
  p_deplete boolean
) RETURNS TABLE (
  product_id uuid, name text, sku text, quantity numeric, unit_price numeric,
  tax_rate numeric, line_subtotal numeric, line_tax numeric, line_total numeric, notes text
) LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  v_item jsonb;
  v_product bar_local.products%ROWTYPE;
  v_qty numeric(18,6);
  v_on_hand numeric(18,6);
  v_allow_negative boolean := false;
  v_subtotal numeric(14,2);
  v_tax numeric(14,2);
BEGIN
  SELECT COALESCE((value #>> '{}')::boolean, false) INTO v_allow_negative
    FROM bar_local.settings WHERE key = 'allow_negative_stock';
  v_allow_negative := COALESCE(v_allow_negative, false);

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Item quantity must be greater than zero.');
    END IF;
    SELECT * INTO v_product FROM bar_local.products
     WHERE id = (v_item->>'product_id')::uuid AND business_id = p_business_id AND active;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('PRODUCT_UNAVAILABLE', 'A selected product is not available in the local catalogue. Refresh the menu.');
    END IF;
    IF v_product.track_stock THEN
      INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
      VALUES (p_business_id, p_outlet_id, v_product.id, 0)
      ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
      SELECT quantity INTO v_on_hand FROM bar_local.stock_balances
       WHERE business_id = p_business_id AND outlet_id = p_outlet_id AND product_id = v_product.id
       FOR UPDATE;
      IF v_on_hand < v_qty AND NOT v_allow_negative THEN
        PERFORM bar_local.raise_business('INSUFFICIENT_STOCK', 'Not enough stock for ' || v_product.name || '. Another till may have sold it.');
      END IF;
      IF p_deplete THEN
        UPDATE bar_local.stock_balances
           SET quantity = quantity - v_qty, version = version + 1, updated_at = now()
         WHERE business_id = p_business_id AND outlet_id = p_outlet_id AND product_id = v_product.id;
        INSERT INTO bar_local.stock_movements
          (business_id, outlet_id, product_id, delta, reason, operation_id, business_date)
        VALUES (p_business_id, p_outlet_id, v_product.id, -v_qty, 'sale.depletion', p_operation_id, p_business_date);
      END IF;
    END IF;
    v_subtotal := round(v_product.price * v_qty, 2);
    v_tax := round(v_subtotal * v_product.tax_rate, 2);
    product_id := v_product.id;
    name := v_product.name;
    sku := v_product.sku;
    quantity := v_qty;
    unit_price := v_product.price;
    tax_rate := v_product.tax_rate;
    line_subtotal := v_subtotal;
    line_tax := v_tax;
    line_total := v_subtotal + v_tax;
    notes := v_item->>'notes';
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.require_open_shift(
  p_business_id uuid, p_outlet_id uuid, p_shift_id uuid, p_staff_id uuid, p_require_owner boolean DEFAULT true
) RETURNS bar_local.shifts LANGUAGE plpgsql AS $$
DECLARE
  v_shift bar_local.shifts%ROWTYPE;
BEGIN
  SELECT * INTO v_shift FROM bar_local.shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR v_shift.business_id <> p_business_id OR v_shift.outlet_id <> p_outlet_id THEN
    PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open a shift in this outlet before trading.');
  END IF;
  IF v_shift.status <> 'open' THEN
    PERFORM bar_local.raise_business('SHIFT_CLOSED', 'This shift is closed. Complete a reconciliation instead of rewriting closed trading.');
  END IF;
  IF p_require_owner AND v_shift.staff_id <> p_staff_id THEN
    PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH', 'This shift belongs to another operator.');
  END IF;
  RETURN v_shift;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.compute_allocated_discount(
  p_lines jsonb, p_discount numeric
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_count integer := jsonb_array_length(p_lines);
  v_gross numeric := 0;
  v_remaining numeric := p_discount;
  v_alloc numeric;
  v_subtotal numeric;
  v_rate numeric;
  v_tax numeric;
  v_taxable numeric;
  v_line jsonb;
  v_result jsonb := '[]'::jsonb;
  v_index integer;
BEGIN
  IF p_discount < 0 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Discount cannot be negative.');
  END IF;
  FOR v_index IN 0..v_count - 1 LOOP
    v_gross := v_gross + ((p_lines->v_index->>'line_subtotal')::numeric);
  END LOOP;
  IF p_discount > v_gross THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Discount cannot exceed the pre-tax line subtotals.');
  END IF;
  FOR v_index IN 0..v_count - 1 LOOP
    v_line := p_lines->v_index;
    v_subtotal := (v_line->>'line_subtotal')::numeric;
    v_rate := (v_line->>'tax_rate')::numeric;
    IF v_index = v_count - 1 THEN
      v_alloc := v_remaining;
    ELSE
      v_alloc := round(p_discount * v_subtotal / NULLIF(v_gross, 0), 2);
      IF v_alloc > v_remaining THEN v_alloc := v_remaining; END IF;
    END IF;
    v_remaining := v_remaining - v_alloc;
    v_taxable := v_subtotal - v_alloc;
    v_tax := round(v_taxable * v_rate, 2);
    v_result := v_result || jsonb_build_array(v_line || jsonb_build_object(
      'line_discount', v_alloc,
      'line_tax', v_tax,
      'line_total', v_taxable + v_tax
    ));
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.apply_tenders(
  p_session bar_local.session_context,
  p_sale_id uuid,
  p_shift_id uuid,
  p_business_date date,
  p_tenders jsonb,
  p_total numeric,
  p_customer_id uuid,
  p_operation_id uuid
) RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_tender jsonb;
  v_method text;
  v_amount numeric(14,2);
  v_tendered numeric(14,2);
  v_change numeric(14,2) := 0;
  v_sum numeric(14,2) := 0;
  v_customer uuid;
  v_outstanding numeric(14,2);
  v_limit numeric(14,2);
  v_voucher bar_local.vouchers%ROWTYPE;
BEGIN
  FOR v_tender IN SELECT value FROM jsonb_array_elements(p_tenders)
  LOOP
    v_method := v_tender->>'method';
    v_amount := (v_tender->>'amount')::numeric;
    IF v_method NOT IN ('cash', 'card', 'mobile_money', 'bank_transfer', 'external', 'customer_credit', 'voucher', 'room_charge') THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The tender method is not supported by the local authority.');
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Tender amounts must be greater than zero.');
    END IF;
    v_sum := v_sum + v_amount;
  END LOOP;
  IF round(v_sum, 2) <> round(p_total, 2) THEN
    PERFORM bar_local.raise_business('TENDER_TOTAL_MISMATCH', 'Tender total does not equal the authoritative sale total.');
  END IF;

  FOR v_tender IN SELECT value FROM jsonb_array_elements(p_tenders)
  LOOP
    v_method := v_tender->>'method';
    v_amount := (v_tender->>'amount')::numeric;
    v_tendered := COALESCE((v_tender->>'tendered')::numeric, v_amount);
    v_customer := NULL;
    v_voucher := NULL;
    IF v_method = 'cash' THEN
      IF v_tendered < v_amount THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Cash tendered cannot be less than the applied cash amount.');
      END IF;
      v_change := v_change + (v_tendered - v_amount);
    ELSIF v_tender->>'tendered' IS NOT NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Only cash tenders may carry a tendered amount.');
    END IF;

    IF v_method = 'customer_credit' THEN
      v_customer := COALESCE((v_tender->>'customer_id')::uuid, p_customer_id);
      IF v_customer IS NULL THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A customer account is required for credit tender.');
      END IF;
      SELECT credit_limit INTO v_limit FROM bar_local.customers
       WHERE id = v_customer AND business_id = p_session.business_id AND status = 'active' FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The customer account is unavailable.');
      END IF;
      SELECT COALESCE(sum(delta), 0) INTO v_outstanding FROM bar_local.credit_ledger
       WHERE customer_id = v_customer AND business_id = p_session.business_id;
      IF v_outstanding + v_amount > v_limit THEN
        PERFORM bar_local.raise_business('INSUFFICIENT_CREDIT', 'This customer does not have enough local credit available.');
      END IF;
      INSERT INTO bar_local.credit_ledger (business_id, customer_id, delta, type, sale_id, operation_id, reference)
      VALUES (p_session.business_id, v_customer, v_amount, 'sale.credit', p_sale_id, p_operation_id, v_tender->>'reference');
    ELSIF v_method = 'voucher' THEN
      IF COALESCE(v_tender->>'voucher_code', '') = '' THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A voucher code is required for voucher tender.');
      END IF;
      SELECT * INTO v_voucher FROM bar_local.vouchers
       WHERE business_id = p_session.business_id AND outlet_id = p_session.outlet_id
         AND code = v_tender->>'voucher_code' FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('VOUCHER_NOT_FOUND', 'The voucher is not owned by this local Bar authority.');
      END IF;
      IF v_voucher.status <> 'active' OR (v_voucher.expires_on IS NOT NULL AND v_voucher.expires_on < p_business_date) THEN
        PERFORM bar_local.raise_business('VOUCHER_EXHAUSTED', 'The voucher is not active or has expired.');
      END IF;
      IF v_voucher.balance < v_amount THEN
        PERFORM bar_local.raise_business('VOUCHER_EXHAUSTED', 'The voucher does not have enough local balance.');
      END IF;
      UPDATE bar_local.vouchers
         SET balance = balance - v_amount,
             status = CASE WHEN balance - v_amount = 0 THEN 'redeemed' ELSE status END,
             version = version + 1
       WHERE id = v_voucher.id;
      INSERT INTO bar_local.voucher_ledger (voucher_id, delta, type, sale_id, operation_id)
      VALUES (v_voucher.id, -v_amount, 'sale.redemption', p_sale_id, p_operation_id);
    ELSIF v_method IN ('room_charge') THEN
      PERFORM bar_local.raise_business('EXTERNAL_DEPENDENCY', 'Room charges require the hotel authority and cannot be finalised as an offline local tender.');
    ELSIF v_method IN ('card', 'mobile_money', 'bank_transfer', 'external') THEN
      IF COALESCE(v_tender->>'provider_status', 'locally_asserted') = 'provider_confirmed' THEN
        PERFORM bar_local.raise_business('EXTERNAL_DEPENDENCY', 'Provider-confirmed status cannot be asserted by the local Bar service.');
      END IF;
    END IF;
    IF COALESCE(v_tender->>'provider_status',
        CASE WHEN v_method IN ('card','mobile_money','bank_transfer','external') THEN 'locally_asserted' ELSE 'not_applicable' END)
       NOT IN ('locally_asserted', 'not_applicable') THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The tender provider status is not supported by the local authority.');
    END IF;

    INSERT INTO bar_local.sale_tenders
      (sale_id, method, amount, tendered, change_amount, reference, provider_status, voucher_id, customer_id, operation_id)
    VALUES
      (p_sale_id, v_method, v_amount,
       CASE WHEN v_method = 'cash' THEN v_tendered ELSE NULL END,
       CASE WHEN v_method = 'cash' THEN v_tendered - v_amount ELSE 0 END,
       v_tender->>'reference',
       COALESCE(v_tender->>'provider_status', CASE WHEN v_method IN ('card','mobile_money','bank_transfer','external') THEN 'locally_asserted' ELSE 'not_applicable' END),
       v_voucher.id, v_customer, p_operation_id);
  END LOOP;
  RETURN v_change;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.build_receipt(p_sale_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'sale_id', s.id, 'receipt_number', s.receipt_number, 'receipt_series', s.receipt_series,
    'business_date', s.business_date, 'status', s.status, 'subtotal', s.subtotal,
    'discount', s.discount, 'tax', s.tax, 'tip', s.tip, 'total', s.total,
    'created_at', s.created_at, 'original_sale_id', s.original_sale_id,
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'sale_line_id', l.id, 'name', l.name_snapshot, 'sku', l.sku_snapshot,
        'quantity', l.quantity, 'unit_price', l.unit_price, 'line_discount', l.line_discount,
        'line_tax', l.line_tax, 'line_total', l.line_total, 'notes', l.notes
      ) ORDER BY l.line_number) FROM bar_local.sale_lines l WHERE l.sale_id = s.id), '[]'::jsonb),
    'tenders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'method', t.method, 'amount', t.amount, 'tendered', t.tendered,
        'change', t.change_amount, 'reference', t.reference, 'provider_status', t.provider_status
      ) ORDER BY t.id) FROM bar_local.sale_tenders t WHERE t.sale_id = s.id), '[]'::jsonb)
  ) FROM bar_local.sales s WHERE s.id = p_sale_id;
$$;

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
  v_product jsonb;
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
  v_code text;
  v_message text;
  v_error jsonb;
  v_tab_id uuid := NULLIF(v_payload->>'tab_id', '')::uuid;
  v_events jsonb;
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
             line_subtotal, line_tax, line_total, notes, operation_id)
          VALUES (v_tab_id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
                  (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
                  (v_line->>'line_subtotal')::numeric, (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
                  v_line->>'notes', (p_envelope->>'operation_id')::uuid);
        END LOOP;
      END IF;
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'line_number', line_number, 'product_id', product_id, 'name', name_snapshot, 'sku', sku_snapshot, 'quantity', quantity,
          'unit_price', unit_price, 'tax_rate', tax_rate, 'line_subtotal', line_subtotal,
          'line_tax', line_tax, 'line_total', line_total, 'notes', notes
        ) ORDER BY line_number), '[]'::jsonb) INTO v_lines
        FROM bar_local.tab_lines WHERE tab_id = v_tab_id AND status = 'open';
      IF jsonb_array_length(v_lines) = 0 THEN
        PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'This tab has no lines to settle.');
      END IF;
    ELSE
      SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_lines
        FROM bar_local.price_and_deplete_items(v_ctx.business_id, v_ctx.outlet_id, v_payload->'items',
             (p_envelope->>'operation_id')::uuid, v_shift.business_date, true) p;
    END IF;

    v_lines := bar_local.compute_allocated_discount(v_lines, v_discount);
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_subtotal := v_subtotal + ((v_line->>'line_subtotal')::numeric - (v_line->>'line_discount')::numeric);
      v_tax := v_tax + (v_line->>'line_tax')::numeric;
    END LOOP;
    v_total := v_subtotal + v_tax + v_tip;

    SELECT COALESCE(value #>> '{}', 'BAR') INTO v_series FROM bar_local.settings WHERE key = 'receipt_series';
    v_series := COALESCE(v_series, 'BAR');

    INSERT INTO bar_local.sales
      (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number,
       receipt_series, business_date, subtotal, discount, tax, tip, total, customer_id,
       walk_in_name, note, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_shift.id, v_ctx.device_id, v_ctx.staff_id, v_tab_id,
       v_seq.receipt_sequence, v_series, v_shift.business_date, v_subtotal, v_discount, v_tax, v_tip, v_total,
       v_customer, v_payload->>'walk_in_name', v_payload->>'note', (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_sale_id;

    v_line_no := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_line_no := v_line_no + 1;
      INSERT INTO bar_local.sale_lines
        (sale_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
         line_subtotal, line_discount, line_tax, line_total, notes, operation_id)
      VALUES
        (v_sale_id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
         (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
         (v_line->>'line_subtotal')::numeric, (v_line->>'line_discount')::numeric,
         (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
         v_line->>'notes', (p_envelope->>'operation_id')::uuid);
    END LOOP;

    v_change := bar_local.apply_tenders(v_ctx, v_sale_id, v_shift.id, v_shift.business_date,
      v_payload->'tenders', v_total, v_customer, (p_envelope->>'operation_id')::uuid);

    IF v_tab_id IS NOT NULL THEN
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
    v_result := jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt, 'change', v_change);
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

CREATE OR REPLACE FUNCTION bar_local.cmd_tab_open(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_shift bar_local.shifts%ROWTYPE;
  v_owner uuid;
  v_tab_id uuid;
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
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_owner := COALESCE(NULLIF(v_payload->>'owner_staff_id', '')::uuid, v_ctx.staff_id);
    IF v_owner <> v_ctx.staff_id THEN
      PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
      IF NOT EXISTS (SELECT 1 FROM bar_local.staff WHERE id = v_owner AND business_id = v_ctx.business_id AND status = 'active') THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The tab owner is unavailable.');
      END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM bar_local.shifts WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND staff_id = v_ctx.staff_id AND status = 'open') THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open a shift before opening tabs.');
    END IF;
    INSERT INTO bar_local.tabs (business_id, outlet_id, table_label, owner_staff_id, note, operation_id)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, v_payload->>'table_label', v_owner, v_payload->>'note', (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_tab_id;
    v_receipt := jsonb_build_object('tab_id', v_tab_id, 'version', 1, 'owner_staff_id', v_owner);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'tab.opened', (p_envelope->>'operation_id')::uuid, NULL, v_receipt);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_receipt, v_receipt, jsonb_build_array(jsonb_build_object('event_type','tab.opened','payload',v_receipt)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt, 'result', v_receipt);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_tab_add(
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
  v_line_no integer;
  v_added jsonb := '[]'::jsonb;
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
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_tab FROM bar_local.tabs WHERE id = (v_payload->>'tab_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_tab.business_id <> v_ctx.business_id OR v_tab.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('TAB_NOT_FOUND', 'The tab could not be found in this outlet.');
    END IF;
    IF v_tab.status <> 'open' THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'This tab is already settled or voided.');
    END IF;
    IF v_tab.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('TAB_VERSION_CONFLICT', 'The tab changed on another till. Refresh before adding lines.');
    END IF;
    IF v_tab.owner_staff_id <> v_ctx.staff_id AND v_ctx.role NOT IN ('owner', 'manager') THEN
      PERFORM bar_local.raise_business('TAB_NOT_OWNED', 'This tab belongs to another operator.');
    END IF;
    SELECT * INTO v_shift FROM bar_local.shifts
     WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND staff_id = v_ctx.staff_id AND status = 'open'
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open a shift before adding tab lines.');
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_lines
      FROM bar_local.price_and_deplete_items(v_ctx.business_id, v_ctx.outlet_id, v_payload->'items',
           (p_envelope->>'operation_id')::uuid, v_shift.business_date, true) p;
    SELECT COALESCE(MAX(line_number), 0) INTO v_line_no FROM bar_local.tab_lines WHERE tab_id = v_tab.id;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_line_no := v_line_no + 1;
      INSERT INTO bar_local.tab_lines
        (tab_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
         line_subtotal, line_tax, line_total, notes, operation_id)
      VALUES (v_tab.id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
              (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
              (v_line->>'line_subtotal')::numeric, (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
              v_line->>'notes', (p_envelope->>'operation_id')::uuid);
    END LOOP;
    UPDATE bar_local.tabs SET version = version + 1 WHERE id = v_tab.id;
    v_added := jsonb_build_object('tab_id', v_tab.id, 'version', v_tab.version + 1, 'lines', v_lines);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'tab.lines_added', (p_envelope->>'operation_id')::uuid, NULL, v_added);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_added, v_added, jsonb_build_array(jsonb_build_object('event_type','tab.lines_added','payload',v_added)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt, 'result', v_added);
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
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'line_number', line_number, 'product_id', product_id, 'name', name_snapshot, 'sku', sku_snapshot, 'quantity', quantity,
        'unit_price', unit_price, 'tax_rate', tax_rate, 'line_subtotal', line_subtotal,
        'line_tax', line_tax, 'line_total', line_total, 'notes', notes
      ) ORDER BY line_number), '[]'::jsonb) INTO v_lines
      FROM bar_local.tab_lines WHERE tab_id = v_tab.id AND status = 'open';
    IF jsonb_array_length(v_lines) = 0 THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'This tab has no lines to settle.');
    END IF;
    v_lines := bar_local.compute_allocated_discount(v_lines, v_discount);
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_subtotal := v_subtotal + ((v_line->>'line_subtotal')::numeric - (v_line->>'line_discount')::numeric);
      v_tax := v_tax + (v_line->>'line_tax')::numeric;
    END LOOP;
    v_total := v_subtotal + v_tax + v_tip;
    SELECT COALESCE(value #>> '{}', 'BAR') INTO v_series FROM bar_local.settings WHERE key = 'receipt_series';
    INSERT INTO bar_local.sales
      (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number,
       receipt_series, business_date, subtotal, discount, tax, tip, total, customer_id, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_shift.id, v_ctx.device_id, v_ctx.staff_id, v_tab.id,
       v_seq.receipt_sequence, COALESCE(v_series, 'BAR'), v_shift.business_date, v_subtotal, v_discount, v_tax, v_tip, v_total,
       v_customer, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_sale_id;
    v_line_no := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_line_no := v_line_no + 1;
      INSERT INTO bar_local.sale_lines
        (sale_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
         line_subtotal, line_discount, line_tax, line_total, notes, operation_id)
      VALUES
        (v_sale_id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
         (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
         (v_line->>'line_subtotal')::numeric, (v_line->>'line_discount')::numeric,
         (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
         v_line->>'notes', (p_envelope->>'operation_id')::uuid);
    END LOOP;
    v_change := bar_local.apply_tenders(v_ctx, v_sale_id, v_shift.id, v_shift.business_date,
      v_payload->'tenders', v_total, v_customer, (p_envelope->>'operation_id')::uuid);
    UPDATE bar_local.tab_lines SET status = 'settled' WHERE tab_id = v_tab.id AND status = 'open';
    UPDATE bar_local.tabs SET status = 'settled', closed_at = now(), version = version + 1, settled_sale_id = v_sale_id WHERE id = v_tab.id;
    v_receipt := bar_local.build_receipt(v_sale_id) || jsonb_build_object('change', v_change, 'replayed', false);
    INSERT INTO bar_local.print_jobs (business_id, outlet_id, operation_id, sale_id, payload)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, (p_envelope->>'operation_id')::uuid, v_sale_id, v_receipt);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'tab.settled', (p_envelope->>'operation_id')::uuid, NULL, v_receipt);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt),
      v_receipt, jsonb_build_array(jsonb_build_object('event_type','sale.committed','payload',v_receipt)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt,
      'result', jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt));
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_tab_transfer(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_tab bar_local.tabs%ROWTYPE;
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
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'pos.manage',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    SELECT * INTO v_tab FROM bar_local.tabs WHERE id = (v_payload->>'tab_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_tab.business_id <> v_ctx.business_id OR v_tab.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('TAB_NOT_FOUND', 'The tab could not be found in this outlet.');
    END IF;
    IF v_tab.status <> 'open' THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'Only an open tab can be transferred.');
    END IF;
    IF v_tab.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('TAB_VERSION_CONFLICT', 'The tab changed on another till. Refresh before transferring.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM bar_local.staff WHERE id = (v_payload->>'target_staff_id')::uuid AND business_id = v_ctx.business_id AND status = 'active') THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The target operator is unavailable.');
    END IF;
    UPDATE bar_local.tabs SET owner_staff_id = (v_payload->>'target_staff_id')::uuid, version = version + 1 WHERE id = v_tab.id;
    v_result := jsonb_build_object('tab_id', v_tab.id, 'version', v_tab.version + 1, 'owner_staff_id', (v_payload->>'target_staff_id')::uuid);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'tab.transferred', (p_envelope->>'operation_id')::uuid, jsonb_build_object('owner_staff_id', v_tab.owner_staff_id), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','tab.transferred','payload',v_result)), bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;
