begin;

-- ============================================================
-- Restaurant Balance Sheet & Financial Statements
-- Gated to restaurant-bar only; does not touch hotel/lodge
-- ============================================================

-- ── get_restaurant_balance_sheet ─────────────────────────────
-- Balance sheet as of a given date (or today).
create or replace function public.get_restaurant_balance_sheet(
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
  v_as_of_date date;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  v_as_of_date := coalesce(p_as_of_date, current_date);

  return jsonb_build_object(
    'success', true,
    'as_of_date', v_as_of_date,
    'data', (
      with account_movements as (
        select
          a.id,
          a.code,
          a.name,
          a.account_type,
          a.opening_balance,
          a.is_active,
          coalesce((
            select sum(jl.debit)
            from public.restaurant_journal_lines jl
            join public.restaurant_journal_entries je on je.id = jl.entry_id
            where je.lodge_id = p_lodge_id
              and jl.account_id = a.id
              and je.entry_date <= v_as_of_date
          ), 0) as total_debits,
          coalesce((
            select sum(jl.credit)
            from public.restaurant_journal_lines jl
            join public.restaurant_journal_entries je on je.id = jl.entry_id
            where je.lodge_id = p_lodge_id
              and jl.account_id = a.id
              and je.entry_date <= v_as_of_date
          ), 0) as total_credits
        from public.restaurant_accounts a
        where a.lodge_id = p_lodge_id
          and a.is_active = true
      ),
      computed_balances as (
        select
          *,
          case
            when account_type = 'asset' then opening_balance + total_debits - total_credits
            when account_type = 'liability' then opening_balance + total_credits - total_debits
            when account_type = 'equity' then opening_balance + total_credits - total_debits
            when account_type = 'revenue' then opening_balance + total_credits - total_debits
            when account_type = 'expense' then opening_balance + total_debits - total_credits
            else opening_balance
          end as balance
        from account_movements
      ),
      -- Current assets: code < 1500
      current_assets as (
        select coalesce(jsonb_agg(
          jsonb_build_object('code', code, 'name', name, 'balance', balance)
          order by code
        ), '[]'::jsonb) as items,
          coalesce(sum(balance), 0) as total
        from computed_balances
        where account_type = 'asset' and code < '1500'
      ),
      -- Fixed assets: code >= 1500 and < 1600 (excluding accumulated depreciation)
      fixed_assets_gross as (
        select coalesce(jsonb_agg(
          jsonb_build_object('code', code, 'name', name, 'balance', balance)
          order by code
        ), '[]'::jsonb) as items,
          coalesce(sum(balance), 0) as total
        from computed_balances
        where account_type = 'asset' and code >= '1500' and code < '1600'
      ),
      accumulated_depreciation as (
        select coalesce(sum(balance), 0) as total
        from computed_balances
        where account_type = 'asset' and code >= '1600' and code < '1700'
      ),
      total_assets as (
        select
          ca.total + fa.total + ad.total as total
        from current_assets ca, fixed_assets_gross fa, accumulated_depreciation ad
      ),
      -- Current liabilities
      current_liabilities as (
        select coalesce(jsonb_agg(
          jsonb_build_object('code', code, 'name', name, 'balance', balance)
          order by code
        ), '[]'::jsonb) as items,
          coalesce(sum(balance), 0) as total
        from computed_balances
        where account_type = 'liability'
      ),
      total_liabilities as (
        select coalesce(sum(balance), 0) as total
        from computed_balances
        where account_type = 'liability'
      ),
      -- Equity
      equity_accounts as (
        select coalesce(jsonb_agg(
          jsonb_build_object('code', code, 'name', name, 'balance', balance)
          order by code
        ), '[]'::jsonb) as items,
          coalesce(sum(balance), 0) as total
        from computed_balances
        where account_type = 'equity' and code not in ('3100')
      ),
      -- Retained earnings = revenue - expenses
      retained_earnings_calc as (
        select
          coalesce(sum(case when account_type = 'revenue' then balance else 0 end), 0)
          - coalesce(sum(case when account_type = 'expense' then balance else 0 end), 0) as balance
        from computed_balances
        where account_type in ('revenue', 'expense')
      ),
      total_equity as (
        select
          ea.total + re.balance as total
        from equity_accounts ea, retained_earnings_calc re
      ),
      -- Accounting equation check
      equation_check as (
        select
          ta.total as assets,
          tl.total + te.total as liab_plus_equity,
          abs(ta.total - (tl.total + te.total)) as difference
        from total_assets ta, total_liabilities tl, total_equity te
      )
      select jsonb_build_object(
        'current_assets', (select jsonb_build_object('items', items, 'total', total) from current_assets),
        'fixed_assets', (select jsonb_build_object('items', items, 'gross_total', total) from fixed_assets_gross),
        'accumulated_depreciation', (select jsonb_build_object('total', total) from accumulated_depreciation),
        'total_assets', (select total from total_assets),
        'current_liabilities', (select jsonb_build_object('items', items, 'total', total) from current_liabilities),
        'total_liabilities', (select total from total_liabilities),
        'owners_equity', (select jsonb_build_object('items', items, 'total', total) from equity_accounts),
        'retained_earnings', (select jsonb_build_object('balance', balance) from retained_earnings_calc),
        'total_equity', (select total from total_equity),
        'total_liabilities_and_equity', (select tl.total + te.total from total_liabilities tl, total_equity te),
        'is_balanced', (select difference < 0.01 from equation_check),
        'difference', (select difference from equation_check)
      )
    )
  );
end;
$$;

-- ── get_restaurant_income_statement ──────────────────────────
-- Income statement (P&L) for a period.
create or replace function public.get_restaurant_income_statement(
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
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  return jsonb_build_object(
    'success', true,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'data', (
      with account_movements as (
        select
          a.id,
          a.code,
          a.name,
          a.account_type,
          a.opening_balance,
          coalesce((
            select sum(jl.debit)
            from public.restaurant_journal_lines jl
            join public.restaurant_journal_entries je on je.id = jl.entry_id
            where je.lodge_id = p_lodge_id
              and jl.account_id = a.id
              and je.entry_date between p_start_date and p_end_date
          ), 0) as period_debits,
          coalesce((
            select sum(jl.credit)
            from public.restaurant_journal_lines jl
            join public.restaurant_journal_entries je on je.id = jl.entry_id
            where je.lodge_id = p_lodge_id
              and jl.account_id = a.id
              and je.entry_date between p_start_date and p_end_date
          ), 0) as period_credits
        from public.restaurant_accounts a
        where a.lodge_id = p_lodge_id
          and a.is_active = true
          and a.account_type in ('revenue', 'expense')
      ),
      revenue_items as (
        select coalesce(jsonb_agg(
          jsonb_build_object('code', code, 'name', name, 'amount', period_credits - period_debits)
          order by code
        ), '[]'::jsonb) as items,
          coalesce(sum(period_credits - period_debits), 0) as total
        from account_movements
        where account_type = 'revenue'
      ),
      expense_items as (
        select coalesce(jsonb_agg(
          jsonb_build_object('code', code, 'name', name, 'amount', period_debits - period_credits)
          order by code
        ), '[]'::jsonb) as items,
          coalesce(sum(period_debits - period_credits), 0) as total
        from account_movements
        where account_type = 'expense'
      )
      select jsonb_build_object(
        'revenue', (select jsonb_build_object('items', items, 'total', total) from revenue_items),
        'expenses', (select jsonb_build_object('items', items, 'total', total) from expense_items),
        'net_income', (
          select ri.total - ei.total
          from revenue_items ri, expense_items ei
        )
      )
    )
  );
end;
$$;

-- ── get_restaurant_cash_flow_statement ───────────────────────
-- Cash flow statement for a period.
create or replace function public.get_restaurant_cash_flow_statement(
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
  v_total_operating numeric(15,2);
  v_total_investing numeric(15,2);
  v_total_financing numeric(15,2);
  v_operating_inflows jsonb;
  v_operating_outflows jsonb;
  v_investing_items jsonb;
  v_financing_items jsonb;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  -- Cash flow classified per-entry from journal_lines.
  -- Cash accounts are assets with code 1000-1029 (petty cash, cash on hand, bank).
  -- For each entry, the cash-side line determines the cash flow direction,
  -- and the non-cash side line(s) determine the category (operating/investing/financing).
  with
  cash_account_ids as (
    select id from public.restaurant_accounts
    where lodge_id = p_lodge_id and account_type = 'asset' and code >= '1000' and code < '1030'
  ),
  entry_cash_lines as (
    select
      je.id as entry_id,
      jl.debit,
      jl.credit,
      jl.account_id
    from public.restaurant_journal_entries je
    join public.restaurant_journal_lines jl on jl.entry_id = je.id
    join public.restaurant_accounts a on a.id = jl.account_id
    where je.lodge_id = p_lodge_id
      and je.entry_date between p_start_date and p_end_date
      and jl.account_id in (select id from cash_account_ids)
  ),
  entry_non_cash_lines as (
    select
      je.id as entry_id,
      jl.debit,
      jl.credit,
      a.account_type,
      a.code,
      a.name
    from public.restaurant_journal_entries je
    join public.restaurant_journal_lines jl on jl.entry_id = je.id
    join public.restaurant_accounts a on a.id = jl.account_id
    where je.lodge_id = p_lodge_id
      and je.entry_date between p_start_date and p_end_date
      and jl.account_id not in (select id from cash_account_ids)
      and a.lodge_id = p_lodge_id
  ),
  entry_classified as (
    select
      ecl.entry_id,
      ecl.debit as cash_debit,
      ecl.credit as cash_credit,
      case
        when exists (select 1 from entry_non_cash_lines ncl where ncl.entry_id = ecl.entry_id and ncl.account_type = 'revenue') then 'operating_inflow'
        when exists (select 1 from entry_non_cash_lines ncl where ncl.entry_id = ecl.entry_id and ncl.account_type = 'expense') then 'operating_outflow'
        when exists (select 1 from entry_non_cash_lines ncl where ncl.entry_id = ecl.entry_id and ncl.account_type = 'asset' and ncl.code >= '1500') then 'investing'
        when exists (select 1 from entry_non_cash_lines ncl where ncl.entry_id = ecl.entry_id and ncl.account_type = 'equity') then 'financing'
        else 'other'
      end as category,
      (select ncl.name from entry_non_cash_lines ncl where ncl.entry_id = ecl.entry_id limit 1) as source_name
    from entry_cash_lines ecl
  ),
  operating_inflows as (
    select jsonb_build_object('source', source_name, 'amount', sum(cash_debit)) as item
    from entry_classified
    where category = 'operating_inflow' and cash_debit > 0
    group by source_name
  ),
  operating_outflows as (
    select jsonb_build_object('source', source_name, 'amount', sum(cash_credit)) as item
    from entry_classified
    where category = 'operating_outflow' and cash_credit > 0
    group by source_name
  ),
  investing_entries as (
    select jsonb_build_object('source', source_name, 'amount', sum(cash_debit)) as item
    from entry_classified
    where category = 'investing' and cash_debit > 0
    group by source_name
  ),
  financing_entries as (
    select jsonb_build_object('source', source_name, 'amount', sum(cash_credit) - sum(cash_debit)) as item
    from entry_classified
    where category = 'financing'
    group by source_name
  )
  select
    coalesce((select jsonb_agg(item) from operating_inflows), '[]'::jsonb),
    coalesce((select jsonb_agg(item) from operating_outflows), '[]'::jsonb),
    coalesce((select sum(item->>'amount')::numeric from operating_inflows), 0)
      - coalesce((select sum(item->>'amount')::numeric from operating_outflows), 0),
    coalesce((select jsonb_agg(item) from investing_entries), '[]'::jsonb),
    coalesce((select sum(item->>'amount')::numeric from investing_entries), 0),
    coalesce((select jsonb_agg(item) from financing_entries), '[]'::jsonb),
    coalesce((select sum(item->>'amount')::numeric from financing_entries), 0)
  into
    v_operating_inflows, v_operating_outflows, v_total_operating,
    v_investing_items, v_total_investing,
    v_financing_items, v_total_financing;

  return jsonb_build_object(
    'success', true,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'data', jsonb_build_object(
      'operating_activities', jsonb_build_object(
        'inflows', v_operating_inflows,
        'outflows', v_operating_outflows,
        'net', v_total_operating
      ),
      'investing_activities', jsonb_build_object(
        'items', v_investing_items,
        'net', v_total_investing
      ),
      'financing_activities', jsonb_build_object(
        'items', v_financing_items,
        'net', v_total_financing
      ),
      'net_cash_flow', v_total_operating + v_total_investing + v_total_financing
    )
  );
end;
$$;

-- ── get_restaurant_financial_statements ──────────────────────
-- Combined financial statements for a period.
create or replace function public.get_restaurant_financial_statements(
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
  v_balance_sheet jsonb;
  v_income_statement jsonb;
  v_cash_flow jsonb;
begin
  v_actor_id := public.app_get_actor_user_id();
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', ARRAY['admin', 'super_admin', 'manager', 'finance']);

  -- Balance sheet as of end date
  select public.get_restaurant_balance_sheet(p_lodge_id, p_end_date)
    into v_balance_sheet;

  -- Income statement for the period
  select public.get_restaurant_income_statement(p_lodge_id, p_start_date, p_end_date)
    into v_income_statement;

  -- Cash flow statement for the period
  select public.get_restaurant_cash_flow_statement(p_lodge_id, p_start_date, p_end_date)
    into v_cash_flow;

  return jsonb_build_object(
    'success', true,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'balance_sheet', v_balance_sheet,
    'income_statement', v_income_statement,
    'cash_flow_statement', v_cash_flow
  );
end;
$$;

-- Revoke direct access; only through service_role or authenticated
revoke all on function public.get_restaurant_balance_sheet(uuid, date) from public;
revoke all on function public.get_restaurant_income_statement(uuid, date, date) from public;
revoke all on function public.get_restaurant_cash_flow_statement(uuid, date, date) from public;
revoke all on function public.get_restaurant_financial_statements(uuid, date, date) from public;

grant execute on function public.get_restaurant_balance_sheet(uuid, date) to authenticated, service_role;
grant execute on function public.get_restaurant_income_statement(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_restaurant_cash_flow_statement(uuid, date, date) to authenticated, service_role;
grant execute on function public.get_restaurant_financial_statements(uuid, date, date) to authenticated, service_role;

commit;
