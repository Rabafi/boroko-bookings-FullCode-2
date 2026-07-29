-- Settlement reconciliation compares external payouts with POS tender totals.
-- Expected totals are calculated in the database for a selected date range.

ALTER TABLE public.restaurant_settlement_reconciliations
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date;

CREATE OR REPLACE FUNCTION public.get_restaurant_settlement_expected_total(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_channel text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_expected numeric;
BEGIN
  PERFORM public.app_require_restaurant_lodge(p_lodge_id, ARRAY['admin', 'manager', 'supervisor']);
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Choose a valid reconciliation date range.' USING ERRCODE = '22023';
  END IF;
  IF p_channel NOT IN ('card', 'mobile_money', 'delivery_platform', 'bank', 'voucher') THEN
    RAISE EXCEPTION 'Choose a supported settlement channel.' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(sum(COALESCE(NULLIF(payment->>'amount', '')::numeric, 0)), 0)
  INTO v_expected
  FROM public.pos_orders o
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(COALESCE(o.payment_breakdown, '[]'::jsonb)) = 'array'
        AND jsonb_array_length(COALESCE(o.payment_breakdown, '[]'::jsonb)) > 0
      THEN o.payment_breakdown
      ELSE jsonb_build_array(jsonb_build_object('method', o.payment_method, 'amount', o.total))
    END
  ) AS payment
  WHERE o.lodge_id = p_lodge_id
    AND o.created_at >= p_start_date::timestamptz
    AND o.created_at < (p_end_date + 1)::timestamptz
    AND lower(COALESCE(o.status, 'completed')) NOT IN ('cancelled', 'voided', 'refunded')
    AND lower(COALESCE(payment->>'method', '')) = p_channel;
  RETURN jsonb_build_object('success', true, 'expected_amount', v_expected, 'period_start', p_start_date, 'period_end', p_end_date, 'channel', p_channel);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_restaurant_settlement(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lodge_id uuid := NULLIF(p_payload->>'lodge_id', '')::uuid;
  v_actor_id uuid := public.app_current_user_id();
  v_start date := COALESCE(NULLIF(p_payload->>'period_start', '')::date, NULLIF(p_payload->>'business_date', '')::date, current_date);
  v_end date := COALESCE(NULLIF(p_payload->>'period_end', '')::date, NULLIF(p_payload->>'business_date', '')::date, current_date);
  v_channel text := NULLIF(p_payload->>'channel', '');
  v_settled numeric := COALESCE(NULLIF(p_payload->>'settled_amount', '')::numeric, 0);
  v_expected numeric;
  v_key text := NULLIF(p_payload->>'idempotency_key', '');
  v_existing public.restaurant_settlement_reconciliations%ROWTYPE;
  v_id uuid;
BEGIN
  PERFORM public.app_require_restaurant_lodge(v_lodge_id, ARRAY['admin', 'manager', 'supervisor']);
  IF v_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_actor_id AND lodge_id = v_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your staff session could not be verified. Sign in again before recording a settlement.');
  END IF;
  IF v_key IS NULL OR length(v_key) < 8 OR v_settled < 0 THEN
    RAISE EXCEPTION 'A stable settlement key and a non-negative settled amount are required.' USING ERRCODE = '22023';
  END IF;
  SELECT (public.get_restaurant_settlement_expected_total(v_lodge_id, v_start, v_end, v_channel)->>'expected_amount')::numeric INTO v_expected;
  SELECT * INTO v_existing FROM public.restaurant_settlement_reconciliations WHERE lodge_id = v_lodge_id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.channel <> v_channel OR v_existing.expected_amount <> v_expected OR v_existing.settled_amount <> v_settled THEN
      RAISE EXCEPTION 'Settlement idempotency key was already used with a different payload.' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('success', true, 'id', v_existing.id, 'duplicate', true, 'expected_amount', v_expected);
  END IF;
  INSERT INTO public.restaurant_settlement_reconciliations (lodge_id, business_date, period_start, period_end, channel, provider, expected_amount, settled_amount, reference, notes, recorded_by, idempotency_key)
  VALUES (v_lodge_id, v_end, v_start, v_end, v_channel, NULLIF(p_payload->>'provider', ''), v_expected, v_settled, NULLIF(p_payload->>'reference', ''), NULLIF(p_payload->>'notes', ''), v_actor_id, v_key)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('success', true, 'id', v_id, 'expected_amount', v_expected);
END;
$$;

REVOKE ALL ON FUNCTION public.get_restaurant_settlement_expected_total(uuid, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_settlement_expected_total(uuid, date, date, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_restaurant_settlement(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_restaurant_settlement(jsonb) TO authenticated, service_role;
