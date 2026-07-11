import { state } from '../state.js';
import { normalizeUserRecord } from './shared.js';
import { readCache, writeCache } from './cacheStore.js';
import { broadcastSyncStatus } from './connectivity.js';
import { mergeSessionUserScope } from './authCache.js';
import { mergeRemoteBookingsWithLocalState } from './bookingMerge.js';
import { mergeRemotePosOrdersWithLocalState } from './posMerge.js';
import { applyQueuedPosInventoryReservations, applyQueuedDayUseInventoryReservations } from './posOffline.js';
import { mergeRemoteInventoryWithLocalState } from './inventoryMerge.js';
import { mergeRemoteQuotationsWithLocalState } from './quotationMerge.js';

const SYNC_REFRESH_RETRY_BASE_DELAY_MS = 5_000;
const SYNC_REFRESH_RETRY_MAX_DELAY_MS = 60_000;
const USER_SELECT = 'id, auth_user_id, name, email, role, status, lodge_id, created_at, last_sign_in_at, last_desktop_sign_in_at, last_pwa_sign_in_at, last_activity_at, invite_sent_at, password_updated_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash, capability_overrides';
const LEGACY_USER_SELECT = 'id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash';
const BOOKING_LIST_SELECT = 'id, customer_id, room_id, check_in, check_out, adults, children, total_amount, status, payment_status, amount_paid, charges_total, deposit_amount, notes, is_exclusive_event, invoice_number, created_at, updated_at, created_by, payment_method, source, quotation_id, event_daily_rate';
const INVENTORY_ITEM_SELECT = 'id, name, category, unit, current_stock, reorder_level, selling_price, outlet_id, latest_unit_cost, lodge_id, created_at, updated_at, sku, barcode, is_active';
const INVENTORY_ITEM_LEGACY_SELECT = 'id, name, category, unit, current_stock, reorder_level, selling_price, outlet_id, latest_unit_cost, lodge_id, created_at';
const INVENTORY_PURCHASE_SELECT = 'id, item_id, quantity_purchased, unit_cost, total_cost, supplier, date, notes, lodge_id, created_at, updated_at';
const POOL_DAY_USE_SELECT = 'id, date, resource_key, resource_name, start_time, end_time, status, total, adults, children, notes, created_at, updated_at, deposit_amount, balance_due, fee_per_adult, fee_per_child, flat_fee, hourly_rate, package_fee, pricing_mode, created_by';
const MAINTENANCE_TICKET_SELECT = 'id, room_id, title, issue, description, status, priority, reported_date, labour_cost, parts_cost, total_cost, vendor_name, cost_notes, completed_at, created_at, updated_at, rooms(room_number, room_type)';
const MAINTENANCE_TICKET_LEGACY_SELECT = 'id, room_id, title, description, status, priority, reported_date, labour_cost, parts_cost, total_cost, vendor_name, cost_notes, created_at, rooms(room_number, room_type)';
const BOOKING_PAGE_SIZE = 1000;
const BOOKING_REFRESH_MAX_ROWS = 10000;
const CACHE_REFRESH_CONCURRENCY = 3;
const PRESERVE_PENDING_LOCAL_CACHE_NAMES = new Set([
  'booking-charges',
  'room-rate-overrides',
  'event-line-items',
  'expenses',
  'maintenance',
  'inventory-purchases',
  'inventory-stocktakes',
  'supply-items',
  'supply-purchases',
  'room-supply-stock',
  'room-supply-movements',
  'room-supply-allocations',
  'supply-stocktakes',
  'room-supply-stocktakes'
]);

function uniqueSyncNames(names = []) {
  return [...new Set((names || []).filter(Boolean))];
}

function isSyncRefreshStaleFor(name) {
  return state.syncRefreshState.stale && state.syncRefreshState.names.includes(name);
}

function markSyncRefreshStale(names = [], errorMessage = 'Cache refresh failed.') {
  const mergedNames = uniqueSyncNames([...state.syncRefreshState.names, ...names]);
  state.syncRefreshState = {
    stale: mergedNames.length > 0,
    names: mergedNames,
    attempts: Math.max(1, Number(state.syncRefreshState.attempts || 0)),
    lastError: String(errorMessage || 'Cache refresh failed.'),
    lastFailedAt: new Date().toISOString()
  };
  broadcastSyncStatus();
}

function clearSyncRefreshStale(names = []) {
  if (!state.syncRefreshState.stale) return;
  const clearNames = new Set(uniqueSyncNames(names));
  const remainingNames = clearNames.size === 0 ?
  [] :
  state.syncRefreshState.names.filter((name) => !clearNames.has(name));
  state.syncRefreshState = {
    stale: remainingNames.length > 0,
    names: remainingNames,
    attempts: remainingNames.length > 0 ? state.syncRefreshState.attempts : 0,
    lastError: remainingNames.length > 0 ? state.syncRefreshState.lastError : '',
    lastFailedAt: remainingNames.length > 0 ? state.syncRefreshState.lastFailedAt : null
  };
  if (!state.syncRefreshState.stale && state.syncRefreshRetryTimer) {
    clearTimeout(state.syncRefreshRetryTimer);
    state.syncRefreshRetryTimer = null;
  }
  broadcastSyncStatus();
}

function isLegacyUserSchemaError(error) {
  const message = String(error?.message || '');
  return /column users\.(status|last_sign_in_at|last_desktop_sign_in_at|last_pwa_sign_in_at|last_activity_at|invite_sent_at|password_updated_at|capability_overrides) does not exist/i.test(message);
}

function isMissingInventoryCompatibilityColumnError(error) {
  return /column\s+inventory_items\.(barcode|is_active|sku|updated_at)\s+does\s+not\s+exist/i.test(String(error?.message || ''));
}

function isMaintenanceTicketSchemaCompatibilityError(error) {
  return /column maintenance_tickets\.(issue|completed_at|updated_at) does not exist/i.test(String(error?.message || ''));
}

function normalizeMaintenanceTicketRowForCache(row = {}) {
  return {
    ...row,
    title: row.title || row.issue || '',
    issue: row.issue || row.title || '',
    description: row.description || row.notes || '',
    completed_at: row.completed_at || null,
    updated_at: row.updated_at || row.created_at || null
  };
}

function mergeRemoteRowsPreservingPendingLocal(name, rows = []) {
  const localPending = (readCache(name) || []).filter((row) =>
  row?._pending_sync === true ||
  row?._deleted_offline === true ||
  row?._sync_state === 'pending');
  const pendingIds = new Set(localPending.map((row) => row?.id).filter(Boolean));
  return [
    ...localPending,
    ...(rows || []).filter((row) => !pendingIds.has(row?.id))
  ];
}

async function fetchUsersForRefresh() {
  const primary = await state.supabase
    .from('users')
    .select(USER_SELECT)
    .eq('lodge_id', state.lodgeId)
    .order('name');
  if (!primary.error || !isLegacyUserSchemaError(primary.error)) {
    return primary;
  }
  return state.supabase
    .from('users')
    .select(LEGACY_USER_SELECT)
    .eq('lodge_id', state.lodgeId)
    .order('name');
}

async function fetchInventoryItemsForRefresh() {
  const primary = await state.supabase.from('inventory_items').select(INVENTORY_ITEM_SELECT).eq('lodge_id', state.lodgeId).order('category').order('name').limit(500);
  if (!primary.error || !isMissingInventoryCompatibilityColumnError(primary.error)) {
    return primary;
  }
  const legacy = await state.supabase.from('inventory_items').select(INVENTORY_ITEM_LEGACY_SELECT).eq('lodge_id', state.lodgeId).order('category').order('name').limit(500);
  return legacy.error ? legacy : {
    data: (legacy.data || []).map((row) => ({
      ...row,
      updated_at: row.updated_at || row.created_at || null,
      sku: null,
      barcode: null,
      is_active: true
    })),
    error: null
  };
}

async function fetchMaintenanceForRefresh() {
  const primary = await state.supabase
    .from('maintenance_tickets')
    .select(MAINTENANCE_TICKET_SELECT)
    .eq('lodge_id', state.lodgeId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (!primary.error || !isMaintenanceTicketSchemaCompatibilityError(primary.error)) {
    return primary;
  }
  const legacy = await state.supabase
    .from('maintenance_tickets')
    .select(MAINTENANCE_TICKET_LEGACY_SELECT)
    .eq('lodge_id', state.lodgeId)
    .order('created_at', { ascending: false })
    .limit(200);
  return legacy.error ? legacy : {
    data: (legacy.data || []).map(normalizeMaintenanceTicketRowForCache),
    error: null
  };
}

async function fetchBookingsForRefresh() {
  const rows = [];
  for (let from = 0; from < BOOKING_REFRESH_MAX_ROWS; from += BOOKING_PAGE_SIZE) {
    const to = Math.min(from + BOOKING_PAGE_SIZE - 1, BOOKING_REFRESH_MAX_ROWS - 1);
    const { data, error } = await state.supabase
      .from('bookings')
      .select(`${BOOKING_LIST_SELECT}, customers(name, phone, email), rooms(room_number, room_type, rate_per_night)`)
      .eq('lodge_id', state.lodgeId)
      .order('check_in', { ascending: false })
      .range(from, to);
    if (error) return { data: rows, error };
    const page = data || [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return { data: rows, error: null };
}

async function refreshCacheStrict(...names) {
  if (!state.lodgeId) return;
  if (!state.replayAuthReady && !state.backendSession?.token && !state.currentUser?.isMasterAdmin) {
    markSyncRefreshStale(names, 'Waiting for sign-in before refreshing live data.');
    return;
  }
  const fetchers = {
    users: () => fetchUsersForRefresh(),
    rooms: () => state.supabase.from('rooms').select('id, room_number, room_type, rate_per_night, max_occupancy, status, amenities, description, photo, photos, lodge_id, created_at, updated_at, housekeeping_status, housekeeping_notes').eq('lodge_id', state.lodgeId).order('room_number').limit(200),
    customers: () => state.supabase.from('customers').select('id, name, email, phone, id_number, nationality, created_at, updated_at, is_blacklisted, blacklist_reason, lodge_id').eq('lodge_id', state.lodgeId).order('name').limit(500),
    bookings: () => fetchBookingsForRefresh(),
    maintenance: () => fetchMaintenanceForRefresh(),
    'inventory-items': () => fetchInventoryItemsForRefresh(),
    'inventory-purchases': () => state.supabase.from('inventory_purchases').select(INVENTORY_PURCHASE_SELECT).eq('lodge_id', state.lodgeId).order('date', { ascending: false }).limit(500),
    'inventory-stocktakes': () => state.supabase.from('inventory_stocktakes').select('*, outlets(name, type)').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }).limit(100),
    'booking-charges': () => state.supabase.from('booking_charges').select('*, outlets(name)').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }).limit(1000),
    'room-rate-overrides': () => state.supabase.from('room_rate_overrides').select('*').eq('lodge_id', state.lodgeId).order('start_date').limit(500),
    'customer-credit-summary': () => state.supabase.rpc('get_customer_credit_summary', {
      p_lodge_id: state.lodgeId,
      p_search: null,
      p_limit: 1000,
      p_offset: 0
    }),
    quotations: () => state.supabase.from('quotations').select('id, customer_id, customer_name, customer_phone, customer_email, room_id, room_name, check_in, check_out, adults, children, subtotal, tax_amount, total_amount, currency, notes, status, valid_until, quotation_number, created_at, updated_at, created_by, lodge_id, parent_quotation_id, converted_booking_id, quotation_type, event_name, event_daily_rate').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }).limit(200),
    'conference-bookings': () => state.supabase.from('conference_bookings').select('id, booking_date, start_time, end_time, client_name, company, attendees, setup_type, room_name, includes_catering, catering_notes, total_amount, deposit_paid, payment_status, payment_method, notes, created_at, updated_at, lodge_id').eq('lodge_id', state.lodgeId).order('booking_date', { ascending: false }).order('start_time', { ascending: true }).limit(200),
    'event-line-items': () => state.supabase.from('event_booking_line_items').select('*').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }).limit(1000),
    'pool-day-use': () => state.supabase.from('pool_day_use').select(POOL_DAY_USE_SELECT).eq('lodge_id', state.lodgeId).order('date', { ascending: false }).limit(500),
    expenses: () => state.supabase.from('expenses').select('id, date, category, description, amount, outlet_id, created_at, updated_at, outlets(name)').eq('lodge_id', state.lodgeId).order('date', { ascending: false }).limit(500),
    'supply-items': () => state.supabase.from('supply_items').select('id, name, category, unit, current_stock, reorder_level, latest_unit_cost, lodge_id, created_at, updated_at, is_active').eq('lodge_id', state.lodgeId).order('category').order('name').limit(500),
    'supply-purchases': () => state.supabase.from('supply_purchases').select('*').eq('lodge_id', state.lodgeId).order('date', { ascending: false }).limit(500),
    'room-supply-stock': () => state.supabase.from('room_supply_room_stock').select('*, rooms(room_number, room_type), supply_items(name, unit, category)').eq('lodge_id', state.lodgeId).order('updated_at', { ascending: false }).limit(1000),
    'room-supply-movements': () => state.supabase.from('room_supply_movements').select('*, rooms(room_number, room_type), supply_items(name, unit, category)').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }).limit(1000),
    'room-supply-allocations': () => state.supabase.from('room_supply_allocations').select('*, supply_items(name, unit, category), rooms(room_number)').eq('lodge_id', state.lodgeId).order('week_start', { ascending: false }).limit(1000),
    'supply-stocktakes': () => state.supabase.from('supply_stocktakes').select('*').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }).limit(100),
    'room-supply-stocktakes': () => state.supabase.from('room_supply_stocktakes').select('*').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }).limit(100),
    'pos-orders': () => state.supabase.
    from('pos_orders').
    select('id, room_id, booking_id, walk_in_name, total, gross_total, discount_total, tax_rate, tax_total, tip_total, notes, payment_method, payment_breakdown, outlet_id, service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name, shift_id, ticket_status, status, created_at, pos_order_items(*), outlets(name)').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }).
    limit(500),
    'pos-menu-items': () => state.supabase.from('pos_menu_items').select('id, name, category, price, is_available, barcode, inventory_item_id, depletion_qty, outlet_id, template_kind, lodge_id, created_at, updated_at, kitchen_station_id').eq('lodge_id', state.lodgeId).order('category').order('name').limit(500),
    outlets: () => state.supabase.from('outlets').select('id, name, type, sort_order, is_active').eq('lodge_id', state.lodgeId).order('sort_order').limit(100)
  };

  const targetNames = uniqueSyncNames(names).filter((name) => fetchers[name]);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < targetNames.length) {
      const name = targetNames[nextIndex];
      nextIndex += 1;
      const { data, error } = await fetchers[name]();
      if (error) throw error;
      if (!data) continue;
      if (Array.isArray(data) && data.length === 0) {
        const cachedRows = readCache(name);
        if (Array.isArray(cachedRows) && cachedRows.length > 0) {
          if (name === 'outlets') {
            writeCache(name, cachedRows, { source: 'cache' });
            continue;
          }
          markSyncRefreshStale([name], 'Live refresh returned no rows; keeping cached data.');
          continue;
        }
      }
      if (name === 'users') {
        const normalizedUsers = data.map(normalizeUserRecord).filter(Boolean);
        writeCache(name, normalizedUsers, { source: 'remote' });
        if (state.currentUser && !state.currentUser.isMasterAdmin) {
          const refreshedUser = normalizedUsers.find((entry) =>
          state.currentUser.id && entry.id === state.currentUser.id ||
          !state.currentUser.id && state.currentUser.email && entry.email === state.currentUser.email
          );
          if (refreshedUser) {
            state.currentUser = mergeSessionUserScope(state.currentUser, refreshedUser);
          }
        }
        continue;
      }
      if (name === 'bookings') {
        writeCache(name, mergeRemoteBookingsWithLocalState(data || []), { source: 'remote' });
        continue;
      }
      if (name === 'inventory-items') {
        // Merge with local state so pending-sync offline creations are preserved
        const liveRows = applyQueuedDayUseInventoryReservations(applyQueuedPosInventoryReservations(data || []));
        writeCache(name, mergeRemoteInventoryWithLocalState(liveRows), { source: 'remote' });
        continue;
      }
      if (name === 'quotations') {
        writeCache(name, mergeRemoteQuotationsWithLocalState(data || []), { source: 'remote' });
        continue;
      }
      if (name === 'room-rate-overrides') {
        writeCache(name, mergeRemoteRowsPreservingPendingLocal(name, data || []), { source: 'remote' });
        continue;
      }
      if (name === 'customer-credit-summary') {
        writeCache(name, (data || []).map((row) => ({ ...row, _confirmed_balance: true })), { source: 'remote' });
        continue;
      }
      if (name === 'pos-orders') {
        writeCache(name, mergeRemotePosOrdersWithLocalState(data || []), { source: 'remote' });
        continue;
      }
      if (name === 'room-supply-stock') {
        const normalized = (data || []).map((row) => ({
          ...row,
          room_number: row.rooms?.room_number,
          room_type: row.rooms?.room_type,
          supply_name: row.supply_items?.name,
          supply_unit: row.supply_items?.unit,
          supply_category: row.supply_items?.category
        }));
        writeCache(name, mergeRemoteRowsPreservingPendingLocal(name, normalized), { source: 'remote' });
        continue;
      }
      if (name === 'room-supply-movements') {
        const normalized = (data || []).map((row) => ({
          ...row,
          room_number: row.rooms?.room_number,
          room_type: row.rooms?.room_type,
          supply_name: row.supply_items?.name,
          supply_unit: row.supply_items?.unit,
          supply_category: row.supply_items?.category
        }));
        writeCache(name, mergeRemoteRowsPreservingPendingLocal(name, normalized), { source: 'remote' });
        continue;
      }
      if (name === 'room-supply-allocations') {
        const normalized = (data || []).map((row) => ({
          ...row,
          source: 'allocation',
          entry_date: row.week_start,
          supply_name: row.supply_items?.name,
          supply_unit: row.supply_items?.unit,
          supply_category: row.supply_items?.category,
          room_number: row.rooms?.room_number
        }));
        writeCache(name, mergeRemoteRowsPreservingPendingLocal(name, normalized), { source: 'remote' });
        continue;
      }
      if (PRESERVE_PENDING_LOCAL_CACHE_NAMES.has(name)) {
        writeCache(name, mergeRemoteRowsPreservingPendingLocal(name, data || []), { source: 'remote' });
        continue;
      }
      writeCache(name, data, { source: 'remote' });
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(CACHE_REFRESH_CONCURRENCY, targetNames.length) },
      worker
    )
  );
}

function scheduleSyncRefreshRetry(names = [], reason = 'Background refresh failed.') {
  const mergedNames = uniqueSyncNames([...state.syncRefreshState.names, ...names]);
  if (mergedNames.length === 0) return;

  const nextAttempts = Math.max(1, Number(state.syncRefreshState.attempts || 0) + 1);
  state.syncRefreshState = {
    stale: true,
    names: mergedNames,
    attempts: nextAttempts,
    lastError: String(reason || 'Background refresh failed.'),
    lastFailedAt: new Date().toISOString()
  };
  broadcastSyncStatus();

  if (state.syncRefreshRetryTimer) return;

  const waitMs = Math.min(
    SYNC_REFRESH_RETRY_MAX_DELAY_MS,
    SYNC_REFRESH_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextAttempts - 1))
  );

  state.syncRefreshRetryTimer = setTimeout(async () => {
    state.syncRefreshRetryTimer = null;
    const retryNames = [...state.syncRefreshState.names];
    if (!retryNames.length || !state.isOnline || !state.lodgeId) return;
    try {
      await refreshCacheStrict(...retryNames);
      clearSyncRefreshStale(retryNames);
    } catch (error) {
      console.error('[Sync] Background cache refresh retry failed:', error);
      scheduleSyncRefreshRetry(retryNames, error?.message || 'Background refresh retry failed.');
    }
  }, waitMs);
}

export async function refreshCachesAfterSync(...names) {
  const targetNames = uniqueSyncNames(names);
  if (targetNames.length === 0) return;
  const failures = [];
  for (const name of targetNames) {
    try {
      await refreshCacheStrict(name);
      clearSyncRefreshStale([name]);
    } catch (error) {
      console.error(`[Sync] Post-sync cache refresh failed for ${name}:`, error);
      failures.push({ name, error });
    }
  }
  if (failures.length > 0) {
    const failedNames = failures.map((entry) => entry.name);
    const reason = failures[0]?.error?.message || 'Post-sync cache refresh failed.';
    markSyncRefreshStale(failedNames, reason);
    scheduleSyncRefreshRetry(failedNames, reason);
  }
}

export async function refreshCache(...names) {
  try {
    await refreshCacheStrict(...names);
    clearSyncRefreshStale(uniqueSyncNames(names).filter((name) => isSyncRefreshStaleFor(name)));
  } catch (e) {
    console.error('Cache refresh failed:', e);
  }
}

export async function refreshAllCaches() {
  if (!state.lodgeId) return;
  await refreshCache(
    'users',
    'rooms',
    'customers',
    'bookings',
    'maintenance',
    'inventory-items',
    'inventory-purchases',
    'inventory-stocktakes',
    'quotations',
    'conference-bookings',
    'event-line-items',
    'pool-day-use',
    'pos-orders',
    'pos-menu-items',
    'outlets',
    'expenses',
    'booking-charges',
    'room-rate-overrides',
    'customer-credit-summary',
    'supply-items',
    'supply-purchases',
    'room-supply-stock',
    'room-supply-movements',
    'room-supply-allocations',
    'supply-stocktakes',
    'room-supply-stocktakes'
  );
}
