-- Legacy POS database contract
--
-- This migration is intentionally additive and idempotent. It installs the
-- RPC/table contract used by the Windows 7 POS app without changing the main
-- desktop/PWA mutation paths outside their existing canonical RPC functions.

begin;

-- Required columns and source-of-truth tables.

alter table public.users
  add column if not exists pin_hash text;

alter table public.inventory_items
  add column if not exists selling_price numeric not null default 0;

alter table public.pos_menu_items
  add column if not exists barcode text,
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists depletion_qty numeric,
  add column if not exists outlet_id uuid references public.outlets(id) on delete set null,
  add column if not exists auto_from_inventory boolean not null default false,
  add column if not exists template_kind text not null default 'standard',
  add column if not exists template_pack_size integer,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.pos_order_items
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists depletion_qty numeric not null default 1,
  add column if not exists category text,
  add column if not exists modifiers jsonb not null default '[]'::jsonb,
  add column if not exists item_notes text;

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
  add column if not exists ticket_status text not null default 'new',
  add column if not exists outlet_id uuid references public.outlets(id) on delete set null,
  add column if not exists create_idempotency_key text,
  add column if not exists folio_charge_id uuid;

do $$
begin
  if exists (
    select 1
      from information_schema.tables
     where table_schema = 'public'
       and table_name = 'booking_charges'
  ) and not exists (
    select 1
      from pg_constraint
     where conname = 'pos_orders_folio_charge_id_fkey'
       and conrelid = 'public.pos_orders'::regclass
  ) then
    alter table public.pos_orders
      add constraint pos_orders_folio_charge_id_fkey
      foreign key (folio_charge_id) references public.booking_charges(id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
      from public.pos_orders
     where create_idempotency_key is not null
     group by lodge_id, create_idempotency_key
    having count(*) > 1
  ) then
    create index if not exists idx_pos_orders_lodge_idempotency
      on public.pos_orders (lodge_id, create_idempotency_key)
      where create_idempotency_key is not null;
    raise notice 'Duplicate POS idempotency keys exist; created non-unique index only.';
  else
    create unique index if not exists pos_orders_lodge_idempotency_uidx
      on public.pos_orders (lodge_id, create_idempotency_key)
      where create_idempotency_key is not null;
  end if;
end $$;

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

create table if not exists public.pos_override_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  order_id uuid,
  action text not null default 'void',
  requested_by uuid,
  approved_by uuid,
  reason text,
  outlet_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_pos_override_log_lodge_order
  on public.pos_override_log (lodge_id, order_id, created_at desc);

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
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table public.pos_tabs
  add column if not exists closed_at timestamptz;

create index if not exists idx_pos_tabs_lodge_status
  on public.pos_tabs (lodge_id, status, updated_at desc);
create unique index if not exists pos_tabs_one_open_table_uidx
  on public.pos_tabs (
    lodge_id,
    coalesce(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(table_name))
  )
  where table_name is not null
    and status in ('open', 'running', 'ready', 'delivered');

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

create index if not exists idx_pos_prep_tickets_lodge_status
  on public.pos_prep_tickets (lodge_id, status, created_at desc);
create index if not exists idx_pos_prep_tickets_lodge_station
  on public.pos_prep_tickets (lodge_id, station, created_at desc);

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

create index if not exists idx_pos_shifts_lodge_status
  on public.pos_shifts (lodge_id, status, opened_at desc);
create index if not exists idx_pos_shifts_lodge_cashier
  on public.pos_shifts (lodge_id, cashier_id, opened_at desc);

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

create index if not exists idx_pos_cashup_sessions_lodge_created
  on public.pos_cashup_sessions (lodge_id, created_at desc);
create index if not exists idx_pos_cashup_sessions_lodge_date_outlet
  on public.pos_cashup_sessions (lodge_id, date, outlet_id);
create index if not exists idx_pos_cashup_sessions_lodge_cashier
  on public.pos_cashup_sessions (lodge_id, cashier_id, created_at desc);

create table if not exists public.pos_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete cascade,
  name text not null,
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  max_select integer not null default 1,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_promotions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete cascade,
  name text not null,
  discount_type text not null default 'amount',
  discount_value numeric not null default 0,
  applies_to_category text,
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.pos_floor_layouts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete cascade,
  layout jsonb not null default '{"areas":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (lodge_id, outlet_id)
);

create table if not exists public.pos_customer_display_snapshots (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (lodge_id, outlet_id)
);

create table if not exists public.pos_audit_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid,
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  before_snapshot jsonb,
  after_snapshot jsonb,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pos_audit_log_lodge_created
  on public.pos_audit_log (lodge_id, created_at desc);

alter table public.pos_tables enable row level security;
alter table public.pos_tabs enable row level security;
alter table public.pos_prep_tickets enable row level security;
alter table public.pos_shifts enable row level security;
alter table public.pos_cashup_sessions enable row level security;
alter table public.pos_modifier_groups enable row level security;
alter table public.pos_promotions enable row level security;
alter table public.pos_floor_layouts enable row level security;
alter table public.pos_customer_display_snapshots enable row level security;
alter table public.pos_audit_log enable row level security;

drop policy if exists pos_tables_lodge_scope_select on public.pos_tables;
create policy pos_tables_lodge_scope_select on public.pos_tables for select using (public.app_lodge_access(lodge_id));
drop policy if exists pos_tabs_lodge_scope_select on public.pos_tabs;
create policy pos_tabs_lodge_scope_select on public.pos_tabs for select using (public.app_lodge_access(lodge_id));
drop policy if exists pos_prep_tickets_lodge_scope_select on public.pos_prep_tickets;
create policy pos_prep_tickets_lodge_scope_select on public.pos_prep_tickets for select using (public.app_lodge_access(lodge_id));
drop policy if exists pos_shifts_lodge_scope_select on public.pos_shifts;
create policy pos_shifts_lodge_scope_select on public.pos_shifts for select using (public.app_lodge_access(lodge_id));
drop policy if exists pos_cashup_sessions_lodge_scope_select on public.pos_cashup_sessions;
create policy pos_cashup_sessions_lodge_scope_select on public.pos_cashup_sessions for select using (public.app_lodge_access(lodge_id));
drop policy if exists pos_modifier_groups_lodge_scope_select on public.pos_modifier_groups;
create policy pos_modifier_groups_lodge_scope_select on public.pos_modifier_groups for select using (public.app_lodge_access(lodge_id));
drop policy if exists pos_promotions_lodge_scope_select on public.pos_promotions;
create policy pos_promotions_lodge_scope_select on public.pos_promotions for select using (public.app_lodge_access(lodge_id));
drop policy if exists pos_floor_layouts_lodge_scope_select on public.pos_floor_layouts;
create policy pos_floor_layouts_lodge_scope_select on public.pos_floor_layouts for select using (public.app_lodge_access(lodge_id));
drop policy if exists pos_customer_display_snapshots_lodge_scope_select on public.pos_customer_display_snapshots;
create policy pos_customer_display_snapshots_lodge_scope_select on public.pos_customer_display_snapshots for select using (public.app_lodge_access(lodge_id));
drop policy if exists pos_audit_log_lodge_scope_select on public.pos_audit_log;
create policy pos_audit_log_lodge_scope_select on public.pos_audit_log for select using (public.app_lodge_access(lodge_id));

-- Helper functions.

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

create or replace function public._restore_pos_order_stock(p_order_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_line record;
  v_delta numeric;
  v_new_stock numeric;
  v_unit_cost numeric := 0;
  v_restored jsonb := '[]'::jsonb;
begin
  for v_line in
    select id, inventory_item_id, quantity, depletion_qty, item_name
      from public.pos_order_items
     where order_id = p_order_id
       and lodge_id = p_lodge_id
       and inventory_item_id is not null
  loop
    v_delta := coalesce(v_line.quantity, 0) * public._positive_depletion_qty(v_line.depletion_qty, 1);

    if v_delta <> 0 then
      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) + v_delta
       where id = v_line.inventory_item_id
         and lodge_id = p_lodge_id
      returning current_stock, coalesce(latest_unit_cost, 0)
        into v_new_stock, v_unit_cost;

      perform public._log_inventory_movement(
        p_lodge_id,
        v_line.inventory_item_id,
        case when v_delta >= 0 then 'pos_void_restore' else 'pos_void_reversal' end,
        v_delta,
        v_unit_cost,
        coalesce(v_line.item_name, 'POS void'),
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

-- POS order creation: server authoritative totals, inventory, folio charges,
-- prep ticket creation, and idempotent replay.

create or replace function public.create_pos_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_room_id uuid := nullif(payload->>'room_id', '')::uuid;
  v_booking_id uuid := nullif(payload->>'booking_id', '')::uuid;
  v_walk_in_name text := nullif(payload->>'walk_in_name', '');
  v_notes text := nullif(payload->>'notes', '');
  v_payment_method text := coalesce(nullif(payload->>'payment_method', ''), 'cash');
  v_client_gross_total numeric := coalesce(nullif(payload->>'gross_total', '')::numeric, 0);
  v_discount_total numeric := greatest(0, coalesce(nullif(payload->>'discount_total', '')::numeric, 0));
  v_tax_rate numeric := greatest(0, coalesce(nullif(payload->>'tax_rate', '')::numeric, 0));
  v_tax_total numeric := greatest(0, coalesce(nullif(payload->>'tax_total', '')::numeric, 0));
  v_tip_total numeric := greatest(0, coalesce(nullif(payload->>'tip_total', '')::numeric, 0));
  v_payment_breakdown jsonb := coalesce(payload->'payment_breakdown', '[]'::jsonb);
  v_service_mode text := nullif(payload->>'service_mode', '');
  v_table_name text := nullif(payload->>'table_name', '');
  v_tab_name text := nullif(payload->>'tab_name', '');
  v_waiter_name text := nullif(payload->>'waiter_name', '');
  v_cashier_id uuid := nullif(payload->>'cashier_id', '')::uuid;
  v_cashier_name text := nullif(payload->>'cashier_name', '');
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_ticket_status text := coalesce(nullif(payload->>'ticket_status', ''), 'new');
  v_create_idempotency_key text := nullif(payload->>'create_idempotency_key', '');
  v_created_at_client timestamptz := nullif(payload->>'created_at_client', '')::timestamptz;
  v_is_replay boolean := v_create_idempotency_key is not null or payload ? 'created_at_client';
  v_existing_id uuid;
  v_existing_total numeric;
  v_existing_charge_id uuid;
  v_item jsonb;
  v_menu_item_id uuid;
  v_inv_item_id uuid;
  v_depletion_qty numeric;
  v_quantity numeric;
  v_db_price numeric;
  v_unit_price numeric;
  v_item_name text;
  v_line_subtotal numeric;
  v_positive_gross numeric := 0;
  v_computed_total numeric := 0;
  v_discount_to_apply numeric;
  v_payment_total numeric := 0;
  v_is_available boolean;
  v_required_stock numeric;
  v_new_stock numeric;
  v_folio_charge_id uuid;
  v_station text := 'kitchen';
  v_outlet_type text;
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one POS item is required.');
  end if;

  if jsonb_typeof(v_payment_breakdown) <> 'array' then
    v_payment_breakdown := '[]'::jsonb;
  end if;

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
     order by created_at desc
     limit 1
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

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');
    v_inv_item_id := null;
    v_depletion_qty := public._positive_depletion_qty(nullif(v_item->>'depletion_qty', '')::numeric, 1);

    if v_quantity = 0 then
      return jsonb_build_object('success', false, 'error', 'POS item quantity cannot be zero.');
    end if;

    if v_menu_item_id is not null then
      select price, inventory_item_id, public._positive_depletion_qty(depletion_qty, 1), coalesce(is_available, true)
        into v_db_price, v_inv_item_id, v_depletion_qty, v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if found then
        if not v_is_available and v_quantity > 0 then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;
        v_unit_price := case when v_is_replay then coalesce(nullif(v_item->>'unit_price', '')::numeric, 0) else v_db_price end;
      elsif v_is_replay then
        v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
        v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
      else
        raise exception 'POS menu item % not found for lodge % - order rejected', v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
      v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
    end if;

    if v_inv_item_id is null and nullif(v_item_name, '') is not null then
      select case when count(*) = 1 then max(id) else null end
        into v_inv_item_id
        from public.inventory_items
       where lodge_id = v_lodge_id
         and name = v_item_name
         and (v_outlet_id is null or outlet_id = v_outlet_id);
    end if;

    v_line_subtotal := round((v_quantity * v_unit_price)::numeric, 2);
    v_computed_total := v_computed_total + v_line_subtotal;
    if v_line_subtotal > 0 then
      v_positive_gross := v_positive_gross + v_line_subtotal;
    end if;
  end loop;

  v_discount_to_apply := least(v_discount_total, greatest(v_positive_gross, 0));
  if v_computed_total >= 0 then
    v_computed_total := round(greatest(0, v_computed_total - v_discount_to_apply) + v_tax_total + v_tip_total, 2);
  else
    v_computed_total := round(v_computed_total + v_tax_total + v_tip_total, 2);
  end if;

  select coalesce(sum(coalesce((p.value->>'amount')::numeric, 0)), 0)
    into v_payment_total
    from jsonb_array_elements(v_payment_breakdown) as p(value);

  if v_payment_method <> 'folio' and v_computed_total > 0 and abs(v_payment_total - v_computed_total) > 0.01 then
    return jsonb_build_object(
      'success', false,
      'error', format('Payment total %s does not match order total %s.', round(v_payment_total, 2), round(v_computed_total, 2))
    );
  end if;

  if v_outlet_id is not null then
    select lower(coalesce(type, '')) into v_outlet_type
      from public.outlets
     where id = v_outlet_id
       and lodge_id = v_lodge_id;
    if v_outlet_type = 'beverage' then
      v_station := 'bar';
    elsif v_outlet_type in ('food', 'kitchen', 'restaurant') then
      v_station := 'kitchen';
    end if;
  end if;

  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name, total, notes, payment_method,
    gross_total, discount_total, tax_rate, tax_total, tip_total, payment_breakdown,
    service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name,
    shift_id, ticket_status, outlet_id, status, created_at, create_idempotency_key,
    folio_charge_id
  ) values (
    v_order_id, v_lodge_id, v_room_id, v_booking_id, v_walk_in_name, v_computed_total,
    v_notes, v_payment_method,
    coalesce(nullif(v_client_gross_total, 0), v_positive_gross),
    v_discount_to_apply, v_tax_rate, v_tax_total, v_tip_total, v_payment_breakdown,
    v_service_mode, v_table_name, v_tab_name, v_waiter_name, v_cashier_id,
    v_cashier_name, v_shift_id, v_ticket_status, v_outlet_id, 'completed',
    coalesce(v_created_at_client, now()), v_create_idempotency_key, null
  );

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');
    v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
    v_depletion_qty := public._positive_depletion_qty(nullif(v_item->>'depletion_qty', '')::numeric, 1);

    if v_menu_item_id is not null then
      select price, inventory_item_id, public._positive_depletion_qty(depletion_qty, 1), coalesce(is_available, true)
        into v_db_price, v_inv_item_id, v_depletion_qty, v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;
      if found then
        v_unit_price := case when v_is_replay then coalesce(nullif(v_item->>'unit_price', '')::numeric, 0) else v_db_price end;
      else
        v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
      end if;
    else
      v_unit_price := coalesce(nullif(v_item->>'unit_price', '')::numeric, 0);
    end if;

    if v_inv_item_id is null and nullif(v_item_name, '') is not null then
      select case when count(*) = 1 then max(id) else null end
        into v_inv_item_id
        from public.inventory_items
       where lodge_id = v_lodge_id
         and name = v_item_name
         and (v_outlet_id is null or outlet_id = v_outlet_id);
    end if;

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id, item_name, quantity, unit_price, subtotal,
      inventory_item_id, depletion_qty, category, modifiers, item_notes
    ) values (
      gen_random_uuid(), v_order_id, v_lodge_id, v_menu_item_id, v_item_name,
      v_quantity, v_unit_price, round((v_quantity * v_unit_price)::numeric, 2),
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

  insert into public.pos_prep_tickets (
    lodge_id, order_id, outlet_id, station, status, table_name, tab_name,
    waiter_name, room_id, notes, items
  ) values (
    v_lodge_id, v_order_id, v_outlet_id, v_station, 'new', v_table_name,
    v_tab_name, v_waiter_name, v_room_id, v_notes, v_items
  );

  if v_payment_method = 'folio' then
    insert into public.booking_charges (
      booking_id, lodge_id, description, category, quantity, amount, outlet_id
    ) values (
      v_booking_id, v_lodge_id,
      'POS folio charge - order ' || left(v_order_id::text, 8),
      'pos', 1, v_computed_total, v_outlet_id
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

create or replace function public.approve_pos_void_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id uuid := (payload->>'order_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_requested_by uuid := nullif(payload->>'requested_by', '')::uuid;
  v_approved_by uuid := nullif(payload->>'approved_by', '')::uuid;
  v_pin text := nullif(btrim(coalesce(payload->>'pin', '')), '');
  v_reason text := nullif(payload->>'reason', '');
  v_payload_outlet uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_override_log_id uuid := nullif(payload->>'override_log_id', '')::uuid;
  v_created_at timestamptz := coalesce(nullif(payload->>'created_at', '')::timestamptz, now());
  v_order_outlet_id uuid;
  v_folio_charge_id uuid;
  v_status text;
  v_restored jsonb := '[]'::jsonb;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select status, outlet_id, folio_charge_id
    into v_status, v_order_outlet_id, v_folio_charge_id
    from public.pos_orders
   where id = v_order_id
     and lodge_id = v_lodge_id
   for update;

  if v_override_log_id is not null and exists (
    select 1
      from public.pos_override_log pol
     where pol.id = v_override_log_id
       and pol.lodge_id = v_lodge_id
       and pol.order_id = v_order_id
       and pol.action = 'void'
  ) then
    return jsonb_build_object('success', true, 'id', v_order_id, 'override_log_id', v_override_log_id, 'already_applied', true, 'restored_stock', v_restored);
  end if;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  perform public.app_require_pos_outlet_access(v_lodge_id, coalesce(v_order_outlet_id, v_payload_outlet));

  if v_pin is null or not exists (
    select 1
      from public.users u
     where u.id = v_approved_by
       and u.lodge_id = v_lodge_id
       and lower(coalesce(u.role, '')) in ('supervisor', 'manager', 'admin', 'super_admin')
       and u.pin_hash is not null
       and extensions.crypt(v_pin, u.pin_hash) = u.pin_hash
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN or unauthorized approver');
  end if;

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  v_restored := public._restore_pos_order_stock(v_order_id, v_lodge_id);

  if v_folio_charge_id is not null then
    perform public.delete_booking_charge(v_folio_charge_id, v_lodge_id, 'Voided with POS order');
  end if;

  update public.pos_orders
     set status = 'voided'
   where id = v_order_id
     and lodge_id = v_lodge_id;

  insert into public.pos_override_log (
    id, lodge_id, order_id, action, requested_by, approved_by, reason, outlet_id, created_at
  ) values (
    coalesce(v_override_log_id, gen_random_uuid()), v_lodge_id, v_order_id, 'void',
    v_requested_by, v_approved_by, v_reason, coalesce(v_order_outlet_id, v_payload_outlet), v_created_at
  )
  on conflict (id) do nothing;

  return jsonb_build_object('success', true, 'id', v_order_id, 'override_log_id', v_override_log_id, 'restored_stock', v_restored);
end;
$$;

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
    v_id, v_lodge_id, coalesce(nullif(payload->>'date', '')::date, current_date), v_outlet_id,
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

-- Menu and inventory-backed bar templates.

create or replace function public.sync_inventory_item_to_pos(p_inventory_id uuid, p_lodge_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item record;
  v_rows_updated integer := 0;
  v_pos_category text;
begin
  select ii.id, ii.lodge_id, ii.name, ii.selling_price, ii.outlet_id, o.type as outlet_type
    into v_item
    from public.inventory_items ii
    left join public.outlets o on o.id = ii.outlet_id
   where ii.id = p_inventory_id
     and ii.lodge_id = p_lodge_id
   limit 1;

  if v_item.id is null or v_item.outlet_id is null or coalesce(v_item.outlet_type, '') not in ('food', 'beverage') then
    delete from public.pos_menu_items
     where lodge_id = p_lodge_id
       and inventory_item_id = p_inventory_id
       and auto_from_inventory = true;
    return;
  end if;

  v_pos_category := case when v_item.outlet_type = 'food' then 'Food' else 'Drinks' end;

  update public.pos_menu_items
     set name = v_item.name,
         category = v_pos_category,
         price = coalesce(v_item.selling_price, 0),
         is_available = true,
         inventory_item_id = p_inventory_id,
         depletion_qty = 1,
         outlet_id = v_item.outlet_id,
         updated_at = now()
   where lodge_id = p_lodge_id
     and inventory_item_id = p_inventory_id
     and auto_from_inventory = true
     and coalesce(template_kind, 'standard') in ('standard', 'bar_single');

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 0 then
    insert into public.pos_menu_items (
      lodge_id, name, category, price, is_available, inventory_item_id,
      depletion_qty, outlet_id, auto_from_inventory, template_kind
    ) values (
      p_lodge_id, v_item.name, v_pos_category, coalesce(v_item.selling_price, 0),
      true, p_inventory_id, 1, v_item.outlet_id, true,
      case when v_item.outlet_type = 'beverage' then 'bar_single' else 'standard' end
    );
  end if;
end;
$$;

create or replace function public.create_pos_menu_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  insert into public.pos_menu_items (
    lodge_id, name, category, price, is_available, barcode,
    inventory_item_id, depletion_qty, outlet_id, template_kind, auto_from_inventory
  ) values (
    v_lodge_id,
    nullif(btrim(payload->>'name'), ''),
    coalesce(nullif(payload->>'category', ''), 'Other'),
    coalesce(nullif(payload->>'price', '')::numeric, 0),
    coalesce((payload->>'is_available')::boolean, true),
    nullif(payload->>'barcode', ''),
    nullif(payload->>'inventory_item_id', '')::uuid,
    case when nullif(payload->>'inventory_item_id', '') is null then null else public._positive_depletion_qty(nullif(payload->>'depletion_qty', '')::numeric, 1) end,
    v_outlet_id,
    coalesce(nullif(payload->>'template_kind', ''), 'standard'),
    false
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.update_pos_menu_item(p_id uuid, p_lodge_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated uuid;
  v_outlet_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
  v_outlet_id := case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else null end;
  perform public.app_require_pos_outlet_access(p_lodge_id, v_outlet_id);

  update public.pos_menu_items
     set name = case when payload ? 'name' then nullif(btrim(payload->>'name'), '') else name end,
         category = case when payload ? 'category' then coalesce(nullif(payload->>'category', ''), 'Other') else category end,
         price = case when payload ? 'price' then coalesce(nullif(payload->>'price', '')::numeric, 0) else price end,
         is_available = case when payload ? 'is_available' then coalesce((payload->>'is_available')::boolean, true) else is_available end,
         barcode = case when payload ? 'barcode' then nullif(payload->>'barcode', '') else barcode end,
         inventory_item_id = case when payload ? 'inventory_item_id' then nullif(payload->>'inventory_item_id', '')::uuid else inventory_item_id end,
         depletion_qty = case
           when payload ? 'inventory_item_id' and nullif(payload->>'inventory_item_id', '') is null then null
           when payload ? 'depletion_qty' then public._positive_depletion_qty(nullif(payload->>'depletion_qty', '')::numeric, 1)
           else depletion_qty
         end,
         outlet_id = case when payload ? 'outlet_id' then v_outlet_id else outlet_id end,
         updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;

create or replace function public.delete_pos_menu_item(p_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  update public.pos_menu_items
     set is_available = false,
         updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated, 'soft_deleted', true);
end;
$$;

create or replace function public.set_bar_pos_pack_template(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_pack_size integer := coalesce((payload->>'pack_size')::integer, 0);
  v_enabled boolean := coalesce((payload->>'enabled')::boolean, false);
  v_item record;
  v_existing uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_pack_size not in (6, 12, 24) then
    return jsonb_build_object('success', false, 'error', 'Only 6-pack, 12-pack, and case-24 templates are supported.');
  end if;

  select ii.id, ii.name, ii.selling_price, ii.outlet_id, o.type as outlet_type
    into v_item
    from public.inventory_items ii
    left join public.outlets o on o.id = ii.outlet_id
   where ii.id = v_inventory_item_id
     and ii.lodge_id = v_lodge_id
   limit 1;

  if v_item.id is null then
    return jsonb_build_object('success', false, 'error', 'Bar inventory product not found.');
  end if;

  if coalesce(v_item.outlet_type, '') <> 'beverage' then
    return jsonb_build_object('success', false, 'error', 'Pack templates are only available for Bar inventory products.');
  end if;

  if coalesce(v_item.selling_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Set a bottle selling price before enabling pack templates.');
  end if;

  perform public.sync_inventory_item_to_pos(v_inventory_item_id, v_lodge_id);

  select id into v_existing
    from public.pos_menu_items
   where lodge_id = v_lodge_id
     and inventory_item_id = v_inventory_item_id
     and template_kind = 'bar_pack'
     and template_pack_size = v_pack_size
   limit 1;

  if v_enabled then
    if v_existing is null then
      insert into public.pos_menu_items (
        lodge_id, name, category, price, is_available, inventory_item_id,
        depletion_qty, outlet_id, auto_from_inventory, template_kind, template_pack_size
      ) values (
        v_lodge_id,
        case v_pack_size when 6 then v_item.name || ' 6 Pack' when 12 then v_item.name || ' 12 Pack' else v_item.name || ' Case (24)' end,
        'Drinks', coalesce(v_item.selling_price, 0) * v_pack_size, true,
        v_inventory_item_id, v_pack_size, v_item.outlet_id, true, 'bar_pack', v_pack_size
      );
    else
      update public.pos_menu_items
         set name = case v_pack_size when 6 then v_item.name || ' 6 Pack' when 12 then v_item.name || ' 12 Pack' else v_item.name || ' Case (24)' end,
             category = 'Drinks',
             price = coalesce(v_item.selling_price, 0) * v_pack_size,
             is_available = true,
             inventory_item_id = v_inventory_item_id,
             depletion_qty = v_pack_size,
             outlet_id = v_item.outlet_id,
             auto_from_inventory = true,
             updated_at = now()
       where id = v_existing;
    end if;
  else
    update public.pos_menu_items
       set is_available = false,
           updated_at = now()
     where lodge_id = v_lodge_id
       and inventory_item_id = v_inventory_item_id
       and template_kind = 'bar_pack'
       and template_pack_size = v_pack_size;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- Table, tab, shift, ticket, display/config RPCs.

create or replace function public.upsert_pos_table(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_name text := nullif(btrim(coalesce(payload->>'name', '')), '');
  v_row public.pos_tables%rowtype;
begin
  if v_lodge_id is null or not public.app_lodge_access(v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Access denied.');
  end if;
  if v_name is null then
    return jsonb_build_object('success', false, 'error', 'Table name is required.');
  end if;
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  insert into public.pos_tables (id, lodge_id, outlet_id, name, area, seats, active, updated_at)
  values (
    v_id, v_lodge_id, v_outlet_id, v_name,
    nullif(btrim(coalesce(payload->>'area', '')), ''),
    greatest(0, coalesce(nullif(payload->>'seats', '')::int, 0)),
    coalesce((payload->>'active')::boolean, true),
    now()
  )
  on conflict (lodge_id, outlet_id, name)
  do update set area = excluded.area, seats = excluded.seats, active = excluded.active, updated_at = now()
  returning * into v_row;

  return jsonb_build_object('success', true, 'table', to_jsonb(v_row));
end;
$$;

create or replace function public.upsert_pos_tab(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_table_name text := nullif(btrim(coalesce(payload->>'table_name', '')), '');
  v_waiter_name text := nullif(btrim(coalesce(payload->>'waiter_name', '')), '');
  v_status text := lower(coalesce(nullif(payload->>'status', ''), case when v_table_name is null then 'open' else 'running' end));
  v_existing public.pos_tabs%rowtype;
  v_row public.pos_tabs%rowtype;
begin
  if v_lodge_id is null or not public.app_lodge_access(v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Access denied.');
  end if;
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
  if v_table_name is not null and v_waiter_name is null then
    return jsonb_build_object('success', false, 'error', 'Waiter name is required before opening a table.');
  end if;
  if v_status not in ('open', 'running', 'ready', 'delivered', 'closed', 'cancelled') then
    v_status := case when v_table_name is null then 'open' else 'running' end;
  end if;

  if v_table_name is not null and v_status in ('open', 'running', 'ready', 'delivered') then
    select * into v_existing
      from public.pos_tabs
     where lodge_id = v_lodge_id
       and coalesce(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_outlet_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and lower(btrim(table_name)) = lower(v_table_name)
       and status in ('open', 'running', 'ready', 'delivered')
       and id <> v_id
     order by updated_at desc
     limit 1;

    if v_existing.id is not null then
      return jsonb_build_object('success', true, 'already_open', true, 'tab', to_jsonb(v_existing));
    end if;
  end if;

  insert into public.pos_tabs (
    id, lodge_id, outlet_id, table_name, tab_name, customer_name, waiter_name,
    room_id, booking_id, items, notes, status, opened_by, opened_by_name,
    created_at, updated_at, closed_at
  ) values (
    v_id, v_lodge_id, v_outlet_id, v_table_name,
    nullif(btrim(coalesce(payload->>'tab_name', '')), ''),
    nullif(btrim(coalesce(payload->>'customer_name', '')), ''),
    v_waiter_name,
    nullif(payload->>'room_id', '')::uuid,
    nullif(payload->>'booking_id', '')::uuid,
    coalesce(payload->'items', '[]'::jsonb),
    nullif(payload->>'notes', ''),
    v_status,
    nullif(payload->>'opened_by', '')::uuid,
    nullif(payload->>'opened_by_name', ''),
    coalesce(nullif(payload->>'created_at', '')::timestamptz, now()),
    now(),
    case when v_status in ('closed', 'cancelled') then now() else null end
  )
  on conflict (id)
  do update set
    outlet_id = excluded.outlet_id,
    table_name = excluded.table_name,
    tab_name = excluded.tab_name,
    customer_name = excluded.customer_name,
    waiter_name = excluded.waiter_name,
    room_id = excluded.room_id,
    booking_id = excluded.booking_id,
    items = excluded.items,
    notes = excluded.notes,
    status = excluded.status,
    updated_at = now(),
    closed_at = excluded.closed_at
  returning * into v_row;

  return jsonb_build_object('success', true, 'tab', to_jsonb(v_row));
end;
$$;

create or replace function public.update_pos_tab_status(p_tab_id uuid, p_status text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text := lower(coalesce(nullif(p_status, ''), 'closed'));
  v_row public.pos_tabs%rowtype;
begin
  if v_status not in ('open', 'running', 'ready', 'delivered', 'closed', 'cancelled') then
    v_status := 'closed';
  end if;

  update public.pos_tabs
     set status = v_status,
         notes = coalesce(p_notes, notes),
         updated_at = now(),
         closed_at = case when v_status in ('closed', 'cancelled') then now() else closed_at end
   where id = p_tab_id
     and public.app_lodge_access(lodge_id)
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('success', false, 'error', 'Open table tab not found.');
  end if;

  return jsonb_build_object('success', true, 'tab', to_jsonb(v_row));
end;
$$;

create or replace function public.open_pos_shift(
  p_lodge_id uuid,
  p_cashier_id uuid,
  p_cashier_name text,
  p_opening_float numeric default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing public.pos_shifts%rowtype;
  v_row public.pos_shifts%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform pg_advisory_xact_lock(hashtext('pos_shift:' || p_lodge_id::text || ':' || coalesce(p_cashier_id::text, 'unknown')));

  select * into v_existing
    from public.pos_shifts
   where lodge_id = p_lodge_id
     and cashier_id is not distinct from p_cashier_id
     and status = 'open'
   order by opened_at desc
   limit 1
   for update;

  if v_existing.id is not null then
    return jsonb_build_object('success', true, 'already_open', true, 'shift', to_jsonb(v_existing));
  end if;

  insert into public.pos_shifts (
    lodge_id, cashier_id, cashier_name, opening_float, status, opened_at, notes
  ) values (
    p_lodge_id, p_cashier_id, nullif(p_cashier_name, ''),
    coalesce(p_opening_float, 0), 'open', now(), nullif(p_notes, '')
  )
  returning * into v_row;

  return jsonb_build_object('success', true, 'id', v_row.id, 'shift', to_jsonb(v_row));
end;
$$;

create or replace function public.close_pos_shift(
  p_shift_id uuid,
  p_lodge_id uuid,
  p_closing_cash numeric default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.pos_shifts%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  update public.pos_shifts
     set closing_cash = coalesce(p_closing_cash, 0),
         close_notes = nullif(p_notes, ''),
         status = 'closed',
         closed_at = now()
   where id = p_shift_id
     and lodge_id = p_lodge_id
     and status = 'open'
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('success', false, 'error', 'Open shift not found.');
  end if;

  return jsonb_build_object('success', true, 'shift', to_jsonb(v_row));
end;
$$;

create or replace function public.get_pos_shifts(p_lodge_id uuid)
returns setof public.pos_shifts
language sql
stable
security definer
set search_path to 'public'
as $$
  select *
    from public.pos_shifts
   where lodge_id = p_lodge_id
     and public.app_lodge_access(lodge_id)
   order by opened_at desc
   limit 50;
$$;

create or replace function public.update_pos_prep_ticket_status(
  p_ticket_id uuid,
  p_status text,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text := lower(coalesce(nullif(p_status, ''), 'new'));
  v_row public.pos_prep_tickets%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_status not in ('new', 'preparing', 'ready', 'served', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'Invalid prep ticket status.');
  end if;

  update public.pos_prep_tickets
     set status = v_status,
         updated_at = now()
   where id = p_ticket_id
     and lodge_id = p_lodge_id
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('success', false, 'error', 'Prep ticket not found.');
  end if;

  return jsonb_build_object('success', true, 'ticket', to_jsonb(v_row));
end;
$$;

create or replace function public.append_pos_audit_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
begin
  if v_lodge_id is null or not public.app_lodge_access(v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Access denied.');
  end if;

  insert into public.pos_audit_log (
    id, lodge_id, outlet_id, actor_id, action, entity_type, entity_id,
    before_snapshot, after_snapshot, idempotency_key, created_at
  ) values (
    v_id,
    v_lodge_id,
    nullif(payload->>'outlet_id', '')::uuid,
    nullif(payload->>'actor_id', '')::uuid,
    coalesce(nullif(payload->>'action', ''), 'pos_event'),
    nullif(payload->>'entity_type', ''),
    nullif(payload->>'entity_id', '')::uuid,
    payload->'before_snapshot',
    payload->'after_snapshot',
    nullif(payload->>'idempotency_key', ''),
    coalesce(nullif(payload->>'created_at', '')::timestamptz, now())
  )
  on conflict (id) do nothing;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.upsert_pos_modifier_groups(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_group jsonb;
  v_count integer := 0;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  update public.pos_modifier_groups
     set active = false,
         updated_at = now()
   where lodge_id = v_lodge_id
     and outlet_id is not distinct from v_outlet_id;

  for v_group in select * from jsonb_array_elements(coalesce(payload->'groups', '[]'::jsonb)) loop
    insert into public.pos_modifier_groups (
      id, lodge_id, outlet_id, name, options, required, max_select, active, updated_at
    ) values (
      coalesce(nullif(v_group->>'id', '')::uuid, gen_random_uuid()),
      v_lodge_id,
      v_outlet_id,
      nullif(btrim(coalesce(v_group->>'name', '')), ''),
      coalesce(v_group->'options', '[]'::jsonb),
      coalesce((v_group->>'required')::boolean, false),
      greatest(1, coalesce(nullif(v_group->>'max_select', '')::integer, 1)),
      coalesce((v_group->>'active')::boolean, true),
      now()
    )
    on conflict (id) do update set
      outlet_id = excluded.outlet_id,
      name = excluded.name,
      options = excluded.options,
      required = excluded.required,
      max_select = excluded.max_select,
      active = excluded.active,
      updated_at = now();
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'count', v_count);
end;
$$;

create or replace function public.upsert_pos_promotions(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_promo jsonb;
  v_count integer := 0;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  update public.pos_promotions
     set enabled = false,
         updated_at = now()
   where lodge_id = v_lodge_id
     and outlet_id is not distinct from v_outlet_id;

  for v_promo in select * from jsonb_array_elements(coalesce(payload->'promotions', '[]'::jsonb)) loop
    insert into public.pos_promotions (
      id, lodge_id, outlet_id, name, discount_type, discount_value,
      applies_to_category, starts_at, ends_at, enabled, updated_at
    ) values (
      coalesce(nullif(v_promo->>'id', '')::uuid, gen_random_uuid()),
      v_lodge_id,
      v_outlet_id,
      nullif(btrim(coalesce(v_promo->>'name', '')), ''),
      coalesce(nullif(v_promo->>'discount_type', ''), 'amount'),
      greatest(0, coalesce(nullif(v_promo->>'discount_value', '')::numeric, 0)),
      nullif(v_promo->>'applies_to_category', ''),
      nullif(v_promo->>'starts_at', '')::timestamptz,
      nullif(v_promo->>'ends_at', '')::timestamptz,
      coalesce((v_promo->>'enabled')::boolean, true),
      now()
    )
    on conflict (id) do update set
      outlet_id = excluded.outlet_id,
      name = excluded.name,
      discount_type = excluded.discount_type,
      discount_value = excluded.discount_value,
      applies_to_category = excluded.applies_to_category,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      enabled = excluded.enabled,
      updated_at = now();
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'count', v_count);
end;
$$;

create or replace function public.upsert_pos_floor_layout(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_row public.pos_floor_layouts%rowtype;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  insert into public.pos_floor_layouts (lodge_id, outlet_id, layout, updated_at)
  values (
    v_lodge_id,
    v_outlet_id,
    coalesce(payload->'layout', '{"areas":[]}'::jsonb),
    now()
  )
  on conflict (lodge_id, outlet_id) do update set
    layout = excluded.layout,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object('success', true, 'layout', to_jsonb(v_row));
end;
$$;

-- Canonical booking payment RPC used by deposits and folio payment flows. This
-- preserves the main app contract: payment deltas are recorded in payments and
-- amount_paid/payment_status remain server-derived.

create or replace function public.update_booking_payment(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_amount numeric,
  p_method text,
  p_type text default 'payment',
  p_idempotency_key text default null,
  p_recorded_by uuid default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_booking public.bookings%rowtype;
  v_new_paid numeric;
  v_total_owed numeric;
  v_status text;
  v_actor uuid := public.app_current_user_id();
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'finance', 'manager', 'admin', 'super_admin']);

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to record a payment.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Payment idempotency key is required');
  end if;

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if p_expected_updated_at is not null and v_booking.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh the booking and try again.',
      'stale', true,
      'current_updated_at', v_booking.updated_at
    );
  end if;

  if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
    return jsonb_build_object(
      'success', true,
      'amount_paid', coalesce(v_booking.amount_paid, 0),
      'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
      'idempotent', true
    );
  end if;

  v_new_paid := round((coalesce(v_booking.amount_paid, 0) + p_amount)::numeric, 2);
  v_total_owed := round((coalesce(v_booking.total_amount, 0) + coalesce(v_booking.charges_total, 0))::numeric, 2);

  if v_new_paid < 0 then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Adjustment of %s would reduce amount paid below zero (current: %s). Use the refund flow to reduce a guest''s paid balance.',
        round(p_amount::numeric, 2),
        round(coalesce(v_booking.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

  if p_amount > 0 and v_total_owed > 0 and v_new_paid > v_total_owed then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Payment of %s would overpay this booking. Total owed: %s, already paid: %s. Adjust the booking total first if a larger payment is intended.',
        round(p_amount::numeric, 2),
        v_total_owed,
        round(coalesce(v_booking.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

  v_status := public.compute_payment_status(v_new_paid, v_booking.total_amount, v_booking.charges_total);

  update public.bookings
     set amount_paid = v_new_paid,
         payment_status = v_status,
         payment_method = coalesce(p_method, payment_method),
         updated_at = now()
   where id = p_booking_id
     and lodge_id = p_lodge_id;

  begin
    insert into public.payments (
      booking_id, lodge_id, amount, method, type, paid_at, recorded_by, idempotency_key
    ) values (
      p_booking_id, p_lodge_id, p_amount, p_method, p_type, now(), v_actor, p_idempotency_key
    );
  exception when unique_violation then
    select amount_paid, payment_status
      into v_new_paid, v_status
      from public.bookings
     where id = p_booking_id
       and lodge_id = p_lodge_id;

    return jsonb_build_object(
      'success', true,
      'amount_paid', coalesce(v_new_paid, 0),
      'payment_status', coalesce(v_status, 'unpaid'),
      'idempotent', true
    );
  end;

  return jsonb_build_object('success', true, 'amount_paid', v_new_paid, 'payment_status', v_status);
end;
$$;

-- Grants. Critical writes remain RPC-only; read grants are for POS screens.

grant select on public.inventory_movements to anon, authenticated, service_role;
grant select on public.pos_override_log to anon, authenticated, service_role;
grant select on public.pos_tables to anon, authenticated, service_role;
grant select on public.pos_tabs to anon, authenticated, service_role;
grant select on public.pos_prep_tickets to anon, authenticated, service_role;
grant select on public.pos_shifts to anon, authenticated, service_role;
grant select on public.pos_cashup_sessions to anon, authenticated, service_role;
grant select on public.pos_modifier_groups to anon, authenticated, service_role;
grant select on public.pos_promotions to anon, authenticated, service_role;
grant select on public.pos_floor_layouts to anon, authenticated, service_role;
grant select on public.pos_customer_display_snapshots to anon, authenticated, service_role;
grant select on public.pos_audit_log to anon, authenticated, service_role;

revoke all on function public._positive_depletion_qty(numeric, numeric) from public;
grant execute on function public._positive_depletion_qty(numeric, numeric) to anon, authenticated, service_role;
revoke all on function public.create_pos_order(jsonb) from public;
grant execute on function public.create_pos_order(jsonb) to anon, authenticated, service_role;
revoke all on function public.approve_pos_void_with_pin(jsonb) from public;
grant execute on function public.approve_pos_void_with_pin(jsonb) to anon, authenticated, service_role;
revoke all on function public.upsert_pos_cashup(jsonb) from public;
grant execute on function public.upsert_pos_cashup(jsonb) to anon, authenticated, service_role;
revoke all on function public.sync_inventory_item_to_pos(uuid, uuid) from public;
grant execute on function public.sync_inventory_item_to_pos(uuid, uuid) to service_role;
revoke all on function public.create_pos_menu_item(jsonb) from public;
grant execute on function public.create_pos_menu_item(jsonb) to anon, authenticated, service_role;
revoke all on function public.update_pos_menu_item(uuid, uuid, jsonb) from public;
grant execute on function public.update_pos_menu_item(uuid, uuid, jsonb) to anon, authenticated, service_role;
revoke all on function public.delete_pos_menu_item(uuid, uuid) from public;
grant execute on function public.delete_pos_menu_item(uuid, uuid) to anon, authenticated, service_role;
revoke all on function public.set_bar_pos_pack_template(jsonb) from public;
grant execute on function public.set_bar_pos_pack_template(jsonb) to anon, authenticated, service_role;
revoke all on function public.upsert_pos_table(jsonb) from public;
grant execute on function public.upsert_pos_table(jsonb) to anon, authenticated, service_role;
revoke all on function public.upsert_pos_tab(jsonb) from public;
grant execute on function public.upsert_pos_tab(jsonb) to anon, authenticated, service_role;
revoke all on function public.update_pos_tab_status(uuid, text, text) from public;
grant execute on function public.update_pos_tab_status(uuid, text, text) to anon, authenticated, service_role;
revoke all on function public.open_pos_shift(uuid, uuid, text, numeric, text) from public;
grant execute on function public.open_pos_shift(uuid, uuid, text, numeric, text) to anon, authenticated, service_role;
revoke all on function public.close_pos_shift(uuid, uuid, numeric, text) from public;
grant execute on function public.close_pos_shift(uuid, uuid, numeric, text) to anon, authenticated, service_role;
revoke all on function public.get_pos_shifts(uuid) from public;
grant execute on function public.get_pos_shifts(uuid) to anon, authenticated, service_role;
revoke all on function public.update_pos_prep_ticket_status(uuid, text, uuid) from public;
grant execute on function public.update_pos_prep_ticket_status(uuid, text, uuid) to anon, authenticated, service_role;
revoke all on function public.append_pos_audit_log(jsonb) from public;
grant execute on function public.append_pos_audit_log(jsonb) to anon, authenticated, service_role;
revoke all on function public.upsert_pos_modifier_groups(jsonb) from public;
grant execute on function public.upsert_pos_modifier_groups(jsonb) to anon, authenticated, service_role;
revoke all on function public.upsert_pos_promotions(jsonb) from public;
grant execute on function public.upsert_pos_promotions(jsonb) to anon, authenticated, service_role;
revoke all on function public.upsert_pos_floor_layout(jsonb) from public;
grant execute on function public.upsert_pos_floor_layout(jsonb) to anon, authenticated, service_role;
revoke all on function public.update_booking_payment(uuid, uuid, numeric, text, text, text, uuid, timestamptz) from public;
grant execute on function public.update_booking_payment(uuid, uuid, numeric, text, text, text, uuid, timestamptz) to anon, authenticated, service_role;

commit;
