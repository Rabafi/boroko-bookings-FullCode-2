-- Never allow a zero-quantity PO.  Drafts remain editable until approval so
-- an operator can correct a purchasing decision without creating duplicate POs.

begin;

create or replace function public.get_low_stock_purchase_suggestions(p_lodge_id uuid, p_outlet_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_result jsonb;
begin
  perform public.app_require_restaurant_lodge(p_lodge_id, array['manager', 'admin']);
  select jsonb_agg(row_to_json(s)) into v_result
  from (
    select ii.id as inventory_item_id, ii.name as inventory_item_name,
      coalesce(ii.current_stock, 0) as current_stock,
      coalesce(ii.reorder_level, 0) as reorder_level,
      coalesce(ii.reorder_level, 0) - coalesce(ii.current_stock, 0) as suggested_quantity,
      'Low stock - below reorder level' as reason,
      si.supplier_id, sup.name as supplier_name, si.last_unit_cost
    from public.inventory_items ii
    left join public.restaurant_supplier_items si on si.inventory_item_id = ii.id and si.lodge_id = ii.lodge_id and si.preferred = true
    left join public.restaurant_suppliers sup on sup.id = si.supplier_id and sup.lodge_id = ii.lodge_id
    where ii.lodge_id = p_lodge_id
      and coalesce(ii.current_stock, 0) < coalesce(ii.reorder_level, 0)
      and ii.reorder_level > 0
      and (p_outlet_id is null or ii.outlet_id = p_outlet_id or ii.outlet_id is null)
    order by (coalesce(ii.reorder_level, 0) - coalesce(ii.current_stock, 0)) desc
  ) s;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.create_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := gen_random_uuid();
  v_supplier_id uuid := nullif(payload->>'supplier_id', '')::uuid;
  v_expected_delivery timestamptz := nullif(payload->>'expected_delivery', '')::timestamptz;
  v_notes text := nullif(payload->>'notes', '');
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_total numeric := 0;
  v_item jsonb;
  v_quantity numeric;
  v_unit_cost numeric;
  v_inventory_item_id uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  if v_supplier_id is null or not exists (select 1 from public.restaurant_suppliers where id = v_supplier_id and lodge_id = v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Choose a supplier from this business');
  end if;
  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'Add at least one stock item with a positive quantity');
  end if;

  insert into public.restaurant_purchase_orders (id, lodge_id, supplier_id, expected_delivery, notes, status, created_by)
  values (v_order_id, v_lodge_id, v_supplier_id, v_expected_delivery, v_notes, 'draft', auth.uid());

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_inventory_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    v_unit_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    if v_inventory_item_id is null or v_quantity <= 0 or v_unit_cost < 0 then
      raise exception 'Every purchase order line needs a business stock item, a positive quantity, and a non-negative unit cost';
    end if;
    if not exists (select 1 from public.inventory_items where id = v_inventory_item_id and lodge_id = v_lodge_id) then
      raise exception 'A purchase order stock item does not belong to this business';
    end if;
    insert into public.restaurant_purchase_order_items (purchase_order_id, inventory_item_id, description, quantity, unit_cost, total)
    values (v_order_id, v_inventory_item_id, nullif(v_item->>'description', ''), v_quantity, v_unit_cost, v_quantity * v_unit_cost);
    v_total := v_total + v_quantity * v_unit_cost;
  end loop;
  update public.restaurant_purchase_orders set total = v_total, updated_at = now() where id = v_order_id;
  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
end;
$$;

create or replace function public.update_purchase_order_draft(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_supplier_id uuid := nullif(payload->>'supplier_id', '')::uuid;
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_item jsonb;
  v_inventory_item_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_total numeric := 0;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  perform 1 from public.restaurant_purchase_orders where id = v_order_id and lodge_id = v_lodge_id and status = 'draft' for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Only a draft purchase order can be edited'); end if;
  if v_supplier_id is null or not exists (select 1 from public.restaurant_suppliers where id = v_supplier_id and lodge_id = v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Choose a supplier from this business');
  end if;
  if jsonb_array_length(v_items) = 0 then return jsonb_build_object('success', false, 'error', 'Add at least one stock item with a positive quantity'); end if;

  delete from public.restaurant_purchase_order_items where purchase_order_id = v_order_id;
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_inventory_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
    v_unit_cost := coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    if v_inventory_item_id is null or v_quantity <= 0 or v_unit_cost < 0 or not exists (select 1 from public.inventory_items where id = v_inventory_item_id and lodge_id = v_lodge_id) then
      raise exception 'Every purchase order line needs a business stock item, a positive quantity, and a non-negative unit cost';
    end if;
    insert into public.restaurant_purchase_order_items (purchase_order_id, inventory_item_id, description, quantity, unit_cost, total)
    values (v_order_id, v_inventory_item_id, nullif(v_item->>'description', ''), v_quantity, v_unit_cost, v_quantity * v_unit_cost);
    v_total := v_total + v_quantity * v_unit_cost;
  end loop;
  update public.restaurant_purchase_orders set supplier_id = v_supplier_id,
    expected_delivery = nullif(payload->>'expected_delivery', '')::timestamptz,
    notes = nullif(payload->>'notes', ''), total = v_total, updated_at = now()
  where id = v_order_id and lodge_id = v_lodge_id;
  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
end;
$$;

create or replace function public.convert_purchase_suggestions_to_po(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_supplier_id uuid := nullif(payload->>'supplier_id', '')::uuid;
  v_suggestions jsonb := coalesce(payload->'suggestions', '[]'::jsonb);
  v_suggestion jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin', 'manager']);
  if v_supplier_id is null or not exists (select 1 from public.restaurant_suppliers where id = v_supplier_id and lodge_id = v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Choose a valid supplier before creating a purchase order');
  end if;
  if jsonb_array_length(v_suggestions) = 0 then return jsonb_build_object('success', false, 'error', 'Select at least one low-stock suggestion'); end if;
  for v_suggestion in select * from jsonb_array_elements(v_suggestions) loop
    if coalesce(nullif(v_suggestion->>'quantity', '')::numeric, 0) <= 0 then
      return jsonb_build_object('success', false, 'error', 'A suggestion has no quantity to order. Refresh suggestions before creating a purchase order');
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'inventory_item_id', v_suggestion->>'inventory_item_id',
      'quantity', v_suggestion->>'quantity', 'unit_cost', coalesce(v_suggestion->>'unit_cost', '0')
    ));
  end loop;
  return public.create_purchase_order(jsonb_build_object(
    'lodge_id', v_lodge_id, 'supplier_id', v_supplier_id, 'items', v_items,
    'notes', coalesce(payload->>'notes', 'Auto-created from purchase suggestions')
  ));
end;
$$;

revoke all on function public.get_low_stock_purchase_suggestions(uuid, uuid) from public;
grant execute on function public.get_low_stock_purchase_suggestions(uuid, uuid) to anon, authenticated, service_role;
revoke all on function public.create_purchase_order(jsonb) from public;
grant execute on function public.create_purchase_order(jsonb) to anon, authenticated, service_role;
revoke all on function public.update_purchase_order_draft(jsonb) from public;
grant execute on function public.update_purchase_order_draft(jsonb) to anon, authenticated, service_role;
revoke all on function public.convert_purchase_suggestions_to_po(jsonb) from public;
grant execute on function public.convert_purchase_suggestions_to_po(jsonb) to anon, authenticated, service_role;

commit;
