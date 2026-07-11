begin;

-- ============================================================
-- Phase 4: Customer and Growth Features
-- Loyalty, Customer Accounts, Delivery, Multi-Outlet
-- ============================================================

-- ── Restaurant Customers ──────────────────────────────────────
create table if not exists public.restaurant_customers (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  name text not null,
  email text,
  phone text,
  loyalty_points integer not null default 0,
  total_spent numeric not null default 0,
  visit_count integer not null default 0,
  notes text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_customers enable row level security;

create policy restaurant_customers_lodge_scope_select on public.restaurant_customers
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_customers_lodge_scope_insert on public.restaurant_customers
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_customers_lodge_scope_update on public.restaurant_customers
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_customers_lodge_scope_delete on public.restaurant_customers
  for delete using (public.app_lodge_access(lodge_id));

-- ── Customer Loyalty Ledger ───────────────────────────────────
create table if not exists public.restaurant_loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  customer_id uuid not null references public.restaurant_customers(id) on delete cascade,
  order_id uuid,
  points integer not null,
  reason text not null default 'earn',
  description text,
  created_at timestamptz not null default now()
);

alter table public.restaurant_loyalty_ledger enable row level security;

create policy restaurant_loyalty_ledger_lodge_scope_select on public.restaurant_loyalty_ledger
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_loyalty_ledger_lodge_scope_insert on public.restaurant_loyalty_ledger
  for insert with check (public.app_lodge_access(lodge_id));

-- Unique guard: prevent duplicate loyalty entries for same order
create unique index if not exists restaurant_loyalty_ledger_dedup_idx
  on public.restaurant_loyalty_ledger (lodge_id, customer_id, order_id)
  where order_id is not null;

-- ── Customer Account Ledger (tabs/credit) ─────────────────────
create table if not exists public.restaurant_account_ledger (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  customer_id uuid not null references public.restaurant_customers(id) on delete cascade,
  order_id uuid,
  amount numeric not null,
  reason text not null default 'charge',
  description text,
  created_at timestamptz not null default now()
);

alter table public.restaurant_account_ledger enable row level security;

create policy restaurant_account_ledger_lodge_scope_select on public.restaurant_account_ledger
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_account_ledger_lodge_scope_insert on public.restaurant_account_ledger
  for insert with check (public.app_lodge_access(lodge_id));

-- Unique guard: prevent duplicate account entries for same order
create unique index if not exists restaurant_account_ledger_dedup_idx
  on public.restaurant_account_ledger (lodge_id, customer_id, order_id)
  where order_id is not null;

-- ── Delivery Orders ───────────────────────────────────────────
create table if not exists public.restaurant_deliveries (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  order_id uuid,
  customer_id uuid references public.restaurant_customers(id) on delete set null,
  platform text,
  platform_commission numeric not null default 0,
  platform_order_id text,
  delivery_fee numeric not null default 0,
  driver_name text,
  status text not null default 'pending',
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_deliveries enable row level security;

create policy restaurant_deliveries_lodge_scope_select on public.restaurant_deliveries
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_deliveries_lodge_scope_insert on public.restaurant_deliveries
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_deliveries_lodge_scope_update on public.restaurant_deliveries
  for update using (public.app_lodge_access(lodge_id));

-- ── Vouchers / Gift Cards ─────────────────────────────────────
create table if not exists public.restaurant_vouchers (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  code text not null,
  initial_value numeric not null,
  remaining_value numeric not null,
  customer_id uuid references public.restaurant_customers(id) on delete set null,
  expires_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_vouchers enable row level security;

create policy restaurant_vouchers_lodge_scope_select on public.restaurant_vouchers
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_vouchers_lodge_scope_insert on public.restaurant_vouchers
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_vouchers_lodge_scope_update on public.restaurant_vouchers
  for update using (public.app_lodge_access(lodge_id));

create unique index if not exists restaurant_vouchers_code_lodge_idx
  on public.restaurant_vouchers (lodge_id, code)
  where status = 'active';

-- ── Central Menu Publishing ───────────────────────────────────
create table if not exists public.restaurant_menu_publish_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  source_outlet_id uuid,
  target_outlet_ids uuid[] not null default '{}',
  items_published integer not null default 0,
  published_by uuid,
  published_at timestamptz not null default now()
);

alter table public.restaurant_menu_publish_log enable row level security;

create policy restaurant_menu_publish_log_lodge_scope_select on public.restaurant_menu_publish_log
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_menu_publish_log_lodge_scope_insert on public.restaurant_menu_publish_log
  for insert with check (public.app_lodge_access(lodge_id));

-- ============================================================
-- RPC: Create or update a customer
-- ============================================================
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

revoke all on function public.upsert_restaurant_customer(jsonb) from public;
grant execute on function public.upsert_restaurant_customer(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Get customers for a lodge
-- ============================================================
create or replace function public.get_restaurant_customers(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customers jsonb;
begin
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

revoke all on function public.get_restaurant_customers(uuid) from public;
grant execute on function public.get_restaurant_customers(uuid)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Award loyalty points for an order
-- ============================================================
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

revoke all on function public.award_restaurant_loyalty(jsonb) from public;
grant execute on function public.award_restaurant_loyalty(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Redeem loyalty points
-- ============================================================
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

revoke all on function public.redeem_restaurant_loyalty(jsonb) from public;
grant execute on function public.redeem_restaurant_loyalty(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Charge to customer account (tab/credit)
-- ============================================================
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

revoke all on function public.charge_restaurant_account(jsonb) from public;
grant execute on function public.charge_restaurant_account(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Record a delivery
-- ============================================================
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

revoke all on function public.record_restaurant_delivery(jsonb) from public;
grant execute on function public.record_restaurant_delivery(jsonb)
  to anon, authenticated, service_role;

-- ============================================================
-- RPC: Redeem a voucher
-- ============================================================
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

revoke all on function public.redeem_restaurant_voucher(jsonb) from public;
grant execute on function public.redeem_restaurant_voucher(jsonb)
  to anon, authenticated, service_role;

commit;
