-- Convert fractional JSON numerics in PostgreSQL before JavaScript can round
-- them or a durable client journal rejects them. Integral metadata stays numeric.
-- Apply before new receipts/events are persisted and hashed, never rewrite
-- historical outbox payloads, manifests or their hashes.
CREATE FUNCTION bar_local.decimal_json_transport(p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,bar_local AS $$
DECLARE v_result jsonb;v_numeric numeric;
BEGIN
 CASE jsonb_typeof(p_value)
 WHEN 'object' THEN
  SELECT COALESCE(jsonb_object_agg(e.key,bar_local.decimal_json_transport(e.value)),'{}'::jsonb)
   INTO v_result FROM jsonb_each(p_value) e;
 WHEN 'array' THEN
  SELECT COALESCE(jsonb_agg(bar_local.decimal_json_transport(e.value) ORDER BY e.ordinality),'[]'::jsonb)
   INTO v_result FROM jsonb_array_elements(p_value) WITH ORDINALITY e(value,ordinality);
 WHEN 'number' THEN
  v_numeric:=(p_value#>>'{}')::numeric;
  IF v_numeric<>trunc(v_numeric) OR abs(v_numeric)>9007199254740991 THEN
   v_result:=to_jsonb(p_value#>>'{}');
  ELSE v_result:=p_value;END IF;
 ELSE v_result:=p_value;
 END CASE;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION bar_local.decimal_json_transport(jsonb) FROM PUBLIC,bar_local_runtime;

ALTER FUNCTION bar_local.build_receipt(uuid) RENAME TO build_receipt_before_decimal_transport;
REVOKE ALL ON FUNCTION bar_local.build_receipt_before_decimal_transport(uuid) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.build_receipt(p_sale_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,bar_local AS $$
 SELECT bar_local.decimal_json_transport(bar_local.build_receipt_before_decimal_transport(p_sale_id));
$$;
REVOKE ALL ON FUNCTION bar_local.build_receipt(uuid) FROM PUBLIC,bar_local_runtime;

ALTER FUNCTION bar_local.finish_committed(uuid,bigint,jsonb,jsonb,jsonb,date) RENAME TO finish_committed_before_decimal_transport;
REVOKE ALL ON FUNCTION bar_local.finish_committed_before_decimal_transport(uuid,bigint,jsonb,jsonb,jsonb,date) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.finish_committed(
 p_operation_id uuid,p_commit_sequence bigint,p_result jsonb,p_receipt jsonb,p_events jsonb,p_business_date date
) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog,bar_local AS $$
 SELECT bar_local.finish_committed_before_decimal_transport(p_operation_id,p_commit_sequence,
  bar_local.decimal_json_transport(p_result),bar_local.decimal_json_transport(p_receipt),
  bar_local.decimal_json_transport(p_events),p_business_date);
$$;
REVOKE ALL ON FUNCTION bar_local.finish_committed(uuid,bigint,jsonb,jsonb,jsonb,date) FROM PUBLIC,bar_local_runtime;

-- Historical operation recovery changes only the response representation.
-- Preserve stored receipts, original requests, immutable effects and event hashes.
ALTER FUNCTION bar_local.claim_operation(bar_local.session_context,jsonb,text) RENAME TO claim_operation_before_decimal_transport;
REVOKE ALL ON FUNCTION bar_local.claim_operation_before_decimal_transport(bar_local.session_context,jsonb,text) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.claim_operation(p_session bar_local.session_context,p_envelope jsonb,p_payload_hash text)
RETURNS TABLE(replayed boolean,operation_status text,receipt jsonb,result jsonb,error jsonb)
LANGUAGE sql SET search_path=pg_catalog,bar_local AS $$
 SELECT c.replayed,c.operation_status,bar_local.decimal_json_transport(c.receipt),
  bar_local.decimal_json_transport(c.result),c.error
 FROM bar_local.claim_operation_before_decimal_transport(p_session,p_envelope,p_payload_hash) c;
$$;
REVOKE ALL ON FUNCTION bar_local.claim_operation(bar_local.session_context,jsonb,text) FROM PUBLIC,bar_local_runtime;

ALTER FUNCTION bar_local.service_operation_status(text,uuid,uuid) RENAME TO service_operation_status_before_decimal_transport;
REVOKE ALL ON FUNCTION bar_local.service_operation_status_before_decimal_transport(text,uuid,uuid) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.service_operation_status(p_token_hash text,p_device_id uuid,p_operation_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
 SELECT bar_local.decimal_json_transport(bar_local.service_operation_status_before_decimal_transport(p_token_hash,p_device_id,p_operation_id));
$$;
REVOKE ALL ON FUNCTION bar_local.service_operation_status(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.service_operation_status(text,uuid,uuid) TO bar_local_runtime;

-- Ordinary scoped reads also preserve exact decimals. A signed export manifest
-- is an immutable document: returning it must never rewrite its hashed payload.
ALTER FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) RENAME TO query_dispatch_before_decimal_results;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_decimal_results(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;
CREATE FUNCTION bar_local.query_dispatch(
 p_token_hash text,p_device_id uuid,p_authority_id uuid,p_authority_epoch bigint,p_query text,p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,bar_local AS $$
DECLARE v_result jsonb;
BEGIN
 v_result:=bar_local.query_dispatch_before_decimal_results(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
 IF p_query='outbox.bundle.get' THEN RETURN v_result;END IF;
 RETURN jsonb_set(v_result,'{data}',bar_local.decimal_json_transport(v_result->'data'));
END;
$$;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text,uuid,uuid,bigint,text,jsonb) TO bar_local_runtime;
