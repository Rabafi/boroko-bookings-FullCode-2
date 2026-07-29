-- Reservation deposits are financial custody records. They must always retain
-- the canonical desktop staff identity and reject a reused payment reference.

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_reservation_deposits_lodge_reference_unique
  ON public.restaurant_reservation_deposits (lodge_id, lower(reference))
  WHERE reference IS NOT NULL AND btrim(reference) <> '';

CREATE OR REPLACE FUNCTION public.record_restaurant_reservation_deposit(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lodge_id uuid := NULLIF(p_payload->>'lodge_id', '')::uuid;
  v_reservation_id uuid := NULLIF(p_payload->>'reservation_id', '')::uuid;
  v_actor_id uuid := public.app_current_user_id();
  v_amount numeric := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
  v_method text := NULLIF(p_payload->>'method', '');
  v_reference text := NULLIF(btrim(COALESCE(p_payload->>'reference', '')), '');
  v_key text := NULLIF(p_payload->>'idempotency_key', '');
  v_existing public.restaurant_reservation_deposits%ROWTYPE;
  v_reservation_status text;
  v_id uuid;
BEGIN
  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin', 'manager', 'supervisor']);

  IF v_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = v_actor_id AND lodge_id = v_lodge_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your staff session could not be verified. Sign in again before holding a deposit.');
  END IF;

  IF v_key IS NULL OR length(v_key) < 8 THEN
    RAISE EXCEPTION 'A stable deposit idempotency key is required.' USING ERRCODE = '22023';
  END IF;
  IF v_reservation_id IS NULL OR v_amount <= 0 OR v_method IS NULL OR v_reference IS NULL THEN
    RAISE EXCEPTION 'Reservation, positive amount, payment method, and payment reference are required.' USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_reservation_status
  FROM public.restaurant_reservations
  WHERE id = v_reservation_id AND lodge_id = v_lodge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found for this business.' USING ERRCODE = 'P0002';
  END IF;
  IF v_reservation_status NOT IN ('booked', 'confirmed') THEN
    RAISE EXCEPTION 'Deposits can only be held for an upcoming booked or confirmed reservation.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.restaurant_reservation_deposits
  WHERE lodge_id = v_lodge_id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.reservation_id <> v_reservation_id OR v_existing.amount <> v_amount OR v_existing.method <> v_method OR COALESCE(v_existing.reference, '') <> v_reference THEN
      RAISE EXCEPTION 'Deposit idempotency key was already used with a different payload.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('success', true, 'id', v_existing.id, 'duplicate', true, 'status', v_existing.status);
  END IF;

  SELECT * INTO v_existing
  FROM public.restaurant_reservation_deposits
  WHERE lodge_id = v_lodge_id AND lower(reference) = lower(v_reference);
  IF FOUND THEN
    IF v_existing.reservation_id = v_reservation_id AND v_existing.amount = v_amount AND v_existing.method = v_method THEN
      RETURN jsonb_build_object('success', true, 'id', v_existing.id, 'duplicate', true, 'status', v_existing.status);
    END IF;
    RAISE EXCEPTION 'This payment reference is already recorded against another deposit.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.restaurant_reservation_deposits (
    lodge_id, reservation_id, amount, method, reference, notes, received_by, idempotency_key
  ) VALUES (
    v_lodge_id, v_reservation_id, v_amount, v_method, v_reference,
    NULLIF(p_payload->>'notes', ''), v_actor_id, v_key
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'status', 'held');
END;
$$;

REVOKE ALL ON FUNCTION public.record_restaurant_reservation_deposit(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_restaurant_reservation_deposit(jsonb) TO authenticated, service_role;
