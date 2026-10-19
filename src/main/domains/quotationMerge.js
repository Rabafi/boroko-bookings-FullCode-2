// @ts-check

/** @typedef {Record<string, unknown>} QuotationMergeRow */

import { readCache } from './cacheStore.js';

/**
 * Local cache rows remain unvalidated; output elements are unknown so callers
 * cannot mistake the preserved offline operation rows for checked quotations.
 * @param {unknown} [remoteRows]
 * @param {unknown} [localRows]
 * @returns {unknown[]}
 */
export function mergeRemoteQuotationsWithLocalState(
  remoteRows = [],
  localRows = readCache('quotations')
) {
  const remoteIds = new Set(/** @type {unknown[]} */ (remoteRows || []).map((row) => /** @type {QuotationMergeRow | null | undefined} */ (row)?.id).filter(Boolean));
  const protectedLocalRows = /** @type {unknown[]} */ (localRows || []).filter((row) => {
    const record = /** @type {QuotationMergeRow | null | undefined} */ (row);
    return record?._pending_sync ||
      record?._pending_conversion ||
      ['pending', 'failed', 'sync_failed', 'manual_review_required'].includes(
        String(record?._sync_state || '')
      );
  });
  const localOnlyRows = protectedLocalRows.filter((row) => {
    const record = /** @type {QuotationMergeRow | null | undefined} */ (row);
    return record?.id && !remoteIds.has(record.id);
  });
  return [...localOnlyRows, .../** @type {Iterable<unknown>} */ (remoteRows || [])];
}
