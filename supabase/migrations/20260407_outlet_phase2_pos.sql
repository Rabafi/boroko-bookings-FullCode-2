-- Outlet Phase 2: POS outlet awareness — create_pos_order RPC with outlet_id
-- ─────────────────────────────────────────────────────────────────────────────
-- Context:
--   create_pos_order was created directly in Supabase and was not previously
--   tracked in migrations. This file is a faithful reconstruction of its
--   expected behavior based on the payload structure in database.js and the
--   existing inventory depletion patterns in 20260326_inventory_rpcs.sql.
--
-- What the original RPC did (preserved):
--   1. INSERT one row into pos_orders (lodge_id, room_id, booking_id,
--      walk_in_name, total, notes, payment_method, status='completed')
--   2. For each item in payload->'items':
--      INSERT one row into pos_order_items (order_id, lodge_id, menu_item_id,
--      item_name, quantity, unit_price, subtotal = qty × unit_price)
--   3. For each item with a non-null menu_item_id:
--      Look up pos_menu_items.inventory_item_id and depletion_qty.
--      If an inventory link exists, deduct:
--        current_stock = greatest(0, current_stock - (depletion_qty × quantity))
--      This preserves the exact greatest(0, ...) floor from adjust_inventory_stock.
--   4. Return jsonb_build_object('success', true, 'id', v_order_id)
--
-- What changed ONLY for outlet support:
--   • pos_orders INSERT now includes outlet_id from payload->>'outlet_id'
--   • outlet_id is nullable — existing callers without outlet_id continue to work
--   • no other logic changed
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.create_pos_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id      uuid := gen_random_uuid();
  v_lodge_id      uuid := (payload->>'lodge_id')::uuid;
  v_item          jsonb;
  v_menu_item_id  uuid;
  v_inv_item_id   uuid;
  v_depletion_qty numeric;
  v_quantity      numeric;
begin
  -- ── 1. Insert the order ────────────────────────────────────────────────────
  insert into public.pos_orders (
    id,
    lodge_id,
    room_id,
    booking_id,
    walk_in_name,
    total,
    notes,
    payment_method,
    outlet_id,
    status
  ) values (
    v_order_id,
    v_lodge_id,
    nullif(payload->>'room_id',    '')::uuid,
    nullif(payload->>'booking_id', '')::uuid,
    nullif(payload->>'walk_in_name', ''),
    coalesce((payload->>'total')::numeric, 0),
    nullif(payload->>'notes', ''),
    coalesce(nullif(payload->>'payment_method', ''), 'cash'),
    nullif(payload->>'outlet_id', '')::uuid,   -- ← outlet support (nullable)
    'completed'
  );

  -- ── 2. Insert order items + 3. Deplete inventory ──────────────────────────
  for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity     := coalesce((v_item->>'quantity')::numeric, 1);

    insert into public.pos_order_items (
      id,
      order_id,
      lodge_id,
      menu_item_id,
      item_name,
      quantity,
      unit_price,
      subtotal
    ) values (
      gen_random_uuid(),
      v_order_id,
      v_lodge_id,
      v_menu_item_id,
      v_item->>'item_name',
      v_quantity,
      coalesce((v_item->>'unit_price')::numeric, 0),
      v_quantity * coalesce((v_item->>'unit_price')::numeric, 0)
    );

    -- Deplete inventory if this menu item has a stock link
    -- Preserves: greatest(0, ...) floor so stock never goes negative
    if v_menu_item_id is not null then
      select inventory_item_id, coalesce(depletion_qty, 1)
        into v_inv_item_id, v_depletion_qty
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if v_inv_item_id is not null then
        update public.inventory_items
           set current_stock = greatest(0, coalesce(current_stock, 0) - (v_depletion_qty * v_quantity))
         where id = v_inv_item_id
           and lodge_id = v_lodge_id;
      end if;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'id', v_order_id);
end;
$function$;

grant execute on function public.create_pos_order(jsonb) to anon, authenticated;
