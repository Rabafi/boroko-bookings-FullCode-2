-- ============================================================
-- Master Plan B/J/H/I/E/F: Accounting, Task Center, Search,
-- Bulk Actions, Fleet Deep Health, Release Rollout
-- Schema-corrected: settings=lodge/company, licenses=plural,
-- bookings=financial truth, real device_health_reports columns,
-- activity_logs lodge_id=text NOT NULL, no performed_by column
-- ============================================================

-- ============================================================
-- Master Plan B: Accounting Upgrades
-- MRR/ARR from licenses, revenue from payments
-- NOTE: invoices table is metadata-only (no amount columns).
-- Financial truth lives on bookings.amount_paid / payments.
-- ============================================================

-- RPC: MRR/ARR summary from licenses table
CREATE OR REPLACE FUNCTION public.app_get_mrr_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mrr numeric := 0;
  v_arr numeric := 0;
  v_by_plan jsonb;
  v_lodge_count int := 0;
  v_trials_active int := 0;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  -- Active licenses with monthly fees
  SELECT
    COALESCE(SUM(COALESCE(l.monthly_fee, 0)), 0),
    COALESCE(SUM(COALESCE(l.monthly_fee, 0)) * 12, 0),
    count(DISTINCT l.lodge_id)
  INTO v_mrr, v_arr, v_lodge_count
  FROM public.licenses l
  WHERE l.is_active = true
    AND l.payment_status = 'active'
    AND (l.expires_at IS NULL OR l.expires_at > now());

  -- Active trials: settings with trial_started_at within last 30 days
  SELECT count(*) INTO v_trials_active
  FROM public.settings s
  WHERE s.trial_started_at IS NOT NULL
    AND s.deleted = false
    AND s.trial_started_at + interval '30 days' > now();

  -- MRR by plan
  SELECT jsonb_object_agg(sub.plan_name, sub.mrr) INTO v_by_plan
  FROM (
    SELECT COALESCE(l.subscription_plan, 'unknown') as plan_name,
           COALESCE(SUM(COALESCE(l.monthly_fee, 0)), 0) as mrr
    FROM public.licenses l
    WHERE l.is_active = true
      AND l.payment_status = 'active'
      AND (l.expires_at IS NULL OR l.expires_at > now())
    GROUP BY l.subscription_plan
  ) sub;

  RETURN jsonb_build_object(
    'ok', true,
    'mrr', v_mrr,
    'arr', v_arr,
    'lodge_count', v_lodge_count,
    'trials_active', v_trials_active,
    'by_plan', COALESCE(v_by_plan, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_mrr_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_mrr_summary() TO authenticated, service_role;

-- RPC: Revenue summary from payments table
CREATE OR REPLACE FUNCTION public.app_get_revenue_summary(
  p_days int DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_daily jsonb;
  v_total numeric := 0;
  v_count int := 0;
  v_avg numeric := 0;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  SELECT jsonb_agg(row_to_json(sub)), COALESCE(SUM(total), 0), count(*), COALESCE(AVG(total), 0)
  INTO v_daily, v_total, v_count, v_avg
  FROM (
    SELECT
      paid_at::date as date,
      COALESCE(SUM(amount), 0) as total,
      count(*) as payment_count
    FROM public.payments
    WHERE paid_at >= now() - (p_days || ' days')::interval
      AND type = 'payment'
    GROUP BY paid_at::date
    ORDER BY paid_at::date
  ) sub;

  RETURN jsonb_build_object(
    'ok', true,
    'daily', COALESCE(v_daily, '[]'::jsonb),
    'total_revenue', v_total,
    'payment_count', v_count,
    'avg_daily', v_avg
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_revenue_summary(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_revenue_summary(int) TO authenticated, service_role;

-- RPC: Lodge financial summary (bookings + payments, NOT invoices)
CREATE OR REPLACE FUNCTION public.app_get_lodge_financial_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  SELECT jsonb_agg(row_to_json(sub)) INTO v_rows
  FROM (
    SELECT
      b.lodge_id,
      s.lodge_name,
      count(*) as total_bookings,
      COALESCE(SUM(b.total_amount), 0) as total_revenue,
      COALESCE(SUM(b.amount_paid), 0) as total_collected,
      COALESCE(SUM(b.total_amount - b.amount_paid), 0) as total_outstanding,
      count(*) FILTER (WHERE b.payment_status = 'unpaid') as unpaid_count,
      count(*) FILTER (WHERE b.payment_status = 'partial') as partial_count,
      count(*) FILTER (WHERE b.payment_status = 'paid') as paid_count
    FROM public.bookings b
    LEFT JOIN public.settings s ON s.lodge_id = b.lodge_id
    WHERE b.status != 'cancelled'
    GROUP BY b.lodge_id, s.lodge_name
    ORDER BY total_outstanding DESC
  ) sub;

  RETURN jsonb_build_object('ok', true, 'lodges', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_lodge_financial_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_lodge_financial_summary() TO authenticated, service_role;

-- ============================================================
-- Master Plan J: Master Admin Daily Task Center
-- ============================================================

CREATE OR REPLACE FUNCTION public.app_get_admin_today()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_overdue_bookings jsonb;
  v_trials_ending jsonb;
  v_failed_devices jsonb;
  v_urgent_tickets jsonb;
  v_lead_followups jsonb;
  v_recent_payments jsonb;
  v_summary jsonb;
  v_trial_length_days int := 30;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  -- Overdue bookings (unpaid/partial with past check_in)
  SELECT jsonb_agg(row_to_json(t)) INTO v_overdue_bookings
  FROM (
    SELECT b.id, b.booking_number, s.lodge_name,
           (b.total_amount - b.amount_paid) as balance,
           (now()::date - b.check_in::date) as days_overdue,
           b.payment_status
    FROM public.bookings b
    LEFT JOIN public.settings s ON s.lodge_id = b.lodge_id
    WHERE b.payment_status IN ('unpaid', 'partial')
      AND b.check_in <= now()
      AND b.status NOT IN ('cancelled')
    ORDER BY (now()::date - b.check_in::date) DESC
    LIMIT 20
  ) t;

  -- Trials ending within 3 days
  SELECT jsonb_agg(row_to_json(t)) INTO v_trials_ending
  FROM (
    SELECT s.lodge_id::text as id, COALESCE(s.lodge_name, s.company_name, 'Unknown') as lodge_name,
           (s.trial_started_at + (v_trial_length_days || ' days')::interval) as trial_ends_at,
           ((s.trial_started_at + (v_trial_length_days || ' days')::interval)::date - now()::date) as days_left
    FROM public.settings s
    WHERE s.trial_started_at IS NOT NULL
      AND s.deleted = false
      AND (s.trial_started_at + (v_trial_length_days || ' days')::interval) > now()
      AND (s.trial_started_at + (v_trial_length_days || ' days')::interval) <= now() + interval '3 days'
    ORDER BY (s.trial_started_at + (v_trial_length_days || ' days')::interval)
    LIMIT 20
  ) t;

  -- Failed devices (last 24h): failed_queue_count > 0 or reconciliation_state = mismatch
  SELECT jsonb_agg(row_to_json(t)) INTO v_failed_devices
  FROM (
    SELECT dhr.lodge_id::text, COALESCE(s.lodge_name, s.company_name, dhr.lodge_id::text) as lodge_name,
           dhr.device_id, dhr.client_type,
           CASE WHEN dhr.failed_queue_count > 0 THEN 'sync_failure' ELSE 'mismatch' END as issue_type,
           dhr.failed_queue_count, dhr.reconciliation_state,
           dhr.reported_at
    FROM public.device_health_reports dhr
    LEFT JOIN public.settings s ON s.lodge_id = dhr.lodge_id
    WHERE (dhr.failed_queue_count > 0 OR dhr.reconciliation_state = 'mismatch')
      AND dhr.reported_at > now() - interval '24 hours'
    ORDER BY dhr.reported_at DESC
    LIMIT 20
  ) t;

  -- Urgent tickets (using title, not subject)
  SELECT jsonb_agg(row_to_json(t)) INTO v_urgent_tickets
  FROM (
    SELECT t.id, t.title, t.priority, t.status, t.created_at,
           s.company_name
    FROM public.support_tickets t
    LEFT JOIN public.settings s ON s.lodge_id = t.lodge_id
    WHERE t.priority IN ('Urgent', 'Critical')
      AND t.status NOT IN ('resolved', 'closed')
    ORDER BY
      CASE t.priority WHEN 'Critical' THEN 0 ELSE 1 END,
      t.created_at
    LIMIT 20
  ) t;

  -- Lead follow-ups due today or overdue
  SELECT jsonb_agg(row_to_json(t)) INTO v_lead_followups
  FROM (
    SELECT ml.id::text, ml.contact_name, ml.lodge_name, ml.follow_up_at,
           ml.stage, ml.email,
           (now()::date - ml.follow_up_at::date) as days_overdue
    FROM public.marketing_leads ml
    WHERE ml.follow_up_at IS NOT NULL
      AND ml.follow_up_at <= now()
      AND (ml.stage IS NULL OR ml.stage NOT IN ('won','lost'))
    ORDER BY ml.follow_up_at
    LIMIT 20
  ) t;

  -- Recent payments (last 24h)
  SELECT jsonb_agg(row_to_json(t)) INTO v_recent_payments
  FROM (
    SELECT p.id, p.amount, p.method, p.paid_at,
           s.lodge_name, b.booking_number
    FROM public.payments p
    LEFT JOIN public.bookings b ON b.id = p.booking_id
    LEFT JOIN public.settings s ON s.lodge_id = p.lodge_id
    WHERE p.paid_at > now() - interval '24 hours'
    ORDER BY p.paid_at DESC
    LIMIT 20
  ) t;

  v_summary := jsonb_build_object(
    'overdue_bookings_count', jsonb_array_length(COALESCE(v_overdue_bookings, '[]'::jsonb)),
    'overdue_bookings_total', (
      SELECT COALESCE(SUM(b.total_amount - b.amount_paid), 0)
      FROM public.bookings b
      WHERE b.payment_status IN ('unpaid', 'partial')
        AND b.check_in <= now() AND b.status != 'cancelled'
    ),
    'trials_ending_count', jsonb_array_length(COALESCE(v_trials_ending, '[]'::jsonb)),
    'failed_devices_count', jsonb_array_length(COALESCE(v_failed_devices, '[]'::jsonb)),
    'urgent_tickets_count', jsonb_array_length(COALESCE(v_urgent_tickets, '[]'::jsonb)),
    'lead_followups_count', jsonb_array_length(COALESCE(v_lead_followups, '[]'::jsonb)),
    'recent_payments_count', jsonb_array_length(COALESCE(v_recent_payments, '[]'::jsonb)),
    'recent_payments_total', (
      SELECT COALESCE(SUM(amount), 0) FROM public.payments
      WHERE paid_at > now() - interval '24 hours' AND type = 'payment'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'summary', v_summary,
    'overdue_bookings', COALESCE(v_overdue_bookings, '[]'::jsonb),
    'trials_ending', COALESCE(v_trials_ending, '[]'::jsonb),
    'failed_devices', COALESCE(v_failed_devices, '[]'::jsonb),
    'urgent_tickets', COALESCE(v_urgent_tickets, '[]'::jsonb),
    'lead_followups', COALESCE(v_lead_followups, '[]'::jsonb),
    'recent_payments', COALESCE(v_recent_payments, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_admin_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_admin_today() TO authenticated, service_role;

-- ============================================================
-- Master Plan H: Global Search
-- ============================================================

CREATE OR REPLACE FUNCTION public.app_global_search(
  p_query text,
  p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_pattern text;
  v_limit int;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  IF length(p_query) < 2 THEN
    RETURN jsonb_build_object('ok', true, 'results', '[]'::jsonb, 'error', 'Query must be at least 2 characters');
  END IF;

  v_limit := p_limit;
  v_pattern := '%' || lower(p_query) || '%';

  -- Lodges (settings is the company/lodge entity)
  SELECT v_results || jsonb_agg(row_to_json(t)) INTO v_results
  FROM (
    SELECT 'lodge' as type, s.lodge_id::text as id, COALESCE(s.lodge_name, s.company_name, 'Unknown') as title,
           s.business_type as subtitle, 'Home' as icon
    FROM public.settings s
    WHERE s.deleted = false
      AND (lower(s.lodge_name) LIKE v_pattern OR lower(s.company_name) LIKE v_pattern OR lower(s.email) LIKE v_pattern)
    LIMIT v_limit
  ) t;

  -- Licenses
  SELECT v_results || jsonb_agg(row_to_json(t)) INTO v_results
  FROM (
    SELECT 'license' as type, l.id::text as id,
           (l.subscription_plan || ' — ' || COALESCE(s.lodge_name, l.lodge_name, 'Unknown')) as title,
           (CASE WHEN l.is_active THEN 'active' ELSE 'inactive' END) as subtitle,
           'CreditCard' as icon
    FROM public.licenses l
    LEFT JOIN public.settings s ON s.lodge_id = l.lodge_id
    WHERE lower(l.subscription_plan) LIKE v_pattern
       OR lower(l.lodge_name) LIKE v_pattern
       OR lower(l.license_key) LIKE v_pattern
    LIMIT v_limit
  ) t;

  -- Support tickets (using title)
  SELECT v_results || jsonb_agg(row_to_json(t)) INTO v_results
  FROM (
    SELECT 'ticket' as type, t.id::text as id, t.title,
           (t.priority || ' — ' || t.status) as subtitle, 'LifeBuoy' as icon
    FROM public.support_tickets t
    WHERE lower(t.title) LIKE v_pattern
       OR lower(t.description) LIKE v_pattern
    LIMIT v_limit
  ) t;

  -- Marketing leads
  SELECT v_results || jsonb_agg(row_to_json(t)) INTO v_results
  FROM (
    SELECT 'lead' as type, ml.id::text as id, ml.contact_name as title,
           (ml.lodge_name || ' — ' || COALESCE(ml.stage, ml.status, 'new')) as subtitle,
           'Users' as icon
    FROM public.marketing_leads ml
    WHERE lower(ml.contact_name) LIKE v_pattern
       OR lower(ml.lodge_name) LIKE v_pattern
       OR lower(ml.email) LIKE v_pattern
    LIMIT v_limit
  ) t;

  -- Device health reports (using real columns)
  SELECT v_results || jsonb_agg(row_to_json(t)) INTO v_results
  FROM (
    SELECT 'device' as type, dhr.id::text as id,
           (dhr.device_id || ' (' || dhr.client_type || ')') as title,
           (dhr.reconciliation_state || ' — ' || COALESCE(s.lodge_name, dhr.lodge_id::text)) as subtitle,
           'Server' as icon
    FROM public.device_health_reports dhr
    LEFT JOIN public.settings s ON s.lodge_id = dhr.lodge_id
    WHERE lower(dhr.device_id) LIKE v_pattern
       OR lower(dhr.lodge_id::text) LIKE v_pattern
    LIMIT v_limit
  ) t;

  RETURN jsonb_build_object('ok', true, 'results', COALESCE(v_results, '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.app_global_search(text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_global_search(text,int) TO authenticated, service_role;

-- ============================================================
-- Master Plan I: Bulk Actions
-- Safe only: leads, tickets. NO invoice/payment mutations.
-- ============================================================

-- RPC: Bulk status update (leads, tickets only)
CREATE OR REPLACE FUNCTION public.app_bulk_update_status(
  p_entity_type text,
  p_entity_ids uuid[],
  p_new_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int := 0;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  CASE p_entity_type
    WHEN 'ticket' THEN
      UPDATE public.support_tickets SET status = p_new_status, updated_at = now()
      WHERE id = ANY(p_entity_ids);
      GET DIAGNOSTICS v_updated = ROW_COUNT;

    WHEN 'lead' THEN
      UPDATE public.marketing_leads SET stage = p_new_status, updated_at = now()
      WHERE id = ANY(p_entity_ids);
      GET DIAGNOSTICS v_updated = ROW_COUNT;

    ELSE
      RAISE EXCEPTION 'Bulk update not supported for: %. Allowed: ticket, lead', p_entity_type;
  END CASE;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.app_bulk_update_status(text,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_bulk_update_status(text,uuid[],text) TO authenticated, service_role;

-- RPC: Bulk soft-delete (leads only)
CREATE OR REPLACE FUNCTION public.app_bulk_delete(
  p_entity_type text,
  p_entity_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted int := 0;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  CASE p_entity_type
    WHEN 'lead' THEN
      UPDATE public.marketing_leads SET status = 'dropped', stage = 'lost', updated_at = now()
      WHERE id = ANY(p_entity_ids);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;

    ELSE
      RAISE EXCEPTION 'Bulk delete not supported for: %. Allowed: lead', p_entity_type;
  END CASE;

  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted);
END;
$$;

REVOKE ALL ON FUNCTION public.app_bulk_delete(text,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_bulk_delete(text,uuid[]) TO authenticated, service_role;

-- RPC: Bulk send notification (tickets, leads)
CREATE OR REPLACE FUNCTION public.app_bulk_notify(
  p_entity_type text,
  p_entity_ids uuid[],
  p_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notified int := 0;
  v_rec record;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  CASE p_entity_type
    WHEN 'ticket' THEN
      FOR v_rec IN SELECT t.id, t.title
        FROM public.support_tickets t WHERE t.id = ANY(p_entity_ids)
      LOOP
        INSERT INTO public.admin_notifications (title, body, type, entity_type, entity_id)
        VALUES ('Message: ' || v_rec.title, p_message, 'message', 'ticket', v_rec.id::text);
        v_notified := v_notified + 1;
      END LOOP;

    WHEN 'lead' THEN
      FOR v_rec IN SELECT ml.id, ml.contact_name
        FROM public.marketing_leads ml WHERE ml.id = ANY(p_entity_ids)
      LOOP
        INSERT INTO public.admin_notifications (title, body, type, entity_type, entity_id)
        VALUES ('Message: ' || v_rec.contact_name, p_message, 'message', 'lead', v_rec.id::text);
        v_notified := v_notified + 1;
      END LOOP;

    ELSE
      RAISE EXCEPTION 'Bulk notify not supported for: %. Allowed: ticket, lead', p_entity_type;
  END CASE;

  RETURN jsonb_build_object('ok', true, 'notified', v_notified);
END;
$$;

REVOKE ALL ON FUNCTION public.app_bulk_notify(text,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_bulk_notify(text,uuid[],text) TO authenticated, service_role;

-- ============================================================
-- Master Plan E: Deep Fleet Health + App Update Control
-- Using REAL device_health_reports columns only
-- ============================================================

-- RPC: Sync queue status across devices (real columns only)
CREATE OR REPLACE FUNCTION public.app_get_sync_queue_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_devices jsonb;
  v_stale_count int;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  -- Latest heartbeat per device using real columns
  SELECT jsonb_agg(row_to_json(t)) INTO v_devices
  FROM (
    SELECT dhr.lodge_id::text, COALESCE(s.lodge_name, s.company_name, dhr.lodge_id::text) as lodge_name,
           dhr.device_id, dhr.client_type, dhr.reported_at,
           dhr.pending_queue_count, dhr.failed_queue_count,
           dhr.unresolved_local_count, dhr.replay_auth_ready,
           dhr.last_successful_sync_at, dhr.reconciliation_state,
           dhr.top_fault_types
    FROM (
      SELECT DISTINCT ON (COALESCE(device_id, lodge_id::text || '-' || client_type))
        *
      FROM public.device_health_reports
      ORDER BY COALESCE(device_id, lodge_id::text || '-' || client_type), reported_at DESC
    ) dhr
    LEFT JOIN public.settings s ON s.lodge_id = dhr.lodge_id
    ORDER BY dhr.reported_at DESC
  ) t;

  -- Count stale devices (no heartbeat in 24h)
  SELECT count(*) INTO v_stale_count
  FROM (
    SELECT DISTINCT ON (COALESCE(device_id, lodge_id::text || '-' || client_type))
      reported_at
    FROM public.device_health_reports
    ORDER BY COALESCE(device_id, lodge_id::text || '-' || client_type), reported_at DESC
  ) latest
  WHERE latest.reported_at < now() - interval '24 hours';

  RETURN jsonb_build_object(
    'ok', true,
    'devices', COALESCE(v_devices, '[]'::jsonb),
    'stale_count', v_stale_count,
    'total_devices', jsonb_array_length(COALESCE(v_devices, '[]'::jsonb))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_sync_queue_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_sync_queue_status() TO authenticated, service_role;

-- RPC: Push app update notification to all lodges
CREATE OR REPLACE FUNCTION public.app_push_update_notification(
  p_version text,
  p_message text DEFAULT '',
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  INSERT INTO public.admin_notifications (title, body, type, entity_type, entity_id)
  VALUES (
    'App Update Available: v' || p_version,
    COALESCE(NULLIF(p_message, ''), 'A new version (v' || p_version || ') is available. Please update at your earliest convenience.'),
    'system',
    'app_update',
    p_version
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.app_push_update_notification(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_push_update_notification(text,text,boolean) TO authenticated, service_role;

-- ============================================================
-- Master Plan F: Real Release Rollout Control
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  release_notes text NOT NULL DEFAULT '',
  channel text NOT NULL DEFAULT 'stable',
  force_update boolean NOT NULL DEFAULT false,
  min_version text,
  rollout_pct int NOT NULL DEFAULT 0 CHECK (rollout_pct >= 0 AND rollout_pct <= 100),
  status text NOT NULL DEFAULT 'rolling_out' CHECK (status IN ('draft', 'rolling_out', 'full', 'paused', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_releases_channel_status_created
  ON public.app_releases (channel, status, created_at DESC);

ALTER TABLE public.app_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can manage app releases" ON public.app_releases;
CREATE POLICY "Super admins can manage app releases"
  ON public.app_releases FOR ALL
  USING (
    public.app_is_service_role()
    OR public.app_current_role() = 'super_admin'
  )
  WITH CHECK (
    public.app_is_service_role()
    OR public.app_current_role() = 'super_admin'
  );

-- RPC: Create a release
CREATE OR REPLACE FUNCTION public.app_create_release(
  p_version text,
  p_release_notes text DEFAULT '',
  p_channel text DEFAULT 'stable',
  p_force_update boolean DEFAULT false,
  p_min_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  INSERT INTO public.app_releases (version, release_notes, channel, force_update, min_version)
  VALUES (p_version, p_release_notes, p_channel, p_force_update, p_min_version);

  RETURN jsonb_build_object('ok', true, 'version', p_version);
END;
$$;

REVOKE ALL ON FUNCTION public.app_create_release(text,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_create_release(text,text,text,boolean,text) TO authenticated, service_role;

-- RPC: Update release rollout percentage
CREATE OR REPLACE FUNCTION public.app_update_release(
  p_version text,
  p_rollout_pct int DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_release_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  UPDATE public.app_releases SET
    rollout_pct = COALESCE(p_rollout_pct, rollout_pct),
    status = COALESCE(p_status, status),
    release_notes = COALESCE(p_release_notes, release_notes),
    updated_at = now()
  WHERE version = p_version;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.app_update_release(text,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_update_release(text,int,text,text) TO authenticated, service_role;

-- RPC: Check if a specific version should be offered to a device
-- Uses abs(hashtext) for safe deterministic rollout
CREATE OR REPLACE FUNCTION public.app_check_update_availability(
  p_current_version text,
  p_device_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_release record;
  v_should_update boolean := false;
  v_target_version text;
  v_current_parts int[];
  v_target_parts int[];
BEGIN
  -- Find the latest stable release
  SELECT * INTO v_release
  FROM public.app_releases
  WHERE status IN ('rolling_out', 'full')
    AND channel = 'stable'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'update_available', false);
  END IF;

  v_target_version := v_release.version;

  -- Safely parse semver (fallback to 0.0.0 for invalid versions)
  BEGIN
    v_current_parts := string_to_array(p_current_version, '.')::int[];
  EXCEPTION WHEN OTHERS THEN
    v_current_parts := ARRAY[0, 0, 0];
  END;

  BEGIN
    v_target_parts := string_to_array(v_target_version, '.')::int[];
  EXCEPTION WHEN OTHERS THEN
    v_target_parts := ARRAY[0, 0, 0];
  END;

  -- Pad arrays to length 3
  IF array_length(v_current_parts, 1) < 3 THEN
    v_current_parts := v_current_parts || array_fill(0, ARRAY[3 - array_length(v_current_parts, 1)]);
  END IF;
  IF array_length(v_target_parts, 1) < 3 THEN
    v_target_parts := v_target_parts || array_fill(0, ARRAY[3 - array_length(v_target_parts, 1)]);
  END IF;

  -- Compare versions: target > current
  IF (v_target_parts[1] > v_current_parts[1])
     OR (v_target_parts[1] = v_current_parts[1] AND v_target_parts[2] > v_current_parts[2])
     OR (v_target_parts[1] = v_current_parts[1] AND v_target_parts[2] = v_current_parts[2] AND v_target_parts[3] > v_current_parts[3])
  THEN
    IF v_release.status = 'full' THEN
      v_should_update := true;
    ELSIF v_release.status = 'rolling_out' AND v_release.rollout_pct >= 100 THEN
      v_should_update := true;
    ELSIF v_release.rollout_pct > 0 AND p_device_id IS NOT NULL THEN
      -- Deterministic hash-based rollout: abs(hashtext) for safe modulo
      v_should_update := (abs(hashtext(p_device_id)) % 100) < v_release.rollout_pct;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'update_available', v_should_update,
    'latest_version', v_target_version,
    'release_notes', v_release.release_notes,
    'force_update', v_release.force_update,
    'channel', v_release.channel
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_check_update_availability(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_check_update_availability(text,text) TO authenticated, service_role;

-- RPC: Get all releases
CREATE OR REPLACE FUNCTION public.app_get_releases()
RETURNS SETOF public.app_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  RETURN QUERY
  SELECT * FROM public.app_releases ORDER BY created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_releases() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_releases() TO authenticated, service_role;
