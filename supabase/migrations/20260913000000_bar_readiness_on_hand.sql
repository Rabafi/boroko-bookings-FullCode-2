-- Bar Till automatic sold-out: readiness rows now carry the counted on-hand
-- quantity (and unit) for direct-stock items, so the Till greys out finished
-- products and refuses over-selling without recipe, costing or supplier
-- disclosure. Counts mirror the Pay-time server check
-- (inventory_items.current_stock, same lodge). Recipe, non-stock and
-- unlinked rows keep null counts and their existing Till behavior.
--
-- No privilege statements in this file (CREATE OR REPLACE keeps the existing
-- authenticated + anon EXECUTE grants, including the desktop-read convention).

begin;

create or replace function public.get_pos_menu_stock_readiness(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_rows jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager','admin','super_admin','cashier']);
  if p_lodge_id is null then raise exception 'Lodge is required' using errcode='22023'; end if;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_rows
    from (
      select mi.id as menu_item_id,
             case
               when coalesce(mi.stock_method, '') = 'non_stock' then 'non_stock'
               when mi.inventory_item_id is not null
                    and public._pos_menu_item_has_stock_recipe(mi.lodge_id, mi.id) then 'conflict'
               when mi.inventory_item_id is not null then 'direct'
               when public._pos_menu_item_has_stock_recipe(mi.lodge_id, mi.id) then 'recipe'
               else 'missing'
             end as readiness,
             case
               when mi.inventory_item_id is not null
                    and not public._pos_menu_item_has_stock_recipe(mi.lodge_id, mi.id)
               then ii.current_stock
               else null
             end as on_hand,
             case
               when mi.inventory_item_id is not null
                    and not public._pos_menu_item_has_stock_recipe(mi.lodge_id, mi.id)
               then ii.unit
               else null
             end as stock_unit
        from public.pos_menu_items mi
        left join public.inventory_items ii
          on ii.id = mi.inventory_item_id
         and ii.lodge_id = mi.lodge_id
       where mi.lodge_id = p_lodge_id
         and mi.archived_at is null
       order by mi.id
    ) row;

  return jsonb_build_object('success', true, 'rows', v_rows);
end
$$;

commit;
