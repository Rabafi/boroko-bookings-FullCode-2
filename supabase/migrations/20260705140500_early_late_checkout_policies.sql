-- 20260705140000_early_late_checkout_policies.sql
-- Early check-in and late checkout policy engine

CREATE TABLE IF NOT EXISTS early_checkin_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  name text NOT NULL,
  fee_type text NOT NULL CHECK (fee_type IN ('flat', 'percentage')),
  fee_amount numeric(12,2) DEFAULT 0,
  fee_percentage numeric(5,2) DEFAULT 0,
  allowed_window_hours int NOT NULL DEFAULT 2,
  requires_approval boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS late_checkout_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  name text NOT NULL,
  fee_type text NOT NULL CHECK (fee_type IN ('flat', 'percentage')),
  fee_amount numeric(12,2) DEFAULT 0,
  fee_percentage numeric(5,2) DEFAULT 0,
  allowed_window_hours int NOT NULL DEFAULT 2,
  requires_approval boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS early_checkin_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  policy_id uuid REFERENCES early_checkin_policies(id),
  requested_time timestamptz NOT NULL,
  fee_amount numeric(12,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS late_checkout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  policy_id uuid REFERENCES late_checkout_policies(id),
  requested_time timestamptz NOT NULL,
  fee_amount numeric(12,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE early_checkin_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE late_checkout_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE early_checkin_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE late_checkout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY early_checkin_policies_lodge_policy ON early_checkin_policies
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY late_checkout_policies_lodge_policy ON late_checkout_policies
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY early_checkin_requests_lodge_policy ON early_checkin_requests
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY late_checkout_requests_lodge_policy ON late_checkout_requests
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_early_checkin_policies_lodge ON early_checkin_policies(lodge_id);
CREATE INDEX IF NOT EXISTS idx_late_checkout_policies_lodge ON late_checkout_policies(lodge_id);
CREATE INDEX IF NOT EXISTS idx_early_checkin_requests_lodge ON early_checkin_requests(lodge_id);
CREATE INDEX IF NOT EXISTS idx_late_checkout_requests_lodge ON late_checkout_requests(lodge_id);

CREATE OR REPLACE FUNCTION get_early_checkin_policies(
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_policies jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);
  SELECT COALESCE(jsonb_agg(row_to_json(ecp.*)::jsonb ORDER BY ecp.created_at), '[]'::jsonb) INTO v_policies
  FROM early_checkin_policies ecp WHERE ecp.lodge_id = p_lodge_id;
  RETURN jsonb_build_object('policies', v_policies);
END;
$$;

CREATE OR REPLACE FUNCTION create_early_checkin_policy(
  p_lodge_id uuid,
  p_name text,
  p_fee_type text,
  p_fee_amount numeric,
  p_fee_percentage numeric,
  p_allowed_window_hours int,
  p_requires_approval boolean,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  v_id := gen_random_uuid();
  INSERT INTO early_checkin_policies (id, lodge_id, name, fee_type, fee_amount, fee_percentage, allowed_window_hours, requires_approval, active)
  VALUES (v_id, p_lodge_id, p_name, p_fee_type, p_fee_amount, p_fee_percentage, p_allowed_window_hours, p_requires_approval, p_active);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION update_early_checkin_policy(
  p_id uuid,
  p_lodge_id uuid,
  p_name text DEFAULT NULL,
  p_fee_type text DEFAULT NULL,
  p_fee_amount numeric DEFAULT NULL,
  p_fee_percentage numeric DEFAULT NULL,
  p_allowed_window_hours int DEFAULT NULL,
  p_requires_approval boolean DEFAULT NULL,
  p_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  UPDATE early_checkin_policies SET
    name = COALESCE(p_name, name),
    fee_type = COALESCE(p_fee_type, fee_type),
    fee_amount = COALESCE(p_fee_amount, fee_amount),
    fee_percentage = COALESCE(p_fee_percentage, fee_percentage),
    allowed_window_hours = COALESCE(p_allowed_window_hours, allowed_window_hours),
    requires_approval = COALESCE(p_requires_approval, requires_approval),
    active = COALESCE(p_active, active)
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION delete_early_checkin_policy(
  p_id uuid,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  DELETE FROM early_checkin_policies WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION get_late_checkout_policies(
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_policies jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);
  SELECT COALESCE(jsonb_agg(row_to_json(lcp.*)::jsonb ORDER BY lcp.created_at), '[]'::jsonb) INTO v_policies
  FROM late_checkout_policies lcp WHERE lcp.lodge_id = p_lodge_id;
  RETURN jsonb_build_object('policies', v_policies);
END;
$$;

CREATE OR REPLACE FUNCTION create_late_checkout_policy(
  p_lodge_id uuid,
  p_name text,
  p_fee_type text,
  p_fee_amount numeric,
  p_fee_percentage numeric,
  p_allowed_window_hours int,
  p_requires_approval boolean,
  p_active boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  v_id := gen_random_uuid();
  INSERT INTO late_checkout_policies (id, lodge_id, name, fee_type, fee_amount, fee_percentage, allowed_window_hours, requires_approval, active)
  VALUES (v_id, p_lodge_id, p_name, p_fee_type, p_fee_amount, p_fee_percentage, p_allowed_window_hours, p_requires_approval, p_active);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION update_late_checkout_policy(
  p_id uuid,
  p_lodge_id uuid,
  p_name text DEFAULT NULL,
  p_fee_type text DEFAULT NULL,
  p_fee_amount numeric DEFAULT NULL,
  p_fee_percentage numeric DEFAULT NULL,
  p_allowed_window_hours int DEFAULT NULL,
  p_requires_approval boolean DEFAULT NULL,
  p_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  UPDATE late_checkout_policies SET
    name = COALESCE(p_name, name),
    fee_type = COALESCE(p_fee_type, fee_type),
    fee_amount = COALESCE(p_fee_amount, fee_amount),
    fee_percentage = COALESCE(p_fee_percentage, fee_percentage),
    allowed_window_hours = COALESCE(p_allowed_window_hours, allowed_window_hours),
    requires_approval = COALESCE(p_requires_approval, requires_approval),
    active = COALESCE(p_active, active)
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION delete_late_checkout_policy(
  p_id uuid,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  DELETE FROM late_checkout_policies WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION get_early_checkin_requests(
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_requests jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);
  SELECT COALESCE(jsonb_agg(row_to_json(ecr.*)::jsonb ORDER BY ecr.created_at DESC), '[]'::jsonb) INTO v_requests
  FROM early_checkin_requests ecr WHERE ecr.lodge_id = p_lodge_id;
  RETURN jsonb_build_object('requests', v_requests);
END;
$$;

CREATE OR REPLACE FUNCTION create_early_checkin_request(
  p_lodge_id uuid,
  p_booking_id uuid,
  p_policy_id uuid,
  p_requested_time timestamptz,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
  v_fee numeric(12,2);
  v_policy early_checkin_policies%ROWTYPE;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  SELECT * INTO v_policy FROM early_checkin_policies WHERE id = p_policy_id AND lodge_id = p_lodge_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Active policy not found');
  END IF;

  IF v_policy.fee_type = 'flat' THEN
    v_fee := v_policy.fee_amount;
  ELSE
    SELECT COALESCE(SUM(COALESCE(rate_per_night, 0)), 0) * (v_policy.fee_percentage / 100) INTO v_fee
    FROM bookings WHERE id = p_booking_id AND lodge_id = p_lodge_id;
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO early_checkin_requests (id, lodge_id, booking_id, policy_id, requested_time, fee_amount, notes)
  VALUES (v_id, p_lodge_id, p_booking_id, p_policy_id, p_requested_time, v_fee, p_notes);

  RETURN jsonb_build_object('success', true, 'id', v_id, 'fee_amount', v_fee);
END;
$$;

CREATE OR REPLACE FUNCTION approve_early_checkin_request(
  p_request_id uuid,
  p_lodge_id uuid,
  p_approved_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  UPDATE early_checkin_requests SET status = 'approved', approved_by = p_approved_by, approved_at = now()
  WHERE id = p_request_id AND lodge_id = p_lodge_id RETURNING booking_id INTO v_booking_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found'); END IF;
  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'booking_id', v_booking_id);
END;
$$;

CREATE OR REPLACE FUNCTION reject_early_checkin_request(
  p_request_id uuid,
  p_lodge_id uuid,
  p_approved_by uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  UPDATE early_checkin_requests SET status = 'rejected', approved_by = p_approved_by, approved_at = now(), notes = COALESCE(p_notes, notes)
  WHERE id = p_request_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found'); END IF;
  RETURN jsonb_build_object('success', true, 'request_id', p_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION get_late_checkout_requests(
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_requests jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);
  SELECT COALESCE(jsonb_agg(row_to_json(lcr.*)::jsonb ORDER BY lcr.created_at DESC), '[]'::jsonb) INTO v_requests
  FROM late_checkout_requests lcr WHERE lcr.lodge_id = p_lodge_id;
  RETURN jsonb_build_object('requests', v_requests);
END;
$$;

CREATE OR REPLACE FUNCTION create_late_checkout_request(
  p_lodge_id uuid,
  p_booking_id uuid,
  p_policy_id uuid,
  p_requested_time timestamptz,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
  v_fee numeric(12,2);
  v_policy late_checkout_policies%ROWTYPE;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  SELECT * INTO v_policy FROM late_checkout_policies WHERE id = p_policy_id AND lodge_id = p_lodge_id AND active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Active policy not found');
  END IF;

  IF v_policy.fee_type = 'flat' THEN
    v_fee := v_policy.fee_amount;
  ELSE
    SELECT COALESCE(SUM(COALESCE(rate_per_night, 0)), 0) * (v_policy.fee_percentage / 100) INTO v_fee
    FROM bookings WHERE id = p_booking_id AND lodge_id = p_lodge_id;
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO late_checkout_requests (id, lodge_id, booking_id, policy_id, requested_time, fee_amount, notes)
  VALUES (v_id, p_lodge_id, p_booking_id, p_policy_id, p_requested_time, v_fee, p_notes);

  RETURN jsonb_build_object('success', true, 'id', v_id, 'fee_amount', v_fee);
END;
$$;

CREATE OR REPLACE FUNCTION approve_late_checkout_request(
  p_request_id uuid,
  p_lodge_id uuid,
  p_approved_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  UPDATE late_checkout_requests SET status = 'approved', approved_by = p_approved_by, approved_at = now()
  WHERE id = p_request_id AND lodge_id = p_lodge_id RETURNING booking_id INTO v_booking_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found'); END IF;
  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'booking_id', v_booking_id);
END;
$$;

CREATE OR REPLACE FUNCTION reject_late_checkout_request(
  p_request_id uuid,
  p_lodge_id uuid,
  p_approved_by uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  UPDATE late_checkout_requests SET status = 'rejected', approved_by = p_approved_by, approved_at = now(), notes = COALESCE(p_notes, notes)
  WHERE id = p_request_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Request not found'); END IF;
  RETURN jsonb_build_object('success', true, 'request_id', p_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION calculate_early_checkin_fee(
  p_booking_id uuid,
  p_requested_time timestamptz,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rate numeric(12,2);
  v_fee numeric(12,2);
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);
  SELECT COALESCE(rate_per_night, 0) INTO v_rate FROM bookings WHERE id = p_booking_id AND lodge_id = p_lodge_id;
  v_fee := v_rate * 0.5;
  RETURN jsonb_build_object('fee_amount', v_fee, 'calculation_basis', '50% of nightly rate');
END;
$$;

CREATE OR REPLACE FUNCTION calculate_late_checkout_fee(
  p_booking_id uuid,
  p_requested_time timestamptz,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rate numeric(12,2);
  v_fee numeric(12,2);
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);
  SELECT COALESCE(rate_per_night, 0) INTO v_rate FROM bookings WHERE id = p_booking_id AND lodge_id = p_lodge_id;
  v_fee := v_rate * 0.5;
  RETURN jsonb_build_object('fee_amount', v_fee, 'calculation_basis', '50% of nightly rate');
END;
$$;

GRANT EXECUTE ON FUNCTION get_early_checkin_policies(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_early_checkin_policy(uuid, text, text, numeric, numeric, int, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_early_checkin_policy(uuid, uuid, text, text, numeric, numeric, int, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_early_checkin_policy(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_late_checkout_policies(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_late_checkout_policy(uuid, text, text, numeric, numeric, int, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_late_checkout_policy(uuid, uuid, text, text, numeric, numeric, int, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_late_checkout_policy(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_early_checkin_requests(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_early_checkin_request(uuid, uuid, uuid, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION approve_early_checkin_request(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reject_early_checkin_request(uuid, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_late_checkout_requests(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_late_checkout_request(uuid, uuid, uuid, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION approve_late_checkout_request(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reject_late_checkout_request(uuid, uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION calculate_early_checkin_fee(uuid, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION calculate_late_checkout_fee(uuid, timestamptz, uuid) TO authenticated, service_role;
