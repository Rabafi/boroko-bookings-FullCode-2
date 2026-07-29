-- Recipe quantities may use a smaller compatible unit than inventory, but the
-- business stock, valuation and ledger always remain in the inventory unit.
create or replace function public.restaurant_recipe_quantity_in_inventory_unit(p_quantity numeric, p_recipe_unit text, p_inventory_unit text)
returns numeric language plpgsql immutable as $$
declare r text := lower(trim(coalesce(p_recipe_unit, 'each'))); i text := lower(trim(coalesce(p_inventory_unit, 'each')));
begin
  r := case when r in ('l', 'litre', 'liter', 'litres', 'liters') then 'litre' when r in ('ml', 'millilitre', 'milliliter') then 'ml' when r in ('g', 'gram', 'grams') then 'g' when r in ('kg', 'kilogram', 'kilograms') then 'kg' else r end;
  i := case when i in ('l', 'litre', 'liter', 'litres', 'liters') then 'litre' when i in ('ml', 'millilitre', 'milliliter') then 'ml' when i in ('g', 'gram', 'grams') then 'g' when i in ('kg', 'kilogram', 'kilograms') then 'kg' else i end;
  if r = i then return p_quantity; end if;
  if r = 'ml' and i = 'litre' then return p_quantity / 1000; end if;
  if r = 'litre' and i = 'ml' then return p_quantity * 1000; end if;
  if r = 'g' and i = 'kg' then return p_quantity / 1000; end if;
  if r = 'kg' and i = 'g' then return p_quantity * 1000; end if;
  raise exception 'Recipe unit % is not compatible with the inventory counting unit %.', p_recipe_unit, p_inventory_unit;
end; $$;

create or replace function public.enforce_restaurant_recipe_ingredient_unit()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_inventory_unit text;
begin
  select unit into v_inventory_unit from public.inventory_items where id = new.inventory_item_id and lodge_id = new.lodge_id;
  if v_inventory_unit is null then raise exception 'Recipe stock item does not belong to this restaurant.'; end if;
  perform public.restaurant_recipe_quantity_in_inventory_unit(new.quantity, new.unit, v_inventory_unit);
  return new;
end; $$;
drop trigger if exists trg_restaurant_recipe_ingredient_unit on public.restaurant_recipe_ingredients;
create trigger trg_restaurant_recipe_ingredient_unit before insert or update of inventory_item_id, quantity, unit on public.restaurant_recipe_ingredients for each row execute function public.enforce_restaurant_recipe_ingredient_unit();

create or replace function public.set_inventory_unit_cost(p_item_id uuid, p_lodge_id uuid, p_unit_cost numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_before numeric; v_after public.inventory_items%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  if p_unit_cost is null or p_unit_cost < 0 then return jsonb_build_object('success', false, 'error', 'Unit cost cannot be negative.'); end if;
  select latest_unit_cost into v_before from public.inventory_items where id = p_item_id and lodge_id = p_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Inventory item not found.'); end if;
  update public.inventory_items set latest_unit_cost = p_unit_cost, updated_at = now() where id = p_item_id and lodge_id = p_lodge_id returning * into v_after;
  insert into public.inventory_movements (lodge_id,item_id,movement_type,quantity,unit_cost,total_cost,notes,reference_type,reference_id,source,created_by) values (p_lodge_id,p_item_id,'cost_correction',0,p_unit_cost,0,format('Unit cost corrected from %s to %s',v_before,p_unit_cost),'inventory_cost_correction',p_item_id,'inventory',public.app_current_user_id());
  return jsonb_build_object('success', true, 'item', to_jsonb(v_after));
end; $$;

create or replace function public.get_restaurant_recipes(p_lodge_id uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_recipes jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'menu_item_id',r.menu_item_id,'menu_item_name',mi.name,'selling_price',mi.price,'name',r.name,'version',r.version,'serving_size',r.serving_size,'active',r.active,'created_at',r.created_at,'ingredients',coalesce((select jsonb_agg(jsonb_build_object('id',ri.id,'inventory_item_id',ri.inventory_item_id,'inventory_item_name',ii.name,'inventory_unit',ii.unit,'quantity',ri.quantity,'unit',ri.unit,'waste_percent',ri.waste_percent,'sort_order',ri.sort_order,'latest_unit_cost',ii.latest_unit_cost,'recipe_unit_cost',ii.latest_unit_cost * public.restaurant_recipe_quantity_in_inventory_unit(1,ri.unit,ii.unit)) order by ri.sort_order) from public.restaurant_recipe_ingredients ri join public.inventory_items ii on ii.id=ri.inventory_item_id and ii.lodge_id=r.lodge_id where ri.recipe_id=r.id and ri.lodge_id=p_lodge_id),'[]'::jsonb)) order by r.name),'[]'::jsonb) into v_recipes from public.restaurant_recipes r left join public.pos_menu_items mi on mi.id=r.menu_item_id and mi.lodge_id=r.lodge_id where r.lodge_id=p_lodge_id;
  return v_recipes;
end; $$;

create or replace function public.record_recipe_stock_depletion(payload jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid; v_order_id uuid:=nullif(payload->>'order_id','')::uuid; v_item jsonb; v_recipe public.restaurant_recipes%rowtype; v_ing record; v_order_item_id uuid; v_depleted numeric; v_cost numeric; v_count integer:=0; v_skipped integer:=0;
begin
  if v_lodge_id is null or v_order_id is null then return jsonb_build_object('success',false,'error','lodge_id and order_id are required.'); end if;
  perform public.app_require_lodge_role(v_lodge_id,array['cashier','supervisor','manager','admin','super_admin']);
  for v_item in select value from jsonb_array_elements(coalesce(payload->'items','[]'::jsonb)) loop
    select * into v_recipe from public.restaurant_recipes where lodge_id=v_lodge_id and menu_item_id=nullif(v_item->>'menu_item_id','')::uuid and active=true limit 1; if not found then continue; end if;
    select id into v_order_item_id from public.pos_order_items where lodge_id=v_lodge_id and order_id=v_order_id and menu_item_id=v_recipe.menu_item_id limit 1; if v_order_item_id is null then return jsonb_build_object('success',false,'error','Order line was not found for recipe stock depletion.'); end if;
    for v_ing in select ri.inventory_item_id,ri.quantity,ri.unit,ri.waste_percent,ii.unit inventory_unit,ii.latest_unit_cost from public.restaurant_recipe_ingredients ri join public.inventory_items ii on ii.id=ri.inventory_item_id and ii.lodge_id=ri.lodge_id where ri.recipe_id=v_recipe.id and ri.lodge_id=v_lodge_id and ri.quantity>0 loop
      if exists(select 1 from public.restaurant_recipe_stock_movements m where m.lodge_id=v_lodge_id and m.order_id=v_order_id and m.order_item_id=v_order_item_id and m.inventory_item_id=v_ing.inventory_item_id and m.recipe_version=v_recipe.version) then v_skipped:=v_skipped+1; continue; end if;
      v_depleted:=public.restaurant_recipe_quantity_in_inventory_unit(v_ing.quantity,v_ing.unit,v_ing.inventory_unit)*coalesce((v_item->>'quantity')::numeric,1)*(1+coalesce(v_ing.waste_percent,0)/100); v_cost:=coalesce(v_ing.latest_unit_cost,0);
      update public.inventory_items set current_stock=coalesce(current_stock,0)-v_depleted,updated_at=now() where id=v_ing.inventory_item_id and lodge_id=v_lodge_id;
      insert into public.restaurant_recipe_stock_movements(lodge_id,recipe_id,order_id,order_item_id,inventory_item_id,quantity,unit,movement_reason,recipe_version,theoretical_cost) values(v_lodge_id,v_recipe.id,v_order_id,v_order_item_id,v_ing.inventory_item_id,-v_depleted,v_ing.inventory_unit,'pos_sale',v_recipe.version,v_depleted*v_cost);
      insert into public.inventory_movements(lodge_id,item_id,movement_type,quantity,unit_cost,total_cost,notes,reference_type,reference_id,source,created_by) values(v_lodge_id,v_ing.inventory_item_id,'recipe_sale',-v_depleted,v_cost,-v_depleted*v_cost,format('Recipe sale: %s',v_recipe.name),'restaurant_recipe_sale',v_order_id,'restaurant_recipe',public.app_current_user_id()); v_count:=v_count+1;
    end loop;
  end loop;
  return jsonb_build_object('success',true,'movements_created',v_count,'movements_skipped',v_skipped);
end; $$;

revoke all on function public.set_inventory_unit_cost(uuid,uuid,numeric) from public;
grant execute on function public.set_inventory_unit_cost(uuid,uuid,numeric) to authenticated,service_role;
