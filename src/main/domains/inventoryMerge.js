import { readCache } from './cacheStore.js';

export function mergeRemoteInventoryWithLocalState(remoteRows = [], localRows = readCache('inventory-items')) {
  const remoteIds = new Set((remoteRows || []).map((row) => row?.id).filter(Boolean));
  const protectedLocalRows = (localRows || []).filter((row) =>
    row?._pending_sync ||
    ['pending', 'failed', 'sync_failed', 'manual_review_required'].includes(String(row?._sync_state || ''))
  );
  const localOnlyRows = protectedLocalRows.filter((row) => row?.id && !remoteIds.has(row.id));
  const combined = [...localOnlyRows, ...(remoteRows || [])];
  return combined.sort((a, b) => {
    const catComp = String(a.category || '').localeCompare(String(b.category || ''));
    if (catComp !== 0) return catComp;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}
