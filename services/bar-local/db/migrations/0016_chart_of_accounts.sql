-- The local chart is editable through versioned commands, but posted usage
-- prevents changing an account's financial type.

ALTER TABLE bar_local.accounting_accounts ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE bar_local.accounting_accounts ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES bar_local.staff(id);
ALTER TABLE bar_local.accounting_accounts ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES bar_local.staff(id);
ALTER TABLE bar_local.accounting_accounts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS accounting_accounts_type_idx ON bar_local.accounting_accounts (type, active);

CREATE OR REPLACE FUNCTION bar_local.cmd_accounting_account_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_existing bar_local.accounting_accounts%ROWTYPE;
  v_exists boolean;
  v_code text := trim(v_payload->>'code');
  v_name text := trim(v_payload->>'name');
  v_type text := v_payload->>'type';
  v_active boolean := COALESCE((v_payload->>'active')::boolean, true);
  v_before jsonb;
  v_account jsonb;
  v_code_error text;
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
    IF v_code IS NULL OR v_code !~ '^[0-9A-Za-z][0-9A-Za-z.-]{0,31}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'An account code must be 1-32 letters, digits, dots or hyphens.');
    END IF;
    IF v_name IS NULL OR length(v_name) < 1 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'An account name is required.');
    END IF;
    IF v_type NOT IN ('asset', 'liability', 'equity', 'revenue', 'expense') THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The account type is not valid.');
    END IF;
    SELECT * INTO v_existing FROM bar_local.accounting_accounts WHERE code = v_code FOR UPDATE;
    v_exists := FOUND;
    IF v_exists THEN
      IF NULLIF(v_payload->>'expected_version', '') IS NULL THEN
        PERFORM bar_local.raise_business('DUPLICATE_RECORD', 'An account with this code already exists. Supply its expected version to update it.');
      END IF;
      IF v_existing.version <> (v_payload->>'expected_version')::integer THEN
        PERFORM bar_local.raise_business('ACCOUNT_VERSION_CONFLICT', 'The account changed since it was loaded. Refresh and try again.');
      END IF;
      IF v_type <> v_existing.type AND EXISTS (
        SELECT 1 FROM bar_local.journal_lines WHERE account_code = v_existing.code
      ) THEN
        PERFORM bar_local.raise_business('ACCOUNT_IN_USE', 'The account has posted journals; its financial type cannot be changed.');
      END IF;
      v_before := to_jsonb(v_existing);
      UPDATE bar_local.accounting_accounts
         SET name = v_name, type = v_type, active = v_active, version = version + 1,
             updated_by = v_ctx.staff_id, updated_at = now()
       WHERE code = v_existing.code
       RETURNING to_jsonb(accounting_accounts.*) INTO v_account;
    ELSE
      IF NULLIF(v_payload->>'expected_version', '') IS NOT NULL THEN
        PERFORM bar_local.raise_business('ACCOUNT_VERSION_CONFLICT', 'No account exists for the expected version. Refresh and try again.');
      END IF;
      INSERT INTO bar_local.accounting_accounts (code, name, type, active, created_by, updated_by)
      VALUES (v_code, v_name, v_type, v_active, v_ctx.staff_id, v_ctx.staff_id)
      RETURNING to_jsonb(accounting_accounts.*) INTO v_account;
      v_before := NULL;
    END IF;
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      CASE WHEN v_exists THEN 'accounting.account.updated' ELSE 'accounting.account.created' END,
      (p_envelope->>'operation_id')::uuid, v_before, v_account);
    v_account := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_account, v_account,
      jsonb_build_array(jsonb_build_object(
        'event_type', CASE WHEN v_exists THEN 'accounting.account.updated' ELSE 'accounting.account.created' END,
        'payload', v_account)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_account, 'result', v_account);
  EXCEPTION
    WHEN unique_violation THEN
      v_code_error := 'DUPLICATE_RECORD';
      v_message := 'An account with this code already exists.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code_error, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code_error = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code_error, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) RENAME TO query_dispatch_expenses;

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
  v_limit integer;
  v_data jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next text;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
  v_filters jsonb;
BEGIN
  IF p_query IS NULL OR p_query IS DISTINCT FROM 'accounting.accounts.list' THEN
    RETURN bar_local.query_dispatch_expenses(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters);
  END IF;
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'accounting.read');
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  v_limit := bar_local.query_limit(v_filters);
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id);

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.account_code), '[]'::jsonb) INTO v_data
    FROM (
      SELECT aa.code AS account_code, aa.name, aa.type, aa.active, aa.version, aa.updated_at,
             COALESCE(jl.debit_total, 0) AS debit_total,
             COALESCE(jl.credit_total, 0) AS credit_total,
             COALESCE(jl.debit_total, 0) - COALESCE(jl.credit_total, 0) AS balance
        FROM bar_local.accounting_accounts aa
        LEFT JOIN (
          SELECT line.account_code, sum(line.debit) AS debit_total, sum(line.credit) AS credit_total
            FROM bar_local.journal_lines line
           GROUP BY line.account_code
        ) jl ON jl.account_code = aa.code
       WHERE (COALESCE((v_filters->>'include_inactive')::boolean, false) OR aa.active)
         AND (v_filters->>'type' IS NULL OR aa.type = v_filters->>'type')
         AND (v_filters->>'search' IS NULL OR aa.code ILIKE '%' || (v_filters->>'search') || '%'
              OR aa.name ILIKE '%' || (v_filters->>'search') || '%')
         AND (v_filters->>'cursor' IS NULL OR aa.code > v_filters->>'cursor')
       ORDER BY aa.code
       LIMIT v_limit + 1
    ) x;
  IF jsonb_array_length(v_data) > v_limit THEN
    SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb) INTO v_data
      FROM jsonb_array_elements(v_data) WITH ORDINALITY AS item(value, ordinality)
     WHERE ordinality <= v_limit;
    v_has_more := true;
    v_next := v_data->-1->>'code';
  END IF;
  RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
    'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);
END;
$$;

REVOKE ALL ON bar_local.accounting_accounts FROM PUBLIC;
REVOKE ALL ON bar_local.accounting_accounts FROM bar_local_runtime;

ALTER FUNCTION bar_local.cmd_accounting_account_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_accounting_account_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_accounting_account_upsert(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_accounting_account_upsert(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch_expenses(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_expenses(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_expenses(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_expenses(text, uuid, uuid, bigint, text, jsonb) FROM bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
