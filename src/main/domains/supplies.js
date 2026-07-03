import { randomUUID } from 'crypto'
import { state } from '../state.js'
import { recordCriticalError } from './operationalLog.js'
import {
  queueOperation,
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js'

// ─── ROOM SUPPLIES ────────────────────────────────────────────────────────────

function supplyQueueId(prefix, id) {
  return `${prefix}-${id}-${Date.now()}`
}

function upsertSupplyMovement(entry = {}) {
  const item = readCache('supply-items').find((row) => row?.id === entry.item_id) || {}
  const room = readCache('rooms').find((row) => row?.id === entry.room_id) || {}
  const row = {
    id: entry.id || randomUUID(),
    lodge_id: state.lodgeId,
    supply_item_id: entry.item_id,
    item_id: entry.item_id,
    room_id: entry.room_id || null,
    movement_type: entry.movement_type,
    quantity: Number(entry.quantity || 0),
    unit_cost: Number(entry.unit_cost ?? item.latest_unit_cost ?? 0),
    total_cost: Number(entry.total_cost ?? Number(entry.quantity || 0) * Number(entry.unit_cost ?? item.latest_unit_cost ?? 0)),
    notes: entry.notes || null,
    room_number: room.room_number || entry.room_number || null,
    room_type: room.room_type || entry.room_type || null,
    supply_name: item.name || entry.supply_name || 'Supply',
    supply_unit: item.unit || entry.supply_unit || 'piece',
    supply_category: item.category || entry.supply_category || 'Other',
    created_at: entry.created_at || new Date().toISOString(),
    _pending_sync: entry._pending_sync === true,
    _sync_state: entry._sync_state || (entry._pending_sync ? 'pending' : 'synced')
  }
  writeCache('room-supply-movements', [
    row,
    ...readCache('room-supply-movements').filter((existing) => existing?.id !== row.id)
  ].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))))
  return row
}

function patchSupplyItemStock(itemId, patcher) {
  const rows = readCache('supply-items')
  const current = rows.find((row) => row?.id === itemId)
  if (!current) return null
  const next = patcher(current)
  writeCache('supply-items', rows.map((row) => row.id === itemId ? {
    ...next,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  } : row))
  return next
}

function patchRoomSupplyStock({ itemId, roomId, delta, reorderLevel = 0 }) {
  const rows = readCache('room-supply-stock')
  const item = readCache('supply-items').find((row) => row?.id === itemId) || {}
  const room = readCache('rooms').find((row) => row?.id === roomId) || {}
  const idx = rows.findIndex((row) => row?.supply_item_id === itemId && row?.room_id === roomId)
  const now = new Date().toISOString()
  if (idx < 0) {
    const created = {
      id: randomUUID(),
      lodge_id: state.lodgeId,
      room_id: roomId,
      supply_item_id: itemId,
      item_id: itemId,
      quantity_on_hand: Math.max(0, Number(delta || 0)),
      reorder_level: Number(reorderLevel || 0),
      room_number: room.room_number || null,
      room_type: room.room_type || null,
      supply_name: item.name || 'Supply',
      supply_unit: item.unit || 'piece',
      supply_category: item.category || 'Other',
      updated_at: now,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null
    }
    writeCache('room-supply-stock', [created, ...rows])
    return created
  }
  const current = rows[idx]
  const next = {
    ...current,
    quantity_on_hand: Math.max(0, Number(current.quantity_on_hand || 0) + Number(delta || 0)),
    ...(reorderLevel !== undefined ? { reorder_level: Number(reorderLevel || current.reorder_level || 0) } : {}),
    updated_at: now,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null
  }
  const updated = [...rows]
  updated[idx] = next
  writeCache('room-supply-stock', updated)
  return next
}

function readSupplyStocktakeHeaders(cacheName) {
  return readCache(cacheName)
}

function readSupplyStocktakeLines(cacheName) {
  return readCache(cacheName)
}

function buildStoreSupplyStocktakeLines(stocktakeId) {
  return readCache('supply-items')
    .filter((item) => item?._deleted_offline !== true)
    .map((item) => ({
      id: randomUUID(),
      stocktake_id: stocktakeId,
      lodge_id: state.lodgeId,
      item_id: item.id,
      expected_qty: Number(item.current_stock || 0),
      counted_qty: null,
      variance_qty: null,
      notes: null,
      line_key: item.id,
      item_name: item.name || 'Item',
      item_category: item.category || 'Other',
      item_unit: item.unit || 'piece',
      created_at: new Date().toISOString(),
      _pending_sync: true,
      _sync_state: 'pending'
    }))
}

function buildRoomSupplyStocktakeLines(stocktakeId) {
  return readCache('room-supply-stock')
    .filter((row) => row?.supply_item_id && row?.room_id)
    .map((row) => ({
      id: randomUUID(),
      stocktake_id: stocktakeId,
      lodge_id: state.lodgeId,
      room_stock_id: row.id || `${row.room_id}:${row.supply_item_id}`,
      room_id: row.room_id,
      item_id: row.supply_item_id,
      supply_item_id: row.supply_item_id,
      expected_qty: Number(row.quantity_on_hand || 0),
      counted_qty: null,
      variance_qty: null,
      notes: null,
      line_key: row.id || `${row.room_id}:${row.supply_item_id}`,
      room_number: row.room_number || 'Room',
      room_type: row.room_type || 'Room',
      item_name: row.supply_name || 'Item',
      item_category: row.supply_category || 'Other',
      item_unit: row.supply_unit || 'piece',
      created_at: new Date().toISOString(),
      _pending_sync: true,
      _sync_state: 'pending'
    }))
}

async function _getSupplyItems() {
  try {
    const { data, error } = await state.supabase.
    from('supply_items').
    select('id, name, category, unit, current_stock, reorder_level, latest_unit_cost, lodge_id, created_at, updated_at, is_active').
    eq('lodge_id', state.lodgeId).
    order('category').
    order('name').
    limit(500);
    if (error) throw error;
    const cached = readCache('supply-items');
    if ((data || []).length === 0 && cached.length > 0) {
      console.warn('getSupplyItems received empty live result; using cached supply items instead');
      return cached.filter((row) => row?._deleted_offline !== true);
    }
    writeCache('supply-items', data || []);
    return data || [];
  } catch (error) {
    const cached = readCache('supply-items');
    if (cached.length > 0) {
      console.warn('getSupplyItems falling back to cache:', error?.message || error);
      return cached.filter((row) => row?._deleted_offline !== true);
    }
    if (!state.isOnline) return [];
    throw new Error(error?.message || 'Failed to load supply items');
  }
}

export function getSupplyItems() {
  return dedupePromise('getSupplyItems', _getSupplyItems);
}

export async function getSupplyItemById(id) {
  if (!id) return null;
  try {
    const { data, error } = await state.supabase.
    from('supply_items').
    select('*').
    eq('id', id).
    eq('lodge_id', state.lodgeId).
    single();
    if (error) throw error;
    return data || null;
  } catch {
    return readCache('supply-items').find((item) => item.id === id) || null;
  }
}

export async function createSupplyItem(data) {
  const id = data.id || randomUUID()
  const item = {
    id,
    lodge_id: state.lodgeId,
    name: data.name,
    category: data.category || 'Bathroom',
    unit: data.unit || 'piece',
    current_stock: Number(data.current_stock || 0),
    reorder_level: Number(data.reorder_level || 0),
    latest_unit_cost: 0
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_supply_item', { payload: item });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create supply item');
    const cached = readCache('supply-items');
    writeCache('supply-items', [...cached, { ...item, id: result?.id }]);
    return { success: true, id: result?.id };
  }
  const offlineItem = {
    ...item,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null
  }
  writeCache('supply-items', [...readCache('supply-items').filter((row) => row?.id !== id), offlineItem])
  if (Number(item.current_stock || 0) > 0) {
    upsertSupplyMovement({
      id,
      item_id: id,
      movement_type: 'opening_stock',
      quantity: item.current_stock,
      unit_cost: 0,
      total_cost: 0,
      notes: 'Opening supply stock recorded while offline',
      _pending_sync: true,
      _sync_state: 'pending'
    })
  }
  queueOperation('rpc', 'create_supply_item', { payload: item }, null, {
    _queue_id: `supply-item-${id}`
  })
  return { success: true, id, offline: true, queued: true };
}

export async function updateSupplyItem(id, data) {
  const update = {
    name: data.name,
    category: data.category,
    unit: data.unit,
    reorder_level: Number(data.reorder_level || 0)
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_supply_item', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update supply item');
    const cached = readCache('supply-items');
    writeCache('supply-items', cached.map((row) => row.id === id ? { ...row, ...update } : row));
    return { success: true };
  }
  const cached = readCache('supply-items')
  const existing = cached.find((row) => row?.id === id)
  if (!existing) return { success: false, error: 'Supply item not found in offline cache' }
  writeCache('supply-items', cached.map((row) => row.id === id ? {
    ...row,
    ...update,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  } : row))
  queueOperation('rpc', 'update_supply_item', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    payload: update
  }, null, {
    _queue_id: supplyQueueId('supply-item-update', id),
    ...(existing?._pending_sync ? { _depends_on: `supply-item-${id}` } : {})
  })
  return { success: true, offline: true, queued: true };
}

export async function deleteSupplyItem(id) {
  if (!state.isOnline) {
    const cached = readCache('supply-items')
    const existing = cached.find((row) => row?.id === id)
    if (!existing) return { success: false, error: 'Supply item not found in offline cache' }
    writeCache('supply-items', cached.map((row) => row.id === id ? {
      ...row,
      _deleted_offline: true,
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null,
      updated_at: new Date().toISOString()
    } : row))
    queueOperation('rpc', 'delete_supply_item', {
      p_id: id,
      p_lodge_id: state.lodgeId
    }, null, {
      _queue_id: supplyQueueId('supply-item-delete', id),
      ...(existing?._pending_sync ? { _depends_on: `supply-item-${id}` } : {})
    })
    return { success: true, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('delete_supply_item', {
    p_id: id,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not delete supply item');
  writeCache('supply-items', readCache('supply-items').filter((row) => row.id !== id));
  writeCache('supply-purchases', readCache('supply-purchases').filter((row) => row.item_id !== id));
  writeCache('room-supply-stock', readCache('room-supply-stock').filter((row) => row.supply_item_id !== id));
  writeCache('room-supply-movements', readCache('room-supply-movements').filter((row) => row.supply_item_id !== id));
  return { success: true };
}

export async function addSupplyPurchase(data) {
  const qty = Number(data.quantity_purchased);
  const cost = Number(data.total_cost);
  const unitCost = qty > 0 ? cost / qty : 0;
  const id = data.id || randomUUID()

  const purchase = {
    id,
    lodge_id: state.lodgeId,
    item_id: data.item_id,
    date: data.date,
    quantity_purchased: qty,
    total_cost: cost,
    unit_cost: unitCost,
    notes: data.notes || null
  };
  if (!state.isOnline) {
    const existingItem = readCache('supply-items').find((row) => row?.id === data.item_id)
    const updatedItem = patchSupplyItemStock(data.item_id, (row) => ({
      ...row,
      latest_unit_cost: unitCost,
      current_stock: Number(row.current_stock || 0) + qty
    }))
    if (!updatedItem) return { success: false, error: 'Supply item not found in offline cache' }
    writeCache('supply-purchases', [
      { ...purchase, _pending_sync: true, _sync_state: 'pending', _sync_error: null, created_at: new Date().toISOString() },
      ...readCache('supply-purchases').filter((row) => row?.id !== id)
    ])
    upsertSupplyMovement({
      id,
      item_id: data.item_id,
      movement_type: 'purchase',
      quantity: qty,
      unit_cost: unitCost,
      total_cost: cost,
      notes: purchase.notes,
      _pending_sync: true,
      _sync_state: 'pending'
    })
    queueOperation('rpc', 'add_supply_purchase', { payload: purchase }, null, {
      _queue_id: `supply-purchase-${id}`,
      ...(existingItem?._pending_sync ? { _depends_on: `supply-item-${data.item_id}` } : {})
    })
    return { success: true, id, unit_cost: unitCost, new_stock: updatedItem.current_stock, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('add_supply_purchase', { payload: purchase });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not record supply purchase');
  const supplyItems = readCache('supply-items');
  writeCache('supply-items', supplyItems.map((row) => row.id === data.item_id ?
  {
    ...row,
    latest_unit_cost: unitCost,
    current_stock: result?.new_stock ?? Number(row.current_stock || 0) + qty
  } :
  row
  ));
  const cachedPurchases = readCache('supply-purchases');
  writeCache('supply-purchases', [
  { ...purchase, id: result?.id || `local-${Date.now()}` },
  ...cachedPurchases]
  );
  return { success: true, unit_cost: unitCost, new_stock: result?.new_stock };
}

export async function getSupplyPurchases(itemId) {
  try {
    const { data, error } = await state.supabase.
    from('supply_purchases').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('item_id', itemId).
    order('date', { ascending: false });
    if (error) throw error;
    const cached = readCache('supply-purchases').filter((row) => row.item_id !== itemId);
    writeCache('supply-purchases', [...(data || []), ...cached]);
    return data || [];
  } catch (error) {
    const cached = readCache('supply-purchases').filter((row) => row.item_id === itemId);
    if (cached.length > 0) {
      console.warn('getSupplyPurchases falling back to cache:', error?.message || error);
      return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }
    if (!state.isOnline) return [];
    throw new Error(error?.message || 'Failed to load supply purchases');
  }
}

export async function getAllSupplyPurchases() {
  const cached = readCache('supply-purchases');
  if (!state.isOnline) {
    return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }

  try {
    const { data, error } = await state.supabase.
    from('supply_purchases').
    select('*').
    eq('lodge_id', state.lodgeId).
    order('date', { ascending: false });
    if (error) throw error;
    const liveRows = Array.isArray(data) ? data : [];
    if (liveRows.length === 0 && cached.length > 0) {
      console.warn('getAllSupplyPurchases received empty live result; using cached purchases instead');
      return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }
    writeCache('supply-purchases', liveRows);
    return liveRows;
  } catch (error) {
    if (cached.length > 0) {
      console.warn('getAllSupplyPurchases falling back to cache:', error?.message || error);
      return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    }
    throw new Error(error?.message || 'Failed to load supply purchases');
  }
}

export async function saveRoomSupplyAllocations(weekStart, allocations) {
  const rows = allocations.
  filter((a) => Number(a.units_used) > 0).
  map((a) => ({
    id: a.id || randomUUID(),
    lodge_id: state.lodgeId,
    supply_item_id: a.supply_item_id,
    room_id: a.room_id,
    week_start: weekStart,
    units_used: Number(a.units_used),
    unit_cost: Number(a.unit_cost),
    total_cost: Number(a.units_used) * Number(a.unit_cost)
  }));
  if (!state.isOnline) {
    const existing = readCache('room-supply-allocations').filter((row) => row.week_start !== weekStart)
    const cachedRows = rows.map((row) => {
      const item = readCache('supply-items').find((entry) => entry?.id === row.supply_item_id) || {}
      const room = readCache('rooms').find((entry) => entry?.id === row.room_id) || {}
      return {
        ...row,
        source: 'allocation',
        entry_date: weekStart,
        supply_name: item.name || 'Supply',
        supply_unit: item.unit || 'piece',
        supply_category: item.category || 'Other',
        room_number: room.room_number || null,
        _pending_sync: true,
        _sync_state: 'pending',
        _sync_error: null,
        created_at: new Date().toISOString()
      }
    })
    writeCache('room-supply-allocations', [...cachedRows, ...existing])
    queueOperation('rpc', 'save_room_supply_allocations', {
      p_lodge_id: state.lodgeId,
      p_week_start: weekStart,
      p_allocations: rows
    }, null, {
      _queue_id: `room-supply-allocations-${weekStart}-${Date.now()}`
    })
    return { success: true, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('save_room_supply_allocations', {
    p_lodge_id: state.lodgeId,
    p_week_start: weekStart,
    p_allocations: rows
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not save room supply allocations');
  return { success: true };
}

export async function getRoomSupplyAllocations(startDate, endDate) {
  const cachedAllocations = readCache('room-supply-allocations').filter((row) => {
    const entryDate = String(row.entry_date || row.week_start || '');
    return (!startDate || entryDate >= startDate) && (!endDate || entryDate <= endDate);
  });
  if (!state.isOnline) return cachedAllocations;

  try {
    let movementQuery = state.supabase.
    from('room_supply_movements').
    select('*, supply_items(name, unit, category), rooms(room_number)').
    eq('lodge_id', state.lodgeId).
    eq('movement_type', 'use');
    if (startDate) movementQuery = movementQuery.gte('created_at', `${startDate}T00:00:00`);
    if (endDate) movementQuery = movementQuery.lte('created_at', `${endDate}T23:59:59`);
    const { data: movementData, error: movementError } = await movementQuery.order('created_at', { ascending: false });
    if (movementError) throw movementError;

    const movementRows = (movementData || []).map((row) => ({
      id: row.id,
      source: 'movement',
      entry_date: String(row.created_at || '').split('T')[0],
      week_start: null,
      room_id: row.room_id,
      room_number: row.rooms?.room_number,
      supply_item_id: row.supply_item_id,
      supply_name: row.supply_items?.name,
      supply_unit: row.supply_items?.unit,
      supply_category: row.supply_items?.category,
      units_used: Number(row.quantity || 0),
      unit_cost: Number(row.unit_cost || 0),
      total_cost: Number(row.total_cost || 0),
      notes: row.notes || '',
      created_at: row.created_at
    }));

    if (movementRows.length > 0) {
      writeCache('room-supply-allocations', movementRows);
      return movementRows;
    }

    let allocationQuery = state.supabase.
    from('room_supply_allocations').
    select('*, supply_items(name, unit, category), rooms(room_number)').
    eq('lodge_id', state.lodgeId);
    if (startDate) allocationQuery = allocationQuery.gte('week_start', startDate);
    if (endDate) allocationQuery = allocationQuery.lte('week_start', endDate);
    const { data: allocationData, error: allocationError } = await allocationQuery.order('week_start', { ascending: false });
    if (allocationError) throw allocationError;
    const rows = (allocationData || []).map((a) => ({
      ...a,
      source: 'allocation',
      entry_date: a.week_start,
      supply_name: a.supply_items?.name,
      supply_unit: a.supply_items?.unit,
      supply_category: a.supply_items?.category,
      room_number: a.rooms?.room_number
    }));
    writeCache('room-supply-allocations', rows);
    return rows;
  } catch (error) {
    if (cachedAllocations.length > 0) {
      console.warn('getRoomSupplyAllocations falling back to cache:', error?.message || error);
      return cachedAllocations;
    }
    throw new Error(error?.message || 'Failed to load room supply cost data');
  }
}

export async function getSupplyAllocationsForWeek(weekStart) {
  if (!state.isOnline) return readCache('room-supply-allocations').filter((row) => row.week_start === weekStart);
  const { data } = await state.supabase.
  from('room_supply_allocations').
  select('id, room_id, item_id, quantity, week_start, lodge_id, created_at, updated_at').
  eq('lodge_id', state.lodgeId).
  eq('week_start', weekStart).
  limit(500);
  return data || [];
}

export async function adjustSupplyStock(itemId, delta, notes) {
  const adjustmentId = randomUUID()
  if (!state.isOnline) {
    const numericDelta = Number(delta)
    if (!Number.isFinite(numericDelta) || numericDelta === 0) return { success: false, error: 'Enter a non-zero stock adjustment.' }
    const before = readCache('supply-items').find((row) => row?.id === itemId)
    const updated = patchSupplyItemStock(itemId, (row) => ({
      ...row,
      current_stock: Math.max(0, Number(row.current_stock || 0) + numericDelta)
    }))
    if (!updated) return { success: false, error: 'Supply item not found in offline cache' }
    upsertSupplyMovement({
      id: adjustmentId,
      item_id: itemId,
      movement_type: numericDelta >= 0 ? 'adjustment_increase' : 'adjustment_decrease',
      quantity: numericDelta,
      unit_cost: Number(before?.latest_unit_cost || 0),
      total_cost: numericDelta * Number(before?.latest_unit_cost || 0),
      notes: notes || null,
      _pending_sync: true,
      _sync_state: 'pending'
    })
    queueOperation('rpc', 'adjust_supply_stock', {
      p_item_id: itemId,
      p_lodge_id: state.lodgeId,
      p_delta: numericDelta,
      p_notes: notes || null,
      p_adjustment_id: adjustmentId
    }, null, {
      _queue_id: `supply-adjust-${adjustmentId}`,
      ...(before?._pending_sync ? { _depends_on: `supply-item-${itemId}` } : {})
    })
    return { success: true, new_stock: updated.current_stock, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('adjust_supply_stock', {
    p_item_id: itemId,
    p_lodge_id: state.lodgeId,
    p_delta: Number(delta),
    p_notes: notes || null,
    p_adjustment_id: adjustmentId
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not adjust supply stock');
  const cached = readCache('supply-items');
  writeCache('supply-items', cached.map((row) => row.id === itemId ?
  { ...row, current_stock: result?.new_stock ?? row.current_stock } :
  row
  ));
  return { success: true, new_stock: result?.new_stock };
}

export async function getRoomSupplyStock() {
  try {
    const { data, error } = await state.supabase.
    from('room_supply_room_stock').
    select('*, rooms(room_number, room_type), supply_items(name, unit, category)').
    eq('lodge_id', state.lodgeId).
    order('updated_at', { ascending: false });
    if (error) throw error;
    const rows = (data || []).map((row) => ({
      ...row,
      room_number: row.rooms?.room_number,
      room_type: row.rooms?.room_type,
      supply_name: row.supply_items?.name,
      supply_unit: row.supply_items?.unit,
      supply_category: row.supply_items?.category
    }));
    writeCache('room-supply-stock', rows);
    return rows;
  } catch (error) {
    const cached = readCache('room-supply-stock');
    if (cached.length > 0) {
      console.warn('getRoomSupplyStock falling back to cache:', error?.message || error);
      return cached;
    }
    if (!state.isOnline) return [];
    throw new Error(error?.message || 'Failed to load room supply stock');
  }
}

export async function loadSupplyToRoom(data) {
  const operationId = data.operation_id || randomUUID()
  const payload = {
    operation_id: operationId,
    lodge_id: state.lodgeId,
    item_id: data.item_id,
    room_id: data.room_id,
    quantity: Number(data.quantity),
    reorder_level: Number(data.reorder_level || 0),
    notes: data.notes || null
  };
  if (!state.isOnline) {
    const item = readCache('supply-items').find((row) => row?.id === data.item_id)
    if (!item) return { success: false, error: 'Supply item not found in offline cache' }
    const qty = Number(data.quantity)
    if (qty <= 0) return { success: false, error: 'Quantity must be greater than zero' }
    if (Number(item.current_stock || 0) < qty) return { success: false, error: 'Not enough store stock available for this load' }
    const updatedStore = patchSupplyItemStock(data.item_id, (row) => ({
      ...row,
      current_stock: Number(row.current_stock || 0) - qty
    }))
    const updatedRoom = patchRoomSupplyStock({ itemId: data.item_id, roomId: data.room_id, delta: qty, reorderLevel: data.reorder_level })
    const movementId = operationId
    upsertSupplyMovement({
      id: movementId,
      item_id: data.item_id,
      room_id: data.room_id,
      movement_type: 'load_to_room',
      quantity: qty,
      notes: data.notes || null,
      _pending_sync: true,
      _sync_state: 'pending'
    })
    queueOperation('rpc', 'load_supply_to_room', { payload }, null, {
      _queue_id: `room-supply-load-${movementId}`,
      ...(item?._pending_sync ? { _depends_on: `supply-item-${data.item_id}` } : {})
    })
    return { success: true, new_store_stock: updatedStore.current_stock, new_room_stock: updatedRoom.quantity_on_hand, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('load_supply_to_room', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not load supply to room');
  return {
    success: true,
    new_store_stock: result?.new_store_stock,
    new_room_stock: result?.new_room_stock
  };
}

export async function useSupplyInRoom(data) {
  const operationId = data.operation_id || randomUUID()
  const payload = {
    operation_id: operationId,
    lodge_id: state.lodgeId,
    item_id: data.item_id,
    room_id: data.room_id,
    quantity: Number(data.quantity),
    notes: data.notes || null
  };
  if (!state.isOnline) {
    const qty = Number(data.quantity)
    if (qty <= 0) return { success: false, error: 'Quantity must be greater than zero' }
    const currentRoom = readCache('room-supply-stock').find((row) => row?.supply_item_id === data.item_id && row?.room_id === data.room_id)
    if (!currentRoom || Number(currentRoom.quantity_on_hand || 0) < qty) {
      return { success: false, error: 'Not enough room stock available' }
    }
    const updatedRoom = patchRoomSupplyStock({ itemId: data.item_id, roomId: data.room_id, delta: -qty })
    const movementId = operationId
    upsertSupplyMovement({
      id: movementId,
      item_id: data.item_id,
      room_id: data.room_id,
      movement_type: 'use',
      quantity: qty,
      notes: data.notes || null,
      _pending_sync: true,
      _sync_state: 'pending'
    })
    queueOperation('rpc', 'use_room_supply_stock', { payload }, null, {
      _queue_id: `room-supply-use-${movementId}`
    })
    return { success: true, new_room_stock: updatedRoom.quantity_on_hand, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('use_room_supply_stock', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not record supply usage');
  return {
    success: true,
    new_room_stock: result?.new_room_stock
  };
}

export async function returnSupplyFromRoom(data) {
  const operationId = data.operation_id || randomUUID()
  const payload = {
    operation_id: operationId,
    lodge_id: state.lodgeId,
    item_id: data.item_id,
    room_id: data.room_id,
    quantity: Number(data.quantity),
    notes: data.notes || null
  };
  if (!state.isOnline) {
    const qty = Number(data.quantity)
    if (qty <= 0) return { success: false, error: 'Quantity must be greater than zero' }
    const currentRoom = readCache('room-supply-stock').find((row) => row?.supply_item_id === data.item_id && row?.room_id === data.room_id)
    if (!currentRoom || Number(currentRoom.quantity_on_hand || 0) < qty) {
      return { success: false, error: 'Not enough room stock available to return' }
    }
    const updatedRoom = patchRoomSupplyStock({ itemId: data.item_id, roomId: data.room_id, delta: -qty })
    const updatedStore = patchSupplyItemStock(data.item_id, (row) => ({
      ...row,
      current_stock: Number(row.current_stock || 0) + qty
    }))
    const movementId = operationId
    upsertSupplyMovement({
      id: movementId,
      item_id: data.item_id,
      room_id: data.room_id,
      movement_type: 'return_to_store',
      quantity: qty,
      notes: data.notes || null,
      _pending_sync: true,
      _sync_state: 'pending'
    })
    queueOperation('rpc', 'return_room_supply_to_store', { payload }, null, {
      _queue_id: `room-supply-return-${movementId}`
    })
    return { success: true, new_room_stock: updatedRoom.quantity_on_hand, new_store_stock: updatedStore?.current_stock, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('return_room_supply_to_store', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not return unused supply');
  return {
    success: true,
    new_room_stock: result?.new_room_stock,
    new_store_stock: result?.new_store_stock
  };
}

export async function getSupplyMovements(limit = 40) {
  try {
    const { data, error } = await state.supabase.
    from('room_supply_movements').
    select('*, rooms(room_number, room_type), supply_items(name, unit, category)').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }).
    limit(Number(limit || 40));
    if (error) throw error;
    const rows = (data || []).map((row) => ({
      ...row,
      room_number: row.rooms?.room_number,
      room_type: row.rooms?.room_type,
      supply_name: row.supply_items?.name,
      supply_unit: row.supply_items?.unit,
      supply_category: row.supply_items?.category
    }));
    writeCache('room-supply-movements', rows);
    return rows;
  } catch (error) {
    const cached = readCache('room-supply-movements');
    if (cached.length > 0) {
      console.warn('getSupplyMovements falling back to cache:', error?.message || error);
      return cached.slice(0, Number(limit || 40));
    }
    if (!state.isOnline) return [];
    throw new Error(error?.message || 'Failed to load supply movements');
  }
}

export async function getSupplyStocktakes(limit = 12) {
  if (!state.isOnline) return readSupplyStocktakeHeaders('supply-stocktakes').slice(0, Number(limit || 12));
  const { data, error } = await state.supabase.
  from('supply_stocktakes').
  select('*').
  eq('lodge_id', state.lodgeId).
  order('created_at', { ascending: false }).
  limit(Number(limit || 12));
  if (error) throw new Error(error.message);
  writeCache('supply-stocktakes', data || []);
  return data || [];
}

export async function getRoomSupplyStocktakes(limit = 12) {
  if (!state.isOnline) return readSupplyStocktakeHeaders('room-supply-stocktakes').slice(0, Number(limit || 12));
  const { data, error } = await state.supabase.
  from('room_supply_stocktakes').
  select('*').
  eq('lodge_id', state.lodgeId).
  order('created_at', { ascending: false }).
  limit(Number(limit || 12));
  if (error) throw new Error(error.message);
  writeCache('room-supply-stocktakes', data || []);
  return data || [];
}

export async function createSupplyStocktakeSession(data = {}) {
  const id = data.id || randomUUID()
  const payload = {
    id,
    lodge_id: state.lodgeId,
    title: data.title || null,
    notes: data.notes || null,
    created_by: state.currentUser?.id || null
  };
  if (!state.isOnline) {
    const now = new Date().toISOString()
    const header = { ...payload, id, status: 'draft', created_at: now, updated_at: now, _pending_sync: true, _sync_state: 'pending', _sync_error: null }
    const lines = buildStoreSupplyStocktakeLines(id)
    writeCache('supply-stocktakes', [header, ...readCache('supply-stocktakes').filter((row) => row?.id !== id)])
    writeCache('supply-stocktake-lines', [...lines, ...readCache('supply-stocktake-lines').filter((row) => row?.stocktake_id !== id)])
    queueOperation('rpc', 'create_supply_stocktake_session', { payload }, null, {
      _queue_id: `supply-stocktake-${id}`
    })
    return { success: true, id, stocktake_id: id, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('create_supply_stocktake_session', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not start supply stock take');
  return result;
}

export async function createRoomSupplyStocktakeSession(data = {}) {
  const id = data.id || randomUUID()
  const payload = {
    id,
    lodge_id: state.lodgeId,
    title: data.title || null,
    notes: data.notes || null,
    created_by: state.currentUser?.id || null
  };
  if (!state.isOnline) {
    const now = new Date().toISOString()
    const header = { ...payload, id, status: 'draft', created_at: now, updated_at: now, _pending_sync: true, _sync_state: 'pending', _sync_error: null }
    const lines = buildRoomSupplyStocktakeLines(id)
    writeCache('room-supply-stocktakes', [header, ...readCache('room-supply-stocktakes').filter((row) => row?.id !== id)])
    writeCache('room-supply-stocktake-lines', [...lines, ...readCache('room-supply-stocktake-lines').filter((row) => row?.stocktake_id !== id)])
    queueOperation('rpc', 'create_room_supply_stocktake_session', { payload }, null, {
      _queue_id: `room-supply-stocktake-${id}`
    })
    return { success: true, id, stocktake_id: id, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('create_room_supply_stocktake_session', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not start room stock take');
  return result;
}

export async function getSupplyStocktakeSession(stocktakeId) {
  if (!state.isOnline) {
    const header = readCache('supply-stocktakes').find((row) => row?.id === stocktakeId)
    if (!header) return null
    return {
      ...header,
      lines: readCache('supply-stocktake-lines')
        .filter((line) => line?.stocktake_id === stocktakeId)
        .sort((a, b) => String(a.item_name || '').localeCompare(String(b.item_name || '')))
    }
  }
  const [{ data: header, error: headerError }, { data: lines, error: linesError }] = await Promise.all([
  state.supabase.
  from('supply_stocktakes').
  select('*').
  eq('lodge_id', state.lodgeId).
  eq('id', stocktakeId).
  maybeSingle(),
  state.supabase.
  from('supply_stocktake_lines').
  select('*, supply_items(name, category, unit)').
  eq('lodge_id', state.lodgeId).
  eq('stocktake_id', stocktakeId).
  order('created_at', { ascending: true })]
  );
  if (headerError) throw new Error(headerError.message);
  if (linesError) throw new Error(linesError.message);
  if (!header) return null;
  return {
    ...header,
    lines: (lines || []).map((line) => ({
      ...line,
      line_key: line.item_id,
      item_name: line.supply_items?.name || 'Item',
      item_category: line.supply_items?.category || 'Other',
      item_unit: line.supply_items?.unit || 'piece'
    }))
  };
}

export async function getSupplyStocktakeById(stocktakeId) {
  if (!stocktakeId) return null;
  if (!state.isOnline) return readCache('supply-stocktakes').find((row) => row?.id === stocktakeId) || null;
  try {
    const { data, error } = await state.supabase.
    from('supply_stocktakes').
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

export async function getRoomSupplyStocktakeSession(stocktakeId) {
  if (!state.isOnline) {
    const header = readCache('room-supply-stocktakes').find((row) => row?.id === stocktakeId)
    if (!header) return null
    return {
      ...header,
      lines: readCache('room-supply-stocktake-lines')
        .filter((line) => line?.stocktake_id === stocktakeId)
        .sort((a, b) => String(a.room_number || '').localeCompare(String(b.room_number || '')) || String(a.item_name || '').localeCompare(String(b.item_name || '')))
    }
  }
  const [{ data: header, error: headerError }, { data: lines, error: linesError }] = await Promise.all([
  state.supabase.
  from('room_supply_stocktakes').
  select('*').
  eq('lodge_id', state.lodgeId).
  eq('id', stocktakeId).
  maybeSingle(),
  state.supabase.
  from('room_supply_stocktake_lines').
  select('*, rooms(room_number, room_type), supply_items(name, category, unit)').
  eq('lodge_id', state.lodgeId).
  eq('stocktake_id', stocktakeId).
  order('created_at', { ascending: true })]
  );
  if (headerError) throw new Error(headerError.message);
  if (linesError) throw new Error(linesError.message);
  if (!header) return null;
  return {
    ...header,
    lines: (lines || []).map((line) => ({
      ...line,
      line_key: line.room_stock_id,
      room_number: line.rooms?.room_number || 'Room',
      room_type: line.rooms?.room_type || 'Room',
      item_name: line.supply_items?.name || 'Item',
      item_category: line.supply_items?.category || 'Other',
      item_unit: line.supply_items?.unit || 'piece'
    }))
  };
}

export async function getRoomSupplyStocktakeById(stocktakeId) {
  if (!stocktakeId) return null;
  if (!state.isOnline) return readCache('room-supply-stocktakes').find((row) => row?.id === stocktakeId) || null;
  try {
    const { data, error } = await state.supabase.
    from('room_supply_stocktakes').
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

export async function saveSupplyStocktakeCounts(stocktakeId, lines) {
  const payload = (Array.isArray(lines) ? lines : []).map((line) => ({
    item_id: line.item_id,
    counted_qty: line.counted_qty,
    notes: line.notes || null
  }));
  if (!state.isOnline) {
    const header = readCache('supply-stocktakes').find((row) => row?.id === stocktakeId)
    if (!header) return { success: false, error: 'Supply stocktake not found in offline cache' }
    const counts = new Map(payload.map((line) => [line.item_id, line]))
    writeCache('supply-stocktake-lines', readCache('supply-stocktake-lines').map((line) => {
      if (line.stocktake_id !== stocktakeId || !counts.has(line.item_id)) return line
      const count = counts.get(line.item_id)
      const counted = Number(count.counted_qty || 0)
      return { ...line, counted_qty: counted, variance_qty: counted - Number(line.expected_qty || 0), notes: count.notes || null, _pending_sync: true, _sync_state: 'pending', updated_at: new Date().toISOString() }
    }))
    queueOperation('rpc', 'save_supply_stocktake_counts', {
      p_stocktake_id: stocktakeId,
      p_lodge_id: state.lodgeId,
      p_lines: payload
    }, null, {
      _queue_id: `supply-stocktake-counts-${stocktakeId}-${Date.now()}`,
      ...(header?._pending_sync ? { _depends_on: `supply-stocktake-${stocktakeId}` } : {})
    })
    return { success: true, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('save_supply_stocktake_counts', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: state.lodgeId,
    p_lines: payload
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not save supply stock take');
  return result;
}

export async function saveRoomSupplyStocktakeCounts(stocktakeId, lines) {
  const payload = (Array.isArray(lines) ? lines : []).map((line) => ({
    room_stock_id: line.room_stock_id,
    counted_qty: line.counted_qty,
    notes: line.notes || null
  }));
  if (!state.isOnline) {
    const header = readCache('room-supply-stocktakes').find((row) => row?.id === stocktakeId)
    if (!header) return { success: false, error: 'Room supply stocktake not found in offline cache' }
    const counts = new Map(payload.map((line) => [line.room_stock_id, line]))
    writeCache('room-supply-stocktake-lines', readCache('room-supply-stocktake-lines').map((line) => {
      if (line.stocktake_id !== stocktakeId || !counts.has(line.room_stock_id)) return line
      const count = counts.get(line.room_stock_id)
      const counted = Number(count.counted_qty || 0)
      return { ...line, counted_qty: counted, variance_qty: counted - Number(line.expected_qty || 0), notes: count.notes || null, _pending_sync: true, _sync_state: 'pending', updated_at: new Date().toISOString() }
    }))
    queueOperation('rpc', 'save_room_supply_stocktake_counts', {
      p_stocktake_id: stocktakeId,
      p_lodge_id: state.lodgeId,
      p_lines: payload
    }, null, {
      _queue_id: `room-supply-stocktake-counts-${stocktakeId}-${Date.now()}`,
      ...(header?._pending_sync ? { _depends_on: `room-supply-stocktake-${stocktakeId}` } : {})
    })
    return { success: true, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('save_room_supply_stocktake_counts', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: state.lodgeId,
    p_lines: payload
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not save room stock take');
  return result;
}

export async function postSupplyStocktakeSession(stocktakeId, notes) {
  if (!state.isOnline) {
    const headers = readCache('supply-stocktakes')
    const header = headers.find((row) => row?.id === stocktakeId)
    if (!header) return { success: false, error: 'Supply stocktake not found in offline cache' }
    const lines = readCache('supply-stocktake-lines').filter((line) => line?.stocktake_id === stocktakeId && line.counted_qty !== null && line.counted_qty !== undefined)
    const counts = new Map(lines.map((line) => [line.item_id, line]))
    writeCache('supply-items', readCache('supply-items').map((item) => {
      const line = counts.get(item.id)
      if (!line) return item
      return { ...item, current_stock: Number(line.counted_qty || 0), _pending_sync: true, _sync_state: 'pending', _sync_error: null, updated_at: new Date().toISOString() }
    }))
    for (const line of lines) {
      upsertSupplyMovement({
        id: `supply-stocktake-${stocktakeId}-${line.item_id}`,
        item_id: line.item_id,
        movement_type: 'stocktake_adjustment',
        quantity: Number(line.counted_qty || 0) - Number(line.expected_qty || 0),
        notes: notes || line.notes || null,
        _pending_sync: true,
        _sync_state: 'pending'
      })
    }
    writeCache('supply-stocktakes', headers.map((row) => row.id === stocktakeId ? { ...row, status: 'posted', notes: notes || row.notes || null, posted_at: new Date().toISOString(), _pending_sync: true, _sync_state: 'pending', _sync_error: null, updated_at: new Date().toISOString() } : row))
    queueOperation('rpc', 'post_supply_stocktake_session', {
      p_stocktake_id: stocktakeId,
      p_lodge_id: state.lodgeId,
      p_notes: notes || null
    }, null, {
      _queue_id: `supply-stocktake-post-${stocktakeId}-${Date.now()}`,
      ...(header?._pending_sync ? { _depends_on: `supply-stocktake-${stocktakeId}` } : {})
    })
    return { success: true, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('post_supply_stocktake_session', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: state.lodgeId,
    p_notes: notes || null
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not post supply stock take');
  await getSupplyItems().catch(() => {});
  return result;
}

export async function postRoomSupplyStocktakeSession(stocktakeId, notes) {
  if (!state.isOnline) {
    const headers = readCache('room-supply-stocktakes')
    const header = headers.find((row) => row?.id === stocktakeId)
    if (!header) return { success: false, error: 'Room supply stocktake not found in offline cache' }
    const lines = readCache('room-supply-stocktake-lines').filter((line) => line?.stocktake_id === stocktakeId && line.counted_qty !== null && line.counted_qty !== undefined)
    const counts = new Map(lines.map((line) => [line.room_stock_id, line]))
    writeCache('room-supply-stock', readCache('room-supply-stock').map((stock) => {
      const key = stock.id || `${stock.room_id}:${stock.supply_item_id}`
      const line = counts.get(key)
      if (!line) return stock
      return { ...stock, quantity_on_hand: Number(line.counted_qty || 0), _pending_sync: true, _sync_state: 'pending', _sync_error: null, updated_at: new Date().toISOString() }
    }))
    for (const line of lines) {
      upsertSupplyMovement({
        id: `room-supply-stocktake-${stocktakeId}-${line.room_stock_id}`,
        item_id: line.item_id || line.supply_item_id,
        room_id: line.room_id,
        movement_type: 'room_stocktake_adjustment',
        quantity: Number(line.counted_qty || 0) - Number(line.expected_qty || 0),
        notes: notes || line.notes || null,
        _pending_sync: true,
        _sync_state: 'pending'
      })
    }
    writeCache('room-supply-stocktakes', headers.map((row) => row.id === stocktakeId ? { ...row, status: 'posted', notes: notes || row.notes || null, posted_at: new Date().toISOString(), _pending_sync: true, _sync_state: 'pending', _sync_error: null, updated_at: new Date().toISOString() } : row))
    queueOperation('rpc', 'post_room_supply_stocktake_session', {
      p_stocktake_id: stocktakeId,
      p_lodge_id: state.lodgeId,
      p_notes: notes || null
    }, null, {
      _queue_id: `room-supply-stocktake-post-${stocktakeId}-${Date.now()}`,
      ...(header?._pending_sync ? { _depends_on: `room-supply-stocktake-${stocktakeId}` } : {})
    })
    return { success: true, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('post_room_supply_stocktake_session', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: state.lodgeId,
    p_notes: notes || null
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not post room stock take');
  await getRoomSupplyStock().catch(() => {});
  await getSupplyMovements().catch(() => {});
  return result;
}

export async function addRoomSupplyStocktakeLine(stocktakeId, data = {}) {
  if (!state.isOnline) {
    const header = readCache('room-supply-stocktakes').find((row) => row?.id === stocktakeId)
    if (!header) return { success: false, error: 'Room supply stocktake not found in offline cache' }
    const room = readCache('rooms').find((row) => row?.id === data.room_id) || {}
    const item = readCache('supply-items').find((row) => row?.id === data.item_id) || {}
    const lineId = randomUUID()
    const line = {
      id: lineId,
      stocktake_id: stocktakeId,
      lodge_id: state.lodgeId,
      room_stock_id: lineId,
      room_id: data.room_id,
      item_id: data.item_id,
      supply_item_id: data.item_id,
      expected_qty: 0,
      counted_qty: Number(data.counted_qty || 0),
      variance_qty: Number(data.counted_qty || 0),
      notes: data.notes || null,
      line_key: lineId,
      room_number: room.room_number || 'Room',
      room_type: room.room_type || 'Room',
      item_name: item.name || 'Item',
      item_category: item.category || 'Other',
      item_unit: item.unit || 'piece',
      created_at: new Date().toISOString(),
      _pending_sync: true,
      _sync_state: 'pending'
    }
    writeCache('room-supply-stocktake-lines', [line, ...readCache('room-supply-stocktake-lines')])
    queueOperation('rpc', 'create_room_supply_stocktake_line', {
      p_line_id: lineId,
      p_stocktake_id: stocktakeId,
      p_lodge_id: state.lodgeId,
      p_room_id: data.room_id,
      p_supply_item_id: data.item_id,
      p_counted_qty: Number(data.counted_qty || 0),
      p_notes: data.notes || null
    }, null, {
      _queue_id: `room-supply-stocktake-line-${lineId}`,
      ...(header?._pending_sync ? { _depends_on: `room-supply-stocktake-${stocktakeId}` } : {})
    })
    return { success: true, id: lineId, offline: true, queued: true }
  }
  const { data: result, error } = await state.supabase.rpc('create_room_supply_stocktake_line', {
    p_line_id: data.line_id || null,
    p_stocktake_id: stocktakeId,
    p_lodge_id: state.lodgeId,
    p_room_id: data.room_id,
    p_supply_item_id: data.item_id,
    p_counted_qty: Number(data.counted_qty || 0),
    p_notes: data.notes || null
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not add this room stock count line');
  return result;
}

export async function getSupplySpend(startDate, endDate) {
  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.rpc('get_supply_spend_summary', {
        p_lodge_id: state.lodgeId,
        p_start_date: startDate,
        p_end_date: endDate
      });
      if (error) throw error;
      if (data && typeof data === 'object') {
        return {
          ...data,
          source: 'server',
          as_of_range: { start: startDate, end: endDate }
        };
      }
      throw new Error('Supply spend summary was empty.');
    } catch (error) {
      recordCriticalError('reports.supply_spend', error, {
        startDate,
        endDate,
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 });
    }
  }

  const supplyMap = new Map(readCache('supply-items').map((item) => [item.id, item]));
  const cachedPurchases = readCache('supply-purchases').
  filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate)).
  map((row) => ({
    ...row,
    supply_items: supplyMap.get(row.item_id) ?
    { name: supplyMap.get(row.item_id).name } :
    null
  })).
  sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  let purchases = [];
  try {
    const { data, error } = await state.supabase.
    from('supply_purchases').
    select('*, supply_items(name)').
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
      throw new Error(error?.message || 'Failed to load supply spend report');
    }
  }
  const total = purchases.reduce((s, p) => s + Number(p.total_cost || 0), 0);
  return {
    total,
    purchases,
    source: 'local',
    as_of_range: { start: startDate, end: endDate }
  };
}
