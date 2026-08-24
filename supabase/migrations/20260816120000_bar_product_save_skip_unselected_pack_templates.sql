-- A normal single-bottle product must not invoke the Bar pack-template helper
-- merely to disable pack sizes which do not exist. That helper correctly
-- rejects a non-Bar stock location, but the rejection used to roll back an
-- otherwise valid single-item product save.

begin;

create or replace function public.save_bar_pos_product_with_packs(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid;
  v_menu_item_id uuid:=nullif(payload->>'menu_item_id','')::uuid;
  v_operation_key text:=nullif(btrim(payload->>'operation_key'),'');
  v_payload_hash text:=encode(digest(payload::text,'sha256'),'hex');
  v_existing public.restaurant_catalog_operations%rowtype;
  v_menu jsonb;
  v_pack jsonb;
  v_pack_row jsonb;
  v_result jsonb;
  v_actor uuid;
begin
  v_actor:=public.app_get_actor_user_id();
  perform public.app_require_lodge_role(v_lodge_id,array['manager','admin','super_admin']);
  if v_lodge_id is null or v_operation_key is null then raise exception 'Lodge and stable catalog operation key are required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bar-catalog:'||v_lodge_id::text||':'||v_operation_key,0));
  select * into v_existing from public.restaurant_catalog_operations where lodge_id=v_lodge_id and operation_key=v_operation_key for update;
  if found then
    if v_existing.payload_hash<>v_payload_hash then raise exception 'Catalog operation key was already used with a different product or pack payload' using errcode='23505'; end if;
    return v_existing.result||jsonb_build_object('replayed',true);
  end if;

  if v_menu_item_id is null then
    v_menu:=public.create_pos_menu_item(payload-'operation_key'-'menu_item_id'-'packs');
  else
    v_menu:=public.update_pos_menu_item(v_menu_item_id,v_lodge_id,payload-'operation_key'-'menu_item_id'-'packs');
  end if;
  if not coalesce((v_menu->>'success')::boolean,false) then raise exception '%',coalesce(v_menu->>'error','Product save failed') using errcode='22023'; end if;
  v_menu_item_id:=coalesce(v_menu_item_id,nullif(v_menu->>'id','')::uuid);
  if v_menu_item_id is null then raise exception 'Product save did not return a menu item identity' using errcode='XX000'; end if;

  for v_pack_row in select value from jsonb_array_elements(case when jsonb_typeof(payload->'packs')='array' then payload->'packs' else '[]'::jsonb end) loop
    -- Save a pack only when the operator enabled it, or when an existing pack
    -- must be explicitly disabled. This preserves removal behaviour without
    -- requiring an ordinary single-item stock record to be a Bar pack product.
    if coalesce((v_pack_row->>'enabled')::boolean,false)
       or exists (
         select 1
         from public.pos_menu_items existing_pack
         where existing_pack.lodge_id=v_lodge_id
           and existing_pack.inventory_item_id=nullif(payload->>'inventory_item_id','')::uuid
           and existing_pack.template_kind='bar_pack'
           and existing_pack.template_pack_size=(v_pack_row->>'pack_size')::integer
       ) then
      v_pack:=public.set_bar_pos_pack_template(jsonb_build_object(
        'lodge_id',v_lodge_id,'inventory_item_id',payload->>'inventory_item_id',
        'pack_size',(v_pack_row->>'pack_size')::integer,'enabled',coalesce((v_pack_row->>'enabled')::boolean,false),
        'barcode',case when v_pack_row ? 'barcode' then v_pack_row->>'barcode' else null end));
      if not coalesce((v_pack->>'success')::boolean,false) then raise exception '%',coalesce(v_pack->>'error','Pack template save failed') using errcode='22023'; end if;
    end if;
  end loop;

  v_result:=jsonb_build_object('success',true,'id',v_menu_item_id,'menu_item_id',v_menu_item_id,'operation_key',v_operation_key,'replayed',false);
  insert into public.restaurant_catalog_operations(lodge_id,operation_key,payload_hash,result,created_by) values(v_lodge_id,v_operation_key,v_payload_hash,v_result,v_actor);
  perform public.log_restaurant_financial_action(v_lodge_id,'bar_product_pack_saved','pos_menu_items',v_menu_item_id,null,v_result,null);
  return v_result;
end
$$;

revoke all on function public.save_bar_pos_product_with_packs(jsonb) from public, anon, authenticated;
grant execute on function public.save_bar_pos_product_with_packs(jsonb) to anon, authenticated, service_role;

commit;
