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
  return item?.type === 'rpc' && item?.table === 'create_pos_order';
}

export function getQueuedPosOrderId(item) {
  const payloadId = String(item?.data?.payload?.id || item?.data?.payload?.order_id || '').trim();
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
  return item?.table || 'unknown';
}

export function normalizeQueuedSyncItemForReplay(item = {}) {
  if (!item) return item;
  const next = { ...item, data: { ...(item.data || {}) } };

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
