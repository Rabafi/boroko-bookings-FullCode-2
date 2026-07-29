-- Restaurant Accounting total table shutdown.
--
-- The Accounting subsystem is no-ship. Direct table access is disabled for all
-- operator roles, including read access, because RLS alone is not an adequate
-- confidentiality boundary while Accounting is unavailable.

begin;

do $$
declare
  v_table regclass;
  v_policy record;
  v_column record;
  v_missing text[];
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
    raise exception 'Restaurant Accounting total table shutdown missing expected tables: %', array_to_string(v_missing, ', ');
  end if;

  -- Remove legacy lodge-only policies instead of treating them as a security
  -- boundary. With no policies and no operator privileges, access fails closed.
  for v_policy in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename = any(v_table_names)
  loop
    execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_policy.tablename);
  end loop;

  for v_table in
    select to_regclass('public.' || table_name)::regclass
    from unnest(v_table_names) as t(table_name)
  loop
    execute format('alter table %s enable row level security', v_table);
    execute format('revoke select, insert, update, delete, truncate, references, trigger on table %s from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete, truncate, references, trigger on table %s to service_role', v_table);
  end loop;

  -- REVOKE on a table does not make column-specific historical grants harmless.
  -- Clear those too so no partial read or write privilege survives the shutdown.
  for v_column in
    select c.oid as table_oid, a.attname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relname = any(v_table_names)
      and a.attnum > 0
      and not a.attisdropped
  loop
    execute format(
      'revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on table %2$s from public, anon, authenticated',
      v_column.attname,
      v_column.table_oid::regclass
    );
  end loop;

  if exists (
    select 1
    from unnest(v_table_names) as expected(table_name)
    cross join lateral (select to_regclass('public.' || expected.table_name)::oid as table_oid) r
    where has_table_privilege('anon', r.table_oid, 'SELECT')
       or has_table_privilege('anon', r.table_oid, 'INSERT')
       or has_table_privilege('anon', r.table_oid, 'UPDATE')
       or has_table_privilege('anon', r.table_oid, 'DELETE')
       or has_table_privilege('anon', r.table_oid, 'TRUNCATE')
       or has_table_privilege('anon', r.table_oid, 'REFERENCES')
       or has_table_privilege('anon', r.table_oid, 'TRIGGER')
       or has_table_privilege('authenticated', r.table_oid, 'SELECT')
       or has_table_privilege('authenticated', r.table_oid, 'INSERT')
       or has_table_privilege('authenticated', r.table_oid, 'UPDATE')
       or has_table_privilege('authenticated', r.table_oid, 'DELETE')
       or has_table_privilege('authenticated', r.table_oid, 'TRUNCATE')
       or has_table_privilege('authenticated', r.table_oid, 'REFERENCES')
       or has_table_privilege('authenticated', r.table_oid, 'TRIGGER')
  ) then
    raise exception 'Restaurant Accounting operator table privilege remains effective after total shutdown';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relname = any(v_table_names)
      and a.attnum > 0
      and not a.attisdropped
      and (
        has_column_privilege('anon', c.oid, a.attname, 'SELECT')
        or has_column_privilege('anon', c.oid, a.attname, 'INSERT')
        or has_column_privilege('anon', c.oid, a.attname, 'UPDATE')
        or has_column_privilege('anon', c.oid, a.attname, 'REFERENCES')
        or has_column_privilege('authenticated', c.oid, a.attname, 'SELECT')
        or has_column_privilege('authenticated', c.oid, a.attname, 'INSERT')
        or has_column_privilege('authenticated', c.oid, a.attname, 'UPDATE')
        or has_column_privilege('authenticated', c.oid, a.attname, 'REFERENCES')
      )
  ) then
    raise exception 'Restaurant Accounting operator column privilege remains effective after total shutdown';
  end if;
end
$$;

commit;