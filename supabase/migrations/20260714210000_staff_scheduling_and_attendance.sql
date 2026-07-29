-- ── Staff Scheduling, Attendance, Timesheets, and Leave ──────────────────────
-- Extends hotel staff management with structured rostering, time tracking, and absence management.

-- ── Staff Schedules (Rostering) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  schedule_date date NOT NULL,
  shift_label text NOT NULL CHECK (shift_label IN ('morning', 'evening', 'night', 'office', 'off')),
  start_time time,
  end_time time,
  role_at_shift text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_schedules_unique_day
  ON public.staff_schedules(lodge_id, staff_id, schedule_date);

ALTER TABLE public.staff_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_schedules_lodge_policy ON public.staff_schedules
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.staff_schedules TO authenticated;

-- ── Staff Attendance (Clock In/Out) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clock_in_at timestamptz NOT NULL DEFAULT now(),
  clock_out_at timestamptz,
  actual_shift_label text,
  notes text,
  clock_in_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_lodge_date
  ON public.staff_attendance(lodge_id, clock_in_at);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff_date
  ON public.staff_attendance(staff_id, clock_in_at);

ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_attendance_lodge_policy ON public.staff_attendance
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.staff_attendance TO authenticated;

-- ── Staff Leave ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_leave (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  leave_type text NOT NULL CHECK (leave_type IN ('annual', 'sick', 'personal', 'bereavement', 'maternity', 'paternity', 'unpaid', 'other')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  total_days numeric(5,1) NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_leave_date_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_leave_lodge_dates
  ON public.staff_leave(lodge_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_staff_leave_staff_dates
  ON public.staff_leave(staff_id, start_date, end_date);

ALTER TABLE public.staff_leave ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_leave_lodge_policy ON public.staff_leave
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.staff_leave TO authenticated;

-- ── Scheduled shifts view (today's working staff) ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_staff_schedule(p_lodge_id uuid, p_date date DEFAULT current_date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'staff_id', s.staff_id,
      'staff_name', COALESCE(u.name, u.email, 'Unknown'),
      'schedule_date', s.schedule_date,
      'shift_label', s.shift_label,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'role_at_shift', s.role_at_shift,
      'notes', s.notes
    ) ORDER BY s.shift_label, COALESCE(u.name, u.email)
  ) INTO v_result
  FROM public.staff_schedules s
  LEFT JOIN auth.users u ON u.id = s.staff_id
  WHERE s.lodge_id = p_lodge_id AND s.schedule_date = p_date;
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_staff_schedule(uuid, date) TO authenticated;

-- ── Schedule staff for a date range (batch upsert) ──────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_staff_schedule(p_lodge_id uuid, p_staff_id uuid, p_schedule_date date, p_shift_label text, p_start_time time, p_end_time time, p_role_at_shift text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.staff_schedules (lodge_id, staff_id, schedule_date, shift_label, start_time, end_time, role_at_shift, notes, created_by)
  VALUES (p_lodge_id, p_staff_id, p_schedule_date, p_shift_label, p_start_time, p_end_time, p_role_at_shift, p_notes, auth.uid())
  ON CONFLICT (lodge_id, staff_id, schedule_date) DO UPDATE SET
    shift_label = EXCLUDED.shift_label,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    role_at_shift = EXCLUDED.role_at_shift,
    notes = EXCLUDED.notes,
    updated_at = now();
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.upsert_staff_schedule(uuid, uuid, date, text, time, time, text, text) TO authenticated;

-- ── Delete a schedule entry ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_staff_schedule_entry(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin']);
  DELETE FROM public.staff_schedules WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_staff_schedule_entry(uuid, uuid) TO authenticated;

-- ── Get schedule for a date range (weekly view) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_staff_schedule_range(p_lodge_id uuid, p_start_date date, p_end_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'staff_id', s.staff_id,
      'staff_name', COALESCE(u.name, u.email, 'Unknown'),
      'schedule_date', s.schedule_date,
      'shift_label', s.shift_label,
      'start_time', s.start_time,
      'end_time', s.end_time,
      'role_at_shift', s.role_at_shift
    ) ORDER BY s.schedule_date, s.shift_label, COALESCE(u.name, u.email)
  ) INTO v_result
  FROM public.staff_schedules s
  LEFT JOIN auth.users u ON u.id = s.staff_id
  WHERE s.lodge_id = p_lodge_id AND s.schedule_date >= p_start_date AND s.schedule_date <= p_end_date;
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_staff_schedule_range(uuid, date, date) TO authenticated;

-- ── Clock in ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clock_in_staff_hotel(p_lodge_id uuid, p_staff_id uuid, p_shift_label text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing_id uuid; v_now timestamptz := now();
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT id INTO v_existing_id FROM public.staff_attendance
   WHERE staff_id = p_staff_id AND lodge_id = p_lodge_id AND clock_out_at IS NULL
   LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already clocked in', 'attendance_id', v_existing_id);
  END IF;
  INSERT INTO public.staff_attendance (lodge_id, staff_id, clock_in_at, actual_shift_label, notes, clock_in_ip)
  VALUES (p_lodge_id, p_staff_id, v_now, p_shift_label, p_notes, inet_client_addr())
  RETURNING id INTO v_existing_id;
  RETURN jsonb_build_object('success', true, 'attendance_id', v_existing_id, 'clock_in_at', v_now);
END; $$;
GRANT EXECUTE ON FUNCTION public.clock_in_staff_hotel(uuid, uuid, text, text) TO authenticated;

-- ── Clock out ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.clock_out_staff_hotel(p_attendance_id uuid, p_lodge_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_now timestamptz := now(); v_clock_in timestamptz;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  UPDATE public.staff_attendance SET clock_out_at = v_now, notes = COALESCE(p_notes, notes)
  WHERE id = p_attendance_id AND lodge_id = p_lodge_id AND clock_out_at IS NULL
  RETURNING clock_in_at INTO v_clock_in;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not clocked in or already clocked out');
  END IF;
  RETURN jsonb_build_object('success', true, 'attendance_id', p_attendance_id, 'clock_in_at', v_clock_in, 'clock_out_at', v_now, 'duration_hours', round(extract(epoch FROM (v_now - v_clock_in)) / 3600, 2));
END; $$;
GRANT EXECUTE ON FUNCTION public.clock_out_staff_hotel(uuid, uuid, text) TO authenticated;

-- ── Get today's attendance (who is on shift now) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_staff_attendance_today(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'staff_id', a.staff_id,
      'staff_name', COALESCE(u.name, u.email, 'Unknown'),
      'clock_in_at', a.clock_in_at,
      'clock_out_at', a.clock_out_at,
      'actual_shift_label', a.actual_shift_label,
      'notes', a.notes,
      'is_clocked_in', a.clock_out_at IS NULL
    ) ORDER BY a.clock_in_at DESC
  ) INTO v_result
  FROM public.staff_attendance a
  LEFT JOIN auth.users u ON u.id = a.staff_id
  WHERE a.lodge_id = p_lodge_id AND date(a.clock_in_at) = current_date;
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_staff_attendance_today(uuid) TO authenticated;

-- ── Get attendance history for a date range ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_staff_attendance_range(p_lodge_id uuid, p_start_date date, p_end_date date, p_staff_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'staff_id', a.staff_id,
      'staff_name', COALESCE(u.name, u.email, 'Unknown'),
      'clock_in_at', a.clock_in_at,
      'clock_out_at', a.clock_out_at,
      'actual_shift_label', a.actual_shift_label,
      'duration_hours', CASE WHEN a.clock_out_at IS NOT NULL THEN round(extract(epoch FROM (a.clock_out_at - a.clock_in_at)) / 3600, 2) ELSE NULL END,
      'notes', a.notes
    ) ORDER BY a.clock_in_at DESC
  ) INTO v_result
  FROM public.staff_attendance a
  LEFT JOIN auth.users u ON u.id = a.staff_id
  WHERE a.lodge_id = p_lodge_id
    AND date(a.clock_in_at) >= p_start_date AND date(a.clock_in_at) <= p_end_date
    AND (p_staff_id IS NULL OR a.staff_id = p_staff_id);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_staff_attendance_range(uuid, date, date, uuid) TO authenticated;

-- ── Request leave ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_staff_leave(p_lodge_id uuid, p_staff_id uuid, p_leave_type text, p_start_date date, p_end_date date, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total_days numeric(5,1); v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  v_total_days := p_end_date - p_start_date + 1;
  IF v_total_days < 0.5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'End date must be after or equal to start date');
  END IF;
  INSERT INTO public.staff_leave (lodge_id, staff_id, leave_type, start_date, end_date, total_days, reason)
  VALUES (p_lodge_id, p_staff_id, p_leave_type, p_start_date, p_end_date, v_total_days, p_reason)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'leave_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.request_staff_leave(uuid, uuid, text, date, date, text) TO authenticated;

-- ── Approve/reject leave ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_staff_leave(p_id uuid, p_lodge_id uuid, p_status text, p_rejection_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.staff_leave SET
    status = p_status,
    approved_by = auth.uid(),
    approved_at = CASE WHEN p_status = 'approved' THEN now() ELSE NULL END,
    rejection_reason = CASE WHEN p_status = 'rejected' THEN p_rejection_reason ELSE NULL END,
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Leave request not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.approve_staff_leave(uuid, uuid, text, text) TO authenticated;

-- ── Get leave requests ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_staff_leave_requests(p_lodge_id uuid, p_status text DEFAULT NULL, p_staff_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'staff_id', l.staff_id,
      'staff_name', COALESCE(u.name, u.email, 'Unknown'),
      'leave_type', l.leave_type,
      'start_date', l.start_date,
      'end_date', l.end_date,
      'total_days', l.total_days,
      'reason', l.reason,
      'status', l.status,
      'approved_by', l.approved_by,
      'approved_at', l.approved_at,
      'rejection_reason', l.rejection_reason,
      'created_at', l.created_at
    ) ORDER BY l.created_at DESC
  ) INTO v_result
  FROM public.staff_leave l
  LEFT JOIN auth.users u ON u.id = l.staff_id
  WHERE l.lodge_id = p_lodge_id
    AND (p_status IS NULL OR l.status = p_status)
    AND (p_staff_id IS NULL OR l.staff_id = p_staff_id);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_staff_leave_requests(uuid, text, uuid) TO authenticated;

-- ── Attendance dashboard (summary counts) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_staff_attendance_dashboard(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_now_on_shift int; v_today_expected int; v_on_leave_today int; v_late_clockins int;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'workforce_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT count(*) INTO v_now_on_shift FROM public.staff_attendance
   WHERE lodge_id = p_lodge_id AND clock_in_at >= current_date AND clock_in_at < current_date + 1 AND clock_out_at IS NULL;
  SELECT count(*) INTO v_today_expected FROM public.staff_schedules
   WHERE lodge_id = p_lodge_id AND schedule_date = current_date AND shift_label != 'off';
  SELECT count(*) INTO v_on_leave_today FROM public.staff_leave
   WHERE lodge_id = p_lodge_id AND current_date BETWEEN start_date AND end_date AND status = 'approved';
  SELECT count(*) INTO v_late_clockins FROM public.staff_attendance a
   WHERE a.lodge_id = p_lodge_id AND a.clock_in_at >= current_date AND a.clock_in_at < current_date + 1
     AND a.clock_in_at > (current_date + time '09:00');
  RETURN jsonb_build_object(
    'now_on_shift', v_now_on_shift,
    'today_expected', v_today_expected,
    'on_leave_today', v_on_leave_today,
    'late_clockins_today', v_late_clockins,
    'absent_today', GREATEST(0, v_today_expected - v_now_on_shift - v_on_leave_today)
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_staff_attendance_dashboard(uuid) TO authenticated;
