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

export function isBarStockBatchQueueItem(item) {
  return item?.type === 'rpc' && ['post_bar_physical_count', 'post_bar_simple_delivery'].includes(item?.table)
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
  if (isBarStockBatchQueueItem(item)) {
    const operationId = String(item?.data?.p_operation_id || '').trim();
    if (operationId) return `bar-stock-operation:${operationId}`;
  }
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

// Before the financial-truth tender contract existed, some queued desktop
// orders carried customer_account_charge beside a cash-only breakdown.  The
// server cannot infer that intent safely.  Adapt only that legacy envelope,
// preserving the v3 RPC name and stable order/idempotency key.  New callers
// must put customer_id/code directly on payment_breakdown.
export function adaptLegacyPosOrderFinancialPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const legacyCharge = payload.customer_account_charge;
  if (!legacyCharge?.customer_id) return payload;

  const breakdown = Array.isArray(payload.payment_breakdown) ? payload.payment_breakdown : [];
  if (breakdown.some((row) => String(row?.method || '').trim().toLowerCase() === 'account')) return payload;

  const amount = Number(legacyCharge.amount ?? payload.total ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return payload;

  return {
    ...payload,
    payment_method: 'account',
    payment_breakdown: [{
      method: 'account',
      amount: Math.round(amount * 100) / 100,
      customer_id: legacyCharge.customer_id,
      reference: null
    }]
  };
}

export function normalizeQueuedSyncItemForReplay(item = {}) {
  if (!item) return item;
  const next = { ...item, data: { ...(item.data || {}) } };

  // Batch Bar stock RPCs hash their ordered line envelope server-side. Keep
  // replay byte-for-byte stable even if an older queue file was assembled in
  // a different item order.
  if (next.type === 'rpc' && ['post_bar_physical_count', 'post_bar_simple_delivery'].includes(next.table) && Array.isArray(next.data.p_lines)) {
    next.data.p_lines = [...next.data.p_lines].sort((left, right) => String(left?.item_id || '').localeCompare(String(right?.item_id || '')))
  }

  if (next.type === 'rpc' && ['create_pos_order', 'create_pos_order_v3'].includes(next.table) && next.data?.payload) {
    next.data.payload = adaptLegacyPosOrderFinancialPayload(next.data.payload);
  }
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
  if (next.type === 'rpc' && ['record_customer_credit', 'apply_customer_credit_to_booking', 'refund_customer_credit', 'reverse_customer_credit_entry'].includes(next.table) && !next.data.p_idempotency_key) {
    const queueId = String(next._queue_id || '').replace(/[^A-Za-z0-9:_-]/g, '-').slice(0, 80);
    if (queueId) {
      next.data.p_idempotency_key = `sync:${next.table}:${queueId}`.slice(0, 128);
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

/**
 * Pure replay-write-fence helper (P0-1). Given the replay loop's in-memory
 * `pending` and a fresh on-disk snapshot, returns disk rows the loop has never
 * seen: not already pending, not the current in-flight item, not already
 * completed this run, and not already dead-lettered this run. Callers append
 * the result to `pending` before every whole-file write so a sale queued
 * during an RPC await can never be erased by a stale snapshot. No IO here.
 */
export function collectNewDiskQueueArrivals(pending = [], diskQueue = [], { completedIds = new Set(), deadIds = new Set(), inFlightId = null } = {}) {
  const pendingIds = new Set((Array.isArray(pending) ? pending : []).map((entry) => entry?._queue_id).filter(Boolean));
  const arrivals = [];
  for (const raw of Array.isArray(diskQueue) ? diskQueue : []) {
    if (!raw || typeof raw !== 'object') continue;
    const item = ensureQueuedItem(raw, raw?.type || 'op');
    const id = item?._queue_id || null;
    if (!id) continue;
    if (pendingIds.has(id)) continue;
    if (inFlightId && id === inFlightId) continue;
    if (completedIds && typeof completedIds.has === 'function' && completedIds.has(id)) continue;
    if (deadIds && typeof deadIds.has === 'function' && deadIds.has(id)) continue;
    arrivals.push(normalizeQueuedSyncItemForReplay(item));
    pendingIds.add(id);
  }
  return arrivals;
}

/**
 * Pure dead-letter merge (P0-2). Dedupes by _queue_id so incremental persists
 * plus the run-end flush can never duplicate entries, and rows without an id
 * are preserved verbatim. No IO here.
 */
export function mergeDeadLetterQueues(existing = [], incoming = []) {
  const byId = new Map();
  const withoutId = [];
  for (const row of Array.isArray(existing) ? existing : []) {
    if (row?._queue_id) {
      if (!byId.has(row._queue_id)) byId.set(row._queue_id, row);
    } else if (row && typeof row === 'object') {
      withoutId.push(row);
    }
  }
  for (const row of Array.isArray(incoming) ? incoming : []) {
    if (row?._queue_id) byId.set(row._queue_id, row);
    else if (row && typeof row === 'object') withoutId.push(row);
  }
  return [...withoutId, ...byId.values()];
}

/**
 * Rewrites provisional pending:<operation_key> menu identities in queued
 * order payloads to the real server ids minted by a product replay. Returns
 * the number of queued payloads touched. Pure mutation of the passed list.
 */
export function rewritePendingProductReferences(pendingList, operationKey, menuId, inventoryId = null) {
  if (!operationKey || !menuId) return 0;
  const provisionalMenuId = 'pending:' + operationKey;
  const provisionalStockId = provisionalMenuId + ':stock';
  let rewritten = 0;
  for (const queued of Array.isArray(pendingList) ? pendingList : []) {
    const payload = queued && queued.data ? queued.data.payload : null;
    if (!payload || !Array.isArray(payload.items)) continue;
    let touched = false;
    for (const line of payload.items) {
      if (String(line && line.menu_item_id || '') === provisionalMenuId) {
        line.menu_item_id = menuId;
        touched = true;
      }
      if (inventoryId && String(line && line.inventory_item_id || '') === provisionalStockId) {
        line.inventory_item_id = inventoryId;
        touched = true;
      }
    }
    if (touched) rewritten += 1;
  }
  return rewritten;
}

/**
 * Finds the current open shift for replay reattribution (weeks-old offline
 * work replays under today's open shift, never a closed originating one).
 * Pure over cached rows so both the interactive retry path (pos.js) and the
 * queue replay path (infrastructure.js) resolve identically. Returns the
 * shift id or null when no open shift matches (caller leaves the payload
 * untouched and the server error stays actionable).
 */
export function resolveCurrentOpenShiftId(cachedShifts, { outletId = null, cashierId = null } = {}) {
  const rows = Array.isArray(cachedShifts) ? cachedShifts : [];
  const sameOutlet = (row) => (row?.outlet_id || null) === (outletId || null);
  const sameCashier = (row) => !cashierId || !row?.cashier_id || String(row.cashier_id) === String(cashierId);
  const open = rows.filter((row) =>
    String(row?.status || '').toLowerCase() === 'open' &&
    !row?.closed_at &&
    sameOutlet(row) &&
    sameCashier(row)
  );
  if (open.length === 0) return null;
  open.sort((a, b) => String(b.opened_at || '').localeCompare(String(a.opened_at || '')));
  return open[0]?.id || null;
}
