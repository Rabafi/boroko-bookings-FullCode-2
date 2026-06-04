begin;

update public.inventory_items ii
set latest_unit_cost = latest_purchase.unit_cost
from (
  select distinct on (ip.item_id)
    ip.item_id,
    coalesce(ip.unit_cost, 0) as unit_cost
  from public.inventory_purchases ip
  where coalesce(ip.unit_cost, 0) > 0
  order by ip.item_id, ip.date desc, ip.created_at desc nulls last
) as latest_purchase
where ii.id = latest_purchase.item_id
  and coalesce(ii.latest_unit_cost, 0) <= 0;

create or replace function public.create_inventory_stocktake_session(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stocktake_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_title text := nullif(payload->>'title', '');
  v_notes text := nullif(payload->>'notes', '');
  v_created_by uuid := nullif(payload->>'created_by', '')::uuid;
  v_line_count integer := 0;
begin
  insert into public.inventory_stocktakes (
    lodge_id,
    title,
    notes,
    created_by
  ) values (
    v_lodge_id,
    v_title,
    v_notes,
    v_created_by
  )
  returning id into v_stocktake_id;

  insert into public.inventory_stocktake_lines (
    stocktake_id,
    lodge_id,
    item_id,
    expected_qty,
    counted_qty,
    variance_qty,
    unit_cost,
    variance_cost
  )
  select
    v_stocktake_id,
    ii.lodge_id,
    ii.id,
    coalesce(ii.current_stock, 0),
    null,
    null,
    coalesce(ii.latest_unit_cost, last_purchase.unit_cost, 0),
    null
  from public.inventory_items ii
  left join lateral (
    select ip.unit_cost
    from public.inventory_purchases ip
    where ip.item_id = ii.id
      and ip.lodge_id = ii.lodge_id
      and coalesce(ip.unit_cost, 0) > 0
    order by ip.date desc, ip.created_at desc nulls last
    limit 1
  ) last_purchase on true
  where ii.lodge_id = v_lodge_id;

  get diagnostics v_line_count = row_count;

  return jsonb_build_object(
    'success', true,
    'id', v_stocktake_id,
    'line_count', v_line_count
  );
end;
$function$;

grant execute on function public.create_inventory_stocktake_session(jsonb) to anon, authenticated;

commit;
