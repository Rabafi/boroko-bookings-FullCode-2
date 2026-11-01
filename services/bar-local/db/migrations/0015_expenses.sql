-- Bar expenses post an immutable source record and a balanced journal entry in
-- the same transaction. Corrections are append-only reversals, never edits.

CREATE TABLE bar_local.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  expense_date date NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  expense_account_code text NOT NULL REFERENCES bar_local.accounting_accounts(code),
  payment_account_code text NOT NULL REFERENCES bar_local.accounting_accounts(code),
  supplier_id uuid REFERENCES bar_local.suppliers(id),
  reference text,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'voided')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  journal_entry_id uuid REFERENCES bar_local.journal_entries(id),
  reversal_journal_entry_id uuid REFERENCES bar_local.journal_entries(id),
  void_reason text,
  voided_by uuid REFERENCES bar_local.staff(id),
  voided_at timestamptz,
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_outlet_date_idx ON bar_local.expenses (business_id, outlet_id, expense_date DESC, created_at DESC);
CREATE INDEX expenses_status_idx ON bar_local.expenses (business_id, outlet_id, status);

CREATE OR REPLACE FUNCTION bar_local.cmd_expense_create(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_date date;
  v_amount numeric(14,2);
  v_expense_account bar_local.accounting_accounts%ROWTYPE;
  v_payment_account bar_local.accounting_accounts%ROWTYPE;
  v_expense_id uuid;
  v_entry_id uuid;
  v_period text;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'accounting.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_date := (v_payload->>'expense_date')::date;
    v_amount := round((v_payload->>'amount')::numeric, 2);
    IF v_date IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Expense date and a positive amount are required.');
    END IF;
    IF v_date > bar_local.current_business_date() THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'An expense cannot be dated after today.');
    END IF;
    v_period := to_char(v_date, 'YYYY-MM');
    IF EXISTS (SELECT 1 FROM bar_local.accounting_periods WHERE period = v_period AND status = 'closed') THEN
      PERFORM bar_local.raise_business('PERIOD_LOCKED', 'The accounting period for this expense is closed.');
    END IF;
    SELECT * INTO v_expense_account FROM bar_local.accounting_accounts
     WHERE code = v_payload->>'expense_account_code' AND active;
    IF NOT FOUND OR v_expense_account.type <> 'expense' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The selected expense account is not an active expense account.');
    END IF;
    SELECT * INTO v_payment_account FROM bar_local.accounting_accounts
     WHERE code = v_payload->>'payment_account_code' AND active;
    IF NOT FOUND OR v_payment_account.type NOT IN ('asset', 'liability') THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The selected payment account is not an active asset or liability account.');
    END IF;
    IF v_expense_account.code = v_payment_account.code THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Expense and payment accounts must be different.');
    END IF;
    IF NULLIF(v_payload->>'supplier_id', '') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bar_local.suppliers
       WHERE id = (v_payload->>'supplier_id')::uuid AND business_id = v_ctx.business_id
    ) THEN
      PERFORM bar_local.raise_business('SUPPLIER_NOT_FOUND', 'The supplier could not be found in this business.');
    END IF;
    INSERT INTO bar_local.expenses
      (business_id, outlet_id, expense_date, category, description, amount,
       expense_account_code, payment_account_code, supplier_id, reference, created_by, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_date, v_payload->>'category', v_payload->>'description', v_amount,
       v_expense_account.code, v_payment_account.code, NULLIF(v_payload->>'supplier_id', '')::uuid,
       NULLIF(v_payload->>'reference', ''), v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_expense_id;
    INSERT INTO bar_local.journal_entries
      (business_id, entry_date, period, memo, source_type, source_id, operation_id)
    VALUES
      (v_ctx.business_id, v_date, v_period, 'Expense: ' || (v_payload->>'description'),
       'expense', v_expense_id, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_entry_id;
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES
      (v_entry_id, v_expense_account.code, v_amount, 0, v_payload->>'description'),
      (v_entry_id, v_payment_account.code, 0, v_amount, 'Expense payment');
    UPDATE bar_local.expenses SET journal_entry_id = v_entry_id WHERE id = v_expense_id;
    v_result := jsonb_build_object(
      'expense_id', v_expense_id,
      'amount', v_amount,
      'expense_date', v_date,
      'period', v_period,
      'journal_entry_id', v_entry_id,
      'status', 'posted',
      'version', 1
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'expense.created', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'expense.created', 'payload', v_result)),
      v_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'The expense conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_expense_void(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_expense bar_local.expenses%ROWTYPE;
  v_expense_account bar_local.accounting_accounts%ROWTYPE;
  v_payment_account bar_local.accounting_accounts%ROWTYPE;
  v_entry_id uuid;
  v_period text;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'accounting.manage');
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
    SELECT * INTO v_expense FROM bar_local.expenses
     WHERE id = (v_payload->>'expense_id')::uuid AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('EXPENSE_NOT_FOUND', 'The expense could not be found in this outlet.');
    END IF;
    IF v_expense.status <> 'posted' THEN
      PERFORM bar_local.raise_business('EXPENSE_STATE_CONFLICT', 'Only a posted expense can be voided.');
    END IF;
    IF v_expense.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('EXPENSE_VERSION_CONFLICT', 'The expense changed since it was loaded. Refresh and try again.');
    END IF;
    v_period := to_char(bar_local.current_business_date(), 'YYYY-MM');
    IF EXISTS (SELECT 1 FROM bar_local.accounting_periods WHERE period = v_period AND status = 'closed') THEN
      PERFORM bar_local.raise_business('PERIOD_LOCKED', 'The current accounting period is closed.');
    END IF;
    SELECT * INTO v_expense_account FROM bar_local.accounting_accounts WHERE code = v_expense.expense_account_code AND active;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The expense account used by this expense is no longer active.');
    END IF;
    SELECT * INTO v_payment_account FROM bar_local.accounting_accounts WHERE code = v_expense.payment_account_code AND active;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The payment account used by this expense is no longer active.');
    END IF;
    INSERT INTO bar_local.journal_entries
      (business_id, entry_date, period, memo, source_type, source_id, operation_id)
    VALUES
      (v_ctx.business_id, bar_local.current_business_date(), v_period,
       'Void expense: ' || (v_payload->>'reason'), 'expense.void', v_expense.id,
       (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_entry_id;
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES
      (v_entry_id, v_payment_account.code, v_expense.amount, 0, 'Voided expense payment'),
      (v_entry_id, v_expense_account.code, 0, v_expense.amount, v_payload->>'reason');
    UPDATE bar_local.expenses
       SET status = 'voided', version = version + 1, reversal_journal_entry_id = v_entry_id,
           void_reason = v_payload->>'reason', voided_by = v_ctx.staff_id, voided_at = now(), updated_at = now()
     WHERE id = v_expense.id;
    v_result := jsonb_build_object(
      'expense_id', v_expense.id,
      'status', 'voided',
      'version', v_expense.version + 1,
      'reversal_journal_entry_id', v_entry_id
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'expense.voided', (p_envelope->>'operation_id')::uuid, to_jsonb(v_expense), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'expense.voided', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) RENAME TO query_dispatch_menu;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_query text,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_outlet uuid;
  v_limit integer;
  v_data jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next text;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
  v_filters jsonb;
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
BEGIN
  IF p_query IS NULL OR p_query NOT IN ('expenses.list', 'expense.get') THEN
    RETURN bar_local.query_dispatch_menu(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters);
  END IF;
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'accounting.read');
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  v_outlet := bar_local.query_outlet(v_ctx, v_filters);
  v_limit := bar_local.query_limit(v_filters);
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id);

  IF p_query = 'expenses.list' THEN
    IF NULLIF(v_filters->>'cursor', '') IS NOT NULL THEN
      v_cursor_ts := split_part(v_filters->>'cursor', '|', 1)::timestamptz;
      v_cursor_id := split_part(v_filters->>'cursor', '|', 2)::uuid;
    END IF;
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC, x.expense_id DESC), '[]'::jsonb)
      INTO v_data
      FROM (
        SELECT e.id AS expense_id, e.expense_date, e.category, e.description, e.amount,
               e.expense_account_code, e.payment_account_code, e.supplier_id, e.reference,
               e.status, e.version, e.journal_entry_id, e.reversal_journal_entry_id,
               e.void_reason, e.voided_at, e.created_by, e.created_at, e.updated_at
          FROM bar_local.expenses e
         WHERE e.business_id = v_ctx.business_id AND e.outlet_id = v_outlet
           AND (v_filters->>'from' IS NULL OR e.expense_date >= (v_filters->>'from')::date)
           AND (v_filters->>'to' IS NULL OR e.expense_date <= (v_filters->>'to')::date)
           AND (v_filters->>'status' IS NULL OR e.status = v_filters->>'status')
           AND (v_filters->>'category' IS NULL OR e.category = v_filters->>'category')
           AND (v_cursor_ts IS NULL OR (e.created_at, e.id) < (v_cursor_ts, v_cursor_id))
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT v_limit + 1
      ) x;
    IF jsonb_array_length(v_data) > v_limit THEN
      v_data := v_data - v_limit;
      v_has_more := true;
      v_next := (v_data->-1->>'created_at') || '|' || (v_data->-1->>'expense_id');
    END IF;
  ELSIF p_query = 'expense.get' THEN
    IF NULLIF(v_filters->>'expense_id', '') IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'expense_id is required.');
    END IF;
    SELECT jsonb_build_object(
      'expense_id', e.id,
      'expense_date', e.expense_date,
      'category', e.category,
      'description', e.description,
      'amount', e.amount,
      'expense_account_code', e.expense_account_code,
      'payment_account_code', e.payment_account_code,
      'supplier_id', e.supplier_id,
      'reference', e.reference,
      'status', e.status,
      'version', e.version,
      'journal_entry_id', e.journal_entry_id,
      'reversal_journal_entry_id', e.reversal_journal_entry_id,
      'void_reason', e.void_reason,
      'voided_at', e.voided_at,
      'created_by', e.created_by,
      'created_at', e.created_at,
      'updated_at', e.updated_at,
      'journal_entry', (
        SELECT jsonb_build_object(
          'entry_id', je.id, 'entry_date', je.entry_date, 'period', je.period,
          'memo', je.memo, 'source_type', je.source_type,
          'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'account_code', jl.account_code, 'debit', jl.debit, 'credit', jl.credit,
            'description', jl.description) ORDER BY jl.id)
            FROM bar_local.journal_lines jl WHERE jl.entry_id = je.id), '[]'::jsonb))
        FROM bar_local.journal_entries je WHERE je.id = e.journal_entry_id
      ),
      'reversal_journal_entry', (
        SELECT jsonb_build_object(
          'entry_id', je.id, 'entry_date', je.entry_date, 'period', je.period,
          'memo', je.memo, 'source_type', je.source_type,
          'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'account_code', jl.account_code, 'debit', jl.debit, 'credit', jl.credit,
            'description', jl.description) ORDER BY jl.id)
            FROM bar_local.journal_lines jl WHERE jl.entry_id = je.id), '[]'::jsonb))
        FROM bar_local.journal_entries je WHERE je.id = e.reversal_journal_entry_id
      )
    ) INTO v_data
      FROM bar_local.expenses e
     WHERE e.id = (v_filters->>'expense_id')::uuid
       AND e.business_id = v_ctx.business_id AND e.outlet_id = v_outlet;
    IF v_data IS NULL THEN
      PERFORM bar_local.raise_business('EXPENSE_NOT_FOUND', 'The expense could not be found in this outlet.');
    END IF;
  END IF;

  RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
    'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);
END;
$$;

REVOKE ALL ON bar_local.expenses FROM PUBLIC;
REVOKE ALL ON bar_local.expenses FROM bar_local_runtime;

ALTER FUNCTION bar_local.cmd_expense_create(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_expense_create(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_expense_create(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_expense_create(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_expense_void(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_expense_void(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_expense_void(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_expense_void(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch_menu(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_menu(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_menu(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_menu(text, uuid, uuid, bigint, text, jsonb) FROM bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
