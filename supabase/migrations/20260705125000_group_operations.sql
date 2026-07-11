-- 20260705125000_group_operations.sql
-- Group operations: check-in, checkout, pickup, release, rooming list to bookings

ALTER TABLE public.group_blocks ADD COLUMN IF NOT EXISTS rooms_booked integer DEFAULT 0;
ALTER TABLE public.group_blocks ADD COLUMN IF NOT EXISTS total_revenue numeric(12,2) DEFAULT 0;
ALTER TABLE public.group_blocks ADD COLUMN IF NOT EXISTS pickup_pct numeric(5,2) DEFAULT 0;

-- Check-in group block
CREATE OR REPLACE FUNCTION public.checkin_group_block(
  p_block_id uuid,
  p_lodge_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block public.group_blocks%ROWTYPE;
  v_room_record record;
  v_booked_count integer := 0;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  SELECT * INTO v_block FROM public.group_blocks WHERE id = p_block_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Group block not found');
  END IF;

  IF v_block.status NOT IN ('confirmed', 'partial') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Group block must be confirmed or partial to check in');
  END IF;

  FOR v_room_record IN
    SELECT gbr.id, gbr.room_id, gbr.booking_id
    FROM public.group_block_rooms gbr
    WHERE gbr.group_block_id = p_block_id AND gbr.status = 'booked'
  LOOP
    IF v_room_record.booking_id IS NOT NULL THEN
      UPDATE public.bookings SET status = 'checked_in', updated_at = now()
      WHERE id = v_room_record.booking_id AND lodge_id = p_lodge_id AND status = 'confirmed';
      IF FOUND THEN
        v_booked_count := v_booked_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'checked_in_count', v_booked_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkin_group_block(uuid, uuid, uuid) TO authenticated;

-- Checkout group block
CREATE OR REPLACE FUNCTION public.checkout_group_block(
  p_block_id uuid,
  p_lodge_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block public.group_blocks%ROWTYPE;
  v_checked_out_count integer := 0;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  SELECT * INTO v_block FROM public.group_blocks WHERE id = p_block_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Group block not found');
  END IF;

  UPDATE public.bookings SET status = 'checked_out', updated_at = now()
  WHERE corporate_account_id = v_block.corporate_account_id
    AND lodge_id = p_lodge_id
    AND status = 'checked_in'
    AND check_in >= v_block.check_in
    AND check_out <= v_block.check_out;

  GET DIAGNOSTICS v_checked_out_count = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'checked_out_count', v_checked_out_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkout_group_block(uuid, uuid, uuid) TO authenticated;

-- Get group block pickup
CREATE OR REPLACE FUNCTION public.get_group_block_pickup(
  p_block_id uuid,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block public.group_blocks%ROWTYPE;
  v_rooms_used integer;
  v_rooms_remaining integer;
  v_pickup_pct numeric(5,2);
BEGIN
  SELECT * INTO v_block FROM public.group_blocks WHERE id = p_block_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Group block not found');
  END IF;

  SELECT count(*) INTO v_rooms_used
  FROM public.group_block_rooms
  WHERE group_block_id = p_block_id AND status IN ('booked', 'blocked');

  v_rooms_remaining := v_block.rooms_requested - v_rooms_used;
  v_pickup_pct := CASE WHEN v_block.rooms_requested > 0 THEN round((v_rooms_used::numeric / v_block.rooms_requested) * 100, 2) ELSE 0 END;

  RETURN jsonb_build_object(
    'success', true,
    'rooms_requested', v_block.rooms_requested,
    'rooms_used', v_rooms_used,
    'rooms_remaining', greatest(0, v_rooms_remaining),
    'pickup_pct', v_pickup_pct,
    'status', v_block.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_block_pickup(uuid, uuid) TO authenticated;

-- Release unsold group rooms
CREATE OR REPLACE FUNCTION public.release_unsold_group_rooms(
  p_block_id uuid,
  p_lodge_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block public.group_blocks%ROWTYPE;
  v_released_count integer := 0;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  SELECT * INTO v_block FROM public.group_blocks WHERE id = p_block_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Group block not found');
  END IF;

  UPDATE public.group_block_rooms SET status = 'released'
  WHERE group_block_id = p_block_id AND status = 'blocked';

  GET DIAGNOSTICS v_released_count = ROW_COUNT;

  UPDATE public.group_blocks SET status = 'released', updated_at = now()
  WHERE id = p_block_id;

  RETURN jsonb_build_object('success', true, 'released_count', v_released_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_unsold_group_rooms(uuid, uuid, uuid) TO authenticated;

-- Create bookings from rooming list
CREATE OR REPLACE FUNCTION public.create_bookings_from_rooming_list(
  p_list_id uuid,
  p_lodge_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_list public.rooming_lists%ROWTYPE;
  v_entry record;
  v_booking_id uuid;
  v_created integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  SELECT * INTO v_list FROM public.rooming_lists WHERE id = p_list_id AND lodge_id = p_lodge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rooming list not found');
  END IF;

  FOR v_entry IN
    SELECT * FROM public.rooming_list_entries
    WHERE rooming_list_id = p_list_id AND status = 'pending'
    ORDER BY row_number
  LOOP
    BEGIN
      v_booking_id := gen_random_uuid();
      INSERT INTO public.bookings (
        id, lodge_id, customer_name, guest_email, guest_phone,
        check_in, check_out, adults, children,
        status, booking_source, corporate_account_id,
        room_type_requested, room_id
      ) VALUES (
        v_booking_id, p_lodge_id, v_entry.guest_name, v_entry.guest_email, v_entry.guest_phone,
        v_entry.check_in, v_entry.check_out, v_entry.adults, v_entry.children,
        'confirmed', 'group_block', v_list.corporate_account_id,
        v_entry.room_type, v_entry.room_id
      );

      UPDATE public.rooming_list_entries SET
        status = 'booked', booking_id = v_booking_id
      WHERE id = v_entry.id;

      v_created := v_created + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_entry.row_number, 'error', SQLERRM);
      UPDATE public.rooming_list_entries SET
        status = 'failed', error_message = SQLERRM
      WHERE id = v_entry.id;
    END;
  END LOOP;

  UPDATE public.rooming_lists SET
    processed_rows = v_created,
    failed_rows = v_failed,
    status = CASE WHEN v_failed = 0 THEN 'completed' WHEN v_created > 0 THEN 'partial' ELSE 'failed' END,
    error_log = v_errors,
    updated_at = now()
  WHERE id = p_list_id;

  RETURN jsonb_build_object(
    'success', true,
    'created', v_created,
    'failed', v_failed,
    'errors', v_errors
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_bookings_from_rooming_list(uuid, uuid, uuid) TO authenticated;
