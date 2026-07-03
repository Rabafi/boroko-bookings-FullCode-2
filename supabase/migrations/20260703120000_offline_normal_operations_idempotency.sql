-- Long-outage normal operations: stable local IDs and replay idempotency.
-- This keeps Supabase RPCs as the authority while allowing desktop queues to
-- retry purchases, expenses, stocktakes, and supply movements safely.

create or replace function public.create_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_amount numeric := coalesce((payload->>'amount')::numeric, 0);
begin
  perform public.app_require_lodge_role(v_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if exists (select 1 from public.expenses where id = v_id and lodge_id = v_lodge_id) then
    return jsonb_build_object('success', true, 'id', v_id, 'idempotent', true);
  end if;

  if v_amount <= 0 or v_amount > 999999.99 then
    raise exception 'Expense amount must be between P0.01 and P999,999.99';
  end if;

  insert into public.expenses (
    id, lodge_id, date, category, description, amount, notes, outlet_id
  ) values (
    v_id,
    v_lodge_id,
    (payload->>'date')::date,
    payload->>'category',
    payload->>'description',
    v_amount,
    nullif(payload->>'notes', ''),
    nullif(payload->>'outlet_id', '')::uuid
  );

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.create_room_rate_override(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_start date := (payload->>'start_date')::date;
  v_end date := (payload->>'end_date')::date;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if exists (select 1 from public.room_rate_overrides where id = v_id and lodge_id = v_lodge_id) then
    return jsonb_build_object('success', true, 'id', v_id, 'idempotent', true);
  end if;

  if v_start is null or v_end is null or v_end < v_start then
    return jsonb_build_object('success', false, 'error', 'Rate override date range is invalid');
  end if;

  insert into public.room_rate_overrides (
    id, lodge_id, room_id, name, start_date, end_date, rate_per_night
  ) values (
    v_id,
    v_lodge_id,
    nullif(payload->>'room_id', '')::uuid,
    payload->>'name',
    v_start,
    v_end,
    coalesce((payload->>'rate_per_night')::numeric, 0)
  );

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.delete_room_rate_override(p_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deleted uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  delete from public.room_rate_overrides
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', true, 'id', p_id, 'idempotent', true);
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;

create or replace function public.add_inventory_purchase(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_purchase_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity_purchased')::numeric, 0);
  v_total numeric := coalesce((payload->>'total_cost')::numeric, 0);
  v_unit_cost numeric := coalesce((payload->>'unit_cost')::numeric, case when v_qty > 0 then v_total / v_qty else 0 end);
  v_new_stock numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  select current_stock into v_new_stock
  from public.inventory_items
  where id = v_item_id and lodge_id = v_lodge_id;

  if exists (select 1 from public.inventory_purchases where id = v_purchase_id and lodge_id = v_lodge_id) then
    return jsonb_build_object('success', true, 'id', v_purchase_id, 'new_stock', v_new_stock, 'idempotent', true);
  end if;

  if v_qty <= 0 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be greater than zero');
  end if;

  insert into public.inventory_purchases (
    id, lodge_id, item_id, date, quantity_purchased, total_cost, unit_cost, notes
  ) values (
    v_purchase_id, v_lodge_id, v_item_id, (payload->>'date')::date, v_qty, v_total, v_unit_cost, nullif(payload->>'notes', '')
  );

  update public.inventory_items
     set current_stock = coalesce(current_stock, 0) + v_qty,
         latest_unit_cost = v_unit_cost,
         updated_at = now()
   where id = v_item_id
     and lodge_id = v_lodge_id
  returning current_stock into v_new_stock;

  if v_new_stock is null then
    raise exception 'Inventory item not found';
  end if;

  return jsonb_build_object('success', true, 'id', v_purchase_id, 'new_stock', v_new_stock);
end;
$$;

create or replace function public.create_inventory_stocktake_session(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_stocktake_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_line_count integer := 0;
begin
  if exists (select 1 from public.inventory_stocktakes where id = v_stocktake_id and lodge_id = v_lodge_id) then
    select count(*) into v_line_count
    from public.inventory_stocktake_lines
    where stocktake_id = v_stocktake_id and lodge_id = v_lodge_id;
    return jsonb_build_object('success', true, 'id', v_stocktake_id, 'line_count', v_line_count, 'idempotent', true);
  end if;

  insert into public.inventory_stocktakes (
    id, lodge_id, outlet_id, title, notes, created_by
  ) values (
    v_stocktake_id,
    v_lodge_id,
    v_outlet_id,
    nullif(payload->>'title', ''),
    nullif(payload->>'notes', ''),
    nullif(payload->>'created_by', '')::uuid
  );

  insert into public.inventory_stocktake_lines (
    stocktake_id, lodge_id, item_id, expected_qty, counted_qty, variance_qty, unit_cost, variance_cost
  )
  select
    v_stocktake_id,
    ii.lodge_id,
    ii.id,
    coalesce(ii.current_stock, 0),
    null,
    null,
    coalesce(ii.latest_unit_cost, last_purchase.unit_cost, 0),
    null
  from public.inventory_items ii
  left join lateral (
    select ip.unit_cost
    from public.inventory_purchases ip
    where ip.item_id = ii.id
      and ip.lodge_id = ii.lodge_id
      and coalesce(ip.unit_cost, 0) > 0
    order by ip.date desc, ip.created_at desc nulls last
    limit 1
  ) last_purchase on true
  where ii.lodge_id = v_lodge_id
    and (v_outlet_id is null or ii.outlet_id = v_outlet_id);

  get diagnostics v_line_count = row_count;

  return jsonb_build_object('success', true, 'id', v_stocktake_id, 'line_count', v_line_count);
end;
$$;

create or replace function public.create_supply_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
begin
  if exists (select 1 from public.supply_items where id = v_id and lodge_id = v_lodge_id) then
    return jsonb_build_object('success', true, 'id', v_id, 'idempotent', true);
  end if;

  insert into public.supply_items (
    id, lodge_id, name, category, unit, current_stock, reorder_level, latest_unit_cost
  ) values (
    v_id,
    v_lodge_id,
    payload->>'name',
    coalesce(payload->>'category', 'Bathroom'),
    coalesce(payload->>'unit', 'piece'),
    coalesce((payload->>'current_stock')::numeric, 0),
    coalesce((payload->>'reorder_level')::numeric, 0),
    coalesce((payload->>'latest_unit_cost')::numeric, 0)
  );

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.add_supply_purchase(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_purchase_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity_purchased')::numeric, 0);
  v_total numeric := coalesce((payload->>'total_cost')::numeric, 0);
  v_unit_cost numeric := coalesce((payload->>'unit_cost')::numeric, case when v_qty > 0 then v_total / v_qty else 0 end);
  v_new_stock numeric;
begin
  select current_stock into v_new_stock
  from public.supply_items
  where id = v_item_id and lodge_id = v_lodge_id;

  if exists (select 1 from public.supply_purchases where id = v_purchase_id and lodge_id = v_lodge_id) then
    return jsonb_build_object('success', true, 'id', v_purchase_id, 'new_stock', v_new_stock, 'idempotent', true);
  end if;

  if v_qty <= 0 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be greater than zero');
  end if;

  insert into public.supply_purchases (
    id, lodge_id, item_id, date, quantity_purchased, total_cost, unit_cost, notes
  ) values (
    v_purchase_id, v_lodge_id, v_item_id, (payload->>'date')::date, v_qty, v_total, v_unit_cost, nullif(payload->>'notes', '')
  );

  update public.supply_items
  set current_stock = coalesce(current_stock, 0) + v_qty,
      latest_unit_cost = v_unit_cost
  where id = v_item_id
    and lodge_id = v_lodge_id
  returning current_stock into v_new_stock;

  if v_new_stock is null then
    raise exception 'Supply item not found';
  end if;

  insert into public.room_supply_movements (
    id, lodge_id, supply_item_id, movement_type, quantity, unit_cost, total_cost, notes
  ) values (
    v_purchase_id, v_lodge_id, v_item_id, 'purchase', v_qty, v_unit_cost, v_total, nullif(payload->>'notes', '')
  )
  on conflict (id) do nothing;

  return jsonb_build_object('success', true, 'id', v_purchase_id, 'new_stock', v_new_stock);
end;
$$;

create or replace function public.adjust_supply_stock(
  p_item_id uuid,
  p_lodge_id uuid,
  p_delta numeric,
  p_notes text default null,
  p_adjustment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_adjustment_id uuid := coalesce(p_adjustment_id, gen_random_uuid());
  v_new_stock numeric;
  v_unit_cost numeric;
begin
  if exists (select 1 from public.room_supply_movements where id = v_adjustment_id and lodge_id = p_lodge_id) then
    select current_stock into v_new_stock
    from public.supply_items
    where id = p_item_id and lodge_id = p_lodge_id;
    return jsonb_build_object('success', true, 'new_stock', v_new_stock, 'idempotent', true);
  end if;

  update public.supply_items
  set current_stock = greatest(0, coalesce(current_stock, 0) + coalesce(p_delta, 0))
  where id = p_item_id
    and lodge_id = p_lodge_id
  returning current_stock, latest_unit_cost into v_new_stock, v_unit_cost;

  if v_new_stock is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  insert into public.room_supply_movements (
    id, lodge_id, supply_item_id, movement_type, quantity, unit_cost, total_cost, notes
  ) values (
    v_adjustment_id, p_lodge_id, p_item_id, 'adjustment', coalesce(p_delta, 0), coalesce(v_unit_cost, 0),
    coalesce(p_delta, 0) * coalesce(v_unit_cost, 0), nullif(p_notes, '')
  );

  return jsonb_build_object('success', true, 'new_stock', v_new_stock);
end;
$$;

create or replace function public.load_supply_to_room(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation_id uuid := coalesce(nullif(payload->>'operation_id', '')::uuid, gen_random_uuid());
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity')::numeric, 0);
  v_reorder_level numeric := coalesce((payload->>'reorder_level')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_current_store numeric;
  v_unit_cost numeric;
  v_new_store numeric;
  v_new_room numeric;
begin
  if exists (select 1 from public.room_supply_movements where id = v_operation_id and lodge_id = v_lodge_id) then
    select current_stock into v_new_store
    from public.supply_items
    where id = v_item_id and lodge_id = v_lodge_id;

    select quantity_on_hand into v_new_room
    from public.room_supply_room_stock
    where lodge_id = v_lodge_id and room_id = v_room_id and supply_item_id = v_item_id;

    return jsonb_build_object(
      'success', true,
      'new_store_stock', v_new_store,
      'new_room_stock', v_new_room,
      'idempotent', true
    );
  end if;

  if v_qty <= 0 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be greater than zero');
  end if;

  select current_stock, latest_unit_cost
    into v_current_store, v_unit_cost
    from public.supply_items
   where id = v_item_id
     and lodge_id = v_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  if coalesce(v_current_store, 0) < v_qty then
    return jsonb_build_object('success', false, 'error', 'Not enough store stock available for this load');
  end if;

  update public.supply_items
     set current_stock = coalesce(current_stock, 0) - v_qty
   where id = v_item_id
     and lodge_id = v_lodge_id
  returning current_stock into v_new_store;

  insert into public.room_supply_room_stock (
    lodge_id,
    room_id,
    supply_item_id,
    quantity_on_hand,
    reorder_level,
    last_moved_at,
    updated_at
  ) values (
    v_lodge_id,
    v_room_id,
    v_item_id,
    v_qty,
    v_reorder_level,
    now(),
    now()
  )
  on conflict (lodge_id, room_id, supply_item_id)
  do update set
    quantity_on_hand = coalesce(public.room_supply_room_stock.quantity_on_hand, 0) + excluded.quantity_on_hand,
    reorder_level = case
      when excluded.reorder_level > 0 then excluded.reorder_level
      else public.room_supply_room_stock.reorder_level
    end,
    last_moved_at = now(),
    updated_at = now()
  returning quantity_on_hand into v_new_room;

  insert into public.room_supply_movements (
    id,
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
    v_operation_id,
    v_lodge_id,
    v_room_id,
    v_item_id,
    'load',
    v_qty,
    coalesce(v_unit_cost, 0),
    v_qty * coalesce(v_unit_cost, 0),
    v_notes
  );

  return jsonb_build_object(
    'success', true,
    'new_store_stock', v_new_store,
    'new_room_stock', v_new_room
  );
end;
$$;

create or replace function public.use_room_supply_stock(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation_id uuid := coalesce(nullif(payload->>'operation_id', '')::uuid, gen_random_uuid());
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_unit_cost numeric := 0;
  v_new_room numeric;
begin
  if exists (select 1 from public.room_supply_movements where id = v_operation_id and lodge_id = v_lodge_id) then
    select quantity_on_hand into v_new_room
    from public.room_supply_room_stock
    where lodge_id = v_lodge_id and room_id = v_room_id and supply_item_id = v_item_id;

    return jsonb_build_object('success', true, 'new_room_stock', v_new_room, 'idempotent', true);
  end if;

  if v_qty <= 0 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be greater than zero');
  end if;

  select latest_unit_cost
    into v_unit_cost
    from public.supply_items
   where id = v_item_id
     and lodge_id = v_lodge_id;

  update public.room_supply_room_stock
     set quantity_on_hand = greatest(0, coalesce(quantity_on_hand, 0) - v_qty),
         last_moved_at = now(),
         updated_at = now()
   where lodge_id = v_lodge_id
     and room_id = v_room_id
     and supply_item_id = v_item_id
     and coalesce(quantity_on_hand, 0) >= v_qty
  returning quantity_on_hand into v_new_room;

  if v_new_room is null then
    return jsonb_build_object('success', false, 'error', 'Not enough stock is loaded in this room');
  end if;

  insert into public.room_supply_movements (
    id,
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
    v_operation_id,
    v_lodge_id,
    v_room_id,
    v_item_id,
    'use',
    v_qty,
    coalesce(v_unit_cost, 0),
    v_qty * coalesce(v_unit_cost, 0),
    v_notes
  );

  return jsonb_build_object('success', true, 'new_room_stock', v_new_room);
end;
$$;

create or replace function public.return_room_supply_to_store(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation_id uuid := coalesce(nullif(payload->>'operation_id', '')::uuid, gen_random_uuid());
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_unit_cost numeric := 0;
  v_new_room numeric;
  v_new_store numeric;
begin
  if exists (select 1 from public.room_supply_movements where id = v_operation_id and lodge_id = v_lodge_id) then
    select quantity_on_hand into v_new_room
    from public.room_supply_room_stock
    where lodge_id = v_lodge_id and room_id = v_room_id and supply_item_id = v_item_id;

    select current_stock into v_new_store
    from public.supply_items
    where id = v_item_id and lodge_id = v_lodge_id;

    return jsonb_build_object(
      'success', true,
      'new_room_stock', v_new_room,
      'new_store_stock', v_new_store,
      'idempotent', true
    );
  end if;

  if v_qty <= 0 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be greater than zero');
  end if;

  select latest_unit_cost
    into v_unit_cost
    from public.supply_items
   where id = v_item_id
     and lodge_id = v_lodge_id;

  update public.room_supply_room_stock
     set quantity_on_hand = greatest(0, coalesce(quantity_on_hand, 0) - v_qty),
         last_moved_at = now(),
         updated_at = now()
   where lodge_id = v_lodge_id
     and room_id = v_room_id
     and supply_item_id = v_item_id
     and coalesce(quantity_on_hand, 0) >= v_qty
  returning quantity_on_hand into v_new_room;

  if v_new_room is null then
    return jsonb_build_object('success', false, 'error', 'Not enough stock is loaded in this room');
  end if;

  update public.supply_items
     set current_stock = coalesce(current_stock, 0) + v_qty
   where id = v_item_id
     and lodge_id = v_lodge_id
  returning current_stock into v_new_store;

  if v_new_store is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  insert into public.room_supply_movements (
    id,
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
    v_operation_id,
    v_lodge_id,
    v_room_id,
    v_item_id,
    'return',
    v_qty,
    coalesce(v_unit_cost, 0),
    v_qty * coalesce(v_unit_cost, 0),
    v_notes
  );

  return jsonb_build_object(
    'success', true,
    'new_room_stock', v_new_room,
    'new_store_stock', v_new_store
  );
end;
$$;

create or replace function public.post_inventory_stocktake_session(
  p_stocktake_id uuid,
  p_lodge_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.inventory_stocktakes%rowtype;
  v_variance_count integer := 0;
begin
  select *
    into v_session
    from public.inventory_stocktakes
   where id = p_stocktake_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Stock take session not found');
  end if;

  if v_session.status <> 'open' then
    select count(*)
      into v_variance_count
      from public.inventory_stocktake_lines
     where stocktake_id = p_stocktake_id
       and lodge_id = p_lodge_id
       and coalesce(variance_qty, 0) <> 0;

    if v_session.status = 'posted' then
      return jsonb_build_object('success', true, 'variance_count', v_variance_count, 'idempotent', true);
    end if;

    return jsonb_build_object('success', false, 'error', 'This stock take has already been posted');
  end if;

  update public.inventory_stocktake_lines
     set counted_qty = coalesce(counted_qty, expected_qty),
         variance_qty = coalesce(counted_qty, expected_qty) - expected_qty,
         variance_cost = (coalesce(counted_qty, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
         updated_at = now()
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id;

  update public.inventory_items ii
     set current_stock = coalesce(lines.counted_qty, lines.expected_qty)
    from public.inventory_stocktake_lines lines
   where lines.stocktake_id = p_stocktake_id
     and lines.lodge_id = p_lodge_id
     and ii.id = lines.item_id
     and ii.lodge_id = p_lodge_id;

  select count(*)
    into v_variance_count
    from public.inventory_stocktake_lines
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id
     and coalesce(variance_qty, 0) <> 0;

  update public.inventory_stocktakes
     set status = 'posted',
         notes = coalesce(nullif(p_notes, ''), notes),
         counted_at = coalesce(counted_at, now()),
         posted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'variance_count', v_variance_count);
end;
$$;

create or replace function public.post_supply_stocktake_session(
  p_stocktake_id uuid,
  p_lodge_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.supply_stocktakes%rowtype;
  v_variance_count integer := 0;
begin
  select *
    into v_session
    from public.supply_stocktakes
   where id = p_stocktake_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Stock take session not found');
  end if;

  if v_session.status <> 'open' then
    select count(*)
      into v_variance_count
      from public.supply_stocktake_lines
     where stocktake_id = p_stocktake_id
       and lodge_id = p_lodge_id
       and coalesce(variance_qty, 0) <> 0;

    if v_session.status = 'posted' then
      return jsonb_build_object('success', true, 'variance_count', v_variance_count, 'idempotent', true);
    end if;

    return jsonb_build_object('success', false, 'error', 'This stock take has already been posted');
  end if;

  update public.supply_stocktake_lines
     set counted_qty = coalesce(counted_qty, expected_qty),
         variance_qty = coalesce(counted_qty, expected_qty) - expected_qty,
         variance_cost = (coalesce(counted_qty, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
         updated_at = now()
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id;

  update public.supply_items si
     set current_stock = coalesce(lines.counted_qty, lines.expected_qty)
    from public.supply_stocktake_lines lines
   where lines.stocktake_id = p_stocktake_id
     and lines.lodge_id = p_lodge_id
     and si.id = lines.item_id
     and si.lodge_id = p_lodge_id;

  select count(*)
    into v_variance_count
    from public.supply_stocktake_lines
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id
     and coalesce(variance_qty, 0) <> 0;

  update public.supply_stocktakes
     set status = 'posted',
         notes = coalesce(nullif(p_notes, ''), notes),
         counted_at = coalesce(counted_at, now()),
         posted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'variance_count', v_variance_count);
end;
$$;

create or replace function public.post_room_supply_stocktake_session(
  p_stocktake_id uuid,
  p_lodge_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session public.room_supply_stocktakes%rowtype;
  v_variance_count integer := 0;
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
    select count(*)
      into v_variance_count
      from public.room_supply_stocktake_lines
     where stocktake_id = p_stocktake_id
       and lodge_id = p_lodge_id
       and coalesce(variance_qty, 0) <> 0;

    if v_session.status = 'posted' then
      return jsonb_build_object('success', true, 'variance_count', v_variance_count, 'idempotent', true);
    end if;

    return jsonb_build_object('success', false, 'error', 'This room stock take has already been posted');
  end if;

  update public.room_supply_stocktake_lines
     set counted_qty = coalesce(counted_qty, expected_qty),
         variance_qty = coalesce(counted_qty, expected_qty) - expected_qty,
         variance_cost = (coalesce(counted_qty, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
         updated_at = now()
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id;

  update public.room_supply_room_stock rs
     set quantity_on_hand = coalesce(lines.counted_qty, lines.expected_qty),
         last_moved_at = now(),
         updated_at = now()
    from public.room_supply_stocktake_lines lines
   where lines.stocktake_id = p_stocktake_id
     and lines.lodge_id = p_lodge_id
     and rs.id = lines.room_stock_id
     and rs.lodge_id = p_lodge_id;

  insert into public.room_supply_movements (
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  )
  select
    p_lodge_id,
    lines.room_id,
    lines.supply_item_id,
    'adjustment',
    lines.variance_qty,
    coalesce(lines.unit_cost, 0),
    coalesce(lines.variance_qty, 0) * coalesce(lines.unit_cost, 0),
    trim(both ' ' from concat(
      'Room stock take adjustment',
      case when nullif(lines.notes, '') is not null then ': ' || lines.notes else '' end,
      case when nullif(p_notes, '') is not null then ' | ' || p_notes else '' end
    ))
  from public.room_supply_stocktake_lines lines
  where lines.stocktake_id = p_stocktake_id
    and lines.lodge_id = p_lodge_id
    and coalesce(lines.variance_qty, 0) <> 0;

  select count(*)
    into v_variance_count
    from public.room_supply_stocktake_lines
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id
     and coalesce(variance_qty, 0) <> 0;

  update public.room_supply_stocktakes
     set status = 'posted',
         notes = coalesce(nullif(p_notes, ''), notes),
         counted_at = coalesce(counted_at, now()),
         posted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'variance_count', v_variance_count);
end;
$$;

create or replace function public.create_supply_stocktake_session(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_stocktake_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_line_count integer := 0;
begin
  if exists (select 1 from public.supply_stocktakes where id = v_stocktake_id and lodge_id = v_lodge_id) then
    select count(*) into v_line_count from public.supply_stocktake_lines where stocktake_id = v_stocktake_id and lodge_id = v_lodge_id;
    return jsonb_build_object('success', true, 'id', v_stocktake_id, 'line_count', v_line_count, 'idempotent', true);
  end if;

  insert into public.supply_stocktakes (id, lodge_id, title, notes, created_by)
  values (v_stocktake_id, v_lodge_id, nullif(payload->>'title', ''), nullif(payload->>'notes', ''), nullif(payload->>'created_by', '')::uuid);

  insert into public.supply_stocktake_lines (
    stocktake_id, lodge_id, item_id, expected_qty, counted_qty, variance_qty, unit_cost, variance_cost
  )
  select v_stocktake_id, si.lodge_id, si.id, coalesce(si.current_stock, 0), null, null, coalesce(si.latest_unit_cost, 0), null
  from public.supply_items si
  where si.lodge_id = v_lodge_id;

  get diagnostics v_line_count = row_count;
  return jsonb_build_object('success', true, 'id', v_stocktake_id, 'line_count', v_line_count);
end;
$$;

create or replace function public.create_room_supply_stocktake_session(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_stocktake_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_line_count integer := 0;
begin
  if exists (select 1 from public.room_supply_stocktakes where id = v_stocktake_id and lodge_id = v_lodge_id) then
    select count(*) into v_line_count from public.room_supply_stocktake_lines where stocktake_id = v_stocktake_id and lodge_id = v_lodge_id;
    return jsonb_build_object('success', true, 'id', v_stocktake_id, 'line_count', v_line_count, 'idempotent', true);
  end if;

  insert into public.room_supply_stocktakes (id, lodge_id, title, notes, created_by)
  values (v_stocktake_id, v_lodge_id, nullif(payload->>'title', ''), nullif(payload->>'notes', ''), nullif(payload->>'created_by', '')::uuid);

  insert into public.room_supply_stocktake_lines (
    stocktake_id, lodge_id, room_stock_id, room_id, supply_item_id, expected_qty, counted_qty, variance_qty, unit_cost, variance_cost
  )
  select v_stocktake_id, rss.lodge_id, rss.id, rss.room_id, rss.supply_item_id, coalesce(rss.quantity_on_hand, 0), null, null, coalesce(si.latest_unit_cost, 0), null
  from public.room_supply_room_stock rss
  left join public.supply_items si on si.id = rss.supply_item_id and si.lodge_id = rss.lodge_id
  where rss.lodge_id = v_lodge_id;

  get diagnostics v_line_count = row_count;
  return jsonb_build_object('success', true, 'id', v_stocktake_id, 'line_count', v_line_count);
end;
$$;

create or replace function public.create_room_supply_stocktake_line(
  p_stocktake_id uuid,
  p_lodge_id uuid,
  p_room_id uuid,
  p_supply_item_id uuid,
  p_counted_qty numeric default 0,
  p_notes text default null,
  p_line_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_line_id uuid := coalesce(p_line_id, gen_random_uuid());
  v_session public.room_supply_stocktakes%rowtype;
  v_room_stock_id uuid;
  v_unit_cost numeric := 0;
begin
  if exists (select 1 from public.room_supply_stocktake_lines where id = v_line_id and lodge_id = p_lodge_id) then
    return jsonb_build_object('success', true, 'id', v_line_id, 'idempotent', true);
  end if;

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

  select id into v_room_stock_id
  from public.room_supply_room_stock
  where lodge_id = p_lodge_id and room_id = p_room_id and supply_item_id = p_supply_item_id
  limit 1;

  select latest_unit_cost into v_unit_cost
  from public.supply_items
  where id = p_supply_item_id and lodge_id = p_lodge_id;

  insert into public.room_supply_stocktake_lines (
    id, stocktake_id, lodge_id, room_stock_id, room_id, supply_item_id,
    expected_qty, counted_qty, variance_qty, unit_cost, variance_cost, notes
  ) values (
    v_line_id, p_stocktake_id, p_lodge_id, v_room_stock_id, p_room_id, p_supply_item_id,
    0, coalesce(p_counted_qty, 0), coalesce(p_counted_qty, 0), coalesce(v_unit_cost, 0),
    coalesce(p_counted_qty, 0) * coalesce(v_unit_cost, 0), nullif(p_notes, '')
  );

  return jsonb_build_object('success', true, 'id', v_line_id);
end;
$$;

grant execute on function public.create_expense(jsonb) to anon, authenticated, service_role;
grant execute on function public.create_room_rate_override(jsonb) to anon, authenticated, service_role;
grant execute on function public.delete_room_rate_override(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.add_inventory_purchase(jsonb) to anon, authenticated, service_role;
grant execute on function public.create_inventory_stocktake_session(jsonb) to anon, authenticated, service_role;
grant execute on function public.create_supply_item(jsonb) to anon, authenticated, service_role;
grant execute on function public.add_supply_purchase(jsonb) to anon, authenticated, service_role;
grant execute on function public.adjust_supply_stock(uuid, uuid, numeric, text, uuid) to anon, authenticated, service_role;
grant execute on function public.load_supply_to_room(jsonb) to anon, authenticated, service_role;
grant execute on function public.use_room_supply_stock(jsonb) to anon, authenticated, service_role;
grant execute on function public.return_room_supply_to_store(jsonb) to anon, authenticated, service_role;
grant execute on function public.create_supply_stocktake_session(jsonb) to anon, authenticated, service_role;
grant execute on function public.create_room_supply_stocktake_session(jsonb) to anon, authenticated, service_role;
grant execute on function public.create_room_supply_stocktake_line(uuid, uuid, uuid, uuid, numeric, text, uuid) to anon, authenticated, service_role;
grant execute on function public.post_inventory_stocktake_session(uuid, uuid, text) to anon, authenticated, service_role;
grant execute on function public.post_supply_stocktake_session(uuid, uuid, text) to anon, authenticated, service_role;
grant execute on function public.post_room_supply_stocktake_session(uuid, uuid, text) to anon, authenticated, service_role;
