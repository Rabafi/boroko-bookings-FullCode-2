-- Direct-stock menu items (for example, a bottled beer) must consume the
-- location assigned to the Till's outlet as well as the business-wide balance.
-- Recipe items continue to use record_recipe_stock_depletion and therefore do
-- not pass through this trigger.

create or replace function public.restaurant_apply_direct_pos_stock_location_depletion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_outlet_id uuid;
  v_location_id uuid;
  v_delta numeric;
begin
  if new.inventory_item_id is null or coalesce(new.quantity, 0) = 0 then
    return new;
  end if;

  select outlet_id
    into v_outlet_id
    from public.pos_orders
   where id = new.order_id
     and lodge_id = new.lodge_id;

  select stock_location_id
    into v_location_id
    from public.restaurant_outlet_stock_locations
   where lodge_id = new.lodge_id
     and outlet_id is not distinct from v_outlet_id;

  v_location_id := coalesce(v_location_id, public.restaurant_default_stock_location(new.lodge_id));
  v_delta := -1 * new.quantity * public._positive_depletion_qty(new.depletion_qty, 1);

  perform public.restaurant_apply_stock_location_balance(
    new.lodge_id,
    new.inventory_item_id,
    v_location_id,
    v_delta
  );

  return new;
end;
$$;

drop trigger if exists trg_restaurant_direct_pos_stock_location_depletion on public.pos_order_items;
create trigger trg_restaurant_direct_pos_stock_location_depletion
after insert on public.pos_order_items
for each row execute function public.restaurant_apply_direct_pos_stock_location_depletion();

-- Voiding an order restores both the total business stock and the exact stock
-- location from which its direct-linked lines were originally consumed.
create or replace function public._restore_pos_order_stock(p_order_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_line record;
  v_outlet_id uuid;
  v_location_id uuid;
  v_delta numeric;
  v_new_stock numeric;
  v_unit_cost numeric := 0;
  v_restored jsonb := '[]'::jsonb;
begin
  select outlet_id into v_outlet_id
    from public.pos_orders
   where id = p_order_id and lodge_id = p_lodge_id;

  select stock_location_id into v_location_id
    from public.restaurant_outlet_stock_locations
   where lodge_id = p_lodge_id
     and outlet_id is not distinct from v_outlet_id;
  v_location_id := coalesce(v_location_id, public.restaurant_default_stock_location(p_lodge_id));

  for v_line in
    select id, inventory_item_id, quantity, depletion_qty, item_name
      from public.pos_order_items
     where order_id = p_order_id
       and lodge_id = p_lodge_id
       and inventory_item_id is not null
  loop
    v_delta := coalesce(v_line.quantity, 0) * public._positive_depletion_qty(v_line.depletion_qty, 1);

    if v_delta <> 0 then
      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) + v_delta
       where id = v_line.inventory_item_id
         and lodge_id = p_lodge_id
      returning current_stock, coalesce(latest_unit_cost, 0)
        into v_new_stock, v_unit_cost;

      perform public.restaurant_apply_stock_location_balance(
        p_lodge_id, v_line.inventory_item_id, v_location_id, v_delta
      );

      perform public._log_inventory_movement(
        p_lodge_id,
        v_line.inventory_item_id,
        case when v_delta >= 0 then 'pos_void_restore' else 'pos_void_reversal' end,
        v_delta,
        v_unit_cost,
        coalesce(v_line.item_name, 'POS void'),
        'pos_void',
        p_order_id,
        'pos',
        null
      );

      v_restored := v_restored || jsonb_build_array(jsonb_build_object(
        'inventory_item_id', v_line.inventory_item_id,
        'restored_qty', v_delta,
        'new_stock', v_new_stock,
        'stock_location_id', v_location_id
      ));
    end if;
  end loop;

  return v_restored;
end;
$$;

revoke all on function public.restaurant_apply_direct_pos_stock_location_depletion() from public;
grant execute on function public.restaurant_apply_direct_pos_stock_location_depletion() to service_role;
