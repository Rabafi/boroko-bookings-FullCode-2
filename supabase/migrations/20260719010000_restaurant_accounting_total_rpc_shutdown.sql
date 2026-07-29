-- Restaurant Accounting total operator RPC shutdown.
--
-- Restaurant Accounting is no-ship. Revoke every Accounting RPC, including
-- read-named SECURITY DEFINER functions, because a read name does not prove a
-- side-effect-free implementation. Service-role access remains only for
-- controlled remediation while the subsystem is rebuilt.

begin;

do $$
declare
  v_name text;
  v_signature regprocedure;
  v_missing text[];
  v_function_names constant text[] := array[
    -- Financial audit and chart of accounts
    'log_restaurant_financial_action',
    'get_restaurant_accounts', 'create_restaurant_account', 'update_restaurant_account',
    'delete_restaurant_account', 'seed_restaurant_default_accounts',
    -- General ledger
    'get_restaurant_journal_entries', 'create_restaurant_journal_entry',
    'get_restaurant_general_ledger', 'get_restaurant_trial_balance',
    'post_pos_sales_to_gl', 'post_expenses_to_gl', 'get_restaurant_profit_and_loss',
    -- Bank reconciliation
    'get_restaurant_bank_accounts', 'create_restaurant_bank_account',
    'update_restaurant_bank_account', 'import_bank_statement', 'get_bank_transactions',
    'auto_match_transactions', 'propose_bank_matches', 'approve_bank_match',
    'create_bank_reconciliation', 'complete_bank_reconciliation', 'get_bank_reconciliations',
    -- Accounts payable
    'get_restaurant_bills', 'create_restaurant_bill', 'update_restaurant_bill',
    'update_bill_items', 'update_bill_status', 'record_bill_payment',
    'get_bill_payments', 'get_ap_aging', 'get_ap_summary',
    -- Tax
    'generate_tax_return', 'get_restaurant_tax_returns', 'update_tax_return',
    'get_tax_return_summary',
    -- Budgets
    'get_restaurant_budgets', 'set_restaurant_budget', 'bulk_set_restaurant_budgets',
    'copy_budget_to_year', 'get_budget_vs_actual', 'get_budget_vs_actual_summary',
    'get_restaurant_budget_templates', 'create_restaurant_budget_template',
    'apply_restaurant_budget_template', 'delete_restaurant_budget_template',
    -- Financial statements
    'get_restaurant_balance_sheet', 'get_restaurant_income_statement',
    'get_restaurant_cash_flow_statement', 'get_restaurant_financial_statements',
    -- Payroll
    'get_restaurant_payroll_settings', 'update_restaurant_payroll_settings',
    'create_pay_period', 'get_pay_periods', 'calculate_payroll',
    'get_pay_period_records', 'update_employee_pay_record', 'approve_payroll',
    'generate_payslip', 'post_payroll_to_gl'
  ];
begin
  select array_agg(expected.name order by expected.name)
    into v_missing
  from unnest(v_function_names) as expected(name)
  where not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = expected.name
  );
  if v_missing is not null then
    raise exception 'Restaurant Accounting total shutdown missing expected functions: %', array_to_string(v_missing, ', ');
  end if;

  foreach v_name in array v_function_names loop
    for v_signature in
      select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    loop
      execute format('revoke all on function %s from public, anon, authenticated', v_signature);
      execute format('grant execute on function %s to service_role', v_signature);
    end loop;
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(v_function_names)
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) then
    raise exception 'Restaurant Accounting operator RPC execution remains effective after total shutdown';
  end if;
end
$$;

commit;