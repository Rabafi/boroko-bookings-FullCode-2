begin;

create table if not exists public.room_supply_stocktakes (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  title text null,
  notes text null,
  status text not null default 'open',
  started_at timestamptz not null default now(),
  counted_at timestamptz null,
  posted_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.room_supply_stocktake_lines (
  id uuid primary key default gen_random_uuid(),
  stocktake_id uuid not null references public.room_supply_stocktakes(id) on delete cascade,
  lodge_id uuid not null,
  room_stock_id uuid not null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  supply_item_id uuid not null references public.supply_items(id) on delete cascade,
  expected_qty numeric not null default 0,
  counted_qty numeric null,
  variance_qty numeric null,
  unit_cost numeric not null default 0,
  variance_cost numeric null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stocktake_id, room_stock_id)
);

create index if not exists idx_room_supply_stocktakes_lodge on public.room_supply_stocktakes(lodge_id, created_at desc);
create index if not exists idx_room_supply_stocktake_lines_stocktake on public.room_supply_stocktake_lines(stocktake_id);
create index if not exists idx_room_supply_stocktake_lines_room_stock on public.room_supply_stocktake_lines(room_stock_id);
create index if not exists idx_room_supply_stocktake_lines_room on public.room_supply_stocktake_lines(room_id);
create index if not exists idx_room_supply_stocktake_lines_item on public.room_supply_stocktake_lines(supply_item_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'room_supply_stocktakes_status_check'
  ) then
    alter table public.room_supply_stocktakes
      add constraint room_supply_stocktakes_status_check
      check (status in ('open', 'posted', 'cancelled'));
  end if;
end $$;

grant select on table public.room_supply_stocktakes to anon, authenticated;
grant select on table public.room_supply_stocktake_lines to anon, authenticated;

create or replace function public.create_room_supply_stocktake_session(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stocktake_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_title text := nullif(payload->>'title', '');
  v_notes text := nullif(payload->>'notes', '');
  v_created_by uuid := nullif(payload->>'created_by', '')::uuid;
  v_line_count integer := 0;
begin
  insert into public.room_supply_stocktakes (
    lodge_id,
    title,
    notes,
    created_by
  ) values (
    v_lodge_id,
    v_title,
    v_notes,
    v_created_by
  )
  returning id into v_stocktake_id;

  insert into public.room_supply_stocktake_lines (
    stocktake_id,
    lodge_id,
    room_stock_id,
    room_id,
    supply_item_id,
    expected_qty,
    counted_qty,
    variance_qty,
    unit_cost,
    variance_cost
  )
  select
    v_stocktake_id,
    rs.lodge_id,
    rs.id,
    rs.room_id,
    rs.supply_item_id,
    coalesce(rs.quantity_on_hand, 0),
    null,
    null,
    coalesce(si.latest_unit_cost, 0),
    null
  from public.room_supply_room_stock rs
  join public.supply_items si
    on si.id = rs.supply_item_id
   and si.lodge_id = rs.lodge_id
  where rs.lodge_id = v_lodge_id;

  get diagnostics v_line_count = row_count;

  return jsonb_build_object(
    'success', true,
    'id', v_stocktake_id,
    'line_count', v_line_count
  );
end;
$function$;

grant execute on function public.create_room_supply_stocktake_session(jsonb) to anon, authenticated;

create or replace function public.save_room_supply_stocktake_counts(
  p_stocktake_id uuid,
  p_lodge_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session public.room_supply_stocktakes%rowtype;
  v_line jsonb;
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
    return jsonb_build_object('success', false, 'error', 'Only open room stock takes can be updated');
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    update public.room_supply_stocktake_lines
       set counted_qty = coalesce((v_line->>'counted_qty')::numeric, expected_qty),
           variance_qty = coalesce((v_line->>'counted_qty')::numeric, expected_qty) - expected_qty,
           variance_cost = (coalesce((v_line->>'counted_qty')::numeric, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
           notes = nullif(v_line->>'notes', ''),
           updated_at = now()
     where stocktake_id = p_stocktake_id
       and lodge_id = p_lodge_id
       and room_stock_id = (v_line->>'room_stock_id')::uuid;
  end loop;

  update public.room_supply_stocktakes
     set counted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$function$;

grant execute on function public.save_room_supply_stocktake_counts(uuid, uuid, jsonb) to anon, authenticated;

create or replace function public.post_room_supply_stocktake_session(
  p_stocktake_id uuid,
  p_lodge_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  return jsonb_build_object(
    'success', true,
    'variance_count', v_variance_count
  );
end;
$function$;

grant execute on function public.post_room_supply_stocktake_session(uuid, uuid, text) to anon, authenticated;

commit;
