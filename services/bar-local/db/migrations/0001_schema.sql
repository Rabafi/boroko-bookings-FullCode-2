-- Local-only Bar authority schema. Never apply this file to hosted Supabase.
CREATE SCHEMA IF NOT EXISTS bar_local;

CREATE TABLE IF NOT EXISTS bar_local.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user
);

CREATE TABLE IF NOT EXISTS bar_local.authority (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  authority_id uuid NOT NULL,
  authority_epoch bigint NOT NULL DEFAULT 1 CHECK (authority_epoch > 0),
  business_id uuid NOT NULL,
  commissioned_at timestamptz,
  catalogue_version bigint NOT NULL DEFAULT 1,
  entitlement_version bigint NOT NULL DEFAULT 0,
  entitlement_features text[] NOT NULL DEFAULT ARRAY[]::text[],
  export_key_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.business (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  currency text NOT NULL DEFAULT 'BWP',
  timezone text NOT NULL DEFAULT 'Africa/Gaborone',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.outlets (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  name text NOT NULL,
  code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS bar_local.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'stock', 'finance')),
  capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
  pin_hash text NOT NULL,
  pin_salt text NOT NULL,
  pin_iterations integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  name text NOT NULL,
  platform text NOT NULL DEFAULT 'modern',
  certificate_fingerprint text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  token_hash text NOT NULL,
  paired_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  pairing_code_id uuid
);

CREATE TABLE IF NOT EXISTS bar_local.pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  code_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  staff_id uuid NOT NULL REFERENCES bar_local.staff(id),
  device_id uuid NOT NULL REFERENCES bar_local.devices(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  authority_epoch bigint NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS bar_local.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  approved_by uuid NOT NULL REFERENCES bar_local.staff(id),
  device_id uuid NOT NULL REFERENCES bar_local.devices(id),
  capability text NOT NULL,
  operation_hash text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  sku text NOT NULL,
  name text NOT NULL,
  category text,
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  tax_rate numeric(7,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 1),
  track_stock boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, sku)
);

CREATE TABLE IF NOT EXISTS bar_local.stock_balances (
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  quantity numeric(18,6) NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, outlet_id, product_id)
);

CREATE TABLE IF NOT EXISTS bar_local.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  delta numeric(18,6) NOT NULL CHECK (delta <> 0),
  reason text NOT NULL,
  operation_id uuid NOT NULL,
  business_date date NOT NULL,
  unit_cost numeric(14,4),
  lot_code text,
  expires_on date,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON bar_local.stock_movements (business_id, outlet_id, product_id, created_at);

CREATE TABLE IF NOT EXISTS bar_local.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  staff_id uuid NOT NULL REFERENCES bar_local.staff(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  business_date date NOT NULL,
  opening_float numeric(14,2) NOT NULL DEFAULT 0,
  counted_cash numeric(14,2),
  expected_cash numeric(14,2),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  note text,
  operation_id uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_operator
  ON bar_local.shifts (business_id, outlet_id, staff_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS bar_local.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  shift_id uuid NOT NULL REFERENCES bar_local.shifts(id),
  type text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  reason text NOT NULL,
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  table_label text,
  owner_staff_id uuid NOT NULL REFERENCES bar_local.staff(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'voided', 'transferred')),
  version integer NOT NULL DEFAULT 1,
  note text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  settled_sale_id uuid,
  operation_id uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS tabs_open_idx ON bar_local.tabs (business_id, outlet_id, status);

CREATE TABLE IF NOT EXISTS bar_local.tab_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id uuid NOT NULL REFERENCES bar_local.tabs(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL,
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  unit_price numeric(14,2) NOT NULL,
  tax_rate numeric(7,4) NOT NULL,
  line_subtotal numeric(14,2) NOT NULL,
  line_tax numeric(14,2) NOT NULL,
  line_total numeric(14,2) NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled', 'voided')),
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tab_id, line_number)
);

CREATE TABLE IF NOT EXISTS bar_local.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  shift_id uuid NOT NULL REFERENCES bar_local.shifts(id),
  device_id uuid NOT NULL REFERENCES bar_local.devices(id),
  actor_staff_id uuid NOT NULL REFERENCES bar_local.staff(id),
  tab_id uuid REFERENCES bar_local.tabs(id),
  receipt_number bigint NOT NULL,
  receipt_series text NOT NULL,
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'voided', 'returned')),
  subtotal numeric(14,2) NOT NULL,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  tax numeric(14,2) NOT NULL,
  tip numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL,
  customer_id uuid,
  walk_in_name text,
  note text,
  original_sale_id uuid REFERENCES bar_local.sales(id),
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (business_id, receipt_series, receipt_number),
  CHECK (round(total, 2) = round(subtotal + tax + tip, 2))
);
CREATE INDEX IF NOT EXISTS sales_date_idx ON bar_local.sales (business_id, outlet_id, business_date);

CREATE TABLE IF NOT EXISTS bar_local.sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES bar_local.sales(id),
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL,
  quantity numeric(18,6) NOT NULL CHECK (quantity <> 0),
  unit_price numeric(14,2) NOT NULL,
  tax_rate numeric(7,4) NOT NULL,
  line_subtotal numeric(14,2) NOT NULL,
  line_discount numeric(14,2) NOT NULL DEFAULT 0,
  line_tax numeric(14,2) NOT NULL,
  line_total numeric(14,2) NOT NULL,
  notes text,
  returned_quantity numeric(18,6) NOT NULL DEFAULT 0,
  operation_id uuid NOT NULL,
  CHECK (round(line_total, 2) = round(line_subtotal - line_discount + line_tax, 2))
);
CREATE INDEX IF NOT EXISTS sale_lines_sale_idx ON bar_local.sale_lines (sale_id);
CREATE INDEX IF NOT EXISTS sale_lines_product_idx ON bar_local.sale_lines (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS sale_lines_number_key ON bar_local.sale_lines (sale_id, line_number);

CREATE TABLE IF NOT EXISTS bar_local.sale_tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES bar_local.sales(id),
  method text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  tendered numeric(14,2),
  change_amount numeric(14,2) NOT NULL DEFAULT 0,
  reference text,
  provider_status text NOT NULL DEFAULT 'not_applicable',
  voucher_id uuid,
  customer_id uuid,
  operation_id uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS sale_tenders_sale_idx ON bar_local.sale_tenders (sale_id);

CREATE TABLE IF NOT EXISTS bar_local.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  name text NOT NULL,
  phone text,
  email text,
  credit_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  customer_id uuid NOT NULL REFERENCES bar_local.customers(id),
  delta numeric(14,2) NOT NULL CHECK (delta <> 0),
  type text NOT NULL,
  sale_id uuid REFERENCES bar_local.sales(id),
  operation_id uuid NOT NULL,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_customer_idx ON bar_local.credit_ledger (customer_id, created_at);

CREATE TABLE IF NOT EXISTS bar_local.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  code text NOT NULL,
  initial_amount numeric(14,2) NOT NULL CHECK (initial_amount > 0),
  balance numeric(14,2) NOT NULL CHECK (balance >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired', 'voided')),
  customer_id uuid REFERENCES bar_local.customers(id),
  expires_on date,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS bar_local.voucher_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES bar_local.vouchers(id),
  delta numeric(14,2) NOT NULL CHECK (delta <> 0),
  type text NOT NULL,
  sale_id uuid REFERENCES bar_local.sales(id),
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.cashups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES bar_local.shifts(id),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  submitted_by uuid NOT NULL REFERENCES bar_local.staff(id),
  counted_cash numeric(14,2) NOT NULL,
  expected_cash numeric(14,2) NOT NULL,
  variance numeric(14,2) NOT NULL,
  counted_card numeric(14,2),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
  notes text,
  proof_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES bar_local.staff(id),
  decision_reason text,
  operation_id uuid NOT NULL,
  review_operation_id uuid,
  UNIQUE (shift_id)
);

CREATE TABLE IF NOT EXISTS bar_local.operations (
  operation_id uuid PRIMARY KEY,
  authority_id uuid NOT NULL,
  authority_epoch bigint NOT NULL,
  business_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  device_id uuid NOT NULL,
  actor_staff_id uuid NOT NULL,
  command text NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('executing', 'committed', 'refused')),
  outcome text,
  result jsonb,
  receipt jsonb,
  error jsonb,
  commit_sequence bigint,
  business_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  refused_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS operations_scope_key ON bar_local.operations (authority_id, business_id, outlet_id, operation_id);
CREATE UNIQUE INDEX IF NOT EXISTS operations_commit_sequence_key ON bar_local.operations (commit_sequence) WHERE commit_sequence IS NOT NULL;

CREATE TABLE IF NOT EXISTS bar_local.authority_counter (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  commit_sequence bigint NOT NULL DEFAULT 0,
  receipt_sequence bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO bar_local.authority_counter (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS bar_local.audit_log (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  actor_staff_id uuid,
  device_id uuid,
  action text NOT NULL,
  operation_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON bar_local.audit_log (business_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_operation_idx ON bar_local.audit_log (operation_id);

CREATE TABLE IF NOT EXISTS bar_local.outbox (
  commit_sequence bigint NOT NULL,
  event_index integer NOT NULL CHECK (event_index >= 0),
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  event_type text NOT NULL,
  operation_id uuid NOT NULL,
  authority_epoch bigint NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  export_batch_id uuid,
  PRIMARY KEY (commit_sequence, event_index),
  UNIQUE (event_id)
);

CREATE TABLE IF NOT EXISTS bar_local.export_batches (
  batch_id uuid PRIMARY KEY,
  from_sequence bigint NOT NULL,
  to_sequence bigint NOT NULL,
  event_count integer NOT NULL,
  manifest_hash text NOT NULL,
  signature text NOT NULL,
  key_id text NOT NULL,
  file_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by text
);

CREATE TABLE IF NOT EXISTS bar_local.print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  sale_id uuid REFERENCES bar_local.sales(id),
  kind text NOT NULL DEFAULT 'receipt',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'printing', 'printed', 'failed')),
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.accounting_accounts (
  code text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.accounting_periods (
  period text PRIMARY KEY CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid REFERENCES bar_local.staff(id),
  operation_id uuid
);

CREATE TABLE IF NOT EXISTS bar_local.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  entry_date date NOT NULL,
  period text NOT NULL,
  memo text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.journal_lines (
  id bigserial PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES bar_local.journal_entries(id),
  account_code text NOT NULL REFERENCES bar_local.accounting_accounts(code),
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text
);

CREATE TABLE IF NOT EXISTS bar_local.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_type text NOT NULL,
  manifest_hash text NOT NULL,
  status text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.backup_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  file_name text NOT NULL,
  file_hash text NOT NULL,
  from_sequence bigint,
  to_sequence bigint,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.setup_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bar_local.test_guard (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  cluster_identity text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bar_local.settings (key, value, version)
VALUES
  ('business_name', '"Local Bar"'::jsonb, 1),
  ('currency', '"BWP"'::jsonb, 1),
  ('timezone', '"Africa/Gaborone"'::jsonb, 1),
  ('tax_inclusive', 'false'::jsonb, 1),
  ('allow_negative_stock', 'false'::jsonb, 1),
  ('default_tax_rate', '"0.0000"'::jsonb, 1),
  ('receipt_series', '"BAR"'::jsonb, 1)
ON CONFLICT (key) DO NOTHING;
