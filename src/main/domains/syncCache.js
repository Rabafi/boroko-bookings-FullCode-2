// @ts-check
import { readCache, writeCache } from './cacheStore.js';
import {
  readFailedSyncQueue,
  readSyncQueue,
  writeFailedSyncQueue,
  writeSyncQueue
} from './syncStore.js';
import { getQueuedPosOrderId, getSyncItemBookingId, isInventoryItemQueueItem, getQueuedInventoryItemId } from './syncShared.js';

/** @typedef {{findIndex(predicate: (row: unknown) => unknown): number, map(callback: (row: unknown) => unknown): unknown[], [index: number]: unknown, [Symbol.iterator](): Iterator<unknown>}} CacheSequenceReadView */

/** @param {unknown} item @param {string} prefix */
function getSyncItemEntityId(item, prefix) {
  const itemFields = /** @type {Record<string, unknown> | null | undefined} */ (item);
  const data = /** @type {Record<string, unknown> | null | undefined} */ (itemFields?.data);
  const payload = /** @type {Record<string, unknown> | null | undefined} */ (data?.payload);
  const directId = data?.p_id || payload?.id || payload?.user_id || null;
  if (directId) return directId;
  const queueId = String(itemFields?._queue_id || '').trim();
  if (queueId.startsWith(`${prefix}-`)) return queueId.slice(prefix.length + 1).trim() || null;
  return null;
}

/** @param {unknown} item */
function getSyncItemCustomerId(item) {
  return getSyncItemEntityId(item, 'customer');
}

/** @param {unknown} item */
function getSyncItemRoomId(item) {
  return getSyncItemEntityId(item, 'room');
}

/** @param {unknown} item */
function getSyncItemUserId(item) {
  return getSyncItemEntityId(item, 'user');
}

/** @param {unknown} item */
export function getSyncItemQuotationId(item) {
  const itemFields = /** @type {Record<string, unknown> | null | undefined} */ (item);
  const data = /** @type {Record<string, unknown> | null | undefined} */ (itemFields?.data);
  const quotationId = String(data?.p_quotation_id || '').trim();
  if (quotationId) return quotationId;
  return getSyncItemEntityId(item, 'quotation');
}

/** @param {unknown} orderId @param {unknown} [patch] */
export function patchCachedPosOrderSyncState(orderId, patch = {}) {
  if (!orderId) return false;
  const cachedOrders = /** @type {CacheSequenceReadView} */ (readCache('pos-orders'));
  const index = cachedOrders.findIndex((row) => /** @type {Record<string, unknown> | null | undefined} */ (row)?.id === orderId);
  if (index < 0) {
    console.warn('POS sync patch skipped: order not found in cache', orderId);
    return false;
  }

  const existing = cachedOrders[index] || {};
  const existingFields = /** @type {Record<string, unknown>} */ (existing);
  const patchFields = /** @type {Record<string, unknown>} */ (patch);
  if (existingFields._sync_state === 'synced' &&
  patchFields._sync_state !== 'failed' &&
  patchFields._pending_sync !== true &&
  !Object.prototype.hasOwnProperty.call(patchFields, 'status')) {
    return false;
  }

  const next = [...cachedOrders];
  next[index] = {
    ...existingFields,
    ...patchFields
  };
  writeCache('pos-orders', next);
  return true;
}

/** @param {unknown} bookingId @param {unknown} [patch] */
export function patchCachedBookingSyncState(bookingId, patch = {}) {
  if (!bookingId) return false;
  const cachedBookings = /** @type {CacheSequenceReadView} */ (readCache('bookings'));
  const index = cachedBookings.findIndex((row) => /** @type {Record<string, unknown> | null | undefined} */ (row)?.id === bookingId);
  if (index < 0) {
    console.warn('Booking sync patch skipped: booking not found in cache', bookingId);
    return false;
  }

  const existing = cachedBookings[index] || {};
  const existingFields = /** @type {Record<string, unknown>} */ (existing);
  const patchFields = /** @type {Record<string, unknown>} */ (patch);
  const failedSyncStates = /** @type {unknown[]} */ (['failed', 'sync_failed', 'manual_review_required']);
  if (
    existingFields._sync_state === 'synced' &&
    !failedSyncStates.includes(patchFields._sync_state) &&
    patchFields._pending_sync !== true
  ) {
    return false;
  }

  const next = [...cachedBookings];
  next[index] = {
    ...existingFields,
    ...patchFields
  };
  writeCache('bookings', next);
  return true;
}

/** @param {unknown} item @param {unknown} localBookingId @param {unknown} serverBookingId */
export function rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId) {
  if (!item || !localBookingId || !serverBookingId || localBookingId === serverBookingId) return item;
  const itemFields = /** @type {Record<string, unknown>} */ (item);
  const itemData = /** @type {Record<string, unknown>} */ (itemFields.data || {});
  const next = /** @type {Record<string, unknown> & { data: Record<string, unknown> }} */ ({
    ...itemFields,
    data: { ...itemData }
  });
  let changed = false;
  if (next.data.p_booking_id === localBookingId) {
    next.data.p_booking_id = serverBookingId;
    changed = true;
  }
  if (next.data.p_id === localBookingId) {
    next.data.p_id = serverBookingId;
    changed = true;
  }
  if (next.data.booking_id === localBookingId) {
    next.data.booking_id = serverBookingId;
    changed = true;
  }
  const payload = /** @type {Record<string, unknown> | null | undefined} */ (next.data.payload);
  if (payload?.booking_id === localBookingId) {
    next.data.payload = {
      ...payload,
      booking_id: serverBookingId
    };
    changed = true;
  }
  if (next._depends_on === `booking-${localBookingId}`) {
    next._depends_on = `booking-${serverBookingId}`;
    changed = true;
  }
  return changed ? next : item;
}

/** @param {unknown} localBookingId @param {unknown} serverBookingId */
export function replaceQueuedBookingReference(localBookingId, serverBookingId) {
  if (!localBookingId || !serverBookingId || localBookingId === serverBookingId) return false;

  const queued = /** @type {CacheSequenceReadView} */ (readSyncQueue());
  const rewrittenQueue = queued.map((item) => rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId));
  if (JSON.stringify(queued) !== JSON.stringify(rewrittenQueue)) {
    writeSyncQueue(rewrittenQueue);
  }

  const failed = /** @type {CacheSequenceReadView} */ (readFailedSyncQueue());
  const rewrittenFailed = failed.map((item) => rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId));
  if (JSON.stringify(failed) !== JSON.stringify(rewrittenFailed)) {
    writeFailedSyncQueue(rewrittenFailed);
  }

  return JSON.stringify(queued) !== JSON.stringify(rewrittenQueue) ||
  JSON.stringify(failed) !== JSON.stringify(rewrittenFailed);
}

/** @param {string} cacheName @param {unknown} entityId @param {unknown} [patch] */
function patchCachedRowSyncState(cacheName, entityId, patch = {}) {
  if (!entityId) return false;
  const cachedRows = /** @type {CacheSequenceReadView} */ (readCache(cacheName));
  const index = cachedRows.findIndex((row) => /** @type {Record<string, unknown> | null | undefined} */ (row)?.id === entityId);
  if (index < 0) {
    console.warn(`${cacheName} sync patch skipped: row not found in cache`, entityId);
    return false;
  }
  const next = [...cachedRows];
  const current = /** @type {Record<string, unknown>} */ (cachedRows[index] || {});
  next[index] = { ...current, .../** @type {Record<string, unknown>} */ (patch) };
  writeCache(cacheName, next);
  return true;
}

/** @param {unknown} customerId @param {unknown} [patch] */
function patchCachedCustomerSyncState(customerId, patch = {}) {
  return patchCachedRowSyncState('customers', customerId, patch);
}

/** @param {unknown} roomId @param {unknown} [patch] */
function patchCachedRoomSyncState(roomId, patch = {}) {
  return patchCachedRowSyncState('rooms', roomId, patch);
}

/** @param {unknown} userId @param {unknown} [patch] */
function patchCachedUserSyncState(userId, patch = {}) {
  return patchCachedRowSyncState('users', userId, patch);
}

/** @param {unknown} quotationId @param {unknown} [patch] */
export function patchCachedQuotationSyncState(quotationId, patch = {}) {
  return patchCachedRowSyncState('quotations', quotationId, patch);
}

/** @param {unknown} itemId @param {unknown} [patch] */
export function patchCachedInventoryItemSyncState(itemId, patch = {}) {
  if (!itemId) return false;
  const cachedItems = /** @type {CacheSequenceReadView} */ (readCache('inventory-items'));
  const index = cachedItems.findIndex((row) => /** @type {Record<string, unknown> | null | undefined} */ (row)?.id === itemId);
  if (index < 0) {
    console.warn('[INVENTORY SYNC] Patch skipped: item not found in cache', itemId);
    return false;
  }
  const next = [...cachedItems];
  const current = /** @type {Record<string, unknown>} */ (cachedItems[index] || {});
  next[index] = { ...current, .../** @type {Record<string, unknown>} */ (patch) };
  writeCache('inventory-items', next);
  return true;
}

/** @param {unknown} entryId @param {unknown} [patch] */
export function patchCachedDayUseSyncState(entryId, patch = {}) {
  return patchCachedRowSyncState('pool-day-use', entryId, patch);
}

/** @param {unknown} item */
export function markClearedSyncItemForManualReview(item) {
  const itemFields = /** @type {Record<string, unknown> | null | undefined} */ (item);
  const manualReviewMessage = `${itemFields?.table || 'sync item'} was cleared from failed sync without server confirmation. Review manually before trusting local data.`;
  if (isInventoryItemQueueItem(item)) {
    const itemId = getQueuedInventoryItemId(item);
    if (itemId) {
      patchCachedInventoryItemSyncState(itemId, {
        _pending_sync: true,
        _sync_state: 'manual_review_required',
        _sync_error: manualReviewMessage
      });
      return;
    }
  }
  const customerId = getSyncItemCustomerId(item);
  if (customerId && /customer/i.test(String(itemFields?.table || itemFields?._queue_id || ''))) {
    patchCachedCustomerSyncState(customerId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const roomId = getSyncItemRoomId(item);
  if (roomId && /room/i.test(String(itemFields?.table || itemFields?._queue_id || ''))) {
    patchCachedRoomSyncState(roomId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const userId = getSyncItemUserId(item);
  if (userId && /user/i.test(String(itemFields?.table || itemFields?._queue_id || ''))) {
    patchCachedUserSyncState(userId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const quotationId = getSyncItemQuotationId(item);
  if (quotationId && /quotation/i.test(String(itemFields?.table || itemFields?._queue_id || ''))) {
    patchCachedQuotationSyncState(quotationId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const bookingId = getSyncItemBookingId(item);
  if (bookingId) {
    patchCachedBookingSyncState(bookingId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const posOrderId = getQueuedPosOrderId(item);
  if (posOrderId) {
    patchCachedPosOrderSyncState(posOrderId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
  }
}
