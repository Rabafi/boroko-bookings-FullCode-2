// @ts-check

/** @typedef {Record<string, unknown>} BookingMergeRow */

import { readCache } from './cacheStore.js';

/**
 * Remote rows are supplied by the database facade; local rows come from
 * unvalidated JSON cache reads. Return rows as unknown to avoid claiming the
 * cached payload has a validated booking shape.
 * @param {unknown} [remoteRows]
 * @param {unknown} [localRows]
 * @returns {unknown[]}
 */
export function mergeRemoteBookingsWithLocalState(remoteRows = [], localRows = readCache('bookings')) {
  const remoteIds = new Set(/** @type {unknown[]} */ (remoteRows || []).map((row) => /** @type {BookingMergeRow | null | undefined} */ (row)?.id).filter(Boolean));
  const protectedLocalRows = /** @type {unknown[]} */ (localRows || []).filter((row) => {
    const record = /** @type {BookingMergeRow | null | undefined} */ (row);
    return record?._pending_sync ||
      record?._pending_payment ||
      ['pending', 'failed', 'sync_failed', 'manual_review_required'].includes(String(record?._sync_state || ''));
  });
  const localOnlyRows = protectedLocalRows.filter((row) => {
    const record = /** @type {BookingMergeRow | null | undefined} */ (row);
    return record?.id && !remoteIds.has(record.id);
  });
  return [...localOnlyRows, .../** @type {Iterable<unknown>} */ (remoteRows || [])];
}
