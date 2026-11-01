-- Reconcile outbox/export status from the authenticated current outlet only.
-- The read never acknowledges, rewrites, or retries an export batch.

CREATE OR REPLACE FUNCTION bar_local.query_outbox_status(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_scope jsonb;
  v_as_of text;
  v_watermark bigint;
  v_data jsonb;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'export.manage');

  v_scope := jsonb_build_object(
    'business_id', v_ctx.business_id,
    'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id,
    'role', v_ctx.role,
    'device_id', v_ctx.device_id
  );
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;

  SELECT jsonb_build_object(
    'pending_events', (
      SELECT count(*) FROM bar_local.outbox o
       WHERE o.business_id = v_ctx.business_id AND o.outlet_id = v_ctx.outlet_id
         AND o.authority_epoch = p_authority_epoch
         AND o.export_batch_id IS NULL
    ),
    'exported_unacknowledged', (
      SELECT count(*)
        FROM bar_local.outbox o
        JOIN bar_local.export_batches b ON b.batch_id = o.export_batch_id
       WHERE o.business_id = v_ctx.business_id AND o.outlet_id = v_ctx.outlet_id
         AND o.authority_epoch = p_authority_epoch
         AND b.business_id = v_ctx.business_id AND b.outlet_id = v_ctx.outlet_id
         AND b.authority_id = p_authority_id AND b.authority_epoch = p_authority_epoch
         AND b.acknowledged_at IS NULL
    ),
    'oldest_pending_sequence', (
      SELECT min(o.commit_sequence) FROM bar_local.outbox o
       WHERE o.business_id = v_ctx.business_id AND o.outlet_id = v_ctx.outlet_id
         AND o.authority_epoch = p_authority_epoch
         AND o.export_batch_id IS NULL
    ),
    'latest_commit_sequence', COALESCE(v_watermark, 0),
    'exported_watermark', COALESCE((
      SELECT max(b.to_sequence) FROM bar_local.export_batches b
       WHERE b.business_id = v_ctx.business_id AND b.outlet_id = v_ctx.outlet_id
         AND b.authority_id = p_authority_id AND b.authority_epoch = p_authority_epoch
    ), 0),
    'acknowledged_watermark', COALESCE((
      SELECT max(b.to_sequence) FROM bar_local.export_batches b
       WHERE b.business_id = v_ctx.business_id AND b.outlet_id = v_ctx.outlet_id
         AND b.authority_id = p_authority_id AND b.authority_epoch = p_authority_epoch
         AND b.acknowledged_at IS NOT NULL
    ), 0),
    'batches_truncated', (
      SELECT count(*) > 50 FROM bar_local.export_batches b
       WHERE b.business_id = v_ctx.business_id AND b.outlet_id = v_ctx.outlet_id
         AND b.authority_id = p_authority_id AND b.authority_epoch = p_authority_epoch
    ),
    'batches', COALESCE((
      SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC)
        FROM (
          SELECT b.batch_id, b.from_sequence, b.to_sequence, b.event_count,
                 b.checkpoint, b.manifest_hash, b.status, b.signature_status,
                 b.transport_status, b.created_at, b.acknowledged_at,
                 (SELECT count(*)::integer FROM bar_local.export_batch_items i
                   WHERE i.batch_id = b.batch_id) AS item_count,
                 (SELECT count(*)::integer FROM bar_local.outbox o
                   WHERE o.export_batch_id = b.batch_id
                     AND o.business_id = v_ctx.business_id
                     AND o.outlet_id = v_ctx.outlet_id
                     AND o.authority_epoch = p_authority_epoch) AS linked_event_count,
                 CASE
                   WHEN jsonb_typeof(b.manifest) IS DISTINCT FROM 'object'
                     OR bar_local.sha256_hex(bar_local.canonical_jsonb_text(b.manifest)) IS DISTINCT FROM b.manifest_hash
                     OR b.manifest->>'batch_id' IS DISTINCT FROM b.batch_id::text
                     OR b.manifest->>'authority_id' IS DISTINCT FROM b.authority_id::text
                     OR b.manifest->>'authority_epoch' IS DISTINCT FROM b.authority_epoch::text
                     OR b.manifest->>'business_id' IS DISTINCT FROM b.business_id::text
                     OR b.manifest->>'outlet_id' IS DISTINCT FROM b.outlet_id::text
                     OR b.manifest->>'from_sequence' IS DISTINCT FROM b.from_sequence::text
                     OR b.manifest->>'to_sequence' IS DISTINCT FROM b.to_sequence::text
                     OR b.manifest->>'event_count' IS DISTINCT FROM b.event_count::text
                     OR b.manifest->>'checkpoint' IS DISTINCT FROM b.checkpoint::text
                     OR CASE WHEN jsonb_typeof(b.manifest->'events') = 'array'
                          THEN jsonb_array_length(b.manifest->'events') <> b.event_count
                            OR EXISTS (
                              SELECT 1 FROM jsonb_array_elements(b.manifest->'events') AS ev(value)
                               WHERE jsonb_typeof(ev.value) IS DISTINCT FROM 'object'
                                  OR ev.value->'payload' IS NULL
                                  OR COALESCE(ev.value->>'payload_hash', '') !~ '^[0-9a-f]{64}$'
                                  OR ev.value->>'authority_epoch' IS DISTINCT FROM b.authority_epoch::text
                                  OR CASE WHEN COALESCE(ev.value->>'commit_sequence', '') ~ '^[0-9]{1,19}$'
                                       THEN (ev.value->>'commit_sequence')::numeric < b.from_sequence::numeric
                                         OR (ev.value->>'commit_sequence')::numeric > b.to_sequence::numeric
                                       ELSE true END
                                  OR bar_local.sha256_hex(bar_local.canonical_jsonb_text(ev.value->'payload'))
                                     IS DISTINCT FROM ev.value->>'payload_hash'
                                  OR NOT EXISTS (
                                    SELECT 1
                                      FROM bar_local.export_batch_items i
                                      JOIN bar_local.outbox o
                                        ON o.event_id = i.event_id AND o.export_batch_id = i.batch_id
                                     WHERE i.batch_id = b.batch_id
                                       AND i.event_id::text IS NOT DISTINCT FROM ev.value->>'event_id'
                                       AND i.commit_sequence::text IS NOT DISTINCT FROM ev.value->>'commit_sequence'
                                       AND i.event_index::text IS NOT DISTINCT FROM ev.value->>'event_index'
                                       AND i.payload_hash IS NOT DISTINCT FROM ev.value->>'payload_hash'
                                       AND o.business_id = b.business_id
                                       AND o.outlet_id = b.outlet_id
                                       AND o.authority_epoch = b.authority_epoch
                                  )
                            )
                          ELSE true END
                     OR (SELECT count(*) FROM bar_local.export_batch_items i WHERE i.batch_id = b.batch_id) <> b.event_count
                     OR (SELECT count(*) FROM bar_local.outbox o
                          WHERE o.export_batch_id = b.batch_id
                            AND o.business_id = v_ctx.business_id
                            AND o.outlet_id = v_ctx.outlet_id
                            AND o.authority_epoch = p_authority_epoch) <> b.event_count
                     OR EXISTS (
                          SELECT 1
                            FROM bar_local.export_batch_items i
                            LEFT JOIN bar_local.outbox o
                              ON o.event_id = i.event_id AND o.export_batch_id = i.batch_id
                           WHERE i.batch_id = b.batch_id
                             AND (o.event_id IS NULL
                               OR o.business_id IS DISTINCT FROM v_ctx.business_id
                               OR o.outlet_id IS DISTINCT FROM v_ctx.outlet_id
                               OR o.authority_epoch IS DISTINCT FROM p_authority_epoch
                               OR o.payload_hash IS DISTINCT FROM i.payload_hash)
                     )
                     THEN false
                   ELSE true
                 END AS integrity_valid
            FROM bar_local.export_batches b
           WHERE b.business_id = v_ctx.business_id AND b.outlet_id = v_ctx.outlet_id
             AND b.authority_id = p_authority_id AND b.authority_epoch = p_authority_epoch
           ORDER BY b.created_at DESC, b.batch_id
           LIMIT 50
        ) x
    ), '[]'::jsonb),
    'cloud_transport', 'disabled'
  ) INTO v_data;

  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
    'snapshot_watermark', COALESCE(v_watermark, 0),
    'scope', v_scope,
    'as_of', v_as_of,
    'complete', true,
    'unavailable', '[]'::jsonb
  );
END;
$$;

ALTER FUNCTION bar_local.query_outbox_status(text, uuid, uuid, bigint) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_outbox_status(text, uuid, uuid, bigint) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_outbox_status(text, uuid, uuid, bigint) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_outbox_status(text, uuid, uuid, bigint) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb)
  RENAME TO query_dispatch_before_outbox_status;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_query = 'outbox.status' THEN
    IF jsonb_typeof(COALESCE(p_filters, '{}'::jsonb)) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_filters, '{}'::jsonb)) AS k(key)) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'outbox.status does not accept filters.');
    END IF;
    RETURN bar_local.query_outbox_status(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  END IF;
  RETURN bar_local.query_dispatch_before_outbox_status(
    p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
  );
END;
$$;

ALTER FUNCTION bar_local.query_dispatch_before_outbox_status(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch_before_outbox_status(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_before_outbox_status(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_outbox_status(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
