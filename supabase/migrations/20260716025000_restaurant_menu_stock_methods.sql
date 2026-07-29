-- Make the stock method an explicit, server-enforced choice.  A packaged item
-- depletes one stock record, while food and cocktails must deplete ingredients
-- through a recipe.  A non-stock service is allowed only when deliberately set.

alter table public.pos_menu_items
  add column if not exists stock_method text not null default 'direct';

update public.pos_menu_items
   set stock_method = case
     when inventory_item_id is not null then 'direct'
     when public._pos_menu_item_has_stock_recipe(lodge_id, id) then 'recipe'
     else 'recipe'
   end;

alter table public.pos_menu_items
  drop constraint if exists pos_menu_items_stock_method_check;
alter table public.pos_menu_items
  add constraint pos_menu_items_stock_method_check
  check (stock_method in ('direct', 'recipe', 'non_stock'));

create or replace function public.restaurant_menu_category_requires_recipe(p_category text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select lower(btrim(coalesce(p_category, ''))) in
    ('breakfast', 'starters', 'mains', 'sides', 'desserts', 'cocktails', 'food');
$$;

-- Existing food/cocktail items are made safe drafts unless they already have a
-- complete recipe.  Historical sale lines remain untouched.
update public.pos_menu_items mi
   set stock_method = 'recipe',
       inventory_item_id = null,
       depletion_qty = null,
       is_available = public._pos_menu_item_has_stock_recipe(mi.lodge_id, mi.id),
       updated_at = now()
 where public.restaurant_menu_category_requires_recipe(mi.category);

create or replace function public.create_pos_menu_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_name text := btrim(coalesce(payload->>'name', ''));
  v_category text := coalesce(nullif(btrim(payload->>'category'), ''), 'Other');
  v_method text := lower(coalesce(nullif(payload->>'stock_method', ''), case when v_inventory_item_id is null then 'recipe' else 'direct' end));
  v_station_id uuid := nullif(payload->>'kitchen_station_id', '')::uuid;
  v_id uuid;
  v_available boolean;
begin
  if v_lodge_id is null or v_name = '' then return jsonb_build_object('success', false, 'error', 'lodge_id and name are required.'); end if;
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  if public.restaurant_menu_category_requires_recipe(v_category) then v_method := 'recipe'; end if;
  if v_method not in ('direct', 'recipe', 'non_stock') then return jsonb_build_object('success', false, 'error', 'Choose packaged/direct stock, recipe, or non-stock service.'); end if;
  if v_method = 'direct' and v_inventory_item_id is null then return jsonb_build_object('success', false, 'error', 'A packaged item needs a direct stock link before it can be sold.'); end if;
  if v_method <> 'direct' then v_inventory_item_id := null; end if;
  if v_inventory_item_id is not null and not exists (select 1 from public.inventory_items ii where ii.id = v_inventory_item_id and ii.lodge_id = v_lodge_id and (v_outlet_id is null or ii.outlet_id is null or ii.outlet_id = v_outlet_id)) then return jsonb_build_object('success', false, 'error', 'The selected stock item does not belong to this restaurant or outlet.'); end if;
  if v_station_id is not null and not exists (select 1 from public.pos_kitchen_stations s where s.id = v_station_id and s.lodge_id = v_lodge_id and s.enabled = true and (s.outlet_id is null or s.outlet_id = v_outlet_id)) then return jsonb_build_object('success', false, 'error', 'Station is disabled or does not serve this outlet.'); end if;
  v_available := case when v_method = 'recipe' then false when v_method = 'direct' then true else coalesce((payload->>'is_available')::boolean, true) end;
  insert into public.pos_menu_items (lodge_id, name, category, price, is_available, barcode, stock_method, inventory_item_id, depletion_qty, outlet_id, dietary_flags, prep_time_minutes, is_popular, kitchen_station_id)
  values (v_lodge_id, v_name, v_category, coalesce((payload->>'price')::numeric, 0), v_available, nullif(payload->>'barcode', ''), v_method, v_inventory_item_id, case when v_method = 'direct' then coalesce(nullif(payload->>'depletion_qty', '')::numeric, 1) else null end, v_outlet_id, coalesce(payload->'dietary_flags', '[]'::jsonb), coalesce((payload->>'prep_time_minutes')::integer, 0), coalesce((payload->>'is_popular')::boolean, false), v_station_id)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id, 'stock_method', v_method, 'recipe_required', v_method = 'recipe');
end;
$$;

create or replace function public.update_pos_menu_item(p_id uuid, p_lodge_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing public.pos_menu_items%rowtype;
  v_inventory_item_id uuid;
  v_outlet_id uuid;
  v_station_id uuid;
  v_category text;
  v_method text;
  v_available boolean;
  v_has_recipe boolean;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  select * into v_existing from public.pos_menu_items where id = p_id and lodge_id = p_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Menu item not found.'); end if;
  v_category := coalesce(nullif(btrim(payload->>'category'), ''), v_existing.category);
  v_method := lower(coalesce(nullif(payload->>'stock_method', ''), v_existing.stock_method, case when v_existing.inventory_item_id is null then 'recipe' else 'direct' end));
  if public.restaurant_menu_category_requires_recipe(v_category) then v_method := 'recipe'; end if;
  v_inventory_item_id := case when payload ? 'inventory_item_id' then nullif(payload->>'inventory_item_id', '')::uuid else v_existing.inventory_item_id end;
  v_outlet_id := case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else v_existing.outlet_id end;
  v_station_id := case when payload ? 'kitchen_station_id' then nullif(payload->>'kitchen_station_id', '')::uuid else v_existing.kitchen_station_id end;
  v_has_recipe := public._pos_menu_item_has_stock_recipe(p_lodge_id, p_id);
  if v_method not in ('direct', 'recipe', 'non_stock') then return jsonb_build_object('success', false, 'error', 'Choose packaged/direct stock, recipe, or non-stock service.'); end if;
  if v_method = 'direct' and v_inventory_item_id is null then return jsonb_build_object('success', false, 'error', 'A packaged item needs a direct stock link before it can be sold.'); end if;
  if v_method = 'direct' and v_has_recipe then return jsonb_build_object('success', false, 'error', 'Remove the recipe before changing this item to direct stock.'); end if;
  if v_method = 'non_stock' and v_has_recipe then return jsonb_build_object('success', false, 'error', 'Remove the recipe before changing this item to a non-stock service.'); end if;
  if v_method <> 'direct' then v_inventory_item_id := null; end if;
  if v_inventory_item_id is not null and not exists (select 1 from public.inventory_items ii where ii.id = v_inventory_item_id and ii.lodge_id = p_lodge_id and (v_outlet_id is null or ii.outlet_id is null or ii.outlet_id = v_outlet_id)) then return jsonb_build_object('success', false, 'error', 'The selected stock item does not belong to this restaurant or outlet.'); end if;
  if v_station_id is not null and not exists (select 1 from public.pos_kitchen_stations s where s.id = v_station_id and s.lodge_id = p_lodge_id and s.enabled = true and (s.outlet_id is null or s.outlet_id = v_outlet_id)) then return jsonb_build_object('success', false, 'error', 'Station is disabled or does not serve this outlet.'); end if;
  v_available := case when v_method = 'recipe' then v_has_recipe when v_method = 'direct' then coalesce((payload->>'is_available')::boolean, v_existing.is_available) else coalesce((payload->>'is_available')::boolean, v_existing.is_available) end;
  update public.pos_menu_items set name = coalesce(nullif(payload->>'name', ''), name), category = v_category, price = coalesce((payload->>'price')::numeric, price), is_available = v_available, barcode = payload->>'barcode', stock_method = v_method, inventory_item_id = v_inventory_item_id, depletion_qty = case when v_method = 'direct' then coalesce(nullif(payload->>'depletion_qty', '')::numeric, 1) else null end, outlet_id = v_outlet_id, dietary_flags = coalesce(payload->'dietary_flags', dietary_flags), prep_time_minutes = coalesce((payload->>'prep_time_minutes')::integer, prep_time_minutes), is_popular = coalesce((payload->>'is_popular')::boolean, is_popular), kitchen_station_id = v_station_id, updated_at = now() where id = p_id and lodge_id = p_lodge_id;
  return jsonb_build_object('success', true, 'recipe_required', v_method = 'recipe' and not v_has_recipe);
end;
$$;

create or replace function public.upsert_restaurant_recipe(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid; v_recipe_id uuid := coalesce(nullif(payload->>'recipe_id', '')::uuid, gen_random_uuid()); v_menu_item_id uuid := nullif(payload->>'menu_item_id', '')::uuid; v_name text := btrim(coalesce(payload->>'name', '')); v_version integer := greatest(1, coalesce(nullif(payload->>'version', '')::integer, 1)); v_serving_size numeric := greatest(0, coalesce(nullif(payload->>'serving_size', '')::numeric, 1)); v_ingredients jsonb := coalesce(payload->'ingredients', '[]'::jsonb); v_ingredient jsonb; v_count integer := 0;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_name = '' then return jsonb_build_object('success', false, 'error', 'Recipe name is required'); end if;
  if v_menu_item_id is not null and not exists (select 1 from public.pos_menu_items where id = v_menu_item_id and lodge_id = v_lodge_id for update) then return jsonb_build_object('success', false, 'error', 'The linked menu item does not belong to this restaurant'); end if;
  insert into public.restaurant_recipes (id, lodge_id, menu_item_id, name, version, serving_size, active, updated_at) values (v_recipe_id, v_lodge_id, v_menu_item_id, v_name, v_version, v_serving_size, coalesce((payload->>'active')::boolean, true), now()) on conflict (id) do update set menu_item_id = excluded.menu_item_id, name = excluded.name, version = excluded.version, serving_size = excluded.serving_size, active = excluded.active, updated_at = now() where public.restaurant_recipes.lodge_id = v_lodge_id;
  delete from public.restaurant_recipe_ingredients where recipe_id = v_recipe_id and lodge_id = v_lodge_id;
  for v_ingredient in select value from jsonb_array_elements(v_ingredients) loop
    if nullif(v_ingredient->>'inventory_item_id', '') is null or coalesce(nullif(v_ingredient->>'quantity', '')::numeric, 0) <= 0 then return jsonb_build_object('success', false, 'error', 'Each recipe ingredient needs a stock item and positive quantity'); end if;
    insert into public.restaurant_recipe_ingredients (id, lodge_id, recipe_id, inventory_item_id, quantity, unit, waste_percent, sort_order) values (coalesce(nullif(v_ingredient->>'id', '')::uuid, gen_random_uuid()), v_lodge_id, v_recipe_id, nullif(v_ingredient->>'inventory_item_id', '')::uuid, (v_ingredient->>'quantity')::numeric, btrim(coalesce(v_ingredient->>'unit', 'each')), greatest(0, coalesce(nullif(v_ingredient->>'waste_percent', '')::numeric, 0)), coalesce(nullif(v_ingredient->>'sort_order', '')::integer, 0)); v_count := v_count + 1;
  end loop;
  if v_count = 0 then return jsonb_build_object('success', false, 'error', 'A recipe needs at least one ingredient'); end if;
  if v_menu_item_id is not null then update public.pos_menu_items set stock_method = 'recipe', inventory_item_id = null, depletion_qty = null, is_available = coalesce((payload->>'active')::boolean, true), updated_at = now() where id = v_menu_item_id and lodge_id = v_lodge_id; end if;
  return jsonb_build_object('success', true, 'recipe_id', v_recipe_id, 'ingredient_count', v_count, 'menu_item_activated', v_menu_item_id is not null);
end;
$$;

create or replace function public.delete_restaurant_recipe(p_recipe_id uuid, p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_menu_item_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  select menu_item_id into v_menu_item_id from public.restaurant_recipes where id = p_recipe_id and lodge_id = p_lodge_id for update;
  delete from public.restaurant_recipes where id = p_recipe_id and lodge_id = p_lodge_id;
  if v_menu_item_id is not null then update public.pos_menu_items set is_available = false, updated_at = now() where id = v_menu_item_id and lodge_id = p_lodge_id and stock_method = 'recipe'; end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.enforce_pos_order_item_stock_readiness()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_menu public.pos_menu_items%rowtype; v_has_recipe boolean;
begin
  if new.menu_item_id is null then return new; end if;
  select * into v_menu from public.pos_menu_items where id = new.menu_item_id and lodge_id = new.lodge_id;
  if not found then raise exception 'Menu item does not belong to this restaurant.'; end if;
  v_has_recipe := public._pos_menu_item_has_stock_recipe(new.lodge_id, new.menu_item_id);
  if not v_menu.is_available then raise exception 'This menu item is not available until its stock setup is complete.'; end if;
  if (v_menu.stock_method = 'direct' and (v_menu.inventory_item_id is null or v_has_recipe)) or (v_menu.stock_method = 'recipe' and (v_menu.inventory_item_id is not null or not v_has_recipe)) or (v_menu.stock_method = 'non_stock' and (v_menu.inventory_item_id is not null or v_has_recipe)) then raise exception 'This menu item no longer matches its configured stock method.'; end if;
  return new;
end;
$$;

revoke all on function public.restaurant_menu_category_requires_recipe(text) from public;
revoke all on function public.create_pos_menu_item(jsonb) from public;
grant execute on function public.create_pos_menu_item(jsonb) to authenticated, service_role;
revoke all on function public.update_pos_menu_item(uuid, uuid, jsonb) from public;
grant execute on function public.update_pos_menu_item(uuid, uuid, jsonb) to authenticated, service_role;
