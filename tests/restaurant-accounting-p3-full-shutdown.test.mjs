import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const app = read('src/renderer/src/App.jsx')
const main = read('src/main/index.js')
const preload = read('src/preload/index.js')
const databaseFacade = read('src/main/database.js')
const desktopNav = read('src/renderer/src/navigation/desktopNav.js')
const hposNav = read('src/shared/barModeProfile.js')
const manageHub = read('src/renderer/src/components/hospitality-pos/HposManageHub.jsx')
const privilegeGuardSql = read('supabase/migrations/20260718070000_restaurant_accounting_effective_privilege_guard.sql')
const totalShutdownSql = read('supabase/migrations/20260719010000_restaurant_accounting_total_rpc_shutdown.sql')
const tableShutdownSql = read('supabase/migrations/20260719020000_restaurant_accounting_total_table_shutdown.sql')
const driftGuardSql = read('supabase/migrations/20260719030000_restaurant_accounting_shutdown_drift_guard.sql')
const accountingSqlFiles = [
  'supabase/migrations/20260717010000_restaurant_chart_of_accounts.sql',
  'supabase/migrations/20260717020000_restaurant_general_ledger.sql',
  'supabase/migrations/20260717030000_restaurant_bank_reconciliation.sql',
  'supabase/migrations/20260717040000_restaurant_accounts_payable.sql',
  'supabase/migrations/20260717050000_restaurant_tax_returns.sql',
  'supabase/migrations/20260717060000_restaurant_budgets.sql',
  'supabase/migrations/20260717070000_restaurant_balance_sheet.sql',
  'supabase/migrations/20260717080000_restaurant_payroll.sql',
  'supabase/migrations/20260718010000_restaurant_accounting_p1_hardening.sql'
]
const accountingSql = accountingSqlFiles.map(read).join('\n')

const routes = [
  'chart-of-accounts', 'general-ledger', 'bank-reconciliation', 'accounts-payable',
  'tax-returns', 'budgets', 'balance-sheet', 'payroll'
]
const apiNamespaces = [
  'restaurantAccounting:', 'restaurantGeneralLedger:', 'restaurantBankReconciliation:',
  'restaurantAccountsPayable:', 'restaurantTaxReturns:', 'restaurantBudgets:',
  'restaurantBalanceSheet:', 'restaurantPayroll:'
]
const accountingDomainFiles = [
  'restaurantAccounting', 'restaurantGeneralLedger', 'restaurantBankReconciliation',
  'restaurantAccountsPayable', 'restaurantTaxReturns', 'restaurantBudgets',
  'restaurantBalanceSheet', 'restaurantPayroll'
]
const componentChunks = [
  'RestaurantChartOfAccounts', 'RestaurantGeneralLedger', 'RestaurantBankReconciliation',
  'RestaurantAccountsPayable', 'RestaurantTaxReturns', 'RestaurantBudgets',
  'RestaurantBalanceSheet', 'RestaurantPayroll'
]
const accountingRpcNames = [
  'log_restaurant_financial_action',
  'get_restaurant_accounts', 'create_restaurant_account', 'update_restaurant_account',
  'delete_restaurant_account', 'seed_restaurant_default_accounts',
  'get_restaurant_journal_entries', 'create_restaurant_journal_entry',
  'get_restaurant_general_ledger', 'get_restaurant_trial_balance',
  'post_pos_sales_to_gl', 'post_expenses_to_gl', 'get_restaurant_profit_and_loss',
  'get_restaurant_bank_accounts', 'create_restaurant_bank_account',
  'update_restaurant_bank_account', 'import_bank_statement', 'get_bank_transactions',
  'auto_match_transactions', 'propose_bank_matches', 'approve_bank_match',
  'create_bank_reconciliation', 'complete_bank_reconciliation', 'get_bank_reconciliations',
  'get_restaurant_bills', 'create_restaurant_bill', 'update_restaurant_bill',
  'update_bill_items', 'update_bill_status', 'record_bill_payment',
  'get_bill_payments', 'get_ap_aging', 'get_ap_summary',
  'generate_tax_return', 'get_restaurant_tax_returns', 'update_tax_return',
  'get_tax_return_summary',
  'get_restaurant_budgets', 'set_restaurant_budget', 'bulk_set_restaurant_budgets',
  'copy_budget_to_year', 'get_budget_vs_actual', 'get_budget_vs_actual_summary',
  'get_restaurant_budget_templates', 'create_restaurant_budget_template',
  'apply_restaurant_budget_template', 'delete_restaurant_budget_template',
  'get_restaurant_balance_sheet', 'get_restaurant_income_statement',
  'get_restaurant_cash_flow_statement', 'get_restaurant_financial_statements',
  'get_restaurant_payroll_settings', 'update_restaurant_payroll_settings',
  'create_pay_period', 'get_pay_periods', 'calculate_payroll',
  'get_pay_period_records', 'update_employee_pay_record', 'approve_payroll',
  'generate_payslip', 'post_payroll_to_gl'
]
const accountingTableNames = [
  'restaurant_accounts', 'restaurant_journal_entries', 'restaurant_journal_lines',
  'restaurant_bank_accounts', 'restaurant_bank_transactions', 'restaurant_bank_reconciliations',
  'restaurant_bank_statement_imports', 'restaurant_match_proposals', 'restaurant_bills',
  'restaurant_bill_items', 'restaurant_bill_payments', 'restaurant_tax_returns',
  'restaurant_budgets', 'restaurant_budget_templates', 'restaurant_budget_template_lines',
  'restaurant_pay_periods', 'restaurant_employee_pay_records', 'restaurant_payroll_settings',
  'restaurant_payroll_payments', 'restaurant_financial_audit_log'
]
const tablePrivileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']

function definedAccountingRpcNames(source) {
  return new Set([...source.matchAll(/create or replace function public\.([a-z0-9_]+)\s*\(/g)].map((match) => match[1]))
}

function definedAccountingTableNames(source) {
  return new Set([...source.matchAll(/create table if not exists public\.([a-z0-9_]+)\s*\(/g)].map((match) => match[1]))
}

function accountingFunctionBodies(source) {
  return [...source.matchAll(/create or replace function public\.([a-z0-9_]+)\s*\([\s\S]*?\$\$([\s\S]*?)\$\$;/g)]
}

describe('Restaurant Accounting P6 total shutdown', () => {
  it('keeps every former direct route on the explicit unavailable screen', () => {
    assert.match(app, /function RestaurantAccountingUnavailable/)
    for (const route of routes) {
      assert.match(app, new RegExp(`<Route path="restaurant/${route}" element=\\{<RestaurantOnlyRoute><RestaurantAccountingUnavailable`))
    }
  })

  it('does not package the Accounting renderer imports or expose its Electron APIs', () => {
    assert.doesNotMatch(app, /components\/restaurant-accounting\//)
    for (const namespace of apiNamespaces) {
      assert.ok(!preload.includes(namespace), `preload still exposes ${namespace}`)
      assert.ok(!main.includes(namespace), `main still registers ${namespace}`)
    }
  })

  it('removes Accounting entries and metadata from every operator navigation source', () => {
    for (const route of routes) {
      const path = `/restaurant/${route}`
      assert.ok(!desktopNav.includes(path), `desktop navigation retains ${path}`)
      assert.ok(!hposNav.includes(path), `HPOS navigation retains ${path}`)
      assert.ok(!manageHub.includes(path), `Manage Hub retains ${path}`)
    }
  })

  it('retains the earlier direct Accounting-table DML privilege guard', () => {
    assert.match(privilegeGuardSql, /has_table_privilege\('anon', r\.table_oid, 'INSERT'\)/)
    assert.match(privilegeGuardSql, /has_table_privilege\('authenticated', r\.table_oid, 'TRUNCATE'\)/)
    assert.match(privilegeGuardSql, /restaurant_bank_statement_imports/)
    assert.match(privilegeGuardSql, /restaurant_match_proposals/)
  })

  it('manifests every Accounting table and revokes all direct operator privileges', () => {
    assert.deepEqual(
      definedAccountingTableNames(accountingSql),
      new Set(accountingTableNames),
      'shutdown table manifest must equal the Accounting SQL table inventory'
    )
    for (const tableName of accountingTableNames) {
      assert.match(tableShutdownSql, new RegExp(`'${tableName}'`), `table shutdown omits ${tableName}`)
    }
    assert.match(tableShutdownSql, /revoke select, insert, update, delete, truncate, references, trigger on table %s from public, anon, authenticated/)
    assert.match(tableShutdownSql, /grant select, insert, update, delete, truncate, references, trigger on table %s to service_role/)
    for (const privilege of tablePrivileges) {
      assert.match(tableShutdownSql, new RegExp(`has_table_privilege\\('anon', r\\.table_oid, '${privilege}'\\)`))
      assert.match(tableShutdownSql, new RegExp(`has_table_privilege\\('authenticated', r\\.table_oid, '${privilege}'\\)`))
    }
    assert.match(tableShutdownSql, /has_column_privilege\('anon', c\.oid, a\.attname, 'SELECT'\)/)
    assert.match(tableShutdownSql, /has_column_privilege\('authenticated', c\.oid, a\.attname, 'REFERENCES'\)/)
  })

  it('drops legacy Accounting RLS policies instead of relying on lodge-only read access', () => {
    assert.match(tableShutdownSql, /from pg_policies/)
    assert.match(tableShutdownSql, /drop policy if exists %I on public\.%I/)
    assert.match(tableShutdownSql, /alter table %s enable row level security/)
    assert.doesNotMatch(tableShutdownSql, /create policy/i)
    assert.doesNotMatch(tableShutdownSql, /app_lodge_access/)
  })


  it('keeps the effective payroll-settings getter side-effect free and operator-inaccessible', () => {
    const getter = accountingFunctionBodies(driftGuardSql).find((match) => match[1] === 'get_restaurant_payroll_settings')
    assert.ok(getter, 'drift guard must redefine the payroll-settings getter')
    assert.doesNotMatch(getter[2], /\b(?:insert|update|delete|truncate)\b/i)
    assert.match(getter[2], /documented defaults without persisting them/)
    assert.match(driftGuardSql, /revoke all on function public\.get_restaurant_payroll_settings\(uuid\)/)
    assert.match(driftGuardSql, /has_function_privilege\('authenticated', 'public\.get_restaurant_payroll_settings\(uuid\)'::regprocedure, 'EXECUTE'\)/)
  })

  it('fails closed if Accounting policies, RLS, or operator privileges drift back', () => {
    assert.match(driftGuardSql, /from pg_policies/)
    assert.match(driftGuardSql, /not c\.relrowsecurity/)
    assert.match(driftGuardSql, /has_any_column_privilege\('authenticated'/)
    assert.match(driftGuardSql, /has_table_privilege\('authenticated'/)
    assert.match(driftGuardSql, /raise exception 'Restaurant Accounting RLS policies reappeared during shutdown'/)
  })
  it('manifests and revokes every Accounting RPC, including read-named functions', () => {
    const defined = definedAccountingRpcNames(accountingSql)
    assert.deepEqual(defined, new Set(accountingRpcNames), 'shutdown manifest must equal the Accounting SQL RPC inventory')
    for (const rpcName of accountingRpcNames) {
      assert.match(totalShutdownSql, new RegExp(`'${rpcName}'`), `total shutdown omits ${rpcName}`)
    }
    assert.match(totalShutdownSql, /has_function_privilege\('anon', p\.oid, 'EXECUTE'\)/)
    assert.match(totalShutdownSql, /has_function_privilege\('authenticated', p\.oid, 'EXECUTE'\)/)
    assert.match(totalShutdownSql, /revoke all on function %s from public, anon, authenticated/)
  })

  it('includes every SQL function with a data-changing body in the total shutdown manifest', () => {
    const manifest = new Set(accountingRpcNames)
    for (const match of accountingFunctionBodies(accountingSql)) {
      const [, name, body] = match
      if (/\b(?:insert|update|delete|truncate)\b/i.test(body)) {
        assert.ok(manifest.has(name), `${name} has a data-changing SQL body but is not shut down`)
      }
    }
    assert.ok(manifest.has('get_restaurant_payroll_settings'))
  })

  it('does not import Accounting domains through the production database facade', () => {
    for (const domain of accountingDomainFiles) {
      assert.ok(!databaseFacade.includes(`./domains/${domain}.js`), `database facade still imports ${domain}`)
    }
  })

  it('has no Accounting page chunks or main-process RPC strings after the production build', () => {
    const rendererAssets = join(root, 'out', 'hospitality-pos', 'renderer', 'assets')
    const mainBundle = join(root, 'out', 'hospitality-pos', 'main', 'index.js')
    assert.ok(existsSync(rendererAssets), 'Run the Restaurant & Bar production build before this check.')
    assert.ok(existsSync(mainBundle), 'Run the Restaurant & Bar production build before this check.')
    const rendererFiles = readdirSync(rendererAssets)
    for (const chunk of componentChunks) {
      assert.ok(!rendererFiles.some((file) => file.startsWith(chunk)), `production assets retain ${chunk}`)
    }
    const mainBundleSource = readFileSync(mainBundle, 'utf8')
    for (const rpcName of accountingRpcNames) {
      assert.ok(!mainBundleSource.includes(rpcName), `main bundle retains ${rpcName}`)
    }
  })
})