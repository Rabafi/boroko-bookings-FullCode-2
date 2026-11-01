-- Preserve replay outcomes while protecting opening readiness and cash-up history.

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
    -- Hold an active catalogue item through commit against concurrent deactivation.
    PERFORM 1 FROM bar_local.products
     WHERE business_id = v_ctx.business_id AND active
     LIMIT 1 FOR SHARE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('CATALOGUE_REQUIRED', 'Publish an active product in the local catalogue before opening a shift.');
    END IF;
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

CREATE OR REPLACE FUNCTION bar_local.cmd_drawer_movement(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_shift bar_local.shifts%ROWTYPE;
  v_source bar_local.shifts%ROWTYPE;
  v_source_before numeric(14,2);
  v_target_before numeric(14,2);
  v_source_approver uuid;
  v_audit_before jsonb := NULL;
  v_type text;
  v_amount_text text;
  v_amount numeric(14,2);
  v_expected_cash numeric(14,2);
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
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.receipt);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_type := v_payload->>'type';
    v_amount_text := v_payload->>'amount';
    IF v_type NOT IN ('paid_in','paid_out','float','handover','count') THEN
      PERFORM bar_local.raise_business('DRAWER_MOVEMENT_INVALID', 'The drawer movement type is invalid.');
    END IF;
    IF v_amount_text IS NULL OR v_amount_text !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$' THEN
      PERFORM bar_local.raise_business('DRAWER_AMOUNT_INVALID', 'Enter a non-negative amount with no more than two decimal places.');
    END IF;
    v_amount := v_amount_text::numeric(14,2);
    IF v_type <> 'count' AND v_amount <= 0 THEN
      PERFORM bar_local.raise_business('DRAWER_AMOUNT_INVALID', 'Drawer movements must be greater than zero.');
    END IF;
    IF length(btrim(COALESCE(v_payload->>'reason',''))) = 0 OR length(v_payload->>'reason') > 500 THEN
      PERFORM bar_local.raise_business('DRAWER_REASON_REQUIRED', 'A drawer movement or count needs a reason of at most 500 characters.');
    END IF;

    IF v_type='handover' THEN
      IF NULLIF(v_payload->>'source_shift_id','') IS NULL OR v_payload->'receiver_confirmed' IS DISTINCT FROM 'true'::jsonb THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED','Select the outgoing drawer and confirm that you have counted and received this cash.');
      END IF;
      IF (v_payload->>'source_shift_id')::uuid=(v_payload->>'shift_id')::uuid THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED','A handover needs two different drawers and operators.');
      END IF;
      PERFORM 1 FROM bar_local.shifts WHERE id IN ((v_payload->>'shift_id')::uuid,(v_payload->>'source_shift_id')::uuid) ORDER BY id FOR UPDATE;
    END IF;
    SELECT * INTO v_shift FROM bar_local.shifts WHERE id = (v_payload->>'shift_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_shift.business_id <> v_ctx.business_id OR v_shift.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'The shift could not be found in this outlet.');
    END IF;
    IF v_shift.status <> 'open' THEN
      PERFORM bar_local.raise_business('SHIFT_CLOSED', 'Drawer movements and counts cannot be added to a closed shift.');
    END IF;
    IF v_shift.staff_id <> v_ctx.staff_id AND NOT (v_ctx.role IN ('owner','manager')) THEN
      PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH', 'This drawer belongs to another operator.');
    END IF;

    IF v_type='handover' THEN
      IF v_shift.staff_id<>v_ctx.staff_id THEN
        PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH','Only the receiving drawer operator can confirm a handover into their own open shift.');
      END IF;
      SELECT * INTO v_source FROM bar_local.shifts WHERE id=(v_payload->>'source_shift_id')::uuid;
      IF NOT FOUND OR v_source.business_id<>v_ctx.business_id OR v_source.outlet_id<>v_ctx.outlet_id THEN
        PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH','The outgoing drawer is outside this outlet.');
      END IF;
      IF v_source.status<>'open' OR v_source.staff_id=v_ctx.staff_id THEN
        PERFORM bar_local.raise_business('SHIFT_CLOSED','The outgoing drawer must be open and belong to a different operator.');
      END IF;
      SELECT approved_by INTO v_source_approver FROM bar_local.approvals WHERE id=(v_payload->>'approval_id')::uuid;
      IF v_source_approver IS DISTINCT FROM v_source.staff_id THEN
        PERFORM bar_local.raise_business('APPROVAL_INVALID','The outgoing drawer operator must approve this exact handover with their own PIN.');
      END IF;
      v_source_before:=bar_local.expected_shift_cash(v_source.id);
      v_target_before:=bar_local.expected_shift_cash(v_shift.id);
      IF v_amount>v_source_before THEN
        PERFORM bar_local.raise_business('DRAWER_AMOUNT_INVALID','The handover exceeds the outgoing drawer cash balance. Count and reconcile that drawer before proceeding.');
      END IF;
      PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid,p_approval_hash,'pos.cashup',v_ctx.business_id,v_ctx.outlet_id,v_ctx.staff_id);
      INSERT INTO bar_local.cash_movements(business_id,outlet_id,shift_id,type,amount,reason,operation_id)
      VALUES(v_ctx.business_id,v_ctx.outlet_id,v_source.id,'paid_out',v_amount,'Till handover: '||btrim(v_payload->>'reason'),(p_envelope->>'operation_id')::uuid),
            (v_ctx.business_id,v_ctx.outlet_id,v_shift.id,'handover',v_amount,'Till handover: '||btrim(v_payload->>'reason'),(p_envelope->>'operation_id')::uuid);
      v_audit_before:=jsonb_build_object('source_expected_cash',v_source_before::text,'receiver_expected_cash',v_target_before::text);
      v_result:=jsonb_build_object('type',v_type,'shift_id',v_shift.id,'source_shift_id',v_source.id,
        'source_staff_id',v_source.staff_id,'receiver_staff_id',v_ctx.staff_id,'amount',v_amount::text,
        'source_expected_cash',(v_source_before-v_amount)::text,'receiver_expected_cash',(v_target_before+v_amount)::text,
        'receiver_confirmed',true,'reason',btrim(v_payload->>'reason'));
    ELSIF v_type = 'count' THEN
      v_expected_cash := bar_local.expected_shift_cash(v_shift.id);
      INSERT INTO bar_local.cash_movements (business_id, outlet_id, shift_id, type, amount, reason, operation_id)
      VALUES (v_ctx.business_id, v_ctx.outlet_id, v_shift.id, 'count', v_amount,
              btrim(v_payload->>'reason'), (p_envelope->>'operation_id')::uuid);
      v_result := jsonb_build_object('shift_id', v_shift.id, 'type', v_type,
        'counted_cash', v_amount, 'expected_cash', v_expected_cash,
        'variance', v_amount - v_expected_cash, 'reason', btrim(v_payload->>'reason'));
    ELSE
      INSERT INTO bar_local.cash_movements (business_id, outlet_id, shift_id, type, amount, reason, operation_id)
      VALUES (v_ctx.business_id, v_ctx.outlet_id, v_shift.id, v_type, v_amount,
              btrim(v_payload->>'reason'), (p_envelope->>'operation_id')::uuid);
      v_result := jsonb_build_object('shift_id', v_shift.id, 'type', v_type, 'amount', v_amount);
    END IF;

    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'drawer.movement', (p_envelope->>'operation_id')::uuid, v_audit_before, v_result);
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

CREATE OR REPLACE FUNCTION bar_local.cmd_workforce_tip_payout_reverse(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_payout bar_local.tip_payouts%ROWTYPE;
  v_payout_id uuid := NULLIF(v_payload->>'payout_id', '')::uuid;
  v_reason text := NULLIF(trim(v_payload->>'reason'), '');
  v_balance_after numeric(14,2);
  v_cash_movement_id uuid;
  v_reversal_id uuid;
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
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'pos.cashup',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    IF v_payout_id IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A tip payout is required for a reversal.');
    END IF;
    IF v_reason IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A reason is required for a tip payout reversal.');
    END IF;
    SELECT * INTO v_payout FROM bar_local.tip_payouts
     WHERE id = v_payout_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('TIP_PAYOUT_NOT_FOUND', 'The tip payout could not be found in this outlet.');
    END IF;
    PERFORM 1 FROM bar_local.staff WHERE id = v_payout.staff_id FOR UPDATE;
    IF v_payout.status <> 'paid' THEN
      PERFORM bar_local.raise_business('TIP_PAYOUT_ALREADY_REVERSED', 'This tip payout has already been reversed.');
    END IF;
    -- Serialize against shift closure and cash-up before adding reversal cash.
    PERFORM 1 FROM bar_local.shifts
     WHERE id = v_payout.shift_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH', 'The original payout shift is outside this outlet.');
    END IF;
    IF EXISTS (SELECT 1 FROM bar_local.shifts WHERE id = v_payout.shift_id AND status <> 'open') THEN
      PERFORM bar_local.raise_business('SHIFT_CLOSED', 'The payout drawer is closed. Ask a manager to reconcile this correction; do not alter a closed cash-up.');
    END IF;
    INSERT INTO bar_local.cash_movements
      (business_id, outlet_id, shift_id, type, amount, reason, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_payout.shift_id, 'paid_in', v_payout.amount,
       'Tip payout reversal: ' || v_reason, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_cash_movement_id;
    INSERT INTO bar_local.tip_payout_reversals
      (payout_id, business_id, outlet_id, staff_id, amount, cash_movement_id, operation_id, reversed_by, reason)
    VALUES
      (v_payout.id, v_ctx.business_id, v_ctx.outlet_id, v_payout.staff_id, v_payout.amount,
       v_cash_movement_id, (p_envelope->>'operation_id')::uuid, v_ctx.staff_id, v_reason)
    RETURNING id INTO v_reversal_id;
    UPDATE bar_local.tip_payouts
       SET status = 'reversed', reversed_at = now(), reversed_by = v_ctx.staff_id,
           reversal_operation_id = (p_envelope->>'operation_id')::uuid
     WHERE id = v_payout.id;
    v_balance_after := bar_local.staff_tip_balance(v_ctx.business_id, v_ctx.outlet_id, v_payout.staff_id);
    v_result := jsonb_build_object(
      'reversal_id', v_reversal_id,
      'payout_id', v_payout.id,
      'staff_id', v_payout.staff_id,
      'shift_id', v_payout.shift_id,
      'amount', v_payout.amount,
      'cash_movement_id', v_cash_movement_id,
      'status', 'reversed',
      'balance_after', round(v_balance_after, 2),
      'reason', v_reason
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'workforce.tip.payout_reversed', (p_envelope->>'operation_id')::uuid, to_jsonb(v_payout), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'workforce.tip.payout_reversed', 'payload', v_result)),
      (SELECT business_date FROM bar_local.shifts WHERE id = v_payout.shift_id));
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'TIP_PAYOUT_ALREADY_REVERSED';
      v_message := 'This tip payout has already been reversed.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.cmd_shift_open(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_shift_open(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_shift_open(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_shift_open(text, uuid, jsonb, text, text) TO bar_local_runtime;
ALTER FUNCTION bar_local.cmd_drawer_movement(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_drawer_movement(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_drawer_movement(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_drawer_movement(text, uuid, jsonb, text, text) TO bar_local_runtime;
ALTER FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) TO bar_local_runtime;
