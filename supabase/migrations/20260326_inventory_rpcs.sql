create or replace function public.create_inventory_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.inventory_items (
    lodge_id,
    name,
    category,
    unit,
    current_stock,
    reorder_level,
    latest_unit_cost
  ) values (
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    coalesce(payload->>'category', 'Bar'),
    coalesce(payload->>'unit', 'unit'),
    coalesce((payload->>'current_stock')::numeric, 0),
    coalesce((payload->>'reorder_level')::numeric, 0),
    coalesce((payload->>'latest_unit_cost')::numeric, 0)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_inventory_item(jsonb) to anon, authenticated;

create or replace function public.update_inventory_item(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.inventory_items
  set
    name = case when payload ? 'name' then payload->>'name' else name end,
    category = case when payload ? 'category' then payload->>'category' else category end,
    unit = case when payload ? 'unit' then payload->>'unit' else unit end,
    reorder_level = case when payload ? 'reorder_level' then coalesce((payload->>'reorder_level')::numeric, 0) else reorder_level end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_inventory_item(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_inventory_item(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  delete from public.inventory_purchases
  where item_id = p_id
    and lodge_id = p_lodge_id;

  delete from public.inventory_items
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_inventory_item(uuid, uuid) to anon, authenticated;

create or replace function public.add_inventory_purchase(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_purchase_id uuid;
  v_item_id uuid;
  v_lodge_id uuid;
  v_qty numeric;
  v_total numeric;
  v_unit_cost numeric;
  v_new_stock numeric;
begin
  v_item_id := (payload->>'item_id')::uuid;
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_qty := coalesce((payload->>'quantity_purchased')::numeric, 0);
  v_total := coalesce((payload->>'total_cost')::numeric, 0);
  v_unit_cost := coalesce((payload->>'unit_cost')::numeric, case when v_qty > 0 then v_total / v_qty else 0 end);

  insert into public.inventory_purchases (
    lodge_id,
    item_id,
    date,
    quantity_purchased,
    total_cost,
    unit_cost,
    notes
  ) values (
    v_lodge_id,
    v_item_id,
    (payload->>'date')::date,
    v_qty,
    v_total,
    v_unit_cost,
    nullif(payload->>'notes', '')
  )
  returning id into v_purchase_id;

  update public.inventory_items
  set
    current_stock = coalesce(current_stock, 0) + v_qty,
    latest_unit_cost = v_unit_cost
  where id = v_item_id
    and lodge_id = v_lodge_id
  returning current_stock into v_new_stock;

  if v_new_stock is null then
    raise exception 'Inventory item not found';
  end if;

  return jsonb_build_object('success', true, 'id', v_purchase_id, 'new_stock', v_new_stock);
end;
$function$;

grant execute on function public.add_inventory_purchase(jsonb) to anon, authenticated;

create or replace function public.adjust_inventory_stock(
  p_item_id uuid,
  p_lodge_id uuid,
  p_delta numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_stock numeric;
begin
  update public.inventory_items
  set current_stock = greatest(0, coalesce(current_stock, 0) + coalesce(p_delta, 0))
  where id = p_item_id
    and lodge_id = p_lodge_id
  returning current_stock into v_new_stock;

  if v_new_stock is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  return jsonb_build_object('success', true, 'new_stock', v_new_stock);
end;
$function$;

grant execute on function public.adjust_inventory_stock(uuid, uuid, numeric, text) to anon, authenticated;
