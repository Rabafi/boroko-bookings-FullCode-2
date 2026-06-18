-- ============================================================
-- Master Plan G: Notification Automation
-- Event-driven alert rules + automated notification dispatch
-- Schema-corrected: settings=lodge/company, licenses=plural,
-- support_tickets.title, real device_health_reports columns
-- ============================================================

-- Alert rule definitions
CREATE TABLE IF NOT EXISTS public.notification_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key    text NOT NULL UNIQUE,
  label       text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled     boolean NOT NULL DEFAULT true,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  channel     text NOT NULL DEFAULT 'inbox' CHECK (channel IN ('inbox','email','both')),
  cooldown_minutes int NOT NULL DEFAULT 60,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Event log for automated notifications (audit trail)
CREATE TABLE IF NOT EXISTS public.notification_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key     text NOT NULL REFERENCES public.notification_rules(rule_key),
  entity_type  text NOT NULL,
  entity_id    text,
  entity_label text,
  payload      jsonb NOT NULL DEFAULT '{}',
  dispatched   boolean NOT NULL DEFAULT false,
  dispatched_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_events_rule ON public.notification_events(rule_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_events_dispatched ON public.notification_events(dispatched, created_at DESC);

-- RPC: upsert a notification rule
CREATE OR REPLACE FUNCTION public.app_upsert_notification_rule(
  p_rule_key text,
  p_label text,
  p_description text DEFAULT '',
  p_enabled boolean DEFAULT true,
  p_severity text DEFAULT 'info',
  p_channel text DEFAULT 'inbox',
  p_cooldown_minutes int DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  INSERT INTO public.notification_rules (rule_key, label, description, enabled, severity, channel, cooldown_minutes, updated_at)
  VALUES (p_rule_key, p_label, p_description, p_enabled, p_severity, p_channel, p_cooldown_minutes, now())
  ON CONFLICT (rule_key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    enabled = EXCLUDED.enabled,
    severity = EXCLUDED.severity,
    channel = EXCLUDED.channel,
    cooldown_minutes = EXCLUDED.cooldown_minutes,
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.app_upsert_notification_rule(text,text,text,boolean,text,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_upsert_notification_rule(text,text,text,boolean,text,text,int) TO authenticated, service_role;

-- RPC: get all notification rules
CREATE OR REPLACE FUNCTION public.app_get_notification_rules()
RETURNS SETOF public.notification_rules
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.notification_rules ORDER BY rule_key;
$$;

REVOKE ALL ON FUNCTION public.app_get_notification_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_notification_rules() TO authenticated, service_role;

-- RPC: evaluate and dispatch notifications for a given rule
CREATE OR REPLACE FUNCTION public.app_evaluate_notification_rule(p_rule_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_last_dispatch timestamptz;
  v_count int := 0;
  v_entity_type text;
  v_entity_id text;
  v_entity_label text;
  v_title text;
  v_body text;
  v_trial_length_days int := 30;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  SELECT * INTO v_rule FROM public.notification_rules WHERE rule_key = p_rule_key AND enabled = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Rule not found or disabled');
  END IF;

  -- Check cooldown
  SELECT dispatched_at INTO v_last_dispatch
  FROM public.notification_events
  WHERE rule_key = p_rule_key AND dispatched = true
  ORDER BY dispatched_at DESC LIMIT 1;

  IF v_last_dispatch IS NOT NULL AND v_last_dispatch > now() - (v_rule.cooldown_minutes || ' minutes')::interval THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'cooldown');
  END IF;

  CASE p_rule_key
    -- Trial ending: use settings.trial_started_at + 30 days as trial end
    WHEN 'trial_ending' THEN
      v_entity_type := 'lodge';
      FOR v_entity_type, v_entity_id, v_entity_label IN
        SELECT 'lodge', s.lodge_id::text, COALESCE(s.lodge_name, s.company_name, 'Unknown')
        FROM public.settings s
        WHERE s.trial_started_at IS NOT NULL
          AND s.deleted = false
          AND (s.trial_started_at + (v_trial_length_days || ' days')::interval) > now()
          AND (s.trial_started_at + (v_trial_length_days || ' days')::interval) <= now() + interval '3 days'
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_events ne
            WHERE ne.rule_key = 'trial_ending' AND ne.entity_id = s.lodge_id::text
              AND ne.created_at > now() - interval '7 days'
          )
      LOOP
        v_title := 'Trial ending soon: ' || v_entity_label;
        v_body := 'Trial expires within 3 days.';
        INSERT INTO public.notification_events (rule_key, entity_type, entity_id, entity_label, payload)
        VALUES (p_rule_key, v_entity_type, v_entity_id, v_entity_label, jsonb_build_object('title', v_title, 'body', v_body));
        INSERT INTO public.admin_notifications (title, body, type, entity_type, entity_id)
        VALUES (v_title, v_body, 'warning', v_entity_type, v_entity_id);
        v_count := v_count + 1;
      END LOOP;

    -- Trial expired
    WHEN 'trial_expired' THEN
      v_entity_type := 'lodge';
      FOR v_entity_type, v_entity_id, v_entity_label IN
        SELECT 'lodge', s.lodge_id::text, COALESCE(s.lodge_name, s.company_name, 'Unknown')
        FROM public.settings s
        WHERE s.trial_started_at IS NOT NULL
          AND s.deleted = false
          AND (s.trial_started_at + (v_trial_length_days || ' days')::interval) < now()
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_events ne
            WHERE ne.rule_key = 'trial_expired' AND ne.entity_id = s.lodge_id::text
              AND ne.created_at > now() - interval '7 days'
          )
      LOOP
        v_title := 'Trial expired: ' || v_entity_label;
        v_body := 'This lodge trial has expired.';
        INSERT INTO public.notification_events (rule_key, entity_type, entity_id, entity_label, payload)
        VALUES (p_rule_key, v_entity_type, v_entity_id, v_entity_label, jsonb_build_object('title', v_title, 'body', v_body));
        INSERT INTO public.admin_notifications (title, body, type, entity_type, entity_id)
        VALUES (v_title, v_body, 'error', v_entity_type, v_entity_id);
        v_count := v_count + 1;
      END LOOP;

    -- Sync failure: use failed_queue_count > 0 or reconciliation_state = 'mismatch'
    WHEN 'sync_failure' THEN
      FOR v_entity_type, v_entity_id, v_entity_label IN
        SELECT 'lodge', dhr.lodge_id::text, COALESCE(s.lodge_name, s.company_name, dhr.lodge_id::text)
        FROM public.device_health_reports dhr
        LEFT JOIN public.settings s ON s.lodge_id = dhr.lodge_id
        WHERE (dhr.failed_queue_count > 0 OR dhr.reconciliation_state = 'mismatch')
          AND dhr.reported_at > now() - interval '24 hours'
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_events ne
            WHERE ne.rule_key = 'sync_failure' AND ne.entity_id = dhr.lodge_id::text
              AND ne.created_at > now() - interval '24 hours'
          )
      LOOP
        v_title := 'Sync failure: ' || v_entity_label;
        v_body := 'A device reported sync errors in the last 24 hours.';
        INSERT INTO public.notification_events (rule_key, entity_type, entity_id, entity_label, payload)
        VALUES (p_rule_key, v_entity_type, v_entity_id, v_entity_label, jsonb_build_object('title', v_title, 'body', v_body));
        INSERT INTO public.admin_notifications (title, body, type, entity_type, entity_id)
        VALUES (v_title, v_body, 'error', v_entity_type, v_entity_id);
        v_count := v_count + 1;
      END LOOP;

    -- License expiring: use licenses.expires_at
    WHEN 'license_expiring' THEN
      FOR v_entity_type, v_entity_id, v_entity_label IN
        SELECT 'lodge', s.lodge_id::text, COALESCE(s.lodge_name, s.company_name, 'Unknown')
        FROM public.settings s
        JOIN public.licenses l ON l.lodge_id = s.lodge_id
        WHERE l.is_active = true
          AND l.expires_at IS NOT NULL
          AND l.expires_at > now()
          AND l.expires_at <= now() + interval '7 days'
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_events ne
            WHERE ne.rule_key = 'license_expiring' AND ne.entity_id = s.lodge_id::text
              AND ne.created_at > now() - interval '14 days'
          )
      LOOP
        v_title := 'License expiring: ' || v_entity_label;
        v_body := 'Active license expires within 7 days.';
        INSERT INTO public.notification_events (rule_key, entity_type, entity_id, entity_label, payload)
        VALUES (p_rule_key, v_entity_type, v_entity_id, v_entity_label, jsonb_build_object('title', v_title, 'body', v_body));
        INSERT INTO public.admin_notifications (title, body, type, entity_type, entity_id)
        VALUES (v_title, v_body, 'warning', v_entity_type, v_entity_id);
        v_count := v_count + 1;
      END LOOP;

    -- Urgent support tickets: use title (not subject)
    WHEN 'support_urgent' THEN
      FOR v_entity_type, v_entity_id, v_entity_label IN
        SELECT 'ticket', t.id::text, t.title
        FROM public.support_tickets t
        WHERE t.priority IN ('Urgent', 'Critical')
          AND t.status NOT IN ('resolved', 'closed')
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_events ne
            WHERE ne.rule_key = 'support_urgent' AND ne.entity_id = t.id::text
              AND ne.created_at > now() - interval '24 hours'
          )
      LOOP
        v_title := 'Urgent ticket: ' || v_entity_label;
        v_body := 'An urgent support ticket requires attention.';
        INSERT INTO public.notification_events (rule_key, entity_type, entity_id, entity_label, payload)
        VALUES (p_rule_key, v_entity_type, v_entity_id, v_entity_label, jsonb_build_object('title', v_title, 'body', v_body));
        INSERT INTO public.admin_notifications (title, body, type, entity_type, entity_id)
        VALUES (v_title, v_body, 'error', v_entity_type, v_entity_id);
        v_count := v_count + 1;
      END LOOP;

    -- Lead follow-ups overdue
    WHEN 'lead_followup_overdue' THEN
      FOR v_entity_type, v_entity_id, v_entity_label IN
        SELECT 'lead', ml.id::text, ml.contact_name || ' (' || ml.lodge_name || ')'
        FROM public.marketing_leads ml
        WHERE ml.follow_up_at IS NOT NULL
          AND ml.follow_up_at < now()
          AND (ml.stage IS NULL OR ml.stage NOT IN ('won','lost'))
          AND NOT EXISTS (
            SELECT 1 FROM public.notification_events ne
            WHERE ne.rule_key = 'lead_followup_overdue' AND ne.entity_id = ml.id::text
              AND ne.created_at > now() - interval '7 days'
          )
      LOOP
        v_title := 'Overdue follow-up: ' || v_entity_label;
        v_body := 'A scheduled follow-up has passed.';
        INSERT INTO public.notification_events (rule_key, entity_type, entity_id, entity_label, payload)
        VALUES (p_rule_key, v_entity_type, v_entity_id, v_entity_label, jsonb_build_object('title', v_title, 'body', v_body));
        INSERT INTO public.admin_notifications (title, body, type, entity_type, entity_id)
        VALUES (v_title, v_body, 'info', v_entity_type, v_entity_id);
        v_count := v_count + 1;
      END LOOP;

    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'Unknown rule: ' || p_rule_key);
  END CASE;

  RETURN jsonb_build_object('ok', true, 'created', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.app_evaluate_notification_rule(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_evaluate_notification_rule(text) TO authenticated, service_role;

-- RPC: evaluate all enabled rules
CREATE OR REPLACE FUNCTION public.app_evaluate_all_notification_rules()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  FOR v_rule IN SELECT rule_key FROM public.notification_rules WHERE enabled = true ORDER BY rule_key LOOP
    BEGIN
      SELECT public.app_evaluate_notification_rule(v_rule.rule_key) INTO v_result;
      v_results := v_results || jsonb_build_array(jsonb_build_object('rule', v_rule.rule_key, 'result', v_result));
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object('rule', v_rule.rule_key, 'error', SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'results', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.app_evaluate_all_notification_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_evaluate_all_notification_rules() TO authenticated, service_role;

-- RPC: get notification events (audit trail)
CREATE OR REPLACE FUNCTION public.app_get_notification_events(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_rule_key text DEFAULT NULL,
  p_dispatched boolean DEFAULT NULL
)
RETURNS SETOF public.notification_events
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.notification_events
  WHERE (p_rule_key IS NULL OR rule_key = p_rule_key)
    AND (p_dispatched IS NULL OR dispatched = p_dispatched)
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.app_get_notification_events(int,int,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_notification_events(int,int,text,boolean) TO authenticated, service_role;

-- RPC: get event summary counts
CREATE OR REPLACE FUNCTION public.app_get_notification_event_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_undispatched int;
  v_rules_active int;
  v_by_rule jsonb;
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  SELECT count(*) INTO v_total FROM public.notification_events;
  SELECT count(*) INTO v_undispatched FROM public.notification_events WHERE dispatched = false;
  SELECT count(*) INTO v_rules_active FROM public.notification_rules WHERE enabled = true;

  SELECT jsonb_object_agg(rule_key, cnt) INTO v_by_rule
  FROM (
    SELECT rule_key, count(*) as cnt FROM public.notification_events
    WHERE created_at > now() - interval '7 days'
    GROUP BY rule_key
  ) sub;

  RETURN jsonb_build_object(
    'total_events', v_total,
    'undispatched', v_undispatched,
    'active_rules', v_rules_active,
    'events_by_rule_7d', COALESCE(v_by_rule, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_get_notification_event_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_get_notification_event_summary() TO authenticated, service_role;

-- RPC: mark events as dispatched
CREATE OR REPLACE FUNCTION public.app_mark_events_dispatched(p_event_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  UPDATE public.notification_events
  SET dispatched = true, dispatched_at = now()
  WHERE id = ANY(p_event_ids);

  RETURN jsonb_build_object('ok', true, 'updated', array_length(p_event_ids, 1));
END;
$$;

REVOKE ALL ON FUNCTION public.app_mark_events_dispatched(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_mark_events_dispatched(uuid[]) TO authenticated, service_role;

-- Seed default rules
INSERT INTO public.notification_rules (rule_key, label, description, severity, channel, cooldown_minutes) VALUES
  ('trial_ending', 'Trial Ending', 'Alerts when a lodge trial is within 3 days of expiry (30-day trial).', 'warning', 'inbox', 1440),
  ('trial_expired', 'Trial Expired', 'Alerts when a lodge trial has expired.', 'critical', 'inbox', 1440),
  ('sync_failure', 'Sync Failure', 'Alerts when a device reports failed_queue_count > 0 or reconciliation_state = mismatch.', 'critical', 'inbox', 360),
  ('license_expiring', 'License Expiring', 'Alerts when an active license expires within 7 days.', 'warning', 'inbox', 1440),
  ('support_urgent', 'Urgent Support Ticket', 'Alerts on open urgent/critical support tickets.', 'critical', 'inbox', 360),
  ('lead_followup_overdue', 'Lead Follow-up Overdue', 'Alerts when a scheduled lead follow-up has passed.', 'info', 'inbox', 720)
ON CONFLICT (rule_key) DO NOTHING;
