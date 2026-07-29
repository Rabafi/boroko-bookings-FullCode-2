-- Phase 4: restore hotel occupancy / ADR-RevPAR / debtor report RPCs after lint stubs.
-- Uses p_from / p_to for date-range reports (matches live post-repair signatures).
-- Values are derived from rooms + bookings (+ corporate_accounts where relevant).
-- No hard-coded sample KPIs.

begin;

-- ── Occupancy (+ ADR / RevPAR summary) ───────────────────────────────────────
create or replace function public.get_occupancy_report(
  p_lodge_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_daily jsonb;
  v_summary jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin', 'finance', 'owner']
  );

  if p_from is null or p_to is null or p_to < p_from then
    return jsonb_build_object(
      'success', false,
      'error', 'Invalid date range',
      'daily', '[]'::jsonb,
      'summary', '{}'::jsonb
    );
  end if;

  with date_series as (
    select generate_series(p_from, p_to, interval '1 day')::date as dt
  ),
  inventory as (
    select count(*)::numeric as total_rooms
    from public.rooms r
    where r.lodge_id = p_lodge_id
  ),
  daily as (
    select
      ds.dt,
      inv.total_rooms,
      count(b.id)::numeric as occupied,
      coalesce(sum(
        case
          when b.id is null then 0
          else coalesce(b.total_amount, 0)
            / greatest(1, (b.check_out::date - b.check_in::date))
        end
      ), 0)::numeric as room_revenue
    from date_series ds
    cross join inventory inv
    left join public.bookings b
      on b.lodge_id = p_lodge_id
     and coalesce(b.status, '') not in ('cancelled', 'pending')
     and b.check_in is not null
     and b.check_out is not null
     and b.check_in <= ds.dt
     and b.check_out > ds.dt
    group by ds.dt, inv.total_rooms
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'dt', d.dt,
        'date', d.dt,
        'room_type_name', 'All',
        'total_rooms', d.total_rooms,
        'occupied', d.occupied,
        'occupancy_rate', case
          when d.total_rooms > 0 then round((d.occupied / d.total_rooms) * 100, 1)
          else 0
        end,
        'room_revenue', round(d.room_revenue, 2)
      )
      order by d.dt
    ), '[]'::jsonb),
    jsonb_build_object(
      'total_room_nights', coalesce(sum(d.total_rooms), 0),
      'occupied_room_nights', coalesce(sum(d.occupied), 0),
      'avg_occupancy', case
        when coalesce(sum(d.total_rooms), 0) > 0
          then round((sum(d.occupied) / sum(d.total_rooms)) * 100, 1)
        else 0
      end,
      'room_revenue', round(coalesce(sum(d.room_revenue), 0), 2),
      'adr', case
        when coalesce(sum(d.occupied), 0) > 0
          then round(sum(d.room_revenue) / sum(d.occupied), 2)
        else 0
      end,
      'revpar', case
        when coalesce(sum(d.total_rooms), 0) > 0
          then round(sum(d.room_revenue) / sum(d.total_rooms), 2)
        else 0
      end,
      'source', 'server_rpc',
      'authority', 'booking_ledger_derived'
    )
  into v_daily, v_summary
  from daily d;

  return jsonb_build_object(
    'success', true,
    'daily', coalesce(v_daily, '[]'::jsonb),
    'summary', coalesce(v_summary, '{}'::jsonb),
    'source', 'server_rpc',
    'authority', 'booking_ledger_derived'
  );
end;
$$;

-- ── Rate performance (ADR-style by check-in day / room type) ─────────────────
create or replace function public.get_rate_performance_report(
  p_lodge_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_daily jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin', 'finance', 'owner']
  );

  if p_from is null or p_to is null or p_to < p_from then
    return jsonb_build_object('success', false, 'error', 'Invalid date range', 'daily', '[]'::jsonb);
  end if;

  with daily_rates as (
    select
      b.check_in::date as stay_date,
      coalesce(nullif(r.room_type, ''), 'unknown') as room_type,
      avg(
        coalesce(b.total_amount, 0)
        / greatest(1, (b.check_out::date - b.check_in::date))
      ) as avg_rate,
      count(*)::int as bookings_count,
      avg(coalesce(r.rate_per_night, 0)) as bar_rate
    from public.bookings b
    left join public.rooms r on r.id = b.room_id and r.lodge_id = p_lodge_id
    where b.lodge_id = p_lodge_id
      and coalesce(b.status, '') not in ('cancelled', 'pending')
      and b.check_in is not null
      and b.check_out is not null
      and b.check_in >= p_from
      and b.check_in <= p_to
    group by b.check_in::date, coalesce(nullif(r.room_type, ''), 'unknown')
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', dr.stay_date,
      'room_type', dr.room_type,
      'avg_rate', round(dr.avg_rate, 2),
      'bar_rate', round(dr.bar_rate, 2),
      'premium_pct', case
        when dr.bar_rate > 0 then round(((dr.avg_rate - dr.bar_rate) / dr.bar_rate) * 100, 1)
        else null
      end,
      'bookings_count', dr.bookings_count
    )
    order by dr.stay_date, dr.room_type
  ), '[]'::jsonb)
  into v_daily
  from daily_rates dr;

  return jsonb_build_object(
    'success', true,
    'daily', coalesce(v_daily, '[]'::jsonb),
    'source', 'server_rpc',
    'authority', 'booking_ledger_derived'
  );
end;
$$;

-- ── Channel / source revenue ─────────────────────────────────────────────────
create or replace function public.get_channel_source_report(
  p_lodge_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_channels jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin', 'finance', 'owner']
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'channel', c.channel,
      'booking_count', c.booking_count,
      'revenue', c.revenue,
      'avg_nights', c.avg_nights,
      'avg_rate', c.avg_rate
    )
    order by c.revenue desc
  ), '[]'::jsonb)
  into v_channels
  from (
    select
      coalesce(nullif(b.channel, ''), nullif(b.source, ''), 'direct') as channel,
      count(*)::int as booking_count,
      round(coalesce(sum(b.total_amount), 0), 2) as revenue,
      round(avg(greatest(1, (b.check_out::date - b.check_in::date))), 1) as avg_nights,
      round(avg(
        coalesce(b.total_amount, 0)
        / greatest(1, (b.check_out::date - b.check_in::date))
      ), 2) as avg_rate
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and coalesce(b.status, '') not in ('cancelled', 'pending')
      and b.check_in >= p_from
      and b.check_in <= p_to
    group by 1
  ) c;

  return jsonb_build_object(
    'success', true,
    'channels', coalesce(v_channels, '[]'::jsonb),
    'source', 'server_rpc',
    'authority', 'booking_ledger_derived'
  );
end;
$$;

-- ── Cancellation / no-show ───────────────────────────────────────────────────
create or replace function public.get_cancellation_no_show_report(
  p_lodge_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_daily jsonb;
  v_summary jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin', 'finance', 'owner']
  );

  with date_series as (
    select generate_series(p_from, p_to, interval '1 day')::date as dt
  ),
  daily as (
    select
      ds.dt as date,
      count(b.id)::int as total,
      count(*) filter (where lower(coalesce(b.status, '')) = 'cancelled')::int as cancelled,
      count(*) filter (
        where lower(coalesce(b.status, '')) in ('no_show', 'no-show')
      )::int as no_shows
    from date_series ds
    left join public.bookings b
      on b.lodge_id = p_lodge_id
     and b.check_in = ds.dt
    group by ds.dt
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'date', d.date,
        'total', d.total,
        'cancelled', d.cancelled,
        'no_shows', d.no_shows,
        'cancellation_rate', case when d.total > 0 then round((d.cancelled::numeric / d.total) * 100, 1) else 0 end,
        'no_show_rate', case when d.total > 0 then round((d.no_shows::numeric / d.total) * 100, 1) else 0 end
      )
      order by d.date
    ), '[]'::jsonb),
    jsonb_build_object(
      'total_bookings', coalesce(sum(d.total), 0),
      'cancellation_rate', case
        when coalesce(sum(d.total), 0) > 0
          then round((sum(d.cancelled)::numeric / sum(d.total)) * 100, 1)
        else 0
      end,
      'no_show_rate', case
        when coalesce(sum(d.total), 0) > 0
          then round((sum(d.no_shows)::numeric / sum(d.total)) * 100, 1)
        else 0
      end
    )
  into v_daily, v_summary
  from daily d;

  return jsonb_build_object(
    'success', true,
    'daily', coalesce(v_daily, '[]'::jsonb),
    'summary', coalesce(v_summary, '{}'::jsonb),
    'source', 'server_rpc',
    'authority', 'booking_ledger_derived'
  );
end;
$$;

-- ── Pace (this year vs last year) — align params to p_from/p_to ───────────────
drop function if exists public.get_pace_report(uuid, date, date);

create or replace function public.get_pace_report(
  p_lodge_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_daily jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin', 'finance', 'owner']
  );

  with date_series as (
    select generate_series(p_from, p_to, interval '1 day')::date as dt
  ),
  daily as (
    select
      ds.dt as date,
      count(b_ty.id)::int as this_year_bookings,
      round(coalesce(sum(b_ty.total_amount), 0), 2) as this_year_revenue,
      count(b_ly.id)::int as last_year_bookings,
      round(coalesce(sum(b_ly.total_amount), 0), 2) as last_year_revenue
    from date_series ds
    left join public.bookings b_ty
      on b_ty.lodge_id = p_lodge_id
     and b_ty.check_in = ds.dt
     and coalesce(b_ty.status, '') not in ('cancelled', 'pending')
    left join public.bookings b_ly
      on b_ly.lodge_id = p_lodge_id
     and b_ly.check_in = (ds.dt - interval '1 year')::date
     and coalesce(b_ly.status, '') not in ('cancelled', 'pending')
    group by ds.dt
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', d.date,
      'this_year_bookings', d.this_year_bookings,
      'this_year_revenue', d.this_year_revenue,
      'last_year_bookings', d.last_year_bookings,
      'last_year_revenue', d.last_year_revenue,
      'pace_change_pct', case
        when d.last_year_bookings > 0
          then round(((d.this_year_bookings - d.last_year_bookings)::numeric / d.last_year_bookings) * 100, 1)
        else null
      end
    )
    order by d.date
  ), '[]'::jsonb)
  into v_daily
  from daily d;

  return jsonb_build_object(
    'success', true,
    'daily', coalesce(v_daily, '[]'::jsonb),
    'source', 'server_rpc',
    'authority', 'booking_ledger_derived'
  );
end;
$$;

-- ── Pickup by source ─────────────────────────────────────────────────────────
create or replace function public.get_pickup_report(
  p_lodge_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sources jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin', 'finance', 'owner']
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'source', s.source,
      'booking_count', s.booking_count,
      'revenue', s.revenue,
      'avg_rate', s.avg_rate
    )
    order by s.revenue desc
  ), '[]'::jsonb)
  into v_sources
  from (
    select
      coalesce(nullif(b.source, ''), nullif(b.channel, ''), 'direct') as source,
      count(*)::int as booking_count,
      round(coalesce(sum(b.total_amount), 0), 2) as revenue,
      round(avg(
        coalesce(b.total_amount, 0)
        / greatest(1, (b.check_out::date - b.check_in::date))
      ), 2) as avg_rate
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and coalesce(b.status, '') not in ('cancelled', 'pending')
      and b.check_in >= p_from
      and b.check_in <= p_to
    group by 1
  ) s;

  return jsonb_build_object(
    'success', true,
    'sources', coalesce(v_sources, '[]'::jsonb),
    'source', 'server_rpc',
    'authority', 'booking_ledger_derived'
  );
end;
$$;

-- ── Debtor aging detail (optional corporate filter) ──────────────────────────
drop function if exists public.get_debtor_aging_detail(uuid);
drop function if exists public.get_debtor_aging_detail(uuid, uuid);

create or replace function public.get_debtor_aging_detail(
  p_lodge_id uuid,
  p_corporate_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_accounts jsonb;
  v_now date := current_date;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin', 'finance', 'owner']
  );

  with outstanding as (
    select
      b.corporate_account_id,
      b.check_out::date as check_out,
      greatest(
        0,
        coalesce(b.total_amount, 0)
          + coalesce(b.charges_total, 0)
          - coalesce(b.amount_paid, 0)
      ) as outstanding
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.corporate_account_id is not null
      and (p_corporate_account_id is null or b.corporate_account_id = p_corporate_account_id)
      and coalesce(b.status, '') not in ('cancelled', 'pending')
      and (
        coalesce(b.amount_paid, 0)
        < coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0)
      )
  ),
  aged as (
    select
      o.corporate_account_id,
      sum(o.outstanding) as outstanding_balance,
      sum(case when (v_now - o.check_out) <= 0 then o.outstanding else 0 end) as current,
      sum(case when (v_now - o.check_out) between 1 and 30 then o.outstanding else 0 end) as days_1_30,
      sum(case when (v_now - o.check_out) between 31 and 60 then o.outstanding else 0 end) as days_31_60,
      sum(case when (v_now - o.check_out) between 61 and 90 then o.outstanding else 0 end) as days_61_90,
      sum(case when (v_now - o.check_out) > 90 then o.outstanding else 0 end) as days_91_plus
    from outstanding o
    group by o.corporate_account_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'corporate_account_id', ca.id,
      'company_name', ca.company_name,
      'outstanding_balance', round(a.outstanding_balance, 2),
      'credit_limit', coalesce(ca.credit_limit, 0),
      'current', round(a.current, 2),
      'days_1_30', round(a.days_1_30, 2),
      'days_31_60', round(a.days_31_60, 2),
      'days_61_90', round(a.days_61_90, 2),
      'days_91_plus', round(a.days_91_plus, 2)
    )
    order by ca.company_name
  ), '[]'::jsonb)
  into v_accounts
  from aged a
  join public.corporate_accounts ca
    on ca.id = a.corporate_account_id
   and ca.lodge_id = p_lodge_id
  where a.outstanding_balance > 0;

  return jsonb_build_object(
    'success', true,
    'accounts', coalesce(v_accounts, '[]'::jsonb),
    'source', 'server_rpc',
    'authority', 'booking_ledger_derived'
  );
end;
$$;

-- ── Deposit liability (booking payments held against open stays) ─────────────
create or replace function public.get_deposit_liability_report(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_total numeric := 0;
  v_breakdown jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin', 'finance', 'owner']
  );

  select
    coalesce(sum(b.amount_paid), 0),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'booking_id', b.id,
        'customer_name', c.name,
        'check_in', b.check_in,
        'check_out', b.check_out,
        'deposit_amount', coalesce(b.amount_paid, 0),
        'total_amount', coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0),
        'balance_due', greatest(
          0,
          coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)
        ),
        'status', b.status
      )
      order by b.check_in
    ), '[]'::jsonb)
  into v_total, v_breakdown
  from public.bookings b
  left join public.customers c on c.id = b.customer_id
  where b.lodge_id = p_lodge_id
    and coalesce(b.status, '') not in ('cancelled', 'pending')
    and coalesce(b.amount_paid, 0) > 0
    and b.check_out >= current_date;

  return jsonb_build_object(
    'success', true,
    'total_deposits_collected', round(coalesce(v_total, 0), 2),
    'total_deposits_applied', 0,
    'outstanding_liability', round(coalesce(v_total, 0), 2),
    'breakdown', coalesce(v_breakdown, '[]'::jsonb),
    'source', 'server_rpc',
    'authority', 'booking_payment_derived',
    'note', 'Liability estimate from booking amount_paid on open/future stays; customer-credit ledger is separate.'
  );
end;
$$;

-- ── Folio / balance exceptions from booking ledger fields ────────────────────
create or replace function public.get_folio_exception_report(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_exceptions jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin', 'finance', 'owner']
  );

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'booking_id', b.id,
      'customer_name', c.name,
      'room_number', r.room_number,
      'charges_total', coalesce(b.charges_total, 0),
      'amount_paid', coalesce(b.amount_paid, 0),
      'unallocated_amount', greatest(
        0,
        coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)
      ),
      'status', b.status,
      'check_in', b.check_in,
      'check_out', b.check_out
    )
    order by greatest(
      0,
      coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)
    ) desc
  ), '[]'::jsonb)
  into v_exceptions
  from public.bookings b
  left join public.customers c on c.id = b.customer_id
  left join public.rooms r on r.id = b.room_id
  where b.lodge_id = p_lodge_id
    and coalesce(b.status, '') not in ('cancelled', 'pending')
    and (
      coalesce(b.amount_paid, 0)
      < coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0)
    );

  return jsonb_build_object(
    'success', true,
    'exceptions', coalesce(v_exceptions, '[]'::jsonb),
    'source', 'server_rpc',
    'authority', 'booking_ledger_derived'
  );
end;
$$;

grant execute on function public.get_occupancy_report(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_rate_performance_report(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_channel_source_report(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_cancellation_no_show_report(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_pace_report(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_pickup_report(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_debtor_aging_detail(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_deposit_liability_report(uuid) to authenticated, service_role;
grant execute on function public.get_folio_exception_report(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
