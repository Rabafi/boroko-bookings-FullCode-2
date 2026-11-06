import { captureReadScope, assertReadScopeCurrent } from './readScope.js';
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { state } from '../state.js'
import {
  appendAuxiliaryLog,
  getLocalDateKey,
  LOCAL_TIME_ZONE,
  logActivity,
  readAuxiliaryLog,
  recordCriticalError
} from './operationalLog.js'
import { normalizePlanName } from './subscriptionState.js'
import {
  requireAdmin
} from './infrastructure.js'

/** Error properties read from RPC/catch values; this view does not validate the value. */
/** @typedef {{message?: unknown, code?: unknown}|null|undefined} FinanceErrorReadView */
/** Fields read from current and historical local journal entries. JSON.parse plus Array.isArray does not validate these fields. */
/** @typedef {{id: string, lodge_id: string, triggered_by: string|null, summary: unknown, report_hash: string, persistence_state: string, calculation_state: string, server_confirmed?: boolean, trigger_source?: string, created_at?: string, local_only?: boolean, triggered_by_name?: string|null, date_key?: string, error?: string|null, server_receipt?: {run_id: string, report_hash: string, recorded_at: string|null}}} ValidationRunJournalExpectedView */
/** Projection returned by get_financial_validation_runs_v2, including legacy rows. */
/** @typedef {{id: string, run_id?: string, lodge_id: string, triggered_by: string|null, triggered_by_name: string|null, trigger_source: string, summary: unknown, report_hash: string|null, idempotency_key: string|null, persistence_state: 'historical'|'confirmed', server_confirmed: boolean, created_at: string}} ServerFinancialValidationRunExpectedView */
/** recordInvoiceDelivery accepts partial IPC/domain payloads; omitted fields use its existing defaults. */
/** @typedef {{id?: unknown, lodge_id?: unknown, booking_id?: unknown, invoice_number?: unknown, delivery_type?: unknown, delivery_status?: unknown, recipient?: unknown, file_path?: unknown, render_version?: unknown, initiated_by?: unknown, initiated_by_name?: unknown, metadata?: unknown}} InvoiceDeliveryPayloadExpectedView */
/** Historical auxiliary-log rows may omit booking_id; only that field is read by the filter. */
/** @typedef {{booking_id?: unknown}} InvoiceDeliveryHistoryExpectedView */
/** Reconciliation summary fields are constructed from validated mismatch counts. */
/** @typedef {{paymentMismatches: number, chargeMismatches: number, invoiceGaps: number, duplicateInvoices: number, orphanInvoices: number, folioPosMismatches: number, posReturnMismatches: number, creditMismatches: number, posVoidMismatches: number}} FinancialReconciliationSummary */
/** Expected success projection after normalizeFinancialReconciliation's existing runtime checks. */
/** @typedef {{valid: boolean, complete: true, unavailable: false, degraded: false, local_only: false, checked_at: string, source: string, schema_version: number, calculation_version: string, lodge_id: string, generated_at: string, examined_counts: Record<string, unknown>, mismatch_counts: Record<string, unknown>, totals: Record<string, unknown>, samples_truncated: boolean, sample_limit: number, summary: FinancialReconciliationSummary, paymentMismatches: unknown[], chargeMismatches: unknown[], invoiceGaps: unknown[], duplicateInvoices: unknown[], orphanInvoices: unknown[], folioPosMismatches: unknown[], posReturnMismatches: unknown[], creditMismatches: unknown[], posVoidMismatches: unknown[], reportId: string|null, reportHash: string|null, serverReport: Record<string, unknown>}} FinancialReconciliationSuccess */
/** @typedef {{valid: false, complete: false, unavailable: true, degraded: true, timeout: boolean, local_only: boolean, checked_at: string, source: string, schema_version: null, calculation_version: null, summary: FinancialReconciliationSummary, paymentMismatches: unknown[], chargeMismatches: unknown[], invoiceGaps: unknown[], orphanInvoices: unknown[], folioPosMismatches: unknown[], posReturnMismatches: unknown[], creditMismatches: unknown[], posVoidMismatches: unknown[], message: unknown}} FinancialReconciliationUnavailable */
/** @typedef {FinancialReconciliationSuccess|FinancialReconciliationUnavailable} FinancialReconciliationResult */
/** @typedef {{success: true, schema_version: 1, calculation_version: 'financial-reconciliation-v1', complete: true, lodge_id: string, generated_at: string, sample_limit: 50, samples_truncated: boolean, examined_counts: Record<string, unknown>, mismatch_counts: Record<string, unknown>, totals: Record<string, unknown>, samples: Record<string, unknown>, report_id?: unknown, report_hash?: unknown, [key: string]: unknown}} FinancialReconciliationReadView */
/** @typedef {{invoice_count?: number, received_amount?: number, pending_amount?: number, last_invoice_date?: string|null}} InvoiceSummaryValue */
/** @typedef {{action?: string, booking_id?: string|null, amount_delta?: unknown, created_at?: string, actor_id?: string|null, after_snapshot?: {refund_retained_percent?: unknown, void_reason?: unknown}|null}} FinancialAuditReadView */

export {
} from './infrastructure.js'

// ─── INVOICES ────────────────────────────────────────────────────────────────────

/** @param {unknown} value @returns {number} */
export function roundMoneyValue(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** @param {unknown} error @returns {boolean} */
export function isMissingInvoiceNumberRpcError(error) {
  const readView = /** @type {FinanceErrorReadView} */ (error)
  const message = String(readView?.message || '');
  return readView?.code === 'PGRST202' ||
  /public\.get_next_invoice_number|get_next_invoice_number.*schema cache|schema cache.*get_next_invoice_number/i.test(message);
}

/** @param {number} year @param {number} sequence */
function formatInvoiceNumber(year, sequence) {
  return `INV-${year}-${String(sequence).padStart(4, '0')}`;
}

/** @param {unknown} invoiceNumber @param {string} prefix */
function parseInvoiceSequence(invoiceNumber, prefix) {
  if (typeof invoiceNumber !== 'string' || !invoiceNumber.startsWith(prefix)) return null;
  const sequence = Number.parseInt(invoiceNumber.slice(prefix.length), 10);
  return Number.isInteger(sequence) ? sequence : null;
}

// Kept as a compatibility export for older callers, but the lookup strategy
// is inherently race-prone (two operators can observe the same maximum).
// Callers must explicitly opt into a non-financial diagnostic use; invoice
// creation is hard-gated on the atomic database sequence RPC instead.
/** @param {Pick<NonNullable<typeof state.supabase>, 'from'>} db @param {{allowUnsafeLookup?: boolean}} [options] */
export async function getNextInvoiceNumberByLookup(db, { allowUnsafeLookup = false } = {}) {
  if (!allowUnsafeLookup) {
    throw new Error('The atomic invoice-number service is required; lookup fallback is disabled for invoice creation.');
  }
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  const [bookingResult, invoiceResult] = await Promise.all([
  db.
  from('bookings').
  select('invoice_number').
  eq('lodge_id', state.lodgeId).
  like('invoice_number', `${prefix}%`),
  db.
  from('invoices').
  select('invoice_number').
  eq('lodge_id', state.lodgeId).
  like('invoice_number', `${prefix}%`)]
  );

  /** @type {Array<{invoice_number?: unknown}>} Selected invoice number projection from the query builders above. */
  const rows = [];
  const errors = [];
  let successfulLookups = 0;

  if (bookingResult.error) errors.push(bookingResult.error);else
  {
    successfulLookups += 1;
    rows.push(...(bookingResult.data || []));
  }

  if (invoiceResult.error) errors.push(invoiceResult.error);else
  {
    successfulLookups += 1;
    rows.push(...(invoiceResult.data || []));
  }

  if (successfulLookups === 0 && errors.length > 0) {
    throw new Error('Failed to generate invoice number: ' + errors[0].message);
  }

  const sequences = rows.
  map((row) => parseInvoiceSequence(row?.invoice_number, prefix)).
  filter(/** @param {number|null} value @returns {value is number} */ (value) => Number.isInteger(value));

  const next = sequences.length > 0 ? Math.max(...sequences) + 1 : 1;
  return formatInvoiceNumber(year, next);
}

export async function getNextInvoiceNumber() {
  // Use the same atomic DB sequence function as booking invoices to prevent
  // collisions under concurrent Command Central usage.
  const db = requireAdmin();
  const { data, error } = await db.rpc('get_next_invoice_number', { p_lodge_id: state.lodgeId });
  if (error) {
    throw new Error(isMissingInvoiceNumberRpcError(error)
      ? 'The atomic invoice-number service is unavailable. No invoice was created; deploy the invoice sequence RPC and retry.'
      : 'Failed to generate invoice number: ' + error.message);
  }
  return data;
}

/** @param {Record<string, unknown>} data */
export async function createInvoice(data) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data: row, error } = await requireAdmin().from('invoices').insert(data).select().single();
  if (error) throw new Error(error.message);
  return row;
}

/** @param {{lodge_id?: string, status?: string}} [filters] */
export async function getInvoices(filters = {}) {
  if (!state.isOnline) return [];
  let q = requireAdmin().from('invoices').select('id, booking_id, lodge_id, invoice_number, issued_at, due_date, notes, status, amount, currency, package_name, created_at').order('created_at', { ascending: false }).limit(500);
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id);
  if (filters.status) q = q.eq('status', filters.status);
  const { data, error } = await q;
  if (error) throw new Error('Failed to load invoices: ' + error.message);
  return data || [];
}

/** @param {string} lodgeId */
export async function getInvoicesByLodge(lodgeId) {
  return getClientBookingInvoices(lodgeId);
}

/** @param {string} lodgeId */
export async function getClientBookingInvoices(lodgeId) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  if (!lodgeId) throw new Error('A lodge is required to load booking invoices');

  const db = requireAdmin();
  const [bookingsResult, settingsResult] = await Promise.all([
    db.
    from('bookings').
    select('id, lodge_id, invoice_number, created_at, check_in, total_amount, amount_paid, payment_status, status').
    eq('lodge_id', lodgeId).
    not('invoice_number', 'is', null).
    neq('status', 'cancelled').
    order('created_at', { ascending: false }).
    limit(500),
    db.
    from('settings').
    select('currency').
    eq('lodge_id', lodgeId).
    maybeSingle()
  ]);

  if (bookingsResult.error) {
    throw new Error(`Failed to load booking invoices: ${bookingsResult.error.message}`);
  }
  if (settingsResult.error) {
    throw new Error(`Failed to load lodge currency: ${settingsResult.error.message}`);
  }

  const currency = settingsResult.data?.currency || 'BWP';
  return (bookingsResult.data || []).map((booking) => ({
    id: booking.id,
    booking_id: booking.id,
    lodge_id: booking.lodge_id,
    invoice_number: booking.invoice_number,
    issued_at: booking.created_at,
    issued_date: booking.created_at,
    check_in: booking.check_in,
    amount: booking.total_amount,
    amount_paid: booking.amount_paid,
    payment_status: booking.payment_status,
    status: booking.payment_status,
    booking_status: booking.status,
    currency
  }));
}

/** @param {string} id @param {Record<string, unknown>} updates */
export async function updateInvoice(id, updates) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('invoices').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

/** @param {string} id */
export async function deleteInvoice(id) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('invoices').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getInvoiceSummary() {
  if (!state.isOnline) return { total: 0, byPlan: {}, byMonth: [], allRows: [] };
  const { data, error } = await requireAdmin().
  from('invoices').
  select('amount, currency, package_name, issued_date, status');
  if (error) throw new Error('Failed to load invoice summary: ' + error.message);
  const allRows = data || [];
  const paid = allRows.filter((r) => r.status === 'paid');
  const total = paid.reduce((s, r) => s + Number(r.amount), 0);
  /** @type {Record<string, number>} */
  const byPlan = {};
  paid.forEach((r) => {
    const planName = normalizePlanName(r.package_name);
    byPlan[planName] = (byPlan[planName] || 0) + Number(r.amount);
  });
  /** @type {Record<string, number>} */
  const byMonthMap = {};
  paid.forEach((r) => {
    const m = (r.issued_date || '').slice(0, 7);
    if (m) byMonthMap[m] = (byMonthMap[m] || 0) + Number(r.amount);
  });
  const byMonth = Object.entries(byMonthMap).
  sort(([a], [b]) => a.localeCompare(b)).
  map(([month, amount]) => ({ month, amount }));
  const currencies = [...new Set(paid.map((row) => String(row.currency || '').trim().toUpperCase()).filter(Boolean))];
  const currency = currencies.length === 1 ? currencies[0] : currencies.length > 1 ? 'MIXED' : null;
  return { total, byPlan, byMonth, currency, allRows };
}


const FINANCIAL_VALIDATION_RUNS_FILE = 'financial-validation-runs.json';
const FINANCIAL_VALIDATION_ALERTS_FILE = 'financial-validation-alerts.json';
const LOCAL_INVOICE_DELIVERY_FILE = 'invoice-delivery-history.json';

/** @param {{bookingId?: string|null, limit?: number, offset?: number}} [options] */
export async function getFinancialAuditLog({ bookingId = null, limit = 100, offset = 0 } = {}) {
  if (!state.lodgeId || !state.isOnline) return [];
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_financial_audit_log', {
    p_lodge_id: state.lodgeId,
    p_booking_id: bookingId || null,
    p_limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    p_offset: Math.max(Number(offset) || 0, 0)
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? /** @type {FinancialAuditReadView[]} */ (data) : [];
}


/** @param {unknown} left @param {unknown} right @param {number} [tolerance] */
function moneyMismatch(left, right, tolerance = 0.01) {
  return Math.abs(roundMoneyValue(left) - roundMoneyValue(right)) > tolerance;
}

/** @param {unknown} error */
function isStatementTimeoutError(error) {
  const message = String((/** @type {FinanceErrorReadView} */ (error))?.message || error || '');
  return /canceling statement due to statement timeout|statement timeout|timed out/i.test(message);
}

/** @param {unknown} error @param {string} [source] @returns {FinancialReconciliationUnavailable} */
function buildFinancialVerificationUnavailable(error, source = 'money_check') {
  const timeout = isStatementTimeoutError(error);
  return {
    valid: false,
    complete: false,
    unavailable: true,
    degraded: true,
    timeout,
    local_only: !state.isOnline,
    checked_at: new Date().toISOString(),
    source,
    schema_version: null,
    calculation_version: null,
    summary: {
      paymentMismatches: 0, chargeMismatches: 0, invoiceGaps: 0, duplicateInvoices: 0,
      orphanInvoices: 0, folioPosMismatches: 0, posReturnMismatches: 0,
      creditMismatches: 0, posVoidMismatches: 0
    },
    paymentMismatches: [],
    chargeMismatches: [],
    invoiceGaps: [],
    orphanInvoices: [],
    folioPosMismatches: [],
    posReturnMismatches: [],
    creditMismatches: [],
    posVoidMismatches: [],
    message: timeout
      ? 'The online money check timed out. No current result is available; connect and run it again.'
      : ((/** @type {FinanceErrorReadView} */ (error))?.message || 'The online money check could not be verified. Connect and run it again.')
  };
}

const RECONCILIATION_COUNT_KEYS = [
  'payment_mismatches',
  'charge_mismatches',
  'invoice_gaps',
  'duplicate_invoices',
  'orphan_invoices',
  'folio_pos_mismatches',
  'pos_return_mismatches',
  'credit_mismatches',
  'pos_void_mismatches'
];
const RECONCILIATION_TOTAL_KEYS = [
  'booking_total_amount',
  'booking_amount_paid',
  'payment_ledger_net',
  'booking_charges_total',
  'active_booking_charge_net',
  'pos_net_total',
  'customer_credit_net'
];const RECONCILIATION_EXAMINED_KEYS = [
  'bookings',
  'payments',
  'charges',
  'invoices',
  'pos_orders',
  'pos_returns',
  'customer_credit_entries'
];

/** @param {unknown} value @returns {value is number} */
function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** @param {unknown} data @param {string} lodgeId @returns {FinancialReconciliationSuccess} */
function normalizeFinancialReconciliation(data, lodgeId) {
  // Expected RPC response view; the checks below remain the actual runtime validation.
  const report = /** @type {FinancialReconciliationReadView|null|undefined} */ (data);
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      report.success !== true || report.schema_version !== 1 ||
      report.calculation_version !== 'financial-reconciliation-v1' ||
      report.complete !== true || report.lodge_id !== lodgeId ||
      !Number.isFinite(Date.parse(report.generated_at)) ||
      report.sample_limit !== 50 || typeof report.samples_truncated !== 'boolean' ||
      !report.examined_counts || typeof report.examined_counts !== 'object' ||
      !report.mismatch_counts || typeof report.mismatch_counts !== 'object' ||
      !report.totals || typeof report.totals !== 'object' ||
      !report.samples || typeof report.samples !== 'object') {
    throw new Error('The server returned an incomplete or unsupported reconciliation. Deploy the current reconciliation RPC, then run it again.');
  }

  for (const key of RECONCILIATION_EXAMINED_KEYS) {
    if (!isNonNegativeInteger(report.examined_counts[key])) {
      throw new Error('The reconciliation is missing a complete ' + key + ' count. Run it again after the server contract is repaired.');
    }
  }
  for (const key of RECONCILIATION_TOTAL_KEYS) {
    if (typeof report.totals[key] !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(report.totals[key])) {
      throw new Error('The reconciliation is missing an exact monetary total for ' + key + '. Run it again after the server contract is repaired.');
    }
  }
  for (const key of RECONCILIATION_COUNT_KEYS) {
    if (!isNonNegativeInteger(report.mismatch_counts[key])) {
      throw new Error('The reconciliation is missing an exact ' + key + ' count. Run it again after the server contract is repaired.');
    }
    if (!Array.isArray(report.samples[key]) || report.samples[key].length > 50) {
      throw new Error('The reconciliation has an invalid ' + key + ' sample. Run it again.');
    }
  }
  const summary = {
    paymentMismatches: Number(report.mismatch_counts.payment_mismatches),
    chargeMismatches: Number(report.mismatch_counts.charge_mismatches),
    invoiceGaps: Number(report.mismatch_counts.invoice_gaps),
    duplicateInvoices: Number(report.mismatch_counts.duplicate_invoices),
    orphanInvoices: Number(report.mismatch_counts.orphan_invoices),
    folioPosMismatches: Number(report.mismatch_counts.folio_pos_mismatches),
    posReturnMismatches: Number(report.mismatch_counts.pos_return_mismatches),
    creditMismatches: Number(report.mismatch_counts.credit_mismatches),
    posVoidMismatches: Number(report.mismatch_counts.pos_void_mismatches)
  };
  const hasMismatches = Object.values(summary).some((count) => count > 0);

  return {
    valid: !hasMismatches,
    complete: true,
    unavailable: false,
    degraded: false,
    local_only: false,
    source: 'reconciliation',
    schema_version: report.schema_version,
    calculation_version: report.calculation_version,
    lodge_id: report.lodge_id,
    generated_at: report.generated_at,
    checked_at: report.generated_at,
    examined_counts: report.examined_counts,
    mismatch_counts: report.mismatch_counts,
    totals: report.totals,
    samples_truncated: report.samples_truncated,
    sample_limit: report.sample_limit,
    summary,
    paymentMismatches: /** @type {unknown[]} */ (report.samples.payment_mismatches),
    chargeMismatches: /** @type {unknown[]} */ (report.samples.charge_mismatches),
    invoiceGaps: /** @type {unknown[]} */ (report.samples.invoice_gaps),
    duplicateInvoices: /** @type {unknown[]} */ (report.samples.duplicate_invoices),
    orphanInvoices: /** @type {unknown[]} */ (report.samples.orphan_invoices),
    folioPosMismatches: /** @type {unknown[]} */ (report.samples.folio_pos_mismatches),
    posReturnMismatches: /** @type {unknown[]} */ (report.samples.pos_return_mismatches),
    creditMismatches: /** @type {unknown[]} */ (report.samples.credit_mismatches),
    posVoidMismatches: /** @type {unknown[]} */ (report.samples.pos_void_mismatches),
    reportId: typeof report.report_id === 'string' ? report.report_id : null,
    reportHash: typeof report.report_hash === 'string' ? report.report_hash : null,
    serverReport: /** @type {Record<string, unknown>} */ (data)
  };
}

/** @returns {Promise<FinancialReconciliationResult>} */
export async function getFinancialReconciliation() {
  if (!state.lodgeId) {
    return buildFinancialVerificationUnavailable(new Error('Choose a lodge before running the online reconciliation.'), 'reconciliation');
  }
  if (!state.isOnline || !state.supabase) {
    return buildFinancialVerificationUnavailable(new Error('Reconciliation requires an online server result. Connect and run it again.'), 'reconciliation');
  }

  const scope = captureReadScope();
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (scope.client).rpc('get_financial_reconciliation_v1', {
      p_lodge_id: scope.lodgeId
    });
    assertReadScopeCurrent(scope);
    if (error) {
      recordCriticalError('financial.reconciliation.rpc', error, { lodge_id: state.lodgeId }, { level: 'warn', limit: 120 });
      return buildFinancialVerificationUnavailable(error, 'reconciliation');
    }
    return normalizeFinancialReconciliation(data, state.lodgeId);
  } catch (error) {
    try { assertReadScopeCurrent(scope); }
    catch (scopeError) { return buildFinancialVerificationUnavailable(scopeError, 'reconciliation'); }
    recordCriticalError('financial.reconciliation.rpc', error, { lodge_id: state.lodgeId }, { level: 'warn', limit: 120 });
    return buildFinancialVerificationUnavailable(error, 'reconciliation');
  }
}
/** @returns {Promise<FinancialReconciliationResult>} */
async function prepareFinancialValidationReport() {
  if (!state.lodgeId || !state.isOnline || !state.supabase) {
    return buildFinancialVerificationUnavailable(new Error('Financial validation requires an online server report and an authorized lodge account.'), 'reconciliation');
  }
  const scope = captureReadScope();
  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (scope.client).rpc('prepare_financial_validation_report_v1', {
      p_lodge_id: scope.lodgeId
    });
    assertReadScopeCurrent(scope);
    if (error) {
      recordCriticalError('financial.validation.report.rpc', error, { lodge_id: state.lodgeId }, { level: 'warn', limit: 120 });
      return buildFinancialVerificationUnavailable(error, 'reconciliation');
    }
    return normalizeFinancialReconciliation(data, state.lodgeId);
  } catch (error) {
    try { assertReadScopeCurrent(scope); }
    catch (scopeError) { return buildFinancialVerificationUnavailable(scopeError, 'reconciliation'); }
    recordCriticalError('financial.validation.report.rpc', error, { lodge_id: state.lodgeId }, { level: 'warn', limit: 120 });
    return buildFinancialVerificationUnavailable(error, 'reconciliation');
  }
}

/** @returns {Promise<{checked_at: string, totals: Record<string, number>, recentRefunds: unknown[], recentChargeVoids: unknown[], reconciliation: FinancialReconciliationResult, degraded: boolean, message: unknown}>} */
export async function getFinancialValidationSummary() {
  const reconciliation = await prepareFinancialValidationReport();
  /** @type {FinancialAuditReadView[]} */
  let auditRows = [];
  let auditWarning = null;
  if (state.isOnline) {
    try {
      auditRows = await getFinancialAuditLog({ limit: 200 });
    } catch (error) {
      if (!isStatementTimeoutError(error)) throw error;
      recordCriticalError('financial.validation.audit_timeout', error, { lodge_id: state.lodgeId, limit: 200 }, { level: 'warn', limit: 120 });
      auditWarning = 'Recent money activity took too long to load. Totals are shown without the latest audit sample.';
    }
  }

  const recentRefunds = auditRows.
  filter((row) => row.action === 'refund_recorded').
  slice(0, 10).
  map((row) => ({
    booking_id: row.booking_id,
    amount_delta: roundMoneyValue(row.amount_delta || 0),
    created_at: row.created_at,
    actor_id: row.actor_id || null,
    retained_percent: row.after_snapshot?.refund_retained_percent ?? null
  }));

  const recentChargeVoids = auditRows.
  filter((row) => row.action === 'charge_deleted').
  slice(0, 10).
  map((row) => ({
    booking_id: row.booking_id,
    created_at: row.created_at,
    actor_id: row.actor_id || null,
    amount_delta: roundMoneyValue(row.amount_delta || 0),
    reason: row.after_snapshot?.void_reason || null
  }));

  return {
    checked_at: new Date().toISOString(),
    totals: {
      audit_rows_sampled: auditRows.length,
      recent_refunds: recentRefunds.length,
      recent_charge_voids: recentChargeVoids.length,
      payment_mismatches: reconciliation.summary.paymentMismatches,
      charge_mismatches: reconciliation.summary.chargeMismatches,
      folio_pos_mismatches: reconciliation.summary.folioPosMismatches,
      invoice_gaps: reconciliation.summary.invoiceGaps,
      duplicate_invoices: reconciliation.summary.duplicateInvoices,
      orphan_invoices: reconciliation.summary.orphanInvoices,
      pos_return_mismatches: reconciliation.summary.posReturnMismatches,
      credit_mismatches: reconciliation.summary.creditMismatches,
      pos_void_mismatches: reconciliation.summary.posVoidMismatches
    },
    recentRefunds,
    recentChargeVoids,
    reconciliation,
    degraded: reconciliation?.degraded === true || !!auditWarning,
    message: auditWarning || (/** @type {FinancialReconciliationResult & {message?: string}} */ (reconciliation))?.message || null
  };
}

/** @param {InvoiceDeliveryPayloadExpectedView} payload */
export async function recordInvoiceDelivery(payload = {}) {
  const row = {
    id: payload.id || randomUUID(),
    lodge_id: state.lodgeId || payload.lodge_id || null,
    booking_id: payload.booking_id || null,
    invoice_number: payload.invoice_number || null,
    delivery_type: payload.delivery_type || 'invoice_email',
    delivery_status: payload.delivery_status || 'completed',
    recipient: payload.recipient || null,
    file_path: payload.file_path || null,
    render_version: payload.render_version || null,
    initiated_by: state.currentUser?.id || payload.initiated_by || null,
    initiated_by_name: state.currentUser?.name || payload.initiated_by_name || null,
    metadata: payload.metadata || {},
    created_at: new Date().toISOString(),
    local_only: !state.isOnline
  };

  if (!state.isOnline || !state.lodgeId) {
    appendAuxiliaryLog(LOCAL_INVOICE_DELIVERY_FILE, row, 300);
    return { success: true, localOnly: true, row };
  }

  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('record_invoice_delivery', {
    p_lodge_id: state.lodgeId,
    p_booking_id: payload.booking_id || null,
    p_invoice_number: payload.invoice_number || null,
    p_delivery_type: payload.delivery_type || 'invoice_email',
    p_delivery_status: payload.delivery_status || 'completed',
    p_recipient: payload.recipient || null,
    p_file_path: payload.file_path || null,
    p_render_version: payload.render_version || null,
    p_initiated_by: state.currentUser?.id || null,
    p_metadata: payload.metadata || {}
  });

  if (error) throw new Error(error.message);
  return { success: data?.success !== false, id: data?.id || null, row: { ...row, local_only: false } };
}

/** @param {{bookingId?: string|null, limit?: number}} [options] */
export async function getInvoiceDeliveryHistory({ bookingId = null, limit = 100 } = {}) {
  const localRows = readAuxiliaryLog(LOCAL_INVOICE_DELIVERY_FILE).
  filter((row) => !bookingId || /** @type {InvoiceDeliveryHistoryExpectedView} */ (row).booking_id === bookingId).
  slice(0, limit);

  if (!state.isOnline || !state.lodgeId) return localRows;

  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_invoice_delivery_history', {
    p_lodge_id: state.lodgeId,
    p_booking_id: bookingId || null,
    p_limit: limit
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.map((row) => ({ ...row, local_only: false })) : [];
}

/** @param {unknown} value @returns {string|undefined} */
function stableFinancialJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableFinancialJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableFinancialJson((/** @type {Record<string, unknown>} */ (value))[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

/** @param {unknown} summary */
function hashFinancialReport(summary) {
  // Reports created here are objects; malformed persisted summaries retain the existing crypto update failure.
  return createHash('sha256').update(/** @type {string} */ (stableFinancialJson(summary))).digest('hex');
}

/** @returns {ValidationRunJournalExpectedView[]} */
function readValidationRunsStrict() {
  if (!state.cacheDir) throw new Error('Local validation storage is unavailable. No audit run was submitted.');
  const filePath = path.join(state.cacheDir, FINANCIAL_VALIDATION_RUNS_FILE);
  if (!fs.existsSync(filePath)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error('The local validation journal is unreadable. Preserve it and contact support before retrying.');
  }
  if (!Array.isArray(parsed)) throw new Error('The local validation journal has an unsupported format. Preserve it and contact support.');
  // Expected persisted-row view after the existing parse and array checks; JSON.parse is not validation.
  return /** @type {ValidationRunJournalExpectedView[]} */ (parsed);
}

/** @param {ValidationRunJournalExpectedView[]} rows */
function persistValidationRuns(rows) {
  if (!state.cacheDir) throw new Error('Local validation storage is unavailable. No audit run was submitted.');
  fs.mkdirSync(state.cacheDir, { recursive: true });
  const filePath = path.join(state.cacheDir, FINANCIAL_VALIDATION_RUNS_FILE);
  const tempPath = filePath + '.' + process.pid + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(tempPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(rows, null, 2), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

/** @param {ValidationRunJournalExpectedView} run */
function saveValidationRun(run) {
  const rows = readValidationRunsStrict();
  const index = rows.findIndex((row) => row?.id === run.id);
  if (index >= 0) {
    const prior = rows[index];
    if (prior.report_hash !== run.report_hash || prior.lodge_id !== run.lodge_id ||
        prior.triggered_by !== run.triggered_by || stableFinancialJson(prior.summary) !== stableFinancialJson(run.summary)) {
      throw new Error('The local validation run identity is already bound to a different report. Preserve both records and contact support.');
    }
    rows[index] = { ...prior, ...run };
  } else {
    rows.unshift(run);
  }
  const unresolved = rows.filter((row) => row?.persistence_state !== 'confirmed');
  const confirmed = rows.filter((row) => row?.persistence_state === 'confirmed').slice(0, 120);
  persistValidationRuns(unresolved.concat(confirmed));
  return run;
}

/** @param {unknown} data @param {ValidationRunJournalExpectedView} run */
function hasValidValidationReceipt(data, run) {
  return !!data && typeof data === 'object' && !Array.isArray(data) &&
    (/** @type {{success?: unknown, recorded?: unknown, run_id?: unknown, report_hash?: unknown}} */ (data)).success === true &&
    (/** @type {{success?: unknown, recorded?: unknown, run_id?: unknown, report_hash?: unknown}} */ (data)).recorded === true &&
    (/** @type {{success?: unknown, recorded?: unknown, run_id?: unknown, report_hash?: unknown}} */ (data)).run_id === run.id &&
    (/** @type {{success?: unknown, recorded?: unknown, run_id?: unknown, report_hash?: unknown}} */ (data)).report_hash === run.report_hash;
}

/** @param {ValidationRunJournalExpectedView} run */
async function dispatchValidationRun(run) {
  if (!state.isOnline || !state.supabase || !state.lodgeId) {
    return { run, confirmed: false, error: 'Connect to the server to record this validation run.' };
  }

  const submitting = { ...run, persistence_state: 'submitting', local_only: true, server_confirmed: false, error: null };
  saveValidationRun(submitting);

  let response;
  try {
    response = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('record_financial_validation_run_v2', {
      p_lodge_id: run.lodge_id,
      p_run_id: run.id,
      p_idempotency_key: run.id,
      p_report_hash: run.report_hash,
      p_trigger_source: run.trigger_source,
      p_triggered_by: run.triggered_by,
      p_summary: run.summary
    });
  } catch (error) {
    const unknown = { ...submitting, persistence_state: 'unknown', error: 'The server response was lost. Retry this saved run to check the same run ID.' };
    saveValidationRun(unknown);
    return { run: unknown, confirmed: false, error: unknown.error };
  }

  if (response?.error) {
    const message = String(response.error.message || 'The server rejected the validation record.');
    const definitive = ['42501', '23505', '22023', 'P0001'].includes(String(response.error.code || ''));
    const rejected = { ...submitting, persistence_state: definitive ? 'rejected' : 'unknown', error: message };
    saveValidationRun(rejected);
    return { run: rejected, confirmed: false, error: message };
  }

  if (!hasValidValidationReceipt(response?.data, run)) {
    const rejected = {
      ...submitting,
      persistence_state: 'rejected',
      error: 'The server returned no matching validation receipt. Retry the same saved run after checking access.'
    };
    saveValidationRun(rejected);
    return { run: rejected, confirmed: false, error: rejected.error };
  }

  const confirmed = {
    ...submitting,
    persistence_state: 'confirmed',
    local_only: false,
    server_confirmed: true,
    server_receipt: { run_id: run.id, report_hash: run.report_hash, recorded_at: response.data.recorded_at || null },
    error: null
  };
  try {
    saveValidationRun(confirmed);
  } catch (error) {
    return {
      run: { ...submitting, persistence_state: 'unknown', local_only: true, server_confirmed: false, error: 'The server confirmed the run, but its receipt could not be saved locally. Retry this same run to recover the receipt.' },
      confirmed: false,
      error: (/** @type {{message: unknown}} */ (error)).message
    };
  }
  return { run: confirmed, confirmed: true, error: null };
}

/** @param {{triggerSource?: string}} [options] */
export async function runFinancialValidation({ triggerSource = 'manual' } = {}) {
  if (!state.currentUser?.id || !state.lodgeId) return { success: false, error: 'Sign in to an authorized lodge account before running financial validation.' };
  const validation = await getFinancialValidationSummary();
  const reconciliation = validation?.reconciliation;
  if (!reconciliation?.complete || reconciliation?.unavailable || !reconciliation?.schema_version ||
      reconciliation?.calculation_version !== 'financial-reconciliation-v1') {
    return {
      success: false,
      run: null,
      validation,
      error: validation?.message || 'A complete online reconciliation is required before a validation run can be recorded.'
    };
  }

  if (!reconciliation.reportId || !reconciliation.reportHash ||
      !reconciliation.serverReport || reconciliation.serverReport.lodge_id !== state.lodgeId) {
    return { success: false, run: null, validation, error: 'The server did not return an immutable reconciliation report receipt. Run validation again while online.' };
  }
  const summary = reconciliation.serverReport;
  const run = {
    id: randomUUID(),
    lodge_id: state.lodgeId,
    // The signed-in auth producer supplies string IDs/names; preserve the current truthy fallback without adding validation.
    triggered_by: /** @type {string|null} */ (state.currentUser?.id || null),
    triggered_by_name: /** @type {string|null} */ (state.currentUser?.name || null),
    trigger_source: ['manual', 'scheduled', 'startup'].includes(triggerSource) ? triggerSource : 'manual',
    date_key: getLocalDateKey(new Date(), LOCAL_TIME_ZONE),
    summary,
    report_hash: hashFinancialReport(summary),
    created_at: new Date().toISOString(),
    calculation_state: 'complete',
    persistence_state: 'prepared',
    server_confirmed: false,
    local_only: true,
    error: null
  };

  try {
    saveValidationRun(run);
  } catch (error) {
    return { success: false, run: { ...run, persistence_state: 'unavailable' }, validation, error: 'The report was calculated but could not be saved locally, so it was not submitted. ' + (/** @type {{message: unknown}} */ (error)).message };
  }

  const persisted = await dispatchValidationRun(run);
  const issueCount = Object.values(reconciliation.summary || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  if (issueCount > 0) {
    appendAuxiliaryLog(FINANCIAL_VALIDATION_ALERTS_FILE, {
      id: randomUUID(),
      at: new Date().toISOString(),
      lodge_id: state.lodgeId,
      trigger_source: run.trigger_source,
      issue_count: issueCount,
      totals: reconciliation.summary,
      report_hash: run.report_hash,
      local_only: true
    }, 120);
  }

  logActivity(
    'financial_validation_run',
    'Financial validation calculation complete · ' + run.trigger_source + ' · ' + issueCount + ' mismatch(es) · persistence ' + persisted.run.persistence_state
  );

  return {
    success: persisted.confirmed,
    run: persisted.run,
    validation,
    ...(persisted.error ? { error: persisted.error } : {})
  };
}

/** @param {string} runId */
export async function retryFinancialValidationRun(runId) {
  if (!state.isOnline || !state.lodgeId) return { success: false, error: 'Connect to the server and select the original lodge before retrying.' };
  if (typeof runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(runId)) return { success: false, error: 'Invalid validation run ID.' };
  const rows = readValidationRunsStrict();
  const run = rows.find((row) => row?.id === runId);
  if (!run) return { success: false, error: 'The saved validation run was not found on this computer.' };
  if (run.lodge_id !== state.lodgeId || run.triggered_by !== (state.currentUser?.id || null)) {
    return { success: false, error: 'This validation run belongs to a different lodge or operator. Sign in with its original authorized account to recover it.' };
  }
  if (run.persistence_state === 'confirmed' && run.server_confirmed === true) {
    return { success: true, run, alreadyConfirmed: true };
  }
  if (run.calculation_state !== 'complete' || run.report_hash !== hashFinancialReport(run.summary)) {
    return { success: false, error: 'The saved report no longer matches its immutable hash. Preserve it and contact support.' };
  }
  const result = await dispatchValidationRun(run);
  return { success: result.confirmed, run: result.run, ...(result.error ? { error: result.error } : {}) };
}
/** @param {number} [limit] */
export async function getFinancialValidationAlerts(limit = 30) {
  const localAlerts = readAuxiliaryLog(FINANCIAL_VALIDATION_ALERTS_FILE).slice(0, limit);
  if (!state.isOnline || !state.lodgeId) return localAlerts;

  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_financial_validation_alerts', {
      p_lodge_id: state.lodgeId,
      p_limit: limit
    });
    if (error) throw error;
    return Array.isArray(data) ? data.map((row) => ({ ...row, local_only: false })) : localAlerts;
  } catch (error) {
    recordCriticalError('financial.validation.alerts', error, { limit }, { level: 'warn', limit: 120 });
    return localAlerts;
  }
}


/** @param {number} [limit] */
export async function getFinancialValidationRuns(limit = 30) {
  /** @type {ValidationRunJournalExpectedView[]} */
  let localRuns = [];
  try {
    localRuns = readValidationRunsStrict();
  } catch (error) {
    recordCriticalError('financial.validation.local_journal', error, { lodge_id: state.lodgeId }, { level: 'warn', limit: 120 });
  }
  const boundedLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  if (!state.isOnline || !state.lodgeId) return localRuns.slice(0, boundedLimit);

  try {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_financial_validation_runs_v2', {
      p_lodge_id: state.lodgeId,
      p_limit: boundedLimit
    });
    if (error) throw new Error(error.message);
    const serverRuns = Array.isArray(data) ? data.map(/** @param {ServerFinancialValidationRunExpectedView} row */ (row) => ({
      ...row,
      id: row.id || row.run_id,
      local_only: false,
      server_confirmed: row.server_confirmed === true,
      persistence_state: row.persistence_state || (row.report_hash ? 'confirmed' : 'historical')
    })) : [];
    const serverById = new Map(serverRuns.map((run) => [run.id, run]));
    const localPending = [];
    for (const local of localRuns) {
      const server = serverById.get(local.id);
      if (server?.report_hash && server.report_hash === local.report_hash &&
          stableFinancialJson(server.summary) === stableFinancialJson(local.summary)) {
        const recovered = {
          ...local,
          persistence_state: 'confirmed',
          local_only: false,
          server_confirmed: true,
          server_receipt: { run_id: local.id, report_hash: local.report_hash, recorded_at: server.created_at || null },
          error: null
        };
        try { saveValidationRun(recovered); } catch (error) {
          recordCriticalError('financial.validation.receipt_recovery', error, { lodge_id: state.lodgeId, run_id: local.id }, { level: 'warn', limit: 120 });
          localPending.push(local);
        }
      } else if (server?.report_hash && server.report_hash !== local.report_hash) {
        localPending.push({
          ...local,
          persistence_state: 'rejected',
          error: 'The server has this run ID bound to a different report hash. Preserve both records and contact support.'
        });
      } else if (!server) {
        localPending.push(local);
      }
    }
    const filteredServer = serverRuns.filter((run) => !localRuns.some((local) => local.id === run.id && local.report_hash && run.report_hash && local.report_hash !== run.report_hash));
    return [...localPending, ...filteredServer].slice(0, boundedLimit);
  } catch (error) {
    recordCriticalError('financial.validation.runs', error, { lodge_id: state.lodgeId, limit: boundedLimit }, { level: 'warn', limit: 120 });
    return localRuns.slice(0, boundedLimit);
  }
}
/** @param {string} [triggerSource] */
export async function runScheduledFinancialValidation(triggerSource = 'scheduled') {
  if (!state.currentUser || !state.lodgeId) return { success: false, skipped: true, reason: 'Not signed in' };
  // Command Central identity and a cached/offline operator do not establish
  // an authenticated business RPC session. Wait for staff sign-in rather
  // than writing predictable access-denied startup faults into this profile.
  if (state.currentUser.isMasterAdmin || !state.backendSession?.token || !state.isOnline) {
    return { success: false, skipped: true, reason: 'Waiting for an online business staff session' };
  }
  const todayKey = getLocalDateKey(new Date(), LOCAL_TIME_ZONE);
  const existingRuns = readAuxiliaryLog(FINANCIAL_VALIDATION_RUNS_FILE);
  const alreadyRanToday = existingRuns.some((row) => {
    const expected = /** @type {{lodge_id?: unknown, date_key?: unknown}|null|undefined} */ (row);
    return expected?.lodge_id === state.lodgeId && expected?.date_key === todayKey;
  });
  if (alreadyRanToday) return { success: true, skipped: true, reason: 'Already ran today' };
  return runFinancialValidation({ triggerSource });
}
