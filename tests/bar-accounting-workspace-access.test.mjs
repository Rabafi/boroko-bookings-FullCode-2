// Bar Accounting workspace client access: least-privilege production grants.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

const MIGRATION = 'supabase/migrations/20260924000000_accounting_workspace_client_access.sql'

test('workspace access migration replaces no-ship gates with capability checks', () => {
  const migration = read(MIGRATION)
  // No in-body service_role-only refusal may remain in the shipped surface.
  assert.doesNotMatch(migration, /service-role-only during no-ship/)
  // Replacements use the tenant-scoped fail-closed checker with matrix caps.
  assert.match(migration, /_restaurant_require_capability\(p_lodge_id, 'accounting\.read'\)/)
  assert.match(migration, /_restaurant_require_capability\(p_lodge_id, 'accounting\.export'\)/)
  assert.match(migration, /_restaurant_require_capability\(p_lodge_id, 'accounting\.payroll_view'\)/)
  assert.match(migration, /_restaurant_require_capability\(p_lodge_id, 'accounting\.payroll_export'\)/)
  assert.match(migration, /_restaurant_require_capability\(p_lodge_id, 'accounting\.payroll_manage'\)/)
  // Payroll artifact recording accepts either export capability.
  assert.match(migration, /accounting\.payroll_export'\)\) then/)
})

test('workspace access migration grants least privilege and nothing more', () => {
  const migration = read(MIGRATION)
  assert.match(migration, /^begin;/m)
  assert.match(migration, /^commit;/m)
  // Overload-proof grant loop: anon/public revoked, authenticated granted.
  assert.match(migration, /revoke all on function %s from anon, public/)
  assert.match(migration, /grant execute on function %s to authenticated/)
  // Never grants anon, never touches service_role, never embeds keys.
  assert.doesNotMatch(migration, /to anon/)
  assert.doesNotMatch(migration, /to authenticated, service_role/)
  assert.doesNotMatch(migration, /service_role.*key|key.*service_role/i)
  // Core workspace reads are in the grant surface.
  for (const name of [
    'get_restaurant_accounts', 'get_restaurant_ledger_workspace_v2',
    'get_restaurant_ap_workspace_v2', 'get_restaurant_bank_workspace_v2',
    'get_restaurant_tax_working_papers_v2', 'get_restaurant_budget_matrix_v2',
    'get_restaurant_financial_statements_v3', 'get_restaurant_payroll_workspace_v3',
    '_restaurant_require_capability', 'app_require_feature',
  ]) {
    assert.ok(migration.includes(`'${name}'`), `${name} must be in the grant surface`)
  }
  // Non-accounting report exports stay out (separate capability model).
  for (const name of [
    'get_starter_basic_report', 'get_lodge_operational_report_export_v2',
    'get_pos_financial_report_export_v2',
  ]) {
    assert.ok(!migration.includes(`'${name}'`), `${name} must stay out of this migration`)
  }
})

test('anon follow-up extends the identical gated surface to the desktop role', () => {
  const anon = read('supabase/migrations/20260924000001_accounting_workspace_anon_client_access.sql')
  assert.match(anon, /^begin;/m)
  assert.match(anon, /^commit;/m)
  // The desktop connects as anon with a session header; the wired
  // pre-request hook resolves identity per request.
  assert.match(anon, /grant execute on function %s to anon, authenticated/)
  assert.match(anon, /x-boroko-session/)
  assert.match(anon, /pgrst\.db_pre_request/)
  // Same grant surface as the base migration: no name may be added or dropped.
  const arrayOf = (sql) => {
    const m = sql.match(/names text\[\] := array\[(.*?)\];/s)
    assert.ok(m, 'grant array must be present')
    return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]).sort()
  }
  assert.deepEqual(arrayOf(anon), arrayOf(read(MIGRATION)))
  // Public stays revoked; service_role untouched; no keys embedded.
  assert.doesNotMatch(anon, /to public/)
  assert.doesNotMatch(anon, /service_role.*key|key.*service_role/i)
})

test('General ledger normalizes malformed server responses instead of crashing', () => {
  const ledger = read('src/renderer/src/components/restaurant-accounting/RestaurantGeneralLedger.jsx')
  assert.match(ledger, /normalizeWorkspace/)
  assert.match(ledger, /Array\.isArray\(source\.entries\)/)
  assert.match(ledger, /Array\.isArray\(source\.trial_balance\)/)
  assert.match(ledger, /Array\.isArray\(entry\?\.lines\)/)
  assert.match(ledger, /normalizeRows\(unwrap\(a/)
  // Every workspace write path normalizes, so the totals memo below always
  // reads arrays and can never throw into the recovery screen.
  assert.match(ledger, /useState\(normalizeWorkspace\(\)\)/)
  assert.match(ledger, /setWorkspace\(normalizeWorkspace\(unwrap\(w/)
  assert.match(ledger, /const next=normalizeWorkspace\(unwrap\(await accountingInvoke\('getLedgerPage'/)
  assert.doesNotMatch(ledger, /\.\.\.\(workspace\.entries\|\|/)
})

test('desktop accounting IPC map and migration grant surface agree', () => {
  const main = read('src/main/index.js')
  const migration = read(MIGRATION)
  // Spot-check IPC ops whose domain functions hit the newly opened RPCs.
  assert.match(main, /getAccounts: \['accounting\.read'/)
  assert.match(main, /exportChart: \['accounting\.export'/)
  assert.match(main, /exportPayrollRegister: \['accounting\.payroll_export'/)
  assert.match(main, /calculatePayroll: \['accounting\.payroll_manage'/)
  assert.ok(migration.includes("'get_restaurant_accounts'"))
  assert.ok(migration.includes("'get_restaurant_chart_export_v3'"))
  assert.ok(migration.includes("'get_restaurant_payroll_export_v3'"))
  assert.ok(migration.includes("'calculate_restaurant_payroll_v3'"))
})
