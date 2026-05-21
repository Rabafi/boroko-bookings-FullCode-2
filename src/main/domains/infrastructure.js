import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { getRoleCapabilities, normalizeAppRole } from "../../shared/accessControl.js";
import { FINANCIAL_SYNC_TABLES, isFinancialSyncItem, pickNextReadySyncItemIndex } from "../../shared/syncQueue.js";
export { FINANCIAL_SYNC_TABLES, isFinancialSyncItem };
import { getBackupHealthSummary, getBackupInfoForHealth } from './backupHealth.js';
import { ensureDir, readJsonFile, writeJsonFile } from './fileStore.js';
import {
  SYNC_DRIFT_FAULT_TYPES,
  appendHealthFault,
  readFailedSyncQueue,
  readHealthFaults,
  readSyncMeta,
  readSyncQueue,
  writeFailedSyncQueue,
  writeSyncMeta,
  writeSyncQueue
} from './syncStore.js';
import {
  DEAD_LETTER_AUTO_RETRY_AFTER_MS,
  ensureQueuedItem,
  getQueuedDayUseEntryId,
  getQueuedInventoryItemId,
  getQueuedPosOrderId,
  getSyncItemBookingId,
  getSyncItemScope,
  isInventoryItemQueueItem,
  isPosCreateOrderQueueItem,
  isPosVoidQueueItem,
  normalizeQueuedSyncItemForReplay
} from './syncShared.js';
import {
  DEBUG_CACHE_FALLBACKS,
  clearCache,
  readCache,
  writeCache
} from './cacheStore.js';
import {
  buildSupabaseClient
} from './authClients.js';
import {
  refreshCache,
  refreshCachesAfterSync,
  refreshAllCaches
} from './cacheRefresh.js';
import {
  getUserPosOutletFilter,
  getUserById,
  getUsers
} from './users.js';
import {
  applyOfflinePosInventoryReservation,
  applyQueuedPosInventoryReservations,
  getOfflinePosInventoryReservation,
  patchLocalPosVoidHistory,
  readLocalPosVoidHistory,
  restoreOfflinePosInventoryReservation,
  upsertLocalPosVoidHistory
} from './posOffline.js';
import { mergeRemoteBookingsWithLocalState } from './bookingMerge.js';
import { mergeRemotePosOrdersWithLocalState } from './posMerge.js';
import {
  markClearedSyncItemForManualReview,
  patchCachedBookingSyncState,
  patchCachedDayUseSyncState,
  patchCachedInventoryItemSyncState,
  patchCachedPosOrderSyncState,
  patchCachedQuotationSyncState,
  replaceQueuedBookingReference,
  rewriteQueuedBookingReferenceItem
} from './syncCache.js';
import {
  buildSyncStatusSnapshot,
  isQueuedDependencyResolved
} from './syncStatus.js';
import { broadcastSyncStatus, checkOnline } from './connectivity.js';
import {
  DEFAULT_OFFLINE_LEASE_DAYS,
  DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  addDays,
  computeGracePeriodEnd,
  computeOfflineValidUntil,
  computeSubscriptionState,
  getPlanFeatureMap,
  mergeFeatureOverrides,
  normalizePlanName,
  subscriptionAllowsAccess,
  toPositiveInt
} from './subscriptionState.js';
import { MAX_FINANCIAL_AMOUNT } from './shared.js';
import {
  appendAuxiliaryLog,
  CRITICAL_ERROR_LOG_FILE,
  getLocalDateKey,
  isNonCriticalOperationalError,
  LOCAL_TIME_ZONE,
  readAuxiliaryLog,
  recordCriticalError,
  writeAuxiliaryLog
} from './operationalLog.js';
export { ensureDir, readJsonFile, writeJsonFile } from './fileStore.js';
export { getBackupHealthSummary, getBackupInfoForHealth } from './backupHealth.js';
export {
  SYNC_DRIFT_FAULT_TYPES,
  appendHealthFault,
  readFailedSyncQueue,
  readHealthFaults,
  readSyncMeta,
  readSyncQueue,
  writeFailedSyncQueue,
  writeSyncQueue
} from './syncStore.js';
export {
  DEAD_LETTER_AUTO_RETRY_AFTER_MS,
  ensureQueuedItem,
  getQueuedInventoryItemId,
  getQueuedPosOrderId,
  getSyncItemBookingId,
  getSyncItemScope,
  isInventoryItemQueueItem,
  isPosCreateOrderQueueItem,
  isPosVoidQueueItem,
  normalizeQueuedSyncItemForReplay
} from './syncShared.js';
export {
  DEBUG_CACHE_FALLBACKS,
  clearCache,
  readCache,
  writeCache
} from './cacheStore.js';
export {
  getAllUsers,
  getUserById,
  getUsers
} from './users.js';
export { broadcastSyncStatus, checkOnline } from './connectivity.js';
export { refreshCache, refreshAllCaches } from './cacheRefresh.js';
export {
  buildSyncStatusSnapshot
} from './syncStatus.js';
export {
  applyOfflineDayUseInventoryReservation,
  applyOfflinePosInventoryReservation,
  applyQueuedDayUseInventoryReservations,
  applyQueuedPosInventoryReservations,
  getOfflineDayUseInventoryReservation,
  getOfflinePosInventoryReservation,
  readLocalPosVoidHistory,
  restoreOfflineDayUseInventoryReservation,
  restoreOfflinePosInventoryReservation,
  upsertLocalPosVoidHistory
} from './posOffline.js';
export { mergeRemoteBookingsWithLocalState } from './bookingMerge.js';
export {
  buildUsageSummary,
  buildUsageWarning,
  getMonthWindowIso
} from './usageSupport.js';
export {
  DEFAULT_OFFLINE_LEASE_DAYS,
  DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  addDays,
  computeGracePeriodEnd,
  computeOfflineValidUntil,
  computeSubscriptionState,
  getPlanFeatureMap,
  mergeFeatureOverrides,
  normalizePlanName,
  subscriptionAllowsAccess,
  toPositiveInt
} from './subscriptionState.js';
export {
  createAppError,
  isBackendAuthSchemaError,
  isUuid,
  MAX_FINANCIAL_AMOUNT,
  normalizeEmail,
  normalizeLodgeId,
  normalizeUserRecord
} from './shared.js';
export {
  appendAuxiliaryLog,
  CRITICAL_ERROR_LOG_FILE,
  getLocalDateKey,
  isNonCriticalOperationalError,
  logActivity,
  LOCAL_TIME_ZONE,
  readAuxiliaryLog,
  recordCriticalError,
  writeAuxiliaryLog
} from './operationalLog.js';
// ─── SUPABASE CREDENTIALS ─────────────────────────────────────────────────────
// URL + ANON KEY — baked in at build time from the root .env file by electron-vite.
// Neither value is a secret (Supabase designed the anon key to be public-facing),
// but keeping them in .env rather than source code means they are not committed to
// the git repository and can be rotated without a code change.
//
// Before building, create a root .env file (see .env.example):
//   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
//   VITE_SUPABASE_KEY=<anon-public-key>
//
// SERVICE ROLE KEY — SECRET. Never put this in .env or source code.
// Set as an OS environment variable on the Command Central admin machine ONLY:
//   Windows PowerShell:
//     [System.Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','<key>','User')
//   macOS / Linux (add to ~/.zshrc or ~/.bashrc):
//     export SUPABASE_SERVICE_ROLE_KEY='<key>'
//
// Lodge customer machines will NOT have this variable → adminDb stays null →
// admin-only functions return a clear error instead of exposing privileged access.
// ─────────────────────────────────────────────────────────────────────────────
import { state } from "../state.js";const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY;

























const AUTH_CONTRACT_VERSION = 2;
const CONNECTIVITY_CHECK_INTERVAL_MS = 3000;
const PERIODIC_SYNC_INTERVAL_MS = 15000;
const PROFILE_CACHE_FILES = {
  settings: [],
  users: [],
  rooms: [],
  customers: [],
  bookings: [],
  quotations: [],
  expenses: [],
  outlets: [],
  'conference-bookings': [],
  'pool-day-use': [],
  'inventory-items': [],
  'inventory-purchases': [],
  'pos-menu-items': [],
  'pos-orders': [],
  'pos-order-items': [],
  'pos-void-history': [],
  activity: [],
  auth: [],
  syncQueue: [],
  syncFailed: [],
  syncMeta: null,
  healthFaults: [],
  cacheFreshness: null,
  trialStatus: null
};

export {
  buildSupabaseAuthClient,
  clearBackendSession,
  getAuthRedirectUrl
} from './authClients.js';

// ─── PROFILES / LEGACY LODGE ID ──────────────────────────────────────────────
// Older builds stored a single lodge ID and one shared cache directory.
// Newer builds store multiple lodge profiles on one PC and activate one at a
// time by swapping the runtime lodgeId/cacheDir underneath existing functions.

function initializeProfileRuntime() {
  return import('./' + 'profiles.js').then((module) => module.initializeProfileRuntime());
}

// Returns the admin (service-role) Supabase client, or throws a clear error if
// the SUPABASE_SERVICE_ROLE_KEY env var was not set on this machine.
// Use this in any function that queries across all lodges (Command Central only).
export function requireAdmin() {
  if (!state.adminDb) {
    throw new Error(
      'This operation requires Command Central admin access. ' +
      'Set the SUPABASE_SERVICE_ROLE_KEY environment variable on this machine. ' +
      'See setup documentation for details.'
    );
  }
  return state.adminDb;
}

/**
 * Returns the outlet filter for the current user's POS access.
 * null  = unrestricted (manager / admin / super_admin / master admin)
 * []    = no access (cashier/supervisor with no outlets assigned)
 * [id1] = restricted to these outlet UUIDs
 */
export {
  clearSessionNonce,
  createSessionNonce,
  getCurrentUser,
  logoutCurrentUser,
  restoreSavedTrustedSession,
  restoreUserSession,
  setCurrentUser,
  validateCurrentSession
} from './authSession.js';

// ─── CACHE HELPERS ────────────────────────────────────────────────────────────

function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return;
  console.log(`[AUTH TRACE] ${label}`, payload);
}

function makeBackendAuthSchemaError(message, details = {}) {
  console.warn('[AUTH TRACE] schema error wrapper hit', { message, details });
  return {
    user: null,
    code: 'backend_auth_schema_outdated',
    error: message,
    details
  };
}

// ─── CONNECTIVITY & SYNC ──────────────────────────────────────────────────────

const MAX_SYNC_RETRIES = 5;
const SYNC_RETRY_BASE_DELAY_MS = 1000;
const SYNC_RETRY_MAX_DELAY_MS = 30_000;
const SYNC_ALREADY_APPLIED_CODES = new Set(['23505']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isBookingUpdateConflictError(message = '') {
  return /modified on another device|booking conflict|refresh and try again/i.test(String(message || ''));
}

function shouldManualReviewSyncItem(item, errorMessage = '') {
  return item?.table === 'update_booking' && isBookingUpdateConflictError(errorMessage);
}

function isCreateBookingQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'create_booking';
}

function isConvertQuotationQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'convert_quotation_to_booking';
}

function getQueuedBookingId(item) {
  const bookingId = String(item?.data?.p_booking_id || '').trim();
  if (bookingId) return bookingId;

  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith('booking-')) {
    const parsedId = queueId.slice('booking-'.length).trim();
    if (parsedId) return parsedId;
  }

  console.error('[BOOKING SYNC] Missing booking id for queue item', {
    queueId: item?._queue_id || null,
    table: item?.table || null
  });
  return null;
}

function getQueuedQuotationId(item) {
  const quotationId = String(item?.data?.p_quotation_id || item?.data?.payload?.id || '').trim();
  if (quotationId) return quotationId;

  const queueId = String(item?._queue_id || '').trim();
  if (queueId.startsWith('quotation-')) {
    const parsedId = queueId.slice('quotation-'.length).trim();
    if (parsedId) return parsedId;
  }

  return null;
}

function isRoomConflictError(message = '') {
  return /no_overlapping_bookings|room is already booked|room is not available|room.*conflict/i.test(String(message || ''));
}

function valuesEqualForDrift(left, right) {
  if (left == null && right == null) return true;
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return Math.abs(leftNum - rightNum) < 0.0001;
  }
  return String(left) === String(right);
}

function hasDriftBaselineValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function queueItemNeedsBookingRefresh(item) {
  if (!item) return false;
  if (isPosCreateOrderQueueItem(item)) {
    return !!(item?.data?.payload?.booking_id || item?.data?.payload?.room_id);
  }
  if (item?.type === 'rpc') {
    return new Set([
    'create_booking',
    'update_booking',
    'update_booking_status',
    'update_booking_payment',
    'create_booking_record',
    'convert_quotation_to_booking']
    ).has(item.table);
  }
  return item?.table === 'bookings';
}

function queueItemNeedsInventoryRefresh(item) {
  // create_inventory_item: always refresh so the local pending-sync item is
  // replaced by the definitive server row (with the confirmed UUID).
  if (item?.type === 'rpc' && item?.table === 'create_inventory_item') return true;
  if (isPosCreateOrderQueueItem(item) || isPosVoidQueueItem(item)) {
    const items = Array.isArray(item?.data?.payload?.items) ? item.data.payload.items : [];
    return items.some((entry) => !!entry?.menu_item_id || !!entry?.inventory_item_id);
  }
  if (item?.type === 'rpc' && ['add_pool_day_use', 'delete_pool_day_use'].includes(item?.table)) {
    const extras = Array.isArray(item?.data?.payload?.extras) ?
    item.data.payload.extras :
    Array.isArray(item?._inventory_extras) ? item._inventory_extras : [];
    return extras.some((entry) => !!entry?.inventory_item_id && Number(entry?.quantity || 0) > 0);
  }
  return false;
}

function isAlreadyAppliedInsertError(item, error) {
  if (item?.type !== 'insert') return false;
  if (!item?.data?.id) return false;
  const code = String(error?.code || '').trim();
  return SYNC_ALREADY_APPLIED_CODES.has(code);
}

function isAlreadyAppliedRpcError(item, errorOrMessage) {
  if (item?.type !== 'rpc') return false;
  const message = getErrorMessage(errorOrMessage);
  if (isConvertQuotationQueueItem(item) && /quotation is already converted|quotation is already .*converted|already converted/i.test(message)) {
    return true;
  }
  const payloadId = item?.data?.payload?.id || item?.data?.p_booking_id || item?.data?.p_quotation_id || null;
  if (!payloadId) return false;

  const code = String(errorOrMessage?.code || '').trim();
  return SYNC_ALREADY_APPLIED_CODES.has(code) ||
  /duplicate key|unique constraint|already exists|already applied|23505/i.test(message);
}

export async function processSyncQueue() {
  if (state.syncInProgress) return { success: false, skipped: true, error: 'Sync is already in progress.' };
  // P0-5: Never replay queued operations before a real user session is confirmed.
  // Offline financial RPCs carry lodge-scoped auth; replaying them before the
  // correct Supabase client/session is restored can poison data or fail silently.
  if (!state.replayAuthReady) {
    console.warn('[Sync] processSyncQueue skipped — replayAuthReady is false (no authenticated session yet)');
    writeSyncMeta({ replayAuthNotReadyAt: new Date().toISOString() });
    return { success: false, skipped: true, error: 'No authenticated session — please log in first.' };
  }
  state.syncInProgress = true;
  try {
    await _runSyncQueue();
    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error);
    console.error('[Sync] Fatal sync loop error:', error);
    appendHealthFault({
      type: 'sync_loop_error',
      scope: 'sync-queue',
      severity: 'error',
      message,
      at: new Date().toISOString()
    });
    writeSyncMeta({
      lastSyncFinishedAt: new Date().toISOString(),
      lastSyncOutcome: 'fatal_error',
      lastSyncError: message
    });
    return { success: false, error: message };
  } finally {
    state.syncInProgress = false;
    broadcastSyncStatus();
  }
}

async function _runSyncQueue() {
  await requeueEligibleFailedSyncItems();
  let queue = readSyncQueue().
  map((item) => ensureQueuedItem(item, item?.type || 'op')).
  map(normalizeQueuedSyncItemForReplay);
  if (queue.length === 0) return;

  // Normalize items left over from a previous (possibly crashed) run.
  // committed → drop (RPC already succeeded; do not retry)
  // in_flight → reset to pending (result unknown; retry — safe for all current operations)
  const normalized = [];
  for (const item of queue) {
    if (item._state === 'committed') {
      console.log('[SYNC COMMITTED CLEANUP]', item._queue_id);
      continue;
    }
    normalized.push(item._state === 'in_flight' ? { ...item, _state: 'pending' } : item);
  }
  if (normalized.length !== queue.length) writeSyncQueue(normalized);
  queue = normalized;

  // P0-1: record that a sync run has started
  writeSyncMeta({ lastSyncStartedAt: new Date().toISOString(), lastSyncOutcome: 'in_progress', lastSyncError: '' });

  console.log(`Syncing ${queue.length} offline operation(s)...`);
  const deadLetter = [];
  let successCount = 0;
  // Tracks _queue_ids of items that failed — dependents will be skipped.
  // Pre-seeded from sync-failed.json so children of a previously dead-lettered
  // parent are blocked immediately, not executed against a non-existent booking.
  // readFailedSyncQueue always returns []; corrupted file cannot crash this path.
  const _priorDeadLetter = readFailedSyncQueue();
  const failedQueueIds = new Set(_priorDeadLetter.map((item) => item._queue_id).filter(Boolean));
  const completedQueueIds = new Set();
  console.log('[SYNC PRELOAD FAILED IDS]', [...failedQueueIds]);
  const pending = [...queue];
  // P1-8: widen post-sync refresh tracking
  let shouldRefreshBookings = false;
  let shouldRefreshInventory = false;
  let shouldRefreshCustomers = false;
  let shouldRefreshRooms = false;
  let shouldRefreshUsers = false;
  let shouldRefreshQuotations = false;
  let shouldRefreshPosOrders = false;
  let shouldRefreshConference = false;
  let shouldRefreshPoolDayUse = false;

  while (pending.length > 0) {
    const nextIndex = pickNextReadySyncItemIndex(
      pending,
      completedQueueIds,
      failedQueueIds,
      isQueuedDependencyResolved
    );
    if (nextIndex === -1) {
      const blockedAt = new Date().toISOString();
      while (pending.length > 0) {
        const blockedItem = {
          ...pending.shift(),
          _state: 'pending',
          retryCount: MAX_SYNC_RETRIES,
          lastError: 'Blocked: unresolved sync dependency cycle',
          lastAttemptedAt: blockedAt,
          manualRetryOnly: true
        };
        if (blockedItem?._queue_id) failedQueueIds.add(blockedItem._queue_id);
        deadLetter.push(blockedItem);
      }
      writeSyncQueue([]);
      break;
    }

    const [item] = pending.splice(nextIndex, 1);
    // Skip items whose parent operation failed this run
    if (item._depends_on && failedQueueIds.has(item._depends_on)) {
      console.warn('[SYNC SKIPPED DEPENDENT]', { operation: item.table, queueId: item._queue_id, dependsOn: item._depends_on });
      const retryCount = (item.retryCount || 0) + 1;
      const skipped = { ...item, _state: 'pending', retryCount, lastError: 'Skipped: parent operation failed', lastAttemptedAt: new Date().toISOString() };
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          console.warn('[POS SYNC] Failed order', orderId, 'Skipped: parent operation failed');
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: 'Skipped: parent operation failed'
          });
        }
      }
      // Also mark related bookings as failed if their create_booking parent failed
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item);
        if (bookingId) {
          console.warn('[BOOKING SYNC] Failed booking', bookingId, 'Skipped: parent operation failed');
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: 'Skipped: parent operation failed'
          });
        }
      }
      if (retryCount >= MAX_SYNC_RETRIES) {
        deadLetter.push(skipped);
      } else {
        pending.push(skipped);
      }
      writeSyncQueue(pending);
      continue;
    }

    const priorRetries = Math.max(0, Number(item.retryCount || 0));
    if (priorRetries > 0) {
      const backoffMs = Math.min(
        SYNC_RETRY_MAX_DELAY_MS,
        SYNC_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, priorRetries - 1))
      );
      console.warn(`[Sync] Backing off ${backoffMs}ms before retrying ${item.type} ${item.table}`);
      await delay(backoffMs);
    }

    // Persist in_flight before issuing remote call.
    // Crash here → restart normalizes to pending and retries safely.
    writeSyncQueue([{ ...item, _state: 'in_flight' }, ...pending]);

    let supabaseError = null;
    let rpcResultData = null;
    try {
      if (item.type === 'insert') {
        const payload = {
          ...item.data,
          lodge_id: item.data.lodge_id || state.lodgeId
        };

        const { data, error } = await state.supabase.
        from(item.table).
        insert(payload).
        select();

        if (error) {
          if (isAlreadyAppliedInsertError(item, error)) {
            console.warn(`↻ INSERT ${item.table} already applied remotely for id ${item.data.id}; treating as synced`);
            supabaseError = null;
          } else {
            console.error('❌ INSERT FAILED:', error);
            supabaseError = error;
          }
        } else {
          console.log('✅ INSERT SUCCESS:', data);
        }
      } else if (item.type === 'update') {
        // P2-14: use .select('id') to verify at least one row was actually matched.
        // A 0-row result means the entity was deleted or moved on the server during
        // the outage — the update is silently lost. We surface this as a health fault
        // rather than treating it as a success.
        const itemLodgeId = item.data?.lodge_id || item.lodge_id || state.lodgeId;
        const { data: updData, error: updError } = await state.supabase.
        from(item.table).
        update(item.data).
        eq('id', item.id).
        eq('lodge_id', itemLodgeId).
        select('id');
        supabaseError = updError || null;
        if (!updError && (!updData || updData.length === 0)) {
          // Row not found on server — record as a fault but treat operation as consumed
          const ghostMsg = `UPDATE ${item.table} id=${item.id} matched 0 rows on server (entity may have been deleted during outage)`;
          console.warn('[Sync] Ghost update:', ghostMsg);
          appendHealthFault({ type: 'ghost_update', scope: item.table, message: ghostMsg, at: new Date().toISOString() });
        }
      } else if (item.type === 'delete') {
        const itemLodgeId = item.data?.lodge_id || item.lodge_id || state.lodgeId;
        ({ error: supabaseError } = await state.supabase.from(item.table).delete().eq('id', item.id).eq('lodge_id', itemLodgeId));
      } else if (item.type === 'rpc') {
        const { data, error } = await state.supabase.rpc(item.table, item.data);
        rpcResultData = data || null;
        if (error) {
          if (isAlreadyAppliedRpcError(item, error)) {
            console.warn(`↻ RPC ${item.table} already applied remotely for queued id; treating as synced`, item._queue_id);
            supabaseError = null;
          } else {
            console.error(`❌ RPC ${item.table} FAILED:`, error);
            supabaseError = error;
          }
        } else if (data && data.success === false) {
          if (isAlreadyAppliedRpcError(item, data.error)) {
            console.warn(`↻ RPC ${item.table} reported duplicate for queued id; treating as synced`, item._queue_id);
            supabaseError = null;
          } else {
            console.error(`❌ RPC ${item.table} LOGIC FAILED:`, data.error);
            supabaseError = { message: data.error };
          }
        } else {
          console.log(`✅ RPC ${item.table} SUCCESS:`, data);
        }
      }
    } catch (e) {
      supabaseError = { message: e.message };
    }

    if (supabaseError) {
      // Track failed queue IDs so dependents are skipped
      if (item._queue_id) failedQueueIds.add(item._queue_id);
      const errorMessage = getErrorMessage(supabaseError);
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          console.warn('[POS SYNC] Failed order', orderId, errorMessage);
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          });
        }
      }
      if (isPosVoidQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          console.warn('[POS VOID SYNC] Failed void', orderId, errorMessage);
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `POS void rejected by server: ${errorMessage}`
          });
          patchLocalPosVoidHistory(item?.data?.payload?.override_log_id, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          });
        }
      }
      // Mark inventory item creation failure in cache
      if (item?.type === 'rpc' && item?.table === 'create_inventory_item') {
        const inventoryItemId = getQueuedInventoryItemId(item);
        if (inventoryItemId) {
          console.warn('[INVENTORY SYNC] Failed create_inventory_item', inventoryItemId, errorMessage);
          patchCachedInventoryItemSyncState(inventoryItemId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          });
        }
      }
      // P1-13: mark rejected optimistic state for update/payment/status RPCs
      if (item.type === 'rpc' && ['update_booking', 'update_booking_status', 'update_booking_payment', 'add_booking_charge', 'delete_booking_charge', 'approve_booking_refund'].includes(item.table)) {
        const bookingId = item.data?.p_booking_id || item.data?.p_id || null;
        if (bookingId) {
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `${item.table} rejected by server: ${errorMessage}`
          });
        }
      }
      if (item.type === 'update' && item.table === 'pool_day_use') {
        const entryId = item.id || getQueuedDayUseEntryId(item);
        if (entryId) {
          patchCachedDayUseSyncState(entryId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `Day Use update rejected by server: ${errorMessage}`
          });
        }
      }
      // Handle booking creation failures (especially room conflicts)
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item);
        if (bookingId) {
          const isConflict = isRoomConflictError(errorMessage);
          console.warn('[BOOKING SYNC] Failed booking', bookingId, isConflict ? '(room conflict)' : '', errorMessage);
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          });
          // Notify renderer about booking conflict
          if (isConflict) {
            try {
              BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed()) {
                  win.webContents.send('booking:sync-conflict', {
                    bookingId,
                    error: 'This room is already booked for the selected dates.',
                    details: errorMessage
                  });
                }
              });
            } catch (e) {
              console.error('[BOOKING SYNC] Failed to notify renderer:', e);
            }
          }
        }
      }
      if (isConvertQuotationQueueItem(item)) {
        const quotationId = getSyncItemQuotationId(item);
        const localBookingId = item._local_booking_id || null;
        const isConflict = isRoomConflictError(errorMessage);
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            status: item._previous_status || 'accepted',
            converted_booking_id: null,
            _pending_sync: true,
            _pending_conversion: false,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          });
        }
        if (localBookingId) {
          patchCachedBookingSyncState(localBookingId, {
            _pending_sync: true,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          });
        }
      }
      const retryCount = (item.retryCount || 0) + 1;
      const manualReviewOnly = shouldManualReviewSyncItem(item, errorMessage) ||
      (isCreateBookingQueueItem(item) || isConvertQuotationQueueItem(item)) && isRoomConflictError(errorMessage) ||
      item.manualRetryOnly === true;
      const updatedItem = {
        ...item,
        _state: 'pending', // reset from in_flight
        retryCount: manualReviewOnly ? MAX_SYNC_RETRIES : retryCount,
        lastError: errorMessage,
        lastAttemptedAt: new Date().toISOString(),
        manualRetryOnly: manualReviewOnly
      };
      if (updatedItem.retryCount >= MAX_SYNC_RETRIES) {
        console.error(`[Sync] Dead-lettered after ${MAX_SYNC_RETRIES} attempts — ${item.type} ${item.table}:`, errorMessage);
        deadLetter.push(updatedItem);
      } else {
        console.warn(`[Sync] Failed (attempt ${updatedItem.retryCount}/${MAX_SYNC_RETRIES}) — ${item.type} ${item.table}:`, errorMessage);
        pending.push(updatedItem);
      }
      writeSyncQueue(pending);
    } else {
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[POS SYNC] Synced order', orderId);
        }
      }
      if (isPosVoidQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item);
        if (orderId) {
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _pending_void: false,
            _synced_at: new Date().toISOString()
          });
          patchLocalPosVoidHistory(item?.data?.payload?.override_log_id, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null
          });
          console.log('[POS VOID SYNC] Synced void', orderId);
        }
      }
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item);
        if (bookingId) {
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[BOOKING SYNC] Synced booking', bookingId);
        }
      }
      if (isConvertQuotationQueueItem(item)) {
        const quotationId = getSyncItemQuotationId(item);
        const localBookingId = item._local_booking_id || null;
        const serverBookingId = rpcResultData?.booking_id || rpcResultData?.id || null;
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            ...(serverBookingId ? { converted_booking_id: serverBookingId } : {}),
            _pending_sync: false,
            _pending_conversion: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
        }
        if (localBookingId) {
          replaceQueuedBookingReference(localBookingId, serverBookingId);
          if (serverBookingId) {
            for (let i = 0; i < pending.length; i += 1) {
              pending[i] = rewriteQueuedBookingReferenceItem(pending[i], localBookingId, serverBookingId);
            }
          }
          patchCachedBookingSyncState(localBookingId, {
            ...(serverBookingId ? { id: serverBookingId } : {}),
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
        }
      }
      // Mark inventory item creation success in cache
      if (item?.type === 'rpc' && item?.table === 'create_inventory_item') {
        const inventoryItemId = getQueuedInventoryItemId(item);
        if (inventoryItemId) {
          patchCachedInventoryItemSyncState(inventoryItemId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[INVENTORY SYNC] Synced inventory item', inventoryItemId);
        }
      }
      if (item.type === 'update' && item.table === 'pool_day_use') {
        const entryId = item.id || getQueuedDayUseEntryId(item);
        if (entryId) {
          patchCachedDayUseSyncState(entryId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
        }
      }
      if (queueItemNeedsInventoryRefresh(item)) shouldRefreshInventory = true;
      if (queueItemNeedsBookingRefresh(item)) shouldRefreshBookings = true;
      // P1-8: widen refresh to cover all domains touched by this operation
      if (item.type === 'rpc' && ['create_customer', 'update_customer'].includes(item.table)) shouldRefreshCustomers = true;
      if (item.table === 'rooms' || item.type === 'rpc' && item.table?.startsWith?.('update_room')) shouldRefreshRooms = true;
      if (item.type === 'rpc' && ['create_user', 'update_user_profile', 'set_user_pwa_access'].includes(item.table)) shouldRefreshUsers = true;
      if (item.type === 'rpc' && ['create_quotation', 'update_quotation', 'convert_quotation', 'convert_quotation_to_booking'].includes(item.table)) shouldRefreshQuotations = true;
      if (isPosCreateOrderQueueItem(item) || isPosVoidQueueItem(item)) shouldRefreshPosOrders = true;
      if (item.type === 'rpc' && ['create_conference_booking', 'update_conference_booking', 'delete_conference_booking'].includes(item.table)) shouldRefreshConference = true;
      if ((item.type === 'rpc' && ['add_pool_day_use', 'delete_pool_day_use'].includes(item.table)) || (item.type === 'update' && item.table === 'pool_day_use')) shouldRefreshPoolDayUse = true;
      // Phase 1: persist committed state before removing from queue file.
      // Crash here → restart sees 'committed' → skips RPC without retrying.
      writeSyncQueue([{ ...item, _state: 'committed' }, ...pending]);
      if (item._queue_id) completedQueueIds.add(item._queue_id);
      // Phase 2: remove item from queue
      successCount++;
      writeSyncQueue(pending);
    }
  }
  const syncFinishedAt = new Date().toISOString();
  console.log(`✅ Sync complete: ${successCount} success, ${pending.length} remaining`);
  if (successCount > 0) {
    state.lastSuccessfulSyncAt = syncFinishedAt;
    // P0-1: persist sync recency to disk so it survives restarts
    writeSyncMeta({
      lastSuccessfulSyncAt: syncFinishedAt,
      lastSyncFinishedAt: syncFinishedAt,
      lastSyncOutcome: deadLetter.length > 0 ? 'partial' : 'success',
      lastSyncError: deadLetter.length > 0 ? `${deadLetter.length} item(s) dead-lettered` : ''
    });
  } else if (deadLetter.length > 0) {
    writeSyncMeta({
      lastSyncFinishedAt: syncFinishedAt,
      lastSyncOutcome: 'failed',
      lastSyncError: `All ${deadLetter.length} item(s) dead-lettered with no successes`
    });
  } else {
    writeSyncMeta({ lastSyncFinishedAt: syncFinishedAt, lastSyncOutcome: 'empty' });
  }
  writeSyncQueue(pending);

  if (successCount > 0 && shouldRefreshInventory) {
    refreshCache('inventory-items', 'inventory-purchases').catch(() => {});
  }

  // P2-16: snapshot optimistic booking state before refresh so we can detect drift afterwards
  const preSyncBookingSnapshot = shouldRefreshBookings ?
  readCache('bookings').
  filter((b) => !b._pending_sync).
  reduce((map, b) => {
    map[b.id] = {
      total_amount: b.total_amount,
      amount_paid: b.amount_paid,
      customer_id: b.customer_id,
      room_id: b.room_id,
      status: b.status,
      payment_status: b.payment_status
    };
    return map;
  }, {}) :
  null;

  // P1-8: widen canonical post-sync refresh
  const refreshTargets = [];
  if (successCount > 0 && shouldRefreshBookings) refreshTargets.push('bookings');
  if (successCount > 0 && shouldRefreshCustomers) refreshTargets.push('customers');
  if (successCount > 0 && shouldRefreshRooms) refreshTargets.push('rooms');
  if (successCount > 0 && shouldRefreshUsers) refreshTargets.push('users');
  if (successCount > 0 && shouldRefreshQuotations) refreshTargets.push('quotations');
  if (successCount > 0 && shouldRefreshPosOrders) refreshTargets.push('pos-orders');
  if (successCount > 0 && shouldRefreshConference) refreshTargets.push('conference-bookings');
  if (successCount > 0 && shouldRefreshPoolDayUse) refreshTargets.push('pool-day-use');
  if (refreshTargets.length > 0) {
    await refreshCachesAfterSync(...refreshTargets);
  }

  // P2-16: compare post-refresh server values against pre-refresh optimistic state
  if (preSyncBookingSnapshot && successCount > 0) {
    try {
      const postSyncBookings = readCache('bookings');
      for (const b of postSyncBookings) {
        const pre = preSyncBookingSnapshot[b.id];
        if (!pre) continue;
        const drifts = [];
        if (!valuesEqualForDrift(pre.total_amount, b.total_amount)) drifts.push(`total_amount: local ${pre.total_amount} → server ${b.total_amount}`);
        if (!valuesEqualForDrift(pre.amount_paid, b.amount_paid)) drifts.push(`amount_paid: local ${pre.amount_paid} → server ${b.amount_paid}`);
        if (hasDriftBaselineValue(pre.customer_id) && !valuesEqualForDrift(pre.customer_id, b.customer_id)) drifts.push(`customer_id: local ${pre.customer_id} → server ${b.customer_id}`);
        if (hasDriftBaselineValue(pre.room_id) && !valuesEqualForDrift(pre.room_id, b.room_id)) drifts.push(`room_id: local ${pre.room_id} → server ${b.room_id}`);
        if (!valuesEqualForDrift(pre.status, b.status)) drifts.push(`status: local ${pre.status} → server ${b.status}`);
        if (!valuesEqualForDrift(pre.payment_status, b.payment_status)) drifts.push(`payment_status: local ${pre.payment_status} → server ${b.payment_status}`);
        if (drifts.length > 0) {
          appendHealthFault({
            type: 'booking_drift',
            scope: `booking:${b.id}`,
            severity: 'warn',
            message: `Post-sync drift on booking ${b.id}: ${drifts.join('; ')}`,
            context: { booking_id: b.id, drifts, invoice_number: b.invoice_number || null }
          });
          console.warn('[SYNC DRIFT]', b.id, drifts);
        }
      }
    } catch (driftError) {
      console.error('[Sync] Drift check failed:', driftError);
    }
  }

  if (deadLetter.length > 0) {
    const deadPath = path.join(state.cacheDir, 'sync-failed.json');
    const deadTmp = deadPath + '.tmp';
    let existing = [];
    try {existing = JSON.parse(fs.readFileSync(deadPath, 'utf-8'));} catch {/* empty */}
    try {
      fs.writeFileSync(deadTmp, JSON.stringify([...existing, ...deadLetter], null, 2), 'utf-8');
      fs.renameSync(deadTmp, deadPath);
    } catch (e) {
      console.error('[Sync] Dead-letter write failed:', e);
      try {fs.unlinkSync(deadTmp);} catch {/* ignore */}
    }
    for (const item of deadLetter) {
      console.error('[SYNC DEAD LETTER]', item);
    }
  }

  console.log(`[Sync] Done — ${successCount} synced, ${pending.length} retrying, ${deadLetter.length} dead-lettered`);

  broadcastSyncStatus();
}

export async function requeueEligibleFailedSyncItems(minAgeMs = DEAD_LETTER_AUTO_RETRY_AFTER_MS) {
  const failed = readFailedSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  if (failed.length === 0) return { retried: 0, remaining: 0 };

  const now = Date.now();
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const existingIds = new Set(queue.map((item) => item._queue_id));
  const keepFailed = [];
  const retryItems = [];

  for (const item of failed) {
    const attemptedAtMs = item.lastAttemptedAt ? Date.parse(item.lastAttemptedAt) : NaN;
    const shouldRetry = Number.isNaN(attemptedAtMs) || now - attemptedAtMs >= minAgeMs;
    if (item.manualRetryOnly === true || !shouldRetry) {
      keepFailed.push(item);
      continue;
    }

    const cleanItem = normalizeQueuedSyncItemForReplay({
      ...item,
      _state: 'pending',
      retryCount: 0,
      lastError: '',
      lastAttemptedAt: null
    });

    if (!existingIds.has(cleanItem._queue_id)) {
      queue.push(cleanItem);
      existingIds.add(cleanItem._queue_id);
    }

    if (isPosCreateOrderQueueItem(cleanItem)) {
      const orderId = getQueuedPosOrderId(cleanItem);
      if (orderId) {
        patchCachedPosOrderSyncState(orderId, {
          _sync_state: 'pending',
          _sync_error: null
        });
      }
    }

    retryItems.push(cleanItem);
  }

  if (retryItems.length === 0) return { retried: 0, remaining: failed.length };

  writeFailedSyncQueue(keepFailed);
  writeSyncQueue(queue);
  console.warn(`[Sync] Auto-requeued ${retryItems.length} dead-lettered item(s) for another attempt.`);
  broadcastSyncStatus();
  return { retried: retryItems.length, remaining: keepFailed.length };
}

export function queueOperation(type, table, data, id = null, meta = {}) {
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const derivedMeta = {
    ...(type === 'rpc' && table === 'create_quotation' && data?.payload?.id ?
    { _queue_id: `quotation-${data.payload.id}` } :
    {}),
    ...meta
  };
  // Guardrail: create_quotation defaults to _queue_id: `quotation-${record.id}`.
  const queuedItem = ensureQueuedItem({
    type,
    table,
    data,
    id,
    timestamp: new Date().toISOString(),
    ...derivedMeta
  }, type);

  // Deduplication: skip if an identical RPC with same idempotency key is already queued
  if (type === 'rpc' && data?.p_idempotency_key) {
    const existingItem = queue.find(
      (item) => item.type === 'rpc' &&
      item.table === table &&
      item.data?.p_idempotency_key === data.p_idempotency_key
    );
    if (existingItem?._queue_id) {
      console.warn('[SYNC QUEUE] Duplicate idempotent RPC detected — reusing existing queue item', {
        operation: table,
        _queue_id: existingItem._queue_id
      });
      return existingItem._queue_id;
    }
  }

  const hasSameQueueId = queue.some((item) => item._queue_id === queuedItem._queue_id);
  if (hasSameQueueId) {
    console.warn('[SYNC QUEUE] Duplicate _queue_id detected — skipping push', { _queue_id: queuedItem._queue_id, operation: queuedItem.table });
    return queuedItem._queue_id;
  }

  queue.push(queuedItem);
  writeSyncQueue(queue);
  return queuedItem._queue_id;
}
state.queueOperation = queueOperation;

function clearActivityLogForInfrastructure() {
  try {
    fs.writeFileSync(path.join(state.cacheDir, 'activity-log.json'), '[]', 'utf-8');
  } catch (e) {
    console.error('Clear activity log failed:', e);
  }
}

// ─── AUTO BACKUP ──────────────────────────────────────────────────────────────

export function createBackup() {
  try {
    if (!state.lodgeId) return;
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = path.join(backupDir, `backup-${ts}.json`);

    const users = readCache('users').map(({ password_hash, ...u }) => u);

    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      lodge_id: state.lodgeId,
      tables: {
        rooms: readCache('rooms'),
        customers: readCache('customers'),
        bookings: readCache('bookings'),
        users,
        settings: readCache('settings')
      }
    };

    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    const files = fs.readdirSync(backupDir).
    filter((f) => f.startsWith('backup-') && f.endsWith('.json')).
    sort().
    reverse();
    for (const old of files.slice(10)) {
      try {fs.unlinkSync(path.join(backupDir, old));} catch {/* ignore */}
    }

    console.log(`Auto-backup saved: ${backupPath}`);
    return backupPath;
  } catch (e) {
    console.error('Auto-backup failed:', e);
    return null;
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

export async function initDatabase() {
  if (state._initialized) {
    console.warn('[DB] initDatabase called more than once — skipping')
    return
  }
  state.cacheRootDir = path.join(app.getPath('userData'), 'boroko-cache');
  state.profilesCacheDir = path.join(state.cacheRootDir, 'profiles');
  await initializeProfileRuntime();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'VITE_SUPABASE_URL or VITE_SUPABASE_KEY is missing.\n' +
      'Create a root .env file with both variables, then re-run the app.\n' +
      'See .env.example for the required format.'
    );
  }
  state.supabase = buildSupabaseClient(SUPABASE_ANON_KEY);

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey) {
    state.adminDb = buildSupabaseClient(serviceKey);
    console.log('[Auth] SUPABASE_SERVICE_ROLE_KEY found — Command Central admin mode enabled');
  } else {
    state.adminDb = null;
    console.log('[Auth] No SUPABASE_SERVICE_ROLE_KEY — running in lodge-only mode');
  }

  // P0-1: restore persisted sync recency so System Health has real data immediately
  if (state.cacheDir) {
    const meta = readSyncMeta();
    if (meta.lastSuccessfulSyncAt && !state.lastSuccessfulSyncAt) {
      state.lastSuccessfulSyncAt = meta.lastSuccessfulSyncAt;
    }
  }

  // P0-5: replayAuthReady stays false until a real user logs in.
  // Startup sync is intentionally skipped — we must not replay queued financial
  // operations before the correct Supabase client is authenticated.
  let online = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    online = await checkOnline();
    if (online) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
  }
  if (online && state.lodgeId) {
    // Only refresh caches at startup (safe read-only — does not replay writes)
    await refreshAllCaches();
    console.log('Connected to Supabase ✓ (replay deferred until user authenticates)');
  } else {
    console.log('Running in offline mode — using cached data');
  }

  if (!state.backupIntervalStarted) {
    state.backupIntervalStarted = true;

    createBackup();
    setInterval(() => createBackup(), 60 * 60 * 1000);

    // Reconnect detection: fires sync on network return
    setInterval(async () => {
      if (state.connectivityCheckInProgress) return;
      state.connectivityCheckInProgress = true;
      try {
        const wasOffline = !state.isOnline;
        const nowOnline = await checkOnline();
        const hasPendingSync = readSyncQueue().length > 0 || readFailedSyncQueue().some((item) => item?.manualRetryOnly !== true);
        if (nowOnline && state.lodgeId && state.replayAuthReady && (wasOffline || hasPendingSync)) {
          console.log('Back online — syncing changes...');
          await requeueEligibleFailedSyncItems();
          await processSyncQueue();
          if (wasOffline) await refreshAllCaches();
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[Sync] Reconnect sync timer failed:', error);
        appendHealthFault({
          type: 'sync_timer_error',
          scope: 'reconnect',
          severity: 'error',
          message,
          at: new Date().toISOString()
        });
        writeSyncMeta({
          lastSyncFinishedAt: new Date().toISOString(),
          lastSyncOutcome: 'timer_error',
          lastSyncError: message
        });
      } finally {
        state.connectivityCheckInProgress = false;
      }
    }, CONNECTIVITY_CHECK_INTERVAL_MS);

    // P0-6: Periodic sync — ensures retryable dead letters are replayed even when
    // the app never transitions offline→online (i.e., stays continuously online).
    setInterval(async () => {
      try {
        if (!state.isOnline || !state.lodgeId || !state.replayAuthReady) return;
        await requeueEligibleFailedSyncItems();
        if (readSyncQueue().length > 0) {
          await processSyncQueue();
        }
      } catch (error) {
        const message = getErrorMessage(error);
        console.error('[Sync] Periodic sync timer failed:', error);
        appendHealthFault({
          type: 'sync_timer_error',
          scope: 'periodic',
          severity: 'error',
          message,
          at: new Date().toISOString()
        });
        writeSyncMeta({
          lastSyncFinishedAt: new Date().toISOString(),
          lastSyncOutcome: 'timer_error',
          lastSyncError: message
        });
      }
    }, PERIODIC_SYNC_INTERVAL_MS);
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

// ─── LOCAL TRUSTED DEVICE CACHE ───────────────────────────────────────────────
// The app no longer treats this device as a password verifier. Offline access is
// restored through the signed-in session nonce below; legacy password hashes are
// kept only so older installs can be diagnosed and phased out safely.

// ─── SESSION NONCE (anti-impersonation) ─────────────────────────────────────
// A random nonce generated on successful login, persisted to a file only the
// main process can read. restoreUserSession() requires the correct nonce to
// prove the renderer legitimately logged in on a prior run.
// Identity is derived from the nonce file — the renderer cannot influence it.

// Offline-first front desks need a trusted device session that survives normal
// connectivity gaps without rechecking a password against Supabase every week.

export { loginUser } from './authLogin.js';

// ─── USERS ────────────────────────────────────────────────────────────────────

export {
  createUser,
  deleteUser,
  getAuthStatus,
  resetUserPassword,
  runAuthHealthCheck,
  updateUser
} from './authUsers.js';

// ─── ROOMS ────────────────────────────────────────────────────────────────────
// ─── CUSTOMERS ────────────────────────────────────────────────────────────────
// ─── BOOKINGS ─────────────────────────────────────────────────────────────────

// ─── EVENT / LODGE BOOKING ────────────────────────────────────────────────────

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

// ─── BOOKING CHARGES (FOLIO) ──────────────────────────────────────────────────

// ─── RATE OVERRIDES (SEASONAL / WEEKEND PRICING) ──────────────────────────────

// ─── EXPENSES ─────────────────────────────────────────────────────────────────

// ─── MAINTENANCE TICKETS ──────────────────────────────────────────────────────



// ─── ID PHOTO ─────────────────────────────────────────────────────────────────

// ─── FORECAST ─────────────────────────────────────────────────────────────────

// ─── POS (POINT OF SALE) ──────────────────────────────────────────────────────

// ─── INVENTORY ────────────────────────────────────────────────────────────────

// ─── ROOM SUPPLIES ────────────────────────────────────────────────────────────




// ─── ANALYTICS & COST REPORTS ────────────────────────────────────────────────

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

// ─── INVOICES ────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// QUOTATIONS
// ─────────────────────────────────────────────────────────────────────────────

// Tax helper — rate is a percentage (e.g. 14 = 14%). Default 0.
// Lightweight: only transitions draft → sent. Safe to call multiple times.
// ── Data Import ───────────────────────────────────────────────────────────────
