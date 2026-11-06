-- Authenticated local pending-cash-up query used by the established Hpos
-- Cash & Close page. The projection is outlet scoped, complete when paged,
-- and never includes unsubmitted or already-reviewed submissions.
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb)
  RENAME TO query_dispatch_before_cashup_review_list;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_cashup_review_list(text,uuid,uuid,bigint,text,jsonb)
  FROM PUBLIC,bar_local_runtime;

CREATE FUNCTION bar_local.query_dispatch(
  p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb;
  v_outlet uuid;
  v_limit integer;
  v_cursor uuid;
  v_data jsonb;
  v_has_more boolean:=false;
  v_next text;
  v_watermark bigint;
  v_as_of text;
BEGIN
  IF p_query='cashup.pending' THEN
    v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
    PERFORM bar_local.assert_capability(v_ctx.capabilities,'pos.cashup');
    IF v_ctx.role NOT IN ('owner','manager') THEN
      PERFORM bar_local.raise_business('CAPABILITY_DENIED','Only an authorised owner or manager can read the cash-up review queue.');
    END IF;
    v_filters:=COALESCE(p_filters,'{}'::jsonb);
    v_outlet:=bar_local.query_outlet(v_ctx,v_filters);
    v_limit:=bar_local.query_limit(v_filters);
    IF NULLIF(v_filters->>'cursor','') IS NOT NULL THEN
      IF (v_filters->>'cursor') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED','The cash-up review cursor is invalid. Refresh the list.');
      END IF;
      v_cursor:=(v_filters->>'cursor')::uuid;
    END IF;
    SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
    v_as_of:=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.cashup_id),'[]'::jsonb) INTO v_data
      FROM (
        SELECT c.id AS cashup_id,c.shift_id,c.submitted_by AS staff_id,st.display_name AS cashier_name,
               c.counted_cash::text AS counted_cash,c.expected_cash::text AS expected_cash,
               c.variance::text AS variance,c.counted_card::text AS counted_card,c.status,c.notes,
               c.submitted_at,c.proof_refs,s.business_date,s.opening_float::text AS opening_float,
               s.closed_at,s.version AS shift_version
          FROM bar_local.cashups c
          JOIN bar_local.staff st ON st.id=c.submitted_by AND st.business_id=c.business_id
          JOIN bar_local.shifts s ON s.id=c.shift_id AND s.business_id=c.business_id AND s.outlet_id=c.outlet_id
         WHERE c.business_id=v_ctx.business_id AND c.outlet_id=v_outlet AND c.status='submitted'
           AND (v_cursor IS NULL OR c.id>v_cursor)
         ORDER BY c.id LIMIT v_limit+1
      ) x;
    IF jsonb_array_length(v_data)>v_limit THEN
      v_data:=v_data-v_limit;
      v_has_more:=true;
      v_next:=v_data->-1->>'cashup_id';
    END IF;
    RETURN jsonb_build_object(
      'data',v_data,'pagination',jsonb_build_object('next_cursor',v_next,'has_more',v_has_more),
      'snapshot_watermark',COALESCE(v_watermark,0),
      'scope',jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_outlet,
        'actor_staff_id',v_ctx.staff_id,'role',v_ctx.role,'device_id',v_ctx.device_id),
      'as_of',v_as_of,'complete',true,'unavailable','[]'::jsonb
    );
  END IF;
  RETURN bar_local.query_dispatch_before_cashup_review_list(
    p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
END;
$$;
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
