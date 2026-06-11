begin;

update public.supply_items si
set latest_unit_cost = latest_purchase.unit_cost
from (
  select distinct on (sp.item_id)
    sp.item_id,
    coalesce(sp.unit_cost, 0) as unit_cost
  from public.supply_purchases sp
  where coalesce(sp.unit_cost, 0) > 0
  order by sp.item_id, sp.date desc, sp.created_at desc nulls last
) as latest_purchase
where si.id = latest_purchase.item_id
  and coalesce(si.latest_unit_cost, 0) <= 0;

create or replace function public.create_supply_stocktake_session(payload jsonb)
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
  insert into public.supply_stocktakes (
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

  insert into public.supply_stocktake_lines (
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
    si.lodge_id,
    si.id,
    coalesce(si.current_stock, 0),
    null,
    null,
    coalesce(si.latest_unit_cost, last_purchase.unit_cost, 0),
    null
  from public.supply_items si
  left join lateral (
    select sp.unit_cost
    from public.supply_purchases sp
    where sp.item_id = si.id
      and sp.lodge_id = si.lodge_id
      and coalesce(sp.unit_cost, 0) > 0
    order by sp.date desc, sp.created_at desc nulls last
    limit 1
  ) last_purchase on true
  where si.lodge_id = v_lodge_id;

  get diagnostics v_line_count = row_count;

  return jsonb_build_object(
    'success', true,
    'id', v_stocktake_id,
    'line_count', v_line_count
  );
end;
$function$;

grant execute on function public.create_supply_stocktake_session(jsonb) to anon, authenticated;

create or replace function public.create_room_supply_stocktake_session(payload jsonb)
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
  insert into public.room_supply_stocktakes (
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

  insert into public.room_supply_stocktake_lines (
    stocktake_id,
    lodge_id,
    room_stock_id,
    room_id,
    supply_item_id,
    expected_qty,
    counted_qty,
    variance_qty,
    unit_cost,
    variance_cost
  )
  select
    v_stocktake_id,
    rs.lodge_id,
    rs.id,
    rs.room_id,
    rs.supply_item_id,
    coalesce(rs.quantity_on_hand, 0),
    null,
    null,
    coalesce(si.latest_unit_cost, last_purchase.unit_cost, 0),
    null
  from public.room_supply_room_stock rs
  join public.supply_items si
    on si.id = rs.supply_item_id
   and si.lodge_id = rs.lodge_id
  left join lateral (
    select sp.unit_cost
    from public.supply_purchases sp
    where sp.item_id = rs.supply_item_id
      and sp.lodge_id = rs.lodge_id
      and coalesce(sp.unit_cost, 0) > 0
    order by sp.date desc, sp.created_at desc nulls last
    limit 1
  ) last_purchase on true
  where rs.lodge_id = v_lodge_id;

  get diagnostics v_line_count = row_count;

  return jsonb_build_object(
    'success', true,
    'id', v_stocktake_id,
    'line_count', v_line_count
  );
end;
$function$;

grant execute on function public.create_room_supply_stocktake_session(jsonb) to anon, authenticated;

create or replace function public.create_room_supply_stocktake_line(
  p_stocktake_id uuid,
  p_lodge_id uuid,
  p_room_id uuid,
  p_supply_item_id uuid,
  p_counted_qty numeric default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.room_supply_stocktakes%rowtype;
  v_room_stock_id uuid;
  v_unit_cost numeric := 0;
begin
  select *
    into v_session
    from public.room_supply_stocktakes
   where id = p_stocktake_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room stock take session not found');
  end if;

  if v_session.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'Only open room stock takes can be updated');
  end if;

  select coalesce(si.latest_unit_cost, last_purchase.unit_cost, 0)
    into v_unit_cost
    from public.supply_items si
    left join lateral (
      select sp.unit_cost
      from public.supply_purchases sp
      where sp.item_id = si.id
        and sp.lodge_id = si.lodge_id
        and coalesce(sp.unit_cost, 0) > 0
      order by sp.date desc, sp.created_at desc nulls last
      limit 1
    ) last_purchase on true
   where si.id = p_supply_item_id
     and si.lodge_id = p_lodge_id;

  if v_unit_cost is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  insert into public.room_supply_room_stock (
    lodge_id,
    room_id,
    supply_item_id,
    quantity_on_hand,
    reorder_level,
    last_moved_at,
    updated_at
  ) values (
    p_lodge_id,
    p_room_id,
    p_supply_item_id,
    0,
    0,
    now(),
    now()
  )
  on conflict (lodge_id, room_id, supply_item_id)
  do update set updated_at = now()
  returning id into v_room_stock_id;

  insert into public.room_supply_stocktake_lines (
    stocktake_id,
    lodge_id,
    room_stock_id,
    room_id,
    supply_item_id,
    expected_qty,
    counted_qty,
    variance_qty,
    unit_cost,
    variance_cost,
    notes
  ) values (
    p_stocktake_id,
    p_lodge_id,
    v_room_stock_id,
    p_room_id,
    p_supply_item_id,
    0,
    greatest(coalesce(p_counted_qty, 0), 0),
    greatest(coalesce(p_counted_qty, 0), 0),
    coalesce(v_unit_cost, 0),
    greatest(coalesce(p_counted_qty, 0), 0) * coalesce(v_unit_cost, 0),
    nullif(p_notes, '')
  )
  on conflict (stocktake_id, room_stock_id)
  do update set
    counted_qty = greatest(coalesce(excluded.counted_qty, 0), 0),
    variance_qty = greatest(coalesce(excluded.counted_qty, 0), 0) - public.room_supply_stocktake_lines.expected_qty,
    variance_cost = (greatest(coalesce(excluded.counted_qty, 0), 0) - public.room_supply_stocktake_lines.expected_qty) * coalesce(public.room_supply_stocktake_lines.unit_cost, excluded.unit_cost, 0),
    notes = coalesce(excluded.notes, public.room_supply_stocktake_lines.notes),
    updated_at = now();

  update public.room_supply_stocktakes
     set counted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'room_stock_id', v_room_stock_id);
end;
$function$;

grant execute on function public.create_room_supply_stocktake_line(uuid, uuid, uuid, uuid, numeric, text) to anon, authenticated;

commit;
