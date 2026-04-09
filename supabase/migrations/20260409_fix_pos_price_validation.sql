-- supabase/migrations/20260409_fix_pos_price_validation.sql
-- Fix F1: server-side price validation in create_pos_order.
-- For items with a known menu_item_id, price is fetched from pos_menu_items.
-- Client-sent unit_price is ignored for those items.
-- Custom items (null menu_item_id) retain client-supplied price.
-- pos_orders.total is recomputed server-side and overwritten.
-- ─────────────────────────────────────────────────────────────────────────────
-- Why:
--   The previous RPC trusted unit_price from the client payload, allowing a
--   compromised renderer to submit falsified prices. This fix makes the RPC
--   the single source of truth for pricing of catalogue items.
-- Changes vs 20260407_outlet_phase2_pos.sql:
--   1. Single SELECT per item fetches price + inventory_item_id + depletion_qty
--      (was two separate SELECTs; now one round-trip).
--   2. For menu items found in DB: v_unit_price = DB price (client ignored).
--   3. For custom items (menu_item_id IS NULL): client price is trusted.
--   4. v_computed_total accumulates server-resolved line totals.
--   5. pos_orders inserted with total = 0 placeholder; updated after loop.
--   6. Response now includes 'total' field (additive — no callers break).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.create_pos_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order_id        uuid    := gen_random_uuid();
  v_lodge_id        uuid    := (payload->>'lodge_id')::uuid;
  v_item            jsonb;
  v_menu_item_id    uuid;
  v_inv_item_id     uuid;
  v_depletion_qty   numeric;
  v_quantity        numeric;
  v_db_price        numeric;        -- price resolved from pos_menu_items
  v_unit_price      numeric;        -- final resolved price (DB or client for custom)
  v_computed_total  numeric := 0;   -- server-computed running total
begin
  -- ── 1. Insert order with placeholder total (rewritten after items loop) ────
  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name,
    total, notes, payment_method, outlet_id, status
  ) values (
    v_order_id,
    v_lodge_id,
    nullif(payload->>'room_id',       '')::uuid,
    nullif(payload->>'booking_id',    '')::uuid,
    nullif(payload->>'walk_in_name',  ''),
    0,   -- placeholder; replaced below after items loop
    nullif(payload->>'notes',         ''),
    coalesce(nullif(payload->>'payment_method', ''), 'cash'),
    nullif(payload->>'outlet_id',     '')::uuid,
    'completed'
  );

  -- ── 2. Insert order items + deplete inventory ──────────────────────────────
  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity     := coalesce((v_item->>'quantity')::numeric, 1);

    if v_menu_item_id is not null then
      -- Known menu item: resolve price AND depletion link in a single query.
      -- Client-sent unit_price is intentionally ignored for these items.
      select price,
             inventory_item_id,
             coalesce(depletion_qty, 1)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty
        from public.pos_menu_items
       where id       = v_menu_item_id
         and lodge_id = v_lodge_id;

      if not found then
        raise exception
          'POS menu item % not found for lodge % — order rejected',
          v_menu_item_id, v_lodge_id;
      end if;

      v_unit_price := v_db_price;  -- DB price wins; client price discarded

    else
      -- Custom / free-text item: no DB record, trust client price.
      v_unit_price    := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id   := null;
      v_depletion_qty := 1;
    end if;

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id,
      item_name, quantity, unit_price, subtotal
    ) values (
      gen_random_uuid(),
      v_order_id,
      v_lodge_id,
      v_menu_item_id,
      v_item->>'item_name',
      v_quantity,
      v_unit_price,
      v_quantity * v_unit_price
    );

    v_computed_total := v_computed_total + (v_quantity * v_unit_price);

    -- Deplete inventory if this menu item has a stock link
    if v_inv_item_id is not null then
      update public.inventory_items
         set current_stock = greatest(0, coalesce(current_stock, 0)
                                        - (v_depletion_qty * v_quantity))
       where id       = v_inv_item_id
         and lodge_id = v_lodge_id;
    end if;

  end loop;

  -- ── 3. Overwrite placeholder total with server-computed value ──────────────
  update public.pos_orders
     set total = v_computed_total
   where id = v_order_id;

  return jsonb_build_object(
    'success', true,
    'id',      v_order_id,
    'total',   v_computed_total   -- additive field; existing callers unaffected
  );
end;
$function$;

grant execute on function public.create_pos_order(jsonb) to anon, authenticated;
