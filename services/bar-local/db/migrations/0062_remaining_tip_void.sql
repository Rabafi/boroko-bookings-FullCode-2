-- A manager-approved void can refund an unallocated tip after every item
-- was already returned. Reuse the existing tender/GL conservation and open
-- original-drawer guard. No second stock or item refund is generated.
-- These replacements deliberately fail if the expected predecessor changes.
DO $migration$
DECLARE
  v_source text;
  v_before text;
  v_after text;
BEGIN
  SELECT pg_get_functiondef('bar_local.reverse_sale_before_shift_guard(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean)'::regprocedure)
    INTO v_source;
  v_before := 'IF jsonb_typeof(p_lines) IS DISTINCT FROM ''array'' OR jsonb_array_length(p_lines) = 0 THEN';
  v_after := 'IF jsonb_typeof(p_lines) IS DISTINCT FROM ''array'' OR (jsonb_array_length(p_lines) = 0 AND NOT p_mark_void) THEN';
  IF strpos(v_source,v_before)=0 THEN RAISE EXCEPTION 'Remaining-tip migration: expected return line validation missing'; END IF;
  EXECUTE replace(v_source,v_before,v_after);

  SELECT pg_get_functiondef('bar_local.cmd_sale_void(text,uuid,jsonb,text,text)'::regprocedure) INTO v_source;
  v_before := 'IF jsonb_array_length(v_lines) = 0 THEN';
  v_after := 'IF jsonb_array_length(v_lines) = 0 AND NOT EXISTS (
    SELECT 1 FROM bar_local.sales s WHERE s.id=(v_payload->>''sale_id'')::uuid
      AND s.business_id=v_ctx.business_id AND s.outlet_id=v_ctx.outlet_id
      AND s.original_sale_id IS NULL AND s.status=''returned'' AND s.tip>0
  ) THEN';
  IF strpos(v_source,v_before)=0 THEN RAISE EXCEPTION 'Remaining-tip migration: expected void line validation missing'; END IF;
  EXECUTE replace(v_source,v_before,v_after);
END;
$migration$;

-- Preserve the existing callable boundary and helper-only access.
ALTER FUNCTION bar_local.cmd_sale_void(text,uuid,jsonb,text,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_sale_void(text,uuid,jsonb,text,text) SET search_path=pg_catalog,bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_sale_void(text,uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_sale_void(text,uuid,jsonb,text,text) TO bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.reverse_sale_before_shift_guard(bar_local.session_context,uuid,bigint,uuid,jsonb,text,text,boolean) FROM PUBLIC,bar_local_runtime;
