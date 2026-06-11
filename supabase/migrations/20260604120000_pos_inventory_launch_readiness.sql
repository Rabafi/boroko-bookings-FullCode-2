-- POS + Inventory launch readiness
-- - preserve fractional depletion quantities such as 0.5
-- - add inventory movement history
-- - add POS cash-up close records

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  movement_type text not null,
  quantity numeric not null default 0,
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  notes text,
  reference_type text,
  reference_id uuid,
  source text default 'system' not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_movements_lodge_created
  on public.inventory_movements (lodge_id, created_at desc);

create index if not exists idx_inventory_movements_item_created
  on public.inventory_movements (item_id, created_at desc);

alter table public.inventory_movements enable row level security;

drop policy if exists inventory_movements_lodge_scope_select on public.inventory_movements;
create policy inventory_movements_lodge_scope_select
  on public.inventory_movements
  for select
  using (public.app_lodge_access(lodge_id));

alter table public.pos_orders
  add column if not exists gross_total numeric not null default 0,
  add column if not exists discount_total numeric not null default 0,
  add column if not exists tax_rate numeric not null default 0,
  add column if not exists tax_total numeric not null default 0,
  add column if not exists tip_total numeric not null default 0,
  add column if not exists payment_breakdown jsonb not null default '[]'::jsonb,
  add column if not exists service_mode text,
  add column if not exists table_name text,
  add column if not exists tab_name text,
  add column if not exists waiter_name text,
  add column if not exists cashier_id uuid,
  add column if not exists cashier_name text,
  add column if not exists shift_id uuid,
  add column if not exists ticket_status text not null default 'new';

create table if not exists public.pos_tabs (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete set null,
  table_name text,
  tab_name text,
  customer_name text,
  waiter_name text,
  room_id uuid references public.rooms(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'open',
  opened_by uuid,
  opened_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_tables (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete set null,
  name text not null,
  area text,
  seats integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (lodge_id, outlet_id, name)
);

alter table public.pos_tables enable row level security;
drop policy if exists pos_tables_lodge_scope_select on public.pos_tables;
create policy pos_tables_lodge_scope_select
  on public.pos_tables
  for select
  using (public.app_lodge_access(lodge_id));

alter table public.pos_tabs enable row level security;
drop policy if exists pos_tabs_lodge_scope_select on public.pos_tabs;
create policy pos_tabs_lodge_scope_select
  on public.pos_tabs
  for select
  using (public.app_lodge_access(lodge_id));

create table if not exists public.pos_prep_tickets (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  order_id uuid references public.pos_orders(id) on delete cascade,
  outlet_id uuid references public.outlets(id) on delete set null,
  station text not null default 'kitchen',
  status text not null default 'new',
  table_name text,
  tab_name text,
  waiter_name text,
  room_id uuid references public.rooms(id) on delete set null,
  notes text,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pos_prep_tickets enable row level security;
drop policy if exists pos_prep_tickets_lodge_scope_select on public.pos_prep_tickets;
create policy pos_prep_tickets_lodge_scope_select
  on public.pos_prep_tickets
  for select
  using (public.app_lodge_access(lodge_id));

create table if not exists public.pos_shifts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete set null,
  cashier_id uuid,
  cashier_name text,
  opening_float numeric not null default 0,
  closing_cash numeric,
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text,
  close_notes text
);

alter table public.pos_shifts enable row level security;
drop policy if exists pos_shifts_lodge_scope_select on public.pos_shifts;
create policy pos_shifts_lodge_scope_select
  on public.pos_shifts
  for select
  using (public.app_lodge_access(lodge_id));

create or replace function public._positive_depletion_qty(p_value numeric, p_fallback numeric default 1)
returns numeric
language sql
immutable
as $$
  select case
    when p_value is not null and p_value > 0 then p_value
    when p_fallback is not null and p_fallback > 0 then p_fallback
    else 1
  end;
$$;

create or replace function public.populate_pos_order_item_inventory_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_outlet_id uuid;
  v_inventory_item_id uuid;
  v_depletion_qty numeric;
begin
  if new.inventory_item_id is not null then
    new.depletion_qty := public._positive_depletion_qty(new.depletion_qty, 1);
    return new;
  end if;

  if new.menu_item_id is not null then
    select pmi.inventory_item_id,
           public._positive_depletion_qty(pmi.depletion_qty, 1)
      into v_inventory_item_id,
           v_depletion_qty
      from public.pos_menu_items pmi
     where pmi.id = new.menu_item_id
       and pmi.lodge_id = new.lodge_id;
  end if;

  if v_inventory_item_id is null and nullif(btrim(coalesce(new.item_name, '')), '') is not null then
    select po.outlet_id
      into v_outlet_id
      from public.pos_orders po
     where po.id = new.order_id
       and po.lodge_id = new.lodge_id;

    select ii.id
      into v_inventory_item_id
      from public.inventory_items ii
     where ii.lodge_id = new.lodge_id
       and lower(ii.name) = lower(new.item_name)
       and (v_outlet_id is null or ii.outlet_id = v_outlet_id or ii.outlet_id is null)
     order by case when ii.outlet_id = v_outlet_id then 0 else 1 end,
              ii.name
     limit 1;

    v_depletion_qty := public._positive_depletion_qty(new.depletion_qty, 1);
  end if;

  if v_inventory_item_id is not null then
    new.inventory_item_id := v_inventory_item_id;
    new.depletion_qty := public._positive_depletion_qty(coalesce(v_depletion_qty, new.depletion_qty), 1);
  else
    new.depletion_qty := public._positive_depletion_qty(new.depletion_qty, 1);
  end if;

  return new;
end;
$$;

create or replace function public._log_inventory_movement(
  p_lodge_id uuid,
  p_item_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_unit_cost numeric default 0,
  p_notes text default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_source text default 'system',
  p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_qty numeric := coalesce(p_quantity, 0);
  v_unit_cost numeric := coalesce(p_unit_cost, 0);
begin
  if p_item_id is null or v_qty = 0 then
    return null;
  end if;

  insert into public.inventory_movements (
    lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
    notes, reference_type, reference_id, source, created_by
  ) values (
    p_lodge_id, p_item_id, coalesce(nullif(p_movement_type, ''), 'adjustment'),
    v_qty, v_unit_cost, v_qty * v_unit_cost,
    nullif(p_notes, ''), nullif(p_reference_type, ''), p_reference_id,
    coalesce(nullif(p_source, ''), 'system'), p_created_by
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.log_inventory_purchase_movement()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public._log_inventory_movement(
    new.lodge_id,
    new.item_id,
    'purchase',
    new.quantity_purchased,
    new.unit_cost,
    new.notes,
    'inventory_purchase',
    new.id,
    'purchase',
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_log_inventory_purchase_movement on public.inventory_purchases;
create trigger trg_log_inventory_purchase_movement
after insert on public.inventory_purchases
for each row execute function public.log_inventory_purchase_movement();

create or replace function public.log_inventory_opening_stock_movement()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.current_stock, 0) > 0 then
    perform public._log_inventory_movement(
      new.lodge_id,
      new.id,
      'opening_stock',
      new.current_stock,
      coalesce(new.latest_unit_cost, 0),
      'Opening stock',
      'inventory_item',
      new.id,
      'inventory',
      null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_log_inventory_opening_stock_movement on public.inventory_items;
create trigger trg_log_inventory_opening_stock_movement
after insert on public.inventory_items
for each row execute function public.log_inventory_opening_stock_movement();

create or replace function public.log_pos_order_item_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_unit_cost numeric := 0;
  v_qty numeric;
begin
  if new.inventory_item_id is null then
    return new;
  end if;

  select coalesce(latest_unit_cost, 0)
    into v_unit_cost
    from public.inventory_items
   where id = new.inventory_item_id
     and lodge_id = new.lodge_id;

  v_qty := -1 * coalesce(new.quantity, 0) * public._positive_depletion_qty(new.depletion_qty, 1);

  perform public._log_inventory_movement(
    new.lodge_id,
    new.inventory_item_id,
    case when v_qty >= 0 then 'pos_return' else 'pos_sale' end,
    v_qty,
    v_unit_cost,
    new.item_name,
    'pos_order_item',
    new.id,
    'pos',
    null
  );
  return new;
end;
$$;

drop trigger if exists trg_log_pos_order_item_inventory_movement on public.pos_order_items;
create trigger trg_log_pos_order_item_inventory_movement
after insert on public.pos_order_items
for each row execute function public.log_pos_order_item_inventory_movement();

insert into public.inventory_movements (
  lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
  notes, reference_type, reference_id, source, created_at
)
select
  ip.lodge_id,
  ip.item_id,
  'purchase',
  ip.quantity_purchased,
  coalesce(ip.unit_cost, 0),
  coalesce(ip.quantity_purchased, 0) * coalesce(ip.unit_cost, 0),
  ip.notes,
  'inventory_purchase',
  ip.id,
  'purchase',
  coalesce(ip.created_at, ip.date::timestamptz, now())
from public.inventory_purchases ip
where not exists (
  select 1
    from public.inventory_movements im
   where im.reference_type = 'inventory_purchase'
     and im.reference_id = ip.id
);

insert into public.inventory_movements (
  lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
  notes, reference_type, reference_id, source, created_at
)
select
  poi.lodge_id,
  coalesce(poi.inventory_item_id, pmi.inventory_item_id),
  case
    when (-1 * coalesce(poi.quantity, 0) * public._positive_depletion_qty(coalesce(poi.depletion_qty, pmi.depletion_qty), 1)) >= 0
      then 'pos_return'
    else 'pos_sale'
  end,
  -1 * coalesce(poi.quantity, 0) * public._positive_depletion_qty(coalesce(poi.depletion_qty, pmi.depletion_qty), 1),
  coalesce(ii.latest_unit_cost, 0),
  (-1 * coalesce(poi.quantity, 0) * public._positive_depletion_qty(coalesce(poi.depletion_qty, pmi.depletion_qty), 1)) * coalesce(ii.latest_unit_cost, 0),
  poi.item_name,
  'pos_order_item',
  poi.id,
  'pos',
  coalesce(po.created_at, now())
from public.pos_order_items poi
join public.pos_orders po
  on po.id = poi.order_id
 and po.lodge_id = poi.lodge_id
left join public.pos_menu_items pmi
  on pmi.id = poi.menu_item_id
 and pmi.lodge_id = poi.lodge_id
left join public.inventory_items ii
  on ii.id = coalesce(poi.inventory_item_id, pmi.inventory_item_id)
 and ii.lodge_id = poi.lodge_id
where coalesce(poi.inventory_item_id, pmi.inventory_item_id) is not null
  and not exists (
    select 1
      from public.inventory_movements im
     where im.reference_type = 'pos_order_item'
       and im.reference_id = poi.id
       and im.item_id = coalesce(poi.inventory_item_id, pmi.inventory_item_id)
  );

insert into public.inventory_movements (
  lodge_id, item_id, movement_type, quantity, unit_cost, total_cost,
  notes, reference_type, reference_id, source, created_at
)
select
  poi.lodge_id,
  coalesce(poi.inventory_item_id, pmi.inventory_item_id),
  'pos_void_restore',
  greatest(0, coalesce(poi.quantity, 0)) * public._positive_depletion_qty(coalesce(poi.depletion_qty, pmi.depletion_qty), 1),
  coalesce(ii.latest_unit_cost, 0),
  greatest(0, coalesce(poi.quantity, 0)) * public._positive_depletion_qty(coalesce(poi.depletion_qty, pmi.depletion_qty), 1) * coalesce(ii.latest_unit_cost, 0),
  pol.reason,
  'pos_void',
  coalesce(pol.id, po.id),
  'pos',
  coalesce(pol.created_at, po.created_at, now())
from public.pos_orders po
join public.pos_order_items poi
  on poi.order_id = po.id
 and poi.lodge_id = po.lodge_id
left join public.pos_menu_items pmi
  on pmi.id = poi.menu_item_id
 and pmi.lodge_id = poi.lodge_id
left join public.inventory_items ii
  on ii.id = coalesce(poi.inventory_item_id, pmi.inventory_item_id)
 and ii.lodge_id = poi.lodge_id
left join public.pos_override_log pol
  on pol.order_id = po.id
 and pol.lodge_id = po.lodge_id
 and pol.action = 'void'
where po.status = 'voided'
  and coalesce(poi.inventory_item_id, pmi.inventory_item_id) is not null
  and greatest(0, coalesce(poi.quantity, 0)) > 0
  and not exists (
    select 1
      from public.inventory_movements im
     where im.reference_type = 'pos_void'
       and im.reference_id = coalesce(pol.id, po.id)
       and im.item_id = coalesce(poi.inventory_item_id, pmi.inventory_item_id)
  );

create or replace function public._restore_pos_order_stock(p_order_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_line record;
  v_restored jsonb := '[]'::jsonb;
  v_delta numeric;
  v_new_stock numeric;
  v_unit_cost numeric;
begin
  for v_line in
    select
      poi.quantity,
      coalesce(poi.inventory_item_id, pmi.inventory_item_id) as inventory_item_id,
      public._positive_depletion_qty(coalesce(poi.depletion_qty, pmi.depletion_qty), 1) as depletion_qty,
      poi.item_name
    from public.pos_order_items poi
    left join public.pos_menu_items pmi
      on pmi.id = poi.menu_item_id
     and pmi.lodge_id = p_lodge_id
    where poi.order_id = p_order_id
      and poi.lodge_id = p_lodge_id
  loop
    if v_line.inventory_item_id is not null then
      v_delta := coalesce(v_line.quantity, 0) * public._positive_depletion_qty(v_line.depletion_qty, 1);

      update public.inventory_items
         set current_stock = greatest(0, coalesce(current_stock, 0) + v_delta)
       where id = v_line.inventory_item_id
         and lodge_id = p_lodge_id
       returning current_stock, coalesce(latest_unit_cost, 0)
        into v_new_stock, v_unit_cost;

      perform public._log_inventory_movement(
        p_lodge_id,
        v_line.inventory_item_id,
        'pos_void_restore',
        v_delta,
        v_unit_cost,
        v_line.item_name,
        'pos_void',
        p_order_id,
        'pos',
        null
      );

      v_restored := v_restored || jsonb_build_array(jsonb_build_object(
        'inventory_item_id', v_line.inventory_item_id,
        'restored_qty', v_delta,
        'new_stock', v_new_stock
      ));
    end if;
  end loop;

  return v_restored;
end;
$$;

create or replace function public.create_pos_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id                uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id                uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id               uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_room_id                 uuid := nullif(payload->>'room_id', '')::uuid;
  v_booking_id              uuid := nullif(payload->>'booking_id', '')::uuid;
  v_walk_in_name            text := nullif(payload->>'walk_in_name', '');
  v_notes                   text := nullif(payload->>'notes', '');
  v_payment_method          text := coalesce(nullif(payload->>'payment_method', ''), 'cash');
  v_gross_total             numeric := coalesce(nullif(payload->>'gross_total', '')::numeric, 0);
  v_discount_total          numeric := coalesce(nullif(payload->>'discount_total', '')::numeric, 0);
  v_tax_rate                numeric := coalesce(nullif(payload->>'tax_rate', '')::numeric, 0);
  v_tax_total               numeric := coalesce(nullif(payload->>'tax_total', '')::numeric, 0);
  v_tip_total               numeric := coalesce(nullif(payload->>'tip_total', '')::numeric, 0);
  v_payment_breakdown       jsonb := coalesce(payload->'payment_breakdown', '[]'::jsonb);
  v_service_mode            text := nullif(payload->>'service_mode', '');
  v_table_name              text := nullif(payload->>'table_name', '');
  v_tab_name                text := nullif(payload->>'tab_name', '');
  v_waiter_name             text := nullif(payload->>'waiter_name', '');
  v_cashier_id              uuid := nullif(payload->>'cashier_id', '')::uuid;
  v_cashier_name            text := nullif(payload->>'cashier_name', '');
  v_shift_id                uuid := nullif(payload->>'shift_id', '')::uuid;
  v_ticket_status           text := coalesce(nullif(payload->>'ticket_status', ''), 'new');
  v_create_idempotency_key  text := nullif(payload->>'create_idempotency_key', '');
  v_created_at_client       timestamptz := nullif(payload->>'created_at_client', '')::timestamptz;
  v_is_replay               boolean := v_create_idempotency_key is not null or payload ? 'created_at_client';
  v_existing_id             uuid;
  v_existing_total          numeric;
  v_existing_charge_id      uuid;
  v_item                    jsonb;
  v_menu_item_id            uuid;
  v_inv_item_id             uuid;
  v_depletion_qty           numeric;
  v_quantity                numeric;
  v_db_price                numeric;
  v_unit_price              numeric;
  v_item_name               text;
  v_computed_total          numeric := 0;
  v_is_available            boolean;
  v_required_stock          numeric;
  v_new_stock               numeric;
  v_folio_charge_id         uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  if v_payment_method = 'folio' and v_booking_id is null and v_room_id is not null then
    select b.id
      into v_booking_id
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.room_id = v_room_id
       and b.status in ('confirmed', 'checked_in')
       and b.check_in <= current_date
       and b.check_out > current_date
     order by b.check_in desc, b.created_at desc
     limit 1;
  end if;

  if v_payment_method = 'folio' then
    if v_booking_id is null then
      return jsonb_build_object('success', false, 'error', 'Room folio charge requires an active booking');
    end if;

    if not exists (
      select 1
        from public.bookings b
       where b.id = v_booking_id
         and b.lodge_id = v_lodge_id
         and b.status in ('confirmed', 'checked_in')
    ) then
      return jsonb_build_object('success', false, 'error', 'Active booking not found for folio charge');
    end if;
  end if;

  if v_create_idempotency_key is not null then
    select id, total, folio_charge_id
      into v_existing_id, v_existing_total, v_existing_charge_id
      from public.pos_orders
     where lodge_id = v_lodge_id
       and create_idempotency_key = v_create_idempotency_key
     for update;

    if found then
      if v_payment_method = 'folio' and v_existing_charge_id is null then
        return jsonb_build_object('success', false, 'error', 'Existing folio POS order is missing its booking charge and needs review');
      end if;

      return jsonb_build_object(
        'success', true,
        'id', v_existing_id,
        'total', coalesce(v_existing_total, 0),
        'idempotent', true,
        'replayed', true
      );
    end if;
  end if;

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');
    v_inv_item_id := null;
    v_depletion_qty := public._positive_depletion_qty(nullif(v_item->>'depletion_qty', '')::numeric, 1);

    if v_menu_item_id is not null then
      select price,
             inventory_item_id,
             public._positive_depletion_qty(depletion_qty, 1),
             coalesce(is_available, true)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty,
             v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if found then
        if not v_is_available then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;

        v_unit_price := case
          when v_is_replay then coalesce((v_item->>'unit_price')::numeric, 0)
          else v_db_price
        end;
      elsif v_is_replay then
        v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
        v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
        v_depletion_qty := public._positive_depletion_qty(nullif(v_item->>'depletion_qty', '')::numeric, 1);
        if v_inv_item_id is null then
          select case when count(*) = 1 then max(id) else null end
            into v_inv_item_id
            from public.inventory_items
           where lodge_id = v_lodge_id
             and name = v_item_name
             and (v_outlet_id is null or outlet_id = v_outlet_id);
        end if;
      else
        raise exception 'POS menu item % not found for lodge % - order rejected', v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
      v_depletion_qty := public._positive_depletion_qty(nullif(v_item->>'depletion_qty', '')::numeric, 1);
      if v_inv_item_id is null then
        select case when count(*) = 1 then max(id) else null end
          into v_inv_item_id
          from public.inventory_items
         where lodge_id = v_lodge_id
           and name = v_item_name
           and (v_outlet_id is null or outlet_id = v_outlet_id);
      end if;
    end if;

    v_computed_total := v_computed_total + (v_quantity * v_unit_price);
  end loop;

  v_computed_total := v_computed_total + v_tax_total + v_tip_total;

  insert into public.pos_orders (
    id,
    lodge_id,
    room_id,
    booking_id,
    walk_in_name,
    total,
    notes,
    payment_method,
    gross_total,
    discount_total,
    tax_rate,
    tax_total,
    tip_total,
    payment_breakdown,
    service_mode,
    table_name,
    tab_name,
    waiter_name,
    cashier_id,
    cashier_name,
    shift_id,
    ticket_status,
    outlet_id,
    status,
    created_at,
    create_idempotency_key,
    folio_charge_id
  ) values (
    v_order_id,
    v_lodge_id,
    v_room_id,
    v_booking_id,
    v_walk_in_name,
    v_computed_total,
    v_notes,
    v_payment_method,
    coalesce(nullif(v_gross_total, 0), greatest(v_computed_total - v_tax_total - v_tip_total + v_discount_total, 0)),
    v_discount_total,
    v_tax_rate,
    v_tax_total,
    v_tip_total,
    v_payment_breakdown,
    v_service_mode,
    v_table_name,
    v_tab_name,
    v_waiter_name,
    v_cashier_id,
    v_cashier_name,
    v_shift_id,
    v_ticket_status,
    v_outlet_id,
    'completed',
    coalesce(v_created_at_client, now()),
    v_create_idempotency_key,
    null
  );

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');
    v_inv_item_id := null;
    v_depletion_qty := public._positive_depletion_qty(nullif(v_item->>'depletion_qty', '')::numeric, 1);

    if v_menu_item_id is not null then
      select price,
             inventory_item_id,
             public._positive_depletion_qty(depletion_qty, 1),
             coalesce(is_available, true)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty,
             v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if found then
        if not v_is_available then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;

        v_unit_price := case
          when v_is_replay then coalesce((v_item->>'unit_price')::numeric, 0)
          else v_db_price
        end;
      elsif v_is_replay then
        v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
        v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
        v_depletion_qty := public._positive_depletion_qty(nullif(v_item->>'depletion_qty', '')::numeric, 1);
        if v_inv_item_id is null then
          select case when count(*) = 1 then max(id) else null end
            into v_inv_item_id
            from public.inventory_items
           where lodge_id = v_lodge_id
             and name = v_item_name
             and (v_outlet_id is null or outlet_id = v_outlet_id);
        end if;
      else
        raise exception 'POS menu item % not found for lodge % - order rejected', v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
      v_depletion_qty := public._positive_depletion_qty(nullif(v_item->>'depletion_qty', '')::numeric, 1);
      if v_inv_item_id is null then
        select case when count(*) = 1 then max(id) else null end
          into v_inv_item_id
          from public.inventory_items
         where lodge_id = v_lodge_id
           and name = v_item_name
           and (v_outlet_id is null or outlet_id = v_outlet_id);
      end if;
    end if;

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id,
      item_name, quantity, unit_price, subtotal,
      inventory_item_id, depletion_qty, category, modifiers, item_notes
    ) values (
      gen_random_uuid(),
      v_order_id,
      v_lodge_id,
      v_menu_item_id,
      v_item_name,
      v_quantity,
      v_unit_price,
      v_quantity * v_unit_price,
      v_inv_item_id,
      case when v_inv_item_id is not null then public._positive_depletion_qty(v_depletion_qty, 1) else 1 end,
      nullif(v_item->>'category', ''),
      coalesce(v_item->'modifiers', '[]'::jsonb),
      nullif(v_item->>'item_notes', '')
    );

    if v_inv_item_id is not null then
      v_required_stock := public._positive_depletion_qty(v_depletion_qty, 1) * v_quantity;

      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) - v_required_stock
       where id = v_inv_item_id
         and lodge_id = v_lodge_id
         and (v_required_stock <= 0 or coalesce(current_stock, 0) >= v_required_stock)
      returning current_stock into v_new_stock;

      if not found then
        raise exception 'Not enough stock left for %. Refresh the POS and try again.', v_item_name;
      end if;
    end if;
  end loop;

  if v_payment_method = 'folio' then
    insert into public.booking_charges (
      booking_id,
      lodge_id,
      description,
      category,
      quantity,
      amount,
      outlet_id
    ) values (
      v_booking_id,
      v_lodge_id,
      'POS folio charge - order ' || left(v_order_id::text, 8),
      'pos',
      1,
      v_computed_total,
      v_outlet_id
    )
    returning id into v_folio_charge_id;

    update public.pos_orders
       set folio_charge_id = v_folio_charge_id
     where id = v_order_id
       and lodge_id = v_lodge_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'total', v_computed_total,
    'booking_id', v_booking_id,
    'folio_charge_id', v_folio_charge_id
  );
end;
$$;

create or replace function public.get_pos_sales_summary(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_selector text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_total_revenue numeric := 0;
  v_gross_revenue numeric := 0;
  v_discount_total numeric := 0;
  v_returns_total numeric := 0;
  v_tax_total numeric := 0;
  v_tip_total numeric := 0;
  v_folio_revenue numeric := 0;
  v_total_orders integer := 0;
  v_avg_order numeric := 0;
  v_by_payment jsonb := '{}'::jsonb;
  v_by_cashier jsonb := '{}'::jsonb;
  v_top_items jsonb := '[]'::jsonb;
  v_daily jsonb := '[]'::jsonb;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  with filtered_orders as (
    select po.*
    from public.pos_orders po
    where po.lodge_id = p_lodge_id
      and po.status = 'completed'
      and po.created_at >= p_start_date::timestamptz
      and po.created_at < (p_end_date + 1)::timestamptz
      and (
        coalesce(p_outlet_selector, 'all') = 'all'
        or (p_outlet_selector = 'unassigned' and po.outlet_id is null)
        or po.outlet_id::text = p_outlet_selector
      )
  ),
  payment_rows as (
    select method, sum(amount) as total
    from (
      select
        coalesce(nullif(payment->>'method', ''), nullif(trim(fo.payment_method), ''), 'cash') as method,
        coalesce(nullif(payment->>'amount', '')::numeric, 0) as amount
      from filtered_orders fo
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(coalesce(fo.payment_breakdown, '[]'::jsonb)) = 'array'
               and jsonb_array_length(coalesce(fo.payment_breakdown, '[]'::jsonb)) > 0
             then fo.payment_breakdown
             else jsonb_build_array(jsonb_build_object('method', coalesce(nullif(trim(fo.payment_method), ''), 'cash'), 'amount', fo.total))
        end
      ) payment
    ) payments
    group by method
  ),
  cashier_rows as (
    select coalesce(nullif(cashier_name, ''), cashier_id::text, 'Unassigned') as cashier, sum(total) as total
    from filtered_orders
    group by coalesce(nullif(cashier_name, ''), cashier_id::text, 'Unassigned')
  ),
  daily_rows as (
    select to_char(created_at::date, 'YYYY-MM-DD') as date, sum(total) as total
    from filtered_orders
    group by created_at::date
    order by created_at::date
  ),
  item_rows as (
    select
      coalesce(ii.name, pmi.name, poi.item_name, 'Unknown item') as item_name,
      sum(coalesce(poi.quantity, 0) * coalesce(poi.depletion_qty, pmi.template_pack_size, pmi.depletion_qty, 1)) as qty,
      sum(coalesce(poi.subtotal, 0)) as revenue,
      sum(greatest(coalesce(poi.quantity, 0), 0) * coalesce(poi.depletion_qty, pmi.template_pack_size, pmi.depletion_qty, 1) * coalesce(ii.latest_unit_cost, 0)) as cost
    from filtered_orders fo
    join public.pos_order_items poi on poi.order_id = fo.id
    left join public.pos_menu_items pmi on pmi.id = poi.menu_item_id
    left join public.inventory_items ii on ii.id = coalesce(poi.inventory_item_id, pmi.inventory_item_id)
    group by coalesce(ii.name, pmi.name, poi.item_name, 'Unknown item')
    order by sum(coalesce(poi.subtotal, 0)) desc, coalesce(ii.name, pmi.name, poi.item_name, 'Unknown item') asc
    limit 15
  )
  select
    coalesce(sum(total), 0),
    coalesce(sum(coalesce(nullif(gross_total, 0), case when total > 0 then total else 0 end)), 0),
    coalesce(sum(discount_total), 0),
    coalesce(sum(case when total < 0 then abs(total) else 0 end), 0),
    coalesce(sum(tax_total), 0),
    coalesce(sum(tip_total), 0),
    coalesce(sum(case when coalesce(payment_method, '') = 'folio' then total else 0 end), 0),
    count(*),
    coalesce((select jsonb_object_agg(method, total) from payment_rows), '{}'::jsonb),
    coalesce((select jsonb_object_agg(cashier, total) from cashier_rows), '{}'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('name', item_name, 'qty', qty, 'revenue', revenue, 'cost', cost, 'margin', revenue - cost) order by revenue desc, item_name asc) from item_rows), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('date', date, 'total', total) order by date asc) from daily_rows), '[]'::jsonb)
    into v_total_revenue, v_gross_revenue, v_discount_total, v_returns_total, v_tax_total, v_tip_total,
         v_folio_revenue, v_total_orders, v_by_payment, v_by_cashier, v_top_items, v_daily
  from filtered_orders;

  if v_total_orders > 0 then
    v_avg_order := v_total_revenue / v_total_orders;
  end if;

  return jsonb_build_object(
    'total_revenue', coalesce(v_total_revenue, 0),
    'gross_revenue', coalesce(v_gross_revenue, 0),
    'discount_total', coalesce(v_discount_total, 0),
    'returns_total', coalesce(v_returns_total, 0),
    'tax_total', coalesce(v_tax_total, 0),
    'tip_total', coalesce(v_tip_total, 0),
    'net_revenue', coalesce(v_total_revenue, 0),
    'folio_revenue', coalesce(v_folio_revenue, 0),
    'direct_revenue', coalesce(v_total_revenue, 0) - coalesce(v_folio_revenue, 0),
    'total_orders', coalesce(v_total_orders, 0),
    'avg_order', coalesce(v_avg_order, 0),
    'by_payment', coalesce(v_by_payment, '{}'::jsonb),
    'by_cashier', coalesce(v_by_cashier, '{}'::jsonb),
    'top_items', coalesce(v_top_items, '[]'::jsonb),
    'daily', coalesce(v_daily, '[]'::jsonb)
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
declare
  v_new_stock numeric;
  v_unit_cost numeric;
  v_actor_raw text := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor uuid := case when v_actor_raw ~ '^[0-9a-fA-F-]{36}$' then v_actor_raw::uuid else null end;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  if coalesce(p_delta, 0) = 0 then
    return jsonb_build_object('success', false, 'error', 'Adjustment quantity is required');
  end if;

  update public.inventory_items
     set current_stock = greatest(0, coalesce(current_stock, 0) + coalesce(p_delta, 0))
   where id = p_item_id
     and lodge_id = p_lodge_id
  returning current_stock, coalesce(latest_unit_cost, 0)
    into v_new_stock, v_unit_cost;

  if v_new_stock is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  perform public._log_inventory_movement(
    p_lodge_id,
    p_item_id,
    case when p_delta >= 0 then 'adjustment_increase' else 'adjustment_decrease' end,
    p_delta,
    v_unit_cost,
    p_notes,
    'inventory_adjustment',
    gen_random_uuid(),
    'adjustment',
    v_actor
  );

  return jsonb_build_object('success', true, 'new_stock', v_new_stock);
end;
$$;

create table if not exists public.pos_cashup_sessions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  date date not null,
  outlet_id uuid references public.outlets(id) on delete set null,
  opening_float numeric not null default 0,
  expected_cash_drawer numeric not null default 0,
  expected_by_method jsonb not null default '{}'::jsonb,
  counted_by_method jsonb not null default '{}'::jsonb,
  variance_by_method jsonb not null default '{}'::jsonb,
  cash_over_short numeric not null default 0,
  orders_count integer not null default 0,
  void_count integer not null default 0,
  pending_count integer not null default 0,
  gross_sales numeric not null default 0,
  returns_total numeric not null default 0,
  net_sales numeric not null default 0,
  notes text,
  created_by uuid,
  created_by_name text,
  cashier_id uuid,
  cashier_name text,
  created_at timestamptz not null default now()
);

alter table public.pos_cashup_sessions
  add column if not exists created_by_name text,
  add column if not exists cashier_id uuid,
  add column if not exists cashier_name text;

create index if not exists idx_pos_cashup_sessions_lodge_created
  on public.pos_cashup_sessions (lodge_id, created_at desc);

create index if not exists idx_pos_cashup_sessions_lodge_date_outlet
  on public.pos_cashup_sessions (lodge_id, date, outlet_id);

create index if not exists idx_pos_cashup_sessions_lodge_cashier
  on public.pos_cashup_sessions (lodge_id, cashier_id, created_at desc);

alter table public.pos_cashup_sessions enable row level security;

drop policy if exists pos_cashup_sessions_lodge_scope_select on public.pos_cashup_sessions;
create policy pos_cashup_sessions_lodge_scope_select
  on public.pos_cashup_sessions
  for select
  using (public.app_lodge_access(lodge_id));

create or replace function public.upsert_pos_cashup(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  insert into public.pos_cashup_sessions (
    id, lodge_id, date, outlet_id, opening_float, expected_cash_drawer,
    expected_by_method, counted_by_method, variance_by_method, cash_over_short,
    orders_count, void_count, pending_count, gross_sales, returns_total,
    net_sales, notes, created_by, created_by_name, cashier_id, cashier_name, created_at
  ) values (
    v_id,
    v_lodge_id,
    coalesce(nullif(payload->>'date', '')::date, current_date),
    v_outlet_id,
    coalesce(nullif(payload->>'opening_float', '')::numeric, 0),
    coalesce(nullif(payload->>'expected_cash_drawer', '')::numeric, 0),
    coalesce(payload->'expected_by_method', '{}'::jsonb),
    coalesce(payload->'counted_by_method', '{}'::jsonb),
    coalesce(payload->'variance_by_method', '{}'::jsonb),
    coalesce(nullif(payload->>'cash_over_short', '')::numeric, 0),
    coalesce(nullif(payload->>'orders_count', '')::integer, 0),
    coalesce(nullif(payload->>'void_count', '')::integer, 0),
    coalesce(nullif(payload->>'pending_count', '')::integer, 0),
    coalesce(nullif(payload->>'gross_sales', '')::numeric, 0),
    coalesce(nullif(payload->>'returns_total', '')::numeric, 0),
    coalesce(nullif(payload->>'net_sales', '')::numeric, 0),
    nullif(payload->>'notes', ''),
    nullif(payload->>'created_by', '')::uuid,
    nullif(payload->>'created_by_name', ''),
    nullif(payload->>'cashier_id', '')::uuid,
    nullif(payload->>'cashier_name', ''),
    coalesce(nullif(payload->>'created_at', '')::timestamptz, now())
  )
  on conflict (id) do update set
    opening_float = excluded.opening_float,
    expected_cash_drawer = excluded.expected_cash_drawer,
    expected_by_method = excluded.expected_by_method,
    counted_by_method = excluded.counted_by_method,
    variance_by_method = excluded.variance_by_method,
    cash_over_short = excluded.cash_over_short,
    orders_count = excluded.orders_count,
    void_count = excluded.void_count,
    pending_count = excluded.pending_count,
    gross_sales = excluded.gross_sales,
    returns_total = excluded.returns_total,
    net_sales = excluded.net_sales,
    notes = excluded.notes,
    created_by_name = excluded.created_by_name,
    cashier_id = excluded.cashier_id,
    cashier_name = excluded.cashier_name;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

grant select on public.inventory_movements to anon, authenticated, service_role;
grant select on public.pos_cashup_sessions to anon, authenticated, service_role;
grant select on public.pos_tabs to anon, authenticated, service_role;
grant select on public.pos_tables to anon, authenticated, service_role;
grant select on public.pos_prep_tickets to anon, authenticated, service_role;
grant select on public.pos_shifts to anon, authenticated, service_role;

revoke all on function public._positive_depletion_qty(numeric, numeric) from public;
grant execute on function public._positive_depletion_qty(numeric, numeric) to anon, authenticated, service_role;

revoke all on function public.upsert_pos_cashup(jsonb) from public;
grant execute on function public.upsert_pos_cashup(jsonb) to anon, authenticated, service_role;

revoke all on function public.adjust_inventory_stock(uuid, uuid, numeric, text) from public;
grant execute on function public.adjust_inventory_stock(uuid, uuid, numeric, text) to anon, authenticated, service_role;

revoke all on function public.get_pos_sales_summary(uuid, date, date, text) from public;
grant execute on function public.get_pos_sales_summary(uuid, date, date, text) to anon, authenticated, service_role;
