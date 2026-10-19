// @ts-check
import { state } from '../state.js'
import { recordCriticalError } from './operationalLog.js'
import { createHash } from 'node:crypto'

export const EXPORT_VERSION = '2.0'
export const FINANCIAL_EXPORT_VERSION = 'bar-accounting-financial-truth-v1'

/** @typedef {Record<string, unknown>} ReportRecordView */
/** @typedef {{reconciliation?: unknown[], asOf?: unknown, [key: string]: unknown}} ReportReconciliationInput */
/**
 * Expected SQL RETURNS TABLE projection used by the desktop report renderers.
 * This is a source-contract view only; it does not validate RPC JSON at runtime.
 * @typedef {{
 *   bookings: Array<{booking_number: string | null, invoice_number: string | null, guest_name: string | null, guest_phone: string | null, guest_email: string | null, room_number: string | null, room_type: string | null, booking_type: string | null, booking_source: string | null, quotation_number: string | null, check_in: string | null, check_out: string | null, nights: number | null, adults: number | null, children: number | null, booking_status: string | null, payment_status: string | null, payment_method_summary: string | null, accommodation_amount: number | null, folio_charges: number | null, gross_total: number | null, lifetime_amount_paid: number | null, balance_due: number | null, vat_rate: number | null, vat_amount: number | null, net_excluding_vat: number | null, created_at: string | null, created_by: string | null, notes: string | null}>,
 *   payments: Array<{payment_id: string | null, paid_at: string | null, booking_number: string | null, invoice_number: string | null, guest_name: string | null, transaction_type: string | null, payment_method: string | null, amount: number | null, recorded_by: string | null, idempotency_key: string | null, notes: string | null}>,
 *   outstanding: Array<{booking_number: string | null, invoice_number: string | null, guest_name: string | null, room_number: string | null, check_in: string | null, check_out: string | null, gross_total: number | null, amount_paid: number | null, balance_due: number | null, payment_status: string | null, booking_status: string | null, due_date: string | null, days_overdue: number | null, aging_bucket: string | null, last_payment_date: string | null, last_payment_method: string | null}>,
 *   cancelled: Array<{booking_number: string | null, invoice_number: string | null, guest_name: string | null, room_number: string | null, original_check_in: string | null, original_check_out: string | null, nights: number | null, original_total: number | null, amount_paid_before: number | null, cancelled_at: string | null, cancellation_reason: string | null, cancelled_by: string | null, refund_amount: number | null, retained_amount: number | null, final_state: string | null, booking_source: string | null, notes: string | null}>,
 *   refunds: Array<{refund_id: string | null, refund_timestamp: string | null, booking_number: string | null, invoice_number: string | null, guest_name: string | null, amount_paid_before: number | null, refund_amount: number | null, retained_amount: number | null, retained_percentage: number | null, refund_method: string | null, requested_by: string | null, approved_by: string | null, proof_reference: string | null, approval_note: string | null, general_notes: string | null, related_payment_id: string | null}>,
 *   quotations: Array<{quotation_number: string | null, guest_name: string | null, guest_phone: string | null, guest_email: string | null, quotation_type: string | null, event_group_name: string | null, event_daily_rate: number | null, room_number: string | null, check_in: string | null, check_out: string | null, nights: number | null, adults: number | null, children: number | null, subtotal: number | null, tax: number | null, total: number | null, currency: string | null, status: string | null, valid_until: string | null, created_at: string | null, created_by: string | null, parent_quotation_number: string | null, converted_booking_number: string | null, converted_invoice_number: string | null, notes: string | null}>,
 *   invoices: Array<{invoice_number: string | null, booking_number: string | null, guest_name: string | null, room_number: string | null, check_in: string | null, check_out: string | null, nights: number | null, issued_date: string | null, due_date: string | null, accommodation_amount: number | null, folio_charges: number | null, gross_total: number | null, amount_paid: number | null, balance_due: number | null, payment_status: string | null, booking_status: string | null, payment_count: number | null, last_payment_date: string | null, delivery_status: string | null}>,
 *   exceptions: Array<{exception_type: string | null, severity: string | null, entity_type: string | null, entity_id: string | null, entity_number: string | null, description: string | null, expected_value: number | null, actual_value: number | null, variance: number | null, detected_at: string | null}>,
 *   reconciliation: Array<{metric_name: string | null, expected_value: number | null, actual_value: number | null, variance: number | null, status: string | null, notes: string | null}>,
 *   asOf: string, sources: Record<string, string>
 * }} DetailedReportRows
 */
/**
 * Successful result constructed after all required report RPCs settle.
 * Manifest and totals are required here because the loader assigns both before returning.
 * The SQL row view remains an expected-data assumption; this type adds no runtime validation.
 * @typedef {DetailedReportRows & {
 *   exportManifest: ReturnType<typeof buildReportExportManifest>,
 *   controlTotals: ReturnType<typeof computeReconciliation>['controls']
 * }} DetailedReportData
 */

/** @param {unknown} payload @returns {string} */
export function hashReportPayload(payload) {
  // Preserve the existing crypto error when JSON.stringify returns undefined.
  const serialized = /** @type {string} */ (JSON.stringify(payload))
  return createHash('sha256').update(serialized).digest('hex')
}

/** @param {{lodgeId: unknown, startDate: unknown, endDate: unknown, outletSelector?: unknown, sections?: Record<string, unknown>, asOf: unknown, reconciliationStatus?: unknown}} input */
export function buildReportExportManifest({ lodgeId, startDate, endDate, outletSelector = null, sections = {}, asOf, reconciliationStatus = null }) {
  const sectionManifest = REQUIRED_RPCS.map(({ key, fn, label }) => ({
    key,
    rpc: fn,
    label,
    row_count: Array.isArray(sections[key]) ? sections[key].length : 0,
    source: 'server-authoritative-rpc',
    complete: Array.isArray(sections[key])
  }))
  const body = { lodge_id: lodgeId, period: { start_date: startDate, end_date: endDate }, outlet: outletSelector, as_of: asOf, sections: sectionManifest, dataset: sections }
  return {
    manifest_version: FINANCIAL_EXPORT_VERSION,
    completeness: sectionManifest.every((section) => section.complete) ? 'COMPLETE' : 'INCOMPLETE',
    source: 'server-authoritative-rpc',
    generated_at: new Date().toISOString(),
    as_of: asOf,
    reconciliation_status: reconciliationStatus,
    sections: sectionManifest,
    data_hash: hashReportPayload(body),
    canonical_dataset_hash: hashReportPayload(sections)
  }
}

// ─── Formula Injection Protection ────────────────────────────────────────────
/** @param {unknown} value @returns {unknown} */
export function sanitizeCellValue(value) {
  if (value == null) return ''
  if (typeof value !== 'string') return value
  if (/^[=+\-@]/.test(value) || /^-(?!\d+(?:\.\d+)?$)/.test(value)) {
    return `'${value}`
  }
  return value
}

/** @param {unknown} row @returns {unknown} */
export function sanitizeRow(row) {
  if (!Array.isArray(row)) return row
  const values = /** @type {unknown[]} */ (row)
  return values.map((value) => Array.isArray(value) ? sanitizeRow(value) : sanitizeCellValue(value))
}

// ─── Payment Method Summary ──────────────────────────────────────────────────
/** @param {unknown[]} [payments] @returns {string} */
export function deriveBookingPaymentMethod(payments = []) {
  const positive = payments.filter((rawPayment) => {
    const payment = /** @type {ReportRecordView} */ (rawPayment)
    return Number(payment.amount || 0) > 0
  })
  if (positive.length === 0) return 'None'
  const methods = [...new Set(positive.map((rawPayment) => {
    const payment = /** @type {ReportRecordView} */ (rawPayment)
    return String(payment.method || 'unknown')
  }).filter(Boolean))]
  if (methods.length === 0) return 'None'
  if (methods.length === 1) return methods[0]
  return 'Mixed'
}

// ─── Aging Bucket ────────────────────────────────────────────────────────────
/** @param {string | number | Date | null | undefined} checkOutDate */
export function getAgingBucket(checkOutDate) {
  if (!checkOutDate) return 'not_yet_due'
  const today = new Date()
  const due = new Date(checkOutDate)
  const diffDays = Math.floor((today.valueOf() - due.valueOf()) / 86400000)
  if (diffDays <= 0) return 'not_yet_due'
  if (diffDays <= 7) return '1-7_days'
  if (diffDays <= 30) return '8-30_days'
  if (diffDays <= 60) return '31-60_days'
  return 'over_60_days'
}

// ─── Server-Authoritative Data Loading (FAIL CLOSED) ─────────────────────────
const REQUIRED_RPCS = [
  { key: 'bookings', fn: 'get_booking_register_report', label: 'Booking Register' },
  { key: 'payments', fn: 'get_payment_transaction_report', label: 'Payment Transactions' },
  { key: 'cancelled', fn: 'get_cancelled_booking_report', label: 'Cancelled Bookings' },
  { key: 'refunds', fn: 'get_refund_report', label: 'Refunds' },
  { key: 'outstanding', fn: 'get_outstanding_balance_report', label: 'Outstanding Balances' },
  { key: 'quotations', fn: 'get_quotation_report', label: 'Quotations' },
  { key: 'invoices', fn: 'get_invoice_register_report', label: 'Invoice Register' },
  { key: 'exceptions', fn: 'get_financial_exception_report', label: 'Financial Exceptions' },
  { key: 'reconciliation', fn: 'get_reconciliation_controls_report', label: 'Reconciliation Controls' }
]

/**
 * @param {unknown} lodgeId
 * @param {unknown} startDate
 * @param {unknown} endDate
 * @param {unknown} [outletSelector]
 * @returns {Promise<DetailedReportData>}
 */
export async function loadDetailedReportData(lodgeId, startDate, endDate, outletSelector = null) {
  if (!lodgeId) throw new Error('loadDetailedReportData: lodgeId is required')
  if (!startDate || !endDate) throw new Error('loadDetailedReportData: date range is required')

  /** @type {Record<string, unknown>} */
  const results = {}
  /** @type {Array<{key: string, label: string, message: unknown}>} */
  const failures = []

  const settled = await Promise.allSettled(
    REQUIRED_RPCS.map(async ({ key, fn, label }) => {
      const params = { p_lodge_id: lodgeId, p_start_date: startDate, p_end_date: endDate }
      try {
        // The assertion exists only to pass the optional-client check; property access still throws
        // inside this try block if the configured client is absent, as it did before this view.
        const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc(fn, params)
        if (error) throw error
        results[key] = data || []
        return { key, label, success: true }
      } catch (err) {
        recordCriticalError(`reportExport.${fn}`, err, { lodgeId, startDate, endDate }, { level: 'error', limit: 0 })
        // Read only the existing message property; this is not an error-shape validation.
        const errorView = /** @type {{message?: unknown}} */ (err)
        failures.push({ key, label, message: errorView.message || String(err) })
        return { key, label, success: false, error: err }
      }
    })
  )

  if (failures.length > 0) {
    const names = failures.map((f) => f.label).join(', ')
    const firstMsg = failures[0].message
    throw new Error(
      `Detailed report export failed while loading ${names}: ${firstMsg}` +
      (failures.length > 1 ? ` (+${failures.length - 1} more)` : '')
    )
  }

  const asOf = new Date().toISOString()
  /** @type {Record<string, string>} */
  const sources = {}
  for (const { key } of REQUIRED_RPCS) {
    sources[key] = 'server'
  }

  // This local view follows the SQL RETURNS TABLE projections documented above;
  // it does not validate, copy, coerce, or otherwise rewrite the raw RPC rows.
  const output = /** @type {DetailedReportRows & {
   * exportManifest?: DetailedReportData['exportManifest'],
   * controlTotals?: DetailedReportData['controlTotals']
   * }} */ ({
    bookings: results.bookings || [],
    payments: results.payments || [],
    cancelled: results.cancelled || [],
    refunds: results.refunds || [],
    outstanding: results.outstanding || [],
    quotations: results.quotations || [],
    invoices: results.invoices || [],
    exceptions: results.exceptions || [],
    reconciliation: results.reconciliation || [],
    asOf,
    sources
  })
  const reconciliation = computeReconciliation(output)
  output.exportManifest = buildReportExportManifest({
    lodgeId,
    startDate,
    endDate,
    outletSelector,
    sections: output,
    asOf,
    reconciliationStatus: reconciliation.reconciliationStatus
  })
  output.controlTotals = reconciliation.controls
  // Both required envelope fields have been assigned above; the view is applied
  // only after the successful loader has completed its construction.
  return /** @type {DetailedReportData} */ (output)
}

// ─── Reconciliation (server-authoritative from RPC) ──────────────────────────
/** @param {ReportReconciliationInput} data */
export function computeReconciliation(data) {
  const serverRows = data.reconciliation || []

  /** @param {string} name @returns {unknown} */
  const findMetric = (name) => serverRows.find((rawRow) => {
    const row = /** @type {ReportRecordView} */ (rawRow)
    return row.metric_name === name
  }) || null
  /** @param {string} name @returns {number} */
  const getVal = (name) => {
    const rawRow = findMetric(name)
    const row = /** @type {ReportRecordView} */ (rawRow)
    return rawRow ? Number(row.expected_value ?? row.actual_value ?? 0) : 0
  }
  /** @param {string} name @returns {number} */
  const getExpected = (name) => {
    const rawRow = findMetric(name)
    const row = /** @type {ReportRecordView} */ (rawRow)
    return rawRow ? Number(row.expected_value ?? 0) : 0
  }
  /** @param {string} name @returns {number} */
  const getActual = (name) => {
    const rawRow = findMetric(name)
    const row = /** @type {ReportRecordView} */ (rawRow)
    return rawRow ? Number(row.actual_value ?? row.expected_value ?? 0) : 0
  }
  /** @param {string} name @returns {unknown} */
  const getStatus = (name) => {
    const rawRow = findMetric(name)
    const row = /** @type {ReportRecordView} */ (rawRow)
    return rawRow ? row.status : 'info'
  }
  /** @param {string} name @returns {number} */
  const getVariance = (name) => {
    const rawRow = findMetric(name)
    const row = /** @type {ReportRecordView} */ (rawRow)
    return rawRow ? Number(row.variance ?? 0) : 0
  }

  const grossBookingValue = getVal('Gross Booking Value')
  const positiveReceipts = getVal('Gross Positive Receipts')
  const refundsIssued = getVal('Refunds Issued')
  const netCash = getVal('Net Cash Movement')
  const retainedFees = getVal('Retained Fees')
  const outstandingBalances = getVal('Outstanding Balances')
  const paymentLedgerTotal = getVal('Payment Ledger Total')
  const bookingAmountPaidTotal = getVal('Booking Amount Paid Snapshot')

  const perBookingStatus = getStatus('Per-booking ledger reconciliation')
  const cashStatus = getStatus('Cash reconciliation')
  const outstandingStatus = getStatus('Outstanding reconciliation')
  const refundStatus = getStatus('Refund reconciliation')
  const registerStatus = getStatus('Booking register gross total')

  const failedControls = [
    perBookingStatus, cashStatus, outstandingStatus, refundStatus, registerStatus
  ].filter((s) => s === 'RECONCILIATION FAILED')

  const overallStatus = failedControls.length > 0 ? 'RECONCILIATION FAILED' : 'PASSED'

  return {
    grossBookingValue,
    positiveReceipts,
    refundsIssued,
    netCash,
    retainedFees,
    outstandingBalances,
    paymentLedgerTotal,
    bookingAmountPaidTotal,
    ledgerVariance: getVariance('Cash reconciliation'),
    reconciliationStatus: overallStatus,
    controls: {
      perBooking: { status: perBookingStatus, variance: getVariance('Per-booking ledger reconciliation') },
      cash: { status: cashStatus, variance: getVariance('Cash reconciliation') },
      outstanding: { status: outstandingStatus, variance: getVariance('Outstanding reconciliation') },
      refund: { status: refundStatus, variance: getVariance('Refund reconciliation') },
      register: { status: registerStatus, variance: getVariance('Booking register gross total') }
    },
    asOf: data.asOf || new Date().toISOString()
  }
}

// ─── Workbook Meta Rows ──────────────────────────────────────────────────────
/** @param {{lodgeName?: unknown, companyName?: unknown, periodLabel?: unknown, currency?: unknown, outletLabel?: unknown, generatedAt?: unknown, asOf?: unknown, reconciliationStatus?: unknown, exportVersion?: unknown, exportManifest?: unknown}} input */
export function buildExportMetaRows({ lodgeName, companyName, periodLabel, currency, outletLabel, generatedAt, asOf, reconciliationStatus, exportVersion, exportManifest }) {
  const rows = []
  rows.push(['Lodge', lodgeName || 'Tsa Bonno LodgingOS'])
  if (companyName && companyName !== lodgeName) rows.push(['Company', companyName])
  if (periodLabel) rows.push(['Period', periodLabel])
  if (outletLabel) rows.push(['Outlet', outletLabel])
  if (currency) rows.push(['Currency', currency])
  if (generatedAt) rows.push(['Generated', generatedAt])
  if (asOf) rows.push(['Server As-Of', asOf])
  if (exportVersion) rows.push(['Export Version', exportVersion])
  if (reconciliationStatus) rows.push(['Reconciliation', reconciliationStatus])
  if (exportManifest) {
    const manifest = /** @type {ReportRecordView} */ (exportManifest)
    rows.push(['Completeness', manifest.completeness || 'INCOMPLETE'])
    rows.push(['Source Manifest Hash', manifest.data_hash || ''])
  }
  rows.push(['Data Source', 'Server-authoritative (RPC)'])
  rows.push([])
  return rows
}

// ─── Date Basis Explanations ─────────────────────────────────────────────────
export const DATE_BASIS = {
  bookings: 'Booking check-in date within the selected period.',
  payments: 'Payment paid_at timestamp within the selected period.',
  cancellations: 'Booking cancelled_at timestamp within the selected period.',
  refunds: 'Refund approval created_at timestamp within the selected period.',
  quotations: 'Quotation created_at timestamp within the selected period.',
  invoices: 'Invoice issued_at timestamp within the selected period.',
  expenses: 'Expense date within the selected period.',
  pos: 'POS order completion/creation timestamp within the selected period.',
  stock: 'Purchase date within the selected period.',
  outstanding: 'Current snapshot, limited by booking check-in period rule.'
}

// ─── Sheet Name Truncation ───────────────────────────────────────────────────
/** @param {unknown} name @param {number} [maxLength] @returns {string} */
export function safeSheetName(name, maxLength = 31) {
  const cleaned = String(name || 'Sheet')
    .replace(/[\[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || 'Sheet').slice(0, Math.min(31, maxLength))
}

// ─── Column Width Estimation ─────────────────────────────────────────────────
/** @param {unknown[]} headers @param {unknown[]} rows @returns {number[]} */
export function estimateColumnWidths(headers, rows) {
  const widths = headers.map((h) => String(h).length + 2)
  for (const row of rows.slice(0, 50)) {
    if (!Array.isArray(row)) continue
    for (let i = 0; i < row.length; i++) {
      const len = String(row[i] ?? '').length
      if (len > (widths[i] || 0)) widths[i] = Math.min(len + 2, 60)
    }
  }
  return widths
}
