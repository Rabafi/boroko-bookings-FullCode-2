import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { clearPosSubmitAttempt, commitPosSubmitAttempt, reopenPosSubmitAttempt } from './posSubmitJournal.js';
import { getRoleCapabilities, normalizeAppRole } from "../../shared/accessControl.js";
import { FINANCIAL_SYNC_TABLES, isFinancialSyncItem, pickNextReadySyncItemIndex } from "../../shared/syncQueue.js";
export { FINANCIAL_SYNC_TABLES, isFinancialSyncItem };
import { getBackupHealthSummary, getBackupInfoForHealth } from './backupHealth.js';
import { ensureDir, readJsonFile, writeJsonFile } from './fileStore.js';
import {
  SYNC_DRIFT_FAULT_TYPES,
  appendOperationJournalEntry,
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
  collectNewDiskQueueArrivals,
  ensureQueuedItem,
  getQueuedDayUseEntryId,
  getQueuedInventoryItemId,
  getQueuedPosOrderId,
  getSyncItemBookingId,
  getSyncItemScope,
  isInventoryAdjustmentQueueItem,
  isInventoryItemQueueItem,
  isPosCreateOrderQueueItem,
  adaptLegacyPosOrderFinancialPayload,
  isPosVoidQueueItem,
  mergeDeadLetterQueues,
  normalizeQueuedSyncItemForReplay,
  rewritePendingProductReferences,
  resolveCurrentOpenShiftId
} from './syncShared.js';
import {
  DEBUG_CACHE_FALLBACKS,
  clearCache,
  readCache,
  writeCache,
  dedupePromise
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
import { initializeProfileRuntime } from './profiles.js';
import {
  applyOfflinePosInventoryReservation,
  applyQueuedPosInventoryReservations,
  getOfflinePosInventoryReservation,
  patchLocalPosVoidHistory,
  readLocalPosVoidHistory,
  refreshOfflinePosInventoryProjection,
  restoreOfflinePosInventoryReservation,
  upsertLocalPosVoidHistory
} from './posOffline.js';
import { mergeRemoteBookingsWithLocalState } from './bookingMerge.js';
import { mergeRemotePosOrdersWithLocalState } from './posMerge.js';
import { protectQueuedRpcData, resolveQueuedRpcData } from './secureQueueSecrets.js';
import {
  getSyncItemQuotationId,
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
  appendOperationJournalEntry,
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
  collectNewDiskQueueArrivals,
  ensureQueuedItem,
  getQueuedInventoryItemId,
  getQueuedPosOrderId,
  getSyncItemBookingId,
  getSyncItemScope,
  isInventoryAdjustmentQueueItem,
  isInventoryItemQueueItem,
  isPosCreateOrderQueueItem,
  adaptLegacyPosOrderFinancialPayload,
  isPosVoidQueueItem,
  mergeDeadLetterQueues,
  normalizeQueuedSyncItemForReplay
} from './syncShared.js';
export {
  DEBUG_CACHE_FALLBACKS,
  clearCache,
  readCache,
  writeCache,
  dedupePromise
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
  patchLocalPosVoidHistory,
  readLocalPosVoidHistory,
  refreshOfflinePosInventoryProjection,
  removeLocalPosVoidHistory,
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
const CONNECTIVITY_CHECK_INTERVAL_MS = 60000;
const PERIODIC_SYNC_INTERVAL_MS = 120000;
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
  restoreCurrentTrustedSession,
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
  if (['update_booking', 'update_campsite_booking', 'reschedule_accommodation_booking'].includes(item?.table)
    && isBookingUpdateConflictError(errorMessage)) return true;
  // Tab version/ownership conflicts can never converge by retrying the same
  // bytes: two terminals changed the same tab, or it already settled. They
  // go straight to manager review with the server's message intact.
  if ((item?.table === 'upsert_pos_tab' || item?.table === 'create_pos_order_v3' || item?.table === 'update_pos_tab_status')
    && /tab_version_conflict|tab_version_required|tab_not_owned|tab_already_settled/i.test(String(errorMessage || ''))) return true;
  // POS void terminal outcomes go straight to manager review for the same
  // reason (see isTerminalPosVoidFailure): identical bytes can never succeed.
  if (isTerminalPosVoidFailure(item, errorMessage)) return true;
  return false;
}

// POS void terminal outcomes: the server checks the order row BEFORE any PIN
// or state validation, so `Order not found` (and the settled refusal below)
// is deterministic and PIN-independent — replaying identical bytes can never
// succeed, no matter how often the queue or the 30-minute auto-requeue
// retries it. These dead-letter as manual-review-only (never auto-retried,
// never silently dropped) with the server message intact, staying visible in
// the System Health failed queue until a manager retries or clears them.
// `Order is already voided` is NOT terminal here: it is the desired end state
// and is consumed as synced by isAlreadyAppliedRpcError instead.
// POS replay ambiguity gate: only a truly uncertain replay outcome may reopen
// the submit journal to pending (Till banner + new-sale block). A definitive
// server refusal proves the attempt did NOT commit (same rule as the online
// path's outcomeMayStillBeAmbiguous), so the journal is cleared instead: the
// Till stays sellable, while the local failed row + dead-letter remain for
// review. Retrying identical definitive bytes can never succeed until the
// cause is fixed (stock added, catalog refreshed), so parking them as
// uncertain stacked 38 blocking banners from one bar night.
export function isAmbiguousPosOrderReplayError(message = '') {
  return /fetch failed|network|timeout|timed out|ambiguous|uncertain|till_operator_|till_shift_closed|shift_not_open|pos_submit_recovery_required|idempotency_conflict|idempotency_expired|statement timeout|canceling statement|connection|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(String(message || ''));
}

function isTerminalPosVoidFailure(item, errorMessage = '') {
  if (item?.type !== 'rpc' || item?.table !== 'approve_pos_void_with_pin') return false;
  return /Order not found|Cannot void a settled order/i.test(String(errorMessage || ''));
}

function isCreateBookingQueueItem(item) {
  return item?.type === 'rpc' && [
    'create_booking',
    'create_campsite_booking',
    'create_multi_room_booking'
  ].includes(item?.table);
}

function isConvertQuotationQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'convert_quotation_to_booking';
}

function isCreateQuotationQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'create_quotation';
}

function isUpdateQuotationQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'update_quotation';
}

function isMarkQuotationSentQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'mark_quotation_sent';
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

function getQueuedBookingIds(item) {
  const groupIds = Array.isArray(item?._local_booking_ids) ?
    item._local_booking_ids.map((value) => String(value || '').trim()).filter(Boolean) : [];
  const singleId = groupIds.length > 0 ? null : getQueuedBookingId(item);
  return [...new Set([...groupIds, ...(singleId ? [singleId] : [])])];
}

function patchQueuedBookingSyncStates(item, patch = {}) {
  for (const bookingId of getQueuedBookingIds(item)) {
    patchCachedBookingSyncState(bookingId, patch);
  }
}

function rewriteQueuedEntityReference(pending = [], localId, serverId, { fieldNames = [], dependsPrefix = '' } = {}) {
  if (!localId || !serverId || localId === serverId) return pending;
  return pending.map((item) => {
    let changed = false;
    const next = { ...item, data: { ...(item?.data || {}) } };
    for (const field of fieldNames) {
      if (next.data[field] === localId) {
        next.data[field] = serverId;
        changed = true;
      }
      if (next.data.payload?.[field] === localId) {
        next.data.payload = { ...(next.data.payload || {}), [field]: serverId };
        changed = true;
      }
    }
    if (dependsPrefix && next._depends_on === `${dependsPrefix}-${localId}`) {
      next._depends_on = `${dependsPrefix}-${serverId}`;
      changed = true;
    }
    return changed ? next : item;
  });
}

function isRoomConflictError(message = '') {
  return /no_overlapping_bookings|room is already booked|room is not available|room.*conflict/i.test(String(message || ''));
}

function isQuotationNumberConflict(message = '') {
  return /quotations_lodge_id_quotation_number_key|duplicate key value/i.test(String(message || ''));
}

function getNextQuotationNumberAfterLocal(currentNumber) {
  const match = String(currentNumber || '').match(/^(Q-\d{4}-)(\d+)$/);
  if (!match) return currentNumber;
  const [, prefix, seq] = match;
  return `${prefix}${String(Number(seq) + 1).padStart(seq.length, '0')}`;
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
    'create_campsite_booking',
    'create_multi_room_booking',
    'create_booking_invoice_group',
    'update_booking',
    'update_campsite_booking',
    'reschedule_booking',
    'reschedule_accommodation_booking',
    'update_booking_status',
    'update_booking_payment',
    'add_booking_charge',
    'delete_booking_charge',
    'apply_customer_credit_to_booking',
    'create_booking_record',
    'convert_quotation_to_booking']
    ).has(item.table);
  }
  return item?.table === 'bookings';
}

function queueItemNeedsInventoryRefresh(item) {
  // create_inventory_item: always refresh so the local pending-sync item is
  // replaced by the definitive server row (with the confirmed UUID).
  if (item?.type === 'rpc' && [
    'create_inventory_item',
    'update_inventory_item',
    'delete_inventory_item',
    'add_inventory_purchase',
    'create_inventory_stocktake_session',
    'save_inventory_stocktake_counts',
    'post_inventory_stocktake_session',
    'post_bar_physical_count',
    'post_bar_simple_delivery'
  ].includes(item?.table)) return true;
  if (isInventoryAdjustmentQueueItem(item)) return true;
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

function queueItemNeedsSupplyRefresh(item) {
  return item?.type === 'rpc' && [
    'create_supply_item',
    'update_supply_item',
    'delete_supply_item',
    'add_supply_purchase',
    'adjust_supply_stock',
    'save_room_supply_allocations',
    'load_supply_to_room',
    'use_room_supply_stock',
    'return_room_supply_to_store',
    'create_supply_stocktake_session',
    'create_room_supply_stocktake_session',
    'save_supply_stocktake_counts',
    'save_room_supply_stocktake_counts',
    'post_supply_stocktake_session',
    'post_room_supply_stocktake_session',
    'create_room_supply_stocktake_line'
  ].includes(item.table);
}

function queueItemNeedsRateOverrideRefresh(item) {
  return item?.type === 'rpc' && [
    'create_room_rate_override',
    'update_room_rate_override',
    'delete_room_rate_override'
  ].includes(item.table);
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
  // save_bar_product_with_stock: a duplicate-name refusal means a DIFFERENT
  // operation key already created this product/stock server-side, so the work
  // this queued item represents is resolved elsewhere — consume it as synced
  // instead of dead-lettering an unfailing retry loop. Barcode and
  // operation-key conflicts use different message shapes and stay reviewable.
  if (item?.table === 'save_bar_product_with_stock' &&
      /^A (?:product|stock item) named /i.test(String(message || ''))) {
    return true;
  }
  // approve_pos_void_with_pin: the order is already voided server-side, which
  // is exactly the end state this item wanted (e.g. voided from another
  // terminal, or an ambiguous-timeout retry after the void landed). Consume
  // as synced instead of retrying a refusal that can never clear. Placed
  // before the payload-id gate on purpose: void items carry order_id inside
  // the payload, not a top-level id.
  if (item?.table === 'approve_pos_void_with_pin' && /Order is already voided/i.test(String(message || ''))) {
    return true;
  }
  // For create_quotation, a 23505 on the quotation_number unique constraint means
  // a DIFFERENT quotation with the same number exists — not that THIS quotation
  // was already applied. Only treat it as already-applied if the error references
  // the quotation's own ID (UUID), not the number constraint.
  if (isCreateQuotationQueueItem(item)) {
    if (/quotations_lodge_id_quotation_number_key/i.test(message)) return false;
  }
  const payloadId = item?.data?.payload?.id || item?.data?.p_booking_id || item?.data?.p_quotation_id || null;
  if (!payloadId) return false;

  const code = String(errorOrMessage?.code || '').trim();
  return SYNC_ALREADY_APPLIED_CODES.has(code) ||
  /duplicate key|unique constraint|already exists|already applied|23505/i.test(message);
}

// ─── Replay write fence (P0-1) + incremental dead-letter persistence (P0-2) ───
// _runSyncQueue holds `pending` in memory while awaiting RPCs. A sale rung
// mid-replay runs queueOperation synchronously during that await: it reads the
// on-disk queue (which still shows the in-flight item) and appends safely.
// The replay loop must therefore merge unknown on-disk arrivals before every
// whole-file write — otherwise its stale in-memory snapshot silently erases
// the new sale. The in-memory set stays authoritative for replay decisions;
// disk arrivals are only appended, never reordered or deduplicated beyond id.
// Pure merge helpers live in syncShared.js (importable without Electron) and
// are re-exported via the syncShared export block above.
export function absorbNewDiskQueueArrivals(pending = [], { completedQueueIds = new Set(), deadLetter = [], inFlightItem = null } = {}) {
  let disk = [];
  try {
    disk = readSyncQueue();
  } catch {
    return 0;
  }
  if (!Array.isArray(disk) || disk.length === 0) return 0;
  const deadIds = new Set((Array.isArray(deadLetter) ? deadLetter : []).map((entry) => entry?._queue_id).filter(Boolean));
  const arrivals = collectNewDiskQueueArrivals(pending, disk, {
    completedIds: completedQueueIds,
    deadIds,
    inFlightId: inFlightItem?._queue_id || null
  });
  for (const arrival of arrivals) pending.push(arrival);
  if (arrivals.length > 0) {
    console.log(`[Sync] Preserved ${arrivals.length} operation(s) queued during replay`);
  }
  return arrivals.length;
}

function writeReplayQueue(pending = [], { inFlightItem = null, completedQueueIds = new Set(), deadLetter = [] } = {}) {
  absorbNewDiskQueueArrivals(pending, { completedQueueIds, deadLetter, inFlightItem });
  if (inFlightItem) {
    writeSyncQueue([{ ...inFlightItem, _state: 'in_flight' }, ...pending]);
  } else {
    writeSyncQueue(pending);
  }
}

// Dead letters must survive a crash mid-replay. The loop previously kept them
// in memory and wrote sync-failed.json only at run end, so a crash dropped
// them from both operational queues (journal kept a trace, but System Health
// reads sync-failed.json). Persist each dead letter incrementally; the run-end
// flush below is a deduped upsert so it cannot duplicate or resurrect clears
// made concurrently from review surfaces beyond re-showing them for review.
export function persistDeadLetterIncrementally(deadItem) {
  if (!deadItem || typeof deadItem !== 'object') return;
  try {
    writeFailedSyncQueue(mergeDeadLetterQueues(readFailedSyncQueue(), [deadItem]));
  } catch (error) {
    console.error('[Sync] Incremental dead-letter persist failed (will retry at run end):', error?.message || error);
  }
}

export async function processSyncQueue() {
  if (state.syncQueuePromise) return state.syncQueuePromise;
  // P0-5: Never replay queued operations before a real user session is confirmed.
  // Offline financial RPCs carry lodge-scoped auth; replaying them before the
  // correct Supabase client/session is restored can poison data or fail silently.
  if (!state.replayAuthReady) {
    console.warn('[Sync] processSyncQueue skipped — replayAuthReady is false (no authenticated session yet)');
    writeSyncMeta({ replayAuthNotReadyAt: new Date().toISOString() });
    return { success: false, skipped: true, error: 'No authenticated session — please log in first.' };
  }
  state.syncInProgress = true;
  state.syncQueuePromise = (async () => {
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
      state.syncQueuePromise = null;
      broadcastSyncStatus();
    }
  })();
  return state.syncQueuePromise;
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
  let shouldRefreshBookingsAfterFailure = false;
  let shouldRefreshBookingGroups = false;
  let shouldRefreshInventory = false;
  let shouldRefreshCustomers = false;
  let shouldRefreshRooms = false;
  let shouldRefreshUsers = false;
  let shouldRefreshQuotations = false;
  let shouldRefreshPosOrders = false;
  let shouldRefreshPosShifts = false;
  let shouldRefreshPosMenu = false;
  let shouldRefreshConference = false;
  let shouldRefreshPoolDayUse = false;
  let shouldRefreshExpenses = false;
  let shouldRefreshMaintenance = false;
  let shouldRefreshSupplies = false;
  let shouldRefreshRateOverrides = false;

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
        appendOperationJournalEntry('blocked', blockedItem, {
          financial: isFinancialSyncItem(blockedItem),
          message: blockedItem.lastError
        });
        deadLetter.push(blockedItem);
        persistDeadLetterIncrementally(blockedItem);
      }
      writeReplayQueue(pending, { completedQueueIds, deadLetter });
      break;
    }

    const [item] = pending.splice(nextIndex, 1);
    // Skip items whose parent operation failed this run. A parent that failed
    // but later succeeded in the same run must not keep blocking its
    // children: the failed id lingers in failedQueueIds, so only treat it as
    // blocking while it has NOT also completed.
    const dependencyIds = [...new Set([
      item?._depends_on,
      ...(Array.isArray(item?._depends_on_all) ? item._depends_on_all : [])
    ].map((value) => String(value || '').trim()).filter(Boolean))];
    const failedDependencyId = dependencyIds.find((dependencyId) => failedQueueIds.has(dependencyId) && !completedQueueIds.has(dependencyId));
    if (failedDependencyId) {
      console.warn('[SYNC SKIPPED DEPENDENT]', { operation: item.table, queueId: item._queue_id, dependsOn: failedDependencyId });
      // A skip behind a parent that can never replay again is permanent: the
      // parent dead-lettered manual-only in this run, was already
      // manual-only from a prior run, or is gone entirely (e.g. cleared by a
      // manager after review). Park the child as manual-review-only instead
      // of burning retries and 30-minute auto-requeues on it forever. A
      // parent that is still pending (retried later in this run) or only
      // retryably dead (its own auto-retry is still scheduled) keeps the
      // child retryable so normal ordering still converges.
      const parentDeadThisRun = deadLetter.find((row) => row?._queue_id === failedDependencyId);
      const parentPrior = _priorDeadLetter.find((row) => row?._queue_id === failedDependencyId);
      const parentStillPending = pending.some((queued) => queued?._queue_id === failedDependencyId);
      const parentUnresolvable = !parentStillPending
        && (parentDeadThisRun?.manualRetryOnly === true
          || parentPrior?.manualRetryOnly === true
          || (!parentDeadThisRun && !parentPrior));
      const retryCount = parentUnresolvable ? MAX_SYNC_RETRIES : (item.retryCount || 0) + 1;
      const skipped = { ...item, _state: 'pending', retryCount, lastError: parentUnresolvable ? `Skipped: parent operation ${failedDependencyId} can no longer succeed; manager review required` : 'Skipped: parent operation failed', lastAttemptedAt: new Date().toISOString(), ...(parentUnresolvable ? { manualRetryOnly: true } : {}) };
      appendOperationJournalEntry('blocked', skipped, {
        financial: isFinancialSyncItem(skipped),
        message: skipped.lastError
      });
      if (isPosCreateOrderQueueItem(item)) {
        shouldRefreshInventory = true;
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
      // Also mark every local child as failed if a booking-create parent failed.
      // A multi-room group is one queue intent but has several display rows.
      if (isCreateBookingQueueItem(item)) {
        const bookingIds = getQueuedBookingIds(item);
        for (const bookingId of bookingIds) {
          console.warn('[BOOKING SYNC] Failed booking', bookingId, 'Skipped: parent operation failed');
        }
        patchQueuedBookingSyncStates(item, {
          _pending_sync: true,
          _sync_state: 'failed',
          _sync_error: 'Skipped: parent operation failed'
        });
      }
      if (retryCount >= MAX_SYNC_RETRIES) {
        deadLetter.push(skipped);
        persistDeadLetterIncrementally(skipped);
      } else {
        pending.push(skipped);
      }
      writeReplayQueue(pending, { completedQueueIds, deadLetter });
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
    // Merge-with-disk first: a sale queued during the previous RPC await must
    // survive this write (P0-1 replay write fence).
    writeReplayQueue(pending, { inFlightItem: item, completedQueueIds, deadLetter });

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
        const replayData = resolveQueuedRpcData(item.data);
        // Weeks-old offline work replays under today's open shift, never the
        // long-closed originating shift: the server requires an OPEN shift
        // for tab saves and order settlement (tab opening shift stays history,
        // settlement attributes to the paying shift by server design). The
        // waiter, outlet, amounts and timestamps are never rewritten.
        if (item.table === 'upsert_pos_tab' || item.table === 'create_pos_order_v3') {
          try {
            const replayPayload = replayData?.payload || {};
            const waiterId = String(replayPayload.waiter_id || replayPayload.cashier_id || '').trim() || null;
            const outletId = replayPayload.outlet_id || null;
            const openShiftId = resolveCurrentOpenShiftId(readCache('pos-shifts'), { outletId, cashierId: waiterId });
            if (openShiftId && String(replayPayload.shift_id || '') !== String(openShiftId)) {
              replayPayload.shift_id = openShiftId;
              appendOperationJournalEntry('replay_shift_rewritten', item, {
                message: `Replay attributed to current open shift ${openShiftId} (originating shift closed during outage).`
              });
            }
          } catch {
            /* Shift lookup is best-effort; the server error stays actionable. */
          }
        }
        // A weeks-old operator proof cannot be revalidated: the replay
        // authenticates as the current desktop session instead. Fresh
        // interactive sales always mint their own proof and are untouched.
        if (item.table === 'create_pos_order_v3' && replayData?.payload) {
          delete replayData.payload._operator_proof;
        }
        // Older desktop builds queued menu updates and plain clock-outs under
        // their non-idempotent RPC names. Replay those legacy rows through the
        // forward wrappers with a deterministic operation key derived from the
        // persisted queue identity; never mint a fresh key on retry/timeout.
        let replayRpc = item.table;
        let authoritativeReplayData = replayData;
        if (item.table === 'update_pos_menu_item') {
          const legacyPayload = replayData?.payload || {};
          const operationKey = legacyPayload.operation_key ||
            `legacy-menu-update:${item._queue_id || replayData?.p_id || 'unknown'}`;
          authoritativeReplayData = {
            payload: {
              ...legacyPayload,
              lodge_id: replayData?.p_lodge_id || legacyPayload.lodge_id || state.lodgeId,
              menu_item_id: replayData?.p_id || legacyPayload.menu_item_id,
              operation_key: operationKey
            }
          };
          replayRpc = 'update_pos_menu_item_offline';
        } else if (item.table === 'clock_out_staff') {
          const legacyPayload = replayData?.payload || {};
          const operationKey = legacyPayload.idempotency_key ||
            `legacy-clock-out:${item._queue_id || legacyPayload.shift_id || 'unknown'}`;
          authoritativeReplayData = {
            payload: {
              ...legacyPayload,
              lodge_id: legacyPayload.lodge_id || state.lodgeId,
              idempotency_key: operationKey
            }
          };
          replayRpc = 'clock_out_staff_offline';
        }
        const { data, error } = await state.supabase.rpc(replayRpc, authoritativeReplayData);
        rpcResultData = data || null;
        if (error) {
          if (isAlreadyAppliedRpcError({ ...item, table: replayRpc }, error)) {
            console.warn(`↻ RPC ${replayRpc} already applied remotely for queued id; treating as synced`, item._queue_id);
            supabaseError = null;
          } else {
            console.error(`❌ RPC ${replayRpc} FAILED:`, error);
            supabaseError = error;
          }
        } else if (data && data.success === false) {
          if (isAlreadyAppliedRpcError({ ...item, table: replayRpc }, data.error)) {
            console.warn(`↻ RPC ${replayRpc} reported duplicate for queued id; treating as synced`, item._queue_id);
            supabaseError = null;
          } else {
            console.error(`❌ RPC ${replayRpc} LOGIC FAILED:`, data.error);
            supabaseError = { message: data.error };
          }
        } else {
          console.log(`✅ RPC ${replayRpc} SUCCESS:`, data);
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
        shouldRefreshInventory = true;
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
      if (isInventoryAdjustmentQueueItem(item)) {
        const inventoryItemId = item?.data?.p_item_id || null;
        if (inventoryItemId) {
          console.warn('[INVENTORY SYNC] Failed adjust_inventory_stock', inventoryItemId, errorMessage);
          patchCachedInventoryItemSyncState(inventoryItemId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          });
        }
      }
      // P1-13: mark rejected optimistic state for update/payment/status RPCs
      if (item.type === 'rpc' && ['update_booking', 'update_campsite_booking', 'reschedule_booking', 'reschedule_accommodation_booking', 'update_booking_status', 'update_booking_payment', 'add_booking_charge', 'delete_booking_charge', 'approve_booking_refund'].includes(item.table)) {
        const bookingId = item.data?.p_booking_id || item.data?.p_id || null;
        if (bookingId) {
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `${item.table} rejected by server: ${errorMessage}`
          });
          if (item.table === 'update_booking_payment') {
            shouldRefreshBookingsAfterFailure = true;
          }
        }
      }
      if ((item.type === 'update' && item.table === 'pool_day_use') || (item.type === 'rpc' && item.table === 'update_pool_day_use')) {
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
        const bookingIds = getQueuedBookingIds(item);
        const isConflict = isRoomConflictError(errorMessage);
        for (const bookingId of bookingIds) {
          console.warn('[BOOKING SYNC] Failed booking', bookingId, isConflict ? '(room conflict)' : '', errorMessage);
        }
        patchQueuedBookingSyncStates(item, {
          _pending_sync: true,
          _sync_state: isConflict ? 'sync_failed' : 'failed',
          _sync_error: errorMessage
        });
        // Notify renderer about every affected child in a failed group.
        if (isConflict && bookingIds.length > 0) {
          try {
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.isDestroyed()) {
                for (const bookingId of bookingIds) {
                  win.webContents.send('booking:sync-conflict', {
                    bookingId,
                    error: 'This room is already booked for the selected dates.',
                    details: errorMessage
                  });
                }
              }
            });
          } catch (e) {
            console.error('[BOOKING SYNC] Failed to notify renderer:', e);
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
      if (isCreateQuotationQueueItem(item)) {
        const quotationId = getQueuedQuotationId(item);
        if (isQuotationNumberConflict(errorMessage) && item?.data?.payload?.quotation_number) {
          const bumped = getNextQuotationNumberAfterLocal(item.data.payload.quotation_number);
          console.warn('[QUOTATION SYNC] Number conflict, bumping quotation number', item.data.payload.quotation_number, '->', bumped);
          item.data.payload.quotation_number = bumped;
          patchCachedQuotationSyncState(quotationId, {
            _pending_sync: true,
            _sync_state: 'pending',
            _sync_error: null,
            quotation_number: bumped
          });
        } else if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          });
          console.warn('[QUOTATION SYNC] Failed create quotation', quotationId, errorMessage);
        }
      }
      if (isUpdateQuotationQueueItem(item)) {
        const quotationId = getQueuedQuotationId(item);
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `update_quotation rejected by server: ${errorMessage}`
          });
          console.warn('[QUOTATION SYNC] Failed update quotation', quotationId, errorMessage);
        }
      }
      if (isMarkQuotationSentQueueItem(item)) {
        const quotationId = getQueuedQuotationId(item);
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `mark_quotation_sent rejected by server: ${errorMessage}`
          });
          console.warn('[QUOTATION SYNC] Failed mark quotation sent', quotationId, errorMessage);
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
        appendOperationJournalEntry('dead_lettered', updatedItem, {
          financial: isFinancialSyncItem(updatedItem),
          message: errorMessage
        });
        deadLetter.push(updatedItem);
        persistDeadLetterIncrementally(updatedItem);
        // A dead provisional order replay reached a dead end. Ambiguous
        // outcomes (timeout/network/till/shift/idempotency) reopen the journal
        // so manager recovery surfaces them; definitive refusals (insufficient
        // stock, catalog snapshot, validation) clear it so the Till is not
        // blocked by a sale the server proved was never recorded. Either way
        // the local failed row + dead-letter stay visible for review.
        if (isPosCreateOrderQueueItem(updatedItem)) {
          const deadIntentId = String(updatedItem?.data?.payload?.submit_intent_id || '').trim();
          if (deadIntentId) {
            if (isAmbiguousPosOrderReplayError(errorMessage)) reopenPosSubmitAttempt(deadIntentId, errorMessage);
            else clearPosSubmitAttempt(deadIntentId);
          }
          // A dead tab settlement must not leave the local tab marked closed:
          // reopen the local row so Open Tabs shows it as failed and retryable.
          const deadTabId = String(updatedItem?.data?.payload?.tab_id || '').trim();
          if (deadTabId) {
            try {
              const tabRows = readCache('pos-tabs') || [];
              const deadTab = tabRows.find((row) => String(row?.id || '') === deadTabId);
              if (deadTab && String(deadTab.status || '').toLowerCase() === 'closed') {
                writeCache('pos-tabs', tabRows.map((row) =>
                  String(row?.id || '') === deadTabId
                    ? { ...row, status: 'open', updated_at: new Date().toISOString(), _pending_sync: true, _sync_state: 'failed', _sync_error: errorMessage }
                    : row
                ));
              }
            } catch {
              /* Local tab recovery is best-effort; the dead-letter stays visible. */
            }
          }
        }
      } else {
        console.warn(`[Sync] Failed (attempt ${updatedItem.retryCount}/${MAX_SYNC_RETRIES}) — ${item.type} ${item.table}:`, errorMessage);
        appendOperationJournalEntry('replay_failed', updatedItem, {
          financial: isFinancialSyncItem(updatedItem),
          message: errorMessage
        });
        pending.push(updatedItem);
      }
      if (item?.type === 'rpc' && ['post_bar_physical_count', 'post_bar_simple_delivery'].includes(item?.table)) {
        const batchLines = Array.isArray(item?.data?.p_lines) ? item.data.p_lines : []
        const reason = `${item.table} rejected by server: ${errorMessage}`
        for (const line of batchLines) {
          if (line?.item_id) patchCachedInventoryItemSyncState(line.item_id, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: reason
          })
        }
      }
      writeReplayQueue(pending, { completedQueueIds, deadLetter });
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
        // The queued replay landed: the journal attempt is no longer
        // provisional (or pending) but committed server truth.
        const replayedIntentId = String(item?.data?.payload?.submit_intent_id || '').trim();
        if (replayedIntentId) commitPosSubmitAttempt(replayedIntentId);
      }
      if (item?.table === 'save_bar_product_with_stock') {
        // The server minted real ids but queued dependents (offline sales,
        // snapshots reference catalog state, not rows) still carry the
        // provisional `pending:<operation_key>` menu identity: rewrite them
        // before they replay. Duplicate-name replays consumed as synced have
        // no ids in the result, so resolve the surviving row by exact name.
        const productKey = String(item?.data?.payload?.operation_key || '').trim();
        if (productKey) {
          try {
            let realMenuId = String(rpcResultData?.menu_item_id || '').trim() || null;
            let realInventoryId = String(rpcResultData?.inventory_item_id || '').trim() || null;
            if (!realMenuId) {
              const wanted = String(item?.data?.payload?.product?.name || '').trim();
              if (wanted && state?.supabase) {
                const found = await state.supabase
                  .from('pos_menu_items')
                  .select('id, inventory_item_id')
                  .eq('lodge_id', state.lodgeId)
                  .ilike('name', wanted)
                  .limit(2);
                const rows = Array.isArray(found?.data) ? found.data : [];
                if (rows.length === 1 && rows[0]?.id) {
                  realMenuId = String(rows[0].id);
                  realInventoryId = rows[0]?.inventory_item_id ? String(rows[0].inventory_item_id) : realInventoryId;
                }
              }
            }
            if (realMenuId) {
              const rewritten = rewritePendingProductReferences(pending, productKey, realMenuId, realInventoryId);
              if (rewritten > 0) console.log('[POS SYNC] Rewrote provisional product refs', { productKey, menuId: realMenuId, orders: rewritten });
            }
          } catch {
            /* Rewrite is best-effort; unreconciled dependents dead-letter visibly. */
          }
          try {
            const menuRows = readCache('pos-menu-items') || [];
            const keptMenu = menuRows.filter((row) => row?._operation_key !== productKey);
            if (keptMenu.length !== menuRows.length) writeCache('pos-menu-items', keptMenu);
            const stockRows = readCache('inventory-items') || [];
            const keptStock = stockRows.filter((row) => row?._operation_key !== productKey);
            if (keptStock.length !== stockRows.length) writeCache('inventory-items', keptStock);
          } catch {
            /* Purge is cosmetic; the next server read converges anyway. */
          }
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
        const localBookingIds = getQueuedBookingIds(item);
        const serverBookingIds = Array.isArray(rpcResultData?.booking_ids) ?
          rpcResultData.booking_ids.map((value) => String(value || '').trim()).filter(Boolean) : [];
        localBookingIds.forEach((localBookingId, index) => {
          const serverBookingId = serverBookingIds[index] || null;
          if (serverBookingId && serverBookingId !== localBookingId) {
            replaceQueuedBookingReference(localBookingId, serverBookingId);
            for (let i = 0; i < pending.length; i += 1) {
              pending[i] = rewriteQueuedBookingReferenceItem(pending[i], localBookingId, serverBookingId);
            }
          }
          patchCachedBookingSyncState(serverBookingId || localBookingId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          // If the server returned a definitive row, the post-sync refresh will
          // replace the local projection; otherwise retaining the local id keeps
          // the failed/synced state visible until the next refresh.
          console.log('[BOOKING SYNC] Synced booking', serverBookingId || localBookingId);
        });
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
      if (isCreateQuotationQueueItem(item)) {
        const quotationId = getQueuedQuotationId(item);
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[QUOTATION SYNC] Synced create quotation', quotationId);
        }
      }
      if (isUpdateQuotationQueueItem(item)) {
        const quotationId = getQueuedQuotationId(item);
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[QUOTATION SYNC] Synced update quotation', quotationId);
        }
      }
      if (isMarkQuotationSentQueueItem(item)) {
        const quotationId = getQueuedQuotationId(item);
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[QUOTATION SYNC] Synced mark quotation sent', quotationId);
        }
      }
      if (item?.type === 'rpc' && item?.table === 'add_booking_charge') {
        const localChargeId = item._local_charge_id || null;
        const serverChargeId = rpcResultData?.id || rpcResultData?.charge_id || null;
        if (localChargeId && serverChargeId && localChargeId !== serverChargeId) {
          pending.splice(0, pending.length, ...rewriteQueuedEntityReference(pending, localChargeId, serverChargeId, {
            fieldNames: ['p_charge_id'],
            dependsPrefix: 'booking-charge'
          }));
          const charges = readCache('booking-charges');
          writeCache('booking-charges', charges.map((charge) => charge?.id === localChargeId ? {
            ...charge,
            id: serverChargeId,
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          } : charge));
        }
      }
      if (item?.type === 'rpc' && item?.table === 'add_event_line_item') {
        const localLineId = item._local_line_item_id || null;
        const serverLineId = rpcResultData?.line_item_id || rpcResultData?.id || null;
        if (localLineId && serverLineId && localLineId !== serverLineId) {
          pending.splice(0, pending.length, ...rewriteQueuedEntityReference(pending, localLineId, serverLineId, {
            fieldNames: ['p_line_item_id'],
            dependsPrefix: 'event-line'
          }));
          const lines = readCache('event-line-items');
          writeCache('event-line-items', lines.map((line) => line?.id === localLineId ? {
            ...line,
            id: serverLineId,
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          } : line));
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
      if (isInventoryAdjustmentQueueItem(item)) {
        const inventoryItemId = item?.data?.p_item_id || null;
        if (inventoryItemId) {
          patchCachedInventoryItemSyncState(inventoryItemId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          });
          console.log('[INVENTORY SYNC] Synced stock adjustment', inventoryItemId);
        }
      }
      if ((item.type === 'update' && item.table === 'pool_day_use') || (item.type === 'rpc' && item.table === 'update_pool_day_use')) {
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
      if (queueItemNeedsBookingRefresh(item)) {
        shouldRefreshBookings = true;
        if (item.type === 'rpc' && ['create_multi_room_booking', 'create_booking_invoice_group'].includes(item.table)) {
          shouldRefreshBookingGroups = true;
        }
      }
      if (queueItemNeedsSupplyRefresh(item)) shouldRefreshSupplies = true;
      if (queueItemNeedsRateOverrideRefresh(item)) shouldRefreshRateOverrides = true;
      // P1-8: widen refresh to cover all domains touched by this operation
      if (item.type === 'rpc' && ['create_customer', 'update_customer'].includes(item.table)) shouldRefreshCustomers = true;
      if (item.table === 'rooms' || item.type === 'rpc' && item.table?.startsWith?.('update_room')) shouldRefreshRooms = true;
      if (item.type === 'rpc' && ['create_user', 'update_user_profile', 'set_user_pwa_access'].includes(item.table)) shouldRefreshUsers = true;
      if (item.type === 'rpc' && ['create_quotation', 'update_quotation', 'mark_quotation_sent', 'convert_quotation_to_booking'].includes(item.table)) shouldRefreshQuotations = true;
      if (item.type === 'rpc' && ['create_expense', 'update_expense', 'delete_expense'].includes(item.table)) shouldRefreshExpenses = true;
      if (item.type === 'rpc' && ['create_maintenance_ticket', 'update_maintenance_ticket', 'resolve_maintenance_ticket'].includes(item.table)) shouldRefreshMaintenance = true;
      if (isPosCreateOrderQueueItem(item) || isPosVoidQueueItem(item)) shouldRefreshPosOrders = true;
      if (item.type === 'rpc' && [
        'open_pos_shift_with_id',
        'activate_shared_till_operator_offline',
        'link_my_pos_shift_to_attendance',
        'submit_pos_shift_cashup',
        'submit_pos_shift_cashup_with_attendance_pin',
        'review_pos_cashup_submission_offline',
        'finalize_pos_shift_cashup_v2'
      ].includes(item.table)) shouldRefreshPosShifts = true;
      if (item.type === 'rpc' && [
        'create_pos_menu_item_offline',
        'update_pos_menu_item_offline',
        'update_pos_menu_item',
        'delete_pos_menu_item',
        'set_bar_pos_pack_template_offline',
        'save_bar_pos_product_with_packs_offline',
        'upsert_pos_modifier_groups',
        'upsert_pos_promotions',
        'publish_pos_catalog_snapshot_offline'
      ].includes(item.table)) shouldRefreshPosMenu = true;
      if (item.type === 'rpc' && item.table === 'publish_pos_catalog_snapshot_offline') {
        const snapshotId = item?.data?.payload?.snapshot_id;
        if (snapshotId) writeCache('pos-catalog-snapshots', readCache('pos-catalog-snapshots').map((row) => row?.snapshot_id === snapshotId ? {
          ...row, _pending_sync: false, _sync_state: 'synced', _synced_at: new Date().toISOString()
        } : row));
      }
      if (item?.type === 'rpc' && ['post_bar_physical_count', 'post_bar_simple_delivery'].includes(item?.table)) {
        const batchLines = Array.isArray(item?.data?.p_lines) ? item.data.p_lines : []
        for (const line of batchLines) {
          if (line?.item_id) patchCachedInventoryItemSyncState(line.item_id, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          })
        }
      }
      if (item.type === 'rpc' && [
        'clock_in_staff_offline',
        'clock_in_staff_with_attendance_pin_offline',
        'clock_in_self_for_pos_offline',
        'clock_out_staff',
        'clock_out_staff_offline',
        'clock_out_staff_with_attendance_pin'
      ].includes(item.table)) {
        const attendanceShiftId = item?.data?.payload?.shift_id;
        if (attendanceShiftId) writeCache('restaurant-shifts', readCache('restaurant-shifts').map((row) => row?.id === attendanceShiftId ? {
          ...row, _pending_sync: false, _sync_state: 'synced', _synced_at: new Date().toISOString()
        } : row));
      }
      if (item.type === 'rpc' && [
        'submit_pos_shift_cashup',
        'submit_pos_shift_cashup_with_attendance_pin',
        'review_pos_cashup_submission_offline'
      ].includes(item.table)) {
        const submissionKey = item?.data?.payload?.submission_idempotency_key || item?.data?.payload?.idempotency_key;
        if (submissionKey) writeCache('pos-cashup-submissions', readCache('pos-cashup-submissions').map((row) => row?.idempotency_key === submissionKey ? {
          ...row, _pending_sync: false, _sync_state: 'synced', _synced_at: new Date().toISOString()
        } : row));
      }
      if (item.type === 'rpc' && [
        'create_conference_booking',
        'update_conference_booking',
        'update_conference_booking_payment',
        'delete_conference_booking',
        'create_event_booking',
        'update_event_booking',
        'update_event_payment',
        'cancel_event_booking',
        'add_event_line_item',
        'void_event_line_item'
      ].includes(item.table)) shouldRefreshConference = true;
      if ((item.type === 'rpc' && ['add_pool_day_use', 'update_pool_day_use', 'delete_pool_day_use'].includes(item.table)) || (item.type === 'update' && item.table === 'pool_day_use')) shouldRefreshPoolDayUse = true;
      // Phase 1: persist committed state before removing from queue file.
      // Crash here → restart sees 'committed' → skips RPC without retrying.
      // Mark completed first so the stale on-disk in-flight copy of this same
      // id is excluded from the arrival merge (P0-1); concurrent sales still
      // merge in instead of being erased by the committed snapshot.
      if (item._queue_id) completedQueueIds.add(item._queue_id);
      absorbNewDiskQueueArrivals(pending, { completedQueueIds, deadLetter, inFlightItem: null });
      writeSyncQueue([{ ...item, _state: 'committed' }, ...pending]);
      appendOperationJournalEntry('replayed', { ...item, _state: 'committed' }, {
        financial: isFinancialSyncItem(item),
        message: 'Operation was accepted by the authoritative replay path.'
      });
      // Phase 2: remove item from queue
      successCount++;
      writeReplayQueue(pending, { completedQueueIds, deadLetter });
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
  writeReplayQueue(pending, { completedQueueIds, deadLetter });

  if (shouldRefreshInventory) {
    refreshCache('inventory-items', 'inventory-purchases', 'inventory-stocktakes')
      .catch(() => refreshOfflinePosInventoryProjection());
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
  if ((successCount > 0 && shouldRefreshBookings) || shouldRefreshBookingsAfterFailure) refreshTargets.push('bookings', 'booking-charges');
  if (successCount > 0 && shouldRefreshBookingGroups) {
    refreshTargets.push('booking-invoice-groups', 'booking-invoice-group-lines');
  }
  if (successCount > 0 && shouldRefreshCustomers) refreshTargets.push('customers');
  if (successCount > 0 && shouldRefreshRooms) refreshTargets.push('rooms');
  if (successCount > 0 && shouldRefreshUsers) refreshTargets.push('users');
  if (successCount > 0 && shouldRefreshQuotations) refreshTargets.push('quotations');
  if (successCount > 0 && shouldRefreshPosOrders) refreshTargets.push('pos-orders');
  if (successCount > 0 && shouldRefreshPosShifts) refreshTargets.push('pos-shifts');
  if (successCount > 0 && shouldRefreshPosMenu) refreshTargets.push('pos-menu-items');
  if (successCount > 0 && shouldRefreshConference) refreshTargets.push('conference-bookings', 'event-line-items');
  if (successCount > 0 && shouldRefreshPoolDayUse) refreshTargets.push('pool-day-use');
  if (successCount > 0 && shouldRefreshExpenses) refreshTargets.push('expenses');
  if (successCount > 0 && shouldRefreshMaintenance) refreshTargets.push('maintenance');
  if (successCount > 0 && shouldRefreshRateOverrides) refreshTargets.push('room-rate-overrides');
  if (successCount > 0 && shouldRefreshSupplies) {
    refreshTargets.push(
      'supply-items',
      'supply-purchases',
      'room-supply-stock',
      'room-supply-movements',
      'room-supply-allocations',
      'supply-stocktakes',
      'room-supply-stocktakes'
    );
  }
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
    // Incremental persists above already wrote each entry; this final flush is
    // a deduped upsert so a crash between the last item and this line cannot
    // lose work, and concurrent manager clears are re-shown for review rather
    // than silently dropping financial work.
    writeFailedSyncQueue(mergeDeadLetterQueues(readFailedSyncQueue(), deadLetter));
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
      appendOperationJournalEntry('auto_requeued', cleanItem, {
        financial: isFinancialSyncItem(cleanItem),
        message: 'Failed item returned to pending queue for another replay attempt.'
      });
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
  const queuedData = type === 'rpc' ? protectQueuedRpcData(data) : data;
  const queuedItem = ensureQueuedItem({
    type,
    table,
    data: queuedData,
    id,
    timestamp: new Date().toISOString(),
    _origin_device_id: state.deviceId || null,
    _origin_user_id: state.currentUser?.id || null,
    _origin_lodge_id: state.lodgeId || null,
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
  appendOperationJournalEntry('queued', queuedItem, {
    financial: isFinancialSyncItem(queuedItem),
    message: 'Operation saved locally for later authoritative RPC replay.'
  });
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
  // Boot-phase timing: each marker prints wall-clock elapsed since process
  // start so a slow launch can be attributed to an exact phase from the
  // terminal output. Markers are additive logging only; they change no
  // behavior and never block.
  const bootAt = Date.now();
  const bootMark = (phase) => {
    try { console.log(`[BOOT] ${phase} (+${Date.now() - bootAt}ms)`); } catch {}
  };
  bootMark('initDatabase start');
  state.cacheRootDir = path.join(app.getPath('userData'), 'boroko-cache');
  state.profilesCacheDir = path.join(state.cacheRootDir, 'profiles');
  await initializeProfileRuntime();
  bootMark('profile runtime ready');

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
  for (let attempt = 0; attempt < 2; attempt++) {
    online = await checkOnline();
    if (online) break;
    if (attempt < 1) await new Promise((r) => setTimeout(r, 2000));
  }
  if (online && state.lodgeId) {
    // Fire-and-forget cache refresh — don't block startup on exhausted IO
    const bootRefreshAt = Date.now();
    bootMark('cache refresh fired');
    refreshAllCaches()
      .then(() => { try { console.log(`[BOOT] cache refresh done (+${Date.now() - bootAt}ms, took ${Date.now() - bootRefreshAt}ms)`); } catch {} })
      .catch(() => {});
    console.log('Connected to Supabase ✓ (replay deferred until user authenticates)');
  } else {
    console.log('Running in offline mode — using cached data');
  }
  bootMark('connectivity probe done');

  if (!state.backupIntervalStarted) {
    state.backupIntervalStarted = true;

    const bootBackupAt = Date.now();
    bootMark('backup start');
    createBackup();
    bootMark(`backup done (took ${Date.now() - bootBackupAt}ms)`);
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
          console.log('Back online - syncing changes...');
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
  bootMark('initDatabase done');
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
  changeOwnStaffPin,
  createUser,
  deleteUser,
  getStaffAccessAudit,
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
