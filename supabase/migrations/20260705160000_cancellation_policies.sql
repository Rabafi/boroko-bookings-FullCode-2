-- 20260705160000_cancellation_policies.sql
-- Cancellation/no-show policy engine with fee calculation, deposit handling, customer credit

CREATE TABLE IF NOT EXISTS cancellation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  name text NOT NULL,
  applicable_sources jsonb DEFAULT '[]'::jsonb,
  free_cancellation_hours int NOT NULL DEFAULT 24,
  fee_type text NOT NULL CHECK (fee_type IN ('flat', 'percentage', 'nights')),
  fee_amount_or_percent numeric(12,2) DEFAULT 0,
  deposit_retention_behavior text NOT NULL DEFAULT 'forfeit' CHECK (deposit_retention_behavior IN ('forfeit', 'partial', 'refund')),
  customer_credit_behavior boolean DEFAULT false,
  active boolean DEFAULT true,
  priority int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  booking_id uuid NOT NULL,
  policy_id uuid REFERENCES cancellation_policies(id),
  reason_category text,
  reason_detail text,
  fee_calculated numeric(12,2) DEFAULT 0,
  refund_amount numeric(12,2) DEFAULT 0,
  retained_amount numeric(12,2) DEFAULT 0,
  deposit_handling text,
  customer_credit_amount numeric(12,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE cancellation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY cancellation_policies_lodge_policy ON cancellation_policies
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY cancellation_requests_lodge_policy ON cancellation_requests
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_cancellation_policies_lodge ON cancellation_policies(lodge_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_lodge ON cancellation_requests(lodge_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_requests_status ON cancellation_requests(status);

CREATE OR REPLACE FUNCTION get_cancellation_policies(
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
  SELECT COALESCE(jsonb_agg(row_to_json(cp.*)::jsonb ORDER BY cp.priority DESC, cp.created_at), '[]'::jsonb) INTO v_policies
  FROM cancellation_policies cp WHERE cp.lodge_id = p_lodge_id;
  RETURN jsonb_build_object('policies', v_policies);
END;
$$;

CREATE OR REPLACE FUNCTION create_cancellation_policy(
  p_lodge_id uuid,
  p_name text,
  p_applicable_sources jsonb,
  p_free_cancellation_hours int,
  p_fee_type text,
  p_fee_amount_or_percent numeric,
  p_deposit_retention_behavior text,
  p_customer_credit_behavior boolean,
  p_active boolean,
  p_priority int
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
  INSERT INTO cancellation_policies (id, lodge_id, name, applicable_sources, free_cancellation_hours, fee_type, fee_amount_or_percent, deposit_retention_behavior, customer_credit_behavior, active, priority)
  VALUES (v_id, p_lodge_id, p_name, p_applicable_sources, p_free_cancellation_hours, p_fee_type, p_fee_amount_or_percent, p_deposit_retention_behavior, p_customer_credit_behavior, p_active, p_priority);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION update_cancellation_policy(
  p_id uuid,
  p_lodge_id uuid,
  p_name text DEFAULT NULL,
  p_applicable_sources jsonb DEFAULT NULL,
  p_free_cancellation_hours int DEFAULT NULL,
  p_fee_type text DEFAULT NULL,
  p_fee_amount_or_percent numeric DEFAULT NULL,
  p_deposit_retention_behavior text DEFAULT NULL,
  p_customer_credit_behavior boolean DEFAULT NULL,
  p_active boolean DEFAULT NULL,
  p_priority int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  UPDATE cancellation_policies SET
    name = COALESCE(p_name, name),
    applicable_sources = COALESCE(p_applicable_sources, applicable_sources),
    free_cancellation_hours = COALESCE(p_free_cancellation_hours, free_cancellation_hours),
    fee_type = COALESCE(p_fee_type, fee_type),
    fee_amount_or_percent = COALESCE(p_fee_amount_or_percent, fee_amount_or_percent),
    deposit_retention_behavior = COALESCE(p_deposit_retention_behavior, deposit_retention_behavior),
    customer_credit_behavior = COALESCE(p_customer_credit_behavior, customer_credit_behavior),
    active = COALESCE(p_active, active),
    priority = COALESCE(p_priority, priority)
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION delete_cancellation_policy(
  p_id uuid,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);
  DELETE FROM cancellation_policies WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION calculate_cancellation_fee(
  p_booking_id uuid,
  p_reason_category text,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking record;
  v_policy record;
  v_hours_until_checkin int;
  v_fee numeric(12,2) := 0;
  v_refund numeric(12,2) := 0;
  v_retained numeric(12,2) := 0;
  v_credit numeric(12,2) := 0;
  v_deposit_handling text;
  v_booking_amount numeric(12,2);
  v_amount_paid numeric(12,2);
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  SELECT * INTO v_policy FROM cancellation_policies WHERE lodge_id = p_lodge_id AND active = true ORDER BY priority DESC LIMIT 1;

  v_hours_until_checkin := EXTRACT(EPOCH FROM (v_booking.check_in::timestamp - now())) / 3600;
  v_booking_amount := COALESCE(v_booking.total_amount, 0);
  v_amount_paid := COALESCE(v_booking.amount_paid, 0);

  IF v_hours_until_checkin > COALESCE(v_policy.free_cancellation_hours, 24) THEN
    v_fee := 0;
    v_refund := v_amount_paid;
    v_retained := 0;
    v_deposit_handling := 'refund';
  ELSE
    IF v_policy.fee_type = 'flat' THEN
      v_fee := LEAST(v_policy.fee_amount_or_percent, v_booking_amount);
    ELSIF v_policy.fee_type = 'percentage' THEN
      v_fee := v_booking_amount * (v_policy.fee_amount_or_percent / 100);
    ELSE
      v_fee := v_policy.fee_amount_or_percent;
    END IF;

    v_retained := LEAST(v_fee, v_amount_paid);
    v_refund := GREATEST(0, v_amount_paid - v_retained);

    IF v_policy.deposit_retention_behavior = 'forfeit' THEN
      v_retained := v_amount_paid;
      v_refund := 0;
    ELSIF v_policy.deposit_retention_behavior = 'partial' THEN
      v_retained := LEAST(v_fee, v_amount_paid);
      v_refund := GREATEST(0, v_amount_paid - v_retained);
    ELSE
      v_retained := 0;
      v_refund := v_amount_paid;
    END IF;

    v_deposit_handling := v_policy.deposit_retention_behavior;
  END IF;

  IF v_policy.customer_credit_behavior AND v_refund > 0 THEN
    v_credit := v_refund * 0.5;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'fee_calculated', v_fee,
    'refund_amount', v_refund,
    'retained_amount', v_retained,
    'deposit_handling', v_deposit_handling,
    'customer_credit_amount', v_credit,
    'hours_until_checkin', v_hours_until_checkin,
    'policy_applied', v_policy.name
  );
END;
$$;

CREATE OR REPLACE FUNCTION create_cancellation_request(
  p_lodge_id uuid,
  p_booking_id uuid,
  p_policy_id uuid,
  p_reason_category text,
  p_reason_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
  v_calc jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  v_calc := calculate_cancellation_fee(p_booking_id, p_reason_category, p_lodge_id);

  IF (v_calc->>'success')::boolean = false THEN
    RETURN v_calc;
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO cancellation_requests (id, lodge_id, booking_id, policy_id, reason_category, reason_detail, fee_calculated, refund_amount, retained_amount, deposit_handling, customer_credit_amount)
  VALUES (v_id, p_lodge_id, p_booking_id, p_policy_id, p_reason_category, p_reason_detail,
    (v_calc->>'fee_calculated')::numeric, (v_calc->>'refund_amount')::numeric,
    (v_calc->>'retained_amount')::numeric, v_calc->>'deposit_handling',
    (v_calc->>'customer_credit_amount')::numeric);

  RETURN jsonb_build_object('success', true, 'id', v_id, 'calculation', v_calc);
END;
$$;

CREATE OR REPLACE FUNCTION get_cancellation_requests(
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
  SELECT COALESCE(jsonb_agg(row_to_json(cr.*)::jsonb ORDER BY cr.created_at DESC), '[]'::jsonb) INTO v_requests
  FROM cancellation_requests cr WHERE cr.lodge_id = p_lodge_id;
  RETURN jsonb_build_object('requests', v_requests);
END;
$$;

CREATE OR REPLACE FUNCTION approve_cancellation(
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
  v_request cancellation_requests%ROWTYPE;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  SELECT * INTO v_request FROM cancellation_requests WHERE id = p_request_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  UPDATE cancellation_requests SET status = 'approved', approved_by = p_approved_by, approved_at = now(), updated_at = now()
  WHERE id = p_request_id RETURNING booking_id INTO v_booking_id;

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'booking_id', v_booking_id);
END;
$$;

GRANT EXECUTE ON FUNCTION get_cancellation_policies(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_cancellation_policy(uuid, text, jsonb, int, text, numeric, text, boolean, boolean, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_cancellation_policy(uuid, uuid, text, jsonb, int, text, numeric, text, boolean, boolean, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_cancellation_policy(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION calculate_cancellation_fee(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_cancellation_request(uuid, uuid, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_cancellation_requests(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION approve_cancellation(uuid, uuid, uuid) TO authenticated, service_role;
