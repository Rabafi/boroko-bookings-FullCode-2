-- Original HposStock contracts. One batch is one operation/transaction; a
-- stale line refuses the entire count and never overwrites intervening sales.
CREATE OR REPLACE FUNCTION bar_local.cmd_stock_batch_record(
  p_token_hash text,p_device_id uuid,p_envelope jsonb,p_payload_hash text,p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context; v_claim record; v_seq record;
  v_payload jsonb:=p_envelope->'payload'; v_mode text:=v_payload->>'mode';
  v_line jsonb; v_product bar_local.products%ROWTYPE; v_current numeric(18,6);
  v_quantity numeric(18,6); v_delta numeric(18,6); v_version integer; v_inserted boolean;
  v_before jsonb:='[]'::jsonb; v_lines jsonb:='[]'::jsonb; v_events jsonb:='[]'::jsonb;
  v_result jsonb; v_receipt jsonb; v_code text; v_message text; v_error jsonb;
BEGIN
  v_ctx:=bar_local.current_session(p_token_hash,p_device_id,(p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint,(p_envelope->>'business_id')::uuid,(p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities,'inventory.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx,p_envelope,p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status='committed' THEN
      RETURN jsonb_build_object('ok',true,'outcome','committed_local','replayed',true,'receipt',v_claim.receipt,'result',v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok',false,'outcome','refused','replayed',true,'error',v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF v_mode NOT IN ('receive','count') OR v_mode IS NULL OR jsonb_typeof(v_payload->'lines') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_payload->'lines') NOT BETWEEN 1 AND 200 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED','Choose a delivery or physical count containing between 1 and 200 items.');
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(v_payload->'lines')) <>
       (SELECT count(DISTINCT x->>'product_id') FROM jsonb_array_elements(v_payload->'lines') x) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED','Each stock item must appear exactly once in this operation.');
    END IF;
    -- Always acquire product and balance locks in product-ID order.
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_payload->'lines') ORDER BY value->>'product_id' LOOP
      SELECT * INTO v_product FROM bar_local.products
       WHERE id=(v_line->>'product_id')::uuid AND business_id=v_ctx.business_id FOR SHARE;
      IF NOT FOUND OR NOT v_product.track_stock OR NOT v_product.active THEN
        PERFORM bar_local.raise_business('STOCK_ITEM_NOT_FOUND','A counted stock item is unavailable in this Bar. Refresh Stock before posting.');
      END IF;
      v_quantity:=(v_line->>'quantity')::numeric;
      IF v_quantity IS NULL OR v_quantity<0 OR (v_line->>'quantity')::numeric<>v_quantity OR (v_mode='receive' AND v_quantity=0)
         OR length(btrim(COALESCE(v_line->>'reason','')))=0 OR length(v_line->>'reason')>500 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED','Every line needs a valid quantity and a stock note of 1 to 500 characters.');
      END IF;
      SELECT quantity,version INTO v_current,v_version FROM bar_local.stock_balances
       WHERE business_id=v_ctx.business_id AND outlet_id=v_ctx.outlet_id AND product_id=v_product.id FOR UPDATE;
      IF NOT FOUND THEN
        -- A concurrent first receipt may create this row. Lock and verify the
        -- resulting version instead of trusting the pre-insert absence.
        v_inserted:=false;
        INSERT INTO bar_local.stock_balances(business_id,outlet_id,product_id,quantity)
        VALUES(v_ctx.business_id,v_ctx.outlet_id,v_product.id,0) ON CONFLICT DO NOTHING RETURNING true INTO v_inserted;
        SELECT quantity,version INTO v_current,v_version FROM bar_local.stock_balances
         WHERE business_id=v_ctx.business_id AND outlet_id=v_ctx.outlet_id AND product_id=v_product.id FOR UPDATE;
        IF v_mode='count' AND v_inserted IS TRUE AND (v_line->>'expected_stock_version')::integer=0 THEN
          -- New empty balance corresponds to the certified absent baseline.
          v_version:=0;
        END IF;
      END IF;
      IF v_mode='count' AND (NULLIF(v_line->>'expected_stock_version','') IS NULL
         OR (v_line->>'expected_stock_version')::integer<>v_version) THEN
        PERFORM bar_local.raise_business('STOCK_VERSION_CONFLICT','Stock changed after this count sheet was loaded. Refresh all items and review the physical count; no lines were posted.');
      END IF;
      v_delta:=CASE WHEN v_mode='count' THEN v_quantity-v_current ELSE v_quantity END;
      v_before:=v_before||jsonb_build_array(jsonb_build_object('product_id',v_product.id,'quantity',v_current::text,'version',v_version));
      IF v_delta<>0 THEN
        UPDATE bar_local.stock_balances SET quantity=quantity+v_delta,version=version+1,updated_at=now()
         WHERE business_id=v_ctx.business_id AND outlet_id=v_ctx.outlet_id AND product_id=v_product.id;
        INSERT INTO bar_local.stock_movements(business_id,outlet_id,product_id,delta,reason,operation_id,business_date,reference)
        VALUES(v_ctx.business_id,v_ctx.outlet_id,v_product.id,v_delta,CASE WHEN v_mode='count' THEN 'stock.stocktake' ELSE 'stock.receive' END,
          (p_envelope->>'operation_id')::uuid,bar_local.current_business_date(),v_line->>'reason');
      END IF;
      SELECT version INTO v_version FROM bar_local.stock_balances
       WHERE business_id=v_ctx.business_id AND outlet_id=v_ctx.outlet_id AND product_id=v_product.id;
      v_result:=jsonb_build_object('product_id',v_product.id,'expected_quantity',v_current::text,'quantity',(v_current+v_delta)::text,
        'delta',v_delta::text,'version',v_version,'reason',v_line->>'reason');
      v_lines:=v_lines||jsonb_build_array(v_result);
      v_events:=v_events||jsonb_build_array(jsonb_build_object('event_type',CASE WHEN v_mode='count' THEN 'stock.stocktake' ELSE 'stock.receive' END,'payload',v_result));
    END LOOP;
    v_result:=jsonb_build_object('mode',v_mode,'lines',v_lines,'notes',v_payload->>'notes','outlet_id',v_ctx.outlet_id);
    PERFORM bar_local.audit_row(v_ctx.business_id,v_ctx.outlet_id,v_ctx.staff_id,v_ctx.device_id,'stock.batch.record',
      (p_envelope->>'operation_id')::uuid,jsonb_build_object('lines',v_before),v_result);
    v_receipt:=bar_local.finish_committed((p_envelope->>'operation_id')::uuid,v_seq.commit_sequence,v_result,v_result,v_events,bar_local.current_business_date());
    RETURN jsonb_build_object('ok',true,'outcome','committed_local','result',v_result,'receipt',v_receipt);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code=PG_EXCEPTION_DETAIL,v_message=MESSAGE_TEXT;
    v_error:=bar_local.record_refusal((p_envelope->>'operation_id')::uuid,v_code,v_message);
    RETURN jsonb_build_object('ok',false,'outcome','refused','error',v_error);
  WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
    v_error:=bar_local.record_refusal((p_envelope->>'operation_id')::uuid,'VALIDATION_FAILED','The stock batch contains an invalid quantity or version. Refresh and review every line.');
    RETURN jsonb_build_object('ok',false,'outcome','refused','error',v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_catalogue_stock_item_save(
  p_token_hash text,p_device_id uuid,p_envelope jsonb,p_payload_hash text,p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context; v_claim record; v_seq record;
  v_payload jsonb:=p_envelope->'payload'; v_id uuid:=NULLIF(v_payload->>'product_id','')::uuid;
  v_product bar_local.products%ROWTYPE; v_before jsonb; v_result jsonb; v_receipt jsonb; v_events jsonb;
  v_opening numeric(18,6):=COALESCE(NULLIF(v_payload->>'opening_stock','')::numeric,0);
  v_code text; v_message text; v_error jsonb;
BEGIN
  v_ctx:=bar_local.current_session(p_token_hash,p_device_id,(p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint,(p_envelope->>'business_id')::uuid,(p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities,'inventory.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx,p_envelope,p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status='committed' THEN
      RETURN jsonb_build_object('ok',true,'outcome','committed_local','replayed',true,'receipt',v_claim.receipt,'result',v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok',false,'outcome','refused','replayed',true,'error',v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF NULLIF(v_payload->>'outlet_id','') IS NOT NULL AND (v_payload->>'outlet_id')::uuid<>v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH','Stock details belong to the authenticated Bar outlet. Refresh before saving.');
    END IF;
    IF length(btrim(COALESCE(v_payload->>'name',''))) NOT BETWEEN 1 AND 200
       OR length(btrim(COALESCE(v_payload->>'unit',''))) NOT BETWEEN 1 AND 40
       OR COALESCE((v_payload->>'reorder_level')::numeric,-1)<0 OR v_opening<0
       OR COALESCE((v_payload->>'unit_cost')::numeric,0)<0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED','Enter a name, counted unit and non-negative stock details.');
    END IF;
    IF v_id IS NULL THEN
      v_id:=gen_random_uuid();
      INSERT INTO bar_local.products(id,business_id,sku,name,category,price,tax_rate,track_stock,active,sellable,unit,barcode,reorder_level,unit_cost)
      VALUES(v_id,v_ctx.business_id,'STK-'||replace(v_id::text,'-',''),v_payload->>'name',v_payload->>'category',0,0,true,true,false,
        v_payload->>'unit',NULLIF(v_payload->>'barcode',''),(v_payload->>'reorder_level')::numeric,COALESCE((v_payload->>'unit_cost')::numeric,0))
      RETURNING * INTO v_product;
      INSERT INTO bar_local.stock_balances(business_id,outlet_id,product_id,quantity)
      VALUES(v_ctx.business_id,v_ctx.outlet_id,v_id,v_opening);
      IF v_opening>0 THEN
        INSERT INTO bar_local.stock_movements(business_id,outlet_id,product_id,delta,reason,operation_id,business_date,unit_cost,reference)
        VALUES(v_ctx.business_id,v_ctx.outlet_id,v_id,v_opening,'opening_stock',(p_envelope->>'operation_id')::uuid,
          bar_local.current_business_date(),v_product.unit_cost,'Opening quantity recorded at stock-item creation.');
      END IF;
    ELSE
      IF v_opening<>0 THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED','Opening stock can only be recorded once. Use Receive or Count for an existing item.');
      END IF;
      SELECT * INTO v_product FROM bar_local.products WHERE id=v_id AND business_id=v_ctx.business_id FOR UPDATE;
      IF NOT FOUND OR NOT v_product.track_stock OR NOT v_product.active THEN
        PERFORM bar_local.raise_business('STOCK_ITEM_NOT_FOUND','This active counted stock item was not found in the Bar. Refresh Stock.');
      END IF;
      IF NULLIF(v_payload->>'expected_version','') IS NULL OR (v_payload->>'expected_version')::integer<>v_product.version THEN
        PERFORM bar_local.raise_business('PRODUCT_VERSION_CONFLICT','Stock details changed on another till. Refresh and review before saving.');
      END IF;
      IF v_product.unit<>v_payload->>'unit' AND (
        EXISTS(SELECT 1 FROM bar_local.stock_movements WHERE business_id=v_ctx.business_id AND product_id=v_id)
        OR EXISTS(SELECT 1 FROM bar_local.product_recipe_lines WHERE ingredient_product_id=v_id)
        OR EXISTS(SELECT 1 FROM bar_local.bar_product_stock_links WHERE business_id=v_ctx.business_id AND stock_product_id=v_id)) THEN
        PERFORM bar_local.raise_business('STOCK_UNIT_LOCKED','This counted unit has stock or product history. Keep its unit and create a separate stock item for a different unit.');
      END IF;
      v_before:=to_jsonb(v_product);
      UPDATE bar_local.products SET name=v_payload->>'name',category=v_payload->>'category',unit=v_payload->>'unit',
        barcode=NULLIF(v_payload->>'barcode',''),reorder_level=(v_payload->>'reorder_level')::numeric,
        unit_cost=COALESCE((v_payload->>'unit_cost')::numeric,unit_cost),version=version+1,updated_at=now()
       WHERE id=v_id AND business_id=v_ctx.business_id RETURNING * INTO v_product;
    END IF;
    UPDATE bar_local.authority SET catalogue_version=catalogue_version+1 WHERE singleton;
    v_result:=jsonb_build_object('product_id',v_id,'inventory_item_id',v_id,'version',v_product.version,
      'name',v_product.name,'category',v_product.category,'unit',v_product.unit,'barcode',v_product.barcode,
      'reorder_level',v_product.reorder_level::text,'unit_cost',v_product.unit_cost::text,'opening_stock_recorded',v_opening::text);
    v_events:=jsonb_build_array(jsonb_build_object('event_type','catalogue.stock_item.save','payload',v_result));
    IF v_opening>0 THEN
      v_events:=v_events||jsonb_build_array(jsonb_build_object('event_type','stock.opening','payload',
        jsonb_build_object('product_id',v_id,'delta',v_opening::text,'quantity',v_opening::text)));
    END IF;
    PERFORM bar_local.audit_row(v_ctx.business_id,v_ctx.outlet_id,v_ctx.staff_id,v_ctx.device_id,'catalogue.stock_item.save',
      (p_envelope->>'operation_id')::uuid,v_before,v_result);
    v_receipt:=bar_local.finish_committed((p_envelope->>'operation_id')::uuid,v_seq.commit_sequence,v_result,v_result,v_events,bar_local.current_business_date());
    RETURN jsonb_build_object('ok',true,'outcome','committed_local','result',v_result,'receipt',v_receipt);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code=PG_EXCEPTION_DETAIL,v_message=MESSAGE_TEXT;
    v_error:=bar_local.record_refusal((p_envelope->>'operation_id')::uuid,v_code,v_message);
    RETURN jsonb_build_object('ok',false,'outcome','refused','error',v_error);
  WHEN unique_violation THEN
    v_error:=bar_local.record_refusal((p_envelope->>'operation_id')::uuid,'BAR_PRODUCT_CONFLICT','Another counted stock item uses this barcode. Refresh Stock and choose a unique barcode.');
    RETURN jsonb_build_object('ok',false,'outcome','refused','error',v_error);
  WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
    v_error:=bar_local.record_refusal((p_envelope->>'operation_id')::uuid,'VALIDATION_FAILED','The stock details contain an invalid quantity or version.');
    RETURN jsonb_build_object('ok',false,'outcome','refused','error',v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.cmd_stock_batch_record(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.cmd_stock_batch_record(text,uuid,jsonb,text,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_stock_batch_record(text,uuid,jsonb,text,text) SET search_path=pg_catalog,bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_stock_batch_record(text,uuid,jsonb,text,text) FROM PUBLIC,bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_stock_batch_record(text,uuid,jsonb,text,text) TO bar_local_runtime;
ALTER FUNCTION bar_local.cmd_catalogue_stock_item_save(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.cmd_catalogue_stock_item_save(text,uuid,jsonb,text,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_catalogue_stock_item_save(text,uuid,jsonb,text,text) SET search_path=pg_catalog,bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_catalogue_stock_item_save(text,uuid,jsonb,text,text) FROM PUBLIC,bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_catalogue_stock_item_save(text,uuid,jsonb,text,text) TO bar_local_runtime;
INSERT INTO bar_local.runtime_function_allowlist(function_name) VALUES('cmd_stock_batch_record'),('cmd_catalogue_stock_item_save') ON CONFLICT DO NOTHING;

ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) RENAME TO query_dispatch_before_native_stock;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_native_stock(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.query_dispatch(
  p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context; v_outlet uuid; v_limit integer; v_data jsonb;
  v_more boolean:=false; v_next text; v_product uuid;
BEGIN
  IF p_query IN ('stock.list','menu.availability') THEN
    RETURN bar_local.query_dispatch_menu(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  END IF;
  IF p_query NOT IN ('stock.history','stock.aging') THEN
    RETURN bar_local.query_dispatch_before_native_stock(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  END IF;
  v_ctx:=bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
  v_product:=NULLIF(p_filters->>'product_id','')::uuid;
  PERFORM bar_local.assert_capability(v_ctx.capabilities,'inventory.view');
  v_outlet:=bar_local.query_outlet(v_ctx,COALESCE(p_filters,'{}'::jsonb));
  v_limit:=bar_local.query_limit(COALESCE(p_filters,'{}'::jsonb),200,200);
  IF p_query='stock.aging' THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.cursor_key),'[]'::jsonb) INTO v_data FROM (
      SELECT p.id::text AS cursor_key,p.id AS item_id,r.last_received_at,r.last_received_date,r.last_sold_at,
        bar_local.current_business_date()-r.last_received_date AS days_since_receipt
      FROM bar_local.products p LEFT JOIN LATERAL (
        SELECT max(m.created_at) FILTER (WHERE m.delta>0 AND m.reason IN ('stock.receive','purchase.receive','opening_stock')) AS last_received_at,
          max(m.business_date) FILTER (WHERE m.delta>0 AND m.reason IN ('stock.receive','purchase.receive','opening_stock')) AS last_received_date,
          max(m.created_at) FILTER (WHERE m.delta<0 AND m.reason IN ('sale.depletion','sale.recipe.depletion')) AS last_sold_at
        FROM bar_local.stock_movements m WHERE m.business_id=v_ctx.business_id AND m.outlet_id=v_outlet AND m.product_id=p.id
      ) r ON true
      WHERE p.business_id=v_ctx.business_id AND p.track_stock
        AND (p_filters->>'cursor' IS NULL OR p.id::text>p_filters->>'cursor')
      ORDER BY p.id LIMIT v_limit+1
    ) x;
  ELSIF COALESCE((p_filters->>'counts_only')::boolean,false) THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.cursor_key),'[]'::jsonb) INTO v_data FROM (
      SELECT lpad(a.id::text,20,'0')||':'||lpad(line.ordinality::text,5,'0') AS cursor_key,
        a.id::text||':'||line.ordinality AS id,a.operation_id,a.created_at,a.actor_staff_id AS actor_id,s.display_name AS actor_name,
        (line.value->>'product_id')::uuid AS item_id,p.name AS item_name,p.unit AS item_unit,'physical_count' AS reference_type,
        line.value->>'expected_quantity' AS expected_qty,line.value->>'quantity' AS actual_qty,
        line.value->>'delta' AS delta,line.value->>'reason' AS notes
      FROM bar_local.audit_log a JOIN bar_local.operations op ON op.operation_id=a.operation_id
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN a.action='stock.batch.record' THEN a.after->'lines' ELSE
        jsonb_build_array(jsonb_build_object('product_id',a.after->'product_id','expected_quantity',a.before->'quantity',
          'quantity',a.after->'quantity','delta',a.after->'delta','reason',op.payload->'reason')) END) WITH ORDINALITY line(value,ordinality)
      JOIN bar_local.products p ON p.id=(line.value->>'product_id')::uuid AND p.business_id=a.business_id
      LEFT JOIN bar_local.staff s ON s.id=a.actor_staff_id AND s.business_id=a.business_id
      WHERE a.business_id=v_ctx.business_id AND a.outlet_id=v_outlet AND op.business_id=v_ctx.business_id AND op.outlet_id=v_outlet
        AND (a.action='stock.stocktake' OR (a.action='stock.batch.record' AND a.after->>'mode'='count'))
        AND (v_product IS NULL OR p.id=v_product)
        AND (p_filters->>'cursor' IS NULL OR lpad(a.id::text,20,'0')||':'||lpad(line.ordinality::text,5,'0')>p_filters->>'cursor')
      ORDER BY a.id,line.ordinality LIMIT v_limit+1
    ) x;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.cursor_key),'[]'::jsonb) INTO v_data FROM (
      SELECT m.id::text AS cursor_key,m.id,m.product_id AS item_id,m.delta::text AS quantity,
        m.reason AS movement_type,m.reference AS notes,m.created_at,m.operation_id
      FROM bar_local.stock_movements m WHERE m.business_id=v_ctx.business_id AND m.outlet_id=v_outlet
        AND (v_product IS NULL OR m.product_id=v_product)
        AND (p_filters->>'cursor' IS NULL OR m.id::text>p_filters->>'cursor')
      ORDER BY m.id LIMIT v_limit+1
    ) x;
  END IF;
  IF jsonb_array_length(v_data)>v_limit THEN v_data:=v_data-v_limit;v_more:=true;v_next:=v_data->-1->>'cursor_key';END IF;
  RETURN jsonb_build_object('data',v_data,'pagination',jsonb_build_object('has_more',v_more,'next_cursor',v_next),
    'snapshot_watermark',(SELECT commit_sequence FROM bar_local.authority_counter WHERE singleton),
    'scope',jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_outlet,'device_id',v_ctx.device_id,'actor_staff_id',v_ctx.staff_id,'role',v_ctx.role),
    'as_of',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'complete',true,'unavailable','[]'::jsonb);
END;
$$;
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
