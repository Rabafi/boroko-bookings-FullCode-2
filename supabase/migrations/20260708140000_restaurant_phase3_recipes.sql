begin;

-- Restaurant recipes: links a menu item to its multi-ingredient composition
create table if not exists public.restaurant_recipes (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  menu_item_id uuid references public.pos_menu_items(id) on delete set null,
  name text not null,
  version integer not null default 1,
  serving_size numeric not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists restaurant_recipes_lodge_menu_idx
  on public.restaurant_recipes (lodge_id, menu_item_id)
  where active = true and menu_item_id is not null;

alter table public.restaurant_recipes enable row level security;

create policy restaurant_recipes_lodge_scope_select on public.restaurant_recipes
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_recipes_lodge_scope_insert on public.restaurant_recipes
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_recipes_lodge_scope_update on public.restaurant_recipes
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_recipes_lodge_scope_delete on public.restaurant_recipes
  for delete using (public.app_lodge_access(lodge_id));

-- Recipe ingredients: individual ingredient lines for each recipe
create table if not exists public.restaurant_recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  recipe_id uuid not null references public.restaurant_recipes(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric not null default 0,
  unit text not null default 'each',
  waste_percent numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_recipe_ingredients enable row level security;

create policy restaurant_recipe_ingredients_lodge_scope_select on public.restaurant_recipe_ingredients
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_recipe_ingredients_lodge_scope_insert on public.restaurant_recipe_ingredients
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_recipe_ingredients_lodge_scope_update on public.restaurant_recipe_ingredients
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_recipe_ingredients_lodge_scope_delete on public.restaurant_recipe_ingredients
  for delete using (public.app_lodge_access(lodge_id));

-- Recipe stock movements: tracks theoretical depletion per recipe sale
create table if not exists public.restaurant_recipe_stock_movements (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  recipe_id uuid references public.restaurant_recipes(id) on delete set null,
  order_id uuid,
  order_item_id uuid,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric not null,
  unit text not null default 'each',
  movement_reason text not null default 'pos_sale',
  recipe_version integer not null default 1,
  theoretical_cost numeric,
  created_at timestamptz not null default now()
);

-- Unique guard: prevent duplicate depletion for same order+item+ingredient+version
create unique index if not exists restaurant_recipe_stock_movements_dedup_idx
  on public.restaurant_recipe_stock_movements (lodge_id, order_id, order_item_id, inventory_item_id, recipe_version)
  where order_id is not null and order_item_id is not null;

alter table public.restaurant_recipe_stock_movements enable row level security;

create policy restaurant_recipe_stock_movements_lodge_scope_select on public.restaurant_recipe_stock_movements
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_recipe_stock_movements_lodge_scope_insert on public.restaurant_recipe_stock_movements
  for insert with check (public.app_lodge_access(lodge_id));

-- RPC: Upsert a recipe with its ingredients
create or replace function public.upsert_restaurant_recipe(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_recipe_id uuid := coalesce(nullif(payload->>'recipe_id', '')::uuid, gen_random_uuid());
  v_menu_item_id uuid := nullif(payload->>'menu_item_id', '')::uuid;
  v_name text := btrim(coalesce(payload->>'name', ''));
  v_version integer := greatest(1, coalesce(nullif(payload->>'version', '')::integer, 1));
  v_serving_size numeric := greatest(0, coalesce(nullif(payload->>'serving_size', '')::numeric, 1));
  v_ingredients jsonb := coalesce(payload->'ingredients', '[]'::jsonb);
  v_ingredient jsonb;
  v_count integer := 0;
begin
  perform public.app_require_lodge_role(
    v_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  if v_name = '' then
    return jsonb_build_object('success', false, 'error', 'Recipe name is required');
  end if;

  -- Upsert recipe header
  insert into public.restaurant_recipes (
    id, lodge_id, menu_item_id, name, version, serving_size, active, updated_at
  ) values (
    v_recipe_id, v_lodge_id, v_menu_item_id, v_name, v_version, v_serving_size,
    coalesce((payload->>'active')::boolean, true), now()
  )
  on conflict (id) do update set
    menu_item_id = excluded.menu_item_id,
    name = excluded.name,
    version = excluded.version,
    serving_size = excluded.serving_size,
    active = excluded.active,
    updated_at = now()
  where public.restaurant_recipes.lodge_id = v_lodge_id;

  -- Replace ingredients
  delete from public.restaurant_recipe_ingredients
   where recipe_id = v_recipe_id
     and lodge_id = v_lodge_id;

  for v_ingredient in select value from jsonb_array_elements(v_ingredients)
  loop
    if nullif(v_ingredient->>'inventory_item_id', '') is null then
      return jsonb_build_object('success', false, 'error', 'Each ingredient must have an inventory_item_id');
    end if;
    if coalesce(nullif(v_ingredient->>'quantity', '')::numeric, 0) <= 0 then
      return jsonb_build_object('success', false, 'error', 'Each ingredient quantity must be greater than zero');
    end if;

    insert into public.restaurant_recipe_ingredients (
      id, lodge_id, recipe_id, inventory_item_id, quantity, unit, waste_percent, sort_order
    ) values (
      coalesce(nullif(v_ingredient->>'id', '')::uuid, gen_random_uuid()),
      v_lodge_id,
      v_recipe_id,
      nullif(v_ingredient->>'inventory_item_id', '')::uuid,
      coalesce(nullif(v_ingredient->>'quantity', '')::numeric, 0),
      btrim(coalesce(v_ingredient->>'unit', 'each')),
      greatest(0, coalesce(nullif(v_ingredient->>'waste_percent', '')::numeric, 0)),
      coalesce(nullif(v_ingredient->>'sort_order', '')::integer, 0)
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'recipe_id', v_recipe_id,
    'ingredient_count', v_count
  );
end;
$$;

revoke all on function public.upsert_restaurant_recipe(jsonb) from public;
grant execute on function public.upsert_restaurant_recipe(jsonb)
  to anon, authenticated, service_role;

-- RPC: Delete a recipe
create or replace function public.delete_restaurant_recipe(p_recipe_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  delete from public.restaurant_recipes
   where id = p_recipe_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.delete_restaurant_recipe(uuid, uuid) from public;
grant execute on function public.delete_restaurant_recipe(uuid, uuid)
  to anon, authenticated, service_role;

-- RPC: Record recipe-based stock depletion for an order (idempotent)
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
  for v_item in select value from jsonb_array_elements(v_items)
  loop
    -- Find active recipe for this menu item
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

    -- Deplete each ingredient
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

      -- Idempotency guard: skip if movement already exists for this order+item+ingredient+version
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

      -- Update inventory stock
      update public.inventory_items
         set current_stock = current_stock - v_depleted,
             updated_at = now()
       where id = v_inventory_item_id
         and lodge_id = v_lodge_id;

      -- Record movement
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

-- RPC: Get recipes for a lodge with ingredient details
create or replace function public.get_restaurant_recipes(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_recipes jsonb;
begin
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
