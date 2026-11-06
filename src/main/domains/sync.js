import fs from 'fs';
import path from 'path';
import { state } from '../state.js';

import {
  appendOperationJournalEntry,
  appendHealthFault,
  buildLocalOperationsBundle,
  getOperationJournalSummary,
  readFailedSyncQueue,
  readHealthFaults,
  readOfflineModeState,
  readSyncMeta,
  readSyncQueue,
  writeLocalOperationsBundle,
  writeFailedSyncQueue,
  writeOfflineModeState,
  writeSyncQueue
} from './syncStore.js';
import {
  FINANCIAL_SYNC_TABLES,
  isFinancialSyncItem,
  processSyncQueue,
  readCache,
  requeueEligibleFailedSyncItems,
} from './infrastructure.js';
import { broadcastSyncStatus, checkOnline } from './connectivity.js';
import { buildSyncStatusSnapshot, createDependencyCacheResolver } from './syncStatus.js';
import { markClearedSyncItemForManualReview, patchCachedPosOrderSyncState, patchCachedInventoryItemSyncState, patchCachedDayUseSyncState } from './syncCache.js';
import {
  DEAD_LETTER_AUTO_RETRY_AFTER_MS,
  ensureQueuedItem,
  getQueuedPosOrderId,
  getSyncItemBookingId,
  getSyncItemScope,
  isPosCreateOrderQueueItem,
  normalizeQueuedSyncItemForReplay,
  isInventoryItemQueueItem,
  getQueuedInventoryItemId
} from './syncShared.js';

const HEALTH_FAULTS_FILE = 'health-faults.json';
const CACHE_FRESHNESS_FILE = 'cache-freshness.json';
/** @typedef {{_queue_id?: string, _depends_on?: unknown, _depends_on_all?: unknown, lastError?: string|null, table?: string, type?: string, data?: {p_booking_id?: string|null, payload?: {booking_id?: string|null, id?: string|null}, p_id?: string|null}, _local_booking_id?: string|null, lastAttemptedAt?: string|null, manualRetryOnly?: boolean, id?: string, retryCount?: number, _state?: string, [key: string]: unknown}} QueueItemExpectedView */
/** @typedef {{id?: string, _pending_sync?: boolean, _sync_state?: string, [key: string]: unknown}} CacheRowExpectedView */
/** @typedef {{enabled?: unknown, reason?: unknown}} OfflineModeExpectedView */
/** @typedef {'none'|'blocked_dependencies'|'resolved'|'missing_parent'} SyncDependencyCategory */
const QUEUED_DEPENDENCY_CACHE_MAP = [
  { prefix: 'booking-', cache: 'bookings' },
  { prefix: 'customer-', cache: 'customers' },
  { prefix: 'room-', cache: 'rooms' },
  { prefix: 'user-', cache: 'users' },
  { prefix: 'quotation-', cache: 'quotations' },
  { prefix: 'pos-order-', cache: 'pos-orders' },
  { prefix: 'pos-shift-', cache: 'pos-shifts' },
  { prefix: 'pos-catalog-snapshot-', cache: 'pos-catalog-snapshots', idField: 'snapshot_id' },
  { prefix: 'attendance-shift-', cache: 'restaurant-shifts' },
  { prefix: 'pos-cashup-submission-', cache: 'pos-cashup-submissions', idField: 'idempotency_key' },
  { prefix: 'conference-booking-', cache: 'conference-bookings' },
  { prefix: 'pool-day-use-', cache: 'pool-day-use' },
  { prefix: 'dayuse-', cache: 'pool-day-use' },
  { prefix: 'inventory-item-', cache: 'inventory-items' }
];

/** @param {string} dependencyId */
function isQueuedDependencyResolved(dependencyId) {
  const normalizedDependencyId = String(dependencyId || '').trim();
  if (!normalizedDependencyId) return false;

  const target = QUEUED_DEPENDENCY_CACHE_MAP.find(({ prefix }) => normalizedDependencyId.startsWith(prefix));
  if (!target) return false;

  const entityId = normalizedDependencyId.slice(target.prefix.length).trim();
  if (!entityId) return false;

  const cachedRow = /** @type {CacheRowExpectedView[]} */ (readCache(target.cache)).find((/** @type {CacheRowExpectedView} */ entry) => entry?.[target.idField || 'id'] === entityId);
  if (!cachedRow) return false;

  return cachedRow._pending_sync !== true &&
  cachedRow._sync_state !== 'manual_review_required' &&
  cachedRow._sync_state !== 'failed';
}

export function getSyncStatus() {
  return buildSyncStatusSnapshot();
}

/** @param {string|null|undefined} id */
export function clearHealthFault(id) {
  if (!state.cacheDir) return { success: true, remaining: 0 };
  const filePath = path.join(state.cacheDir, HEALTH_FAULTS_FILE);
  const tmpPath = filePath + '.tmp';
  try {
    const faults = readHealthFaults();
    const next = id ? faults.filter((f) => f.id !== id) : [];
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return { success: true, remaining: next.length };
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return { success: false, error: (/** @type {{message?: string}} */ (e)).message };
  }
}

/** @returns {Record<string, {updatedAt?: string|null}>} */
function readCacheFreshness() {
  if (!state.cacheDir) return {};
  try {
    const raw = fs.readFileSync(path.join(state.cacheDir, CACHE_FRESHNESS_FILE), 'utf-8');
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/** @param {QueueItemExpectedView} [item] @param {Set<string|undefined>|QueueItemExpectedView[]|null} [pendingIds] @param {Set<string|undefined>|QueueItemExpectedView[]|null} [failedIds] @param {((dependencyId: string) => boolean)|null} [resolveDep] @returns {SyncDependencyCategory} */
function classifySyncDependencyCategory(item = {}, pendingIds = null, failedIds = null, resolveDep = null) {
  const dependencyIds = [...new Set([
    item?._depends_on,
    ...(Array.isArray(item?._depends_on_all) ? item._depends_on_all : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];
  if (dependencyIds.length === 0) return 'none';

  // Callers pass prebuilt Sets (one build per details computation). Accept
  // raw arrays for backward compatibility with any external caller.
  const failedSet = failedIds instanceof Set
    ? failedIds
    : new Set((Array.isArray(failedIds) ? failedIds : []).map((entry) => entry?._queue_id).filter(Boolean));
  const pendingSet = pendingIds instanceof Set
    ? pendingIds
    : new Set((Array.isArray(pendingIds) ? pendingIds : []).map((entry) => entry?._queue_id).filter(Boolean));
  if (dependencyIds.some((dependencyId) => failedSet.has(dependencyId))) {
    return 'blocked_dependencies';
  }
  if (dependencyIds.some((dependencyId) => pendingSet.has(dependencyId))) {
    return 'blocked_dependencies';
  }
  // Bulk offline runs can attach thousands of dependency ids to one item;
  // resolve them through the caller's shared index (one cache parse total),
  // never one file read per id (see createDependencyCacheResolver).
  const isResolved = resolveDep || isQueuedDependencyResolved;
  if (dependencyIds.every((dependencyId) => isResolved(dependencyId))) {
    return 'resolved';
  }
  return 'resolved';
}

/** @param {SyncDependencyCategory} [category] */
function getSyncDependencyLabel(category = 'none') {
  switch (category) {
    case 'missing_parent':
      return 'Blocked: missing parent sync item';
    case 'blocked_dependencies':
      return 'Blocked: waiting for parent sync item';
    case 'resolved':
      return 'Ready: parent already synced';
    default:
      return 'No dependency';
  }
}

/** @param {QueueItemExpectedView} [item] @param {SyncDependencyCategory} [dependencyCategory] */
function getSyncDisplayError(item = {}, dependencyCategory = 'none') {
  if (dependencyCategory === 'missing_parent') return 'Blocked: missing parent sync item';
  if (dependencyCategory === 'blocked_dependencies' && /Skipped: parent operation failed/i.test(String(item?.lastError || ''))) {
    return 'Blocked: parent sync item failed';
  }
  return item?.lastError || '';
}

/** @param {QueueItemExpectedView[]} [pending] @param {QueueItemExpectedView[]} [failed] @param {((dependencyId: string) => boolean)|null} [resolveDep] */
function buildSyncGroupedCounts(pending = [], failed = [], resolveDep = null) {
  const pendingSet = new Set((pending || []).map((entry) => entry?._queue_id).filter(Boolean));
  const failedSet = new Set((failed || []).map((entry) => entry?._queue_id).filter(Boolean));
  const pendingMissingParent = pending.filter((item) => classifySyncDependencyCategory(item, pendingSet, failedSet, resolveDep) === 'missing_parent').length;
  const failedMissingParent = failed.filter((item) => classifySyncDependencyCategory(item, pendingSet, failedSet, resolveDep) === 'missing_parent').length;
  const pendingBlockedDependencies = pending.filter((item) => classifySyncDependencyCategory(item, pendingSet, failedSet, resolveDep) === 'blocked_dependencies').length;
  const failedBlockedDependencies = failed.filter((item) => classifySyncDependencyCategory(item, pendingSet, failedSet, resolveDep) === 'blocked_dependencies').length;
  const financialRiskItems = pending.filter(isFinancialSyncItem).length + failed.filter(isFinancialSyncItem).length;

  return {
    missing_parent: pendingMissingParent + failedMissingParent,
    blocked_dependencies: pendingBlockedDependencies + failedBlockedDependencies,
    financial_risk_items: financialRiskItems,
    failed_items: failed.length,
    pending_items: pending.length
  };
}

/** @returns {import('../../shared/desktopIpcContracts.js').SyncDetailsSnapshot} */
export function getSyncDetails() {
  const pending = /** @type {QueueItemExpectedView[]} */ (readSyncQueue());
  const failed = /** @type {QueueItemExpectedView[]} */ (readFailedSyncQueue());
  const faults = readHealthFaults();
  const syncMeta = readSyncMeta();
  const cacheFreshness = readCacheFreshness();
  const resolvedLastSync = state.lastSuccessfulSyncAt || syncMeta.lastSuccessfulSyncAt || null;
  const now = Date.now();
  // One shared dependency index for the whole details computation: a single
  // bulk-run item can carry thousands of dependency ids, and resolving each
  // against a freshly parsed cache file would block the main thread for
  // minutes (see createDependencyCacheResolver).
  const depResolver = createDependencyCacheResolver().isResolved;
  const pendingIdSet = /** @type {Set<string>} */ (new Set(pending.map((entry) => entry?._queue_id).filter(Boolean)));
  const failedIdSet = /** @type {Set<string>} */ (new Set(failed.map((entry) => entry?._queue_id).filter(Boolean)));

  /** @param {QueueItemExpectedView} item */
  const enrichPending = (item) => {
    const dependencyCategory = classifySyncDependencyCategory(item, pendingIdSet, failedIdSet, depResolver);
    const dependencyIds = [...new Set([
      item?._depends_on,
      ...(Array.isArray(item?._depends_on_all) ? item._depends_on_all : [])
    ].map((value) => String(value || '').trim()).filter(Boolean))];
    return {
      ...item,
      isFinancial: isFinancialSyncItem(item),
      // `_depends_on` remains the primary compatibility marker; the checks
      // below include every `_depends_on_all` prerequisite.
      dependencyState: item?._depends_on ?
      dependencyIds.some((dependencyId) => failedIdSet.has(dependencyId)) ?
      'failed_parent' :
      dependencyIds.some((dependencyId) => pendingIdSet.has(dependencyId)) ?
      'waiting_for_parent' :
      'ready_or_external' :
      'none',
      dependencyCategory,
      dependencyLabel: getSyncDependencyLabel(dependencyCategory)
    };
  };

  /** @param {QueueItemExpectedView} item */
  const enrichFailed = (item) => {
    const attemptedAtMs = item.lastAttemptedAt ? Date.parse(item.lastAttemptedAt) : NaN;
    const ageMs = Number.isNaN(attemptedAtMs) ? null : now - attemptedAtMs;
    const isAutoRetryable = item.manualRetryOnly !== true;
    const nextAutoRetryAt = isAutoRetryable && !Number.isNaN(attemptedAtMs) ?
    new Date(attemptedAtMs + DEAD_LETTER_AUTO_RETRY_AFTER_MS).toISOString() :
    null;
    const autoRetryEligible = isAutoRetryable && (Number.isNaN(attemptedAtMs) || (ageMs !== null && ageMs >= DEAD_LETTER_AUTO_RETRY_AFTER_MS));
    const dependencyCategory = classifySyncDependencyCategory(item, pendingIdSet, failedIdSet, depResolver);
    return {
      ...item,
      isFinancial: isFinancialSyncItem(item),
      dependencyCategory,
      dependencyLabel: getSyncDependencyLabel(dependencyCategory),
      displayError: getSyncDisplayError(item, dependencyCategory),
      isAutoRetryable,
      nextAutoRetryAt,
      autoRetryEligible,
      ageMs
    };
  };

  /** @param {QueueItemExpectedView} item */
  /** @param {QueueItemExpectedView} item @returns {string|null} */
  const extractBookingId = (item) =>
  item?.data?.p_booking_id || item?.data?.payload?.booking_id || item?.data?.payload?.id || item?.data?.p_id || item?._local_booking_id || null;

  /** @param {string|null|undefined} value @returns {value is string} */
  const hasBookingId = (value) => Boolean(value)

  const financialPendingBookingIds = [...new Set(pending.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).map(extractBookingId).filter(hasBookingId))];
  const financialFailedBookingIds = [...new Set(failed.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).map(extractBookingId).filter(hasBookingId))];
  const financialPendingCount = pending.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).length;
  const financialFailedCount = failed.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).length;
  const groupedCounts = buildSyncGroupedCounts(pending, failed, depResolver);
  const bookings = /** @type {CacheRowExpectedView[]} */ (readCache('bookings')).filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required');
  const customers = /** @type {CacheRowExpectedView[]} */ (readCache('customers')).filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required');
  const rooms = /** @type {CacheRowExpectedView[]} */ (readCache('rooms')).filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required');
  const users = /** @type {CacheRowExpectedView[]} */ (readCache('users')).filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required');
  const quotations = /** @type {CacheRowExpectedView[]} */ (readCache('quotations')).filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required');
  const posOrders = /** @type {CacheRowExpectedView[]} */ (readCache('pos-orders')).filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required');
  const conferenceBookings = /** @type {CacheRowExpectedView[]} */ (readCache('conference-bookings')).filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required');
  const poolDayUse = /** @type {CacheRowExpectedView[]} */ (readCache('pool-day-use')).filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required');
  const inventoryItems = /** @type {CacheRowExpectedView[]} */ (readCache('inventory-items')).filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required');

  const total = bookings.length + customers.length + rooms.length + users.length + quotations.length + posOrders.length + conferenceBookings.length + poolDayUse.length + inventoryItems.length;

  const unresolvedLocal = {
    total,
    length: total, // Preserve array compatibility for details.unresolvedLocal?.length in health.js
    bookings: { count: bookings.length, ids: bookings.map((/** @type {CacheRowExpectedView} */ r) => r.id) },
    customers: { count: customers.length, ids: customers.map((/** @type {CacheRowExpectedView} */ r) => r.id) },
    rooms: { count: rooms.length, ids: rooms.map((/** @type {CacheRowExpectedView} */ r) => r.id) },
    users: { count: users.length, ids: users.map((/** @type {CacheRowExpectedView} */ r) => r.id) },
    quotations: { count: quotations.length, ids: quotations.map((/** @type {CacheRowExpectedView} */ r) => r.id) },
    posOrders: { count: posOrders.length, ids: posOrders.map((/** @type {CacheRowExpectedView} */ r) => r.id) },
    conferenceBookings: { count: conferenceBookings.length, ids: conferenceBookings.map((/** @type {CacheRowExpectedView} */ r) => r.id) },
    poolDayUse: { count: poolDayUse.length, ids: poolDayUse.map((/** @type {CacheRowExpectedView} */ r) => r.id) },
    inventoryItems: { count: inventoryItems.length, ids: inventoryItems.map((/** @type {CacheRowExpectedView} */ r) => r.id) }
  };

  const enrichedCacheFreshness = Object.fromEntries(
    Object.entries(cacheFreshness).map(([name, meta]) => {
      const updatedAtMs = meta?.updatedAt ? Date.parse(meta.updatedAt) : NaN;
      const cacheAgeMs = Number.isNaN(updatedAtMs) ? null : now - updatedAtMs;
      return [name, { ...meta, cacheAgeMs, stale: cacheAgeMs != null && cacheAgeMs > 24 * 60 * 60 * 1000 }];
    })
  );

  return {
    isOnline: state.isOnline,
    syncInProgress: state.syncInProgress,
    replayAuthReady: state.replayAuthReady,
    pendingCount: pending.length,
    failedCount: failed.length,
    lastSuccessfulSyncAt: resolvedLastSync,
    syncMeta: {
      lastSyncStartedAt: syncMeta.lastSyncStartedAt || null,
      lastSyncFinishedAt: syncMeta.lastSyncFinishedAt || null,
      lastSyncOutcome: syncMeta.lastSyncOutcome || null,
      lastSyncError: syncMeta.lastSyncError || ''
    },
    financialPendingBookingIds,
    financialFailedBookingIds,
    unresolvedLocal,
    financialPendingCount,
    financialFailedCount,
    groupedCounts,
    pending: pending.map(enrichPending),
    failed: failed.map(enrichFailed),
    faults,
    offlineMode: readOfflineModeState(),
    operationJournal: getOperationJournalSummary(),
    cacheFreshness: enrichedCacheFreshness,
    cacheStale: {
      active: state.syncRefreshState.stale,
      names: state.syncRefreshState.names,
      attempts: state.syncRefreshState.attempts,
      lastError: state.syncRefreshState.lastError,
      lastFailedAt: state.syncRefreshState.lastFailedAt
    }
  };
}

/** @param {string[]} [queueIds] @returns {Promise<import('../../shared/desktopIpcContracts.js').SyncRetryResult>} */
export async function retrySyncItems(queueIds = []) {
  const failed = /** @type {QueueItemExpectedView[]} */ (readFailedSyncQueue()).map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const targetIds = new Set((queueIds || []).filter(Boolean));
  const shouldRetryAll = targetIds.size === 0;
  const retryItems = failed.filter((item) => shouldRetryAll || targetIds.has(/** @type {string} */ (item._queue_id)));
  if (retryItems.length === 0) return { success: true, retried: 0, remaining: failed.length };

  const keepFailed = failed.filter((item) => !retryItems.some((entry) => entry._queue_id === item._queue_id));
  const queue = /** @type {QueueItemExpectedView[]} */ (readSyncQueue()).map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const existingIds = new Set(queue.map((item) => item._queue_id));
  for (const item of retryItems) {
    const cleanItem = /** @type {QueueItemExpectedView} */ (normalizeQueuedSyncItemForReplay({
      ...item,
      _state: 'pending',
      retryCount: Math.max(0, Number(item.retryCount || 1) - 1),
      lastError: '',
      lastAttemptedAt: null
    }));
    if (isPosCreateOrderQueueItem(cleanItem)) {
      const orderId = getQueuedPosOrderId(cleanItem);
      if (orderId) {
        console.log('[POS SYNC] Retrying order', orderId);
        patchCachedPosOrderSyncState(orderId, {
          _sync_state: 'pending',
          _sync_error: null
        });
      }
    }
    if (isInventoryItemQueueItem(cleanItem)) {
      const itemId = getQueuedInventoryItemId(cleanItem);
      if (itemId) {
        console.log('[INVENTORY SYNC] Retrying inventory item', itemId);
        patchCachedInventoryItemSyncState(itemId, {
          _pending_sync: true,
          _sync_state: 'pending',
          _sync_error: null
        });
      }
    }
    if ((cleanItem?.type === 'update' && cleanItem?.table === 'pool_day_use') || (cleanItem?._queue_id || '').startsWith('dayuse-status-')) {
      const entryId = cleanItem?.id || cleanItem?.data?.p_id || null;
      if (entryId) {
        patchCachedDayUseSyncState(entryId, {
          _pending_sync: true,
          _sync_state: 'pending',
          _sync_error: null
        });
      }
    }
    if (!existingIds.has(cleanItem._queue_id)) {
      queue.push(cleanItem);
      existingIds.add(cleanItem._queue_id);
      appendOperationJournalEntry('manual_requeued', cleanItem, {
        financial: isFinancialSyncItem(cleanItem),
        message: 'Manager returned failed item to the pending queue.'
      });
    }
  }
  // Keep the failed copy until the pending destination is durable. If the
  // cleanup fails, the next retry deduplicates by the original queue ID.
  writeSyncQueue(queue);
  writeFailedSyncQueue(keepFailed);
  if (state.isOnline) await processSyncQueue();
  return { success: true, retried: retryItems.length, remaining: keepFailed.length };
}

/** @param {string[]} [queueIds] @returns {import('../../shared/desktopIpcContracts.js').SyncClearFailedResult} */
export function clearSyncFailed(queueIds = []) {
  const failed = /** @type {QueueItemExpectedView[]} */ (readFailedSyncQueue());
  const targetIds = new Set((queueIds || []).filter(Boolean));
  const shouldClearAll = targetIds.size === 0;
  const itemsToRemove = shouldClearAll ?
  failed :
  failed.filter((item) => targetIds.has(/** @type {string} */ (item?._queue_id)));

  const financialCleared = itemsToRemove.filter((item) => isFinancialSyncItem(item));
  let integrityAlertsRecorded = 0;
  for (const item of itemsToRemove) {
    markClearedSyncItemForManualReview(item);
    const isFinancial = isFinancialSyncItem(item);
    appendHealthFault({
      type: isFinancial ? 'financial_dead_letter_cleared' : 'dead_letter_cleared',
      scope: getSyncItemScope(item),
      severity: isFinancial ? 'error' : 'warn',
      message: `${isFinancial ? 'Financial' : 'Sync'} dead-lettered operation was manually cleared without remote confirmation. Operation: ${item.table}, Queue ID: ${item._queue_id}, Last error: ${item.lastError || 'unknown'}. Verify manually that this was handled.`,
      at: new Date().toISOString(),
      context: {
        queue_id: item?._queue_id || null,
        table: item?.table || null,
        booking_id: getSyncItemBookingId(item),
        pos_order_id: getQueuedPosOrderId(item),
        last_error: item?.lastError || '',
        is_financial: isFinancial
      }
    });
    integrityAlertsRecorded++;
    console.warn('[Sync] Dead letter cleared without remote confirmation:', item._queue_id, item.table);
    appendOperationJournalEntry('manually_cleared', item, {
      financial: isFinancial,
      message: 'Manager cleared failed item without remote confirmation.'
    });
  }

  const remaining = failed.filter((item) => !itemsToRemove.some((r) => r?._queue_id === item?._queue_id));
  writeFailedSyncQueue(remaining);
  broadcastSyncStatus();
  return {
    success: true,
    removed: failed.length - remaining.length,
    financialCleared: financialCleared.length,
    integrityAlertsRecorded,
    remaining: remaining.length
  };
}

export async function runSyncNow() {
  if (!state.isOnline) {
    await checkOnline();
  }
  if (!state.isOnline) return { success: false, error: 'Offline — cannot sync right now.' };
  if (!state.replayAuthReady) return { success: false, error: 'No authenticated session — please log in first.' };
  await requeueEligibleFailedSyncItems();
  const result = /** @type {{success?: boolean, [key: string]: unknown}} */ (await processSyncQueue());
  return result?.success === false ? result : { success: true };
}

export function getOfflineModeState() {
  return {
    ...readOfflineModeState(),
    operationJournal: getOperationJournalSummary()
  };
}

/** @param {{enabled?: boolean, reason?: string, acknowledged?: boolean, updatedBy?: string|null}} [options] */
export function setOfflineModeState({ enabled, reason = '', acknowledged = false, updatedBy = null } = {}) {
  if (enabled === true && acknowledged !== true) {
    return {
      success: false,
      error: 'A manager must acknowledge that local values are pending until cloud replay confirms them.'
    };
  }
  const next = /** @type {OfflineModeExpectedView} */ (writeOfflineModeState({
    enabled: enabled === true,
    reason: String(reason || '').slice(0, 500),
    updatedBy: updatedBy || state.currentUser?.id || null,
    acknowledgedRisksAt: enabled === true ? new Date().toISOString() : undefined
  }));
  appendOperationJournalEntry(enabled === true ? 'offline_mode_enabled' : 'offline_mode_disabled', {
    type: 'control',
    table: 'lodge_offline_mode',
    _queue_id: `offline-mode-${Date.now()}`,
    data: { reason: next.reason, enabled: next.enabled }
  }, {
    includeSnapshot: false,
    message: next.enabled
      ? 'Lodge offline mode was enabled by a manager.'
      : 'Lodge offline mode was disabled by a manager.'
  });
  broadcastSyncStatus();
  return { success: true, offlineMode: next };
}

/** @param {Record<string, unknown>} [extra] */
export function buildOfflineOperationsBundle(extra = {}) {
  return buildLocalOperationsBundle(extra);
}

/** @param {string} filePath @param {Record<string, unknown>} [extra] */
export function exportOfflineOperationsBundle(filePath, extra = {}) {
  const result = writeLocalOperationsBundle(filePath, extra);
  broadcastSyncStatus();
  return result;
}
