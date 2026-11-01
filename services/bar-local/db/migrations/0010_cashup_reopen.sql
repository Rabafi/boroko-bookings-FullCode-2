-- Cash-up reopen keeps one current row per shift for existing reports while
-- retaining a typed snapshot of every superseded submission.

ALTER TABLE bar_local.cashups ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE bar_local.cashups ADD COLUMN reopened_at timestamptz;
ALTER TABLE bar_local.cashups ADD COLUMN reopened_by uuid REFERENCES bar_local.staff(id);
ALTER TABLE bar_local.cashups ADD COLUMN reopen_reason text;
ALTER TABLE bar_local.cashups ADD COLUMN reopen_operation_id uuid;

CREATE TABLE bar_local.cashup_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cashup_id uuid NOT NULL REFERENCES bar_local.cashups(id),
  revision integer NOT NULL CHECK (revision >= 1),
  status text NOT NULL,
  counted_cash numeric(14,2) NOT NULL,
  expected_cash numeric(14,2) NOT NULL,
  variance numeric(14,2) NOT NULL,
  counted_card numeric(14,2),
  submitted_by uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  decision_reason text,
  review_operation_id uuid,
  operation_id uuid NOT NULL,
  reopen_operation_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cashup_id, revision)
);

CREATE INDEX cashup_revisions_cashup_idx ON bar_local.cashup_revisions (cashup_id, revision);

REVOKE ALL ON bar_local.cashup_revisions FROM PUBLIC;
REVOKE ALL ON bar_local.cashup_revisions FROM bar_local_runtime;

CREATE OR REPLACE FUNCTION bar_local.cmd_cashup_reopen(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_cashup bar_local.cashups%ROWTYPE;
  v_before jsonb;
  v_business_date date;
  v_expected numeric(14,2);
  v_counted numeric(14,2) := (v_payload->>'counted_cash')::numeric;
  v_card numeric(14,2) := NULLIF(v_payload->>'counted_card', '')::numeric;
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
    IF v_cashup.status NOT IN ('approved', 'rejected') THEN
      PERFORM bar_local.raise_business('CASHUP_NOT_REVIEWED', 'Only a reviewed cash-up can be reopened.');
    END IF;
    IF v_cashup.status <> (v_payload->>'expected_status') THEN
      PERFORM bar_local.raise_business('CASHUP_STATE_CONFLICT', 'The cash-up review state changed. Refresh before reopening.');
    END IF;
    IF v_counted < 0 OR (v_card IS NOT NULL AND v_card < 0) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Cash and card counts cannot be negative.');
    END IF;
    SELECT business_date INTO v_business_date FROM bar_local.shifts WHERE id = v_cashup.shift_id;
    IF EXISTS (SELECT 1 FROM bar_local.accounting_periods WHERE period = to_char(v_business_date, 'YYYY-MM') AND status = 'closed') THEN
      PERFORM bar_local.raise_business('PERIOD_LOCKED', 'The accounting period for this shift is closed.');
    END IF;
    v_expected := bar_local.expected_shift_cash(v_cashup.shift_id);
    v_before := to_jsonb(v_cashup);
    INSERT INTO bar_local.cashup_revisions
      (cashup_id, revision, status, counted_cash, expected_cash, variance, counted_card,
       submitted_by, submitted_at, reviewed_by, reviewed_at, decision_reason, review_operation_id,
       operation_id, reopen_operation_id, snapshot, recorded_by)
    VALUES
      (v_cashup.id, v_cashup.revision, v_cashup.status, v_cashup.counted_cash, v_cashup.expected_cash,
       v_cashup.variance, v_cashup.counted_card, v_cashup.submitted_by, v_cashup.submitted_at,
       v_cashup.reviewed_by, v_cashup.reviewed_at, v_cashup.decision_reason, v_cashup.review_operation_id,
       v_cashup.operation_id, (p_envelope->>'operation_id')::uuid, v_before, v_ctx.staff_id);
    UPDATE bar_local.cashups
       SET revision = revision + 1,
           submitted_by = v_ctx.staff_id,
           submitted_at = now(),
           counted_cash = v_counted,
           expected_cash = v_expected,
           variance = v_counted - v_expected,
           counted_card = v_card,
           notes = v_payload->>'notes',
           proof_refs = COALESCE(v_payload->'proof_refs', '[]'::jsonb),
           status = 'submitted',
           reviewed_at = NULL,
           reviewed_by = NULL,
           decision_reason = NULL,
           review_operation_id = NULL,
           operation_id = (p_envelope->>'operation_id')::uuid,
           reopened_at = now(),
           reopened_by = v_ctx.staff_id,
           reopen_reason = v_payload->>'reason',
           reopen_operation_id = (p_envelope->>'operation_id')::uuid
     WHERE id = v_cashup.id;
    v_result := jsonb_build_object(
      'cashup_id', v_cashup.id,
      'shift_id', v_cashup.shift_id,
      'status', 'submitted',
      'revision', v_cashup.revision + 1,
      'prior_revision', v_cashup.revision,
      'prior_status', v_cashup.status,
      'counted_cash', v_counted,
      'expected_cash', v_expected,
      'variance', v_counted - v_expected,
      'reopened_by', v_ctx.staff_id
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'cashup.reopened', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type', 'cashup.reopened', 'payload', v_result)), v_business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.cmd_cashup_reopen(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_cashup_reopen(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_cashup_reopen(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_cashup_reopen(text, uuid, jsonb, text, text) TO bar_local_runtime;
