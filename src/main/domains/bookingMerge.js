import { readCache } from './cacheStore.js';

export function mergeRemoteBookingsWithLocalState(remoteRows = [], localRows = readCache('bookings')) {
  const remoteIds = new Set((remoteRows || []).map((row) => row?.id).filter(Boolean));
  const protectedLocalRows = (localRows || []).filter((row) =>
  row?._pending_sync ||
  row?._pending_payment ||
  ['pending', 'failed', 'sync_failed', 'manual_review_required'].includes(String(row?._sync_state || ''))
  );
  const localOnlyRows = protectedLocalRows.filter((row) => row?.id && !remoteIds.has(row.id));
  return [...localOnlyRows, ...(remoteRows || [])];
}
