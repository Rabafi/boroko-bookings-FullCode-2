-- ── Asset Maintenance Depth ──────────────────────────────────────────────
-- Extends the asset registry with categories, warranties, inspections,
-- attachments, cost tracking, preventive scheduling, and dashboard.
-- Depends on: 20260714220000_asset_registry_and_vendors.sql

-- ── Asset Categories (hierarchical) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  icon text,
  parent_category_id uuid REFERENCES public.asset_categories(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_categories_lodge ON public.asset_categories(lodge_id);
CREATE INDEX IF NOT EXISTS idx_asset_categories_parent ON public.asset_categories(parent_category_id);

ALTER TABLE public.asset_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_categories_lodge_policy ON public.asset_categories
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.asset_categories TO authenticated;

-- ── Asset Warranties ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_warranties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.property_assets(id) ON DELETE CASCADE,
  provider text,
  warranty_number text,
  start_date date,
  end_date date,
  coverage_details text,
  contact_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_warranties_lodge ON public.asset_warranties(lodge_id);
CREATE INDEX IF NOT EXISTS idx_asset_warranties_asset ON public.asset_warranties(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_warranties_expiry ON public.asset_warranties(lodge_id, end_date) WHERE end_date IS NOT NULL;

ALTER TABLE public.asset_warranties ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_warranties_lodge_policy ON public.asset_warranties
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.asset_warranties TO authenticated;

-- ── Asset Inspections ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.property_assets(id) ON DELETE CASCADE,
  inspection_date date NOT NULL DEFAULT current_date,
  inspector_name text,
  result text NOT NULL CHECK (result IN ('pass', 'fail', 'conditional')),
  notes text,
  next_inspection_date date,
  cost numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_inspections_lodge ON public.asset_inspections(lodge_id);
CREATE INDEX IF NOT EXISTS idx_asset_inspections_asset ON public.asset_inspections(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_inspections_date ON public.asset_inspections(lodge_id, inspection_date);

ALTER TABLE public.asset_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_inspections_lodge_policy ON public.asset_inspections
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.asset_inspections TO authenticated;

-- ── Asset Attachments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.property_assets(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text,
  file_url text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_attachments_lodge ON public.asset_attachments(lodge_id);
CREATE INDEX IF NOT EXISTS idx_asset_attachments_asset ON public.asset_attachments(asset_id);

ALTER TABLE public.asset_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_attachments_lodge_policy ON public.asset_attachments
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.asset_attachments TO authenticated;

-- ── Asset Cost Tracking ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_cost_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.property_assets(id) ON DELETE CASCADE,
  cost_type text NOT NULL CHECK (cost_type IN ('purchase', 'installation', 'repair', 'maintenance', 'upgrade', 'other')),
  description text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  vendor_id uuid REFERENCES public.maintenance_vendors(id) ON DELETE SET NULL,
  ticket_id uuid REFERENCES public.maintenance_tickets(id) ON DELETE SET NULL,
  cost_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_cost_tracking_lodge ON public.asset_cost_tracking(lodge_id);
CREATE INDEX IF NOT EXISTS idx_asset_cost_tracking_asset ON public.asset_cost_tracking(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_cost_tracking_type ON public.asset_cost_tracking(lodge_id, cost_type);
CREATE INDEX IF NOT EXISTS idx_asset_cost_tracking_date ON public.asset_cost_tracking(lodge_id, cost_date);

ALTER TABLE public.asset_cost_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_cost_tracking_lodge_policy ON public.asset_cost_tracking
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.asset_cost_tracking TO authenticated;

-- ── Preventive Schedule Templates ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.preventive_schedule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  asset_category_id uuid REFERENCES public.asset_categories(id) ON DELETE SET NULL,
  frequency_days int NOT NULL DEFAULT 30,
  estimated_duration_minutes int DEFAULT 60,
  assigned_role text,
  requires_room_ooo boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_preventive_templates_lodge ON public.preventive_schedule_templates(lodge_id);
CREATE INDEX IF NOT EXISTS idx_preventive_templates_category ON public.preventive_schedule_templates(asset_category_id);

ALTER TABLE public.preventive_schedule_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY preventive_templates_lodge_policy ON public.preventive_schedule_templates
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.preventive_schedule_templates TO authenticated;

-- ── Preventive Schedule Assignments ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.preventive_schedule_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.property_assets(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.preventive_schedule_templates(id) ON DELETE CASCADE,
  next_due_date date,
  last_completed_date date,
  assigned_to uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'overdue', 'completed', 'skipped')),
  completed_notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_preventive_assignments_lodge ON public.preventive_schedule_assignments(lodge_id);
CREATE INDEX IF NOT EXISTS idx_preventive_assignments_asset ON public.preventive_schedule_assignments(asset_id);
CREATE INDEX IF NOT EXISTS idx_preventive_assignments_status ON public.preventive_schedule_assignments(lodge_id, status);
CREATE INDEX IF NOT EXISTS idx_preventive_assignments_due ON public.preventive_schedule_assignments(lodge_id, next_due_date);

ALTER TABLE public.preventive_schedule_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY preventive_assignments_lodge_policy ON public.preventive_schedule_assignments
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.preventive_schedule_assignments TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- RPCs – Asset Categories
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_asset_categories(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id, 'name', c.name, 'description', c.description,
      'icon', c.icon, 'parent_category_id', c.parent_category_id,
      'is_active', c.is_active, 'created_at', c.created_at, 'updated_at', c.updated_at
    ) ORDER BY c.name
  ) INTO v_result
  FROM public.asset_categories c
  WHERE c.lodge_id = p_lodge_id;
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_asset_categories(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_asset_category(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.asset_categories (lodge_id, name, description, icon, parent_category_id, is_active)
  VALUES (
    p_lodge_id,
    p_payload->>'name',
    p_payload->>'description',
    p_payload->>'icon',
    (p_payload->>'parent_category_id')::uuid,
    COALESCE((p_payload->>'is_active')::boolean, true)
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'category_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_asset_category(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_asset_category(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.asset_categories SET
    name = COALESCE(p_payload->>'name', name),
    description = COALESCE(p_payload->>'description', description),
    icon = COALESCE(p_payload->>'icon', icon),
    parent_category_id = COALESCE((p_payload->>'parent_category_id')::uuid, parent_category_id),
    is_active = COALESCE((p_payload->>'is_active')::boolean, is_active),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Category not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_asset_category(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_asset_category(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  DELETE FROM public.asset_categories WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Category not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_asset_category(uuid, uuid) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- RPCs – Asset Warranties
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_asset_warranties(p_lodge_id uuid, p_asset_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', w.id, 'asset_id', w.asset_id, 'provider', w.provider,
      'warranty_number', w.warranty_number, 'start_date', w.start_date,
      'end_date', w.end_date, 'coverage_details', w.coverage_details,
      'contact_phone', w.contact_phone, 'created_at', w.created_at, 'updated_at', w.updated_at
    ) ORDER BY w.end_date NULLS LAST
  ) INTO v_result
  FROM public.asset_warranties w
  WHERE w.lodge_id = p_lodge_id
    AND (p_asset_id IS NULL OR w.asset_id = p_asset_id);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_asset_warranties(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_asset_warranty(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.asset_warranties (lodge_id, asset_id, provider, warranty_number, start_date, end_date, coverage_details, contact_phone)
  VALUES (
    p_lodge_id,
    (p_payload->>'asset_id')::uuid,
    p_payload->>'provider',
    p_payload->>'warranty_number',
    (p_payload->>'start_date')::date,
    (p_payload->>'end_date')::date,
    p_payload->>'coverage_details',
    p_payload->>'contact_phone'
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'warranty_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_asset_warranty(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_asset_warranty(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.asset_warranties SET
    provider = COALESCE(p_payload->>'provider', provider),
    warranty_number = COALESCE(p_payload->>'warranty_number', warranty_number),
    start_date = COALESCE((p_payload->>'start_date')::date, start_date),
    end_date = COALESCE((p_payload->>'end_date')::date, end_date),
    coverage_details = COALESCE(p_payload->>'coverage_details', coverage_details),
    contact_phone = COALESCE(p_payload->>'contact_phone', contact_phone),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Warranty not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_asset_warranty(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_asset_warranty(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  DELETE FROM public.asset_warranties WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Warranty not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_asset_warranty(uuid, uuid) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- RPCs – Asset Inspections
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_asset_inspections(p_lodge_id uuid, p_asset_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', i.id, 'asset_id', i.asset_id, 'inspection_date', i.inspection_date,
      'inspector_name', i.inspector_name, 'result', i.result, 'notes', i.notes,
      'next_inspection_date', i.next_inspection_date, 'cost', i.cost, 'created_at', i.created_at
    ) ORDER BY i.inspection_date DESC
  ) INTO v_result
  FROM public.asset_inspections i
  WHERE i.lodge_id = p_lodge_id
    AND (p_asset_id IS NULL OR i.asset_id = p_asset_id);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_asset_inspections(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_asset_inspection(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.asset_inspections (lodge_id, asset_id, inspection_date, inspector_name, result, notes, next_inspection_date, cost)
  VALUES (
    p_lodge_id,
    (p_payload->>'asset_id')::uuid,
    COALESCE((p_payload->>'inspection_date')::date, current_date),
    p_payload->>'inspector_name',
    p_payload->>'result',
    p_payload->>'notes',
    (p_payload->>'next_inspection_date')::date,
    COALESCE((p_payload->>'cost')::numeric, 0)
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'inspection_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_asset_inspection(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_asset_inspection(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  DELETE FROM public.asset_inspections WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Inspection not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_asset_inspection(uuid, uuid) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- RPCs – Asset Attachments
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_asset_attachments(p_lodge_id uuid, p_asset_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id, 'asset_id', a.asset_id, 'file_name', a.file_name,
      'file_type', a.file_type, 'file_url', a.file_url, 'uploaded_by', a.uploaded_by,
      'notes', a.notes, 'created_at', a.created_at
    ) ORDER BY a.created_at DESC
  ) INTO v_result
  FROM public.asset_attachments a
  WHERE a.lodge_id = p_lodge_id
    AND (p_asset_id IS NULL OR a.asset_id = p_asset_id);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_asset_attachments(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_asset_attachment(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.asset_attachments (lodge_id, asset_id, file_name, file_type, file_url, uploaded_by, notes)
  VALUES (
    p_lodge_id,
    (p_payload->>'asset_id')::uuid,
    p_payload->>'file_name',
    p_payload->>'file_type',
    p_payload->>'file_url',
    auth.uid(),
    p_payload->>'notes'
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'attachment_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_asset_attachment(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_asset_attachment(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  DELETE FROM public.asset_attachments WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Attachment not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_asset_attachment(uuid, uuid) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- RPCs – Asset Cost Tracking
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_asset_costs(p_lodge_id uuid, p_asset_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id, 'asset_id', c.asset_id, 'cost_type', c.cost_type,
      'description', c.description, 'amount', c.amount, 'vendor_id', c.vendor_id,
      'ticket_id', c.ticket_id, 'cost_date', c.cost_date, 'created_at', c.created_at
    ) ORDER BY c.cost_date DESC
  ) INTO v_result
  FROM public.asset_cost_tracking c
  WHERE c.lodge_id = p_lodge_id
    AND (p_asset_id IS NULL OR c.asset_id = p_asset_id);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_asset_costs(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_asset_cost(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.asset_cost_tracking (lodge_id, asset_id, cost_type, description, amount, vendor_id, ticket_id, cost_date)
  VALUES (
    p_lodge_id,
    (p_payload->>'asset_id')::uuid,
    p_payload->>'cost_type',
    p_payload->>'description',
    COALESCE((p_payload->>'amount')::numeric, 0),
    (p_payload->>'vendor_id')::uuid,
    (p_payload->>'ticket_id')::uuid,
    COALESCE((p_payload->>'cost_date')::date, current_date)
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'cost_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.record_asset_cost(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_asset_cost_summary(p_lodge_id uuid, p_start_date date DEFAULT NULL, p_end_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'cost_type', c.cost_type,
      'total_amount', SUM(c.amount),
      'count', COUNT(c.id)
    ) ORDER BY c.cost_type
  ) INTO v_result
  FROM public.asset_cost_tracking c
  WHERE c.lodge_id = p_lodge_id
    AND (p_start_date IS NULL OR c.cost_date >= p_start_date)
    AND (p_end_date IS NULL OR c.cost_date <= p_end_date)
  GROUP BY c.cost_type;
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_asset_cost_summary(uuid, date, date) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- RPCs – Preventive Schedule Templates
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_preventive_templates(p_lodge_id uuid, p_category_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'title', t.title, 'description', t.description,
      'asset_category_id', t.asset_category_id, 'frequency_days', t.frequency_days,
      'estimated_duration_minutes', t.estimated_duration_minutes, 'assigned_role', t.assigned_role,
      'requires_room_ooo', t.requires_room_ooo, 'is_active', t.is_active,
      'created_at', t.created_at, 'updated_at', t.updated_at
    ) ORDER BY t.title
  ) INTO v_result
  FROM public.preventive_schedule_templates t
  WHERE t.lodge_id = p_lodge_id
    AND (p_category_id IS NULL OR t.asset_category_id = p_category_id);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_preventive_templates(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_preventive_template(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.preventive_schedule_templates (lodge_id, title, description, asset_category_id, frequency_days, estimated_duration_minutes, assigned_role, requires_room_ooo)
  VALUES (
    p_lodge_id,
    p_payload->>'title',
    p_payload->>'description',
    (p_payload->>'asset_category_id')::uuid,
    COALESCE((p_payload->>'frequency_days')::int, 30),
    COALESCE((p_payload->>'estimated_duration_minutes')::int, 60),
    p_payload->>'assigned_role',
    COALESCE((p_payload->>'requires_room_ooo')::boolean, false)
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'template_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_preventive_template(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_preventive_template(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.preventive_schedule_templates SET
    title = COALESCE(p_payload->>'title', title),
    description = COALESCE(p_payload->>'description', description),
    asset_category_id = COALESCE((p_payload->>'asset_category_id')::uuid, asset_category_id),
    frequency_days = COALESCE((p_payload->>'frequency_days')::int, frequency_days),
    estimated_duration_minutes = COALESCE((p_payload->>'estimated_duration_minutes')::int, estimated_duration_minutes),
    assigned_role = COALESCE(p_payload->>'assigned_role', assigned_role),
    requires_room_ooo = COALESCE((p_payload->>'requires_room_ooo')::boolean, requires_room_ooo),
    is_active = COALESCE((p_payload->>'is_active')::boolean, is_active),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Template not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_preventive_template(uuid, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_preventive_template(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  DELETE FROM public.preventive_schedule_templates WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Template not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_preventive_template(uuid, uuid) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- RPCs – Preventive Schedule Assignments
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_preventive_assignments(p_lodge_id uuid, p_asset_id uuid DEFAULT NULL, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id, 'asset_id', a.asset_id, 'template_id', a.template_id,
      'next_due_date', a.next_due_date, 'last_completed_date', a.last_completed_date,
      'assigned_to', a.assigned_to, 'status', a.status,
      'completed_notes', a.completed_notes, 'completed_at', a.completed_at,
      'created_at', a.created_at, 'updated_at', a.updated_at
    ) ORDER BY a.next_due_date NULLS LAST
  ) INTO v_result
  FROM public.preventive_schedule_assignments a
  WHERE a.lodge_id = p_lodge_id
    AND (p_asset_id IS NULL OR a.asset_id = p_asset_id)
    AND (p_status IS NULL OR a.status = p_status);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_preventive_assignments(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_preventive_assignment(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.preventive_schedule_assignments (lodge_id, asset_id, template_id, next_due_date, assigned_to, status)
  VALUES (
    p_lodge_id,
    (p_payload->>'asset_id')::uuid,
    (p_payload->>'template_id')::uuid,
    (p_payload->>'next_due_date')::date,
    (p_payload->>'assigned_to')::uuid,
    COALESCE(p_payload->>'status', 'pending')
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'assignment_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_preventive_assignment(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_preventive_assignment(p_id uuid, p_lodge_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_template_freq int; v_next_due date;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.preventive_schedule_assignments SET
    status = 'completed',
    completed_notes = COALESCE(p_notes, completed_notes),
    completed_at = now(),
    last_completed_date = COALESCE(next_due_date, current_date),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id
  RETURNING next_due_date INTO v_next_due;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Assignment not found');
  END IF;
  SELECT t.frequency_days INTO v_template_freq
  FROM public.preventive_schedule_assignments a
  JOIN public.preventive_schedule_templates t ON t.id = a.template_id
  WHERE a.id = p_id;
  UPDATE public.preventive_schedule_assignments SET
    next_due_date = (COALESCE(v_next_due, current_date) + (COALESCE(v_template_freq, 30) || ' days')::interval)::date
  WHERE id = p_id;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.complete_preventive_assignment(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.skip_preventive_assignment(p_id uuid, p_lodge_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.preventive_schedule_assignments SET
    status = 'skipped',
    completed_notes = COALESCE(p_notes, completed_notes),
    completed_at = now(),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Assignment not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.skip_preventive_assignment(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_preventive_assignments(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.preventive_schedule_assignments (lodge_id, asset_id, template_id, next_due_date, status)
  SELECT
    p_lodge_id,
    a.id,
    t.id,
    (current_date + (t.frequency_days || ' days')::interval)::date,
    'pending'
  FROM public.property_assets a
  JOIN public.preventive_schedule_templates t ON t.lodge_id = a.lodge_id
    AND (t.asset_category_id IS NULL OR t.asset_category_id = (SELECT c.id FROM public.asset_categories c WHERE c.name = a.category AND c.lodge_id = a.lodge_id LIMIT 1))
  WHERE a.lodge_id = p_lodge_id
    AND a.status = 'active'
    AND t.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.preventive_schedule_assignments pa
      WHERE pa.asset_id = a.id AND pa.template_id = t.id AND pa.status IN ('pending', 'overdue')
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'assignments_created', v_count);
END; $$;
GRANT EXECUTE ON FUNCTION public.generate_preventive_assignments(uuid) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- RPC – Asset Dashboard
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_asset_dashboard(p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_build_object(
    'total_assets', (SELECT COUNT(*) FROM public.property_assets WHERE lodge_id = p_lodge_id AND status = 'active'),
    'active_warranties', (SELECT COUNT(*) FROM public.asset_warranties WHERE lodge_id = p_lodge_id AND (end_date IS NULL OR end_date >= current_date)),
    'upcoming_inspections', (SELECT COUNT(*) FROM public.asset_inspections WHERE lodge_id = p_lodge_id AND next_inspection_date IS NOT NULL AND next_inspection_date >= current_date AND next_inspection_date <= current_date + 30),
    'overdue_preventive', (SELECT COUNT(*) FROM public.preventive_schedule_assignments WHERE lodge_id = p_lodge_id AND status IN ('pending', 'overdue') AND next_due_date IS NOT NULL AND next_due_date < current_date),
    'total_cost_ytd', COALESCE((SELECT SUM(amount) FROM public.asset_cost_tracking WHERE lodge_id = p_lodge_id AND cost_date >= date_trunc('year', current_date)), 0),
    'assets_by_category', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('category', COALESCE(a.category, 'Uncategorized'), 'count', COUNT(*)) ORDER BY COUNT(*) DESC)
      FROM public.property_assets a WHERE a.lodge_id = p_lodge_id AND a.status = 'active' GROUP BY a.category
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END; $$;
GRANT EXECUTE ON FUNCTION public.get_asset_dashboard(uuid) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- RPC – Asset Room Sellability
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_asset_room_sellability(p_lodge_id uuid, p_asset_id uuid, p_affects_sellability boolean, p_sellability_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_room_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  SELECT room_id INTO v_room_id FROM public.property_assets WHERE id = p_asset_id AND lodge_id = p_lodge_id;
  IF v_room_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Asset not found or has no room assignment');
  END IF;
  UPDATE public.property_assets SET
    notes = CASE WHEN p_affects_sellability THEN
      COALESCE(notes, '') || E'\n[Sellability] ' || COALESCE(p_sellability_notes, 'Affects room sellability')
    ELSE
      notes
    END,
    updated_at = now()
  WHERE id = p_asset_id AND lodge_id = p_lodge_id;
  IF p_affects_sellability THEN
    UPDATE public.rooms SET status = 'maintenance', notes = COALESCE(notes, '') || E'\nAsset sellability: ' || COALESCE(p_sellability_notes, 'Asset affects sellability')
    WHERE id = v_room_id AND lodge_id = p_lodge_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'room_id', v_room_id, 'affects_sellability', p_affects_sellability);
END; $$;
GRANT EXECUTE ON FUNCTION public.set_asset_room_sellability(uuid, uuid, boolean, text) TO authenticated;
