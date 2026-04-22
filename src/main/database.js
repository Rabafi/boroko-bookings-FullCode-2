import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { getRoleCapabilities, normalizeAppRole, isPosFullAccessRole } from '../shared/accessControl.js'
import { isFinancialSyncItem, pickNextReadySyncItemIndex } from '../shared/syncQueue.js'

// ─── SUPABASE CREDENTIALS ─────────────────────────────────────────────────────
// URL + ANON KEY — baked in at build time from the root .env file by electron-vite.
// Neither value is a secret (Supabase designed the anon key to be public-facing),
// but keeping them in .env rather than source code means they are not committed to
// the git repository and can be rotated without a code change.
//
// Before building, create a root .env file (see .env.example):
//   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
//   VITE_SUPABASE_KEY=<anon-public-key>
//
// SERVICE ROLE KEY — SECRET. Never put this in .env or source code.
// Set as an OS environment variable on the Command Central admin machine ONLY:
//   Windows PowerShell:
//     [System.Environment]::SetEnvironmentVariable('SUPABASE_SERVICE_ROLE_KEY','<key>','User')
//   macOS / Linux (add to ~/.zshrc or ~/.bashrc):
//     export SUPABASE_SERVICE_ROLE_KEY='<key>'
//
// Lodge customer machines will NOT have this variable → adminDb stays null →
// admin-only functions return a clear error instead of exposing privileged access.
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY
const AUTH_REDIRECT_URL = (
  process.env.BOROKO_AUTH_REDIRECT_URL ||
  import.meta.env.VITE_AUTH_REDIRECT_URL ||
  ''
).trim()

let supabase      // anon client — used for all lodge-scoped operations
let adminDb       // service-role client — null on lodge customer machines
let isOnline = false
let cacheRootDir
let profilesCacheDir
let cacheDir
let currentUser = null
let backupIntervalStarted = false
let lodgeId = null
let syncInProgress = false
let replayAuthReady = false   // P0-5: set to true only after a user is authenticated
let backendSession = null
let syncRefreshState = {
  stale: false,
  names: [],
  attempts: 0,
  lastError: '',
  lastFailedAt: null
}
let lastSuccessfulSyncAt = null
let syncRefreshRetryTimer = null
const AUTH_CONTRACT_VERSION = 2
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROFILE_STATUS = {
  DRAFT: 'draft',
  READY: 'ready'
}
const ENTITLEMENT_FEATURES = ['reports', 'expenses', 'staff', 'pwa', 'audit', 'conference', 'pool', 'import', 'pos', 'inventory', 'supplies']
const PLAN_FEATURE_MAP = {
  Starter: {
    reports: false, expenses: false, staff: false, pwa: false, audit: false,
    conference: false, pool: false, import: false, pos: false,
    inventory: false, supplies: false
  },
  Standard: {
    reports: true, expenses: true, staff: true, pwa: false, audit: true,
    conference: true, pool: true, import: true, pos: false,
    inventory: false, supplies: false
  },
  Pro: {
    reports: true, expenses: true, staff: true, pwa: true, audit: true,
    conference: true, pool: true, import: true, pos: true,
    inventory: true, supplies: true
  }
}
const PWA_DISABLED_MESSAGE = 'Manager PWA access disabled.'
const PWA_ROLE_DISABLED_MESSAGE = 'Only manager and admin roles can use the manager PWA.'
const DEFAULT_SUBSCRIPTION_GRACE_DAYS = 7
const DEFAULT_OFFLINE_LEASE_DAYS = 7
const LOCAL_TIME_ZONE = 'Africa/Gaborone'
const FINANCIAL_VALIDATION_RUNS_FILE = 'financial-validation-runs.json'
const FINANCIAL_VALIDATION_ALERTS_FILE = 'financial-validation-alerts.json'
const LOCAL_INVOICE_DELIVERY_FILE = 'invoice-delivery-history.json'
const CRITICAL_ERROR_LOG_FILE = 'critical-errors.json'
const SYNC_META_FILE = 'sync-meta.json'
const HEALTH_FAULTS_FILE = 'health-faults.json'
const CACHE_FRESHNESS_FILE = 'cache-freshness.json'
const SYNC_DRIFT_FAULT_TYPES = ['customer_drift', 'room_drift', 'quotation_drift', 'pos_drift']
const PERIODIC_SYNC_INTERVAL_MS = 5 * 60 * 1000   // 5 min — auto-retry retryable dead letters
const BACKUP_POLICY_DEFAULT = {
  enabled: false,
  target_dir: '',
  export_json: true,
  export_excel: true,
  frequency_days: 7,
  last_run_at: null,
  last_success_at: null,
  last_error: '',
  last_json_path: '',
  last_excel_path: ''
}
const PROFILE_CACHE_FILES = {
  settings: [],
  users: [],
  rooms: [],
  customers: [],
  bookings: [],
  quotations: [],
  activity: [],
  auth: [],
  syncQueue: [],
  syncFailed: [],
  syncMeta: null,
  healthFaults: [],
  cacheFreshness: null,
  trialStatus: null
}

function buildSupabaseClient(key, sessionToken = null) {
  const token = typeof sessionToken === 'string' && sessionToken.trim() ? sessionToken.trim() : null
  authTrace('buildSupabaseClient', {
    clientKind: key === SUPABASE_ANON_KEY ? 'anon' : 'non-anon',
    hasExplicitSessionToken: !!token,
    explicitSessionTokenLength: token ? token.length : null,
    currentLodgeId: lodgeId
  })
  return createClient(SUPABASE_URL, key, {
    global: {
      headers: token ? { 'x-boroko-session': token } : {}
    }
  })
}

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

function applyBackendSession(session) {
  authTrace('applyBackendSession', {
    hasIncomingToken: !!session?.token,
    incomingTokenLength: session?.token ? session.token.length : null,
    session_type: session?.session_type || null,
    expires_at: session?.expires_at || null,
    lodgeId
  })
  backendSession = session?.token
    ? {
        token: session.token,
        expires_at: session.expires_at || null,
        session_type: session.session_type || 'desktop'
      }
    : null
  supabase = buildSupabaseClient(SUPABASE_ANON_KEY, backendSession?.token || null)
}

export function clearBackendSession() {
  authTrace('clearBackendSession', {
    hadBackendSession: !!backendSession?.token,
    backendSessionType: backendSession?.session_type || null,
    lodgeId
  })
  applyBackendSession(null)
}

function getBackendSession() {
  return backendSession ? { ...backendSession } : null
}

function normalizePlanName(plan) {
  const raw = String(plan || '').trim().toLowerCase()
  if (!raw) return 'Starter'
  if (raw === 'basic') return 'Starter'
  if (raw === 'premium') return 'Pro'
  if (raw === 'starter') return 'Starter'
  if (raw === 'standard') return 'Standard'
  if (raw === 'pro') return 'Pro'
  return 'Starter'
}

function normalizeStaffRole(role) {
  return String(role || '').trim().toLowerCase() || 'receptionist'
}

function isPwaEligibleRole(role) {
  const normalized = normalizeStaffRole(role)
  return normalized === 'manager' || normalized === 'admin'
}

function normalizePwaDisabledReason(reason, fallback = PWA_DISABLED_MESSAGE) {
  const value = String(reason || '').trim()
  return value || fallback
}

function cloneFeatureMap(map = {}) {
  return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, map[feature] !== false]))
}

function toPositiveInt(value, fallback) {
  const numeric = Number.parseInt(value, 10)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function addDays(dateValue, days) {
  const value = new Date(dateValue || Date.now())
  value.setDate(value.getDate() + days)
  return value
}

function minDate(values = []) {
  const valid = values
    .map((value) => (value ? new Date(value) : null))
    .filter((value) => value && Number.isFinite(value.getTime()))
  if (valid.length === 0) return null
  return new Date(Math.min(...valid.map((value) => value.getTime())))
}

function computeSubscriptionState({
  payment_status,
  next_due_date,
  expires_at,
  is_active = true,
  grace_period_days = DEFAULT_SUBSCRIPTION_GRACE_DAYS
} = {}) {
  if (is_active === false) return 'inactive'

  const rawStatus = String(payment_status || 'active').trim().toLowerCase() || 'active'
  if (rawStatus === 'cancelled') return 'cancelled'

  if (expires_at) {
    const expiry = new Date(expires_at)
    if (Number.isFinite(expiry.getTime()) && expiry < new Date()) {
      return 'expired'
    }
  }

  if (rawStatus === 'suspended' || rawStatus === 'paused') return 'suspended'
  if (rawStatus === 'trial') return 'trial'
  if (rawStatus === 'free') return 'active'

  if (next_due_date) {
    const dueDate = new Date(next_due_date)
    if (Number.isFinite(dueDate.getTime())) {
      const today = new Date()
      const dueStart = new Date(dueDate)
      dueStart.setHours(0, 0, 0, 0)
      const todayStart = new Date(today)
      todayStart.setHours(0, 0, 0, 0)
      if (dueStart < todayStart) {
        const graceEnd = addDays(dueStart, Math.max(Number(grace_period_days || 0), 0) + 1)
        return graceEnd < today ? 'suspended' : 'grace_period'
      }
    }
  }

  if (rawStatus === 'overdue') return 'grace_period'
  return 'active'
}

function subscriptionAllowsAccess(state) {
  return state === 'active' || state === 'grace_period' || state === 'trial'
}

function computeGracePeriodEnd(nextDueDate, gracePeriodDays = DEFAULT_SUBSCRIPTION_GRACE_DAYS) {
  if (!nextDueDate) return null
  const dueDate = new Date(nextDueDate)
  if (!Number.isFinite(dueDate.getTime())) return null
  return addDays(dueDate, Math.max(Number(gracePeriodDays || 0), 0) + 1).toISOString()
}

function computeOfflineValidUntil({
  subscription_state,
  expires_at,
  next_due_date,
  grace_period_days = DEFAULT_SUBSCRIPTION_GRACE_DAYS,
  offline_lease_days = DEFAULT_OFFLINE_LEASE_DAYS,
  trial_end = null
} = {}) {
  if (subscription_state && !subscriptionAllowsAccess(subscription_state)) {
    return new Date().toISOString()
  }

  const leaseEnd = addDays(new Date(), toPositiveInt(offline_lease_days, DEFAULT_OFFLINE_LEASE_DAYS))
  const candidates = [leaseEnd]
  const graceEnd = computeGracePeriodEnd(next_due_date, grace_period_days)
  if (graceEnd) candidates.push(graceEnd)
  if (expires_at) candidates.push(expires_at)
  if (trial_end) candidates.push(trial_end)
  return (minDate(candidates) || leaseEnd).toISOString()
}

function getPlanFeatureMap(plan, { trial = false, expired = false } = {}) {
  if (trial) return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, true]))
  if (expired) return Object.fromEntries(ENTITLEMENT_FEATURES.map((feature) => [feature, false]))
  return cloneFeatureMap(PLAN_FEATURE_MAP[normalizePlanName(plan)] || PLAN_FEATURE_MAP.Starter)
}

function mergeFeatureOverrides(baseMap = {}, overrides = []) {
  const next = { ...baseMap }
  for (const row of overrides || []) {
    const featureName = String(row?.feature_name || '').trim()
    if (!featureName) continue
    next[featureName] = row?.enabled !== false
  }
  return next
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

function getManagedBackupPolicyPath() {
  return path.join(app.getPath('userData'), 'managed-backup-policy.json')
}

function normalizeManagedBackupPolicy(raw = {}) {
  return {
    enabled: raw?.enabled === true,
    target_dir: typeof raw?.target_dir === 'string' ? raw.target_dir.trim() : '',
    export_json: raw?.export_json !== false,
    export_excel: raw?.export_excel !== false,
    frequency_days: Number(raw?.frequency_days) > 0 ? Number(raw.frequency_days) : 7,
    last_run_at: raw?.last_run_at || null,
    last_success_at: raw?.last_success_at || null,
    last_error: typeof raw?.last_error === 'string' ? raw.last_error : '',
    last_json_path: typeof raw?.last_json_path === 'string' ? raw.last_json_path : '',
    last_excel_path: typeof raw?.last_excel_path === 'string' ? raw.last_excel_path : ''
  }
}

function buildManagedBackupStatus(policy) {
  const normalized = normalizeManagedBackupPolicy(policy)
  const now = new Date()
  const lastSuccessAt = normalized.last_success_at ? new Date(normalized.last_success_at) : null
  const nextDueAt = lastSuccessAt
    ? new Date(lastSuccessAt.getTime() + normalized.frequency_days * 24 * 60 * 60 * 1000)
    : null
  const overdue = normalized.enabled && normalized.target_dir
    ? (!lastSuccessAt || (nextDueAt && nextDueAt.getTime() < now.getTime()))
    : false
  const requiresSetup = normalized.enabled && !normalized.target_dir
  const hasRecentSuccess = !!lastSuccessAt

  return {
    ...normalized,
    next_due_at: nextDueAt ? nextDueAt.toISOString() : null,
    overdue,
    requires_setup: requiresSetup,
    has_recent_success: hasRecentSuccess,
    compliance_state: requiresSetup
      ? 'setup_required'
      : overdue
        ? 'overdue'
        : hasRecentSuccess
          ? 'healthy'
          : (normalized.enabled ? 'pending_first_run' : 'disabled')
  }
}

// ─── PROFILES / LEGACY LODGE ID ──────────────────────────────────────────────
// Older builds stored a single lodge ID and one shared cache directory.
// Newer builds store multiple lodge profiles on one PC and activate one at a
// time by swapping the runtime lodgeId/cacheDir underneath existing functions.

function getLodgeIdPath() {
  return path.join(app.getPath('userData'), 'lodge-id.json')
}

function getProfilesPath() {
  return path.join(app.getPath('userData'), 'profiles.json')
}

function readLegacyLodgeId() {
  const data = readJsonFile(getLodgeIdPath(), null)
  return normalizeLodgeId(data?.lodge_id)
}

function persistLegacyLodgeId(id) {
  writeJsonFile(getLodgeIdPath(), { lodge_id: id })
}

function getProfileCacheDir(profileLodgeId) {
  return path.join(profilesCacheDir, normalizeLodgeId(profileLodgeId))
}

function getInactiveCacheDir() {
  return path.join(cacheRootDir, '__inactive')
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

function profileLabelFromSettings(settings = {}, fallback = 'Untitled Lodge') {
  return settings?.lodge_name?.trim() || settings?.company_name?.trim() || fallback
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

function hasLegacyCacheData() {
  const legacyFiles = [
    'settings.json',
    'users.json',
    'rooms.json',
    'customers.json',
    'bookings.json',
    'quotations.json',
    'auth-cache.json',
    'sync-queue.json',
    'sync-failed.json',
    'activity-log.json',
    'session-nonce.json',
    'trial_status.json'
  ]

  return legacyFiles.some((fileName) => fs.existsSync(path.join(cacheRootDir, fileName)))
}

function migrateLegacySingleLodgeProfile() {
  const legacyLodgeId = readLegacyLodgeId()
  if (!legacyLodgeId && !hasLegacyCacheData()) {
    return writeProfilesRegistry({ active_lodge_id: null, profiles: [] })
  }

  const derivedLodgeId = legacyLodgeId || randomUUID()
  const legacySettings = readJsonFile(path.join(cacheRootDir, 'settings.json'), [])
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
    'auth-cache.json',
    'sync-queue.json',
    'sync-failed.json',
    'activity-log.json',
    'session-nonce.json',
    'trial_status.json'
  ]

  for (const fileName of legacyFileNames) {
    const legacyPath = path.join(cacheRootDir, fileName)
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
  lodgeId = normalizedId || null
  cacheDir = lodgeId ? getProfileCacheDir(lodgeId) : getInactiveCacheDir()
  ensureDir(cacheDir)

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
  ensureDir(cacheRootDir)
  ensureDir(profilesCacheDir)
  ensureDir(getInactiveCacheDir())

  const registry = fs.existsSync(getProfilesPath())
    ? writeProfilesRegistry(readProfilesRegistry())
    : migrateLegacySingleLodgeProfile()

  setRuntimeActiveProfile(registry.active_lodge_id, { persistActive: false, touch: false })
  return registry
}

function updateProfileMetadata(targetLodgeId, updates = {}) {
  const normalizedId = normalizeLodgeId(targetLodgeId)
  const registry = readProfilesRegistry()
  const nextProfiles = registry.profiles.map((profile) => {
    if (profile.lodge_id !== normalizedId) return profile
    return sanitizeProfile({
      ...profile,
      ...updates,
      lodge_id: updates.lodge_id || profile.lodge_id,
      last_used_at: updates.last_used_at || new Date().toISOString()
    })
  }).filter(Boolean)

  return writeProfilesRegistry({
    active_lodge_id: normalizeLodgeId(updates.lodge_id || registry.active_lodge_id),
    profiles: nextProfiles
  })
}

function removeLocalCompanyProfile(targetLodgeId) {
  const normalizedId = normalizeLodgeId(targetLodgeId)
  if (!normalizedId) return { removed: false, active_profile: getActiveProfile(), profiles: getProfiles() }

  const registry = readProfilesRegistry()
  const profileCacheDir = getProfileCacheDir(normalizedId)
  try { fs.rmSync(profileCacheDir, { recursive: true, force: true }) } catch {}

  const remainingProfiles = registry.profiles.filter((entry) => entry.lodge_id !== normalizedId)
  const nextActiveId = registry.active_lodge_id === normalizedId
    ? remainingProfiles[0]?.lodge_id || null
    : registry.active_lodge_id

  writeProfilesRegistry({
    active_lodge_id: nextActiveId,
    profiles: remainingProfiles
  })

  if (readLegacyLodgeId() === normalizedId) {
    persistLegacyLodgeId(nextActiveId)
  }

  if (lodgeId === normalizedId) {
    currentUser = null
    replayAuthReady = false
    clearBackendSession()
    setRuntimeActiveProfile(nextActiveId, { persistActive: false, touch: false })
  }

  return {
    removed: registry.profiles.some((entry) => entry.lodge_id === normalizedId),
    active_profile: getActiveProfile(),
    profiles: getProfiles()
  }
}

// Returns the admin (service-role) Supabase client, or throws a clear error if
// the SUPABASE_SERVICE_ROLE_KEY env var was not set on this machine.
// Use this in any function that queries across all lodges (Command Central only).
function requireAdmin() {
  if (!adminDb) {
    throw new Error(
      'This operation requires Command Central admin access. ' +
      'Set the SUPABASE_SERVICE_ROLE_KEY environment variable on this machine. ' +
      'See setup documentation for details.'
    )
  }
  return adminDb
}

/**
 * Returns the outlet filter for the current user's POS access.
 * null  = unrestricted (manager / admin / super_admin / master admin)
 * []    = no access (cashier/supervisor with no outlets assigned)
 * [id1] = restricted to these outlet UUIDs
 */
export function getUserPosOutletFilter() {
  if (!currentUser) return []
  if (currentUser.isMasterAdmin) return null
  if (isPosFullAccessRole(currentUser.role)) return null
  return Array.isArray(currentUser.allowed_outlet_ids) ? currentUser.allowed_outlet_ids : []
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

export function setCurrentUser(user) {
  currentUser = normalizeSessionUser(user)
  if (currentUser?.isMasterAdmin) {
    clearBackendSession()
  }
  // P0-5: a real user is now authenticated — allow queue replay
  if (currentUser) {
    replayAuthReady = true
  }
}

export function getCurrentUser() {
  return currentUser
}

export function logoutCurrentUser({ forgetTrustedSession = false } = {}) {
  currentUser = null
  replayAuthReady = false
  clearBackendSession()
  if (forgetTrustedSession) clearSessionNonce()
}

// Restores the main-process session using a nonce that was issued during login.
// The nonce file (session-nonce.json) is the single source of truth for session
// identity — the renderer cannot influence which user is restored.
// Passing null/undefined clears the trusted device session.
export function restoreUserSession(nonce) {
  authTrace('restoreSession start', { hasNonce: !!nonce, nonceLength: typeof nonce === 'string' ? nonce.length : null })
  console.log('[AUTH] restoreSession requested')
  if (!nonce) {
    currentUser = null
    clearBackendSession()
    clearSessionNonce()
    console.log('[AUTH] restoreSession cleared current user')
    authTrace('restoreSession result', { restored: false, reason: 'no_nonce' })
    return null
  }

  // Validate nonce against the current session, or any saved trusted session
  // for this lodge. This allows multiple staff to unlock their own saved
  // offline sessions on the same computer.
  let stored = readSessionNonce()
  if (!stored || stored.nonce !== nonce) {
    stored = pruneExpiredTrustedSessions()
      .map(normalizeTrustedSessionRecord)
      .filter(Boolean)
      .find((session) => session.nonce === nonce && (!session.lodge_id || session.lodge_id === normalizeLodgeId(lodgeId)))
  }
  if (!stored || stored.nonce !== nonce) {
    console.warn('[AUTH] restoreSession REJECTED: invalid or missing session nonce')
    currentUser = null
    clearBackendSession()
    authTrace('restoreSession result', { restored: false, reason: 'invalid_or_missing_nonce' })
    return null
  }

  // Expiry check
  const age = Date.now() - new Date(stored.createdAt).getTime()
  if (age > SESSION_NONCE_MAX_AGE_MS) {
    console.warn('[AUTH] restoreSession REJECTED: nonce expired', { ageMs: age })
    currentUser = null
    clearBackendSession()
    clearSessionNonce()
    authTrace('restoreSession result', { restored: false, reason: 'nonce_expired' })
    return null
  }

  // Identity derived from nonce file, NOT from renderer
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
    const cachedById = users.find((u) => u.id === userId && (u.lodge_id ? u.lodge_id === lodgeId : true))
    const cachedByEmail = stored.email
      ? users.find((u) => u.email === normalizeEmail(stored.email) && (u.lodge_id ? u.lodge_id === lodgeId : true))
      : null
    const hasStoredScope = Object.prototype.hasOwnProperty.call(stored, 'allowed_outlet_ids')
    const nonceUser = normalizeSessionUser({
      id: userId,
      email: stored.email,
      name: stored.name || '',
      role: stored.role,
      lodge_id: stored.lodge_id || lodgeId,
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
      lodge_id: safeUser.lodge_id || lodgeId
    })
    authTrace('restoreSession result', { restored: true, userId: safeUser.id, lodge_id: safeUser.lodge_id || lodgeId, source: 'nonce_metadata' })
    return safeUser
  }

  const users = readCache('users')
  const user = users
    .map(normalizeUserRecord)
    .filter(Boolean)
    .find((u) => u.id === userId && (u.lodge_id ? u.lodge_id === lodgeId : true))
  if (!user) {
    console.warn('[AUTH] restoreSession cache miss for stored userId:', userId)
    currentUser = null
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
    lodge_id: safeUser.lodge_id || lodgeId
  })
  authTrace('restoreSession result', { restored: true, userId: safeUser.id, lodge_id: safeUser.lodge_id || lodgeId, source: 'cache' })
  return safeUser
}

export function restoreSavedTrustedSession(email = '', password = '') {
  const emailLower = normalizeEmail(email)
  const sessions = pruneExpiredTrustedSessions()
    .map(normalizeTrustedSessionRecord)
    .filter(Boolean)
    .filter((session) => !session.lodge_id || session.lodge_id === normalizeLodgeId(lodgeId))

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

export async function validateCurrentSession() {
  // Master admins authenticate against master_admins table, not Supabase app sessions.
  // They have no backend session token by design — treat as always valid.
  if (currentUser?.isMasterAdmin) return currentUser

  const session = getBackendSession()
  // P0-6: Session validation is mandatory — cannot bypass with missing token
  if (!currentUser || !session?.token) {
    console.warn('[AUTH] Session validation failed: missing token or user')
    return null
  }

  await checkOnline()
  if (!isOnline) {
    return currentUser
  }

  // Check session expiration before making any RPC calls
  if (session.expires_at) {
    const expiryTs = new Date(session.expires_at).getTime()
    if (Number.isFinite(expiryTs) && expiryTs <= Date.now()) {
      console.warn('[AUTH] Session expired, clearing credentials')
      currentUser = null
      clearBackendSession()
      clearSessionNonce()
      return null
    }
  }

  try {
    const { data, error } = await supabase.rpc('validate_app_session', {
      p_session_token: session.token
    })
    if (error) throw error

    const row = Array.isArray(data) ? data[0] : data
    if (!row) {
      currentUser = null
      clearBackendSession()
      clearSessionNonce()
      return null
    }

    const rowLodgeId = normalizeLodgeId(row.lodge_id)
    if (
      row.session_type !== (session.session_type || 'desktop') ||
      (rowLodgeId && rowLodgeId !== normalizeLodgeId(lodgeId))
    ) {
      currentUser = null
      clearBackendSession()
      clearSessionNonce()
      return null
    }

    const refreshedUser = normalizeSessionUser({
      ...currentUser,
      id: row.id || currentUser.id,
      name: row.name || currentUser.name,
      email: row.email || currentUser.email,
      role: row.role || currentUser.role,
      lodge_id: row.lodge_id || currentUser.lodge_id || lodgeId
    })

    setCurrentUser(refreshedUser)
    upsertCachedUser(refreshedUser)

    const stored = readSessionNonce()
    if (stored?.nonce) {
      writeSessionNonce(refreshedUser, stored.nonce)
    }

    return refreshedUser
  } catch (error) {
    authTrace('validateCurrentSession failed', {
      message: error?.message || 'unknown_error',
      lodge_id: lodgeId
    })
    return currentUser
  }
}

// ─── CACHE HELPERS ────────────────────────────────────────────────────────────

function getCachePath(name) {
  return path.join(cacheDir, `${name}.json`)
}

function readCache(name) {
  const filePath = getCachePath(name)
  const tmpPath  = filePath + '.tmp'
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
  const tmpPath  = filePath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (e) {
    console.error(`[Cache] Write failed for '${name}':`, e)
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
  // Track freshness metadata for each named cache write
  try {
    const freshnessPath = path.join(cacheDir, CACHE_FRESHNESS_FILE)
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

function readSyncQueue() {
  if (!cacheDir) return []
  const filePath = path.join(cacheDir, 'sync-queue.json')
  const tmpPath  = filePath + '.tmp'
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
  if (!cacheDir) return
  const filePath = path.join(cacheDir, 'sync-queue.json')
  const tmpPath  = filePath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(Array.isArray(queue) ? queue : [], null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (e) {
    console.error('Sync queue write failed:', e)
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function payloadHasAmount(payload) {
  return !!payload && Object.prototype.hasOwnProperty.call(payload, 'amount')
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

function isBackendAuthSchemaError(message = '') {
  return /authenticate_user|authenticate_manager|get_manager_pwa_profile|validate_app_session|set_user_pwa_access|get_lodge_auth_context|schema cache|returned record type|structure of query does not match|contract_version|column .*deleted|column .*lodge_id|column .*password_hash|column .*pwa_|permission denied/i.test(message)
}

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
    hasBackendSession: !!backendSession?.token,
    backendSessionType: backendSession?.session_type || null,
    backendSessionTokenLength: backendSession?.token ? backendSession.token.length : null,
    lodgeId,
    email: email || null
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

function makeBackendAuthSchemaError(message, details = {}) {
  console.warn('[AUTH TRACE] schema error wrapper hit', { message, details })
  return {
    user: null,
    code: 'backend_auth_schema_outdated',
    error: message,
    details
  }
}

function createAppError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  Object.assign(error, details)
  return error
}

function isReadOnlySessionTouchError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return message.includes('read-only transaction') && message.includes('update')
}

function buildReadOnlySessionTouchMessage(featureLabel = 'This screen') {
  return `${featureLabel} is hitting an older database read path that still tries to write during a SELECT. Apply the latest session and entitlement read-only SQL fixes in Supabase, then reload the app.`
}

// ─── CONNECTIVITY & SYNC ──────────────────────────────────────────────────────

/** True when the Supabase project is reachable over the network (not whether RLS allows reading rooms). */
async function checkOnline() {
  if (process.env.BOROKO_TEST_FORCE_OFFLINE === 'true') {
    isOnline = false
    return isOnline
  }
  const base = SUPABASE_URL.replace(/\/$/, '')
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`
  }
  const fetchWithTimeout = async (url, init = {}) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
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
    isOnline = reachable(res)
  } catch {
    try {
      const res = await fetchWithTimeout(`${base}/rest/v1/`, { method: 'GET' })
      isOnline = reachable(res)
    } catch {
      isOnline = false
    }
  }
  return isOnline
}

// Refresh one or more named caches from Supabase. Only fetches what's requested.
async function refreshCache(...names) {
  try {
    await refreshCacheStrict(...names)
    clearSyncRefreshStale(uniqueSyncNames(names).filter((name) => isSyncRefreshStaleFor(name)))
  } catch (e) {
    console.error('Cache refresh failed:', e)
  }
}

// Full refresh — used only at startup, reconnect, and after bulk operations.
async function refreshAllCaches() {
  if (!lodgeId) return
  await refreshCache('users', 'rooms', 'customers', 'bookings')
}

const MAX_SYNC_RETRIES = 5
const SYNC_RETRY_BASE_DELAY_MS = 1000
const SYNC_RETRY_MAX_DELAY_MS = 30_000
const DEAD_LETTER_AUTO_RETRY_AFTER_MS = 30 * 60 * 1000
const SYNC_REFRESH_RETRY_BASE_DELAY_MS = 5_000
const SYNC_REFRESH_RETRY_MAX_DELAY_MS = 60_000
const MAX_FINANCIAL_AMOUNT = 1_000_000
const SYNC_ALREADY_APPLIED_CODES = new Set(['23505'])

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function uniqueSyncNames(names = []) {
  return [...new Set((names || []).filter(Boolean))]
}

function isSyncRefreshStaleFor(name) {
  return syncRefreshState.stale && syncRefreshState.names.includes(name)
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

function markSyncRefreshStale(names = [], errorMessage = 'Cache refresh failed.') {
  const mergedNames = uniqueSyncNames([...syncRefreshState.names, ...names])
  syncRefreshState = {
    stale: mergedNames.length > 0,
    names: mergedNames,
    attempts: Math.max(1, Number(syncRefreshState.attempts || 0)),
    lastError: String(errorMessage || 'Cache refresh failed.'),
    lastFailedAt: new Date().toISOString()
  }
  broadcastSyncStatus()
}

function clearSyncRefreshStale(names = []) {
  if (!syncRefreshState.stale) return
  const clearNames = new Set(uniqueSyncNames(names))
  const remainingNames = clearNames.size === 0
    ? []
    : syncRefreshState.names.filter((name) => !clearNames.has(name))
  syncRefreshState = {
    stale: remainingNames.length > 0,
    names: remainingNames,
    attempts: remainingNames.length > 0 ? syncRefreshState.attempts : 0,
    lastError: remainingNames.length > 0 ? syncRefreshState.lastError : '',
    lastFailedAt: remainingNames.length > 0 ? syncRefreshState.lastFailedAt : null
  }
  if (!syncRefreshState.stale && syncRefreshRetryTimer) {
    clearTimeout(syncRefreshRetryTimer)
    syncRefreshRetryTimer = null
  }
  broadcastSyncStatus()
}

async function refreshCacheStrict(...names) {
  if (!lodgeId) return
  const fetchers = {
    users:      () => supabase.from('users').select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids').eq('lodge_id', lodgeId).order('name'),
    rooms:      () => supabase.from('rooms').select('*').eq('lodge_id', lodgeId).order('room_number'),
    customers:  () => supabase.from('customers').select('*').eq('lodge_id', lodgeId).order('name'),
    bookings:   () => supabase.from('bookings').select('*').eq('lodge_id', lodgeId).order('check_in', { ascending: false }),
    'inventory-items': () => supabase.from('inventory_items').select('*').eq('lodge_id', lodgeId).order('category').order('name'),
    'inventory-purchases': () => supabase.from('inventory_purchases').select('*').eq('lodge_id', lodgeId).order('date', { ascending: false }),
    quotations: () => supabase.from('quotations').select('*').eq('lodge_id', lodgeId).order('created_at', { ascending: false }),
    'conference-bookings': () => supabase.from('conference_bookings').select('*').eq('lodge_id', lodgeId).order('booking_date', { ascending: false }).order('start_time', { ascending: true }),
    'pool-day-use': () => supabase.from('pool_day_use').select('*').eq('lodge_id', lodgeId).order('date', { ascending: false }),
    'pos-orders': () => supabase
      .from('pos_orders')
      .select('*, pos_order_items(*), outlets(name)')
      .eq('lodge_id', lodgeId)
      .order('created_at', { ascending: false })
  }

  await Promise.all(names.map(async (name) => {
    if (!fetchers[name]) return
    const { data, error } = await fetchers[name]()
    if (error) throw error
    if (!data) return
    if (name === 'users') {
      const normalizedUsers = data.map(normalizeUserRecord).filter(Boolean)
      writeCache(name, normalizedUsers, { source: 'remote' })
      if (currentUser && !currentUser.isMasterAdmin) {
        const refreshedUser = normalizedUsers.find((entry) =>
          (currentUser.id && entry.id === currentUser.id) ||
          (!currentUser.id && currentUser.email && entry.email === currentUser.email)
        )
        if (refreshedUser) {
          setCurrentUser(mergeSessionUserScope(currentUser, refreshedUser))
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

function scheduleSyncRefreshRetry(names = [], reason = 'Background refresh failed.') {
  const mergedNames = uniqueSyncNames([...syncRefreshState.names, ...names])
  if (mergedNames.length === 0) return

  const nextAttempts = Math.max(1, Number(syncRefreshState.attempts || 0) + 1)
  syncRefreshState = {
    stale: true,
    names: mergedNames,
    attempts: nextAttempts,
    lastError: String(reason || 'Background refresh failed.'),
    lastFailedAt: new Date().toISOString()
  }
  broadcastSyncStatus()

  if (syncRefreshRetryTimer) return

  const waitMs = Math.min(
    SYNC_REFRESH_RETRY_MAX_DELAY_MS,
    SYNC_REFRESH_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, nextAttempts - 1))
  )

  syncRefreshRetryTimer = setTimeout(async () => {
    syncRefreshRetryTimer = null
    const retryNames = [...syncRefreshState.names]
    if (!retryNames.length || !isOnline || !lodgeId) return
    try {
      await refreshCacheStrict(...retryNames)
      clearSyncRefreshStale(retryNames)
    } catch (error) {
      console.error('[Sync] Background cache refresh retry failed:', error)
      scheduleSyncRefreshRetry(retryNames, error?.message || 'Background refresh retry failed.')
    }
  }, waitMs)
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

function isBookingUpdateConflictError(message = '') {
  return /modified on another device|booking conflict|refresh and try again/i.test(String(message || ''))
}

function shouldManualReviewSyncItem(item, errorMessage = '') {
  return item?.table === 'update_booking' && isBookingUpdateConflictError(errorMessage)
}

function isPosCreateOrderQueueItem(item) {
  return item?.type === 'rpc' && item?.table === 'create_pos_order'
}

function getQueuedPosOrderId(item) {
  const payloadId = String(item?.data?.payload?.id || '').trim()
  if (payloadId) return payloadId

  const queueId = String(item?._queue_id || '').trim()
  if (queueId.startsWith('pos-order-')) {
    const parsedId = queueId.slice('pos-order-'.length).trim()
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
  return getSyncItemEntityId(item, 'quotation')
}

function getSyncItemScope(item) {
  const bookingId = getSyncItemBookingId(item)
  if (bookingId) return `booking:${bookingId}`
  const posOrderId = getQueuedPosOrderId(item)
  if (posOrderId) return `pos-order:${posOrderId}`
  return item?.table || 'unknown'
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
  if (existing._sync_state === 'synced' && patch._sync_state !== 'failed') {
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

function isRoomConflictError(message = '') {
  return /no_overlapping_bookings|room is already booked|room.*conflict/i.test(String(message || ''))
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

function markClearedSyncItemForManualReview(item) {
  const manualReviewMessage = `${item?.table || 'sync item'} was cleared from failed sync without server confirmation. Review manually before trusting local data.`
  const customerId = getSyncItemCustomerId(item)
  if (customerId && /customer/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedCustomerSyncState(customerId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    })
    return
  }
  const roomId = getSyncItemRoomId(item)
  if (roomId && /room/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedRoomSyncState(roomId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    })
    return
  }
  const userId = getSyncItemUserId(item)
  if (userId && /user/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedUserSyncState(userId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    })
    return
  }
  const quotationId = getSyncItemQuotationId(item)
  if (quotationId && /quotation/i.test(String(item?.table || item?._queue_id || ''))) {
    patchCachedQuotationSyncState(quotationId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    })
    return
  }
  const bookingId = getSyncItemBookingId(item)
  if (bookingId) {
    patchCachedBookingSyncState(bookingId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    })
    return
  }
  const posOrderId = getQueuedPosOrderId(item)
  if (posOrderId) {
    patchCachedPosOrderSyncState(posOrderId, {
      _pending_sync: true,
      _sync_state: 'manual_review_required',
      _sync_error: manualReviewMessage
    })
  }
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
      'create_booking_record'
    ]).has(item.table)
  }
  return item?.table === 'bookings'
}

function queueItemNeedsInventoryRefresh(item) {
  if (!isPosCreateOrderQueueItem(item)) return false
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
  const payloadId = item?.data?.payload?.id || item?.data?.p_booking_id || null
  if (!payloadId) return false

  const code = String(errorOrMessage?.code || '').trim()
  const message = getErrorMessage(errorOrMessage)
  return SYNC_ALREADY_APPLIED_CODES.has(code)
    || /duplicate key|unique constraint|already exists|already applied|23505/i.test(message)
}

async function processSyncQueue() {
  if (syncInProgress) return { success: false, skipped: true, error: 'Sync is already in progress.' }
  // P0-5: Never replay queued operations before a real user session is confirmed.
  // Offline financial RPCs carry lodge-scoped auth; replaying them before the
  // correct Supabase client/session is restored can poison data or fail silently.
  if (!replayAuthReady) {
    console.warn('[Sync] processSyncQueue skipped — replayAuthReady is false (no authenticated session yet)')
    writeSyncMeta({ replayAuthNotReadyAt: new Date().toISOString() })
    return { success: false, skipped: true, error: 'No authenticated session — please log in first.' }
  }
  syncInProgress = true
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
    syncInProgress = false
    broadcastSyncStatus()
  }
}

async function _runSyncQueue() {
  await requeueEligibleFailedSyncItems()
  let queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'))
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
    const nextIndex = pickNextReadySyncItemIndex(pending, completedQueueIds, failedQueueIds)
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
    try {
      if (item.type === 'insert') {
        const payload = {
          ...item.data,
          lodge_id: item.data.lodge_id || lodgeId
        }

        const { data, error } = await supabase
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
        const itemLodgeId = item.data?.lodge_id || item.lodge_id || lodgeId
        const { data: updData, error: updError } = await supabase
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
        const itemLodgeId = item.data?.lodge_id || item.lodge_id || lodgeId
        ;({ error: supabaseError } = await supabase.from(item.table).delete().eq('id', item.id).eq('lodge_id', itemLodgeId))
      } else if (item.type === 'rpc') {
        const { data, error } = await supabase.rpc(item.table, item.data)
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
      const retryCount = (item.retryCount || 0) + 1
      const manualReviewOnly = shouldManualReviewSyncItem(item, errorMessage) || (isCreateBookingQueueItem(item) && isRoomConflictError(errorMessage)) || item.manualRetryOnly === true
      const updatedItem = {
        ...item,
        _state: 'pending',   // reset from in_flight
        retryCount: manualReviewOnly ? MAX_SYNC_RETRIES : retryCount,
        lastError: errorMessage,
        lastAttemptedAt: new Date().toISOString(),
        manualRetryOnly
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
      if (queueItemNeedsInventoryRefresh(item)) shouldRefreshInventory = true
      if (queueItemNeedsBookingRefresh(item)) shouldRefreshBookings = true
      // P1-8: widen refresh to cover all domains touched by this operation
      if (item.type === 'rpc' && ['create_customer', 'update_customer'].includes(item.table)) shouldRefreshCustomers = true
      if (item.table === 'rooms' || (item.type === 'rpc' && item.table?.startsWith?.('update_room'))) shouldRefreshRooms = true
      if (item.type === 'rpc' && ['create_user', 'update_user_profile', 'set_user_pwa_access'].includes(item.table)) shouldRefreshUsers = true
      if (item.type === 'rpc' && ['create_quotation', 'update_quotation', 'convert_quotation'].includes(item.table)) shouldRefreshQuotations = true
      if (isPosCreateOrderQueueItem(item)) shouldRefreshPosOrders = true
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
    lastSuccessfulSyncAt = syncFinishedAt
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
          map[b.id] = { total_amount: b.total_amount, amount_paid: b.amount_paid, status: b.status, payment_status: b.payment_status }
          return map
        }, {})
    : null

  // P1-8: widen canonical post-sync refresh
  const refreshTargets = []
  if (successCount > 0 && shouldRefreshBookings)   refreshTargets.push('bookings')
  if (successCount > 0 && shouldRefreshCustomers)  refreshTargets.push('customers')
  if (successCount > 0 && shouldRefreshRooms)      refreshTargets.push('rooms')
  if (successCount > 0 && shouldRefreshUsers)      refreshTargets.push('users')
  if (successCount > 0 && shouldRefreshQuotations) refreshTargets.push('quotations')
  if (successCount > 0 && shouldRefreshPosOrders)  refreshTargets.push('pos-orders')
  if (successCount > 0 && shouldRefreshConference) refreshTargets.push('conference-bookings')
  if (successCount > 0 && shouldRefreshPoolDayUse)  refreshTargets.push('pool-day-use')
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
        if (!valuesEqualForDrift(pre.customer_id, b.customer_id)) drifts.push(`customer_id: local ${pre.customer_id} → server ${b.customer_id}`)
        if (!valuesEqualForDrift(pre.room_id, b.room_id)) drifts.push(`room_id: local ${pre.room_id} → server ${b.room_id}`)
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
    const deadPath = path.join(cacheDir, 'sync-failed.json')
    const deadTmp  = deadPath + '.tmp'
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

export function getSyncStatus() {
  const queue = readSyncQueue()
  const failed = readFailedSyncQueue()
  const faults = readHealthFaults()
  const syncMeta = readSyncMeta()
  const financialTables = new Set(['create_booking', 'create_booking_record', 'update_booking', 'update_booking_status', 'update_booking_payment'])
  const extractBookingId = (item) => (
    item?.data?.p_booking_id
    || item?.data?.payload?.booking_id
    || item?.data?.payload?.id
    || item?.data?.p_id
    || null
  )
  const failedBookingIds = failed
    .filter(item => ['create_booking', 'create_booking_record', 'update_booking'].includes(item.table))
    .map(item => item.data?.p_booking_id || item.data?.payload?.id || item.data?.p_id)
    .filter(Boolean)
  const financialPendingBookingIds = [...new Set(
    queue
      .filter((item) => financialTables.has(item?.table))
      .map(extractBookingId)
      .filter(Boolean)
  )]
  const financialFailedBookingIds = [...new Set(
    failed
      .filter((item) => financialTables.has(item?.table))
      .map(extractBookingId)
      .filter(Boolean)
  )]
  // P0-1: lastSuccessfulSyncAt from memory first, fall back to persisted meta
  const resolvedLastSync = lastSuccessfulSyncAt || syncMeta.lastSuccessfulSyncAt || null
  return {
    pending: queue.length,
    failed: failed.length,
    // P0-2: named fields as specified
    currentQueueLength: queue.length,
    currentDeadLetterWrites: failed.length,
    isOnline,
    // P0-2: expose replay in-progress state
    syncInProgress,
    replayAuthReady,
    failedBookingIds,
    financialPendingBookingIds,
    financialFailedBookingIds,
    financialPendingCount: financialPendingBookingIds.length,
    financialFailedCount: financialFailedBookingIds.length,
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
      active: syncRefreshState.stale,
      names: syncRefreshState.names,
      attempts: syncRefreshState.attempts,
      lastError: syncRefreshState.lastError,
      lastFailedAt: syncRefreshState.lastFailedAt
    }
  }
}

function readFailedSyncQueue() {
  if (!cacheDir) return []
  const filePath = path.join(cacheDir, 'sync-failed.json')
  const tmpPath  = filePath + '.tmp'
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
  if (!cacheDir) return
  const filePath = path.join(cacheDir, 'sync-failed.json')
  const tmpPath  = filePath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(Array.isArray(items) ? items : [], null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
  } catch (e) {
    console.error('[Sync] Failed-queue write failed:', e)
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

// ─── SYNC META (P0-1) ─────────────────────────────────────────────────────────
// Persists sync recency data to disk so it survives app restarts.

function readSyncMeta() {
  if (!cacheDir) return {}
  try {
    const raw = fs.readFileSync(path.join(cacheDir, SYNC_META_FILE), 'utf-8')
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

function writeSyncMeta(updates = {}) {
  if (!cacheDir) return
  const filePath = path.join(cacheDir, SYNC_META_FILE)
  const tmpPath  = filePath + '.tmp'
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

// ─── HEALTH FAULTS (P0-4) ─────────────────────────────────────────────────────
// Structured corruption / integrity alerts that survive restarts.

function appendHealthFault(fault = {}) {
  if (!cacheDir) return
  const filePath = path.join(cacheDir, HEALTH_FAULTS_FILE)
  const tmpPath  = filePath + '.tmp'
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

function readHealthFaults() {
  if (!cacheDir) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cacheDir, HEALTH_FAULTS_FILE), 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function clearHealthFault(id) {
  if (!cacheDir) return { success: true, remaining: 0 }
  const filePath = path.join(cacheDir, HEALTH_FAULTS_FILE)
  const tmpPath  = filePath + '.tmp'
  try {
    const faults = readHealthFaults()
    const next = id ? faults.filter((f) => f.id !== id) : []
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8')
    fs.renameSync(tmpPath, filePath)
    return { success: true, remaining: next.length }
  } catch (e) {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
    return { success: false, error: e.message }
  }
}

// ─── CACHE FRESHNESS READER (P1-9) ────────────────────────────────────────────

function readCacheFreshness() {
  if (!cacheDir) return {}
  try {
    const raw = fs.readFileSync(path.join(cacheDir, CACHE_FRESHNESS_FILE), 'utf-8')
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

export function getSyncDetails() {
  const pending = readSyncQueue()
  const failed = readFailedSyncQueue()
  const faults = readHealthFaults()
  const syncMeta = readSyncMeta()
  const cacheFreshness = readCacheFreshness()
  const resolvedLastSync = lastSuccessfulSyncAt || syncMeta.lastSuccessfulSyncAt || null
  const now = Date.now()

  const enrichPending = (item) => ({
    ...item,
    isFinancial: isFinancialSyncItem(item),
    dependencyState: item?._depends_on
      ? failed.some((f) => f?._queue_id === item._depends_on)
        ? 'failed_parent'
        : pending.some((p) => p?._queue_id === item._depends_on)
          ? 'waiting_for_parent'
          : 'ready_or_external'
      : 'none'
  })

  // P1-11: enrich failed items with retry classification and timing
  const enrichFailed = (item) => {
    const attemptedAtMs = item.lastAttemptedAt ? Date.parse(item.lastAttemptedAt) : NaN
    const ageMs = Number.isNaN(attemptedAtMs) ? null : now - attemptedAtMs
    const isAutoRetryable = item.manualRetryOnly !== true
    const nextAutoRetryAt = isAutoRetryable && !Number.isNaN(attemptedAtMs)
      ? new Date(attemptedAtMs + DEAD_LETTER_AUTO_RETRY_AFTER_MS).toISOString()
      : null
    const autoRetryEligible = isAutoRetryable && (Number.isNaN(attemptedAtMs) || ageMs >= DEAD_LETTER_AUTO_RETRY_AFTER_MS)
    return {
      ...item,
      isFinancial: isFinancialSyncItem(item),
      isAutoRetryable,
      nextAutoRetryAt,
      autoRetryEligible,
      ageMs
    }
  }

  // P1-10: financial entity IDs
  const financialTables = new Set(['create_booking', 'create_booking_record', 'update_booking', 'update_booking_status', 'update_booking_payment'])
  const extractBookingId = (item) => (
    item?.data?.p_booking_id || item?.data?.payload?.booking_id || item?.data?.payload?.id || item?.data?.p_id || null
  )
  const financialPendingBookingIds = [...new Set(pending.filter((i) => financialTables.has(i?.table)).map(extractBookingId).filter(Boolean))]
  const financialFailedBookingIds  = [...new Set(failed.filter((i) => financialTables.has(i?.table)).map(extractBookingId).filter(Boolean))]
  const unresolvedLocal = [
    ...readCache('bookings').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'booking', id: row.id, sync_state: row._sync_state || 'pending' })),
    ...readCache('customers').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'customer', id: row.id, sync_state: row._sync_state || 'pending' })),
    ...readCache('rooms').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'room', id: row.id, sync_state: row._sync_state || 'pending' })),
    ...readCache('users').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'user', id: row.id, sync_state: row._sync_state || 'pending' })),
    ...readCache('quotations').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'quotation', id: row.id, sync_state: row._sync_state || 'pending' })),
    ...readCache('pos-orders').filter((row) => row?._pending_sync || row?._sync_state === 'manual_review_required').map((row) => ({ type: 'pos-order', id: row.id, sync_state: row._sync_state || 'pending' }))
  ]

  // P1-9: annotate cache freshness with human-readable age
  const enrichedCacheFreshness = Object.fromEntries(
    Object.entries(cacheFreshness).map(([name, meta]) => {
      const updatedAtMs = meta?.updatedAt ? Date.parse(meta.updatedAt) : NaN
      const cacheAgeMs  = Number.isNaN(updatedAtMs) ? null : now - updatedAtMs
      return [name, { ...meta, cacheAgeMs, stale: cacheAgeMs != null && cacheAgeMs > 24 * 60 * 60 * 1000 }]
    })
  )

  return {
    isOnline,
    syncInProgress,
    replayAuthReady,
    pendingCount: pending.length,
    failedCount: failed.length,
    lastSuccessfulSyncAt: resolvedLastSync,
    syncMeta: {
      lastSyncStartedAt: syncMeta.lastSyncStartedAt || null,
      lastSyncFinishedAt: syncMeta.lastSyncFinishedAt || null,
      lastSyncOutcome: syncMeta.lastSyncOutcome || null,
      lastSyncError: syncMeta.lastSyncError || ''
    },
    financialPendingBookingIds,
    financialFailedBookingIds,
    unresolvedLocal,
    financialPendingCount: financialPendingBookingIds.length,
    financialFailedCount: financialFailedBookingIds.length,
    pending: pending.map(enrichPending),
    failed: failed.map(enrichFailed),
    faults,
    cacheFreshness: enrichedCacheFreshness,
    cacheStale: {
      active: syncRefreshState.stale,
      names: syncRefreshState.names,
      attempts: syncRefreshState.attempts,
      lastError: syncRefreshState.lastError,
      lastFailedAt: syncRefreshState.lastFailedAt
    }
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

    const cleanItem = {
      ...item,
      _state: 'pending',
      retryCount: 0,
      lastError: '',
      lastAttemptedAt: null
    }

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

export async function retrySyncItems(queueIds = []) {
  const failed = readFailedSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'))
  const targetIds = new Set((queueIds || []).filter(Boolean))
  const shouldRetryAll = targetIds.size === 0
  const retryItems = failed.filter((item) => shouldRetryAll || targetIds.has(item._queue_id))
  if (retryItems.length === 0) return { success: true, retried: 0, remaining: failed.length }

  const keepFailed = failed.filter((item) => !retryItems.some((entry) => entry._queue_id === item._queue_id))
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'))
  const existingIds = new Set(queue.map((item) => item._queue_id))
  for (const item of retryItems) {
    const cleanItem = {
      ...item,
      retryCount: Math.max(0, Number(item.retryCount || 1) - 1),
      lastError: '',
      lastAttemptedAt: null
    }
    if (isPosCreateOrderQueueItem(cleanItem)) {
      const orderId = getQueuedPosOrderId(cleanItem)
      if (orderId) {
        console.log('[POS SYNC] Retrying order', orderId)
        patchCachedPosOrderSyncState(orderId, {
          _sync_state: 'pending',
          _sync_error: null
        })
      }
    }
    if (!existingIds.has(cleanItem._queue_id)) queue.push(cleanItem)
  }
  writeFailedSyncQueue(keepFailed)
  writeSyncQueue(queue)
  if (isOnline) await processSyncQueue()
  return { success: true, retried: retryItems.length, remaining: keepFailed.length }
}

export function clearSyncFailed(queueIds = []) {
  const failed = readFailedSyncQueue()
  const targetIds = new Set((queueIds || []).filter(Boolean))
  const shouldClearAll = targetIds.size === 0
  const itemsToRemove = shouldClearAll
    ? failed
    : failed.filter((item) => targetIds.has(item?._queue_id))

  // P1-12: Before discarding dead letters, preserve unresolved-local-state evidence
  // so a clear action cannot falsely imply reconciliation is complete.
  const financialCleared = itemsToRemove.filter((item) => isFinancialSyncItem(item))
  let integrityAlertsRecorded = 0
  for (const item of itemsToRemove) {
    markClearedSyncItemForManualReview(item)
    const isFinancial = isFinancialSyncItem(item)
    appendHealthFault({
      type: isFinancial ? 'financial_dead_letter_cleared' : 'dead_letter_cleared',
      scope: getSyncItemScope(item),
      severity: isFinancial ? 'error' : 'warn',
      message: `${isFinancial ? 'Financial' : 'Sync'} dead-lettered operation was manually cleared without remote confirmation. Operation: ${item.table}, Queue ID: ${item._queue_id}, Last error: ${item.lastError || 'unknown'}. Verify manually that this was handled.`,
      at: new Date().toISOString(),
      context: {
        queue_id: item?._queue_id || null,
        table: item?.table || null,
        booking_id: getSyncItemBookingId(item),
        pos_order_id: getQueuedPosOrderId(item),
        last_error: item?.lastError || '',
        is_financial: isFinancial
      }
    })
    integrityAlertsRecorded++
    console.warn('[Sync] Dead letter cleared without remote confirmation:', item._queue_id, item.table)
  }

  const remaining = failed.filter((item) => !itemsToRemove.some((r) => r?._queue_id === item?._queue_id))
  writeFailedSyncQueue(remaining)
  broadcastSyncStatus()
  return {
    success: true,
    removed: failed.length - remaining.length,
    financialCleared: financialCleared.length,
    integrityAlertsRecorded,
    remaining: remaining.length
  }
}

// P0-6 / P1-11: Run sync immediately regardless of connectivity transition.
// Called from the "Run Sync Now" button in System Health, and by the periodic timer.
export async function runSyncNow() {
  if (!isOnline) {
    await checkOnline()
  }
  if (!isOnline) return { success: false, error: 'Offline — cannot sync right now.' }
  if (!replayAuthReady) return { success: false, error: 'No authenticated session — please log in first.' }
  await requeueEligibleFailedSyncItems()
  const result = await processSyncQueue()
  return result?.success === false ? result : { success: true }
}

function queueOperation(type, table, data, id = null, meta = {}) {
  const queue = readSyncQueue().map((item) => ensureQueuedItem(item, item?.type || 'op'))
  const derivedMeta = {
    ...(type === 'rpc' && table === 'create_quotation' && data?.payload?.id
      ? { _queue_id: `quotation-${data.payload.id}` }
      : {}),
    ...meta
  }
  // Guardrail: create_quotation defaults to _queue_id: `quotation-${record.id}`.
  const queuedItem = ensureQueuedItem({
    type,
    table,
    data,
    id,
    timestamp: new Date().toISOString(),
    ...derivedMeta
  }, type)

  // Deduplication: skip if an identical RPC with same idempotency key is already queued
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

// ─── ACTIVITY LOG ─────────────────────────────────────────────────────────────

function logActivity(action, description) {
  try {
    const logPath = path.join(cacheDir, 'activity-log.json')
    let log = []
    try { log = JSON.parse(fs.readFileSync(logPath, 'utf-8')) } catch { /* empty */ }

    log.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      action,
      description,
      user_id: currentUser?.id || null,
      user_name: currentUser?.name || 'System'
    })

    if (log.length > 500) log = log.slice(0, 500)
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8')
  } catch (e) {
    console.error('Activity log write failed:', e)
  }
}

export function recordActivity(action, description) {
  logActivity(action, description)
}

function getLocalDateKey(value = new Date(), timeZone = LOCAL_TIME_ZONE) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(value)
  } catch {
    return new Date(value).toISOString().slice(0, 10)
  }
}

function readAuxiliaryLog(filename) {
  try {
    if (!cacheDir) return []
    const fullPath = path.join(cacheDir, filename)
    if (!fs.existsSync(fullPath)) return []
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAuxiliaryLog(filename, rows) {
  try {
    if (!cacheDir) return
    fs.writeFileSync(path.join(cacheDir, filename), JSON.stringify(rows, null, 2), 'utf-8')
  } catch (error) {
    console.error(`Auxiliary log write failed (${filename}):`, error)
  }
}

function appendAuxiliaryLog(filename, row, limit = 200) {
  const current = readAuxiliaryLog(filename)
  current.unshift(row)
  writeAuxiliaryLog(filename, current.slice(0, limit))
}

function recordCriticalError(scope, error, details = {}, { limit = 300, level = 'error' } = {}) {
  const message = error?.message || String(error || 'Unknown error')
  const row = {
    id: randomUUID(),
    at: new Date().toISOString(),
    scope,
    level,
    message,
    user_id: currentUser?.id || null,
    user_name: currentUser?.name || null,
    lodge_id: lodgeId || null,
    details
  }
  appendAuxiliaryLog(CRITICAL_ERROR_LOG_FILE, row, limit)
  const logger = level === 'warn' ? console.warn : console.error
  logger(`[APP ${scope}]`, message, details)
  return row
}

export function getActivityLog(limit = 200) {
  try {
    const logPath = path.join(cacheDir, 'activity-log.json')
    const log = JSON.parse(fs.readFileSync(logPath, 'utf-8'))
    return log.slice(0, limit)
  } catch {
    return []
  }
}

export function clearActivityLog() {
  try {
    fs.writeFileSync(path.join(cacheDir, 'activity-log.json'), '[]', 'utf-8')
  } catch (e) {
    console.error('Clear activity log failed:', e)
  }
}

// ─── AUTO BACKUP ──────────────────────────────────────────────────────────────

function createBackup() {
  try {
    if (!lodgeId) return
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups')
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupPath = path.join(backupDir, `backup-${ts}.json`)

    const users = readCache('users').map(({ password_hash, ...u }) => u)

    const backup = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      lodge_id: lodgeId,
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

export function getManagedBackupPolicy() {
  return normalizeManagedBackupPolicy(readJsonFile(getManagedBackupPolicyPath(), BACKUP_POLICY_DEFAULT))
}

export function saveManagedBackupPolicy(updates = {}) {
  const current = getManagedBackupPolicy()
  const next = normalizeManagedBackupPolicy({ ...current, ...updates })
  writeJsonFile(getManagedBackupPolicyPath(), next)
  return buildManagedBackupStatus(next)
}

export function recordManagedBackupRun(result = {}) {
  const current = getManagedBackupPolicy()
  const now = new Date().toISOString()
  const next = normalizeManagedBackupPolicy({
    ...current,
    last_run_at: now,
    last_success_at: result.success ? now : current.last_success_at,
    last_error: result.success ? '' : String(result.error || 'Managed backup failed.'),
    last_json_path: result.jsonPath || current.last_json_path,
    last_excel_path: result.excelPath || current.last_excel_path
  })
  writeJsonFile(getManagedBackupPolicyPath(), next)
  return buildManagedBackupStatus(next)
}

export function getBackupInfo() {
  try {
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups')
    if (!fs.existsSync(backupDir)) return { backupDir, backups: [], policy: buildManagedBackupStatus(getManagedBackupPolicy()) }

    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 10)

    const backups = files.map((f) => {
      const stats = fs.statSync(path.join(backupDir, f))
      return { name: f, size: stats.size, created: stats.mtime.toISOString() }
    })

    return { backupDir, backups, policy: buildManagedBackupStatus(getManagedBackupPolicy()) }
  } catch {
    return { backupDir: '', backups: [], policy: buildManagedBackupStatus(getManagedBackupPolicy()) }
  }
}

async function buildExpandedBackupPayload() {
  if (!lodgeId) throw new Error('No lodge profile selected')
  const [
    settings,
    rooms,
    customers,
    bookings,
    quotations,
    expenses,
    maintenance,
    bookingInvoices,
    conferenceBookings,
    dayUseEntries
  ] = await Promise.all([
    getSettings().catch(() => ({})),
    getAllRooms().catch(() => []),
    getAllCustomers().catch(() => []),
    getAllBookings().catch(() => []),
    getAllQuotations().catch(() => []),
    getExpenses('2000-01-01', '2099-12-31').catch(() => []),
    getMaintenanceTickets().catch(() => []),
    getBookingInvoices().catch(() => []),
    getConferenceBookings('2000-01-01', '2099-12-31').catch(() => []),
    getPoolDayUse('2000-01-01', '2099-12-31').catch(() => [])
  ])

  const inventoryItems = await getInventoryItems().catch(() => [])
  const supplyItems = await getSupplyItems().catch(() => [])
  const posOrders = await getPosOrders('2000-01-01', '2099-12-31').catch(() => [])

  const inventoryPurchases = []
  for (const item of inventoryItems) {
    const purchases = await getInventoryPurchases(item.id).catch(() => [])
    inventoryPurchases.push(...(purchases || []).map((purchase) => ({
      ...purchase,
      item_name: item.name || item.item_name || ''
    })))
  }

  const supplyPurchases = []
  for (const item of supplyItems) {
    const purchases = await getSupplyPurchases(item.id).catch(() => [])
    supplyPurchases.push(...(purchases || []).map((purchase) => ({
      ...purchase,
      item_name: item.name || item.item_name || ''
    })))
  }

  const backup = {
    timestamp: new Date().toISOString(),
    version: '2.0',
    lodge_id: lodgeId,
    mode: 'manual-expanded',
    tables: {
      settings,
      rooms,
      customers,
      bookings,
      quotations,
      booking_invoices: bookingInvoices,
      expenses,
      maintenance,
      pos_orders: posOrders,
      inventory_items: inventoryItems,
      inventory_purchases: inventoryPurchases,
      supply_items: supplyItems,
      supply_purchases: supplyPurchases,
      conference_bookings: conferenceBookings,
      pool_day_use: dayUseEntries,
      sync_status: getSyncStatus()
    }
  }

  return backup
}

export async function writeExpandedBackupToPath(filePath) {
  const backup = await buildExpandedBackupPayload()
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2), 'utf-8')
  return { success: true, filePath }
}

export async function createManualBackup() {
  if (!lodgeId) throw new Error('No lodge profile selected')
  const backupDir = path.join(app.getPath('userData'), 'boroko-backups')
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupPath = path.join(backupDir, `manual-backup-${ts}.json`)
  return await writeExpandedBackupToPath(backupPath)
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

export async function initDatabase() {
  cacheRootDir = path.join(app.getPath('userData'), 'boroko-cache')
  profilesCacheDir = path.join(cacheRootDir, 'profiles')
  initializeProfileRuntime()

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'VITE_SUPABASE_URL or VITE_SUPABASE_KEY is missing.\n' +
      'Create a root .env file with both variables, then re-run the app.\n' +
      'See .env.example for the required format.'
    )
  }
  supabase = buildSupabaseClient(SUPABASE_ANON_KEY)

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (serviceKey) {
    adminDb = buildSupabaseClient(serviceKey)
    console.log('[Auth] SUPABASE_SERVICE_ROLE_KEY found — Command Central admin mode enabled')
  } else {
    adminDb = null
    console.log('[Auth] No SUPABASE_SERVICE_ROLE_KEY — running in lodge-only mode')
  }

  // P0-1: restore persisted sync recency so System Health has real data immediately
  if (cacheDir) {
    const meta = readSyncMeta()
    if (meta.lastSuccessfulSyncAt && !lastSuccessfulSyncAt) {
      lastSuccessfulSyncAt = meta.lastSuccessfulSyncAt
    }
  }

  // P0-5: replayAuthReady stays false until a real user logs in.
  // Startup sync is intentionally skipped — we must not replay queued financial
  // operations before the correct Supabase client is authenticated.
  const online = await checkOnline()
  if (online && lodgeId) {
    // Only refresh caches at startup (safe read-only — does not replay writes)
    await refreshAllCaches()
    console.log('Connected to Supabase ✓ (replay deferred until user authenticates)')
  } else {
    console.log('Running in offline mode — using cached data')
  }

  if (!backupIntervalStarted) {
    backupIntervalStarted = true

    createBackup()
    setInterval(() => createBackup(), 60 * 60 * 1000)

    // Reconnect detection: fires sync on network return
    setInterval(async () => {
      try {
        const wasOffline = !isOnline
        const nowOnline = await checkOnline()
        if (wasOffline && nowOnline && lodgeId) {
          console.log('Back online — syncing changes...')
          await requeueEligibleFailedSyncItems()
          await processSyncQueue()
          await refreshAllCaches()
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
      }
    }, 30000)

    // P0-6: Periodic sync — ensures retryable dead letters are replayed even when
    // the app never transitions offline→online (i.e., stays continuously online).
    setInterval(async () => {
      try {
        if (!isOnline || !lodgeId || !replayAuthReady) return
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

export function getProfiles() {
  const registry = readProfilesRegistry()
  return registry.profiles.map((profile) => ({
    ...profile,
    active: profile.lodge_id === registry.active_lodge_id
  }))
}

export function getActiveProfile() {
  const registry = readProfilesRegistry()
  const active = registry.profiles.find((profile) => profile.lodge_id === registry.active_lodge_id)
  return active || null
}

export async function selectProfile(targetLodgeId) {
  const normalizedId = normalizeLodgeId(targetLodgeId)
  const registry = readProfilesRegistry()
  const profile = registry.profiles.find((entry) => entry.lodge_id === normalizedId)
  if (!profile) throw new Error('That lodge profile was not found on this computer.')

  currentUser = null
  replayAuthReady = false   // P0-5: profile switch = new auth context required
  clearBackendSession()
  setRuntimeActiveProfile(normalizedId, { persistActive: true, touch: true })
  ensureProfileCacheFiles(normalizedId)

  // Restore persisted sync meta for the new profile
  if (cacheDir) {
    const meta = readSyncMeta()
    lastSuccessfulSyncAt = meta.lastSuccessfulSyncAt || null
  }

  await checkOnline()
  if (isOnline) {
    // Only refresh caches on profile switch — replay deferred until user logs in
    await refreshAllCaches()
  }

  return {
    ...getActiveProfile(),
    settings: await getSettings()
  }
}

export async function createDraftProfile() {
  const draftLodgeId = randomUUID()
  const draftProfile = sanitizeProfile({
    lodge_id: draftLodgeId,
    label: 'New Lodge',
    status: PROFILE_STATUS.DRAFT,
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString()
  })

  const registry = readProfilesRegistry()
  const nextProfiles = registry.profiles.filter((profile) => profile.lodge_id !== draftLodgeId)
  nextProfiles.unshift(draftProfile)
  writeProfilesRegistry({
    active_lodge_id: draftLodgeId,
    profiles: nextProfiles
  })

  setRuntimeActiveProfile(draftLodgeId, { persistActive: false, touch: false })
  ensureProfileCacheFiles(draftLodgeId)
  clearCache('users')
  clearCache('rooms')
  clearCache('customers')
  clearCache('bookings')
  clearCache('quotations')
  clearCache('settings')
  clearCache('trial_status', null)
  clearActivityLog()
  writeAuthCache([])
  writeSyncQueue([])
  writeFailedSyncQueue([])
  clearBackendSession()
  clearSessionNonce()

  return draftProfile
}

export async function removeDraftProfile(targetLodgeId) {
  const normalizedId = normalizeLodgeId(targetLodgeId)
  const registry = readProfilesRegistry()
  const profile = registry.profiles.find((entry) => entry.lodge_id === normalizedId)
  if (!profile) throw new Error('That lodge profile was not found on this computer.')
  if (profile.status !== PROFILE_STATUS.DRAFT) {
    throw new Error('Only incomplete draft lodge profiles can be removed.')
  }

  const draftCacheDir = getProfileCacheDir(normalizedId)
  const draftQueue = readJsonFile(path.join(draftCacheDir, 'sync-queue.json'), [])
  if (Array.isArray(draftQueue) && draftQueue.length > 0) {
    const err = new Error(`This draft lodge has ${draftQueue.length} unsynced offline change(s).`)
    err.code = 'draft_profile_blocked_by_unsynced_changes'
    throw err
  }

  await checkOnline()
  if (isOnline) {
    const { data: remoteSettings } = await supabase
      .from('settings')
      .select('setup_complete')
      .eq('lodge_id', normalizedId)
      .maybeSingle()

    if (remoteSettings?.setup_complete === true) {
      const err = new Error('This lodge profile is already linked to a completed company in Supabase and cannot be removed as a draft.')
      err.code = 'remote_lodge_already_exists'
      throw err
    }
  }

  try { fs.rmSync(draftCacheDir, { recursive: true, force: true }) } catch {}

  const remainingProfiles = registry.profiles.filter((entry) => entry.lodge_id !== normalizedId)
  const nextActiveId = registry.active_lodge_id === normalizedId
    ? remainingProfiles[0]?.lodge_id || null
    : registry.active_lodge_id

  writeProfilesRegistry({
    active_lodge_id: nextActiveId,
    profiles: remainingProfiles
  })

  currentUser = null
  clearBackendSession()
  setRuntimeActiveProfile(nextActiveId, { persistActive: false, touch: false })
  if (nextActiveId && isOnline) {
    await refreshAllCaches()
  }

  return {
    success: true,
    active_profile: getActiveProfile(),
    profiles: getProfiles()
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

// ─── LOCAL TRUSTED DEVICE CACHE ───────────────────────────────────────────────
// The app no longer treats this device as a password verifier. Offline access is
// restored through the signed-in session nonce below; legacy password hashes are
// kept only so older installs can be diagnosed and phased out safely.

function readAuthCache() {
  try { return JSON.parse(fs.readFileSync(path.join(cacheDir, 'auth-cache.json'), 'utf-8')) } catch { return [] }
}
function writeAuthCache(entries) {
  try { fs.writeFileSync(path.join(cacheDir, 'auth-cache.json'), JSON.stringify(entries, null, 2), 'utf-8') } catch {}
}
function removeAuthEntry(email) {
  const emailLower = normalizeEmail(email)
  const filtered = readAuthCache().filter(e => !(e.email === emailLower && e.lodge_id === lodgeId))
  writeAuthCache(filtered)
}
function upsertAuthEntry(email, passwordHash) {
  const emailLower = normalizeEmail(email)
  const entries = readAuthCache().filter(e => !(e.email === emailLower && e.lodge_id === lodgeId))
  entries.push({ email: emailLower, lodge_id: lodgeId, password_hash: passwordHash, deprecated: true })
  writeAuthCache(entries)
}

// ─── SESSION NONCE (anti-impersonation) ─────────────────────────────────────
// A random nonce generated on successful login, persisted to a file only the
// main process can read. restoreUserSession() requires the correct nonce to
// prove the renderer legitimately logged in on a prior run.
// Identity is derived from the nonce file — the renderer cannot influence it.

// Offline-first front desks need a trusted device session that survives normal
// connectivity gaps without rechecking a password against Supabase every week.
const SESSION_NONCE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000 // 60 days

function getSessionNoncePath() {
  return path.join(cacheDir, 'session-nonce.json')
}

function getTrustedSessionsPath() {
  return path.join(cacheDir, 'trusted-sessions.json')
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
  try { fs.writeFileSync(getTrustedSessionsPath(), JSON.stringify(sessions, null, 2), 'utf-8') } catch {}
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
    lodge_id: normalizeLodgeId(record.lodge_id || lodgeId),
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

export function createSessionNonce(user, password = '') {
  const nonce = crypto.randomBytes(32).toString('hex')
  writeSessionNonce(user, nonce, password)
  return nonce
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
  const mergedUser = mergeSessionUserScope(previous, { ...safeUser, lodge_id: safeUser.lodge_id || lodgeId })
  const next = existing.filter((entry) => entry.id !== safeUser.id && entry.email !== safeUser.email)
  next.push(mergedUser)
  writeCache('users', next)
}

async function cacheSuccessfulLogin(user, emailLower, password = null) {
  console.log('[AUTH] cache write start:', { email: emailLower, userId: user?.id, lodge_id: lodgeId })
  if (typeof password === 'string' && password) {
    const localHash = await bcrypt.hash(password, 10)  // legacy only, phased out by Supabase Auth
    upsertAuthEntry(emailLower, localHash)
  }
  upsertCachedUser(user)
  const authEntries = readAuthCache().filter((entry) => entry.email === emailLower && entry.lodge_id === lodgeId)
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
    .find((u) => u?.email === normalizedEmail && (u.lodge_id ? u.lodge_id === lodgeId : true))
}

function logAuthFailure(reason, details = {}) {
  console.warn('[AUTH] login failed:', {
    reason,
    lodge_id: lodgeId,
    email: details.email,
    online: isOnline,
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

function toSafeUser(user) {
  const {
    password_hash: _ph,
    session_token: _st,
    session_expires_at: _se,
    ...safeUser
  } = user
  return safeUser
}

async function findRemoteUsersByEmailForCurrentLodge(emailLower) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, role, lodge_id, created_at, name')
      .eq('email', emailLower)
      .eq('lodge_id', lodgeId)
      .limit(5)
    if (error) return []
    return (data || []).map(normalizeUserRecord).filter(Boolean)
  } catch {
    return []
  }
}

async function fetchAuthenticateUserContract(emailLower) {
  try {
    const authClient = buildSupabaseClient(SUPABASE_ANON_KEY)
    authTrace('auth client state', getAuthClientState('anon-health-probe', null, emailLower))
    const rpcArgs = {
      p_email: emailLower,
      p_lodge_id: lodgeId,
      p_password: null,       // health-check probe — no password, expect authenticated: false
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
        p_lodge_id: lodgeId,
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

async function getLodgeAuthContext(targetLodgeId = lodgeId) {
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
            p_lodge_id: lodgeId,
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
              p_lodge_id: lodgeId,
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
    lodge_id: lodgeId,
    rpc_error: rpcResult.error?.message || null,
    contract_ok: contract.ok,
    contract_reason: contract.reason || null,
    found: contract.row?.found ?? null,
    user_id: contract.row?.id || null
  })
  authTrace('db.loginUser online auth result', {
    email: emailLower,
    lodge_id: lodgeId,
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
      lodge_id: lodgeId,
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
      lodge_id: lodgeId,
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
  if (normalizeLodgeId(row.lodge_id) !== normalizeLodgeId(lodgeId)) {
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'authenticate_user_lodge_mismatch',
      email: emailLower,
      returned_lodge_id: row.lodge_id,
      expected_lodge_id: lodgeId
    })
    return {
      user: null,
      code: 'auth_failed_real',
      error: 'authenticate_user returned a lodge_id that does not match this device.',
      details: {
        source: 'authenticate_user_lodge_mismatch',
        returned_lodge_id: row.lodge_id,
        expected_lodge_id: lodgeId
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
      p_lodge_id: lodgeId,
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

async function createSupabaseAuthUserForStaff(emailLower, password) {
  if (!emailLower || !password) return null
  const metadata = {
    lodge_id: lodgeId,
    app: 'boroko-bookings'
  }

  if (adminDb) {
    try {
      const { data, error } = await adminDb.auth.admin.createUser({
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

export async function sendPasswordResetEmail(email) {
  const emailLower = normalizeEmail(email)
  if (!emailLower) throw new Error('Enter the email address for this account.')
  await checkOnline()
  if (!isOnline) throw new Error('Internet connection required to send a password reset email.')

  const authClient = buildSupabaseAuthClient()
  const options = getAuthRedirectUrl() ? { redirectTo: getAuthRedirectUrl() } : undefined
  const { error } = await authClient.auth.resetPasswordForEmail(emailLower, options)
  if (error) throw new Error(error.message || 'Could not send password reset email.')
  return {
    success: true,
    email: emailLower,
    redirect_url_configured: Boolean(getAuthRedirectUrl())
  }
}

export async function sendUserInviteOrReset(id) {
  const user = await getUserById(id)
  if (!user) throw new Error('Staff account not found.')
  const emailLower = normalizeEmail(user.email)
  if (!emailLower) throw new Error('Staff account is missing an email address.')
  await checkOnline()
  if (!isOnline) throw new Error('Internet connection required to send staff invites.')

  if (!user.auth_user_id) {
    const admin = requireAdmin()
    const { data, error } = await admin.auth.admin.inviteUserByEmail(emailLower, {
      data: {
        lodge_id: lodgeId,
        app_user_id: user.id,
        app: 'boroko-bookings'
      },
      redirectTo: getAuthRedirectUrl()
    })
    if (error) throw new Error(error.message || 'Could not send staff invite.')
    const authUserId = data?.user?.id || null
    if (authUserId) {
      const { error: linkError } = await admin
        .from('users')
        .update({ auth_user_id: authUserId })
        .eq('id', user.id)
        .eq('lodge_id', lodgeId)
      if (linkError) throw new Error(linkError.message || 'Invite sent, but the staff account could not be linked.')
      upsertCachedUser({ ...user, auth_user_id: authUserId })
    }
    logActivity('staff_invite_sent', `${user.name || emailLower} · Supabase Auth invite sent`)
    return {
      success: true,
      mode: 'invite',
      email: emailLower,
      auth_user_id: authUserId,
      redirect_url_configured: Boolean(getAuthRedirectUrl())
    }
  }

  const result = await sendPasswordResetEmail(emailLower)
  logActivity('staff_password_reset_sent', `${user.name || emailLower} · password reset email sent`)
  return {
    ...result,
    mode: 'reset'
  }
}

/**
 * Always tries Supabase Auth first (authoritative). The older authenticate_user RPC is
 * retained as a temporary migration fallback for accounts not yet linked to auth.users.
 * Offline password verification is intentionally disabled; offline reopen uses the
 * trusted session nonce created after a successful online sign-in.
 *
 * @returns {{ user: object | null, error?: string }}
 */
export async function loginUser(email, password) {
  authTrace('db.loginUser start', {
    email,
    normalizedEmail: normalizeEmail(email),
    lodge_id: lodgeId,
    passwordLength: typeof password === 'string' ? password.length : null,
    hasPassword: typeof password === 'string' ? password.length > 0 : false
  })
  console.log('\n[DB LOGIN ATTEMPT]')
  console.log('[DB LOGIN] lodgeId:', lodgeId)
  console.log('[DB LOGIN] email:', normalizeEmail(email))
  clearBackendSession()
  if (!lodgeId) {
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

  if (isOnline) {
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

      if (!authContext?.lodge_id || normalizeLodgeId(authContext.lodge_id) !== normalizeLodgeId(lodgeId)) {
        clearBackendSession()
        console.warn('[AUTH TRACE] schema error wrapper hit', {
          source: 'get_lodge_auth_context_mismatch',
          expected_lodge_id: lodgeId,
          returned_lodge_id: authContext?.lodge_id || null
        })
        const result = {
          user: null,
          code: 'auth_failed_real',
          error: 'get_lodge_auth_context returned a lodge_id that does not match this device.',
          details: {
            source: 'get_lodge_auth_context',
            expected_lodge_id: lodgeId,
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
      // Fetch outlet access for cashier/supervisor roles (non-breaking — new field)
      try {
        const { data: outletAccess } = await supabase.rpc('get_user_outlet_access', {
          p_user_id: online.user.id,
          p_lodge_id: lodgeId
        })
        if (outletAccess) {
          online.user.allowed_outlet_ids = outletAccess.allowed_outlet_ids || []
        }
      } catch {
        // Non-critical — default to empty array if RPC not yet deployed
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

// ─── USERS ────────────────────────────────────────────────────────────────────

export async function getAllUsers() {
  if (isOnline) {
    const { data } = await supabase
      .from('users')
      .select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids')
      .eq('lodge_id', lodgeId)
      .order('name')
    const normalized = (data || []).map(normalizeUserRecord).filter(Boolean)
    if (data) writeCache('users', normalized)
    return normalized
  }
  return readCache('users').map(normalizeUserRecord).filter(Boolean)
}

export async function getUsers() {
  return getAllUsers()
}

export async function getUserById(id) {
  if (!id) return null
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, auth_user_id, name, email, role, lodge_id, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by, allowed_outlet_ids')
      .eq('id', id)
      .eq('lodge_id', lodgeId)
      .single()
    if (error) throw error
    return normalizeUserRecord(data)
  } catch {
    return readCache('users').map(normalizeUserRecord).filter(Boolean).find((user) => user.id === id) || null
  }
}

export async function runAuthHealthCheck(email = '', options = {}) {
  authTrace('healthCheck start', { email: normalizeEmail(email), lodge_id: lodgeId })
  await checkOnline()
  if (!lodgeId) {
    const result = {
      ok: false,
      code: 'no_profile_selected',
      error: 'Choose a lodge profile on this computer before running the auth health check.',
      user: null,
      online: isOnline,
      lodge_id: null,
      contract_version: AUTH_CONTRACT_VERSION,
      settings_mode: null,
      checks: {
        lodge_id_is_uuid: false,
        settings_row_exists: false,
        settings_uses_uuid_contract: false,
        target_user_exists: false,
        authenticate_user_contract_valid: false
      }
    }
    authTrace('healthCheck return', result)
    return result
  }
  const emailLower = normalizeEmail(email)
  const expectedUserId = isUuid(options?.expectedUserId) ? options.expectedUserId : null
  const health = {
    ok: false,
    code: null,
    error: '',
    user: null,
    online: isOnline,
    lodge_id: lodgeId,
    contract_version: AUTH_CONTRACT_VERSION,
    settings_mode: null,
    checks: {
      lodge_id_is_uuid: isUuid(lodgeId),
      settings_row_exists: false,
      settings_uses_uuid_contract: false,
      target_user_exists: !emailLower,
      authenticate_user_contract_valid: false
    }
  }

  console.log('[AUTH HEALTH] start:', {
    email: emailLower || null,
    lodge_id: lodgeId,
    expected_user_id: expectedUserId
  })

  if (!health.checks.lodge_id_is_uuid) {
    health.code = 'invalid_lodge_id'
    health.error = 'This device is not linked to a valid UUID lodge ID.'
    authTrace('healthCheck return', health)
    return health
  }

  if (!isOnline) {
    health.code = 'offline'
    health.error = 'An internet connection is required to validate the desktop auth contract.'
    authTrace('healthCheck return', health)
    return health
  }

  try {
    const authContext = await getLodgeAuthContext()
    health.settings_mode = authContext ? 'lodge' : null
    health.checks.settings_row_exists = !!authContext
    health.checks.settings_uses_uuid_contract =
      isUuid(authContext?.lodge_id) &&
      normalizeLodgeId(authContext?.lodge_id) === normalizeLodgeId(lodgeId) &&
      Object.prototype.hasOwnProperty.call(authContext || {}, 'deleted')
  } catch (e) {
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'healthCheck_get_lodge_auth_context',
      message: e.message || null
    })
    health.code = isBackendAuthSchemaError(e.message || '') ? 'backend_auth_schema_outdated' : 'health_check_failed'
    health.error = isBackendAuthSchemaError(e.message || '')
      ? 'The backend lodge auth context schema is outdated for this desktop auth flow. Run the checked-in auth migrations, then try again.'
      : e.message
    authTrace('healthCheck return', health)
    return health
  }

  if (!health.checks.settings_uses_uuid_contract) {
    health.code = 'backend_auth_schema_outdated'
    health.error = 'This app now requires UUID-based lodge settings rows with the latest auth migrations applied.'
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_settings_contract_invalid', health })
    authTrace('healthCheck return', health)
    return health
  }

  const probeEmail = emailLower || '__auth_health_check__@invalid.local'
  const { rpcResult, contract } = await fetchAuthenticateUserContract(probeEmail)
  if (rpcResult?.error) {
    console.warn('[AUTH TRACE] schema error wrapper hit', {
      source: 'healthCheck_authenticate_user_rpc',
      message: rpcResult.error.message || null
    })
    health.code = isBackendAuthSchemaError(rpcResult.error.message || '') ? 'backend_auth_schema_outdated' : 'health_check_failed'
    health.error = isBackendAuthSchemaError(rpcResult.error.message || '')
      ? 'The canonical authenticate_user function is missing or outdated. Run the checked-in auth migrations, then try again.'
      : rpcResult.error.message
    authTrace('healthCheck return', health)
    return health
  }

  if (!contract.ok) {
    health.code = 'backend_auth_schema_outdated'
    health.error = 'The canonical authenticate_user function returned an outdated contract shape.'
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_authenticate_user_contract_invalid', contract })
    authTrace('healthCheck return', health)
    return health
  }

  const probeRow = contract.row
  if (normalizeLodgeId(probeRow.lodge_id) !== normalizeLodgeId(lodgeId)) {
    health.code = 'backend_auth_schema_outdated'
    health.error = 'The canonical authenticate_user function returned a lodge_id that does not match this device.'
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_authenticate_user_lodge_mismatch', probeRow, lodgeId })
    authTrace('healthCheck return', health)
    return health
  }

  if (emailLower) {
    if (probeRow.found) {
      health.checks.target_user_exists = true
      health.user = toSafeUser(probeRow)
    } else {
      if (expectedUserId) {
        health.code = 'health_check_failed'
        health.error =
          'The new admin account was created, but the canonical authenticate_user check could not verify it for this lodge.'
        authTrace('healthCheck return', health)
        return health
      }
      health.code = 'target_user_missing'
      health.error = 'The target user was not found for this lodge.'
      authTrace('healthCheck return', health)
      return health
    }

    if (expectedUserId && probeRow.id !== expectedUserId) {
      health.code = 'backend_auth_schema_outdated'
      health.error = 'The canonical authenticate_user function returned a different user than the one just created for this lodge.'
      console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_expected_user_mismatch', probeRow, expectedUserId })
      authTrace('healthCheck return', health)
      return health
    }
    if (probeRow.email !== emailLower) {
      health.code = 'backend_auth_schema_outdated'
      health.error = 'The canonical authenticate_user function returned a user that does not match the requested lodge-scoped email.'
      console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_email_mismatch', probeRow, emailLower })
      authTrace('healthCheck return', health)
      return health
    }
  } else if (probeRow.found) {
    health.code = 'backend_auth_schema_outdated'
    health.error = 'The canonical authenticate_user function unexpectedly returned a user during the health-check probe.'
    console.warn('[AUTH TRACE] schema error wrapper hit', { source: 'healthCheck_unexpected_probe_user', probeRow })
    authTrace('healthCheck return', health)
    return health
  }

  health.checks.authenticate_user_contract_valid = true
  health.ok = true
  health.code = 'ok'
  console.log('[AUTH HEALTH] success:', {
    email: emailLower || null,
    lodge_id: lodgeId,
    user_id: health.user?.id || null
  })
  authTrace('healthCheck return', health)
  return health
}

function resolvePwaAccessUpdate(existingUser = {}, data = {}) {
  const hasToggle = Object.prototype.hasOwnProperty.call(data, 'pwa_enabled')
  const hasReason = Object.prototype.hasOwnProperty.call(data, 'pwa_disabled_reason')
  const nextRole = normalizeStaffRole(data.role || existingUser?.role)
  const nextPassword = typeof data.pwa_password === 'string' ? data.pwa_password.trim() : ''
  const hasPassword = Boolean(nextPassword)
  const autoDisableForRole = Boolean(existingUser?.pwa_enabled) && Object.prototype.hasOwnProperty.call(data, 'role') && !isPwaEligibleRole(nextRole)
  const requested = hasToggle || hasReason || hasPassword || autoDisableForRole

  if (!requested) {
    return { requested: false }
  }

  const enabled = autoDisableForRole
    ? false
    : hasToggle
      ? data.pwa_enabled === true
      : existingUser?.pwa_enabled === true

  if (enabled && !isPwaEligibleRole(nextRole)) {
    throw createAppError('pwa_role_ineligible', PWA_ROLE_DISABLED_MESSAGE, { role: nextRole })
  }

  const password_hash = hasPassword ? bcrypt.hashSync(nextPassword, 10) : null
  const hasExistingPassword = Boolean(existingUser?.pwa_password_set_at || existingUser?.pwa_password_hash)
  if (enabled && !password_hash && !hasExistingPassword) {
    throw createAppError('pwa_password_required', 'Set a separate Manager PWA password before enabling mobile access.')
  }

  return {
    requested: true,
    enabled,
    password_hash,
    autoDisableForRole,
    disabled_reason: enabled
      ? null
      : normalizePwaDisabledReason(
          autoDisableForRole ? PWA_ROLE_DISABLED_MESSAGE : data.pwa_disabled_reason,
          autoDisableForRole ? PWA_ROLE_DISABLED_MESSAGE : PWA_DISABLED_MESSAGE
        )
  }
}

function buildPwaAccessInput(data = {}, fallbackRole = null) {
  const payload = {}

  if (Object.prototype.hasOwnProperty.call(data, 'pwa_enabled')) {
    payload.pwa_enabled = data.pwa_enabled
  }
  if (Object.prototype.hasOwnProperty.call(data, 'pwa_disabled_reason')) {
    payload.pwa_disabled_reason = data.pwa_disabled_reason
  }
  if (typeof data.pwa_password === 'string') {
    payload.pwa_password = data.pwa_password
  }
  if (Object.prototype.hasOwnProperty.call(data, 'role')) {
    payload.role = data.role
  } else if (fallbackRole) {
    payload.role = fallbackRole
  }

  return payload
}

export async function createUser(data) {
  const emailLower = data.email.trim().toLowerCase()

  // ── Duplicate email check ─────────────────────────────────────────────────
  // Admin/super_admin emails are globally unique (one per system — they own the lodge setup).
  // All other roles (employees) can have accounts across multiple lodges.
  const isSetupRole = ['admin', 'super_admin'].includes(normalizeStaffRole(data.role))
  if (isOnline) {
    const query = supabase.from('users').select('id').eq('email', emailLower)
    if (!isSetupRole) query.eq('lodge_id', lodgeId)
    const { data: existing } = await query.limit(1)
    if (existing && existing.length > 0) {
      const msg = isSetupRole
        ? `An admin account with the email "${emailLower}" already exists. Each admin email can only be registered to one lodge.`
        : `A user with the email "${emailLower}" already exists in this lodge.`
      throw new Error(msg)
    }
  } else {
    const cached = readCache('users')
    const duplicate = isSetupRole
      ? cached.some(u => u.email?.toLowerCase() === emailLower)
      : cached.some(u => u.email?.toLowerCase() === emailLower && u.lodge_id === lodgeId)
    if (duplicate) {
      const msg = isSetupRole
        ? `An admin account with the email "${emailLower}" already exists. Each admin email can only be registered to one lodge.`
        : `A user with the email "${emailLower}" already exists in this lodge.`
      throw new Error(msg)
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const hash = bcrypt.hashSync(data.password, 10)
  const pwaAccess = resolvePwaAccessUpdate({}, data)
  const id = randomUUID()
  const authUserId = isOnline
    ? await createSupabaseAuthUserForStaff(emailLower, data.password)
    : null
  const user = {
    id,
    auth_user_id: authUserId,
    name: data.name,
    email: emailLower,
    password_hash: hash,
    role: normalizeStaffRole(data.role),
    lodge_id: lodgeId,
    pwa_enabled: pwaAccess.enabled === true,
    pwa_password_hash: pwaAccess.password_hash,
    pwa_password_set_at: pwaAccess.password_hash ? new Date().toISOString() : null,
    pwa_password_reset_by: pwaAccess.password_hash ? currentUser?.id || null : null,
    pwa_disabled_reason: pwaAccess.enabled === true ? null : (pwaAccess.requested ? pwaAccess.disabled_reason : null),
    allowed_outlet_ids: Array.isArray(data.allowed_outlet_ids) ? data.allowed_outlet_ids : []
  }
  if (data.pin) {
    user.pin_hash = bcrypt.hashSync(String(data.pin).trim(), 10)
  }

  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_user', { payload: user })
    if (error) {
      console.error('[USERS] createUser insert failed:', {
        email: emailLower,
        lodge_id: lodgeId,
        error: error.message
      })
      const code = isBackendAuthSchemaError(error.message || '')
        ? 'backend_auth_schema_outdated'
        : 'user_create_failed'
      const prefix = code === 'backend_auth_schema_outdated'
        ? 'This database is missing the latest Boroko auth schema required to create staff accounts for a lodge.'
        : 'Could not create the staff account for this lodge.'
      throw createAppError(code, `${prefix} ${error.message}`.trim(), { email: emailLower, lodge_id: lodgeId })
    }
    if (!result?.success || !result?.id) {
      throw createAppError(
        'user_create_failed',
        result?.error || 'Supabase did not return the new staff account after insert.',
        { email: emailLower, lodge_id: lodgeId }
      )
    }
    if (pwaAccess.requested) {
      const { data: pwaResult, error: pwaError } = await supabase.rpc('set_user_pwa_access', {
        p_id: result.id,
        p_lodge_id: lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: currentUser?.id || null
      })
      if (pwaError) {
        throw createAppError('pwa_access_update_failed', pwaError.message || 'Could not prepare Manager PWA access.', {
          email: emailLower,
          lodge_id: lodgeId,
          user_id: result.id
        })
      }
      if (!pwaResult?.success) {
        throw createAppError(
          'pwa_access_update_failed',
          pwaResult?.error || 'Could not prepare Manager PWA access.',
          { email: emailLower, lodge_id: lodgeId, user_id: result.id }
        )
      }
    }
    upsertCachedUser({
      id: result.id,
      auth_user_id: user.auth_user_id,
      name: user.name,
      email: user.email,
      role: user.role,
      lodge_id: user.lodge_id,
      pwa_enabled: user.pwa_enabled,
      pwa_password_set_at: user.pwa_password_set_at,
      pwa_password_reset_by: user.pwa_password_reset_by,
      pwa_disabled_reason: user.pwa_disabled_reason,
      created_at: new Date().toISOString()
    })
    await refreshCache('users')
    if (!getCachedUser(emailLower)) {
      upsertCachedUser({
        id: result.id,
        auth_user_id: user.auth_user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        lodge_id: user.lodge_id,
        pwa_enabled: user.pwa_enabled,
        pwa_password_set_at: user.pwa_password_set_at,
        pwa_password_reset_by: user.pwa_password_reset_by,
        pwa_disabled_reason: user.pwa_disabled_reason,
        created_at: new Date().toISOString()
      })
    }
    if (pwaAccess.requested) {
      const action = user.pwa_enabled ? 'enabled' : 'prepared'
      logActivity('pwa_access_updated', `${user.name || user.email} · Manager PWA ${action}`)
    }
    return result?.id
  } else {
    const cached = readCache('users')

const newUser = {
  ...user,
  created_at: new Date().toISOString()
}

const { pin_hash: _pinHash, ...cachedUser } = newUser

cached.push(cachedUser)
writeCache('users', cached)

// IMPORTANT: send ID to Supabase too
// P2-15: assign _queue_id so pwa_access setup can declare an explicit dependency
queueOperation('rpc', 'create_user', { payload: newUser }, null, { _queue_id: `user-${id}` })
if (pwaAccess.requested) {
  // P2-15: must not run before the user row exists on the server
  queueOperation('rpc', 'set_user_pwa_access', {
    p_id: id,
    p_lodge_id: lodgeId,
    p_enabled: pwaAccess.enabled,
    p_password_hash: pwaAccess.password_hash,
    p_disabled_reason: pwaAccess.disabled_reason,
    p_reset_by: currentUser?.id || null
  }, null, { _depends_on: `user-${id}` })
}

if (pwaAccess.requested) {
  const action = user.pwa_enabled ? 'enabled' : 'prepared'
  logActivity('pwa_access_updated', `${user.name || user.email} · Manager PWA ${action}`)
}

return id
  }
}

export async function updateUser(id, data) {
  const cachedUsers = readCache('users')
  const existingUser = cachedUsers.find((u) => u.id === id)
  if (!existingUser) throw new Error('Staff account not found.')
  const update = {}
  if (Object.prototype.hasOwnProperty.call(data, 'name')) update.name = data.name
  if (Object.prototype.hasOwnProperty.call(data, 'email') && data.email) update.email = data.email.trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(data, 'role')) update.role = normalizeStaffRole(data.role)
  if (Object.prototype.hasOwnProperty.call(data, 'allowed_outlet_ids')) {
    update.allowed_outlet_ids = Array.isArray(data.allowed_outlet_ids) ? data.allowed_outlet_ids : []
  }
  const password_hash = data.password ? bcrypt.hashSync(data.password, 10) : null
  if (data.pin) {
    update.pin_hash = bcrypt.hashSync(String(data.pin).trim(), 10)
  }
  const pwaAccess = resolvePwaAccessUpdate(existingUser, buildPwaAccessInput(data))

  if (isOnline) {
    if (Object.keys(update).length > 0) {
      const { data: result, error } = await supabase.rpc('update_user_profile', {
        p_id: id,
        p_lodge_id: lodgeId,
        payload: update
      })
      if (error) throw new Error(error.message)
      if (!result?.success) throw new Error(result?.error || 'Could not update user')
    }
    if (password_hash) {
      const { data: passwordResult, error: passwordError } = await supabase.rpc('set_user_password', {
        p_id: id,
        p_lodge_id: lodgeId,
        p_password_hash: password_hash
      })
      if (passwordError) throw new Error(passwordError.message)
      if (!passwordResult?.success) throw new Error(passwordResult?.error || 'Could not update user password')
    }
    if (pwaAccess.requested) {
      const { data: pwaResult, error: pwaError } = await supabase.rpc('set_user_pwa_access', {
        p_id: id,
        p_lodge_id: lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: currentUser?.id || null
      })
      if (pwaError) throw new Error(pwaError.message)
      if (!pwaResult?.success) throw new Error(pwaResult?.error || 'Could not update Manager PWA access')
    }
    await refreshCache('users')
  } else {
    const cached = [...cachedUsers]
    const idx = cached.findIndex((u) => u.id === id)
    if (idx >= 0) {
      const { pin_hash: _pinHash, ...safeUpdate } = update
      cached[idx] = { ...cached[idx], ...safeUpdate }
      if (password_hash) cached[idx].password_hash = password_hash
      if (pwaAccess.requested) {
        cached[idx].pwa_enabled = pwaAccess.enabled
        cached[idx].pwa_disabled_reason = pwaAccess.disabled_reason
        if (pwaAccess.password_hash) {
          cached[idx].pwa_password_hash = pwaAccess.password_hash
          cached[idx].pwa_password_set_at = new Date().toISOString()
          cached[idx].pwa_password_reset_by = currentUser?.id || null
        }
      }
    }
    writeCache('users', cached)
    if (Object.keys(update).length > 0) {
      queueOperation('rpc', 'update_user_profile', {
        p_id: id,
        p_lodge_id: lodgeId,
        payload: update
      })
    }
    if (password_hash) {
      queueOperation('rpc', 'set_user_password', {
        p_id: id,
        p_lodge_id: lodgeId,
        p_password_hash: password_hash
      })
    }
    if (pwaAccess.requested) {
      queueOperation('rpc', 'set_user_pwa_access', {
        p_id: id,
        p_lodge_id: lodgeId,
        p_enabled: pwaAccess.enabled,
        p_password_hash: pwaAccess.password_hash,
        p_disabled_reason: pwaAccess.disabled_reason,
        p_reset_by: currentUser?.id || null
      })
    }
  }

  if (existingUser?.email && update.email && existingUser.email !== update.email) {
    removeAuthEntry(existingUser.email)
  }
  if (password_hash) {
    upsertAuthEntry((update.email || existingUser?.email || '').trim().toLowerCase(), password_hash)
  }
  if (pwaAccess.requested) {
    const subject = update.name || existingUser?.name || update.email || existingUser?.email || 'Staff account'
    const action = pwaAccess.enabled
      ? (pwaAccess.password_hash ? 'enabled with a new PWA password' : 'enabled')
      : (pwaAccess.autoDisableForRole ? `suspended because the role changed to ${update.role || existingUser?.role}` : 'disabled')
    logActivity('pwa_access_updated', `${subject} · Manager PWA ${action}`)
  }
}

export async function resetUserPassword(id, password) {
  const users = isOnline ? await getAllUsers() : readCache('users')
  const existingUser = users.find((u) => u.id === id)
  if (!existingUser) throw new Error('Staff account not found.')
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.')

  const password_hash = bcrypt.hashSync(password, 10)

  if (isOnline) {
    const { data: result, error } = await supabase.rpc('set_user_password', {
      p_id: id,
      p_lodge_id: lodgeId,
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
      p_lodge_id: lodgeId,
      p_password_hash: password_hash
    })
  }

  if (isOnline && existingUser.auth_user_id && adminDb) {
    const { error } = await adminDb.auth.admin.updateUserById(existingUser.auth_user_id, {
      password
    })
    if (error) throw new Error(error.message || 'Could not update Supabase Auth password.')
  }

  upsertAuthEntry(existingUser.email.trim().toLowerCase(), bcrypt.hashSync(password, 10))
}

export async function getAuthStatus(email = '') {
  await checkOnline()
  if (!lodgeId) {
    return {
      online: isOnline,
      lodge_id: null,
      hasOfflineAccess: false,
      hasTrustedSession: false,
      savedSessionCount: 0,
      hasCachedUsers: false,
      hasSavedAccounts: false,
      message: 'Choose a lodge on this computer for staff sign-in. Master admin sign-in still works.'
    }
  }
  const emailLower = normalizeEmail(email)
  const authEntries = readAuthCache().filter((entry) => entry.lodge_id === lodgeId)
  const cachedUsers = readCache('users')
    .map(normalizeUserRecord)
    .filter((entry) => entry && (!entry.lodge_id || entry.lodge_id === normalizeLodgeId(lodgeId)))
  const trustedSessions = pruneExpiredTrustedSessions()
    .map(normalizeTrustedSessionRecord)
    .filter((session) => session && (!session.lodge_id || session.lodge_id === normalizeLodgeId(lodgeId)))
  const legacySession = normalizeTrustedSessionRecord(readSessionNonce())
  const allTrustedSessions = [
    ...trustedSessions,
    ...(legacySession && (!legacySession.lodge_id || legacySession.lodge_id === normalizeLodgeId(lodgeId)) ? [legacySession] : [])
  ]
  const hasTrustedSession = emailLower
    ? allTrustedSessions.some((session) => session.email === emailLower)
    : allTrustedSessions.length > 0
  const hasOfflineAccess = emailLower
    ? authEntries.some((entry) => entry.email === emailLower) && cachedUsers.some((user) => user.email === emailLower)
    : authEntries.length > 0 && cachedUsers.length > 0

  let message = 'Online. Staff can sign in normally.'
  if (!isOnline && hasTrustedSession) {
    message = 'Offline. Enter this user password to open the saved session on this computer.'
  } else if (!isOnline && emailLower && !hasOfflineAccess) {
    message = 'Offline. This account has no saved trusted session on this computer yet.'
  } else if (!isOnline) {
    message = allTrustedSessions.length > 0
      ? 'Offline. Choose a saved staff account and enter its password.'
      : 'Offline. No saved staff sessions are available on this computer yet.'
  } else if (emailLower && !hasOfflineAccess) {
    message = 'Online. After this account signs in successfully once here, this computer can reopen its saved trusted session while offline.'
  } else if (emailLower && hasOfflineAccess) {
    message = 'Online. This account has local data on this computer. Offline access uses its saved session plus password.'
  } else if (hasOfflineAccess) {
    message = 'Online. This computer has saved local data for at least one staff account.'
  }

  return {
    online: isOnline,
    lodge_id: lodgeId,
    hasOfflineAccess,
    hasTrustedSession,
    savedSessionCount: allTrustedSessions.length,
    hasCachedUsers: cachedUsers.length > 0,
    hasSavedAccounts: authEntries.length > 0,
    message
  }
}

export async function deleteUser(id) {
  const users = isOnline ? await getAllUsers() : readCache('users').map(normalizeUserRecord).filter(Boolean)
  const existingUser = users.find((u) => u.id === id)
  if (!existingUser) throw new Error('Staff account not found.')
  if (currentUser?.id === id) throw new Error('You cannot delete the account you are currently signed in with.')

  if (normalizeStaffRole(existingUser.role) === 'admin') {
    const adminCount = users.filter((u) => normalizeStaffRole(u.role) === 'admin').length
    if (adminCount <= 1) {
      throw new Error('You cannot delete the last admin in this lodge.')
    }
  }

  if (isOnline) {
    const { data: result, error } = await supabase.rpc('delete_user', {
      p_id: id,
      p_lodge_id: lodgeId
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not delete user')
    await refreshCache('users')
  } else {
    const cached = readCache('users')
    writeCache('users', cached.filter((u) => u.id !== id))
    queueOperation('rpc', 'delete_user', {
      p_id: id,
      p_lodge_id: lodgeId
    })
  }
}

// ─── ROOMS ────────────────────────────────────────────────────────────────────

export async function getAllRooms() {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('lodge_id', lodgeId)
      .order('room_number')
    if (error) throw error
    const cached = readCache('rooms')
    if ((data || []).length === 0 && cached.length > 0) {
      console.warn('getAllRooms received empty live result; using cached rooms instead')
      return cached
    }
    writeCache('rooms', data || [])
    return data || []
  } catch (error) {
    const cached = readCache('rooms')
    if (cached.length > 0) {
      console.warn('getAllRooms falling back to cache:', error?.message || error)
      return cached
    }
    if (!isOnline) return []
    throw new Error(error?.message || 'Failed to load rooms')
  }
}

export async function getRoomById(id) {
  try {
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .eq('lodge_id', lodgeId)
      .single()
    if (error) throw error
    return data || null
  } catch {
    return readCache('rooms').find((r) => r.id === id) || null
  }
}

export async function createRoom(data) {
  const id = randomUUID()
  const room = {
    id,
    room_number: data.room_number,
    room_type: data.room_type,
    rate_per_night: data.rate_per_night,
    max_occupancy: data.max_occupancy || 2,
    status: data.status || 'available',
    description: data.description || '',
    photos: Array.isArray(data.photos) ? data.photos : (data.photo ? [data.photo] : []),
    amenities: Array.isArray(data.amenities) ? data.amenities : [],
    lodge_id: lodgeId
  }

  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_room', { payload: room })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create room')
    await refreshCache('rooms')
    return result?.id
  } else {
    const cached = readCache('rooms')
    const newRoom = { ...room, _pending_sync: true, created_at: new Date().toISOString() }
    cached.push(newRoom)
    writeCache('rooms', cached)
    // P2-15: assign _queue_id so any offline update to this room can declare _depends_on
    queueOperation('rpc', 'create_room', { payload: room }, null, { _queue_id: `room-${id}` })
    return id
  }
}

export async function updateRoom(id, data) {
  const update = {
    room_number: data.room_number,
    room_type: data.room_type,
    rate_per_night: data.rate_per_night,
    max_occupancy: data.max_occupancy,
    status: data.status,
    description: data.description,
    photos: Array.isArray(data.photos) ? data.photos : (data.photo ? [data.photo] : []),
    amenities: Array.isArray(data.amenities) ? data.amenities : []
  }

  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_room', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update room')
    await refreshCache('rooms')
  } else {
    const cached = readCache('rooms')
    const idx = cached.findIndex((r) => r.id === id)
    // P2-15: if the room itself hasn't synced yet, update must wait for creation to land first
    const roomPendingSync = idx >= 0 && cached[idx]?._pending_sync
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('rooms', cached)
    queueOperation('rpc', 'update_room', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    }, null, roomPendingSync ? { _depends_on: `room-${id}` } : {})
  }
}

export async function updateRoomHousekeeping(id, status, notes) {
  const update = {
    housekeeping_status: status || 'clean',
    housekeeping_notes: notes || ''
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_room_housekeeping', {
      p_id: id,
      p_lodge_id: lodgeId,
      p_status: status || 'clean',
      p_notes: notes || ''
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update housekeeping')
    await refreshCache('rooms')
    const room = readCache('rooms').find((r) => r.id === id)
    logActivity('housekeeping_updated', `Room ${room?.room_number || id} marked ${status}${notes ? ' · note saved' : ''}`)
  } else {
    const cached = readCache('rooms')
    const idx = cached.findIndex((r) => r.id === id)
    const room = cached[idx]
    const roomPendingSync = idx >= 0 && cached[idx]?._pending_sync
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('rooms', cached)
    queueOperation('rpc', 'update_room_housekeeping', {
      p_id: id,
      p_lodge_id: lodgeId,
      p_status: status || 'clean',
      p_notes: notes || ''
    }, null, roomPendingSync ? { _depends_on: `room-${id}` } : {})
    logActivity('housekeeping_updated', `Room ${room?.room_number || id} marked ${status}${notes ? ' · note saved' : ''}`)
  }
}

export async function deleteRoom(id) {
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('delete_room', {
      p_id: id,
      p_lodge_id: lodgeId
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not delete room')
    await refreshCache('rooms')
  } else {
    const cached = readCache('rooms')
    const roomPendingSync = cached.some((r) => r.id === id && r?._pending_sync)
    writeCache('rooms', cached.filter((r) => r.id !== id))
    queueOperation('rpc', 'delete_room', {
      p_id: id,
      p_lodge_id: lodgeId
    }, null, roomPendingSync ? { _depends_on: `room-${id}` } : {})
  }
}

// ─── CUSTOMERS ────────────────────────────────────────────────────────────────

export async function getAllCustomers() {
  if (isOnline) {
    const { data } = await supabase.from('customers').select('*').eq('lodge_id', lodgeId).order('name')
    if (data) writeCache('customers', data)
    return data || []
  }
  return readCache('customers')
}

export async function createCustomer(data) {
  const id = randomUUID()
  const customer = {
    id,
    name: data.name,
    email: data.email || '',
    phone: data.phone || '',
    id_number: data.id_number || '',
    nationality: data.nationality || '',
    lodge_id: lodgeId
  }

  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_customer', { payload: customer })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create customer')
    await refreshCache('customers')
    return result?.id
  } else {
    const cached = readCache('customers')
    const newCustomer = { ...customer, _pending_sync: true, created_at: new Date().toISOString() }
    cached.push(newCustomer)
    writeCache('customers', cached)
    queueOperation('rpc', 'create_customer', {
      payload: {
        ...customer,
        created_at: newCustomer.created_at
      }
    }, null, { _queue_id: `customer-${id}` })
    return id
  }
}

export async function updateCustomerBlacklist(id, is_blacklisted, reason) {
  const update = { is_blacklisted: !!is_blacklisted, blacklist_reason: reason || '' }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_customer_blacklist', {
      p_id: id,
      p_lodge_id: lodgeId,
      p_is_blacklisted: !!is_blacklisted,
      p_reason: reason || ''
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update customer blacklist')
    await refreshCache('customers')
  } else {
    const cached = readCache('customers')
    const idx = cached.findIndex((c) => c.id === id)
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('customers', cached)
    queueOperation('rpc', 'update_customer_blacklist', {
      p_id: id,
      p_lodge_id: lodgeId,
      p_is_blacklisted: !!is_blacklisted,
      p_reason: reason || ''
    })
  }
}

export async function getCustomerBookings(customerId) {
  if (isOnline) {
    const { data } = await supabase
      .from('bookings')
      .select('*, rooms(room_number, room_type)')
      .eq('lodge_id', lodgeId)
      .eq('customer_id', customerId)
      .order('check_in', { ascending: false })
      .limit(10)
    return (data || []).map((b) => ({
      ...b,
      room_number: b.rooms?.room_number,
      room_type: b.rooms?.room_type
    }))
  }
  const rooms = readCache('rooms')
  return readCache('bookings')
    .filter((b) => b.customer_id === customerId)
    .map((b) => {
      const room = rooms.find((r) => r.id === b.room_id)
      return { ...b, room_number: room?.room_number, room_type: room?.room_type }
    })
    .sort((a, b) => new Date(b.check_in) - new Date(a.check_in))
    .slice(0, 10)
}

export async function updateCustomer(id, data) {
  const update = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    id_number: data.id_number,
    nationality: data.nationality
  }

  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_customer', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update customer')
    await refreshCache('customers')
  } else {
    const cached = readCache('customers')
    const idx = cached.findIndex((c) => c.id === id)
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('customers', cached)
    queueOperation('rpc', 'update_customer', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    })
  }
}

// ─── BOOKINGS ─────────────────────────────────────────────────────────────────

function buildLocalPendingInvoiceNumber(bookingId) {
  const suffix = String(bookingId || randomUUID()).replace(/-/g, '').slice(0, 8).toUpperCase()
  return `PENDING-${suffix}`
}

function buildOfflineBookingFinancialState(totalAmount, depositAmount = 0) {
  const total = Math.max(0, Number(totalAmount || 0))
  const paid = Math.max(0, Number(depositAmount || 0))
  const amountPaid = Math.min(paid, total)
  return {
    amount_paid: amountPaid,
    payment_status: amountPaid >= total && total > 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'
  }
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

export async function getAllBookings() {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select(`*, customers(name, phone, email), rooms(room_number, room_type, rate_per_night)`)
      .eq('lodge_id', lodgeId)
      .order('check_in', { ascending: false })
    if (error) throw error

    const cached = readCache('bookings')
    if ((data || []).length === 0 && cached.length > 0) {
      console.warn('getAllBookings received empty live result; using cached bookings instead')
      return cached
    }

    const localRowsForMerge = cached
    const mapped = (data || []).map((b) => ({
      ...b,
      customer_name: b.customers?.name,
      customer_phone: b.customers?.phone,
      customer_email: b.customers?.email,
      room_number: b.rooms?.room_number,
      room_type: b.rooms?.room_type,
      rate_per_night: b.rooms?.rate_per_night
    }))
    const mergedLiveRows = mergeRemoteBookingsWithLocalState(mapped, localRowsForMerge)
    writeCache('bookings', mergedLiveRows)
    return mergedLiveRows
  } catch (error) {
    if (isOnline) {
      const cached = readCache('bookings')
      if (cached.length > 0) {
        console.warn('getAllBookings falling back to cache:', error?.message || error)
      } else if (error) {
        console.error('getAllBookings failed:', error)
      }
    }
  }

  const bookings = readCache('bookings')
  const customers = readCache('customers')
  const rooms = readCache('rooms')

  return bookings
    .map((b) => {
      const customer = customers.find((c) => c.id === b.customer_id)
      const room = rooms.find((r) => r.id === b.room_id)
      return {
        ...b,
        customer_name: customer?.name,
        customer_phone: customer?.phone,
        customer_email: customer?.email,
        room_number: room?.room_number,
        room_type: room?.room_type,
        rate_per_night: room?.rate_per_night
      }
    })
    .sort((a, b) => new Date(b.check_in) - new Date(a.check_in))
}

export async function getBookingById(id) {
  if (!id) return null
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('id', id)
      .eq('lodge_id', lodgeId)
      .single()
    if (error) throw error
    return data || null
  } catch {
    return readCache('bookings').find((booking) => booking.id === id) || null
  }
}

export async function getPendingOnlineBookings() {
  try {
    if (isOnline) {
      const { data, error } = await supabase
        .from('bookings')
        .select(`*, customers(name, phone, email), rooms(room_number, room_type)`)
        .eq('lodge_id', lodgeId)
        .eq('source', 'online')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []).map((b) => ({
        ...b,
        customer_name: b.customers?.name,
        customer_phone: b.customers?.phone,
        customer_email: b.customers?.email,
        room_number: b.rooms?.room_number,
        room_type: b.rooms?.room_type
      }))
    }
    // Offline fallback — filter from cache
    const cached = readCache('bookings')
    return cached.filter((b) => b.source === 'online' && b.status === 'pending')
  } catch {
    const cached = readCache('bookings')
    return cached.filter((b) => b.source === 'online' && b.status === 'pending')
  }
}

export async function getBookingsByDateRange(startDate, endDate) {
  if (isOnline) {
    const { data } = await supabase
      .from('bookings')
      .select(`*, customers(name), rooms(room_number, room_type, rate_per_night)`)
      .eq('lodge_id', lodgeId)
      .neq('status', 'cancelled')
      .lte('check_in', endDate)
      .gt('check_out', startDate)

    if (data) {
      return data.map((b) => ({
        ...b,
        customer_name: b.customers?.name,
        room_number: b.rooms?.room_number,
        room_type: b.rooms?.room_type,
        rate_per_night: b.rooms?.rate_per_night
      }))
    }
    return []
  }

  const bookings = readCache('bookings')
  const customers = readCache('customers')
  const rooms = readCache('rooms')

  return bookings
    .filter(
      (b) => b.status !== 'cancelled' && b.check_in <= endDate && b.check_out > startDate
    )
    .map((b) => {
      const customer = customers.find((c) => c.id === b.customer_id)
      const room = rooms.find((r) => r.id === b.room_id)
      return {
        ...b,
        customer_name: customer?.name,
        room_number: room?.room_number,
        room_type: room?.room_type,
        rate_per_night: room?.rate_per_night
      }
    })
    .sort((a, b) => (a.room_number || '').localeCompare(b.room_number || ''))
}

// ── BOOKING VALIDATION HELPERS ───────────────────────────────────────────────

async function checkExclusiveEventConflict(checkIn, checkOut, excludeGroupId = null) {
  if (isOnline) {
    const { data } = await supabase.from('bookings').select('id, notes')
      .eq('lodge_id', lodgeId)
      .eq('is_exclusive_event', true)
      .neq('status', 'cancelled')
      .lt('check_in', checkOut)
      .gt('check_out', checkIn)
    if (data?.length > 0) {
      if (excludeGroupId && data.every(b => b.notes?.includes(`[GROUP:${excludeGroupId}]`))) return
      throw new Error('The lodge is fully reserved for an exclusive event on these dates. No other bookings can be made.')
    }
  } else {
    const events = readCache('bookings').filter(b =>
      b.is_exclusive_event && b.status !== 'cancelled' &&
      b.check_in < checkOut && b.check_out > checkIn &&
      !(excludeGroupId && b.notes?.includes(`[GROUP:${excludeGroupId}]`))
    )
    if (events.length > 0)
      throw new Error('The lodge is fully reserved for an exclusive event on these dates. No other bookings can be made.')
  }
}

function normalizeEventBookingName(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function buildEventGroupId({ eventName, checkIn, checkOut }) {
  const signature = [
    normalizeLodgeId(lodgeId) || 'no-lodge',
    normalizeEventBookingName(eventName),
    String(checkIn || '').trim(),
    String(checkOut || '').trim()
  ].join('|')
  return `evt-${crypto.createHash('sha256').update(signature).digest('hex').slice(0, 24)}`
}

function parseEventRoomCount(notes = '') {
  const match = String(notes || '').match(/\[ROOMS:(\d+)\]/)
  const count = Number(match?.[1] || 0)
  return Number.isFinite(count) && count > 0 ? count : null
}

function stripEventMetadata(notes = '') {
  return String(notes || '').replace(/\[GROUP:[^\]]+\]/g, '').replace(/\[ROOMS:\d+\]/g, '').trim()
}

function findCachedEventBookingByGroup(groupId) {
  return readCache('bookings').find((booking) =>
    booking?.is_exclusive_event
    && String(booking?.notes || '').includes(`[GROUP:${groupId}]`)
    && String(booking?.status || '').toLowerCase() !== 'cancelled'
  )
}

async function findRemoteEventBookingByGroup(groupId) {
  if (!isOnline) return null
  const { data, error } = await supabase
    .from('bookings')
    .select('id, notes, total_amount, check_in, check_out')
    .eq('lodge_id', lodgeId)
    .eq('is_exclusive_event', true)
    .neq('status', 'cancelled')
    .ilike('notes', `%[GROUP:${groupId}]%`)
    .limit(1)
  if (error) throw new Error(error.message)
  return data?.[0] || null
}

function validateBookingDates(checkIn, checkOut) {
  if (!checkIn || !checkOut) throw new Error('Check-in and check-out dates are required')
  const inMs = new Date(checkIn).getTime()
  const outMs = new Date(checkOut).getTime()
  if (isNaN(inMs) || isNaN(outMs)) throw new Error('Invalid date format')
  if (outMs <= inMs) throw new Error('Check-out must be after check-in')
  const nights = Math.ceil((outMs - inMs) / (1000 * 60 * 60 * 24))
  if (nights < 1) throw new Error('Booking must be at least one night')
  return { nights }
}

async function checkRoomConflict(roomId, checkIn, checkOut, excludeId = null) {
  await checkExclusiveEventConflict(checkIn, checkOut)
  const existingBookings = isOnline
    ? (() => {
        let q = supabase
          .from('bookings')
          .select('id, check_in, check_out')
          .eq('lodge_id', lodgeId)
          .eq('room_id', roomId)
          .neq('status', 'cancelled')
        if (excludeId) q = q.neq('id', excludeId)
        return q
      })().then((r) => r.data || [])
    : Promise.resolve(
        readCache('bookings').filter(
          (b) => b.room_id === roomId && b.status !== 'cancelled' && b.id !== excludeId
        )
      )

  const bookings = await existingBookings
  const conflict = bookings.find((b) => b.check_in < checkOut && b.check_out > checkIn)
  if (conflict) throw new Error('Room is already booked for these dates')
}

export async function createBooking(data) {
  try {
  const { nights } = validateBookingDates(data.check_in, data.check_out)
  await checkRoomConflict(data.room_id, data.check_in, data.check_out)

  const room = await getRoomById(data.room_id)
  if (!room) throw new Error('Room not found')
  const baseTotal = room.rate_per_night * nights
  const requestedTotal = Number(data.total_amount)
  const allowTotalOverride = data.allow_total_override === true
    && Number.isFinite(requestedTotal)
    && requestedTotal > 0
    && Math.abs(requestedTotal - baseTotal) > 0.01
  const total = allowTotalOverride ? requestedTotal : baseTotal
  if (isNaN(total) || total <= 0) throw new Error('Invalid total — check room rate and dates')

  const deposit = Number(data.deposit_amount) || 0
  const paymentMethod = data.payment_method || 'cash'
  const invoice_number = await getNextBookingInvoiceNumber()
  const id = randomUUID()
  const booking = {
    id,
    customer_id: data.customer_id,
    room_id: data.room_id,
    check_in: data.check_in,
    check_out: data.check_out,
    adults: data.adults || 1,
    children: data.children || 0,
    total_amount: total,
    status: 'confirmed',
    payment_status: 'unpaid',
    amount_paid: 0,
    deposit_amount: deposit,
    payment_method: null,
    notes: data.notes || '',
    created_by: data.created_by || null,
    invoice_number,
    lodge_id: lodgeId
  }
  const bookingCreateIdempotencyKey = createBookingIdempotencyKey(id)

  if (isOnline) {
    if (!booking.customer_id) {
      throw new Error('Customer ID is required for booking')
    }

    const { data: result, error } = await supabase.rpc('create_booking', {
      p_lodge_id: booking.lodge_id,
      p_customer_id: booking.customer_id,
      p_room_id: booking.room_id,
      p_check_in: booking.check_in,
      p_check_out: booking.check_out,
      p_adults: booking.adults,
      p_children: booking.children,
      p_total_amount: booking.total_amount,
      p_invoice_number: booking.invoice_number,
      p_notes: booking.notes,
      p_created_by: booking.created_by,
      p_deposit_amount: deposit,
      p_booking_id: booking.id,
      p_idempotency_key: bookingCreateIdempotencyKey,
      p_deposit_method: deposit > 0 ? paymentMethod : null,
      p_allow_total_override: allowTotalOverride
    })

    if (error) {
      if (/function create_booking|p_booking_id|p_idempotency_key|create_idempotency_key|p_allow_total_override/i.test(error.message || '')) {
        throw new Error('The Supabase booking sync contract is outdated. Run the latest checked-in booking sync migration, then try again.')
      }
      if (error.message?.includes('no_overlapping_bookings')) {
        throw new Error('This room is already booked for the selected dates.')
      }
      throw new Error('Network Error: ' + error.message)
    }
    if (!result || !result.success) {
      throw new Error(result?.error || 'Booking failed')
    }
    await refreshCache('bookings')
    const _r = readCache('rooms').find((r) => r.id === booking.room_id)
    const _c = readCache('customers').find((c) => c.id === booking.customer_id)
    logActivity('booking_created', `Booking created · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''} · ${booking.check_in} → ${booking.check_out}`)
    createBackup()

    const bookingId = result.booking_id || id

    // P2: Explicitly record deposit if provided. 
    // This ensures payment records are created even if the create_booking RPC is an older version.
    if (deposit > 0) {
      try {
        await updateBookingPayment(bookingId, deposit, paymentMethod, 'deposit')
      } catch (depError) {
        // If deposit fails but booking succeeded, surface as a warning so the UI stays in the modal.
        const err = new Error(depError.message || 'Deposit could not be recorded')
        err.code = 'DEPOSIT_FAILED'
        err.booking_id = bookingId
        throw err
      }
    }
    return bookingId
  } else {
    const cached = readCache('bookings')
    const cachedCustomer = booking.customer_id
      ? readCache('customers').find((customer) => customer.id === booking.customer_id)
      : null
    const optimisticPayment = buildOfflineBookingFinancialState(total, deposit)
    const newBooking = {
      ...booking,
      amount_paid: optimisticPayment.amount_paid,
      payment_status: optimisticPayment.payment_status,
      _local_invoice_number: buildLocalPendingInvoiceNumber(id),
      _pending_sync: true,
      _pending_payment: deposit > 0,
      _sync_created_offline: true,
      _sync_state: 'pending',
      _sync_error: null,
      created_at: new Date().toISOString()
    }

    queueOperation('rpc', 'create_booking', {
      p_lodge_id:        booking.lodge_id,
      p_customer_id:     booking.customer_id,
      p_room_id:         booking.room_id,
      p_check_in:        booking.check_in,
      p_check_out:       booking.check_out,
      p_adults:          booking.adults,
      p_children:        booking.children || 0,
      p_total_amount:    booking.total_amount,
      p_invoice_number:  booking.invoice_number,
      p_notes:           booking.notes || '',
      p_created_by:      booking.created_by,
      p_deposit_amount:  deposit,
      p_booking_id:      booking.id,
      p_idempotency_key: bookingCreateIdempotencyKey,
      p_deposit_method:  deposit > 0 ? paymentMethod : null,
      p_allow_total_override: allowTotalOverride
    }, null, {
      _queue_id: `booking-${id}`,
      ...(cachedCustomer?._pending_sync ? { _depends_on: `customer-${booking.customer_id}` } : {})
    })

    cached.push(newBooking)
    writeCache('bookings', cached)

    // P2: Explicitly queue deposit if provided.
    // updateBookingPayment handles its own queuing and dependency on the booking creation record.
    if (deposit > 0) {
      await updateBookingPayment(id, deposit, paymentMethod, 'deposit')
    }

    const _r = readCache('rooms').find((r) => r.id === newBooking.room_id)
    const _c = readCache('customers').find((c) => c.id === newBooking.customer_id)

    logActivity(
      'booking_created',
      `Booking created · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''} · ${newBooking.check_in} → ${newBooking.check_out}`
    )

    createBackup()

    return id
  }
  } catch (error) {
    recordCriticalError('booking.create', error, {
      customer_id: data?.customer_id || null,
      room_id: data?.room_id || null,
      check_in: data?.check_in || null,
      check_out: data?.check_out || null,
      deposit_amount: Number(data?.deposit_amount || 0)
    })
    throw error
  }
}

export async function updateBooking(id, data) {
  try {
    const { nights } = validateBookingDates(data.check_in, data.check_out)
    await checkRoomConflict(data.room_id, data.check_in, data.check_out, id)

    const room = await getRoomById(data.room_id)
    if (!room) throw new Error('Room not found')
    const total = room.rate_per_night * nights
    if (isNaN(total) || total <= 0) throw new Error('Invalid total — check room rate and dates')

    // Local payment_status estimate for the offline cache only.
    // The server ALWAYS recomputes payment_status authoritatively (Phase 2 hardening).
    // payment_status is intentionally NOT sent in the RPC payload — the server ignores it anyway.
    const currentBooking = readCache('bookings').find((b) => b.id === id)
    const expectedUpdatedAt = data.expected_updated_at || currentBooking?.updated_at || null
    const amountPaid = Number(currentBooking?.amount_paid) || 0
    // Include charges_total so the offline estimate matches server logic
    const chargesTotal = Number(currentBooking?.charges_total) || 0
    const totalOwed = total + chargesTotal
    const offlinePaymentStatus = amountPaid >= totalOwed ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'

    // payment_status is NOT included — server derives it from authoritative fields
    const update = {
      customer_id: data.customer_id,
      room_id: data.room_id,
      check_in: data.check_in,
      check_out: data.check_out,
      adults: data.adults,
      children: data.children,
      total_amount: total,
      notes: data.notes,
      updated_at: new Date().toISOString()
    }

    const rpcPayload = {
      ...update,
      ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {})
    }

    if (isOnline) {
      const { data: result, error } = await supabase.rpc('update_booking', {
        p_id: id,
        p_lodge_id: lodgeId,
        payload: rpcPayload
      })
      if (error) throw new Error(error.message)
      if (!result?.success) throw new Error(result?.error || 'Could not update booking')
      await refreshCache('bookings')
    } else {
      const cached = readCache('bookings')
      const idx = cached.findIndex((b) => b.id === id)
      const _updDepend = cached[idx]?._pending_sync ? `booking-${id}` : null
      // Queue FIRST — dependency resolved from pre-write cache; no second read needed
      queueOperation('rpc', 'update_booking', {
        p_id: id,
        p_lodge_id: lodgeId,
        payload: rpcPayload
      }, null, _updDepend ? { _depends_on: _updDepend } : {})
      // Cache SECOND — offline estimate includes charges_total for correct local display
      if (idx >= 0) {
        cached[idx] = {
          ...cached[idx],
          ...update,
          payment_status: offlinePaymentStatus,
          _pending_payment: true,
          _pending_sync: true
        }
      }
      writeCache('bookings', cached)
    }
  } catch (error) {
    recordCriticalError('booking.update', error, {
      booking_id: id,
      room_id: data?.room_id || null,
      check_in: data?.check_in || null,
      check_out: data?.check_out || null
    })
    throw error
  }
}

const VALID_STATUS_TRANSITIONS = {
  pending:    ['confirmed', 'cancelled'],
  confirmed:  ['checked_in', 'cancelled'],
  checked_in: ['checked_out'],
}

export async function updateBookingStatus(id, status) {
  // Enforce state machine — read current status from cache first
  const currentBooking = readCache('bookings').find((b) => b.id === id)
  if (currentBooking) {
    const allowed = VALID_STATUS_TRANSITIONS[currentBooking.status]
    if (allowed && !allowed.includes(status)) {
      throw new Error(`Cannot transition booking from '${currentBooking.status}' to '${status}'`)
    }
  }

  if (status === 'checked_out' && currentBooking) {
    const outstanding = Math.max(
      0,
      Number(currentBooking.total_amount || 0) + Number(currentBooking.charges_total || 0) - Number(currentBooking.amount_paid || 0)
    )
    if (outstanding > 0) {
      throw new Error(`Cannot check out this guest until the full balance is paid. Outstanding: ${outstanding.toFixed(2)}`)
    }
  }

  const expectedUpdatedAt = currentBooking?.updated_at || null
  const update = { status, updated_at: new Date().toISOString() }

  const roomStatus =
    status === 'checked_in' ? 'occupied' :
    status === 'checked_out' || status === 'cancelled' ? 'available' : null

  const actionLabel = {
    checked_in: 'Check-in',
    checked_out: 'Check-out',
    cancelled: 'Booking cancelled',
    confirmed: 'Booking confirmed'
  }[status] || `Status → ${status}`

  const actionKey = {
    checked_in: 'check_in',
    checked_out: 'check_out',
    cancelled: 'booking_cancelled',
    confirmed: 'booking_confirmed'
  }[status] || 'booking_updated'

  if (isOnline) {
    const { data: booking } = await supabase
      .from('bookings').select('room_id, customer_id')
      .eq('id', id).eq('lodge_id', lodgeId).single()
    const { data: result, error } = await supabase.rpc('update_booking_status', {
      p_id: id,
      p_lodge_id: lodgeId,
      p_status: status,
      p_expected_updated_at: expectedUpdatedAt
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update booking status')
    await refreshCache('bookings', 'rooms')
    const _r = readCache('rooms').find((r) => r.id === booking?.room_id)
    const _c = readCache('customers').find((c) => c.id === booking?.customer_id)
    logActivity(actionKey, `${actionLabel} · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''}`)
    if (status === 'checked_in' || status === 'checked_out') createBackup()
  } else {
    const bookings = readCache('bookings')
    const idx = bookings.findIndex((b) => b.id === id)
    const bk = bookings[idx] || {}
    const roomId = bk.room_id
    const _stDepend = bookings[idx]?._pending_sync ? `booking-${id}` : null
    // Queue FIRST — single entry; update_booking_status updates room status atomically server-side.
    // IMPORTANT: Do NOT reintroduce set_room_status here.
    // update_booking_status RPC already updates room status atomically server-side.
    // Adding it again creates duplicate writes and potential race conditions.
    queueOperation('rpc', 'update_booking_status', {
      p_id: id,
      p_lodge_id: lodgeId,
      p_status: status,
      p_expected_updated_at: expectedUpdatedAt
    }, null, _stDepend ? { _depends_on: _stDepend } : {})
    // Cache SECOND — booking
    if (idx >= 0) bookings[idx] = { ...bookings[idx], ...update }
    writeCache('bookings', bookings)
    // Cache SECOND — room (read rooms only when needed; room variable preserved for logActivity)
    if (roomStatus && roomId) {
      const rooms = readCache('rooms')
      const rIdx = rooms.findIndex((r) => r.id === roomId)
      const room = rooms[rIdx]
      if (rIdx >= 0) rooms[rIdx] = { ...rooms[rIdx], status: roomStatus }
      writeCache('rooms', rooms)
      const _c = readCache('customers').find((c) => c.id === bk.customer_id)
      logActivity(actionKey, `${actionLabel} · ${_c?.name || 'Guest'} · Room ${room?.room_number || ''}`)
    } else {
      logActivity(actionKey, `${actionLabel} · Booking #${id}`)
    }
    if (status === 'checked_in' || status === 'checked_out') createBackup()
  }
}

export async function updateBookingPayment(id, paymentAmount, paymentMethod, type = 'payment', dependsOn = null, callerKey = null) {
  const numericAmount = Number(paymentAmount) || 0
  const currentBooking = readCache('bookings').find((b) => b.id === id) || null
  const expectedUpdatedAt = currentBooking?.updated_at || null
  if (type === 'refund') {
    if (numericAmount >= 0) throw new Error('Refund amount must be negative')
  } else if (numericAmount <= 0) {
    throw new Error('Payment amount must be greater than zero')
  }
  // Generate deterministic fallback signature (booking+status+amount) to prevent double-payments
  // even if intentKey is lost after app restart. Format: booking_id:status:amount
  const fallbackSignature = buildPaymentFallbackSignature(id, type, numericAmount, expectedUpdatedAt)
  if (type === 'payment' && !callerKey) {
    console.warn('[PAYMENT] Missing intent key — using deterministic fallback signature. Booking:', id, 'Signature:', fallbackSignature)
  }
  const idempotencyKey = callerKey
    ? createPaymentIdempotencyKey(id, type, callerKey)
    : createPaymentIdempotencyKey(id, type, null, fallbackSignature)
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_booking_payment', {
      p_booking_id:      id,
      p_lodge_id:        lodgeId,
      p_amount:          numericAmount,
      p_method:          paymentMethod || 'cash',
      p_type:            type,
      p_idempotency_key: idempotencyKey,
      p_recorded_by:     currentUser?.id || null,
      p_expected_updated_at: expectedUpdatedAt
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Payment failed')

    await refreshCache('bookings')
    const bk = readCache('bookings').find((b) => b.id === id)
    const _c = readCache('customers').find((c) => c.id === bk?.customer_id)
    const activityLabel = type === 'refund' ? 'refund_processed' : 'payment_updated'
    const verb = type === 'refund' ? 'Refund recorded' : 'Payment updated'
    logActivity(activityLabel, `${verb} · ${_c?.name || 'Guest'} · ${result.payment_status} · ${Math.abs(numericAmount).toFixed(2)} (${paymentMethod})`)
  } else {
    const cached = readCache('bookings')
    const idx = cached.findIndex((b) => b.id === id)
    if (idx >= 0) {
      const b = cached[idx]
      const newPaid = (Number(b.amount_paid) || 0) + numericAmount
      if (newPaid < 0) {
        throw new Error('Payment update would result in a negative amount paid.')
      }
      // Canonical amount owed = room total + charges; || 0 guards against null/undefined charges_total
      const totalOwed = (Number(b.total_amount) || 0) + (Number(b.charges_total) || 0)
      
      if (type === 'payment' && newPaid > totalOwed + 0.01) {
        throw new Error(`Amount paid (${newPaid.toFixed(2)}) cannot exceed total booking value (${totalOwed.toFixed(2)}).`)
      }

      // Use b._pending_sync (pre-write value) — only depend on booking creation entry;
      // avoids false dependency when booking is already synced to server
      const autoDepend  = dependsOn || (b._pending_sync ? `booking-${id}` : null)
      const paymentMeta = autoDepend ? { _depends_on: autoDepend } : {}
      // Queue FIRST — intent is durable before local state changes
      queueOperation('rpc', 'update_booking_payment', {
        p_booking_id:      id,
        p_lodge_id:        lodgeId,
        p_amount:          numericAmount,
        p_method:          paymentMethod || 'cash',
        p_type:            type,
        p_idempotency_key: idempotencyKey,
        p_recorded_by:     currentUser?.id || null,
        p_expected_updated_at: b.updated_at || null
      }, null, paymentMeta)
      // Cache SECOND
      cached[idx] = {
        ...b,
        _pending_payment: true, // local estimate — not server-confirmed; cleared by refreshCache
        _pending_sync: true,    // UI-only flag — never sent to Supabase; cleared by next refreshCache from DB
        updated_at: new Date().toISOString()
      }
      writeCache('bookings', cached)
      const _c = readCache('customers').find((c) => c.id === b.customer_id)
      const activityLabel = type === 'refund' ? 'refund_processed' : 'payment_updated'
      const verb = type === 'refund' ? 'Refund recorded (offline)' : 'Payment updated (offline)'
      logActivity(activityLabel, `${verb} · ${_c?.name || 'Guest'} · Pending sync · ${Math.abs(numericAmount).toFixed(2)} (${paymentMethod})`)
    } else {
      // Booking not found in cache — queue with no dependency (prevents false links)
      queueOperation('rpc', 'update_booking_payment', {
        p_booking_id:      id,
        p_lodge_id:        lodgeId,
        p_amount:          numericAmount,
        p_method:          paymentMethod || 'cash',
        p_type:            type,
        p_idempotency_key: idempotencyKey,
        p_recorded_by:     currentUser?.id || null,
        p_expected_updated_at: expectedUpdatedAt
      }, null, dependsOn ? { _depends_on: dependsOn } : {})
    }
  }
}

export async function getBookingPayments(bookingId) {
  if (!bookingId) return []
  // NOTE: Payment history is only available when online.
  // When offline, callers should display the booking's amount_paid and note that detailed payment history is unavailable.
  if (!isOnline) return []
  const { data, error } = await supabase.rpc('get_booking_payments', {
    p_booking_id: bookingId,
    p_lodge_id: lodgeId
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

export async function refundBooking(bookingId, options = {}) {
  try {
    const booking = (await getAllBookings()).find((entry) => entry.id === bookingId)
    if (!booking) throw new Error('Booking not found')
    const bookingStatus = String(booking.status || '').toLowerCase()
    if (bookingStatus === 'checked_in') {
      throw new Error('Refunds are not allowed while guest is checked in. Please wait until check-out or cancel the booking.')
    }

    const retainedPercent = Math.min(100, Math.max(0, Number(options.retained_percent ?? options.retainedPercent ?? 0) || 0))
    const baseAmount = Math.max(0, Number(booking.amount_paid || 0))
    if (baseAmount <= 0) throw new Error('This booking has no paid amount available to refund')

    const refundAmount = Math.round((baseAmount * ((100 - retainedPercent) / 100)) * 100) / 100
    const retainedAmount = Math.max(0, Math.round((baseAmount - refundAmount) * 100) / 100)
    if (refundAmount <= 0) throw new Error('Retained percentage leaves nothing to refund')

    const paymentMethod = options.method || 'refund'
    const notes = String(options.notes || '').trim()
    const proofReference = String(options.proof_reference ?? options.proofReference ?? '').trim()
    const approvalNote = String(options.approval_note ?? options.approvalNote ?? '').trim()
    const approverPin = String(options.approver_pin ?? options.approverPin ?? '').trim()

    if (!isOnline) throw new Error('Refund approvals require an internet connection')
    if (!proofReference) throw new Error('Proof reference is required before a refund can be approved')
    if (!approverPin) throw new Error('Manager/Admin approval PIN is required')

    const { data: approver, error: approverError } = await supabase.rpc('verify_refund_approver_pin', {
      p_lodge_id: lodgeId,
      p_pin: approverPin
    })
    if (approverError) throw new Error(approverError.message)
    if (!approver?.success) throw new Error(approver?.error || 'Invalid approval PIN or unauthorized approver')

    const { data, error } = await supabase.rpc('approve_booking_refund', {
      p_booking_id: bookingId,
      p_lodge_id: lodgeId,
      p_retained_percent: retainedPercent,
      p_method: paymentMethod,
      p_notes: notes,
      p_requested_by: currentUser?.id || null,
      p_approved_by: approver.approved_by,
      p_proof_reference: proofReference,
      p_approval_note: approvalNote
    })

    if (error) throw new Error(error.message || 'Refund failed')
    if (!data?.success) throw new Error(data?.error || 'Refund failed')

    await refreshCache('bookings')

    const customer = readCache('customers').find((entry) => entry.id === booking.customer_id)
    logActivity(
      'refund_processed',
      `Refund processed · ${customer?.name || booking.customer_name || 'Guest'} · refunded ${refundAmount.toFixed(2)} · retained ${retainedAmount.toFixed(2)} (${retainedPercent.toFixed(2)}%) · approved by ${approver?.approved_by_name || 'manager'}`
    )

    return {
      success: true,
      booking_id: bookingId,
      refund_amount: refundAmount,
      retained_amount: retainedAmount,
      retained_percent: retainedPercent,
      approved_by: approver?.approved_by || null,
      approved_by_name: approver?.approved_by_name || null
    }
  } catch (error) {
    recordCriticalError('booking.refund', error, {
      booking_id: bookingId,
      retained_percent: options?.retained_percent ?? options?.retainedPercent ?? null,
      method: options?.method || 'refund'
    })
    throw error
  }
}

function normalizeRpcProbeEnvelope(data) {
  if (Array.isArray(data)) return data[0] || null
  return data && typeof data === 'object' ? data : null
}

function isReplayContractProbeFailure(message = '') {
  return /PGRST202|42883|could not find the function|function.*does not exist|function.*not.*found|schema cache|structure of query does not match|returned record type does not match expected record type|unexpected parameter|missing required|has no parameter named|column .* does not exist/i.test(String(message || ''))
}

// P0-7: probe replay-critical RPCs with the current argument names used by the app.
// Missing/shape-mismatched contracts must fail health, while ordinary business-rule
// rejections still count as "function exists and is callable with this signature".
async function probeRpc(name, args = {}, options = {}) {
  const { expectSuccessEnvelope = true } = options
  try {
    const { data, error } = await supabase.rpc(name, args)
    if (error) {
      const message = error.message || 'Unknown error'
      if (isReplayContractProbeFailure(message) || error.code === 'PGRST202') {
        return { ok: false, message: `${name} contract mismatch — ${message}` }
      }
      return { ok: true, message: `${name} is callable (probe reached runtime validation).`, responseShapeVerified: false }
    }

    if (!expectSuccessEnvelope) {
      return { ok: true, message: `${name} is available.`, responseShapeVerified: false }
    }

    const envelope = normalizeRpcProbeEnvelope(data)
    if (!envelope || typeof envelope !== 'object' || !Object.prototype.hasOwnProperty.call(envelope, 'success')) {
      return { ok: false, message: `${name} returned an unexpected response shape.` }
    }
    return { ok: true, message: `${name} returned the expected response shape.`, responseShapeVerified: true }
  } catch (e) {
    return { ok: false, message: `${name} probe threw: ${e.message}` }
  }
}

export async function getSystemHealth() {
  const diagnostics = await getLodgeDiagnostics(lodgeId || '').catch((error) => ({ error: error.message }))
  const sync = getSyncStatus()
  const backups = getBackupInfo()
  const faults = readHealthFaults()
  const finance = {
    payments_rpc: { ok: false, message: 'Offline or not checked yet.' },
    contract: { ok: false, probes: {}, allOk: false, message: 'Not checked yet.' }
  }

  await checkOnline()
  if (isOnline && lodgeId) {
    // Existing payment ledger check
    try {
      const { error } = await supabase.rpc('get_booking_payments', {
        p_booking_id: randomUUID(),
        p_lodge_id: lodgeId
      })
      if (error) throw error
      finance.payments_rpc = { ok: true, message: 'Booking payment ledger RPC is available.' }
    } catch (e) {
      finance.payments_rpc = {
        ok: false,
        message: /get_booking_payments/i.test(e.message || '')
          ? 'Booking payment ledger RPC is missing. Run the latest checked-in finance migration.'
          : (e.message || 'Could not verify booking payment ledger RPC.')
      }
    }

    // P0-7: probe all replay-critical RPCs
    const probeBookingId = randomUUID()
    const probeCustomerId = randomUUID()
    const probeRoomId = randomUUID()
    const probeChargeId = randomUUID()
    const probePosOrderId = randomUUID()
    const probeNow = new Date().toISOString()
    const probeInvoiceNumber = `PROBE-${Date.now()}`
    const probeBookingPayload = {
      id: probeBookingId,
      customer_id: probeCustomerId,
      room_id: probeRoomId,
      check_in: '2099-12-01',
      check_out: '2099-12-02',
      adults: 1,
      children: 0,
      total_amount: 1,
      status: 'confirmed',
      payment_status: 'unpaid',
      amount_paid: 0,
      deposit_amount: 0,
      payment_method: null,
      invoice_number: probeInvoiceNumber,
      notes: 'contract probe',
      created_by: currentUser?.id || null,
      lodge_id: lodgeId,
      deposit_method: null,
      create_idempotency_key: createBookingIdempotencyKey(probeBookingId)
    }
    const rpcProbes = await Promise.all([
      probeRpc('create_booking', {
        p_lodge_id: lodgeId,
        p_customer_id: probeCustomerId,
        p_room_id: probeRoomId,
        p_check_in: probeBookingPayload.check_in,
        p_check_out: probeBookingPayload.check_out,
        p_adults: probeBookingPayload.adults,
        p_children: probeBookingPayload.children,
        p_total_amount: probeBookingPayload.total_amount,
        p_invoice_number: probeInvoiceNumber,
        p_notes: probeBookingPayload.notes,
        p_created_by: currentUser?.id || null,
        p_deposit_amount: 0,
        p_booking_id: probeBookingId,
        p_idempotency_key: createBookingIdempotencyKey(probeBookingId),
        p_deposit_method: null,
        p_allow_total_override: false
      }).then((r) => ['create_booking', r]),
      probeRpc('create_booking_record', {
        payload: probeBookingPayload
      }).then((r) => ['create_booking_record', r]),
      probeRpc('update_booking', {
        p_id: probeBookingId,
        p_lodge_id: lodgeId,
        payload: {
          notes: 'contract probe',
          expected_updated_at: probeNow
        }
      }).then((r) => ['update_booking', r]),
      probeRpc('update_booking_status', {
        p_id: probeBookingId,
        p_lodge_id: lodgeId,
        p_status: 'confirmed',
        p_expected_updated_at: probeNow
      }).then((r) => ['update_booking_status', r]),
      probeRpc('update_booking_payment', {
        p_booking_id: probeBookingId,
        p_lodge_id: lodgeId,
        p_amount: 1,
        p_method: 'cash',
        p_type: 'payment',
        p_idempotency_key: `probe:payment:${probeBookingId}`,
        p_recorded_by: currentUser?.id || null,
        p_expected_updated_at: probeNow
      }).then((r) => ['update_booking_payment', r]),
      probeRpc('create_pos_order', {
        payload: {
          lodge_id: lodgeId,
          id: probePosOrderId,
          room_id: probeRoomId,
          booking_id: null,
          walk_in_name: 'Contract Probe',
          total: 1,
          notes: 'contract probe',
          payment_method: 'folio',
          outlet_id: null,
          create_idempotency_key: `probe:pos:${probePosOrderId}`,
          created_at_client: probeNow,
          items: [
            { menu_item_id: null, item_name: 'Contract Probe', quantity: 1, unit_price: 1 }
          ]
        }
      }).then((r) => ['create_pos_order', r]),
      probeRpc('add_booking_charge', {
        p_booking_id: probeBookingId,
        p_lodge_id: lodgeId,
        p_description: 'Contract probe',
        p_category: 'other',
        p_quantity: 1,
        p_unit_price: 1,
        p_outlet_id: null,
        p_expected_updated_at: probeNow
      }).then((r) => ['add_booking_charge', r]),
      probeRpc('delete_booking_charge', {
        p_charge_id: probeChargeId,
        p_lodge_id: lodgeId,
        p_reason: 'contract probe',
        p_expected_booking_updated_at: probeNow
      }).then((r) => ['delete_booking_charge', r]),
    ])
    const probesObj = Object.fromEntries(rpcProbes)
    const allOk = Object.values(probesObj).every((p) => p.ok)
    const missing = Object.entries(probesObj).filter(([, p]) => !p.ok).map(([name]) => name)
    finance.contract = {
      ok: allOk,
      probes: probesObj,
      allOk,
      message: allOk
        ? 'All replay-critical RPCs are available.'
        : `Missing RPCs: ${missing.join(', ')} — run the latest migrations before trusting replay.`
    }
  }

  return {
    checked_at: new Date().toISOString(),
    lodge_id: lodgeId,
    online: isOnline,
    replayAuthReady,
    sync,
    backups,
    diagnostics,
    finance,
    faults
  }
}

// ─── EVENT / LODGE BOOKING ────────────────────────────────────────────────────

export async function createEventBooking(data) {
  let customerId
  let bookingCustomerDepend = null
  const eventName = String(data.event_name || '').trim()
  if (!eventName) throw new Error('Event / group name is required')
  const { nights } = validateBookingDates(data.check_in, data.check_out)
  const groupId = buildEventGroupId({
    eventName,
    checkIn: data.check_in,
    checkOut: data.check_out
  })
  const cachedExistingEvent = findCachedEventBookingByGroup(groupId)
  if (cachedExistingEvent) {
    return {
      success: true,
      idempotent: true,
      bookingId: cachedExistingEvent.id,
      count: parseEventRoomCount(cachedExistingEvent.notes) || 1,
      groupId,
      rooms: [],
      totalPrice: Number(cachedExistingEvent.total_amount || 0),
      nights
    }
  }
  const contactCustomer = {
    name: eventName,
    phone: data.contact_phone || '',
    email: data.contact_email || '',
    id_number: '',
    nationality: '',
    lodge_id: lodgeId
  }

  if (isOnline) {
    const existingEvent = await findRemoteEventBookingByGroup(groupId)
    if (existingEvent) {
      return {
        success: true,
        idempotent: true,
        bookingId: existingEvent.id,
        count: parseEventRoomCount(existingEvent.notes) || 1,
        groupId,
        rooms: [],
        totalPrice: Number(existingEvent.total_amount || 0),
        nights
      }
    }

    const { data: existing } = await supabase
      .from('customers').select('id').eq('lodge_id', lodgeId).eq('name', eventName).limit(1)
    if (existing?.length > 0) {
      customerId = existing[0].id
    } else {
      const newCustomer = { ...contactCustomer, id: randomUUID() }
      const { data: result, error } = await supabase.rpc('create_customer', { payload: newCustomer })
      if (error) throw new Error(error.message)
      if (!result?.success) throw new Error(result?.error || 'Could not create customer')
      customerId = result?.id
    }
  } else {
    const cached = readCache('customers')
    const existing = cached.find((c) => c.name === eventName)
    if (existing) {
      customerId = existing.id
      if (existing._pending_sync) {
        bookingCustomerDepend = `customer-${customerId}`
      }
    } else {
      customerId = randomUUID()
      const newCustomer = { ...contactCustomer, id: customerId, _pending_sync: true, created_at: new Date().toISOString() }
      cached.push(newCustomer)
      writeCache('customers', cached)
      // P2-15: assign a stable _queue_id so booking records can declare _depends_on
      bookingCustomerDepend = `customer-${customerId}`
      queueOperation('rpc', 'create_customer', {
        payload: {
          ...contactCustomer,
          id: customerId,
          created_at: newCustomer.created_at
        }
      }, null, { _queue_id: bookingCustomerDepend })
    }
  }

  const allRooms = await getAllRooms()
  const bookableRooms = allRooms.filter(r => r.status !== 'maintenance')

  const conflicting = isOnline
    ? (
        await supabase
          .from('bookings')
          .select('room_id')
          .eq('lodge_id', lodgeId)
          .neq('status', 'cancelled')
          .lt('check_in', data.check_out)
          .gt('check_out', data.check_in)
      ).data || []
    : readCache('bookings').filter(
        (b) =>
          b.status !== 'cancelled' &&
          b.check_in < data.check_out &&
          b.check_out > data.check_in
      )

  if (conflicting.length > 0) {
    const roomCount = new Set(conflicting.map(b => b.room_id)).size
    throw new Error(
      `Cannot create exclusive event — ${roomCount} room${roomCount !== 1 ? 's' : ''} already have bookings on these dates. Cancel or move existing bookings first.`
    )
  }

  if (bookableRooms.length === 0) {
    throw new Error('No rooms available — all rooms are under maintenance.')
  }

  const eventDailyRate = Number(data.event_daily_rate) || 0
  const totalEventPrice = eventDailyRate * nights
  const totalDeposit = Number(data.deposit_amount) || 0
  const paymentMethod = data.payment_method || 'cash'
  const eventNotes = `[GROUP:${groupId}][ROOMS:${bookableRooms.length}]${data.notes ? '\n' + data.notes : ''}`
  const representativeRoom = [...bookableRooms].sort((left, right) =>
    String(left.room_number || '').localeCompare(String(right.room_number || ''), undefined, { numeric: true, sensitivity: 'base' })
  )[0]

  const invoice_number = await getNextBookingInvoiceNumber()
  const bookingId = randomUUID()
  const eventIdempotencyKey = `event-booking:${groupId}`
  const booking = {
    id: bookingId,
    customer_id: customerId,
    room_id: representativeRoom.id,
    check_in: data.check_in,
    check_out: data.check_out,
    adults: 1,
    children: 0,
    total_amount: totalEventPrice,
    status: 'confirmed',
    payment_status: 'unpaid',
    amount_paid: 0,
    deposit_amount: totalDeposit,
    payment_method: null,
    notes: eventNotes,
    is_exclusive_event: true,
    event_daily_rate: eventDailyRate,
    invoice_number,
    created_by: data.created_by || null,
    lodge_id: lodgeId
  }

  let createdBookingId = bookingId

  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_booking_record', {
      payload: {
        ...booking,
        deposit_method: totalDeposit > 0 ? paymentMethod : null,
        create_idempotency_key: eventIdempotencyKey,
        allow_total_override: true
      }
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create event booking')
    createdBookingId = result.booking_id || bookingId
  } else {
    const newBooking = {
      ...booking,
      amount_paid: 0,
      payment_status: 'unpaid',
      _local_invoice_number: buildLocalPendingInvoiceNumber(bookingId),
      _pending_sync: true,
      _pending_payment: totalDeposit > 0,
      _sync_created_offline: true,
      _sync_state: 'pending',
      _sync_error: null,
      created_at: new Date().toISOString()
    }
    // Queue FIRST — crash before cache write means booking syncs but won't appear locally until refresh.
    queueOperation('rpc', 'create_booking_record', {
      payload: {
        ...booking,
        deposit_method: totalDeposit > 0 ? paymentMethod : null,
        create_idempotency_key: eventIdempotencyKey,
        allow_total_override: true
      }
    }, null, {
      _queue_id: `booking-${bookingId}`,
      ...(bookingCustomerDepend ? { _depends_on: bookingCustomerDepend } : {})
    })
    // Cache SECOND.
    const cachedBookings = readCache('bookings')
    cachedBookings.push(newBooking)
    writeCache('bookings', cachedBookings)
  }

  if (isOnline) await refreshCache('bookings')

  logActivity(
    'event_booking_created',
    `Exclusive event · ${eventName} · ${bookableRooms.length} room${bookableRooms.length !== 1 ? 's' : ''} · ${data.check_in} → ${data.check_out} · ${totalEventPrice.toFixed(2)}`
  )
  createBackup()

  return {
    bookingId: createdBookingId,
    count: bookableRooms.length,
    groupId,
    rooms: bookableRooms.map((r) => r.room_number),
    totalPrice: totalEventPrice,
    nights
  }
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────

export async function getOccupancyReport(startDate, endDate) {
  const rooms = await getAllRooms()
  const cachedBookingsInRange = readCache('bookings').filter(
    (b) => b.status !== 'cancelled' && b.status !== 'pending' && b.check_in <= endDate && b.check_out > startDate
  )
  let bookings = []
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('room_id, check_in, check_out, total_amount, charges_total, is_exclusive_event, status')
      .eq('lodge_id', lodgeId)
      .not('status', 'in', '("cancelled","pending")')
      .lte('check_in', endDate)
      .gt('check_out', startDate)
    if (error) throw error
    bookings = (data || []).length === 0 && cachedBookingsInRange.length > 0
      ? cachedBookingsInRange
      : (data || [])
  } catch {
    bookings = cachedBookingsInRange
  }

  // +1 for inclusive end-date: Jan 1–Jan 7 = 7 days, not 6
  const totalDays = Math.max(1, Math.round(
    (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
  ) + 1)

  return rooms.map((room) => {
    const roomBookings = bookings.filter((b) => b.room_id === room.id)
    let nights = 0
    for (const b of roomBookings) {
      const start = new Date(Math.max(new Date(b.check_in), new Date(startDate)))
      const end = new Date(Math.min(new Date(b.check_out), new Date(endDate)))
      nights += Math.max(0, Math.ceil((end - start) / (1000 * 60 * 60 * 24)))
    }
    const actualRevenue = roomBookings.reduce((sum, b) => sum + (b.total_amount || 0) + (b.charges_total || 0), 0)
    const hasEvent = roomBookings.some(b => b.is_exclusive_event)
    return {
      ...room,
      occupied_nights:  nights,
      occupancy_rate:   totalDays > 0 ? Math.round((nights / totalDays) * 100) : 0,
      actual_revenue:   actualRevenue,
      has_event:        hasEvent
    }
  })
}

async function getRevenueReportLocal(startDate, endDate) {
  const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100
  const computeInclusiveVat = (gross, vatEnabled, vatRate) => {
    const rate = vatEnabled ? Number(vatRate || 0) : 0
    if (rate <= 0) return 0
    return roundMoney((roundMoney(gross) * rate) / (100 + rate))
  }
  const paymentWindowStart = `${startDate}T00:00:00`
  const paymentWindowEnd = `${endDate}T23:59:59`

  const cachedBookingsInRange = readCache('bookings').filter(
    (b) => b.check_in >= startDate && b.check_in <= endDate
  )
  let bookings = []
  let paymentEvents = []
  try {
    const [{ data: bookingRows, error: bookingError }, { data: paymentRows, error: paymentError }] = await Promise.all([
      supabase
        .from('bookings')
        .select('id, total_amount, charges_total, amount_paid, status, payment_status, check_in, check_out, is_exclusive_event, notes, event_daily_rate, vat_enabled, vat_rate')
        .eq('lodge_id', lodgeId)
        .gte('check_in', startDate)
        .lte('check_in', endDate),
      supabase
        .from('payments')
        .select('booking_id, amount, method, type, paid_at')
        .eq('lodge_id', lodgeId)
        .gte('paid_at', paymentWindowStart)
        .lte('paid_at', paymentWindowEnd)
    ])
    if (bookingError) throw bookingError
    if (paymentError) throw paymentError
    bookings = (bookingRows || []).length === 0 && cachedBookingsInRange.length > 0
      ? cachedBookingsInRange
      : (bookingRows || [])
    paymentEvents = paymentRows || []
  } catch {
    bookings = cachedBookingsInRange
    paymentEvents = []
  }

  // Exclude cancelled bookings from all revenue aggregations.
  // Cancelled count is preserved from the raw fetch for informational reporting.
  // Guard: normalize status to '' so null/undefined values do not pass through as non-cancelled.
  const cancelledCount  = bookings.filter(b => (b.status || '') === 'cancelled').length
  // Exclude both cancelled and pending: pending online requests are not financial commitments
  const revenueBookings = bookings.filter(b => !['cancelled', 'pending'].includes(b.status || ''))
  const cancelledBookingIds = new Set(
    bookings
      .filter((booking) => (booking.status || '') === 'cancelled')
      .map((booking) => booking.id)
      .filter(Boolean)
  )
  const cancelledRetainedPayments = paymentEvents.filter((payment) => {
    if (!cancelledBookingIds.has(payment?.booking_id)) return false
    return String(payment?.type || '').toLowerCase() !== 'refund'
  })
  const retainedRevenue = cancelledRetainedPayments.reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0)
  const cancelledRetained = Array.from(new Set(cancelledRetainedPayments.map((payment) => payment.booking_id).filter(Boolean)))

  // Split revenue-eligible bookings into regular vs exclusive-event room-rows.
  // allUnits is derived from revenueBookings ONLY — cancelled bookings must not affect
  // total_bookings, avg_booking_value, or any count/average derived from allUnits.
  const regularBookings = revenueBookings.filter(b => !b.is_exclusive_event)
  const eventRows       = revenueBookings.filter(b => b.is_exclusive_event)

  // Collapse event room-rows into unique event groups (1 group = 1 event).
  // E5 FIX: accumulate charges_total from every room-row so folio charges on
  // event bookings are not silently dropped from event revenue.
  const eventGroupMap = {}
  eventRows.forEach(b => {
    const match   = b.notes?.match(/\[GROUP:([^\]]+)\]/)
    const groupId = match?.[1] || b.check_in
    if (!eventGroupMap[groupId]) {
      const nights = Math.ceil((new Date(b.check_out) - new Date(b.check_in)) / 86400000)
      eventGroupMap[groupId] = {
        group_id:        groupId,
        check_in:        b.check_in,
        check_out:       b.check_out,
        nights,
        daily_rate:      b.event_daily_rate || 0,
        total:           (b.event_daily_rate || 0) * nights,
        charges_total:   0,   // accumulated below from all room-rows
        room_count:      0,
        status:          b.status,
        payment_status:  b.payment_status,
        amount_paid:     0,
        vat_enabled:     !!b.vat_enabled,
        vat_rate:        Number(b.vat_rate || 0)
      }
    }
    eventGroupMap[groupId].room_count++
    eventGroupMap[groupId].amount_paid     += (b.amount_paid    || 0)
    // E5 FIX: sum charges_total across all rooms in this event group
    eventGroupMap[groupId].charges_total   += (b.charges_total  || 0)
  })
  const uniqueEvents   = Object.values(eventGroupMap)
  // E5 FIX: event group revenue = base (daily_rate*nights) + accumulated folio charges
  const eventRevenue   = uniqueEvents.reduce((sum, e) => sum + e.total + e.charges_total, 0)
  // Include charges_total in revenue; || 0 guards against null/undefined on older rows
  const regularRevenue = regularBookings.reduce((sum, b) => sum + (b.total_amount || 0) + (b.charges_total || 0), 0)
  const totalRevenue   = regularRevenue + eventRevenue
  const totalPaid      = regularBookings.reduce((sum, b) => sum + (b.amount_paid || 0), 0)
                       + uniqueEvents.reduce((sum, e) => sum + e.amount_paid, 0)

  // Treat each unique event as 1 booking unit for counts / averages
  const allUnits = [...regularBookings, ...uniqueEvents]

  const regularVat = regularBookings.reduce(
    (sum, b) => sum + computeInclusiveVat(
      Number(b.total_amount || 0) + Number(b.charges_total || 0),
      b.vat_enabled,
      b.vat_rate
    ),
    0
  )
  const eventVat = uniqueEvents.reduce(
    (sum, e) => sum + computeInclusiveVat(
      Number(e.total || 0) + Number(e.charges_total || 0),
      e.vat_enabled,
      e.vat_rate
    ),
    0
  )
  const vatAmount = roundMoney(regularVat + eventVat)
  const vatRatesInUse = new Set(
    revenueBookings
      .map((b) => {
        const rate = Number(b?.vat_rate || 0)
        return b?.vat_enabled && rate > 0 ? rate : null
      })
      .filter((rate) => rate !== null)
  )
  const vatRate = vatRatesInUse.size === 1 ? Array.from(vatRatesInUse)[0] : null
  const bookingPaymentByMethod = {}
  let grossCollected = 0
  let refundsIssued = 0
  let netCashCollected = 0

  for (const payment of paymentEvents) {
    const amount = Number(payment?.amount || 0)
    if (!Number.isFinite(amount) || amount === 0) continue
    netCashCollected = roundMoney(netCashCollected + amount)
    if (amount > 0) {
      grossCollected = roundMoney(grossCollected + amount)
      const method = String(payment?.method || 'unknown')
      bookingPaymentByMethod[method] = roundMoney((bookingPaymentByMethod[method] || 0) + amount)
    } else {
      refundsIssued = roundMoney(refundsIssued + Math.abs(amount))
    }
  }

  return {
    total_revenue:     totalRevenue,
    regular_revenue:   regularRevenue,
    event_revenue:     eventRevenue,
    event_count:       uniqueEvents.length,
    event_bookings:    uniqueEvents,
    total_bookings:    allUnits.length,
    avg_booking_value: allUnits.length > 0 ? totalRevenue / allUnits.length : 0,
    confirmed_count:   allUnits.filter(b => b.status === 'confirmed').length,
    checked_in_count:  allUnits.filter(b => b.status === 'checked_in').length,
    checked_out_count: allUnits.filter(b => b.status === 'checked_out').length,
    cancelled_count:   cancelledCount,
    paid_count:        allUnits.filter(b => b.payment_status === 'paid').length,
    partial_count:     allUnits.filter(b => b.payment_status === 'partial').length,
    unpaid_count:      allUnits.filter(b => !b.payment_status || b.payment_status === 'unpaid').length,
    paid_revenue:      netCashCollected,
    cash_collected:    netCashCollected,
    gross_collected:   grossCollected,
    refunds_issued:    refundsIssued,
    amount_paid_snapshot: totalPaid,
    retained_revenue:  retainedRevenue,
    retained_count:    cancelledRetained.length,
    outstanding_amount: totalRevenue - totalPaid,
    vat_enabled: vatRatesInUse.size > 0,
    vat_rate:    vatRate,
    vat_mixed:   vatRatesInUse.size > 1,
    vat_amount:  vatAmount,
    net_revenue: +(totalRevenue - vatAmount).toFixed(2),
    booking_payment_by_method: bookingPaymentByMethod
  }
}

export async function getRevenueReport(startDate, endDate) {
  if (!startDate || !endDate) throw new Error('Revenue report requires a start date and end date.')
  if (isOnline) {
    try {
      const { data, error } = await supabase.rpc('get_revenue_report', {
        p_lodge_id: lodgeId,
        p_start_date: startDate,
        p_end_date: endDate
      })
      if (error) throw error
      if (data && typeof data === 'object') return { ...data, source: 'server', as_of_range: { start: startDate, end: endDate } }
      throw new Error('Revenue report summary was empty.')
    } catch (error) {
      recordCriticalError('reports.revenue', error, {
        startDate,
        endDate,
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 })
    }
  }

  try {
    return {
      ...(await getRevenueReportLocal(startDate, endDate)),
      source: 'local',
      as_of_range: { start: startDate, end: endDate }
    }
  } catch (error) {
    recordCriticalError('reports.revenue.local', error, { startDate, endDate }, { level: 'error', limit: 120 })
    throw new Error(`Revenue report could not be generated for ${startDate} to ${endDate}: ${error?.message || 'Unknown error'}`)
  }
}

export async function getTodayBookingPaymentMix(dateValue = null) {
  if (!lodgeId) return { total_collected: 0, by_method: {}, payment_count: 0, date: null }

  const target = dateValue ? new Date(dateValue) : new Date()
  if (Number.isNaN(target.getTime())) return { total_collected: 0, by_method: {}, payment_count: 0, date: null }

  const dayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 0, 0, 0, 0)
  const dayEnd = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 23, 59, 59, 999)

  if (!isOnline) {
    return {
      total_collected: 0,
      by_method: {},
      payment_count: 0,
      date: dayStart.toISOString().slice(0, 10)
    }
  }

  const { data, error } = await supabase
    .from('payments')
    .select('amount, method, type, paid_at')
    .eq('lodge_id', lodgeId)
    .gte('paid_at', dayStart.toISOString())
    .lte('paid_at', dayEnd.toISOString())

  if (error) throw new Error(error.message)

  const byMethod = {}
  let totalCollected = 0
  let grossCollected = 0
  let refundsIssued = 0
  let paymentCount = 0

  for (const payment of data || []) {
    const type = String(payment?.type || 'payment')
    const amount = Number(payment?.amount || 0)
    if (!Number.isFinite(amount) || amount === 0) continue
    paymentCount += 1
    totalCollected += amount

    if (type === 'refund' || amount < 0) {
      refundsIssued += Math.abs(amount)
      continue
    }

    const method = String(payment?.method || 'unknown')
    byMethod[method] = Math.round(((byMethod[method] || 0) + amount) * 100) / 100
    grossCollected += amount
  }

  return {
    total_collected: Math.round(totalCollected * 100) / 100,
    gross_collected: Math.round(grossCollected * 100) / 100,
    refunds_issued: Math.round(refundsIssued * 100) / 100,
    by_method: byMethod,
    payment_count: paymentCount,
    date: dayStart.toISOString().slice(0, 10)
  }
}

async function getProfitLossLocal(start, end) {
  const [rev, pos, exps, inv, sup, conf, pool] = await Promise.all([
    getRevenueReport(start, end),
    getPosRevenueSummary(start, end),
    getExpenses(start, end),
    getInventorySpend(start, end),
    getSupplySpend(start, end),
    getConferenceRevenueSummary(start, end),
    getPoolRevenueSummary(start, end)
  ])
  const bookingRevenue    = rev.total_revenue || 0
  const posRevenue        = pos?.direct_revenue || 0
  const conferenceRevenue = conf.total || 0
  const poolRevenue       = pool.total || 0
  const totalRevenue      = bookingRevenue + posRevenue + conferenceRevenue + poolRevenue
  const totalExpenses     = exps.reduce((s, e) => s + Number(e.amount || 0), 0)
  const invCosts          = inv.total || 0
  const supCosts          = sup.total || 0
  const totalCosts        = invCosts + supCosts
  const grossProfit       = totalRevenue - totalExpenses - totalCosts
  const expByCategory     = exps.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + Number(e.amount || 0)
    return acc
  }, {})
  const vatAmount = rev.vat_amount || 0
  return {
    bookingRevenue, posRevenue, conferenceRevenue, poolRevenue, totalRevenue,
    totalExpenses, expByCategory,
    invCosts, supCosts, totalCosts,
    grossProfit,
    vatAmount,
    vatEnabled: rev.vat_enabled || false,
    vatRate:    rev.vat_rate    || 0,
    vatMixed:   rev.vat_mixed   || false,
    netRevenue: +(totalRevenue - vatAmount).toFixed(2)
  }
}

export async function getProfitLoss(start, end) {
  if (!start || !end) throw new Error('Profit and loss report requires a start date and end date.')
  if (isOnline) {
    try {
      const { data, error } = await supabase.rpc('get_profit_loss_summary', {
        p_lodge_id: lodgeId,
        p_start_date: start,
        p_end_date: end
      })
      if (error) throw error
      if (data && typeof data === 'object') return { ...data, source: 'server', as_of_range: { start, end } }
      throw new Error('Profit and loss summary was empty.')
    } catch (error) {
      recordCriticalError('reports.profit_loss', error, {
        start,
        end,
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 })
    }
  }

  try {
    return {
      ...(await getProfitLossLocal(start, end)),
      source: 'local',
      as_of_range: { start, end }
    }
  } catch (error) {
    recordCriticalError('reports.profit_loss.local', error, { start, end }, { level: 'error', limit: 120 })
    throw new Error(`Profit and loss report could not be generated for ${start} to ${end}: ${error?.message || 'Unknown error'}`)
  }
}

export async function getReportsSnapshot(today = getLocalDateKey(new Date(), LOCAL_TIME_ZONE)) {
  if (!lodgeId) throw new Error('No active lodge selected for reports snapshot.')

  if (isOnline) {
    try {
      const { data, error } = await supabase.rpc('get_reports_snapshot', {
        p_lodge_id: lodgeId,
        p_today: today
      })
      if (error) throw error
      if (data && typeof data === 'object') return { ...data, source: 'server', as_of: today }
      throw new Error('Reports snapshot was empty.')
    } catch (error) {
      console.warn('[Reports] Shared snapshot unavailable, using local fallback:', error?.message || error)
    }
  }

  const todayDate = new Date(`${today}T00:00:00`)
  const weekStartDate = new Date(todayDate)
  const weekday = weekStartDate.getDay()
  weekStartDate.setDate(weekStartDate.getDate() - (weekday === 0 ? 6 : weekday - 1))
  const weekStart = getLocalDateKey(weekStartDate, LOCAL_TIME_ZONE)
  const monthStart = `${today.slice(0, 7)}-01`
  const monthEnd = getLocalDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0), LOCAL_TIME_ZONE)
  const lastMonthStart = getLocalDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1), LOCAL_TIME_ZONE)
  const lastMonthEnd = getLocalDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth(), 0), LOCAL_TIME_ZONE)

  const [rooms, bookings, payments, expenses, posOrders, conferenceBookings, poolDayUse] = await Promise.all([
    getAllRooms().catch(() => []),
    getAllBookings().catch(() => []),
    getAllPayments().catch(() => []),
    getAllExpenses().catch(() => []),
    getAllPOSOrders().catch(() => []),
    getAllConferenceBookings().catch(() => []),
    getAllPoolDayUse().catch(() => [])
  ])

  const totalRooms = Array.isArray(rooms) ? rooms.length : 0
  const dateOnly = (value) => String(value || '').slice(0, 10)
  const inRange = (value, start, end) => {
    const day = dateOnly(value)
    return Boolean(day) && day >= start && day <= end
  }
  const revenueInRange = (start, end) => payments
    .filter((payment) => inRange(payment.paid_at, start, end))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const refundsInRange = (start, end) => payments
    .filter((payment) => inRange(payment.paid_at, start, end) && (Number(payment.amount || 0) < 0 || String(payment.type || '').toLowerCase() === 'refund'))
    .reduce((sum, payment) => sum + Math.abs(Number(payment.amount || 0)), 0)
  const overlapNights = (start, end) => bookings
    .filter((booking) => booking?.status !== 'cancelled' && booking?.check_in < end && booking?.check_out > start)
    .reduce((sum, booking) => {
      const overlapStart = booking.check_in > start ? booking.check_in : start
      const overlapEnd = booking.check_out < end ? booking.check_out : end
      return sum + Math.max(0, Math.ceil((new Date(`${overlapEnd}T00:00:00`) - new Date(`${overlapStart}T00:00:00`)) / 86400000))
    }, 0)

  const monthDays = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).getDate()
  const lastMonthDays = new Date(todayDate.getFullYear(), todayDate.getMonth(), 0).getDate()
  const unpaidBookings = bookings.filter((booking) => booking?.status !== 'cancelled' && ['partial', 'unpaid', ''].includes(String(booking?.payment_status || 'unpaid')))

  return {
    todayRev: revenueInRange(today, today),
    weekRev: revenueInRange(weekStart, today),
    monthRev: revenueInRange(monthStart, monthEnd),
    lastMonthRev: revenueInRange(lastMonthStart, lastMonthEnd),
    monthRefunds: refundsInRange(monthStart, monthEnd),
    lastMonthRefunds: refundsInRange(lastMonthStart, lastMonthEnd),
    monthOcc: totalRooms > 0 && monthDays > 0 ? Math.round((overlapNights(monthStart, getLocalDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 1), LOCAL_TIME_ZONE)) / (totalRooms * monthDays)) * 100) : 0,
    lastMonthOcc: totalRooms > 0 && lastMonthDays > 0 ? Math.round((overlapNights(lastMonthStart, monthStart) / (totalRooms * lastMonthDays)) * 100) : 0,
    currentOcc: bookings.filter((booking) => booking?.status === 'checked_in').length,
    totalRooms,
    unpaidTotal: unpaidBookings.reduce((sum, booking) => sum + Math.max(0, Number(booking.total_amount || 0) + Number(booking.charges_total || 0) - Number(booking.amount_paid || 0)), 0),
    unpaidCount: unpaidBookings.length,
    monthExpenses: expenses.filter((expense) => inRange(expense.date, monthStart, monthEnd)).reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    posRevenue: posOrders.filter((order) => order?.status !== 'voided' && inRange(order.created_at, monthStart, monthEnd)).reduce((sum, order) => sum + Number(order.total || 0), 0),
    conferenceRevenue: conferenceBookings.filter((booking) => String(booking?.payment_status || '').toLowerCase() !== 'cancelled' && inRange(booking.booking_date, monthStart, monthEnd)).reduce((sum, booking) => sum + Number(booking.total_amount || 0), 0),
    poolRevenue: poolDayUse.filter((entry) => inRange(entry.date, monthStart, monthEnd)).reduce((sum, entry) => sum + Number(entry.total || 0), 0),
    source: isOnline ? 'fallback' : 'offline',
    as_of: today
  }
}

function getOutletProfitLossBucket(outletRow) {
  const type = String(outletRow?.type || '').trim().toLowerCase()
  if (type === 'food') return 'kitchen'
  if (type === 'beverage') return 'bar'
  if (type === 'front_desk' || type === 'accommodation') return 'front_desk'
  return 'unassigned'
}

export async function getOutletProfitLoss(startDate, endDate) {
  if (isOnline) {
    try {
      const { data, error } = await supabase.rpc('get_outlet_profit_loss_summary', {
        p_lodge_id: lodgeId,
        p_start_date: startDate,
        p_end_date: endDate
      })
      if (error) throw error
      if (data && typeof data === 'object') {
        return {
          ...data,
          source: 'server',
          as_of_range: { start: startDate, end: endDate }
        }
      }
      throw new Error('Outlet profit and loss summary was empty.')
    } catch (error) {
      recordCriticalError('reports.outlet_profit_loss', error, {
        startDate,
        endDate,
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 })
    }
  }

  const cachedOutlets = readCache('outlets')
  const cachedPosRows = readCache('pos-orders').filter((order) => {
    const orderDate = String(order.created_at || '').split('T')[0]
    return (
      (order.status || '') === 'completed' &&
      (!startDate || orderDate >= startDate) &&
      (!endDate || orderDate <= endDate)
    )
  })
  const inventoryMap = new Map(readCache('inventory-items').map((item) => [item.id, item]))
  const cachedPurchaseRows = readCache('inventory-purchases')
    .filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate))
    .map((row) => ({
      ...row,
      inventory_items: inventoryMap.get(row.item_id)
        ? { outlet_id: inventoryMap.get(row.item_id).outlet_id || null }
        : null
    }))
  const cachedSupplyTotal = readCache('supply-purchases')
    .filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate))
    .reduce((sum, row) => sum + Number(row.total_cost || 0), 0)
  const cachedExpenseRows = readCache('expenses')
    .filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate))
  let outletRows = []
  let posRows = []
  let purchaseRows = []
  let expenseRows = []
  let bookingResult = null
  let confResult = { total: 0 }
  let poolResult  = { total: 0 }
  let supResult = { total: cachedSupplyTotal }

  try {
    const [
      { data: liveOutlets, error: outletError },
      { data: livePos, error: posError },
      { data: livePurchases, error: purchaseError },
      { data: liveExpenses, error: expenseError },
      liveBookingResult,
      liveConfResult,
      livePoolResult,
      liveSupplyResult
    ] = await Promise.all([
      supabase
        .from('outlets')
        .select('id, name, type')
        .eq('lodge_id', lodgeId),
      supabase
        .from('pos_orders')
        .select('total, outlet_id, payment_method')
        .eq('lodge_id', lodgeId)
        .eq('status', 'completed')
        .gte('created_at', `${startDate}T00:00:00`)
        .lte('created_at', `${endDate}T23:59:59`),
      supabase
        .from('inventory_purchases')
        .select('total_cost, inventory_items(outlet_id)')
        .eq('lodge_id', lodgeId)
        .gte('date', startDate)
        .lte('date', endDate),
      supabase
        .from('expenses')
        .select('amount, outlet_id')
        .eq('lodge_id', lodgeId)
        .gte('date', startDate)
        .lte('date', endDate),
      getRevenueReport(startDate, endDate),
      getConferenceRevenueSummary(startDate, endDate),
      getPoolRevenueSummary(startDate, endDate),
      getSupplySpend(startDate, endDate)
    ])

    if (outletError) throw outletError
    if (posError) throw posError
    if (purchaseError) throw purchaseError
    if (expenseError) throw expenseError

    outletRows = (liveOutlets || []).length === 0 && cachedOutlets.length > 0 ? cachedOutlets : (liveOutlets || [])
    posRows = (livePos || []).length === 0 && cachedPosRows.length > 0 ? cachedPosRows : (livePos || [])
    purchaseRows = (livePurchases || []).length === 0 && cachedPurchaseRows.length > 0 ? cachedPurchaseRows : (livePurchases || [])
    expenseRows = (liveExpenses || []).length === 0 && cachedExpenseRows.length > 0 ? cachedExpenseRows : (liveExpenses || [])
    bookingResult = liveBookingResult
    confResult    = liveConfResult  || { total: 0 }
    poolResult    = livePoolResult  || { total: 0 }
    supResult     = liveSupplyResult || { total: cachedSupplyTotal }
  } catch (error) {
    outletRows = cachedOutlets.length > 0 ? cachedOutlets : await getOutlets().catch(() => [])
    posRows = cachedPosRows
    purchaseRows = cachedPurchaseRows
    expenseRows = cachedExpenseRows
    bookingResult = await getRevenueReport(startDate, endDate).catch(() => null)
    supResult = { total: cachedSupplyTotal }
    if (!outletRows.length && !posRows.length && !purchaseRows.length && !expenseRows.length && isOnline) {
      throw new Error(error?.message || 'Failed to load outlet profit and loss report')
    }
  }

  const outletMap = {}
  ;(outletRows || []).forEach(o => {
    const key = getOutletProfitLossBucket(o)
    outletMap[o.id] = { key, name: o.name, type: o.type || null }
  })

  // B. Initialize buckets — always present, even if zero
  const buckets = {
    kitchen:    { key: 'kitchen',    name: 'Kitchen',    posRevenue: 0, bookingRevenue: 0, revenue: 0, inventoryCost: 0, supplyCost: 0, expenses: 0, profit: 0 },
    bar:        { key: 'bar',        name: 'Bar',        posRevenue: 0, bookingRevenue: 0, revenue: 0, inventoryCost: 0, supplyCost: 0, expenses: 0, profit: 0 },
    front_desk: { key: 'front_desk', name: 'Front Desk', posRevenue: 0, bookingRevenue: 0, revenue: 0, inventoryCost: 0, supplyCost: 0, expenses: 0, profit: 0 },
    unassigned: { key: 'unassigned', name: 'Unassigned', posRevenue: 0, bookingRevenue: 0, revenue: 0, inventoryCost: 0, supplyCost: 0, expenses: 0, profit: 0 }
  }

  // C–F: Fetch all raw data in parallel
  // C. POS revenue grouped by outlet
  ;(posRows || []).forEach(o => {
    const info = outletMap[o.outlet_id]
    const key = info?.key || 'unassigned'
    buckets[key].posRevenue += Number(o.total || 0)
  })

  const folioPosRevenue = (posRows || []).reduce(
    (sum, row) => sum + ((row.payment_method || '') === 'folio' ? Number(row.total || 0) : 0),
    0
  )

  // D. Booking + conference + pool revenue → Front Desk only, net of POS folio so combined totals do not double count.
  buckets.front_desk.bookingRevenue = Math.max(0, (bookingResult?.total_revenue || 0) - folioPosRevenue)
    + (confResult.total || 0)
    + (poolResult.total || 0)

  // E. Inventory cost grouped by outlet (JS-side — same pattern as getInventorySpend)
  ;(purchaseRows || []).forEach(p => {
    const info = outletMap[p.inventory_items?.outlet_id]
    const key = info?.key || 'unassigned'
    buckets[key].inventoryCost += Number(p.total_cost || 0)
  })

  // F. Expenses grouped by outlet
  ;(expenseRows || []).forEach(e => {
    const info = outletMap[e.outlet_id]
    const key = info?.key || 'unassigned'
    buckets[key].expenses += Number(e.amount || 0)
  })

  // G. Room supplies are accommodation costs, so keep them under Front Desk.
  buckets.front_desk.supplyCost += Number(supResult?.total || 0)

  // H. Per-outlet totals
  Object.values(buckets).forEach(b => {
    b.revenue = b.posRevenue + b.bookingRevenue
    b.profit  = b.revenue - b.inventoryCost - b.supplyCost - b.expenses
  })

  // I. Combined — built by summing outlet rows so reconciliation is guaranteed
  const combined = { posRevenue: 0, bookingRevenue: 0, revenue: 0, inventoryCost: 0, supplyCost: 0, expenses: 0, profit: 0 }
  Object.values(buckets).forEach(b => {
    combined.posRevenue     += b.posRevenue
    combined.bookingRevenue += b.bookingRevenue
    combined.revenue        += b.revenue
    combined.inventoryCost  += b.inventoryCost
    combined.supplyCost     += b.supplyCost
    combined.expenses       += b.expenses
    combined.profit         += b.profit
  })

  return {
    outlets: Object.values(buckets),
    combined,
    source: 'local',
    as_of_range: { start: startDate, end: endDate }
  }
}

export async function getDashboardStats() {
  const today = new Date().toISOString().split('T')[0]
  const thisMonth = today.substring(0, 7)

  if (isOnline) {
    try {
      const { data, error } = await supabase.rpc('get_manager_dashboard_snapshot', {
        p_lodge_id: lodgeId,
        p_today: today
      })
      if (error) throw error
      if (data && typeof data === 'object') {
        return {
          total_rooms: Number(data.totalRooms || 0),
          occupied_today: Number(data.occupied || 0),
          checkins_today: (Array.isArray(data.upcomingArrivals) ? data.upcomingArrivals : []).filter((booking) => booking?.check_in === today).length,
          checkouts_today: (Array.isArray(data.upcomingArrivals) ? data.upcomingArrivals : []).filter((booking) => booking?.check_out === today).length,
          revenue_month: Number(data.monthRevenue || 0),
          upcoming_bookings: (Array.isArray(data.upcomingArrivals) ? data.upcomingArrivals : []).length,
          outstanding_total: Number(data.outstandingTotal || 0),
          unpaid_count: Number(data.unpaidCount || 0)
        }
      }
    } catch (error) {
      console.warn('[Dashboard] Server snapshot unavailable, using legacy stats fallback:', error?.message || error)
    }

    // Run 5 targeted queries in parallel — each fetches only what it needs.
    // Previously: one select('*') with no date filter pulled the full booking history.
    const d = new Date(today)
    const monthStart = thisMonth + '-01'
    const nextMonthStart = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().split('T')[0]

    const [roomsRes, occupiedRes, todayRes, revenueRes, upcomingRes] = await Promise.all([
      // count only — HEAD request, no rows transferred
      supabase.from('rooms').select('id', { count: 'exact', head: true }).eq('lodge_id', lodgeId),
      supabase.from('bookings').select('id', { count: 'exact', head: true })
        .eq('lodge_id', lodgeId)
        .in('status', ['confirmed', 'checked_in'])
        .lte('check_in', today)
        .gt('check_out', today),
      // today's arrivals + departures only — 2 columns
      supabase.from('bookings').select('check_in, check_out')
        .eq('lodge_id', lodgeId)
        .neq('status', 'cancelled')
        .or(`check_in.eq.${today},check_out.eq.${today}`),
      // this month's revenue — 1 column, date-bounded
      supabase.from('bookings').select('total_amount, charges_total')
        .eq('lodge_id', lodgeId)
        .neq('status', 'cancelled')
        .gte('check_in', monthStart)
        .lt('check_in', nextMonthStart),
      supabase.from('bookings').select('id', { count: 'exact', head: true })
        .eq('lodge_id', lodgeId)
        .eq('status', 'confirmed')
        .gt('check_in', today)
    ])

    const monthEndStr = new Date(new Date(nextMonthStart).getTime() - 86400000).toISOString().split('T')[0]
    const [confMonthResult, poolMonthResult] = await Promise.all([
      getConferenceRevenueSummary(monthStart, monthEndStr),
      getPoolRevenueSummary(monthStart, monthEndStr)
    ])

    const todayBookings = todayRes.data || []
    const bookingRevMonth = (revenueRes.data || []).reduce((s, b) => s + (b.total_amount || 0) + (b.charges_total || 0), 0)
    return {
      total_rooms: roomsRes.count ?? 0,
      occupied_today: occupiedRes.count ?? 0,
      checkins_today: todayBookings.filter((b) => b.check_in === today).length,
      checkouts_today: todayBookings.filter((b) => b.check_out === today).length,
      revenue_month: bookingRevMonth + (confMonthResult.total || 0) + (poolMonthResult.total || 0),
      upcoming_bookings: upcomingRes.count ?? 0
    }
  }

  // Offline: aggregate from cache
  const rooms = readCache('rooms')
  const bookings = readCache('bookings')
  return {
    total_rooms: rooms.length,
    occupied_today: bookings.filter(
      (b) => ['confirmed', 'checked_in'].includes(b.status) && b.check_in <= today && b.check_out > today
    ).length,
    checkins_today: bookings.filter((b) => b.check_in === today && b.status !== 'cancelled').length,
    checkouts_today: bookings.filter((b) => b.check_out === today && b.status !== 'cancelled').length,
    revenue_month: bookings
      .filter((b) => b.check_in?.startsWith(thisMonth) && b.status !== 'cancelled')
      .reduce((s, b) => s + (b.total_amount || 0) + (b.charges_total || 0), 0),
    upcoming_bookings: bookings.filter((b) => b.check_in > today && b.status === 'confirmed').length
  }
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

export async function getTodayActivity() {
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

  if (isOnline) {
    // Previously fetched all bookings. Now filters to only today/tomorrow rows.
    const { data } = await supabase
      .from('bookings')
      .select('*')
      .eq('lodge_id', lodgeId)
      .neq('status', 'cancelled')
      .or(`check_in.in.(${today},${tomorrow}),check_out.eq.${today}`)
    const all = data || []
    return {
      checkins_today: all.filter((b) => b.check_in === today),
      checkouts_today: all.filter((b) => b.check_out === today),
      checkins_tomorrow: all.filter((b) => b.check_in === tomorrow)
    }
  }

  const bookings = readCache('bookings')
  return {
    checkins_today: bookings.filter((b) => b.check_in === today && b.status !== 'cancelled'),
    checkouts_today: bookings.filter((b) => b.check_out === today && b.status !== 'cancelled'),
    checkins_tomorrow: bookings.filter((b) => b.check_in === tomorrow && b.status !== 'cancelled')
  }
}

export async function getUpcomingCheckins() {
  const todayStr = new Date().toISOString().split('T')[0]
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const dayAfterStr = new Date(Date.now() + 172800000).toISOString().split('T')[0]

  const mapBooking = (b, customers, rooms) => {
    const customer = customers.find((c) => c.id === b.customer_id)
    const room = rooms.find((r) => r.id === b.room_id)
    return {
      ...b,
      customer_name: b.customer_name || customer?.name,
      customer_phone: b.customer_phone || customer?.phone,
      customer_email: b.customer_email || customer?.email,
      room_number: b.room_number || room?.room_number,
      room_type: b.room_type || room?.room_type
    }
  }

  let all = []
  if (isOnline) {
    const { data } = await supabase
      .from('bookings')
      .select('*, customers(name, phone, email), rooms(room_number, room_type)')
      .eq('lodge_id', lodgeId)
      .in('check_in', [todayStr, tomorrowStr, dayAfterStr])
      .neq('status', 'cancelled')
    all = (data || []).map((b) => ({
      ...b,
      customer_name: b.customers?.name,
      customer_phone: b.customers?.phone,
      customer_email: b.customers?.email,
      room_number: b.rooms?.room_number,
      room_type: b.rooms?.room_type
    }))
  } else {
    const customers = readCache('customers')
    const rooms = readCache('rooms')
    all = readCache('bookings')
      .filter((b) => [todayStr, tomorrowStr, dayAfterStr].includes(b.check_in) && b.status !== 'cancelled')
      .map((b) => mapBooking(b, customers, rooms))
  }

  return {
    today:    all.filter((b) => b.check_in === todayStr),
    tomorrow: all.filter((b) => b.check_in === tomorrowStr),
    dayAfter: all.filter((b) => b.check_in === dayAfterStr)
  }
}

// ─── BOOKING CHARGES (FOLIO) ──────────────────────────────────────────────────

export async function getBookingCharges(bookingId) {
  if (isOnline) {
    const { data } = await supabase
      .from('booking_charges')
      .select('*, outlets(name)')
      .eq('lodge_id', lodgeId)
      .eq('booking_id', bookingId)
      .is('voided_at', null)
      .order('created_at')
    return data || []
  }
  return []
}

export async function getBookingChargeById(chargeId) {
  if (!chargeId) return null
  if (isOnline) {
    const { data, error } = await supabase
      .from('booking_charges')
      .select('*')
      .eq('lodge_id', lodgeId)
      .eq('id', chargeId)
      .single()
    if (error) throw new Error(error.message)
    return data || null
  }
  return null
}

export async function addBookingCharge(bookingId, data) {
  try {
    if (Number(data.unit_price) <= 0) throw new Error('Charge unit price must be greater than zero')
    const currentBooking = readCache('bookings').find((booking) => booking.id === bookingId) || null
    if (isOnline) {
      const { data: result, error } = await supabase.rpc('add_booking_charge', {
        p_booking_id:  bookingId,
        p_lodge_id:    lodgeId,
        p_description: data.description,
        p_category:    data.category || 'other',
        p_quantity:    Number(data.quantity) || 1,
        p_unit_price:  Number(data.unit_price) || 0,
        p_outlet_id:   data.outlet_id || null,   // explicit outlet attribution; null = Unassigned
        p_expected_updated_at: currentBooking?.updated_at || null
      })
      if (error) throw new Error(error.message)
      if (!result?.success) throw new Error(result?.error || 'Could not add booking charge')
      return { success: true, id: result?.id }
    }
    return { success: false, error: 'Charges require an internet connection' }
  } catch (error) {
    recordCriticalError('booking.charge.add', error, {
      booking_id: bookingId,
      description: data?.description || '',
      amount: Number(data?.unit_price || 0) * Number(data?.quantity || 1)
    })
    throw error
  }
}

export async function deleteBookingCharge(chargeId, reason = '') {
  try {
    const charge = await getBookingChargeById(chargeId).catch(() => null)
    const currentBooking = charge?.booking_id
      ? (readCache('bookings').find((booking) => booking.id === charge.booking_id) || null)
      : null
    if (isOnline) {
      const { data: result, error } = await supabase.rpc('delete_booking_charge', {
        p_charge_id: chargeId,
        p_lodge_id: lodgeId,
        p_reason: reason || null,
        p_expected_booking_updated_at: currentBooking?.updated_at || null
      })
      if (error) throw new Error(error.message)
      if (!result?.success) throw new Error(result?.error || 'Could not void booking charge')
      return { success: true, voided: !!result?.voided }
    }
    return { success: false, error: 'Requires internet connection' }
  } catch (error) {
    recordCriticalError('booking.charge.delete', error, {
      charge_id: chargeId,
      reason: reason || null
    })
    throw error
  }
}

// ─── RATE OVERRIDES (SEASONAL / WEEKEND PRICING) ──────────────────────────────

export async function getRateOverrides() {
  if (isOnline) {
    const { data } = await supabase
      .from('room_rate_overrides')
      .select('*')
      .eq('lodge_id', lodgeId)
      .order('start_date')
    return data || []
  }
  return []
}

export async function getRateOverrideById(id) {
  if (!id || !isOnline) return null
  const { data, error } = await supabase
    .from('room_rate_overrides')
    .select('*')
    .eq('lodge_id', lodgeId)
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data || null
}

export async function createRateOverride(data) {
  const override = {
    lodge_id: lodgeId,
    room_id: data.room_id || null,
    name: data.name,
    start_date: data.start_date,
    end_date: data.end_date,
    rate_per_night: Number(data.rate_per_night)
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_room_rate_override', { payload: override })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create rate override')
    return { success: true, id: result?.id }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function updateRateOverride(id, data) {
  const update = {
    room_id: data.room_id || null,
    name: data.name,
    start_date: data.start_date,
    end_date: data.end_date,
    rate_per_night: Number(data.rate_per_night)
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_room_rate_override', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update rate override')
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function deleteRateOverride(id) {
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('delete_room_rate_override', {
      p_id: id,
      p_lodge_id: lodgeId
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not delete rate override')
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function getApplicableRate(roomId, checkIn, checkOut) {
  if (!isOnline) return null
  try {
    const { data: overrides } = await supabase
      .from('room_rate_overrides')
      .select('*')
      .eq('lodge_id', lodgeId)
      .lte('start_date', checkOut)
      .gte('end_date', checkIn)
    if (!overrides || overrides.length === 0) return null
    const specific = overrides.find((o) => o.room_id === roomId)
    const global = overrides.find((o) => !o.room_id)
    const applicable = specific || global
    return applicable ? { rate: applicable.rate_per_night, name: applicable.name } : null
  } catch {
    return null
  }
}

// ─── EXPENSES ─────────────────────────────────────────────────────────────────

export async function getExpenses(startDate, endDate, outletId = 'all') {
  const canonicalExpenses = readCache('expenses')
  const cachedExpenses = canonicalExpenses
    .filter((row) =>
      (!startDate || row.date >= startDate) &&
      (!endDate || row.date <= endDate) &&
      (
        !outletId ||
        outletId === 'all' ||
        (outletId === 'unassigned' ? !row.outlet_id : row.outlet_id === outletId)
      )
    )
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const isCanonicalExpenseLoad =
    (!outletId || outletId === 'all') &&
    startDate === '2000-01-01' &&
    endDate === '2099-12-31'
  if (isOnline) {
    let query = supabase
      .from('expenses')
      .select('*, outlets(name)')
      .eq('lodge_id', lodgeId)
    if (startDate) query = query.gte('date', startDate)
    if (endDate)   query = query.lte('date', endDate)
    if (outletId && outletId !== 'all') {
      if (outletId === 'unassigned') query = query.is('outlet_id', null)
      else                           query = query.eq('outlet_id', outletId)
    }
    const { data, error } = await query.order('date', { ascending: false })
    if (!error) {
      if ((data || []).length === 0 && cachedExpenses.length > 0) {
        console.warn('getExpenses received empty live result; using cached expenses instead')
        return cachedExpenses
      }
      if (isCanonicalExpenseLoad) {
        writeCache('expenses', data || [])
      }
      return data || []
    }
    if (cachedExpenses.length > 0) {
      console.warn('getExpenses falling back to cache:', error.message)
      return cachedExpenses
    }
    throw new Error(error.message)
  }
  return cachedExpenses
}

export async function getExpenseById(id) {
  if (!id || !isOnline) return null
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('lodge_id', lodgeId)
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data || null
}

export async function createExpense(data) {
  if (Number(data.amount) <= 0) throw new Error('Expense amount must be greater than zero')
  if (Number(data.amount) > MAX_FINANCIAL_AMOUNT) throw new Error(`Expense amount cannot exceed P${MAX_FINANCIAL_AMOUNT.toLocaleString('en-BW')}`)
  const expense = {
    lodge_id: lodgeId,
    date: data.date,
    category: data.category,
    description: data.description,
    amount: Number(data.amount),
    notes: data.notes || null,
    outlet_id: data.outlet_id || null
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_expense', { payload: expense })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create expense')
    const cached = readCache('expenses')
    writeCache('expenses', [{ ...expense, id: result?.id }, ...cached.filter((row) => row.id !== result?.id)])
    return { success: true, id: result?.id }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function updateExpense(id, data) {
  if (payloadHasAmount(data) && Number(data.amount) <= 0) throw new Error('Expense amount must be greater than zero')
  if (payloadHasAmount(data) && Number(data.amount) > MAX_FINANCIAL_AMOUNT) throw new Error(`Expense amount cannot exceed P${MAX_FINANCIAL_AMOUNT.toLocaleString('en-BW')}`)
  const update = {
    date: data.date,
    category: data.category,
    description: data.description,
    amount: Number(data.amount),
    notes: data.notes || null,
    ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {})
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_expense', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update expense')
    const cached = readCache('expenses')
    writeCache('expenses', cached.map((row) => (row.id === id ? { ...row, ...update } : row)))
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function deleteExpense(id) {
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('delete_expense', {
      p_id: id,
      p_lodge_id: lodgeId
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not delete expense')
    writeCache('expenses', readCache('expenses').filter((row) => row.id !== id))
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function getAdminExpenses() {
  return getExpenses('2000-01-01', '2099-12-31')
}

export async function createAdminExpense(data) {
  return createExpense(data)
}

export async function updateAdminExpense(id, data) {
  return updateExpense(id, data)
}

export async function deleteAdminExpense(id) {
  return deleteExpense(id)
}

// ─── MAINTENANCE TICKETS ──────────────────────────────────────────────────────

export async function getMaintenanceTickets() {
  if (isOnline) {
    const { data } = await supabase
      .from('maintenance_tickets')
      .select('*, rooms(room_number, room_type)')
      .eq('lodge_id', lodgeId)
      .order('created_at', { ascending: false })
    return (data || []).map((t) => ({
      ...t,
      title: t.title || t.issue || '',
      description: t.description || t.notes || '',
      room_number: t.rooms?.room_number,
      room_type: t.rooms?.room_type,
      labour_cost: Number(t.labour_cost || 0),
      parts_cost: Number(t.parts_cost || 0),
      total_cost: Number(t.total_cost || 0)
    }))
  }
  return []
}

export async function getMaintenanceTicketById(id) {
  if (!id || !isOnline) return null
  const { data, error } = await supabase
    .from('maintenance_tickets')
    .select('*')
    .eq('lodge_id', lodgeId)
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data || null
}

export async function createMaintenanceTicket(data) {
  const ticket = {
    lodge_id: lodgeId,
    room_id: data.room_id || null,
    title: data.title || data.issue || '',
    issue: data.issue || data.title || '',
    description: data.description || '',
    status: 'open',
    priority: data.priority || 'medium',
    reported_date: data.reported_date || new Date().toISOString().slice(0, 10),
    labour_cost: Number(data.labour_cost || 0),
    parts_cost: Number(data.parts_cost || 0),
    total_cost: Number(data.total_cost || (Number(data.labour_cost || 0) + Number(data.parts_cost || 0))),
    vendor_name: data.vendor_name || '',
    cost_notes: data.cost_notes || ''
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_maintenance_ticket', { payload: ticket })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create maintenance ticket')
    // If a room is selected, mark it as maintenance
    if (data.room_id) {
      const { data: roomResult, error: roomError } = await supabase.rpc('set_room_status', {
        p_id: data.room_id,
        p_lodge_id: lodgeId,
        p_status: 'maintenance'
      })
      if (roomError) throw new Error(roomError.message)
      if (!roomResult?.success) throw new Error(roomResult?.error || 'Could not update room status')
      await refreshCache('rooms')
    }
    return { success: true, id: result?.id }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function updateMaintenanceTicket(id, data) {
  const update = {
    title: data.title,
    issue: data.issue || data.title,
    description: data.description,
    notes: data.notes,
    priority: data.priority,
    status: data.status,
    labour_cost: data.labour_cost,
    parts_cost: data.parts_cost,
    total_cost: data.total_cost,
    vendor_name: data.vendor_name,
    cost_notes: data.cost_notes
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_maintenance_ticket', {
      p_id: String(id),
      p_lodge_id: String(lodgeId),
      payload: update
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update maintenance ticket')
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function resolveMaintenanceTicket(id, roomId) {
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('resolve_maintenance_ticket', {
      p_id: String(id),
      p_lodge_id: String(lodgeId)
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not resolve maintenance ticket')
    // Restore room status to available if no other open tickets
    if (roomId) {
      const { data: openTickets } = await supabase
        .from('maintenance_tickets')
        .select('id')
        .eq('lodge_id', lodgeId)
        .eq('room_id', roomId)
        .neq('status', 'resolved')
        .neq('id', id)
      if (!openTickets || openTickets.length === 0) {
        const { data: roomResult, error: roomError } = await supabase.rpc('set_room_status', {
          p_id: roomId,
          p_lodge_id: lodgeId,
          p_status: 'available'
        })
        if (roomError) throw new Error(roomError.message)
        if (!roomResult?.success) throw new Error(roomResult?.error || 'Could not update room status')
      }
      await refreshCache('rooms')
    }
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

// ─── ID PHOTO ─────────────────────────────────────────────────────────────────

export async function updateCustomerIdPhoto(id, photo) {
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_customer_id_photo', {
      p_id: id,
      p_lodge_id: lodgeId,
      p_photo: photo
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update customer ID photo')
    await refreshCache('customers')
    return { success: true }
  }
  // Offline: update cache
  const cached = readCache('customers')
  const idx = cached.findIndex((c) => c.id === id)
  if (idx >= 0) cached[idx] = { ...cached[idx], id_photo: photo }
  writeCache('customers', cached)
  queueOperation('rpc', 'update_customer_id_photo', {
    p_id: id,
    p_lodge_id: lodgeId,
    p_photo: photo
  })
  return { success: true }
}

export async function getCustomerById(id) {
  if (!id) return null
  if (isOnline) {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('lodge_id', lodgeId)
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)
    return data || null
  }
  return readCache('customers').find((customer) => customer.id === id) || null
}

// ─── FORECAST ─────────────────────────────────────────────────────────────────

export async function getForecast(days = 30) {
  const today = new Date().toISOString().split('T')[0]
  const future = new Date()
  future.setDate(future.getDate() + days)
  const futureStr = future.toISOString().split('T')[0]

  const [roomsData, bookingsData] = await Promise.all([
    getAllRooms(),
    isOnline
      ? supabase.from('bookings').select('check_in, check_out, status')
          .eq('lodge_id', lodgeId)
          .neq('status', 'cancelled')
          .lte('check_in', futureStr)
          .gte('check_out', today)
          .then(r => r.data || [])
      : readCache('bookings').filter(b => b.status !== 'cancelled' && b.check_in <= futureStr && b.check_out >= today)
  ])

  const totalRooms = roomsData.length || 1
  const result = []

  for (let i = 0; i < days; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    const dateStr = d.toISOString().split('T')[0]
    const occupied = bookingsData.filter(b => b.check_in <= dateStr && b.check_out > dateStr).length
    result.push({ date: dateStr, occupied, total: totalRooms, rate: Math.round((occupied / totalRooms) * 100) })
  }

  return result
}

// ─── POS (POINT OF SALE) ──────────────────────────────────────────────────────

function applyPosMenuOutletFilter(rows = [], outletFilter = null) {
  if (outletFilter !== null && outletFilter.length === 0) return []
  if (outletFilter !== null) {
    return (rows || []).filter((item) => !item.outlet_id || outletFilter.includes(item.outlet_id))
  }
  return rows || []
}

function applyPosOrderFilters(rows = [], startDate, endDate, outletFilter = null) {
  let filtered = rows || []
  if (startDate) {
    filtered = filtered.filter((order) => String(order.created_at || '') >= startDate)
  }
  if (endDate) {
    const endBoundary = `${endDate}T23:59:59`
    filtered = filtered.filter((order) => String(order.created_at || '') <= endBoundary)
  }
  if (outletFilter !== null && outletFilter.length === 0) return []
  if (outletFilter !== null) {
    filtered = filtered.filter((order) => !order.outlet_id || outletFilter.includes(order.outlet_id))
  }
  return filtered.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
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

function buildPosOrderInventoryUsage(order) {
  const items = Array.isArray(order?.pos_order_items)
    ? order.pos_order_items
    : Array.isArray(order?.items)
      ? order.items
      : []
  return buildQueuedPosInventoryUsage(items, { outletId: order?.outlet_id || null })
}

function getOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  return [...buildQueuedPosInventoryUsage(items, { outletId }).entries()]
    .map(([inventory_item_id, quantity]) => ({ inventory_item_id, quantity }))
}

function applyOfflinePosInventoryReservation(items = [], { outletId = null } = {}) {
  const usage = buildQueuedPosInventoryUsage(items, { outletId })
  if (usage.size === 0) return []
  const inventory = readCache('inventory-items')
  const next = inventory.map((item) => {
    const used = usage.get(item?.id) || 0
    if (!used) return item
    return {
      ...item,
      current_stock: Math.max(0, normalizeInventoryStockValue(item.current_stock) - used),
      _pending_sync: true,
      _sync_state: 'pending'
    }
  })
  writeCache('inventory-items', next, { source: 'local' })
  return getOfflinePosInventoryReservation(items, { outletId })
}

function applyQueuedPosInventoryReservations(remoteInventoryRows = []) {
  const queuedOrders = readSyncQueue().filter(isPosCreateOrderQueueItem)
  if (queuedOrders.length === 0) return remoteInventoryRows || []

  const usage = new Map()
  for (const item of queuedOrders) {
    const payload = item?.data?.payload || {}
    const orderUsage = buildQueuedPosInventoryUsage(payload.items || [], { outletId: payload.outlet_id || null })
    for (const [inventoryItemId, quantity] of orderUsage.entries()) {
      usage.set(inventoryItemId, (usage.get(inventoryItemId) || 0) + quantity)
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

// outletFilter: null = all outlets, [] = no access, [uuid1,...] = restrict to these outlet IDs
export async function getPosMenuItems(outletFilter = null) {
  if (isOnline) {
    let query = supabase
      .from('pos_menu_items')
      .select('*')
      .eq('lodge_id', lodgeId)
      .order('category')
      .order('name')
    const { data, error } = await query
    if (error) throw new Error(error.message)
    writeCache('pos-menu-items', data || [])
    return applyPosMenuOutletFilter(data || [], outletFilter)
  }
  return applyPosMenuOutletFilter(readCache('pos-menu-items'), outletFilter)
}

export async function getPosMenuItemById(id) {
  if (!id) return null
  try {
    const { data, error } = await supabase
      .from('pos_menu_items')
      .select('*')
      .eq('id', id)
      .eq('lodge_id', lodgeId)
      .single()
    if (error) throw error
    return data || null
  } catch {
    return readCache('pos-menu-items').find((item) => item.id === id) || null
  }
}

export async function createPosMenuItem(data) {
  const item = {
    lodge_id: lodgeId,
    name: data.name,
    category: data.category || 'Other',
    price: Number(data.price) || 0,
    is_available: data.is_available !== false,
    barcode: data.barcode || null,
    inventory_item_id: data.inventory_item_id || null,
    depletion_qty: data.inventory_item_id ? (Number(data.depletion_qty) || 1) : null,
    outlet_id: data.outlet_id || null
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_pos_menu_item', { payload: item })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create POS menu item')
    return { success: true, id: result?.id }
  }
  throw new Error('No internet connection. Please check your connection and try again.')
}

export async function updatePosMenuItem(id, data) {
  const update = {
    name: data.name,
    category: data.category,
    price: Number(data.price),
    is_available: data.is_available,
    barcode: data.barcode || null,
    inventory_item_id: data.inventory_item_id || null,
    depletion_qty: data.inventory_item_id ? (Number(data.depletion_qty) || 1) : null,
    ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {})
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_pos_menu_item', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update POS menu item')
    return { success: true }
  }
  throw new Error('No internet connection. Please check your connection and try again.')
}

export async function deletePosMenuItem(id) {
  if (!isOnline) throw new Error('No internet connection. Please check your connection and try again.')
  const { data: result, error } = await supabase.rpc('delete_pos_menu_item', {
    p_id: id,
    p_lodge_id: lodgeId
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not delete POS menu item')
  return { success: true }
}

export async function setBarPosPackTemplate(data) {
  if (!isOnline) throw new Error('No internet connection. Please check your connection and try again.')
  const payload = {
    lodge_id: lodgeId,
    inventory_item_id: data.inventory_item_id,
    pack_size: Number(data.pack_size),
    enabled: data.enabled === true
  }
  const { data: result, error } = await supabase.rpc('set_bar_pos_pack_template', { payload })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not update Bar POS template')
  return { success: true }
}

// outletFilter: null = all, [] = no access, [uuid1,...] = restrict to these outlet IDs
export async function getPosOrders(startDate, endDate, outletFilter = null) {
  if (isOnline) {
    const cachedOrders = readCache('pos-orders')
    let query = supabase
      .from('pos_orders')
      .select('*, pos_order_items(*), outlets(name)')
      .eq('lodge_id', lodgeId)
    if (startDate) query = query.gte('created_at', startDate)
    if (endDate) query = query.lte('created_at', endDate + 'T23:59:59')
    let data = null
    let error = null
    ;({ data, error } = await query.order('created_at', { ascending: false }))

    if (error) {
      if (isReadOnlySessionTouchError(error)) {
        const filteredCached = applyPosOrderFilters(cachedOrders, startDate, endDate, outletFilter)
        if (filteredCached.length > 0) {
          console.warn('getPosOrders using cache because the database session touch fix has not been applied yet:', error.message)
          return filteredCached
        }
        throw new Error(buildReadOnlySessionTouchMessage('POS history'))
      }

      let fallbackQuery = supabase
        .from('pos_orders')
        .select('*, pos_order_items(*)')
        .eq('lodge_id', lodgeId)
      if (startDate) fallbackQuery = fallbackQuery.gte('created_at', startDate)
      if (endDate) fallbackQuery = fallbackQuery.lte('created_at', endDate + 'T23:59:59')
      const fallback = await fallbackQuery.order('created_at', { ascending: false })
      data = fallback.data || []
      error = fallback.error || null
      if (error && isReadOnlySessionTouchError(error)) {
        const filteredCached = applyPosOrderFilters(cachedOrders, startDate, endDate, outletFilter)
        if (filteredCached.length > 0) {
          console.warn('getPosOrders fallback using cache because the database session touch fix has not been applied yet:', error.message)
          return filteredCached
        }
        throw new Error(buildReadOnlySessionTouchMessage('POS history'))
      }
      if (!error) {
        const outletMap = new Map((readCache('outlets') || []).map((outlet) => [outlet.id, outlet]))
        data = (data || []).map((order) => ({
          ...order,
          outlets: order.outlet_id ? { name: outletMap.get(order.outlet_id)?.name || null } : null
        }))
      }
    }

    if (error) throw new Error(error.message)
    const mergedLiveRows = mergeRemotePosOrdersWithLocalState(data || [], cachedOrders)
    writeCache('pos-orders', mergedLiveRows)
    return applyPosOrderFilters(mergedLiveRows, startDate, endDate, outletFilter)
  }
  return applyPosOrderFilters(readCache('pos-orders'), startDate, endDate, outletFilter)
}

export async function getPosVoidHistory(startDate, endDate, outletFilter = null) {
  if (!isOnline) return []

  let query = supabase
    .from('pos_override_log')
    .select('id, order_id, action, requested_by, approved_by, reason, outlet_id, created_at, users!pos_override_log_approved_by_fkey(name)')
    .eq('lodge_id', lodgeId)
    .eq('action', 'void')

  if (startDate) query = query.gte('created_at', `${startDate}T00:00:00`)
  if (endDate) query = query.lte('created_at', `${endDate}T23:59:59`)
  if (outletFilter !== null && outletFilter.length === 0) return []
  if (outletFilter !== null) query = query.in('outlet_id', outletFilter)

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  return (data || []).map((row) => ({
    ...row,
    approver_name: row?.users?.name || null
  }))
}

export async function getOutlets() {
  const normalizeOutletRows = (rows = []) =>
    (rows || [])
      .filter(Boolean)
      .filter((row) => row.is_active !== false)
      .map((row, index) => ({
        ...row,
        id: row.id ?? null,
        name: row.name || `Outlet ${index + 1}`,
        type: row.type || 'accommodation',
        sort_order: Number(row.sort_order ?? index)
      }))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))

  const buildVirtualOutlets = () => ([
    { id: null, name: 'Kitchen', type: 'food', sort_order: 1, _virtual: true },
    { id: null, name: 'Bar', type: 'beverage', sort_order: 2, _virtual: true },
    { id: null, name: 'Front Desk', type: 'accommodation', sort_order: 3, _virtual: true }
  ])

  try {
    let { data, error } = await supabase
      .from('outlets')
      .select('id, name, type, sort_order')
      .eq('lodge_id', lodgeId)
      .eq('is_active', true)
      .order('sort_order')
    if (error) {
      const fallback = await supabase
        .from('outlets')
        .select('id, name, type, is_active')
        .eq('lodge_id', lodgeId)
      data = fallback.data
      error = fallback.error
    }
    if (error) throw error

    const normalized = normalizeOutletRows(data || [])
    const cached = readCache('outlets')
    if (normalized.length === 0 && cached.length > 0) {
      console.warn('getOutlets received empty live result; using cached outlets instead')
      return cached
    }
    if (normalized.length === 0) {
      const virtual = buildVirtualOutlets()
      writeCache('outlets', virtual)
      return virtual
    }
    writeCache('outlets', normalized)
    return normalized
  } catch (error) {
    const cached = readCache('outlets')
    if (cached.length > 0) {
      console.warn('getOutlets falling back to cache:', error?.message || error)
      return cached
    }
    if (!isOnline) return buildVirtualOutlets()
    console.warn('getOutlets falling back to virtual outlets:', error?.message || error)
    const virtual = buildVirtualOutlets()
    writeCache('outlets', virtual)
    return virtual
  }
}

export async function getActiveBookingForRoom(roomId) {
  if (!isOnline) return null
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('bookings')
    .select('id, customer_id, customers(name)')
    .eq('lodge_id', lodgeId)
    .eq('room_id', roomId)
    .in('status', ['confirmed', 'checked_in'])
    .lte('check_in', today)
    .gt('check_out', today)
    .limit(1)
    .maybeSingle()
  return data
    ? {
        ...data,
        customer_name: data.customer_name || data.customers?.name || null
      }
    : null
}

export async function getPosOrderById(id) {
  if (!id) return null
  if (isOnline) {
    const { data, error } = await supabase
      .from('pos_orders')
      .select('*')
      .eq('lodge_id', lodgeId)
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)
    return data || null
  }
  return readCache('pos-orders').find((order) => order.id === id) || null
}

export async function createPosOrder(data) {
  try {
    const items = data.items || []
    const total = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0)
    const today = new Date().toISOString().split('T')[0]
    const cachedBookings = readCache('bookings')
    const cachedBooking = data.booking_id
      ? cachedBookings.find((entry) => entry?.id === data.booking_id && entry?.lodge_id === lodgeId)
      : cachedBookings.find((entry) =>
          entry?.lodge_id === lodgeId &&
          entry?.room_id === data.room_id &&
          ['confirmed', 'checked_in'].includes(String(entry?.status || '').toLowerCase()) &&
          entry?.check_in <= today &&
          entry?.check_out > today
        )
    const bookingId = cachedBooking?.id || data.booking_id || null

    if ((data.payment_method || 'cash') === 'folio' && !bookingId) {
      throw new Error('Room folio charge requires an active booking for the selected room.')
    }

    // Offline path: validate booking exists in cache before queuing the operation
    if (!isOnline) {
      // If a booking_id was explicitly provided, verify it exists in cache
      if (data.booking_id && !cachedBooking) {
        throw new Error(`Booking ${data.booking_id} not found locally. Sync the latest bookings and try again.`)
      }
      // For folio charges, ensure we have a valid booking (same as online check above, but explicit)
      if ((data.payment_method || 'cash') === 'folio' && !bookingId) {
        throw new Error('Room folio charge requires an active booking for the selected room.')
      }
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      const idempotencyKey = `pos-order:${id}`
      const inventoryReservations = getOfflinePosInventoryReservation(items)
      const lineItems = items.map((item) => ({
        id: randomUUID(),
        order_id: id,
        lodge_id: lodgeId,
        menu_item_id: item.menu_item_id || null,
        inventory_item_id: item.inventory_item_id || null,
        depletion_qty: Math.max(1, Number(item.depletion_qty || 1)),
        item_name: item.item_name,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        subtotal: Number(item.quantity || 0) * Number(item.unit_price || 0)
      }))

      queueOperation('rpc', 'create_pos_order', {
        payload: {
          lodge_id: lodgeId,
          id,
          room_id: data.room_id || null,
          booking_id: bookingId,
          walk_in_name: data.walk_in_name || null,
          total,
          notes: data.notes || null,
          payment_method: data.payment_method || 'cash',
          outlet_id: data.outlet_id || null,
          create_idempotency_key: idempotencyKey,
          created_at_client: createdAt,
          items: lineItems.map((item) => ({
            menu_item_id: item.menu_item_id,
            inventory_item_id: item.inventory_item_id || null,
            depletion_qty: Math.max(1, Number(item.depletion_qty || 1)),
            item_name: item.item_name,
            quantity: item.quantity,
            unit_price: item.unit_price
          }))
        }
      }, null, {
        _queue_id: `pos-order-${id}`,
        ...(cachedBooking?._pending_sync ? { _depends_on: `booking-${cachedBooking.id}` } : {})
      })

      const orderRow = {
        id,
        lodge_id: lodgeId,
        room_id: data.room_id || null,
        booking_id: bookingId,
        walk_in_name: data.walk_in_name || null,
        outlet_id: data.outlet_id || null,
        notes: data.notes || null,
        payment_method: data.payment_method || 'cash',
        total,
        status: 'completed',
        created_at: createdAt,
        _pending_sync: true,
        _sync_state: 'pending',
        _sync_error: null,
        _idempotency_key: idempotencyKey,
        _sync_created_offline: true,
        pos_order_items: lineItems
      }

      const cachedOrders = readCache('pos-orders')
      cachedOrders.unshift(orderRow)
      writeCache('pos-orders', cachedOrders)

      const cachedLineItems = readCache('pos-order-items')
      writeCache('pos-order-items', [...lineItems, ...cachedLineItems])
      applyOfflinePosInventoryReservation(inventoryReservations)

      return { success: true, id, offline: true }
    }

    // Resolve booking ID before entering the transaction (read-only, safe outside)
    let bookingIdForRpc = bookingId
    if (data.room_id && !bookingIdForRpc) {
      const booking = await getActiveBookingForRoom(data.room_id)
      bookingIdForRpc = booking?.id || null
    }

    // All DB writes are delegated to a single Postgres transaction via RPC.
    // If any step fails, Postgres rolls back the entire operation automatically.
    const { data: result, error } = await supabase.rpc('create_pos_order', {
      payload: {
        lodge_id: lodgeId,
        room_id: data.room_id || null,
        booking_id: bookingIdForRpc,
        walk_in_name: data.walk_in_name || null,
        total,
      notes: data.notes || null,
      payment_method: data.payment_method || 'cash',
      outlet_id: data.outlet_id || null,
      items: items.map((i) => ({
        menu_item_id: i.menu_item_id || null,
        inventory_item_id: i.inventory_item_id || null,
        depletion_qty: Math.max(1, Number(i.depletion_qty || 1)),
        item_name: i.item_name,
        quantity: i.quantity,
        unit_price: i.unit_price
      }))
    }
    })

    if (error) throw new Error(error.message)
    return result // { id: '...', success: true }
  } catch (error) {
    recordCriticalError('pos.order.create', error, {
      room_id: data?.room_id || null,
      booking_id: data?.booking_id || null,
      outlet_id: data?.outlet_id || null,
      payment_method: data?.payment_method || 'cash'
    })
    throw error
  }
}

export async function voidPosOrder(id) {
  try {
    // Check if order is already voided in cache
    const cachedOrders = readCache('pos-orders')
    const cachedOrder = cachedOrders.find((o) => o?.id === id && o?.lodge_id === lodgeId)
    if (cachedOrder?.status === 'voided') {
      return { success: false, error: 'This order is already voided.' }
    }

    if (isOnline) {
      const { data: result, error } = await supabase.rpc('void_pos_order', {
        p_id: id,
        p_lodge_id: lodgeId
      })
      if (error) throw new Error(error.message)
      if (!result?.success) return { success: false, error: result?.error || 'Could not void order' }
      return { success: true }
    }
    return { success: false, error: 'Requires internet connection' }
  } catch (error) {
    recordCriticalError('pos.order.void', error, { order_id: id })
    throw error
  }
}

async function _getApproverCandidates() {
  const { data, error } = await supabase
    .from('users')
    .select('id, role, pin_hash')
    .eq('lodge_id', lodgeId)
    .not('pin_hash', 'is', null)
    .in('role', ['supervisor', 'manager', 'admin', 'super_admin'])

  if (error) throw new Error(error.message)
  return data || []
}

export async function approvePosVoidWithPin(payload) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }

  const { order_id, pin, reason, cashier_user_id, outlet_id } = payload || {}

  if (!order_id || !pin) {
    return { success: false, error: 'Order and PIN are required' }
  }

  const candidates = await _getApproverCandidates()

  let approver = null
  for (const candidate of candidates) {
    if (candidate?.pin_hash && bcrypt.compareSync(String(pin).trim(), candidate.pin_hash)) {
      approver = candidate
      break
    }
  }

  if (!approver) {
    return { success: false, error: 'Invalid PIN or unauthorized approver' }
  }

  const approverRole = normalizeAppRole(approver.role)
  const approverCaps = getRoleCapabilities(approverRole, { pos: true })
  if (!approverCaps?.['pos.void']) {
    return { success: false, error: 'Invalid PIN or unauthorized approver' }
  }

  const { data: result, error } = await supabase.rpc('approve_pos_void_with_pin', {
    payload: {
      order_id,
      lodge_id: lodgeId,
      requested_by: cashier_user_id || null,
      approved_by: approver.id,
      reason: reason || null,
      outlet_id: outlet_id || null
    }
  })

  if (error) throw new Error(error.message)
  if (!result?.success) return { success: false, error: result?.error || 'Could not void order' }
  return { success: true }
}

// ─── INVENTORY ────────────────────────────────────────────────────────────────

export async function getInventoryItems() {
  if (isOnline) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('lodge_id', lodgeId)
      .order('category')
      .order('name')
    if (!error) {
      if ((!data || data.length === 0)) {
        const cached = readCache('inventory-items')
        if (cached.length > 0) {
          console.warn('getInventoryItems received empty live result; using cached inventory items instead')
          return cached
        }
      }
      const rows = applyQueuedPosInventoryReservations(data || [])
      writeCache('inventory-items', rows)
      return rows
    }
    const cached = readCache('inventory-items')
    if (cached.length > 0) {
      console.warn('getInventoryItems falling back to cache:', error.message)
      return cached
    }
    throw new Error(error.message)
  }
  return readCache('inventory-items')
}

export async function getInventoryItemById(id) {
  if (!id) return null
  try {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', id)
      .eq('lodge_id', lodgeId)
      .single()
    if (error) throw error
    return data || null
  } catch {
    return readCache('inventory-items').find((item) => item.id === id) || null
  }
}

export async function createInventoryItem(data) {
  const item = {
    lodge_id: lodgeId,
    name: data.name,
    category: data.category || 'Bar',
    unit: data.unit || 'unit',
    current_stock: Number(data.current_stock) || 0,
    reorder_level: Number(data.reorder_level) || 0,
    latest_unit_cost: 0,
    selling_price: Number(data.selling_price) || 0,
    outlet_id: data.outlet_id || null
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_inventory_item', { payload: item })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create inventory item')
    const cached = readCache('inventory-items')
    writeCache('inventory-items', [...cached, { ...item, id: result?.id }])
    return { success: true, id: result?.id }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function updateInventoryItem(id, data) {
  const update = {
    name: data.name,
    category: data.category,
    unit: data.unit,
    reorder_level: Number(data.reorder_level) || 0,
    ...(Object.prototype.hasOwnProperty.call(data, 'selling_price')
      ? { selling_price: Number(data.selling_price) || 0 }
      : {}),
    ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {})
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_inventory_item', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update inventory item')
    const cached = readCache('inventory-items')
    writeCache('inventory-items', cached.map((row) => (row.id === id ? { ...row, ...update } : row)))
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function deleteInventoryItem(id) {
  if (!isOnline) throw new Error('No internet connection. Please check your connection and try again.')
  const { data: result, error } = await supabase.rpc('delete_inventory_item', {
    p_id: id,
    p_lodge_id: lodgeId
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not delete inventory item')
  writeCache('inventory-items', readCache('inventory-items').filter((row) => row.id !== id))
  writeCache('inventory-purchases', readCache('inventory-purchases').filter((row) => row.item_id !== id))
  return { success: true }
}

export async function addInventoryPurchase(data) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const qty = Number(data.quantity_purchased)
  const cost = Number(data.total_cost)
  const unitCost = qty > 0 ? cost / qty : 0

  const purchase = {
    lodge_id: lodgeId,
    item_id: data.item_id,
    date: data.date,
    quantity_purchased: qty,
    total_cost: cost,
    unit_cost: unitCost,
    notes: data.notes || null
  }
  const { data: result, error } = await supabase.rpc('add_inventory_purchase', { payload: purchase })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not record inventory purchase')
  const items = readCache('inventory-items')
  writeCache('inventory-items', items.map((row) => row.id === data.item_id
    ? {
        ...row,
        current_stock: Number(row.current_stock || 0) + qty,
        latest_unit_cost: unitCost
      }
    : row
  ))
  const cachedPurchases = readCache('inventory-purchases')
  writeCache('inventory-purchases', [
    { ...purchase, id: result?.id || `local-${Date.now()}` },
    ...cachedPurchases
  ])
  return { success: true }
}

export async function getInventoryPurchases(itemId) {
  if (!isOnline) return []
  const { data, error } = await supabase
    .from('inventory_purchases')
    .select('*')
    .eq('lodge_id', lodgeId)
    .eq('item_id', itemId)
    .order('date', { ascending: false })
  if (!error) {
    const cached = readCache('inventory-purchases').filter((row) => row.item_id !== itemId)
    writeCache('inventory-purchases', [...(data || []), ...cached])
    return data || []
  }
  const cached = readCache('inventory-purchases').filter((row) => row.item_id === itemId)
  if (cached.length > 0) {
    console.warn('getInventoryPurchases falling back to cache:', error.message)
    return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  }
  throw new Error(error.message)
}

export async function adjustInventoryStock(itemId, delta, notes) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const { data: result, error } = await supabase.rpc('adjust_inventory_stock', {
    p_item_id: itemId,
    p_lodge_id: lodgeId,
    p_delta: Number(delta),
    p_notes: notes || null
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not adjust inventory stock')
  // Update cache with RPC result. Treat cache failures as non-fatal (backend is source of truth).
  try {
    const cached = readCache('inventory-items')
    writeCache('inventory-items', cached.map((row) => row.id === itemId
      ? { ...row, current_stock: result?.new_stock ?? row.current_stock }
      : row
    ))
  } catch (e) {
    console.warn('[INVENTORY] Cache update failed after RPC succeeded:', e)
    // Continue anyway — the backend state is correct, cache is secondary
  }
  return { success: true, new_stock: result?.new_stock }
}

export async function getInventoryStocktakes(limit = 12) {
  if (!isOnline) return []
  const { data, error } = await supabase
    .from('inventory_stocktakes')
    .select('*, outlets(name, type)')
    .eq('lodge_id', lodgeId)
    .order('created_at', { ascending: false })
    .limit(Number(limit || 12))
  if (error) throw new Error(error.message)
  return (data || []).map((row) => ({
    ...row,
    outlet_name: row.outlets?.name || null,
    outlet_type: row.outlets?.type || null
  }))
}

export async function createInventoryStocktakeSession(data = {}) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const payload = {
    lodge_id: lodgeId,
    outlet_id: data.outlet_id || null,
    title: data.title || null,
    notes: data.notes || null,
    created_by: currentUser?.id || null
  }
  const { data: result, error } = await supabase.rpc('create_inventory_stocktake_session', { payload })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not start inventory stock take')
  return result
}

export async function getInventoryStocktakeSession(stocktakeId) {
  if (!isOnline) return null
  const [{ data: header, error: headerError }, { data: lines, error: linesError }] = await Promise.all([
    supabase
      .from('inventory_stocktakes')
      .select('*, outlets(name, type)')
      .eq('lodge_id', lodgeId)
      .eq('id', stocktakeId)
      .maybeSingle(),
    supabase
      .from('inventory_stocktake_lines')
      .select('*, inventory_items(name, category, unit, outlet_id)')
      .eq('lodge_id', lodgeId)
      .eq('stocktake_id', stocktakeId)
      .order('created_at', { ascending: true })
  ])
  if (headerError) throw new Error(headerError.message)
  if (linesError) throw new Error(linesError.message)
  if (!header) return null
  return {
    ...header,
    outlet_name: header.outlets?.name || null,
    outlet_type: header.outlets?.type || null,
    lines: (lines || []).map((line) => ({
      ...line,
      item_name: line.inventory_items?.name || 'Item',
      item_category: line.inventory_items?.category || 'Other',
      item_unit: line.inventory_items?.unit || 'unit',
      outlet_id: line.inventory_items?.outlet_id || null
    }))
  }
}

export async function getInventoryStocktakeById(stocktakeId) {
  if (!stocktakeId) return null
  try {
    const { data, error } = await supabase
      .from('inventory_stocktakes')
      .select('*')
      .eq('id', stocktakeId)
      .eq('lodge_id', lodgeId)
      .maybeSingle()
    if (error) throw error
    return data || null
  } catch {
    return null
  }
}

export async function saveInventoryStocktakeCounts(stocktakeId, lines) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const payload = (Array.isArray(lines) ? lines : []).map((line) => ({
    item_id: line.item_id,
    counted_qty: line.counted_qty,
    notes: line.notes || null
  }))
  const { data: result, error } = await supabase.rpc('save_inventory_stocktake_counts', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: lodgeId,
    p_lines: payload
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not save inventory stock take')
  return result
}

export async function postInventoryStocktakeSession(stocktakeId, notes) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const { data: result, error } = await supabase.rpc('post_inventory_stocktake_session', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: lodgeId,
    p_notes: notes || null
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not post inventory stock take')
  await getInventoryItems().catch(() => {})
  return result
}

// ─── ROOM SUPPLIES ────────────────────────────────────────────────────────────

export async function getSupplyItems() {
  try {
    const { data, error } = await supabase
      .from('supply_items')
      .select('*')
      .eq('lodge_id', lodgeId)
      .order('category')
      .order('name')
    if (error) throw error
    const cached = readCache('supply-items')
    if ((data || []).length === 0 && cached.length > 0) {
      console.warn('getSupplyItems received empty live result; using cached supply items instead')
      return cached
    }
    writeCache('supply-items', data || [])
    return data || []
  } catch (error) {
    const cached = readCache('supply-items')
    if (cached.length > 0) {
      console.warn('getSupplyItems falling back to cache:', error?.message || error)
      return cached
    }
    if (!isOnline) return []
    throw new Error(error?.message || 'Failed to load supply items')
  }
}

export async function getSupplyItemById(id) {
  if (!id) return null
  try {
    const { data, error } = await supabase
      .from('supply_items')
      .select('*')
      .eq('id', id)
      .eq('lodge_id', lodgeId)
      .single()
    if (error) throw error
    return data || null
  } catch {
    return readCache('supply-items').find((item) => item.id === id) || null
  }
}

export async function createSupplyItem(data) {
  const item = {
    lodge_id: lodgeId,
    name: data.name,
    category: data.category || 'Bathroom',
    unit: data.unit || 'piece',
    current_stock: Number(data.current_stock || 0),
    reorder_level: Number(data.reorder_level || 0),
    latest_unit_cost: 0
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_supply_item', { payload: item })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create supply item')
    const cached = readCache('supply-items')
    writeCache('supply-items', [...cached, { ...item, id: result?.id }])
    return { success: true, id: result?.id }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function updateSupplyItem(id, data) {
  const update = {
    name: data.name,
    category: data.category,
    unit: data.unit,
    reorder_level: Number(data.reorder_level || 0)
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_supply_item', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update supply item')
    const cached = readCache('supply-items')
    writeCache('supply-items', cached.map((row) => (row.id === id ? { ...row, ...update } : row)))
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function deleteSupplyItem(id) {
  if (!isOnline) throw new Error('No internet connection. Please check your connection and try again.')
  const { data: result, error } = await supabase.rpc('delete_supply_item', {
    p_id: id,
    p_lodge_id: lodgeId
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not delete supply item')
  writeCache('supply-items', readCache('supply-items').filter((row) => row.id !== id))
  writeCache('supply-purchases', readCache('supply-purchases').filter((row) => row.item_id !== id))
  writeCache('room-supply-stock', readCache('room-supply-stock').filter((row) => row.supply_item_id !== id))
  writeCache('room-supply-movements', readCache('room-supply-movements').filter((row) => row.supply_item_id !== id))
  return { success: true }
}

export async function addSupplyPurchase(data) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const qty = Number(data.quantity_purchased)
  const cost = Number(data.total_cost)
  const unitCost = qty > 0 ? cost / qty : 0

  const purchase = {
    lodge_id: lodgeId,
    item_id: data.item_id,
    date: data.date,
    quantity_purchased: qty,
    total_cost: cost,
    unit_cost: unitCost,
    notes: data.notes || null
  }
  const { data: result, error } = await supabase.rpc('add_supply_purchase', { payload: purchase })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not record supply purchase')
  const supplyItems = readCache('supply-items')
  writeCache('supply-items', supplyItems.map((row) => row.id === data.item_id
    ? {
        ...row,
        latest_unit_cost: unitCost,
        current_stock: result?.new_stock ?? (Number(row.current_stock || 0) + qty)
      }
    : row
  ))
  const cachedPurchases = readCache('supply-purchases')
  writeCache('supply-purchases', [
    { ...purchase, id: result?.id || `local-${Date.now()}` },
    ...cachedPurchases
  ])
  return { success: true, unit_cost: unitCost, new_stock: result?.new_stock }
}

export async function getSupplyPurchases(itemId) {
  try {
    const { data, error } = await supabase
      .from('supply_purchases')
      .select('*')
      .eq('lodge_id', lodgeId)
      .eq('item_id', itemId)
      .order('date', { ascending: false })
    if (error) throw error
    const cached = readCache('supply-purchases').filter((row) => row.item_id !== itemId)
    writeCache('supply-purchases', [...(data || []), ...cached])
    return data || []
  } catch (error) {
    const cached = readCache('supply-purchases').filter((row) => row.item_id === itemId)
    if (cached.length > 0) {
      console.warn('getSupplyPurchases falling back to cache:', error?.message || error)
      return cached.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    }
    if (!isOnline) return []
    throw new Error(error?.message || 'Failed to load supply purchases')
  }
}

export async function saveRoomSupplyAllocations(weekStart, allocations) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const rows = allocations
    .filter((a) => Number(a.units_used) > 0)
    .map((a) => ({
      lodge_id: lodgeId,
      supply_item_id: a.supply_item_id,
      room_id: a.room_id,
      week_start: weekStart,
      units_used: Number(a.units_used),
      unit_cost: Number(a.unit_cost),
      total_cost: Number(a.units_used) * Number(a.unit_cost)
    }))
  const { data: result, error } = await supabase.rpc('save_room_supply_allocations', {
    p_lodge_id: lodgeId,
    p_week_start: weekStart,
    p_allocations: rows
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not save room supply allocations')
  return { success: true }
}

export async function getRoomSupplyAllocations(startDate, endDate) {
  const cachedAllocations = readCache('room-supply-allocations').filter((row) => {
    const entryDate = String(row.entry_date || row.week_start || '')
    return (!startDate || entryDate >= startDate) && (!endDate || entryDate <= endDate)
  })
  if (!isOnline) return cachedAllocations

  try {
    let movementQuery = supabase
      .from('room_supply_movements')
      .select('*, supply_items(name, unit, category), rooms(room_number)')
      .eq('lodge_id', lodgeId)
      .eq('movement_type', 'use')
    if (startDate) movementQuery = movementQuery.gte('created_at', `${startDate}T00:00:00`)
    if (endDate) movementQuery = movementQuery.lte('created_at', `${endDate}T23:59:59`)
    const { data: movementData, error: movementError } = await movementQuery.order('created_at', { ascending: false })
    if (movementError) throw movementError

    const movementRows = (movementData || []).map((row) => ({
      id: row.id,
      source: 'movement',
      entry_date: String(row.created_at || '').split('T')[0],
      week_start: null,
      room_id: row.room_id,
      room_number: row.rooms?.room_number,
      supply_item_id: row.supply_item_id,
      supply_name: row.supply_items?.name,
      supply_unit: row.supply_items?.unit,
      supply_category: row.supply_items?.category,
      units_used: Number(row.quantity || 0),
      unit_cost: Number(row.unit_cost || 0),
      total_cost: Number(row.total_cost || 0),
      notes: row.notes || '',
      created_at: row.created_at
    }))

    if (movementRows.length > 0) {
      writeCache('room-supply-allocations', movementRows)
      return movementRows
    }

    let allocationQuery = supabase
      .from('room_supply_allocations')
      .select('*, supply_items(name, unit, category), rooms(room_number)')
      .eq('lodge_id', lodgeId)
    if (startDate) allocationQuery = allocationQuery.gte('week_start', startDate)
    if (endDate) allocationQuery = allocationQuery.lte('week_start', endDate)
    const { data: allocationData, error: allocationError } = await allocationQuery.order('week_start', { ascending: false })
    if (allocationError) throw allocationError
    const rows = (allocationData || []).map((a) => ({
      ...a,
      source: 'allocation',
      entry_date: a.week_start,
      supply_name: a.supply_items?.name,
      supply_unit: a.supply_items?.unit,
      supply_category: a.supply_items?.category,
      room_number: a.rooms?.room_number
    }))
    writeCache('room-supply-allocations', rows)
    return rows
  } catch (error) {
    if (cachedAllocations.length > 0) {
      console.warn('getRoomSupplyAllocations falling back to cache:', error?.message || error)
      return cachedAllocations
    }
    throw new Error(error?.message || 'Failed to load room supply cost data')
  }
}

export async function getSupplyAllocationsForWeek(weekStart) {
  if (!isOnline) return []
  const { data } = await supabase
    .from('room_supply_allocations')
    .select('*')
    .eq('lodge_id', lodgeId)
    .eq('week_start', weekStart)
  return data || []
}

export async function adjustSupplyStock(itemId, delta, notes) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const { data: result, error } = await supabase.rpc('adjust_supply_stock', {
    p_item_id: itemId,
    p_lodge_id: lodgeId,
    p_delta: Number(delta),
    p_notes: notes || null
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not adjust supply stock')
  const cached = readCache('supply-items')
  writeCache('supply-items', cached.map((row) => row.id === itemId
    ? { ...row, current_stock: result?.new_stock ?? row.current_stock }
    : row
  ))
  return { success: true, new_stock: result?.new_stock }
}

export async function getRoomSupplyStock() {
  try {
    const { data, error } = await supabase
      .from('room_supply_room_stock')
      .select('*, rooms(room_number, room_type), supply_items(name, unit, category)')
      .eq('lodge_id', lodgeId)
      .order('updated_at', { ascending: false })
    if (error) throw error
    const rows = (data || []).map((row) => ({
      ...row,
      room_number: row.rooms?.room_number,
      room_type: row.rooms?.room_type,
      supply_name: row.supply_items?.name,
      supply_unit: row.supply_items?.unit,
      supply_category: row.supply_items?.category
    }))
    writeCache('room-supply-stock', rows)
    return rows
  } catch (error) {
    const cached = readCache('room-supply-stock')
    if (cached.length > 0) {
      console.warn('getRoomSupplyStock falling back to cache:', error?.message || error)
      return cached
    }
    if (!isOnline) return []
    throw new Error(error?.message || 'Failed to load room supply stock')
  }
}

export async function loadSupplyToRoom(data) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const payload = {
    lodge_id: lodgeId,
    item_id: data.item_id,
    room_id: data.room_id,
    quantity: Number(data.quantity),
    reorder_level: Number(data.reorder_level || 0),
    notes: data.notes || null
  }
  const { data: result, error } = await supabase.rpc('load_supply_to_room', { payload })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not load supply to room')
  return {
    success: true,
    new_store_stock: result?.new_store_stock,
    new_room_stock: result?.new_room_stock
  }
}

export async function useSupplyInRoom(data) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const payload = {
    lodge_id: lodgeId,
    item_id: data.item_id,
    room_id: data.room_id,
    quantity: Number(data.quantity),
    notes: data.notes || null
  }
  const { data: result, error } = await supabase.rpc('use_room_supply_stock', { payload })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not record supply usage')
  return {
    success: true,
    new_room_stock: result?.new_room_stock
  }
}

export async function returnSupplyFromRoom(data) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const payload = {
    lodge_id: lodgeId,
    item_id: data.item_id,
    room_id: data.room_id,
    quantity: Number(data.quantity),
    notes: data.notes || null
  }
  const { data: result, error } = await supabase.rpc('return_room_supply_to_store', { payload })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not return unused supply')
  return {
    success: true,
    new_room_stock: result?.new_room_stock,
    new_store_stock: result?.new_store_stock
  }
}

export async function getSupplyMovements(limit = 40) {
  try {
    const { data, error } = await supabase
      .from('room_supply_movements')
      .select('*, rooms(room_number, room_type), supply_items(name, unit, category)')
      .eq('lodge_id', lodgeId)
      .order('created_at', { ascending: false })
      .limit(Number(limit || 40))
    if (error) throw error
    const rows = (data || []).map((row) => ({
      ...row,
      room_number: row.rooms?.room_number,
      room_type: row.rooms?.room_type,
      supply_name: row.supply_items?.name,
      supply_unit: row.supply_items?.unit,
      supply_category: row.supply_items?.category
    }))
    writeCache('room-supply-movements', rows)
    return rows
  } catch (error) {
    const cached = readCache('room-supply-movements')
    if (cached.length > 0) {
      console.warn('getSupplyMovements falling back to cache:', error?.message || error)
      return cached.slice(0, Number(limit || 40))
    }
    if (!isOnline) return []
    throw new Error(error?.message || 'Failed to load supply movements')
  }
}

export async function getSupplyStocktakes(limit = 12) {
  if (!isOnline) return []
  const { data, error } = await supabase
    .from('supply_stocktakes')
    .select('*')
    .eq('lodge_id', lodgeId)
    .order('created_at', { ascending: false })
    .limit(Number(limit || 12))
  if (error) throw new Error(error.message)
  return data || []
}

export async function getRoomSupplyStocktakes(limit = 12) {
  if (!isOnline) return []
  const { data, error } = await supabase
    .from('room_supply_stocktakes')
    .select('*')
    .eq('lodge_id', lodgeId)
    .order('created_at', { ascending: false })
    .limit(Number(limit || 12))
  if (error) throw new Error(error.message)
  return data || []
}

export async function createSupplyStocktakeSession(data = {}) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const payload = {
    lodge_id: lodgeId,
    title: data.title || null,
    notes: data.notes || null,
    created_by: currentUser?.id || null
  }
  const { data: result, error } = await supabase.rpc('create_supply_stocktake_session', { payload })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not start supply stock take')
  return result
}

export async function createRoomSupplyStocktakeSession(data = {}) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const payload = {
    lodge_id: lodgeId,
    title: data.title || null,
    notes: data.notes || null,
    created_by: currentUser?.id || null
  }
  const { data: result, error } = await supabase.rpc('create_room_supply_stocktake_session', { payload })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not start room stock take')
  return result
}

export async function getSupplyStocktakeSession(stocktakeId) {
  if (!isOnline) return null
  const [{ data: header, error: headerError }, { data: lines, error: linesError }] = await Promise.all([
    supabase
      .from('supply_stocktakes')
      .select('*')
      .eq('lodge_id', lodgeId)
      .eq('id', stocktakeId)
      .maybeSingle(),
    supabase
      .from('supply_stocktake_lines')
      .select('*, supply_items(name, category, unit)')
      .eq('lodge_id', lodgeId)
      .eq('stocktake_id', stocktakeId)
      .order('created_at', { ascending: true })
  ])
  if (headerError) throw new Error(headerError.message)
  if (linesError) throw new Error(linesError.message)
  if (!header) return null
  return {
    ...header,
    lines: (lines || []).map((line) => ({
      ...line,
      line_key: line.item_id,
      item_name: line.supply_items?.name || 'Item',
      item_category: line.supply_items?.category || 'Other',
      item_unit: line.supply_items?.unit || 'piece'
    }))
  }
}

export async function getSupplyStocktakeById(stocktakeId) {
  if (!stocktakeId) return null
  try {
    const { data, error } = await supabase
      .from('supply_stocktakes')
      .select('*')
      .eq('id', stocktakeId)
      .eq('lodge_id', lodgeId)
      .maybeSingle()
    if (error) throw error
    return data || null
  } catch {
    return null
  }
}

export async function getRoomSupplyStocktakeSession(stocktakeId) {
  if (!isOnline) return null
  const [{ data: header, error: headerError }, { data: lines, error: linesError }] = await Promise.all([
    supabase
      .from('room_supply_stocktakes')
      .select('*')
      .eq('lodge_id', lodgeId)
      .eq('id', stocktakeId)
      .maybeSingle(),
    supabase
      .from('room_supply_stocktake_lines')
      .select('*, rooms(room_number, room_type), supply_items(name, category, unit)')
      .eq('lodge_id', lodgeId)
      .eq('stocktake_id', stocktakeId)
      .order('created_at', { ascending: true })
  ])
  if (headerError) throw new Error(headerError.message)
  if (linesError) throw new Error(linesError.message)
  if (!header) return null
  return {
    ...header,
    lines: (lines || []).map((line) => ({
      ...line,
      line_key: line.room_stock_id,
      room_number: line.rooms?.room_number || 'Room',
      room_type: line.rooms?.room_type || 'Room',
      item_name: line.supply_items?.name || 'Item',
      item_category: line.supply_items?.category || 'Other',
      item_unit: line.supply_items?.unit || 'piece'
    }))
  }
}

export async function getRoomSupplyStocktakeById(stocktakeId) {
  if (!stocktakeId) return null
  try {
    const { data, error } = await supabase
      .from('room_supply_stocktakes')
      .select('*')
      .eq('id', stocktakeId)
      .eq('lodge_id', lodgeId)
      .maybeSingle()
    if (error) throw error
    return data || null
  } catch {
    return null
  }
}

export async function saveSupplyStocktakeCounts(stocktakeId, lines) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const payload = (Array.isArray(lines) ? lines : []).map((line) => ({
    item_id: line.item_id,
    counted_qty: line.counted_qty,
    notes: line.notes || null
  }))
  const { data: result, error } = await supabase.rpc('save_supply_stocktake_counts', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: lodgeId,
    p_lines: payload
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not save supply stock take')
  return result
}

export async function saveRoomSupplyStocktakeCounts(stocktakeId, lines) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const payload = (Array.isArray(lines) ? lines : []).map((line) => ({
    room_stock_id: line.room_stock_id,
    counted_qty: line.counted_qty,
    notes: line.notes || null
  }))
  const { data: result, error } = await supabase.rpc('save_room_supply_stocktake_counts', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: lodgeId,
    p_lines: payload
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not save room stock take')
  return result
}

export async function postSupplyStocktakeSession(stocktakeId, notes) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const { data: result, error } = await supabase.rpc('post_supply_stocktake_session', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: lodgeId,
    p_notes: notes || null
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not post supply stock take')
  await getSupplyItems().catch(() => {})
  return result
}

export async function postRoomSupplyStocktakeSession(stocktakeId, notes) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const { data: result, error } = await supabase.rpc('post_room_supply_stocktake_session', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: lodgeId,
    p_notes: notes || null
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not post room stock take')
  await getRoomSupplyStock().catch(() => {})
  await getSupplyMovements().catch(() => {})
  return result
}

export async function addRoomSupplyStocktakeLine(stocktakeId, data = {}) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const { data: result, error } = await supabase.rpc('create_room_supply_stocktake_line', {
    p_stocktake_id: stocktakeId,
    p_lodge_id: lodgeId,
    p_room_id: data.room_id,
    p_supply_item_id: data.item_id,
    p_counted_qty: Number(data.counted_qty || 0),
    p_notes: data.notes || null
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not add this room stock count line')
  return result
}

export async function getRoomProfitabilityReport(startDate, endDate) {
  if (isOnline) {
    try {
      const { data, error } = await supabase.rpc('get_room_profitability_summary', {
        p_lodge_id: lodgeId,
        p_start_date: startDate,
        p_end_date: endDate
      })
      if (error) throw error
      if (Array.isArray(data)) {
        return data.map((row) => ({
          ...row,
          source: 'server',
          as_of_range: { start: startDate, end: endDate }
        }))
      }
      throw new Error('Room profitability summary was empty.')
    } catch (error) {
      recordCriticalError('reports.room_profitability', error, {
        startDate,
        endDate,
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 })
    }
  }

  const rooms = await getAllRooms()
  const occupancy = await getOccupancyReport(startDate, endDate)
  const occupancyByRoom = new Map((occupancy || []).map((row) => [row.id, row]))

  let supplyRows = []
  try {
    const movementRows = await getRoomSupplyAllocations(startDate, endDate)
    supplyRows = (movementRows || []).map((row) => ({
      room_id: row.room_id,
      total_cost: row.total_cost,
      units_used: row.units_used
    }))
  } catch {
    supplyRows = []
  }

  let maintenanceRows = []
  try {
    const { data, error } = await supabase
      .from('maintenance_tickets')
      .select('room_id, status, reported_date, total_cost')
      .eq('lodge_id', lodgeId)
      .gte('reported_date', startDate)
      .lte('reported_date', endDate)
    if (error) throw error
    maintenanceRows = data || []
  } catch {
    maintenanceRows = []
  }

  const supplyByRoom = {}
  for (const row of supplyRows) {
    const key = row.room_id
    if (!supplyByRoom[key]) supplyByRoom[key] = { cost: 0, units: 0 }
    supplyByRoom[key].cost += Number(row.total_cost || 0)
    supplyByRoom[key].units += Number(row.units_used || 0)
  }

  const maintenanceByRoom = {}
  for (const row of maintenanceRows) {
    const key = row.room_id
    if (!maintenanceByRoom[key]) maintenanceByRoom[key] = { count: 0, open: 0, cost: 0 }
    maintenanceByRoom[key].count += 1
    if ((row.status || '') !== 'resolved') maintenanceByRoom[key].open += 1
    maintenanceByRoom[key].cost += Number(row.total_cost || 0)
  }

  const result = rooms.map((room) => {
    const occ = occupancyByRoom.get(room.id) || {}
    const supply = supplyByRoom[room.id] || { cost: 0, units: 0 }
    const maintenance = maintenanceByRoom[room.id] || { count: 0, open: 0, cost: 0 }
    const revenue = Number(occ.actual_revenue || 0)
    const supplyCost = Number(supply.cost || 0)
    const maintenanceCost = Number(maintenance.cost || 0)
    const contribution = revenue - supplyCost - maintenanceCost
    return {
      id: room.id,
      room_number: room.room_number,
      room_type: room.room_type,
      rate_per_night: Number(room.rate_per_night || 0),
      occupied_nights: Number(occ.occupied_nights || 0),
      occupancy_rate: Number(occ.occupancy_rate || 0),
      revenue,
      supply_cost: supplyCost,
      supply_units_used: Number(supply.units || 0),
      maintenance_cost: maintenanceCost,
      maintenance_count: Number(maintenance.count || 0),
      open_maintenance_count: Number(maintenance.open || 0),
      contribution,
      margin_pct: revenue > 0 ? Math.round((contribution / revenue) * 100) : 0
    }
  })

  return result
    .sort((a, b) => b.contribution - a.contribution)
    .map((row) => ({
      ...row,
      source: 'local',
      as_of_range: { start: startDate, end: endDate }
    }))
}

// ─── ANALYTICS & COST REPORTS ────────────────────────────────────────────────

export async function getPosRevenueSummary(startDate, endDate, outletId = 'all') {
  if (isOnline) {
    try {
      const { data, error } = await supabase.rpc('get_pos_sales_summary', {
        p_lodge_id: lodgeId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_outlet_selector: outletId || 'all'
      })
      if (error) throw error
      if (data && typeof data === 'object') {
        return {
          ...data,
          source: 'server',
          as_of_range: { start: startDate, end: endDate },
          outlet_selector: outletId || 'all'
        }
      }
      throw new Error('POS sales summary was empty.')
    } catch (error) {
      recordCriticalError('reports.pos_sales', error, {
        startDate,
        endDate,
        outletId: outletId || 'all',
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 })
    }
  }

  const cachedOrders = readCache('pos-orders').filter((order) => {
    const createdAt = String(order.created_at || '')
    const orderDate = createdAt.split('T')[0]
    return (
      (order.status || '') === 'completed' &&
      (!startDate || orderDate >= startDate) &&
      (!endDate || orderDate <= endDate) &&
      (
        !outletId ||
        outletId === 'all' ||
        (outletId === 'unassigned' ? !order.outlet_id : order.outlet_id === outletId)
      )
    )
  })
  let orders = []
  let currentMenuItems = []
  let inventoryNameMap = new Map()

  try {
    let posQuery = supabase
      .from('pos_orders')
      .select('*')
      .eq('lodge_id', lodgeId)
      .eq('status', 'completed')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
    if (outletId && outletId !== 'all') {
      if (outletId === 'unassigned') posQuery = posQuery.is('outlet_id', null)
      else                           posQuery = posQuery.eq('outlet_id', outletId)
    }
    const { data: liveOrders, error: ordersError } = await posQuery
    if (ordersError) throw ordersError
    const fetchedOrders = (liveOrders || []).length === 0 && cachedOrders.length > 0
      ? cachedOrders
      : (liveOrders || [])

    // Write online results to cache so offline fallback stays fresh
    if ((liveOrders || []).length > 0) {
      writeCache('pos-orders', liveOrders)
    }

    // Fetch order items separately — failure here only affects top_items, not revenue totals
    let liveItems = []
    const orderIds = fetchedOrders.map((o) => o.id).filter(Boolean)
    if (orderIds.length > 0) {
      const { data: itemRows, error: itemsError } = await supabase
        .from('pos_order_items')
        .select('order_id, menu_item_id, item_name, quantity, unit_price, subtotal')
        .in('order_id', orderIds)
      if (!itemsError) liveItems = itemRows || []
    }
    // Attach items back onto each order
    const itemsByOrder = {}
    for (const item of liveItems) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = []
      itemsByOrder[item.order_id].push(item)
    }
    orders = fetchedOrders.map((o) => ({ ...o, pos_order_items: itemsByOrder[o.id] || (o.pos_order_items || []) }))

    const { data: liveMenuItems, error: menuError } = await supabase
      .from('pos_menu_items')
      .select('id, name, inventory_item_id, depletion_qty, template_kind, template_pack_size')
      .eq('lodge_id', lodgeId)
    if (menuError) throw menuError
    currentMenuItems = (liveMenuItems || []).length === 0
      ? readCache('pos-menu-items')
      : (liveMenuItems || [])

    const inventoryIds = [...new Set(
      currentMenuItems
        .map((item) => item.inventory_item_id)
        .filter(Boolean)
    )]
    if (inventoryIds.length > 0) {
      const { data: inventoryRows, error: inventoryError } = await supabase
        .from('inventory_items')
        .select('id, name')
        .eq('lodge_id', lodgeId)
        .in('id', inventoryIds)
      if (inventoryError) throw inventoryError
      inventoryNameMap = new Map((inventoryRows || []).map((row) => [row.id, row.name]))
    }
  } catch (error) {
    orders = cachedOrders
    currentMenuItems = readCache('pos-menu-items')
    const inventoryRows = readCache('inventory-items')
    inventoryNameMap = new Map((inventoryRows || []).map((row) => [row.id, row.name]))
    if (!orders.length && !currentMenuItems.length && isOnline) {
      throw new Error(error?.message || 'Failed to load POS revenue summary')
    }
  }

  const menuItemMap = new Map((currentMenuItems || []).map((item) => [item.id, item]))

  const total_revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0)
  const folio_revenue = orders.reduce(
    (sum, order) => sum + ((order.payment_method || '') === 'folio' ? Number(order.total || 0) : 0),
    0
  )
  const direct_revenue = total_revenue - folio_revenue
  const total_orders = orders.length
  const avg_order = total_orders > 0 ? total_revenue / total_orders : 0

  // Breakdown by payment method
  const by_payment = {}
  for (const o of orders) {
    const pm = o.payment_method || 'cash'
    by_payment[pm] = (by_payment[pm] || 0) + Number(o.total || 0)
  }

  // Top items aggregated across all line items
  const itemMap = {}
  for (const o of orders) {
    for (const li of (o.pos_order_items || [])) {
      const menuItem = menuItemMap.get(li.menu_item_id)
      const depletionQty = Number(
        menuItem?.template_pack_size ||
        menuItem?.depletion_qty ||
        1
      )
      const quantity = Number(li.quantity || 0)
      // Prefer live menu item name over the stored item_name snapshot, which
      // can be stale or incorrect (e.g. bar orders saving wrong item_name).
      // Prefer live menu item name over the stored item_name snapshot, which
      // can be stale or incorrect (e.g. bar orders saving wrong item_name).
      const menuItemName = menuItem?.name || li.item_name
      const itemName = menuItem?.inventory_item_id
        ? (inventoryNameMap.get(menuItem.inventory_item_id) || menuItemName)
        : menuItemName

      if (!itemMap[itemName]) itemMap[itemName] = { name: itemName, qty: 0, revenue: 0 }
      itemMap[itemName].qty += quantity * depletionQty
      itemMap[itemName].revenue += Number(li.subtotal || 0)
    }
  }
  const top_items = Object.values(itemMap).sort((a, b) => b.revenue - a.revenue).slice(0, 15)

  // Daily totals
  const dailyMap = {}
  for (const o of orders) {
    const date = (o.created_at || '').split('T')[0]
    if (date) dailyMap[date] = (dailyMap[date] || 0) + Number(o.total || 0)
  }
  const daily = Object.entries(dailyMap)
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    total_revenue,
    folio_revenue,
    direct_revenue,
    total_orders,
    avg_order,
    by_payment,
    top_items,
    daily,
    source: 'local',
    as_of_range: { start: startDate, end: endDate },
    outlet_selector: outletId || 'all'
  }
}

export async function getInventorySpend(startDate, endDate, outletId = 'all') {
  if (isOnline) {
    try {
      const { data, error } = await supabase.rpc('get_inventory_spend_summary', {
        p_lodge_id: lodgeId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_outlet_selector: outletId || 'all'
      })
      if (error) throw error
      if (data && typeof data === 'object') {
        return {
          ...data,
          source: 'server',
          as_of_range: { start: startDate, end: endDate },
          outlet_selector: outletId || 'all'
        }
      }
      throw new Error('Inventory spend summary was empty.')
    } catch (error) {
      recordCriticalError('reports.inventory_spend', error, {
        startDate,
        endDate,
        outletId: outletId || 'all',
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 })
    }
  }

  const inventoryMap = new Map(readCache('inventory-items').map((item) => [item.id, item]))
  const cachedPurchases = readCache('inventory-purchases')
    .filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate))
    .map((row) => ({
      ...row,
      inventory_items: inventoryMap.get(row.item_id)
        ? {
            name: inventoryMap.get(row.item_id).name,
            category: inventoryMap.get(row.item_id).category,
            outlet_id: inventoryMap.get(row.item_id).outlet_id || null
          }
        : null
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  let purchases = []
  try {
    const { data, error } = await supabase
      .from('inventory_purchases')
      .select('*, inventory_items(name, category, outlet_id)')
      .eq('lodge_id', lodgeId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false })
    if (error) throw error
    purchases = (data || []).length === 0 && cachedPurchases.length > 0
      ? cachedPurchases
      : (data || [])
  } catch (error) {
    purchases = cachedPurchases
    if (!purchases.length && isOnline) {
      throw new Error(error?.message || 'Failed to load inventory spend report')
    }
  }
  if (outletId && outletId !== 'all') {
    if (outletId === 'unassigned')
      purchases = purchases.filter(p => !p.inventory_items?.outlet_id)
    else
      purchases = purchases.filter(p => p.inventory_items?.outlet_id === outletId)
  }
  const total = purchases.reduce((s, p) => s + Number(p.total_cost || 0), 0)
  const by_category = {}
  for (const p of purchases) {
    const cat = p.inventory_items?.category || 'Uncategorised'
    by_category[cat] = (by_category[cat] || 0) + Number(p.total_cost || 0)
  }
  return {
    total,
    by_category,
    purchases,
    source: 'local',
    as_of_range: { start: startDate, end: endDate },
    outlet_selector: outletId || 'all'
  }
}

export async function getSupplySpend(startDate, endDate) {
  if (isOnline) {
    try {
      const { data, error } = await supabase.rpc('get_supply_spend_summary', {
        p_lodge_id: lodgeId,
        p_start_date: startDate,
        p_end_date: endDate
      })
      if (error) throw error
      if (data && typeof data === 'object') {
        return {
          ...data,
          source: 'server',
          as_of_range: { start: startDate, end: endDate }
        }
      }
      throw new Error('Supply spend summary was empty.')
    } catch (error) {
      recordCriticalError('reports.supply_spend', error, {
        startDate,
        endDate,
        strategy: 'server_rpc_fallback'
      }, { level: 'warn', limit: 120 })
    }
  }

  const supplyMap = new Map(readCache('supply-items').map((item) => [item.id, item]))
  const cachedPurchases = readCache('supply-purchases')
    .filter((row) => (!startDate || row.date >= startDate) && (!endDate || row.date <= endDate))
    .map((row) => ({
      ...row,
      supply_items: supplyMap.get(row.item_id)
        ? { name: supplyMap.get(row.item_id).name }
        : null
    }))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  let purchases = []
  try {
    const { data, error } = await supabase
      .from('supply_purchases')
      .select('*, supply_items(name)')
      .eq('lodge_id', lodgeId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false })
    if (error) throw error
    purchases = (data || []).length === 0 && cachedPurchases.length > 0
      ? cachedPurchases
      : (data || [])
  } catch (error) {
    purchases = cachedPurchases
    if (!purchases.length && isOnline) {
      throw new Error(error?.message || 'Failed to load supply spend report')
    }
  }
  const total = purchases.reduce((s, p) => s + Number(p.total_cost || 0), 0)
  return {
    total,
    purchases,
    source: 'local',
    as_of_range: { start: startDate, end: endDate }
  }
}

async function getConferenceRevenueSummary(startDate, endDate) {
  if (!isOnline) return { total: 0, collected: 0, count: 0 }
  try {
    const { data, error } = await supabase
      .from('conference_bookings')
      .select('total_amount, deposit_paid, payment_status')
      .eq('lodge_id', lodgeId)
      .gte('booking_date', startDate)
      .lte('booking_date', endDate)
    if (error) throw error
    const rows = (data || []).filter(r => r.payment_status !== 'cancelled')
    return {
      total:     rows.reduce((s, r) => s + Number(r.total_amount || 0), 0),
      collected: rows.reduce((s, r) => s + Number(r.deposit_paid  || 0), 0),
      count:     rows.length
    }
  } catch {
    return { total: 0, collected: 0, count: 0 }
  }
}

async function getPoolRevenueSummary(startDate, endDate) {
  if (!isOnline) return { total: 0, count: 0 }
  try {
    const { data, error } = await supabase
      .from('pool_day_use')
      .select('total')
      .eq('lodge_id', lodgeId)
      .gte('date', startDate)
      .lte('date', endDate)
    if (error) throw error
    const rows = data || []
    return {
      total: rows.reduce((s, r) => s + Number(r.total || 0), 0),
      count: rows.length
    }
  } catch {
    return { total: 0, count: 0 }
  }
}

export async function getNightAudit(date) {
  if (!isOnline) return null
  const dayStart = `${date}T00:00:00`
  const dayEnd   = `${date}T23:59:59`
  const bookingAuditSelect = 'id, booking_number, total_amount, charges_total, payment_status, amount_paid, adults, children, notes, status, check_in, check_out, created_at, customers(name), rooms(room_number, room_type)'
  const mapAuditBooking = (booking) => ({
    ...booking,
    customer_name: booking?.customer_name || booking?.customers?.name || '',
    room_number: booking?.room_number || booking?.rooms?.room_number || '',
    room_type: booking?.room_type || booking?.rooms?.room_type || ''
  })

  try {
    const { data, error } = await supabase.rpc('get_night_audit_summary', {
      p_lodge_id: lodgeId,
      p_audit_date: date
    })
    if (error) throw error
    if (data && typeof data === 'object') {
      return {
        ...data,
        check_ins: (data.check_ins || []).map(mapAuditBooking),
        check_outs: (data.check_outs || []).map(mapAuditBooking),
        new_bookings: (data.new_bookings || []).map(mapAuditBooking),
        outstanding: (data.outstanding || []).map(mapAuditBooking),
        pos_orders: data.pos_orders || []
      }
    }
  } catch (rpcError) {
    console.warn('[NightAudit] Server summary unavailable, using legacy fallback:', rpcError?.message || rpcError)
  }

  try {
    const [
      { data: checkIns },
      { data: checkOuts },
      { data: newBookings },
      { data: posOrders },
      { data: outstanding }
    ] = await Promise.all([
      supabase.from('bookings').select(bookingAuditSelect)
        .eq('lodge_id', lodgeId).eq('check_in', date).neq('status', 'cancelled').order('check_in'),
      supabase.from('bookings').select(bookingAuditSelect)
        .eq('lodge_id', lodgeId).eq('check_out', date).neq('status', 'cancelled').order('check_out'),
      supabase.from('bookings').select(bookingAuditSelect)
        .eq('lodge_id', lodgeId).gte('created_at', dayStart).lte('created_at', dayEnd).order('created_at', { ascending: false }),
      supabase.from('pos_orders').select('*, pos_order_items(*)')
        .eq('lodge_id', lodgeId).eq('status', 'completed').gte('created_at', dayStart).lte('created_at', dayEnd).order('created_at', { ascending: false }),
      supabase.from('bookings').select(bookingAuditSelect)
        .eq('lodge_id', lodgeId).in('status', ['confirmed', 'checked_in']).neq('payment_status', 'paid').order('check_in')
    ])

    const posRevenue = (posOrders || []).reduce((s, o) => s + Number(o.total || 0), 0)
    const outstandingTotal = (outstanding || []).reduce((s, b) => {
      const paid = Number(b.amount_paid || 0)
      return s + Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - paid)
    }, 0)

    return {
      date,
      check_ins:     (checkIns || []).map(mapAuditBooking),
      check_outs:    (checkOuts || []).map(mapAuditBooking),
      new_bookings:  (newBookings || []).map(mapAuditBooking),
      pos_orders:    posOrders    || [],
      pos_revenue:   posRevenue,
      outstanding:   (outstanding || []).map(mapAuditBooking),
      outstanding_total: outstandingTotal
    }
  } catch (error) {
    throw new Error(error?.message || 'Night audit could not be loaded.')
  }
}

export async function getLowStockItems() {
  const rows = await getInventoryItems().catch(() => readCache('inventory-items'))
  return (rows || []).filter(
    (item) => Number(item.reorder_level) > 0 && Number(item.current_stock) <= Number(item.reorder_level)
  )
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  lodge_name: '',
  company_name: '',
  address: '',
  city: '',
  country: 'Botswana',
  phone: '',
  email: '',
  website: '',
  vat_number: '',
  vat_enabled: false,
  vat_rate: 0,
  currency: 'P',
  logo: '',
  business_type: 'lodge',
  setup_complete: false
}

function getDefaultSettings() {
  return {
    ...DEFAULT_SETTINGS,
    lodge_id: lodgeId || null
  }
}

async function getRemoteSettingsRecord(targetLodgeId = lodgeId) {
  let result = await supabase.from('settings').select('*').eq('lodge_id', targetLodgeId).maybeSingle()
  if (!result.error) {
    return { data: result.data, mode: 'lodge' }
  }
  if (!/column .*lodge_id/i.test(result.error.message || '')) {
    throw new Error(result.error.message)
  }
  const err = new Error('The Supabase settings table is missing the required lodge_id UUID contract. Apply the current settings migration, then try again.')
  err.code = 'backend_auth_schema_outdated'
  throw err
}

async function saveRemoteSettingsRecord(settings) {
  let result = await supabase.from('settings').upsert(settings, { onConflict: 'lodge_id' }).select().maybeSingle()
  if (!result.error) {
    return { data: result.data || settings, mode: 'lodge' }
  }
  if (!/column .*lodge_id|constraint|on conflict/i.test(result.error.message || '')) {
    throw new Error(result.error.message)
  }
  const err = new Error('The Supabase settings table is missing the required lodge_id UUID contract. Apply the current settings migration, then try again.')
  err.code = 'backend_auth_schema_outdated'
  throw err
}

export async function getSettings() {
  if (!lodgeId) {
    return getDefaultSettings()
  }
  if (isOnline) {
    try {
      const { data } = await getRemoteSettingsRecord()
      if (data) {
        writeCache('settings', [data])
        return data
      }
    } catch (e) {
      console.error('[SETTINGS] load failed:', e.message)
    }
  }
  const cached = readCache('settings')
  return cached[0] || getDefaultSettings()
}

export async function getLodgeDiagnostics(expectedLodgeId = '') {
  await checkOnline()
  const expected = normalizeLodgeId(expectedLodgeId)
  const queue = readSyncQueue()
  const authEntries = readAuthCache().filter((entry) => entry.lodge_id === lodgeId)
  const users = readCache('users').filter((entry) => !entry.lodge_id || entry.lodge_id === lodgeId)
  let remoteSettings = null
  let expectedSettings = null
  const activeProfile = getActiveProfile()

  if (isOnline && lodgeId) {
    const { data } = await supabase.from('settings').select('lodge_id, lodge_name, company_name, setup_complete, updated_at').eq('lodge_id', lodgeId).maybeSingle()
    remoteSettings = data || null
    if (expected) {
      const { data: match } = await supabase.from('settings').select('lodge_id, lodge_name, company_name, setup_complete, updated_at').eq('lodge_id', expected).maybeSingle()
      expectedSettings = match || null
    }
  }

  return {
    online: isOnline,
    active_profile: activeProfile,
    profile_count: getProfiles().length,
    current_lodge_id: lodgeId,
    expected_lodge_id: expected || null,
    expected_matches_current: expected ? expected === lodgeId : null,
    unsynced_operations: queue.length,
    cached_user_count: users.length,
    cached_offline_login_count: authEntries.length,
    current_lodge_exists_remotely: !!remoteSettings,
    expected_lodge_exists_remotely: expected ? !!expectedSettings : null,
    remote_settings: remoteSettings,
    expected_settings: expectedSettings
  }
}

export async function relinkLodge(expectedLodgeId) {
  const nextLodgeId = normalizeLodgeId(expectedLodgeId)
  if (!nextLodgeId) throw new Error('Enter the correct lodge ID first.')
  if (!isUuid(nextLodgeId)) throw new Error('Lodge ID format looks invalid.')

  const activeProfile = getActiveProfile()
  if (!activeProfile) throw new Error('Choose a lodge profile on this computer before repairing it.')

  await checkOnline()
  const queue = readSyncQueue()
  if (queue.length > 0) {
    const err = new Error(`This lodge profile has ${queue.length} unsynced offline change(s). Sync them before relinking it.`)
    err.code = 'draft_profile_blocked_by_unsynced_changes'
    throw err
  }

  if (isOnline) {
    const { data } = await supabase
      .from('settings')
      .select('lodge_id, lodge_name, company_name, setup_complete')
      .eq('lodge_id', nextLodgeId)
      .maybeSingle()
    if (!data) throw new Error('That lodge ID was not found in Supabase.')
  }

  const existingTarget = getProfiles().find((profile) => profile.lodge_id === nextLodgeId && profile.lodge_id !== activeProfile.lodge_id)
  if (existingTarget) {
    throw new Error('That lodge is already saved on this computer. Switch to it from the Lodge Chooser instead of relinking this profile.')
  }

  const previousLodgeId = activeProfile.lodge_id
  const previousDir = getProfileCacheDir(previousLodgeId)
  const nextDir = getProfileCacheDir(nextLodgeId)

  try {
    if (fs.existsSync(previousDir) && previousDir !== nextDir) {
      fs.rmSync(nextDir, { recursive: true, force: true })
      fs.renameSync(previousDir, nextDir)
    }
  } catch {
    ensureDir(nextDir)
  }

  ensureProfileCacheFiles(nextLodgeId)
  persistLegacyLodgeId(nextLodgeId)

  updateProfileMetadata(previousLodgeId, {
    lodge_id: nextLodgeId,
    label: activeProfile.label,
    status: activeProfile.status
  })

  setRuntimeActiveProfile(nextLodgeId, { persistActive: true, touch: true })
  currentUser = null

  clearCache('users')
  clearCache('rooms')
  clearCache('customers')
  clearCache('bookings')
  clearCache('quotations')
  clearCache('settings')
  clearCache('trial_status', null)
  clearActivityLog()
  writeAuthCache([])
  writeSyncQueue([])
  writeFailedSyncQueue([])
  clearBackendSession()
  clearSessionNonce()

  if (isOnline) {
    await refreshAllCaches()
  }

  return {
    success: true,
    lodge_id: lodgeId,
    settings: await getSettings(),
    diagnostics: await getLodgeDiagnostics(lodgeId)
  }
}

export function resetToNewLodge() {
  const draftProfile = sanitizeProfile({
    lodge_id: randomUUID(),
    label: 'New Lodge',
    status: PROFILE_STATUS.DRAFT,
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString()
  })

  const registry = readProfilesRegistry()
  const nextProfiles = registry.profiles.filter((profile) => profile.lodge_id !== draftProfile.lodge_id)
  nextProfiles.unshift(draftProfile)
  writeProfilesRegistry({
    active_lodge_id: draftProfile.lodge_id,
    profiles: nextProfiles
  })

  setRuntimeActiveProfile(draftProfile.lodge_id, { persistActive: false, touch: false })
  ensureProfileCacheFiles(draftProfile.lodge_id)
  clearCache('users')
  clearCache('rooms')
  clearCache('customers')
  clearCache('bookings')
  clearCache('quotations')
  clearCache('settings')
  clearCache('trial_status', null)
  clearActivityLog()
  writeAuthCache([])
  writeSyncQueue([])
  writeFailedSyncQueue([])
  clearBackendSession()
  clearSessionNonce()
  return draftProfile.lodge_id
}

export async function saveSettings(data) {
  if (!lodgeId) throw new Error('Choose a lodge profile on this computer before saving settings.')

  const settings = {
    lodge_name: data.lodge_name || '',
    company_name: data.company_name || '',
    address: data.address || '',
    city: data.city || '',
    country: data.country || 'Botswana',
    phone: data.phone || '',
    email: data.email || '',
    website: data.website || '',
    vat_number: data.vat_number || '',
    vat_enabled: data.vat_enabled ?? false,
    vat_rate: Number(data.vat_rate || 0),
    currency: data.currency || 'P',
    logo: data.logo || '',
    business_type: data.business_type || 'lodge',
    slug: data.slug ? data.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') : null,
    booking_tagline: data.booking_tagline || '',
    booking_description: data.booking_description || '',
    hero_image: data.hero_image || '',
    whatsapp_number: data.whatsapp_number || '',
    booking_check_in_from: data.booking_check_in_from || '',
    booking_check_out_until: data.booking_check_out_until || '',
    booking_cancellation_policy: data.booking_cancellation_policy || '',
    booking_payment_terms: data.booking_payment_terms || '',
    booking_house_rules: data.booking_house_rules || '',
    booking_faq: Array.isArray(data.booking_faq) ? data.booking_faq : [],
    setup_complete: true,
    updated_at: new Date().toISOString(),
    lodge_id: lodgeId
  }

  if (isOnline) {
    const { data: savedRemote } = await saveRemoteSettingsRecord(settings)
    const { error } = await supabase.from('settings')
      .update({ trial_started_at: new Date().toISOString() })
      .eq('lodge_id', lodgeId)
      .is('trial_started_at', null)
    if (error && !/column .*trial_started_at/i.test(error.message || '')) throw new Error(error.message)
    const normalized = savedRemote ? { ...settings, ...savedRemote, lodge_id: lodgeId } : settings
    writeCache('settings', [normalized])
    const activeProfile = getActiveProfile()
    if (activeProfile?.status === PROFILE_STATUS.READY) {
      updateProfileMetadata(lodgeId, { label: profileLabelFromSettings(normalized, activeProfile.label) })
    }
    return normalized
  }
  writeCache('settings', [settings])
  const activeProfile = getActiveProfile()
  if (activeProfile?.status === PROFILE_STATUS.READY) {
    updateProfileMetadata(lodgeId, { label: profileLabelFromSettings(settings, activeProfile.label) })
  }
  return settings
}

export async function initializeCompanySetup({ settings, admin }) {
  const activeProfile = getActiveProfile()
  if (!activeProfile) {
    throw createAppError('no_draft_profile_selected', 'Create a new lodge profile on this computer before running setup.')
  }
  if (activeProfile.status !== PROFILE_STATUS.DRAFT) {
    throw createAppError('profile_already_ready', 'This lodge profile is already set up. Switch profiles or use Settings to change its details.', {
      lodge_id: activeProfile.lodge_id
    })
  }

  await checkOnline()
  if (!isOnline) {
    throw new Error('An internet connection is required to complete setup.')
  }

  const queue = readSyncQueue()
  if (queue.length > 0) {
    throw createAppError(
      'draft_profile_blocked_by_unsynced_changes',
      `This draft lodge profile has ${queue.length} unsynced offline change(s). Clear or sync them before completing setup.`,
      { lodge_id: lodgeId, pending_operations: queue.length }
    )
  }

  const { data: remoteSettings } = await supabase
    .from('settings')
    .select('setup_complete, lodge_name, company_name')
    .eq('lodge_id', lodgeId)
    .maybeSingle()
  if (remoteSettings?.setup_complete === true) {
    throw createAppError(
      'remote_lodge_already_exists',
      'This draft lodge profile is already linked to a completed company in Supabase. Switch to that lodge instead of running setup again.',
      { lodge_id: lodgeId, remote_settings: remoteSettings }
    )
  }

  const emailLower = normalizeEmail(admin?.email)
  if (!settings || !admin || !admin.name?.trim() || !emailLower || !admin.password) {
    throw new Error('Incomplete setup payload.')
  }

  console.log('[SETUP] initializeCompany started:', { lodge_id: lodgeId, email: emailLower, profile_status: activeProfile.status })

  let savedSettings
  try {
    savedSettings = await saveSettings(settings)
  } catch (error) {
    if (error?.code) throw error
    const message = error?.message || 'Could not save lodge settings.'
    const code = isBackendAuthSchemaError(message) ? 'backend_auth_schema_outdated' : 'settings_save_failed'
    throw createAppError(code, message, { lodge_id: lodgeId, email: emailLower })
  }

  const userId = await createUser({
    name: admin.name.trim(),
    email: emailLower,
    password: admin.password,
    role: admin.role || 'admin'
  })

  const authHealth = await runAuthHealthCheck(emailLower, { expectedUserId: userId })
  if (!authHealth.ok) {
    throw createAppError(authHealth.code || 'setup_failed', authHealth.error || 'Initial auth health check failed.', {
      lodge_id: lodgeId,
      user_id: userId,
      auth_health: authHealth
    })
  }

  if (authHealth.user) {
    upsertCachedUser(authHealth.user)
  }
  updateProfileMetadata(lodgeId, {
    label: profileLabelFromSettings(savedSettings, activeProfile.label),
    status: PROFILE_STATUS.READY
  })
  return {
    lodge_id: lodgeId,
    settings: savedSettings,
    user_id: userId,
    auth_health: authHealth,
    profile: getActiveProfile()
  }
}

function getCachedEntitlement(targetLodgeId = null) {
  const cached = readCache('trial_status')
  if (!cached || typeof cached !== 'object') return null
  const offlineValidUntil = cached.offline_valid_until
    || cached.offlineValidUntil
    || (cached.cached_at ? addDays(cached.cached_at, DEFAULT_OFFLINE_LEASE_DAYS).toISOString() : null)
  if (offlineValidUntil) {
    const validUntilDate = new Date(offlineValidUntil)
    if (Number.isFinite(validUntilDate.getTime()) && validUntilDate < new Date()) {
      return null
    }
  }
  if (!targetLodgeId) return cached
  return String(cached.lodge_id || '').trim().toLowerCase() === String(targetLodgeId || '').trim().toLowerCase()
    ? cached
    : null
}

function cacheEntitlement(targetLodgeId, entitlement) {
  const cached = {
    ...entitlement,
    lodge_id: targetLodgeId || entitlement?.lodge_id || null,
    cached_at: new Date().toISOString()
  }
  writeCache('trial_status', cached)
  return cached
}

function buildOfflineLeaseExpiredEntitlement(entitlement = {}, lodgeId = null) {
  const normalizedPlan = entitlement.plan ? normalizePlanName(entitlement.plan) : normalizePlanName(entitlement.subscription_plan)
  return {
    ...entitlement,
    lodge_id: lodgeId || entitlement?.lodge_id || null,
    status: 'expired',
    expired: true,
    plan: normalizedPlan || null,
    subscription_state: 'offline_lease_expired',
    payment_status: entitlement?.payment_status || 'offline_lease_expired',
    daysLeft: null,
    offline_valid_until: entitlement?.offline_valid_until || entitlement?.offlineValidUntil || new Date().toISOString(),
    effective_features: normalizedPlan ? getPlanFeatureMap(normalizedPlan, { expired: true }) : getPlanFeatureMap('Starter', { expired: true })
  }
}

function buildTrialEntitlement(trialStartedAt = null, lodgeId = null) {
  if (!trialStartedAt) {
    return {
      lodge_id: lodgeId,
      status: 'trial',
      daysLeft: 3,
      expired: false,
      plan: 'Trial',
      payment_status: 'trial',
      subscription_state: 'trial',
      monthly_fee: 0,
      effective_features: getPlanFeatureMap('Pro', { trial: true }),
      expires_at: null,
      next_due_date: null,
      grace_period_days: 0,
      grace_period_ends_at: null,
      offline_lease_days: 3,
      offline_valid_until: computeOfflineValidUntil({
        subscription_state: 'trial',
        offline_lease_days: 3
      })
    }
  }

  const trialEnd = new Date(trialStartedAt)
  trialEnd.setDate(trialEnd.getDate() + 3)
  const msLeft = trialEnd - new Date()
  const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)))
  const expired = daysLeft <= 0

  return {
    lodge_id: lodgeId,
    status: expired ? 'expired' : 'trial',
    daysLeft,
    expired,
    plan: expired ? null : 'Trial',
    payment_status: expired ? 'expired' : 'trial',
    subscription_state: expired ? 'expired' : 'trial',
    monthly_fee: 0,
    effective_features: getPlanFeatureMap('Pro', { trial: !expired, expired }),
    expires_at: expired ? trialEnd.toISOString() : null,
    next_due_date: null,
    grace_period_days: 0,
    grace_period_ends_at: null,
    offline_lease_days: 3,
    offline_valid_until: computeOfflineValidUntil({
      subscription_state: expired ? 'expired' : 'trial',
      offline_lease_days: 3,
      trial_end: trialEnd.toISOString()
    })
  }
}

function buildLicensedEntitlement(license, featureOverrides = []) {
  const normalizedPlan = normalizePlanName(license?.subscription_plan)
  const paymentStatus = String(license?.payment_status || 'active').trim().toLowerCase() || 'active'
  const subscriptionState = computeSubscriptionState({
    payment_status: paymentStatus,
    next_due_date: license?.next_due_date || null,
    expires_at: license?.expires_at || null,
    is_active: license?.is_active !== false,
    grace_period_days: license?.grace_period_days || DEFAULT_SUBSCRIPTION_GRACE_DAYS
  })
  const activeAccess = subscriptionAllowsAccess(subscriptionState)
  const status = activeAccess ? 'licensed' : 'expired'
  const gracePeriodEndsAt = computeGracePeriodEnd(license?.next_due_date, license?.grace_period_days || DEFAULT_SUBSCRIPTION_GRACE_DAYS)

  return {
    lodge_id: license?.lodge_id || null,
    status,
    daysLeft: null,
    expired: !activeAccess,
    plan: normalizedPlan,
    payment_status: paymentStatus,
    subscription_state: subscriptionState,
    expires_at: license?.expires_at || null,
    monthly_fee: Number(license?.monthly_fee || 0),
    next_due_date: license?.next_due_date || null,
    currency: license?.currency || null,
    lodge_name: license?.lodge_name || null,
    plan_version_code: license?.plan_version_code || '2026.04',
    grace_period_days: toPositiveInt(license?.grace_period_days, DEFAULT_SUBSCRIPTION_GRACE_DAYS),
    grace_period_ends_at: gracePeriodEndsAt,
    offline_lease_days: toPositiveInt(license?.offline_lease_days, DEFAULT_OFFLINE_LEASE_DAYS),
    offline_valid_until: computeOfflineValidUntil({
      subscription_state: subscriptionState,
      expires_at: license?.expires_at || null,
      next_due_date: license?.next_due_date || null,
      grace_period_days: license?.grace_period_days || DEFAULT_SUBSCRIPTION_GRACE_DAYS,
      offline_lease_days: license?.offline_lease_days || DEFAULT_OFFLINE_LEASE_DAYS
    }),
    effective_features: activeAccess
      ? mergeFeatureOverrides(getPlanFeatureMap(normalizedPlan), featureOverrides)
      : getPlanFeatureMap(normalizedPlan, { expired: true })
  }
}

function coerceEntitlementResponse(payload) {
  if (!payload || typeof payload !== 'object') return null
  const normalizedPlan = payload.plan ? normalizePlanName(payload.plan) : (payload.status === 'trial' ? 'Trial' : null)
  const effectiveFeatures = mergeFeatureOverrides(
    getPlanFeatureMap(normalizedPlan || 'Starter', {
      trial: payload.status === 'trial',
      expired: payload.expired === true
    }),
    Object.entries(payload.effective_features || {}).map(([feature_name, enabled]) => ({ feature_name, enabled }))
  )

  return {
    ...payload,
    lodge_id: payload.lodge_id || null,
    plan: normalizedPlan,
    expired: payload.expired === true,
    daysLeft: payload.daysLeft ?? payload.days_left ?? null,
    payment_status: payload.payment_status || payload.billing_status || null,
    subscription_state: payload.subscription_state || null,
    plan_version_code: payload.plan_version_code || null,
    grace_period_days: payload.grace_period_days ?? null,
    grace_period_ends_at: payload.grace_period_ends_at || null,
    offline_lease_days: payload.offline_lease_days ?? null,
    offline_valid_until: payload.offline_valid_until || payload.offlineValidUntil || null,
    effective_features: effectiveFeatures
  }
}

function isMissingEntitlementRpcError(error) {
  const message = String(error?.message || '')
  return error?.code === 'PGRST202'
    || /get_lodge_entitlement|activate_license_key|issue_subscription_contract|update_subscription_contract|set_subscription_feature_override|clear_subscription_feature_override|schema cache/i.test(message)
}

async function getLegacyFeatureOverrides(targetLodgeId) {
  const { data, error } = await supabase
    .from('lodge_features')
    .select('feature_name, enabled')
    .eq('lodge_id', targetLodgeId)
  if (error) throw new Error(error.message)
  return data || []
}

async function getLegacyEntitlement(targetLodgeId) {
  const now = new Date().toISOString()
  const { data: licenseRows, error: licenseError } = await supabase
    .from('licenses')
    .select('id, lodge_id, lodge_name, expires_at, subscription_plan, monthly_fee, payment_status, next_due_date, currency, is_active, plan_version_code, grace_period_days, offline_lease_days')
    .eq('lodge_id', targetLodgeId)
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('issued_at', { ascending: false })
    .limit(1)

  if (licenseError) throw new Error(licenseError.message)
  const license = Array.isArray(licenseRows) ? licenseRows[0] : null
  if (license) {
    const overrides = await getLegacyFeatureOverrides(targetLodgeId).catch(() => [])
    return buildLicensedEntitlement(license, overrides)
  }

  const cachedSettings = readCache('settings')[0] || null
  if (cachedSettings?.trial_started_at) {
    return buildTrialEntitlement(cachedSettings.trial_started_at)
  }

  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('trial_started_at')
    .eq('lodge_id', targetLodgeId)
    .maybeSingle()
  if (settingsError) throw new Error(settingsError.message)
  return buildTrialEntitlement(settings?.trial_started_at || null)
}

export async function getTrialStatus(lodgeId) {
  const targetLodgeId = lodgeId || getActiveProfile()?.lodge_id || null
  if (!targetLodgeId) {
    return buildTrialEntitlement(null)
  }

  await checkOnline()
  if (!isOnline) {
    const cached = getCachedEntitlement(targetLodgeId)
    if (cached) return cached
    const staleCached = readCache('trial_status')
    if (staleCached && typeof staleCached === 'object') {
      return buildOfflineLeaseExpiredEntitlement(staleCached, targetLodgeId)
    }
    const cachedSettings = readCache('settings')[0] || null
    return buildTrialEntitlement(cachedSettings?.trial_started_at || null, targetLodgeId)
  }

  try {
    const { data, error } = await supabase.rpc('get_lodge_entitlement', {
      p_lodge_id: targetLodgeId
    })
    if (error) throw error
    const normalized = coerceEntitlementResponse(data)
    if (normalized) return cacheEntitlement(targetLodgeId, normalized)
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) {
      console.warn('[ENTITLEMENT] RPC failed, trying legacy fallback:', error.message)
    }
  }

  try {
    return cacheEntitlement(targetLodgeId, await getLegacyEntitlement(targetLodgeId))
  } catch (error) {
    console.warn('[ENTITLEMENT] legacy fallback failed:', error.message)
    const cached = getCachedEntitlement(targetLodgeId)
    if (cached) return cached
    const staleCached = readCache('trial_status')
    if (staleCached && typeof staleCached === 'object') {
      return buildOfflineLeaseExpiredEntitlement(staleCached, targetLodgeId)
    }
    const cachedSettings = readCache('settings')[0] || null
    return buildTrialEntitlement(cachedSettings?.trial_started_at || null, targetLodgeId)
  }
}

export async function activateLicenseKey(lodgeId, licenseKey) {
  if (!isOnline) throw new Error('Internet connection required to activate license.')
  if (!licenseKey?.trim()) throw new Error('Please enter a license key.')

  const key = licenseKey.trim().toUpperCase()
  try {
    const { data, error } = await supabase.rpc('activate_license_key', {
      p_lodge_id: lodgeId,
      p_license_key: key
    })
    if (error) throw error
    const normalized = coerceEntitlementResponse(data)
    if (normalized?.success === false) throw new Error(normalized.error || 'Activation failed')
    if (normalized) {
      cacheEntitlement(lodgeId, normalized)
      return {
        success: true,
        plan: normalized.plan || 'Starter',
        expires_at: normalized.expires_at,
        lodge_name: normalized.lodge_name
      }
    }
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) {
      console.warn('[ENTITLEMENT] activation RPC failed, trying legacy fallback:', error.message)
    }
  }

  const { data: license, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('license_key', key)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!license) throw new Error('License key not found. Please check and try again.')
  if (!license.is_active) throw new Error('This license key has been deactivated.')
  if (String(license.payment_status || '').toLowerCase() === 'cancelled') {
    throw new Error('This license key has been cancelled.')
  }
  if (license.lodge_id && license.lodge_id !== 'unassigned' && license.lodge_id !== lodgeId) {
    throw new Error('This license key is already registered to another installation.')
  }
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    throw new Error('This license key has expired.')
  }

  const { error: updateError } = await supabase
    .from('licenses')
    .update({ lodge_id: lodgeId })
    .eq('id', license.id)

  if (updateError) throw new Error(updateError.message)

  const overrides = await getLegacyFeatureOverrides(lodgeId).catch(() => [])
  const entitlement = buildLicensedEntitlement({ ...license, lodge_id: lodgeId }, overrides)
  cacheEntitlement(lodgeId, entitlement)
  return {
    success: true,
    plan: entitlement.plan || 'Starter',
    expires_at: entitlement.expires_at,
    lodge_name: entitlement.lodge_name
  }
}

// ─── MASTER ADMIN ──────────────────────────────────────────────────────────────

export async function checkMasterAdmin(email, password) {
  await checkOnline()
  if (!isOnline) {
    console.log('[MASTER] Connectivity ping reported offline — still attempting master_admins lookup (if service key is set)')
  }
  if (!adminDb) {
    return null
  }
  const { data, error } = await requireAdmin()
    .from('master_admins')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .limit(1)
  if (error) console.error('[MASTER] DB error during admin lookup:', error.message)
  const admin = data?.[0]
  const passwordMatch = admin ? bcrypt.compareSync(password, admin.password_hash) : false
  if (error) return null
  if (!admin) return null
  if (!passwordMatch) return null
  return {
    id: admin.id,
    name: admin.name || 'Master Admin',
    email: admin.email,
    role: 'super_admin',
    isMasterAdmin: true
  }
}

export async function masterAdminExists() {
  if (!isOnline) return false
  const { count } = await requireAdmin().from('master_admins').select('id', { count: 'exact', head: true })
  return (count || 0) > 0
}

export async function createMasterAdmin(name, email, password) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { count } = await requireAdmin().from('master_admins').select('id', { count: 'exact', head: true })
  if ((count || 0) > 0) throw new Error('Master admin already exists')
  const password_hash = bcrypt.hashSync(password, 12)
  const { data, error } = await requireAdmin().from('master_admins').insert({
    email: email.toLowerCase().trim(),
    password_hash,
    name
  }).select().single()
  if (error) throw new Error(error.message)
  return { success: true, id: data.id }
}

// ─── ADMIN: All Companies ──────────────────────────────────────────────────────

export async function getAllCompanies() {
  if (!isOnline) return []
  const { data } = await requireAdmin()
    .from('settings')
    .select('lodge_id, lodge_name, company_name, business_type, city, country, email, phone, updated_at, setup_complete, trial_started_at, deleted')
    .eq('setup_complete', true)
    .order('updated_at', { ascending: false })
  return data || []
}

export async function updateCompany(lodgeId, updates) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await requireAdmin()
    .from('settings')
    .update(updates)
    .eq('lodge_id', lodgeId)
  if (error) throw error
}

export async function archiveCompany(targetLodgeId) {
  if (!targetLodgeId) throw new Error('Company lodge_id is required')
  await updateCompany(targetLodgeId, { deleted: true, updated_at: new Date().toISOString() })
  await logAdminActivity(targetLodgeId, null, 'company_archived', {
    actor_id: currentUser?.id || null,
    actor_role: currentUser?.role || null
  })
  return { success: true }
}

export async function restoreCompany(targetLodgeId) {
  if (!targetLodgeId) throw new Error('Company lodge_id is required')
  await updateCompany(targetLodgeId, { deleted: false, updated_at: new Date().toISOString() })
  await logAdminActivity(targetLodgeId, null, 'company_restored', {
    actor_id: currentUser?.id || null,
    actor_role: currentUser?.role || null
  })
  return { success: true }
}

const COMPANY_PURGE_TABLES = [
  'pos_order_items',
  'inventory_stocktake_lines',
  'supply_stocktake_lines',
  'room_supply_stocktake_lines',
  'booking_charges',
  'payments',
  'invoices',
  'room_supply_allocations',
  'room_supply_room_stock',
  'room_supply_movements',
  'inventory_purchases',
  'supply_purchases',
  'pos_override_log',
  'pos_orders',
  'conference_bookings',
  'pool_day_use',
  'maintenance_tickets',
  'room_rate_overrides',
  'expenses',
  'quotations',
  'bookings',
  'inventory_stocktakes',
  'supply_stocktakes',
  'room_supply_stocktakes',
  'pos_menu_items',
  'inventory_items',
  'supply_items',
  'outlets',
  'rooms',
  'customers',
  'users',
  'lodge_features',
  'licenses',
  'support_tickets',
  'broadcasts',
  'activity_logs'
]

function shouldIgnorePurgeDeleteError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  return code === '42P01'
    || code === '42703'
    || /relation .* does not exist/i.test(message)
    || /column .* does not exist/i.test(message)
}

async function deleteLodgeScopedRows(adminClient, tableName, targetLodgeId) {
  const { count, error } = await adminClient
    .from(tableName)
    .delete({ count: 'exact' })
    .eq('lodge_id', targetLodgeId)

  if (error) {
    if (shouldIgnorePurgeDeleteError(error)) return { table: tableName, deleted: 0, skipped: true }
    throw new Error(`Could not delete ${tableName}: ${error.message}`)
  }
  return { table: tableName, deleted: count || 0, skipped: false }
}

export async function permanentlyDeleteCompany(targetLodgeId) {
  const normalizedId = normalizeLodgeId(targetLodgeId)
  if (!normalizedId) throw new Error('Company lodge_id is required')
  await checkOnline()
  if (!isOnline) throw new Error('Requires internet connection')

  const adminClient = requireAdmin()
  const { data: company, error: lookupError } = await adminClient
    .from('settings')
    .select('lodge_id, lodge_name, company_name')
    .eq('lodge_id', normalizedId)
    .maybeSingle()
  if (lookupError) throw new Error(lookupError.message)

  const deleted = []
  for (const tableName of COMPANY_PURGE_TABLES) {
    deleted.push(await deleteLodgeScopedRows(adminClient, tableName, normalizedId))
  }

  const { count: settingsDeleted, error: settingsError } = await adminClient
    .from('settings')
    .delete({ count: 'exact' })
    .eq('lodge_id', normalizedId)
  if (settingsError) throw new Error(`Could not delete settings: ${settingsError.message}`)
  deleted.push({ table: 'settings', deleted: settingsDeleted || 0, skipped: false })

  const local = removeLocalCompanyProfile(normalizedId)

  return {
    success: true,
    company: company || null,
    deleted,
    local,
    deleted_count: deleted.reduce((sum, entry) => sum + Number(entry.deleted || 0), 0)
  }
}

export async function repairDuplicateEventBookings(targetLodgeId = null) {
  await checkOnline()
  if (!isOnline) throw new Error('Requires internet connection')
  const normalizedId = targetLodgeId ? normalizeLodgeId(targetLodgeId) : null
  const { data, error } = await requireAdmin().rpc('repair_duplicate_event_bookings', {
    p_lodge_id: normalizedId || null
  })
  if (error) throw new Error(error.message)
  return {
    success: true,
    repaired: Array.isArray(data) ? data : []
  }
}

export async function getCompanyUsers(lodgeId) {
  if (!isOnline) return []
  const { data } = await requireAdmin()
    .from('users')
    .select('id, name, email, role, created_at, pwa_enabled, pwa_password_set_at, pwa_disabled_reason, pwa_password_reset_by')
    .eq('lodge_id', lodgeId)
    .order('name')
  return data || []
}

export async function resetCompanyUserPassword(targetLodgeId, userId, password) {
  if (!isOnline) throw new Error('Requires internet connection')
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.')

  const password_hash = bcrypt.hashSync(password, 10)
  const { data: result, error } = await requireAdmin().rpc('set_user_password', {
    p_id: userId,
    p_lodge_id: targetLodgeId,
    p_password_hash: password_hash
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not reset password')

  const user = (await getCompanyUsers(targetLodgeId)).find((entry) => entry.id === userId)
  await logAdminActivity(targetLodgeId, null, 'company_user_password_reset', {
    actor_id: currentUser?.id || null,
    actor_role: currentUser?.role || null,
    user_id: userId,
    user_email: user?.email || null,
    user_role: user?.role || null
  })
  return { success: true }
}

export async function updateCompanyUserPwaAccess(targetLodgeId, userId, payload = {}) {
  if (!isOnline) throw new Error('Requires internet connection')

  const user = (await getCompanyUsers(targetLodgeId)).find((entry) => entry.id === userId)
  if (!user) throw new Error('Staff account not found.')

  const pwaAccess = resolvePwaAccessUpdate(user, payload)
  if (!pwaAccess.requested) {
    return { success: true }
  }

  const { data: result, error } = await requireAdmin().rpc('set_user_pwa_access', {
    p_id: userId,
    p_lodge_id: targetLodgeId,
    p_enabled: pwaAccess.enabled,
    p_password_hash: pwaAccess.password_hash,
    p_disabled_reason: pwaAccess.disabled_reason,
    p_reset_by: currentUser?.id || null
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not update Manager PWA access')

  await logAdminActivity(targetLodgeId, null, 'company_user_pwa_access_updated', {
    actor_id: currentUser?.id || null,
    actor_role: currentUser?.role || null,
    user_id: userId,
    user_email: user.email || null,
    user_role: user.role || null,
    pwa_enabled: pwaAccess.enabled,
    pwa_disabled_reason: pwaAccess.disabled_reason,
    password_reset: Boolean(pwaAccess.password_hash)
  })
  return { success: true }
}

// ─── ADMIN: Licenses ───────────────────────────────────────────────────────────

function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(12)
  const seg = (offset) => Array.from(bytes.slice(offset, offset + 4), (value) => chars[value % chars.length]).join('')
  return `BB-${seg(0)}-${seg(4)}-${seg(8)}`
}

export async function getLicenses() {
  if (!isOnline) return []
  const { data } = await requireAdmin()
    .from('licenses')
    .select('*')
    .order('issued_at', { ascending: false })
  return (data || []).map((license) => ({
    ...license,
    subscription_plan: normalizePlanName(license.subscription_plan)
  }))
}

export async function createLicense({ lodge_id, lodge_name, business_type, expires_at, notes, subscription_plan, payment_status, monthly_fee, currency, next_due_date, last_payment_date }) {
  if (!isOnline) throw new Error('Requires internet connection')
  const normalizedPlan = normalizePlanName(subscription_plan)

  try {
    const { data, error } = await requireAdmin().rpc('issue_subscription_contract', {
      p_payload: {
        lodge_id: lodge_id || null,
        lodge_name: lodge_name || '',
        business_type: business_type || 'lodge',
        expires_at: expires_at || null,
        notes: notes || null,
        subscription_plan: normalizedPlan,
        payment_status: payment_status || 'active',
        monthly_fee: Number(monthly_fee || 0),
        currency: currency || 'BWP',
        next_due_date: next_due_date || null,
        last_payment_date: last_payment_date || null,
        create_invoice: false
      }
    })
    if (error) throw error
    if (data?.success === false) throw new Error(data.error || 'Could not create subscription')
    if (data?.license) return data.license
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message)
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const license_key = generateLicenseKey()
    const { data, error } = await requireAdmin().from('licenses').insert({
      lodge_id: lodge_id || 'unassigned',
      license_key,
      lodge_name: lodge_name || '',
      business_type: business_type || 'lodge',
      expires_at: expires_at || null,
      notes: notes || null,
      subscription_plan: normalizedPlan,
      payment_status: payment_status || 'active',
      monthly_fee: Number(monthly_fee || 0),
      currency: currency || 'BWP',
      next_due_date: next_due_date || null,
      last_payment_date: last_payment_date || null,
      is_active: true
    }).select().single()
    if (!error) return data
    if (String(error.message || '').toLowerCase().includes('license_key')) continue
    throw new Error(error.message)
  }

  throw new Error('Could not generate a unique license key. Please try again.')
}

export async function issueSubscriptionContract({ license = {}, invoice = null } = {}) {
  if (!isOnline) throw new Error('Requires internet connection')
  const normalizedPlan = normalizePlanName(license.subscription_plan)
  const payload = {
    lodge_id: license.lodge_id || null,
    lodge_name: license.lodge_name || '',
    business_type: license.business_type || 'lodge',
    expires_at: license.expires_at || null,
    notes: license.notes || null,
    subscription_plan: normalizedPlan,
    payment_status: license.payment_status || 'active',
    monthly_fee: Number(license.monthly_fee || 0),
    currency: license.currency || 'BWP',
    next_due_date: license.next_due_date || null,
    last_payment_date: license.last_payment_date || null,
    grace_period_days: license.grace_period_days || DEFAULT_SUBSCRIPTION_GRACE_DAYS,
    offline_lease_days: license.offline_lease_days || DEFAULT_OFFLINE_LEASE_DAYS,
    create_invoice: !!invoice,
    invoice: invoice
      ? {
          ...invoice,
          package_name: normalizedPlan
        }
      : null
  }

  try {
    const { data, error } = await requireAdmin().rpc('issue_subscription_contract', {
      p_payload: payload
    })
    if (error) throw error
    if (data?.success === false) throw new Error(data.error || 'Could not create subscription')
    return data
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message)
  }

  const createdLicense = await createLicense({
    ...license,
    subscription_plan: normalizedPlan
  })
  let createdInvoice = null
  if (invoice) {
    createdInvoice = await createInvoice({
      ...invoice,
      license_id: createdLicense?.id || null,
      package_name: normalizedPlan
    })
  }
  return {
    success: true,
    license: createdLicense,
    invoice: createdInvoice
  }
}

export async function updateLicense(id, updates) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await requireAdmin().from('licenses').update(updates).eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function deleteLicense(id) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await requireAdmin().from('licenses').delete().eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

// ─── ADMIN: BROADCASTS ────────────────────────────────────────────────────────

export async function getBroadcasts() {
  if (!isOnline) return []
  const { data } = await requireAdmin().from('broadcasts').select('*').order('created_at', { ascending: false })
  return data || []
}

export async function getActiveBroadcasts() {
  if (!isOnline) return []
  const now = new Date().toISOString()
  const { data } = await supabase
    .from('broadcasts')
    .select('*')
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('created_at', { ascending: false })
  return data || []
}

export async function createBroadcast({ title, message, expires_at }) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { data: result, error } = await requireAdmin().rpc('create_broadcast', {
    payload: {
      title,
      message,
      expires_at: expires_at || null,
      is_active: true
    }
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not create broadcast')
  return result
}

export async function updateBroadcast(id, updates) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { data: result, error } = await requireAdmin().rpc('update_broadcast', {
    p_id: id,
    payload: updates || {}
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not update broadcast')
  return { success: true }
}

export async function deleteBroadcast(id) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { data: result, error } = await requireAdmin().rpc('delete_broadcast', {
    p_id: id
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not delete broadcast')
  return { success: true }
}

// ─── ADMIN: FEATURE FLAGS ──────────────────────────────────────────────────────

export async function getLodgeFeatures(targetLodgeId) {
  if (!isOnline) return []
  const { data, error } = await requireAdmin()
    .from('lodge_features')
    .select('feature_name, enabled, reason, expires_at, review_at, granted_at, granted_by, updated_at')
    .eq('lodge_id', targetLodgeId)
  if (error) throw new Error(error.message)
  return data || []
}

export async function setLodgeFeature(targetLodgeId, featureName, enabled, metadata = {}) {
  if (!isOnline) throw new Error('Requires internet connection')
  try {
    const { data, error } = await requireAdmin().rpc('set_subscription_feature_override', {
      p_lodge_id: targetLodgeId,
      p_feature_name: featureName,
      p_enabled: enabled !== false,
      p_reason: metadata?.reason || null,
      p_expires_at: metadata?.expires_at || null,
      p_review_at: metadata?.review_at || null,
      p_granted_by: currentUser?.id || null
    })
    if (error) throw error
    if (data?.success === false) throw new Error(data.error || 'Could not save feature override')
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message)
    const { error: fallbackError } = await requireAdmin()
      .from('lodge_features')
      .upsert(
        {
          lodge_id: targetLodgeId,
          feature_name: featureName,
          enabled,
          updated_at: new Date().toISOString(),
          reason: metadata?.reason || null,
          expires_at: metadata?.expires_at || null,
          review_at: metadata?.review_at || null,
          granted_by: currentUser?.id || null,
          granted_at: new Date().toISOString()
        },
        { onConflict: 'lodge_id,feature_name' }
      )
    if (fallbackError) throw new Error(fallbackError.message)
  }
  await logAdminActivity(targetLodgeId, null, 'feature_override_set', {
    actor_id: currentUser?.id || null,
    actor_role: currentUser?.role || null,
    feature_name: featureName,
    enabled: enabled !== false,
    reason: metadata?.reason || null,
    expires_at: metadata?.expires_at || null,
    review_at: metadata?.review_at || null
  })
  return { success: true }
}

export async function clearLodgeFeature(targetLodgeId, featureName) {
  if (!isOnline) throw new Error('Requires internet connection')
  try {
    const { data, error } = await requireAdmin().rpc('clear_subscription_feature_override', {
      p_lodge_id: targetLodgeId,
      p_feature_name: featureName
    })
    if (error) throw error
    if (data?.success === false) throw new Error(data.error || 'Could not clear feature override')
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message)
    const { error: fallbackError } = await requireAdmin()
      .from('lodge_features')
      .delete()
      .eq('lodge_id', targetLodgeId)
      .eq('feature_name', featureName)
    if (fallbackError) throw new Error(fallbackError.message)
  }
  await logAdminActivity(targetLodgeId, null, 'feature_override_cleared', {
    actor_id: currentUser?.id || null,
    actor_role: currentUser?.role || null,
    feature_name: featureName
  })
  return { success: true }
}

export async function getAllLodgeFeatures() {
  if (!isOnline) return []
  const { data } = await requireAdmin().from('lodge_features').select('*').order('lodge_id')
  return data || []
}

export async function getTestDataResetPreview(targetLodgeId, payload = {}) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { data, error } = await requireAdmin().rpc('get_test_data_reset_preview', {
    p_lodge_id: targetLodgeId,
    p_mode: payload?.mode || 'full_demo_reset',
    p_days: Number(payload?.days || 30)
  })
  if (error) throw new Error(error.message)
  if (data?.success === false) throw new Error(data.error || 'Could not preview test reset')
  return data
}

export async function runTestDataReset(targetLodgeId, payload = {}) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { data, error } = await requireAdmin().rpc('reset_test_data', {
    p_lodge_id: targetLodgeId,
    p_mode: payload?.mode || 'full_demo_reset',
    p_days: Number(payload?.days || 30),
    p_confirmation: payload?.confirmation || '',
    p_reason: payload?.reason || '',
    p_triggered_by: currentUser?.id || null
  })
  if (error) throw new Error(error.message)
  if (data?.success === false) throw new Error(data.error || 'Could not reset test data')
  await logAdminActivity(targetLodgeId, payload?.lodge_name || null, 'test_data_reset', {
    mode: payload?.mode || 'full_demo_reset',
    days: Number(payload?.days || 30),
    reason: payload?.reason || '',
    deleted_counts: data?.deleted_counts || {}
  })
  if (targetLodgeId && targetLodgeId === lodgeId) {
    clearCache('bookings')
    clearCache('customers')
    clearCache('quotations')
    clearCache('expenses')
    clearCache('posOrders')
    clearCache('maintenance')
    try {
      await Promise.allSettled([
        refreshCache('bookings'),
        refreshCache('customers'),
        refreshCache('quotations'),
        refreshCache('expenses'),
        refreshCache('posOrders'),
        refreshCache('maintenance')
      ])
    } catch (_) {
      // Non-fatal: the reset already completed remotely, and stale cache will self-heal on next refresh.
    }
  }
  return data
}

export async function getTestDataResetAudit(targetLodgeId, limit = 20) {
  if (!isOnline) return []
  const { data, error } = await requireAdmin().rpc('get_test_data_reset_audit', {
    p_lodge_id: targetLodgeId,
    p_limit: Number(limit || 20)
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

// ─── ADMIN: SUPPORT TICKETS ────────────────────────────────────────────────────

export async function getSupportTickets(filters = {}) {
  if (!isOnline) return []
  let q = requireAdmin().from('support_tickets').select('*')
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.priority) q = q.eq('priority', filters.priority)
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id)
  const { data } = await q.order('created_at', { ascending: false })
  return data || []
}

export async function createSupportTicket({ lodge_id, lodge_name, title, description, category, priority }) {
  if (!isOnline) throw new Error('Requires internet connection')
  // Use the admin client when available (Command Central machine) to bypass RLS.
  // On lodge machines (no service key), fall back to the anon client — the anon
  // client can INSERT but cannot SELECT from support_tickets, so we skip .select()
  // to avoid a false RLS failure on the read-back that would mask a successful insert.
  const client = adminDb || supabase
  const { error } = await client
    .from('support_tickets')
    .insert({
      lodge_id: lodge_id || lodgeId,
      lodge_name: lodge_name || null,
      title,
      description,
      category: category || 'General',
      priority: priority || 'Normal',
      status: 'open'
    })
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function getLodgeSupportTickets(limit = 20) {
  if (!isOnline) return []
  const { data, error } = await supabase.rpc('get_lodge_support_tickets', {
    p_lodge_id: lodgeId,
    p_limit: Math.min(Math.max(Number(limit) || 20, 1), 100)
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

export async function getLodgeSupportTicketById(id) {
  if (!id || !isOnline) return null
  const tickets = await getLodgeSupportTickets(100)
  return tickets.find((ticket) => ticket.id === id) || null
}

export async function updateLodgeSupportTicket(id, updates = {}) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { data, error } = await supabase.rpc('update_lodge_support_ticket', {
    p_ticket_id: id,
    p_lodge_id: lodgeId,
    p_status: updates.status || null,
    p_admin_notes: Object.prototype.hasOwnProperty.call(updates, 'admin_notes')
      ? updates.admin_notes
      : null
  })
  if (error) throw new Error(error.message)
  if (data?.success === false) throw new Error(data.error || 'Could not update request')
  return { success: true }
}

export async function updateSupportTicket(id, updates) {
  if (!isOnline) throw new Error('Requires internet connection')
  const payload = { ...updates, updated_at: new Date().toISOString() }
  if (updates.status === 'resolved' && !updates.resolved_at) {
    payload.resolved_at = new Date().toISOString()
  }
  const { error } = await requireAdmin().from('support_tickets').update(payload).eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function deleteSupportTicket(id) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await requireAdmin().from('support_tickets').delete().eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

// ─── ADMIN: ACTIVITY LOGS ──────────────────────────────────────────────────────

async function logAdminActivity(targetLodgeId, targetLodgeName, action, details = {}) {
  if (!isOnline || !adminDb) return // fire-and-forget, silent; skip if no admin client
  adminDb.from('activity_logs').insert({
    lodge_id: targetLodgeId,
    lodge_name: targetLodgeName || null,
    action,
    details
  }).then(() => {}).catch(() => {})
}

export async function getActivityLogs(filters = {}) {
  if (!isOnline) return []
  let q = requireAdmin().from('activity_logs').select('*')
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id)
  if (filters.start) q = q.gte('created_at', filters.start)
  if (filters.end) q = q.lte('created_at', filters.end)
  const limit = filters.limit || 200
  const { data } = await q.order('created_at', { ascending: false }).limit(limit)
  return data || []
}

// ─── ADMIN: COMPANY STATS ──────────────────────────────────────────────────────

export async function getCompanyStats(targetLodgeId) {
  if (!isOnline) return null
  const db = requireAdmin()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const [rooms, users, bookings, expenses, maintenance] = await Promise.all([
    db.from('rooms').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId),
    db.from('users').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId),
    db.from('bookings').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId).gte('created_at', thirtyDaysAgo),
    db.from('expenses').select('amount').eq('lodge_id', targetLodgeId).gte('date', thirtyDaysAgo),
    db.from('maintenance_tickets').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId).eq('status', 'open')
  ])
  const expenseTotal = (expenses.data || []).reduce((sum, e) => sum + Number(e.amount || 0), 0)
  return {
    rooms: rooms.count || 0,
    users: users.count || 0,
    bookings_30d: bookings.count || 0,
    expenses_30d: expenseTotal,
    open_maintenance: maintenance.count || 0
  }
}

// ─── ADMIN: BILLING ────────────────────────────────────────────────────────────

export async function updateLicenseBilling(id, data) {
  if (!isOnline) throw new Error('Requires internet connection')
  const update = { ...data }
  if (Object.prototype.hasOwnProperty.call(update, 'subscription_plan')) {
    update.subscription_plan = normalizePlanName(update.subscription_plan)
  }
  try {
    const { data: result, error } = await requireAdmin().rpc('update_subscription_contract', {
      p_license_id: id,
      p_payload: update
    })
    if (error) throw error
    if (result?.success === false) throw new Error(result.error || 'Could not update subscription')
    return { success: true }
  } catch (error) {
    if (!isMissingEntitlementRpcError(error)) throw new Error(error.message)
  }
  const { error } = await requireAdmin().from('licenses').update(update).eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function getOverdueLicenses() {
  if (!isOnline) return []
  const today = new Date().toISOString().split('T')[0]
  const { data } = await requireAdmin()
    .from('licenses')
    .select('*')
    .lt('next_due_date', today)
    .neq('payment_status', 'free')
    .eq('is_active', true)
  return data || []
}

// ─── INVOICES ────────────────────────────────────────────────────────────────────

function isMissingInvoiceNumberRpcError(error) {
  const message = String(error?.message || '')
  return error?.code === 'PGRST202'
    || /public\.get_next_invoice_number|get_next_invoice_number.*schema cache|schema cache.*get_next_invoice_number/i.test(message)
}

function formatInvoiceNumber(year, sequence) {
  return `INV-${year}-${String(sequence).padStart(4, '0')}`
}

function parseInvoiceSequence(invoiceNumber, prefix) {
  if (typeof invoiceNumber !== 'string' || !invoiceNumber.startsWith(prefix)) return null
  const sequence = Number.parseInt(invoiceNumber.slice(prefix.length), 10)
  return Number.isInteger(sequence) ? sequence : null
}

async function getNextInvoiceNumberByLookup(db) {
  const year = new Date().getFullYear()
  const prefix = `INV-${year}-`

  const [bookingResult, invoiceResult] = await Promise.all([
    db
      .from('bookings')
      .select('invoice_number')
      .eq('lodge_id', lodgeId)
      .like('invoice_number', `${prefix}%`),
    db
      .from('invoices')
      .select('invoice_number')
      .eq('lodge_id', lodgeId)
      .like('invoice_number', `${prefix}%`)
  ])

  const rows = []
  const errors = []
  let successfulLookups = 0

  if (bookingResult.error) errors.push(bookingResult.error)
  else {
    successfulLookups += 1
    rows.push(...(bookingResult.data || []))
  }

  if (invoiceResult.error) errors.push(invoiceResult.error)
  else {
    successfulLookups += 1
    rows.push(...(invoiceResult.data || []))
  }

  if (successfulLookups === 0 && errors.length > 0) {
    throw new Error('Failed to generate invoice number: ' + errors[0].message)
  }

  const sequences = rows
    .map((row) => parseInvoiceSequence(row?.invoice_number, prefix))
    .filter((value) => Number.isInteger(value))

  const next = sequences.length > 0 ? Math.max(...sequences) + 1 : 1
  return formatInvoiceNumber(year, next)
}

async function getNextBookingInvoiceNumber() {
  if (isOnline) {
    const { data, error } = await supabase.rpc('get_next_invoice_number', { p_lodge_id: lodgeId })
    if (error) {
      if (!isMissingInvoiceNumberRpcError(error)) {
        throw new Error('Failed to generate invoice number: ' + error.message)
      }
      console.warn('[Invoices] get_next_invoice_number RPC unavailable, falling back to lookup:', error.message)
      return await getNextInvoiceNumberByLookup(supabase)
    }
    return data
  }
  // Offline: return null — server generates the real invoice number when the queued RPC fires.
  // Previously generated a provisional INV-YYYY-XXXX locally, but two offline devices could
  // produce the same number, causing a UNIQUE constraint failure on sync.
  return null
}

export async function getNextInvoiceNumber() {
  // Use the same atomic DB sequence function as booking invoices to prevent
  // collisions under concurrent Command Central usage.
  const db = requireAdmin()
  const { data, error } = await db.rpc('get_next_invoice_number', { p_lodge_id: lodgeId })
  if (error) {
    if (!isMissingInvoiceNumberRpcError(error)) {
      throw new Error('Failed to generate invoice number: ' + error.message)
    }
    console.warn('[Invoices] get_next_invoice_number RPC unavailable for admin flow, falling back to lookup:', error.message)
    return await getNextInvoiceNumberByLookup(db)
  }
  return data
}

export async function createInvoice(data) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { data: row, error } = await requireAdmin().from('invoices').insert(data).select().single()
  if (error) throw new Error(error.message)
  return row
}

export async function getInvoices(filters = {}) {
  if (!isOnline) return []
  let q = requireAdmin().from('invoices').select('*').order('created_at', { ascending: false })
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id)
  if (filters.status)   q = q.eq('status', filters.status)
  const { data } = await q
  return data || []
}

export async function getInvoicesByLodge(lodgeId) {
  if (!isOnline) return []
  const { data } = await supabase
    .from('invoices')
    .select('*')
    .eq('lodge_id', lodgeId)
    .order('issued_at', { ascending: false })
  return data || []
}

export async function getBookingInvoices() {
  const bookings = await getAllBookings()
  let invoiceRows = []

  if (isOnline) {
    let { data, error } = await supabase
      .from('invoices')
      .select('id, booking_id, lodge_id, invoice_number, issued_at, due_date, notes, created_at')
      .eq('lodge_id', lodgeId)
      .not('booking_id', 'is', null)
      .order('issued_at', { ascending: false })

    if (error) {
      const fallback = await supabase
        .from('invoices')
        .select('id, booking_id, lodge_id, invoice_number, issued_at')
        .eq('lodge_id', lodgeId)
        .not('booking_id', 'is', null)
        .order('issued_at', { ascending: false })
      data = fallback.data
      error = fallback.error
    }

    if (error) {
      console.warn('getBookingInvoices using booking-only fallback:', error.message)
      invoiceRows = []
    } else {
      invoiceRows = data || []
    }
  }

  const invoiceByBookingId = new Map(
    invoiceRows
      .filter((invoice) => invoice?.booking_id)
      .map((invoice) => [invoice.booking_id, invoice])
  )

  const rows = bookings
    .map((booking) => {
      const invoice = invoiceByBookingId.get(booking.id)
      const invoice_number = invoice?.invoice_number || booking.invoice_number || booking._local_invoice_number || null
      if (!invoice_number) return null

      const total_amount  = Number(booking.total_amount  || 0)
      const amount_paid   = Number(booking.amount_paid   || 0)
      const charges_total = Number(booking.charges_total || 0)  // || 0 guards against null on older rows
      const nights = Math.max(
        0,
        Math.ceil((new Date(booking.check_out) - new Date(booking.check_in)) / (1000 * 60 * 60 * 24))
      )

      return {
        ...booking,
        booking_id: booking.id,
        invoice_id: invoice?.id || null,
        invoice_number,
        issued_at: invoice?.issued_at || booking.created_at || null,
        due_date: invoice?.due_date || booking.check_in || null,
        invoice_notes: invoice?.notes || '',
        total_amount,
        amount_paid,
        charges_total,
        balance_due: Math.max(0, total_amount + charges_total - amount_paid),
        nights,
        ...(booking.is_exclusive_event ? {
          _event_group: true,
          room_count: parseEventRoomCount(booking.notes) || 1,
          room_type: 'Full Lodge',
          room_number: 'Full Lodge',
          display_notes: stripEventMetadata(booking.notes)
        } : {})
      }
    })
    .filter(Boolean)

  const regularRows = rows.filter((row) => !row.is_exclusive_event)
  const eventRows = rows.filter((row) => row.is_exclusive_event)
  const eventGroups = new Map()
  for (const row of eventRows) {
    const groupId = String(row.notes || '').match(/\[GROUP:([^\]]+)\]/)?.[1] || row.booking_id
    if (!eventGroups.has(groupId)) {
      eventGroups.set(groupId, {
        ...row,
        _event_group: true,
        event_group_id: groupId,
        room_count: parseEventRoomCount(row.notes) || 0,
        room_type: 'Full Lodge',
        room_number: 'Full Lodge',
        display_notes: stripEventMetadata(row.notes),
        _event_booking_ids: []
      })
    }
    const grouped = eventGroups.get(groupId)
    grouped._event_booking_ids.push(row.booking_id)
    grouped.room_count = Math.max(Number(grouped.room_count || 0), parseEventRoomCount(row.notes) || 0, grouped._event_booking_ids.length)
    if (row.booking_id !== grouped.booking_id) {
      grouped.total_amount += Number(row.total_amount || 0)
      grouped.amount_paid += Number(row.amount_paid || 0)
      grouped.charges_total += Number(row.charges_total || 0)
      grouped.balance_due = Math.max(0, grouped.total_amount + grouped.charges_total - grouped.amount_paid)
    }
  }

  return [...regularRows, ...eventGroups.values()]
    .sort((a, b) => {
      const left = String(a.issued_at || a.created_at || a.check_in || '')
      const right = String(b.issued_at || b.created_at || b.check_in || '')
      return right.localeCompare(left)
    })
}

export async function getFinancialAuditLog({ bookingId = null, limit = 100, offset = 0 } = {}) {
  if (!lodgeId || !isOnline) return []
  const { data, error } = await supabase.rpc('get_financial_audit_log', {
    p_lodge_id: lodgeId,
    p_booking_id: bookingId || null,
    p_limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    p_offset: Math.max(Number(offset) || 0, 0)
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data : []
}

function roundMoneyValue(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function moneyMismatch(left, right, tolerance = 0.01) {
  return Math.abs(roundMoneyValue(left) - roundMoneyValue(right)) > tolerance
}

export async function getFinancialReconciliation() {
  if (!lodgeId) {
    return {
      summary: { paymentMismatches: 0, chargeMismatches: 0, invoiceGaps: 0, orphanInvoices: 0, folioPosMismatches: 0 },
      paymentMismatches: [],
      chargeMismatches: [],
      invoiceGaps: [],
      orphanInvoices: [],
      folioPosMismatches: []
    }
  }

  let bookings = []
  let payments = []
  let charges = []
  let invoices = []
  let posOrders = []

  if (isOnline) {
    const [
      bookingsResult,
      paymentsResult,
      chargesResult,
      invoicesResult,
      posOrdersResult
    ] = await Promise.all([
      supabase.from('bookings').select('id, invoice_number, total_amount, charges_total, amount_paid, status, payment_status, check_in, check_out, updated_at').eq('lodge_id', lodgeId),
      supabase.from('payments').select('booking_id, amount, type, paid_at').eq('lodge_id', lodgeId),
      supabase.from('booking_charges').select('id, booking_id, amount, description, voided_at, void_reason, created_at').eq('lodge_id', lodgeId),
      supabase.from('invoices').select('id, booking_id, invoice_number, issued_at, created_at').eq('lodge_id', lodgeId),
      supabase.from('pos_orders').select('id, booking_id, total, payment_method, status, folio_charge_id, created_at').eq('lodge_id', lodgeId)
    ])

    if (bookingsResult.error) throw new Error(bookingsResult.error.message)
    if (paymentsResult.error) throw new Error(paymentsResult.error.message)
    if (chargesResult.error) throw new Error(chargesResult.error.message)
    if (invoicesResult.error) throw new Error(invoicesResult.error.message)
    if (posOrdersResult.error) throw new Error(posOrdersResult.error.message)

    bookings = bookingsResult.data || []
    payments = paymentsResult.data || []
    charges = chargesResult.data || []
    invoices = invoicesResult.data || []
    posOrders = posOrdersResult.data || []
  } else {
    // P0-3: offline reconciliation is INVALID — payment/charge/invoice tables cannot
    // be queried. Return an explicitly invalid result so the UI cannot show "clear".
    return {
      local_only: true,
      valid: false,
      checked_at: new Date().toISOString(),
      summary: { paymentMismatches: 0, chargeMismatches: 0, invoiceGaps: 0, orphanInvoices: 0, folioPosMismatches: 0 },
      paymentMismatches: [],
      chargeMismatches: [],
      invoiceGaps: [],
      orphanInvoices: [],
      folioPosMismatches: [],
      message: 'Reconciliation cannot be verified while offline. Connect to the internet and run again.'
    }
  }

  const paymentsByBooking = new Map()
  for (const payment of payments) {
    const bookingId = payment?.booking_id
    if (!bookingId) continue
    paymentsByBooking.set(bookingId, roundMoneyValue((paymentsByBooking.get(bookingId) || 0) + Number(payment.amount || 0)))
  }

  const activeChargesByBooking = new Map()
  for (const charge of charges) {
    if (charge?.voided_at) continue
    const bookingId = charge?.booking_id
    if (!bookingId) continue
    activeChargesByBooking.set(bookingId, roundMoneyValue((activeChargesByBooking.get(bookingId) || 0) + Number(charge.amount || 0)))
  }

  const invoiceByBooking = new Map()
  for (const invoice of invoices) {
    if (!invoice?.booking_id) continue
    if (!invoiceByBooking.has(invoice.booking_id)) {
      invoiceByBooking.set(invoice.booking_id, invoice)
    }
  }

  const bookingIds = new Set(bookings.map((booking) => booking.id))
  const paymentMismatches = bookings
    .filter((booking) => !['cancelled'].includes(String(booking.status || '').toLowerCase()))
    .map((booking) => {
      const paymentLedgerTotal = roundMoneyValue(paymentsByBooking.get(booking.id) || 0)
      const cachedAmountPaid = roundMoneyValue(booking.amount_paid || 0)
      return {
        booking_id: booking.id,
        invoice_number: booking.invoice_number || null,
        status: booking.status || '',
        booking_amount_paid: cachedAmountPaid,
        payment_ledger_total: paymentLedgerTotal,
        difference: roundMoneyValue(cachedAmountPaid - paymentLedgerTotal),
        updated_at: booking.updated_at || null
      }
    })
    .filter((row) => moneyMismatch(row.booking_amount_paid, row.payment_ledger_total))
    .sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference))

  const chargeMismatches = bookings
    .filter((booking) => !['cancelled'].includes(String(booking.status || '').toLowerCase()))
    .map((booking) => {
      const chargeLedgerTotal = roundMoneyValue(activeChargesByBooking.get(booking.id) || 0)
      const cachedChargesTotal = roundMoneyValue(booking.charges_total || 0)
      return {
        booking_id: booking.id,
        invoice_number: booking.invoice_number || null,
        status: booking.status || '',
        booking_charges_total: cachedChargesTotal,
        charge_ledger_total: chargeLedgerTotal,
        difference: roundMoneyValue(cachedChargesTotal - chargeLedgerTotal),
        updated_at: booking.updated_at || null
      }
    })
    .filter((row) => moneyMismatch(row.booking_charges_total, row.charge_ledger_total))
    .sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference))

  const invoiceGaps = bookings
    .filter((booking) => String(booking.status || '').toLowerCase() !== 'cancelled')
    .filter((booking) => !String(booking.invoice_number || '').trim() || !invoiceByBooking.has(booking.id))
    .map((booking) => ({
      booking_id: booking.id,
      invoice_number: booking.invoice_number || null,
      status: booking.status || '',
      check_in: booking.check_in || null,
      check_out: booking.check_out || null,
      missing_invoice_number: !String(booking.invoice_number || '').trim(),
      missing_invoice_row: !invoiceByBooking.has(booking.id)
    }))

  const orphanInvoices = invoices
    .filter((invoice) => !invoice?.booking_id || !bookingIds.has(invoice.booking_id))
    .map((invoice) => ({
      invoice_id: invoice.id,
      booking_id: invoice.booking_id || null,
      invoice_number: invoice.invoice_number || null,
      issued_at: invoice.issued_at || invoice.created_at || null
    }))

  const folioPosMismatches = (posOrders || [])
    .filter((order) => String(order?.payment_method || '').toLowerCase() === 'folio')
    .filter((order) => String(order?.status || '').toLowerCase() !== 'voided')
    .map((order) => {
      const bookingId = order?.booking_id || null
      const bookingExists = bookingId ? bookingIds.has(bookingId) : false
      const matchingCharge = order?.folio_charge_id
        ? charges.find((charge) => charge.id === order.folio_charge_id && !charge.voided_at)
        : null
      return {
        order_id: order.id,
        booking_id: bookingId,
        order_total: roundMoneyValue(order.total || 0),
        folio_charge_id: order.folio_charge_id || null,
        folio_charge_total: roundMoneyValue(matchingCharge?.amount || 0),
        issue: !bookingId
          ? 'missing_booking'
          : !bookingExists
            ? 'orphan_booking'
            : !order.folio_charge_id
              ? 'missing_folio_charge'
              : !matchingCharge
                ? 'missing_charge_row'
                : moneyMismatch(order.total || 0, matchingCharge.amount || 0)
                  ? 'amount_mismatch'
                  : null,
        created_at: order.created_at || null
      }
    })
    .filter((row) => row.issue)

  return {
    valid: true,
    local_only: false,
    checked_at: new Date().toISOString(),
    summary: {
      paymentMismatches: paymentMismatches.length,
      chargeMismatches: chargeMismatches.length,
      invoiceGaps: invoiceGaps.length,
      orphanInvoices: orphanInvoices.length,
      folioPosMismatches: folioPosMismatches.length
    },
    paymentMismatches: paymentMismatches.slice(0, 50),
    chargeMismatches: chargeMismatches.slice(0, 50),
    invoiceGaps: invoiceGaps.slice(0, 50),
    orphanInvoices: orphanInvoices.slice(0, 50),
    folioPosMismatches: folioPosMismatches.slice(0, 50)
  }
}

export async function getFinancialValidationSummary() {
  const reconciliation = await getFinancialReconciliation()
  const auditRows = isOnline ? await getFinancialAuditLog({ limit: 200 }) : []

  const recentRefunds = auditRows
    .filter((row) => row.action === 'refund_recorded')
    .slice(0, 10)
    .map((row) => ({
      booking_id: row.booking_id,
      amount_delta: roundMoneyValue(row.amount_delta || 0),
      created_at: row.created_at,
      actor_id: row.actor_id || null,
      retained_percent: row.after_snapshot?.refund_retained_percent ?? null
    }))

  const recentChargeVoids = auditRows
    .filter((row) => row.action === 'charge_deleted')
    .slice(0, 10)
    .map((row) => ({
      booking_id: row.booking_id,
      created_at: row.created_at,
      actor_id: row.actor_id || null,
      amount_delta: roundMoneyValue(row.amount_delta || 0),
      reason: row.after_snapshot?.void_reason || null
    }))

  return {
    checked_at: new Date().toISOString(),
    totals: {
      audit_rows_sampled: auditRows.length,
      recent_refunds: recentRefunds.length,
      recent_charge_voids: recentChargeVoids.length,
      payment_mismatches: reconciliation.summary.paymentMismatches,
      charge_mismatches: reconciliation.summary.chargeMismatches,
      folio_pos_mismatches: reconciliation.summary.folioPosMismatches,
      invoice_gaps: reconciliation.summary.invoiceGaps,
      orphan_invoices: reconciliation.summary.orphanInvoices
    },
    recentRefunds,
    recentChargeVoids,
    reconciliation
  }
}

export async function recordInvoiceDelivery(payload = {}) {
  const row = {
    id: payload.id || randomUUID(),
    lodge_id: lodgeId || payload.lodge_id || null,
    booking_id: payload.booking_id || null,
    invoice_number: payload.invoice_number || null,
    delivery_type: payload.delivery_type || 'invoice_email',
    delivery_status: payload.delivery_status || 'completed',
    recipient: payload.recipient || null,
    file_path: payload.file_path || null,
    render_version: payload.render_version || null,
    initiated_by: currentUser?.id || payload.initiated_by || null,
    initiated_by_name: currentUser?.name || payload.initiated_by_name || null,
    metadata: payload.metadata || {},
    created_at: new Date().toISOString(),
    local_only: !isOnline
  }

  if (!isOnline || !lodgeId) {
    appendAuxiliaryLog(LOCAL_INVOICE_DELIVERY_FILE, row, 300)
    return { success: true, localOnly: true, row }
  }

  const { data, error } = await supabase.rpc('record_invoice_delivery', {
    p_lodge_id: lodgeId,
    p_booking_id: payload.booking_id || null,
    p_invoice_number: payload.invoice_number || null,
    p_delivery_type: payload.delivery_type || 'invoice_email',
    p_delivery_status: payload.delivery_status || 'completed',
    p_recipient: payload.recipient || null,
    p_file_path: payload.file_path || null,
    p_render_version: payload.render_version || null,
    p_initiated_by: currentUser?.id || null,
    p_metadata: payload.metadata || {}
  })

  if (error) throw new Error(error.message)
  return { success: data?.success !== false, id: data?.id || null, row: { ...row, local_only: false } }
}

export async function getInvoiceDeliveryHistory({ bookingId = null, limit = 100 } = {}) {
  const localRows = readAuxiliaryLog(LOCAL_INVOICE_DELIVERY_FILE)
    .filter((row) => !bookingId || row.booking_id === bookingId)
    .slice(0, limit)

  if (!isOnline || !lodgeId) return localRows

  const { data, error } = await supabase.rpc('get_invoice_delivery_history', {
    p_lodge_id: lodgeId,
    p_booking_id: bookingId || null,
    p_limit: limit
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data.map((row) => ({ ...row, local_only: false })) : []
}

export async function runFinancialValidation({ triggerSource = 'manual' } = {}) {
  const validation = await getFinancialValidationSummary()
  const run = {
    id: randomUUID(),
    lodge_id: lodgeId,
    triggered_by: currentUser?.id || null,
    triggered_by_name: currentUser?.name || null,
    trigger_source: ['manual', 'scheduled', 'startup'].includes(triggerSource) ? triggerSource : 'manual',
    date_key: getLocalDateKey(new Date(), LOCAL_TIME_ZONE),
    summary: {
      checked_at: validation.checked_at,
      totals: validation.totals,
      sample: {
        recent_refunds: validation.recentRefunds || [],
        recent_charge_voids: validation.recentChargeVoids || []
      }
    },
    created_at: new Date().toISOString(),
    local_only: !isOnline
  }

  appendAuxiliaryLog(FINANCIAL_VALIDATION_RUNS_FILE, run, 120)

  const issueCount =
    Number(validation?.totals?.payment_mismatches || 0) +
    Number(validation?.totals?.charge_mismatches || 0) +
    Number(validation?.totals?.folio_pos_mismatches || 0) +
    Number(validation?.totals?.invoice_gaps || 0) +
    Number(validation?.totals?.orphan_invoices || 0)

  if (issueCount > 0) {
    appendAuxiliaryLog(FINANCIAL_VALIDATION_ALERTS_FILE, {
      id: randomUUID(),
      at: new Date().toISOString(),
      lodge_id: lodgeId || null,
      trigger_source: run.trigger_source,
      issue_count: issueCount,
      totals: validation.totals
    }, 120)
  }

  if (isOnline && lodgeId) {
    try {
      await supabase.rpc('record_financial_validation_run', {
        p_lodge_id: lodgeId,
        p_trigger_source: run.trigger_source,
        p_triggered_by: currentUser?.id || null,
        p_summary: run.summary
      })
      run.local_only = false
    } catch (error) {
      console.warn('record_financial_validation_run failed:', error?.message || error)
    }
  }

  logActivity(
    'financial_validation_run',
    `Financial validation run · ${run.trigger_source} · ${validation.totals.payment_mismatches || 0} payment mismatches · ${validation.totals.charge_mismatches || 0} charge mismatches · ${validation.totals.folio_pos_mismatches || 0} folio POS mismatches · ${validation.totals.invoice_gaps || 0} invoice gaps`
  )

  return { success: true, run, validation }
}

export async function getFinancialValidationAlerts(limit = 30) {
  const localAlerts = readAuxiliaryLog(FINANCIAL_VALIDATION_ALERTS_FILE).slice(0, limit)
  if (!isOnline || !lodgeId) return localAlerts

  try {
    const { data, error } = await supabase.rpc('get_financial_validation_alerts', {
      p_lodge_id: lodgeId,
      p_limit: limit
    })
    if (error) throw error
    return Array.isArray(data) ? data.map((row) => ({ ...row, local_only: false })) : localAlerts
  } catch (error) {
    recordCriticalError('financial.validation.alerts', error, { limit }, { level: 'warn', limit: 120 })
    return localAlerts
  }
}

export function getCriticalErrorLog(limit = 100) {
  return readAuxiliaryLog(CRITICAL_ERROR_LOG_FILE).slice(0, limit)
}

export function clearCriticalErrorLog() {
  writeAuxiliaryLog(CRITICAL_ERROR_LOG_FILE, [])
  return { success: true }
}

export async function getSupportBundle(limit = 20) {
  const systemHealth = await getSystemHealth().catch((error) => ({ error: error?.message || String(error) }))
  const syncStatus = getSyncStatus()
  const syncDetails = getSyncDetails()
  const reconciliation = await getFinancialReconciliation().catch((error) => ({ error: error?.message || String(error) }))
  const validation = await getFinancialValidationSummary().catch((error) => ({ error: error?.message || String(error) }))
  const validationRuns = await getFinancialValidationRuns(limit).catch(() => [])
  const validationAlerts = await getFinancialValidationAlerts(limit).catch(() => [])
  const criticalErrors = getCriticalErrorLog(limit)
  const syncMeta = readSyncMeta()
  const healthFaults = readHealthFaults().slice(0, Math.max(1, Number(limit) || 20))

  return {
    generated_at: new Date().toISOString(),
    lodge_id: lodgeId || null,
    user_id: currentUser?.id || null,
    user_name: currentUser?.name || null,
    app_online: isOnline,
    system_health: systemHealth,
    sync_status: syncStatus,
    sync_details: syncDetails,
    syncMeta,
    healthFaults,
    financial_reconciliation: reconciliation,
    financial_validation: validation,
    financial_validation_runs: validationRuns,
    financial_validation_alerts: validationAlerts,
    critical_errors: criticalErrors
  }
}

export async function getOfflineSafetyData() {
  const today = getLocalDateKey(new Date(), LOCAL_TIME_ZONE)
  const tomorrow = getLocalDateKey(addDays(new Date(), 1), LOCAL_TIME_ZONE)
  const bookings = await getAllBookings().catch(() => readCache('bookings'))
  const rooms = await getAllRooms().catch(() => readCache('rooms'))
  const customers = await getAllCustomers().catch(() => readCache('customers'))
  const inventoryItems = await getInventoryItems().catch(() => readCache('inventory-items'))

  const roomById = new Map((rooms || []).map((room) => [room.id, room]))
  const customerById = new Map((customers || []).map((customer) => [customer.id, customer]))
  const activeBookings = (bookings || []).filter((booking) => String(booking?.status || '').toLowerCase() !== 'cancelled')
  const enrichBooking = (booking) => {
    const room = roomById.get(booking.room_id) || {}
    const customer = customerById.get(booking.customer_id) || {}
    const total = Number(booking.total_amount || 0) + Number(booking.charges_total || 0)
    const paid = Number(booking.amount_paid || 0)
    return {
      booking_id: booking.id,
      booking_number: booking.booking_number || booking.invoice_number || '',
      guest_name: booking.customer_name || customer.name || '',
      room_number: booking.room_number || room.room_number || '',
      check_in: booking.check_in || '',
      check_out: booking.check_out || '',
      status: booking.status || '',
      payment_status: booking.payment_status || '',
      balance: Math.max(0, total - paid)
    }
  }

  return {
    generated_at: new Date().toISOString(),
    lodge_id: lodgeId || null,
    source: isOnline ? 'online' : 'offline-cache',
    arrivals: activeBookings.filter((booking) => booking.check_in === today).map(enrichBooking),
    departures: activeBookings.filter((booking) => booking.check_out === today).map(enrichBooking),
    in_house: activeBookings.filter((booking) => booking.check_in <= today && booking.check_out > today).map(enrichBooking),
    due_tomorrow: activeBookings.filter((booking) => booking.check_in === tomorrow || booking.check_out === tomorrow).map(enrichBooking),
    unpaid: activeBookings
      .filter((booking) => ['partial', 'unpaid', ''].includes(String(booking.payment_status || '').toLowerCase()))
      .map(enrichBooking)
      .filter((booking) => booking.balance > 0),
    low_stock: (inventoryItems || [])
      .filter((item) => Number(item.reorder_level || 0) > 0 && Number(item.current_stock || 0) <= Number(item.reorder_level || 0))
      .map((item) => ({
        item_id: item.id,
        name: item.name || item.item_name || '',
        category: item.category || '',
        current_stock: Number(item.current_stock || 0),
        reorder_level: Number(item.reorder_level || 0),
        unit: item.unit || ''
      }))
  }
}

function getDesktopDeviceId() {
  try {
    const source = app?.getPath?.('userData') || cacheRootDir || 'boroko-desktop'
    return crypto.createHash('sha256').update(String(source)).digest('hex').slice(0, 24)
  } catch {
    return 'desktop-unknown'
  }
}

export async function publishDeviceHealth() {
  if (!isOnline || !lodgeId) return { success: false, skipped: true, error: 'Offline or lodge not selected.' }
  const details = getSyncDetails()
  const faults = readHealthFaults()
  const reconciliation = await getFinancialReconciliation().catch(() => ({ state: 'unknown' }))
  const topFaultTypes = [...new Set(faults.map((fault) => fault?.type).filter(Boolean))].slice(0, 10)
  const { data, error } = await supabase.rpc('upsert_device_health', {
    p_lodge_id: lodgeId,
    p_device_id: getDesktopDeviceId(),
    p_client_type: 'desktop',
    p_pending_queue_count: details.pendingCount || 0,
    p_failed_queue_count: details.failedCount || 0,
    p_unresolved_local_count: details.unresolvedLocal?.length || 0,
    p_replay_auth_ready: !!replayAuthReady,
    p_last_successful_sync_at: details.lastSuccessfulSyncAt || null,
    p_reconciliation_state: reconciliation?.state || 'unknown',
    p_top_fault_types: topFaultTypes,
    p_raw_summary: {
      pendingCount: details.pendingCount || 0,
      failedCount: details.failedCount || 0,
      unresolvedLocalCount: details.unresolvedLocal?.length || 0,
      driftFaultTypes: SYNC_DRIFT_FAULT_TYPES
    }
  })
  if (error) throw new Error(error.message)
  if (data?.success === false) throw new Error(data.error || 'Could not publish device health')
  return { success: true }
}

export async function getDeviceHealthRollup() {
  if (!isOnline || !lodgeId) return { available: false, devices: [] }
  await publishDeviceHealth().catch(() => {})
  const { data, error } = await supabase.rpc('get_device_health_rollup', { p_lodge_id: lodgeId })
  if (error) throw new Error(error.message)
  return { available: true, devices: Array.isArray(data) ? data : [] }
}

export async function getFinancialValidationRuns(limit = 30) {
  const localRuns = readAuxiliaryLog(FINANCIAL_VALIDATION_RUNS_FILE).slice(0, limit)
  if (!isOnline || !lodgeId) return localRuns

  const { data, error } = await supabase.rpc('get_financial_validation_runs', {
    p_lodge_id: lodgeId,
    p_limit: limit
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data.map((row) => ({ ...row, local_only: false })) : []
}

export async function runScheduledFinancialValidation(triggerSource = 'scheduled') {
  if (!currentUser || !lodgeId) return { success: false, skipped: true, reason: 'Not signed in' }
  const todayKey = getLocalDateKey(new Date(), LOCAL_TIME_ZONE)
  const existingRuns = readAuxiliaryLog(FINANCIAL_VALIDATION_RUNS_FILE)
  const alreadyRanToday = existingRuns.some((row) => row?.lodge_id === lodgeId && row?.date_key === todayKey)
  if (alreadyRanToday) return { success: true, skipped: true, reason: 'Already ran today' }
  return runFinancialValidation({ triggerSource })
}

export async function updateInvoice(id, updates) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await requireAdmin().from('invoices').update(updates).eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function deleteInvoice(id) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await requireAdmin().from('invoices').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getInvoiceSummary() {
  if (!isOnline) return { total: 0, byPlan: {}, byMonth: [], allRows: [] }
  const { data } = await requireAdmin()
    .from('invoices')
    .select('amount, currency, package_name, issued_date, status')
  const allRows = data || []
  const paid = allRows.filter(r => r.status === 'paid')
  const total = paid.reduce((s, r) => s + Number(r.amount), 0)
  const byPlan = {}
  paid.forEach(r => {
    const planName = normalizePlanName(r.package_name)
    byPlan[planName] = (byPlan[planName] || 0) + Number(r.amount)
  })
  const byMonthMap = {}
  paid.forEach(r => {
    const m = (r.issued_date || '').slice(0, 7)
    if (m) byMonthMap[m] = (byMonthMap[m] || 0) + Number(r.amount)
  })
  const byMonth = Object.entries(byMonthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }))
  const currency = paid[0]?.currency || 'USD'
  return { total, byPlan, byMonth, currency, allRows }
}

// ─── CONFERENCE BOOKINGS ───────────────────────────────────────────────────────

export async function getConferenceBookings(start, end) {
  const cached = readCache('conference-bookings')
  if (!isOnline) {
    return cached
      .filter((row) => (!start || String(row.booking_date || '') >= start) && (!end || String(row.booking_date || '') <= end))
      .sort((a, b) => String(b.booking_date || '').localeCompare(String(a.booking_date || '')) || String(a.start_time || '').localeCompare(String(b.start_time || '')))
  }
  let q = supabase.from('conference_bookings').select('*').eq('lodge_id', lodgeId)
  if (start) q = q.gte('booking_date', start)
  if (end) q = q.lte('booking_date', end)
  const { data } = await q.order('booking_date', { ascending: false }).order('start_time', { ascending: true })
  if (data) writeCache('conference-bookings', data, { source: 'remote' })
  return data || []
}

export async function getConferenceBookingById(id) {
  if (!id) return null
  if (!isOnline) return readCache('conference-bookings').find((row) => row.id === id) || null
  const { data, error } = await supabase
    .from('conference_bookings')
    .select('*')
    .eq('lodge_id', lodgeId)
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data || null
}

export async function createConferenceBooking(data) {
  await checkExclusiveEventConflict(data.booking_date, data.booking_date + 'T23:59:59')
  const id = randomUUID()
  const payload = {
    id,
    lodge_id: lodgeId,
    booking_date: data.booking_date,
    start_time: data.start_time,
    end_time: data.end_time,
    client_name: data.client_name,
    company: data.company || null,
    attendees: data.attendees || 0,
    setup_type: data.setup_type || 'Theatre',
    room_name: data.room_name || 'Conference Room',
    includes_catering: data.includes_catering || false,
    catering_notes: data.catering_notes || null,
    total_amount: data.total_amount || 0,
    deposit_paid: data.deposit_paid || 0,
    payment_status: data.payment_status || 'pending',
    payment_method: data.payment_method || null,
    notes: data.notes || null
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('create_conference_booking', { payload })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not create conference booking')
    writeCache('conference-bookings', [payload, ...readCache('conference-bookings').filter((row) => row.id !== id)], { source: 'local' })
    logActivity('conference_booking_created', `Conference booking · ${data.client_name}${data.company ? ' · ' + data.company : ''} · ${data.booking_date} · ${data.room_name || 'Conference Room'}`)
    return { id: result.id || id }
  }
  const offlineRow = {
    ...payload,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null
  }
  writeCache('conference-bookings', [offlineRow, ...readCache('conference-bookings').filter((row) => row.id !== id)], { source: 'local' })
  queueOperation('rpc', 'create_conference_booking', { payload })
  logActivity('conference_booking_created', `(Offline) Conference booking · ${data.client_name} · ${data.booking_date}`)
  return { id }
}

export async function updateConferenceBooking(id, data) {
  if (!id) throw new Error('Conference booking ID is required')
  if (!isOnline) {
    const cached = readCache('conference-bookings')
    const existing = cached.find((row) => row.id === id)
    const dependsOn = existing?._pending_sync ? `conference-${id}` : null
    writeCache('conference-bookings', cached.map((row) => row.id === id
      ? { ...row, ...data, _pending_sync: true, _sync_state: 'pending', _sync_error: null, updated_at: new Date().toISOString() }
      : row
    ), { source: 'local' })
    queueOperation('rpc', 'update_conference_booking', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: data
    }, null, dependsOn ? { _depends_on: dependsOn } : {})
    return { success: true }
  }
  const { data: result, error } = await supabase.rpc('update_conference_booking', {
    p_id: id,
    p_lodge_id: lodgeId,
    payload: data
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not update conference booking')
  writeCache('conference-bookings', readCache('conference-bookings').map((row) => row.id === id ? { ...row, ...data } : row), { source: 'local' })
  return { success: true }
}

export async function deleteConferenceBooking(id) {
  if (!id) throw new Error('Conference booking ID is required')
  if (!isOnline) {
    const cached = readCache('conference-bookings')
    const existing = cached.find((row) => row.id === id)
    const dependsOn = existing?._pending_sync ? `conference-${id}` : null
    writeCache('conference-bookings', cached.filter((row) => row.id !== id), { source: 'local' })
    queueOperation('rpc', 'delete_conference_booking', {
      p_id: id,
      p_lodge_id: lodgeId
    }, null, dependsOn ? { _depends_on: dependsOn } : {})
    return { success: true }
  }
  const { data: result, error } = await supabase.rpc('delete_conference_booking', {
    p_id: id,
    p_lodge_id: lodgeId
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not delete conference booking')
  writeCache('conference-bookings', readCache('conference-bookings').filter((row) => row.id !== id), { source: 'local' })
  return { success: true }
}

// ─── POOL / DAY USE ────────────────────────────────────────────────────────────

export async function getPoolDayUse(start, end) {
  const cached = readCache('pool-day-use')
  if (!isOnline) {
    return cached
      .filter((row) => (!start || String(row.date || '') >= start) && (!end || String(row.date || '') <= end))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
  }
  let q = supabase.from('pool_day_use').select('*').eq('lodge_id', lodgeId)
  if (start) q = q.gte('date', start)
  if (end) q = q.lte('date', end)
  const { data } = await q.order('date', { ascending: false }).order('created_at', { ascending: false })
  if (data) writeCache('pool-day-use', data, { source: 'remote' })
  return data || []
}

export async function getPoolDayUseById(id) {
  if (!id) return null
  if (!isOnline) return readCache('pool-day-use').find((row) => row.id === id) || null
  const { data, error } = await supabase
    .from('pool_day_use')
    .select('*')
    .eq('lodge_id', lodgeId)
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data || null
}

export async function addPoolDayUse(data) {
  await checkExclusiveEventConflict(data.date, data.date + 'T23:59:59')
  if (Number(data.fee_per_adult || 0) < 0 || Number(data.fee_per_child || 0) < 0) {
    throw new Error('Day-use fees cannot be negative')
  }
  if (Number(data.fee_per_adult || 0) > MAX_FINANCIAL_AMOUNT || Number(data.fee_per_child || 0) > MAX_FINANCIAL_AMOUNT) {
    throw new Error(`Day-use fees cannot exceed P${MAX_FINANCIAL_AMOUNT.toLocaleString('en-BW')}`)
  }
  const total = (data.adults || 0) * (data.fee_per_adult || 0) + (data.children || 0) * (data.fee_per_child || 0)
  const id = randomUUID()
  const payload = {
    id,
    lodge_id: lodgeId,
    date: data.date,
    guest_name: data.guest_name || 'Walk-in',
    phone: data.phone || null,
    adults: data.adults || 1,
    children: data.children || 0,
    fee_per_adult: data.fee_per_adult || 0,
    fee_per_child: data.fee_per_child || 0,
    total,
    payment_method: data.payment_method || 'cash',
    notes: data.notes || null
  }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('add_pool_day_use', { payload })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not add pool day-use entry')
    writeCache('pool-day-use', [payload, ...readCache('pool-day-use').filter((row) => row.id !== id)], { source: 'local' })
    logActivity('pool_day_use_added', `Pool day use · ${data.guest_name || 'Walk-in'} · ${data.date} · P${total}`)
    return { id: result.id || id }
  }
  const offlineRow = {
    ...payload,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    created_at: new Date().toISOString()
  }
  writeCache('pool-day-use', [offlineRow, ...readCache('pool-day-use').filter((row) => row.id !== id)], { source: 'local' })
  queueOperation('rpc', 'add_pool_day_use', { payload })
  logActivity('pool_day_use_added', `(Offline) Pool day use · ${data.guest_name || 'Walk-in'} · ${data.date} · P${total}`)
  return { id }
}

export async function deletePoolDayUse(id) {
  if (!id) throw new Error('Pool day-use ID is required')
  if (!isOnline) {
    const cached = readCache('pool-day-use')
    const existing = cached.find((row) => row.id === id)
    const dependsOn = existing?._pending_sync ? `dayuse-${id}` : null
    writeCache('pool-day-use', cached.filter((row) => row.id !== id), { source: 'local' })
    queueOperation('rpc', 'delete_pool_day_use', {
      p_id: id,
      p_lodge_id: lodgeId
    }, null, dependsOn ? { _depends_on: dependsOn } : {})
    return { success: true }
  }
  const { data: result, error } = await supabase.rpc('delete_pool_day_use', {
    p_id: id,
    p_lodge_id: lodgeId
  })
  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Could not delete pool day-use entry')
  writeCache('pool-day-use', readCache('pool-day-use').filter((row) => row.id !== id), { source: 'local' })
  return { success: true }
}

export async function getPoolDayUseSummary(date) {
  const entries = isOnline
    ? ((await supabase.from('pool_day_use').select('*').eq('lodge_id', lodgeId).eq('date', date)).data || [])
    : readCache('pool-day-use').filter((row) => row.date === date)
  return {
    total: entries.reduce((s, e) => s + (e.total || 0), 0),
    adults: entries.reduce((s, e) => s + (e.adults || 0), 0),
    children: entries.reduce((s, e) => s + (e.children || 0), 0),
    entries
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// QUOTATIONS
// ─────────────────────────────────────────────────────────────────────────────

async function getNextQuotationNumber() {
  const year = new Date().getFullYear()
  const prefix = `Q-${year}-`
  let nums = []
  if (isOnline) {
    const { data } = await supabase
      .from('quotations')
      .select('quotation_number')
      .eq('lodge_id', lodgeId)
      .like('quotation_number', `${prefix}%`)
    nums = (data || [])
      .map(r => parseInt((r.quotation_number || '').replace(prefix, ''), 10))
      .filter(n => !isNaN(n))
  } else {
    nums = readCache('quotations')
      .filter(q => (q.quotation_number || '').startsWith(prefix))
      .map(q => parseInt(q.quotation_number.replace(prefix, ''), 10))
      .filter(n => !isNaN(n))
  }
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  return `${prefix}${String(next).padStart(4, '0')}`
}

function getNextQuotationNumberAfter(currentNumber) {
  const match = String(currentNumber || '').match(/^(Q-\d{4}-)(\d+)$/)
  if (!match) return getNextQuotationNumber()
  const [, prefix, seq] = match
  return `${prefix}${String(Number(seq) + 1).padStart(seq.length, '0')}`
}

function isQuotationNumberConflict(message = '') {
  return /quotations_lodge_id_quotation_number_key|duplicate key value/i.test(String(message))
}

function buildQuotationRecord(data, overrides = {}) {
  const customer = readCache('customers').find(c => c.id === data.customer_id)
  const room = data.room_id ? readCache('rooms').find(r => r.id === data.room_id) : null

  const subtotal = Number(data.subtotal ?? 0)
  const tax_amount = Number(calcTax(subtotal, data.tax_rate ?? 0))
  const total_amount = subtotal + tax_amount

  return {
    id: overrides.id || randomUUID(),
    quotation_number: overrides.quotation_number,
    lodge_id: lodgeId,
    customer_id: data.customer_id,
    customer_name: data.customer_name || customer?.name || '',
    customer_phone: data.customer_phone || customer?.phone || '',
    room_id: data.room_id || null,
    room_name: data.room_name || (room ? `Room ${room.room_number}` : ''),
    check_in: data.check_in || null,
    check_out: data.check_out || null,
    adults: Number(data.adults) || 1,
    children: Number(data.children) || 0,
    subtotal,
    tax_amount,
    total_amount,
    currency: data.currency || 'BWP',
    notes: data.notes || '',
    status: 'draft',
    valid_until: data.valid_until || null,
    parent_quotation_id: data.parent_quotation_id || null,
    created_by: currentUser?.id || null,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString()
  }
}

function normalizeQuotationForDisplay(q, { customer = null, room = null, convertedBookingId = null, todayStr = null } = {}) {
  if (!q || typeof q !== 'object') return q
  const subtotal = Number(q.subtotal ?? 0)
  const taxAmount = Number(q.tax_amount ?? calcTax(subtotal, q.tax_rate ?? 0))
  const totalAmount = Number(q.total_amount ?? (subtotal + taxAmount))
  const roomNumber = room?.room_number || q.room_number || ''
  const normalizedConvertedBookingId = q.converted_booking_id || convertedBookingId || null
  const baseStatus = normalizedConvertedBookingId ? 'converted' : (q.status || 'draft')
  const status = todayStr && q.valid_until && q.valid_until < todayStr && ['draft', 'sent', 'accepted'].includes(baseStatus)
    ? 'expired'
    : baseStatus

  return {
    ...q,
    converted_booking_id: normalizedConvertedBookingId,
    status,
    quotation_number: q.quotation_number || 'Unnumbered',
    customer_name: q.customer_name || customer?.name || 'Unknown guest',
    customer_phone: q.customer_phone || customer?.phone || '',
    customer_email: q.customer_email || q.customers?.email || customer?.email || '',
    room_name: q.room_name || (roomNumber ? `Room ${roomNumber}` : ''),
    check_in: q.check_in || null,
    check_out: q.check_out || null,
    adults: Number(q.adults) || 1,
    children: Number(q.children) || 0,
    subtotal,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    currency: q.currency || 'BWP',
    notes: q.notes || '',
    valid_until: q.valid_until || null,
    created_at: q.created_at || q.updated_at || new Date(0).toISOString(),
    updated_at: q.updated_at || q.created_at || new Date(0).toISOString()
  }
}

export async function getAllQuotations() {
  const cachedQuotations = readCache('quotations')
  if (isOnline) {
    let linkedBookings = []
    const { data, error } = await supabase
      .from('quotations')
      .select('*')
      .eq('lodge_id', lodgeId)
      .order('created_at', { ascending: false })
    if (error) {
      if (cachedQuotations.length > 0) {
        console.warn('getAllQuotations falling back to cache:', error.message)
        return cachedQuotations
      }
      throw new Error(error.message)
    }

    const customers = readCache('customers')
    const rooms = readCache('rooms')
    const liveRows = (data || []).length === 0 && cachedQuotations.length > 0
      ? cachedQuotations
      : (data || [])
    try {
      const bookingsResult = await supabase
        .from('bookings')
        .select('id, quotation_id')
        .eq('lodge_id', lodgeId)
        .not('quotation_id', 'is', null)
      linkedBookings = bookingsResult?.data || []
    } catch {
      linkedBookings = []
    }
    const convertedIds = new Map(
      (linkedBookings || []).filter((booking) => booking?.quotation_id).map((booking) => [booking.quotation_id, booking.id])
    )
    const todayStr = new Date().toISOString().split('T')[0]
    const mapped = liveRows.map(q => {
      const customer = customers.find(c => c.id === q.customer_id)
      const room = rooms.find(r => r.id === q.room_id)
      const convertedBookingId = q.converted_booking_id || convertedIds.get(q.id) || null
      return normalizeQuotationForDisplay(q, { customer, room, convertedBookingId, todayStr })
    })
    writeCache('quotations', mapped)
    return mapped
  }
  const quotations = cachedQuotations
  const customers  = readCache('customers')
  const rooms      = readCache('rooms')
  const bookings   = readCache('bookings')
  const convertedIds = new Map(
    (bookings || []).filter((booking) => booking?.quotation_id).map((booking) => [booking.quotation_id, booking.id])
  )
  const todayStr   = new Date().toISOString().split('T')[0]
  return quotations
    .map(q => {
      const customer = customers.find(c => c.id === q.customer_id)
      const room     = rooms.find(r => r.id === q.room_id)
      // Auto-expire offline (UI-only; DB will be corrected when back online)
      const convertedBookingId = q.converted_booking_id || convertedIds.get(q.id) || null
      const baseStatus = convertedBookingId ? 'converted' : q.status
      const status = (q.valid_until && q.valid_until < todayStr && ['draft','sent','accepted'].includes(baseStatus))
        ? 'expired'
        : baseStatus
      return normalizeQuotationForDisplay(q, { customer, room, convertedBookingId, todayStr, status })
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

// Tax helper — rate is a percentage (e.g. 14 = 14%). Default 0.
function calcTax(subtotal, rate = 0) {
  return Math.round(Number(subtotal || 0) * Number(rate || 0)) / 100
}

export async function createQuotation(data) {
  if (isOnline) {
    let quotation_number = await getNextQuotationNumber()
    let lastError = null

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const record = buildQuotationRecord(data, {
        id: randomUUID(),
        quotation_number
      })
      const { data: result, error } = await supabase.rpc('create_quotation', { payload: record })
      const failureMessage = error?.message || result?.error || ''

      if (!error && result?.success) {
        writeCache('quotations', [record, ...readCache('quotations').filter((q) => q.id !== record.id)])
        await refreshCache('quotations')
        logActivity('quotation_created', `Quotation ${quotation_number} created for ${record.customer_name}`)
        return { id: record.id, quotation_number }
      }

      lastError = new Error(failureMessage || 'Could not create quotation')
      if (!isQuotationNumberConflict(failureMessage) || attempt === 4) {
        throw lastError
      }

      quotation_number = getNextQuotationNumberAfter(quotation_number)
    }

    throw lastError || new Error('Could not create quotation')
  } else {
    const quotation_number = await getNextQuotationNumber()
    const record = buildQuotationRecord(data, { quotation_number })
    const cached = readCache('quotations')
    cached.unshift(record)
    writeCache('quotations', cached)
    queueOperation('rpc', 'create_quotation', { payload: record })
    logActivity('quotation_created', `Quotation ${quotation_number} created for ${record.customer_name}`)
    return { id: record.id, quotation_number }
  }
}

export async function updateQuotation(id, data) {
  // Determine if financial fields are locked (sent/accepted/converted)
  const LOCKED_STATUSES  = ['sent', 'accepted', 'converted']
  const cachedQuotations = readCache('quotations')
  const current          = cachedQuotations.find(q => q.id === id)

  // When online, verify lock status from server — cache may be stale
  let isLocked = current && LOCKED_STATUSES.includes(current.status)
  if (isOnline) {
    const { data: live } = await supabase
      .from('quotations').select('status').eq('id', id).eq('lodge_id', lodgeId).single()
    if (live) isLocked = LOCKED_STATUSES.includes(live.status)
  }

  const subtotal     = Number(data.subtotal ?? 0)
  const tax_amount   = Number(calcTax(subtotal, data.tax_rate ?? 0))
  const total_amount = subtotal + tax_amount

  // Full update object
  const update = {
    customer_name:  data.customer_name,
    customer_phone: data.customer_phone  || '',
    currency:       data.currency        || 'BWP',
    notes:          data.notes           || '',
    status:         data.status,
    valid_until:    data.valid_until     || null,
    updated_at:     new Date().toISOString()
  }

  // Financial + date fields — only allowed when not locked
  if (!isLocked) {
    Object.assign(update, {
      customer_id:  data.customer_id,
      room_id:      data.room_id    || null,
      room_name:    data.room_name  || '',
      check_in:     data.check_in   || null,
      check_out:    data.check_out  || null,
      adults:       Number(data.adults)   || 1,
      children:     Number(data.children) || 0,
      subtotal,
      tax_amount,
      total_amount
    })
  }

  if (isOnline) {
    const { data: result, error } = await supabase.rpc('update_quotation', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not update quotation')
    const cached = readCache('quotations')
    const idx = cached.findIndex((q) => q.id === id)
    if (idx >= 0) {
      cached[idx] = { ...cached[idx], ...update }
      writeCache('quotations', cached)
    }
    await refreshCache('quotations')
  } else {
    const cached = readCache('quotations')
    const idx    = cached.findIndex(q => q.id === id)
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('quotations', cached)
    queueOperation('rpc', 'update_quotation', {
      p_id: id,
      p_lodge_id: lodgeId,
      payload: update
    })
  }

  logActivity('quotation_updated', `Quotation ${id} updated — status: ${data.status}`)
}

// Lightweight: only transitions draft → sent. Safe to call multiple times.
export async function markQuotationSent(id) {
  const update = { status: 'sent', updated_at: new Date().toISOString() }
  if (isOnline) {
    const { data: result, error } = await supabase.rpc('mark_quotation_sent', {
      p_id: id,
      p_lodge_id: lodgeId
    })
    if (error) throw new Error(error.message)
    if (!result?.success) throw new Error(result?.error || 'Could not mark quotation as sent')
  } else {
    const cached = readCache('quotations')
    const idx    = cached.findIndex(q => q.id === id)
    if (idx >= 0 && cached[idx].status === 'draft') {
      cached[idx] = { ...cached[idx], ...update }
      writeCache('quotations', cached)
      queueOperation('rpc', 'mark_quotation_sent', {
        p_id: id,
        p_lodge_id: lodgeId
      })
    }
  }
}

export async function duplicateQuotation(id) {
  const source = isOnline
    ? (await supabase.from('quotations').select('*').eq('id', id).eq('lodge_id', lodgeId).single()).data
    : readCache('quotations').find(q => q.id === id)
  if (!source) throw new Error('Quotation not found')

  return createQuotation({
    customer_id:         source.customer_id,
    customer_name:       source.customer_name,
    customer_phone:      source.customer_phone,
    room_id:             source.room_id,
    room_name:           source.room_name,
    check_in:            source.check_in,
    check_out:           source.check_out,
    adults:              source.adults,
    children:            source.children,
    subtotal:            source.subtotal || source.total_amount,
    tax_amount:          source.tax_amount || 0,
    currency:            source.currency,
    notes:               source.notes,
    valid_until:         source.valid_until,
    parent_quotation_id: source.parent_quotation_id || source.id  // chain to root
  })
}

export async function getQuotationById(id) {
  if (!id) return null
  if (isOnline) {
    const { data, error } = await supabase
      .from('quotations')
      .select('*')
      .eq('lodge_id', lodgeId)
      .eq('id', id)
      .single()
    if (error) throw new Error(error.message)
    return data || null
  }
  return readCache('quotations').find((quotation) => quotation.id === id) || null
}

export async function convertQuotationToBooking(quotationId, depositAmount = 0, paymentMethod = 'cash') {
  if (!isOnline) throw new Error('Internet connection required to convert a quotation to a booking')

  const { data: quotation } = await supabase
    .from('quotations')
    .select('status')
    .eq('id', quotationId)
    .eq('lodge_id', lodgeId)
    .single()

  if (quotation?.status === 'converted') {
    throw new Error('This quotation has already been converted to a booking.')
  }

  const { data: result, error } = await supabase.rpc('convert_quotation_to_booking', {
    p_quotation_id:   quotationId,
    p_lodge_id:       lodgeId,
    p_deposit_amount: Number(depositAmount) || 0,
    p_payment_method: paymentMethod || 'cash',
    p_created_by:     currentUser?.id || null
  })

  if (error) throw new Error(error.message)
  if (!result?.success) throw new Error(result?.error || 'Conversion failed')

  await refreshCache('bookings')
  await refreshCache('quotations')

  const bookingId = result.booking_id

  // P2: Explicitly record deposit if provided.
  if (Number(depositAmount) > 0) {
    try {
      await updateBookingPayment(bookingId, depositAmount, paymentMethod, 'deposit')
    } catch (depError) {
      logActivity('quotation_converted', `Quotation ${quotationId} converted to booking ${bookingId} (Deposit failed: ${depError.message})`)
      return { 
        booking_id: bookingId, 
        invoice_number: result.invoice_number, 
        depositWarning: depError.message 
      }
    }
  }
  logActivity('quotation_converted', `Quotation ${quotationId} converted to booking ${bookingId}`)
  return { booking_id: bookingId, invoice_number: result.invoice_number }
}

// ── Data Import ───────────────────────────────────────────────────────────────

export function generateImportTemplate() {
  return [
    { key: 'guest_name',     label: 'Guest Name',       required: true  },
    { key: 'email',          label: 'Email',             required: false },
    { key: 'phone',          label: 'Phone',             required: false },
    { key: 'id_number',      label: 'ID / Passport No',  required: false },
    { key: 'nationality',    label: 'Nationality',        required: false },
    { key: 'room_number',    label: 'Room Number',        required: true  },
    { key: 'check_in',       label: 'Check-In Date',      required: true  },
    { key: 'check_out',      label: 'Check-Out Date',     required: true  },
    { key: 'adults',         label: 'Adults',             required: false },
    { key: 'children',       label: 'Children',           required: false },
    { key: 'total_amount',   label: 'Total Amount',       required: false },
    { key: 'amount_paid',    label: 'Amount Paid',        required: false },
    { key: 'payment_method', label: 'Payment Method',     required: false },
    { key: 'status',         label: 'Booking Status',     required: false },
    { key: 'notes',          label: 'Notes',              required: false },
  ]
}

export async function checkImportDuplicates(rows) {
  const rooms = readCache('rooms')
  const bookings = readCache('bookings')
  const roomMap = {}
  rooms.forEach((r) => { roomMap[String(r.room_number).trim()] = r.id })

  return rows.filter((row) => {
    const roomId = roomMap[String(row.room_number).trim()]
    if (!roomId) return false
    return bookings.some(
      (b) =>
        b.room_id === roomId &&
        b.status !== 'cancelled' &&
        b.check_in < row.check_out &&
        b.check_out > row.check_in
    )
  })
}

function friendlyImportError(msg = '') {
  const m = String(msg).toLowerCase()
  if (m.includes('room is already booked') || m.includes('no_overlapping_bookings'))
    return 'This room is already booked for those dates.'
  if (m.includes('room not found') || m.includes('room "'))
    return 'Room number not found — check it matches an existing room exactly.'
  if (m.includes('guest name') || m.includes('name is required'))
    return 'Guest name is missing.'
  if (m.includes('check-in') || m.includes('check-out') || m.includes('invalid dates'))
    return 'Check-in or check-out date is invalid. Use YYYY-MM-DD format.'
  if (m.includes('payment') || m.includes('amount must be greater'))
    return 'Payment amount is invalid.'
  if (m.includes('customer') || m.includes('create_customer'))
    return 'Could not save the guest record.'
  if (m.includes('network') || m.includes('fetch') || m.includes('failed to fetch'))
    return 'Network error — check your internet connection and try again.'
  if (m.includes('permission') || m.includes('policy') || m.includes('rls'))
    return 'Permission denied — contact your administrator.'
  if (m.includes('duplicate') || m.includes('unique') || m.includes('23505'))
    return 'A duplicate record already exists for this entry.'
  if (m.includes('invalid total') || m.includes('room rate'))
    return 'Could not calculate the total — check room rate and dates.'
  if (m.includes('supabase') || m.includes('.catch') || m.includes('is not a function'))
    return 'An unexpected system error occurred. Please try again.'
  return msg || 'An unexpected error occurred.'
}

export async function bulkImportBookings(rows, { filename = '', onProgress } = {}) {
  if (!isOnline) throw new Error('Internet connection required to import bookings.')

  const rooms = readCache('rooms')
  const roomMap = {}
  rooms.forEach((r) => { roomMap[String(r.room_number).trim()] = r.id })

  const batchId = randomUUID()
  const importedIds = []
  const errors = []
  let imported = 0
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (onProgress) onProgress({ current: i + 1, total: rows.length })

    const rowNum = i + 1
    const guestName = String(row.guest_name || '').trim()
    const roomNumberKey = String(row.room_number || '').trim()
    const roomId = roomMap[roomNumberKey]

    try {
      if (!guestName) throw new Error('Guest name is required')
      if (!roomId) throw new Error(`Room "${roomNumberKey}" not found`)
      if (!row.check_in || !row.check_out) throw new Error('Check-in and check-out dates are required')
      if (row.check_in >= row.check_out) throw new Error('Check-out must be after check-in')

      // Find or create customer
      const customers = readCache('customers')
      const emailNorm = String(row.email || '').trim().toLowerCase()
      let customer = emailNorm
        ? customers.find((c) => c.email?.toLowerCase() === emailNorm)
        : customers.find((c) => c.name?.toLowerCase() === guestName.toLowerCase())

      let customerId
      if (customer) {
        customerId = customer.id
      } else {
        customerId = await createCustomer({
          name: guestName,
          email: row.email || '',
          phone: row.phone || '',
          id_number: row.id_number || '',
          nationality: row.nationality || '',
        })
      }

      // Create booking via RPC (status starts as 'confirmed', amount_paid = 0)
      const amountPaid = Number(row.amount_paid) || 0
      const bookingId = await createBooking({
        customer_id: customerId,
        room_id: roomId,
        check_in: row.check_in,
        check_out: row.check_out,
        adults: Number(row.adults) || 1,
        children: Number(row.children) || 0,
        total_amount: Number(row.total_amount) || undefined,
        allow_total_override: !!row.total_amount,
        notes: row.notes || '',
        created_by: currentUser?.id || null,
      })

      // Record payment via RPC if any was paid
      if (amountPaid > 0) {
        await updateBookingPayment(
          bookingId,
          amountPaid,
          row.payment_method || 'cash',
          'payment',
          null,
          `import-${batchId}-row-${rowNum}`
        )
      }

      // Update status to match historical record — best-effort, does not fail the row
      const targetStatus = String(row.status || '').trim().toLowerCase()
      const validStatuses = ['confirmed', 'checked_in', 'checked_out', 'cancelled']
      if (targetStatus && targetStatus !== 'confirmed' && validStatuses.includes(targetStatus)) {
        try {
          const { error: statusErr } = await supabase
            .from('bookings')
            .update({ status: targetStatus, updated_at: new Date().toISOString() })
            .eq('id', bookingId)
            .eq('lodge_id', lodgeId)
          if (!statusErr) await refreshCache('bookings')
        } catch {
          // Non-fatal — booking and payment are already saved correctly
        }
      }

      importedIds.push(bookingId)
      imported++
    } catch (e) {
      errors.push({ row: rowNum, guest: guestName, error: friendlyImportError(e.message) })
      skipped++
    }
  }

  // Persist batch for undo
  const batches = readCache('import-batches')
  batches.unshift({
    id: batchId,
    filename: filename || 'unknown',
    entity_type: 'bookings',
    row_count: imported,
    error_count: errors.length,
    booking_ids: importedIds,
    created_at: new Date().toISOString(),
  })
  writeCache('import-batches', batches)

  await refreshCache('bookings')
  await refreshCache('customers')

  logActivity('data_imported', `Imported ${imported} bookings from "${filename || 'file'}" (${errors.length} errors)`)

  return { imported, skipped, errors, batchId: imported > 0 ? batchId : null }
}

export async function getImportBatches() {
  return readCache('import-batches')
}

export async function undoImportBatch(batchId) {
  if (!isOnline) throw new Error('Internet connection required to undo an import.')

  const batches = readCache('import-batches')
  const batch = batches.find((b) => b.id === batchId)
  if (!batch) return { error: 'Import batch not found.' }

  const bookingIds = batch.booking_ids || []
  const errors = []

  for (const bookingId of bookingIds) {
    const { error } = await supabase
      .from('bookings')
      .delete()
      .eq('id', bookingId)
      .eq('lodge_id', lodgeId)
    if (error) errors.push(bookingId)
  }

  if (errors.length === bookingIds.length && bookingIds.length > 0) {
    return { error: 'Could not delete any bookings from this batch.' }
  }

  // Remove batch from local store
  writeCache('import-batches', batches.filter((b) => b.id !== batchId))

  await refreshCache('bookings')
  await refreshCache('customers')

  logActivity('import_undone', `Undid import batch "${batch.filename}" (${bookingIds.length - errors.length} bookings deleted)`)

  return { success: true, deleted: bookingIds.length - errors.length }
}
