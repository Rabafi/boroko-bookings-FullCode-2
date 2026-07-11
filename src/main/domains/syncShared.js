import { randomUUID } from 'crypto';

export const DEAD_LETTER_AUTO_RETRY_AFTER_MS = 30 * 60 * 1000;

function createQueueOperationId(prefix = 'op') {
  return `${prefix}-${randomUUID()}`;
}

export function ensureQueuedItem(item = {}, fallbackType = 'op') {
  return {
    ...item,
    _queue_id: item._queue_id || createQueueOperationId(fallbackType)
  };
}

export function isPosCreateOrderQueueItem(item) {
  return item?.type === 'rpc' && (item?.table === 'create_pos_order' || item?.table === 'create_pos_order_v3');
}

export function isPosVoidQueueItem(item) {
  return item?.type === 'rpc' && (item?.table === 'approve_pos_void_with_pin' || item?.table === 'create_pos_return_v3');
}

export function isInventoryItemQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'create_inventory_item';
}

export function isInventoryAdjustmentQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'adjust_inventory_stock';
}

export function getQueuedInventoryItemId(item) {
  const payloadId = String(item?.data?.payload?.id || '').trim();
  if (payloadId) return payloadId;

  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith('inventory-item-')) {
    const parsedId = queueId.slice('inventory-item-'.length).trim();
    if (parsedId) return parsedId;
  }

  console.warn('[INVENTORY SYNC] Missing item id for queue item', {
    queueId: item?._queue_id || null,
    table: item?.table || null
  });
  return null;
}

export function getQueuedDayUseEntryId(item) {
  const payloadId = String(item?.data?.payload?.id || item?.data?.p_id || '').trim();
  if (payloadId) return payloadId;

  const queueId = String(item?._queue_id || '').trim();
  for (const prefix of ['dayuse-status-', 'dayuse-']) {
    if (queueId.startsWith(prefix)) {
      const remainder = queueId.slice(prefix.length).trim();
      const parsedId = remainder.split('-status-')[0].trim();
      if (parsedId) return parsedId;
    }
  }

  return null;
}

export function getQueuedPosOrderId(item) {
  const payloadId = String(
    item?.table === 'create_pos_return_v3'
      ? item?.data?.payload?.return_order_id
      : item?.data?.payload?.id || item?.data?.payload?.order_id || ''
  ).trim();
  if (payloadId) return payloadId;

  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith('pos-order-')) {
    const parsedId = queueId.slice('pos-order-'.length).trim();
    if (parsedId) return parsedId;
  }
  if (queueId.startsWith('pos-void-')) {
    const parsedId = queueId.slice('pos-void-'.length).trim();
    if (parsedId) return parsedId;
  }
  if (queueId.startsWith('pos-return-')) {
    const parsedId = queueId.slice('pos-return-'.length).trim();
    if (parsedId) return parsedId;
  }
  if (queueId.startsWith('pos-recipe-depletion-')) {
    const parsedId = queueId.slice('pos-recipe-depletion-'.length).trim();
    if (parsedId) return parsedId;
  }

  console.error('[POS SYNC] Missing staged order id for queue item', {
    queueId: item?._queue_id || null,
    table: item?.table || null
  });
  return null;
}

export function getSyncItemBookingId(item) {
  return item?.data?.p_booking_id ||
  item?.data?.payload?.booking_id ||
  item?.data?.payload?.id ||
  item?.data?.p_id ||
  null;
}

export function getSyncItemScope(item) {
  const bookingId = getSyncItemBookingId(item);
  if (bookingId) return `booking:${bookingId}`;
  const posOrderId = getQueuedPosOrderId(item);
  if (posOrderId) return `pos-order:${posOrderId}`;
  const dayUseEntryId = getQueuedDayUseEntryId(item);
  if (dayUseEntryId && (/pool_day_use/i.test(String(item?.table || '')) || item?._queue_id?.startsWith?.('dayuse-'))) {
    return `day-use-entry:${dayUseEntryId}`;
  }
  if (isInventoryItemQueueItem(item)) {
    const itemId = getQueuedInventoryItemId(item);
    if (itemId) return `inventory-item:${itemId}`;
  }
  if (isInventoryAdjustmentQueueItem(item)) {
    const itemId = String(item?.data?.p_item_id || '').trim();
    if (itemId) return `inventory-item:${itemId}`;
  }
  return item?.table || 'unknown';
}

export function normalizeQueuedSyncItemForReplay(item = {}) {
  if (!item) return item;
  const next = { ...item, data: { ...(item.data || {}) } };

  if (next.type === 'rpc' &&
  ['update_booking', 'update_booking_status'].includes(next.table) &&
  !next.data.p_idempotency_key) {
    const queueId = String(next._queue_id || '').replace(/[^A-Za-z0-9:_-]/g, '-').slice(0, 80);
    if (queueId) {
      next.data.p_idempotency_key = `sync:${next.table}:${queueId}`.slice(0, 128);
    }
  }
  if (next.type === 'rpc' && next.table === 'adjust_inventory_stock' && !next.data.p_adjustment_id) {
    const queueId = String(next._queue_id || '');
    const prefix = 'inventory-adjust-';
    if (queueId.startsWith(prefix)) {
      const adjustmentId = queueId.slice(prefix.length);
      if (/^[0-9a-fA-F-]{36}$/.test(adjustmentId)) {
        next.data.p_adjustment_id = adjustmentId;
      }
    }
  }
  if (next.type === 'rpc' && next.table === 'reschedule_booking' && !next.data.p_idempotency_key) {
    const queueId = String(next._queue_id || '').replace(/[^A-Za-z0-9:_-]/g, '-').slice(0, 80);
    if (queueId) {
      next.data.p_idempotency_key = `sync:reschedule_booking:${queueId}`.slice(0, 128);
    }
  }
  if (next.type === 'rpc' && next.table === 'record_customer_credit' && !next.data.p_idempotency_key) {
    const queueId = String(next._queue_id || '').replace(/[^A-Za-z0-9:_-]/g, '-').slice(0, 80);
    if (queueId) {
      next.data.p_idempotency_key = `sync:record_customer_credit:${queueId}`.slice(0, 128);
    }
  }

  if (next.type === 'rpc' && ['update_booking', 'update_customer', 'update_room', 'update_quotation'].includes(next.table) && !('p_expected_updated_at' in next.data)) {
    next.data.p_expected_updated_at = null;
  }

  if (next.type === 'rpc' &&
  next.table === 'update_booking_status' &&
  String(next._depends_on || '').startsWith('booking-')) {
    next.data.p_expected_updated_at = null;
  }

  return next;
}
