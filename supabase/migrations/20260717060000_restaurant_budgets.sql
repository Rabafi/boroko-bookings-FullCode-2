begin;

-- ============================================================
-- Restaurant Budgets & Budget vs Actual
-- Gated to restaurant-bar only; does not touch hotel/lodge
-- ============================================================

-- ── restaurant_budgets ──────────────────────────────────────
create table if not exists public.restaurant_budgets (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  account_id uuid references public.restaurant_accounts(id) on delete cascade,
  account_name text not null,
  period_year integer not null,
  period_month integer not null check (period_month between 1 and 12),
  budget_amount numeric(15,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, account_id, period_year, period_month)
);

alter table public.restaurant_budgets enable row level security;

create policy restaurant_budgets_lodge_scope_select on public.restaurant_budgets
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_budgets_lodge_scope_insert on public.restaurant_budgets
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_budgets_lodge_scope_update on public.restaurant_budgets
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_budgets_lodge_scope_delete on public.restaurant_budgets
  for delete using (public.app_lodge_access(lodge_id));

create index if not exists restaurant_budgets_lodge_year_idx on public.restaurant_budgets(lodge_id, period_year);
create index if not exists restaurant_budgets_lodge_account_idx on public.restaurant_budgets(lodge_id, account_id);

-- ── restaurant_budget_templates ──────────────────────────────
create table if not exists public.restaurant_budget_templates (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.restaurant_budget_templates enable row level security;

create policy restaurant_budget_templates_lodge_scope_select on public.restaurant_budget_templates
  for select using (public.app_lodge_access(lodge_id));

create policy restaurant_budget_templates_lodge_scope_insert on public.restaurant_budget_templates
  for insert with check (public.app_lodge_access(lodge_id));

create policy restaurant_budget_templates_lodge_scope_update on public.restaurant_budget_templates
  for update using (public.app_lodge_access(lodge_id));

create policy restaurant_budget_templates_lodge_scope_delete on public.restaurant_budget_templates
  for delete using (public.app_lodge_access(lodge_id));

create index if not exists restaurant_budget_templates_lodge_idx on public.restaurant_budget_templates(lodge_id);

-- ── restaurant_budget_template_lines ─────────────────────────
create table if not exists public.restaurant_budget_template_lines (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.restaurant_budget_templates(id) on delete cascade,
  account_id uuid references public.restaurant_accounts(id) on delete cascade,
  account_name text not null,
  monthly_amount numeric(15,2) not null default 0
);

alter table public.restaurant_budget_template_lines enable row level security;

create policy restaurant_budget_template_lines_lodge_scope_select on public.restaurant_budget_template_lines
  for select using (exists (
    select 1 from public.restaurant_budget_templates t
    where t.id = template_id and public.app_lodge_access(t.lodge_id)
  ));

create policy restaurant_budget_template_lines_lodge_scope_insert on public.restaurant_budget_template_lines
  for insert with check (exists (
    select 1 from public.restaurant_budget_templates t
    where t.id = template_id and public.app_lodge_access(t.lodge_id)
  ));

create policy restaurant_budget_template_lines_lodge_scope_update on public.restaurant_budget_template_lines
  for update using (exists (
    select 1 from public.restaurant_budget_templates t
    where t.id = template_id and public.app_lodge_access(t.lodge_id)
  ));

create policy restaurant_budget_template_lines_lodge_scope_delete on public.restaurant_budget_template_lines
  for delete using (exists (
    select 1 from public.restaurant_budget_templates t
    where t.id = template_id and public.app_lodge_access(t.lodge_id)
  ));

-- ══════════════════════════════════════════════════════════════
-- RPCs
-- ══════════════════════════════════════════════════════════════

-- ── get_restaurant_budgets ──────────────────────────────────
-- Returns all budgets for a year grouped by account with monthly columns.
create or replace function public.get_restaurant_budgets(
  p_lodge_id uuid,
  p_year integer
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
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'account_id', a.id,
          'account_name', a.name,
          'account_type', a.account_type,
          'account_code', a.code,
          'budgets', (
            select coalesce(jsonb_object_agg(
              b.period_month, jsonb_build_object(
                'id', b.id,
                'budget_amount', b.budget_amount,
                'notes', b.notes
              )
            ), '{}'::jsonb)
            from public.restaurant_budgets b
            where b.lodge_id = p_lodge_id
              and b.account_id = a.id
              and b.period_year = p_year
          )
        ) order by a.code
      ), '[]'::jsonb)
      from public.restaurant_accounts a
      where a.lodge_id = p_lodge_id
        and a.is_active = true
    )
  );
end;
$$;

-- ── set_restaurant_budget ────────────────────────────────────
-- Upsert a single budget line.
create or replace function public.set_restaurant_budget(
  p_lodge_id uuid,
  p_account_id uuid,
  p_year integer,
  p_month integer,
  p_amount numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_account_name text;
  v_id uuid;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  if p_month < 1 or p_month > 12 then
    return jsonb_build_object('success', false, 'error', 'Month must be between 1 and 12');
  end if;

  select name into v_account_name
  from public.restaurant_accounts
  where id = p_account_id and lodge_id = p_lodge_id;

  if v_account_name is null then
    return jsonb_build_object('success', false, 'error', 'Account not found');
  end if;

  insert into public.restaurant_budgets (lodge_id, account_id, account_name, period_year, period_month, budget_amount, notes)
  values (p_lodge_id, p_account_id, v_account_name, p_year, p_month, coalesce(p_amount, 0), p_notes)
  on conflict (lodge_id, account_id, period_year, period_month)
  do update set
    budget_amount = coalesce(p_amount, 0),
    notes = p_notes,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

-- ── bulk_set_restaurant_budgets ──────────────────────────────
-- Bulk upsert: array of {account_id, amount, notes}.
create or replace function public.bulk_set_restaurant_budgets(
  p_lodge_id uuid,
  p_year integer,
  p_month integer,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_entry jsonb;
  v_account_id uuid;
  v_amount numeric;
  v_notes text;
  v_account_name text;
  v_upserted integer := 0;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  if p_month < 1 or p_month > 12 then
    return jsonb_build_object('success', false, 'error', 'Month must be between 1 and 12');
  end if;

  if p_entries is null or jsonb_array_length(p_entries) = 0 then
    return jsonb_build_object('success', true, 'upserted', 0);
  end if;

  for v_entry in select jsonb_array_elements(p_entries)
  loop
    v_account_id := nullif(v_entry->>'account_id', '')::uuid;
    v_amount := coalesce((v_entry->>'amount')::numeric, 0);
    v_notes := nullif(v_entry->>'notes', '');

    if v_account_id is null then
      continue;
    end if;

    select name into v_account_name
    from public.restaurant_accounts
    where id = v_account_id and lodge_id = p_lodge_id;

    if v_account_name is null then
      continue;
    end if;

    insert into public.restaurant_budgets (lodge_id, account_id, account_name, period_year, period_month, budget_amount, notes)
    values (p_lodge_id, v_account_id, v_account_name, p_year, p_month, v_amount, v_notes)
    on conflict (lodge_id, account_id, period_year, period_month)
    do update set
      budget_amount = v_amount,
      notes = v_notes,
      updated_at = now();

    v_upserted := v_upserted + 1;
  end loop;

  return jsonb_build_object('success', true, 'upserted', v_upserted);
end;
$$;

-- ── copy_budget_to_year ──────────────────────────────────────
-- Copy all budgets from one year to another.
create or replace function public.copy_budget_to_year(
  p_lodge_id uuid,
  p_from_year integer,
  p_to_year integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_copied integer;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  insert into public.restaurant_budgets (lodge_id, account_id, account_name, period_year, period_month, budget_amount, notes)
  select
    lodge_id,
    account_id,
    account_name,
    p_to_year,
    period_month,
    budget_amount,
    notes
  from public.restaurant_budgets
  where lodge_id = p_lodge_id
    and period_year = p_from_year
  on conflict (lodge_id, account_id, period_year, period_month)
  do update set
    budget_amount = excluded.budget_amount,
    notes = excluded.notes,
    updated_at = now();

  get diagnostics v_copied = row_count;

  return jsonb_build_object('success', true, 'copied', v_copied);
end;
$$;

-- ── get_budget_vs_actual ─────────────────────────────────────
-- Returns budget vs actual for each account for a given year+month.
-- Expense accounts: actual = debit - credit (expense incurred)
-- Revenue accounts: actual = credit - debit (revenue earned)
create or replace function public.get_budget_vs_actual(
  p_lodge_id uuid,
  p_year integer,
  p_month integer
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
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'account_id', a.id,
          'account_name', a.name,
          'account_type', a.account_type,
          'account_code', a.code,
          'budget_amount', coalesce(b.budget_amount, 0),
          'actual_amount', coalesce(j.actual_amount, 0),
          'variance', coalesce(b.budget_amount, 0) - coalesce(j.actual_amount, 0),
          'variance_percent', case
            when coalesce(b.budget_amount, 0) = 0 then null
            else round(((coalesce(b.budget_amount, 0) - coalesce(j.actual_amount, 0)) / b.budget_amount * 100)::numeric, 2)
          end
        ) order by a.code
      ), '[]'::jsonb)
      from public.restaurant_accounts a
      left join public.restaurant_budgets b
        on b.lodge_id = p_lodge_id
        and b.account_id = a.id
        and b.period_year = p_year
        and b.period_month = p_month
      left join (
        select
          jl.account_id,
          sum(case when ac.account_type = 'revenue' then jl.credit - jl.debit else jl.debit - jl.credit end) as actual_amount
        from public.restaurant_journal_lines jl
        join public.restaurant_journal_entries je on je.id = jl.entry_id
        join public.restaurant_accounts ac on ac.id = jl.account_id
        where je.lodge_id = p_lodge_id
          and extract(year from je.entry_date) = p_year
          and extract(month from je.entry_date) = p_month
          and ac.lodge_id = p_lodge_id
        group by jl.account_id
      ) j on j.account_id = a.id
      where a.lodge_id = p_lodge_id
        and a.is_active = true
    )
  );
end;
$$;

-- ── get_budget_vs_actual_summary ─────────────────────────────
-- YTD budget vs actual summary across a month range.
create or replace function public.get_budget_vs_actual_summary(
  p_lodge_id uuid,
  p_year integer,
  p_start_month integer default 1,
  p_end_month integer default 12
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
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'account_id', a.id,
          'account_name', a.name,
          'account_type', a.account_type,
          'account_code', a.code,
          'budget_amount', coalesce(b.budget_total, 0),
          'actual_amount', coalesce(j.actual_total, 0),
          'variance', coalesce(b.budget_total, 0) - coalesce(j.actual_total, 0),
          'variance_percent', case
            when coalesce(b.budget_total, 0) = 0 then null
            else round(((coalesce(b.budget_total, 0) - coalesce(j.actual_total, 0)) / b.budget_total * 100)::numeric, 2)
          end
        ) order by a.code
      ), '[]'::jsonb)
      from public.restaurant_accounts a
      left join (
        select account_id, sum(budget_amount) as budget_total
        from public.restaurant_budgets
        where lodge_id = p_lodge_id
          and period_year = p_year
          and period_month between p_start_month and p_end_month
        group by account_id
      ) b on b.account_id = a.id
      left join (
        select
          jl.account_id,
          sum(case when ac.account_type = 'revenue' then jl.credit - jl.debit else jl.debit - jl.credit end) as actual_total
        from public.restaurant_journal_lines jl
        join public.restaurant_journal_entries je on je.id = jl.entry_id
        join public.restaurant_accounts ac on ac.id = jl.account_id
        where je.lodge_id = p_lodge_id
          and extract(year from je.entry_date) = p_year
          and extract(month from je.entry_date) between p_start_month and p_end_month
          and ac.lodge_id = p_lodge_id
        group by jl.account_id
      ) j on j.account_id = a.id
      where a.lodge_id = p_lodge_id
        and a.is_active = true
    )
  );
end;
$$;

-- ── get_restaurant_budget_templates ──────────────────────────
create or replace function public.get_restaurant_budget_templates(
  p_lodge_id uuid
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
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'description', t.description,
          'is_active', t.is_active,
          'created_at', t.created_at,
          'lines', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'id', l.id,
                'account_id', l.account_id,
                'account_name', l.account_name,
                'monthly_amount', l.monthly_amount
              ) order by l.account_name
            ), '[]'::jsonb)
            from public.restaurant_budget_template_lines l
            where l.template_id = t.id
          )
        ) order by t.name
      ), '[]'::jsonb)
      from public.restaurant_budget_templates t
      where t.lodge_id = p_lodge_id
    )
  );
end;
$$;

-- ── create_restaurant_budget_template ────────────────────────
create or replace function public.create_restaurant_budget_template(
  p_lodge_id uuid,
  p_name text,
  p_description text default null,
  p_lines jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_template_id uuid;
  v_line jsonb;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  insert into public.restaurant_budget_templates (lodge_id, name, description)
  values (p_lodge_id, p_name, p_description)
  returning id into v_template_id;

  for v_line in select jsonb_array_elements(p_lines)
  loop
    insert into public.restaurant_budget_template_lines (template_id, account_id, account_name, monthly_amount)
    values (
      v_template_id,
      nullif(v_line->>'account_id', '')::uuid,
      v_line->>'account_name',
      coalesce((v_line->>'monthly_amount')::numeric, 0)
    );
  end loop;

  return jsonb_build_object('success', true, 'id', v_template_id);
end;
$$;

-- ── apply_restaurant_budget_template ─────────────────────────
-- Apply a template to a specific year+month, creating budget entries.
create or replace function public.apply_restaurant_budget_template(
  p_lodge_id uuid,
  p_template_id uuid,
  p_year integer,
  p_month integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_line record;
  v_applied integer := 0;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  if not exists (
    select 1 from public.restaurant_budget_templates
    where id = p_template_id and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Template not found');
  end if;

  for v_line in
    select l.account_id, l.account_name, l.monthly_amount
    from public.restaurant_budget_template_lines l
    where l.template_id = p_template_id
  loop
    insert into public.restaurant_budgets (lodge_id, account_id, account_name, period_year, period_month, budget_amount)
    values (p_lodge_id, v_line.account_id, v_line.account_name, p_year, p_month, v_line.monthly_amount)
    on conflict (lodge_id, account_id, period_year, period_month)
    do update set
      budget_amount = excluded.budget_amount,
      updated_at = now();
    v_applied := v_applied + 1;
  end loop;

  return jsonb_build_object('success', true, 'applied', v_applied);
end;
$$;

-- ── delete_restaurant_budget_template ────────────────────────
create or replace function public.delete_restaurant_budget_template(
  p_lodge_id uuid,
  p_template_id uuid
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

  delete from public.restaurant_budget_templates
  where id = p_template_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Template not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

commit;
