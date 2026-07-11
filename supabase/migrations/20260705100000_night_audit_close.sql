-- 20260705100000_night_audit_close.sql
-- Enterprise night audit: transactional close, exception handling, reopen with audit

CREATE TABLE IF NOT EXISTS night_audit_close (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  business_date date NOT NULL,
  closed_by uuid,
  closed_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'reopened')),
  exceptions jsonb DEFAULT '[]'::jsonb,
  notes text,
  audit_pack jsonb,
  previous_business_date date,
  next_business_date date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS night_audit_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_id uuid NOT NULL REFERENCES night_audit_close(id) ON DELETE CASCADE,
  exception_type text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE night_audit_close ENABLE ROW LEVEL SECURITY;
ALTER TABLE night_audit_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY night_audit_close_lodge_policy ON night_audit_close
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid);

CREATE POLICY night_audit_exceptions_lodge_policy ON night_audit_exceptions
  FOR ALL
  USING (close_id IN (SELECT id FROM night_audit_close WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid))
  WITH CHECK (close_id IN (SELECT id FROM night_audit_close WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid));

CREATE INDEX IF NOT EXISTS idx_night_audit_close_lodge ON night_audit_close(lodge_id);
CREATE INDEX IF NOT EXISTS idx_night_audit_close_business_date ON night_audit_close(business_date);
CREATE INDEX IF NOT EXISTS idx_night_audit_close_status ON night_audit_close(status);
CREATE INDEX IF NOT EXISTS idx_night_audit_exceptions_close ON night_audit_exceptions(close_id);

CREATE OR REPLACE FUNCTION run_night_audit_checks(
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_arrivals int;
  v_departures int;
  v_no_shows int;
  v_open_folios int;
  v_unpaid_balances numeric;
  v_dirty_rooms int;
  v_pending_moves int;
  v_exceptions jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  SELECT COUNT(*) INTO v_arrivals FROM bookings WHERE lodge_id = p_lodge_id AND check_in = v_today AND status NOT IN ('cancelled', 'no_show');
  SELECT COUNT(*) INTO v_departures FROM bookings WHERE lodge_id = p_lodge_id AND check_out = v_today AND status NOT IN ('cancelled', 'no_show', 'checked_out');
  SELECT COUNT(*) INTO v_no_shows FROM bookings WHERE lodge_id = p_lodge_id AND check_in = v_today AND status = 'no_show';
  SELECT COUNT(*) INTO v_open_folios FROM bookings WHERE lodge_id = p_lodge_id AND status = 'checked_in' AND check_in <= v_today AND check_out > v_today;
  SELECT COALESCE(SUM(COALESCE(total_amount,0) + COALESCE(charges_total,0) - COALESCE(amount_paid,0)), 0) INTO v_unpaid_balances FROM bookings WHERE lodge_id = p_lodge_id AND status = 'checked_in' AND check_in <= v_today AND check_out > v_today AND (COALESCE(total_amount,0) + COALESCE(charges_total,0) - COALESCE(amount_paid,0)) > 0;
  SELECT COUNT(*) INTO v_dirty_rooms FROM rooms WHERE lodge_id = p_lodge_id AND status = 'dirty';
  SELECT COUNT(*) INTO v_pending_moves FROM booking_room_moves WHERE lodge_id = p_lodge_id AND completed_at IS NULL;

  v_exceptions := '[]'::jsonb;

  IF v_unpaid_balances > 0 THEN
    v_exceptions := v_exceptions || jsonb_build_object('exception_type', 'unpaid_balances', 'description', 'Unpaid balances totalling ' || v_unpaid_balances::text, 'severity', 'warning');
  END IF;

  IF v_dirty_rooms > 0 THEN
    v_exceptions := v_exceptions || jsonb_build_object('exception_type', 'dirty_rooms', 'description', v_dirty_rooms::text || ' dirty rooms not cleaned', 'severity', 'warning');
  END IF;

  IF v_pending_moves > 0 THEN
    v_exceptions := v_exceptions || jsonb_build_object('exception_type', 'pending_room_moves', 'description', v_pending_moves::text || ' pending room moves', 'severity', 'info');
  END IF;

  RETURN jsonb_build_object(
    'date', v_today,
    'arrivals', v_arrivals,
    'departures', v_departures,
    'no_shows', v_no_shows,
    'open_folios', v_open_folios,
    'unpaid_balances', v_unpaid_balances,
    'dirty_rooms', v_dirty_rooms,
    'pending_room_moves', v_pending_moves,
    'exceptions', v_exceptions,
    'checks_passed', (v_exceptions = '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION close_night_audit(
  p_lodge_id uuid,
  p_closed_by uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_checks jsonb;
  v_close_id uuid;
  v_today date := CURRENT_DATE;
  v_prev_business_date date;
  v_next_business_date date;
  v_exception record;
  v_severity text;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  SELECT business_date INTO v_prev_business_date FROM night_audit_close WHERE lodge_id = p_lodge_id AND status = 'closed' ORDER BY business_date DESC LIMIT 1;

  v_next_business_date := v_today + 1;

  v_checks := run_night_audit_checks(p_lodge_id);

  v_close_id := gen_random_uuid();
  INSERT INTO night_audit_close (id, lodge_id, business_date, closed_by, status, exceptions, notes, audit_pack, previous_business_date, next_business_date)
  VALUES (v_close_id, p_lodge_id, v_today, p_closed_by, 'closed', v_checks->'exceptions', p_notes, v_checks, v_prev_business_date, v_next_business_date);

  IF jsonb_array_length(v_checks->'exceptions') > 0 THEN
    FOR v_exception IN SELECT * FROM jsonb_array_elements(v_checks->'exceptions') WITH ORDINALITY AS e(item, idx)
    LOOP
      INSERT INTO night_audit_exceptions (id, close_id, exception_type, description, severity)
      VALUES (gen_random_uuid(), v_close_id, v_exception.item->>'exception_type', v_exception.item->>'description', COALESCE(v_exception.item->>'severity', 'warning'));
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'close_id', v_close_id,
    'date', v_today,
    'checks', v_checks
  );
END;
$$;

CREATE OR REPLACE FUNCTION reopen_night_audit(
  p_close_id uuid,
  p_reopened_by uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lodge_id uuid;
  v_record night_audit_close%ROWTYPE;
BEGIN
  SELECT * INTO v_record FROM night_audit_close WHERE id = p_close_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Close record not found');
  END IF;

  PERFORM app_require_lodge_role(v_record.lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  UPDATE night_audit_close SET status = 'reopened', notes = COALESCE(notes, '') || E'\nReopened: ' || COALESCE(p_reason, 'No reason given') WHERE id = p_close_id;

  RETURN jsonb_build_object('success', true, 'close_id', p_close_id, 'previous_status', v_record.status);
END;
$$;

DROP FUNCTION IF EXISTS get_night_audit_summary(uuid, date) CASCADE;
CREATE OR REPLACE FUNCTION get_night_audit_summary(
  p_lodge_id uuid,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_close jsonb;
  v_stats jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist', 'finance']);

  SELECT row_to_json(nac.*)::jsonb INTO v_close FROM night_audit_close nac WHERE nac.lodge_id = p_lodge_id AND nac.business_date = p_date ORDER BY nac.created_at DESC LIMIT 1;

  SELECT jsonb_build_object(
    'open_folios', (SELECT COUNT(*) FROM bookings WHERE lodge_id = p_lodge_id AND status = 'checked_in' AND check_in <= p_date AND check_out > p_date),
    'outstanding_balance', (SELECT COALESCE(SUM(COALESCE(total_amount,0) + COALESCE(charges_total,0) - COALESCE(amount_paid,0)), 0) FROM bookings WHERE lodge_id = p_lodge_id AND status = 'checked_in' AND check_in <= p_date AND check_out > p_date),
    'arrivals_today', (SELECT COUNT(*) FROM bookings WHERE lodge_id = p_lodge_id AND check_in = p_date AND status NOT IN ('cancelled', 'no_show')),
    'departures_today', (SELECT COUNT(*) FROM bookings WHERE lodge_id = p_lodge_id AND check_out = p_date AND status NOT IN ('cancelled', 'no_show', 'checked_out')),
    'in_house', (SELECT COUNT(*) FROM bookings WHERE lodge_id = p_lodge_id AND status = 'checked_in' AND check_in <= p_date AND check_out > p_date)
  ) INTO v_stats;

  RETURN jsonb_build_object('close', v_close, 'stats', v_stats);
END;
$$;

CREATE OR REPLACE FUNCTION get_night_audit_history(
  p_lodge_id uuid,
  p_limit int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_closes jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  SELECT COALESCE(jsonb_agg(row_to_json(nac.*)::jsonb ORDER BY nac.business_date DESC), '[]'::jsonb)
  INTO v_closes
  FROM (SELECT * FROM night_audit_close WHERE lodge_id = p_lodge_id ORDER BY business_date DESC LIMIT p_limit) nac;

  RETURN jsonb_build_object('closes', v_closes, 'count', jsonb_array_length(v_closes));
END;
$$;

CREATE OR REPLACE FUNCTION resolve_exception(
  p_exception_id uuid,
  p_resolved_by uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_close_id uuid;
  v_lodge_id uuid;
BEGIN
  SELECT ne.close_id, nac.lodge_id INTO v_close_id, v_lodge_id
  FROM night_audit_exceptions ne
  JOIN night_audit_close nac ON nac.id = ne.close_id
  WHERE ne.id = p_exception_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Exception not found');
  END IF;

  PERFORM app_require_lodge_role(v_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  UPDATE night_audit_exceptions SET resolved = true, resolved_at = now(), resolved_by = p_resolved_by WHERE id = p_exception_id;

  RETURN jsonb_build_object('success', true, 'exception_id', p_exception_id);
END;
$$;

GRANT EXECUTE ON FUNCTION run_night_audit_checks(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION close_night_audit(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reopen_night_audit(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_night_audit_summary(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_night_audit_history(uuid, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION resolve_exception(uuid, uuid, text) TO authenticated, service_role;
