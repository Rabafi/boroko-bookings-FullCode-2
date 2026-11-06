-- The original My Cash-up submits a blind physical count in one action.
-- Closing the operator shift and creating/resubmitting its cash-up must
-- commit together; no client-side close-then-submit sequence is required.
INSERT INTO bar_local.runtime_function_allowlist(function_name) VALUES ('cmd_cashup_handover') ON CONFLICT DO NOTHING;
CREATE FUNCTION bar_local.cmd_cashup_handover(
  p_token_hash text,p_device_id uuid,p_envelope jsonb,p_payload_hash text,p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb:=p_envelope->'payload';
  v_shift bar_local.shifts%ROWTYPE;
  v_cashup bar_local.cashups%ROWTYPE;
  v_expected numeric(14,2);
  v_counted numeric(14,2);
  v_before jsonb;
  v_financial jsonb;
  v_result jsonb;
  v_events jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx:=bar_local.current_session(p_token_hash,p_device_id,(p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint,(p_envelope->>'business_id')::uuid,(p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities,'pos.cashup');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx,p_envelope,p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status='committed' THEN
      RETURN jsonb_build_object('ok',true,'outcome','committed_local','replayed',true,'receipt',v_claim.receipt,'result',v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok',false,'outcome','refused','replayed',true,'error',v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF COALESCE(v_payload->>'counted_cash','') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
      OR COALESCE(v_payload->>'expected_shift_version','') !~ '^[1-9][0-9]{0,8}$'
      OR length(COALESCE(v_payload->>'notes',''))>2000 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED','Enter a non-negative physical cash count with up to two decimal places and refresh the shift before submitting.');
    END IF;
    v_counted:=(v_payload->>'counted_cash')::numeric;
    SELECT * INTO v_shift FROM bar_local.shifts WHERE id=(v_payload->>'shift_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_shift.business_id<>v_ctx.business_id OR v_shift.outlet_id<>v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED','The shift could not be found in this outlet.');
    END IF;
    IF v_shift.staff_id<>v_ctx.staff_id THEN
      PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH','Submit only your own physical cash count. Another operator must sign in to hand over their shift.');
    END IF;
    IF v_shift.version<>(v_payload->>'expected_shift_version')::integer THEN
      PERFORM bar_local.raise_business('SHIFT_VERSION_CONFLICT','This shift changed. Refresh its current state before submitting another cash-up.');
    END IF;
    SELECT * INTO v_cashup FROM bar_local.cashups WHERE shift_id=v_shift.id FOR UPDATE;
    IF FOUND AND v_cashup.status<>'rejected' THEN
      PERFORM bar_local.raise_business('CASHUP_ALREADY_REVIEWED','This cash-up is already submitted or approved. Refresh and recover the original handover.');
    END IF;
    IF EXISTS(SELECT 1 FROM bar_local.tabs WHERE business_id=v_ctx.business_id AND outlet_id=v_ctx.outlet_id
      AND owner_staff_id=v_ctx.staff_id AND status='open') THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN','Settle or transfer your open tabs before handing over the shift.');
    END IF;
    v_expected:=bar_local.expected_shift_cash(v_shift.id);
    v_before:=jsonb_build_object('shift_status',v_shift.status,'shift_version',v_shift.version,
      'cashup',CASE WHEN v_cashup.id IS NULL THEN NULL ELSE jsonb_build_object('cashup_id',v_cashup.id,
        'status',v_cashup.status,'counted_cash',v_cashup.counted_cash,'expected_cash',v_cashup.expected_cash,
        'variance',v_cashup.variance,'notes',v_cashup.notes,'reviewed_by',v_cashup.reviewed_by,
        'decision_reason',v_cashup.decision_reason,'operation_id',v_cashup.operation_id) END);
    UPDATE bar_local.shifts SET status='closed',closed_at=COALESCE(closed_at,now()),
      counted_cash=v_counted,expected_cash=v_expected,version=version+1 WHERE id=v_shift.id;
    IF v_cashup.id IS NULL THEN
      INSERT INTO bar_local.cashups(shift_id,business_id,outlet_id,submitted_by,counted_cash,expected_cash,
        variance,notes,proof_refs,operation_id)
      VALUES(v_shift.id,v_ctx.business_id,v_ctx.outlet_id,v_ctx.staff_id,v_counted,v_expected,
        v_counted-v_expected,v_payload->>'notes','[]'::jsonb,(p_envelope->>'operation_id')::uuid)
      RETURNING * INTO v_cashup;
    ELSE
      UPDATE bar_local.cashups SET submitted_by=v_ctx.staff_id,counted_cash=v_counted,expected_cash=v_expected,variance=v_counted-v_expected,
        notes=v_payload->>'notes',status='submitted',submitted_at=now(),reviewed_at=NULL,reviewed_by=NULL,
        decision_reason=NULL,review_operation_id=NULL,operation_id=(p_envelope->>'operation_id')::uuid
      WHERE id=v_cashup.id RETURNING * INTO v_cashup;
    END IF;
    v_financial:=jsonb_build_object('cashup_id',v_cashup.id,'shift_id',v_shift.id,'counted_cash',v_counted,
      'expected_cash',v_expected,'variance',v_counted-v_expected,'status','submitted');
    v_result:=jsonb_build_object('cashup_id',v_cashup.id,'shift_id',v_shift.id,'status','submitted',
      'counted_cash',v_counted,'shift_version',v_shift.version+1);
    PERFORM bar_local.audit_row(v_ctx.business_id,v_ctx.outlet_id,v_ctx.staff_id,v_ctx.device_id,
      'cashup.submitted',(p_envelope->>'operation_id')::uuid,v_before,v_financial);
    v_events:=jsonb_build_array(jsonb_build_object('event_type','cashup.submitted','payload',v_financial));
    IF v_shift.status='open' THEN
      PERFORM bar_local.audit_row(v_ctx.business_id,v_ctx.outlet_id,v_ctx.staff_id,v_ctx.device_id,
        'shift.closed',(p_envelope->>'operation_id')::uuid,jsonb_build_object('status','open','version',v_shift.version),
        jsonb_build_object('shift_id',v_shift.id,'status','closed','version',v_shift.version+1));
      v_events:=jsonb_build_array(jsonb_build_object('event_type','shift.closed','payload',
        jsonb_build_object('shift_id',v_shift.id,'status','closed')))||v_events;
    END IF;
    v_result:=bar_local.finish_committed((p_envelope->>'operation_id')::uuid,v_seq.commit_sequence,
      v_result,v_result,v_events,v_shift.business_date);
    RETURN jsonb_build_object('ok',true,'outcome','committed_local','receipt',v_result,'result',v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code=PG_EXCEPTION_DETAIL,v_message=MESSAGE_TEXT;
    v_error:=bar_local.record_refusal((p_envelope->>'operation_id')::uuid,v_code,v_message);
    RETURN jsonb_build_object('ok',false,'outcome','refused','error',v_error);
  END;
END;
$$;
ALTER FUNCTION bar_local.cmd_cashup_handover(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.cmd_cashup_handover(text,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_cashup_handover(text,uuid,jsonb,text,text) TO bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) RENAME TO query_dispatch_before_cashup_mine;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_cashup_mine(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.query_dispatch(
  p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_outlet uuid;
  v_shift bar_local.shifts%ROWTYPE;
  v_data jsonb;
  v_watermark bigint;
BEGIN
  IF p_query<>'cashup.mine' THEN
    RETURN bar_local.query_dispatch_before_cashup_mine(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  END IF;
  v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities,'pos.cashup');
  v_outlet:=bar_local.query_outlet(v_ctx,COALESCE(p_filters,'{}'::jsonb));
  SELECT * INTO v_shift FROM bar_local.shifts s WHERE s.business_id=v_ctx.business_id
    AND s.outlet_id=v_outlet AND s.staff_id=v_ctx.staff_id
    AND (NULLIF(p_filters->>'shift_id','') IS NULL OR s.id=(p_filters->>'shift_id')::uuid)
    ORDER BY (s.status='open') DESC,s.opened_at DESC,s.id DESC LIMIT 1;
  v_data:=jsonb_build_object('shift',CASE WHEN v_shift.id IS NULL THEN NULL ELSE
    jsonb_build_object('id',v_shift.id,'staff_id',v_shift.staff_id,'status',v_shift.status,'version',v_shift.version,
      'business_date',v_shift.business_date,'opening_float',v_shift.opening_float::text,'opened_at',v_shift.opened_at,'closed_at',v_shift.closed_at) END,
    'submission',(SELECT jsonb_build_object('id',c.id,'shift_id',c.shift_id,'status',c.status,
      'counted_by_method',jsonb_build_object('cash',c.counted_cash::text),'notes',c.notes,
      'review_notes',c.decision_reason,'submitted_at',c.submitted_at,'operation_id',c.operation_id)
      FROM bar_local.cashups c WHERE c.shift_id=v_shift.id));
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  RETURN jsonb_build_object('data',v_data,'pagination',jsonb_build_object('next_cursor',NULL,'has_more',false),
    'snapshot_watermark',COALESCE(v_watermark,0),'scope',jsonb_build_object('business_id',v_ctx.business_id,
      'outlet_id',v_outlet,'actor_staff_id',v_ctx.staff_id,'role',v_ctx.role,'device_id',v_ctx.device_id),
    'as_of',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'complete',true,'unavailable','[]'::jsonb);
END;
$$;
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
