-- Bind owner projection uploads to the outlet that authorized the connection.
-- Other outlets retain their outbox rows and are never repeatedly offered to a
-- receiver that was approved for a different outlet.
ALTER TABLE bar_local.cloud_sync_config
  ADD COLUMN IF NOT EXISTS linked_outlet_id uuid REFERENCES bar_local.outlets(id);
CREATE OR REPLACE FUNCTION bar_local.cloud_sync_worker_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_authority bar_local.authority%ROWTYPE;
  v_config bar_local.cloud_sync_config%ROWTYPE;
BEGIN
  SELECT * INTO v_authority FROM bar_local.authority WHERE singleton;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('configured', false, 'enabled', false, 'reason', 'authority_not_commissioned');
  END IF;
  SELECT * INTO v_config FROM bar_local.cloud_sync_config WHERE singleton;
  IF NOT FOUND OR v_config.business_id IS NULL THEN
    RETURN jsonb_build_object('configured', false, 'enabled', false, 'reason', 'cloud_sync_not_configured');
  END IF;
  IF v_config.linked_outlet_id IS NULL THEN
    RETURN jsonb_build_object('configured', false, 'enabled', false, 'business_id', v_config.business_id, 'reason', 'cloud_sync_outlet_not_bound');
  END IF;
  RETURN jsonb_build_object(
    'configured', true,
    'enabled', v_config.enabled,
    'business_id', v_config.business_id,
    'outlet_id', v_config.linked_outlet_id,
    'authority_id', v_authority.authority_id,
    'authority_epoch', v_authority.authority_epoch,
    'receiver_url', v_config.receiver_url,
    'schedule_mode', v_config.schedule_mode,
    'daily_at', to_char(v_config.daily_at, 'HH24:MI'),
    'batch_limit', v_config.batch_limit,
    'signing_key_id', v_config.signing_key_id
  );
END;
$$;

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
     AND o.outlet_id = v_config.linked_outlet_id
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

CREATE OR REPLACE FUNCTION bar_local.cloud_sync_config_set(
  p_token_hash text,
  p_device_id uuid,
  p_config jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_existing bar_local.cloud_sync_config%ROWTYPE;
  v_enabled boolean;
  v_receiver text;
  v_schedule text;
  v_daily time;
  v_limit integer;
  v_key_id text;
  v_business uuid;
BEGIN
  v_ctx := bar_local.service_session(p_token_hash, p_device_id);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'settings.manage');
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The cloud synchronisation configuration must be a JSON object.');
  END IF;
  SELECT * INTO v_business FROM bar_local.business WHERE id = v_ctx.business_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('TENANT_SCOPE_MISMATCH', 'The authenticated business does not exist.');
  END IF;
  SELECT * INTO v_existing FROM bar_local.cloud_sync_config WHERE singleton FOR UPDATE;
  -- Reject wrong JSON types before casting so a malformed body cannot surface as
  -- a raw PostgreSQL cast error instead of an actionable validation message.
  IF p_config ? 'enabled' AND jsonb_typeof(p_config->'enabled') <> 'boolean' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'enabled must be true or false.');
  END IF;
  IF p_config ? 'batch_limit'
     AND (jsonb_typeof(p_config->'batch_limit') NOT IN ('number', 'string')
          OR (p_config->>'batch_limit') !~ '^[0-9]{1,4}$') THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'batch_limit must be a whole number between 1 and 1000.');
  END IF;
  -- Omitted keys keep their committed value. Only an explicit null or empty
  -- string clears a nullable field, so an operator cannot silently drop a
  -- receiver address or signing key by saving a partial form.
  v_enabled := COALESCE((p_config->>'enabled')::boolean, v_existing.enabled, false);
  v_receiver := CASE
    WHEN p_config ? 'receiver_url' THEN NULLIF(btrim(COALESCE(p_config->>'receiver_url', '')), '')
    ELSE v_existing.receiver_url
  END;
  v_schedule := COALESCE(NULLIF(p_config->>'schedule_mode', ''), v_existing.schedule_mode, 'fifteen_minutes');
  v_limit := COALESCE((p_config->>'batch_limit')::integer, v_existing.batch_limit, 200);
  v_key_id := CASE
    WHEN p_config ? 'signing_key_id' THEN NULLIF(btrim(COALESCE(p_config->>'signing_key_id', '')), '')
    ELSE v_existing.signing_key_id
  END;
  IF v_schedule NOT IN ('fifteen_minutes', 'daily') THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'schedule_mode must be fifteen_minutes or daily.');
  END IF;
  IF v_limit IS NULL OR v_limit < 1 OR v_limit > 1000 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'batch_limit must be a whole number between 1 and 1000.');
  END IF;
  BEGIN
    IF p_config ? 'daily_at' THEN
      v_daily := COALESCE(NULLIF(p_config->>'daily_at', '')::time, '23:30'::time);
    ELSE
      v_daily := COALESCE(v_existing.daily_at, '23:30'::time);
    END IF;
  EXCEPTION WHEN others THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'daily_at must be a 24-hour time such as 23:30.');
  END;
  IF v_enabled AND v_receiver IS NULL THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A receiver URL is required before cloud synchronisation can be enabled.');
  END IF;
  IF v_enabled AND v_key_id IS NULL THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A signing key identifier is required before cloud synchronisation can be enabled.');
  END IF;
  IF v_enabled AND v_existing.business_id = v_ctx.business_id
     AND v_existing.linked_outlet_id IS NOT NULL
     AND v_existing.linked_outlet_id <> v_ctx.outlet_id THEN
    PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'Cloud owner sync is bound to a different outlet. Reconnect through the outlet that owns this receiver approval.');
  END IF;

  UPDATE bar_local.cloud_sync_config
     SET enabled = v_enabled,
         business_id = v_ctx.business_id,
         linked_outlet_id = CASE
           WHEN v_existing.business_id IS DISTINCT FROM v_ctx.business_id OR v_existing.linked_outlet_id IS NULL THEN v_ctx.outlet_id
           ELSE v_existing.linked_outlet_id
         END,
         receiver_url = v_receiver,
         schedule_mode = v_schedule,
         daily_at = v_daily,
         batch_limit = v_limit,
         signing_key_id = v_key_id,
         updated_at = now(),
         updated_by = v_ctx.staff_id
   WHERE singleton;

  PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
    'cloud_sync.config.updated', NULL, NULL,
    jsonb_build_object('enabled', v_enabled, 'receiver_url', v_receiver,
      'schedule_mode', v_schedule, 'daily_at', to_char(v_daily, 'HH24:MI'),
       'batch_limit', v_limit, 'signing_key_id', v_key_id,
       'outlet_id', CASE WHEN v_existing.business_id IS DISTINCT FROM v_ctx.business_id OR v_existing.linked_outlet_id IS NULL THEN v_ctx.outlet_id ELSE v_existing.linked_outlet_id END));
  RETURN bar_local.cloud_sync_status();
END;
$$;
