-- 20260703230000_room_moves_foundation.sql
-- Audited, idempotent hotel room moves for checked-in/active bookings.

CREATE TABLE IF NOT EXISTS public.room_move_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL REFERENCES public.settings(lodge_id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  guest_name text NOT NULL DEFAULT 'Guest',
  from_room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  from_room_number text,
  to_room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
  to_room_number text NOT NULL,
  reason text NOT NULL DEFAULT '',
  moved_by uuid REFERENCES auth.users(id),
  moved_by_name text,
  idempotency_key text NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  moved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.room_move_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS room_move_log_lodge_policy ON public.room_move_log;
CREATE POLICY room_move_log_lodge_policy ON public.room_move_log
  USING (public.app_lodge_access(lodge_id));

CREATE UNIQUE INDEX IF NOT EXISTS room_move_log_lodge_idempotency_idx
  ON public.room_move_log(lodge_id, idempotency_key);

CREATE INDEX IF NOT EXISTS room_move_log_lodge_booking_idx
  ON public.room_move_log(lodge_id, booking_id, moved_at DESC);

GRANT SELECT ON public.room_move_log TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.move_booking_room(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_target_room_id uuid,
  p_reason text DEFAULT '',
  p_idempotency_key text DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%rowtype;
  v_existing public.room_move_log%rowtype;
  v_source_room public.rooms%rowtype;
  v_target_room public.rooms%rowtype;
  v_guest_name text;
  v_payload jsonb;
  v_move_id uuid;
BEGIN
  IF p_booking_id IS NULL OR p_lodge_id IS NULL OR p_target_room_id IS NULL THEN
    RAISE EXCEPTION 'booking, lodge, and target room are required';
  END IF;

  IF coalesce(btrim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'idempotency key is required';
  END IF;

  PERFORM public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  SELECT *
    INTO v_existing
    FROM public.room_move_log
   WHERE lodge_id = p_lodge_id
     AND idempotency_key = p_idempotency_key
   LIMIT 1;

  v_payload := jsonb_build_object(
    'booking_id', p_booking_id,
    'target_room_id', p_target_room_id,
    'reason', coalesce(p_reason, ''),
    'expected_updated_at', p_expected_updated_at
  );

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.booking_id = p_booking_id
       AND v_existing.to_room_id = p_target_room_id
       AND coalesce(v_existing.reason, '') = coalesce(p_reason, '') THEN
      RETURN jsonb_build_object(
        'success', true,
        'id', v_existing.id,
        'already_applied', true,
        'from_room_number', v_existing.from_room_number,
        'to_room_number', v_existing.to_room_number
      );
    END IF;
    RAISE EXCEPTION 'idempotency key was already used for a different room move';
  END IF;

  SELECT *
    INTO v_booking
    FROM public.bookings
   WHERE id = p_booking_id
     AND lodge_id = p_lodge_id
   FOR UPDATE;

  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF coalesce(v_booking.status, '') IN ('cancelled', 'checked_out', 'no_show') THEN
    RAISE EXCEPTION 'Cannot move a booking in status %', v_booking.status;
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_booking.updated_at IS NOT NULL
     AND v_booking.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'Booking changed since this move was prepared. Refresh and try again.';
  END IF;

  SELECT *
    INTO v_source_room
    FROM public.rooms
   WHERE id = v_booking.room_id
     AND lodge_id = p_lodge_id
   FOR UPDATE;

  SELECT *
    INTO v_target_room
    FROM public.rooms
   WHERE id = p_target_room_id
     AND lodge_id = p_lodge_id
   FOR UPDATE;

  IF v_target_room.id IS NULL THEN
    RAISE EXCEPTION 'Target room not found';
  END IF;

  IF v_booking.room_id = p_target_room_id THEN
    RAISE EXCEPTION 'Booking is already assigned to the target room';
  END IF;

  IF coalesce(v_target_room.status, 'available') = 'maintenance' THEN
    RAISE EXCEPTION 'Target room is under maintenance';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.bookings b
     WHERE b.lodge_id = p_lodge_id
       AND b.id <> p_booking_id
       AND b.room_id = p_target_room_id
       AND coalesce(b.status, '') NOT IN ('cancelled', 'checked_out', 'no_show')
       AND b.check_in < v_booking.check_out
       AND b.check_out > v_booking.check_in
     FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Target room has a booking conflict for the stay dates';
  END IF;

  v_guest_name := coalesce(v_booking.customer_name, v_booking.guest_name, 'Guest');

  UPDATE public.bookings
     SET room_id = p_target_room_id,
         room_number = v_target_room.room_number,
         updated_at = now()
   WHERE id = p_booking_id
     AND lodge_id = p_lodge_id;

  UPDATE public.rooms
     SET status = 'dirty',
         updated_at = now()
   WHERE id = v_source_room.id
     AND lodge_id = p_lodge_id
     AND coalesce(status, '') = 'occupied';

  UPDATE public.rooms
     SET status = 'occupied',
         updated_at = now()
   WHERE id = v_target_room.id
     AND lodge_id = p_lodge_id;

  INSERT INTO public.room_move_log (
    lodge_id, booking_id, guest_name,
    from_room_id, from_room_number,
    to_room_id, to_room_number,
    reason, moved_by, moved_by_name,
    idempotency_key, request_payload
  ) VALUES (
    p_lodge_id, p_booking_id, v_guest_name,
    v_source_room.id, v_source_room.room_number,
    v_target_room.id, v_target_room.room_number,
    coalesce(p_reason, ''), p_actor_id, coalesce(auth.email(), 'system'),
    p_idempotency_key, v_payload
  )
  RETURNING id INTO v_move_id;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_move_id,
    'from_room_number', v_source_room.room_number,
    'to_room_number', v_target_room.room_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_booking_room(uuid, uuid, uuid, text, text, timestamptz, uuid) TO authenticated;
