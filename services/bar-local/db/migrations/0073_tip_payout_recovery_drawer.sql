-- Allow a manager-approved payout reversal to be recorded in a different
-- currently open manager drawer after the original payout drawer is closed.
-- The new cash movement remains linked to the original payout through the
-- immutable tip_payout_reversals row and its cash_movement_id.
ALTER FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text)
  RENAME TO cmd_workforce_tip_payout_reverse_before_recovery;
REVOKE ALL ON FUNCTION bar_local.cmd_workforce_tip_payout_reverse_before_recovery(text, uuid, jsonb, text, text)
  FROM PUBLIC, bar_local_runtime;

CREATE FUNCTION bar_local.cmd_workforce_tip_payout_reverse(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_payout bar_local.tip_payouts%ROWTYPE;
  v_original_shift bar_local.shifts%ROWTYPE;
  v_target_shift bar_local.shifts%ROWTYPE;
  v_target_staff bar_local.staff%ROWTYPE;
  v_payout_id uuid := NULLIF(v_payload->>'payout_id', '')::uuid;
  v_recovery_shift_id uuid := NULLIF(v_payload->>'recovery_shift_id', '')::uuid;
  v_reason text := NULLIF(trim(v_payload->>'reason'), '');
  v_balance_after numeric(14,2);
  v_cash_movement_id uuid;
  v_reversal_id uuid;
  v_result jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.cashup');
  PERFORM bar_local.assert_feature('bar_accounting_workforce');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid, p_approval_hash, 'pos.cashup',
      v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id);
    IF v_payout_id IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A tip payout is required for a reversal.');
    END IF;
    IF v_reason IS NULL THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A reason is required for a tip payout reversal.');
    END IF;
    SELECT * INTO v_payout FROM bar_local.tip_payouts
     WHERE id = v_payout_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('TIP_PAYOUT_NOT_FOUND', 'The tip payout could not be found in this outlet.');
    END IF;
    PERFORM 1 FROM bar_local.staff WHERE id = v_payout.staff_id FOR UPDATE;
    IF v_payout.status <> 'paid' THEN
      PERFORM bar_local.raise_business('TIP_PAYOUT_ALREADY_REVERSED', 'This tip payout has already been reversed.');
    END IF;
    SELECT * INTO v_original_shift FROM bar_local.shifts
     WHERE id = v_payout.shift_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH', 'The original payout shift is outside this outlet.');
    END IF;
    IF v_recovery_shift_id IS NULL AND v_original_shift.status <> 'open' THEN
      PERFORM bar_local.raise_business('SHIFT_CLOSED', 'The original payout drawer is closed. Select a different open manager drawer to record this correction.');
    END IF;
    SELECT * INTO v_target_shift FROM bar_local.shifts
     WHERE id = COALESCE(v_recovery_shift_id, v_original_shift.id)
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND OR v_target_shift.status <> 'open' THEN
      PERFORM bar_local.raise_business('RECOVERY_DRAWER_UNAVAILABLE', 'The selected correction drawer is not open in this outlet. Refresh and choose a currently open manager drawer.');
    END IF;
    IF v_target_shift.id <> v_original_shift.id THEN
      SELECT * INTO v_target_staff FROM bar_local.staff
       WHERE id = v_target_shift.staff_id AND business_id = v_ctx.business_id FOR SHARE;
      IF NOT FOUND OR v_target_staff.status <> 'active' OR NOT (v_target_staff.capabilities @> ARRAY['pos.cashup'])
         OR v_target_staff.id = v_ctx.staff_id THEN
        PERFORM bar_local.raise_business('RECOVERY_DRAWER_UNAVAILABLE', 'The correction drawer must belong to a different active cash-up manager in this outlet.');
      END IF;
    END IF;
    INSERT INTO bar_local.cash_movements
      (business_id, outlet_id, shift_id, type, amount, reason, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_target_shift.id, 'paid_in', v_payout.amount,
       'Tip payout reversal for payout ' || v_payout.id::text || ': ' || v_reason, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_cash_movement_id;
    INSERT INTO bar_local.tip_payout_reversals
      (payout_id, business_id, outlet_id, staff_id, amount, cash_movement_id, operation_id, reversed_by, reason)
    VALUES
      (v_payout.id, v_ctx.business_id, v_ctx.outlet_id, v_payout.staff_id, v_payout.amount,
       v_cash_movement_id, (p_envelope->>'operation_id')::uuid, v_ctx.staff_id, v_reason)
    RETURNING id INTO v_reversal_id;
    UPDATE bar_local.tip_payouts
       SET status = 'reversed', reversed_at = now(), reversed_by = v_ctx.staff_id,
           reversal_operation_id = (p_envelope->>'operation_id')::uuid
     WHERE id = v_payout.id;
    v_balance_after := bar_local.staff_tip_balance(v_ctx.business_id, v_ctx.outlet_id, v_payout.staff_id);
    v_result := jsonb_build_object(
      'reversal_id', v_reversal_id, 'payout_id', v_payout.id, 'staff_id', v_payout.staff_id,
      'original_shift_id', v_original_shift.id, 'recovery_shift_id', v_target_shift.id,
      'amount', v_payout.amount, 'cash_movement_id', v_cash_movement_id, 'status', 'reversed',
      'balance_after', round(v_balance_after, 2), 'reason', v_reason
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'workforce.tip.payout_reversed', (p_envelope->>'operation_id')::uuid,
      to_jsonb(v_payout) || jsonb_build_object('original_shift_status', v_original_shift.status), v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result,
      jsonb_build_array(jsonb_build_object('event_type', 'workforce.tip.payout_reversed', 'payload', v_result)),
      v_target_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION
    WHEN unique_violation THEN
      v_code := 'TIP_PAYOUT_ALREADY_REVERSED';
      v_message := 'This tip payout has already been reversed.';
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
    WHEN SQLSTATE 'BL001' THEN
      GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
      v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
      RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;
ALTER FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_workforce_tip_payout_reverse(text, uuid, jsonb, text, text) TO bar_local_runtime;

CREATE OR REPLACE FUNCTION bar_local.query_tip_payouts(
 p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
 v_ctx bar_local.session_context;v_outlet uuid;v_limit integer;v_data jsonb;v_more boolean:=false;v_next text;
BEGIN
 v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
 PERFORM bar_local.assert_capability(v_ctx.capabilities,'pos.cashup');
 PERFORM bar_local.assert_feature('bar_accounting_workforce');
 v_outlet:=bar_local.query_outlet(v_ctx,p_filters);v_limit:=bar_local.query_limit(p_filters);
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO v_data FROM (
  SELECT p.id,p.staff_id,s.display_name,p.shift_id,d.status AS shift_status,
         p.amount::text AS amount,p.status,p.reason,p.paid_at,p.reversed_at
  FROM bar_local.tip_payouts p
  JOIN bar_local.staff s ON s.id=p.staff_id AND s.business_id=p.business_id
  JOIN bar_local.shifts d ON d.id=p.shift_id AND d.business_id=p.business_id AND d.outlet_id=p.outlet_id
  WHERE p.business_id=v_ctx.business_id AND p.outlet_id=v_outlet
   AND (p_filters->>'cursor' IS NULL OR p.id::text>p_filters->>'cursor')
  ORDER BY p.id LIMIT v_limit+1
 ) x;
 IF jsonb_array_length(v_data)>v_limit THEN
  v_data:=v_data-v_limit;v_more:=true;v_next:=v_data->-1->>'id';
 END IF;
 RETURN jsonb_build_object('data',v_data,'complete',true,'unavailable','[]'::jsonb,
  'pagination',jsonb_build_object('has_more',v_more,'next_cursor',v_next),
  'snapshot_watermark',(SELECT commit_sequence FROM bar_local.authority_counter WHERE singleton),
  'scope',jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_outlet,'device_id',v_ctx.device_id,'actor_staff_id',v_ctx.staff_id),
  'as_of',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_tip_payouts(text,uuid,uuid,bigint,jsonb) FROM PUBLIC,bar_local_runtime;
