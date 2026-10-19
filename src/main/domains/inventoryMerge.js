// @ts-check

/** @typedef {Record<string, unknown>} InventoryMergeRow */

import { readCache } from './cacheStore.js';

/**
 * Cache rows are unvalidated JSON; output remains unknown-valued while the
 * merge preserves pending local inventory operations and server row order.
 * @param {unknown} [remoteRows]
 * @param {unknown} [localRows]
 * @returns {unknown[]}
 */
export function mergeRemoteInventoryWithLocalState(remoteRows = [], localRows = readCache('inventory-items')) {
  const remoteIds = new Set(/** @type {unknown[]} */ (remoteRows || []).map((row) => /** @type {InventoryMergeRow | null | undefined} */ (row)?.id).filter(Boolean));
  const protectedLocalRows = /** @type {unknown[]} */ (localRows || []).filter((row) => {
    const record = /** @type {InventoryMergeRow | null | undefined} */ (row);
    return record?._pending_sync ||
      ['pending', 'failed', 'sync_failed', 'manual_review_required'].includes(String(record?._sync_state || ''));
  });
  const localOnlyRows = protectedLocalRows.filter((row) => {
    const record = /** @type {InventoryMergeRow | null | undefined} */ (row);
    return record?.id && !remoteIds.has(record.id);
  });
  const combined = [...localOnlyRows, .../** @type {Iterable<unknown>} */ (remoteRows || [])];
  return combined.sort((a, b) => {
    const left = /** @type {InventoryMergeRow | null | undefined} */ (a);
    const right = /** @type {InventoryMergeRow | null | undefined} */ (b);
    const catComp = String(left?.category || '').localeCompare(String(right?.category || ''));
    if (catComp !== 0) return catComp;
    return String(left?.name || '').localeCompare(String(right?.name || ''));
  });
}
