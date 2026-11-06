-- Cashiers must not receive expected/actual reconciliation values from
-- general shift or cash-up summary queries. The original My Shift screen now
-- uses cashup.mine for the safe own-shift projection.
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) RENAME TO query_dispatch_before_blind_cashup;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_blind_cashup(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;

CREATE FUNCTION bar_local.query_dispatch(
  p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_result jsonb;
  v_data jsonb;
BEGIN
  IF p_query NOT IN ('shift.current','cashup.summary') THEN
    RETURN bar_local.query_dispatch_before_blind_cashup(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  END IF;
  v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
  v_result:=bar_local.query_dispatch_before_blind_cashup(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  v_data:=v_result->'data';
  IF v_data IS NULL OR jsonb_typeof(v_data)<>'object' THEN RETURN v_result; END IF;
  IF p_query='shift.current' THEN
    v_data:=v_data-'expected_cash'-'counted_cash'-'variance'-'counted_card';
  ELSIF v_ctx.role NOT IN ('owner','manager') THEN
    v_data:=v_data-'expected_cash'-'cash_sales'-'card_sales'-'cash_movements'-'cashup';
  END IF;
  RETURN jsonb_set(v_result,'{data}',v_data,true);
END;
$$;
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
