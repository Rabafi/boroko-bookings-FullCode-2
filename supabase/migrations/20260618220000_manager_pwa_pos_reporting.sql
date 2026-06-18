-- Read-only, server-authoritative POS reporting for the Manager PWA.
--
-- The PWA must never rebuild financial truth from several client-side reads.
-- These RPCs calculate snapshot totals and transaction detail inside PostgreSQL
-- from the same order rows used by the desktop POS.

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
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_summary jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;
  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;
  if p_end_date - p_start_date > 366 then
    raise exception 'POS reporting range cannot exceed 367 days';
  end if;

  if p_outlet_id is not null and not exists (
    select 1
      from public.outlets o
     where o.id = p_outlet_id
       and o.lodge_id = p_lodge_id
  ) then
    raise exception 'Outlet not found' using errcode = 'P0002';
  end if;

  v_start_at := p_start_date::timestamp at time zone 'Africa/Gaborone';
  v_end_at := (p_end_date + 1)::timestamp at time zone 'Africa/Gaborone';

  with period_orders as (
    select po.*
      from public.pos_orders po
     where po.lodge_id = p_lodge_id
       and po.created_at >= v_start_at
       and po.created_at < v_end_at
       and (p_outlet_id is null or po.outlet_id = p_outlet_id)
  ),
  posted_orders as (
    select po.*
      from period_orders po
     where po.status in ('completed', 'settled')
  ),
  payment_rows as (
    select
      lower(coalesce(nullif(btrim(payment.value->>'method'), ''), nullif(btrim(po.payment_method), ''), 'cash')) as method,
      sum(
        case
          when nullif(payment.value->>'amount', '') is not null
            then (payment.value->>'amount')::numeric
          else po.total
        end
      ) as amount
    from posted_orders po
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(coalesce(po.payment_breakdown, '[]'::jsonb)) = 'array'
         and jsonb_array_length(coalesce(po.payment_breakdown, '[]'::jsonb)) > 0
          then po.payment_breakdown
        else jsonb_build_array(jsonb_build_object(
          'method', coalesce(nullif(btrim(po.payment_method), ''), 'cash'),
          'amount', po.total
        ))
      end
    ) payment(value)
    group by lower(coalesce(nullif(btrim(payment.value->>'method'), ''), nullif(btrim(po.payment_method), ''), 'cash'))
  ),
  outlet_rows as (
    select
      po.outlet_id,
      coalesce(o.name, 'Unassigned') as outlet_name,
      count(*) filter (
        where coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0
      ) as sale_count,
      count(*) filter (
        where coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0
      ) as return_count,
      sum(po.total) as net_sales
    from posted_orders po
    left join public.outlets o on o.id = po.outlet_id
    group by po.outlet_id, coalesce(o.name, 'Unassigned')
  ),
  item_rows as (
    select
      coalesce(nullif(btrim(i.item_name), ''), 'Unknown item') as item_name,
      sum(i.quantity) as quantity,
      sum(coalesce(nullif(i.net_subtotal, 0), i.subtotal, 0)) as net_sales
    from posted_orders po
    join public.pos_order_items i on i.order_id = po.id
    group by coalesce(nullif(btrim(i.item_name), ''), 'Unknown item')
    order by sum(coalesce(nullif(i.net_subtotal, 0), i.subtotal, 0)) desc,
             coalesce(nullif(btrim(i.item_name), ''), 'Unknown item')
    limit 10
  ),
  daily_rows as (
    select
      to_char((po.created_at at time zone 'Africa/Gaborone')::date, 'YYYY-MM-DD') as business_date,
      sum(po.total) as net_sales,
      count(*) filter (
        where coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0
      ) as sale_count,
      count(*) filter (
        where coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0
      ) as return_count
    from posted_orders po
    group by (po.created_at at time zone 'Africa/Gaborone')::date
    order by (po.created_at at time zone 'Africa/Gaborone')::date
  )
  select jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'outlet_id', p_outlet_id,
    'as_of', now(),
    'gross_sales', coalesce(sum(
      case
        when coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0
          then coalesce(nullif(po.gross_total, 0), po.total)
        else 0
      end
    ), 0),
    'discount_total', coalesce(sum(
      case
        when coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0
          then coalesce(po.discount_total, 0)
        else 0
      end
    ), 0),
    'tax_total', coalesce(sum(po.tax_total), 0),
    'tip_total', coalesce(sum(po.tip_total), 0),
    'returns_total', coalesce(sum(
      case
        when coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0
          then abs(po.total)
        else 0
      end
    ), 0),
    'net_sales', coalesce(sum(po.total), 0),
    'sale_count', count(*) filter (
      where coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0
    ),
    'return_count', count(*) filter (
      where coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0
    ),
    'average_sale', coalesce(
      sum(case
        when coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0 then po.total
        else 0
      end)
      / nullif(count(*) filter (
        where coalesce(po.transaction_type, 'sale') = 'sale' and po.total >= 0
      ), 0),
      0
    ),
    'void_count', (select count(*) from period_orders v where v.status = 'voided'),
    'open_count', (select count(*) from period_orders v where v.status = 'open'),
    'by_payment', coalesce(
      (select jsonb_agg(
        jsonb_build_object('method', method, 'amount', amount)
        order by amount desc, method
      ) from payment_rows),
      '[]'::jsonb
    ),
    'by_outlet', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'outlet_id', outlet_id,
          'outlet_name', outlet_name,
          'sale_count', sale_count,
          'return_count', return_count,
          'net_sales', net_sales
        )
        order by net_sales desc, outlet_name
      ) from outlet_rows),
      '[]'::jsonb
    ),
    'top_items', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'item_name', item_name,
          'quantity', quantity,
          'net_sales', net_sales
        )
        order by net_sales desc, item_name
      ) from item_rows),
      '[]'::jsonb
    ),
    'daily', coalesce(
      (select jsonb_agg(
        jsonb_build_object(
          'date', business_date,
          'net_sales', net_sales,
          'sale_count', sale_count,
          'return_count', return_count
        )
        order by business_date
      ) from daily_rows),
      '[]'::jsonb
    ),
    'outlets', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type)
          order by o.sort_order, o.name
        )
          from public.outlets o
         where o.lodge_id = p_lodge_id
           and o.is_active = true
      ),
      '[]'::jsonb
    )
  )
    into v_summary
    from posted_orders po;

  return coalesce(v_summary, '{}'::jsonb);
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
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_status text := lower(btrim(coalesce(p_status, 'posted')));
  v_transaction_type text := lower(btrim(coalesce(p_transaction_type, 'all')));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'A valid POS reporting range is required';
  end if;
  if p_end_date - p_start_date > 366 then
    raise exception 'POS reporting range cannot exceed 367 days';
  end if;
  if v_status not in ('all', 'posted', 'completed', 'settled', 'voided', 'open') then
    raise exception 'Invalid POS transaction status';
  end if;
  if v_transaction_type not in ('all', 'sale', 'return') then
    raise exception 'Invalid POS transaction type';
  end if;
  if p_outlet_id is not null and not exists (
    select 1 from public.outlets o
     where o.id = p_outlet_id and o.lodge_id = p_lodge_id
  ) then
    raise exception 'Outlet not found' using errcode = 'P0002';
  end if;

  v_start_at := p_start_date::timestamp at time zone 'Africa/Gaborone';
  v_end_at := (p_end_date + 1)::timestamp at time zone 'Africa/Gaborone';

  with filtered as (
    select
      po.*,
      o.name as outlet_name,
      r.room_number,
      c.name as guest_name
    from public.pos_orders po
    left join public.outlets o on o.id = po.outlet_id
    left join public.rooms r on r.id = po.room_id
    left join public.bookings b on b.id = po.booking_id
    left join public.customers c on c.id = b.customer_id
    where po.lodge_id = p_lodge_id
      and po.created_at >= v_start_at
      and po.created_at < v_end_at
      and (p_outlet_id is null or po.outlet_id = p_outlet_id)
      and (
        v_status = 'all'
        or (v_status = 'posted' and po.status in ('completed', 'settled'))
        or po.status = v_status
      )
      and (
        v_transaction_type = 'all'
        or (
          v_transaction_type = 'return'
          and (coalesce(po.transaction_type, 'sale') = 'return' or po.total < 0)
        )
        or (
          v_transaction_type = 'sale'
          and coalesce(po.transaction_type, 'sale') = 'sale'
          and po.total >= 0
        )
      )
      and (
        v_search is null
        or po.receipt_number ilike '%' || v_search || '%'
        or po.id::text ilike '%' || v_search || '%'
        or coalesce(po.walk_in_name, '') ilike '%' || v_search || '%'
        or coalesce(po.cashier_name, '') ilike '%' || v_search || '%'
        or coalesce(po.table_name, '') ilike '%' || v_search || '%'
        or coalesce(po.tab_name, '') ilike '%' || v_search || '%'
        or coalesce(o.name, '') ilike '%' || v_search || '%'
        or coalesce(r.room_number, '') ilike '%' || v_search || '%'
        or coalesce(c.name, '') ilike '%' || v_search || '%'
        or exists (
          select 1
            from public.pos_order_items search_item
           where search_item.order_id = po.id
             and search_item.item_name ilike '%' || v_search || '%'
        )
      )
  ),
  page as (
    select *
      from filtered
     order by coalesce(completed_at, created_at) desc, id desc
     limit v_limit
    offset v_offset
  )
  select jsonb_build_object(
    'total_count', (select count(*) from filtered),
    'limit', v_limit,
    'offset', v_offset,
    'transactions', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'receipt_number', p.receipt_number,
          'status', p.status,
          'transaction_type', case
            when coalesce(p.transaction_type, 'sale') = 'return' or p.total < 0 then 'return'
            else 'sale'
          end,
          'gross_total', coalesce(nullif(p.gross_total, 0), case when p.total > 0 then p.total else 0 end),
          'discount_total', coalesce(p.discount_total, 0),
          'tax_total', coalesce(p.tax_total, 0),
          'tip_total', coalesce(p.tip_total, 0),
          'total', p.total,
          'payment_method', p.payment_method,
          'payment_breakdown', coalesce(p.payment_breakdown, '[]'::jsonb),
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
          'created_at', p.created_at,
          'completed_at', p.completed_at,
          'original_order_id', p.original_order_id,
          'items', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'id', i.id,
                  'item_name', i.item_name,
                  'category', i.category,
                  'quantity', i.quantity,
                  'unit_price', i.unit_price,
                  'gross_subtotal', coalesce(nullif(i.gross_subtotal, 0), i.subtotal),
                  'discount_allocated', coalesce(i.discount_allocated, 0),
                  'tax_allocated', coalesce(i.tax_allocated, 0),
                  'net_subtotal', coalesce(nullif(i.net_subtotal, 0), i.subtotal),
                  'modifiers', coalesce(i.modifiers, '[]'::jsonb),
                  'item_notes', i.item_notes
                )
                order by i.id
              )
                from public.pos_order_items i
               where i.order_id = p.id
            ),
            '[]'::jsonb
          )
        )
        order by coalesce(p.completed_at, p.created_at) desc, p.id desc
      ),
      '[]'::jsonb
    )
  )
    into v_result
    from page p;

  return coalesce(
    v_result,
    jsonb_build_object(
      'total_count', 0,
      'limit', v_limit,
      'offset', v_offset,
      'transactions', '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.get_manager_pos_snapshot(uuid, date, date, uuid) from public;
grant execute on function public.get_manager_pos_snapshot(uuid, date, date, uuid)
  to anon, authenticated, service_role;

revoke all on function public.get_manager_pos_transactions(uuid, date, date, uuid, text, text, text, integer, integer) from public;
grant execute on function public.get_manager_pos_transactions(uuid, date, date, uuid, text, text, text, integer, integer)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
