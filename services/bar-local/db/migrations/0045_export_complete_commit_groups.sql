-- Local Bar only. Export pagination selects complete commit-sequence groups.
CREATE OR REPLACE FUNCTION bar_local.cmd_export_bundle_create(
  p_token_hash text,
  p_device_id uuid,
  p_envelope jsonb,
  p_payload_hash text,
  p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := COALESCE(p_envelope->'payload', '{}'::jsonb);
  v_limit integer;
  v_batch_id uuid := gen_random_uuid();
  v_created_ts timestamptz := now();
  v_events jsonb;
  v_from_seq bigint;
  v_to_seq bigint;
  v_count integer;
  v_manifest jsonb;
  v_manifest_hash text;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'export.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF jsonb_typeof(v_payload) <> 'object' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The export command payload must be a JSON object.');
    END IF;
    IF v_payload ? 'limit' AND (v_payload->>'limit') !~ '^[0-9]{1,4}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The export limit must be a whole number between 1 and 1000.');
    END IF;
    v_limit := LEAST(GREATEST(COALESCE(NULLIF(v_payload->>'limit', '')::integer, 200), 1), 1000);
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_payload) AS k(key)
                WHERE k.key IN ('signature', 'signing_key', 'private_key', 'signature_key_id')) THEN
      PERFORM bar_local.raise_business('EXPORT_DISABLED', 'Local export signing is not available in this release. The bundle is recorded unsigned and cloud transport is disabled.');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('bar_local.export_bundle', 0));

    -- Select complete transaction groups. The limit bounds commit groups, not event rows.
    WITH page_groups AS (
      SELECT o.commit_sequence
        FROM bar_local.outbox o
       WHERE o.business_id = v_ctx.business_id
         AND o.outlet_id = v_ctx.outlet_id
         AND o.export_batch_id IS NULL
         AND o.commit_sequence < v_seq.commit_sequence
       GROUP BY o.commit_sequence
       ORDER BY o.commit_sequence
       LIMIT v_limit
    ), picked AS (
      SELECT o.*
        FROM bar_local.outbox o
        JOIN page_groups g USING (commit_sequence)
       WHERE o.business_id = v_ctx.business_id
         AND o.outlet_id = v_ctx.outlet_id
         AND o.export_batch_id IS NULL
         AND o.commit_sequence < v_seq.commit_sequence
       ORDER BY o.commit_sequence, o.event_index
       FOR UPDATE OF o
    ), updated AS (
      UPDATE bar_local.outbox o
         SET export_batch_id = v_batch_id
        FROM picked p
       WHERE o.commit_sequence = p.commit_sequence
         AND o.event_index = p.event_index
      RETURNING o.commit_sequence, o.event_index, o.event_id, o.event_type, o.operation_id,
                o.authority_epoch, o.payload, o.payload_hash, o.created_at
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'event_id', u.event_id,
             'commit_sequence', u.commit_sequence,
             'event_index', u.event_index,
             'event_type', u.event_type,
             'operation_id', u.operation_id,
             'authority_epoch', u.authority_epoch,
             'payload', u.payload,
             'payload_hash', u.payload_hash,
             'created_at', to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
           ) ORDER BY u.commit_sequence, u.event_index), '[]'::jsonb),
           min(u.commit_sequence), max(u.commit_sequence), count(*)::integer
      INTO v_events, v_from_seq, v_to_seq, v_count
      FROM updated u;

    IF v_count = 0 THEN
      v_result := jsonb_build_object(
        'batch_id', NULL,
        'event_count', 0,
        'checkpoint', v_seq.commit_sequence,
        'status', 'no_pending_events',
        'signature_status', 'unavailable',
        'transport_status', 'integration_disabled'
      );
      v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
        v_result, v_result, '[]'::jsonb, bar_local.current_business_date());
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
    END IF;

    v_manifest := jsonb_build_object(
      'schema', 'bar-local-export-bundle',
      'schema_version', 1,
      'batch_id', v_batch_id,
      'authority_id', (p_envelope->>'authority_id')::uuid,
      'authority_epoch', (p_envelope->>'authority_epoch')::bigint,
      'business_id', v_ctx.business_id,
      'outlet_id', v_ctx.outlet_id,
      'from_sequence', v_from_seq,
      'to_sequence', v_to_seq,
      'checkpoint', v_to_seq,
      'event_count', v_count,
      'created_at', to_char(v_created_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'events', v_events
    );
    v_manifest_hash := bar_local.sha256_hex(bar_local.canonical_jsonb_text(v_manifest));

    INSERT INTO bar_local.export_batches
      (batch_id, from_sequence, to_sequence, event_count, manifest_hash, signature, key_id,
       file_name, status, checkpoint, payload_hash, signature_key_id, signature_status,
       signature_algorithm, signed_at, transport_status, manifest, business_id, outlet_id,
       authority_id, authority_epoch, created_by, created_at, updated_at)
    VALUES
      (v_batch_id, v_from_seq, v_to_seq, v_count, v_manifest_hash, NULL, NULL,
       'bar-export-' || v_batch_id::text || '.json', 'integration_disabled', v_to_seq,
       v_manifest_hash, NULL, 'unavailable', NULL, NULL, 'integration_disabled', v_manifest,
       v_ctx.business_id, v_ctx.outlet_id, (p_envelope->>'authority_id')::uuid,
       (p_envelope->>'authority_epoch')::bigint, v_ctx.staff_id, v_created_ts, v_created_ts);

    INSERT INTO bar_local.export_batch_items (batch_id, commit_sequence, event_index, event_id, payload_hash)
    SELECT v_batch_id, o.commit_sequence, o.event_index, o.event_id, o.payload_hash
      FROM bar_local.outbox o
     WHERE o.export_batch_id = v_batch_id
     ORDER BY o.commit_sequence, o.event_index;

    v_result := jsonb_build_object(
      'batch_id', v_batch_id,
      'event_count', v_count,
      'from_sequence', v_from_seq,
      'to_sequence', v_to_seq,
      'checkpoint', v_to_seq,
      'manifest_hash', v_manifest_hash,
      'status', 'integration_disabled',
      'signature_status', 'unavailable',
      'transport_status', 'integration_disabled'
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'export.bundle.created', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, '[]'::jsonb, bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.cmd_export_bundle_create(text, uuid, jsonb, text, text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.cmd_export_bundle_create(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_export_bundle_create(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_export_bundle_create(text, uuid, jsonb, text, text) FROM PUBLIC, bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_export_bundle_create(text, uuid, jsonb, text, text) TO bar_local_runtime;
