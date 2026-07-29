-- Bar pack templates are separate sellable POS products.  When a customer
-- scans a physical 6/12/24-pack, that package needs its own barcode rather
-- than reusing the single-bottle code.  Keep this additive: deployed
-- migrations are never edited in place.

create or replace function public.sync_inventory_item_to_pos(
  p_inventory_id uuid,
  p_lodge_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item record;
  v_rows_updated integer := 0;
  v_pos_category text;
begin
  select ii.id,
         ii.lodge_id,
         ii.name,
         ii.selling_price,
         ii.outlet_id,
         ii.barcode,
         o.type as outlet_type
    into v_item
    from public.inventory_items ii
    left join public.outlets o on o.id = ii.outlet_id
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

  v_pos_category := case when v_item.outlet_type = 'food' then 'Food' else 'Drinks' end;

  -- Only the auto-generated single/standard row is synchronized. Pack rows
  -- remain independently editable and retain their package barcode.
  update public.pos_menu_items
     set name = v_item.name,
         category = v_pos_category,
         price = coalesce(v_item.selling_price, 0),
         is_available = true,
         barcode = nullif(public.normalize_pos_barcode(v_item.barcode), ''),
         inventory_item_id = p_inventory_id,
         depletion_qty = 1,
         outlet_id = v_item.outlet_id,
         updated_at = now()
   where lodge_id = p_lodge_id
     and inventory_item_id = p_inventory_id
     and auto_from_inventory = true
     and coalesce(template_kind, 'standard') in ('standard', 'bar_single');

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 0 then
    insert into public.pos_menu_items (
      lodge_id, name, category, price, is_available, barcode,
      inventory_item_id, depletion_qty, outlet_id, auto_from_inventory, template_kind
    ) values (
      p_lodge_id,
      v_item.name,
      v_pos_category,
      coalesce(v_item.selling_price, 0),
      true,
      nullif(public.normalize_pos_barcode(v_item.barcode), ''),
      p_inventory_id,
      1,
      v_item.outlet_id,
      true,
      case when v_item.outlet_type = 'beverage' then 'bar_single' else 'standard' end
    );
  end if;
end;
$$;

create or replace function public.set_bar_pos_pack_template(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_pack_size integer := coalesce((payload->>'pack_size')::integer, 0);
  v_enabled boolean := coalesce((payload->>'enabled')::boolean, false);
  v_barcode_present boolean := payload ? 'barcode';
  v_barcode text := public.normalize_pos_barcode(payload->>'barcode');
  v_item record;
  v_existing uuid;
  v_saved_id uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_pack_size not in (6, 12, 24) then
    return jsonb_build_object('success', false, 'error', 'Only 6-pack, 12-pack, and case-24 templates are supported.');
  end if;

  select ii.id, ii.name, ii.selling_price, ii.outlet_id, o.type as outlet_type
    into v_item
    from public.inventory_items ii
    left join public.outlets o on o.id = ii.outlet_id
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
        lodge_id, name, category, price, is_available, barcode,
        inventory_item_id, depletion_qty, outlet_id, auto_from_inventory, template_kind, template_pack_size
      ) values (
        v_lodge_id,
        case v_pack_size when 6 then v_item.name || ' 6 Pack' when 12 then v_item.name || ' 12 Pack' else v_item.name || ' Case (24)' end,
        'Drinks', coalesce(v_item.selling_price, 0) * v_pack_size, true,
        v_barcode,
        v_inventory_item_id, v_pack_size, v_item.outlet_id, true, 'bar_pack', v_pack_size
      ) returning id into v_saved_id;
    else
      update public.pos_menu_items
         set name = case v_pack_size when 6 then v_item.name || ' 6 Pack' when 12 then v_item.name || ' 12 Pack' else v_item.name || ' Case (24)' end,
             category = 'Drinks',
             price = coalesce(v_item.selling_price, 0) * v_pack_size,
             is_available = true,
             barcode = case when v_barcode_present then v_barcode else barcode end,
             inventory_item_id = v_inventory_item_id,
             depletion_qty = v_pack_size,
             outlet_id = v_item.outlet_id,
             auto_from_inventory = true,
             updated_at = now()
       where id = v_existing;
      v_saved_id := v_existing;
    end if;
  else
    update public.pos_menu_items
       set is_available = false,
           barcode = case when v_barcode_present then v_barcode else barcode end,
           updated_at = now()
     where lodge_id = v_lodge_id
       and inventory_item_id = v_inventory_item_id
       and template_kind = 'bar_pack'
       and template_pack_size = v_pack_size
    returning id into v_saved_id;
  end if;

  perform public.sync_inventory_item_to_pos(v_inventory_item_id, v_lodge_id);

  return jsonb_build_object(
    'success', true,
    'id', v_saved_id,
    'outlet_id', v_item.outlet_id,
    'barcode', case when v_barcode_present then v_barcode else null end
  );
end;
$$;

revoke all on function public.sync_inventory_item_to_pos(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sync_inventory_item_to_pos(uuid, uuid) to service_role;
revoke all on function public.set_bar_pos_pack_template(jsonb) from public;
grant execute on function public.set_bar_pos_pack_template(jsonb) to anon, authenticated, service_role;
