-- Retrieve a previously generated export bundle without acknowledging it.
-- The read is tenant/outlet/authority scoped and re-checks the stored manifest
-- digest so corrupted package metadata is never presented as a usable export.

CREATE OR REPLACE FUNCTION bar_local.query_export_bundle_get(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_batch_id uuid;
  v_batch bar_local.export_batches%ROWTYPE;
  v_scope jsonb;
  v_as_of text;
  v_watermark bigint;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'export.manage');

  IF jsonb_typeof(v_filters) <> 'object'
     OR (CASE WHEN jsonb_typeof(v_filters) = 'object'
          THEN EXISTS (SELECT 1 FROM jsonb_object_keys(v_filters) AS k(key) WHERE k.key <> 'batch_id')
          ELSE true
        END)
     OR COALESCE(v_filters->>'batch_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A valid export batch_id is required.');
  END IF;
  v_batch_id := (v_filters->>'batch_id')::uuid;

  v_scope := jsonb_build_object(
    'business_id', v_ctx.business_id,
    'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id,
    'role', v_ctx.role,
    'device_id', v_ctx.device_id
  );
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;

  SELECT * INTO v_batch
    FROM bar_local.export_batches b
   WHERE b.batch_id = v_batch_id
     AND b.business_id = v_ctx.business_id
     AND b.outlet_id = v_ctx.outlet_id
     AND b.authority_id = p_authority_id
     AND b.authority_epoch = p_authority_epoch;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'data', '{}'::jsonb,
      'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', COALESCE(v_watermark, 0),
      'complete', false,
      'unavailable', jsonb_build_array('export_bundle_not_found'),
      'scope', v_scope,
      'as_of', v_as_of
    );
  END IF;

  IF jsonb_typeof(v_batch.manifest) <> 'object'
     OR bar_local.sha256_hex(bar_local.canonical_jsonb_text(v_batch.manifest)) <> v_batch.manifest_hash
     OR v_batch.manifest->>'batch_id' <> v_batch.batch_id::text
     OR v_batch.manifest->>'authority_id' <> p_authority_id::text
     OR v_batch.manifest->>'authority_epoch' <> p_authority_epoch::text
     OR v_batch.manifest->>'business_id' <> v_batch.business_id::text
     OR v_batch.manifest->>'outlet_id' <> v_batch.outlet_id::text
     OR v_batch.manifest->>'from_sequence' <> v_batch.from_sequence::text
     OR v_batch.manifest->>'to_sequence' <> v_batch.to_sequence::text
     OR v_batch.manifest->>'event_count' IS DISTINCT FROM v_batch.event_count::text
     OR v_batch.manifest->>'checkpoint' IS DISTINCT FROM v_batch.checkpoint::text
     OR (CASE
          WHEN jsonb_typeof(v_batch.manifest->'events') = 'array'
            THEN jsonb_array_length(v_batch.manifest->'events') <> v_batch.event_count
              OR EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(v_batch.manifest->'events') AS ev(value)
                 WHERE jsonb_typeof(ev.value) IS DISTINCT FROM 'object'
                    OR ev.value->'payload' IS NULL
                    OR COALESCE(ev.value->>'payload_hash', '') !~ '^[0-9a-f]{64}$'
                    OR ev.value->>'authority_epoch' IS DISTINCT FROM p_authority_epoch::text
                    OR CASE WHEN COALESCE(ev.value->>'commit_sequence', '') ~ '^[0-9]{1,19}$'
                         THEN (ev.value->>'commit_sequence')::numeric < v_batch.from_sequence::numeric
                           OR (ev.value->>'commit_sequence')::numeric > v_batch.to_sequence::numeric
                         ELSE true END
                    OR bar_local.sha256_hex(bar_local.canonical_jsonb_text(ev.value->'payload'))
                       IS DISTINCT FROM ev.value->>'payload_hash'
                    OR NOT EXISTS (
                      SELECT 1
                        FROM bar_local.export_batch_items i
                        JOIN bar_local.outbox o
                          ON o.event_id = i.event_id AND o.export_batch_id = i.batch_id
                       WHERE i.batch_id = v_batch.batch_id
                         AND i.event_id::text IS NOT DISTINCT FROM ev.value->>'event_id'
                         AND i.commit_sequence::text IS NOT DISTINCT FROM ev.value->>'commit_sequence'
                         AND i.event_index::text IS NOT DISTINCT FROM ev.value->>'event_index'
                         AND i.payload_hash IS NOT DISTINCT FROM ev.value->>'payload_hash'
                         AND o.business_id = v_batch.business_id
                         AND o.outlet_id = v_batch.outlet_id
                         AND o.authority_epoch = v_batch.authority_epoch
                    )
              )
          ELSE true
        END) THEN
    RETURN jsonb_build_object(
      'data', '{}'::jsonb,
      'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
      'snapshot_watermark', COALESCE(v_watermark, 0),
      'complete', false,
      'unavailable', jsonb_build_array('export_bundle_integrity_failed'),
      'scope', v_scope,
      'as_of', v_as_of
    );
  END IF;

  RETURN jsonb_build_object(
    'data', v_batch.manifest || jsonb_build_object(
      'manifest_hash', v_batch.manifest_hash,
      'status', v_batch.status,
      'signature', v_batch.signature,
      'signature_key_id', v_batch.signature_key_id,
      'signature_status', v_batch.signature_status,
      'signature_algorithm', v_batch.signature_algorithm,
      'transport_status', v_batch.transport_status
    ),
    'pagination', jsonb_build_object('next_cursor', NULL, 'has_more', false),
    'complete', true,
    'unavailable', '[]'::jsonb,
    'snapshot_watermark', v_batch.to_sequence,
    'scope', v_scope,
    'as_of', v_as_of
  );
END;
$$;

ALTER FUNCTION bar_local.query_export_bundle_get(text, uuid, uuid, bigint, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_export_bundle_get(text, uuid, uuid, bigint, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_export_bundle_get(text, uuid, uuid, bigint, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_export_bundle_get(text, uuid, uuid, bigint, jsonb) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb)
  RENAME TO query_dispatch_before_export_bundle_get;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_query = 'outbox.bundle.get' THEN
    RETURN bar_local.query_export_bundle_get(
      p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_filters
    );
  END IF;
  RETURN bar_local.query_dispatch_before_export_bundle_get(
    p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
  );
END;
$$;

ALTER FUNCTION bar_local.query_dispatch_before_export_bundle_get(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch_before_export_bundle_get(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_before_export_bundle_get(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_export_bundle_get(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
