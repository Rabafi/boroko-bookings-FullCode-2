-- Permit allocation of the retained tip after all items have been returned.
CREATE OR REPLACE FUNCTION bar_local.cmd_workforce_tip_allocate(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_sale bar_local.sales%ROWTYPE;
  v_staff bar_local.staff%ROWTYPE;
  v_sale_id uuid := NULLIF(v_payload->>'sale_id', '')::uuid;
  v_staff_id uuid := NULLIF(v_payload->>'staff_id', '')::uuid;
  v_amount numeric(14,2) := round(NULLIF(v_payload->>'amount', '')::numeric, 2);
  v_points numeric(12,4) := NULLIF(v_payload->>'points', '')::numeric;
  v_allocated numeric(14,2);
  v_allocation_id uuid;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.cashup');
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
    IF v_sale_id IS NULL OR v_staff_id IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A sale and staff member are required for a tip allocation.');
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A tip allocation amount must be greater than zero.');
    END IF;
    IF v_points IS NOT NULL AND v_points <= 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Tip allocation points must be greater than zero when supplied.');
    END IF;
    SELECT * INTO v_sale FROM bar_local.sales
     WHERE id = v_sale_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SALE_NOT_FOUND', 'The sale could not be found in this outlet.');
    END IF;
    -- A fully item-returned original sale retains its tip. Return receipts and
    -- voided sales are never sources. Locking this row serializes void/return.
    IF v_sale.original_sale_id IS NOT NULL OR v_sale.status NOT IN ('completed', 'returned') THEN
      PERFORM bar_local.raise_business('SALE_NOT_COMPLETED', 'Tips can only be allocated from an original completed or item-returned sale.');
    END IF;
    -- A historical tip adjustment needs reconciliation, not an assumed liability.
    IF EXISTS (SELECT 1 FROM bar_local.sales r WHERE r.original_sale_id = v_sale.id AND r.tip <> 0) THEN
      PERFORM bar_local.raise_business('TIP_RECONCILIATION_REQUIRED', 'This sale has a tip adjustment. Reconcile it before allocating the tip.');
    END IF;
    IF v_sale.tip <= 0 THEN
      PERFORM bar_local.raise_business('TIP_NOT_AVAILABLE', 'This sale has no tip to allocate.');
    END IF;
    SELECT * INTO v_staff FROM bar_local.staff
     WHERE id = v_staff_id AND business_id = v_ctx.business_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('STAFF_NOT_FOUND', 'The selected staff member does not belong to this business.');
    END IF;
    IF v_staff.status <> 'active' THEN
      PERFORM bar_local.raise_business('STAFF_INACTIVE', 'Suspended staff cannot receive tip allocations.');
    END IF;
    IF EXISTS (SELECT 1 FROM bar_local.tip_allocations
                WHERE sale_id = v_sale_id AND staff_id = v_staff_id) THEN
      PERFORM bar_local.raise_business('TIP_ALLOCATION_DUPLICATE', 'This staff member already has a tip allocation for this sale.');
    END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_allocated
      FROM bar_local.tip_allocations WHERE sale_id = v_sale_id;
    IF round(v_allocated + v_amount, 2) > round(v_sale.tip, 2) THEN
      PERFORM bar_local.raise_business('TIP_ALLOCATION_EXCEEDS_SALE_TIP', 'Tip allocations cannot exceed the tip recorded on the sale.');
    END IF;
    INSERT INTO bar_local.tip_allocations
      (business_id, outlet_id, sale_id, staff_id, points, amount, operation_id, created_by)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_sale_id, v_staff_id, v_points, v_amount,
       (p_envelope->>'operation_id')::uuid, v_ctx.staff_id)
    RETURNING id INTO v_allocation_id;
    v_result := jsonb_build_object(
      'allocation_id', v_allocation_id,
      'sale_id', v_sale_id,
      'staff_id', v_staff_id,
      'amount', v_amount,
      'points', v_points,
      'sale_tip', v_sale.tip,
      'allocated_total', round(v_allocated + v_amount, 2),
      'remaining_tip', round(v_sale.tip - v_allocated - v_amount, 2)
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'workforce.tip.allocated', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'workforce.tip.allocated', 'payload', v_result)),
      v_sale.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'TIP_ALLOCATION_DUPLICATE';
      v_message := 'This staff member already has a tip allocation for this sale.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;


-- CREATE OR REPLACE resets execution attributes; keep the hardened runtime boundary.
ALTER FUNCTION bar_local.cmd_workforce_tip_allocate(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_workforce_tip_allocate(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_workforce_tip_allocate(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_workforce_tip_allocate(text, uuid, jsonb, text, text) TO bar_local_runtime;
