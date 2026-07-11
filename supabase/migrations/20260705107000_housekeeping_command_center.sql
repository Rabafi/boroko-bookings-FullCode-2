-- ── Housekeeping Command Center ─────────────────────────────────────────────
-- Assignments, Inspections, Turnaround Tracking, Checklist

CREATE TABLE IF NOT EXISTS public.housekeeping_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES auth.users(id),
  assignment_date date NOT NULL DEFAULT current_date,
  shift text NOT NULL DEFAULT 'morning' CHECK (shift IN ('morning', 'evening', 'night')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.housekeeping_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY housekeeping_assignments_lodge_policy ON public.housekeeping_assignments
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.housekeeping_assignments TO authenticated;

CREATE INDEX IF NOT EXISTS idx_hk_assignments_lodge_date ON public.housekeeping_assignments(lodge_id, assignment_date);
CREATE INDEX IF NOT EXISTS idx_hk_assignments_room ON public.housekeeping_assignments(room_id);

CREATE TABLE IF NOT EXISTS public.housekeeping_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  inspected_by uuid REFERENCES auth.users(id),
  inspection_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('passed', 'failed', 'pending')),
  checklist_results jsonb DEFAULT '[]'::jsonb,
  failed_items text[] DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.housekeeping_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY housekeeping_inspections_lodge_policy ON public.housekeeping_inspections
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.housekeeping_inspections TO authenticated;

CREATE INDEX IF NOT EXISTS idx_hk_inspections_lodge_date ON public.housekeeping_inspections(lodge_id, inspection_date);

CREATE TABLE IF NOT EXISTS public.housekeeping_inspection_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  item_name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  is_required boolean DEFAULT true,
  sort_order int DEFAULT 0,
  active boolean DEFAULT true
);

ALTER TABLE public.housekeeping_inspection_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY hk_checklist_items_lodge_policy ON public.housekeeping_inspection_checklist_items
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.housekeeping_inspection_checklist_items TO authenticated;

CREATE TABLE IF NOT EXISTS public.turnaround_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'dirty' CHECK (status IN ('dirty', 'in_progress', 'clean', 'inspected')),
  dirty_at timestamptz,
  cleaning_started_at timestamptz,
  cleaning_completed_at timestamptz,
  ready_at timestamptz,
  assigned_to uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.turnaround_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY turnaround_tracking_lodge_policy ON public.turnaround_tracking
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.turnaround_tracking TO authenticated;

CREATE INDEX IF NOT EXISTS idx_turnaround_lodge_status ON public.turnaround_tracking(lodge_id, status);
CREATE INDEX IF NOT EXISTS idx_turnaround_room ON public.turnaround_tracking(room_id);

-- ── RPCs ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_housekeeping_assignment(p_lodge_id uuid, p_room_id uuid, p_assigned_to uuid, p_assignment_date date, p_shift text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'operations']);
  v_id := gen_random_uuid();
  INSERT INTO public.housekeeping_assignments (id, lodge_id, room_id, assigned_to, assignment_date, shift)
  VALUES (v_id, p_lodge_id, p_room_id, p_assigned_to, p_assignment_date, p_shift);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_housekeeping_assignment(uuid, uuid, uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_housekeeping_assignment_status(p_id uuid, p_lodge_id uuid, p_status text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'operations']);
  UPDATE public.housekeeping_assignments SET
    status = p_status,
    notes = COALESCE(p_notes, notes),
    started_at = CASE WHEN p_status = 'in_progress' AND started_at IS NULL THEN now() ELSE started_at END,
    completed_at = CASE WHEN p_status IN ('completed', 'skipped') THEN now() ELSE completed_at END
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_housekeeping_assignment_status(uuid, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_turnaround(p_booking_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_room_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'operations', 'receptionist']);
  SELECT room_id INTO v_room_id FROM public.bookings WHERE id = p_booking_id AND lodge_id = p_lodge_id;
  IF v_room_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Booking not found'); END IF;
  v_id := gen_random_uuid();
  INSERT INTO public.turnaround_tracking (id, lodge_id, room_id, booking_id, status, dirty_at)
  VALUES (v_id, p_lodge_id, v_room_id, p_booking_id, 'dirty', now());
  UPDATE public.rooms SET housekeeping_status = 'dirty' WHERE id = v_room_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.start_turnaround(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_turnaround(p_turnaround_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'operations']);
  SELECT room_id INTO v_room_id FROM public.turnaround_tracking WHERE id = p_turnaround_id AND lodge_id = p_lodge_id;
  IF v_room_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Turnaround not found'); END IF;
  UPDATE public.turnaround_tracking SET status = 'clean', cleaning_completed_at = now(), ready_at = now()
  WHERE id = p_turnaround_id AND lodge_id = p_lodge_id;
  UPDATE public.rooms SET housekeeping_status = 'clean' WHERE id = v_room_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_turnaround(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_housekeeping_inspection(p_lodge_id uuid, p_room_id uuid, p_inspected_by uuid, p_checklist_results jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_failed_items text[]; v_status text;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  SELECT ARRAY(
    SELECT item->>'item' FROM jsonb_array_elements(p_checklist_results) AS item WHERE (item->>'passed')::boolean = false
  ) INTO v_failed_items;
  v_status := CASE WHEN array_length(v_failed_items, 1) > 0 THEN 'failed' ELSE 'passed' END;
  v_id := gen_random_uuid();
  INSERT INTO public.housekeeping_inspections (id, lodge_id, room_id, inspected_by, inspection_date, status, checklist_results, failed_items, completed_at)
  VALUES (v_id, p_lodge_id, p_room_id, p_inspected_by, current_date, v_status, p_checklist_results, v_failed_items, now());
  UPDATE public.turnaround_tracking SET status = 'inspected' WHERE room_id = p_room_id AND lodge_id = p_lodge_id AND status = 'clean';
  RETURN jsonb_build_object('success', true, 'id', v_id, 'status', v_status);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_housekeeping_inspection(uuid, uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_housekeeping_dashboard(p_lodge_id uuid, p_date date DEFAULT current_date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['receptionist', 'manager', 'admin', 'super_admin', 'operations']);
  WITH room_status AS (
    SELECT
      COALESCE(count(*) FILTER (WHERE housekeeping_status = 'dirty'), 0) AS dirty_rooms,
      COALESCE(count(*) FILTER (WHERE housekeeping_status = 'clean'), 0) AS clean_rooms,
      COALESCE(count(*) FILTER (WHERE housekeeping_status IS NULL OR housekeeping_status = 'available'), 0) AS available_rooms
    FROM public.rooms WHERE lodge_id = p_lodge_id
  ),
  assignments AS (
    SELECT jsonb_agg(to_jsonb(t)) AS items FROM (
      SELECT ha.*, r.room_number, u.name AS assigned_name
      FROM public.housekeeping_assignments ha
      LEFT JOIN public.rooms r ON r.id = ha.room_id
      LEFT JOIN auth.users u ON u.id = ha.assigned_to
      WHERE ha.lodge_id = p_lodge_id AND ha.assignment_date = p_date
      ORDER BY ha.created_at DESC
    ) t
  ),
  inspections AS (
    SELECT jsonb_agg(to_jsonb(t)) AS items FROM (
      SELECT hi.*, r.room_number, u.name AS inspector_name
      FROM public.housekeeping_inspections hi
      LEFT JOIN public.rooms r ON r.id = hi.room_id
      LEFT JOIN auth.users u ON u.id = hi.inspected_by
      WHERE hi.lodge_id = p_lodge_id AND hi.inspection_date = p_date
      ORDER BY hi.created_at DESC
    ) t
  ),
  turnarounds AS (
    SELECT jsonb_agg(to_jsonb(t)) AS items FROM (
      SELECT tt.*, r.room_number
      FROM public.turnaround_tracking tt
      LEFT JOIN public.rooms r ON r.id = tt.room_id
      WHERE tt.lodge_id = p_lodge_id AND tt.dirty_at::date = p_date
      ORDER BY tt.created_at DESC
    ) t
  )
  SELECT jsonb_build_object(
    'dirty_rooms', rs.dirty_rooms,
    'clean_rooms', rs.clean_rooms,
    'available_rooms', rs.available_rooms,
    'assignments', COALESCE(a.items, '[]'::jsonb),
    'inspections', COALESCE(i.items, '[]'::jsonb),
    'turnarounds', COALESCE(ta.items, '[]'::jsonb)
  ) INTO v_result
  FROM room_status rs, assignments a, inspections i, turnarounds ta;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_housekeeping_dashboard(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_turnaround_times(p_lodge_id uuid, p_start_date date, p_end_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
      SELECT
        tt.room_id, r.room_number,
        tt.assigned_to, u.name AS attendant_name,
        avg(extract(epoch FROM (tt.cleaning_completed_at - tt.cleaning_started_at))/60)::numeric(10,1) AS avg_cleaning_minutes,
        count(*) AS turnaround_count
      FROM public.turnaround_tracking tt
      LEFT JOIN public.rooms r ON r.id = tt.room_id
      LEFT JOIN auth.users u ON u.id = tt.assigned_to
      WHERE tt.lodge_id = p_lodge_id
        AND tt.cleaning_started_at IS NOT NULL
        AND tt.cleaning_completed_at IS NOT NULL
        AND tt.dirty_at::date BETWEEN p_start_date AND p_end_date
      GROUP BY tt.room_id, r.room_number, tt.assigned_to, u.name
      ORDER BY avg_cleaning_minutes DESC
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_turnaround_times(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_housekeeping_productivity(p_lodge_id uuid, p_start_date date, p_end_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (
      SELECT
        ha.assigned_to, u.name AS attendant_name,
        ha.assignment_date,
        count(*) FILTER (WHERE ha.status = 'completed') AS rooms_completed,
        count(*) AS total_assigned
      FROM public.housekeeping_assignments ha
      LEFT JOIN auth.users u ON u.id = ha.assigned_to
      WHERE ha.lodge_id = p_lodge_id
        AND ha.assignment_date BETWEEN p_start_date AND p_end_date
      GROUP BY ha.assigned_to, u.name, ha.assignment_date
      ORDER BY ha.assignment_date, u.name
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_housekeeping_productivity(uuid, date, date) TO authenticated;

-- Checklist item CRUD
CREATE OR REPLACE FUNCTION public.get_housekeeping_checklist_items(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sort_order ASC, t.item_name ASC), '[]'::jsonb)
    FROM (SELECT * FROM public.housekeeping_inspection_checklist_items WHERE lodge_id = p_lodge_id AND active = true) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_housekeeping_checklist_items(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_housekeeping_checklist_item(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  v_id := gen_random_uuid();
  INSERT INTO public.housekeeping_inspection_checklist_items (id, lodge_id, item_name, category, is_required, sort_order)
  VALUES (v_id, p_lodge_id, p_payload->>'item_name', COALESCE(p_payload->>'category', 'general'),
    COALESCE((p_payload->>'is_required')::boolean, true), COALESCE((p_payload->>'sort_order')::int, 0));
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_housekeeping_checklist_item(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_housekeeping_checklist_item(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  UPDATE public.housekeeping_inspection_checklist_items SET
    item_name = COALESCE(p_payload->>'item_name', item_name),
    category = COALESCE(p_payload->>'category', category),
    is_required = COALESCE((p_payload->>'is_required')::boolean, is_required),
    sort_order = COALESCE((p_payload->>'sort_order')::int, sort_order),
    active = COALESCE((p_payload->>'active')::boolean, active)
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_housekeeping_checklist_item(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_housekeeping_checklist_item(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  DELETE FROM public.housekeeping_inspection_checklist_items WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_housekeeping_checklist_item(uuid, uuid) TO authenticated;
