function randomUUID() {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function createQueueItem({
  functionName,
  payload,
  entityType,
  entityId,
  dependsOn = null
}) {
  const id = `pos-${entityType}-${entityId || randomUUID()}`;
  return {
    id,
    type: 'rpc',
    functionName,
    payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    dependsOn,
    entityType,
    entityId
  };
}

export function isQueueItemReady(item, allItems) {
  if (!item.dependsOn) return true;
  const dependency = allItems.find((i) => i.id === item.dependsOn);
  if (!dependency) return true;
  return dependency.status === 'synced';
}

export function markItemSyncing(item) {
  return {
    ...item,
    status: 'syncing',
    updatedAt: new Date().toISOString()
  };
}

export function markItemSynced(item) {
  return {
    ...item,
    status: 'synced',
    updatedAt: new Date().toISOString()
  };
}

export function markItemFailed(item, error) {
  return {
    ...item,
    status: item.attempts >= 3 ? 'manual_review_required' : 'failed',
    lastError: String(error || ''),
    attempts: (item.attempts || 0) + 1,
    updatedAt: new Date().toISOString()
  };
}

export function isNetworkError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    msg.includes('not reachable') ||
    msg.includes('failed to fetch') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('aborted') ||
    msg.includes('load failed') ||
    msg.includes('networkrequestfailed')
  );
}

export function isBusinessError(error) {
  return !isNetworkError(error);
}
