-- Migration: Add informational fields to create_booking RPC
-- These fields are for record-keeping only.
-- amount_paid is NOT touched here — it is updated via update_booking_payment RPC only.

CREATE OR REPLACE FUNCTION create_booking(
  p_lodge_id        UUID,
  p_customer_id     UUID,
  p_room_id         UUID,
  p_check_in        DATE,
  p_check_out       DATE,
  p_adults          INT,
  p_children        INT,
  p_total_amount    NUMERIC,
  -- Informational fields (new, optional, no financial effect)
  p_invoice_number  TEXT    DEFAULT NULL,
  p_notes           TEXT    DEFAULT '',
  p_created_by      UUID    DEFAULT NULL,
  p_deposit_amount  NUMERIC DEFAULT 0  -- stored for reference; amount_paid NOT touched here
) RETURNS JSONB AS $$
DECLARE
  v_conflict INT;
  v_id       UUID := gen_random_uuid();
BEGIN
  -- Check for room conflict
  SELECT COUNT(*) INTO v_conflict
  FROM bookings
  WHERE room_id = p_room_id
    AND lodge_id = p_lodge_id
    AND status != 'cancelled'
    AND NOT (check_out <= p_check_in OR check_in >= p_check_out);

  IF v_conflict > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
  END IF;

  INSERT INTO bookings (
    id, lodge_id, customer_id, room_id,
    check_in, check_out, adults, children,
    total_amount, amount_paid, payment_status,
    status, invoice_number, notes, created_by,
    deposit_amount, payment_method,
    created_at, updated_at
  ) VALUES (
    v_id, p_lodge_id, p_customer_id, p_room_id,
    p_check_in, p_check_out, p_adults, p_children,
    p_total_amount, 0, 'unpaid',
    'confirmed', p_invoice_number, p_notes, p_created_by,
    p_deposit_amount, NULL,
    NOW(), NOW()
  );

  RETURN jsonb_build_object('success', true, 'booking_id', v_id);
END;
$$ LANGUAGE plpgsql;
