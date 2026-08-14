import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = name => fs.readFileSync(path.join(root,name),'utf8')
const coverage = read('supabase/migrations/20260807530000_financial_source_expected_rows_and_accounting_lockdown.sql')
const statements = read('supabase/migrations/20260807540000_statement_finality_and_cash_flow_classification.sql')
const bank = read('supabase/migrations/20260807550000_bank_match_allocation_workspace.sql')
const main = read('src/main/index.js')
const bankUi = read('src/renderer/src/components/restaurant-accounting/RestaurantBankReconciliation.jsx')
const accountingUi = read('src/renderer/src/components/restaurant-accounting/RestaurantAccountingUi.jsx')

test('Accounting renderer cannot invoke caller-authored generic report completion', () => {
  assert.doesNotMatch(main, /startReportRun:\s*\[/)
  assert.doesNotMatch(main, /completeReportRun:\s*\[/)
  assert.match(coverage, /start_restaurant_report_run/)
  assert.match(coverage, /complete_restaurant_report_run/)
  assert.match(coverage, /service_role/)
})

test('source coverage counts authoritative populations and fails on missing postings', () => {
  assert.match(coverage, /restaurant_financial_source_snapshot/)
  assert.match(coverage, /expected_rows/)
  assert.match(coverage, /authoritative source rows are missing/)
  assert.match(coverage, /posting_source_types/)
  for (const source of ['pos_sale','pos_return','direct_expense','ap_bill','inventory_receipt','cashup_variance','payroll_accrual','tax_adjustment','manual_journal']) {
    assert.match(coverage, new RegExp("'" + source + "'"))
  }
})

test('statement finality has distinct fail-closed controls', () => {
  for (const field of ['dataset_complete','source_coverage_complete','balanced','cash_flow_complete','period_status','financially_final']) {
    assert.match(statements, new RegExp("'" + field + "'"))
  }
  assert.match(statements, /draft_uncLOSED/)
  assert.match(statements, /period_not_closed/)
  assert.match(statements, /cash_flow_unclassified_or_missing/)
  assert.match(statements, /cash_flow_classification='cash'/)
})

test('Accounting lockdown excludes generic operational reports while retaining service-role grants', () => {
  assert.match(coverage, /Generic POS\/lodge operational report RPCs are deliberately excluded/)
  assert.match(coverage, /grant execute on function %s to service_role/)
  assert.doesNotMatch(coverage, /get_pos_financial_report_export_v2/)
  assert.doesNotMatch(coverage, /get_lodge_operational_report_export_v2/)
})

test('bank reconciliation uses locked allocation callers and fail-closed Accounting pages', () => {
  assert.match(bank, /get_bank_match_candidates_v1/)
  assert.match(bank, /restaurant_bank_match_allocations/)
  assert.match(bank, /restaurant_bank_match_operations/)
  assert.match(bank, /where signed_amount is null/)
  assert.match(bank, /operation ID conflicts with a different payload/)
  assert.match(bank, /m\.status in \('proposed', 'approved'\)/)
  assert.match(bank, /revoke all on function public\.get_bank_match_candidates_v1/)
  assert.match(main, /getBankCandidates: \['accounting\.read'/)
  assert.match(main, /proposeBankAllocation: \['accounting\.bank_approve'/)
  assert.match(main, /reviewBankAllocation: \['accounting\.bank_approve'/)
  assert.doesNotMatch(main, /proposeBank:\s*\[/)
  assert.doesNotMatch(main, /reviewBank:\s*\[/)
  assert.doesNotMatch(bankUi, /accountingInvoke\('proposeBank'/)
  assert.doesNotMatch(bankUi, /accountingInvoke\('reviewBank'/)
  assert.match(bankUi, /getBankCandidates/)
  assert.match(bankUi, /proposeBankAllocation/)
  assert.match(bankUi, /reviewBankAllocation/)
  assert.match(bankUi, /runIdempotent\(`bank-match:/)
  assert.match(accountingUi, /readiness\?\.active === true && readiness\?\.ready === true/)
  assert.match(accountingUi, /product entitlement and the server release-readiness gate/)
})
