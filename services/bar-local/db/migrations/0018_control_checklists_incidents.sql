-- Operational control records are append-only evidence with explicit
-- completion/resolution transitions. They never rewrite financial or stock data.

CREATE TABLE IF NOT EXISTS bar_local.control_templates (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  name text NOT NULL,
  checklist_type text NOT NULL CHECK (checklist_type IN ('opening', 'service', 'safety', 'closing')),
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bar_local.control_template_items (
  template_key text NOT NULL REFERENCES bar_local.control_templates(key),
  item_key text NOT NULL CHECK (item_key ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT true,
  PRIMARY KEY (template_key, item_key)
);

CREATE TABLE IF NOT EXISTS bar_local.control_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  template_key text NOT NULL REFERENCES bar_local.control_templates(key),
  template_name text NOT NULL,
  checklist_type text NOT NULL,
  checklist_date date NOT NULL,
  shift_id uuid REFERENCES bar_local.shifts(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  started_by uuid NOT NULL REFERENCES bar_local.staff(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id)
);
CREATE INDEX IF NOT EXISTS control_checklists_scope_idx
  ON bar_local.control_checklists (business_id, outlet_id, checklist_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS bar_local.control_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES bar_local.control_checklists(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  label text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  completed boolean NOT NULL DEFAULT false,
  note text,
  completed_by uuid REFERENCES bar_local.staff(id),
  completed_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (checklist_id, item_key)
);
CREATE INDEX IF NOT EXISTS control_checklist_items_checklist_idx
  ON bar_local.control_checklist_items (checklist_id, sort_order);

CREATE TABLE IF NOT EXISTS bar_local.control_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  incident_date date NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description text NOT NULL,
  immediate_action text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolution text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  reported_by uuid NOT NULL REFERENCES bar_local.staff(id),
  resolved_by uuid REFERENCES bar_local.staff(id),
  operation_id uuid NOT NULL UNIQUE,
  resolved_operation_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS control_incidents_scope_idx
  ON bar_local.control_incidents (business_id, outlet_id, incident_date DESC, id DESC);

INSERT INTO bar_local.control_templates (key, name, checklist_type, sort_order) VALUES
  ('bar.opening', 'Bar opening checklist', 'opening', 10),
  ('bar.service', 'Bar service readiness checklist', 'service', 20),
  ('bar.safety', 'Bar safety and compliance checklist', 'safety', 30),
  ('bar.closing', 'Bar closing checklist', 'closing', 40)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, checklist_type = EXCLUDED.checklist_type, sort_order = EXCLUDED.sort_order;

INSERT INTO bar_local.control_template_items (template_key, item_key, label, sort_order, required) VALUES
  ('bar.opening', 'cleanliness', 'Bar surfaces, glassware and floor are clean', 10, true),
  ('bar.opening', 'stock-levels', 'Beer, spirits, mixers and garnishes are stocked', 20, true),
  ('bar.opening', 'cash-float', 'Opening cash float has been counted and recorded', 30, true),
  ('bar.opening', 'equipment', 'Fridges, ice machine, taps and POS equipment are working', 40, true),
  ('bar.service', 'glassware', 'Clean glassware is available at every station', 10, true),
  ('bar.service', 'ice-garnish', 'Ice and garnishes are available and hygienic', 20, true),
  ('bar.service', 'menu-prices', 'Menu availability and prices match the POS', 30, true),
  ('bar.service', 'waste-area', 'Service waste area is clear and safe', 40, false),
  ('bar.safety', 'fire-exits', 'Fire exits and extinguishers are unobstructed and in date', 10, true),
  ('bar.safety', 'spill-control', 'Spill kit and wet-floor controls are available', 20, true),
  ('bar.safety', 'electrical', 'Electrical leads, sockets and equipment show no damage', 30, true),
  ('bar.safety', 'incident-review', 'Previous incidents and corrective actions have been reviewed', 40, false),
  ('bar.closing', 'stock-count', 'Stock has been secured and high-value items counted', 10, true),
  ('bar.closing', 'cash-secured', 'Cash and receipts are secured or cashed up', 20, true),
  ('bar.closing', 'equipment-off', 'Equipment is switched off and fridges are closed', 30, true),
  ('bar.closing', 'premises-secure', 'Doors, windows and alarms are secured', 40, true)
ON CONFLICT (template_key, item_key) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, required = EXCLUDED.required;

CREATE OR REPLACE FUNCTION bar_local.control_checklist_json(p_checklist_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'checklist_id', c.id, 'template_key', c.template_key, 'template_name', c.template_name,
    'checklist_type', c.checklist_type, 'checklist_date', c.checklist_date, 'shift_id', c.shift_id,
    'status', c.status, 'version', c.version, 'started_by', c.started_by, 'started_at', c.started_at,
    'completed_at', c.completed_at,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'item_id', i.id, 'item_key', i.item_key, 'label', i.label, 'required', i.required,
      'completed', i.completed, 'note', i.note, 'completed_by', i.completed_by,
      'completed_at', i.completed_at, 'sort_order', i.sort_order
    ) ORDER BY i.sort_order, i.item_key) FROM bar_local.control_checklist_items i WHERE i.checklist_id = c.id), '[]'::jsonb)
  )
  FROM bar_local.control_checklists c WHERE c.id = p_checklist_id;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_control_checklist_start(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_template bar_local.control_templates%ROWTYPE;
  v_checklist_id uuid;
  v_data jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_template FROM bar_local.control_templates WHERE key = v_payload->>'template_key';
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('CHECKLIST_TEMPLATE_NOT_FOUND', 'The checklist template is not available.');
    END IF;
    IF (v_payload->>'shift_id') IS NOT NULL THEN
      PERFORM 1 FROM bar_local.shifts WHERE id = (v_payload->>'shift_id')::uuid
        AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'The selected shift does not belong to this outlet.');
      END IF;
    END IF;
    INSERT INTO bar_local.control_checklists
      (business_id, outlet_id, template_key, template_name, checklist_type, checklist_date, shift_id,
       started_by, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_template.key, v_template.name, v_template.checklist_type,
       COALESCE((v_payload->>'checklist_date')::date, bar_local.current_business_date()),
       NULLIF(v_payload->>'shift_id', '')::uuid, v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_checklist_id;
    INSERT INTO bar_local.control_checklist_items
      (checklist_id, item_key, label, required, sort_order)
    SELECT v_checklist_id, ti.item_key, ti.label, ti.required, ti.sort_order
      FROM bar_local.control_template_items ti
     WHERE ti.template_key = v_template.key
     ORDER BY ti.sort_order, ti.item_key;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The checklist template has no items.');
    END IF;
    v_data := bar_local.control_checklist_json(v_checklist_id);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'control.checklist.started', (p_envelope->>'operation_id')::uuid, NULL, v_data);
    v_data := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_data, v_data, jsonb_build_array(jsonb_build_object('event_type','control.checklist.started','payload',v_data)),
      (v_data->>'checklist_date')::date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_data, 'result', v_data);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_control_checklist_item_set(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_checklist bar_local.control_checklists%ROWTYPE;
  v_item bar_local.control_checklist_items%ROWTYPE;
  v_before jsonb;
  v_data jsonb;
  v_open_required integer;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_checklist FROM bar_local.control_checklists
     WHERE id = (v_payload->>'checklist_id')::uuid AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('CHECKLIST_NOT_FOUND', 'The checklist could not be found in this outlet.');
    END IF;
    IF v_checklist.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('CHECKLIST_VERSION_CONFLICT', 'The checklist changed since it was loaded. Refresh and try again.');
    END IF;
    SELECT * INTO v_item FROM bar_local.control_checklist_items
     WHERE id = (v_payload->>'item_id')::uuid AND checklist_id = v_checklist.id FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('CHECKLIST_ITEM_NOT_FOUND', 'The checklist item could not be found.');
    END IF;
    v_before := bar_local.control_checklist_json(v_checklist.id);
    UPDATE bar_local.control_checklist_items
       SET completed = (v_payload->>'completed')::boolean,
           note = NULLIF(trim(v_payload->>'note'), ''),
           completed_by = CASE WHEN (v_payload->>'completed')::boolean THEN v_ctx.staff_id ELSE NULL END,
           completed_at = CASE WHEN (v_payload->>'completed')::boolean THEN now() ELSE NULL END
     WHERE id = v_item.id;
    SELECT count(*) INTO v_open_required FROM bar_local.control_checklist_items
     WHERE checklist_id = v_checklist.id AND required AND NOT completed;
    UPDATE bar_local.control_checklists
       SET status = CASE WHEN v_open_required = 0 THEN 'completed' ELSE 'open' END,
           completed_at = CASE WHEN v_open_required = 0 THEN now() ELSE NULL END,
           version = version + 1
     WHERE id = v_checklist.id;
    v_data := bar_local.control_checklist_json(v_checklist.id);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'control.checklist.item.updated', (p_envelope->>'operation_id')::uuid, v_before, v_data);
    v_data := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_data, v_data, jsonb_build_array(jsonb_build_object('event_type','control.checklist.item.updated','payload',v_data)),
      (v_data->>'checklist_date')::date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_data, 'result', v_data);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_control_incident_log(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_data jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    INSERT INTO bar_local.control_incidents
      (business_id, outlet_id, incident_date, category, severity, description, immediate_action,
       reported_by, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id,
       COALESCE((v_payload->>'incident_date')::date, bar_local.current_business_date()),
       trim(v_payload->>'category'), v_payload->>'severity', trim(v_payload->>'description'),
       NULLIF(trim(v_payload->>'immediate_action'), ''), v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
    RETURNING to_jsonb(control_incidents.*) INTO v_data;
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'control.incident.logged', (p_envelope->>'operation_id')::uuid, NULL, v_data);
    v_data := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_data, v_data, jsonb_build_array(jsonb_build_object('event_type','control.incident.logged','payload',v_data)),
      (v_data->>'incident_date')::date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_data, 'result', v_data);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_control_incident_resolve(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_before jsonb;
  v_data jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT to_jsonb(control_incidents.*) INTO v_before FROM bar_local.control_incidents
     WHERE id = (v_payload->>'incident_id')::uuid AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('INCIDENT_NOT_FOUND', 'The incident could not be found in this outlet.');
    END IF;
    IF (v_before->>'version')::integer <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('INCIDENT_VERSION_CONFLICT', 'The incident changed since it was loaded. Refresh and try again.');
    END IF;
    IF v_before->>'status' = 'resolved' THEN
      PERFORM bar_local.raise_business('INCIDENT_STATE_CONFLICT', 'The incident is already resolved.');
    END IF;
    UPDATE bar_local.control_incidents
       SET status = 'resolved', resolution = trim(v_payload->>'resolution'),
           resolved_by = v_ctx.staff_id, resolved_at = now(), version = version + 1,
           resolved_operation_id = (p_envelope->>'operation_id')::uuid
     WHERE id = (v_payload->>'incident_id')::uuid
     RETURNING to_jsonb(control_incidents.*) INTO v_data;
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'control.incident.resolved', (p_envelope->>'operation_id')::uuid, v_before, v_data);
    v_data := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_data, v_data, jsonb_build_array(jsonb_build_object('event_type','control.incident.resolved','payload',v_data)),
      (v_data->>'incident_date')::date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_data, 'result', v_data);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) RENAME TO query_dispatch_reports;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb;
  v_limit integer;
  v_data jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next text;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
  v_from date;
  v_to date;
  v_cursor_date date;
  v_cursor_id uuid;
  v_checklist_id uuid;
  v_incident_id uuid;
BEGIN
  IF p_query IS NULL OR p_query NOT IN ('control.templates.list', 'control.checklists.list', 'control.checklist.get', 'control.incidents.list') THEN
    RETURN bar_local.query_dispatch_reports(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters);
  END IF;
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  v_limit := bar_local.query_limit(v_filters);
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id);

  IF p_query = 'control.templates.list' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'template_key', t.key, 'name', t.name, 'checklist_type', t.checklist_type, 'sort_order', t.sort_order,
      'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'item_key', ti.item_key, 'label', ti.label, 'required', ti.required, 'sort_order', ti.sort_order
      ) ORDER BY ti.sort_order, ti.item_key) FROM bar_local.control_template_items ti WHERE ti.template_key = t.key), '[]'::jsonb)
    ) ORDER BY t.sort_order, t.key), '[]'::jsonb) INTO v_data
    FROM bar_local.control_templates t;
  ELSIF p_query = 'control.checklist.get' THEN
    v_checklist_id := (v_filters->>'checklist_id')::uuid;
    SELECT bar_local.control_checklist_json(c.id) INTO v_data
      FROM bar_local.control_checklists c
     WHERE c.id = v_checklist_id AND c.business_id = v_ctx.business_id AND c.outlet_id = v_ctx.outlet_id;
  ELSIF p_query = 'control.incidents.list' THEN
    v_from := COALESCE((v_filters->>'from')::date, bar_local.current_business_date());
    v_to := COALESCE((v_filters->>'to')::date, v_from);
    IF v_to < v_from THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The report end date cannot be before its start date.');
    END IF;
    IF NULLIF(v_filters->>'cursor', '') IS NOT NULL THEN
      v_cursor_date := split_part(v_filters->>'cursor', '|', 1)::date;
      v_cursor_id := split_part(v_filters->>'cursor', '|', 2)::uuid;
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.incident_date DESC, x.id DESC), '[]'::jsonb) INTO v_data
      FROM (
        SELECT i.* FROM bar_local.control_incidents i
         WHERE i.business_id = v_ctx.business_id AND i.outlet_id = v_ctx.outlet_id
           AND i.incident_date BETWEEN v_from AND v_to
           AND (v_filters->>'status' IS NULL OR i.status = v_filters->>'status')
           AND (v_filters->>'severity' IS NULL OR i.severity = v_filters->>'severity')
           AND (v_cursor_date IS NULL OR (i.incident_date, i.id) < (v_cursor_date, v_cursor_id))
         ORDER BY i.incident_date DESC, i.id DESC
         LIMIT v_limit + 1
      ) x;
  ELSE
    v_from := COALESCE((v_filters->>'from')::date, bar_local.current_business_date());
    v_to := COALESCE((v_filters->>'to')::date, v_from);
    IF v_to < v_from THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The report end date cannot be before its start date.');
    END IF;
    IF NULLIF(v_filters->>'cursor', '') IS NOT NULL THEN
      v_cursor_date := split_part(v_filters->>'cursor', '|', 1)::date;
      v_cursor_id := split_part(v_filters->>'cursor', '|', 2)::uuid;
    END IF;
    SELECT COALESCE(jsonb_agg(bar_local.control_checklist_json(x.id) ORDER BY x.checklist_date DESC, x.id DESC), '[]'::jsonb) INTO v_data
      FROM (
        SELECT c.id, c.checklist_date FROM bar_local.control_checklists c
         WHERE c.business_id = v_ctx.business_id AND c.outlet_id = v_ctx.outlet_id
           AND c.checklist_date BETWEEN v_from AND v_to
           AND (v_filters->>'status' IS NULL OR c.status = v_filters->>'status')
           AND (v_filters->>'template_key' IS NULL OR c.template_key = v_filters->>'template_key')
           AND (v_cursor_date IS NULL OR (c.checklist_date, c.id) < (v_cursor_date, v_cursor_id))
         ORDER BY c.checklist_date DESC, c.id DESC
         LIMIT v_limit + 1
      ) x;
  END IF;

  IF p_query IN ('control.checklists.list', 'control.incidents.list') AND jsonb_array_length(v_data) > v_limit THEN
    SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb) INTO v_data
      FROM jsonb_array_elements(v_data) WITH ORDINALITY AS item(value, ordinality)
     WHERE ordinality <= v_limit;
    v_has_more := true;
    IF p_query = 'control.checklists.list' THEN
      v_next := (v_data->-1->>'checklist_date') || '|' || (v_data->-1->>'checklist_id');
    ELSE
      v_next := (v_data->-1->>'incident_date') || '|' || (v_data->-1->>'id');
    END IF;
  END IF;

  RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
    'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION bar_local.control_checklist_json(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.control_checklist_json(uuid) FROM bar_local_runtime;

REVOKE ALL ON bar_local.control_templates FROM PUBLIC;
REVOKE ALL ON bar_local.control_template_items FROM PUBLIC;
REVOKE ALL ON bar_local.control_checklists FROM PUBLIC;
REVOKE ALL ON bar_local.control_checklist_items FROM PUBLIC;
REVOKE ALL ON bar_local.control_incidents FROM PUBLIC;
REVOKE ALL ON bar_local.control_templates FROM bar_local_runtime;
REVOKE ALL ON bar_local.control_template_items FROM bar_local_runtime;
REVOKE ALL ON bar_local.control_checklists FROM bar_local_runtime;
REVOKE ALL ON bar_local.control_checklist_items FROM bar_local_runtime;
REVOKE ALL ON bar_local.control_incidents FROM bar_local_runtime;

ALTER FUNCTION bar_local.cmd_control_checklist_start(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_control_checklist_start(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_control_checklist_item_set(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_control_checklist_item_set(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_control_incident_log(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_control_incident_log(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_control_incident_resolve(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_control_incident_resolve(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;

REVOKE ALL ON FUNCTION bar_local.cmd_control_checklist_start(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_control_checklist_item_set(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_control_incident_log(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_control_incident_resolve(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_control_checklist_start(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_control_checklist_item_set(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_control_incident_log(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_control_incident_resolve(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch_reports(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_reports(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_reports(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_reports(text, uuid, uuid, bigint, text, jsonb) FROM bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
