-- Accounting upgrade: Collections queue
-- Unpaid/partial bookings grouped by lodge for follow-up

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
    SELECT b.lodge_id,
           s.lodge_name,
           count(*) as booking_count,
           COALESCE(SUM(b.total_amount - b.amount_paid), 0) as total_outstanding,
           COALESCE(MAX(now()::date - b.check_in::date), 0) as max_days_overdue,
           jsonb_agg(jsonb_build_object(
             'booking_number', b.booking_number,
             'guest_name', b.guest_name,
             'balance', b.total_amount - b.amount_paid,
             'check_in', b.check_in,
             'days_overdue', now()::date - b.check_in::date,
             'payment_status', b.payment_status
           ) ORDER BY (b.total_amount - b.amount_paid) DESC) as bookings
    FROM public.bookings b
    LEFT JOIN public.settings s ON s.lodge_id = b.lodge_id
    WHERE b.payment_status IN ('unpaid', 'partial')
      AND b.status NOT IN ('cancelled')
      AND b.check_in <= now()
    GROUP BY b.lodge_id, s.lodge_name
    ORDER BY total_outstanding DESC
  ) t;

  RETURN jsonb_build_object('ok', true, 'queue', COALESCE(v_queue, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_collections_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_collections_queue() TO authenticated, service_role;

-- Accounting upgrade: Revenue by payment method
CREATE OR REPLACE FUNCTION public.app_get_revenue_by_method(
  p_days int DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_methods jsonb;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  SELECT jsonb_agg(row_to_json(t)) INTO v_methods
  FROM (
    SELECT COALESCE(method, 'unknown') as method,
           COALESCE(SUM(amount), 0) as total,
           count(*) as payment_count
    FROM public.payments
    WHERE paid_at >= now() - (p_days || ' days')::interval
      AND type = 'payment'
    GROUP BY method
    ORDER BY total DESC
  ) t;

  RETURN jsonb_build_object('ok', true, 'methods', COALESCE(v_methods, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_revenue_by_method(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_revenue_by_method(int) TO authenticated, service_role;
