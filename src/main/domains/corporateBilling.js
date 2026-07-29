import { state } from '../state.js';
import { readCache, writeCache, dedupePromise } from './infrastructure.js';

/**
 * Corporate billing financial/status mutations are ONLINE-ONLY (docs/OFFLINE_MATRIX.md).
 * They must never be silently queued — charge, payment, and account status require server locks.
 */
function requireOnline(operation) {
  if (!state.isOnline) {
    const err = new Error(
      `${operation} requires an internet connection. Corporate billing mutations cannot be queued offline.`
    );
    err.onlineOnly = true;
    throw err;
  }
}

function stableIdempotencyKey(prefix, parts = []) {
  return [prefix, state.lodgeId, ...parts]
    .filter((p) => p !== null && p !== undefined && p !== '')
    .join(':')
    .slice(0, 180);
}

async function _getAllCorporateBilling() {
  if (!state.isOnline) return readCache('corporate-invoices');
  try {
    const { data, error } = await state.supabase
      .from('corporate_invoice_items')
      .select('*, corporate_payments(*)')
      .eq('lodge_id', state.lodgeId)
      .order('issue_date', { ascending: false });
    if (error) throw error;
    writeCache('corporate-invoices', data || []);
    return data || [];
  } catch (err) {
    const cached = readCache('corporate-invoices');
    if (cached?.length > 0) return cached;
    throw new Error(err?.message || 'Failed to load corporate billing');
  }
}

export function getAllCorporateBilling() {
  return dedupePromise('corporateBilling', _getAllCorporateBilling);
}

/**
 * Charge a booking settlement to a corporate account via authoritative RPC.
 * @param {string} accountId
 * @param {string} bookingId
 * @param {number} amount
 * @param {string} description
 * @param {{ settleBooking?: boolean, idempotencyKey?: string }} [options]
 */
export async function chargeToCorporateAccount(accountId, bookingId, amount, description, options = {}) {
  requireOnline('Charge to corporate account');
  if (!accountId) throw new Error('Corporate account is required');
  if (!bookingId) throw new Error('Booking is required for corporate settlement');

  const settleBooking = options.settleBooking !== false;
  const key = options.idempotencyKey
    || stableIdempotencyKey('corp-charge', [accountId, bookingId, amount, description, settleBooking]);

  // p_idempotency_key and p_settle_booking are supported by 20260714200000 migration
  const { data, error } = await state.supabase.rpc('charge_to_corporate_account', {
    p_account_id: accountId,
    p_lodge_id: state.lodgeId,
    p_booking_id: bookingId,
    p_amount: amount,
    p_description: description || '',
    p_settle_booking: settleBooking,
    p_idempotency_key: key
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not charge to corporate account');
  return { ...data, idempotency_key: key };
}

export async function getCorporateOutstanding(accountId) {
  if (!state.isOnline) return readCache('corporate-outstanding');
  try {
    const { data, error } = await state.supabase.rpc('get_corporate_outstanding', {
      p_account_id: accountId,
      p_lodge_id: state.lodgeId
    });
    if (error) throw error;
    writeCache('corporate-outstanding', data);
    return data;
  } catch (err) {
    const cached = readCache('corporate-outstanding');
    if (cached) return cached;
    throw new Error(err?.message || 'Failed to get outstanding');
  }
}

export async function recordCorporatePayment(accountId, invoiceIds, amount, method, reference, options = {}) {
  requireOnline('Record corporate payment');
  if (!accountId) throw new Error('Corporate account is required');

  const key = options.idempotencyKey
    || stableIdempotencyKey('corp-pay', [accountId, amount, method, reference, ...(invoiceIds || [])]);

  const { data, error } = await state.supabase.rpc('record_corporate_payment', {
    p_account_id: accountId,
    p_lodge_id: state.lodgeId,
    p_invoice_ids: invoiceIds,
    p_amount: amount,
    p_payment_method: method || 'bank_transfer',
    p_reference: reference || '',
    p_idempotency_key: key
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not record payment');
  return { ...data, idempotency_key: key };
}

export async function getCorporateStatement(accountId, periodStart, periodEnd) {
  if (!state.isOnline) return readCache('corporate-statement');
  try {
    const { data, error } = await state.supabase.rpc('get_corporate_statement', {
      p_account_id: accountId,
      p_lodge_id: state.lodgeId,
      p_period_start: periodStart,
      p_period_end: periodEnd
    });
    if (error) throw error;
    writeCache('corporate-statement', data);
    return data;
  } catch (err) {
    const cached = readCache('corporate-statement');
    if (cached) return cached;
    throw new Error(err?.message || 'Failed to get statement');
  }
}

export async function checkCreditLimitWithPending(accountId, pendingAmount) {
  if (!state.isOnline) {
    // Offline cannot authoritatively check credit — do not invent "within limit".
    return {
      success: false,
      within_limit: false,
      offline: true,
      onlineOnly: true,
      error: 'Credit limit check requires an internet connection'
    };
  }
  const { data, error } = await state.supabase.rpc('check_credit_limit_with_pending', {
    p_account_id: accountId,
    p_lodge_id: state.lodgeId,
    p_pending_amount: pendingAmount
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function suspendCorporateAccount(accountId, reason) {
  requireOnline('Suspend corporate account');
  const { data, error } = await state.supabase.rpc('suspend_corporate_account', {
    p_account_id: accountId,
    p_lodge_id: state.lodgeId,
    p_reason: reason || ''
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not suspend account');
  return data;
}

export async function reactivateCorporateAccount(accountId) {
  requireOnline('Reactivate corporate account');
  const { data, error } = await state.supabase.rpc('reactivate_corporate_account', {
    p_account_id: accountId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not reactivate account');
  return data;
}

export { requireOnline as requireCorporateBillingOnline, stableIdempotencyKey as corporateIdempotencyKey };
