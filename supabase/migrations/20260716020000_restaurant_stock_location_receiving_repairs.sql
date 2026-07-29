-- Correct receipt confirmation, moving-average cost, and safe location transfers.

create or replace function public.restaurant_apply_stock_location_balance(
  p_lodge_id uuid, p_inventory_item_id uuid, p_stock_location_id uuid, p_delta numeric
) returns numeric language plpgsql security definer set search_path = public as $$
declare v_quantity numeric;
begin
  if p_stock_location_id is null then raise exception 'A stock location is required'; end if;
  if p_delta < 0 then
    select quantity into v_quantity from public.restaurant_stock_location_balances
      where lodge_id = p_lodge_id and inventory_item_id = p_inventory_item_id and stock_location_id = p_stock_location_id for update;
    if coalesce(v_quantity, 0) < abs(p_delta) then raise exception 'Insufficient stock in the selected stock location'; end if;
    update public.restaurant_stock_location_balances set quantity = quantity + p_delta, updated_at = now()
      where lodge_id = p_lodge_id and inventory_item_id = p_inventory_item_id and stock_location_id = p_stock_location_id returning quantity into v_quantity;
    return v_quantity;
  end if;
  insert into public.restaurant_stock_location_balances (lodge_id, inventory_item_id, stock_location_id, quantity, updated_at)
  values (p_lodge_id, p_inventory_item_id, p_stock_location_id, p_delta, now())
  on conflict (inventory_item_id, stock_location_id) do update set quantity = public.restaurant_stock_location_balances.quantity + excluded.quantity, updated_at = now()
  returning quantity into v_quantity;
  return v_quantity;
end;
$$;

create or replace function public.update_restaurant_stock_location(p_lodge_id uuid, p_location_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := nullif(btrim(coalesce(p_payload->>'name', '')), '');
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_name is null then return jsonb_build_object('success', false, 'error', 'Stock location name is required'); end if;
  update public.restaurant_stock_locations set name = v_name, updated_at = now() where id = p_location_id and lodge_id = p_lodge_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Stock location was not found'); end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.delete_restaurant_stock_location(p_lodge_id uuid, p_location_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  if exists (select 1 from public.restaurant_stock_locations where id = p_location_id and lodge_id = p_lodge_id and is_default) then return jsonb_build_object('success', false, 'error', 'The shared default stock location cannot be deleted'); end if;
  if exists (select 1 from public.restaurant_stock_location_balances where lodge_id = p_lodge_id and stock_location_id = p_location_id and quantity <> 0) then return jsonb_build_object('success', false, 'error', 'Transfer or count all stock out of this location before deleting it'); end if;
  if exists (select 1 from public.restaurant_outlet_stock_locations where lodge_id = p_lodge_id and stock_location_id = p_location_id) then return jsonb_build_object('success', false, 'error', 'Assign affected sales outlets to another stock location before deleting this one'); end if;
  delete from public.restaurant_stock_locations where id = p_location_id and lodge_id = p_lodge_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Stock location was not found'); end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.receive_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid; v_order_id uuid := nullif(payload->>'order_id', '')::uuid; v_receiving_location_id uuid := nullif(payload->>'stock_location_id', '')::uuid; v_order public.restaurant_purchase_orders%rowtype; v_line record; v_received_count integer := 0; v_already boolean; v_balance numeric; v_old_stock numeric; v_old_cost numeric; v_new_cost numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  select * into v_order from public.restaurant_purchase_orders where id = v_order_id and lodge_id = v_lodge_id and status in ('approved', 'received') for update; if not found then return jsonb_build_object('success', false, 'error', 'Approved order was not found'); end if;
  v_receiving_location_id := coalesce(v_receiving_location_id, v_order.stock_location_id, public.restaurant_default_stock_location(v_lodge_id));
  if not exists (select 1 from public.restaurant_stock_locations where id = v_receiving_location_id and lodge_id = v_lodge_id and is_active) then return jsonb_build_object('success', false, 'error', 'Choose an active receiving stock location'); end if;
  if v_order.status = 'approved' then update public.restaurant_purchase_orders set stock_location_id = v_receiving_location_id where id = v_order_id; end if;
  for v_line in select poi.inventory_item_id, sum(poi.quantity) quantity, case when sum(poi.quantity) > 0 then sum(poi.quantity * poi.unit_cost) / sum(poi.quantity) else 0 end unit_cost, coalesce(max(nullif(poi.description, '')), max(ii.name), 'Stock item') description from public.restaurant_purchase_order_items poi join public.inventory_items ii on ii.id = poi.inventory_item_id and ii.lodge_id = v_lodge_id where poi.purchase_order_id = v_order_id and poi.inventory_item_id is not null and poi.quantity > 0 group by poi.inventory_item_id loop
    select exists(select 1 from public.inventory_movements im where im.lodge_id = v_lodge_id and im.item_id = v_line.inventory_item_id and im.reference_type = 'restaurant_purchase_order' and im.reference_id = v_order_id and im.movement_type = 'purchase_received') into v_already;
    if not v_already then
      select coalesce(current_stock, 0), coalesce(latest_unit_cost, 0) into v_old_stock, v_old_cost from public.inventory_items where id = v_line.inventory_item_id and lodge_id = v_lodge_id for update;
      v_new_cost := case when v_old_stock + v_line.quantity > 0 then ((v_old_stock * v_old_cost) + (v_line.quantity * v_line.unit_cost)) / (v_old_stock + v_line.quantity) else v_line.unit_cost end;
      update public.inventory_items set current_stock = v_old_stock + v_line.quantity, latest_unit_cost = v_new_cost, updated_at = now() where id = v_line.inventory_item_id and lodge_id = v_lodge_id;
      v_balance := public.restaurant_apply_stock_location_balance(v_lodge_id, v_line.inventory_item_id, v_receiving_location_id, v_line.quantity);
      insert into public.inventory_movements (lodge_id, item_id, movement_type, quantity, unit_cost, total_cost, notes, reference_type, reference_id, source, created_by) values (v_lodge_id, v_line.inventory_item_id, 'purchase_received', v_line.quantity, v_line.unit_cost, v_line.quantity * v_line.unit_cost, 'Purchase order received: ' || v_line.description, 'restaurant_purchase_order', v_order_id, 'restaurant_purchasing', auth.uid()); v_received_count := v_received_count + 1;
    end if;
  end loop;
  if v_received_count = 0 and v_order.status = 'approved' then return jsonb_build_object('success', false, 'error', 'This purchase order has no valid stock lines to receive'); end if;
  update public.restaurant_purchase_orders set status = 'received', stock_location_id = v_receiving_location_id, updated_at = now() where id = v_order_id;
  return jsonb_build_object('success', true, 'items_received', v_received_count, 'duplicate', v_received_count = 0, 'stock_location_id', v_receiving_location_id, 'location_balance', v_balance);
end;
$$;

revoke all on function public.update_restaurant_stock_location(uuid, uuid, jsonb) from public;
revoke all on function public.delete_restaurant_stock_location(uuid, uuid) from public;
grant execute on function public.update_restaurant_stock_location(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.delete_restaurant_stock_location(uuid, uuid) to authenticated, service_role;
grant execute on function public.receive_purchase_order(jsonb) to authenticated, service_role;
