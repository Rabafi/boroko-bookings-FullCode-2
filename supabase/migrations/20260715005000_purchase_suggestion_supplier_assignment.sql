-- Make purchase suggestions actionable: a received PO remembers its supplier,
-- and managers can explicitly set the preferred supplier for any stock item.

begin;

create or replace function public.set_restaurant_preferred_supplier_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_supplier_id uuid := nullif(payload->>'supplier_id', '')::uuid;
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_last_unit_cost numeric := nullif(payload->>'last_unit_cost', '')::numeric;
  v_result jsonb;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_supplier_id is null or v_inventory_item_id is null then
    return jsonb_build_object('success', false, 'error', 'Supplier and stock item are required');
  end if;

  perform 1 from public.restaurant_suppliers
   where id = v_supplier_id and lodge_id = v_lodge_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Supplier was not found for this business');
  end if;

  perform 1 from public.inventory_items
   where id = v_inventory_item_id and lodge_id = v_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Stock item was not found for this business');
  end if;

  -- An item may have many supplier records, but exactly one is preferred.
  update public.restaurant_supplier_items
     set preferred = false, updated_at = now()
   where lodge_id = v_lodge_id
     and inventory_item_id = v_inventory_item_id
     and preferred = true;

  insert into public.restaurant_supplier_items (
    lodge_id, supplier_id, inventory_item_id, preferred, last_unit_cost
  ) values (
    v_lodge_id, v_supplier_id, v_inventory_item_id, true, v_last_unit_cost
  )
  on conflict (lodge_id, supplier_id, inventory_item_id) do update set
    preferred = true,
    last_unit_cost = coalesce(excluded.last_unit_cost, restaurant_supplier_items.last_unit_cost),
    updated_at = now()
  returning to_jsonb(restaurant_supplier_items.*) into v_result;

  return jsonb_build_object('success', true, 'supplier_item', v_result);
end;
$$;

revoke all on function public.set_restaurant_preferred_supplier_item(jsonb) from public;
grant execute on function public.set_restaurant_preferred_supplier_item(jsonb) to anon, authenticated, service_role;

create or replace function public.receive_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_order public.restaurant_purchase_orders%rowtype;
  v_line record;
  v_received_count integer := 0;
  v_already_recorded boolean;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_order_id is null then
    return jsonb_build_object('success', false, 'error', 'Order ID is required');
  end if;

  select * into v_order
    from public.restaurant_purchase_orders
   where id = v_order_id
     and lodge_id = v_lodge_id
     and status in ('approved', 'received')
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Approved order was not found');
  end if;

  for v_line in
    select poi.inventory_item_id,
           sum(poi.quantity) as quantity,
           case when sum(poi.quantity) > 0
             then sum(poi.quantity * poi.unit_cost) / sum(poi.quantity)
             else 0 end as unit_cost,
           coalesce(max(nullif(poi.description, '')), max(ii.name), 'Stock item') as description
      from public.restaurant_purchase_order_items poi
      join public.inventory_items ii on ii.id = poi.inventory_item_id and ii.lodge_id = v_lodge_id
     where poi.purchase_order_id = v_order_id
       and poi.inventory_item_id is not null
       and poi.quantity > 0
     group by poi.inventory_item_id
  loop
    select exists(
      select 1 from public.inventory_movements im
       where im.lodge_id = v_lodge_id
         and im.item_id = v_line.inventory_item_id
         and im.reference_type = 'restaurant_purchase_order'
         and im.reference_id = v_order_id
         and im.movement_type = 'purchase_received'
    ) into v_already_recorded;

    if not v_already_recorded then
      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) + v_line.quantity,
             latest_unit_cost = case when v_line.unit_cost > 0 then v_line.unit_cost else latest_unit_cost end,
             updated_at = now()
       where id = v_line.inventory_item_id and lodge_id = v_lodge_id;
      if not found then
        raise exception 'Stock item on this purchase order no longer belongs to this business';
      end if;

      insert into public.inventory_movements (
        lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
        notes, reference_type, reference_id, source, created_by
      ) values (
        v_lodge_id, v_line.inventory_item_id, 'purchase_received', v_line.quantity,
        coalesce(v_line.unit_cost, 0), v_line.quantity * coalesce(v_line.unit_cost, 0),
        'Purchase order received: ' || v_line.description,
        'restaurant_purchase_order', v_order_id, 'restaurant_purchasing', auth.uid()
      );
      v_received_count := v_received_count + 1;
    end if;

    -- Receiving proves this supplier can provide this item. Keep the last cost
    -- and make it the preferred supplier for future low-stock suggestions.
    perform public.set_restaurant_preferred_supplier_item(jsonb_build_object(
      'lodge_id', v_lodge_id,
      'supplier_id', v_order.supplier_id,
      'inventory_item_id', v_line.inventory_item_id,
      'last_unit_cost', v_line.unit_cost
    ));
  end loop;

  if v_received_count = 0 and v_order.status = 'approved' then
    return jsonb_build_object('success', false, 'error', 'This purchase order has no valid stock lines to receive');
  end if;

  update public.restaurant_purchase_orders
     set status = 'received', updated_at = now()
   where id = v_order_id and lodge_id = v_lodge_id;

  return jsonb_build_object(
    'success', true,
    'items_received', v_received_count,
    'duplicate', v_received_count = 0,
    'reconciled', v_order.status = 'received' and v_received_count > 0
  );
end;
$$;

revoke all on function public.receive_purchase_order(jsonb) from public;
grant execute on function public.receive_purchase_order(jsonb) to anon, authenticated, service_role;

commit;
