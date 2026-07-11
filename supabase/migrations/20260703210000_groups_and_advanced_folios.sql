-- ── Phase 9: Corporate, Groups, and Advanced Folios ────────────────────────
-- Group blocks, master folios, company statements, debtor aging, rooming lists.

-- ── 1. Group Blocks ────────────────────────────────────────────────────────
-- Reserves a block of rooms for a corporate/group booking.
CREATE TABLE IF NOT EXISTS public.group_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  corporate_account_id uuid REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  block_name text NOT NULL,
  contact_name text,
  contact_email text,
  contact_phone text,
  check_in date NOT NULL,
  check_out date NOT NULL,
  nights integer NOT NULL DEFAULT 1,
  rooms_requested integer NOT NULL DEFAULT 1,
  rooms_blocked integer NOT NULL DEFAULT 0,
  rate_per_night numeric(10,2),
  total_estimated numeric(12,2) DEFAULT 0,
  currency text DEFAULT 'BWP',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'partial', 'released', 'cancelled')),
  release_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.group_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_blocks_lodge_policy ON public.group_blocks
  USING (public.app_lodge_access(lodge_id));

GRANT SELECT ON public.group_blocks TO authenticated, anon;

CREATE INDEX IF NOT EXISTS group_blocks_lodge_status_idx ON public.group_blocks (lodge_id, status);
CREATE INDEX IF NOT EXISTS group_blocks_dates_idx ON public.group_blocks (lodge_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS group_blocks_account_idx ON public.group_blocks (corporate_account_id);

-- Group block rooms mapping
CREATE TABLE IF NOT EXISTS public.group_block_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_block_id uuid NOT NULL REFERENCES public.group_blocks(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked', 'booked', 'released')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.group_block_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_block_rooms_lodge_policy ON public.group_block_rooms
  USING (group_block_id IN (
    SELECT id FROM public.group_blocks
    WHERE public.app_lodge_access(lodge_id)
  ));

GRANT SELECT ON public.group_block_rooms TO authenticated, anon;

CREATE UNIQUE INDEX IF NOT EXISTS group_block_rooms_room_idx ON public.group_block_rooms (group_block_id, room_id);

-- ── 2. Master Folios ───────────────────────────────────────────────────────
-- Groups multiple bookings under a single billing entity (group, company, etc.)
CREATE TABLE IF NOT EXISTS public.master_folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  corporate_account_id uuid REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  group_block_id uuid REFERENCES public.group_blocks(id) ON DELETE SET NULL,
  master_folio_number text NOT NULL,
  guest_name text NOT NULL,
  guest_email text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'suspended')),
  total_charges numeric(12,2) DEFAULT 0,
  total_payments numeric(12,2) DEFAULT 0,
  balance numeric(12,2) DEFAULT 0,
  currency text DEFAULT 'BWP',
  credit_limit numeric(10,2) DEFAULT 0,
  payment_terms_days integer DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.master_folios ENABLE ROW LEVEL SECURITY;

CREATE POLICY master_folios_lodge_policy ON public.master_folios
  USING (public.app_lodge_access(lodge_id));

GRANT SELECT ON public.master_folios TO authenticated, anon;

CREATE INDEX IF NOT EXISTS master_folios_lodge_status_idx ON public.master_folios (lodge_id, status);
CREATE INDEX IF NOT EXISTS master_folios_account_idx ON public.master_folios (corporate_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS master_folios_number_idx ON public.master_folios (lodge_id, master_folio_number);

-- Links bookings to master folios
CREATE TABLE IF NOT EXISTS public.master_folio_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_folio_id uuid NOT NULL REFERENCES public.master_folios(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_folio_id, booking_id)
);

ALTER TABLE public.master_folio_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY master_folio_bookings_lodge_policy ON public.master_folio_bookings
  USING (master_folio_id IN (
    SELECT id FROM public.master_folios
    WHERE public.app_lodge_access(lodge_id)
  ));

GRANT SELECT ON public.master_folio_bookings TO authenticated, anon;

-- ── 3. Company Statements ──────────────────────────────────────────────────
-- Generated periodic statements for corporate accounts.
CREATE TABLE IF NOT EXISTS public.company_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  corporate_account_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  statement_number text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  opening_balance numeric(12,2) DEFAULT 0,
  total_charges numeric(12,2) DEFAULT 0,
  total_payments numeric(12,2) DEFAULT 0,
  closing_balance numeric(12,2) DEFAULT 0,
  currency text DEFAULT 'BWP',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
  generated_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_statements_lodge_policy ON public.company_statements
  USING (public.app_lodge_access(lodge_id));

GRANT SELECT ON public.company_statements TO authenticated, anon;

CREATE INDEX IF NOT EXISTS company_statements_lodge_account_idx ON public.company_statements (lodge_id, corporate_account_id);
CREATE INDEX IF NOT EXISTS company_statements_status_idx ON public.company_statements (lodge_id, status);

-- Statement line items
CREATE TABLE IF NOT EXISTS public.company_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id uuid NOT NULL REFERENCES public.company_statements(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  description text NOT NULL,
  charge_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  charge_type text DEFAULT 'room' CHECK (charge_type IN ('room', 'pos', 'service', 'fee', 'payment', 'credit')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_statement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_statement_lines_lodge_policy ON public.company_statement_lines
  USING (statement_id IN (
    SELECT id FROM public.company_statements
    WHERE public.app_lodge_access(lodge_id)
  ));

GRANT SELECT ON public.company_statement_lines TO authenticated, anon;

CREATE INDEX IF NOT EXISTS company_statement_lines_stmt_idx ON public.company_statement_lines (statement_id);

-- ── 4. Rooming Lists ───────────────────────────────────────────────────────
-- Import rooming lists from corporate clients (CSV/bulk booking import).
CREATE TABLE IF NOT EXISTS public.rooming_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  corporate_account_id uuid REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  group_block_id uuid REFERENCES public.group_blocks(id) ON DELETE SET NULL,
  import_name text NOT NULL,
  file_name text,
  total_rows integer DEFAULT 0,
  processed_rows integer DEFAULT 0,
  failed_rows integer DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'partial')),
  error_log jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rooming_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY rooming_lists_lodge_policy ON public.rooming_lists
  USING (public.app_lodge_access(lodge_id));

GRANT SELECT ON public.rooming_lists TO authenticated, anon;

CREATE INDEX IF NOT EXISTS rooming_lists_lodge_idx ON public.rooming_lists (lodge_id, status);

-- Rooming list entries
CREATE TABLE IF NOT EXISTS public.rooming_list_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rooming_list_id uuid NOT NULL REFERENCES public.rooming_lists(id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  guest_email text,
  guest_phone text,
  room_type text,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  check_in date NOT NULL,
  check_out date NOT NULL,
  adults integer DEFAULT 1,
  children integer DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'booked', 'failed', 'skipped')),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  error_message text,
  row_number integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rooming_list_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY rooming_list_entries_lodge_policy ON public.rooming_list_entries
  USING (rooming_list_id IN (
    SELECT id FROM public.rooming_lists
    WHERE public.app_lodge_access(lodge_id)
  ));

GRANT SELECT ON public.rooming_list_entries TO authenticated, anon;

CREATE INDEX IF NOT EXISTS rooming_list_entries_list_idx ON public.rooming_list_entries (rooming_list_id, status);

-- ── 5. RPCs ────────────────────────────────────────────────────────────────

-- Create group block
CREATE OR REPLACE FUNCTION public.create_group_block(
  p_lodge_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  v_id := gen_random_uuid();
  INSERT INTO public.group_blocks (
    id, lodge_id, corporate_account_id, block_name,
    contact_name, contact_email, contact_phone,
    check_in, check_out, nights, rooms_requested,
    rate_per_night, total_estimated, currency, status, release_date, notes
  ) VALUES (
    v_id, p_lodge_id,
    nullif(p_payload->>'corporate_account_id', '')::uuid,
    p_payload->>'block_name',
    p_payload->>'contact_name',
    p_payload->>'contact_email',
    p_payload->>'contact_phone',
    (p_payload->>'check_in')::date,
    (p_payload->>'check_out')::date,
    COALESCE((p_payload->>'nights')::int, 1),
    COALESCE((p_payload->>'rooms_requested')::int, 1),
    (p_payload->>'rate_per_night')::numeric,
    COALESCE((p_payload->>'total_estimated')::numeric, 0),
    COALESCE(p_payload->>'currency', 'BWP'),
    COALESCE(p_payload->>'status', 'pending'),
    nullif(p_payload->>'release_date', '')::date,
    p_payload->>'notes'
  );

  RETURN jsonb_build_object('success', true, 'group_block_id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_group_block(uuid, jsonb) TO authenticated;

-- Update group block
CREATE OR REPLACE FUNCTION public.update_group_block(
  p_id uuid,
  p_lodge_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  UPDATE public.group_blocks SET
    block_name = COALESCE(p_payload->>'block_name', block_name),
    contact_name = COALESCE(p_payload->>'contact_name', contact_name),
    contact_email = COALESCE(p_payload->>'contact_email', contact_email),
    contact_phone = COALESCE(p_payload->>'contact_phone', contact_phone),
    corporate_account_id = COALESCE(nullif(p_payload->>'corporate_account_id', '')::uuid, corporate_account_id),
    check_in = COALESCE((p_payload->>'check_in')::date, check_in),
    check_out = COALESCE((p_payload->>'check_out')::date, check_out),
    nights = COALESCE((p_payload->>'nights')::int, nights),
    rooms_requested = COALESCE((p_payload->>'rooms_requested')::int, rooms_requested),
    rate_per_night = COALESCE((p_payload->>'rate_per_night')::numeric, rate_per_night),
    total_estimated = COALESCE((p_payload->>'total_estimated')::numeric, total_estimated),
    status = COALESCE(p_payload->>'status', status),
    release_date = COALESCE(nullif(p_payload->>'release_date', '')::date, release_date),
    notes = COALESCE(p_payload->>'notes', notes),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_group_block(uuid, uuid, jsonb) TO authenticated;

-- Delete group block
CREATE OR REPLACE FUNCTION public.delete_group_block(
  p_id uuid,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  DELETE FROM public.group_blocks WHERE id = p_id AND lodge_id = p_lodge_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_group_block(uuid, uuid) TO authenticated;

-- Create master folio
CREATE OR REPLACE FUNCTION public.create_master_folio(
  p_lodge_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_number text;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  v_id := gen_random_uuid();
  v_number := 'MF-' || to_char(now(), 'YYYYMM') || '-' || lpad(
    (SELECT count(*) + 1 FROM public.master_folios WHERE lodge_id = p_lodge_id)::text,
    4, '0'
  );

  INSERT INTO public.master_folios (
    id, lodge_id, corporate_account_id, group_block_id,
    master_folio_number, guest_name, guest_email,
    status, currency, credit_limit, payment_terms_days, notes
  ) VALUES (
    v_id, p_lodge_id,
    nullif(p_payload->>'corporate_account_id', '')::uuid,
    nullif(p_payload->>'group_block_id', '')::uuid,
    v_number,
    p_payload->>'guest_name',
    p_payload->>'guest_email',
    COALESCE(p_payload->>'status', 'open'),
    COALESCE(p_payload->>'currency', 'BWP'),
    COALESCE((p_payload->>'credit_limit')::numeric, 0),
    COALESCE((p_payload->>'payment_terms_days')::int, 0),
    p_payload->>'notes'
  );

  RETURN jsonb_build_object('success', true, 'master_folio_id', v_id, 'master_folio_number', v_number);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_master_folio(uuid, jsonb) TO authenticated;

-- Generate company statement
CREATE OR REPLACE FUNCTION public.generate_company_statement(
  p_lodge_id uuid,
  p_corporate_account_id uuid,
  p_period_start date,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_opening numeric(12,2);
  v_charges numeric(12,2);
  v_payments numeric(12,2);
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  v_id := gen_random_uuid();
  v_number := 'ST-' || to_char(now(), 'YYYYMM') || '-' || lpad(
    (SELECT count(*) + 1 FROM public.company_statements WHERE lodge_id = p_lodge_id AND corporate_account_id = p_corporate_account_id)::text,
    4, '0'
  );

  -- Calculate opening balance (closing balance from previous statement)
  SELECT COALESCE(closing_balance, 0) INTO v_opening
  FROM public.company_statements
  WHERE lodge_id = p_lodge_id AND corporate_account_id = p_corporate_account_id
    AND period_end < p_period_start
  ORDER BY period_end DESC LIMIT 1;
  v_opening := COALESCE(v_opening, 0);

  -- Calculate charges and payments in period
  SELECT COALESCE(sum(b.charges_total), 0) INTO v_charges
  FROM public.bookings b
  WHERE b.lodge_id = p_lodge_id
    AND b.corporate_account_id = p_corporate_account_id
    AND b.check_in >= p_period_start AND b.check_in <= p_period_end;

  v_payments := 0; -- Payments would come from booking_payments table

  INSERT INTO public.company_statements (
    id, lodge_id, corporate_account_id, statement_number,
    period_start, period_end, opening_balance,
    total_charges, total_payments, closing_balance,
    status
  ) VALUES (
    v_id, p_lodge_id, p_corporate_account_id, v_number,
    p_period_start, p_period_end, v_opening,
    v_charges, v_payments, v_opening + v_charges - v_payments,
    'draft'
  );

  RETURN jsonb_build_object(
    'success', true,
    'statement_id', v_id,
    'statement_number', v_number,
    'opening_balance', v_opening,
    'total_charges', v_charges,
    'total_payments', v_payments,
    'closing_balance', v_opening + v_charges - v_payments
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_company_statement(uuid, uuid, date, date) TO authenticated;

-- Get debtor aging for corporate account
CREATE OR REPLACE FUNCTION public.get_debtor_aging(
  p_lodge_id uuid,
  p_corporate_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_date date := current_date;
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'current', COALESCE(sum(CASE WHEN b.check_out >= v_current_date THEN b.charges_total - b.amount_paid ELSE 0 END), 0),
    'current_30', COALESCE(sum(CASE WHEN b.check_out >= v_current_date - interval '30 days' AND b.check_out < v_current_date THEN b.charges_total - b.amount_paid ELSE 0 END), 0),
    'days_31_60', COALESCE(sum(CASE WHEN b.check_out >= v_current_date - interval '60 days' AND b.check_out < v_current_date - interval '30 days' THEN b.charges_total - b.amount_paid ELSE 0 END), 0),
    'days_61_90', COALESCE(sum(CASE WHEN b.check_out >= v_current_date - interval '90 days' AND b.check_out < v_current_date - interval '60 days' THEN b.charges_total - b.amount_paid ELSE 0 END), 0),
    'over_90', COALESCE(sum(CASE WHEN b.check_out < v_current_date - interval '90 days' THEN b.charges_total - b.amount_paid ELSE 0 END), 0),
    'total_outstanding', COALESCE(sum(b.charges_total - b.amount_paid), 0)
  ) INTO v_result
  FROM public.bookings b
  WHERE b.lodge_id = p_lodge_id
    AND b.corporate_account_id = p_corporate_account_id
    AND b.charges_total > b.amount_paid;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_debtor_aging(uuid, uuid) TO authenticated;

-- Check credit limit before booking
CREATE OR REPLACE FUNCTION public.check_credit_limit(
  p_lodge_id uuid,
  p_corporate_account_id uuid,
  p_additional_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credit_limit numeric;
  v_current_balance numeric;
  v_within_limit boolean;
BEGIN
  SELECT ca.credit_limit INTO v_credit_limit
  FROM public.corporate_accounts ca
  WHERE ca.id = p_corporate_account_id AND ca.lodge_id = p_lodge_id;

  IF v_credit_limit IS NULL THEN
    RETURN jsonb_build_object('success', true, 'within_limit', true, 'credit_limit', 0, 'current_balance', 0);
  END IF;

  SELECT COALESCE(sum(b.charges_total - b.amount_paid), 0) INTO v_current_balance
  FROM public.bookings b
  WHERE b.lodge_id = p_lodge_id
    AND b.corporate_account_id = p_corporate_account_id
    AND b.status IN ('confirmed', 'checked_in', 'checked_out');

  v_within_limit := (v_current_balance + p_additional_amount) <= v_credit_limit;

  RETURN jsonb_build_object(
    'success', true,
    'within_limit', v_within_limit,
    'credit_limit', v_credit_limit,
    'current_balance', v_current_balance,
    'additional_amount', p_additional_amount,
    'projected_balance', v_current_balance + p_additional_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_credit_limit(uuid, uuid, numeric) TO authenticated;
