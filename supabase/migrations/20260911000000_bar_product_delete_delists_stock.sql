-- Product delete delists its stock automatically; movement history stays.
--
-- Operator requirement: deleting a product must delist the linked stock item
-- in Stock automatically, while movement history is preserved for financial
-- truth and auditing. Delist = inventory_items.is_active = false (rows and
-- movements untouched); operational reads exclude delisted items, financial
-- and audit reads keep every movement row.
--
-- Also repairs opening-stock double counting: the AFTER INSERT log trigger
-- (note 'Opening stock') is the single opening writer. The location-seed
-- trigger wrote a second opening movement for outlet-allocated items and the
-- wizard contract wrote a third; both redundant writers are removed and the
-- provable same-event duplicates are deduplicated (richer seed rows kept).
--
-- delete_pos_menu_item additionally becomes replay-idempotent: a missing row
-- returns success (already deleted) instead of dead-lettering offline
-- replays, and delists only when nothing still references the stock item
-- (no sellable rows of any kind incl. archived, no menu_items, no recipe
-- ingredients, no prep ingredients or prep outputs for this lodge).

CREATE OR REPLACE FUNCTION public.save_bar_product_with_stock(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id','')::uuid;
  v_operation_key text := nullif(btrim(payload->>'operation_key'),'');
  v_payload_hash text := encode(digest(payload::text,'sha256'),'hex');
  v_existing public.restaurant_catalog_operations%rowtype;
  v_menu_item_id uuid := nullif(payload->>'menu_item_id','')::uuid;
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id','')::uuid;
  v_expected_menu_version timestamptz := nullif(payload->>'expected_menu_version','')::timestamptz;
  v_expected_stock_version timestamptz := nullif(payload->>'expected_stock_version','')::timestamptz;
  v_product jsonb := coalesce(payload->'product','{}'::jsonb);
  v_stock jsonb := coalesce(payload->'stock','{}'::jsonb);
  v_packs jsonb := case when jsonb_typeof(payload->'packs')='array' then payload->'packs' else '[]'::jsonb end;
  v_stock_mode text := coalesce(nullif(btrim(v_stock->>'mode'),''),'create');
  v_stock_row public.inventory_items%rowtype;
  v_outlet_id uuid;
  v_outlet_type text;
  v_outlet_active boolean;
  v_opening numeric := coalesce(nullif(v_stock->>'opening_stock','')::numeric,0);
  v_selling numeric := coalesce(nullif(v_stock->>'selling_price','')::numeric,0);
  v_pack_enabled boolean := false;
  v_pack_index integer;
  v_pack_elem jsonb;
  v_pack_exists boolean;
  v_menu jsonb;
  v_pack jsonb;
  v_result jsonb;
  v_entity_ids jsonb;
  v_actor uuid;
  v_txn_start timestamptz := clock_timestamp();
  v_job_outlets uuid[] := '{}';
  v_row record;
begin
  v_actor := public.app_get_actor_user_id();
  perform public.app_require_lodge_role(v_lodge_id, array['manager','admin','super_admin']);
  if v_lodge_id is null or v_operation_key is null then raise exception 'Lodge and stable catalog operation key are required' using errcode='22023'; end if;
  if v_inventory_item_id is null then raise exception 'A stable inventory item identity is required' using errcode='22023'; end if;
  if v_stock_mode not in ('create','link') then raise exception 'Stock mode must be create or link' using errcode='22023'; end if;
  if v_menu_item_id is not null and v_expected_menu_version is null then raise exception 'Editing a product requires its loaded version. Reload and retry.' using errcode='22023'; end if;
  if v_stock_mode = 'link' and v_expected_stock_version is null then raise exception 'Linking stock requires its loaded version. Reload and retry.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bar-catalog:'||v_lodge_id::text||':'||v_operation_key,0));
  select * into v_existing from public.restaurant_catalog_operations where lodge_id=v_lodge_id and operation_key=v_operation_key for update;
  if found then
    if v_existing.payload_hash <> v_payload_hash then raise exception 'Catalog operation key was already used with a different product or stock payload' using errcode='23505'; end if;
    return v_existing.result || jsonb_build_object('replayed',true);
  end if;
  if nullif(btrim(v_product->>'name'),'') is null then raise exception 'Product name is required' using errcode='22023'; end if;
  if coalesce((v_product->>'price')::numeric,0) <= 0 then raise exception 'Product price must be greater than zero' using errcode='22023'; end if;
  if coalesce((v_product->>'depletion_qty')::numeric,1) <= 0 then raise exception 'Stock consumed per sale must be greater than zero' using errcode='22023'; end if;
  -- Duplicate-name guard (product): distinct operation keys must not mint a
  -- second same-named sellable. Derived pack rows are excluded; same-key
  -- replays returned above; edits exclude their own row.
  if exists (
    select 1 from public.pos_menu_items
     where lodge_id = v_lodge_id
       and lower(btrim(name)) = lower(btrim(v_product->>'name'))
       and coalesce(template_kind,'') <> 'bar_pack'
       and (v_menu_item_id is null or id <> v_menu_item_id)
  ) then
    raise exception 'A product named "%" already exists. Use the existing product instead.', btrim(v_product->>'name') using errcode='23505';
  end if;

  -- validate pack sizes (index iteration to avoid record substitution)
  for v_pack_index in 0 .. jsonb_array_length(case when jsonb_typeof(v_packs) = 'array' then v_packs else '[]'::jsonb end) - 1 loop
    v_pack_elem := v_packs -> v_pack_index;
    if coalesce((v_pack_elem->>'enabled')::boolean,false) then
      if (v_pack_elem->>'pack_size')::integer not in (6,12,24) then
        raise exception 'Pack size must be 6, 12 or 24' using errcode='22023';
      end if;
      v_pack_enabled := true;
    end if;
  end loop;
  if v_stock_mode = 'create' then
    if nullif(btrim(v_stock->>'name'),'') is null then raise exception 'Stock item name is required' using errcode='22023'; end if;
    if v_opening < 0 then raise exception 'Opening stock cannot be negative' using errcode='22023'; end if;
    v_outlet_id := nullif(v_stock->>'outlet_id','')::uuid;
    if v_outlet_id is not null then
      select type, (is_active is not false) into v_outlet_type, v_outlet_active
        from public.outlets where id = v_outlet_id and lodge_id = v_lodge_id;
      if not found then raise exception 'Selected stock outlet was not found in this lodge' using errcode='22023'; end if;
      perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
    end if;
    -- Duplicate-name guard (stock): a second same-named stock item in the
    -- same stock location (outlet, or unassigned) is a duplicate creation.
    if exists (
      select 1 from public.inventory_items
       where lodge_id = v_lodge_id
         and lower(btrim(name)) = lower(btrim(v_stock->>'name'))
         and outlet_id is not distinct from v_outlet_id
         and coalesce(is_active, true)
    ) then
      raise exception 'A stock item named "%" already exists in this stock location. Use the existing stock item instead.', btrim(v_stock->>'name') using errcode='23505';
    end if;

    if v_selling <= 0 and coalesce(v_outlet_type,'') in ('food','beverage') then
      raise exception 'Set a POS selling price greater than zero for Bar or Kitchen stock items' using errcode='22023';
    end if;
    if v_pack_enabled and (v_outlet_id is null or v_outlet_type <> 'beverage' or v_outlet_active is not true) then
      raise exception 'Packs require the stock item to sit in an active Bar outlet. Assign one first.' using errcode='22023';
    end if;
    if nullif(btrim(v_stock->>'barcode'),'') is not null then
      select id, name into v_row from public.inventory_items
       where lodge_id = v_lodge_id and barcode = nullif(btrim(v_stock->>'barcode'),'');
      if found then raise exception 'Barcode is already used by stock item "%". Use the existing product instead.' , v_row.name using errcode='23505'; end if;
    end if;
  else
    select * into v_stock_row from public.inventory_items where id = v_inventory_item_id and lodge_id = v_lodge_id for update;
    if not found then raise exception 'Linked stock item was not found in this lodge' using errcode='22023'; end if;
    if v_stock_row.updated_at is distinct from v_expected_stock_version then
      raise exception 'Stock item changed underneath this edit. Reload and retry.' using errcode='23505';
    end if;
    v_outlet_id := v_stock_row.outlet_id;
    select type, (is_active is not false) into v_outlet_type, v_outlet_active
      from public.outlets where id = v_stock_row.outlet_id and lodge_id = v_lodge_id;
    if v_outlet_id is not null then
      perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
    end if;
    if v_pack_enabled and (v_stock_row.outlet_id is null or v_outlet_type <> 'beverage' or v_outlet_active is not true) then
      raise exception 'Packs require the stock item to sit in an active Bar outlet. Assign one first.' using errcode='22023';
    end if;
  end if;
  if nullif(btrim(v_product->>'barcode'),'') is not null then
    select id into v_row from public.pos_menu_items
     where lodge_id = v_lodge_id
       and barcode = nullif(btrim(v_product->>'barcode'),'')
       and (v_menu_item_id is null or id <> v_menu_item_id);
    if found then raise exception 'Barcode is already used by another sellable product. Use the existing product instead.' using errcode='23505'; end if;
  end if;
  if v_menu_item_id is not null then
    select updated_at into v_row from public.pos_menu_items where id = v_menu_item_id and lodge_id = v_lodge_id for update;
    if not found then raise exception 'Sellable product was not found in this lodge' using errcode='22023'; end if;
    if v_row.updated_at is distinct from v_expected_menu_version then
      raise exception 'Product changed underneath this edit. Reload and retry.' using errcode='23505';
    end if;
  end if;
  if v_stock_mode = 'create' then
    insert into public.inventory_items (
      id, lodge_id, name, category, unit, current_stock, reorder_level,
      latest_unit_cost, selling_price, outlet_id, barcode
    ) values (
      v_inventory_item_id, v_lodge_id,
      btrim(v_stock->>'name'),
      coalesce(nullif(btrim(v_stock->>'category'),''),'Bar'),
      coalesce(nullif(v_stock->>'unit',''),'unit'),
      v_opening,
      coalesce(nullif(v_stock->>'reorder_level','')::numeric,0),
      coalesce(nullif(v_stock->>'unit_cost','')::numeric,0),
      v_selling,
      v_outlet_id,
      nullif(btrim(v_stock->>'barcode'),'')
    );
    -- Opening stock is recorded exactly once by the inventory_items AFTER
    -- INSERT trigger (log_inventory_opening_stock_movement); an explicit
    -- insert here double-counted the same event in the movement ledger.
  end if;
  if v_menu_item_id is null then
    v_menu := public.create_pos_menu_item(jsonb_build_object(
      'lodge_id',v_lodge_id,
      'name',btrim(v_product->>'name'),
      'category',coalesce(nullif(btrim(v_product->>'category'),''),'Drinks'),
      'price',(v_product->>'price')::numeric,
      'barcode',nullif(v_product->>'barcode',''),
      'inventory_item_id',v_inventory_item_id,
      'depletion_qty',coalesce((v_product->>'depletion_qty')::numeric,1),
      'is_available',coalesce((v_product->>'is_available')::boolean,true)));
  else
    v_menu := public.update_pos_menu_item(v_menu_item_id,v_lodge_id,jsonb_build_object(
      'name',btrim(v_product->>'name'),
      'category',coalesce(nullif(btrim(v_product->>'category'),''),'Drinks'),
      'price',(v_product->>'price')::numeric,
      'barcode',nullif(v_product->>'barcode',''),
      'inventory_item_id',v_inventory_item_id,
      'depletion_qty',coalesce((v_product->>'depletion_qty')::numeric,1),
      'is_available',coalesce((v_product->>'is_available')::boolean,true)));
  end if;
  if not coalesce((v_menu->>'success')::boolean,false) then raise exception '%',coalesce(v_menu->>'error','Product save failed') using errcode='22023'; end if;
  v_menu_item_id := coalesce(v_menu_item_id,nullif(v_menu->>'id','')::uuid);
  if v_menu_item_id is null then raise exception 'Product save did not return a menu item identity' using errcode='XX000'; end if;
  -- packs (index iteration to avoid record substitution)
  for v_pack_index in 0 .. jsonb_array_length(case when jsonb_typeof(v_packs) = 'array' then v_packs else '[]'::jsonb end) - 1 loop
    v_pack_elem := v_packs -> v_pack_index;
    if not coalesce((v_pack_elem->>'enabled')::boolean,false) then
      select exists (
        select 1 from public.pos_menu_items
         where lodge_id = v_lodge_id
           and inventory_item_id = v_inventory_item_id
           and template_kind = 'bar_pack'
           and template_pack_size = (v_pack_elem->>'pack_size')::integer
      ) into v_pack_exists;
      if not v_pack_exists then continue; end if;
    end if;
    v_pack := public.set_bar_pos_pack_template(jsonb_build_object(
      'lodge_id',v_lodge_id,'inventory_item_id',v_inventory_item_id,
      'pack_size',(v_pack_elem->>'pack_size')::integer,'enabled',coalesce((v_pack_elem->>'enabled')::boolean,false),
      'barcode',case when v_pack_elem ? 'barcode' then v_pack_elem->>'barcode' else null end));
    if not coalesce((v_pack->>'success')::boolean,false) then raise exception '%',coalesce(v_pack->>'error','Pack template save failed') using errcode='22023'; end if;
  end loop;
  delete from public.pos_menu_items
   where lodge_id = v_lodge_id
     and inventory_item_id = v_inventory_item_id
     and id <> v_menu_item_id
     and coalesce(auto_from_inventory,false) = true
     and coalesce(template_kind,'') <> 'bar_pack'
     and created_at >= v_txn_start;
  if v_outlet_id is null then
    for v_row in select id from public.outlets where lodge_id = v_lodge_id and is_active is not false loop
      insert into public.catalog_publication_jobs(lodge_id,operation_key,outlet_id,version)
      values(v_lodge_id,v_operation_key,v_row.id,nextval('public.catalog_publication_version_seq'))
      on conflict(lodge_id,operation_key,outlet_id) do nothing;
      v_job_outlets := v_job_outlets || v_row.id;
    end loop;
  else
    insert into public.catalog_publication_jobs(lodge_id,operation_key,outlet_id,version)
    values(v_lodge_id,v_operation_key,v_outlet_id,nextval('public.catalog_publication_version_seq'))
    on conflict(lodge_id,operation_key,outlet_id) do nothing;
    v_job_outlets := v_job_outlets || v_outlet_id;
  end if;
  v_entity_ids := jsonb_build_object('menu_item_id',v_menu_item_id,'inventory_item_id',v_inventory_item_id);
  v_result := jsonb_build_object('success',true,'menu_item_id',v_menu_item_id,'inventory_item_id',v_inventory_item_id,'operation_key',v_operation_key,'outlet_ids',coalesce(to_jsonb(v_job_outlets),'[]'::jsonb),'replayed',false);
  insert into public.restaurant_catalog_operations(lodge_id,operation_key,payload_hash,request_payload,entity_ids,result,created_by)
  values(v_lodge_id,v_operation_key,v_payload_hash,payload,v_entity_ids,v_result,v_actor);
  perform public.log_restaurant_financial_action(v_lodge_id,'bar_product_stock_saved','pos_menu_items',v_menu_item_id,null,v_result,null);
  return v_result;
end
$body$;

-- Desktop/POS clients call RPCs with the anon key (session validated server-side
-- inside the function), so the function must be executable by anon. SECURITY
-- DEFINER role is not the caller; enforcement is by app_require_lodge_role etc.
revoke all on function public.save_bar_product_with_stock(jsonb) from public, anon, authenticated;
grant execute on function public.save_bar_product_with_stock(jsonb) to anon, authenticated, service_role;

-- Deletes a POS menu item (product) and delists its stock item when nothing
-- else still sells or consumes that stock. Movement history is NEVER touched:
-- delisting is inventory_items.is_active = false plus an audit entry, so
-- financial reads and audits keep every movement row. A missing row returns
-- idempotent success so offline queue replays never dead-letter a delete
-- that already applied.
create or replace function public.delete_pos_menu_item(p_id uuid, p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $delist$
declare
  v_item_id uuid;
  v_inventory_item_id uuid;
  v_has_sale_history boolean;
  v_stock_still_referenced boolean;
  v_stock_delisted boolean := false;
  v_delisted_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager','admin','super_admin']);

  select id, inventory_item_id into v_item_id, v_inventory_item_id
    from public.pos_menu_items
   where id = p_id and lodge_id = p_lodge_id;

  if v_item_id is null then
    -- Replay idempotency: the delete already applied (offline queue replay,
    -- retry after a lost response). Reporting failure here dead-lettered
    -- completed work; a missing row is success with explicit flagging.
    return jsonb_build_object('success', true, 'id', p_id, 'already_deleted', true,
      'message', 'Product was already deleted.');
  end if;

  select exists(select 1 from public.pos_order_items where menu_item_id = p_id)
    into v_has_sale_history;

  if v_has_sale_history then
    update public.pos_menu_items
       set is_available = false, archived_at = now(), updated_at = now()
     where id = p_id and lodge_id = p_lodge_id;
    -- Archived products keep their stock listed: the product still exists
    -- (it can be restored) and its stock may still be sold via packs.
    return jsonb_build_object('success', true, 'id', p_id, 'soft_deleted', true,
      'message', 'Item has sale history and was archived instead of deleted.');
  end if;

  delete from public.pos_menu_items where id = p_id and lodge_id = p_lodge_id;

  if v_inventory_item_id is not null then
    -- Delist only when no remaining sellable or consumption reference keeps
    -- this stock in service: any menu row of any template kind (standard,
    -- bar_pack, bar_single, including archived rows), the legacy menu_items
    -- table, recipe ingredients, and prep ingredients or prep outputs.
    select exists(
             select 1 from public.pos_menu_items
              where lodge_id = p_lodge_id and inventory_item_id = v_inventory_item_id)
        or exists(
             select 1 from public.menu_items
              where lodge_id = p_lodge_id and inventory_item_id = v_inventory_item_id)
        or exists(
             select 1 from public.restaurant_recipe_ingredients
              where lodge_id = p_lodge_id and inventory_item_id = v_inventory_item_id)
        or exists(
             select 1 from public.restaurant_prep_item_ingredients pi
              join public.restaurant_prep_items p on p.id = pi.prep_item_id
              where p.lodge_id = p_lodge_id
                and (pi.inventory_item_id = v_inventory_item_id
                     or p.produced_inventory_item_id = v_inventory_item_id))
      into v_stock_still_referenced;

    if not v_stock_still_referenced then
      update public.inventory_items
         set is_active = false, updated_at = now()
       where id = v_inventory_item_id
         and lodge_id = p_lodge_id
         and coalesce(is_active, true)
        returning id into v_delisted_id;
      v_stock_delisted := v_delisted_id is not null;
      if v_stock_delisted then
        -- Movements are deliberately untouched: history is preserved for
        -- financial truth and auditing; operational reads exclude delisted
        -- items instead of erasing evidence.
        perform public.log_restaurant_financial_action(
          p_lodge_id, 'stock_delisted_with_product_delete', 'inventory_items',
          v_inventory_item_id, null,
          jsonb_build_object(
            'product_id', p_id,
            'movements_preserved', true,
            'reason', 'Product hard-deleted; no remaining sellable, recipe or prep references'),
          null);
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true, 'id', p_id, 'hard_deleted', true,
    'stock_delisted', v_stock_delisted,
    'message', case when v_stock_delisted
      then 'Product deleted and its stock item delisted. Movement history is preserved for audit.'
      else 'Product deleted.' end);
end
$delist$;

revoke all on function public.delete_pos_menu_item(uuid, uuid) from public;
grant execute on function public.delete_pos_menu_item(uuid, uuid) to anon, authenticated, service_role;

-- Opening stock exactly once: the location-seed trigger keeps seeding the
-- stock-location balance but must not write a second opening movement (the
-- AFTER INSERT log trigger already records the same event, which double
-- counted every outlet-allocated creation on every surface).
create or replace function public.restaurant_seed_inventory_item_stock_location_balance()
returns trigger
language plpgsql
security definer
set search_path to public
as $seed$
declare
  v_result jsonb;
  v_allocated_quantity numeric;
begin
  if coalesce(new.current_stock, 0) <= 0 then
    return new;
  end if;

  v_result := public.ensure_inventory_item_stock_location_balance(new.lodge_id, new.id);
  v_allocated_quantity := coalesce((v_result->>'allocated_quantity')::numeric, 0);
  -- No movement insert here: the balance is seeded above and the opening
  -- movement is recorded exactly once by log_inventory_opening_stock_movement.
  return new;
end
$seed$;

-- Auto-menu sync must never resurrect sellables for delisted stock.
create or replace function public.sync_inventory_item_to_pos(p_inventory_id uuid, p_lodge_id uuid)
returns void
language plpgsql
security definer
set search_path to public
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
end
$sync$;

-- Deduplicate the provable same-event opening duplicates already recorded.
-- These pairs could only be produced by the double/triple writers above
-- firing on one INSERT (same item, same event):
--   1. wizard-contract rows ('...when the product was created') alongside any
--      other opening row for the same item;
--   2. plain log-trigger rows ('Opening stock') alongside the richer
--      location-seed row ('...when inventory item was created') for the same
--      item (the seed row carries valuation/before-after evidence, so it is
--      the kept record).
-- Items with a single opening row of any note are untouched.
delete from public.inventory_movements m
 where m.movement_type = 'opening_stock'
   and m.notes = 'Opening stock recorded when the product was created'
   and exists (
     select 1 from public.inventory_movements o
      where o.item_id = m.item_id
        and o.movement_type = 'opening_stock'
        and o.id <> m.id
   );

delete from public.inventory_movements m
 where m.movement_type = 'opening_stock'
   and m.notes = 'Opening stock'
   and exists (
     select 1 from public.inventory_movements k
      where k.item_id = m.item_id
        and k.movement_type = 'opening_stock'
        and k.notes = 'Opening stock recorded when inventory item was created'
        and k.id <> m.id
   );
