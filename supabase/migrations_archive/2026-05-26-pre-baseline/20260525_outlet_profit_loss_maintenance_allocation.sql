begin;

create or replace function public.get_outlet_profit_loss_summary(
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
  v_booking_summary jsonb := '{}'::jsonb;
  v_booking_revenue numeric := 0;
  v_folio_pos_revenue numeric := 0;
  v_conference_revenue numeric := 0;
  v_pool_revenue numeric := 0;
  v_supply_cost numeric := 0;
  v_outlets jsonb := '[]'::jsonb;
  v_combined jsonb := '{}'::jsonb;
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

  v_booking_summary := public.get_revenue_report(p_lodge_id, p_start_date, p_end_date);
  v_booking_revenue := coalesce((v_booking_summary ->> 'total_revenue')::numeric, 0);

  select coalesce(sum(po.total), 0)
    into v_folio_pos_revenue
  from public.pos_orders po
  where po.lodge_id = p_lodge_id
    and po.status = 'completed'
    and coalesce(po.payment_method, '') = 'folio'
    and po.created_at >= p_start_date::timestamptz
    and po.created_at < (p_end_date + 1)::timestamptz;

  select coalesce(sum(cb.total_amount), 0)
    into v_conference_revenue
  from public.conference_bookings cb
  where cb.lodge_id = p_lodge_id
    and cb.booking_date >= p_start_date
    and cb.booking_date <= p_end_date
    and lower(coalesce(cb.payment_status, '')) <> 'cancelled';

  select coalesce(sum(pdu.total), 0)
    into v_pool_revenue
  from public.pool_day_use pdu
  where pdu.lodge_id = p_lodge_id
    and pdu.date >= p_start_date
    and pdu.date <= p_end_date;

  select coalesce(sum(sp.total_cost), 0)
    into v_supply_cost
  from public.supply_purchases sp
  where sp.lodge_id = p_lodge_id
    and sp.date >= p_start_date
    and sp.date <= p_end_date;

  with bucket_seed as (
    select *
    from (
      values
        ('kitchen'::text, 'Kitchen'::text),
        ('bar'::text, 'Bar'::text),
        ('front_desk'::text, 'Front Desk'::text),
        ('unassigned'::text, 'Unassigned'::text)
    ) as s(bucket_key, bucket_name)
  ),
  outlet_map as (
    select
      o.id,
      case
        when lower(coalesce(o.type, '')) = 'food' then 'kitchen'
        when lower(coalesce(o.type, '')) = 'beverage' then 'bar'
        when lower(coalesce(o.type, '')) in ('front_desk', 'accommodation') then 'front_desk'
        else 'unassigned'
      end as bucket_key
    from public.outlets o
    where o.lodge_id = p_lodge_id
  ),
  pos_by_bucket as (
    select
      coalesce(om.bucket_key, 'unassigned') as bucket_key,
      coalesce(sum(po.total), 0) as pos_revenue
    from public.pos_orders po
    left join outlet_map om
      on om.id = po.outlet_id
    where po.lodge_id = p_lodge_id
      and po.status = 'completed'
      and po.created_at >= p_start_date::timestamptz
      and po.created_at < (p_end_date + 1)::timestamptz
    group by coalesce(om.bucket_key, 'unassigned')
  ),
  inventory_by_bucket as (
    select
      coalesce(om.bucket_key, 'unassigned') as bucket_key,
      coalesce(sum(ip.total_cost), 0) as inventory_cost
    from public.inventory_purchases ip
    left join public.inventory_items ii
      on ii.id = ip.item_id
    left join outlet_map om
      on om.id = ii.outlet_id
    where ip.lodge_id = p_lodge_id
      and ip.date >= p_start_date
      and ip.date <= p_end_date
    group by coalesce(om.bucket_key, 'unassigned')
  ),
  expenses_by_bucket as (
    select
      coalesce(om.bucket_key, 'unassigned') as bucket_key,
      coalesce(sum(e.amount), 0) as expenses
    from public.expenses e
    left join outlet_map om
      on om.id = e.outlet_id
    where e.lodge_id = p_lodge_id
      and e.date >= p_start_date
      and e.date <= p_end_date
    group by coalesce(om.bucket_key, 'unassigned')
  ),
  maintenance_by_bucket as (
    select
      case
        when mt.room_id is not null then 'front_desk'
        else 'unassigned'
      end as bucket_key,
      coalesce(sum(coalesce(mt.total_cost, 0)), 0) as maintenance_cost
    from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id
      and mt.reported_date >= p_start_date
      and mt.reported_date <= p_end_date
    group by case
      when mt.room_id is not null then 'front_desk'
      else 'unassigned'
    end
  ),
  rows as (
    select
      s.bucket_key as key,
      s.bucket_name as name,
      coalesce(pb.pos_revenue, 0) as pos_revenue,
      case
        when s.bucket_key = 'front_desk'
          then greatest(0, v_booking_revenue - v_folio_pos_revenue) + v_conference_revenue + v_pool_revenue
        else 0
      end as booking_revenue,
      coalesce(ib.inventory_cost, 0) as inventory_cost,
      case when s.bucket_key = 'front_desk' then v_supply_cost else 0 end as supply_cost,
      coalesce(mb.maintenance_cost, 0) as maintenance_cost,
      coalesce(eb.expenses, 0) as expenses
    from bucket_seed s
    left join pos_by_bucket pb
      on pb.bucket_key = s.bucket_key
    left join inventory_by_bucket ib
      on ib.bucket_key = s.bucket_key
    left join maintenance_by_bucket mb
      on mb.bucket_key = s.bucket_key
    left join expenses_by_bucket eb
      on eb.bucket_key = s.bucket_key
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'key', key,
      'name', name,
      'posRevenue', pos_revenue,
      'bookingRevenue', booking_revenue,
      'revenue', pos_revenue + booking_revenue,
      'inventoryCost', inventory_cost,
      'supplyCost', supply_cost,
      'maintenanceCost', maintenance_cost,
      'expenses', expenses,
      'profit', (pos_revenue + booking_revenue) - inventory_cost - supply_cost - maintenance_cost - expenses
    ) order by case key when 'kitchen' then 1 when 'bar' then 2 when 'front_desk' then 3 else 4 end), '[]'::jsonb),
    jsonb_build_object(
      'posRevenue', coalesce(sum(pos_revenue), 0),
      'bookingRevenue', coalesce(sum(booking_revenue), 0),
      'revenue', coalesce(sum(pos_revenue + booking_revenue), 0),
      'inventoryCost', coalesce(sum(inventory_cost), 0),
      'supplyCost', coalesce(sum(supply_cost), 0),
      'maintenanceCost', coalesce(sum(maintenance_cost), 0),
      'expenses', coalesce(sum(expenses), 0),
      'profit', coalesce(sum((pos_revenue + booking_revenue) - inventory_cost - supply_cost - maintenance_cost - expenses), 0)
    )
    into v_outlets, v_combined
  from rows;

  return jsonb_build_object(
    'outlets', coalesce(v_outlets, '[]'::jsonb),
    'combined', coalesce(v_combined, '{}'::jsonb)
  );
end;
$function$;

revoke all on function public.get_outlet_profit_loss_summary(uuid, date, date) from public, anon;
grant execute on function public.get_outlet_profit_loss_summary(uuid, date, date) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
