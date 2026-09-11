-- Server-authoritative menu-item stock readiness for Bar Till users.
-- The Till previously inferred readiness from recipe membership, which base
-- users cannot even read (recipes sit behind the Stock & Purchasing Pro
-- add-on). This read exposes only the readiness outcome per sellable item --
-- never recipe ingredients or costing -- so base Till users get a trustworthy
-- badge without recipe edit rights.
--
-- Readiness values: direct | recipe | non_stock | conflict | missing.
-- An unavailable read must surface as Refresh-required in the UI; it must
-- never be rendered as ready or sold out.

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
             end as readiness
        from public.pos_menu_items mi
       where mi.lodge_id = p_lodge_id
         and mi.archived_at is null
       order by mi.id
    ) row;

  return jsonb_build_object('success', true, 'rows', v_rows);
end
$$;

revoke all on function public.get_pos_menu_stock_readiness(uuid) from public,anon,authenticated;
grant execute on function public.get_pos_menu_stock_readiness(uuid) to authenticated,service_role;

commit;
