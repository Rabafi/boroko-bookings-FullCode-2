import { createHash, randomUUID } from 'crypto'
import { state } from '../state.js'
import { getActiveBookingForRoom } from './bookings.js'
import { recordCriticalError } from './operationalLog.js'
import { mergeRemotePosOrdersWithLocalState } from './posMerge.js'
import { patchCachedPosOrderSyncState } from './syncCache.js'
import {
  applyOfflinePosInventoryReservation,
  ensureDir,
  getOfflinePosInventoryReservation,
  queueOperation,
  readCache,
  readLocalPosVoidHistory,
  refreshCache,
  upsertLocalPosVoidHistory,
  writeCache,
  dedupePromise
} from './infrastructure.js'

function getDesktopPosDeviceId() {
  const source = state.cacheDir || state.lodgeId || 'boroko-desktop-pos';
  return `desktop-${createHash('sha256').update(String(source)).digest('hex').slice(0, 24)}`;
}

function isReadOnlySessionTouchError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('read-only transaction') && message.includes('update');
}

function isNetworkError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('fetch') || message.includes('network') || message.includes('failed to fetch') ||
    message.includes('ERR_CONNECTION') || message.includes('ECONNREFUSED') || message.includes('ETIMEDOUT');
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
  const inclusiveEndDate = normalizeInclusiveDateEnd(endDate);
  if (startDate) {
    filtered = filtered.filter((order) => String(order.created_at || '') >= startDate);
  }
  if (inclusiveEndDate) {
    filtered = filtered.filter((order) => String(order.created_at || '') <= inclusiveEndDate);
  }
  if (outletFilter !== null && outletFilter.length === 0) return [];
  if (outletFilter !== null) {
    filtered = filtered.filter((order) => !order.outlet_id || outletFilter.includes(order.outlet_id));
  }
  return filtered.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function normalizeInclusiveDateEnd(value) {
  if (!value) return null;
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T23:59:59.999Z`;
  return raw;
}

function normalizePositiveQty(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
}

function normalizePercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : 0;
}

function parseJsonField(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function normalizePaymentBreakdown(payments = [], fallbackMethod = 'cash', total = 0) {
  const rows = Array.isArray(payments) ? payments : [];
  const normalized = rows.
  map((row) => ({
    method: String(row?.method || fallbackMethod || 'cash').trim() || 'cash',
    amount: normalizeMoney(row?.amount),
    reference: String(row?.reference || '').trim() || null
  })).
  filter((row) => row.amount !== 0);
  if (normalized.length === 0 && normalizeMoney(total) !== 0) {
    normalized.push({ method: fallbackMethod || 'cash', amount: normalizeMoney(total), reference: null });
  }
  return normalized;
}

function getOrderPaymentRows(order = {}) {
  const breakdown = parseJsonField(order.payment_breakdown, null);
  if (Array.isArray(breakdown) && breakdown.length > 0) return normalizePaymentBreakdown(breakdown, order.payment_method || 'cash', order.total || 0);
  return normalizePaymentBreakdown([], order.payment_method || 'cash', order.total || 0);
}

function buildPosTotals(items = [], data = {}) {
  const itemSubtotal = (items || []).reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
  const grossFromItems = (items || []).reduce((sum, item) => {
    const lineTotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
    return lineTotal > 0 ? sum + lineTotal : sum;
  }, 0);
  const gross = normalizeMoney(data.gross_total ?? grossFromItems);
  const discount = normalizeMoney(data.discount_total ?? Math.max(0, gross - itemSubtotal));
  const taxableBase = Math.max(0, gross - discount);
  const taxRate = normalizePercent(data.tax_rate);
  const tax = normalizeMoney(data.tax_total ?? (taxRate > 0 ? taxableBase * taxRate / 100 : 0));
  const tip = normalizeMoney(data.tip_total || 0);
  const net = normalizeMoney(data.total ?? (itemSubtotal + tax + tip));
  return {
    gross_total: gross,
    discount_total: discount,
    tax_rate: taxRate,
    tax_total: tax,
    tip_total: tip,
    net_total: net,
    total: net
  };
}

function readPosHardwareSettings() {
  const rows = readCache('pos-hardware-settings');
  const current = Array.isArray(rows) && rows[0] ? rows[0] : {};
  return {
    receipt_printer_name: current.receipt_printer_name || '',
    receipt_paper_width: current.receipt_paper_width || '80mm',
    receipt_print_mode: current.receipt_print_mode || (current.escpos_enabled === true ? 'escpos' : 'windows'),
    auto_print_receipts: current.auto_print_receipts === true,
    receipt_cut_enabled: current.receipt_cut_enabled !== false,
    cash_drawer_enabled: current.cash_drawer_enabled === true,
    cash_drawer_command: current.cash_drawer_command || 'ESC/POS kick',
    cash_drawer_open_on_cash: current.cash_drawer_open_on_cash === true,
    cash_drawer_open_timing: current.cash_drawer_open_timing || 'after_payment',
    cash_drawer_pin: current.cash_drawer_pin || '0',
    cash_drawer_pulse_on_ms: current.cash_drawer_pulse_on_ms || 50,
    cash_drawer_pulse_off_ms: current.cash_drawer_pulse_off_ms || 250,
    escpos_enabled: current.escpos_enabled === true,
    escpos_connection_type: current.escpos_connection_type || 'network',
    escpos_network_host: current.escpos_network_host || '',
    escpos_network_port: current.escpos_network_port || 9100,
    escpos_printer_path: current.escpos_printer_path || '',
    escpos_codepage: current.escpos_codepage || 'cp437',
    escpos_timeout_ms: current.escpos_timeout_ms || 8000,
    payment_terminal_provider: current.payment_terminal_provider || '',
    payment_terminal_name: current.payment_terminal_name || '',
    payment_terminal_mode: current.payment_terminal_mode || 'manual',
    payment_terminal_bridge_url: current.payment_terminal_bridge_url || '',
    payment_terminal_timeout_ms: current.payment_terminal_timeout_ms || 8000,
    customer_display_enabled: current.customer_display_enabled === true,
    updated_at: current.updated_at || null
  };
}

function writePosHardwareSettings(settings = {}) {
  const row = {
    ...readPosHardwareSettings(),
    ...settings,
    updated_at: new Date().toISOString()
  };
  writeCache('pos-hardware-settings', [row]);
  return row;
}

function readPosCashups() {
  const rows = readCache('pos-cashups');
  return Array.isArray(rows) ? rows : [];
}

function writePosCashups(rows = []) {
  writeCache('pos-cashups', rows.slice(0, 500));
}

function upsertLocalPosCashup(row = {}) {
  const normalized = {
    ...row,
    id: row.id || randomUUID(),
    lodge_id: row.lodge_id || state.lodgeId,
    created_by: row.created_by || state.currentUser?.id || null,
    created_by_name: row.created_by_name || state.currentUser?.name || null,
    created_at: row.created_at || new Date().toISOString()
  };
  const next = [
    normalized,
    ...readPosCashups().filter((entry) => entry.id !== normalized.id)
  ].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  writePosCashups(next);
  return normalized;
}

function readPosModifierGroups() {
  const rows = readCache('pos-modifier-groups');
  return Array.isArray(rows) ? rows : [];
}

function writePosModifierGroups(rows = []) {
  writeCache('pos-modifier-groups', rows.slice(0, 500));
}

function readPosPromotions() {
  const rows = readCache('pos-promotions');
  return Array.isArray(rows) ? rows : [];
}

function writePosPromotions(rows = []) {
  writeCache('pos-promotions', rows.slice(0, 500));
}

function readPosAuditLog() {
  const rows = readCache('pos-audit-log');
  return Array.isArray(rows) ? rows : [];
}

function writePosAuditLog(rows = []) {
  writeCache('pos-audit-log', rows.slice(0, 2000));
}

function appendPosAudit(action, details = {}) {
  const row = {
    id: details.id || randomUUID(),
    lodge_id: state.lodgeId,
    action,
    entity_type: details.entity_type || null,
    entity_id: details.entity_id || null,
    staff_id: details.staff_id || state.currentUser?.id || null,
    staff_name: details.staff_name || state.currentUser?.name || state.currentUser?.email || null,
    details: details.details || details,
    created_at: details.created_at || new Date().toISOString()
  };
  writePosAuditLog([row, ...readPosAuditLog()]);
  if (state.isOnline && state.supabase) {
    Promise.resolve(state.supabase.rpc('append_pos_audit_log', { payload: row })).catch(() => {});
  }
  return row;
}

function readPosFloorLayout() {
  const value = readCache('pos-floor-layout');
  return value && typeof value === 'object' && !Array.isArray(value) ? value : { areas: [] };
}

function writePosFloorLayout(layout = {}) {
  const normalized = {
    areas: Array.isArray(layout.areas) ? layout.areas.slice(0, 50) : [],
    updated_at: new Date().toISOString()
  };
  writeCache('pos-floor-layout', normalized);
  return normalized;
}

function writeCustomerDisplaySnapshot(snapshot = {}) {
  const row = {
    ...snapshot,
    lodge_id: state.lodgeId,
    updated_at: new Date().toISOString()
  };
  writeCache('pos-customer-display', row);
  return row;
}

// outletFilter: null = all outlets, [] = no access, [uuid1,...] = restrict to these outlet IDs
async function _getPosMenuItems(outletFilter = null) {
  if (state.isOnline) {
    let query = state.supabase.
    from('pos_menu_items').
    select('id, name, category, price, is_available, barcode, inventory_item_id, depletion_qty, outlet_id, template_kind, lodge_id, created_at, updated_at, dietary_flags, prep_time_minutes, is_popular, kitchen_station_id').
    eq('lodge_id', state.lodgeId).
    order('category').
    order('name').
    limit(500);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    writeCache('pos-menu-items', data || []);
    return applyPosMenuOutletFilter(data || [], outletFilter);
  }
  return applyPosMenuOutletFilter(readCache('pos-menu-items'), outletFilter);
}

export function getPosMenuItems(outletFilter = null) {
  return dedupePromise(`getPosMenuItems:${JSON.stringify(outletFilter)}`, () => _getPosMenuItems(outletFilter));
}

async function _getActivePosCatalogSnapshot(outletId = null) {
  const readCachedSnapshot = () => {
    const cached = readCache('pos-catalog-snapshots');
    const rows = Array.isArray(cached) ? cached : [];
    return rows.find((entry) =>
      entry?.success === true &&
      entry?.snapshot_id &&
      (entry?.outlet_id || null) === (outletId || null)
    ) || null;
  };

  if (state.isOnline && state.supabase) {
    const { data, error } = await state.supabase.rpc('get_active_pos_catalog_snapshot', {
      p_lodge_id: state.lodgeId,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'No active catalog snapshot. Publish a catalog before trading.');
    const rows = readCache('pos-catalog-snapshots');
    const next = [
      data,
      ...(Array.isArray(rows) ? rows : []).filter((entry) =>
        (entry?.outlet_id || null) !== (outletId || null)
      )
    ];
    writeCache('pos-catalog-snapshots', next);
    return data;
  }
  const cached = readCachedSnapshot();
  if (cached) return cached;
  throw new Error('No catalog snapshot available. Connect to the internet and publish a catalog.');
}

export function getActivePosCatalogSnapshot(outletId = null) {
  return dedupePromise(`getActivePosCatalogSnapshot:${outletId || 'all'}`, () => _getActivePosCatalogSnapshot(outletId));
}

export async function publishPosCatalogSnapshot(outletId = null) {
  if (!state.isOnline) throw new Error('Catalog publishing requires an internet connection.');
  const { data, error } = await state.supabase.rpc('publish_pos_catalog_snapshot', {
    p_lodge_id: state.lodgeId,
    p_outlet_id: outletId || null
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not publish catalog snapshot');
  return _getActivePosCatalogSnapshot(outletId);
}

async function publishPosCatalogSnapshotsForChange(outletIds = []) {
  const requested = [...new Set(outletIds.map((value) => value || null))];
  const targets = new Set(requested);
  if (requested.includes(null)) {
    const outlets = await getOutlets();
    for (const outlet of outlets || []) {
      if (outlet?.id) targets.add(outlet.id);
    }
  }
  for (const outletId of targets) {
    await publishPosCatalogSnapshot(outletId);
  }
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
    outlet_id: data.outlet_id || null,
    dietary_flags: Array.isArray(data.dietary_flags) ? data.dietary_flags : [],
    prep_time_minutes: Number(data.prep_time_minutes) || 0,
    is_popular: data.is_popular === true,
    kitchen_station_id: data.kitchen_station_id || null
  };
    if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_pos_menu_item', { payload: item });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create POS menu item');
    await publishPosCatalogSnapshotsForChange([item.outlet_id]).catch((error) => {
      throw new Error(`Menu item was saved, but catalog publication failed: ${error.message}`);
    });
    return { success: true, id: result?.id };
  }
  throw new Error('No internet connection. Please check your connection and try again.');
}

export async function updatePosMenuItem(id, data) {
  const existing = await getPosMenuItemById(id).catch(() => null);
  const update = {
    name: data.name,
    category: data.category,
    price: Number(data.price),
    is_available: data.is_available,
    barcode: data.barcode || null,
    inventory_item_id: data.inventory_item_id || null,
    depletion_qty: data.inventory_item_id ? Number(data.depletion_qty) || 1 : null,
    ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {}),
    dietary_flags: Array.isArray(data.dietary_flags) ? data.dietary_flags : [],
    prep_time_minutes: Number(data.prep_time_minutes) || 0,
    is_popular: data.is_popular === true,
    kitchen_station_id: data.kitchen_station_id || null
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_pos_menu_item', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update POS menu item');
    await publishPosCatalogSnapshotsForChange([
      existing?.outlet_id || null,
      update.outlet_id ?? existing?.outlet_id ?? null
    ]).catch((publishError) => {
      throw new Error(`Menu item was saved, but catalog publication failed: ${publishError.message}`);
    });
    return { success: true };
  }
  throw new Error('No internet connection. Please check your connection and try again.');
}

export async function deletePosMenuItem(id) {
  if (!state.isOnline) throw new Error('No internet connection. Please check your connection and try again.');
  const existing = await getPosMenuItemById(id).catch(() => null);
  const { data: result, error } = await state.supabase.rpc('delete_pos_menu_item', {
    p_id: id,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not delete POS menu item');
  await publishPosCatalogSnapshotsForChange([existing?.outlet_id || null]).catch((publishError) => {
    throw new Error(`Menu item was deleted, but catalog publication failed: ${publishError.message}`);
  });
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
async function _getPosOrders(startDate, endDate, outletFilter = null) {
  if (state.isOnline) {
    const cachedOrders = readCache('pos-orders');
    let query = state.supabase.
    from('pos_orders').
    select('id, room_id, booking_id, walk_in_name, total, gross_total, discount_total, tax_rate, tax_total, tip_total, notes, payment_method, payment_breakdown, outlet_id, service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name, shift_id, ticket_status, status, created_at, pos_order_items(*), outlets(name)').
    eq('lodge_id', state.lodgeId);
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', normalizeInclusiveDateEnd(endDate));
    let data = null;
    let error = null;
    ({ data, error } = await query.order('created_at', { ascending: false }).limit(500));

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
      select('id, room_id, booking_id, walk_in_name, total, gross_total, discount_total, tax_rate, tax_total, tip_total, notes, payment_method, payment_breakdown, outlet_id, service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name, shift_id, ticket_status, status, created_at, pos_order_items(*)').
      eq('lodge_id', state.lodgeId);
      if (startDate) fallbackQuery = fallbackQuery.gte('created_at', startDate);
      if (endDate) fallbackQuery = fallbackQuery.lte('created_at', normalizeInclusiveDateEnd(endDate));
      const fallback = await fallbackQuery.order('created_at', { ascending: false }).limit(500);
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

export function getPosOrders(startDate, endDate, outletFilter = null) {
  return dedupePromise(`getPosOrders:${startDate}:${endDate}:${JSON.stringify(outletFilter)}`, () => _getPosOrders(startDate, endDate, outletFilter));
}

export async function getPosVoidHistory(startDate, endDate, outletFilter = null) {
  const applyVoidFilters = (rows = []) => {
    let filtered = rows || [];
    const inclusiveEndDate = normalizeInclusiveDateEnd(endDate);
    if (startDate) filtered = filtered.filter((row) => String(row.created_at || '') >= startDate);
    if (inclusiveEndDate) filtered = filtered.filter((row) => String(row.created_at || '') <= inclusiveEndDate);
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

  if (startDate) query = query.gte('created_at', startDate);
  if (endDate) query = query.lte('created_at', normalizeInclusiveDateEnd(endDate));
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

async function _getOutlets() {
  const normalizeOutletRows = (rows = []) => {
    const seen = new Set();
    return (rows || []).
    filter(Boolean).
    filter((row) => row.is_active !== false).
    map((row, index) => ({
      ...row,
      id: row.id ?? null,
      name: row.name || `Outlet ${index + 1}`,
      type: row.type || 'accommodation',
      sort_order: Number(row.sort_order ?? index)
    })).
    filter((row) => {
      // A stale local cache must not create duplicate Kitchen/Bar choices.
      const key = row.id || `${String(row.type).toLowerCase()}:${String(row.name).trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).
    sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  };

  const buildVirtualOutlets = () => [
  { id: null, name: 'Kitchen', type: 'food', sort_order: 1, _virtual: true },
  { id: null, name: 'Bar', type: 'beverage', sort_order: 2, _virtual: true },
  { id: null, name: 'Others', type: 'accommodation', sort_order: 3, _virtual: true }];


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

export function getOutlets() {
  return dedupePromise('getOutlets', _getOutlets);
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

async function getPosOrderWithItemsById(id) {
  const cached = readCache('pos-orders').find((order) => order.id === id);
  if (cached && (Array.isArray(cached.pos_order_items) || Array.isArray(cached.items))) return cached;
  if (state.isOnline) {
    const { data, error } = await state.supabase.
    from('pos_orders').
    select('*, pos_order_items(*), outlets(name)').
    eq('lodge_id', state.lodgeId).
    eq('id', id).
    maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      const current = readCache('pos-orders');
      writeCache('pos-orders', [data, ...current.filter((order) => order.id !== id)]);
    }
    return data || null;
  }
  return cached || null;
}

export async function createPosOrder(data) {
  try {
    const items = data.items || [];
    const totals = buildPosTotals(items, data);
    const total = totals.total;
    const paymentBreakdown = normalizePaymentBreakdown(data.payment_breakdown || data.payments, data.payment_method || 'cash', total);
    const paymentMethod = data.payment_method || (paymentBreakdown.length > 1 ? 'split' : paymentBreakdown[0]?.method || 'cash');
    const callerOrderId = String(data?.id || '').trim();
    const callerSubmitIntentId = String(data?.submit_intent_id || '').trim();
    const submitIntentId = callerSubmitIntentId || randomUUID();
    const orderId = callerOrderId || submitIntentId;
    const submitIdempotencyKey = `pos-order:${submitIntentId}`;

    // Restaurant mode guard: reject room/event/folio charges
    const cachedSettings = readCache('settings')?.[0] || {};
    const propertyType = cachedSettings.property_type || cachedSettings.business_type || 'lodge';
    const isRestaurantMode = propertyType === 'restaurant' || propertyType === 'pos_only';
    if (isRestaurantMode && (data.room_id || data.booking_id || data.event_booking_id || paymentMethod === 'folio')) {
      throw new Error('Room charges, booking charges, and folio payments are not available in restaurant mode.');
    }
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
    let bookingId = cachedBooking?.id || data.booking_id || null;
    const eventBookingId = data.event_booking_id || null;

    if ((data.payment_method || 'cash') === 'folio' && !bookingId && !eventBookingId && data.room_id && state.isOnline) {
      const liveBooking = await getActiveBookingForRoom(data.room_id).catch(() => null);
      bookingId = liveBooking?.id || null;
    }

    if ((data.payment_method || 'cash') === 'folio' && !bookingId && !eventBookingId) {
      throw new Error('Folio charge requires an active booking or an active event.');
    }

    // Offline path: queue v3 payload (server resolves prices from catalog on replay)
    if (!state.isOnline) {
      // If a booking_id was explicitly provided, verify it exists in cache
      if (data.booking_id && !cachedBooking) {
        throw new Error(`Booking ${data.booking_id} not found locally. Sync the latest bookings and try again.`);
      }
      // For folio charges, ensure we have a valid booking (same as online check above, but explicit)
      if ((data.payment_method || 'cash') === 'folio' && !bookingId && !eventBookingId) {
        throw new Error('Folio charge requires an active booking or an active event.');
      }
      if (!data.shift_id) {
        throw new Error('shift_id is mandatory. Open a shift before creating orders.');
      }
      // Resolve catalog snapshot for offline (from cache)
      let offlineCatalogSnapshotId = data.catalog_snapshot_id || null;
      if (!offlineCatalogSnapshotId) {
        const cachedSnapshots = readCache('pos-catalog-snapshots');
        const cachedSnapshot = (Array.isArray(cachedSnapshots) ? cachedSnapshots : []).find((entry) =>
          entry?.success === true &&
          (entry?.outlet_id || null) === (data.outlet_id || null)
        );
        offlineCatalogSnapshotId = cachedSnapshot?.snapshot_id || null;
      }
      if (!offlineCatalogSnapshotId) {
        throw new Error('No catalog snapshot available offline. Connect to the internet, publish a catalog, then retry.');
      }

      const id = orderId;
      const createdAt = data.created_at_client || new Date().toISOString();
      const idempotencyKey = submitIdempotencyKey;
      const inventoryReservations = getOfflinePosInventoryReservation(items);

      // v3 offline payload: only item selections, no client-computed prices
      const v3OfflineItems = items.map((item) => ({
        menu_item_id: item.menu_item_id || null,
        quantity: normalizePositiveQty(item.quantity, 1),
        modifier_option_ids: Array.isArray(item.modifier_option_ids)
          ? item.modifier_option_ids
          : (Array.isArray(item.modifiers) ? item.modifiers : [])
            .map((modifier) => typeof modifier === 'string' ? modifier : modifier?.id)
            .filter(Boolean),
        item_notes: item.item_notes || null
      }));

      const v3OfflinePayload = {
        id,
        lodge_id: state.lodgeId,
        catalog_snapshot_id: offlineCatalogSnapshotId,
        shift_id: data.shift_id,
        source_device_id: getDesktopPosDeviceId(),
        outlet_id: data.outlet_id || null,
        walk_in_name: data.walk_in_name || null,
        room_id: data.room_id || null,
        booking_id: bookingId || null,
        event_booking_id: eventBookingId || null,
        notes: data.notes || null,
        payment_method: paymentMethod,
        payment_breakdown: paymentBreakdown,
        service_mode: data.service_mode || (data.table_name ? 'table' : data.room_id ? 'room' : 'takeaway'),
        table_name: data.table_name || null,
        tab_name: data.tab_name || null,
        waiter_name: data.waiter_name || null,
        ticket_status: data.ticket_status || 'new',
        create_idempotency_key: idempotencyKey,
        client_created_at: createdAt,
        tip_total: totals.tip_total,
        promotion_id: data.promotion_id || null,
        manual_discount: data.manual_discount || null,
        items: v3OfflineItems
      };

      queueOperation('rpc', 'create_pos_order_v3', {
        payload: v3OfflinePayload
      }, null, {
        _queue_id: `pos-order-${id}`,
        ...(cachedBooking?._pending_sync ? { _depends_on: `booking-${cachedBooking.id}` } : {})
      });

      // Queue recipe depletion as dependent operation for offline replay
      const recipeDepletionItems = items
        .filter((item) => item.menu_item_id)
        .map((item) => ({
          menu_item_id: item.menu_item_id || null,
          order_item_id: item.id || null,
          quantity: normalizePositiveQty(item.quantity, 1)
        }));
      if (recipeDepletionItems.length > 0) {
        queueOperation('rpc', 'record_recipe_stock_depletion', {
          payload: {
            lodge_id: state.lodgeId,
            order_id: id,
            items: recipeDepletionItems
          }
        }, null, {
          _queue_id: `pos-recipe-depletion-${id}`,
          _depends_on: `pos-order-${id}`
        });
      }

      const orderRow = {
        id,
        lodge_id: state.lodgeId,
        room_id: data.room_id || null,
        booking_id: bookingId,
        event_booking_id: eventBookingId || null,
        walk_in_name: data.walk_in_name || null,
        outlet_id: data.outlet_id || null,
        notes: data.notes || null,
        payment_method: paymentMethod,
        payment_breakdown: paymentBreakdown,
        total,
        gross_total: totals.gross_total,
        discount_total: totals.discount_total,
        tax_rate: totals.tax_rate,
        tax_total: totals.tax_total,
        tip_total: totals.tip_total,
        status: 'pending',
        service_mode: data.service_mode || (data.table_name ? 'table' : data.room_id ? 'room' : 'takeaway'),
        table_name: data.table_name || null,
        tab_name: data.tab_name || null,
        waiter_name: data.waiter_name || null,
        cashier_id: state.currentUser?.id || null,
        cashier_name: state.currentUser?.name || state.currentUser?.email || null,
        shift_id: data.shift_id || null,
        ticket_status: data.ticket_status || 'new',
        catalog_snapshot_id: offlineCatalogSnapshotId,
        created_at: createdAt,
        _pending_sync: true,
        _sync_state: 'pending',
        _sync_error: null,
        _idempotency_key: idempotencyKey,
        _sync_created_offline: true,
        pos_order_items: items.map((item) => ({
          id: randomUUID(),
          order_id: id,
          lodge_id: state.lodgeId,
          menu_item_id: item.menu_item_id || null,
          inventory_item_id: item.inventory_item_id || null,
          depletion_qty: normalizePositiveQty(item.depletion_qty, 1),
          item_name: item.item_name,
          category: item.category || null,
          modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
          item_notes: item.item_notes || null,
          quantity: normalizePositiveQty(item.quantity, 1),
          unit_price: Number(item.unit_price || 0),
          subtotal: normalizePositiveQty(item.quantity, 1) * Number(item.unit_price || 0),
          kitchen_station_id: item.kitchen_station_id || null
        }))
      };

      const cachedOrders = readCache('pos-orders');
      cachedOrders.unshift(orderRow);
      writeCache('pos-orders', cachedOrders);

      const cachedLineItems = readCache('pos-order-items');
      writeCache('pos-order-items', [...orderRow.pos_order_items, ...cachedLineItems]);
      applyOfflinePosInventoryReservation(inventoryReservations);
      appendPrepTickets(orderRow, orderRow.pos_order_items);
      appendPosAudit('order_completed_offline', { entity_type: 'pos_order', entity_id: id, details: { total, outlet_id: data.outlet_id || null, table_name: data.table_name || null, catalog_snapshot_id: offlineCatalogSnapshotId, v3: true } });
      if (data.tab_id) await closePosTab(data.tab_id).catch(() => {});

      return { success: true, id, offline: true, provisional: true };
    }

    // Resolve booking ID before entering the transaction (read-only, safe outside)
    let bookingIdForRpc = bookingId;
    if (data.room_id && !bookingIdForRpc) {
      const booking = await getActiveBookingForRoom(data.room_id);
      bookingIdForRpc = booking?.id || null;
    }

    // Resolve catalog snapshot (mandatory for v3)
    let catalogSnapshotId = data.catalog_snapshot_id || null;
    if (!catalogSnapshotId) {
      try {
        const snapshot = await getActivePosCatalogSnapshot(data.outlet_id || null);
        catalogSnapshotId = snapshot?.snapshot_id || null;
      } catch (snapErr) {
        throw new Error(`Catalog snapshot required: ${snapErr.message}`);
      }
    }
    if (!catalogSnapshotId) {
      throw new Error('catalog_snapshot_id is mandatory. Publish a catalog before trading.');
    }
    if (!data.shift_id) {
      throw new Error('shift_id is mandatory. Open a shift before creating orders.');
    }

    // v3 RPC: server resolves all prices from catalog snapshot.
    // Client sends only item selections (menu_item_id, quantity, item_name, category, modifiers).
    // Server ignores any client-supplied unit_price.
    const v3Payload = {
      id: orderId,
      lodge_id: state.lodgeId,
      catalog_snapshot_id: catalogSnapshotId,
      shift_id: data.shift_id,
      source_device_id: getDesktopPosDeviceId(),
      outlet_id: data.outlet_id || null,
      walk_in_name: data.walk_in_name || null,
      room_id: data.room_id || null,
      booking_id: bookingIdForRpc || null,
      event_booking_id: eventBookingId || null,
      notes: data.notes || null,
      payment_method: paymentMethod,
      payment_breakdown: paymentBreakdown,
      service_mode: data.service_mode || (data.table_name ? 'table' : data.room_id ? 'room' : 'takeaway'),
      table_name: data.table_name || null,
      tab_name: data.tab_name || null,
      waiter_name: data.waiter_name || null,
      ticket_status: data.ticket_status || 'new',
      create_idempotency_key: submitIdempotencyKey,
      client_created_at: data.created_at_client || new Date().toISOString(),
      tip_total: totals.tip_total,
      promotion_id: data.promotion_id || null,
      manual_discount: data.manual_discount || null,
      items: items.map((i) => ({
        menu_item_id: i.menu_item_id || null,
        quantity: i.quantity,
        modifier_option_ids: Array.isArray(i.modifier_option_ids)
          ? i.modifier_option_ids
          : (Array.isArray(i.modifiers) ? i.modifiers : [])
            .map((modifier) => typeof modifier === 'string' ? modifier : modifier?.id)
            .filter(Boolean),
        item_notes: i.item_notes || null
      }))
    };

    // All DB writes are delegated to a single Postgres transaction via RPC.
    // If any step fails, Postgres rolls back the entire operation automatically.
    const { data: result, error } = await state.supabase.rpc('create_pos_order_v3', {
      payload: v3Payload
    });

    if (error) throw new Error(error.message);
    if (result?.success) {
      const serverTotal = normalizeMoney(result.total || 0);
      // Use server-created tickets from the RPC result (item-grouped by station)
      const serverTickets = Array.isArray(result.tickets) ? result.tickets : [];
      if (serverTickets.length > 0) {
        writePosTickets([...serverTickets, ...readPosTickets()]);
      } else {
        // Fallback: fetch tickets if RPC didn't return them
        try {
          const { data: fetchedTickets } = await state.supabase
            .from('pos_prep_tickets')
            .select('*')
            .eq('lodge_id', state.lodgeId)
            .eq('order_id', result.id || orderId);
          if (Array.isArray(fetchedTickets) && fetchedTickets.length > 0) {
            writePosTickets([...fetchedTickets, ...readPosTickets()]);
          }
        } catch (ticketErr) {
          console.warn('[POS] Could not fetch server tickets:', ticketErr?.message || ticketErr);
        }
      }
      appendPosAudit('order_completed', { entity_type: 'pos_order', entity_id: result.id || orderId, details: { total: serverTotal, outlet_id: data.outlet_id || null, table_name: data.table_name || null, catalog_snapshot_id: catalogSnapshotId, v3: true, ticket_count: serverTickets.length } });
      if (data.tab_id) closePosTab(data.tab_id).catch(() => {});
      // Synchronous recipe depletion - must complete with order
      await recordRecipeStockDepletion(result.id || orderId, items);
    }
    return result;
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

export async function approvePosVoidWithPin(payload) {
  const { order_id, pin, reason, cashier_user_id, outlet_id } = payload || {};

  if (!order_id || !pin) {
    return { success: false, error: 'Order and PIN are required' };
  }
  if (!String(reason || '').trim()) {
    return { success: false, error: 'A void reason is required' };
  }

  const cachedOrders = readCache('pos-orders');
  const cachedOrder = cachedOrders.find((order) => order?.id === order_id);
  if (!cachedOrder && !state.isOnline) {
    return { success: false, error: 'Order not found on this computer' };
  }

  const logId = payload?.override_log_id || randomUUID();
  const createdAt = payload?.created_at || new Date().toISOString();
  const rpcPayload = {
    order_id,
    lodge_id: state.lodgeId,
    requested_by: cashier_user_id || null,
    approved_by: payload?.approver_id || null,
    pin: String(pin).trim(),
    device_id: getDesktopPosDeviceId(),
    reason: String(reason).trim(),
    outlet_id: outlet_id || cachedOrder?.outlet_id || null,
    override_log_id: logId,
    created_at: createdAt
  };

  const queuePendingVoid = () => {
    if (cachedOrder?.status === 'voided') {
      return { success: false, error: 'Order is already voided' };
    }

    const queueMeta = {
      _queue_id: `pos-void-${order_id}`,
      ...(cachedOrder?._pending_sync || cachedOrder?._sync_created_offline ? { _depends_on: `pos-order-${order_id}` } : {})
    };
    queueOperation('rpc', 'approve_pos_void_with_pin', {
      payload: rpcPayload
    }, null, queueMeta);

    patchCachedPosOrderSyncState(order_id, {
      _pending_sync: true,
      _sync_state: 'pending',
      _sync_error: null,
      _pending_void: true,
      _void_reason: String(reason).trim()
    });
    upsertLocalPosVoidHistory({
      id: logId,
      order_id,
      action: 'void',
      requested_by: cashier_user_id || null,
      approved_by: null,
      approver_name: 'Pending server validation',
      reason: String(reason).trim(),
      outlet_id: outlet_id || cachedOrder?.outlet_id || null,
      created_at: createdAt,
      _pending_sync: true,
      _sync_state: 'pending'
    });
    return {
      success: true,
      offline: true,
      provisional: true,
      override_log_id: logId,
      reason: String(reason).trim()
    };
  };

  if (!state.isOnline) {
    return queuePendingVoid();
  }

  try {
    const { data: result, error } = await state.supabase.rpc('approve_pos_void_with_pin', {
      payload: rpcPayload
    });

    if (error) throw new Error(error.message);
    if (!result?.success) return { success: false, error: result?.error || 'Could not void order' };
    upsertLocalPosVoidHistory({
      id: result.override_log_id || logId,
      order_id,
      action: 'void',
      requested_by: cashier_user_id || null,
      approved_by: result.approved_by || null,
      approver_name: result.approver_name || null,
      reason: String(reason).trim(),
      outlet_id: outlet_id || cachedOrder?.outlet_id || null,
      created_at: createdAt,
      _pending_sync: false,
      _sync_state: 'synced'
    });
    await refreshCache('pos-orders', 'inventory-items', 'inventory-purchases').catch(() => {});
    return result;
  } catch (error) {
    if (isNetworkError(error) && cachedOrder) {
      return queuePendingVoid();
    }
    throw error;
  }
}

export async function createPosPartialReturnWithPin(payload = {}) {
  const {
    order_id,
    pin,
    reason,
    lines = [],
    cashier_user_id,
    outlet_id,
    payment_method,
    shift_id
  } = payload || {};

  if (!order_id || !pin) {
    return { success: false, error: 'Order and PIN are required' };
  }
  if (!String(reason || '').trim()) {
    return { success: false, error: 'Reason is required' };
  }
  if (!shift_id) {
    return { success: false, error: 'Open shift is required for returns' };
  }

  const originalOrder = await getPosOrderWithItemsById(order_id);
  if (!originalOrder) return { success: false, error: 'Original order not found' };
  if (originalOrder.status === 'voided') return { success: false, error: 'Cannot return items from a voided order' };

  const originalLines = Array.isArray(originalOrder.pos_order_items) ?
  originalOrder.pos_order_items :
  Array.isArray(originalOrder.items) ?
  originalOrder.items :
  [];
  const requestedByLine = new Map((lines || []).
  map((line) => [String(line.line_id || line.id || '').trim(), Number(line.quantity || 0)]).
  filter(([lineId, quantity]) => lineId && Number.isFinite(quantity) && quantity > 0));
  const returnLines = [];

  for (const line of originalLines) {
    const lineId = String(line.id || '').trim();
    const requestedQty = requestedByLine.get(lineId) || 0;
    if (!(requestedQty > 0)) continue;
    const originalQty = Number(line.quantity || 0);
    const unitPrice = Number(line.unit_price || 0);
    if (!(originalQty > 0) || unitPrice < 0) continue;
    if (!Number.isInteger(requestedQty)) {
      return { success: false, error: 'Return quantities must be whole numbers.' };
    }
    if (requestedQty > originalQty) {
      return { success: false, error: `Return quantity exceeds the sold quantity for ${line.item_name || 'an item'}.` };
    }
    const returnQty = requestedQty;
    returnLines.push({
      original_order_item_id: lineId,
      menu_item_id: line.menu_item_id || null,
      inventory_item_id: line.inventory_item_id || null,
      depletion_qty: normalizePositiveQty(line.depletion_qty, 1),
      item_name: `Return: ${line.item_name || 'POS item'}`,
      quantity: -returnQty,
      unit_price: unitPrice
    });
  }

  if (returnLines.length === 0) {
    return { success: false, error: 'Select at least one item quantity to return.' };
  }

  const returnId = payload.return_order_id || randomUUID();
  const createdAt = payload.created_at || new Date().toISOString();
  const total = returnLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0);
  const notes = [
  `Partial return for POS order ${String(order_id).slice(0, 8)}`,
  String(reason || '').trim()]
  .filter(Boolean).
  join(' · ');

  // P0-4: Use database-authoritative return RPC
  const rpcPayload = {
    order_id,
    lodge_id: state.lodgeId,
    return_order_id: returnId,
    return_idempotency_key: `pos-return:${returnId}`,
    shift_id,
    approval_pin: String(pin).trim(),
    approver_id: payload?.approver_id || null,
    device_id: getDesktopPosDeviceId(),
    reason: String(reason).trim(),
    requested_by: cashier_user_id || null,
    outlet_id: outlet_id || originalOrder.outlet_id || null,
    override_log_id: payload.override_log_id || randomUUID(),
    created_at: createdAt,
    lines: returnLines.map((line) => ({
      line_id: line.original_order_item_id,
      quantity: Math.abs(Number(line.quantity) || 0)
    }))
  };

  const queuePendingReturn = () => {
    queueOperation('rpc', 'create_pos_return_v3', { payload: rpcPayload }, returnId, {
      _queue_id: `pos-return-${returnId}`,
      ...(originalOrder._pending_sync ? { _depends_on: `pos-order-${order_id}` } : {})
    });
    const orderRow = {
      id: returnId,
      lodge_id: state.lodgeId,
      order_id,
      items: returnLines,
      total,
      gross_total: total,
      payment_method: payment_method || originalOrder.payment_method || 'cash',
      outlet_id: outlet_id || originalOrder.outlet_id || null,
      walk_in_name: `Return: ${originalOrder.walk_in_name || 'Guest'}`,
      notes,
      status: 'pending',
      created_at: createdAt,
      _pending_sync: true,
      _sync_state: 'pending',
      _pending_return: true,
      _sync_created_offline: true,
      pos_order_items: returnLines.map((line) => ({
        id: randomUUID(),
        order_id: returnId,
        lodge_id: state.lodgeId,
        ...line,
        subtotal: Number(line.quantity || 0) * Number(line.unit_price || 0)
      }))
    };
    const cachedOrders = readCache('pos-orders');
    cachedOrders.unshift(orderRow);
    writeCache('pos-orders', cachedOrders);
    upsertLocalPosVoidHistory({
      id: rpcPayload.override_log_id,
      order_id,
      action: 'partial_return',
      requested_by: cashier_user_id || null,
      approved_by: null,
      approver_name: 'Pending server validation',
      reason: String(reason).trim(),
      outlet_id: outlet_id || originalOrder.outlet_id || null,
      created_at: createdAt,
      return_order_id: returnId,
      return_total: total,
      _pending_sync: true,
      _sync_state: 'pending'
    });
    return { success: true, id: returnId, total, offline: true, provisional: true };
  };

  if (!state.isOnline || !state.supabase) return queuePendingReturn();

  try {
    const { data: result, error } = await state.supabase.rpc('create_pos_return_v3', { payload: rpcPayload });
    if (error) throw new Error(error.message);
    if (!result?.success) return { success: false, error: result?.error || 'Return failed' };
    upsertLocalPosVoidHistory({
      id: rpcPayload.override_log_id,
      order_id,
      action: 'partial_return',
      requested_by: cashier_user_id || null,
      approved_by: result.approved_by || null,
      approver_name: result.approver_name || null,
      reason: String(reason).trim(),
      outlet_id: outlet_id || originalOrder.outlet_id || null,
      created_at: createdAt,
      return_order_id: result.id || returnId,
      return_total: result.total,
      _pending_sync: false,
      _sync_state: 'synced'
    });
    await refreshCache('pos-orders', 'inventory-items', 'inventory-purchases').catch(() => {});
    return result;
  } catch (error) {
    if (isNetworkError(error)) return queuePendingReturn();
    throw error;
  }
}

export async function approvePosDiscountWithPin(payload = {}) {
  const { pin, discount_type, discount_value, reason, cashier_user_id, outlet_id, order_total } = payload || {};

  if (!pin) {
    return { success: false, error: 'Manager PIN is required to approve discounts.' };
  }
  if (!discount_value || Number(discount_value) <= 0) {
    return { success: false, error: 'Discount value must be greater than zero.' };
  }
  if (!String(reason || '').trim()) {
    return { success: false, error: 'A reason for the discount is required.' };
  }

  const discountAmount = discount_type === 'percent'
    ? (Number(order_total || 0) * Math.min(Number(discount_value), 100) / 100)
    : Number(discount_value);

  const approvalId = randomUUID();
  const createdAt = new Date().toISOString();

  const rpcPayload = {
    lodge_id: state.lodgeId,
    pin: String(pin).trim(),
    device_id: getDesktopPosDeviceId(),
    action: 'discount',
    discount_type: discount_type || 'amount',
    discount_value: Number(discount_value),
    discount_amount: Math.round(discountAmount * 100) / 100,
    reason: String(reason).trim(),
    requested_by: cashier_user_id || null,
    outlet_id: outlet_id || null,
    approval_id: approvalId,
    created_at: createdAt
  };

  if (!state.isOnline || !state.supabase) {
    return {
      success: false,
      error: 'Discount approval requires an internet connection so the manager PIN can be verified.'
    };
  }

  try {
    const { data: result, error } = await state.supabase.rpc('approve_pos_discount_with_pin', {
      payload: rpcPayload
    });

    if (error) throw new Error(error.message);
    if (!result?.success) return { success: false, error: result?.error || 'Could not approve discount.' };

    appendPosAudit('pos:discount_approved', {
      approval_id: result.approval_id || approvalId,
      approved_by: result.approved_by || null,
      approver_name: result.approver_name || null,
      discount_type: discount_type || 'amount',
      discount_value: Number(discount_value),
      discount_amount: result.discount_amount || Math.round(discountAmount * 100) / 100,
      reason: String(reason).trim()
    });

    return result;
  } catch (error) {
    if (isNetworkError(error)) {
      return {
        success: false,
        error: 'Discount approval could not be verified. Check the connection and try again.'
      };
    }
    throw error;
  }
}

function summarizeCashupOrders(orders = [], { openingFloat = 0 } = {}) {
  const completed = (orders || []).filter((order) => order?.status === 'completed');
  const voided = (orders || []).filter((order) => order?.status === 'voided');
  const byMethod = {};
  let grossSales = 0;
  let returnTotal = 0;
  let pendingCount = 0;

  for (const order of completed) {
    const total = normalizeMoney(order.total);
    const orderSign = total >= 0 ? 1 : -1;
    for (const payment of getOrderPaymentRows(order)) {
      const amount = Number(payment.amount || 0);
      const signedAmount = orderSign < 0 ? -Math.abs(amount) : Math.abs(amount);
      byMethod[payment.method] = normalizeMoney((byMethod[payment.method] || 0) + signedAmount);
    }
    if (total >= 0) grossSales = normalizeMoney(grossSales + total);
    else returnTotal = normalizeMoney(returnTotal + Math.abs(total));
    if (order._pending_sync || order._sync_state === 'pending') pendingCount += 1;
  }

  const netSales = normalizeMoney(completed.reduce((sum, order) => sum + normalizeMoney(order.total), 0));
  const cashSales = normalizeMoney(byMethod.cash || 0);
  return {
    orders_count: completed.length,
    void_count: voided.length,
    pending_count: pendingCount,
    gross_sales: grossSales,
    returns_total: returnTotal,
    net_sales: netSales,
    by_method: byMethod,
    expected_cash_sales: cashSales,
    expected_cash_drawer: normalizeMoney(openingFloat + cashSales)
  };
}

export async function getPosCashupSummary(filters = {}) {
  if (state.isOnline && state.supabase && filters.shift_id) {
    const { data, error } = await state.supabase.rpc('get_pos_shift_cashup_preview_v2', {
      p_shift_id: filters.shift_id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not load the shift cash-up preview');
    return {
      ...data,
      date: data.business_date,
      outlet_id: filters.outlet_id || null,
      orders_count: data.order_count || 0,
      returns_total: data.returns || 0,
      by_method: data.expected_by_method || {},
      pending_count: 0,
      closed_cashups: readPosCashups().filter((row) => row.shift_id === filters.shift_id)
    };
  }

  const date = filters.date || new Date().toISOString().slice(0, 10);
  const outletId = filters.outlet_id && filters.outlet_id !== 'all' ? filters.outlet_id : null;
  const outletFilter = outletId ? [outletId] : Array.isArray(filters.outlet_filter) ? filters.outlet_filter : null;
  const operatorId = filters.cashier_id || null;
  const operatorName = filters.cashier_name || null;
  const orders = await getPosOrders(date, date, outletFilter);
  const scopedOrders = orders.filter((order) => {
    if (outletId && order.outlet_id !== outletId) return false;
    if (operatorId) return order.cashier_id === operatorId || (!order.cashier_id && order.cashier_name === operatorName);
    return true;
  });
  const openingFloat = normalizeMoney(filters.opening_float || 0);
  return {
    date,
    outlet_id: outletId,
    cashier_id: operatorId,
    cashier_name: operatorName,
    opening_float: openingFloat,
    ...summarizeCashupOrders(scopedOrders, { openingFloat }),
    closed_cashups: readPosCashups().filter((row) =>
      row.date === date &&
      (!outletId || row.outlet_id === outletId) &&
      (!operatorId || row.created_by === operatorId || row.cashier_id === operatorId)
    )
  };
}

export async function getPosCashups(limit = 30, outletFilter = null, filters = {}) {
  const max = Math.max(1, Math.min(200, Number(limit || 30)));
  const operatorId = filters?.cashier_id || null;
  const applyCashupOutletFilter = (rows = []) => {
    if (outletFilter !== null && outletFilter.length === 0) return [];
    const outletRows = outletFilter !== null ? rows.filter((row) => !row.outlet_id || outletFilter.includes(row.outlet_id)) : rows;
    if (!operatorId) return outletRows;
    return outletRows.filter((row) => row.created_by === operatorId || row.cashier_id === operatorId);
  };
  if (state.isOnline) {
    try {
      const { data, error } = await state.supabase.
      from('pos_cashup_sessions').
      select('*, outlets(name)').
      eq('lodge_id', state.lodgeId).
      order('created_at', { ascending: false }).
      limit(max);
      if (error) throw error;
      const rows = (data || []).map((row) => ({
        ...row,
        outlet_name: row.outlets?.name || null
      }));
      if (rows.length > 0) writePosCashups(rows);
      return applyCashupOutletFilter(rows.length > 0 ? rows : readPosCashups()).slice(0, max);
    } catch {
      return applyCashupOutletFilter(readPosCashups()).slice(0, max);
    }
  }
  return applyCashupOutletFilter(readPosCashups()).slice(0, max);
}

export async function createPosCashupSession(payload = {}) {
  const id = payload.id || randomUUID();
  if (!payload.shift_id) {
    return { success: false, error: 'An open shift is required before cash-up can be finalized.' };
  }

  const openingFloat = normalizeMoney(payload.opening_float || 0);
  const operatorId = payload.cashier_id || payload.created_by || state.currentUser?.id || null;
  const operatorName = payload.cashier_name || payload.created_by_name || state.currentUser?.name || state.currentUser?.email || null;
  const summary = await getPosCashupSummary({
    shift_id: payload.shift_id,
    date: payload.date,
    outlet_id: payload.outlet_id || null,
    outlet_filter: payload.outlet_filter || null,
    opening_float: openingFloat,
    cashier_id: operatorId,
    cashier_name: operatorName
  });
  const counted = {
    cash: normalizeMoney(payload.counted?.cash ?? payload.counted_cash ?? 0),
    card: normalizeMoney(payload.counted?.card ?? payload.counted_card ?? 0),
    bank_transfer: normalizeMoney(payload.counted?.bank_transfer ?? payload.counted_bank_transfer ?? 0),
    orange_money: normalizeMoney(payload.counted?.orange_money ?? 0),
    myzaka: normalizeMoney(payload.counted?.myzaka ?? 0),
    smega: normalizeMoney(payload.counted?.smega ?? 0),
    other: normalizeMoney(payload.counted?.other ?? 0)
  };
  const varianceByMethod = Object.fromEntries(Object.entries(counted).map(([method, amount]) => {
    const expected = method === 'cash'
      ? summary.expected_cash_drawer
      : normalizeMoney(summary.by_method?.[method] || 0);
    return [method, normalizeMoney(amount - expected)];
  }));
  const idempotencyKey = payload.idempotency_key || `pos-cashup:${id}`;
  const rpcPayload = {
    lodge_id: state.lodgeId,
    shift_id: payload.shift_id,
    cashup_id: id,
    idempotency_key: idempotencyKey,
    counted_by_method: counted,
    notes: payload.notes || null
  };
  const row = {
    id,
    lodge_id: state.lodgeId,
    date: summary.date,
    outlet_id: summary.outlet_id || null,
    opening_float: openingFloat,
    expected_cash_drawer: summary.expected_cash_drawer,
    expected_by_method: summary.by_method,
    counted_by_method: counted,
    variance_by_method: varianceByMethod,
    cash_over_short: varianceByMethod.cash || 0,
    orders_count: summary.orders_count,
    void_count: summary.void_count,
    pending_count: summary.pending_count,
    gross_sales: summary.gross_sales,
    returns_total: summary.returns_total,
    net_sales: summary.net_sales,
    notes: payload.notes || null,
    created_by: operatorId,
    created_by_name: operatorName,
    cashier_id: operatorId,
    cashier_name: operatorName,
    shift_id: payload.shift_id,
    idempotency_key: idempotencyKey,
    created_at: new Date().toISOString(),
    _pending_sync: !state.isOnline,
    _sync_state: state.isOnline ? 'synced' : 'pending'
  };

  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('finalize_pos_shift_cashup_v2', { payload: rpcPayload });
    if (error) throw new Error(error.message);
    if (!data?.success) return { success: false, error: data?.error || 'Could not finalize cash-up' };
    const saved = upsertLocalPosCashup({
      ...row,
      id: data.cashup_id || id,
      expected_cash_drawer: Number(data.expected_cash_drawer || 0),
      expected_by_method: data.expected_by_method || {},
      counted_by_method: data.counted_by_method || counted,
      variance_by_method: data.variance_by_method || {},
      _pending_sync: false,
      _sync_state: 'synced'
    });
    await refreshCache('pos-orders').catch(() => {});
    return { success: true, id: saved.id, row: saved };
  }

  queueOperation('rpc', 'finalize_pos_shift_cashup_v2', { payload: rpcPayload }, null, {
    _queue_id: `pos-cashup-${id}`
  });
  const saved = upsertLocalPosCashup({ ...row, _pending_sync: true, _sync_state: 'pending' });
  return { success: true, id: saved.id, row: saved, offline: true, provisional: true };
}

function readPosTabs() {
  const rows = readCache('pos-tabs');
  return Array.isArray(rows) ? rows : [];
}

function writePosTabs(rows = []) {
  writeCache('pos-tabs', rows.slice(0, 500));
}

const ACTIVE_TABLE_TAB_STATUSES = new Set(['open', 'running', 'ready', 'delivered']);

function normalizeTableName(value) {
  return String(value || '').trim();
}

function normalizeTabStatus(value, fallback = 'open') {
  const status = String(value || '').trim().toLowerCase();
  return ['open', 'running', 'ready', 'delivered', 'closed', 'cancelled'].includes(status) ? status : fallback;
}

function isActiveTableTab(row = {}) {
  return !!normalizeTableName(row.table_name) && ACTIVE_TABLE_TAB_STATUSES.has(normalizeTabStatus(row.status));
}

function sameOutlet(a, b) {
  return String(a || '') === String(b || '');
}

function findActiveTableTab(rows = [], tableName, outletId = null, excludeId = null) {
  const targetName = normalizeTableName(tableName).toLowerCase();
  if (!targetName) return null;
  return (rows || []).find((row) =>
    isActiveTableTab(row) &&
    normalizeTableName(row.table_name).toLowerCase() === targetName &&
    sameOutlet(row.outlet_id || null, outletId || null) &&
    (!excludeId || row.id !== excludeId)
  ) || null;
}

function upsertLocalPosTab(row = {}) {
  const next = [
    row,
    ...readPosTabs().filter((entry) => entry.id !== row.id)
  ].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  writePosTabs(next);
  return row;
}

async function fetchRemotePosTabs() {
  if (!state.isOnline || !state.supabase || !state.lodgeId) return null;
  const { data, error } = await state.supabase
    .from('pos_tabs')
    .select('*')
    .eq('lodge_id', state.lodgeId)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function getPosTabs() {
  try {
    const remote = await fetchRemotePosTabs();
    if (remote) {
      const merged = [
        ...remote,
        ...readPosTabs().filter((local) => !remote.some((row) => row.id === local.id))
      ].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      writePosTabs(merged);
      return merged;
    }
  } catch (error) {
    console.warn('[POS TABS] Remote tab refresh unavailable:', error?.message || error);
  }
  return readPosTabs().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export async function savePosTab(data = {}) {
  if (normalizeTableName(data.table_name) && !normalizeTableName(data.waiter_name)) {
    return { success: false, error: 'Served-by staff is required before opening a table.' };
  }
  const id = data.id || randomUUID();
  const now = new Date().toISOString();
  const tableName = normalizeTableName(data.table_name) || null;
  const outletId = data.outlet_id || null;
  const existingActive = findActiveTableTab(readPosTabs(), tableName, outletId, id);
  if (existingActive) {
    return {
      success: true,
      already_open: true,
      error: `${tableName} is already running. Loaded the existing table tab instead.`,
      tab: existingActive
    };
  }
  const row = {
    id,
    lodge_id: state.lodgeId,
    outlet_id: outletId,
    table_name: tableName,
    tab_name: String(data.tab_name || '').trim() || null,
    customer_name: String(data.customer_name || '').trim() || null,
    waiter_name: String(data.waiter_name || '').trim() || null,
    room_id: data.room_id || null,
    booking_id: data.booking_id || null,
    items: Array.isArray(data.items) ? data.items : [],
    notes: data.notes || null,
    status: normalizeTabStatus(data.status, tableName ? 'running' : 'open'),
    opened_by: data.opened_by || state.currentUser?.id || null,
    opened_by_name: data.opened_by_name || state.currentUser?.name || state.currentUser?.email || null,
    created_at: data.created_at || now,
    updated_at: now
  };
  upsertLocalPosTab(row);

  if (state.isOnline && state.supabase) {
    try {
      const { data: rpcData, error } = await state.supabase.rpc('upsert_pos_tab', { payload: row });
      if (error) throw new Error(error.message);
      const remoteRow = rpcData?.tab || rpcData?.row || null;
      if (remoteRow?.id) upsertLocalPosTab(remoteRow);
      if (rpcData?.already_open) {
        writePosTabs(readPosTabs().filter((entry) => entry.id !== row.id || entry.id === remoteRow?.id));
        return {
          success: true,
          already_open: true,
          error: `${remoteRow?.table_name || tableName} is already running. Loaded the existing table tab instead.`,
          tab: remoteRow || existingActive || row
        };
      }
      return { success: true, tab: remoteRow || row };
    } catch (error) {
      console.warn('[POS TABS] Remote tab save unavailable; kept local table session:', error?.message || error);
    }
  } else {
    queueOperation('rpc', 'upsert_pos_tab', { payload: row }, null, {
      _queue_id: `pos-tab-${id}`
    });
  }

  appendPosAudit('tab_saved', { entity_type: 'pos_tab', entity_id: row.id, details: { table_name: row.table_name, status: row.status, waiter_name: row.waiter_name } });
  return { success: true, tab: row, offline: true };
}

export async function updatePosTabStatus(id, status = 'closed', extra = {}) {
  const nextStatus = normalizeTabStatus(status, 'closed');
  const now = new Date().toISOString();
  let updated = null;
  writePosTabs(readPosTabs().map((row) => {
    if (row.id !== id) return row;
    updated = { ...row, ...extra, status: nextStatus, updated_at: now };
    return updated;
  }));
  if (!updated) return { success: false, error: 'Open table tab not found.' };
  appendPosAudit('tab_status_updated', { entity_type: 'pos_tab', entity_id: id, details: { status: nextStatus, table_name: updated.table_name || null } });

  if (state.isOnline && state.supabase) {
    try {
      const { error } = await state.supabase.rpc('update_pos_tab_status', {
        p_tab_id: id,
        p_status: nextStatus,
        p_notes: extra.notes || null
      });
      if (error) throw new Error(error.message);
    } catch (error) {
      console.warn('[POS TABS] Remote status update unavailable; kept local status:', error?.message || error);
    }
  } else {
    queueOperation('rpc', 'update_pos_tab_status', { p_tab_id: id, p_status: nextStatus, p_notes: extra.notes || null }, null, {
      _queue_id: `pos-tab-status-${id}-${nextStatus}`
    });
  }

  return { success: true, tab: updated };
}

export async function closePosTab(id, status = 'closed') {
  return updatePosTabStatus(id, status);
}

export async function overridePosTableTab(data = {}) {
  const action = String(data.action || '').trim().toLowerCase();
  const sourceId = data.source_tab_id || data.id || null;
  const targetTableName = normalizeTableName(data.target_table_name);
  const now = new Date().toISOString();
  const rows = readPosTabs();
  const source = rows.find((row) => row.id === sourceId);
  if (!source) return { success: false, error: 'Open table tab not found.' };

  if (action === 'close') {
    return updatePosTabStatus(sourceId, 'closed', {
      notes: [source.notes, data.reason || 'Manager closed stuck table'].filter(Boolean).join('\n')
    });
  }

  if (action === 'deliver') {
    return updatePosTabStatus(sourceId, 'delivered');
  }

  if (action === 'transfer') {
    if (!targetTableName) return { success: false, error: 'Target table is required.' };
    const existingTarget = findActiveTableTab(rows, targetTableName, source.outlet_id || null, sourceId);
    if (existingTarget) return { success: false, error: `${targetTableName} is already running. Use Merge instead.` };
    const updated = {
      ...source,
      table_name: targetTableName,
      tab_name: targetTableName,
      waiter_name: normalizeTableName(data.waiter_name) || source.waiter_name || null,
      status: 'running',
      updated_at: now
    };
    upsertLocalPosTab(updated);
    if (state.isOnline && state.supabase) {
      try { await state.supabase.rpc('upsert_pos_tab', { payload: updated }); } catch (error) { console.warn('[POS TABS] Transfer sync unavailable:', error?.message || error); }
    }
    return { success: true, tab: updated };
  }

  if (action === 'merge') {
    if (!targetTableName) return { success: false, error: 'Target table is required.' };
    const target = findActiveTableTab(rows, targetTableName, source.outlet_id || null, sourceId);
    if (!target) return { success: false, error: `${targetTableName} is not running. Use Transfer instead.` };
    const merged = {
      ...target,
      items: [...(Array.isArray(target.items) ? target.items : []), ...(Array.isArray(source.items) ? source.items : [])],
      notes: [target.notes, source.notes, `Merged from ${source.table_name || source.tab_name || 'another tab'}`].filter(Boolean).join('\n'),
      waiter_name: target.waiter_name || source.waiter_name || null,
      status: normalizeTabStatus(target.status, 'running'),
      updated_at: now
    };
    const closedSource = {
      ...source,
      status: 'closed',
      notes: [source.notes, `Merged into ${target.table_name || target.tab_name || targetTableName}`].filter(Boolean).join('\n'),
      updated_at: now
    };
    writePosTabs([merged, closedSource, ...rows.filter((row) => row.id !== merged.id && row.id !== closedSource.id)]);
    if (state.isOnline && state.supabase) {
      try {
        await state.supabase.rpc('upsert_pos_tab', { payload: merged });
        await state.supabase.rpc('update_pos_tab_status', { p_tab_id: closedSource.id, p_status: 'closed', p_notes: closedSource.notes || null });
      } catch (error) {
        console.warn('[POS TABS] Merge sync unavailable:', error?.message || error);
      }
    }
    return { success: true, tab: merged, closed_tab: closedSource };
  }

  return { success: false, error: 'Choose a valid manager override action.' };
}

export async function splitBillByItems(data = {}) {
  const { source_tab_id, item_indices, target_table_name } = data || {};
  if (!source_tab_id) return { success: false, error: 'Source tab is required.' };
  if (!Array.isArray(item_indices) || item_indices.length === 0) return { success: false, error: 'Select at least one item to split.' };

  const rows = readPosTabs();
  const source = rows.find((row) => row.id === source_tab_id);
  if (!source) return { success: false, error: 'Source tab not found.' };

  const sourceItems = Array.isArray(source.items) ? source.items : [];
  if (item_indices.some((idx) => idx < 0 || idx >= sourceItems.length)) {
    return { success: false, error: 'One or more item indices are out of range.' };
  }

  const now = new Date().toISOString();
  const splitItems = item_indices.sort((a, b) => b - a);
  const itemsToSplit = [];
  const remainingItems = [...sourceItems];

  for (const idx of splitItems) {
    itemsToSplit.unshift(remainingItems.splice(idx, 1)[0]);
  }

  const targetName = normalizeTableName(target_table_name);
  const existingTarget = targetName
    ? findActiveTableTab(rows, targetName, source.outlet_id || null, source.id)
    : null;
  const targetTabName = targetName || `${source.table_name || source.tab_name || 'Tab'} (split)`;

  const targetTab = existingTarget ? {
    ...existingTarget,
    items: [...(Array.isArray(existingTarget.items) ? existingTarget.items : []), ...itemsToSplit],
    notes: [existingTarget.notes, `Split ${itemsToSplit.length} item(s) from ${source.table_name || source.tab_name || 'original tab'}`].filter(Boolean).join('\n'),
    waiter_name: existingTarget.waiter_name || source.waiter_name || null,
    status: normalizeTabStatus(existingTarget.status, 'running'),
    updated_at: now
  } : {
    id: randomUUID(),
    lodge_id: source.lodge_id,
    outlet_id: source.outlet_id || null,
    table_name: targetName || null,
    tab_name: targetTabName,
    customer_name: source.customer_name || null,
    waiter_name: source.waiter_name || null,
    items: itemsToSplit,
    notes: `Split from ${source.table_name || source.tab_name || 'original tab'}`,
    status: 'running',
    opened_by: source.opened_by || null,
    opened_by_name: source.opened_by_name || null,
    created_at: now,
    updated_at: now
  };

  const updatedSource = {
    ...source,
    items: remainingItems,
    notes: [source.notes, `Split ${itemsToSplit.length} item(s) to ${targetTabName}`].filter(Boolean).join('\n'),
    status: remainingItems.length === 0 ? 'closed' : normalizeTabStatus(source.status, 'running'),
    updated_at: now,
    closed_at: remainingItems.length === 0 ? now : undefined
  };

  writePosTabs([targetTab, updatedSource, ...rows.filter((row) => row.id !== targetTab.id && row.id !== updatedSource.id)]);

  if (state.isOnline && state.supabase) {
    try {
      await state.supabase.rpc('upsert_pos_tab', { payload: targetTab });
      await state.supabase.rpc('upsert_pos_tab', { payload: updatedSource });
    } catch (error) {
      console.warn('[POS TABS] Split bill sync unavailable:', error?.message || error);
    }
  }

  appendPosAudit('pos:bill_split', {
    source_tab_id,
    target_tab_id: targetTab.id,
    new_tab_id: existingTarget ? null : targetTab.id,
    used_existing_target: !!existingTarget,
    items_split: itemsToSplit.length,
    items_remaining: remainingItems.length,
    target_table_name: targetName || null
  });

  return {
    success: true,
    source_tab: updatedSource,
    target_tab: targetTab,
    new_tab: existingTarget ? null : targetTab
  };
}

export async function splitBillEvenly(data = {}) {
  const { source_tab_id, split_count, target_table_names } = data || {};
  if (!source_tab_id) return { success: false, error: 'Source tab is required.' };
  const numSplits = Number(split_count);
  if (!Number.isInteger(numSplits) || numSplits < 2 || numSplits > 10) {
    return { success: false, error: 'Split count must be between 2 and 10.' };
  }
  // A split closes one tab and opens/updates several others. Never emulate that
  // financial/operational transition offline or with client-side upsert loops.
  if (!state.isOnline || !state.supabase || !state.lodgeId) {
    return { success: false, error: 'Bill splits require a live connection so every tab is updated together.' };
  }
  const { data: rpcData, error: rpcError } = await state.supabase.rpc('split_pos_tab_evenly', {
    payload: {
      lodge_id: state.lodgeId,
      source_tab_id,
      split_count: numSplits,
      target_table_names: Array.isArray(target_table_names) ? target_table_names : [],
      idempotency_key: data.idempotency_key || randomUUID()
    }
  });
  if (rpcError) return { success: false, error: rpcError.message };
  if (rpcData?.success === false) return rpcData;
  if (rpcData?.success) {
    const updated = [
      ...(Array.isArray(rpcData.new_tabs) ? rpcData.new_tabs : []),
      ...(rpcData.source_tab ? [rpcData.source_tab] : []),
      ...readPosTabs().filter((row) => row.id !== rpcData.source_tab?.id && !(rpcData.new_tabs || []).some((tab) => tab.id === row.id))
    ];
    writePosTabs(updated);
    return rpcData;
  }
  return { success: false, error: 'Could not split the bill.' };
}

function updateTableTabStatusByTicket(ticket = {}, status = 'running') {
  if (!ticket.table_name) return;
  const mappedStatus = status === 'served' ? 'delivered' : status === 'ready' ? 'ready' : status === 'cancelled' ? 'closed' : 'running';
  const rows = readPosTabs();
  const matching = findActiveTableTab(rows, ticket.table_name, ticket.outlet_id || null, null);
  if (matching) {
    updatePosTabStatus(matching.id, mappedStatus).catch(() => {});
  }
}

export function getPosTableStatuses(outletId = null) {
  const rows = readPosTabs();
  const tables = readPosTables().filter((table) =>
    table.active !== false && (!outletId || !table.outlet_id || table.outlet_id === outletId)
  );
  return tables.map((table) => {
    const activeTab = findActiveTableTab(rows, table.name, table.outlet_id || outletId || null, null);
    return {
      ...table,
      tab: activeTab || null,
      status: activeTab ? normalizeTabStatus(activeTab.status, 'running') : 'available'
    };
  });
}

export async function getPosTablesWithStatus(outletId = null) {
  await getPosTabs().catch(() => []);
  await getPosTables().catch(() => []);
  return getPosTableStatuses(outletId);
}

export async function getActivePosTableTab(tableName, outletId = null) {
  await getPosTabs().catch(() => []);
  return findActiveTableTab(readPosTabs(), tableName, outletId, null);
}

export async function openPosTableSession(data = {}) {
  const tableName = normalizeTableName(data.table_name);
  if (!tableName) return { success: false, error: 'Select a table first.' };
  if (!normalizeTableName(data.waiter_name)) return { success: false, error: 'Served-by staff is required before opening a table.' };
  const existing = findActiveTableTab(readPosTabs(), tableName, data.outlet_id || null, null);
  if (existing) return { success: true, tab: existing, already_open: true };
  return savePosTab({
    ...data,
    table_name: tableName,
    tab_name: data.tab_name || tableName,
    items: Array.isArray(data.items) ? data.items : [],
    status: 'running'
  });
}

function readPosTables() {
  const rows = readCache('pos-tables');
  return Array.isArray(rows) ? rows : [];
}

function writePosTables(rows = []) {
  writeCache('pos-tables', rows.slice(0, 500));
}

export async function getPosTables() {
  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const { data, error } = await state.supabase
        .from('pos_tables')
        .select('*')
        .eq('lodge_id', state.lodgeId)
        .order('name', { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      if (Array.isArray(data)) {
        const merged = [
          ...data,
          ...readPosTables().filter((local) => !data.some((row) => row.id === local.id))
        ];
        writePosTables(merged);
        return merged.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      }
    } catch (error) {
      console.warn('[POS TABLES] Remote table refresh unavailable:', error?.message || error);
    }
  }
  return readPosTables().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export async function savePosTable(data = {}) {
  const name = String(data.name || '').trim();
  if (!name) return { success: false, error: 'Table name is required.' };
  if (!state.cacheDir) return { success: false, error: 'Choose a lodge profile before saving POS tables.' };
  ensureDir(state.cacheDir);
  const id = data.id || randomUUID();
  const row = {
    id,
    lodge_id: state.lodgeId,
    outlet_id: data.outlet_id || null,
    name,
    area: String(data.area || '').trim() || null,
    seats: Math.max(0, Number(data.seats || 0)),
    active: data.active !== false,
    updated_at: new Date().toISOString()
  };
  try {
    writePosTables([row, ...readPosTables().filter((entry) => entry.id !== id)]);
  } catch (error) {
    return { success: false, error: error?.message || 'Could not save table.' };
  }

  if (state.isOnline && state.supabase) {
    try {
      const { data: rpcData, error } = await state.supabase.rpc('upsert_pos_table', { payload: row });
      if (error) throw new Error(error.message);
      if (rpcData?.success === false) return rpcData;
      const remoteTable = rpcData?.table || null;
      if (remoteTable?.id) {
        writePosTables([
          remoteTable,
          ...readPosTables().filter((entry) =>
            entry.id !== remoteTable.id &&
            !(
              String(entry.outlet_id || '') === String(remoteTable.outlet_id || '') &&
              normalizeTableName(entry.name).toLowerCase() === normalizeTableName(remoteTable.name).toLowerCase()
            )
          )
        ]);
      }
      return { success: true, table: remoteTable || row };
    } catch (error) {
      console.warn('[POS TABLES] Remote table save unavailable; kept local table:', error?.message || error);
    }
  } else {
    queueOperation('rpc', 'upsert_pos_table', { payload: row }, null, {
      _queue_id: `pos-table-${id}`
    });
  }

  return { success: true, table: row, offline: true };
}

export async function deletePosTable(id) {
  writePosTables(readPosTables().filter((row) => row.id !== id));
  return { success: true };
}

function readPosStations() {
  const rows = readCache('pos-stations');
  return Array.isArray(rows) ? rows : [];
}

function writePosStations(rows = []) {
  writeCache('pos-stations', rows.slice(0, 50));
}

export async function getPosStations() {
  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const { data, error } = await state.supabase.rpc('get_pos_kitchen_stations', {
        p_lodge_id: state.lodgeId
      });
      if (error) throw new Error(error.message);
      if (Array.isArray(data)) {
        const merged = data.map((s) => ({
          id: s.id,
          station_key: s.station_key,
          name: s.name,
          type: s.station_type,
          enabled: s.enabled,
          sort_order: s.sort_order || 0,
          outlet_id: s.outlet_id || null
        }));
        writePosStations(merged);
        return merged;
      }
    } catch (error) {
      console.warn('[POS STATIONS] Remote station refresh unavailable:', error?.message || error);
    }
  }
  const cached = readPosStations();
  if (cached.length === 0) {
    return [
      { id: 'kitchen', station_key: 'kitchen', name: 'Kitchen', type: 'kitchen', enabled: true, sort_order: 0 },
      { id: 'bar', station_key: 'bar', name: 'Bar', type: 'bar', enabled: true, sort_order: 1 }
    ];
  }
  return cached;
}

export async function savePosStation(data = {}) {
  const { id, name, type, enabled, station_key, outlet_id } = data || {};
  if (!name?.trim()) return { success: false, error: 'Station name is required.' };
  if (!state.isOnline || !state.supabase || !state.lodgeId) {
    return { success: false, error: 'Station configuration requires an internet connection.' };
  }
  const key = station_key || name.trim().toLowerCase().replace(/\s+/g, '_');
  const { data: result, error } = await state.supabase.rpc('upsert_pos_kitchen_station', {
    payload: {
      lodge_id: state.lodgeId,
      id: id || null,
      outlet_id: outlet_id || null,
      station_key: key,
      name: name.trim(),
      station_type: type || 'kitchen',
      enabled: enabled !== false
    }
  });
  if (error) return { success: false, error: error.message };
  if (result?.success === false) return result;
  if (result?.success && result?.station) {
    const stations = readPosStations();
    const existing = stations.findIndex((s) => s.id === result.station.id);
    const updated = { ...result.station, type: result.station.station_type };
    const next = existing >= 0 ? stations.map((s, i) => i === existing ? updated : s) : [...stations, updated];
    writePosStations(next);
    return { success: true, station: updated };
  }
  return { success: false, error: 'Could not save station.' };
}

export async function deletePosStation(id) {
  if (!state.isOnline || !state.supabase || !state.lodgeId) {
    return { success: false, error: 'Station deletion requires an internet connection.' };
  }
  const { data: result, error } = await state.supabase.rpc('delete_pos_kitchen_station', {
    p_lodge_id: state.lodgeId,
    p_station_id: id
  });
  if (error) return { success: false, error: error.message };
  if (result?.success === false) return result;
  writePosStations(readPosStations().filter((s) => s.id !== id));
  return { success: true };
}

function readPosTickets() {
  const rows = readCache('pos-tickets');
  return Array.isArray(rows) ? rows : [];
}

function writePosTickets(rows = []) {
  writeCache('pos-tickets', rows.slice(0, 1000));
}

function buildPrepTicketsForOrder(order = {}, items = []) {
  const grouped = new Map();
  const stations = readPosStations().filter((s) => s.enabled !== false);
  const stationKeyToId = new Map(stations.map((s) => [s.station_key || s.id, s.id]));
  for (const item of items || []) {
    if (!item?.item_name || Number(item.quantity || 0) <= 0 || Number(item.unit_price || 0) < 0) continue;
    let stationKey = item.station || item.kitchen_station_id || null;
    if (stationKey && stationKeyToId.has(stationKey)) {
      stationKey = stationKeyToId.get(stationKey);
    }
    if (!stationKey || !stations.some((s) => s.id === stationKey || s.station_key === stationKey)) {
      stationKey = /bar|drink|beverage/i.test(`${item.category || ''} ${order.outlet_name || ''}`) ? 'bar' : 'kitchen';
    }
    if (!grouped.has(stationKey)) grouped.set(stationKey, []);
    grouped.get(stationKey).push(item);
  }
  const now = new Date().toISOString();
  return [...grouped.entries()].map(([station, stationItems]) => ({
    id: randomUUID(),
    lodge_id: state.lodgeId,
    order_id: order.id,
    outlet_id: order.outlet_id || null,
    station,
    status: 'new',
    table_name: order.table_name || null,
    tab_name: order.tab_name || null,
    waiter_name: order.waiter_name || null,
    room_id: order.room_id || null,
    notes: order.notes || null,
    items: stationItems,
    created_at: now,
    updated_at: now
  }));
}

function appendPrepTickets(order = {}, items = []) {
  const tickets = buildPrepTicketsForOrder(order, items);
  if (tickets.length > 0) writePosTickets([...tickets, ...readPosTickets()]);
  return tickets;
}

export async function getPosTickets(filters = {}) {
  const station = filters.station || 'all';
  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      let query = state.supabase
        .from('pos_prep_tickets')
        .select('*')
        .eq('lodge_id', state.lodgeId)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (station !== 'all') query = query.eq('station', station);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      if (Array.isArray(data)) {
        const remoteIds = new Set(data.map((ticket) => ticket.id));
        writePosTickets([...data, ...readPosTickets().filter((ticket) => !remoteIds.has(ticket.id))]);
        return data;
      }
    } catch (error) {
      console.warn('[POS TICKETS] Remote refresh unavailable:', error?.message || error);
    }
  }
  return readPosTickets()
    .filter((ticket) => station === 'all' || ticket.station === station)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export async function updatePosTicketStatus(id, status) {
  const allowed = new Set(['new', 'preparing', 'ready', 'served', 'cancelled']);
  const nextStatus = allowed.has(status) ? status : 'new';
  const previousTickets = readPosTickets();
  const previousTicket = previousTickets.find((t) => t.id === id);

  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const { data, error } = await state.supabase.rpc('update_pos_prep_ticket_status', {
        p_ticket_id: id,
        p_status: nextStatus,
        p_lodge_id: state.lodgeId
      });
      if (error) throw new Error(error.message);
      if (data?.success === false) {
        return data;
      }
      if (data?.ticket?.id) {
        const updatedTicket = data.ticket;
        writePosTickets(readPosTickets().map((ticket) => ticket.id === id ? updatedTicket : ticket));
        updateTableTabStatusByTicket(updatedTicket, nextStatus);
        appendPosAudit('ticket_status_updated', {
          entity_type: 'pos_ticket', entity_id: id,
          details: { status: nextStatus, station: updatedTicket.station, table_name: updatedTicket.table_name || null }
        });
        return { success: true, ticket: updatedTicket };
      }
      return { success: true };
    } catch (error) {
      writePosTickets(previousTickets);
      throw error;
    }
  }

  // Offline ticket status updates are blocked to prevent server-client state
  // mismatch. Ticket status is an operational concern, not financial, and
  // untracked offline changes can create ghost states after reconnect.
  return { success: false, error: 'Ticket status updates require an internet connection.' };
}

function readPosShifts() {
  const rows = readCache('pos-shifts');
  return Array.isArray(rows) ? rows : [];
}

function writePosShifts(rows = []) {
  writeCache('pos-shifts', rows.slice(0, 500));
}

export async function getCurrentPosShift(outletId = null, cashierId = null) {
  const operatorId = cashierId || state.currentUser?.id || null;
  return readPosShifts().find((row) =>
    row.status === 'open' &&
    (!outletId || row.outlet_id === outletId) &&
    (!operatorId || !row.cashier_id || row.cashier_id === operatorId)
  ) || null;
}

export async function openPosShift(data = {}) {
  const operatorId = data.cashier_id || state.currentUser?.id || null;
  const operatorName = data.cashier_name || state.currentUser?.name || state.currentUser?.email || null;
  const existing = await getCurrentPosShift(data.outlet_id || null, operatorId);
  if (existing) return { success: true, shift: existing, already_open: true };
  const now = new Date().toISOString();
  const row = {
    id: data.id || randomUUID(),
    lodge_id: state.lodgeId,
    outlet_id: data.outlet_id || null,
    cashier_id: operatorId,
    cashier_name: operatorName,
    opening_float: normalizeMoney(data.opening_float),
    status: 'open',
    opened_at: now,
    closed_at: null,
    notes: data.notes || null
  };
  writePosShifts([row, ...readPosShifts()]);
  return { success: true, shift: row };
}

export async function closePosShift(data = {}) {
  const shift = data.shift_id ? readPosShifts().find((row) => row.id === data.shift_id) : await getCurrentPosShift(data.outlet_id || null, data.cashier_id || null);
  if (!shift) return { success: false, error: 'No open shift found.' };
  const closed = {
    ...shift,
    status: 'closed',
    closing_cash: normalizeMoney(data.closing_cash),
    closed_at: new Date().toISOString(),
    close_notes: data.notes || null
  };
  writePosShifts([closed, ...readPosShifts().filter((row) => row.id !== shift.id)]);
  return { success: true, shift: closed };
}

export async function getPosHardwareSettings() {
  return readPosHardwareSettings();
}

export async function savePosHardwareSettings(data = {}) {
  return { success: true, settings: writePosHardwareSettings(data) };
}

export async function testPosHardware(kind = 'receipt') {
  const settings = readPosHardwareSettings();
  if (kind === 'drawer' && !settings.cash_drawer_enabled) {
    return { success: false, error: 'Cash drawer is not enabled in POS hardware settings.' };
  }
  if (kind === 'escpos' && !settings.escpos_enabled) {
    return { success: false, error: 'ESC/POS direct mode is not enabled yet.' };
  }
  if (kind === 'payment-terminal' && settings.payment_terminal_mode === 'manual') {
    return { success: true, kind, message: 'Payment terminal is in manual mode. Enter approval/reference numbers after charging the card machine.' };
  }
  return {
    success: true,
    kind,
    message: kind === 'drawer'
      ? 'Cash drawer test command queued. Direct drawer kick requires ESC/POS driver/device support.'
      : kind === 'escpos'
        ? 'ESC/POS test command prepared. Install a supported direct-print bridge before live drawer kicks.'
        : 'Receipt printer test is ready. Use the test receipt print button.'
  };
}

export async function recordPosHardwareEvent(action = 'hardware_event', details = {}) {
  return appendPosAudit(action, {
    entity_type: details.entity_type || 'pos_hardware',
    entity_id: details.entity_id || null,
    details
  });
}

export async function getPosStaff() {
  if (state.isOnline && state.supabase) {
    const { data, error } = await state.supabase.rpc('pos_get_safe_staff', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data : [];
    writeCache('pos-staff', rows);
    return rows;
  }
  const cached = readCache('pos-staff');
  return Array.isArray(cached) ? cached : [];
}

export async function selectPosStaffWithPin(data = {}) {
  const pin = String(data.pin || '').trim();
  const staffRows = await getPosStaff();
  const staff = staffRows.find((user) => user.id === data.staff_id);
  if (!staff) return { success: false, error: 'Staff member not found.' };
  if (!staff.has_pin) return { success: false, error: 'This staff member does not have a POS PIN set.' };
  if (!pin) return { success: false, error: 'Staff PIN is required.' };
  if (!state.isOnline || !state.supabase) {
    return { success: false, error: 'Staff PIN selection requires an internet connection.' };
  }
  const { data: result, error } = await state.supabase.rpc('pos_validate_pin', {
    p_lodge_id: state.lodgeId,
    p_staff_id: staff.id,
    p_pin: pin,
    p_required_capability: 'pos.manage',
    p_device_id: getDesktopPosDeviceId()
  });
  if (error) throw new Error(error.message);
  if (!result?.success) return { success: false, error: result?.error || 'Incorrect staff PIN.' };
  appendPosAudit('staff_selected', {
    staff_id: result.staff?.id,
    staff_name: result.staff?.name,
    entity_type: 'pos_staff'
  });
  return result;
}

export async function getPosModifierGroups() {
  if (state.isOnline && state.supabase) {
    const { data, error } = await state.supabase
      .from('pos_modifier_groups')
      .select('id, lodge_id, name, applies_to_categories, min_selections, max_selections, options, active, updated_at')
      .eq('lodge_id', state.lodgeId)
      .order('name');
    if (error) throw new Error(error.message);
    writePosModifierGroups(data || []);
    return data || [];
  }
  return readPosModifierGroups();
}

export async function savePosModifierGroup(data = {}) {
  const row = {
    id: data.id || randomUUID(),
    lodge_id: state.lodgeId,
    name: String(data.name || '').trim(),
    applies_to_categories: Array.isArray(data.applies_to_categories) ? data.applies_to_categories : [],
    options: Array.isArray(data.options) ? data.options.map((option) => ({
      id: option.id || randomUUID(),
      name: String(option.name || '').trim(),
      price_delta: normalizeMoney(option.price_delta || 0)
    })).filter((option) => option.name) : [],
    min_selections: Math.max(0, Number(data.min_selections || 0)),
    max_selections: Math.max(0, Number(data.max_selections || 0)),
    active: data.active !== false,
    updated_at: new Date().toISOString()
  };
  if (!row.name) return { success: false, error: 'Modifier group name is required.' };
  if (!state.isOnline || !state.supabase) {
    return { success: false, error: 'Modifier catalog changes require an internet connection.' };
  }
  const rows = [row, ...readPosModifierGroups().filter((entry) => entry.id !== row.id)];
  const { data: result, error } = await state.supabase.rpc('upsert_pos_modifier_groups', {
    payload: { lodge_id: state.lodgeId, groups: rows }
  });
  if (error) throw new Error(error.message);
  if (!result?.success) return { success: false, error: result?.error || 'Could not save modifier group.' };
  writePosModifierGroups(rows);
  await publishPosCatalogSnapshotsForChange([null]);
  appendPosAudit('modifier_group_saved', { entity_type: 'pos_modifier_group', entity_id: row.id, details: row });
  return { success: true, group: row };
}

export async function getPosPromotions() {
  if (state.isOnline && state.supabase) {
    const { data, error } = await state.supabase
      .from('pos_promotions')
      .select('id, lodge_id, name, discount_type, discount_value, applies_to_category, active, updated_at')
      .eq('lodge_id', state.lodgeId)
      .order('name');
    if (error) throw new Error(error.message);
    writePosPromotions(data || []);
    return data || [];
  }
  return readPosPromotions();
}

export async function savePosPromotion(data = {}) {
  const row = {
    id: data.id || randomUUID(),
    lodge_id: state.lodgeId,
    name: String(data.name || '').trim(),
    discount_type: data.discount_type === 'percent' ? 'percent' : 'amount',
    discount_value: normalizeMoney(data.discount_value || 0),
    applies_to_category: String(data.applies_to_category || '').trim() || 'All',
    active: data.active !== false,
    updated_at: new Date().toISOString()
  };
  if (!row.name) return { success: false, error: 'Promotion name is required.' };
  if (!(row.discount_value > 0)) return { success: false, error: 'Promotion discount must be above zero.' };
  if (!state.isOnline || !state.supabase) {
    return { success: false, error: 'Promotion changes require an internet connection.' };
  }
  const rows = [row, ...readPosPromotions().filter((entry) => entry.id !== row.id)];
  const { data: result, error } = await state.supabase.rpc('upsert_pos_promotions', {
    payload: { lodge_id: state.lodgeId, promotions: rows }
  });
  if (error) throw new Error(error.message);
  if (!result?.success) return { success: false, error: result?.error || 'Could not save promotion.' };
  writePosPromotions(rows);
  await publishPosCatalogSnapshotsForChange([null]);
  appendPosAudit('promotion_saved', { entity_type: 'pos_promotion', entity_id: row.id, details: row });
  return { success: true, promotion: row };
}

export async function getPosFloorLayout() {
  return readPosFloorLayout();
}

export async function savePosFloorLayout(layout = {}) {
  const saved = writePosFloorLayout(layout);
  appendPosAudit('floor_layout_saved', { entity_type: 'pos_floor_layout', details: saved });
  return { success: true, layout: saved };
}

export async function updatePosCustomerDisplay(snapshot = {}) {
  const saved = writeCustomerDisplaySnapshot(snapshot);
  return { success: true, display: saved };
}

export async function getPosCustomerDisplay() {
  const value = readCache('pos-customer-display');
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export async function sendPaymentTerminalTotal(data = {}) {
  const settings = readPosHardwareSettings();
  appendPosAudit('payment_terminal_send_total', {
    entity_type: 'payment_terminal',
    details: {
      provider: settings.payment_terminal_provider || null,
      mode: settings.payment_terminal_mode || 'manual',
      amount: normalizeMoney(data.amount || 0),
      reference: data.reference || null
    }
  });
  if (!settings.payment_terminal_provider || settings.payment_terminal_mode === 'manual') {
    return {
      success: false,
      manual: true,
      error: 'No live payment terminal integration is configured. Charge the card machine manually and enter the approval code.'
    };
  }
  return {
    success: false,
    error: `Provider ${settings.payment_terminal_provider} is saved, but its device API is not connected in this build.`
  };
}

export async function getPosAuditLog(limit = 100) {
  return readPosAuditLog().slice(0, Math.max(1, Math.min(500, Number(limit || 100))));
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
      select('order_id, menu_item_id, inventory_item_id, depletion_qty, item_name, quantity, unit_price, subtotal').
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
    select('id, name, inventory_item_id, depletion_qty, template_kind, template_pack_size, kitchen_station_id').
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
  const gross_revenue = orders.reduce((s, o) => s + normalizeMoney(o.gross_total ?? (Number(o.total || 0) > 0 ? Number(o.total || 0) : 0)), 0);
  const discount_total = orders.reduce((s, o) => s + normalizeMoney(o.discount_total || 0), 0);
  const tax_total = orders.reduce((s, o) => s + normalizeMoney(o.tax_total || 0), 0);
  const tip_total = orders.reduce((s, o) => s + normalizeMoney(o.tip_total || 0), 0);
  const returns_total = orders.reduce((s, o) => s + (Number(o.total || 0) < 0 ? Math.abs(Number(o.total || 0)) : 0), 0);
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
    for (const payment of getOrderPaymentRows(o)) {
      by_payment[payment.method] = normalizeMoney((by_payment[payment.method] || 0) + Number(payment.amount || 0));
    }
  }

  const by_cashier = {};
  for (const o of orders) {
    const key = o.cashier_name || o.cashier_id || 'Unassigned';
    by_cashier[key] = normalizeMoney((by_cashier[key] || 0) + Number(o.total || 0));
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
      const inventoryId = li.inventory_item_id || menuItem?.inventory_item_id || null;
      if (inventoryId) {
        const inventoryCost = Number((readCache('inventory-items') || []).find((item) => item.id === inventoryId)?.latest_unit_cost || 0);
        itemMap[itemName].cost = Number(itemMap[itemName].cost || 0) + Math.max(0, quantity) * depletionQty * inventoryCost;
        itemMap[itemName].margin = Number(itemMap[itemName].revenue || 0) - Number(itemMap[itemName].cost || 0);
      }
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
    gross_revenue,
    discount_total,
    returns_total,
    tax_total,
    tip_total,
    net_revenue: total_revenue,
    folio_revenue,
    direct_revenue,
    total_orders,
    avg_order,
    by_payment,
    by_cashier,
    top_items,
    daily,
    source: 'local',
    as_of_range: { start: startDate, end: endDate },
    outlet_selector: outletId || 'all'
  };
}

// ── Restaurant Recipes ──────────────────────────────────────────────────────

const POS_RECIPE_CACHE_KEY = 'pos-recipes';

function readPosRecipes() {
  const rows = readCache(POS_RECIPE_CACHE_KEY);
  return Array.isArray(rows) ? rows : [];
}

function writePosRecipes(rows = []) {
  writeCache(POS_RECIPE_CACHE_KEY, rows.slice(0, 1000));
}

export async function getPosRecipes() {
  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const { data, error } = await state.supabase.rpc('get_restaurant_recipes', {
        p_lodge_id: state.lodgeId
      });
      if (error) throw new Error(error.message);
      if (Array.isArray(data)) {
        writePosRecipes(data);
        return data;
      }
    } catch (error) {
      console.warn('[POS RECIPES] Remote recipe refresh unavailable:', error?.message || error);
    }
  }
  return readPosRecipes();
}

export async function savePosRecipe(data = {}) {
  const name = String(data.name || '').trim();
  if (!name) return { success: false, error: 'Recipe name is required.' };
  if (!state.cacheDir) return { success: false, error: 'Choose a lodge profile before saving recipes.' };
  ensureDir(state.cacheDir);

  if (!state.isOnline || !state.supabase) {
    return { success: false, error: 'Recipe changes require an internet connection.' };
  }

  const ingredients = Array.isArray(data.ingredients) ? data.ingredients.map((ing) => ({
    id: ing.id || randomUUID(),
    inventory_item_id: ing.inventory_item_id,
    quantity: Number(ing.quantity || 0),
    unit: String(ing.unit || 'each').trim(),
    waste_percent: Math.max(0, Number(ing.waste_percent || 0)),
    sort_order: Number(ing.sort_order || 0)
  })).filter((ing) => ing.inventory_item_id && ing.quantity > 0) : [];

  const payload = {
    lodge_id: state.lodgeId,
    recipe_id: data.id || undefined,
    menu_item_id: data.menu_item_id || undefined,
    name,
    version: Number(data.version || 1),
    serving_size: Number(data.serving_size || 1),
    active: data.active !== false,
    ingredients
  };

  try {
    const { data: result, error } = await state.supabase.rpc('upsert_restaurant_recipe', {
      payload
    });
    if (error) throw new Error(error.message);
    if (!result?.success) return { success: false, error: result?.error || 'Could not save recipe.' };

    const recipe = {
      id: result.recipe_id || data.id || randomUUID(),
      lodge_id: state.lodgeId,
      menu_item_id: data.menu_item_id || null,
      name,
      version: Number(data.version || 1),
      serving_size: Number(data.serving_size || 1),
      active: data.active !== false,
      ingredients,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const cached = readPosRecipes();
    const idx = cached.findIndex((r) => r.id === recipe.id);
    if (idx >= 0) {
      cached[idx] = { ...cached[idx], ...recipe };
    } else {
      cached.unshift(recipe);
    }
    writePosRecipes(cached);

    appendPosAudit('recipe_saved', { entity_type: 'restaurant_recipe', entity_id: recipe.id, details: { name } });
    return { success: true, recipe };
  } catch (error) {
    throw error;
  }
}

export async function deletePosRecipe(recipeId) {
  if (!recipeId) return { success: false, error: 'Recipe ID is required.' };
  if (!state.isOnline || !state.supabase) {
    return { success: false, error: 'Recipe deletion requires an internet connection.' };
  }

  try {
    const { data: result, error } = await state.supabase.rpc('delete_restaurant_recipe', {
      p_recipe_id: recipeId,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) return { success: false, error: result?.error || 'Could not delete recipe.' };

    const cached = readPosRecipes().filter((r) => r.id !== recipeId);
    writePosRecipes(cached);

    appendPosAudit('recipe_deleted', { entity_type: 'restaurant_recipe', entity_id: recipeId });
    return { success: true };
  } catch (error) {
    throw error;
  }
}

export async function recordRecipeStockDepletion(orderId, items = []) {
  if (!orderId || !Array.isArray(items) || items.length === 0) return { success: true, movements_created: 0 };

  if (!state.isOnline || !state.supabase) {
    // Offline: depletion is queued as dependent operation in createPosOrder
    console.warn('[POS RECIPES] Stock depletion queued for offline replay:', orderId);
    return { success: true, movements_created: 0, queued: true };
  }

  try {
    const { data: result, error } = await state.supabase.rpc('record_recipe_stock_depletion', {
      payload: {
        lodge_id: state.lodgeId,
        order_id: orderId,
        items: items.map((item) => ({
          menu_item_id: item.menu_item_id || null,
          order_item_id: item.id || null,
          quantity: Number(item.quantity || 1)
        }))
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: true, movements_created: 0 };
  } catch (error) {
    console.error('[POS RECIPES] Stock depletion failed:', error?.message || error);
    throw error;
  }
}

// ── Phase 4: Customer & Growth ──────────────────────────────

const CUSTOMERS_CACHE_KEY = 'pos-customers';

function readCachedCustomers() {
  return readCache(CUSTOMERS_CACHE_KEY);
}

function writeCachedCustomers(customers) {
  writeCache(CUSTOMERS_CACHE_KEY, customers);
}

export async function getPosCustomers() {
  if (!state.isOnline || !state.supabase) return readCachedCustomers();

  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_customers', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    const customers = Array.isArray(data) ? data : [];
    writeCachedCustomers(customers);
    return customers;
  } catch (error) {
    console.error('[POS CUSTOMERS] Load failed:', error?.message || error);
    return readCachedCustomers();
  }
}

export async function savePosCustomer(customerData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot save customer offline');

  try {
    const { data: result, error } = await state.supabase.rpc('upsert_restaurant_customer', {
      payload: {
        lodge_id: state.lodgeId,
        customer_id: customerData.id || null,
        name: customerData.name,
        email: customerData.email || null,
        phone: customerData.phone || null,
        notes: customerData.notes || null,
        marketing_opt_in: customerData.marketing_opt_in || false
      }
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Failed to save customer');

    appendPosAudit('customer_saved', { entity_type: 'restaurant_customer', entity_id: result.customer_id });
    return result;
  } catch (error) {
    console.error('[POS CUSTOMERS] Save failed:', error?.message || error);
    throw error;
  }
}

export async function awardLoyaltyPoints({ customerId, orderId, points, description }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot award loyalty offline');

  try {
    const { data: result, error } = await state.supabase.rpc('award_restaurant_loyalty', {
      payload: {
        lodge_id: state.lodgeId,
        customer_id: customerId,
        order_id: orderId || null,
        points,
        description: description || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS LOYALTY] Award failed:', error?.message || error);
    throw error;
  }
}

export async function redeemLoyaltyPoints({ customerId, orderId, points, description }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot redeem loyalty offline');

  try {
    const { data: result, error } = await state.supabase.rpc('redeem_restaurant_loyalty', {
      payload: {
        lodge_id: state.lodgeId,
        customer_id: customerId,
        order_id: orderId || null,
        points,
        description: description || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS LOYALTY] Redeem failed:', error?.message || error);
    throw error;
  }
}

export async function chargeCustomerAccount({ customerId, orderId, amount, description }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot charge account offline');

  try {
    const { data: result, error } = await state.supabase.rpc('charge_restaurant_account', {
      payload: {
        lodge_id: state.lodgeId,
        customer_id: customerId,
        order_id: orderId || null,
        amount,
        description: description || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS ACCOUNT] Charge failed:', error?.message || error);
    throw error;
  }
}

export async function redeemVoucher(code, amount) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot redeem voucher offline');

  try {
    const { data: result, error } = await state.supabase.rpc('redeem_restaurant_voucher', {
      payload: {
        lodge_id: state.lodgeId,
        code,
        amount
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS VOUCHER] Redeem failed:', error?.message || error);
    throw error;
  }
}

export async function recordDelivery(deliveryData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot record delivery offline');

  try {
    const { data: result, error } = await state.supabase.rpc('record_restaurant_delivery', {
      payload: {
        lodge_id: state.lodgeId,
        order_id: deliveryData.order_id || null,
        customer_id: deliveryData.customer_id || null,
        platform: deliveryData.platform || null,
        platform_commission: deliveryData.platform_commission || 0,
        platform_order_id: deliveryData.platform_order_id || null,
        delivery_fee: deliveryData.delivery_fee || 0,
        driver_name: deliveryData.driver_name || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS DELIVERY] Record failed:', error?.message || error);
    throw error;
  }
}

// ── Phase 5: Restaurant Operating System ─────────────────────

export async function clockInStaff({ staffName, role, expectedHours }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot clock in offline');

  try {
    const { data: result, error } = await state.supabase.rpc('clock_in_staff', {
      payload: {
        lodge_id: state.lodgeId,
        staff_name: staffName,
        role: role || 'cashier',
        expected_hours: expectedHours || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS STAFF] Clock in failed:', error?.message || error);
    throw error;
  }
}

export async function clockOutStaff({ shiftId, notes }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot clock out offline');

  try {
    const { data: result, error } = await state.supabase.rpc('clock_out_staff', {
      payload: {
        lodge_id: state.lodgeId,
        shift_id: shiftId,
        notes: notes || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS STAFF] Clock out failed:', error?.message || error);
    throw error;
  }
}

export async function getActiveShifts() {
  if (!state.isOnline || !state.supabase) return [];

  try {
    const { data, error } = await state.supabase.rpc('get_active_shifts', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS STAFF] Load shifts failed:', error?.message || error);
    return [];
  }
}

export async function openCashDrawerSession({ openingFloat }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot open cash drawer offline');

  try {
    const { data: result, error } = await state.supabase.rpc('open_cash_drawer_session', {
      payload: {
        lodge_id: state.lodgeId,
        opening_float: openingFloat || 0
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS CASH] Open drawer failed:', error?.message || error);
    throw error;
  }
}

export async function closeCashDrawerSession({ sessionId, closingTotal, declaredTotal, notes }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot close cash drawer offline');

  try {
    const { data: result, error } = await state.supabase.rpc('close_cash_drawer_session', {
      payload: {
        lodge_id: state.lodgeId,
        session_id: sessionId,
        closing_total: closingTotal || 0,
        declared_total: declaredTotal || null,
        notes: notes || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS CASH] Close drawer failed:', error?.message || error);
    throw error;
  }
}

export async function getOpenCashDrawer() {
  if (!state.isOnline || !state.supabase) return null;

  try {
    const { data, error } = await state.supabase.rpc('get_open_cash_drawer', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    return data && typeof data === 'object' && data.id ? data : null;
  } catch (error) {
    console.error('[POS CASH] Load drawer failed:', error?.message || error);
    return null;
  }
}

const SUPPLIERS_CACHE_KEY = 'pos-suppliers';

function readCachedSuppliers() {
  return readCache(SUPPLIERS_CACHE_KEY);
}

function writeCachedSuppliers(suppliers) {
  writeCache(SUPPLIERS_CACHE_KEY, suppliers);
}

export async function getPosSuppliers() {
  if (!state.isOnline || !state.supabase) return readCachedSuppliers();

  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_suppliers', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    const suppliers = Array.isArray(data) ? data : [];
    writeCachedSuppliers(suppliers);
    return suppliers;
  } catch (error) {
    console.error('[POS SUPPLIERS] Load failed:', error?.message || error);
    return readCachedSuppliers();
  }
}

export async function createPosSupplier(supplierData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create supplier offline');

  try {
    const { data: result, error } = await state.supabase.rpc('create_restaurant_supplier', {
      payload: {
        lodge_id: state.lodgeId,
        name: supplierData.name,
        contact_person: supplierData.contact_person || null,
        email: supplierData.email || null,
        phone: supplierData.phone || null,
        address: supplierData.address || null,
        payment_terms: supplierData.payment_terms || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS SUPPLIERS] Create failed:', error?.message || error);
    throw error;
  }
}

export async function createPurchaseOrder(orderData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create purchase order offline');

  try {
    const { data: result, error } = await state.supabase.rpc('create_purchase_order', {
      payload: {
        lodge_id: state.lodgeId,
        supplier_id: orderData.supplier_id || null,
        expected_delivery: orderData.expected_delivery || null,
        notes: orderData.notes || null,
        items: orderData.items || []
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS PURCHASE] Create failed:', error?.message || error);
    throw error;
  }
}

export async function approvePurchaseOrder(orderId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot approve purchase order offline');

  try {
    const { data: result, error } = await state.supabase.rpc('approve_purchase_order', {
      payload: {
        lodge_id: state.lodgeId,
        order_id: orderId
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS PURCHASE] Approve failed:', error?.message || error);
    throw error;
  }
}

export async function receivePurchaseOrder(orderId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot receive purchase order offline');

  try {
    const { data: result, error } = await state.supabase.rpc('receive_purchase_order', {
      payload: {
        lodge_id: state.lodgeId,
        order_id: orderId
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS PURCHASE] Receive failed:', error?.message || error);
    throw error;
  }
}

export async function createStockTransfer(transferData) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create stock transfer offline');

  try {
    const { data: result, error } = await state.supabase.rpc('create_stock_transfer', {
      payload: {
        lodge_id: state.lodgeId,
        from_outlet_id: transferData.from_outlet_id || null,
        to_outlet_id: transferData.to_outlet_id || null,
        inventory_item_id: transferData.inventory_item_id || null,
        quantity: transferData.quantity || 0,
        notes: transferData.notes || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS TRANSFER] Create failed:', error?.message || error);
    throw error;
  }
}

export async function createDailyChecklist({ checklistType, items }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create checklist offline');

  try {
    const { data: result, error } = await state.supabase.rpc('create_daily_checklist', {
      payload: {
        lodge_id: state.lodgeId,
        checklist_type: checklistType || 'daily_opening',
        items: items || []
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS CHECKLIST] Create failed:', error?.message || error);
    throw error;
  }
}

export async function completeChecklistItem({ itemId, notes }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot complete checklist item offline');

  try {
    const { data: result, error } = await state.supabase.rpc('complete_checklist_item', {
      payload: {
        lodge_id: state.lodgeId,
        item_id: itemId,
        notes: notes || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS CHECKLIST] Complete item failed:', error?.message || error);
    throw error;
  }
}

export async function getActiveAlerts() {
  if (!state.isOnline || !state.supabase) return [];

  try {
    const { data, error } = await state.supabase.rpc('get_active_alerts', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS ALERTS] Load failed:', error?.message || error);
    return [];
  }
}

export async function recordExceptionAlert({ alertType, severity, message, entityType, entityId }) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot record alert offline');

  try {
    const { data: result, error } = await state.supabase.rpc('record_exception_alert', {
      payload: {
        lodge_id: state.lodgeId,
        alert_type: alertType || 'stock_low',
        severity: severity || 'info',
        message: message || '',
        entity_type: entityType || null,
        entity_id: entityId || null
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS ALERTS] Record failed:', error?.message || error);
    throw error;
  }
}

export async function resolveExceptionAlert(alertId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot resolve alert offline');

  try {
    const { data: result, error } = await state.supabase.rpc('resolve_exception_alert', {
      payload: {
        lodge_id: state.lodgeId,
        alert_id: alertId
      }
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS ALERTS] Resolve failed:', error?.message || error);
    throw error;
  }
}

export async function getPosPurchaseOrders(startDate, endDate) {
  if (!state.isOnline || !state.supabase) return [];

  try {
    let query = state.supabase
      .from('restaurant_purchase_orders')
      .select('*, supplier:restaurant_suppliers(name, contact_person, phone)')
      .eq('lodge_id', state.lodgeId)
      .order('created_at', { ascending: false });
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS PURCHASE] List failed:', error?.message || error);
    return [];
  }
}

export async function getShiftHistory(startDate, endDate) {
  if (!state.isOnline || !state.supabase) return [];

  try {
    let query = state.supabase
      .from('restaurant_shifts')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('clock_in', { ascending: false });
    if (startDate) query = query.gte('clock_in', startDate);
    if (endDate) query = query.lte('clock_in', endDate);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS SHIFTS] History failed:', error?.message || error);
    return [];
  }
}

export async function getCashDrawerSessions(startDate, endDate) {
  if (!state.isOnline || !state.supabase) return [];

  try {
    let query = state.supabase
      .from('restaurant_cash_drawer_sessions')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('created_at', { ascending: false });
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS CASH] Sessions list failed:', error?.message || error);
    return [];
  }
}

export async function getChecklists() {
  if (!state.isOnline || !state.supabase) return [];

  try {
    const { data, error } = await state.supabase
      .from('restaurant_checklists')
      .select('*, items:restaurant_checklist_items(*)')
      .eq('lodge_id', state.lodgeId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS CHECKLISTS] List failed:', error?.message || error);
    return [];
  }
}

export async function getExceptionAlerts() {
  if (!state.isOnline || !state.supabase) return [];

  try {
    const { data, error } = await state.supabase
      .from('restaurant_alerts')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS ALERTS] List failed:', error?.message || error);
    return [];
  }
}

export async function generateOwnerDigest() {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot generate digest offline');

  try {
    const { data: result, error } = await state.supabase.rpc('generate_owner_digest', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    return result || { success: false, error: 'Unknown error' };
  } catch (error) {
    console.error('[POS DIGEST] Generate failed:', error?.message || error);
    throw error;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 6: Restaurant Differentiators
// ══════════════════════════════════════════════════════════════════════════════

// 6.1 Reservations
export async function getRestaurantReservations(startDate, endDate, outletId) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_reservations', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate || null,
      p_end_date: endDate || null,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS RESERVATIONS] Get failed:', error?.message || error);
    return [];
  }
}

export async function createRestaurantReservation(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create reservation offline');
  try {
    const { data: result, error } = await state.supabase.rpc('create_restaurant_reservation', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    appendPosAudit('reservation_created', { entity_type: 'restaurant_reservation', entity_id: result?.id });
    return result;
  } catch (error) {
    console.error('[POS RESERVATIONS] Create failed:', error?.message || error);
    throw error;
  }
}

export async function updateRestaurantReservation(id, data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot update reservation offline');
  try {
    const { data: result, error } = await state.supabase.rpc('update_restaurant_reservation', {
      payload: { ...data, id, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS RESERVATIONS] Update failed:', error?.message || error);
    throw error;
  }
}

export async function cancelRestaurantReservation(id, reason) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot cancel reservation offline');
  try {
    const { data: result, error } = await state.supabase.rpc('cancel_restaurant_reservation', {
      p_id: id, p_lodge_id: state.lodgeId, p_reason: reason || null
    });
    if (error) throw new Error(error.message);
    appendPosAudit('reservation_cancelled', { entity_type: 'restaurant_reservation', entity_id: id });
    return result;
  } catch (error) {
    console.error('[POS RESERVATIONS] Cancel failed:', error?.message || error);
    throw error;
  }
}

export async function seatRestaurantReservation(id, tableId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot seat reservation offline');
  try {
    const { data: result, error } = await state.supabase.rpc('seat_restaurant_reservation', {
      p_id: id, p_lodge_id: state.lodgeId, p_table_id: tableId
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS RESERVATIONS] Seat failed:', error?.message || error);
    throw error;
  }
}

export async function markRestaurantReservationNoShow(id, reason) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot mark no-show offline');
  try {
    const { data: result, error } = await state.supabase.rpc('mark_restaurant_reservation_no_show', {
      p_id: id, p_lodge_id: state.lodgeId, p_reason: reason || null
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS RESERVATIONS] No-show failed:', error?.message || error);
    throw error;
  }
}

// Waitlist
export async function getRestaurantWaitlist(outletId) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_waitlist', {
      p_lodge_id: state.lodgeId,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS WAITLIST] Get failed:', error?.message || error);
    return [];
  }
}

export async function createRestaurantWaitlistEntry(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot add to waitlist offline');
  try {
    const { data: result, error } = await state.supabase.rpc('create_restaurant_waitlist_entry', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS WAITLIST] Create failed:', error?.message || error);
    throw error;
  }
}

export async function seatRestaurantWaitlistEntry(id, tableId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot seat waitlist offline');
  try {
    const { data: result, error } = await state.supabase.rpc('seat_restaurant_waitlist_entry', {
      p_id: id, p_lodge_id: state.lodgeId, p_table_id: tableId
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS WAITLIST] Seat failed:', error?.message || error);
    throw error;
  }
}

// 6.2 Combos
export async function getRestaurantCombos(outletId) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_combos', {
      p_lodge_id: state.lodgeId,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS COMBOS] Get failed:', error?.message || error);
    return [];
  }
}

export async function saveRestaurantCombo(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot save combo offline');
  try {
    const { data: result, error } = await state.supabase.rpc('upsert_restaurant_combo', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    appendPosAudit('combo_saved', { entity_type: 'restaurant_combo', entity_id: result?.id });
    return result;
  } catch (error) {
    console.error('[POS COMBOS] Save failed:', error?.message || error);
    throw error;
  }
}

export async function deleteRestaurantCombo(comboId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot delete combo offline');
  try {
    const { data: result, error } = await state.supabase.rpc('delete_restaurant_combo', {
      p_combo_id: comboId, p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    appendPosAudit('combo_deleted', { entity_type: 'restaurant_combo', entity_id: comboId });
    return result;
  } catch (error) {
    console.error('[POS COMBOS] Delete failed:', error?.message || error);
    throw error;
  }
}

// 6.3 Recipe Variance
export async function getRecipeVarianceReport(startDate, endDate, outletId) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_recipe_variance_report', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS VARIANCE] Get failed:', error?.message || error);
    return [];
  }
}

// 6.5 Prep Batches
export async function getRestaurantPrepItems() {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_prep_items', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS PREP] Get items failed:', error?.message || error);
    return [];
  }
}

export async function saveRestaurantPrepItem(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot save prep item offline');
  try {
    const { data: result, error } = await state.supabase.rpc('upsert_restaurant_prep_item', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS PREP] Save item failed:', error?.message || error);
    throw error;
  }
}

export async function getRestaurantPrepBatches(startDate, endDate, outletId) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_restaurant_prep_batches', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate || null,
      p_end_date: endDate || null,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS PREP] Get batches failed:', error?.message || error);
    return [];
  }
}

export async function createRestaurantPrepBatch(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot create prep batch offline');
  try {
    const { data: result, error } = await state.supabase.rpc('create_restaurant_prep_batch', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    appendPosAudit('prep_batch_created', { entity_type: 'restaurant_prep_batch', entity_id: result?.id });
    return result;
  } catch (error) {
    console.error('[POS PREP] Create batch failed:', error?.message || error);
    throw error;
  }
}

export async function postRestaurantPrepBatch(batchId) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot post prep batch offline');
  try {
    const { data: result, error } = await state.supabase.rpc('post_restaurant_prep_batch', {
      p_batch_id: batchId, p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    appendPosAudit('prep_batch_posted', { entity_type: 'restaurant_prep_batch', entity_id: batchId });
    return result;
  } catch (error) {
    console.error('[POS PREP] Post batch failed:', error?.message || error);
    throw error;
  }
}

// 6.6 Kitchen Timing
export async function recordTicketStatusEvent(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot record ticket event offline');
  try {
    const { data: result, error } = await state.supabase.rpc('record_ticket_status_event', {
      payload: { ...data, lodge_id: state.lodgeId }
    });
    if (error) throw new Error(error.message);
    return result;
  } catch (error) {
    console.error('[POS KITCHEN] Record event failed:', error?.message || error);
    throw error;
  }
}

export async function getKitchenTimingReport(startDate, endDate, outletId, station) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_kitchen_timing_report', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_outlet_id: outletId || null,
      p_station: station || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS KITCHEN] Get report failed:', error?.message || error);
    return [];
  }
}

// 6.7 Purchase Suggestions
export async function getLowStockPurchaseSuggestions(outletId) {
  if (!state.isOnline || !state.supabase) return [];
  try {
    const { data, error } = await state.supabase.rpc('get_low_stock_purchase_suggestions', {
      p_lodge_id: state.lodgeId,
      p_outlet_id: outletId || null
    });
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[POS SUGGESTIONS] Get failed:', error?.message || error);
    return [];
  }
}

export async function convertPurchaseSuggestionsToPo(supplierId, suggestions, notes) {
  if (!state.isOnline || !state.supabase) throw new Error('Cannot convert suggestions offline');
  try {
    const { data: result, error } = await state.supabase.rpc('convert_purchase_suggestions_to_po', {
      payload: {
        lodge_id: state.lodgeId,
        supplier_id: supplierId,
        suggestions: suggestions.map(s => ({
          id: s.id,
          inventory_item_id: s.inventory_item_id,
          quantity: s.suggested_quantity,
          unit_cost: s.last_unit_cost || 0
        })),
        notes: notes || null
      }
    });
    if (error) throw new Error(error.message);
    appendPosAudit('po_created_from_suggestions', { entity_type: 'restaurant_purchase_order', entity_id: result?.id });
    return result;
  } catch (error) {
    console.error('[POS SUGGESTIONS] Convert failed:', error?.message || error);
    throw error;
  }
}

// Phase 7: sellability controls. These are deliberately online-only because a
// settlement or reservation deposit must never be represented as final cash by
// a device-local queue.
export async function recordRestaurantSettlement(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Settlement reconciliation requires an online connection');
  const { data: result, error } = await state.supabase.rpc('record_restaurant_settlement', {
    p_payload: { ...data, lodge_id: state.lodgeId, idempotency_key: data.idempotency_key || randomUUID() }
  });
  if (error) throw new Error(error.message);
  appendPosAudit('settlement_recorded', { entity_type: 'restaurant_settlement', entity_id: result?.id, details: { channel: data.channel } });
  return result;
}

export async function getRestaurantSettlements(businessDate) {
  if (!state.isOnline || !state.supabase) return [];
  const { data, error } = await state.supabase.rpc('get_restaurant_settlements', { p_lodge_id: state.lodgeId, p_business_date: businessDate || null });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

export async function recordRestaurantReservationDeposit(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Reservation deposits require an online connection');
  const { data: result, error } = await state.supabase.rpc('record_restaurant_reservation_deposit', {
    p_payload: { ...data, lodge_id: state.lodgeId, idempotency_key: data.idempotency_key || randomUUID() }
  });
  if (error) throw new Error(error.message);
  appendPosAudit('reservation_deposit_held', { entity_type: 'restaurant_reservation', entity_id: data.reservation_id });
  return result;
}

export async function recordRestaurantFeedback(data) {
  if (!state.isOnline || !state.supabase) throw new Error('Customer feedback requires an online connection');
  const { data: result, error } = await state.supabase.rpc('record_restaurant_feedback', { p_payload: { ...data, lodge_id: state.lodgeId } });
  if (error) throw new Error(error.message);
  appendPosAudit('customer_feedback_recorded', { entity_type: 'restaurant_feedback', entity_id: result?.id });
  return result;
}

export async function createRestaurantGiftCard(data) { if (!state.isOnline || !state.supabase) throw new Error('Gift cards require an online connection'); const { data: result, error } = await state.supabase.rpc('create_restaurant_gift_card', { p_payload: { ...data, lodge_id: state.lodgeId } }); if (error) throw new Error(error.message); return result }
export async function recordRestaurantTipPayout(data) { if (!state.isOnline || !state.supabase) throw new Error('Tip payouts require an online connection'); const { data: result, error } = await state.supabase.rpc('record_restaurant_tip_payout', { p_payload: { ...data, lodge_id: state.lodgeId, idempotency_key: data.idempotency_key || randomUUID() } }); if (error) throw new Error(error.message); return result }
export async function saveRestaurantReservationPolicy(data) { if (!state.isOnline || !state.supabase) throw new Error('Reservation policy requires an online connection'); const { data: result, error } = await state.supabase.rpc('upsert_restaurant_reservation_policy', { p_payload: { ...data, lodge_id: state.lodgeId } }); if (error) throw new Error(error.message); return result }
export async function recordRestaurantInventoryLot(data) { if (!state.isOnline || !state.supabase) throw new Error('Inventory lots require an online connection'); const { data: result, error } = await state.supabase.rpc('record_restaurant_inventory_lot', { p_payload: { ...data, lodge_id: state.lodgeId } }); if (error) throw new Error(error.message); return result }
export async function getRestaurantExpiryLots(days = 14) { if (!state.isOnline || !state.supabase) return []; const { data, error } = await state.supabase.rpc('get_restaurant_expiry_lots', { p_lodge_id: state.lodgeId, p_days: days }); if (error) throw new Error(error.message); return Array.isArray(data) ? data : [] }
