-- Trusted local session, operation receipt and command lifecycle primitives.
CREATE OR REPLACE FUNCTION bar_local.raise_business(p_code text, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%', p_message USING ERRCODE = 'BL001', DETAIL = p_code;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.sha256_hex(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION bar_local.canonical_jsonb_text(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_type text := jsonb_typeof(p_value);
  v_result text;
BEGIN
  IF p_value IS NULL OR v_type = 'null' THEN
    RETURN 'null';
  END IF;
  IF v_type IN ('string', 'number', 'boolean') THEN
    RETURN p_value::text;
  END IF;
  IF v_type = 'array' THEN
    SELECT COALESCE(string_agg(bar_local.canonical_jsonb_text(element), ',' ORDER BY ordinality), '')
      INTO v_result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS items(element, ordinality);
    RETURN '[' || v_result || ']';
  END IF;
  IF v_type = 'object' THEN
    SELECT COALESCE(string_agg(to_jsonb(key)::text || ':' || bar_local.canonical_jsonb_text(value), ',' ORDER BY key COLLATE "C"), '')
      INTO v_result
      FROM jsonb_each(p_value);
    RETURN '{' || v_result || '}';
  END IF;
  RAISE EXCEPTION 'Unsupported jsonb type %', v_type USING ERRCODE = 'BL001', DETAIL = 'VALIDATION_FAILED';
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.current_business_date()
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE COALESCE(
    NULLIF((SELECT value #>> '{}' FROM bar_local.settings WHERE key = 'timezone'), ''),
    'Africa/Gaborone'
  ))::date;
$$;

CREATE OR REPLACE FUNCTION bar_local.assert_capability(p_capabilities text[], p_required text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_required IS NULL OR p_required = '' THEN RETURN; END IF;
  IF NOT (COALESCE(p_capabilities, ARRAY[]::text[]) @> ARRAY[p_required]) THEN
    PERFORM bar_local.raise_business('CAPABILITY_DENIED', 'This operator does not have the required local capability: ' || p_required);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.assert_feature(p_feature text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_features text[];
BEGIN
  IF p_feature IS NULL OR p_feature = '' THEN RETURN; END IF;
  SELECT entitlement_features INTO v_features FROM bar_local.authority WHERE singleton;
  IF NOT (COALESCE(v_features, ARRAY[]::text[]) @> ARRAY[p_feature]) THEN
    PERFORM bar_local.raise_business('ENTITLEMENT_DENIED', 'This local authority does not hold the signed entitlement for ' || p_feature);
  END IF;
END;
$$;

CREATE TYPE bar_local.session_context AS (
  session_id uuid,
  staff_id uuid,
  business_id uuid,
  outlet_id uuid,
  role text,
  capabilities text[],
  display_name text,
  device_id uuid
);

CREATE OR REPLACE FUNCTION bar_local.current_session(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_business_id uuid,
  p_outlet_id uuid
) RETURNS bar_local.session_context LANGUAGE plpgsql AS $$
DECLARE
  v_authority bar_local.authority%ROWTYPE;
  v_session bar_local.sessions%ROWTYPE;
  v_staff bar_local.staff%ROWTYPE;
  v_device bar_local.devices%ROWTYPE;
BEGIN
  SELECT * INTO v_authority FROM bar_local.authority WHERE singleton;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTHORITY_NOT_COMMISSIONED', 'The local Bar authority has not been commissioned.');
  END IF;
  IF v_authority.authority_id <> p_authority_id THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY', 'This operation targets a different local authority.');
  END IF;
  IF v_authority.authority_epoch <> p_authority_epoch THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY_EPOCH', 'This operation targets an expired local authority epoch.');
  END IF;
  SELECT * INTO v_session FROM bar_local.sessions
   WHERE token_hash = p_token_hash FOR SHARE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTH_INVALID', 'The local session credential is not valid.');
  END IF;
  IF v_session.revoked_at IS NOT NULL THEN
    PERFORM bar_local.raise_business('SESSION_REVOKED', 'This local session has been revoked.');
  END IF;
  IF v_session.expires_at <= now() THEN
    PERFORM bar_local.raise_business('SESSION_EXPIRED', 'This local session has expired.');
  END IF;
  IF v_session.authority_epoch <> p_authority_epoch THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY_EPOCH', 'This local session belongs to an older authority epoch.');
  END IF;
  IF v_session.device_id <> p_device_id OR v_session.business_id <> p_business_id OR v_session.outlet_id <> p_outlet_id THEN
    PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'The operation scope does not match the authenticated session.');
  END IF;
  SELECT * INTO v_device FROM bar_local.devices WHERE id = v_session.device_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('DEVICE_UNKNOWN', 'The paired device could not be found.');
  END IF;
  IF v_device.status = 'revoked' THEN
    PERFORM bar_local.raise_business('DEVICE_REVOKED', 'This device has been revoked.');
  END IF;
  IF v_device.business_id <> p_business_id OR v_device.outlet_id <> p_outlet_id THEN
    PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'The paired device is not scoped to this business and outlet.');
  END IF;
  SELECT * INTO v_staff FROM bar_local.staff WHERE id = v_session.staff_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTH_INVALID', 'The authenticated staff identity no longer exists.');
  END IF;
  IF v_staff.status <> 'active' THEN
    PERFORM bar_local.raise_business('SESSION_REVOKED', 'This staff identity is suspended.');
  END IF;
  IF v_staff.business_id <> p_business_id THEN
    PERFORM bar_local.raise_business('TENANT_SCOPE_MISMATCH', 'The staff identity belongs to another business.');
  END IF;
  RETURN (v_session.id, v_staff.id, v_staff.business_id, v_session.outlet_id,
          v_staff.role, v_staff.capabilities, v_staff.display_name, v_session.device_id);
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.claim_operation(
  p_session bar_local.session_context,
  p_envelope jsonb,
  p_payload_hash text
) RETURNS TABLE (
  replayed boolean,
  operation_status text,
  receipt jsonb,
  result jsonb,
  error jsonb
) LANGUAGE plpgsql AS $$
DECLARE
  v_operation_id uuid := (p_envelope->>'operation_id')::uuid;
  v_command text := p_envelope->>'command';
  v_payload jsonb := COALESCE(p_envelope->'payload', '{}'::jsonb);
  v_existing bar_local.operations%ROWTYPE;
  v_inserted integer;
BEGIN
  INSERT INTO bar_local.operations (
    operation_id, authority_id, authority_epoch, business_id, outlet_id, device_id,
    actor_staff_id, command, payload_hash, payload, status
  ) VALUES (
    v_operation_id, (p_envelope->>'authority_id')::uuid, (p_envelope->>'authority_epoch')::bigint,
    (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid,
    (p_envelope->>'device_id')::uuid, p_session.staff_id, v_command, p_payload_hash, v_payload, 'executing'
  ) ON CONFLICT (operation_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    RETURN QUERY SELECT false, 'executing'::text, NULL::jsonb, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_existing FROM bar_local.operations WHERE operation_id = v_operation_id FOR UPDATE;
  IF v_existing.actor_staff_id <> p_session.staff_id
     OR v_existing.device_id <> p_session.device_id
     OR v_existing.business_id <> p_session.business_id
     OR v_existing.outlet_id <> p_session.outlet_id THEN
    PERFORM bar_local.raise_business('TENANT_SCOPE_MISMATCH', 'This operation identifier belongs to a different authenticated scope. Use the original operator session or an authorised manager lookup.');
  END IF;
  IF v_existing.payload_hash <> p_payload_hash THEN
    PERFORM bar_local.raise_business('IDEMPOTENCY_PAYLOAD_CONFLICT', 'This operation identifier was already used with different content. Keep the original operation and do not create a new key.');
  END IF;
  IF v_existing.status = 'committed' THEN
    RETURN QUERY SELECT true, 'committed'::text, v_existing.receipt, v_existing.result, NULL::jsonb;
    RETURN;
  END IF;
  IF v_existing.status = 'refused' THEN
    RETURN QUERY SELECT true, 'refused'::text, NULL::jsonb, NULL::jsonb, v_existing.error;
    RETURN;
  END IF;
  PERFORM bar_local.raise_business('OPERATION_EXECUTING', 'This operation is still being committed by the local authority. Keep the same operation identifier and retry.');
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.allocate_sequence(p_allocate_receipt boolean DEFAULT false)
RETURNS TABLE (commit_sequence bigint, receipt_sequence bigint) LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  UPDATE bar_local.authority_counter
     SET commit_sequence = commit_sequence + 1,
         receipt_sequence = receipt_sequence + CASE WHEN p_allocate_receipt THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE singleton
  RETURNING authority_counter.commit_sequence, authority_counter.receipt_sequence
       INTO commit_sequence, receipt_sequence;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTHORITY_NOT_COMMISSIONED', 'The local authority counter is missing.');
  END IF;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.finish_committed(
  p_operation_id uuid,
  p_commit_sequence bigint,
  p_result jsonb,
  p_receipt jsonb,
  p_events jsonb,
  p_business_date date
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_envelope jsonb;
  v_event jsonb;
  v_index integer := 0;
  v_receipt jsonb;
  v_staff_id uuid;
  v_business_id uuid;
  v_outlet_id uuid;
  v_epoch bigint;
  v_authority_id uuid;
  v_device_id uuid;
BEGIN
  SELECT payload, actor_staff_id, business_id, outlet_id, authority_epoch, authority_id, device_id
    INTO v_envelope, v_staff_id, v_business_id, v_outlet_id, v_epoch, v_authority_id, v_device_id
    FROM bar_local.operations WHERE operation_id = p_operation_id FOR UPDATE;

  v_receipt := COALESCE(p_receipt, '{}'::jsonb) || jsonb_build_object(
    'operation_id', p_operation_id,
    'outcome', 'committed_local',
    'authority_id', v_authority_id,
    'authority_epoch', v_epoch,
    'business_id', v_business_id,
    'outlet_id', v_outlet_id,
    'device_id', v_device_id,
    'actor_staff_id', v_staff_id,
    'commit_sequence', p_commit_sequence,
    'business_date', p_business_date,
    'server_committed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cloud_status', 'integration_disabled'
  );

  UPDATE bar_local.operations
     SET status = 'committed', outcome = 'committed_local', result = p_result,
         receipt = v_receipt, commit_sequence = p_commit_sequence,
         business_date = p_business_date, committed_at = now()
   WHERE operation_id = p_operation_id;

  IF p_events IS NOT NULL AND jsonb_typeof(p_events) = 'array' THEN
    FOR v_event IN SELECT * FROM jsonb_array_elements(p_events)
    LOOP
      INSERT INTO bar_local.outbox (
        commit_sequence, event_index, business_id, outlet_id, event_type,
        operation_id, authority_epoch, payload, payload_hash
      ) VALUES (
        p_commit_sequence, v_index, v_business_id, v_outlet_id,
        v_event->>'event_type', p_operation_id, v_epoch,
        COALESCE(v_event->'payload', '{}'::jsonb),
        bar_local.sha256_hex(bar_local.canonical_jsonb_text(COALESCE(v_event->'payload', '{}'::jsonb)))
      );
      v_index := v_index + 1;
    END LOOP;
  END IF;

  RETURN v_receipt;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.record_refusal(
  p_operation_id uuid,
  p_code text,
  p_message text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_actor uuid;
  v_business uuid;
  v_outlet uuid;
  v_device uuid;
  v_error jsonb;
BEGIN
  SELECT actor_staff_id, business_id, outlet_id, device_id
    INTO v_actor, v_business, v_outlet, v_device
    FROM bar_local.operations WHERE operation_id = p_operation_id FOR UPDATE;
  v_error := jsonb_build_object(
    'code', p_code, 'message', p_message, 'retry_same_operation', false,
    'requires_manager', p_code IN ('APPROVAL_REQUIRED','APPROVAL_INVALID','APPROVAL_EXPIRED','APPROVAL_CONSUMED','MAKER_CHECKER_VIOLATION','CAPABILITY_DENIED')
  );
  UPDATE bar_local.operations
     SET status = 'refused', outcome = 'refused', error = v_error, refused_at = now()
   WHERE operation_id = p_operation_id;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, operation_id, after)
  VALUES (v_business, v_outlet, v_actor, v_device, 'operation.refused', p_operation_id, v_error);
  RETURN v_error;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.consume_approval(
  p_approval_id uuid,
  p_operation_hash text,
  p_capability text,
  p_business_id uuid,
  p_outlet_id uuid,
  p_actor_staff_id uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_approval bar_local.approvals%ROWTYPE;
BEGIN
  IF p_approval_id IS NULL THEN
    PERFORM bar_local.raise_business('APPROVAL_REQUIRED', 'This action requires a manager approval bound to the exact operation.');
  END IF;
  SELECT * INTO v_approval FROM bar_local.approvals WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('APPROVAL_INVALID', 'The manager approval could not be found.');
  END IF;
  IF v_approval.business_id <> p_business_id OR v_approval.outlet_id <> p_outlet_id THEN
    PERFORM bar_local.raise_business('APPROVAL_SCOPE_MISMATCH', 'The manager approval belongs to another business or outlet.');
  END IF;
  IF v_approval.consumed_at IS NOT NULL THEN
    PERFORM bar_local.raise_business('APPROVAL_CONSUMED', 'This manager approval has already been used.');
  END IF;
  IF v_approval.expires_at <= now() THEN
    PERFORM bar_local.raise_business('APPROVAL_EXPIRED', 'This manager approval has expired.');
  END IF;
  IF v_approval.capability <> p_capability THEN
    PERFORM bar_local.raise_business('APPROVAL_SCOPE_MISMATCH', 'This manager approval is for a different capability.');
  END IF;
  IF v_approval.operation_hash <> p_operation_hash THEN
    PERFORM bar_local.raise_business('APPROVAL_SCOPE_MISMATCH', 'This manager approval is bound to different operation content.');
  END IF;
  IF v_approval.approved_by = p_actor_staff_id THEN
    PERFORM bar_local.raise_business('MAKER_CHECKER_VIOLATION', 'The same operator cannot make and approve this action.');
  END IF;
  UPDATE bar_local.approvals SET consumed_at = now() WHERE id = p_approval_id;
  RETURN p_approval_id;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.expected_shift_cash(p_shift_id uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT s.opening_float
      + COALESCE((SELECT sum(st.amount) FROM bar_local.sale_tenders st
                    JOIN bar_local.sales sa ON sa.id = st.sale_id
                   WHERE sa.shift_id = p_shift_id AND st.method = 'cash' AND sa.status IN ('completed','returned')), 0)
      + COALESCE((SELECT sum(cm.amount) FROM bar_local.cash_movements cm
                   WHERE cm.shift_id = p_shift_id AND cm.type IN ('paid_in','float','handover')), 0)
      - COALESCE((SELECT sum(cm.amount) FROM bar_local.cash_movements cm
                   WHERE cm.shift_id = p_shift_id AND cm.type IN ('paid_out','tip_payout')), 0)
      FROM bar_local.shifts s WHERE s.id = p_shift_id
  ), 0)::numeric(14,2);
$$;

CREATE OR REPLACE FUNCTION bar_local.audit_row(
  p_business_id uuid, p_outlet_id uuid, p_actor uuid, p_device uuid,
  p_action text, p_operation uuid, p_before jsonb, p_after jsonb
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO bar_local.audit_log (business_id, outlet_id, actor_staff_id, device_id, action, operation_id, before, after)
  VALUES (p_business_id, p_outlet_id, p_actor, p_device, p_action, p_operation, p_before, p_after);
$$;
