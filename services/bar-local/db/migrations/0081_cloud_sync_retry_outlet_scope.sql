-- Scope retries of old prepared batches to the outlet bound by migration 0080.
-- Excluded batches, their outbox ownership and acknowledgement state remain
-- untouched until that outlet has its own approved sync configuration.
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
     AND b.outlet_id = v_config.linked_outlet_id
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
