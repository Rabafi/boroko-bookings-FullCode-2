-- Current correction detail, not a rewrite of stored receipts or outbox hashes.
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb)
  RENAME TO query_dispatch_before_returnable_quantity;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_returnable_quantity(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;

CREATE FUNCTION bar_local.query_dispatch(
  p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE v_response jsonb; v_lines jsonb; v_sale_id uuid;
BEGIN
  -- The predecessor enforces the authenticated query, capability and scope.
  v_response := bar_local.query_dispatch_before_returnable_quantity(
    p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  IF p_query='sale.get' AND (v_response->>'complete')::boolean IS TRUE
    AND jsonb_typeof(v_response#>'{data,lines}')='array' THEN
    v_sale_id := (v_response#>>'{data,sale_id}')::uuid;
    SELECT COALESCE(jsonb_agg(e.value || jsonb_build_object(
      'returned_quantity',l.returned_quantity::text,
      'remaining_quantity',greatest(0,l.quantity-l.returned_quantity)::text
    ) ORDER BY e.ordinality),'[]'::jsonb) INTO v_lines
    FROM jsonb_array_elements(v_response#>'{data,lines}') WITH ORDINALITY e(value,ordinality)
    JOIN bar_local.sale_lines l ON l.id=(e.value->>'sale_line_id')::uuid AND l.sale_id=v_sale_id;
    IF jsonb_array_length(v_lines)<>jsonb_array_length(v_response#>'{data,lines}') THEN
      PERFORM bar_local.raise_business('RETURN_RECONCILIATION_REQUIRED','The receipt lines could not be verified. Keep the original operation and ask a manager to reconcile this sale.');
    END IF;
    v_response := jsonb_set(v_response,'{data,lines}',v_lines);
  END IF;
  RETURN v_response;
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
