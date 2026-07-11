-- ── Operations Compliance Add-ons (Full Operations) ─────────────────────────
-- Linen Stocktake, Lost & Found Claim, Incident Resolve, Visitor Dashboard,
-- Emergency List, Shift Handover

-- ── Shift Handover ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shift_handover_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  shift_date date NOT NULL DEFAULT current_date,
  shift_type text NOT NULL CHECK (shift_type IN ('morning', 'evening', 'night')),
  outgoing_staff_id uuid REFERENCES auth.users(id),
  incoming_staff_id uuid REFERENCES auth.users(id),
  notes text,
  pending_issues jsonb DEFAULT '[]'::jsonb,
  handover_completed boolean DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shift_handover_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY shift_handover_logs_lodge_policy ON public.shift_handover_logs
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT, INSERT, UPDATE ON public.shift_handover_logs TO authenticated;

CREATE INDEX IF NOT EXISTS idx_shift_handover_date ON public.shift_handover_logs(lodge_id, shift_date);

-- ── Linen & Laundry Enhanced RPCs ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_linen_stocktake(p_lodge_id uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    UPDATE public.linen_items SET
      total_quantity = COALESCE((v_item->>'total_quantity')::int, total_quantity),
      in_use_quantity = COALESCE((v_item->>'in_use_quantity')::int, in_use_quantity),
      dirty_quantity = COALESCE((v_item->>'dirty_quantity')::int, dirty_quantity),
      damaged_quantity = COALESCE((v_item->>'damaged_quantity')::int, damaged_quantity),
      updated_at = now()
    WHERE id = (v_item->>'id')::uuid AND lodge_id = p_lodge_id;
  END LOOP;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_linen_stocktake(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_linen_dashboard(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  SELECT jsonb_build_object(
    'total_items', COALESCE(sum(total_quantity), 0),
    'in_laundry', COALESCE(sum(dirty_quantity), 0),
    'damaged', COALESCE(sum(damaged_quantity), 0),
    'missing', GREATEST(0, COALESCE(sum(total_quantity), 0) - COALESCE(sum(in_use_quantity), 0) - COALESCE(sum(dirty_quantity), 0) - COALESCE(sum(damaged_quantity), 0)),
    'item_count', count(*)
  ) INTO v_result FROM public.linen_items WHERE lodge_id = p_lodge_id;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_linen_dashboard(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.report_damaged_linen(p_item_id uuid, p_lodge_id uuid, p_quantity int, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  UPDATE public.linen_items SET
    damaged_quantity = damaged_quantity + p_quantity,
    in_use_quantity = GREATEST(0, in_use_quantity - p_quantity),
    updated_at = now()
  WHERE id = p_item_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.report_damaged_linen(uuid, uuid, int, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.charge_damaged_linen_to_booking(p_lodge_id uuid, p_booking_id uuid, p_linen_item_id uuid, p_quantity int, p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_charge_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  v_charge_id := gen_random_uuid();
  INSERT INTO public.booking_charges (id, booking_id, lodge_id, description, quantity, unit_price, total_amount, charge_type, created_by)
  VALUES (v_charge_id, p_booking_id, p_lodge_id,
    'Damaged linen charge (item ' || p_linen_item_id::text || ' x' || p_quantity || ')',
    p_quantity, p_amount, p_amount * p_quantity, 'linen_damage', auth.uid());
  RETURN jsonb_build_object('success', true, 'charge_id', v_charge_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.charge_damaged_linen_to_booking(uuid, uuid, uuid, int, numeric) TO authenticated;

-- ── Lost & Found Enhanced RPCs ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_lost_found_item(p_item_id uuid, p_lodge_id uuid, p_claimer_name text, p_claimer_contact text, p_disposition text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  UPDATE public.lost_found_items SET
    status = p_disposition,
    claimed_by = p_claimer_name,
    claimed_at = now(),
    notes = COALESCE(notes || E'\n' || 'Claimed by: ' || p_claimer_name || ' (' || p_claimer_contact || ')', 'Claimed by: ' || p_claimer_name || ' (' || p_claimer_contact || ')'),
    updated_at = now()
  WHERE id = p_item_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.claim_lost_found_item(uuid, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_lost_found_dashboard(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  WITH stats AS (
    SELECT
      count(*) FILTER (WHERE status = 'found') AS open_items,
      count(*) FILTER (WHERE status IN ('claimed', 'returned', 'disposed', 'donated')) AS closed_items,
      count(*) FILTER (WHERE status = 'found' AND created_at < now() - interval '30 days') AS aging_over_30_days
    FROM public.lost_found_items WHERE lodge_id = p_lodge_id
  )
  SELECT jsonb_build_object(
    'open_items', stats.open_items,
    'closed_items', stats.closed_items,
    'aging_over_30_days', stats.aging_over_30_days,
    'total_items', stats.open_items + stats.closed_items
  ) INTO v_result FROM stats;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_lost_found_dashboard(uuid) TO authenticated;

-- ── Incident Log Enhanced RPCs ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_incident(p_id uuid, p_lodge_id uuid, p_resolution text, p_resolved_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  UPDATE public.incident_logs SET
    resolved = true,
    resolved_at = now(),
    resolved_by = p_resolved_by,
    follow_up_notes = COALESCE(p_resolution, follow_up_notes),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.resolve_incident(uuid, uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_incident_dashboard(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  WITH stats AS (
    SELECT
      count(*) FILTER (WHERE resolved = false) AS open_incidents,
      count(*) FILTER (WHERE resolved = false AND severity = 'critical') AS critical_open,
      count(*) FILTER (WHERE resolved = false AND severity = 'high') AS high_open,
      count(*) FILTER (WHERE resolved = false AND severity = 'medium') AS medium_open,
      count(*) FILTER (WHERE resolved = false AND severity = 'low') AS low_open,
      count(*) FILTER (WHERE resolved = true) AS resolved_count
    FROM public.incident_logs WHERE lodge_id = p_lodge_id
  )
  SELECT jsonb_build_object(
    'open_incidents', stats.open_incidents,
    'critical_open', stats.critical_open,
    'high_open', stats.high_open,
    'medium_open', stats.medium_open,
    'low_open', stats.low_open,
    'resolved_count', stats.resolved_count,
    'total_incidents', stats.open_incidents + stats.resolved_count
  ) INTO v_result FROM stats;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_incident_dashboard(uuid) TO authenticated;

-- ── Visitor Register Enhanced RPCs ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_visitor_dashboard(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  WITH stats AS (
    SELECT
      count(*) FILTER (WHERE check_out_time IS NULL) AS active_visitors,
      count(*) FILTER (WHERE check_out_time IS NOT NULL) AS checked_out,
      count(*) FILTER (WHERE check_in_time::date = current_date) AS today_visitors
    FROM public.visitor_registrations WHERE lodge_id = p_lodge_id
  )
  SELECT jsonb_build_object(
    'active_visitors', stats.active_visitors,
    'checked_out', stats.checked_out,
    'today_visitors', stats.today_visitors,
    'total_visitors', stats.active_visitors + stats.checked_out
  ) INTO v_result FROM stats;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_visitor_dashboard(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_visitor_history(p_lodge_id uuid, p_start_date date, p_end_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.check_in_time DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.visitor_registrations WHERE lodge_id = p_lodge_id AND check_in_time::date BETWEEN p_start_date AND p_end_date) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_visitor_history(uuid, date, date) TO authenticated;

-- ── Emergency List Enhanced RPCs ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_evacuation_list(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.room_number ASC, t.name ASC), '[]'::jsonb)
    FROM (SELECT * FROM public.emergency_list WHERE lodge_id = p_lodge_id) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_evacuation_list(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.export_evacuation_report(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_report jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  SELECT jsonb_build_object(
    'generated_at', now(),
    'lodge_id', p_lodge_id,
    'total_persons', count(*),
    'guests', count(*) FILTER (WHERE person_type = 'guest'),
    'visitors', count(*) FILTER (WHERE person_type = 'visitor'),
    'evacuation_list', jsonb_agg(to_jsonb(t) ORDER BY t.room_number ASC, t.name ASC)
  ) INTO v_report
  FROM (SELECT * FROM public.emergency_list WHERE lodge_id = p_lodge_id) t;
  RETURN v_report;
END; $$;
GRANT EXECUTE ON FUNCTION public.export_evacuation_report(uuid) TO authenticated;

-- ── Shift Handover RPCs ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_shift_handover(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  v_id := gen_random_uuid();
  INSERT INTO public.shift_handover_logs (id, lodge_id, shift_date, shift_type, outgoing_staff_id, incoming_staff_id, notes, pending_issues)
  VALUES (v_id, p_lodge_id, COALESCE((p_payload->>'shift_date')::date, current_date),
    p_payload->>'shift_type',
    nullif(p_payload->>'outgoing_staff_id', '')::uuid,
    nullif(p_payload->>'incoming_staff_id', '')::uuid,
    p_payload->>'notes',
    COALESCE(p_payload->>'pending_issues', '[]'::jsonb));
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_shift_handover(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_shift_handover(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  UPDATE public.shift_handover_logs SET handover_completed = true, completed_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_shift_handover(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_shift_handover_history(p_lodge_id uuid, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.shift_date DESC, t.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT sh.*, u1.name AS outgoing_name, u2.name AS incoming_name
      FROM public.shift_handover_logs sh
      LEFT JOIN auth.users u1 ON u1.id = sh.outgoing_staff_id
      LEFT JOIN auth.users u2 ON u2.id = sh.incoming_staff_id
      WHERE sh.lodge_id = p_lodge_id
      ORDER BY sh.created_at DESC
      LIMIT p_limit
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_shift_handover_history(uuid, int) TO authenticated;
