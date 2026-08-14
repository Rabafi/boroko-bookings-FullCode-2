-- Manager Bar POS report detail finality.
--
-- A payment_method label is not a payment allocation and quantity * price is
-- not a recorded line amount.  The Manager report must expose only persisted
-- tender and line evidence, and certify the period only when that evidence is
-- complete and reconciles to the authoritative order total.

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
  v_complete boolean;
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
    select po.*
      from public.pos_orders po
     where po.lodge_id = p_lodge_id
       and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
       and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  )
  select count(*) into v_unresolved_amounts
    from period_orders po
   where po.status in ('completed', 'settled')
     and (po.total is null or po.gross_total is null or po.discount_total is null or po.tax_total is null or po.tip_total is null);

  with period_orders as (
    select po.*
      from public.pos_orders po
     where po.lodge_id = p_lodge_id
       and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
       and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  )
  select count(*) into v_unresolved_tenders
    from period_orders po
   where po.status in ('completed', 'settled')
     and (
       jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(case when jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) = 'array' then po.payment_breakdown else '[]'::jsonb end) = 0
       or exists (
         select 1
           from jsonb_array_elements(case when jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) = 'array' then po.payment_breakdown else '[]'::jsonb end) x(value)
          where nullif(btrim(x.value->>'method'), '') is null
             or coalesce(x.value->>'amount', '') !~ '^[-+]?[0-9]+(\.[0-9]+)?$'
       )
       or abs(
         coalesce((
           select sum(case when x.value->>'amount' ~ '^[-+]?[0-9]+(\.[0-9]+)?$' then (x.value->>'amount')::numeric else 0 end)
             from jsonb_array_elements(case when jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) = 'array' then po.payment_breakdown else '[]'::jsonb end) x(value)
         ), 0) - po.total
       ) > 0.005
     );

  with period_orders as (
    select po.*
      from public.pos_orders po
     where po.lodge_id = p_lodge_id
       and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
       and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  )
  select count(*) into v_unresolved_items
    from period_orders po
   where po.status in ('completed', 'settled')
     and (
       not exists (select 1 from public.pos_order_items i where i.order_id = po.id)
       or exists (
         select 1
           from public.pos_order_items i
          where i.order_id = po.id
            and (
              i.gross_subtotal is null
              or (i.net_subtotal is null and i.subtotal is null)
            )
       )
     );

  v_complete := v_unresolved = 0
    and v_unresolved_amounts = 0
    and v_unresolved_tenders = 0
    and v_unresolved_items = 0;

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
  complete_item_orders as (
    select po.*
      from posted_orders po
     where exists (select 1 from public.pos_order_items i where i.order_id = po.id)
       and not exists (
         select 1 from public.pos_order_items i
          where i.order_id = po.id
            and (i.gross_subtotal is null or (i.net_subtotal is null and i.subtotal is null))
       )
  ),
  payment_rows as (
    select lower(btrim(payment.value->>'method')) as method,
           sum((payment.value->>'amount')::numeric) as amount
      from posted_orders po
      cross join lateral jsonb_array_elements(case when jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) = 'array' then po.payment_breakdown else '[]'::jsonb end) payment(value)
     where nullif(btrim(payment.value->>'method'), '') is not null
       and payment.value->>'amount' ~ '^[-+]?[0-9]+(\.[0-9]+)?$'
     group by lower(btrim(payment.value->>'method'))
  ),
  outlet_rows as (
    select po.outlet_id,
           coalesce(o.name, 'Unassigned') as outlet_name,
           count(*) filter (where coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0) as sale_count,
           count(*) filter (where coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0) as return_count,
           sum(po.total) as net_sales
      from posted_orders po left join public.outlets o on o.id = po.outlet_id
     group by po.outlet_id, coalesce(o.name, 'Unassigned')
  ),
  item_rows as (
    select coalesce(nullif(btrim(i.item_name), ''), 'Unknown item') as item_name,
           sum(i.quantity) as quantity,
           sum(coalesce(i.net_subtotal, i.subtotal)) as net_sales
      from complete_item_orders po join public.pos_order_items i on i.order_id = po.id
     group by coalesce(nullif(btrim(i.item_name), ''), 'Unknown item')
     order by sum(coalesce(i.net_subtotal, i.subtotal)) desc,
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
    'gross_sales', coalesce(sum(case when coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0 then po.gross_total else 0 end), 0),
    'discount_total', coalesce(sum(case when coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0 then po.discount_total else 0 end), 0),
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
    'source_coverage_complete', v_complete,
    'tender_breakdown_complete', v_unresolved_tenders = 0,
    'item_detail_complete', v_unresolved_items = 0,
    'complete', v_complete,
    'dataset_status', case when v_complete then 'certified' else 'incomplete' end,
    'financial_truth', case when v_complete then 'server_confirmed' else 'server_incomplete' end,
    'by_payment', case when v_unresolved_tenders = 0 then coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', amount) order by amount desc, method) from payment_rows), '[]'::jsonb) else '[]'::jsonb end,
    'by_outlet', coalesce((select jsonb_agg(jsonb_build_object('outlet_id', outlet_id, 'outlet_name', outlet_name, 'sale_count', sale_count, 'return_count', return_count, 'net_sales', net_sales) order by net_sales desc, outlet_name) from outlet_rows), '[]'::jsonb),
    'top_items', case when v_unresolved_items = 0 then coalesce((select jsonb_agg(jsonb_build_object('item_name', item_name, 'quantity', quantity, 'net_sales', net_sales) order by net_sales desc, item_name) from item_rows), '[]'::jsonb) else '[]'::jsonb end,
    'daily', coalesce((select jsonb_agg(jsonb_build_object('business_date', business_date, 'net_sales', net_sales, 'sale_count', sale_count, 'return_count', return_count) order by business_date) from daily_rows), '[]'::jsonb),
    'outlets', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type) order by o.sort_order, o.name) from public.outlets o where o.lodge_id = p_lodge_id and o.is_active = true), '[]'::jsonb)
  ) into v_summary
  from posted_orders po;

  return coalesce(v_summary, jsonb_build_object(
    'business_timezone', v_timezone,
    'complete', v_complete,
    'dataset_status', case when v_complete then 'certified' else 'incomplete' end,
    'source_coverage_complete', v_complete,
    'tender_breakdown_complete', v_unresolved_tenders = 0,
    'item_detail_complete', v_unresolved_items = 0,
    'unresolved_count', v_unresolved,
    'unresolved_amount_count', v_unresolved_amounts,
    'unresolved_tender_count', v_unresolved_tenders,
    'unresolved_item_count', v_unresolved_items,
    'by_payment', '[]'::jsonb,
    'by_outlet', '[]'::jsonb,
    'top_items', '[]'::jsonb,
    'daily', '[]'::jsonb,
    'outlets', '[]'::jsonb
  ));
end;
$$;

create or replace function public.get_manager_pos_transactions(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_id uuid default null,
  p_status text default 'posted',
  p_transaction_type text default 'all',
  p_search text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_timezone text;
  v_status text := lower(btrim(coalesce(p_status, 'posted')));
  v_transaction_type text := lower(btrim(coalesce(p_transaction_type, 'all')));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then raise exception 'A valid POS reporting range is required'; end if;
  if p_end_date - p_start_date > 366 then raise exception 'POS reporting range cannot exceed 367 days'; end if;
  if v_status not in ('all', 'posted', 'completed', 'settled', 'voided', 'open') then raise exception 'Invalid POS transaction status'; end if;
  if v_transaction_type not in ('all', 'sale', 'return') then raise exception 'Invalid POS transaction type'; end if;
  if p_outlet_id is not null and not exists (select 1 from public.outlets o where o.id = p_outlet_id and o.lodge_id = p_lodge_id) then raise exception 'Outlet not found' using errcode = 'P0002'; end if;
  select coalesce(nullif(btrim(s.timezone), ''), 'Africa/Gaborone') into v_timezone from public.settings s where s.lodge_id = p_lodge_id limit 1;
  v_timezone := coalesce(v_timezone, 'Africa/Gaborone');

  with filtered as (
    select po.*, o.name as outlet_name, r.room_number, c.name as guest_name,
           coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) as report_business_date
      from public.pos_orders po
      left join public.outlets o on o.id = po.outlet_id
      left join public.rooms r on r.id = po.room_id
      left join public.bookings b on b.id = po.booking_id
      left join public.customers c on c.id = b.customer_id
     where po.lodge_id = p_lodge_id
       and coalesce(po.business_date, (po.created_at at time zone v_timezone)::date) between p_start_date and p_end_date
       and (p_outlet_id is null or po.outlet_id = p_outlet_id)
       and (v_status = 'all' or (v_status = 'posted' and po.status in ('completed', 'settled')) or po.status = v_status)
       and (v_transaction_type = 'all' or (v_transaction_type = 'return' and (coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0)) or (v_transaction_type = 'sale' and coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0))
       and (v_search is null or po.receipt_number ilike '%' || v_search || '%' or po.id::text ilike '%' || v_search || '%' or coalesce(po.walk_in_name, '') ilike '%' || v_search || '%' or coalesce(po.cashier_name, '') ilike '%' || v_search || '%' or coalesce(po.table_name, '') ilike '%' || v_search || '%' or coalesce(po.tab_name, '') ilike '%' || v_search || '%' or coalesce(o.name, '') ilike '%' || v_search || '%' or coalesce(r.room_number, '') ilike '%' || v_search || '%' or coalesce(c.name, '') ilike '%' || v_search || '%' or exists (select 1 from public.pos_order_items search_item where search_item.order_id = po.id and search_item.item_name ilike '%' || v_search || '%'))
  ),
  page as (
    select * from filtered order by coalesce(completed_at, created_at) desc, id desc limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total_count', (select count(*) from filtered),
    'limit', v_limit,
    'offset', v_offset,
    'as_of', now(),
    'transactions', coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'receipt_number', p.receipt_number,
      'status', p.status,
      'transaction_type', case when coalesce(p.transaction_type, 'sale') = 'return' or p.total < 0 then 'return' else 'sale' end,
      'gross_total', p.gross_total,
      'discount_total', p.discount_total,
      'tax_total', p.tax_total,
      'tip_total', p.tip_total,
      'total', p.total,
      'payment_method', p.payment_method,
      'payment_breakdown', coalesce(p.payment_breakdown, '[]'::jsonb),
      'tender_detail_complete', (
        jsonb_typeof(coalesce(p.payment_breakdown, '[]'::jsonb)) = 'array'
        and jsonb_array_length(case when jsonb_typeof(coalesce(p.payment_breakdown, '[]'::jsonb)) = 'array' then p.payment_breakdown else '[]'::jsonb end) > 0
        and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(p.payment_breakdown, '[]'::jsonb)) = 'array' then p.payment_breakdown else '[]'::jsonb end) x(value) where nullif(btrim(x.value->>'method'), '') is null or coalesce(x.value->>'amount', '') !~ '^[-+]?[0-9]+(\.[0-9]+)?$')
        and abs(coalesce((select sum(case when x.value->>'amount' ~ '^[-+]?[0-9]+(\.[0-9]+)?$' then (x.value->>'amount')::numeric else 0 end) from jsonb_array_elements(case when jsonb_typeof(coalesce(p.payment_breakdown, '[]'::jsonb)) = 'array' then p.payment_breakdown else '[]'::jsonb end) x(value)), 0) - p.total) <= 0.005
      ),
      'item_detail_complete', (
        exists (select 1 from public.pos_order_items i where i.order_id = p.id)
        and not exists (select 1 from public.pos_order_items i where i.order_id = p.id and (i.gross_subtotal is null or (i.net_subtotal is null and i.subtotal is null)))
      ),
      'financial_complete', (
        p.status in ('completed', 'settled') and p.total is not null and p.gross_total is not null and p.discount_total is not null and p.tax_total is not null
        and p.tip_total is not null
        and jsonb_typeof(coalesce(p.payment_breakdown, '[]'::jsonb)) = 'array'
        and jsonb_array_length(case when jsonb_typeof(coalesce(p.payment_breakdown, '[]'::jsonb)) = 'array' then p.payment_breakdown else '[]'::jsonb end) > 0
        and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(coalesce(p.payment_breakdown, '[]'::jsonb)) = 'array' then p.payment_breakdown else '[]'::jsonb end) x(value) where nullif(btrim(x.value->>'method'), '') is null or coalesce(x.value->>'amount', '') !~ '^[-+]?[0-9]+(\.[0-9]+)?$')
        and abs(coalesce((select sum(case when x.value->>'amount' ~ '^[-+]?[0-9]+(\.[0-9]+)?$' then (x.value->>'amount')::numeric else 0 end) from jsonb_array_elements(case when jsonb_typeof(coalesce(p.payment_breakdown, '[]'::jsonb)) = 'array' then p.payment_breakdown else '[]'::jsonb end) x(value)), 0) - p.total) <= 0.005
        and exists (select 1 from public.pos_order_items i where i.order_id = p.id)
        and not exists (select 1 from public.pos_order_items i where i.order_id = p.id and (i.gross_subtotal is null or (i.net_subtotal is null and i.subtotal is null)))
      ),
      'outlet_id', p.outlet_id,
      'outlet_name', coalesce(p.outlet_name, 'Unassigned'),
      'cashier_name', coalesce(p.cashier_name, 'Unassigned'),
      'walk_in_name', p.walk_in_name,
      'guest_name', p.guest_name,
      'room_number', p.room_number,
      'service_mode', p.service_mode,
      'table_name', p.table_name,
      'tab_name', p.tab_name,
      'notes', p.notes,
      'business_date', p.report_business_date,
      'created_at', p.created_at,
      'completed_at', p.completed_at,
      'original_order_id', p.original_order_id,
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'item_name', i.item_name, 'category', i.category, 'quantity', i.quantity, 'unit_price', i.unit_price, 'gross_subtotal', i.gross_subtotal, 'discount_allocated', i.discount_allocated, 'tax_allocated', i.tax_allocated, 'net_subtotal', i.net_subtotal, 'modifiers', coalesce(i.modifiers, '[]'::jsonb), 'item_notes', i.item_notes) order by i.id) from public.pos_order_items i where i.order_id = p.id), '[]'::jsonb)
    ) order by coalesce(p.completed_at, p.created_at) desc, p.id desc), '[]'::jsonb)
  ) into v_result
  from page p;

  return coalesce(v_result, jsonb_build_object('total_count', 0, 'limit', v_limit, 'offset', v_offset, 'as_of', now(), 'transactions', '[]'::jsonb));
end;
$$;

revoke all on function public.get_manager_pos_snapshot(uuid, date, date, uuid) from public, anon;
grant execute on function public.get_manager_pos_snapshot(uuid, date, date, uuid) to authenticated, service_role;
revoke all on function public.get_manager_pos_transactions(uuid, date, date, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.get_manager_pos_transactions(uuid, date, date, uuid, text, text, text, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
