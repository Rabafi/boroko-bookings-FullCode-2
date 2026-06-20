import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { readCache, writeCache, refreshCache, queueOperation, logActivity, createBackup } from './infrastructure.js';
import { recordCriticalError } from './operationalLog.js';

// ─── CUSTOMER CREDIT ─────────────────────────────────────────────────────────

function buildCreditIdempotencyKey(prefix, operationData) {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(operationData))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}:${digest}`.slice(0, 128);
}

export async function getCustomerCreditBalance(customerId) {
  if (!customerId) return { success: true, balance: 0 };
  if (!state.isOnline) {
    const entries = readCache('customer-credit-ledger') || [];
    const balance = entries
      .filter((e) => e.customer_id === customerId && e.lodge_id === state.lodgeId)
      .reduce((sum, e) => {
        if (['receipt', 'adjustment_in', 'reversal_in'].includes(e.entry_type)) return sum + Number(e.amount);
        if (['booking_allocation', 'refund', 'adjustment_out', 'reversal_out'].includes(e.entry_type)) return sum - Number(e.amount);
        return sum;
      }, 0);
    return { success: true, balance: Math.round(balance * 100) / 100 };
  }
  try {
    const { data, error } = await state.supabase.rpc('get_customer_credit_balance', {
      p_lodge_id: state.lodgeId,
      p_customer_id: customerId
    });
    if (error) throw new Error(error.message);
    return data || { success: true, balance: 0 };
  } catch (error) {
    recordCriticalError('customerCredit.getBalance', error, { customer_id: customerId });
    return { success: true, balance: 0 };
  }
}

export async function getCustomerCreditHistory(customerId, limit = 50, offset = 0) {
  if (!customerId) return [];
  if (!state.isOnline) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_customer_credit_history', {
      p_lodge_id: state.lodgeId,
      p_customer_id: customerId,
      p_limit: limit,
      p_offset: offset
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    recordCriticalError('customerCredit.getHistory', error, { customer_id: customerId });
    return [];
  }
}

export async function getCustomerCreditSummary(search = null, limit = 50, offset = 0) {
  if (!state.isOnline) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_customer_credit_summary', {
      p_lodge_id: state.lodgeId,
      p_search: search || null,
      p_limit: limit,
      p_offset: offset
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    recordCriticalError('customerCredit.getSummary', error, { search });
    return [];
  }
}

export async function recordCustomerCredit({
  customerId,
  amount,
  method,
  reference,
  notes,
  recordedBy
}) {
  try {
    if (!customerId) throw new Error('Customer ID is required');
    if (!amount || amount <= 0) throw new Error('Amount must be greater than zero');
    if (!method) throw new Error('Payment method is required');

    const idempotencyKey = `customer-credit:receipt:${customerId}:${amount}:${method}:${Date.now()}`;

    if (state.isOnline) {
      const { data: result, error } = await state.supabase.rpc('record_customer_credit', {
        p_lodge_id: state.lodgeId,
        p_customer_id: customerId,
        p_amount: Number(amount),
        p_method: method,
        p_idempotency_key: idempotencyKey,
        p_reference: reference || '',
        p_notes: notes || '',
        p_recorded_by: recordedBy || state.currentUser?.id || null
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not record customer credit');

      await refreshCache('customers');
      const customer = readCache('customers').find((c) => c.id === customerId);
      logActivity(
        'customer_credit_received',
        `Advance payment received · ${customer?.name || 'Customer'} · ${Number(amount).toFixed(2)} (${method})`
      );
      createBackup();

      return {
        success: true,
        entry_id: result.entry_id,
        balance: result.balance,
        offline: false
      };
    } else {
      const entry = {
        id: randomUUID(),
        lodge_id: state.lodgeId,
        customer_id: customerId,
        entry_type: 'receipt',
        amount: Number(amount),
        method,
        reference: reference || '',
        notes: notes || '',
        booking_id: null,
        payment_id: null,
        reverses_entry_id: null,
        recorded_by: recordedBy || state.currentUser?.id || null,
        idempotency_key: idempotencyKey,
        created_at: new Date().toISOString(),
        _pending_sync: true
      };

      const cached = readCache('customer-credit-ledger') || [];
      cached.push(entry);
      writeCache('customer-credit-ledger', cached);

      queueOperation('rpc', 'record_customer_credit', {
        p_lodge_id: state.lodgeId,
        p_customer_id: customerId,
        p_amount: Number(amount),
        p_method: method,
        p_idempotency_key: idempotencyKey,
        p_reference: reference || '',
        p_notes: notes || '',
        p_recorded_by: recordedBy || state.currentUser?.id || null
      }, null, { _queue_id: `customer-credit-${entry.id}` });

      const balanceResult = await getCustomerCreditBalance(customerId);
      const customer = readCache('customers').find((c) => c.id === customerId);
      logActivity(
        'customer_credit_received',
        `Advance payment received (offline) · ${customer?.name || 'Customer'} · ${Number(amount).toFixed(2)} (${method})`
      );
      createBackup();

      return {
        success: true,
        entry_id: entry.id,
        balance: balanceResult.balance,
        offline: true,
        queued: true
      };
    }
  } catch (error) {
    recordCriticalError('customerCredit.record', error, {
      customer_id: customerId,
      amount: Number(amount || 0),
      method
    });
    throw error;
  }
}

export async function applyCustomerCreditToBooking({
  customerId,
  bookingId,
  amount,
  notes,
  recordedBy,
  expectedBookingUpdatedAt
}) {
  try {
    if (!customerId) throw new Error('Customer ID is required');
    if (!bookingId) throw new Error('Booking ID is required');
    if (!amount || amount <= 0) throw new Error('Allocation amount must be greater than zero');

    if (!state.isOnline) {
      throw new Error('Applying customer credit requires an internet connection.');
    }

    const idempotencyKey = `customer-credit:allocation:${bookingId}:${customerId}:${amount}:${Date.now()}`;

    const { data: result, error } = await state.supabase.rpc('apply_customer_credit_to_booking', {
      p_lodge_id: state.lodgeId,
      p_customer_id: customerId,
      p_booking_id: bookingId,
      p_amount: Number(amount),
      p_idempotency_key: idempotencyKey,
      p_notes: notes || '',
      p_recorded_by: recordedBy || state.currentUser?.id || null,
      p_expected_booking_updated_at: expectedBookingUpdatedAt || null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not apply customer credit');

    await refreshCache('bookings');

    const customer = readCache('customers').find((c) => c.id === customerId);
    logActivity(
      'customer_credit_allocated',
      `Credit applied to booking · ${customer?.name || 'Customer'} · ${Number(amount).toFixed(2)}`
    );
    createBackup();

    return {
      success: true,
      entry_id: result.entry_id,
      payment_id: result.payment_id,
      balance: result.balance,
      amount_paid: result.amount_paid,
      payment_status: result.payment_status,
      offline: false
    };
  } catch (error) {
    recordCriticalError('customerCredit.applyToBooking', error, {
      customer_id: customerId,
      booking_id: bookingId,
      amount: Number(amount || 0)
    });
    throw error;
  }
}

export async function refundCustomerCredit({
  customerId,
  amount,
  method,
  reference,
  notes,
  requestedBy,
  approvedBy
}) {
  try {
    if (!customerId) throw new Error('Customer ID is required');
    if (!amount || amount <= 0) throw new Error('Refund amount must be greater than zero');
    if (!method) throw new Error('Refund method is required');

    if (!state.isOnline) {
      throw new Error('Customer credit refunds require an internet connection.');
    }

    const idempotencyKey = `customer-credit:refund:${customerId}:${amount}:${method}:${Date.now()}`;

    const { data: result, error } = await state.supabase.rpc('refund_customer_credit', {
      p_lodge_id: state.lodgeId,
      p_customer_id: customerId,
      p_amount: Number(amount),
      p_method: method,
      p_idempotency_key: idempotencyKey,
      p_reference: reference || '',
      p_notes: notes || '',
      p_requested_by: requestedBy || state.currentUser?.id || null,
      p_approved_by: approvedBy || state.currentUser?.id || null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not refund customer credit');

    const customer = readCache('customers').find((c) => c.id === customerId);
    logActivity(
      'customer_credit_refunded',
      `Credit refunded · ${customer?.name || 'Customer'} · ${Number(amount).toFixed(2)} (${method})`
    );

    return {
      success: true,
      entry_id: result.entry_id,
      balance: result.balance,
      offline: false
    };
  } catch (error) {
    recordCriticalError('customerCredit.refund', error, {
      customer_id: customerId,
      amount: Number(amount || 0),
      method
    });
    throw error;
  }
}

export async function reverseCustomerCreditEntry({
  entryId,
  notes,
  recordedBy
}) {
  try {
    if (!entryId) throw new Error('Entry ID is required');

    if (!state.isOnline) {
      throw new Error('Reversing customer credit entries requires an internet connection.');
    }

    const idempotencyKey = `customer-credit:reverse:${entryId}:${Date.now()}`;

    const { data: result, error } = await state.supabase.rpc('reverse_customer_credit_entry', {
      p_lodge_id: state.lodgeId,
      p_entry_id: entryId,
      p_notes: notes || '',
      p_idempotency_key: idempotencyKey,
      p_recorded_by: recordedBy || state.currentUser?.id || null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not reverse entry');

    logActivity(
      'customer_credit_reversed',
      `Credit entry reversed · Entry ${entryId.slice(0, 8)}`
    );

    return {
      success: true,
      reversal_entry_id: result.reversal_entry_id,
      balance: result.balance,
      offline: false
    };
  } catch (error) {
    recordCriticalError('customerCredit.reverse', error, { entry_id: entryId });
    throw error;
  }
}
