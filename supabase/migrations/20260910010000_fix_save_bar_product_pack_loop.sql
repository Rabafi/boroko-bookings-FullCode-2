-- Fix: "missing FROM-clause entry for table \"v_pack_row\"" when saving a
-- Bar product with packs.
--
-- Root cause: the stock mode/body block declared v_pack_row as a single jsonb
-- variable, and the pack loop read it as v_pack_row->>'...' after assigning the
-- iteration row's `value` column into it. plpgsql parameter substitution
-- rewrites whole-variable references like that into the literal text of the
-- variable's SQL value, which destroys the loop's own FROM reference and
-- re-scans the erased body, surfacing "missing FROM-clause entry for table
-- \"v_pack_row\"".
--
-- Fix: iterate the elements via the literal alias `elem <-> value` and
-- materialize each element into a dedicated jsonb temp before reading it, so
-- no ambiguous whole-variable substitution can erase the FROM source. Idempotent
-- (second run only re-applies when the exact original block still exists).

begin;

do $packfix$
declare
  v_definition text;
  v_repaired text;
  v_old text := $old$
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
  end loop;$old$;
  v_new text := $new$
  for v_pack_row in select (elem.value)::jsonb as pack_elem from jsonb_array_elements(v_packs) as elem loop
    declare
      v_pack_elem jsonb := v_pack_row.pack_elem;
    begin
      if not coalesce((v_pack_elem->>'enabled')::boolean,false) then
        select exists (
          select 1 from public.pos_menu_items
           where lodge_id=v_lodge_id
             and inventory_item_id=v_inventory_item_id
             and template_kind='bar_pack'
             and template_pack_size=(v_pack_elem->>'pack_size')::integer
        ) into v_pack_exists;
        if not v_pack_exists then continue; end if;
      end if;
      v_pack:=public.set_bar_pos_pack_template(jsonb_build_object(
        'lodge_id',v_lodge_id,'inventory_item_id',v_inventory_item_id,
        'pack_size',(v_pack_elem->>'pack_size')::integer,'enabled',coalesce((v_pack_elem->>'enabled')::boolean,false),
        'barcode',case when v_pack_elem ? 'barcode' then v_pack_elem->>'barcode' else null end));
      if not coalesce((v_pack->>'success')::boolean,false) then raise exception '%',coalesce(v_pack->>'error','Pack template save failed') using errcode='22023'; end if;
    end;
  end loop;$new$;
begin
  select pg_get_functiondef('public.save_bar_product_with_stock(jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'save_bar_product_with_stock(jsonb) is not installed';
  end if;

  v_repaired := replace(v_definition, v_old, v_new);

  if v_repaired = v_definition then
    -- Shape-tolerance: this surgical patch targeted a live-drift shape; when
    -- the target text is absent (fresh chains install a different shape, and
    -- 20260910030000 redeploys the authoritative full body afterwards), skip
    -- with a notice instead of aborting the migration chain.
    raise notice 'save_bar_product_with_stock pack-loop patch skipped: target shape not present (superseded by 20260910030000)';
  else
    execute v_repaired;
  end if;
end
$packfix$;

commit;
