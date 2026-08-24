-- A POS sale owns two compatible truths: the business-wide on-hand total and
-- the physical location from which the Till dispenses it. New stock items were
-- updating only inventory_items.current_stock, leaving the location balance at
-- zero. The sale correctly failed closed, but a fresh Bar could not trade.

begin;

-- Reconcile only stock that has not yet been allocated to any physical
-- location. Existing allocations are never moved or overwritten. The caller
-- holds the inventory-item row lock, so POS sale/adjustment paths cannot race
-- this reconciliation.
create or replace function public.ensure_inventory_item_stock_location_balance(
  p_lodge_id uuid,
  p_inventory_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_current_stock numeric;
  v_outlet_id uuid;
  v_allocated_stock numeric;
  v_unallocated_stock numeric;
  v_stock_location_id uuid;
begin
  if p_lodge_id is null or p_inventory_item_id is null then
    raise exception 'A lodge and inventory item are required for stock-location reconciliation.'
      using errcode = '22023';
  end if;

  select coalesce(i.current_stock, 0), i.outlet_id
    into v_current_stock, v_outlet_id
    from public.inventory_items i
   where i.id = p_inventory_item_id
     and i.lodge_id = p_lodge_id
   for update;
  if not found then
    raise exception 'Inventory item does not belong to this business.' using errcode = '42501';
  end if;

  select coalesce(sum(b.quantity), 0)
    into v_allocated_stock
    from public.restaurant_stock_location_balances b
   where b.lodge_id = p_lodge_id
     and b.inventory_item_id = p_inventory_item_id;

  v_unallocated_stock := v_current_stock - v_allocated_stock;
  if v_unallocated_stock <= 0 then
    return jsonb_build_object(
      'success', true,
      'allocated_quantity', 0,
      'stock_location_id', null,
      'already_allocated', true
    );
  end if;

  if v_outlet_id is not null then
    select m.stock_location_id
      into v_stock_location_id
      from public.restaurant_outlet_stock_locations m
     where m.lodge_id = p_lodge_id
       and m.outlet_id = v_outlet_id;
  end if;
  v_stock_location_id := coalesce(
    v_stock_location_id,
    public.restaurant_default_stock_location(p_lodge_id)
  );

  perform public.restaurant_apply_stock_location_balance(
    p_lodge_id,
    p_inventory_item_id,
    v_stock_location_id,
    v_unallocated_stock
  );

  return jsonb_build_object(
    'success', true,
    'allocated_quantity', v_unallocated_stock,
    'stock_location_id', v_stock_location_id,
    'already_allocated', false
  );
end;
$$;

revoke all on function public.ensure_inventory_item_stock_location_balance(uuid, uuid)
  from public, anon, authenticated;

-- Every newly created item with a positive opening count receives a physical
-- balance in the same transaction. This covers all creation callers, not only
-- the desktop Bar form. The ledger entry is an actual opening count, unlike
-- the historic backfill below, which must not manufacture a new financial
-- movement for pre-existing stock.
create or replace function public.restaurant_seed_inventory_item_stock_location_balance()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
  v_result jsonb;
  v_allocated_quantity numeric;
begin
  if coalesce(new.current_stock, 0) <= 0 then
    return new;
  end if;

  v_result := public.ensure_inventory_item_stock_location_balance(new.lodge_id, new.id);
  v_allocated_quantity := coalesce((v_result->>'allocated_quantity')::numeric, 0);

  if v_allocated_quantity > 0 then
    insert into public.inventory_movements (
      lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
      notes, reference_type, reference_id, source, created_by,
      source_document_type, source_document_id, valuation_method,
      quantity_before, quantity_after
    ) values (
      new.lodge_id, new.id, 'opening_stock', v_allocated_quantity,
      coalesce(new.latest_unit_cost, 0), v_allocated_quantity * coalesce(new.latest_unit_cost, 0),
      'Opening stock recorded when inventory item was created',
      'inventory_item', new.id, 'inventory', public.app_current_user_id(),
      'inventory_item', new.id, 'manual_count', 0, v_allocated_quantity
    );
  end if;

  return new;
end;
$$;

revoke all on function public.restaurant_seed_inventory_item_stock_location_balance()
  from public, anon, authenticated;

drop trigger if exists restaurant_seed_inventory_item_stock_location_balance on public.inventory_items;
create trigger restaurant_seed_inventory_item_stock_location_balance
after insert on public.inventory_items
for each row execute function public.restaurant_seed_inventory_item_stock_location_balance();

-- Keep both stock truths in lockstep for the base Bar Receive and Count
-- controls. The same stable adjustment id remains the idempotency key. An
-- adjustment that would drive either balance below zero is rejected instead
-- of silently clamping its ledger quantity.
create or replace function public.adjust_inventory_stock(
  p_item_id uuid,
  p_lodge_id uuid,
  p_delta numeric,
  p_notes text,
  p_adjustment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to public
as $$
declare
  v_current_stock numeric;
  v_new_stock numeric;
  v_unit_cost numeric;
  v_existing_movement_id uuid;
  v_existing_item_id uuid;
  v_movement_id uuid;
  v_stock_location_id uuid;
  v_location_stock numeric;
  v_actor_raw text := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor uuid := case when v_actor_raw ~ '^[0-9a-fA-F-]{36}$' then v_actor_raw::uuid else null end;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  if coalesce(p_delta, 0) = 0 then
    return jsonb_build_object('success', false, 'error', 'Adjustment quantity is required');
  end if;
  if p_adjustment_id is null then
    return jsonb_build_object('success', false, 'error', 'Adjustment id is required');
  end if;

  select coalesce(i.current_stock, 0), coalesce(i.latest_unit_cost, 0)
    into v_current_stock, v_unit_cost
    from public.inventory_items i
   where i.id = p_item_id
     and i.lodge_id = p_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  select m.id, m.item_id
    into v_existing_movement_id, v_existing_item_id
    from public.inventory_movements m
   where m.lodge_id = p_lodge_id
     and m.reference_type = 'inventory_adjustment'
     and m.reference_id = p_adjustment_id
   limit 1;
  if found then
    if v_existing_item_id is distinct from p_item_id then
      return jsonb_build_object('success', false, 'error', 'Adjustment id was already used for another inventory item');
    end if;
    return jsonb_build_object(
      'success', true,
      'new_stock', v_current_stock,
      'movement_id', v_existing_movement_id,
      'idempotent', true
    );
  end if;

  v_new_stock := v_current_stock + p_delta;
  if v_new_stock < 0 then
    return jsonb_build_object(
      'success', false,
      'error', format('Only %s is available for this stock adjustment.', v_current_stock)
    );
  end if;

  select m.stock_location_id
    into v_stock_location_id
    from public.restaurant_outlet_stock_locations m
    join public.inventory_items i on i.outlet_id = m.outlet_id
   where m.lodge_id = p_lodge_id
     and i.id = p_item_id
     and i.lodge_id = p_lodge_id;
  v_stock_location_id := coalesce(v_stock_location_id, public.restaurant_default_stock_location(p_lodge_id));

  select coalesce(b.quantity, 0)
    into v_location_stock
    from public.restaurant_stock_location_balances b
   where b.lodge_id = p_lodge_id
     and b.inventory_item_id = p_item_id
     and b.stock_location_id = v_stock_location_id
   for update;
  if coalesce(v_location_stock, 0) + p_delta < 0 then
    return jsonb_build_object('success', false, 'error', 'Insufficient stock in the selected stock location');
  end if;

  perform public.restaurant_apply_stock_location_balance(
    p_lodge_id, p_item_id, v_stock_location_id, p_delta
  );

  update public.inventory_items
     set current_stock = v_new_stock,
         updated_at = now()
   where id = p_item_id
     and lodge_id = p_lodge_id;

  insert into public.inventory_movements (
    lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
    notes, reference_type, reference_id, source, created_by,
    source_document_type, source_document_id, valuation_method,
    quantity_before, quantity_after
  ) values (
    p_lodge_id, p_item_id,
    case when p_delta >= 0 then 'adjustment_increase' else 'adjustment_decrease' end,
    p_delta, v_unit_cost, p_delta * v_unit_cost,
    nullif(p_notes, ''), 'inventory_adjustment', p_adjustment_id,
    'adjustment', v_actor, 'inventory_adjustment', p_adjustment_id,
    'manual_count', v_current_stock, v_new_stock
  ) returning id into v_movement_id;

  return jsonb_build_object(
    'success', true,
    'new_stock', v_new_stock,
    'stock_location_id', v_stock_location_id,
    'movement_id', v_movement_id,
    'idempotent', false
  );
end;
$$;

revoke all on function public.adjust_inventory_stock(uuid, uuid, numeric, text, uuid)
  from public;
grant execute on function public.adjust_inventory_stock(uuid, uuid, numeric, text, uuid)
  to anon, authenticated, service_role;

-- A physical Bar outlet uses the shared default location until a manager
-- explicitly maps it elsewhere. Do not replace an existing mapping.
create or replace function public.ensure_bar_mode_default_outlet(p_lodge_id uuid)
returns void
language plpgsql
security definer
set search_path to public
as $$
declare
  v_is_bar_mode boolean;
  v_sort_order integer;
  v_bar_outlet_id uuid;
  v_stock_location_id uuid;
begin
  if p_lodge_id is null then
    return;
  end if;

  select
    s.property_type = 'restaurant'
    and coalesce(s.operating_profile->>'hospitality_mode', '') = 'bar_only'
    into v_is_bar_mode
  from public.settings s
  where s.lodge_id = p_lodge_id;
  if not coalesce(v_is_bar_mode, false) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('bar-default-outlet:' || p_lodge_id::text, 0));

  select o.id
    into v_bar_outlet_id
    from public.outlets o
   where o.lodge_id = p_lodge_id
     and o.type = 'beverage'
     and o.is_active = true
   order by o.sort_order, o.created_at, o.id
   limit 1;

  if v_bar_outlet_id is null then
    select coalesce(max(o.sort_order), 0) + 1
      into v_sort_order
      from public.outlets o
     where o.lodge_id = p_lodge_id;

    insert into public.outlets (lodge_id, name, type, is_active, sort_order)
    values (p_lodge_id, 'Bar', 'beverage', true, v_sort_order)
    returning id into v_bar_outlet_id;
  end if;

  v_stock_location_id := public.restaurant_default_stock_location(p_lodge_id);
  insert into public.restaurant_outlet_stock_locations (
    lodge_id, outlet_id, stock_location_id, updated_at
  ) values (
    p_lodge_id, v_bar_outlet_id, v_stock_location_id, now()
  ) on conflict (outlet_id) do nothing;

  perform public.ensure_initial_pos_catalog_snapshot(p_lodge_id, v_bar_outlet_id);
end;
$$;

revoke all on function public.ensure_bar_mode_default_outlet(uuid)
  from public, anon, authenticated;

-- Backfill only Bar-mode businesses. The update allocates the known
-- unallocated remainder of current stock; it does not create a synthetic
-- financial/stock movement for historical quantities or change current_stock.
select public.ensure_bar_mode_default_outlet(s.lodge_id)
from public.settings s
where s.property_type = 'restaurant'
  and coalesce(s.operating_profile->>'hospitality_mode', '') = 'bar_only';

select public.ensure_inventory_item_stock_location_balance(i.lodge_id, i.id)
from public.inventory_items i
join public.settings s on s.lodge_id = i.lodge_id
where s.property_type = 'restaurant'
  and coalesce(s.operating_profile->>'hospitality_mode', '') = 'bar_only'
  and coalesce(i.current_stock, 0) > 0
  and coalesce((
    select sum(b.quantity)
      from public.restaurant_stock_location_balances b
     where b.lodge_id = i.lodge_id
       and b.inventory_item_id = i.id
  ), 0) < coalesce(i.current_stock, 0);

commit;
