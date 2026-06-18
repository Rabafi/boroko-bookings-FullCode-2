-- Make manual stock adjustments safe to replay after crashes or offline sync retries.

create unique index if not exists inventory_movements_adjustment_idempotency_uidx
  on public.inventory_movements (lodge_id, reference_id)
  where reference_type = 'inventory_adjustment' and reference_id is not null;

create or replace function public.adjust_inventory_stock(
  p_item_id uuid,
  p_lodge_id uuid,
  p_delta numeric,
  p_notes text,
  p_adjustment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current_stock numeric;
  v_new_stock numeric;
  v_unit_cost numeric;
  v_existing_movement_id uuid;
  v_existing_item_id uuid;
  v_movement_id uuid;
  v_actor_raw text := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor uuid := case when v_actor_raw ~ '^[0-9a-fA-F-]{36}$' then v_actor_raw::uuid else null end;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  if coalesce(p_delta, 0) = 0 then
    return jsonb_build_object('success', false, 'error', 'Adjustment quantity is required');
  end if;

  if p_adjustment_id is null then
    return jsonb_build_object('success', false, 'error', 'Adjustment id is required');
  end if;

  select coalesce(i.current_stock, 0), coalesce(i.latest_unit_cost, 0)
    into v_current_stock, v_unit_cost
    from public.inventory_items i
   where i.id = p_item_id
     and i.lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  select m.id, m.item_id
    into v_existing_movement_id, v_existing_item_id
    from public.inventory_movements m
   where m.lodge_id = p_lodge_id
     and m.reference_type = 'inventory_adjustment'
     and m.reference_id = p_adjustment_id
   limit 1;

  if found then
    if v_existing_item_id is distinct from p_item_id then
      return jsonb_build_object('success', false, 'error', 'Adjustment id was already used for another inventory item');
    end if;
    return jsonb_build_object(
      'success', true,
      'new_stock', v_current_stock,
      'movement_id', v_existing_movement_id,
      'idempotent', true
    );
  end if;

  v_new_stock := greatest(0, v_current_stock + p_delta);

  update public.inventory_items
     set current_stock = v_new_stock
   where id = p_item_id
     and lodge_id = p_lodge_id;

  insert into public.inventory_movements (
    lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
    notes, reference_type, reference_id, source, created_by
  ) values (
    p_lodge_id,
    p_item_id,
    case when p_delta >= 0 then 'adjustment_increase' else 'adjustment_decrease' end,
    p_delta,
    v_unit_cost,
    p_delta * v_unit_cost,
    nullif(p_notes, ''),
    'inventory_adjustment',
    p_adjustment_id,
    'adjustment',
    v_actor
  )
  returning id into v_movement_id;

  return jsonb_build_object(
    'success', true,
    'new_stock', v_new_stock,
    'movement_id', v_movement_id,
    'idempotent', false
  );
end;
$$;

create or replace function public.adjust_inventory_stock(
  p_item_id uuid,
  p_lodge_id uuid,
  p_delta numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  return jsonb_build_object('success', false, 'error', 'Legacy inventory adjustment is disabled. Supply an adjustment id.');
end;
$$;

revoke all on function public.adjust_inventory_stock(uuid, uuid, numeric, text, uuid) from public;
grant execute on function public.adjust_inventory_stock(uuid, uuid, numeric, text, uuid) to anon, authenticated, service_role;

revoke all on function public.adjust_inventory_stock(uuid, uuid, numeric, text) from public;
grant execute on function public.adjust_inventory_stock(uuid, uuid, numeric, text) to anon, authenticated, service_role;

drop function if exists public.update_booking_payment(uuid, uuid, numeric, text);
