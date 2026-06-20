-- Fix: STRING_AGG with DISTINCT requires ORDER BY to match the DISTINCT expression.
-- This caused "in an aggregate with DISTINCT, ORDER BY expressions must appear in argument list"

-- 1. Fix get_booking_register_report: STRING_AGG ORDER BY mismatch
CREATE OR REPLACE FUNCTION public.get_booking_register_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  booking_id uuid,
  booking_number text,
  invoice_number text,
  guest_name text,
  guest_phone text,
  guest_email text,
  room_number text,
  room_type text,
  booking_type text,
  booking_source text,
  quotation_number text,
  check_in date,
  check_out date,
  nights integer,
  adults integer,
  children integer,
  booking_status text,
  payment_status text,
  payment_method_summary text,
  accommodation_amount numeric,
  folio_charges numeric,
  gross_total numeric,
  lifetime_amount_paid numeric,
  balance_due numeric,
  vat_rate numeric,
  vat_amount numeric,
  net_excluding_vat numeric,
  created_at timestamptz,
  created_by text,
  notes text
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
  WITH booking_payments AS (
    SELECT
      p.booking_id,
      COALESCE(SUM(p.amount), 0) AS net_paid,
      COALESCE(SUM(CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END), 0) AS positive_paid,
      COALESCE(SUM(CASE WHEN p.amount < 0 THEN ABS(p.amount) ELSE 0 END), 0) AS refunded,
      STRING_AGG(DISTINCT CASE WHEN p.amount > 0 THEN p.method END, ', ' ORDER BY CASE WHEN p.amount > 0 THEN p.method END) AS positive_methods
    FROM public.payments p
    WHERE p.lodge_id = p_lodge_id
    GROUP BY p.booking_id
  ),
  event_groups AS (
    SELECT
      b.id AS booking_id,
      CASE WHEN b.is_exclusive_event THEN
        COALESCE(
          NULLIF(regexp_replace(COALESCE(b.notes, ''), '.*\[GROUP:([^\]]+)\].*', '\1', ''), ''),
          b.id::text
        )
      ELSE NULL END AS group_id
    FROM public.bookings b
    WHERE b.lodge_id = p_lodge_id
  ),
  grouped_events AS (
    SELECT
      eg.group_id,
      MIN(b.check_in) AS check_in,
      MAX(b.check_out) AS check_out,
      COUNT(*) AS room_count,
      SUM(COALESCE(b.total_amount, 0)) AS total_amount,
      SUM(COALESCE(b.charges_total, 0)) AS charges_total,
      SUM(COALESCE(bp.net_paid, 0)) AS amount_paid,
      STRING_AGG(DISTINCT NULLIF(bp.positive_methods, ''), ', ') AS payment_methods,
      BOOL_OR(COALESCE(b.vat_enabled, false)) AS vat_enabled,
      MIN(b.vat_rate) AS vat_rate,
      MIN(b.notes) AS notes,
      MIN(b.created_at) AS created_at,
      MIN(b.created_by::text) AS created_by,
      MIN(b.status) AS status,
      MIN(b.payment_status) AS payment_status,
      (ARRAY_AGG(b.customer_id ORDER BY b.created_at) FILTER (WHERE b.customer_id IS NOT NULL))[1] AS customer_id,
      MIN(b.adults) AS adults,
      MIN(b.children) AS children,
      MIN(b.source) AS booking_source,
      STRING_AGG(DISTINCT b.booking_number::text, ', ' ORDER BY b.booking_number::text) AS booking_numbers,
      STRING_AGG(DISTINCT b.invoice_number, ', ' ORDER BY b.invoice_number) AS invoice_numbers,
      STRING_AGG(DISTINCT q.quotation_number, ', ' ORDER BY q.quotation_number) AS quotation_numbers
    FROM public.bookings b
    JOIN event_groups eg ON b.id = eg.booking_id
    LEFT JOIN booking_payments bp ON bp.booking_id = b.id
    LEFT JOIN public.quotations q ON q.id = b.quotation_id
    WHERE b.lodge_id = p_lodge_id
      AND eg.group_id IS NOT NULL
      AND b.check_in >= p_start_date AND b.check_in <= p_end_date
    GROUP BY eg.group_id
  )
  SELECT
    b.id AS booking_id,
    b.booking_number::text,
    b.invoice_number,
    COALESCE(c.name, 'Guest') AS guest_name,
    c.phone AS guest_phone,
    c.email AS guest_email,
    rm.room_number,
    rm.room_type,
    CASE WHEN b.is_exclusive_event THEN 'event' ELSE 'room' END AS booking_type,
    COALESCE(b.source, 'direct') AS booking_source,
    q.quotation_number,
    b.check_in,
    b.check_out,
    GREATEST(1, (b.check_out - b.check_in))::integer AS nights,
    COALESCE(b.adults, 1) AS adults,
    COALESCE(b.children, 0) AS children,
    b.status AS booking_status,
    b.payment_status,
    CASE
      WHEN bp.positive_methods IS NULL OR bp.positive_methods = '' THEN 'None'
      WHEN bp.positive_methods LIKE '%,%' THEN 'Mixed'
      ELSE bp.positive_methods
    END AS payment_method_summary,
    COALESCE(b.total_amount, 0) AS accommodation_amount,
    COALESCE(b.charges_total, 0) AS folio_charges,
    COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) AS gross_total,
    COALESCE(bp.net_paid, 0) AS lifetime_amount_paid,
    GREATEST(0, COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) - COALESCE(bp.net_paid, 0)) AS balance_due,
    CASE WHEN b.vat_enabled AND COALESCE(b.vat_rate, 0) > 0 THEN b.vat_rate ELSE 0 END AS vat_rate,
    CASE WHEN b.vat_enabled AND COALESCE(b.vat_rate, 0) > 0
      THEN ROUND((COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0)) * b.vat_rate / (100 + b.vat_rate), 2)
      ELSE 0 END AS vat_amount,
    CASE WHEN b.vat_enabled AND COALESCE(b.vat_rate, 0) > 0
      THEN ROUND((COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0)) * 100 / (100 + b.vat_rate), 2)
      ELSE COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) END AS net_excluding_vat,
    b.created_at,
    b.created_by::text,
    b.notes
  FROM public.bookings b
  LEFT JOIN public.customers c ON b.customer_id = c.id
  LEFT JOIN public.rooms rm ON b.room_id = rm.id
  LEFT JOIN booking_payments bp ON bp.booking_id = b.id
  LEFT JOIN public.quotations q ON b.quotation_id = q.id
  WHERE b.lodge_id = p_lodge_id
    AND b.check_in >= p_start_date AND b.check_in <= p_end_date
    AND b.is_exclusive_event = false

  UNION ALL

  SELECT
    NULL::uuid AS booking_id,
    ge.booking_numbers AS booking_number,
    ge.invoice_numbers AS invoice_number,
    COALESCE(c.name, 'Guest') AS guest_name,
    c.phone AS guest_phone,
    c.email AS guest_email,
    NULL::text AS room_number,
    'Full Lodge' AS room_type,
    'event' AS booking_type,
    'event' AS booking_source,
    ge.quotation_numbers AS quotation_number,
    ge.check_in::date,
    ge.check_out::date,
    GREATEST(1, (ge.check_out::date - ge.check_in::date))::integer AS nights,
    0 AS adults,
    0 AS children,
    ge.status AS booking_status,
    ge.payment_status,
    CASE
      WHEN ge.payment_methods IS NULL OR ge.payment_methods = '' THEN 'None'
      WHEN ge.payment_methods LIKE '%,%' THEN 'Mixed'
      ELSE ge.payment_methods
    END AS payment_method_summary,
    ge.total_amount AS accommodation_amount,
    ge.charges_total AS folio_charges,
    ge.total_amount + ge.charges_total AS gross_total,
    ge.amount_paid AS lifetime_amount_paid,
    GREATEST(0, ge.total_amount + ge.charges_total - ge.amount_paid) AS balance_due,
    CASE WHEN ge.vat_enabled AND COALESCE(ge.vat_rate, 0) > 0 THEN ge.vat_rate ELSE 0 END AS vat_rate,
    CASE WHEN ge.vat_enabled AND COALESCE(ge.vat_rate, 0) > 0
      THEN ROUND((ge.total_amount + ge.charges_total) * ge.vat_rate / (100 + ge.vat_rate), 2)
      ELSE 0 END AS vat_amount,
    CASE WHEN ge.vat_enabled AND COALESCE(ge.vat_rate, 0) > 0
      THEN ROUND((ge.total_amount + ge.charges_total) * 100 / (100 + ge.vat_rate), 2)
      ELSE ge.total_amount + ge.charges_total END AS net_excluding_vat,
    ge.created_at,
    ge.created_by,
    ge.notes
  FROM grouped_events ge
  LEFT JOIN public.customers c ON ge.customer_id = c.id

  ORDER BY check_in, booking_number;
END;
$$;
