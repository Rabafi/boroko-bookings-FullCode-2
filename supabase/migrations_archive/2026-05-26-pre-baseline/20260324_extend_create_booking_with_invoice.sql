-- Step D: Extend create_booking to atomically create the invoice
-- Invoice is created in the same transaction as the booking — never separately.
-- Backward compatible: same params as previous migration, no breaking changes.

CREATE OR REPLACE FUNCTION create_booking(
  p_lodge_id        UUID,
  p_customer_id     UUID,
  p_room_id         UUID,
  p_check_in        DATE,
  p_check_out       DATE,
  p_adults          INT,
  p_children        INT,
  p_total_amount    NUMERIC,
  p_invoice_number  TEXT    DEFAULT NULL,
  p_notes           TEXT    DEFAULT '',
  p_created_by      UUID    DEFAULT NULL,
  p_deposit_amount  NUMERIC DEFAULT 0
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

  -- Insert booking (amount_paid starts at 0 — deposit applied separately via update_booking_payment)
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

  -- Create invoice atomically (same transaction)
  INSERT INTO invoices (
    booking_id, lodge_id, invoice_number, issued_at
  ) VALUES (
    v_id, p_lodge_id, p_invoice_number, NOW()
  );

  RETURN jsonb_build_object('success', true, 'booking_id', v_id);
END;
$$ LANGUAGE plpgsql;
