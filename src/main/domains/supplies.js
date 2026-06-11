import { state } from '../state.js'
import { recordCriticalError } from './operationalLog.js'
import {
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js'

// ─── ROOM SUPPLIES ────────────────────────────────────────────────────────────

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
      return cached;
    }
    writeCache('supply-items', data || []);
    return data || [];
  } catch (error) {
    const cached = readCache('supply-items');
    if (cached.length > 0) {
      console.warn('getSupplyItems falling back to cache:', error?.message || error);
      return cached;
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
  const item = {
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
  return { success: false, error: 'Requires internet connection' };
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
  return { success: false, error: 'Requires internet connection' };
}

export async function deleteSupplyItem(id) {
  if (!state.isOnline) throw new Error('No internet connection. Please check your connection and try again.');
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const rows = allocations.
  filter((a) => Number(a.units_used) > 0).
  map((a) => ({
    lodge_id: state.lodgeId,
    supply_item_id: a.supply_item_id,
    room_id: a.room_id,
    week_start: weekStart,
    units_used: Number(a.units_used),
    unit_cost: Number(a.unit_cost),
    total_cost: Number(a.units_used) * Number(a.unit_cost)
  }));
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
  if (!state.isOnline) return [];
  const { data } = await state.supabase.
  from('room_supply_allocations').
  select('id, room_id, item_id, quantity, week_start, lodge_id, created_at, updated_at').
  eq('lodge_id', state.lodgeId).
  eq('week_start', weekStart).
  limit(500);
  return data || [];
}

export async function adjustSupplyStock(itemId, delta, notes) {
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const { data: result, error } = await state.supabase.rpc('adjust_supply_stock', {
    p_item_id: itemId,
    p_lodge_id: state.lodgeId,
    p_delta: Number(delta),
    p_notes: notes || null
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const payload = {
    lodge_id: state.lodgeId,
    item_id: data.item_id,
    room_id: data.room_id,
    quantity: Number(data.quantity),
    reorder_level: Number(data.reorder_level || 0),
    notes: data.notes || null
  };
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const payload = {
    lodge_id: state.lodgeId,
    item_id: data.item_id,
    room_id: data.room_id,
    quantity: Number(data.quantity),
    notes: data.notes || null
  };
  const { data: result, error } = await state.supabase.rpc('use_room_supply_stock', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not record supply usage');
  return {
    success: true,
    new_room_stock: result?.new_room_stock
  };
}

export async function returnSupplyFromRoom(data) {
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const payload = {
    lodge_id: state.lodgeId,
    item_id: data.item_id,
    room_id: data.room_id,
    quantity: Number(data.quantity),
    notes: data.notes || null
  };
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
  if (!state.isOnline) return [];
  const { data, error } = await state.supabase.
  from('supply_stocktakes').
  select('*').
  eq('lodge_id', state.lodgeId).
  order('created_at', { ascending: false }).
  limit(Number(limit || 12));
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getRoomSupplyStocktakes(limit = 12) {
  if (!state.isOnline) return [];
  const { data, error } = await state.supabase.
  from('room_supply_stocktakes').
  select('*').
  eq('lodge_id', state.lodgeId).
  order('created_at', { ascending: false }).
  limit(Number(limit || 12));
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createSupplyStocktakeSession(data = {}) {
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const payload = {
    lodge_id: state.lodgeId,
    title: data.title || null,
    notes: data.notes || null,
    created_by: state.currentUser?.id || null
  };
  const { data: result, error } = await state.supabase.rpc('create_supply_stocktake_session', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not start supply stock take');
  return result;
}

export async function createRoomSupplyStocktakeSession(data = {}) {
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const payload = {
    lodge_id: state.lodgeId,
    title: data.title || null,
    notes: data.notes || null,
    created_by: state.currentUser?.id || null
  };
  const { data: result, error } = await state.supabase.rpc('create_room_supply_stocktake_session', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not start room stock take');
  return result;
}

export async function getSupplyStocktakeSession(stocktakeId) {
  if (!state.isOnline) return null;
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
  if (!state.isOnline) return null;
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const payload = (Array.isArray(lines) ? lines : []).map((line) => ({
    item_id: line.item_id,
    counted_qty: line.counted_qty,
    notes: line.notes || null
  }));
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const payload = (Array.isArray(lines) ? lines : []).map((line) => ({
    room_stock_id: line.room_stock_id,
    counted_qty: line.counted_qty,
    notes: line.notes || null
  }));
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const { data: result, error } = await state.supabase.rpc('create_room_supply_stocktake_line', {
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
