-- The original Accounting Pro payroll screen needs to review the opaque line
-- references and amounts before a manager prepares or finalises a run. Keep
-- the generic payroll-run list summary-only, and expose lines only through the
-- already manager-gated, business/outlet-scoped record detail query.
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb)
  RENAME TO query_dispatch_before_payroll_run_detail;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_payroll_run_detail(text,uuid,uuid,bigint,text,jsonb)
  FROM PUBLIC,bar_local_runtime;

CREATE FUNCTION bar_local.query_dispatch(
  p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_result jsonb;
  v_run_id uuid;
  v_business_id uuid;
  v_outlet_id uuid;
  v_lines jsonb;
BEGIN
  v_result:=bar_local.query_dispatch_before_payroll_run_detail(
    p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  IF p_query='accounting.records'
     AND p_filters->>'kind'='payroll_runs'
     AND NULLIF(p_filters->>'record_id','') IS NOT NULL
     AND jsonb_typeof(v_result->'data')='array' THEN
    IF jsonb_array_length(v_result->'data')=1 THEN
      v_run_id:=(v_result->'data'->0->>'id')::uuid;
      v_business_id:=(v_result->'scope'->>'business_id')::uuid;
      v_outlet_id:=(v_result->'scope'->>'outlet_id')::uuid;
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'employee_ref',line.employee_ref,
        'gross',line.gross::text,
        'deductions',line.deductions::text,
        'net',line.net::text
      ) ORDER BY line.line_number),'[]'::jsonb)
        INTO v_lines
        FROM bar_local.payroll_lines line
        JOIN bar_local.payroll_runs run ON run.id=line.payroll_run_id
       WHERE run.id=v_run_id AND run.business_id=v_business_id AND run.outlet_id=v_outlet_id;
      v_result:=jsonb_set(v_result,'{data,0,lines}',v_lines,true);
    END IF;
  END IF;
  RETURN v_result;
END;
$$;

ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
