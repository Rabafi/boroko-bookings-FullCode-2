-- Locally owned loyalty programme and append-only points ledger. Never apply
-- this file to hosted Supabase.

CREATE TABLE IF NOT EXISTS bar_local.loyalty_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid REFERENCES bar_local.outlets(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  earn_rate numeric(12,4) NOT NULL DEFAULT 0 CHECK (earn_rate >= 0),
  redeem_value numeric(14,4) NOT NULL DEFAULT 0 CHECK (redeem_value >= 0),
  min_redeem_points integer NOT NULL DEFAULT 0 CHECK (min_redeem_points >= 0),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_programs_business_global_key
  ON bar_local.loyalty_programs (business_id) WHERE outlet_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_programs_business_outlet_key
  ON bar_local.loyalty_programs (business_id, outlet_id) WHERE outlet_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bar_local.loyalty_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  customer_id uuid NOT NULL REFERENCES bar_local.customers(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  points_balance bigint NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  operation_id uuid NOT NULL UNIQUE,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id)
);

CREATE TABLE IF NOT EXISTS bar_local.loyalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  account_id uuid NOT NULL REFERENCES bar_local.loyalty_accounts(id),
  points_delta bigint NOT NULL CHECK (points_delta <> 0),
  type text NOT NULL CHECK (type IN ('earn', 'redeem', 'adjust', 'expire', 'reversal')),
  sale_id uuid REFERENCES bar_local.sales(id),
  operation_id uuid NOT NULL UNIQUE,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (type <> 'earn' OR (points_delta > 0 AND sale_id IS NOT NULL)),
  CHECK (type <> 'redeem' OR (points_delta < 0 AND reference IS NOT NULL AND length(btrim(reference)) > 0)),
  CHECK (type <> 'adjust' OR (reference IS NOT NULL AND length(btrim(reference)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_ledger_sale_earn_key
  ON bar_local.loyalty_ledger (sale_id) WHERE type = 'earn' AND sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS loyalty_ledger_account_created_idx
  ON bar_local.loyalty_ledger (account_id, created_at, id);
CREATE INDEX IF NOT EXISTS loyalty_ledger_business_created_idx
  ON bar_local.loyalty_ledger (business_id, outlet_id, created_at DESC);

CREATE OR REPLACE FUNCTION bar_local.loyalty_ledger_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM bar_local.raise_business('LOYALTY_LEDGER_IMMUTABLE',
    'Loyalty ledger entries are append-only and cannot be changed or deleted.');
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS loyalty_ledger_append_only_row ON bar_local.loyalty_ledger;
CREATE TRIGGER loyalty_ledger_append_only_row
  BEFORE UPDATE OR DELETE ON bar_local.loyalty_ledger
  FOR EACH ROW EXECUTE FUNCTION bar_local.loyalty_ledger_append_only();
DROP TRIGGER IF EXISTS loyalty_ledger_append_only_statement ON bar_local.loyalty_ledger;
CREATE TRIGGER loyalty_ledger_append_only_statement
  BEFORE TRUNCATE ON bar_local.loyalty_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION bar_local.loyalty_ledger_append_only();

CREATE OR REPLACE FUNCTION bar_local.loyalty_active_program(p_business_id uuid, p_outlet_id uuid)
RETURNS bar_local.loyalty_programs LANGUAGE sql STABLE AS $$
  SELECT p.*
    FROM bar_local.loyalty_programs p
   WHERE p.business_id = p_business_id
     AND p.active
     AND (p.outlet_id IS NULL OR p.outlet_id = p_outlet_id)
   ORDER BY (p.outlet_id IS NOT NULL) DESC, p.version DESC
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION bar_local.loyalty_program_json(p_program_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'program_id', p.id, 'name', p.name, 'outlet_id', p.outlet_id,
    'earn_rate', p.earn_rate, 'redeem_value', p.redeem_value,
    'min_redeem_points', p.min_redeem_points, 'active', p.active,
    'version', p.version, 'created_at', p.created_at, 'updated_at', p.updated_at
  )
  FROM bar_local.loyalty_programs p
  WHERE p.id = p_program_id;
$$;

CREATE OR REPLACE FUNCTION bar_local.loyalty_account_json(p_account_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'account_id', a.id, 'customer_id', a.customer_id, 'customer_name', c.name,
    'status', a.status, 'points_balance', a.points_balance, 'version', a.version,
    'enrolled_at', a.enrolled_at, 'updated_at', a.updated_at
  )
  FROM bar_local.loyalty_accounts a
  JOIN bar_local.customers c ON c.id = a.customer_id
  WHERE a.id = p_account_id;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_loyalty_program_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_program bar_local.loyalty_programs%ROWTYPE;
  v_program_id uuid := NULLIF(v_payload->>'program_id', '')::uuid;
  v_outlet_id uuid;
  v_name text;
  v_earn_rate numeric(12,4);
  v_redeem_value numeric(14,4);
  v_min_redeem_points integer;
  v_active boolean;
  v_expected_version integer;
  v_before jsonb;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  IF NOT (v_ctx.capabilities @> ARRAY['accounting.manage'] OR v_ctx.capabilities @> ARRAY['settings.manage']) THEN
    PERFORM bar_local.raise_business('CAPABILITY_DENIED',
      'Loyalty programme changes require the accounting.manage or settings.manage capability.');
  END IF;
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_earn_rate := round((v_payload->>'earn_rate')::numeric, 4);
    v_redeem_value := COALESCE(round((v_payload->>'redeem_value')::numeric, 4), 0);
    v_min_redeem_points := COALESCE((v_payload->>'min_redeem_points')::integer, 0);
    v_active := COALESCE((v_payload->>'active')::boolean, true);
    v_name := NULLIF(btrim(v_payload->>'name'), '');
    v_outlet_id := CASE WHEN jsonb_exists(v_payload, 'outlet_id')
                        THEN NULLIF(v_payload->>'outlet_id', '')::uuid END;
    IF v_earn_rate IS NULL OR v_earn_rate < 0 OR v_redeem_value < 0 OR v_min_redeem_points < 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED',
        'The loyalty programme needs a non-negative earn rate, redeem value and minimum redemption.');
    END IF;
    IF v_outlet_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bar_local.outlets WHERE id = v_outlet_id AND business_id = v_ctx.business_id
    ) THEN
      PERFORM bar_local.raise_business('OUTLET_NOT_FOUND', 'The programme outlet does not belong to this business.');
    END IF;

    IF v_program_id IS NOT NULL THEN
      SELECT * INTO v_program FROM bar_local.loyalty_programs
       WHERE id = v_program_id AND business_id = v_ctx.business_id
       FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('LOYALTY_PROGRAM_NOT_FOUND', 'The loyalty programme could not be found in this business.');
      END IF;
      IF NOT jsonb_exists(v_payload, 'outlet_id') THEN
        v_outlet_id := v_program.outlet_id;
      END IF;
      v_expected_version := NULLIF(v_payload->>'expected_version', '')::integer;
      IF v_expected_version IS NULL OR v_expected_version <> v_program.version THEN
        PERFORM bar_local.raise_business('LOYALTY_PROGRAM_VERSION_CONFLICT',
          'The loyalty programme changed since it was loaded. Refresh and try again.');
      END IF;
      v_before := bar_local.loyalty_program_json(v_program.id);
      UPDATE bar_local.loyalty_programs
         SET name = COALESCE(v_name, v_program.name), outlet_id = v_outlet_id,
             earn_rate = v_earn_rate, redeem_value = v_redeem_value,
             min_redeem_points = v_min_redeem_points, active = v_active,
             version = version + 1, updated_at = now()
       WHERE id = v_program.id
       RETURNING * INTO v_program;
    ELSE
      IF v_outlet_id IS NULL THEN
        SELECT * INTO v_program FROM bar_local.loyalty_programs
         WHERE business_id = v_ctx.business_id AND outlet_id IS NULL FOR UPDATE;
      ELSE
        SELECT * INTO v_program FROM bar_local.loyalty_programs
         WHERE business_id = v_ctx.business_id AND outlet_id = v_outlet_id FOR UPDATE;
      END IF;
      IF FOUND THEN
        v_expected_version := NULLIF(v_payload->>'expected_version', '')::integer;
        IF v_expected_version IS NULL OR v_expected_version <> v_program.version THEN
          PERFORM bar_local.raise_business('LOYALTY_PROGRAM_VERSION_CONFLICT',
            'The loyalty programme changed since it was loaded. Refresh and try again.');
        END IF;
        v_before := bar_local.loyalty_program_json(v_program.id);
        UPDATE bar_local.loyalty_programs
           SET name = COALESCE(v_name, v_program.name),
               earn_rate = v_earn_rate, redeem_value = v_redeem_value,
               min_redeem_points = v_min_redeem_points, active = v_active,
               version = version + 1, updated_at = now()
         WHERE id = v_program.id
         RETURNING * INTO v_program;
      ELSE
        INSERT INTO bar_local.loyalty_programs
          (business_id, outlet_id, name, earn_rate, redeem_value, min_redeem_points, active)
        VALUES
          (v_ctx.business_id, v_outlet_id, COALESCE(v_name, 'Loyalty programme'),
           v_earn_rate, v_redeem_value, v_min_redeem_points, v_active)
        RETURNING * INTO v_program;
      END IF;
    END IF;

    v_result := bar_local.loyalty_program_json(v_program.id);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'loyalty.program.upserted', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'loyalty.program.upserted', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_LOYALTY_PROGRAM';
      v_message := 'A loyalty programme already exists for this business and outlet scope.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_code := 'VALIDATION_FAILED';
      v_message := 'The loyalty programme values are not valid numbers.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_loyalty_account_enrol(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_customer bar_local.customers%ROWTYPE;
  v_account bar_local.loyalty_accounts%ROWTYPE;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'customers.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF NULLIF(v_payload->>'customer_id', '') IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A customer is required to enrol in the loyalty programme.');
    END IF;
    SELECT * INTO v_customer FROM bar_local.customers
     WHERE id = (v_payload->>'customer_id')::uuid AND business_id = v_ctx.business_id
     FOR SHARE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('CUSTOMER_NOT_FOUND', 'The customer could not be found in this business.');
    END IF;
    IF v_customer.status <> 'active' THEN
      PERFORM bar_local.raise_business('CUSTOMER_INACTIVE', 'A blocked customer cannot be enrolled in the loyalty programme.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM bar_local.loyalty_accounts
       WHERE business_id = v_ctx.business_id AND customer_id = v_customer.id
    ) THEN
      PERFORM bar_local.raise_business('LOYALTY_ACCOUNT_EXISTS',
        'This customer already has a loyalty account. Use the existing account instead of enrolling again.');
    END IF;
    INSERT INTO bar_local.loyalty_accounts (business_id, customer_id, operation_id)
    VALUES (v_ctx.business_id, v_customer.id, (p_envelope->>'operation_id')::uuid)
    RETURNING * INTO v_account;
    v_result := bar_local.loyalty_account_json(v_account.id);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'loyalty.account.enrolled', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'loyalty.account.enrolled', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'LOYALTY_ACCOUNT_EXISTS';
      v_message := 'This customer already has a loyalty account.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN invalid_text_representation THEN
      v_code := 'VALIDATION_FAILED';
      v_message := 'The customer identifier is not valid.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_loyalty_points_earn(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_sale bar_local.sales%ROWTYPE;
  v_account bar_local.loyalty_accounts%ROWTYPE;
  v_program bar_local.loyalty_programs%ROWTYPE;
  v_points bigint;
  v_ledger_id uuid;
  v_reference text;
  v_before jsonb;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'customers.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF NULLIF(v_payload->>'sale_id', '') IS NULL OR NULLIF(v_payload->>'customer_id', '') IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A sale and customer are required to earn loyalty points.');
    END IF;
    SELECT * INTO v_sale FROM bar_local.sales
     WHERE id = (v_payload->>'sale_id')::uuid
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR SHARE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('LOYALTY_SALE_NOT_FOUND', 'The sale could not be found in this business and outlet.');
    END IF;
    IF v_sale.status <> 'completed' THEN
      PERFORM bar_local.raise_business('LOYALTY_SALE_NOT_COMPLETED', 'Loyalty points can only be earned on a completed sale.');
    END IF;
    IF v_sale.customer_id IS NOT NULL AND v_sale.customer_id <> (v_payload->>'customer_id')::uuid THEN
      PERFORM bar_local.raise_business('LOYALTY_CUSTOMER_MISMATCH',
        'The sale belongs to a different customer. Earn points for the sale customer.');
    END IF;
    SELECT * INTO v_account FROM bar_local.loyalty_accounts
     WHERE business_id = v_ctx.business_id AND customer_id = (v_payload->>'customer_id')::uuid
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('LOYALTY_ACCOUNT_NOT_FOUND', 'This customer is not enrolled in the loyalty programme.');
    END IF;
    IF v_account.status <> 'active' THEN
      PERFORM bar_local.raise_business('LOYALTY_ACCOUNT_INACTIVE', 'This loyalty account is suspended.');
    END IF;
    SELECT * INTO v_program FROM bar_local.loyalty_active_program(v_ctx.business_id, v_ctx.outlet_id) LIMIT 1;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('LOYALTY_PROGRAM_UNAVAILABLE', 'No active loyalty programme is available for this outlet.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM bar_local.loyalty_ledger
       WHERE sale_id = v_sale.id AND type = 'earn'
    ) THEN
      PERFORM bar_local.raise_business('DUPLICATE_LOYALTY_EARN',
        'Loyalty points have already been earned for this sale.');
    END IF;
    v_points := floor(v_sale.subtotal * v_program.earn_rate)::bigint;
    IF v_points <= 0 THEN
      PERFORM bar_local.raise_business('LOYALTY_NO_POINTS',
        'This sale subtotal does not earn any loyalty points under the active programme.');
    END IF;
    v_reference := COALESCE(NULLIF(btrim(v_payload->>'reference'), ''),
      'sale:' || v_sale.receipt_series || '-' || v_sale.receipt_number::text);
    v_before := bar_local.loyalty_account_json(v_account.id);
    INSERT INTO bar_local.loyalty_ledger
      (business_id, outlet_id, account_id, points_delta, type, sale_id, operation_id, reference)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_account.id, v_points, 'earn', v_sale.id,
       (p_envelope->>'operation_id')::uuid, v_reference)
    RETURNING id INTO v_ledger_id;
    UPDATE bar_local.loyalty_accounts
       SET points_balance = points_balance + v_points, version = version + 1, updated_at = now()
     WHERE id = v_account.id
     RETURNING * INTO v_account;
    v_result := jsonb_build_object(
      'account_id', v_account.id, 'customer_id', v_account.customer_id,
      'sale_id', v_sale.id, 'transaction_id', v_ledger_id,
      'points_delta', v_points, 'points_balance', v_account.points_balance,
      'earn_rate', v_program.earn_rate, 'program_id', v_program.id,
      'version', v_account.version
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'loyalty.points.earned', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'loyalty.points.earned', 'payload', v_result)),
      v_sale.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_LOYALTY_EARN';
      v_message := 'Loyalty points have already been earned for this sale.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN invalid_text_representation THEN
      v_code := 'VALIDATION_FAILED';
      v_message := 'The sale or customer identifier is not valid.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_loyalty_points_redeem(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_account bar_local.loyalty_accounts%ROWTYPE;
  v_program bar_local.loyalty_programs%ROWTYPE;
  v_sale bar_local.sales%ROWTYPE;
  v_points numeric;
  v_reference text;
  v_ledger_id uuid;
  v_business_date date;
  v_before jsonb;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'customers.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF NULLIF(v_payload->>'customer_id', '') IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A customer is required to redeem loyalty points.');
    END IF;
    v_points := (v_payload->>'points')::numeric;
    IF v_points IS NULL OR v_points <= 0 OR v_points <> trunc(v_points) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Redeemed points must be a positive whole number.');
    END IF;
    v_reference := NULLIF(btrim(v_payload->>'reference'), '');
    IF v_reference IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A redemption reference is required.');
    END IF;
    SELECT * INTO v_account FROM bar_local.loyalty_accounts
     WHERE business_id = v_ctx.business_id AND customer_id = (v_payload->>'customer_id')::uuid
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('LOYALTY_ACCOUNT_NOT_FOUND', 'This customer is not enrolled in the loyalty programme.');
    END IF;
    IF v_account.status <> 'active' THEN
      PERFORM bar_local.raise_business('LOYALTY_ACCOUNT_INACTIVE', 'This loyalty account is suspended.');
    END IF;
    SELECT * INTO v_program FROM bar_local.loyalty_active_program(v_ctx.business_id, v_ctx.outlet_id) LIMIT 1;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('LOYALTY_PROGRAM_UNAVAILABLE', 'No active loyalty programme is available for this outlet.');
    END IF;
    IF v_points < v_program.min_redeem_points THEN
      PERFORM bar_local.raise_business('LOYALTY_MIN_REDEEM',
        'This redemption is below the minimum points required by the active programme.');
    END IF;
    IF v_account.points_balance < v_points::bigint THEN
      PERFORM bar_local.raise_business('INSUFFICIENT_LOYALTY_POINTS',
        'This loyalty account does not have enough points for the redemption.');
    END IF;
    v_business_date := bar_local.current_business_date();
    IF NULLIF(v_payload->>'sale_id', '') IS NOT NULL THEN
      SELECT * INTO v_sale FROM bar_local.sales
       WHERE id = (v_payload->>'sale_id')::uuid
         AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
       FOR SHARE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('LOYALTY_SALE_NOT_FOUND', 'The redemption sale could not be found in this business and outlet.');
      END IF;
      IF v_sale.status <> 'completed' THEN
        PERFORM bar_local.raise_business('LOYALTY_SALE_NOT_COMPLETED', 'Loyalty points can only be redeemed against a completed sale.');
      END IF;
      v_business_date := v_sale.business_date;
    END IF;
    v_before := bar_local.loyalty_account_json(v_account.id);
    INSERT INTO bar_local.loyalty_ledger
      (business_id, outlet_id, account_id, points_delta, type, sale_id, operation_id, reference)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_account.id, -(v_points::bigint), 'redeem',
       NULLIF(v_payload->>'sale_id', '')::uuid, (p_envelope->>'operation_id')::uuid, v_reference)
    RETURNING id INTO v_ledger_id;
    UPDATE bar_local.loyalty_accounts
       SET points_balance = points_balance - v_points::bigint, version = version + 1, updated_at = now()
     WHERE id = v_account.id
     RETURNING * INTO v_account;
    v_result := jsonb_build_object(
      'account_id', v_account.id, 'customer_id', v_account.customer_id,
      'transaction_id', v_ledger_id, 'points_delta', -(v_points::bigint),
      'points_balance', v_account.points_balance, 'redeem_value', v_program.redeem_value,
      'redemption_value', round(v_points * v_program.redeem_value, 2),
      'reference', v_reference, 'version', v_account.version
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'loyalty.points.redeemed', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'loyalty.points.redeemed', 'payload', v_result)),
      v_business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_LOYALTY_REDEMPTION';
      v_message := 'This redemption operation was already recorded.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_code := 'VALIDATION_FAILED';
      v_message := 'The customer, sale or points value is not valid.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_loyalty_points_adjust(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_account bar_local.loyalty_accounts%ROWTYPE;
  v_points numeric;
  v_reason text;
  v_ledger_id uuid;
  v_before jsonb;
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
    IF NULLIF(v_payload->>'customer_id', '') IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A customer is required to adjust loyalty points.');
    END IF;
    v_points := (v_payload->>'points')::numeric;
    IF v_points IS NULL OR v_points = 0 OR v_points <> trunc(v_points) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'An adjustment must be a non-zero whole number of points.');
    END IF;
    v_reason := NULLIF(btrim(v_payload->>'reason'), '');
    IF v_reason IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A reason is required for a loyalty points adjustment.');
    END IF;
    SELECT * INTO v_account FROM bar_local.loyalty_accounts
     WHERE business_id = v_ctx.business_id AND customer_id = (v_payload->>'customer_id')::uuid
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('LOYALTY_ACCOUNT_NOT_FOUND', 'This customer is not enrolled in the loyalty programme.');
    END IF;
    IF v_account.status <> 'active' THEN
      PERFORM bar_local.raise_business('LOYALTY_ACCOUNT_INACTIVE', 'This loyalty account is suspended.');
    END IF;
    IF v_account.points_balance + (v_points::bigint) < 0 THEN
      PERFORM bar_local.raise_business('INSUFFICIENT_LOYALTY_POINTS',
        'This adjustment would make the loyalty points balance negative.');
    END IF;
    v_before := bar_local.loyalty_account_json(v_account.id);
    INSERT INTO bar_local.loyalty_ledger
      (business_id, outlet_id, account_id, points_delta, type, sale_id, operation_id, reference)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_account.id, v_points::bigint, 'adjust', NULL,
       (p_envelope->>'operation_id')::uuid, v_reason)
    RETURNING id INTO v_ledger_id;
    UPDATE bar_local.loyalty_accounts
       SET points_balance = points_balance + (v_points::bigint), version = version + 1, updated_at = now()
     WHERE id = v_account.id
     RETURNING * INTO v_account;
    v_result := jsonb_build_object(
      'account_id', v_account.id, 'customer_id', v_account.customer_id,
      'transaction_id', v_ledger_id, 'points_delta', v_points::bigint,
      'points_balance', v_account.points_balance, 'reason', v_reason,
      'version', v_account.version
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'loyalty.points.adjusted', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'loyalty.points.adjusted', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_LOYALTY_ADJUSTMENT';
      v_message := 'This adjustment operation was already recorded.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_code := 'VALIDATION_FAILED';
      v_message := 'The customer or points value is not valid.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

REVOKE ALL ON bar_local.loyalty_programs FROM PUBLIC;
REVOKE ALL ON bar_local.loyalty_accounts FROM PUBLIC;
REVOKE ALL ON bar_local.loyalty_ledger FROM PUBLIC;
REVOKE ALL ON bar_local.loyalty_programs FROM bar_local_runtime;
REVOKE ALL ON bar_local.loyalty_accounts FROM bar_local_runtime;
REVOKE ALL ON bar_local.loyalty_ledger FROM bar_local_runtime;

REVOKE ALL ON FUNCTION bar_local.loyalty_ledger_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.loyalty_active_program(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.loyalty_program_json(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.loyalty_account_json(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.loyalty_ledger_append_only() FROM bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.loyalty_active_program(uuid, uuid) FROM bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.loyalty_program_json(uuid) FROM bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.loyalty_account_json(uuid) FROM bar_local_runtime;

ALTER FUNCTION bar_local.loyalty_ledger_append_only() SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.loyalty_active_program(uuid, uuid) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.loyalty_program_json(uuid) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.loyalty_account_json(uuid) SET search_path = pg_catalog, bar_local;

ALTER FUNCTION bar_local.cmd_loyalty_program_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_loyalty_program_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_loyalty_account_enrol(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_loyalty_account_enrol(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_loyalty_points_earn(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_loyalty_points_earn(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_loyalty_points_redeem(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_loyalty_points_redeem(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_loyalty_points_adjust(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_loyalty_points_adjust(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;

REVOKE ALL ON FUNCTION bar_local.cmd_loyalty_program_upsert(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_loyalty_account_enrol(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_loyalty_points_earn(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_loyalty_points_redeem(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_loyalty_points_adjust(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_loyalty_program_upsert(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_loyalty_account_enrol(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_loyalty_points_earn(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_loyalty_points_redeem(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_loyalty_points_adjust(text, uuid, jsonb, text, text) TO bar_local_runtime;
