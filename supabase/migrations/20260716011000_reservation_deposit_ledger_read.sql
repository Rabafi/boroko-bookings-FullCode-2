-- Held deposits must be visible to the authorised manager as a custody ledger.

CREATE OR REPLACE FUNCTION public.get_restaurant_reservation_deposits(
  p_lodge_id uuid,
  p_days integer DEFAULT 90
)
RETURNS TABLE (
  id uuid,
  reservation_id uuid,
  reservation_date date,
  reservation_time time,
  customer_name text,
  party_size integer,
  amount numeric,
  method text,
  status text,
  reference text,
  received_by uuid,
  received_by_name text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'manager', 'supervisor']);
  RETURN QUERY
  SELECT d.id, d.reservation_id, r.reservation_date, r.reservation_time,
         r.customer_name, r.party_size, d.amount, d.method, d.status,
         d.reference, d.received_by, COALESCE(u.name, u.email, 'Unknown staff member'), d.created_at
  FROM public.restaurant_reservation_deposits d
  JOIN public.restaurant_reservations r ON r.id = d.reservation_id AND r.lodge_id = d.lodge_id
  LEFT JOIN public.users u ON u.id = d.received_by AND u.lodge_id = d.lodge_id
  WHERE d.lodge_id = p_lodge_id
    AND d.created_at >= now() - make_interval(days => GREATEST(1, LEAST(COALESCE(p_days, 90), 730)))
  ORDER BY d.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_restaurant_reservation_deposits(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_reservation_deposits(uuid, integer) TO authenticated, service_role;
