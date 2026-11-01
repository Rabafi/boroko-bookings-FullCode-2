-- A full-sale void cancels the unallocated tip as well as remaining items.
-- Item returns retain the original tip. Allocated tips fail closed pending
-- reviewed liability reconciliation. Preserve 0059's open-drawer/shortage wrapper.
-- Snapshot of the 0033 conserved-allocation helper with only tip handling added.
CREATE OR REPLACE FUNCTION bar_local.reverse_sale_before_shift_guard(
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
  v_return_tip numeric(14,2) := 0;
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
  -- Allocating a tip locks this same sale. Refuse removal of an allocated
  -- staff liability; a reviewed allocation/payout reconciliation is required.
  IF p_mark_void AND v_original.tip > 0 THEN
    IF EXISTS (SELECT 1 FROM bar_local.tip_allocations WHERE sale_id=v_original.id) THEN
      PERFORM bar_local.raise_business('TIP_RECONCILIATION_REQUIRED',
        'This sale has tips allocated to staff. Reconcile its tip allocations and any payouts before cancelling it. No refund or stock reversal has been recorded.');
    END IF;
    v_return_tip := v_original.tip;
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

  v_return_total := v_return_subtotal + v_return_tax + v_return_tip;
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
     -v_return_subtotal, 0, -v_return_tax, -v_return_tip, -v_return_total, v_original.customer_id, p_reason,
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
ALTER FUNCTION bar_local.reverse_sale_before_shift_guard(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.reverse_sale_before_shift_guard(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) SECURITY DEFINER;
ALTER FUNCTION bar_local.reverse_sale_before_shift_guard(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) SET search_path=pg_catalog,bar_local;
REVOKE ALL ON FUNCTION bar_local.reverse_sale_before_shift_guard(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) FROM PUBLIC,bar_local_runtime;
