begin;

-- ============================================================
-- Restaurant General Ledger / Double-Entry Bookkeeping
-- Restaurant-bar only, no hotel/lodge impact
-- ============================================================

-- ── Journal Entries ───────────────────────────────────────────
create table if not exists public.restaurant_journal_entries (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  entry_date date not null,
  description text not null,
  source_type text not null,
  source_id uuid,
  reference_number text,
  is_posted boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.restaurant_journal_entries enable row level security;

create policy restaurant_journal_entries_lodge_scope_select on public.restaurant_journal_entries
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_journal_entries_lodge_scope_insert on public.restaurant_journal_entries
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_journal_entries_lodge_scope_update on public.restaurant_journal_entries
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_journal_entries_lodge_scope_delete on public.restaurant_journal_entries
  for delete using (public.app_lodge_access(lodge_id));

-- ── Journal Lines ─────────────────────────────────────────────
create table if not exists public.restaurant_journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.restaurant_journal_entries(id) on delete cascade,
  account_id uuid not null references public.restaurant_accounts(id) on delete restrict,
  debit numeric(15,2) not null default 0 check (debit >= 0),
  credit numeric(15,2) not null default 0 check (credit >= 0),
  memo text,
  check (debit > 0 or credit > 0)
);

alter table public.restaurant_journal_lines enable row level security;

create policy restaurant_journal_lines_lodge_scope_select on public.restaurant_journal_lines
  for select using (exists (
    select 1 from public.restaurant_journal_entries e
    where e.id = entry_id and public.app_lodge_access(e.lodge_id)
  ));

create policy restaurant_journal_lines_lodge_scope_insert on public.restaurant_journal_lines
  for insert with check (exists (
    select 1 from public.restaurant_journal_entries e
    where e.id = entry_id and public.app_lodge_access(e.lodge_id)
  ));

create policy restaurant_journal_lines_lodge_scope_delete on public.restaurant_journal_lines
  for delete using (exists (
    select 1 from public.restaurant_journal_entries e
    where e.id = entry_id and public.app_lodge_access(e.lodge_id)
  ));

-- ── Unique constraint: prevent duplicate GL posting ───────────
create unique index if not exists restaurant_journal_entries_source_dedup_idx
  on public.restaurant_journal_entries (lodge_id, source_type, source_id)
  where source_id is not null;

-- ── Indexes ───────────────────────────────────────────────────
create index if not exists restaurant_journal_entries_lodge_date_idx
  on public.restaurant_journal_entries(lodge_id, entry_date);
create index if not exists restaurant_journal_entries_source_idx
  on public.restaurant_journal_entries(lodge_id, source_type);
create index if not exists restaurant_journal_lines_entry_idx
  on public.restaurant_journal_lines(entry_id);
create index if not exists restaurant_journal_lines_account_idx
  on public.restaurant_journal_lines(account_id);

-- ══════════════════════════════════════════════════════════════
-- RPC FUNCTIONS
-- ══════════════════════════════════════════════════════════════

-- ── 1. create_restaurant_journal_entry ────────────────────────
create or replace function public.create_restaurant_journal_entry(
  p_lodge_id uuid,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id uuid default null,
  p_reference_number text default null,
  p_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line jsonb;
  v_actor_id uuid;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  if p_description is null or p_description = '' then
    return jsonb_build_object('success', false, 'error', 'Description is required');
  end if;

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('success', false, 'error', 'At least one journal line is required');
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
  end loop;

  if v_total_debit <> v_total_credit then
    return jsonb_build_object('success', false, 'error', 'Debit total (' || v_total_debit || ') must equal credit total (' || v_total_credit || ')');
  end if;

  if v_total_debit = 0 then
    return jsonb_build_object('success', false, 'error', 'Debit/credit totals cannot be zero');
  end if;

  insert into public.restaurant_journal_entries (
    lodge_id, entry_date, description, source_type, source_id, reference_number, created_by
  ) values (
    p_lodge_id, p_entry_date, p_description, p_source_type, p_source_id, p_reference_number, v_actor_id
  ) returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into public.restaurant_journal_lines (
      entry_id, account_id, debit, credit, memo
    ) values (
      v_entry_id,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'memo'
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object('entry_id', v_entry_id, 'total_debit', v_total_debit, 'total_credit', v_total_credit)
  );
end;
$$;

-- ── 2. get_restaurant_journal_entries ──────────────────────────
create or replace function public.get_restaurant_journal_entries(
  p_lodge_id uuid,
  p_start_date date default null,
  p_end_date date default null,
  p_source_type text default null,
  p_account_id uuid default null,
  p_limit integer default 100
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
      select coalesce(jsonb_agg(ej order by ej.entry_date desc, ej.created_at desc), '[]'::jsonb)
      from (
        select
          je.*,
          (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', jl.id,
              'account_id', jl.account_id,
              'debit', jl.debit,
              'credit', jl.credit,
              'memo', jl.memo,
              'account_code', a.code,
              'account_name', a.name
            ) order by jl.debit desc, jl.credit desc), '[]'::jsonb)
          ) as lines,
          (select coalesce(sum(jl2.debit), 0) from public.restaurant_journal_lines jl2 where jl2.entry_id = je.id) as total_debit,
          (select coalesce(sum(jl2.credit), 0) from public.restaurant_journal_lines jl2 where jl2.entry_id = je.id) as total_credit
        from public.restaurant_journal_entries je
        left join public.restaurant_journal_lines jl on jl.entry_id = je.id
        left join public.restaurant_accounts a on a.id = jl.account_id
        where je.lodge_id = p_lodge_id
          and (p_start_date is null or je.entry_date >= p_start_date)
          and (p_end_date is null or je.entry_date <= p_end_date)
          and (p_source_type is null or je.source_type = p_source_type)
          and (p_account_id is null or exists (
            select 1 from public.restaurant_journal_lines jl3
            where jl3.entry_id = je.id and jl3.account_id = p_account_id
          ))
        group by je.id
        order by je.entry_date desc, je.created_at desc
        limit p_limit
      ) ej
    )
  );
end;
$$;

-- ── 3. get_restaurant_general_ledger ──────────────────────────
create or replace function public.get_restaurant_general_ledger(
  p_lodge_id uuid,
  p_account_id uuid,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_account record;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select * into v_account from public.restaurant_accounts
  where id = p_account_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Account not found');
  end if;

  return jsonb_build_object(
    'success', true,
    'data', (
      select jsonb_build_object(
        'account', to_jsonb(v_account),
        'opening_balance', v_account.opening_balance,
        'lines', coalesce((
          select jsonb_agg(row_to_json(lines_cte) order by lines_cte.entry_date, lines_cte.line_id)
          from (
            select
              jl.id as line_id,
              je.entry_date,
              je.description as entry_description,
              je.source_type,
              je.reference_number,
              jl.debit,
              jl.credit,
              jl.memo,
              sum(jl.debit - jl.credit) over (
                order by je.entry_date, je.id, jl.id
              ) + v_account.opening_balance as running_balance
            from public.restaurant_journal_lines jl
            join public.restaurant_journal_entries je on je.id = jl.entry_id
            where jl.account_id = p_account_id
              and je.lodge_id = p_lodge_id
              and (p_start_date is null or je.entry_date >= p_start_date)
              and (p_end_date is null or je.entry_date <= p_end_date)
          ) lines_cte
        ), '[]'::jsonb)
      )
    )
  );
end;
$$;

-- ── 4. get_restaurant_trial_balance ───────────────────────────
create or replace function public.get_restaurant_trial_balance(
  p_lodge_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select
    coalesce(sum(case when totals.net >= 0 then totals.net else 0 end), 0),
    coalesce(sum(case when totals.net < 0 then -totals.net else 0 end), 0)
  into v_total_debit, v_total_credit
  from (
    select
      a.id,
      a.code,
      a.name,
      a.account_type,
      a.opening_balance,
      coalesce((
        select sum(jl.debit) - sum(jl.credit)
        from public.restaurant_journal_lines jl
        join public.restaurant_journal_entries je on je.id = jl.entry_id
        where jl.account_id = a.id
          and je.lodge_id = p_lodge_id
          and (p_as_of_date is null or je.entry_date <= p_as_of_date)
      ), 0) + a.opening_balance as net
    from public.restaurant_accounts a
    where a.lodge_id = p_lodge_id
      and a.is_active = true
  ) totals;

  return jsonb_build_object(
    'success', true,
    'data', (
      select jsonb_build_object(
        'total_debit', v_total_debit,
        'total_credit', v_total_credit,
        'is_balanced', v_total_debit = v_total_credit,
        'accounts', coalesce(jsonb_agg(jsonb_build_object(
          'id', t.id,
          'code', t.code,
          'name', t.name,
          'account_type', t.account_type,
          'debit', case when t.net >= 0 then t.net else 0 end,
          'credit', case when t.net < 0 then -t.net else 0 end,
          'balance', t.net
        ) order by t.code), '[]'::jsonb)
      )
      from (
        select
          a.id,
          a.code,
          a.name,
          a.account_type,
          a.opening_balance,
          coalesce((
            select sum(jl.debit) - sum(jl.credit)
            from public.restaurant_journal_lines jl
            join public.restaurant_journal_entries je on je.id = jl.entry_id
            where jl.account_id = a.id
              and je.lodge_id = p_lodge_id
              and (p_as_of_date is null or je.entry_date <= p_as_of_date)
          ), 0) + a.opening_balance as net
        from public.restaurant_accounts a
        where a.lodge_id = p_lodge_id
          and a.is_active = true
      ) t
    )
  );
end;
$$;

-- ── 5. post_pos_sales_to_gl ──────────────────────────────────
create or replace function public.post_pos_sales_to_gl(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_day record;
  v_entry_id uuid;
  v_entries_posted integer := 0;
  v_account_bank uuid;
  v_account_cash uuid;
  v_account_revenue_food uuid;
  v_account_revenue_beverage uuid;
  v_account_vat uuid;
  v_total_cash numeric;
  v_total_card numeric;
  v_total_mobile numeric;
  v_total_revenue numeric;
  v_total_tax numeric;
  v_total_discount numeric;
  v_lines jsonb;
  v_line jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select id into v_account_bank from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '1020' and is_active = true limit 1;
  select id into v_account_cash from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '1000' and is_active = true limit 1;
  select id into v_account_revenue_food from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '4000' and is_active = true limit 1;
  select id into v_account_revenue_beverage from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '4100' and is_active = true limit 1;
  select id into v_account_vat from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '2100' and is_active = true limit 1;

  if v_account_revenue_food is null then
    return jsonb_build_object('success', false, 'error', 'Revenue account (4000) not found. Seed chart of accounts first.');
  end if;

  for v_day in
    select
      (o.created_at at time zone 'Africa/Gaborone')::date as business_date,
      sum(case when o.payment_method = 'cash' then o.total else 0 end) as cash_total,
      sum(case when o.payment_method in ('card','card_machine','snapscan') then o.total else 0 end) as card_total,
      sum(case when o.payment_method in ('mobile','eft','transfer','debit_order') then o.total else 0 end) as mobile_total,
      sum(coalesce(nullif(o.gross_total, 0), o.total) - o.discount_total) as total_revenue,
      sum(o.tax_total) as total_tax,
      sum(o.discount_total) as total_discount,
      jsonb_agg(o.id) as order_ids
    from public.pos_orders o
    where o.lodge_id = p_lodge_id
      and (o.created_at at time zone 'Africa/Gaborone')::date >= p_start_date
      and (o.created_at at time zone 'Africa/Gaborone')::date <= p_end_date
      and o.status in ('completed', 'settled')
      and coalesce(o.transaction_type, 'sale') = 'sale'
    group by (o.created_at at time zone 'Africa/Gaborone')::date
    having not exists (
      select 1 from public.restaurant_journal_entries je
      where je.lodge_id = p_lodge_id
        and je.source_type = 'pos_sale'
        and je.entry_date = (o.created_at at time zone 'Africa/Gaborone')::date
    )
    order by business_date
  loop
    v_total_cash := coalesce(v_day.cash_total, 0);
    v_total_card := coalesce(v_day.card_total, 0);
    v_total_mobile := coalesce(v_day.mobile_total, 0);
    v_total_revenue := coalesce(v_day.total_revenue, 0);
    v_total_tax := coalesce(v_day.total_tax, 0);
    v_total_discount := coalesce(v_day.total_discount, 0);

    if (v_total_cash + v_total_card + v_total_mobile) = 0 then
      continue;
    end if;

    v_lines := '[]'::jsonb;

    if v_total_cash > 0 and v_account_cash is not null then
      v_lines := v_lines || jsonb_build_object('account_id', v_account_cash, 'debit', v_total_cash, 'credit', 0, 'memo', 'Cash sales - ' || v_day.business_date);
    end if;

    if v_total_card > 0 and v_account_bank is not null then
      v_lines := v_lines || jsonb_build_object('account_id', v_account_bank, 'debit', v_total_card, 'credit', 0, 'memo', 'Card sales - ' || v_day.business_date);
    end if;

    if v_total_mobile > 0 and v_account_bank is not null then
      v_lines := v_lines || jsonb_build_object('account_id', v_account_bank, 'debit', v_total_mobile, 'credit', 0, 'memo', 'Mobile/EFT sales - ' || v_day.business_date);
    end if;

    v_lines := v_lines || jsonb_build_object('account_id', v_account_revenue_food, 'debit', 0, 'credit', v_total_revenue, 'memo', 'Sales revenue - ' || v_day.business_date);

    if v_total_tax > 0 and v_account_vat is not null then
      v_lines := v_lines || jsonb_build_object('account_id', v_account_vat, 'debit', 0, 'credit', v_total_tax, 'memo', 'VAT payable - ' || v_day.business_date);
    end if;

    -- Validate balance: total debits must equal total credits
    v_total_debit := 0;
    v_total_credit := 0;
    for v_line in select * from jsonb_array_elements(v_lines)
    loop
      v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
      v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
    end loop;

    if v_total_debit <> v_total_credit then
      return jsonb_build_object('success', false, 'error', 'Journal not balanced for ' || v_day.business_date || ': debit ' || v_total_debit || ' != credit ' || v_total_credit);
    end if;

    if v_total_debit = 0 then
      continue;
    end if;

    insert into public.restaurant_journal_entries (
      lodge_id, entry_date, description, source_type, source_id, reference_number, created_by
    ) values (
      p_lodge_id, v_day.business_date,
      'POS sales batch - ' || v_day.business_date || ' (' || jsonb_array_length(v_day.order_ids) || ' orders)',
      'pos_sale', (v_day.order_ids->>0)::uuid,
      'PSB-' || to_char(v_day.business_date, 'YYYYMMDD') || '-' || jsonb_array_length(v_day.order_ids),
      v_actor_id
    ) returning id into v_entry_id;

    for v_line in select * from jsonb_array_elements(v_lines)
    loop
      insert into public.restaurant_journal_lines (
        entry_id, account_id, debit, credit, memo
      ) values (
        v_entry_id,
        (v_line->>'account_id')::uuid,
        coalesce((v_line->>'debit')::numeric, 0),
        coalesce((v_line->>'credit')::numeric, 0),
        v_line->>'memo'
      );
    end loop;

    v_entries_posted := v_entries_posted + 1;
  end loop;

  return jsonb_build_object('success', true, 'data', jsonb_build_object('entries_posted', v_entries_posted));
end;
$$;

-- ── 6. post_expenses_to_gl ───────────────────────────────────
create or replace function public.post_expenses_to_gl(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_exp record;
  v_entry_id uuid;
  v_entries_posted integer := 0;
  v_account_cash uuid;
  v_account_bank uuid;
  v_expense_account uuid;
  v_default_expense uuid;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  select id into v_account_cash from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '1000' and is_active = true limit 1;
  select id into v_account_bank from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '1020' and is_active = true limit 1;
  select id into v_default_expense from public.restaurant_accounts
    where lodge_id = p_lodge_id and code = '6000' and is_active = true limit 1;

  if v_account_cash is null and v_account_bank is null then
    return jsonb_build_object('success', false, 'error', 'No cash/bank account found. Seed chart of accounts first.');
  end if;

  for v_exp in
    select e.*,
      case lower(e.category)
        when 'food_supplies' then (select id from public.restaurant_accounts where lodge_id = p_lodge_id and code = '5100' and is_active = true limit 1)
        when 'beverages' then (select id from public.restaurant_accounts where lodge_id = p_lodge_id and code = '5200' and is_active = true limit 1)
        when 'packaging' then (select id from public.restaurant_accounts where lodge_id = p_lodge_id and code = '5300' and is_active = true limit 1)
        else null
      end as mapped_expense_account_id
    from public.expenses e
    where e.lodge_id = p_lodge_id
      and e.date >= p_start_date
      and e.date <= p_end_date
      and not exists (
        select 1 from public.restaurant_journal_entries je
        where je.lodge_id = p_lodge_id
          and je.source_type = 'expense'
          and je.source_id = e.id
      )
    order by e.date
  loop
    v_expense_account := v_exp.mapped_expense_account_id;
    if v_expense_account is null then
      v_expense_account := v_default_expense;
    end if;

    if v_expense_account is null then
      continue;
    end if;

    insert into public.restaurant_journal_entries (
      lodge_id, entry_date, description, source_type, source_id, reference_number, created_by
    ) values (
      p_lodge_id, v_exp.date,
      'Expense: ' || v_exp.description || ' (' || coalesce(v_exp.category, 'uncategorized') || ')',
      'expense', v_exp.id,
      'EXP-' || to_char(v_exp.date, 'YYYYMMDD') || '-' || left(v_exp.id::text, 8),
      v_actor_id
    ) returning id into v_entry_id;

    insert into public.restaurant_journal_lines (entry_id, account_id, debit, credit, memo)
    values (v_entry_id, v_expense_account, v_exp.amount, 0, v_exp.description);

    insert into public.restaurant_journal_lines (entry_id, account_id, debit, credit, memo)
    values (v_entry_id, coalesce(v_account_cash, v_account_bank), 0, v_exp.amount, 'Payment for: ' || v_exp.description);

    v_entries_posted := v_entries_posted + 1;
  end loop;

  return jsonb_build_object('success', true, 'data', jsonb_build_object('entries_posted', v_entries_posted));
end;
$$;

-- ── 7. get_restaurant_profit_and_loss ────────────────────────
create or replace function public.get_restaurant_profit_and_loss(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_total_revenue numeric := 0;
  v_total_expenses numeric := 0;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  return jsonb_build_object(
    'success', true,
    'data', (
      select jsonb_build_object(
        'start_date', p_start_date,
        'end_date', p_end_date,
        'revenue', coalesce(rev.lines, '[]'::jsonb),
        'total_revenue', coalesce(rev.total, 0),
        'expenses', coalesce(exp.lines, '[]'::jsonb),
        'total_expenses', coalesce(exp.total, 0),
        'net_income', coalesce(rev.total, 0) - coalesce(exp.total, 0)
      )
      from (
        select
          jsonb_agg(jsonb_build_object(
            'account_id', t.id,
            'account_code', t.code,
            'account_name', t.name,
            'amount', t.amount
          ) order by t.code) as lines,
          sum(t.amount) as total
        from (
          select
            a.id, a.code, a.name,
            coalesce(sum(jl.credit), 0) - coalesce(sum(jl.debit), 0) + a.opening_balance as amount
          from public.restaurant_accounts a
          left join public.restaurant_journal_lines jl on jl.account_id = a.id
          left join public.restaurant_journal_entries je on je.id = jl.entry_id
            and je.entry_date >= p_start_date and je.entry_date <= p_end_date
          where a.lodge_id = p_lodge_id
            and a.account_type = 'revenue'
            and a.is_active = true
          group by a.id, a.code, a.name, a.opening_balance
        ) t
        having sum(t.amount) <> 0
      ) rev
      cross join (
        select
          jsonb_agg(jsonb_build_object(
            'account_id', t.id,
            'account_code', t.code,
            'account_name', t.name,
            'amount', t.amount
          ) order by t.code) as lines,
          sum(t.amount) as total
        from (
          select
            a.id, a.code, a.name,
            coalesce(sum(jl.debit), 0) - coalesce(sum(jl.credit), 0) + abs(a.opening_balance) as amount
          from public.restaurant_accounts a
          left join public.restaurant_journal_lines jl on jl.account_id = a.id
          left join public.restaurant_journal_entries je on je.id = jl.entry_id
            and je.entry_date >= p_start_date and je.entry_date <= p_end_date
          where a.lodge_id = p_lodge_id
            and a.account_type = 'expense'
            and a.is_active = true
          group by a.id, a.code, a.name, a.opening_balance
        ) t
        having sum(t.amount) <> 0
      ) exp
    )
  );
end;
$$;

commit;
