CREATE FUNCTION bar_local.query_tip_payouts(
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
  SELECT p.id,p.staff_id,s.display_name,p.shift_id,p.amount::text AS amount,p.status,p.reason,p.paid_at,p.reversed_at
  FROM bar_local.tip_payouts p JOIN bar_local.staff s ON s.id=p.staff_id AND s.business_id=p.business_id
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
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) RENAME TO query_dispatch_before_tip_payout_reads;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_tip_payout_reads(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.query_dispatch(
 p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
BEGIN
 IF p_query='workforce.tip_payouts' THEN
  RETURN bar_local.query_tip_payouts(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_filters);
 END IF;
 RETURN bar_local.query_dispatch_before_tip_payout_reads(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
