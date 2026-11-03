-- Include the authoritative operation business date in cloud-only export envelopes.
-- It is covered by the signed manifest and does not alter the hashed event payload.
CREATE OR REPLACE FUNCTION bar_local.cloud_sync_take_batch(p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_authority bar_local.authority%ROWTYPE;
  v_config bar_local.cloud_sync_config%ROWTYPE;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  v_outlet uuid;
  v_batch_id uuid := gen_random_uuid();
  v_created_ts timestamptz := clock_timestamp();
  v_events jsonb;
  v_from bigint;
  v_to bigint;
  v_count integer;
  v_manifest jsonb;
  v_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bar_local.cloud_sync.take', 0));
  SELECT * INTO v_authority FROM bar_local.authority WHERE singleton;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTHORITY_NOT_COMMISSIONED', 'The local Bar authority has not been commissioned.');
  END IF;
  SELECT * INTO v_config FROM bar_local.cloud_sync_config WHERE singleton;
  IF NOT FOUND OR v_config.business_id IS NULL THEN
    PERFORM bar_local.raise_business('CLOUD_SYNC_NOT_CONFIGURED', 'Cloud synchronisation has not been configured on this local authority.');
  END IF;
  IF NOT v_config.enabled THEN
    PERFORM bar_local.raise_business('CLOUD_SYNC_DISABLED', 'Cloud synchronisation is disabled on this local authority.');
  END IF;

  SELECT o.outlet_id INTO v_outlet
    FROM bar_local.outbox o
   WHERE o.business_id = v_config.business_id
     AND o.export_batch_id IS NULL
   ORDER BY o.commit_sequence, o.event_index
   LIMIT 1;
  IF v_outlet IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'no_pending_events',
      'batch_id', NULL,
      'event_count', 0,
      'pending_events', 0
    );
  END IF;

  WITH group_sizes AS (
    SELECT o.commit_sequence, count(*)::bigint AS group_events
      FROM bar_local.outbox o
     WHERE o.business_id = v_config.business_id
       AND o.outlet_id = v_outlet
       AND o.export_batch_id IS NULL
     GROUP BY o.commit_sequence
  ), page_groups AS (
    SELECT commit_sequence
      FROM (
        SELECT commit_sequence,
               COALESCE(sum(group_events) OVER (
                 ORDER BY commit_sequence
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ), 0) AS events_before
          FROM group_sizes
      ) sized
     WHERE events_before < v_limit
  ), picked AS (
    SELECT o.*
      FROM bar_local.outbox o
      JOIN page_groups g USING (commit_sequence)
     WHERE o.business_id = v_config.business_id
       AND o.outlet_id = v_outlet
       AND o.export_batch_id IS NULL
     ORDER BY o.commit_sequence, o.event_index
     FOR UPDATE
  ), updated AS (
    UPDATE bar_local.outbox o
       SET export_batch_id = v_batch_id
      FROM picked p
     WHERE o.commit_sequence = p.commit_sequence
       AND o.event_index = p.event_index
    RETURNING o.commit_sequence, o.event_index, o.event_id, o.event_type, o.operation_id,
              o.authority_epoch, o.payload, o.payload_hash, o.created_at,
              (SELECT op.business_date FROM bar_local.operations op WHERE op.operation_id = o.operation_id) AS business_date
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
           'business_date', u.business_date,
           'created_at', to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         ) ORDER BY u.commit_sequence, u.event_index), '[]'::jsonb),
         min(u.commit_sequence), max(u.commit_sequence), count(*)::integer
    INTO v_events, v_from, v_to, v_count
    FROM updated u;

  IF v_count = 0 THEN
    RETURN jsonb_build_object(
      'status', 'no_pending_events',
      'batch_id', NULL,
      'event_count', 0,
      'pending_events', 0
    );
  END IF;

  v_manifest := jsonb_build_object(
    'schema', 'bar-local-export-bundle',
    'schema_version', 1,
    'batch_id', v_batch_id,
    'authority_id', v_authority.authority_id,
    'authority_epoch', v_authority.authority_epoch,
    'business_id', v_config.business_id,
    'outlet_id', v_outlet,
    'from_sequence', v_from,
    'to_sequence', v_to,
    'checkpoint', v_to,
    'event_count', v_count,
    'created_at', to_char(v_created_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'events', v_events
  );
  v_hash := bar_local.sha256_hex(bar_local.canonical_jsonb_text(v_manifest));

  INSERT INTO bar_local.export_batches
    (batch_id, from_sequence, to_sequence, event_count, manifest_hash, signature, key_id,
     file_name, status, checkpoint, payload_hash, signature_key_id, signature_status,
     signature_algorithm, signed_at, transport_status, manifest, business_id, outlet_id,
     authority_id, authority_epoch, created_by, created_at, updated_at)
  VALUES
    (v_batch_id, v_from, v_to, v_count, v_hash, NULL, NULL,
     'bar-export-' || v_batch_id::text || '.json', 'ready', v_to,
     v_hash, v_config.signing_key_id, 'unavailable', NULL, NULL, 'prepared', v_manifest,
     v_config.business_id, v_outlet, v_authority.authority_id, v_authority.authority_epoch,
     NULL, v_created_ts, v_created_ts);

  INSERT INTO bar_local.export_batch_items (batch_id, commit_sequence, event_index, event_id, payload_hash)
  SELECT v_batch_id, o.commit_sequence, o.event_index, o.event_id, o.payload_hash
    FROM bar_local.outbox o
   WHERE o.export_batch_id = v_batch_id
   ORDER BY o.commit_sequence, o.event_index;

  RETURN jsonb_build_object(
    'status', 'batch_created',
    'batch_id', v_batch_id,
    'event_count', v_count,
    'from_sequence', v_from,
    'to_sequence', v_to,
    'manifest_hash', v_hash,
    'manifest', v_manifest,
    -- The raw canonical text is the transport source of truth. Re-encoding a
    -- jsonb-derived JavaScript object can change numeric scale (12.50 -> 12.5)
    -- and would no longer hash to the manifest hash the receiver verifies.
    'manifest_text', bar_local.canonical_jsonb_text(v_manifest),
    'pending_events', (
      SELECT count(*) FROM bar_local.outbox o
       WHERE o.business_id = v_config.business_id AND o.export_batch_id IS NULL
    )
  );
END;
$$;
