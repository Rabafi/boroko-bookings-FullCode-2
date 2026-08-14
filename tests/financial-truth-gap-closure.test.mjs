import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { adaptLegacyPosOrderFinancialPayload } from '../src/main/domains/syncShared.js'

const root = join(process.cwd())
const read = (file) => readFileSync(join(root, file), 'utf8')
const gap = read('supabase/migrations/20260807270000_financial_truth_gap_closure.sql')
const ledger = read('supabase/migrations/20260807280000_ledger_tax_bank_close_and_manual_workflows.sql')
const tax = read('supabase/migrations/20260807290000_tax_detail_and_reconciliation_packets.sql')
const bank = read('supabase/migrations/20260807300000_bank_evidence_lock_and_packet_export.sql')
const inventory = read('supabase/migrations/20260807310000_inventory_purchase_and_stocktake_gl_posting.sql')
const expense = read('supabase/migrations/20260807320000_expense_tax_detail_posting.sql')
const settlement = read('supabase/migrations/20260807330000_settlement_source_gl_posting.sql')
const cashup = read('supabase/migrations/20260807340000_cashup_variance_source_gl_posting.sql')
const taxLifecycle = read('supabase/migrations/20260807350000_tax_amendment_and_adjustment_lifecycle.sql')
const taxRead = read('supabase/migrations/20260807360000_tax_adjustment_review_read.sql')
const pageExports = read('supabase/migrations/20260807370000_accounting_page_exports.sql')
const posTenderGuard = read('supabase/migrations/20260807380000_pos_account_voucher_atomic_tender_guard.sql')
const domain = read('src/main/domains/restaurantAccountingV2.js')
const main = read('src/main/index.js')

test('gap closure contains the source coverage matrix and draft-only expense compatibility override', () => {
  assert.match(gap, /restaurant_financial_source_scope/)
  for (const source of ['pos_order', 'expense', 'expense_payment', 'ap_bill', 'ap_payment', 'payroll', 'payroll_settlement', 'inventory_purchase', 'inventory_stocktake']) assert.match(gap, new RegExp(`'${source}'`))
  assert.match(gap, /status, operation_id, payload_hash, evidence_ref, source_kind/)
  assert.match(gap, /'draft'/)
  assert.doesNotMatch(gap, /_restaurant_post_journal\(/)
  assert.match(gap, /grant execute on function public\.get_restaurant_financial_source_coverage[\s\S]*authenticated, service_role/)
})

test('ledger page and manual journal contracts are complete and server-enforced', () => {
  assert.match(ledger, /get_restaurant_ledger_workspace_page_v2/)
  assert.match(ledger, /entry_date desc, created_at desc, entry_id desc/)
  assert.match(ledger, /total_count/)
  assert.match(ledger, /get_restaurant_ledger_export_v2/)
  assert.match(ledger, /complete', true/)
  for (const name of ['create_restaurant_manual_journal_draft', 'submit_restaurant_manual_journal', 'approve_restaurant_manual_journal', 'post_restaurant_manual_journal']) assert.match(ledger, new RegExp(`create or replace function public\\.${name}`))
  assert.match(ledger, /maker cannot approve/)
  assert.match(ledger, /evidence_ref text not null/)
  assert.match(domain, /getRestaurantLedgerPageV2/)
  assert.match(main, /createManualJournalDraft/)
})

test('tax arithmetic is driven by explicit line allocations and detects stale sources', () => {
  assert.match(tax, /restaurant_tax_detail_allocations/)
  assert.match(tax, /tax_treatment in \('taxable','zero_rated','exempt','out_of_scope','unknown'\)/)
  assert.match(tax, /taxable_base numeric/)
  assert.match(tax, /source_manifest_hash/)
  assert.match(tax, /_restaurant_tax_return_is_stale/)
  assert.match(tax, /stale; regenerate before review/)
  assert.match(tax, /get_restaurant_tax_filing_packet_v2/)
  assert.doesNotMatch(tax, /account_type in\('expense','asset'\)/)
})

test('bank reconciliation has statement closing evidence, row-level adjustments, and no period lock', () => {
  assert.match(bank, /statement_transaction_id uuid/)
  assert.match(bank, /evidence_ref text/)
  assert.match(bank, /statement_hash is derived/)
  assert.match(bank, /opening plus movements do not reproduce/)
  assert.match(bank, /Entered statement closing balance does not match imported balance_after evidence/)
  assert.match(bank, /period_lock_created',false/)
  assert.match(bank, /restaurant_bank_reconciliation_packets_immutable/)
  assert.match(bank, /get_restaurant_bank_reconciliation_packet_v2/)
})

test('inventory and expenses post explicit source, subledger, and GL entries after activation', () => {
  assert.match(inventory, /create or replace function public\.add_inventory_purchase/)
  assert.match(inventory, /record_restaurant_source_posting\(v_lodge_id,'inventory_purchase'/)
  assert.match(inventory, /record_restaurant_source_posting\(p_lodge_id,'inventory_stocktake'/)
  assert.match(inventory, /Input tax/)
  assert.match(expense, /create or replace function public\.post_expense/)
  assert.match(expense, /record_restaurant_source_posting\(p_lodge_id,'expense'/)
  assert.match(expense, /v_tax_account/)
})

test('settlements clear tender batches to bank atomically and coverage is post-cutover complete', () => {
  assert.match(settlement, /fee_amount numeric/)
  assert.match(settlement, /settlement-clearing asset mapping/)
  assert.match(settlement, /_restaurant_post_journal\(/)
  assert.match(settlement, /record_restaurant_source_posting\(\s*v_lodge_id, 'settlement'/)
  assert.match(settlement, /match_restaurant_settlement_to_bank_transaction/)
  assert.match(settlement, /payroll_settlement/)
  assert.match(settlement, /v_effective_from/)
  assert.match(settlement, /get_restaurant_ledger_workspace_v2/)
  assert.match(domain, /matchRestaurantSettlementToBankTransactionV2/)
  assert.match(main, /matchSettlementToBank/)
})

test('cash-up differences post only variance and fail closed on missing mappings', () => {
  assert.match(cashup, /mapping_type_cashup_chk/)
  assert.match(cashup, /'cash_variance'/)
  assert.match(cashup, /Cash-over mappings require a revenue account/)
  assert.match(cashup, /Cash-short mappings require an expense account/)
  assert.match(cashup, /create or replace function public\.finalize_pos_shift_cashup_v2/)
  assert.match(cashup, /'cashup'/)
  assert.match(cashup, /record_restaurant_source_posting\(/)
  assert.match(cashup, /Non-zero cash-up variance has no posted cash-over\/short source record/)
  assert.match(cashup, /Cash-up variance/)
  assert.match(cashup, /cash-up posts only the difference/i)
})

test('tax amendments and debit-credit adjustments are governed and reproducible', () => {
  assert.match(taxLifecycle, /restaurant_tax_adjustments/)
  assert.match(taxLifecycle, /record_restaurant_tax_adjustment/)
  assert.match(taxLifecycle, /approve_restaurant_tax_adjustment/)
  assert.match(taxLifecycle, /create_restaurant_tax_amendment/)
  assert.match(taxLifecycle, /generate_restaurant_tax_amendment_working_paper/)
  assert.match(taxLifecycle, /amendment_operation_id/)
  assert.match(taxLifecycle, /source_manifest_hash/)
  assert.match(taxLifecycle, /Credit notes reverse their direction/)
  assert.match(taxLifecycle, /amendment_of is null/)
  assert.match(taxLifecycle, /Tax adjustment preparer cannot approve/)
  assert.match(taxRead, /get_restaurant_tax_adjustments/)
  assert.match(domain, /getRestaurantTaxAdjustmentsV2/)
  assert.match(main, /getTaxAdjustments/)
})

test('every Accounting page export is server-authoritative and report-run backed', () => {
  for (const rpc of [
    'get_restaurant_chart_export_v2',
    'get_restaurant_ledger_report_export_v2',
    'get_restaurant_ap_export_v2',
    'get_restaurant_bank_export_v2',
    'get_restaurant_tax_export_v2',
    'get_restaurant_budget_export_v2',
    'get_restaurant_statements_export_v2',
    'get_restaurant_payroll_export_v2',
  ]) assert.match(pageExports, new RegExp(`create or replace function public\\.${rpc}`))
  assert.match(pageExports, /start_restaurant_report_run/)
  assert.match(pageExports, /complete_restaurant_report_run/)
  assert.match(pageExports, /fail_restaurant_report_run/)
  assert.match(pageExports, /data_hash/)
  assert.match(pageExports, /row_count/)
  for (const envelopeField of ['schema_version', 'report_type', 'data_cutoff', 'business_timezone', 'source_mode', 'status', 'control_totals', 'reconciliations', 'dataset_hash', 'export_manifest']) assert.match(pageExports, new RegExp(`'${envelopeField}'`))
  assert.match(pageExports, /income_statement'->'revenue/)
  assert.match(pageExports, /balance_sheet'->'accounts/)
  assert.match(pageExports, /restaurant_accounting_is_active/)
  assert.match(pageExports, /Accounting is not activated for this lodge/)
  for (const operation of ['exportChart', 'exportLedgerReport', 'exportAp', 'exportBank', 'exportTax', 'exportBudgets', 'exportStatements', 'exportPayrollRegister']) assert.match(main, new RegExp(`${operation}:`))
})

test('accounting file exports preserve complete source data across JSON, XLSX, CSV and PDF', () => {
  assert.match(main, /restaurantAccountingV2:exportFile/)
  for (const format of ['json', 'xlsx', 'csv', 'pdf']) assert.match(main, new RegExp(`ACCOUNTING_EXPORT_FILE_FORMATS.*${format}|format === '${format}'`))
  assert.match(main, /flattenAccountingExportValue/)
  assert.match(main, /buildAccountingExportCsv/)
  assert.match(main, /Companion detailed file/)
  assert.match(main, /assertCompleteAccountingExport/)
  assert.match(main, /reportRunId.*dataHash.*fileHash/)
  assert.match(read('src/preload/index.js'), /restaurantAccountingV2:[\s\S]*exportFile/)
  assert.match(read('src/renderer/src/components/restaurant-accounting/RestaurantAccountingUi.jsx'), /\['json', 'xlsx', 'csv', 'pdf'\]/)
})

test('POS history exports fail closed on cache, pending, or swallowed source data', () => {
  assert.match(main, /assertCompletePosHistoryExport\(orders, voidHistory, localOrders\)/g)
  assert.doesNotMatch(main, /getPosVoidHistory\(start, end, outletFilter\)\.catch\(\(\) => \[\]\)/)
  assert.match(main, /POS history export is blocked because the order source is not server-complete/)
  assert.match(main, /itemRows = orders\.flatMap\(/)
  assert.match(main, /getPosFinancialReportExportV2/)
  assert.match(main, /dataset_status !== 'certified'/)
  assert.match(main, /XLSX\.read\(fs\.readFileSync\(filePath\)/)
  assert.match(main, /writePosHistoryPdfArtifact/)
  assert.match(read('src/main/posHistoryExportArtifacts.js'), /reopened\.SheetNames/)
})

test('Business Control never treats a fulfilled cache or provisional POS source as complete', () => {
  const control = read('src/renderer/src/components/hospitality-pos/HposBusinessControl.jsx')
  assert.match(control, /result\._complete !== true/)
  assert.match(control, /result\._source !== 'server'/)
  assert.match(control, /sourceComplete=\{sourceWarnings\.length === 0\}/)
  assert.match(control, /sourceComplete \? money\(/)
})

test('POS account and voucher tenders are atomic, activation-gated, and queue-compatible', () => {
  assert.match(posTenderGuard, /guard_pos_account_voucher_tender_envelope/)
  assert.match(posTenderGuard, /restaurant_accounting_is_active\(new\.lodge_id\)/)
  assert.match(posTenderGuard, /customer_id in payment_breakdown/)
  assert.match(posTenderGuard, /voucher_id or code in payment_breakdown/)
  assert.match(posTenderGuard, /before insert or update of payment_method, payment_breakdown/)

  const posUi = read('src/renderer/src/components/POS.jsx')
  assert.match(posUi, /effectivePaymentMethod[\s\S]*\? 'account'/)
  assert.match(posUi, /customer_id: selectedCustomerId/)
  assert.match(posUi, /method: 'voucher'/)
  assert.match(posUi, /code: voucherTenderCode/)
  assert.doesNotMatch(posUi, /window\.api\.pos\.redeemVoucher/)

  const syncShared = read('src/main/domains/syncShared.js')
  const legacyPayloads = read('legacy-pos/src/shared/payloads.js')
  const legacyMain = read('legacy-pos/src/main/index.js')
  assert.match(syncShared, /adaptLegacyPosOrderFinancialPayload/)
  assert.match(syncShared, /next\.data\.payload = adaptLegacyPosOrderFinancialPayload/)
  assert.match(legacyPayloads, /customer_id: input\.customer_id/)
  assert.match(legacyPayloads, /customer_account_charge: input\.customer_account_charge/)
  assert.match(legacyMain, /authoritativeReplayPayload/)
  assert.match(legacyMain, /adaptLegacyPosOrderFinancialPayload\(replayPayload\?\.payload\)/)
  assert.match(read('supabase/migrations/20260807180000_typed_mappings_and_period_close.sql'), /restaurant_voucher_ledger/)
  assert.match(read('supabase/migrations/20260807180000_typed_mappings_and_period_close.sql'), /restaurant_account_ledger/)
})

test('legacy queued account intent is promoted without rotating its sale identity', () => {
  const payload = {
    id: 'order-1',
    create_idempotency_key: 'pos-order:intent-1',
    total: 125,
    payment_method: 'cash',
    payment_breakdown: [{ method: 'cash', amount: 125 }],
    customer_account_charge: { customer_id: 'customer-1', amount: 125 }
  }
  const adapted = adaptLegacyPosOrderFinancialPayload(payload)
  assert.equal(adapted.id, payload.id)
  assert.equal(adapted.create_idempotency_key, payload.create_idempotency_key)
  assert.deepEqual(adapted.payment_breakdown, [{ method: 'account', amount: 125, customer_id: 'customer-1', reference: null }])
  assert.equal(adapted.payment_method, 'account')
})

test('full data exports fail closed for financial gaps and label allowed partial snapshots', () => {
  assert.match(main, /FINANCIAL_EXPORT_SECTIONS = new Set/)
  assert.match(main, /requiresComplete: .*FINANCIAL_EXPORT_SECTIONS\.has/)
  assert.match(main, /schema_version: 'data-export-manifest-v1'/)
  assert.match(main, /XLSX\.utils\.book_append_sheet\(wb, XLSX\.utils\.json_to_sheet\(manifestRows\), 'Export Manifest'\)/)
  assert.match(main, /Financial export blocked: the authoritative snapshot is INCOMPLETE/)
  assert.match(main, /complete: data\.exportManifest\?\.completeness === 'COMPLETE'/)

  const dataUi = read('src/renderer/src/components/DataManagement.jsx')
  assert.match(dataUi, /Export incomplete — review the Export Manifest sheet/)
  assert.match(dataUi, /result\.exportManifest\?\.errors\?\.length/)
})

test('full data exports use paged readers instead of capped screen queries', () => {
  assert.match(main, /getInventoryMovements', \{ start_date: normalized\.startDate, end_date: normalized\.endDate, export_all: true \}/)
  assert.match(read('src/main/domains/conference.js'), /\.range\(from, from \+ 499\)/)
  assert.match(read('src/main/domains/pool.js'), /\.range\(from, from \+ 499\)/)
  assert.match(read('src/main/domains/inventory.js'), /const exportAll = filters\?\.export_all === true/)
  assert.match(read('src/main/domains/inventory.js'), /for \(let from = 0; from < maxRows; from \+= pageSize\)/)
  assert.match(main, /getInventoryItems', \{ export_all: true \}/)
  assert.match(main, /getSupplyItems', \{ export_all: true \}/)
  assert.match(read('src/main/domains/inventory.js'), /getInventoryItems:\$\{exportAll \? 'export' : 'screen'\}/)
  assert.match(read('src/main/domains/supplies.js'), /getSupplyItems:\$\{exportAll \? 'export' : 'screen'\}/)
  assert.match(read('src/main/domains/supplies.js'), /from\('supply_purchases'\)[\s\S]*?\.\s*range\(from, from \+ 499\)/)
  assert.match(read('src/main/domains/bookings.js'), /const loadRows = async \(table, select, orderColumn/)
})
