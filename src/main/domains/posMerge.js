// @ts-check

/** @typedef {Record<string, unknown>} PosOrderMergeRow */

import { readCache } from './cacheStore.js';

/**
 * Cached queue/order JSON is not runtime-validated. Keep merged row elements
 * unknown while retaining local pending-operation precedence.
 * @param {unknown} [remoteRows]
 * @param {unknown} [localRows]
 * @returns {unknown[]}
 */
export function mergeRemotePosOrdersWithLocalState(remoteRows = [], localRows = readCache('pos-orders')) {
  const remoteIds = new Set(/** @type {unknown[]} */ (remoteRows || []).map((row) => /** @type {PosOrderMergeRow | null | undefined} */ (row)?.id).filter(Boolean));
  const protectedLocalRows = /** @type {unknown[]} */ (localRows || []).filter((row) => {
    const record = /** @type {PosOrderMergeRow | null | undefined} */ (row);
    return record?._pending_sync ||
      ['pending', 'failed', 'sync_failed', 'manual_review_required'].includes(String(record?._sync_state || ''));
  });
  const localOnlyRows = protectedLocalRows.filter((row) => {
    const record = /** @type {PosOrderMergeRow | null | undefined} */ (row);
    return record?.id && !remoteIds.has(record.id);
  });
  return [...localOnlyRows, .../** @type {Iterable<unknown>} */ (remoteRows || [])];
}
