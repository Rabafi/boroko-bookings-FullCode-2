import { state } from '../state.js';
import { normalizeUserRecord } from './shared.js';
import { writeCache } from './cacheStore.js';
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

async function refreshCacheStrict(...names) {
  if (!state.lodgeId) return;
  const fetchers = {
    users: () => fetchUsersForRefresh(),
    rooms: () => state.supabase.from('rooms').select('*').eq('lodge_id', state.lodgeId).order('room_number'),
    customers: () => state.supabase.from('customers').select('*').eq('lodge_id', state.lodgeId).order('name'),
    bookings: () => state.supabase.from('bookings').select('*').eq('lodge_id', state.lodgeId).order('check_in', { ascending: false }),
    maintenance: () => state.supabase.
    from('maintenance_tickets').
    select('*, rooms(room_number, room_type)').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }),
    'inventory-items': () => state.supabase.from('inventory_items').select('*').eq('lodge_id', state.lodgeId).order('category').order('name'),
    'inventory-purchases': () => state.supabase.from('inventory_purchases').select('*').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    quotations: () => state.supabase.from('quotations').select('*').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }),
    'conference-bookings': () => state.supabase.from('conference_bookings').select('*').eq('lodge_id', state.lodgeId).order('booking_date', { ascending: false }).order('start_time', { ascending: true }),
    'pool-day-use': () => state.supabase.from('pool_day_use').select('*').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    expenses: () => state.supabase.from('expenses').select('*, outlets(name)').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    'pos-orders': () => state.supabase.
    from('pos_orders').
    select('*, pos_order_items(*), outlets(name)').
    eq('lodge_id', state.lodgeId).
    order('created_at', { ascending: false }),
    'pos-menu-items': () => state.supabase.from('pos_menu_items').select('*').eq('lodge_id', state.lodgeId).order('category').order('name'),
    outlets: () => state.supabase.from('outlets').select('id, name, type, sort_order, is_active').eq('lodge_id', state.lodgeId).order('sort_order')
  };

  await Promise.all(names.map(async (name) => {
    if (!fetchers[name]) return;
    const { data, error } = await fetchers[name]();
    if (error) throw error;
    if (!data) return;
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
  try {
    await refreshCacheStrict(...targetNames);
    clearSyncRefreshStale(targetNames);
  } catch (error) {
    console.error('[Sync] Post-sync cache refresh failed:', error);
    markSyncRefreshStale(targetNames, error?.message || 'Post-sync cache refresh failed.');
    scheduleSyncRefreshRetry(targetNames, error?.message || 'Post-sync cache refresh failed.');
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
