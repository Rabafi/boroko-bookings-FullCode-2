-- Fix: "invalid UNION/INTERSECT/EXCEPT ORDER BY clause" in get_financial_exception_report
-- PostgreSQL cannot resolve column aliases from UNION ALL branches in RETURN QUERY ORDER BY.
-- Fix: wrap the UNION ALL in a CTE and ORDER BY on the outer query.

CREATE OR REPLACE FUNCTION public.get_financial_exception_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  exception_type text,
  severity text,
  entity_type text,
  entity_id text,
  entity_number text,
  description text,
  expected_value numeric,
  actual_value numeric,
  variance numeric,
  detected_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF p_lodge_id IS NULL THEN RAISE EXCEPTION 'lodge_id is required'; END IF;
  IF p_start_date IS NULL THEN RAISE EXCEPTION 'start_date is required'; END IF;
  IF p_end_date IS NULL THEN RAISE EXCEPTION 'end_date is required'; END IF;
  IF p_end_date < p_start_date THEN RAISE EXCEPTION 'end_date cannot be before start_date'; END IF;
  IF NOT public.app_lodge_access(p_lodge_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;

  RETURN QUERY
  WITH exceptions AS (
    -- Bookings without invoice number
    SELECT
      'booking_without_invoice'::text AS exception_type,
      'warning'::text AS severity,
      'booking'::text AS entity_type,
      b.id::text AS entity_id,
      b.booking_number::text AS entity_number,
      'Booking has no invoice number'::text AS description,
      NULL::numeric AS expected_value,
      NULL::numeric AS actual_value,
      NULL::numeric AS variance,
      NOW() AS detected_at
    FROM public.bookings b
    WHERE b.lodge_id = p_lodge_id
      AND b.check_in >= p_start_date AND b.check_in <= p_end_date
      AND b.status NOT IN ('cancelled', 'pending')
      AND (b.invoice_number IS NULL OR b.invoice_number = '')

    UNION ALL

    -- Amount paid inconsistent with payment ledger (signed sum)
    SELECT
      'amount_paid_ledger_mismatch'::text,
      'critical'::text,
      'booking'::text,
      b.id::text,
      b.booking_number::text,
      'Booking amount_paid does not match payment ledger sum'::text,
      COALESCE(b.amount_paid, 0),
      COALESCE(ledger.net_ledger, 0),
      COALESCE(b.amount_paid, 0) - COALESCE(ledger.net_ledger, 0),
      NOW()
    FROM public.bookings b
    LEFT JOIN (
      SELECT
        p.booking_id,
        SUM(p.amount) AS net_ledger
      FROM public.payments p
      WHERE p.lodge_id = p_lodge_id
      GROUP BY p.booking_id
    ) ledger ON ledger.booking_id = b.id
    WHERE b.lodge_id = p_lodge_id
      AND b.check_in >= p_start_date AND b.check_in <= p_end_date
      AND b.status NOT IN ('cancelled', 'pending')
      AND ABS(COALESCE(b.amount_paid, 0) - COALESCE(ledger.net_ledger, 0)) > 0.01

    UNION ALL

    -- Negative balance (overpaid)
    SELECT
      'negative_balance'::text,
      'warning'::text,
      'booking'::text,
      b.id::text,
      b.booking_number::text,
      'Booking has a negative balance (overpayment)'::text,
      0,
      COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) - COALESCE(b.amount_paid, 0),
      COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) - COALESCE(b.amount_paid, 0),
      NOW()
    FROM public.bookings b
    WHERE b.lodge_id = p_lodge_id
      AND b.check_in >= p_start_date AND b.check_in <= p_end_date
      AND b.status NOT IN ('cancelled', 'pending')
      AND (COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) - COALESCE(b.amount_paid, 0)) < -0.01

    UNION ALL

    -- Refund without approval record
    SELECT
      'refund_without_approval'::text,
      'critical'::text,
      'payment'::text,
      p.id::text,
      NULL::text,
      'Negative payment (refund) exists without matching approval record'::text,
      NULL,
      ABS(p.amount),
      NULL,
      NOW()
    FROM public.payments p
    WHERE p.lodge_id = p_lodge_id
      AND p.paid_at >= (p_start_date || 'T00:00:00')::timestamptz
      AND p.paid_at <= (p_end_date || 'T23:59:59')::timestamptz
      AND (p.amount < 0 OR p.type = 'refund')
      AND NOT EXISTS (
        SELECT 1 FROM public.refund_approval_log pal
        WHERE pal.booking_id = p.booking_id
          AND pal.lodge_id = p_lodge_id
      )

    UNION ALL

    -- Cancelled paid booking with unresolved settlement
    SELECT
      'cancelled_unresolved'::text,
      'warning'::text,
      'booking'::text,
      b.id::text,
      b.booking_number::text,
      'Cancelled booking had payments but no refund or retention record'::text,
      COALESCE(b.amount_paid, 0),
      0,
      COALESCE(b.amount_paid, 0),
      NOW()
    FROM public.bookings b
    WHERE b.lodge_id = p_lodge_id
      AND b.status = 'cancelled'
      AND b.cancelled_at >= (p_start_date || 'T00:00:00')::timestamptz
      AND b.cancelled_at <= (p_end_date || 'T23:59:59')::timestamptz
      AND COALESCE(b.amount_paid, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.refund_approval_log pal
        WHERE pal.booking_id = b.id AND pal.lodge_id = p_lodge_id
      )
  )
  SELECT
    e.exception_type,
    e.severity,
    e.entity_type,
    e.entity_id,
    e.entity_number,
    e.description,
    e.expected_value,
    e.actual_value,
    e.variance,
    e.detected_at
  FROM exceptions e
  ORDER BY e.severity DESC, e.detected_at DESC;
END;
$$;
