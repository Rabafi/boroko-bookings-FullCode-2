import { state } from '../state.js';
import { normalizeUserRecord } from './shared.js';
import { readCache, writeCache } from './cacheStore.js';
import { broadcastSyncStatus } from './connectivity.js';
import { mergeSessionUserScope } from './authCache.js';
import { mergeRemoteBookingsWithLocalState } from './bookingMerge.js';
import { mergeRemotePosOrdersWithLocalState } from './posMerge.js';
import { applyQueuedPosInventoryReservations, applyQueuedDayUseInventoryReservations } from './posOffline.js';
import { mergeRemoteInventoryWithLocalState } from './inventoryMerge.js';

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
    quotations: () => state.supabase.from('quotations').select('id, customer_id, customer_name, customer_phone, room_id, room_name, check_in, check_out, adults, children, subtotal, tax_amount, total_amount, currency, notes, status, valid_until, quotation_number, created_at, updated_at, created_by, lodge_id, parent_quotation_id, converted_booking_id').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }).limit(200),
    'conference-bookings': () => state.supabase.from('conference_bookings').select('id, booking_date, start_time, end_time, client_name, company, attendees, setup_type, room_name, includes_catering, catering_notes, total_amount, deposit_paid, payment_status, payment_method, notes, created_at, updated_at, lodge_id').eq('lodge_id', state.lodgeId).order('booking_date', { ascending: false }).order('start_time', { ascending: true }).limit(200),
    'pool-day-use': () => state.supabase.from('pool_day_use').select(POOL_DAY_USE_SELECT).eq('lodge_id', state.lodgeId).order('date', { ascending: false }).limit(500),
    expenses: () => state.supabase.from('expenses').select('id, date, category, description, amount, outlet_id, created_at, updated_at, outlets(name)').eq('lodge_id', state.lodgeId).order('date', { ascending: false }).limit(500),
    'pos-orders': () => state.supabase.
    from('pos_orders').
    select('id, room_id, booking_id, walk_in_name, total, gross_total, discount_total, tax_rate, tax_total, tip_total, notes, payment_method, payment_breakdown, outlet_id, service_mode, table_name, tab_name, waiter_name, cashier_id, cashier_name, shift_id, ticket_status, status, created_at, pos_order_items(*), outlets(name)').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }).
    limit(500),
    'pos-menu-items': () => state.supabase.from('pos_menu_items').select('id, name, category, price, is_available, barcode, inventory_item_id, depletion_qty, outlet_id, template_kind, lodge_id, created_at, updated_at').eq('lodge_id', state.lodgeId).order('category').order('name').limit(500),
    outlets: () => state.supabase.from('outlets').select('id, name, type, sort_order, is_active').eq('lodge_id', state.lodgeId).order('sort_order').limit(100)
  };

  await Promise.all(names.map(async (name) => {
    if (!fetchers[name]) return;
    const { data, error } = await fetchers[name]();
    if (error) throw error;
    if (!data) return;
    if (Array.isArray(data) && data.length === 0) {
      const cachedRows = readCache(name);
      if (Array.isArray(cachedRows) && cachedRows.length > 0) {
        if (name === 'outlets') {
          writeCache(name, cachedRows, { source: 'cache' });
          return;
        }
        markSyncRefreshStale([name], 'Live refresh returned no rows; keeping cached data.');
        return;
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
      return;
    }
    if (name === 'bookings') {
      writeCache(name, mergeRemoteBookingsWithLocalState(data || []), { source: 'remote' });
      return;
    }
    if (name === 'inventory-items') {
      // Merge with local state so pending-sync offline creations are preserved
      const liveRows = applyQueuedDayUseInventoryReservations(applyQueuedPosInventoryReservations(data || []));
      writeCache(name, mergeRemoteInventoryWithLocalState(liveRows), { source: 'remote' });
      return;
    }
    if (name === 'pos-orders') {
      writeCache(name, mergeRemotePosOrdersWithLocalState(data || []), { source: 'remote' });
      return;
    }
    writeCache(name, data, { source: 'remote' });
  }));
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
    'quotations',
    'conference-bookings',
    'pool-day-use',
    'pos-orders',
    'pos-menu-items',
    'outlets',
    'expenses'
  );
}
