begin;

-- Restaurant Chart of Accounts
create table if not exists public.restaurant_accounts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid references public.restaurant_accounts(id) on delete set null,
  is_active boolean not null default true,
  opening_balance numeric(15,2) not null default 0,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lodge_id, code)
);

-- RLS
alter table public.restaurant_accounts enable row level security;

create policy restaurant_accounts_lodge_scope_select on public.restaurant_accounts
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_accounts_lodge_scope_insert on public.restaurant_accounts
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_accounts_lodge_scope_update on public.restaurant_accounts
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_accounts_lodge_scope_delete on public.restaurant_accounts
  for delete using (public.app_lodge_access(lodge_id));

-- Indexes
create index if not exists restaurant_accounts_lodge_idx on public.restaurant_accounts(lodge_id);
create index if not exists restaurant_accounts_type_idx on public.restaurant_accounts(lodge_id, account_type);

-- ── get_restaurant_accounts ────────────────────────────────────
create or replace function public.get_restaurant_accounts(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  return jsonb_build_object(
    'success', true,
    'data', (
      select coalesce(jsonb_agg(row_to_json(a) order by a.code), '[]'::jsonb)
      from public.restaurant_accounts a
      where a.lodge_id = p_lodge_id
    )
  );
end;
$$;

-- ── create_restaurant_account ──────────────────────────────────
create or replace function public.create_restaurant_account(
  p_lodge_id uuid,
  p_code text,
  p_name text,
  p_account_type text,
  p_parent_id uuid default null,
  p_opening_balance numeric default 0,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_new_id uuid;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  if p_account_type not in ('asset', 'liability', 'equity', 'revenue', 'expense') then
    return jsonb_build_object('success', false, 'error', 'Invalid account type');
  end if;

  insert into public.restaurant_accounts (lodge_id, code, name, account_type, parent_id, opening_balance, description)
  values (p_lodge_id, p_code, p_name, p_account_type, p_parent_id, p_opening_balance, p_description)
  returning id into v_new_id;

  return jsonb_build_object('success', true, 'id', v_new_id);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error', 'Account code already exists for this lodge');
  when foreign_key_violation then
    return jsonb_build_object('success', false, 'error', 'Invalid parent account');
end;
$$;

-- ── update_restaurant_account ──────────────────────────────────
create or replace function public.update_restaurant_account(
  p_id uuid,
  p_lodge_id uuid,
  p_name text default null,
  p_description text default null,
  p_is_active boolean default null,
  p_opening_balance numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  update public.restaurant_accounts
  set
    name = coalesce(p_name, name),
    description = coalesce(p_description, description),
    is_active = coalesce(p_is_active, is_active),
    opening_balance = coalesce(p_opening_balance, opening_balance),
    updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Account not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ── delete_restaurant_account (soft-delete) ────────────────────
create or replace function public.delete_restaurant_account(
  p_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_has_entries boolean;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select exists(
    select 1 from public.restaurant_journal_lines jl
    join public.restaurant_journal_entries je on je.id = jl.entry_id
    where je.lodge_id = p_lodge_id
      and jl.account_id = p_id
  ) into v_has_entries;

  if v_has_entries then
    return jsonb_build_object('success', false, 'error', 'Cannot delete account with existing journal entries. Deactivate it instead.');
  end if;

  update public.restaurant_accounts
  set is_active = false, updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Account not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ── seed_restaurant_default_accounts ───────────────────────────
create or replace function public.seed_restaurant_default_accounts(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_existing_count integer;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select count(*) into v_existing_count
  from public.restaurant_accounts
  where lodge_id = p_lodge_id;

  if v_existing_count > 0 then
    return jsonb_build_object('success', false, 'error', 'Accounts already exist for this lodge');
  end if;

  insert into public.restaurant_accounts (lodge_id, code, name, account_type) values
    -- Assets
    (p_lodge_id, '1000', 'Cash on Hand', 'asset'),
    (p_lodge_id, '1010', 'Petty Cash', 'asset'),
    (p_lodge_id, '1020', 'Bank Account - Operating', 'asset'),
    (p_lodge_id, '1030', 'Bank Account - Savings', 'asset'),
    (p_lodge_id, '1100', 'Accounts Receivable', 'asset'),
    (p_lodge_id, '1200', 'Inventory - Food', 'asset'),
    (p_lodge_id, '1210', 'Inventory - Beverages', 'asset'),
    (p_lodge_id, '1220', 'Inventory - Packaging & Disposables', 'asset'),
    (p_lodge_id, '1300', 'Prepaid Expenses', 'asset'),
    (p_lodge_id, '1500', 'Fixed Assets - Equipment', 'asset'),
    (p_lodge_id, '1510', 'Fixed Assets - Furniture & Fixtures', 'asset'),
    (p_lodge_id, '1520', 'Fixed Assets - Kitchen Equipment', 'asset'),
    (p_lodge_id, '1600', 'Accumulated Depreciation', 'asset'),
    -- Liabilities
    (p_lodge_id, '2000', 'Accounts Payable', 'liability'),
    (p_lodge_id, '2100', 'VAT/GST Payable', 'liability'),
    (p_lodge_id, '2200', 'PAYE Payable', 'liability'),
    (p_lodge_id, '2300', 'Staff Provident Fund Payable', 'liability'),
    (p_lodge_id, '2400', 'Tips Payable', 'liability'),
    (p_lodge_id, '2500', 'Unearned Revenue (Deposits)', 'liability'),
    -- Equity
    (p_lodge_id, '3000', 'Owner''s Equity', 'equity'),
    (p_lodge_id, '3100', 'Retained Earnings', 'equity'),
    -- Revenue
    (p_lodge_id, '4000', 'Sales Revenue - Food', 'revenue'),
    (p_lodge_id, '4100', 'Sales Revenue - Beverages', 'revenue'),
    (p_lodge_id, '4200', 'Sales Revenue - Other', 'revenue'),
    (p_lodge_id, '4300', 'Delivery Revenue', 'revenue'),
    (p_lodge_id, '4400', 'Service Charge Revenue', 'revenue'),
    -- Expenses
    (p_lodge_id, '5000', 'Cost of Goods Sold - Food', 'expense'),
    (p_lodge_id, '5100', 'Cost of Goods Sold - Beverages', 'expense'),
    (p_lodge_id, '5200', 'Cost of Goods Sold - Packaging', 'expense'),
    (p_lodge_id, '6000', 'Staff Wages & Salaries', 'expense'),
    (p_lodge_id, '6100', 'Staff Benefits', 'expense'),
    (p_lodge_id, '6200', 'PAYE Expense', 'expense'),
    (p_lodge_id, '7000', 'Rent', 'expense'),
    (p_lodge_id, '7100', 'Utilities (Electricity, Water, Internet)', 'expense'),
    (p_lodge_id, '7200', 'Insurance', 'expense'),
    (p_lodge_id, '7300', 'Marketing & Advertising', 'expense'),
    (p_lodge_id, '7400', 'Repairs & Maintenance', 'expense'),
    (p_lodge_id, '7500', 'Cleaning & Supplies', 'expense'),
    (p_lodge_id, '7600', 'Kitchen Supplies & Disposables', 'expense'),
    (p_lodge_id, '7700', 'Delivery Platform Fees', 'expense'),
    (p_lodge_id, '7800', 'Bank Charges & Fees', 'expense'),
    (p_lodge_id, '7900', 'Depreciation Expense', 'expense'),
    (p_lodge_id, '8000', 'Miscellaneous Expense', 'expense');

  return jsonb_build_object('success', true, 'count', 42);
end;
$$;

commit;
