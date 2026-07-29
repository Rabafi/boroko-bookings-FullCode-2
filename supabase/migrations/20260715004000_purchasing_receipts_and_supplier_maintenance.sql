-- Restore real Restaurant & Bar purchase receiving after a placeholder RPC
-- replaced the inventory update, and allow controlled supplier edits.

begin;

create or replace function public.update_restaurant_supplier(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_supplier_id uuid := nullif(payload->>'supplier_id', '')::uuid;
  v_name text := btrim(coalesce(payload->>'name', ''));
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_supplier_id is null then
    return jsonb_build_object('success', false, 'error', 'Supplier ID is required');
  end if;
  if v_name = '' then
    return jsonb_build_object('success', false, 'error', 'Supplier name is required');
  end if;

  update public.restaurant_suppliers
     set name = v_name,
         contact_person = nullif(btrim(coalesce(payload->>'contact_person', '')), ''),
         email = nullif(btrim(coalesce(payload->>'email', '')), ''),
         phone = nullif(btrim(coalesce(payload->>'phone', '')), ''),
         address = nullif(btrim(coalesce(payload->>'address', '')), ''),
         payment_terms = nullif(btrim(coalesce(payload->>'payment_terms', '')), ''),
         updated_at = now()
   where id = v_supplier_id
     and lodge_id = v_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Supplier was not found for this business');
  end if;

  return jsonb_build_object('success', true, 'supplier_id', v_supplier_id);
end;
$$;

revoke all on function public.update_restaurant_supplier(jsonb) from public;
grant execute on function public.update_restaurant_supplier(jsonb) to anon, authenticated, service_role;

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

  -- Aggregate repeated stock lines, then make each item-level receipt replay-safe.
  for v_line in
    select poi.inventory_item_id,
           sum(poi.quantity) as quantity,
           case when sum(poi.quantity) > 0
             then sum(poi.quantity * poi.unit_cost) / sum(poi.quantity)
             else 0 end as unit_cost,
           coalesce(max(nullif(poi.description, '')), max(ii.name), 'Stock item') as description
      from public.restaurant_purchase_order_items poi
      join public.inventory_items ii
        on ii.id = poi.inventory_item_id
       and ii.lodge_id = v_lodge_id
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
       where id = v_line.inventory_item_id
         and lodge_id = v_lodge_id;

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
