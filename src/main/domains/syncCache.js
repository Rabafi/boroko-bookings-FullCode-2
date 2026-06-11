import { readCache, writeCache } from './cacheStore.js';
import {
  readFailedSyncQueue,
  readSyncQueue,
  writeFailedSyncQueue,
  writeSyncQueue
} from './syncStore.js';
import { getQueuedPosOrderId, getSyncItemBookingId, isInventoryItemQueueItem, getQueuedInventoryItemId } from './syncShared.js';

function getSyncItemEntityId(item, prefix) {
  const directId = item?.data?.p_id || item?.data?.payload?.id || item?.data?.payload?.user_id || null;
  if (directId) return directId;
  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith(`${prefix}-`)) return queueId.slice(prefix.length + 1).trim() || null;
  return null;
}

function getSyncItemCustomerId(item) {
  return getSyncItemEntityId(item, 'customer');
}

function getSyncItemRoomId(item) {
  return getSyncItemEntityId(item, 'room');
}

function getSyncItemUserId(item) {
  return getSyncItemEntityId(item, 'user');
}

function getSyncItemQuotationId(item) {
  const quotationId = String(item?.data?.p_quotation_id || '').trim();
  if (quotationId) return quotationId;
  return getSyncItemEntityId(item, 'quotation');
}

export function patchCachedPosOrderSyncState(orderId, patch = {}) {
  if (!orderId) return false;
  const cachedOrders = readCache('pos-orders');
  const index = cachedOrders.findIndex((row) => row?.id === orderId);
  if (index < 0) {
    console.warn('POS sync patch skipped: order not found in cache', orderId);
    return false;
  }

  const existing = cachedOrders[index] || {};
  if (existing._sync_state === 'synced' &&
  patch._sync_state !== 'failed' &&
  patch._pending_sync !== true &&
  !Object.prototype.hasOwnProperty.call(patch, 'status')) {
    return false;
  }

  const next = [...cachedOrders];
  next[index] = {
    ...existing,
    ...patch
  };
  writeCache('pos-orders', next);
  return true;
}

export function patchCachedBookingSyncState(bookingId, patch = {}) {
  if (!bookingId) return false;
  const cachedBookings = readCache('bookings');
  const index = cachedBookings.findIndex((row) => row?.id === bookingId);
  if (index < 0) {
    console.warn('Booking sync patch skipped: booking not found in cache', bookingId);
    return false;
  }

  const existing = cachedBookings[index] || {};
  if (existing._sync_state === 'synced' && patch._sync_state !== 'sync_failed') {
    return false;
  }

  const next = [...cachedBookings];
  next[index] = {
    ...existing,
    ...patch
  };
  writeCache('bookings', next);
  return true;
}

export function rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId) {
  if (!item || !localBookingId || !serverBookingId || localBookingId === serverBookingId) return item;
  const next = { ...item, data: { ...(item?.data || {}) } };
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
  if (next.data.payload?.booking_id === localBookingId) {
    next.data.payload = {
      ...next.data.payload,
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

export function replaceQueuedBookingReference(localBookingId, serverBookingId) {
  if (!localBookingId || !serverBookingId || localBookingId === serverBookingId) return false;

  const queued = readSyncQueue();
  const rewrittenQueue = queued.map((item) => rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId));
  if (JSON.stringify(queued) !== JSON.stringify(rewrittenQueue)) {
    writeSyncQueue(rewrittenQueue);
  }

  const failed = readFailedSyncQueue();
  const rewrittenFailed = failed.map((item) => rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId));
  if (JSON.stringify(failed) !== JSON.stringify(rewrittenFailed)) {
    writeFailedSyncQueue(rewrittenFailed);
  }

  return JSON.stringify(queued) !== JSON.stringify(rewrittenQueue) ||
  JSON.stringify(failed) !== JSON.stringify(rewrittenFailed);
}

function patchCachedRowSyncState(cacheName, entityId, patch = {}) {
  if (!entityId) return false;
  const cachedRows = readCache(cacheName);
  const index = cachedRows.findIndex((row) => row?.id === entityId);
  if (index < 0) {
    console.warn(`${cacheName} sync patch skipped: row not found in cache`, entityId);
    return false;
  }
  const next = [...cachedRows];
  next[index] = { ...(cachedRows[index] || {}), ...patch };
  writeCache(cacheName, next);
  return true;
}

function patchCachedCustomerSyncState(customerId, patch = {}) {
  return patchCachedRowSyncState('customers', customerId, patch);
}

function patchCachedRoomSyncState(roomId, patch = {}) {
  return patchCachedRowSyncState('rooms', roomId, patch);
}

function patchCachedUserSyncState(userId, patch = {}) {
  return patchCachedRowSyncState('users', userId, patch);
}

export function patchCachedQuotationSyncState(quotationId, patch = {}) {
  return patchCachedRowSyncState('quotations', quotationId, patch);
}

export function patchCachedInventoryItemSyncState(itemId, patch = {}) {
  if (!itemId) return false;
  const cachedItems = readCache('inventory-items');
  const index = cachedItems.findIndex((row) => row?.id === itemId);
  if (index < 0) {
    console.warn('[INVENTORY SYNC] Patch skipped: item not found in cache', itemId);
    return false;
  }
  const next = [...cachedItems];
  next[index] = { ...(cachedItems[index] || {}), ...patch };
  writeCache('inventory-items', next);
  return true;
}

export function patchCachedDayUseSyncState(entryId, patch = {}) {
  return patchCachedRowSyncState('pool-day-use', entryId, patch);
}

export function markClearedSyncItemForManualReview(item) {
  const manualReviewMessage = `${item?.table || 'sync item'} was cleared from failed sync without server confirmation. Review manually before trusting local data.`;
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
  if (customerId && /customer/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedCustomerSyncState(customerId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const roomId = getSyncItemRoomId(item);
  if (roomId && /room/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedRoomSyncState(roomId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const userId = getSyncItemUserId(item);
  if (userId && /user/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedUserSyncState(userId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    });
    return;
  }
  const quotationId = getSyncItemQuotationId(item);
  if (quotationId && /quotation/i.test(String(item?.table || item?._queue_id || ''))) {
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
