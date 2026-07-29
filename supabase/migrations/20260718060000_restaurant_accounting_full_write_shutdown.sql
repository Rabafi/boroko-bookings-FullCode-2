-- Restaurant Accounting temporary full write shutdown.
--
-- The accounting subsystem has unresolved financial-integrity and authorization
-- defects. Keep every accounting mutation unreachable from application roles
-- until the replacement contracts have been behaviourally verified.

begin;

do $$
declare
  v_name text;
  v_signature regprocedure;
  v_names constant text[] := array[
    'create_restaurant_account',
    'update_restaurant_account',
    'delete_restaurant_account',
    'seed_restaurant_default_accounts',
    'create_restaurant_journal_entry',
    'post_pos_sales_to_gl',
    'post_expenses_to_gl',
    'create_restaurant_bank_account',
    'update_restaurant_bank_account',
    'import_bank_statement',
    'auto_match_transactions',
    'propose_bank_matches',
    'approve_bank_match',
    'create_bank_reconciliation',
    'complete_bank_reconciliation',
    'create_restaurant_bill',
    'update_restaurant_bill',
    'update_bill_items',
    'update_bill_status',
    'record_bill_payment',
    'generate_tax_return',
    'update_tax_return',
    'set_restaurant_budget',
    'bulk_set_restaurant_budgets',
    'copy_budget_to_year',
    'create_restaurant_budget_template',
    'apply_restaurant_budget_template',
    'delete_restaurant_budget_template',
    'update_restaurant_payroll_settings',
    'create_pay_period',
    'calculate_payroll',
    'update_employee_pay_record',
    'approve_payroll',
    'generate_payslip',
    'post_payroll_to_gl'
  ];
begin
  foreach v_name in array v_names loop
    for v_signature in
      select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = v_name
    loop
      execute format('revoke all on function %s from public, anon, authenticated', v_signature);
      execute format('grant execute on function %s to service_role', v_signature);
    end loop;
  end loop;
end
$$;

commit;