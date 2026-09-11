-- F&B Phase 3 (guest service) + Today/consolidated read models.
--
-- - Today landing counts use server-confirmed sources only; every section is
--   defensive so a missing optional table degrades to unavailable, never to a
--   misleading zero presented as financial truth.
-- - Room-service fulfilment is an atomic, idempotent contract with explicit
--   state transitions, runner assignment, kitchen routing, folio posting
--   reference, offline replay key, and immutable audit.
-- - Meal-plan entitlement/redemption is one atomic contract: entitlement
--   decrement, covers, inventory consumption reference, folio/ledger rule
--   (included meals never author amount_paid/payment_status), idempotency.
-- - Disabling an F&B module never deletes these rows; reads remain available
--   to authorised roles for retained history/audit.

begin;

-- ── Immutable F&B audit ───────────────────────────────────────────────────
create table if not exists public.fnb_audit_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor_id uuid,
  actor_role text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  operation_id text,
  created_at timestamptz not null default now()
);

create index if not exists fnb_audit_log_lodge_idx
  on public.fnb_audit_log (lodge_id, created_at desc);
create index if not exists fnb_audit_log_entity_idx
  on public.fnb_audit_log (lodge_id, entity_type, entity_id);

alter table public.fnb_audit_log enable row level security;
revoke all on table public.fnb_audit_log from public, anon, authenticated;
grant select, insert on table public.fnb_audit_log to service_role;

-- Append-only: no updates or deletes from any client role.
create or replace function public._fnb_audit_no_mutate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  raise exception 'F&B audit evidence is immutable.' using errcode = '42501';
  return null;
end;
$$;

drop trigger if exists fnb_audit_log_no_update on public.fnb_audit_log;
create trigger fnb_audit_log_no_update
  before update or delete on public.fnb_audit_log
  for each row execute function public._fnb_audit_no_mutate();

-- ── Room-service orders ───────────────────────────────────────────────────
create table if not exists public.fnb_room_service_orders (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid,
  booking_id uuid,
  room_id uuid,
  room_label text,
  customer_name text,
  items jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'new',
  runner_id uuid,
  runner_name text,
  station text,
  folio_charge_id uuid,
  folio_posted boolean not null default false,
  operation_id text not null,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dispatched_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  constraint fnb_room_service_status_check check (
    status in ('new','preparing','ready','dispatched','delivered','cancelled')
  )
);

create unique index if not exists fnb_room_service_operation_uidx
  on public.fnb_room_service_orders (lodge_id, operation_id);
create index if not exists fnb_room_service_status_idx
  on public.fnb_room_service_orders (lodge_id, status, created_at desc);

alter table public.fnb_room_service_orders enable row level security;
revoke all on table public.fnb_room_service_orders from public, anon, authenticated;
grant select, insert, update, delete on table public.fnb_room_service_orders to service_role;

-- Hardening: link every room-service fulfilment row to its canonical POS
-- order (the single financial truth) and carry a payload hash so an
-- idempotent replay with a DIFFERENT payload is rejected instead of
-- returning a stale record.
alter table public.fnb_room_service_orders
  add column if not exists pos_order_id uuid,
  add column if not exists pos_total numeric not null default 0,
  add column if not exists payload_hash text;

-- One POS order per room-service operation key: retries share the key and can
-- never mint a second order. The arbiter below infers the pre-existing
-- pos_orders_lodge_idempotency_uidx (20260612193000), so no second index is
-- created here.

-- ── Meal plans ────────────────────────────────────────────────────────────
create table if not exists public.fnb_meal_plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  booking_id uuid,
  customer_name text,
  plan_code text not null,
  total_covers integer not null check (total_covers >= 0),
  remaining_covers integer not null check (remaining_covers >= 0),
  valid_from date,
  valid_to date,
  operation_id text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fnb_meal_entitlement_operation_uidx
  on public.fnb_meal_plan_entitlements (lodge_id, operation_id);
create index if not exists fnb_meal_entitlement_booking_idx
  on public.fnb_meal_plan_entitlements (lodge_id, booking_id);

alter table public.fnb_meal_plan_entitlements enable row level security;
revoke all on table public.fnb_meal_plan_entitlements from public, anon, authenticated;
grant select, insert, update, delete on table public.fnb_meal_plan_entitlements to service_role;

create table if not exists public.fnb_meal_redemptions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  entitlement_id uuid references public.fnb_meal_plan_entitlements(id) on delete restrict,
  outlet_id uuid,
  covers integer not null check (covers > 0),
  complimentary boolean not null default false,
  complimentary_reason text,
  approved_by uuid,
  inventory_consumed boolean not null default false,
  folio_reference text,
  operation_id text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists fnb_meal_redemption_operation_uidx
  on public.fnb_meal_redemptions (lodge_id, operation_id);
create index if not exists fnb_meal_redemption_entitlement_idx
  on public.fnb_meal_redemptions (entitlement_id);

alter table public.fnb_meal_redemptions enable row level security;
revoke all on table public.fnb_meal_redemptions from public, anon, authenticated;
grant select, insert on table public.fnb_meal_redemptions to service_role;

-- Hardening: payload hashes so idempotent replays with a different payload
-- are rejected (IDEMPOTENCY_CONFLICT) instead of returning a stale record.
-- inventory_consumed / folio_reference stay on the row for audit history but
-- are ALWAYS server-derived (false / null): the client must never author
-- inventory or folio effects.
alter table public.fnb_meal_plan_entitlements
  add column if not exists payload_hash text;
alter table public.fnb_meal_redemptions
  add column if not exists payload_hash text;

-- ── Today read model ──────────────────────────────────────────────────────
-- Server-confirmed actionable counts. Financial values are intentionally
-- excluded here; money lives in the consolidated report with source +
-- completeness certification.
create or replace function public.get_fnb_today(p_lodge_id uuid, p_outlet_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_outlet uuid := p_outlet_id;
  v_counts jsonb := '{}'::jsonb;
  v_n integer := 0;
begin
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;

  -- Open checks (server-confirmed tabs).
  begin
    if to_regclass('public.pos_tabs') is not null then
      if v_outlet is null then
        execute 'select count(*)::integer from public.pos_tabs where lodge_id = $1 and coalesce(status, '''') in (''open'',''held'',''active'')'
          into v_n using v_lodge;
      else
        execute 'select count(*)::integer from public.pos_tabs where lodge_id = $1 and outlet_id = $2 and coalesce(status, '''') in (''open'',''held'',''active'')'
          into v_n using v_lodge, v_outlet;
      end if;
    else
      v_n := 0;
    end if;
  exception when others then v_n := 0; end;
  v_counts := v_counts || jsonb_build_object('open_checks', v_n);

  -- Waiting tickets (active prep tickets).
  begin
    if to_regclass('public.pos_prep_tickets') is not null then
      if v_outlet is null then
        execute 'select count(*)::integer from public.pos_prep_tickets where lodge_id = $1 and coalesce(status, '''') in (''new'',''pending'',''preparing'')'
          into v_n using v_lodge;
      else
        execute 'select count(*)::integer from public.pos_prep_tickets where lodge_id = $1 and outlet_id = $2 and coalesce(status, '''') in (''new'',''pending'',''preparing'')'
          into v_n using v_lodge, v_outlet;
      end if;
    else
      v_n := 0;
    end if;
  exception when others then v_n := 0; end;
  v_counts := v_counts || jsonb_build_object('waiting_tickets', v_n);

  -- Reservations due today.
  begin
    if to_regclass('public.restaurant_reservations') is not null then
      if v_outlet is null then
        execute 'select count(*)::integer from public.restaurant_reservations where lodge_id = $1 and reservation_date = current_date and status in (''booked'',''confirmed'',''waiting'')'
          into v_n using v_lodge;
      else
        execute 'select count(*)::integer from public.restaurant_reservations where lodge_id = $1 and (outlet_id = $2 or outlet_id is null) and reservation_date = current_date and status in (''booked'',''confirmed'',''waiting'')'
          into v_n using v_lodge, v_outlet;
      end if;
    else
      v_n := 0;
    end if;
  exception when others then v_n := 0; end;
  v_counts := v_counts || jsonb_build_object('reservations_due', v_n);

  -- Low-stock signals (lodge Inventory is authoritative; F&B only filters
  -- the signal, never authors stock truth here). inventory_items has no
  -- is_active column — every row counts.
  begin
    if to_regclass('public.inventory_items') is not null then
      execute 'select count(*)::integer from public.inventory_items where lodge_id = $1 and coalesce(current_stock, 0) <= coalesce(reorder_level, 0)'
        into v_n using v_lodge;
    else
      v_n := 0;
    end if;
  exception when others then v_n := 0; end;
  v_counts := v_counts || jsonb_build_object('low_stock', v_n);

  -- Room-service queue depth.
  begin
    if v_outlet is null then
      select count(*)::integer into v_n from public.fnb_room_service_orders
       where lodge_id = v_lodge and status in ('new','preparing','ready','dispatched');
    else
      select count(*)::integer into v_n from public.fnb_room_service_orders
       where lodge_id = v_lodge and (outlet_id = v_outlet or outlet_id is null)
         and status in ('new','preparing','ready','dispatched');
    end if;
  exception when others then v_n := 0; end;
  v_counts := v_counts || jsonb_build_object('room_service_open', v_n);

  return jsonb_build_object(
    'success', true,
    'lodge_id', v_lodge,
    'outlet_id', v_outlet,
    'counts', v_counts,
    'generated_at', now(),
    'source', 'server'
  );
end;
$$;

revoke all on function public.get_fnb_today(uuid, uuid) from public;
grant execute on function public.get_fnb_today(uuid, uuid) to anon, authenticated, service_role;

-- ── Room-service write contracts ──────────────────────────────────────────
-- Room service is a fulfilment view over the CANONICAL POS contract, not a
-- second ordering system. Creation validates the outlet/booking/room
-- relationship, resolves every line from pos_menu_items at server prices
-- (client prices are never trusted), and atomically writes the canonical
-- pos_orders + pos_order_items + pos_prep_tickets rows (visible to the
-- kitchen, Legacy POS, and reporting) plus the fnb delivery-state row, all
-- under the one stable operation key.
create or replace function public.create_fnb_room_service_order(
  p_lodge_id uuid,
  p_payload jsonb,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_role text := '';
  v_module_denial text;
  v_outlet_denial text;
  v_existing public.fnb_room_service_orders%rowtype;
  v_row public.fnb_room_service_orders%rowtype;
  v_pos public.pos_orders%rowtype;
  v_items jsonb;
  v_item jsonb;
  v_outlet uuid;
  v_booking uuid;
  v_room uuid;
  v_booking_lodge uuid;
  v_booking_status text := '';
  v_booking_room uuid;
  v_room_lodge uuid;
  v_hash text;
  v_menu_id uuid;
  v_menu_name text;
  v_menu_price numeric;
  v_menu_outlet uuid;
  v_menu_available boolean;
  v_qty integer;
  v_shift_open integer := 0;
  v_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_ticket_items jsonb := '[]'::jsonb;
  v_station text;
begin
  if p_operation_id is null or btrim(p_operation_id) = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A stable operation ID is required.');
  end if;
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  -- Module + commercial entitlement gate: new room-service work stops the
  -- moment the module is disabled or its entitlement lapses.
  v_module_denial := public._fnb_require_module(v_lodge, 'room-service');
  if v_module_denial is not null then
    return jsonb_build_object('success', false, 'code', v_module_denial,
      'error', case v_module_denial
        when 'MODULE_DISABLED' then 'Room service is currently disabled. An administrator can enable it in Food & Beverage → More tools.'
        when 'ENTITLEMENT_UNVERIFIED' then 'The licence for room service could not be verified. Reconnect and retry.'
        else 'This lodge does not include room service. Request access to use it.' end);
  end if;
  if not public._fnb_has_capability(v_lodge, v_user, 'pos.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot create room-service orders.');
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_lodge limit 1;

  begin v_outlet := nullif(p_payload->>'outlet_id', '')::uuid; exception when others then v_outlet := null; end;
  begin v_booking := nullif(p_payload->>'booking_id', '')::uuid; exception when others then v_booking := null; end;
  begin v_room := nullif(p_payload->>'room_id', '')::uuid; exception when others then v_room := null; end;

  -- Outlet must belong to this lodge (when given) and the actor must be
  -- scoped to it.
  v_outlet_denial := public._fnb_require_outlet(v_lodge, v_user, v_outlet);
  if v_outlet_denial is not null then
    return jsonb_build_object('success', false, 'code', v_outlet_denial,
      'error', case v_outlet_denial when 'OUTLET_INACTIVE' then 'That outlet is no longer active.' else 'That outlet is not available to you in this lodge.' end);
  end if;

  -- Booking must belong to this lodge and be an active stay.
  if v_booking is not null then
    begin
      select lodge_id, lower(coalesce(status, '')), room_id
        into v_booking_lodge, v_booking_status, v_booking_room
        from public.bookings where id = v_booking limit 1;
    exception when undefined_table then
      return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'The booking store is unavailable.');
    end;
    if not found or v_booking_lodge is distinct from v_lodge then
      return jsonb_build_object('success', false, 'code', 'BOOKING_SCOPE_DENIED', 'error', 'That booking does not belong to this lodge.');
    end if;
    if v_booking_status not in ('confirmed', 'checked_in') then
      return jsonb_build_object('success', false, 'code', 'BOOKING_NOT_ACTIVE',
        'error', 'Room service needs an active (confirmed or checked-in) booking.', 'status', v_booking_status);
    end if;
  end if;

  -- Room must belong to this lodge and agree with the booking's room.
  if v_room is not null then
    select lodge_id into v_room_lodge from public.rooms where id = v_room limit 1;
    if not found or v_room_lodge is distinct from v_lodge then
      return jsonb_build_object('success', false, 'code', 'ROOM_SCOPE_DENIED', 'error', 'That room does not belong to this lodge.');
    end if;
    if v_booking is not null and v_booking_room is not null and v_booking_room is distinct from v_room then
      return jsonb_build_object('success', false, 'code', 'BOOKING_ROOM_MISMATCH', 'error', 'That room does not match the selected booking.');
    end if;
  elsif v_booking is not null and v_booking_room is not null then
    v_room := v_booking_room;
  end if;
  if v_booking is null and v_room is null and nullif(btrim(coalesce(p_payload->>'room_label', '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Select a booking or room (or enter a room label) for delivery.');
  end if;

  -- Items MUST reference canonical menu items; server prices win. Free-text
  -- lines are rejected so kitchen routing, stock depletion, and totals stay
  -- inside the mature POS contract.
  v_items := coalesce(p_payload->'items', '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Choose at least one menu item.');
  end if;
  for v_item in select * from jsonb_array_elements(v_items) loop
    begin v_menu_id := nullif(v_item->>'menu_item_id', '')::uuid; exception when others then v_menu_id := null; end;
    if v_menu_id is null then
      return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Every line needs a menu item. Free-text items are not accepted for room service.');
    end if;
    select name, price, outlet_id, coalesce(is_available, true)
      into v_menu_name, v_menu_price, v_menu_outlet, v_menu_available
      from public.pos_menu_items
     where id = v_menu_id and lodge_id = v_lodge limit 1;
    if not found then
      return jsonb_build_object('success', false, 'code', 'MENU_ITEM_UNKNOWN', 'error', 'A menu item does not belong to this lodge.');
    end if;
    if v_menu_available is not true then
      return jsonb_build_object('success', false, 'code', 'MENU_ITEM_UNAVAILABLE', 'error', format('“%s” is currently unavailable.', v_menu_name));
    end if;
    if v_outlet is not null and v_menu_outlet is not null and v_menu_outlet is distinct from v_outlet then
      return jsonb_build_object('success', false, 'code', 'MENU_ITEM_OUTLET_MISMATCH', 'error', format('“%s” is not sold at the selected outlet.', v_menu_name));
    end if;
    begin v_qty := (v_item->>'quantity')::integer; exception when others then v_qty := 0; end;
    if coalesce(v_qty, 0) < 1 or coalesce(v_qty, 0) > 20 then
      return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', format('“%s” needs a quantity between 1 and 20.', v_menu_name));
    end if;
    v_total := v_total + coalesce(v_menu_price, 0) * v_qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'menu_item_id', v_menu_id, 'item_name', v_menu_name,
      'quantity', v_qty, 'unit_price', coalesce(v_menu_price, 0),
      'subtotal', coalesce(v_menu_price, 0) * v_qty));
    v_ticket_items := v_ticket_items || jsonb_build_array(jsonb_build_object('name', v_menu_name, 'qty', v_qty));
  end loop;

  -- An open operator shift is required (same control as the POS counter):
  -- room service must never sell outside shift and cash-up accountability.
  begin
    if to_regclass('public.pos_shifts') is not null then
      if v_outlet is null then
        execute 'select count(*)::integer from public.pos_shifts where lodge_id = $1 and coalesce(status, '''') = ''open'''
          into v_shift_open using v_lodge;
      else
        execute 'select count(*)::integer from public.pos_shifts where lodge_id = $1 and outlet_id = $2 and coalesce(status, '''') = ''open'''
          into v_shift_open using v_lodge, v_outlet;
      end if;
      if coalesce(v_shift_open, 0) = 0 then
        return jsonb_build_object('success', false, 'code', 'SHIFT_NOT_OPEN',
          'error', 'No open operator shift for this outlet. Open a shift in POS first.');
      end if;
    end if;
  exception when others then
    null;
  end;

  v_hash := md5(coalesce(v_lodge::text, '') || '|' || coalesce(v_outlet::text, '') || '|' ||
    coalesce(v_booking::text, '') || '|' || coalesce(v_room::text, '') || '|' || v_lines::text);

  -- Idempotent replay: same key + same payload returns the original.
  -- Same key + DIFFERENT payload is a conflict, never a silent replay.
  select * into v_existing from public.fnb_room_service_orders where lodge_id = v_lodge and operation_id = p_operation_id limit 1;
  if found then
    if coalesce(v_existing.payload_hash, '') <> '' and v_existing.payload_hash <> v_hash then
      return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT',
        'error', 'This operation ID was already used with different order details. Use a new operation ID for a new order.');
    end if;
    select * into v_pos from public.pos_orders where id = v_existing.pos_order_id limit 1;
    return jsonb_build_object('success', true, 'replayed', true, 'order', to_jsonb(v_existing), 'pos_order', to_jsonb(v_pos));
  end if;

  v_station := nullif(btrim(coalesce(p_payload->>'station', 'kitchen')), '');
  if v_station is null then v_station := 'kitchen'; end if;

  -- Canonical POS order first: one order per operation key (unique index
  -- guards double-inserts on retry). Server-derived total, room service mode.
  insert into public.pos_orders (
    lodge_id, room_id, booking_id, status, total, notes, outlet_id,
    create_idempotency_key, payment_method, service_mode,
    gross_total, discount_total, tax_total, tip_total
  ) values (
    v_lodge, v_room, v_booking, 'open', v_total,
    nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
    v_outlet, p_operation_id, 'cash', 'room',
    v_total, 0, 0, 0
  )
  on conflict (lodge_id, create_idempotency_key) where create_idempotency_key is not null
  do nothing
  returning * into v_pos;
  if v_pos.id is null then
    -- A concurrent retry won the race: return the winner as a replay.
    select * into v_pos from public.pos_orders where lodge_id = v_lodge and create_idempotency_key = p_operation_id limit 1;
    select * into v_existing from public.fnb_room_service_orders where lodge_id = v_lodge and operation_id = p_operation_id limit 1;
    if found then
      return jsonb_build_object('success', true, 'replayed', true, 'order', to_jsonb(v_existing), 'pos_order', to_jsonb(v_pos));
    end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT',
      'error', 'This operation ID is already in use by another order.');
  end if;

  insert into public.pos_order_items (lodge_id, order_id, menu_item_id, item_name, quantity, unit_price, subtotal)
  select v_lodge, v_pos.id,
    (line->>'menu_item_id')::uuid, line->>'item_name',
    (line->>'quantity')::integer, (line->>'unit_price')::numeric, (line->>'subtotal')::numeric
    from jsonb_array_elements(v_lines) as line;

  -- Kitchen ticket: the same queue the kitchen, bar, and Legacy POS read.
  -- service_mode='room' (added by 20260820140000, which always precedes this
  -- migration) marks room-service tickets in the shared queue.
  insert into public.pos_prep_tickets (lodge_id, order_id, outlet_id, station, status, service_mode, room_id, notes, items)
  values (v_lodge, v_pos.id, v_outlet, v_station, 'new', 'room', v_room,
    nullif(btrim(coalesce(p_payload->>'notes', '')), ''), v_ticket_items);

  insert into public.fnb_room_service_orders (
    lodge_id, outlet_id, booking_id, room_id, room_label, customer_name,
    items, notes, status, station, operation_id, created_by, updated_by,
    pos_order_id, pos_total, payload_hash
  ) values (
    v_lodge, v_outlet, v_booking, v_room,
    nullif(btrim(coalesce(p_payload->>'room_label', '')), ''),
    nullif(btrim(coalesce(p_payload->>'customer_name', '')), ''),
    v_lines,
    nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
    'new', v_station,
    p_operation_id, v_user, v_user,
    v_pos.id, v_total, v_hash
  ) returning * into v_row;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, after_snapshot, operation_id)
  values (v_lodge, 'room_service_order', v_row.id, 'created', v_user, nullif(v_role, ''), jsonb_build_object('fulfilment', to_jsonb(v_row), 'pos_order', to_jsonb(v_pos)), p_operation_id);

  return jsonb_build_object('success', true, 'replayed', false, 'order', to_jsonb(v_row), 'pos_order', to_jsonb(v_pos));
end;
$$;

revoke all on function public.create_fnb_room_service_order(uuid, jsonb, text) from public;
grant execute on function public.create_fnb_room_service_order(uuid, jsonb, text) to anon, authenticated, service_role;

create or replace function public.update_fnb_room_service_status(
  p_order_id uuid,
  p_to_status text,
  p_payload jsonb default '{}'::jsonb,
  p_operation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.fnb_room_service_orders%rowtype;
  v_before jsonb;
  v_user uuid;
  v_session public.app_sessions%rowtype;
  v_auth uuid;
  v_role text := '';
  v_to text := lower(btrim(coalesce(p_to_status, '')));
  v_allowed boolean := false;
  v_runner uuid;
  v_runner_name text;
  v_op text := nullif(btrim(coalesce(p_operation_id, '')), '');
  v_outlet_denial text;
  v_charge public.booking_charges%rowtype;
begin
  if p_order_id is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'An order ID is required.');
  end if;
  if v_to not in ('preparing','ready','dispatched','delivered','cancelled') then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Unknown room-service transition.');
  end if;

  select * into v_row from public.fnb_room_service_orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Room-service order not found.');
  end if;
  if not public.app_lodge_access(v_row.lodge_id) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;

  select * into v_session from public.app_current_session_row();
  if v_session.id is not null then
    v_user := v_session.user_id;
  else
    begin v_auth := public.app_authenticated_user_id(); exception when undefined_function then v_auth := null; end;
    if v_auth is not null then
      select u.id into v_user from public.users u where u.auth_user_id = v_auth and u.lodge_id = v_row.lodge_id and coalesce(u.status,'active')='active' limit 1;
    end if;
  end if;
  if v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_row.lodge_id limit 1;

  -- NOTE: status moves on an existing order are handover continuity, not new
  -- module work, so they do not require the module to be currently enabled.
  -- They DO require the actor's capability and outlet scope on every call.
  if v_to = 'cancelled' then
    if not public._fnb_has_capability(v_row.lodge_id, v_user, 'pos.void') then
      return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Cancelling a room-service order needs void permission (supervisor or above).');
    end if;
  elsif not public._fnb_has_capability(v_row.lodge_id, v_user, 'pos.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot move room-service orders.');
  end if;
  v_outlet_denial := public._fnb_require_outlet(v_row.lodge_id, v_user, v_row.outlet_id);
  if v_outlet_denial is not null then
    return jsonb_build_object('success', false, 'code', v_outlet_denial, 'error', 'That order belongs to an outlet you cannot serve.');
  end if;

  v_allowed := case v_row.status || '>' || v_to
    when 'new>preparing' then true
    when 'preparing>ready' then true
    when 'ready>dispatched' then true
    when 'dispatched>delivered' then true
    when 'new>cancelled' then true
    when 'preparing>cancelled' then true
    when 'ready>cancelled' then true
    when 'dispatched>cancelled' then true
    else false
  end;
  if not v_allowed then
    return jsonb_build_object('success', false, 'code', 'INVALID_TRANSITION',
      'error', format('Cannot move a %s order to %s.', v_row.status, v_to),
      'status', v_row.status);
  end if;
  if v_to = 'cancelled' and coalesce(btrim(coalesce(p_payload->>'cancel_reason', '')), '') = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A cancellation reason is required.');
  end if;

  v_before := to_jsonb(v_row);
  begin v_runner := nullif(coalesce(p_payload->>'runner_id', ''), '')::uuid; exception when others then v_runner := v_row.runner_id; end;
  v_runner_name := coalesce(nullif(btrim(coalesce(p_payload->>'runner_name', '')), ''), v_row.runner_name);
  if v_to = 'dispatched' and v_runner is null and v_runner_name is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Assign a runner before dispatch.');
  end if;
  if v_runner is not null then
    -- The runner must be a staff member of this lodge.
    perform 1 from public.users u where u.id = v_runner and u.lodge_id = v_row.lodge_id and coalesce(u.status, 'active') = 'active';
    if not found then
      return jsonb_build_object('success', false, 'code', 'RUNNER_UNKNOWN', 'error', 'That runner is not an active staff member of this lodge.');
    end if;
  end if;

  -- Delivery posts the folio charge server-side from the canonical POS total.
  -- The client NEVER authors folio_posted: any client-supplied flag is ignored.
  -- source_type/source_id tie the charge to its POS order so POS returns,
  -- voids, and the cumulative-reversal guard treat it as the same sale, and
  -- the unique pos-source index makes double-posting impossible.
  if v_to = 'delivered' and v_row.booking_id is not null and v_row.folio_charge_id is null and v_row.pos_order_id is not null then
    insert into public.booking_charges (lodge_id, booking_id, description, amount, category, quantity, outlet_id, source_type, source_id)
    values (v_row.lodge_id, v_row.booking_id,
      'Room service (POS ' || v_row.pos_order_id::text || ')',
      coalesce(v_row.pos_total, 0), 'Food & Beverage', 1, v_row.outlet_id, 'pos_order', v_row.pos_order_id)
    on conflict (lodge_id, source_type, source_id) where source_type in ('pos_order', 'pos_return')
    do nothing
    returning * into v_charge;
    if v_charge.id is null then
      select * into v_charge from public.booking_charges
       where lodge_id = v_row.lodge_id and source_type = 'pos_order' and source_id = v_row.pos_order_id limit 1;
    end if;
  elsif v_to = 'delivered' and v_row.folio_charge_id is not null then
    select * into v_charge from public.booking_charges where id = v_row.folio_charge_id limit 1;
  end if;

  -- Mirror preparation progress onto the canonical kitchen ticket so the
  -- kitchen, bar, and Legacy POS queues move with the fulfilment state.
  -- Guarded: an unexpected ticket shape must never break the transition.
  if v_to in ('preparing', 'ready') and v_row.pos_order_id is not null then
    begin
      update public.pos_prep_tickets
         set status = v_to, updated_at = now()
       where lodge_id = v_row.lodge_id and order_id = v_row.pos_order_id;
    exception when others then
      null;
    end;
  end if;

  update public.fnb_room_service_orders
     set status = v_to,
         runner_id = coalesce(v_runner, runner_id),
         runner_name = v_runner_name,
         cancel_reason = case when v_to = 'cancelled' then nullif(btrim(coalesce(p_payload->>'cancel_reason', '')), '') else cancel_reason end,
         folio_charge_id = coalesce(v_charge.id, folio_charge_id),
         folio_posted = case when v_to = 'delivered' and v_charge.id is not null then true else folio_posted end,
         dispatched_at = case when v_to = 'dispatched' then now() else dispatched_at end,
         delivered_at = case when v_to = 'delivered' then now() else delivered_at end,
         cancelled_at = case when v_to = 'cancelled' then now() else cancelled_at end,
         updated_by = v_user,
         updated_at = now()
   where id = p_order_id
  returning * into v_row;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, before_snapshot, after_snapshot, operation_id)
  values (v_row.lodge_id, 'room_service_order', v_row.id, 'status:' || v_row.status, v_user, nullif(v_role, ''), v_before,
    jsonb_build_object('fulfilment', to_jsonb(v_row), 'folio_charge', to_jsonb(v_charge)), v_op);

  if v_to = 'delivered' and v_row.booking_id is null then
    return jsonb_build_object('success', true, 'order', to_jsonb(v_row),
      'folio_note', 'No booking is linked, so no folio charge was posted. Collect payment through the canonical POS order.');
  end if;
  return jsonb_build_object('success', true, 'order', to_jsonb(v_row), 'folio_charge', to_jsonb(v_charge));
end;
$$;

revoke all on function public.update_fnb_room_service_status(uuid, text, jsonb, text) from public;
grant execute on function public.update_fnb_room_service_status(uuid, text, jsonb, text) to anon, authenticated, service_role;

-- ── Meal-plan contracts ───────────────────────────────────────────────────
create or replace function public.create_fnb_meal_entitlement(
  p_lodge_id uuid,
  p_payload jsonb,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_role text := '';
  v_module_denial text;
  v_existing public.fnb_meal_plan_entitlements%rowtype;
  v_row public.fnb_meal_plan_entitlements%rowtype;
  v_booking uuid;
  v_booking_lodge uuid;
  v_booking_status text := '';
  v_covers integer;
  v_plan text;
  v_from date;
  v_to date;
  v_hash text;
begin
  if p_operation_id is null or btrim(p_operation_id) = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A stable operation ID is required.');
  end if;
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  v_module_denial := public._fnb_require_module(v_lodge, 'meal-plans');
  if v_module_denial is not null then
    return jsonb_build_object('success', false, 'code', v_module_denial,
      'error', case v_module_denial
        when 'MODULE_DISABLED' then 'Meal plans are currently disabled. An administrator can enable them in Food & Beverage → More tools.'
        when 'ENTITLEMENT_UNVERIFIED' then 'The licence for meal plans could not be verified. Reconnect and retry.'
        else 'This lodge does not include meal plans. Request access to use them.' end);
  end if;
  if not public._fnb_has_capability(v_lodge, v_user, 'pos.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot grant meal plans.');
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_lodge limit 1;

  begin v_booking := nullif(p_payload->>'booking_id', '')::uuid; exception when others then v_booking := null; end;
  if v_booking is not null then
    begin
      select lodge_id, lower(coalesce(status, ''))
        into v_booking_lodge, v_booking_status
        from public.bookings where id = v_booking limit 1;
    exception when undefined_table then
      return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'The booking store is unavailable.');
    end;
    if not found or v_booking_lodge is distinct from v_lodge then
      return jsonb_build_object('success', false, 'code', 'BOOKING_SCOPE_DENIED', 'error', 'That booking does not belong to this lodge.');
    end if;
    if v_booking_status not in ('confirmed', 'checked_in') then
      return jsonb_build_object('success', false, 'code', 'BOOKING_NOT_ACTIVE',
        'error', 'Meal plans need an active (confirmed or checked-in) booking.', 'status', v_booking_status);
    end if;
  end if;

  v_covers := coalesce(nullif(btrim(coalesce(p_payload->>'total_covers', '')), '')::integer, 0);
  if v_covers <= 0 or v_covers > 500 then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Total covers must be between 1 and 500.');
  end if;
  v_plan := btrim(coalesce(p_payload->>'plan_code', ''));
  if v_plan not in ('FULL_BOARD','HALF_BOARD','BED_BREAKFAST','VOUCHER') then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Unknown meal-plan code.');
  end if;
  begin v_from := nullif(p_payload->>'valid_from', '')::date; exception when others then v_from := null; end;
  begin v_to := nullif(p_payload->>'valid_to', '')::date; exception when others then v_to := null; end;
  if v_from is not null and v_to is not null and v_to < v_from then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'The plan end date cannot be before the start date.');
  end if;

  v_hash := md5(coalesce(v_lodge::text, '') || '|' || coalesce(v_booking::text, '') || '|' ||
    nullif(btrim(coalesce(p_payload->>'customer_name', '')), '') || '|' || v_plan || '|' || v_covers::text);

  select * into v_existing from public.fnb_meal_plan_entitlements where lodge_id = v_lodge and operation_id = p_operation_id limit 1;
  if found then
    if coalesce(v_existing.payload_hash, '') <> '' and v_existing.payload_hash <> v_hash then
      return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT',
        'error', 'This operation ID was already used with different plan details. Use a new operation ID for a new plan.');
    end if;
    return jsonb_build_object('success', true, 'replayed', true, 'entitlement', to_jsonb(v_existing));
  end if;

  insert into public.fnb_meal_plan_entitlements (
    lodge_id, booking_id, customer_name, plan_code, total_covers, remaining_covers,
    valid_from, valid_to, operation_id, created_by, payload_hash
  ) values (
    v_lodge, v_booking,
    nullif(btrim(coalesce(p_payload->>'customer_name', '')), ''),
    v_plan, v_covers, v_covers,
    v_from, v_to,
    p_operation_id, v_user, v_hash
  ) returning * into v_row;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, after_snapshot, operation_id)
  values (v_lodge, 'meal_entitlement', v_row.id, 'granted', v_user, nullif(v_role, ''), to_jsonb(v_row), p_operation_id);

  return jsonb_build_object('success', true, 'replayed', false, 'entitlement', to_jsonb(v_row));
end;
$$;

revoke all on function public.create_fnb_meal_entitlement(uuid, jsonb, text) from public;
grant execute on function public.create_fnb_meal_entitlement(uuid, jsonb, text) to anon, authenticated, service_role;

-- One atomic redemption: entitlement decrement + consumption record.
-- inventory_consumed / folio_reference are SERVER-DERIVED and always stored
-- as false / null: no inventory movement or folio operation runs here, so the
-- row must never claim one happened. This contract never writes
-- bookings.amount_paid and never authors payment_status.
create or replace function public.redeem_fnb_meal(
  p_entitlement_id uuid,
  p_payload jsonb,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ent public.fnb_meal_plan_entitlements%rowtype;
  v_user uuid;
  v_session public.app_sessions%rowtype;
  v_auth uuid;
  v_role text := '';
  v_module_denial text;
  v_outlet_denial text;
  v_covers integer := 1;
  v_existing public.fnb_meal_redemptions%rowtype;
  v_red public.fnb_meal_redemptions%rowtype;
  v_outlet uuid;
  v_complimentary boolean := false;
  v_hash text;
  v_today date := (now() at time zone 'Africa/Gaborone')::date;
begin
  if p_entitlement_id is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'An entitlement ID is required.');
  end if;
  if p_operation_id is null or btrim(p_operation_id) = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A stable operation ID is required.');
  end if;

  select * into v_ent from public.fnb_meal_plan_entitlements where id = p_entitlement_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Meal-plan entitlement not found.');
  end if;
  if not public.app_lodge_access(v_ent.lodge_id) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;

  select * into v_session from public.app_current_session_row();
  if v_session.id is not null then
    v_user := v_session.user_id;
  else
    begin v_auth := public.app_authenticated_user_id(); exception when undefined_function then v_auth := null; end;
    if v_auth is not null then
      select u.id into v_user from public.users u where u.auth_user_id = v_auth and u.lodge_id = v_ent.lodge_id and coalesce(u.status,'active')='active' limit 1;
    end if;
  end if;
  if v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_ent.lodge_id limit 1;

  v_module_denial := public._fnb_require_module(v_ent.lodge_id, 'meal-plans');
  if v_module_denial is not null then
    return jsonb_build_object('success', false, 'code', v_module_denial,
      'error', case v_module_denial
        when 'MODULE_DISABLED' then 'Meal plans are currently disabled. An administrator can enable them in Food & Beverage → More tools.'
        when 'ENTITLEMENT_UNVERIFIED' then 'The licence for meal plans could not be verified. Reconnect and retry.'
        else 'This lodge does not include meal plans. Request access to use them.' end);
  end if;
  if not public._fnb_has_capability(v_ent.lodge_id, v_user, 'pos.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot redeem meals.');
  end if;

  begin v_outlet := nullif(p_payload->>'outlet_id', '')::uuid; exception when others then v_outlet := null; end;
  v_outlet_denial := public._fnb_require_outlet(v_ent.lodge_id, v_user, v_outlet);
  if v_outlet_denial is not null then
    return jsonb_build_object('success', false, 'code', v_outlet_denial, 'error', 'That outlet is not available to you in this lodge.');
  end if;

  -- Entitlement window enforcement: expired or not-yet-valid plans cannot serve.
  if v_ent.valid_from is not null and v_today < v_ent.valid_from then
    return jsonb_build_object('success', false, 'code', 'PLAN_NOT_ACTIVE',
      'error', format('This plan starts on %s.', v_ent.valid_from));
  end if;
  if v_ent.valid_to is not null and v_today > v_ent.valid_to then
    return jsonb_build_object('success', false, 'code', 'PLAN_EXPIRED',
      'error', format('This plan expired on %s.', v_ent.valid_to));
  end if;

  begin v_covers := coalesce(nullif(btrim(coalesce(p_payload->>'covers', '1')), '')::integer, 1); exception when others then v_covers := 0; end;
  if v_covers <= 0 or v_covers > 100 then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Covers must be between 1 and 100.');
  end if;
  if v_covers > v_ent.remaining_covers then
    return jsonb_build_object('success', false, 'code', 'INSUFFICIENT_COVERS',
      'error', format('Only %s cover(s) remain on this plan.', v_ent.remaining_covers),
      'remaining_covers', v_ent.remaining_covers);
  end if;
  v_complimentary := coalesce((p_payload->>'complimentary')::boolean, false);
  if v_complimentary and coalesce(btrim(p_payload->>'complimentary_reason'), '') = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A reason is required for complimentary meals.');
  end if;
  if v_complimentary and not public._fnb_can_manage(v_ent.lodge_id, v_user) then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Complimentary meals require a manager or administrator.');
  end if;

  v_hash := md5(v_ent.id::text || '|' || v_covers::text || '|' || case when v_complimentary then '1' else '0' end || '|' ||
    coalesce(v_outlet::text, '') || '|' || coalesce(nullif(btrim(coalesce(p_payload->>'complimentary_reason', '')), ''), ''));

  select * into v_existing from public.fnb_meal_redemptions where lodge_id = v_ent.lodge_id and operation_id = p_operation_id limit 1;
  if found then
    if coalesce(v_existing.payload_hash, '') <> '' and v_existing.payload_hash <> v_hash then
      return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT',
        'error', 'This operation ID was already used with different redemption details. Use a new operation ID.');
    end if;
    return jsonb_build_object('success', true, 'replayed', true, 'redemption', to_jsonb(v_existing));
  end if;

  update public.fnb_meal_plan_entitlements
     set remaining_covers = remaining_covers - v_covers, updated_at = now()
   where id = v_ent.id;

  insert into public.fnb_meal_redemptions (
    lodge_id, entitlement_id, outlet_id, covers, complimentary, complimentary_reason,
    approved_by, inventory_consumed, folio_reference, operation_id, created_by, payload_hash
  ) values (
    v_ent.lodge_id, v_ent.id, v_outlet, v_covers, v_complimentary,
    nullif(btrim(coalesce(p_payload->>'complimentary_reason', '')), ''),
    case when v_complimentary then v_user else null end,
    false, null,
    p_operation_id, v_user, v_hash
  ) returning * into v_red;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, after_snapshot, operation_id)
  values (v_ent.lodge_id, 'meal_redemption', v_red.id, case when v_complimentary then 'redeemed_complimentary' else 'redeemed' end, v_user, nullif(v_role, ''), to_jsonb(v_red), p_operation_id);

  select * into v_ent from public.fnb_meal_plan_entitlements where id = v_ent.id;
  return jsonb_build_object('success', true, 'replayed', false, 'redemption', to_jsonb(v_red), 'remaining_covers', v_ent.remaining_covers,
    'note', 'Recorded as covers consumed. No inventory movement or folio entry was posted by this redemption.');
end;
$$;

revoke all on function public.redeem_fnb_meal(uuid, jsonb, text) from public;
grant execute on function public.redeem_fnb_meal(uuid, jsonb, text) to anon, authenticated, service_role;

-- ── Consolidated F&B performance read ─────────────────────────────────────
-- Server-confirmed sales/cost signals with explicit source + completeness so
-- the UI can label estimates and never promote them to financial truth.
create or replace function public.get_fnb_consolidated_report(
  p_lodge_id uuid,
  p_start date,
  p_end date,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_sales numeric := null;
  v_sales_complete boolean := false;
  v_sales_source text := 'unavailable';
  v_cost numeric := null;
  v_cost_complete boolean := false;
  v_cost_source text := 'unavailable';
  v_expense_total numeric := null;
  v_expense_complete boolean := false;
  v_expense_source text := 'unavailable';
  v_covers integer := null;
begin
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A valid date range is required.');
  end if;

  -- POS sales from the canonical pos_orders ledger. Column truth (baseline):
  -- pos_orders(total, status, created_at, outlet_id). Unknown statuses are
  -- counted; only explicit void/cancel rows are excluded. Any query failure
  -- yields NULL (unavailable), never a zero presented as truth.
  begin
    if to_regclass('public.pos_orders') is not null then
      if p_outlet_id is null then
        execute 'select sum(total)::numeric, count(*)::integer from public.pos_orders where lodge_id = $1 and (created_at::date between $2 and $3) and coalesce(status, '''') not in (''voided'',''cancelled'',''void'')'
          into v_sales, v_covers using v_lodge, p_start, p_end;
      else
        execute 'select sum(total)::numeric, count(*)::integer from public.pos_orders where lodge_id = $1 and outlet_id = $2 and (created_at::date between $3 and $4) and coalesce(status, '''') not in (''voided'',''cancelled'',''void'')'
          into v_sales, v_covers using v_lodge, p_outlet_id, p_start, p_end;
      end if;
      v_sales_complete := true;
      v_sales_source := 'pos_orders.total';
    end if;
  exception when others then
    v_sales := null;
    v_covers := null;
    v_sales_complete := false;
    v_sales_source := 'unavailable';
  end;

  -- Inventory purchase cost. Column truth: inventory_purchases(date,
  -- total_cost, created_at). NULL when the source cannot be read.
  begin
    if to_regclass('public.inventory_purchases') is not null then
      execute 'select sum(total_cost)::numeric from public.inventory_purchases where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))'
        into v_cost using v_lodge, p_start, p_end;
      v_cost_complete := true;
      v_cost_source := 'inventory_purchases.total_cost';
    end if;
  exception when others then
    v_cost := null;
    v_cost_complete := false;
    v_cost_source := 'unavailable';
  end;

  -- Operating expenses. Column truth: expenses(date, amount, created_at).
  begin
    if to_regclass('public.expenses') is not null then
      execute 'select sum(amount)::numeric from public.expenses where lodge_id = $1 and ((date between $2 and $3) or (created_at::date between $2 and $3))'
        into v_expense_total using v_lodge, p_start, p_end;
      v_expense_complete := true;
      v_expense_source := 'expenses.amount';
    end if;
  exception when others then
    v_expense_total := null;
    v_expense_complete := false;
    v_expense_source := 'unavailable';
  end;

  return jsonb_build_object(
    'success', true,
    'lodge_id', v_lodge,
    'outlet_id', p_outlet_id,
    'start', p_start,
    'end', p_end,
    'sales_total', v_sales,
    'sales_complete', v_sales_complete,
    'sales_source', v_sales_source,
    'purchase_cost', v_cost,
    'purchase_cost_complete', v_cost_complete,
    'purchase_cost_source', v_cost_source,
    'expense_total', v_expense_total,
    'expense_complete', v_expense_complete,
    'expense_source', v_expense_source,
    'covers', v_covers,
    'generated_at', now(),
    'source', 'server'
  );
end;
$$;

revoke all on function public.get_fnb_consolidated_report(uuid, date, date, uuid) from public;
grant execute on function public.get_fnb_consolidated_report(uuid, date, date, uuid) to anon, authenticated, service_role;

-- ── Operational reads (queues + retained history) ─────────────────────────
-- Authorised roles always read retained rows, including while the module is
-- disabled: disabling stops NEW work, never history or handovers.
create or replace function public.get_fnb_room_service_queue(
  p_lodge_id uuid,
  p_outlet_id uuid default null,
  p_include_closed boolean default false,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_rows jsonb := '[]'::jsonb;
begin
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  if not public._fnb_has_capability(v_lodge, v_user, 'pos.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot view the room-service queue.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]'::jsonb) into v_rows
    from (
      select o.*, b.room_id as booking_room_id
        from public.fnb_room_service_orders o
        left join public.bookings b on b.id = o.booking_id
       where o.lodge_id = v_lodge
         and (p_outlet_id is null or o.outlet_id = p_outlet_id or o.outlet_id is null)
         and (p_include_closed is true or o.status not in ('delivered', 'cancelled'))
       order by o.created_at desc
       limit greatest(least(coalesce(p_limit, 50), 200), 1)
    ) o;
  return jsonb_build_object('success', true, 'lodge_id', v_lodge, 'orders', v_rows, 'source', 'server');
end;
$$;

revoke all on function public.get_fnb_room_service_queue(uuid, uuid, boolean, integer) from public;
grant execute on function public.get_fnb_room_service_queue(uuid, uuid, boolean, integer) to anon, authenticated, service_role;

create or replace function public.get_fnb_meal_entitlements(
  p_lodge_id uuid,
  p_include_depleted boolean default false,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_rows jsonb := '[]'::jsonb;
begin
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  if not public._fnb_has_capability(v_lodge, v_user, 'pos.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot view meal plans.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into v_rows
    from (
      select * from public.fnb_meal_plan_entitlements
       where lodge_id = v_lodge
         and (p_include_depleted is true or remaining_covers > 0)
       order by created_at desc
       limit greatest(least(coalesce(p_limit, 50), 200), 1)
    ) e;
  return jsonb_build_object('success', true, 'lodge_id', v_lodge, 'entitlements', v_rows, 'source', 'server');
end;
$$;

revoke all on function public.get_fnb_meal_entitlements(uuid, boolean, integer) from public;
grant execute on function public.get_fnb_meal_entitlements(uuid, boolean, integer) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
