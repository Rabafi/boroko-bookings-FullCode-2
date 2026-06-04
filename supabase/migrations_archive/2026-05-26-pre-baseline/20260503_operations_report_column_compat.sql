begin;

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
      ip.date::timestamptz as purchased_at,
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
      sp.date::timestamptz as purchased_at,
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

grant execute on function public.get_inventory_spend_summary(uuid, date, date, text) to anon, authenticated, service_role;
grant execute on function public.get_supply_spend_summary(uuid, date, date) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
