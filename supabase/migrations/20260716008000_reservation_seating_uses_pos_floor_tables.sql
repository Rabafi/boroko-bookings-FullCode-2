-- Restaurant reservations must seat parties against the canonical POS floor
-- table catalogue. The UI's available-table selector is sourced from pos_tables,
-- not the obsolete restaurant_tables lint-repair placeholder.

CREATE OR REPLACE FUNCTION public.seat_restaurant_reservation(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := NULLIF(payload->>'id', '')::uuid;
  v_lodge_id uuid := NULLIF(payload->>'lodge_id', '')::uuid;
  v_table_id uuid := NULLIF(payload->>'table_id', '')::uuid;
  v_reservation public.restaurant_reservations%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_id IS NULL OR v_lodge_id IS NULL OR v_table_id IS NULL THEN
    RAISE EXCEPTION 'Reservation, business, and table are required.' USING ERRCODE = '22023';
  END IF;

  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin', 'manager', 'supervisor']);

  SELECT * INTO v_reservation
  FROM public.restaurant_reservations
  WHERE id = v_id AND lodge_id = v_lodge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation was not found for this business.' USING ERRCODE = 'P0002';
  END IF;

  IF v_reservation.status = 'seated' THEN
    IF v_reservation.assigned_table_id = v_table_id THEN
      RETURN to_jsonb(v_reservation);
    END IF;
    RAISE EXCEPTION 'This reservation is already seated at another table.' USING ERRCODE = '23505';
  END IF;

  IF v_reservation.status NOT IN ('booked', 'confirmed') THEN
    RAISE EXCEPTION 'Only booked or confirmed reservations can be seated.' USING ERRCODE = '22023';
  END IF;

  -- This locks the same floor-table record that the selector and Till use.
  PERFORM 1
  FROM public.pos_tables
  WHERE id = v_table_id
    AND lodge_id = v_lodge_id
    AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an active table from this business floor plan.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.restaurant_reservations
    WHERE lodge_id = v_lodge_id
      AND assigned_table_id = v_table_id
      AND status = 'seated'
      AND id <> v_id
  ) THEN
    RAISE EXCEPTION 'Table is already occupied by another seated reservation.' USING ERRCODE = '23505';
  END IF;

  UPDATE public.restaurant_reservations
  SET status = 'seated',
      assigned_table_id = v_table_id,
      updated_by = public.app_current_user_id(),
      updated_at = now()
  WHERE id = v_id AND lodge_id = v_lodge_id
  RETURNING to_jsonb(public.restaurant_reservations.*) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.seat_restaurant_reservation(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seat_restaurant_reservation(jsonb) TO authenticated, service_role;
