const SESSION_KEY = 'boroko_manager_session'
const CACHE_PREFIX = 'boroko_pwa_cache'
const QUEUE_PREFIX = 'boroko_pwa_queue'
const META_PREFIX = 'boroko_pwa_meta'
const ISSUE_LOG_LIMIT = 100
const NOTIFICATION_LIMIT = 40
const DISMISSED_NOTIFICATION_LIMIT = 120
const SEEN_NOTIFICATION_VERSION_LIMIT = 250
const TRUSTED_DEVICE_DAYS = 365
const DEFAULT_ONLINE_CACHE_MAX_AGE_MS = 60_000
const PWA_HEALTH_PUBLISH_MIN_MS = 10 * 60_000
const inFlightQueries = new Map()

function normalizeNotificationPart(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function hashNotificationParts(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

export function buildPwaNotificationSourceKey(scope, ...parts) {
  const normalized = parts
    .map((part) => String(part ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('|')
  const slug = normalizeNotificationPart(parts[0] || 'item') || 'item'
  return `${scope || 'notification'}:${slug}:${normalized ? hashNotificationParts(normalized) : 'global'}`
}

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

function removeLocalJson(key) {
  removeStorage(window.localStorage, key)
}

export function getSession() {
  const trusted = readLocalJson(SESSION_KEY, null)
  if (trusted) return trusted
  return readStorage(getSessionStorageArea(), SESSION_KEY, null)
}

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

export function readCacheEntry(lodgeId, key, fallback = null) {
  return readLocalJson(scoped(CACHE_PREFIX, lodgeId, key), fallback)
}

function readCacheData(lodgeId, key, fallback = null) {
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

function cacheAgeMs(entry) {
  const updatedAtMs = Date.parse(entry?.updatedAt || '')
  return Number.isFinite(updatedAtMs) ? Date.now() - updatedAtMs : Infinity
}

export async function queryWithCache({ lodgeId, key, fetcher, fallback = [], forceFresh = false, maxAgeMs = DEFAULT_ONLINE_CACHE_MAX_AGE_MS }) {
  const cached = readCacheEntry(lodgeId, key, null)
  const onlineCacheMs = Math.max(Number(maxAgeMs) || 0, 0)
  const requestKey = scoped(CACHE_PREFIX, lodgeId, key)

  if (!forceFresh && cached && onlineCacheMs > 0 && cacheAgeMs(cached) <= onlineCacheMs) {
    return cached.data
  }

  if (!forceFresh && typeof navigator !== 'undefined' && navigator.onLine === false && cached) {
    return cached.data
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
      if (cached) return cached.data
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
    maintenance: true,
    frontDeskRequests: true
  })
}

export function setNotificationSettings(settings) {
  writeLocalJson('boroko_pwa_notification_settings', settings)
  emit('boroko:pwa-notification-settings', settings)
}

function notificationStoreKey(lodgeId) {
  return scoped(META_PREFIX, lodgeId, 'notifications')
}

function dismissedNotificationStoreKey(lodgeId) {
  return scoped(META_PREFIX, lodgeId, 'dismissed-notifications')
}

function seenNotificationVersionStoreKey(lodgeId) {
  return scoped(META_PREFIX, lodgeId, 'seen-notification-versions')
}

function stableNotificationMessage(message) {
  return {
    body: String(message?.body || message?.message || '').trim(),
    sender_type: String(message?.sender_type || '').trim(),
    sender_name: String(message?.sender_name || '').trim(),
    sender_role: String(message?.sender_role || '').trim(),
    sender_surface: String(message?.sender_surface || '').trim()
  }
}

function notificationFingerprint(notification = {}) {
  const meta = notification?.meta && typeof notification.meta === 'object' ? notification.meta : {}
  const messages = Array.isArray(meta.messages) ? meta.messages.map(stableNotificationMessage) : []
  return JSON.stringify({
    title: String(notification?.title || '').trim(),
    message: String(notification?.message || '').trim(),
    tone: String(notification?.tone || 'info').trim(),
    category: String(notification?.category || 'general').trim(),
    href: notification?.href || null,
    requestTitle: String(meta.requestTitle || '').trim(),
    requestBody: String(meta.requestBody || '').trim(),
    deskResponse: String(meta.deskResponse || '').trim(),
    requestStatus: String(meta.requestStatus || '').trim(),
    requestCategory: String(meta.requestCategory || '').trim(),
    requestPriority: String(meta.requestPriority || '').trim(),
    messageCount: messages.length,
    messages
  })
}

function getDismissedNotifications(lodgeId) {
  const current = readLocalJson(dismissedNotificationStoreKey(lodgeId), [])
  return Array.isArray(current) ? current : []
}

function setDismissedNotifications(lodgeId, items) {
  writeLocalJson(
    dismissedNotificationStoreKey(lodgeId),
    (Array.isArray(items) ? items : [])
      .sort((left, right) => String(right.dismissedAt || '').localeCompare(String(left.dismissedAt || '')))
      .slice(0, DISMISSED_NOTIFICATION_LIMIT)
  )
}

function clearDismissedNotification(lodgeId, sourceKey) {
  const current = getDismissedNotifications(lodgeId)
  const next = current.filter((item) => item?.sourceKey !== sourceKey)
  if (next.length !== current.length) setDismissedNotifications(lodgeId, next)
}

function isDismissedNotification(lodgeId, sourceKey, fingerprint) {
  return getDismissedNotifications(lodgeId).some((item) => (
    item?.sourceKey === sourceKey && item?.fingerprint === fingerprint
  ))
}

export function getPwaNotificationSeenVersion(lodgeId, sourceKey) {
  if (!sourceKey) return null
  const current = readLocalJson(seenNotificationVersionStoreKey(lodgeId), {})
  return current && typeof current === 'object' ? current[sourceKey] || null : null
}

export function setPwaNotificationSeenVersion(lodgeId, sourceKey, version) {
  if (!sourceKey || !version) return null
  const current = readLocalJson(seenNotificationVersionStoreKey(lodgeId), {})
  const next = current && typeof current === 'object' ? { ...current } : {}
  next[sourceKey] = {
    version: String(version),
    seenAt: new Date().toISOString()
  }
  const trimmed = Object.fromEntries(
    Object.entries(next)
      .sort((left, right) => String(right[1]?.seenAt || '').localeCompare(String(left[1]?.seenAt || '')))
      .slice(0, SEEN_NOTIFICATION_VERSION_LIMIT)
  )
  writeLocalJson(seenNotificationVersionStoreKey(lodgeId), trimmed)
  return trimmed[sourceKey]
}

export function listPwaNotifications(lodgeId, limit = NOTIFICATION_LIMIT) {
  const current = readLocalJson(notificationStoreKey(lodgeId), [])
  return (Array.isArray(current) ? current : [])
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .slice(0, Math.max(Number(limit) || NOTIFICATION_LIMIT, 1))
}

export function getUnreadPwaNotificationCount(lodgeId) {
  return listPwaNotifications(lodgeId).filter((item) => !item?.readAt).length
}

export function upsertPwaNotification(lodgeId, notification) {
  const key = notificationStoreKey(lodgeId)
  const current = readLocalJson(key, [])
  const list = Array.isArray(current) ? [...current] : []
  const sourceKey = notification?.sourceKey || notification?.id || crypto.randomUUID()
  const index = list.findIndex((item) => (item?.sourceKey || item?.id) === sourceKey)
  const previous = index >= 0 ? list[index] : null
  const hasIncomingReadState = Object.prototype.hasOwnProperty.call(notification || {}, 'readAt')
  const incomingFingerprint = notificationFingerprint({ ...notification, sourceKey })
  if (!previous && isDismissedNotification(lodgeId, sourceKey, incomingFingerprint)) {
    emit('boroko:pwa-notifications', { lodgeId, items: list, suppressed: sourceKey })
    return null
  }
  if (!previous) {
    clearDismissedNotification(lodgeId, sourceKey)
  }
  const nextItem = {
    id: previous?.id || notification?.id || crypto.randomUUID(),
    sourceKey,
    title: notification?.title || 'Boroko update',
    message: notification?.message || '',
    tone: notification?.tone || 'info',
    category: notification?.category || 'general',
    href: notification?.href || null,
    meta: notification?.meta || previous?.meta || null,
    createdAt: notification?.createdAt || previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    readAt: hasIncomingReadState ? notification.readAt : previous?.readAt || null
  }
  if (previous?.meta && notification?.meta && typeof previous.meta === 'object' && typeof notification.meta === 'object') {
    nextItem.meta = { ...previous.meta, ...notification.meta }
  }
  nextItem.fingerprint = notificationFingerprint(nextItem)
  if (index >= 0) list[index] = { ...previous, ...nextItem }
  else list.unshift(nextItem)
  const trimmed = list
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    .slice(0, NOTIFICATION_LIMIT)
  writeLocalJson(key, trimmed)
  emit('boroko:pwa-notifications', {
    lodgeId,
    items: trimmed,
    latest: nextItem,
    isNew: index < 0,
    frontDeskUpdated: Boolean(
      previous?.meta &&
      notification?.meta?.deskResponse &&
      notification.meta.deskResponse !== previous.meta?.deskResponse
    )
  })
  return nextItem
}

export function removePwaNotification(lodgeId, sourceKey) {
  const key = notificationStoreKey(lodgeId)
  const current = readLocalJson(key, [])
  const list = Array.isArray(current) ? current : []
  const next = list.filter((item) => (item?.sourceKey || item?.id) !== sourceKey)
  if (next.length === list.length) return
  writeLocalJson(key, next)
  emit('boroko:pwa-notifications', { lodgeId, items: next, removed: sourceKey })
}

export function dismissPwaNotification(lodgeId, sourceKey) {
  const key = notificationStoreKey(lodgeId)
  const current = readLocalJson(key, [])
  const list = Array.isArray(current) ? current : []
  const item = list.find((entry) => (entry?.sourceKey || entry?.id) === sourceKey)
  if (item) {
    const fingerprint = item.fingerprint || notificationFingerprint(item)
    if (item.meta?.notificationVersion) {
      setPwaNotificationSeenVersion(lodgeId, sourceKey, item.meta.notificationVersion)
    }
    const dismissed = getDismissedNotifications(lodgeId)
      .filter((entry) => entry?.sourceKey !== sourceKey || entry?.fingerprint !== fingerprint)
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

export function markPwaNotificationRead(lodgeId, notificationId) {
  const key = notificationStoreKey(lodgeId)
  const current = readLocalJson(key, [])
  const readAt = new Date().toISOString()
  const next = (Array.isArray(current) ? current : []).map((item) => {
    if (item?.id !== notificationId) return item
    if (item?.meta?.notificationVersion) {
      setPwaNotificationSeenVersion(lodgeId, item.sourceKey || item.id, item.meta.notificationVersion)
    }
    return item?.readAt ? item : { ...item, readAt }
  })
  writeLocalJson(key, next)
  emit('boroko:pwa-notifications', { lodgeId, items: next, readId: notificationId })
}

export function markPwaNotificationReadBySourceKey(lodgeId, sourceKey) {
  if (!sourceKey) return
  const key = notificationStoreKey(lodgeId)
  const current = readLocalJson(key, [])
  const readAt = new Date().toISOString()
  const next = (Array.isArray(current) ? current : []).map((item) => {
    if ((item?.sourceKey || item?.id) !== sourceKey) return item
    if (item?.meta?.notificationVersion) {
      setPwaNotificationSeenVersion(lodgeId, item.sourceKey || item.id, item.meta.notificationVersion)
    }
    return item?.readAt ? item : { ...item, readAt }
  })
  writeLocalJson(key, next)
  emit('boroko:pwa-notifications', { lodgeId, items: next, readSourceKey: sourceKey })
}

// Maximum retries before a saved change is considered stuck.
const PWA_MAX_RETRIES = 3

/**
 * Scan the offline queue for this device and return items that are unresolved:
 * - blocked === true
 * - retryCount >= PWA_MAX_RETRIES (stuck items)
 * - lastError is set
 *
 * NOTE: This is device-local state only. It does NOT reflect the desktop Electron
 * queue or any server-side sync state. Two separate queue systems exist.
 *
 * @param {string} lodgeId
 * @returns {{ blocked: Array, deadLetters: Array, total: number }}
 */
export function getUnresolvedLocalState(lodgeId) {
  const queue = getOfflineQueue(lodgeId)
  const blocked = []
  const deadLetters = []
  for (const item of queue) {
    if (item?.blocked === true) {
      blocked.push(item)
    } else if (Number(item?.retryCount || 0) >= PWA_MAX_RETRIES) {
      deadLetters.push(item)
    } else if (item?.lastError) {
      deadLetters.push(item)
    }
  }
  return { blocked, deadLetters, total: queue.length }
}

/**
 * Return a structured health summary for the offline queue on this device.
 * The `deviceOnly: true` flag is always set — this is browser-local state and
 * is NOT reflected in the desktop System Health panel or any server dashboard.
 *
 * @param {string} lodgeId
 * @returns {{ queueLength: number, blockedCount: number, deadLetterCount: number, unresolvedItems: Array, deviceOnly: true, checkedAt: string }}
 */
function getPwaDeviceId() {
  try {
    const stored = localStorage.getItem('pwa_device_id')
    if (stored) return stored
  } catch { /* ignore */ }
  const id = `pwa-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`
  try { localStorage.setItem('pwa_device_id', id) } catch { /* ignore */ }
  return id
}

export async function publishPwaHealth(lodgeId, supabase, summary) {
  if (!lodgeId || !supabase) return
  try {
    const metaKey = scoped(META_PREFIX, lodgeId, 'last-pwa-health-publish')
    const previous = readLocalJson(metaKey, null)
    const previousAtMs = Date.parse(previous?.at || '')
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
      p_top_fault_types: summary.blockedCount > 0 ? ['pwa_blocked_mutations'] : [],
      p_raw_summary: {}
    })
  } catch (e) {
    console.warn('[Manager mobile app DeviceHealth] Publish failed:', e)
  }
}

export function getPwaQueueHealth(lodgeId) {
  const queue = getOfflineQueue(lodgeId)
  const { blocked, deadLetters } = getUnresolvedLocalState(lodgeId)
  const unresolved = [...blocked, ...deadLetters]
  const unresolvedItems = unresolved.slice(0, 5).map((item) => ({
    id: item?.id || null,
    type: item?.type || 'unknown',
    label: item?.label || item?.type || 'queued operation',
    lastError: item?.lastError || null
  }))
  return {
    queueLength: queue.length,
    blockedCount: blocked.length,
    deadLetterCount: deadLetters.length,
    unresolvedItems,
    deviceOnly: true,
    checkedAt: new Date().toISOString()
  }
}
