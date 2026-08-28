import { randomUUID } from 'crypto';
import crypto from 'crypto';
import { state } from '../state.js';
import { getAllRooms, getRoomById } from './rooms.js';
import { getAllCustomers } from './customers.js';
import { normalizeLodgeId } from './shared.js';
import { getLocalDateKey, recordCriticalError } from './operationalLog.js';
import {
  DEBUG_CACHE_FALLBACKS,
  readCache,
  writeCache,
  refreshCache,
  queueOperation,
  appendOperationJournalEntry,
  logActivity,
  createBackup,
  dedupePromise
} from './infrastructure.js';
import { assertCreationWithinUsageLimit } from './usage.js';
import {
  getNextInvoiceNumberByLookup,
  isMissingInvoiceNumberRpcError,
  roundMoneyValue
} from './finance.js';
import { mergeRemoteBookingsWithLocalState } from './bookingMerge.js';
import { patchCachedQuotationSyncState } from './syncCache.js';
import { computeStayTotal, isCampsiteUnit, normalizeRateMode } from '../../shared/accommodation.js';

// ─── BOOKINGS ─────────────────────────────────────────────────────────────────

function withReadMetadata(rows, source, complete) {
  const result = Array.isArray(rows) ? rows : []
  Object.defineProperties(result, {
    _source: { value: source, enumerable: true, configurable: true },
    _complete: { value: complete === true, enumerable: true, configurable: true }
  })
  return result
}

function buildLocalPendingInvoiceNumber(bookingId) {
  const suffix = String(bookingId || randomUUID()).replace(/-/g, '').slice(0, 8).toUpperCase();
  return `PENDING-${suffix}`;
}

function buildAccommodationGroupId() {
  return `stay-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function appendAccommodationGroupMetadata(notes = '', groupId = '', roomCount = 1) {
  const cleanNotes = String(notes || '').
  replace(/\[STAY_GROUP:[^\]]+\]/g, '').
  replace(/\[STAY_ROOMS:\d+\]/g, '').
  trim();
  return [
  cleanNotes,
  groupId ? `[STAY_GROUP:${groupId}]` : '',
  roomCount > 1 ? `[STAY_ROOMS:${roomCount}]` : ''].
  filter(Boolean).
  join(' ');
}

function parseAccommodationGroupId(notes = '') {
  return String(notes || '').match(/\[STAY_GROUP:([^\]]+)\]/)?.[1] || null;
}

function parseAccommodationRoomCount(notes = '') {
  const count = Number(String(notes || '').match(/\[STAY_ROOMS:(\d+)\]/)?.[1] || 0);
  return Number.isFinite(count) && count > 0 ? count : null;
}

function stripAccommodationGroupMetadata(notes = '') {
  return String(notes || '').
  replace(/\[STAY_GROUP:[^\]]+\]/g, '').
  replace(/\[STAY_ROOMS:\d+\]/g, '').
  trim();
}

function upsertCachedBookingInvoiceGroup(group = {}, lines = []) {
  if (!group?.id && !group?.group_key) return null;
  const groupId = group.id || `local-${group.group_key}`;
  const normalizedGroup = { ...group, id: groupId };
  writeCache('booking-invoice-groups', [
    normalizedGroup,
    ...(readCache('booking-invoice-groups') || []).filter((row) =>
      row?.id !== groupId && row?.group_key !== group.group_key)
  ]);
  const normalizedLines = (lines || []).map((line, index) => ({
    ...line,
    group_id: groupId,
    lodge_id: line.lodge_id || group.lodge_id || state.lodgeId,
    line_order: Number(line.line_order || index + 1)
  })).filter((line) => line.booking_id);
  const lineBookingIds = new Set(normalizedLines.map((line) => line.booking_id));
  writeCache('booking-invoice-group-lines', [
    ...normalizedLines,
    ...(readCache('booking-invoice-group-lines') || []).filter((line) => !lineBookingIds.has(line?.booking_id))
  ]);
  return normalizedGroup;
}

async function createBookingInvoiceGroup({ groupKey, customerId, bookingIds, notes = '', createdBy = null }) {
  const cleanBookingIds = [...new Set((bookingIds || []).filter(Boolean))];
  if (!groupKey || cleanBookingIds.length < 2) return null;
  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('create_booking_invoice_group', {
      p_lodge_id: state.lodgeId,
      p_group_key: groupKey,
      p_customer_id: customerId || null,
      p_booking_ids: cleanBookingIds,
      p_invoice_number: null,
      p_notes: notes || null,
      p_created_by: createdBy || state.currentUser?.id || null
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not create group invoice');
    const now = new Date().toISOString();
    return upsertCachedBookingInvoiceGroup({
      id: data.group_id,
      lodge_id: state.lodgeId,
      group_key: data.group_key || groupKey,
      customer_id: customerId || null,
      invoice_number: data.invoice_number,
      issued_at: now,
      due_date: null,
      notes: notes || '',
      created_by: createdBy || state.currentUser?.id || null,
      created_at: now,
      updated_at: now
    }, cleanBookingIds.map((bookingId, index) => ({
      booking_id: bookingId,
      line_order: index + 1
    })));
  }

  const now = new Date().toISOString();
  const group = upsertCachedBookingInvoiceGroup({
    id: `local-${groupKey}`,
    lodge_id: state.lodgeId,
    group_key: groupKey,
    customer_id: customerId || null,
    invoice_number: buildLocalPendingInvoiceNumber(groupKey),
    issued_at: now,
    due_date: null,
    notes: notes || '',
    created_by: createdBy || state.currentUser?.id || null,
    created_at: now,
    updated_at: now,
    _pending_sync: true,
    _sync_state: 'pending'
  }, cleanBookingIds.map((bookingId, index) => ({
    booking_id: bookingId,
    line_order: index + 1,
    _pending_sync: true,
    _sync_state: 'pending'
  })));
  queueOperation('rpc', 'create_booking_invoice_group', {
    p_lodge_id: state.lodgeId,
    p_group_key: groupKey,
    p_customer_id: customerId || null,
    p_booking_ids: cleanBookingIds,
    p_invoice_number: null,
    p_notes: notes || null,
    p_created_by: createdBy || state.currentUser?.id || null
  }, null, {
    _queue_id: `booking-invoice-group-${groupKey}`,
    _depends_on: `booking-${cleanBookingIds[cleanBookingIds.length - 1]}`
  });
  return group;
}

function buildOfflineBookingFinancialState(totalAmount, depositAmount = 0) {
  const total = Math.max(0, Number(totalAmount || 0));
  const paid = Math.max(0, Number(depositAmount || 0));
  const amountPaid = Math.min(paid, total);
  return {
    amount_paid: amountPaid,
    payment_status: amountPaid >= total && total > 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'
  };
}

const VALID_STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled'],
  checked_in: ['checked_out']
};

export function createBookingIdempotencyKey(bookingId) {
  return `create-booking:${bookingId}`;
}

function createOperationIdempotencyKey(prefix, payload = {}) {
  const digest = crypto.
  createHash('sha256').
  update(JSON.stringify(payload)).
  digest('hex').
  slice(0, 32);
  return `${prefix}:${digest}`.slice(0, 128);
}

function calculateBookingPaymentStatus(totalOwed, amountPaid) {
  const total = Math.max(0, Number(totalOwed || 0));
  const paid = Math.max(0, Number(amountPaid || 0));
  if (total > 0 && paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

function patchCachedBookingFinancialEstimate(bookingId, patch = {}) {
  if (!bookingId) return null;
  const cachedBookings = readCache('bookings');
  const idx = cachedBookings.findIndex((booking) => booking?.id === bookingId);
  if (idx < 0) return null;
  const current = cachedBookings[idx];
  const next = {
    ...current,
    ...patch,
    _pending_sync: true,
    _financial_estimate: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  };
  const totalOwed = Number(next.total_amount || 0) + Number(next.charges_total || 0);
  next.payment_status = calculateBookingPaymentStatus(totalOwed, next.amount_paid);
  cachedBookings[idx] = next;
  writeCache('bookings', cachedBookings);
  return next;
}

function mergeCachedBookingChargesForBooking(bookingId, rows = []) {
  const existing = readCache('booking-charges');
  const next = [
  ...existing.filter((row) => row?.booking_id !== bookingId),
  ...(rows || [])].
  sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  writeCache('booking-charges', next);
  return next.filter((row) => row?.booking_id === bookingId && !row?.voided_at);
}

function upsertCachedBookingCharge(row = {}) {
  if (!row?.id) return;
  const cached = readCache('booking-charges');
  const next = [row, ...cached.filter((charge) => charge?.id !== row.id)].
  sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  writeCache('booking-charges', next);
}

function patchCachedBookingCharge(chargeId, patch = {}) {
  if (!chargeId) return null;
  const cached = readCache('booking-charges');
  const idx = cached.findIndex((charge) => charge?.id === chargeId);
  if (idx < 0) return null;
  const next = [...cached];
  next[idx] = { ...next[idx], ...patch };
  writeCache('booking-charges', next);
  return next[idx];
}

function getCachedBookingChargeById(chargeId) {
  return readCache('booking-charges').find((charge) => charge?.id === chargeId) || null;
}

function readActiveRateOverrideCache() {
  return readCache('room-rate-overrides').
  filter((override) => override?._deleted_offline !== true).
  sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')));
}

function mergeRemoteRateOverridesWithLocal(rows = []) {
  const local = readCache('room-rate-overrides');
  const localPending = local.filter((override) =>
  override?._pending_sync === true ||
  override?._deleted_offline === true ||
  override?._sync_state === 'pending');
  const pendingIds = new Set(localPending.map((override) => override?.id).filter(Boolean));
  const merged = [
  ...localPending,
  ...(rows || []).filter((override) => !pendingIds.has(override?.id))].
  sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')));
  writeCache('room-rate-overrides', merged);
  return merged.filter((override) => override?._deleted_offline !== true);
}

function getCachedRateOverrideById(id) {
  return readCache('room-rate-overrides').find((override) => override?.id === id) || null;
}

function findApplicableRateOverrideFromCache(roomId, checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const overrides = readActiveRateOverrideCache().filter((override) =>
  override?.lodge_id === state.lodgeId &&
  override?.start_date <= checkOut &&
  override?.end_date >= checkIn);
  if (overrides.length === 0) return null;
  const specific = overrides.find((override) => override.room_id === roomId);
  const global = overrides.find((override) => !override.room_id);
  const applicable = specific || global;
  return applicable ? { rate: applicable.rate_per_night, name: applicable.name, offline: !state.isOnline } : null;
}

function createPaymentIdempotencyKey(bookingId, type = 'payment', intentId = null, fallbackSignature = null) {
  if (type === 'deposit') {
    // Deterministic — bound to the booking, safe to replay without generating a duplicate
    return `payment:deposit:${bookingId}`;
  }
  // If intentId is provided, use it for deterministic idempotency across sessions
  if (intentId) {
    return `payment:${type}:${bookingId}:${intentId}`;
  }
  // Fallback: if signature is provided (booking+status+amount), use it for deterministic key
  // This prevents double-payments even if intentKey is lost after app restart
  if (fallbackSignature) {
    return `payment:${type}:${fallbackSignature}`;
  }
  // Last resort: generate random key (logs warning in caller)
  return `payment:${type}:${bookingId}:${randomUUID()}`;
}

function buildPaymentFallbackSignature(bookingId, type, amount, bookingVersion = null) {
  const normalizedAmount = roundMoneyValue(Math.abs(amount)).toFixed(2);
  const normalizedVersion = bookingVersion || 'no-version';
  return `${bookingId}:${type}:${normalizedAmount}:${normalizedVersion}`;
}

export async function checkExclusiveEventConflict(checkIn, checkOut, excludeGroupId = null) {
  if (state.isOnline) {
    const { data } = await state.supabase.from('bookings').select('id, notes').
    eq('lodge_id', state.lodgeId).
    eq('is_exclusive_event', true).
    neq('status', 'cancelled').
    lt('check_in', checkOut).
    gt('check_out', checkIn);
    if (data?.length > 0) {
      if (excludeGroupId && data.every((b) => b.notes?.includes(`[GROUP:${excludeGroupId}]`))) return;
      throw new Error('The lodge is fully reserved for an exclusive event on these dates. No other bookings can be made.');
    }
  } else {
    const events = readCache('bookings').filter((b) =>
    b.is_exclusive_event && b.status !== 'cancelled' &&
    b.check_in < checkOut && b.check_out > checkIn &&
    !(excludeGroupId && b.notes?.includes(`[GROUP:${excludeGroupId}]`))
    );
    if (events.length > 0)
    throw new Error('The lodge is fully reserved for an exclusive event on these dates. No other bookings can be made.');
  }
}

const BOOKING_LIST_SELECT = 'id, customer_id, room_id, check_in, check_out, adults, children, total_amount, status, payment_status, amount_paid, charges_total, deposit_amount, notes, is_exclusive_event, invoice_number, created_at, updated_at, created_by, payment_method, source, quotation_id, event_daily_rate';
const BOOKING_PAGE_SIZE = 1000;
const BOOKING_MAX_ROWS = 10000;

async function fetchPagedBookingRows(buildQuery, maxRows = BOOKING_MAX_ROWS) {
  const rows = [];
  for (let from = 0; from < maxRows; from += BOOKING_PAGE_SIZE) {
    const to = Math.min(from + BOOKING_PAGE_SIZE - 1, maxRows - 1);
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  if (rows.length >= maxRows) {
    console.warn(`[Bookings] Reached ${maxRows} row read cap; narrow the date range to load older bookings.`);
  }
  return rows;
}

async function fetchRefundSettlementMap(bookingIds = []) {
  if (!state.isOnline || !state.lodgeId) return new Map();
  let query = state.supabase.
    from('refund_approval_log').
    select('booking_id, refund_amount, retained_amount, retained_percent, method, created_at').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false });

  if (bookingIds.length > 0) {
    query = query.in('booking_id', bookingIds);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Could not load refund settlement state:', error.message);
    return new Map();
  }

  const byBooking = new Map();
  for (const row of data || []) {
    if (row?.booking_id && !byBooking.has(row.booking_id)) {
      byBooking.set(row.booking_id, row);
    }
  }
  return byBooking;
}

function applyRefundSettlementState(rows, settlementMap) {
  return rows.map((row) => {
    const settlement = settlementMap.get(row.id || row.booking_id);
    return {
      ...row,
      refund_settled: Boolean(settlement),
      refund_amount: settlement ? Number(settlement.refund_amount || 0) : null,
      retained_amount: settlement ? Number(settlement.retained_amount || 0) : null,
      retained_percent: settlement ? Number(settlement.retained_percent || 0) : null,
      refund_method: settlement?.method || null,
      refund_approved_at: settlement?.created_at || null
    };
  });
}

function readPendingRefundRequests() {
  return (readCache('booking-refund-requests') || []).
  filter((request) => request?.status === 'pending_approval' && request?.booking_id);
}

function getPendingRefundRequestForBooking(bookingId) {
  return readPendingRefundRequests().
  find((request) => request.booking_id === bookingId) || null;
}

function clearRefundRequestFields(row = {}) {
  const next = { ...(row || {}) };
  delete next._pending_refund_request;
  delete next.refund_request_pending;
  delete next.refund_request_saved_at;
  return next;
}

function applyRefundRequestState(row = {}, request = null) {
  if (!request || request.status !== 'pending_approval' || row?.refund_settled === true) {
    return clearRefundRequestFields(row);
  }
  return {
    ...row,
    _pending_refund_request: request,
    refund_request_pending: true,
    refund_request_saved_at: request.updated_at || request.created_at || null
  };
}

function annotateRowsWithLocalRefundRequests(rows = []) {
  const requests = readPendingRefundRequests();
  if (!requests.length) {
    return rows.map((row) => clearRefundRequestFields(row));
  }
  const byBooking = new Map();
  for (const request of requests) {
    if (!byBooking.has(request.booking_id)) {
      byBooking.set(request.booking_id, request);
    }
  }
  return rows.map((row) => applyRefundRequestState(row, byBooking.get(row?.booking_id || row?.id)));
}

function writeRefundRequest(request = {}) {
  if (!request?.id || !request?.booking_id) return null;
  const existingRows = readCache('booking-refund-requests') || [];
  const nextRows = [
  request,
  ...existingRows.filter((row) =>
  row?.id !== request.id &&
  !(row?.booking_id === request.booking_id && row?.status === 'pending_approval'))].
  sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  writeCache('booking-refund-requests', nextRows);
  return request;
}

function markRefundRequestApproved(bookingId, approvalPatch = {}) {
  const rows = readCache('booking-refund-requests') || [];
  let changed = false;
  const now = new Date().toISOString();
  const nextRows = rows.map((row) => {
    if (row?.booking_id !== bookingId || row?.status !== 'pending_approval') return row;
    changed = true;
    return {
      ...row,
      ...approvalPatch,
      status: 'approved',
      approved_at: approvalPatch.approved_at || now,
      updated_at: now
    };
  });
  if (changed) writeCache('booking-refund-requests', nextRows);
  patchCachedBookingRefundRequest(bookingId, null);
}

function patchCachedBookingRefundRequest(bookingId, request = null) {
  if (!bookingId) return null;
  const cached = readCache('bookings') || [];
  let patched = null;
  const next = cached.map((booking) => {
    if (booking?.id !== bookingId) return booking;
    patched = applyRefundRequestState(booking, request);
    return patched;
  });
  if (patched) writeCache('bookings', next);
  return patched;
}

async function _getAllBookings() {
  try {
    const data = await fetchPagedBookingRows(() => state.supabase.
      from('bookings').
      select(`${BOOKING_LIST_SELECT}, customers(name, phone, email), rooms(room_number, room_type, rate_per_night)`).
      eq('lodge_id', state.lodgeId).
      order('check_in', { ascending: false }));

    const cached = readCache('bookings');
    if ((data || []).length === 0 && cached.length > 0) {
      if (DEBUG_CACHE_FALLBACKS) {
        console.warn('getAllBookings received empty live result; using cached bookings instead');
      }
      return withReadMetadata(cached, 'cache', false);
    }

    const localRowsForMerge = cached;
    const mapped = (data || []).map((b) => ({
      ...b,
      customer_name: b.customers?.name,
      customer_phone: b.customers?.phone,
      customer_email: b.customers?.email,
      room_number: b.rooms?.room_number,
      room_type: b.rooms?.room_type,
      rate_per_night: b.rooms?.rate_per_night
    }));
    const refundSettlements = await fetchRefundSettlementMap(mapped.map((row) => row.id).filter(Boolean));
    const mappedWithRefundState = applyRefundSettlementState(mapped, refundSettlements);
    const mergedLiveRows = mergeRemoteBookingsWithLocalState(mappedWithRefundState, localRowsForMerge);
    const annotatedRows = annotateRowsWithLocalRefundRequests(mergedLiveRows);
    writeCache('bookings', annotatedRows);
    return withReadMetadata(
      annotatedRows,
      'server',
      annotatedRows.every((row) => row?._pending_sync !== true && row?._sync_state !== 'pending')
    );
  } catch (error) {
    if (state.isOnline) {
      const cached = readCache('bookings');
      if (cached.length > 0) {
        console.warn('getAllBookings falling back to cache:', error?.message || error);
      } else if (error) {
        console.error('getAllBookings failed:', error);
      }
    }
  }

  const bookings = readCache('bookings');
  const customers = readCache('customers');
  const rooms = readCache('rooms');

  const mappedBookings = bookings.map((b) => {
    const customer = customers.find((c) => c.id === b.customer_id);
    const room = rooms.find((r) => r.id === b.room_id);
    return {
      ...b,
      customer_name: customer?.name,
      customer_phone: customer?.phone,
      customer_email: customer?.email,
      room_number: room?.room_number,
      room_type: room?.room_type,
      rate_per_night: room?.rate_per_night
    };
  });

  return withReadMetadata(
    annotateRowsWithLocalRefundRequests(mappedBookings).
    sort((a, b) => new Date(b.check_in) - new Date(a.check_in)),
    state.isOnline ? 'cache' : 'offline-cache',
    false
  );
}

export function getAllBookings() {
  return dedupePromise('getAllBookings', _getAllBookings);
}

export async function getCollectionsSummary() {
  if (!state.lodgeId) return { count: 0, amount: 0 };
  try {
    if (!state.isOnline) {
      const all = readCache('bookings') || [];
      const allConf = readCache('conference-bookings') || [];
      const eventGroupMap = {};
      const deduped = [];
      for (const b of all) {
        if (!b) continue;
        if (b.is_exclusive_event) {
          const match = String(b.notes || '').match(/\[GROUP:([^\]]+)\]/);
          const gid = match?.[1] || b.check_in;
          if (!eventGroupMap[gid]) {
            eventGroupMap[gid] = {
              total_amount: Number(b.total_amount || 0),
              charges_total: Number(b.charges_total || 0),
              amount_paid: Number(b.amount_paid || 0)
            };
            deduped.push(eventGroupMap[gid]);
          } else {
            const g = eventGroupMap[gid];
            g.total_amount += Number(b.total_amount || 0);
            g.charges_total += Number(b.charges_total || 0);
            g.amount_paid += Number(b.amount_paid || 0);
          }
        } else {
          deduped.push({
            total_amount: Number(b.total_amount || 0),
            charges_total: Number(b.charges_total || 0),
            amount_paid: Number(b.amount_paid || 0),
            status: b.status
          });
        }
      }
      const openBalances = deduped.filter((booking) => {
        if (String(booking.status || '').toLowerCase() === 'cancelled') return false;
        return Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)) > 0;
      });
      const confOpen = allConf
        .filter((cb) => String(cb.payment_status || '').toLowerCase() !== 'cancelled')
        .filter((cb) => Number(cb.total_amount || 0) - Number(cb.deposit_paid || 0) > 0);
      const totalOpen = openBalances.length + confOpen.length;
      const amount = openBalances.reduce((sum, booking) => (
        sum + Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0))
      ), 0) + confOpen.reduce((sum, cb) => (
        sum + Math.max(0, Number(cb.total_amount || 0) - Number(cb.deposit_paid || 0))
      ), 0);
      return { count: totalOpen, amount };
    }
    const [bookingsResult, confResult] = await Promise.all([
      state.supabase
        .from('bookings')
        .select('id, total_amount, charges_total, amount_paid, status, notes, is_exclusive_event, check_in')
        .eq('lodge_id', state.lodgeId)
        .neq('status', 'cancelled')
        .limit(500),
      state.supabase
        .from('conference_bookings')
        .select('id, total_amount, deposit_paid, payment_status')
        .eq('lodge_id', state.lodgeId)
        .neq('payment_status', 'cancelled')
        .limit(500)
    ]);
    if (bookingsResult.error) throw bookingsResult.error;
    if (confResult.error) throw confResult.error;
    const all = bookingsResult.data || [];
    const allConf = confResult.data || [];
    const eventGroupMap = {};
    const deduped = [];
    for (const b of all) {
      if (!b) continue;
      if (b.is_exclusive_event) {
        const match = String(b.notes || '').match(/\[GROUP:([^\]]+)\]/);
        const gid = match?.[1] || b.check_in;
        if (!eventGroupMap[gid]) {
          eventGroupMap[gid] = {
            total_amount: Number(b.total_amount || 0),
            charges_total: Number(b.charges_total || 0),
            amount_paid: Number(b.amount_paid || 0)
          };
          deduped.push(eventGroupMap[gid]);
        } else {
          const g = eventGroupMap[gid];
          g.total_amount += Number(b.total_amount || 0);
          g.charges_total += Number(b.charges_total || 0);
          g.amount_paid += Number(b.amount_paid || 0);
        }
      } else {
        deduped.push({
          total_amount: Number(b.total_amount || 0),
          charges_total: Number(b.charges_total || 0),
          amount_paid: Number(b.amount_paid || 0),
          status: b.status
        });
      }
    }
    const openBalances = deduped.filter((booking) => {
      if (String(booking.status || '').toLowerCase() === 'cancelled') return false;
      return Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)) > 0;
    });
    const confOpen = allConf
      .filter((cb) => String(cb.payment_status || '').toLowerCase() !== 'cancelled')
      .filter((cb) => Number(cb.total_amount || 0) - Number(cb.deposit_paid || 0) > 0);
    const totalOpen = openBalances.length + confOpen.length;
    const amount = openBalances.reduce((sum, booking) => (
      sum + Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0))
    ), 0) + confOpen.reduce((sum, cb) => (
      sum + Math.max(0, Number(cb.total_amount || 0) - Number(cb.deposit_paid || 0))
    ), 0);
    return { count: totalOpen, amount };
  } catch {
    return { count: 0, amount: 0 };
  }
}

export async function getBookingById(id) {
  if (!id) return null;
  try {
    const { data, error } = await state.supabase.
    from('bookings').
    select('*').
    eq('id', id).
    eq('lodge_id', state.lodgeId).
    single();
    if (error) throw error;
    return data || null;
  } catch {
    return readCache('bookings').find((booking) => booking.id === id) || null;
  }
}

export async function getPendingOnlineBookings() {
  try {
    if (state.isOnline) {
      const { data, error } = await state.supabase.
      from('bookings').
      select(`id, lodge_id, customer_id, room_id, check_in, check_out, adults, children, total_amount, amount_paid, payment_status, status, source, created_at, notes, customers(name, phone, email), rooms(room_number, room_type)`).
      eq('lodge_id', state.lodgeId).
      eq('source', 'online').
      eq('status', 'pending').
      order('created_at', { ascending: false }).
      limit(100);
      if (error) throw error;
      return (data || []).map((b) => ({
        ...b,
        customer_name: b.customers?.name,
        customer_phone: b.customers?.phone,
        customer_email: b.customers?.email,
        room_number: b.rooms?.room_number,
        room_type: b.rooms?.room_type
      }));
    }
    // Offline fallback — filter from cache
    const cached = readCache('bookings');
    return cached.filter((b) => b.source === 'online' && b.status === 'pending');
  } catch {
    const cached = readCache('bookings');
    return cached.filter((b) => b.source === 'online' && b.status === 'pending');
  }
}

export async function getBookingsByDateRange(startDate, endDate) {
  if (state.isOnline) {
    const data = await fetchPagedBookingRows(() => state.supabase.
      from('bookings').
      select(`*, customers(name), rooms(room_number, room_type, rate_per_night)`).
      eq('lodge_id', state.lodgeId).
      neq('status', 'cancelled').
      lte('check_in', endDate).
      gt('check_out', startDate), 5000);

    if (data) {
      return data.map((b) => ({
        ...b,
        customer_name: b.customers?.name,
        room_number: b.rooms?.room_number,
        room_type: b.rooms?.room_type,
        rate_per_night: b.rooms?.rate_per_night
      }));
    }
    return [];
  }

  const bookings = readCache('bookings');
  const customers = readCache('customers');
  const rooms = readCache('rooms');

  return bookings.
  filter(
    (b) => b.status !== 'cancelled' && b.check_in <= endDate && b.check_out > startDate
  ).
  map((b) => {
    const customer = customers.find((c) => c.id === b.customer_id);
    const room = rooms.find((r) => r.id === b.room_id);
    return {
      ...b,
      customer_name: customer?.name,
      room_number: room?.room_number,
      room_type: room?.room_type,
      rate_per_night: room?.rate_per_night
    };
  }).
  sort((a, b) => (a.room_number || '').localeCompare(b.room_number || ''));
}

function normalizeEventBookingName(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildEventGroupId({ eventName, checkIn, checkOut }) {
  const signature = [
  normalizeLodgeId(state.lodgeId) || 'no-lodge',
  normalizeEventBookingName(eventName),
  String(checkIn || '').trim(),
  String(checkOut || '').trim()].
  join('|');
  return `evt-${crypto.createHash('sha256').update(signature).digest('hex').slice(0, 24)}`;
}

function parseEventRoomCount(notes = '') {
  const match = String(notes || '').match(/\[ROOMS:(\d+)\]/);
  const count = Number(match?.[1] || 0);
  return Number.isFinite(count) && count > 0 ? count : null;
}

function stripEventMetadata(notes = '') {
  return String(notes || '').replace(/\[GROUP:[^\]]+\]/g, '').replace(/\[ROOMS:\d+\]/g, '').trim();
}

function findCachedEventBookingByGroup(groupId) {
  return readCache('bookings').find((booking) =>
  booking?.is_exclusive_event &&
  String(booking?.notes || '').includes(`[GROUP:${groupId}]`) &&
  String(booking?.status || '').toLowerCase() !== 'cancelled'
  );
}

async function findRemoteEventBookingByGroup(groupId) {
  if (!state.isOnline) return null;
  const { data, error } = await state.supabase.
  from('bookings').
  select('id, notes, total_amount, check_in, check_out').
  eq('lodge_id', state.lodgeId).
  eq('is_exclusive_event', true).
  neq('status', 'cancelled').
  ilike('notes', `%[GROUP:${groupId}]%`).
  limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] || null;
}

function validateBookingDates(checkIn, checkOut) {
  if (!checkIn || !checkOut) throw new Error('Check-in and check-out dates are required');
  const inMs = new Date(checkIn).getTime();
  const outMs = new Date(checkOut).getTime();
  if (isNaN(inMs) || isNaN(outMs)) throw new Error('Invalid date format');
  if (outMs <= inMs) throw new Error('Check-out must be after check-in');
  const nights = Math.ceil((outMs - inMs) / (1000 * 60 * 60 * 24));
  if (nights < 1) throw new Error('Booking must be at least one night');
  return { nights };
}

async function checkRoomConflict(roomId, checkIn, checkOut, excludeId = null) {
  await checkExclusiveEventConflict(checkIn, checkOut);
  const existingBookings = state.isOnline ?
  (() => {
    let q = state.supabase.
    from('bookings').
    select('id, check_in, check_out').
    eq('lodge_id', state.lodgeId).
    eq('room_id', roomId).
    neq('status', 'cancelled');
    if (excludeId) q = q.neq('id', excludeId);
    return q;
  })().then((r) => r.data || []) :
  Promise.resolve(
    readCache('bookings').filter(
      (b) => b.room_id === roomId && b.status !== 'cancelled' && b.id !== excludeId
    )
  );

  const bookings = await existingBookings;
  const conflict = bookings.find((b) => b.check_in < checkOut && b.check_out > checkIn);
  if (conflict) throw new Error('Room is already booked for these dates');
}

export async function createBooking(data) {
  try {
    await assertCreationWithinUsageLimit('booking', {
      forceRemoteRefresh: state.isOnline,
      monthDate: data?.check_in ? new Date(data.check_in) : new Date()
    });
    const { nights } = validateBookingDates(data.check_in, data.check_out);
    await checkRoomConflict(data.room_id, data.check_in, data.check_out);

    const room = await getRoomById(data.room_id);
    if (!room) throw new Error('Room not found');
    const totalGuests = (data.adults || 1) + (data.children || 0);
    if (totalGuests > (room.max_occupancy || 2)) {
      throw new Error(`Number of guests (${totalGuests}) exceeds room maximum occupancy (${room.max_occupancy || 2})`);
    }
    const campsite = isCampsiteUnit(room);
    const adults = Math.max(0, Number(data.adults ?? 1));
    const children = Math.max(0, Number(data.children ?? 0));
    const tents = campsite ? Math.max(0, Number(data.tents ?? 0)) : 0;
    const vehicles = campsite ? Math.max(0, Number(data.vehicles ?? 0)) : 0;
    let baseTotal = campsite
      ? computeStayTotal(room, { nights, adults, children, tents, vehicles })
      : Number(room.rate_per_night || 0) * nights;
    // Prefer server quote (rate plans + night overrides). Fall back to local override/base.
    try {
      if (state.isOnline && typeof state.supabase?.rpc === 'function') {
        const { data: quote, error: quoteError } = await state.supabase.rpc(campsite ? 'accommodation_booking_expected_total' : 'quote_room_stay', campsite ? {
          p_lodge_id: state.lodgeId,
          p_room_id: data.room_id,
          p_check_in: data.check_in,
          p_check_out: data.check_out,
          p_adults: adults,
          p_children: children,
          p_tents: tents,
          p_vehicles: vehicles,
          p_corporate_account_id: data.corporate_account_id || null
        } : {
          p_lodge_id: state.lodgeId,
          p_room_id: data.room_id,
          p_check_in: data.check_in,
          p_check_out: data.check_out,
          p_corporate_account_id: data.corporate_account_id || null
        });
        if (!quoteError && (campsite ? Number.isFinite(Number(quote)) : quote?.success && Number.isFinite(Number(quote.total))) && Number(campsite ? quote : quote.total) >= 0) {
          baseTotal = Number(campsite ? quote : quote.total);
        } else {
          const override = await getApplicableRate(data.room_id, data.check_in, data.check_out);
          if (override && Number.isFinite(Number(override.rate)) && Number(override.rate) > 0) {
            baseTotal = Number(override.rate) * nights;
          }
        }
      } else {
        const override = await getApplicableRate(data.room_id, data.check_in, data.check_out);
        if (override && Number.isFinite(Number(override.rate)) && Number(override.rate) > 0) {
          baseTotal = Number(override.rate) * nights;
        }
      }
    } catch { /* fall back to base rate */ }
    const requestedTotal = Number(data.total_amount);
    const allowTotalOverride = data.allow_total_override === true &&
    Number.isFinite(requestedTotal) &&
    requestedTotal > 0 &&
    Math.abs(requestedTotal - baseTotal) > 0.01;
    const total = allowTotalOverride ? requestedTotal : baseTotal;
    if (isNaN(total) || total <= 0) throw new Error('Invalid total — check room rate and dates');

    const deposit = Number(data.deposit_amount) || 0;
    const paymentMethod = data.payment_method || 'cash';
    const invoice_number = await getNextBookingInvoiceNumber();
    const id = randomUUID();
    const booking = {
      id,
      customer_id: data.customer_id,
      room_id: data.room_id,
      check_in: data.check_in,
      check_out: data.check_out,
      adults: data.adults || 1,
      children: data.children || 0,
      tents,
      vehicles,
      accommodation_kind: campsite ? 'campsite' : (room.accommodation_kind || 'room'),
      rate_mode: campsite ? normalizeRateMode(room.rate_mode) : null,
      total_amount: total,
      status: 'confirmed',
      payment_status: 'unpaid',
      amount_paid: 0,
      deposit_amount: deposit,
      payment_method: null,
      notes: data.notes || '',
      created_by: data.created_by || null,
      invoice_number,
      lodge_id: state.lodgeId
    };
    const bookingCreateIdempotencyKey = createBookingIdempotencyKey(id);

    if (state.isOnline) {
      if (!booking.customer_id) {
        throw new Error('Customer ID is required for booking');
      }

      const rpcName = campsite ? 'create_campsite_booking' : 'create_booking';
      const rpcPayload = campsite ? {
        p_lodge_id: booking.lodge_id,
        p_customer_id: booking.customer_id,
        p_room_id: booking.room_id,
        p_check_in: booking.check_in,
        p_check_out: booking.check_out,
        p_adults: booking.adults,
        p_children: booking.children,
        p_tents: booking.tents,
        p_vehicles: booking.vehicles,
        p_total_amount: booking.total_amount,
        p_invoice_number: booking.invoice_number,
        p_notes: booking.notes,
        p_created_by: booking.created_by,
        p_deposit_amount: deposit,
        p_booking_id: booking.id,
        p_idempotency_key: bookingCreateIdempotencyKey,
        p_deposit_method: deposit > 0 ? paymentMethod : null
      } : {
        p_lodge_id: booking.lodge_id,
        p_customer_id: booking.customer_id,
        p_room_id: booking.room_id,
        p_check_in: booking.check_in,
        p_check_out: booking.check_out,
        p_adults: booking.adults,
        p_children: booking.children,
        p_total_amount: booking.total_amount,
        p_invoice_number: booking.invoice_number,
        p_notes: booking.notes,
        p_created_by: booking.created_by,
        p_deposit_amount: deposit,
        p_booking_id: booking.id,
        p_idempotency_key: bookingCreateIdempotencyKey,
        p_deposit_method: deposit > 0 ? paymentMethod : null,
        p_allow_total_override: allowTotalOverride
      };
      const { data: result, error } = await state.supabase.rpc(rpcName, rpcPayload);

      if (error) {
        if (/function create_booking|function create_campsite_booking|p_booking_id|p_idempotency_key|create_idempotency_key|p_allow_total_override/i.test(error.message || '')) {
          throw new Error('The Supabase booking sync contract is outdated. Run the latest checked-in booking sync migration, then try again.');
        }
        if (error.message?.includes('no_overlapping_bookings')) {
          throw new Error('This room is already booked for the selected dates.');
        }
        throw new Error('Network Error: ' + error.message);
      }
      if (!result || !result.success) {
        throw new Error(result?.error || 'Booking failed');
      }
      await refreshCache('bookings');
      const _r = readCache('rooms').find((r) => r.id === booking.room_id);
      const _c = readCache('customers').find((c) => c.id === booking.customer_id);
      logActivity('booking_created', `Booking created · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''} · ${booking.check_in} → ${booking.check_out}`);
      createBackup();

      const bookingId = result.booking_id || id;
      if (result.depositWarning) {
        const err = new Error(result.depositWarning);
        err.code = 'DEPOSIT_FAILED';
        err.booking_id = bookingId;
        throw err;
      }
      return bookingId;
    } else {
      const cached = readCache('bookings');
      const cachedCustomer = booking.customer_id ?
      readCache('customers').find((customer) => customer.id === booking.customer_id) :
      null;
      const optimisticPayment = buildOfflineBookingFinancialState(total, deposit);
      const newBooking = {
        ...booking,
        amount_paid: optimisticPayment.amount_paid,
        payment_status: optimisticPayment.payment_status,
        _local_invoice_number: buildLocalPendingInvoiceNumber(id),
        _pending_sync: true,
        _pending_payment: deposit > 0,
        _financial_estimate: deposit > 0,
        _sync_created_offline: true,
        _sync_state: 'pending',
        _sync_error: null,
        created_at: new Date().toISOString()
      };

      queueOperation('rpc', campsite ? 'create_campsite_booking' : 'create_booking', {
        p_lodge_id: booking.lodge_id,
        p_customer_id: booking.customer_id,
        p_room_id: booking.room_id,
        p_check_in: booking.check_in,
        p_check_out: booking.check_out,
        p_adults: booking.adults,
        p_children: booking.children || 0,
        ...(campsite ? { p_tents: booking.tents, p_vehicles: booking.vehicles } : {}),
        p_total_amount: booking.total_amount,
        p_invoice_number: booking.invoice_number,
        p_notes: booking.notes || '',
        p_created_by: booking.created_by,
        p_deposit_amount: deposit,
        p_booking_id: booking.id,
        p_idempotency_key: bookingCreateIdempotencyKey,
        p_deposit_method: deposit > 0 ? paymentMethod : null,
        p_allow_total_override: allowTotalOverride
      }, null, {
        _queue_id: `booking-${id}`,
        ...(cachedCustomer?._pending_sync ? { _depends_on: `customer-${booking.customer_id}` } : {})
      });

      cached.push(newBooking);
      writeCache('bookings', cached);

      const _r = readCache('rooms').find((r) => r.id === newBooking.room_id);
      const _c = readCache('customers').find((c) => c.id === newBooking.customer_id);

      logActivity(
        'booking_created',
        `Booking created · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''} · ${newBooking.check_in} → ${newBooking.check_out}`
      );

      createBackup();

      return id;
    }
  } catch (error) {
    recordCriticalError('booking.create', error, {
      customer_id: data?.customer_id || null,
      room_id: data?.room_id || null,
      check_in: data?.check_in || null,
      check_out: data?.check_out || null,
      deposit_amount: Number(data?.deposit_amount || 0)
    });
    throw error;
  }
}

export async function createMultiRoomBooking(data = {}) {
  const requestedRooms = Array.isArray(data.rooms) ? data.rooms : [];
  const roomLines = requestedRooms.
  map((entry) => ({
    room_id: String(entry?.room_id || '').trim(),
    adults: Math.max(1, Number(entry?.adults || 1)),
    children: Math.max(0, Number(entry?.children || 0))
  })).
  filter((entry) => entry.room_id);
  const uniqueRoomIds = [...new Set(roomLines.map((entry) => entry.room_id))];
  if (uniqueRoomIds.length < 2) {
    throw new Error('Select at least two rooms for a multi-room booking.');
  }
  if (uniqueRoomIds.length !== roomLines.length) {
    throw new Error('Each room can only be selected once.');
  }
  if (!data.customer_id) {
    throw new Error('Customer ID is required for multi-room booking.');
  }

  const { nights } = validateBookingDates(data.check_in, data.check_out);
  await assertCreationWithinUsageLimit('booking', {
    forceRemoteRefresh: state.isOnline,
    monthDate: new Date(data.check_in),
    requestedUnits: roomLines.length
  });
  await checkExclusiveEventConflict(data.check_in, data.check_out);

  const groupId = data.group_id || buildAccommodationGroupId();
  const roomPlans = [];
  for (const line of roomLines) {
    await checkRoomConflict(line.room_id, data.check_in, data.check_out);
    const room = await getRoomById(line.room_id);
    if (!room) throw new Error('Room not found');
    const totalGuests = line.adults + line.children;
    if (totalGuests > (room.max_occupancy || 2)) {
      throw new Error(`Room ${room.room_number || ''} exceeds maximum occupancy (${room.max_occupancy || 2}).`);
    }
    let effectiveRate = room.rate_per_night;
    try {
      const override = await getApplicableRate(line.room_id, data.check_in, data.check_out);
      if (override && Number.isFinite(Number(override.rate)) && Number(override.rate) > 0) {
        effectiveRate = Number(override.rate);
      }
    } catch { /* fall back to base rate */ }
    const total = Number(effectiveRate || 0) * nights;
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error(`Invalid total for room ${room.room_number || ''}. Check room rate and dates.`);
    }
    roomPlans.push({ ...line, room, total });
  }

  const groupTotal = roomPlans.reduce((sum, plan) => sum + Number(plan.total || 0), 0);
  let remainingDeposit = Math.min(Math.max(0, Number(data.deposit_amount || 0)), groupTotal);
  const created = [];
  const groupNotes = appendAccommodationGroupMetadata(data.notes || '', groupId, roomPlans.length);

  try {
    for (const plan of roomPlans) {
      const lineDeposit = Math.min(remainingDeposit, plan.total);
      remainingDeposit = Math.max(0, Math.round((remainingDeposit - lineDeposit) * 100) / 100);
      const bookingId = await createBooking({
        customer_id: data.customer_id,
        room_id: plan.room_id,
        check_in: data.check_in,
        check_out: data.check_out,
        adults: plan.adults,
        children: plan.children,
        deposit_amount: lineDeposit,
        payment_method: data.payment_method,
        notes: groupNotes,
        created_by: data.created_by || null,
        allow_total_override: true,
        total_amount: plan.total
      });
      created.push({
        booking_id: bookingId,
        room_id: plan.room_id,
        room_number: plan.room?.room_number || null,
        total_amount: plan.total,
        deposit_amount: lineDeposit
      });
    }
    await createBookingInvoiceGroup({
      groupKey: groupId,
      customerId: data.customer_id,
      bookingIds: created.map((entry) => entry.booking_id),
      notes: stripAccommodationGroupMetadata(data.notes || ''),
      createdBy: data.created_by || state.currentUser?.id || null
    });
  } catch (error) {
    error.message = created.length > 0
      ? `${error.message} Some room bookings may already have been created; review the bookings list before retrying.`
      : error.message;
    throw error;
  }

  logActivity(
    'booking_group_created',
    `Multi-room booking created · ${created.length} rooms · ${data.check_in} → ${data.check_out}`
  );

  return {
    success: true,
    group_id: groupId,
    group_invoice_number: (readCache('booking-invoice-groups') || []).find((group) => group?.group_key === groupId)?.invoice_number || null,
    booking_ids: created.map((entry) => entry.booking_id),
    bookings: created,
    total_amount: groupTotal,
    deposit_amount: Math.min(Math.max(0, Number(data.deposit_amount || 0)), groupTotal)
  };
}

export async function updateBooking(id, data) {
  try {
    const { nights } = validateBookingDates(data.check_in, data.check_out);
    await checkRoomConflict(data.room_id, data.check_in, data.check_out, id);

    const room = await getRoomById(data.room_id);
    if (!room) throw new Error('Room not found');
    const totalGuests = (data.adults || 1) + (data.children || 0);
    if (totalGuests > (room.max_occupancy || 2)) {
      throw new Error(`Number of guests (${totalGuests}) exceeds room maximum occupancy (${room.max_occupancy || 2})`);
    }
    const total = room.rate_per_night * nights;
    if (isNaN(total) || total <= 0) throw new Error('Invalid total — check room rate and dates');

    // Local payment_status estimate for the offline cache only.
    // The server ALWAYS recomputes payment_status authoritatively (Phase 2 hardening).
    // payment_status is intentionally NOT sent in the RPC payload — the server ignores it anyway.
    const currentBooking = readCache('bookings').find((b) => b.id === id);
    const expectedUpdatedAt = data.expected_updated_at || currentBooking?.updated_at || null;
    const amountPaid = Number(currentBooking?.amount_paid) || 0;
    // Include charges_total so the offline estimate matches server logic
    const chargesTotal = Number(currentBooking?.charges_total) || 0;
    const totalOwed = total + chargesTotal;
    const offlinePaymentStatus = amountPaid >= totalOwed ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';

    // payment_status is NOT included — server derives it from authoritative fields
    const update = {
      customer_id: data.customer_id,
      room_id: data.room_id,
      check_in: data.check_in,
      check_out: data.check_out,
      adults: data.adults,
      children: data.children,
      total_amount: total,
      notes: data.notes,
      updated_at: new Date().toISOString()
    };

    const rpcPayload = {
      ...update,
      ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {})
    };
    const idempotencyKey = createOperationIdempotencyKey(`booking:update:${id}`, {
      expected_updated_at: expectedUpdatedAt,
      customer_id: update.customer_id,
      room_id: update.room_id,
      check_in: update.check_in,
      check_out: update.check_out,
      adults: update.adults,
      children: update.children,
      total_amount: update.total_amount,
      notes: update.notes
    });

    if (state.isOnline) {
      const { data: result, error } = await state.supabase.rpc('update_booking', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        payload: rpcPayload,
        p_expected_updated_at: rpcPayload.expected_updated_at || null,
        p_idempotency_key: idempotencyKey
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not update booking');
      await refreshCache('bookings');
    } else {
      const cached = readCache('bookings');
      const idx = cached.findIndex((b) => b.id === id);
      const _updDepend = cached[idx]?._pending_sync ? `booking-${id}` : null;
      // Queue FIRST — dependency resolved from pre-write cache; no second read needed
      queueOperation('rpc', 'update_booking', {
        p_id: id,
        p_lodge_id: state.lodgeId,
        payload: rpcPayload,
        p_expected_updated_at: rpcPayload.expected_updated_at || null,
        p_idempotency_key: idempotencyKey
      }, null, _updDepend ? { _depends_on: _updDepend } : {});
      // Cache SECOND — offline estimate includes charges_total for correct local display
      if (idx >= 0) {
        cached[idx] = {
          ...cached[idx],
          ...update,
          payment_status: offlinePaymentStatus,
          _pending_payment: true,
          _pending_sync: true
        };
      }
      writeCache('bookings', cached);
    }
  } catch (error) {
    recordCriticalError('booking.update', error, {
      booking_id: id,
      room_id: data?.room_id || null,
      check_in: data?.check_in || null,
      check_out: data?.check_out || null
    });
    throw error;
  }
}

export async function updateBookingStatus(id, status) {
  // Enforce state machine — read current status from cache first
  const currentBooking = readCache('bookings').find((b) => b.id === id);
  if (currentBooking) {
    const allowed = VALID_STATUS_TRANSITIONS[currentBooking.status];
    if (allowed && !allowed.includes(status)) {
      throw new Error(`Cannot transition booking from '${currentBooking.status}' to '${status}'`);
    }
  }

  if (status === 'checked_in' && currentBooking) {
    if (String(currentBooking.check_in) > getLocalDateKey()) {
      throw new Error(`Cannot check in before the check-in date (${currentBooking.check_in}).`);
    }
  }

  if (status === 'checked_out' && currentBooking) {
    const outstanding = Math.max(
      0,
      Number(currentBooking.total_amount || 0) + Number(currentBooking.charges_total || 0) - Number(currentBooking.amount_paid || 0)
    );
    if (outstanding > 0) {
      throw new Error(`Cannot check out this guest until the full balance is paid. Outstanding: ${outstanding.toFixed(2)}`);
    }
  }

  const expectedUpdatedAt = currentBooking?.updated_at || null;
  const update = { status, updated_at: new Date().toISOString() };
  const idempotencyKey = createOperationIdempotencyKey(`booking:status:${id}`, {
    expected_updated_at: expectedUpdatedAt,
    status
  });

  const roomStatus =
  status === 'checked_in' ? 'occupied' :
  status === 'checked_out' || status === 'cancelled' ? 'available' : null;

  const actionLabel = {
    checked_in: 'Check-in',
    checked_out: 'Check-out',
    cancelled: 'Booking cancelled',
    confirmed: 'Booking confirmed'
  }[status] || `Status → ${status}`;

  const actionKey = {
    checked_in: 'check_in',
    checked_out: 'check_out',
    cancelled: 'booking_cancelled',
    confirmed: 'booking_confirmed'
  }[status] || 'booking_updated';

  if (state.isOnline) {
    const { data: booking } = await state.supabase.
    from('bookings').select('room_id, customer_id').
    eq('id', id).eq('lodge_id', state.lodgeId).single();
    const { data: result, error } = await state.supabase.rpc('update_booking_status', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_status: status,
      p_expected_updated_at: expectedUpdatedAt,
      p_idempotency_key: idempotencyKey
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update booking status');
    await refreshCache('bookings', 'rooms');
    const _r = readCache('rooms').find((r) => r.id === booking?.room_id);
    const _c = readCache('customers').find((c) => c.id === booking?.customer_id);
    logActivity(actionKey, `${actionLabel} · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''}`);
    if (status === 'checked_in' || status === 'checked_out') createBackup();
  } else {
    const bookings = readCache('bookings');
    const idx = bookings.findIndex((b) => b.id === id);
    const bk = bookings[idx] || {};
    const roomId = bk.room_id;
    const _stDepend = bookings[idx]?._pending_sync ? `booking-${id}` : null;
    // Queue FIRST — single entry; update_booking_status updates room status atomically server-side.
    // IMPORTANT: Do NOT reintroduce set_room_status here.
    // update_booking_status RPC already updates room status atomically server-side.
    // Adding it again creates duplicate writes and potential race conditions.
    queueOperation('rpc', 'update_booking_status', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_status: status,
      p_expected_updated_at: _stDepend ? null : expectedUpdatedAt,
      p_idempotency_key: idempotencyKey
    }, null, _stDepend ? { _depends_on: _stDepend } : {});
    // Cache SECOND — booking
    if (idx >= 0) bookings[idx] = { ...bookings[idx], ...update };
    writeCache('bookings', bookings);
    // Cache SECOND — room (read rooms only when needed; room variable preserved for logActivity)
    if (roomStatus && roomId) {
      const rooms = readCache('rooms');
      const rIdx = rooms.findIndex((r) => r.id === roomId);
      const room = rooms[rIdx];
      if (rIdx >= 0) rooms[rIdx] = { ...rooms[rIdx], status: roomStatus };
      writeCache('rooms', rooms);
      const _c = readCache('customers').find((c) => c.id === bk.customer_id);
      logActivity(actionKey, `${actionLabel} · ${_c?.name || 'Guest'} · Room ${room?.room_number || ''}`);
    } else {
      logActivity(actionKey, `${actionLabel} · Booking #${id}`);
    }
    if (status === 'checked_in' || status === 'checked_out') createBackup();
  }
}

export async function updateBookingPayment(id, paymentAmount, paymentMethod, type = 'payment', dependsOn = null, callerKey = null) {
  const numericAmount = Number(paymentAmount) || 0;
  const currentBooking = readCache('bookings').find((b) => b.id === id) || null;
  const expectedUpdatedAt = currentBooking?.updated_at || null;
  if (type === 'refund') {
    if (numericAmount >= 0) throw new Error('Refund amount must be negative');
  } else if (numericAmount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }
  // Generate deterministic fallback signature (booking+status+amount) to prevent double-payments
  // even if intentKey is lost after app restart. Format: booking_id:status:amount
  const fallbackSignature = buildPaymentFallbackSignature(id, type, numericAmount, expectedUpdatedAt);
  if (type === 'payment' && !callerKey) {
    console.warn('[PAYMENT] Missing intent key — using deterministic fallback signature. Booking:', id, 'Signature:', fallbackSignature);
  }
  const idempotencyKey = callerKey ?
  createPaymentIdempotencyKey(id, type, callerKey) :
  createPaymentIdempotencyKey(id, type, null, fallbackSignature);
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_booking_payment', {
      p_booking_id: id,
      p_lodge_id: state.lodgeId,
      p_amount: numericAmount,
      p_method: paymentMethod || 'cash',
      p_type: type,
      p_idempotency_key: idempotencyKey,
      p_recorded_by: state.currentUser?.id || null,
      p_expected_updated_at: expectedUpdatedAt
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Payment failed');

    await refreshCache('bookings');
    const bk = readCache('bookings').find((b) => b.id === id);
    const _c = readCache('customers').find((c) => c.id === bk?.customer_id);
    const activityLabel = type === 'refund' ? 'refund_processed' : 'payment_updated';
    const verb = type === 'refund' ? 'Refund recorded' : 'Payment updated';
    logActivity(activityLabel, `${verb} · ${_c?.name || 'Guest'} · ${result.payment_status} · ${Math.abs(numericAmount).toFixed(2)} (${paymentMethod})`);
    return { success: true, offline: false, ...result };
  } else {
    const cached = readCache('bookings');
    const idx = cached.findIndex((b) => b.id === id);
    if (idx >= 0) {
      const b = cached[idx];
      const newPaid = (Number(b.amount_paid) || 0) + numericAmount;
      if (newPaid < 0) {
        throw new Error('Payment update would result in a negative amount paid.');
      }
      // Canonical amount owed = room total + charges; || 0 guards against null/undefined charges_total
      const totalOwed = (Number(b.total_amount) || 0) + (Number(b.charges_total) || 0);

      if (type === 'payment' && newPaid > totalOwed + 0.01) {
        throw new Error(`Amount paid (${newPaid.toFixed(2)}) cannot exceed total booking value (${totalOwed.toFixed(2)}).`);
      }

      // Use b._pending_sync (pre-write value) — only depend on booking creation entry;
      // avoids false dependency when booking is already synced to server
      const autoDepend = dependsOn || (b._pending_sync ? `booking-${id}` : null);
      const paymentMeta = autoDepend ? { _depends_on: autoDepend } : {};
      // Queue FIRST — intent is durable before local state changes
      queueOperation('rpc', 'update_booking_payment', {
        p_booking_id: id,
        p_lodge_id: state.lodgeId,
        p_amount: numericAmount,
        p_method: paymentMethod || 'cash',
        p_type: type,
        p_idempotency_key: idempotencyKey,
        p_recorded_by: state.currentUser?.id || null,
        p_expected_updated_at: b.updated_at || null
      }, null, paymentMeta);
      // Cache SECOND
      cached[idx] = {
        ...b,
        amount_paid: newPaid,
        payment_status: newPaid >= totalOwed && totalOwed > 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid',
        _pending_payment: true, // local estimate — not server-confirmed; cleared by refreshCache
        _financial_estimate: true,
        _pending_sync: true, // UI-only flag — never sent to Supabase; cleared by next refreshCache from DB
        updated_at: new Date().toISOString()
      };
      writeCache('bookings', cached);
      const _c = readCache('customers').find((c) => c.id === b.customer_id);
      const activityLabel = type === 'refund' ? 'refund_processed' : 'payment_updated';
      const verb = type === 'refund' ? 'Refund recorded (offline)' : 'Payment updated (offline)';
      logActivity(activityLabel, `${verb} · ${_c?.name || 'Guest'} · Pending sync · ${Math.abs(numericAmount).toFixed(2)} (${paymentMethod})`);
      return { success: true, offline: true, queued: true };
    } else {
      // Booking not found in cache — queue with no dependency (prevents false links)
      queueOperation('rpc', 'update_booking_payment', {
        p_booking_id: id,
        p_lodge_id: state.lodgeId,
        p_amount: numericAmount,
        p_method: paymentMethod || 'cash',
        p_type: type,
        p_idempotency_key: idempotencyKey,
        p_recorded_by: state.currentUser?.id || null,
        p_expected_updated_at: expectedUpdatedAt
      }, null, dependsOn ? { _depends_on: dependsOn } : {});
      return { success: true, offline: true, queued: true };
    }
  }
}

export async function getBookingPayments(bookingId) {
  if (!bookingId) return [];
  // NOTE: Payment history is only available when online.
  // When offline, callers should display the booking's amount_paid and note that detailed payment history is unavailable.
  if (!state.isOnline) return [];
  const { data, error } = await state.supabase.rpc('get_booking_payments', {
    p_booking_id: bookingId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function updateGroupInvoicePayment(groupId, amount, method, intentKey = null) {
  if (!groupId) throw new Error('Group invoice is required');
  const paymentAmount = Math.max(0, Number(amount || 0));
  if (paymentAmount <= 0) throw new Error('Payment amount must be greater than zero');
  const invoices = await getBookingInvoices();
  const group = invoices.find((invoice) => invoice?._accommodation_group && invoice.accommodation_group_id === groupId);
  if (!group) throw new Error('Group invoice not found');
  let remaining = Math.min(paymentAmount, Math.max(0, Number(group.balance_due || 0)));
  if (remaining <= 0) throw new Error('This group invoice is already settled');
  const allocations = [];
  const baseIntent = intentKey || randomUUID();
  for (const line of group._room_lines || []) {
    if (remaining <= 0) break;
    const lineDue = Math.max(0, Number(line.balance_due || 0));
    if (lineDue <= 0) continue;
    const lineAmount = Math.min(remaining, lineDue);
    const result = await updateBookingPayment(line.booking_id, lineAmount, method, 'payment', null, `${baseIntent}:${line.booking_id}`);
    allocations.push({ booking_id: line.booking_id, amount: lineAmount, result });
    remaining = Math.max(0, Math.round((remaining - lineAmount) * 100) / 100);
  }
  return {
    success: true,
    group_id: groupId,
    invoice_number: group.invoice_number,
    amount_applied: paymentAmount - remaining,
    unallocated_amount: remaining,
    allocations,
    offline: allocations.some((entry) => entry.result?.offline)
  };
}

export async function refundGroupInvoice(groupId, options = {}) {
  if (!groupId) throw new Error('Group invoice is required');
  const invoices = await getBookingInvoices();
  const group = invoices.find((invoice) => invoice?._accommodation_group && invoice.accommodation_group_id === groupId);
  if (!group) throw new Error('Group invoice not found');
  const lines = (group._room_lines || []).filter((line) => line?.booking_id && Number(line.amount_paid || 0) > 0.01);
  if (lines.length === 0) throw new Error('This group invoice has no paid amount available to refund');
  const results = [];
  for (const line of lines) {
    const result = await refundBooking(line.booking_id, {
      ...options,
      notes: [options.notes || '', `Group invoice refund ${group.invoice_number || groupId}`].filter(Boolean).join('\n')
    });
    results.push({ booking_id: line.booking_id, refund_amount: result.refund_amount || 0, retained_amount: result.retained_amount || 0, result });
  }
  return {
    success: true,
    group_id: groupId,
    invoice_number: group.invoice_number,
    refund_amount: results.reduce((sum, entry) => sum + Number(entry.refund_amount || 0), 0),
    retained_amount: results.reduce((sum, entry) => sum + Number(entry.retained_amount || 0), 0),
    results
  };
}

export async function refundBooking(bookingId, options = {}) {
  try {
    const booking = (await getAllBookings()).find((entry) => entry.id === bookingId);
    if (!booking) throw new Error('Booking not found');
    const bookingStatus = String(booking.status || '').toLowerCase();
    if (bookingStatus === 'checked_in') {
      throw new Error('Refunds are not allowed while guest is checked in. Please wait until check-out or cancel the booking.');
    }

    const pendingRequest = getPendingRefundRequestForBooking(bookingId);
    const retainedPercent = Math.min(100, Math.max(0, Number(options.retained_percent ?? options.retainedPercent ?? pendingRequest?.retained_percent ?? 0) || 0));
    const baseAmount = Math.max(0, Number(booking.amount_paid || 0));
    if (baseAmount <= 0) throw new Error('This booking has no paid amount available to refund');

    const refundAmount = Math.round(baseAmount * ((100 - retainedPercent) / 100) * 100) / 100;
    const retainedAmount = Math.max(0, Math.round((baseAmount - refundAmount) * 100) / 100);
    if (refundAmount <= 0) throw new Error('Retained percentage leaves nothing to refund');

    const paymentMethod = String(options.method || pendingRequest?.method || 'refund').trim() || 'refund';
    const isCreditTransfer = paymentMethod === 'customer_credit_transfer';
    const notes = String(options.notes ?? pendingRequest?.notes ?? '').trim();
    const proofReference = String(options.proof_reference ?? options.proofReference ?? pendingRequest?.proof_reference ?? '').trim();
    const approvalNote = String(options.approval_note ?? options.approvalNote ?? pendingRequest?.approval_note ?? '').trim();
    const approverPin = String(options.approver_pin ?? options.approverPin ?? '').trim();

    if (!proofReference) throw new Error('Proof reference is required before a refund can be approved');
    if (!state.isOnline) {
      const now = new Date().toISOString();
      const request = writeRefundRequest({
        id: String(options.request_id ?? options.requestId ?? pendingRequest?.id ?? randomUUID()),
        lodge_id: state.lodgeId || booking.lodge_id || null,
        booking_id: bookingId,
        invoice_number: booking.invoice_number || booking._local_invoice_number || null,
        customer_id: booking.customer_id || null,
        customer_name: booking.customer_name || null,
        amount_paid_before: baseAmount,
        refund_amount: refundAmount,
        retained_amount: retainedAmount,
        retained_percent: retainedPercent,
        method: paymentMethod,
        settlement_mode: isCreditTransfer ? 'customer_credit' : 'external_refund',
        proof_reference: proofReference,
        approval_note: approvalNote,
        notes,
        status: 'pending_approval',
        requires_online_approval: true,
        requested_by: state.currentUser?.id || null,
        requested_by_name: state.currentUser?.name || state.currentUser?.email || null,
        created_at: pendingRequest?.created_at || now,
        updated_at: now
      });
      patchCachedBookingRefundRequest(bookingId, request);
      appendOperationJournalEntry('refund_request_saved', {
        type: 'local',
        table: 'booking_refund_request',
        id: request.id,
        lodge_id: request.lodge_id,
        data: request
      }, {
        financial: true,
        state: 'pending_approval',
        message: 'Booking refund request saved locally; live manager approval is still required online.'
      });

      const customer = readCache('customers').find((entry) => entry.id === booking.customer_id);
      logActivity(
        'refund_requested',
        `Refund request saved locally · ${customer?.name || booking.customer_name || 'Guest'} · refundable ${refundAmount.toFixed(2)} · retained ${retainedAmount.toFixed(2)} (${retainedPercent.toFixed(2)}%)`
      );

      return {
        success: true,
        offline: true,
        pending_approval: true,
        booking_id: bookingId,
        request_id: request.id,
        request,
        refund_amount: refundAmount,
        retained_amount: retainedAmount,
        retained_percent: retainedPercent,
        method: paymentMethod,
        proof_reference: proofReference,
        notes
      };
    }
    if (!approverPin) throw new Error('Manager/Admin approval PIN is required');

    const { data: approver, error: approverError } = await state.supabase.rpc('verify_refund_approver_pin', {
      p_lodge_id: state.lodgeId,
      p_pin: approverPin
    });
    if (approverError) throw new Error(approverError.message);
    if (!approver?.success) throw new Error(approver?.error || 'Invalid approval PIN or unauthorized approver');

    const { data, error } = await state.supabase.rpc('approve_booking_refund', {
      p_booking_id: bookingId,
      p_lodge_id: state.lodgeId,
      p_retained_percent: retainedPercent,
      p_method: paymentMethod,
      p_notes: notes,
      p_requested_by: state.currentUser?.id || null,
      p_approved_by: approver.approved_by,
      p_proof_reference: proofReference,
      p_approval_note: approvalNote,
      p_idempotency_key: createOperationIdempotencyKey(`booking:refund:${bookingId}`, {
        expected_updated_at: booking.updated_at || null,
        retained_percent: retainedPercent,
        method: paymentMethod,
        notes,
        requested_by: state.currentUser?.id || null,
        approved_by: approver.approved_by,
        proof_reference: proofReference,
        approval_note: approvalNote
      })
    });

    if (error) throw new Error(error.message || 'Refund failed');
    if (!data?.success) throw new Error(data?.error || 'Refund failed');

    markRefundRequestApproved(bookingId, {
      approved_by: approver?.approved_by || null,
      approved_by_name: approver?.approved_by_name || null,
      proof_reference: proofReference,
      approval_note: approvalNote,
      approval_result: data
    });

    await refreshCache('bookings');

    const customer = readCache('customers').find((entry) => entry.id === booking.customer_id);
    logActivity(
      isCreditTransfer ? 'customer_credit_adjusted' : 'refund_processed',
      isCreditTransfer
        ? `Cancelled booking credit transfer · ${customer?.name || booking.customer_name || 'Guest'} · credited ${refundAmount.toFixed(2)} · retained ${retainedAmount.toFixed(2)} (${retainedPercent.toFixed(2)}%) · approved by ${approver?.approved_by_name || 'manager'}`
        : `Refund processed · ${customer?.name || booking.customer_name || 'Guest'} · refunded ${refundAmount.toFixed(2)} · retained ${retainedAmount.toFixed(2)} (${retainedPercent.toFixed(2)}%) · approved by ${approver?.approved_by_name || 'manager'}`
    );

    return {
      success: true,
      booking_id: bookingId,
      refund_amount: refundAmount,
      retained_amount: retainedAmount,
      retained_percent: retainedPercent,
      approved_by: approver?.approved_by || null,
      approved_by_name: approver?.approved_by_name || null,
      credit_transfer: data?.credit_transfer === true,
      credit_entry_id: data?.credit_entry_id || null,
      credit_balance: data?.credit_balance ?? null
    };
  } catch (error) {
    recordCriticalError('booking.refund', error, {
      booking_id: bookingId,
      retained_percent: options?.retained_percent ?? options?.retainedPercent ?? null,
      method: options?.method || 'refund'
    });
    throw error;
  }
}

export async function createEventBooking(data) {
  let customerId;
  let bookingCustomerDepend = null;
  const eventName = String(data.event_name || '').trim();
  if (!eventName) throw new Error('Event / group name is required');
  const { nights } = validateBookingDates(data.check_in, data.check_out);
  const groupId = buildEventGroupId({
    eventName,
    checkIn: data.check_in,
    checkOut: data.check_out
  });
  const cachedExistingEvent = findCachedEventBookingByGroup(groupId);
  if (cachedExistingEvent) {
    return {
      success: true,
      idempotent: true,
      bookingId: cachedExistingEvent.id,
      count: parseEventRoomCount(cachedExistingEvent.notes) || 1,
      groupId,
      rooms: [],
      totalPrice: Number(cachedExistingEvent.total_amount || 0),
      nights
    };
  }
  const contactCustomer = {
    name: eventName,
    phone: data.contact_phone || '',
    email: data.contact_email || '',
    id_number: '',
    nationality: '',
    lodge_id: state.lodgeId
  };

  if (state.isOnline) {
    const existingEvent = await findRemoteEventBookingByGroup(groupId);
    if (existingEvent) {
      return {
        success: true,
        idempotent: true,
        bookingId: existingEvent.id,
        count: parseEventRoomCount(existingEvent.notes) || 1,
        groupId,
        rooms: [],
        totalPrice: Number(existingEvent.total_amount || 0),
        nights
      };
    }

    const { data: existing } = await state.supabase.
    from('customers').select('id').eq('lodge_id', state.lodgeId).eq('name', eventName).limit(1);
    if (existing?.length > 0) {
      customerId = existing[0].id;
    } else {
      const newCustomer = { ...contactCustomer, id: randomUUID() };
      const { data: result, error } = await state.supabase.rpc('create_customer', { payload: newCustomer });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not create customer');
      customerId = result?.id;
    }
  } else {
    const cached = readCache('customers');
    const existing = cached.find((c) => c.name === eventName);
    if (existing) {
      customerId = existing.id;
      if (existing._pending_sync) {
        bookingCustomerDepend = `customer-${customerId}`;
      }
    } else {
      customerId = randomUUID();
      const newCustomer = { ...contactCustomer, id: customerId, _pending_sync: true, created_at: new Date().toISOString() };
      cached.push(newCustomer);
      writeCache('customers', cached);
      // P2-15: assign a stable _queue_id so booking records can declare _depends_on
      bookingCustomerDepend = `customer-${customerId}`;
      queueOperation('rpc', 'create_customer', {
        payload: {
          ...contactCustomer,
          id: customerId,
          created_at: newCustomer.created_at
        }
      }, null, { _queue_id: bookingCustomerDepend });
    }
  }

  const allRooms = await getAllRooms();
  const bookableRooms = allRooms.filter((r) => r.status !== 'maintenance');

  const conflicting = state.isOnline ?
  (
  await state.supabase.
  from('bookings').
  select('room_id').
  eq('lodge_id', state.lodgeId).
  neq('status', 'cancelled').
  lt('check_in', data.check_out).
  gt('check_out', data.check_in)).
  data || [] :
  readCache('bookings').filter(
    (b) =>
    b.status !== 'cancelled' &&
    b.check_in < data.check_out &&
    b.check_out > data.check_in
  );

  if (conflicting.length > 0) {
    const roomCount = new Set(conflicting.map((b) => b.room_id)).size;
    throw new Error(
      `Cannot create exclusive event — ${roomCount} room${roomCount !== 1 ? 's' : ''} already have bookings on these dates. Cancel or move existing bookings first.`
    );
  }

  if (bookableRooms.length === 0) {
    throw new Error('No rooms available — all rooms are under maintenance.');
  }

  const eventDailyRate = Number(data.event_daily_rate) || 0;
  const totalEventPrice = eventDailyRate * nights;
  const totalDeposit = Number(data.deposit_amount) || 0;
  const paymentMethod = data.payment_method || 'cash';
  const eventNotes = `[GROUP:${groupId}][ROOMS:${bookableRooms.length}]${data.notes ? '\n' + data.notes : ''}`;
  const representativeRoom = [...bookableRooms].sort((left, right) =>
  String(left.room_number || '').localeCompare(String(right.room_number || ''), undefined, { numeric: true, sensitivity: 'base' })
  )[0];

  const invoice_number = await getNextBookingInvoiceNumber();
  const bookingId = randomUUID();
  const eventIdempotencyKey = `event-booking:${groupId}`;
  const booking = {
    id: bookingId,
    customer_id: customerId,
    room_id: representativeRoom.id,
    check_in: data.check_in,
    check_out: data.check_out,
    adults: 1,
    children: 0,
    total_amount: totalEventPrice,
    status: 'confirmed',
    payment_status: 'unpaid',
    amount_paid: 0,
    deposit_amount: totalDeposit,
    payment_method: null,
    notes: eventNotes,
    is_exclusive_event: true,
    event_daily_rate: eventDailyRate,
    invoice_number,
    created_by: data.created_by || null,
    lodge_id: state.lodgeId
  };

  let createdBookingId = bookingId;

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_booking_record', {
      payload: {
        ...booking,
        deposit_method: totalDeposit > 0 ? paymentMethod : null,
        create_idempotency_key: eventIdempotencyKey,
        allow_total_override: true
      }
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create event booking');
    createdBookingId = result.booking_id || bookingId;
  } else {
    const newBooking = {
      ...booking,
      amount_paid: 0,
      payment_status: 'unpaid',
      _local_invoice_number: buildLocalPendingInvoiceNumber(bookingId),
      _pending_sync: true,
      _pending_payment: totalDeposit > 0,
      _sync_created_offline: true,
      _sync_state: 'pending',
      _sync_error: null,
      created_at: new Date().toISOString()
    };
    // Queue FIRST — crash before cache write means booking syncs but won't appear locally until refresh.
    queueOperation('rpc', 'create_booking_record', {
      payload: {
        ...booking,
        deposit_method: totalDeposit > 0 ? paymentMethod : null,
        create_idempotency_key: eventIdempotencyKey,
        allow_total_override: true
      }
    }, null, {
      _queue_id: `booking-${bookingId}`,
      ...(bookingCustomerDepend ? { _depends_on: bookingCustomerDepend } : {})
    });
    // Cache SECOND.
    const cachedBookings = readCache('bookings');
    cachedBookings.push(newBooking);
    writeCache('bookings', cachedBookings);
  }

  if (state.isOnline) await refreshCache('bookings');

  logActivity(
    'event_booking_created',
    `Exclusive event · ${eventName} · ${bookableRooms.length} room${bookableRooms.length !== 1 ? 's' : ''} · ${data.check_in} → ${data.check_out} · ${totalEventPrice.toFixed(2)}`
  );
  createBackup();

  return {
    bookingId: createdBookingId,
    count: bookableRooms.length,
    groupId,
    rooms: bookableRooms.map((r) => r.room_number),
    totalPrice: totalEventPrice,
    nights
  };
}

export async function getBookingCharges(bookingId) {
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('booking_charges').
    select('*, outlets(name)').
    eq('lodge_id', state.lodgeId).
    eq('booking_id', bookingId).
    is('voided_at', null).
    order('created_at');
    return mergeCachedBookingChargesForBooking(bookingId, data || []);
  }
  return readCache('booking-charges').
  filter((charge) => charge?.booking_id === bookingId && !charge?.voided_at).
  sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

export async function getBookingChargeById(chargeId) {
  if (!chargeId) return null;
  if (state.isOnline) {
    const { data, error } = await state.supabase.
    from('booking_charges').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('id', chargeId).
    single();
    if (error) throw new Error(error.message);
    return data || null;
  }
  return getCachedBookingChargeById(chargeId);
}

export async function addBookingCharge(bookingId, data) {
  try {
    if (Number(data.unit_price) <= 0) throw new Error('Charge unit price must be greater than zero');
    const currentBooking = readCache('bookings').find((booking) => booking.id === bookingId) || null;
    if (!currentBooking && !state.isOnline) throw new Error('Booking not found in offline cache');
    const quantity = Number(data.quantity) || 1;
    const unitPrice = Number(data.unit_price) || 0;
    const idempotencyKey = data.idempotency_key || createOperationIdempotencyKey(`booking:charge:${bookingId}`, {
      expected_updated_at: currentBooking?.updated_at || null,
      description: data.description,
      category: data.category || 'other',
      quantity,
      unit_price: unitPrice,
      outlet_id: data.outlet_id || null
    });
    if (state.isOnline) {
      const { data: result, error } = await state.supabase.rpc('add_booking_charge', {
        p_booking_id: bookingId,
        p_lodge_id: state.lodgeId,
        p_description: data.description,
        p_category: data.category || 'other',
        p_quantity: quantity,
        p_unit_price: unitPrice,
        p_outlet_id: data.outlet_id || null, // explicit outlet attribution; null = Unassigned
        p_expected_updated_at: currentBooking?.updated_at || null,
        p_idempotency_key: idempotencyKey
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not add booking charge');
      return { success: true, id: result?.id };
    }

    const chargeId = data.id || randomUUID();
    const amount = Math.round(quantity * unitPrice * 100) / 100;
    const outlet = readCache('outlets').find((entry) => entry?.id === data.outlet_id) || null;
    const queuedCharge = {
      id: chargeId,
      lodge_id: state.lodgeId,
      booking_id: bookingId,
      description: data.description,
      category: data.category || 'other',
      quantity,
      unit_price: unitPrice,
      amount,
      outlet_id: data.outlet_id || null,
      outlets: outlet ? { name: outlet.name } : null,
      source_reference: idempotencyKey,
      created_at: new Date().toISOString(),
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null
    };
    upsertCachedBookingCharge(queuedCharge);
    patchCachedBookingFinancialEstimate(bookingId, {
      charges_total: Number(currentBooking?.charges_total || 0) + amount
    });
    queueOperation('rpc', 'add_booking_charge', {
      p_booking_id: bookingId,
      p_lodge_id: state.lodgeId,
      p_description: data.description,
      p_category: data.category || 'other',
      p_quantity: quantity,
      p_unit_price: unitPrice,
      p_outlet_id: data.outlet_id || null,
      p_expected_updated_at: currentBooking?._pending_sync ? null : currentBooking?.updated_at || null,
      p_idempotency_key: idempotencyKey
    }, null, {
      _queue_id: `booking-charge-${chargeId}`,
      _local_charge_id: chargeId,
      ...(currentBooking?._pending_sync ? { _depends_on: `booking-${bookingId}` } : {})
    });
    return { success: true, id: chargeId, offline: true, queued: true };
  } catch (error) {
    recordCriticalError('booking.charge.add', error, {
      booking_id: bookingId,
      description: data?.description || '',
      amount: Number(data?.unit_price || 0) * Number(data?.quantity || 1)
    });
    throw error;
  }
}

export async function deleteBookingCharge(chargeId, reason = '') {
  try {
    const charge = await getBookingChargeById(chargeId).catch(() => null);
    if (!charge && !state.isOnline) throw new Error('Charge not found in offline cache');
    const currentBooking = charge?.booking_id ?
    readCache('bookings').find((booking) => booking.id === charge.booking_id) || null :
    null;
    if (state.isOnline) {
      const { data: result, error } = await state.supabase.rpc('delete_booking_charge', {
        p_charge_id: chargeId,
        p_lodge_id: state.lodgeId,
        p_reason: reason || null,
        p_expected_booking_updated_at: currentBooking?.updated_at || null
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not void booking charge');
      return { success: true, voided: !!result?.voided };
    }
    const amount = Number(charge?.amount ?? Number(charge?.quantity || 1) * Number(charge?.unit_price || 0));
    patchCachedBookingCharge(chargeId, {
      voided_at: new Date().toISOString(),
      void_reason: reason || null,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null
    });
    if (currentBooking) {
      patchCachedBookingFinancialEstimate(charge.booking_id, {
        charges_total: Math.max(0, Number(currentBooking.charges_total || 0) - amount)
      });
    }
    queueOperation('rpc', 'delete_booking_charge', {
      p_charge_id: chargeId,
      p_lodge_id: state.lodgeId,
      p_reason: reason || null,
      p_expected_booking_updated_at: currentBooking?._pending_sync ? null : currentBooking?.updated_at || null
    }, null, {
      _queue_id: `booking-charge-void-${chargeId}`,
      ...(charge?._pending_sync ? { _depends_on: `booking-charge-${chargeId}` } : {}),
      ...(currentBooking?._pending_sync && !charge?._pending_sync ? { _depends_on: `booking-${charge.booking_id}` } : {})
    });
    return { success: true, voided: true, offline: true, queued: true };
  } catch (error) {
    recordCriticalError('booking.charge.delete', error, {
      charge_id: chargeId,
      reason: reason || null
    });
    throw error;
  }
}

export async function getRateOverrides() {
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('room_rate_overrides').
    select('*').
    eq('lodge_id', state.lodgeId).
    order('start_date');
    return mergeRemoteRateOverridesWithLocal(data || []);
  }
  return readActiveRateOverrideCache();
}

export async function getRateOverrideById(id) {
  if (!id) return null;
  if (!state.isOnline) return getCachedRateOverrideById(id);
  const { data, error } = await state.supabase.
  from('room_rate_overrides').
  select('*').
  eq('lodge_id', state.lodgeId).
  eq('id', id).
  single();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function createRateOverride(data) {
  const id = data.id || randomUUID();
  const override = {
    id,
    lodge_id: state.lodgeId,
    room_id: data.room_id || null,
    name: data.name,
    start_date: data.start_date,
    end_date: data.end_date,
    rate_per_night: Number(data.rate_per_night)
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_room_rate_override', { payload: override });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create rate override');
    return { success: true, id: result?.id };
  }
  const offlineRow = {
    ...override,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null
  };
  writeCache('room-rate-overrides', [offlineRow, ...readCache('room-rate-overrides').filter((row) => row?.id !== id)]);
  queueOperation('rpc', 'create_room_rate_override', { payload: override }, null, {
    _queue_id: `rate-override-${id}`
  });
  return { success: true, id, offline: true, queued: true };
}

export async function updateRateOverride(id, data) {
  const update = {
    room_id: data.room_id || null,
    name: data.name,
    start_date: data.start_date,
    end_date: data.end_date,
    rate_per_night: Number(data.rate_per_night)
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_room_rate_override', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update rate override');
    return { success: true };
  }
  const existing = getCachedRateOverrideById(id);
  if (!existing) return { success: false, error: 'Rate override not found in offline cache' };
  writeCache('room-rate-overrides', readCache('room-rate-overrides').map((row) => row?.id === id ? {
    ...row,
    ...update,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  } : row));
  queueOperation('rpc', 'update_room_rate_override', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    payload: update
  }, null, {
    _queue_id: `rate-override-update-${id}-${Date.now()}`,
    ...(existing?._pending_sync ? { _depends_on: `rate-override-${id}` } : {})
  });
  return { success: true, offline: true, queued: true };
}

export async function deleteRateOverride(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_room_rate_override', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete rate override');
    return { success: true };
  }
  const existing = getCachedRateOverrideById(id);
  if (!existing) return { success: false, error: 'Rate override not found in offline cache' };
  writeCache('room-rate-overrides', readCache('room-rate-overrides').map((row) => row?.id === id ? {
    ...row,
    _deleted_offline: true,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  } : row));
  queueOperation('rpc', 'delete_room_rate_override', {
    p_id: id,
    p_lodge_id: state.lodgeId
  }, null, {
    _queue_id: `rate-override-delete-${id}-${Date.now()}`,
    ...(existing?._pending_sync ? { _depends_on: `rate-override-${id}` } : {})
  });
  return { success: true, offline: true, queued: true };
}

export async function getApplicableRate(roomId, checkIn, checkOut) {
  if (!state.isOnline) return findApplicableRateOverrideFromCache(roomId, checkIn, checkOut);
  try {
    const { data: overrides } = await state.supabase.
    from('room_rate_overrides').
    select('*').
    eq('lodge_id', state.lodgeId).
    lte('start_date', checkOut).
    gte('end_date', checkIn);
    if (!overrides || overrides.length === 0) return null;
    mergeRemoteRateOverridesWithLocal(overrides || []);
    const specific = overrides.find((o) => o.room_id === roomId);
    const global = overrides.find((o) => !o.room_id);
    const applicable = specific || global;
    return applicable ? { rate: applicable.rate_per_night, name: applicable.name } : null;
  } catch {
    return findApplicableRateOverrideFromCache(roomId, checkIn, checkOut);
  }
}

function getCachedActiveBookingForRoom(roomId) {
  if (!roomId) return null;
  const today = new Date().toISOString().split('T')[0];
  const cached = (readCache('bookings') || []).find((entry) =>
    entry?.lodge_id === state.lodgeId &&
    entry?.room_id === roomId &&
    ['confirmed', 'checked_in'].includes(String(entry?.status || '').toLowerCase()) &&
    entry?.check_in <= today &&
    entry?.check_out > today
  );
  if (!cached) return null;
  return {
    ...cached,
    customer_name: cached.customer_name || cached.customers?.name || null
  };
}

export async function getActiveBookingForRoom(roomId) {
  if (!state.isOnline) return getCachedActiveBookingForRoom(roomId);
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data, error } = await state.supabase.
    from('bookings').
    select('id, customer_id, customers(name)').
    eq('lodge_id', state.lodgeId).
    eq('room_id', roomId).
    in('status', ['confirmed', 'checked_in']).
    lte('check_in', today).
    gt('check_out', today).
    limit(1).
    maybeSingle();
    if (error) throw error;
    return data ?
    {
      ...data,
      customer_name: data.customer_name || data.customers?.name || null
    } :
    null;
  } catch {
    return getCachedActiveBookingForRoom(roomId);
  }
}

export async function rescheduleBooking(bookingId, {
  newRoomId,
  newCheckIn,
  newCheckOut,
  reason,
  overpaymentAction = 'reject',
  allowTotalOverride = false,
  overrideTotal = null
}) {
  try {
    if (!bookingId) throw new Error('Booking ID is required');
    if (!newRoomId) throw new Error('New room is required');
    if (!newCheckIn || !newCheckOut) throw new Error('New check-in and check-out dates are required');
    if (!reason || !reason.trim()) throw new Error('A reason is required for rescheduling');
    if (newCheckOut <= newCheckIn) throw new Error('Check-out must be after check-in');
    if (!['reject', 'transfer_to_customer_credit'].includes(overpaymentAction)) {
      throw new Error('overpayment_action must be reject or transfer_to_customer_credit');
    }

    const currentBooking = readCache('bookings').find((b) => b.id === bookingId) || null;
    const expectedUpdatedAt = currentBooking?.updated_at || null;

    const idempotencyKey = createOperationIdempotencyKey(`booking:reschedule:${bookingId}`, {
      new_room_id: newRoomId,
      new_check_in: newCheckIn,
      new_check_out: newCheckOut,
      reason: reason.trim(),
      overpayment_action: overpaymentAction,
      allow_total_override: Boolean(allowTotalOverride),
      override_total: allowTotalOverride ? overrideTotal : null,
      expected_updated_at: expectedUpdatedAt
    });

    if (state.isOnline) {
      const { data: result, error } = await state.supabase.rpc('reschedule_booking', {
        p_booking_id: bookingId,
        p_lodge_id: state.lodgeId,
        p_new_room_id: newRoomId,
        p_new_check_in: newCheckIn,
        p_new_check_out: newCheckOut,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
        p_overpayment_action: overpaymentAction,
        p_allow_total_override: allowTotalOverride,
        p_override_total: overrideTotal,
        p_expected_updated_at: expectedUpdatedAt,
        p_actor_id: state.currentUser?.id || null
      });
      if (error) throw new Error(error.message);
      if (!result?.success) throw new Error(result?.error || 'Could not reschedule booking');

      await refreshCache('bookings');
      const bk = readCache('bookings').find((b) => b.id === bookingId);
      const _c = readCache('customers').find((c) => c.id === bk?.customer_id);
      const _r = readCache('rooms').find((r) => r.id === newRoomId);
      logActivity(
        'booking_rescheduled',
        `Rescheduled · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''} · ${newCheckIn} → ${newCheckOut}`
      );
      createBackup();

      return {
        success: true,
        new_total: result.new_total,
        amount_paid: result.amount_paid,
        payment_status: result.payment_status,
        overpayment_transferred: result.overpayment_transferred,
        additional_due: result.additional_due,
        offline: false
      };
    } else {
      const cached = readCache('bookings');
      const idx = cached.findIndex((b) => b.id === bookingId);
      if (idx < 0) throw new Error('Booking not found in local cache');

      const b = cached[idx];
      if (!['pending', 'confirmed'].includes(b.status)) {
        throw new Error(`Cannot reschedule a booking in status "${b.status}"`);
      }

      const room = readCache('rooms').find((r) => r.id === newRoomId);
      if (!room) throw new Error('Room not found');
      if (room.status === 'maintenance') throw new Error('Selected room is under maintenance');

      const conflict = readCache('bookings').find((bk) =>
        bk.room_id === newRoomId &&
        bk.status !== 'cancelled' &&
        bk.id !== bookingId &&
        bk.check_in < newCheckOut &&
        bk.check_out > newCheckIn
      );
      if (conflict) throw new Error('Room is already booked for these dates');

      const eventConflict = readCache('bookings').find((bk) =>
        bk.is_exclusive_event &&
        bk.status !== 'cancelled' &&
        bk.check_in < newCheckOut &&
        bk.check_out > newCheckIn
      );
      if (eventConflict) throw new Error('The lodge is fully reserved for an exclusive event on these dates');

      const nights = Math.ceil((new Date(newCheckOut) - new Date(newCheckIn)) / (1000 * 60 * 60 * 24));
      const newTotal = room.rate_per_night * nights;
      const amountPaid = Number(b.amount_paid) || 0;
      const chargesTotal = Number(b.charges_total) || 0;
      const newOwed = newTotal + chargesTotal;
      const overpayment = Math.max(0, amountPaid - newOwed);

      if (overpayment > 0 && overpaymentAction === 'reject') {
        throw new Error(`Reschedule creates an overpayment of ${overpayment.toFixed(2)}. Use transfer_to_customer_credit or cancel.`);
      }

      let finalPaid = amountPaid;
      if (overpayment > 0 && overpaymentAction === 'transfer_to_customer_credit') {
        finalPaid = Math.max(0, amountPaid - overpayment);
      }

      const paymentStatus = finalPaid >= newOwed && newOwed > 0 ? 'paid' : finalPaid > 0 ? 'partial' : 'unpaid';

      queueOperation('rpc', 'reschedule_booking', {
        p_booking_id: bookingId,
        p_lodge_id: state.lodgeId,
        p_new_room_id: newRoomId,
        p_new_check_in: newCheckIn,
        p_new_check_out: newCheckOut,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
        p_overpayment_action: overpaymentAction,
        p_allow_total_override: allowTotalOverride,
        p_override_total: overrideTotal,
        p_expected_updated_at: expectedUpdatedAt,
        p_actor_id: state.currentUser?.id || null
      }, null, { _queue_id: `reschedule-${bookingId}` });

      cached[idx] = {
        ...b,
        room_id: newRoomId,
        check_in: newCheckIn,
        check_out: newCheckOut,
        total_amount: newTotal,
        amount_paid: finalPaid,
        payment_status: paymentStatus,
        _pending_sync: true,
        updated_at: new Date().toISOString()
      };
      writeCache('bookings', cached);

      logActivity(
        'booking_rescheduled',
        `Rescheduled (offline) · Room ${room.room_number || ''} · ${newCheckIn} → ${newCheckOut}`
      );
      createBackup();

      return {
        success: true,
        new_total: newTotal,
        amount_paid: finalPaid,
        payment_status: paymentStatus,
        overpayment_transferred: overpayment,
        additional_due: Math.max(0, newOwed - finalPaid),
        offline: true,
        queued: true
      };
    }
  } catch (error) {
    recordCriticalError('booking.reschedule', error, {
      booking_id: bookingId,
      new_room_id: newRoomId,
      new_check_in: newCheckIn,
      new_check_out: newCheckOut
    });
    throw error;
  }
}

async function getNextBookingInvoiceNumber() {
  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('get_next_invoice_number', { p_lodge_id: state.lodgeId });
    if (error) {
      if (!isMissingInvoiceNumberRpcError(error)) {
        throw new Error('Failed to generate invoice number: ' + error.message);
      }
      console.warn('[Invoices] get_next_invoice_number RPC unavailable, falling back to lookup:', error.message);
      return await getNextInvoiceNumberByLookup(state.supabase);
    }
    return data;
  }
  // Offline: return null — server generates the real invoice number when the queued RPC fires.
  // Previously generated a provisional INV-YYYY-XXXX locally, but two offline devices could
  // produce the same number, causing a UNIQUE constraint failure on sync.
  return null;
}

export async function getBookingInvoices() {
  const bookings = await getAllBookings();
  let authoritative = state.isOnline && bookings?._complete === true;
  let invoiceRows = [];
  let groupRows = readCache('booking-invoice-groups') || [];
  let groupLineRows = readCache('booking-invoice-group-lines') || [];

  if (state.isOnline) {
    const loadRows = async (table, select, orderColumn, configure = null) => {
      const rows = [];
      for (let from = 0; from < 100000; from += 500) {
        let query = state.supabase.from(table).select(select).eq('lodge_id', state.lodgeId);
        if (configure) query = configure(query);
        const { data, error } = await query.order(orderColumn, { ascending: false }).range(from, from + 499);
        if (error) return { data: null, error };
        const page = data || [];
        rows.push(...page);
        if (page.length < 500) break;
      }
      return { data: rows, error: null };
    };

    let invoiceResult = await loadRows(
      'invoices',
      'id, booking_id, lodge_id, invoice_number, issued_at, due_date, notes, created_at',
      'issued_at',
      (query) => query.not('booking_id', 'is', null)
    );
    if (invoiceResult.error) {
      invoiceResult = await loadRows(
        'invoices',
        'id, booking_id, lodge_id, invoice_number, issued_at',
        'issued_at',
        (query) => query.not('booking_id', 'is', null)
      );
    }

    if (invoiceResult.error) {
      console.warn('getBookingInvoices using booking-only fallback:', invoiceResult.error.message);
      authoritative = false;
      invoiceRows = [];
    } else {
      invoiceRows = invoiceResult.data || [];
    }

    const [groupsResult, linesResult] = await Promise.all([
      loadRows('booking_invoice_groups', 'id, lodge_id, group_key, customer_id, invoice_number, issued_at, due_date, notes, created_at, updated_at', 'issued_at'),
      loadRows('booking_invoice_group_lines', 'group_id, booking_id, lodge_id, line_order, created_at', 'line_order')
    ]);
    if (groupsResult.error || linesResult.error) authoritative = false;
    if (!groupsResult.error && Array.isArray(groupsResult.data)) {
      groupRows = groupsResult.data;
      writeCache('booking-invoice-groups', groupRows, { source: 'remote' });
    }
    if (!linesResult.error && Array.isArray(linesResult.data)) {
      groupLineRows = linesResult.data;
      writeCache('booking-invoice-group-lines', groupLineRows, { source: 'remote' });
    }
  }

  const invoiceByBookingId = new Map(
    invoiceRows.
    filter((invoice) => invoice?.booking_id).
    map((invoice) => [invoice.booking_id, invoice])
  );

  const rows = bookings.
  map((booking) => {
    const invoice = invoiceByBookingId.get(booking.id);
    const invoice_number = invoice?.invoice_number || booking.invoice_number || booking._local_invoice_number || null;
    if (!invoice_number) return null;

    const total_amount = Number(booking.total_amount || 0);
    const amount_paid = Number(booking.amount_paid || 0);
    const charges_total = Number(booking.charges_total || 0); // || 0 guards against null on older rows
    const nights = Math.max(
      0,
      Math.ceil((new Date(booking.check_out) - new Date(booking.check_in)) / (1000 * 60 * 60 * 24))
    );

    return {
      ...booking,
      booking_id: booking.id,
      invoice_id: invoice?.id || null,
      invoice_number,
      issued_at: invoice?.issued_at || booking.created_at || null,
      due_date: invoice?.due_date || booking.check_in || null,
      invoice_notes: invoice?.notes || '',
      total_amount,
      amount_paid,
      charges_total,
      balance_due: Math.max(0, total_amount + charges_total - amount_paid),
      nights,
      ...(booking.is_exclusive_event ? {
        _event_group: true,
        room_count: parseEventRoomCount(booking.notes) || 1,
        room_type: 'Full Lodge',
        room_number: 'Full Lodge',
        display_notes: stripEventMetadata(booking.notes)
      } : {})
    };
  }).
  filter(Boolean);

  const regularRows = rows.filter((row) => !row.is_exclusive_event);
  const eventRows = rows.filter((row) => row.is_exclusive_event);
  const groupById = new Map((groupRows || []).map((group) => [group.id, group]));
  const groupIdByBookingId = new Map(
    (groupLineRows || []).
    filter((line) => line?.booking_id && line?.group_id).
    map((line) => [line.booking_id, line.group_id])
  );
  const accommodationGroups = new Map();
  const ungroupedRegularRows = [];
  for (const row of regularRows) {
    const groupId = groupIdByBookingId.get(row.booking_id) || (parseAccommodationGroupId(row.notes) ? `local-${parseAccommodationGroupId(row.notes)}` : null);
    const group = groupById.get(groupId) || groupRows.find((entry) => entry?.group_key && entry.group_key === parseAccommodationGroupId(row.notes));
    if (!group) {
      ungroupedRegularRows.push(row);
      continue;
    }
    if (!accommodationGroups.has(group.id)) {
      accommodationGroups.set(group.id, {
        ...row,
        _accommodation_group: true,
        accommodation_group_id: group.id,
        accommodation_group_key: group.group_key,
        booking_id: row.booking_id,
        invoice_id: group.id,
        invoice_number: group.invoice_number,
        issued_at: group.issued_at || row.issued_at,
        due_date: group.due_date || row.due_date,
        invoice_notes: group.notes || row.invoice_notes || '',
        room_count: 0,
        room_number: 'Multiple Rooms',
        room_type: 'Accommodation Group',
        display_notes: stripAccommodationGroupMetadata(row.notes),
        total_amount: 0,
        amount_paid: 0,
        charges_total: 0,
        balance_due: 0,
        _booking_ids: [],
        _room_lines: []
      });
    }
    const grouped = accommodationGroups.get(group.id);
    grouped._booking_ids.push(row.booking_id);
    grouped._room_lines.push({
      booking_id: row.booking_id,
      room_id: row.room_id,
      room_number: row.room_number,
      room_type: row.room_type,
      check_in: row.check_in,
      check_out: row.check_out,
      nights: row.nights,
      adults: row.adults,
      children: row.children,
      total_amount: row.total_amount,
      amount_paid: row.amount_paid,
      balance_due: row.balance_due,
      status: row.status,
      payment_status: row.payment_status
    });
    grouped.room_count = grouped._room_lines.length;
    grouped.total_amount += Number(row.total_amount || 0);
    grouped.amount_paid += Number(row.amount_paid || 0);
    grouped.charges_total += Number(row.charges_total || 0);
    grouped.balance_due = Math.max(0, grouped.total_amount + grouped.charges_total - grouped.amount_paid);
    grouped.payment_status = calculateBookingPaymentStatus(grouped.total_amount + grouped.charges_total, grouped.amount_paid);
  }

  const eventGroups = new Map();
  for (const row of eventRows) {
    const groupId = String(row.notes || '').match(/\[GROUP:([^\]]+)\]/)?.[1] || row.booking_id;
    if (!eventGroups.has(groupId)) {
      eventGroups.set(groupId, {
        ...row,
        _event_group: true,
        event_group_id: groupId,
        room_count: parseEventRoomCount(row.notes) || 0,
        room_type: 'Full Lodge',
        room_number: 'Full Lodge',
        display_notes: stripEventMetadata(row.notes),
        _event_booking_ids: []
      });
    }
    const grouped = eventGroups.get(groupId);
    grouped._event_booking_ids.push(row.booking_id);
    grouped.room_count = Math.max(Number(grouped.room_count || 0), parseEventRoomCount(row.notes) || 0, grouped._event_booking_ids.length);
    if (row.booking_id !== grouped.booking_id) {
      grouped.total_amount += Number(row.total_amount || 0);
      grouped.amount_paid += Number(row.amount_paid || 0);
      grouped.charges_total += Number(row.charges_total || 0);
      grouped.balance_due = Math.max(0, grouped.total_amount + grouped.charges_total - grouped.amount_paid);
    }
  }

  return withReadMetadata(
    [...ungroupedRegularRows, ...accommodationGroups.values(), ...eventGroups.values()].
    sort((a, b) => {
    const left = String(a.issued_at || a.created_at || a.check_in || '');
    const right = String(b.issued_at || b.created_at || b.check_in || '');
    return right.localeCompare(left);
    }),
    authoritative ? 'server' : 'cache',
    authoritative
  );
}

async function getNextQuotationNumber() {
  const year = new Date().getFullYear();
  const prefix = `Q-${year}-`;
  let nums = [];
  if (state.isOnline) {
    const { data } = await state.supabase.
    from('quotations').
    select('quotation_number').
    eq('lodge_id', state.lodgeId).
    like('quotation_number', `${prefix}%`);
    nums = (data || []).
    map((r) => parseInt((r.quotation_number || '').replace(prefix, ''), 10)).
    filter((n) => !isNaN(n));
  } else {
    nums = readCache('quotations').
    filter((q) => (q.quotation_number || '').startsWith(prefix)).
    map((q) => parseInt(q.quotation_number.replace(prefix, ''), 10)).
    filter((n) => !isNaN(n));
  }
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

function getNextQuotationNumberAfter(currentNumber) {
  const match = String(currentNumber || '').match(/^(Q-\d{4}-)(\d+)$/);
  if (!match) return getNextQuotationNumber();
  const [, prefix, seq] = match;
  return `${prefix}${String(Number(seq) + 1).padStart(seq.length, '0')}`;
}

function isQuotationNumberConflict(message = '') {
  return /quotations_lodge_id_quotation_number_key|duplicate key value/i.test(String(message));
}

function isExclusiveEventQuotation(quotation = {}) {
  return quotation?.quotation_type === 'exclusive_event';
}

function normalizeQuotationAccommodationLines(value = []) {
  const rawLines = Array.isArray(value) ? value : [];
  return rawLines.
  map((line) => ({
    room_id: String(line?.room_id || '').trim(),
    room_name: String(line?.room_name || '').trim(),
    adults: Math.max(1, Number(line?.adults || 1)),
    children: Math.max(0, Number(line?.children || 0)),
    amount: Math.max(0, Number(line?.amount || line?.total_amount || 0))
  })).
  filter((line) => line.room_id);
}

function getQuotationNights(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const start = new Date(checkIn).getTime();
  const end = new Date(checkOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
}

function normalizeQuotationCurrency(value, fallback = 'BWP') {
  const candidate = String(value || '').trim();
  if (candidate && candidate.length <= 8 && !/\d/.test(candidate)) return candidate;
  const safeFallback = String(fallback || 'BWP').trim();
  return safeFallback && safeFallback.length <= 8 && !/\d/.test(safeFallback) ? safeFallback : 'BWP';
}

function buildQuotationEventNotes(quotation, roomCount) {
  const groupId = `evt-quotation-${quotation.id}`;
  const notes = [
  `[GROUP:${groupId}][ROOMS:${roomCount}]`,
  `Event: ${quotation.event_name || quotation.customer_name || 'Exclusive event'}`,
  String(quotation.notes || '').trim()].
  filter(Boolean);
  return notes.join('\n');
}

function buildQuotationRecord(data, overrides = {}) {
  const customer = readCache('customers').find((c) => c.id === data.customer_id);
  const quotationType = data.quotation_type === 'exclusive_event' ? 'exclusive_event' : 'room';
  const isEvent = quotationType === 'exclusive_event';
  const room = !isEvent && data.room_id ? readCache('rooms').find((r) => r.id === data.room_id) : null;

  const eventDailyRate = isEvent ? Number(data.event_daily_rate || 0) : null;
  const eventTotal = isEvent ? eventDailyRate * getQuotationNights(data.check_in, data.check_out) : null;
  const accommodationLines = isEvent ? [] : normalizeQuotationAccommodationLines(data.accommodation_lines);
  const linesTotal = accommodationLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const subtotal = isEvent ? eventTotal : (linesTotal > 0 ? linesTotal : Number(data.subtotal ?? 0));
  const tax_amount = isEvent ? 0 : Number(calcTax(subtotal, data.tax_rate ?? 0));
  const total_amount = subtotal + tax_amount;

  return {
    id: overrides.id || randomUUID(),
    quotation_number: overrides.quotation_number,
    lodge_id: state.lodgeId,
    customer_id: data.customer_id,
    customer_name: data.customer_name || customer?.name || '',
    customer_phone: data.customer_phone || customer?.phone || '',
    quotation_type: quotationType,
    event_name: isEvent ? String(data.event_name || '').trim() : null,
    event_daily_rate: eventDailyRate,
    room_id: isEvent ? null : data.room_id || null,
    room_name: isEvent ? 'Full Lodge' : data.room_name || (room ? `Room ${room.room_number}` : ''),
    accommodation_lines: isEvent ? null : accommodationLines,
    check_in: data.check_in || null,
    check_out: data.check_out || null,
    adults: isEvent ? 1 : Number(data.adults) || 1,
    children: isEvent ? 0 : Number(data.children) || 0,
    subtotal,
    tax_amount,
    total_amount,
    currency: normalizeQuotationCurrency(data.currency),
    notes: data.notes || '',
    status: 'draft',
    valid_until: data.valid_until || null,
    parent_quotation_id: data.parent_quotation_id || null,
    created_by: state.currentUser?.id || null,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString()
  };
}

function normalizeQuotationForDisplay(q, { customer = null, room = null, convertedBookingId = null, todayStr = null } = {}) {
  if (!q || typeof q !== 'object') return q;
  const quotationType = q.quotation_type === 'exclusive_event' ? 'exclusive_event' : 'room';
  const isEvent = quotationType === 'exclusive_event';
  const subtotal = Number(q.subtotal ?? 0);
  const taxAmount = Number(q.tax_amount ?? calcTax(subtotal, q.tax_rate ?? 0));
  const totalAmount = Number(q.total_amount ?? subtotal + taxAmount);
  const roomNumber = room?.room_number || q.room_number || '';
  const normalizedConvertedBookingId = q.converted_booking_id || convertedBookingId || null;
  const accommodationLines = isEvent ? [] : normalizeQuotationAccommodationLines(q.accommodation_lines);
  const baseStatus = normalizedConvertedBookingId ? 'converted' : q.status || 'draft';
  const status = todayStr && q.valid_until && q.valid_until < todayStr && ['draft', 'sent', 'accepted'].includes(baseStatus) ?
  'expired' :
  baseStatus;

  return {
    ...q,
    converted_booking_id: normalizedConvertedBookingId,
    status,
    quotation_number: q.quotation_number || 'Unnumbered',
    customer_name: q.customer_name || customer?.name || 'Unknown guest',
    customer_phone: q.customer_phone || customer?.phone || '',
    customer_email: q.customer_email || q.customers?.email || customer?.email || '',
    quotation_type: quotationType,
    event_name: isEvent ? q.event_name || q.customer_name || 'Exclusive event' : null,
    event_daily_rate: isEvent ? Number(q.event_daily_rate || 0) : null,
    room_name: isEvent ? 'Full Lodge' : q.room_name || (roomNumber ? `Room ${roomNumber}` : ''),
    accommodation_lines: isEvent ? [] : accommodationLines,
    check_in: q.check_in || null,
    check_out: q.check_out || null,
    adults: Number(q.adults) || 1,
    children: Number(q.children) || 0,
    subtotal,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    currency: normalizeQuotationCurrency(q.currency),
    notes: q.notes || '',
    valid_until: q.valid_until || null,
    created_at: q.created_at || q.updated_at || new Date(0).toISOString(),
    updated_at: q.updated_at || q.created_at || new Date(0).toISOString()
  };
}

export async function getAllQuotations() {
  const cachedQuotations = readCache('quotations');
  if (state.isOnline) {
    let linkedBookings = [];
    const { data, error } = await state.supabase.
    from('quotations').
    select('*').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false });
    if (error) {
      if (cachedQuotations.length > 0) {
        console.warn('getAllQuotations falling back to cache:', error.message);
        return cachedQuotations;
      }
      throw new Error(error.message);
    }

    const customers = readCache('customers');
    const rooms = readCache('rooms');
    const liveRows = (data || []).length === 0 && cachedQuotations.length > 0 ?
    cachedQuotations :
    data || [];
    try {
      const bookingsResult = await state.supabase.
      from('bookings').
      select('id, quotation_id').
      eq('lodge_id', state.lodgeId).
      not('quotation_id', 'is', null);
      linkedBookings = bookingsResult?.data || [];
    } catch {
      linkedBookings = [];
    }
    const convertedIds = new Map(
      (linkedBookings || []).filter((booking) => booking?.quotation_id).map((booking) => [booking.quotation_id, booking.id])
    );
    const todayStr = new Date().toISOString().split('T')[0];
    const mapped = liveRows.map((q) => {
      const customer = customers.find((c) => c.id === q.customer_id);
      const room = rooms.find((r) => r.id === q.room_id);
      const convertedBookingId = q.converted_booking_id || convertedIds.get(q.id) || null;
      return normalizeQuotationForDisplay(q, { customer, room, convertedBookingId, todayStr });
    });
    writeCache('quotations', mapped);
    return mapped;
  }
  const quotations = cachedQuotations;
  const customers = readCache('customers');
  const rooms = readCache('rooms');
  const bookings = readCache('bookings');
  const convertedIds = new Map(
    (bookings || []).filter((booking) => booking?.quotation_id).map((booking) => [booking.quotation_id, booking.id])
  );
  const todayStr = new Date().toISOString().split('T')[0];
  return quotations.
  map((q) => {
    const customer = customers.find((c) => c.id === q.customer_id);
    const room = rooms.find((r) => r.id === q.room_id);
    // Auto-expire offline (UI-only; DB will be corrected when back online)
    const convertedBookingId = q.converted_booking_id || convertedIds.get(q.id) || null;
    const baseStatus = convertedBookingId ? 'converted' : q.status;
    const status = q.valid_until && q.valid_until < todayStr && ['draft', 'sent', 'accepted'].includes(baseStatus) ?
    'expired' :
    baseStatus;
    return normalizeQuotationForDisplay(q, { customer, room, convertedBookingId, todayStr, status });
  }).
  sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function calcTax(subtotal, rate = 0) {
  return Math.round(Number(subtotal || 0) * Number(rate || 0)) / 100;
}

export async function createQuotation(data) {
  if (state.isOnline) {
    let quotation_number = await getNextQuotationNumber();
    let lastError = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const record = buildQuotationRecord(data, {
        id: randomUUID(),
        quotation_number
      });
      const { data: result, error } = await state.supabase.rpc('create_quotation', { payload: record });
      const failureMessage = error?.message || result?.error || '';

      if (!error && result?.success) {
        writeCache('quotations', [record, ...readCache('quotations').filter((q) => q.id !== record.id)]);
        await refreshCache('quotations');
        logActivity('quotation_created', `Quotation ${quotation_number} created for ${record.customer_name}`);
        return { id: record.id, quotation_number };
      }

      lastError = new Error(failureMessage || 'Could not create quotation');
      if (!isQuotationNumberConflict(failureMessage) || attempt === 4) {
        throw lastError;
      }

      quotation_number = getNextQuotationNumberAfter(quotation_number);
    }

    throw lastError || new Error('Could not create quotation');
  } else {
    const quotation_number = await getNextQuotationNumber();
    const record = buildQuotationRecord(data, { quotation_number });
    const offlineRecord = {
      ...record,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null
    };
    const cached = readCache('quotations');
    cached.unshift(offlineRecord);
    writeCache('quotations', cached);
    queueOperation('rpc', 'create_quotation', { payload: record }, null, {
      _queue_id: `quotation-${record.id}`
    });
    logActivity('quotation_created', `Quotation ${quotation_number} created for ${record.customer_name}`);
    return { id: record.id, quotation_number };
  }
}

export async function updateQuotation(id, data) {
  // Determine if financial fields are locked (sent/accepted/converted)
  const LOCKED_STATUSES = ['sent', 'accepted', 'converted'];
  const cachedQuotations = readCache('quotations');
  const current = cachedQuotations.find((q) => q.id === id);

  // When online, verify lock status from server — cache may be stale
  let isLocked = current && LOCKED_STATUSES.includes(current.status);
  if (state.isOnline) {
    const { data: live } = await state.supabase.
    from('quotations').select('status').eq('id', id).eq('lodge_id', state.lodgeId).single();
    if (live) isLocked = LOCKED_STATUSES.includes(live.status);
  }

  const quotationType = data.quotation_type === 'exclusive_event' ? 'exclusive_event' : 'room';
  const isEvent = quotationType === 'exclusive_event';
  const eventDailyRate = isEvent ? Number(data.event_daily_rate || 0) : null;
  const accommodationLines = isEvent ? [] : normalizeQuotationAccommodationLines(data.accommodation_lines);
  const linesTotal = accommodationLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const subtotal = isEvent ?
  eventDailyRate * getQuotationNights(data.check_in, data.check_out) :
  (linesTotal > 0 ? linesTotal : Number(data.subtotal ?? 0));
  const tax_amount = isEvent ? 0 : Number(calcTax(subtotal, data.tax_rate ?? 0));
  const total_amount = subtotal + tax_amount;

  // Full update object
  const update = {
    customer_name: data.customer_name,
    customer_phone: data.customer_phone || '',
    currency: data.currency || 'BWP',
    notes: data.notes || '',
    status: data.status,
    converted_booking_id: data.converted_booking_id || null,
    valid_until: data.valid_until || null,
    updated_at: new Date().toISOString()
  };

  // Financial + date fields — only allowed when not locked
  if (!isLocked) {
    Object.assign(update, {
      customer_id: data.customer_id,
      quotation_type: quotationType,
      event_name: isEvent ? String(data.event_name || '').trim() : null,
      event_daily_rate: eventDailyRate,
      room_id: isEvent ? null : data.room_id || null,
      room_name: isEvent ? 'Full Lodge' : data.room_name || '',
      accommodation_lines: isEvent ? null : accommodationLines,
      check_in: data.check_in || null,
      check_out: data.check_out || null,
      adults: isEvent ? 1 : Number(data.adults) || 1,
      children: isEvent ? 0 : Number(data.children) || 0,
      subtotal,
      tax_amount,
      total_amount
    });
  }

  const expectedUpdatedAt = current?.updated_at || null;

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_quotation', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: expectedUpdatedAt
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update quotation');
    const cached = readCache('quotations');
    const idx = cached.findIndex((q) => q.id === id);
    if (idx >= 0) {
      cached[idx] = { ...cached[idx], ...update };
      writeCache('quotations', cached);
    }
    await refreshCache('quotations');
  } else {
    const cached = readCache('quotations');
    const idx = cached.findIndex((q) => q.id === id);
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('quotations', cached);
    const dependsOn = current?._pending_sync ? `quotation-${id}` : null;
    queueOperation('rpc', 'update_quotation', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update,
      p_expected_updated_at: expectedUpdatedAt
    }, null, dependsOn ? { _depends_on: dependsOn } : {});
  }

  logActivity('quotation_updated', `Quotation ${id} updated — status: ${data.status}`);
}

export async function markQuotationSent(id) {
  const update = { status: 'sent', updated_at: new Date().toISOString() };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('mark_quotation_sent', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not mark quotation as sent');
  } else {
    const cached = readCache('quotations');
    const idx = cached.findIndex((q) => q.id === id);
    if (idx >= 0 && cached[idx].status === 'draft') {
      cached[idx] = { ...cached[idx], ...update };
      writeCache('quotations', cached);
      const dependsOn = cached[idx]?._pending_sync ? `quotation-${id}` : null;
      queueOperation('rpc', 'mark_quotation_sent', {
        p_id: id,
        p_lodge_id: state.lodgeId
      }, null, {
        _queue_id: `quotation-sent-${id}`,
        ...(dependsOn ? { _depends_on: dependsOn } : {})
      });
    }
  }
}

export async function duplicateQuotation(id) {
  const source = state.isOnline ?
  (await state.supabase.from('quotations').select('*').eq('id', id).eq('lodge_id', state.lodgeId).single()).data :
  readCache('quotations').find((q) => q.id === id);
  if (!source) throw new Error('Quotation not found');

  return createQuotation({
    customer_id: source.customer_id,
    customer_name: source.customer_name,
    customer_phone: source.customer_phone,
    quotation_type: source.quotation_type || 'room',
    event_name: source.event_name,
    event_daily_rate: source.event_daily_rate,
    room_id: source.room_id,
    room_name: source.room_name,
    accommodation_lines: source.accommodation_lines || [],
    check_in: source.check_in,
    check_out: source.check_out,
    adults: source.adults,
    children: source.children,
    subtotal: source.subtotal || source.total_amount,
    tax_amount: source.tax_amount || 0,
    currency: source.currency,
    notes: source.notes,
    valid_until: source.valid_until,
    parent_quotation_id: source.parent_quotation_id || source.id // chain to root
  });
}

export async function getQuotationById(id) {
  if (!id) return null;
  if (state.isOnline) {
    const { data, error } = await state.supabase.
    from('quotations').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('id', id).
    single();
    if (error) throw new Error(error.message);
    return data || null;
  }
  return readCache('quotations').find((quotation) => quotation.id === id) || null;
}

export async function convertQuotationToBooking(quotationId, depositAmount = 0, paymentMethod = 'cash') {
  const deposit = Number(depositAmount) || 0;
  const method = paymentMethod || 'cash';
  const convertMultiRoomQuotation = async (quotation) => {
    const lines = normalizeQuotationAccommodationLines(quotation.accommodation_lines);
    if (isExclusiveEventQuotation(quotation) || lines.length < 2) return null;
    if (!quotation.customer_id) throw new Error('Customer is required before converting a multi-room quotation.');
    if (!['sent', 'accepted'].includes(quotation.status)) {
      throw new Error('Quotation must be sent or accepted before conversion.');
    }
    const result = await createMultiRoomBooking({
      customer_id: quotation.customer_id,
      check_in: quotation.check_in,
      check_out: quotation.check_out,
      rooms: lines.map((line) => ({
        room_id: line.room_id,
        adults: line.adults,
        children: line.children
      })),
      deposit_amount: deposit,
      payment_method: method,
      notes: quotation.notes || '',
      created_by: state.currentUser?.id || null
    });
    const convertedBookingId = result.booking_ids?.[0] || null;
    await updateQuotation(quotation.id, {
      ...quotation,
      status: 'converted',
      converted_booking_id: convertedBookingId
    });
    return {
      booking_id: convertedBookingId,
      booking_ids: result.booking_ids || [],
      group_id: result.group_id,
      invoice_number: result.group_invoice_number,
      pendingSync: result.bookings?.some((entry) => entry?._pending_sync) || !state.isOnline,
      group_invoice: true
    };
  };

  if (!state.isOnline) {
    const quotation = readCache('quotations').find((q) => q.id === quotationId);
    if (!quotation) throw new Error('Quotation not found');
    if (quotation.converted_booking_id || quotation.status === 'converted') {
      throw new Error('This quotation has already been converted to a booking.');
    }
    if (!['sent', 'accepted'].includes(quotation.status)) {
      throw new Error('Quotation must be sent or accepted before conversion.');
    }
    const multiRoomResult = await convertMultiRoomQuotation(quotation);
    if (multiRoomResult) return multiRoomResult;
    const isEvent = isExclusiveEventQuotation(quotation);
    if (!isEvent && quotation.room_id && quotation.check_in && quotation.check_out) {
      await checkRoomConflict(quotation.room_id, quotation.check_in, quotation.check_out);
    }

    const localBookingId = randomUUID();
    const now = new Date().toISOString();
    const total = Number(quotation.total_amount || 0);
    const optimisticPayment = buildOfflineBookingFinancialState(total, deposit);
    const cachedRooms = readCache('rooms');
    const eventRooms = isEvent ? cachedRooms.filter((entry) => entry.status !== 'maintenance') : [];
    const room = isEvent ?
    [...eventRooms].sort((left, right) =>
    String(left.room_number || '').localeCompare(String(right.room_number || ''), undefined, { numeric: true, sensitivity: 'base' })
    )[0] :
    quotation.room_id ? cachedRooms.find((entry) => entry.id === quotation.room_id) : null;
    if (isEvent) {
      if (!quotation.check_in || !quotation.check_out || !quotation.event_name || Number(quotation.event_daily_rate || 0) <= 0) {
        throw new Error('Event / lodge quotation details are incomplete.');
      }
      if (!room || eventRooms.length === 0) {
        throw new Error('No rooms are available for an exclusive event booking.');
      }
      const conflict = readCache('bookings').find((booking) =>
      booking.status !== 'cancelled' &&
      booking.check_in < quotation.check_out &&
      booking.check_out > quotation.check_in
      );
      if (conflict) {
        throw new Error('Cannot create exclusive event — the lodge already has bookings during these dates.');
      }
    }
    const localBooking = {
      id: localBookingId,
      lodge_id: state.lodgeId,
      customer_id: quotation.customer_id || null,
      customer_name: quotation.customer_name || '',
      customer_phone: quotation.customer_phone || '',
      room_id: isEvent ? room?.id || null : quotation.room_id || null,
      room_number: isEvent ? 'Full Lodge' : room?.room_number || quotation.room_name || '',
      room_name: isEvent ? 'Full Lodge' : quotation.room_name || (room?.room_number ? `Room ${room.room_number}` : ''),
      check_in: quotation.check_in || null,
      check_out: quotation.check_out || null,
      adults: isEvent ? 1 : Number(quotation.adults) || 1,
      children: isEvent ? 0 : Number(quotation.children) || 0,
      total_amount: total,
      amount_paid: optimisticPayment.amount_paid,
      deposit_amount: deposit,
      payment_status: optimisticPayment.payment_status,
      payment_method: deposit > 0 ? method : null,
      status: 'confirmed',
      invoice_number: null,
      quotation_id: quotationId,
      created_by: state.currentUser?.id || null,
      notes: isEvent ? buildQuotationEventNotes(quotation, eventRooms.length) : quotation.notes || '',
      is_exclusive_event: isEvent,
      event_daily_rate: isEvent ? Number(quotation.event_daily_rate || 0) : null,
      ...(isEvent ? {
        _event_group: true,
        room_count: eventRooms.length,
        room_type: 'Full Lodge'
      } : {}),
      _local_invoice_number: buildLocalPendingInvoiceNumber(localBookingId),
      _pending_sync: true,
      _pending_payment: deposit > 0,
      _financial_estimate: deposit > 0,
      _sync_created_offline: true,
      _sync_state: 'pending',
      _sync_error: null,
      _sync_source: 'quotation_conversion',
      created_at: now,
      updated_at: now
    };

    writeCache('bookings', [
    localBooking,
    ...readCache('bookings').filter((booking) => booking.id !== localBookingId)]
    );
    patchCachedQuotationSyncState(quotationId, {
      status: 'converted',
      converted_booking_id: localBookingId,
      _pending_sync: true,
      _pending_conversion: true,
      _local_converted_booking_id: localBookingId,
      _sync_state: 'pending',
      _sync_error: null,
      updated_at: now
    });

    queueOperation('rpc', 'convert_quotation_to_booking', {
      p_quotation_id: quotationId,
      p_lodge_id: state.lodgeId,
      p_deposit_amount: deposit,
      p_payment_method: method,
      p_created_by: state.currentUser?.id || null
    }, null, {
      _queue_id: `quotation-convert-${quotationId}`,
      _local_booking_id: localBookingId,
      _previous_status: quotation.status || 'accepted',
      ...(quotation?._pending_sync ? { _depends_on: `quotation-${quotationId}` } : {})
    });

    logActivity('quotation_converted', `(Offline) Quotation ${quotationId} queued for conversion to booking ${localBookingId}`);
    return {
      booking_id: localBookingId,
      invoice_number: localBooking._local_invoice_number,
      pendingSync: true
    };
  }

  const { data: quotation } = await state.supabase.
  from('quotations').
  select('status').
  eq('id', quotationId).
  eq('lodge_id', state.lodgeId).
  single();

  if (quotation?.status === 'converted') {
    throw new Error('This quotation has already been converted to a booking.');
  }

  const fullQuotation = await getQuotationById(quotationId);
  const multiRoomResult = await convertMultiRoomQuotation(fullQuotation);
  if (multiRoomResult) return multiRoomResult;

  const { data: result, error } = await state.supabase.rpc('convert_quotation_to_booking', {
    p_quotation_id: quotationId,
    p_lodge_id: state.lodgeId,
    p_deposit_amount: deposit,
    p_payment_method: method,
    p_created_by: state.currentUser?.id || null
  });

  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Conversion failed');

  await refreshCache('bookings');
  await refreshCache('quotations');

  const bookingId = result.booking_id || result.id;
  logActivity('quotation_converted', `Quotation ${quotationId} converted to booking ${bookingId}`);
  return {
    booking_id: bookingId,
    invoice_number: result.invoice_number,
    ...(result.depositWarning ? { depositWarning: result.depositWarning } : {})
  };
}
