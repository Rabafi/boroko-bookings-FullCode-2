import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { FINANCIAL_SYNC_TABLES, isFinancialSyncItem } from '../shared/syncQueue.js'
import { state } from '../state.js'
import { buildSupabaseClient, appendHealthFault } from './infrastructure.js'

// ─── SUPABASE CREDENTIALS ─────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY
const AUTH_REDIRECT_URL = (
  process.env.BOROKO_AUTH_REDIRECT_URL ||
  import.meta.env.VITE_AUTH_REDIRECT_URL ||
  ''
).trim()
const AUTH_CONTRACT_VERSION = 2
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SESSION_NONCE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000 // 60 days
const CONNECTIVITY_CHECK_INTERVAL_MS = 3000
const CONNECTIVITY_PROBE_TIMEOUT_MS = 4000
const CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD = 3
const CACHE_FRESHNESS_FILE = 'cache-freshness.json'
const HEALTH_FAULTS_FILE = 'health-faults.json'
const SYNC_META_FILE = 'sync-meta.json'

// QUEUED_DEPENDENCY_CACHE_MAP — used by isQueuedDependencyResolved
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

// ─── CORE AUTH HELPERS ────────────────────────────────────────────────────────

function buildSupabaseAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  })
}

function getAuthRedirectUrl() {
  return AUTH_REDIRECT_URL || undefined
}

export function applyBackendSession(session) {
  authTrace('applyBackendSession', {
    hasIncomingToken: !!session?.token,
    incomingTokenLength: session?.token ? session.token.length : null,
    session_type: session?.session_type || null,
    expires_at: session?.expires_at || null,
    lodgeId: state.lodgeId
  })
  state.backendSession = session?.token
    ? {
      token: session.token,
      expires_at: session.expires_at || null,
      session_type: session.session_type || 'desktop'
    }
    : null
  state.supabase = buildSupabaseClient(SUPABASE_ANON_KEY, state.backendSession?.token || null)
}

export function clearBackendSession() {
  authTrace('clearBackendSession', {
    hadBackendSession: !!state.backendSession?.token,
    backendSessionType: state.backendSession?.session_type || null,
    lodgeId: state.lodgeId
  })
  applyBackendSession(null)
}

function getBackendSession() {
  return state.backendSession ? { ...state.backendSession } : null
}

// ─── NORMALIZATION HELPERS ────────────────────────────────────────────────────

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function normalizeLodgeId(id) {
  return typeof id === 'string' ? id.trim().toLowerCase() : null
}

function isUuid(value) {
  return UUID_PATTERN.test(normalizeLodgeId(value) || '')
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

function sanitizeUserForRenderer(user) {
  if (!user || typeof user !== 'object') return user
  const {
    password_hash: _passwordHash,
    pin_hash: _pinHash,
    pwa_password_hash: _pwaPasswordHash,
    ...safeUser
  } = user
  return safeUser
}

function toSafeUser(user) {
  const {
    password_hash: _ph,
    session_token: _st,
    session_expires_at: _se,
    ...safeUser
  } = user
  return safeUser
}

// ─── AUTH TRACE & ERROR HELPERS ───────────────────────────────────────────────

function authTrace(label, payload = {}) {
  if (process.env.BOROKO_AUTH_TRACE !== '1') return
  console.log(`[AUTH TRACE] ${label}`, payload)
}

function getAuthClientState(kind = 'unknown', sessionToken = null, email = null) {
  const explicitToken = typeof sessionToken === 'string' && sessionToken.trim() ? sessionToken.trim() : null
  return {
    clientKind: kind,
    hasExplicitSessionToken: !!explicitToken,
    explicitSessionTokenLength: explicitToken ? explicitToken.length : null,
    hasBackendSession: !!state.backendSession?.token,
    backendSessionType: state.backendSession?.session_type || null,
    backendSessionTokenLength: state.backendSession?.token ? state.backendSession.token.length : null,
    lodgeId: state.lodgeId,
    email: email || null
  }
}

function isBackendAuthSchemaError(message = '') {
  return /authenticate_user|authenticate_manager|get_manager_pwa_profile|validate_app_session|set_user_pwa_access|get_lodge_auth_context|schema cache|returned record type|structure of query does not match|contract_version|column .*deleted|column .*lodge_id|column .*password_hash|column .*pwa_|permission denied/i.test(message)
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

// ─── CACHE HELPERS ────────────────────────────────────────────────────────────

function getCachePath(name) {
  return path.join(state.cacheDir, `${name}.json`)
}

function readCache(name) {
  const filePath = getCachePath(name)
  const tmpPath = filePath + '.tmp'
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'))
      fs.renameSync(tmpPath, filePath)
      console.warn(`[Cache] Crash-recovery: promoted '${name}.tmp' to main file`)
      return tmpData
    } catch {
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

function readAuthCache() {
  try { return JSON.parse(fs.readFileSync(path.join(state.cacheDir, 'auth-cache.json'), 'utf-8')) } catch { return [] }
}
function writeAuthCache(entries) {
  try { fs.writeFileSync(path.join(state.cacheDir, 'auth-cache.json'), JSON.stringify(entries, null, 2), 'utf-8') } catch { }
}
function removeAuthEntry(email) {
  const emailLower = normalizeEmail(email)
  const filtered = readAuthCache().filter(e => !(e.email === emailLower && e.lodge_id === state.lodgeId))
  writeAuthCache(filtered)
}
function upsertAuthEntry(email, passwordHash) {
  const emailLower = normalizeEmail(email)
  const entries = readAuthCache().filter(e => !(e.email === emailLower && e.lodge_id === state.lodgeId))
  entries.push({ email: emailLower, lodge_id: state.lodgeId, password_hash: passwordHash, deprecated: true })
  writeAuthCache(entries)
}

function upsertCachedUser(user) {
  if (!user?.email) return
  const normalizedUser = normalizeSessionUser(normalizeUserRecord(user))
  if (!normalizedUser?.id || !normalizedUser.email) return
  const { password_hash: _ph, ...safeUser } = normalizedUser
  const cached = readCache('users')
  const existing = cached
    .map(normalizeUserRecord)
    .filter(Boolean)
  const previous = existing.find((entry) => entry.id === safeUser.id || entry.email === safeUser.email)
  const mergedUser = mergeSessionUserScope(previous, { ...safeUser, lodge_id: safeUser.lodge_id || state.lodgeId })
  const next = existing.filter((entry) => entry.id !== safeUser.id && entry.email !== safeUser.email)
  next.push(mergedUser)
  writeCache('users', next)
}

async function cacheSuccessfulLogin(user, emailLower, password = null) {
  console.log('[AUTH] cache write start:', { email: emailLower, userId: user?.id, lodge_id: state.lodgeId })
  if (typeof password === 'string' && password) {
    const localHash = await bcrypt.hash(password, 10)
    upsertAuthEntry(emailLower, localHash)
  }
  upsertCachedUser(user)
  const authEntries = readAuthCache().filter((entry) => entry.email === emailLower && entry.lodge_id === state.lodgeId)
  const cachedUser = getCachedUser(emailLower)
  console.log('[AUTH] cache write result:', {
    email: emailLower,
    auth_entry_written: authEntries.length > 0,
    cached_user_written: !!cachedUser,
    cached_user_id: cachedUser?.id || null
  })
}

function getCachedUser(emailLower) {
  const normalizedEmail = normalizeEmail(emailLower)
  return readCache('users')
    .map(normalizeUserRecord)
    .find((u) => u?.email === normalizedEmail && (u.lodge_id ? u.lodge_id === state.lodgeId : true))
}

function logAuthFailure(reason, details = {}) {
  console.warn('[AUTH] login failed:', {
    reason,
    lodge_id: state.lodgeId,
    email: details.email,
    online: state.isOnline,
    ...details
  })
}

function tryOfflineLogin(emailLower) {
  logAuthFailure('offline_password_login_disabled', { email: emailLower })
  return {
    user: null,
    code: 'offline_unlock_required',
    error:
      'Offline password sign-in is no longer supported. Open the app with the saved trusted session, or connect to the internet and sign in again.'
  }
}

// ─── SESSION NONCE HELPERS ────────────────────────────────────────────────────

function getSessionNoncePath() {
  return path.join(state.cacheDir, 'session-nonce.json')
}

function getTrustedSessionsPath() {
  return path.join(state.cacheDir, 'trusted-sessions.json')
}

function readSessionNonce() {
  try { return JSON.parse(fs.readFileSync(getSessionNoncePath(), 'utf-8')) }
  catch { return null }
}

function readTrustedSessions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getTrustedSessionsPath(), 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeTrustedSessions(sessions) {
  try { fs.writeFileSync(getTrustedSessionsPath(), JSON.stringify(sessions, null, 2), 'utf-8') } catch { }
}

function pruneExpiredTrustedSessions(sessions = readTrustedSessions()) {
  const now = Date.now()
  const active = sessions.filter((session) => {
    const createdAt = new Date(session?.createdAt || 0).getTime()
    return Number.isFinite(createdAt) && now - createdAt <= SESSION_NONCE_MAX_AGE_MS
  })
  if (active.length !== sessions.length) writeTrustedSessions(active)
  return active
}

function normalizeTrustedSessionRecord(record) {
  if (!record?.nonce) return null
  return {
    ...record,
    userId: record.userId || record.id || null,
    id: record.id || record.userId || null,
    email: normalizeEmail(record.email),
    lodge_id: normalizeLodgeId(record.lodge_id || state.lodgeId),
    createdAt: record.createdAt || new Date().toISOString()
  }
}

function buildTrustedSessionRecord(user, nonce, password = '') {
  const session = getBackendSession()
  const normalizedUser = normalizeSessionUser(user)
  const record = normalizedUser && typeof normalizedUser === 'object'
    ? {
      id: normalizedUser.id || null,
      email: normalizedUser.email || null,
      name: normalizedUser.name || null,
      role: normalizedUser.role || null,
      lodge_id: normalizedUser.lodge_id || null,
      ...(Object.prototype.hasOwnProperty.call(normalizedUser, 'allowed_outlet_ids')
        ? { allowed_outlet_ids: normalizedUser.allowed_outlet_ids }
        : {}),
      isMasterAdmin: Boolean(normalizedUser.isMasterAdmin),
      session_token: session?.token || null,
      session_expires_at: session?.expires_at || null,
      session_type: session?.session_type || null
    }
    : {
      id: user || null,
      email: null,
      name: null,
      role: null,
      lodge_id: null,
      isMasterAdmin: false,
      session_token: session?.token || null,
      session_expires_at: session?.expires_at || null,
      session_type: session?.session_type || null
    }

  return {
    userId: record.id,
    ...record,
    nonce,
    createdAt: new Date().toISOString(),
    offline_password_hash: password ? bcrypt.hashSync(password, 10) : null
  }
}

function writeSessionNonce(user, nonce, password = '') {
  const record = buildTrustedSessionRecord(user, nonce, password)
  fs.writeFileSync(getSessionNoncePath(), JSON.stringify(record, null, 2), 'utf-8')

  const sessions = pruneExpiredTrustedSessions()
  const normalizedRecord = normalizeTrustedSessionRecord(record)
  if (!normalizedRecord?.id && !normalizedRecord?.email) return
  const existing = sessions.find((session) => {
    const normalized = normalizeTrustedSessionRecord(session)
    return normalized && (
      (normalizedRecord.id && normalized.id === normalizedRecord.id) ||
      (normalizedRecord.email && normalized.email === normalizedRecord.email)
    )
  })
  const nextRecord = {
    ...(existing || {}),
    ...record,
    offline_password_hash: record.offline_password_hash || existing?.offline_password_hash || null
  }
  const next = sessions.filter((session) => {
    const normalized = normalizeTrustedSessionRecord(session)
    return !(normalized && (
      (normalizedRecord.id && normalized.id === normalizedRecord.id) ||
      (normalizedRecord.email && normalized.email === normalizedRecord.email)
    ))
  })
  next.push(nextRecord)
  writeTrustedSessions(next)
}

function clearSessionNonce() {
  try { fs.unlinkSync(getSessionNoncePath()) } catch { /* file may not exist */ }
}

// ─── CONNECTIVITY ─────────────────────────────────────────────────────────────

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

function readSyncMeta() {
  if (!state.cacheDir) return {}
  try {
    const raw = fs.readFileSync(path.join(state.cacheDir, SYNC_META_FILE), 'utf-8')
    return JSON.parse(raw) || {}
  } catch {
    return {}
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

function readSyncQueue() {
  if (!state.cacheDir) return []
  const filePath = path.join(state.cacheDir, 'sync-queue.json')
  const tmpPath = filePath + '.tmp'
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'))
      fs.renameSync(tmpPath, filePath)
      console.warn('[Sync Queue] Crash-recovery: promoted sync-queue.tmp to main file')
      return normalizeQueueRows(tmpData, 'sync-queue')
    } catch (error) {
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
  const resolvedLastSync = state.lastSuccessfulSyncAt || syncMeta.lastSuccessfulSyncAt || null
  return {
    pending: queue.length,
    failed: failed.length,
    currentQueueLength: queue.length,
    currentDeadLetterWrites: failed.length,
    isOnline: state.isOnline,
    syncInProgress: state.syncInProgress,
    replayAuthReady: state.replayAuthReady,
    failedBookingIds,
    financialPendingBookingIds,
    financialFailedBookingIds,
    financialPendingCount,
    financialFailedCount,
    groupedCounts,
    lastSuccessfulSyncAt: resolvedLastSync,
    syncMeta: {
      lastSyncStartedAt: syncMeta.lastSyncStartedAt || null,
      lastSyncFinishedAt: syncMeta.lastSyncFinishedAt || null,
      lastSyncOutcome: syncMeta.lastSyncOutcome || null,
      lastSyncError: syncMeta.lastSyncError || '',
      replayAuthNotReadyAt: syncMeta.replayAuthNotReadyAt || null
    },
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

// ─── SYNC QUEUE OPERATION ─────────────────────────────────────────────────────

function createQueueOperationId(prefix = 'op') {
  return `${prefix}-${randomUUID()}`
}

function ensureQueuedItem(item = {}, fallbackType = 'op') {
  return {
    ...item,
    _queue_id: item._queue_id || createQueueOperationId(fallbackType)
  }
}

function queueOperation(type, table, data, id = null, meta = {}) {
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'))
  const derivedMeta = {
    ...(type === 'rpc' && table === 'create_quotation' && data?.payload?.id
      ? { _queue_id: `quotation-${data.payload.id}` }
      : {}),
    ...meta
  }
  const queuedItem = ensureQueuedItem({
    type,
    table,
    data,
    id,
    timestamp: new Date().toISOString(),
    ...derivedMeta
  }, type)

  if (type === 'rpc' && data?.p_idempotency_key) {
    const existingItem = queue.find(
      item => item.type === 'rpc' &&
        item.table === table &&
        item.data?.p_idempotency_key === data.p_idempotency_key
    )
    if (existingItem?._queue_id) {
      console.warn('[SYNC QUEUE] Duplicate idempotent RPC detected — reusing existing queue item', {
        operation: table,
        _queue_id: existingItem._queue_id
      })
      return existingItem._queue_id
    }
  }

  const hasSameQueueId = queue.some((item) => item._queue_id === queuedItem._queue_id)
  if (hasSameQueueId) {
    console.warn('[SYNC QUEUE] Duplicate _queue_id detected — skipping push', { _queue_id: queuedItem._queue_id, operation: queuedItem.table })
    return queuedItem._queue_id
  }

  queue.push(queuedItem)
  writeSyncQueue(queue)
  return queuedItem._queue_id
}

// ─── USER DATA ACCESS ─────────────────────────────────────────────────────────

async function getAllUsers() {
  if (state.isOnline) {
    const { data } = await state.supabase
      .from('users')
      .select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids, pin_hash')
      .eq('lodge_id', state.lodgeId)
      .order('name')
    const normalized = (data || []).map(normalizeUserRecord).filter(Boolean)
    if (data) writeCache('users', normalized)
    return normalized.map(sanitizeUserForRenderer)
  }
  return readCache('users').map(normalizeUserRecord).filter(Boolean).map(sanitizeUserForRenderer)
}

// ─── CACHE REFRESH ────────────────────────────────────────────────────────────

function isSyncRefreshStaleFor(name) {
  return state.syncRefreshState.stale && state.syncRefreshState.names.includes(name)
}

function uniqueSyncNames(names = []) {
  return [...new Set((names || []).filter(Boolean))]
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
          setCurrentUser(mergeSessionUserScope(state.currentUser, refreshedUser))
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

// Stubs for functions that refreshCacheStrict may call for non-user caches
function mergeRemoteBookingsWithLocalState(data) { return data }
function applyQueuedPosInventoryReservations(data) { return data }
function mergeRemotePosOrdersWithLocalState(data) { return data }

async function refreshCache(...names) {
  try {
    await refreshCacheStrict(...names)
    clearSyncRefreshStale(uniqueSyncNames(names).filter((name) => isSyncRefreshStaleFor(name)))
  } catch (e) {
    console.error('Cache refresh failed:', e)
  }
}

// ─── ONLINE AUTHENTICATION ────────────────────────────────────────────────────

async function fetchAuthenticateUserContract(emailLower) {
  try {
    const authClient = buildSupabaseClient(SUPABASE_ANON_KEY)
    authTrace('auth client state', getAuthClientState('anon-health-probe', null, emailLower))
    const rpcArgs = {
      p_email: emailLower,
      p_lodge_id: state.lodgeId,
      p_password: null,
      p_session_type: 'desktop'
    }
    authTrace('rpc call start', {
      functionName: 'authenticate_user',
      ...getAuthClientState('anon-health-probe', null, emailLower),
      args: rpcArgs
    })
    const rpcResult = await authClient.rpc('authenticate_user', rpcArgs)
    if (rpcResult.error) {
      authTrace('rpc call error', {
        functionName: 'authenticate_user',
        ...getAuthClientState('anon-health-probe', null, emailLower),
        args: rpcArgs,
        error: rpcResult.error
      })
    }
    const rpcRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data
    return { rpcResult, rpcRow, contract: normalizeAuthContractRow(rpcRow) }
  } catch (error) {
    authTrace('rpc call error', {
      functionName: 'authenticate_user',
      ...getAuthClientState('anon-health-probe', null, emailLower),
      args: {
        p_email: emailLower,
        p_lodge_id: state.lodgeId,
        p_password: null,
        p_session_type: 'desktop'
      },
      error: {
        message: error.message || 'authenticate_user failed.',
        code: error.code || null,
        details: error.details || null,
        hint: error.hint || null,
        stack: error.stack || null
      }
    })
    return {
      rpcResult: { error: { message: error.message || 'authenticate_user failed.' } },
      rpcRow: null,
      contract: { ok: false, reason: error.message || 'authenticate_user failed.' }
    }
  }
}

function normalizeAuthContractRow(rpcRow) {
  if (!rpcRow || typeof rpcRow !== 'object' || Array.isArray(rpcRow)) {
    return { ok: false, reason: 'authenticate_user did not return a record.' }
  }

  const normalized = {
    contract_version: Number(rpcRow.contract_version),
    found: rpcRow.found,
    authenticated: rpcRow.authenticated === true,
    id: rpcRow.id || null,
    name: typeof rpcRow.name === 'string' ? rpcRow.name : '',
    email: normalizeEmail(rpcRow.email),
    role: typeof rpcRow.role === 'string' ? rpcRow.role : null,
    lodge_id: normalizeLodgeId(rpcRow.lodge_id),
    created_at: rpcRow.created_at || null,
    session_token: typeof rpcRow.session_token === 'string' && rpcRow.session_token ? rpcRow.session_token : null,
    session_expires_at: rpcRow.session_expires_at || null
  }

  if (normalized.contract_version !== AUTH_CONTRACT_VERSION) {
    return { ok: false, reason: `Expected contract_version ${AUTH_CONTRACT_VERSION}.` }
  }
  if (typeof normalized.found !== 'boolean') {
    return { ok: false, reason: 'authenticate_user must return a boolean found flag.' }
  }
  if (typeof normalized.authenticated !== 'boolean') {
    return { ok: false, reason: 'authenticate_user must return an authenticated flag.' }
  }
  if (!isUuid(normalized.lodge_id)) {
    return { ok: false, reason: 'authenticate_user must return a UUID lodge_id.' }
  }
  if (!normalized.email) {
    return { ok: false, reason: 'authenticate_user must return a normalized email.' }
  }
  if (normalized.found) {
    if (!isUuid(normalized.id)) {
      return { ok: false, reason: 'authenticate_user must return a UUID id when found = true.' }
    }
    if (!normalized.role) {
      return { ok: false, reason: 'authenticate_user must return role when found = true.' }
    }
    if (normalized.authenticated && !normalized.session_token) {
      return { ok: false, reason: 'authenticate_user must return a session_token when authenticated = true.' }
    }
  }

  return { ok: true, row: normalized }
}

async function authenticateWithSupabaseAuth(emailLower, password) {
  if (!password) {
    return { user: null, code: 'wrong_password', error: 'Enter your password to sign in.' }
  }

  try {
    const authClient = buildSupabaseAuthClient()
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: emailLower,
      password
    })

    if (authError) {
      const message = authError.message || 'Supabase Auth could not verify this sign-in.'
      if (/invalid login credentials|invalid credentials/i.test(message)) {
        return {
          user: null,
          code: 'supabase_auth_not_migrated',
          error: 'This account is not available in Supabase Auth yet.'
        }
      }
      return {
        user: null,
        code: 'auth_failed_real',
        error: message,
        details: { source: 'supabase_auth' }
      }
    }

    const accessToken = authData?.session?.access_token
    if (!accessToken) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: 'Supabase Auth did not return an access token.',
        details: { source: 'supabase_auth' }
      }
    }

    const { data, error } = await authClient.rpc('authenticate_user_from_supabase', {
      p_lodge_id: state.lodgeId,
      p_session_type: 'desktop'
    })
    if (error) {
      if (/could not find the function|schema cache|authenticate_user_from_supabase/i.test(error.message || '')) {
        return {
          user: null,
          code: 'supabase_auth_unavailable',
          error: error.message
        }
      }
      return {
        user: null,
        code: 'auth_failed_real',
        error: error.message || 'Could not link this Supabase Auth user to the current lodge.',
        details: { source: 'authenticate_user_from_supabase' }
      }
    }

    const row = Array.isArray(data) ? data[0] : data
    const contract = normalizeAuthContractRow(row)
    if (!contract.ok) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: contract.reason || 'Invalid Supabase Auth contract response.',
        details: { source: 'authenticate_user_from_supabase', payload: row || null }
      }
    }

    const normalized = contract.row
    if (!normalized.found) {
      return {
        user: null,
        code: 'account_not_found',
        error: 'Supabase Auth verified the password, but this account is not linked to the selected lodge yet.'
      }
    }
    if (!normalized.authenticated || !normalized.session_token) {
      return {
        user: null,
        code: 'auth_failed_real',
        error: 'The server did not issue a valid Boroko session for this Supabase Auth user.',
        details: { source: 'authenticate_user_from_supabase' }
      }
    }

    return {
      user: toSafeUser(normalized),
      source: 'supabase_auth',
      session_token: normalized.session_token,
      session_expires_at: normalized.session_expires_at
    }
  } catch (error) {
    return {
      user: null,
      code: 'supabase_auth_unavailable',
      error: error?.message || 'Supabase Auth could not be reached.'
    }
  }
}

async function authenticateOnline(emailLower, password) {
  const supabaseAuth = await authenticateWithSupabaseAuth(emailLower, password)
  if (supabaseAuth.user || supabaseAuth.code !== 'supabase_auth_unavailable') {
    return supabaseAuth
  }

  let rpcResult
  let rpcRow
  let contract
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Authentication timed out — server did not respond in time.')), 15000)
    )
    const authResult = await Promise.race([
      (async () => {
        try {
          const authClient = buildSupabaseClient(SUPABASE_ANON_KEY)
          const rpcArgs = {
            p_email: emailLower,
            p_lodge_id: state.lodgeId,
            p_password: password,
            p_session_type: 'desktop'
          }
          authTrace('auth client state', getAuthClientState('anon-login', null, emailLower))
          authTrace('rpc call start', {
            functionName: 'authenticate_user',
            ...getAuthClientState('anon-login', null, emailLower),
            args: {
              ...rpcArgs,
              p_password: typeof password === 'string' ? `[length:${password.length}]` : null
            }
          })
          const rpcResult = await authClient.rpc('authenticate_user', rpcArgs)
          if (rpcResult.error) {
            authTrace('rpc call error', {
              functionName: 'authenticate_user',
              ...getAuthClientState('anon-login', null, emailLower),
              args: {
                ...rpcArgs,
                p_password: typeof password === 'string' ? `[length:${password.length}]` : null
              },
              error: rpcResult.error
            })
          }
          const rpcRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data
          return { rpcResult, rpcRow, contract: normalizeAuthContractRow(rpcRow) }
        } catch (error) {
          authTrace('rpc call error', {
            functionName: 'authenticate_user',
            ...getAuthClientState('anon-login', null, emailLower),
            args: {
              p_email: emailLower,
              p_lodge_id: state.lodgeId,
              p_password: typeof password === 'string' ? `[length:${password.length}]` : null,
              p_session_type: 'desktop'
            },
            error: {
              message: error.message || 'authenticate_user failed.',
              code: error.code || null,
              details: error.details || null,
              hint: error.hint || null,
              stack: error.stack || null
            }
          })
          return {
            rpcResult: { error: { message: error.message || 'authenticate_user failed.' } },
            rpcRow: null,
            contract: { ok: false, reason: error.message || 'authenticate_user failed.' }
          }
        }
      })(),
      timeoutPromise
    ])
    rpcResult = authResult.rpcResult
    rpcRow = authResult.rpcRow
    contract = authResult.contract
  } catch (e) {
    return { user: null, code: 'server_unreachable', error: e.message }
  }

  console.log('[AUTH] online auth result:', {
    email: emailLower,
    lodge_id: state.lodgeId,
    rpc_error: rpcResult.error?.message || null,
    contract_ok: contract.ok,
    contract_reason: contract.reason || null,
    found: contract.row?.found ?? null,
    user_id: contract.row?.id || null
  })
  authTrace('db.loginUser online auth result', {
    email: emailLower,
    lodge_id: state.lodgeId,
    rpc_error: rpcResult.error?.message || null,
    contract_ok: contract.ok,
    contract_reason: contract.reason || null,
    found: contract.row?.found ?? null,
    authenticated: contract.row?.authenticated ?? null,
    user_id: contract.row?.id || null
  })

  if (rpcResult.error) {
    const errorMessage = rpcResult.error.message || 'authenticate_user failed.'
    console.error('[AUTH] online verification error:', {
      email: emailLower,
      lodge_id: state.lodgeId,
      rpcError: errorMessage
    })
    if (isBackendAuthSchemaError(errorMessage)) {
      console.warn('[AUTH TRACE] schema error wrapper hit', {
        source: 'authenticate_user_rpc_error',
        email: emailLower,
        rpc_error: errorMessage
      })
    }
    return {
      user: null,
      code: 'auth_failed_real',
      error: errorMessage,
      details: {
        source: 'authenticate_user',
        rpc_error: errorMessage
      }
    }
  }

  if (!contract.ok) {
    console.error('[AUTH] online auth invalid RPC response shape:', {
      email: emailLower,
      lodge_id: state.lodgeId,
      reason: contract.reason,
      payload: rpcRow || null
    })
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'authenticate_user_contract_invalid',
      email: emailLower,
      reason: contract.reason,
      payload: rpcRow || null
    })
    return {
      user: null,
      code: 'auth_failed_real',
      error: contract.reason || 'Invalid authenticate_user contract response.',
      details: {
        source: 'authenticate_user_contract',
        reason: contract.reason,
        payload: rpcRow || null
      }
    }
  }

  const row = contract.row
  if (normalizeLodgeId(row.lodge_id) !== normalizeLodgeId(state.lodgeId)) {
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'authenticate_user_lodge_mismatch',
      email: emailLower,
      returned_lodge_id: row.lodge_id,
      expected_lodge_id: state.lodgeId
    })
    return {
      user: null,
      code: 'auth_failed_real',
      error: 'authenticate_user returned a lodge_id that does not match this device.',
      details: {
        source: 'authenticate_user_lodge_mismatch',
        returned_lodge_id: row.lodge_id,
        expected_lodge_id: state.lodgeId
      }
    }
  }

  if (row.authenticated && row.found) {
    return {
      user: toSafeUser(row),
      source: 'rpc',
      session_token: row.session_token,
      session_expires_at: row.session_expires_at
    }
  }

  if (row.found) {
    return {
      user: null,
      code: 'wrong_password',
      error: 'That password is incorrect. Please try again or ask a manager to reset it.'
    }
  }

  const cachedUser = getCachedUser(emailLower)
  if (cachedUser) {
    return {
      user: null,
      code: 'wrong_lodge',
      error:
        'This account exists in saved data on this computer, but the server did not return it for the current lodge setup. Please ask support to check this device registration.'
    }
  }
  return {
    user: null,
    code: 'account_not_found',
    error: 'No staff account with that email was found for this lodge.'
  }
}

async function getLodgeAuthContext(targetLodgeId = state.lodgeId) {
  const authClient = buildSupabaseClient(SUPABASE_ANON_KEY)
  const rpcArgs = {
    p_lodge_id: targetLodgeId
  }
  authTrace('auth client state', getAuthClientState('anon-lodge-context'))
  authTrace('rpc call start', {
    functionName: 'get_lodge_auth_context',
    ...getAuthClientState('anon-lodge-context'),
    args: rpcArgs
  })
  const { data, error } = await authClient.rpc('get_lodge_auth_context', rpcArgs)
  if (error) {
    authTrace('rpc call error', {
      functionName: 'get_lodge_auth_context',
      ...getAuthClientState('anon-lodge-context'),
      args: rpcArgs,
      error
    })
  }
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row || null
}

async function createSupabaseAuthUserForStaff(emailLower, password) {
  if (!emailLower || !password) return null
  const metadata = {
    lodge_id: state.lodgeId,
    app: 'boroko-bookings'
  }

  if (state.adminDb) {
    try {
      const { data, error } = await state.adminDb.auth.admin.createUser({
        email: emailLower,
        password,
        email_confirm: true,
        user_metadata: metadata
      })
      if (error) {
        console.warn('[AUTH] Supabase Auth admin staff create skipped:', {
          email: emailLower,
          message: error.message
        })
      } else {
        return data?.user?.id || null
      }
    } catch (error) {
      console.warn('[AUTH] Supabase Auth admin staff create failed:', {
        email: emailLower,
        message: error?.message || 'unknown_error'
      })
    }
  }

  try {
    const authClient = buildSupabaseAuthClient()
    const { data, error } = await authClient.auth.signUp({
      email: emailLower,
      password,
      options: { data: metadata }
    })
    if (error) {
      console.warn('[AUTH] Supabase Auth staff signup skipped:', {
        email: emailLower,
        message: error.message
      })
      return null
    }
    return data?.user?.id || null
  } catch (error) {
    console.warn('[AUTH] Supabase Auth staff signup failed:', {
      email: emailLower,
      message: error?.message || 'unknown_error'
    })
    return null
  }
}

// ─── EXPORTED USER STATE FUNCTIONS ────────────────────────────────────────────

export function setCurrentUser(user) {
  state.currentUser = normalizeSessionUser(user)
  if (state.currentUser?.isMasterAdmin) {
    clearBackendSession()
  }
  if (state.currentUser) {
    state.replayAuthReady = true
  }
}

export function getCurrentUser() {
  return state.currentUser
}

// ─── EXPORTED SESSION NONCE ───────────────────────────────────────────────────

export function createSessionNonce(user, password = '') {
  const nonce = crypto.randomBytes(32).toString('hex')
  writeSessionNonce(user, nonce, password)
  return nonce
}

// ─── EXPORTED LOGOUT ──────────────────────────────────────────────────────────

export function logoutCurrentUser({ forgetTrustedSession = false } = {}) {
  state.currentUser = null
  state.replayAuthReady = false
  clearBackendSession()
  if (forgetTrustedSession) clearSessionNonce()
}

// ─── EXPORTED SESSION RESTORE ─────────────────────────────────────────────────

export function restoreUserSession(nonce) {
  authTrace('restoreSession start', { hasNonce: !!nonce, nonceLength: typeof nonce === 'string' ? nonce.length : null })
  console.log('[AUTH] restoreSession requested')
  if (!nonce) {
    state.currentUser = null
    clearBackendSession()
    clearSessionNonce()
    console.log('[AUTH] restoreSession cleared current user')
    authTrace('restoreSession result', { restored: false, reason: 'no_nonce' })
    return null
  }

  let stored = readSessionNonce()
  if (!stored || stored.nonce !== nonce) {
    stored = pruneExpiredTrustedSessions()
      .map(normalizeTrustedSessionRecord)
      .filter(Boolean)
      .find((session) => session.nonce === nonce && (!session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId)))
  }
  if (!stored || stored.nonce !== nonce) {
    console.warn('[AUTH] restoreSession REJECTED: invalid or missing session nonce')
    state.currentUser = null
    clearBackendSession()
    authTrace('restoreSession result', { restored: false, reason: 'invalid_or_missing_nonce' })
    return null
  }

  const age = Date.now() - new Date(stored.createdAt).getTime()
  if (age > SESSION_NONCE_MAX_AGE_MS) {
    console.warn('[AUTH] restoreSession REJECTED: nonce expired', { ageMs: age })
    state.currentUser = null
    clearBackendSession()
    clearSessionNonce()
    authTrace('restoreSession result', { restored: false, reason: 'nonce_expired' })
    return null
  }

  const userId = stored.userId
  if (stored.isMasterAdmin) {
    clearBackendSession()
    const safeUser = normalizeSessionUser({
      id: userId,
      email: stored.email || '',
      name: stored.name || 'Master Admin',
      role: stored.role || 'super_admin',
      isMasterAdmin: true
    })
    setCurrentUser(safeUser)
    console.log('[AUTH] restoreSession restored master admin:', {
      userId: safeUser.id,
      email: safeUser.email
    })
    authTrace('restoreSession result', { restored: true, userId: safeUser.id, role: safeUser.role, isMasterAdmin: true })
    return safeUser
  }

  if (stored.email && stored.role) {
    applyBackendSession({
      token: stored.session_token || null,
      expires_at: stored.session_expires_at || null,
      session_type: stored.session_type || 'desktop'
    })
    const users = readCache('users')
      .map(normalizeUserRecord)
      .filter(Boolean)
    const cachedById = users.find((u) => u.id === userId && (u.lodge_id ? u.lodge_id === state.lodgeId : true))
    const cachedByEmail = stored.email
      ? users.find((u) => u.email === normalizeEmail(stored.email) && (u.lodge_id ? u.lodge_id === state.lodgeId : true))
      : null
    const hasStoredScope = Object.prototype.hasOwnProperty.call(stored, 'allowed_outlet_ids')
    const nonceUser = normalizeSessionUser({
      id: userId,
      email: stored.email,
      name: stored.name || '',
      role: stored.role,
      lodge_id: stored.lodge_id || state.lodgeId,
      ...(hasStoredScope ? { allowed_outlet_ids: stored.allowed_outlet_ids } : {})
    })
    const mergedUser = hasStoredScope
      ? nonceUser
      : mergeSessionUserScope(
        nonceUser,
        cachedById || cachedByEmail || {
          allowed_outlet_ids: isPosFullAccessRole(stored.role)
            ? null
            : []
        }
      )
    const safeUser = normalizeSessionUser(mergedUser)
    setCurrentUser(safeUser)
    console.log('[AUTH] restoreSession restored from nonce metadata:', {
      userId: safeUser.id,
      email: safeUser.email,
      lodge_id: safeUser.lodge_id || state.lodgeId
    })
    authTrace('restoreSession result', { restored: true, userId: safeUser.id, lodge_id: safeUser.lodge_id || state.lodgeId, source: 'nonce_metadata' })
    return safeUser
  }

  const users = readCache('users')
  const user = users
    .map(normalizeUserRecord)
    .filter(Boolean)
    .find((u) => u.id === userId && (u.lodge_id ? u.lodge_id === state.lodgeId : true))
  if (!user) {
    console.warn('[AUTH] restoreSession cache miss for stored userId:', userId)
    state.currentUser = null
    clearBackendSession()
    clearSessionNonce()
    authTrace('restoreSession result', { restored: false, reason: 'user_cache_miss', userId })
    return null
  }
  const { password_hash: _ph, ...safeUser } = user
  setCurrentUser(safeUser)
  console.log('[AUTH] restoreSession restored:', {
    userId: safeUser.id,
    email: safeUser.email,
    lodge_id: safeUser.lodge_id || state.lodgeId
  })
  authTrace('restoreSession result', { restored: true, userId: safeUser.id, lodge_id: safeUser.lodge_id || state.lodgeId, source: 'cache' })
  return safeUser
}

// ─── EXPORTED TRUSTED SESSION RESTORE ─────────────────────────────────────────

export function restoreSavedTrustedSession(email = '', password = '') {
  const emailLower = normalizeEmail(email)
  const sessions = pruneExpiredTrustedSessions()
    .map(normalizeTrustedSessionRecord)
    .filter(Boolean)
    .filter((session) => !session.lodge_id || session.lodge_id === normalizeLodgeId(state.lodgeId))

  const legacy = normalizeTrustedSessionRecord(readSessionNonce())
  const candidates = [
    ...sessions,
    ...(legacy ? [legacy] : [])
  ].filter((session, index, all) => {
    const key = session.id || session.email || session.nonce
    return all.findIndex((entry) => (entry.id || entry.email || entry.nonce) === key) === index
  })

  const matches = emailLower
    ? candidates.filter((session) => session.email === emailLower)
    : candidates

  if (matches.length === 0) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'no_saved_session', email: emailLower })
    return { user: null, nonce: '', code: 'no_saved_trusted_session' }
  }
  if (!emailLower && matches.length > 1) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'email_required', count: matches.length })
    return { user: null, nonce: '', code: 'email_required', error: 'Choose the staff account to open its saved offline session.' }
  }
  if (!password) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'password_required', email: emailLower })
    return { user: null, nonce: '', code: 'password_required', error: 'Enter this user password to open the saved offline session.' }
  }

  const session = matches[0]
  if (!session.offline_password_hash) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'password_not_prepared', email: emailLower })
    return {
      user: null,
      nonce: '',
      code: 'offline_password_not_prepared',
      error: 'This saved session was created before offline password unlock was enabled. Connect to the internet and sign in once to prepare it.'
    }
  }
  if (!bcrypt.compareSync(password, session.offline_password_hash)) {
    authTrace('restoreSavedTrustedSession result', { restored: false, reason: 'wrong_password', email: emailLower })
    return { user: null, nonce: '', code: 'wrong_password', error: 'Incorrect password for this saved offline session.' }
  }

  const user = restoreUserSession(session.nonce)
  return user
    ? { user, nonce: session.nonce, code: null }
    : { user: null, nonce: '', code: 'saved_session_invalid', error: 'The saved offline session could not be opened. Connect to the internet and sign in again.' }
}

// ─── EXPORTED LOGIN ───────────────────────────────────────────────────────────

export async function loginUser(email, password) {
  authTrace('db.loginUser start', {
    email,
    normalizedEmail: normalizeEmail(email),
    lodge_id: state.lodgeId,
    passwordLength: typeof password === 'string' ? password.length : null,
    hasPassword: typeof password === 'string' ? password.length > 0 : false
  })
  console.log('\n[DB LOGIN ATTEMPT]')
  console.log('[DB LOGIN] lodgeId:', state.lodgeId)
  console.log('[DB LOGIN] email:', normalizeEmail(email))
  clearBackendSession()
  if (!state.lodgeId) {
    const result = {
      user: null,
      code: 'no_profile_selected',
      error: 'Choose a lodge on this computer before staff sign-in.'
    }
    authTrace('db.loginUser final return', result)
    return result
  }
  await checkOnline()
  const emailLower = normalizeEmail(email)

  if (state.isOnline) {
    const online = await authenticateOnline(emailLower, password)
    if (online.user) {
      let authContext
      try {
        applyBackendSession({
          token: online.session_token,
          expires_at: online.session_expires_at,
          session_type: 'desktop'
        })
        authContext = await getLodgeAuthContext()
      } catch (e) {
        clearBackendSession()
        console.error('[AUTH REAL ERROR]', {
          message: e?.message,
          code: e?.code,
          details: e?.details,
          hint: e?.hint,
          stack: e?.stack
        })

        return {
          user: null,
          code: 'auth_failed_real',
          error: e?.message || 'Unknown authentication error',
          details: {
            code: e?.code,
            hint: e?.hint,
            details: e?.details
          }
        }
      }

      if (!authContext?.lodge_id || normalizeLodgeId(authContext.lodge_id) !== normalizeLodgeId(state.lodgeId)) {
        clearBackendSession()
        console.warn('[AUTH TRACE] schema error wrapper hit', {
          source: 'get_lodge_auth_context_mismatch',
          expected_lodge_id: state.lodgeId,
          returned_lodge_id: authContext?.lodge_id || null
        })
        const result = {
          user: null,
          code: 'auth_failed_real',
          error: 'get_lodge_auth_context returned a lodge_id that does not match this device.',
          details: {
            source: 'get_lodge_auth_context',
            expected_lodge_id: state.lodgeId,
            returned_lodge_id: authContext?.lodge_id || null
          }
        }
        authTrace('db.loginUser final return', result)
        return result
      }
      if (authContext.deleted) {
        clearBackendSession()
        const result = { user: null, code: 'company_disabled', error: 'This company has been disabled. Contact support.' }
        authTrace('db.loginUser final return', result)
        return result
      }
      try {
        const { data: outletAccess } = await state.supabase.rpc('get_user_outlet_access', {
          p_user_id: online.user.id,
          p_lodge_id: state.lodgeId
        })
        if (outletAccess) {
          online.user.allowed_outlet_ids = outletAccess.allowed_outlet_ids || []
        }
      } catch {
        if (!online.user.allowed_outlet_ids) online.user.allowed_outlet_ids = []
      }
      if (online.source !== 'supabase_auth') {
        await createSupabaseAuthUserForStaff(emailLower, password)
      }
      await cacheSuccessfulLogin(online.user, emailLower, password)
      const result = {
        user: online.user,
        mode: 'online',
        source: online.source,
        session_token: online.session_token,
        session_expires_at: online.session_expires_at
      }
      authTrace('db.loginUser final return', { ...result, session_token: result.session_token ? '[present]' : null })
      return result
    }

    if (online.code === 'wrong_password' || online.code === 'account_not_found' || online.code === 'wrong_lodge' || online.code === 'backend_auth_schema_outdated' || online.code === 'auth_failed_real') {
      logAuthFailure(online.code, { email: emailLower })
      authTrace('db.loginUser final return', online)
      return online
    }

    console.warn('[AUTH] offline fallback decision:', {
      email: emailLower,
      reason: online.code || 'server_unreachable',
      using_offline_fallback: true
    })
    const savedSession = restoreSavedTrustedSession(emailLower, password)
    if (savedSession.user) {
      const result = {
        user: savedSession.user,
        mode: 'offline_trusted_session',
        warning: 'Opened the saved trusted session because the server could not verify the account right now.'
      }
      authTrace('db.loginUser final return', result)
      return result
    }
    logAuthFailure(online.code || 'server_unreachable', { email: emailLower })
    const result = {
      user: null,
      code: savedSession.code || online.code || 'server_unreachable',
      error: savedSession.error || 'The server could not verify this sign-in, and this account has no saved offline session on this computer yet.'
    }
    authTrace('db.loginUser final return', result)
    return result
  }

  console.warn('[AUTH] offline fallback decision:', {
    email: emailLower,
    reason: 'offline_mode',
    using_offline_fallback: true
  })
  const savedSession = restoreSavedTrustedSession(emailLower, password)
  if (savedSession.user) {
    const result = {
      user: savedSession.user,
      mode: 'offline_trusted_session',
      warning: 'Opened the saved trusted session while offline.'
    }
    authTrace('db.loginUser final return', result)
    return result
  }
  const result = {
    user: null,
    code: savedSession.code || 'no_saved_trusted_session',
    error: savedSession.error || 'No saved trusted session was found on this computer. Connect to the internet and sign in once, then offline access will work for this device.'
  }
  authTrace('db.loginUser final return', result)
  return result
}

// ─── EXPORTED PASSWORD RESET ──────────────────────────────────────────────────

export async function resetUserPassword(id, password) {
  const users = state.isOnline ? await getAllUsers() : readCache('users')
  const existingUser = users.find((u) => u.id === id)
  if (!existingUser) throw new Error('Staff account not found.')
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.')

  const password_hash = bcrypt.hashSync(password, 10)

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('set_user_password', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_password_hash: password_hash
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not reset password')
    await refreshCache('users')
  } else {
    const cached = readCache('users')
    const idx = cached.findIndex((u) => u.id === id)
    if (idx < 0) throw new Error('Staff account not found in local data.')
    cached[idx] = { ...cached[idx], password_hash }
    writeCache('users', cached)
    queueOperation('rpc', 'set_user_password', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_password_hash: password_hash
    })
  }

  if (state.isOnline && existingUser.auth_user_id && state.adminDb) {
    const { error } = await state.adminDb.auth.admin.updateUserById(existingUser.auth_user_id, {
      password
    })
    if (error) throw new Error(error.message || 'Could not update Supabase Auth password.')
  }

  upsertAuthEntry(existingUser.email.trim().toLowerCase(), bcrypt.hashSync(password, 10))
}
