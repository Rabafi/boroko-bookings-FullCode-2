-- A menu draft may exist while a recipe is being configured, but a sellable
-- Restaurant & Bar item must consume either one direct stock item or a recipe.

create or replace function public._pos_menu_item_has_stock_recipe(
  p_lodge_id uuid,
  p_menu_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.restaurant_recipes r
      join public.restaurant_recipe_ingredients ri
        on ri.recipe_id = r.id
       and ri.lodge_id = r.lodge_id
     where r.lodge_id = p_lodge_id
       and r.menu_item_id = p_menu_item_id
       and r.active = true
       and ri.quantity > 0
  );
$$;

create or replace function public.create_pos_menu_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_name text := trim(payload->>'name');
  v_station_id uuid := nullif(payload->>'kitchen_station_id', '')::uuid;
  v_id uuid;
begin
  if v_lodge_id is null or v_name = '' then
    return jsonb_build_object('success', false, 'error', 'lodge_id and name are required.');
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if coalesce((payload->>'is_available')::boolean, true) and v_inventory_item_id is null then
    return jsonb_build_object('success', false, 'error', 'A new menu item needs a direct stock link before it can be available. Save it as a draft, then link a recipe and make it available.');
  end if;
  if v_inventory_item_id is not null and not exists (
    select 1 from public.inventory_items ii
     where ii.id = v_inventory_item_id and ii.lodge_id = v_lodge_id
       and (v_outlet_id is null or ii.outlet_id is null or ii.outlet_id = v_outlet_id)
  ) then
    return jsonb_build_object('success', false, 'error', 'The selected stock item does not belong to this restaurant or outlet.');
  end if;
  if v_station_id is not null and not exists (
    select 1 from public.pos_kitchen_stations s
     where s.id = v_station_id and s.lodge_id = v_lodge_id and s.enabled = true
       and (s.outlet_id is null or s.outlet_id = v_outlet_id)
  ) then
    return jsonb_build_object('success', false, 'error', 'Station is disabled or does not serve this outlet.');
  end if;

  insert into public.pos_menu_items (
    lodge_id, name, category, price, is_available, barcode, inventory_item_id,
    depletion_qty, outlet_id, dietary_flags, prep_time_minutes, is_popular, kitchen_station_id
  ) values (
    v_lodge_id, v_name, coalesce(nullif(payload->>'category', ''), 'Other'),
    coalesce((payload->>'price')::numeric, 0), coalesce((payload->>'is_available')::boolean, true),
    nullif(payload->>'barcode', ''), v_inventory_item_id,
    case when v_inventory_item_id is null then null else coalesce(nullif(payload->>'depletion_qty', '')::numeric, 1) end,
    v_outlet_id, coalesce(payload->'dietary_flags', '[]'::jsonb),
    coalesce((payload->>'prep_time_minutes')::integer, 0), coalesce((payload->>'is_popular')::boolean, false), v_station_id
  ) returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
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
  v_available boolean;
  v_has_recipe boolean;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  select * into v_existing from public.pos_menu_items where id = p_id and lodge_id = p_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Menu item not found.'); end if;

  v_inventory_item_id := case when payload ? 'inventory_item_id' then nullif(payload->>'inventory_item_id', '')::uuid else v_existing.inventory_item_id end;
  v_outlet_id := case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else v_existing.outlet_id end;
  v_station_id := case when payload ? 'kitchen_station_id' then nullif(payload->>'kitchen_station_id', '')::uuid else v_existing.kitchen_station_id end;
  v_available := coalesce((payload->>'is_available')::boolean, v_existing.is_available);
  v_has_recipe := public._pos_menu_item_has_stock_recipe(p_lodge_id, p_id);

  if v_inventory_item_id is not null and not exists (
    select 1 from public.inventory_items ii
     where ii.id = v_inventory_item_id and ii.lodge_id = p_lodge_id
       and (v_outlet_id is null or ii.outlet_id is null or ii.outlet_id = v_outlet_id)
  ) then return jsonb_build_object('success', false, 'error', 'The selected stock item does not belong to this restaurant or outlet.'); end if;
  if v_station_id is not null and not exists (
    select 1 from public.pos_kitchen_stations s
     where s.id = v_station_id and s.lodge_id = p_lodge_id and s.enabled = true
       and (s.outlet_id is null or s.outlet_id = v_outlet_id)
  ) then return jsonb_build_object('success', false, 'error', 'Station is disabled or does not serve this outlet.'); end if;
  if v_available and v_inventory_item_id is null and not v_has_recipe then
    return jsonb_build_object('success', false, 'error', 'Add a direct stock link or a recipe with ingredients before making this menu item available.');
  end if;
  if v_available and v_inventory_item_id is not null and v_has_recipe then
    return jsonb_build_object('success', false, 'error', 'Choose one stock method: direct stock link for a packaged item, or recipe ingredients for a prepared item.');
  end if;

  update public.pos_menu_items set
    name = coalesce(nullif(payload->>'name', ''), name), category = coalesce(nullif(payload->>'category', ''), category),
    price = coalesce((payload->>'price')::numeric, price), is_available = v_available, barcode = payload->>'barcode',
    inventory_item_id = v_inventory_item_id,
    depletion_qty = case when v_inventory_item_id is null then null else coalesce(nullif(payload->>'depletion_qty', '')::numeric, 1) end,
    outlet_id = v_outlet_id, dietary_flags = coalesce(payload->'dietary_flags', dietary_flags),
    prep_time_minutes = coalesce((payload->>'prep_time_minutes')::integer, prep_time_minutes),
    is_popular = coalesce((payload->>'is_popular')::boolean, is_popular), kitchen_station_id = v_station_id, updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public._pos_menu_item_has_stock_recipe(uuid, uuid) from public;
revoke all on function public.create_pos_menu_item(jsonb) from public;
grant execute on function public.create_pos_menu_item(jsonb) to authenticated, service_role;
revoke all on function public.update_pos_menu_item(uuid, uuid, jsonb) from public;
grant execute on function public.update_pos_menu_item(uuid, uuid, jsonb) to authenticated, service_role;

-- Existing untracked items become drafts for manager repair. Their sales history
-- remains untouched; only future Till availability changes.
update public.pos_menu_items mi
   set is_available = false,
       updated_at = now()
 where mi.is_available = true
   and (
     (mi.inventory_item_id is null and not public._pos_menu_item_has_stock_recipe(mi.lodge_id, mi.id))
     or
     (mi.inventory_item_id is not null and public._pos_menu_item_has_stock_recipe(mi.lodge_id, mi.id))
   );

-- Do not allow a stale catalogue snapshot or another client to sell an item
-- that has not passed the same stock-readiness rule.
create or replace function public.enforce_pos_order_item_stock_readiness()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_menu public.pos_menu_items%rowtype;
  v_has_recipe boolean;
begin
  if new.menu_item_id is null then return new; end if;
  select * into v_menu from public.pos_menu_items
   where id = new.menu_item_id and lodge_id = new.lodge_id;
  if not found then raise exception 'Menu item does not belong to this restaurant.'; end if;
  v_has_recipe := public._pos_menu_item_has_stock_recipe(new.lodge_id, new.menu_item_id);
  if not v_menu.is_available then
    raise exception 'This menu item is not available until its stock setup is complete.';
  end if;
  if (v_menu.inventory_item_id is null and not v_has_recipe)
     or (v_menu.inventory_item_id is not null and v_has_recipe) then
    raise exception 'This menu item needs one stock method: direct stock link or recipe ingredients.';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_order_item_stock_readiness on public.pos_order_items;
create trigger pos_order_item_stock_readiness
before insert or update of menu_item_id on public.pos_order_items
for each row execute function public.enforce_pos_order_item_stock_readiness();
