const SESSION_KEY = 'boroko_manager_session'
const CACHE_PREFIX = 'boroko_pwa_cache'
const QUEUE_PREFIX = 'boroko_pwa_queue'
const META_PREFIX = 'boroko_pwa_meta'
const ISSUE_LOG_LIMIT = 100

function readStorage(area, key, fallback) {
  if (!area) return fallback
  try {
    const raw = area.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeStorage(area, key, value) {
  if (!area) return
  try {
    area.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage write failures on constrained browsers.
  }
}

function removeStorage(area, key) {
  if (!area) return
  try {
    area.removeItem(key)
  } catch {
    // Ignore storage removal failures.
  }
}

function getSessionStorageArea() {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function emit(name, detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

function scoped(prefix, lodgeId, key) {
  return `${prefix}:${String(lodgeId || 'global').trim().toLowerCase()}:${key}`
}

export function readLocalJson(key, fallback = null) {
  return readStorage(window.localStorage, key, fallback)
}

export function writeLocalJson(key, value) {
  writeStorage(window.localStorage, key, value)
}

export function removeLocalJson(key) {
  removeStorage(window.localStorage, key)
}

export function getSession() {
  const sessionArea = getSessionStorageArea()
  const current = readStorage(sessionArea, SESSION_KEY, null)
  if (current) return current

  const legacy = readLocalJson(SESSION_KEY, null)
  if (legacy && sessionArea) {
    writeStorage(sessionArea, SESSION_KEY, legacy)
    removeStorage(window.localStorage, SESSION_KEY)
  }
  return legacy
}

export function setSession(session) {
  writeStorage(getSessionStorageArea(), SESSION_KEY, session)
  removeStorage(window.localStorage, SESSION_KEY)
}

export function clearSession() {
  removeStorage(getSessionStorageArea(), SESSION_KEY)
  removeLocalJson(SESSION_KEY)
}

export function readCacheEntry(lodgeId, key, fallback = null) {
  return readLocalJson(scoped(CACHE_PREFIX, lodgeId, key), fallback)
}

export function readCacheData(lodgeId, key, fallback = null) {
  return readCacheEntry(lodgeId, key, null)?.data ?? fallback
}

export function writeCacheEntry(lodgeId, key, data) {
  const entry = {
    updatedAt: new Date().toISOString(),
    data
  }
  writeLocalJson(scoped(CACHE_PREFIX, lodgeId, key), entry)
  emit('boroko:pwa-cache', { lodgeId, key, updatedAt: entry.updatedAt })
  return entry
}

export function mutateCachedList(lodgeId, key, updater, fallback = []) {
  const current = readCacheData(lodgeId, key, fallback)
  const next = updater(Array.isArray(current) ? [...current] : [...fallback])
  writeCacheEntry(lodgeId, key, next)
  return next
}

export async function queryWithCache({ lodgeId, key, fetcher, fallback = [], forceFresh = false }) {
  const cached = readCacheEntry(lodgeId, key, null)

  if (!forceFresh && typeof navigator !== 'undefined' && navigator.onLine === false && cached) {
    return cached.data
  }

  try {
    const data = await fetcher()
    writeCacheEntry(lodgeId, key, data)
    return data
  } catch (error) {
    if (cached) return cached.data
    throw error
  }
}

export function getOfflineQueue(lodgeId) {
  return readLocalJson(scoped(QUEUE_PREFIX, lodgeId, 'items'), [])
}

export function setOfflineQueue(lodgeId, items) {
  writeLocalJson(scoped(QUEUE_PREFIX, lodgeId, 'items'), items)
  emit('boroko:pwa-queue', { lodgeId, count: items.length })
}

export function enqueueOfflineOperation(lodgeId, item) {
  const current = getOfflineQueue(lodgeId)
  const next = [...current, item]
  setOfflineQueue(lodgeId, next)
  return item
}

export function removeOfflineOperation(lodgeId, operationId) {
  const current = getOfflineQueue(lodgeId)
  const next = current.filter((item) => item.id !== operationId)
  setOfflineQueue(lodgeId, next)
  return next
}

export function clearOfflineQueue(lodgeId) {
  setOfflineQueue(lodgeId, [])
}

export function setRuntimeMeta(lodgeId, key, value) {
  writeLocalJson(scoped(META_PREFIX, lodgeId, key), {
    updatedAt: new Date().toISOString(),
    value
  })
}

export function getRuntimeMeta(lodgeId, key, fallback = null) {
  return readLocalJson(scoped(META_PREFIX, lodgeId, key), null)?.value ?? fallback
}

export function appendIssueLog(lodgeId, entry) {
  const key = scoped(META_PREFIX, lodgeId, 'issue-log')
  const current = readLocalJson(key, [])
  const nextEntry = {
    id: entry?.id || crypto.randomUUID(),
    createdAt: entry?.createdAt || new Date().toISOString(),
    scope: entry?.scope || 'general',
    severity: entry?.severity || 'error',
    message: entry?.message || 'Unexpected issue',
    detail: entry?.detail || '',
    context: entry?.context && typeof entry.context === 'object' ? entry.context : {}
  }
  const next = [nextEntry, ...(Array.isArray(current) ? current : [])].slice(0, ISSUE_LOG_LIMIT)
  writeLocalJson(key, next)
  emit('boroko:pwa-issues', { lodgeId, count: next.length })
  return nextEntry
}

export function readIssueLog(lodgeId, limit = 20) {
  const current = readLocalJson(scoped(META_PREFIX, lodgeId, 'issue-log'), [])
  return (Array.isArray(current) ? current : []).slice(0, Math.max(Number(limit) || 20, 1))
}

export function listCacheEntries(lodgeId) {
  const prefix = scoped(CACHE_PREFIX, lodgeId, '')
  return Object.keys(window.localStorage)
    .filter((key) => key.startsWith(prefix))
    .map((key) => {
      const entry = readLocalJson(key, null)
      const name = key.slice(prefix.length)
      const data = entry?.data
      return {
        key: name,
        updatedAt: entry?.updatedAt || null,
        size: Array.isArray(data) ? data.length : data && typeof data === 'object' ? Object.keys(data).length : 0
      }
    })
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
}

export function subscribeRuntimeEvent(name, listener) {
  if (typeof window === 'undefined') return () => {}
  const handler = (event) => listener(event.detail)
  window.addEventListener(name, handler)
  return () => window.removeEventListener(name, handler)
}

export function createQueuedOperation(type, label, payload) {
  return {
    id: crypto.randomUUID(),
    type,
    label,
    payload,
    createdAt: new Date().toISOString()
  }
}

export function getNotificationSettings() {
  return readLocalJson('boroko_pwa_notification_settings', {
    urgentAlerts: true,
    refunds: true,
    balances: true,
    maintenance: true
  })
}

export function setNotificationSettings(settings) {
  writeLocalJson('boroko_pwa_notification_settings', settings)
  emit('boroko:pwa-notification-settings', settings)
}
