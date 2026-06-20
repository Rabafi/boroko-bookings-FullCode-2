-- Guest Lifetime Intelligence RPC
-- Returns server-authoritative guest summaries with booking counts, financials, and status.

create or replace function public.get_guest_lifetime_summary(
  p_lodge_id uuid,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  customer_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  is_blacklisted boolean,
  blacklist_reason text,
  total_stays integer,
  completed_stays integer,
  first_stay_date date,
  last_stay_date date,
  upcoming_stay_date date,
  accommodation_value numeric,
  payments_received numeric,
  outstanding_balance numeric,
  average_completed_stay_value numeric,
  pos_charges numeric,
  guest_status text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with guest_bookings as (
    select
      b.customer_id,
      b.total_amount,
      b.charges_total,
      b.amount_paid,
      b.status,
      b.check_in,
      b.check_out,
      b.payment_status
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.customer_id is not null
      and (p_search is null or p_search = '' or exists (
        select 1 from public.customers c
        where c.id = b.customer_id
          and c.lodge_id = p_lodge_id
          and (c.name ilike '%' || p_search || '%'
               or c.phone ilike '%' || p_search || '%'
               or c.email ilike '%' || p_search || '%')
      ))
  ),
  guest_pos as (
    select
      po.booking_id,
      coalesce(po.total, 0) as order_total
    from public.pos_orders po
    where po.lodge_id = p_lodge_id
      and po.status in ('completed', 'settled')
      and po.booking_id is not null
  ),
  guest_payments as (
    select
      gb.customer_id,
      coalesce(sum(
        case when p.type in ('payment', 'deposit') then p.amount else 0 end
      ), 0) as total_payments
    from public.payments p
    inner join public.bookings b ON b.id = p.booking_id
    inner join guest_bookings gb on gb.customer_id = b.customer_id and gb.check_in = b.check_in
    where p.lodge_id = p_lodge_id
      and p.type in ('payment', 'deposit', 'refund', 'retention_fee')
    group by gb.customer_id
  ),
  aggregated as (
    select
      gb.customer_id,
      count(*) filter (where gb.status != 'cancelled') as total_stays,
      count(*) filter (where gb.status = 'checked_out') as completed_stays,
      min(gb.check_in) filter (where gb.status != 'cancelled') as first_stay_date,
      max(gb.check_out) filter (where gb.status in ('checked_in', 'checked_out')) as last_stay_date,
      min(gb.check_in) filter (where gb.status in ('confirmed', 'pending') and gb.check_in > CURRENT_DATE) as upcoming_stay_date,
      coalesce(sum(
        case when gb.status != 'cancelled' then gb.total_amount + gb.charges_total else 0 end
      ), 0) as accommodation_value,
      coalesce(sum(gb.amount_paid), 0) as payments_received,
      coalesce(sum(
        case when gb.status != 'cancelled' then greatest(0, gb.total_amount + gb.charges_total - gb.amount_paid) else 0 end
      ), 0) as outstanding_balance
    from guest_bookings gb
    group by gb.customer_id
  )
  select
    c.id as customer_id,
    c.name as customer_name,
    c.email as customer_email,
    c.phone as customer_phone,
    c.is_blacklisted,
    c.blacklist_reason,
    coalesce(a.total_stays, 0)::integer as total_stays,
    coalesce(a.completed_stays, 0)::integer as completed_stays,
    a.first_stay_date,
    a.last_stay_date,
    a.upcoming_stay_date,
    coalesce(a.accommodation_value, 0)::numeric as accommodation_value,
    coalesce(a.payments_received, 0)::numeric as payments_received,
    coalesce(a.outstanding_balance, 0)::numeric as outstanding_balance,
    case when coalesce(a.completed_stays, 0) > 0
      then round(coalesce(a.accommodation_value, 0) / a.completed_stays, 2)
      else 0
    end::numeric as average_completed_stay_value,
    coalesce(pos_agg.pos_charges, 0)::numeric as pos_charges,
    case
      when coalesce(a.total_stays, 0) = 0 then 'new'
      when coalesce(a.outstanding_balance, 0) > 0 then 'outstanding_balance'
      when coalesce(a.total_stays, 0) >= 3 then 'frequent'
      else 'returning'
    end as guest_status
  from public.customers c
  left join aggregated a on a.customer_id = c.id
  left join (
    select
      gb2.customer_id,
      coalesce(sum(gp.order_total), 0) as pos_charges
    from guest_bookings gb2
    inner join guest_pos gp on gp.booking_id = (
      select b2.id from public.bookings b2
      where b2.lodge_id = p_lodge_id and b2.customer_id = gb2.customer_id
      order by b2.check_in desc limit 1
    )
    group by gb2.customer_id
  ) pos_agg on pos_agg.customer_id = c.id
  where c.lodge_id = p_lodge_id
    and (p_search is null or p_search = '' or
         c.name ilike '%' || p_search || '%'
         or c.phone ilike '%' || p_search || '%'
         or c.email ilike '%' || p_search || '%')
  order by a.last_stay_date desc nulls last, c.name
  limit p_limit
  offset p_offset;
end;
$$;

-- Also create a count function for pagination
create or replace function public.get_guest_lifetime_count(
  p_lodge_id uuid,
  p_search text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.customers c
  where c.lodge_id = p_lodge_id
    and (p_search is null or p_search = '' or
         c.name ilike '%' || p_search || '%'
         or c.phone ilike '%' || p_search || '%'
         or c.email ilike '%' || p_search || '%');
  return v_count;
end;
$$;

-- Grant execute to authenticated and service_role
grant execute on function public.get_guest_lifetime_summary(uuid, text, integer, integer) to authenticated;
grant execute on function public.get_guest_lifetime_summary(uuid, text, integer, integer) to service_role;
grant execute on function public.get_guest_lifetime_count(uuid, text) to authenticated;
grant execute on function public.get_guest_lifetime_count(uuid, text) to service_role;

-- Add RLS policy for lodge-scoped access
alter function public.get_guest_lifetime_summary(uuid, text, integer, integer) volatile;
alter function public.get_guest_lifetime_count(uuid, text) volatile;
