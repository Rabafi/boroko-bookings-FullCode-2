-- Hotel Folio Ledger
-- Independent folio ledger with split billing, charge transfers, and audit trail.
-- All mutations happen server-side via SECURITY DEFINER RPCs.

-- ── Tables ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hotel_folios (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lodge_id BIGINT NOT NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  guest_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  folio_type TEXT NOT NULL CHECK (folio_type IN ('guest', 'master', 'company', 'department', 'incidental')),
  folio_number TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'locked', 'void')),
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hotel_folios_number ON hotel_folios(folio_number);

CREATE TABLE IF NOT EXISTS folio_line_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  folio_id BIGINT NOT NULL REFERENCES hotel_folios(id) ON DELETE CASCADE,
  lodge_id BIGINT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_type TEXT NOT NULL CHECK (line_type IN ('charge', 'payment', 'transfer_in', 'transfer_out', 'void', 'adjustment')),
  description TEXT NOT NULL DEFAULT '',
  reference_type TEXT,
  reference_id BIGINT,
  audit_before JSONB,
  audit_after JSONB,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folio_line_items_folio ON folio_line_items(folio_id);
CREATE INDEX IF NOT EXISTS idx_folio_line_items_lodge ON folio_line_items(lodge_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE hotel_folios ENABLE ROW LEVEL SECURITY;
ALTER TABLE folio_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY hotel_folios_lodge_isolation ON hotel_folios
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

CREATE POLICY folio_line_items_lodge_isolation ON folio_line_items
  FOR ALL USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

-- ── Helpers ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_generate_folio_number(p_lodge_id BIGINT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  seq INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SPLIT_PART(folio_number, '-', 3) AS INT)), 0) + 1
    INTO seq FROM hotel_folios WHERE lodge_id = p_lodge_id;
  RETURN 'FOL-' || TO_CHAR(p_lodge_id, 'FM0000') || '-' || TO_CHAR(seq, 'FM000000');
END;
$$;

-- ── RPC: create_hotel_folio ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_hotel_folio(
  p_lodge_id BIGINT,
  p_booking_id uuid DEFAULT NULL,
  p_guest_id uuid DEFAULT NULL,
  p_folio_type TEXT DEFAULT 'guest',
  p_label TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_folio_number TEXT;
  v_folio hotel_folios;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  v_folio_number := app_generate_folio_number(p_lodge_id);
  INSERT INTO hotel_folios (lodge_id, booking_id, guest_id, folio_type, folio_number, label)
  VALUES (p_lodge_id, p_booking_id, p_guest_id, p_folio_type, v_folio_number, p_label)
  RETURNING * INTO v_folio;
  RETURN row_to_jsonb(v_folio);
END;
$$;

-- ── RPC: get_hotel_folios ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_hotel_folios(
  p_lodge_id BIGINT,
  p_booking_id uuid DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(hf) ORDER BY hf.created_at DESC), '[]'::JSONB)
    INTO v_result
    FROM hotel_folios hf
   WHERE hf.lodge_id = p_lodge_id
     AND (p_booking_id IS NULL OR hf.booking_id = p_booking_id);
  RETURN v_result;
END;
$$;

-- ── RPC: get_folio_line_items ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_folio_line_items(
  p_lodge_id BIGINT,
  p_folio_id BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(fli) ORDER BY fli.created_at DESC), '[]'::JSONB)
    INTO v_result
    FROM folio_line_items fli
    JOIN hotel_folios hf ON hf.id = fli.folio_id
   WHERE hf.lodge_id = p_lodge_id AND fli.folio_id = p_folio_id;
  RETURN v_result;
END;
$$;

-- ── RPC: add_folio_charge ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION add_folio_charge(
  p_lodge_id BIGINT,
  p_folio_id BIGINT,
  p_amount NUMERIC,
  p_description TEXT DEFAULT '',
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id BIGINT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_folio hotel_folios;
  v_line folio_line_items;
  v_audit_before JSONB;
  v_audit_after JSONB;
  v_user_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  SELECT * INTO v_folio FROM hotel_folios WHERE id = p_folio_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folio not found' USING ERRCODE = 'P0002'; END IF;
  IF v_folio.status = 'locked' THEN RAISE EXCEPTION 'Folio is locked' USING ERRCODE = 'P0001'; END IF;
  IF v_folio.status = 'closed' THEN RAISE EXCEPTION 'Folio is closed' USING ERRCODE = 'P0001'; END IF;
  IF v_folio.status = 'void' THEN RAISE EXCEPTION 'Folio is void' USING ERRCODE = 'P0001'; END IF;

  v_user_id := app_current_user_id();
  v_audit_before := row_to_jsonb(v_folio);

  INSERT INTO folio_line_items (folio_id, lodge_id, amount, line_type, description, reference_type, reference_id, created_by)
  VALUES (p_folio_id, p_lodge_id, p_amount, 'charge', p_description, p_reference_type, p_reference_id, v_user_id)
  RETURNING * INTO v_line;

  UPDATE hotel_folios SET balance = balance + p_amount, updated_at = now() WHERE id = p_folio_id
  RETURNING * INTO v_folio;

  v_audit_after := row_to_jsonb(v_folio);
  UPDATE folio_line_items SET audit_before = v_audit_before, audit_after = v_audit_after WHERE id = v_line.id;

  RETURN jsonb_build_object('line_item', row_to_jsonb(v_line), 'folio', row_to_jsonb(v_folio));
END;
$$;

-- ── RPC: add_folio_payment ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION add_folio_payment(
  p_lodge_id BIGINT,
  p_folio_id BIGINT,
  p_amount NUMERIC,
  p_description TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_folio hotel_folios;
  v_line folio_line_items;
  v_user_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  SELECT * INTO v_folio FROM hotel_folios WHERE id = p_folio_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folio not found' USING ERRCODE = 'P0002'; END IF;
  IF v_folio.status = 'locked' THEN RAISE EXCEPTION 'Folio is locked' USING ERRCODE = 'P0001'; END IF;
  IF v_folio.status = 'closed' THEN RAISE EXCEPTION 'Folio is closed' USING ERRCODE = 'P0001'; END IF;
  IF v_folio.status = 'void' THEN RAISE EXCEPTION 'Folio is void' USING ERRCODE = 'P0001'; END IF;

  v_user_id := app_current_user_id();

  INSERT INTO folio_line_items (folio_id, lodge_id, amount, line_type, description, created_by)
  VALUES (p_folio_id, p_lodge_id, p_amount, 'payment', p_description, v_user_id)
  RETURNING * INTO v_line;

  UPDATE hotel_folios SET balance = balance - p_amount, updated_at = now() WHERE id = p_folio_id;

  RETURN jsonb_build_object('line_item', row_to_jsonb(v_line));
END;
$$;

-- ── RPC: transfer_folio_charge ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION transfer_folio_charge(
  p_lodge_id BIGINT,
  p_source_folio_id BIGINT,
  p_target_folio_id BIGINT,
  p_amount NUMERIC,
  p_description TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source hotel_folios;
  v_target hotel_folios;
  v_out_line folio_line_items;
  v_in_line folio_line_items;
  v_user_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  SELECT * INTO v_source FROM hotel_folios WHERE id = p_source_folio_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source folio not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_target FROM hotel_folios WHERE id = p_target_folio_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target folio not found' USING ERRCODE = 'P0002'; END IF;

  v_user_id := app_current_user_id();

  INSERT INTO folio_line_items (folio_id, lodge_id, amount, line_type, description, created_by)
  VALUES (p_source_folio_id, p_lodge_id, p_amount, 'transfer_out', p_description, v_user_id)
  RETURNING * INTO v_out_line;

  INSERT INTO folio_line_items (folio_id, lodge_id, amount, line_type, description, created_by)
  VALUES (p_target_folio_id, p_lodge_id, p_amount, 'transfer_in', p_description, v_user_id)
  RETURNING * INTO v_in_line;

  UPDATE hotel_folios SET balance = balance - p_amount, updated_at = now() WHERE id = p_source_folio_id;
  UPDATE hotel_folios SET balance = balance + p_amount, updated_at = now() WHERE id = p_target_folio_id;

  RETURN jsonb_build_object(
    'transfer_out', row_to_jsonb(v_out_line),
    'transfer_in', row_to_jsonb(v_in_line)
  );
END;
$$;

-- ── RPC: split_folio ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION split_folio(
  p_lodge_id BIGINT,
  p_source_folio_id BIGINT,
  p_target_folio_type TEXT,
  p_amount NUMERIC,
  p_target_label TEXT DEFAULT '',
  p_description TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source hotel_folios;
  v_target hotel_folios;
  v_folio_number TEXT;
  v_user_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  SELECT * INTO v_source FROM hotel_folios WHERE id = p_source_folio_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source folio not found' USING ERRCODE = 'P0002'; END IF;
  IF v_source.status != 'open' THEN RAISE EXCEPTION 'Source folio must be open' USING ERRCODE = 'P0001'; END IF;

  v_user_id := app_current_user_id();
  v_folio_number := app_generate_folio_number(p_lodge_id);

  INSERT INTO hotel_folios (lodge_id, booking_id, guest_id, folio_type, folio_number, label)
  VALUES (p_lodge_id, v_source.booking_id, v_source.guest_id, p_target_folio_type, v_folio_number, p_target_label)
  RETURNING * INTO v_target;

  INSERT INTO folio_line_items (folio_id, lodge_id, amount, line_type, description, created_by)
  VALUES (p_source_folio_id, p_lodge_id, p_amount, 'transfer_out', p_description, v_user_id);

  INSERT INTO folio_line_items (folio_id, lodge_id, amount, line_type, description, created_by)
  VALUES (v_target.id, p_lodge_id, p_amount, 'transfer_in', p_description, v_user_id);

  UPDATE hotel_folios SET balance = balance - p_amount, updated_at = now() WHERE id = p_source_folio_id;
  UPDATE hotel_folios SET balance = balance + p_amount, updated_at = now() WHERE id = v_target.id;

  RETURN jsonb_build_object('source_folio', row_to_jsonb(v_source), 'target_folio', row_to_jsonb(v_target));
END;
$$;

-- ── RPC: void_folio_line ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION void_folio_line(
  p_lodge_id BIGINT,
  p_line_item_id BIGINT,
  p_reason TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line folio_line_items;
  v_folio hotel_folios;
  v_void_line folio_line_items;
  v_user_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  SELECT fli.* INTO v_line
    FROM folio_line_items fli
    JOIN hotel_folios hf ON hf.id = fli.folio_id
   WHERE fli.id = p_line_item_id AND hf.lodge_id = p_lodge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Line item not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_folio FROM hotel_folios WHERE id = v_line.folio_id;
  IF v_folio.status = 'locked' THEN RAISE EXCEPTION 'Folio is locked' USING ERRCODE = 'P0001'; END IF;

  v_user_id := app_current_user_id();

  -- Reverse the original amount on the folio balance
  UPDATE hotel_folios
     SET balance = balance - v_line.amount, updated_at = now()
   WHERE id = v_line.folio_id;

  -- Record void with audit
  INSERT INTO folio_line_items (folio_id, lodge_id, amount, line_type, description, audit_before, audit_after, created_by)
  VALUES (
    v_line.folio_id, p_lodge_id, v_line.amount, 'void',
    COALESCE(NULLIF(p_reason, ''), 'Voided') || ' - original: ' || v_line.description,
    row_to_jsonb(v_line), null, v_user_id
  )
  RETURNING * INTO v_void_line;

  RETURN jsonb_build_object('void', row_to_jsonb(v_void_line));
END;
$$;

-- ── RPC: close_folio ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION close_folio(
  p_lodge_id BIGINT,
  p_folio_id BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_folio hotel_folios;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  UPDATE hotel_folios SET status = 'closed', updated_at = now()
   WHERE id = p_folio_id AND lodge_id = p_lodge_id AND status = 'open'
   RETURNING * INTO v_folio;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folio not found or not open' USING ERRCODE = 'P0002'; END IF;
  RETURN row_to_jsonb(v_folio);
END;
$$;

-- ── RPC: reopen_folio ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reopen_folio(
  p_lodge_id BIGINT,
  p_folio_id BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_folio hotel_folios;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  UPDATE hotel_folios SET status = 'open', updated_at = now()
   WHERE id = p_folio_id AND lodge_id = p_lodge_id AND status = 'closed'
   RETURNING * INTO v_folio;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folio not found or not closed' USING ERRCODE = 'P0002'; END IF;
  RETURN row_to_jsonb(v_folio);
END;
$$;

-- ── RPC: lock_folio ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lock_folio(
  p_lodge_id BIGINT,
  p_folio_id BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_folio hotel_folios;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  UPDATE hotel_folios SET status = 'locked', updated_at = now()
   WHERE id = p_folio_id AND lodge_id = p_lodge_id AND status IN ('open', 'closed')
   RETURNING * INTO v_folio;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folio not found or already locked' USING ERRCODE = 'P0002'; END IF;
  RETURN row_to_jsonb(v_folio);
END;
$$;

-- ── RPC: get_folio_balance ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_folio_balance(
  p_lodge_id BIGINT,
  p_folio_id BIGINT
)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance NUMERIC;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id);
  SELECT balance INTO v_balance FROM hotel_folios WHERE id = p_folio_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folio not found' USING ERRCODE = 'P0002'; END IF;
  RETURN v_balance;
END;
$$;

-- ── Grant EXECUTE to authenticated and service_role ──────────────────────────

GRANT EXECUTE ON FUNCTION create_hotel_folio TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_hotel_folios TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_folio_line_items TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION add_folio_charge TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION add_folio_payment TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION transfer_folio_charge TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION split_folio TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION void_folio_line TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION close_folio TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reopen_folio TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION lock_folio TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_folio_balance TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_generate_folio_number TO authenticated, service_role;
