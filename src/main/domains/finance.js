import { state } from '../state.js'
import {
  getNextInvoiceNumberByLookup,
  isMissingInvoiceNumberRpcError,
  normalizePlanName,
  requireAdmin
} from './infrastructure.js'

export {
  getFinancialAuditLog,
  getFinancialReconciliation,
  getFinancialValidationSummary,
  recordInvoiceDelivery,
  getInvoiceDeliveryHistory,
  runFinancialValidation,
  getFinancialValidationAlerts,
  getSupportBundle,
  getOfflineSafetyData,
  publishDeviceHealth,
  getDeviceHealthRollup,
  getFinancialValidationRuns,
  runScheduledFinancialValidation
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
