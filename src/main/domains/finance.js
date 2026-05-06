import { randomUUID } from 'crypto'
import { state } from '../state.js'
import {
  getNextInvoiceNumberByLookup,
  isMissingInvoiceNumberRpcError,
  normalizePlanName,
  requireAdmin,
  roundMoneyValue,
  appendAuxiliaryLog,
  readAuxiliaryLog,
  getLocalDateKey,
  LOCAL_TIME_ZONE,
  logActivity,
  recordCriticalError
} from './infrastructure.js'

export {
} from './infrastructure.js'

// ─── INVOICES ────────────────────────────────────────────────────────────────────

export async function getNextInvoiceNumber() {
  // Use the same atomic DB sequence function as booking invoices to prevent
  // collisions under concurrent Command Central usage.
  const db = requireAdmin();
  const { data, error } = await db.rpc('get_next_invoice_number', { p_lodge_id: state.lodgeId });
  if (error) {
    if (!isMissingInvoiceNumberRpcError(error)) {
      throw new Error('Failed to generate invoice number: ' + error.message);
    }
    console.warn('[Invoices] get_next_invoice_number RPC unavailable for admin flow, falling back to lookup:', error.message);
    return await getNextInvoiceNumberByLookup(db);
  }
  return data;
}

export async function createInvoice(data) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { data: row, error } = await requireAdmin().from('invoices').insert(data).select().single();
  if (error) throw new Error(error.message);
  return row;
}

export async function getInvoices(filters = {}) {
  if (!state.isOnline) return [];
  let q = requireAdmin().from('invoices').select('*').order('created_at', { ascending: false });
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id);
  if (filters.status) q = q.eq('status', filters.status);
  const { data } = await q;
  return data || [];
}

export async function getInvoicesByLodge(lodgeId) {
  if (!state.isOnline) return [];
  const { data } = await state.supabase.
  from('invoices').
  select('*').
  eq('lodge_id', lodgeId).
  order('issued_at', { ascending: false });
  return data || [];
}

export async function updateInvoice(id, updates) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('invoices').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
  return { success: true };
}

export async function deleteInvoice(id) {
  if (!state.isOnline) throw new Error('Requires internet connection');
  const { error } = await requireAdmin().from('invoices').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getInvoiceSummary() {
  if (!state.isOnline) return { total: 0, byPlan: {}, byMonth: [], allRows: [] };
  const { data } = await requireAdmin().
  from('invoices').
  select('amount, currency, package_name, issued_date, status');
  const allRows = data || [];
  const paid = allRows.filter((r) => r.status === 'paid');
  const total = paid.reduce((s, r) => s + Number(r.amount), 0);
  const byPlan = {};
  paid.forEach((r) => {
    const planName = normalizePlanName(r.package_name);
    byPlan[planName] = (byPlan[planName] || 0) + Number(r.amount);
  });
  const byMonthMap = {};
  paid.forEach((r) => {
    const m = (r.issued_date || '').slice(0, 7);
    if (m) byMonthMap[m] = (byMonthMap[m] || 0) + Number(r.amount);
  });
  const byMonth = Object.entries(byMonthMap).
  sort(([a], [b]) => a.localeCompare(b)).
  map(([month, amount]) => ({ month, amount }));
  const currency = paid[0]?.currency || 'USD';
  return { total, byPlan, byMonth, currency, allRows };
}


const FINANCIAL_VALIDATION_RUNS_FILE = 'financial-validation-runs.json';
const FINANCIAL_VALIDATION_ALERTS_FILE = 'financial-validation-alerts.json';
const LOCAL_INVOICE_DELIVERY_FILE = 'invoice-delivery-history.json';

export async function getFinancialAuditLog({ bookingId = null, limit = 100, offset = 0 } = {}) {
  if (!state.lodgeId || !state.isOnline) return [];
  const { data, error } = await state.supabase.rpc('get_financial_audit_log', {
    p_lodge_id: state.lodgeId,
    p_booking_id: bookingId || null,
    p_limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    p_offset: Math.max(Number(offset) || 0, 0)
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}


function moneyMismatch(left, right, tolerance = 0.01) {
  return Math.abs(roundMoneyValue(left) - roundMoneyValue(right)) > tolerance;
}

export async function getFinancialReconciliation() {
  if (!state.lodgeId) {
    return {
      summary: { paymentMismatches: 0, chargeMismatches: 0, invoiceGaps: 0, orphanInvoices: 0, folioPosMismatches: 0 },
      paymentMismatches: [],
      chargeMismatches: [],
      invoiceGaps: [],
      orphanInvoices: [],
      folioPosMismatches: []
    };
  }

  let bookings = [];
  let payments = [];
  let charges = [];
  let invoices = [];
  let posOrders = [];

  if (state.isOnline) {
    const [
    bookingsResult,
    paymentsResult,
    chargesResult,
    invoicesResult,
    posOrdersResult] =
    await Promise.all([
    state.supabase.from('bookings').select('id, invoice_number, total_amount, charges_total, amount_paid, status, payment_status, check_in, check_out, updated_at').eq('lodge_id', state.lodgeId),
    state.supabase.from('payments').select('booking_id, amount, type, paid_at').eq('lodge_id', state.lodgeId),
    state.supabase.from('booking_charges').select('id, booking_id, amount, description, voided_at, void_reason, created_at').eq('lodge_id', state.lodgeId),
    state.supabase.from('invoices').select('id, booking_id, invoice_number, issued_at, created_at').eq('lodge_id', state.lodgeId),
    state.supabase.from('pos_orders').select('id, booking_id, total, payment_method, status, folio_charge_id, created_at').eq('lodge_id', state.lodgeId)]
    );

    if (bookingsResult.error) throw new Error(bookingsResult.error.message);
    if (paymentsResult.error) throw new Error(paymentsResult.error.message);
    if (chargesResult.error) throw new Error(chargesResult.error.message);
    if (invoicesResult.error) throw new Error(invoicesResult.error.message);
    if (posOrdersResult.error) throw new Error(posOrdersResult.error.message);

    bookings = bookingsResult.data || [];
    payments = paymentsResult.data || [];
    charges = chargesResult.data || [];
    invoices = invoicesResult.data || [];
    posOrders = posOrdersResult.data || [];
  } else {
    // P0-3: offline reconciliation is INVALID — payment/charge/invoice tables cannot
    // be queried. Return an explicitly invalid result so the UI cannot show "clear".
    return {
      local_only: true,
      valid: false,
      checked_at: new Date().toISOString(),
      summary: { paymentMismatches: 0, chargeMismatches: 0, invoiceGaps: 0, orphanInvoices: 0, folioPosMismatches: 0 },
      paymentMismatches: [],
      chargeMismatches: [],
      invoiceGaps: [],
      orphanInvoices: [],
      folioPosMismatches: [],
      message: 'Reconciliation cannot be verified while offline. Connect to the internet and run again.'
    };
  }

  const paymentsByBooking = new Map();
  for (const payment of payments) {
    const bookingId = payment?.booking_id;
    if (!bookingId) continue;
    paymentsByBooking.set(bookingId, roundMoneyValue((paymentsByBooking.get(bookingId) || 0) + Number(payment.amount || 0)));
  }

  const activeChargesByBooking = new Map();
  for (const charge of charges) {
    if (charge?.voided_at) continue;
    const bookingId = charge?.booking_id;
    if (!bookingId) continue;
    activeChargesByBooking.set(bookingId, roundMoneyValue((activeChargesByBooking.get(bookingId) || 0) + Number(charge.amount || 0)));
  }

  const invoiceByBooking = new Map();
  for (const invoice of invoices) {
    if (!invoice?.booking_id) continue;
    if (!invoiceByBooking.has(invoice.booking_id)) {
      invoiceByBooking.set(invoice.booking_id, invoice);
    }
  }

  const bookingIds = new Set(bookings.map((booking) => booking.id));
  const paymentMismatches = bookings.
  filter((booking) => !['cancelled'].includes(String(booking.status || '').toLowerCase())).
  map((booking) => {
    const paymentLedgerTotal = roundMoneyValue(paymentsByBooking.get(booking.id) || 0);
    const cachedAmountPaid = roundMoneyValue(booking.amount_paid || 0);
    return {
      booking_id: booking.id,
      invoice_number: booking.invoice_number || null,
      status: booking.status || '',
      booking_amount_paid: cachedAmountPaid,
      payment_ledger_total: paymentLedgerTotal,
      difference: roundMoneyValue(cachedAmountPaid - paymentLedgerTotal),
      updated_at: booking.updated_at || null
    };
  }).
  filter((row) => moneyMismatch(row.booking_amount_paid, row.payment_ledger_total)).
  sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference));

  const chargeMismatches = bookings.
  filter((booking) => !['cancelled'].includes(String(booking.status || '').toLowerCase())).
  map((booking) => {
    const chargeLedgerTotal = roundMoneyValue(activeChargesByBooking.get(booking.id) || 0);
    const cachedChargesTotal = roundMoneyValue(booking.charges_total || 0);
    return {
      booking_id: booking.id,
      invoice_number: booking.invoice_number || null,
      status: booking.status || '',
      booking_charges_total: cachedChargesTotal,
      charge_ledger_total: chargeLedgerTotal,
      difference: roundMoneyValue(cachedChargesTotal - chargeLedgerTotal),
      updated_at: booking.updated_at || null
    };
  }).
  filter((row) => moneyMismatch(row.booking_charges_total, row.charge_ledger_total)).
  sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference));

  const invoiceGaps = bookings.
  filter((booking) => String(booking.status || '').toLowerCase() !== 'cancelled').
  filter((booking) => !String(booking.invoice_number || '').trim() || !invoiceByBooking.has(booking.id)).
  map((booking) => ({
    booking_id: booking.id,
    invoice_number: booking.invoice_number || null,
    status: booking.status || '',
    check_in: booking.check_in || null,
    check_out: booking.check_out || null,
    missing_invoice_number: !String(booking.invoice_number || '').trim(),
    missing_invoice_row: !invoiceByBooking.has(booking.id)
  }));

  const orphanInvoices = invoices.
  filter((invoice) => !invoice?.booking_id || !bookingIds.has(invoice.booking_id)).
  map((invoice) => ({
    invoice_id: invoice.id,
    booking_id: invoice.booking_id || null,
    invoice_number: invoice.invoice_number || null,
    issued_at: invoice.issued_at || invoice.created_at || null
  }));

  const folioPosMismatches = (posOrders || []).
  filter((order) => String(order?.payment_method || '').toLowerCase() === 'folio').
  filter((order) => String(order?.status || '').toLowerCase() !== 'voided').
  map((order) => {
    const bookingId = order?.booking_id || null;
    const bookingExists = bookingId ? bookingIds.has(bookingId) : false;
    const matchingCharge = order?.folio_charge_id ?
    charges.find((charge) => charge.id === order.folio_charge_id && !charge.voided_at) :
    null;
    return {
      order_id: order.id,
      booking_id: bookingId,
      order_total: roundMoneyValue(order.total || 0),
      folio_charge_id: order.folio_charge_id || null,
      folio_charge_total: roundMoneyValue(matchingCharge?.amount || 0),
      issue: !bookingId ?
      'missing_booking' :
      !bookingExists ?
      'orphan_booking' :
      !order.folio_charge_id ?
      'missing_folio_charge' :
      !matchingCharge ?
      'missing_charge_row' :
      moneyMismatch(order.total || 0, matchingCharge.amount || 0) ?
      'amount_mismatch' :
      null,
      created_at: order.created_at || null
    };
  }).
  filter((row) => row.issue);

  return {
    valid: true,
    local_only: false,
    checked_at: new Date().toISOString(),
    summary: {
      paymentMismatches: paymentMismatches.length,
      chargeMismatches: chargeMismatches.length,
      invoiceGaps: invoiceGaps.length,
      orphanInvoices: orphanInvoices.length,
      folioPosMismatches: folioPosMismatches.length
    },
    paymentMismatches: paymentMismatches.slice(0, 50),
    chargeMismatches: chargeMismatches.slice(0, 50),
    invoiceGaps: invoiceGaps.slice(0, 50),
    orphanInvoices: orphanInvoices.slice(0, 50),
    folioPosMismatches: folioPosMismatches.slice(0, 50)
  };
}

export async function getFinancialValidationSummary() {
  const reconciliation = await getFinancialReconciliation();
  const auditRows = state.isOnline ? await getFinancialAuditLog({ limit: 200 }) : [];

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
      orphan_invoices: reconciliation.summary.orphanInvoices
    },
    recentRefunds,
    recentChargeVoids,
    reconciliation
  };
}

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

  const { data, error } = await state.supabase.rpc('record_invoice_delivery', {
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

export async function getInvoiceDeliveryHistory({ bookingId = null, limit = 100 } = {}) {
  const localRows = readAuxiliaryLog(LOCAL_INVOICE_DELIVERY_FILE).
  filter((row) => !bookingId || row.booking_id === bookingId).
  slice(0, limit);

  if (!state.isOnline || !state.lodgeId) return localRows;

  const { data, error } = await state.supabase.rpc('get_invoice_delivery_history', {
    p_lodge_id: state.lodgeId,
    p_booking_id: bookingId || null,
    p_limit: limit
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.map((row) => ({ ...row, local_only: false })) : [];
}

export async function runFinancialValidation({ triggerSource = 'manual' } = {}) {
  const validation = await getFinancialValidationSummary();
  const run = {
    id: randomUUID(),
    lodge_id: state.lodgeId,
    triggered_by: state.currentUser?.id || null,
    triggered_by_name: state.currentUser?.name || null,
    trigger_source: ['manual', 'scheduled', 'startup'].includes(triggerSource) ? triggerSource : 'manual',
    date_key: getLocalDateKey(new Date(), LOCAL_TIME_ZONE),
    summary: {
      checked_at: validation.checked_at,
      totals: validation.totals,
      sample: {
        recent_refunds: validation.recentRefunds || [],
        recent_charge_voids: validation.recentChargeVoids || []
      }
    },
    created_at: new Date().toISOString(),
    local_only: !state.isOnline
  };

  appendAuxiliaryLog(FINANCIAL_VALIDATION_RUNS_FILE, run, 120);

  const issueCount =
  Number(validation?.totals?.payment_mismatches || 0) +
  Number(validation?.totals?.charge_mismatches || 0) +
  Number(validation?.totals?.folio_pos_mismatches || 0) +
  Number(validation?.totals?.invoice_gaps || 0) +
  Number(validation?.totals?.orphan_invoices || 0);

  if (issueCount > 0) {
    appendAuxiliaryLog(FINANCIAL_VALIDATION_ALERTS_FILE, {
      id: randomUUID(),
      at: new Date().toISOString(),
      lodge_id: state.lodgeId || null,
      trigger_source: run.trigger_source,
      issue_count: issueCount,
      totals: validation.totals
    }, 120);
  }

  if (state.isOnline && state.lodgeId) {
    try {
      await state.supabase.rpc('record_financial_validation_run', {
        p_lodge_id: state.lodgeId,
        p_trigger_source: run.trigger_source,
        p_triggered_by: state.currentUser?.id || null,
        p_summary: run.summary
      });
      run.local_only = false;
    } catch (error) {
      console.warn('record_financial_validation_run failed:', error?.message || error);
    }
  }

  logActivity(
    'financial_validation_run',
    `Financial validation run · ${run.trigger_source} · ${validation.totals.payment_mismatches || 0} payment mismatches · ${validation.totals.charge_mismatches || 0} charge mismatches · ${validation.totals.folio_pos_mismatches || 0} folio POS mismatches · ${validation.totals.invoice_gaps || 0} invoice gaps`
  );

  return { success: true, run, validation };
}

export async function getFinancialValidationAlerts(limit = 30) {
  const localAlerts = readAuxiliaryLog(FINANCIAL_VALIDATION_ALERTS_FILE).slice(0, limit);
  if (!state.isOnline || !state.lodgeId) return localAlerts;

  try {
    const { data, error } = await state.supabase.rpc('get_financial_validation_alerts', {
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


export async function getFinancialValidationRuns(limit = 30) {
  const localRuns = readAuxiliaryLog(FINANCIAL_VALIDATION_RUNS_FILE).slice(0, limit);
  if (!state.isOnline || !state.lodgeId) return localRuns;

  const { data, error } = await state.supabase.rpc('get_financial_validation_runs', {
    p_lodge_id: state.lodgeId,
    p_limit: limit
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.map((row) => ({ ...row, local_only: false })) : [];
}

export async function runScheduledFinancialValidation(triggerSource = 'scheduled') {
  if (!state.currentUser || !state.lodgeId) return { success: false, skipped: true, reason: 'Not signed in' };
  const todayKey = getLocalDateKey(new Date(), LOCAL_TIME_ZONE);
  const existingRuns = readAuxiliaryLog(FINANCIAL_VALIDATION_RUNS_FILE);
  const alreadyRanToday = existingRuns.some((row) => row?.lodge_id === state.lodgeId && row?.date_key === todayKey);
  if (alreadyRanToday) return { success: true, skipped: true, reason: 'Already ran today' };
  return runFinancialValidation({ triggerSource });
}

