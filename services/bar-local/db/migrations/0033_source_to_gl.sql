CREATE TABLE bar_local.source_gl_postings (
  source_type text NOT NULL CHECK (source_type IN ('sale', 'sale.return', 'sale.void')),
  source_id uuid NOT NULL REFERENCES bar_local.sales(id),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  journal_entry_id uuid NOT NULL UNIQUE REFERENCES bar_local.journal_entries(id),
  operation_id uuid NOT NULL,
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_type, source_id)
);
CREATE INDEX IF NOT EXISTS source_gl_postings_scope_idx
  ON bar_local.source_gl_postings (business_id, outlet_id, business_date);

CREATE OR REPLACE FUNCTION bar_local.source_posting_enabled()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT a.entitlement_features @> ARRAY['bar_accounting_workforce']::text[]
      FROM bar_local.authority a
     WHERE a.singleton
  ), false);
$$;

CREATE OR REPLACE FUNCTION bar_local.source_posting_account(p_purpose text)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_code text;
BEGIN
  v_code := CASE p_purpose
    WHEN 'cash' THEN '1000'
    WHEN 'card' THEN '1010'
    WHEN 'bank_transfer' THEN '1020'
    WHEN 'mobile_money' THEN '1030'
    WHEN 'external' THEN '1040'
    WHEN 'customer_credit' THEN '1100'
    WHEN 'voucher' THEN '2200'
    WHEN 'tax' THEN '2100'
    WHEN 'tips' THEN '2300'
    WHEN 'revenue' THEN '4000'
    ELSE NULL
  END;
  IF v_code IS NULL THEN
    PERFORM bar_local.raise_business('SOURCE_POSTING_UNSUPPORTED',
      'The local chart has no posting rule for ' || COALESCE(p_purpose, 'this source line') || '.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bar_local.accounting_accounts WHERE code = v_code AND active
  ) THEN
    PERFORM bar_local.raise_business('SOURCE_POSTING_ACCOUNT_MISSING',
      'Source posting requires an active chart account ' || v_code || ' for ' || p_purpose ||
      '. Configure the local chart before recording this sale.');
  END IF;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.post_sale_source_journal(
  p_session bar_local.session_context,
  p_sale_id uuid,
  p_source_type text,
  p_operation_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_sale bar_local.sales%ROWTYPE;
  v_period text;
  v_entry_id uuid;
  v_existing uuid;
  v_tender record;
  v_account text;
  v_debits numeric(14,2) := 0;
  v_credits numeric(14,2) := 0;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
  v_amount numeric(14,2);
  v_tender_total numeric(14,2) := 0;
BEGIN
  IF NOT bar_local.source_posting_enabled() THEN
    RETURN NULL;
  END IF;
  IF p_source_type NOT IN ('sale', 'sale.return', 'sale.void') THEN
    PERFORM bar_local.raise_business('SOURCE_POSTING_UNSUPPORTED',
      'The source type is not supported by local source-to-GL posting.');
  END IF;

  SELECT * INTO v_sale FROM bar_local.sales WHERE id = p_sale_id;
  IF NOT FOUND OR v_sale.business_id <> p_session.business_id OR v_sale.outlet_id <> p_session.outlet_id THEN
    PERFORM bar_local.raise_business('SALE_NOT_FOUND',
      'The sale could not be found for source-to-GL posting.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_source_type || ':' || p_sale_id::text, 0));
  SELECT journal_entry_id INTO v_existing
    FROM bar_local.source_gl_postings
   WHERE source_type = p_source_type AND source_id = p_sale_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_period := to_char(v_sale.business_date, 'YYYY-MM');
  IF EXISTS (
    SELECT 1 FROM bar_local.accounting_periods
     WHERE period = v_period AND status = 'closed'
  ) THEN
    PERFORM bar_local.raise_business('PERIOD_LOCKED',
      'The accounting period ' || v_period || ' is closed; the sale cannot be posted.');
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_tender_total
    FROM bar_local.sale_tenders WHERE sale_id = p_sale_id;
  IF round(v_tender_total, 2) <> round(v_sale.total, 2) THEN
    PERFORM bar_local.raise_business('SOURCE_POSTING_IMBALANCE',
      'The sale tender total does not match the source sale total; no journal was posted.');
  END IF;

  INSERT INTO bar_local.journal_entries
    (business_id, entry_date, period, memo, source_type, source_id, operation_id)
  VALUES
    (v_sale.business_id, v_sale.business_date, v_period,
     CASE p_source_type
       WHEN 'sale' THEN 'Sale '
       WHEN 'sale.return' THEN 'Return '
       ELSE 'Void '
     END || v_sale.receipt_series || '-' || v_sale.receipt_number,
     p_source_type, p_sale_id, p_operation_id)
  RETURNING id INTO v_entry_id;

  FOR v_tender IN
    SELECT method, amount FROM bar_local.sale_tenders
     WHERE sale_id = p_sale_id AND amount <> 0 ORDER BY id
  LOOP
    v_account := bar_local.source_posting_account(v_tender.method);
    v_debit := greatest(v_tender.amount, 0)::numeric(14,2);
    v_credit := greatest(-v_tender.amount, 0)::numeric(14,2);
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES (v_entry_id, v_account, v_debit, v_credit, 'Tender ' || v_tender.method);
    v_debits := v_debits + v_debit;
    v_credits := v_credits + v_credit;
  END LOOP;

  IF v_sale.subtotal <> 0 THEN
    v_account := bar_local.source_posting_account('revenue');
    v_amount := v_sale.subtotal;
    v_debit := greatest(-v_amount, 0)::numeric(14,2);
    v_credit := greatest(v_amount, 0)::numeric(14,2);
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES (v_entry_id, v_account, v_debit, v_credit, 'Sales revenue');
    v_debits := v_debits + v_debit;
    v_credits := v_credits + v_credit;
  END IF;

  IF v_sale.tax <> 0 THEN
    v_account := bar_local.source_posting_account('tax');
    v_amount := v_sale.tax;
    v_debit := greatest(-v_amount, 0)::numeric(14,2);
    v_credit := greatest(v_amount, 0)::numeric(14,2);
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES (v_entry_id, v_account, v_debit, v_credit, 'Sales tax');
    v_debits := v_debits + v_debit;
    v_credits := v_credits + v_credit;
  END IF;

  IF v_sale.tip <> 0 THEN
    v_account := bar_local.source_posting_account('tips');
    v_amount := v_sale.tip;
    v_debit := greatest(-v_amount, 0)::numeric(14,2);
    v_credit := greatest(v_amount, 0)::numeric(14,2);
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES (v_entry_id, v_account, v_debit, v_credit, 'Tips');
    v_debits := v_debits + v_debit;
    v_credits := v_credits + v_credit;
  END IF;

  IF round(v_debits, 2) <> round(v_credits, 2) THEN
    PERFORM bar_local.raise_business('SOURCE_POSTING_IMBALANCE',
      'The source journal is not balanced; no journal was posted.');
  END IF;

  INSERT INTO bar_local.source_gl_postings
    (source_type, source_id, business_id, outlet_id, journal_entry_id, operation_id, business_date)
  VALUES
    (p_source_type, p_sale_id, v_sale.business_id, v_sale.outlet_id, v_entry_id, p_operation_id, v_sale.business_date);

  RETURN v_entry_id;
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

  PERFORM bar_local.post_sale_source_journal(p_session, p_sale_id, 'sale', p_operation_id);
  RETURN v_change;
END;
$$;

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
  v_original_line bar_local.sale_lines%ROWTYPE;
  v_return_line_id uuid;
  v_return_tender_id uuid;
  v_line jsonb;
  v_stored_line jsonb;
  v_recipe_line jsonb;
  v_tender bar_local.sale_tenders%ROWTYPE;
  v_qty numeric(18,6);
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
  v_return_total numeric(14,2) := 0;
  v_sale_id uuid;
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
  v_voucher bar_local.vouchers%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) = 0 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'At least one sale line is required for a return.');
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_lines)) <>
     (SELECT count(DISTINCT value->>'sale_line_id') FROM jsonb_array_elements(p_lines)) THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A sale line may appear only once in a return request.');
  END IF;

  SELECT * INTO v_original FROM bar_local.sales WHERE id = p_original_sale_id FOR UPDATE;
  IF NOT FOUND OR v_original.business_id <> p_ctx.business_id OR v_original.outlet_id <> p_ctx.outlet_id THEN
    PERFORM bar_local.raise_business('SALE_NOT_FOUND', 'The original sale could not be found in this outlet.');
  END IF;
  IF v_original.status = 'voided' THEN
    PERFORM bar_local.raise_business('SALE_ALREADY_VOIDED', 'This sale has already been voided.');
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

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_original_line FROM bar_local.sale_lines
     WHERE id = (v_line->>'sale_line_id')::uuid AND sale_id = v_original.id FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A return line does not belong to the original sale.');
    END IF;
    v_qty := (v_line->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > (v_original_line.quantity - v_original_line.returned_quantity) THEN
      PERFORM bar_local.raise_business('RETURN_EXCEEDS_ORIGINAL', 'Return quantity exceeds the original quantity remaining.');
    END IF;
    v_cumulative_qty := v_original_line.returned_quantity + v_qty;
    v_ratio := v_cumulative_qty / v_original_line.quantity;
    v_gross_target := CASE WHEN v_cumulative_qty = v_original_line.quantity THEN v_original_line.line_subtotal ELSE round(v_original_line.line_subtotal * v_ratio, 2) END;
    v_discount_target := CASE WHEN v_cumulative_qty = v_original_line.quantity THEN v_original_line.line_discount ELSE round(v_original_line.line_discount * v_ratio, 2) END;
    v_tax_target := CASE WHEN v_cumulative_qty = v_original_line.quantity THEN v_original_line.line_tax ELSE round(v_original_line.line_tax * v_ratio, 2) END;
    SELECT COALESCE(sum(gross_amount), 0), COALESCE(sum(discount_amount), 0), COALESCE(sum(tax_amount), 0)
      INTO v_prior_gross, v_prior_discount, v_prior_tax
      FROM bar_local.sale_return_line_allocations WHERE original_sale_line_id = v_original_line.id;
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
              v_original.business_date, p_original_sale_id::text || ':line:' || v_original_line.id::text);
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
          v_original.business_date, p_original_sale_id::text || ':line:' || v_original_line.id::text);
      END IF;
    END IF;
    UPDATE bar_local.sale_lines SET returned_quantity = returned_quantity + v_qty WHERE id = v_original_line.id;
  END LOOP;

  v_return_total := v_return_subtotal + v_return_tax;
  IF v_prior_refund_total + v_return_total > v_tender_total THEN
    PERFORM bar_local.raise_business('RETURN_EXCEEDS_ORIGINAL', 'The return exceeds the remaining original tender value.');
  END IF;
  IF v_return_total > 0 AND v_tender_total <= 0 THEN
    PERFORM bar_local.raise_business('RETURN_TENDER_UNALLOCATABLE', 'The original sale has no refundable tender balance.');
  END IF;

  SELECT COALESCE(value #>> '{}', 'BAR') INTO v_series FROM bar_local.settings WHERE key = 'receipt_series';
  INSERT INTO bar_local.sales
    (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number, receipt_series,
     business_date, status, subtotal, discount, tax, tip, total, customer_id, note, original_sale_id, operation_id)
  VALUES (p_ctx.business_id, p_ctx.outlet_id, v_original.shift_id, p_ctx.device_id, p_ctx.staff_id, v_original.tab_id,
     p_receipt_sequence, COALESCE(v_series, 'BAR'), v_original.business_date, 'returned',
     -v_return_subtotal, 0, -v_return_tax, 0, -v_return_total, v_original.customer_id, p_reason,
     v_original.id, p_operation_id)
  RETURNING id INTO v_sale_id;

  v_line_no := 0;
  FOR v_stored_line IN SELECT value FROM jsonb_array_elements(v_return_lines)
  LOOP
    v_line_no := v_line_no + 1;
    SELECT * INTO v_original_line FROM bar_local.sale_lines WHERE id = (v_stored_line->>'sale_line_id')::uuid;
    INSERT INTO bar_local.sale_lines
      (sale_id,line_number,product_id,name_snapshot,sku_snapshot,quantity,unit_price,tax_rate,
       line_subtotal,line_discount,line_tax,line_total,notes,modifier_snapshot,recipe_cost,recipe_snapshot,
       promotion_code,promotion_discount,promotion_snapshot,operation_id)
    VALUES (v_sale_id,v_line_no,v_original_line.product_id,v_original_line.name_snapshot,v_original_line.sku_snapshot,
      -(v_stored_line->>'quantity')::numeric,v_original_line.unit_price,v_original_line.tax_rate,
      -(v_stored_line->>'gross')::numeric,-(v_stored_line->>'discount')::numeric,-(v_stored_line->>'tax')::numeric,
      -((v_stored_line->>'net')::numeric + (v_stored_line->>'tax')::numeric),p_reason,
      v_original_line.modifier_snapshot,v_original_line.recipe_cost,v_original_line.recipe_snapshot,NULL,0,NULL,p_operation_id)
    RETURNING id INTO v_return_line_id;
    INSERT INTO bar_local.sale_return_line_allocations
      (business_id,original_sale_id,original_sale_line_id,return_sale_id,return_sale_line_id,quantity,gross_amount,discount_amount,tax_amount)
    VALUES (p_ctx.business_id,v_original.id,v_original_line.id,v_sale_id,v_return_line_id,
      (v_stored_line->>'quantity')::numeric,(v_stored_line->>'gross')::numeric,
      (v_stored_line->>'discount')::numeric,(v_stored_line->>'tax')::numeric);
  END LOOP;

  v_cumulative_refund := v_prior_refund_total + v_return_total;
  v_remaining := v_return_total;

  FOR v_pass IN 1..2 LOOP
    EXIT WHEN v_remaining <= 0;
    FOR v_tender IN SELECT * FROM bar_local.sale_tenders WHERE sale_id = v_original.id AND amount > 0 ORDER BY id FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      SELECT COALESCE(sum(amount),0) INTO v_prior_tender_refund
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
          (sale_id,method,amount,tendered,change_amount,reference,provider_status,voucher_id,customer_id,operation_id)
        VALUES (v_sale_id,v_tender.method,-v_share,NULL,0,'return:' || v_original.id::text,
          CASE WHEN v_tender.method IN ('card','mobile_money','bank_transfer','external') THEN 'locally_asserted' ELSE 'not_applicable' END,
          v_tender.voucher_id,v_tender.customer_id,p_operation_id)
        RETURNING id INTO v_return_tender_id;
        INSERT INTO bar_local.sale_return_tender_allocations(original_sale_id,original_tender_id,return_sale_id,return_tender_id,amount)
        VALUES (v_original.id,v_tender.id,v_sale_id,v_return_tender_id,v_share);
        v_remaining := v_remaining - v_share;
        IF v_tender.method = 'customer_credit' AND v_tender.customer_id IS NOT NULL THEN
          INSERT INTO bar_local.credit_ledger (business_id,customer_id,delta,type,sale_id,operation_id,reference)
          VALUES (p_ctx.business_id,v_tender.customer_id,-v_share,'sale.return.credit',v_sale_id,p_operation_id,p_original_sale_id::text);
        ELSIF v_tender.method = 'voucher' AND v_tender.voucher_id IS NOT NULL THEN
          SELECT * INTO v_voucher FROM bar_local.vouchers WHERE id = v_tender.voucher_id FOR UPDATE;
          UPDATE bar_local.vouchers SET balance = balance + v_share,
            status = CASE WHEN status = 'redeemed' THEN 'active' ELSE status END, version = version + 1 WHERE id = v_tender.voucher_id;
          INSERT INTO bar_local.voucher_ledger (voucher_id,delta,type,sale_id,operation_id)
          VALUES (v_tender.voucher_id,v_share,'sale.return',v_sale_id,p_operation_id);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF v_remaining <> 0 THEN
    PERFORM bar_local.raise_business('RETURN_TENDER_UNALLOCATABLE', 'The return cannot be allocated within the original tender balances.');
  END IF;
  IF p_mark_void THEN
    UPDATE bar_local.sales SET status='voided',version=version+1 WHERE id=v_original.id;
  ELSE
    UPDATE bar_local.sales SET status='returned',version=version+1 WHERE id=v_original.id;
  END IF;
  PERFORM bar_local.post_sale_source_journal(p_ctx, v_sale_id,
    CASE WHEN p_mark_void THEN 'sale.void' ELSE 'sale.return' END, p_operation_id);
  RETURN bar_local.build_receipt(v_sale_id);
END;
$$;

ALTER FUNCTION bar_local.source_posting_enabled() OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.source_posting_enabled() SECURITY DEFINER;
ALTER FUNCTION bar_local.source_posting_enabled() SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.source_posting_enabled() FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.source_posting_enabled() FROM bar_local_runtime;

ALTER FUNCTION bar_local.source_posting_account(text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.source_posting_account(text) SECURITY DEFINER;
ALTER FUNCTION bar_local.source_posting_account(text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.source_posting_account(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.source_posting_account(text) FROM bar_local_runtime;

ALTER FUNCTION bar_local.post_sale_source_journal(bar_local.session_context,uuid,text,uuid) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.post_sale_source_journal(bar_local.session_context,uuid,text,uuid) SECURITY DEFINER;
ALTER FUNCTION bar_local.post_sale_source_journal(bar_local.session_context,uuid,text,uuid) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.post_sale_source_journal(bar_local.session_context,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.post_sale_source_journal(bar_local.session_context,uuid,text,uuid) FROM bar_local_runtime;

ALTER FUNCTION bar_local.apply_tenders(bar_local.session_context,uuid,uuid,date,jsonb,numeric,uuid,uuid) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.apply_tenders(bar_local.session_context,uuid,uuid,date,jsonb,numeric,uuid,uuid) SECURITY DEFINER;
ALTER FUNCTION bar_local.apply_tenders(bar_local.session_context,uuid,uuid,date,jsonb,numeric,uuid,uuid) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.apply_tenders(bar_local.session_context,uuid,uuid,date,jsonb,numeric,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.apply_tenders(bar_local.session_context,uuid,uuid,date,jsonb,numeric,uuid,uuid) FROM bar_local_runtime;

ALTER FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) SECURITY DEFINER;
ALTER FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) FROM bar_local_runtime;

REVOKE ALL ON TABLE bar_local.source_gl_postings FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.source_gl_postings FROM bar_local_runtime;
