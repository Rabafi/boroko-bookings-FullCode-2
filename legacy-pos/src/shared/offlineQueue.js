// @ts-check
/**
 * @typedef {'pending' | 'syncing' | 'synced' | 'failed' | 'manual_review_required'} QueueItemStatus
 * @typedef {object} QueueItem
 * @property {string} id
 * @property {'rpc'} type
 * @property {string} functionName
 * @property {unknown} payload
 * @property {QueueItemStatus} status
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {number} attempts
 * @property {string | null} lastError
 * @property {string | null} dependsOn
 * @property {string} entityType
 * @property {string | number | null | undefined} entityId
 */

function randomUUID() {
  // Electron 22's Node runtime exposes this Web Crypto API. The Legacy
  // ES2020-only checker intentionally excludes Node and DOM ambient types.
  /** @type {typeof globalThis & {crypto?: {randomUUID?: () => string}}} */
  const runtimeGlobal = globalThis;
  if (typeof runtimeGlobal.crypto !== 'undefined' && runtimeGlobal.crypto.randomUUID) {
    return runtimeGlobal.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * @param {object} input
 * @param {string} input.functionName
 * @param {unknown} input.payload
 * @param {string} input.entityType
 * @param {string | number | null | undefined} input.entityId
 * @param {string | null} [input.dependsOn]
 * @param {string | null} [input.id]
 * @returns {QueueItem}
 */
export function createQueueItem({
  functionName,
  payload,
  entityType,
  entityId,
  dependsOn = null,
  id: stableId = null
}) {
  const id = stableId || `${entityType}-${entityId || randomUUID()}`;
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

/** @param {QueueItem} item @param {QueueItem[]} allItems @returns {boolean} */
export function isQueueItemReady(item, allItems) {
  if (!item.dependsOn) return true;
  const dependency = allItems.find((i) => i.id === item.dependsOn);
  if (!dependency) return false;
  return dependency.status === 'synced';
}

/** @param {QueueItem} item @returns {QueueItem} */
export function markItemSyncing(item) {
  return {
    ...item,
    status: 'syncing',
    updatedAt: new Date().toISOString()
  };
}

/** @param {QueueItem} item @returns {QueueItem} */
export function markItemSynced(item) {
  return {
    ...item,
    status: 'synced',
    updatedAt: new Date().toISOString()
  };
}

/** @param {QueueItem} item @param {unknown} error @returns {QueueItem} */
export function markItemFailed(item, error) {
  return {
    ...item,
    status: item.attempts >= 3 ? 'manual_review_required' : 'failed',
    lastError: String(error || ''),
    attempts: (item.attempts || 0) + 1,
    updatedAt: new Date().toISOString()
  };
}

/** @param {unknown} error @returns {boolean} */
export function isNetworkError(error) {
  const msg = String(/** @type {{message?: unknown} | null | undefined} */ (error)?.message || error || '').toLowerCase();
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

/** @param {unknown} error @returns {boolean} */
export function isBusinessError(error) {
  return !isNetworkError(error);
}
