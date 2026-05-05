import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs'
import { state } from '../state.js'
import { ensureDir, readJsonFile, writeJsonFile } from './infrastructure.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROFILE_STATUS = {
  DRAFT: 'draft',
  READY: 'ready'
}
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

function normalizeLodgeId(id) {
  return typeof id === 'string' ? id.trim().toLowerCase() : null
}

function isUuid(value) {
  return UUID_PATTERN.test(normalizeLodgeId(value) || '')
}

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
  return path.join(state.profilesCacheDir, normalizeLodgeId(profileLodgeId))
}

function getInactiveCacheDir() {
  return path.join(state.cacheRootDir, '__inactive')
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

function getActiveProfile() {
  const registry = readProfilesRegistry()
  const active = registry.profiles.find((profile) => profile.lodge_id === registry.active_lodge_id)
  return active || null
}

export {
  readProfilesRegistry,
  writeProfilesRegistry,
  getActiveProfile,
  setRuntimeActiveProfile,
  initializeProfileRuntime
}
