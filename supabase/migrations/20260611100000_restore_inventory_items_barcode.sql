alter table public.inventory_items
  add column if not exists updated_at timestamp with time zone default now(),
  add column if not exists sku text,
  add column if not exists barcode text,
  add column if not exists is_active boolean not null default true;

create index if not exists idx_inventory_items_lodge_barcode
  on public.inventory_items (lodge_id, barcode)
  where barcode is not null;

create or replace function public.sync_inventory_item_to_pos(
  p_inventory_id uuid,
  p_lodge_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item record;
  v_rows_updated integer := 0;
  v_pos_category text;
begin
  select
    ii.id,
    ii.lodge_id,
    ii.name,
    ii.selling_price,
    ii.outlet_id,
    ii.barcode,
    o.type as outlet_type
  into v_item
  from public.inventory_items ii
  left join public.outlets o
    on o.id = ii.outlet_id
  where ii.id = p_inventory_id
    and ii.lodge_id = p_lodge_id
  limit 1;

  if v_item.id is null
     or v_item.outlet_id is null
     or coalesce(v_item.outlet_type, '') not in ('food', 'beverage') then
    delete from public.pos_menu_items
     where lodge_id = p_lodge_id
       and inventory_item_id = p_inventory_id
       and auto_from_inventory = true;
    return;
  end if;

  v_pos_category := case
    when v_item.outlet_type = 'food' then 'Food'
    else 'Drinks'
  end;

  update public.pos_menu_items
     set name = v_item.name,
         category = v_pos_category,
         price = coalesce(v_item.selling_price, 0),
         is_available = true,
         barcode = nullif(v_item.barcode, ''),
         inventory_item_id = p_inventory_id,
         depletion_qty = 1,
         outlet_id = v_item.outlet_id
   where lodge_id = p_lodge_id
     and inventory_item_id = p_inventory_id
     and auto_from_inventory = true;

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 0 then
    insert into public.pos_menu_items (
      lodge_id,
      name,
      category,
      price,
      is_available,
      barcode,
      inventory_item_id,
      depletion_qty,
      outlet_id,
      auto_from_inventory
    ) values (
      p_lodge_id,
      v_item.name,
      v_pos_category,
      coalesce(v_item.selling_price, 0),
      true,
      nullif(v_item.barcode, ''),
      p_inventory_id,
      1,
      v_item.outlet_id,
      true
    );
  end if;
end;
$function$;

revoke all on function public.sync_inventory_item_to_pos(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_inventory_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_outlet_type text;
  v_selling_price numeric := coalesce((payload->>'selling_price')::numeric, 0);
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_outlet_id is not null then
    select type
      into v_outlet_type
      from public.outlets
     where id = v_outlet_id
       and lodge_id = v_lodge_id
     limit 1;

    if v_outlet_type is null then
      return jsonb_build_object('success', false, 'error', 'Selected outlet was not found.');
    end if;
  end if;

  if coalesce(v_outlet_type, '') in ('food', 'beverage')
     and v_selling_price <= 0 then
    return jsonb_build_object('success', false, 'error', 'Set a POS selling price greater than zero for Bar or Kitchen inventory items.');
  end if;

  insert into public.inventory_items (
    lodge_id,
    name,
    category,
    unit,
    current_stock,
    reorder_level,
    latest_unit_cost,
    selling_price,
    outlet_id,
    sku,
    barcode
  ) values (
    v_lodge_id,
    payload->>'name',
    coalesce(payload->>'category', 'Bar'),
    coalesce(payload->>'unit', 'unit'),
    coalesce((payload->>'current_stock')::numeric, 0),
    coalesce((payload->>'reorder_level')::numeric, 0),
    coalesce((payload->>'latest_unit_cost')::numeric, 0),
    v_selling_price,
    v_outlet_id,
    nullif(payload->>'sku', ''),
    nullif(payload->>'barcode', '')
  )
  returning id into v_id;

  perform public.sync_inventory_item_to_pos(v_id, v_lodge_id);

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.create_inventory_item(jsonb) from public;
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
  v_current_outlet_id uuid;
  v_effective_outlet_id uuid;
  v_effective_selling_price numeric;
  v_outlet_type text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select outlet_id, selling_price
    into v_current_outlet_id, v_effective_selling_price
    from public.inventory_items
   where id = p_id
     and lodge_id = p_lodge_id
   limit 1;

  if v_effective_selling_price is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  v_effective_outlet_id := case
    when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid
    else v_current_outlet_id
  end;

  v_effective_selling_price := case
    when payload ? 'selling_price' then coalesce((payload->>'selling_price')::numeric, 0)
    else v_effective_selling_price
  end;

  if v_effective_outlet_id is not null then
    select type
      into v_outlet_type
      from public.outlets
     where id = v_effective_outlet_id
       and lodge_id = p_lodge_id
     limit 1;

    if v_outlet_type is null then
      return jsonb_build_object('success', false, 'error', 'Selected outlet was not found.');
    end if;
  end if;

  if coalesce(v_outlet_type, '') in ('food', 'beverage')
     and v_effective_selling_price <= 0 then
    return jsonb_build_object('success', false, 'error', 'Set a POS selling price greater than zero for Bar or Kitchen inventory items.');
  end if;

  update public.inventory_items
  set
    name          = case when payload ? 'name' then payload->>'name' else name end,
    category      = case when payload ? 'category' then payload->>'category' else category end,
    unit          = case when payload ? 'unit' then payload->>'unit' else unit end,
    reorder_level = case when payload ? 'reorder_level' then coalesce((payload->>'reorder_level')::numeric, 0) else reorder_level end,
    selling_price = case when payload ? 'selling_price' then coalesce((payload->>'selling_price')::numeric, 0) else selling_price end,
    outlet_id     = case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else outlet_id end,
    sku           = case when payload ? 'sku' then nullif(payload->>'sku', '') else sku end,
    barcode       = case when payload ? 'barcode' then nullif(payload->>'barcode', '') else barcode end,
    updated_at    = now()
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  perform public.sync_inventory_item_to_pos(p_id, p_lodge_id);

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

revoke all on function public.update_inventory_item(uuid, uuid, jsonb) from public;
grant execute on function public.update_inventory_item(uuid, uuid, jsonb) to anon, authenticated;
