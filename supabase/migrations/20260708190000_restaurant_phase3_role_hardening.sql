begin;

-- Harden Phase 3 recipe reads and sale depletion with the same explicit
-- lodge-role gate used by later restaurant RPCs.

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
  v_recipe jsonb;
  v_ingredient jsonb;
  v_movement_count integer := 0;
  v_skipped_count integer := 0;
  v_depleted numeric;
  v_order_item_id uuid;
  v_inventory_item_id uuid;
  v_recipe_version integer;
  v_existing_count integer;
begin
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    select row_to_json(r) into v_recipe
    from public.restaurant_recipes r
    where r.lodge_id = v_lodge_id
      and r.menu_item_id = (nullif(v_item->>'menu_item_id', '')::uuid)
      and r.active = true
    limit 1;

    if v_recipe is null then
      continue;
    end if;

    v_order_item_id := nullif(v_item->>'order_item_id', '')::uuid;
    v_recipe_version := coalesce((v_recipe->>'version')::integer, 1);

    for v_ingredient in
      select row_to_json(ri) as ingredient
      from public.restaurant_recipe_ingredients ri
      where ri.recipe_id = (v_recipe->>'id')::uuid
        and ri.lodge_id = v_lodge_id
      order by ri.sort_order
    loop
      v_inventory_item_id := (v_ingredient->>'inventory_item_id')::uuid;
      v_depleted := coalesce(v_ingredient->>'quantity', 0)::numeric
                    * coalesce(v_item->>'quantity', 1)::numeric
                    * (1 + coalesce(v_ingredient->>'waste_percent', 0)::numeric / 100);

      if v_order_id is not null and v_order_item_id is not null then
        select count(*) into v_existing_count
        from public.restaurant_recipe_stock_movements
        where lodge_id = v_lodge_id
          and order_id = v_order_id
          and order_item_id = v_order_item_id
          and inventory_item_id = v_inventory_item_id
          and recipe_version = v_recipe_version;

        if v_existing_count > 0 then
          v_skipped_count := v_skipped_count + 1;
          continue;
        end if;
      end if;

      update public.inventory_items
         set current_stock = current_stock - v_depleted,
             updated_at = now()
       where id = v_inventory_item_id
         and lodge_id = v_lodge_id;

      insert into public.restaurant_recipe_stock_movements (
        lodge_id, recipe_id, order_id, order_item_id,
        inventory_item_id, quantity, unit, movement_reason,
        recipe_version, theoretical_cost
      ) values (
        v_lodge_id,
        (v_recipe->>'id')::uuid,
        v_order_id,
        v_order_item_id,
        v_inventory_item_id,
        -v_depleted,
        coalesce(v_ingredient->>'unit', 'each'),
        'pos_sale',
        v_recipe_version,
        null
      );

      v_movement_count := v_movement_count + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'success', true,
    'movements_created', v_movement_count,
    'movements_skipped', v_skipped_count
  );
end;
$$;

revoke all on function public.record_recipe_stock_depletion(jsonb) from public;
grant execute on function public.record_recipe_stock_depletion(jsonb)
  to anon, authenticated, service_role;

create or replace function public.get_restaurant_recipes(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_recipes jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'menu_item_id', r.menu_item_id,
      'name', r.name,
      'version', r.version,
      'serving_size', r.serving_size,
      'active', r.active,
      'created_at', r.created_at,
      'ingredients', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', ri.id,
            'inventory_item_id', ri.inventory_item_id,
            'inventory_item_name', ii.name,
            'quantity', ri.quantity,
            'unit', ri.unit,
            'waste_percent', ri.waste_percent,
            'sort_order', ri.sort_order,
            'latest_unit_cost', ii.latest_unit_cost
          ) order by ri.sort_order
        )
        from public.restaurant_recipe_ingredients ri
        left join public.inventory_items ii on ii.id = ri.inventory_item_id
        where ri.recipe_id = r.id and ri.lodge_id = p_lodge_id
      ), '[]'::jsonb)
    ) order by r.name
  ), '[]'::jsonb)
  into v_recipes
  from public.restaurant_recipes r
  where r.lodge_id = p_lodge_id;

  return coalesce(v_recipes, '[]'::jsonb);
end;
$$;

revoke all on function public.get_restaurant_recipes(uuid) from public;
grant execute on function public.get_restaurant_recipes(uuid)
  to anon, authenticated, service_role;

commit;
