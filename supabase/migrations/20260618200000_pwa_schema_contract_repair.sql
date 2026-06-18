-- Repair Manager PWA read contracts without reintroducing duplicated columns.
-- Customer names and room numbers are resolved through their authoritative
-- relations, while financial totals remain sourced from bookings/payments.

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
  v_all_lodge_rooms integer := 0;
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

  select count(*) into v_all_lodge_rooms
  from public.rooms
  where lodge_id = p_lodge_id;

  select count(*) into v_occupied
  from public.bookings
  where lodge_id = p_lodge_id
    and status = 'checked_in';

  select
    count(*) filter (where status <> 'resolved'),
    count(*) filter (where status <> 'resolved' and priority = 'urgent')
    into v_open_maintenance, v_urgent_maintenance
  from public.maintenance_tickets
  where lodge_id = p_lodge_id;

  select count(*)
    into v_low_stock_count
  from public.inventory_items
  where lodge_id = p_lodge_id
    and coalesce(reorder_level, 0) > 0
    and coalesce(current_stock, 0) <= coalesce(reorder_level, 0);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.current_stock asc, t.name asc), '[]'::jsonb)
    into v_low_stock
  from (
    select
      ii.id,
      ii.name,
      ii.category,
      coalesce(ii.current_stock, 0) as current_stock,
      ii.reorder_level,
      ii.unit
    from public.inventory_items ii
    where ii.lodge_id = p_lodge_id
      and coalesce(ii.reorder_level, 0) > 0
      and coalesce(ii.current_stock, 0) <= coalesce(ii.reorder_level, 0)
    order by coalesce(ii.current_stock, 0) asc, ii.name asc
    limit 5
  ) t;

  select
    count(*),
    coalesce(sum(greatest(0, coalesce(total_amount, 0) + coalesce(charges_total, 0) - coalesce(amount_paid, 0))), 0)
    into v_unpaid_count, v_outstanding_total
  from public.bookings
  where lodge_id = p_lodge_id
    and status not in ('cancelled', 'checked_out')
    and coalesce(payment_status, 'unpaid') in ('unpaid', 'partial');

  select coalesce(sum(amount), 0)
    into v_month_gross_collected
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz
    and amount > 0;

  select coalesce(sum(abs(amount)), 0)
    into v_month_refunds
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz
    and (amount < 0 or lower(coalesce(type, '')) = 'refund');

  v_month_revenue := coalesce(v_month_gross_collected, 0) - coalesce(v_month_refunds, 0);

  select coalesce(sum(amount), 0)
    into v_month_expenses
  from public.expenses
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select count(*)
    into v_quotations_open_count
  from public.quotations
  where lodge_id = p_lodge_id
    and status in ('draft', 'sent', 'accepted');

  select coalesce(sum(total), 0)
    into v_day_use_revenue
  from public.pool_day_use
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.check_in asc, t.room_number asc nulls last), '[]'::jsonb)
    into v_upcoming_arrivals
  from (
    select
      b.id,
      coalesce(c.name, 'Guest') as guest_name,
      coalesce(c.name, 'Guest') as customer_name,
      b.check_in,
      b.check_out,
      r.room_number,
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
    left join public.customers c
      on c.id = b.customer_id
     and c.lodge_id = b.lodge_id
    left join public.rooms r
      on r.id = b.room_id
     and r.lodge_id = b.lodge_id
    where b.lodge_id = p_lodge_id
      and b.status <> 'cancelled'
      and b.check_in >= v_today
      and b.check_in <= v_next_week
    order by b.check_in asc, r.room_number asc nulls last
    limit 6
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.booking_date asc), '[]'::jsonb)
    into v_conference_upcoming
  from (
    select
      cb.id,
      cb.client_name,
      cb.booking_date,
      cb.start_time,
      cb.end_time,
      cb.setup_type,
      coalesce(cb.total_amount, 0) as total_amount,
      coalesce(cb.deposit_paid, 0) as deposit_paid,
      cb.payment_status
    from public.conference_bookings cb
    where cb.lodge_id = p_lodge_id
      and cb.booking_date >= v_today
      and cb.booking_date <= v_next_week
    order by cb.booking_date asc, cb.start_time asc nulls last
    limit 4
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
      'day', to_char(t.day, 'YYYY-MM-DD'),
      'amount', coalesce(t.amount, 0)
    ) order by t.day), '[]'::jsonb)
    into v_revenue_trend
  from (
    select
      d.day::date as day,
      coalesce(sum(p.amount), 0) as amount
    from generate_series(v_previous_start::timestamp, v_today::timestamp, interval '1 day') d(day)
    left join public.payments p
      on p.lodge_id = p_lodge_id
     and p.paid_at >= d.day
     and p.paid_at < (d.day + interval '1 day')
    group by d.day
    order by d.day
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object(
      'day', to_char(t.day, 'YYYY-MM-DD'),
      'occupied', t.occupied,
      'percent', t.percent
    ) order by t.day), '[]'::jsonb)
    into v_occupancy_trend
  from (
    select
      d.day::date as day,
      count(b.id) as occupied,
      case
        when v_all_lodge_rooms > 0 then round((count(b.id)::numeric / v_all_lodge_rooms::numeric) * 100)
        else 0
      end as percent
    from generate_series(v_previous_start::timestamp, v_today::timestamp, interval '1 day') d(day)
    left join public.bookings b
      on b.lodge_id = p_lodge_id
     and b.status <> 'cancelled'
     and b.check_in <= d.day::date
     and b.check_out > d.day::date
    group by d.day
    order by d.day
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.balance desc, t.check_in asc), '[]'::jsonb)
    into v_top_balances
  from (
    select
      b.id,
      coalesce(c.name, 'Guest') as guest_name,
      coalesce(c.name, 'Guest') as customer_name,
      b.check_in,
      b.check_out,
      greatest(0, coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)) as balance
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
     and c.lodge_id = b.lodge_id
    where b.lodge_id = p_lodge_id
      and b.status <> 'cancelled'
      and greatest(0, coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)) > 0
    order by balance desc, b.check_in asc
    limit 5
  ) t;

  return jsonb_build_object(
    'totalRooms', v_all_lodge_rooms,
    'occupied', v_occupied,
    'occupancyPercent', case when v_all_lodge_rooms > 0 then round((v_occupied::numeric / v_all_lodge_rooms::numeric) * 100) else 0 end,
    'openMaintenanceCount', v_open_maintenance,
    'urgentMaintenanceCount', v_urgent_maintenance,
    'lowStockCount', v_low_stock_count,
    'unpaidCount', v_unpaid_count,
    'outstandingTotal', coalesce(v_outstanding_total, 0),
    'monthExpenses', coalesce(v_month_expenses, 0),
    'monthGrossCollected', coalesce(v_month_gross_collected, 0),
    'monthRefunds', coalesce(v_month_refunds, 0),
    'monthRevenue', coalesce(v_month_revenue, 0),
    'monthNet', coalesce(v_month_revenue, 0) - coalesce(v_month_expenses, 0),
    'upcomingArrivals', v_upcoming_arrivals,
    'conferenceUpcoming', v_conference_upcoming,
    'quotationsOpenCount', v_quotations_open_count,
    'dayUseRevenue', coalesce(v_day_use_revenue, 0),
    'lowStock', v_low_stock,
    'revenueTrend', v_revenue_trend,
    'occupancyTrend', v_occupancy_trend,
    'topBalances', v_top_balances
  );
end;
$function$;

create or replace function public.get_invoice_summary(
  p_lodge_id uuid,
  p_booking_id uuid default null
)
returns table(
  invoice_id uuid,
  invoice_number text,
  booking_id uuid,
  lodge_id uuid,
  issued_at timestamptz,
  due_date date,
  notes text,
  guest_name text,
  customer_email text,
  check_in date,
  check_out date,
  total_amount numeric,
  charges_total numeric,
  amount_paid numeric,
  balance_due numeric,
  payment_status text,
  booking_status text,
  payment_count bigint,
  last_payment_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select
    i.id,
    i.invoice_number,
    b.id,
    b.lodge_id,
    i.issued_at,
    i.due_date,
    i.notes,
    coalesce(c.name, 'Guest'),
    coalesce(c.email, ''),
    b.check_in,
    b.check_out,
    coalesce(b.total_amount, 0),
    coalesce(b.charges_total, 0),
    coalesce(b.amount_paid, 0),
    greatest(0, coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)),
    coalesce(b.payment_status, 'unpaid'),
    coalesce(b.status, 'confirmed'),
    coalesce(pay_agg.payment_count, 0),
    pay_agg.last_payment_at
  from public.invoices i
  join public.bookings b
    on b.id = i.booking_id
   and b.lodge_id = p_lodge_id
  left join public.customers c
    on c.id = b.customer_id
   and c.lodge_id = b.lodge_id
  left join lateral (
    select count(*) as payment_count, max(p.paid_at) as last_payment_at
    from public.payments p
    where p.booking_id = b.id
      and p.lodge_id = p_lodge_id
  ) pay_agg on true
  where i.lodge_id = p_lodge_id
    and (p_booking_id is null or b.id = p_booking_id)
  order by i.issued_at desc;
end;
$function$;

create or replace function public.get_night_audit_summary(
  p_lodge_id uuid,
  p_audit_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_audit_date date := coalesce(p_audit_date, current_date);
  v_day_start timestamptz := coalesce(p_audit_date, current_date)::timestamptz;
  v_day_end timestamptz := (coalesce(p_audit_date, current_date) + 1)::timestamptz;
  v_check_ins jsonb := '[]'::jsonb;
  v_check_outs jsonb := '[]'::jsonb;
  v_new_bookings jsonb := '[]'::jsonb;
  v_outstanding jsonb := '[]'::jsonb;
  v_pos_orders jsonb := '[]'::jsonb;
  v_pos_revenue numeric := 0;
  v_gross_collected numeric := 0;
  v_refunds_issued numeric := 0;
  v_expenses_total numeric := 0;
  v_outstanding_total numeric := 0;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.room_number asc nulls last), '[]'::jsonb)
    into v_check_ins
  from (
    select
      b.id,
      coalesce(c.name, 'Guest') as customer_name,
      coalesce(c.name, 'Guest') as guest_name,
      r.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
     and c.lodge_id = b.lodge_id
    left join public.rooms r
      on r.id = b.room_id
     and r.lodge_id = b.lodge_id
    where b.lodge_id = p_lodge_id
      and b.check_in = v_audit_date
      and b.status <> 'cancelled'
    order by r.room_number asc nulls last, b.created_at desc
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.room_number asc nulls last), '[]'::jsonb)
    into v_check_outs
  from (
    select
      b.id,
      coalesce(c.name, 'Guest') as customer_name,
      coalesce(c.name, 'Guest') as guest_name,
      r.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
     and c.lodge_id = b.lodge_id
    left join public.rooms r
      on r.id = b.room_id
     and r.lodge_id = b.lodge_id
    where b.lodge_id = p_lodge_id
      and b.check_out = v_audit_date
      and b.status <> 'cancelled'
    order by r.room_number asc nulls last, b.created_at desc
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
    into v_new_bookings
  from (
    select
      b.id,
      coalesce(c.name, 'Guest') as customer_name,
      coalesce(c.name, 'Guest') as guest_name,
      r.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status,
      b.created_at
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
     and c.lodge_id = b.lodge_id
    left join public.rooms r
      on r.id = b.room_id
     and r.lodge_id = b.lodge_id
    where b.lodge_id = p_lodge_id
      and b.created_at >= v_day_start
      and b.created_at < v_day_end
    order by b.created_at desc
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.check_in asc), '[]'::jsonb)
    into v_outstanding
  from (
    select
      b.id,
      coalesce(c.name, 'Guest') as customer_name,
      coalesce(c.name, 'Guest') as guest_name,
      r.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
     and c.lodge_id = b.lodge_id
    left join public.rooms r
      on r.id = b.room_id
     and r.lodge_id = b.lodge_id
    where b.lodge_id = p_lodge_id
      and b.status in ('confirmed', 'checked_in')
      and coalesce(b.payment_status, 'unpaid') <> 'paid'
    order by b.check_in asc, r.room_number asc nulls last
  ) t;

  select
    coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb),
    coalesce(sum(t.total), 0)
    into v_pos_orders, v_pos_revenue
  from (
    select
      po.id,
      po.created_at,
      po.total,
      po.payment_method,
      po.booking_id,
      po.outlet_id
    from public.pos_orders po
    where po.lodge_id = p_lodge_id
      and po.status = 'completed'
      and po.created_at >= v_day_start
      and po.created_at < v_day_end
    order by po.created_at desc
  ) t;

  select coalesce(sum(amount), 0)
    into v_gross_collected
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_day_start
    and paid_at < v_day_end
    and amount > 0;

  select coalesce(sum(abs(amount)), 0)
    into v_refunds_issued
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_day_start
    and paid_at < v_day_end
    and (amount < 0 or lower(coalesce(type, '')) = 'refund');

  select coalesce(sum(amount), 0)
    into v_expenses_total
  from public.expenses
  where lodge_id = p_lodge_id
    and date = v_audit_date;

  select coalesce(sum(greatest(0, coalesce(total_amount, 0) + coalesce(charges_total, 0) - coalesce(amount_paid, 0))), 0)
    into v_outstanding_total
  from public.bookings
  where lodge_id = p_lodge_id
    and status in ('confirmed', 'checked_in')
    and coalesce(payment_status, 'unpaid') <> 'paid';

  return jsonb_build_object(
    'date', to_char(v_audit_date, 'YYYY-MM-DD'),
    'check_ins', v_check_ins,
    'check_outs', v_check_outs,
    'new_bookings', v_new_bookings,
    'outstanding', v_outstanding,
    'pos_orders', v_pos_orders,
    'pos_revenue', coalesce(v_pos_revenue, 0),
    'gross_collected', coalesce(v_gross_collected, 0),
    'refunds_issued', coalesce(v_refunds_issued, 0),
    'net_collected', coalesce(v_gross_collected, 0) - coalesce(v_refunds_issued, 0),
    'expenses_total', coalesce(v_expenses_total, 0),
    'outstanding_total', coalesce(v_outstanding_total, 0)
  );
end;
$function$;

revoke all on function public.get_manager_dashboard_snapshot(uuid, date) from public;
grant execute on function public.get_manager_dashboard_snapshot(uuid, date) to anon, authenticated, service_role;

revoke all on function public.get_invoice_summary(uuid, uuid) from public;
grant execute on function public.get_invoice_summary(uuid, uuid) to anon, authenticated, service_role;

revoke all on function public.get_night_audit_summary(uuid, date) from public;
grant execute on function public.get_night_audit_summary(uuid, date) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
