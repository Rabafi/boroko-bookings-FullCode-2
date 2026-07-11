-- ── Maintenance Enterprise Depth ────────────────────────────────────────────
-- Preventive Schedules, Downtime Log, Out-of-Order / Out-of-Service

CREATE TABLE IF NOT EXISTS public.maintenance_preventive_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  equipment_name text,
  frequency_days int,
  frequency_type text NOT NULL DEFAULT 'days' CHECK (frequency_type IN ('days', 'weeks', 'months')),
  next_due_date date NOT NULL,
  last_completed_date date,
  assigned_to uuid REFERENCES auth.users(id),
  estimated_duration_minutes int DEFAULT 60,
  requires_room_out_of_service boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_preventive_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY preventive_schedules_lodge_policy ON public.maintenance_preventive_schedules
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.maintenance_preventive_schedules TO authenticated;

CREATE INDEX IF NOT EXISTS idx_preventive_schedules_due ON public.maintenance_preventive_schedules(lodge_id, next_due_date);
CREATE INDEX IF NOT EXISTS idx_preventive_schedules_active ON public.maintenance_preventive_schedules(lodge_id, active);

CREATE TABLE IF NOT EXISTS public.maintenance_downtime_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.rooms(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date,
  reason text NOT NULL,
  downtime_type text NOT NULL CHECK (downtime_type IN ('out_of_order', 'out_of_service')),
  ticket_id uuid REFERENCES public.maintenance_tickets(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_downtime_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY downtime_log_lodge_policy ON public.maintenance_downtime_log
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.maintenance_downtime_log TO authenticated;

CREATE INDEX IF NOT EXISTS idx_downtime_log_room ON public.maintenance_downtime_log(room_id);
CREATE INDEX IF NOT EXISTS idx_downtime_log_active ON public.maintenance_downtime_log(lodge_id) WHERE end_date IS NULL;

-- ── RPCs ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_preventive_schedule(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  v_id := gen_random_uuid();
  INSERT INTO public.maintenance_preventive_schedules (id, lodge_id, title, description, room_id, equipment_name,
    frequency_days, frequency_type, next_due_date, assigned_to, estimated_duration_minutes, requires_room_out_of_service)
  VALUES (v_id, p_lodge_id, p_payload->>'title', p_payload->>'description',
    nullif(p_payload->>'room_id', '')::uuid, p_payload->>'equipment_name',
    COALESCE((p_payload->>'frequency_days')::int, 30), COALESCE(p_payload->>'frequency_type', 'days'),
    (p_payload->>'next_due_date')::date, nullif(p_payload->>'assigned_to', '')::uuid,
    COALESCE((p_payload->>'estimated_duration_minutes')::int, 60),
    COALESCE((p_payload->>'requires_room_out_of_service')::boolean, false));
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_preventive_schedule(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_preventive_schedule(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  UPDATE public.maintenance_preventive_schedules SET
    title = COALESCE(p_payload->>'title', title),
    description = COALESCE(p_payload->>'description', description),
    room_id = COALESCE(nullif(p_payload->>'room_id', '')::uuid, room_id),
    equipment_name = COALESCE(p_payload->>'equipment_name', equipment_name),
    frequency_days = COALESCE((p_payload->>'frequency_days')::int, frequency_days),
    frequency_type = COALESCE(p_payload->>'frequency_type', frequency_type),
    next_due_date = COALESCE((p_payload->>'next_due_date')::date, next_due_date),
    assigned_to = COALESCE(nullif(p_payload->>'assigned_to', '')::uuid, assigned_to),
    estimated_duration_minutes = COALESCE((p_payload->>'estimated_duration_minutes')::int, estimated_duration_minutes),
    requires_room_out_of_service = COALESCE((p_payload->>'requires_room_out_of_service')::boolean, requires_room_out_of_service),
    active = COALESCE((p_payload->>'active')::boolean, active)
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_preventive_schedule(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_preventive_schedule(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  DELETE FROM public.maintenance_preventive_schedules WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_preventive_schedule(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_due_preventive_maintenance(p_lodge_id uuid, p_date date DEFAULT current_date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'operations']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.next_due_date ASC), '[]'::jsonb)
    FROM (
      SELECT mps.*, r.room_number, u.name AS assigned_name
      FROM public.maintenance_preventive_schedules mps
      LEFT JOIN public.rooms r ON r.id = mps.room_id
      LEFT JOIN auth.users u ON u.id = mps.assigned_to
      WHERE mps.lodge_id = p_lodge_id AND mps.active = true AND mps.next_due_date <= p_date
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_due_preventive_maintenance(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_preventive_maintenance(p_id uuid, p_lodge_id uuid, p_completed_by uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_frequency_days int; v_frequency_type text; v_next_due date;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  SELECT frequency_days, frequency_type INTO v_frequency_days, v_frequency_type
  FROM public.maintenance_preventive_schedules WHERE id = p_id AND lodge_id = p_lodge_id;
  v_next_due := CASE v_frequency_type
    WHEN 'weeks' THEN current_date + (COALESCE(v_frequency_days, 4) * 7)
    WHEN 'months' THEN current_date + (COALESCE(v_frequency_days, 1) * 30)
    ELSE current_date + COALESCE(v_frequency_days, 30)
  END;
  UPDATE public.maintenance_preventive_schedules SET
    last_completed_date = current_date,
    next_due_date = v_next_due
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true, 'next_due_date', v_next_due);
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_preventive_maintenance(uuid, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_room_out_of_order(p_room_id uuid, p_lodge_id uuid, p_start_date date, p_reason text, p_end_date date DEFAULT NULL, p_ticket_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  v_id := gen_random_uuid();
  INSERT INTO public.maintenance_downtime_log (id, lodge_id, room_id, start_date, end_date, reason, downtime_type, ticket_id, created_by)
  VALUES (v_id, p_lodge_id, p_room_id, p_start_date, p_end_date, p_reason, 'out_of_order', p_ticket_id, auth.uid());
  UPDATE public.rooms SET status = 'maintenance' WHERE id = p_room_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.set_room_out_of_order(uuid, uuid, date, text, date, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_room_out_of_service(p_room_id uuid, p_lodge_id uuid, p_start_date date, p_reason text, p_end_date date DEFAULT NULL, p_ticket_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  v_id := gen_random_uuid();
  INSERT INTO public.maintenance_downtime_log (id, lodge_id, room_id, start_date, end_date, reason, downtime_type, ticket_id, created_by)
  VALUES (v_id, p_lodge_id, p_room_id, p_start_date, p_end_date, p_reason, 'out_of_service', p_ticket_id, auth.uid());
  UPDATE public.rooms SET housekeeping_status = 'out_of_service' WHERE id = p_room_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.set_room_out_of_service(uuid, uuid, date, text, date, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.return_room_to_service(p_downtime_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room_id uuid; v_downtime_type text;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  SELECT room_id, downtime_type INTO v_room_id, v_downtime_type
  FROM public.maintenance_downtime_log WHERE id = p_downtime_id AND lodge_id = p_lodge_id;
  IF v_room_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Downtime record not found'); END IF;
  UPDATE public.maintenance_downtime_log SET end_date = current_date WHERE id = p_downtime_id AND lodge_id = p_lodge_id;
  IF v_downtime_type = 'out_of_order' THEN
    UPDATE public.rooms SET status = 'available' WHERE id = v_room_id AND lodge_id = p_lodge_id;
  ELSE
    UPDATE public.rooms SET housekeeping_status = 'clean' WHERE id = v_room_id AND lodge_id = p_lodge_id;
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.return_room_to_service(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_room_downtime_history(p_room_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'operations']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.start_date DESC), '[]'::jsonb)
    FROM (
      SELECT mdl.*, mt.title AS ticket_title
      FROM public.maintenance_downtime_log mdl
      LEFT JOIN public.maintenance_tickets mt ON mt.id = mdl.ticket_id
      WHERE mdl.room_id = p_room_id AND mdl.lodge_id = p_lodge_id
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_room_downtime_history(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_maintenance_dashboard(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'operations']);
  WITH open_tickets AS (
    SELECT count(*) AS value FROM public.maintenance_tickets WHERE lodge_id = p_lodge_id AND status NOT IN ('resolved', 'closed')
  ),
  ooo_rooms AS (
    SELECT count(*) AS value FROM public.maintenance_downtime_log WHERE lodge_id = p_lodge_id AND downtime_type = 'out_of_order' AND end_date IS NULL
  ),
  oos_rooms AS (
    SELECT count(*) AS value FROM public.maintenance_downtime_log WHERE lodge_id = p_lodge_id AND downtime_type = 'out_of_service' AND end_date IS NULL
  ),
  due_preventive AS (
    SELECT count(*) AS value FROM public.maintenance_preventive_schedules WHERE lodge_id = p_lodge_id AND active = true AND next_due_date <= current_date
  ),
  avg_repair AS (
    SELECT COALESCE(round(avg(extract(epoch FROM (completed_at - created_at))/86400)::numeric, 1), 0) AS value
    FROM public.maintenance_tickets WHERE lodge_id = p_lodge_id AND status = 'resolved' AND completed_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'open_tickets', ot.value,
    'rooms_out_of_order', ooo.value,
    'rooms_out_of_service', oos.value,
    'due_preventive', dp.value,
    'avg_repair_days', ar.value
  ) INTO v_result
  FROM open_tickets ot, ooo_rooms ooo, oos_rooms oos, due_preventive dp, avg_repair ar;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_maintenance_dashboard(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_downtime_report(p_lodge_id uuid, p_start_date date, p_end_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  WITH room_nights AS (
    SELECT
      r.id AS room_id, r.room_number,
      count(*) AS lost_nights,
      min(mdl.start_date) AS first_downtime,
      max(mdl.start_date) AS last_downtime
    FROM public.maintenance_downtime_log mdl
    JOIN public.rooms r ON r.id = mdl.room_id
    WHERE mdl.lodge_id = p_lodge_id
      AND mdl.start_date <= p_end_date
      AND (mdl.end_date IS NULL OR mdl.end_date >= p_start_date)
    GROUP BY r.id, r.room_number
  )
  SELECT jsonb_build_object(
    'total_lost_nights', COALESCE(sum(rn.lost_nights), 0),
    'affected_rooms', count(*),
    'details', COALESCE(jsonb_agg(to_jsonb(rn) ORDER BY rn.lost_nights DESC), '[]'::jsonb)
  ) INTO v_result FROM room_nights rn;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_downtime_report(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_preventive_schedules(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'operations']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.next_due_date ASC), '[]'::jsonb)
    FROM (
      SELECT mps.*, r.room_number, u.name AS assigned_name
      FROM public.maintenance_preventive_schedules mps
      LEFT JOIN public.rooms r ON r.id = mps.room_id
      LEFT JOIN auth.users u ON u.id = mps.assigned_to
      WHERE mps.lodge_id = p_lodge_id AND mps.active = true
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_preventive_schedules(uuid) TO authenticated;
