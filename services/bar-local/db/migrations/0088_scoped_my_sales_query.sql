-- My Sales must read only receipts assigned to the authenticated staff member.
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) RENAME TO query_dispatch_before_sales_mine;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_sales_mine(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;

CREATE FUNCTION bar_local.query_dispatch(
  p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb:=COALESCE(p_filters,'{}'::jsonb);
  v_from date;
  v_to date;
  v_cursor_date date;
  v_cursor_receipt bigint;
  v_limit integer;
  v_count integer;
  v_data jsonb;
  v_more boolean:=false;
  v_next text;
  v_watermark bigint;
BEGIN
  IF p_query<>'sales.mine' THEN
    RETURN bar_local.query_dispatch_before_sales_mine(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  END IF;
  v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities,'pos.view');
  v_from:=COALESCE(NULLIF(v_filters->>'from','')::date,bar_local.current_business_date()-6);
  v_to:=COALESCE(NULLIF(v_filters->>'to','')::date,bar_local.current_business_date());
  IF v_to<v_from THEN PERFORM bar_local.raise_business('VALIDATION_FAILED','The sales end date cannot be before its start date.'); END IF;
  IF NULLIF(v_filters->>'cursor','') IS NOT NULL THEN
    v_cursor_date:=split_part(v_filters->>'cursor','|',1)::date;
    v_cursor_receipt:=split_part(v_filters->>'cursor','|',2)::bigint;
  END IF;
  v_limit:=bar_local.query_limit(v_filters,50,200);
  SELECT COALESCE(jsonb_agg(x.row_data ORDER BY x.business_date DESC,x.receipt_number DESC),'[]'::jsonb),count(*)
    INTO v_data,v_count
    FROM (
      SELECT s.business_date,s.receipt_number,
        jsonb_build_object(
          'id',s.id,'sale_id',s.id,'receipt_number',s.receipt_number::text,'receipt_series',s.receipt_series,
          'business_date',s.business_date,'status',s.status,
          'transaction_type',CASE WHEN s.original_sale_id IS NOT NULL OR s.total<0 THEN 'return' WHEN s.status='voided' THEN 'void' ELSE NULL END,
          'subtotal',s.subtotal,'discount',s.discount,'tax',s.tax,'tip_total',s.tip,'total',s.total,
          'created_at',s.created_at,'original_sale_id',s.original_sale_id,'actor_staff_id',s.actor_staff_id,
          'table_name',t.table_label,'service_mode',COALESCE(t.table_label,'Counter'),
          'payment_breakdown',(SELECT COALESCE(jsonb_agg(jsonb_build_object('method',st.method,'amount',st.amount) ORDER BY st.id),'[]'::jsonb)
            FROM bar_local.sale_tenders st WHERE st.sale_id=s.id),
          'pos_order_items',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',sl.id,'product_id',sl.product_id,
              'item_name',sl.name_snapshot,'quantity',sl.quantity,'unit_price',sl.unit_price,
              'subtotal',sl.line_subtotal,'net_subtotal',sl.line_total,'notes',sl.notes) ORDER BY sl.line_number),'[]'::jsonb)
            FROM bar_local.sale_lines sl WHERE sl.sale_id=s.id)
        ) AS row_data
      FROM bar_local.sales s
      LEFT JOIN bar_local.tabs t ON t.id=s.tab_id AND t.business_id=s.business_id AND t.outlet_id=s.outlet_id
      WHERE s.business_id=v_ctx.business_id AND s.outlet_id=v_ctx.outlet_id AND s.actor_staff_id=v_ctx.staff_id
        AND s.business_date BETWEEN v_from AND v_to
        AND (v_cursor_date IS NULL OR (s.business_date,s.receipt_number)<(v_cursor_date,v_cursor_receipt))
      ORDER BY s.business_date DESC,s.receipt_number DESC LIMIT v_limit+1
    ) x;
  IF v_count>v_limit THEN
    v_data:=v_data-(v_count-1);
    v_more:=true;
    v_next:=(v_data->-1->>'business_date')||'|'||(v_data->-1->>'receipt_number');
  END IF;
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  RETURN jsonb_build_object('data',v_data,'pagination',jsonb_build_object('next_cursor',v_next,'has_more',v_more),
    'snapshot_watermark',COALESCE(v_watermark,0),'scope',jsonb_build_object('business_id',v_ctx.business_id,
      'outlet_id',v_ctx.outlet_id,'actor_staff_id',v_ctx.staff_id,'role',v_ctx.role,'device_id',v_ctx.device_id),
    'as_of',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'complete',true,'unavailable','[]'::jsonb);
END;
$$;
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
