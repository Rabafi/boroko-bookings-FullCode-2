-- New corrections must not rewrite a closed drawer period. Recovery of an
-- already committed correction still resolves before this helper is invoked.
ALTER FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean)
 RENAME TO reverse_sale_before_shift_guard;
REVOKE ALL ON FUNCTION bar_local.reverse_sale_before_shift_guard(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.reverse_sale(
 p_ctx bar_local.session_context,p_operation_id uuid,p_receipt_sequence bigint,p_original_sale_id uuid,
 p_lines jsonb,p_reason text,p_disposition text,p_mark_void boolean
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,bar_local AS $$
DECLARE v_shift_id uuid;v_before numeric;v_after numeric;v_result jsonb;
BEGIN
 SELECT shift_id INTO v_shift_id FROM bar_local.sales WHERE id=p_original_sale_id
  AND business_id=p_ctx.business_id AND outlet_id=p_ctx.outlet_id;
 IF NOT FOUND THEN PERFORM bar_local.raise_business('SALE_NOT_FOUND','The original sale could not be found in this outlet.');END IF;
 PERFORM bar_local.require_open_shift(p_ctx.business_id,p_ctx.outlet_id,v_shift_id,p_ctx.staff_id,false);
 v_before:=bar_local.expected_shift_cash(v_shift_id);
 v_result:=bar_local.reverse_sale_before_shift_guard(p_ctx,p_operation_id,p_receipt_sequence,p_original_sale_id,p_lines,p_reason,p_disposition,p_mark_void);
 v_after:=bar_local.expected_shift_cash(v_shift_id);
 IF v_after<0 AND v_after<v_before THEN
  PERFORM bar_local.raise_business('DRAWER_AMOUNT_INVALID','This refund exceeds the cash in the original open drawer. Reconcile or replenish that drawer before submitting a new authorised correction.');
 END IF;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION bar_local.reverse_sale(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) FROM PUBLIC,bar_local_runtime;
