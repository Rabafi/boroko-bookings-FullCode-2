-- 20260705110000_rate_calendar_advanced.sql
-- Rate calendar, restrictions, promo codes, and season labels

CREATE TABLE IF NOT EXISTS rate_calendar_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  room_type_id uuid REFERENCES room_types(id) ON DELETE CASCADE,
  rate_plan_id uuid REFERENCES rate_plans(id) ON DELETE CASCADE,
  date date NOT NULL,
  rate_amount numeric(12,2) DEFAULT 0,
  currency text DEFAULT 'BWP',
  is_override boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(lodge_id, room_type_id, rate_plan_id, date)
);

CREATE TABLE IF NOT EXISTS rate_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  room_type_id uuid REFERENCES room_types(id) ON DELETE CASCADE,
  date date NOT NULL,
  min_stay integer,
  max_stay integer,
  closed_to_arrival boolean DEFAULT false,
  closed_to_departure boolean DEFAULT false,
  stop_sell boolean DEFAULT false,
  UNIQUE(lodge_id, room_type_id, date)
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  code text NOT NULL,
  description text DEFAULT '',
  discount_type text NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
  discount_value numeric(12,2) NOT NULL DEFAULT 0,
  valid_from date,
  valid_to date,
  min_nights integer DEFAULT 1,
  max_discount_amount numeric(12,2),
  usage_limit integer,
  usage_count integer DEFAULT 0,
  applies_to_room_types jsonb DEFAULT '[]'::jsonb,
  active boolean DEFAULT true,
  UNIQUE(lodge_id, code)
);

CREATE TABLE IF NOT EXISTS season_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  name text NOT NULL,
  color text DEFAULT '#6366f1',
  start_date date NOT NULL,
  end_date date NOT NULL,
  UNIQUE(lodge_id, name),
  CHECK (end_date >= start_date)
);

ALTER TABLE rate_calendar_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY rate_calendar_entries_lodge_policy ON rate_calendar_entries
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY rate_restrictions_lodge_policy ON rate_restrictions
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY promo_codes_lodge_policy ON promo_codes
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY season_labels_lodge_policy ON season_labels
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_rate_calendar_entries_lodge ON rate_calendar_entries(lodge_id);
CREATE INDEX IF NOT EXISTS idx_rate_calendar_entries_date ON rate_calendar_entries(date);
CREATE INDEX IF NOT EXISTS idx_rate_calendar_entries_room_type ON rate_calendar_entries(room_type_id);
CREATE INDEX IF NOT EXISTS idx_rate_restrictions_lodge ON rate_restrictions(lodge_id);
CREATE INDEX IF NOT EXISTS idx_rate_restrictions_date ON rate_restrictions(date);
CREATE INDEX IF NOT EXISTS idx_promo_codes_lodge ON promo_codes(lodge_id);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_season_labels_lodge ON season_labels(lodge_id);

CREATE OR REPLACE FUNCTION set_rate_calendar_entry(
  p_lodge_id uuid,
  p_room_type_id uuid,
  p_date date,
  p_amount numeric,
  p_currency text DEFAULT 'BWP'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entry_id uuid;
  v_result jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  INSERT INTO rate_calendar_entries (lodge_id, room_type_id, date, rate_amount, currency, is_override)
  VALUES (p_lodge_id, p_room_type_id, p_date, p_amount, p_currency, true)
  ON CONFLICT (lodge_id, room_type_id, rate_plan_id, date)
  DO UPDATE SET rate_amount = EXCLUDED.rate_amount, currency = EXCLUDED.currency, is_override = true, updated_at = now()
  RETURNING id INTO v_entry_id;

  v_result := jsonb_build_object('success', true, 'id', v_entry_id);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION set_rate_calendar_bulk(
  p_lodge_id uuid,
  p_entries jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entry jsonb;
  v_count integer := 0;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO rate_calendar_entries (lodge_id, room_type_id, rate_plan_id, date, rate_amount, currency, is_override)
    VALUES (
      p_lodge_id,
      (v_entry ->> 'room_type_id')::uuid,
      (v_entry ->> 'rate_plan_id')::uuid,
      (v_entry ->> 'date')::date,
      COALESCE((v_entry ->> 'rate_amount')::numeric, 0),
      COALESCE(v_entry ->> 'currency', 'BWP'),
      true
    )
    ON CONFLICT (lodge_id, room_type_id, rate_plan_id, date)
    DO UPDATE SET rate_amount = EXCLUDED.rate_amount, currency = EXCLUDED.currency, is_override = true, updated_at = now();
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'count', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION get_rate_calendar(
  p_lodge_id uuid,
  p_room_type_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entries jsonb;
  v_restrictions jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'receptionist']);

  SELECT COALESCE(jsonb_agg(row_to_json(rce.*)::jsonb), '[]'::jsonb)
  INTO v_entries
  FROM rate_calendar_entries rce
  WHERE rce.lodge_id = p_lodge_id
    AND rce.room_type_id = p_room_type_id
    AND rce.date >= p_start_date
    AND rce.date <= p_end_date;

  SELECT COALESCE(jsonb_agg(row_to_json(rr.*)::jsonb), '[]'::jsonb)
  INTO v_restrictions
  FROM rate_restrictions rr
  WHERE rr.lodge_id = p_lodge_id
    AND rr.room_type_id = p_room_type_id
    AND rr.date >= p_start_date
    AND rr.date <= p_end_date;

  RETURN jsonb_build_object('entries', v_entries, 'restrictions', v_restrictions);
END;
$$;

CREATE OR REPLACE FUNCTION set_rate_restriction(
  p_lodge_id uuid,
  p_room_type_id uuid,
  p_date date,
  p_restrictions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  INSERT INTO rate_restrictions (lodge_id, room_type_id, date, min_stay, max_stay, closed_to_arrival, closed_to_departure, stop_sell)
  VALUES (
    p_lodge_id,
    p_room_type_id,
    p_date,
    (p_restrictions ->> 'min_stay')::integer,
    (p_restrictions ->> 'max_stay')::integer,
    COALESCE((p_restrictions ->> 'closed_to_arrival')::boolean, false),
    COALESCE((p_restrictions ->> 'closed_to_departure')::boolean, false),
    COALESCE((p_restrictions ->> 'stop_sell')::boolean, false)
  )
  ON CONFLICT (lodge_id, room_type_id, date)
  DO UPDATE SET
    min_stay = COALESCE(EXCLUDED.min_stay, rate_restrictions.min_stay),
    max_stay = COALESCE(EXCLUDED.max_stay, rate_restrictions.max_stay),
    closed_to_arrival = COALESCE(EXCLUDED.closed_to_arrival, rate_restrictions.closed_to_arrival),
    closed_to_departure = COALESCE(EXCLUDED.closed_to_departure, rate_restrictions.closed_to_departure),
    stop_sell = COALESCE(EXCLUDED.stop_sell, rate_restrictions.stop_sell);

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION get_applicable_rate(
  p_lodge_id uuid,
  p_room_type_id uuid,
  p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entry record;
  v_rate numeric;
  v_currency text;
  v_source text;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'receptionist']);

  -- 1. Check override entries first
  SELECT rate_amount, currency INTO v_rate, v_currency
  FROM rate_calendar_entries
  WHERE lodge_id = p_lodge_id
    AND room_type_id = p_room_type_id
    AND date = p_date
    AND is_override = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_source := 'override';
    RETURN jsonb_build_object('rate_amount', v_rate, 'currency', v_currency, 'source', v_source);
  END IF;

  -- 2. Check calendar entries (non-override)
  SELECT rate_amount, currency INTO v_rate, v_currency
  FROM rate_calendar_entries
  WHERE lodge_id = p_lodge_id
    AND room_type_id = p_room_type_id
    AND date = p_date
    AND is_override = false
  ORDER BY updated_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_source := 'calendar';
    RETURN jsonb_build_object('rate_amount', v_rate, 'currency', v_currency, 'source', v_source);
  END IF;

  -- 3. Fall back to rate plans
  SELECT rate_amount, currency INTO v_rate, v_currency
  FROM rate_plans
  WHERE lodge_id = p_lodge_id
    AND (room_type_id = p_room_type_id OR room_type_id IS NULL)
    AND status = 'active'
    AND (valid_from IS NULL OR valid_from <= p_date)
    AND (valid_to IS NULL OR valid_to >= p_date)
  ORDER BY room_type_id NULLS LAST, rate_amount ASC
  LIMIT 1;

  IF FOUND THEN
    v_source := 'rate_plan';
    RETURN jsonb_build_object('rate_amount', v_rate, 'currency', v_currency, 'source', v_source);
  END IF;

  RETURN jsonb_build_object('rate_amount', 0, 'currency', 'BWP', 'source', 'none');
END;
$$;

CREATE OR REPLACE FUNCTION get_rate_conflicts(
  p_lodge_id uuid,
  p_room_type_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_conflicts jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  WITH date_series AS (
    SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date AS dt
  ),
  multi_entries AS (
    SELECT ds.dt, COUNT(*) AS entry_count
    FROM date_series ds
    JOIN rate_calendar_entries rce ON rce.date = ds.dt
    WHERE rce.lodge_id = p_lodge_id
      AND rce.room_type_id = p_room_type_id
    GROUP BY ds.dt
    HAVING COUNT(*) > 1
  ),
  restriction_gaps AS (
    SELECT ds.dt
    FROM date_series ds
    LEFT JOIN rate_restrictions rr ON rr.date = ds.dt
      AND rr.lodge_id = p_lodge_id
      AND rr.room_type_id = p_room_type_id
    WHERE rr.id IS NULL
  )
  SELECT jsonb_build_object(
    'multiple_entries_per_day', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', dt, 'count', entry_count)) FROM multi_entries), '[]'::jsonb),
    'days_without_restrictions', COALESCE((SELECT jsonb_agg(dt::text) FROM restriction_gaps), '[]'::jsonb)
  ) INTO v_conflicts;

  RETURN v_conflicts;
END;
$$;

-- Promo code CRUD

CREATE OR REPLACE FUNCTION create_promo_code(p_lodge_id uuid, p_code jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  v_id := gen_random_uuid();
  INSERT INTO promo_codes (id, lodge_id, code, description, discount_type, discount_value, valid_from, valid_to, min_nights, max_discount_amount, usage_limit, applies_to_room_types, active)
  VALUES (
    v_id,
    p_lodge_id,
    p_code ->> 'code',
    COALESCE(p_code ->> 'description', ''),
    p_code ->> 'discount_type',
    COALESCE((p_code ->> 'discount_value')::numeric, 0),
    (p_code ->> 'valid_from')::date,
    (p_code ->> 'valid_to')::date,
    COALESCE((p_code ->> 'min_nights')::integer, 1),
    (p_code ->> 'max_discount_amount')::numeric,
    (p_code ->> 'usage_limit')::integer,
    COALESCE(p_code -> 'applies_to_room_types', '[]'::jsonb),
    COALESCE((p_code ->> 'active')::boolean, true)
  );

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION update_promo_code(p_id uuid, p_lodge_id uuid, p_code jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  UPDATE promo_codes SET
    code = COALESCE(p_code ->> 'code', code),
    description = COALESCE(p_code ->> 'description', description),
    discount_type = COALESCE(p_code ->> 'discount_type', discount_type),
    discount_value = COALESCE((p_code ->> 'discount_value')::numeric, discount_value),
    valid_from = COALESCE((p_code ->> 'valid_from')::date, valid_from),
    valid_to = COALESCE((p_code ->> 'valid_to')::date, valid_to),
    min_nights = COALESCE((p_code ->> 'min_nights')::integer, min_nights),
    max_discount_amount = (p_code ->> 'max_discount_amount')::numeric,
    usage_limit = (p_code ->> 'usage_limit')::integer,
    applies_to_room_types = COALESCE(p_code -> 'applies_to_room_types', applies_to_room_types),
    active = COALESCE((p_code ->> 'active')::boolean, active)
  WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Promo code not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION delete_promo_code(p_id uuid, p_lodge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  DELETE FROM promo_codes WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Promo code not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION validate_promo_code(
  p_lodge_id uuid,
  p_code text,
  p_room_type_id uuid DEFAULT NULL,
  p_nights integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_promo record;
  v_today date := CURRENT_DATE;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'receptionist']);

  SELECT * INTO v_promo
  FROM promo_codes
  WHERE lodge_id = p_lodge_id
    AND code = p_code
    AND active = true
    AND (valid_from IS NULL OR valid_from <= v_today)
    AND (valid_to IS NULL OR valid_to >= v_today)
    AND (usage_limit IS NULL OR usage_count < usage_limit);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Promo code is invalid, expired, or has reached its usage limit');
  END IF;

  IF p_nights < v_promo.min_nights THEN
    RETURN jsonb_build_object('valid', false, 'error', format('Minimum %s night(s) required for this promo code', v_promo.min_nights));
  END IF;

  IF p_room_type_id IS NOT NULL AND jsonb_typeof(v_promo.applies_to_room_types) = 'array' AND jsonb_array_length(v_promo.applies_to_room_types) > 0 THEN
    IF NOT (v_promo.applies_to_room_types @> to_jsonb(p_room_type_id::text)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Promo code does not apply to this room type');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'promo', row_to_json(v_promo)::jsonb,
    'discount_type', v_promo.discount_type,
    'discount_value', v_promo.discount_value,
    'max_discount_amount', v_promo.max_discount_amount
  );
END;
$$;

-- Season label CRUD

CREATE OR REPLACE FUNCTION create_season_label(p_lodge_id uuid, p_season jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  v_id := gen_random_uuid();
  INSERT INTO season_labels (id, lodge_id, name, color, start_date, end_date)
  VALUES (
    v_id,
    p_lodge_id,
    p_season ->> 'name',
    COALESCE(p_season ->> 'color', '#6366f1'),
    (p_season ->> 'start_date')::date,
    (p_season ->> 'end_date')::date
  );

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION update_season_label(p_id uuid, p_lodge_id uuid, p_season jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  UPDATE season_labels SET
    name = COALESCE(p_season ->> 'name', name),
    color = COALESCE(p_season ->> 'color', color),
    start_date = COALESCE((p_season ->> 'start_date')::date, start_date),
    end_date = COALESCE((p_season ->> 'end_date')::date, end_date)
  WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season label not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION delete_season_label(p_id uuid, p_lodge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  DELETE FROM season_labels WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Season label not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION set_rate_calendar_entry(uuid, uuid, date, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_rate_calendar_bulk(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_rate_calendar(uuid, uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION set_rate_restriction(uuid, uuid, date, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_applicable_rate(uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_rate_conflicts(uuid, uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_promo_code(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_promo_code(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_promo_code(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION validate_promo_code(uuid, text, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_season_label(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_season_label(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_season_label(uuid, uuid) TO authenticated, service_role;
