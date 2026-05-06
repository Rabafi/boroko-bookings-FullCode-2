import fs from 'fs';
import path from 'path';
import { state } from '../state.js';

import {
  appendHealthFault,
  readFailedSyncQueue,
  readHealthFaults,
  readSyncMeta,
  readSyncQueue,
  writeFailedSyncQueue,
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
import { buildSyncStatusSnapshot } from './syncStatus.js';
import { markClearedSyncItemForManualReview, patchCachedPosOrderSyncState } from './syncCache.js';
import {
  DEAD_LETTER_AUTO_RETRY_AFTER_MS,
  ensureQueuedItem,
  getQueuedPosOrderId,
  getSyncItemBookingId,
  getSyncItemScope,
  isPosCreateOrderQueueItem,
  normalizeQueuedSyncItemForReplay
} from './syncShared.js';

const HEALTH_FAULTS_FILE = 'health-faults.json';
const CACHE_FRESHNESS_FILE = 'cache-freshness.json';
const QUEUED_DEPENDENCY_CACHE_MAP = [
  { prefix: 'booking-', cache: 'bookings' },
  { prefix: 'customer-', cache: 'customers' },
  { prefix: 'room-', cache: 'rooms' },
  { prefix: 'user-', cache: 'users' },
  { prefix: 'quotation-', cache: 'quotations' },
  { prefix: 'pos-order-', cache: 'pos-orders' },
  { prefix: 'conference-booking-', cache: 'conference-bookings' },
  { prefix: 'pool-day-use-', cache: 'pool-day-use' }
];

function isQueuedDependencyResolved(dependencyId) {
  const normalizedDependencyId = String(dependencyId || '').trim();
  if (!normalizedDependencyId) return false;

  const target = QUEUED_DEPENDENCY_CACHE_MAP.find(({ prefix }) => normalizedDependencyId.startsWith(prefix));
  if (!target) return false;

  const entityId = normalizedDependencyId.slice(target.prefix.length).trim();
  if (!entityId) return false;

  const cachedRow = readCache(target.cache).find((entry) => entry?.id === entityId);
  if (!cachedRow) return false;

  return cachedRow._pending_sync !== true &&
  cachedRow._sync_state !== 'manual_review_required' &&
  cachedRow._sync_state !== 'failed';
}

export function getSyncStatus() {
  return buildSyncStatusSnapshot();
}

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
    return { success: false, error: e.message };
  }
}

function readCacheFreshness() {
  if (!state.cacheDir) return {};
  try {
    const raw = fs.readFileSync(path.join(state.cacheDir, CACHE_FRESHNESS_FILE), 'utf-8');
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function classifySyncDependencyCategory(item = {}, pending = [], failed = []) {
  const dependencyId = String(item?._depends_on || '').trim();
  if (!dependencyId) return 'none';

  if (failed.some((entry) => entry?._queue_id === dependencyId)) {
    return 'blocked_dependencies';
  }
  if (pending.some((entry) => entry?._queue_id === dependencyId)) {
    return 'blocked_dependencies';
  }
  if (isQueuedDependencyResolved(dependencyId)) {
    return 'resolved';
  }
  return 'missing_parent';
}

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

function getSyncDisplayError(item = {}, dependencyCategory = 'none') {
  if (dependencyCategory === 'missing_parent') return 'Blocked: missing parent sync item';
  if (dependencyCategory === 'blocked_dependencies' && /Skipped: parent operation failed/i.test(String(item?.lastError || ''))) {
    return 'Blocked: parent sync item failed';
  }
  return item?.lastError || '';
}

function buildSyncGroupedCounts(pending = [], failed = []) {
  const pendingMissingParent = pending.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'missing_parent').length;
  const failedMissingParent = failed.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'missing_parent').length;
  const pendingBlockedDependencies = pending.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'blocked_dependencies').length;
  const failedBlockedDependencies = failed.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'blocked_dependencies').length;
  const financialRiskItems = pending.filter(isFinancialSyncItem).length + failed.filter(isFinancialSyncItem).length;

  return {
    missing_parent: pendingMissingParent + failedMissingParent,
    blocked_dependencies: pendingBlockedDependencies + failedBlockedDependencies,
    financial_risk_items: financialRiskItems,
    failed_items: failed.length,
    pending_items: pending.length
  };
}

export function getSyncDetails() {
  const pending = readSyncQueue();
  const failed = readFailedSyncQueue();
  const faults = readHealthFaults();
  const syncMeta = readSyncMeta();
  const cacheFreshness = readCacheFreshness();
  const resolvedLastSync = state.lastSuccessfulSyncAt || syncMeta.lastSuccessfulSyncAt || null;
  const now = Date.now();

  const enrichPending = (item) => {
    const dependencyCategory = classifySyncDependencyCategory(item, pending, failed);
    return {
      ...item,
      isFinancial: isFinancialSyncItem(item),
      dependencyState: item?._depends_on ?
      failed.some((f) => f?._queue_id === item._depends_on) ?
      'failed_parent' :
      pending.some((p) => p?._queue_id === item._depends_on) ?
      'waiting_for_parent' :
      'ready_or_external' :
      'none',
      dependencyCategory,
      dependencyLabel: getSyncDependencyLabel(dependencyCategory)
    };
  };

  const enrichFailed = (item) => {
    const attemptedAtMs = item.lastAttemptedAt ? Date.parse(item.lastAttemptedAt) : NaN;
    const ageMs = Number.isNaN(attemptedAtMs) ? null : now - attemptedAtMs;
    const isAutoRetryable = item.manualRetryOnly !== true;
    const nextAutoRetryAt = isAutoRetryable && !Number.isNaN(attemptedAtMs) ?
    new Date(attemptedAtMs + DEAD_LETTER_AUTO_RETRY_AFTER_MS).toISOString() :
    null;
    const autoRetryEligible = isAutoRetryable && (Number.isNaN(attemptedAtMs) || ageMs >= DEAD_LETTER_AUTO_RETRY_AFTER_MS);
    const dependencyCategory = classifySyncDependencyCategory(item, pending, failed);
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

  const extractBookingId = (item) =>
  item?.data?.p_booking_id || item?.data?.payload?.booking_id || item?.data?.payload?.id || item?.data?.p_id || item?._local_booking_id || null;

  const financialPendingBookingIds = [...new Set(pending.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).map(extractBookingId).filter(Boolean))];
  const financialFailedBookingIds = [...new Set(failed.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).map(extractBookingId).filter(Boolean))];
  const financialPendingCount = pending.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).length;
  const financialFailedCount = failed.filter((i) => FINANCIAL_SYNC_TABLES.has(i?.table)).length;
  const groupedCounts = buildSyncGroupedCounts(pending, failed);
  const unresolvedLocal = [
  ...readCache('bookings').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'booking', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('customers').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'customer', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('rooms').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'room', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('users').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'user', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('quotations').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'quotation', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('pos-orders').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'pos-order', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('conference-bookings').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'conference-booking', id: row.id, sync_state: row._sync_state || 'pending' })),
  ...readCache('pool-day-use').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'pool-day-use', id: row.id, sync_state: row._sync_state || 'pending' }))];

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

export async function retrySyncItems(queueIds = []) {
  const failed = readFailedSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const targetIds = new Set((queueIds || []).filter(Boolean));
  const shouldRetryAll = targetIds.size === 0;
  const retryItems = failed.filter((item) => shouldRetryAll || targetIds.has(item._queue_id));
  if (retryItems.length === 0) return { success: true, retried: 0, remaining: failed.length };

  const keepFailed = failed.filter((item) => !retryItems.some((entry) => entry._queue_id === item._queue_id));
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'));
  const existingIds = new Set(queue.map((item) => item._queue_id));
  for (const item of retryItems) {
    const cleanItem = normalizeQueuedSyncItemForReplay({
      ...item,
      _state: 'pending',
      retryCount: Math.max(0, Number(item.retryCount || 1) - 1),
      lastError: '',
      lastAttemptedAt: null
    });
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
    if (!existingIds.has(cleanItem._queue_id)) queue.push(cleanItem);
  }
  writeFailedSyncQueue(keepFailed);
  writeSyncQueue(queue);
  if (state.isOnline) await processSyncQueue();
  return { success: true, retried: retryItems.length, remaining: keepFailed.length };
}

export function clearSyncFailed(queueIds = []) {
  const failed = readFailedSyncQueue();
  const targetIds = new Set((queueIds || []).filter(Boolean));
  const shouldClearAll = targetIds.size === 0;
  const itemsToRemove = shouldClearAll ?
  failed :
  failed.filter((item) => targetIds.has(item?._queue_id));

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
  const result = await processSyncQueue();
  return result?.success === false ? result : { success: true };
}
