import { randomUUID } from 'crypto'
import { state } from '../state.js'
import { recordCriticalError } from './operationalLog.js'
import {
  applyQueuedDayUseInventoryReservations,
  applyQueuedPosInventoryReservations,
  queueOperation,
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js'
import { mergeRemoteInventoryWithLocalState } from './inventoryMerge.js'
import {
  patchQueuedInventoryDraftPayload,
  removeQueuedInventoryDraft
} from './inventoryDrafts.js'
import {
  readFailedSyncQueue,
  readSyncQueue,
  writeFailedSyncQueue,
  writeSyncQueue
} from './syncStore.js'
import { parseOptionalNonNegativeCost } from '../../shared/inventoryStockForm.js'
import { normalizeBarcode } from '../../shared/barcodeScanner.js'

// ─── INVENTORY ────────────────────────────────────────────────────────────────

const INVENTORY_MOVEMENTS_CACHE = 'inventory-movements';
const INVENTORY_ITEM_SELECT = 'id, name, category, unit, current_stock, reorder_level, selling_price, outlet_id, latest_unit_cost, lodge_id, created_at, updated_at, sku, barcode, is_active';
const INVENTORY_ITEM_LEGACY_SELECT = 'id, name, category, unit, current_stock, reorder_level, selling_price, outlet_id, latest_unit_cost, lodge_id, created_at';
const INVENTORY_PURCHASE_SELECT = 'id, item_id, quantity_purchased, unit_cost, total_cost, supplier, date, notes, lodge_id, created_at, updated_at';
const INVENTORY_PURCHASE_EVIDENCE_SELECT = `${INVENTORY_PURCHASE_SELECT}, operation_id, payload_hash, source_document_type, source_document_id, lot_id, valuation_method, evidence_ref`;

function withReadMetadata(rows, source, complete) {
  const result = Array.isArray(rows) ? rows : [];
  Object.defineProperties(result, {
    _source: { value: source, enumerable: true, configurable: true },
    _complete: { value: complete === true, enumerable: true, configurable: true }
  });
  return result;
}

function isMissingInventoryCompatibilityColumnError(error) {
  return /column\s+inventory_items\.(barcode|is_active|sku|updated_at)\s+does\s+not\s+exist/i.test(String(error?.message || ''));
}

async function selectInventoryItems(selectColumns = INVENTORY_ITEM_SELECT, from = 0, pageSize = 500) {
  return state.supabase.
  from('inventory_items').
  select(selectColumns).
  eq('lodge_id', state.lodgeId).
  order('category').
  order('name').
  range(from, from + pageSize - 1);
}

function normalizeStockNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function readOptionalUnitCost(data = {}) {
  if (!Object.prototype.hasOwnProperty.call(data, 'unit_cost')) return undefined
  const parsed = parseOptionalNonNegativeCost(data.unit_cost)
  if (!parsed.ok) throw new Error('Unit cost must be a finite non-negative number, or blank to keep the current cost.')
  return parsed.value
}

/**
 * Barcodes are identifiers, not numbers: preserve leading zeroes and reject
 * control characters/overlong values before they reach the RPC or offline
 * queue. `undefined` means the caller did not intend to change the barcode;
 * `null` is an explicit clear operation.
 */
function readOptionalBarcode(data = {}) {
  if (!Object.prototype.hasOwnProperty.call(data, 'barcode')) return undefined
  if (data.barcode == null || String(data.barcode).trim() === '') return null
  const raw = String(data.barcode).trim()
  const normalized = normalizeBarcode(raw)
  if (!normalized || normalized !== raw) {
    throw new Error('Barcode must be 1–128 characters without control characters.')
  }
  return normalized
}

function movementSort(a, b) {
  return String(b.created_at || b.date || '').localeCompare(String(a.created_at || a.date || ''));
}

function localDateBoundary(value, endExclusive = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const boundary = new Date(`${value}T00:00:00`);
  if (endExclusive) boundary.setDate(boundary.getDate() + 1);
  return boundary.toISOString();
}

function filterMovementsByDate(rows = [], startDate, endDate) {
  const start = localDateBoundary(startDate);
  const end = localDateBoundary(endDate, true);
  return rows.filter((row) => {
    const createdAt = String(row?.created_at || '');
    return (!start || createdAt >= start) && (!end || createdAt < end);
  });
}

function movementIdentity(row = {}) {
  if (row.reference_type && row.reference_id && row.item_id && row.movement_type) {
    return `${row.reference_type}:${row.reference_id}:${row.item_id}:${row.movement_type}`;
  }
  return row.id || `${row.item_id}:${row.movement_type}:${row.created_at || row.date || ''}:${row.quantity || 0}`;
}

function readInventoryMovementsCache() {
  const rows = readCache(INVENTORY_MOVEMENTS_CACHE);
  return Array.isArray(rows) ? rows : [];
}

function writeInventoryMovementsCache(rows = []) {
  writeCache(INVENTORY_MOVEMENTS_CACHE, rows.slice(0, 1000));
}

function removeInventoryDraftFromQueues(id) {
  const activeQueue = readSyncQueue();
  const nextActive = removeQueuedInventoryDraft(activeQueue, id);
  if (nextActive.removed) writeSyncQueue(nextActive.queue);

  const failedQueue = readFailedSyncQueue();
  const nextFailed = removeQueuedInventoryDraft(failedQueue, id);
  if (nextFailed.removed) writeFailedSyncQueue(nextFailed.queue);
}

function upsertLocalInventoryMovement(entry = {}) {
  if (!entry?.item_id || !entry?.movement_type) return null;
  const row = {
    id: entry.id || randomUUID(),
    lodge_id: state.lodgeId,
    item_id: entry.item_id,
    movement_type: entry.movement_type,
    quantity: normalizeStockNumber(entry.quantity),
    unit_cost: normalizeStockNumber(entry.unit_cost),
    total_cost: normalizeStockNumber(entry.total_cost),
    notes: entry.notes || null,
    reference_type: entry.reference_type || null,
    reference_id: entry.reference_id || null,
    operation_id: entry.operation_id || entry.id || null,
    source_document_type: entry.source_document_type || entry.reference_type || null,
    source_document_id: entry.source_document_id || entry.reference_id || null,
    valuation_method: entry.valuation_method || 'unknown_legacy',
    payload_hash: entry.payload_hash || null,
    source: entry.source || 'local',
    created_by: entry.created_by || state.currentUser?.id || null,
    created_by_name: entry.created_by_name || state.currentUser?.name || null,
    created_at: entry.created_at || new Date().toISOString(),
    _pending_sync: entry._pending_sync === true,
    _sync_state: entry._sync_state || (entry._pending_sync ? 'pending' : 'synced')
  };
  const current = readInventoryMovementsCache();
  const next = [
    row,
    ...current.filter((existing) =>
      existing?.id !== row.id &&
      !(row.reference_type && row.reference_id && existing?.reference_type === row.reference_type && existing?.reference_id === row.reference_id && existing?.item_id === row.item_id && existing?.movement_type === row.movement_type)
    )
  ].sort(movementSort);
  writeInventoryMovementsCache(next);
  return row;
}

async function _getInventoryItems(options = {}) {
  const exportAll = options?.export_all === true || options?.exportAll === true;
  const pageSize = exportAll ? 1000 : 500;
  const maxRows = exportAll ? 100000 : pageSize;
  if (state.isOnline) {
    const liveRows = [];
    let error = null;
    let legacyShape = false;
    for (let from = 0; from < maxRows; from += pageSize) {
      let result = await selectInventoryItems(legacyShape ? INVENTORY_ITEM_LEGACY_SELECT : INVENTORY_ITEM_SELECT, from, pageSize);
      if (result.error && !legacyShape && isMissingInventoryCompatibilityColumnError(result.error)) {
        console.warn('inventory_items compatibility columns are missing in the remote schema; loading inventory with defaults until the migration is applied');
        legacyShape = true;
        result = await selectInventoryItems(INVENTORY_ITEM_LEGACY_SELECT, from, pageSize);
      }
      error = result.error;
      if (error) break;
      const page = result.data || [];
      liveRows.push(...page.map((row) => legacyShape ? {
        ...row,
        updated_at: row.updated_at || row.created_at || null,
        sku: null,
        barcode: null,
        is_active: true
      } : row));
      if (!exportAll || page.length < pageSize) break;
    }
    const data = liveRows;
    if (!error) {
      if (!data || data.length === 0) {
        const cached = readCache('inventory-items');
        if (cached.length > 0) {
          console.warn('getInventoryItems received empty live result; using cached inventory items instead');
          return withReadMetadata(cached.filter((row) => row?._deleted_offline !== true), 'cache', false);
        }
      }
      const liveRows = applyQueuedDayUseInventoryReservations(applyQueuedPosInventoryReservations(data || []));
      // Merge with local state to preserve any pending-sync or failed items
      const merged = mergeRemoteInventoryWithLocalState(liveRows);
      writeCache('inventory-items', merged);
      return withReadMetadata(
        merged,
        'server',
        liveRows.length < maxRows && !legacyShape && merged.every((row) => row?._pending_sync !== true && row?._sync_state !== 'pending')
      );
    }
    const cached = readCache('inventory-items');
    if (cached.length > 0) {
      console.warn('getInventoryItems falling back to cache:', error.message);
      return withReadMetadata(cached.filter((row) => row?._deleted_offline !== true), 'cache', false);
    }
    throw new Error(error.message);
  }
  return withReadMetadata(readCache('inventory-items').filter((row) => row?._deleted_offline !== true), 'offline-cache', false);
}

export function getInventoryItems(options = {}) {
  const exportAll = options?.export_all === true || options?.exportAll === true;
  return dedupePromise(`getInventoryItems:${exportAll ? 'export' : 'screen'}`, () => _getInventoryItems(options));
}

/**
 * Return the server-authoritative Bar Base stock-age projection.  Unlike the
 * general movement history this intentionally has no cache fallback: an age
 * bucket is an operational signal and must never be presented as current when
 * the ledger read failed or the device is offline.
 */
export async function getBarStockAging(outletId = null) {
  if (!state.isOnline) throw new Error('Stock aging requires an online connection.');
  const { data, error } = await state.supabase.rpc('get_bar_stock_aging', {
    p_lodge_id: state.lodgeId,
    p_outlet_id: outletId || null
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function getDayUseInventoryItems() {
  const rows = await getInventoryItems().catch(() => readCache('inventory-items'));
  return (rows || []).filter((item) => !item?.outlet_id);
}

export async function getInventoryItemById(id) {
  if (!id) return null;
  try {
    const { data, error } = await state.supabase.
    from('inventory_items').
    select('*').
    eq('id', id).
    eq('lodge_id', state.lodgeId).
    single();
    if (error) throw error;
    return data || null;
  } catch {
    return readCache('inventory-items').find((item) => item.id === id) || null;
  }
}

export async function createInventoryItem(data) {
  const id = randomUUID();
  const unitCost = readOptionalUnitCost(data)
  const barcode = readOptionalBarcode(data)
  const item = {
    id,
    lodge_id: state.lodgeId,
    name: data.name,
    category: data.category || 'Bar',
    unit: data.unit || 'unit',
    current_stock: Number(data.current_stock) || 0,
    reorder_level: Number(data.reorder_level) || 0,
    latest_unit_cost: unitCost ?? 0,
    selling_price: Number(data.selling_price) || 0,
    outlet_id: data.outlet_id || null,
    barcode: barcode ?? null
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_inventory_item', { payload: item });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create inventory item');
    const cached = readCache('inventory-items');
    const savedId = result?.id || id;
    writeCache('inventory-items', [...cached, { ...item, id: savedId }]);
    if (Number(item.current_stock || 0) > 0) {
      upsertLocalInventoryMovement({
        item_id: savedId,
        movement_type: 'opening_stock',
        quantity: item.current_stock,
        notes: 'Opening stock recorded when product was created',
        reference_type: 'inventory_item',
        reference_id: savedId,
        source: 'inventory'
      });
    }
    return { success: true, id: result?.id };
  }
  // Offline: write to cache optimistically and queue the RPC for later replay
  const cached = readCache('inventory-items');
  const newItem = { ...item, _pending_sync: true, created_at: new Date().toISOString() };
  writeCache('inventory-items', [...cached, newItem]);
  if (Number(item.current_stock || 0) > 0) {
    upsertLocalInventoryMovement({
      item_id: id,
      movement_type: 'opening_stock',
      quantity: item.current_stock,
      notes: 'Opening stock recorded while offline',
      reference_type: 'inventory_item',
      reference_id: id,
      source: 'inventory',
      _pending_sync: true,
      _sync_state: 'pending'
    });
  }
  queueOperation('rpc', 'create_inventory_item', { payload: item }, null, {
    _queue_id: `inventory-item-${id}`
  });
  return { success: true, id, offline: true };
}

export async function updateInventoryItem(id, data) {
  const unitCost = readOptionalUnitCost(data)
  const barcode = readOptionalBarcode(data)
  const update = {
    name: data.name,
    category: data.category,
    unit: data.unit,
    reorder_level: Number(data.reorder_level) || 0,
    ...(unitCost === undefined ? {} : { latest_unit_cost: unitCost }),
    ...(Object.prototype.hasOwnProperty.call(data, 'selling_price') ?
    { selling_price: Number(data.selling_price) || 0 } :
    {}),
    ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {}),
    ...(barcode !== undefined ? { barcode } : {})
  };
  const cached = readCache('inventory-items') || [];
  const existing = cached.find((row) => row.id === id);
  if (existing && existing._pending_sync) {
    const updatedRow = { ...existing, ...update };
    writeCache('inventory-items', cached.map((row) => row.id === id ? updatedRow : row));

    const activeQueue = readSyncQueue();
    const patchedActiveQueue = patchQueuedInventoryDraftPayload(activeQueue, id, update);
    if (patchedActiveQueue.updated) {
      writeSyncQueue(patchedActiveQueue.queue);
    }

    const failedQueue = readFailedSyncQueue();
    const patchedFailedQueue = patchQueuedInventoryDraftPayload(failedQueue, id, update);
    if (patchedFailedQueue.updated) {
      writeFailedSyncQueue(patchedFailedQueue.queue);
    }

    return { success: true };
  }

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_inventory_item', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update inventory item');
    if (unitCost !== undefined) {
      const { data: costResult, error: costError } = await state.supabase.rpc('set_inventory_unit_cost', {
        p_item_id: id, p_lodge_id: state.lodgeId, p_unit_cost: unitCost
      });
      if (costError) throw new Error(costError.message);
      if (!costResult?.success) throw new Error(costResult?.error || 'Could not update the unit cost');
    }
    const cached = readCache('inventory-items');
    writeCache('inventory-items', cached.map((row) => row.id === id ? { ...row, ...update } : row));
    return { success: true };
  }
  if (!existing) return { success: false, error: 'Inventory item not found in offline cache' };
  writeCache('inventory-items', cached.map((row) => row.id === id ? {
    ...row,
    ...update,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  } : row));
  queueOperation('rpc', 'update_inventory_item', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    payload: update
  }, null, {
    _queue_id: `inventory-item-update-${id}-${Date.now()}`
  });
  return { success: true, offline: true, queued: true };
}

export async function deleteInventoryItem(id) {
  if (!state.isOnline) {
    const cached = readCache('inventory-items');
    const existing = cached.find((row) => row?.id === id);
    if (!existing) return { success: false, error: 'Inventory item not found in offline cache' };
    if (existing._pending_sync) {
      removeInventoryDraftFromQueues(id);
      writeCache('inventory-items', cached.filter((row) => row.id !== id));
      writeCache('inventory-purchases', readCache('inventory-purchases').filter((row) => row.item_id !== id));
      return { success: true, offline: true, queued: false };
    }
    writeCache('inventory-items', cached.map((row) => row.id === id ? {
      ...row,
      _deleted_offline: true,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null,
      updated_at: new Date().toISOString()
    } : row));
    queueOperation('rpc', 'delete_inventory_item', {
      p_id: id,
      p_lodge_id: state.lodgeId
    }, null, {
      _queue_id: `inventory-item-delete-${id}-${Date.now()}`
    });
    return { success: true, offline: true, queued: true };
  }
  const { data: result, error } = await state.supabase.rpc('delete_inventory_item', {
    p_id: id,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not delete inventory item');
  writeCache('inventory-items', readCache('inventory-items').filter((row) => row.id !== id));
  writeCache('inventory-purchases', readCache('inventory-purchases').filter((row) => row.item_id !== id));
  return { success: true };
}

export async function addInventoryPurchase(data) {
  const qty = Number(data.quantity_purchased);
  const cost = Number(data.total_cost);
  const unitCost = qty > 0 ? cost / qty : 0;
  const id = data.id || randomUUID();

  const purchase = {
    id,
    lodge_id: state.lodgeId,
    item_id: data.item_id,
    date: data.date,
    quantity_purchased: qty,
    total_cost: cost,
    unit_cost: unitCost,
    notes: data.notes || null,
    source_document_type: data.source_document_type || 'inventory_purchase',
    source_document_id: data.source_document_id || id,
    evidence_ref: data.evidence_ref || data.receipt_reference || null,
    lot_id: data.lot_id || null,
    valuation_method: data.valuation_method || 'weighted_average',
    operation_id: id
  };
  if (!state.isOnline) {
    const items = readCache('inventory-items');
    const item = items.find((row) => row?.id === data.item_id);
    if (!item) return { success: false, error: 'Inventory item not found on this computer.' };
    writeCache('inventory-items', items.map((row) => row.id === data.item_id ?
    {
      ...row,
      current_stock: Number(row.current_stock || 0) + qty,
      latest_unit_cost: unitCost,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null,
      updated_at: new Date().toISOString()
    } :
    row
    ));
    const cachedPurchases = readCache('inventory-purchases');
    writeCache('inventory-purchases', [
    { ...purchase, _pending_sync: true, _sync_state: 'pending', _sync_error: null, created_at: new Date().toISOString() },
    ...cachedPurchases.filter((row) => row?.id !== id)]
    );
    upsertLocalInventoryMovement({
      id,
      item_id: data.item_id,
      movement_type: 'purchase',
      quantity: qty,
      unit_cost: unitCost,
      total_cost: cost,
      notes: purchase.notes,
      reference_type: 'inventory_purchase',
      reference_id: id,
      source: 'purchase',
      operation_id: id,
      source_document_type: purchase.source_document_type,
      source_document_id: purchase.source_document_id,
      valuation_method: purchase.valuation_method,
      created_at: purchase.date ? `${purchase.date}T12:00:00.000Z` : new Date().toISOString(),
      _pending_sync: true,
      _sync_state: 'pending'
    });
    queueOperation('rpc', 'add_inventory_purchase', { payload: purchase }, null, {
      _queue_id: `inventory-purchase-${id}`,
      ...(item?._pending_sync ? { _depends_on: `inventory-item-${data.item_id}` } : {})
    });
    return { success: true, id, unit_cost: unitCost, new_stock: Number(item.current_stock || 0) + qty, offline: true, queued: true };
  }
  const { data: result, error } = await state.supabase.rpc('add_inventory_purchase', { payload: purchase });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not record inventory purchase');
  const items = readCache('inventory-items');
  writeCache('inventory-items', items.map((row) => row.id === data.item_id ?
  {
    ...row,
    current_stock: Number(row.current_stock || 0) + qty,
    latest_unit_cost: unitCost
  } :
  row
  ));
  const cachedPurchases = readCache('inventory-purchases');
  writeCache('inventory-purchases', [
  { ...purchase, id: result?.id || `local-${Date.now()}` },
  ...cachedPurchases]
  );
  upsertLocalInventoryMovement({
    id: result?.id || id,
    item_id: data.item_id,
    movement_type: 'purchase',
    quantity: qty,
    unit_cost: unitCost,
    total_cost: cost,
    notes: purchase.notes,
    reference_type: 'inventory_purchase',
    reference_id: result?.id || null,
    source: 'purchase',
    operation_id: purchase.operation_id,
    source_document_type: purchase.source_document_type,
    source_document_id: purchase.source_document_id,
    valuation_method: purchase.valuation_method,
    created_at: purchase.date ? `${purchase.date}T12:00:00.000Z` : new Date().toISOString()
  });
  return { success: true };
}

export async function getInventoryPurchases(itemId) {
  const cached = readCache('inventory-purchases').filter((row) => row.item_id === itemId && row?._deleted_offline !== true);
  if (!state.isOnline) {
    return withReadMetadata(cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), 'cache', false);
  }

  try {
    let { data, error } = await state.supabase.
    from('inventory_purchases').
    select(INVENTORY_PURCHASE_EVIDENCE_SELECT).
    eq('lodge_id', state.lodgeId).
    eq('item_id', itemId).
    order('date', { ascending: false }).
    limit(200);
    if (error && /column|schema cache|PGRST/i.test(String(error.message || error))) {
      const legacyResult = await state.supabase.from('inventory_purchases').select(INVENTORY_PURCHASE_SELECT).eq('lodge_id', state.lodgeId).eq('item_id', itemId).order('date', { ascending: false }).limit(200);
      data = legacyResult.data;
      error = legacyResult.error;
    }
    if (error) throw error;

    const liveRows = Array.isArray(data) ? data : [];
    const otherCachedRows = readCache('inventory-purchases').filter((row) => row.item_id !== itemId);
    if (liveRows.length === 0 && cached.length > 0) {
      console.warn('getInventoryPurchases received empty live result; using cached purchases instead');
      return withReadMetadata(cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), 'cache', false);
    }

    writeCache('inventory-purchases', [...liveRows, ...otherCachedRows]);
    return withReadMetadata(liveRows, 'server', liveRows.every((row) => row.operation_id && row.source_document_type && row.payload_hash && row.valuation_method !== 'unknown_legacy'));
  } catch (error) {
    if (cached.length > 0) {
      console.warn('getInventoryPurchases falling back to cache:', error.message);
      return withReadMetadata(cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), 'cache', false);
    }
    throw new Error(error.message);
  }
}

export async function getAllInventoryPurchases() {
  const cached = readCache('inventory-purchases').filter((row) => row?._deleted_offline !== true);
  if (!state.isOnline) {
    return withReadMetadata(cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), 'cache', false);
  }

  try {
    const liveRows = [];
    let legacyShape = false;
    for (let from = 0; from < 100000; from += 500) {
      let query = state.supabase.
      from('inventory_purchases').
      select(legacyShape ? INVENTORY_PURCHASE_SELECT : INVENTORY_PURCHASE_EVIDENCE_SELECT).
      eq('lodge_id', state.lodgeId).
      order('date', { ascending: false }).
      range(from, from + 499);
      let { data, error } = await query;
      if (error && !legacyShape && /column|schema cache|PGRST/i.test(String(error.message || error))) {
        legacyShape = true;
        const legacyResult = await state.supabase.from('inventory_purchases').select(INVENTORY_PURCHASE_SELECT).eq('lodge_id', state.lodgeId).order('date', { ascending: false }).range(from, from + 499);
        data = legacyResult.data;
        error = legacyResult.error;
      }
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      liveRows.push(...page);
      if (page.length < 500) break;
    }
    if (liveRows.length === 0 && cached.length > 0) {
      console.warn('getAllInventoryPurchases received empty live result; using cached purchases instead');
      return withReadMetadata(cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), 'cache', false);
    }
    writeCache('inventory-purchases', liveRows);
    return withReadMetadata(
      liveRows,
      'server',
      liveRows.length < 100000 && !legacyShape && liveRows.every((row) => row.operation_id && row.source_document_type && row.payload_hash && row.valuation_method !== 'unknown_legacy')
    );
  } catch (error) {
    if (cached.length > 0) {
      console.warn('getAllInventoryPurchases falling back to cache:', error?.message || error);
      return withReadMetadata(cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), 'cache', false);
    }
    throw new Error(error?.message || 'Failed to load inventory purchases');
  }
}

export async function adjustInventoryStock(itemId, delta, notes, operationId = null) {
  const numericDelta = Number(delta);
  if (!Number.isFinite(numericDelta) || numericDelta === 0) {
    return { success: false, error: 'Enter a non-zero stock adjustment.' };
  }
  const adjustmentId = operationId || randomUUID();
  const cached = readCache('inventory-items');
  const existing = cached.find((row) => row.id === itemId);

  if (!state.isOnline) {
    if (!existing) return { success: false, error: 'Inventory item not found on this computer.' };
    const newStock = Math.max(0, normalizeStockNumber(existing.current_stock) + numericDelta);
    writeCache('inventory-items', cached.map((row) => row.id === itemId ?
    {
      ...row,
      current_stock: newStock,
      _pending_sync: true,
      _sync_state: 'pending'
    } :
    row
    ));
    upsertLocalInventoryMovement({
      id: adjustmentId,
      item_id: itemId,
      movement_type: numericDelta >= 0 ? 'adjustment_increase' : 'adjustment_decrease',
      quantity: numericDelta,
      unit_cost: existing.latest_unit_cost || 0,
      total_cost: numericDelta * Number(existing.latest_unit_cost || 0),
      notes: notes || null,
      reference_type: 'inventory_adjustment',
      reference_id: adjustmentId,
      source: 'adjustment',
      _pending_sync: true,
      _sync_state: 'pending'
    });
    queueOperation('rpc', 'adjust_inventory_stock', {
      p_item_id: itemId,
      p_lodge_id: state.lodgeId,
      p_delta: numericDelta,
      p_notes: notes || null,
      p_adjustment_id: adjustmentId
    }, null, {
      _queue_id: `inventory-adjust-${adjustmentId}`
    });
    return { success: true, new_stock: newStock, offline: true };
  }

  const { data: result, error } = await state.supabase.rpc('adjust_inventory_stock', {
    p_item_id: itemId,
    p_lodge_id: state.lodgeId,
    p_delta: numericDelta,
    p_notes: notes || null,
    p_adjustment_id: adjustmentId
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not adjust inventory stock');
  // Update cache with RPC result. Treat cache failures as non-fatal (backend is source of truth).
  try {
    writeCache('inventory-items', cached.map((row) => row.id === itemId ?
    { ...row, current_stock: result?.new_stock ?? row.current_stock } :
    row
    ));
  } catch (e) {
    console.warn('[INVENTORY] Cache update failed after RPC succeeded:', e);
    // Continue anyway — the backend state is correct, cache is secondary
  }
  upsertLocalInventoryMovement({
    id: adjustmentId,
    item_id: itemId,
    movement_type: numericDelta >= 0 ? 'adjustment_increase' : 'adjustment_decrease',
    quantity: numericDelta,
    unit_cost: existing?.latest_unit_cost || 0,
    total_cost: numericDelta * Number(existing?.latest_unit_cost || 0),
    notes: notes || null,
    reference_type: 'inventory_adjustment',
    reference_id: adjustmentId,
    source: 'adjustment'
  });
  return { success: true, new_stock: result?.new_stock };
}

function decorateMovementRows(rows = []) {
  const itemMap = new Map((readCache('inventory-items') || []).map((item) => [item.id, item]));
  return (rows || []).map((row) => {
    const item = itemMap.get(row.item_id) || row.inventory_items || {};
    return {
      ...row,
      item_name: row.item_name || item?.name || 'Inventory item',
      item_unit: row.item_unit || item?.unit || 'unit',
      item_category: row.item_category || item?.category || 'Other',
      outlet_id: row.outlet_id || item?.outlet_id || null
    };
  });
}

function buildDerivedInventoryMovements() {
  const rows = [];
  const inventoryItems = readCache('inventory-items') || [];
  const itemMap = new Map(inventoryItems.map((item) => [item.id, item]));
  const cachedLocalMovements = readInventoryMovementsCache();

  rows.push(...cachedLocalMovements);

  for (const purchase of readCache('inventory-purchases') || []) {
    if (!purchase?.item_id) continue;
    rows.push({
      id: `purchase-${purchase.id || purchase.item_id}-${purchase.date || purchase.created_at || ''}`,
      lodge_id: purchase.lodge_id || state.lodgeId,
      item_id: purchase.item_id,
      movement_type: 'purchase',
      quantity: normalizeStockNumber(purchase.quantity_purchased),
      unit_cost: normalizeStockNumber(purchase.unit_cost),
      total_cost: normalizeStockNumber(purchase.total_cost),
      notes: purchase.notes || null,
      reference_type: 'inventory_purchase',
      reference_id: purchase.id || null,
      source: 'purchase',
      created_at: purchase.created_at || (purchase.date ? `${purchase.date}T12:00:00.000Z` : new Date().toISOString())
    });
  }

  const voidsByOrder = new Map((readCache('pos-void-history') || []).map((entry) => [entry.order_id, entry]));
  for (const order of readCache('pos-orders') || []) {
    const orderItems = Array.isArray(order?.pos_order_items) ? order.pos_order_items : Array.isArray(order?.items) ? order.items : [];
    for (const line of orderItems) {
      const inventoryItemId = line?.inventory_item_id || null;
      if (!inventoryItemId) continue;
      const item = itemMap.get(inventoryItemId) || {};
      const soldQty = Number(line.quantity || 0) * normalizePositiveQty(line.depletion_qty, 1);
      if (soldQty !== 0) {
        rows.push({
          id: `pos-sale-${order.id}-${line.id || line.item_name || inventoryItemId}`,
          lodge_id: order.lodge_id || state.lodgeId,
          item_id: inventoryItemId,
          movement_type: soldQty < 0 ? 'pos_return' : 'pos_sale',
          quantity: -soldQty,
          unit_cost: normalizeStockNumber(item.latest_unit_cost),
          total_cost: -soldQty * normalizeStockNumber(item.latest_unit_cost),
          notes: order.notes || null,
          reference_type: line.id ? 'pos_order_item' : 'pos_order',
          reference_id: line.id || order.id,
          source: 'pos',
          created_at: order.created_at || new Date().toISOString(),
          _pending_sync: order._pending_sync === true,
          _sync_state: order._sync_state || (order._pending_sync ? 'pending' : 'synced')
        });
      }
      if (order.status === 'voided') {
        const voidEntry = voidsByOrder.get(order.id);
        const restoredQty = Math.max(0, Number(line.quantity || 0)) * normalizePositiveQty(line.depletion_qty, 1);
        if (restoredQty > 0) {
          rows.push({
            id: `pos-void-${order.id}-${line.id || line.item_name || inventoryItemId}`,
            lodge_id: order.lodge_id || state.lodgeId,
            item_id: inventoryItemId,
            movement_type: 'pos_void_restore',
            quantity: restoredQty,
            unit_cost: normalizeStockNumber(item.latest_unit_cost),
            total_cost: restoredQty * normalizeStockNumber(item.latest_unit_cost),
            notes: voidEntry?.reason || order._void_reason || null,
            reference_type: 'pos_void',
            reference_id: voidEntry?.id || order.id,
            source: 'pos',
            created_at: voidEntry?.created_at || order.created_at || new Date().toISOString(),
            _pending_sync: voidEntry?._pending_sync === true || order._pending_void === true,
            _sync_state: voidEntry?._sync_state || (order._pending_void ? 'pending' : 'synced')
          });
        }
      }
    }
  }

  const unique = new Map();
  for (const row of rows) {
    unique.set(movementIdentity(row), row);
  }
  return decorateMovementRows([...unique.values()].sort(movementSort));
}

export async function getInventoryMovements(filters = {}) {
  const itemId = filters?.item_id || filters?.itemId || null;
  const startDate = filters?.start_date || filters?.startDate || null;
  const endDate = filters?.end_date || filters?.endDate || startDate || null;
  const limit = Math.max(1, Math.min(500, Number(filters?.limit || 200)));
  const exportAll = filters?.export_all === true || filters?.exportAll === true;
  const pageSize = exportAll ? 1000 : limit;
  const maxRows = exportAll ? 100000 : limit;
  if (state.isOnline) {
    try {
      const liveRows = [];
      for (let from = 0; from < maxRows; from += pageSize) {
        let query = state.supabase.
        from('inventory_movements').
        select('*, inventory_items(name, unit, category, outlet_id)').
        eq('lodge_id', state.lodgeId).
        order('created_at', { ascending: false });
        if (itemId) query = query.eq('item_id', itemId);
        const startBoundary = localDateBoundary(startDate);
        const endBoundary = localDateBoundary(endDate, true);
        if (startBoundary) query = query.gte('created_at', startBoundary);
        if (endBoundary) query = query.lt('created_at', endBoundary);
        const { data, error } = await query.range(from, from + pageSize - 1);
        if (error) throw error;
        const page = data || [];
        liveRows.push(...page);
        if (!exportAll || page.length < pageSize) break;
      }
      const decoratedRows = decorateMovementRows(liveRows);
      if (!itemId) writeInventoryMovementsCache(liveRows);
      return withReadMetadata(
        decoratedRows,
        'server',
        liveRows.length < maxRows && decoratedRows.every((row) => row.operation_id && row.source_document_type && row.payload_hash && row.valuation_method !== 'unknown_legacy')
      );
    } catch (error) {
      if (!/inventory_movements|does not exist|schema cache|PGRST/i.test(String(error?.message || error))) {
        console.warn('[INVENTORY] Movement ledger query failed; using derived history:', error?.message || error);
      }
    }
  }

  return withReadMetadata(buildDerivedInventoryMovements().
  filter((row) => !itemId || row.item_id === itemId).
  filter((row) => filterMovementsByDate([row], startDate, endDate).length > 0).
  slice(0, maxRows).map((row) => ({
    ...row,
    _source: 'derived-estimate',
    _complete: false,
    valuation_method: row.valuation_method || 'unknown_legacy'
  })), 'derived-estimate', false);
}

function readInventoryStocktakeHeaders() {
  return readCache('inventory-stocktakes');
}

function writeInventoryStocktakeHeaders(rows = []) {
  writeCache('inventory-stocktakes', rows);
}

function readInventoryStocktakeLines() {
  return readCache('inventory-stocktake-lines');
}

function writeInventoryStocktakeLines(rows = []) {
  writeCache('inventory-stocktake-lines', rows);
}

function buildLocalInventoryStocktakeLines(stocktakeId, outletId = null) {
  return (readCache('inventory-items') || [])
    .filter((item) => item?._deleted_offline !== true)
    .filter((item) => !outletId || item.outlet_id === outletId)
    .map((item) => ({
      id: randomUUID(),
      stocktake_id: stocktakeId,
      lodge_id: state.lodgeId,
      item_id: item.id,
      expected_qty: Number(item.current_stock || 0),
      counted_qty: null,
      variance_qty: null,
      notes: null,
      item_name: item.name || 'Item',
      item_category: item.category || 'Other',
      item_unit: item.unit || 'unit',
      outlet_id: item.outlet_id || null,
      created_at: new Date().toISOString(),
      _pending_sync: true,
      _sync_state: 'pending'
    }));
}

export async function getInventoryStocktakes(limit = 12) {
  const cached = readInventoryStocktakeHeaders();
  if (!state.isOnline) return cached.slice(0, Number(limit || 12));
  const { data, error } = await state.supabase.
  from('inventory_stocktakes').
  select('*, outlets(name, type)').
  eq('lodge_id', state.lodgeId).
  order('created_at', { ascending: false }).
  limit(Number(limit || 12));
  if (error) throw new Error(error.message);
  const rows = (data || []).map((row) => ({
    ...row,
    outlet_name: row.outlets?.name || null,
    outlet_type: row.outlets?.type || null
  }));
  writeInventoryStocktakeHeaders(rows);
  return rows;
}

export async function createInventoryStocktakeSession(data = {}) {
  const id = data.id || randomUUID();
  const payload = {
    id,
    lodge_id: state.lodgeId,
    outlet_id: data.outlet_id || null,
    title: data.title || null,
    notes: data.notes || null,
    created_by: state.currentUser?.id || null
  };
  if (!state.isOnline) {
    const now = new Date().toISOString();
    const header = {
      id,
      ...payload,
      status: 'draft',
      created_at: now,
      updated_at: now,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null
    };
    const lines = buildLocalInventoryStocktakeLines(id, payload.outlet_id);
    writeInventoryStocktakeHeaders([header, ...readInventoryStocktakeHeaders().filter((row) => row?.id !== id)]);
    writeInventoryStocktakeLines([...lines, ...readInventoryStocktakeLines().filter((row) => row?.stocktake_id !== id)]);
    queueOperation('rpc', 'create_inventory_stocktake_session', { payload }, null, {
      _queue_id: `inventory-stocktake-${id}`
    });
    return { success: true, id, stocktake_id: id, offline: true, queued: true };
  }
  const { data: result, error } = await state.supabase.rpc('create_inventory_stocktake_session', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not start inventory stock take');
  return result;
}

export async function getInventoryStocktakeSession(stocktakeId) {
  if (!state.isOnline) {
    const header = readInventoryStocktakeHeaders().find((row) => row?.id === stocktakeId);
    if (!header) return null;
    return {
      ...header,
      lines: readInventoryStocktakeLines()
        .filter((line) => line?.stocktake_id === stocktakeId)
        .sort((a, b) => String(a.item_name || '').localeCompare(String(b.item_name || '')))
    };
  }
  const [{ data: header, error: headerError }, { data: lines, error: linesError }] = await Promise.all([
  state.supabase.
  from('inventory_stocktakes').
  select('*, outlets(name, type)').
  eq('lodge_id', state.lodgeId).
  eq('id', stocktakeId).
  maybeSingle(),
  state.supabase.
  from('inventory_stocktake_lines').
  select('*, inventory_items(name, category, unit, outlet_id)').
  eq('lodge_id', state.lodgeId).
  eq('stocktake_id', stocktakeId).
  order('created_at', { ascending: true })]
  );
  if (headerError) throw new Error(headerError.message);
  if (linesError) throw new Error(linesError.message);
  if (!header) return null;
  return {
    ...header,
    outlet_name: header.outlets?.name || null,
    outlet_type: header.outlets?.type || null,
    lines: (lines || []).map((line) => ({
      ...line,
      item_name: line.inventory_items?.name || 'Item',
      item_category: line.inventory_items?.category || 'Other',
      item_unit: line.inventory_items?.unit || 'unit',
      outlet_id: line.inventory_items?.outlet_id || null
    }))
  };
}

export async function getInventoryStocktakeById(stocktakeId) {
  if (!stocktakeId) return null;
  if (!state.isOnline) return readInventoryStocktakeHeaders().find((row) => row?.id === stocktakeId) || null;
  try {
    const { data, error } = await state.supabase.
    from('inventory_stocktakes').
    select('*').
    eq('id', stocktakeId).
    eq('lodge_id', state.lodgeId).
    maybeSingle();
    if (error) throw error;
    return data || null;
  } catch {
    return null;
  }
}

export async function saveInventoryStocktakeCounts(stocktakeId, lines) {
  const payload = (Array.isArray(lines) ? lines : []).map((line) => ({
    item_id: line.item_id,
    counted_qty: line.counted_qty,
    notes: line.notes || null
  }));
  if (!state.isOnline) {
    const headers = readInventoryStocktakeHeaders();
    const header = headers.find((row) => row?.id === stocktakeId);
    if (!header) return { success: false, error: 'Inventory stocktake not found in offline cache' };
    const counts = new Map(payload.map((line) => [line.item_id, line]));
    writeInventoryStocktakeLines(readInventoryStocktakeLines().map((line) => {
      if (line.stocktake_id !== stocktakeId || !counts.has(line.item_id)) return line;
      const count = counts.get(line.item_id);
      const counted = Number(count.counted_qty || 0);
      return {
        ...line,
        counted_qty: counted,
        variance_qty: counted - Number(line.expected_qty || 0),
        notes: count.notes || null,
        _pending_sync: true,
        _sync_state: 'pending',
        updated_at: new Date().toISOString()
      };
    }));
    writeInventoryStocktakeHeaders(headers.map((row) => row.id === stocktakeId ? {
      ...row,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null,
      updated_at: new Date().toISOString()
    } : row));
    queueOperation('rpc', 'save_inventory_stocktake_counts', {
      p_stocktake_id: stocktakeId,
      p_lodge_id: state.lodgeId,
      p_lines: payload
    }, null, {
      _queue_id: `inventory-stocktake-counts-${stocktakeId}-${Date.now()}`,
      ...(header?._pending_sync ? { _depends_on: `inventory-stocktake-${stocktakeId}` } : {})
    });
    return { success: true, offline: true, queued: true };
  }
  const { data: result, error } = await state.supabase.rpc('save_inventory_stocktake_counts', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: state.lodgeId,
    p_lines: payload
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not save inventory stock take');
  return result;
}

export async function postInventoryStocktakeSession(stocktakeId, notes) {
  if (!state.isOnline) {
    const headers = readInventoryStocktakeHeaders();
    const header = headers.find((row) => row?.id === stocktakeId);
    if (!header) return { success: false, error: 'Inventory stocktake not found in offline cache' };
    const lines = readInventoryStocktakeLines().filter((line) => line?.stocktake_id === stocktakeId);
    const countable = lines.filter((line) => line.counted_qty !== null && line.counted_qty !== undefined);
    const itemCounts = new Map(countable.map((line) => [line.item_id, line]));
    writeCache('inventory-items', readCache('inventory-items').map((item) => {
      const line = itemCounts.get(item.id);
      if (!line) return item;
      const counted = Number(line.counted_qty || 0);
      return {
        ...item,
        current_stock: counted,
        _pending_sync: true,
        _sync_state: 'pending',
        _sync_error: null,
        updated_at: new Date().toISOString()
      };
    }));
    for (const line of countable) {
      upsertLocalInventoryMovement({
        id: `stocktake-${stocktakeId}-${line.item_id}`,
        item_id: line.item_id,
        movement_type: 'stocktake_adjustment',
        quantity: Number(line.counted_qty || 0) - Number(line.expected_qty || 0),
        notes: notes || line.notes || null,
        reference_type: 'inventory_stocktake',
        reference_id: stocktakeId,
        source: 'stocktake',
        _pending_sync: true,
        _sync_state: 'pending'
      });
    }
    writeInventoryStocktakeHeaders(headers.map((row) => row.id === stocktakeId ? {
      ...row,
      status: 'posted',
      notes: notes || row.notes || null,
      posted_at: new Date().toISOString(),
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null,
      updated_at: new Date().toISOString()
    } : row));
    queueOperation('rpc', 'post_inventory_stocktake_session', {
      p_stocktake_id: stocktakeId,
      p_lodge_id: state.lodgeId,
      p_notes: notes || null
    }, null, {
      _queue_id: `inventory-stocktake-post-${stocktakeId}-${Date.now()}`,
      ...(header?._pending_sync ? { _depends_on: `inventory-stocktake-${stocktakeId}` } : {})
    });
    return { success: true, offline: true, queued: true };
  }
  const { data: result, error } = await state.supabase.rpc('post_inventory_stocktake_session', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: state.lodgeId,
    p_notes: notes || null
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not post inventory stock take');
  await getInventoryItems().catch(() => {});
  return result;
}

export async function getInventorySpend(startDate, endDate, outletId = 'all') {
  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.rpc('get_inventory_spend_summary', {
        p_lodge_id: state.lodgeId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_outlet_selector: outletId || 'all'
      });
      if (error) throw error;
      if (data && typeof data === 'object') {
        return {
          ...data,
          source: 'server',
          _source: 'server',
          _complete: data.complete === true || data._complete === true,
          as_of_range: { start: startDate, end: endDate },
          outlet_selector: outletId || 'all'
        };
      }
      throw new Error('Inventory spend summary was empty.');
    } catch (error) {
      recordCriticalError('reports.inventory_spend', error, {
        startDate,
        endDate,
        outletId: outletId || 'all',
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 });
    }
  }

  const inventoryMap = new Map(readCache('inventory-items').map((item) => [item.id, item]));
  const cachedPurchases = readCache('inventory-purchases').
  filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate)).
  map((row) => ({
    ...row,
    inventory_items: inventoryMap.get(row.item_id) ?
    {
      name: inventoryMap.get(row.item_id).name,
      category: inventoryMap.get(row.item_id).category,
      outlet_id: inventoryMap.get(row.item_id).outlet_id || null
    } :
    null
  })).
  sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  let purchases = [];
  try {
    const { data, error } = await state.supabase.
    from('inventory_purchases').
    select('*, inventory_items(name, category, outlet_id)').
    eq('lodge_id', state.lodgeId).
    gte('date', startDate).
    lte('date', endDate).
    order('date', { ascending: false });
    if (error) throw error;
    purchases = (data || []).length === 0 && cachedPurchases.length > 0 ?
    cachedPurchases :
    data || [];
  } catch (error) {
    purchases = cachedPurchases;
    if (!purchases.length && state.isOnline) {
      throw new Error(error?.message || 'Failed to load inventory spend report');
    }
  }
  if (outletId && outletId !== 'all') {
    if (outletId === 'unassigned')
    purchases = purchases.filter((p) => !p.inventory_items?.outlet_id);else

    purchases = purchases.filter((p) => p.inventory_items?.outlet_id === outletId);
  }
  const total = purchases.reduce((s, p) => s + Number(p.total_cost || 0), 0);
  const by_category = {};
  for (const p of purchases) {
    const cat = p.inventory_items?.category || 'Uncategorised';
    by_category[cat] = (by_category[cat] || 0) + Number(p.total_cost || 0);
  }
  return {
    total,
    by_category,
    purchases,
    source: 'local',
    _source: 'derived-estimate',
    _complete: false,
    as_of_range: { start: startDate, end: endDate },
    outlet_selector: outletId || 'all'
  };
}

export async function getLowStockItems() {
  const rows = await getInventoryItems().catch(() => readCache('inventory-items'));
  return (rows || []).filter(
    (item) => Number(item.reorder_level) > 0 && Number(item.current_stock) <= Number(item.reorder_level)
  );
}

export async function discardDraft(id) {
  const trimmedActiveQueue = removeQueuedInventoryDraft(readSyncQueue(), id);
  if (trimmedActiveQueue.removed) {
    writeSyncQueue(trimmedActiveQueue.queue);
  }
  const trimmedFailedQueue = removeQueuedInventoryDraft(readFailedSyncQueue(), id);
  if (trimmedFailedQueue.removed) {
    writeFailedSyncQueue(trimmedFailedQueue.queue);
  }

  const cached = readCache('inventory-items');
  writeCache('inventory-items', cached.filter((item) => item.id !== id));

  return { success: true };
}
