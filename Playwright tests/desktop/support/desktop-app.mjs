import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { _electron as electron } from 'playwright'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const desktopTestsRoot = path.resolve(__dirname, '..')
export const repoRoot = path.resolve(desktopTestsRoot, '..', '..')

export function getRealBackendEnv() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const key = process.env.VITE_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || ''
  let parsed
  try { parsed = new URL(url) } catch { /* empty is reported by caller */ }
  if (parsed?.protocol !== 'https:' || parsed?.hostname !== 'repsrmlomedqrmrdsbga.supabase.co') return { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }
  return {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: key
  }
}

const ELECTRON_OS_ENV_ALLOWLIST = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMSPEC', 'PATHEXT']
const ELECTRON_EXTRA_ENV_ALLOWLIST = new Set(['BOROKO_PRODUCT', 'BOROKO_TEST_FORCE_OFFLINE', 'BOROKO_AUTH_TRACE', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'])
const ACCOUNTING_DISPOSABLE_URL = 'https://repsrmlomedqrmrdsbga.supabase.co'

function isPublicAnonKey(value) {
  const key = String(value || '')
  if (/^sb_publishable_[a-z0-9_-]+$/i.test(key)) return true
  const segments = key.split('.')
  if (segments.length !== 3) return false
  try {
    const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
    return payload.role === 'anon'
  } catch {
    return false
  }
}

function validateIsolatedTestProfile(userDataDir) {
  if (!userDataDir || !path.isAbsolute(userDataDir)) throw new Error('Electron tests require an absolute isolated user-data directory.')
  const resolved = path.resolve(userDataDir)
  const tempRoot = path.resolve(os.tmpdir())
  const insideTemp = resolved.toLowerCase().startsWith((tempRoot + path.sep).toLowerCase())
  if (!insideTemp) throw new Error('Electron test profiles must be created under the task temporary directory.')
  return resolved
}

export function buildDesktopLaunchEnvironment({ parentEnv = process.env, userDataDir, extraEnv = {} } = {}) {
  const profile = validateIsolatedTestProfile(userDataDir)
  const unknown = Object.keys(extraEnv).filter((name) => !ELECTRON_EXTRA_ENV_ALLOWLIST.has(name))
  if (unknown.length) throw new Error(`Electron launch rejected unapproved environment names: ${unknown.join(', ')}`)
  const env = {}
  for (const name of ELECTRON_OS_ENV_ALLOWLIST) if (parentEnv[name]) env[name] = parentEnv[name]
  env.BOROKO_TEST_USER_DATA_DIR = profile
  env.BOROKO_TEST_FORCE_OFFLINE = extraEnv.BOROKO_TEST_FORCE_OFFLINE === 'false' ? 'false' : 'true'
  env.SUPABASE_URL = 'http://127.0.0.1:65535'
  env.SUPABASE_ANON_KEY = 'test-anon-key'
  if (extraEnv.BOROKO_PRODUCT) env.BOROKO_PRODUCT = extraEnv.BOROKO_PRODUCT
  if (extraEnv.BOROKO_AUTH_TRACE === '1') env.BOROKO_AUTH_TRACE = '1'
  const explicitUrl = String(extraEnv.SUPABASE_URL || '').trim()
  const explicitKey = String(extraEnv.SUPABASE_ANON_KEY || '').trim()
  if (explicitUrl) {
    let parsed
    try { parsed = new URL(explicitUrl) } catch { throw new Error('Electron backend URL is invalid; no app was launched.') }
    const disposable = parsed.protocol === 'https:' && parsed.hostname === 'repsrmlomedqrmrdsbga.supabase.co'
    const offlineLoopback = env.BOROKO_TEST_FORCE_OFFLINE === 'true' && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.port === '65535'
    if (!disposable && !offlineLoopback) throw new Error('Electron backend must be isolated offline or target only approved disposable project repsrmlomedqrmrdsbga.')
    if (disposable && !isPublicAnonKey(explicitKey)) throw new Error('Electron requires the disposable project public anon/client key; private keys are rejected.')
    env.SUPABASE_URL = explicitUrl
    if (explicitKey) env.SUPABASE_ANON_KEY = explicitKey
  }
  if (env.BOROKO_TEST_FORCE_OFFLINE === 'false') {
    if (env.SUPABASE_URL !== ACCOUNTING_DISPOSABLE_URL || !isPublicAnonKey(env.SUPABASE_ANON_KEY)) {
      throw new Error('Online Electron launch requires the approved disposable project URL and its public anon/client key.')
    }
  }
  return env
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function addDays(baseDate, days) {
  const date = new Date(baseDate)
  date.setDate(date.getDate() + days)
  return date
}

function formatDateForBotswana(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Gaborone',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date)
    const year = parts.find((part) => part.type === 'year')?.value || '1970'
    const month = parts.find((part) => part.type === 'month')?.value || '01'
    const day = parts.find((part) => part.type === 'day')?.value || '01'
    return `${year}-${month}-${day}`
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

export function createTempUserDataDir(prefix = 'boroko-e2e-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export async function findLiveAvailableStay(seed, {
  minOffsetDays = 30,
  maxOffsetDays = 90,
  nights = 1
} = {}) {
  const env = getRealBackendEnv()
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('Live backend env is required to find an available stay window')
  }

  const rooms = Array.isArray(seed?.rooms) ? seed.rooms.filter((room) => room?.id) : []
  if (rooms.length === 0) {
    throw new Error('Seed does not include any rooms')
  }

  const rangeStart = formatDateForBotswana(addDays(new Date(), minOffsetDays))
  const rangeEnd = formatDateForBotswana(addDays(new Date(), maxOffsetDays + nights))
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
  let data = null
  let error = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await supabase
      .from('bookings')
      .select('room_id, check_in, check_out, status')
      .eq('lodge_id', seed.lodgeId)
      .in('room_id', rooms.map((room) => room.id))
      .neq('status', 'cancelled')
      .lte('check_in', rangeEnd)
      .gte('check_out', rangeStart)
    data = response.data
    error = response.error
    if (!error) break
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    }
  }

  if (error) {
    throw new Error(`Could not load live bookings for availability check: ${error.message}`)
  }

  const liveBookings = Array.isArray(data) ? data : []
  for (let offset = minOffsetDays; offset <= maxOffsetDays; offset += 1) {
    const checkIn = formatDateForBotswana(addDays(new Date(), offset))
    const checkOut = formatDateForBotswana(addDays(new Date(), offset + nights))
    const availableRoom = rooms.find((room) => !liveBookings.some((booking) => (
      String(booking?.room_id || '') === String(room.id)
      && String(booking?.check_in || '') < checkOut
      && String(booking?.check_out || '') > checkIn
    )))

    if (availableRoom) {
      return {
        roomId: availableRoom.id,
        roomNumber: String(availableRoom.room_number),
        checkIn,
        checkOut
      }
    }
  }

  throw new Error(`No free stay window found between ${rangeStart} and ${rangeEnd}`)
}

export function createDesktopSeed(overrides = {}) {
  const now = new Date()
  const lodgeId = overrides.lodgeId || crypto.randomUUID()
  const password = overrides.password || 'Password123!'
  const email = (overrides.email || 'manager@example.com').toLowerCase()
  const userId = overrides.userId || crypto.randomUUID()
  const sessionNonce = overrides.sessionNonce || crypto.randomBytes(16).toString('hex')
  const sessionToken = overrides.sessionToken || crypto.randomBytes(24).toString('hex')
  const userName = overrides.userName || 'Test Manager'
  const lodgeName = overrides.lodgeName || 'Boroko Test Lodge'
  const sessionExpiresAt = overrides.sessionExpiresAt || new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const createdAt = overrides.createdAt || now.toISOString()
  const lastSuccessfulSyncAt = overrides.lastSuccessfulSyncAt || new Date(now.getTime() - 15 * 60 * 1000).toISOString()

  const user = {
    id: userId,
    name: userName,
    email,
    role: overrides.role || 'manager',
    lodge_id: lodgeId,
    allowed_outlet_ids: overrides.allowedOutletIds ?? null,
    isMasterAdmin: false,
    created_at: createdAt
  }

  const profile = {
    lodge_id: lodgeId,
    label: lodgeName,
    status: overrides.profileStatus || 'ready',
    created_at: createdAt,
    last_used_at: createdAt
  }

  const settings = {
    lodge_id: lodgeId,
    lodge_name: lodgeName,
    company_name: lodgeName,
    business_type: 'lodge',
    currency: 'P',
    phone: '+26770000000'
  }

  const bookings = overrides.bookings || [
    {
      id: 'booking-pending',
      booking_number: 'BK-001',
      invoice_number: 'INV-001',
      customer_name: 'Pending Guest',
      customer_phone: '+26770000001',
      room_number: '101',
      room_type: 'Standard',
      check_in: '2026-04-14',
      check_out: '2026-04-16',
      adults: 2,
      children: 0,
      status: 'confirmed',
      payment_status: 'unpaid',
      total_amount: 1200,
      charges_total: 0,
      amount_paid: 0,
      source: 'front_desk',
      created_at: createdAt,
      _pending_sync: true
    },
    {
      id: 'booking-failed',
      booking_number: 'BK-002',
      invoice_number: 'INV-002',
      customer_name: 'Failed Guest',
      customer_phone: '+26770000002',
      room_number: '102',
      room_type: 'Deluxe',
      check_in: '2026-04-14',
      check_out: '2026-04-15',
      adults: 1,
      children: 0,
      status: 'confirmed',
      payment_status: 'unpaid',
      total_amount: 900,
      charges_total: 0,
      amount_paid: 0,
      source: 'front_desk',
      created_at: createdAt,
      _sync_state: 'failed'
    },
    {
      id: 'booking-attention',
      booking_number: 'BK-003',
      invoice_number: 'INV-003',
      customer_name: 'Attention Guest',
      customer_phone: '+26770000003',
      room_number: '103',
      room_type: 'Family',
      check_in: '2026-04-14',
      check_out: '2026-04-17',
      adults: 2,
      children: 1,
      status: 'checked_in',
      payment_status: 'paid',
      total_amount: 500,
      charges_total: 0,
      amount_paid: 650,
      source: 'front_desk',
      created_at: createdAt
    }
  ]

  const rooms = overrides.rooms || [
    { id: crypto.randomUUID(), room_number: '101', room_type: 'Standard', status: 'available', rate_per_night: 600 },
    { id: crypto.randomUUID(), room_number: '102', room_type: 'Deluxe', status: 'available', rate_per_night: 900 },
    { id: crypto.randomUUID(), room_number: '103', room_type: 'Family', status: 'available', rate_per_night: 1100 }
  ]

  const customers = overrides.customers || [
    { id: 'customer-pending', full_name: 'Pending Guest', email: 'pending@example.com', phone: '+26770000001' },
    { id: 'customer-failed', full_name: 'Failed Guest', email: 'failed@example.com', phone: '+26770000002' },
    { id: 'customer-attention', full_name: 'Attention Guest', email: 'attention@example.com', phone: '+26770000003' }
  ]

  const syncQueue = overrides.syncQueue || [
    {
      _queue_id: 'queue-pending-booking',
      table: 'create_booking',
      type: 'booking',
      createdAt,
      data: { p_booking_id: 'booking-pending' },
      manualRetryOnly: false
    }
  ]

  const syncFailed = overrides.syncFailed || [
    {
      _queue_id: 'queue-failed-booking',
      table: 'create_booking',
      type: 'booking',
      lastError: 'Simulated sync failure for test coverage.',
      lastAttemptedAt: createdAt,
      data: { p_booking_id: 'booking-failed' },
      manualRetryOnly: false
    }
  ]

  const validationAlerts = overrides.validationAlerts || [
    {
      id: 'alert-payment-mismatch',
      detected_at: createdAt,
      alert_type: 'payment_mismatch',
      message: 'Booking total and amount paid do not match on this device.',
      summary: 'Amount paid differs from totals'
    }
  ]

  const healthFaults = overrides.healthFaults || []
  const outlets = overrides.outlets || []
  const posMenuItems = overrides.posMenuItems || []
  const inventoryItems = overrides.inventoryItems || []
  const posOrders = overrides.posOrders || []

  const syncMeta = {
    lastSuccessfulSyncAt,
    lastSyncStartedAt: new Date(now.getTime() - 20 * 60 * 1000).toISOString(),
    lastSyncFinishedAt: lastSuccessfulSyncAt,
    lastSyncOutcome: overrides.lastSyncOutcome || 'success',
    lastSyncError: ''
  }

  const session = {
    userId: user.id,
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    lodge_id: lodgeId,
    isMasterAdmin: false,
    session_token: sessionToken,
    session_expires_at: sessionExpiresAt,
    session_type: 'desktop',
    allowed_outlet_ids: user.allowed_outlet_ids,
    nonce: sessionNonce,
    createdAt: createdAt,
    offline_password_hash: bcrypt.hashSync(password, 10)
  }

  return {
    lodgeId,
    lodgeName,
    password,
    passwordHash: bcrypt.hashSync(password, 10),
    sessionNonce,
    sessionToken,
    sessionExpiresAt,
    user,
    profile,
    settings,
    bookings,
    rooms,
    customers,
    syncQueue,
    syncFailed,
    validationAlerts,
    healthFaults,
    syncMeta,
    session,
    outlets,
    posMenuItems,
    inventoryItems,
    posOrders,
    localStorageUser: clone({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      lodge_id: lodgeId,
      isMasterAdmin: false,
      allowed_outlet_ids: user.allowed_outlet_ids
    })
  }
}

export function pickSeededPosOutlet(seed, { type = null } = {}) {
  const outlets = Array.isArray(seed?.outlets) ? seed.outlets : []
  const candidates = type
    ? outlets.filter((outlet) => String(outlet?.type || '').toLowerCase() === String(type).toLowerCase())
    : outlets
  return candidates.find((outlet) => outlet?.id) || null
}

export function pickSeededPosMenuItem(seed, { outletId = null } = {}) {
  const menuItems = Array.isArray(seed?.posMenuItems) ? seed.posMenuItems : []
  const inventoryById = new Map((Array.isArray(seed?.inventoryItems) ? seed.inventoryItems : []).map((item) => [item.id, item]))
  const candidates = menuItems.filter((item) => {
    if (!item?.id) return false
    if (item.is_available === false) return false
    if (outletId && item.outlet_id && String(item.outlet_id) !== String(outletId)) return false
    if (!item.inventory_item_id) return true
    return Number(inventoryById.get(item.inventory_item_id)?.current_stock || 0) > 0
  })
  return candidates.find((item) => item?.id) || null
}

export async function createDesktopSeedFromLiveBackend(overrides = {}) {
  const env = getRealBackendEnv()
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return createDesktopSeed({
      ...overrides,
      lodgeId: overrides.lodgeId || 'a04ccf71-d9df-4491-866c-24304a08fdc6',
      rooms: overrides.rooms || [
        { id: '4c85091d-104e-458b-97a3-7095858a0b3a', room_number: '1', room_type: 'Family', status: 'available', rate_per_night: 500 }
      ]
    })
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
  const { data, error } = await supabase
    .from('rooms')
    .select('id, lodge_id, room_number, room_type, status, rate_per_night')
    .order('room_number', { ascending: true })

  if (error) {
    console.warn(`Could not load live rooms for test seed; using fallback room data. Error: ${error.message}`)
    return createDesktopSeed({
      ...overrides,
      lodgeId: overrides.lodgeId || 'a04ccf71-d9df-4491-866c-24304a08fdc6',
      rooms: overrides.rooms || [
        { id: '4c85091d-104e-458b-97a3-7095858a0b3a', room_number: '1', room_type: 'Family', status: 'available', rate_per_night: 500 }
      ]
    })
  }

  const liveRooms = Array.isArray(data) ? data.filter((room) => room?.id && room?.room_number && room?.lodge_id) : []
  if (liveRooms.length === 0) {
    return createDesktopSeed({
      ...overrides,
      lodgeId: overrides.lodgeId || 'a04ccf71-d9df-4491-866c-24304a08fdc6',
      rooms: overrides.rooms || [
        { id: '4c85091d-104e-458b-97a3-7095858a0b3a', room_number: '1', room_type: 'Family', status: 'available', rate_per_night: 500 }
      ]
    })
  }

  const roomsByLodge = new Map()
  for (const room of liveRooms) {
    const lodgeRooms = roomsByLodge.get(room.lodge_id) || []
    lodgeRooms.push(room)
    roomsByLodge.set(room.lodge_id, lodgeRooms)
  }
  const [liveLodgeId, lodgeRooms] = [...roomsByLodge.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (!liveLodgeId || !Array.isArray(lodgeRooms) || lodgeRooms.length === 0) {
    return createDesktopSeed({
      ...overrides,
      lodgeId: overrides.lodgeId || 'a04ccf71-d9df-4491-866c-24304a08fdc6',
      rooms: overrides.rooms || [
        { id: '4c85091d-104e-458b-97a3-7095858a0b3a', room_number: '1', room_type: 'Family', status: 'available', rate_per_night: 500 }
      ]
    })
  }

  const seed = createDesktopSeed({
    ...overrides,
    lodgeId: liveLodgeId,
    rooms: lodgeRooms.slice(0, 3).map((room, index) => ({
      id: room.id,
      room_number: String(room.room_number),
      room_type: room.room_type || (index === 0 ? 'Standard' : 'Room'),
      status: room.status || 'available',
      rate_per_night: Number(room.rate_per_night) || (index === 0 ? 600 : 0)
    })).filter((room) => room && room.id && room.room_number)
  })

  return seed
}

function readAppDataJson(...segments) {
  try {
    const base = process.env.APPDATA ? path.join(process.env.APPDATA, 'boroko-bookings') : null
    if (!base) return null
    const filePath = path.join(base, ...segments)
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function createDesktopSeedFromInstalledProfile(overrides = {}) {
  const profiles = readAppDataJson('profiles.json')
  const lodgeId = profiles?.active_lodge_id || overrides.lodgeId || null
  if (!lodgeId) {
    return createDesktopSeed(overrides)
  }

  const profileDir = ['boroko-cache', 'profiles', lodgeId]
  const session = readAppDataJson(...profileDir, 'session-nonce.json')
  const users = readAppDataJson(...profileDir, 'users.json') || []
  const authCache = readAppDataJson(...profileDir, 'auth-cache.json') || []
  const rooms = readAppDataJson(...profileDir, 'rooms.json') || []
  const settings = readAppDataJson(...profileDir, 'settings.json') || {}
  const outlets = readAppDataJson(...profileDir, 'outlets.json') || []
  const posMenuItems = readAppDataJson(...profileDir, 'pos-menu-items.json') || []
  const inventoryItems = readAppDataJson(...profileDir, 'inventory-items.json') || []
  const posOrders = readAppDataJson(...profileDir, 'pos-orders.json') || []

  const sessionUser = users.find((user) => user?.id === session?.userId) || users.find((user) => user?.email === session?.email) || null
  const passwordHash = authCache.find((entry) => entry?.email === (session?.email || sessionUser?.email || '').toLowerCase())?.password_hash || overrides.passwordHash

  const seededRooms = rooms
    .filter((room) => room?.id && room?.room_number)
    .slice(0, 3)
    .map((room) => ({
      id: room.id,
      room_number: String(room.room_number),
      room_type: room.room_type || 'Room',
      status: room.status || 'available',
      rate_per_night: Number(room.rate_per_night) || 0
    }))

  return createDesktopSeed({
    ...overrides,
    lodgeId,
    rooms: seededRooms.length > 0 ? seededRooms : (overrides.rooms || []),
    userId: sessionUser?.id || session?.userId || overrides.userId,
    userName: sessionUser?.name || session?.name || overrides.userName,
    email: sessionUser?.email || session?.email || overrides.email,
    role: sessionUser?.role || session?.role || overrides.role || 'manager',
    sessionToken: session?.session_token || overrides.sessionToken,
    sessionNonce: session?.nonce || overrides.sessionNonce,
    sessionExpiresAt: session?.session_expires_at || overrides.sessionExpiresAt,
    passwordHash: passwordHash || overrides.passwordHash,
    settings: {
      ...settings,
      lodge_id: lodgeId,
      currency: settings.currency || 'P'
    },
    outlets,
    posMenuItems,
    inventoryItems,
    posOrders
  })
}

export function seedDesktopUserData(userDataDir, seed) {
  const activeLodgeId = seed.lodgeId
  const profileDir = path.join(userDataDir, 'boroko-cache', 'profiles', activeLodgeId)

  writeJson(path.join(userDataDir, 'profiles.json'), {
    active_lodge_id: activeLodgeId,
    profiles: [seed.profile]
  })
  writeJson(path.join(userDataDir, 'lodge-id.json'), { lodge_id: activeLodgeId })

  writeJson(path.join(profileDir, 'settings.json'), seed.settings)
  writeJson(path.join(profileDir, 'users.json'), [seed.user])
  writeJson(path.join(profileDir, 'auth-cache.json'), [
    {
      email: seed.user.email,
      lodge_id: activeLodgeId,
      password_hash: seed.passwordHash
    }
  ])
  writeJson(path.join(profileDir, 'bookings.json'), seed.bookings)
  writeJson(path.join(profileDir, 'rooms.json'), seed.rooms)
  writeJson(path.join(profileDir, 'customers.json'), seed.customers)
  writeJson(path.join(profileDir, 'sync-queue.json'), seed.syncQueue)
  writeJson(path.join(profileDir, 'sync-failed.json'), seed.syncFailed)
  writeJson(path.join(profileDir, 'sync-meta.json'), seed.syncMeta)
  writeJson(path.join(profileDir, 'health-faults.json'), seed.healthFaults)
  writeJson(path.join(profileDir, 'financial-validation-alerts.json'), seed.validationAlerts)
  writeJson(path.join(profileDir, 'session-nonce.json'), seed.session)
  writeJson(path.join(profileDir, 'outlets.json'), seed.outlets || [])
  writeJson(path.join(profileDir, 'pos-menu-items.json'), seed.posMenuItems || [])
  writeJson(path.join(profileDir, 'inventory-items.json'), seed.inventoryItems || [])
  writeJson(path.join(profileDir, 'pos-orders.json'), seed.posOrders || [])
}

export function writeProfileCacheData(userDataDir, lodgeId, cacheName, data) {
  const profileDir = path.join(userDataDir, 'boroko-cache', 'profiles', lodgeId)
  writeJson(path.join(profileDir, `${cacheName}.json`), data)
}

export function restoreSeededSessionNonce(userDataDir, seed) {
  const profileDir = path.join(userDataDir, 'boroko-cache', 'profiles', seed.lodgeId)
  writeJson(path.join(profileDir, 'session-nonce.json'), seed.session)
}

async function launchWithEnvironment(userDataDir, env) {
  const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env })
  await app.firstWindow()
  const window = await waitForMainDesktopWindow(app)
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

export async function launchDesktopApp({ userDataDir, extraEnv = {} } = {}) {
  const env = buildDesktopLaunchEnvironment({ userDataDir, extraEnv })
  return launchWithEnvironment(userDataDir, env)
}

export function createIsolatedAccountingUserDataDir() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luna-accounting-electron-'))
  if (fs.readdirSync(userDataDir).length !== 0) throw new Error('New isolated Accounting profile directory must be empty.')
  return userDataDir
}

export function buildAccountingDisposableDesktopEnvironment({ parentEnv = process.env, userDataDir } = {}) {
  const url = String(parentEnv.VITE_SUPABASE_URL || parentEnv.SUPABASE_URL || '').trim()
  const key = String(parentEnv.VITE_SUPABASE_KEY || parentEnv.SUPABASE_ANON_KEY || '').trim()
  if (!url) throw new Error('Missing approved disposable Electron setting: VITE_SUPABASE_URL or SUPABASE_URL.')
  if (!key) throw new Error('Missing approved public-client Electron setting: VITE_SUPABASE_KEY or SUPABASE_ANON_KEY.')
  const profile = validateIsolatedTestProfile(userDataDir)
  if (fs.readdirSync(profile).length !== 0) throw new Error('Accounting acceptance requires a new empty isolated profile; copied/installed profiles are rejected.')
  return buildDesktopLaunchEnvironment({
    parentEnv,
    userDataDir: profile,
    extraEnv: { BOROKO_PRODUCT: 'hospitality-pos', BOROKO_TEST_FORCE_OFFLINE: 'false', SUPABASE_URL: url, SUPABASE_ANON_KEY: key }
  })
}

export async function launchAccountingDisposableDesktop() {
  const userDataDir = createIsolatedAccountingUserDataDir()
  const env = buildAccountingDisposableDesktopEnvironment({ userDataDir })
  return { ...(await launchWithEnvironment(userDataDir, env)), userDataDir }
}

async function isStartupSplashWindow(page) {
  if (!page || page.isClosed()) return false
  const url = page.url()
  const title = await page.title().catch(() => '')
  return title === 'Boroko Bookings Starting' || url.startsWith('data:text/html')
}

async function waitForMainDesktopWindow(app, timeout = 30000) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      if (page.isClosed()) continue
      if (!(await isStartupSplashWindow(page))) return page
    }

    const remaining = Math.max(1, deadline - Date.now())
    await app.waitForEvent('window', { timeout: Math.min(1000, remaining) }).catch(() => null)
  }

  throw new Error('Main Boroko desktop window did not open before the startup timeout.')
}

export async function setTestOfflineMode(page, forceOffline) {
  return page.evaluate(async (value) => window.api.app.setTestOfflineMode(value), forceOffline)
}

export async function forceCloseElectronApp(app) {
  const proc = typeof app.process === 'function' ? app.process() : null
  if (proc?.pid) {
    try {
      proc.kill('SIGKILL')
    } catch {
      try { proc.kill() } catch { /* ignore */ }
    }
    await new Promise((resolve) => {
      proc.once('exit', resolve)
      setTimeout(resolve, 5000)
    })
    return
  }
  await app.close()
}
