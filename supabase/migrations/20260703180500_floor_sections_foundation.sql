-- Floors & Sections foundation: hotel room organization and room linkage.
-- Supports buildings, wings, floors, and sections for Enterprise hotel operations.

BEGIN;

CREATE TABLE IF NOT EXISTS public.floor_sections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id      uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  name          text NOT NULL,
  code          text NOT NULL DEFAULT '',
  section_type  text NOT NULL DEFAULT 'floor',
  parent_id     uuid REFERENCES public.floor_sections(id) ON DELETE SET NULL,
  floor_number  integer,
  description   text NOT NULL DEFAULT '',
  sort_order    integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT floor_sections_type_check CHECK (section_type IN ('building', 'wing', 'floor', 'section')),
  CONSTRAINT floor_sections_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS floor_sections_lodge_id_idx ON public.floor_sections (lodge_id);
CREATE INDEX IF NOT EXISTS floor_sections_parent_id_idx ON public.floor_sections (parent_id) WHERE parent_id IS NOT NULL;
DROP INDEX IF EXISTS public.floor_sections_lodge_name_idx;
CREATE UNIQUE INDEX IF NOT EXISTS floor_sections_lodge_active_name_idx
  ON public.floor_sections (lodge_id, lower(name))
  WHERE active = true;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS floor_section_id uuid REFERENCES public.floor_sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rooms_floor_section_id_idx ON public.rooms (floor_section_id)
  WHERE floor_section_id IS NOT NULL;

ALTER TABLE public.floor_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS floor_sections_lodge_policy ON public.floor_sections;
CREATE POLICY floor_sections_lodge_policy ON public.floor_sections
  FOR ALL
  USING (lodge_id = (public.app_current_lodge_id()))
  WITH CHECK (lodge_id = (public.app_current_lodge_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.floor_sections TO service_role;
GRANT SELECT ON public.floor_sections TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.set_floor_sections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS floor_sections_updated_at_trigger ON public.floor_sections;
CREATE TRIGGER floor_sections_updated_at_trigger
  BEFORE UPDATE ON public.floor_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_floor_sections_updated_at();

CREATE OR REPLACE FUNCTION public.create_floor_section(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_name text := btrim(coalesce(payload->>'name', ''));
  v_code text := btrim(coalesce(payload->>'code', ''));
  v_section_type text := coalesce(nullif(payload->>'section_type', ''), 'floor');
  v_parent_id uuid := nullif(payload->>'parent_id', '')::uuid;
  v_floor_number integer := nullif(payload->>'floor_number', '')::integer;
  v_description text := coalesce(payload->>'description', '');
  v_sort_order integer := coalesce(nullif(payload->>'sort_order', '')::integer, 0);
  v_existing uuid;
BEGIN
  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'lodge_id is required');
  END IF;

  PERFORM public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  IF v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required');
  END IF;

  IF v_section_type NOT IN ('building', 'wing', 'floor', 'section') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid section type');
  END IF;

  IF v_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.floor_sections fs
    WHERE fs.id = v_parent_id AND fs.lodge_id = v_lodge_id AND fs.active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Parent section is not valid for this lodge');
  END IF;

  SELECT fs.id INTO v_existing
  FROM public.floor_sections fs
  WHERE fs.lodge_id = v_lodge_id
    AND lower(fs.name) = lower(v_name)
    AND fs.active = true
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'id', v_existing, 'idempotent', true);
  END IF;

  INSERT INTO public.floor_sections (
    id, lodge_id, name, code, section_type, parent_id, floor_number, description, sort_order
  ) VALUES (
    v_id, v_lodge_id, v_name, v_code, v_section_type, v_parent_id, v_floor_number, v_description, v_sort_order
  );

  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_floor_section(
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
  v_current public.floor_sections%ROWTYPE;
  v_name text := btrim(coalesce(payload->>'name', ''));
  v_code text := btrim(coalesce(payload->>'code', ''));
  v_section_type text := coalesce(nullif(payload->>'section_type', ''), 'floor');
  v_parent_id uuid := nullif(payload->>'parent_id', '')::uuid;
  v_floor_number integer := nullif(payload->>'floor_number', '')::integer;
  v_description text := coalesce(payload->>'description', '');
  v_sort_order integer := coalesce(nullif(payload->>'sort_order', '')::integer, 0);
BEGIN
  IF p_id IS NULL OR p_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'id and lodge_id are required');
  END IF;

  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  SELECT * INTO v_current
  FROM public.floor_sections fs
  WHERE fs.id = p_id AND fs.lodge_id = p_lodge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Floor or section not found');
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'Floor or section changed on another device. Refresh and try again.', 'conflict', true);
  END IF;

  IF v_name = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Name is required');
  END IF;

  IF v_section_type NOT IN ('building', 'wing', 'floor', 'section') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid section type');
  END IF;

  IF v_parent_id = p_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'A section cannot be its own parent');
  END IF;

  IF v_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.floor_sections fs
    WHERE fs.id = v_parent_id AND fs.lodge_id = p_lodge_id AND fs.active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Parent section is not valid for this lodge');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.floor_sections fs
    WHERE fs.lodge_id = p_lodge_id
      AND fs.id <> p_id
      AND lower(fs.name) = lower(v_name)
      AND fs.active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A floor or section with this name already exists');
  END IF;

  UPDATE public.floor_sections
  SET name = v_name,
      code = v_code,
      section_type = v_section_type,
      parent_id = v_parent_id,
      floor_number = v_floor_number,
      description = v_description,
      sort_order = v_sort_order
  WHERE id = p_id AND lodge_id = p_lodge_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_floor_section(
  p_id uuid,
  p_lodge_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_room_count integer;
  v_child_count integer;
BEGIN
  IF p_id IS NULL OR p_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'id and lodge_id are required');
  END IF;

  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  SELECT count(*) INTO v_room_count
  FROM public.rooms r
  WHERE r.floor_section_id = p_id
    AND r.lodge_id = p_lodge_id;

  SELECT count(*) INTO v_child_count
  FROM public.floor_sections fs
  WHERE fs.parent_id = p_id
    AND fs.lodge_id = p_lodge_id
    AND fs.active = true;

  IF v_room_count > 0 OR v_child_count > 0 THEN
    UPDATE public.floor_sections
    SET active = false
    WHERE id = p_id AND lodge_id = p_lodge_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Floor or section not found');
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'soft_deleted', true,
      'message', format('%s room(s) and %s child section(s) still reference this item. It has been deactivated.', v_room_count, v_child_count)
    );
  END IF;

  DELETE FROM public.floor_sections
  WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Floor or section not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

DROP FUNCTION IF EXISTS public.create_room(jsonb);
CREATE OR REPLACE FUNCTION public.create_room(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_room_type_id uuid := nullif(payload->>'room_type_id', '')::uuid;
  v_floor_section_id uuid := nullif(payload->>'floor_section_id', '')::uuid;
  v_status text := coalesce(nullif(payload->>'status', ''), 'available');
  v_ticket_id uuid := coalesce(nullif(payload->>'maintenance_ticket_id', '')::uuid, gen_random_uuid());
  v_issue text := coalesce(nullif(btrim(payload->>'maintenance_issue'), ''), 'Room created under maintenance');
  v_existing boolean;
BEGIN
  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'lodge_id is required');
  END IF;

  PERFORM public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  IF v_room_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.room_types rt
    WHERE rt.id = v_room_type_id AND rt.lodge_id = v_lodge_id AND rt.active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid room type for this lodge');
  END IF;

  IF v_floor_section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.floor_sections fs
    WHERE fs.id = v_floor_section_id AND fs.lodge_id = v_lodge_id AND fs.active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid floor or section for this lodge');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rooms r WHERE r.id = v_id AND r.lodge_id = v_lodge_id
  ) INTO v_existing;

  IF NOT v_existing THEN
    INSERT INTO public.rooms (
      id, lodge_id, room_number, room_type, room_type_id, floor_section_id, rate_per_night, max_occupancy,
      status, description, photo, photos, amenities, updated_at
    ) VALUES (
      v_id, v_lodge_id, payload->>'room_number', payload->>'room_type', v_room_type_id, v_floor_section_id,
      coalesce((payload->>'rate_per_night')::numeric, 0),
      coalesce((payload->>'max_occupancy')::integer, 2),
      v_status, coalesce(payload->>'description', ''), coalesce(payload->>'photo', ''),
      coalesce((select array_agg(x) from jsonb_array_elements_text(payload->'photos') x), case when payload->>'photo' is not null and payload->>'photo' <> '' then array[payload->>'photo'] else '{}'::text[] end),
      coalesce((select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x), '{}'::text[]),
      now()
    );
  END IF;

  IF v_status = 'maintenance' AND NOT EXISTS (
    SELECT 1 FROM public.maintenance_tickets mt
    WHERE mt.lodge_id = v_lodge_id AND mt.room_id = v_id AND mt.status <> 'resolved'
  ) THEN
    INSERT INTO public.maintenance_tickets (
      id, lodge_id, room_id, title, description, priority, status,
      reported_date, notes, labour_cost, parts_cost, total_cost
    ) VALUES (
      v_ticket_id, v_lodge_id, v_id, v_issue,
      coalesce(payload->>'maintenance_description', ''),
      coalesce(nullif(payload->>'maintenance_priority', ''), 'medium'),
      'open', current_date, coalesce(payload->>'maintenance_description', ''), 0, 0, 0
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'id', v_id,
    'maintenance_ticket_id', CASE WHEN v_status = 'maintenance' THEN v_ticket_id ELSE null END,
    'idempotent', v_existing
  );
END;
$$;

DROP FUNCTION IF EXISTS public.update_room(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.update_room(uuid, uuid, jsonb, timestamptz);
CREATE OR REPLACE FUNCTION public.update_room(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current public.rooms%ROWTYPE;
  v_room_type_id uuid := nullif(payload->>'room_type_id', '')::uuid;
  v_floor_section_id uuid := nullif(payload->>'floor_section_id', '')::uuid;
  v_status text;
  v_ticket_id uuid := coalesce(nullif(payload->>'maintenance_ticket_id', '')::uuid, gen_random_uuid());
  v_issue text := coalesce(nullif(btrim(payload->>'maintenance_issue'), ''), 'Room marked under maintenance');
BEGIN
  IF p_id IS NULL OR p_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'id and lodge_id are required');
  END IF;

  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  SELECT * INTO v_current
  FROM public.rooms r
  WHERE r.id = p_id AND r.lodge_id = p_lodge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Room not found');
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'conflict', 'conflict', true, 'message', 'This record was updated on another device. Refresh and reapply your change.');
  END IF;

  IF v_room_type_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.room_types rt
    WHERE rt.id = v_room_type_id AND rt.lodge_id = p_lodge_id AND rt.active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid room type for this lodge');
  END IF;

  IF v_floor_section_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.floor_sections fs
    WHERE fs.id = v_floor_section_id AND fs.lodge_id = p_lodge_id AND fs.active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid floor or section for this lodge');
  END IF;

  v_status := CASE
    WHEN payload ? 'status' THEN coalesce(nullif(payload->>'status', ''), 'available')
    ELSE v_current.status
  END;

  IF v_status <> 'maintenance' AND EXISTS (
    SELECT 1 FROM public.maintenance_tickets mt
    WHERE mt.lodge_id = p_lodge_id AND mt.room_id = p_id AND mt.status <> 'resolved'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Resolve the open maintenance ticket before changing this room status.');
  END IF;

  UPDATE public.rooms
  SET room_number = CASE WHEN payload ? 'room_number' THEN payload->>'room_number' ELSE room_number END,
      room_type = CASE WHEN payload ? 'room_type' THEN payload->>'room_type' ELSE room_type END,
      room_type_id = CASE WHEN payload ? 'room_type_id' THEN v_room_type_id ELSE room_type_id END,
      floor_section_id = CASE WHEN payload ? 'floor_section_id' THEN v_floor_section_id ELSE floor_section_id END,
      rate_per_night = CASE WHEN payload ? 'rate_per_night' THEN coalesce((payload->>'rate_per_night')::numeric, 0) ELSE rate_per_night END,
      max_occupancy = CASE WHEN payload ? 'max_occupancy' THEN coalesce((payload->>'max_occupancy')::integer, 2) ELSE max_occupancy END,
      status = v_status,
      description = CASE WHEN payload ? 'description' THEN coalesce(payload->>'description', '') ELSE description END,
      photo = CASE WHEN payload ? 'photo' THEN coalesce(payload->>'photo', '') ELSE photo END,
      photos = CASE WHEN payload ? 'photos' THEN coalesce((select array_agg(x) from jsonb_array_elements_text(payload->'photos') x), '{}'::text[]) ELSE photos END,
      amenities = CASE WHEN payload ? 'amenities' THEN coalesce((select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x), '{}'::text[]) ELSE amenities END,
      updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;

  IF v_status = 'maintenance' AND NOT EXISTS (
    SELECT 1 FROM public.maintenance_tickets mt
    WHERE mt.lodge_id = p_lodge_id AND mt.room_id = p_id AND mt.status <> 'resolved'
  ) THEN
    INSERT INTO public.maintenance_tickets (
      id, lodge_id, room_id, title, description, priority, status,
      reported_date, notes, labour_cost, parts_cost, total_cost
    ) VALUES (
      v_ticket_id, p_lodge_id, p_id, v_issue,
      coalesce(payload->>'maintenance_description', ''),
      coalesce(nullif(payload->>'maintenance_priority', ''), 'medium'),
      'open', current_date, coalesce(payload->>'maintenance_description', ''), 0, 0, 0
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', p_id, 'maintenance_ticket_id', CASE WHEN v_status = 'maintenance' THEN v_ticket_id ELSE null END);
END;
$$;

REVOKE ALL ON FUNCTION public.create_floor_section(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_floor_section(uuid, uuid, jsonb, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_floor_section(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_room(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_room(uuid, uuid, jsonb, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_floor_section(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_floor_section(uuid, uuid, jsonb, timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_floor_section(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_room(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_room(uuid, uuid, jsonb, timestamptz) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
