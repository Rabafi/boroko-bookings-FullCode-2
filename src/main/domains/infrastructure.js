import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'
import { state } from '../state.js'

// ─── SUPABASE CREDENTIALS ─────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY
const AUTH_CONTRACT_VERSION = 2
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROFILE_STATUS = {
  DRAFT: 'draft',
  READY: 'ready'
}
const PWA_DISABLED_MESSAGE = 'Manager mobile app access disabled.'
const PROFILE_CACHE_FILES = {
  settings: [],
  users: [],
  rooms: [],
  customers: [],
  bookings: [],
  quotations: [],
  expenses: [],
  outlets: [],
  'conference-bookings': [],
  'pool-day-use': [],
  'inventory-items': [],
  'inventory-purchases': [],
  'pos-menu-items': [],
  'pos-orders': [],
  'pos-order-items': [],
  'pos-void-history': [],
  activity: [],
  auth: [],
  syncQueue: [],
  syncFailed: [],
  syncMeta: null,
  healthFaults: [],
  cacheFreshness: null,
  trialStatus: null
}
const SYNC_META_FILE = 'sync-meta.json'
const HEALTH_FAULTS_FILE = 'health-faults.json'
const CACHE_FRESHNESS_FILE = 'cache-freshness.json'
const CONNECTIVITY_CHECK_INTERVAL_MS = 3000
const CONNECTIVITY_PROBE_TIMEOUT_MS = 4000
const CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD = 3
const PERIODIC_SYNC_INTERVAL_MS = 15000
const DEBUG_CACHE_FALLBACKS = process.env.BOROKO_DEBUG_CACHE_FALLBACKS === 'true'
const MAX_SYNC_RETRIES = 5
const SYNC_RETRY_BASE_DELAY_MS = 1000
const SYNC_RETRY_MAX_DELAY_MS = 30_000
const DEAD_LETTER_AUTO_RETRY_AFTER_MS = 30 * 60 * 1000
const SYNC_REFRESH_RETRY_BASE_DELAY_MS = 5_000
const SYNC_REFRESH_RETRY_MAX_DELAY_MS = 60_000
const SYNC_ALREADY_APPLIED_CODES = new Set(['23505'])
const LOCAL_VOID_HISTORY_CACHE = 'pos-void-history'
const QUEUED_DEPENDENCY_CACHE_MAP = [
  { prefix: 'booking-', cache: 'bookings' },
  { prefix: 'customer-', cache: 'customers' },
  { prefix: 'room-', cache: 'rooms' },
  { prefix: 'user-', cache: 'users' },
  { prefix: 'quotation-', cache: 'quotations' },
  { prefix: 'pos-order-', cache: 'pos-orders' },
  { prefix: 'conference-booking-', cache: 'conference-bookings' },
  { prefix: 'pool-day-use-', cache: 'pool-day-use' }
]

// ─── PRIVATE HELPERS ──────────────────────────────────────────────────────────

function normalizeLodgeId(id) {
  return typeof id === 'string' ? id.trim().toLowerCase() : null
}

function isUuid(value) {
  return UUID_PATTERN.test(normalizeLodgeId(value) || '')
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function sanitizeProfile(rawProfile) {
  const normalizedId = normalizeLodgeId(rawProfile?.lodge_id)
  if (!isUuid(normalizedId)) return null

  const createdAt = rawProfile?.created_at || new Date().toISOString()
  const status = rawProfile?.status === PROFILE_STATUS.DRAFT ? PROFILE_STATUS.DRAFT : PROFILE_STATUS.READY
  const label = typeof rawProfile?.label === 'string' && rawProfile.label.trim()
    ? rawProfile.label.trim()
    : 'Untitled Lodge'

  return {
    lodge_id: normalizedId,
    label,
    status,
    created_at: createdAt,
    last_used_at: rawProfile?.last_used_at || createdAt
  }
}

function sortProfiles(profiles = [], activeLodgeId = null) {
  const activeId = normalizeLodgeId(activeLodgeId)
  return [...profiles].sort((a, b) => {
    if (a.lodge_id === activeId) return -1
    if (b.lodge_id === activeId) return 1
    if (a.status !== b.status) {
      return a.status === PROFILE_STATUS.READY ? -1 : 1
    }
    return String(b.last_used_at || '').localeCompare(String(a.last_used_at || ''))
  })
}

function getLodgeIdPath() {
  return path.join(app.getPath('userData'), 'lodge-id.json')
}

function getProfilesPath() {
  return path.join(app.getPath('userData'), 'profiles.json')
}

function getProfileCacheDir(profileLodgeId) {
  return path.join(state.profilesCacheDir, normalizeLodgeId(profileLodgeId))
}

function getInactiveCacheDir() {
  return path.join(state.cacheRootDir, '__inactive')
}

function getCachePath(name) {
  return path.join(state.cacheDir, `${name}.json`)
}

function profileLabelFromSettings(settings = {}, fallback = 'Untitled Lodge') {
  return settings?.lodge_name?.trim() || settings?.company_name?.trim() || fallback
}

function readLegacyLodgeId() {
  const data = readJsonFile(getLodgeIdPath(), null)
  return normalizeLodgeId(data?.lodge_id)
}

function persistLegacyLodgeId(id) {
  writeJsonFile(getLodgeIdPath(), { lodge_id: id })
}

function readProfilesRegistry() {
  const raw = readJsonFile(getProfilesPath(), null)
  const profiles = Array.isArray(raw?.profiles)
    ? raw.profiles.map(sanitizeProfile).filter(Boolean)
    : []
  const active = normalizeLodgeId(raw?.active_lodge_id)
  const activeExists = profiles.some((profile) => profile.lodge_id === active)

  return {
    active_lodge_id: activeExists ? active : null,
    profiles: sortProfiles(profiles, active)
  }
}

function writeProfilesRegistry(registry) {
  const activeId = normalizeLodgeId(registry?.active_lodge_id)
  const profiles = (Array.isArray(registry?.profiles) ? registry.profiles : [])
    .map(sanitizeProfile)
    .filter(Boolean)

  const next = {
    active_lodge_id: profiles.some((profile) => profile.lodge_id === activeId) ? activeId : null,
    profiles: sortProfiles(profiles, activeId)
  }

  writeJsonFile(getProfilesPath(), next)
  return next
}

function hasLegacyCacheData() {
  const legacyFiles = [
    'settings.json',
    'users.json',
    'rooms.json',
    'customers.json',
    'bookings.json',
    'quotations.json',
    'expenses.json',
    'outlets.json',
    'conference-bookings.json',
    'pool-day-use.json',
    'inventory-items.json',
    'inventory-purchases.json',
    'pos-menu-items.json',
    'pos-orders.json',
    'pos-order-items.json',
    'pos-void-history.json',
    'auth-cache.json',
    'sync-queue.json',
    'sync-failed.json',
    'activity-log.json',
    'session-nonce.json',
    'trial_status.json'
  ]

  return legacyFiles.some((fileName) => fs.existsSync(path.join(state.cacheRootDir, fileName)))
}

function ensureProfileCacheFiles(profileLodgeId) {
  const profileDir = getProfileCacheDir(profileLodgeId)
  ensureDir(profileDir)

  const fileMap = [
    ['settings.json', PROFILE_CACHE_FILES.settings],
    ['users.json', PROFILE_CACHE_FILES.users],
    ['rooms.json', PROFILE_CACHE_FILES.rooms],
    ['customers.json', PROFILE_CACHE_FILES.customers],
    ['bookings.json', PROFILE_CACHE_FILES.bookings],
    ['quotations.json', PROFILE_CACHE_FILES.quotations],
    ['expenses.json', PROFILE_CACHE_FILES.expenses],
    ['outlets.json', PROFILE_CACHE_FILES.outlets],
    ['conference-bookings.json', PROFILE_CACHE_FILES['conference-bookings']],
    ['pool-day-use.json', PROFILE_CACHE_FILES['pool-day-use']],
    ['inventory-items.json', PROFILE_CACHE_FILES['inventory-items']],
    ['inventory-purchases.json', PROFILE_CACHE_FILES['inventory-purchases']],
    ['pos-menu-items.json', PROFILE_CACHE_FILES['pos-menu-items']],
    ['pos-orders.json', PROFILE_CACHE_FILES['pos-orders']],
    ['pos-order-items.json', PROFILE_CACHE_FILES['pos-order-items']],
    ['pos-void-history.json', PROFILE_CACHE_FILES['pos-void-history']],
    ['activity-log.json', PROFILE_CACHE_FILES.activity],
    ['auth-cache.json', PROFILE_CACHE_FILES.auth],
    ['sync-queue.json', PROFILE_CACHE_FILES.syncQueue],
    ['sync-failed.json', PROFILE_CACHE_FILES.syncFailed],
    ['sync-meta.json', PROFILE_CACHE_FILES.syncMeta],
    ['health-faults.json', PROFILE_CACHE_FILES.healthFaults],
    ['cache-freshness.json', PROFILE_CACHE_FILES.cacheFreshness],
    ['trial_status.json', PROFILE_CACHE_FILES.trialStatus]
  ]

  for (const [fileName, fallback] of fileMap) {
    const filePath = path.join(profileDir, fileName)
    if (!fs.existsSync(filePath)) {
      writeJsonFile(filePath, fallback)
    }
  }
}

function migrateLegacySingleLodgeProfile() {
  const legacyLodgeId = readLegacyLodgeId()
  if (!legacyLodgeId && !hasLegacyCacheData()) {
    return writeProfilesRegistry({ active_lodge_id: null, profiles: [] })
  }

  const derivedLodgeId = legacyLodgeId || randomUUID()
  const legacySettings = readJsonFile(path.join(state.cacheRootDir, 'settings.json'), [])
  const legacySettingsRow = Array.isArray(legacySettings) ? legacySettings[0] : null
  const profile = sanitizeProfile({
    lodge_id: derivedLodgeId,
    label: profileLabelFromSettings(legacySettingsRow, 'Existing Lodge'),
    status: legacySettingsRow?.setup_complete === false ? PROFILE_STATUS.DRAFT : PROFILE_STATUS.READY,
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString()
  })

  const profileDir = getProfileCacheDir(profile.lodge_id)
  ensureDir(profileDir)

  const legacyFileNames = [
    'settings.json',
    'users.json',
    'rooms.json',
    'customers.json',
    'bookings.json',
    'quotations.json',
    'expenses.json',
    'outlets.json',
    'conference-bookings.json',
    'pool-day-use.json',
    'inventory-items.json',
    'inventory-purchases.json',
    'pos-menu-items.json',
    'pos-orders.json',
    'pos-order-items.json',
    'pos-void-history.json',
    'auth-cache.json',
    'sync-queue.json',
    'sync-failed.json',
    'activity-log.json',
    'session-nonce.json',
    'trial_status.json'
  ]

  for (const fileName of legacyFileNames) {
    const legacyPath = path.join(state.cacheRootDir, fileName)
    const nextPath = path.join(profileDir, fileName)
    if (fs.existsSync(legacyPath) && !fs.existsSync(nextPath)) {
      fs.copyFileSync(legacyPath, nextPath)
    }
  }

  persistLegacyLodgeId(profile.lodge_id)
  ensureProfileCacheFiles(profile.lodge_id)

  return writeProfilesRegistry({
    active_lodge_id: profile.lodge_id,
    profiles: [profile]
  })
}

function setRuntimeActiveProfile(nextLodgeId, { persistActive = true, touch = true } = {}) {
  const normalizedId = normalizeLodgeId(nextLodgeId)
  state.lodgeId = normalizedId || null
  state.cacheDir = state.lodgeId ? getProfileCacheDir(state.lodgeId) : getInactiveCacheDir()
  ensureDir(state.cacheDir)

  if (!persistActive) return

  const registry = readProfilesRegistry()
  const nextProfiles = registry.profiles.map((profile) =>
    profile.lodge_id === normalizedId && touch
      ? { ...profile, last_used_at: new Date().toISOString() }
      : profile
  )

  writeProfilesRegistry({
    active_lodge_id: normalizedId,
    profiles: nextProfiles
  })
}

function initializeProfileRuntime() {
  ensureDir(state.cacheRootDir)
  ensureDir(state.profilesCacheDir)
  ensureDir(getInactiveCacheDir())

  const registry = fs.existsSync(getProfilesPath())
    ? writeProfilesRegistry(readProfilesRegistry())
    : migrateLegacySingleLodgeProfile()

  setRuntimeActiveProfile(registry.active_lodge_id, { persistActive: false, touch: false })
  return registry
}

function normalizeUserRecord(user) {
  if (!user || typeof user !== 'object') return null
  const email = normalizeEmail(user.email)
  return {
    ...user,
    id: user.id || user.user_id || null,
    email,
    lodge_id: normalizeLodgeId(user.lodge_id || user.lodgeId || null)
  }
}

function mergeSessionUserScope(existingUser, refreshedUser) {
  const existing = normalizeSessionUser(existingUser) || null
  const refreshed = normalizeSessionUser(refreshedUser) || null

  if (!existing) return refreshed
  if (!refreshed) return existing

  const next = { ...existing, ...refreshed }
  const refreshedHasScope = Object.prototype.hasOwnProperty.call(refreshed, 'allowed_outlet_ids')
  const existingHasScope = Object.prototype.hasOwnProperty.call(existing, 'allowed_outlet_ids')

  if (refreshedHasScope) {
    next.allowed_outlet_ids = refreshed.allowed_outlet_ids
  } else if (existingHasScope) {
    next.allowed_outlet_ids = existing.allowed_outlet_ids
  } else {
    delete next.allowed_outlet_ids
  }

  return next
}

function normalizeSessionUser(user) {
  if (!user || typeof user !== 'object') return user || null

  const normalized = {
    ...user,
    id: user.id || user.user_id || null,
    email: normalizeEmail(user.email),
    name: typeof user.name === 'string' ? user.name : (user.name || ''),
    role: user.role || null,
    lodge_id: normalizeLodgeId(user.lodge_id || user.lodgeId || null)
  }

  if (Object.prototype.hasOwnProperty.call(user, 'allowed_outlet_ids')) {
    if (user.allowed_outlet_ids === null) {
      normalized.allowed_outlet_ids = null
    } else if (Array.isArray(user.allowed_outlet_ids)) {
      normalized.allowed_outlet_ids = [...user.allowed_outlet_ids]
    } else if (user.allowed_outlet_ids === undefined) {
      delete normalized.allowed_outlet_ids
    }
  } else {
    delete normalized.allowed_outlet_ids
  }

  return normalized
}

function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return
  console.log(`[AUTH TRACE] ${label}`, payload)
}

function quarantineBadJsonFile(filePath, reason = 'corrupt JSON') {
  if (!filePath || !fs.existsSync(filePath)) return null
  const quarantinePath = `${filePath}.corrupt.${Date.now()}.bak`
  try {
    fs.renameSync(filePath, quarantinePath)
    console.warn(`[Sync Queue] Quarantined ${path.basename(filePath)} -> ${path.basename(quarantinePath)} (${reason})`)
    return quarantinePath
  } catch (error) {
    console.error('[Sync Queue] Failed to quarantine corrupt file:', error)
    return null
  }
}

function normalizeQueueRows(parsed, scope = 'sync-queue') {
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.queue)
      ? parsed.queue
      : Array.isArray(parsed?.items)
        ? parsed.items
        : Array.isArray(parsed?.pending)
          ? parsed.pending
          : null

  if (!rows) {
    appendHealthFault({
      type: 'queue_corrupt',
      scope,
      message: `${scope}.json contained non-array JSON and was treated as empty.`,
      at: new Date().toISOString()
    })
    return []
  }

  const validRows = rows.filter((item) => item && typeof item === 'object')
  if (validRows.length !== rows.length) {
    appendHealthFault({
      type: 'queue_corrupt',
      scope,
      message: `${scope}.json contained ${rows.length - validRows.length} malformed item(s); malformed entries were ignored.`,
      at: new Date().toISOString()
    })
  }
  return validRows
}

function readCache(name) {
  const filePath = getCachePath(name)
  const tmpPath = filePath + '.tmp'
  // Crash recovery: if a .tmp file exists, it was written atomically just before
  // a crash-interrupted renameSync. Prefer it over the potentially stale main file.
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'))
      fs.renameSync(tmpPath, filePath)
      console.warn(`[Cache] Crash-recovery: promoted '${name}.tmp' to main file`)
      return tmpData
    } catch {
      // .tmp is corrupt — discard it and fall through to main file
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    }
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(data)
  } catch (e) {
    if (fs.existsSync(filePath)) {
      console.warn(`[Cache] Parse failed for '${name}' — returning []. Error: ${e.message}`)
      appendHealthFault({
        type: 'cache_corrupt',
        scope: name,
        message: `Cache file '${name}.json' could not be parsed and was reset to empty. Error: ${e.message}`,
        at: new Date().toISOString()
      })
    }
    return []
  }
}

function writeCache(name, data, { source = 'local' } = {}) {
  const filePath = getCachePath(name)
  const tmpPath = filePath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (e) {
    console.error(`[Cache] Write failed for '${name}':`, e)
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
  // Track freshness metadata for each named cache write
  try {
    const freshnessPath = path.join(state.cacheDir, CACHE_FRESHNESS_FILE)
    let freshness = {}
    try { freshness = JSON.parse(fs.readFileSync(freshnessPath, 'utf-8')) || {} } catch { /* start fresh */ }
    freshness[name] = {
      updatedAt: new Date().toISOString(),
      source,
      count: Array.isArray(data) ? data.length : (data && typeof data === 'object' ? Object.keys(data).length : 0)
    }
    fs.writeFileSync(freshnessPath, JSON.stringify(freshness, null, 2), 'utf-8')
  } catch { /* freshness tracking is non-critical */ }
}

function clearCache(name, fallback = []) {
  writeCache(name, fallback)
}

function readSyncQueue() {
  if (!state.cacheDir) return []
  const filePath = path.join(state.cacheDir, 'sync-queue.json')
  const tmpPath = filePath + '.tmp'
  // Crash recovery: if a .tmp file exists, it was written atomically just before
  // a crash-interrupted renameSync. Prefer it — it may contain queued financial
  // operations (payments, bookings) that would otherwise be lost permanently.
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'))
      fs.renameSync(tmpPath, filePath)
      console.warn('[Sync Queue] Crash-recovery: promoted sync-queue.tmp to main file')
      return normalizeQueueRows(tmpData, 'sync-queue')
    } catch (error) {
      // .tmp is corrupt — discard it and fall through to main file
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-queue',
        message: `sync-queue.json.tmp could not be parsed and was discarded. Error: ${error.message}`,
        at: new Date().toISOString()
      })
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    }
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8')
    return normalizeQueueRows(JSON.parse(data), 'sync-queue')
  } catch (e) {
    if (fs.existsSync(filePath)) {
      console.warn('[Sync Queue] Parse failed — returning []. Error:', e.message)
      const quarantinePath = quarantineBadJsonFile(filePath, e.message)
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-queue',
        message: `sync-queue.json could not be parsed and was quarantined. Queued operations need manual recovery from ${quarantinePath || 'the corrupt queue backup'}. Error: ${e.message}`,
        at: new Date().toISOString()
      })
      writeSyncQueue([])
    }
    return []
  }
}

function writeSyncQueue(queue) {
  if (!state.cacheDir) return
  const filePath = path.join(state.cacheDir, 'sync-queue.json')
  const tmpPath = filePath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(Array.isArray(queue) ? queue : [], null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (e) {
    console.error('Sync queue write failed:', e)
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

function readFailedSyncQueue() {
  if (!state.cacheDir) return []
  const filePath = path.join(state.cacheDir, 'sync-failed.json')
  const tmpPath = filePath + '.tmp'
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'))
      fs.renameSync(tmpPath, filePath)
      console.warn('[Sync Queue] Crash-recovery: promoted sync-failed.tmp to main file')
      return normalizeQueueRows(tmpData, 'sync-failed')
    } catch (error) {
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-failed',
        message: `sync-failed.json.tmp could not be parsed and was discarded. Error: ${error.message}`,
        at: new Date().toISOString()
      })
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    }
  }

  try {
    return normalizeQueueRows(JSON.parse(fs.readFileSync(filePath, 'utf-8')), 'sync-failed')
  } catch (e) {
    if (fs.existsSync(filePath)) {
      const quarantinePath = quarantineBadJsonFile(filePath, e.message)
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-failed',
        message: `sync-failed.json could not be parsed and was quarantined. Dead-lettered operations need manual recovery from ${quarantinePath || 'the corrupt failed-queue backup'}. Error: ${e.message}`,
        at: new Date().toISOString()
      })
      writeFailedSyncQueue([])
    }
    return []
  }
}

function writeFailedSyncQueue(items) {
  if (!state.cacheDir) return
  const filePath = path.join(state.cacheDir, 'sync-failed.json')
  const tmpPath = filePath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(Array.isArray(items) ? items : [], null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (e) {
    console.error('[Sync] Failed-queue write failed:', e)
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

function readSyncMeta() {
  if (!state.cacheDir) return {}
  try {
    const raw = fs.readFileSync(path.join(state.cacheDir, SYNC_META_FILE), 'utf-8')
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

function writeSyncMeta(updates = {}) {
  if (!state.cacheDir) return
  const filePath = path.join(state.cacheDir, SYNC_META_FILE)
  const tmpPath = filePath + '.tmp'
  try {
    const current = readSyncMeta()
    const next = { ...current, ...updates }
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (e) {
    console.error('[Sync Meta] Write failed:', e)
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

function readHealthFaults() {
  if (!state.cacheDir) return []
  const filePath = path.join(state.cacheDir, HEALTH_FAULTS_FILE)
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!Array.isArray(parsed)) return []
    const next = parsed.filter((fault) => !isBenignBookingDriftFault(fault))
    if (next.length !== parsed.length) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8')
      } catch (writeError) {
        console.warn('[Health Fault] Could not prune benign booking drift faults:', writeError?.message || writeError)
      }
    }
    return next
  } catch {
    return []
  }
}

function readCacheFreshness() {
  if (!state.cacheDir) return {}
  try {
    const raw = fs.readFileSync(path.join(state.cacheDir, CACHE_FRESHNESS_FILE), 'utf-8')
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

function getErrorMessage(err) {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err.message) return err.message
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function uniqueSyncNames(names = []) {
  return [...new Set((names || []).filter(Boolean))]
}

function isSyncRefreshStaleFor(name) {
  return state.syncRefreshState.stale && state.syncRefreshState.names.includes(name)
}

function markSyncRefreshStale(names = [], errorMessage = 'Cache refresh failed.') {
  const mergedNames = uniqueSyncNames([...state.syncRefreshState.names, ...names])
  state.syncRefreshState = {
    stale: mergedNames.length > 0,
    names: mergedNames,
    attempts: Math.max(1, Number(state.syncRefreshState.attempts || 0)),
    lastError: String(errorMessage || 'Cache refresh failed.'),
    lastFailedAt: new Date().toISOString()
  }
  broadcastSyncStatus()
}

function clearSyncRefreshStale(names = []) {
  if (!state.syncRefreshState.stale) return
  const clearNames = new Set(uniqueSyncNames(names))
  const remainingNames = clearNames.size === 0
    ? []
    : state.syncRefreshState.names.filter((name) => !clearNames.has(name))
  state.syncRefreshState = {
    stale: remainingNames.length > 0,
    names: remainingNames,
    attempts: remainingNames.length > 0 ? state.syncRefreshState.attempts : 0,
    lastError: remainingNames.length > 0 ? state.syncRefreshState.lastError : '',
    lastFailedAt: remainingNames.length > 0 ? state.syncRefreshState.lastFailedAt : null
  }
  if (!state.syncRefreshState.stale && state.syncRefreshRetryTimer) {
    clearTimeout(state.syncRefreshRetryTimer)
    state.syncRefreshRetryTimer = null
  }
  broadcastSyncStatus()
}

function scheduleSyncRefreshRetry(names = [], reason = 'Background refresh failed.') {
  const mergedNames = uniqueSyncNames([...state.syncRefreshState.names, ...names])
  if (mergedNames.length === 0) return

  const nextAttempts = Math.max(1, Number(state.syncRefreshState.attempts || 0) + 1)
  state.syncRefreshState = {
    stale: true,
    names: mergedNames,
    attempts: nextAttempts,
    lastError: String(reason || 'Background refresh failed.'),
    lastFailedAt: new Date().toISOString()
  }
  broadcastSyncStatus()

  if (state.syncRefreshRetryTimer) return

  const waitMs = Math.min(
    SYNC_REFRESH_RETRY_MAX_DELAY_MS,
    SYNC_REFRESH_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextAttempts - 1))
  )

  state.syncRefreshRetryTimer = setTimeout(async () => {
    state.syncRefreshRetryTimer = null
    const retryNames = [...state.syncRefreshState.names]
    if (!retryNames.length || !state.isOnline || !state.lodgeId) return
    try {
      await refreshCacheStrict(...retryNames)
      clearSyncRefreshStale(retryNames)
    } catch (error) {
      console.error('[Sync] Background cache refresh retry failed:', error)
      scheduleSyncRefreshRetry(retryNames, error?.message || 'Background refresh retry failed.')
    }
  }, waitMs)
}

function mergeRemoteBookingsWithLocalState(remoteRows = [], localRows = readCache('bookings')) {
  const remoteIds = new Set((remoteRows || []).map((row) => row?.id).filter(Boolean))
  const protectedLocalRows = (localRows || []).filter((row) =>
    row?._pending_sync ||
    row?._pending_payment ||
    ['pending', 'failed', 'sync_failed', 'manual_review_required'].includes(String(row?._sync_state || ''))
  )
  const localOnlyRows = protectedLocalRows.filter((row) => row?.id && !remoteIds.has(row.id))
  return [...localOnlyRows, ...(remoteRows || [])]
}

function normalizeInventoryStockValue(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function resolveQueuedPosInventoryLink(entry = {}, { outletId = null } = {}) {
  if (entry.inventory_item_id) {
    return {
      inventoryItemId: entry.inventory_item_id,
      depletionQty: Math.max(1, Number(entry.depletion_qty || 1))
    }
  }

  const menuItem = entry.menu_item_id
    ? readCache('pos-menu-items').find((item) => item?.id === entry.menu_item_id)
    : null
  if (menuItem?.inventory_item_id) {
    return {
      inventoryItemId: menuItem.inventory_item_id,
      depletionQty: Math.max(1, Number(menuItem.depletion_qty || 1))
    }
  }

  const itemName = String(entry.item_name || '').trim().toLowerCase()
  if (!itemName) return { inventoryItemId: null, depletionQty: Math.max(1, Number(entry.depletion_qty || 1)) }
  const matches = readCache('inventory-items').filter((item) =>
    String(item?.name || '').trim().toLowerCase() === itemName &&
    (!outletId || !item?.outlet_id || item.outlet_id === outletId)
  )
  return {
    inventoryItemId: matches.length === 1 ? matches[0].id : null,
    depletionQty: Math.max(1, Number(entry.depletion_qty || 1))
  }
}

function buildQueuedPosInventoryUsage(items = [], { outletId = null } = {}) {
  const usage = new Map()
  for (const entry of items || []) {
    const inventoryItemId = resolveQueuedPosInventoryLink(entry, { outletId }).inventoryItemId
    const depletionQty = resolveQueuedPosInventoryLink(entry, { outletId }).depletionQty
    if (!inventoryItemId) continue
    const quantity = Math.max(0, Number(entry.quantity || 0))
    usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity * Math.max(1, Number(depletionQty || 1)))
  }
  return usage
}

function applyQueuedPosInventoryReservations(remoteInventoryRows = []) {
  const queuedItems = readSyncQueue().filter((item) => isPosCreateOrderQueueItem(item) || isPosVoidQueueItem(item))
  if (queuedItems.length === 0) return remoteInventoryRows || []

  const usage = new Map()
  for (const item of queuedItems) {
    const payload = item?.data?.payload || {}
    const orderUsage = buildQueuedPosInventoryUsage(payload.items || [], { outletId: payload.outlet_id || null })
    for (const [inventoryItemId, quantity] of orderUsage.entries()) {
      const multiplier = isPosVoidQueueItem(item) ? -1 : 1
      usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + (quantity * multiplier))
    }
  }

  return (remoteInventoryRows || []).map((row) => {
    const used = usage.get(row?.id) || 0
    if (!used) return row
    return {
      ...row,
      current_stock: Math.max(0, normalizeInventoryStockValue(row.current_stock) - used),
      _pending_sync: true,
      _sync_state: 'pending'
    }
  })
}

function mergeRemotePosOrdersWithLocalState(remoteRows = [], localRows = readCache('pos-orders')) {
  const remoteIds = new Set((remoteRows || []).map((row) => row?.id).filter(Boolean))
  const protectedLocalRows = (localRows || []).filter((row) =>
    row?._pending_sync ||
    ['pending', 'failed', 'sync_failed', 'manual_review_required'].includes(String(row?._sync_state || ''))
  )
  const localOnlyRows = protectedLocalRows.filter((row) => row?.id && !remoteIds.has(row.id))
  return [...localOnlyRows, ...(remoteRows || [])]
}

function readLocalPosVoidHistory() {
  return readCache('pos-void-history')
}

function writeLocalPosVoidHistory(rows = []) {
  writeCache('pos-void-history', rows)
}

function patchLocalPosVoidHistory(logId, patch = {}) {
  if (!logId) return false
  const rows = readLocalPosVoidHistory()
  const index = rows.findIndex((row) => row?.id === logId)
  if (index < 0) return false
  const next = [...rows]
  next[index] = { ...next[index], ...patch }
  writeLocalPosVoidHistory(next)
  return true
}

function roundMoneyValue(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

async function refreshCacheStrict(...names) {
  if (!state.lodgeId) return
  const fetchers = {
    users: () => state.supabase.from('users').select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash').eq('lodge_id', state.lodgeId).order('name'),
    rooms: () => state.supabase.from('rooms').select('*').eq('lodge_id', state.lodgeId).order('room_number'),
    customers: () => state.supabase.from('customers').select('*').eq('lodge_id', state.lodgeId).order('name'),
    bookings: () => state.supabase.from('bookings').select('*').eq('lodge_id', state.lodgeId).order('check_in', { ascending: false }),
    maintenance: () => state.supabase
      .from('maintenance_tickets')
      .select('*, rooms(room_number, room_type)')
      .eq('lodge_id', state.lodgeId)
      .order('created_at', { ascending: false }),
    'inventory-items': () => state.supabase.from('inventory_items').select('*').eq('lodge_id', state.lodgeId).order('category').order('name'),
    'inventory-purchases': () => state.supabase.from('inventory_purchases').select('*').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    quotations: () => state.supabase.from('quotations').select('*').eq('lodge_id', state.lodgeId).order('created_at', { ascending: false }),
    'conference-bookings': () => state.supabase.from('conference_bookings').select('*').eq('lodge_id', state.lodgeId).order('booking_date', { ascending: false }).order('start_time', { ascending: true }),
    'pool-day-use': () => state.supabase.from('pool_day_use').select('*').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    expenses: () => state.supabase.from('expenses').select('*, outlets(name)').eq('lodge_id', state.lodgeId).order('date', { ascending: false }),
    'pos-orders': () => state.supabase
      .from('pos_orders')
      .select('*, pos_order_items(*), outlets(name)')
      .eq('lodge_id', state.lodgeId)
      .order('created_at', { ascending: false }),
    'pos-menu-items': () => state.supabase.from('pos_menu_items').select('*').eq('lodge_id', state.lodgeId).order('category').order('name'),
    outlets: () => state.supabase.from('outlets').select('id, name, type, sort_order, is_active').eq('lodge_id', state.lodgeId).order('sort_order')
  }

  await Promise.all(names.map(async (name) => {
    if (!fetchers[name]) return
    const { data, error } = await fetchers[name]()
    if (error) throw error
    if (!data) return
    if (name === 'users') {
      const normalizedUsers = data.map(normalizeUserRecord).filter(Boolean)
      writeCache(name, normalizedUsers, { source: 'remote' })
      if (state.currentUser && !state.currentUser.isMasterAdmin) {
        const refreshedUser = normalizedUsers.find((entry) =>
          (state.currentUser.id && entry.id === state.currentUser.id) ||
          (!state.currentUser.id && state.currentUser.email && entry.email === state.currentUser.email)
        )
        if (refreshedUser) {
          setCurrentUserInternal(mergeSessionUserScope(state.currentUser, refreshedUser))
        }
      }
      return
    }
    if (name === 'bookings') {
      writeCache(name, mergeRemoteBookingsWithLocalState(data || []), { source: 'remote' })
      return
    }
    if (name === 'inventory-items') {
      writeCache(name, applyQueuedPosInventoryReservations(data || []), { source: 'remote' })
      return
    }
    if (name === 'pos-orders') {
      writeCache(name, mergeRemotePosOrdersWithLocalState(data || []), { source: 'remote' })
      return
    }
    writeCache(name, data, { source: 'remote' })
  }))
}

function setCurrentUserInternal(user) {
  state.currentUser = normalizeSessionUser(user)
  if (state.currentUser?.isMasterAdmin) {
    state.backendSession = null
    console.log('[Auth] Backend session cleared')
  }
  // P0-5: a real user is now authenticated — allow queue replay
  if (state.currentUser) {
    state.replayAuthReady = true
  }
}

async function refreshCache(...names) {
  try {
    await refreshCacheStrict(...names)
    clearSyncRefreshStale(uniqueSyncNames(names).filter((name) => isSyncRefreshStaleFor(name)))
  } catch (e) {
    console.error('Cache refresh failed:', e)
  }
}

async function refreshAllCaches() {
  if (!state.lodgeId) return
  await refreshCache(
    'users',
    'rooms',
    'customers',
    'bookings',
    'maintenance',
    'inventory-items',
    'inventory-purchases',
    'quotations',
    'conference-bookings',
    'pool-day-use',
    'pos-orders',
    'pos-menu-items',
    'outlets',
    'expenses'
  )
}

async function refreshCachesAfterSync(...names) {
  const targetNames = uniqueSyncNames(names)
  if (targetNames.length === 0) return
  try {
    await refreshCacheStrict(...targetNames)
    clearSyncRefreshStale(targetNames)
  } catch (error) {
    console.error('[Sync] Post-sync cache refresh failed:', error)
    markSyncRefreshStale(targetNames, error?.message || 'Post-sync cache refresh failed.')
    scheduleSyncRefreshRetry(targetNames, error?.message || 'Post-sync cache refresh failed.')
  }
}

async function checkOnline() {
  if (process.env.BOROKO_TEST_FORCE_OFFLINE === 'true') {
    const wasOnline = state.isOnline
    state.isOnline = false
    state.consecutiveConnectivityFailures = CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD
    if (wasOnline) broadcastSyncStatus()
    return state.isOnline
  }
  const wasOnline = state.isOnline
  let rawOnline = false
  const base = SUPABASE_URL.replace(/\/$/, '')
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`
  }
  const fetchWithTimeout = async (url, init = {}) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), CONNECTIVITY_PROBE_TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, headers, signal: ctrl.signal })
    } finally {
      clearTimeout(t)
    }
  }
  const reachable = (res) => res.status > 0 && res.status < 500

  try {
    let res = await fetchWithTimeout(`${base}/auth/v1/health`, { method: 'GET' })
    if (res.status >= 500) {
      res = await fetchWithTimeout(`${base}/rest/v1/`, { method: 'GET' })
    }
    rawOnline = reachable(res)
  } catch {
    try {
      const res = await fetchWithTimeout(`${base}/rest/v1/`, { method: 'GET' })
      rawOnline = reachable(res)
    } catch {
      rawOnline = false
    }
  }

  if (rawOnline) {
    state.consecutiveConnectivityFailures = 0
    state.isOnline = true
  } else {
    state.consecutiveConnectivityFailures += 1
    if (state.consecutiveConnectivityFailures >= CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD) {
      state.isOnline = false
    }
  }

  if (wasOnline !== state.isOnline) broadcastSyncStatus()
  return state.isOnline
}

function createQueueOperationId(prefix = 'op') {
  return `${prefix}-${randomUUID()}`
}

function createBookingIdempotencyKey(bookingId) {
  return `create-booking:${bookingId}`
}

function createPaymentIdempotencyKey(bookingId, type = 'payment', intentId = null, fallbackSignature = null) {
  if (type === 'deposit') {
    // Deterministic — bound to the booking, safe to replay without generating a duplicate
    return `payment:deposit:${bookingId}`
  }
  // If intentId is provided, use it for deterministic idempotency across sessions
  if (intentId) {
    return `payment:${type}:${bookingId}:${intentId}`
  }
  // Fallback: if signature is provided (booking+status+amount), use it for deterministic key
  // This prevents double-payments even if intentKey is lost after app restart
  if (fallbackSignature) {
    return `payment:${type}:${fallbackSignature}`
  }
  // Last resort: generate random key (logs warning in caller)
  return `payment:${type}:${bookingId}:${randomUUID()}`
}

function buildPaymentFallbackSignature(bookingId, type, amount, bookingVersion = null) {
  const normalizedAmount = roundMoneyValue(Math.abs(amount)).toFixed(2)
  const normalizedVersion = bookingVersion || 'no-version'
  return `${bookingId}:${type}:${normalizedAmount}:${normalizedVersion}`
}

function ensureQueuedItem(item = {}, fallbackType = 'op') {
  return {
    ...item,
    _queue_id: item._queue_id || createQueueOperationId(fallbackType)
  }
}

function isBookingUpdateConflictError(message = '') {
  return /modified on another device|booking conflict|refresh and try again/i.test(String(message || ''))
}

function shouldManualReviewSyncItem(item, errorMessage = '') {
  return item?.table === 'update_booking' && isBookingUpdateConflictError(errorMessage)
}

function isPosCreateOrderQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'create_pos_order'
}

function isPosVoidQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'approve_pos_void_with_pin'
}

function getQueuedPosOrderId(item) {
  const payloadId = String(item?.data?.payload?.id || item?.data?.payload?.order_id || '').trim()
  if (payloadId) return payloadId

  const queueId = String(item?._queue_id || '').trim()
  if (queueId.startsWith('pos-order-')) {
    const parsedId = queueId.slice('pos-order-'.length).trim()
    if (parsedId) return parsedId
  }
  if (queueId.startsWith('pos-void-')) {
    const parsedId = queueId.slice('pos-void-'.length).trim()
    if (parsedId) return parsedId
  }

  console.error('[POS SYNC] Missing staged order id for queue item', {
    queueId: item?._queue_id || null,
    table: item?.table || null
  })
  return null
}

function getSyncItemBookingId(item) {
  return item?.data?.p_booking_id
    || item?.data?.payload?.booking_id
    || item?.data?.payload?.id
    || item?.data?.p_id
    || null
}

function getSyncItemEntityId(item, prefix) {
  const directId = item?.data?.p_id || item?.data?.payload?.id || item?.data?.payload?.user_id || null
  if (directId) return directId
  const queueId = String(item?._queue_id || '').trim()
  if (queueId.startsWith(`${prefix}-`)) return queueId.slice(prefix.length + 1).trim() || null
  return null
}

function getSyncItemCustomerId(item) {
  return getSyncItemEntityId(item, 'customer')
}

function getSyncItemRoomId(item) {
  return getSyncItemEntityId(item, 'room')
}

function getSyncItemUserId(item) {
  return getSyncItemEntityId(item, 'user')
}

function getSyncItemQuotationId(item) {
  const quotationId = String(item?.data?.p_quotation_id || '').trim()
  if (quotationId) return quotationId
  return getSyncItemEntityId(item, 'quotation')
}

function getSyncItemScope(item) {
  const bookingId = getSyncItemBookingId(item)
  if (bookingId) return `booking:${bookingId}`
  const posOrderId = getQueuedPosOrderId(item)
  if (posOrderId) return `pos-order:${posOrderId}`
  return item?.table || 'unknown'
}

function isQueuedDependencyResolved(dependencyId) {
  const normalizedDependencyId = String(dependencyId || '').trim()
  if (!normalizedDependencyId) return false

  const target = QUEUED_DEPENDENCY_CACHE_MAP.find(({ prefix }) => normalizedDependencyId.startsWith(prefix))
  if (!target) return false

  const entityId = normalizedDependencyId.slice(target.prefix.length).trim()
  if (!entityId) return false

  const cachedRow = readCache(target.cache).find((entry) => entry?.id === entityId)
  if (!cachedRow) return false

  return cachedRow._pending_sync !== true
    && cachedRow._sync_state !== 'manual_review_required'
    && cachedRow._sync_state !== 'failed'
}

function patchCachedPosOrderSyncState(orderId, patch = {}) {
  if (!orderId) return false
  const cachedOrders = readCache('pos-orders')
  const index = cachedOrders.findIndex((row) => row?.id === orderId)
  if (index < 0) {
    console.warn('POS sync patch skipped: order not found in cache', orderId)
    return false
  }

  const existing = cachedOrders[index] || {}
  if (existing._sync_state === 'synced'
    && patch._sync_state !== 'failed'
    && patch._pending_sync !== true
    && !Object.prototype.hasOwnProperty.call(patch, 'status')) {
    return false
  }

  const next = [...cachedOrders]
  next[index] = {
    ...existing,
    ...patch
  }
  writeCache('pos-orders', next)
  return true
}

function isCreateBookingQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'create_booking'
}

function isConvertQuotationQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'convert_quotation_to_booking'
}

function getQueuedBookingId(item) {
  const bookingId = String(item?.data?.p_booking_id || '').trim()
  if (bookingId) return bookingId

  const queueId = String(item?._queue_id || '').trim()
  if (queueId.startsWith('booking-')) {
    const parsedId = queueId.slice('booking-'.length).trim()
    if (parsedId) return parsedId
  }

  console.error('[BOOKING SYNC] Missing booking id for queue item', {
    queueId: item?._queue_id || null,
    table: item?.table || null
  })
  return null
}

function getQueuedQuotationId(item) {
  const quotationId = String(item?.data?.p_quotation_id || item?.data?.payload?.id || '').trim()
  if (quotationId) return quotationId

  const queueId = String(item?._queue_id || '').trim()
  if (queueId.startsWith('quotation-')) {
    const parsedId = queueId.slice('quotation-'.length).trim()
    if (parsedId) return parsedId
  }

  return null
}

function isRoomConflictError(message = '') {
  return /no_overlapping_bookings|room is already booked|room is not available|room.*conflict/i.test(String(message || ''))
}

function patchCachedBookingSyncState(bookingId, patch = {}) {
  if (!bookingId) return false
  const cachedBookings = readCache('bookings')
  const index = cachedBookings.findIndex((row) => row?.id === bookingId)
  if (index < 0) {
    console.warn('Booking sync patch skipped: booking not found in cache', bookingId)
    return false
  }

  const existing = cachedBookings[index] || {}
  if (existing._sync_state === 'synced' && patch._sync_state !== 'sync_failed') {
    return false
  }

  const next = [...cachedBookings]
  next[index] = {
    ...existing,
    ...patch
  }
  writeCache('bookings', next)
  return true
}

function rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId) {
  if (!item || !localBookingId || !serverBookingId || localBookingId === serverBookingId) return item
  const next = { ...item, data: { ...(item?.data || {}) } }
  let changed = false
  if (next.data.p_booking_id === localBookingId) {
    next.data.p_booking_id = serverBookingId
    changed = true
  }
  if (next.data.p_id === localBookingId) {
    next.data.p_id = serverBookingId
    changed = true
  }
  if (next.data.booking_id === localBookingId) {
    next.data.booking_id = serverBookingId
    changed = true
  }
  if (next.data.payload?.booking_id === localBookingId) {
    next.data.payload = {
      ...next.data.payload,
      booking_id: serverBookingId
    }
    changed = true
  }
  if (next._depends_on === `booking-${localBookingId}`) {
    next._depends_on = `booking-${serverBookingId}`
    changed = true
  }
  return changed ? next : item
}

function normalizeQueuedSyncItemForReplay(item = {}) {
  if (!item) return item
  const next = { ...item, data: { ...(item.data || {}) } }

  if (next.type === 'rpc' && next.table === 'update_quotation' && !('p_expected_updated_at' in next.data)) {
    next.data.p_expected_updated_at = null
  }

  if (next.type === 'rpc'
    && next.table === 'update_booking_status'
    && String(next._depends_on || '').startsWith('booking-')) {
    next.data.p_expected_updated_at = null
  }

  return next
}

function replaceQueuedBookingReference(localBookingId, serverBookingId) {
  if (!localBookingId || !serverBookingId || localBookingId === serverBookingId) return false

  const queued = readSyncQueue()
  const rewrittenQueue = queued.map((item) => rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId))
  if (JSON.stringify(queued) !== JSON.stringify(rewrittenQueue)) {
    writeSyncQueue(rewrittenQueue)
  }

  const failed = readFailedSyncQueue()
  const rewrittenFailed = failed.map((item) => rewriteQueuedBookingReferenceItem(item, localBookingId, serverBookingId))
  if (JSON.stringify(failed) !== JSON.stringify(rewrittenFailed)) {
    writeFailedSyncQueue(rewrittenFailed)
  }

  return JSON.stringify(queued) !== JSON.stringify(rewrittenQueue)
    || JSON.stringify(failed) !== JSON.stringify(rewrittenFailed)
}

function patchCachedRowSyncState(cacheName, entityId, patch = {}) {
  if (!entityId) return false
  const cachedRows = readCache(cacheName)
  const index = cachedRows.findIndex((row) => row?.id === entityId)
  if (index < 0) {
    console.warn(`${cacheName} sync patch skipped: row not found in cache`, entityId)
    return false
  }
  const next = [...cachedRows]
  next[index] = { ...(cachedRows[index] || {}), ...patch }
  writeCache(cacheName, next)
  return true
}

function patchCachedCustomerSyncState(customerId, patch = {}) {
  return patchCachedRowSyncState('customers', customerId, patch)
}

function patchCachedRoomSyncState(roomId, patch = {}) {
  return patchCachedRowSyncState('rooms', roomId, patch)
}

function patchCachedUserSyncState(userId, patch = {}) {
  return patchCachedRowSyncState('users', userId, patch)
}

function patchCachedQuotationSyncState(quotationId, patch = {}) {
  return patchCachedRowSyncState('quotations', quotationId, patch)
}

function valuesEqualForDrift(left, right) {
  if (left == null && right == null) return true
  const leftNum = Number(left)
  const rightNum = Number(right)
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return Math.abs(leftNum - rightNum) < 0.0001
  }
  return String(left) === String(right)
}

function hasDriftBaselineValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function isBenignBookingDriftFault(fault = {}) {
  if (fault?.type !== 'booking_drift') return false
  const drifts = Array.isArray(fault?.context?.drifts)
    ? fault.context.drifts
    : String(fault?.message || '').split(';').map((entry) => entry.trim()).filter(Boolean)
  if (drifts.length === 0) return false
  return drifts.every((entry) =>
    /^(customer_id|room_id): local (undefined|null|) ?→ server [0-9a-f-]+$/i.test(String(entry || '').trim())
  )
}

function queueItemNeedsBookingRefresh(item) {
  if (!item) return false
  if (isPosCreateOrderQueueItem(item)) {
    return !!(item?.data?.payload?.booking_id || item?.data?.payload?.room_id)
  }
  if (item?.type === 'rpc') {
    return new Set([
      'create_booking',
      'update_booking',
      'update_booking_status',
      'update_booking_payment',
      'create_booking_record',
      'convert_quotation_to_booking'
    ]).has(item.table)
  }
  return item?.table === 'bookings'
}

function queueItemNeedsInventoryRefresh(item) {
  if (!isPosCreateOrderQueueItem(item) && !isPosVoidQueueItem(item)) return false
  const items = Array.isArray(item?.data?.payload?.items) ? item.data.payload.items : []
  return items.some((entry) => !!entry?.menu_item_id || !!entry?.inventory_item_id)
}

function isAlreadyAppliedInsertError(item, error) {
  if (item?.type !== 'insert') return false
  if (!item?.data?.id) return false
  const code = String(error?.code || '').trim()
  return SYNC_ALREADY_APPLIED_CODES.has(code)
}

function isAlreadyAppliedRpcError(item, errorOrMessage) {
  if (item?.type !== 'rpc') return false
  const message = getErrorMessage(errorOrMessage)
  if (isConvertQuotationQueueItem(item) && /quotation is already converted|quotation is already .*converted|already converted/i.test(message)) {
    return true
  }
  const payloadId = item?.data?.payload?.id || item?.data?.p_booking_id || item?.data?.p_quotation_id || null
  if (!payloadId) return false

  const code = String(errorOrMessage?.code || '').trim()
  return SYNC_ALREADY_APPLIED_CODES.has(code)
    || /duplicate key|unique constraint|already exists|already applied|23505/i.test(message)
}

function buildSyncGroupedCounts(pending = [], failed = []) {
  const pendingMissingParent = pending.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'missing_parent').length
  const failedMissingParent = failed.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'missing_parent').length
  const pendingBlockedDependencies = pending.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'blocked_dependencies').length
  const failedBlockedDependencies = failed.filter((item) => classifySyncDependencyCategory(item, pending, failed) === 'blocked_dependencies').length
  const financialRiskItems = pending.filter(isFinancialSyncItem).length + failed.filter(isFinancialSyncItem).length

  return {
    missing_parent: pendingMissingParent + failedMissingParent,
    blocked_dependencies: pendingBlockedDependencies + failedBlockedDependencies,
    financial_risk_items: financialRiskItems,
    failed_items: failed.length,
    pending_items: pending.length
  }
}

function classifySyncDependencyCategory(item = {}, pending = [], failed = []) {
  const dependencyId = String(item?._depends_on || '').trim()
  if (!dependencyId) return 'none'

  if (failed.some((entry) => entry?._queue_id === dependencyId)) {
    return 'blocked_dependencies'
  }
  if (pending.some((entry) => entry?._queue_id === dependencyId)) {
    return 'blocked_dependencies'
  }
  if (isQueuedDependencyResolved(dependencyId)) {
    return 'resolved'
  }
  return 'missing_parent'
}

function getSyncStatus() {
  const queue = readSyncQueue()
  const failed = readFailedSyncQueue()
  const faults = readHealthFaults()
  const syncMeta = readSyncMeta()
  const extractBookingId = (item) => (
    item?.data?.p_booking_id
    || item?.data?.payload?.booking_id
    || item?.data?.payload?.id
    || item?.data?.p_id
    || item?._local_booking_id
    || null
  )
  const failedBookingIds = failed
    .filter(item => ['create_booking', 'create_booking_record', 'update_booking'].includes(item.table))
    .map(item => item.data?.p_booking_id || item.data?.payload?.id || item.data?.p_id)
    .filter(Boolean)
  const financialPendingBookingIds = [...new Set(
    queue
      .filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table))
      .map(extractBookingId)
      .filter(Boolean)
  )]
  const financialFailedBookingIds = [...new Set(
    failed
      .filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table))
      .map(extractBookingId)
      .filter(Boolean)
  )]
  const financialPendingCount = queue.filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table)).length
  const financialFailedCount = failed.filter((item) => FINANCIAL_SYNC_TABLES.has(item?.table)).length
  const groupedCounts = buildSyncGroupedCounts(queue, failed)
  // P0-1: lastSuccessfulSyncAt from memory first, fall back to persisted meta
  const resolvedLastSync = state.lastSuccessfulSyncAt || syncMeta.lastSuccessfulSyncAt || null
  return {
    pending: queue.length,
    failed: failed.length,
    // P0-2: named fields as specified
    currentQueueLength: queue.length,
    currentDeadLetterWrites: failed.length,
    isOnline: state.isOnline,
    // P0-2: expose replay in-progress state
    syncInProgress: state.syncInProgress,
    replayAuthReady: state.replayAuthReady,
    failedBookingIds,
    financialPendingBookingIds,
    financialFailedBookingIds,
    financialPendingCount,
    financialFailedCount,
    groupedCounts,
    lastSuccessfulSyncAt: resolvedLastSync,
    // P0-1: full sync meta
    syncMeta: {
      lastSyncStartedAt: syncMeta.lastSyncStartedAt || null,
      lastSyncFinishedAt: syncMeta.lastSyncFinishedAt || null,
      lastSyncOutcome: syncMeta.lastSyncOutcome || null,
      lastSyncError: syncMeta.lastSyncError || '',
      replayAuthNotReadyAt: syncMeta.replayAuthNotReadyAt || null
    },
    // P0-4: expose corruption/integrity faults
    faults,
    cacheStale: {
      active: state.syncRefreshState.stale,
      names: state.syncRefreshState.names,
      attempts: state.syncRefreshState.attempts,
      lastError: state.syncRefreshState.lastError,
      lastFailedAt: state.syncRefreshState.lastFailedAt
    }
  }
}

function broadcastSyncStatus() {
  try {
    const status = getSyncStatus()
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('sync:status-changed', status)
    })
  } catch (e) {
    console.error('[Sync] IPC broadcast failed:', e)
  }
}

async function requeueEligibleFailedSyncItems(minAgeMs = DEAD_LETTER_AUTO_RETRY_AFTER_MS) {
  const failed = readFailedSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'))
  if (failed.length === 0) return { retried: 0, remaining: 0 }

  const now = Date.now()
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'))
  const existingIds = new Set(queue.map((item) => item._queue_id))
  const keepFailed = []
  const retryItems = []

  for (const item of failed) {
    const attemptedAtMs = item.lastAttemptedAt ? Date.parse(item.lastAttemptedAt) : NaN
    const shouldRetry = Number.isNaN(attemptedAtMs) || (now - attemptedAtMs) >= minAgeMs
    if (item.manualRetryOnly === true || !shouldRetry) {
      keepFailed.push(item)
      continue
    }

    const cleanItem = normalizeQueuedSyncItemForReplay({
      ...item,
      _state: 'pending',
      retryCount: 0,
      lastError: '',
      lastAttemptedAt: null
    })

    if (!existingIds.has(cleanItem._queue_id)) {
      queue.push(cleanItem)
      existingIds.add(cleanItem._queue_id)
    }

    if (isPosCreateOrderQueueItem(cleanItem)) {
      const orderId = getQueuedPosOrderId(cleanItem)
      if (orderId) {
        patchCachedPosOrderSyncState(orderId, {
          _sync_state: 'pending',
          _sync_error: null
        })
      }
    }

    retryItems.push(cleanItem)
  }

  if (retryItems.length === 0) return { retried: 0, remaining: failed.length }

  writeFailedSyncQueue(keepFailed)
  writeSyncQueue(queue)
  console.warn(`[Sync] Auto-requeued ${retryItems.length} dead-lettered item(s) for another attempt.`)
  broadcastSyncStatus()
  return { retried: retryItems.length, remaining: keepFailed.length }
}

async function processSyncQueue() {
  if (state.syncInProgress) return { success: false, skipped: true, error: 'Sync is already in progress.' }
  // P0-5: Never replay queued operations before a real user session is confirmed.
  // Offline financial RPCs carry lodge-scoped auth; replaying them before the
  // correct Supabase client/session is restored can poison data or fail silently.
  if (!state.replayAuthReady) {
    console.warn('[Sync] processSyncQueue skipped — replayAuthReady is false (no authenticated session yet)')
    writeSyncMeta({ replayAuthNotReadyAt: new Date().toISOString() })
    return { success: false, skipped: true, error: 'No authenticated session — please log in first.' }
  }
  state.syncInProgress = true
  try {
    await _runSyncQueue()
    return { success: true }
  } catch (error) {
    const message = getErrorMessage(error)
    console.error('[Sync] Fatal sync loop error:', error)
    appendHealthFault({
      type: 'sync_loop_error',
      scope: 'sync-queue',
      severity: 'error',
      message,
      at: new Date().toISOString()
    })
    writeSyncMeta({
      lastSyncFinishedAt: new Date().toISOString(),
      lastSyncOutcome: 'fatal_error',
      lastSyncError: message
    })
    return { success: false, error: message }
  } finally {
    state.syncInProgress = false
    broadcastSyncStatus()
  }
}

async function _runSyncQueue() {
  await requeueEligibleFailedSyncItems()
  let queue = readSyncQueue()
    .map((item) => ensureQueuedItem(item, item?.type || 'op'))
    .map(normalizeQueuedSyncItemForReplay)
  if (queue.length === 0) return

  // Normalize items left over from a previous (possibly crashed) run.
  // committed → drop (RPC already succeeded; do not retry)
  // in_flight → reset to pending (result unknown; retry — safe for all current operations)
  const normalized = []
  for (const item of queue) {
    if (item._state === 'committed') {
      console.log('[SYNC COMMITTED CLEANUP]', item._queue_id)
      continue
    }
    normalized.push(item._state === 'in_flight' ? { ...item, _state: 'pending' } : item)
  }
  if (normalized.length !== queue.length) writeSyncQueue(normalized)
  queue = normalized

  // P0-1: record that a sync run has started
  writeSyncMeta({ lastSyncStartedAt: new Date().toISOString(), lastSyncOutcome: 'in_progress', lastSyncError: '' })

  console.log(`Syncing ${queue.length} offline operation(s)...`)
  const deadLetter = []
  let successCount = 0
  // Tracks _queue_ids of items that failed — dependents will be skipped.
  // Pre-seeded from sync-failed.json so children of a previously dead-lettered
  // parent are blocked immediately, not executed against a non-existent booking.
  // readFailedSyncQueue always returns []; corrupted file cannot crash this path.
  const _priorDeadLetter = readFailedSyncQueue()
  const failedQueueIds = new Set(_priorDeadLetter.map(item => item._queue_id).filter(Boolean))
  const completedQueueIds = new Set()
  console.log('[SYNC PRELOAD FAILED IDS]', [...failedQueueIds])
  const pending = [...queue]
  // P1-8: widen post-sync refresh tracking
  let shouldRefreshBookings = false
  let shouldRefreshInventory = false
  let shouldRefreshCustomers = false
  let shouldRefreshRooms = false
  let shouldRefreshUsers = false
  let shouldRefreshQuotations = false
  let shouldRefreshPosOrders = false
  let shouldRefreshConference = false
  let shouldRefreshPoolDayUse = false

  while (pending.length > 0) {
    const nextIndex = pickNextReadySyncItemIndex(
      pending,
      completedQueueIds,
      failedQueueIds,
      isQueuedDependencyResolved
    )
    if (nextIndex === -1) {
      const blockedAt = new Date().toISOString()
      while (pending.length > 0) {
        const blockedItem = {
          ...pending.shift(),
          _state: 'pending',
          retryCount: MAX_SYNC_RETRIES,
          lastError: 'Blocked: unresolved sync dependency cycle',
          lastAttemptedAt: blockedAt,
          manualRetryOnly: true
        }
        if (blockedItem?._queue_id) failedQueueIds.add(blockedItem._queue_id)
        deadLetter.push(blockedItem)
      }
      writeSyncQueue([])
      break
    }

    const [item] = pending.splice(nextIndex, 1)
    // Skip items whose parent operation failed this run
    if (item._depends_on && failedQueueIds.has(item._depends_on)) {
      console.warn('[SYNC SKIPPED DEPENDENT]', { operation: item.table, queueId: item._queue_id, dependsOn: item._depends_on })
      const retryCount = (item.retryCount || 0) + 1
      const skipped = { ...item, _state: 'pending', retryCount, lastError: 'Skipped: parent operation failed', lastAttemptedAt: new Date().toISOString() }
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item)
        if (orderId) {
          console.warn('[POS SYNC] Failed order', orderId, 'Skipped: parent operation failed')
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: 'Skipped: parent operation failed'
          })
        }
      }
      // Also mark related bookings as failed if their create_booking parent failed
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item)
        if (bookingId) {
          console.warn('[BOOKING SYNC] Failed booking', bookingId, 'Skipped: parent operation failed')
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: 'Skipped: parent operation failed'
          })
        }
      }
      if (retryCount >= MAX_SYNC_RETRIES) {
        deadLetter.push(skipped)
      } else {
        pending.push(skipped)
      }
      writeSyncQueue(pending)
      continue
    }

    const priorRetries = Math.max(0, Number(item.retryCount || 0))
    if (priorRetries > 0) {
      const backoffMs = Math.min(
        SYNC_RETRY_MAX_DELAY_MS,
        SYNC_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, priorRetries - 1))
      )
      console.warn(`[Sync] Backing off ${backoffMs}ms before retrying ${item.type} ${item.table}`)
      await delay(backoffMs)
    }

    // Persist in_flight before issuing remote call.
    // Crash here → restart normalizes to pending and retries safely.
    writeSyncQueue([{ ...item, _state: 'in_flight' }, ...pending])

    let supabaseError = null
    let rpcResultData = null
    try {
      if (item.type === 'insert') {
        const payload = {
          ...item.data,
          lodge_id: item.data.lodge_id || state.lodgeId
        }

        const { data, error } = await state.supabase
          .from(item.table)
          .insert(payload)
          .select()

        if (error) {
          if (isAlreadyAppliedInsertError(item, error)) {
            console.warn(`↻ INSERT ${item.table} already applied remotely for id ${item.data.id}; treating as synced`)
            supabaseError = null
          } else {
            console.error('❌ INSERT FAILED:', error)
            supabaseError = error
          }
        } else {
          console.log('✅ INSERT SUCCESS:', data)
        }
      } else if (item.type === 'update') {
        // P2-14: use .select('id') to verify at least one row was actually matched.
        // A 0-row result means the entity was deleted or moved on the server during
        // the outage — the update is silently lost. We surface this as a health fault
        // rather than treating it as a success.
        const itemLodgeId = item.data?.lodge_id || item.lodge_id || state.lodgeId
        const { data: updData, error: updError } = await state.supabase
          .from(item.table)
          .update(item.data)
          .eq('id', item.id)
          .eq('lodge_id', itemLodgeId)
          .select('id')
        supabaseError = updError || null
        if (!updError && (!updData || updData.length === 0)) {
          // Row not found on server — record as a fault but treat operation as consumed
          const ghostMsg = `UPDATE ${item.table} id=${item.id} matched 0 rows on server (entity may have been deleted during outage)`
          console.warn('[Sync] Ghost update:', ghostMsg)
          appendHealthFault({ type: 'ghost_update', scope: item.table, message: ghostMsg, at: new Date().toISOString() })
        }
      } else if (item.type === 'delete') {
        const itemLodgeId = item.data?.lodge_id || item.lodge_id || state.lodgeId
          ; ({ error: supabaseError } = await state.supabase.from(item.table).delete().eq('id', item.id).eq('lodge_id', itemLodgeId))
      } else if (item.type === 'rpc') {
        const { data, error } = await state.supabase.rpc(item.table, item.data)
        rpcResultData = data || null
        if (error) {
          if (isAlreadyAppliedRpcError(item, error)) {
            console.warn(`↻ RPC ${item.table} already applied remotely for queued id; treating as synced`, item._queue_id)
            supabaseError = null
          } else {
            console.error(`❌ RPC ${item.table} FAILED:`, error)
            supabaseError = error
          }
        } else if (data && data.success === false) {
          if (isAlreadyAppliedRpcError(item, data.error)) {
            console.warn(`↻ RPC ${item.table} reported duplicate for queued id; treating as synced`, item._queue_id)
            supabaseError = null
          } else {
            console.error(`❌ RPC ${item.table} LOGIC FAILED:`, data.error)
            supabaseError = { message: data.error }
          }
        } else {
          console.log(`✅ RPC ${item.table} SUCCESS:`, data)
        }
      }
    } catch (e) {
      supabaseError = { message: e.message }
    }

    if (supabaseError) {
      // Track failed queue IDs so dependents are skipped
      if (item._queue_id) failedQueueIds.add(item._queue_id)
      const errorMessage = getErrorMessage(supabaseError)
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item)
        if (orderId) {
          console.warn('[POS SYNC] Failed order', orderId, errorMessage)
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          })
        }
      }
      if (isPosVoidQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item)
        if (orderId) {
          console.warn('[POS VOID SYNC] Failed void', orderId, errorMessage)
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `POS void rejected by server: ${errorMessage}`
          })
          patchLocalPosVoidHistory(item?.data?.payload?.override_log_id, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: errorMessage
          })
        }
      }
      // P1-13: mark rejected optimistic state for update/payment/status RPCs
      if (item.type === 'rpc' && ['update_booking', 'update_booking_status', 'update_booking_payment', 'add_booking_charge', 'delete_booking_charge', 'approve_booking_refund'].includes(item.table)) {
        const bookingId = item.data?.p_booking_id || item.data?.p_id || null
        if (bookingId) {
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: 'failed',
            _sync_error: `${item.table} rejected by server: ${errorMessage}`
          })
        }
      }
      // Handle booking creation failures (especially room conflicts)
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item)
        if (bookingId) {
          const isConflict = isRoomConflictError(errorMessage)
          console.warn('[BOOKING SYNC] Failed booking', bookingId, isConflict ? '(room conflict)' : '', errorMessage)
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: true,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          })
          // Notify renderer about booking conflict
          if (isConflict) {
            try {
              BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed()) {
                  win.webContents.send('booking:sync-conflict', {
                    bookingId,
                    error: 'This room is already booked for the selected dates.',
                    details: errorMessage
                  })
                }
              })
            } catch (e) {
              console.error('[BOOKING SYNC] Failed to notify renderer:', e)
            }
          }
        }
      }
      if (isConvertQuotationQueueItem(item)) {
        const quotationId = getSyncItemQuotationId(item)
        const localBookingId = item._local_booking_id || null
        const isConflict = isRoomConflictError(errorMessage)
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            status: item._previous_status || 'accepted',
            converted_booking_id: null,
            _pending_sync: true,
            _pending_conversion: false,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          })
        }
        if (localBookingId) {
          patchCachedBookingSyncState(localBookingId, {
            _pending_sync: true,
            _sync_state: isConflict ? 'sync_failed' : 'failed',
            _sync_error: errorMessage
          })
        }
      }
      const retryCount = (item.retryCount || 0) + 1
      const manualReviewOnly = shouldManualReviewSyncItem(item, errorMessage)
        || ((isCreateBookingQueueItem(item) || isConvertQuotationQueueItem(item)) && isRoomConflictError(errorMessage))
        || item.manualRetryOnly === true
      const updatedItem = {
        ...item,
        _state: 'pending',   // reset from in_flight
        retryCount: manualReviewOnly ? MAX_SYNC_RETRIES : retryCount,
        lastError: errorMessage,
        lastAttemptedAt: new Date().toISOString(),
        manualRetryOnly: manualReviewOnly
      }
      if (updatedItem.retryCount >= MAX_SYNC_RETRIES) {
        console.error(`[Sync] Dead-lettered after ${MAX_SYNC_RETRIES} attempts — ${item.type} ${item.table}:`, errorMessage)
        deadLetter.push(updatedItem)
      } else {
        console.warn(`[Sync] Failed (attempt ${updatedItem.retryCount}/${MAX_SYNC_RETRIES}) — ${item.type} ${item.table}:`, errorMessage)
        pending.push(updatedItem)
      }
      writeSyncQueue(pending)
    } else {
      if (isPosCreateOrderQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item)
        if (orderId) {
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          })
          console.log('[POS SYNC] Synced order', orderId)
        }
      }
      if (isPosVoidQueueItem(item)) {
        const orderId = getQueuedPosOrderId(item)
        if (orderId) {
          patchCachedPosOrderSyncState(orderId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _pending_void: false,
            _synced_at: new Date().toISOString()
          })
          patchLocalPosVoidHistory(item?.data?.payload?.override_log_id, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null
          })
          console.log('[POS VOID SYNC] Synced void', orderId)
        }
      }
      if (isCreateBookingQueueItem(item)) {
        const bookingId = getQueuedBookingId(item)
        if (bookingId) {
          patchCachedBookingSyncState(bookingId, {
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          })
          console.log('[BOOKING SYNC] Synced booking', bookingId)
        }
      }
      if (isConvertQuotationQueueItem(item)) {
        const quotationId = getSyncItemQuotationId(item)
        const localBookingId = item._local_booking_id || null
        const serverBookingId = rpcResultData?.booking_id || rpcResultData?.id || null
        if (quotationId) {
          patchCachedQuotationSyncState(quotationId, {
            ...(serverBookingId ? { converted_booking_id: serverBookingId } : {}),
            _pending_sync: false,
            _pending_conversion: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          })
        }
        if (localBookingId) {
          replaceQueuedBookingReference(localBookingId, serverBookingId)
          if (serverBookingId) {
            for (let i = 0; i < pending.length; i += 1) {
              pending[i] = rewriteQueuedBookingReferenceItem(pending[i], localBookingId, serverBookingId)
            }
          }
          patchCachedBookingSyncState(localBookingId, {
            ...(serverBookingId ? { id: serverBookingId } : {}),
            _pending_sync: false,
            _sync_state: 'synced',
            _sync_error: null,
            _synced_at: new Date().toISOString()
          })
        }
      }
      if (queueItemNeedsInventoryRefresh(item)) shouldRefreshInventory = true
      if (queueItemNeedsBookingRefresh(item)) shouldRefreshBookings = true
      // P1-8: widen refresh to cover all domains touched by this operation
      if (item.type === 'rpc' && ['create_customer', 'update_customer'].includes(item.table)) shouldRefreshCustomers = true
      if (item.table === 'rooms' || (item.type === 'rpc' && item.table?.startsWith?.('update_room'))) shouldRefreshRooms = true
      if (item.type === 'rpc' && ['create_user', 'update_user_profile', 'set_user_pwa_access'].includes(item.table)) shouldRefreshUsers = true
      if (item.type === 'rpc' && ['create_quotation', 'update_quotation', 'convert_quotation', 'convert_quotation_to_booking'].includes(item.table)) shouldRefreshQuotations = true
      if (isPosCreateOrderQueueItem(item) || isPosVoidQueueItem(item)) shouldRefreshPosOrders = true
      if (item.type === 'rpc' && ['create_conference_booking', 'update_conference_booking', 'delete_conference_booking'].includes(item.table)) shouldRefreshConference = true
      if (item.type === 'rpc' && ['add_pool_day_use', 'delete_pool_day_use'].includes(item.table)) shouldRefreshPoolDayUse = true
      // Phase 1: persist committed state before removing from queue file.
      // Crash here → restart sees 'committed' → skips RPC without retrying.
      writeSyncQueue([{ ...item, _state: 'committed' }, ...pending])
      if (item._queue_id) completedQueueIds.add(item._queue_id)
      // Phase 2: remove item from queue
      successCount++
      writeSyncQueue(pending)
    }
  }
  const syncFinishedAt = new Date().toISOString()
  console.log(`✅ Sync complete: ${successCount} success, ${pending.length} remaining`)
  if (successCount > 0) {
    state.lastSuccessfulSyncAt = syncFinishedAt
    // P0-1: persist sync recency to disk so it survives restarts
    writeSyncMeta({
      lastSuccessfulSyncAt: syncFinishedAt,
      lastSyncFinishedAt: syncFinishedAt,
      lastSyncOutcome: deadLetter.length > 0 ? 'partial' : 'success',
      lastSyncError: deadLetter.length > 0 ? `${deadLetter.length} item(s) dead-lettered` : ''
    })
  } else if (deadLetter.length > 0) {
    writeSyncMeta({
      lastSyncFinishedAt: syncFinishedAt,
      lastSyncOutcome: 'failed',
      lastSyncError: `All ${deadLetter.length} item(s) dead-lettered with no successes`
    })
  } else {
    writeSyncMeta({ lastSyncFinishedAt: syncFinishedAt, lastSyncOutcome: 'empty' })
  }
  writeSyncQueue(pending)

  if (successCount > 0 && shouldRefreshInventory) {
    refreshCache('inventory-items', 'inventory-purchases').catch(() => {})
  }

  // P2-16: snapshot optimistic booking state before refresh so we can detect drift afterwards
  const preSyncBookingSnapshot = shouldRefreshBookings
    ? readCache('bookings')
      .filter((b) => !b._pending_sync)
      .reduce((map, b) => {
        map[b.id] = {
          total_amount: b.total_amount,
          amount_paid: b.amount_paid,
          customer_id: b.customer_id,
          room_id: b.room_id,
          status: b.status,
          payment_status: b.payment_status
        }
        return map
      }, {})
    : null

  // P1-8: widen canonical post-sync refresh
  const refreshTargets = []
  if (successCount > 0 && shouldRefreshBookings) refreshTargets.push('bookings')
  if (successCount > 0 && shouldRefreshCustomers) refreshTargets.push('customers')
  if (successCount > 0 && shouldRefreshRooms) refreshTargets.push('rooms')
  if (successCount > 0 && shouldRefreshUsers) refreshTargets.push('users')
  if (successCount > 0 && shouldRefreshQuotations) refreshTargets.push('quotations')
  if (successCount > 0 && shouldRefreshPosOrders) refreshTargets.push('pos-orders')
  if (successCount > 0 && shouldRefreshConference) refreshTargets.push('conference-bookings')
  if (successCount > 0 && shouldRefreshPoolDayUse) refreshTargets.push('pool-day-use')
  if (refreshTargets.length > 0) {
    await refreshCachesAfterSync(...refreshTargets)
  }

  // P2-16: compare post-refresh server values against pre-refresh optimistic state
  if (preSyncBookingSnapshot && successCount > 0) {
    try {
      const postSyncBookings = readCache('bookings')
      for (const b of postSyncBookings) {
        const pre = preSyncBookingSnapshot[b.id]
        if (!pre) continue
        const drifts = []
        if (!valuesEqualForDrift(pre.total_amount, b.total_amount)) drifts.push(`total_amount: local ${pre.total_amount} → server ${b.total_amount}`)
        if (!valuesEqualForDrift(pre.amount_paid, b.amount_paid)) drifts.push(`amount_paid: local ${pre.amount_paid} → server ${b.amount_paid}`)
        if (hasDriftBaselineValue(pre.customer_id) && !valuesEqualForDrift(pre.customer_id, b.customer_id)) drifts.push(`customer_id: local ${pre.customer_id} → server ${b.customer_id}`)
        if (hasDriftBaselineValue(pre.room_id) && !valuesEqualForDrift(pre.room_id, b.room_id)) drifts.push(`room_id: local ${pre.room_id} → server ${b.room_id}`)
        if (!valuesEqualForDrift(pre.status, b.status)) drifts.push(`status: local ${pre.status} → server ${b.status}`)
        if (!valuesEqualForDrift(pre.payment_status, b.payment_status)) drifts.push(`payment_status: local ${pre.payment_status} → server ${b.payment_status}`)
        if (drifts.length > 0) {
          appendHealthFault({
            type: 'booking_drift',
            scope: `booking:${b.id}`,
            severity: 'warn',
            message: `Post-sync drift on booking ${b.id}: ${drifts.join('; ')}`,
            context: { booking_id: b.id, drifts, invoice_number: b.invoice_number || null }
          })
          console.warn('[SYNC DRIFT]', b.id, drifts)
        }
      }
    } catch (driftError) {
      console.error('[Sync] Drift check failed:', driftError)
    }
  }

  if (deadLetter.length > 0) {
    const deadPath = path.join(state.cacheDir, 'sync-failed.json')
    const deadTmp = deadPath + '.tmp'
    let existing = []
    try { existing = JSON.parse(fs.readFileSync(deadPath, 'utf-8')) } catch { /* empty */ }
    try {
      fs.writeFileSync(deadTmp, JSON.stringify([...existing, ...deadLetter], null, 2), 'utf-8')
      fs.renameSync(deadTmp, deadPath)
    } catch (e) {
      console.error('[Sync] Dead-letter write failed:', e)
      try { fs.unlinkSync(deadTmp) } catch { /* ignore */ }
    }
    for (const item of deadLetter) {
      console.error('[SYNC DEAD LETTER]', item)
    }
  }

  console.log(`[Sync] Done — ${successCount} synced, ${pending.length} retrying, ${deadLetter.length} dead-lettered`)

  broadcastSyncStatus()
}

function createBackup() {
  try {
    if (!state.lodgeId) return
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups')
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupPath = path.join(backupDir, `backup-${ts}.json`)

    const users = readCache('users').map(({ password_hash, ...u }) => u)

    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      lodge_id: state.lodgeId,
      tables: {
        rooms: readCache('rooms'),
        customers: readCache('customers'),
        bookings: readCache('bookings'),
        users,
        settings: readCache('settings')
      }
    }

    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8')

    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.json'))
      .sort()
      .reverse()
    for (const old of files.slice(10)) {
      try { fs.unlinkSync(path.join(backupDir, old)) } catch { /* ignore */ }
    }

    console.log(`Auto-backup saved: ${backupPath}`)
    return backupPath
  } catch (e) {
    console.error('Auto-backup failed:', e)
    return null
  }
}

function readAuxiliaryLog(filename) {
  try {
    if (!state.cacheDir) return []
    const fullPath = path.join(state.cacheDir, filename)
    if (!fs.existsSync(fullPath)) return []
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAuxiliaryLog(filename, rows) {
  try {
    if (!state.cacheDir) return
    fs.writeFileSync(path.join(state.cacheDir, filename), JSON.stringify(rows, null, 2), 'utf-8')
  } catch (error) {
    console.error(`Auxiliary log write failed (${filename}):`, error)
  }
}

// ─── EXPORTED FUNCTIONS ───────────────────────────────────────────────────────

function buildSupabaseClient(key, sessionToken = null) {
  const token = typeof sessionToken === 'string' && sessionToken.trim() ? sessionToken.trim() : null
  authTrace('buildSupabaseClient', {
    clientKind: key === SUPABASE_ANON_KEY ? 'anon' : 'non-anon',
    hasExplicitSessionToken: !!token,
    explicitSessionTokenLength: token ? token.length : null,
    currentLodgeId: state.lodgeId
  })
  return createClient(SUPABASE_URL, key, {
    global: {
      headers: token ? { 'x-boroko-session': token } : {}
    }
  })
}

function ensureDir(dirPath) {
  if (!dirPath) return
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

function appendHealthFault(fault = {}) {
  if (!state.cacheDir) return
  const filePath = path.join(state.cacheDir, HEALTH_FAULTS_FILE)
  const tmpPath = filePath + '.tmp'
  try {
    let existing = []
    try { existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) } catch { /* start fresh */ }
    if (!Array.isArray(existing)) existing = []
    const entry = {
      id: randomUUID(),
      type: fault.type || 'unknown',
      scope: fault.scope || 'unknown',
      severity: fault.severity || 'warn',
      message: fault.message || 'An integrity fault was detected.',
      at: fault.at || new Date().toISOString(),
      ...(fault.context && typeof fault.context === 'object' ? { context: fault.context } : {})
    }
    // Deduplicate: don't append a fault with the same type+scope within 10 minutes
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000
    const isDuplicate = existing.some(
      (e) => e.type === entry.type && e.scope === entry.scope && Date.parse(e.at) > tenMinutesAgo
    )
    if (isDuplicate) return
    const next = [entry, ...existing].slice(0, 50)
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
    console.error('[Health Fault]', entry)
  } catch (e) {
    console.error('[Health Fault] Write failed:', e)
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

function appendAuxiliaryLog(filename, row, limit = 200) {
  const current = readAuxiliaryLog(filename)
  current.unshift(row)
  writeAuxiliaryLog(filename, current.slice(0, limit))
}

async function initDatabase() {
  state.cacheRootDir = path.join(app.getPath('userData'), 'boroko-cache')
  state.profilesCacheDir = path.join(state.cacheRootDir, 'profiles')
  initializeProfileRuntime()

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'VITE_SUPABASE_URL or VITE_SUPABASE_KEY is missing.\n' +
      'Create a root .env file with both variables, then re-run the app.\n' +
      'See .env.example for the required format.'
    )
  }
  state.supabase = buildSupabaseClient(SUPABASE_ANON_KEY)

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (serviceKey) {
    state.adminDb = buildSupabaseClient(serviceKey)
    console.log('[Auth] SUPABASE_SERVICE_ROLE_KEY found — Command Central admin mode enabled')
  } else {
    state.adminDb = null
    console.log('[Auth] No SUPABASE_SERVICE_ROLE_KEY — running in lodge-only mode')
  }

  // P0-1: restore persisted sync recency so System Health has real data immediately
  if (state.cacheDir) {
    const meta = readSyncMeta()
    if (meta.lastSuccessfulSyncAt && !state.lastSuccessfulSyncAt) {
      state.lastSuccessfulSyncAt = meta.lastSuccessfulSyncAt
    }
  }

  // P0-5: replayAuthReady stays false until a real user logs in.
  // Startup sync is intentionally skipped — we must not replay queued financial
  // operations before the correct Supabase client is authenticated.
  let online = false
  for (let attempt = 0; attempt < 3; attempt++) {
    online = await checkOnline()
    if (online) break
    if (attempt < 2) await new Promise((r) => setTimeout(r, 2000))
  }
  if (online && state.lodgeId) {
    // Only refresh caches at startup (safe read-only — does not replay writes)
    await refreshAllCaches()
    console.log('Connected to Supabase ✓ (replay deferred until user authenticates)')
  } else {
    console.log('Running in offline mode — using cached data')
  }

  if (!state.backupIntervalStarted) {
    state.backupIntervalStarted = true

    createBackup()
    setInterval(() => createBackup(), 60 * 60 * 1000)

    // Reconnect detection: fires sync on network return
    setInterval(async () => {
      if (state.connectivityCheckInProgress) return
      state.connectivityCheckInProgress = true
      try {
        const wasOffline = !state.isOnline
        const nowOnline = await checkOnline()
        const hasPendingSync = readSyncQueue().length > 0 || readFailedSyncQueue().some((item) => item?.manualRetryOnly !== true)
        if (nowOnline && state.lodgeId && state.replayAuthReady && (wasOffline || hasPendingSync)) {
          console.log('Back online — syncing changes...')
          await requeueEligibleFailedSyncItems()
          await processSyncQueue()
          if (wasOffline) await refreshAllCaches()
        }
      } catch (error) {
        const message = getErrorMessage(error)
        console.error('[Sync] Reconnect sync timer failed:', error)
        appendHealthFault({
          type: 'sync_timer_error',
          scope: 'reconnect',
          severity: 'error',
          message,
          at: new Date().toISOString()
        })
        writeSyncMeta({
          lastSyncFinishedAt: new Date().toISOString(),
          lastSyncOutcome: 'timer_error',
          lastSyncError: message
        })
      } finally {
        state.connectivityCheckInProgress = false
      }
    }, CONNECTIVITY_CHECK_INTERVAL_MS)

    // P0-6: Periodic sync — ensures retryable dead letters are replayed even when
    // the app never transitions offline→online (i.e., stays continuously online).
    setInterval(async () => {
      try {
        if (!state.isOnline || !state.lodgeId || !state.replayAuthReady) return
        await requeueEligibleFailedSyncItems()
        if (readSyncQueue().length > 0) {
          await processSyncQueue()
        }
      } catch (error) {
        const message = getErrorMessage(error)
        console.error('[Sync] Periodic sync timer failed:', error)
        appendHealthFault({
          type: 'sync_timer_error',
          scope: 'periodic',
          severity: 'error',
          message,
          at: new Date().toISOString()
        })
        writeSyncMeta({
          lastSyncFinishedAt: new Date().toISOString(),
          lastSyncOutcome: 'timer_error',
          lastSyncError: message
        })
      }
    }, PERIODIC_SYNC_INTERVAL_MS)
  }
}

export {
  buildSupabaseClient,
  ensureDir,
  readJsonFile,
  writeJsonFile,
  appendHealthFault,
  appendAuxiliaryLog,
  initDatabase
}
