-- Offline Queue Idempotency: Inventory Creation
-- Ensures desktop offline replays can safely retry after a crash without
-- creating duplicate inventory items.

begin;

create or replace function public.create_inventory_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_outlet_type text;
  v_selling_price numeric := coalesce((payload->>'selling_price')::numeric, 0);
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if exists (
    select 1 from public.inventory_items
    where id = v_id
      and lodge_id = v_lodge_id
  ) then
    return jsonb_build_object('success', true, 'id', v_id, 'idempotent', true);
  end if;

  if v_outlet_id is not null then
    select type
      into v_outlet_type
      from public.outlets
     where id = v_outlet_id
       and lodge_id = v_lodge_id
     limit 1;

    if v_outlet_type is null then
      return jsonb_build_object('success', false, 'error', 'Selected outlet was not found.');
    end if;
  end if;

  if coalesce(v_outlet_type, '') = 'beverage'
     and v_selling_price <= 0 then
    return jsonb_build_object('success', false, 'error', 'Set a POS selling price greater than zero for Bar inventory items.');
  end if;

  insert into public.inventory_items (
    id,
    lodge_id,
    name,
    category,
    unit,
    current_stock,
    reorder_level,
    latest_unit_cost,
    selling_price,
    outlet_id
  ) values (
    v_id,
    v_lodge_id,
    payload->>'name',
    coalesce(payload->>'category', 'Bar'),
    coalesce(payload->>'unit', 'unit'),
    coalesce((payload->>'current_stock')::numeric, 0),
    coalesce((payload->>'reorder_level')::numeric, 0),
    coalesce((payload->>'latest_unit_cost')::numeric, 0),
    v_selling_price,
    v_outlet_id
  );

  perform public.sync_inventory_item_to_pos(v_id, v_lodge_id);

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

revoke all on function public.create_inventory_item(jsonb) from public;
grant execute on function public.create_inventory_item(jsonb) to anon, authenticated;

commit;
