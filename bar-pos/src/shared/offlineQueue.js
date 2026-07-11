export function createQueueItem({ functionName, payload, entityType, entityId, dependsOn = null, id: stableId = null }) {
  const id = stableId || `${entityType}-${entityId || crypto.randomUUID()}`
  return { id, type: 'rpc', functionName, payload, status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), attempts: 0, lastError: null, dependsOn, entityType, entityId }
}

export function isQueueItemReady(item, allItems) {
  if (!item.dependsOn) return true
  const dep = allItems.find(i => i.id === item.dependsOn)
  return dep ? dep.status === 'synced' : false
}

export function markItemSyncing(item) {
  return { ...item, status: 'syncing', updatedAt: new Date().toISOString() }
}

export function markItemSynced(item) {
  return { ...item, status: 'synced', updatedAt: new Date().toISOString() }
}

export function markItemFailed(item, error) {
  return { ...item, status: 'failed', attempts: item.attempts + 1, lastError: String(error), updatedAt: new Date().toISOString() }
}

export function isNetworkError(err) {
  const msg = String(err?.message || err || '').toLowerCase()
  return msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('econnreset')
}
