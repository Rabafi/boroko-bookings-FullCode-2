-- Update create_room and update_room RPCs to persist rooms.room_type_id.
-- room_type_id is optional; if provided it must reference a room_types row in the same lodge.
-- room_type text is preserved for backward compatibility with existing/lower-tier rooms.

BEGIN;

-- ── 1. replace create_room ──────────────────────────────────────────────────

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
  v_status text := coalesce(nullif(payload->>'status', ''), 'available');
  v_ticket_id uuid := coalesce(nullif(payload->>'maintenance_ticket_id', '')::uuid, gen_random_uuid());
  v_issue text := coalesce(nullif(btrim(payload->>'maintenance_issue'), ''), 'Room created under maintenance');
  v_existing boolean;
BEGIN
  -- Authorization: require manager/admin/super_admin role for this lodge
  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'lodge_id is required');
  END IF;

  PERFORM public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  -- Validate room_type_id if provided: must belong to same lodge
  IF v_room_type_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.room_types rt
      WHERE rt.id = v_room_type_id AND rt.lodge_id = v_lodge_id AND rt.active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid room type for this lodge');
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.rooms r WHERE r.id = v_id AND r.lodge_id = v_lodge_id
  ) INTO v_existing;

  IF NOT v_existing THEN
    INSERT INTO public.rooms (
      id, lodge_id, room_number, room_type, room_type_id, rate_per_night, max_occupancy,
      status, description, photo, photos, amenities, updated_at
    ) VALUES (
      v_id, v_lodge_id, payload->>'room_number', payload->>'room_type', v_room_type_id,
      coalesce((payload->>'rate_per_night')::numeric, 0),
      coalesce((payload->>'max_occupancy')::integer, 2),
      v_status, coalesce(payload->>'description', ''), coalesce(payload->>'photo', ''),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x),
        case when payload->>'photo' is not null and payload->>'photo' <> ''
          then array[payload->>'photo'] else '{}'::text[] end
      ),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x),
        '{}'::text[]
      ),
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

-- ── 2. replace update_room ──────────────────────────────────────────────────

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
  v_status text;
  v_ticket_id uuid := coalesce(nullif(payload->>'maintenance_ticket_id', '')::uuid, gen_random_uuid());
  v_issue text := coalesce(nullif(btrim(payload->>'maintenance_issue'), ''), 'Room marked under maintenance');
BEGIN
  -- Authorization: require manager/admin/super_admin role for this lodge
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  SELECT * INTO v_current
  FROM public.rooms r
  WHERE r.id = p_id AND r.lodge_id = p_lodge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Room not found');
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'conflict', 'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    );
  END IF;

  -- Validate room_type_id if provided: must belong to same lodge
  IF v_room_type_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.room_types rt
      WHERE rt.id = v_room_type_id AND rt.lodge_id = p_lodge_id AND rt.active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid room type for this lodge');
    END IF;
  END IF;

  v_status := CASE
    WHEN payload ? 'status' THEN coalesce(nullif(payload->>'status', ''), 'available')
    ELSE v_current.status
  END;

  IF v_status <> 'maintenance' AND EXISTS (
    SELECT 1 FROM public.maintenance_tickets mt
    WHERE mt.lodge_id = p_lodge_id AND mt.room_id = p_id AND mt.status <> 'resolved'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Resolve the open maintenance ticket before changing this room status.'
    );
  END IF;

  UPDATE public.rooms
  SET room_number = CASE WHEN payload ? 'room_number' THEN payload->>'room_number' ELSE room_number END,
      room_type = CASE WHEN payload ? 'room_type' THEN payload->>'room_type' ELSE room_type END,
      room_type_id = CASE WHEN payload ? 'room_type_id' THEN v_room_type_id ELSE room_type_id END,
      rate_per_night = CASE WHEN payload ? 'rate_per_night' THEN coalesce((payload->>'rate_per_night')::numeric, 0) ELSE rate_per_night END,
      max_occupancy = CASE WHEN payload ? 'max_occupancy' THEN coalesce((payload->>'max_occupancy')::integer, 2) ELSE max_occupancy END,
      status = v_status,
      description = CASE WHEN payload ? 'description' THEN coalesce(payload->>'description', '') ELSE description END,
      photo = CASE WHEN payload ? 'photo' THEN coalesce(payload->>'photo', '') ELSE photo END,
      photos = CASE WHEN payload ? 'photos' THEN coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x), '{}'::text[]
      ) ELSE photos END,
      amenities = CASE WHEN payload ? 'amenities' THEN coalesce(
        (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x), '{}'::text[]
      ) ELSE amenities END,
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

  RETURN jsonb_build_object(
    'success', true, 'id', p_id,
    'maintenance_ticket_id', CASE WHEN v_status = 'maintenance' THEN v_ticket_id ELSE null END
  );
END;
$$;

-- ── 3. Revoke and grant permissions ─────────────────────────────────────────

REVOKE ALL ON FUNCTION public.create_room(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_room(uuid, uuid, jsonb, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_room(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_room(uuid, uuid, jsonb, timestamptz) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
