-- ── Phase 10: Expanded Add-ons - Operational Modules ───────────────────────
-- Lost & Found, Incident Log, Visitor Register, Emergency List, Linen/Laundry

-- ── 1. Lost & Found ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lost_found_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  item_description text NOT NULL,
  category text DEFAULT 'general' CHECK (category IN ('general', 'electronics', 'clothing', 'jewelry', 'documents', 'bags', 'other')),
  location_found text,
  room_number text,
  guest_name text,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'found' CHECK (status IN ('found', 'claimed', 'returned', 'disposed', 'donated')),
  claimed_by text,
  claimed_at timestamptz,
  photo_url text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lost_found_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY lost_found_items_lodge_policy ON public.lost_found_items
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.lost_found_items TO authenticated, anon;

-- ── 2. Incident Log ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.incident_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  incident_type text NOT NULL CHECK (incident_type IN ('safety', 'security', 'maintenance', 'guest_complaint', 'medical', 'fire', 'theft', 'damage', 'other')),
  severity text NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  description text,
  location text,
  room_number text,
  reported_by text,
  witnesses text,
  action_taken text,
  follow_up_required boolean DEFAULT false,
  follow_up_notes text,
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.incident_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY incident_logs_lodge_policy ON public.incident_logs
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.incident_logs TO authenticated, anon;

-- ── 3. Visitor Register ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visitor_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  visitor_name text NOT NULL,
  visitor_phone text,
  visitor_id_number text,
  visit_purpose text DEFAULT 'guest' CHECK (visit_purpose IN ('guest', 'contractor', 'delivery', 'supplier', 'maintenance', 'official', 'other')),
  host_name text,
  host_room text,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  check_in_time timestamptz DEFAULT now(),
  check_out_time timestamptz,
  vehicle_registration text,
  id_verified boolean DEFAULT false,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.visitor_registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY visitor_registrations_lodge_policy ON public.visitor_registrations
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.visitor_registrations TO authenticated, anon;

-- ── 4. Emergency / Evacuation List ─────────────────────────────────────────
-- Derived from bookings + visitors; no dedicated table needed.
-- The emergency list is a real-time view of who is currently on property.
-- Implementation via SQL view for simplicity:

CREATE OR REPLACE VIEW public.emergency_list AS
SELECT
  b.lodge_id,
  'guest' AS person_type,
  COALESCE(c.name, 'Guest') AS name,
  c.phone AS phone,
  r.room_number AS room_number,
  b.check_in,
  b.check_out,
  COALESCE(b.adults, 0) + COALESCE(b.children, 0) AS party_size,
  b.created_at AS arrived_at
FROM public.bookings b
LEFT JOIN public.customers c ON c.id = b.customer_id AND c.lodge_id = b.lodge_id
LEFT JOIN public.rooms r ON r.id = b.room_id AND r.lodge_id = b.lodge_id
WHERE b.status IN ('confirmed', 'checked_in')
  AND b.check_in <= current_date
  AND b.check_out > current_date

UNION ALL

SELECT
  vr.lodge_id,
  'visitor' AS person_type,
  vr.visitor_name AS name,
  vr.visitor_phone AS phone,
  vr.host_room AS room_number,
  vr.check_in_time::date AS check_in,
  NULL::date AS check_out,
  1 AS party_size,
  vr.check_in_time AS arrived_at
FROM public.visitor_registrations vr
WHERE vr.check_out_time IS NULL
  AND vr.check_in_time::date <= current_date;

GRANT SELECT ON public.emergency_list TO authenticated, anon;

-- ── 5. Linen & Laundry ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.linen_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  item_name text NOT NULL,
  category text DEFAULT 'bedding' CHECK (category IN ('bedding', 'bath', 'table', 'pool', 'other')),
  total_quantity integer DEFAULT 0,
  in_use_quantity integer DEFAULT 0,
  dirty_quantity integer DEFAULT 0,
  damaged_quantity integer DEFAULT 0,
  unit_cost numeric(10,2) DEFAULT 0,
  currency text DEFAULT 'BWP',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.linen_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY linen_items_lodge_policy ON public.linen_items
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.linen_items TO authenticated, anon;

CREATE TABLE IF NOT EXISTS public.linen_laundry_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  batch_number text NOT NULL,
  provider_name text,
  items_sent jsonb DEFAULT '[]'::jsonb,
  items_returned jsonb DEFAULT '[]'::jsonb,
  items_damaged jsonb DEFAULT '[]'::jsonb,
  total_items_sent integer DEFAULT 0,
  total_items_returned integer DEFAULT 0,
  total_items_damaged integer DEFAULT 0,
  cost numeric(10,2) DEFAULT 0,
  currency text DEFAULT 'BWP',
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'partial_return', 'returned')),
  sent_at timestamptz DEFAULT now(),
  returned_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.linen_laundry_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY linen_laundry_batches_lodge_policy ON public.linen_laundry_batches
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.linen_laundry_batches TO authenticated, anon;

-- ── 6. RPCs for operational modules ────────────────────────────────────────

-- Generic CRUD for lost & found
CREATE OR REPLACE FUNCTION public.create_lost_found_item(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  v_id := gen_random_uuid();
  INSERT INTO public.lost_found_items (id, lodge_id, item_description, category, location_found, room_number, guest_name, booking_id, notes, created_by)
  VALUES (v_id, p_lodge_id, p_payload->>'item_description', COALESCE(p_payload->>'category', 'general'),
    p_payload->>'location_found', p_payload->>'room_number', p_payload->>'guest_name',
    nullif(p_payload->>'booking_id', '')::uuid, p_payload->>'notes', auth.uid());
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_lost_found_item(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_lost_found_item(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  UPDATE public.lost_found_items SET
    item_description = COALESCE(p_payload->>'item_description', item_description),
    category = COALESCE(p_payload->>'category', category),
    status = COALESCE(p_payload->>'status', status),
    claimed_by = COALESCE(p_payload->>'claimed_by', claimed_by),
    claimed_at = CASE WHEN p_payload->>'status' = 'claimed' THEN now() ELSE claimed_at END,
    notes = COALESCE(p_payload->>'notes', notes),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_lost_found_item(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_lost_found_item(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  DELETE FROM public.lost_found_items WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_lost_found_item(uuid, uuid) TO authenticated;

-- Generic CRUD for incidents
CREATE OR REPLACE FUNCTION public.create_incident_log(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  v_id := gen_random_uuid();
  INSERT INTO public.incident_logs (id, lodge_id, incident_type, severity, title, description, location, room_number, reported_by, witnesses, action_taken, follow_up_required, follow_up_notes, created_by)
  VALUES (v_id, p_lodge_id, p_payload->>'incident_type', COALESCE(p_payload->>'severity', 'low'),
    p_payload->>'title', p_payload->>'description', p_payload->>'location', p_payload->>'room_number',
    p_payload->>'reported_by', p_payload->>'witnesses', p_payload->>'action_taken',
    COALESCE((p_payload->>'follow_up_required')::boolean, false), p_payload->>'follow_up_notes', auth.uid());
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_incident_log(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_incident_log(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  UPDATE public.incident_logs SET
    severity = COALESCE(p_payload->>'severity', severity),
    action_taken = COALESCE(p_payload->>'action_taken', action_taken),
    resolved = COALESCE((p_payload->>'resolved')::boolean, resolved),
    resolved_at = CASE WHEN (p_payload->>'resolved')::boolean = true THEN now() ELSE resolved_at END,
    follow_up_notes = COALESCE(p_payload->>'follow_up_notes', follow_up_notes),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_incident_log(uuid, uuid, jsonb) TO authenticated;

-- Visitor register CRUD
CREATE OR REPLACE FUNCTION public.create_visitor_registration(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'receptionist']);
  v_id := gen_random_uuid();
  INSERT INTO public.visitor_registrations (id, lodge_id, visitor_name, visitor_phone, visitor_id_number, visit_purpose, host_name, host_room, booking_id, vehicle_registration, id_verified, notes, created_by)
  VALUES (v_id, p_lodge_id, p_payload->>'visitor_name', p_payload->>'visitor_phone', p_payload->>'visitor_id_number',
    COALESCE(p_payload->>'visit_purpose', 'guest'), p_payload->>'host_name', p_payload->>'host_room',
    nullif(p_payload->>'booking_id', '')::uuid, p_payload->>'vehicle_registration',
    COALESCE((p_payload->>'id_verified')::boolean, false), p_payload->>'notes', auth.uid());
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_visitor_registration(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.checkout_visitor(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.visitor_registrations SET check_out_time = now(), updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id AND check_out_time IS NULL;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.checkout_visitor(uuid, uuid) TO authenticated;

-- Linen item CRUD
CREATE OR REPLACE FUNCTION public.create_linen_item(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  v_id := gen_random_uuid();
  INSERT INTO public.linen_items (id, lodge_id, item_name, category, total_quantity, unit_cost, currency)
  VALUES (v_id, p_lodge_id, p_payload->>'item_name', COALESCE(p_payload->>'category', 'bedding'),
    COALESCE((p_payload->>'total_quantity')::int, 0), COALESCE((p_payload->>'unit_cost')::numeric, 0),
    COALESCE(p_payload->>'currency', 'BWP'));
  RETURN jsonb_build_object('success', true, 'id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_linen_item(uuid, jsonb) TO authenticated;

-- Linen laundry batch CRUD
CREATE OR REPLACE FUNCTION public.create_linen_laundry_batch(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_number text;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  v_id := gen_random_uuid();
  v_number := 'LB-' || to_char(now(), 'YYYYMM') || '-' || lpad((SELECT count(*) + 1 FROM public.linen_laundry_batches WHERE lodge_id = p_lodge_id)::text, 4, '0');
  INSERT INTO public.linen_laundry_batches (id, lodge_id, batch_number, provider_name, items_sent, total_items_sent, cost, currency, notes, created_by)
  VALUES (v_id, p_lodge_id, v_number, p_payload->>'provider_name',
    COALESCE(p_payload->>'items_sent', '[]'::jsonb), COALESCE((p_payload->>'total_items_sent')::int, 0),
    COALESCE((p_payload->>'cost')::numeric, 0), COALESCE(p_payload->>'currency', 'BWP'),
    p_payload->>'notes', auth.uid());
  RETURN jsonb_build_object('success', true, 'id', v_id, 'batch_number', v_number);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_linen_laundry_batch(uuid, jsonb) TO authenticated;

-- Read RPCs used by the desktop IPC bridge. Reads are explicit RPCs so the
-- renderer does not need table details and preview/dev failures are easier to
-- diagnose than a missing generic function call.
CREATE OR REPLACE FUNCTION public.get_lost_found_items(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['receptionist', 'manager', 'admin', 'super_admin']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT *
      FROM public.lost_found_items
      WHERE lodge_id = p_lodge_id
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_lost_found_items(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_incident_logs(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['receptionist', 'manager', 'admin', 'super_admin']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb)
    FROM (
      SELECT *
      FROM public.incident_logs
      WHERE lodge_id = p_lodge_id
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_incident_logs(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_visitor_registrations(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['receptionist', 'manager', 'admin', 'super_admin']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.check_in_time DESC), '[]'::jsonb)
    FROM (
      SELECT *
      FROM public.visitor_registrations
      WHERE lodge_id = p_lodge_id
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_visitor_registrations(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_linen_items(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.item_name ASC), '[]'::jsonb)
    FROM (
      SELECT *
      FROM public.linen_items
      WHERE lodge_id = p_lodge_id
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_linen_items(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_linen_laundry_batches(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  RETURN (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sent_at DESC), '[]'::jsonb)
    FROM (
      SELECT *
      FROM public.linen_laundry_batches
      WHERE lodge_id = p_lodge_id
    ) t
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.get_linen_laundry_batches(uuid) TO authenticated;
