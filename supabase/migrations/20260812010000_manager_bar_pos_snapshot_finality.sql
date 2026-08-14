-- Bar/Manager POS snapshot finality.
-- The original Manager snapshot returned financial-looking numbers without a
-- completeness contract and hard-coded UTC-adjacent business dates.  This
-- replacement derives the operating timezone from settings and refuses to
-- certify a period containing unresolved financial rows.

begin;

create or replace function public.get_manager_pos_snapshot(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_timezone text;
  v_unresolved integer := 0;
  v_unresolved_tenders integer := 0;
  v_unresolved_items integer := 0;
  v_unresolved_amounts integer := 0;
  v_summary jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'A valid POS reporting range is required';
  end if;
  if p_end_date - p_start_date > 366 then
    raise exception 'POS reporting range cannot exceed 367 days';
  end if;
  if p_outlet_id is not null and not exists (
    select 1 from public.outlets o where o.id = p_outlet_id and o.lodge_id = p_lodge_id
  ) then
    raise exception 'Outlet not found' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(s.timezone), ''), 'Africa/Gaborone')
    into v_timezone
    from public.settings s
   where s.lodge_id = p_lodge_id
   limit 1;
  v_timezone := coalesce(v_timezone, 'Africa/Gaborone');
  with period_orders as (
    select po.*
      from public.pos_orders po
     where po.lodge_id = p_lodge_id
       and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
       and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  )
  select count(*) into v_unresolved
    from period_orders po
   where lower(coalesce(po.status, '')) not in ('completed', 'settled', 'voided', 'cancelled');

  with period_orders as (
    select po.* from public.pos_orders po
    where po.lodge_id = p_lodge_id
      and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
      and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  )
  select count(*) into v_unresolved_amounts from period_orders po
  where po.status in ('completed', 'settled')
    and (po.total is null or po.gross_total is null or po.discount_total is null or po.tax_total is null or po.tip_total is null);

  with period_orders as (
    select po.* from public.pos_orders po
    where po.lodge_id = p_lodge_id
      and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
      and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  )
  select count(*) into v_unresolved_tenders from period_orders po
  where po.status in ('completed', 'settled')
    and (jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) <> 'array'
      or jsonb_array_length(case when jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) = 'array' then po.payment_breakdown else '[]'::jsonb end) = 0
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) = 'array' then po.payment_breakdown else '[]'::jsonb end) x(value)
        where nullif(btrim(x.value->>'method'), '') is null or coalesce(x.value->>'amount', '') !~ '^[-+]?[0-9]+(\.[0-9]+)?$')
      or abs(coalesce((select sum(case when x.value->>'amount' ~ '^[-+]?[0-9]+(\.[0-9]+)?$' then (x.value->>'amount')::numeric else 0 end) from jsonb_array_elements(case when jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) = 'array' then po.payment_breakdown else '[]'::jsonb end) x(value)), 0) - po.total) > 0.005);

  with period_orders as (
    select po.* from public.pos_orders po
    where po.lodge_id = p_lodge_id
      and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
      and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  )
  select count(*) into v_unresolved_items from period_orders po
  where po.status in ('completed', 'settled')
    and (not exists (select 1 from public.pos_order_items i where i.order_id = po.id)
      or exists (select 1 from public.pos_order_items i where i.order_id = po.id and (i.gross_subtotal is null or (i.net_subtotal is null and i.subtotal is null))));

  v_unresolved := v_unresolved + v_unresolved_amounts + v_unresolved_tenders + v_unresolved_items;

  with period_orders as (
    select po.*
      from public.pos_orders po
     where po.lodge_id = p_lodge_id
       and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
       and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  ),
  posted_orders as (
    select po.* from period_orders po where po.status in ('completed', 'settled')
  ),
  payment_rows as (
    select lower(coalesce(nullif(btrim(payment.value->>'method'), ''), nullif(btrim(po.payment_method), ''), 'cash')) as method,
           sum(case when nullif(payment.value->>'amount', '') is not null then (payment.value->>'amount')::numeric else po.total end) as amount
      from posted_orders po
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) = 'array'
                  and jsonb_array_length(coalesce(po.payment_breakdown, '[]'::jsonb)) > 0
             then po.payment_breakdown
             else jsonb_build_array(jsonb_build_object('method', coalesce(nullif(btrim(po.payment_method), ''), 'cash'), 'amount', po.total))
        end
      ) payment(value)
     group by lower(coalesce(nullif(btrim(payment.value->>'method'), ''), nullif(btrim(po.payment_method), ''), 'cash'))
  ),
  outlet_rows as (
    select po.outlet_id, coalesce(o.name, 'Unassigned') as outlet_name,
           count(*) filter (where coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0) as sale_count,
           count(*) filter (where coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0) as return_count,
           sum(po.total) as net_sales
      from posted_orders po left join public.outlets o on o.id = po.outlet_id
     group by po.outlet_id, coalesce(o.name, 'Unassigned')
  ),
  item_rows as (
    select coalesce(nullif(btrim(i.item_name), ''), 'Unknown item') as item_name,
           sum(i.quantity) as quantity,
           sum(coalesce(nullif(i.net_subtotal, 0), i.subtotal, 0)) as net_sales
      from posted_orders po join public.pos_order_items i on i.order_id = po.id
     group by coalesce(nullif(btrim(i.item_name), ''), 'Unknown item')
     order by sum(coalesce(nullif(i.net_subtotal, 0), i.subtotal, 0)) desc,
              coalesce(nullif(btrim(i.item_name), ''), 'Unknown item')
     limit 10
  ),
  daily_rows as (
    select to_char(coalesce(po.business_date, (po.created_at at time zone v_timezone)::date), 'YYYY-MM-DD') as business_date,
           sum(po.total) as net_sales,
           count(*) filter (where coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0) as sale_count,
           count(*) filter (where coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0) as return_count
      from posted_orders po
     group by coalesce(po.business_date, (po.created_at at time zone v_timezone)::date)
     order by coalesce(po.business_date, (po.created_at at time zone v_timezone)::date)
  )
  select jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'outlet_id', p_outlet_id,
    'business_timezone', v_timezone,
    'as_of', now(),
    'gross_sales', coalesce(sum(case when coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0 then coalesce(nullif(po.gross_total, 0), po.total) else 0 end), 0),
    'discount_total', coalesce(sum(case when coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0 then coalesce(po.discount_total, 0) else 0 end), 0),
    'tax_total', coalesce(sum(po.tax_total), 0),
    'tip_total', coalesce(sum(po.tip_total), 0),
    'returns_total', coalesce(sum(case when coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0 then abs(po.total) else 0 end), 0),
    'net_sales', coalesce(sum(po.total), 0),
    'sale_count', count(*) filter (where coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0),
    'return_count', count(*) filter (where coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0),
    'average_sale', coalesce(sum(case when coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0 then po.total else 0 end) / nullif(count(*) filter (where coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0), 0), 0),
    'void_count', (select count(*) from period_orders v where v.status = 'voided'),
    'open_count', (select count(*) from period_orders v where v.status = 'open'),
    'unresolved_count', v_unresolved,
    'unresolved_amount_count', v_unresolved_amounts,
    'unresolved_tender_count', v_unresolved_tenders,
    'unresolved_item_count', v_unresolved_items,
    'source_coverage_complete', v_unresolved = 0,
    'complete', v_unresolved = 0,
    'dataset_status', case when v_unresolved = 0 then 'certified' else 'incomplete' end,
    'financial_truth', case when v_unresolved = 0 then 'server_confirmed' else 'server_incomplete' end,
    'by_payment', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', amount) order by amount desc, method) from payment_rows), '[]'::jsonb),
    'by_outlet', coalesce((select jsonb_agg(jsonb_build_object('outlet_id', outlet_id, 'outlet_name', outlet_name, 'sale_count', sale_count, 'return_count', return_count, 'net_sales', net_sales) order by net_sales desc, outlet_name) from outlet_rows), '[]'::jsonb),
    'top_items', coalesce((select jsonb_agg(jsonb_build_object('item_name', item_name, 'quantity', quantity, 'net_sales', net_sales) order by net_sales desc, item_name) from item_rows), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('business_date', business_date, 'net_sales', net_sales, 'sale_count', sale_count, 'return_count', return_count) order by business_date) from daily_rows), '[]'::jsonb),
    'outlets', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type) order by o.sort_order, o.name) from public.outlets o where o.lodge_id = p_lodge_id and o.is_active = true), '[]'::jsonb)
  ) into v_summary
  from posted_orders po;

  return coalesce(v_summary, jsonb_build_object(
    'business_timezone', v_timezone,
    'complete', v_unresolved = 0,
    'dataset_status', case when v_unresolved = 0 then 'certified' else 'incomplete' end,
    'source_coverage_complete', v_unresolved = 0,
    'unresolved_count', v_unresolved,
    'by_payment', '[]'::jsonb,
    'by_outlet', '[]'::jsonb,
    'top_items', '[]'::jsonb,
    'daily', '[]'::jsonb,
    'outlets', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_manager_pos_snapshot(uuid, date, date, uuid) from public, anon;
grant execute on function public.get_manager_pos_snapshot(uuid, date, date, uuid) to authenticated, service_role;

commit;
