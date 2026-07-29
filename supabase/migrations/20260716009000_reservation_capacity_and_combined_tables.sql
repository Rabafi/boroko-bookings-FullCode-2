-- A reservation can occupy one or more POS floor tables. Capacity is enforced
-- server-side, and the Floor view receives the same seating occupancy.

CREATE TABLE IF NOT EXISTS public.restaurant_reservation_table_assignments (
  reservation_id uuid NOT NULL REFERENCES public.restaurant_reservations(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.pos_tables(id) ON DELETE RESTRICT,
  lodge_id uuid NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reservation_id, table_id)
);

CREATE INDEX IF NOT EXISTS restaurant_reservation_table_assignments_table_active_idx
  ON public.restaurant_reservation_table_assignments (lodge_id, table_id);

ALTER TABLE public.restaurant_reservation_table_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.seat_restaurant_reservation(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid := NULLIF(payload->>'id', '')::uuid;
  v_lodge_id uuid := NULLIF(payload->>'lodge_id', '')::uuid;
  v_table_ids uuid[];
  v_reservation public.restaurant_reservations%ROWTYPE;
  v_table_count integer;
  v_total_seats integer;
  v_result jsonb;
BEGIN
  SELECT array_agg(DISTINCT value::uuid ORDER BY value::uuid)
  INTO v_table_ids
  FROM jsonb_array_elements_text(COALESCE(payload->'table_ids', '[]'::jsonb)) AS item(value)
  WHERE NULLIF(value, '') IS NOT NULL;

  IF v_id IS NULL OR v_lodge_id IS NULL OR COALESCE(cardinality(v_table_ids), 0) = 0 THEN
    RAISE EXCEPTION 'Reservation, business, and at least one table are required.' USING ERRCODE = '22023';
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
    IF NOT EXISTS (
      SELECT 1 FROM public.restaurant_reservation_table_assignments
      WHERE reservation_id = v_id
    ) AND v_reservation.assigned_table_id = ANY(v_table_ids) THEN
      RETURN to_jsonb(v_reservation);
    END IF;
    RAISE EXCEPTION 'This reservation is already seated. Do not assign it to another table.' USING ERRCODE = '23505';
  END IF;

  IF v_reservation.status NOT IN ('booked', 'confirmed') THEN
    RAISE EXCEPTION 'Only booked or confirmed reservations can be seated.' USING ERRCODE = '22023';
  END IF;

  -- Lock selected tables in a stable order before validating capacity or occupancy.
  PERFORM 1
  FROM public.pos_tables
  WHERE id = ANY(v_table_ids) AND lodge_id = v_lodge_id AND active = true
  ORDER BY id
  FOR UPDATE;

  SELECT count(*), COALESCE(sum(seats), 0)
  INTO v_table_count, v_total_seats
  FROM public.pos_tables
  WHERE id = ANY(v_table_ids) AND lodge_id = v_lodge_id AND active = true;

  IF v_table_count <> cardinality(v_table_ids) THEN
    RAISE EXCEPTION 'Choose only active tables from this business floor plan.' USING ERRCODE = '42501';
  END IF;

  IF v_total_seats < v_reservation.party_size THEN
    RAISE EXCEPTION 'Selected tables seat % guests, but this reservation has % guests. Choose a larger table or combine tables.', v_total_seats, v_reservation.party_size USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.restaurant_reservations r
    LEFT JOIN public.restaurant_reservation_table_assignments a ON a.reservation_id = r.id
    WHERE r.lodge_id = v_lodge_id
      AND r.status = 'seated'
      AND r.id <> v_id
      AND (r.assigned_table_id = ANY(v_table_ids) OR a.table_id = ANY(v_table_ids))
  ) THEN
    RAISE EXCEPTION 'One of the selected tables is already occupied by another seated reservation.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.restaurant_reservation_table_assignments (reservation_id, table_id, lodge_id, assigned_by)
  SELECT v_id, table_id, v_lodge_id, public.app_current_user_id()
  FROM unnest(v_table_ids) AS table_id;

  UPDATE public.restaurant_reservations
  SET status = 'seated',
      assigned_table_id = v_table_ids[1],
      updated_by = public.app_current_user_id(),
      updated_at = now()
  WHERE id = v_id AND lodge_id = v_lodge_id
  RETURNING to_jsonb(public.restaurant_reservations.*) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_restaurant_floor_occupancy(p_lodge_id uuid)
RETURNS TABLE (table_id uuid, reservation_id uuid, customer_name text, party_size integer, seated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(a.table_id, r.assigned_table_id) AS table_id,
         r.id AS reservation_id,
         r.customer_name,
         r.party_size,
         r.updated_at AS seated_at
  FROM public.restaurant_reservations r
  LEFT JOIN public.restaurant_reservation_table_assignments a ON a.reservation_id = r.id
  WHERE r.lodge_id = p_lodge_id
    AND r.status = 'seated'
    AND COALESCE(a.table_id, r.assigned_table_id) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.seat_restaurant_reservation(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seat_restaurant_reservation(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_restaurant_floor_occupancy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_floor_occupancy(uuid) TO authenticated, service_role;
