-- ── Property Asset Registry and Maintenance Vendor Management ─────────────────
-- Extends the maintenance module with structured asset tracking and vendor records.

-- ── Property Assets (Equipment Registry) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  asset_name text NOT NULL,
  asset_type text NOT NULL CHECK (asset_type IN ('equipment', 'furniture', 'fixture', 'vehicle', 'tool', 'appliance', 'system', 'other')),
  category text,
  manufacturer text,
  model text,
  serial_number text,
  location text,
  room_id uuid REFERENCES public.rooms(id),
  purchase_date date,
  purchase_cost numeric(12,2) DEFAULT 0,
  warranty_expiry date,
  warranty_provider text,
  warranty_notes text,
  expected_lifespan_years int,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'disposed', 'sold', 'lost')),
  disposal_date date,
  disposal_notes text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_assets_lodge ON public.property_assets(lodge_id);
CREATE INDEX IF NOT EXISTS idx_property_assets_type ON public.property_assets(lodge_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_property_assets_room ON public.property_assets(room_id);
CREATE INDEX IF NOT EXISTS idx_property_assets_warranty ON public.property_assets(lodge_id, warranty_expiry) WHERE warranty_expiry IS NOT NULL;

ALTER TABLE public.property_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY property_assets_lodge_policy ON public.property_assets
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.property_assets TO authenticated;

-- ── Asset-Maintenance Link ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asset_maintenance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.property_assets(id) ON DELETE CASCADE,
  maintenance_ticket_id uuid REFERENCES public.maintenance_tickets(id) ON DELETE SET NULL,
  maintenance_date date NOT NULL DEFAULT current_date,
  description text,
  cost numeric(12,2) DEFAULT 0,
  vendor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_maint_log_asset ON public.asset_maintenance_log(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_maint_log_ticket ON public.asset_maintenance_log(maintenance_ticket_id);

ALTER TABLE public.asset_maintenance_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_maintenance_log_lodge_policy ON public.asset_maintenance_log
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.asset_maintenance_log TO authenticated;

-- ── Maintenance Vendors ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.maintenance_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  vendor_name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  address text,
  specialisation text,
  contract_start date,
  contract_end date,
  is_preferred boolean DEFAULT false,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_vendors_lodge ON public.maintenance_vendors(lodge_id);

ALTER TABLE public.maintenance_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY maintenance_vendors_lodge_policy ON public.maintenance_vendors
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.maintenance_vendors TO authenticated;

-- ── RPC: Get assets ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_property_assets(p_lodge_id uuid, p_asset_type text DEFAULT NULL, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', a.id, 'asset_name', a.asset_name, 'asset_type', a.asset_type,
      'category', a.category, 'manufacturer', a.manufacturer, 'model', a.model,
      'serial_number', a.serial_number, 'location', a.location,
      'room_id', a.room_id, 'purchase_date', a.purchase_date,
      'purchase_cost', a.purchase_cost, 'warranty_expiry', a.warranty_expiry,
      'warranty_provider', a.warranty_provider, 'expected_lifespan_years', a.expected_lifespan_years,
      'status', a.status, 'disposal_date', a.disposal_date, 'disposal_notes', a.disposal_notes,
      'notes', a.notes, 'created_at', a.created_at, 'updated_at', a.updated_at
    ) ORDER BY a.asset_name
  ) INTO v_result
  FROM public.property_assets a
  WHERE a.lodge_id = p_lodge_id
    AND (p_asset_type IS NULL OR a.asset_type = p_asset_type)
    AND (p_status IS NULL OR a.status = p_status);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_property_assets(uuid, text, text) TO authenticated;

-- ── RPC: Create asset ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_property_asset(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.property_assets (lodge_id, asset_name, asset_type, category, manufacturer, model, serial_number, location, room_id, purchase_date, purchase_cost, warranty_expiry, warranty_provider, warranty_notes, expected_lifespan_years, status, notes, created_by)
  VALUES (
    p_lodge_id, p_payload->>'asset_name', p_payload->>'asset_type', p_payload->>'category',
    p_payload->>'manufacturer', p_payload->>'model', p_payload->>'serial_number',
    p_payload->>'location', (p_payload->>'room_id')::uuid, (p_payload->>'purchase_date')::date,
    COALESCE((p_payload->>'purchase_cost')::numeric, 0), (p_payload->>'warranty_expiry')::date,
    p_payload->>'warranty_provider', p_payload->>'warranty_notes',
    (p_payload->>'expected_lifespan_years')::int, COALESCE(p_payload->>'status', 'active'),
    p_payload->>'notes', auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'asset_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_property_asset(uuid, jsonb) TO authenticated;

-- ── RPC: Update asset ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_property_asset(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.property_assets SET
    asset_name = COALESCE(p_payload->>'asset_name', asset_name),
    asset_type = COALESCE(p_payload->>'asset_type', asset_type),
    category = COALESCE(p_payload->>'category', category),
    manufacturer = COALESCE(p_payload->>'manufacturer', manufacturer),
    model = COALESCE(p_payload->>'model', model),
    serial_number = COALESCE(p_payload->>'serial_number', serial_number),
    location = COALESCE(p_payload->>'location', location),
    room_id = COALESCE((p_payload->>'room_id')::uuid, room_id),
    purchase_date = COALESCE((p_payload->>'purchase_date')::date, purchase_date),
    purchase_cost = COALESCE((p_payload->>'purchase_cost')::numeric, purchase_cost),
    warranty_expiry = COALESCE((p_payload->>'warranty_expiry')::date, warranty_expiry),
    warranty_provider = COALESCE(p_payload->>'warranty_provider', warranty_provider),
    warranty_notes = COALESCE(p_payload->>'warranty_notes', warranty_notes),
    expected_lifespan_years = COALESCE((p_payload->>'expected_lifespan_years')::int, expected_lifespan_years),
    status = COALESCE(p_payload->>'status', status),
    disposal_date = COALESCE((p_payload->>'disposal_date')::date, disposal_date),
    disposal_notes = COALESCE(p_payload->>'disposal_notes', disposal_notes),
    notes = COALESCE(p_payload->>'notes', notes),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Asset not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_property_asset(uuid, uuid, jsonb) TO authenticated;

-- ── RPC: Delete asset ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_property_asset(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  DELETE FROM public.property_assets WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Asset not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_property_asset(uuid, uuid) TO authenticated;

-- ── RPC: Get asset maintenance history ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_asset_maintenance_history(p_asset_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', l.id, 'asset_id', l.asset_id, 'maintenance_ticket_id', l.maintenance_ticket_id,
      'maintenance_date', l.maintenance_date, 'description', l.description,
      'cost', l.cost, 'vendor_id', l.vendor_id, 'created_at', l.created_at
    ) ORDER BY l.maintenance_date DESC
  ) INTO v_result
  FROM public.asset_maintenance_log l
  WHERE l.asset_id = p_asset_id AND l.lodge_id = p_lodge_id;
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_asset_maintenance_history(uuid, uuid) TO authenticated;

-- ── RPC: Log asset maintenance ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_asset_maintenance(p_lodge_id uuid, p_asset_id uuid, p_maintenance_ticket_id uuid, p_description text, p_cost numeric DEFAULT 0, p_vendor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.asset_maintenance_log (lodge_id, asset_id, maintenance_ticket_id, description, cost, vendor_id)
  VALUES (p_lodge_id, p_asset_id, p_maintenance_ticket_id, p_description, p_cost, p_vendor_id)
  RETURNING id INTO v_id;
  UPDATE public.property_assets SET updated_at = now() WHERE id = p_asset_id;
  RETURN jsonb_build_object('success', true, 'log_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.log_asset_maintenance(uuid, uuid, uuid, text, numeric, uuid) TO authenticated;

-- ── RPC: Get vendors ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_maintenance_vendors(p_lodge_id uuid, p_specialisation text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', v.id, 'vendor_name', v.vendor_name, 'contact_person', v.contact_person,
      'email', v.email, 'phone', v.phone, 'address', v.address,
      'specialisation', v.specialisation, 'contract_start', v.contract_start,
      'contract_end', v.contract_end, 'is_preferred', v.is_preferred,
      'notes', v.notes, 'created_at', v.created_at
    ) ORDER BY v.vendor_name
  ) INTO v_result
  FROM public.maintenance_vendors v
  WHERE v.lodge_id = p_lodge_id
    AND (p_specialisation IS NULL OR v.specialisation = p_specialisation);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_maintenance_vendors(uuid, text) TO authenticated;

-- ── RPC: Create vendor ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_maintenance_vendor(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.maintenance_vendors (lodge_id, vendor_name, contact_person, email, phone, address, specialisation, contract_start, contract_end, is_preferred, notes, created_by)
  VALUES (
    p_lodge_id, p_payload->>'vendor_name', p_payload->>'contact_person',
    p_payload->>'email', p_payload->>'phone', p_payload->>'address',
    p_payload->>'specialisation', (p_payload->>'contract_start')::date,
    (p_payload->>'contract_end')::date, COALESCE((p_payload->>'is_preferred')::boolean, false),
    p_payload->>'notes', auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'vendor_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_maintenance_vendor(uuid, jsonb) TO authenticated;

-- ── RPC: Update vendor ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_maintenance_vendor(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.maintenance_vendors SET
    vendor_name = COALESCE(p_payload->>'vendor_name', vendor_name),
    contact_person = COALESCE(p_payload->>'contact_person', contact_person),
    email = COALESCE(p_payload->>'email', email),
    phone = COALESCE(p_payload->>'phone', phone),
    address = COALESCE(p_payload->>'address', address),
    specialisation = COALESCE(p_payload->>'specialisation', specialisation),
    contract_start = COALESCE((p_payload->>'contract_start')::date, contract_start),
    contract_end = COALESCE((p_payload->>'contract_end')::date, contract_end),
    is_preferred = COALESCE((p_payload->>'is_preferred')::boolean, is_preferred),
    notes = COALESCE(p_payload->>'notes', notes),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vendor not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_maintenance_vendor(uuid, uuid, jsonb) TO authenticated;

-- ── RPC: Delete vendor ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_maintenance_vendor(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'asset_management', array['manager', 'admin', 'super_admin']);
  DELETE FROM public.maintenance_vendors WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vendor not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_maintenance_vendor(uuid, uuid) TO authenticated;
