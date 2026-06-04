-- Void stock restoration
-- When a POS order is voided, reverse the exact inventory depletions that
-- create_pos_order applied. Both void paths (direct and pin-approved) call
-- the same shared helper so the logic stays in one place.

-- ── Helper: restore stock for a given order ──────────────────────────────────

create or replace function public._restore_pos_order_stock(
  p_order_id uuid,
  p_lodge_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $func$
declare
  v_item record;
begin
  for v_item in
    select
      poi.quantity,
      pmi.inventory_item_id,
      coalesce(pmi.depletion_qty, 1) as depletion_qty
    from public.pos_order_items poi
    join public.pos_menu_items pmi
      on pmi.id = poi.menu_item_id
     and pmi.lodge_id = p_lodge_id
    where poi.order_id = p_order_id
      and poi.lodge_id = p_lodge_id
      and pmi.inventory_item_id is not null
  loop
    update public.inventory_items
       set current_stock = coalesce(current_stock, 0)
                         + (v_item.depletion_qty * v_item.quantity)
     where id = v_item.inventory_item_id
       and lodge_id = p_lodge_id;
  end loop;
end;
$func$;

-- Not directly callable — invoked only from security-definer void functions.
revoke all on function public._restore_pos_order_stock(uuid, uuid) from public;

-- ── void_pos_order: add stock restoration ────────────────────────────────────

create or replace function public.void_pos_order(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status
    into v_status
    from public.pos_orders
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  update public.pos_orders
     set status = 'voided'
   where id = p_id
     and lodge_id = p_lodge_id;

  perform public._restore_pos_order_stock(p_id, p_lodge_id);

  return jsonb_build_object('success', true, 'id', p_id);
end;
$function$;

revoke all on function public.void_pos_order(uuid, uuid) from public;
grant execute on function public.void_pos_order(uuid, uuid) to anon, authenticated;

-- ── approve_pos_void_with_pin: add stock restoration ─────────────────────────

create or replace function public.approve_pos_void_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id     uuid := (payload->>'order_id')::uuid;
  v_lodge_id     uuid := (payload->>'lodge_id')::uuid;
  v_requested_by uuid := nullif(payload->>'requested_by', '')::uuid;
  v_approved_by  uuid := nullif(payload->>'approved_by', '')::uuid;
  v_reason       text := nullif(payload->>'reason', '');
  v_outlet_id    uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_status       text;
begin
  select status
    into v_status
    from public.pos_orders
   where id = v_order_id
     and lodge_id = v_lodge_id
   for update;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  update public.pos_orders
     set status = 'voided'
   where id = v_order_id
     and lodge_id = v_lodge_id;

  perform public._restore_pos_order_stock(v_order_id, v_lodge_id);

  insert into public.pos_override_log (
    lodge_id,
    order_id,
    action,
    requested_by,
    approved_by,
    reason,
    outlet_id
  ) values (
    v_lodge_id,
    v_order_id,
    'void',
    v_requested_by,
    v_approved_by,
    v_reason,
    v_outlet_id
  );

  return jsonb_build_object('success', true, 'id', v_order_id);
end;
$function$;

revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb) to anon, authenticated;
