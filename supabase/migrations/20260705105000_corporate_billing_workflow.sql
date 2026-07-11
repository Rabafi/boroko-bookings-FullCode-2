-- 20260705105000_corporate_billing_workflow.sql
-- Corporate billing: invoices, payments, and credit management

CREATE TABLE IF NOT EXISTS corporate_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_account_id uuid NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  lodge_id uuid NOT NULL,
  invoice_number text NOT NULL,
  description text DEFAULT '',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) DEFAULT 0,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  paid_date date,
  reference_booking_ids uuid[] DEFAULT '{}',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(lodge_id, invoice_number)
);

ALTER TABLE corporate_invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY corporate_invoice_items_lodge_policy ON corporate_invoice_items
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_corp_inv_items_account ON corporate_invoice_items(corporate_account_id);
CREATE INDEX IF NOT EXISTS idx_corp_inv_items_lodge_status ON corporate_invoice_items(lodge_id, status);
CREATE INDEX IF NOT EXISTS idx_corp_inv_items_due ON corporate_invoice_items(lodge_id, due_date);

CREATE TABLE IF NOT EXISTS corporate_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_account_id uuid NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  lodge_id uuid NOT NULL,
  invoice_id uuid REFERENCES corporate_invoice_items(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT 'bank_transfer' CHECK (payment_method IN ('bank_transfer','cheque','cash','credit_card','other')),
  reference text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE corporate_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY corporate_payments_lodge_policy ON corporate_payments
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_corp_payments_account ON corporate_payments(corporate_account_id);
CREATE INDEX IF NOT EXISTS idx_corp_payments_invoice ON corporate_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_corp_payments_lodge ON corporate_payments(lodge_id);

-- Charge to corporate account
CREATE OR REPLACE FUNCTION charge_to_corporate_account(
  p_account_id uuid,
  p_lodge_id uuid,
  p_booking_id uuid,
  p_amount numeric,
  p_description text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_number text;
  v_invoice_id uuid;
  v_corp corporate_accounts%ROWTYPE;
  v_new_balance numeric;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  SELECT * INTO v_corp FROM corporate_accounts WHERE id = p_account_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Corporate account not found');
  END IF;

  IF v_corp.status = 'suspended' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Corporate account is suspended');
  END IF;

  v_invoice_number := 'INV-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(
    (SELECT count(*) + 1 FROM corporate_invoice_items WHERE lodge_id = p_lodge_id)::text, 4, '0'
  );

  v_invoice_id := gen_random_uuid();
  INSERT INTO corporate_invoice_items (
    id, corporate_account_id, lodge_id, invoice_number, description,
    amount, tax_amount, issue_date, due_date, status, reference_booking_ids
  ) VALUES (
    v_invoice_id, p_account_id, p_lodge_id, v_invoice_number,
    p_description, p_amount, 0, CURRENT_DATE,
    CURRENT_DATE + v_corp.payment_terms_days, 'draft',
    ARRAY[p_booking_id]
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'amount', p_amount,
    'due_date', CURRENT_DATE + v_corp.payment_terms_days
  );
END;
$$;

GRANT EXECUTE ON FUNCTION charge_to_corporate_account(uuid, uuid, uuid, numeric, text) TO authenticated;

-- Get corporate outstanding with aging
CREATE OR REPLACE FUNCTION get_corporate_outstanding(
  p_account_id uuid,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_date date := CURRENT_DATE;
  v_result jsonb;
  v_credit_limit numeric;
  v_invoices_total numeric;
BEGIN
  SELECT credit_limit INTO v_credit_limit
  FROM corporate_accounts WHERE id = p_account_id AND lodge_id = p_lodge_id;

  SELECT jsonb_build_object(
    'current', COALESCE(sum(CASE WHEN i.due_date >= v_current_date AND i.status IN ('draft','sent') THEN i.amount - COALESCE(cp.paid_amt, 0) ELSE 0 END), 0),
    'days_1_30', COALESCE(sum(CASE WHEN i.due_date >= v_current_date - 30 AND i.due_date < v_current_date AND i.status IN ('draft','sent','overdue') THEN i.amount - COALESCE(cp.paid_amt, 0) ELSE 0 END), 0),
    'days_31_60', COALESCE(sum(CASE WHEN i.due_date >= v_current_date - 60 AND i.due_date < v_current_date - 30 AND i.status IN ('draft','sent','overdue') THEN i.amount - COALESCE(cp.paid_amt, 0) ELSE 0 END), 0),
    'days_61_90', COALESCE(sum(CASE WHEN i.due_date >= v_current_date - 90 AND i.due_date < v_current_date - 60 AND i.status IN ('draft','sent','overdue') THEN i.amount - COALESCE(cp.paid_amt, 0) ELSE 0 END), 0),
    'over_90', COALESCE(sum(CASE WHEN i.due_date < v_current_date - 90 AND i.status IN ('draft','sent','overdue') THEN i.amount - COALESCE(cp.paid_amt, 0) ELSE 0 END), 0),
    'total_outstanding', COALESCE(sum(CASE WHEN i.status IN ('draft','sent','overdue') THEN i.amount - COALESCE(cp.paid_amt, 0) ELSE 0 END), 0),
    'credit_limit', COALESCE(v_credit_limit, 0)
  ) INTO v_result
  FROM corporate_invoice_items i
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(cp.amount), 0) as paid_amt
    FROM corporate_payments cp
    WHERE cp.invoice_id = i.id
  ) cp ON true
  WHERE i.corporate_account_id = p_account_id AND i.lodge_id = p_lodge_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_corporate_outstanding(uuid, uuid) TO authenticated;

-- Record corporate payment
CREATE OR REPLACE FUNCTION record_corporate_payment(
  p_account_id uuid,
  p_lodge_id uuid,
  p_invoice_ids uuid[],
  p_amount numeric,
  p_payment_method text DEFAULT 'bank_transfer',
  p_reference text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
  v_invoice_id uuid;
  v_total_outstanding numeric;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment amount must be positive');
  END IF;

  SELECT COALESCE(sum(i.amount - COALESCE(cp.paid_amt, 0)), 0) INTO v_total_outstanding
  FROM corporate_invoice_items i
  LEFT JOIN LATERAL (SELECT COALESCE(sum(cp2.amount), 0) as paid_amt FROM corporate_payments cp2 WHERE cp2.invoice_id = i.id) cp ON true
  WHERE i.id = ANY(p_invoice_ids) AND i.corporate_account_id = p_account_id AND i.lodge_id = p_lodge_id;

  IF p_amount > v_total_outstanding THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment amount exceeds outstanding balance');
  END IF;

  FOREACH v_invoice_id IN ARRAY p_invoice_ids
  LOOP
    INSERT INTO corporate_payments (id, corporate_account_id, lodge_id, invoice_id, amount, payment_date, payment_method, reference)
    VALUES (gen_random_uuid(), p_account_id, p_lodge_id, v_invoice_id, p_amount / array_length(p_invoice_ids, 1), CURRENT_DATE, p_payment_method, p_reference);
  END LOOP;

  -- Update invoice statuses where full amount paid
  FOR v_invoice_id IN SELECT unnest(p_invoice_ids)
  LOOP
    UPDATE corporate_invoice_items i SET
      status = CASE
        WHEN (SELECT COALESCE(sum(cp3.amount), 0) FROM corporate_payments cp3 WHERE cp3.invoice_id = i.id) >= i.amount THEN 'paid'
        ELSE i.status
      END,
      paid_date = CASE
        WHEN (SELECT COALESCE(sum(cp3.amount), 0) FROM corporate_payments cp3 WHERE cp3.invoice_id = i.id) >= i.amount THEN CURRENT_DATE
        ELSE paid_date
      END,
      updated_at = now()
    WHERE i.id = v_invoice_id;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'message', 'Payment recorded');
END;
$$;

GRANT EXECUTE ON FUNCTION record_corporate_payment(uuid, uuid, uuid[], numeric, text, text) TO authenticated;

-- Get corporate statement
CREATE OR REPLACE FUNCTION get_corporate_statement(
  p_account_id uuid,
  p_lodge_id uuid,
  p_period_start date,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoices jsonb;
  v_payments jsonb;
  v_opening numeric;
  v_closing numeric;
BEGIN
  SELECT COALESCE(sum(i.amount - COALESCE(cp.paid_amt, 0)), 0) INTO v_opening
  FROM corporate_invoice_items i
  LEFT JOIN LATERAL (SELECT COALESCE(sum(cp2.amount), 0) as paid_amt FROM corporate_payments cp2 WHERE cp2.invoice_id = i.id) cp ON true
  WHERE i.corporate_account_id = p_account_id AND i.lodge_id = p_lodge_id AND i.issue_date < p_period_start;

  SELECT jsonb_agg(jsonb_build_object(
    'id', i.id, 'invoice_number', i.invoice_number, 'description', i.description,
    'amount', i.amount, 'tax_amount', i.tax_amount, 'issue_date', i.issue_date,
    'due_date', i.due_date, 'status', i.status, 'paid_date', i.paid_date,
    'total_paid', COALESCE(cp_sum.paid, 0),
    'balance_due', i.amount - COALESCE(cp_sum.paid, 0)
  ) ORDER BY i.issue_date) INTO v_invoices
  FROM corporate_invoice_items i
  LEFT JOIN LATERAL (SELECT COALESCE(sum(cp3.amount), 0) as paid FROM corporate_payments cp3 WHERE cp3.invoice_id = i.id) cp_sum ON true
  WHERE i.corporate_account_id = p_account_id AND i.lodge_id = p_lodge_id
    AND i.issue_date >= p_period_start AND i.issue_date <= p_period_end;

  SELECT jsonb_agg(jsonb_build_object(
    'id', cp.id, 'amount', cp.amount, 'payment_date', cp.payment_date,
    'payment_method', cp.payment_method, 'reference', cp.reference
  ) ORDER BY cp.payment_date) INTO v_payments
  FROM corporate_payments cp
  WHERE cp.corporate_account_id = p_account_id AND cp.lodge_id = p_lodge_id
    AND cp.payment_date >= p_period_start AND cp.payment_date <= p_period_end;

  SELECT COALESCE(sum(i2.amount - COALESCE(cp4.paid_amt, 0)), 0) INTO v_closing
  FROM corporate_invoice_items i2
  LEFT JOIN LATERAL (SELECT COALESCE(sum(cp5.amount), 0) as paid_amt FROM corporate_payments cp5 WHERE cp5.invoice_id = i2.id) cp4 ON true
  WHERE i2.corporate_account_id = p_account_id AND i2.lodge_id = p_lodge_id AND i2.issue_date <= p_period_end;

  RETURN jsonb_build_object(
    'success', true,
    'account_id', p_account_id,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'opening_balance', v_opening,
    'closing_balance', v_closing,
    'invoices', COALESCE(v_invoices, '[]'::jsonb),
    'payments', COALESCE(v_payments, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_corporate_statement(uuid, uuid, date, date) TO authenticated;

-- Check credit limit with pending
CREATE OR REPLACE FUNCTION check_credit_limit_with_pending(
  p_account_id uuid,
  p_lodge_id uuid,
  p_pending_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credit_limit numeric;
  v_current_outstanding numeric;
  v_within_limit boolean;
BEGIN
  SELECT credit_limit INTO v_credit_limit
  FROM corporate_accounts WHERE id = p_account_id AND lodge_id = p_lodge_id;

  IF v_credit_limit IS NULL OR v_credit_limit = 0 THEN
    RETURN jsonb_build_object('success', true, 'within_limit', true, 'credit_limit', 0, 'current_outstanding', 0);
  END IF;

  SELECT COALESCE(sum(i.amount - COALESCE(cp.paid_amt, 0)), 0) INTO v_current_outstanding
  FROM corporate_invoice_items i
  LEFT JOIN LATERAL (SELECT COALESCE(sum(cp2.amount), 0) as paid_amt FROM corporate_payments cp2 WHERE cp2.invoice_id = i.id) cp ON true
  WHERE i.corporate_account_id = p_account_id AND i.lodge_id = p_lodge_id AND i.status IN ('draft','sent','overdue');

  v_within_limit := (v_current_outstanding + p_pending_amount) <= v_credit_limit;

  RETURN jsonb_build_object(
    'success', true,
    'within_limit', v_within_limit,
    'credit_limit', v_credit_limit,
    'current_outstanding', v_current_outstanding,
    'pending_amount', p_pending_amount,
    'projected_balance', v_current_outstanding + p_pending_amount,
    'available_credit', greatest(0, v_credit_limit - v_current_outstanding - p_pending_amount)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION check_credit_limit_with_pending(uuid, uuid, numeric) TO authenticated;

-- Suspend corporate account
CREATE OR REPLACE FUNCTION suspend_corporate_account(
  p_account_id uuid,
  p_lodge_id uuid,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  UPDATE corporate_accounts SET status = 'suspended', notes = COALESCE(notes || E'\n' || p_reason, p_reason), updated_at = now()
  WHERE id = p_account_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Corporate account not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Account suspended');
END;
$$;

GRANT EXECUTE ON FUNCTION suspend_corporate_account(uuid, uuid, text) TO authenticated;

-- Reactivate corporate account
CREATE OR REPLACE FUNCTION reactivate_corporate_account(
  p_account_id uuid,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  UPDATE corporate_accounts SET status = 'active', updated_at = now()
  WHERE id = p_account_id AND lodge_id = p_lodge_id AND status = 'suspended';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Corporate account not found or not suspended');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Account reactivated');
END;
$$;

GRANT EXECUTE ON FUNCTION reactivate_corporate_account(uuid, uuid) TO authenticated;
