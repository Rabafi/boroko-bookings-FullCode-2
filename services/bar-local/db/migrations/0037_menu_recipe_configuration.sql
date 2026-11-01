-- Add manager-only recipe definitions to the existing business-scoped menu
-- configuration snapshot so recipe editors can use the same versioned view.
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
            'price_delta', to_char(o.price_delta, 'FM999999999999990.00'), 'sort_order', o.sort_order,
            'active', o.active, 'version', o.version
          ) ORDER BY o.sort_order, o.code, o.id)
          FROM bar_local.modifier_options o
          WHERE o.business_id = v_ctx.business_id AND o.group_id = g.id
        ), '[]'::jsonb)
      ) ORDER BY g.code, g.id)
      FROM bar_local.modifier_groups g WHERE g.business_id = v_ctx.business_id
    ), '[]'::jsonb),
    'promotions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'promotion_id', p.id, 'code', p.code, 'name', p.name,
        'discount_type', p.discount_type, 'percent', p.percent::text,
        'amount', to_char(p.amount, 'FM999999999999990.00'),
        'minimum_subtotal', to_char(p.minimum_subtotal, 'FM999999999999990.00'),
        'scope', p.scope, 'product_id', p.product_id, 'category', p.category,
        'active', p.active, 'starts_on', p.starts_on, 'ends_on', p.ends_on, 'version', p.version
      ) ORDER BY p.code, p.id)
      FROM bar_local.promotions p WHERE p.business_id = v_ctx.business_id
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
        ), '[]'::jsonb),
        'recipe_version', COALESCE(r.version, 0),
        'recipe_lines', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'ingredient_product_id', rl.ingredient_product_id, 'name', ingredient.name,
            'sku', ingredient.sku, 'quantity', rl.quantity::text,
            'unit_cost', to_char(rl.unit_cost, 'FM999999999999990.00')
          ) ORDER BY rl.line_number)
          FROM bar_local.product_recipe_lines rl
          JOIN bar_local.products ingredient ON ingredient.id = rl.ingredient_product_id
          WHERE rl.recipe_id = r.id
        ), '[]'::jsonb)
      ) ORDER BY p.sku, p.id)
      FROM bar_local.products p
      LEFT JOIN bar_local.product_modifier_sets s ON s.business_id = p.business_id AND s.product_id = p.id
      LEFT JOIN bar_local.product_recipes r ON r.business_id = p.business_id AND r.product_id = p.id
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
