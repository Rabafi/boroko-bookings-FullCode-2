import { state } from '../state.js'
import { recordCriticalError } from './operationalLog.js'
import { createHash } from 'node:crypto'

export const EXPORT_VERSION = '2.0'
export const FINANCIAL_EXPORT_VERSION = 'bar-accounting-financial-truth-v1'

export function hashReportPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

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
export function sanitizeCellValue(value) {
  if (value == null) return ''
  if (typeof value !== 'string') return value
  if (/^[=+\-@]/.test(value) || /^-(?!\d+(?:\.\d+)?$)/.test(value)) {
    return `'${value}`
  }
  return value
}

export function sanitizeRow(row) {
  if (!Array.isArray(row)) return row
  return row.map((value) => Array.isArray(value) ? sanitizeRow(value) : sanitizeCellValue(value))
}

// ─── Payment Method Summary ──────────────────────────────────────────────────
export function deriveBookingPaymentMethod(payments = []) {
  const positive = payments.filter((p) => Number(p.amount || 0) > 0)
  if (positive.length === 0) return 'None'
  const methods = [...new Set(positive.map((p) => String(p.method || 'unknown')).filter(Boolean))]
  if (methods.length === 0) return 'None'
  if (methods.length === 1) return methods[0]
  return 'Mixed'
}

// ─── Aging Bucket ────────────────────────────────────────────────────────────
export function getAgingBucket(checkOutDate) {
  if (!checkOutDate) return 'not_yet_due'
  const today = new Date()
  const due = new Date(checkOutDate)
  const diffDays = Math.floor((today - due) / 86400000)
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

export async function loadDetailedReportData(lodgeId, startDate, endDate, outletSelector = null) {
  if (!lodgeId) throw new Error('loadDetailedReportData: lodgeId is required')
  if (!startDate || !endDate) throw new Error('loadDetailedReportData: date range is required')

  const results = {}
  const failures = []

  const settled = await Promise.allSettled(
    REQUIRED_RPCS.map(async ({ key, fn, label }) => {
      const params = { p_lodge_id: lodgeId, p_start_date: startDate, p_end_date: endDate }
      try {
        const { data, error } = await state.supabase.rpc(fn, params)
        if (error) throw error
        results[key] = data || []
        return { key, label, success: true }
      } catch (err) {
        recordCriticalError(`reportExport.${fn}`, err, { lodgeId, startDate, endDate }, { level: 'error', limit: 0 })
        failures.push({ key, label, message: err.message || String(err) })
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
  const sources = {}
  for (const { key } of REQUIRED_RPCS) {
    sources[key] = 'server'
  }

  const output = {
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
  }
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
  return output
}

// ─── Reconciliation (server-authoritative from RPC) ──────────────────────────
export function computeReconciliation(data) {
  const serverRows = data.reconciliation || []

  const findMetric = (name) => serverRows.find((r) => r.metric_name === name) || null
  const getVal = (name) => {
    const row = findMetric(name)
    return row ? Number(row.expected_value ?? row.actual_value ?? 0) : 0
  }
  const getExpected = (name) => {
    const row = findMetric(name)
    return row ? Number(row.expected_value ?? 0) : 0
  }
  const getActual = (name) => {
    const row = findMetric(name)
    return row ? Number(row.actual_value ?? row.expected_value ?? 0) : 0
  }
  const getStatus = (name) => {
    const row = findMetric(name)
    return row ? row.status : 'info'
  }
  const getVariance = (name) => {
    const row = findMetric(name)
    return row ? Number(row.variance ?? 0) : 0
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
    rows.push(['Completeness', exportManifest.completeness || 'INCOMPLETE'])
    rows.push(['Source Manifest Hash', exportManifest.data_hash || ''])
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
export function safeSheetName(name, maxLength = 31) {
  const cleaned = String(name || 'Sheet')
    .replace(/[\[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || 'Sheet').slice(0, Math.min(31, maxLength))
}

// ─── Column Width Estimation ─────────────────────────────────────────────────
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
