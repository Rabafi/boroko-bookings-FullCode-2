-- Step C: Extend update_booking_payment RPC
-- Adds: payment record insert (atomic with bookings.amount_paid update)
--       idempotency check (safe offline sync replay)
--       type param (deposit / payment / refund)
-- Backward compatible: new params have safe defaults, existing callers unchanged.

CREATE OR REPLACE FUNCTION update_booking_payment(
  p_booking_id      UUID,
  p_lodge_id        UUID,
  p_amount          NUMERIC,
  p_method          TEXT,
  p_type            TEXT    DEFAULT 'payment',
  p_idempotency_key TEXT    DEFAULT NULL,
  p_recorded_by     UUID    DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_booking  bookings%ROWTYPE;
  v_new_paid NUMERIC;
  v_status   TEXT;
BEGIN
  -- Idempotency check: if this key was already processed, return current state
  IF p_idempotency_key IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM payments WHERE idempotency_key = p_idempotency_key) THEN
      SELECT amount_paid, payment_status INTO v_new_paid, v_status
        FROM bookings WHERE id = p_booking_id;
      RETURN jsonb_build_object(
        'success',        true,
        'amount_paid',    v_new_paid,
        'payment_status', v_status,
        'idempotent',     true
      );
    END IF;
  END IF;

  -- Row-level lock for atomic concurrent updates
  SELECT * INTO v_booking FROM bookings
    WHERE id = p_booking_id AND lodge_id = p_lodge_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Increment amount_paid (delta-based)
  v_new_paid := COALESCE(v_booking.amount_paid, 0) + p_amount;

  -- Derive payment_status against total_amount + charges_total (canonical amount owed).
  -- COALESCE guards against NULL charges_total on older rows.
  v_status := CASE
    WHEN v_new_paid >= (v_booking.total_amount + COALESCE(v_booking.charges_total, 0)) THEN 'paid'
    WHEN v_new_paid > 0                                                                  THEN 'partial'
    ELSE 'unpaid'
  END;

  -- Update booking (amount_paid is ONLY updated here — never directly)
  UPDATE bookings SET
    amount_paid    = v_new_paid,
    payment_status = v_status,
    payment_method = COALESCE(p_method, payment_method),
    updated_at     = NOW()
  WHERE id = p_booking_id AND lodge_id = p_lodge_id;

  -- Insert payment record (atomic — same transaction)
  INSERT INTO payments (
    booking_id, lodge_id, amount, method, type,
    paid_at, recorded_by, idempotency_key
  ) VALUES (
    p_booking_id, p_lodge_id, p_amount, p_method, p_type,
    NOW(), p_recorded_by, p_idempotency_key
  );

  RETURN jsonb_build_object(
    'success',        true,
    'amount_paid',    v_new_paid,
    'payment_status', v_status
  );
END;
$$ LANGUAGE plpgsql;
