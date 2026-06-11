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
  v_pool_upcoming jsonb := '[]'::jsonb;
  v_revenue_trend jsonb := '[]'::jsonb;
  v_occupancy_trend jsonb := '[]'::jsonb;
  v_top_balances jsonb := '[]'::jsonb;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select count(*) into v_room_count_total
  from public.rooms
  where lodge_id = p_lodge_id;

  select count(*) into v_occupied
  from public.bookings
  where lodge_id = p_lodge_id
    and status = 'checked_in';

  select
    count(*) filter (where status = 'open'),
    count(*) filter (where status = 'open' and priority = 'urgent')
    into v_open_maintenance, v_urgent_maintenance
  from public.maintenance_tickets
  where lodge_id = p_lodge_id;

  select count(*)
    into v_low_stock_count
  from public.inventory_items
  where lodge_id = p_lodge_id
    and reorder_level is not null
    and current_stock <= reorder_level;

  select
    count(*) filter (where coalesce(payment_status, 'unpaid') in ('unpaid', 'partial')),
    coalesce(sum(greatest(coalesce(total_amount, 0) + coalesce(charges_total, 0) - coalesce(amount_paid, 0), 0)), 0)
    into v_unpaid_count, v_outstanding_total
  from public.bookings
  where lodge_id = p_lodge_id
    and status in ('confirmed', 'checked_in');

  select coalesce(sum(amount), 0)
    into v_month_expenses
  from public.expenses
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select
    coalesce(sum(case when type = 'refund' then amount else 0 end), 0),
    coalesce(sum(case when type <> 'refund' then amount else 0 end), 0)
    into v_month_refunds, v_month_gross_collected
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz;

  select
    coalesce(sum(total_amount + coalesce(charges_total, 0)), 0),
    count(*) filter (where status not in ('accepted', 'expired', 'cancelled'))
    into v_month_revenue, v_quotations_open_count
  from public.quotations
  where lodge_id = p_lodge_id
    and created_at >= v_month_start::timestamptz
    and created_at < v_month_end_exclusive::timestamptz;

  select coalesce(sum(total_amount), 0)
    into v_day_use_revenue
  from public.pool_day_use
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

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
      coalesce(c.name, 'Guest') as customer_name,
      b.check_in,
      b.check_out,
      b.room_number,
      b.source,
      b.status,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      case
        when b.source = 'online' and b.status = 'pending' then 'awaiting_front_desk_confirmation'
        else b.status
      end as manager_arrival_status,
      case
        when b.source = 'online' and b.status = 'pending' then 'Online request waiting for front desk confirmation.'
        when b.status = 'confirmed' then 'Confirmed and ready for front desk preparation.'
        when b.status = 'checked_in' then 'Guest is already checked in.'
        when b.status = 'checked_out' then 'Guest has already checked out.'
        else 'Active booking.'
      end as manager_arrival_note
    from public.bookings b
    left join public.customers c on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.check_in >= v_today
      and b.check_in <= v_next_week
      and b.status in ('pending', 'confirmed', 'checked_in', 'checked_out')
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.booking_date asc, t.created_at asc), '[]'::jsonb)
    into v_conference_upcoming
  from (
    select
      cb.id,
      cb.client_name as customer_name,
      cb.booking_date,
      cb.start_time,
      cb.end_time,
      cb.room_name,
      cb.attendees,
      cb.total_amount,
      cb.deposit_paid,
      cb.payment_status,
      cb.payment_method,
      cb.created_at,
      'conference' as booking_type
    from public.conference_bookings cb
    where cb.lodge_id = p_lodge_id
      and cb.booking_date >= v_today
      and cb.booking_date <= v_next_week
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.date asc, t.created_at asc), '[]'::jsonb)
    into v_pool_upcoming
  from (
    select
      pdu.id,
      pdu.guest_name as customer_name,
      pdu.date,
      pdu.adults,
      pdu.children,
      pdu.total as total_amount,
      pdu.payment_method,
      pdu.created_at,
      'pool' as booking_type
    from public.pool_day_use pdu
    where pdu.lodge_id = p_lodge_id
      and pdu.date >= v_today
      and pdu.date <= v_next_week
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('date', d.day_key, 'total', d.total) order by d.day_key asc), '[]'::jsonb)
    into v_revenue_trend
  from (
    select
      to_char(p.paid_at::date, 'YYYY-MM-DD') as day_key,
      sum(case when p.type = 'refund' then -abs(coalesce(p.amount, 0)) else coalesce(p.amount, 0) end) as total
    from public.payments p
    where p.lodge_id = p_lodge_id
      and p.paid_at >= v_previous_start::timestamptz
      and p.paid_at < (v_today + 1)::timestamptz
    group by p.paid_at::date
  ) d;

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
    left join public.bookings b
      on b.lodge_id = p_lodge_id
    group by day_value::date
  ) o;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.balance_due desc, t.check_in asc), '[]'::jsonb)
    into v_top_balances
  from (
    select
      b.id,
      coalesce(c.name, 'Guest') as customer_name,
      b.check_in,
      b.check_out,
      greatest(coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0), 0) as balance_due
    from public.bookings b
    left join public.customers c on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.status in ('confirmed', 'checked_in')
      and greatest(coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0), 0) > 0
    order by balance_due desc, check_in asc
    limit 10
  ) t;

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
    'conferenceUpcoming', coalesce(v_conference_upcoming, '[]'::jsonb),
    'poolUpcoming', coalesce(v_pool_upcoming, '[]'::jsonb),
    'revenueTrend', coalesce(v_revenue_trend, '[]'::jsonb),
    'occupancyTrend', coalesce(v_occupancy_trend, '[]'::jsonb),
    'topBalances', coalesce(v_top_balances, '[]'::jsonb)
  );
end;
$function$;

grant execute on function public.get_manager_dashboard_snapshot(uuid, date) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
