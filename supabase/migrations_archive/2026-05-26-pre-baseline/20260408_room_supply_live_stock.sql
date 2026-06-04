begin;

alter table public.supply_items
  add column if not exists current_stock numeric not null default 0,
  add column if not exists reorder_level numeric not null default 0;

update public.supply_items
set
  current_stock = coalesce(current_stock, 0),
  reorder_level = coalesce(reorder_level, 0)
where current_stock is null
   or reorder_level is null;

create table if not exists public.room_supply_room_stock (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  supply_item_id uuid not null references public.supply_items(id) on delete cascade,
  quantity_on_hand numeric not null default 0,
  reorder_level numeric not null default 0,
  last_moved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, room_id, supply_item_id)
);

create index if not exists idx_room_supply_room_stock_lodge on public.room_supply_room_stock(lodge_id);
create index if not exists idx_room_supply_room_stock_room on public.room_supply_room_stock(room_id);
create index if not exists idx_room_supply_room_stock_item on public.room_supply_room_stock(supply_item_id);

create table if not exists public.room_supply_movements (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  room_id uuid null references public.rooms(id) on delete set null,
  supply_item_id uuid not null references public.supply_items(id) on delete cascade,
  movement_type text not null,
  quantity numeric not null,
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  notes text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_room_supply_movements_lodge on public.room_supply_movements(lodge_id, created_at desc);
create index if not exists idx_room_supply_movements_room on public.room_supply_movements(room_id, created_at desc);
create index if not exists idx_room_supply_movements_item on public.room_supply_movements(supply_item_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'room_supply_movements_type_check'
  ) then
    alter table public.room_supply_movements
      add constraint room_supply_movements_type_check
      check (movement_type in ('purchase', 'load', 'use', 'return', 'adjustment'));
  end if;
end $$;

grant select on table public.room_supply_room_stock to anon, authenticated;
grant select on table public.room_supply_movements to anon, authenticated;

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
    current_stock,
    reorder_level,
    latest_unit_cost
  ) values (
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    coalesce(payload->>'category', 'Bathroom'),
    coalesce(payload->>'unit', 'piece'),
    coalesce((payload->>'current_stock')::numeric, 0),
    coalesce((payload->>'reorder_level')::numeric, 0),
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
    unit = case when payload ? 'unit' then payload->>'unit' else unit end,
    reorder_level = case when payload ? 'reorder_level' then coalesce((payload->>'reorder_level')::numeric, 0) else reorder_level end
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
  v_qty numeric;
  v_total numeric;
  v_new_stock numeric;
begin
  v_item_id := (payload->>'item_id')::uuid;
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_qty := coalesce((payload->>'quantity_purchased')::numeric, 0);
  v_total := coalesce((payload->>'total_cost')::numeric, 0);
  v_unit_cost := coalesce(
    (payload->>'unit_cost')::numeric,
    case
      when v_qty > 0 then v_total / v_qty
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
    v_qty,
    v_total,
    v_unit_cost,
    nullif(payload->>'notes', '')
  )
  returning id into v_purchase_id;

  update public.supply_items
  set
    current_stock = coalesce(current_stock, 0) + v_qty,
    latest_unit_cost = v_unit_cost
  where id = v_item_id
    and lodge_id = v_lodge_id
  returning current_stock into v_new_stock;

  if v_new_stock is null then
    raise exception 'Supply item not found';
  end if;

  insert into public.room_supply_movements (
    lodge_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
    v_lodge_id,
    v_item_id,
    'purchase',
    v_qty,
    v_unit_cost,
    v_total,
    nullif(payload->>'notes', '')
  );

  return jsonb_build_object(
    'success', true,
    'id', v_purchase_id,
    'unit_cost', v_unit_cost,
    'new_stock', v_new_stock
  );
end;
$function$;

grant execute on function public.add_supply_purchase(jsonb) to anon, authenticated;

create or replace function public.adjust_supply_stock(
  p_item_id uuid,
  p_lodge_id uuid,
  p_delta numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_stock numeric;
  v_unit_cost numeric;
begin
  update public.supply_items
  set current_stock = greatest(0, coalesce(current_stock, 0) + coalesce(p_delta, 0))
  where id = p_item_id
    and lodge_id = p_lodge_id
  returning current_stock, latest_unit_cost into v_new_stock, v_unit_cost;

  if v_new_stock is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  insert into public.room_supply_movements (
    lodge_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
    p_lodge_id,
    p_item_id,
    'adjustment',
    coalesce(p_delta, 0),
    coalesce(v_unit_cost, 0),
    coalesce(p_delta, 0) * coalesce(v_unit_cost, 0),
    nullif(p_notes, '')
  );

  return jsonb_build_object('success', true, 'new_stock', v_new_stock);
end;
$function$;

grant execute on function public.adjust_supply_stock(uuid, uuid, numeric, text) to anon, authenticated;

create or replace function public.load_supply_to_room(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
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
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
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
$function$;

grant execute on function public.load_supply_to_room(jsonb) to anon, authenticated;

create or replace function public.use_room_supply_stock(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_unit_cost numeric := 0;
  v_new_room numeric;
begin
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
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
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
$function$;

grant execute on function public.use_room_supply_stock(jsonb) to anon, authenticated;

create or replace function public.return_room_supply_to_store(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_unit_cost numeric := 0;
  v_new_room numeric;
  v_new_store numeric;
begin
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
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
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
$function$;

grant execute on function public.return_room_supply_to_store(jsonb) to anon, authenticated;

commit;
