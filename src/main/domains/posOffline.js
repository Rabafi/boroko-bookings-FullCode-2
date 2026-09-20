import { readCache, writeCache } from './cacheStore.js';
import { readSyncQueue } from './syncStore.js';
import { isPosCreateOrderQueueItem } from './syncShared.js';

function normalizeInventoryStockValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function buildPosMenuIndex(menuRows = []) {
  const byId = new Map();
  for (const row of Array.isArray(menuRows) ? menuRows : []) {
    if (row?.id) byId.set(String(row.id), row);
  }
  return byId;
}

export function buildInventoryNameIndex(inventoryRows = []) {
  const byName = new Map();
  for (const row of Array.isArray(inventoryRows) ? inventoryRows : []) {
    const key = String(row?.name || '').trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }
  return byName;
}

function resolveQueuedPosInventoryLink(entry = {}, { outletId = null } = {}) {
  // Legacy single-line path: reads caches once per call. Hot paths below pass
  // prebuilt indexes via resolveQueuedPosInventoryLinkIndexed instead, so a
  // 30k-order projection does not re-parse pos-menu-items.json per line.
  const menuRows = entry?.menu_item_id ? readCache('pos-menu-items') : [];
  const menuById = entry?.menu_item_id ? buildPosMenuIndex(menuRows) : new Map();
  const inventoryRows = entry?.item_name && !entry?.inventory_item_id && !entry?.menu_item_id ? readCache('inventory-items') : [];
  return resolveQueuedPosInventoryLinkIndexed(entry, {
    outletId,
    menuById,
    inventoryByName: inventoryRows.length > 0 ? buildInventoryNameIndex(inventoryRows) : new Map()
  });
}

export function resolveQueuedPosInventoryLinkIndexed(entry = {}, { outletId = null, menuById = new Map(), inventoryByName = new Map() } = {}) {
  if (entry.inventory_item_id) {
    return {
      inventoryItemId: entry.inventory_item_id,
      depletionQty: normalizePositiveQty(entry.depletion_qty, 1)
    };
  }

  if (entry.menu_item_id && menuById && typeof menuById.get === 'function') {
    const menuItem = menuById.get(String(entry.menu_item_id));
    if (menuItem?.inventory_item_id) {
      return {
        inventoryItemId: menuItem.inventory_item_id,
        depletionQty: normalizePositiveQty(menuItem.depletion_qty, 1)
      };
    }
  }

  const itemName = String(entry.item_name || '').trim().toLowerCase();
  if (!itemName) return { inventoryItemId: null, depletionQty: normalizePositiveQty(entry.depletion_qty, 1) };
  const matches = (inventoryByName?.get?.(itemName) || []).filter((item) =>
  !outletId || !item?.outlet_id || item.outlet_id === outletId
  );
  return {
    inventoryItemId: matches.length === 1 ? matches[0].id : null,
    depletionQty: normalizePositiveQty(entry.depletion_qty, 1)
  };
}

function buildQueuedPosInventoryUsage(items = [], { outletId = null, menuById = null, inventoryByName = null } = {}) {
  const usage = new Map();
  // Index once per batch so thousands of queued lines do not re-read cache
  // files per line (previously one full pos-menu-items.json parse per line).
  const sharedMenuById = menuById || buildPosMenuIndex(readCache('pos-menu-items'));
  const sharedNameIndex = inventoryByName || buildInventoryNameIndex(readCache('inventory-items'));
  for (const entry of items || []) {
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

function buildIndexedOrderUsage(items = [], { outletId = null, menuById, inventoryByName } = {}) {
  const usage = new Map();
  for (const entry of items || []) {
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
export function collectQueuedBarStockDeltas(queueItems = []) {
  const deliveryDeltas = new Map();
  const adjustDeltas = new Map();
  const purchaseDeltas = new Map();
  const countOverrides = new Map();
  const touched = new Set();
  for (const item of Array.isArray(queueItems) ? queueItems : []) {
    if (item?.type !== 'rpc') continue;
    if (item.table === 'post_bar_simple_delivery') {
      for (const line of Array.isArray(item?.data?.p_lines) ? item.data.p_lines : []) {
        const id = String(line?.item_id || '').trim();
        const qty = Number(line?.quantity || 0);
        if (!id || !Number.isFinite(qty) || qty <= 0) continue;
        deliveryDeltas.set(id, (deliveryDeltas.get(id) || 0) + qty);
        touched.add(id);
      }
    } else if (item.table === 'post_bar_physical_count') {
      for (const line of Array.isArray(item?.data?.p_lines) ? item.data.p_lines : []) {
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
      const payload = item?.data?.payload || {};
      const id = String(payload?.item_id || '').trim();
      const qty = Number(payload?.quantity_purchased || 0);
      if (!id || !Number.isFinite(qty) || qty <= 0) continue;
      purchaseDeltas.set(id, (purchaseDeltas.get(id) || 0) + qty);
      touched.add(id);
    }
  }
  return { deliveryDeltas, adjustDeltas, purchaseDeltas, countOverrides, touched };
}

export function getOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  return [...buildQueuedPosInventoryUsage(items, { outletId }).entries()].
  map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }));
}

function buildDayUseInventoryUsage(extras = []) {
  const usage = new Map();
  for (const entry of extras || []) {
    const inventoryItemId = entry?.inventory_item_id || null;
    if (!inventoryItemId) continue;
    const quantity = Math.max(0, Number(entry.quantity || 0));
    if (!quantity) continue;
    usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity);
  }
  return usage;
}

export function getOfflineDayUseInventoryReservation(extras = []) {
  return [...buildDayUseInventoryUsage(extras).entries()].
  map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }));
}

export function applyOfflineDayUseInventoryReservation(extras = []) {
  const usage = buildDayUseInventoryUsage(extras);
  if (usage.size === 0) return [];
  const inventory = readCache('inventory-items');
  const next = inventory.map((item) => {
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

export function restoreOfflineDayUseInventoryReservation(extras = []) {
  const usage = buildDayUseInventoryUsage(extras);
  if (usage.size === 0) return [];
  const inventory = readCache('inventory-items');
  const next = inventory.map((item) => {
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

export function applyOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  const usage = buildQueuedPosInventoryUsage(items, { outletId });
  if (usage.size === 0) return [];
  refreshOfflinePosInventoryProjection();
  return getOfflinePosInventoryReservation(items, { outletId });
}

export function restoreOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  // Pending voids and returns must never make stock sellable. The authoritative
  // server refresh after a successful RPC applies the restoration.
  return getOfflinePosInventoryReservation(items, { outletId });
}

export function readLocalPosVoidHistory() {
  return readCache('pos-void-history');
}

function writeLocalPosVoidHistory(rows = []) {
  writeCache('pos-void-history', rows);
}

export function upsertLocalPosVoidHistory(entry = {}) {
  if (!entry?.id && !entry?.order_id) return null;
  const rows = readLocalPosVoidHistory();
  const normalized = {
    ...entry,
    id: entry.id || `local-void-${entry.order_id}-${Date.now()}`,
    action: entry.action || 'void',
    created_at: entry.created_at || new Date().toISOString()
  };
  const next = [
  normalized,
  ...rows.filter((row) => row?.id !== normalized.id && row?.order_id !== normalized.order_id)];

  writeLocalPosVoidHistory(next);
  return normalized;
}

export function patchLocalPosVoidHistory(logId, patch = {}) {
  if (!logId) return false;
  const rows = readLocalPosVoidHistory();
  const index = rows.findIndex((row) => row?.id === logId);
  if (index < 0) return false;
  const next = [...rows];
  next[index] = { ...next[index], ...patch };
  writeLocalPosVoidHistory(next);
  return true;
}

// Manager-reviewed discard of orphaned local void records (see
// discardLocalPosVoidRecord in pos.js for the eligibility gates). Removes
// only the listed local rows; server data is never touched here.
export function removeLocalPosVoidHistory(logIds = []) {
  const ids = new Set((Array.isArray(logIds) ? logIds : [logIds]).map((value) => String(value || '').trim()).filter(Boolean));
  if (ids.size === 0) return 0;
  const rows = readLocalPosVoidHistory();
  const next = rows.filter((row) => !ids.has(String(row?.id || '')));
  const removed = rows.length - next.length;
  if (removed > 0) writeLocalPosVoidHistory(next);
  return removed;
}

export function applyQueuedPosInventoryReservations(remoteInventoryRows = []) {
  const rows = Array.isArray(remoteInventoryRows) ? remoteInventoryRows : [];
  if (rows.length === 0) return rows;
  // Single-parse inputs: one queue read + one menu read per computation, with
  // shared indexes for every queued line (previously one full file parse per
  // line, which blocked the main thread for seconds at 10k+ orders).
  const queue = readSyncQueue();
  const menuById = buildPosMenuIndex(readCache('pos-menu-items'));
  const inventoryByName = buildInventoryNameIndex(rows);
  const { deliveryDeltas, adjustDeltas, purchaseDeltas, countOverrides, touched: batchTouched } = collectQueuedBarStockDeltas(queue);

  // Fold the queue in order so count absolutes win over earlier deliveries in
  // the same outage, while additive batches simply accumulate.
  const projected = new Map();
  const baseById = new Map();
  for (const row of rows) {
    if (!row?.id) continue;
    baseById.set(String(row.id), normalizeInventoryStockValue(row.synced_current_stock ?? row.current_stock));
  }
  for (const [id, base] of baseById.entries()) projected.set(id, base);
  for (const [id, actual] of countOverrides.entries()) {
    if (baseById.has(id)) projected.set(id, actual);
  }
  const addDelta = (map) => {
    for (const [id, delta] of map.entries()) {
      if (!baseById.has(id)) continue;
      projected.set(id, (projected.get(id) ?? baseById.get(id) ?? 0) + delta);
    }
  };
  addDelta(deliveryDeltas);
  addDelta(adjustDeltas);
  addDelta(purchaseDeltas);
  const salesUsage = new Map();
  const touched = new Set(batchTouched);
  for (const item of queue) {
    if (!isPosCreateOrderQueueItem(item)) continue;
    const payload = item?.data?.payload || {};
    const orderUsage = buildIndexedOrderUsage(payload.items || [], { outletId: payload.outlet_id || null, menuById, inventoryByName });
    for (const [inventoryItemId, quantity] of orderUsage.entries()) {
      salesUsage.set(inventoryItemId, (salesUsage.get(inventoryItemId) || 0) + quantity);
      touched.add(inventoryItemId);
    }
  }
  for (const [id, used] of salesUsage.entries()) {
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
  const inventory = readCache('inventory-items');
  const projected = applyQueuedPosInventoryReservations(inventory);
  writeCache('inventory-items', projected, { source: 'local-projection' });
  return projected;
}

export function applyQueuedDayUseInventoryReservations(remoteInventoryRows = []) {
  const queuedItems = readSyncQueue().filter((item) =>
  item?.type === 'rpc' && ['add_pool_day_use', 'delete_pool_day_use'].includes(item?.table)
  );
  if (queuedItems.length === 0) return remoteInventoryRows || [];

  const usage = new Map();
  for (const item of queuedItems) {
    const payload = item?.data?.payload || {};
    const extras = Array.isArray(payload?.extras) ? payload.extras : Array.isArray(item?._inventory_extras) ? item._inventory_extras : [];
    const extraUsage = buildDayUseInventoryUsage(extras);
    for (const [inventoryItemId, quantity] of extraUsage.entries()) {
      const multiplier = item?.table === 'delete_pool_day_use' ? -1 : 1;
      usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity * multiplier);
    }
  }

  return (remoteInventoryRows || []).map((row) => {
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
