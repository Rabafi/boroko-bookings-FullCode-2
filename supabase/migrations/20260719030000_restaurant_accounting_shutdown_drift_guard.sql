-- Restaurant Accounting shutdown drift guard and pure payroll-settings read.
--
-- Accounting remains no-ship. This migration does not restore any operator
-- privilege or RLS policy. It removes the legacy side effect from the payroll
-- settings getter, then proves the P5/P6 shutdown boundary is still intact.

begin;

create or replace function public.get_restaurant_payroll_settings(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.restaurant_payroll_settings%rowtype;
begin
  perform public.app_require_restaurant_lodge(p_lodge_id, array['admin', 'super_admin', 'manager']);
  perform public.app_require_feature(p_lodge_id, 'restaurant_accounting', array['admin', 'super_admin', 'manager']);

  select *
    into v_settings
  from public.restaurant_payroll_settings
  where lodge_id = p_lodge_id;

  if found then
    return jsonb_build_object('success', true, 'data', to_jsonb(v_settings));
  end if;

  -- A read must never create financial or personnel configuration. Return the
  -- documented defaults without persisting them; initialization belongs in a
  -- future explicit, authorized and audited mutation contract.
  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'id', null,
      'lodge_id', p_lodge_id,
      'paye_threshold', 5000,
      'paye_rate_1', 0,
      'paye_rate_1_threshold', 5000,
      'paye_rate_2', 5,
      'paye_rate_2_threshold', 8333,
      'paye_rate_3', 12.5,
      'paye_rate_3_threshold', 12500,
      'paye_rate_4', 18.5,
      'social_security_rate', 5,
      'pension_rate', 0,
      'health_insurance_amount', 0,
      'currency', 'BWP',
      'created_at', null,
      'updated_at', null
    )
  );
end;
$$;

revoke all on function public.get_restaurant_payroll_settings(uuid)
  from public, anon, authenticated;
grant execute on function public.get_restaurant_payroll_settings(uuid)
  to service_role;

do $$
declare
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
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = any(v_table_names)
  ) then
    raise exception 'Restaurant Accounting RLS policies reappeared during shutdown';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(v_table_names)
      and not c.relrowsecurity
  ) then
    raise exception 'Restaurant Accounting table has RLS disabled during shutdown';
  end if;

  if exists (
    select 1
    from unnest(v_table_names) as expected(table_name)
    cross join lateral (select to_regclass('public.' || expected.table_name)::oid as table_oid) r
    where r.table_oid is null
       or has_any_column_privilege('anon', r.table_oid, 'SELECT, INSERT, UPDATE, REFERENCES')
       or has_any_column_privilege('authenticated', r.table_oid, 'SELECT, INSERT, UPDATE, REFERENCES')
       or has_table_privilege('anon', r.table_oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_table_privilege('authenticated', r.table_oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  ) then
    raise exception 'Restaurant Accounting operator table or column privilege drifted during shutdown';
  end if;

  if has_function_privilege('anon', 'public.get_restaurant_payroll_settings(uuid)'::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', 'public.get_restaurant_payroll_settings(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'Restaurant Accounting payroll getter became operator executable during shutdown';
  end if;
end
$$;

commit;
