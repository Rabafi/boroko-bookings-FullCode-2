-- 20260705190000_yield_rules.sql
-- Yield management rules and occupancy-based dynamic pricing

CREATE TABLE IF NOT EXISTS yield_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES settings(lodge_id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  rule_type text NOT NULL CHECK (rule_type IN ('occupancy_based', 'seasonal_multiplier', 'advance_purchase', 'length_of_stay')),
  active boolean DEFAULT true,
  priority int DEFAULT 0,
  conditions jsonb DEFAULT '{}'::jsonb,
  action jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(lodge_id, name)
);

CREATE TABLE IF NOT EXISTS yield_rule_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES settings(lodge_id) ON DELETE CASCADE,
  yield_rule_id uuid NOT NULL REFERENCES yield_rules(id) ON DELETE CASCADE,
  date date NOT NULL,
  override_multiplier numeric(5,2) NOT NULL,
  reason text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  UNIQUE(yield_rule_id, date)
);

CREATE TABLE IF NOT EXISTS occupancy_forecast_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES settings(lodge_id) ON DELETE CASCADE,
  date date NOT NULL,
  projected_occupancy_pct numeric(5,2),
  projected_revenue numeric(12,2),
  cached_at timestamptz DEFAULT now(),
  UNIQUE(lodge_id, date)
);

ALTER TABLE yield_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE yield_rule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE occupancy_forecast_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY yield_rules_lodge_policy ON yield_rules
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY yield_rule_exceptions_lodge_policy ON yield_rule_exceptions
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY occupancy_forecast_cache_lodge_policy ON occupancy_forecast_cache
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_yield_rules_lodge ON yield_rules(lodge_id);
CREATE INDEX IF NOT EXISTS idx_yield_rules_active ON yield_rules(lodge_id, active);
CREATE INDEX IF NOT EXISTS idx_yield_rule_exceptions_lodge ON yield_rule_exceptions(lodge_id);
CREATE INDEX IF NOT EXISTS idx_yield_rule_exceptions_rule_date ON yield_rule_exceptions(yield_rule_id, date);
CREATE INDEX IF NOT EXISTS idx_occupancy_forecast_cache_lodge_date ON occupancy_forecast_cache(lodge_id, date);

-- ── Get Yield Rules ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_yield_rules(p_lodge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'receptionist']);

  SELECT COALESCE(jsonb_agg(row_to_json(yr.*)::jsonb ORDER BY yr.priority ASC), '[]'::jsonb)
  INTO v_result
  FROM yield_rules yr
  WHERE yr.lodge_id = p_lodge_id
    AND yr.active = true;

  RETURN v_result;
END;
$$;

-- ── Create Yield Rule ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_yield_rule(
  p_lodge_id uuid,
  p_name text,
  p_description text DEFAULT '',
  p_rule_type text DEFAULT 'occupancy_based',
  p_conditions jsonb DEFAULT '{}'::jsonb,
  p_action jsonb DEFAULT '{}'::jsonb,
  p_priority int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule_id uuid;
BEGIN
  IF p_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'lodge_id is required');
  END IF;

  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  v_rule_id := gen_random_uuid();

  INSERT INTO yield_rules (id, lodge_id, name, description, rule_type, conditions, action, priority)
  VALUES (v_rule_id, p_lodge_id, p_name, p_description, p_rule_type, p_conditions, p_action, p_priority);

  RETURN jsonb_build_object('success', true, 'id', v_rule_id);
END;
$$;

-- ── Update Yield Rule ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_yield_rule(
  p_id uuid,
  p_lodge_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_rule_type text DEFAULT NULL,
  p_conditions jsonb DEFAULT NULL,
  p_action jsonb DEFAULT NULL,
  p_priority int DEFAULT NULL,
  p_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_id IS NULL OR p_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'id and lodge_id are required');
  END IF;

  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  UPDATE yield_rules SET
    name        = COALESCE(p_name, name),
    description = COALESCE(p_description, description),
    rule_type   = COALESCE(p_rule_type, rule_type),
    conditions  = COALESCE(p_conditions, conditions),
    action      = COALESCE(p_action, action),
    priority    = COALESCE(p_priority, priority),
    active      = COALESCE(p_active, active),
    updated_at  = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Yield rule not found or belongs to another lodge');
  END IF;

  RETURN jsonb_build_object('success', true, 'id', p_id);
END;
$$;

-- ── Delete Yield Rule (soft delete) ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_yield_rule(
  p_id uuid,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_id IS NULL OR p_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'id and lodge_id are required');
  END IF;

  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  UPDATE yield_rules SET active = false, updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Yield rule not found or belongs to another lodge');
  END IF;

  RETURN jsonb_build_object('success', true, 'id', p_id);
END;
$$;

-- ── Get Applicable Yield Adjustment ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_applicable_yield_adjustment(
  p_lodge_id uuid,
  p_date date,
  p_current_occupancy_pct numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule record;
  v_exception numeric;
  v_conditions jsonb;
  v_min_occ numeric;
  v_max_occ numeric;
  v_days_of_week jsonb;
  v_min_days numeric;
  v_match boolean;
  v_day_of_week int;
  v_days_before int;
  v_multiplier numeric;
  v_adjustment_type text;
  v_adjustment_value numeric;
  v_best_multiplier numeric := 1.0;
  v_best_priority int := 999999;
  v_found boolean := false;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'receptionist']);

  v_day_of_week := EXTRACT(DOW FROM p_date);
  v_days_before := (p_date - CURRENT_DATE);

  FOR v_rule IN
    SELECT * FROM yield_rules
    WHERE lodge_id = p_lodge_id
      AND active = true
      AND rule_type = 'occupancy_based'
    ORDER BY priority ASC
  LOOP
    v_conditions := v_rule.conditions;
    v_match := true;

    -- Check min_occupancy_pct
    v_min_occ := (v_conditions ->> 'min_occupancy_pct')::numeric;
    IF v_min_occ IS NOT NULL AND p_current_occupancy_pct < v_min_occ THEN
      v_match := false;
    END IF;

    -- Check max_occupancy_pct
    v_max_occ := (v_conditions ->> 'max_occupancy_pct')::numeric;
    IF v_max_occ IS NOT NULL AND p_current_occupancy_pct > v_max_occ THEN
      v_match := false;
    END IF;

    -- Check days_of_week
    v_days_of_week := v_conditions -> 'days_of_week';
    IF v_days_of_week IS NOT NULL AND jsonb_array_length(v_days_of_week) > 0 THEN
      IF NOT v_days_of_week @> to_jsonb(v_day_of_week) THEN
        v_match := false;
      END IF;
    END IF;

    -- Check min_days_before_arrival
    v_min_days := (v_conditions ->> 'min_days_before_arrival')::numeric;
    IF v_min_days IS NOT NULL AND v_days_before < v_min_days THEN
      v_match := false;
    END IF;

    IF v_match THEN
      -- Check for date exception
      v_exception := NULL;
      SELECT override_multiplier INTO v_exception
      FROM yield_rule_exceptions
      WHERE yield_rule_id = v_rule.id AND date = p_date;

      IF v_exception IS NOT NULL THEN
        v_multiplier := v_exception;
      ELSE
        v_multiplier := (v_rule.action ->> 'multiplier')::numeric;
      END IF;

      IF v_multiplier IS NOT NULL AND v_rule.priority < v_best_priority THEN
        v_best_multiplier := v_multiplier;
        v_best_priority := v_rule.priority;
        v_found := true;
      END IF;
    END IF;
  END LOOP;

  IF NOT v_found THEN
    RETURN jsonb_build_object('adjusted', false, 'multiplier', 1.0);
  END IF;

  RETURN jsonb_build_object('adjusted', true, 'multiplier', v_best_multiplier);
END;
$$;

-- ── Calculate Occupancy-Based Rate ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION calculate_occupancy_based_rate(
  p_lodge_id uuid,
  p_base_rate numeric,
  p_date date,
  p_room_type_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room_count int;
  v_booked_rooms int;
  v_occupancy_pct numeric;
  v_adjustment jsonb;
  v_multiplier numeric;
  v_adjusted_rate numeric;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  -- Calculate current occupancy for the lodge
  SELECT COUNT(*) INTO v_room_count
  FROM rooms
  WHERE lodge_id = p_lodge_id
    AND (p_room_type_id IS NULL OR room_type_id = p_room_type_id)
    AND active = true;

  SELECT COUNT(DISTINCT b.room_id) INTO v_booked_rooms
  FROM bookings b
  JOIN rooms r ON r.id = b.room_id AND r.lodge_id = p_lodge_id
  WHERE b.lodge_id = p_lodge_id
    AND b.booking_status IN ('confirmed', 'checked_in')
    AND b.check_in <= p_date
    AND b.check_out > p_date
    AND (p_room_type_id IS NULL OR r.room_type_id = p_room_type_id);

  IF v_room_count = 0 THEN
    RETURN jsonb_build_object('rate', p_base_rate, 'occupancy_pct', 0, 'adjusted', false, 'note', 'no rooms');
  END IF;

  v_occupancy_pct := ROUND((v_booked_rooms::numeric / v_room_count::numeric) * 100, 1);

  v_adjustment := get_applicable_yield_adjustment(p_lodge_id, p_date, v_occupancy_pct);
  v_multiplier := (v_adjustment ->> 'multiplier')::numeric;

  v_adjusted_rate := ROUND(p_base_rate * v_multiplier, 2);

  RETURN jsonb_build_object(
    'rate', v_adjusted_rate,
    'base_rate', p_base_rate,
    'occupancy_pct', v_occupancy_pct,
    'adjusted', (v_adjustment ->> 'adjusted')::boolean,
    'multiplier', v_multiplier
  );
END;
$$;

-- ── Get Occupancy Forecast ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_occupancy_forecast(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'receptionist']);

  SELECT COALESCE(jsonb_agg(row_to_json(ofc.*)::jsonb ORDER BY ofc.date ASC), '[]'::jsonb)
  INTO v_result
  FROM occupancy_forecast_cache ofc
  WHERE ofc.lodge_id = p_lodge_id
    AND ofc.date >= p_start_date
    AND ofc.date <= p_end_date;

  RETURN jsonb_build_object('forecast', v_result);
END;
$$;

GRANT ALL ON TABLE yield_rules TO authenticated;
GRANT ALL ON TABLE yield_rule_exceptions TO authenticated;
GRANT ALL ON TABLE occupancy_forecast_cache TO authenticated;
GRANT ALL ON TABLE yield_rules TO service_role;
GRANT ALL ON TABLE yield_rule_exceptions TO service_role;
GRANT ALL ON TABLE occupancy_forecast_cache TO service_role;

GRANT EXECUTE ON FUNCTION get_yield_rules(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_yield_rules(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION create_yield_rule(uuid, text, text, text, jsonb, jsonb, int) TO authenticated;
GRANT EXECUTE ON FUNCTION create_yield_rule(uuid, text, text, text, jsonb, jsonb, int) TO service_role;
GRANT EXECUTE ON FUNCTION update_yield_rule(uuid, uuid, text, text, text, jsonb, jsonb, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION update_yield_rule(uuid, uuid, text, text, text, jsonb, jsonb, int, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION delete_yield_rule(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_yield_rule(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION get_applicable_yield_adjustment(uuid, date, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION get_applicable_yield_adjustment(uuid, date, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION calculate_occupancy_based_rate(uuid, numeric, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_occupancy_based_rate(uuid, numeric, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION get_occupancy_forecast(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION get_occupancy_forecast(uuid, date, date) TO service_role;
