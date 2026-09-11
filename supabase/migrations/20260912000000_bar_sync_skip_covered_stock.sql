-- Auto-menu sync must not mint duplicates for wizard-covered stock.
--
-- Incident: renaming a wizard-made stock item in Stock (for example
-- "Russian (Half)" to "Russian") re-ran the stock-update sync, which found
-- no auto row and inserted a brand-new auto sellable mirroring the stock.
-- The Till then showed both the auto row and the wizard product(s).
--
-- Scope of this change: the INSERT branch below now fires only when no
-- pos_menu_items row of any kind references the stock (wizard products
-- included, archived included, matching the delist migration's definition
-- of "kept in service"). Everything else is byte-identical to the
-- 20260911000000 definition:
--   - delisted/off-outlet stock still clears its auto rows and returns;
--   - existing auto rows are still maintained in place (name, price,
--     availability, barcode, depletion);
--   - standalone stock with no products at all still mints exactly one row.
--
-- Privileges are untouched: CREATE OR REPLACE keeps the existing function
-- access exactly as it is, and this file issues no privilege statements.

create or replace function public.sync_inventory_item_to_pos(p_inventory_id uuid, p_lodge_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $sync$
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
         ii.is_active,
         o.type as outlet_type
    into v_item
    from public.inventory_items ii
    left join public.outlets o on o.id = ii.outlet_id
   where ii.id = p_inventory_id
     and ii.lodge_id = p_lodge_id
   limit 1;

  if v_item.id is null
     or v_item.outlet_id is null
     or coalesce(v_item.is_active, true) is false
     or coalesce(v_item.outlet_type, '') not in ('food', 'beverage') then
    delete from public.pos_menu_items
     where lodge_id = p_lodge_id
       and inventory_item_id = p_inventory_id
       and auto_from_inventory = true;
    return;
  end if;

  v_pos_category := case when v_item.outlet_type = 'food' then 'Food' else 'Drinks' end;

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

  if v_rows_updated = 0 and not exists (
    select 1 from public.pos_menu_items
     where lodge_id = p_lodge_id
       and inventory_item_id = p_inventory_id
  ) then
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
end
$sync$;
