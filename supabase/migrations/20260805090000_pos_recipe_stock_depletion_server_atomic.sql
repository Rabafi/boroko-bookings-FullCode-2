-- POS recipe stock depletion becomes server-authoritative (2026-08-05)
-- ----------------------------------------------------------------------
-- Previously the desktop client called record_recipe_stock_depletion after
-- create_pos_order_v3 succeeded, and queued the same call for offline replay.
-- That split the sale into two non-atomic financial/stock steps and let a
-- lost response or a failed follow-up leave an order without its recipe
-- stock movements.
--
-- This migration:
--   1. Adds an AFTER INSERT trigger on pos_order_items that writes recipe
--      depletion (current_stock decrement, restaurant_recipe_stock_movements,
--      inventory_movements) inside the order's own transaction, using the
--      authoritative line quantity. Direct-stock lines (inventory_item_id
--      set) never pass through recipe depletion, and negative return lines
--      are skipped.
--   2. Rewrites record_recipe_stock_depletion as a legacy-compatible replay
--      that derives quantities from the authoritative pos_order_items rows
--      and skips lines that already carry movements (idempotent for queued
--      operations and for orders created after this migration).
--   3. Adds a read-only reconciliation report of orders that are missing
--      recipe movements; it is produced for manual review, never auto-applied.

begin;

-- ── 1. Server-authoritative recipe depletion on sale-line insert ───────────
-- Keep the actual depletion in one helper so the trigger and the legacy
-- replay RPC cannot drift. The helper reads the authoritative order item,
-- aggregates duplicate recipe ingredients by inventory item, locks each
-- affected inventory row, and updates the mapped stock location in the same
-- transaction as the order.
create or replace function public.restaurant_deplete_recipe_for_order_item(p_order_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_line public.pos_order_items%rowtype;
  v_order public.pos_orders%rowtype;
  v_recipe public.restaurant_recipes%rowtype;
  v_ingredient record;
  v_location_id uuid;
  v_depleted numeric;
  v_unit_cost numeric;
  v_count integer := 0;
  v_skipped integer := 0;
begin
  select * into v_line
    from public.pos_order_items
   where id = p_order_item_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Order line was not found for recipe stock depletion.');
  end if;

  -- Direct-stock lines are handled by the direct-stock path and must never
  -- be depleted again as recipes. Returns and non-sale lines are skipped.
  if v_line.inventory_item_id is not null or coalesce(v_line.quantity, 0) <= 0 then
    return jsonb_build_object('success', true, 'movements_created', 0, 'movements_skipped', 0, 'skipped', true);
  end if;

  select * into v_order
    from public.pos_orders
   where id = v_line.order_id
     and lodge_id = v_line.lodge_id
   for update;
  if not found or coalesce(v_order.transaction_type, 'sale') <> 'sale' then
    return jsonb_build_object('success', true, 'movements_created', 0, 'movements_skipped', 0, 'skipped', true);
  end if;

  select r.* into v_recipe
    from public.restaurant_recipes r
   where r.lodge_id = v_line.lodge_id
     and r.menu_item_id = v_line.menu_item_id
     and r.active = true
   limit 1;
  if not found then
    return jsonb_build_object('success', true, 'movements_created', 0, 'movements_skipped', 0, 'skipped', true);
  end if;

  select stock_location_id into v_location_id
    from public.restaurant_outlet_stock_locations
   where lodge_id = v_line.lodge_id
     and outlet_id is not distinct from v_order.outlet_id;
  v_location_id := coalesce(v_location_id, public.restaurant_default_stock_location(v_line.lodge_id));

  -- The lateral aggregate is deliberate: two recipe rows can consume the
  -- same inventory item. Aggregate first, then lock/check/update once.
  for v_ingredient in
    select ii.id as inventory_item_id,
           ii.unit as inventory_unit,
           coalesce(ii.latest_unit_cost, 0) as latest_unit_cost,
           coalesce(ii.current_stock, 0) as current_stock,
           coalesce(ii.name, 'ingredient') as inventory_item_name,
           required.required_quantity
      from public.inventory_items ii
      join lateral (
        select sum(
          public.restaurant_recipe_quantity_in_inventory_unit(ri.quantity, ri.unit, ii.unit)
          * (1 + coalesce(ri.waste_percent, 0) / 100)
        ) * v_line.quantity as required_quantity
          from public.restaurant_recipe_ingredients ri
         where ri.recipe_id = v_recipe.id
           and ri.lodge_id = v_line.lodge_id
           and ri.inventory_item_id = ii.id
           and ri.quantity > 0
      ) required on required.required_quantity is not null
     where ii.lodge_id = v_line.lodge_id
     order by ii.id
     for update of ii
  loop
    if exists (
      select 1 from public.restaurant_recipe_stock_movements m
       where m.lodge_id = v_line.lodge_id
         and m.order_id = v_line.order_id
         and m.order_item_id = v_line.id
         and m.inventory_item_id = v_ingredient.inventory_item_id
         and m.recipe_version = v_recipe.version
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_depleted := v_ingredient.required_quantity;
    if v_depleted <= 0 then
      continue;
    end if;
    if v_ingredient.current_stock < v_depleted then
      raise exception 'Insufficient stock for % (%): % needs % % but only % are available',
        v_line.item_name, v_recipe.name, v_ingredient.inventory_item_name,
        round(v_depleted, 3), v_ingredient.inventory_unit,
        round(v_ingredient.current_stock, 3);
    end if;

    v_unit_cost := v_ingredient.latest_unit_cost;
    -- This is authoritative stock-location enforcement. If the mapped
    -- location lacks stock, the exception rolls back the entire order.
    perform public.restaurant_apply_stock_location_balance(
      v_line.lodge_id, v_ingredient.inventory_item_id, v_location_id, -v_depleted
    );

    update public.inventory_items
       set current_stock = coalesce(current_stock, 0) - v_depleted,
           updated_at = now()
     where id = v_ingredient.inventory_item_id
       and lodge_id = v_line.lodge_id;

    insert into public.restaurant_recipe_stock_movements (
      lodge_id, recipe_id, order_id, order_item_id, inventory_item_id,
      quantity, unit, movement_reason, recipe_version, theoretical_cost
    ) values (
      v_line.lodge_id, v_recipe.id, v_line.order_id, v_line.id,
      v_ingredient.inventory_item_id, -v_depleted,
      v_ingredient.inventory_unit, 'pos_sale', v_recipe.version,
      v_depleted * v_unit_cost
    );

    insert into public.inventory_movements (
      lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
      notes, reference_type, reference_id, source, created_by
    ) values (
      v_line.lodge_id, v_ingredient.inventory_item_id, 'recipe_sale',
      -v_depleted, v_unit_cost, -v_depleted * v_unit_cost,
      format('Recipe sale: %s', v_recipe.name),
      'restaurant_recipe_sale', v_line.order_id,
      'restaurant_recipe', public.app_current_user_id()
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'movements_created', v_count,
    'movements_skipped', v_skipped,
    'stock_location_id', v_location_id
  );
end;
$$;

create or replace function public.restaurant_apply_recipe_sale_depletion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.restaurant_deplete_recipe_for_order_item(new.id);
  return new;
end;
$$;

drop trigger if exists trg_restaurant_recipe_sale_depletion on public.pos_order_items;
create trigger trg_restaurant_recipe_sale_depletion
after insert on public.pos_order_items
for each row execute function public.restaurant_apply_recipe_sale_depletion();

revoke all on function public.restaurant_apply_recipe_sale_depletion() from public;
grant execute on function public.restaurant_apply_recipe_sale_depletion() to service_role;
revoke all on function public.restaurant_deplete_recipe_for_order_item(uuid) from public;
grant execute on function public.restaurant_deplete_recipe_for_order_item(uuid) to service_role;

-- ── 2. Legacy-compatible replay RPC ────────────────────────────────────────
-- Queued operations and older clients still invoke this RPC after the order
-- exists. It ignores client-supplied quantities and derives everything from
-- the authoritative pos_order_items rows, so replays can never under- or
-- over-deplete, and lines already covered by the trigger are skipped.
create or replace function public.record_recipe_stock_depletion(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_line record;
  v_order public.pos_orders%rowtype;
  v_result jsonb;
  v_count integer := 0;
  v_skipped integer := 0;
begin
  if v_lodge_id is null or v_order_id is null then
    return jsonb_build_object('success', false, 'error', 'lodge_id and order_id are required.');
  end if;

  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select * into v_order
    from public.pos_orders
   where id = v_order_id
     and lodge_id = v_lodge_id
   for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Order was not found for recipe stock depletion.');
  end if;
  if coalesce(v_order.transaction_type, 'sale') <> 'sale' then
    return jsonb_build_object('success', true, 'movements_created', 0, 'movements_skipped', 0, 'replayed', true, 'skipped', true);
  end if;

  for v_line in
    select id, menu_item_id, quantity
      from public.pos_order_items
     where lodge_id = v_lodge_id
       and order_id = v_order_id
       and inventory_item_id is null
       and quantity > 0
     order by id
  loop
    v_result := public.restaurant_deplete_recipe_for_order_item(v_line.id);
    if coalesce((v_result->>'success')::boolean, false) = false then
      return v_result;
    end if;
    v_count := v_count + coalesce((v_result->>'movements_created')::integer, 0);
    v_skipped := v_skipped + coalesce((v_result->>'movements_skipped')::integer, 0);
  end loop;

  return jsonb_build_object(
    'success', true,
    'movements_created', v_count,
    'movements_skipped', v_skipped,
    'replayed', v_count = 0
  );
end;
$$;

revoke all on function public.record_recipe_stock_depletion(jsonb) from public;
grant execute on function public.record_recipe_stock_depletion(jsonb) to authenticated, service_role;

-- ── 3. Reconciliation report (read-only, manual review) ───────────────────
-- Lists sale lines of completed orders that are linked to a current active
-- recipe but have no recipe stock movement recorded for that line. The
-- report is never auto-applied; operators use it to decide corrections.
create or replace function public.get_pos_orders_missing_recipe_movements(
  p_lodge_id uuid,
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_report jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select coalesce(jsonb_agg(row_to_json), '[]'::jsonb)
    into v_report
    from (
      select
        o.id as order_id,
        o.completed_at,
        o.outlet_id,
        o.cashier_id,
        o.total,
        o.transaction_type,
        (
          select coalesce(jsonb_agg(line_json), '[]'::jsonb)
            from (
              select
                oi.id as order_item_id,
                oi.item_name,
                oi.quantity,
                r.id as recipe_id,
                r.version as recipe_version,
                r.name as recipe_name,
                not exists (
                  select 1
                    from public.restaurant_recipe_stock_movements m
                   where m.lodge_id = oi.lodge_id
                     and m.order_id = oi.order_id
                     and m.order_item_id = oi.id
                ) as missing_all_movements,
                (
                  select coalesce(jsonb_agg(ingredient_json), '[]'::jsonb)
                    from (
                      select
                        ri.inventory_item_id,
                        ii.name as inventory_item_name,
                        ii.unit as inventory_unit,
                        public.restaurant_recipe_quantity_in_inventory_unit(
                          ri.quantity, ri.unit, ii.unit
                        ) * oi.quantity * (1 + coalesce(ri.waste_percent, 0) / 100) as required_qty,
                        not exists (
                          select 1
                            from public.restaurant_recipe_stock_movements m
                           where m.lodge_id = ri.lodge_id
                             and m.order_id = oi.order_id
                             and m.order_item_id = oi.id
                             and m.inventory_item_id = ri.inventory_item_id
                             and m.recipe_version = r.version
                        ) as missing
                        from public.restaurant_recipe_ingredients ri
                        join public.inventory_items ii
                          on ii.id = ri.inventory_item_id
                         and ii.lodge_id = ri.lodge_id
                       where ri.recipe_id = r.id
                         and ri.lodge_id = p_lodge_id
                         and ri.quantity > 0
                    ) ingredient_json
                ) as ingredients
              from public.pos_order_items oi
              join public.restaurant_recipes r
                on r.lodge_id = oi.lodge_id
               and r.menu_item_id = oi.menu_item_id
               and r.active = true
             where oi.lodge_id = p_lodge_id
               and oi.order_id = o.id
               and oi.inventory_item_id is null
               and oi.quantity > 0
               and not exists (
                 select 1
                   from public.restaurant_recipe_stock_movements m
                  where m.lodge_id = oi.lodge_id
                    and m.order_id = oi.order_id
                    and m.order_item_id = oi.id
               )
            ) line_json
        ) as missing_lines
        from public.pos_orders o
       where o.lodge_id = p_lodge_id
         and coalesce(o.transaction_type, 'sale') = 'sale'
         and o.status <> 'voided'
         and (p_start is null or o.completed_at >= p_start)
         and (p_end is null or o.completed_at <= p_end)
         and exists (
           select 1
             from public.pos_order_items oi
             join public.restaurant_recipes r
               on r.lodge_id = oi.lodge_id
              and r.menu_item_id = oi.menu_item_id
              and r.active = true
            where oi.lodge_id = p_lodge_id
              and oi.order_id = o.id
              and oi.inventory_item_id is null
              and oi.quantity > 0
              and not exists (
                select 1
                  from public.restaurant_recipe_stock_movements m
                 where m.lodge_id = oi.lodge_id
                   and m.order_id = oi.order_id
                   and m.order_item_id = oi.id
              )
         )
     order by o.completed_at desc
    ) row_to_json;

  return jsonb_build_object('success', true, 'orders', v_report);
end;
$$;

revoke all on function public.get_pos_orders_missing_recipe_movements(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_pos_orders_missing_recipe_movements(uuid, timestamptz, timestamptz) to authenticated, service_role;

commit;
