CREATE FUNCTION bar_local.query_finance_records(
 p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
 v_ctx bar_local.session_context;
 v_outlet uuid;
 v_kind text:=p_filters->>'kind';
 v_limit integer;
 v_data jsonb;
 v_next text;
 v_more boolean:=false;
 v_scope text;
BEGIN
 v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
 PERFORM bar_local.assert_capability(v_ctx.capabilities,'accounting.read');
 PERFORM bar_local.assert_feature('bar_accounting_workforce');
 v_outlet:=bar_local.query_outlet(v_ctx,p_filters);
 v_limit:=bar_local.query_limit(p_filters);
 IF v_kind IS NULL OR v_kind NOT IN ('ap_invoices','ap_payments','bank_accounts','bank_statement_lines',
  'bank_reconciliations','tax_codes','tax_return_periods','payroll_runs','budgets','journal_entries','suppliers') THEN
  PERFORM bar_local.raise_business('VALIDATION_FAILED','Choose a supported local finance record list.');
 END IF;
 IF v_kind='payroll_runs' THEN
  PERFORM bar_local.assert_capability(v_ctx.capabilities,'accounting.manage');
 END IF;
 v_scope:=CASE WHEN v_kind='tax_codes' THEN ' AND r.version=(SELECT max(t.version) FROM bar_local.tax_codes t WHERE t.business_id=r.business_id AND t.code=r.code)'
  WHEN v_kind='suppliers' THEN ''
  WHEN v_kind='journal_entries' THEN ' AND EXISTS (SELECT 1 FROM bar_local.operations o WHERE o.operation_id=r.operation_id AND o.business_id=$1 AND o.outlet_id=$2)'
  ELSE ' AND r.outlet_id=$2' END;
 -- Table names come exclusively from the allowlist above. Identifiers are quoted;
 -- every scope, cursor and record value remains a bound parameter.
 EXECUTE format($q$
  SELECT COALESCE(jsonb_agg(x.document ORDER BY x.id),'[]'::jsonb) FROM (
   SELECT r.id,(SELECT jsonb_object_agg(e.key,
    CASE WHEN jsonb_typeof(e.value)='number' AND e.key NOT IN ('version','revision')
     THEN to_jsonb(e.value #>> '{}') ELSE e.value END)
    FROM jsonb_each(to_jsonb(r)-'snapshot') e) AS document
   FROM bar_local.%I r WHERE r.business_id=$1 %s
    AND ($3::text IS NULL OR r.id::text>$3)
    AND ($4::uuid IS NULL OR r.id=$4)
   ORDER BY r.id LIMIT $5
  ) x
 $q$,v_kind,v_scope) INTO v_data
 USING v_ctx.business_id,v_outlet,p_filters->>'cursor',NULLIF(p_filters->>'record_id','')::uuid,v_limit+1;
 IF jsonb_array_length(v_data)>v_limit THEN
  v_data:=v_data-v_limit;v_more:=true;v_next:=v_data->-1->>'id';
 END IF;
 IF NULLIF(p_filters->>'record_id','') IS NOT NULL AND jsonb_array_length(v_data)=1 THEN
  IF v_kind='ap_invoices' THEN
   v_data:=jsonb_set(v_data,'{0,lines}',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'description',l.description,'expense_account_code',l.expense_account_code,'quantity',l.quantity::text,
    'unit_price',l.unit_price::text,'tax_rate',l.tax_rate::text) ORDER BY l.line_number),'[]'::jsonb)
    FROM bar_local.ap_invoice_lines l WHERE l.ap_invoice_id=(v_data->0->>'id')::uuid));
  ELSIF v_kind='budgets' THEN
   v_data:=jsonb_set(v_data,'{0,lines}',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'account_code',l.account_code,'amount',l.amount::text,'description',l.description) ORDER BY l.line_number),'[]'::jsonb)
    FROM bar_local.budget_lines l WHERE l.budget_id=(v_data->0->>'id')::uuid
      AND l.budget_version=(v_data->0->>'version')::integer));
  END IF;
 END IF;
 RETURN jsonb_build_object('data',v_data,'complete',true,'unavailable','[]'::jsonb,
  'pagination',jsonb_build_object('has_more',v_more,'next_cursor',v_next),
  'snapshot_watermark',(SELECT commit_sequence FROM bar_local.authority_counter WHERE singleton),
  'scope',jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_outlet,
   'device_id',v_ctx.device_id,'actor_staff_id',v_ctx.staff_id),
  'as_of',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_finance_records(text,uuid,uuid,bigint,jsonb) FROM PUBLIC,bar_local_runtime;
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) RENAME TO query_dispatch_before_finance_records;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_finance_records(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.query_dispatch(
 p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
BEGIN
 IF p_query='accounting.records' THEN
  RETURN bar_local.query_finance_records(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_filters);
 END IF;
 RETURN bar_local.query_dispatch_before_finance_records(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
