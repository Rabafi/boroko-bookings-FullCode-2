CREATE OR REPLACE FUNCTION update_booking_payment(
  p_booking_id UUID,
  p_lodge_id UUID,
  p_amount NUMERIC,
  p_method TEXT
) RETURNS JSONB AS $$
DECLARE
  v_booking bookings%ROWTYPE;
  v_new_paid NUMERIC;
  v_status TEXT;
BEGIN
  -- Row-level lock for atomic concurrent updates
  SELECT * INTO v_booking FROM bookings
    WHERE id = p_booking_id AND lodge_id = p_lodge_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Add the new payment amount (delta)
  v_new_paid := COALESCE(v_booking.amount_paid, 0) + p_amount;
  
  -- Calculate new payment_status
  v_status := CASE
    WHEN v_new_paid >= v_booking.total_amount THEN 'paid'
    WHEN v_new_paid > 0 THEN 'partial'
    ELSE 'unpaid'
  END;

  -- Update atomic row
  UPDATE bookings SET
    amount_paid = v_new_paid,
    payment_status = v_status,
    payment_method = COALESCE(p_method, payment_method),
    updated_at = NOW()
  WHERE id = p_booking_id AND lodge_id = p_lodge_id;

  RETURN jsonb_build_object(
    'success', true, 
    'amount_paid', v_new_paid, 
    'payment_status', v_status
  );
END;
$$ LANGUAGE plpgsql;
