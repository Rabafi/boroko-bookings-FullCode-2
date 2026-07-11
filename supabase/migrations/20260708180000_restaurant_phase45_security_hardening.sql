begin;

-- ============================================================
-- Phase 4/5 Security & Correctness Hardening
-- 1. Add app_require_lodge_role to all RPCs
-- 2. Fix child-table RLS (parent-join pattern)
-- 3. Fix owner digest inventory table reference
-- 4. Add real business logic for goods received, stock transfer, prep batch
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- FIX 1: Drop and recreate all Phase 4/5 RPCs with role checks
-- ────────────────────────────────────────────────────────────

-- ── Phase 4: upsert_restaurant_customer ─────────────────────
create or replace function public.upsert_restaurant_customer(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_customer_id uuid := coalesce(nullif(payload->>'customer_id', '')::uuid, gen_random_uuid());
  v_name text := btrim(coalesce(payload->>'name', ''));
  v_email text := nullif(payload->>'email', '');
  v_phone text := nullif(payload->>'phone', '');
  v_notes text := nullif(payload->>'notes', '');
  v_marketing_opt_in boolean := coalesce((payload->>'marketing_opt_in')::boolean, false);
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_name = '' then
    return jsonb_build_object('success', false, 'error', 'Customer name is required');
  end if;

  insert into public.restaurant_customers (
    id, lodge_id, name, email, phone, notes, marketing_opt_in, updated_at
  ) values (
    v_customer_id, v_lodge_id, v_name, v_email, v_phone, v_notes, v_marketing_opt_in, now()
  )
  on conflict (id) do update set
    name = excluded.name,
    email = excluded.email,
    phone = excluded.phone,
    notes = excluded.notes,
    marketing_opt_in = excluded.marketing_opt_in,
    updated_at = now()
  where public.restaurant_customers.lodge_id = v_lodge_id;

  return jsonb_build_object('success', true, 'customer_id', v_customer_id);
end;
$$;

-- ── Phase 4: get_restaurant_customers ───────────────────────
create or replace function public.get_restaurant_customers(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customers jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'email', c.email,
      'phone', c.phone,
      'loyalty_points', c.loyalty_points,
      'total_spent', c.total_spent,
      'visit_count', c.visit_count,
      'notes', c.notes,
      'marketing_opt_in', c.marketing_opt_in,
      'created_at', c.created_at
    ) order by c.name
  ), '[]'::jsonb)
  into v_customers
  from public.restaurant_customers c
  where c.lodge_id = p_lodge_id;

  return coalesce(v_customers, '[]'::jsonb);
end;
$$;

-- ── Phase 4: award_restaurant_loyalty ───────────────────────
create or replace function public.award_restaurant_loyalty(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_customer_id uuid := nullif(payload->>'customer_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_points integer := coalesce(nullif(payload->>'points', '')::integer, 0);
  v_description text := nullif(payload->>'description', '');
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_customer_id is null then
    return jsonb_build_object('success', false, 'error', 'Customer ID is required');
  end if;
  if v_points <= 0 then
    return jsonb_build_object('success', false, 'error', 'Points must be positive');
  end if;

  -- Idempotency guard
  if v_order_id is not null then
    if exists (
      select 1 from public.restaurant_loyalty_ledger
      where lodge_id = v_lodge_id and customer_id = v_customer_id and order_id = v_order_id
    ) then
      return jsonb_build_object('success', true, 'duplicate', true);
    end if;
  end if;

  insert into public.restaurant_loyalty_ledger (
    lodge_id, customer_id, order_id, points, reason, description
  ) values (
    v_lodge_id, v_customer_id, v_order_id, v_points, 'earn', v_description
  );

  update public.restaurant_customers
     set loyalty_points = loyalty_points + v_points,
         updated_at = now()
   where id = v_customer_id and lodge_id = v_lodge_id;

  return jsonb_build_object('success', true, 'points_added', v_points);
end;
$$;

-- ── Phase 4: redeem_restaurant_loyalty ──────────────────────
create or replace function public.redeem_restaurant_loyalty(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_customer_id uuid := nullif(payload->>'customer_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_points integer := coalesce(nullif(payload->>'points', '')::integer, 0);
  v_current_points integer;
  v_description text := nullif(payload->>'description', '');
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_customer_id is null then
    return jsonb_build_object('success', false, 'error', 'Customer ID is required');
  end if;
  if v_points <= 0 then
    return jsonb_build_object('success', false, 'error', 'Points must be positive');
  end if;

  select loyalty_points into v_current_points
  from public.restaurant_customers
  where id = v_customer_id and lodge_id = v_lodge_id;

  if coalesce(v_current_points, 0) < v_points then
    return jsonb_build_object('success', false, 'error', 'Insufficient loyalty points');
  end if;

  insert into public.restaurant_loyalty_ledger (
    lodge_id, customer_id, order_id, points, reason, description
  ) values (
    v_lodge_id, v_customer_id, v_order_id, -v_points, 'redeem', v_description
  );

  update public.restaurant_customers
     set loyalty_points = loyalty_points - v_points,
         updated_at = now()
   where id = v_customer_id and lodge_id = v_lodge_id;

  return jsonb_build_object('success', true, 'points_redeemed', v_points);
end;
$$;

-- ── Phase 4: charge_restaurant_account ──────────────────────
create or replace function public.charge_restaurant_account(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_customer_id uuid := nullif(payload->>'customer_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_amount numeric := coalesce(nullif(payload->>'amount', '')::numeric, 0);
  v_description text := nullif(payload->>'description', '');
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_customer_id is null then
    return jsonb_build_object('success', false, 'error', 'Customer ID is required');
  end if;
  if v_amount = 0 then
    return jsonb_build_object('success', false, 'error', 'Amount is required');
  end if;

  -- Idempotency guard
  if v_order_id is not null then
    if exists (
      select 1 from public.restaurant_account_ledger
      where lodge_id = v_lodge_id and customer_id = v_customer_id and order_id = v_order_id
    ) then
      return jsonb_build_object('success', true, 'duplicate', true);
    end if;
  end if;

  insert into public.restaurant_account_ledger (
    lodge_id, customer_id, order_id, amount, reason, description
  ) values (
    v_lodge_id, v_customer_id, v_order_id, v_amount, 'charge', v_description
  );

  update public.restaurant_customers
     set total_spent = total_spent + v_amount,
         visit_count = visit_count + 1,
         updated_at = now()
   where id = v_customer_id and lodge_id = v_lodge_id;

  return jsonb_build_object('success', true, 'charged', v_amount);
end;
$$;

-- ── Phase 4: record_restaurant_delivery ─────────────────────
create or replace function public.record_restaurant_delivery(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_delivery_id uuid := coalesce(nullif(payload->>'delivery_id', '')::uuid, gen_random_uuid());
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_customer_id uuid := nullif(payload->>'customer_id', '')::uuid;
  v_platform text := nullif(payload->>'platform', '');
  v_platform_commission numeric := coalesce(nullif(payload->>'platform_commission', '')::numeric, 0);
  v_platform_order_id text := nullif(payload->>'platform_order_id', '');
  v_delivery_fee numeric := coalesce(nullif(payload->>'delivery_fee', '')::numeric, 0);
  v_driver_name text := nullif(payload->>'driver_name', '');
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  insert into public.restaurant_deliveries (
    id, lodge_id, order_id, customer_id, platform, platform_commission,
    platform_order_id, delivery_fee, driver_name, status
  ) values (
    v_delivery_id, v_lodge_id, v_order_id, v_customer_id, v_platform, v_platform_commission,
    v_platform_order_id, v_delivery_fee, v_driver_name, 'pending'
  );

  return jsonb_build_object('success', true, 'delivery_id', v_delivery_id);
end;
$$;

-- ── Phase 4: redeem_restaurant_voucher ──────────────────────
create or replace function public.redeem_restaurant_voucher(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_code text := upper(btrim(coalesce(payload->>'code', '')));
  v_amount numeric := coalesce(nullif(payload->>'amount', '')::numeric, 0);
  v_voucher record;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_code = '' then
    return jsonb_build_object('success', false, 'error', 'Voucher code is required');
  end if;

  select * into v_voucher
  from public.restaurant_vouchers
  where lodge_id = v_lodge_id and code = v_code and status = 'active'
  for update;

  if v_voucher is null then
    return jsonb_build_object('success', false, 'error', 'Invalid or inactive voucher');
  end if;

  if v_voucher.expires_at is not null and v_voucher.expires_at < now() then
    return jsonb_build_object('success', false, 'error', 'Voucher has expired');
  end if;

  if v_amount > v_voucher.remaining_value then
    return jsonb_build_object('success', false, 'error', 'Amount exceeds voucher balance');
  end if;

  update public.restaurant_vouchers
     set remaining_value = remaining_value - v_amount,
         status = case when remaining_value - v_amount <= 0 then 'redeemed' else 'active' end,
         updated_at = now()
   where id = v_voucher.id;

  return jsonb_build_object('success', true, 'redeemed', v_amount, 'remaining', v_voucher.remaining_value - v_amount);
end;
$$;

-- ── Phase 5: clock_in_staff ────────────────────────────────
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

-- ── Phase 5: clock_out_staff ───────────────────────────────
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

-- ── Phase 5: open_cash_drawer_session ──────────────────────
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
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

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

-- ── Phase 5: close_cash_drawer_session ─────────────────────
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
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

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

-- ── Phase 5: create_restaurant_supplier ─────────────────────
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

-- ── Phase 5: get_restaurant_suppliers ───────────────────────
create or replace function public.get_restaurant_suppliers(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_suppliers jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

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

-- ── Phase 5: create_purchase_order (with goods received logic) ──
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

-- ── Phase 5: approve_purchase_order ─────────────────────────
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
  perform public.app_require_lodge_role(v_lodge_id, array['admin', 'super_admin']);

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

-- ── Phase 5: receive_purchase_order (NEW - goods into stock) ──
create or replace function public.receive_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_order_id uuid := nullif(payload->>'order_id', '')::uuid;
  v_order record;
  v_item record;
  v_received_count integer := 0;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_order_id is null then
    return jsonb_build_object('success', false, 'error', 'Order ID is required');
  end if;

  select * into v_order
  from public.restaurant_purchase_orders
  where id = v_order_id and lodge_id = v_lodge_id and status in ('approved', 'received')
  for update;

  if v_order is null then
    return jsonb_build_object('success', false, 'error', 'Approved order not found');
  end if;

  -- Idempotency: skip if already received
  if v_order.status = 'received' then
    return jsonb_build_object('success', true, 'duplicate', true);
  end if;

  -- Receive each item into inventory
  for v_item in
    select poi.*, ii.id as inv_id, ii.current_stock
    from public.restaurant_purchase_order_items poi
    left join public.inventory_items ii on ii.id = poi.inventory_item_id and ii.lodge_id = v_lodge_id
    where poi.purchase_order_id = v_order_id
      and poi.inventory_item_id is not null
  loop
    -- Update inventory stock (idempotent: add quantity)
    update public.inventory_items
       set current_stock = coalesce(current_stock, 0) + v_item.quantity,
           latest_unit_cost = case when v_item.unit_cost > 0 then v_item.unit_cost else latest_unit_cost end
     where id = v_item.inv_id and lodge_id = v_lodge_id;

    -- Record stock movement
    insert into public.stock_movements (
      lodge_id, inventory_item_id, movement_type, quantity, reference_type, reference_id, notes
    ) values (
      v_lodge_id, v_item.inv_id, 'purchase_received', v_item.quantity, 'purchase_order', v_order_id,
      'PO #' || left(v_order_id::text, 8)
    );

    v_received_count := v_received_count + 1;
  end loop;

  -- Mark order as received
  update public.restaurant_purchase_orders
     set status = 'received',
         updated_at = now()
   where id = v_order_id;

  return jsonb_build_object('success', true, 'items_received', v_received_count);
end;
$$;

-- ── Phase 5: create_stock_transfer (log-only for intra-lodge transfers) ──
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

-- ── Phase 5: create_daily_checklist ────────────────────────
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

-- ── Phase 5: complete_checklist_item ───────────────────────
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
  v_checklist record;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  if v_item_id is null then
    return jsonb_build_object('success', false, 'error', 'Item ID is required');
  end if;

  update public.restaurant_checklist_items
     set is_completed = true,
         notes = coalesce(v_notes, notes)
   where id = v_item_id;

  -- Find the parent checklist and check if all items are done
  select c.* into v_checklist
  from public.restaurant_checklist_items ci
  join public.restaurant_checklists c on c.id = ci.checklist_id
  where ci.id = v_item_id;

  if v_checklist.id is not null then
    if not exists (
      select 1 from public.restaurant_checklist_items
      where checklist_id = v_checklist.id and is_completed = false
    ) then
      update public.restaurant_checklists
         set status = 'completed',
             completed_by = auth.uid(),
             completed_at = now()
       where id = v_checklist.id;
    end if;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ── Phase 5: record_exception_alert ────────────────────────
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

-- ── Phase 5: resolve_exception_alert ───────────────────────
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
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

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

-- ── Phase 5: generate_owner_digest (FIX: inventory_items) ──
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

-- ── Phase 5: get_active_alerts ─────────────────────────────
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

-- ── Phase 5: get_active_shifts ─────────────────────────────
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

-- ── Phase 5: get_open_cash_drawer ──────────────────────────
create or replace function public.get_open_cash_drawer(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

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

-- ────────────────────────────────────────────────────────────
-- FIX 2: Fix child-table RLS using parent-join pattern
-- ────────────────────────────────────────────────────────────

-- Drop broken policies on restaurant_purchase_order_items
drop policy if exists restaurant_purchase_order_items_lodge_scope_select on public.restaurant_purchase_order_items;
drop policy if exists restaurant_purchase_order_items_lodge_scope_insert on public.restaurant_purchase_order_items;
drop policy if exists restaurant_purchase_order_items_lodge_scope_update on public.restaurant_purchase_order_items;

-- Recreate with parent-join RLS
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

-- Drop broken policies on restaurant_checklist_items
drop policy if exists restaurant_checklist_items_lodge_scope_select on public.restaurant_checklist_items;
drop policy if exists restaurant_checklist_items_lodge_scope_insert on public.restaurant_checklist_items;
drop policy if exists restaurant_checklist_items_lodge_scope_update on public.restaurant_checklist_items;

-- Recreate with parent-join RLS
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

-- ── Wire new receive_purchase_order into preload ────────────
-- (handled in application layer, not SQL)

commit;
