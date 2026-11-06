-- Repair older authenticated query producers without changing their data
-- semantics. Role is derived from the service session and only fills an
-- omitted/null field; a conflicting producer is rejected.
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb)
  RENAME TO query_dispatch_before_result_contract_repairs;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_result_contract_repairs(text,uuid,uuid,bigint,text,jsonb)
  FROM PUBLIC,bar_local_runtime;

CREATE FUNCTION bar_local.query_dispatch(
  p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_result jsonb;
  v_scope jsonb;
  v_role jsonb;
  v_filters jsonb;
  v_limit integer;
  v_data jsonb;
  v_has_more boolean:=false;
  v_next text;
  v_cursor uuid;
  v_search text;
  v_watermark bigint;
  v_as_of text;
BEGIN
  -- The historical customers.list predicate mixed JSON extraction and text
  -- concatenation without parentheses; PostgreSQL could parse '%' as JSON.
  -- Keep this authenticated query on its original projection and cursor
  -- semantics while using an unambiguous local implementation.
  IF p_query='customers.list' THEN
    v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
    PERFORM bar_local.assert_capability(v_ctx.capabilities,'customers.manage');
    v_filters:=COALESCE(p_filters,'{}'::jsonb);
    v_limit:=bar_local.query_limit(v_filters);
    v_search:=NULLIF(v_filters->>'search','');
    IF v_search IS NOT NULL AND length(v_search)>200 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED','Customer search is longer than 200 characters.');
    END IF;
    IF NULLIF(v_filters->>'cursor','') IS NOT NULL THEN
      IF (v_filters->>'cursor') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED','The customer list cursor is invalid. Refresh the list.');
      END IF;
      v_cursor:=(v_filters->>'cursor')::uuid;
    END IF;
    SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
    v_as_of:=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.customer_id),'[]'::jsonb) INTO v_data
      FROM (
        SELECT c.id AS customer_id,c.name,c.phone,c.email,c.credit_limit,c.status,
               COALESCE((SELECT round(sum(cl.delta),2) FROM bar_local.credit_ledger cl WHERE cl.customer_id=c.id),0) AS outstanding
          FROM bar_local.customers c
         WHERE c.business_id=v_ctx.business_id
           AND (v_search IS NULL OR c.name ILIKE ('%'||v_search||'%') OR COALESCE(c.phone,'') ILIKE ('%'||v_search||'%'))
           AND (v_cursor IS NULL OR c.id>v_cursor)
         ORDER BY c.id LIMIT v_limit+1
      ) x;
    IF jsonb_array_length(v_data)>v_limit THEN
      v_data:=v_data-v_limit;
      v_has_more:=true;
      v_next:=v_data->-1->>'customer_id';
    END IF;
    RETURN jsonb_build_object(
      'data',v_data,'pagination',jsonb_build_object('next_cursor',v_next,'has_more',v_has_more),
      'snapshot_watermark',COALESCE(v_watermark,0),
      'scope',jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_ctx.outlet_id,
        'actor_staff_id',v_ctx.staff_id,'role',v_ctx.role,'device_id',v_ctx.device_id),
      'as_of',v_as_of,'complete',true,'unavailable','[]'::jsonb
    );
  END IF;
  v_result:=bar_local.query_dispatch_before_result_contract_repairs(
    p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
  v_scope:=v_result->'scope';
  IF jsonb_typeof(v_scope) IS DISTINCT FROM 'object' THEN
    PERFORM bar_local.raise_business('INTERNAL_ERROR','The local query did not return authenticated scope metadata.');
  END IF;
  v_role:=v_scope->'role';
  IF v_role IS NULL OR v_role='null'::jsonb THEN
    v_result:=jsonb_set(v_result,'{scope,role}',to_jsonb(v_ctx.role),true);
  ELSIF jsonb_typeof(v_role) IS DISTINCT FROM 'string' OR v_role #>> '{}' IS DISTINCT FROM v_ctx.role THEN
    PERFORM bar_local.raise_business('TENANT_SCOPE_MISMATCH','The local query returned a conflicting authenticated role.');
  END IF;
  RETURN v_result;
END;
$$;
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;

-- An empty event outbox has no MAX row. The event watermark is therefore
-- zero, while latest_commit_sequence remains the authority-wide commit cursor.
CREATE OR REPLACE FUNCTION bar_local.service_events(
  p_token_hash text,p_device_id uuid,p_after_sequence bigint DEFAULT 0,p_limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context:=bar_local.service_session(p_token_hash,p_device_id);
  v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,200),1),1000);
  v_events jsonb;
  v_count integer;
  v_next bigint;
  v_latest bigint;
  v_latest_event bigint;
  v_floor bigint;
BEGIN
  IF p_after_sequence IS NULL OR p_after_sequence<0 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED','The event cursor must be zero or a non-negative commit sequence.');
  END IF;
  SELECT commit_sequence INTO v_latest FROM bar_local.authority_counter WHERE singleton;
  SELECT COALESCE(max(commit_sequence),0),min(commit_sequence)
    INTO v_latest_event,v_floor FROM bar_local.outbox
   WHERE business_id=v_ctx.business_id AND outlet_id=v_ctx.outlet_id;
  WITH page_sequences AS (
    SELECT DISTINCT o.commit_sequence FROM bar_local.outbox o
     WHERE o.business_id=v_ctx.business_id AND o.outlet_id=v_ctx.outlet_id
       AND o.commit_sequence>p_after_sequence ORDER BY o.commit_sequence LIMIT v_limit
  ), page_events AS (
    SELECT o.commit_sequence,o.event_index,o.event_type,o.operation_id,o.payload,o.payload_hash,o.created_at
      FROM bar_local.outbox o JOIN page_sequences p USING(commit_sequence)
     WHERE o.business_id=v_ctx.business_id AND o.outlet_id=v_ctx.outlet_id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.commit_sequence,x.event_index),'[]'::jsonb),count(*)
    INTO v_events,v_count FROM page_events x;
  SELECT max((value->>'commit_sequence')::bigint) INTO v_next FROM jsonb_array_elements(v_events);
  RETURN jsonb_build_object(
    'events',v_events,'event_count',v_count,'next_cursor',COALESCE(v_next,p_after_sequence),
    'latest_commit_sequence',COALESCE(v_latest,0),'latest_event_sequence',COALESCE(v_latest_event,0),
    'retention_floor_sequence',v_floor,
    'gap_detected',p_after_sequence>0 AND v_floor IS NOT NULL AND p_after_sequence<v_floor-1,
    'complete',COALESCE(v_next,p_after_sequence)>=COALESCE(v_latest_event,0),
    'scope',jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_ctx.outlet_id,'device_id',v_ctx.device_id)
  );
END;
$$;
ALTER FUNCTION bar_local.service_events(text,uuid,bigint,integer) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.service_events(text,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.service_events(text,uuid,bigint,integer) TO bar_local_runtime;
