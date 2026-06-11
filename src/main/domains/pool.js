import { randomUUID } from 'crypto'
import { state } from '../state.js'
import { checkExclusiveEventConflict } from './bookings.js'
import { logActivity } from './operationalLog.js'
import { MAX_FINANCIAL_AMOUNT } from './shared.js'
import {
  applyOfflineDayUseInventoryReservation,
  queueOperation,
  readCache,
  restoreOfflineDayUseInventoryReservation,
  writeCache
} from './infrastructure.js'
import { readFailedSyncQueue, readSyncQueue, writeFailedSyncQueue, writeSyncQueue } from './syncStore.js'
import { patchQueuedDayUseEntryPayload } from './dayUseDrafts.js'
import {
  computeDayUseBaseTotal,
  computeDayUseEndTime,
  findDayUseResourceConflict,
  normalizeDayUsePricingMode,
  normalizeDayUseStatus
} from '../../shared/dayUseConfig.js'

const POOL_DAY_USE_LIST_SELECT = 'id, date, resource_key, resource_name, start_time, end_time, status, total, adults, children, notes, created_at, updated_at, deposit_amount, balance_due, fee_per_adult, fee_per_child, flat_fee, hourly_rate, package_fee, pricing_mode, created_by';

function adjustLocalInventoryExtras(extras = [], direction = -1) {
  const usage = new Map();
  for (const entry of extras || []) {
    if (!entry?.inventory_item_id) continue;
    const quantity = Math.max(0, Number(entry.quantity || 0));
    if (!quantity) continue;
    usage.set(entry.inventory_item_id, (usage.get(entry.inventory_item_id) || 0) + quantity);
  }
  if (usage.size === 0) return;
  writeCache('inventory-items', readCache('inventory-items').map((item) => {
    const quantity = usage.get(item?.id) || 0;
    if (!quantity) return item;
    return {
      ...item,
      current_stock: Math.max(0, Number(item.current_stock || 0) + direction * quantity)
    };
  }), { source: 'local' });
}

async function getComparableDayUseEntriesForDate(date) {
  if (!date) return []
  if (!state.isOnline) return readCache('pool-day-use').filter((row) => row?.date === date)
  const { data, error } = await state.supabase
    .from('pool_day_use')
    .select('id, date, resource_key, resource_name, start_time, end_time, status, total, adults, children, notes, created_at, updated_at')
    .eq('lodge_id', state.lodgeId)
    .eq('date', date)
    .limit(200);
  if (error) throw new Error(error.message);
  return data || [];
}

async function assertResourceAvailability(payload = {}, excludeId = null) {
  const resourceIdentity = String(payload?.resource_key || payload?.resource_name || '').trim();
  if (!resourceIdentity) return;
  const entries = await getComparableDayUseEntriesForDate(payload.date);
  const conflict = findDayUseResourceConflict(entries, payload, excludeId);
  if (!conflict) return;
  const start = conflict?.start_time ? `${conflict.start_time}${conflict?.end_time ? `-${conflict.end_time}` : ''}` : 'time not set';
  throw new Error(`"${conflict.resource_name || resourceIdentity}" is already assigned for ${payload.date} (${start}). Choose another time or resource.`);
}

function patchLocalQueuedDayUseEntry(id, update = {}) {
  const patchQueue = (queue = []) => {
    let updated = false;
    let nextQueue = (Array.isArray(queue) ? queue : []).map((item) => {
      if (item?.type === 'update' && item?.table === 'pool_day_use' && item?.id === id) {
        updated = true;
        return {
          ...item,
          data: {
            ...(item.data || {}),
            ...update
          }
        };
      }
      return item;
    });
    if (!updated) {
      const draftResult = patchQueuedDayUseEntryPayload(nextQueue, id, update);
      updated = draftResult.updated;
      nextQueue = draftResult.queue;
    }
    return { updated, queue: nextQueue };
  };

  const queuedResult = patchQueue(readSyncQueue());
  if (queuedResult.updated) writeSyncQueue(queuedResult.queue);
  const failedResult = patchQueue(readFailedSyncQueue());
  if (failedResult.updated) writeFailedSyncQueue(failedResult.queue);
  return queuedResult.updated || failedResult.updated;
}

async function updatePoolDayUseEntryFields(id, update = {}) {
  if (!id) throw new Error('Day-use entry ID is required');
  const cachedEntries = readCache('pool-day-use');
  const existing = cachedEntries.find((row) => row.id === id);
  if (!existing) throw new Error('Day-use entry could not be found.');
  const nextEntry = { ...existing, ...update };

  if (state.isOnline) {
    if (Object.prototype.hasOwnProperty.call(update, 'resource_name') || Object.prototype.hasOwnProperty.call(update, 'resource_key') || Object.prototype.hasOwnProperty.call(update, 'start_time') || Object.prototype.hasOwnProperty.call(update, 'duration_hours') || Object.prototype.hasOwnProperty.call(update, 'date')) {
      await assertResourceAvailability(nextEntry, id);
    }
    const { data, error } = await state.supabase
      .from('pool_day_use')
      .update(update)
      .eq('id', id)
      .eq('lodge_id', state.lodgeId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    writeCache('pool-day-use', cachedEntries.map((row) => row.id === id ? { ...row, ...data } : row), { source: 'local' });
    return { success: true, offline: false, entry: { ...existing, ...data } };
  }

  const patchedQueuedDraft = patchLocalQueuedDayUseEntry(id, update);
  if (!patchedQueuedDraft) {
    queueOperation('update', 'pool_day_use', update, id, {
      _queue_id: `dayuse-update-${id}`,
      ...(existing?._pending_sync ? { _depends_on: `dayuse-${id}` } : {})
    });
  }
  writeCache('pool-day-use', cachedEntries.map((row) => row.id === id ? {
    ...row,
    ...update,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null
  } : row), { source: 'local' });
  return { success: true, offline: true, entry: { ...nextEntry, _pending_sync: true, _sync_state: 'pending', _sync_error: null } };
}

// ─── POOL / DAY USE ────────────────────────────────────────────────────────────

export async function getPoolDayUse(start, end) {
  const cached = readCache('pool-day-use');
  if (!state.isOnline) {
    return cached.
    filter((row) => (!start || String(row.date || '') >= start) && (!end || String(row.date || '') <= end)).
    sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }
  let q = state.supabase.from('pool_day_use').select(POOL_DAY_USE_LIST_SELECT).eq('lodge_id', state.lodgeId);
  if (start) q = q.gte('date', start);
  if (end) q = q.lte('date', end);
  const { data } = await q.order('date', { ascending: false }).order('created_at', { ascending: false }).limit(500);
  if (data) writeCache('pool-day-use', data, { source: 'remote' });
  return data || [];
}

export async function getPoolDayUseById(id) {
  if (!id) return null;
  if (!state.isOnline) return readCache('pool-day-use').find((row) => row.id === id) || null;
  const { data, error } = await state.supabase.
  from('pool_day_use').
  select('*').
  eq('lodge_id', state.lodgeId).
  eq('id', id).
  single();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function addPoolDayUse(data) {
  await checkExclusiveEventConflict(data.date, data.date + 'T23:59:59');
  if (
    Number(data.fee_per_adult || 0) < 0 ||
    Number(data.fee_per_child || 0) < 0 ||
    Number(data.flat_fee || 0) < 0 ||
    Number(data.hourly_rate || 0) < 0 ||
    Number(data.package_fee || 0) < 0 ||
    Number(data.deposit_amount || 0) < 0
  ) {
    throw new Error('Day-use pricing values cannot be negative');
  }
  if (
    Number(data.fee_per_adult || 0) > MAX_FINANCIAL_AMOUNT ||
    Number(data.fee_per_child || 0) > MAX_FINANCIAL_AMOUNT ||
    Number(data.flat_fee || 0) > MAX_FINANCIAL_AMOUNT ||
    Number(data.hourly_rate || 0) > MAX_FINANCIAL_AMOUNT ||
    Number(data.package_fee || 0) > MAX_FINANCIAL_AMOUNT ||
    Number(data.deposit_amount || 0) > MAX_FINANCIAL_AMOUNT
  ) {
    throw new Error(`Day-use pricing values cannot exceed P${MAX_FINANCIAL_AMOUNT.toLocaleString('en-BW')}`);
  }
  const inventoryById = new Map(readCache('inventory-items').map((item) => [item.id, item]));
  const extras = (Array.isArray(data.extras) ? data.extras : []).map((entry) => {
    const quantity = Math.max(0, Number(entry?.quantity || 0));
    const unitPrice = Math.max(0, Number(entry?.unit_price || 0));
    const inventoryItemId = entry?.inventory_item_id || null;
    const linkedInventory = inventoryItemId ? inventoryById.get(inventoryItemId) : null;
    const name = String(entry?.name || linkedInventory?.name || 'Extra').trim() || 'Extra';
    if (inventoryItemId && !linkedInventory) {
      throw new Error(`Inventory item for "${name}" could not be found.`);
    }
    if (inventoryItemId && quantity > Number(linkedInventory?.current_stock || 0)) {
      throw new Error(`Not enough stock for "${name}".`);
    }
    return {
      inventory_item_id: inventoryItemId,
      name,
      quantity,
      unit_price: unitPrice,
      subtotal: quantity * unitPrice,
      unit: linkedInventory?.unit || entry?.unit || null
    };
  }).filter((entry) => entry.quantity > 0 && (entry.inventory_item_id || entry.name));
  const pricingMode = normalizeDayUsePricingMode(data.pricing_mode);
  const durationHours = Math.max(0, Number(data.duration_hours || 0));
  const resourceKey = String(data.resource_key || '').trim() || null;
  const resourceName = String(data.resource_name || '').trim() || null;
  const baseTotal = computeDayUseBaseTotal({
    ...data,
    pricing_mode: pricingMode,
    duration_hours: durationHours
  });
  const extrasTotal = extras.reduce((sum, entry) => sum + Number(entry.subtotal || 0), 0);
  const total = baseTotal + extrasTotal;
  const depositAmount = Math.min(Math.max(0, Number(data.deposit_amount || 0)), total);
  const balanceDue = Math.max(0, total - depositAmount);
  await assertResourceAvailability({
    ...data,
    resource_key: resourceKey,
    resource_name: resourceName,
    duration_hours: durationHours
  });
  const id = randomUUID();
  const payload = {
    id,
    lodge_id: state.lodgeId,
    date: data.date,
    guest_name: data.guest_name || 'Walk-in',
    phone: data.phone || null,
    adults: data.adults || 1,
    children: data.children || 0,
    fee_per_adult: data.fee_per_adult || 0,
    fee_per_child: data.fee_per_child || 0,
    template_key: data.template_key || null,
    template_name: data.template_name || null,
    activity_type: data.activity_type || 'pool',
    includes_pool: data.includes_pool !== false,
    includes_facility_access: data.includes_facility_access === true,
    includes_braai: data.includes_braai === true,
    status: normalizeDayUseStatus(data.status),
    start_time: data.start_time || null,
    end_time: data.end_time || computeDayUseEndTime(data.start_time, durationHours) || null,
    duration_hours: durationHours,
    pricing_mode: pricingMode,
    flat_fee: Number(data.flat_fee || 0),
    hourly_rate: Number(data.hourly_rate || 0),
    package_name: data.package_name || null,
    package_fee: Number(data.package_fee || 0),
    base_total: baseTotal,
    extras_total: extrasTotal,
    extras,
    total,
    deposit_amount: depositAmount,
    balance_due: balanceDue,
    resource_key: resourceKey,
    resource_name: resourceName,
    resource_type: data.resource_type || null,
    service_notes: data.service_notes || null,
    payment_method: data.payment_method || 'cash',
    notes: data.notes || null
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('add_pool_day_use', { payload });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not add pool day-use entry');
    if (extras.length > 0) adjustLocalInventoryExtras(extras, -1);
    writeCache('pool-day-use', [payload, ...readCache('pool-day-use').filter((row) => row.id !== id)], { source: 'local' });
    logActivity('pool_day_use_added', `Day use · ${data.guest_name || 'Walk-in'} · ${data.date} · P${total}`);
    return { id: result.id || id };
  }
  const offlineRow = {
    ...payload,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    created_at: new Date().toISOString()
  };
  writeCache('pool-day-use', [offlineRow, ...readCache('pool-day-use').filter((row) => row.id !== id)], { source: 'local' });
  if (extras.length > 0) {
    applyOfflineDayUseInventoryReservation(extras);
  }
  queueOperation('rpc', 'add_pool_day_use', { payload }, null, {
    _queue_id: `dayuse-${id}`
  });
  logActivity('pool_day_use_added', `(Offline) Day use · ${data.guest_name || 'Walk-in'} · ${data.date} · P${total}`);
  return { id };
}

export async function updatePoolDayUseStatus(id, status) {
  const normalizedStatus = normalizeDayUseStatus(status);
  const result = await updatePoolDayUseEntryFields(id, { status: normalizedStatus });
  return { success: true, status: normalizedStatus, offline: result.offline === true };
}

export async function settlePoolDayUseBalance(id, method = 'Cash', markCompleted = true) {
  if (!id) throw new Error('Day-use entry ID is required');
  const existing = readCache('pool-day-use').find((row) => row.id === id);
  if (!existing) throw new Error('Day-use entry could not be found.');
  const total = Number(existing.total || 0);
  const update = {
    deposit_amount: total,
    balance_due: 0,
    payment_method: method || existing.payment_method || 'Cash',
    ...(markCompleted ? { status: 'completed' } : {})
  };
  const result = await updatePoolDayUseEntryFields(id, update);
  logActivity(
    'pool_day_use_balance_settled',
    `${result.offline ? '(Offline) ' : ''}Day use balance settled · ${existing.guest_name || 'Walk-in'} · ${existing.date} · P${Math.max(0, Number(existing.balance_due || 0)).toFixed(2)}`
  );
  return {
    success: true,
    offline: result.offline === true,
    status: markCompleted ? 'completed' : existing.status,
    balance_due: 0,
    payment_method: update.payment_method
  };
}

export async function deletePoolDayUse(id) {
  if (!id) throw new Error('Pool day-use ID is required');
  if (!state.isOnline) {
    const cached = readCache('pool-day-use');
    const existing = cached.find((row) => row.id === id);
    const dependsOn = existing?._pending_sync ? `dayuse-${id}` : null;
    if (Array.isArray(existing?.extras) && existing.extras.length > 0) {
      restoreOfflineDayUseInventoryReservation(existing.extras);
    }
    writeCache('pool-day-use', cached.filter((row) => row.id !== id), { source: 'local' });
    queueOperation('rpc', 'delete_pool_day_use', {
      p_id: id,
      p_lodge_id: state.lodgeId
    }, null, {
      ...(dependsOn ? { _depends_on: dependsOn } : {}),
      _inventory_extras: Array.isArray(existing?.extras) ? existing.extras : []
    });
    return { success: true };
  }
  const existing = await getPoolDayUseById(id);
  const { data: result, error } = await state.supabase.rpc('delete_pool_day_use', {
    p_id: id,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not delete pool day-use entry');
  if (Array.isArray(existing?.extras) && existing.extras.length > 0) adjustLocalInventoryExtras(existing.extras, 1);
  writeCache('pool-day-use', readCache('pool-day-use').filter((row) => row.id !== id), { source: 'local' });
  return { success: true };
}

export async function getPoolDayUseSummary(date) {
  const entries = state.isOnline ?
  (await state.supabase.from('pool_day_use').select('*').eq('lodge_id', state.lodgeId).eq('date', date)).data || [] :
  readCache('pool-day-use').filter((row) => row.date === date);
  return {
    total: entries.reduce((s, e) => s + (e.total || 0), 0),
    adults: entries.reduce((s, e) => s + (e.adults || 0), 0),
    children: entries.reduce((s, e) => s + (e.children || 0), 0),
    entries
  };
}
