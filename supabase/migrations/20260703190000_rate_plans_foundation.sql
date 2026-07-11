-- 20260703190000_rate_plans_foundation.sql
-- Rate plans table for seasonal, corporate, and package rates

CREATE TABLE IF NOT EXISTS rate_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  room_type_id uuid,
  rate_amount numeric DEFAULT 0,
  rate_type text DEFAULT 'per_night',
  currency text DEFAULT 'P',
  valid_from date,
  valid_to date,
  min_stay integer DEFAULT 1,
  max_stay integer,
  days_of_week jsonb DEFAULT '["mon","tue","wed","thu","fri","sat","sun"]'::jsonb,
  corporate_account_id uuid,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE rate_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY rate_plans_lodge_policy ON rate_plans
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_rate_plans_lodge ON rate_plans(lodge_id);

CREATE OR REPLACE FUNCTION create_rate_plan(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lodge_id uuid;
  v_id uuid;
  v_result jsonb;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;
  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lodge ID is required');
  END IF;

  PERFORM app_require_lodge_role(v_lodge_id, ARRAY['manager', 'admin']);

  v_id := gen_random_uuid();
  INSERT INTO rate_plans (id, lodge_id, name, description, room_type_id, rate_amount, rate_type, currency, valid_from, valid_to, min_stay, max_stay, days_of_week, corporate_account_id, status)
  VALUES (
    v_id,
    v_lodge_id,
    payload ->> 'name',
    COALESCE(payload ->> 'description', ''),
    (payload ->> 'room_type_id')::uuid,
    COALESCE((payload ->> 'rate_amount')::numeric, 0),
    COALESCE(payload ->> 'rate_type', 'per_night'),
    COALESCE(payload ->> 'currency', 'P'),
    (payload ->> 'valid_from')::date,
    (payload ->> 'valid_to')::date,
    COALESCE((payload ->> 'min_stay')::integer, 1),
    (payload ->> 'max_stay')::integer,
    COALESCE(payload -> 'days_of_week', '["mon","tue","wed","thu","fri","sat","sun"]'::jsonb),
    (payload ->> 'corporate_account_id')::uuid,
    COALESCE(payload ->> 'status', 'active')
  );

  v_result := jsonb_build_object('success', true, 'id', v_id);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION update_rate_plan(p_id uuid, p_lodge_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  UPDATE rate_plans SET
    name = COALESCE(payload ->> 'name', name),
    description = COALESCE(payload ->> 'description', description),
    room_type_id = COALESCE((payload ->> 'room_type_id')::uuid, room_type_id),
    rate_amount = COALESCE((payload ->> 'rate_amount')::numeric, rate_amount),
    rate_type = COALESCE(payload ->> 'rate_type', rate_type),
    valid_from = COALESCE((payload ->> 'valid_from')::date, valid_from),
    valid_to = COALESCE((payload ->> 'valid_to')::date, valid_to),
    min_stay = COALESCE((payload ->> 'min_stay')::integer, min_stay),
    max_stay = COALESCE((payload ->> 'max_stay')::integer, max_stay),
    days_of_week = COALESCE(payload -> 'days_of_week', days_of_week),
    corporate_account_id = COALESCE((payload ->> 'corporate_account_id')::uuid, corporate_account_id),
    status = COALESCE(payload ->> 'status', status),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rate plan not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION delete_rate_plan(p_id uuid, p_lodge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  DELETE FROM rate_plans WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rate plan not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION create_rate_plan(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_rate_plan(uuid, uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_rate_plan(uuid, uuid) TO anon, authenticated, service_role;
