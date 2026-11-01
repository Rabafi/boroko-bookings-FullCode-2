-- Handover selection exposes identities, never another operator's cash balance.
CREATE FUNCTION bar_local.query_open_drawers(
 p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
 v_ctx bar_local.session_context;v_outlet uuid;v_limit integer;v_data jsonb;v_more boolean:=false;v_next text;
BEGIN
 v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
 PERFORM bar_local.assert_capability(v_ctx.capabilities,'pos.cashup');
 v_outlet:=bar_local.query_outlet(v_ctx,p_filters);v_limit:=bar_local.query_limit(p_filters);
 SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.shift_id),'[]'::jsonb) INTO v_data FROM (
  SELECT d.id AS shift_id,d.staff_id,s.display_name,d.opened_at
  FROM bar_local.shifts d JOIN bar_local.staff s ON s.id=d.staff_id AND s.business_id=d.business_id
  WHERE d.business_id=v_ctx.business_id AND d.outlet_id=v_outlet AND d.status='open'
   AND d.staff_id<>v_ctx.staff_id AND s.status='active' AND s.capabilities @> ARRAY['pos.cashup']
   AND (p_filters->>'cursor' IS NULL OR d.id::text>p_filters->>'cursor')
  ORDER BY d.id LIMIT v_limit+1
 ) x;
 IF jsonb_array_length(v_data)>v_limit THEN
  v_data:=v_data-v_limit;v_more:=true;v_next:=v_data->-1->>'shift_id';
 END IF;
 RETURN jsonb_build_object('data',v_data,'complete',true,'unavailable','[]'::jsonb,
  'pagination',jsonb_build_object('has_more',v_more,'next_cursor',v_next),
  'snapshot_watermark',(SELECT commit_sequence FROM bar_local.authority_counter WHERE singleton),
  'scope',jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_outlet,'device_id',v_ctx.device_id,'actor_staff_id',v_ctx.staff_id),
  'as_of',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_open_drawers(text,uuid,uuid,bigint,jsonb) FROM PUBLIC,bar_local_runtime;
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) RENAME TO query_dispatch_before_open_drawers;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_open_drawers(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.query_dispatch(
 p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
BEGIN
 IF p_query='drawer.open_shifts' THEN
  RETURN bar_local.query_open_drawers(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_filters);
 END IF;
 RETURN bar_local.query_dispatch_before_open_drawers(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
