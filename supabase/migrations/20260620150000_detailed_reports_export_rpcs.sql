-- Migration: Detailed Reports Export RPCs
-- Server-authoritative, lodge-scoped report functions for detailed Excel/PDF exports.

BEGIN;

-- Remove broken helper (no-op SQL returning void)
DROP FUNCTION IF EXISTS public.validate_lodge_access(uuid);

-- 1. Booking Register Report
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
      STRING_AGG(DISTINCT CASE WHEN p.amount > 0 THEN p.method END, ', ' ORDER BY p.method) AS positive_methods
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

-- 2. Payment Transaction Report
CREATE OR REPLACE FUNCTION public.get_payment_transaction_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  payment_id uuid,
  paid_at timestamptz,
  booking_number text,
  invoice_number text,
  guest_name text,
  transaction_type text,
  payment_method text,
  amount numeric,
  recorded_by text,
  idempotency_key text,
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
  SELECT
    p.id AS payment_id,
    p.paid_at,
    b.booking_number::text,
    b.invoice_number,
    COALESCE(c.name, 'Guest') AS guest_name,
    COALESCE(p.type, 'payment') AS transaction_type,
    COALESCE(p.method, 'unknown') AS payment_method,
    p.amount,
    p.recorded_by::text,
    p.idempotency_key,
    p.notes
  FROM public.payments p
  LEFT JOIN public.bookings b ON p.booking_id = b.id
  LEFT JOIN public.customers c ON b.customer_id = c.id
  WHERE p.lodge_id = p_lodge_id
    AND p.paid_at >= (p_start_date || 'T00:00:00')::timestamptz
    AND p.paid_at <= (p_end_date || 'T23:59:59')::timestamptz
  ORDER BY p.paid_at;
END;
$$;

-- 3. Cancelled Booking Report
CREATE OR REPLACE FUNCTION public.get_cancelled_booking_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  booking_id uuid,
  booking_number text,
  invoice_number text,
  guest_name text,
  room_number text,
  original_check_in date,
  original_check_out date,
  nights integer,
  original_total numeric,
  amount_paid_before numeric,
  cancelled_at timestamptz,
  cancellation_reason text,
  cancelled_by text,
  refund_amount numeric,
  retained_amount numeric,
  final_state text,
  booking_source text,
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
  SELECT
    b.id AS booking_id,
    b.booking_number::text,
    b.invoice_number,
    COALESCE(c.name, 'Guest') AS guest_name,
    rm.room_number,
    b.check_in AS original_check_in,
    b.check_out AS original_check_out,
    GREATEST(1, (b.check_out - b.check_in))::integer AS nights,
    COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) AS original_total,
    COALESCE(b.amount_paid, 0) AS amount_paid_before,
    b.cancelled_at,
    b.cancel_reason AS cancellation_reason,
    NULL::text AS cancelled_by,
    COALESCE(refund_sum.refund_total, 0) AS refund_amount,
    COALESCE(refund_sum.retained_total, 0) AS retained_amount,
    CASE
      WHEN COALESCE(b.amount_paid, 0) = 0 THEN 'no_payment'
      WHEN COALESCE(refund_sum.refund_total, 0) >= COALESCE(b.amount_paid, 0) THEN 'fully_refunded'
      ELSE 'partially_refunded'
    END AS final_state,
    COALESCE(b.source, 'direct') AS booking_source,
    b.notes
  FROM public.bookings b
  LEFT JOIN public.customers c ON b.customer_id = c.id
  LEFT JOIN public.rooms rm ON b.room_id = rm.id
  LEFT JOIN (
    SELECT
      pal.booking_id,
      SUM(CASE WHEN pal.refund_amount > 0 THEN pal.refund_amount ELSE 0 END) AS refund_total,
      SUM(COALESCE(pal.retained_amount, 0)) AS retained_total
    FROM public.refund_approval_log pal
    WHERE pal.lodge_id = p_lodge_id
    GROUP BY pal.booking_id
  ) refund_sum ON refund_sum.booking_id = b.id
  WHERE b.lodge_id = p_lodge_id
    AND b.status = 'cancelled'
    AND b.cancelled_at >= (p_start_date || 'T00:00:00')::timestamptz
    AND b.cancelled_at <= (p_end_date || 'T23:59:59')::timestamptz
  ORDER BY b.cancelled_at;
END;
$$;

-- 4. Refund Report
CREATE OR REPLACE FUNCTION public.get_refund_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  refund_id uuid,
  refund_timestamp timestamptz,
  booking_number text,
  invoice_number text,
  guest_name text,
  amount_paid_before numeric,
  refund_amount numeric,
  retained_amount numeric,
  retained_percentage numeric,
  refund_method text,
  requested_by text,
  approved_by text,
  proof_reference text,
  approval_note text,
  general_notes text,
  related_payment_id uuid
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
  SELECT
    pal.id AS refund_id,
    pal.created_at AS refund_timestamp,
    b.booking_number::text,
    b.invoice_number,
    COALESCE(c.name, 'Guest') AS guest_name,
    COALESCE(b.amount_paid, 0) AS amount_paid_before,
    COALESCE(pal.refund_amount, 0) AS refund_amount,
    COALESCE(pal.retained_amount, 0) AS retained_amount,
    COALESCE(pal.retained_percent, 0) AS retained_percentage,
    COALESCE(pal.method, 'original') AS refund_method,
    pal.requested_by::text,
    pal.approved_by::text,
    pal.proof_reference,
    pal.approval_note,
    pal.notes AS general_notes,
    NULL::uuid AS related_payment_id
  FROM public.refund_approval_log pal
  LEFT JOIN public.bookings b ON pal.booking_id = b.id
  LEFT JOIN public.customers c ON b.customer_id = c.id
  WHERE pal.lodge_id = p_lodge_id
    AND pal.created_at >= (p_start_date || 'T00:00:00')::timestamptz
    AND pal.created_at <= (p_end_date || 'T23:59:59')::timestamptz
  ORDER BY pal.created_at;
END;
$$;

-- 5. Outstanding Balance Report
CREATE OR REPLACE FUNCTION public.get_outstanding_balance_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  booking_id uuid,
  booking_number text,
  invoice_number text,
  guest_name text,
  room_number text,
  check_in date,
  check_out date,
  gross_total numeric,
  amount_paid numeric,
  balance_due numeric,
  payment_status text,
  booking_status text,
  due_date date,
  days_overdue integer,
  aging_bucket text,
  last_payment_date timestamptz,
  last_payment_method text
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
  WITH last_payments AS (
    SELECT DISTINCT ON (p.booking_id)
      p.booking_id,
      p.paid_at AS last_payment_date,
      p.method AS last_payment_method
    FROM public.payments p
    WHERE p.lodge_id = p_lodge_id AND p.amount > 0
    ORDER BY p.booking_id, p.paid_at DESC
  ),
  booking_ledger AS (
    SELECT
      b.id AS booking_id,
      b.booking_number::text,
      b.invoice_number,
      COALESCE(c.name, 'Guest') AS guest_name,
      rm.room_number,
      b.check_in,
      b.check_out,
      COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) AS gross_total,
      COALESCE(SUM(p.amount), 0) AS net_paid,
      b.payment_status,
      b.status AS booking_status
    FROM public.bookings b
    LEFT JOIN public.customers c ON b.customer_id = c.id
    LEFT JOIN public.rooms rm ON b.room_id = rm.id
    LEFT JOIN public.payments p ON p.booking_id = b.id AND p.lodge_id = p_lodge_id
    WHERE b.lodge_id = p_lodge_id
      AND b.status NOT IN ('cancelled', 'pending')
      AND b.check_in >= p_start_date AND b.check_in <= p_end_date
    GROUP BY b.id, b.booking_number, b.invoice_number, c.name, rm.room_number,
             b.check_in, b.check_out, b.total_amount, b.charges_total, b.payment_status, b.status
  )
  SELECT
    bl.booking_id,
    bl.booking_number,
    bl.invoice_number,
    bl.guest_name,
    bl.room_number,
    bl.check_in,
    bl.check_out,
    bl.gross_total,
    bl.net_paid AS amount_paid,
    GREATEST(0, bl.gross_total - bl.net_paid) AS balance_due,
    bl.payment_status,
    bl.booking_status,
    bl.check_out AS due_date,
    GREATEST(0, (CURRENT_DATE - bl.check_out))::integer AS days_overdue,
    CASE
      WHEN bl.check_out > CURRENT_DATE THEN 'not_yet_due'
      WHEN (CURRENT_DATE - bl.check_out) <= 7 THEN '1-7_days'
      WHEN (CURRENT_DATE - bl.check_out) <= 30 THEN '8-30_days'
      WHEN (CURRENT_DATE - bl.check_out) <= 60 THEN '31-60_days'
      ELSE 'over_60_days'
    END AS aging_bucket,
    lp.last_payment_date,
    lp.last_payment_method
  FROM booking_ledger bl
  LEFT JOIN last_payments lp ON lp.booking_id = bl.booking_id
  WHERE GREATEST(0, bl.gross_total - bl.net_paid) > 0
  ORDER BY
    CASE
      WHEN bl.check_out > CURRENT_DATE THEN 0
      WHEN (CURRENT_DATE - bl.check_out) <= 7 THEN 1
      WHEN (CURRENT_DATE - bl.check_out) <= 30 THEN 2
      WHEN (CURRENT_DATE - bl.check_out) <= 60 THEN 3
      ELSE 4
    END,
    GREATEST(0, bl.gross_total - bl.net_paid) DESC;
END;
$$;

-- 6. Quotation Report
CREATE OR REPLACE FUNCTION public.get_quotation_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  quotation_id uuid,
  quotation_number text,
  guest_name text,
  guest_phone text,
  guest_email text,
  quotation_type text,
  event_group_name text,
  event_daily_rate numeric,
  room_number text,
  check_in date,
  check_out date,
  nights integer,
  adults integer,
  children integer,
  subtotal numeric,
  tax numeric,
  total numeric,
  currency text,
  status text,
  valid_until date,
  created_at timestamptz,
  created_by text,
  parent_quotation_number text,
  converted_booking_number text,
  converted_invoice_number text,
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
  SELECT
    q.id AS quotation_id,
    q.quotation_number,
    COALESCE(c.name, q.customer_name, 'Guest') AS guest_name,
    COALESCE(c.phone, q.customer_phone) AS guest_phone,
    COALESCE(c.email) AS guest_email,
    COALESCE(q.quotation_type, 'room') AS quotation_type,
    q.event_name AS event_group_name,
    q.event_daily_rate,
    rm.room_number,
    q.check_in,
    q.check_out,
    GREATEST(1, (q.check_out - q.check_in))::integer AS nights,
    COALESCE(q.adults, 1) AS adults,
    COALESCE(q.children, 0) AS children,
    COALESCE(q.subtotal, q.total_amount, 0) AS subtotal,
    COALESCE(q.tax_amount, 0) AS tax,
    COALESCE(q.total_amount, 0) AS total,
    COALESCE(q.currency, 'PGK') AS currency,
    q.status,
    q.valid_until,
    q.created_at,
    q.created_by::text,
    pq.quotation_number AS parent_quotation_number,
    cb.booking_number::text AS converted_booking_number,
    cb.invoice_number AS converted_invoice_number,
    q.notes
  FROM public.quotations q
  LEFT JOIN public.customers c ON q.customer_id = c.id
  LEFT JOIN public.rooms rm ON q.room_id = rm.id
  LEFT JOIN public.quotations pq ON q.parent_quotation_id = pq.id
  LEFT JOIN public.bookings cb ON q.converted_booking_id = cb.id
  WHERE q.lodge_id = p_lodge_id
    AND q.created_at >= (p_start_date || 'T00:00:00')::timestamptz
    AND q.created_at <= (p_end_date || 'T23:59:59')::timestamptz
  ORDER BY q.created_at;
END;
$$;

-- 7. Invoice Register Report
CREATE OR REPLACE FUNCTION public.get_invoice_register_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  invoice_number text,
  booking_number text,
  guest_name text,
  room_number text,
  check_in date,
  check_out date,
  nights integer,
  issued_date date,
  due_date date,
  accommodation_amount numeric,
  folio_charges numeric,
  gross_total numeric,
  amount_paid numeric,
  balance_due numeric,
  payment_status text,
  booking_status text,
  payment_count bigint,
  last_payment_date timestamptz,
  delivery_status text
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
  WITH payment_counts AS (
    SELECT
      p.booking_id,
      COUNT(*) AS payment_count,
      MAX(p.paid_at) AS last_payment_date
    FROM public.payments p
    WHERE p.lodge_id = p_lodge_id AND p.amount > 0
    GROUP BY p.booking_id
  ),
  invoice_latest AS (
    SELECT DISTINCT ON (inv.booking_id)
      inv.booking_id,
      inv.issued_at,
      inv.due_date,
      inv.invoice_number
    FROM public.invoices inv
    WHERE inv.lodge_id = p_lodge_id
    ORDER BY inv.booking_id, inv.issued_at DESC
  ),
  delivery_latest AS (
    SELECT DISTINCT ON (idl.booking_id)
      idl.booking_id,
      idl.delivery_status
    FROM public.invoice_delivery_log idl
    WHERE idl.lodge_id = p_lodge_id
    ORDER BY idl.booking_id, idl.created_at DESC
  )
  SELECT
    b.invoice_number,
    b.booking_number::text,
    COALESCE(c.name, 'Guest') AS guest_name,
    rm.room_number,
    b.check_in,
    b.check_out,
    GREATEST(1, (b.check_out - b.check_in))::integer AS nights,
    COALESCE(il.issued_at::date, b.created_at::date) AS issued_date,
    COALESCE(il.due_date, b.check_out) AS due_date,
    COALESCE(b.total_amount, 0) AS accommodation_amount,
    COALESCE(b.charges_total, 0) AS folio_charges,
    COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) AS gross_total,
    COALESCE(b.amount_paid, 0) AS amount_paid,
    GREATEST(0, COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) - COALESCE(b.amount_paid, 0)) AS balance_due,
    b.payment_status,
    b.status AS booking_status,
    COALESCE(pc.payment_count, 0) AS payment_count,
    pc.last_payment_date,
    COALESCE(dl.delivery_status, 'pending') AS delivery_status
  FROM public.bookings b
  LEFT JOIN public.customers c ON b.customer_id = c.id
  LEFT JOIN public.rooms rm ON b.room_id = rm.id
  LEFT JOIN payment_counts pc ON pc.booking_id = b.id
  LEFT JOIN invoice_latest il ON il.booking_id = b.id
  LEFT JOIN delivery_latest dl ON dl.booking_id = b.id
  WHERE b.lodge_id = p_lodge_id
    AND b.invoice_number IS NOT NULL
    AND COALESCE(il.issued_at, b.created_at) >= (p_start_date || 'T00:00:00')::timestamptz
    AND COALESCE(il.issued_at, b.created_at) <= (p_end_date || 'T23:59:59')::timestamptz
  ORDER BY COALESCE(il.issued_at, b.created_at);
END;
$$;

-- 8. Financial Exception Report
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

  -- Bookings without invoice number
  SELECT
    'booking_without_invoice'::text,
    'warning'::text,
    'booking'::text,
    b.id::text,
    b.booking_number::text,
    'Booking has no invoice number'::text,
    NULL::numeric,
    NULL::numeric,
    NULL::numeric,
    NOW()
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

  ORDER BY severity DESC, detected_at DESC;
END;
$$;

-- 9. Reconciliation Controls Report
CREATE OR REPLACE FUNCTION public.get_reconciliation_controls_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  metric_name text,
  expected_value numeric,
  actual_value numeric,
  variance numeric,
  status text,
  notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_gross_booking numeric;
  v_positive_receipts numeric;
  v_refunds_issued numeric;
  v_net_cash numeric;
  v_retained_fees numeric;
  v_outstanding numeric;
  v_payment_ledger_total numeric;
  v_booking_amount_paid_total numeric;
  v_per_booking_variance numeric;
  v_outstanding_variance numeric;
  v_refund_variance numeric;
  v_refund_approval_total numeric;
  v_refund_payment_total numeric;
  v_booking_register_gross numeric;
  v_booking_summary_gross numeric;
BEGIN
  IF p_lodge_id IS NULL THEN RAISE EXCEPTION 'lodge_id is required'; END IF;
  IF p_start_date IS NULL THEN RAISE EXCEPTION 'start_date is required'; END IF;
  IF p_end_date IS NULL THEN RAISE EXCEPTION 'end_date is required'; END IF;
  IF p_end_date < p_start_date THEN RAISE EXCEPTION 'end_date cannot be before start_date'; END IF;
  IF NOT public.app_lodge_access(p_lodge_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501'; END IF;

  -- Control 1: Per-booking ledger reconciliation
  -- Sum of |b.amount_paid - signed_payment_sum| across all bookings in range
  SELECT COALESCE(SUM(ABS(COALESCE(b.amount_paid, 0) - COALESCE(lp.net_sum, 0))), 0)
  INTO v_per_booking_variance
  FROM public.bookings b
  LEFT JOIN (
    SELECT p.booking_id, SUM(p.amount) AS net_sum
    FROM public.payments p
    WHERE p.lodge_id = p_lodge_id
    GROUP BY p.booking_id
  ) lp ON lp.booking_id = b.id
  WHERE b.lodge_id = p_lodge_id
    AND b.check_in >= p_start_date AND b.check_in <= p_end_date
    AND b.status NOT IN ('cancelled', 'pending');

  -- Control 2: Report cash reconciliation (positive receipts - refunds = signed total)
  SELECT COALESCE(SUM(CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END), 0)
  INTO v_positive_receipts
  FROM public.payments p
  WHERE p.lodge_id = p_lodge_id
    AND p.paid_at >= (p_start_date || 'T00:00:00')::timestamptz
    AND p.paid_at <= (p_end_date || 'T23:59:59')::timestamptz;

  SELECT COALESCE(SUM(ABS(CASE WHEN p.amount < 0 THEN p.amount ELSE 0 END)), 0)
  INTO v_refunds_issued
  FROM public.payments p
  WHERE p.lodge_id = p_lodge_id
    AND p.paid_at >= (p_start_date || 'T00:00:00')::timestamptz
    AND p.paid_at <= (p_end_date || 'T23:59:59')::timestamptz
    AND p.amount < 0;

  v_net_cash := v_positive_receipts - v_refunds_issued;

  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_payment_ledger_total
  FROM public.payments p
  WHERE p.lodge_id = p_lodge_id
    AND p.paid_at >= (p_start_date || 'T00:00:00')::timestamptz
    AND p.paid_at <= (p_end_date || 'T23:59:59')::timestamptz;

  -- Control 3: independently compare the base booking calculation to the
  -- exported outstanding-balance RPC result.
  SELECT COALESCE(SUM(
    GREATEST(0, COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0) - COALESCE(b.amount_paid, 0))
  ), 0)
  INTO v_outstanding
  FROM public.bookings b
  WHERE b.lodge_id = p_lodge_id
    AND b.check_in >= p_start_date AND b.check_in <= p_end_date
    AND b.status NOT IN ('cancelled', 'pending');

  SELECT COALESCE(SUM(r.balance_due), 0)
  INTO v_outstanding_variance
  FROM public.get_outstanding_balance_report(p_lodge_id, p_start_date, p_end_date) r;

  v_outstanding_variance := v_outstanding - v_outstanding_variance;

  -- Control 4: Refund reconciliation
  SELECT COALESCE(SUM(pal.refund_amount), 0)
  INTO v_refund_approval_total
  FROM public.refund_approval_log pal
  WHERE pal.lodge_id = p_lodge_id
    AND pal.created_at >= (p_start_date || 'T00:00:00')::timestamptz
    AND pal.created_at <= (p_end_date || 'T23:59:59')::timestamptz;

  SELECT COALESCE(ABS(SUM(p.amount)), 0)
  INTO v_refund_payment_total
  FROM public.payments p
  WHERE p.lodge_id = p_lodge_id
    AND p.paid_at >= (p_start_date || 'T00:00:00')::timestamptz
    AND p.paid_at <= (p_end_date || 'T23:59:59')::timestamptz
    AND p.amount < 0;

  v_refund_variance := v_refund_approval_total - v_refund_payment_total;

  -- Control 5: Booking register gross vs server booking summary
  SELECT COALESCE(SUM(COALESCE(b.total_amount, 0) + COALESCE(b.charges_total, 0)), 0)
  INTO v_booking_register_gross
  FROM public.bookings b
  WHERE b.lodge_id = p_lodge_id
    AND b.check_in >= p_start_date AND b.check_in <= p_end_date
    AND b.status NOT IN ('cancelled', 'pending');

  SELECT COALESCE(SUM(r.gross_total), 0)
  INTO v_booking_summary_gross
  FROM public.get_booking_register_report(p_lodge_id, p_start_date, p_end_date) r
  WHERE r.booking_status NOT IN ('cancelled', 'pending');

  -- Booking amount_paid snapshot
  SELECT COALESCE(SUM(COALESCE(b.amount_paid, 0)), 0)
  INTO v_booking_amount_paid_total
  FROM public.bookings b
  WHERE b.lodge_id = p_lodge_id
    AND b.check_in >= p_start_date AND b.check_in <= p_end_date
    AND b.status NOT IN ('cancelled', 'pending');

  -- Retained fees
  SELECT COALESCE(SUM(COALESCE(pal.retained_amount, 0)), 0)
  INTO v_retained_fees
  FROM public.refund_approval_log pal
  WHERE pal.lodge_id = p_lodge_id
    AND pal.created_at >= (p_start_date || 'T00:00:00')::timestamptz
    AND pal.created_at <= (p_end_date || 'T23:59:59')::timestamptz;

  v_gross_booking := v_booking_register_gross;

  RETURN QUERY
  -- 1. Per-booking ledger reconciliation
  SELECT 'Per-booking ledger reconciliation'::text, 0::numeric, v_per_booking_variance,
    CASE WHEN v_per_booking_variance > 0.01 THEN 1 ELSE 0 END,
    CASE WHEN v_per_booking_variance > 0.01 THEN 'RECONCILIATION FAILED' ELSE 'PASSED' END,
    'Sum of |booking.amount_paid - signed payment ledger| across all bookings'
  UNION ALL
  -- 2. Cash reconciliation
  SELECT 'Cash reconciliation'::text, v_net_cash, v_payment_ledger_total,
    CASE WHEN ABS(v_payment_ledger_total - v_net_cash) > 0.01 THEN 1 ELSE 0 END,
    CASE WHEN ABS(v_payment_ledger_total - v_net_cash) > 0.01 THEN 'RECONCILIATION FAILED' ELSE 'PASSED' END,
    'Signed payment ledger total vs gross receipts minus refunds'
  UNION ALL
  -- 3. Outstanding reconciliation
  SELECT 'Outstanding reconciliation'::text, v_outstanding, v_outstanding - v_outstanding_variance,
    CASE WHEN ABS(v_outstanding_variance) > 0.01 THEN 1 ELSE 0 END,
    CASE WHEN ABS(v_outstanding_variance) > 0.01 THEN 'RECONCILIATION FAILED' ELSE 'PASSED' END,
    'Base booking balance total vs Outstanding Balances report output'
  UNION ALL
  -- 4. Refund reconciliation
  SELECT 'Refund reconciliation'::text, v_refund_payment_total, v_refund_approval_total,
    CASE WHEN ABS(v_refund_variance) > 0.01 THEN 1 ELSE 0 END,
    CASE WHEN ABS(v_refund_variance) > 0.01 THEN 'RECONCILIATION FAILED' ELSE 'PASSED' END,
    'Refund approval total vs absolute refund payment total'
  UNION ALL
  -- 5. Booking register gross total
  SELECT 'Booking register gross total'::text, v_booking_register_gross, v_booking_summary_gross,
    CASE WHEN ABS(v_booking_register_gross - v_booking_summary_gross) > 0.01 THEN 1 ELSE 0 END,
    CASE WHEN ABS(v_booking_register_gross - v_booking_summary_gross) > 0.01 THEN 'RECONCILIATION FAILED' ELSE 'PASSED' END,
    'Booking Register gross total vs server booking summary'
  UNION ALL
  -- Summary metrics
  SELECT 'Gross Booking Value'::text, v_gross_booking, NULL::numeric, NULL::numeric, 'info'::text, 'Sum of non-cancelled booking totals in period'
  UNION ALL SELECT 'Gross Positive Receipts', v_positive_receipts, NULL, NULL, 'info', 'Sum of positive payment transactions in period'
  UNION ALL SELECT 'Refunds Issued', v_refunds_issued, NULL, NULL, 'info', 'Sum of absolute refund amounts in period'
  UNION ALL SELECT 'Net Cash Movement', v_net_cash, NULL, NULL, 'info', 'Positive receipts minus refunds'
  UNION ALL SELECT 'Retained Fees', v_retained_fees, NULL, NULL, 'info', 'Sum of retained amounts from refund approvals'
  UNION ALL SELECT 'Outstanding Balances', v_outstanding, NULL, NULL, 'info', 'Total balance due for active bookings in period'
  UNION ALL SELECT 'Payment Ledger Total', v_payment_ledger_total, NULL, NULL, 'info', 'Sum of all payment transactions (signed)'
  UNION ALL SELECT 'Booking Amount Paid Snapshot', v_booking_amount_paid_total, NULL, NULL, 'info', 'Sum of booking.amount_paid for bookings in period';
END;
$$;

-- Revoke from public and anon
REVOKE ALL ON FUNCTION public.get_booking_register_report(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_payment_transaction_report(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_cancelled_booking_report(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_refund_report(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_outstanding_balance_report(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_quotation_report(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_invoice_register_report(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_financial_exception_report(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_reconciliation_controls_report(uuid, date, date) FROM PUBLIC, anon;

-- Grant to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.get_booking_register_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_transaction_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cancelled_booking_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_refund_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_outstanding_balance_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_quotation_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_invoice_register_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_financial_exception_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_reconciliation_controls_report(uuid, date, date) TO authenticated, service_role;

COMMIT;
