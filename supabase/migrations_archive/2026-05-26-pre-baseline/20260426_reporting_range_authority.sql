begin;

create or replace function public.get_revenue_report(
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
  v_cancelled_count integer := 0;
  v_regular_revenue numeric := 0;
  v_event_revenue numeric := 0;
  v_total_revenue numeric := 0;
  v_total_paid_snapshot numeric := 0;
  v_total_bookings integer := 0;
  v_confirmed_count integer := 0;
  v_checked_in_count integer := 0;
  v_checked_out_count integer := 0;
  v_paid_count integer := 0;
  v_partial_count integer := 0;
  v_unpaid_count integer := 0;
  v_gross_collected numeric := 0;
  v_refunds_issued numeric := 0;
  v_net_cash_collected numeric := 0;
  v_retained_revenue numeric := 0;
  v_retained_count integer := 0;
  v_vat_amount numeric := 0;
  v_vat_rates_in_use integer := 0;
  v_vat_rate numeric := null;
  v_event_bookings jsonb := '[]'::jsonb;
  v_event_count integer := 0;
  v_booking_payment_by_method jsonb := '{}'::jsonb;
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

  with bookings_in_range as (
    select
      b.id,
      b.total_amount,
      b.charges_total,
      b.amount_paid,
      b.status,
      b.payment_status,
      b.check_in,
      b.check_out,
      b.is_exclusive_event,
      b.notes,
      b.event_daily_rate,
      b.vat_enabled,
      b.vat_rate,
      b.created_at
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.check_in >= p_start_date
      and b.check_in <= p_end_date
  )
  select count(*)
    into v_cancelled_count
  from bookings_in_range
  where coalesce(status, '') = 'cancelled';

  with revenue_bookings as (
    select *
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.check_in >= p_start_date
      and b.check_in <= p_end_date
      and coalesce(b.status, '') <> 'cancelled'
  )
  select
    coalesce(sum(coalesce(total_amount, 0) + coalesce(charges_total, 0)), 0),
    coalesce(sum(coalesce(amount_paid, 0)), 0),
    count(*)
      filter (where not coalesce(is_exclusive_event, false)),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and status = 'confirmed'),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and status = 'checked_in'),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and status = 'checked_out'),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and payment_status = 'paid'),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and payment_status = 'partial'),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and coalesce(payment_status, 'unpaid') = 'unpaid'),
    coalesce(sum(
      case
        when not coalesce(is_exclusive_event, false) and coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0
          then ((coalesce(total_amount, 0) + coalesce(charges_total, 0)) * coalesce(vat_rate, 0)) / (100 + coalesce(vat_rate, 0))
        else 0
      end
    ), 0),
    count(distinct case when coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0 then vat_rate end),
    min(case when coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0 then vat_rate end)
    into v_regular_revenue,
         v_total_paid_snapshot,
         v_total_bookings,
         v_confirmed_count,
         v_checked_in_count,
         v_checked_out_count,
         v_paid_count,
         v_partial_count,
         v_unpaid_count,
         v_vat_amount,
         v_vat_rates_in_use,
         v_vat_rate
  from revenue_bookings;

  with event_rows as (
    select
      coalesce((regexp_match(coalesce(b.notes, ''), '\[GROUP:([^\]]+)\]'))[1], to_char(b.check_in, 'YYYY-MM-DD')) as group_id,
      b.check_in,
      b.check_out,
      b.event_daily_rate,
      b.charges_total,
      b.amount_paid,
      b.status,
      b.payment_status,
      b.vat_enabled,
      b.vat_rate,
      b.created_at
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.check_in >= p_start_date
      and b.check_in <= p_end_date
      and coalesce(b.status, '') <> 'cancelled'
      and coalesce(b.is_exclusive_event, false)
  ),
  grouped_events as (
    select
      group_id,
      min(check_in) as check_in,
      max(check_out) as check_out,
      greatest(1, max(check_out - check_in)) as nights,
      coalesce((array_agg(coalesce(event_daily_rate, 0) order by created_at asc))[1], 0) as daily_rate,
      coalesce(sum(coalesce(charges_total, 0)), 0) as charges_total,
      count(*) as room_count,
      coalesce((array_agg(coalesce(status, 'confirmed') order by created_at asc))[1], 'confirmed') as status,
      coalesce((array_agg(coalesce(payment_status, 'unpaid') order by created_at asc))[1], 'unpaid') as payment_status,
      coalesce(sum(coalesce(amount_paid, 0)), 0) as amount_paid,
      coalesce((array_agg(coalesce(vat_enabled, false) order by created_at asc))[1], false) as vat_enabled,
      coalesce((array_agg(coalesce(vat_rate, 0) order by created_at asc))[1], 0) as vat_rate
    from event_rows
    group by group_id
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'group_id', group_id,
      'check_in', check_in,
      'check_out', check_out,
      'nights', nights,
      'daily_rate', daily_rate,
      'total', (daily_rate * nights),
      'charges_total', charges_total,
      'room_count', room_count,
      'status', status,
      'payment_status', payment_status,
      'amount_paid', amount_paid
    ) order by check_in asc, group_id asc), '[]'::jsonb),
    coalesce(sum((daily_rate * nights) + charges_total), 0),
    count(*),
    coalesce(sum(amount_paid), 0),
    count(*) filter (where status = 'confirmed'),
    count(*) filter (where status = 'checked_in'),
    count(*) filter (where status = 'checked_out'),
    count(*) filter (where payment_status = 'paid'),
    count(*) filter (where payment_status = 'partial'),
    count(*) filter (where coalesce(payment_status, 'unpaid') = 'unpaid'),
    coalesce(sum(
      case
        when vat_enabled and coalesce(vat_rate, 0) > 0
          then (((daily_rate * nights) + charges_total) * vat_rate) / (100 + vat_rate)
        else 0
      end
    ), 0),
    count(distinct case when vat_enabled and coalesce(vat_rate, 0) > 0 then vat_rate end),
    min(case when vat_enabled and coalesce(vat_rate, 0) > 0 then vat_rate end)
    into v_event_bookings,
         v_event_revenue,
         v_event_count,
         v_total_paid_snapshot,
         v_confirmed_count,
         v_checked_in_count,
         v_checked_out_count,
         v_paid_count,
         v_partial_count,
         v_unpaid_count,
         v_vat_amount,
         v_vat_rates_in_use,
         v_vat_rate
  from grouped_events;

  with revenue_bookings as (
    select *
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.check_in >= p_start_date
      and b.check_in <= p_end_date
      and coalesce(b.status, '') <> 'cancelled'
  ),
  grouped_events as (
    select
      coalesce((regexp_match(coalesce(b.notes, ''), '\[GROUP:([^\]]+)\]'))[1], to_char(b.check_in, 'YYYY-MM-DD')) as group_id,
      min(b.check_in) as check_in,
      max(b.check_out) as check_out,
      greatest(1, max(b.check_out - b.check_in)) as nights,
      coalesce((array_agg(coalesce(b.event_daily_rate, 0) order by b.created_at asc))[1], 0) as daily_rate,
      coalesce(sum(coalesce(b.charges_total, 0)), 0) as charges_total,
      coalesce(sum(coalesce(b.amount_paid, 0)), 0) as amount_paid,
      coalesce((array_agg(coalesce(b.status, 'confirmed') order by b.created_at asc))[1], 'confirmed') as status,
      coalesce((array_agg(coalesce(b.payment_status, 'unpaid') order by b.created_at asc))[1], 'unpaid') as payment_status,
      coalesce((array_agg(coalesce(b.vat_enabled, false) order by b.created_at asc))[1], false) as vat_enabled,
      coalesce((array_agg(coalesce(b.vat_rate, 0) order by b.created_at asc))[1], 0) as vat_rate
    from revenue_bookings b
    where coalesce(b.is_exclusive_event, false)
    group by coalesce((regexp_match(coalesce(b.notes, ''), '\[GROUP:([^\]]+)\]'))[1], to_char(b.check_in, 'YYYY-MM-DD'))
  ),
  booking_summary as (
    select
      coalesce(sum(case when not coalesce(is_exclusive_event, false) then coalesce(total_amount, 0) + coalesce(charges_total, 0) else 0 end), 0) as regular_revenue,
      coalesce(sum(case when not coalesce(is_exclusive_event, false) then coalesce(amount_paid, 0) else 0 end), 0) as regular_paid,
      count(*) filter (where not coalesce(is_exclusive_event, false)) as regular_units,
      count(*) filter (where not coalesce(is_exclusive_event, false) and status = 'confirmed') as regular_confirmed,
      count(*) filter (where not coalesce(is_exclusive_event, false) and status = 'checked_in') as regular_checked_in,
      count(*) filter (where not coalesce(is_exclusive_event, false) and status = 'checked_out') as regular_checked_out,
      count(*) filter (where not coalesce(is_exclusive_event, false) and payment_status = 'paid') as regular_paid_count,
      count(*) filter (where not coalesce(is_exclusive_event, false) and payment_status = 'partial') as regular_partial_count,
      count(*) filter (where not coalesce(is_exclusive_event, false) and coalesce(payment_status, 'unpaid') = 'unpaid') as regular_unpaid_count,
      coalesce(sum(
        case
          when not coalesce(is_exclusive_event, false) and coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0
            then ((coalesce(total_amount, 0) + coalesce(charges_total, 0)) * coalesce(vat_rate, 0)) / (100 + coalesce(vat_rate, 0))
          else 0
        end
      ), 0) as regular_vat,
      count(distinct case when coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0 then vat_rate end) as vat_rates_in_use,
      min(case when coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0 then vat_rate end) as vat_rate
    from revenue_bookings
  ),
  event_summary as (
    select
      coalesce(sum((daily_rate * nights) + charges_total), 0) as event_revenue,
      coalesce(sum(amount_paid), 0) as event_paid,
      count(*) as event_units,
      count(*) filter (where status = 'confirmed') as event_confirmed,
      count(*) filter (where status = 'checked_in') as event_checked_in,
      count(*) filter (where status = 'checked_out') as event_checked_out,
      count(*) filter (where payment_status = 'paid') as event_paid_count,
      count(*) filter (where payment_status = 'partial') as event_partial_count,
      count(*) filter (where coalesce(payment_status, 'unpaid') = 'unpaid') as event_unpaid_count,
      coalesce(sum(
        case
          when vat_enabled and coalesce(vat_rate, 0) > 0
            then (((daily_rate * nights) + charges_total) * vat_rate) / (100 + vat_rate)
          else 0
        end
      ), 0) as event_vat,
      count(distinct case when vat_enabled and coalesce(vat_rate, 0) > 0 then vat_rate end) as event_vat_rates_in_use,
      min(case when vat_enabled and coalesce(vat_rate, 0) > 0 then vat_rate end) as event_vat_rate
    from grouped_events
  )
  select
    bs.regular_revenue,
    es.event_revenue,
    (bs.regular_revenue + es.event_revenue),
    (bs.regular_paid + es.event_paid),
    (bs.regular_units + es.event_units),
    (bs.regular_confirmed + es.event_confirmed),
    (bs.regular_checked_in + es.event_checked_in),
    (bs.regular_checked_out + es.event_checked_out),
    (bs.regular_paid_count + es.event_paid_count),
    (bs.regular_partial_count + es.event_partial_count),
    (bs.regular_unpaid_count + es.event_unpaid_count),
    (bs.regular_vat + es.event_vat)
    into v_regular_revenue,
         v_event_revenue,
         v_total_revenue,
         v_total_paid_snapshot,
         v_total_bookings,
         v_confirmed_count,
         v_checked_in_count,
         v_checked_out_count,
         v_paid_count,
         v_partial_count,
         v_unpaid_count,
         v_vat_amount
  from booking_summary bs
  cross join event_summary es;

  with vat_rates as (
    select distinct coalesce(vat_rate, 0) as vat_rate
    from public.bookings
    where lodge_id = p_lodge_id
      and check_in >= p_start_date
      and check_in <= p_end_date
      and coalesce(status, '') <> 'cancelled'
      and coalesce(vat_enabled, false)
      and coalesce(vat_rate, 0) > 0
  )
  select count(*), min(vat_rate)
    into v_vat_rates_in_use, v_vat_rate
  from vat_rates;

  with payment_window as (
    select p.booking_id, p.amount, p.method, p.type, p.paid_at
    from public.payments p
    where p.lodge_id = p_lodge_id
      and p.paid_at >= p_start_date::timestamptz
      and p.paid_at < (p_end_date + 1)::timestamptz
  ),
  cancelled_bookings as (
    select b.id
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.check_in >= p_start_date
      and b.check_in <= p_end_date
      and coalesce(b.status, '') = 'cancelled'
  ),
  payment_methods as (
    select
      coalesce(nullif(trim(method), ''), 'unknown') as method,
      sum(amount) as total
    from payment_window
    where amount > 0
    group by coalesce(nullif(trim(method), ''), 'unknown')
  )
  select
    coalesce(sum(case when amount > 0 then amount else 0 end), 0),
    coalesce(sum(case when amount < 0 or lower(coalesce(type, '')) = 'refund' then abs(amount) else 0 end), 0),
    coalesce(sum(amount), 0),
    coalesce(sum(case when cb.id is not null and lower(coalesce(pw.type, '')) <> 'refund' and pw.amount > 0 then pw.amount else 0 end), 0),
    count(distinct case when cb.id is not null and lower(coalesce(pw.type, '')) <> 'refund' and pw.amount > 0 then pw.booking_id end),
    coalesce((select jsonb_object_agg(method, total) from payment_methods), '{}'::jsonb)
    into v_gross_collected,
         v_refunds_issued,
         v_net_cash_collected,
         v_retained_revenue,
         v_retained_count,
         v_booking_payment_by_method
  from payment_window pw
  left join cancelled_bookings cb
    on cb.id = pw.booking_id;

  return jsonb_build_object(
    'total_revenue', coalesce(v_total_revenue, 0),
    'regular_revenue', coalesce(v_regular_revenue, 0),
    'event_revenue', coalesce(v_event_revenue, 0),
    'event_count', coalesce(v_event_count, 0),
    'event_bookings', v_event_bookings,
    'total_bookings', coalesce(v_total_bookings, 0),
    'avg_booking_value', case when coalesce(v_total_bookings, 0) > 0 then coalesce(v_total_revenue, 0) / v_total_bookings else 0 end,
    'confirmed_count', coalesce(v_confirmed_count, 0),
    'checked_in_count', coalesce(v_checked_in_count, 0),
    'checked_out_count', coalesce(v_checked_out_count, 0),
    'cancelled_count', coalesce(v_cancelled_count, 0),
    'paid_count', coalesce(v_paid_count, 0),
    'partial_count', coalesce(v_partial_count, 0),
    'unpaid_count', coalesce(v_unpaid_count, 0),
    'paid_revenue', coalesce(v_net_cash_collected, 0),
    'cash_collected', coalesce(v_net_cash_collected, 0),
    'gross_collected', coalesce(v_gross_collected, 0),
    'refunds_issued', coalesce(v_refunds_issued, 0),
    'amount_paid_snapshot', coalesce(v_total_paid_snapshot, 0),
    'retained_revenue', coalesce(v_retained_revenue, 0),
    'retained_count', coalesce(v_retained_count, 0),
    'outstanding_amount', coalesce(v_total_revenue, 0) - coalesce(v_total_paid_snapshot, 0),
    'vat_enabled', coalesce(v_vat_rates_in_use, 0) > 0,
    'vat_rate', case when coalesce(v_vat_rates_in_use, 0) = 1 then v_vat_rate else null end,
    'vat_mixed', coalesce(v_vat_rates_in_use, 0) > 1,
    'vat_amount', round(coalesce(v_vat_amount, 0)::numeric, 2),
    'net_revenue', round((coalesce(v_total_revenue, 0) - coalesce(v_vat_amount, 0))::numeric, 2),
    'booking_payment_by_method', coalesce(v_booking_payment_by_method, '{}'::jsonb)
  );
end;
$function$;

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
  v_retained_revenue numeric := 0;
  v_total_revenue numeric := 0;
  v_total_expenses numeric := 0;
  v_inv_costs numeric := 0;
  v_sup_costs numeric := 0;
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
  v_retained_revenue := coalesce((v_revenue ->> 'retained_revenue')::numeric, 0);

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

  v_total_revenue := coalesce(v_booking_revenue, 0) + coalesce(v_pos_revenue, 0) + coalesce(v_conference_revenue, 0) + coalesce(v_pool_revenue, 0) + coalesce(v_retained_revenue, 0);
  v_total_costs := coalesce(v_inv_costs, 0) + coalesce(v_sup_costs, 0);
  v_gross_profit := v_total_revenue - coalesce(v_total_expenses, 0) - v_total_costs;

  return jsonb_build_object(
    'bookingRevenue', coalesce(v_booking_revenue, 0),
    'retainedRevenue', coalesce(v_retained_revenue, 0),
    'posRevenue', coalesce(v_pos_revenue, 0),
    'conferenceRevenue', coalesce(v_conference_revenue, 0),
    'poolRevenue', coalesce(v_pool_revenue, 0),
    'totalRevenue', coalesce(v_total_revenue, 0),
    'totalExpenses', coalesce(v_total_expenses, 0),
    'expByCategory', coalesce(v_exp_by_category, '{}'::jsonb),
    'invCosts', coalesce(v_inv_costs, 0),
    'supCosts', coalesce(v_sup_costs, 0),
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

revoke all on function public.get_revenue_report(uuid, date, date) from public, anon;
grant execute on function public.get_revenue_report(uuid, date, date) to authenticated, service_role;

revoke all on function public.get_profit_loss_summary(uuid, date, date) from public, anon;
grant execute on function public.get_profit_loss_summary(uuid, date, date) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
