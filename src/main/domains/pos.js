import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { state } from '../state.js'
import { getRoleCapabilities, isPosFullAccessRole, normalizeAppRole } from '../../shared/accessControl.js'
import { getActiveBookingForRoom } from './bookings.js'
import { recordCriticalError } from './operationalLog.js'
import { normalizeUserRecord } from './shared.js'
import {
  applyOfflinePosInventoryReservation,
  getOfflinePosInventoryReservation,
  patchCachedPosOrderSyncState,
  queueOperation,
  readCache,
  readLocalPosVoidHistory,
  refreshCache,
  restoreOfflinePosInventoryReservation,
  upsertLocalPosVoidHistory,
  writeCache
} from './infrastructure.js'

function isReadOnlySessionTouchError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('read-only transaction') && message.includes('update');
}

function buildReadOnlySessionTouchMessage(featureLabel = 'This screen') {
  return `${featureLabel} is hitting an older database read path that still tries to write during a SELECT. Apply the latest session and entitlement read-only SQL fixes in Supabase, then reload the app.`;
}

function applyPosMenuOutletFilter(rows = [], outletFilter = null) {
  if (outletFilter !== null && outletFilter.length === 0) return [];
  if (outletFilter !== null) {
    return (rows || []).filter((item) => !item.outlet_id || outletFilter.includes(item.outlet_id));
  }
  return rows || [];
}

function applyPosOrderFilters(rows = [], startDate, endDate, outletFilter = null) {
  let filtered = rows || [];
  if (startDate) {
    filtered = filtered.filter((order) => String(order.created_at || '') >= startDate);
  }
  if (endDate) {
    const endBoundary = `${endDate}T23:59:59`;
    filtered = filtered.filter((order) => String(order.created_at || '') <= endBoundary);
  }
  if (outletFilter !== null && outletFilter.length === 0) return [];
  if (outletFilter !== null) {
    filtered = filtered.filter((order) => !order.outlet_id || outletFilter.includes(order.outlet_id));
  }
  return filtered.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function mergeRemotePosOrdersWithLocalState(remoteRows = [], localRows = readCache('pos-orders')) {
  const remoteIds = new Set((remoteRows || []).map((row) => row?.id).filter(Boolean));
  const protectedLocalRows = (localRows || []).filter((row) =>
  row?._pending_sync ||
  ['pending', 'failed', 'sync_failed', 'manual_review_required'].includes(String(row?._sync_state || ''))
  );
  const localOnlyRows = protectedLocalRows.filter((row) => row?.id && !remoteIds.has(row.id));
  return [...localOnlyRows, ...(remoteRows || [])];
}

// outletFilter: null = all outlets, [] = no access, [uuid1,...] = restrict to these outlet IDs
export async function getPosMenuItems(outletFilter = null) {
  if (state.isOnline) {
    let query = state.supabase.
    from('pos_menu_items').
    select('*').
    eq('lodge_id', state.lodgeId).
    order('category').
    order('name');
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    writeCache('pos-menu-items', data || []);
    return applyPosMenuOutletFilter(data || [], outletFilter);
  }
  return applyPosMenuOutletFilter(readCache('pos-menu-items'), outletFilter);
}

export async function getPosMenuItemById(id) {
  if (!id) return null;
  try {
    const { data, error } = await state.supabase.
    from('pos_menu_items').
    select('*').
    eq('id', id).
    eq('lodge_id', state.lodgeId).
    single();
    if (error) throw error;
    return data || null;
  } catch {
    return readCache('pos-menu-items').find((item) => item.id === id) || null;
  }
}

export async function createPosMenuItem(data) {
  const item = {
    lodge_id: state.lodgeId,
    name: data.name,
    category: data.category || 'Other',
    price: Number(data.price) || 0,
    is_available: data.is_available !== false,
    barcode: data.barcode || null,
    inventory_item_id: data.inventory_item_id || null,
    depletion_qty: data.inventory_item_id ? Number(data.depletion_qty) || 1 : null,
    outlet_id: data.outlet_id || null
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_pos_menu_item', { payload: item });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create POS menu item');
    return { success: true, id: result?.id };
  }
  throw new Error('No internet connection. Please check your connection and try again.');
}

export async function updatePosMenuItem(id, data) {
  const update = {
    name: data.name,
    category: data.category,
    price: Number(data.price),
    is_available: data.is_available,
    barcode: data.barcode || null,
    inventory_item_id: data.inventory_item_id || null,
    depletion_qty: data.inventory_item_id ? Number(data.depletion_qty) || 1 : null,
    ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {})
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_pos_menu_item', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update POS menu item');
    return { success: true };
  }
  throw new Error('No internet connection. Please check your connection and try again.');
}

export async function deletePosMenuItem(id) {
  if (!state.isOnline) throw new Error('No internet connection. Please check your connection and try again.');
  const { data: result, error } = await state.supabase.rpc('delete_pos_menu_item', {
    p_id: id,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not delete POS menu item');
  return { success: true };
}

export async function setBarPosPackTemplate(data) {
  if (!state.isOnline) throw new Error('No internet connection. Please check your connection and try again.');
  const payload = {
    lodge_id: state.lodgeId,
    inventory_item_id: data.inventory_item_id,
    pack_size: Number(data.pack_size),
    enabled: data.enabled === true
  };
  const { data: result, error } = await state.supabase.rpc('set_bar_pos_pack_template', { payload });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not update Bar POS template');
  return { success: true };
}

// outletFilter: null = all, [] = no access, [uuid1,...] = restrict to these outlet IDs
export async function getPosOrders(startDate, endDate, outletFilter = null) {
  if (state.isOnline) {
    const cachedOrders = readCache('pos-orders');
    let query = state.supabase.
    from('pos_orders').
    select('*, pos_order_items(*), outlets(name)').
    eq('lodge_id', state.lodgeId);
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate + 'T23:59:59');
    let data = null;
    let error = null;
    ({ data, error } = await query.order('created_at', { ascending: false }));

    if (error) {
      if (isReadOnlySessionTouchError(error)) {
        const filteredCached = applyPosOrderFilters(cachedOrders, startDate, endDate, outletFilter);
        if (filteredCached.length > 0) {
          console.warn('getPosOrders using cache because the database session touch fix has not been applied yet:', error.message);
          return filteredCached;
        }
        throw new Error(buildReadOnlySessionTouchMessage('POS history'));
      }

      let fallbackQuery = state.supabase.
      from('pos_orders').
      select('*, pos_order_items(*)').
      eq('lodge_id', state.lodgeId);
      if (startDate) fallbackQuery = fallbackQuery.gte('created_at', startDate);
      if (endDate) fallbackQuery = fallbackQuery.lte('created_at', endDate + 'T23:59:59');
      const fallback = await fallbackQuery.order('created_at', { ascending: false });
      data = fallback.data || [];
      error = fallback.error || null;
      if (error && isReadOnlySessionTouchError(error)) {
        const filteredCached = applyPosOrderFilters(cachedOrders, startDate, endDate, outletFilter);
        if (filteredCached.length > 0) {
          console.warn('getPosOrders fallback using cache because the database session touch fix has not been applied yet:', error.message);
          return filteredCached;
        }
        throw new Error(buildReadOnlySessionTouchMessage('POS history'));
      }
      if (!error) {
        const outletMap = new Map((readCache('outlets') || []).map((outlet) => [outlet.id, outlet]));
        data = (data || []).map((order) => ({
          ...order,
          outlets: order.outlet_id ? { name: outletMap.get(order.outlet_id)?.name || null } : null
        }));
      }
    }

    if (error) throw new Error(error.message);
    const mergedLiveRows = mergeRemotePosOrdersWithLocalState(data || [], cachedOrders);
    writeCache('pos-orders', mergedLiveRows);
    return applyPosOrderFilters(mergedLiveRows, startDate, endDate, outletFilter);
  }
  return applyPosOrderFilters(readCache('pos-orders'), startDate, endDate, outletFilter);
}

export async function getPosVoidHistory(startDate, endDate, outletFilter = null) {
  const applyVoidFilters = (rows = []) => {
    let filtered = rows || [];
    if (startDate) filtered = filtered.filter((row) => String(row.created_at || '') >= `${startDate}T00:00:00`);
    if (endDate) filtered = filtered.filter((row) => String(row.created_at || '') <= `${endDate}T23:59:59`);
    if (outletFilter !== null && outletFilter.length === 0) return [];
    if (outletFilter !== null) filtered = filtered.filter((row) => !row.outlet_id || outletFilter.includes(row.outlet_id));
    return filtered.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  };

  const attachApproverNames = (rows = [], userRows = readCache('users')) => {
    const userMap = new Map((userRows || []).map((user) => [user?.id, user?.name]).filter(([id]) => !!id));
    return (rows || []).map((row) => ({
      ...row,
      approver_name: row?.approver_name || userMap.get(row?.approved_by) || null
    }));
  };

  const localRows = applyVoidFilters(attachApproverNames(readLocalPosVoidHistory()));

  if (!state.isOnline) return localRows;

  let query = state.supabase.
  from('pos_override_log').
  select('id, order_id, action, requested_by, approved_by, reason, outlet_id, created_at').
  eq('lodge_id', state.lodgeId).
  eq('action', 'void');

  if (startDate) query = query.gte('created_at', `${startDate}T00:00:00`);
  if (endDate) query = query.lte('created_at', `${endDate}T23:59:59`);
  if (outletFilter !== null && outletFilter.length === 0) return [];
  if (outletFilter !== null) query = query.in('outlet_id', outletFilter);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  const approvedByIds = [...new Set((data || []).map((row) => row?.approved_by).filter(Boolean))];
  let remoteUsers = readCache('users');
  if (approvedByIds.length > 0) {
    const { data: usersData } = await state.supabase.
    from('users').
    select('id, name').
    in('id', approvedByIds).
    eq('lodge_id', state.lodgeId);
    if (usersData) remoteUsers = usersData;
  }

  const remoteRows = attachApproverNames(data || [], remoteUsers);
  const remoteIds = new Set(remoteRows.map((row) => row?.id).filter(Boolean));
  const pendingLocalRows = localRows.filter((row) =>
  row?._pending_sync || row?._sync_state === 'pending' || !remoteIds.has(row?.id)
  );
  return applyVoidFilters([...pendingLocalRows.filter((row) => !remoteIds.has(row?.id)), ...remoteRows]);
}

export async function getOutlets() {
  const normalizeOutletRows = (rows = []) =>
  (rows || []).
  filter(Boolean).
  filter((row) => row.is_active !== false).
  map((row, index) => ({
    ...row,
    id: row.id ?? null,
    name: row.name || `Outlet ${index + 1}`,
    type: row.type || 'accommodation',
    sort_order: Number(row.sort_order ?? index)
  })).
  sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  const buildVirtualOutlets = () => [
  { id: null, name: 'Kitchen', type: 'food', sort_order: 1, _virtual: true },
  { id: null, name: 'Bar', type: 'beverage', sort_order: 2, _virtual: true },
  { id: null, name: 'Front Desk', type: 'accommodation', sort_order: 3, _virtual: true }];


  try {
    let { data, error } = await state.supabase.
    from('outlets').
    select('id, name, type, sort_order').
    eq('lodge_id', state.lodgeId).
    eq('is_active', true).
    order('sort_order');
    if (error) {
      const fallback = await state.supabase.
      from('outlets').
      select('id, name, type, is_active').
      eq('lodge_id', state.lodgeId);
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw error;

    const normalized = normalizeOutletRows(data || []);
    const cached = readCache('outlets');
    if (normalized.length === 0 && cached.length > 0) {
      console.warn('getOutlets received empty live result; using cached outlets instead');
      return cached;
    }
    if (normalized.length === 0) {
      const virtual = buildVirtualOutlets();
      writeCache('outlets', virtual);
      return virtual;
    }
    writeCache('outlets', normalized);
    return normalized;
  } catch (error) {
    const cached = readCache('outlets');
    if (cached.length > 0) {
      console.warn('getOutlets falling back to cache:', error?.message || error);
      return cached;
    }
    if (!state.isOnline) return buildVirtualOutlets();
    console.warn('getOutlets falling back to virtual outlets:', error?.message || error);
    const virtual = buildVirtualOutlets();
    writeCache('outlets', virtual);
    return virtual;
  }
}

export async function getPosOrderById(id) {
  if (!id) return null;
  if (state.isOnline) {
    const { data, error } = await state.supabase.
    from('pos_orders').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('id', id).
    single();
    if (error) throw new Error(error.message);
    return data || null;
  }
  return readCache('pos-orders').find((order) => order.id === id) || null;
}

export async function createPosOrder(data) {
  try {
    const items = data.items || [];
    const total = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
    const callerOrderId = String(data?.id || '').trim();
    const callerSubmitIntentId = String(data?.submit_intent_id || '').trim();
    const submitIntentId = callerSubmitIntentId || randomUUID();
    const orderId = callerOrderId || submitIntentId;
    const submitIdempotencyKey = `pos-order:${submitIntentId}`;
    const today = new Date().toISOString().split('T')[0];
    const cachedBookings = readCache('bookings');
    const cachedBooking = data.booking_id ?
    cachedBookings.find((entry) => entry?.id === data.booking_id && entry?.lodge_id === state.lodgeId) :
    cachedBookings.find((entry) =>
    entry?.lodge_id === state.lodgeId &&
    entry?.room_id === data.room_id &&
    ['confirmed', 'checked_in'].includes(String(entry?.status || '').toLowerCase()) &&
    entry?.check_in <= today &&
    entry?.check_out > today
    );
    const bookingId = cachedBooking?.id || data.booking_id || null;

    if ((data.payment_method || 'cash') === 'folio' && !bookingId) {
      throw new Error('Room folio charge requires an active booking for the selected room.');
    }

    // Offline path: validate booking exists in cache before queuing the operation
    if (!state.isOnline) {
      // If a booking_id was explicitly provided, verify it exists in cache
      if (data.booking_id && !cachedBooking) {
        throw new Error(`Booking ${data.booking_id} not found locally. Sync the latest bookings and try again.`);
      }
      // For folio charges, ensure we have a valid booking (same as online check above, but explicit)
      if ((data.payment_method || 'cash') === 'folio' && !bookingId) {
        throw new Error('Room folio charge requires an active booking for the selected room.');
      }
      const id = orderId;
      const createdAt = new Date().toISOString();
      const idempotencyKey = submitIdempotencyKey;
      const inventoryReservations = getOfflinePosInventoryReservation(items);
      const lineItems = items.map((item) => ({
        id: randomUUID(),
        order_id: id,
        lodge_id: state.lodgeId,
        menu_item_id: item.menu_item_id || null,
        inventory_item_id: item.inventory_item_id || null,
        depletion_qty: Math.max(1, Number(item.depletion_qty || 1)),
        item_name: item.item_name,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        subtotal: Number(item.quantity || 0) * Number(item.unit_price || 0)
      }));

      queueOperation('rpc', 'create_pos_order', {
        payload: {
          lodge_id: state.lodgeId,
          id,
          room_id: data.room_id || null,
          booking_id: bookingId,
          walk_in_name: data.walk_in_name || null,
          total,
          notes: data.notes || null,
          payment_method: data.payment_method || 'cash',
          outlet_id: data.outlet_id || null,
          create_idempotency_key: idempotencyKey,
          created_at_client: createdAt,
          items: lineItems.map((item) => ({
            menu_item_id: item.menu_item_id,
            inventory_item_id: item.inventory_item_id || null,
            depletion_qty: Math.max(1, Number(item.depletion_qty || 1)),
            item_name: item.item_name,
            quantity: item.quantity,
            unit_price: item.unit_price
          }))
        }
      }, null, {
        _queue_id: `pos-order-${id}`,
        ...(cachedBooking?._pending_sync ? { _depends_on: `booking-${cachedBooking.id}` } : {})
      });

      const orderRow = {
        id,
        lodge_id: state.lodgeId,
        room_id: data.room_id || null,
        booking_id: bookingId,
        walk_in_name: data.walk_in_name || null,
        outlet_id: data.outlet_id || null,
        notes: data.notes || null,
        payment_method: data.payment_method || 'cash',
        total,
        status: 'completed',
        created_at: createdAt,
        _pending_sync: true,
        _sync_state: 'pending',
        _sync_error: null,
        _idempotency_key: idempotencyKey,
        _sync_created_offline: true,
        pos_order_items: lineItems
      };

      const cachedOrders = readCache('pos-orders');
      cachedOrders.unshift(orderRow);
      writeCache('pos-orders', cachedOrders);

      const cachedLineItems = readCache('pos-order-items');
      writeCache('pos-order-items', [...lineItems, ...cachedLineItems]);
      applyOfflinePosInventoryReservation(inventoryReservations);

      return { success: true, id, offline: true };
    }

    // Resolve booking ID before entering the transaction (read-only, safe outside)
    let bookingIdForRpc = bookingId;
    if (data.room_id && !bookingIdForRpc) {
      const booking = await getActiveBookingForRoom(data.room_id);
      bookingIdForRpc = booking?.id || null;
    }

    // All DB writes are delegated to a single Postgres transaction via RPC.
    // If any step fails, Postgres rolls back the entire operation automatically.
    const { data: result, error } = await state.supabase.rpc('create_pos_order', {
      payload: {
        id: orderId,
        lodge_id: state.lodgeId,
        room_id: data.room_id || null,
        booking_id: bookingIdForRpc,
        walk_in_name: data.walk_in_name || null,
        total,
        notes: data.notes || null,
        payment_method: data.payment_method || 'cash',
        outlet_id: data.outlet_id || null,
        create_idempotency_key: submitIdempotencyKey,
        items: items.map((i) => ({
          menu_item_id: i.menu_item_id || null,
          inventory_item_id: i.inventory_item_id || null,
          depletion_qty: Math.max(1, Number(i.depletion_qty || 1)),
          item_name: i.item_name,
          quantity: i.quantity,
          unit_price: i.unit_price
        }))
      }
    });

    if (error) throw new Error(error.message);
    return result; // { id: '...', success: true }
  } catch (error) {
    recordCriticalError('pos.order.create', error, {
      room_id: data?.room_id || null,
      booking_id: data?.booking_id || null,
      outlet_id: data?.outlet_id || null,
      payment_method: data?.payment_method || 'cash'
    });
    throw error;
  }
}

export async function voidPosOrder(id) {
  return {
    success: false,
    error: 'POS voids require supervisor, manager, or admin PIN approval.'
  };
}

async function _getApproverCandidates() {
  const cachedCandidates = () => readCache('users').
  map(normalizeUserRecord).
  filter(Boolean).
  filter((user) => user?.pin_hash).
  filter((user) => ['supervisor', 'manager', 'admin', 'super_admin'].includes(normalizeAppRole(user.role)));

  if (!state.isOnline) return cachedCandidates();

  const { data, error } = await state.supabase.
  from('users').
  select('id, name, role, pin_hash, allowed_outlet_ids').
  eq('lodge_id', state.lodgeId).
  not('pin_hash', 'is', null).
  in('role', ['supervisor', 'manager', 'admin', 'super_admin']);

  if (error) {
    const fallback = cachedCandidates();
    if (fallback.length > 0) return fallback;
    throw new Error(error.message);
  }
  return (data || []).map(normalizeUserRecord).filter(Boolean);
}

function approverCanApproveOutlet(approver, outletId = null) {
  const role = normalizeAppRole(approver?.role);
  if (isPosFullAccessRole(role)) return true;
  if (role !== 'supervisor') return false;
  if (!outletId) return true;
  return Array.isArray(approver?.allowed_outlet_ids) && approver.allowed_outlet_ids.includes(outletId);
}

export async function approvePosVoidWithPin(payload) {
  const { order_id, pin, reason, cashier_user_id, outlet_id } = payload || {};

  if (!order_id || !pin) {
    return { success: false, error: 'Order and PIN are required' };
  }

  const candidates = await _getApproverCandidates();

  let approver = null;
  for (const candidate of candidates) {
    if (candidate?.pin_hash && bcrypt.compareSync(String(pin).trim(), candidate.pin_hash)) {
      approver = candidate;
      break;
    }
  }

  if (!approver) {
    return { success: false, error: 'Invalid PIN or unauthorized approver' };
  }

  const approverRole = normalizeAppRole(approver.role);
  const approverCaps = getRoleCapabilities(approverRole, { pos: true });
  if (!approverCaps?.['pos.void']) {
    return { success: false, error: 'Invalid PIN or unauthorized approver' };
  }
  if (!approverCanApproveOutlet(approver, outlet_id || null)) {
    return { success: false, error: 'Invalid PIN or unauthorized approver for this outlet' };
  }

  const cachedOrders = readCache('pos-orders');
  const cachedOrder = cachedOrders.find((order) => order?.id === order_id);
  if (!cachedOrder && !state.isOnline) {
    return { success: false, error: 'Order not found on this computer' };
  }

  const orderItems = Array.isArray(cachedOrder?.pos_order_items) ?
  cachedOrder.pos_order_items :
  Array.isArray(cachedOrder?.items) ?
  cachedOrder.items :
  [];
  const logId = payload?.override_log_id || randomUUID();
  const createdAt = payload?.created_at || new Date().toISOString();

  if (!state.isOnline) {
    if (cachedOrder?.status === 'voided') {
      return { success: false, error: 'Order is already voided' };
    }

    const queueMeta = {
      _queue_id: `pos-void-${order_id}`,
      ...(cachedOrder?._pending_sync || cachedOrder?._sync_created_offline ? { _depends_on: `pos-order-${order_id}` } : {})
    };
    queueOperation('rpc', 'approve_pos_void_with_pin', {
      payload: {
        order_id,
        lodge_id: state.lodgeId,
        requested_by: cashier_user_id || null,
        approved_by: approver.id,
        reason: reason || null,
        outlet_id: outlet_id || cachedOrder?.outlet_id || null,
        override_log_id: logId,
        created_at: createdAt,
        items: orderItems.map((item) => ({
          menu_item_id: item.menu_item_id || null,
          inventory_item_id: item.inventory_item_id || null,
          depletion_qty: Math.max(1, Number(item.depletion_qty || 1)),
          item_name: item.item_name,
          quantity: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0)
        }))
      }
    }, null, queueMeta);

    patchCachedPosOrderSyncState(order_id, {
      status: 'voided',
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null,
      _pending_void: true,
      _void_reason: reason || null,
      _void_approved_by: approver.id,
      _void_approver_name: approver.name || null
    });
    restoreOfflinePosInventoryReservation(orderItems, { outletId: outlet_id || cachedOrder?.outlet_id || null });
    upsertLocalPosVoidHistory({
      id: logId,
      order_id,
      action: 'void',
      requested_by: cashier_user_id || null,
      approved_by: approver.id,
      approver_name: approver.name || null,
      reason: reason || null,
      outlet_id: outlet_id || cachedOrder?.outlet_id || null,
      created_at: createdAt,
      _pending_sync: true,
      _sync_state: 'pending'
    });
    return {
      success: true,
      offline: true,
      override_log_id: logId,
      approved_by: approver.id,
      approver_name: approver.name || null,
      reason: reason || null
    };
  }

  const { data: result, error } = await state.supabase.rpc('approve_pos_void_with_pin', {
    payload: {
      order_id,
      lodge_id: state.lodgeId,
      requested_by: cashier_user_id || null,
      approved_by: approver.id,
      reason: reason || null,
      outlet_id: outlet_id || null,
      override_log_id: logId,
      created_at: createdAt
    }
  });

  if (error) throw new Error(error.message);
  if (!result?.success) return { success: false, error: result?.error || 'Could not void order' };
  upsertLocalPosVoidHistory({
    id: logId,
    order_id,
    action: 'void',
    requested_by: cashier_user_id || null,
    approved_by: approver.id,
    approver_name: approver.name || null,
    reason: reason || null,
    outlet_id: outlet_id || cachedOrder?.outlet_id || null,
    created_at: createdAt,
    _pending_sync: false,
    _sync_state: 'synced'
  });
  await refreshCache('pos-orders', 'inventory-items', 'inventory-purchases').catch(() => {});
  return {
    success: true,
    override_log_id: logId,
    approved_by: approver.id,
    approver_name: approver.name || null,
    reason: reason || null
  };
}

export async function getPosRevenueSummary(startDate, endDate, outletId = 'all') {
  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.rpc('get_pos_sales_summary', {
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
      throw new Error('POS sales summary was empty.');
    } catch (error) {
      recordCriticalError('reports.pos_sales', error, {
        startDate,
        endDate,
        outletId: outletId || 'all',
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 });
    }
  }

  const cachedOrders = readCache('pos-orders').filter((order) => {
    const createdAt = String(order.created_at || '');
    const orderDate = createdAt.split('T')[0];
    return (
      (order.status || '') === 'completed' && (
      !startDate || orderDate >= startDate) && (
      !endDate || orderDate <= endDate) && (

      !outletId ||
      outletId === 'all' || (
      outletId === 'unassigned' ? !order.outlet_id : order.outlet_id === outletId)));


  });
  let orders = [];
  let currentMenuItems = [];
  let inventoryNameMap = new Map();

  try {
    let posQuery = state.supabase.
    from('pos_orders').
    select('*').
    eq('lodge_id', state.lodgeId).
    eq('status', 'completed').
    gte('created_at', `${startDate}T00:00:00`).
    lte('created_at', `${endDate}T23:59:59`);
    if (outletId && outletId !== 'all') {
      if (outletId === 'unassigned') posQuery = posQuery.is('outlet_id', null);else
      posQuery = posQuery.eq('outlet_id', outletId);
    }
    const { data: liveOrders, error: ordersError } = await posQuery;
    if (ordersError) throw ordersError;
    const fetchedOrders = (liveOrders || []).length === 0 && cachedOrders.length > 0 ?
    cachedOrders :
    liveOrders || [];

    // Write online results to cache so offline fallback stays fresh
    if ((liveOrders || []).length > 0) {
      writeCache('pos-orders', liveOrders);
    }

    // Fetch order items separately — failure here only affects top_items, not revenue totals
    let liveItems = [];
    const orderIds = fetchedOrders.map((o) => o.id).filter(Boolean);
    if (orderIds.length > 0) {
      const { data: itemRows, error: itemsError } = await state.supabase.
      from('pos_order_items').
      select('order_id, menu_item_id, item_name, quantity, unit_price, subtotal').
      in('order_id', orderIds);
      if (!itemsError) liveItems = itemRows || [];
    }
    // Attach items back onto each order
    const itemsByOrder = {};
    for (const item of liveItems) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    }
    orders = fetchedOrders.map((o) => ({ ...o, pos_order_items: itemsByOrder[o.id] || o.pos_order_items || [] }));

    const { data: liveMenuItems, error: menuError } = await state.supabase.
    from('pos_menu_items').
    select('id, name, inventory_item_id, depletion_qty, template_kind, template_pack_size').
    eq('lodge_id', state.lodgeId);
    if (menuError) throw menuError;
    currentMenuItems = (liveMenuItems || []).length === 0 ?
    readCache('pos-menu-items') :
    liveMenuItems || [];

    const inventoryIds = [...new Set(
      currentMenuItems.
      map((item) => item.inventory_item_id).
      filter(Boolean)
    )];
    if (inventoryIds.length > 0) {
      const { data: inventoryRows, error: inventoryError } = await state.supabase.
      from('inventory_items').
      select('id, name').
      eq('lodge_id', state.lodgeId).
      in('id', inventoryIds);
      if (inventoryError) throw inventoryError;
      inventoryNameMap = new Map((inventoryRows || []).map((row) => [row.id, row.name]));
    }
  } catch (error) {
    orders = cachedOrders;
    currentMenuItems = readCache('pos-menu-items');
    const inventoryRows = readCache('inventory-items');
    inventoryNameMap = new Map((inventoryRows || []).map((row) => [row.id, row.name]));
    if (!orders.length && !currentMenuItems.length && state.isOnline) {
      throw new Error(error?.message || 'Failed to load POS revenue summary');
    }
  }

  const menuItemMap = new Map((currentMenuItems || []).map((item) => [item.id, item]));

  const total_revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0);
  const folio_revenue = orders.reduce(
    (sum, order) => sum + ((order.payment_method || '') === 'folio' ? Number(order.total || 0) : 0),
    0
  );
  const direct_revenue = total_revenue - folio_revenue;
  const total_orders = orders.length;
  const avg_order = total_orders > 0 ? total_revenue / total_orders : 0;

  // Breakdown by payment method
  const by_payment = {};
  for (const o of orders) {
    const pm = o.payment_method || 'cash';
    by_payment[pm] = (by_payment[pm] || 0) + Number(o.total || 0);
  }

  // Top items aggregated across all line items
  const itemMap = {};
  for (const o of orders) {
    for (const li of o.pos_order_items || []) {
      const menuItem = menuItemMap.get(li.menu_item_id);
      const depletionQty = Number(
        menuItem?.template_pack_size ||
        menuItem?.depletion_qty ||
        1
      );
      const quantity = Number(li.quantity || 0);
      // Prefer live menu item name over the stored item_name snapshot, which
      // can be stale or incorrect (e.g. bar orders saving wrong item_name).
      // Prefer live menu item name over the stored item_name snapshot, which
      // can be stale or incorrect (e.g. bar orders saving wrong item_name).
      const menuItemName = menuItem?.name || li.item_name;
      const itemName = menuItem?.inventory_item_id ?
      inventoryNameMap.get(menuItem.inventory_item_id) || menuItemName :
      menuItemName;

      if (!itemMap[itemName]) itemMap[itemName] = { name: itemName, qty: 0, revenue: 0 };
      itemMap[itemName].qty += quantity * depletionQty;
      itemMap[itemName].revenue += Number(li.subtotal || 0);
    }
  }
  const top_items = Object.values(itemMap).sort((a, b) => b.revenue - a.revenue).slice(0, 15);

  // Daily totals
  const dailyMap = {};
  for (const o of orders) {
    const date = (o.created_at || '').split('T')[0];
    if (date) dailyMap[date] = (dailyMap[date] || 0) + Number(o.total || 0);
  }
  const daily = Object.entries(dailyMap).
  map(([date, total]) => ({ date, total })).
  sort((a, b) => a.date.localeCompare(b.date));

  return {
    total_revenue,
    folio_revenue,
    direct_revenue,
    total_orders,
    avg_order,
    by_payment,
    top_items,
    daily,
    source: 'local',
    as_of_range: { start: startDate, end: endDate },
    outlet_selector: outletId || 'all'
  };
}
