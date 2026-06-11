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

// ─── INVENTORY ────────────────────────────────────────────────────────────────

const INVENTORY_MOVEMENTS_CACHE = 'inventory-movements';
const INVENTORY_ITEM_SELECT = 'id, name, category, unit, current_stock, reorder_level, selling_price, outlet_id, latest_unit_cost, lodge_id, created_at, updated_at, sku, barcode, is_active';
const INVENTORY_ITEM_LEGACY_SELECT = 'id, name, category, unit, current_stock, reorder_level, selling_price, outlet_id, latest_unit_cost, lodge_id, created_at';

function isMissingInventoryCompatibilityColumnError(error) {
  return /column\s+inventory_items\.(barcode|is_active|sku|updated_at)\s+does\s+not\s+exist/i.test(String(error?.message || ''));
}

async function selectInventoryItems(selectColumns = INVENTORY_ITEM_SELECT) {
  return state.supabase.
  from('inventory_items').
  select(selectColumns).
  eq('lodge_id', state.lodgeId).
  order('category').
  order('name').
  limit(500);
}

function normalizeStockNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function movementSort(a, b) {
  return String(b.created_at || b.date || '').localeCompare(String(a.created_at || a.date || ''));
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

async function _getInventoryItems() {
  if (state.isOnline) {
    let { data, error } = await selectInventoryItems();
    if (error && isMissingInventoryCompatibilityColumnError(error)) {
      console.warn('inventory_items compatibility columns are missing in the remote schema; loading inventory with defaults until the migration is applied');
      const legacyResult = await selectInventoryItems(INVENTORY_ITEM_LEGACY_SELECT);
      data = (legacyResult.data || []).map((row) => ({
        ...row,
        updated_at: row.updated_at || row.created_at || null,
        sku: null,
        barcode: null,
        is_active: true
      }));
      error = legacyResult.error;
    }
    if (!error) {
      if (!data || data.length === 0) {
        const cached = readCache('inventory-items');
        if (cached.length > 0) {
          console.warn('getInventoryItems received empty live result; using cached inventory items instead');
          return cached;
        }
      }
      const liveRows = applyQueuedDayUseInventoryReservations(applyQueuedPosInventoryReservations(data || []));
      // Merge with local state to preserve any pending-sync or failed items
      const merged = mergeRemoteInventoryWithLocalState(liveRows);
      writeCache('inventory-items', merged);
      return merged;
    }
    const cached = readCache('inventory-items');
    if (cached.length > 0) {
      console.warn('getInventoryItems falling back to cache:', error.message);
      return cached;
    }
    throw new Error(error.message);
  }
  return readCache('inventory-items');
}

export function getInventoryItems() {
  return dedupePromise('getInventoryItems', _getInventoryItems);
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
  const item = {
    id,
    lodge_id: state.lodgeId,
    name: data.name,
    category: data.category || 'Bar',
    unit: data.unit || 'unit',
    current_stock: Number(data.current_stock) || 0,
    reorder_level: Number(data.reorder_level) || 0,
    latest_unit_cost: 0,
    selling_price: Number(data.selling_price) || 0,
    outlet_id: data.outlet_id || null
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
  const update = {
    name: data.name,
    category: data.category,
    unit: data.unit,
    reorder_level: Number(data.reorder_level) || 0,
    ...(Object.prototype.hasOwnProperty.call(data, 'selling_price') ?
    { selling_price: Number(data.selling_price) || 0 } :
    {}),
    ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {})
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
    const cached = readCache('inventory-items');
    writeCache('inventory-items', cached.map((row) => row.id === id ? { ...row, ...update } : row));
    return { success: true };
  }
  return { success: false, error: 'Requires internet connection' };
}

export async function deleteInventoryItem(id) {
  if (!state.isOnline) throw new Error('No internet connection. Please check your connection and try again.');
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const qty = Number(data.quantity_purchased);
  const cost = Number(data.total_cost);
  const unitCost = qty > 0 ? cost / qty : 0;

  const purchase = {
    lodge_id: state.lodgeId,
    item_id: data.item_id,
    date: data.date,
    quantity_purchased: qty,
    total_cost: cost,
    unit_cost: unitCost,
    notes: data.notes || null
  };
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
    item_id: data.item_id,
    movement_type: 'purchase',
    quantity: qty,
    unit_cost: unitCost,
    total_cost: cost,
    notes: purchase.notes,
    reference_type: 'inventory_purchase',
    reference_id: result?.id || null,
    source: 'purchase',
    created_at: purchase.date ? `${purchase.date}T12:00:00.000Z` : new Date().toISOString()
  });
  return { success: true };
}

export async function getInventoryPurchases(itemId) {
  const cached = readCache('inventory-purchases').filter((row) => row.item_id === itemId);
  if (!state.isOnline) {
    return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }

  try {
    const { data, error } = await state.supabase.
    from('inventory_purchases').
    select('id, item_id, quantity, unit_cost, total_cost, supplier, date, notes, lodge_id, created_at, updated_at').
    eq('lodge_id', state.lodgeId).
    eq('item_id', itemId).
    order('date', { ascending: false }).
    limit(200);
    if (error) throw error;

    const liveRows = Array.isArray(data) ? data : [];
    const otherCachedRows = readCache('inventory-purchases').filter((row) => row.item_id !== itemId);
    if (liveRows.length === 0 && cached.length > 0) {
      console.warn('getInventoryPurchases received empty live result; using cached purchases instead');
      return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }

    writeCache('inventory-purchases', [...liveRows, ...otherCachedRows]);
    return liveRows;
  } catch (error) {
    if (cached.length > 0) {
      console.warn('getInventoryPurchases falling back to cache:', error.message);
      return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }
    throw new Error(error.message);
  }
}

export async function getAllInventoryPurchases() {
  const cached = readCache('inventory-purchases');
  if (!state.isOnline) {
    return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }

  try {
    const { data, error } = await state.supabase.
    from('inventory_purchases').
    select('id, item_id, quantity, unit_cost, total_cost, supplier, date, notes, lodge_id, created_at, updated_at').
    eq('lodge_id', state.lodgeId).
    order('date', { ascending: false }).
    limit(500);
    if (error) throw error;
    const liveRows = Array.isArray(data) ? data : [];
    if (liveRows.length === 0 && cached.length > 0) {
      console.warn('getAllInventoryPurchases received empty live result; using cached purchases instead');
      return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }
    writeCache('inventory-purchases', liveRows);
    return liveRows;
  } catch (error) {
    if (cached.length > 0) {
      console.warn('getAllInventoryPurchases falling back to cache:', error?.message || error);
      return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }
    throw new Error(error?.message || 'Failed to load inventory purchases');
  }
}

export async function adjustInventoryStock(itemId, delta, notes) {
  const numericDelta = Number(delta);
  if (!Number.isFinite(numericDelta) || numericDelta === 0) {
    return { success: false, error: 'Enter a non-zero stock adjustment.' };
  }
  const cached = readCache('inventory-items');
  const existing = cached.find((row) => row.id === itemId);

  if (!state.isOnline) {
    if (!existing) return { success: false, error: 'Inventory item not found on this computer.' };
    const adjustmentId = randomUUID();
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
      p_notes: notes || null
    }, null, {
      _queue_id: `inventory-adjust-${adjustmentId}`
    });
    return { success: true, new_stock: newStock, offline: true };
  }

  const { data: result, error } = await state.supabase.rpc('adjust_inventory_stock', {
    p_item_id: itemId,
    p_lodge_id: state.lodgeId,
    p_delta: numericDelta,
    p_notes: notes || null
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
    item_id: itemId,
    movement_type: numericDelta >= 0 ? 'adjustment_increase' : 'adjustment_decrease',
    quantity: numericDelta,
    unit_cost: existing?.latest_unit_cost || 0,
    total_cost: numericDelta * Number(existing?.latest_unit_cost || 0),
    notes: notes || null,
    reference_type: 'inventory_adjustment',
    reference_id: result?.id || null,
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
  const limit = Math.max(1, Math.min(500, Number(filters?.limit || 200)));
  if (state.isOnline) {
    try {
      let query = state.supabase.
      from('inventory_movements').
      select('*, inventory_items(name, unit, category, outlet_id)').
      eq('lodge_id', state.lodgeId).
      order('created_at', { ascending: false }).
      limit(limit);
      if (itemId) query = query.eq('item_id', itemId);
      const { data, error } = await query;
      if (error) throw error;
      const liveRows = decorateMovementRows(data || []);
      if (!itemId) writeInventoryMovementsCache(liveRows);
      return liveRows;
    } catch (error) {
      if (!/inventory_movements|does not exist|schema cache|PGRST/i.test(String(error?.message || error))) {
        console.warn('[INVENTORY] Movement ledger query failed; using derived history:', error?.message || error);
      }
    }
  }

  return buildDerivedInventoryMovements().
  filter((row) => !itemId || row.item_id === itemId).
  slice(0, limit);
}

export async function getInventoryStocktakes(limit = 12) {
  if (!state.isOnline) return [];
  const { data, error } = await state.supabase.
  from('inventory_stocktakes').
  select('*, outlets(name, type)').
  eq('lodge_id', state.lodgeId).
  order('created_at', { ascending: false }).
  limit(Number(limit || 12));
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    ...row,
    outlet_name: row.outlets?.name || null,
    outlet_type: row.outlets?.type || null
  }));
}

export async function createInventoryStocktakeSession(data = {}) {
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const payload = {
    lodge_id: state.lodgeId,
    outlet_id: data.outlet_id || null,
    title: data.title || null,
    notes: data.notes || null,
    created_by: state.currentUser?.id || null
  };
  const { data: result, error } = await state.supabase.rpc('create_inventory_stocktake_session', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not start inventory stock take');
  return result;
}

export async function getInventoryStocktakeSession(stocktakeId) {
  if (!state.isOnline) return null;
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const payload = (Array.isArray(lines) ? lines : []).map((line) => ({
    item_id: line.item_id,
    counted_qty: line.counted_qty,
    notes: line.notes || null
  }));
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
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
