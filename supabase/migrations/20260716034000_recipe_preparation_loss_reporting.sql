-- Prepared food and cocktails stay consumed after a financial void.  This
-- report makes that operational loss visible without treating it as revenue.
create or replace function public.get_recipe_preparation_losses(
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
declare
  v_result jsonb;
begin
  if p_lodge_id is null or p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    raise exception 'A valid lodge and date range are required';
  end if;

  perform public.app_require_lodge_role(p_lodge_id, array['supervisor', 'manager', 'admin', 'super_admin']);
  if p_outlet_id is not null then
    perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id);
  end if;

  with recipe_costs as (
    select
      m.order_id,
      sum(abs(coalesce(m.theoretical_cost, 0))) as preparation_loss_cost
    from public.restaurant_recipe_stock_movements m
    where m.lodge_id = p_lodge_id
      and m.order_id is not null
      and m.movement_reason = 'pos_sale'
    group by m.order_id
  ),
  voided_orders as (
    select
      o.id,
      o.business_date,
      o.receipt_number,
      o.order_number,
      o.outlet_id,
      o.cashier_id,
      a.details ->> 'reason' as reason,
      a.approver_id,
      a.created_at as cancelled_at,
      rc.preparation_loss_cost
    from public.pos_orders o
    join recipe_costs rc on rc.order_id = o.id
    join lateral (
      select pa.*
      from public.pos_audit_log pa
      where pa.lodge_id = o.lodge_id
        and pa.order_id = o.id
        and pa.action = 'pos_order_voided'
        and pa.details ->> 'recipe_stock_disposition' = 'consumed'
      order by pa.created_at desc, pa.id desc
      limit 1
    ) a on true
    where o.lodge_id = p_lodge_id
      and o.status = 'voided'
      and o.business_date between p_start_date and p_end_date
      and (p_outlet_id is null or o.outlet_id = p_outlet_id)
  ),
  rows as (
    select
      v.business_date,
      v.receipt_number,
      v.order_number,
      coalesce(outlet.name, 'Unassigned outlet') as outlet_name,
      coalesce(operator.name, 'Unknown operator') as operator_name,
      coalesce(approver.name, 'Unknown approver') as approved_by_name,
      coalesce(v.reason, 'No reason recorded') as reason,
      v.cancelled_at,
      v.preparation_loss_cost,
      coalesce((
        select string_agg(distinct oi.item_name, ', ' order by oi.item_name)
        from public.pos_order_items oi
        join public.restaurant_recipe_stock_movements rm
          on rm.order_item_id = oi.id and rm.order_id = v.id and rm.lodge_id = p_lodge_id
        where oi.order_id = v.id and oi.lodge_id = p_lodge_id
      ), 'Prepared item') as item_names
    from voided_orders v
    left join public.pos_outlets outlet on outlet.id = v.outlet_id and outlet.lodge_id = p_lodge_id
    left join public.users operator on operator.id = v.cashier_id
    left join public.users approver on approver.id = v.approver_id
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by cancelled_at desc), '[]'::jsonb)
  into v_result
  from rows;

  return v_result;
end;
$$;

revoke all on function public.get_recipe_preparation_losses(uuid, date, date, uuid) from public;
grant execute on function public.get_recipe_preparation_losses(uuid, date, date, uuid) to authenticated, service_role;
