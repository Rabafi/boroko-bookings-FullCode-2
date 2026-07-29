-- ── Phase 6: Events/Venues Complete Depth ──────────────────────────────────
-- Event leads, venue availability rules, run sheets, supplier coordination,
-- deposit milestones, event settlements, profitability, and reporting.

-- ── 1. EVENT LEADS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  company_name text,
  contact_name text NOT NULL,
  contact_email text,
  contact_phone text,
  event_type text,
  estimated_attendees int,
  preferred_date date,
  preferred_venue text,
  budget_range_min numeric(12,2),
  budget_range_max numeric(12,2),
  source text CHECK (source IN ('website','referral','walk-in','phone','email','other')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','proposal','lost','won')),
  assigned_to uuid REFERENCES auth.users(id),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_leads_lodge ON public.event_leads(lodge_id);
CREATE INDEX IF NOT EXISTS idx_event_leads_status ON public.event_leads(lodge_id, status);
CREATE INDEX IF NOT EXISTS idx_event_leads_assigned ON public.event_leads(assigned_to);

ALTER TABLE public.event_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_leads_lodge_policy ON public.event_leads
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.event_leads TO authenticated;

-- ── 2. VENUE AVAILABILITY RULES ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.venue_availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  resource_key text NOT NULL,
  day_of_week int NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time time,
  end_time time,
  is_available boolean DEFAULT true,
  reason_if_unavailable text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_venue_avail_resource_day UNIQUE (lodge_id, resource_key, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_venue_avail_rules_lodge ON public.venue_availability_rules(lodge_id);
CREATE INDEX IF NOT EXISTS idx_venue_avail_rules_resource ON public.venue_availability_rules(lodge_id, resource_key);

ALTER TABLE public.venue_availability_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY venue_avail_rules_lodge_policy ON public.venue_availability_rules
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.venue_availability_rules TO authenticated;

-- ── 3. RUN SHEETS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.run_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  event_booking_id uuid NOT NULL REFERENCES public.conference_bookings(id) ON DELETE CASCADE UNIQUE,
  title text NOT NULL,
  event_date date,
  setup_notes text,
  timeline jsonb DEFAULT '[]'::jsonb,
  catering_notes text,
  audio_visual_notes text,
  floor_plan_notes text,
  special_instructions text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final','executed')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_sheets_lodge ON public.run_sheets(lodge_id);
CREATE INDEX IF NOT EXISTS idx_run_sheets_event ON public.run_sheets(event_booking_id);
CREATE INDEX IF NOT EXISTS idx_run_sheets_status ON public.run_sheets(lodge_id, status);

ALTER TABLE public.run_sheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY run_sheets_lodge_policy ON public.run_sheets
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.run_sheets TO authenticated;

-- ── 4. SUPPLIER COORDINATION ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_coordination (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  event_booking_id uuid NOT NULL REFERENCES public.conference_bookings(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  contact_person text,
  contact_phone text,
  service_description text,
  quoted_amount numeric(12,2) DEFAULT 0,
  actual_amount numeric(12,2),
  scheduled_arrival timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','arrived','completed','cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_coord_lodge ON public.supplier_coordination(lodge_id);
CREATE INDEX IF NOT EXISTS idx_supplier_coord_event ON public.supplier_coordination(event_booking_id);
CREATE INDEX IF NOT EXISTS idx_supplier_coord_status ON public.supplier_coordination(lodge_id, status);

ALTER TABLE public.supplier_coordination ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_coord_lodge_policy ON public.supplier_coordination
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.supplier_coordination TO authenticated;

-- ── 5. DEPOSIT MILESTONES ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deposit_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  event_booking_id uuid NOT NULL REFERENCES public.conference_bookings(id) ON DELETE CASCADE,
  milestone_name text NOT NULL,
  due_date date,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  is_percentage boolean DEFAULT false,
  percentage_value numeric(5,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','waived','overdue')),
  paid_date date,
  payment_method text,
  payment_reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deposit_milestones_lodge ON public.deposit_milestones(lodge_id);
CREATE INDEX IF NOT EXISTS idx_deposit_milestones_event ON public.deposit_milestones(event_booking_id);
CREATE INDEX IF NOT EXISTS idx_deposit_milestones_status ON public.deposit_milestones(lodge_id, status);

ALTER TABLE public.deposit_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY deposit_milestones_lodge_policy ON public.deposit_milestones
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.deposit_milestones TO authenticated;

-- ── 6. EVENT SETTLEMENTS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.event_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  event_booking_id uuid NOT NULL REFERENCES public.conference_bookings(id) ON DELETE CASCADE,
  settled_at timestamptz NOT NULL DEFAULT now(),
  settled_by uuid REFERENCES auth.users(id),
  final_total numeric(12,2) NOT NULL DEFAULT 0,
  total_paid numeric(12,2) NOT NULL DEFAULT 0,
  balance numeric(12,2) NOT NULL DEFAULT 0,
  adjustment_reason text,
  adjustment_amount numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_settlements_lodge ON public.event_settlements(lodge_id);
CREATE INDEX IF NOT EXISTS idx_event_settlements_event ON public.event_settlements(event_booking_id);

ALTER TABLE public.event_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_settlements_lodge_policy ON public.event_settlements
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.event_settlements TO authenticated;

-- ── RPC: GET EVENT LEADS ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_event_leads(p_lodge_id uuid, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', l.id, 'lodge_id', l.lodge_id, 'company_name', l.company_name,
      'contact_name', l.contact_name, 'contact_email', l.contact_email,
      'contact_phone', l.contact_phone, 'event_type', l.event_type,
      'estimated_attendees', l.estimated_attendees, 'preferred_date', l.preferred_date,
      'preferred_venue', l.preferred_venue, 'budget_range_min', l.budget_range_min,
      'budget_range_max', l.budget_range_max, 'source', l.source,
      'status', l.status, 'assigned_to', l.assigned_to, 'notes', l.notes,
      'created_by', l.created_by, 'created_at', l.created_at, 'updated_at', l.updated_at
    ) ORDER BY l.created_at DESC
  ) INTO v_result
  FROM public.event_leads l
  WHERE l.lodge_id = p_lodge_id
    AND (p_status IS NULL OR l.status = p_status);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_event_leads(uuid, text) TO authenticated;

-- ── RPC: CREATE EVENT LEAD ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_event_lead(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  INSERT INTO public.event_leads (
    lodge_id, company_name, contact_name, contact_email, contact_phone,
    event_type, estimated_attendees, preferred_date, preferred_venue,
    budget_range_min, budget_range_max, source, status, assigned_to,
    notes, created_by
  ) VALUES (
    p_lodge_id, p_payload->>'company_name', p_payload->>'contact_name',
    p_payload->>'contact_email', p_payload->>'contact_phone',
    p_payload->>'event_type', (p_payload->>'estimated_attendees')::int,
    (p_payload->>'preferred_date')::date, p_payload->>'preferred_venue',
    (p_payload->>'budget_range_min')::numeric, (p_payload->>'budget_range_max')::numeric,
    COALESCE(p_payload->>'source', 'other'),
    COALESCE(p_payload->>'status', 'new'),
    (p_payload->>'assigned_to')::uuid, p_payload->>'notes', auth.uid()
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'lead_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_event_lead(uuid, jsonb) TO authenticated;

-- ── RPC: UPDATE EVENT LEAD ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_event_lead(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  UPDATE public.event_leads SET
    company_name = COALESCE(p_payload->>'company_name', company_name),
    contact_name = COALESCE(p_payload->>'contact_name', contact_name),
    contact_email = COALESCE(p_payload->>'contact_email', contact_email),
    contact_phone = COALESCE(p_payload->>'contact_phone', contact_phone),
    event_type = COALESCE(p_payload->>'event_type', event_type),
    estimated_attendees = COALESCE((p_payload->>'estimated_attendees')::int, estimated_attendees),
    preferred_date = COALESCE((p_payload->>'preferred_date')::date, preferred_date),
    preferred_venue = COALESCE(p_payload->>'preferred_venue', preferred_venue),
    budget_range_min = COALESCE((p_payload->>'budget_range_min')::numeric, budget_range_min),
    budget_range_max = COALESCE((p_payload->>'budget_range_max')::numeric, budget_range_max),
    source = COALESCE(p_payload->>'source', source),
    status = COALESCE(p_payload->>'status', status),
    assigned_to = COALESCE((p_payload->>'assigned_to')::uuid, assigned_to),
    notes = COALESCE(p_payload->>'notes', notes),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lead not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_event_lead(uuid, uuid, jsonb) TO authenticated;

-- ── RPC: CONVERT LEAD TO BOOKING ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.convert_lead_to_booking(p_lead_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lead record;
  v_booking_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  SELECT * INTO v_lead FROM public.event_leads WHERE id = p_lead_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lead not found');
  END IF;
  IF v_lead.status = 'won' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lead already converted');
  END IF;
  INSERT INTO public.conference_bookings (
    lodge_id, booking_date, start_time, end_time, client_name, company,
    attendees, room_name, notes, status
  ) VALUES (
    p_lodge_id,
    COALESCE(v_lead.preferred_date, CURRENT_DATE),
    '09:00'::time, '17:00'::time,
    v_lead.contact_name,
    v_lead.company_name,
    COALESCE(v_lead.estimated_attendees, 0),
    COALESCE(v_lead.preferred_venue, 'Main Venue'),
    COALESCE(v_lead.notes, ''),
    'reserved'
  ) RETURNING id INTO v_booking_id;
  UPDATE public.event_leads SET status = 'won', updated_at = now()
   WHERE id = p_lead_id;
  RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id, 'lead_id', p_lead_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_booking(uuid, uuid) TO authenticated;

-- ── RPC: GET VENUE AVAILABILITY RULES ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_venue_availability_rules(p_lodge_id uuid, p_resource_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', r.id, 'lodge_id', r.lodge_id, 'resource_key', r.resource_key,
      'day_of_week', r.day_of_week, 'start_time', r.start_time,
      'end_time', r.end_time, 'is_available', r.is_available,
      'reason_if_unavailable', r.reason_if_unavailable,
      'created_at', r.created_at, 'updated_at', r.updated_at
    ) ORDER BY r.resource_key, r.day_of_week
  ) INTO v_result
  FROM public.venue_availability_rules r
  WHERE r.lodge_id = p_lodge_id
    AND (p_resource_key IS NULL OR r.resource_key = p_resource_key);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_venue_availability_rules(uuid, text) TO authenticated;

-- ── RPC: UPSERT VENUE AVAILABILITY RULE ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_venue_availability_rule(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.venue_availability_rules (
    lodge_id, resource_key, day_of_week, start_time, end_time, is_available, reason_if_unavailable
  ) VALUES (
    p_lodge_id, p_payload->>'resource_key',
    (p_payload->>'day_of_week')::int,
    (p_payload->>'start_time')::time,
    (p_payload->>'end_time')::time,
    COALESCE((p_payload->>'is_available')::boolean, true),
    p_payload->>'reason_if_unavailable'
  ) ON CONFLICT (lodge_id, resource_key, day_of_week) DO UPDATE SET
    start_time = COALESCE(EXCLUDED.start_time, venue_availability_rules.start_time),
    end_time = COALESCE(EXCLUDED.end_time, venue_availability_rules.end_time),
    is_available = COALESCE(EXCLUDED.is_available, venue_availability_rules.is_available),
    reason_if_unavailable = EXCLUDED.reason_if_unavailable,
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'rule_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.upsert_venue_availability_rule(uuid, jsonb) TO authenticated;

-- ── RPC: GET VENUE AVAILABILITY CALENDAR ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_venue_availability_calendar(
  p_lodge_id uuid, p_resource_key text, p_start_date date, p_end_date date
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rules jsonb;
  v_bookings jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  -- Get availability rules for this resource
  SELECT jsonb_agg(
    jsonb_build_object(
      'day_of_week', r.day_of_week, 'start_time', r.start_time,
      'end_time', r.end_time, 'is_available', r.is_available
    )
  ) INTO v_rules
  FROM public.venue_availability_rules r
  WHERE r.lodge_id = p_lodge_id AND r.resource_key = p_resource_key;
  -- Get existing bookings for this resource in the date range
  SELECT jsonb_agg(
    jsonb_build_object(
      'booking_date', cb.booking_date, 'start_time', cb.start_time,
      'end_time', cb.end_time, 'event_name', cb.event_name,
      'client_name', cb.client_name, 'status', cb.status,
      'booking_id', cb.id
    ) ORDER BY cb.booking_date, cb.start_time
  ) INTO v_bookings
  FROM public.conference_bookings cb
  WHERE cb.lodge_id = p_lodge_id
    AND cb.room_name = p_resource_key
    AND cb.booking_date >= p_start_date
    AND cb.booking_date <= p_end_date
    AND cb.status NOT IN ('cancelled');
  RETURN jsonb_build_object(
    'resource_key', p_resource_key,
    'rules', COALESCE(v_rules, '[]'::jsonb),
    'bookings', COALESCE(v_bookings, '[]'::jsonb)
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_venue_availability_calendar(uuid, text, date, date) TO authenticated;

-- ── RPC: GET RUN SHEET ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_run_sheet(p_event_booking_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_build_object(
    'id', rs.id, 'lodge_id', rs.lodge_id, 'event_booking_id', rs.event_booking_id,
    'title', rs.title, 'event_date', rs.event_date, 'setup_notes', rs.setup_notes,
    'timeline', rs.timeline, 'catering_notes', rs.catering_notes,
    'audio_visual_notes', rs.audio_visual_notes, 'floor_plan_notes', rs.floor_plan_notes,
    'special_instructions', rs.special_instructions, 'status', rs.status,
    'created_by', rs.created_by, 'created_at', rs.created_at, 'updated_at', rs.updated_at
  ) INTO v_result
  FROM public.run_sheets rs
  WHERE rs.event_booking_id = p_event_booking_id AND rs.lodge_id = p_lodge_id;
  RETURN COALESCE(v_result, '{}'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_run_sheet(uuid, uuid) TO authenticated;

-- ── RPC: CREATE RUN SHEET ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_run_sheet(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.run_sheets (
    lodge_id, event_booking_id, title, event_date, setup_notes, timeline,
    catering_notes, audio_visual_notes, floor_plan_notes, special_instructions, status, created_by
  ) VALUES (
    p_lodge_id, (p_payload->>'event_booking_id')::uuid,
    p_payload->>'title', (p_payload->>'event_date')::date,
    p_payload->>'setup_notes', COALESCE(p_payload->'timeline', '[]'::jsonb),
    p_payload->>'catering_notes', p_payload->>'audio_visual_notes',
    p_payload->>'floor_plan_notes', p_payload->>'special_instructions',
    COALESCE(p_payload->>'status', 'draft'), auth.uid()
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'run_sheet_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_run_sheet(uuid, jsonb) TO authenticated;

-- ── RPC: UPDATE RUN SHEET ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_run_sheet(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.run_sheets SET
    title = COALESCE(p_payload->>'title', title),
    event_date = COALESCE((p_payload->>'event_date')::date, event_date),
    setup_notes = COALESCE(p_payload->>'setup_notes', setup_notes),
    timeline = COALESCE(p_payload->'timeline', timeline),
    catering_notes = COALESCE(p_payload->>'catering_notes', catering_notes),
    audio_visual_notes = COALESCE(p_payload->>'audio_visual_notes', audio_visual_notes),
    floor_plan_notes = COALESCE(p_payload->>'floor_plan_notes', floor_plan_notes),
    special_instructions = COALESCE(p_payload->>'special_instructions', special_instructions),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Run sheet not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_run_sheet(uuid, uuid, jsonb) TO authenticated;

-- ── RPC: FINALIZE RUN SHEET ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_run_sheet(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.run_sheets SET status = 'final', updated_at = now()
   WHERE id = p_id AND lodge_id = p_lodge_id AND status = 'draft';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Run sheet not found or already finalized');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.finalize_run_sheet(uuid, uuid) TO authenticated;

-- ── RPC: EXECUTE RUN SHEET ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_run_sheet(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.run_sheets SET status = 'executed', updated_at = now()
   WHERE id = p_id AND lodge_id = p_lodge_id AND status = 'final';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Run sheet not found or not in final state');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.execute_run_sheet(uuid, uuid) TO authenticated;

-- ── RPC: GET EVENT SUPPLIERS ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_event_suppliers(p_event_booking_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id, 'lodge_id', s.lodge_id, 'event_booking_id', s.event_booking_id,
      'supplier_name', s.supplier_name, 'contact_person', s.contact_person,
      'contact_phone', s.contact_phone, 'service_description', s.service_description,
      'quoted_amount', s.quoted_amount, 'actual_amount', s.actual_amount,
      'scheduled_arrival', s.scheduled_arrival, 'status', s.status,
      'notes', s.notes, 'created_at', s.created_at, 'updated_at', s.updated_at
    ) ORDER BY s.supplier_name
  ) INTO v_result
  FROM public.supplier_coordination s
  WHERE s.event_booking_id = p_event_booking_id AND s.lodge_id = p_lodge_id;
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_event_suppliers(uuid, uuid) TO authenticated;

-- ── RPC: CREATE SUPPLIER ENTRY ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_supplier_entry(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.supplier_coordination (
    lodge_id, event_booking_id, supplier_name, contact_person, contact_phone,
    service_description, quoted_amount, actual_amount, scheduled_arrival, status, notes
  ) VALUES (
    p_lodge_id, (p_payload->>'event_booking_id')::uuid,
    p_payload->>'supplier_name', p_payload->>'contact_person',
    p_payload->>'contact_phone', p_payload->>'service_description',
    COALESCE((p_payload->>'quoted_amount')::numeric, 0),
    (p_payload->>'actual_amount')::numeric,
    (p_payload->>'scheduled_arrival')::timestamptz,
    COALESCE(p_payload->>'status', 'pending'),
    p_payload->>'notes'
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'supplier_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_supplier_entry(uuid, jsonb) TO authenticated;

-- ── RPC: UPDATE SUPPLIER ENTRY ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_supplier_entry(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.supplier_coordination SET
    supplier_name = COALESCE(p_payload->>'supplier_name', supplier_name),
    contact_person = COALESCE(p_payload->>'contact_person', contact_person),
    contact_phone = COALESCE(p_payload->>'contact_phone', contact_phone),
    service_description = COALESCE(p_payload->>'service_description', service_description),
    quoted_amount = COALESCE((p_payload->>'quoted_amount')::numeric, quoted_amount),
    actual_amount = COALESCE((p_payload->>'actual_amount')::numeric, actual_amount),
    scheduled_arrival = COALESCE((p_payload->>'scheduled_arrival')::timestamptz, scheduled_arrival),
    status = COALESCE(p_payload->>'status', status),
    notes = COALESCE(p_payload->>'notes', notes),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Supplier entry not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_supplier_entry(uuid, uuid, jsonb) TO authenticated;

-- ── RPC: UPDATE SUPPLIER STATUS ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_supplier_status(
  p_id uuid, p_lodge_id uuid, p_status text, p_actual_amount numeric DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.supplier_coordination SET
    status = p_status,
    actual_amount = COALESCE(p_actual_amount, actual_amount),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Supplier entry not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_supplier_status(uuid, uuid, text, numeric) TO authenticated;

-- ── RPC: GET DEPOSIT MILESTONES ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_deposit_milestones(p_event_booking_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', m.id, 'lodge_id', m.lodge_id, 'event_booking_id', m.event_booking_id,
      'milestone_name', m.milestone_name, 'due_date', m.due_date,
      'amount', m.amount, 'is_percentage', m.is_percentage,
      'percentage_value', m.percentage_value, 'status', m.status,
      'paid_date', m.paid_date, 'payment_method', m.payment_method,
      'payment_reference', m.payment_reference, 'notes', m.notes,
      'created_at', m.created_at, 'updated_at', m.updated_at
    ) ORDER BY m.due_date NULLS LAST, m.created_at
  ) INTO v_result
  FROM public.deposit_milestones m
  WHERE m.event_booking_id = p_event_booking_id AND m.lodge_id = p_lodge_id;
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_deposit_milestones(uuid, uuid) TO authenticated;

-- ── RPC: CREATE DEPOSIT MILESTONE ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_deposit_milestone(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.deposit_milestones (
    lodge_id, event_booking_id, milestone_name, due_date, amount,
    is_percentage, percentage_value, status, notes
  ) VALUES (
    p_lodge_id, (p_payload->>'event_booking_id')::uuid,
    p_payload->>'milestone_name', (p_payload->>'due_date')::date,
    COALESCE((p_payload->>'amount')::numeric, 0),
    COALESCE((p_payload->>'is_percentage')::boolean, false),
    (p_payload->>'percentage_value')::numeric,
    COALESCE(p_payload->>'status', 'pending'),
    p_payload->>'notes'
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'milestone_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_deposit_milestone(uuid, jsonb) TO authenticated;

-- ── RPC: MARK MILESTONE PAID ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_milestone_paid(
  p_id uuid, p_lodge_id uuid, p_paid_date date, p_method text, p_reference text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.deposit_milestones SET
    status = 'paid',
    paid_date = p_paid_date,
    payment_method = p_method,
    payment_reference = p_reference,
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id AND status IN ('pending', 'overdue');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Milestone not found or already paid/waived');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.mark_milestone_paid(uuid, uuid, date, text, text) TO authenticated;

-- ── RPC: WAIVE MILESTONE ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.waive_milestone(p_id uuid, p_lodge_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.deposit_milestones SET
    status = 'waived',
    notes = COALESCE(notes || E'\n' || 'Waived: ' || p_reason, 'Waived: ' || p_reason),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id AND status IN ('pending', 'overdue');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Milestone not found or already paid/waived');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.waive_milestone(uuid, uuid, text) TO authenticated;

-- ── RPC: SETTLE EVENT ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_event(
  p_event_booking_id uuid,
  p_lodge_id uuid,
  p_idempotency_key text,
  p_adjustment_amount numeric DEFAULT 0,
  p_adjustment_type text DEFAULT NULL,
  p_adjustment_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_final_total numeric;
  v_total_paid numeric;
  v_balance numeric;
  v_settled_id uuid;
  v_booking public.conference_bookings%ROWTYPE;
  v_folio_id uuid;
  v_folio_result jsonb;
  v_child_key text;
  v_key text;
  v_hash text;
  v_user_id uuid;
  v_claim jsonb;
  v_result jsonb;
  v_event_name text;
  v_client_name text;
BEGIN
  PERFORM public.app_get_lodge_role_of_user(p_lodge_id, ARRAY['manager', 'admin', 'super_admin', 'finance']);

  v_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 128 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Idempotency key must be between 8 and 128 characters');
  END IF;

  IF p_adjustment_type IS NOT NULL AND p_adjustment_type NOT IN ('credit', 'waiver', 'discount') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid adjustment type. Must be credit, waiver, discount, or null');
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_settlements WHERE event_booking_id = p_event_booking_id AND lodge_id = p_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event already settled');
  END IF;

  v_user_id := public.app_current_user_id();

  v_hash := encode(
    sha256(
      (coalesce(p_event_booking_id::text, '') || '|' ||
       coalesce(p_adjustment_amount::text, '0') || '|' ||
       coalesce(p_adjustment_type, '') || '|' ||
       coalesce(p_adjustment_reason, '') || '|' ||
       coalesce(p_notes, ''))::bytea
    ),
    'hex'
  );

  v_claim := public._claim_financial_operation(
    p_lodge_id, v_key, 'settle_event', p_event_booking_id, v_hash
  );
  IF (v_claim->>'success')::boolean IS NOT TRUE THEN
    RETURN v_claim;
  END IF;
  IF (v_claim->>'found')::boolean = TRUE THEN
    RETURN coalesce(v_claim->'operation_result', v_claim);
  END IF;

  SELECT * INTO v_booking
    FROM public.conference_bookings
   WHERE id = p_event_booking_id AND lodge_id = p_lodge_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event booking not found');
  END IF;

  v_event_name := v_booking.event_name;
  v_client_name := v_booking.client_name;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_final_total
    FROM public.event_booking_line_items
   WHERE event_booking_id = p_event_booking_id
     AND lodge_id = p_lodge_id
     AND voided_at IS NULL;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM public.payments
   WHERE conference_booking_id = p_event_booking_id
     AND status = 'confirmed';

  v_balance := v_final_total - v_total_paid - COALESCE(p_adjustment_amount, 0);

  INSERT INTO public.event_settlements (
    lodge_id, event_booking_id, settled_by, final_total, total_paid,
    balance, adjustment_reason, adjustment_amount, notes
  ) VALUES (
    p_lodge_id, p_event_booking_id, v_user_id,
    v_final_total, v_total_paid, v_balance,
    p_adjustment_reason, COALESCE(p_adjustment_amount, 0), p_notes
  ) RETURNING id INTO v_settled_id;

  UPDATE public.conference_bookings SET
    status = 'completed',
    total_amount = v_final_total,
    balance_due = GREATEST(0, v_balance),
    updated_at = now()
   WHERE id = p_event_booking_id AND lodge_id = p_lodge_id;

  INSERT INTO public.financial_ledger (lodge_id, entity_type, entity_id, entry_type, amount, description, reference_type, reference_id, created_by)
  VALUES
    (p_lodge_id, 'event_settlement', v_settled_id, 'debit', v_final_total, 'Event settlement total', 'event_booking', p_event_booking_id, v_user_id),
    (p_lodge_id, 'event_settlement', v_settled_id, 'credit', v_total_paid, 'Event settlement payments received', 'event_booking', p_event_booking_id, v_user_id);

  IF v_booking.exclusive_booking_id IS NOT NULL AND v_balance > 0 THEN
    SELECT id INTO v_folio_id FROM public.hotel_folios
      WHERE lodge_id = p_lodge_id AND booking_id = v_booking.exclusive_booking_id AND status = 'open'
      LIMIT 1 FOR UPDATE;

    IF FOUND THEN
      v_child_key := v_key || '-folio-charge';

      v_folio_result := public.add_folio_charge(
        p_lodge_id,
        v_folio_id,
        v_balance,
        'Event settlement: ' || COALESCE(v_event_name, v_client_name, 'Event'),
        'event_settlement',
        p_event_booking_id,
        v_child_key
      );

      IF (v_folio_result->>'success')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'Folio charge failed: %', COALESCE(v_folio_result->>'error', 'unknown error');
      END IF;
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'success', true, 'settlement_id', v_settled_id,
    'final_total', v_final_total, 'total_paid', v_total_paid,
    'balance', v_balance, 'adjustment', COALESCE(p_adjustment_amount, 0)
  );

  PERFORM public._record_financial_operation(
    p_lodge_id, v_key, 'settle_event', p_event_booking_id, v_hash, v_result
  );

  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.settle_event(uuid, uuid, text, numeric, text, text, text) TO authenticated;

-- ── RPC: GET EVENT PROFITABILITY ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_event_profitability(p_event_booking_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_revenue numeric;
  v_supplier_costs numeric;
  v_line_item_costs numeric;
  v_profit numeric;
  v_margin numeric;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  -- Revenue from conference_bookings
  SELECT COALESCE(total_amount, 0) INTO v_revenue
    FROM public.conference_bookings
   WHERE id = p_event_booking_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event booking not found');
  END IF;
  -- Supplier costs (actual amounts, falling back to quoted)
  SELECT COALESCE(SUM(COALESCE(actual_amount, quoted_amount, 0)), 0) INTO v_supplier_costs
    FROM public.supplier_coordination
   WHERE event_booking_id = p_event_booking_id AND lodge_id = p_lodge_id
     AND status != 'cancelled';
  -- Line item costs (inventory-based items that represent costs)
  SELECT COALESCE(SUM(subtotal), 0) INTO v_line_item_costs
    FROM public.event_booking_line_items
   WHERE event_booking_id = p_event_booking_id AND lodge_id = p_lodge_id
     AND voided_at IS NULL
     AND line_type IN ('cost', 'inventory', 'supplier');
  v_profit := v_revenue - v_supplier_costs - v_line_item_costs;
  v_margin := CASE WHEN v_revenue > 0 THEN ROUND((v_profit / v_revenue) * 100, 2) ELSE 0 END;
  RETURN jsonb_build_object(
    'success', true, 'event_booking_id', p_event_booking_id,
    'revenue', v_revenue, 'supplier_costs', v_supplier_costs,
    'line_item_costs', v_line_item_costs, 'total_costs', v_supplier_costs + v_line_item_costs,
    'profit', v_profit, 'margin_percent', v_margin
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_event_profitability(uuid, uuid) TO authenticated;

-- ── RPC: GET VENUE PROFITABILITY REPORT ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_venue_profitability_report(
  p_lodge_id uuid, p_start_date date, p_end_date date
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  WITH venue_events AS (
    SELECT
      cb.room_name AS venue,
      to_char(cb.booking_date, 'YYYY-MM') AS month,
      COUNT(cb.id) AS event_count,
      COALESCE(SUM(cb.total_amount), 0) AS revenue,
      COALESCE(SUM(COALESCE(cb.amount_paid, cb.deposit_paid, 0)), 0) AS amount_paid
    FROM public.conference_bookings cb
    WHERE cb.lodge_id = p_lodge_id
      AND cb.booking_date >= p_start_date
      AND cb.booking_date <= p_end_date
      AND cb.status NOT IN ('cancelled')
    GROUP BY cb.room_name, to_char(cb.booking_date, 'YYYY-MM')
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'venue', ve.venue, 'month', ve.month,
      'event_count', ve.event_count,
      'revenue', ve.revenue,
      'amount_paid', ve.amount_paid,
      'outstanding', ve.revenue - ve.amount_paid
    ) ORDER BY ve.venue, ve.month
  ) INTO v_result
  FROM venue_events ve;
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_venue_profitability_report(uuid, date, date) TO authenticated;
