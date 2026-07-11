-- Room Types foundation: table, RLS, CRUD RPCs, and rooms linkage.
-- Enterprise hotel module for managing room categories with distinct rates.

BEGIN;

-- ── 1. room_types table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.room_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id        uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  rate_per_night  numeric(12,2) NOT NULL DEFAULT 0,
  base_rate       numeric(12,2) NOT NULL DEFAULT 0,
  weekend_rate    numeric(12,2) NOT NULL DEFAULT 0,
  peak_rate       numeric(12,2) NOT NULL DEFAULT 0,
  max_occupancy   integer NOT NULL DEFAULT 2,
  amenities       jsonb NOT NULL DEFAULT '[]'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_types_rate_non_negative CHECK (rate_per_night >= 0),
  CONSTRAINT room_types_base_rate_non_negative CHECK (base_rate >= 0),
  CONSTRAINT room_types_weekend_rate_non_negative CHECK (weekend_rate >= 0),
  CONSTRAINT room_types_peak_rate_non_negative CHECK (peak_rate >= 0),
  CONSTRAINT room_types_max_occupancy_positive CHECK (max_occupancy > 0)
);

-- Index for lodge-scoped lookups
CREATE INDEX IF NOT EXISTS room_types_lodge_id_idx ON public.room_types (lodge_id);
DROP INDEX IF EXISTS public.room_types_lodge_name_idx;
CREATE UNIQUE INDEX IF NOT EXISTS room_types_lodge_active_name_idx
  ON public.room_types (lodge_id, lower(name))
  WHERE active = true;

-- ── 2. rooms.room_type_id foreign key ────────────────────────────────────────

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS room_type_id uuid REFERENCES public.room_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rooms_room_type_id_idx ON public.rooms (room_type_id)
  WHERE room_type_id IS NOT NULL;

-- ── 3. RLS policies ─────────────────────────────────────────────────────────

ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS room_types_lodge_policy ON public.room_types;
CREATE POLICY room_types_lodge_policy ON public.room_types
  FOR ALL
  USING (lodge_id = (public.app_current_lodge_id()))
  WITH CHECK (lodge_id = (public.app_current_lodge_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_types TO service_role;
GRANT SELECT ON public.room_types TO authenticated, anon;

-- ── 4. updated_at trigger ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_room_types_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS room_types_updated_at_trigger ON public.room_types;
CREATE TRIGGER room_types_updated_at_trigger
  BEFORE UPDATE ON public.room_types
  FOR EACH ROW
  EXECUTE FUNCTION public.set_room_types_updated_at();

-- ── 5. RPC: create_room_type ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_room_type(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id          uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id    uuid := (payload->>'lodge_id')::uuid;
  v_name        text := btrim(coalesce(payload->>'name', ''));
  v_description text := coalesce(payload->>'description', '');
  v_rate        numeric := coalesce((payload->>'rate_per_night')::numeric, 0);
  v_base_rate   numeric := coalesce((payload->>'base_rate')::numeric, v_rate);
  v_weekend     numeric := coalesce((payload->>'weekend_rate')::numeric, 0);
  v_peak        numeric := coalesce((payload->>'peak_rate')::numeric, 0);
  v_max_occ     integer := coalesce((payload->>'max_occupancy')::integer, 2);
  v_amenities   jsonb := coalesce(payload->'amenities', '[]'::jsonb);
  v_existing    boolean;
BEGIN
  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'lodge_id is required');
  END IF;

  PERFORM public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  IF v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required');
  END IF;

  IF jsonb_typeof(v_amenities) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amenities must be an array');
  END IF;

  -- Idempotency: check if room type with same name already exists (only active)
  SELECT EXISTS (
    SELECT 1 FROM public.room_types rt
    WHERE rt.lodge_id = v_lodge_id AND lower(rt.name) = lower(v_name) AND rt.active = true
  ) INTO v_existing;

  IF v_existing THEN
    SELECT rt.id INTO v_id FROM public.room_types rt
    WHERE rt.lodge_id = v_lodge_id AND lower(rt.name) = lower(v_name) AND rt.active = true
    LIMIT 1;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'idempotent', true);
  END IF;

  INSERT INTO public.room_types (
    id, lodge_id, name, description, rate_per_night, base_rate,
    weekend_rate, peak_rate, max_occupancy, amenities
  ) VALUES (
    v_id, v_lodge_id, v_name, v_description, v_rate, v_base_rate,
    v_weekend, v_peak, v_max_occ, v_amenities
  );

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- ── 6. RPC: update_room_type ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_room_type(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current     public.room_types%ROWTYPE;
  v_name        text := btrim(coalesce(payload->>'name', ''));
  v_description text := coalesce(payload->>'description', '');
  v_rate        numeric := coalesce((payload->>'rate_per_night')::numeric, 0);
  v_base_rate   numeric := coalesce((payload->>'base_rate')::numeric, v_rate);
  v_weekend     numeric := coalesce((payload->>'weekend_rate')::numeric, 0);
  v_peak        numeric := coalesce((payload->>'peak_rate')::numeric, 0);
  v_max_occ     integer := coalesce((payload->>'max_occupancy')::integer, 2);
  v_amenities   jsonb := coalesce(payload->'amenities', '[]'::jsonb);
BEGIN
  IF p_id IS NULL OR p_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'id and lodge_id are required');
  END IF;

  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  -- Lock row
  SELECT * INTO v_current
  FROM public.room_types rt
  WHERE rt.id = p_id AND rt.lodge_id = p_lodge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Room type not found');
  END IF;

  -- Optimistic concurrency
  IF p_expected_updated_at IS NOT NULL
     AND v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'Room type was modified by another user. Please refresh and try again.',
      'conflict', true
    );
  END IF;

  IF v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required');
  END IF;

  IF jsonb_typeof(v_amenities) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amenities must be an array');
  END IF;

  -- Check name uniqueness (excluding self, only active)
  IF EXISTS (
    SELECT 1 FROM public.room_types rt
    WHERE rt.lodge_id = p_lodge_id
      AND rt.id != p_id
      AND lower(rt.name) = lower(v_name)
      AND rt.active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A room type with this name already exists');
  END IF;

  UPDATE public.room_types SET
    name          = v_name,
    description   = v_description,
    rate_per_night = v_rate,
    base_rate     = v_base_rate,
    weekend_rate  = v_weekend,
    peak_rate     = v_peak,
    max_occupancy = v_max_occ,
    amenities     = v_amenities
  WHERE id = p_id AND lodge_id = p_lodge_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── 7. RPC: delete_room_type (soft-delete if rooms reference it, hard-delete otherwise) ──

CREATE OR REPLACE FUNCTION public.delete_room_type(
  p_id uuid,
  p_lodge_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_room_count integer;
BEGIN
  IF p_id IS NULL OR p_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'id and lodge_id are required');
  END IF;

  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  -- Check if any rooms in this lodge reference this room type
  SELECT count(*) INTO v_room_count
  FROM public.rooms r
  WHERE r.room_type_id = p_id
    AND r.lodge_id = p_lodge_id;

  IF v_room_count > 0 THEN
    -- Soft-delete: deactivate so it no longer appears in dropdowns, but existing rooms keep their reference
    UPDATE public.room_types SET active = false
    WHERE id = p_id AND lodge_id = p_lodge_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Room type not found');
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'soft_deleted', true,
      'message', format('%s room(s) still use this type. It has been deactivated instead of deleted.', v_room_count)
    );
  END IF;

  -- No references: hard delete
  DELETE FROM public.room_types
  WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Room type not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── 8. Revoke and grant RPC permissions ─────────────────────────────────────

REVOKE ALL ON FUNCTION public.create_room_type(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_room_type(uuid, uuid, jsonb, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_room_type(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_room_type(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_room_type(uuid, uuid, jsonb, timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_room_type(uuid, uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
