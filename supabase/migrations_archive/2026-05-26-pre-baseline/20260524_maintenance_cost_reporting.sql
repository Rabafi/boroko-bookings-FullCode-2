begin;

create or replace function public.get_profit_loss_summary(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_revenue jsonb := '{}'::jsonb;
  v_booking_revenue numeric := 0;
  v_pos_revenue numeric := 0;
  v_conference_revenue numeric := 0;
  v_pool_revenue numeric := 0;
  v_total_revenue numeric := 0;
  v_total_expenses numeric := 0;
  v_inv_costs numeric := 0;
  v_sup_costs numeric := 0;
  v_maintenance_costs numeric := 0;
  v_total_costs numeric := 0;
  v_gross_profit numeric := 0;
  v_exp_by_category jsonb := '{}'::jsonb;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  v_revenue := public.get_revenue_report(p_lodge_id, p_start_date, p_end_date);
  v_booking_revenue := coalesce((v_revenue ->> 'total_revenue')::numeric, 0);

  select coalesce(sum(total), 0)
    into v_pos_revenue
  from public.pos_orders
  where lodge_id = p_lodge_id
    and status = 'completed'
    and coalesce(payment_method, '') <> 'folio'
    and created_at >= p_start_date::timestamptz
    and created_at < (p_end_date + 1)::timestamptz;

  select coalesce(sum(total_amount), 0)
    into v_conference_revenue
  from public.conference_bookings
  where lodge_id = p_lodge_id
    and booking_date >= p_start_date
    and booking_date <= p_end_date
    and coalesce(payment_status, '') <> 'cancelled';

  select coalesce(sum(total), 0)
    into v_pool_revenue
  from public.pool_day_use
  where lodge_id = p_lodge_id
    and date >= p_start_date
    and date <= p_end_date;

  with exp as (
    select
      coalesce(nullif(trim(category), ''), 'Uncategorised') as category,
      sum(amount) as total
    from public.expenses
    where lodge_id = p_lodge_id
      and date >= p_start_date
      and date <= p_end_date
    group by coalesce(nullif(trim(category), ''), 'Uncategorised')
  )
  select
    coalesce(sum(total), 0),
    coalesce(jsonb_object_agg(category, total), '{}'::jsonb)
    into v_total_expenses, v_exp_by_category
  from exp;

  select coalesce(sum(total_cost), 0)
    into v_inv_costs
  from public.inventory_purchases
  where lodge_id = p_lodge_id
    and date >= p_start_date
    and date <= p_end_date;

  select coalesce(sum(total_cost), 0)
    into v_sup_costs
  from public.supply_purchases
  where lodge_id = p_lodge_id
    and date >= p_start_date
    and date <= p_end_date;

  select coalesce(sum(total_cost), 0)
    into v_maintenance_costs
  from public.maintenance_tickets
  where lodge_id = p_lodge_id
    and reported_date >= p_start_date
    and reported_date <= p_end_date;

  v_total_revenue := coalesce(v_booking_revenue, 0) + coalesce(v_pos_revenue, 0) + coalesce(v_conference_revenue, 0) + coalesce(v_pool_revenue, 0);
  v_total_costs := coalesce(v_inv_costs, 0) + coalesce(v_sup_costs, 0) + coalesce(v_maintenance_costs, 0);
  v_gross_profit := v_total_revenue - coalesce(v_total_expenses, 0) - v_total_costs;

  return jsonb_build_object(
    'bookingRevenue', coalesce(v_booking_revenue, 0),
    'posRevenue', coalesce(v_pos_revenue, 0),
    'conferenceRevenue', coalesce(v_conference_revenue, 0),
    'poolRevenue', coalesce(v_pool_revenue, 0),
    'totalRevenue', coalesce(v_total_revenue, 0),
    'totalExpenses', coalesce(v_total_expenses, 0),
    'expByCategory', coalesce(v_exp_by_category, '{}'::jsonb),
    'invCosts', coalesce(v_inv_costs, 0),
    'supCosts', coalesce(v_sup_costs, 0),
    'maintenanceCosts', coalesce(v_maintenance_costs, 0),
    'totalCosts', coalesce(v_total_costs, 0),
    'grossProfit', coalesce(v_gross_profit, 0),
    'vatAmount', coalesce((v_revenue ->> 'vat_amount')::numeric, 0),
    'vatEnabled', coalesce((v_revenue ->> 'vat_enabled')::boolean, false),
    'vatRate', (v_revenue ->> 'vat_rate')::numeric,
    'vatMixed', coalesce((v_revenue ->> 'vat_mixed')::boolean, false),
    'netRevenue', coalesce((v_revenue ->> 'net_revenue')::numeric, 0)
  );
end;
$function$;

revoke all on function public.get_profit_loss_summary(uuid, date, date) from public, anon;
grant execute on function public.get_profit_loss_summary(uuid, date, date) to authenticated, service_role;

create or replace function public.get_room_profitability_summary(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_rows jsonb := '[]'::jsonb;
  v_total_days integer := greatest((p_end_date - p_start_date), 0);
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  with room_list as (
    select
      r.id,
      r.room_number,
      r.room_type,
      coalesce(r.rate_per_night, 0) as rate_per_night
    from public.rooms r
    where r.lodge_id = p_lodge_id
  ),
  booking_metrics as (
    select
      b.room_id,
      coalesce(sum(greatest(0, least(b.check_out, p_end_date) - greatest(b.check_in, p_start_date))), 0) as occupied_nights,
      coalesce(sum(coalesce(b.total_amount, 0)), 0) as revenue
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and coalesce(b.status, '') <> 'cancelled'
      and b.check_in <= p_end_date
      and b.check_out > p_start_date
    group by b.room_id
  ),
  supply_metrics as (
    select
      rsm.room_id,
      coalesce(sum(coalesce(rsm.total_cost, 0)), 0) as supply_cost,
      coalesce(sum(coalesce(rsm.quantity, 0)), 0) as supply_units_used
    from public.room_supply_movements rsm
    where rsm.lodge_id = p_lodge_id
      and rsm.movement_type = 'use'
      and rsm.created_at >= p_start_date::timestamptz
      and rsm.created_at < (p_end_date + 1)::timestamptz
    group by rsm.room_id
  ),
  maintenance_metrics as (
    select
      mt.room_id,
      count(*) as maintenance_count,
      count(*) filter (where coalesce(mt.status, '') <> 'resolved') as open_maintenance_count,
      coalesce(sum(coalesce(mt.total_cost, 0)), 0) as maintenance_cost
    from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id
      and mt.reported_date >= p_start_date
      and mt.reported_date <= p_end_date
    group by mt.room_id
  ),
  rows as (
    select
      rl.id,
      rl.room_number,
      rl.room_type,
      rl.rate_per_night,
      coalesce(bm.occupied_nights, 0) as occupied_nights,
      case when v_total_days > 0 then round((coalesce(bm.occupied_nights, 0)::numeric / v_total_days::numeric) * 100) else 0 end as occupancy_rate,
      coalesce(bm.revenue, 0) as revenue,
      coalesce(sm.supply_cost, 0) as supply_cost,
      coalesce(sm.supply_units_used, 0) as supply_units_used,
      coalesce(mm.maintenance_cost, 0) as maintenance_cost,
      coalesce(mm.maintenance_count, 0) as maintenance_count,
      coalesce(mm.open_maintenance_count, 0) as open_maintenance_count
    from room_list rl
    left join booking_metrics bm
      on bm.room_id = rl.id
    left join supply_metrics sm
      on sm.room_id = rl.id
    left join maintenance_metrics mm
      on mm.room_id = rl.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'room_number', room_number,
    'room_type', room_type,
    'rate_per_night', rate_per_night,
    'occupied_nights', occupied_nights,
    'occupancy_rate', occupancy_rate,
    'revenue', revenue,
    'supply_cost', supply_cost,
    'supply_units_used', supply_units_used,
    'maintenance_cost', maintenance_cost,
    'running_cost', supply_cost + maintenance_cost,
    'maintenance_count', maintenance_count,
    'open_maintenance_count', open_maintenance_count,
    'contribution', revenue - supply_cost - maintenance_cost,
    'margin_pct', case when revenue > 0 then round(((revenue - supply_cost - maintenance_cost) / revenue) * 100) else 0 end
  ) order by (revenue - supply_cost - maintenance_cost) desc, room_number asc), '[]'::jsonb)
    into v_rows
  from rows;

  return coalesce(v_rows, '[]'::jsonb);
end;
$function$;

revoke all on function public.get_room_profitability_summary(uuid, date, date) from public, anon;
grant execute on function public.get_room_profitability_summary(uuid, date, date) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
