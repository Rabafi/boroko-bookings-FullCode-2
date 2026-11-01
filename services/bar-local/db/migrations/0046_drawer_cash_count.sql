-- Add a durable physical drawer count without changing the cash ledger's
-- expected balance. The expected amount and variance are captured while the
-- shift is locked and are retained in the command receipt/audit/outbox event.
CREATE OR REPLACE FUNCTION bar_local.cmd_drawer_movement(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_shift bar_local.shifts%ROWTYPE;
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
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_type := v_payload->>'type';
    v_amount_text := v_payload->>'amount';
    IF v_type NOT IN ('paid_in','paid_out','float','tip_payout','handover','count') THEN
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

    IF v_type = 'count' THEN
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

ALTER FUNCTION bar_local.cmd_drawer_movement(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_drawer_movement(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_drawer_movement(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_drawer_movement(text, uuid, jsonb, text, text) TO bar_local_runtime;
