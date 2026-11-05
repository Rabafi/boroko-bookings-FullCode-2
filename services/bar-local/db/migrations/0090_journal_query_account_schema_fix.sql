-- Repair the journal query against the current global account-code schema. Journal rows remain scoped through their business and outlet operations; the shared account catalogue has no business_id column.
-- The original Accounting Pro ledger needs immutable journal detail. Scope every
-- row through its originating local operation so entries cannot cross outlets.
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb)
  RENAME TO query_dispatch_before_account_join_repair;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_account_join_repair(text,uuid,uuid,bigint,text,jsonb)
  FROM PUBLIC,bar_local_runtime;

CREATE FUNCTION bar_local.query_dispatch(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_query text,
  p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb:=COALESCE(p_filters,'{}'::jsonb);
  v_from date;
  v_to date;
  v_cursor_date date;
  v_cursor_id uuid;
  v_limit integer;
  v_count integer;
  v_data jsonb;
  v_more boolean:=false;
  v_next text;
  v_watermark bigint;
  v_account_code text;
BEGIN
  IF p_query NOT IN ('accounting.journal_entries','accounting.trial_balance') THEN
    RETURN bar_local.query_dispatch_before_account_join_repair(
      p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters
    );
  END IF;

  v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities,'accounting.read');
  PERFORM bar_local.assert_feature('bar_accounting_workforce');
  v_from:=COALESCE(NULLIF(v_filters->>'from','')::date,date '1970-01-01');
  v_to:=COALESCE(NULLIF(v_filters->>'to','')::date,bar_local.current_business_date());
  IF v_to<v_from THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED','The ledger end date cannot be before its start date.');
  END IF;
  IF p_query='accounting.trial_balance' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'account_code',x.account_code,'name',x.name,'type',x.type,
      'debit',x.debit::text,'credit',x.credit::text,'balance',x.balance::text
    ) ORDER BY x.account_code),'[]'::jsonb)
      INTO v_data
      FROM (
        SELECT aa.code AS account_code,aa.name,aa.type,
          COALESCE(round(sum(lines.debit),2),0) AS debit,
          COALESCE(round(sum(lines.credit),2),0) AS credit,
          COALESCE(round(sum(lines.debit-lines.credit),2),0) AS balance
        FROM bar_local.accounting_accounts aa
        LEFT JOIN (
          SELECT line.account_code,line.debit,line.credit
          FROM bar_local.journal_lines line
          JOIN bar_local.journal_entries entry ON entry.id=line.entry_id
          JOIN bar_local.operations operation ON operation.operation_id=entry.operation_id
          WHERE entry.business_id=v_ctx.business_id
            AND operation.business_id=v_ctx.business_id
            AND operation.outlet_id=v_ctx.outlet_id
            AND entry.entry_date BETWEEN v_from AND v_to
        ) lines ON lines.account_code=aa.code
        WHERE aa.active
        GROUP BY aa.code,aa.name,aa.type
      ) x;
    SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
    RETURN jsonb_build_object(
      'data',v_data,
      'pagination',jsonb_build_object('next_cursor',NULL,'has_more',false),
      'snapshot_watermark',COALESCE(v_watermark,0),
      'scope',jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_ctx.outlet_id,
        'actor_staff_id',v_ctx.staff_id,'role',v_ctx.role,'device_id',v_ctx.device_id),
      'as_of',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'complete',true,
      'unavailable','[]'::jsonb
    );
  END IF;
  v_account_code:=NULLIF(btrim(v_filters->>'account_code'),'');
  IF NULLIF(v_filters->>'cursor','') IS NOT NULL THEN
    IF v_filters->>'cursor' !~ '^\d{4}-\d{2}-\d{2}\|[0-9a-fA-F-]{36}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED','The journal cursor is invalid. Refresh the ledger before continuing.');
    END IF;
    v_cursor_date:=split_part(v_filters->>'cursor','|',1)::date;
    v_cursor_id:=split_part(v_filters->>'cursor','|',2)::uuid;
  END IF;
  v_limit:=bar_local.query_limit(v_filters,50,200);

  SELECT COALESCE(jsonb_agg(x.document ORDER BY x.entry_date DESC,x.id DESC),'[]'::jsonb),count(*)
    INTO v_data,v_count
    FROM (
      SELECT j.id,j.entry_date,jsonb_build_object(
        'id',j.id,
        'entry_date',j.entry_date,
        'description',j.memo,
        'source_type',j.source_type,
        'source_id',j.source_id,
        'posting_key',j.operation_id,
        'reference_number',j.source_id,
        'lines',COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',line.id::text,
            'account_code',line.account_code,
            'account_name',account.name,
            'debit',line.debit::text,
            'credit',line.credit::text,
            'description',line.description
          ) ORDER BY line.id)
          FROM bar_local.journal_lines line
          JOIN bar_local.accounting_accounts account
            ON account.code=line.account_code
          WHERE line.entry_id=j.id
        ),'[]'::jsonb)
      ) AS document
      FROM bar_local.journal_entries j
      WHERE j.business_id=v_ctx.business_id
        AND j.entry_date BETWEEN v_from AND v_to
        AND (v_cursor_date IS NULL OR (j.entry_date,j.id)<(v_cursor_date,v_cursor_id))
        AND (v_account_code IS NULL OR EXISTS(
          SELECT 1 FROM bar_local.journal_lines filter_line
           WHERE filter_line.entry_id=j.id AND filter_line.account_code=v_account_code
        ))
        AND EXISTS(
          SELECT 1 FROM bar_local.operations operation
           WHERE operation.operation_id=j.operation_id
             AND operation.business_id=v_ctx.business_id
             AND operation.outlet_id=v_ctx.outlet_id
        )
      ORDER BY j.entry_date DESC,j.id DESC
      LIMIT v_limit+1
    ) x;

  IF v_count>v_limit THEN
    v_data:=v_data-v_limit;
    v_more:=true;
    v_next:=(v_data->-1->>'entry_date')||'|'||(v_data->-1->>'id');
  END IF;
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  RETURN jsonb_build_object(
    'data',v_data,
    'pagination',jsonb_build_object('next_cursor',v_next,'has_more',v_more),
    'snapshot_watermark',COALESCE(v_watermark,0),
    'scope',jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_ctx.outlet_id,
      'actor_staff_id',v_ctx.staff_id,'role',v_ctx.role,'device_id',v_ctx.device_id),
    'as_of',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'complete',true,
    'unavailable','[]'::jsonb
  );
END;
$$;

ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
