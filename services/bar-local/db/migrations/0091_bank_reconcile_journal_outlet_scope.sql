-- Bank reconciliation must accept journal evidence from the same outlet as
-- the statement line, even when both outlets belong to one local business.
CREATE OR REPLACE FUNCTION bar_local.cmd_bank_reconcile(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_line bar_local.bank_statement_lines%ROWTYPE;
  v_account bar_local.bank_accounts%ROWTYPE;
  v_entry bar_local.journal_entries%ROWTYPE;
  v_payment bar_local.ap_payments%ROWTYPE;
  v_journal_id uuid := NULLIF(v_payload->>'journal_entry_id', '')::uuid;
  v_payment_id uuid := NULLIF(v_payload->>'ap_payment_id', '')::uuid;
  v_bank_lines integer := 0;
  v_net numeric(14,2) := 0;
  v_reconciled_on date := COALESCE(NULLIF(v_payload->>'reconciled_on', '')::date, bar_local.current_business_date());
  v_reconciliation_id uuid;
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
    IF (v_journal_id IS NULL) = (v_payment_id IS NULL) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Provide exactly one journal entry or supplier payment as reconciliation evidence.');
    END IF;
    SELECT * INTO v_line FROM bar_local.bank_statement_lines
     WHERE id = (v_payload->>'statement_line_id')::uuid
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('BANK_STATEMENT_NOT_FOUND', 'The statement line could not be found in this outlet.');
    END IF;
    IF EXISTS (SELECT 1 FROM bar_local.bank_reconciliations WHERE statement_line_id = v_line.id) THEN
      PERFORM bar_local.raise_business('BANK_ALREADY_RECONCILED', 'This statement line has already been reconciled.');
    END IF;
    SELECT * INTO v_account FROM bar_local.bank_accounts
     WHERE id = v_line.bank_account_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('BANK_ACCOUNT_NOT_FOUND', 'The statement line bank account could not be found in this outlet.');
    END IF;
    IF v_payment_id IS NOT NULL THEN
      SELECT * INTO v_payment FROM bar_local.ap_payments
       WHERE id = v_payment_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
       FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('AP_PAYMENT_NOT_FOUND', 'The supplier payment could not be found in this outlet.');
      END IF;
      IF v_payment.status <> 'posted' THEN
        PERFORM bar_local.raise_business('AP_PAYMENT_STATE_CONFLICT', 'Only a posted supplier payment can be reconciled.');
      END IF;
      IF EXISTS (SELECT 1 FROM bar_local.ap_payments WHERE reverses_payment_id = v_payment.id) THEN
        PERFORM bar_local.raise_business('AP_PAYMENT_STATE_CONFLICT', 'A reversed supplier payment cannot be reconciliation evidence.');
      END IF;
      IF v_line.amount >= 0 OR v_line.amount <> -v_payment.amount THEN
        PERFORM bar_local.raise_business('BANK_EVIDENCE_MISMATCH', 'The outgoing statement amount does not match the supplier payment.');
      END IF;
      v_journal_id := v_payment.journal_entry_id;
    END IF;
    SELECT entry.* INTO v_entry FROM bar_local.journal_entries entry
     WHERE entry.id = v_journal_id AND entry.business_id = v_ctx.business_id
       AND EXISTS (
         SELECT 1 FROM bar_local.operations operation
          WHERE operation.operation_id = entry.operation_id
            AND operation.business_id = v_ctx.business_id
            AND operation.outlet_id = v_ctx.outlet_id
       )
     FOR UPDATE OF entry;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('JOURNAL_NOT_FOUND', 'The journal evidence could not be found in this outlet.');
    END IF;
    SELECT count(*), COALESCE(sum(debit - credit), 0)
      INTO v_bank_lines, v_net
      FROM bar_local.journal_lines
     WHERE entry_id = v_entry.id AND account_code = v_account.account_code;
    IF v_bank_lines = 0 THEN
      PERFORM bar_local.raise_business('BANK_EVIDENCE_MISMATCH', 'The journal entry has no line for the linked bank account.');
    END IF;
    IF round(v_net, 2) <> v_line.amount THEN
      PERFORM bar_local.raise_business('BANK_EVIDENCE_MISMATCH', 'The journal bank movement does not match the statement amount.');
    END IF;
    IF EXISTS (SELECT 1 FROM bar_local.bank_reconciliations WHERE journal_entry_id = v_entry.id) THEN
      PERFORM bar_local.raise_business('BANK_EVIDENCE_ALREADY_LINKED', 'This journal evidence has already been reconciled to another statement line.');
    END IF;
    INSERT INTO bar_local.bank_reconciliations
      (business_id, outlet_id, bank_account_id, statement_line_id, journal_entry_id, ap_payment_id,
       evidence_type, reconciled_on, note, reconciled_by, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_account.id, v_line.id, v_entry.id,
       v_payment_id, CASE WHEN v_payment_id IS NULL THEN 'journal' ELSE 'ap_payment' END,
       v_reconciled_on, NULLIF(v_payload->>'note', ''), v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_reconciliation_id;
    v_result := jsonb_build_object(
      'reconciliation_id', v_reconciliation_id,
      'statement_line_id', v_line.id,
      'bank_account_id', v_account.id,
      'evidence_type', CASE WHEN v_payment_id IS NULL THEN 'journal' ELSE 'ap_payment' END,
      'journal_entry_id', v_entry.id,
      'ap_payment_id', v_payment_id,
      'amount', v_line.amount,
      'reconciled_on', v_reconciled_on
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.bank.reconciled', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'accounting.bank.reconciled', 'payload', v_result)),
      v_reconciled_on);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'BANK_ALREADY_RECONCILED';
      v_message := 'The statement line or its evidence has already been reconciled.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.cmd_bank_reconcile(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.cmd_bank_reconcile(text,uuid,jsonb,text,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_bank_reconcile(text,uuid,jsonb,text,text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_bank_reconcile(text,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_bank_reconcile(text,uuid,jsonb,text,text) TO bar_local_runtime;
