-- Server-only durable cloud synchronisation bookkeeping.
--
-- This migration does NOT send anything to a hosted service. It adds the
-- durable local queue, checkpoints, receipts and honest status that a single
-- designated server uploader uses. Transport activation remains disabled in
-- the service configuration until it is explicitly authorised.
--
-- Invariants:
--   * A batch is created from committed outbox rows only, one outlet at a
--     time, in commit order, and is limited to a bounded event count.
--   * Creating a batch is not an acknowledgement. `ready`/`prepared` only
--     means "durably reserved for upload".
--   * An acknowledgement is recorded against the exact manifest hash. The
--     same batch with a changed hash is a conflict, never an overwrite.
--   * Only a final `ingested` acknowledgement advances the acknowledged
--     watermark. `received` and `validated` are recorded but leave the work
--     pending.
--   * Local export is never reported as cloud acceptance.

CREATE TABLE IF NOT EXISTS bar_local.cloud_sync_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  business_id uuid REFERENCES bar_local.business(id),
  receiver_url text,
  schedule_mode text NOT NULL DEFAULT 'fifteen_minutes'
    CHECK (schedule_mode IN ('fifteen_minutes', 'daily')),
  daily_at time NOT NULL DEFAULT '23:30',
  batch_limit integer NOT NULL DEFAULT 200 CHECK (batch_limit BETWEEN 1 AND 1000),
  signing_key_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES bar_local.staff(id)
);

INSERT INTO bar_local.cloud_sync_config (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS bar_local.cloud_sync_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_check_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_final_sync_at timestamptz,
  last_final_sync_state text
    CHECK (last_final_sync_state IS NULL OR last_final_sync_state IN ('ingested', 'pending', 'failed', 'disabled', 'not_primary')),
  next_due_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO bar_local.cloud_sync_state (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

-- Per-batch acknowledgement history. A batch can progress received ->
-- validated -> ingested; replaying a state with the same hash/reference is
-- idempotent, and any changed hash is rejected.
CREATE TABLE IF NOT EXISTS bar_local.cloud_sync_receipts (
  batch_id uuid NOT NULL REFERENCES bar_local.export_batches(batch_id) ON DELETE CASCADE,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  receiver_state text NOT NULL CHECK (receiver_state IN ('received', 'validated', 'ingested')),
  receiver_reference text,
  received_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, receiver_state)
);

ALTER TABLE bar_local.export_batches
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS receiver_reference text,
  ADD COLUMN IF NOT EXISTS receiver_received_at timestamptz;

CREATE INDEX IF NOT EXISTS export_batches_pending_idx
  ON bar_local.export_batches (status, to_sequence)
  WHERE status = 'ready';

REVOKE ALL ON TABLE bar_local.cloud_sync_config FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON TABLE bar_local.cloud_sync_state FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON TABLE bar_local.cloud_sync_receipts FROM PUBLIC, bar_local_runtime;

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
  RETURN jsonb_build_object(
    'configured', true,
    'enabled', v_config.enabled,
    'business_id', v_config.business_id,
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

-- Atomically reserve the oldest pending outlet's committed events as one
-- bounded batch. Returns the manifest without any acknowledgement semantics.
-- The event limit is a target, not a hard cap: a batch always carries complete
-- commit-sequence groups (matching `cmd_export_bundle_create`) so one financial
-- commit is never split across two uploads. A single group larger than the
-- limit is uploaded intact.
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

-- Read the oldest unacknowledged prepared batch. Batches produced by the
-- local export command (`integration_disabled`) are eligible too: a local
-- export is not a cloud acknowledgement, so its committed events still need
-- to be uploaded. The raw canonical manifest text is returned for exact
-- transport because JavaScript re-encoding can alter numeric scale.
CREATE OR REPLACE FUNCTION bar_local.cloud_sync_next_batch()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_config bar_local.cloud_sync_config%ROWTYPE;
  v_batch bar_local.export_batches%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('bar_local.cloud_sync.take', 0));
  SELECT * INTO v_config FROM bar_local.cloud_sync_config WHERE singleton;
  IF NOT FOUND OR v_config.business_id IS NULL THEN
    PERFORM bar_local.raise_business('CLOUD_SYNC_NOT_CONFIGURED', 'Cloud synchronisation has not been configured on this local authority.');
  END IF;
  IF NOT v_config.enabled THEN
    PERFORM bar_local.raise_business('CLOUD_SYNC_DISABLED', 'Cloud synchronisation is disabled on this local authority.');
  END IF;

  SELECT * INTO v_batch
    FROM bar_local.export_batches b
   WHERE b.business_id = v_config.business_id
     AND b.acknowledged_at IS NULL
     AND b.status IN ('ready', 'integration_disabled')
     AND b.manifest_hash IS NOT NULL
     AND b.manifest ? 'schema'
   ORDER BY b.from_sequence, b.created_at, b.batch_id
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_pending_batch', 'batch_id', NULL);
  END IF;

  RETURN jsonb_build_object(
    'status', 'batch_pending',
    'batch_id', v_batch.batch_id,
    'business_id', v_batch.business_id,
    'outlet_id', v_batch.outlet_id,
    'authority_id', v_batch.authority_id,
    'authority_epoch', v_batch.authority_epoch,
    'from_sequence', v_batch.from_sequence,
    'to_sequence', v_batch.to_sequence,
    'event_count', v_batch.event_count,
    'manifest_hash', v_batch.manifest_hash,
    'manifest', v_batch.manifest,
    'manifest_text', bar_local.canonical_jsonb_text(v_batch.manifest),
    'attempts', v_batch.attempts,
    'status_detail', v_batch.status,
    'transport_status', v_batch.transport_status,
    'last_error', v_batch.last_error
  );
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cloud_sync_mark_signed(
  p_batch_id uuid,
  p_signature text,
  p_key_id text,
  p_algorithm text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_batch bar_local.export_batches%ROWTYPE;
BEGIN
  SELECT * INTO v_batch FROM bar_local.export_batches WHERE batch_id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('EXPORT_BATCH_NOT_FOUND', 'The export batch no longer exists.');
  END IF;
  IF v_batch.status = 'acknowledged' THEN
    RETURN jsonb_build_object('ok', true, 'status', v_batch.status, 'replayed', true);
  END IF;
  IF p_signature IS NULL OR length(p_signature) < 16 THEN
    PERFORM bar_local.raise_business('EXPORT_SIGNATURE_INVALID', 'A usable upload signature is required.');
  END IF;
  UPDATE bar_local.export_batches
     SET signature = p_signature,
         signature_key_id = p_key_id,
         signature_algorithm = p_algorithm,
         signature_status = 'signed',
         signed_at = now(),
         transport_status = 'signed',
         updated_at = now()
   WHERE batch_id = p_batch_id;
  RETURN jsonb_build_object('ok', true, 'status', 'signed');
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cloud_sync_mark_uploading(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_batch bar_local.export_batches%ROWTYPE;
BEGIN
  SELECT * INTO v_batch FROM bar_local.export_batches WHERE batch_id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('EXPORT_BATCH_NOT_FOUND', 'The export batch no longer exists.');
  END IF;
  IF v_batch.status = 'acknowledged' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'acknowledged', 'replayed', true);
  END IF;
  UPDATE bar_local.export_batches
     SET transport_status = 'uploading',
         attempts = attempts + 1,
         last_attempt_at = now(),
         last_error = NULL,
         updated_at = now()
   WHERE batch_id = p_batch_id;
  RETURN jsonb_build_object('ok', true, 'status', 'uploading', 'attempts', v_batch.attempts + 1);
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cloud_sync_mark_failure(p_batch_id uuid, p_code text, p_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_batch bar_local.export_batches%ROWTYPE;
BEGIN
  SELECT * INTO v_batch FROM bar_local.export_batches WHERE batch_id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('EXPORT_BATCH_NOT_FOUND', 'The export batch no longer exists.');
  END IF;
  IF v_batch.status = 'acknowledged' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'acknowledged', 'replayed', true);
  END IF;
  UPDATE bar_local.export_batches
     SET transport_status = 'transport_error',
         last_error = left(COALESCE(p_code, 'UPLOAD_FAILED') || ': ' || COALESCE(p_message, 'The receiver did not acknowledge this batch.'), 2000),
         updated_at = now()
   WHERE batch_id = p_batch_id;
  RETURN jsonb_build_object('ok', true, 'status', 'transport_error');
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cloud_sync_acknowledge(
  p_batch_id uuid,
  p_manifest_hash text,
  p_receiver_state text,
  p_receiver_reference text,
  p_received_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_batch bar_local.export_batches%ROWTYPE;
  v_existing bar_local.cloud_sync_receipts%ROWTYPE;
  v_received timestamptz := COALESCE(p_received_at, now());
BEGIN
  IF p_receiver_state NOT IN ('received', 'validated', 'ingested') THEN
    PERFORM bar_local.raise_business('EXPORT_ACK_INVALID', 'The receiver acknowledgement state is not recognised.');
  END IF;
  IF p_manifest_hash IS NULL OR p_manifest_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM bar_local.raise_business('EXPORT_ACK_INVALID', 'The receiver acknowledgement did not include a valid manifest hash.');
  END IF;
  SELECT * INTO v_batch FROM bar_local.export_batches WHERE batch_id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('EXPORT_BATCH_NOT_FOUND', 'The export batch no longer exists.');
  END IF;
  IF v_batch.manifest_hash <> p_manifest_hash THEN
    PERFORM bar_local.raise_business('EXPORT_ACK_HASH_MISMATCH', 'The receiver acknowledged a different manifest payload. Keep the original batch and review the conflict.');
  END IF;

  SELECT * INTO v_existing FROM bar_local.cloud_sync_receipts
   WHERE batch_id = p_batch_id AND receiver_state = p_receiver_state
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.manifest_hash <> p_manifest_hash
       OR COALESCE(v_existing.receiver_reference, '') <> COALESCE(p_receiver_reference, '') THEN
      PERFORM bar_local.raise_business('EXPORT_ACK_CONFLICT', 'This batch was already acknowledged with different receiver evidence.');
    END IF;
  ELSE
    INSERT INTO bar_local.cloud_sync_receipts
      (batch_id, manifest_hash, receiver_state, receiver_reference, received_at)
    VALUES (p_batch_id, p_manifest_hash, p_receiver_state, p_receiver_reference, v_received);
  END IF;

  IF p_receiver_state = 'ingested' THEN
    UPDATE bar_local.export_batches
       SET status = 'acknowledged',
           acknowledged_at = v_received,
           acknowledged_by = 'cloud_receiver',
           receiver_reference = p_receiver_reference,
           receiver_received_at = v_received,
           transport_status = 'ingested',
           last_error = NULL,
           updated_at = now()
     WHERE batch_id = p_batch_id;
  ELSE
    UPDATE bar_local.export_batches
       SET transport_status = p_receiver_state,
           receiver_reference = p_receiver_reference,
           receiver_received_at = v_received,
           updated_at = now()
     WHERE batch_id = p_batch_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'receiver_state', p_receiver_state,
    'acknowledged', p_receiver_state = 'ingested',
    'acknowledged_watermark', (
      SELECT max(to_sequence) FROM bar_local.export_batches
       WHERE status = 'acknowledged' AND business_id = v_batch.business_id
    ),
    'pending_events', (
      SELECT count(*) FROM bar_local.outbox o
       WHERE o.business_id = v_batch.business_id AND o.export_batch_id IS NULL
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cloud_sync_record_run(
  p_success boolean,
  p_final boolean,
  p_state text,
  p_error_code text,
  p_error_message text,
  p_next_due_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
BEGIN
  UPDATE bar_local.cloud_sync_state
     SET last_check_at = now(),
         last_success_at = CASE WHEN p_success THEN now() ELSE last_success_at END,
         last_error_code = CASE WHEN p_success THEN NULL ELSE left(p_error_code, 120) END,
         last_error_message = CASE WHEN p_success THEN NULL ELSE left(p_error_message, 1000) END,
         last_final_sync_at = CASE WHEN p_final THEN now() ELSE last_final_sync_at END,
         last_final_sync_state = CASE WHEN p_final THEN p_state ELSE last_final_sync_state END,
         next_due_at = p_next_due_at,
         updated_at = now()
   WHERE singleton;
  RETURN bar_local.cloud_sync_status();
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cloud_sync_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_config bar_local.cloud_sync_config%ROWTYPE;
  v_state bar_local.cloud_sync_state%ROWTYPE;
  v_business uuid;
BEGIN
  SELECT * INTO v_config FROM bar_local.cloud_sync_config WHERE singleton;
  SELECT * INTO v_state FROM bar_local.cloud_sync_state WHERE singleton;
  v_business := v_config.business_id;
  RETURN jsonb_build_object(
    'configured', v_business IS NOT NULL,
    'enabled', COALESCE(v_config.enabled, false),
    'business_id', v_business,
    'receiver_url', v_config.receiver_url,
    'schedule_mode', v_config.schedule_mode,
    'daily_at', CASE WHEN v_config.daily_at IS NULL THEN NULL ELSE to_char(v_config.daily_at, 'HH24:MI') END,
    'batch_limit', v_config.batch_limit,
    'signing_key_id', v_config.signing_key_id,
    'pending_events', CASE WHEN v_business IS NULL THEN 0 ELSE (
      SELECT count(*) FROM bar_local.outbox o
        LEFT JOIN bar_local.export_batches b ON b.batch_id = o.export_batch_id
       WHERE o.business_id = v_business
         AND (o.export_batch_id IS NULL OR b.acknowledged_at IS NULL)
    ) END,
    'unbatched_events', CASE WHEN v_business IS NULL THEN 0 ELSE (
      SELECT count(*) FROM bar_local.outbox o
       WHERE o.business_id = v_business AND o.export_batch_id IS NULL
    ) END,
    'prepared_batches', CASE WHEN v_business IS NULL THEN 0 ELSE (
      SELECT count(*) FROM bar_local.export_batches b
       WHERE b.business_id = v_business AND b.acknowledged_at IS NULL
         AND b.status IN ('ready', 'integration_disabled')
    ) END,
    'acknowledged_batches', CASE WHEN v_business IS NULL THEN 0 ELSE (
      SELECT count(*) FROM bar_local.export_batches b
       WHERE b.business_id = v_business AND b.status = 'acknowledged'
    ) END,
    'failed_batches', CASE WHEN v_business IS NULL THEN 0 ELSE (
      SELECT count(*) FROM bar_local.export_batches b
       WHERE b.business_id = v_business
         AND (b.status = 'failed' OR b.transport_status = 'transport_error')
    ) END,
    'oldest_pending_sequence', CASE WHEN v_business IS NULL THEN NULL ELSE (
      SELECT min(o.commit_sequence) FROM bar_local.outbox o
        LEFT JOIN bar_local.export_batches b ON b.batch_id = o.export_batch_id
       WHERE o.business_id = v_business
         AND (o.export_batch_id IS NULL OR b.acknowledged_at IS NULL)
    ) END,
    'oldest_pending_at', CASE WHEN v_business IS NULL THEN NULL ELSE (
      SELECT min(o.created_at) FROM bar_local.outbox o
        LEFT JOIN bar_local.export_batches b ON b.batch_id = o.export_batch_id
       WHERE o.business_id = v_business
         AND (o.export_batch_id IS NULL OR b.acknowledged_at IS NULL)
    ) END,
    'acknowledged_watermark', CASE WHEN v_business IS NULL THEN NULL ELSE (
      SELECT max(b.to_sequence) FROM bar_local.export_batches b
       WHERE b.business_id = v_business AND b.status = 'acknowledged'
    ) END,
    'last_check_at', v_state.last_check_at,
    'last_success_at', v_state.last_success_at,
    'last_error_code', v_state.last_error_code,
    'last_error_message', v_state.last_error_message,
    'last_final_sync_at', v_state.last_final_sync_at,
    'last_final_sync_state', v_state.last_final_sync_state,
    'next_due_at', v_state.next_due_at,
    'latest_batch', CASE WHEN v_business IS NULL THEN NULL ELSE (
      SELECT to_jsonb(x) FROM (
        SELECT b.batch_id, b.status, b.transport_status, b.event_count, b.from_sequence,
               b.to_sequence, b.attempts, b.last_error, b.created_at, b.updated_at,
               b.acknowledged_at, b.receiver_reference
          FROM bar_local.export_batches b
         WHERE b.business_id = v_business
         ORDER BY b.created_at DESC
         LIMIT 1
      ) x
    ) END
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
  SELECT * INTO v_existing FROM bar_local.cloud_sync_config WHERE singleton;
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

  UPDATE bar_local.cloud_sync_config
     SET enabled = v_enabled,
         business_id = v_ctx.business_id,
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
      'batch_limit', v_limit, 'signing_key_id', v_key_id));
  RETURN bar_local.cloud_sync_status();
END;
$$;

ALTER FUNCTION bar_local.cloud_sync_worker_config() SECURITY DEFINER;
ALTER FUNCTION bar_local.cloud_sync_take_batch(integer) SECURITY DEFINER;
ALTER FUNCTION bar_local.cloud_sync_next_batch() SECURITY DEFINER;
ALTER FUNCTION bar_local.cloud_sync_mark_signed(uuid, text, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cloud_sync_mark_uploading(uuid) SECURITY DEFINER;
ALTER FUNCTION bar_local.cloud_sync_mark_failure(uuid, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cloud_sync_acknowledge(uuid, text, text, text, timestamptz) SECURITY DEFINER;
ALTER FUNCTION bar_local.cloud_sync_record_run(boolean, boolean, text, text, text, timestamptz) SECURITY DEFINER;
ALTER FUNCTION bar_local.cloud_sync_status() SECURITY DEFINER;
ALTER FUNCTION bar_local.cloud_sync_config_set(text, uuid, jsonb) SECURITY DEFINER;

REVOKE ALL ON FUNCTION bar_local.cloud_sync_worker_config() FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cloud_sync_take_batch(integer) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cloud_sync_next_batch() FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cloud_sync_mark_signed(uuid, text, text, text) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cloud_sync_mark_uploading(uuid) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cloud_sync_mark_failure(uuid, text, text) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cloud_sync_acknowledge(uuid, text, text, text, timestamptz) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cloud_sync_record_run(boolean, boolean, text, text, text, timestamptz) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cloud_sync_status() FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.cloud_sync_config_set(text, uuid, jsonb) FROM PUBLIC, bar_local_runtime;

GRANT EXECUTE ON FUNCTION bar_local.cloud_sync_worker_config() TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cloud_sync_take_batch(integer) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cloud_sync_next_batch() TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cloud_sync_mark_signed(uuid, text, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cloud_sync_mark_uploading(uuid) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cloud_sync_mark_failure(uuid, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cloud_sync_acknowledge(uuid, text, text, text, timestamptz) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cloud_sync_record_run(boolean, boolean, text, text, text, timestamptz) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cloud_sync_status() TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cloud_sync_config_set(text, uuid, jsonb) TO bar_local_runtime;
