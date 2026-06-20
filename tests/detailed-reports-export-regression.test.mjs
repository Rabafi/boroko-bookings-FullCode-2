import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')

async function read(path) {
  return readFile(join(rootDir, path), 'utf8')
}

async function run() {
  console.log('Running detailed reports export regression tests...\n')
  let passed = 0
  let failed = 0

  function test(name, fn) {
    try {
      fn()
      passed++
      console.log(`  PASS: ${name}`)
    } catch (e) {
      failed++
      console.error(`  FAIL: ${name}`)
      console.error(`    ${e.message}`)
    }
  }

  // ── 1. Source Code Structural Tests ────────────────────────────────────────
  console.log('\n1. Source Code Structure')

  const mainIndex = await read('src/main/index.js')
  const preload = await read('src/preload/index.js')
  const reportsJsx = await read('src/renderer/src/components/Reports.jsx')
  const reportExport = await read('src/main/domains/reportExport.js')
  const reportsDomain = await read('src/main/domains/reports.js')
  const databaseJs = await read('src/main/database.js')
  const migration = await read('supabase/migrations/20260620150000_detailed_reports_export_rpcs.sql')

  test('Excel handler uses buffer approach instead of XLSX.writeFile', () => {
    assert.match(mainIndex, /XLSX\.write\(wb,\s*\{\s*type:\s*'buffer',\s*bookType:\s*'xlsx'\s*\}\)/)
    // The old reports:saveExcel handler should now use buffer approach too
    // Check that within the reports:saveExcel handler, writeFile is not used
    const excelHandlerMatch = mainIndex.match(/ipcMain\.handle\('reports:saveExcel'[\s\S]*?^\s{2}\}\)/m)
    if (excelHandlerMatch) {
      assert.doesNotMatch(excelHandlerMatch[0], /XLSX\.writeFile\(wb,\s*filePath\)/)
    }
  })

  test('Excel handler creates directory before writing', () => {
    assert.match(mainIndex, /fs\.mkdirSync\(dirname\(filePath\),\s*\{\s*recursive:\s*true\s*\}\)/)
  })

  test('Excel handler verifies file exists after write', () => {
    assert.match(mainIndex, /if \(!fs\.existsSync\(filePath\) \|\| fs\.statSync\(filePath\)\.size === 0\)/)
  })

  test('Excel handler handles locked files (EBUSY)', () => {
    assert.match(mainIndex, /e\.code\s*===\s*'EBUSY'/)
    assert.match(mainIndex, /destination file is open or locked/)
  })

  test('Excel handler handles permission errors (EACCES)', () => {
    assert.match(mainIndex, /e\.code\s*===\s*'EACCES'/)
  })

  test('Preload exposes exportDetailedExcel', () => {
    assert.match(preload, /exportDetailedExcel:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('reports:exportDetailedExcel',\s*payload\)/)
  })

  test('Preload exposes exportDetailedPDF', () => {
    assert.match(preload, /exportDetailedPDF:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('reports:exportDetailedPDF',\s*payload\)/)
  })

  test('Reports.jsx uses exportDetailedExcel instead of saveExcel', () => {
    assert.match(reportsJsx, /window\.api\.reports\.exportDetailedExcel/)
    assert.doesNotMatch(reportsJsx, /window\.api\.reports\.saveExcel\(\{/)
  })

  test('Reports.jsx uses exportDetailedPDF instead of savePDF', () => {
    assert.match(reportsJsx, /window\.api\.reports\.exportDetailedPDF/)
    assert.doesNotMatch(reportsJsx, /window\.api\.reports\.savePDF\(\{/)
  })

  test('Reports.jsx passes only export parameters (startDate, endDate, etc.)', () => {
    assert.match(reportsJsx, /startDate:\s*start/)
    assert.match(reportsJsx, /endDate:\s*end/)
    assert.doesNotMatch(reportsJsx, /saveExcel\([\s\S]*occupancy,/)
    assert.doesNotMatch(reportsJsx, /saveExcel\([\s\S]*revenue,/)
  })

  // ── 2. Export Utilities Tests ─────────────────────────────────────────────
  console.log('\n2. Export Utilities (reportExport.js)')

  test('Formula injection protection sanitizes values starting with dangerous chars', () => {
    assert.match(reportExport, /export function sanitizeCellValue/)
    assert.match(reportExport, /=\+\\-@/)
  })

  test('Formula injection protection adds leading apostrophe', () => {
    assert.ok(reportExport.includes("'${value}") || reportExport.includes("'${str}"), 'Should prepend apostrophe to formula-like strings')
  })

  test('deriveBookingPaymentMethod exists and handles edge cases', () => {
    assert.match(reportExport, /export function deriveBookingPaymentMethod/)
    assert.match(reportExport, /return 'None'/)
    assert.match(reportExport, /return 'Mixed'/)
  })

  test('loadDetailedReportData calls all required RPCs', () => {
    assert.match(reportExport, /get_booking_register_report/)
    assert.match(reportExport, /get_payment_transaction_report/)
    assert.match(reportExport, /get_cancelled_booking_report/)
    assert.match(reportExport, /get_refund_report/)
    assert.match(reportExport, /get_outstanding_balance_report/)
    assert.match(reportExport, /get_quotation_report/)
    assert.match(reportExport, /get_invoice_register_report/)
    assert.match(reportExport, /get_financial_exception_report/)
    assert.match(reportExport, /get_reconciliation_controls_report/)
  })

  test('computeReconciliation computes all required metrics', () => {
    assert.match(reportExport, /grossBookingValue/)
    assert.match(reportExport, /positiveReceipts/)
    assert.match(reportExport, /refundsIssued/)
    assert.match(reportExport, /netCash/)
    assert.match(reportExport, /retainedFees/)
    assert.match(reportExport, /outstandingBalances/)
    assert.match(reportExport, /paymentLedgerTotal/)
    assert.match(reportExport, /bookingAmountPaidTotal/)
    assert.match(reportExport, /ledgerVariance/)
    assert.match(reportExport, /reconciliationStatus/)
  })

  test('Reconciliation reads from server RPC data', () => {
    assert.match(reportExport, /const serverRows = data\.reconciliation/)
    assert.match(reportExport, /RECONCILIATION FAILED/)
  })

  test('DATE_BASIS includes all required date rules', () => {
    assert.match(reportExport, /bookings:.*check-in/)
    assert.match(reportExport, /payments:.*paid_at/)
    assert.match(reportExport, /cancellations:.*cancelled_at/)
    assert.match(reportExport, /refunds:.*approval/)
    assert.match(reportExport, /quotations:.*created_at/)
    assert.match(reportExport, /invoices:.*issued_at/)
    assert.match(reportExport, /outstanding:.*booking check-in period/)
  })

  test('EXPORT_VERSION is defined', () => {
    assert.match(reportExport, /const EXPORT_VERSION = '2\.0'/)
  })

  test('sanitizeRow wraps sanitizeCellValue', () => {
    assert.match(reportExport, /export function sanitizeRow/)
  })

  test('safeSheetName truncates to 31 characters', () => {
    assert.match(reportExport, /maxLength = 31/)
  })

  // ── 3. Database Facade Tests ──────────────────────────────────────────────
  console.log('\n3. Database Facade')

  test('database.js re-exports reportExport functions', () => {
    assert.match(databaseJs, /loadDetailedReportData/)
    assert.match(databaseJs, /computeReconciliation/)
    assert.match(databaseJs, /buildExportMetaRows/)
    assert.match(databaseJs, /sanitizeCellValue/)
    assert.match(databaseJs, /sanitizeRow/)
    assert.match(databaseJs, /deriveBookingPaymentMethod/)
    assert.match(databaseJs, /DATE_BASIS/)
    assert.match(databaseJs, /EXPORT_VERSION/)
  })

  // ── 4. Main Process Handler Tests ─────────────────────────────────────────
  console.log('\n4. Main Process Handlers')

  test('reports:exportDetailedExcel handler exists', () => {
    assert.match(mainIndex, /ipcMain\.handle\('reports:exportDetailedExcel'/)
  })

  test('reports:exportDetailedPDF handler exists', () => {
    assert.match(mainIndex, /ipcMain\.handle\('reports:exportDetailedPDF'/)
  })

  test('Detailed Excel handler requires reports.view capability', () => {
    assert.match(mainIndex, /reports:exportDetailedExcel[\s\S]*requireCapability\('reports\.view'\)/)
  })

  test('Detailed PDF handler requires reports.view capability', () => {
    assert.match(mainIndex, /reports:exportDetailedPDF[\s\S]*requireCapability\('reports\.view'\)/)
  })

  test('Detailed Excel handler calls loadDetailedReportData', () => {
    assert.match(mainIndex, /reports:exportDetailedExcel[\s\S]*loadDetailedReportData/)
  })

  test('Detailed Excel handler calls computeReconciliation', () => {
    assert.match(mainIndex, /reports:exportDetailedExcel[\s\S]*computeReconciliation/)
  })

  test('Detailed PDF handler calls buildDetailedReportPdfHtml', () => {
    assert.match(mainIndex, /reports:exportDetailedPDF[\s\S]*buildDetailedReportPdfHtml/)
  })

  test('Detailed PDF uses renderHtmlToPdfBuffer (not printToPDF)', () => {
    assert.match(mainIndex, /reports:exportDetailedPDF[\s\S]*renderHtmlToPdfBuffer/)
  })

  test('Excel handler includes all required sheet names', () => {
    assert.match(mainIndex, /'Report Info'/)
    assert.match(mainIndex, /'Booking Register'/)
    assert.match(mainIndex, /'Payment Transactions'/)
    assert.match(mainIndex, /'Outstanding Balances'/)
    assert.match(mainIndex, /'Cancelled Bookings'/)
    assert.match(mainIndex, /'Refunds'/)
    assert.match(mainIndex, /'Quotations'/)
    assert.match(mainIndex, /'Invoice Register'/)
    assert.match(mainIndex, /'Financial Exceptions'/)
    assert.match(mainIndex, /'Reconciliation'/)
  })

  test('buildDetailedReportPdfHtml generates complete HTML document', () => {
    assert.match(mainIndex, /function buildDetailedReportPdfHtml/)
    assert.match(mainIndex, /<!DOCTYPE html>/)
    assert.match(mainIndex, /<html>/)
    assert.match(mainIndex, /<\/html>/)
  })

  test('PDF handler uses landscape for wide reports', () => {
    assert.match(mainIndex, /landscape:\s*true/)
  })

  // ── 5. SQL Migration Tests ────────────────────────────────────────────────
  console.log('\n5. SQL Migration (RPC Functions)')

  test('Migration creates get_booking_register_report function', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_booking_register_report/)
  })

  test('Migration creates get_payment_transaction_report function', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_payment_transaction_report/)
  })

  test('Migration creates get_cancelled_booking_report function', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_cancelled_booking_report/)
  })

  test('Migration creates get_refund_report function', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_refund_report/)
  })

  test('Migration creates get_outstanding_balance_report function', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_outstanding_balance_report/)
  })

  test('Migration creates get_quotation_report function', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_quotation_report/)
  })

  test('Migration creates get_invoice_register_report function', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_invoice_register_report/)
  })

  test('Migration creates get_financial_exception_report function', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_financial_exception_report/)
  })

  test('Migration creates get_reconciliation_controls_report function', () => {
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_reconciliation_controls_report/)
  })

  test('All RPC functions are STABLE', () => {
    const fnNames = [
      'get_booking_register_report', 'get_payment_transaction_report',
      'get_cancelled_booking_report', 'get_refund_report',
      'get_outstanding_balance_report', 'get_quotation_report',
      'get_invoice_register_report', 'get_financial_exception_report',
      'get_reconciliation_controls_report'
    ]
    for (const fn of fnNames) {
      const pattern = new RegExp(`FUNCTION public\\.${fn}[\\s\\S]*?STABLE`)
      assert.match(migration, pattern, `${fn} should be STABLE`)
    }
  })

  test('All RPC functions are SECURITY DEFINER', () => {
    const fnNames = [
      'get_booking_register_report', 'get_payment_transaction_report',
      'get_cancelled_booking_report', 'get_refund_report',
      'get_outstanding_balance_report', 'get_quotation_report',
      'get_invoice_register_report', 'get_financial_exception_report',
      'get_reconciliation_controls_report'
    ]
    for (const fn of fnNames) {
      const pattern = new RegExp(`FUNCTION public\\.${fn}[\\s\\S]*?SECURITY DEFINER`)
      assert.match(migration, pattern, `${fn} should be SECURITY DEFINER`)
    }
  })

  test('All RPC functions set search_path explicitly', () => {
    const fnNames = [
      'get_booking_register_report', 'get_payment_transaction_report',
      'get_cancelled_booking_report', 'get_refund_report',
      'get_outstanding_balance_report', 'get_quotation_report',
      'get_invoice_register_report', 'get_financial_exception_report',
      'get_reconciliation_controls_report'
    ]
    for (const fn of fnNames) {
      const pattern = new RegExp(`FUNCTION public\\.${fn}[\\s\\S]*?SET search_path = public`)
      assert.match(migration, pattern, `${fn} should set search_path = public`)
    }
  })

  test('Migration grants execute to authenticated and service_role', () => {
    const grantCount = (migration.match(/GRANT EXECUTE ON FUNCTION/g) || []).length
    assert.ok(grantCount >= 9, `Expected at least 9 GRANT statements (one per report function), found ${grantCount}`)
  })

  test('Booking register includes payment_method_summary', () => {
    assert.match(migration, /payment_method_summary/)
  })

  test('Outstanding balance includes aging_bucket', () => {
    assert.match(migration, /aging_bucket/)
  })

  test('Cancelled booking report includes refund_amount and retained_amount', () => {
    assert.match(migration, /refund_amount/)
    assert.match(migration, /retained_amount/)
  })

  test('Refund report includes retained_percentage', () => {
    assert.match(migration, /retained_percentage/)
  })

  test('Financial exception report checks amount_paid vs payment ledger', () => {
    assert.match(migration, /amount_paid_ledger_mismatch/)
  })

  test('Financial exception report checks for bookings without invoices', () => {
    assert.match(migration, /booking_without_invoice/)
  })

  test('Financial exception report checks for refunds without approval', () => {
    assert.match(migration, /refund_without_approval/)
  })

  // ── 6. Cross-cutting Concerns ─────────────────────────────────────────────
  console.log('\n6. Cross-cutting Concerns')

  test('No direct amount_paid updates in export code', () => {
    assert.doesNotMatch(reportExport, /\.update\(.*amount_paid/)
    assert.doesNotMatch(reportExport, /SET amount_paid/)
  })

  test('No frontend-derived payment_status calculation', () => {
    assert.doesNotMatch(reportExport, /payment_status\s*=\s*['"]paid['"]/)
    assert.doesNotMatch(reportExport, /payment_status\s*=\s*['"]partial['"]/)
    assert.doesNotMatch(reportExport, /payment_status\s*=\s*['"]unpaid['"]/)
  })

  test('All export functions are read-only (no INSERT/UPDATE/DELETE)', () => {
    assert.doesNotMatch(reportExport, /INSERT\s+INTO/)
    assert.doesNotMatch(reportExport, /UPDATE\s+.*SET/)
    assert.doesNotMatch(reportExport, /DELETE\s+FROM/)
  })

  test('Reports.jsx page design is preserved (tabs, header, export buttons)', () => {
    assert.match(reportsJsx, /TABS\s*=\s*\[/)
    assert.match(reportsJsx, /\['bookings'/)
    assert.match(reportsJsx, /\['expenses'/)
    assert.match(reportsJsx, /\['pos'/)
    assert.match(reportsJsx, /\['costs'/)
    assert.match(reportsJsx, /\['pl'/)
    assert.match(reportsJsx, /id="printable-report"/)
    assert.match(reportsJsx, /handleSaveExcel/)
    assert.match(reportsJsx, /handleSavePDF/)
    assert.match(reportsJsx, /handlePrint/)
    assert.match(reportsJsx, /exportCSV/)
  })

  test('No navigation changes in Reports.jsx', () => {
    assert.match(reportsJsx, /useNavigate/)
  })

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(50)}`)
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  console.log(`${'='.repeat(50)}`)

  if (failed > 0) process.exit(1)
}

run().catch((e) => {
  console.error('Test runner failed:', e)
  process.exit(1)
})
