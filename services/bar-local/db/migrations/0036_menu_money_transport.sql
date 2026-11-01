-- Keep catalogue money as decimal strings at the JSON boundary. PostgreSQL
-- numeric values otherwise become JSON numbers and are rounded by JavaScript.

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb)
  RENAME TO query_dispatch_before_menu_money_transport;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_result jsonb;
  v_data jsonb;
BEGIN
  v_result := bar_local.query_dispatch_before_menu_money_transport(
    p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
  );
  IF p_query <> 'menu.list' OR COALESCE((v_result->>'complete')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  SELECT COALESCE(jsonb_agg(
    CASE WHEN item ? 'price' THEN jsonb_set(item, '{price}', to_jsonb(to_char((item->>'price')::numeric, 'FM999999999999990.00')))
         ELSE item END
  ), '[]'::jsonb)
  INTO v_data
  FROM jsonb_array_elements(COALESCE(v_result->'data', '[]'::jsonb)) AS rows(item);

  RETURN jsonb_set(v_result, '{data}', v_data, true);
END;
$$;

ALTER FUNCTION bar_local.query_dispatch_before_menu_money_transport(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_before_menu_money_transport(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_menu_money_transport(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC, bar_local_runtime;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
