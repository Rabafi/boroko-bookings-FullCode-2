// @ts-check
import { state } from '../state.js';
import { FINANCIAL_SYNC_TABLES, isFinancialSyncItem } from '../../shared/syncQueue.js';
import { readCache } from './cacheStore.js';
import {
  readFailedSyncQueue,
  readHealthFaults,
  readOfflineModeState,
  getOperationJournalSummary,
  readSyncMeta,
  readSyncQueue
} from './syncStore.js';
import { getMeshHealthSnapshot } from './mesh/meshState.js';

/** @typedef {{_queue_id?: unknown, _depends_on?: unknown, _depends_on_all?: unknown, table?: string, data?: SyncStatusQueueData | null, _pending_sync?: unknown, _sync_state?: unknown, _local_booking_id?: unknown}} SyncStatusQueueItem */
/** @typedef {{p_booking_id?: unknown, payload?: {booking_id?: unknown, id?: unknown} | null, p_id?: unknown}} SyncStatusQueueData */
/** @typedef {{lastSuccessfulSyncAt?: unknown, lastSyncStartedAt?: unknown, lastSyncFinishedAt?: unknown, lastSyncOutcome?: unknown, lastSyncError?: unknown, replayAuthNotReadyAt?: unknown}} SyncStatusMetaView */
/** @typedef {Record<string, unknown>} SyncCacheRowExpectation */

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
{ prefix: 'pool-day-use-', cache: 'pool-day-use' }];

/** @param {unknown} dependencyId @returns {boolean} */
export function isQueuedDependencyResolved(dependencyId) {
  const resolved = createDependencyCacheResolver().isResolved(dependencyId);
  return resolved;
}

// Single-id dependency checks read a whole cache file per id. A queue item
// can legally carry thousands of dependency ids (e.g. a cash-up fanning out
// to every unsynced order of a bulk offline run), so resolving them one file
// read at a time blocks the main thread for minutes — every sync-status
// broadcast and every 30s UI poll froze the app on a 4.5MB pos-orders cache.
// A resolver parses each touched cache file ONCE per status computation and
// serves the rest from an in-memory index. Same resolution semantics as
// isQueuedDependencyResolved; scoped to one computation, never shared across
// calls, so later file writes are always picked up fresh.
/** @returns {{isResolved: (dependencyId: unknown) => boolean}} */
export function createDependencyCacheResolver() {
  /** @type {Map<string, unknown[]>} */
  const rowsByCache = new Map();
  /** @type {Map<string, Map<string, unknown>>} */
  const indexByCacheField = new Map();
  /** @param {string} cacheName @returns {unknown[]} */
  const readOnce = (cacheName) => {
    if (!rowsByCache.has(cacheName)) {
      const rows = readCache(cacheName);
      // Only the array container is narrowed; persisted row values remain unknown.
      rowsByCache.set(cacheName, Array.isArray(rows) ? /** @type {unknown[]} */ (rows) : []);
    }
    // A cache entry is populated above before this lookup; retain an empty
    // array fallback for TypeScript's Map.get undefined branch.
    return rowsByCache.get(cacheName) || [];
  };
  /** @param {string} cacheName @param {string} idField @param {string} entityId @returns {unknown | null} */
  const findRow = (cacheName, idField, entityId) => {
    const mapKey = `${cacheName}::${idField}`;
    if (!indexByCacheField.has(mapKey)) {
      /** @type {Map<string, unknown>} */
      const index = new Map();
      for (const row of readOnce(cacheName)) {
        // Type-only view for the original property read; cache rows are not validated.
        const rowView = /** @type {SyncCacheRowExpectation | null | undefined} */ (row);
        const key = rowView?.[idField];
        if (key !== undefined && key !== null && !index.has(String(key))) index.set(String(key), row);
      }
      indexByCacheField.set(mapKey, index);
    }
    // The index is installed above before this lookup.
    return indexByCacheField.get(mapKey)?.get(String(entityId)) || null;
  };
  /** @param {unknown} dependencyId @returns {boolean} */
  const isResolved = (dependencyId) => {
    const normalizedDependencyId = String(dependencyId || '').trim();
    if (!normalizedDependencyId) return false;

    const target = QUEUED_DEPENDENCY_CACHE_MAP.find(({ prefix }) => normalizedDependencyId.startsWith(prefix));
    if (!target) return false;

    const entityId = normalizedDependencyId.slice(target.prefix.length).trim();
    if (!entityId) return false;

    const cachedRow = findRow(target.cache, target.idField || 'id', entityId);
    if (!cachedRow) return false;

    // This type-only view does not validate rows read from persistent cache.
    const rowView = /** @type {SyncCacheRowExpectation} */ (cachedRow);
    return rowView._pending_sync !== true &&
    rowView._sync_state !== 'manual_review_required' &&
    rowView._sync_state !== 'failed';
  };
  return { isResolved };
}

/** @param {SyncStatusQueueItem[]} [pending] @param {SyncStatusQueueItem[]} [failed] */
function buildSyncGroupedCountsForStatus(pending = [], failed = []) {
  const resolver = createDependencyCacheResolver();
  // Build id sets once per status computation. Rebuilding them per item is
  // O(n^2) and froze the app for minutes on 3k+ backlogs every 30s poll.
  const pendingIds = new Set((pending || []).map((entry) => entry?._queue_id).filter(Boolean));
  const failedIds = new Set((failed || []).map((entry) => entry?._queue_id).filter(Boolean));
  /** @param {SyncStatusQueueItem} [item] @returns {'none' | 'blocked_dependencies' | 'resolved'} */
  const classify = (item = {}) => {
    const dependencyIds = [...new Set([
      item?._depends_on,
      ...(Array.isArray(item?._depends_on_all) ? item._depends_on_all : [])
    ].map((value) => String(value || '').trim()).filter(Boolean))];
    if (dependencyIds.length === 0) return 'none';

    if (dependencyIds.some((dependencyId) => failedIds.has(dependencyId))) return 'blocked_dependencies';
    if (dependencyIds.some((dependencyId) => pendingIds.has(dependencyId))) return 'blocked_dependencies';
    if (dependencyIds.every((dependencyId) => resolver.isResolved(dependencyId))) return 'resolved';
    return 'resolved';
  };

  const pendingMissingParent = pending.filter((item) => classify(item) === 'missing_parent').length;
  const failedMissingParent = failed.filter((item) => classify(item) === 'missing_parent').length;
  const pendingBlockedDependencies = pending.filter((item) => classify(item) === 'blocked_dependencies').length;
  const failedBlockedDependencies = failed.filter((item) => classify(item) === 'blocked_dependencies').length;
  const financialRiskItems = pending.filter(isFinancialSyncItem).length + failed.filter(isFinancialSyncItem).length;

  return {
    missing_parent: pendingMissingParent + failedMissingParent,
    blocked_dependencies: pendingBlockedDependencies + failedBlockedDependencies,
    financial_risk_items: financialRiskItems,
    failed_items: failed.length,
    pending_items: pending.length
  };
}

/** @returns {import('../../shared/desktopIpcContracts.js').FullSyncStatusSnapshot} */
export function buildSyncStatusSnapshot() {
  const queue = /** @type {SyncStatusQueueItem[]} */ (readSyncQueue());
  const failed = /** @type {SyncStatusQueueItem[]} */ (readFailedSyncQueue());
  const faults = readHealthFaults();
  const syncMeta = /** @type {SyncStatusMetaView} */ (readSyncMeta());
  /** @param {SyncStatusQueueItem} item */
  const extractBookingId = (item) =>
  item?.data?.p_booking_id ||
  item?.data?.payload?.booking_id ||
  item?.data?.payload?.id ||
  item?.data?.p_id ||
  item?._local_booking_id ||
  null;

  const failedBookingIds = failed.
  filter((item) => ['create_booking', 'create_booking_record', 'update_booking'].includes(/** @type {string} */ (item.table))).
  map((item) => item.data?.p_booking_id || item.data?.payload?.id || item.data?.p_id).
  filter(Boolean);
  const financialPendingBookingIds = [...new Set(
    queue.
    filter((item) => FINANCIAL_SYNC_TABLES.has(/** @type {string} */ (item?.table))).
    map(extractBookingId).
    filter(Boolean)
  )];
  const financialFailedBookingIds = [...new Set(
    failed.
    filter((item) => FINANCIAL_SYNC_TABLES.has(/** @type {string} */ (item?.table))).
    map(extractBookingId).
    filter(Boolean)
  )];
  const financialPendingCount = queue.filter((item) => FINANCIAL_SYNC_TABLES.has(/** @type {string} */ (item?.table))).length;
  const financialFailedCount = failed.filter((item) => FINANCIAL_SYNC_TABLES.has(/** @type {string} */ (item?.table))).length;
  const groupedCounts = buildSyncGroupedCountsForStatus(queue, failed);
  // P0-1: lastSuccessfulSyncAt from memory first, fall back to persisted meta
  const resolvedLastSync = state.lastSuccessfulSyncAt || syncMeta.lastSuccessfulSyncAt || null;
  return {
    pending: queue.length,
    failed: failed.length,
    // P0-2: named fields as specified
    currentQueueLength: queue.length,
    currentDeadLetterWrites: failed.length,
    isOnline: state.isOnline,
    // P0-2: expose replay in-progress state
    syncInProgress: state.syncInProgress,
    replayAuthReady: state.replayAuthReady,
    failedBookingIds,
    financialPendingBookingIds,
    financialFailedBookingIds,
    financialPendingCount,
    financialFailedCount,
    groupedCounts,
    offlineMode: readOfflineModeState(),
    operationJournal: getOperationJournalSummary(),
    lastSuccessfulSyncAt: resolvedLastSync,
    // P0-1: full sync meta
    syncMeta: {
      lastSyncStartedAt: syncMeta.lastSyncStartedAt || null,
      lastSyncFinishedAt: syncMeta.lastSyncFinishedAt || null,
      lastSyncOutcome: syncMeta.lastSyncOutcome || null,
      lastSyncError: syncMeta.lastSyncError || '',
      replayAuthNotReadyAt: syncMeta.replayAuthNotReadyAt || null
    },
    // P0-4: expose corruption/integrity faults
    faults,
    cacheStale: {
      active: state.syncRefreshState.stale,
      names: state.syncRefreshState.names,
      attempts: state.syncRefreshState.attempts,
      lastError: state.syncRefreshState.lastError,
      lastFailedAt: state.syncRefreshState.lastFailedAt
    },
    // Expose local P2P mesh network coordinates and active peers
    mesh: getMeshHealthSnapshot()
  };
}
