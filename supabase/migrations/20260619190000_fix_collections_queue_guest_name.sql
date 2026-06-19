-- Collections must resolve guest identity from the authoritative customers table.
-- bookings.guest_name is a removed legacy column.

CREATE OR REPLACE FUNCTION public.app_get_collections_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue jsonb;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  SELECT jsonb_agg(row_to_json(t)) INTO v_queue
  FROM (
    SELECT
      b.lodge_id,
      COALESCE(s.lodge_name, s.company_name, b.lodge_id::text) AS lodge_name,
      count(*) AS booking_count,
      COALESCE(SUM(GREATEST(COALESCE(b.total_amount, 0) - COALESCE(b.amount_paid, 0), 0)), 0) AS total_outstanding,
      COALESCE(MAX(GREATEST(now()::date - b.check_in::date, 0)), 0) AS max_days_overdue,
      jsonb_agg(
        jsonb_build_object(
          'booking_id', b.id,
          'booking_number', b.booking_number,
          'guest_name', COALESCE(NULLIF(trim(c.name), ''), 'Guest'),
          'balance', GREATEST(COALESCE(b.total_amount, 0) - COALESCE(b.amount_paid, 0), 0),
          'check_in', b.check_in,
          'days_overdue', GREATEST(now()::date - b.check_in::date, 0),
          'payment_status', b.payment_status
        )
        ORDER BY GREATEST(COALESCE(b.total_amount, 0) - COALESCE(b.amount_paid, 0), 0) DESC
      ) AS bookings
    FROM public.bookings b
    LEFT JOIN public.customers c
      ON c.id = b.customer_id
     AND c.lodge_id = b.lodge_id
    LEFT JOIN public.settings s ON s.lodge_id = b.lodge_id
    WHERE b.payment_status IN ('unpaid', 'partial')
      AND b.status <> 'cancelled'
      AND b.check_in <= now()::date
      AND COALESCE(b.total_amount, 0) > COALESCE(b.amount_paid, 0)
    GROUP BY b.lodge_id, s.lodge_name, s.company_name
    ORDER BY total_outstanding DESC
  ) t;

  RETURN jsonb_build_object('ok', true, 'queue', COALESCE(v_queue, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_collections_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_collections_queue() TO authenticated, service_role;
