// @ts-check
import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

/** @param {unknown} status @param {unknown} startDate @param {unknown} endDate @returns {Promise<unknown>} */
async function _getBills(status, startDate, endDate) {
  if (state.isOnline) {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_bills', {
      p_lodge_id: state.lodgeId,
      p_status: status || null,
      p_start_date: startDate || null,
      p_end_date: endDate || null,
    });
    if (error) throw new Error(error.message);
    return data || [];
  }
  throw new Error('Accounts Payable requires an online connection');
}

/** @param {unknown} [status] @param {unknown} [startDate] @param {unknown} [endDate] @returns {Promise<unknown>} */
export function getBills(status, startDate, endDate) {
  const key = `getBills:${status || ''}:${startDate || ''}:${endDate || ''}`;
  return dedupePromise(key, () => _getBills(status, startDate, endDate));
}

/** @param {unknown} id @returns {Promise<unknown>} */
export async function getBillById(id) {
  if (!id) return null;
  // Preserve the existing .find call and its failure for non-array RPC data.
  const bills = /** @type {unknown[]} */ (await getBills());
  return bills.find((b) => /** @type {Record<string, unknown>} */ (b).id === id) || null;
}

/** @param {Record<string, unknown>} data @returns {Promise<unknown>} */
export async function createBill(data) {
  const { data: result, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_restaurant_bill', {
    p_lodge_id: state.lodgeId,
    p_supplier_id: data.supplier_id || null,
    p_supplier_name: data.supplier_name,
    p_bill_number: data.bill_number || null,
    p_bill_date: data.bill_date,
    p_due_date: data.due_date,
    p_notes: data.notes || null,
    p_items: data.items || [],
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not create bill');
  return result;
}

/** @param {unknown} id @param {Record<string, unknown>} data @returns {Promise<unknown>} */
export async function updateBill(id, data) {
  const { data: result, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_restaurant_bill', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_supplier_name: data.supplier_name || null,
    p_bill_number: data.bill_number || null,
    p_bill_date: data.bill_date || null,
    p_due_date: data.due_date || null,
    p_notes: data.notes || null,
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not update bill');
  return result;
}

/** @param {unknown} billId @param {unknown} items @returns {Promise<unknown>} */
export async function updateBillItems(billId, items) {
  const { data: result, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_bill_items', {
    p_bill_id: billId,
    p_lodge_id: state.lodgeId,
    p_items: items,
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not update bill items');
  return result;
}

/** @param {unknown} id @param {unknown} status @returns {Promise<unknown>} */
export async function updateBillStatus(id, status) {
  const { data: result, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_bill_status', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not update bill status');
  return result;
}

/** @param {unknown} billId @param {Record<string, unknown>} paymentData @returns {Promise<unknown>} */
export async function recordBillPayment(billId, paymentData) {
  const { data: result, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('record_bill_payment', {
    p_bill_id: billId,
    p_lodge_id: state.lodgeId,
    p_payment_date: paymentData.payment_date,
    p_amount: paymentData.amount,
    p_payment_method: paymentData.payment_method || 'bank_transfer',
    p_reference: paymentData.reference || null,
    p_notes: paymentData.notes || null,
    p_idempotency_key: paymentData.idempotency_key,
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not record payment');
  return result;
}

/** @param {unknown} billId @returns {Promise<unknown>} */
export async function getBillPayments(billId) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_bill_payments', {
    p_bill_id: billId,
    p_lodge_id: state.lodgeId,
  });
  if (error) throw new Error(error.message);
  return data || [];
}

/**  @returns {Promise<unknown>} */
export async function getApAging() {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_ap_aging', {
    p_lodge_id: state.lodgeId,
  });
  if (error) throw new Error(error.message);
  return data || {};
}

/**  @returns {Promise<unknown>} */
export async function getApSummary() {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_ap_summary', {
    p_lodge_id: state.lodgeId,
  });
  if (error) throw new Error(error.message);
  return data || {};
}
