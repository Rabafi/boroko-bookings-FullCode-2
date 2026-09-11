-- Fix: the deployed pack loop reads the whole iteration record
-- (v_pack_row->>'enabled'), which plpgsql rewrites into the record's raw JSON
-- text, collapsing the FOR loop's own FROM reference and producing
-- "missing FROM-clause entry for table \"v_pack_row\"".
-- Replace the loop to iterate by integer index using direct jsonb subscripting
-- (v_packs->idx), so the FROM source can never be erased. Also declare the
-- v_pack_index/v_pack_elem locals the new loop needs. Idempotent on the exact
-- deployed shape.
begin;

do $idxfix$
declare
  v_definition text;
  v_repaired text;
  v_decl_old text := 'v_pack_enabled boolean:=false;';
  v_decl_new text := 'v_pack_enabled boolean:=false;' || chr(10)
                   || 'v_pack_index integer;' || chr(10)
                   || 'v_pack_elem jsonb;';
  v_old text := $old$
  for v_pack_row in select value from jsonb_array_elements(v_packs) loop
    if not coalesce((v_pack_row->>'enabled')::boolean,false) then
      select exists (
        select 1 from public.pos_menu_items
         where lodge_id=v_lodge_id
           and inventory_item_id=v_inventory_item_id
           and template_kind='bar_pack'
           and template_pack_size=(v_pack_row->>'pack_size')::integer
      ) into v_pack_exists;
      if not v_pack_exists then continue; end if;
    end if;
    v_pack:=public.set_bar_pos_pack_template(jsonb_build_object(
      'lodge_id',v_lodge_id,'inventory_item_id',v_inventory_item_id,
      'pack_size',(v_pack_row->>'pack_size')::integer,'enabled',coalesce((v_pack_row->>'enabled')::boolean,false),
      'barcode',case when v_pack_row ? 'barcode' then v_pack_row->>'barcode' else null end));
    if not coalesce((v_pack->>'success')::boolean,false) then raise exception '%',coalesce(v_pack->>'error','Pack template save failed') using errcode='22023'; end if;
  end loop;$old$;
  v_new text := $new$
  for v_pack_index in 0 .. coalesce(jsonb_array_length(case when jsonb_typeof(v_packs) = 'array' then v_packs else '[]'::jsonb end), 0) - 1 loop
    v_pack_elem := v_packs -> v_pack_index;
    if not coalesce((v_pack_elem ->> 'enabled')::boolean,false) then
      select exists (
        select 1 from public.pos_menu_items
         where lodge_id = v_lodge_id
           and inventory_item_id = v_inventory_item_id
           and template_kind = 'bar_pack'
           and template_pack_size = (v_pack_elem ->> 'pack_size')::integer
      ) into v_pack_exists;
      if not v_pack_exists then continue; end if;
    end if;
    v_pack := public.set_bar_pos_pack_template(jsonb_build_object(
      'lodge_id',v_lodge_id,'inventory_item_id',v_inventory_item_id,
      'pack_size',(v_pack_elem ->> 'pack_size')::integer,'enabled',coalesce((v_pack_elem ->> 'enabled')::boolean,false),
      'barcode',case when v_pack_elem ? 'barcode' then v_pack_elem ->> 'barcode' else null end));
    if not coalesce((v_pack ->> 'success')::boolean,false) then raise exception '%',coalesce(v_pack ->> 'error','Pack template save failed') using errcode='22023'; end if;
  end loop;$new$;
begin
  select pg_get_functiondef('public.save_bar_product_with_stock(jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'save_bar_product_with_stock(jsonb) is not installed';
  end if;

  -- Shape-tolerance: this surgical patch targeted live-drift shapes; when the
  -- anchors are absent (fresh chains install other shapes, and
  -- 20260910030000 redeploys the authoritative full body afterwards), skip
  -- with a notice instead of aborting the migration chain. All-or-nothing:
  -- the declaration edit is applied only together with both loop patches.
  if position(v_decl_old in v_definition) = 0
     or position(v_old in v_definition) = 0 then
    raise notice 'save_bar_product_with_stock index-loop patch skipped: target shapes not present (superseded by 20260910030000)';
  else
    v_repaired := replace(v_definition, v_decl_old, v_decl_new);
    v_repaired := replace(v_repaired, v_old, v_new);
    if v_repaired = v_definition then
      raise notice 'save_bar_product_with_stock index-loop patch skipped: no change (superseded by 20260910030000)';
    else
      execute v_repaired;
    end if;
  end if;
end
$idxfix$;

commit;
