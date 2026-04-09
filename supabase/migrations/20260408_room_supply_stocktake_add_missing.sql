begin;

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

  select latest_unit_cost
    into v_unit_cost
    from public.supply_items
   where id = p_supply_item_id
     and lodge_id = p_lodge_id;

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
