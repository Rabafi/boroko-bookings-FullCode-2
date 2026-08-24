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

export function isQueuedDependencyResolved(dependencyId) {
  const normalizedDependencyId = String(dependencyId || '').trim();
  if (!normalizedDependencyId) return false;

  const target = QUEUED_DEPENDENCY_CACHE_MAP.find(({ prefix }) => normalizedDependencyId.startsWith(prefix));
  if (!target) return false;

  const entityId = normalizedDependencyId.slice(target.prefix.length).trim();
  if (!entityId) return false;

  const cachedRow = readCache(target.cache).find((entry) => entry?.[target.idField || 'id'] === entityId);
  if (!cachedRow) return false;

  return cachedRow._pending_sync !== true &&
  cachedRow._sync_state !== 'manual_review_required' &&
  cachedRow._sync_state !== 'failed';
}

function buildSyncGroupedCountsForStatus(pending = [], failed = []) {
  const classify = (item = {}, queuePending = [], queueFailed = []) => {
    const dependencyIds = [...new Set([
      item?._depends_on,
      ...(Array.isArray(item?._depends_on_all) ? item._depends_on_all : [])
    ].map((value) => String(value || '').trim()).filter(Boolean))];
    if (dependencyIds.length === 0) return 'none';

    if (dependencyIds.some((dependencyId) => queueFailed.some((entry) => entry?._queue_id === dependencyId))) return 'blocked_dependencies';
    if (dependencyIds.some((dependencyId) => queuePending.some((entry) => entry?._queue_id === dependencyId))) return 'blocked_dependencies';
    if (dependencyIds.every((dependencyId) => isQueuedDependencyResolved(dependencyId))) return 'resolved';
    return 'resolved';
  };

  const pendingMissingParent = pending.filter((item) => classify(item, pending, failed) === 'missing_parent').length;
  const failedMissingParent = failed.filter((item) => classify(item, pending, failed) === 'missing_parent').length;
  const pendingBlockedDependencies = pending.filter((item) => classify(item, pending, failed) === 'blocked_dependencies').length;
  const failedBlockedDependencies = failed.filter((item) => classify(item, pending, failed) === 'blocked_dependencies').length;
  const financialRiskItems = pending.filter(isFinancialSyncItem).length + failed.filter(isFinancialSyncItem).length;

  return {
    missing_parent: pendingMissingParent + failedMissingParent,
    blocked_dependencies: pendingBlockedDependencies + failedBlockedDependencies,
    financial_risk_items: financialRiskItems,
    failed_items: failed.length,
    pending_items: pending.length
  };
}

export function buildSyncStatusSnapshot() {
  const queue = readSyncQueue();
  const failed = readFailedSyncQueue();
  const faults = readHealthFaults();
  const syncMeta = readSyncMeta();
  const extractBookingId = (item) =>
  item?.data?.p_booking_id ||
  item?.data?.payload?.booking_id ||
  item?.data?.payload?.id ||
  item?.data?.p_id ||
  item?._local_booking_id ||
  null;

  const failedBookingIds = failed.
  filter((item) => ['create_booking', 'create_booking_record', 'update_booking'].includes(item.table)).
  map((item) => item.data?.p_booking_id || item.data?.payload?.id || item.data?.p_id).
  filter(Boolean);
  const financialPendingBookingIds = [...new Set(
    queue.
    filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table)).
    map(extractBookingId).
    filter(Boolean)
  )];
  const financialFailedBookingIds = [...new Set(
    failed.
    filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table)).
    map(extractBookingId).
    filter(Boolean)
  )];
  const financialPendingCount = queue.filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table)).length;
  const financialFailedCount = failed.filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table)).length;
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
