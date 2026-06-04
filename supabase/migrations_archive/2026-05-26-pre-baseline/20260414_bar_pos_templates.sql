alter table public.pos_menu_items
  add column if not exists template_kind text not null default 'standard',
  add column if not exists template_pack_size integer;

update public.pos_menu_items
   set template_kind = 'bar_single',
       template_pack_size = null
  from public.outlets o
 where public.pos_menu_items.outlet_id = o.id
   and o.type = 'beverage'
   and public.pos_menu_items.auto_from_inventory = true;

update public.pos_menu_items
   set template_kind = 'standard'
 where coalesce(template_kind, '') = '';

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
begin
  select
    ii.id,
    ii.lodge_id,
    ii.name,
    ii.selling_price,
    ii.outlet_id,
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
     or coalesce(v_item.outlet_type, '') <> 'beverage'
     or coalesce(v_item.selling_price, 0) <= 0 then
    delete from public.pos_menu_items
     where lodge_id = p_lodge_id
       and inventory_item_id = p_inventory_id
       and auto_from_inventory = true;
    return;
  end if;

  update public.pos_menu_items
     set name = v_item.name,
         category = 'Drinks',
         price = coalesce(v_item.selling_price, 0),
         is_available = true,
         inventory_item_id = p_inventory_id,
         depletion_qty = 1,
         outlet_id = v_item.outlet_id,
         template_kind = 'bar_single',
         template_pack_size = null
   where lodge_id = p_lodge_id
     and inventory_item_id = p_inventory_id
     and template_kind = 'bar_single'
     and auto_from_inventory = true;

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 0 then
    insert into public.pos_menu_items (
      lodge_id,
      name,
      category,
      price,
      is_available,
      inventory_item_id,
      depletion_qty,
      outlet_id,
      auto_from_inventory,
      template_kind,
      template_pack_size
    ) values (
      p_lodge_id,
      v_item.name,
      'Drinks',
      coalesce(v_item.selling_price, 0),
      true,
      p_inventory_id,
      1,
      v_item.outlet_id,
      true,
      'bar_single',
      null
    );
  end if;

  update public.pos_menu_items
     set name = case template_pack_size
                  when 6 then v_item.name || ' 6 Pack'
                  when 12 then v_item.name || ' 12 Pack'
                  when 24 then v_item.name || ' Case (24)'
                  else v_item.name
                end,
         category = 'Drinks',
         price = coalesce(v_item.selling_price, 0) * coalesce(template_pack_size, 1),
         is_available = true,
         inventory_item_id = p_inventory_id,
         depletion_qty = coalesce(template_pack_size, 1),
         outlet_id = v_item.outlet_id,
         auto_from_inventory = true
   where lodge_id = p_lodge_id
     and inventory_item_id = p_inventory_id
     and template_kind = 'bar_pack';

  delete from public.pos_menu_items
   where lodge_id = p_lodge_id
     and inventory_item_id = p_inventory_id
     and template_kind = 'standard'
     and auto_from_inventory = true;
end;
$function$;

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

  if coalesce(v_outlet_type, '') = 'beverage'
     and v_selling_price <= 0 then
    return jsonb_build_object('success', false, 'error', 'Set a POS selling price greater than zero for Bar inventory items.');
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
    outlet_id
  ) values (
    v_lodge_id,
    payload->>'name',
    coalesce(payload->>'category', 'Bar'),
    coalesce(payload->>'unit', 'unit'),
    coalesce((payload->>'current_stock')::numeric, 0),
    coalesce((payload->>'reorder_level')::numeric, 0),
    coalesce((payload->>'latest_unit_cost')::numeric, 0),
    v_selling_price,
    v_outlet_id
  )
  returning id into v_id;

  perform public.sync_inventory_item_to_pos(v_id, v_lodge_id);

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

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

  if coalesce(v_outlet_type, '') = 'beverage'
     and v_effective_selling_price <= 0 then
    return jsonb_build_object('success', false, 'error', 'Set a POS selling price greater than zero for Bar inventory items.');
  end if;

  update public.inventory_items
  set
    name          = case when payload ? 'name' then payload->>'name' else name end,
    category      = case when payload ? 'category' then payload->>'category' else category end,
    unit          = case when payload ? 'unit' then payload->>'unit' else unit end,
    reorder_level = case when payload ? 'reorder_level' then coalesce((payload->>'reorder_level')::numeric, 0) else reorder_level end,
    selling_price = case when payload ? 'selling_price' then coalesce((payload->>'selling_price')::numeric, 0) else selling_price end,
    outlet_id     = case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else outlet_id end
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

create or replace function public.create_pos_menu_item(payload jsonb)
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
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_outlet_id is not null then
    select type
      into v_outlet_type
      from public.outlets
     where id = v_outlet_id
       and lodge_id = v_lodge_id
     limit 1;
  end if;

  if coalesce(v_outlet_type, '') = 'beverage' then
    return jsonb_build_object('success', false, 'error', 'Bar POS items must come from Bar inventory products.');
  end if;

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
    template_kind,
    template_pack_size
  ) values (
    v_lodge_id,
    payload->>'name',
    coalesce(payload->>'category', 'Other'),
    coalesce((payload->>'price')::numeric, 0),
    coalesce((payload->>'is_available')::boolean, true),
    nullif(payload->>'barcode', ''),
    nullif(payload->>'inventory_item_id', '')::uuid,
    case
      when nullif(payload->>'inventory_item_id', '') is null then null
      else coalesce((payload->>'depletion_qty')::numeric, 1)
    end,
    v_outlet_id,
    'standard',
    null
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

create or replace function public.update_pos_menu_item(
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
  v_template_kind text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select template_kind
    into v_template_kind
    from public.pos_menu_items
   where id = p_id
     and lodge_id = p_lodge_id
   limit 1;

  if v_template_kind is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  if v_template_kind = 'bar_pack' then
    return jsonb_build_object('success', false, 'error', 'Bar pack templates are managed from the Bar template controls.');
  end if;

  if v_template_kind = 'bar_single' then
    if jsonb_object_length(payload - 'barcode') > 0 then
      return jsonb_build_object('success', false, 'error', 'Bar bottle details are managed from inventory. Only barcode updates are allowed here.');
    end if;

    update public.pos_menu_items
       set barcode = case when payload ? 'barcode' then nullif(payload->>'barcode', '') else barcode end
     where id = p_id
       and lodge_id = p_lodge_id
    returning id into v_updated;
  else
    update public.pos_menu_items
    set
      name              = case when payload ? 'name' then payload->>'name' else name end,
      category          = case when payload ? 'category' then coalesce(payload->>'category', 'Other') else category end,
      price             = case when payload ? 'price' then coalesce((payload->>'price')::numeric, 0) else price end,
      is_available      = case when payload ? 'is_available' then coalesce((payload->>'is_available')::boolean, true) else is_available end,
      barcode           = case when payload ? 'barcode' then nullif(payload->>'barcode', '') else barcode end,
      inventory_item_id = case when payload ? 'inventory_item_id' then nullif(payload->>'inventory_item_id', '')::uuid else inventory_item_id end,
      depletion_qty     = case
                            when payload ? 'inventory_item_id' then
                              case
                                when nullif(payload->>'inventory_item_id', '') is null then null
                                else coalesce((payload->>'depletion_qty')::numeric, 1)
                              end
                            when payload ? 'depletion_qty' then coalesce((payload->>'depletion_qty')::numeric, 1)
                            else depletion_qty
                          end,
      outlet_id         = case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else outlet_id end
    where id = p_id
      and lodge_id = p_lodge_id
    returning id into v_updated;
  end if;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

create or replace function public.delete_pos_menu_item(
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
  v_template_kind text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select template_kind
    into v_template_kind
    from public.pos_menu_items
   where id = p_id
     and lodge_id = p_lodge_id
   limit 1;

  if v_template_kind is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  if v_template_kind <> 'standard' then
    return jsonb_build_object('success', false, 'error', 'Inventory-managed Bar items cannot be deleted from the manual menu list.');
  end if;

  delete from public.pos_menu_items
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

create or replace function public.set_bar_pos_pack_template(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_pack_size integer := coalesce((payload->>'pack_size')::integer, 0);
  v_enabled boolean := coalesce((payload->>'enabled')::boolean, false);
  v_item record;
  v_existing uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_pack_size not in (6, 12, 24) then
    return jsonb_build_object('success', false, 'error', 'Only 6-pack, 12-pack, and case-24 templates are supported.');
  end if;

  select
    ii.id,
    ii.name,
    ii.selling_price,
    ii.outlet_id,
    o.type as outlet_type
  into v_item
  from public.inventory_items ii
  left join public.outlets o
    on o.id = ii.outlet_id
  where ii.id = v_inventory_item_id
    and ii.lodge_id = v_lodge_id
  limit 1;

  if v_item.id is null then
    return jsonb_build_object('success', false, 'error', 'Bar inventory product not found.');
  end if;

  if coalesce(v_item.outlet_type, '') <> 'beverage' then
    return jsonb_build_object('success', false, 'error', 'Pack templates are only available for Bar inventory products.');
  end if;

  if coalesce(v_item.selling_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Set a bottle selling price before enabling pack templates.');
  end if;

  if not exists (
    select 1
      from public.pos_menu_items
     where lodge_id = v_lodge_id
       and inventory_item_id = v_inventory_item_id
       and template_kind = 'bar_single'
  ) then
    perform public.sync_inventory_item_to_pos(v_inventory_item_id, v_lodge_id);
  end if;

  select id
    into v_existing
    from public.pos_menu_items
   where lodge_id = v_lodge_id
     and inventory_item_id = v_inventory_item_id
     and template_kind = 'bar_pack'
     and template_pack_size = v_pack_size
   limit 1;

  if v_enabled then
    if v_existing is null then
      insert into public.pos_menu_items (
        lodge_id,
        name,
        category,
        price,
        is_available,
        inventory_item_id,
        depletion_qty,
        outlet_id,
        auto_from_inventory,
        template_kind,
        template_pack_size
      ) values (
        v_lodge_id,
        case v_pack_size
          when 6 then v_item.name || ' 6 Pack'
          when 12 then v_item.name || ' 12 Pack'
          else v_item.name || ' Case (24)'
        end,
        'Drinks',
        coalesce(v_item.selling_price, 0) * v_pack_size,
        true,
        v_inventory_item_id,
        v_pack_size,
        v_item.outlet_id,
        true,
        'bar_pack',
        v_pack_size
      );
    else
      update public.pos_menu_items
         set name = case v_pack_size
                      when 6 then v_item.name || ' 6 Pack'
                      when 12 then v_item.name || ' 12 Pack'
                      else v_item.name || ' Case (24)'
                    end,
             category = 'Drinks',
             price = coalesce(v_item.selling_price, 0) * v_pack_size,
             is_available = true,
             inventory_item_id = v_inventory_item_id,
             depletion_qty = v_pack_size,
             outlet_id = v_item.outlet_id,
             auto_from_inventory = true
       where id = v_existing;
    end if;
  else
    delete from public.pos_menu_items
     where lodge_id = v_lodge_id
       and inventory_item_id = v_inventory_item_id
       and template_kind = 'bar_pack'
       and template_pack_size = v_pack_size;
  end if;

  perform public.sync_inventory_item_to_pos(v_inventory_item_id, v_lodge_id);

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.set_bar_pos_pack_template(jsonb) from public;
grant execute on function public.set_bar_pos_pack_template(jsonb) to anon, authenticated;

do $$
declare
  v_row record;
begin
  delete from public.pos_menu_items p
   using public.outlets o
   where p.outlet_id = o.id
     and p.auto_from_inventory = true
     and o.type = 'food';

  for v_row in
    select id, lodge_id
      from public.inventory_items
  loop
    perform public.sync_inventory_item_to_pos(v_row.id, v_row.lodge_id);
  end loop;
end $$;
