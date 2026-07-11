-- 20260705130000_revenue_manager_addon.sql
-- Revenue manager: forecasts, competitor notes, demand events, recommendations

CREATE TABLE IF NOT EXISTS revenue_forecast_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  date date NOT NULL,
  forecast_occupancy_pct numeric,
  forecast_adr numeric,
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competitor_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  competitor_name text NOT NULL,
  room_type_id uuid REFERENCES room_types(id) ON DELETE CASCADE,
  noted_rate numeric(12,2),
  notes text,
  noted_at timestamptz DEFAULT now(),
  noted_by uuid
);

CREATE TABLE IF NOT EXISTS demand_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  event_name text NOT NULL,
  event_date date NOT NULL,
  expected_impact text,
  notes text
);

ALTER TABLE revenue_forecast_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY revenue_forecast_entries_lodge_policy ON revenue_forecast_entries
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY competitor_notes_lodge_policy ON competitor_notes
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY demand_events_lodge_policy ON demand_events
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_revenue_forecast_lodge ON revenue_forecast_entries(lodge_id);
CREATE INDEX IF NOT EXISTS idx_revenue_forecast_date ON revenue_forecast_entries(date);
CREATE INDEX IF NOT EXISTS idx_competitor_notes_lodge ON competitor_notes(lodge_id);
CREATE INDEX IF NOT EXISTS idx_demand_events_lodge ON demand_events(lodge_id);

CREATE OR REPLACE FUNCTION get_revenue_forecast(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entries jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT COALESCE(jsonb_agg(row_to_json(rfe.*)::jsonb ORDER BY rfe.date), '[]'::jsonb)
  INTO v_entries
  FROM revenue_forecast_entries rfe
  WHERE rfe.lodge_id = p_lodge_id
    AND rfe.date >= p_start_date
    AND rfe.date <= p_end_date;

  RETURN jsonb_build_object('entries', v_entries);
END;
$$;

CREATE OR REPLACE FUNCTION upsert_forecast_entry(
  p_lodge_id uuid,
  p_date date,
  p_forecast_occupancy_pct numeric,
  p_forecast_adr numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  INSERT INTO revenue_forecast_entries (lodge_id, date, forecast_occupancy_pct, forecast_adr, notes, created_by)
  VALUES (p_lodge_id, p_date, p_forecast_occupancy_pct, p_forecast_adr, p_notes, (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    UPDATE revenue_forecast_entries SET
      forecast_occupancy_pct = COALESCE(p_forecast_occupancy_pct, forecast_occupancy_pct),
      forecast_adr = COALESCE(p_forecast_adr, forecast_adr),
      notes = COALESCE(p_notes, notes)
    WHERE lodge_id = p_lodge_id AND date = p_date
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION get_competitor_notes(
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_notes jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT COALESCE(jsonb_agg(row_to_json(cn.*)::jsonb ORDER BY cn.noted_at DESC), '[]'::jsonb)
  INTO v_notes
  FROM competitor_notes cn
  WHERE cn.lodge_id = p_lodge_id;

  RETURN jsonb_build_object('notes', v_notes);
END;
$$;

CREATE OR REPLACE FUNCTION create_competitor_note(
  p_lodge_id uuid,
  p_competitor_name text,
  p_room_type_id uuid,
  p_noted_rate numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  v_id := gen_random_uuid();
  INSERT INTO competitor_notes (id, lodge_id, competitor_name, room_type_id, noted_rate, notes, noted_by)
  VALUES (v_id, p_lodge_id, p_competitor_name, p_room_type_id, p_noted_rate, p_notes, (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid);

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION get_demand_events(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_events jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT COALESCE(jsonb_agg(row_to_json(de.*)::jsonb ORDER BY de.event_date), '[]'::jsonb)
  INTO v_events
  FROM demand_events de
  WHERE de.lodge_id = p_lodge_id
    AND de.event_date >= p_start_date
    AND de.event_date <= p_end_date;

  RETURN jsonb_build_object('events', v_events);
END;
$$;

CREATE OR REPLACE FUNCTION create_demand_event(
  p_lodge_id uuid,
  p_event_name text,
  p_event_date date,
  p_expected_impact text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  v_id := gen_random_uuid();
  INSERT INTO demand_events (id, lodge_id, event_name, event_date, expected_impact, notes)
  VALUES (v_id, p_lodge_id, p_event_name, p_event_date, p_expected_impact, p_notes);

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION get_revenue_recommendations(
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recommendations jsonb;
  v_today date := CURRENT_DATE;
  v_occupancy_pct numeric;
  v_booked_rooms integer;
  v_total_rooms integer;
  v_avg_rate numeric;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT COUNT(*) INTO v_total_rooms FROM rooms WHERE lodge_id = p_lodge_id AND status != 'maintenance';

  SELECT COUNT(*) INTO v_booked_rooms
  FROM bookings
  WHERE lodge_id = p_lodge_id
    AND status NOT IN ('cancelled', 'pending')
    AND check_in <= v_today
    AND check_out > v_today;

  v_occupancy_pct := CASE WHEN v_total_rooms > 0 THEN round((v_booked_rooms::numeric / v_total_rooms) * 100) ELSE 0 END;

  SELECT COALESCE(AVG(total_amount / GREATEST(1, (check_out::date - check_in::date))), 0) INTO v_avg_rate
  FROM bookings
  WHERE lodge_id = p_lodge_id
    AND status NOT IN ('cancelled', 'pending')
    AND check_in >= v_today - 30
    AND check_in <= v_today;

  WITH recommendations AS (
    SELECT 'Increase rates' AS action, 'Occupancy above 80% suggests rate increase potential' AS reason, 80 AS trigger_threshold, v_occupancy_pct AS current_value
    WHERE v_occupancy_pct >= 80
    UNION ALL
    SELECT 'Monitor demand', 'Occupancy between 60-80% is healthy' AS reason, 60, v_occupancy_pct
    WHERE v_occupancy_pct >= 60 AND v_occupancy_pct < 80
    UNION ALL
    SELECT 'Consider promotions', 'Occupancy below 60% may benefit from promotional rates' AS reason, 60, v_occupancy_pct
    WHERE v_occupancy_pct < 60
  )
  SELECT jsonb_build_object(
    'recommendations', COALESCE((SELECT jsonb_agg(row_to_json(r.*)::jsonb) FROM recommendations r), '[]'::jsonb),
    'current_occupancy', v_occupancy_pct,
    'current_adr', round(v_avg_rate, 2),
    'total_rooms', v_total_rooms,
    'booked_rooms', v_booked_rooms
  ) INTO v_recommendations;

  RETURN v_recommendations;
END;
$$;

GRANT EXECUTE ON FUNCTION get_revenue_forecast(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION upsert_forecast_entry(uuid, date, numeric, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_competitor_notes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_competitor_note(uuid, text, uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_demand_events(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_demand_event(uuid, text, date, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_revenue_recommendations(uuid) TO authenticated, service_role;
