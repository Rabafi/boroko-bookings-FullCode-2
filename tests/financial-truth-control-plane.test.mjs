import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApprovedDisposableRestaurantRunnerEnvironment } from '../scripts/approved-disposable-restaurant-runner-env.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const plan = read('docs/BAR_AND_ACCOUNTING_FINANCIAL_TRUTH_REMEDIATION_PLAN.md')
const report = read('src/main/domains/reportExport.js')
const main = read('src/main/index.js')
const pwa = read('manager-pwa/src/lib/api.js')
const expenses = read('src/main/domains/expenses.js')
const pos = read('src/main/domains/pos.js')
const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
const receipt = read('src/renderer/src/components/shared/POSReceipt.jsx')
const reports = read('src/renderer/src/components/hospitality-pos/HposReports.jsx')
const expenseLifecycleSql = read('supabase/migrations/20260807220000_expense_lifecycle_and_source_policy.sql')
const stockEvidenceSql = read('supabase/migrations/20260807230000_inventory_movement_evidence_and_valuation.sql')
const payrollSettlementSql = read('supabase/migrations/20260807240000_payroll_payment_batches_and_idempotency.sql')
const payrollProvenanceSql = read('supabase/migrations/20260807250000_payroll_statutory_provenance_and_attendance.sql')
const linkedLintCleanupSql = read('supabase/migrations/20260807260000_financial_truth_linked_lint_cleanup.sql')
const expenseUi = read('src/renderer/src/components/hospitality-pos/HposExpenses.jsx')
const payrollUi = read('src/renderer/src/components/restaurant-accounting/RestaurantPayroll.jsx')
const preload = read('src/preload/index.js')
const disposableHarness = read('scripts/run-disposable-restaurant-tests.mjs')
const packageJson = read('package.json')

describe('Bar and Accounting financial-truth remediation evidence', () => {
  it('preserves the plan issue inventory', () => {
    const counts = { P0: 0, P1: 0, P2: 0 }
    for (const match of plan.matchAll(/\|\s*(?:[A-Z]+-\d+)\s*\|\s*(P[012])\s*\|/g)) counts[match[1]] += 1
    assert.deepEqual(counts, { P0: 20, P1: 63, P2: 2 })
  })

  it('provides an explicit disposable PostgreSQL behavioral-test harness', () => {
    assert.match(packageJson, /"test:restaurant:disposable"\s*:/)
    assert.match(disposableHarness, /buildApprovedDisposableRestaurantRunnerEnvironment/)
    assert.match(disposableHarness, /run-restaurant-suite\.mjs/)
    // The harness must fail closed before starting any child process or
    // database connection when the approved target is not configured.
    assert.match(disposableHarness, /no child process or database connection was started/)
  })

  it('fails the disposal guard closed for unapproved or incomplete targets without contacting a database', () => {
    // A marker that does not identify the approved disposable target is rejected.
    assert.throws(
      () => buildApprovedDisposableRestaurantRunnerEnvironment({ LUNA_REMEDIATION_TARGET_MARKER: 'not-the-approved-marker' }),
      /does not match the approved disposable target/
    )
    // Missing connection material blocks before any child process/DB connection.
    assert.throws(() => buildApprovedDisposableRestaurantRunnerEnvironment({}), /LUNA_REMEDIATION_TEST_DB_URL/)
    // A connection string naming the linked production project is explicitly denied.
    assert.throws(
      () => buildApprovedDisposableRestaurantRunnerEnvironment({
        LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://postgres.oicgpknsmtvcsjacymum:secret@aws-0-eu-west-1.pooler.supabase.co:5432/postgres',
        LUNA_REMEDIATION_LEDGER_STAFF_SESSION: 'session'
      }),
      /explicitly denied/
    )
    // An approved-shaped environment resolves the fixed guards and forwards
    // only allow-listed variables into the child environment.
    const { env, target } = buildApprovedDisposableRestaurantRunnerEnvironment({
      PATH: 'path-value',
      LUNA_REMEDIATION_TEST_DB_URL: 'postgresql://postgres.repsrmlomedqrmrdsbga:secret@aws-0-eu-west-1.pooler.supabase.co:5432/postgres',
      LUNA_REMEDIATION_LEDGER_STAFF_SESSION: 'session-value',
      UNRELATED_SECRET: 'must-not-pass-through'
    })
    assert.equal(target.project_ref, 'repsrmlomedqrmrdsbga')
    assert.equal(target.database, 'postgres')
    assert.equal(env.PATH, 'path-value')
    assert.equal(env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION, 'session-value')
    assert.equal(env.UNRELATED_SECRET, undefined)
  })

  it('has complete accounting export coverage and an authoritative manifest hash', () => {
    const pages = ['RestaurantAccountsPayable', 'RestaurantBalanceSheet', 'RestaurantBankReconciliation', 'RestaurantBudgets', 'RestaurantChartOfAccounts', 'RestaurantGeneralLedger', 'RestaurantPayroll', 'RestaurantTaxReturns']
    for (const page of pages) assert.match(read(`src/renderer/src/components/restaurant-accounting/${page}.jsx`), /AccountingExportButton/)
    assert.match(report, /canonical_dataset_hash/)
    assert.match(main, /recordReportArtifactResult|getPosFinancialReportExportV2|writePosHistoryExcelArtifact/)
    assert.doesNotMatch(main, /startReportRun:\s*\[/)
    assert.doesNotMatch(main, /completeReportRun:\s*\[/)
  })

  it('fails closed on incomplete financial reads instead of substituting cache as truth', () => {
    assert.match(expenses, /withReadMetadata\(cachedExpenses, 'cache', false\)/)
    assert.doesNotMatch(expenses, /falling back to cache/)
    assert.doesNotMatch(reports, /visibleRows\.slice\(0, 100\)/)
    assert.match(pwa, /legacy_estimate/)
  })

  it('keeps online receipts server-result-only and provisional offline documents distinct', () => {
    assert.match(terminal, /PROVISIONAL|provisional/)
    assert.doesNotMatch(terminal, /receiptOrder\s*=\s*\{[\s\S]*orderPayload\.total/)
    assert.match(receipt, /PROVISIONAL — PENDING SERVER CONFIRMATION/)
  })

  it('uses the same server contract for tab reads and POS report pagination', () => {
    assert.match(pos, /get_restaurant_pos_tabs_financial_truth/)
    assert.match(pos, /fetchAllPosRows/)
    assert.match(pos, /_complete/)
  })

  it('implements a retry-safe expense lifecycle without immediate client-side GL posting', () => {
    for (const functionName of ['submit_expense', 'approve_expense', 'post_expense', 'pay_expense', 'void_expense', 'reverse_expense']) {
      assert.match(expenseLifecycleSql, new RegExp(`create or replace function public\\.${functionName}`))
    }
    assert.match(expenseLifecycleSql, /restaurant_expense_operations/)
    assert.match(expenseLifecycleSql, /source_kind in \('direct','ap_bill','other'\)/)
    assert.match(expenseLifecycleSql, /Direct expenses require a receipt or evidence reference/)
    assert.match(expenseLifecycleSql, /AP-linked expenses must be posted through the AP bill workflow/)
    assert.match(expenseLifecycleSql, /_restaurant_post_journal/)
    assert.match(expenseUi, /runExpenseAction\('submit'/)
    assert.match(expenseUi, /expense\.status/)
    for (const action of ['submit', 'approve', 'post', 'pay', 'void', 'reverse']) assert.match(preload, new RegExp(`expenses:${action}`))
  })

  it('records stock source documents, operation evidence, and non-invented valuation state', () => {
    assert.match(stockEvidenceSql, /add column if not exists operation_id uuid/)
    assert.match(stockEvidenceSql, /source_document_type text/)
    assert.match(stockEvidenceSql, /valuation_method text/)
    assert.match(stockEvidenceSql, /unknown_legacy/)
    assert.match(stockEvidenceSql, /restaurant_inventory_movement_evidence_defaults/)
    assert.match(stockEvidenceSql, /get_inventory_financial_coverage/)
    assert.match(read('src/main/domains/inventory.js'), /derived-estimate/)
  })

  it('completes payroll through immutable export, settlement, reconciliation, and close', () => {
    for (const functionName of ['approve_restaurant_payroll_v3', 'export_restaurant_payroll_payments_v3', 'settle_restaurant_payroll_v3', 'reconcile_restaurant_payroll_settlement_v3', 'close_restaurant_payroll_v3']) {
      assert.match(payrollSettlementSql, new RegExp(`create or replace function public\\.${functionName}`))
    }
    assert.match(payrollSettlementSql, /restaurant_payroll_operations/)
    assert.match(payrollSettlementSql, /file_hash text/)
    assert.match(payrollSettlementSql, /control_total numeric/)
    assert.match(payrollSettlementSql, /Payroll must be settled and bank-reconciled before close/)
    assert.match(payrollUi, /runIdempotent\(`payroll-export:/)
    assert.match(payrollUi, /settlePayroll/)
    assert.match(payrollUi, /reconcilePayrollSettlement/)
    assert.match(payrollProvenanceSql, /source_reference text/)
    assert.match(payrollProvenanceSql, /source_document_hash text/)
    assert.match(payrollProvenanceSql, /set_restaurant_payroll_attendance_disposition_v3/)
    assert.match(payrollUi, /Attendance reconciliation/)
    assert.match(payrollUi, /Awaiting approval/)
  })

  it('keeps linked Manage projections schema-safe and retired financial RPCs fail closed', () => {
    for (const functionName of [
      'get_asset_cost_summary',
      'get_asset_dashboard',
      'set_asset_room_sellability',
      'get_task_assignments',
      'get_training_records',
      'get_shift_handovers',
      'get_staff_productivity_dashboard',
      'get_schedule_conflicts',
      'get_restaurant_bank_workspace_v2',
      'get_restaurant_bills',
      'create_restaurant_bill',
      'update_bill_items',
      'get_bill_payments',
      'record_corporate_payment',
    ]) assert.match(linkedLintCleanupSql, new RegExp(`create or replace function public\\.${functionName}`))
    assert.match(linkedLintCleanupSql, /proposed_at desc/)
    assert.match(linkedLintCleanupSql, /raw_user_meta_data/)
    assert.match(linkedLintCleanupSql, /for update of i/)
    for (const functionName of ['post_pos_sales_to_gl', 'auto_match_transactions', 'propose_bank_matches', 'calculate_payroll', 'get_tax_return_summary', 'get_restaurant_cash_flow_statement']) {
      assert.match(linkedLintCleanupSql, new RegExp(`create or replace function public\\.${functionName}[\\s\\S]{0,500}Legacy .* retired`))
    }
  })
})
