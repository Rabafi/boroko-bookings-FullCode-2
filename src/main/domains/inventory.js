import { state } from '../state.js'
import { recordCriticalError } from './operationalLog.js'
import {
  applyQueuedPosInventoryReservations,
  readCache,
  writeCache
} from './infrastructure.js'

// ─── INVENTORY ────────────────────────────────────────────────────────────────

export async function getInventoryItems() {
  if (state.isOnline) {
    const { data, error } = await state.supabase.
    from('inventory_items').
    select('*').
    eq('lodge_id', state.lodgeId).
    order('category').
    order('name');
    if (!error) {
      if (!data || data.length === 0) {
        const cached = readCache('inventory-items');
        if (cached.length > 0) {
          console.warn('getInventoryItems received empty live result; using cached inventory items instead');
          return cached;
        }
      }
      const rows = applyQueuedPosInventoryReservations(data || []);
      writeCache('inventory-items', rows);
      return rows;
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
  const item = {
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
    writeCache('inventory-items', [...cached, { ...item, id: result?.id }]);
    return { success: true, id: result?.id };
  }
  return { success: false, error: 'Requires internet connection' };
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
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('item_id', itemId).
    order('date', { ascending: false });
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
    select('*').
    eq('lodge_id', state.lodgeId).
    order('date', { ascending: false });
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
  if (!state.isOnline) return { success: false, error: 'Requires internet connection' };
  const { data: result, error } = await state.supabase.rpc('adjust_inventory_stock', {
    p_item_id: itemId,
    p_lodge_id: state.lodgeId,
    p_delta: Number(delta),
    p_notes: notes || null
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not adjust inventory stock');
  // Update cache with RPC result. Treat cache failures as non-fatal (backend is source of truth).
  try {
    const cached = readCache('inventory-items');
    writeCache('inventory-items', cached.map((row) => row.id === itemId ?
    { ...row, current_stock: result?.new_stock ?? row.current_stock } :
    row
    ));
  } catch (e) {
    console.warn('[INVENTORY] Cache update failed after RPC succeeded:', e);
    // Continue anyway — the backend state is correct, cache is secondary
  }
  return { success: true, new_stock: result?.new_stock };
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
