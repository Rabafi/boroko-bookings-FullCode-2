-- 20260705150000_advanced_reports.sql
-- Enterprise-grade advanced reporting RPCs

CREATE OR REPLACE FUNCTION get_occupancy_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  WITH date_series AS (
    SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date AS dt
  ),
  room_types_agg AS (
    SELECT rt.id AS room_type_id, rt.name AS room_type_name, COUNT(r.id) AS total_rooms
    FROM room_types rt
    LEFT JOIN rooms r ON r.room_type_id = rt.id AND r.lodge_id = p_lodge_id
    WHERE rt.lodge_id = p_lodge_id
    GROUP BY rt.id, rt.name
  ),
  daily_occupancy AS (
    SELECT ds.dt,
      rta.room_type_id,
      rta.room_type_name,
      rta.total_rooms,
      COUNT(DISTINCT b.id) FILTER (WHERE b.status NOT IN ('cancelled', 'pending') AND b.check_in <= ds.dt AND b.check_out > ds.dt) AS occupied
    FROM date_series ds
    CROSS JOIN room_types_agg rta
    LEFT JOIN bookings b ON b.room_type_id = rta.room_type_id AND b.lodge_id = p_lodge_id
      AND b.status NOT IN ('cancelled', 'pending')
      AND b.check_in <= ds.dt AND b.check_out > ds.dt
    GROUP BY ds.dt, rta.room_type_id, rta.room_type_name, rta.total_rooms
    ORDER BY ds.dt, rta.room_type_name
  )
  SELECT jsonb_build_object(
    'daily', COALESCE((SELECT jsonb_agg(row_to_json(do_)::jsonb) FROM daily_occupancy do_), '[]'::jsonb),
    'summary', (
      SELECT jsonb_build_object(
        'total_room_nights', SUM(total_rooms),
        'occupied_room_nights', SUM(occupied),
        'avg_occupancy', CASE WHEN SUM(total_rooms) > 0 THEN ROUND((SUM(occupied)::numeric / SUM(total_rooms)) * 100, 1) ELSE 0 END
      )
      FROM daily_occupancy
    )
  ) INTO v_report;

  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION get_pace_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  WITH date_series AS (
    SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date AS dt
  ),
  this_year AS (
    SELECT ds.dt,
      COUNT(DISTINCT b.id) AS bookings_count,
      COALESCE(SUM(b.total_amount), 0) AS revenue
    FROM date_series ds
    LEFT JOIN bookings b ON b.lodge_id = p_lodge_id
      AND b.status NOT IN ('cancelled', 'pending')
      AND b.check_in <= ds.dt AND b.check_out > ds.dt
    GROUP BY ds.dt
  ),
  last_year AS (
    SELECT (ds.dt - interval '1 year')::date AS dt,
      COUNT(DISTINCT b.id) AS bookings_count,
      COALESCE(SUM(b.total_amount), 0) AS revenue
    FROM date_series ds
    LEFT JOIN bookings b ON b.lodge_id = p_lodge_id
      AND b.status NOT IN ('cancelled', 'pending')
      AND b.check_in <= (ds.dt - interval '1 year')::date
      AND b.check_out > (ds.dt - interval '1 year')::date
    GROUP BY ds.dt
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', ty.dt,
      'this_year_bookings', ty.bookings_count,
      'this_year_revenue', ty.revenue,
      'last_year_bookings', COALESCE(ly.bookings_count, 0),
      'last_year_revenue', COALESCE(ly.revenue, 0),
      'pace_change_pct', CASE WHEN COALESCE(ly.bookings_count, 0) > 0
        THEN ROUND(((ty.bookings_count - ly.bookings_count)::numeric / ly.bookings_count) * 100, 1)
        ELSE NULL END
    ) ORDER BY ty.dt
  ) INTO v_report
  FROM this_year ty
  LEFT JOIN last_year ly ON ly.dt = ty.dt;

  RETURN jsonb_build_object('daily', COALESCE(v_report, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION get_pickup_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT jsonb_agg(
    jsonb_build_object(
      'source', COALESCE(NULLIF(b.source, ''), 'direct'),
      'booking_count', COUNT(*),
      'revenue', SUM(b.total_amount),
      'avg_rate', ROUND(AVG(b.total_amount / GREATEST(1, (b.check_out::date - b.check_in::date))), 2)
    ) ORDER BY COUNT(*) DESC
  ) INTO v_report
  FROM bookings b
  WHERE b.lodge_id = p_lodge_id
    AND b.status NOT IN ('cancelled', 'pending')
    AND b.check_in >= p_start_date
    AND b.check_in <= p_end_date;

  RETURN jsonb_build_object('sources', COALESCE(v_report, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION get_channel_source_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT jsonb_agg(
    jsonb_build_object(
      'channel', COALESCE(NULLIF(COALESCE(b.source, b.channel), ''), 'direct'),
      'booking_count', COUNT(*),
      'revenue', SUM(b.total_amount),
      'avg_nights', ROUND(AVG(GREATEST(1, (b.check_out::date - b.check_in::date))), 1),
      'avg_rate', ROUND(AVG(b.total_amount / GREATEST(1, (b.check_out::date - b.check_in::date))), 2)
    ) ORDER BY SUM(b.total_amount) DESC NULLS LAST
  ) INTO v_report
  FROM bookings b
  WHERE b.lodge_id = p_lodge_id
    AND b.status NOT IN ('cancelled', 'pending')
    AND b.check_in >= p_start_date
    AND b.check_in <= p_end_date;

  RETURN jsonb_build_object('channels', COALESCE(v_report, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION get_debtor_aging_detail(
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
  v_now date := CURRENT_DATE;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT jsonb_agg(
    jsonb_build_object(
      'corporate_account_id', ca.id,
      'company_name', ca.company_name,
      'outstanding_balance', ca.outstanding_balance,
      'credit_limit', ca.credit_limit,
      'current', COALESCE(aging.current, 0),
      'days_1_30', COALESCE(aging.days_1_30, 0),
      'days_31_60', COALESCE(aging.days_31_60, 0),
      'days_61_90', COALESCE(aging.days_61_90, 0),
      'days_91_plus', COALESCE(aging.days_91_plus, 0)
    ) ORDER BY ca.company_name
  ) INTO v_report
  FROM corporate_accounts ca
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN (v_now - b.check_out::date) <= 0 THEN outstanding ELSE 0 END) AS current,
      SUM(CASE WHEN (v_now - b.check_out::date) BETWEEN 1 AND 30 THEN outstanding ELSE 0 END) AS days_1_30,
      SUM(CASE WHEN (v_now - b.check_out::date) BETWEEN 31 AND 60 THEN outstanding ELSE 0 END) AS days_31_60,
      SUM(CASE WHEN (v_now - b.check_out::date) BETWEEN 61 AND 90 THEN outstanding ELSE 0 END) AS days_61_90,
      SUM(CASE WHEN (v_now - b.check_out::date) > 90 THEN outstanding ELSE 0 END) AS days_91_plus
    FROM (
      SELECT b.check_out,
        GREATEST(0, b.total_amount + COALESCE(b.charges_total, 0) - b.amount_paid) AS outstanding
      FROM bookings b
      WHERE b.lodge_id = p_lodge_id
        AND b.corporate_account_id = ca.id
        AND b.status NOT IN ('cancelled', 'pending')
        AND (b.amount_paid IS NULL OR b.amount_paid < b.total_amount + COALESCE(b.charges_total, 0))
    ) b
  ) aging ON true
  WHERE ca.lodge_id = p_lodge_id AND ca.outstanding_balance > 0;

  RETURN jsonb_build_object('accounts', COALESCE(v_report, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION get_rate_performance_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  WITH daily_rates AS (
    SELECT b.check_in AS date,
      rt.name AS room_type,
      AVG(b.total_amount / GREATEST(1, (b.check_out::date - b.check_in::date))) AS avg_rate,
      COUNT(*) AS bookings_count
    FROM bookings b
    JOIN room_types rt ON rt.id = b.room_type_id AND rt.lodge_id = p_lodge_id
    WHERE b.lodge_id = p_lodge_id
      AND b.status NOT IN ('cancelled', 'pending')
      AND b.check_in >= p_start_date
      AND b.check_in <= p_end_date
    GROUP BY b.check_in, rt.name
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', dr.date,
      'room_type', dr.room_type,
      'avg_rate', ROUND(dr.avg_rate, 2),
      'bar_rate', COALESCE(rp.rate_amount, 0),
      'premium_pct', CASE WHEN COALESCE(rp.rate_amount, 0) > 0
        THEN ROUND(((dr.avg_rate - rp.rate_amount) / rp.rate_amount) * 100, 1)
        ELSE NULL END,
      'bookings_count', dr.bookings_count
    ) ORDER BY dr.date, dr.room_type
  ) INTO v_report
  FROM daily_rates dr
  LEFT JOIN LATERAL (
    SELECT rate_amount FROM rate_plans
    WHERE lodge_id = p_lodge_id
      AND status = 'active'
      AND (valid_from IS NULL OR valid_from <= dr.date)
      AND (valid_to IS NULL OR valid_to >= dr.date)
      AND (room_type_id IS NULL OR room_type_id = (SELECT id FROM room_types WHERE name = dr.room_type AND lodge_id = p_lodge_id LIMIT 1))
    ORDER BY rate_amount ASC
    LIMIT 1
  ) rp ON true;

  RETURN jsonb_build_object('daily', COALESCE(v_report, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION get_housekeeping_productivity(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT jsonb_agg(
    jsonb_build_object(
      'attendant', COALESCE(s.name, 'Unassigned'),
      'rooms_cleaned', COUNT(hl.id),
      'first_dates', MIN(hl.created_at)::date,
      'last_date', MAX(hl.created_at)::date
    ) ORDER BY COUNT(hl.id) DESC
  ) INTO v_report
  FROM housekeeping_log hl
  LEFT JOIN staff s ON s.id = hl.assigned_to AND s.lodge_id = p_lodge_id
  WHERE hl.lodge_id = p_lodge_id
    AND hl.status = 'cleaned'
    AND hl.created_at >= p_start_date::timestamp
    AND hl.created_at <= (p_end_date + 1)::timestamp
  GROUP BY s.name;

  RETURN jsonb_build_object('productivity', COALESCE(v_report, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION get_room_downtime_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT jsonb_agg(
    jsonb_build_object(
      'room_number', r.room_number,
      'room_type', rt.name,
      'maintenance_days', COUNT(DISTINCT m.id),
      'total_downtime_cost', COALESCE(SUM(m.total_cost), 0),
      'issues', COALESCE(jsonb_agg(DISTINCT m.issue) FILTER (WHERE m.issue IS NOT NULL), '[]'::jsonb)
    ) ORDER BY COUNT(DISTINCT m.id) DESC
  ) INTO v_report
  FROM rooms r
  JOIN room_types rt ON rt.id = r.room_type_id AND rt.lodge_id = p_lodge_id
  LEFT JOIN maintenance m ON m.room_id = r.id
    AND m.lodge_id = p_lodge_id
    AND m.created_at >= p_start_date::timestamp
    AND m.created_at <= (p_end_date + 1)::timestamp
  WHERE r.lodge_id = p_lodge_id
  GROUP BY r.id, r.room_number, rt.name
  HAVING COUNT(DISTINCT m.id) > 0;

  RETURN jsonb_build_object('rooms', COALESCE(v_report, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION get_group_pickup_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT jsonb_agg(
    jsonb_build_object(
      'group_block_id', gb.id,
      'group_name', gb.group_name,
      'blocked_rooms', gb.blocked_rooms,
      'picked_up', COALESCE(pu.picked_up, 0),
      'pickup_pct', CASE WHEN gb.blocked_rooms > 0
        THEN ROUND((COALESCE(pu.picked_up, 0)::numeric / gb.blocked_rooms) * 100, 1)
        ELSE 0 END,
      'revenue', COALESCE(pu.revenue, 0)
    ) ORDER BY gb.group_name
  ) INTO v_report
  FROM group_blocks gb
  LEFT JOIN LATERAL (
    SELECT
      COUNT(DISTINCT b.id) AS picked_up,
      COALESCE(SUM(b.total_amount), 0) AS revenue
    FROM bookings b
    WHERE b.lodge_id = p_lodge_id
      AND b.group_block_id = gb.id
      AND b.status NOT IN ('cancelled', 'pending')
  ) pu ON true
  WHERE gb.lodge_id = p_lodge_id
    AND gb.start_date <= p_end_date
    AND gb.end_date >= p_start_date
  ORDER BY gb.group_name;

  RETURN jsonb_build_object('groups', COALESCE(v_report, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION get_cancellation_no_show_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
  v_total_bookings integer;
  v_cancelled integer;
  v_no_shows integer;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'cancelled'),
    COUNT(*) FILTER (WHERE status IN ('no_show', 'no-show'))
  INTO v_total_bookings, v_cancelled, v_no_shows
  FROM bookings
  WHERE lodge_id = p_lodge_id
    AND check_in >= p_start_date
    AND check_in <= p_end_date;

  SELECT jsonb_agg(
    jsonb_build_object(
      'date', check_in,
      'total', COUNT(*),
      'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
      'no_shows', COUNT(*) FILTER (WHERE status IN ('no_show', 'no-show')),
      'cancellation_rate', CASE WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE status = 'cancelled')::numeric / COUNT(*)) * 100, 1)
        ELSE 0 END,
      'no_show_rate', CASE WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE status IN ('no_show', 'no-show'))::numeric / COUNT(*)) * 100, 1)
        ELSE 0 END
    ) ORDER BY check_in
  ) INTO v_report
  FROM bookings
  WHERE lodge_id = p_lodge_id
    AND check_in >= p_start_date
    AND check_in <= p_end_date
  GROUP BY check_in;

  RETURN jsonb_build_object(
    'daily', COALESCE(v_report, '[]'::jsonb),
    'summary', jsonb_build_object(
      'total_bookings', v_total_bookings,
      'cancelled', v_cancelled,
      'no_shows', v_no_shows,
      'cancellation_rate', CASE WHEN v_total_bookings > 0 THEN ROUND((v_cancelled::numeric / v_total_bookings) * 100, 1) ELSE 0 END,
      'no_show_rate', CASE WHEN v_total_bookings > 0 THEN ROUND((v_no_shows::numeric / v_total_bookings) * 100, 1) ELSE 0 END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_tax_vat_report(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  WITH booking_tax AS (
    SELECT
      b.vat_rate,
      COUNT(*) AS transaction_count,
      SUM(b.total_amount) AS gross_amount,
      SUM(b.total_amount) - SUM(b.total_amount / (1 + COALESCE(b.vat_rate, 0) / 100)) AS tax_amount
    FROM bookings b
    WHERE b.lodge_id = p_lodge_id
      AND b.status NOT IN ('cancelled', 'pending')
      AND b.vat_enabled = true
      AND b.check_in >= p_start_date
      AND b.check_in <= p_end_date
    GROUP BY b.vat_rate
  ),
  pos_tax AS (
    SELECT
      COALESCE((o.metadata ->> 'vat_rate')::numeric, 0) AS vat_rate,
      COUNT(*) AS transaction_count,
      SUM(o.total) AS gross_amount,
      SUM(o.total) - SUM(o.total / (1 + COALESCE((o.metadata ->> 'vat_rate')::numeric, 0) / 100)) AS tax_amount
    FROM pos_orders o
    WHERE o.lodge_id = p_lodge_id
      AND o.status = 'completed'
      AND o.metadata->>'vat_enabled' = 'true'
      AND o.created_at >= p_start_date::timestamp
      AND o.created_at <= (p_end_date + 1)::timestamp
    GROUP BY (o.metadata ->> 'vat_rate')::numeric
  )
  SELECT jsonb_build_object(
    'booking_tax', COALESCE((SELECT jsonb_agg(row_to_json(bt.*)::jsonb) FROM booking_tax bt), '[]'::jsonb),
    'pos_tax', COALESCE((SELECT jsonb_agg(row_to_json(pt.*)::jsonb) FROM pos_tax pt), '[]'::jsonb),
    'total_tax_collected', COALESCE((SELECT SUM(tax_amount) FROM booking_tax), 0) + COALESCE((SELECT SUM(tax_amount) FROM pos_tax), 0)
  ) INTO v_report;

  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION get_deposit_liability_report(
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT jsonb_build_object(
    'total_deposits_collected', COALESCE(SUM(b.amount_paid), 0),
    'total_deposits_applied', 0,
    'outstanding_liability', COALESCE(SUM(b.amount_paid), 0),
    'breakdown', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'booking_id', b.id,
          'customer_name', c.name,
          'check_in', b.check_in,
          'check_out', b.check_out,
          'deposit_amount', b.amount_paid,
          'total_amount', b.total_amount + COALESCE(b.charges_total, 0),
          'balance_due', GREATEST(0, b.total_amount + COALESCE(b.charges_total, 0) - b.amount_paid),
          'status', b.status
        ) ORDER BY b.check_in
      )
      FROM bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      WHERE b.lodge_id = p_lodge_id
        AND b.status NOT IN ('cancelled', 'pending')
        AND b.amount_paid > 0
      ), '[]'::jsonb
    )
  ) INTO v_report
  FROM bookings b
  WHERE b.lodge_id = p_lodge_id
    AND b.status NOT IN ('cancelled', 'pending')
    AND b.amount_paid > 0;

  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION get_folio_exception_report(
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin']);

  SELECT jsonb_agg(
    jsonb_build_object(
      'booking_id', b.id,
      'customer_name', c.name,
      'room_number', r.room_number,
      'charges_total', COALESCE(b.charges_total, 0),
      'amount_paid', COALESCE(b.amount_paid, 0),
      'unallocated_amount', GREATEST(0, COALESCE(b.charges_total, 0) - COALESCE(b.amount_paid, 0)),
      'status', b.status,
      'check_in', b.check_in,
      'check_out', b.check_out
    ) ORDER BY GREATEST(0, COALESCE(b.charges_total, 0) - COALESCE(b.amount_paid, 0)) DESC
  ) INTO v_report
  FROM bookings b
  LEFT JOIN customers c ON c.id = b.customer_id
  LEFT JOIN rooms r ON r.id = b.room_id
  WHERE b.lodge_id = p_lodge_id
    AND b.status NOT IN ('cancelled', 'pending')
    AND COALESCE(b.charges_total, 0) > 0
    AND b.amount_paid < b.total_amount + COALESCE(b.charges_total, 0);

  RETURN jsonb_build_object('exceptions', COALESCE(v_report, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION get_occupancy_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_pace_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_pickup_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_channel_source_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_debtor_aging_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_rate_performance_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_housekeeping_productivity(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_room_downtime_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_group_pickup_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_cancellation_no_show_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_tax_vat_report(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_deposit_liability_report(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_folio_exception_report(uuid) TO authenticated, service_role;
