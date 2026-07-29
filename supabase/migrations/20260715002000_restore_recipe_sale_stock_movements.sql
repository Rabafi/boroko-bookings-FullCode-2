-- Restore real recipe depletion after the lint-repair migration installed a
-- placeholder implementation. A recipe sale must update on-hand stock and the
-- standard inventory ledger exactly once.

create or replace function public.record_recipe_stock_depletion(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_item jsonb;
  v_recipe public.restaurant_recipes%rowtype;
  v_ingredient record;
  v_movement_count integer := 0;
  v_skipped_count integer := 0;
  v_depleted numeric;
  v_order_item_id uuid;
  v_unit_cost numeric;
  v_actor_raw text := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor uuid := case when v_actor_raw ~ '^[0-9a-fA-F-]{36}$' then v_actor_raw::uuid else null end;
begin
  if v_lodge_id is null or v_order_id is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id and order_id are required.');
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    if nullif(v_item->>'menu_item_id', '') is null or coalesce((v_item->>'quantity')::numeric, 0) <= 0 then
      continue;
    end if;

    select * into v_recipe
      from public.restaurant_recipes
     where lodge_id = v_lodge_id
       and menu_item_id = (v_item->>'menu_item_id')::uuid
       and active = true
     limit 1;
    if not found then continue; end if;

    -- The renderer's cart-line id is not a database UUID. Resolve the
    -- authoritative order-line id so recipe depletion remains retry-safe.
    select id into v_order_item_id
      from public.pos_order_items
     where lodge_id = v_lodge_id
       and order_id = v_order_id
       and menu_item_id = v_recipe.menu_item_id
     limit 1;
    if v_order_item_id is null then
      return jsonb_build_object('success', false, 'error', 'Order line was not found for recipe stock depletion.');
    end if;

    for v_ingredient in
      select ri.inventory_item_id, ri.quantity, ri.unit, ri.waste_percent
        from public.restaurant_recipe_ingredients ri
       where ri.recipe_id = v_recipe.id
         and ri.lodge_id = v_lodge_id
         and ri.quantity > 0
       order by ri.sort_order
    loop
      if exists (
        select 1 from public.restaurant_recipe_stock_movements rsm
         where rsm.lodge_id = v_lodge_id
           and rsm.order_id = v_order_id
           and rsm.order_item_id = v_order_item_id
           and rsm.inventory_item_id = v_ingredient.inventory_item_id
           and rsm.recipe_version = v_recipe.version
      ) then
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;

      v_depleted := v_ingredient.quantity * coalesce((v_item->>'quantity')::numeric, 1)
        * (1 + coalesce(v_ingredient.waste_percent, 0) / 100);

      select coalesce(latest_unit_cost, 0) into v_unit_cost
        from public.inventory_items
       where id = v_ingredient.inventory_item_id
         and lodge_id = v_lodge_id
       for update;
      if not found then
        return jsonb_build_object('success', false, 'error', 'A recipe ingredient no longer belongs to this restaurant.');
      end if;

      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) - v_depleted,
             updated_at = now()
       where id = v_ingredient.inventory_item_id
         and lodge_id = v_lodge_id;

      insert into public.restaurant_recipe_stock_movements (
        lodge_id, recipe_id, order_id, order_item_id, inventory_item_id,
        quantity, unit, movement_reason, recipe_version, theoretical_cost
      ) values (
        v_lodge_id, v_recipe.id, v_order_id, v_order_item_id, v_ingredient.inventory_item_id,
        -v_depleted, coalesce(v_ingredient.unit, 'each'), 'pos_sale', v_recipe.version,
        v_depleted * v_unit_cost
      );

      insert into public.inventory_movements (
        lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
        notes, reference_type, reference_id, source, created_by
      ) values (
        v_lodge_id, v_ingredient.inventory_item_id, 'recipe_sale', -v_depleted, v_unit_cost,
        -v_depleted * v_unit_cost, format('Recipe sale: %s', v_recipe.name),
        'restaurant_recipe_sale', v_order_id, 'restaurant_recipe', v_actor
      );
      v_movement_count := v_movement_count + 1;
    end loop;
  end loop;

  return jsonb_build_object('success', true, 'movements_created', v_movement_count, 'movements_skipped', v_skipped_count);
end;
$$;

revoke all on function public.record_recipe_stock_depletion(jsonb) from public;
grant execute on function public.record_recipe_stock_depletion(jsonb) to authenticated, service_role;
