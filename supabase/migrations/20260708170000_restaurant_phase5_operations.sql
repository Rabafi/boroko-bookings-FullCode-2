begin;

-- ============================================================
-- Phase 5: Restaurant Operating System
-- Staff Shifts, Cash Drawer, Supplier/Purchasing, Prep Batches,
-- Stock Transfers, Checklists, Owner Digest, Exception Alerts,
-- Manager Approval Dashboard
-- ============================================================

-- ── Staff Shifts ─────────────────────────────────────────────
create table if not exists public.restaurant_shifts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  staff_name text not null,
  role text not null default 'cashier',
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  expected_hours numeric,
  actual_hours numeric generated always as (
    case when clock_out is not null
      then extract(epoch from (clock_out - clock_in)) / 3600.0
      else null end
  ) stored,
  notes text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.restaurant_shifts enable row level security;

create policy restaurant_shifts_lodge_scope_select on public.restaurant_shifts
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_shifts_lodge_scope_insert on public.restaurant_shifts
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_shifts_lodge_scope_update on public.restaurant_shifts
  for update using (public.app_lodge_access(lodge_id));

-- ── Cash Drawer Sessions ─────────────────────────────────────
create table if not exists public.restaurant_cash_drawer_sessions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_float numeric not null default 0,
  closing_total numeric,
  expected_total numeric,
  variance numeric,
  card_total numeric not null default 0,
  mobile_total numeric not null default 0,
  voucher_total numeric not null default 0,
  declared_total numeric,
  notes text,
  status text not null default 'open',
  opened_by uuid,
  closed_by uuid,
  created_at timestamptz not null default now()
);

alter table public.restaurant_cash_drawer_sessions enable row level security;

create policy restaurant_cash_drawer_sessions_lodge_scope_select on public.restaurant_cash_drawer_sessions
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_cash_drawer_sessions_lodge_scope_insert on public.restaurant_cash_drawer_sessions
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_cash_drawer_sessions_lodge_scope_update on public.restaurant_cash_drawer_sessions
  for update using (public.app_lodge_access(lodge_id));

-- ── Suppliers ────────────────────────────────────────────────
create table if not exists public.restaurant_suppliers (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  name text not null,
  contact_person text,
  email text,
  phone text,
  address text,
  payment_terms text,
  rating integer,
  notes text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_suppliers enable row level security;

create policy restaurant_suppliers_lodge_scope_select on public.restaurant_suppliers
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_suppliers_lodge_scope_insert on public.restaurant_suppliers
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_suppliers_lodge_scope_update on public.restaurant_suppliers
  for update using (public.app_lodge_access(lodge_id));

-- ── Purchase Orders ──────────────────────────────────────────
create table if not exists public.restaurant_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  supplier_id uuid references public.restaurant_suppliers(id) on delete set null,
  order_date timestamptz not null default now(),
  expected_delivery timestamptz,
  status text not null default 'draft',
  total numeric not null default 0,
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_purchase_orders enable row level security;

create policy restaurant_purchase_orders_lodge_scope_select on public.restaurant_purchase_orders
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_purchase_orders_lodge_scope_insert on public.restaurant_purchase_orders
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_purchase_orders_lodge_scope_update on public.restaurant_purchase_orders
  for update using (public.app_lodge_access(lodge_id));

-- ── Purchase Order Items ─────────────────────────────────────
create table if not exists public.restaurant_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.restaurant_purchase_orders(id) on delete cascade,
  inventory_item_id uuid,
  description text,
  quantity numeric not null default 0,
  unit_cost numeric not null default 0,
  total numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table public.restaurant_purchase_order_items enable row level security;

create policy restaurant_purchase_order_items_lodge_scope_select on public.restaurant_purchase_order_items
  for select using (
    exists (
      select 1 from public.restaurant_purchase_orders po
      where po.id = purchase_order_id and public.app_lodge_access(po.lodge_id)
    )
  );

create policy restaurant_purchase_order_items_lodge_scope_insert on public.restaurant_purchase_order_items
  for insert with check (
    exists (
      select 1 from public.restaurant_purchase_orders po
      where po.id = purchase_order_id and public.app_lodge_access(po.lodge_id)
    )
  );

create policy restaurant_purchase_order_items_lodge_scope_update on public.restaurant_purchase_order_items
  for update using (
    exists (
      select 1 from public.restaurant_purchase_orders po
      where po.id = purchase_order_id and public.app_lodge_access(po.lodge_id)
    )
  );

-- ── Prep Batches ─────────────────────────────────────────────
create table if not exists public.restaurant_prep_batches (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  batch_date timestamptz not null default now(),
  recipe_id uuid,
  recipe_name text,
  quantity numeric not null default 1,
  unit_cost numeric not null default 0,
  total_cost numeric not null default 0,
  status text not null default 'planned',
  notes text,
  produced_by uuid,
  produced_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.restaurant_prep_batches enable row level security;

create policy restaurant_prep_batches_lodge_scope_select on public.restaurant_prep_batches
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_prep_batches_lodge_scope_insert on public.restaurant_prep_batches
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_prep_batches_lodge_scope_update on public.restaurant_prep_batches
  for update using (public.app_lodge_access(lodge_id));

-- ── Stock Transfers ──────────────────────────────────────────
create table if not exists public.restaurant_stock_transfers (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  from_outlet_id uuid,
  to_outlet_id uuid,
  inventory_item_id uuid,
  quantity numeric not null default 0,
  status text not null default 'pending',
  notes text,
  transferred_by uuid,
  transferred_at timestamptz,
  received_by uuid,
  received_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.restaurant_stock_transfers enable row level security;

create policy restaurant_stock_transfers_lodge_scope_select on public.restaurant_stock_transfers
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_stock_transfers_lodge_scope_insert on public.restaurant_stock_transfers
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_stock_transfers_lodge_scope_update on public.restaurant_stock_transfers
  for update using (public.app_lodge_access(lodge_id));

-- ── Daily Checklists ─────────────────────────────────────────
create table if not exists public.restaurant_checklists (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  checklist_date timestamptz not null default now(),
  checklist_type text not null default 'daily_opening',
  status text not null default 'pending',
  notes text,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.restaurant_checklists enable row level security;

create policy restaurant_checklists_lodge_scope_select on public.restaurant_checklists
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_checklists_lodge_scope_insert on public.restaurant_checklists
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_checklists_lodge_scope_update on public.restaurant_checklists
  for update using (public.app_lodge_access(lodge_id));

-- ── Checklist Items ──────────────────────────────────────────
create table if not exists public.restaurant_checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.restaurant_checklists(id) on delete cascade,
  item_label text not null,
  is_completed boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.restaurant_checklist_items enable row level security;

create policy restaurant_checklist_items_lodge_scope_select on public.restaurant_checklist_items
  for select using (
    exists (
      select 1 from public.restaurant_checklists c
      where c.id = checklist_id and public.app_lodge_access(c.lodge_id)
    )
  );

create policy restaurant_checklist_items_lodge_scope_insert on public.restaurant_checklist_items
  for insert with check (
    exists (
      select 1 from public.restaurant_checklists c
      where c.id = checklist_id and public.app_lodge_access(c.lodge_id)
    )
  );

create policy restaurant_checklist_items_lodge_scope_update on public.restaurant_checklist_items
  for update using (
    exists (
      select 1 from public.restaurant_checklists c
      where c.id = checklist_id and public.app_lodge_access(c.lodge_id)
    )
  );

-- ── Exception Alerts ─────────────────────────────────────────
create table if not exists public.restaurant_alerts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  alert_type text not null,
  severity text not null default 'info',
  message text not null,
  entity_type text,
  entity_id uuid,
  is_resolved boolean not null default false,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.restaurant_alerts enable row level security;

create policy restaurant_alerts_lodge_scope_select on public.restaurant_alerts
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_alerts_lodge_scope_insert on public.restaurant_alerts
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_alerts_lodge_scope_update on public.restaurant_alerts
  for update using (public.app_lodge_access(lodge_id));

-- ── Owner Digest Log ─────────────────────────────────────────
create table if not exists public.restaurant_owner_digest (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  digest_date timestamptz not null default now(),
  summary jsonb not null default '{}',
  sent_to text[],
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.restaurant_owner_digest enable row level security;

create policy restaurant_owner_digest_lodge_scope_select on public.restaurant_owner_digest
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_owner_digest_lodge_scope_insert on public.restaurant_owner_digest
  for insert with check (public.app_lodge_access(lodge_id));

-- ============================================================
-- RPC: Clock in a staff member
-- ============================================================
create or replace function public.clock_in_staff(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_shift_id uuid := gen_random_uuid();
  v_staff_name text := btrim(coalesce(payload->>'staff_name', ''));
  v_role text := coalesce(payload->>'role', 'cashier');
  v_expected_hours numeric := nullif(payload->>'expected_hours', '')::numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_staff_name = '' then
    return jsonb_build_object('success', false, 'error', 'Staff name is required');
  end if;

  insert into public.restaurant_shifts (
    id, lodge_id, staff_name, role, expected_hours, status
  ) values (
    v_shift_id, v_lodge_id, v_staff_name, v_role, v_expected_hours, 'active'
  );

  return jsonb_build_object('success', true, 'shift_id', v_shift_id);
end;
$$;

revoke all on function public.clock_in_staff(jsonb) from public;
grant execute on function public.clock_in_staff(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Clock out a staff member
-- ============================================================
create or replace function public.clock_out_staff(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_shift_id uuid := nullif(payload->>'shift_id', '')::uuid;
  v_notes text := nullif(payload->>'notes', '');
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_shift_id is null then
    return jsonb_build_object('success', false, 'error', 'Shift ID is required');
  end if;

  update public.restaurant_shifts
     set clock_out = now(),
         status = 'completed',
         notes = coalesce(v_notes, notes)
   where id = v_shift_id and lodge_id = v_lodge_id and status = 'active';

  if not found then
    return jsonb_build_object('success', false, 'error', 'Active shift not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.clock_out_staff(jsonb) from public;
grant execute on function public.clock_out_staff(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Open cash drawer session
-- ============================================================
create or replace function public.open_cash_drawer_session(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_session_id uuid := gen_random_uuid();
  v_opening_float numeric := coalesce(nullif(payload->>'opening_float', '')::numeric, 0);
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  -- Close any open sessions first
  update public.restaurant_cash_drawer_sessions
     set status = 'auto_closed',
         closed_at = now()
   where lodge_id = v_lodge_id and status = 'open';

  insert into public.restaurant_cash_drawer_sessions (
    id, lodge_id, opening_float, status
  ) values (
    v_session_id, v_lodge_id, v_opening_float, 'open'
  );

  return jsonb_build_object('success', true, 'session_id', v_session_id);
end;
$$;

revoke all on function public.open_cash_drawer_session(jsonb) from public;
grant execute on function public.open_cash_drawer_session(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Close cash drawer session
-- ============================================================
create or replace function public.close_cash_drawer_session(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_session_id uuid := nullif(payload->>'session_id', '')::uuid;
  v_closing_total numeric := coalesce(nullif(payload->>'closing_total', '')::numeric, 0);
  v_declared_total numeric := nullif(payload->>'declared_total', '')::numeric;
  v_notes text := nullif(payload->>'notes', '');
  v_opening_float numeric;
  v_expected numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_session_id is null then
    return jsonb_build_object('success', false, 'error', 'Session ID is required');
  end if;

  select opening_float into v_opening_float
  from public.restaurant_cash_drawer_sessions
  where id = v_session_id and lodge_id = v_lodge_id and status = 'open';

  v_expected := coalesce(v_opening_float, 0) + v_closing_total;

  update public.restaurant_cash_drawer_sessions
     set closed_at = now(),
         closing_total = v_closing_total,
         expected_total = v_expected,
         variance = case when v_declared_total is not null
           then v_declared_total - v_expected
           else null end,
         declared_total = v_declared_total,
         status = 'closed',
         notes = coalesce(v_notes, notes)
   where id = v_session_id and lodge_id = v_lodge_id and status = 'open';

  if not found then
    return jsonb_build_object('success', false, 'error', 'Open session not found');
  end if;

  return jsonb_build_object('success', true, 'expected', v_expected, 'variance',
    case when v_declared_total is not null then v_declared_total - v_expected else null end);
end;
$$;

revoke all on function public.close_cash_drawer_session(jsonb) from public;
grant execute on function public.close_cash_drawer_session(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Create a purchase order
-- ============================================================
create or replace function public.create_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := gen_random_uuid();
  v_supplier_id uuid := nullif(payload->>'supplier_id', '')::uuid;
  v_expected_delivery timestamptz := nullif(payload->>'expected_delivery', '')::timestamptz;
  v_notes text := nullif(payload->>'notes', '');
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_total numeric := 0;
  v_item jsonb;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  insert into public.restaurant_purchase_orders (
    id, lodge_id, supplier_id, expected_delivery, notes, status, created_by
  ) values (
    v_order_id, v_lodge_id, v_supplier_id, v_expected_delivery, v_notes, 'draft', auth.uid()
  );

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    declare
      v_item_total numeric := coalesce(nullif(v_item->>'quantity', '')::numeric, 0) *
                              coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0);
    begin
      insert into public.restaurant_purchase_order_items (
        purchase_order_id, inventory_item_id, description, quantity, unit_cost, total
      ) values (
        v_order_id,
        nullif(v_item->>'inventory_item_id', '')::uuid,
        nullif(v_item->>'description', ''),
        coalesce(nullif(v_item->>'quantity', '')::numeric, 0),
        coalesce(nullif(v_item->>'unit_cost', '')::numeric, 0),
        v_item_total
      );
      v_total := v_total + v_item_total;
    end;
  end loop;

  update public.restaurant_purchase_orders
     set total = v_total,
         updated_at = now()
   where id = v_order_id;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'total', v_total);
end;
$$;

revoke all on function public.create_purchase_order(jsonb) from public;
grant execute on function public.create_purchase_order(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Approve a purchase order
-- ============================================================
create or replace function public.approve_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_order_id is null then
    return jsonb_build_object('success', false, 'error', 'Order ID is required');
  end if;

  update public.restaurant_purchase_orders
     set status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         updated_at = now()
   where id = v_order_id and lodge_id = v_lodge_id and status = 'draft';

  if not found then
    return jsonb_build_object('success', false, 'error', 'Draft order not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.approve_purchase_order(jsonb) from public;
grant execute on function public.approve_purchase_order(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Create a stock transfer
-- ============================================================
create or replace function public.create_stock_transfer(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_transfer_id uuid := gen_random_uuid();
  v_from_outlet_id uuid := nullif(payload->>'from_outlet_id', '')::uuid;
  v_to_outlet_id uuid := nullif(payload->>'to_outlet_id', '')::uuid;
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_quantity numeric := coalesce(nullif(payload->>'quantity', '')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_current_stock numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_quantity <= 0 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be positive');
  end if;

  -- Verify item exists
  select current_stock into v_current_stock
  from public.inventory_items
  where id = v_inventory_item_id and lodge_id = v_lodge_id;

  if v_current_stock is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  -- Record transfer movement (log-only: intra-lodge transfer does not change total stock)
  insert into public.stock_movements (
    lodge_id, inventory_item_id, movement_type, quantity, reference_type, reference_id, notes
  ) values (
    v_lodge_id, v_inventory_item_id, 'transfer', v_quantity, 'stock_transfer', v_transfer_id,
    coalesce(v_notes, '') || ' (outlet ' || v_from_outlet_id || ' -> ' || v_to_outlet_id || ')'
  );

  -- Create transfer record
  insert into public.restaurant_stock_transfers (
    id, lodge_id, from_outlet_id, to_outlet_id, inventory_item_id, quantity, notes, status, transferred_by, transferred_at
  ) values (
    v_transfer_id, v_lodge_id, v_from_outlet_id, v_to_outlet_id, v_inventory_item_id, v_quantity, v_notes, 'completed', auth.uid(), now()
  );

  return jsonb_build_object('success', true, 'transfer_id', v_transfer_id, 'stock_before', v_current_stock);
end;
$$;

revoke all on function public.create_stock_transfer(jsonb) from public;
grant execute on function public.create_stock_transfer(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Create a daily checklist
-- ============================================================
create or replace function public.create_daily_checklist(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_checklist_id uuid := gen_random_uuid();
  v_checklist_type text := coalesce(payload->>'checklist_type', 'daily_opening');
  v_items jsonb := coalesce(payload->'items', '[]'::jsonb);
  v_item jsonb;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  insert into public.restaurant_checklists (
    id, lodge_id, checklist_type, status
  ) values (
    v_checklist_id, v_lodge_id, v_checklist_type, 'pending'
  );

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    insert into public.restaurant_checklist_items (
      checklist_id, item_label
    ) values (
      v_checklist_id, v_item->>'label'
    );
  end loop;

  return jsonb_build_object('success', true, 'checklist_id', v_checklist_id);
end;
$$;

revoke all on function public.create_daily_checklist(jsonb) from public;
grant execute on function public.create_daily_checklist(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Complete a checklist item
-- ============================================================
create or replace function public.complete_checklist_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_item_id uuid := nullif(payload->>'item_id', '')::uuid;
  v_notes text := nullif(payload->>'notes', '');
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_item_id is null then
    return jsonb_build_object('success', false, 'error', 'Item ID is required');
  end if;

  update public.restaurant_checklist_items
     set is_completed = true,
         notes = coalesce(v_notes, notes)
   where id = v_item_id;

  -- Check if all items in the checklist are completed
  update public.restaurant_checklists
     set status = 'completed',
         completed_by = auth.uid(),
         completed_at = now()
   where id = (
     select checklist_id from public.restaurant_checklist_items where id = v_item_id
   ) and lodge_id = v_lodge_id
     and not exists (
       select 1 from public.restaurant_checklist_items
       where checklist_id = public.restaurant_checklists.id and is_completed = false
     );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.complete_checklist_item(jsonb) from public;
grant execute on function public.complete_checklist_item(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Record an exception alert
-- ============================================================
create or replace function public.record_exception_alert(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_alert_id uuid := gen_random_uuid();
  v_alert_type text := btrim(coalesce(payload->>'alert_type', 'stock_low'));
  v_severity text := coalesce(payload->>'severity', 'info');
  v_message text := btrim(coalesce(payload->>'message', ''));
  v_entity_type text := nullif(payload->>'entity_type', '');
  v_entity_id uuid := nullif(payload->>'entity_id', '')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_message = '' then
    return jsonb_build_object('success', false, 'error', 'Alert message is required');
  end if;

  insert into public.restaurant_alerts (
    id, lodge_id, alert_type, severity, message, entity_type, entity_id
  ) values (
    v_alert_id, v_lodge_id, v_alert_type, v_severity, v_message, v_entity_type, v_entity_id
  );

  return jsonb_build_object('success', true, 'alert_id', v_alert_id);
end;
$$;

revoke all on function public.record_exception_alert(jsonb) from public;
grant execute on function public.record_exception_alert(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Resolve an exception alert
-- ============================================================
create or replace function public.resolve_exception_alert(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_alert_id uuid := nullif(payload->>'alert_id', '')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_alert_id is null then
    return jsonb_build_object('success', false, 'error', 'Alert ID is required');
  end if;

  update public.restaurant_alerts
     set is_resolved = true,
         resolved_by = auth.uid(),
         resolved_at = now()
   where id = v_alert_id and lodge_id = v_lodge_id and is_resolved = false;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Unresolved alert not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.resolve_exception_alert(jsonb) from public;
grant execute on function public.resolve_exception_alert(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Generate owner digest summary
-- ============================================================
create or replace function public.generate_owner_digest(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_summary jsonb;
  v_digest_id uuid := gen_random_uuid();
  v_today date := current_date;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select jsonb_build_object(
    'date', v_today,
    'total_revenue', coalesce(sum(o.total), 0),
    'total_orders', count(o.id),
    'avg_order', case when count(o.id) > 0 then sum(o.total) / count(o.id) else 0 end,
    'pending_orders', count(*) filter (where o.status = 'pending'),
    'active_alerts', (
      select count(*) from public.restaurant_alerts a
      where a.lodge_id = p_lodge_id and a.is_resolved = false
    ),
    'low_stock_items', (
      select count(*) from public.inventory_items i
      where i.lodge_id = p_lodge_id and i.current_stock <= i.reorder_level
    ),
    'open_checklists', (
      select count(*) from public.restaurant_checklists c
      where c.lodge_id = p_lodge_id and c.status = 'pending'
        and c.checklist_date >= (v_today || 'T00:00:00Z')::timestamptz
    )
  ) into v_summary
  from public.pos_orders o
  where o.lodge_id = p_lodge_id
    and o.created_at >= (v_today || 'T00:00:00Z')::timestamptz;

  insert into public.restaurant_owner_digest (
    id, lodge_id, digest_date, summary
  ) values (
    v_digest_id, p_lodge_id, now(), v_summary
  );

  return jsonb_build_object('success', true, 'digest', v_summary);
end;
$$;

revoke all on function public.generate_owner_digest(uuid) from public;
grant execute on function public.generate_owner_digest(uuid)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Get active alerts for a lodge
-- ============================================================
create or replace function public.get_active_alerts(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_alerts jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'alert_type', a.alert_type,
      'severity', a.severity,
      'message', a.message,
      'entity_type', a.entity_type,
      'entity_id', a.entity_id,
      'created_at', a.created_at
    ) order by a.created_at desc
  ), '[]'::jsonb)
  into v_alerts
  from public.restaurant_alerts a
  where a.lodge_id = p_lodge_id and a.is_resolved = false;

  return coalesce(v_alerts, '[]'::jsonb);
end;
$$;

revoke all on function public.get_active_alerts(uuid) from public;
grant execute on function public.get_active_alerts(uuid)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Get active staff shifts
-- ============================================================
create or replace function public.get_active_shifts(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shifts jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'staff_name', s.staff_name,
      'role', s.role,
      'clock_in', s.clock_in,
      'expected_hours', s.expected_hours,
      'status', s.status
    ) order by s.clock_in desc
  ), '[]'::jsonb)
  into v_shifts
  from public.restaurant_shifts s
  where s.lodge_id = p_lodge_id and s.status = 'active';

  return coalesce(v_shifts, '[]'::jsonb);
end;
$$;

revoke all on function public.get_active_shifts(uuid) from public;
grant execute on function public.get_active_shifts(uuid)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Get open cash drawer session
-- ============================================================
create or replace function public.get_open_cash_drawer(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select jsonb_build_object(
    'id', cs.id,
    'opening_float', cs.opening_float,
    'opened_at', cs.opened_at,
    'status', cs.status
  ) into v_session
  from public.restaurant_cash_drawer_sessions cs
  where cs.lodge_id = p_lodge_id and cs.status = 'open'
  limit 1;

  return coalesce(v_session, 'null'::jsonb);
end;
$$;

revoke all on function public.get_open_cash_drawer(uuid) from public;
grant execute on function public.get_open_cash_drawer(uuid)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Create a supplier
-- ============================================================
create or replace function public.create_restaurant_supplier(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_supplier_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(payload->>'name', ''));
  v_contact_person text := nullif(payload->>'contact_person', '');
  v_email text := nullif(payload->>'email', '');
  v_phone text := nullif(payload->>'phone', '');
  v_address text := nullif(payload->>'address', '');
  v_payment_terms text := nullif(payload->>'payment_terms', '');
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_name = '' then
    return jsonb_build_object('success', false, 'error', 'Supplier name is required');
  end if;

  insert into public.restaurant_suppliers (
    id, lodge_id, name, contact_person, email, phone, address, payment_terms
  ) values (
    v_supplier_id, v_lodge_id, v_name, v_contact_person, v_email, v_phone, v_address, v_payment_terms
  );

  return jsonb_build_object('success', true, 'supplier_id', v_supplier_id);
end;
$$;

revoke all on function public.create_restaurant_supplier(jsonb) from public;
grant execute on function public.create_restaurant_supplier(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Get suppliers for a lodge
-- ============================================================
create or replace function public.get_restaurant_suppliers(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_suppliers jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'contact_person', s.contact_person,
      'email', s.email,
      'phone', s.phone,
      'address', s.address,
      'payment_terms', s.payment_terms,
      'rating', s.rating,
      'status', s.status
    ) order by s.name
  ), '[]'::jsonb)
  into v_suppliers
  from public.restaurant_suppliers s
  where s.lodge_id = p_lodge_id;

  return coalesce(v_suppliers, '[]'::jsonb);
end;
$$;

revoke all on function public.get_restaurant_suppliers(uuid) from public;
grant execute on function public.get_restaurant_suppliers(uuid)
  to anon, authenticated, service_role;

commit;
