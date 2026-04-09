create or replace function public.create_supply_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.supply_items (
    lodge_id,
    name,
    category,
    unit,
    latest_unit_cost
  ) values (
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    coalesce(payload->>'category', 'Bathroom'),
    coalesce(payload->>'unit', 'piece'),
    coalesce((payload->>'latest_unit_cost')::numeric, 0)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_supply_item(jsonb) to anon, authenticated;

create or replace function public.update_supply_item(
  p_id uuid,
  p_lodge_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_updated uuid;
begin
  update public.supply_items
  set
    name = case when payload ? 'name' then payload->>'name' else name end,
    category = case when payload ? 'category' then payload->>'category' else category end,
    unit = case when payload ? 'unit' then payload->>'unit' else unit end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_supply_item(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_supply_item(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted uuid;
begin
  delete from public.room_supply_allocations
  where supply_item_id = p_id
    and lodge_id = p_lodge_id;

  delete from public.supply_purchases
  where item_id = p_id
    and lodge_id = p_lodge_id;

  delete from public.supply_items
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_supply_item(uuid, uuid) to anon, authenticated;

create or replace function public.add_supply_purchase(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_purchase_id uuid;
  v_unit_cost numeric;
  v_item_id uuid;
  v_lodge_id uuid;
begin
  v_item_id := (payload->>'item_id')::uuid;
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_unit_cost := coalesce(
    (payload->>'unit_cost')::numeric,
    case
      when coalesce((payload->>'quantity_purchased')::numeric, 0) > 0
        then coalesce((payload->>'total_cost')::numeric, 0) / (payload->>'quantity_purchased')::numeric
      else 0
    end
  );

  insert into public.supply_purchases (
    lodge_id,
    item_id,
    date,
    quantity_purchased,
    total_cost,
    unit_cost,
    notes
  ) values (
    v_lodge_id,
    v_item_id,
    (payload->>'date')::date,
    coalesce((payload->>'quantity_purchased')::numeric, 0),
    coalesce((payload->>'total_cost')::numeric, 0),
    v_unit_cost,
    nullif(payload->>'notes', '')
  )
  returning id into v_purchase_id;

  update public.supply_items
  set latest_unit_cost = v_unit_cost
  where id = v_item_id
    and lodge_id = v_lodge_id;

  return jsonb_build_object('success', true, 'id', v_purchase_id, 'unit_cost', v_unit_cost);
end;
$function$;

grant execute on function public.add_supply_purchase(jsonb) to anon, authenticated;

create or replace function public.save_room_supply_allocations(
  p_lodge_id uuid,
  p_week_start date,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row jsonb;
begin
  delete from public.room_supply_allocations
  where lodge_id = p_lodge_id
    and week_start = p_week_start;

  if p_allocations is not null and jsonb_typeof(p_allocations) = 'array' then
    for v_row in select * from jsonb_array_elements(p_allocations)
    loop
      insert into public.room_supply_allocations (
        lodge_id,
        supply_item_id,
        room_id,
        week_start,
        units_used,
        unit_cost,
        total_cost
      ) values (
        p_lodge_id,
        (v_row->>'supply_item_id')::uuid,
        (v_row->>'room_id')::uuid,
        p_week_start,
        coalesce((v_row->>'units_used')::numeric, 0),
        coalesce((v_row->>'unit_cost')::numeric, 0),
        coalesce((v_row->>'total_cost')::numeric, 0)
      );
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$function$;

grant execute on function public.save_room_supply_allocations(uuid, date, jsonb) to anon, authenticated;
