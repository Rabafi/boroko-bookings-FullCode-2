-- Ingredient-level preparation loss lets operators see physical quantity lost
-- and its share of all recipe consumption for the same business-date period.
create or replace function public.get_recipe_preparation_loss_ingredient_summary(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_result jsonb;
begin
  if p_lodge_id is null or p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'A valid lodge and date range are required';
  end if;
  perform public.app_require_lodge_role(p_lodge_id, array['supervisor', 'manager', 'admin', 'super_admin']);
  if p_outlet_id is not null then perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id); end if;

  with voided_recipe_orders as (
    select o.id
    from public.pos_orders o
    where o.lodge_id = p_lodge_id
      and o.status = 'voided'
      and o.business_date between p_start_date and p_end_date
      and (p_outlet_id is null or o.outlet_id = p_outlet_id)
      and exists (
        select 1 from public.pos_audit_log pa
        where pa.lodge_id = o.lodge_id and pa.order_id = o.id
          and pa.action = 'pos_order_voided'
          and pa.details ->> 'recipe_stock_disposition' = 'consumed'
      )
  ), usage as (
    select m.inventory_item_id, m.unit,
      sum(abs(m.quantity)) as total_recipe_quantity,
      sum(abs(m.quantity)) filter (where v.id is not null) as preparation_loss_quantity,
      sum(abs(coalesce(m.theoretical_cost, 0))) filter (where v.id is not null) as preparation_loss_cost
    from public.restaurant_recipe_stock_movements m
    join public.pos_orders o on o.id = m.order_id and o.lodge_id = m.lodge_id
    left join voided_recipe_orders v on v.id = o.id
    where m.lodge_id = p_lodge_id
      and m.movement_reason = 'pos_sale'
      and o.business_date between p_start_date and p_end_date
      and (p_outlet_id is null or o.outlet_id = p_outlet_id)
    group by m.inventory_item_id, m.unit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'inventory_item_name', ii.name,
    'unit', u.unit,
    'preparation_loss_quantity', coalesce(u.preparation_loss_quantity, 0),
    'total_recipe_quantity', u.total_recipe_quantity,
    'loss_percentage', case when u.total_recipe_quantity > 0 then round((coalesce(u.preparation_loss_quantity, 0) / u.total_recipe_quantity) * 100, 2) else 0 end,
    'preparation_loss_cost', coalesce(u.preparation_loss_cost, 0)
  ) order by coalesce(u.preparation_loss_quantity, 0) desc, ii.name), '[]'::jsonb)
  into v_result
  from usage u
  join public.inventory_items ii on ii.id = u.inventory_item_id and ii.lodge_id = p_lodge_id
  where coalesce(u.preparation_loss_quantity, 0) > 0;
  return v_result;
end;
$$;

revoke all on function public.get_recipe_preparation_loss_ingredient_summary(uuid, date, date, uuid) from public;
grant execute on function public.get_recipe_preparation_loss_ingredient_summary(uuid, date, date, uuid) to authenticated, service_role;
