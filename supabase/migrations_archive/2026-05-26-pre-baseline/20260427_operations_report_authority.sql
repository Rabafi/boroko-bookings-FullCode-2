begin;

create or replace function public.get_pos_sales_summary(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_selector text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_total_revenue numeric := 0;
  v_folio_revenue numeric := 0;
  v_total_orders integer := 0;
  v_avg_order numeric := 0;
  v_by_payment jsonb := '{}'::jsonb;
  v_top_items jsonb := '[]'::jsonb;
  v_daily jsonb := '[]'::jsonb;
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

  with filtered_orders as (
    select po.*
    from public.pos_orders po
    where po.lodge_id = p_lodge_id
      and po.status = 'completed'
      and po.created_at >= p_start_date::timestamptz
      and po.created_at < (p_end_date + 1)::timestamptz
      and (
        coalesce(p_outlet_selector, 'all') = 'all'
        or (p_outlet_selector = 'unassigned' and po.outlet_id is null)
        or po.outlet_id::text = p_outlet_selector
      )
  ),
  payment_rows as (
    select
      coalesce(nullif(trim(payment_method), ''), 'cash') as method,
      sum(total) as total
    from filtered_orders
    group by coalesce(nullif(trim(payment_method), ''), 'cash')
  ),
  daily_rows as (
    select
      to_char(created_at::date, 'YYYY-MM-DD') as date,
      sum(total) as total
    from filtered_orders
    group by created_at::date
    order by created_at::date
  ),
  item_rows as (
    select
      coalesce(ii.name, pmi.name, poi.item_name, 'Unknown item') as item_name,
      sum(coalesce(poi.quantity, 0) * coalesce(pmi.template_pack_size, pmi.depletion_qty, 1, 1)) as qty,
      sum(coalesce(poi.subtotal, 0)) as revenue
    from filtered_orders fo
    join public.pos_order_items poi
      on poi.order_id = fo.id
    left join public.pos_menu_items pmi
      on pmi.id = poi.menu_item_id
    left join public.inventory_items ii
      on ii.id = pmi.inventory_item_id
    group by coalesce(ii.name, pmi.name, poi.item_name, 'Unknown item')
    order by sum(coalesce(poi.subtotal, 0)) desc, coalesce(ii.name, pmi.name, poi.item_name, 'Unknown item') asc
    limit 15
  )
  select
    coalesce(sum(total), 0),
    coalesce(sum(case when coalesce(payment_method, '') = 'folio' then total else 0 end), 0),
    count(*),
    coalesce((select jsonb_object_agg(method, total) from payment_rows), '{}'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('name', item_name, 'qty', qty, 'revenue', revenue) order by revenue desc, item_name asc) from item_rows), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('date', date, 'total', total) order by date asc) from daily_rows), '[]'::jsonb)
    into v_total_revenue,
         v_folio_revenue,
         v_total_orders,
         v_by_payment,
         v_top_items,
         v_daily
  from filtered_orders;

  if v_total_orders > 0 then
    v_avg_order := v_total_revenue / v_total_orders;
  end if;

  return jsonb_build_object(
    'total_revenue', coalesce(v_total_revenue, 0),
    'folio_revenue', coalesce(v_folio_revenue, 0),
    'direct_revenue', coalesce(v_total_revenue, 0) - coalesce(v_folio_revenue, 0),
    'total_orders', coalesce(v_total_orders, 0),
    'avg_order', coalesce(v_avg_order, 0),
    'by_payment', coalesce(v_by_payment, '{}'::jsonb),
    'top_items', coalesce(v_top_items, '[]'::jsonb),
    'daily', coalesce(v_daily, '[]'::jsonb)
  );
end;
$function$;

create or replace function public.get_inventory_spend_summary(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_selector text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_total numeric := 0;
  v_by_category jsonb := '{}'::jsonb;
  v_purchases jsonb := '[]'::jsonb;
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

  with filtered as (
    select
      ip.id,
      ip.date,
      ip.purchased_at,
      ip.item_id,
      ip.quantity_purchased,
      ip.unit_cost,
      ip.total_cost,
      ip.notes,
      ii.name as item_name,
      ii.category,
      ii.outlet_id
    from public.inventory_purchases ip
    left join public.inventory_items ii
      on ii.id = ip.item_id
    where ip.lodge_id = p_lodge_id
      and ip.date >= p_start_date
      and ip.date <= p_end_date
      and (
        coalesce(p_outlet_selector, 'all') = 'all'
        or (p_outlet_selector = 'unassigned' and ii.outlet_id is null)
        or ii.outlet_id::text = p_outlet_selector
      )
  ),
  category_rows as (
    select
      coalesce(nullif(trim(category), ''), 'Uncategorised') as category,
      sum(total_cost) as total
    from filtered
    group by coalesce(nullif(trim(category), ''), 'Uncategorised')
  )
  select
    coalesce(sum(total_cost), 0),
    coalesce((select jsonb_object_agg(category, total) from category_rows), '{}'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'date', date,
      'purchased_at', purchased_at,
      'item_id', item_id,
      'quantity_purchased', quantity_purchased,
      'unit_cost', unit_cost,
      'total_cost', total_cost,
      'notes', notes,
      'inventory_items', jsonb_build_object(
        'name', item_name,
        'category', category,
        'outlet_id', outlet_id
      )
    ) order by date desc, purchased_at desc, id desc), '[]'::jsonb)
    into v_total, v_by_category, v_purchases
  from filtered;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'by_category', coalesce(v_by_category, '{}'::jsonb),
    'purchases', coalesce(v_purchases, '[]'::jsonb)
  );
end;
$function$;

create or replace function public.get_supply_spend_summary(
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
  v_total numeric := 0;
  v_purchases jsonb := '[]'::jsonb;
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

  with filtered as (
    select
      sp.id,
      sp.date,
      sp.purchased_at,
      sp.item_id,
      sp.quantity_purchased,
      sp.unit_cost,
      sp.total_cost,
      sp.notes,
      si.name as item_name
    from public.supply_purchases sp
    left join public.supply_items si
      on si.id = sp.item_id
    where sp.lodge_id = p_lodge_id
      and sp.date >= p_start_date
      and sp.date <= p_end_date
  )
  select
    coalesce(sum(total_cost), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'date', date,
      'purchased_at', purchased_at,
      'item_id', item_id,
      'quantity_purchased', quantity_purchased,
      'unit_cost', unit_cost,
      'total_cost', total_cost,
      'notes', notes,
      'supply_items', jsonb_build_object('name', item_name)
    ) order by date desc, purchased_at desc, id desc), '[]'::jsonb)
    into v_total, v_purchases
  from filtered;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'purchases', coalesce(v_purchases, '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_pos_sales_summary(uuid, date, date, text) from public, anon;
grant execute on function public.get_pos_sales_summary(uuid, date, date, text) to authenticated, service_role;

revoke all on function public.get_inventory_spend_summary(uuid, date, date, text) from public, anon;
grant execute on function public.get_inventory_spend_summary(uuid, date, date, text) to authenticated, service_role;

revoke all on function public.get_supply_spend_summary(uuid, date, date) from public, anon;
grant execute on function public.get_supply_spend_summary(uuid, date, date) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
