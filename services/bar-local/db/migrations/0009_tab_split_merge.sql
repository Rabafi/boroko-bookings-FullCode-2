-- Atomic tab split and merge. Lines already hold stock, so these commands move
-- tab ownership only; they never re-price or re-deplete stock.

CREATE OR REPLACE FUNCTION bar_local.cmd_tab_split(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_source bar_local.tabs%ROWTYPE;
  v_shift bar_local.shifts%ROWTYPE;
  v_target_id uuid;
  v_owner uuid;
  v_line_ids uuid[];
  v_line record;
  v_selected_count integer;
  v_open_count integer;
  v_target_line_no integer := 0;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'pos.manage',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    SELECT * INTO v_source FROM bar_local.tabs WHERE id = (v_payload->>'source_tab_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_source.business_id <> v_ctx.business_id OR v_source.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('TAB_NOT_FOUND', 'The source tab could not be found in this outlet.');
    END IF;
    IF v_source.status <> 'open' THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'Only an open tab can be split.');
    END IF;
    IF v_source.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('TAB_VERSION_CONFLICT', 'The tab changed on another till. Refresh before splitting.');
    END IF;
    IF v_source.owner_staff_id <> v_ctx.staff_id AND v_ctx.role NOT IN ('owner', 'manager') THEN
      PERFORM bar_local.raise_business('TAB_NOT_OWNED', 'This tab belongs to another operator.');
    END IF;
    v_line_ids := ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(v_payload->'line_ids', '[]'::jsonb)));
    IF cardinality(v_line_ids) = 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Select at least one line to split into the new tab.');
    END IF;
    IF cardinality(v_line_ids) <> (SELECT count(DISTINCT value) FROM unnest(v_line_ids) AS ids(value)) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A tab line can only be selected once.');
    END IF;
    v_owner := COALESCE(NULLIF(v_payload->>'target_owner_staff_id', '')::uuid, v_ctx.staff_id);
    IF v_owner <> v_ctx.staff_id THEN
      PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
      IF NOT EXISTS (SELECT 1 FROM bar_local.staff WHERE id = v_owner AND business_id = v_ctx.business_id AND status = 'active') THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The target tab owner is unavailable.');
      END IF;
    END IF;
    SELECT * INTO v_shift FROM bar_local.shifts
     WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND staff_id = v_ctx.staff_id AND status = 'open'
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open a shift before splitting tabs.');
    END IF;
    SELECT count(*) INTO v_selected_count
      FROM bar_local.tab_lines
     WHERE tab_id = v_source.id AND status = 'open' AND id = ANY(v_line_ids);
    SELECT count(*) INTO v_open_count
      FROM bar_local.tab_lines
     WHERE tab_id = v_source.id AND status = 'open';
    IF v_selected_count <> cardinality(v_line_ids) THEN
      PERFORM bar_local.raise_business('TAB_LINE_NOT_FOUND', 'One or more selected lines are not open on this tab.');
    END IF;
    IF v_selected_count = v_open_count THEN
      PERFORM bar_local.raise_business('TAB_SPLIT_EMPTY_SOURCE', 'A split must leave at least one open line on the source tab.');
    END IF;
    INSERT INTO bar_local.tabs (business_id, outlet_id, table_label, owner_staff_id, note, operation_id)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, v_payload->>'table_label', v_owner, v_payload->>'note',
            (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_target_id;
    FOR v_line IN
      SELECT id, line_number FROM bar_local.tab_lines
       WHERE tab_id = v_source.id AND status = 'open' AND id = ANY(v_line_ids)
       ORDER BY line_number
    LOOP
      v_target_line_no := v_target_line_no + 1;
      UPDATE bar_local.tab_lines SET tab_id = v_target_id, line_number = v_target_line_no WHERE id = v_line.id;
    END LOOP;
    UPDATE bar_local.tabs SET version = version + 1 WHERE id = v_source.id;
    v_result := jsonb_build_object(
      'source_tab_id', v_source.id,
      'source_version', v_source.version + 1,
      'target_tab_id', v_target_id,
      'target_version', 1,
      'owner_staff_id', v_owner,
      'moved_lines', v_target_line_no
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'tab.split', (p_envelope->>'operation_id')::uuid,
      jsonb_build_object('source_tab_id', v_source.id, 'source_version', v_source.version),
      v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type', 'tab.split', 'payload', v_result)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_tab_merge(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_source bar_local.tabs%ROWTYPE;
  v_target bar_local.tabs%ROWTYPE;
  v_shift bar_local.shifts%ROWTYPE;
  v_line record;
  v_source_line_count integer;
  v_target_line_no integer;
  v_moved integer := 0;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'pos.manage',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    IF (v_payload->>'source_tab_id')::uuid = (v_payload->>'target_tab_id')::uuid THEN
      PERFORM bar_local.raise_business('TAB_MERGE_SELF', 'A tab cannot be merged into itself.');
    END IF;
    PERFORM 1 FROM bar_local.tabs
     WHERE id IN ((v_payload->>'source_tab_id')::uuid, (v_payload->>'target_tab_id')::uuid)
     ORDER BY id FOR UPDATE;
    SELECT * INTO v_source FROM bar_local.tabs WHERE id = (v_payload->>'source_tab_id')::uuid;
    SELECT * INTO v_target FROM bar_local.tabs WHERE id = (v_payload->>'target_tab_id')::uuid;
    IF v_source.id IS NULL OR v_target.id IS NULL
       OR v_source.business_id <> v_ctx.business_id OR v_target.business_id <> v_ctx.business_id
       OR v_source.outlet_id <> v_ctx.outlet_id OR v_target.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('TAB_NOT_FOUND', 'Both tabs must exist in this outlet.');
    END IF;
    IF v_source.status <> 'open' OR v_target.status <> 'open' THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'Only open tabs can be merged.');
    END IF;
    IF v_source.version <> (v_payload->>'source_expected_version')::integer
       OR v_target.version <> (v_payload->>'target_expected_version')::integer THEN
      PERFORM bar_local.raise_business('TAB_VERSION_CONFLICT', 'A tab changed on another till. Refresh before merging.');
    END IF;
    IF v_source.owner_staff_id <> v_ctx.staff_id AND v_ctx.role NOT IN ('owner', 'manager') THEN
      PERFORM bar_local.raise_business('TAB_NOT_OWNED', 'The source tab belongs to another operator.');
    END IF;
    SELECT * INTO v_shift FROM bar_local.shifts
     WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND staff_id = v_ctx.staff_id AND status = 'open'
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open a shift before merging tabs.');
    END IF;
    SELECT count(*) INTO v_source_line_count
      FROM bar_local.tab_lines
     WHERE tab_id = v_source.id AND status = 'open';
    IF v_source_line_count = 0 THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'The source tab has no open lines to merge.');
    END IF;
    SELECT COALESCE(MAX(line_number), 0) INTO v_target_line_no
      FROM bar_local.tab_lines
     WHERE tab_id = v_target.id;
    FOR v_line IN
      SELECT id FROM bar_local.tab_lines
       WHERE tab_id = v_source.id AND status = 'open'
       ORDER BY line_number
    LOOP
      v_target_line_no := v_target_line_no + 1;
      v_moved := v_moved + 1;
      UPDATE bar_local.tab_lines SET tab_id = v_target.id, line_number = v_target_line_no WHERE id = v_line.id;
    END LOOP;
    UPDATE bar_local.tabs SET status = 'transferred', closed_at = now(), version = version + 1 WHERE id = v_source.id;
    UPDATE bar_local.tabs SET version = version + 1 WHERE id = v_target.id;
    v_result := jsonb_build_object(
      'source_tab_id', v_source.id,
      'source_version', v_source.version + 1,
      'source_status', 'transferred',
      'target_tab_id', v_target.id,
      'target_version', v_target.version + 1,
      'moved_lines', v_moved
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'tab.merged', (p_envelope->>'operation_id')::uuid,
      jsonb_build_object('source_tab_id', v_source.id, 'source_version', v_source.version,
                         'target_tab_id', v_target.id, 'target_version', v_target.version),
      v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type', 'tab.merged', 'payload', v_result)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.cmd_tab_split(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_tab_split(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_tab_split(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_tab_split(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.cmd_tab_merge(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_tab_merge(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_tab_merge(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_tab_merge(text, uuid, jsonb, text, text) TO bar_local_runtime;
