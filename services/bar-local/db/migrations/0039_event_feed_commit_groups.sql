-- The cursor is a commit sequence, not an event-row offset. Never split one
-- commit's event rows across pages or advancing next_cursor could skip them.
CREATE OR REPLACE FUNCTION bar_local.service_events(
  p_token_hash text,
  p_device_id uuid,
  p_after_sequence bigint DEFAULT 0,
  p_limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_ctx bar_local.session_context := bar_local.service_session(p_token_hash, p_device_id);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  v_events jsonb;
  v_count integer;
  v_next bigint;
  v_latest bigint;
  v_latest_event bigint;
  v_floor bigint;
BEGIN
  IF p_after_sequence IS NULL OR p_after_sequence < 0 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The event cursor must be zero or a non-negative commit sequence.');
  END IF;
  SELECT commit_sequence INTO v_latest FROM bar_local.authority_counter WHERE singleton;
  SELECT max(commit_sequence) INTO v_latest_event
    FROM bar_local.outbox
   WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id;
  SELECT min(commit_sequence) INTO v_floor
    FROM bar_local.outbox
   WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id;

  WITH page_sequences AS (
    SELECT DISTINCT o.commit_sequence
      FROM bar_local.outbox o
     WHERE o.business_id = v_ctx.business_id AND o.outlet_id = v_ctx.outlet_id
       AND o.commit_sequence > p_after_sequence
     ORDER BY o.commit_sequence
     LIMIT v_limit
  ), page_events AS (
    SELECT o.commit_sequence, o.event_index, o.event_type, o.operation_id, o.payload, o.payload_hash, o.created_at
      FROM bar_local.outbox o
      JOIN page_sequences p USING (commit_sequence)
     WHERE o.business_id = v_ctx.business_id AND o.outlet_id = v_ctx.outlet_id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.commit_sequence, x.event_index), '[]'::jsonb),
         count(*)
    INTO v_events, v_count
    FROM page_events x;

  SELECT max((value->>'commit_sequence')::bigint) INTO v_next FROM jsonb_array_elements(v_events);
  RETURN jsonb_build_object(
    'events', v_events,
    'event_count', v_count,
    'next_cursor', COALESCE(v_next, p_after_sequence),
    'latest_commit_sequence', v_latest,
    'latest_event_sequence', v_latest_event,
    'retention_floor_sequence', v_floor,
    'gap_detected', p_after_sequence > 0 AND v_floor IS NOT NULL AND p_after_sequence < v_floor - 1,
    'complete', COALESCE(v_next, p_after_sequence) >= COALESCE(v_latest_event, 0),
    'scope', jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id, 'device_id', v_ctx.device_id)
  );
END;
$$;
