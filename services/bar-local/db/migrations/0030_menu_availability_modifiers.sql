-- Expose active, product-linked modifier groups and options through the
-- existing menu.availability read model.
--
-- The historic query dispatcher chain is intentionally left untouched. The
-- menu implementation created by 0014 is named query_dispatch_menu by 0015 and
-- is still reached through query_dispatch -> query_dispatch_legacy ->
-- query_dispatch_control -> ... -> query_dispatch_menu. Replacing only that
-- function keeps every other query route, the response envelope, pagination,
-- scope and snapshot watermark contract unchanged.
--
-- Modifier configuration is business-scoped (0020); outlet scope is still
-- enforced through the product availability/stock joins. No table grants are
-- added or widened here. The function remains SECURITY DEFINER with a pinned
-- search_path and stays executable only through the internal dispatcher.

CREATE OR REPLACE FUNCTION bar_local.query_dispatch_menu(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_query text,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_outlet uuid;
  v_limit integer;
  v_data jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next text;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
  v_filters jsonb;
BEGIN
  IF p_query IS DISTINCT FROM 'menu.availability' THEN
    RETURN bar_local.query_dispatch_purchasing(
      p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
    );
  END IF;
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.view');
  v_outlet := bar_local.query_outlet(v_ctx, COALESCE(p_filters, '{}'::jsonb));
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  v_limit := bar_local.query_limit(v_filters);
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id);

  SELECT COALESCE(jsonb_agg(
           CASE WHEN x.modifier_groups IS NULL
                THEN to_jsonb(x) - 'modifier_groups'
                ELSE to_jsonb(x)
           END
           ORDER BY x.sku, x.product_id), '[]'::jsonb)
    INTO v_data
    FROM (
      SELECT p.id AS product_id, p.sku, p.name, p.category, p.price, p.tax_rate, p.track_stock,
             p.active AS product_active,
             (p.active AND COALESCE(pa.available, true)) AS available,
             pa.available AS override_available,
             COALESCE(pa.version, 0) AS availability_version,
             COALESCE(sb.quantity, 0) AS stock_quantity,
             pa.updated_at AS availability_updated_at,
             mods.modifier_groups
        FROM bar_local.products p
        LEFT JOIN bar_local.product_availability pa
          ON pa.business_id = p.business_id AND pa.outlet_id = v_outlet AND pa.product_id = p.id
        LEFT JOIN bar_local.stock_balances sb
          ON sb.business_id = p.business_id AND sb.outlet_id = v_outlet AND sb.product_id = p.id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object(
                   'modifier_group_id', mg.id,
                   'group_id', mg.id,
                   'code', mg.code,
                   'name', mg.name,
                   'required', mg.required,
                   'min_selections', mg.min_selections,
                   'max_selections', mg.max_selections,
                   'active', mg.active,
                   'version', mg.version,
                   'sort_order', pml.sort_order,
                   'options', COALESCE((
                     SELECT jsonb_agg(jsonb_build_object(
                              'modifier_option_id', mo.id,
                              'option_id', mo.id,
                              'modifier_group_id', mo.group_id,
                              'group_id', mo.group_id,
                              'code', mo.code,
                              'name', mo.name,
                              'price_delta', mo.price_delta,
                              'sort_order', mo.sort_order,
                              'active', mo.active,
                              'version', mo.version
                            ) ORDER BY mo.sort_order, mo.code, mo.id)
                       FROM bar_local.modifier_options mo
                      WHERE mo.business_id = v_ctx.business_id
                        AND mo.group_id = mg.id
                        AND mo.active
                   ), '[]'::jsonb)
                 ) ORDER BY pml.sort_order, mg.code, mg.id) AS modifier_groups
            FROM bar_local.product_modifier_links pml
            JOIN bar_local.modifier_groups mg
              ON mg.id = pml.group_id AND mg.business_id = pml.business_id
           WHERE pml.business_id = v_ctx.business_id
             AND pml.product_id = p.id
             AND pml.active
             AND mg.active
        ) mods ON true
       WHERE p.business_id = v_ctx.business_id
         AND (COALESCE((v_filters->>'include_inactive')::boolean, false) OR p.active)
         AND (NOT COALESCE((v_filters->>'available_only')::boolean, false)
              OR (p.active AND COALESCE(pa.available, true)))
         AND (v_filters->>'cursor' IS NULL OR p.sku > v_filters->>'cursor')
       ORDER BY p.sku, p.id
       LIMIT v_limit + 1
    ) x;
  IF jsonb_array_length(v_data) > v_limit THEN
    v_data := v_data - v_limit;
    v_has_more := true;
    v_next := v_data->-1->>'sku';
  END IF;
  RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
    'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);
END;
$$;

ALTER FUNCTION bar_local.query_dispatch_menu(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_menu(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_menu(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_menu(text, uuid, uuid, bigint, text, jsonb) FROM bar_local_runtime;
