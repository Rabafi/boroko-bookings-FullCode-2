import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

async function run() {
  let passed = 0
  let failed = 0
  const failures = []

  function test(name, fn) {
    try {
      fn()
      passed++
      console.log(`  PASS: ${name}`)
    } catch (err) {
      failed++
      failures.push({ name, error: err.message })
      console.log(`  FAIL: ${name} — ${err.message}`)
    }
  }

  // ── Load source files ──────────────────────────────────────────────────────
  const reportExport = await read('src/main/domains/reportExport.js')
  const mainIndex = await read('src/main/index.js')
  const preload = await read('src/preload/index.js')
  const database = await read('src/main/database.js')
  const reportsJsx = await read('src/renderer/src/components/Reports.jsx')
  const migrationRepair = await read('supabase/migrations/20260620150000_detailed_reports_export_rpcs.sql')

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Source Code Structure
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n1. Source Code Structure')

  test('EXPORT_VERSION is exported', () => {
    assert.match(reportExport, /export const EXPORT_VERSION/)
  })

  test('loadDetailedReportData throws on RPC failure', () => {
    assert.match(reportExport, /throw new Error\(\s*`Detailed report export failed while loading/)
  })

  test('loadDetailedReportData tracks sources', () => {
    assert.match(reportExport, /sources\[key\] = 'server'/)
  })

  test('sanitizeCellValue preserves non-string types', () => {
    assert.match(reportExport, /if \(typeof value !== 'string'\) return value/)
  })

  test('sanitizeCellValue protects formula injection', () => {
    assert.ok(reportExport.includes('/^[=+\\-@]/'), 'Should have formula injection regex')
    assert.ok(reportExport.includes('/^-(?!\\d+'), 'Should have negative number regex')
  })

  test('deriveBookingPaymentMethod returns Mixed for multiple methods', () => {
    assert.match(reportExport, /return 'Mixed'/)
  })

  test('computeReconciliation reads from server RPC data', () => {
    assert.match(reportExport, /const serverRows = data\.reconciliation/)
  })

  test('computeReconciliation checks 5 controls', () => {
    assert.match(reportExport, /perBooking.*cash.*outstanding.*refund.*register/s)
  })

  test('Excel handler uses buffer approach', () => {
    assert.match(mainIndex, /XLSX\.write\(wb,\s*\{\s*type:\s*'buffer',\s*bookType:\s*'xlsx'\s*\}/)
  })

  test('Excel handler creates directory before writing', () => {
    assert.match(mainIndex, /fs\.mkdirSync\(dirname\(filePath\)/)
  })

  test('Excel handler verifies file after write', () => {
    assert.match(mainIndex, /fs\.existsSync\(filePath\) \|\| fs\.statSync\(filePath\)\.size === 0/)
  })

  test('Excel handler reopens workbook for verification', () => {
    assert.match(mainIndex, /XLSX\.read\(buffer,\s*\{\s*type:\s*'buffer'\s*\}\)/)
  })

  test('Excel handler always creates required sheets', () => {
    assert.match(mainIndex, /const requiredSheets = \['Report Info', 'Booking Register'/)
  })

  test('Preload exposes exportDetailedExcel', () => {
    assert.match(preload, /exportDetailedExcel/)
  })

  test('Preload exposes exportDetailedPDF', () => {
    assert.match(preload, /exportDetailedPDF/)
  })

  test('Reports.jsx calls exportDetailedExcel', () => {
    assert.match(reportsJsx, /exportDetailedExcel/)
  })

  test('Reports.jsx calls exportDetailedPDF', () => {
    assert.match(reportsJsx, /exportDetailedPDF/)
  })

  test('Reports.jsx passes only export parameters', () => {
    assert.match(reportsJsx, /startDate:\s*start/)
    assert.match(reportsJsx, /endDate:\s*end/)
  })

  test('database.js re-exports EXPORT_VERSION', () => {
    assert.match(database, /EXPORT_VERSION/)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Migration Validation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n2. Migration Validation')

  test('Migration uses CREATE OR REPLACE FUNCTION', () => {
    assert.match(migrationRepair, /CREATE OR REPLACE FUNCTION public\.get_booking_register_report/)
    assert.match(migrationRepair, /CREATE OR REPLACE FUNCTION public\.get_payment_transaction_report/)
    assert.match(migrationRepair, /CREATE OR REPLACE FUNCTION public\.get_cancelled_booking_report/)
    assert.match(migrationRepair, /CREATE OR REPLACE FUNCTION public\.get_refund_report/)
    assert.match(migrationRepair, /CREATE OR REPLACE FUNCTION public\.get_outstanding_balance_report/)
    assert.match(migrationRepair, /CREATE OR REPLACE FUNCTION public\.get_quotation_report/)
    assert.match(migrationRepair, /CREATE OR REPLACE FUNCTION public\.get_invoice_register_report/)
    assert.match(migrationRepair, /CREATE OR REPLACE FUNCTION public\.get_financial_exception_report/)
    assert.match(migrationRepair, /CREATE OR REPLACE FUNCTION public\.get_reconciliation_controls_report/)
  })

  test('Migration calls app_lodge_access in every RPC', () => {
    const appLodgeAccessCount = (migrationRepair.match(/public\.app_lodge_access\(p_lodge_id\)/g) || []).length
    assert.ok(appLodgeAccessCount >= 9, `Expected >= 9 app_lodge_access calls, found ${appLodgeAccessCount}`)
  })

  test('Migration validates date range (end < start)', () => {
    const dateValidationCount = (migrationRepair.match(/end_date cannot be before start_date/g) || []).length
    assert.ok(dateValidationCount >= 9, `Expected >= 9 date validations, found ${dateValidationCount}`)
  })

  test('Migration drops broken validate_lodge_access', () => {
    assert.match(migrationRepair, /DROP FUNCTION IF EXISTS public\.validate_lodge_access/)
  })

  test('Migration uses bookings.source not booking_source', () => {
    assert.doesNotMatch(migrationRepair, /\bb\.booking_source\b/)
    assert.match(migrationRepair, /b\.source/)
  })

  test('Migration uses bookings.cancel_reason not cancellation_reason', () => {
    assert.doesNotMatch(migrationRepair, /\bb\.cancellation_reason\b/)
    assert.match(migrationRepair, /b\.cancel_reason/)
  })

  test('Migration uses bookings.cancelled_at not updated_at for cancellation', () => {
    assert.match(migrationRepair, /b\.cancelled_at/)
  })

  test('Migration uses refund_approval_log.method not refund_method', () => {
    assert.doesNotMatch(migrationRepair, /\bpal\.refund_method\b/)
    assert.match(migrationRepair, /pal\.method/)
  })

  test('Migration uses quotations.customer_name not guest_name', () => {
    assert.doesNotMatch(migrationRepair, /\bq\.guest_name\b/)
    assert.match(migrationRepair, /q\.customer_name/)
  })

  test('Migration uses quotations.tax_amount not tax', () => {
    assert.doesNotMatch(migrationRepair, /\bq\.tax\b(?!_)/)
    assert.match(migrationRepair, /q\.tax_amount/)
  })

  test('Migration uses quotations.event_name not event_group_name', () => {
    assert.doesNotMatch(migrationRepair, /\bq\.event_group_name\b/)
    assert.match(migrationRepair, /q\.event_name/)
  })

  test('Migration joins quotations for quotation_number', () => {
    assert.match(migrationRepair, /LEFT JOIN public\.quotations q ON b\.quotation_id = q\.id/)
  })

  test('Migration joins customers for guest_email', () => {
    assert.match(migrationRepair, /COALESCE\(c\.email\)/)
  })

  test('Migration casts uuid columns to text', () => {
    assert.match(migrationRepair, /b\.booking_number::text/)
    assert.match(migrationRepair, /b\.created_by::text/)
    assert.match(migrationRepair, /p\.recorded_by::text/)
  })

  test('Migration REVOKEs from PUBLIC and anon', () => {
    const revokeCount = (migrationRepair.match(/REVOKE ALL ON FUNCTION.*FROM PUBLIC, anon/g) || []).length
    assert.ok(revokeCount >= 9, `Expected >= 9 REVOKE statements, found ${revokeCount}`)
  })

  test('Migration GRANTs to authenticated and service_role', () => {
    const grantCount = (migrationRepair.match(/GRANT EXECUTE ON FUNCTION.*TO authenticated, service_role/g) || []).length
    assert.ok(grantCount >= 9, `Expected >= 9 GRANT statements, found ${grantCount}`)
  })

  test('Migration uses invoices.issued_at for invoice date', () => {
    assert.match(migrationRepair, /invoice_latest/)
  })

  test('Migration derives delivery_status from invoice_delivery_log', () => {
    assert.match(migrationRepair, /delivery_latest/)
    assert.match(migrationRepair, /idl\.delivery_status/)
    assert.doesNotMatch(migrationRepair, /idl\.status/)
  })

  test('Migration avoids unsupported UUID MIN aggregates', () => {
    assert.doesNotMatch(migrationRepair, /MIN\(b\.(customer_id|room_id|quotation_id)\)/)
  })

  test('Event rows retain booking, invoice, quotation, ledger and payment-method detail', () => {
    assert.match(migrationRepair, /booking_numbers/)
    assert.match(migrationRepair, /invoice_numbers/)
    assert.match(migrationRepair, /quotation_numbers/)
    assert.match(migrationRepair, /SUM\(COALESCE\(bp\.net_paid, 0\)\)/)
    assert.match(migrationRepair, /ge\.payment_methods/)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Financial Semantics
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n3. Financial Semantics')

  test('Booking register uses signed sum (net_paid)', () => {
    assert.match(migrationRepair, /COALESCE\(SUM\(p\.amount\), 0\) AS net_paid/)
  })

  test('Booking register derives payment method from positive payments only', () => {
    assert.match(migrationRepair, /CASE WHEN p\.amount > 0 THEN p\.method END/)
  })

  test('Payment method returns Mixed for multiple methods', () => {
    assert.match(migrationRepair, /WHEN bp\.positive_methods LIKE '%,%' THEN 'Mixed'/)
  })

  test('Outstanding balance uses signed ledger', () => {
    assert.match(migrationRepair, /COALESCE\(SUM\(p\.amount\), 0\) AS net_paid/)
  })

  test('Cancelled booking uses cancelled_at not updated_at', () => {
    assert.match(migrationRepair, /b\.cancelled_at >=/)
  })

  test('Refund report uses persisted retained_percent', () => {
    assert.match(migrationRepair, /COALESCE\(pal\.retained_percent, 0\)/)
  })

  test('Financial exception checks amount_paid vs signed ledger', () => {
    assert.match(migrationRepair, /SUM\(p\.amount\) AS net_ledger/)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Reconciliation Controls
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n4. Reconciliation Controls')

  test('Per-booking ledger reconciliation control exists', () => {
    assert.match(migrationRepair, /Per-booking ledger reconciliation/)
  })

  test('Cash reconciliation control exists', () => {
    assert.match(migrationRepair, /Cash reconciliation/)
  })

  test('Outstanding reconciliation control exists', () => {
    assert.match(migrationRepair, /Outstanding reconciliation/)
    assert.match(migrationRepair, /get_outstanding_balance_report/)
    assert.doesNotMatch(migrationRepair, /v_outstanding,\s*v_outstanding,\s*0,\s*'PASSED'/)
  })

  test('Refund reconciliation control exists', () => {
    assert.match(migrationRepair, /Refund reconciliation/)
  })

  test('Booking register gross reconciliation control exists', () => {
    assert.match(migrationRepair, /Booking register gross total/)
    assert.match(migrationRepair, /get_booking_register_report/)
    assert.doesNotMatch(migrationRepair, /v_booking_summary_gross := v_booking_register_gross/)
  })

  test('Reconciliation uses RECONCILIATION FAILED for variances', () => {
    assert.match(migrationRepair, /RECONCILIATION FAILED/)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Excel Handler Structure
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n5. Excel Handler Structure')

  test('Excel handler has addSheetWithFormatting helper', () => {
    assert.match(mainIndex, /function addSheetWithFormatting\(sheetName, aoa/)
  })

  test('Excel handler has addEmptySheet helper', () => {
    assert.match(mainIndex, /function addEmptySheet\(sheetName, meta, headers\)/)
  })

  test('Excel handler applies column widths', () => {
    assert.match(mainIndex, /sheet\['!cols'\] = widths/)
  })

  test('Excel handler applies freeze panes', () => {
    assert.match(mainIndex, /sheet\['!freeze'\]/)
  })

  test('Excel handler applies autofilter', () => {
    assert.match(mainIndex, /sheet\['!autofilter'\]/)
    assert.match(mainIndex, /s:\s*\{\s*r:\s*headerRow/)
  })

  test('Excel handler emits typed dates and financial number formats', () => {
    assert.match(mainIndex, /cell\.t = 'd'/)
    assert.match(mainIndex, /#,##0\.00;\[Red\]-#,##0\.00/)
  })

  test('Excel handler creates Report Info sheet', () => {
    assert.match(mainIndex, /addSheetWithFormatting\('Report Info'/)
  })

  test('Excel handler creates Booking Register sheet', () => {
    assert.match(mainIndex, /addSheetWithFormatting\('Booking Register'/)
  })

  test('Excel handler creates Payment Transactions sheet', () => {
    assert.match(mainIndex, /addSheetWithFormatting\('Payment Transactions'/)
  })

  test('Excel handler creates Outstanding Balances sheet', () => {
    assert.match(mainIndex, /addSheetWithFormatting\('Outstanding Balances'/)
  })

  test('Excel handler creates Cancelled Bookings sheet', () => {
    assert.match(mainIndex, /addSheetWithFormatting\('Cancelled Bookings'/)
  })

  test('Excel handler creates Refunds sheet', () => {
    assert.match(mainIndex, /addSheetWithFormatting\('Refunds'/)
  })

  test('Excel handler creates Quotations sheet', () => {
    assert.match(mainIndex, /addSheetWithFormatting\('Quotations'/)
  })

  test('Excel handler creates Invoice Register sheet', () => {
    assert.match(mainIndex, /addSheetWithFormatting\('Invoice Register'/)
  })

  test('Excel handler creates Financial Exceptions sheet', () => {
    assert.match(mainIndex, /addSheetWithFormatting\('Financial Exceptions'/)
  })

  test('Excel handler creates Reconciliation sheet', () => {
    assert.match(mainIndex, /addSheetWithFormatting\('Reconciliation'/)
  })

  test('Excel handler includes reconciliation controls in Report Info', () => {
    assert.match(mainIndex, /Per-booking ledger.*cash.*outstanding.*refund.*register/s)
  })

  test('Excel handler uses EXPORT_VERSION from reportExport', () => {
    assert.match(mainIndex, /db\.EXPORT_VERSION/)
  })

  test('Empty sheets get "No records" row', () => {
    assert.match(mainIndex, /No records for this period/)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. PDF Handler Structure
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n6. PDF Handler Structure')

  test('PDF handler supports bookings tab', () => {
    assert.match(mainIndex, /reportType === 'bookings' && data\.bookings\.length > 0/)
  })

  test('PDF handler supports expenses tab', () => {
    assert.match(mainIndex, /reportType === 'expenses'/)
  })

  test('PDF handler supports pos tab', () => {
    assert.match(mainIndex, /reportType === 'pos'/)
  })

  test('PDF handler supports costs tab', () => {
    assert.match(mainIndex, /reportType === 'costs'/)
  })

  test('PDF handler supports pl tab', () => {
    assert.match(mainIndex, /reportType === 'pl'/)
  })

  test('PDF handler uses landscape for all tabs', () => {
    assert.match(mainIndex, /landscape:\s*true/)
  })

  test('PDF handler loads expenses data for expenses tab', () => {
    assert.match(mainIndex, /getExpenses.*startDate.*endDate/)
  })

  test('PDF handler loads POS data for pos tab', () => {
    assert.match(mainIndex, /getPosOrders.*startDate.*endDate/)
  })

  test('PDF handler loads cost data for costs tab', () => {
    assert.match(mainIndex, /getAllInventoryPurchases/)
    assert.match(mainIndex, /getAllSupplyPurchases/)
  })

  test('PDF handler loads P&L data for pl tab', () => {
    assert.match(mainIndex, /getProfitLoss\(startDate,\s*endDate\)/)
  })

  test('PDF handler calls existing report domains with their real signatures', () => {
    assert.match(mainIndex, /getExpenses\(startDate,\s*endDate,\s*outletLabel \|\| 'all'\)/)
    assert.match(mainIndex, /getMaintenanceRowsForPeriod\(startDate,\s*endDate\)/)
    assert.match(mainIndex, /getPosOrders\(startDate,\s*endDate,\s*outletLabel \|\| null\)/)
    assert.match(mainIndex, /getPosRevenueSummary\(startDate,\s*endDate,\s*outletLabel \|\| 'all'\)/)
    assert.doesNotMatch(mainIndex, /getExpenses\(state\.lodgeId,\s*startDate/)
  })

  test('Cost PDF uses persisted purchase field names', () => {
    assert.match(mainIndex, /p\.date \|\| ''/)
    assert.match(mainIndex, /p\.quantity_purchased/)
  })

  test('PDF includes page numbering', () => {
    assert.match(mainIndex, /displayHeaderFooter:\s*true/)
    assert.match(mainIndex, /class="pageNumber"/)
  })

  test('PDF builder has date basis for expenses', () => {
    assert.match(mainIndex, /expenses: 'Expense date within/)
  })

  test('PDF builder has date basis for pos', () => {
    assert.match(mainIndex, /pos: 'POS order completion/)
  })

  test('PDF builder has date basis for costs', () => {
    assert.match(mainIndex, /costs: 'Purchase date within/)
  })

  test('PDF builder has date basis for pl', () => {
    assert.match(mainIndex, /pl: 'Profit & Loss for/)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Cross-cutting Concerns
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n7. Cross-cutting Concerns')

  test('No direct amount_paid updates in export code', () => {
    assert.doesNotMatch(reportExport, /\.update\('bookings'[\s\S]*amount_paid/)
  })

  test('No frontend-derived payment_status in export code', () => {
    assert.doesNotMatch(reportExport, /payment_status.*=.*frontend/)
  })

  test('All export functions are read-only (no INSERT/UPDATE/DELETE)', () => {
    assert.doesNotMatch(reportExport, /\.insert\(/)
    assert.doesNotMatch(reportExport, /\.update\(/)
    assert.doesNotMatch(reportExport, /\.delete\(/)
  })

  test('Reports.jsx page design preserved (tabs, header, export buttons)', () => {
    assert.match(reportsJsx, /handleSaveExcel/)
    assert.match(reportsJsx, /handleSavePDF/)
    assert.match(reportsJsx, /exportDetailedExcel/)
    assert.match(reportsJsx, /exportDetailedPDF/)
  })

  test('No navigation changes in Reports.jsx', () => {
    assert.doesNotMatch(reportsJsx, /useNavigate.*Reports/)
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(60))
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  if (failures.length > 0) {
    console.log('\nFailed tests:')
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.error}`)
    }
  }
  console.log('='.repeat(60))

  if (failed > 0) process.exitCode = 1
}

run().catch((error) => {
  console.error('detailed-reports-repair-regression: fatal error')
  console.error(error?.stack || error)
  process.exitCode = 1
})
