begin;

create or replace function public.get_manager_dashboard_snapshot(
  p_lodge_id uuid,
  p_today date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_today date := coalesce(p_today, current_date);
  v_month_start date := date_trunc('month', coalesce(p_today, current_date)::timestamp)::date;
  v_month_end_exclusive date := (date_trunc('month', coalesce(p_today, current_date)::timestamp) + interval '1 month')::date;
  v_next_week date := coalesce(p_today, current_date) + 7;
  v_previous_start date := coalesce(p_today, current_date) - 6;
  v_room_count_total integer := 0;
  v_occupied integer := 0;
  v_open_maintenance integer := 0;
  v_urgent_maintenance integer := 0;
  v_low_stock_count integer := 0;
  v_unpaid_count integer := 0;
  v_outstanding_total numeric := 0;
  v_month_expenses numeric := 0;
  v_month_gross_collected numeric := 0;
  v_month_refunds numeric := 0;
  v_month_revenue numeric := 0;
  v_quotations_open_count integer := 0;
  v_day_use_revenue numeric := 0;
  v_low_stock jsonb := '[]'::jsonb;
  v_upcoming_arrivals jsonb := '[]'::jsonb;
  v_conference_upcoming jsonb := '[]'::jsonb;
  v_revenue_trend jsonb := '[]'::jsonb;
  v_occupancy_trend jsonb := '[]'::jsonb;
  v_top_balances jsonb := '[]'::jsonb;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  -- 1. Total Rooms
  select count(*) into v_room_count_total
  from public.rooms
  where lodge_id = p_lodge_id;

  -- 2. Occupied
  select count(*) into v_occupied
  from public.bookings
  where lodge_id = p_lodge_id
    and status = 'checked_in';

  -- 3. Maintenance
  select
    count(*) filter (where status = 'open'),
    count(*) filter (where status = 'open' and priority = 'urgent')
    into v_open_maintenance, v_urgent_maintenance
  from public.maintenance_tickets
  where lodge_id = p_lodge_id;

  -- 4. Low Stock
  select count(*)
    into v_low_stock_count
  from public.inventory_items
  where lodge_id = p_lodge_id
    and reorder_level is not null
    and current_stock <= reorder_level;

  -- 5. Unpaid Bookings
  select
    count(*) filter (where coalesce(payment_status, 'unpaid') in ('unpaid', 'partial')),
    coalesce(sum(greatest(coalesce(total_amount, 0) - coalesce(amount_paid, 0), 0)), 0)
    into v_unpaid_count, v_outstanding_total
  from public.bookings
  where lodge_id = p_lodge_id
    and status in ('confirmed', 'checked_in');

  -- 6. Expenses
  select coalesce(sum(amount), 0)
    into v_month_expenses
  from public.expenses
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  -- 7. Payments & Refunds
  select
    coalesce(sum(case when type = 'refund' then amount else 0 end), 0),
    coalesce(sum(case when type <> 'refund' then amount else 0 end), 0)
    into v_month_refunds, v_month_gross_collected
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz;

  -- 8. Pool/Day Use Revenue
  select coalesce(sum(total), 0)
    into v_day_use_revenue
  from public.pool_day_use
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  -- 9. Quotations Summary
  select
    coalesce(sum(total_amount), 0),
    count(*) filter (where status not in ('accepted', 'expired', 'cancelled'))
    into v_month_revenue, v_quotations_open_count
  from public.quotations
  where lodge_id = p_lodge_id
    and created_at >= v_month_start::timestamptz
    and created_at < v_month_end_exclusive::timestamptz;

  -- 10. Compile JSON snapshots
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'name', i.name,
      'category', i.category,
      'current_stock', i.current_stock,
      'reorder_level', i.reorder_level
    ) order by i.current_stock asc, i.name asc), '[]'::jsonb)
    into v_low_stock
  from public.inventory_items i
  where i.lodge_id = p_lodge_id
    and i.reorder_level is not null
    and i.current_stock <= i.reorder_level;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.check_in asc, t.room_number asc nulls last), '[]'::jsonb)
    into v_upcoming_arrivals
  from (
    select
      b.id,
      coalesce(c.name, 'Guest') as guest_name,
      b.check_in,
      b.check_out,
      b.room_number,
      b.source,
      b.status,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.amount_paid, 0) as amount_paid,
      case
        when b.source = 'online' and b.status = 'pending' then 'awaiting_front_desk_confirmation'
        else b.status
      end as manager_arrival_status
    from public.bookings b
    left join public.customers c on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.check_in >= v_today
      and b.check_in <= v_next_week
      and b.status in ('confirmed', 'checked_in')
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('date', o.day_key, 'occupied', o.occupied) order by o.day_key asc), '[]'::jsonb)
    into v_occupancy_trend
  from (
    select
      to_char(day_value::date, 'YYYY-MM-DD') as day_key,
      count(*) filter (
        where b.check_in <= day_value::date
          and b.check_out > day_value::date
          and b.status in ('confirmed', 'checked_in')
      ) as occupied
    from generate_series(v_previous_start::timestamp, v_today::timestamp, interval '1 day') day_value
    left join public.bookings b on b.lodge_id = p_lodge_id
    group by day_value::date
  ) o;

  -- 11. Final Return
  return jsonb_build_object(
    'totalRooms', coalesce(v_room_count_total, 0),
    'occupied', coalesce(v_occupied, 0),
    'occupancyPercent', case when v_room_count_total > 0 then round((v_occupied::numeric / v_room_count_total::numeric) * 100) else 0 end,
    'openMaintenance', coalesce(v_open_maintenance, 0),
    'urgentMaintenance', coalesce(v_urgent_maintenance, 0),
    'lowStockCount', coalesce(v_low_stock_count, 0),
    'unpaidCount', coalesce(v_unpaid_count, 0),
    'outstandingTotal', coalesce(v_outstanding_total, 0),
    'monthExpenses', coalesce(v_month_expenses, 0),
    'monthGrossCollected', coalesce(v_month_gross_collected, 0),
    'monthRefunds', coalesce(v_month_refunds, 0),
    'monthRevenue', coalesce(v_month_revenue, 0) + coalesce(v_day_use_revenue, 0),
    'openQuotations', coalesce(v_quotations_open_count, 0),
    'lowStock', coalesce(v_low_stock, '[]'::jsonb),
    'upcomingArrivals', coalesce(v_upcoming_arrivals, '[]'::jsonb),
    'revenueTrend', coalesce(v_revenue_trend, '[]'::jsonb),
    'occupancyTrend', coalesce(v_occupancy_trend, '[]'::jsonb)
  );
end;
$function$;

grant execute on function public.get_manager_dashboard_snapshot(uuid, date) to anon, authenticated, service_role;

commit;
