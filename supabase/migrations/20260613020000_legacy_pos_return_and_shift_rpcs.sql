-- Legacy POS: partial return RPC with PIN validation and shift open/close with stable IDs
--
-- Adds:
--   pos_override_log.return_order_id, return_total columns
--   pos_return_lines table (return line ledger for over-return protection)
--   create_pos_partial_return_with_pin(payload jsonb)
--   open_pos_shift_with_id(payload jsonb)
--   close_pos_shift_with_id(payload jsonb)
--
-- These RPCs are consumed by both the legacy Windows POS and the finished desktop POS.

begin;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Schema changes
-- ═══════════════════════════════════════════════════════════════════════════════

-- P0-1: Add return_order_id and return_total to pos_override_log
alter table public.pos_override_log
  add column if not exists return_order_id uuid references public.pos_orders(id) on delete set null,
  add column if not exists return_total numeric;

create index if not exists idx_pos_override_log_return_order
  on public.pos_override_log (lodge_id, return_order_id)
  where return_order_id is not null;

-- P0-2: Return line ledger for exact over-return tracking
create table if not exists public.pos_return_lines (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  original_order_id uuid not null references public.pos_orders(id) on delete cascade,
  original_order_item_id uuid not null references public.pos_order_items(id) on delete cascade,
  return_order_id uuid not null references public.pos_orders(id) on delete cascade,
  return_order_item_id uuid references public.pos_order_items(id) on delete set null,
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (lodge_id, return_order_id, original_order_item_id)
);

create index if not exists idx_pos_return_lines_original_item
  on public.pos_return_lines (lodge_id, original_order_item_id);

alter table public.pos_return_lines enable row level security;

create policy "Lodge access for pos_return_lines" on public.pos_return_lines
  using (public.app_lodge_access(lodge_id));

grant select, insert on public.pos_return_lines to anon, authenticated, service_role;

-- P0-1: Add shift idempotency columns BEFORE creating indexes on them
alter table public.pos_shifts
  add column if not exists create_idempotency_key text,
  add column if not exists close_idempotency_key text;

-- P1-1: Idempotency key indexes for shifts (must come after columns exist)
create unique index if not exists idx_pos_shifts_create_idempotency_key
  on public.pos_shifts (lodge_id, create_idempotency_key)
  where create_idempotency_key is not null;

create unique index if not exists idx_pos_shifts_close_idempotency_key
  on public.pos_shifts (lodge_id, close_idempotency_key)
  where close_idempotency_key is not null;

-- ═══════════════════════════════════════════════════════════════════════════════
-- P0-1 + P0-2 + P0-3: create_pos_partial_return_with_pin
-- ═══════════════════════════════════════════════════════════════════════════════
-- Atomic supervised partial return:
--   - Locks original order row FOR UPDATE
--   - Validates approver PIN against users.pin_hash
--   - Rejects over-returns using pos_return_lines ledger (exact line tracking)
--   - Inserts negative return order via internal create_pos_order logic
--   - Writes pos_override_log with action = 'partial_return'
--   - Payment breakdown uses negative amounts for refund orders
--   - Idempotent via return_idempotency_key

create or replace function public.create_pos_partial_return_with_pin(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id uuid := (payload->>'order_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_return_order_id uuid := coalesce(nullif(payload->>'return_order_id', '')::uuid, gen_random_uuid());
  v_return_idempotency_key text := nullif(payload->>'return_idempotency_key', '');
  v_pin text := nullif(btrim(coalesce(payload->>'pin', '')), '');
  v_reason text := nullif(payload->>'reason', '');
  v_requester_id uuid := nullif(payload->>'requested_by', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_override_log_id uuid := nullif(payload->>'override_log_id', '')::uuid;
  v_created_at timestamptz := coalesce(nullif(payload->>'created_at', '')::timestamptz, now());
  v_lines jsonb := coalesce(payload->'lines', '[]'::jsonb);

  v_order record;
  v_original_item record;
  v_line jsonb;
  v_line_id uuid;
  v_requested_qty numeric;
  v_original_qty numeric;
  v_previously_returned numeric;
  v_remaining numeric;
  v_return_qty numeric;
  v_unit_price numeric;
  v_total numeric := 0;
  v_item_count integer := 0;
  v_return_items jsonb := '[]'::jsonb;
  v_return_item jsonb;
  v_payment_breakdown jsonb;
  v_created_order_id uuid;
  v_approver_id uuid;
  v_return_order_item_id uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_order_id is null then
    return jsonb_build_object('success', false, 'error', 'order_id is required');
  end if;

  if v_pin is null then
    return jsonb_build_object('success', false, 'error', 'PIN is required');
  end if;

  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one return line is required');
  end if;

  -- Lock original order
  select o.id, o.status, o.lodge_id, o.outlet_id, o.walk_in_name, o.room_id,
         o.booking_id, o.payment_method, o.total
    into v_order
    from public.pos_orders o
   where o.id = v_order_id
     and o.lodge_id = v_lodge_id
   for update;

  if v_order.id is null then
    return jsonb_build_object('success', false, 'error', 'Original order not found');
  end if;

  if v_order.status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Cannot return items from a voided order');
  end if;

  perform public.app_require_pos_outlet_access(v_lodge_id, coalesce(v_outlet_id, v_order.outlet_id));

  -- Idempotency check
  if v_return_idempotency_key is not null then
    select id into v_created_order_id
      from public.pos_orders
     where lodge_id = v_lodge_id
       and create_idempotency_key = v_return_idempotency_key
     order by created_at desc
     limit 1
     for update;

    if found then
      return jsonb_build_object(
        'success', true, 'id', v_created_order_id,
        'idempotent', true, 'replayed', true
      );
    end if;
  end if;

  -- Validate PIN against approved users
  select u.id into v_approver_id
    from public.users u
   where u.lodge_id = v_lodge_id
     and u.pin_hash is not null
     and lower(coalesce(u.role, '')) in ('supervisor', 'manager', 'admin', 'super_admin')
     and extensions.crypt(v_pin, u.pin_hash) = u.pin_hash
   limit 1;

  if v_approver_id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid PIN');
  end if;

  -- Build return items and validate against original order
  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_requested_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);

    if v_line_id is null or v_requested_qty <= 0 then
      continue;
    end if;

    -- Find the original item by exact line ID
    select poi.id, poi.quantity, poi.unit_price, poi.menu_item_id,
           poi.inventory_item_id, poi.depletion_qty, poi.item_name
      into v_original_item
      from public.pos_order_items poi
     where poi.id = v_line_id
       and poi.order_id = v_order_id
       and poi.lodge_id = v_lodge_id;

    if v_original_item.id is null then
      return jsonb_build_object('success', false, 'error', 'Line ' || v_line_id || ' not found in original order');
    end if;

    v_original_qty := coalesce(v_original_item.quantity, 0);
    v_unit_price := coalesce(v_original_item.unit_price, 0);

    -- P0-2: Calculate previously returned quantity using exact line ledger
    select coalesce(sum(prl.quantity), 0)
      into v_previously_returned
      from public.pos_return_lines prl
     where prl.original_order_item_id = v_line_id
       and prl.lodge_id = v_lodge_id;

    -- Calculate remaining returnable quantity
    v_remaining := v_original_qty - v_previously_returned;

    if v_remaining <= 0 then
      return jsonb_build_object('success', false, 'error',
        'No remaining quantity to return for ' || v_original_item.item_name ||
        ' (originally ' || v_original_qty || ', already returned ' || v_previously_returned || ')');
    end if;

    -- Clamp requested to remaining (or reject if strict mode desired)
    v_return_qty := least(v_requested_qty, v_remaining);

    v_return_item := jsonb_build_object(
      'original_order_item_id', v_line_id,
      'menu_item_id', v_original_item.menu_item_id,
      'inventory_item_id', v_original_item.inventory_item_id,
      'depletion_qty', coalesce(v_original_item.depletion_qty, 1),
      'item_name', 'Return: ' || v_original_item.item_name,
      'quantity', -v_return_qty,
      'unit_price', v_unit_price,
      'category', null
    );
    v_return_items := v_return_items || v_return_item;
    v_total := v_total + (-v_return_qty * v_unit_price);
    v_item_count := v_item_count + 1;
  end loop;

  if v_item_count = 0 then
    return jsonb_build_object('success', false, 'error', 'No valid return lines');
  end if;

  -- P0-3: Build payment breakdown with NEGATIVE amounts for refund orders
  v_payment_breakdown := jsonb_build_array(
    jsonb_build_object(
      'method', coalesce(v_order.payment_method, 'cash'),
      'amount', v_total,
      'reference', null
    )
  );

  -- Insert return order
  insert into public.pos_orders (
    id, lodge_id, room_id, booking_id, walk_in_name, total, notes, payment_method,
    gross_total, discount_total, tax_rate, tax_total, tip_total, payment_breakdown,
    outlet_id, status, created_at, create_idempotency_key, cashier_id, cashier_name
  ) values (
    v_return_order_id, v_lodge_id, v_order.room_id, v_order.booking_id,
    'Return: ' || coalesce(v_order.walk_in_name, 'Guest'),
    v_total,
    'Partial return for order ' || left(v_order_id::text, 8) || coalesce(' - ' || v_reason, ''),
    coalesce(v_order.payment_method, 'cash'),
    v_total, 0, 0, 0, 0, v_payment_breakdown,
    coalesce(v_outlet_id, v_order.outlet_id), 'completed',
    v_created_at, v_return_idempotency_key,
    nullif(payload->>'cashier_id', '')::uuid,
    nullif(payload->>'cashier_name', '')
  );

  -- Insert return line items and write to return line ledger
  for v_line in select * from jsonb_array_elements(v_return_items) loop
    v_return_order_item_id := gen_random_uuid();

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id, item_name, quantity, unit_price, subtotal,
      inventory_item_id, depletion_qty, category, modifiers, item_notes
    ) values (
      v_return_order_item_id, v_return_order_id, v_lodge_id,
      nullif(v_line->>'menu_item_id', '')::uuid,
      v_line->>'item_name',
      (v_line->>'quantity')::numeric,
      (v_line->>'unit_price')::numeric,
      round(((v_line->>'quantity')::numeric * (v_line->>'unit_price')::numeric)::numeric, 2),
      nullif(v_line->>'inventory_item_id', '')::uuid,
      coalesce((v_line->>'depletion_qty')::numeric, 1),
      nullif(v_line->>'category', ''),
      '[]'::jsonb,
      null
    );

    -- P0-2: Write to return line ledger using original_order_item_id from the built item
    insert into public.pos_return_lines (
      lodge_id, original_order_id, original_order_item_id,
      return_order_id, return_order_item_id, quantity
    ) values (
      v_lodge_id, v_order_id,
      nullif(v_line->>'original_order_item_id', '')::uuid,
      v_return_order_id, v_return_order_item_id, abs((v_line->>'quantity')::numeric)
    )
    on conflict (lodge_id, return_order_id, original_order_item_id) do nothing;

    -- Restore inventory for returned items (positive quantity adds stock back)
    if nullif(v_line->>'inventory_item_id', '')::uuid is not null then
      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) + abs((v_line->>'quantity')::numeric) * coalesce((v_line->>'depletion_qty')::numeric, 1)
       where id = nullif(v_line->>'inventory_item_id', '')::uuid
         and lodge_id = v_lodge_id;
    end if;
  end loop;

  -- Write override log with return_order_id
  insert into public.pos_override_log (
    id, lodge_id, order_id, action, requested_by, approved_by, reason, outlet_id,
    created_at, return_order_id, return_total
  ) values (
    coalesce(v_override_log_id, gen_random_uuid()), v_lodge_id, v_order_id, 'partial_return',
    v_requester_id, v_approver_id,
    v_reason, coalesce(v_outlet_id, v_order.outlet_id), v_created_at,
    v_return_order_id, abs(v_total)
  )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'success', true,
    'id', v_return_order_id,
    'total', v_total,
    'item_count', v_item_count
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- P1-1: open_pos_shift_with_id
-- ═══════════════════════════════════════════════════════════════════════════════
-- Opens a shift with a client-supplied stable shift_id.
-- Idempotent: returns existing open shift if one exists for this cashier,
-- or if the same shift_id/create_idempotency_key has been used before.

create or replace function public.open_pos_shift_with_id(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shift_id uuid := (payload->>'shift_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_cashier_id uuid := nullif(payload->>'cashier_id', '')::uuid;
  v_cashier_name text := nullif(payload->>'cashier_name', '');
  v_opening_float numeric := coalesce(nullif(payload->>'opening_float', '')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_create_idempotency_key text := nullif(payload->>'create_idempotency_key', '');
  v_existing public.pos_shifts%rowtype;
  v_row public.pos_shifts%rowtype;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform pg_advisory_xact_lock(hashtext('pos_shift:' || v_lodge_id::text || ':' || coalesce(v_cashier_id::text, 'unknown')));

  -- Idempotency: if same shift_id already exists, return it
  if v_shift_id is not null then
    select * into v_existing
      from public.pos_shifts
     where id = v_shift_id
       and lodge_id = v_lodge_id
     limit 1;

    if found then
      return jsonb_build_object(
        'success', true,
        'id', v_existing.id,
        'already_open', v_existing.status = 'open',
        'shift', to_jsonb(v_existing)
      );
    end if;
  end if;

  -- Idempotency: if same create_idempotency_key already exists, return it
  if v_create_idempotency_key is not null then
    select * into v_existing
      from public.pos_shifts
     where lodge_id = v_lodge_id
       and create_idempotency_key = v_create_idempotency_key
     order by opened_at desc
     limit 1
     for update;

    if found then
      return jsonb_build_object(
        'success', true,
        'id', v_existing.id,
        'already_open', v_existing.status = 'open',
        'shift', to_jsonb(v_existing)
      );
    end if;
  end if;

  -- Check for existing open shift for this cashier
  select * into v_existing
    from public.pos_shifts
   where lodge_id = v_lodge_id
     and cashier_id is not distinct from v_cashier_id
     and status = 'open'
   order by opened_at desc
   limit 1
   for update;

  if v_existing.id is not null then
    return jsonb_build_object(
      'success', true,
      'already_open', true,
      'shift', to_jsonb(v_existing)
    );
  end if;

  insert into public.pos_shifts (
    id, lodge_id, cashier_id, cashier_name, opening_float, status, opened_at, notes, create_idempotency_key
  ) values (
    coalesce(v_shift_id, gen_random_uuid()), v_lodge_id, v_cashier_id,
    nullif(v_cashier_name, ''), coalesce(v_opening_float, 0), 'open', now(),
    nullif(v_notes, ''), v_create_idempotency_key
  )
  returning * into v_row;

  return jsonb_build_object('success', true, 'id', v_row.id, 'shift', to_jsonb(v_row));
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- close_pos_shift_with_id
-- ═══════════════════════════════════════════════════════════════════════════════
-- Closes a shift by shift_id. Idempotent via close_idempotency_key.

create or replace function public.close_pos_shift_with_id(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shift_id uuid := (payload->>'shift_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_closing_cash numeric := coalesce(nullif(payload->>'closing_cash', '')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_close_idempotency_key text := nullif(payload->>'close_idempotency_key', '');
  v_row public.pos_shifts%rowtype;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_shift_id is null then
    return jsonb_build_object('success', false, 'error', 'shift_id is required');
  end if;

  -- Idempotency: if close_idempotency_key already used, treat as success
  if v_close_idempotency_key is not null then
    select * into v_row
      from public.pos_shifts
     where lodge_id = v_lodge_id
       and close_idempotency_key = v_close_idempotency_key
     order by closed_at desc
     limit 1;

    if found and v_row.status = 'closed' then
      return jsonb_build_object(
        'success', true,
        'id', v_row.id,
        'already_closed', true,
        'shift', to_jsonb(v_row)
      );
    end if;
  end if;

  update public.pos_shifts
     set closing_cash = coalesce(v_closing_cash, 0),
         close_notes = nullif(v_notes, ''),
         status = 'closed',
         closed_at = now(),
         close_idempotency_key = v_close_idempotency_key
   where id = v_shift_id
     and lodge_id = v_lodge_id
     and status = 'open'
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('success', false, 'error', 'Open shift not found');
  end if;

  return jsonb_build_object('success', true, 'shift', to_jsonb(v_row));
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- GRANT statements
-- ═══════════════════════════════════════════════════════════════════════════════

revoke all on function public.create_pos_partial_return_with_pin(jsonb) from public;
grant execute on function public.create_pos_partial_return_with_pin(jsonb) to anon, authenticated, service_role;
revoke all on function public.open_pos_shift_with_id(jsonb) from public;
grant execute on function public.open_pos_shift_with_id(jsonb) to anon, authenticated, service_role;
revoke all on function public.close_pos_shift_with_id(jsonb) from public;
grant execute on function public.close_pos_shift_with_id(jsonb) to anon, authenticated, service_role;

commit;
