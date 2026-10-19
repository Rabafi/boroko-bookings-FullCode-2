// @ts-check
import { randomUUID } from 'crypto';

/** @typedef {Record<string, unknown>} QueueItemPropertyView */
/** @typedef {Record<string, unknown>} QueueDataPropertyView */
/** @typedef {Record<string, unknown>} QueuePayloadPropertyView */

export const DEAD_LETTER_AUTO_RETRY_AFTER_MS = 30 * 60 * 1000;

/** @param {string} [prefix] @returns {string} */
function createQueueOperationId(prefix = 'op') {
  return `${prefix}-${randomUUID()}`;
}

/** @param {unknown} [item] @param {string} [fallbackType] @returns {QueueItemPropertyView} */
export function ensureQueuedItem(item = {}, fallbackType = 'op') {
  const queueItem = /** @type {QueueItemPropertyView} */ (item)
  return {
    ...queueItem,
    _queue_id: queueItem._queue_id || createQueueOperationId(fallbackType)
  };
}

/** @param {unknown} item @returns {boolean} */
export function isPosCreateOrderQueueItem(item) {
  const queueItem = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  return queueItem?.type === 'rpc' && (queueItem?.table === 'create_pos_order' || queueItem?.table === 'create_pos_order_v3');
}

/** @param {unknown} item @returns {boolean} */
export function isPosVoidQueueItem(item) {
  const queueItem = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  return queueItem?.type === 'rpc' && (queueItem?.table === 'approve_pos_void_with_pin' || queueItem?.table === 'create_pos_return_v3');
}

/** @param {unknown} item @returns {boolean} */
export function isInventoryItemQueueItem(item) {
  const queueItem = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  return queueItem?.type === 'rpc' && queueItem?.table === 'create_inventory_item';
}

/** @param {unknown} item @returns {boolean} */
export function isInventoryAdjustmentQueueItem(item) {
  const queueItem = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  return queueItem?.type === 'rpc' && queueItem?.table === 'adjust_inventory_stock';
}

/** @param {unknown} item @returns {boolean} */
export function isBarStockBatchQueueItem(item) {
  const queueItem = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  return queueItem?.type === 'rpc' && (queueItem?.table === 'post_bar_physical_count' || queueItem?.table === 'post_bar_simple_delivery')
}

/** @param {unknown} item @returns {string | null} */
export function getQueuedInventoryItemId(item) {
  const queueItem = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  const data = /** @type {QueueDataPropertyView | null | undefined} */ (queueItem?.data)
  const payload = /** @type {QueuePayloadPropertyView | null | undefined} */ (data?.payload)
  const payloadId = String(payload?.id || '').trim();
  if (payloadId) return payloadId;

  const queueId = String(queueItem?._queue_id || '').trim();
  if (queueId.startsWith('inventory-item-')) {
    const parsedId = queueId.slice('inventory-item-'.length).trim();
    if (parsedId) return parsedId;
  }

  console.warn('[INVENTORY SYNC] Missing item id for queue item', {
    queueId: queueItem?._queue_id || null,
    table: queueItem?.table || null
  });
  return null;
}

/** @param {unknown} item @returns {string | null} */
export function getQueuedDayUseEntryId(item) {
  const queueItem = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  const data = /** @type {QueueDataPropertyView | null | undefined} */ (queueItem?.data)
  const payload = /** @type {QueuePayloadPropertyView | null | undefined} */ (data?.payload)
  const payloadId = String(payload?.id || data?.p_id || '').trim();
  if (payloadId) return payloadId;

  const queueId = String(queueItem?._queue_id || '').trim();
  for (const prefix of ['dayuse-status-', 'dayuse-']) {
    if (queueId.startsWith(prefix)) {
      const remainder = queueId.slice(prefix.length).trim();
      const parsedId = remainder.split('-status-')[0].trim();
      if (parsedId) return parsedId;
    }
  }

  return null;
}

/** @param {unknown} item @returns {string | null} */
export function getQueuedPosOrderId(item) {
  const queueItem = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  const data = /** @type {QueueDataPropertyView | null | undefined} */ (queueItem?.data)
  const payload = /** @type {QueuePayloadPropertyView | null | undefined} */ (data?.payload)
  const payloadId = String(
    queueItem?.table === 'create_pos_return_v3'
      ? payload?.return_order_id
      : payload?.id || payload?.order_id || ''
  ).trim();
  if (payloadId) return payloadId;

  const queueId = String(queueItem?._queue_id || '').trim();
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
    queueId: queueItem?._queue_id || null,
    table: queueItem?.table || null
  });
  return null;
}

/** @param {unknown} item @returns {unknown} */
export function getSyncItemBookingId(item) {
  const queueItem = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  const data = /** @type {QueueDataPropertyView | null | undefined} */ (queueItem?.data)
  const payload = /** @type {QueuePayloadPropertyView | null | undefined} */ (data?.payload)
  return data?.p_booking_id ||
  payload?.booking_id ||
  payload?.id ||
  data?.p_id ||
  null;
}

/** @param {unknown} item @returns {unknown} */
export function getSyncItemScope(item) {
  const queueItem = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  const data = /** @type {QueueDataPropertyView | null | undefined} */ (queueItem?.data)
  if (isBarStockBatchQueueItem(item)) {
    const operationId = String(data?.p_operation_id || '').trim();
    if (operationId) return `bar-stock-operation:${operationId}`;
  }
  const bookingId = getSyncItemBookingId(item);
  if (bookingId) return `booking:${bookingId}`;
  const posOrderId = getQueuedPosOrderId(item);
  if (posOrderId) return `pos-order:${posOrderId}`;
  const dayUseEntryId = getQueuedDayUseEntryId(item);
  if (dayUseEntryId && (/pool_day_use/i.test(String(queueItem?.table || '')) || String(queueItem?._queue_id || '').startsWith('dayuse-'))) {
    return `day-use-entry:${dayUseEntryId}`;
  }
  if (isInventoryItemQueueItem(item)) {
    const itemId = getQueuedInventoryItemId(item);
    if (itemId) return `inventory-item:${itemId}`;
  }
  if (isInventoryAdjustmentQueueItem(item)) {
    const itemId = String(data?.p_item_id || '').trim();
    if (itemId) return `inventory-item:${itemId}`;
  }
  return queueItem?.table || 'unknown';
}

// Before the financial-truth tender contract existed, some queued desktop
// orders carried customer_account_charge beside a cash-only breakdown.  The
// server cannot infer that intent safely.  Adapt only that legacy envelope,
// preserving the v3 RPC name and stable order/idempotency key.  New callers
// must put customer_id/code directly on payment_breakdown.
/** @param {unknown} payload @returns {unknown} */
export function adaptLegacyPosOrderFinancialPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const payloadView = /** @type {QueuePayloadPropertyView} */ (payload)
  const legacyCharge = /** @type {QueuePayloadPropertyView | null | undefined} */ (payloadView.customer_account_charge);
  if (!legacyCharge?.customer_id) return payload;

  const breakdown = Array.isArray(payloadView.payment_breakdown) ? /** @type {unknown[]} */ (payloadView.payment_breakdown) : [];
  if (breakdown.some((rawRow) => {
    const row = /** @type {QueuePayloadPropertyView | null | undefined} */ (rawRow)
    return String(row?.method || '').trim().toLowerCase() === 'account'
  })) return payload;

  const amount = Number(legacyCharge.amount ?? payloadView.total ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return payload;

  return {
    ...payloadView,
    payment_method: 'account',
    payment_breakdown: [{
      method: 'account',
      amount: Math.round(amount * 100) / 100,
      customer_id: legacyCharge.customer_id,
      reference: null
    }]
  };
}

/** @param {unknown} [item] @returns {unknown} */
export function normalizeQueuedSyncItemForReplay(item = {}) {
  if (!item) return item;
  const source = /** @type {QueueItemPropertyView} */ (item)
  const next = /** @type {QueueItemPropertyView & {data: QueueDataPropertyView}} */ ({
    ...source,
    data: { .../** @type {QueueDataPropertyView} */ (source.data || {}) }
  })
  // Batch Bar stock RPCs hash their ordered line envelope server-side. Keep
  // replay byte-for-byte stable even if an older queue file was assembled in
  // a different item order.
  if (next.type === 'rpc' && (next.table === 'post_bar_physical_count' || next.table === 'post_bar_simple_delivery') && Array.isArray(next.data.p_lines)) {
    const lines = /** @type {unknown[]} */ (next.data.p_lines)
    next.data.p_lines = [...lines].sort((leftValue, rightValue) => {
      const left = /** @type {QueueItemPropertyView | null | undefined} */ (leftValue)
      const right = /** @type {QueueItemPropertyView | null | undefined} */ (rightValue)
      return String(left?.item_id || '').localeCompare(String(right?.item_id || ''))
    })
  }

  if (next.type === 'rpc' && (next.table === 'create_pos_order' || next.table === 'create_pos_order_v3') && next.data?.payload) {
    next.data.payload = adaptLegacyPosOrderFinancialPayload(next.data.payload);
  }
  if (next.type === 'rpc' &&
  (next.table === 'update_booking' || next.table === 'update_booking_status') &&
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
  if (next.type === 'rpc' && (
    next.table === 'record_customer_credit' ||
    next.table === 'apply_customer_credit_to_booking' ||
    next.table === 'refund_customer_credit' ||
    next.table === 'reverse_customer_credit_entry'
  ) && !next.data.p_idempotency_key) {
    const queueId = String(next._queue_id || '').replace(/[^A-Za-z0-9:_-]/g, '-').slice(0, 80);
    if (queueId) {
      next.data.p_idempotency_key = `sync:${next.table}:${queueId}`.slice(0, 128);
    }
  }

  if (next.type === 'rpc' && (
    next.table === 'update_booking' ||
    next.table === 'update_customer' ||
    next.table === 'update_room' ||
    next.table === 'update_quotation'
  ) && !('p_expected_updated_at' in next.data)) {
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
/** @param {unknown} [pending] @param {unknown} [diskQueue] @param {{completedIds?: unknown, deadIds?: unknown, inFlightId?: unknown}} [options] @returns {unknown[]} */
export function collectNewDiskQueueArrivals(pending = [], diskQueue = [], { completedIds = new Set(), deadIds = new Set(), inFlightId = null } = {}) {
  const pendingRows = Array.isArray(pending) ? /** @type {unknown[]} */ (pending) : []
  const pendingIds = new Set(pendingRows.map((rawEntry) => {
    const entry = /** @type {QueueItemPropertyView | null | undefined} */ (rawEntry)
    return entry?._queue_id
  }).filter(Boolean));
  const arrivals = [];
  const diskRows = Array.isArray(diskQueue) ? /** @type {unknown[]} */ (diskQueue) : []
  for (const rawValue of diskRows) {
    const raw = /** @type {QueueItemPropertyView | null | undefined} */ (rawValue)
    if (!raw || typeof raw !== 'object') continue;
    const item = ensureQueuedItem(raw, raw?.type || 'op');
    const id = item?._queue_id || null;
    if (!id) continue;
    if (pendingIds.has(id)) continue;
    if (inFlightId && id === inFlightId) continue;
    const completedCollection = /** @type {{has?: unknown} | null | undefined} */ (completedIds)
    const deadCollection = /** @type {{has?: unknown} | null | undefined} */ (deadIds)
    if (completedCollection && typeof completedCollection.has === 'function' && completedCollection.has(id)) continue;
    if (deadCollection && typeof deadCollection.has === 'function' && deadCollection.has(id)) continue;
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
/** @param {unknown} [existing] @param {unknown} [incoming] @returns {unknown[]} */
export function mergeDeadLetterQueues(existing = [], incoming = []) {
  const byId = new Map();
  const withoutId = [];
  const existingRows = Array.isArray(existing) ? /** @type {unknown[]} */ (existing) : []
  const incomingRows = Array.isArray(incoming) ? /** @type {unknown[]} */ (incoming) : []
  for (const rawRow of existingRows) {
    const row = /** @type {QueueItemPropertyView | null | undefined} */ (rawRow)
    if (row?._queue_id) {
      if (!byId.has(row._queue_id)) byId.set(row._queue_id, row);
    } else if (row && typeof row === 'object') {
      withoutId.push(row);
    }
  }
  for (const rawRow of incomingRows) {
    const row = /** @type {QueueItemPropertyView | null | undefined} */ (rawRow)
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
/** @param {unknown} pendingList @param {string} operationKey @param {string} menuId @param {string | null} [inventoryId] @returns {number} */
export function rewritePendingProductReferences(pendingList, operationKey, menuId, inventoryId = null) {
  if (!operationKey || !menuId) return 0;
  const provisionalMenuId = 'pending:' + operationKey;
  const provisionalStockId = provisionalMenuId + ':stock';
  let rewritten = 0;
  const pendingRows = Array.isArray(pendingList) ? /** @type {unknown[]} */ (pendingList) : []
  for (const rawQueued of pendingRows) {
    const queued = /** @type {QueueItemPropertyView | null | undefined} */ (rawQueued)
    const data = /** @type {QueueDataPropertyView | null | undefined} */ (queued?.data)
    const payload = queued && data ? /** @type {QueuePayloadPropertyView | null | undefined} */ (data.payload) : null;
    if (!payload || !Array.isArray(payload.items)) continue;
    let touched = false;
    for (const rawLine of /** @type {unknown[]} */ (payload.items)) {
      const line = /** @type {QueuePayloadPropertyView | null | undefined} */ (rawLine)
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
/** @param {unknown} cachedShifts @param {{outletId?: unknown, cashierId?: unknown}} [options] @returns {unknown} */
export function resolveCurrentOpenShiftId(cachedShifts, { outletId = null, cashierId = null } = {}) {
  const rows = Array.isArray(cachedShifts) ? /** @type {unknown[]} */ (cachedShifts) : [];
  const rowView = (row) => /** @type {QueueItemPropertyView | null | undefined} */ (row)
  const sameOutlet = (row) => (rowView(row)?.outlet_id || null) === (outletId || null);
  const sameCashier = (row) => !cashierId || !rowView(row)?.cashier_id || String(rowView(row).cashier_id) === String(cashierId);
  const open = rows.filter((rawRow) => {
    const row = rowView(rawRow)
    return String(row?.status || '').toLowerCase() === 'open' &&
    !row?.closed_at &&
    sameOutlet(rawRow) &&
    sameCashier(rawRow)
  })
  if (open.length === 0) return null;
  open.sort((a, b) => String(rowView(b)?.opened_at || '').localeCompare(String(rowView(a)?.opened_at || '')));
  return rowView(open[0])?.id || null;
}

/**
 * Reviewed server contract for replaying an uncommitted historical sale whose
 * originating shift has since closed. The wrapper re-validates the original
 * shift/operator/outlet/offline window, reconciles an already committed exact
 * receipt first, and only then records the order under the ORIGINAL shift.
 * Queued replay must never rewrite `shift_id` to today's open shift: that
 * either conflicts with the committed receipt hash or silently moves revenue
 * into the wrong cash-up. Drafted for Codex review; not deployed.
 */
export const POS_HISTORICAL_REPLAY_RPC = 'replay_pos_order_v3_historical_v1';

/** Version of the local replay scheduling metadata written onto queue rows. */
export const REPLAY_SCHEDULE_SCHEMA = 1;

/**
 * Pure routing decision for a queued `create_pos_order_v3` replay.
 * `open_shift`  -> originating shift is cached open; replay the original bytes
 *                  through the ordinary authoritative RPC.
 * `historical`  -> originating shift is cached closed, or the client cannot
 *                  see it; route through the reviewed historical contract. The
 *                  wrapper delegates to the ordinary RPC when the shift is
 *                  actually open, so this is safe even for a stale cache.
 */
/** @param {unknown} cachedShifts @param {Record<string, unknown> | null | undefined} [payload] @returns {'open_shift' | 'historical'} */
export function classifySaleReplayRoute(cachedShifts, payload) {
  const shiftId = String((payload ? payload.shift_id : '') || '').trim();
  if (!shiftId) return 'historical';
  const rows = Array.isArray(cachedShifts) ? /** @type {unknown[]} */ (cachedShifts) : [];
  const rowView = (row) => /** @type {QueueItemPropertyView | null | undefined} */ (row)
  const row = rows.find((rawRow) => String(rowView(rawRow)?.id || '') === shiftId);
  if (!row) return 'historical';
  const isOpen = String(rowView(row)?.status || '').toLowerCase() === 'open' && !rowView(row)?.closed_at;
  return isOpen ? 'open_shift' : 'historical';
}

/**
 * Builds the historical replay request envelope. The original payload is
 * forwarded byte-for-byte; the deterministic replay key is derived from the
 * original operation identity so a timeout can never mint a replacement key.
 */
/** @param {unknown} item @param {Record<string, unknown>} payload @returns {{payload: Record<string, unknown>, p_replay_key: string}} */
export function buildHistoricalReplayRequest(item, payload) {
  const itemView = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  const operationKey = String((payload ? payload.create_idempotency_key : '') || '').trim();
  const queueId = String(itemView?._queue_id || '').trim();
  return {
    payload,
    p_replay_key: `hist-replay:${operationKey || queueId || 'unknown'}`
  };
}

/**
 * True when the server answered that the reviewed historical replay contract
 * is absent (PostgREST schema-cache miss / undefined function). This is a
 * deployment prerequisite, not a business rejection: the sale is retained and
 * parked for automatic resume once the contract becomes available.
 */
/** @param {unknown} error @returns {boolean} */
export function isHistoricalReplayContractMissing(error) {
  const errorView = /** @type {{code?: unknown, message?: unknown} | null | undefined} */ (error)
  const code = String(errorView?.code || '').toUpperCase();
  const message = String(errorView?.message || error || '');
  // Always require the named contract so an unrelated missing RPC is never
  // misclassified as the historical replay prerequisite.
  if (!/replay_pos_order_v3_historical_v1/i.test(message)) return false;
  if (code === 'PGRST202' || code === '42883' || code === '404' || code === 'PGRST203') return true;
  return /could not find the function|does not exist|schema cache|not found|Undefined function/i.test(message);
}

/** Structured replay outcome classes. Never collapse "not confirmed" into "failed". */
export const REPLAY_OUTCOME = Object.freeze({
  TRANSPORT_UNCERTAIN: 'transport_uncertain',
  THROTTLED: 'throttled',
  SERVER_UNAVAILABLE: 'server_unavailable',
  AUTH_EXPIRED: 'auth_expired',
  PARENT_PENDING: 'parent_pending',
  CONTRACT_MISSING: 'contract_missing',
  BUSINESS_CONFLICT: 'business_conflict',
  PERMISSION_DENIED: 'permission_denied',
  VALIDATION_REJECTED: 'validation_rejected',
  UNKNOWN: 'unknown'
});

const REPLAY_RETRYABLE_OUTCOMES = new Set([
  REPLAY_OUTCOME.TRANSPORT_UNCERTAIN,
  REPLAY_OUTCOME.THROTTLED,
  REPLAY_OUTCOME.SERVER_UNAVAILABLE,
  REPLAY_OUTCOME.AUTH_EXPIRED,
  REPLAY_OUTCOME.PARENT_PENDING,
  REPLAY_OUTCOME.UNKNOWN
]);

// Where the verdict came from. Structured evidence (the server's own
// manual_review_required flag or a known refusal code) is authoritative;
// wording is only a legacy fallback and must never override it.
export const REPLAY_OUTCOME_SOURCE = Object.freeze({
  MANUAL_FLAG: 'manual_flag',
  STRUCTURED_CODE: 'structured_code',
  WORDING: 'wording',
  NONE: 'none'
});

// Structured server refusals that require an authorized decision, not another
// automatic attempt. Codes are compared uppercased so both the sqljson `code`
// returned by the replay RPCs and PostgREST/SQLSTATE codes classify the same.
// The matrix covers the refusal codes emitted by the deployed sale/settlement,
// void and historical-replay contracts; codes not listed here keep the safe
// fallback (bounded auto-retry, then manual-review dead-letter) rather than
// being guessed into review.
const STRUCTURED_REVIEW_CODES = new Set([
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_EXPIRED',
  'IDEMPOTENCY_RECEIPT_UNAVAILABLE',
  'SHIFT_NOT_OPEN',
  'TAB_VERSION_REQUIRED',
  'TAB_VERSION_CONFLICT',
  'TAB_NOT_OWNED',
  'TAB_ALREADY_SETTLED',
  'CATALOG_REFRESH_REQUIRED',
  'CASHUP_RECONCILIATION_REQUIRED',
  'HISTORICAL_ADMISSION_MISSING',
  'HISTORICAL_SHIFT_UNRESOLVED',
  'HISTORICAL_TIME_MISMATCH',
  'HISTORICAL_WINDOW_EXPIRED',
  'HISTORICAL_REPLAY_OUT_OF_SCOPE',
  'HISTORICAL_EVIDENCE_INCOMPLETE',
  'REPLAY_KEY_REQUIRED',
  'REPLAY_KEY_MISMATCH',
  'OPERATION_KEY_REQUIRED',
  'ACTOR_REQUIRED',
  'OUTLET_SCOPE_CONFLICT',
  'POOL_CASH_ONLY',
  'VALIDATION_REJECTED'
]);

// Structured shift-closure refusals (R5). The server answers these when it
// cannot settle the sale on its originating (or current) shift. They qualify
// for the bounded same-key historical replay fallback: the reviewed contract
// reconciles an already committed exact receipt before any receipt validation,
// so the fallback can never double-apply or move revenue between cash-ups.
const SHIFT_CLOSURE_REFUSAL_CODES = new Set([
  'SHIFT_NOT_OPEN',
  'TILL_SHIFT_CLOSED',
  'POS_SUBMIT_RECOVERY_REQUIRED'
]);

/**
 * True when a failed replay refusal means the sale's shift is no longer open
 * and the bounded same-key historical fallback may run exactly once. A
 * different structured refusal (changed payload, tab state, catalogue checks)
 * is never masked by shift wording, and an explicit server review flag always
 * controls instead of the fallback.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isShiftClosureSaleRefusal(error) {
  const errorView = /** @type {{code?: unknown, message?: unknown, manual_review_required?: unknown} | null | undefined} */ (error)
  if (errorView?.manual_review_required === true) return false;
  const code = String(errorView?.code || '').toUpperCase().trim();
  if (SHIFT_CLOSURE_REFUSAL_CODES.has(code)) return true;
  if (code && STRUCTURED_REVIEW_CODES.has(code)) return false;
  const message = String(errorView?.message || error || '');
  return /shift_not_open|till_shift_closed|pos_submit_recovery_required|valid open shift is required/i.test(message);
}

const REPLAY_BUSINESS_CONFLICT_WORDING = /tab_version_required|tab_version_conflict|tab_not_owned|tab_already_settled|idempotency_conflict|idempotency_expired|catalog_refresh_required|manual_review_required|shift_not_open|A valid open shift is required|outside the permitted offline trading window/i;

/** @param {unknown} outcome @returns {boolean} */
export function isRetryableReplayOutcome(outcome) {
  return REPLAY_RETRYABLE_OUTCOMES.has(String(outcome || ''));
}

/**
 * Deterministic outcome classification for a failed replay attempt. Uses the
 * structured server code/flag when present, then a bounded set of transport
 * and authorization signals. No broad "already exists means success".
 */
/** @param {{message?: unknown, code?: unknown, manualReviewRequired?: unknown}} [error] @returns {{outcomeClass: string, source: string}} */
export function classifyReplayOutcomeDetailed({ message = '', code = '', manualReviewRequired = false } = {}) {
  const normalizedCode = String(code || '').toUpperCase();
  const text = String(message || '');

  // Structured signals first: an explicit review flag or refusal code is
  // authoritative and must not be re-interpreted from transport wording.
  if (manualReviewRequired === true) {
    return { outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, source: REPLAY_OUTCOME_SOURCE.MANUAL_FLAG };
  }
  if (STRUCTURED_REVIEW_CODES.has(normalizedCode)) {
    return { outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE };
  }
  if (isHistoricalReplayContractMissing({ code: normalizedCode, message: text })) {
    return { outcomeClass: REPLAY_OUTCOME.CONTRACT_MISSING, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE };
  }
  if (normalizedCode === '429') return { outcomeClass: REPLAY_OUTCOME.THROTTLED, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE };
  if (normalizedCode === 'PGRST301' || normalizedCode === '401') {
    return { outcomeClass: REPLAY_OUTCOME.AUTH_EXPIRED, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE };
  }
  if (normalizedCode === '403' || normalizedCode === '42501' || normalizedCode === 'PGRST116') {
    return { outcomeClass: REPLAY_OUTCOME.PERMISSION_DENIED, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE };
  }
  if (normalizedCode === '500' || normalizedCode === '502' || normalizedCode === '503' || normalizedCode === '504') {
    return { outcomeClass: REPLAY_OUTCOME.SERVER_UNAVAILABLE, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE };
  }
  // 408: the request may or may not have reached the server — retry the same
  // key like any other transport uncertainty.
  if (normalizedCode === '408') {
    return { outcomeClass: REPLAY_OUTCOME.TRANSPORT_UNCERTAIN, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE };
  }
  if (normalizedCode.startsWith('22') || normalizedCode.startsWith('2350') || normalizedCode.startsWith('2351')) {
    return { outcomeClass: REPLAY_OUTCOME.VALIDATION_REJECTED, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE };
  }

  // Bounded wording fallbacks for legacy rows and transport library errors
  // that arrive without a structured code.
  if (/\b429\b|too many requests|rate limit/i.test(text)) {
    return { outcomeClass: REPLAY_OUTCOME.THROTTLED, source: REPLAY_OUTCOME_SOURCE.WORDING };
  }
  if (/jwt expired|session expired|not authenticated|invalid token|refresh token|unlock/i.test(text)) {
    return { outcomeClass: REPLAY_OUTCOME.AUTH_EXPIRED, source: REPLAY_OUTCOME_SOURCE.WORDING };
  }
  if (/permission denied|capability is required|not authorized|row-level security/i.test(text)) {
    return { outcomeClass: REPLAY_OUTCOME.PERMISSION_DENIED, source: REPLAY_OUTCOME_SOURCE.WORDING };
  }
  if (/service unavailable|bad gateway|gateway timeout|database is starting|connection pool/i.test(text)) {
    return { outcomeClass: REPLAY_OUTCOME.SERVER_UNAVAILABLE, source: REPLAY_OUTCOME_SOURCE.WORDING };
  }
  if (/fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|timed out|timeout|canceling statement|statement timeout/i.test(text)) {
    return { outcomeClass: REPLAY_OUTCOME.TRANSPORT_UNCERTAIN, source: REPLAY_OUTCOME_SOURCE.WORDING };
  }
  if (REPLAY_BUSINESS_CONFLICT_WORDING.test(text)) {
    return { outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, source: REPLAY_OUTCOME_SOURCE.WORDING };
  }
  return { outcomeClass: REPLAY_OUTCOME.UNKNOWN, source: REPLAY_OUTCOME_SOURCE.NONE };
}

/** @param {{message?: unknown, code?: unknown, manualReviewRequired?: unknown}} [error] @returns {string} */
export function classifyReplayOutcome(error = {}) {
  return classifyReplayOutcomeDetailed(error).outcomeClass;
}

// POS submit-journal retention (R7-A). A dead provisional sale replay may only
// clear its journal when the refusal proves the attempt did not commit. The
// deployed replay contracts answer a same-key retry with the stored receipt
// before fresh validation, so a definitive post-receipt refusal frees the Till;
// but transport/authorization failures, a missing contract and receipt-identity
// refusals (conflict, expired, unavailable, key mismatch, incomplete evidence,
// missing tab version) cannot prove absence and keep the original attempt
// visible for reconciliation.
const COMMIT_AMBIGUOUS_REPLAY_CODES = new Set([
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_EXPIRED',
  'IDEMPOTENCY_RECEIPT_UNAVAILABLE',
  'REPLAY_KEY_REQUIRED',
  'REPLAY_KEY_MISMATCH',
  'HISTORICAL_EVIDENCE_INCOMPLETE',
  'TAB_VERSION_REQUIRED',
  // R3: shift-closure and tab-settlement refusals can be answered before
  // receipt reconciliation in an older or regressed replay contract; a
  // committed sale must not lose its recovery journal on such an answer.
  'SHIFT_NOT_OPEN',
  'TAB_ALREADY_SETTLED',
  'TAB_NOT_OWNED',
  'TAB_VERSION_CONFLICT'
]);

/**
 * @param {{outcomeClass?: unknown, code?: unknown, legacyWordingUncertain?: unknown}} [input]
 * @returns {boolean} true when the submit journal must stay for reconciliation.
 */
export function shouldRetainPosSubmitJournal({ outcomeClass = REPLAY_OUTCOME.UNKNOWN, code = null, legacyWordingUncertain = false } = {}) {
  const normalizedOutcome = String(outcomeClass || '');
  if (isRetryableReplayOutcome(normalizedOutcome)) return true;
  if (normalizedOutcome === REPLAY_OUTCOME.CONTRACT_MISSING) return true;
  // Authorization refusals are evaluated before receipt-first reconciliation
  // in the deployed contracts, so a scope/role change can hide a committed sale.
  if (normalizedOutcome === REPLAY_OUTCOME.PERMISSION_DENIED) return true;
  if (COMMIT_AMBIGUOUS_REPLAY_CODES.has(String(code || '').toUpperCase())) return true;
  // Legacy rows without structured evidence keep the historical wording test.
  return legacyWordingUncertain === true;
}

/**
 * Stable per-operation jitter so tills replaying after the same outage do not
 * retry in lockstep. Derived from the queue identity, so the same operation
 * always schedules the same window and a retry is deterministic across
 * restarts; rows without an identity get no jitter.
 */
/** @param {QueueItemPropertyView | null | undefined} itemView @returns {number} */
function replayJitterMs(itemView) {
  const queueId = String(itemView?._queue_id || '');
  if (!queueId) return 0;
  let hash = 0;
  for (let index = 0; index < queueId.length; index += 1) {
    hash = (hash * 31 + queueId.charCodeAt(index)) >>> 0;
  }
  return hash % 10000;
}

/**
 * Bounded retry schedule metadata persisted on queue rows. `retryCount` stays
 * owned by the existing replay loop; `_next_retry_at` is enforced by the
 * replay loop before any attempt and carries a bounded, stable jitter so
 * synchronized replays spread out. Existing rows without these fields keep
 * working unchanged.
 */
/** @param {unknown} item @param {{outcomeClass?: string, code?: string | null, message?: string, now?: Date, baseDelayMs?: number, maxDelayMs?: number}} [options] @returns {Record<string, unknown>} */
export function buildReplayFailureMetadata(item, {
  outcomeClass = REPLAY_OUTCOME.UNKNOWN,
  code = null,
  message = '',
  now = new Date(),
  baseDelayMs = 1000,
  maxDelayMs = 30 * 60 * 1000
} = {}) {
  const itemView = /** @type {QueueItemPropertyView | null | undefined} */ (item)
  const retryCount = Math.max(0, Number(itemView?.retryCount || 0));
  const schedule = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, Math.max(0, retryCount - 1)));
  const jitter = replayJitterMs(itemView);
  const firstFailedAt = String(itemView?._first_failed_at || '') || now.toISOString();
  return {
    _replay_schema: REPLAY_SCHEDULE_SCHEMA,
    _outcome_class: outcomeClass,
    _last_failure_code: code || null,
    _first_failed_at: firstFailedAt,
    _next_retry_at: isRetryableReplayOutcome(outcomeClass)
      ? new Date(now.getTime() + schedule + jitter).toISOString()
      : null,
    _review_reason: isRetryableReplayOutcome(outcomeClass) ? null : String(message || '').slice(0, 500)
  };
}
