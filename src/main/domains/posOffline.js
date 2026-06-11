import { readCache, writeCache } from './cacheStore.js';
import { readSyncQueue } from './syncStore.js';
import { isPosCreateOrderQueueItem, isPosVoidQueueItem } from './syncShared.js';

function normalizeInventoryStockValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveQueuedPosInventoryLink(entry = {}, { outletId = null } = {}) {
  if (entry.inventory_item_id) {
    return {
      inventoryItemId: entry.inventory_item_id,
      depletionQty: normalizePositiveQty(entry.depletion_qty, 1)
    };
  }

  const menuItem = entry.menu_item_id ?
  readCache('pos-menu-items').find((item) => item?.id === entry.menu_item_id) :
  null;
  if (menuItem?.inventory_item_id) {
    return {
      inventoryItemId: menuItem.inventory_item_id,
      depletionQty: normalizePositiveQty(menuItem.depletion_qty, 1)
    };
  }

  const itemName = String(entry.item_name || '').trim().toLowerCase();
  if (!itemName) return { inventoryItemId: null, depletionQty: normalizePositiveQty(entry.depletion_qty, 1) };
  const matches = readCache('inventory-items').filter((item) =>
  String(item?.name || '').trim().toLowerCase() === itemName && (
  !outletId || !item?.outlet_id || item.outlet_id === outletId)
  );
  return {
    inventoryItemId: matches.length === 1 ? matches[0].id : null,
    depletionQty: normalizePositiveQty(entry.depletion_qty, 1)
  };
}

function buildQueuedPosInventoryUsage(items = [], { outletId = null } = {}) {
  const usage = new Map();
  for (const entry of items || []) {
    const link = resolveQueuedPosInventoryLink(entry, { outletId });
    const inventoryItemId = link.inventoryItemId;
    const depletionQty = link.depletionQty;
    if (!inventoryItemId) continue;
    const quantity = Number(entry.quantity || 0);
    if (!quantity) continue;
    usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity * normalizePositiveQty(depletionQty, 1));
  }
  return usage;
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
  return getOfflinePosInventoryReservation(items, { outletId });
}

export function restoreOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  const usage = buildQueuedPosInventoryUsage(items, { outletId });
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
  return [...usage.entries()].map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }));
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

export function applyQueuedPosInventoryReservations(remoteInventoryRows = []) {
  const queuedItems = readSyncQueue().filter((item) => isPosCreateOrderQueueItem(item) || isPosVoidQueueItem(item));
  if (queuedItems.length === 0) return remoteInventoryRows || [];

  const usage = new Map();
  for (const item of queuedItems) {
    const payload = item?.data?.payload || {};
    const orderUsage = buildQueuedPosInventoryUsage(payload.items || [], { outletId: payload.outlet_id || null });
    for (const [inventoryItemId, quantity] of orderUsage.entries()) {
      const multiplier = isPosVoidQueueItem(item) ? -1 : 1;
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
