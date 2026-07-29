-- ── Venue Packages (Pre-configured event bundles) ────────────────────────────
-- Provides re-usable venue, catering, and equipment packages for events.

CREATE TABLE IF NOT EXISTS public.venue_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  package_name text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('venue', 'catering', 'equipment', 'bar', 'decoration', 'entertainment', 'combined', 'other')),
  base_price numeric(12,2) NOT NULL DEFAULT 0,
  max_capacity int,
  min_capacity int,
  duration_hours int,
  items jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_packages_lodge ON public.venue_packages(lodge_id);
CREATE INDEX IF NOT EXISTS idx_venue_packages_category ON public.venue_packages(lodge_id, category);

ALTER TABLE public.venue_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY venue_packages_lodge_policy ON public.venue_packages
  USING (public.app_lodge_access(lodge_id));
GRANT SELECT ON public.venue_packages TO authenticated;

-- ── RPC: Get venue packages ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_venue_packages(p_lodge_id uuid, p_category text DEFAULT NULL, p_active_only boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin', 'receptionist', 'operations']);
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id, 'package_name', p.package_name, 'description', p.description,
      'category', p.category, 'base_price', p.base_price, 'max_capacity', p.max_capacity,
      'min_capacity', p.min_capacity, 'duration_hours', p.duration_hours,
      'items', p.items, 'is_active', p.is_active, 'created_at', p.created_at,
      'updated_at', p.updated_at
    ) ORDER BY p.category, p.package_name
  ) INTO v_result
  FROM public.venue_packages p
  WHERE p.lodge_id = p_lodge_id
    AND (p_category IS NULL OR p.category = p_category)
    AND (NOT p_active_only OR p.is_active = true);
  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_venue_packages(uuid, text, boolean) TO authenticated;

-- ── RPC: Create venue package ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_venue_package(p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  INSERT INTO public.venue_packages (lodge_id, package_name, description, category, base_price, max_capacity, min_capacity, duration_hours, items, created_by)
  VALUES (
    p_lodge_id, p_payload->>'package_name', p_payload->>'description',
    p_payload->>'category', COALESCE((p_payload->>'base_price')::numeric, 0),
    (p_payload->>'max_capacity')::int, (p_payload->>'min_capacity')::int,
    (p_payload->>'duration_hours')::int,
    COALESCE(p_payload->'items', '[]'::jsonb), auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'package_id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_venue_package(uuid, jsonb) TO authenticated;

-- ── RPC: Update venue package ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_venue_package(p_id uuid, p_lodge_id uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  UPDATE public.venue_packages SET
    package_name = COALESCE(p_payload->>'package_name', package_name),
    description = COALESCE(p_payload->>'description', description),
    category = COALESCE(p_payload->>'category', category),
    base_price = COALESCE((p_payload->>'base_price')::numeric, base_price),
    max_capacity = COALESCE((p_payload->>'max_capacity')::int, max_capacity),
    min_capacity = COALESCE((p_payload->>'min_capacity')::int, min_capacity),
    duration_hours = COALESCE((p_payload->>'duration_hours')::int, duration_hours),
    items = COALESCE(p_payload->'items', items),
    is_active = COALESCE((p_payload->>'is_active')::boolean, is_active),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_venue_package(uuid, uuid, jsonb) TO authenticated;

-- ── RPC: Delete venue package ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_venue_package(p_id uuid, p_lodge_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);
  DELETE FROM public.venue_packages WHERE id = p_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;
  RETURN jsonb_build_object('success', true);
END; $$;
GRANT EXECUTE ON FUNCTION public.delete_venue_package(uuid, uuid) TO authenticated;

-- ── RPC: Apply package to event booking (creates line items) ──────────────────
CREATE OR REPLACE FUNCTION public.apply_venue_package_to_event(p_package_id uuid, p_event_booking_id uuid, p_lodge_id uuid, p_quantity int DEFAULT 1, p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pkg record;
  v_item jsonb;
  v_line_id uuid;
  v_count int := 0;
  v_claim jsonb;
  v_request_hash text;
  v_entity_id uuid := coalesce(p_package_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_event_lodge_id uuid;
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);

  -- Validate quantity
  IF p_quantity < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quantity must be at least 1');
  END IF;

  -- Fetch package and verify lodge ownership
  SELECT * INTO v_pkg FROM public.venue_packages
   WHERE id = p_package_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  -- Verify event_booking belongs to this lodge
  SELECT lodge_id INTO v_event_lodge_id
    FROM public.conference_bookings
   WHERE id = p_event_booking_id;
  IF NOT FOUND OR v_event_lodge_id IS DISTINCT FROM p_lodge_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event booking not found or belongs to a different lodge');
  END IF;

  -- Idempotency: claim the operation key
  IF p_idempotency_key IS NOT NULL THEN
    v_request_hash := encode(
      sha256(
        (p_lodge_id::text || p_package_id::text || p_event_booking_id::text || p_quantity::text || p_idempotency_key)::bytea
      ),
      'hex'
    );
    v_claim := public._claim_financial_operation(
      p_lodge_id, p_idempotency_key, 'apply_venue_package', v_entity_id, v_request_hash
    );
    IF (v_claim->>'success')::boolean IS NOT TRUE THEN
      RETURN v_claim;
    END IF;
    IF (v_claim->>'found')::boolean = true THEN
      RETURN coalesce(v_claim->'operation_result', jsonb_build_object('success', true, 'note', 'Already applied'));
    END IF;
  END IF;

  -- Insert line items from package items array
  v_count := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_pkg.items)
  LOOP
    INSERT INTO public.event_booking_line_items (
      lodge_id, event_booking_id, line_type, description, category,
      quantity, unit_price, subtotal, source_reference
    ) VALUES (
      p_lodge_id, p_event_booking_id,
      COALESCE(v_item->>'line_type', 'package'),
      v_item->>'description',
      COALESCE(v_item->>'category', v_pkg.category),
      COALESCE((v_item->>'quantity')::numeric, 1) * p_quantity,
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'quantity')::numeric, 1) * p_quantity * COALESCE((v_item->>'unit_price')::numeric, 0),
      'package-' || p_package_id || '-item-' || v_count
    ) RETURNING id INTO v_line_id;
    v_count := v_count + 1;
  END LOOP;

  -- Fallback: if package has no items array, insert a single line
  IF v_count = 0 THEN
    INSERT INTO public.event_booking_line_items (
      lodge_id, event_booking_id, line_type, description, category,
      quantity, unit_price, subtotal, source_reference
    ) VALUES (
      p_lodge_id, p_event_booking_id, 'package', v_pkg.package_name, v_pkg.category,
      p_quantity, v_pkg.base_price, p_quantity * v_pkg.base_price,
      'package-' || p_package_id || '-base'
    );
    v_count := 1;
  END IF;

  -- Recalculate event totals
  PERFORM public.recalculate_event_totals(p_event_booking_id, p_lodge_id);

  -- Record idempotency
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public._record_financial_operation(
      p_lodge_id, p_idempotency_key, 'apply_venue_package', v_entity_id, v_request_hash,
      jsonb_build_object('success', true, 'items_added', v_count, 'event_booking_id', p_event_booking_id)
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'items_added', v_count);
END; $$;
GRANT EXECUTE ON FUNCTION public.apply_venue_package_to_event(uuid, uuid, uuid, int, text) TO authenticated;
