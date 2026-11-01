-- Serialize concurrent claims of the same operation identifier before touching
-- the operations row. Concurrent speculative inserts otherwise deadlock across
-- the primary key and operations_scope_key unique indexes.

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
  PERFORM pg_advisory_xact_lock(hashtextextended(v_operation_id::text, 0));
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
  IF v_existing.command <> v_command THEN
    PERFORM bar_local.raise_business('IDEMPOTENCY_PAYLOAD_CONFLICT', 'This operation identifier was already used for a different command. Keep the original operation and do not create a new key.');
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
