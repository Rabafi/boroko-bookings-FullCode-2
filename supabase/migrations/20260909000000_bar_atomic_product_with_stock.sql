-- Atomic Bar product + stock + pack save (unified wizard contract).
-- One operation key covers stock creation-or-link, the single opening stock
-- movement, the sellable product and its physical pack templates. Staged
-- two-RPC flows with a shared key are NOT atomic and must not be built on
-- top of this contract: callers persist the normalized request (payload +
-- stable entity ids + operation key) before dispatch and replay it unchanged.
--
-- Wizard-created stock intentionally skips sync_inventory_item_to_pos: the
-- wizard product itself is the sellable, so no auto menu row is minted.
-- Standalone stock creation keeps its existing auto-menu behavior.
-- Opening stock is applied exactly once per operation key (replays return
-- the stored result, including generated ids).

begin;

alter table public.restaurant_catalog_operations
  add column if not exists request_payload jsonb,
  add column if not exists entity_ids jsonb;

create sequence if not exists public.catalog_publication_version_seq;

create table if not exists public.catalog_publication_jobs (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  operation_key text not null,
  outlet_id uuid references public.outlets(id) on delete cascade,
  version bigint not null,
  state text not null default 'pending' check (state in ('pending', 'claimed', 'published', 'failed', 'superseded')),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lodge_id, operation_key, outlet_id)
);
create index if not exists idx_catalog_publication_jobs_claim
  on public.catalog_publication_jobs (lodge_id, outlet_id, state, version);

create table if not exists public.catalog_publication_state (
  outlet_id uuid primary key references public.outlets(id) on delete cascade,
  applied_version bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.catalog_publication_jobs enable row level security;
alter table public.catalog_publication_state enable row level security;
revoke all on table public.catalog_publication_jobs from public,anon,authenticated;
revoke all on table public.catalog_publication_state from public,anon,authenticated;
grant select on table public.catalog_publication_jobs to service_role;
grant select on table public.catalog_publication_state to service_role;

create or replace function public.save_bar_product_with_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid;
  v_operation_key text:=nullif(btrim(payload->>'operation_key'),'');
  v_payload_hash text:=encode(digest(payload::text,'sha256'),'hex');
  v_existing public.restaurant_catalog_operations%rowtype;
  v_menu_item_id uuid:=nullif(payload->>'menu_item_id','')::uuid;
  v_inventory_item_id uuid:=nullif(payload->>'inventory_item_id','')::uuid;
  v_expected_menu_version timestamptz:=nullif(payload->>'expected_menu_version','')::timestamptz;
  v_expected_stock_version timestamptz:=nullif(payload->>'expected_stock_version','')::timestamptz;
  v_product jsonb:=coalesce(payload->'product','{}'::jsonb);
  v_stock jsonb:=coalesce(payload->'stock','{}'::jsonb);
  v_packs jsonb:=case when jsonb_typeof(payload->'packs')='array' then payload->'packs' else '[]'::jsonb end;
  v_stock_mode text:=coalesce(nullif(btrim(v_stock->>'mode'),''),'create');
  v_stock_row public.inventory_items%rowtype;
  v_outlet_id uuid;
  v_outlet_type text;
  v_outlet_active boolean;
  v_opening numeric:=coalesce(nullif(v_stock->>'opening_stock','')::numeric,0);
  v_selling numeric:=coalesce(nullif(v_stock->>'selling_price','')::numeric,0);
  v_pack_enabled boolean:=false;
  v_pack_row jsonb;
  v_pack_exists boolean;
  v_menu jsonb;
  v_pack jsonb;
  v_result jsonb;
  v_entity_ids jsonb;
  v_actor uuid;
  v_txn_start timestamptz:=clock_timestamp();
  v_job_outlets uuid[]:='{}';
  v_row record;
begin
  v_actor:=public.app_get_actor_user_id();
  perform public.app_require_lodge_role(v_lodge_id,array['manager','admin','super_admin']);
  if v_lodge_id is null or v_operation_key is null then raise exception 'Lodge and stable catalog operation key are required' using errcode='22023'; end if;
  if v_inventory_item_id is null then raise exception 'A stable inventory item identity is required' using errcode='22023'; end if;
  if v_stock_mode not in ('create','link') then raise exception 'Stock mode must be create or link' using errcode='22023'; end if;
  -- Concurrent-edit guards are mandatory for edits (never optional): both
  -- versions are validated below under row locks, so two editors with
  -- different operation keys cannot pass the same stale check.
  if v_menu_item_id is not null and v_expected_menu_version is null then raise exception 'Editing a product requires its loaded version. Reload and retry.' using errcode='22023'; end if;
  if v_stock_mode = 'link' and v_expected_stock_version is null then raise exception 'Linking stock requires its loaded version. Reload and retry.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bar-catalog:'||v_lodge_id::text||':'||v_operation_key,0));
  select * into v_existing from public.restaurant_catalog_operations where lodge_id=v_lodge_id and operation_key=v_operation_key for update;
  if found then
    if v_existing.payload_hash<>v_payload_hash then raise exception 'Catalog operation key was already used with a different product or stock payload' using errcode='23505'; end if;
    return v_existing.result||jsonb_build_object('replayed',true);
  end if;

  -- ---- Validate everything before the first mutation. ----
  if nullif(btrim(v_product->>'name'),'') is null then raise exception 'Product name is required' using errcode='22023'; end if;
  if coalesce((v_product->>'price')::numeric,0) <= 0 then raise exception 'Product price must be greater than zero' using errcode='22023'; end if;
  if coalesce((v_product->>'depletion_qty')::numeric,1) <= 0 then raise exception 'Stock consumed per sale must be greater than zero' using errcode='22023'; end if;
  for v_pack_row in select value from jsonb_array_elements(v_packs) loop
    if coalesce((v_pack_row->>'enabled')::boolean,false) then
      if (v_pack_row->>'pack_size')::integer not in (6,12,24) then raise exception 'Pack size must be 6, 12 or 24' using errcode='22023'; end if;
      v_pack_enabled:=true;
    end if;
  end loop;

  if v_stock_mode = 'create' then
    if nullif(btrim(v_stock->>'name'),'') is null then raise exception 'Stock item name is required' using errcode='22023'; end if;
    if v_opening < 0 then raise exception 'Opening stock cannot be negative' using errcode='22023'; end if;
    v_outlet_id:=nullif(v_stock->>'outlet_id','')::uuid;
    if v_outlet_id is not null then
      select type, (is_active is not false) into v_outlet_type, v_outlet_active
        from public.outlets where id=v_outlet_id and lodge_id=v_lodge_id;
      if not found then raise exception 'Selected stock outlet was not found in this lodge' using errcode='22023'; end if;
      perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
    end if;
    if v_selling <= 0 and coalesce(v_outlet_type,'') in ('food','beverage') then
      raise exception 'Set a POS selling price greater than zero for Bar or Kitchen stock items' using errcode='22023';
    end if;
    if v_pack_enabled and (v_outlet_id is null or v_outlet_type <> 'beverage' or v_outlet_active is not true) then
      raise exception 'Packs require the stock item to sit in an active Bar outlet. Assign one first.' using errcode='22023';
    end if;
    if nullif(btrim(v_stock->>'barcode'),'') is not null then
      select id, name into v_row from public.inventory_items
       where lodge_id=v_lodge_id and barcode=nullif(btrim(v_stock->>'barcode'),'');
      if found then raise exception 'Barcode is already used by stock item "%". Use the existing product instead.',v_row.name using errcode='23505'; end if;
    end if;
  else
    select * into v_stock_row from public.inventory_items where id=v_inventory_item_id and lodge_id=v_lodge_id for update;
    if not found then raise exception 'Linked stock item was not found in this lodge' using errcode='22023'; end if;
    if v_stock_row.updated_at is distinct from v_expected_stock_version then
      raise exception 'Stock item changed underneath this edit. Reload and retry.' using errcode='23505';
    end if;
    v_outlet_id:=v_stock_row.outlet_id;
    select type, (is_active is not false) into v_outlet_type, v_outlet_active
      from public.outlets where id=v_outlet_id and lodge_id=v_lodge_id;
    if v_outlet_id is not null then
      perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
    end if;
    if v_pack_enabled and (v_outlet_id is null or v_outlet_type <> 'beverage' or v_outlet_active is not true) then
      raise exception 'Packs require the stock item to sit in an active Bar outlet. Assign one first.' using errcode='22023';
    end if;
  end if;

  if nullif(btrim(v_product->>'barcode'),'') is not null then
    select id into v_row from public.pos_menu_items
     where lodge_id=v_lodge_id
       and barcode=nullif(btrim(v_product->>'barcode'),'')
       and (v_menu_item_id is null or id<>v_menu_item_id);
    if found then raise exception 'Barcode is already used by another sellable product. Use the existing product instead.' using errcode='23505'; end if;
  end if;

  if v_menu_item_id is not null then
    -- Locked read: the version check and the later update hold the same row
    -- lock, so concurrent editors serialize here instead of racing.
    select updated_at into v_row from public.pos_menu_items where id=v_menu_item_id and lodge_id=v_lodge_id for update;
    if not found then raise exception 'Sellable product was not found in this lodge' using errcode='22023'; end if;
    if v_row.updated_at is distinct from v_expected_menu_version then
      raise exception 'Product changed underneath this edit. Reload and retry.' using errcode='23505';
    end if;
  end if;

  -- ---- Mutate: stock, then product, then packs (one transaction). ----
  if v_stock_mode = 'create' then
    insert into public.inventory_items (
      id, lodge_id, name, category, unit, current_stock, reorder_level,
      latest_unit_cost, selling_price, outlet_id, barcode
    ) values (
      v_inventory_item_id, v_lodge_id,
      btrim(v_stock->>'name'),
      coalesce(nullif(btrim(v_stock->>'category'),''),'Bar'),
      coalesce(nullif(btrim(v_stock->>'unit'),''),'unit'),
      v_opening,
      coalesce(nullif(v_stock->>'reorder_level','')::numeric,0),
      coalesce(nullif(v_stock->>'unit_cost','')::numeric,0),
      v_selling,
      v_outlet_id,
      nullif(btrim(v_stock->>'barcode'),'')
    );
    -- No sync_inventory_item_to_pos here: the wizard product below is the
    -- sellable, so no auto menu row is minted (standalone stock creation
    -- keeps its existing auto-menu behavior).
    -- Opening-stock audit: exactly once per operation key (replays return
    -- before this point), recording the audited ledger movement.
    if v_opening > 0 then
      insert into public.inventory_movements (
        lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
        notes, reference_type, reference_id, source, created_by
      ) values (
        v_lodge_id, v_inventory_item_id, 'opening_stock', v_opening,
        coalesce(nullif(v_stock->>'unit_cost','')::numeric,0),
        v_opening * coalesce(nullif(v_stock->>'unit_cost','')::numeric,0),
        'Opening stock recorded when the product was created',
        'inventory_item', v_inventory_item_id, 'inventory', v_actor
      );
    end if;
  end if;

  if v_menu_item_id is null then
    v_menu:=public.create_pos_menu_item(jsonb_build_object(
      'lodge_id',v_lodge_id,
      'name',btrim(v_product->>'name'),
      'category',coalesce(nullif(btrim(v_product->>'category'),''),'Drinks'),
      'price',(v_product->>'price')::numeric,
      'barcode',nullif(btrim(v_product->>'barcode'),''),
      'inventory_item_id',v_inventory_item_id,
      'depletion_qty',coalesce((v_product->>'depletion_qty')::numeric,1),
      'is_available',coalesce((v_product->>'is_available')::boolean,true)));
  else
    v_menu:=public.update_pos_menu_item(v_menu_item_id,v_lodge_id,jsonb_build_object(
      'name',btrim(v_product->>'name'),
      'category',coalesce(nullif(btrim(v_product->>'category'),''),'Drinks'),
      'price',(v_product->>'price')::numeric,
      'barcode',nullif(btrim(v_product->>'barcode'),''),
      'inventory_item_id',v_inventory_item_id,
      'depletion_qty',coalesce((v_product->>'depletion_qty')::numeric,1),
      'is_available',coalesce((v_product->>'is_available')::boolean,true)));
  end if;
  if not coalesce((v_menu->>'success')::boolean,false) then raise exception '%',coalesce(v_menu->>'error','Product save failed') using errcode='22023'; end if;
  v_menu_item_id:=coalesce(v_menu_item_id,nullif(v_menu->>'id','')::uuid);
  if v_menu_item_id is null then raise exception 'Product save did not return a menu item identity' using errcode='XX000'; end if;

  -- Disabled sizes with no existing row are skipped entirely: calling the
  -- pack helper for them would reintroduce spurious beverage-outlet
  -- failures on ordinary products with no packs.
  for v_pack_row in select value from jsonb_array_elements(v_packs) loop
    if not coalesce((v_pack_row.value->>'enabled')::boolean,false) then
      select exists (
        select 1 from public.pos_menu_items
         where lodge_id=v_lodge_id
           and inventory_item_id=v_inventory_item_id
           and template_kind='bar_pack'
           and template_pack_size=(v_pack_row.value->>'pack_size')::integer
      ) into v_pack_exists;
      if not v_pack_exists then continue; end if;
    end if;
    v_pack:=public.set_bar_pos_pack_template(jsonb_build_object(
      'lodge_id',v_lodge_id,'inventory_item_id',v_inventory_item_id,
      'pack_size',(v_pack_row.value->>'pack_size')::integer,'enabled',coalesce((v_pack_row.value->>'enabled')::boolean,false),
      'barcode',case when v_pack_row.value ? 'barcode' then v_pack_row.value->>'barcode' else null end));
    if not coalesce((v_pack->>'success')::boolean,false) then raise exception '%',coalesce(v_pack->>'error','Pack template save failed') using errcode='22023'; end if;
  end loop;

  -- Neutralize nested auto-menu singles minted mid-transaction: the pack
  -- helper syncs an auto single row when no bar_single exists, but this
  -- wizard product (template_kind standard) is the intended sellable.
  -- Only rows created inside this transaction are removed, so pre-existing
  -- venue sellables (and their history) are never touched.
  delete from public.pos_menu_items
   where lodge_id=v_lodge_id
     and inventory_item_id=v_inventory_item_id
     and id<>v_menu_item_id
     and coalesce(auto_from_inventory,false)=true
     and coalesce(template_kind,'')<>'bar_pack'
     and created_at >= v_txn_start;

  -- Publication jobs for the affected outlet scope (resolved now so the
  -- worker never has to guess which catalogs changed).
  if v_outlet_id is null then
    for v_row in select id from public.outlets where lodge_id=v_lodge_id and is_active is not false loop
      insert into public.catalog_publication_jobs(lodge_id,operation_key,outlet_id,version)
      values(v_lodge_id,v_operation_key,v_row.id,nextval('public.catalog_publication_version_seq'))
      on conflict(lodge_id,operation_key,outlet_id) do nothing;
      v_job_outlets:=v_job_outlets || v_row.id;
    end loop;
  else
    insert into public.catalog_publication_jobs(lodge_id,operation_key,outlet_id,version)
    values(v_lodge_id,v_operation_key,v_outlet_id,nextval('public.catalog_publication_version_seq'))
    on conflict(lodge_id,operation_key,outlet_id) do nothing;
    v_job_outlets:=v_job_outlets || v_outlet_id;
  end if;

  v_entity_ids:=jsonb_build_object('menu_item_id',v_menu_item_id,'inventory_item_id',v_inventory_item_id);
  v_result:=jsonb_build_object('success',true,'menu_item_id',v_menu_item_id,'inventory_item_id',v_inventory_item_id,'operation_key',v_operation_key,'outlet_ids',coalesce(to_jsonb(v_job_outlets),'[]'::jsonb),'replayed',false);
  insert into public.restaurant_catalog_operations(lodge_id,operation_key,payload_hash,request_payload,entity_ids,result,created_by)
  values(v_lodge_id,v_operation_key,v_payload_hash,payload,v_entity_ids,v_result,v_actor);
  perform public.log_restaurant_financial_action(v_lodge_id,'bar_product_stock_saved','pos_menu_items',v_menu_item_id,null,v_result,null);
  return v_result;
end
$$;

revoke all on function public.save_bar_product_with_stock(jsonb) from public,anon,authenticated;
grant execute on function public.save_bar_product_with_stock(jsonb) to authenticated,service_role;

commit;
