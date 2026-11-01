-- Expose business-scoped modifier configuration to authorized menu managers.
-- Configuration is shared across outlets, while all returned products remain
-- confined to the authenticated business and outlet context.

CREATE OR REPLACE FUNCTION bar_local.query_menu_modifiers(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_data jsonb;
  v_watermark bigint;
  v_scope jsonb;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.menu_manage');
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id);

  SELECT jsonb_build_object(
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'modifier_group_id', g.id, 'code', g.code, 'name', g.name,
        'required', g.required, 'min_selections', g.min_selections,
        'max_selections', g.max_selections, 'active', g.active, 'version', g.version,
        'options', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'modifier_option_id', o.id, 'code', o.code, 'name', o.name,
            'price_delta', o.price_delta, 'sort_order', o.sort_order,
            'active', o.active, 'version', o.version
          ) ORDER BY o.sort_order, o.code, o.id)
          FROM bar_local.modifier_options o
          WHERE o.business_id = v_ctx.business_id AND o.group_id = g.id
        ), '[]'::jsonb)
      ) ORDER BY g.code, g.id)
      FROM bar_local.modifier_groups g WHERE g.business_id = v_ctx.business_id
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', p.id, 'sku', p.sku, 'name', p.name,
        'version', COALESCE(s.version, 0),
        'groups', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('modifier_group_id', l.group_id, 'sort_order', l.sort_order)
            ORDER BY l.sort_order, l.group_id)
          FROM bar_local.product_modifier_links l
          WHERE l.business_id = v_ctx.business_id AND l.product_id = p.id AND l.active
        ), '[]'::jsonb)
      ) ORDER BY p.sku, p.id)
      FROM bar_local.products p
      LEFT JOIN bar_local.product_modifier_sets s
        ON s.business_id = p.business_id AND s.product_id = p.id
      WHERE p.business_id = v_ctx.business_id
    ), '[]'::jsonb)
  ) INTO v_data;

  RETURN jsonb_build_object('data', v_data, 'complete', true, 'unavailable', '[]'::jsonb,
    'snapshot_watermark', v_watermark, 'scope', v_scope,
    'as_of', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;

ALTER FUNCTION bar_local.query_menu_modifiers(text, uuid, uuid, bigint) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_menu_modifiers(text, uuid, uuid, bigint) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_menu_modifiers(text, uuid, uuid, bigint) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_menu_modifiers(text, uuid, uuid, bigint) FROM PUBLIC, bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb)
  RENAME TO query_dispatch_before_menu_modifiers;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_query = 'menu.modifiers' THEN
    RETURN bar_local.query_menu_modifiers(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  END IF;
  RETURN bar_local.query_dispatch_before_menu_modifiers(
    p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
  );
END;
$$;

ALTER FUNCTION bar_local.query_dispatch_before_menu_modifiers(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_before_menu_modifiers(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_menu_modifiers(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC, bar_local_runtime;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;
