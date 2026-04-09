create or replace function public.create_pos_menu_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.pos_menu_items (
    lodge_id,
    name,
    category,
    price,
    is_available,
    barcode,
    inventory_item_id,
    depletion_qty
  ) values (
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    coalesce(payload->>'category', 'Other'),
    coalesce((payload->>'price')::numeric, 0),
    coalesce((payload->>'is_available')::boolean, true),
    nullif(payload->>'barcode', ''),
    nullif(payload->>'inventory_item_id', '')::uuid,
    case
      when nullif(payload->>'inventory_item_id', '') is null then null
      else coalesce((payload->>'depletion_qty')::numeric, 1)
    end
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

grant execute on function public.create_pos_menu_item(jsonb) to anon, authenticated;

create or replace function public.update_pos_menu_item(
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
  update public.pos_menu_items
  set
    name = case when payload ? 'name' then payload->>'name' else name end,
    category = case when payload ? 'category' then coalesce(payload->>'category', 'Other') else category end,
    price = case when payload ? 'price' then coalesce((payload->>'price')::numeric, 0) else price end,
    is_available = case when payload ? 'is_available' then coalesce((payload->>'is_available')::boolean, true) else is_available end,
    barcode = case when payload ? 'barcode' then nullif(payload->>'barcode', '') else barcode end,
    inventory_item_id = case when payload ? 'inventory_item_id' then nullif(payload->>'inventory_item_id', '')::uuid else inventory_item_id end,
    depletion_qty = case
      when payload ? 'inventory_item_id' then
        case
          when nullif(payload->>'inventory_item_id', '') is null then null
          else coalesce((payload->>'depletion_qty')::numeric, 1)
        end
      when payload ? 'depletion_qty' then coalesce((payload->>'depletion_qty')::numeric, 1)
      else depletion_qty
    end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$function$;

grant execute on function public.update_pos_menu_item(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_pos_menu_item(
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
  delete from public.pos_menu_items
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$function$;

grant execute on function public.delete_pos_menu_item(uuid, uuid) to anon, authenticated;
