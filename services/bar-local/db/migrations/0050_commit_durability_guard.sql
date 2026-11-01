-- Enforce durable writes in the transaction, rather than relying on a green
-- renderer check or the connection's inherited synchronous_commit setting.
CREATE OR REPLACE FUNCTION bar_local.allocate_sequence(p_allocate_receipt boolean DEFAULT false)
RETURNS TABLE (commit_sequence bigint, receipt_sequence bigint) LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  IF pg_is_in_recovery() OR current_setting('transaction_read_only') = 'on'
     OR current_setting('fsync') <> 'on' OR current_setting('full_page_writes') <> 'on' THEN
    PERFORM bar_local.raise_business('SERVICE_UNAVAILABLE', 'Durable local writes are unavailable. Keep the original operation and contact the owner.');
  END IF;
  -- SET LOCAL remains in force until COMMIT, including callers that inherited
  -- synchronous_commit=off. A required standby's absence can never downgrade
  -- the commit to asynchronous acknowledgement.
  PERFORM set_config('synchronous_commit', 'on', true);
  UPDATE bar_local.authority_counter
     SET commit_sequence = commit_sequence + 1,
         receipt_sequence = receipt_sequence + CASE WHEN p_allocate_receipt THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE singleton
  RETURNING authority_counter.commit_sequence, authority_counter.receipt_sequence
       INTO commit_sequence, receipt_sequence;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTHORITY_NOT_COMMISSIONED', 'The local authority counter is missing.');
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION bar_local.allocate_sequence(boolean) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.service_readiness(text, uuid) RENAME TO service_readiness_before_durability;
REVOKE ALL ON FUNCTION bar_local.service_readiness_before_durability(text, uuid) FROM PUBLIC, bar_local_runtime;
CREATE OR REPLACE FUNCTION bar_local.service_readiness(p_token_hash text, p_device_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_result jsonb;
  v_blockers jsonb;
BEGIN
  v_result := bar_local.service_readiness_before_durability(p_token_hash, p_device_id);
  v_blockers := v_result->'blockers';
  IF pg_is_in_recovery() OR current_setting('transaction_read_only') = 'on' THEN
    v_blockers := v_blockers || '["authority_read_only"]'::jsonb;
  END IF;
  IF current_setting('fsync') <> 'on' OR current_setting('full_page_writes') <> 'on' THEN
    v_blockers := v_blockers || '["durable_storage_settings_required"]'::jsonb;
  END IF;
  RETURN v_result || jsonb_build_object('blockers', v_blockers, 'ready', jsonb_array_length(v_blockers) = 0);
END;
$$;
REVOKE ALL ON FUNCTION bar_local.service_readiness(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.service_readiness(text, uuid) TO bar_local_runtime;
