-- Sales outlets and physical stock locations are deliberately separate.
-- A small venue starts with one shared location; larger venues can map each
-- outlet to a distinct location and transfer custody between locations.

create table if not exists public.restaurant_stock_locations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, name)
);

create unique index if not exists restaurant_stock_locations_one_default
  on public.restaurant_stock_locations (lodge_id) where is_default and is_active;

create table if not exists public.restaurant_outlet_stock_locations (
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  outlet_id uuid primary key references public.outlets(id) on delete cascade,
  stock_location_id uuid not null references public.restaurant_stock_locations(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurant_stock_location_balances (
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  stock_location_id uuid not null references public.restaurant_stock_locations(id) on delete restrict,
  quantity numeric not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (inventory_item_id, stock_location_id)
);

create index if not exists restaurant_stock_location_balances_lookup
  on public.restaurant_stock_location_balances (lodge_id, stock_location_id, inventory_item_id);

alter table public.restaurant_stock_locations enable row level security;
alter table public.restaurant_outlet_stock_locations enable row level security;
alter table public.restaurant_stock_location_balances enable row level security;

-- Every existing business gets a safe shared starting location. Existing stock
-- was previously only business-wide or outlet-labelled, so it is consolidated
-- into this explicit shared pool rather than guessed into a kitchen or bar.
insert into public.restaurant_stock_locations (lodge_id, name, is_default)
select distinct ii.lodge_id, 'Shared business stock', true
from public.inventory_items ii
on conflict (lodge_id, name) do nothing;

insert into public.restaurant_outlet_stock_locations (lodge_id, outlet_id, stock_location_id)
select o.lodge_id, o.id, l.id
from public.outlets o
join public.restaurant_stock_locations l on l.lodge_id = o.lodge_id and l.is_default and l.is_active
on conflict (outlet_id) do nothing;

insert into public.restaurant_stock_location_balances (lodge_id, inventory_item_id, stock_location_id, quantity)
select ii.lodge_id, ii.id, l.id, greatest(coalesce(ii.current_stock, 0), 0)
from public.inventory_items ii
join public.restaurant_stock_locations l on l.lodge_id = ii.lodge_id and l.is_default and l.is_active
where coalesce(ii.current_stock, 0) > 0
on conflict (inventory_item_id, stock_location_id) do nothing;

alter table public.restaurant_purchase_orders
  add column if not exists stock_location_id uuid references public.restaurant_stock_locations(id) on delete restrict;

create or replace function public.restaurant_default_stock_location(p_lodge_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_location_id uuid;
begin
  select id into v_location_id from public.restaurant_stock_locations
   where lodge_id = p_lodge_id and is_default and is_active limit 1;
  if v_location_id is null then
    insert into public.restaurant_stock_locations (lodge_id, name, is_default)
    values (p_lodge_id, 'Shared business stock', true)
    on conflict (lodge_id, name) do update set is_active = true
    returning id into v_location_id;
  end if;
  return v_location_id;
end;
$$;

create or replace function public.restaurant_apply_stock_location_balance(
  p_lodge_id uuid, p_inventory_item_id uuid, p_stock_location_id uuid, p_delta numeric
) returns numeric language plpgsql security definer set search_path = public as $$
declare v_quantity numeric;
begin
  if p_stock_location_id is null then raise exception 'A stock location is required'; end if;
  insert into public.restaurant_stock_location_balances (lodge_id, inventory_item_id, stock_location_id, quantity, updated_at)
  values (p_lodge_id, p_inventory_item_id, p_stock_location_id, p_delta, now())
  on conflict (inventory_item_id, stock_location_id) do update
    set quantity = public.restaurant_stock_location_balances.quantity + excluded.quantity, updated_at = now()
  returning quantity into v_quantity;
  if v_quantity < 0 then raise exception 'Insufficient stock in the selected stock location'; end if;
  return v_quantity;
end;
$$;

create or replace function public.get_restaurant_stock_locations(p_lodge_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'is_default', l.is_default, 'is_active', l.is_active, 'outlet_count', coalesce(m.outlet_count, 0), 'outlet_ids', coalesce(m.outlet_ids, '[]'::jsonb)) order by l.is_default desc, l.name)
    from public.restaurant_stock_locations l
    left join (select stock_location_id, count(*)::int as outlet_count, jsonb_agg(outlet_id) as outlet_ids from public.restaurant_outlet_stock_locations where lodge_id = p_lodge_id group by stock_location_id) m on m.stock_location_id = l.id
    where l.lodge_id = p_lodge_id), '[]'::jsonb);
end;
$$;

create or replace function public.create_restaurant_stock_location(p_lodge_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := nullif(btrim(coalesce(p_payload->>'name', '')), ''); v_id uuid; v_default boolean := coalesce((p_payload->>'is_default')::boolean, false);
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_name is null then return jsonb_build_object('success', false, 'error', 'Stock location name is required'); end if;
  if v_default then update public.restaurant_stock_locations set is_default = false, updated_at = now() where lodge_id = p_lodge_id and is_default; end if;
  insert into public.restaurant_stock_locations (lodge_id, name, is_default) values (p_lodge_id, v_name, v_default)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.set_restaurant_outlet_stock_location(p_lodge_id uuid, p_outlet_id uuid, p_stock_location_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  if not exists (select 1 from public.outlets where id = p_outlet_id and lodge_id = p_lodge_id and is_active) then return jsonb_build_object('success', false, 'error', 'Choose an active sales outlet from this business'); end if;
  if not exists (select 1 from public.restaurant_stock_locations where id = p_stock_location_id and lodge_id = p_lodge_id and is_active) then return jsonb_build_object('success', false, 'error', 'Choose an active stock location from this business'); end if;
  insert into public.restaurant_outlet_stock_locations (lodge_id, outlet_id, stock_location_id, updated_at)
  values (p_lodge_id, p_outlet_id, p_stock_location_id, now())
  on conflict (outlet_id) do update set stock_location_id = excluded.stock_location_id, updated_at = now();
  return jsonb_build_object('success', true);
end;
$$;

-- A PO has one delivery location. An item remains a business-wide catalogue row.
create or replace function public.create_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid; v_order_id uuid := gen_random_uuid(); v_supplier_id uuid := nullif(payload->>'supplier_id', '')::uuid; v_location_id uuid := coalesce(nullif(payload->>'stock_location_id', '')::uuid, public.restaurant_default_stock_location(v_lodge_id)); v_items jsonb := coalesce(payload->'items', '[]'::jsonb); v_item jsonb; v_total numeric := 0; v_quantity numeric; v_unit_cost numeric; v_item_id uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_supplier_id is null or not exists (select 1 from public.restaurant_suppliers where id = v_supplier_id and lodge_id = v_lodge_id) then return jsonb_build_object('success', false, 'error', 'Choose a supplier from this business'); end if;
  if not exists (select 1 from public.restaurant_stock_locations where id = v_location_id and lodge_id = v_lodge_id and is_active) then return jsonb_build_object('success', false, 'error', 'Choose an active stock location'); end if;
  if jsonb_array_length(v_items) = 0 then return jsonb_build_object('success', false, 'error', 'Add at least one stock item with a positive quantity'); end if;
  insert into public.restaurant_purchase_orders (id, lodge_id, supplier_id, stock_location_id, expected_delivery, notes, status, created_by) values (v_order_id, v_lodge_id, v_supplier_id, v_location_id, nullif(payload->>'expected_delivery', '')::timestamptz, nullif(payload->>'notes', ''), 'draft', auth.uid());
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_item_id := nullif(v_item->>'inventory_item_id', '')::uuid; v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 0); v_unit_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    if v_item_id is null or v_quantity <= 0 or v_unit_cost < 0 or not exists (select 1 from public.inventory_items where id = v_item_id and lodge_id = v_lodge_id) then raise exception 'Every purchase order line needs a business stock item, a positive quantity, and a non-negative unit cost'; end if;
    insert into public.restaurant_purchase_order_items (purchase_order_id, inventory_item_id, description, quantity, unit_cost, total) values (v_order_id, v_item_id, nullif(v_item->>'description', ''), v_quantity, v_unit_cost, v_quantity * v_unit_cost); v_total := v_total + v_quantity * v_unit_cost;
  end loop;
  update public.restaurant_purchase_orders set total = v_total, updated_at = now() where id = v_order_id;
  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total, 'stock_location_id', v_location_id);
end;
$$;

create or replace function public.update_purchase_order_draft(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid; v_order_id uuid := nullif(payload->>'order_id', '')::uuid; v_supplier_id uuid := nullif(payload->>'supplier_id', '')::uuid; v_location_id uuid := coalesce(nullif(payload->>'stock_location_id', '')::uuid, public.restaurant_default_stock_location(v_lodge_id)); v_items jsonb := coalesce(payload->'items', '[]'::jsonb); v_item jsonb; v_total numeric := 0; v_quantity numeric; v_unit_cost numeric; v_item_id uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  perform 1 from public.restaurant_purchase_orders where id = v_order_id and lodge_id = v_lodge_id and status = 'draft' for update; if not found then return jsonb_build_object('success', false, 'error', 'Only a draft purchase order can be edited'); end if;
  if v_supplier_id is null or not exists (select 1 from public.restaurant_suppliers where id = v_supplier_id and lodge_id = v_lodge_id) then return jsonb_build_object('success', false, 'error', 'Choose a supplier from this business'); end if;
  if not exists (select 1 from public.restaurant_stock_locations where id = v_location_id and lodge_id = v_lodge_id and is_active) then return jsonb_build_object('success', false, 'error', 'Choose an active stock location'); end if;
  if jsonb_array_length(v_items) = 0 then return jsonb_build_object('success', false, 'error', 'Add at least one stock item with a positive quantity'); end if;
  delete from public.restaurant_purchase_order_items where purchase_order_id = v_order_id;
  for v_item in select value from jsonb_array_elements(v_items) loop
    v_item_id := nullif(v_item->>'inventory_item_id', '')::uuid; v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 0); v_unit_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    if v_item_id is null or v_quantity <= 0 or v_unit_cost < 0 or not exists (select 1 from public.inventory_items where id = v_item_id and lodge_id = v_lodge_id) then raise exception 'Every purchase order line needs a business stock item, a positive quantity, and a non-negative unit cost'; end if;
    insert into public.restaurant_purchase_order_items (purchase_order_id, inventory_item_id, description, quantity, unit_cost, total) values (v_order_id, v_item_id, nullif(v_item->>'description', ''), v_quantity, v_unit_cost, v_quantity * v_unit_cost); v_total := v_total + v_quantity * v_unit_cost;
  end loop;
  update public.restaurant_purchase_orders set supplier_id = v_supplier_id, stock_location_id = v_location_id, expected_delivery = nullif(payload->>'expected_delivery', '')::timestamptz, notes = nullif(payload->>'notes', ''), total = v_total, updated_at = now() where id = v_order_id and lodge_id = v_lodge_id;
  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total, 'stock_location_id', v_location_id);
end;
$$;

create or replace function public.receive_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid; v_order_id uuid := nullif(payload->>'order_id', '')::uuid; v_order public.restaurant_purchase_orders%rowtype; v_line record; v_received_count integer := 0; v_already boolean; v_balance numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  select * into v_order from public.restaurant_purchase_orders where id = v_order_id and lodge_id = v_lodge_id and status in ('approved', 'received') for update; if not found then return jsonb_build_object('success', false, 'error', 'Approved order was not found'); end if;
  if v_order.stock_location_id is null then v_order.stock_location_id := public.restaurant_default_stock_location(v_lodge_id); update public.restaurant_purchase_orders set stock_location_id = v_order.stock_location_id where id = v_order_id; end if;
  for v_line in select poi.inventory_item_id, sum(poi.quantity) quantity, case when sum(poi.quantity) > 0 then sum(poi.quantity * poi.unit_cost) / sum(poi.quantity) else 0 end unit_cost, coalesce(max(nullif(poi.description, '')), max(ii.name), 'Stock item') description from public.restaurant_purchase_order_items poi join public.inventory_items ii on ii.id = poi.inventory_item_id and ii.lodge_id = v_lodge_id where poi.purchase_order_id = v_order_id and poi.inventory_item_id is not null and poi.quantity > 0 group by poi.inventory_item_id loop
    select exists(select 1 from public.inventory_movements im where im.lodge_id = v_lodge_id and im.item_id = v_line.inventory_item_id and im.reference_type = 'restaurant_purchase_order' and im.reference_id = v_order_id and im.movement_type = 'purchase_received') into v_already;
    if not v_already then
      update public.inventory_items set current_stock = coalesce(current_stock, 0) + v_line.quantity, latest_unit_cost = case when v_line.unit_cost > 0 then v_line.unit_cost else latest_unit_cost end, updated_at = now() where id = v_line.inventory_item_id and lodge_id = v_lodge_id;
      v_balance := public.restaurant_apply_stock_location_balance(v_lodge_id, v_line.inventory_item_id, v_order.stock_location_id, v_line.quantity);
      insert into public.inventory_movements (lodge_id, item_id, movement_type, quantity, unit_cost, total_cost, notes, reference_type, reference_id, source, created_by) values (v_lodge_id, v_line.inventory_item_id, 'purchase_received', v_line.quantity, coalesce(v_line.unit_cost, 0), v_line.quantity * coalesce(v_line.unit_cost, 0), 'Purchase order received: ' || v_line.description, 'restaurant_purchase_order', v_order_id, 'restaurant_purchasing', auth.uid()); v_received_count := v_received_count + 1;
    end if;
  end loop;
  if v_received_count = 0 and v_order.status = 'approved' then return jsonb_build_object('success', false, 'error', 'This purchase order has no valid stock lines to receive'); end if;
  update public.restaurant_purchase_orders set status = 'received', updated_at = now() where id = v_order_id;
  return jsonb_build_object('success', true, 'items_received', v_received_count, 'duplicate', v_received_count = 0, 'stock_location_id', v_order.stock_location_id, 'location_balance', v_balance);
end;
$$;

create or replace function public.create_stock_transfer(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid; v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid()); v_from uuid := nullif(payload->>'from_stock_location_id', '')::uuid; v_to uuid := nullif(payload->>'to_stock_location_id', '')::uuid; v_item uuid := nullif(payload->>'inventory_item_id', '')::uuid; v_qty numeric := coalesce((payload->>'quantity')::numeric, 0); v_before numeric; v_after numeric; v_destination numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_from is null then select stock_location_id into v_from from public.restaurant_outlet_stock_locations where lodge_id = v_lodge_id and outlet_id = nullif(payload->>'from_outlet_id', '')::uuid; end if;
  if v_to is null then select stock_location_id into v_to from public.restaurant_outlet_stock_locations where lodge_id = v_lodge_id and outlet_id = nullif(payload->>'to_outlet_id', '')::uuid; end if;
  if v_from is null or v_to is null or v_item is null or v_qty <= 0 then return jsonb_build_object('success', false, 'error', 'Source, destination, stock item, and positive quantity are required'); end if;
  if v_from = v_to then return jsonb_build_object('success', false, 'error', 'Source and destination stock locations must be different'); end if;
  if not exists (select 1 from public.restaurant_stock_locations where id = v_from and lodge_id = v_lodge_id and is_active) or not exists (select 1 from public.restaurant_stock_locations where id = v_to and lodge_id = v_lodge_id and is_active) then return jsonb_build_object('success', false, 'error', 'Choose active stock locations from this business'); end if;
  perform 1 from public.inventory_items where id = v_item and lodge_id = v_lodge_id for update; if not found then return jsonb_build_object('success', false, 'error', 'Stock item does not belong to this business'); end if;
  select quantity into v_before from public.restaurant_stock_location_balances where inventory_item_id = v_item and stock_location_id = v_from for update; if coalesce(v_before, 0) < v_qty then return jsonb_build_object('success', false, 'error', format('Only %s is available at the source stock location', coalesce(v_before, 0))); end if;
  v_after := public.restaurant_apply_stock_location_balance(v_lodge_id, v_item, v_from, -v_qty); v_destination := public.restaurant_apply_stock_location_balance(v_lodge_id, v_item, v_to, v_qty);
  insert into public.stock_movements (lodge_id, inventory_item_id, movement_type, quantity, reference_type, reference_id, notes) values (v_lodge_id, v_item, 'transfer', v_qty, 'stock_location_transfer', v_id, nullif(payload->>'notes', ''));
  return jsonb_build_object('success', true, 'transfer_id', v_id, 'source_balance', v_after, 'destination_balance', v_destination);
end;
$$;

-- A recipe sale draws from the stock location mapped to the Till outlet. When
-- multiple outlets map to Shared business stock, they intentionally consume the
-- same balance.
create or replace function public.record_recipe_stock_depletion(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid; v_order_id uuid := nullif(payload->>'order_id', '')::uuid; v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid; v_location_id uuid;
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb); v_item jsonb; v_recipe public.restaurant_recipes%rowtype; v_ingredient record; v_count integer := 0; v_skipped integer := 0; v_depleted numeric; v_order_item_id uuid; v_unit_cost numeric;
begin
  if v_lodge_id is null or v_order_id is null then return jsonb_build_object('success', false, 'error', 'lodge_id and order_id are required.'); end if;
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  select stock_location_id into v_location_id from public.restaurant_outlet_stock_locations where lodge_id = v_lodge_id and outlet_id = v_outlet_id;
  v_location_id := coalesce(v_location_id, public.restaurant_default_stock_location(v_lodge_id));
  for v_item in select value from jsonb_array_elements(v_items) loop
    if nullif(v_item->>'menu_item_id', '') is null or coalesce((v_item->>'quantity')::numeric, 0) <= 0 then continue; end if;
    select * into v_recipe from public.restaurant_recipes where lodge_id = v_lodge_id and menu_item_id = (v_item->>'menu_item_id')::uuid and active = true limit 1; if not found then continue; end if;
    select id into v_order_item_id from public.pos_order_items where lodge_id = v_lodge_id and order_id = v_order_id and menu_item_id = v_recipe.menu_item_id limit 1;
    if v_order_item_id is null then return jsonb_build_object('success', false, 'error', 'Order line was not found for recipe stock depletion.'); end if;
    for v_ingredient in select ri.inventory_item_id, ri.quantity, ri.unit, ri.waste_percent from public.restaurant_recipe_ingredients ri where ri.recipe_id = v_recipe.id and ri.lodge_id = v_lodge_id and ri.quantity > 0 order by ri.sort_order loop
      if exists (select 1 from public.restaurant_recipe_stock_movements rsm where rsm.lodge_id = v_lodge_id and rsm.order_id = v_order_id and rsm.order_item_id = v_order_item_id and rsm.inventory_item_id = v_ingredient.inventory_item_id and rsm.recipe_version = v_recipe.version) then v_skipped := v_skipped + 1; continue; end if;
      v_depleted := v_ingredient.quantity * coalesce((v_item->>'quantity')::numeric, 1) * (1 + coalesce(v_ingredient.waste_percent, 0) / 100);
      select coalesce(latest_unit_cost, 0) into v_unit_cost from public.inventory_items where id = v_ingredient.inventory_item_id and lodge_id = v_lodge_id for update; if not found then return jsonb_build_object('success', false, 'error', 'A recipe ingredient no longer belongs to this restaurant.'); end if;
      perform public.restaurant_apply_stock_location_balance(v_lodge_id, v_ingredient.inventory_item_id, v_location_id, -v_depleted);
      update public.inventory_items set current_stock = coalesce(current_stock, 0) - v_depleted, updated_at = now() where id = v_ingredient.inventory_item_id and lodge_id = v_lodge_id;
      insert into public.restaurant_recipe_stock_movements (lodge_id, recipe_id, order_id, order_item_id, inventory_item_id, quantity, unit, movement_reason, recipe_version, theoretical_cost) values (v_lodge_id, v_recipe.id, v_order_id, v_order_item_id, v_ingredient.inventory_item_id, -v_depleted, coalesce(v_ingredient.unit, 'each'), 'pos_sale', v_recipe.version, v_depleted * v_unit_cost);
      insert into public.inventory_movements (lodge_id, item_id, movement_type, quantity, unit_cost, total_cost, notes, reference_type, reference_id, source, created_by) values (v_lodge_id, v_ingredient.inventory_item_id, 'recipe_sale', -v_depleted, v_unit_cost, -v_depleted * v_unit_cost, format('Recipe sale: %s', v_recipe.name), 'restaurant_recipe_sale', v_order_id, 'restaurant_recipe', public.app_current_user_id());
      v_count := v_count + 1;
    end loop;
  end loop;
  return jsonb_build_object('success', true, 'movements_created', v_count, 'movements_skipped', v_skipped, 'stock_location_id', v_location_id);
end;
$$;

revoke all on function public.restaurant_apply_stock_location_balance(uuid, uuid, uuid, numeric) from public;
revoke all on function public.get_restaurant_stock_locations(uuid) from public;
revoke all on function public.create_restaurant_stock_location(uuid, jsonb) from public;
revoke all on function public.set_restaurant_outlet_stock_location(uuid, uuid, uuid) from public;
grant execute on function public.get_restaurant_stock_locations(uuid) to authenticated, service_role;
grant execute on function public.create_restaurant_stock_location(uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_restaurant_outlet_stock_location(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.create_purchase_order(jsonb) to authenticated, service_role;
grant execute on function public.update_purchase_order_draft(jsonb) to authenticated, service_role;
grant execute on function public.receive_purchase_order(jsonb) to authenticated, service_role;
grant execute on function public.create_stock_transfer(jsonb) to authenticated, service_role;
grant execute on function public.record_recipe_stock_depletion(jsonb) to authenticated, service_role;
