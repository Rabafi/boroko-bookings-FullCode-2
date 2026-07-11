import { state } from '../state.js';
import { readCache, writeCache, queueOperation, dedupePromise } from './infrastructure.js';

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
    if (cached.length > 0) return cached;
    throw new Error(err?.message || 'Failed to load corporate billing');
  }
}

export function getAllCorporateBilling() {
  return dedupePromise('corporateBilling', _getAllCorporateBilling);
}

export async function chargeToCorporateAccount(accountId, bookingId, amount, description) {
  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('charge_to_corporate_account', {
      p_account_id: accountId,
      p_lodge_id: state.lodgeId,
      p_booking_id: bookingId,
      p_amount: amount,
      p_description: description || ''
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not charge to corporate account');
    return data;
  } else {
    queueOperation('rpc', 'charge_to_corporate_account', {
      p_account_id: accountId,
      p_lodge_id: state.lodgeId,
      p_booking_id: bookingId,
      p_amount: amount,
      p_description: description || ''
    }, null, { _queue_id: `corp-charge-${accountId}-${Date.now()}` });
    return { success: true, offline: true };
  }
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

export async function recordCorporatePayment(accountId, invoiceIds, amount, method, reference) {
  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('record_corporate_payment', {
      p_account_id: accountId,
      p_lodge_id: state.lodgeId,
      p_invoice_ids: invoiceIds,
      p_amount: amount,
      p_payment_method: method || 'bank_transfer',
      p_reference: reference || ''
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not record payment');
    return data;
  } else {
    queueOperation('rpc', 'record_corporate_payment', {
      p_account_id: accountId,
      p_lodge_id: state.lodgeId,
      p_invoice_ids: invoiceIds,
      p_amount: amount,
      p_payment_method: method || 'bank_transfer',
      p_reference: reference || ''
    }, null, { _queue_id: `corp-pay-${accountId}-${Date.now()}` });
    return { success: true, offline: true };
  }
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
    return { success: true, within_limit: true, offline: true };
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
  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('suspend_corporate_account', {
      p_account_id: accountId,
      p_lodge_id: state.lodgeId,
      p_reason: reason || ''
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not suspend account');
    return data;
  } else {
    queueOperation('rpc', 'suspend_corporate_account', {
      p_account_id: accountId,
      p_lodge_id: state.lodgeId,
      p_reason: reason || ''
    }, null, { _queue_id: `corp-suspend-${accountId}` });
    return { success: true, offline: true };
  }
}

export async function reactivateCorporateAccount(accountId) {
  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('reactivate_corporate_account', {
      p_account_id: accountId,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not reactivate account');
    return data;
  } else {
    queueOperation('rpc', 'reactivate_corporate_account', {
      p_account_id: accountId,
      p_lodge_id: state.lodgeId
    }, null, { _queue_id: `corp-react-${accountId}` });
    return { success: true, offline: true };
  }
}
