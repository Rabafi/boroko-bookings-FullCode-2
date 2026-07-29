-- Outlet stock is a custody allocation, not a second inventory total.
-- inventory_items.current_stock remains the business-wide aggregate; this table
-- records where that stock is held and is changed only by authoritative RPCs.

create table if not exists public.restaurant_outlet_stock_balances (
  lodge_id uuid not null,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  quantity numeric not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (inventory_item_id, outlet_id)
);

create index if not exists restaurant_outlet_stock_balances_lodge_outlet_idx
  on public.restaurant_outlet_stock_balances (lodge_id, outlet_id, inventory_item_id);

alter table public.restaurant_outlet_stock_balances enable row level security;

-- Existing stock is initially assigned to the item's existing home outlet.
-- Unassigned legacy stock remains business-level until a manager receives or
-- allocates it; it must never be guessed into an outlet.
insert into public.restaurant_outlet_stock_balances (lodge_id, inventory_item_id, outlet_id, quantity)
select ii.lodge_id, ii.id, ii.outlet_id, greatest(coalesce(ii.current_stock, 0), 0)
from public.inventory_items ii
join public.outlets o on o.id = ii.outlet_id and o.lodge_id = ii.lodge_id
where ii.outlet_id is not null and coalesce(ii.current_stock, 0) > 0
on conflict (inventory_item_id, outlet_id) do nothing;

create or replace function public.restaurant_apply_outlet_stock_balance(
  p_lodge_id uuid,
  p_inventory_item_id uuid,
  p_outlet_id uuid,
  p_delta numeric
)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_quantity numeric;
begin
  if p_outlet_id is null then return null; end if;
  insert into public.restaurant_outlet_stock_balances (lodge_id, inventory_item_id, outlet_id, quantity, updated_at)
  values (p_lodge_id, p_inventory_item_id, p_outlet_id, p_delta, now())
  on conflict (inventory_item_id, outlet_id) do update
    set quantity = public.restaurant_outlet_stock_balances.quantity + excluded.quantity,
        updated_at = now()
  returning quantity into v_quantity;
  if v_quantity < 0 then
    raise exception 'Insufficient allocated stock in this outlet';
  end if;
  return v_quantity;
end;
$$;

-- Opening stock for a newly created item belongs to its selected outlet.
create or replace function public.restaurant_seed_outlet_stock_balance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.outlet_id is not null and coalesce(new.current_stock, 0) > 0 then
    perform public.restaurant_apply_outlet_stock_balance(new.lodge_id, new.id, new.outlet_id, new.current_stock);
  end if;
  return new;
end;
$$;

drop trigger if exists restaurant_seed_outlet_stock_balance on public.inventory_items;
create trigger restaurant_seed_outlet_stock_balance
  after insert on public.inventory_items
  for each row execute function public.restaurant_seed_outlet_stock_balance();

-- Do not silently relabel stock that has an actual outlet balance. Use an
-- audited transfer instead, so the custody history remains true.
create or replace function public.restaurant_block_home_outlet_relabel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.outlet_id is distinct from new.outlet_id
     and exists (select 1 from public.restaurant_outlet_stock_balances where inventory_item_id = old.id and quantity > 0) then
    raise exception 'Use an outlet stock transfer to move stock between outlets';
  end if;
  return new;
end;
$$;

drop trigger if exists restaurant_block_home_outlet_relabel on public.inventory_items;
create trigger restaurant_block_home_outlet_relabel
  before update of outlet_id on public.inventory_items
  for each row execute function public.restaurant_block_home_outlet_relabel();

create or replace function public.add_inventory_purchase(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_purchase_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity_purchased')::numeric, 0);
  v_total numeric := coalesce((payload->>'total_cost')::numeric, 0);
  v_unit_cost numeric := coalesce((payload->>'unit_cost')::numeric, case when v_qty > 0 then v_total / v_qty else 0 end);
  v_new_stock numeric; v_outlet_id uuid; v_outlet_stock numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  select current_stock, outlet_id into v_new_stock, v_outlet_id from public.inventory_items where id = v_item_id and lodge_id = v_lodge_id for update;
  if not found then raise exception 'Inventory item not found'; end if;
  if exists (select 1 from public.inventory_purchases where id = v_purchase_id and lodge_id = v_lodge_id) then
    select quantity into v_outlet_stock from public.restaurant_outlet_stock_balances where inventory_item_id = v_item_id and outlet_id = v_outlet_id;
    return jsonb_build_object('success', true, 'id', v_purchase_id, 'new_stock', v_new_stock, 'outlet_id', v_outlet_id, 'outlet_stock', v_outlet_stock, 'idempotent', true);
  end if;
  if v_qty <= 0 then return jsonb_build_object('success', false, 'error', 'Quantity must be greater than zero'); end if;
  insert into public.inventory_purchases (id, lodge_id, item_id, date, quantity_purchased, total_cost, unit_cost, notes)
  values (v_purchase_id, v_lodge_id, v_item_id, (payload->>'date')::date, v_qty, v_total, v_unit_cost, nullif(payload->>'notes', ''));
  update public.inventory_items set current_stock = coalesce(current_stock, 0) + v_qty, latest_unit_cost = v_unit_cost, updated_at = now()
  where id = v_item_id and lodge_id = v_lodge_id returning current_stock into v_new_stock;
  if v_outlet_id is not null then
    v_outlet_stock := public.restaurant_apply_outlet_stock_balance(v_lodge_id, v_item_id, v_outlet_id, v_qty);
  end if;
  return jsonb_build_object('success', true, 'id', v_purchase_id, 'new_stock', v_new_stock, 'outlet_id', v_outlet_id, 'outlet_stock', v_outlet_stock);
end;
$$;

create or replace function public.create_stock_transfer(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_transfer_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_from_outlet_id uuid := nullif(payload->>'from_outlet_id', '')::uuid;
  v_to_outlet_id uuid := nullif(payload->>'to_outlet_id', '')::uuid;
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_quantity numeric := coalesce((payload->>'quantity')::numeric, 0);
  v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_actor_id uuid := public.app_current_user_id();
  v_source_before numeric; v_source_after numeric; v_destination_after numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_from_outlet_id is null or v_to_outlet_id is null or v_inventory_item_id is null then return jsonb_build_object('success', false, 'error', 'Source outlet, destination outlet, and stock item are required'); end if;
  if v_from_outlet_id = v_to_outlet_id then return jsonb_build_object('success', false, 'error', 'Source and destination outlets must be different'); end if;
  if v_quantity <= 0 then return jsonb_build_object('success', false, 'error', 'Transfer quantity must be greater than zero'); end if;
  if exists (select 1 from public.restaurant_stock_transfers where id = v_transfer_id and lodge_id = v_lodge_id) then
    select quantity into v_source_after from public.restaurant_outlet_stock_balances where inventory_item_id = v_inventory_item_id and outlet_id = v_from_outlet_id;
    select quantity into v_destination_after from public.restaurant_outlet_stock_balances where inventory_item_id = v_inventory_item_id and outlet_id = v_to_outlet_id;
    return jsonb_build_object('success', true, 'transfer_id', v_transfer_id, 'source_balance', coalesce(v_source_after, 0), 'destination_balance', coalesce(v_destination_after, 0), 'idempotent', true);
  end if;
  perform 1 from public.inventory_items where id = v_inventory_item_id and lodge_id = v_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Inventory item was not found for this business'); end if;
  perform 1 from public.outlets where id = v_from_outlet_id and lodge_id = v_lodge_id and is_active; if not found then return jsonb_build_object('success', false, 'error', 'Source outlet is not active for this business'); end if;
  perform 1 from public.outlets where id = v_to_outlet_id and lodge_id = v_lodge_id and is_active; if not found then return jsonb_build_object('success', false, 'error', 'Destination outlet is not active for this business'); end if;
  select quantity into v_source_before from public.restaurant_outlet_stock_balances where inventory_item_id = v_inventory_item_id and outlet_id = v_from_outlet_id for update;
  if coalesce(v_source_before, 0) < v_quantity then return jsonb_build_object('success', false, 'error', format('Only %s is allocated to the source outlet', coalesce(v_source_before, 0))); end if;
  v_source_after := public.restaurant_apply_outlet_stock_balance(v_lodge_id, v_inventory_item_id, v_from_outlet_id, -v_quantity);
  v_destination_after := public.restaurant_apply_outlet_stock_balance(v_lodge_id, v_inventory_item_id, v_to_outlet_id, v_quantity);
  insert into public.stock_movements (lodge_id, inventory_item_id, movement_type, quantity, reference_type, reference_id, notes)
  values (v_lodge_id, v_inventory_item_id, 'transfer', v_quantity, 'stock_transfer', v_transfer_id, coalesce(v_notes, '') || format(' (outlet %s -> %s)', v_from_outlet_id, v_to_outlet_id));
  insert into public.restaurant_stock_transfers (id, lodge_id, from_outlet_id, to_outlet_id, inventory_item_id, quantity, notes, status, transferred_by, transferred_at)
  values (v_transfer_id, v_lodge_id, v_from_outlet_id, v_to_outlet_id, v_inventory_item_id, v_quantity, v_notes, 'completed', v_actor_id, now());
  return jsonb_build_object('success', true, 'transfer_id', v_transfer_id, 'source_balance', v_source_after, 'destination_balance', v_destination_after);
end;
$$;

-- A PO receives into the inventory item's chosen home outlet. The PO screen
-- shows that outlet before approval, so receiving is never an invisible choice.
create or replace function public.receive_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_order public.restaurant_purchase_orders%rowtype;
  v_line record; v_received_count integer := 0; v_already_recorded boolean;
  v_outlet_balance numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_order_id is null then return jsonb_build_object('success', false, 'error', 'Order ID is required'); end if;
  select * into v_order from public.restaurant_purchase_orders where id = v_order_id and lodge_id = v_lodge_id and status in ('approved', 'received') for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Approved order was not found'); end if;
  for v_line in
    select poi.inventory_item_id, ii.outlet_id, sum(poi.quantity) as quantity,
      case when sum(poi.quantity) > 0 then sum(poi.quantity * poi.unit_cost) / sum(poi.quantity) else 0 end as unit_cost,
      coalesce(max(nullif(poi.description, '')), max(ii.name), 'Stock item') as description
    from public.restaurant_purchase_order_items poi
    join public.inventory_items ii on ii.id = poi.inventory_item_id and ii.lodge_id = v_lodge_id
    where poi.purchase_order_id = v_order_id and poi.inventory_item_id is not null and poi.quantity > 0
    group by poi.inventory_item_id, ii.outlet_id
  loop
    select exists(select 1 from public.inventory_movements im where im.lodge_id = v_lodge_id and im.item_id = v_line.inventory_item_id and im.reference_type = 'restaurant_purchase_order' and im.reference_id = v_order_id and im.movement_type = 'purchase_received') into v_already_recorded;
    if not v_already_recorded then
      update public.inventory_items set current_stock = coalesce(current_stock, 0) + v_line.quantity,
        latest_unit_cost = case when v_line.unit_cost > 0 then v_line.unit_cost else latest_unit_cost end, updated_at = now()
      where id = v_line.inventory_item_id and lodge_id = v_lodge_id;
      if not found then raise exception 'Stock item on this purchase order no longer belongs to this business'; end if;
      if v_line.outlet_id is not null then
        v_outlet_balance := public.restaurant_apply_outlet_stock_balance(v_lodge_id, v_line.inventory_item_id, v_line.outlet_id, v_line.quantity);
      end if;
      insert into public.inventory_movements (lodge_id, item_id, movement_type, quantity, unit_cost, total_cost, notes, reference_type, reference_id, source, created_by)
      values (v_lodge_id, v_line.inventory_item_id, 'purchase_received', v_line.quantity, coalesce(v_line.unit_cost, 0), v_line.quantity * coalesce(v_line.unit_cost, 0),
        'Purchase order received: ' || v_line.description, 'restaurant_purchase_order', v_order_id, 'restaurant_purchasing', auth.uid());
      v_received_count := v_received_count + 1;
    end if;
    perform public.set_restaurant_preferred_supplier_item(jsonb_build_object('lodge_id', v_lodge_id, 'supplier_id', v_order.supplier_id, 'inventory_item_id', v_line.inventory_item_id, 'last_unit_cost', v_line.unit_cost));
  end loop;
  if v_received_count = 0 and v_order.status = 'approved' then return jsonb_build_object('success', false, 'error', 'This purchase order has no valid stock lines to receive'); end if;
  update public.restaurant_purchase_orders set status = 'received', updated_at = now() where id = v_order_id and lodge_id = v_lodge_id;
  return jsonb_build_object('success', true, 'items_received', v_received_count, 'duplicate', v_received_count = 0, 'reconciled', v_order.status = 'received' and v_received_count > 0, 'outlet_balance', v_outlet_balance);
end;
$$;

revoke all on function public.restaurant_apply_outlet_stock_balance(uuid, uuid, uuid, numeric) from public;
revoke all on function public.add_inventory_purchase(jsonb) from public;
revoke all on function public.create_stock_transfer(jsonb) from public;
revoke all on function public.receive_purchase_order(jsonb) from public;
grant execute on function public.add_inventory_purchase(jsonb) to authenticated, service_role;
grant execute on function public.create_stock_transfer(jsonb) to authenticated, service_role;
grant execute on function public.receive_purchase_order(jsonb) to authenticated, service_role;
