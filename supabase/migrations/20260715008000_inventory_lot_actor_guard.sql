-- Inventory lots are accountable stock records. Use the desktop application's
-- canonical business user, never auth.uid(), which is absent on its RPC path.

begin;

create or replace function public.record_restaurant_inventory_lot(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(p_payload->>'lodge_id', '')::uuid;
  v_actor_id uuid := public.app_current_user_id();
  v_inventory_item_id uuid := nullif(p_payload->>'inventory_item_id', '')::uuid;
  v_lot_code text := upper(nullif(btrim(coalesce(p_payload->>'lot_code', '')), ''));
  v_received_quantity numeric := coalesce(nullif(p_payload->>'received_quantity', '')::numeric, 0);
  v_unit_cost numeric := coalesce(nullif(p_payload->>'unit_cost', '')::numeric, 0);
  v_id uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin', 'manager', 'supervisor']);

  if v_actor_id is null or not exists (
    select 1 from public.users u where u.id = v_actor_id and u.lodge_id = v_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Your staff session could not be verified. Sign out and sign in again before registering this lot.');
  end if;
  if v_inventory_item_id is null or not exists (
    select 1 from public.inventory_items ii where ii.id = v_inventory_item_id and ii.lodge_id = v_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Choose a stock item from this business.');
  end if;
  if v_lot_code is null then
    return jsonb_build_object('success', false, 'error', 'Enter the supplier lot or batch code.');
  end if;
  if v_received_quantity <= 0 then
    return jsonb_build_object('success', false, 'error', 'Lot quantity must be positive.');
  end if;
  if v_unit_cost < 0 then
    return jsonb_build_object('success', false, 'error', 'Lot unit cost cannot be negative.');
  end if;

  insert into public.restaurant_inventory_lots (
    lodge_id, inventory_item_id, outlet_id, lot_code, received_quantity,
    remaining_quantity, unit_cost, expires_on, received_by, notes
  ) values (
    v_lodge_id, v_inventory_item_id, nullif(p_payload->>'outlet_id', '')::uuid,
    v_lot_code, v_received_quantity, v_received_quantity, v_unit_cost,
    nullif(p_payload->>'expires_on', '')::date, v_actor_id, nullif(p_payload->>'notes', '')
  ) returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error', 'That lot code is already registered for this stock item. Check the existing lot or use the supplier batch code.');
end;
$$;

revoke all on function public.record_restaurant_inventory_lot(jsonb) from public;
grant execute on function public.record_restaurant_inventory_lot(jsonb) to authenticated, service_role;

commit;
