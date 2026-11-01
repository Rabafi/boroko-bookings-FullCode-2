-- Manager approved lot-specific waste and inspected release of returned stock.
CREATE OR REPLACE FUNCTION bar_local.cmd_stock_lot_waste(
  p_token_hash text,p_device_id uuid,p_envelope jsonb,p_payload_hash text,p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb:=p_envelope->'payload';
  v_lot bar_local.stock_lots%ROWTYPE;
  v_balance numeric(18,6);
  v_qty numeric(18,6);
  v_result jsonb;
  v_error jsonb;
  v_code text;
  v_message text;
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
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid,p_approval_hash,'inventory.approve',
      v_ctx.business_id,v_ctx.outlet_id,v_ctx.staff_id);
    v_qty:=(v_payload->>'quantity')::numeric;
    IF v_qty<=0 THEN PERFORM bar_local.raise_business('VALIDATION_FAILED','Waste quantity must be greater than zero.'); END IF;
    SELECT * INTO v_lot FROM bar_local.stock_lots
     WHERE id=(v_payload->>'lot_id')::uuid AND business_id=v_ctx.business_id AND outlet_id=v_ctx.outlet_id
       AND product_id=(v_payload->>'product_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN PERFORM bar_local.raise_business('LOT_NOT_FOUND','The selected lot is not available in this outlet. Refresh stock lots.'); END IF;
    IF v_lot.version<>(v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('STALE_VERSION','This lot changed after it was selected. Refresh the lot balances and request approval again.');
    END IF;
    IF v_lot.remaining_quantity<v_qty THEN
      PERFORM bar_local.raise_business('INSUFFICIENT_LOT_STOCK','The selected lot no longer has enough stock. Refresh the lot balances and request approval again.');
    END IF;
    INSERT INTO bar_local.stock_balances(business_id,outlet_id,product_id,quantity)
    VALUES(v_ctx.business_id,v_ctx.outlet_id,v_lot.product_id,0)
    ON CONFLICT(business_id,outlet_id,product_id) DO NOTHING;
    SELECT quantity INTO v_balance FROM bar_local.stock_balances
     WHERE business_id=v_ctx.business_id AND outlet_id=v_ctx.outlet_id AND product_id=v_lot.product_id FOR UPDATE;
    IF v_balance<v_qty THEN PERFORM bar_local.raise_business('INSUFFICIENT_STOCK','The current product balance is lower than the selected lot. Refresh before recording waste.'); END IF;
    UPDATE bar_local.stock_balances SET quantity=quantity-v_qty,version=version+1,updated_at=now()
     WHERE business_id=v_ctx.business_id AND outlet_id=v_ctx.outlet_id AND product_id=v_lot.product_id;
    INSERT INTO bar_local.stock_movements(business_id,outlet_id,product_id,delta,reason,operation_id,business_date,reference,lot_id)
    VALUES(v_ctx.business_id,v_ctx.outlet_id,v_lot.product_id,-v_qty,'stock.waste',(p_envelope->>'operation_id')::uuid,
      bar_local.current_business_date(),v_payload->>'reason',v_lot.id);
    v_result:=jsonb_build_object('product_id',v_lot.product_id,'lot_id',v_lot.id,'lot_code',v_lot.lot_code,
      'delta',-v_qty,'remaining_quantity',v_lot.remaining_quantity-v_qty,'reason',v_payload->>'reason');
    PERFORM bar_local.audit_row(v_ctx.business_id,v_ctx.outlet_id,v_ctx.staff_id,v_ctx.device_id,
      'stock.lot.wasted',(p_envelope->>'operation_id')::uuid,
      jsonb_build_object('lot_id',v_lot.id,'remaining_quantity',v_lot.remaining_quantity,'version',v_lot.version),v_result);
    v_result:=bar_local.finish_committed((p_envelope->>'operation_id')::uuid,v_seq.commit_sequence,v_result,v_result,
      jsonb_build_array(jsonb_build_object('event_type','stock.lot.wasted','payload',v_result)),bar_local.current_business_date());
    RETURN jsonb_build_object('ok',true,'outcome','committed_local','receipt',v_result,'result',v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code=PG_EXCEPTION_DETAIL,v_message=MESSAGE_TEXT;
    v_error:=bar_local.record_refusal((p_envelope->>'operation_id')::uuid,v_code,v_message);
    RETURN jsonb_build_object('ok',false,'outcome','refused','error',v_error);
  END;
END;
$$;
ALTER FUNCTION bar_local.cmd_stock_lot_waste(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.cmd_stock_lot_waste(text,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_stock_lot_waste(text,uuid,jsonb,text,text) TO bar_local_runtime;

CREATE OR REPLACE FUNCTION bar_local.cmd_stock_lot_release(
  p_token_hash text,p_device_id uuid,p_envelope jsonb,p_payload_hash text,p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb:=p_envelope->'payload';
  v_lot bar_local.stock_lots%ROWTYPE;
  v_expiry date;
  v_result jsonb;
  v_error jsonb;
  v_code text;
  v_message text;
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
    PERFORM bar_local.consume_approval((v_payload->>'approval_id')::uuid,p_approval_hash,'inventory.approve',
      v_ctx.business_id,v_ctx.outlet_id,v_ctx.staff_id);
    SELECT * INTO v_lot FROM bar_local.stock_lots
     WHERE id=(v_payload->>'lot_id')::uuid AND business_id=v_ctx.business_id AND outlet_id=v_ctx.outlet_id FOR UPDATE;
    IF NOT FOUND THEN PERFORM bar_local.raise_business('LOT_NOT_FOUND','The selected lot is not available in this outlet. Refresh stock lots.'); END IF;
    IF v_lot.version<>(v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('STALE_VERSION','This lot changed after it was selected. Refresh the lot balances and request approval again.');
    END IF;
    IF v_lot.sale_eligible OR v_lot.remaining_quantity<=0 OR v_lot.source_kind NOT IN ('sale_return_quarantine','sale.return.restock') THEN
      PERFORM bar_local.raise_business('LOT_RELEASE_NOT_ALLOWED','Only a non-empty quarantined return lot can be released after inspection.');
    END IF;
    v_expiry:=NULLIF(v_payload->>'verified_expires_on','')::date;
    IF (v_expiry IS NULL AND COALESCE((v_payload->>'no_expiry_confirmed')::boolean,false)=false)
       OR (v_expiry IS NOT NULL AND COALESCE((v_payload->>'no_expiry_confirmed')::boolean,false)) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED','Confirm either a verified expiry date or that the inspected product has no expiry date.');
    END IF;
    IF v_expiry IS NOT NULL AND v_expiry<bar_local.current_business_date() THEN
      PERFORM bar_local.raise_business('LOT_EXPIRED','The inspected lot is expired and cannot be released for sale.');
    END IF;
    UPDATE bar_local.stock_lots SET sale_eligible=true,lot_code=NULLIF(v_payload->>'verified_lot_code',''),
      expires_on=v_expiry,version=version+1,
      provenance=provenance||' Inspected and released by staff '||v_ctx.staff_id::text||' on '||bar_local.current_business_date()::text||': '||(v_payload->>'reason')
     WHERE id=v_lot.id;
    v_result:=jsonb_build_object('lot_id',v_lot.id,'product_id',v_lot.product_id,
      'remaining_quantity',v_lot.remaining_quantity,'verified_lot_code',NULLIF(v_payload->>'verified_lot_code',''),
      'verified_expires_on',v_expiry,'sale_eligible',true,'status','released');
    PERFORM bar_local.audit_row(v_ctx.business_id,v_ctx.outlet_id,v_ctx.staff_id,v_ctx.device_id,
      'stock.lot.released',(p_envelope->>'operation_id')::uuid,
      jsonb_build_object('sale_eligible',v_lot.sale_eligible,'lot_code',v_lot.lot_code,'expires_on',v_lot.expires_on,
        'remaining_quantity',v_lot.remaining_quantity,'version',v_lot.version),v_result||jsonb_build_object('reason',v_payload->>'reason'));
    v_result:=bar_local.finish_committed((p_envelope->>'operation_id')::uuid,v_seq.commit_sequence,v_result,v_result,
      jsonb_build_array(jsonb_build_object('event_type','stock.lot.released','payload',v_result)),bar_local.current_business_date());
    RETURN jsonb_build_object('ok',true,'outcome','committed_local','receipt',v_result,'result',v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code=PG_EXCEPTION_DETAIL,v_message=MESSAGE_TEXT;
    v_error:=bar_local.record_refusal((p_envelope->>'operation_id')::uuid,v_code,v_message);
    RETURN jsonb_build_object('ok',false,'outcome','refused','error',v_error);
  END;
END;
$$;
ALTER FUNCTION bar_local.cmd_stock_lot_release(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;
REVOKE ALL ON FUNCTION bar_local.cmd_stock_lot_release(text,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_stock_lot_release(text,uuid,jsonb,text,text) TO bar_local_runtime;

