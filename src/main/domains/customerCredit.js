import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { readCache, writeCache, refreshCache, queueOperation, logActivity, createBackup } from './infrastructure.js';
import { recordCriticalError } from './operationalLog.js';

// ─── CUSTOMER CREDIT ─────────────────────────────────────────────────────────

const CREDIT_IN_TYPES = new Set(['receipt', 'adjustment_in', 'reversal_in']);
const CREDIT_OUT_TYPES = new Set(['booking_allocation', 'refund', 'adjustment_out', 'reversal_out']);

function requireStableOperationId(value, label = 'operation') {
  const key = String(value || '').trim();
  if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(key)) {
    throw new Error(`A stable operation ID between 8 and 128 letters, digits, :, _, or - is required for ${label}.`);
  }
  return key;
}

function appendPendingCreditEntry(entry = {}) {
  const cached = readCache('customer-credit-ledger') || [];
  const next = [
    ...cached.filter((row) => row?.id !== entry.id),
    {
      ...entry,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null
    }
  ].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  writeCache('customer-credit-ledger', next);
}

function mergeCreditLedgerRows(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return readCache('customer-credit-ledger') || [];
  const cached = readCache('customer-credit-ledger') || [];
  const incomingIds = new Set(rows.map((entry) => entry?.id).filter(Boolean));
  const merged = [
    ...rows,
    ...cached.filter((entry) => !incomingIds.has(entry?.id))
  ].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  writeCache('customer-credit-ledger', merged);
  return merged;
}

function mergeCreditSummaryRows(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return readCache('customer-credit-summary') || [];
  const incomingIds = new Set(rows.map((row) => row?.customer_id).filter(Boolean));
  const cached = readCache('customer-credit-summary') || [];
  const merged = [
    ...rows.map((row) => ({ ...row, _confirmed_balance: true })),
    ...cached.filter((row) => !incomingIds.has(row?.customer_id))
  ];
  writeCache('customer-credit-summary', merged);
  return merged;
}

function patchCreditSummaryBalance(customerId, balance, patch = {}) {
  if (!customerId) return;
  const customers = readCache('customers') || [];
  const customer = customers.find((row) => row?.id === customerId) || {};
  const cached = readCache('customer-credit-summary') || [];
  const nextRow = {
    customer_id: customerId,
    customer_name: customer.name || 'Customer',
    customer_phone: customer.phone || '',
    customer_email: customer.email || '',
    balance: Math.round(Number(balance || 0) * 100) / 100,
    latest_entry_at: new Date().toISOString(),
    _confirmed_balance: patch._pending_sync !== true,
    ...patch
  };
  writeCache('customer-credit-summary', [
    nextRow,
    ...cached.filter((row) => row?.customer_id !== customerId)
  ]);
}

function patchAuthoritativeCreditBalance(customerId, value, patch = {}) {
  const balance = Number(value);
  if (!Number.isFinite(balance)) return false;
  patchCreditSummaryBalance(customerId, balance, patch);
  return true;
}

function creditLedgerDelta(entries = []) {
  return entries.reduce((sum, e) => {
    if (CREDIT_IN_TYPES.has(e.entry_type)) return sum + Number(e.amount || 0);
    if (CREDIT_OUT_TYPES.has(e.entry_type)) return sum - Number(e.amount || 0);
    return sum;
  }, 0);
}

function getCachedCreditBalance(customerId) {
  const entries = readCache('customer-credit-ledger') || [];
  const confirmedSummary = (readCache('customer-credit-summary') || [])
    .find((row) => row?.customer_id === customerId && row?._confirmed_balance !== false);
  if (confirmedSummary) {
    const pendingDelta = creditLedgerDelta(entries.filter((e) =>
      e.customer_id === customerId &&
      e.lodge_id === state.lodgeId &&
      (e._pending_sync === true || e._sync_state === 'pending')));
    return Math.round((Number(confirmedSummary.balance || 0) + pendingDelta) * 100) / 100;
  }
  const balance = creditLedgerDelta(entries.filter((e) => e.customer_id === customerId && e.lodge_id === state.lodgeId));
  return Math.round(balance * 100) / 100;
}

function patchCachedBookingCreditEstimate(bookingId, amount) {
  const cachedBookings = readCache('bookings') || [];
  const idx = cachedBookings.findIndex((booking) => booking?.id === bookingId);
  if (idx < 0) return null;
  const current = cachedBookings[idx];
  const totalOwed = Number(current.total_amount || 0) + Number(current.charges_total || 0);
  const amountPaid = Math.min(totalOwed, Number(current.amount_paid || 0) + Number(amount || 0));
  const next = {
    ...current,
    // Offline replay may be pending or fail. Keep authoritative booking
    // amount_paid/payment_status untouched; expose only a labelled estimate.
    _amount_paid_estimate: amountPaid,
    _payment_status_estimate: totalOwed > 0 && amountPaid >= totalOwed ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid',
    _payment_status_pending: true,
    _pending_sync: true,
    _pending_payment: true,
    _financial_estimate: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  };
  cachedBookings[idx] = next;
  writeCache('bookings', cachedBookings);
  return next;
}

function getCreditQueueIdForEntry(entry = {}) {
  if (!entry?.id) return null;
  if (entry.entry_type === 'receipt') return `customer-credit-${entry.id}`;
  if (entry.entry_type === 'booking_allocation') return `customer-credit-apply-${entry.id}`;
  if (entry.entry_type === 'refund') return `customer-credit-refund-${entry.id}`;
  if (String(entry.entry_type || '').startsWith('reversal_')) return `customer-credit-reverse-${entry.id}`;
  return `customer-credit-${entry.id}`;
}

export async function getCustomerCreditBalance(customerId) {
  if (!customerId) return { success: false, unavailable: true, error: 'Customer ID is required.' };
  if (!state.isOnline) {
    return {
      success: true,
      balance: getCachedCreditBalance(customerId),
      offline: true,
      unavailable: true,
      _confirmed_balance: false
    };
  }
  try {
    const { data, error } = await state.supabase.rpc('get_customer_credit_balance', {
      p_lodge_id: state.lodgeId,
      p_customer_id: customerId
    });
    if (error) throw new Error(error.message);
    const result = data;
    const numericBalance = Number(result?.balance);
    if (!result || typeof result !== 'object' || result.success !== true || !Number.isFinite(numericBalance)) {
      throw new Error('The authoritative customer-credit balance response was unavailable or malformed.');
    }
    patchAuthoritativeCreditBalance(customerId, numericBalance);
    return { ...result, balance: numericBalance, _confirmed_balance: true };
  } catch (error) {
    recordCriticalError('customerCredit.getBalance', error, { customer_id: customerId });
    // A failed authoritative read must never become a false zero balance.
    throw error;
  }
}

export async function getCustomerCreditHistory(customerId, limit = 50, offset = 0) {
  if (!customerId) return [];
  if (!state.isOnline) {
    return (readCache('customer-credit-ledger') || [])
      .filter((entry) => entry?.customer_id === customerId && entry?.lodge_id === state.lodgeId)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(Number(offset || 0), Number(offset || 0) + Number(limit || 50))
      .map((entry) => ({ ...entry, _offline_snapshot: true, _confirmed_balance: false }));
  }
  try {
    const { data, error } = await state.supabase.rpc('get_customer_credit_history', {
      p_lodge_id: state.lodgeId,
      p_customer_id: customerId,
      p_limit: limit,
      p_offset: offset
    });
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error('The authoritative customer-credit history response was unavailable or malformed.');
    const rows = data;
    mergeCreditLedgerRows(rows);
    return rows;
  } catch (error) {
    recordCriticalError('customerCredit.getHistory', error, { customer_id: customerId });
    throw error;
  }
}

export async function getCustomerCreditSummary(search = null, limit = 50, offset = 0) {
  if (!state.isOnline) {
    const needle = String(search || '').trim().toLowerCase();
    const customers = readCache('customers') || [];
    const byCustomer = new Map();
    for (const summary of readCache('customer-credit-summary') || []) {
      if (!summary?.customer_id) continue;
      byCustomer.set(summary.customer_id, {
        ...summary,
        balance: getCachedCreditBalance(summary.customer_id),
        _pending_sync: summary._pending_sync === true,
        _confirmed_balance: false,
        _offline_snapshot: true
      });
    }
    for (const customer of customers) {
      if (!customer?.id) continue;
      if (byCustomer.has(customer.id)) continue;
      byCustomer.set(customer.id, {
        customer_id: customer.id,
        customer_name: customer.name || 'Customer',
        customer_phone: customer.phone || '',
        customer_email: customer.email || '',
        balance: getCachedCreditBalance(customer.id),
        latest_entry_at: null,
        _pending_sync: false,
        _confirmed_balance: false,
        _offline_snapshot: true
      });
    }
    for (const entry of readCache('customer-credit-ledger') || []) {
      if (entry?.lodge_id !== state.lodgeId || !entry?.customer_id) continue;
      const row = byCustomer.get(entry.customer_id) || {
        customer_id: entry.customer_id,
        customer_name: 'Customer',
        customer_phone: '',
        customer_email: '',
        balance: getCachedCreditBalance(entry.customer_id),
        latest_entry_at: null,
        _pending_sync: false,
        _confirmed_balance: false,
        _offline_snapshot: true
      };
      if (!row.latest_entry_at || String(entry.created_at || '') > String(row.latest_entry_at || '')) {
        row.latest_entry_at = entry.created_at || null;
      }
      row._pending_sync = row._pending_sync || entry._pending_sync === true;
      row._confirmed_balance = false;
      row._offline_snapshot = true;
      byCustomer.set(entry.customer_id, row);
    }
    return [...byCustomer.values()]
      .filter((row) => Math.abs(Number(row.balance || 0)) > 0.009 || row._pending_sync)
      .filter((row) => !needle || `${row.customer_name} ${row.customer_phone} ${row.customer_email}`.toLowerCase().includes(needle))
      .sort((a, b) => String(b.latest_entry_at || '').localeCompare(String(a.latest_entry_at || '')))
      .slice(Number(offset || 0), Number(offset || 0) + Number(limit || 50));
  }
  try {
    const { data, error } = await state.supabase.rpc('get_customer_credit_summary', {
      p_lodge_id: state.lodgeId,
      p_search: search || null,
      p_limit: limit,
      p_offset: offset
    });
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error('The authoritative customer-credit summary response was unavailable or malformed.');
    const rows = data;
    mergeCreditSummaryRows(rows);
    return rows;
  } catch (error) {
    recordCriticalError('customerCredit.getSummary', error, { search });
    // Preserve the established array-on-success contract, but fail closed on
    // an unavailable authoritative read rather than presenting an empty
    // portfolio as proof that no money exists.
    throw error;
  }
}

export async function recordCustomerCredit({
  customerId,
  amount,
  method,
  reference,
  notes,
  recordedBy,
  idempotencyKey: callerIdempotencyKey,
  operationId,
  operationKey
}) {
  try {
    if (!customerId) throw new Error('Customer ID is required');
    if (!amount || amount <= 0) throw new Error('Amount must be greater than zero');
    if (!method) throw new Error('Payment method is required');

    // Stable per-attempt key: caller must reuse on ambiguous timeout (never Date.now()).
    const idempotencyKey = requireStableOperationId(callerIdempotencyKey || operationId || operationKey, 'receipt');

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

      patchAuthoritativeCreditBalance(customerId, result.balance);
      await refreshCache('customers');
      const postedHistory = await getCustomerCreditHistory(customerId, 100, 0).catch(() => []);
      const postedEntry = postedHistory.find((entry) => entry.id === result.entry_id);
      const customer = readCache('customers').find((c) => c.id === customerId);
      logActivity(
        'customer_credit_received',
        `Advance payment received · ${customer?.name || 'Customer'} · ${Number(amount).toFixed(2)} (${method})`
      );
      createBackup();

      return {
        success: true,
        entry_id: result.entry_id,
        receipt_number: postedEntry?.receipt_number || null,
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

      appendPendingCreditEntry(entry);

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
  expectedBookingUpdatedAt,
  idempotencyKey: callerIdempotencyKey,
  operationId,
  operationKey
}) {
  try {
    if (!customerId) throw new Error('Customer ID is required');
    if (!bookingId) throw new Error('Booking ID is required');
    if (!amount || amount <= 0) throw new Error('Allocation amount must be greater than zero');

    // The caller owns the intent key and must reuse it for an ambiguous retry.
    const idempotencyKey = requireStableOperationId(callerIdempotencyKey || operationId || operationKey, 'allocation');

    if (!state.isOnline) {
      const balance = getCachedCreditBalance(customerId);
      const numericAmount = Number(amount);
      if (balance + 0.009 < numericAmount) {
        throw new Error('Available customer credit is not enough for this allocation.');
      }
      const entryId = randomUUID();
      const booking = readCache('bookings').find((row) => row?.id === bookingId) || null;
      const entry = {
        id: entryId,
        lodge_id: state.lodgeId,
        customer_id: customerId,
        entry_type: 'booking_allocation',
        amount: numericAmount,
        method: 'customer_credit',
        reference: '',
        notes: notes || '',
        booking_id: bookingId,
        payment_id: null,
        reverses_entry_id: null,
        recorded_by: recordedBy || state.currentUser?.id || null,
        idempotency_key: idempotencyKey,
        created_at: new Date().toISOString()
      };
      appendPendingCreditEntry(entry);
      const patchedBooking = patchCachedBookingCreditEstimate(bookingId, numericAmount);
      queueOperation('rpc', 'apply_customer_credit_to_booking', {
        p_lodge_id: state.lodgeId,
        p_customer_id: customerId,
        p_booking_id: bookingId,
        p_amount: numericAmount,
        p_idempotency_key: idempotencyKey,
        p_notes: notes || '',
        p_recorded_by: recordedBy || state.currentUser?.id || null,
        p_expected_booking_updated_at: booking?._pending_sync ? null : expectedBookingUpdatedAt || booking?.updated_at || null
      }, null, {
        _queue_id: `customer-credit-apply-${entryId}`,
        ...(booking?._pending_sync ? { _depends_on: `booking-${bookingId}` } : {})
      });

      const customer = readCache('customers').find((c) => c.id === customerId);
      logActivity(
        'customer_credit_allocated',
        `Credit applied to booking (offline) · ${customer?.name || 'Customer'} · ${numericAmount.toFixed(2)}`
      );
      createBackup();

      return {
        success: true,
        entry_id: entryId,
        payment_id: null,
        balance: Math.round((balance - numericAmount) * 100) / 100,
        amount_paid_estimate: patchedBooking?._amount_paid_estimate ?? null,
        payment_status_pending: true,
        offline: true,
        queued: true
      };
    }

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

    patchAuthoritativeCreditBalance(customerId, result.balance);
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
  approvedBy,
  idempotencyKey: callerIdempotencyKey,
  operationId,
  operationKey
}) {
  try {
    if (!customerId) throw new Error('Customer ID is required');
    if (!amount || amount <= 0) throw new Error('Refund amount must be greater than zero');
    if (!method) throw new Error('Refund method is required');
    if (!String(notes || '').trim()) throw new Error('A reason is required for a prepayment refund.');

    const idempotencyKey = requireStableOperationId(callerIdempotencyKey || operationId || operationKey, 'refund');

    if (!state.isOnline) {
      const balance = getCachedCreditBalance(customerId);
      const numericAmount = Number(amount);
      if (balance + 0.009 < numericAmount) {
        throw new Error('Available customer credit is not enough for this refund.');
      }
      const entryId = randomUUID();
      appendPendingCreditEntry({
        id: entryId,
        lodge_id: state.lodgeId,
        customer_id: customerId,
        entry_type: 'refund',
        amount: numericAmount,
        method,
        reference: reference || '',
        notes: notes || '',
        booking_id: null,
        payment_id: null,
        reverses_entry_id: null,
        recorded_by: requestedBy || state.currentUser?.id || null,
        approved_by: approvedBy || state.currentUser?.id || null,
        idempotency_key: idempotencyKey,
        created_at: new Date().toISOString()
      });
      queueOperation('rpc', 'refund_customer_credit', {
        p_lodge_id: state.lodgeId,
        p_customer_id: customerId,
        p_amount: numericAmount,
        p_method: method,
        p_idempotency_key: idempotencyKey,
        p_reference: reference || '',
        p_notes: notes || '',
        p_requested_by: requestedBy || state.currentUser?.id || null,
        p_approved_by: approvedBy || state.currentUser?.id || null
      }, null, { _queue_id: `customer-credit-refund-${entryId}` });

      const customer = readCache('customers').find((c) => c.id === customerId);
      logActivity(
        'customer_credit_refunded',
        `Credit refund queued (offline) · ${customer?.name || 'Customer'} · ${numericAmount.toFixed(2)} (${method})`
      );

      return {
        success: true,
        entry_id: entryId,
        balance: Math.round((balance - numericAmount) * 100) / 100,
        offline: true,
        queued: true
      };
    }

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

    patchAuthoritativeCreditBalance(customerId, result.balance);
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
  recordedBy,
  idempotencyKey: callerIdempotencyKey,
  operationId,
  operationKey
}) {
  try {
    if (!entryId) throw new Error('Entry ID is required');
    if (!String(notes || '').trim()) throw new Error('A reason is required for a prepayment reversal.');

    const idempotencyKey = requireStableOperationId(callerIdempotencyKey || operationId || operationKey, 'reversal');
    if (!state.isOnline) {
      const original = (readCache('customer-credit-ledger') || []).find((entry) => entry?.id === entryId);
      if (!original) throw new Error('Credit entry not found in offline ledger.');
      if (original.entry_type?.startsWith?.('reversal_')) {
        throw new Error('Reversal entries cannot be reversed.');
      }
      const alreadyReversed = (readCache('customer-credit-ledger') || []).some((entry) => entry?.reverses_entry_id === entryId);
      if (alreadyReversed) throw new Error('This credit entry has already been reversed.');
      const reversalEntryId = randomUUID();
      const reversalType = CREDIT_IN_TYPES.has(original.entry_type) ? 'reversal_out' : 'reversal_in';
      appendPendingCreditEntry({
        id: reversalEntryId,
        lodge_id: state.lodgeId,
        customer_id: original.customer_id,
        entry_type: reversalType,
        amount: Number(original.amount || 0),
        method: original.method || null,
        reference: original.reference || '',
        notes: notes || '',
        booking_id: original.booking_id || null,
        payment_id: null,
        reverses_entry_id: entryId,
        recorded_by: recordedBy || state.currentUser?.id || null,
        idempotency_key: idempotencyKey,
        created_at: new Date().toISOString()
      });
      queueOperation('rpc', 'reverse_customer_credit_entry', {
        p_lodge_id: state.lodgeId,
        p_entry_id: entryId,
        p_notes: notes || '',
        p_idempotency_key: idempotencyKey,
        p_recorded_by: recordedBy || state.currentUser?.id || null
      }, null, {
        _queue_id: `customer-credit-reverse-${reversalEntryId}`,
        ...(original?._pending_sync ? { _depends_on: getCreditQueueIdForEntry(original) } : {})
      });

      logActivity(
        'customer_credit_reversed',
        `Credit entry reversal queued (offline) · Entry ${entryId.slice(0, 8)}`
      );

      return {
        success: true,
        reversal_entry_id: reversalEntryId,
        balance: getCachedCreditBalance(original.customer_id),
        offline: true,
        queued: true
      };
    }

    const { data: result, error } = await state.supabase.rpc('reverse_customer_credit_entry', {
      p_lodge_id: state.lodgeId,
      p_entry_id: entryId,
      p_notes: notes || '',
      p_idempotency_key: idempotencyKey,
      p_recorded_by: recordedBy || state.currentUser?.id || null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not reverse entry');

    const original = (readCache('customer-credit-ledger') || []).find((entry) => entry?.id === entryId);
    if (original?.customer_id) patchAuthoritativeCreditBalance(original.customer_id, result.balance);
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

// Advanced Prepayments reads intentionally stay online-only. They are
// server-derived projections over customer_credit_ledger; a stale local cache
// must not be promoted into reconciliation, ageing, matching, or export truth.
async function prepaymentReadRpc(rpcName, params) {
  if (!state.isOnline) {
    return {
      success: false,
      unavailable: true,
      offline: true,
      error: 'This server-authoritative prepayments view requires a connection.'
    };
  }
  const { data, error } = await state.supabase.rpc(rpcName, params);
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || data.success !== true) {
    throw new Error(data?.error || `The authoritative ${rpcName} response was unavailable or malformed.`);
  }
  return data;
}

export async function getPrepaymentPortfolio(asOf = null) {
  return prepaymentReadRpc('get_prepayment_portfolio', {
    p_lodge_id: state.lodgeId,
    ...(asOf ? { p_as_of: asOf } : {})
  });
}

export async function getPrepaymentAging(asOf = null) {
  return prepaymentReadRpc('get_prepayment_aging', {
    p_lodge_id: state.lodgeId,
    ...(asOf ? { p_as_of: asOf } : {})
  });
}

export async function getPrepaymentReconciliation(startAt, endAt) {
  return prepaymentReadRpc('get_prepayment_reconciliation', {
    p_lodge_id: state.lodgeId,
    p_start_at: startAt,
    p_end_at: endAt
  });
}

export async function getPrepaymentMatchingSuggestions(limit = 50) {
  return prepaymentReadRpc('get_prepayment_matching_suggestions', {
    p_lodge_id: state.lodgeId,
    p_limit: limit
  });
}

export async function getPrepaymentConfig() {
  return prepaymentReadRpc('get_prepayment_config', { p_lodge_id: state.lodgeId });
}

export async function setPrepaymentConfig({ config, operationId, operationKey, idempotencyKey }) {
  const stableKey = requireStableOperationId(idempotencyKey || operationId || operationKey, 'configuration');
  if (!state.isOnline) {
    return {
      success: false,
      unavailable: true,
      offline: true,
      error: 'Prepayments configuration requires a server connection.'
    };
  }
  const { data, error } = await state.supabase.rpc('set_prepayment_config', {
    p_lodge_id: state.lodgeId,
    p_config: config || {},
    p_idempotency_key: stableKey
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not save prepayments configuration');
  return data;
}

export async function exportPrepayments(startAt = null, endAt = null) {
  return prepaymentReadRpc('get_prepayment_export', {
    p_lodge_id: state.lodgeId,
    p_start_at: startAt,
    p_end_at: endAt
  });
}

export async function recordPrepaymentExportAudit({ artifactSha256, fileName, rowCount, startAt = null, endAt = null } = {}) {
  if (!state.isOnline) {
    return { success: false, unavailable: true, offline: true, error: 'Export audit requires a server connection.' };
  }
  const { data, error } = await state.supabase.rpc('record_prepayment_export_audit', {
    p_lodge_id: state.lodgeId,
    p_artifact_sha256: artifactSha256,
    p_file_name: fileName,
    p_row_count: rowCount,
    p_start_at: startAt,
    p_end_at: endAt
  });
  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Could not record the prepayment export audit.');
  return data;
}
