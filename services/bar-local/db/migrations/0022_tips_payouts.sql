-- Local tip allocations and cash payouts. Allocations are sourced from a
-- completed sale tip; payouts and reversals are append-only cash evidence.

CREATE TABLE bar_local.tip_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  sale_id uuid NOT NULL REFERENCES bar_local.sales(id),
  staff_id uuid NOT NULL REFERENCES bar_local.staff(id),
  points numeric(12,4) CHECK (points IS NULL OR points > 0),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  operation_id uuid NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id, staff_id)
);
CREATE INDEX tip_allocations_scope_idx
  ON bar_local.tip_allocations (business_id, outlet_id, staff_id, created_at);
CREATE INDEX tip_allocations_sale_idx
  ON bar_local.tip_allocations (sale_id);

CREATE TABLE bar_local.tip_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  staff_id uuid NOT NULL REFERENCES bar_local.staff(id),
  shift_id uuid NOT NULL REFERENCES bar_local.shifts(id),
  cash_movement_id uuid NOT NULL UNIQUE REFERENCES bar_local.cash_movements(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  operation_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'reversed')),
  paid_by uuid NOT NULL REFERENCES bar_local.staff(id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversed_by uuid REFERENCES bar_local.staff(id),
  reversal_operation_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'paid' AND reversed_at IS NULL AND reversed_by IS NULL AND reversal_operation_id IS NULL)
    OR (status = 'reversed' AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND reversal_operation_id IS NOT NULL)
  )
);
CREATE INDEX tip_payouts_scope_idx
  ON bar_local.tip_payouts (business_id, outlet_id, staff_id, status, paid_at DESC);

CREATE TABLE bar_local.tip_payout_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL UNIQUE REFERENCES bar_local.tip_payouts(id),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  staff_id uuid NOT NULL REFERENCES bar_local.staff(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  cash_movement_id uuid NOT NULL UNIQUE REFERENCES bar_local.cash_movements(id),
  operation_id uuid NOT NULL UNIQUE,
  reversed_by uuid NOT NULL REFERENCES bar_local.staff(id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tip_payout_reversals_scope_idx
  ON bar_local.tip_payout_reversals (business_id, outlet_id, staff_id, created_at);

CREATE OR REPLACE FUNCTION bar_local.staff_tip_balance(
  p_business_id uuid, p_outlet_id uuid, p_staff_id uuid
) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE((SELECT sum(a.amount) FROM bar_local.tip_allocations a
               WHERE a.business_id = p_business_id AND a.outlet_id = p_outlet_id AND a.staff_id = p_staff_id), 0)
    - COALESCE((SELECT sum(p.amount) FROM bar_local.tip_payouts p
                 WHERE p.business_id = p_business_id AND p.outlet_id = p_outlet_id AND p.staff_id = p_staff_id), 0)
    + COALESCE((SELECT sum(r.amount) FROM bar_local.tip_payout_reversals r
                 WHERE r.business_id = p_business_id AND r.outlet_id = p_outlet_id AND r.staff_id = p_staff_id), 0);
$$;

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
    IF v_sale.status <> 'completed' THEN
      PERFORM bar_local.raise_business('SALE_NOT_COMPLETED', 'Tips can only be allocated from a completed sale.');
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

CREATE OR REPLACE FUNCTION bar_local.cmd_workforce_tip_payout(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_staff bar_local.staff%ROWTYPE;
  v_shift bar_local.shifts%ROWTYPE;
  v_staff_id uuid := NULLIF(v_payload->>'staff_id', '')::uuid;
  v_shift_id uuid := NULLIF(v_payload->>'shift_id', '')::uuid;
  v_amount numeric(14,2) := round(NULLIF(v_payload->>'amount', '')::numeric, 2);
  v_reason text := NULLIF(trim(v_payload->>'reason'), '');
  v_balance_before numeric(14,2);
  v_cash_movement_id uuid;
  v_payout_id uuid;
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
    IF v_staff_id IS NULL OR v_shift_id IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A staff member and open shift are required for a tip payout.');
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A tip payout amount must be greater than zero.');
    END IF;
    IF v_reason IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A reason is required for a tip payout.');
    END IF;
    SELECT * INTO v_staff FROM bar_local.staff
     WHERE id = v_staff_id AND business_id = v_ctx.business_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('STAFF_NOT_FOUND', 'The selected staff member does not belong to this business.');
    END IF;
    IF v_staff.status <> 'active' THEN
      PERFORM bar_local.raise_business('STAFF_INACTIVE', 'Suspended staff cannot receive tip payouts.');
    END IF;
    SELECT * INTO v_shift FROM bar_local.shifts
     WHERE id = v_shift_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'The payout shift could not be found in this outlet.');
    END IF;
    IF v_shift.staff_id <> v_staff_id THEN
      PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH', 'The tip payout shift belongs to another operator.');
    END IF;
    IF v_shift.status <> 'open' THEN
      PERFORM bar_local.raise_business('SHIFT_CLOSED', 'Tip payouts require an open shift.');
    END IF;
    v_balance_before := bar_local.staff_tip_balance(v_ctx.business_id, v_ctx.outlet_id, v_staff_id);
    IF v_amount > round(v_balance_before, 2) THEN
      PERFORM bar_local.raise_business('TIP_BALANCE_INSUFFICIENT', 'The requested payout exceeds this staff member''s available tip balance.');
    END IF;
    INSERT INTO bar_local.cash_movements
      (business_id, outlet_id, shift_id, type, amount, reason, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_shift_id, 'paid_out', v_amount,
       'Tip payout: ' || v_reason, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_cash_movement_id;
    INSERT INTO bar_local.tip_payouts
      (business_id, outlet_id, staff_id, shift_id, cash_movement_id, amount, operation_id, paid_by, reason)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_staff_id, v_shift_id, v_cash_movement_id, v_amount,
       (p_envelope->>'operation_id')::uuid, v_ctx.staff_id, v_reason)
    RETURNING id INTO v_payout_id;
    v_result := jsonb_build_object(
      'payout_id', v_payout_id,
      'staff_id', v_staff_id,
      'shift_id', v_shift_id,
      'amount', v_amount,
      'cash_movement_id', v_cash_movement_id,
      'status', 'paid',
      'balance_before', round(v_balance_before, 2),
      'balance_after', round(v_balance_before - v_amount, 2),
      'reason', v_reason
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'workforce.tip.paid_out', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'workforce.tip.paid_out', 'payload', v_result)),
      v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_TIP_PAYOUT';
      v_message := 'This tip payout conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
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
    IF NOT EXISTS (
      SELECT 1 FROM bar_local.shifts
       WHERE id = v_payout.shift_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
    ) THEN
      PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH', 'The original payout shift is outside this outlet.');
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

REVOKE ALL ON bar_local.tip_allocations FROM PUBLIC;
REVOKE ALL ON bar_local.tip_payouts FROM PUBLIC;
REVOKE ALL ON bar_local.tip_payout_reversals FROM PUBLIC;
REVOKE ALL ON bar_local.tip_allocations FROM bar_local_runtime;
REVOKE ALL ON bar_local.tip_payouts FROM bar_local_runtime;
REVOKE ALL ON bar_local.tip_payout_reversals FROM bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.staff_tip_balance(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.staff_tip_balance(uuid, uuid, uuid) FROM bar_local_runtime;

ALTER FUNCTION bar_local.cmd_workforce_tip_allocate(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_workforce_tip_allocate(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_workforce_tip_payout(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_workforce_tip_payout(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;

REVOKE ALL ON FUNCTION bar_local.cmd_workforce_tip_allocate(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_workforce_tip_payout(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_workforce_tip_allocate(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_workforce_tip_payout(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) TO bar_local_runtime;
