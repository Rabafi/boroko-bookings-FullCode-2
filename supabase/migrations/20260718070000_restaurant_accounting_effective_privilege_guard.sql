-- Restaurant Accounting dormant-surface hardening.
-- Revoke operator mutation privileges again and prove effective privileges rather
-- than trusting ACL text. This is deliberately forward-only after P3 shutdown.

begin;

do $$
declare
  v_name text;
  v_signature regprocedure;
  v_table regclass;
  v_missing text[];
  v_function_names constant text[] := array[
    'log_restaurant_financial_action',
    'create_restaurant_account', 'update_restaurant_account', 'delete_restaurant_account',
    'seed_restaurant_default_accounts', 'create_restaurant_journal_entry',
    'post_pos_sales_to_gl', 'post_expenses_to_gl', 'create_restaurant_bank_account',
    'update_restaurant_bank_account', 'import_bank_statement', 'auto_match_transactions',
    'propose_bank_matches', 'approve_bank_match', 'create_bank_reconciliation',
    'complete_bank_reconciliation', 'create_restaurant_bill', 'update_restaurant_bill',
    'update_bill_items', 'update_bill_status', 'record_bill_payment', 'generate_tax_return',
    'update_tax_return', 'set_restaurant_budget', 'bulk_set_restaurant_budgets',
    'copy_budget_to_year', 'create_restaurant_budget_template', 'apply_restaurant_budget_template',
    'delete_restaurant_budget_template', 'update_restaurant_payroll_settings', 'create_pay_period',
    'calculate_payroll', 'update_employee_pay_record', 'approve_payroll', 'generate_payslip',
    'post_payroll_to_gl'
  ];
  v_table_names constant text[] := array[
    'restaurant_accounts', 'restaurant_journal_entries', 'restaurant_journal_lines',
    'restaurant_bank_accounts', 'restaurant_bank_transactions', 'restaurant_bank_reconciliations',
    'restaurant_bank_statement_imports', 'restaurant_match_proposals', 'restaurant_bills',
    'restaurant_bill_items', 'restaurant_bill_payments', 'restaurant_tax_returns',
    'restaurant_budgets', 'restaurant_budget_templates', 'restaurant_budget_template_lines',
    'restaurant_pay_periods', 'restaurant_employee_pay_records', 'restaurant_payroll_settings',
    'restaurant_payroll_payments', 'restaurant_financial_audit_log'
  ];
begin
  select array_agg(expected.name order by expected.name)
    into v_missing
  from unnest(v_table_names) as expected(name)
  where to_regclass('public.' || expected.name) is null;
  if v_missing is not null then
    raise exception 'Restaurant Accounting privilege guard missing expected tables: %', array_to_string(v_missing, ', ');
  end if;

  select array_agg(expected.name order by expected.name)
    into v_missing
  from unnest(v_function_names) as expected(name)
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = expected.name
  );
  if v_missing is not null then
    raise exception 'Restaurant Accounting privilege guard missing expected functions: %', array_to_string(v_missing, ', ');
  end if;

  foreach v_name in array v_function_names loop
    for v_signature in
      select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    loop
      execute format('revoke all on function %s from public, anon, authenticated', v_signature);
      execute format('grant execute on function %s to service_role', v_signature);
    end loop;
  end loop;

  for v_table in
    select to_regclass('public.' || table_name)::regclass
    from unnest(v_table_names) as t(table_name)
  loop
    execute format('revoke insert, update, delete, truncate on table %s from public, anon, authenticated', v_table);
  end loop;

  if exists (
    select 1
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(v_function_names)
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception 'Restaurant Accounting operator function execution remains effective after shutdown';
  end if;

  if exists (
    select 1
    from unnest(v_table_names) as expected(table_name)
    cross join lateral (select to_regclass('public.' || expected.table_name)::oid as table_oid) r
    where has_table_privilege('anon', r.table_oid, 'INSERT')
       or has_table_privilege('anon', r.table_oid, 'UPDATE')
       or has_table_privilege('anon', r.table_oid, 'DELETE')
       or has_table_privilege('anon', r.table_oid, 'TRUNCATE')
       or has_table_privilege('authenticated', r.table_oid, 'INSERT')
       or has_table_privilege('authenticated', r.table_oid, 'UPDATE')
       or has_table_privilege('authenticated', r.table_oid, 'DELETE')
       or has_table_privilege('authenticated', r.table_oid, 'TRUNCATE')
  ) then
    raise exception 'Restaurant Accounting operator table mutation privilege remains effective after shutdown';
  end if;
end
$$;

commit;