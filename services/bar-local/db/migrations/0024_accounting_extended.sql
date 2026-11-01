CREATE TABLE bar_local.tax_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  code text NOT NULL CHECK (code ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  rate numeric(7,4) NOT NULL CHECK (rate >= 0 AND rate <= 1),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  operation_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code, version)
);
CREATE INDEX tax_codes_current_idx ON bar_local.tax_codes (business_id, code, version DESC);

CREATE TABLE bar_local.ap_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  supplier_id uuid NOT NULL REFERENCES bar_local.suppliers(id),
  invoice_number text NOT NULL CHECK (length(btrim(invoice_number)) BETWEEN 1 AND 80),
  invoice_date date NOT NULL,
  due_date date,
  purchase_order_id uuid REFERENCES bar_local.purchase_orders(id),
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  payable_account_code text NOT NULL REFERENCES bar_local.accounting_accounts(code),
  tax_account_code text REFERENCES bar_local.accounting_accounts(code),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  journal_entry_id uuid REFERENCES bar_local.journal_entries(id),
  approved_by uuid REFERENCES bar_local.staff(id),
  approved_at timestamptz,
  approval_operation_id uuid,
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  operation_id uuid NOT NULL UNIQUE,
  updated_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total = subtotal + tax_total),
  CHECK (due_date IS NULL OR due_date >= invoice_date)
);
CREATE UNIQUE INDEX ap_invoices_supplier_number_key ON bar_local.ap_invoices (business_id, supplier_id, lower(invoice_number));
CREATE INDEX ap_invoices_outlet_date_idx ON bar_local.ap_invoices (business_id, outlet_id, invoice_date DESC, created_at DESC);
CREATE INDEX ap_invoices_status_idx ON bar_local.ap_invoices (business_id, outlet_id, status);

CREATE TABLE bar_local.ap_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ap_invoice_id uuid NOT NULL REFERENCES bar_local.ap_invoices(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 240),
  expense_account_code text NOT NULL REFERENCES bar_local.accounting_accounts(code),
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  tax_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 1),
  line_subtotal numeric(14,2) NOT NULL CHECK (line_subtotal >= 0),
  line_tax numeric(14,2) NOT NULL DEFAULT 0 CHECK (line_tax >= 0),
  line_total numeric(14,2) NOT NULL CHECK (line_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ap_invoice_id, line_number),
  CHECK (line_total = line_subtotal + line_tax)
);

CREATE TABLE bar_local.ap_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  ap_invoice_id uuid NOT NULL REFERENCES bar_local.ap_invoices(id),
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'bank' CHECK (method IN ('bank', 'cash', 'card', 'mobile_money', 'other')),
  payment_account_code text NOT NULL REFERENCES bar_local.accounting_accounts(code),
  reference text,
  status text NOT NULL CHECK (status IN ('posted', 'reversal')),
  reverses_payment_id uuid REFERENCES bar_local.ap_payments(id),
  journal_entry_id uuid NOT NULL REFERENCES bar_local.journal_entries(id),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  operation_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'posted' AND reverses_payment_id IS NULL)
    OR (status = 'reversal' AND reverses_payment_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX ap_payments_one_reversal_key ON bar_local.ap_payments (reverses_payment_id) WHERE reverses_payment_id IS NOT NULL;
CREATE INDEX ap_payments_invoice_idx ON bar_local.ap_payments (ap_invoice_id, created_at);
CREATE INDEX ap_payments_journal_idx ON bar_local.ap_payments (journal_entry_id);

CREATE TABLE bar_local.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  institution text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  account_code text NOT NULL REFERENCES bar_local.accounting_accounts(code),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  updated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  operation_id uuid NOT NULL UNIQUE,
  updated_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bank_accounts_business_name_key ON bar_local.bank_accounts (business_id, outlet_id, lower(name));

CREATE TABLE bar_local.bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES bar_local.bank_accounts(id),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  statement_date date NOT NULL,
  external_ref text NOT NULL CHECK (length(btrim(external_ref)) BETWEEN 1 AND 120),
  description text,
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  import_operation_id uuid NOT NULL,
  imported_by uuid NOT NULL REFERENCES bar_local.staff(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, statement_date, external_ref)
);
CREATE INDEX bank_statement_lines_account_date_idx ON bar_local.bank_statement_lines (bank_account_id, statement_date, external_ref);

CREATE TABLE bar_local.bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  bank_account_id uuid NOT NULL REFERENCES bar_local.bank_accounts(id),
  statement_line_id uuid NOT NULL UNIQUE REFERENCES bar_local.bank_statement_lines(id),
  journal_entry_id uuid UNIQUE REFERENCES bar_local.journal_entries(id),
  ap_payment_id uuid UNIQUE REFERENCES bar_local.ap_payments(id),
  evidence_type text NOT NULL CHECK (evidence_type IN ('journal', 'ap_payment')),
  reconciled_on date NOT NULL,
  note text,
  reconciled_by uuid NOT NULL REFERENCES bar_local.staff(id),
  operation_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (journal_entry_id IS NOT NULL OR ap_payment_id IS NOT NULL)
);

CREATE TABLE bar_local.tax_return_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  period text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  period_start date NOT NULL,
  period_end date NOT NULL,
  output_tax numeric(14,2) NOT NULL DEFAULT 0,
  input_tax numeric(14,2) NOT NULL DEFAULT 0,
  net_due numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft')),
  statutory_submission text NOT NULL DEFAULT 'external_required' CHECK (statutory_submission = 'external_required'),
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  generated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  operation_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, outlet_id, period),
  CHECK (period_end >= period_start)
);

CREATE TABLE bar_local.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  pay_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'prepared', 'finalised')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  gross_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (gross_total >= 0),
  deductions_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (deductions_total >= 0),
  net_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (net_total >= 0),
  expense_account_code text NOT NULL REFERENCES bar_local.accounting_accounts(code),
  payable_account_code text NOT NULL REFERENCES bar_local.accounting_accounts(code),
  deductions_account_code text REFERENCES bar_local.accounting_accounts(code),
  snapshot_hash text CHECK (snapshot_hash IS NULL OR snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  prepared_by uuid REFERENCES bar_local.staff(id),
  prepared_at timestamptz,
  finalised_by uuid REFERENCES bar_local.staff(id),
  finalised_at timestamptz,
  journal_entry_id uuid REFERENCES bar_local.journal_entries(id),
  payment_status text NOT NULL DEFAULT 'external_required' CHECK (payment_status = 'external_required'),
  filing_status text NOT NULL DEFAULT 'external_required' CHECK (filing_status = 'external_required'),
  operation_id uuid NOT NULL UNIQUE,
  updated_operation_id uuid,
  finalise_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (pay_date >= period_end),
  CHECK (net_total = gross_total - deductions_total)
);

CREATE TABLE bar_local.payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES bar_local.payroll_runs(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  employee_ref text NOT NULL CHECK (length(btrim(employee_ref)) BETWEEN 1 AND 64),
  gross numeric(14,2) NOT NULL CHECK (gross >= 0),
  deductions numeric(14,2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  net numeric(14,2) NOT NULL CHECK (net >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payroll_run_id, line_number),
  UNIQUE (payroll_run_id, employee_ref),
  CHECK (deductions <= gross),
  CHECK (net = gross - deductions)
);

CREATE TABLE bar_local.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  period_start date NOT NULL,
  period_end date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  updated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  operation_id uuid NOT NULL UNIQUE,
  updated_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
CREATE UNIQUE INDEX budgets_business_name_key ON bar_local.budgets (business_id, outlet_id, lower(name), period_start);

CREATE TABLE bar_local.budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES bar_local.budgets(id),
  budget_version integer NOT NULL CHECK (budget_version >= 1),
  line_number integer NOT NULL CHECK (line_number > 0),
  account_code text NOT NULL REFERENCES bar_local.accounting_accounts(code),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, budget_version, line_number),
  UNIQUE (budget_id, budget_version, account_code)
);
CREATE INDEX budget_lines_budget_idx ON bar_local.budget_lines (budget_id, budget_version);

CREATE OR REPLACE FUNCTION bar_local.assert_period_open(p_date date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_period text;
BEGIN
  IF p_date IS NULL THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A posting date is required.');
  END IF;
  v_period := to_char(p_date, 'YYYY-MM');
  IF EXISTS (SELECT 1 FROM bar_local.accounting_periods WHERE period = v_period AND status = 'closed') THEN
    PERFORM bar_local.raise_business('PERIOD_LOCKED', 'The accounting period ' || v_period || ' is closed.');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_ap_invoice_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_invoice_id uuid := NULLIF(v_payload->>'invoice_id', '')::uuid;
  v_existing bar_local.ap_invoices%ROWTYPE;
  v_supplier bar_local.suppliers%ROWTYPE;
  v_line jsonb;
  v_line_no integer := 0;
  v_quantity numeric(18,6);
  v_unit_price numeric(14,2);
  v_rate numeric(7,4);
  v_line_subtotal numeric(14,2);
  v_line_tax numeric(14,2);
  v_line_total numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_total numeric(14,2);
  v_number text := trim(v_payload->>'invoice_number');
  v_date date := NULLIF(v_payload->>'invoice_date', '')::date;
  v_due date := NULLIF(v_payload->>'due_date', '')::date;
  v_po uuid := NULLIF(v_payload->>'purchase_order_id', '')::uuid;
  v_payable bar_local.accounting_accounts%ROWTYPE;
  v_tax_account bar_local.accounting_accounts%ROWTYPE;
  v_account bar_local.accounting_accounts%ROWTYPE;
  v_before jsonb;
  v_updated boolean := false;
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
    IF v_number IS NULL OR length(v_number) < 1 OR length(v_number) > 80 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'An invoice number of 1-80 characters is required.');
    END IF;
    IF v_date IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'An invoice date is required.');
    END IF;
    PERFORM bar_local.assert_period_open(v_date);
    IF v_due IS NOT NULL AND v_due < v_date THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The due date cannot precede the invoice date.');
    END IF;
    SELECT * INTO v_supplier FROM bar_local.suppliers
     WHERE id = NULLIF(v_payload->>'supplier_id', '')::uuid AND business_id = v_ctx.business_id;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SUPPLIER_NOT_FOUND', 'The supplier could not be found in this business.');
    END IF;
    IF NOT v_supplier.active THEN
      PERFORM bar_local.raise_business('SUPPLIER_INACTIVE', 'Invoices cannot be recorded against an inactive supplier.');
    END IF;
    IF v_po IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM bar_local.purchase_orders
       WHERE id = v_po AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
         AND supplier_id = v_supplier.id
    ) THEN
      PERFORM bar_local.raise_business('PURCHASE_ORDER_NOT_FOUND', 'The purchase order does not belong to this supplier and outlet.');
    END IF;
    SELECT * INTO v_payable FROM bar_local.accounting_accounts
     WHERE code = v_payload->>'payable_account_code' AND active;
    IF NOT FOUND OR v_payable.type <> 'liability' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The payable account must be an active liability account.');
    END IF;
    IF NULLIF(v_payload->>'tax_account_code', '') IS NOT NULL THEN
      SELECT * INTO v_tax_account FROM bar_local.accounting_accounts
       WHERE code = v_payload->>'tax_account_code' AND active;
      IF NOT FOUND OR v_tax_account.type NOT IN ('asset', 'liability') THEN
        PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The tax account must be an active asset or liability account.');
      END IF;
    END IF;
    IF COALESCE(jsonb_typeof(v_payload->'lines'), '') <> 'array' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Invoice lines must be an array.');
    END IF;
    IF jsonb_array_length(v_payload->'lines') = 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'At least one invoice line is required.');
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_payload->'lines')
    LOOP
      v_line_no := v_line_no + 1;
      v_quantity := NULLIF(v_line->>'quantity', '')::numeric;
      v_unit_price := NULLIF(v_line->>'unit_price', '')::numeric;
      v_rate := COALESCE(NULLIF(v_line->>'tax_rate', '')::numeric, 0);
      IF NULLIF(btrim(v_line->>'description'), '') IS NULL OR length(btrim(v_line->>'description')) > 240 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Each invoice line needs a description of 1-240 characters.');
      END IF;
      IF v_quantity IS NULL OR v_quantity <= 0 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Each invoice line needs a positive quantity.');
      END IF;
      IF v_unit_price IS NULL OR v_unit_price < 0 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Each invoice line needs a non-negative unit price.');
      END IF;
      IF v_rate < 0 OR v_rate > 1 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Each invoice line tax rate must be between 0 and 1.');
      END IF;
      SELECT * INTO v_account FROM bar_local.accounting_accounts
       WHERE code = v_line->>'expense_account_code' AND active;
      IF NOT FOUND OR v_account.type NOT IN ('expense', 'asset') THEN
        PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'Each invoice line must use an active expense or asset account.');
      END IF;
      v_line_subtotal := round(v_quantity * v_unit_price, 2);
      v_line_tax := round(v_line_subtotal * v_rate, 2);
      v_subtotal := v_subtotal + v_line_subtotal;
      v_tax := v_tax + v_line_tax;
    END LOOP;
    v_total := v_subtotal + v_tax;
    IF COALESCE(NULLIF(v_payload->>'subtotal', '')::numeric, -1) <> v_subtotal
       OR COALESCE(NULLIF(v_payload->>'tax_total', '')::numeric, -1) <> v_tax
       OR COALESCE(NULLIF(v_payload->>'total', '')::numeric, -1) <> v_total THEN
      PERFORM bar_local.raise_business('AP_AMOUNT_MISMATCH', 'The invoice totals do not match the exact line subtotals and tax.');
    END IF;
    IF v_tax > 0 AND v_tax_account.code IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A tax account is required when an invoice carries tax.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM bar_local.ap_invoices
       WHERE business_id = v_ctx.business_id AND supplier_id = v_supplier.id
         AND lower(invoice_number) = lower(v_number)
         AND (v_invoice_id IS NULL OR id <> v_invoice_id)
    ) THEN
      PERFORM bar_local.raise_business('DUPLICATE_INVOICE', 'An invoice with this supplier and invoice number already exists.');
    END IF;
    IF v_invoice_id IS NULL THEN
      IF NULLIF(v_payload->>'expected_version', '') IS NOT NULL THEN
        PERFORM bar_local.raise_business('AP_INVOICE_VERSION_CONFLICT', 'No invoice exists for the expected version.');
      END IF;
      INSERT INTO bar_local.ap_invoices
        (business_id, outlet_id, supplier_id, invoice_number, invoice_date, due_date, purchase_order_id,
         subtotal, tax_total, total, payable_account_code, tax_account_code, created_by, operation_id)
      VALUES
        (v_ctx.business_id, v_ctx.outlet_id, v_supplier.id, v_number, v_date, v_due, v_po,
         v_subtotal, v_tax, v_total, v_payable.code, v_tax_account.code, v_ctx.staff_id,
         (p_envelope->>'operation_id')::uuid)
      RETURNING id INTO v_invoice_id;
      v_before := NULL;
    ELSE
      SELECT * INTO v_existing FROM bar_local.ap_invoices
       WHERE id = v_invoice_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
       FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('AP_INVOICE_NOT_FOUND', 'The invoice could not be found in this outlet.');
      END IF;
      IF v_existing.status <> 'draft' THEN
        PERFORM bar_local.raise_business('AP_INVOICE_STATE_CONFLICT', 'Only a draft invoice can be changed.');
      END IF;
      IF NULLIF(v_payload->>'expected_version', '') IS NULL
         OR v_existing.version <> (v_payload->>'expected_version')::integer THEN
        PERFORM bar_local.raise_business('AP_INVOICE_VERSION_CONFLICT', 'The invoice changed since it was loaded. Refresh and try again.');
      END IF;
      v_before := to_jsonb(v_existing);
      UPDATE bar_local.ap_invoices
         SET supplier_id = v_supplier.id, invoice_number = v_number, invoice_date = v_date, due_date = v_due,
             purchase_order_id = v_po, subtotal = v_subtotal, tax_total = v_tax, total = v_total,
             payable_account_code = v_payable.code, tax_account_code = v_tax_account.code,
             version = version + 1, updated_operation_id = (p_envelope->>'operation_id')::uuid, updated_at = now()
       WHERE id = v_invoice_id;
      DELETE FROM bar_local.ap_invoice_lines WHERE ap_invoice_id = v_invoice_id;
      v_updated := true;
    END IF;
    v_line_no := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_payload->'lines')
    LOOP
      v_line_no := v_line_no + 1;
      v_quantity := (v_line->>'quantity')::numeric;
      v_unit_price := (v_line->>'unit_price')::numeric;
      v_rate := COALESCE(NULLIF(v_line->>'tax_rate', '')::numeric, 0);
      v_line_subtotal := round(v_quantity * v_unit_price, 2);
      v_line_tax := round(v_line_subtotal * v_rate, 2);
      v_line_total := v_line_subtotal + v_line_tax;
      INSERT INTO bar_local.ap_invoice_lines
        (ap_invoice_id, line_number, description, expense_account_code, quantity, unit_price, tax_rate,
         line_subtotal, line_tax, line_total)
      VALUES
        (v_invoice_id, v_line_no, v_line->>'description', v_line->>'expense_account_code', v_quantity,
         v_unit_price, v_rate, v_line_subtotal, v_line_tax, v_line_total);
    END LOOP;
    SELECT to_jsonb(i.*) INTO v_result FROM bar_local.ap_invoices i WHERE i.id = v_invoice_id;
    v_result := v_result || jsonb_build_object('line_count', v_line_no);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      CASE WHEN v_updated THEN 'accounting.ap.invoice.updated' ELSE 'accounting.ap.invoice.created' END,
      (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object(
        'event_type', CASE WHEN v_updated THEN 'accounting.ap.invoice.updated' ELSE 'accounting.ap.invoice.created' END,
        'payload', v_result)),
      v_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'The invoice conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_ap_invoice_approve(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_invoice bar_local.ap_invoices%ROWTYPE;
  v_approval_id uuid;
  v_approver_id uuid;
  v_line bar_local.ap_invoice_lines%ROWTYPE;
  v_account bar_local.accounting_accounts%ROWTYPE;
  v_subtotal numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_entry_id uuid;
  v_before jsonb;
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
    SELECT * INTO v_invoice FROM bar_local.ap_invoices
     WHERE id = (v_payload->>'invoice_id')::uuid
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('AP_INVOICE_NOT_FOUND', 'The invoice could not be found in this outlet.');
    END IF;
    IF v_invoice.status <> 'draft' THEN
      PERFORM bar_local.raise_business('AP_INVOICE_STATE_CONFLICT', 'Only a draft invoice can be approved.');
    END IF;
    v_approval_id := bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'accounting.approve',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    SELECT approved_by INTO v_approver_id FROM bar_local.approvals WHERE id = v_approval_id;
    IF v_invoice.created_by = v_approver_id THEN
      PERFORM bar_local.raise_business('MAKER_CHECKER_VIOLATION', 'The invoice creator cannot approve the same invoice.');
    END IF;
    PERFORM bar_local.assert_period_open(v_invoice.invoice_date);
    SELECT COALESCE(sum(line_subtotal), 0), COALESCE(sum(line_tax), 0)
      INTO v_subtotal, v_tax
      FROM bar_local.ap_invoice_lines WHERE ap_invoice_id = v_invoice.id;
    IF v_subtotal <> v_invoice.subtotal OR v_tax <> v_invoice.tax_total THEN
      PERFORM bar_local.raise_business('AP_AMOUNT_MISMATCH', 'The invoice lines no longer match the invoice totals.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM bar_local.ap_invoice_lines WHERE ap_invoice_id = v_invoice.id) THEN
      PERFORM bar_local.raise_business('AP_INVOICE_LINES_MISSING', 'The invoice has no lines to approve.');
    END IF;
    SELECT * INTO v_account FROM bar_local.accounting_accounts
     WHERE code = v_invoice.payable_account_code AND active;
    IF NOT FOUND OR v_account.type <> 'liability' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The invoice payable account is not an active liability account.');
    END IF;
    IF v_invoice.tax_total > 0 THEN
      SELECT * INTO v_account FROM bar_local.accounting_accounts
       WHERE code = v_invoice.tax_account_code AND active;
      IF NOT FOUND OR v_account.type NOT IN ('asset', 'liability') THEN
        PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The invoice tax account is not an active asset or liability account.');
      END IF;
    END IF;
    v_before := to_jsonb(v_invoice);
    INSERT INTO bar_local.journal_entries
      (business_id, entry_date, period, memo, source_type, source_id, operation_id)
    VALUES
      (v_ctx.business_id, v_invoice.invoice_date, to_char(v_invoice.invoice_date, 'YYYY-MM'),
       'Approved supplier invoice ' || v_invoice.invoice_number, 'ap_invoice', v_invoice.id,
       (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_entry_id;
    FOR v_line IN SELECT * FROM bar_local.ap_invoice_lines WHERE ap_invoice_id = v_invoice.id ORDER BY line_number
    LOOP
      SELECT * INTO v_account FROM bar_local.accounting_accounts
       WHERE code = v_line.expense_account_code AND active;
      IF NOT FOUND OR v_account.type NOT IN ('expense', 'asset') THEN
        PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'An invoice line account is no longer an active expense or asset account.');
      END IF;
      INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
      VALUES (v_entry_id, v_line.expense_account_code, v_line.line_subtotal, 0, v_line.description);
    END LOOP;
    IF v_invoice.tax_total > 0 THEN
      INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
      VALUES (v_entry_id, v_invoice.tax_account_code, v_invoice.tax_total, 0, 'Supplier invoice tax');
    END IF;
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES (v_entry_id, v_invoice.payable_account_code, 0, v_invoice.total, 'Supplier invoice payable');
    UPDATE bar_local.ap_invoices
       SET status = 'approved', approved_by = v_approver_id, approved_at = now(),
           approval_operation_id = (p_envelope->>'operation_id')::uuid, journal_entry_id = v_entry_id,
           version = version + 1, updated_at = now()
     WHERE id = v_invoice.id;
    v_result := jsonb_build_object(
      'invoice_id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'status', 'approved',
      'subtotal', v_invoice.subtotal,
      'tax_total', v_invoice.tax_total,
      'total', v_invoice.total,
      'journal_entry_id', v_entry_id,
      'version', v_invoice.version + 1
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.ap.invoice.approved', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'accounting.ap.invoice.approved', 'payload', v_result)),
      v_invoice.invoice_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'The invoice approval conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_ap_payment_post(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_invoice bar_local.ap_invoices%ROWTYPE;
  v_account bar_local.accounting_accounts%ROWTYPE;
  v_amount numeric(14,2) := round(COALESCE(NULLIF(v_payload->>'amount', '')::numeric, 0), 2);
  v_payment_date date := NULLIF(v_payload->>'payment_date', '')::date;
  v_paid numeric(14,2) := 0;
  v_reversed numeric(14,2) := 0;
  v_outstanding numeric(14,2);
  v_payment_id uuid;
  v_entry_id uuid;
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
    IF v_payment_date IS NULL OR v_amount <= 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A payment date and positive amount are required.');
    END IF;
    PERFORM bar_local.assert_period_open(v_payment_date);
    SELECT * INTO v_invoice FROM bar_local.ap_invoices
     WHERE id = (v_payload->>'invoice_id')::uuid
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('AP_INVOICE_NOT_FOUND', 'The invoice could not be found in this outlet.');
    END IF;
    IF v_invoice.status <> 'approved' THEN
      PERFORM bar_local.raise_business('AP_INVOICE_STATE_CONFLICT', 'Approve the invoice before recording a payment.');
    END IF;
    SELECT COALESCE(sum(amount), 0) INTO v_paid FROM bar_local.ap_payments
     WHERE ap_invoice_id = v_invoice.id AND status = 'posted';
    SELECT COALESCE(sum(amount), 0) INTO v_reversed FROM bar_local.ap_payments
     WHERE ap_invoice_id = v_invoice.id AND status = 'reversal';
    v_outstanding := v_invoice.total - v_paid + v_reversed;
    IF v_amount > v_outstanding THEN
      PERFORM bar_local.raise_business('PAYMENT_EXCEEDS_OUTSTANDING', 'The payment exceeds the invoice outstanding balance.');
    END IF;
    SELECT * INTO v_account FROM bar_local.accounting_accounts
     WHERE code = v_payload->>'payment_account_code' AND active;
    IF NOT FOUND OR v_account.type <> 'asset' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The payment account must be an active asset account.');
    END IF;
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'accounting.approve',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    INSERT INTO bar_local.journal_entries
      (business_id, entry_date, period, memo, source_type, source_id, operation_id)
    VALUES
      (v_ctx.business_id, v_payment_date, to_char(v_payment_date, 'YYYY-MM'),
       'Supplier payment ' || v_invoice.invoice_number, 'ap_payment', v_invoice.id,
       (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_entry_id;
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES
      (v_entry_id, v_invoice.payable_account_code, v_amount, 0, 'Supplier invoice payment'),
      (v_entry_id, v_account.code, 0, v_amount, 'Supplier payment');
    INSERT INTO bar_local.ap_payments
      (business_id, outlet_id, ap_invoice_id, payment_date, amount, method, payment_account_code,
       reference, status, journal_entry_id, created_by, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_invoice.id, v_payment_date, v_amount,
       COALESCE(NULLIF(v_payload->>'method', ''), 'bank'), v_account.code, NULLIF(v_payload->>'reference', ''),
       'posted', v_entry_id, v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_payment_id;
    v_result := jsonb_build_object(
      'payment_id', v_payment_id,
      'invoice_id', v_invoice.id,
      'amount', v_amount,
      'status', 'posted',
      'journal_entry_id', v_entry_id,
      'outstanding', v_outstanding - v_amount
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.ap.payment.posted', (p_envelope->>'operation_id')::uuid,
      jsonb_build_object('outstanding', v_outstanding), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'accounting.ap.payment.posted', 'payload', v_result)),
      v_payment_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'The payment conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_ap_payment_reverse(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_payment bar_local.ap_payments%ROWTYPE;
  v_invoice bar_local.ap_invoices%ROWTYPE;
  v_account bar_local.accounting_accounts%ROWTYPE;
  v_reversal_date date := COALESCE(NULLIF(v_payload->>'reversal_date', '')::date, bar_local.current_business_date());
  v_paid numeric(14,2) := 0;
  v_reversed numeric(14,2) := 0;
  v_reversal_id uuid;
  v_entry_id uuid;
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
    PERFORM bar_local.assert_period_open(v_reversal_date);
    SELECT * INTO v_payment FROM bar_local.ap_payments
     WHERE id = (v_payload->>'payment_id')::uuid
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('AP_PAYMENT_NOT_FOUND', 'The supplier payment could not be found in this outlet.');
    END IF;
    IF v_payment.status <> 'posted' THEN
      PERFORM bar_local.raise_business('AP_PAYMENT_STATE_CONFLICT', 'Only a posted supplier payment can be reversed.');
    END IF;
    IF EXISTS (SELECT 1 FROM bar_local.ap_payments WHERE reverses_payment_id = v_payment.id) THEN
      PERFORM bar_local.raise_business('AP_PAYMENT_ALREADY_REVERSED', 'This supplier payment has already been reversed.');
    END IF;
    SELECT * INTO v_invoice FROM bar_local.ap_invoices WHERE id = v_payment.ap_invoice_id FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('AP_INVOICE_NOT_FOUND', 'The invoice for this payment no longer exists.');
    END IF;
    SELECT * INTO v_account FROM bar_local.accounting_accounts
     WHERE code = v_payment.payment_account_code AND active;
    IF NOT FOUND OR v_account.type <> 'asset' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The payment account is not an active asset account.');
    END IF;
    SELECT * INTO v_account FROM bar_local.accounting_accounts
     WHERE code = v_invoice.payable_account_code AND active;
    IF NOT FOUND OR v_account.type <> 'liability' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The invoice payable account is not an active liability account.');
    END IF;
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'accounting.approve',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    INSERT INTO bar_local.journal_entries
      (business_id, entry_date, period, memo, source_type, source_id, operation_id)
    VALUES
      (v_ctx.business_id, v_reversal_date, to_char(v_reversal_date, 'YYYY-MM'),
       'Reverse supplier payment ' || v_payment.id, 'ap_payment.reversal', v_payment.id,
       (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_entry_id;
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES
      (v_entry_id, v_payment.payment_account_code, v_payment.amount, 0, 'Reverse supplier payment'),
      (v_entry_id, v_invoice.payable_account_code, 0, v_payment.amount, COALESCE(v_payload->>'reason', 'Supplier payment reversal'));
    INSERT INTO bar_local.ap_payments
      (business_id, outlet_id, ap_invoice_id, payment_date, amount, method, payment_account_code,
       reference, status, reverses_payment_id, journal_entry_id, created_by, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_invoice.id, v_reversal_date, v_payment.amount, v_payment.method,
       v_payment.payment_account_code, COALESCE(v_payload->>'reason', 'Reversal'), 'reversal', v_payment.id,
       v_entry_id, v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_reversal_id;
    SELECT COALESCE(sum(amount), 0) INTO v_paid FROM bar_local.ap_payments
     WHERE ap_invoice_id = v_invoice.id AND status = 'posted';
    SELECT COALESCE(sum(amount), 0) INTO v_reversed FROM bar_local.ap_payments
     WHERE ap_invoice_id = v_invoice.id AND status = 'reversal';
    v_result := jsonb_build_object(
      'reversal_payment_id', v_reversal_id,
      'payment_id', v_payment.id,
      'invoice_id', v_invoice.id,
      'amount', v_payment.amount,
      'status', 'reversal',
      'journal_entry_id', v_entry_id,
      'outstanding', v_invoice.total - v_paid + v_reversed
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.ap.payment.reversed', (p_envelope->>'operation_id')::uuid, to_jsonb(v_payment), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'accounting.ap.payment.reversed', 'payload', v_result)),
      v_reversal_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'The supplier payment reversal conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_bank_account_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_account_id uuid := NULLIF(v_payload->>'bank_account_id', '')::uuid;
  v_existing bar_local.bank_accounts%ROWTYPE;
  v_ledger bar_local.accounting_accounts%ROWTYPE;
  v_name text := trim(v_payload->>'name');
  v_before jsonb;
  v_updated boolean := false;
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
    IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 120 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A bank account name of 1-120 characters is required.');
    END IF;
    SELECT * INTO v_ledger FROM bar_local.accounting_accounts
     WHERE code = v_payload->>'account_code' AND active;
    IF NOT FOUND OR v_ledger.type <> 'asset' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The linked ledger account must be an active asset account.');
    END IF;
    IF v_account_id IS NULL THEN
      IF NULLIF(v_payload->>'expected_version', '') IS NOT NULL THEN
        PERFORM bar_local.raise_business('BANK_ACCOUNT_VERSION_CONFLICT', 'No bank account exists for the expected version.');
      END IF;
      INSERT INTO bar_local.bank_accounts
        (business_id, outlet_id, name, institution, account_number, account_code, active, created_by, updated_by, operation_id)
      VALUES
        (v_ctx.business_id, v_ctx.outlet_id, v_name, COALESCE(v_payload->>'institution', ''),
         COALESCE(v_payload->>'account_number', ''), v_ledger.code,
         COALESCE((v_payload->>'active')::boolean, true), v_ctx.staff_id, v_ctx.staff_id,
         (p_envelope->>'operation_id')::uuid)
      RETURNING id INTO v_account_id;
      v_before := NULL;
    ELSE
      SELECT * INTO v_existing FROM bar_local.bank_accounts
       WHERE id = v_account_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
       FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('BANK_ACCOUNT_NOT_FOUND', 'The bank account could not be found in this outlet.');
      END IF;
      IF NULLIF(v_payload->>'expected_version', '') IS NULL
         OR v_existing.version <> (v_payload->>'expected_version')::integer THEN
        PERFORM bar_local.raise_business('BANK_ACCOUNT_VERSION_CONFLICT', 'The bank account changed since it was loaded. Refresh and try again.');
      END IF;
      v_before := to_jsonb(v_existing);
      UPDATE bar_local.bank_accounts
         SET name = v_name, institution = COALESCE(v_payload->>'institution', institution),
             account_number = COALESCE(v_payload->>'account_number', account_number),
             account_code = v_ledger.code, active = COALESCE((v_payload->>'active')::boolean, active),
             version = version + 1, updated_by = v_ctx.staff_id,
             updated_operation_id = (p_envelope->>'operation_id')::uuid, updated_at = now()
       WHERE id = v_account_id;
      v_updated := true;
    END IF;
    SELECT to_jsonb(a.*) INTO v_result FROM bar_local.bank_accounts a WHERE a.id = v_account_id;
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      CASE WHEN v_updated THEN 'accounting.bank.account.updated' ELSE 'accounting.bank.account.created' END,
      (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object(
        'event_type', CASE WHEN v_updated THEN 'accounting.bank.account.updated' ELSE 'accounting.bank.account.created' END,
        'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'A bank account with this name already exists in this outlet.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_bank_statement_import(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_account bar_local.bank_accounts%ROWTYPE;
  v_line jsonb;
  v_existing bar_local.bank_statement_lines%ROWTYPE;
  v_amount numeric(14,2);
  v_date date;
  v_ref text;
  v_description text;
  v_imported integer := 0;
  v_skipped integer := 0;
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
    SELECT * INTO v_account FROM bar_local.bank_accounts
     WHERE id = (v_payload->>'bank_account_id')::uuid
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('BANK_ACCOUNT_NOT_FOUND', 'The bank account could not be found in this outlet.');
    END IF;
    IF NOT v_account.active THEN
      PERFORM bar_local.raise_business('BANK_ACCOUNT_INACTIVE', 'Statement lines cannot be imported into an inactive bank account.');
    END IF;
    IF COALESCE(jsonb_typeof(v_payload->'lines'), '') <> 'array' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Statement lines must be an array.');
    END IF;
    IF jsonb_array_length(v_payload->'lines') = 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'At least one statement line is required.');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('bank_statement:' || v_account.id::text, 0));
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_payload->'lines')
    LOOP
      v_ref := trim(v_line->>'external_ref');
      v_date := NULLIF(v_line->>'statement_date', '')::date;
      v_amount := round(NULLIF(v_line->>'amount', '')::numeric, 2);
      v_description := NULLIF(v_line->>'description', '');
      IF v_ref IS NULL OR length(v_ref) < 1 OR length(v_ref) > 120 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Each statement line needs an external reference of 1-120 characters.');
      END IF;
      IF v_date IS NULL THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Each statement line needs a statement date.');
      END IF;
      IF v_amount IS NULL OR v_amount = 0 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Each statement line needs a non-zero amount.');
      END IF;
      SELECT * INTO v_existing FROM bar_local.bank_statement_lines
       WHERE bank_account_id = v_account.id AND statement_date = v_date AND external_ref = v_ref
       FOR UPDATE;
      IF FOUND THEN
        IF v_existing.amount = v_amount AND COALESCE(v_existing.description, '') = COALESCE(v_description, '') THEN
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;
        PERFORM bar_local.raise_business('BANK_STATEMENT_CONFLICT', 'A statement line with this reference and date already exists with different content. Import was not applied.');
      END IF;
      INSERT INTO bar_local.bank_statement_lines
        (bank_account_id, business_id, outlet_id, statement_date, external_ref, description, amount,
         import_operation_id, imported_by)
      VALUES
        (v_account.id, v_ctx.business_id, v_ctx.outlet_id, v_date, v_ref, v_description, v_amount,
         (p_envelope->>'operation_id')::uuid, v_ctx.staff_id);
      v_imported := v_imported + 1;
    END LOOP;
    v_result := jsonb_build_object(
      'bank_account_id', v_account.id,
      'imported', v_imported,
      'skipped', v_skipped,
      'line_count', v_imported + v_skipped
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.bank.statement.imported', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'accounting.bank.statement.imported', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'BANK_STATEMENT_CONFLICT';
      v_message := 'A statement line with this reference and date already exists. Import was not applied.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

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
      PERFORM bar_local.raise_business('BANK_ACCOUNT_NOT_FOUND', 'The statement line bank account could not be found.');
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
    SELECT * INTO v_entry FROM bar_local.journal_entries
     WHERE id = v_journal_id AND business_id = v_ctx.business_id;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('JOURNAL_NOT_FOUND', 'The reconciliation journal entry could not be found.');
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

CREATE OR REPLACE FUNCTION bar_local.cmd_tax_code_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_code text := upper(trim(v_payload->>'code'));
  v_name text := trim(v_payload->>'name');
  v_rate numeric(7,4) := NULLIF(v_payload->>'rate', '')::numeric;
  v_current integer := 0;
  v_version integer;
  v_id uuid;
  v_before jsonb;
  v_result jsonb;
  v_code_error text;
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
    IF v_code IS NULL OR v_code !~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A tax code must be 1-32 letters, digits, dots, underscores or hyphens.');
    END IF;
    IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 160 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A tax code name of 1-160 characters is required.');
    END IF;
    IF v_rate IS NULL OR v_rate < 0 OR v_rate > 1 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A tax rate between 0 and 1 is required.');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('tax_code:' || v_ctx.business_id::text || ':' || v_code, 0));
    SELECT COALESCE(max(version), 0) INTO v_current FROM bar_local.tax_codes
     WHERE business_id = v_ctx.business_id AND code = v_code;
    IF v_current = 0 THEN
      IF NULLIF(v_payload->>'expected_version', '') IS NOT NULL THEN
        PERFORM bar_local.raise_business('TAX_CODE_VERSION_CONFLICT', 'No tax code exists for the expected version.');
      END IF;
      v_version := 1;
    ELSE
      IF NULLIF(v_payload->>'expected_version', '') IS NULL THEN
        PERFORM bar_local.raise_business('DUPLICATE_RECORD', 'This tax code already exists. Supply its expected version to create a new version.');
      END IF;
      IF v_current <> (v_payload->>'expected_version')::integer THEN
        PERFORM bar_local.raise_business('TAX_CODE_VERSION_CONFLICT', 'The tax code changed since it was loaded. Refresh and try again.');
      END IF;
      SELECT to_jsonb(tc.*) INTO v_before FROM bar_local.tax_codes tc
       WHERE tc.business_id = v_ctx.business_id AND tc.code = v_code AND tc.version = v_current;
      v_version := v_current + 1;
    END IF;
    INSERT INTO bar_local.tax_codes
      (business_id, code, name, rate, active, version, created_by, operation_id)
    VALUES
      (v_ctx.business_id, v_code, v_name, v_rate, COALESCE((v_payload->>'active')::boolean, true),
       v_version, v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_id;
    v_result := jsonb_build_object(
      'tax_code_id', v_id,
      'code', v_code,
      'name', v_name,
      'rate', v_rate,
      'active', COALESCE((v_payload->>'active')::boolean, true),
      'version', v_version
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      CASE WHEN v_current = 0 THEN 'accounting.tax.code.created' ELSE 'accounting.tax.code.versioned' END,
      (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object(
        'event_type', CASE WHEN v_current = 0 THEN 'accounting.tax.code.created' ELSE 'accounting.tax.code.versioned' END,
        'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code_error := 'DUPLICATE_RECORD';
      v_message := 'This tax code version conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code_error, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code_error = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code_error, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_tax_return_prepare(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_period text := trim(v_payload->>'period');
  v_start date;
  v_end date;
  v_output numeric(14,2) := 0;
  v_input numeric(14,2) := 0;
  v_sales_count integer := 0;
  v_invoice_count integer := 0;
  v_period_status text;
  v_tax_codes jsonb;
  v_snapshot jsonb;
  v_hash text;
  v_existing bar_local.tax_return_periods%ROWTYPE;
  v_before jsonb;
  v_return_id uuid;
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
    IF v_period IS NULL OR v_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A tax return period is required in YYYY-MM form.');
    END IF;
    v_start := (v_period || '-01')::date;
    v_end := (date_trunc('month', v_start) + interval '1 month - 1 day')::date;
    PERFORM pg_advisory_xact_lock(hashtextextended('tax_return:' || v_ctx.business_id::text || ':' || v_ctx.outlet_id::text || ':' || v_period, 0));
    SELECT COALESCE(sum(sl.line_tax), 0), count(DISTINCT s.id)
      INTO v_output, v_sales_count
      FROM bar_local.sales s
      JOIN bar_local.sale_lines sl ON sl.sale_id = s.id
     WHERE s.business_id = v_ctx.business_id AND s.outlet_id = v_ctx.outlet_id
       AND s.business_date BETWEEN v_start AND v_end
       AND s.status IN ('completed', 'returned');
    SELECT COALESCE(sum(ai.tax_total), 0), count(*)
      INTO v_input, v_invoice_count
      FROM bar_local.ap_invoices ai
     WHERE ai.business_id = v_ctx.business_id AND ai.outlet_id = v_ctx.outlet_id
       AND ai.invoice_date BETWEEN v_start AND v_end
       AND ai.status = 'approved';
    SELECT COALESCE(status, 'open') INTO v_period_status
      FROM bar_local.accounting_periods WHERE period = v_period;
    v_period_status := COALESCE(v_period_status, 'open');
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'code', tc.code, 'name', tc.name, 'rate', tc.rate, 'active', tc.active, 'version', tc.version
           ) ORDER BY tc.code), '[]'::jsonb)
      INTO v_tax_codes
      FROM bar_local.tax_codes tc
     WHERE tc.business_id = v_ctx.business_id
       AND tc.version = (
         SELECT max(tc2.version) FROM bar_local.tax_codes tc2
          WHERE tc2.business_id = tc.business_id AND tc2.code = tc.code
       );
    v_snapshot := jsonb_build_object(
      'calculation_version', 1,
      'period', v_period,
      'period_start', v_start,
      'period_end', v_end,
      'period_status', v_period_status,
      'output_tax', v_output,
      'input_tax', v_input,
      'net_due', v_output - v_input,
      'sales_count', v_sales_count,
      'ap_invoice_count', v_invoice_count,
      'tax_codes', v_tax_codes,
      'source_scope', 'local_ledgers',
      'completeness', jsonb_build_object(
        'sales_source_complete', true,
        'ap_invoice_source_complete', true,
        'missing_sources_fabricated', false
      ),
      'generated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    v_hash := bar_local.sha256_hex(bar_local.canonical_jsonb_text(v_snapshot));
    SELECT * INTO v_existing FROM bar_local.tax_return_periods
     WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND period = v_period
     FOR UPDATE;
    IF FOUND THEN
      v_before := to_jsonb(v_existing);
      UPDATE bar_local.tax_return_periods
         SET period_start = v_start, period_end = v_end, output_tax = v_output, input_tax = v_input,
             net_due = v_output - v_input, snapshot = v_snapshot, snapshot_hash = v_hash,
             revision = revision + 1, generated_by = v_ctx.staff_id, generated_at = now(),
             operation_id = (p_envelope->>'operation_id')::uuid, updated_at = now()
       WHERE id = v_existing.id
       RETURNING id INTO v_return_id;
    ELSE
      v_before := NULL;
      INSERT INTO bar_local.tax_return_periods
        (business_id, outlet_id, period, period_start, period_end, output_tax, input_tax, net_due,
         snapshot, snapshot_hash, generated_by, operation_id)
      VALUES
        (v_ctx.business_id, v_ctx.outlet_id, v_period, v_start, v_end, v_output, v_input, v_output - v_input,
         v_snapshot, v_hash, v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
      RETURNING id INTO v_return_id;
    END IF;
    v_result := jsonb_build_object(
      'tax_return_id', v_return_id,
      'period', v_period,
      'status', 'draft',
      'statutory_submission', 'external_required',
      'output_tax', v_output,
      'input_tax', v_input,
      'net_due', v_output - v_input,
      'snapshot_hash', v_hash,
      'snapshot', v_snapshot
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.tax.return.prepared', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'accounting.tax.return.prepared', 'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'The tax return draft conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_payroll_run_create(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_start date := NULLIF(v_payload->>'period_start', '')::date;
  v_end date := NULLIF(v_payload->>'period_end', '')::date;
  v_pay date := NULLIF(v_payload->>'pay_date', '')::date;
  v_month date;
  v_account bar_local.accounting_accounts%ROWTYPE;
  v_line jsonb;
  v_line_no integer := 0;
  v_gross numeric(14,2);
  v_deductions numeric(14,2);
  v_net numeric(14,2);
  v_gross_total numeric(14,2) := 0;
  v_deductions_total numeric(14,2) := 0;
  v_run_id uuid;
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
    IF v_start IS NULL OR v_end IS NULL OR v_pay IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Payroll period start, end and pay date are required.');
    END IF;
    IF v_end < v_start OR v_pay < v_end THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Payroll dates must run from period start to period end and then pay date.');
    END IF;
    v_month := date_trunc('month', v_start)::date;
    WHILE v_month <= date_trunc('month', v_pay)::date
    LOOP
      IF EXISTS (SELECT 1 FROM bar_local.accounting_periods WHERE period = to_char(v_month, 'YYYY-MM') AND status = 'closed') THEN
        PERFORM bar_local.raise_business('PERIOD_LOCKED', 'A payroll period is closed.');
      END IF;
      v_month := (v_month + interval '1 month')::date;
    END LOOP;
    SELECT * INTO v_account FROM bar_local.accounting_accounts
     WHERE code = v_payload->>'expense_account_code' AND active;
    IF NOT FOUND OR v_account.type <> 'expense' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The payroll expense account must be an active expense account.');
    END IF;
    SELECT * INTO v_account FROM bar_local.accounting_accounts
     WHERE code = v_payload->>'payable_account_code' AND active;
    IF NOT FOUND OR v_account.type <> 'liability' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The payroll payable account must be an active liability account.');
    END IF;
    IF NULLIF(v_payload->>'deductions_account_code', '') IS NOT NULL THEN
      SELECT * INTO v_account FROM bar_local.accounting_accounts
       WHERE code = v_payload->>'deductions_account_code' AND active;
      IF NOT FOUND OR v_account.type NOT IN ('asset', 'liability') THEN
        PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The payroll deductions account must be an active asset or liability account.');
      END IF;
    END IF;
    INSERT INTO bar_local.payroll_runs
      (business_id, outlet_id, period_start, period_end, pay_date, expense_account_code,
       payable_account_code, deductions_account_code, created_by, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_start, v_end, v_pay, v_payload->>'expense_account_code',
       v_payload->>'payable_account_code', NULLIF(v_payload->>'deductions_account_code', ''),
       v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_run_id;
    IF (v_payload ? 'lines') AND COALESCE(jsonb_typeof(v_payload->'lines'), '') <> 'array' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Payroll lines must be an array.');
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(v_payload->'lines', '[]'::jsonb))
    LOOP
      v_line_no := v_line_no + 1;
      v_gross := round(COALESCE(NULLIF(v_line->>'gross', '')::numeric, 0), 2);
      v_deductions := round(COALESCE(NULLIF(v_line->>'deductions', '')::numeric, 0), 2);
      IF trim(COALESCE(v_line->>'employee_ref', '')) = '' OR length(trim(v_line->>'employee_ref')) > 64 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Each payroll line needs an opaque employee reference of 1-64 characters.');
      END IF;
      IF v_gross < 0 OR v_deductions < 0 OR v_deductions > v_gross THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Payroll gross and deductions are invalid.');
      END IF;
      v_net := v_gross - v_deductions;
      INSERT INTO bar_local.payroll_lines
        (payroll_run_id, line_number, employee_ref, gross, deductions, net)
      VALUES
        (v_run_id, v_line_no, trim(v_line->>'employee_ref'), v_gross, v_deductions, v_net);
      v_gross_total := v_gross_total + v_gross;
      v_deductions_total := v_deductions_total + v_deductions;
    END LOOP;
    UPDATE bar_local.payroll_runs
       SET gross_total = v_gross_total, deductions_total = v_deductions_total,
           net_total = v_gross_total - v_deductions_total
     WHERE id = v_run_id;
    v_result := jsonb_build_object(
      'payroll_run_id', v_run_id,
      'status', 'draft',
      'line_count', v_line_no,
      'gross_total', v_gross_total,
      'deductions_total', v_deductions_total,
      'net_total', v_gross_total - v_deductions_total,
      'version', 1,
      'payment_status', 'external_required',
      'filing_status', 'external_required'
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.payroll.run.created', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'accounting.payroll.run.created', 'payload', v_result)),
      v_pay);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'A payroll line or run conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_payroll_run_prepare(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_run bar_local.payroll_runs%ROWTYPE;
  v_lines jsonb;
  v_line_count integer := 0;
  v_gross numeric(14,2) := 0;
  v_deductions numeric(14,2) := 0;
  v_snapshot jsonb;
  v_hash text;
  v_before jsonb;
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
    SELECT * INTO v_run FROM bar_local.payroll_runs
     WHERE id = (v_payload->>'payroll_run_id')::uuid
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('PAYROLL_RUN_NOT_FOUND', 'The payroll run could not be found in this outlet.');
    END IF;
    IF v_run.status <> 'draft' THEN
      PERFORM bar_local.raise_business('PAYROLL_RUN_STATE_CONFLICT', 'Only a draft payroll run can be prepared.');
    END IF;
    IF NULLIF(v_payload->>'expected_version', '') IS NULL
       OR v_run.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('PAYROLL_RUN_VERSION_CONFLICT', 'The payroll run changed since it was loaded. Refresh and try again.');
    END IF;
    SELECT count(*), COALESCE(sum(gross), 0), COALESCE(sum(deductions), 0)
      INTO v_line_count, v_gross, v_deductions
      FROM bar_local.payroll_lines WHERE payroll_run_id = v_run.id;
    IF v_line_count = 0 THEN
      PERFORM bar_local.raise_business('PAYROLL_EMPTY', 'A payroll run needs at least one employee line before it can be prepared.');
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'employee_ref', employee_ref, 'gross', gross, 'deductions', deductions, 'net', net
           ) ORDER BY employee_ref), '[]'::jsonb)
      INTO v_lines
      FROM bar_local.payroll_lines WHERE payroll_run_id = v_run.id;
    v_snapshot := jsonb_build_object(
      'calculation_version', 1,
      'payroll_run_id', v_run.id,
      'period_start', v_run.period_start,
      'period_end', v_run.period_end,
      'pay_date', v_run.pay_date,
      'line_count', v_line_count,
      'gross_total', v_gross,
      'deductions_total', v_deductions,
      'net_total', v_gross - v_deductions,
      'lines', v_lines,
      'privacy', 'employee_ref_only_no_personal_identifiers'
    );
    v_hash := bar_local.sha256_hex(bar_local.canonical_jsonb_text(v_snapshot));
    v_before := to_jsonb(v_run);
    UPDATE bar_local.payroll_runs
       SET status = 'prepared', version = version + 1, gross_total = v_gross,
           deductions_total = v_deductions, net_total = v_gross - v_deductions,
           snapshot_hash = v_hash, prepared_by = v_ctx.staff_id, prepared_at = now(),
           updated_operation_id = (p_envelope->>'operation_id')::uuid, updated_at = now()
     WHERE id = v_run.id;
    v_result := jsonb_build_object(
      'payroll_run_id', v_run.id,
      'status', 'prepared',
      'version', v_run.version + 1,
      'line_count', v_line_count,
      'gross_total', v_gross,
      'deductions_total', v_deductions,
      'net_total', v_gross - v_deductions,
      'snapshot_hash', v_hash,
      'payment_status', 'external_required',
      'filing_status', 'external_required'
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.payroll.run.prepared', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'accounting.payroll.run.prepared', 'payload', v_result)),
      v_run.pay_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_payroll_run_finalise(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_run bar_local.payroll_runs%ROWTYPE;
  v_account bar_local.accounting_accounts%ROWTYPE;
  v_month date;
  v_entry_id uuid;
  v_before jsonb;
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
    SELECT * INTO v_run FROM bar_local.payroll_runs
     WHERE id = (v_payload->>'payroll_run_id')::uuid
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('PAYROLL_RUN_NOT_FOUND', 'The payroll run could not be found in this outlet.');
    END IF;
    IF v_run.status <> 'prepared' THEN
      PERFORM bar_local.raise_business('PAYROLL_RUN_STATE_CONFLICT', 'Only a prepared payroll run can be finalised.');
    END IF;
    IF NULLIF(v_payload->>'expected_version', '') IS NULL
       OR v_run.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('PAYROLL_RUN_VERSION_CONFLICT', 'The payroll run changed since it was loaded. Refresh and try again.');
    END IF;
    v_month := date_trunc('month', v_run.period_start)::date;
    WHILE v_month <= date_trunc('month', v_run.pay_date)::date
    LOOP
      IF EXISTS (SELECT 1 FROM bar_local.accounting_periods WHERE period = to_char(v_month, 'YYYY-MM') AND status = 'closed') THEN
        PERFORM bar_local.raise_business('PERIOD_LOCKED', 'A payroll period is closed.');
      END IF;
      v_month := (v_month + interval '1 month')::date;
    END LOOP;
    IF v_run.gross_total <= 0 THEN
      PERFORM bar_local.raise_business('PAYROLL_EMPTY', 'A payroll run with no gross pay cannot be finalised.');
    END IF;
    SELECT * INTO v_account FROM bar_local.accounting_accounts
     WHERE code = v_run.expense_account_code AND active;
    IF NOT FOUND OR v_account.type <> 'expense' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The payroll expense account is not an active expense account.');
    END IF;
    SELECT * INTO v_account FROM bar_local.accounting_accounts
     WHERE code = v_run.payable_account_code AND active;
    IF NOT FOUND OR v_account.type <> 'liability' THEN
      PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The payroll payable account is not an active liability account.');
    END IF;
    IF v_run.deductions_total > 0 AND v_run.deductions_account_code IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A payroll deductions account is required when deductions are withheld.');
    END IF;
    IF v_run.deductions_total > 0 THEN
      SELECT * INTO v_account FROM bar_local.accounting_accounts
       WHERE code = v_run.deductions_account_code AND active;
      IF NOT FOUND OR v_account.type NOT IN ('asset', 'liability') THEN
        PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'The payroll deductions account is not an active asset or liability account.');
      END IF;
    END IF;
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'accounting.approve',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    v_before := to_jsonb(v_run);
    INSERT INTO bar_local.journal_entries
      (business_id, entry_date, period, memo, source_type, source_id, operation_id)
    VALUES
      (v_ctx.business_id, v_run.pay_date, to_char(v_run.pay_date, 'YYYY-MM'),
       'Payroll finalised for ' || to_char(v_run.period_start, 'YYYY-MM'), 'payroll_run', v_run.id,
       (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_entry_id;
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES (v_entry_id, v_run.expense_account_code, v_run.gross_total, 0, 'Payroll gross expense');
    INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
    VALUES (v_entry_id, v_run.payable_account_code, 0, v_run.net_total, 'Payroll net payable');
    IF v_run.deductions_total > 0 THEN
      INSERT INTO bar_local.journal_lines (entry_id, account_code, debit, credit, description)
      VALUES (v_entry_id, v_run.deductions_account_code, 0, v_run.deductions_total, 'Payroll deductions withheld');
    END IF;
    UPDATE bar_local.payroll_runs
       SET status = 'finalised', version = version + 1, finalised_by = v_ctx.staff_id,
           finalised_at = now(), journal_entry_id = v_entry_id,
           finalise_operation_id = (p_envelope->>'operation_id')::uuid,
           payment_status = 'external_required', filing_status = 'external_required',
           updated_at = now()
     WHERE id = v_run.id;
    v_result := jsonb_build_object(
      'payroll_run_id', v_run.id,
      'status', 'finalised',
      'version', v_run.version + 1,
      'gross_total', v_run.gross_total,
      'deductions_total', v_run.deductions_total,
      'net_total', v_run.net_total,
      'journal_entry_id', v_entry_id,
      'snapshot_hash', v_run.snapshot_hash,
      'payment_status', 'external_required',
      'filing_status', 'external_required'
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'accounting.payroll.run.finalised', (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'accounting.payroll.run.finalised', 'payload', v_result)),
      v_run.pay_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'The payroll finalisation conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_budget_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_budget_id uuid := NULLIF(v_payload->>'budget_id', '')::uuid;
  v_existing bar_local.budgets%ROWTYPE;
  v_name text := trim(v_payload->>'name');
  v_start date := NULLIF(v_payload->>'period_start', '')::date;
  v_end date := NULLIF(v_payload->>'period_end', '')::date;
  v_line jsonb;
  v_line_no integer := 0;
  v_account bar_local.accounting_accounts%ROWTYPE;
  v_amount numeric(14,2);
  v_version integer;
  v_before jsonb;
  v_updated boolean := false;
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
    IF v_name IS NULL OR length(v_name) < 1 OR length(v_name) > 120 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A budget name of 1-120 characters is required.');
    END IF;
    IF v_start IS NULL OR v_end IS NULL OR v_end < v_start THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A valid budget period is required.');
    END IF;
    IF COALESCE(jsonb_typeof(v_payload->'lines'), '') <> 'array' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Budget lines must be an array.');
    END IF;
    IF jsonb_array_length(v_payload->'lines') = 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'At least one budget line is required.');
    END IF;
    IF v_budget_id IS NULL THEN
      IF NULLIF(v_payload->>'expected_version', '') IS NOT NULL THEN
        PERFORM bar_local.raise_business('BUDGET_VERSION_CONFLICT', 'No budget exists for the expected version.');
      END IF;
      IF EXISTS (
        SELECT 1 FROM bar_local.budgets
         WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
           AND lower(name) = lower(v_name) AND period_start = v_start
      ) THEN
        PERFORM bar_local.raise_business('BUDGET_DUPLICATE', 'A budget with this name and start date already exists in this outlet.');
      END IF;
      INSERT INTO bar_local.budgets
        (business_id, outlet_id, name, period_start, period_end, active, created_by, updated_by, operation_id)
      VALUES
        (v_ctx.business_id, v_ctx.outlet_id, v_name, v_start, v_end,
         COALESCE((v_payload->>'active')::boolean, true), v_ctx.staff_id, v_ctx.staff_id,
         (p_envelope->>'operation_id')::uuid)
      RETURNING id, version INTO v_budget_id, v_version;
      v_before := NULL;
    ELSE
      SELECT * INTO v_existing FROM bar_local.budgets
       WHERE id = v_budget_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
       FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('BUDGET_NOT_FOUND', 'The budget could not be found in this outlet.');
      END IF;
      IF NULLIF(v_payload->>'expected_version', '') IS NULL
         OR v_existing.version <> (v_payload->>'expected_version')::integer THEN
        PERFORM bar_local.raise_business('BUDGET_VERSION_CONFLICT', 'The budget changed since it was loaded. Refresh and try again.');
      END IF;
      IF EXISTS (
        SELECT 1 FROM bar_local.budgets
         WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
           AND lower(name) = lower(v_name) AND period_start = v_start AND id <> v_budget_id
      ) THEN
        PERFORM bar_local.raise_business('BUDGET_DUPLICATE', 'A budget with this name and start date already exists in this outlet.');
      END IF;
      v_before := to_jsonb(v_existing);
      v_version := v_existing.version + 1;
      UPDATE bar_local.budgets
         SET name = v_name, period_start = v_start, period_end = v_end,
             active = COALESCE((v_payload->>'active')::boolean, active), version = v_version,
             updated_by = v_ctx.staff_id, updated_operation_id = (p_envelope->>'operation_id')::uuid,
             updated_at = now()
       WHERE id = v_budget_id;
      v_updated := true;
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_payload->'lines')
    LOOP
      v_line_no := v_line_no + 1;
      v_amount := round(COALESCE(NULLIF(v_line->>'amount', '')::numeric, -1), 2);
      IF v_amount < 0 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Budget line amounts cannot be negative.');
      END IF;
      SELECT * INTO v_account FROM bar_local.accounting_accounts
       WHERE code = v_line->>'account_code' AND active;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('ACCOUNT_NOT_FOUND', 'Each budget line must use an active accounting account.');
      END IF;
      INSERT INTO bar_local.budget_lines
        (budget_id, budget_version, line_number, account_code, amount, description)
      VALUES
        (v_budget_id, v_version, v_line_no, v_account.code, v_amount, NULLIF(v_line->>'description', ''));
    END LOOP;
    v_result := jsonb_build_object(
      'budget_id', v_budget_id,
      'name', v_name,
      'period_start', v_start,
      'period_end', v_end,
      'version', v_version,
      'line_count', v_line_no,
      'budget_total', (SELECT COALESCE(sum(amount), 0) FROM bar_local.budget_lines
                        WHERE budget_id = v_budget_id AND budget_version = v_version)
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      CASE WHEN v_updated THEN 'accounting.budget.updated' ELSE 'accounting.budget.created' END,
      (p_envelope->>'operation_id')::uuid, v_before, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object(
        'event_type', CASE WHEN v_updated THEN 'accounting.budget.updated' ELSE 'accounting.budget.created' END,
        'payload', v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'DUPLICATE_RECORD';
      v_message := 'The budget conflicts with an existing record.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.budget_actuals(p_budget_id uuid)
RETURNS TABLE (
  account_code text,
  account_name text,
  account_type text,
  budget_amount numeric(14,2),
  actual_amount numeric(14,2),
  variance numeric(14,2)
) LANGUAGE sql STABLE AS $$
  SELECT bl.account_code,
         aa.name,
         aa.type,
         bl.amount,
         COALESCE(act.actual_amount, 0)::numeric(14,2),
         (COALESCE(act.actual_amount, 0) - bl.amount)::numeric(14,2)
    FROM bar_local.budgets b
    JOIN bar_local.budget_lines bl
      ON bl.budget_id = b.id AND bl.budget_version = b.version
    JOIN bar_local.accounting_accounts aa ON aa.code = bl.account_code
    LEFT JOIN LATERAL (
      SELECT CASE WHEN aa.type IN ('revenue', 'liability', 'equity')
                  THEN sum(jl.credit - jl.debit)
                  ELSE sum(jl.debit - jl.credit)
             END AS actual_amount
        FROM bar_local.journal_lines jl
        JOIN bar_local.journal_entries je ON je.id = jl.entry_id
       WHERE jl.account_code = bl.account_code
         AND je.business_id = b.business_id
         AND je.entry_date BETWEEN b.period_start AND b.period_end
    ) act ON true
   WHERE b.id = p_budget_id
   ORDER BY bl.account_code;
$$;

REVOKE ALL ON bar_local.tax_codes FROM PUBLIC;
REVOKE ALL ON bar_local.tax_codes FROM bar_local_runtime;
REVOKE ALL ON bar_local.ap_invoices FROM PUBLIC;
REVOKE ALL ON bar_local.ap_invoices FROM bar_local_runtime;
REVOKE ALL ON bar_local.ap_invoice_lines FROM PUBLIC;
REVOKE ALL ON bar_local.ap_invoice_lines FROM bar_local_runtime;
REVOKE ALL ON bar_local.ap_payments FROM PUBLIC;
REVOKE ALL ON bar_local.ap_payments FROM bar_local_runtime;
REVOKE ALL ON bar_local.bank_accounts FROM PUBLIC;
REVOKE ALL ON bar_local.bank_accounts FROM bar_local_runtime;
REVOKE ALL ON bar_local.bank_statement_lines FROM PUBLIC;
REVOKE ALL ON bar_local.bank_statement_lines FROM bar_local_runtime;
REVOKE ALL ON bar_local.bank_reconciliations FROM PUBLIC;
REVOKE ALL ON bar_local.bank_reconciliations FROM bar_local_runtime;
REVOKE ALL ON bar_local.tax_return_periods FROM PUBLIC;
REVOKE ALL ON bar_local.tax_return_periods FROM bar_local_runtime;
REVOKE ALL ON bar_local.payroll_runs FROM PUBLIC;
REVOKE ALL ON bar_local.payroll_runs FROM bar_local_runtime;
REVOKE ALL ON bar_local.payroll_lines FROM PUBLIC;
REVOKE ALL ON bar_local.payroll_lines FROM bar_local_runtime;
REVOKE ALL ON bar_local.budgets FROM PUBLIC;
REVOKE ALL ON bar_local.budgets FROM bar_local_runtime;
REVOKE ALL ON bar_local.budget_lines FROM PUBLIC;
REVOKE ALL ON bar_local.budget_lines FROM bar_local_runtime;

ALTER FUNCTION bar_local.assert_period_open(date) SECURITY DEFINER;
ALTER FUNCTION bar_local.assert_period_open(date) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.assert_period_open(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.assert_period_open(date) FROM bar_local_runtime;

ALTER FUNCTION bar_local.budget_actuals(uuid) SECURITY DEFINER;
ALTER FUNCTION bar_local.budget_actuals(uuid) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.budget_actuals(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.budget_actuals(uuid) FROM bar_local_runtime;

ALTER FUNCTION bar_local.cmd_ap_invoice_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_ap_invoice_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_ap_invoice_upsert(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_ap_invoice_upsert(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_ap_invoice_approve(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_ap_invoice_approve(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_ap_invoice_approve(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_ap_invoice_approve(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_ap_payment_post(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_ap_payment_post(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_ap_payment_post(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_ap_payment_post(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_ap_payment_reverse(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_ap_payment_reverse(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_ap_payment_reverse(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_ap_payment_reverse(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_bank_account_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_bank_account_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_bank_account_upsert(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_bank_account_upsert(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_bank_statement_import(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_bank_statement_import(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_bank_statement_import(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_bank_statement_import(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_bank_reconcile(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_bank_reconcile(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_bank_reconcile(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_bank_reconcile(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_tax_code_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_tax_code_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_tax_code_upsert(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_tax_code_upsert(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_tax_return_prepare(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_tax_return_prepare(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_tax_return_prepare(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_tax_return_prepare(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_payroll_run_create(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_payroll_run_create(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_payroll_run_create(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_payroll_run_create(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_payroll_run_prepare(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_payroll_run_prepare(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_payroll_run_prepare(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_payroll_run_prepare(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_payroll_run_finalise(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_payroll_run_finalise(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_payroll_run_finalise(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_payroll_run_finalise(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_budget_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_budget_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_budget_upsert(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_budget_upsert(text, uuid, jsonb, text, text) TO bar_local_runtime;
