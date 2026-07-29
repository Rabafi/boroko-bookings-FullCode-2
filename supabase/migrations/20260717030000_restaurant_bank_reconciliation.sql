begin;

-- ============================================================
-- Restaurant Bank Reconciliation
-- Gated to restaurant-bar only; does not touch hotel/lodge
-- ============================================================

-- ── restaurant_bank_accounts ──────────────────────────────────
create table if not exists public.restaurant_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
  name text not null,
  bank_name text,
  account_number text,
  account_type text not null default 'checking',
  opening_balance numeric(15,2) not null default 0,
  current_balance numeric(15,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_bank_accounts enable row level security;

create policy restaurant_bank_accounts_lodge_scope_select on public.restaurant_bank_accounts
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_bank_accounts_lodge_scope_insert on public.restaurant_bank_accounts
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_bank_accounts_lodge_scope_update on public.restaurant_bank_accounts
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_bank_accounts_lodge_scope_delete on public.restaurant_bank_accounts
  for delete using (public.app_lodge_access(lodge_id));

create index if not exists restaurant_bank_accounts_lodge_idx on public.restaurant_bank_accounts(lodge_id);

-- ── restaurant_bank_transactions ──────────────────────────────
create table if not exists public.restaurant_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  bank_account_id uuid not null references public.restaurant_bank_accounts(id) on delete cascade,
  transaction_date date not null,
  description text not null,
  debit numeric(15,2) not null default 0,
  credit numeric(15,2) not null default 0,
  balance_after numeric(15,2),
  reference_number text,
  category text,
  is_reconciled boolean not null default false,
  reconciled_entry_id uuid,
  imported_at timestamptz not null default now()
);

alter table public.restaurant_bank_transactions enable row level security;

create policy restaurant_bank_transactions_lodge_scope_select on public.restaurant_bank_transactions
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_bank_transactions_lodge_scope_insert on public.restaurant_bank_transactions
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_bank_transactions_lodge_scope_update on public.restaurant_bank_transactions
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_bank_transactions_lodge_scope_delete on public.restaurant_bank_transactions
  for delete using (public.app_lodge_access(lodge_id));

create index if not exists restaurant_bank_transactions_lodge_idx on public.restaurant_bank_transactions(lodge_id, bank_account_id);
create index if not exists restaurant_bank_transactions_date_idx on public.restaurant_bank_transactions(lodge_id, transaction_date);
create index if not exists restaurant_bank_transactions_reconciled_idx on public.restaurant_bank_transactions(lodge_id, bank_account_id, is_reconciled);

-- ── restaurant_bank_reconciliations ───────────────────────────
create table if not exists public.restaurant_bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  bank_account_id uuid not null references public.restaurant_bank_accounts(id) on delete cascade,
  reconciliation_date date not null,
  statement_balance numeric(15,2) not null,
  book_balance numeric(15,2) not null,
  difference numeric(15,2) not null,
  status text not null default 'draft',
  notes text,
  reconciled_by uuid references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.restaurant_bank_reconciliations enable row level security;

create policy restaurant_bank_reconciliations_lodge_scope_select on public.restaurant_bank_reconciliations
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_bank_reconciliations_lodge_scope_insert on public.restaurant_bank_reconciliations
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_bank_reconciliations_lodge_scope_update on public.restaurant_bank_reconciliations
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_bank_reconciliations_lodge_scope_delete on public.restaurant_bank_reconciliations
  for delete using (public.app_lodge_access(lodge_id));

create index if not exists restaurant_bank_reconciliations_lodge_idx on public.restaurant_bank_reconciliations(lodge_id, bank_account_id);

-- ── get_restaurant_bank_accounts ──────────────────────────────
create or replace function public.get_restaurant_bank_accounts(p_lodge_id uuid)
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
      select coalesce(jsonb_agg(row_to_json(a) order by a.created_at), '[]'::jsonb)
      from public.restaurant_bank_accounts a
      where a.lodge_id = p_lodge_id
    )
  );
end;
$$;

-- ── create_restaurant_bank_account ────────────────────────────
create or replace function public.create_restaurant_bank_account(
  p_lodge_id uuid,
  p_name text,
  p_account_id uuid,
  p_bank_name text,
  p_account_number text,
  p_account_type text default 'checking',
  p_opening_balance numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_id uuid;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  if p_name is null or trim(p_name) = '' then
    return jsonb_build_object('success', false, 'error', 'Account name is required');
  end if;

  if p_account_id is null then
    return jsonb_build_object('success', false, 'error', 'GL account is required');
  end if;

  if not exists (
    select 1 from public.restaurant_accounts
    where id = p_account_id and lodge_id = p_lodge_id and is_active = true
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid GL account for this lodge');
  end if;

  insert into public.restaurant_bank_accounts (
    lodge_id, account_id, name, bank_name, account_number, account_type, opening_balance, current_balance
  ) values (
    p_lodge_id, p_account_id, trim(p_name), nullif(trim(p_bank_name), ''), nullif(trim(p_account_number), ''),
    p_account_type, p_opening_balance, p_opening_balance
  ) returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

-- ── update_restaurant_bank_account ────────────────────────────
create or replace function public.update_restaurant_bank_account(
  p_id uuid,
  p_lodge_id uuid,
  p_name text,
  p_bank_name text,
  p_account_number text,
  p_is_active boolean
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

  update public.restaurant_bank_accounts
  set name = p_name,
      bank_name = nullif(trim(p_bank_name), ''),
      account_number = nullif(trim(p_account_number), ''),
      is_active = p_is_active,
      updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Bank account not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ── import_bank_statement ─────────────────────────────────────
create or replace function public.import_bank_statement(
  p_lodge_id uuid,
  p_bank_account_id uuid,
  p_transactions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_count integer;
  v_txn jsonb;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  -- verify bank account exists
  if not exists (
    select 1 from public.restaurant_bank_accounts
    where id = p_bank_account_id and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Bank account not found');
  end if;

  if p_transactions is null or jsonb_array_length(p_transactions) = 0 then
    return jsonb_build_object('success', false, 'error', 'No transactions provided');
  end if;

  v_count := 0;

  for v_txn in select jsonb_array_elements(p_transactions)
  loop
    insert into public.restaurant_bank_transactions (
      lodge_id, bank_account_id, transaction_date, description, debit, credit,
      balance_after, reference_number, category
    ) values (
      p_lodge_id,
      p_bank_account_id,
      (v_txn ->> 'transaction_date')::date,
      v_txn ->> 'description',
      coalesce((v_txn ->> 'debit')::numeric, 0),
      coalesce((v_txn ->> 'credit')::numeric, 0),
      nullif((v_txn ->> 'balance_after'), '')::numeric,
      nullif(v_txn ->> 'reference_number', ''),
      nullif(v_txn ->> 'category', '')
    );

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'imported', v_count);
end;
$$;

-- ── get_bank_transactions ─────────────────────────────────────
create or replace function public.get_bank_transactions(
  p_lodge_id uuid,
  p_bank_account_id uuid,
  p_start_date date default null,
  p_end_date date default null,
  p_unreconciled boolean default false
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

  return jsonb_build_object(
    'success', true,
    'data', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.transaction_date desc, t.id), '[]'::jsonb)
      from public.restaurant_bank_transactions t
      where t.lodge_id = p_lodge_id
        and t.bank_account_id = p_bank_account_id
        and (p_start_date is null or t.transaction_date >= p_start_date)
        and (p_end_date is null or t.transaction_date <= p_end_date)
        and (not p_unreconciled or t.is_reconciled = false)
    )
  );
end;
$$;

-- ── auto_match_transactions ───────────────────────────────────
create or replace function public.auto_match_transactions(
  p_lodge_id uuid,
  p_bank_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_match_count integer;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  -- Match unreconciled bank transactions to journal entries by amount
  -- and date within 3 calendar days. Matches bank-side lines of journal entries
  -- (where the journal line account is the bank account being reconciled).
  with matched as (
    update public.restaurant_bank_transactions bt
    set is_reconciled = true,
        reconciled_entry_id = je.id
    from public.restaurant_journal_entries je
    join public.restaurant_journal_lines jl on jl.entry_id = je.id
    join public.restaurant_bank_accounts ba on ba.id = bt.bank_account_id
    join public.restaurant_accounts ra on ra.id = ba.account_id
    where bt.lodge_id = p_lodge_id
      and bt.bank_account_id = p_bank_account_id
      and bt.is_reconciled = false
      and je.lodge_id = p_lodge_id
      and jl.account_id = ra.id
      and bt.transaction_date between (je.entry_date - interval '3 days') and (je.entry_date + interval '3 days')
      and (
        (bt.debit > 0 and jl.credit = bt.debit and jl.debit = 0)
        or
        (bt.credit > 0 and jl.debit = bt.credit and jl.credit = 0)
      )
    returning bt.id
  )
  select count(*) into v_match_count from matched;

  return jsonb_build_object('success', true, 'matched', v_match_count);
end;
$$;

-- ── create_bank_reconciliation ────────────────────────────────
create or replace function public.create_bank_reconciliation(
  p_lodge_id uuid,
  p_bank_account_id uuid,
  p_statement_balance numeric,
  p_reconciliation_date date,
  p_transaction_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_reconciliation_id uuid;
  v_book_balance numeric(15,2);
  v_difference numeric(15,2);
  v_total_debit numeric(15,2);
  v_total_credit numeric(15,2);
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  -- verify bank account exists
  if not exists (
    select 1 from public.restaurant_bank_accounts
    where id = p_bank_account_id and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Bank account not found');
  end if;

  if p_statement_balance is null then
    return jsonb_build_object('success', false, 'error', 'Statement balance is required');
  end if;

  -- compute book balance from opening balance + selected transactions
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0)
  into v_total_debit, v_total_credit
  from public.restaurant_bank_transactions
  where lodge_id = p_lodge_id
    and bank_account_id = p_bank_account_id
    and id = any(p_transaction_ids);

  select opening_balance into v_book_balance
  from public.restaurant_bank_accounts
  where id = p_bank_account_id;

  v_book_balance := coalesce(v_book_balance, 0) + v_total_debit - v_total_credit;
  v_difference := p_statement_balance - v_book_balance;

  -- create reconciliation record
  insert into public.restaurant_bank_reconciliations (
    lodge_id, bank_account_id, reconciliation_date, statement_balance,
    book_balance, difference, reconciled_by, status
  ) values (
    p_lodge_id, p_bank_account_id, p_reconciliation_date,
    p_statement_balance, v_book_balance, v_difference,
    v_actor_id, 'draft'
  ) returning id into v_reconciliation_id;

  -- mark selected transactions as reconciled
  update public.restaurant_bank_transactions
  set is_reconciled = true
  where lodge_id = p_lodge_id
    and bank_account_id = p_bank_account_id
    and id = any(p_transaction_ids);

  return jsonb_build_object(
    'success', true,
    'id', v_reconciliation_id,
    'book_balance', v_book_balance,
    'difference', v_difference
  );
end;
$$;

-- ── complete_bank_reconciliation ──────────────────────────────
create or replace function public.complete_bank_reconciliation(
  p_id uuid,
  p_lodge_id uuid,
  p_notes text default null
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

  update public.restaurant_bank_reconciliations
  set status = 'completed',
      notes = p_notes,
      completed_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Reconciliation not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- ── get_bank_reconciliations ──────────────────────────────────
create or replace function public.get_bank_reconciliations(
  p_lodge_id uuid,
  p_bank_account_id uuid
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

  return jsonb_build_object(
    'success', true,
    'data', (
      select coalesce(jsonb_agg(row_to_json(r) order by r.created_at desc), '[]'::jsonb)
      from public.restaurant_bank_reconciliations r
      where r.lodge_id = p_lodge_id
        and r.bank_account_id = p_bank_account_id
    )
  );
end;
$$;

commit;
