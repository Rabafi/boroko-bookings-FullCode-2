// @ts-check
import { readCache, writeCache } from './cacheStore.js';
import { readSyncQueue } from './syncStore.js';
import { isPosCreateOrderQueueItem } from './syncShared.js';

/**
 * Cache, query, and queue records are persisted/wire objects. These expected-
 * data views describe fields this projection reads; JSON/RPC payloads are not
 * validated here, and the runtime continues to see the original values.
 * @typedef {Record<string, unknown> & {type?: string, table?: string, data?: (Record<string, unknown> & {payload?: Record<string, unknown>})|null, _inventory_extras?: unknown}} PosOfflineQueueView
 * @typedef {Record<string, unknown> & {id?: unknown, order_id?: unknown, name?: unknown, inventory_item_id?: unknown, depletion_qty?: unknown, item_name?: unknown, outlet_id?: unknown, quantity?: unknown, synced_current_stock?: unknown, current_stock?: unknown, _sync_state?: unknown}} PosOfflineRowView
 * @typedef {Record<string, unknown> & {menu_item_id?: unknown, inventory_item_id?: unknown, depletion_qty?: unknown, item_name?: unknown, quantity?: unknown}} PosOfflineEntryView
 * @typedef {Record<string, unknown> & {item_id?: unknown, quantity?: unknown, actual_qty?: unknown}} PosOfflineStockLineView
 * @typedef {Record<string, unknown> & {p_lines?: unknown, p_item_id?: unknown, p_delta?: unknown, payload?: Record<string, unknown>}} PosOfflineRpcDataView
 * @typedef {Map<string, unknown>} PosMenuIndex
 * @typedef {Map<string, unknown[]>} PosInventoryNameIndex
 * @typedef {Map<unknown, number>} InventoryUsage
 */

/** @param {unknown} value @returns {number} */
function normalizeInventoryStockValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** @param {unknown} value @param {number} [fallback] @returns {number} */
function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/** @param {unknown} menuRows @returns {PosMenuIndex} */
export function buildPosMenuIndex(menuRows = []) {
  /** @type {PosMenuIndex} */
  const byId = new Map();
  // Keep the existing cache row property reads. Row shape remains unchecked.
  for (const rawRow of /** @type {unknown[]} */ (Array.isArray(menuRows) ? menuRows : [])) {
    const row = /** @type {PosOfflineRowView|null|undefined} */ (rawRow);
    if (row?.id) byId.set(String(row.id), row);
  }
  return byId;
}

/** @param {unknown} inventoryRows @returns {PosInventoryNameIndex} */
export function buildInventoryNameIndex(inventoryRows = []) {
  /** @type {PosInventoryNameIndex} */
  const byName = new Map();
  // Keep the existing inventory row property reads. Row shape remains unchecked.
  for (const rawRow of /** @type {unknown[]} */ (Array.isArray(inventoryRows) ? inventoryRows : [])) {
    const row = /** @type {PosOfflineRowView|null|undefined} */ (rawRow);
    const key = String(row?.name || '').trim().toLowerCase();
    if (!key) continue;
    let namedRows = byName.get(key);
    if (!namedRows) {
      namedRows = [];
      byName.set(key, namedRows);
    }
    namedRows.push(row);
  }
  return byName;
}

/** @param {PosOfflineEntryView} [entry] @param {{outletId?: unknown}} [options] */
function resolveQueuedPosInventoryLink(entry = {}, { outletId = null } = {}) {
  // Legacy single-line path: reads caches once per call. Hot paths below pass
  // prebuilt indexes via resolveQueuedPosInventoryLinkIndexed instead, so a
  // 30k-order projection does not re-parse pos-menu-items.json per line.
  const menuRows = entry?.menu_item_id ? readCache('pos-menu-items') : [];
  const menuById = entry?.menu_item_id ? buildPosMenuIndex(menuRows) : new Map();
  // Cache parsing is intentionally not validation. This projection expects the
  // inventory cache sequence written by existing producers; retain the
  // original .length behavior for malformed non-array JSON values.
  const inventoryRows = /** @type {unknown[]} */ (entry?.item_name && !entry?.inventory_item_id && !entry?.menu_item_id ? readCache('inventory-items') : []);
  return resolveQueuedPosInventoryLinkIndexed(entry, {
    outletId,
    menuById,
    inventoryByName: inventoryRows.length > 0 ? buildInventoryNameIndex(inventoryRows) : new Map()
  });
}

/**
 * @param {PosOfflineEntryView} [entry]
 * @param {{outletId?: unknown, menuById?: PosMenuIndex|undefined, inventoryByName?: PosInventoryNameIndex|undefined}} [options]
 */
export function resolveQueuedPosInventoryLinkIndexed(entry = {}, { outletId = null, menuById = new Map(), inventoryByName = new Map() } = {}) {
  if (entry.inventory_item_id) {
    return {
      inventoryItemId: entry.inventory_item_id,
      depletionQty: normalizePositiveQty(entry.depletion_qty, 1)
    };
  }

  if (entry.menu_item_id && menuById && typeof menuById.get === 'function') {
    const menuItem = /** @type {PosOfflineRowView|null|undefined} */ (menuById.get(String(entry.menu_item_id)));
    if (menuItem?.inventory_item_id) {
      return {
        inventoryItemId: menuItem.inventory_item_id,
        depletionQty: normalizePositiveQty(menuItem.depletion_qty, 1)
      };
    }
  }

  const itemName = String(entry.item_name || '').trim().toLowerCase();
  if (!itemName) return { inventoryItemId: null, depletionQty: normalizePositiveQty(entry.depletion_qty, 1) };
  const matches = (inventoryByName?.get?.(itemName) || []).filter((rawItem) => {
    const item = /** @type {PosOfflineRowView|null|undefined} */ (rawItem);
    return !outletId || !item?.outlet_id || item.outlet_id === outletId;
  });
  return {
    // Exactly one filter result guarantees an element under the native Array
    // contract; this assertion preserves the current result without a fallback.
    inventoryItemId: matches.length === 1 ? /** @type {PosOfflineRowView} */ (matches[0]).id : null,
    depletionQty: normalizePositiveQty(entry.depletion_qty, 1)
  };
}

/** @param {unknown[]} items @param {{outletId?: unknown, menuById?: PosMenuIndex|null, inventoryByName?: PosInventoryNameIndex|null}} [options] @returns {InventoryUsage} */
function buildQueuedPosInventoryUsage(items = [], { outletId = null, menuById = null, inventoryByName = null } = {}) {
  /** @type {InventoryUsage} */
  const usage = new Map();
  // Index once per batch so thousands of queued lines do not re-read cache
  // files per line (previously one full pos-menu-items.json parse per line).
  const sharedMenuById = menuById || buildPosMenuIndex(readCache('pos-menu-items'));
  const sharedNameIndex = inventoryByName || buildInventoryNameIndex(readCache('inventory-items'));
  for (const rawEntry of items || []) {
    // This helper directly reads entry fields. Keep its call-site type non-null
    // without adding a guard; malformed queue rows retain their existing throw.
    const entry = /** @type {PosOfflineEntryView} */ (rawEntry);
    const link = resolveQueuedPosInventoryLinkIndexed(entry, { outletId, menuById: sharedMenuById, inventoryByName: sharedNameIndex });
    const inventoryItemId = link.inventoryItemId;
    const depletionQty = link.depletionQty;
    if (!inventoryItemId) continue;
    const quantity = Number(entry.quantity || 0);
    if (!quantity) continue;
    usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity * normalizePositiveQty(depletionQty, 1));
  }
  return usage;
}

/** @param {unknown[]} items @param {{outletId?: unknown, menuById?: PosMenuIndex|undefined, inventoryByName?: PosInventoryNameIndex|undefined}} [options] @returns {InventoryUsage} */
function buildIndexedOrderUsage(items = [], { outletId = null, menuById, inventoryByName } = {}) {
  /** @type {InventoryUsage} */
  const usage = new Map();
  for (const rawEntry of items || []) {
    // The resolver's direct property reads intentionally retain their prior
    // malformed-entry failure behavior.
    const entry = /** @type {PosOfflineEntryView} */ (rawEntry);
    const link = resolveQueuedPosInventoryLinkIndexed(entry, { outletId, menuById, inventoryByName });
    if (!link.inventoryItemId) continue;
    const quantity = Number(entry.quantity || 0);
    if (!quantity) continue;
    usage.set(link.inventoryItemId, (usage.get(link.inventoryItemId) || 0) + quantity * normalizePositiveQty(link.depletionQty, 1));
  }
  return usage;
}

// Queued Bar stock batches change sellable stock just like sales do, but the
// old projection only subtracted sales. Fold every stock-affecting queued op
// in queue order so an offline delivery (+qty), adjust (+/-delta), purchase
// (+qty) or physical count (absolute actual_qty) survives a later projection
// rebuild instead of collapsing back to the last synced value.
/** @param {unknown} queueItems */
export function collectQueuedBarStockDeltas(queueItems = []) {
  const deliveryDeltas = new Map();
  const adjustDeltas = new Map();
  const purchaseDeltas = new Map();
  const countOverrides = new Map();
  const touched = new Set();
  for (const rawItem of Array.isArray(queueItems) ? queueItems : []) {
    const item = /** @type {PosOfflineQueueView|null|undefined} */ (rawItem);
    if (item?.type !== 'rpc') continue;
    if (item.table === 'post_bar_simple_delivery') {
      for (const rawLine of Array.isArray(item?.data?.p_lines) ? /** @type {unknown[]} */ (item.data.p_lines) : []) {
        const line = /** @type {PosOfflineStockLineView|null|undefined} */ (rawLine);
        const id = String(line?.item_id || '').trim();
        const qty = Number(line?.quantity || 0);
        if (!id || !Number.isFinite(qty) || qty <= 0) continue;
        deliveryDeltas.set(id, (deliveryDeltas.get(id) || 0) + qty);
        touched.add(id);
      }
    } else if (item.table === 'post_bar_physical_count') {
      for (const rawLine of Array.isArray(item?.data?.p_lines) ? /** @type {unknown[]} */ (item.data.p_lines) : []) {
        const line = /** @type {PosOfflineStockLineView|null|undefined} */ (rawLine);
        const id = String(line?.item_id || '').trim();
        const actual = Number(line?.actual_qty);
        if (!id || !Number.isFinite(actual) || actual < 0) continue;
        countOverrides.set(id, actual);
        touched.add(id);
      }
    } else if (item.table === 'adjust_inventory_stock') {
      const id = String(item?.data?.p_item_id || '').trim();
      const delta = Number(item?.data?.p_delta || 0);
      if (!id || !Number.isFinite(delta) || delta === 0) continue;
      adjustDeltas.set(id, (adjustDeltas.get(id) || 0) + delta);
      touched.add(id);
    } else if (item.table === 'add_inventory_purchase') {
      const data = /** @type {PosOfflineRpcDataView|null|undefined} */ (item?.data);
      const payload = data?.payload || {};
      const id = String(payload?.item_id || '').trim();
      const qty = Number(payload?.quantity_purchased || 0);
      if (!id || !Number.isFinite(qty) || qty <= 0) continue;
      purchaseDeltas.set(id, (purchaseDeltas.get(id) || 0) + qty);
      touched.add(id);
    }
  }
  return { deliveryDeltas, adjustDeltas, purchaseDeltas, countOverrides, touched };
}

/** @param {unknown[]} [items] @param {{outletId?: unknown}} [options] */
export function getOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  return [...buildQueuedPosInventoryUsage(items, { outletId }).entries()].
  map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }));
}

/** @param {unknown[]} extras @returns {InventoryUsage} */
function buildDayUseInventoryUsage(extras = []) {
  /** @type {InventoryUsage} */
  const usage = new Map();
  for (const rawEntry of extras || []) {
    const entry = /** @type {PosOfflineEntryView} */ (rawEntry);
    const inventoryItemId = entry?.inventory_item_id || null;
    if (!inventoryItemId) continue;
    const quantity = Math.max(0, Number(entry.quantity || 0));
    if (!quantity) continue;
    usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity);
  }
  return usage;
}

/** @param {unknown[]} extras */
export function getOfflineDayUseInventoryReservation(extras = []) {
  return [...buildDayUseInventoryUsage(extras).entries()].
  map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }));
}

/** @param {unknown[]} extras */
export function applyOfflineDayUseInventoryReservation(extras = []) {
  const usage = buildDayUseInventoryUsage(extras);
  if (usage.size === 0) return [];
  const inventory = /** @type {PosOfflineRowView[]} */ (readCache('inventory-items'));
  const next = inventory.map((rawItem) => {
    const item = /** @type {PosOfflineRowView} */ (rawItem);
    const used = usage.get(item?.id) || 0;
    if (!used) return item;
    return {
      ...item,
      current_stock: Math.max(0, normalizeInventoryStockValue(item.current_stock) - used),
      _pending_sync: true,
      _sync_state: 'pending'
    };
  });
  writeCache('inventory-items', next, { source: 'local' });
  return getOfflineDayUseInventoryReservation(extras);
}

/** @param {unknown[]} extras */
export function restoreOfflineDayUseInventoryReservation(extras = []) {
  const usage = buildDayUseInventoryUsage(extras);
  if (usage.size === 0) return [];
  const inventory = /** @type {PosOfflineRowView[]} */ (readCache('inventory-items'));
  const next = inventory.map((rawItem) => {
    const item = /** @type {PosOfflineRowView} */ (rawItem);
    const restored = usage.get(item?.id) || 0;
    if (!restored) return item;
    return {
      ...item,
      current_stock: normalizeInventoryStockValue(item.current_stock) + restored,
      _pending_sync: true,
      _sync_state: 'pending'
    };
  });
  writeCache('inventory-items', next, { source: 'local' });
  return getOfflineDayUseInventoryReservation(extras);
}

/** @param {unknown[]} [items] @param {{outletId?: unknown}} [options] */
export function applyOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  const usage = buildQueuedPosInventoryUsage(items, { outletId });
  if (usage.size === 0) return [];
  refreshOfflinePosInventoryProjection();
  return getOfflinePosInventoryReservation(items, { outletId });
}

/** @param {unknown[]} [items] @param {{outletId?: unknown}} [options] */
export function restoreOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  // Pending voids and returns must never make stock sellable. The authoritative
  // server refresh after a successful RPC applies the restoration.
  return getOfflinePosInventoryReservation(items, { outletId });
}

export function readLocalPosVoidHistory() {
  return readCache('pos-void-history');
}

/** @param {unknown[]} rows */
function writeLocalPosVoidHistory(rows = []) {
  writeCache('pos-void-history', rows);
}

/** @param {PosOfflineRowView} [entry] */
export function upsertLocalPosVoidHistory(entry = {}) {
  if (!entry?.id && !entry?.order_id) return null;
  const rows = /** @type {PosOfflineRowView[]} */ (readLocalPosVoidHistory());
  const normalized = {
    ...entry,
    id: entry.id || `local-void-${entry.order_id}-${Date.now()}`,
    action: entry.action || 'void',
    created_at: entry.created_at || new Date().toISOString()
  };
  const next = [
  normalized,
  ...rows.filter((rawRow) => {
    const row = /** @type {PosOfflineRowView|null|undefined} */ (rawRow);
    return row?.id !== normalized.id && row?.order_id !== normalized.order_id;
  })];

  writeLocalPosVoidHistory(next);
  return normalized;
}

/** @param {unknown} logId @param {unknown} patch */
export function patchLocalPosVoidHistory(logId, patch = {}) {
  if (!logId) return false;
  const rows = /** @type {PosOfflineRowView[]} */ (readLocalPosVoidHistory());
  const index = rows.findIndex((rawRow) => rawRow?.id === logId);
  if (index < 0) return false;
  const next = [...rows];
  // Object spread retains existing JavaScript coercion for malformed patches.
  // This view describes the record shape expected by current callers only.
  next[index] = { ...next[index], .../** @type {Record<string, unknown>} */ (patch) };
  writeLocalPosVoidHistory(next);
  return true;
}

// Manager-reviewed discard of orphaned local void records (see
// discardLocalPosVoidRecord in pos.js for the eligibility gates). Removes
// only the listed local rows; server data is never touched here.
/** @param {unknown} logIds */
export function removeLocalPosVoidHistory(logIds = []) {
  const ids = new Set((Array.isArray(logIds) ? /** @type {unknown[]} */ (logIds) : [logIds]).map((value) => String(value || '').trim()).filter(Boolean));
  if (ids.size === 0) return 0;
  const rows = /** @type {PosOfflineRowView[]} */ (readLocalPosVoidHistory());
  const next = rows.filter((row) => !ids.has(String(row?.id || '')));
  const removed = rows.length - next.length;
  if (removed > 0) writeLocalPosVoidHistory(next);
  return removed;
}

/** @param {unknown} remoteInventoryRows */
export function applyQueuedPosInventoryReservations(remoteInventoryRows = []) {
  const rows = /** @type {PosOfflineRowView[]} */ (Array.isArray(remoteInventoryRows) ? remoteInventoryRows : []);
  if (rows.length === 0) return rows;
  // Single-parse inputs: one queue read + one menu read per computation, with
  // shared indexes for every queued line (previously one full file parse per
  // line, which blocked the main thread for seconds at 10k+ orders).
  /** @type {unknown[]} */
  const queue = readSyncQueue();
  const menuById = buildPosMenuIndex(readCache('pos-menu-items'));
  const inventoryByName = buildInventoryNameIndex(rows);
  const { deliveryDeltas, adjustDeltas, purchaseDeltas, countOverrides, touched: batchTouched } = collectQueuedBarStockDeltas(queue);

  // Fold the queue in order so count absolutes win over earlier deliveries in
  // the same outage, while additive batches simply accumulate.
  /** @type {Map<string, number>} */
  const projected = new Map();
  /** @type {Map<string, number>} */
  const baseById = new Map();
  for (const rawRow of rows) {
    const row = /** @type {PosOfflineRowView|null|undefined} */ (rawRow);
    if (!row?.id) continue;
    baseById.set(String(row.id), normalizeInventoryStockValue(row.synced_current_stock ?? row.current_stock));
  }
  for (const [id, base] of baseById.entries()) projected.set(id, base);
  for (const [id, actual] of countOverrides.entries()) {
    if (baseById.has(id)) projected.set(id, actual);
  }
  /** @param {Map<string, number>} map */
  const addDelta = (map) => {
    for (const [id, delta] of map.entries()) {
      if (!baseById.has(id)) continue;
      projected.set(id, (projected.get(id) ?? baseById.get(id) ?? 0) + delta);
    }
  };
  addDelta(deliveryDeltas);
  addDelta(adjustDeltas);
  addDelta(purchaseDeltas);
  /** @type {Map<unknown, number>} */
  const salesUsage = new Map();
  const touched = new Set(batchTouched);
  for (const rawItem of queue) {
    const item = /** @type {PosOfflineQueueView} */ (rawItem);
    if (!isPosCreateOrderQueueItem(item)) continue;
    const queueData = item?.data;
    const payload = queueData?.payload || {};
    // The queue predicate selects POS create-order rows. The expected item
    // sequence is not validated; passing it through unchanged preserves the
    // old failure behavior for malformed truthy non-array values.
    const orderUsage = buildIndexedOrderUsage(/** @type {unknown[]} */ (payload.items || []), { outletId: payload.outlet_id || null, menuById, inventoryByName });
    for (const [inventoryItemId, quantity] of orderUsage.entries()) {
      salesUsage.set(inventoryItemId, (salesUsage.get(inventoryItemId) || 0) + quantity);
      touched.add(inventoryItemId);
    }
  }
  for (const [id, used] of salesUsage.entries()) {
    // baseById is populated only with String(row.id) keys. Map lookup would
    // reject every non-string key, so narrow without changing that behavior.
    if (typeof id !== 'string') continue;
    if (!baseById.has(id)) continue;
    projected.set(id, (projected.get(id) ?? baseById.get(id) ?? 0) - used);
  }

  const FAILURE_SYNC_STATES = new Set(['failed', 'sync_failed', 'manual_review_required']);
  return rows.map((row) => {
    if (!row?.id) return row;
    const id = String(row.id);
    const syncedStock = baseById.get(id) ?? normalizeInventoryStockValue(row.synced_current_stock ?? row.current_stock);
    const used = salesUsage.get(row?.id) || salesUsage.get(id) || 0;
    const hasQueuedEffect = touched.has(row?.id) || touched.has(id) || used > 0;
    const nextStock = Math.max(0, projected.get(id) ?? syncedStock);
    const priorState = String(row?._sync_state || '');
    return {
      ...row,
      synced_current_stock: syncedStock,
      current_stock: nextStock,
      pending_pos_reservation: used,
      ...(hasQueuedEffect ? { _pending_sync: true, _sync_state: FAILURE_SYNC_STATES.has(priorState) ? row._sync_state : 'pending' } : {})
    };
  });
}

export function refreshOfflinePosInventoryProjection() {
  const inventory = /** @type {PosOfflineRowView[]} */ (readCache('inventory-items'));
  const projected = applyQueuedPosInventoryReservations(inventory);
  writeCache('inventory-items', projected, { source: 'local-projection' });
  return projected;
}

/** @param {unknown} remoteInventoryRows */
export function applyQueuedDayUseInventoryReservations(remoteInventoryRows = []) {
  const queuedItems = readSyncQueue().filter((rawItem) => {
    // readSyncQueue returns parsed object queue entries; nested fields remain unvalidated.
    const item = /** @type {PosOfflineQueueView} */ (rawItem);
    return item.type === 'rpc' && typeof item.table === 'string' && ['add_pool_day_use', 'delete_pool_day_use'].includes(item.table);
  });
  if (queuedItems.length === 0) return remoteInventoryRows || [];

  const usage = new Map();
  for (const item of queuedItems) {
    const queueItem = /** @type {PosOfflineQueueView} */ (item);
    const data = /** @type {PosOfflineRpcDataView|null|undefined} */ (queueItem?.data);
    const payload = data?.payload || {};
    const extras = Array.isArray(payload?.extras) ? payload.extras : Array.isArray(queueItem?._inventory_extras) ? queueItem._inventory_extras : [];
    const extraUsage = buildDayUseInventoryUsage(extras);
    for (const [inventoryItemId, quantity] of extraUsage.entries()) {
      const multiplier = queueItem?.table === 'delete_pool_day_use' ? -1 : 1;
      usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity * multiplier);
    }
  }

  return (/** @type {PosOfflineRowView[]} */ (remoteInventoryRows || [])).map((rawRow) => {
    const row = /** @type {PosOfflineRowView} */ (rawRow);
    const used = usage.get(row?.id) || 0;
    if (!used) return row;
    return {
      ...row,
      current_stock: Math.max(0, normalizeInventoryStockValue(row.current_stock) - used),
      _pending_sync: true,
      _sync_state: 'pending'
    };
  });
}
