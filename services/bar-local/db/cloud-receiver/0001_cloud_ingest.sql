-- PROPOSED CLOUD RECEIVER CONTRACT — not deployed.
--
-- This schema is the local, disposable-database test target for the future
-- hosted ingestion service. It is intentionally self-contained (its own
-- schema, canonical JSON and hashing) so it does not depend on any local Bar
-- tables. It must not be applied to a hosted Supabase project without the
-- separate architecture/security review and deployment authorisation described
-- in docs/engineering/bar-local-first/FUTURE_CLOUD_CONTRACT.md.
--
-- Receiver rules:
--   * A batch is identified by (authority_id, batch_id). Replaying the same
--     batch with the same manifest hash is idempotent. A changed hash is a
--     conflict.
--   * Receipt (received) never inserts events and never advances a watermark.
--     Validation checks every payload hash and the manifest hash. Ingestion
--     inserts events atomically and advances the watermark only then.
--   * Per-event uniqueness is (authority_id, event_id) and
--     (authority_id, commit_sequence, event_index). A duplicate event with the
--     same payload is ignored; a changed payload is a conflict.
--   * Batches may legitimately arrive out of commit-sequence order because a
--     lower sequence can commit later than a higher one. That is recorded as a
--     late-sequence batch, not silently treated as a gap.

CREATE SCHEMA IF NOT EXISTS cloud_ingest;

CREATE OR REPLACE FUNCTION cloud_ingest.sha256_hex(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_text, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION cloud_ingest.canonical_jsonb_text(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_type text := jsonb_typeof(p_value);
  v_result text;
BEGIN
  IF p_value IS NULL OR v_type = 'null' THEN RETURN 'null'; END IF;
  IF v_type IN ('string', 'number', 'boolean') THEN RETURN p_value::text; END IF;
  IF v_type = 'array' THEN
    SELECT COALESCE(string_agg(cloud_ingest.canonical_jsonb_text(element), ',' ORDER BY ordinality), '')
      INTO v_result
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS items(element, ordinality);
    RETURN '[' || v_result || ']';
  END IF;
  IF v_type = 'object' THEN
    SELECT COALESCE(string_agg(to_jsonb(key)::text || ':' || cloud_ingest.canonical_jsonb_text(value), ',' ORDER BY key COLLATE "C"), '')
      INTO v_result FROM jsonb_each(p_value);
    RETURN '{' || v_result || '}';
  END IF;
  RAISE EXCEPTION 'Unsupported jsonb type %', v_type USING ERRCODE = 'BL001', DETAIL = 'VALIDATION_FAILED';
END;
$$;

CREATE TABLE IF NOT EXISTS cloud_ingest.batch_receipts (
  authority_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  business_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  from_sequence bigint NOT NULL,
  to_sequence bigint NOT NULL,
  event_count integer NOT NULL CHECK (event_count >= 0),
  receiver_state text NOT NULL CHECK (receiver_state IN ('received', 'validated', 'ingested')),
  receiver_reference text NOT NULL,
  manifest jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  ingested_at timestamptz,
  PRIMARY KEY (authority_id, batch_id)
);

CREATE TABLE IF NOT EXISTS cloud_ingest.events (
  authority_id uuid NOT NULL,
  event_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  commit_sequence bigint NOT NULL,
  event_index integer NOT NULL CHECK (event_index >= 0),
  event_type text NOT NULL,
  operation_id uuid NOT NULL,
  authority_epoch bigint NOT NULL,
  business_id uuid NOT NULL,
  outlet_id uuid NOT NULL,
  business_date date NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (authority_id, event_id),
  UNIQUE (authority_id, commit_sequence, event_index)
);

CREATE INDEX IF NOT EXISTS cloud_ingest_events_batch_idx
  ON cloud_ingest.events (authority_id, batch_id);
CREATE INDEX IF NOT EXISTS cloud_ingest_events_sequence_idx
  ON cloud_ingest.events (authority_id, commit_sequence);

CREATE TABLE IF NOT EXISTS cloud_ingest.watermarks (
  authority_id uuid PRIMARY KEY,
  ingested_events bigint NOT NULL DEFAULT 0,
  max_ingested_sequence bigint,
  late_sequence_batches bigint NOT NULL DEFAULT 0,
  last_batch_id uuid,
  last_ingested_at timestamptz
);

ALTER TABLE cloud_ingest.batch_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_ingest.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_ingest.watermarks ENABLE ROW LEVEL SECURITY;

-- Only the ingestion service role (not anon/authenticated) may touch receiver
-- tables. Hosted deployment must wire this to its service identity.
REVOKE ALL ON TABLE cloud_ingest.batch_receipts FROM PUBLIC;
REVOKE ALL ON TABLE cloud_ingest.events FROM PUBLIC;
REVOKE ALL ON TABLE cloud_ingest.watermarks FROM PUBLIC;
REVOKE ALL ON SCHEMA cloud_ingest FROM PUBLIC;

CREATE OR REPLACE FUNCTION cloud_ingest.assert_bundle(p_batch jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_manifest jsonb;
  v_hash text;
  v_event jsonb;
  v_index integer := 0;
  v_previous_key text := '';
  v_key text;
BEGIN
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'object' THEN
    RAISE EXCEPTION 'The receiver payload must be a JSON object.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_INVALID';
  END IF;
  IF p_batch->>'schema' <> 'bar-local-export-bundle' OR COALESCE((p_batch->>'schema_version')::integer, 0) <> 1 THEN
    RAISE EXCEPTION 'Unsupported export schema.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_SCHEMA_UNSUPPORTED';
  END IF;
  v_manifest := p_batch - 'manifest_hash' - 'signature' - 'signature_key_id' - 'signature_algorithm' - 'signature_status' - 'status' - 'transport_status';
  v_hash := cloud_ingest.sha256_hex(cloud_ingest.canonical_jsonb_text(v_manifest));
  IF v_hash <> p_batch->>'manifest_hash' THEN
    RAISE EXCEPTION 'The batch manifest hash does not match its contents.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_MANIFEST_HASH_MISMATCH';
  END IF;
  IF COALESCE((p_batch->>'event_count')::integer, -1) <> jsonb_array_length(p_batch->'events') THEN
    RAISE EXCEPTION 'The batch event_count does not match its events.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_EVENT_COUNT_MISMATCH';
  END IF;
  FOR v_event IN SELECT * FROM jsonb_array_elements(p_batch->'events') LOOP
    -- A batch can legitimately carry events from an earlier authority epoch
    -- after recovery; it must never carry an event from a future epoch.
    IF (v_event->>'authority_epoch')::bigint > (p_batch->>'authority_epoch')::bigint THEN
      RAISE EXCEPTION 'An event belongs to a future authority epoch.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_EVENT_EPOCH_MISMATCH';
    END IF;
    IF (v_event->>'authority_epoch')::bigint < 1 THEN
      RAISE EXCEPTION 'An event has an invalid authority epoch.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_EVENT_EPOCH_INVALID';
    END IF;
    IF (v_event->>'commit_sequence')::bigint < (p_batch->>'from_sequence')::bigint
       OR (v_event->>'commit_sequence')::bigint > (p_batch->>'to_sequence')::bigint THEN
      RAISE EXCEPTION 'An event is outside the declared sequence range.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_EVENT_OUT_OF_RANGE';
    END IF;
    IF COALESCE(v_event->>'business_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'An event has no valid business date.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_EVENT_BUSINESS_DATE_INVALID';
    END IF;
    IF cloud_ingest.sha256_hex(cloud_ingest.canonical_jsonb_text(v_event->'payload')) <> v_event->>'payload_hash' THEN
      RAISE EXCEPTION 'An event payload hash does not match its payload.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_EVENT_HASH_MISMATCH';
    END IF;
    v_key := lpad((v_event->>'commit_sequence'), 20, '0') || ':' || lpad((v_event->>'event_index'), 10, '0');
    IF v_key <= v_previous_key THEN
      RAISE EXCEPTION 'Batch events are not in canonical sequence order.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_EVENT_ORDER_INVALID';
    END IF;
    v_previous_key := v_key;
    v_index := v_index + 1;
  END LOOP;
  IF v_index <> COALESCE((p_batch->>'event_count')::integer, -1) THEN
    RAISE EXCEPTION 'The batch event count is inconsistent.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_EVENT_COUNT_MISMATCH';
  END IF;
END;
$$;

-- Record receipt only. Never creates events and never advances the watermark.
CREATE OR REPLACE FUNCTION cloud_ingest.receive(p_batch jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_existing cloud_ingest.batch_receipts%ROWTYPE;
  v_reference text;
BEGIN
  PERFORM cloud_ingest.assert_bundle(p_batch);
  SELECT * INTO v_existing FROM cloud_ingest.batch_receipts
   WHERE authority_id = (p_batch->>'authority_id')::uuid
     AND batch_id = (p_batch->>'batch_id')::uuid
   FOR UPDATE;
  IF FOUND THEN
    IF v_existing.manifest_hash <> p_batch->>'manifest_hash' THEN
      RAISE EXCEPTION 'This batch was already received with different content.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_PAYLOAD_CONFLICT';
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'idempotent', true, 'state', v_existing.receiver_state,
      'receiver_reference', v_existing.receiver_reference,
      'manifest_hash', v_existing.manifest_hash
    );
  END IF;
  v_reference := 'receiver:' || (p_batch->>'authority_id') || ':' || (p_batch->>'batch_id');
  INSERT INTO cloud_ingest.batch_receipts
    (authority_id, batch_id, manifest_hash, business_id, outlet_id, from_sequence,
     to_sequence, event_count, receiver_state, receiver_reference, manifest)
  VALUES
    ((p_batch->>'authority_id')::uuid, (p_batch->>'batch_id')::uuid, p_batch->>'manifest_hash',
     (p_batch->>'business_id')::uuid, (p_batch->>'outlet_id')::uuid,
     (p_batch->>'from_sequence')::bigint, (p_batch->>'to_sequence')::bigint,
     (p_batch->>'event_count')::integer, 'received', v_reference, p_batch);
  RETURN jsonb_build_object(
    'ok', true, 'idempotent', false, 'state', 'received',
    'receiver_reference', v_reference, 'manifest_hash', p_batch->>'manifest_hash'
  );
END;
$$;

CREATE OR REPLACE FUNCTION cloud_ingest.validate(p_batch jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_receipt cloud_ingest.batch_receipts%ROWTYPE;
BEGIN
  PERFORM cloud_ingest.assert_bundle(p_batch);
  SELECT * INTO v_receipt FROM cloud_ingest.batch_receipts
   WHERE authority_id = (p_batch->>'authority_id')::uuid
     AND batch_id = (p_batch->>'batch_id')::uuid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The batch must be received before validation.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_NOT_RECEIVED';
  END IF;
  IF v_receipt.manifest_hash <> p_batch->>'manifest_hash' THEN
    RAISE EXCEPTION 'This batch was already received with different content.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_PAYLOAD_CONFLICT';
  END IF;
  IF v_receipt.receiver_state = 'received' THEN
    UPDATE cloud_ingest.batch_receipts
       SET receiver_state = 'validated', validated_at = now()
     WHERE authority_id = v_receipt.authority_id AND batch_id = v_receipt.batch_id;
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'idempotent', v_receipt.receiver_state <> 'received', 'state', 'validated',
    'receiver_reference', v_receipt.receiver_reference, 'manifest_hash', v_receipt.manifest_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION cloud_ingest.ingest(p_batch jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_receipt cloud_ingest.batch_receipts%ROWTYPE;
  v_event jsonb;
  v_existing cloud_ingest.events%ROWTYPE;
  v_inserted integer := 0;
  v_replayed integer := 0;
  v_late integer := 0;
  v_max bigint;
BEGIN
  PERFORM cloud_ingest.assert_bundle(p_batch);
  SELECT * INTO v_receipt FROM cloud_ingest.batch_receipts
   WHERE authority_id = (p_batch->>'authority_id')::uuid
     AND batch_id = (p_batch->>'batch_id')::uuid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The batch must be received and validated before ingestion.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_NOT_RECEIVED';
  END IF;
  IF v_receipt.manifest_hash <> p_batch->>'manifest_hash' THEN
    RAISE EXCEPTION 'This batch was already received with different content.' USING ERRCODE = 'BL001', DETAIL = 'BATCH_PAYLOAD_CONFLICT';
  END IF;

  SELECT max_ingested_sequence INTO v_max FROM cloud_ingest.watermarks
   WHERE authority_id = v_receipt.authority_id FOR UPDATE;
  IF (p_batch->>'from_sequence')::bigint <= COALESCE(v_max, 0) THEN
    v_late := 1;
  END IF;

  FOR v_event IN SELECT * FROM jsonb_array_elements(p_batch->'events') LOOP
    SELECT * INTO v_existing FROM cloud_ingest.events
     WHERE authority_id = v_receipt.authority_id AND event_id = (v_event->>'event_id')::uuid;
    IF FOUND THEN
      IF v_existing.payload_hash <> v_event->>'payload_hash'
         OR v_existing.commit_sequence <> (v_event->>'commit_sequence')::bigint
         OR v_existing.event_index <> (v_event->>'event_index')::integer THEN
        RAISE EXCEPTION 'Event % was already received with different content.', v_event->>'event_id'
          USING ERRCODE = 'BL001', DETAIL = 'EVENT_PAYLOAD_CONFLICT';
      END IF;
      v_replayed := v_replayed + 1;
      CONTINUE;
    END IF;
    INSERT INTO cloud_ingest.events
      (authority_id, event_id, batch_id, commit_sequence, event_index, event_type,
       operation_id, authority_epoch, business_id, outlet_id, business_date, payload, payload_hash)
    VALUES
      (v_receipt.authority_id, (v_event->>'event_id')::uuid, v_receipt.batch_id,
       (v_event->>'commit_sequence')::bigint, (v_event->>'event_index')::integer,
       v_event->>'event_type', (v_event->>'operation_id')::uuid,
       (v_event->>'authority_epoch')::bigint, v_receipt.business_id, v_receipt.outlet_id,
       (v_event->>'business_date')::date, v_event->'payload', v_event->>'payload_hash');
    v_inserted := v_inserted + 1;
  END LOOP;

  UPDATE cloud_ingest.batch_receipts
     SET receiver_state = 'ingested', ingested_at = now(),
         validated_at = COALESCE(validated_at, now())
   WHERE authority_id = v_receipt.authority_id AND batch_id = v_receipt.batch_id;

  INSERT INTO cloud_ingest.watermarks AS w
    (authority_id, ingested_events, max_ingested_sequence, late_sequence_batches, last_batch_id, last_ingested_at)
  VALUES
    (v_receipt.authority_id, v_inserted, (p_batch->>'to_sequence')::bigint, v_late, v_receipt.batch_id, now())
  ON CONFLICT (authority_id) DO UPDATE
    SET ingested_events = w.ingested_events + EXCLUDED.ingested_events,
        max_ingested_sequence = GREATEST(COALESCE(w.max_ingested_sequence, 0), EXCLUDED.max_ingested_sequence),
        late_sequence_batches = w.late_sequence_batches + EXCLUDED.late_sequence_batches,
        last_batch_id = EXCLUDED.last_batch_id,
        last_ingested_at = EXCLUDED.last_ingested_at;

  RETURN jsonb_build_object(
    'ok', true, 'idempotent', v_inserted = 0, 'state', 'ingested',
    'receiver_reference', v_receipt.receiver_reference,
    'manifest_hash', v_receipt.manifest_hash,
    'inserted_events', v_inserted, 'replayed_events', v_replayed,
    'late_sequence', v_late = 1
  );
END;
$$;

REVOKE ALL ON FUNCTION cloud_ingest.assert_bundle(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION cloud_ingest.receive(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION cloud_ingest.validate(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION cloud_ingest.ingest(jsonb) FROM PUBLIC;
