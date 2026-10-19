// @ts-check
const SESSION_KEY = 'boroko_manager_session'
const CACHE_PREFIX = 'boroko_pwa_cache'
const QUEUE_PREFIX = 'boroko_pwa_queue'
const META_PREFIX = 'boroko_pwa_meta'
const ISSUE_LOG_LIMIT = 100
const NOTIFICATION_LIMIT = 40
const DISMISSED_NOTIFICATION_LIMIT = 120
const SEEN_NOTIFICATION_VERSION_LIMIT = 250
const TRUSTED_DEVICE_DAYS = 14
const DEFAULT_ONLINE_CACHE_MAX_AGE_MS = 60_000
const PWA_HEALTH_PUBLISH_MIN_MS = 20 * 60_000
const inFlightQueries = new Map()

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {{id: string, type: string, label: string, payload: unknown, createdAt: string}} QueuedOperation */

/** @param {unknown} value @returns {string} */
function normalizeNotificationPart(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** @param {string} value @returns {string} */
function hashNotificationParts(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

/** @param {unknown} scope @param {...unknown} parts @returns {string} */
export function buildPwaNotificationSourceKey(scope, ...parts) {
  const normalized = parts
    .map((part) => String(part ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('|')
  const slug = normalizeNotificationPart(parts[0] || 'item') || 'item'
  return `${scope || 'notification'}:${slug}:${normalized ? hashNotificationParts(normalized) : 'global'}`
}

/** @param {Storage | null} area @param {string} key @param {unknown} fallback @returns {unknown} */
function readStorage(area, key, fallback) {
  if (!area) return fallback
  try {
    const raw = area.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

/** @param {Storage | null} area @param {string} key @param {unknown} value @returns {void} */
function writeStorage(area, key, value) {
  if (!area) return
  try {
    area.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage write failures on constrained browsers.
  }
}

/** @param {Storage | null} area @param {string} key @returns {void} */
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

/** @param {string} name @param {unknown} detail @returns {void} */
function emit(name, detail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

/** @param {string} prefix @param {unknown} lodgeId @param {string} key @returns {string} */
function scoped(prefix, lodgeId, key) {
  return `${prefix}:${String(lodgeId || 'global').trim().toLowerCase()}:${key}`
}

/** @param {string} key @param {unknown} [fallback] @returns {unknown} */
export function readLocalJson(key, fallback = null) {
  return readStorage(window.localStorage, key, fallback)
}

/** @param {string} key @param {unknown} value @returns {void} */
export function writeLocalJson(key, value) {
  writeStorage(window.localStorage, key, value)
}

// Financial/support write-ahead records use a strict path. The general cache
// helpers remain best-effort, but a queue item is not safe to send until the
// browser confirms that the exact serialized envelope can be read back.
/** @param {string} key @param {unknown} value @returns {true} */
export function writeLocalJsonVerified(key, value) {
  const area = typeof window !== 'undefined' ? window.localStorage : null
  if (!area) throw new Error('Durable local storage is unavailable.')
  const serialized = JSON.stringify(value)
  area.setItem(key, serialized)
  if (area.getItem(key) !== serialized) throw new Error('Durable local storage did not retain the queue envelope.')
  return true
}

/** @param {string} key @returns {unknown} */
export function readLocalJsonVerified(key) {
  const area = typeof window !== 'undefined' ? window.localStorage : null
  if (!area) throw new Error('Durable local storage is unavailable.')
  const raw = area.getItem(key)
  return raw ? JSON.parse(raw) : null
}

/** @param {string} key @returns {void} */
function removeLocalJson(key) {
  removeStorage(window.localStorage, key)
}

/** @returns {unknown} */
export function getSession() {
  const trusted = readLocalJson(SESSION_KEY, null)
  if (trusted) return trusted
  return readStorage(getSessionStorageArea(), SESSION_KEY, null)
}

/** @param {JsonObject} session @returns {void} */
export function setSession(session) {
  const trustedUntil = new Date(Date.now() + TRUSTED_DEVICE_DAYS * 86400000).toISOString()
  const trustedSession = {
    ...session,
    trusted_device: true,
    trusted_until: trustedUntil,
    trusted_days: TRUSTED_DEVICE_DAYS
  }
  writeLocalJson(SESSION_KEY, trustedSession)
  writeStorage(getSessionStorageArea(), SESSION_KEY, trustedSession)
}

export function clearSession() {
  removeStorage(getSessionStorageArea(), SESSION_KEY)
  removeLocalJson(SESSION_KEY)
}

/** @param {unknown} lodgeId @param {string} key @param {unknown} [fallback] @returns {unknown} */
export function readCacheEntry(lodgeId, key, fallback = null) {
  return readLocalJson(scoped(CACHE_PREFIX, lodgeId, key), fallback)
}

/** @param {unknown} value @param {PropertyKey} key @returns {unknown} */
function readField(value, key) {
  if (value === null || value === undefined) return undefined
  // JSON localStorage content remains unknown; this preserves the existing
  // optional property read without asserting that the parsed value is valid.
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} value @param {PropertyKey} key @returns {unknown} */
function readDirectField(value, key) {
  if (value === null || value === undefined) {
    throw new TypeError(`Cannot read properties of ${value} (reading '${String(key)}')`)
  }
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} value @param {string} methodName @param {unknown[]} args @param {string} expression @returns {unknown} */
function callMethod(value, methodName, args, expression) {
  const method = readDirectField(value, methodName)
  if (typeof method !== 'function') throw new TypeError(`${expression} is not a function`)
  return Reflect.apply(method, value, args)
}

/** @param {unknown} value @param {string} expression @returns {IterableIterator<unknown>} */
function* iterateUnknown(value, expression) {
  if (value === null || value === undefined) throw new TypeError(`${expression} is not iterable`)
  const iteratorMethod = readDirectField(value, Symbol.iterator)
  if (typeof iteratorMethod !== 'function') throw new TypeError(`${expression} is not iterable`)
  const wrapped = {
    [Symbol.iterator]: () => Reflect.apply(iteratorMethod, value, [])
  }
  yield* wrapped
}

/** @param {unknown} lodgeId @param {string} key @param {unknown} [fallback] @returns {unknown} */
function readCacheData(lodgeId, key, fallback = null) {
  return readField(readCacheEntry(lodgeId, key, null), 'data') ?? fallback
}

/** @param {unknown} lodgeId @param {string} key @param {unknown} data */
export function writeCacheEntry(lodgeId, key, data) {
  const entry = {
    updatedAt: new Date().toISOString(),
    data
  }
  writeLocalJson(scoped(CACHE_PREFIX, lodgeId, key), entry)
  emit('boroko:pwa-cache', { lodgeId, key, updatedAt: entry.updatedAt })
  return entry
}

/** @param {unknown} lodgeId @param {string} key @param {(items: unknown[]) => unknown} updater @param {unknown[]} [fallback] */
export function mutateCachedList(lodgeId, key, updater, fallback = []) {
  const current = readCacheData(lodgeId, key, fallback)
  const next = updater(Array.isArray(current) ? [...current] : [...fallback])
  writeCacheEntry(lodgeId, key, next)
  return next
}

/** @param {unknown} entry @returns {number} */
function cacheAgeMs(entry) {
  const updatedAtMs = Date.parse(String(readField(entry, 'updatedAt') || ''))
  return Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Infinity
}

/** @param {{lodgeId: unknown, key: string, fetcher: () => Promise<unknown>, fallback?: unknown, forceFresh?: boolean, maxAgeMs?: number, allowStaleOnError?: boolean}} options @returns {Promise<unknown>} */
export async function queryWithCache({ lodgeId, key, fetcher, fallback = [], forceFresh = false, maxAgeMs = DEFAULT_ONLINE_CACHE_MAX_AGE_MS, allowStaleOnError = true }) {
  const cached = readCacheEntry(lodgeId, key, null)
  const onlineCacheMs = Math.max(Number(maxAgeMs) || 0, 0)
  const requestKey = scoped(CACHE_PREFIX, lodgeId, key)

  if (!forceFresh && cached && onlineCacheMs > 0 && cacheAgeMs(cached) <= onlineCacheMs) {
    return readField(cached, 'data')
  }

  if (!forceFresh && typeof navigator !== 'undefined' && navigator.onLine === false && cached) {
    return readField(cached, 'data')
  }

  const existingRequest = inFlightQueries.get(requestKey)
  if (existingRequest) return existingRequest

  let request
  request = (async () => {
    try {
      const data = await fetcher()
      writeCacheEntry(lodgeId, key, data)
      return data
    } catch (error) {
      if (cached && allowStaleOnError) return readField(cached, 'data')
      throw error
    } finally {
      if (inFlightQueries.get(requestKey) === request) {
        inFlightQueries.delete(requestKey)
      }
    }
  })()
  inFlightQueries.set(requestKey, request)

  return request
}

/** @param {unknown} lodgeId @returns {unknown} Persisted JSON is deliberately not validated here. */
export function getOfflineQueue(lodgeId) {
  return readLocalJson(scoped(QUEUE_PREFIX, lodgeId, 'items'), [])
}

/** @param {unknown} lodgeId @param {unknown} items */
export function setOfflineQueue(lodgeId, items) {
  const normalized = deduplicateQueueItems(items)
  // Queue state is recoverable operational work.  A best-effort localStorage
  // write can make a failed/blocked operation disappear after a flush, so use
  // the verified write-ahead path for every queue mutation (not only support).
  writeLocalJsonVerified(scoped(QUEUE_PREFIX, lodgeId, 'items'), normalized)
  const stored = readLocalJsonVerified(scoped(QUEUE_PREFIX, lodgeId, 'items'))
  if (!Array.isArray(stored) || JSON.stringify(stored) !== JSON.stringify(normalized)) {
    throw new Error('Offline work could not be durably persisted for recovery.')
  }
  emit('boroko:pwa-queue', { lodgeId, count: normalized.length })
  return normalized
}

/** @param {unknown} lodgeId @param {unknown} item */
export function enqueueOfflineOperation(lodgeId, item) {
  const current = getOfflineQueue(lodgeId)
  const hasSameId = /** @param {unknown} entry */ (entry) => readField(entry, 'id') === readField(item, 'id')
  const existing = callMethod(current, 'find', [hasSameId], 'current.find')
  if (existing) {
    if (JSON.stringify(readField(existing, 'payload')) !== JSON.stringify(readDirectField(item, 'payload'))) {
      const conflictError = /** @type {Error & {code: string}} */ (new Error('This queued operation was already used with different details.'))
      conflictError.code = 'idempotency_conflict'
      throw conflictError
    }
    return existing
  }
  const next = [...iterateUnknown(current, 'current'), item]
  setOfflineQueue(lodgeId, next)
  return item
}

/** @param {unknown} items @returns {unknown[]} */
function deduplicateQueueItems(items) {
  const byId = new Map()
  for (const item of Array.isArray(items) ? /** @type {unknown[]} */ (items) : []) {
    const id = readField(item, 'id')
    if (!id) continue
    const existing = byId.get(id)
    if (existing && JSON.stringify(readField(existing, 'payload')) !== JSON.stringify(readField(item, 'payload'))) {
      const conflictError = /** @type {Error & {code: string}} */ (new Error('The queue contains two different envelopes for one operation ID.'))
      conflictError.code = 'idempotency_conflict'
      throw conflictError
    }
    if (!existing) byId.set(id, item)
  }
  return [...byId.values()]
}

/** @param {unknown} lodgeId @param {QueuedOperation} item */
export function enqueueOfflineOperationVerified(lodgeId, item) {
  const key = scoped(QUEUE_PREFIX, lodgeId, 'items')
  const current = readLocalJsonVerified(key)
  const existing = Array.isArray(current)
    ? current.find((entry) => readField(entry, 'id') === readField(item, 'id'))
    : null
  if (existing) {
    if (JSON.stringify(readDirectField(existing, 'payload')) !== JSON.stringify(readDirectField(item, 'payload'))) {
      const conflictError = /** @type {Error & {code: string}} */ (new Error('This queued operation was already used with different details.'))
      conflictError.code = 'idempotency_conflict'
      throw conflictError
    }
    return existing
  }
  const next = [...(Array.isArray(current) ? current : []), item]
  const normalized = deduplicateQueueItems(next)
  writeLocalJsonVerified(key, normalized)
  const stored = readLocalJsonVerified(key)
  if (!Array.isArray(stored) || !stored.some((entry) => readField(entry, 'id') === readDirectField(item, 'id') && JSON.stringify(entry) === JSON.stringify(item))) {
    throw new Error('The support operation was not durably persisted. The server call was not sent.')
  }
  emit('boroko:pwa-queue', { lodgeId, count: stored.length })
  return item
}

/** @param {unknown} lodgeId @param {unknown} operationId @returns {true} */
export function removeOfflineOperation(lodgeId, operationId) {
  const key = scoped(QUEUE_PREFIX, lodgeId, 'items')
  const current = readLocalJsonVerified(key)
  const next = (Array.isArray(current) ? current : []).filter((item) => readField(item, 'id') !== operationId)
  writeLocalJsonVerified(key, next)
  const stored = readLocalJsonVerified(key)
  const hasOperationId = /** @param {unknown} item */ (item) => readField(item, 'id') === operationId
  if (callMethod(stored, 'some', [hasOperationId], 'stored.some')) throw new Error('The completed support operation could not be removed from local recovery storage.')
  emit('boroko:pwa-queue', { lodgeId, count: readDirectField(stored, 'length') })
  return true
}

/** @param {unknown} lodgeId @param {string} key @param {unknown} value */
/** @param {unknown} lodgeId @param {string} key @param {unknown} value */
export function setRuntimeMeta(lodgeId, key, value) {
  writeLocalJson(scoped(META_PREFIX, lodgeId, key), {
    updatedAt: new Date().toISOString(),
    value
  })
}

/** @param {unknown} lodgeId @param {string} key @param {unknown} [fallback] @returns {unknown} */
export function getRuntimeMeta(lodgeId, key, fallback = null) {
  return readField(readLocalJson(scoped(META_PREFIX, lodgeId, key), null), 'value') ?? fallback
}

/** @param {unknown} lodgeId @param {JsonObject} entry */
/** @param {unknown} lodgeId @param {JsonObject} entry */
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
  const next = [nextEntry, ...(Array.isArray(current) ? /** @type {unknown[]} */ (current) : [])].slice(0, ISSUE_LOG_LIMIT)
  writeLocalJson(key, next)
  emit('boroko:pwa-issues', { lodgeId, count: next.length })
  return nextEntry
}

/** @param {unknown} lodgeId @param {number} [limit] @returns {unknown[]} */
export function readIssueLog(lodgeId, limit = 20) {
  const current = readLocalJson(scoped(META_PREFIX, lodgeId, 'issue-log'), [])
  return (Array.isArray(current) ? /** @type {unknown[]} */ (current) : []).slice(0, Math.max(Number(limit) || 20, 1))
}

/** @param {unknown} lodgeId */
export function listCacheEntries(lodgeId) {
  const prefix = scoped(CACHE_PREFIX, lodgeId, '')
  return Object.keys(window.localStorage)
    .filter((key) => key.startsWith(prefix))
    .map((key) => {
      const entry = readLocalJson(key, null)
      const name = key.slice(prefix.length)
      const data = readField(entry, 'data')
      return {
        key: name,
        updatedAt: readField(entry, 'updatedAt') || null,
        size: Array.isArray(data) ? data.length : data && typeof data === 'object' ? Object.keys(data).length : 0
      }
    })
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
}

/** @param {string} name @param {(detail: unknown) => void} listener */
export function subscribeRuntimeEvent(name, listener) {
  if (typeof window === 'undefined') return () => {}
  /** @param {Event} event */
  const handler = (event) => listener(/** @type {CustomEvent<unknown>} */ (event).detail)
  window.addEventListener(name, handler)
  return () => window.removeEventListener(name, handler)
}

/** @param {string} type @param {string} label @param {unknown} payload @returns {QueuedOperation} */
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
    maintenance: true,
    frontDeskRequests: true,
    sound: false,
    vibration: false,
    urgentOnly: false,
    frontDeskReplies: true
  })
}

/** @param {unknown} settings */
export function setNotificationSettings(settings) {
  writeLocalJson('boroko_pwa_notification_settings', settings)
  emit('boroko:pwa-notification-settings', settings)
}

/** @param {unknown} lodgeId @returns {string} */
function notificationStoreKey(lodgeId) {
  return scoped(META_PREFIX, lodgeId, 'notifications')
}

/** @param {unknown} lodgeId @returns {string} */
function dismissedNotificationStoreKey(lodgeId) {
  return scoped(META_PREFIX, lodgeId, 'dismissed-notifications')
}

/** @param {unknown} lodgeId @returns {string} */
function seenNotificationVersionStoreKey(lodgeId) {
  return scoped(META_PREFIX, lodgeId, 'seen-notification-versions')
}

/** @param {unknown} message @returns {{body: string, sender_type: string, sender_name: string, sender_role: string, sender_surface: string}} */
function stableNotificationMessage(message) {
  return {
    body: String(readField(message, 'body') || readField(message, 'message') || '').trim(),
    sender_type: String(readField(message, 'sender_type') || '').trim(),
    sender_name: String(readField(message, 'sender_name') || '').trim(),
    sender_role: String(readField(message, 'sender_role') || '').trim(),
    sender_surface: String(readField(message, 'sender_surface') || '').trim()
  }
}

/** @param {unknown} [notification] @returns {string} */
function notificationFingerprint(notification = {}) {
  const rawMeta = readField(notification, 'meta')
  const meta = rawMeta && typeof rawMeta === 'object' ? rawMeta : {}
  const rawMessages = readField(meta, 'messages')
  const messages = Array.isArray(rawMessages) ? /** @type {unknown[]} */ (rawMessages).map(stableNotificationMessage) : []
  return JSON.stringify({
    title: String(readField(notification, 'title') || '').trim(),
    message: String(readField(notification, 'message') || '').trim(),
    tone: String(readField(notification, 'tone') || 'info').trim(),
    category: String(readField(notification, 'category') || 'general').trim(),
    href: readField(notification, 'href') || null,
    requestTitle: String(readField(meta, 'requestTitle') || '').trim(),
    requestBody: String(readField(meta, 'requestBody') || '').trim(),
    deskResponse: String(readField(meta, 'deskResponse') || '').trim(),
    requestStatus: String(readField(meta, 'requestStatus') || '').trim(),
    requestCategory: String(readField(meta, 'requestCategory') || '').trim(),
    requestPriority: String(readField(meta, 'requestPriority') || '').trim(),
    messageCount: messages.length,
    messages
  })
}

/** @param {unknown} lodgeId @returns {unknown[]} */
function getDismissedNotifications(lodgeId) {
  const current = readLocalJson(dismissedNotificationStoreKey(lodgeId), [])
  return Array.isArray(current) ? /** @type {unknown[]} */ (current) : []
}

/** @param {unknown} lodgeId @param {unknown} items */
function setDismissedNotifications(lodgeId, items) {
  writeLocalJson(
    dismissedNotificationStoreKey(lodgeId),
    (Array.isArray(items) ? /** @type {unknown[]} */ (items) : [])
      .sort((left, right) => String(readField(right, 'dismissedAt') || '').localeCompare(String(readField(left, 'dismissedAt') || '')))
      .slice(0, DISMISSED_NOTIFICATION_LIMIT)
  )
}

/** @param {unknown} lodgeId @param {unknown} sourceKey */
function clearDismissedNotification(lodgeId, sourceKey) {
  const current = getDismissedNotifications(lodgeId)
  const next = current.filter((item) => readField(item, 'sourceKey') !== sourceKey)
  if (next.length !== current.length) setDismissedNotifications(lodgeId, next)
}

/** @param {unknown} lodgeId @param {unknown} sourceKey @param {unknown} fingerprint @returns {boolean} */
function isDismissedNotification(lodgeId, sourceKey, fingerprint) {
  return getDismissedNotifications(lodgeId).some((item) => (
    readField(item, 'sourceKey') === sourceKey && readField(item, 'fingerprint') === fingerprint
  ))
}

/** @param {unknown} lodgeId @param {string} sourceKey @returns {unknown} */
export function getPwaNotificationSeenVersion(lodgeId, sourceKey) {
  if (!sourceKey) return null
  const current = readLocalJson(seenNotificationVersionStoreKey(lodgeId), {})
  return current && typeof current === 'object' ? Reflect.get(current, sourceKey) || null : null
}

/** @param {unknown} lodgeId @param {string} sourceKey @param {unknown} version */
export function setPwaNotificationSeenVersion(lodgeId, sourceKey, version) {
  if (!sourceKey || !version) return null
  const current = readLocalJson(seenNotificationVersionStoreKey(lodgeId), {})
  // The object check narrows the cache value enough for object spread while
  // preserving spread's own-property and __proto__ behavior.
  const next = current && typeof current === 'object' ? { ...current } : {}
  Reflect.set(next, sourceKey, {
    version: String(version),
    seenAt: new Date().toISOString()
  })
  const trimmed = Object.fromEntries(
    Object.entries(next)
      .sort((left, right) => String(readField(right[1], 'seenAt') || '').localeCompare(String(readField(left[1], 'seenAt') || '')))
      .slice(0, SEEN_NOTIFICATION_VERSION_LIMIT)
  )
  writeLocalJson(seenNotificationVersionStoreKey(lodgeId), trimmed)
  return trimmed[sourceKey]
}

/** @param {unknown} lodgeId @param {number} [limit] @returns {unknown[]} */
export function listPwaNotifications(lodgeId, limit = NOTIFICATION_LIMIT) {
  const current = readLocalJson(notificationStoreKey(lodgeId), [])
  return (Array.isArray(current) ? /** @type {unknown[]} */ (current) : [])
    .sort((left, right) => String(readField(right, 'createdAt') || '').localeCompare(String(readField(left, 'createdAt') || '')))
    .slice(0, Math.max(Number(limit) || NOTIFICATION_LIMIT, 1))
}

/** @param {unknown} lodgeId @returns {number} */
export function getUnreadPwaNotificationCount(lodgeId) {
  return listPwaNotifications(lodgeId).filter((rawItem) => {
    const item = { readAt: readField(rawItem, 'readAt') }
    return !item?.readAt
  }).length
}

/** @param {unknown} lodgeId @returns {number} */
export function getUnreadOperationalNotificationCount(lodgeId) {
  return listPwaNotifications(lodgeId).filter((rawItem) => {
    const item = {
      readAt: readField(rawItem, 'readAt'),
      category: readField(rawItem, 'category')
    }
    return !item?.readAt && item?.category !== 'frontDeskRequest'
  }).length
}

/** @param {unknown} lodgeId @param {unknown} notification */
export function upsertPwaNotification(lodgeId, notification) {
  const key = notificationStoreKey(lodgeId)
  const current = readLocalJson(key, [])
  /** @type {unknown[]} */
  const list = Array.isArray(current) ? [...current] : []
  const sourceKey = readField(notification, 'sourceKey') || readField(notification, 'id') || crypto.randomUUID()
  const index = list.findIndex((item) => (readField(item, 'sourceKey') || readField(item, 'id')) === sourceKey)
  const previous = index >= 0 ? list[index] : null
  const hasIncomingReadState = Object.prototype.hasOwnProperty.call(notification || {}, 'readAt')
  const incomingFingerprint = notificationFingerprint({ ...Object(notification), sourceKey })
  if (!previous && isDismissedNotification(lodgeId, sourceKey, incomingFingerprint)) {
    emit('boroko:pwa-notifications', { lodgeId, items: list, suppressed: sourceKey })
    return null
  }
  if (!previous) {
    clearDismissedNotification(lodgeId, sourceKey)
  }
  /** @type {JsonObject} */
  const nextItem = {
    id: readField(previous, 'id') || readField(notification, 'id') || crypto.randomUUID(),
    sourceKey,
    title: readField(notification, 'title') || 'Tsa Bonno update',
    message: readField(notification, 'message') || '',
    tone: readField(notification, 'tone') || 'info',
    category: readField(notification, 'category') || 'general',
    href: readField(notification, 'href') || null,
    meta: readField(notification, 'meta') || readField(previous, 'meta') || null,
    createdAt: readField(notification, 'createdAt') || readField(previous, 'createdAt') || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    readAt: hasIncomingReadState ? readField(notification, 'readAt') : readField(previous, 'readAt') || null
  }
  const previousMeta = readField(previous, 'meta')
  const notificationMeta = readField(notification, 'meta')
  if (previousMeta && notificationMeta && typeof previousMeta === 'object' && typeof notificationMeta === 'object') {
    nextItem.meta = { ...Object(previousMeta), ...Object(notificationMeta) }
  }
  nextItem.fingerprint = notificationFingerprint(nextItem)
  if (index >= 0) list[index] = { ...Object(previous), ...nextItem }
  else list.unshift(nextItem)
  const trimmed = list
    .sort((left, right) => String(readField(right, 'createdAt') || '').localeCompare(String(readField(left, 'createdAt') || '')))
    .slice(0, NOTIFICATION_LIMIT)
  writeLocalJson(key, trimmed)
  emit('boroko:pwa-notifications', {
    lodgeId,
    items: trimmed,
    latest: nextItem,
    isNew: index < 0,
    frontDeskUpdated: Boolean(
      previousMeta &&
      readField(notificationMeta, 'deskResponse') &&
      readField(notificationMeta, 'deskResponse') !== readField(previousMeta, 'deskResponse')
    )
  })
  return nextItem
}

/** @param {unknown} lodgeId @param {unknown} sourceKey */
export function removePwaNotification(lodgeId, sourceKey) {
  const key = notificationStoreKey(lodgeId)
  const current = readLocalJson(key, [])
  const list = Array.isArray(current) ? current : []
  const next = list.filter((item) => (readField(item, 'sourceKey') || readField(item, 'id')) !== sourceKey)
  if (next.length === list.length) return
  writeLocalJson(key, next)
  emit('boroko:pwa-notifications', { lodgeId, items: next, removed: sourceKey })
}

/** @param {unknown} lodgeId @param {unknown} sourceKey */
export function dismissPwaNotification(lodgeId, sourceKey) {
  const key = notificationStoreKey(lodgeId)
  const current = readLocalJson(key, [])
  const list = Array.isArray(current) ? current : []
  const item = list.find((entry) => (readField(entry, 'sourceKey') || readField(entry, 'id')) === sourceKey)
  if (item) {
    const fingerprint = readField(item, 'fingerprint') || notificationFingerprint(item)
    const meta = readField(item, 'meta')
    const notificationVersion = readField(meta, 'notificationVersion')
    if (notificationVersion) {
      setPwaNotificationSeenVersion(lodgeId, String(sourceKey), notificationVersion)
    }
    const dismissed = getDismissedNotifications(lodgeId)
      .filter((entry) => readField(entry, 'sourceKey') !== sourceKey || readField(entry, 'fingerprint') !== fingerprint)
    setDismissedNotifications(lodgeId, [
      {
        sourceKey,
        fingerprint,
        dismissedAt: new Date().toISOString()
      },
      ...dismissed
    ])
  }
  removePwaNotification(lodgeId, sourceKey)
}

/** @param {unknown} lodgeId @param {unknown} notificationId */
export function markPwaNotificationRead(lodgeId, notificationId) {
  const key = notificationStoreKey(lodgeId)
  const current = readLocalJson(key, [])
  const readAt = new Date().toISOString()
  const next = (Array.isArray(current) ? /** @type {unknown[]} */ (current) : []).map((item) => {
    if (readField(item, 'id') !== notificationId) return item
    const meta = readField(item, 'meta')
    const notificationVersion = readField(meta, 'notificationVersion')
    if (notificationVersion) {
      setPwaNotificationSeenVersion(lodgeId, String(readField(item, 'sourceKey') || readField(item, 'id')), notificationVersion)
    }
    return readField(item, 'readAt') ? item : { ...Object(item), readAt }
  })
  writeLocalJson(key, next)
  emit('boroko:pwa-notifications', { lodgeId, items: next, readId: notificationId })
}

/** @param {unknown} lodgeId @param {unknown} sourceKey */
export function markPwaNotificationReadBySourceKey(lodgeId, sourceKey) {
  if (!sourceKey) return
  const key = notificationStoreKey(lodgeId)
  const current = readLocalJson(key, [])
  const readAt = new Date().toISOString()
  const next = (Array.isArray(current) ? /** @type {unknown[]} */ (current) : []).map((item) => {
    if ((readField(item, 'sourceKey') || readField(item, 'id')) !== sourceKey) return item
    const meta = readField(item, 'meta')
    const notificationVersion = readField(meta, 'notificationVersion')
    if (notificationVersion) {
      setPwaNotificationSeenVersion(lodgeId, String(readField(item, 'sourceKey') || readField(item, 'id')), notificationVersion)
    }
    return readField(item, 'readAt') ? item : { ...Object(item), readAt }
  })
  writeLocalJson(key, next)
  emit('boroko:pwa-notifications', { lodgeId, items: next, readSourceKey: sourceKey })
}

// Maximum retries before a saved change is considered stuck.
const PWA_MAX_RETRIES = 3
// Warn early so a busy device never hits the browser ~5MB localStorage cliff
// without guidance. The queue stays uncapped; this is guidance, not a block.
export const PWA_QUEUE_WARN_COUNT = 200

/** @param {unknown} error @returns {boolean} */
export function isPwaStorageFullError(error) {
  const message = String(readField(error, 'message') || error || '').toLowerCase()
  return (
    readField(error, 'name') === 'QuotaExceededError' ||
    message.includes('quota') ||
    message.includes('storage is full') ||
    message.includes('did not retain the queue envelope') ||
    message.includes('could not be durably persisted') ||
    message.includes('was not durably persisted')
  )
}

/** @param {unknown} error @param {string} [actionLabel] @returns {unknown} */
export function friendlyPwaQueueError(error, actionLabel = 'This change') {
  if (isPwaStorageFullError(error)) {
    return new Error(
      `${actionLabel} could not be saved — this device's browser storage is full. Export the waiting queue below, then sync or clear blocked items and try again. No sent work was lost.`
    )
  }
  return error
}

/** @param {unknown} lodgeId */
export function getPwaStorageHealth(lodgeId) {
  const queue = getOfflineQueue(lodgeId)
  const queueLength = readDirectField(queue, 'length')
  let queueBytes = null
  try {
    queueBytes = JSON.stringify(queue).length
  } catch {
    queueBytes = null
  }
  const warn = Number(queueLength) >= PWA_QUEUE_WARN_COUNT
  return {
    queueLength,
    queueBytes,
    warn,
    warnCount: PWA_QUEUE_WARN_COUNT,
    deviceOnly: true,
    checkedAt: new Date().toISOString()
  }
}

/** @returns {Promise<{quota: number | null, usage: number | null}>} */
export async function getPwaStorageEstimate() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate()
      return {
        quota: typeof estimate.quota === 'number' ? estimate.quota : null,
        usage: typeof estimate.usage === 'number' ? estimate.usage : null
      }
    }
  } catch {
    // Best effort only.
  }
  return { quota: null, usage: null }
}

/** @param {unknown} lodgeId */
export function exportPwaOfflineQueue(lodgeId) {
  const queue = getOfflineQueue(lodgeId)
  const payload = {
    exportedAt: new Date().toISOString(),
    lodgeId,
    deviceOnly: true,
    count: readDirectField(queue, 'length'),
    items: queue
  }
  const datePart = new Date().toISOString().slice(0, 10)
  return {
    filename: `pwa-offline-queue-${String(lodgeId || 'global').slice(0, 8)}-${datePart}.json`,
    json: JSON.stringify(payload, null, 2),
    count: readDirectField(queue, 'length')
  }
}

/** @param {unknown} lodgeId */
export function clearPwaBlockedOperations(lodgeId) {
  const queue = getOfflineQueue(lodgeId)
  const isBlocked = /** @param {unknown} item */ (item) => readField(item, 'blocked') === true
  const blocked = callMethod(queue, 'filter', [isBlocked], 'queue.filter')
  if (readDirectField(blocked, 'length') === 0) return { removed: 0 }
  const isNotBlocked = /** @param {unknown} item */ (item) => readField(item, 'blocked') !== true
  const remaining = callMethod(queue, 'filter', [isNotBlocked], 'queue.filter')
  setOfflineQueue(lodgeId, remaining)
  appendIssueLog(lodgeId, {
    scope: 'pwa-queue',
    severity: 'warn',
    message: `Cleared ${readDirectField(blocked, 'length')} blocked offline item(s) after export`,
    detail: 'Blocked items can never send (e.g. online-only actions attempted offline).',
    context: { removed: callMethod(blocked, 'map', [/** @param {unknown} item */ (item) => ({ id: readField(item, 'id') || null, type: readField(item, 'type') || null })], 'blocked.map') }
  })
  return { removed: readDirectField(blocked, 'length') }
}

/**
 * Scan the offline queue for this device and return items that are unresolved:
 * - blocked === true
 * - retryCount >= PWA_MAX_RETRIES (stuck items)
 * - lastError is set
 *
 * NOTE: This is device-local state only. It does NOT reflect the desktop Electron
 * queue or any server-side sync state. Two separate queue systems exist.
 *
 * @param {unknown} lodgeId
 * @returns {{ blocked: unknown[], deadLetters: unknown[], total: unknown }}
 */
export function getUnresolvedLocalState(lodgeId) {
  const queue = getOfflineQueue(lodgeId)
  /** @type {unknown[]} */
  const blocked = []
  /** @type {unknown[]} */
  const deadLetters = []
  for (const item of iterateUnknown(queue, 'queue')) {
    if (readField(item, 'blocked') === true) {
      blocked.push(item)
    } else if (Number(readField(item, 'retryCount') || 0) >= PWA_MAX_RETRIES) {
      deadLetters.push(item)
    } else if (readField(item, 'lastError')) {
      deadLetters.push(item)
    }
  }
  return { blocked, deadLetters, total: readDirectField(queue, 'length') }
}

/** @returns {string} */
function getPwaDeviceId() {
  try {
    const stored = localStorage.getItem('pwa_device_id')
    if (stored) return stored
  } catch { /* ignore */ }
  const id = `pwa-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`
  try { localStorage.setItem('pwa_device_id', id) } catch { /* ignore */ }
  return id
}

/** @param {unknown} lodgeId @param {any} supabase upstream Supabase client has no generated database type in this app. @param {{queueLength?: number, deadLetterCount?: number, blockedCount?: number, lastFlushAt?: unknown}} summary */
export async function publishPwaHealth(lodgeId, supabase, summary) {
  if (!lodgeId || !supabase) return
  try {
    const metaKey = scoped(META_PREFIX, lodgeId, 'last-pwa-health-publish')
    const previous = readLocalJson(metaKey, null)
    const previousAtMs = Date.parse(String(readField(previous, 'at') || ''))
    if (Number.isFinite(previousAtMs) && Date.now() - previousAtMs < PWA_HEALTH_PUBLISH_MIN_MS) return

    const deviceId = getPwaDeviceId()
    writeLocalJson(metaKey, { at: new Date().toISOString() })
    await supabase.rpc('upsert_device_health', {
      p_lodge_id: lodgeId,
      p_device_id: deviceId,
      p_client_type: 'pwa',
      p_pending_queue_count: summary.queueLength ?? 0,
      p_failed_queue_count: summary.deadLetterCount ?? 0,
      p_unresolved_local_count: summary.blockedCount ?? 0,
      p_replay_auth_ready: true,
      p_last_successful_sync_at: summary.lastFlushAt ?? null,
      p_reconciliation_state: 'unknown',
      p_top_fault_types: (summary.blockedCount ?? 0) > 0 ? ['pwa_blocked_mutations'] : [],
      p_raw_summary: {}
    })
  } catch (e) {
    console.warn('[Manager mobile app DeviceHealth] Publish failed:', e)
  }
}

/** @param {unknown} lodgeId */
/**
 * Return a structured health summary for the offline queue on this device.
 * The `deviceOnly: true` flag is always set — this is browser-local state and
 * is NOT reflected in the desktop System Health panel or any server dashboard.
 * @param {unknown} lodgeId
 * @returns {{queueLength: unknown, blockedCount: number, deadLetterCount: number, unresolvedItems: unknown[], deviceOnly: true, checkedAt: string}}
 */
export function getPwaQueueHealth(lodgeId) {
  const queue = getOfflineQueue(lodgeId)
  const { blocked, deadLetters } = getUnresolvedLocalState(lodgeId)
  const unresolved = [...blocked, ...deadLetters]
  const unresolvedItems = unresolved.slice(0, 5).map((item) => ({
    id: readField(item, 'id') || null,
    type: readField(item, 'type') || 'unknown',
    label: readField(item, 'label') || readField(item, 'type') || 'queued operation',
    lastError: readField(item, 'lastError') || null
  }))
  return {
    queueLength: readDirectField(queue, 'length'),
    blockedCount: blocked.length,
    deadLetterCount: deadLetters.length,
    unresolvedItems,
    deviceOnly: true,
    checkedAt: new Date().toISOString()
  }
}
