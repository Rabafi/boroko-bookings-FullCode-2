import { createClient } from '@supabase/supabase-js'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

// ─── YOUR SUPABASE CREDENTIALS ───────────────────────────────────────────────
// These are YOUR app's Supabase credentials (the developer's project).
// Every customer's copy of the app connects to this same Supabase project.
// Their data is kept completely separate using a unique lodge ID per installation.
// Replace with your actual values from: Supabase Dashboard → Settings → API
const SUPABASE_URL = 'https://oicgpknsmtvcsjacymum.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY2dwa25zbXR2Y3NqYWN5bXVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY5MzUxMSwiZXhwIjoyMDg5MjY5NTExfQ.ad7P-rJt99EnVRlt9Vzg5k-eCQhAd23GdbnHuN1UnHU'
// ─────────────────────────────────────────────────────────────────────────────

let supabase
let isOnline = false
let cacheDir
let currentUser = null
let backupIntervalStarted = false
let lodgeId = null

// ─── LODGE ID ─────────────────────────────────────────────────────────────────
// Each installation generates a unique ID on first run.
// This ID is stored locally and used to isolate this lodge's data in Supabase.

function getLodgeIdPath() {
  return path.join(app.getPath('userData'), 'lodge-id.json')
}

function loadOrCreateLodgeId() {
  try {
    const data = JSON.parse(fs.readFileSync(getLodgeIdPath(), 'utf-8'))
    if (data.lodge_id) return data.lodge_id
  } catch { /* file doesn't exist yet — generate one */ }

  const newId = crypto.randomUUID()
  fs.writeFileSync(getLodgeIdPath(), JSON.stringify({ lodge_id: newId }, null, 2), 'utf-8')
  console.log(`New lodge registered with ID: ${newId}`)
  return newId
}

export function setCurrentUser(user) {
  currentUser = user
}

// ─── CACHE HELPERS ────────────────────────────────────────────────────────────

function getCachePath(name) {
  return path.join(cacheDir, `${name}.json`)
}

function readCache(name) {
  try {
    const data = fs.readFileSync(getCachePath(name), 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

function writeCache(name, data) {
  try {
    fs.writeFileSync(getCachePath(name), JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('Cache write failed:', e)
  }
}

function readSyncQueue() {
  try {
    const data = fs.readFileSync(path.join(cacheDir, 'sync-queue.json'), 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

function writeSyncQueue(queue) {
  try {
    fs.writeFileSync(path.join(cacheDir, 'sync-queue.json'), JSON.stringify(queue, null, 2), 'utf-8')
  } catch (e) {
    console.error('Sync queue write failed:', e)
  }
}

// ─── CONNECTIVITY & SYNC ──────────────────────────────────────────────────────

async function checkOnline() {
  try {
    const { error } = await supabase.from('rooms').select('id').eq('lodge_id', lodgeId).limit(1)
    isOnline = !error
  } catch {
    isOnline = false
  }
  return isOnline
}

async function refreshAllCaches() {
  try {
    const [usersRes, roomsRes, customersRes, bookingsRes] = await Promise.all([
      supabase.from('users').select('id, name, email, role, created_at').eq('lodge_id', lodgeId).order('name'),
      supabase.from('rooms').select('*').eq('lodge_id', lodgeId).order('room_number'),
      supabase.from('customers').select('*').eq('lodge_id', lodgeId).order('name'),
      supabase.from('bookings').select('*').eq('lodge_id', lodgeId).order('check_in', { ascending: false })
    ])
    if (usersRes.data) writeCache('users', usersRes.data)
    if (roomsRes.data) writeCache('rooms', roomsRes.data)
    if (customersRes.data) writeCache('customers', customersRes.data)
    if (bookingsRes.data) writeCache('bookings', bookingsRes.data)
  } catch (e) {
    console.error('Cache refresh failed:', e)
  }
}

async function processSyncQueue() {
  const queue = readSyncQueue()
  if (queue.length === 0) return

  console.log(`Syncing ${queue.length} offline operations...`)
  const remaining = []

  for (const item of queue) {
    try {
      if (item.type === 'insert') {
        await supabase.from(item.table).insert({ ...item.data, lodge_id: lodgeId })
      } else if (item.type === 'update') {
        await supabase.from(item.table).update(item.data).eq('id', item.id).eq('lodge_id', lodgeId)
      } else if (item.type === 'delete') {
        await supabase.from(item.table).delete().eq('id', item.id).eq('lodge_id', lodgeId)
      }
    } catch (e) {
      console.error('Sync item failed:', e)
      remaining.push(item)
    }
  }

  writeSyncQueue(remaining)
  if (remaining.length === 0) {
    console.log('All offline changes synced successfully!')
  }
}

function queueOperation(type, table, data, id = null) {
  const queue = readSyncQueue()
  queue.push({ type, table, data, id, timestamp: new Date().toISOString() })
  writeSyncQueue(queue)
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
  } catch (e) {
    console.error('Auto-backup failed:', e)
  }
}

export function getBackupInfo() {
  try {
    const backupDir = path.join(app.getPath('userData'), 'boroko-backups')
    if (!fs.existsSync(backupDir)) return { backupDir, backups: [] }

    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 10)

    const backups = files.map((f) => {
      const stats = fs.statSync(path.join(backupDir, f))
      return { name: f, size: stats.size, created: stats.mtime.toISOString() }
    })

    return { backupDir, backups }
  } catch {
    return { backupDir: '', backups: [] }
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

export async function initDatabase() {
  cacheDir = path.join(app.getPath('userData'), 'boroko-cache')
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true })
  }

  // Load or generate a unique ID for this lodge installation
  lodgeId = loadOrCreateLodgeId()

  supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  const online = await checkOnline()
  if (online) {
    await processSyncQueue()
    await refreshAllCaches()
    console.log('Connected to Supabase ✓')
  } else {
    console.log('Running in offline mode — using cached data')
  }

  await seedDefaultUser()

  if (!backupIntervalStarted) {
    backupIntervalStarted = true

    createBackup()
    setInterval(() => createBackup(), 60 * 60 * 1000)

    setInterval(async () => {
      const wasOffline = !isOnline
      const nowOnline = await checkOnline()
      if (wasOffline && nowOnline) {
        console.log('Back online — syncing changes...')
        await processSyncQueue()
        await refreshAllCaches()
      }
    }, 30000)
  }
}

async function seedDefaultUser() {
  if (isOnline) {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('email', 'admin@boroko.com')
      .limit(1)
    if (!data || data.length === 0) {
      await createUser({ name: 'Administrator', email: 'admin@boroko.com', password: 'admin123', role: 'manager' })
    }
  } else {
    const users = readCache('users')
    const admin = users.find((u) => u.email === 'admin@boroko.com')
    if (!admin) {
      await createUser({ name: 'Administrator', email: 'admin@boroko.com', password: 'admin123', role: 'manager' })
    }
  }
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

export async function loginUser(email, password) {
  let users = []

  if (isOnline) {
    const { data } = await supabase.from('users').select('*').eq('lodge_id', lodgeId).eq('email', email)
    users = data || []
  } else {
    users = readCache('users').filter((u) => u.email === email)
  }

  const user = users[0]
  if (!user) return null
  if (!bcrypt.compareSync(password, user.password_hash)) return null

  const { password_hash, ...safeUser } = user
  return safeUser
}

// ─── USERS ────────────────────────────────────────────────────────────────────

export async function getAllUsers() {
  if (isOnline) {
    const { data } = await supabase
      .from('users')
      .select('id, name, email, role, created_at')
      .eq('lodge_id', lodgeId)
      .order('name')
    if (data) writeCache('users', data)
    return data || []
  }
  return readCache('users')
}

export async function createUser(data) {
  const emailLower = data.email.trim().toLowerCase()

  // ── Duplicate email check ──────────────────────────────────────────────────
  if (isOnline) {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('lodge_id', lodgeId)
      .eq('email', emailLower)
      .limit(1)
    if (existing && existing.length > 0)
      throw new Error(`A user with the email "${emailLower}" already exists in this lodge.`)
  } else {
    const cached = readCache('users')
    if (cached.some(u => u.email?.toLowerCase() === emailLower))
      throw new Error(`A user with the email "${emailLower}" already exists in this lodge.`)
  }
  // ──────────────────────────────────────────────────────────────────────────

  const hash = bcrypt.hashSync(data.password, 10)
  const user = {
    name: data.name,
    email: emailLower,
    password_hash: hash,
    role: data.role || 'receptionist',
    lodge_id: lodgeId
  }

  if (isOnline) {
    const { data: result } = await supabase.from('users').insert(user).select().single()
    await refreshAllCaches()
    return result?.id
  } else {
    const cached = readCache('users')
    const tempId = Date.now()
    cached.push({ ...user, id: tempId, created_at: new Date().toISOString() })
    writeCache('users', cached)
    queueOperation('insert', 'users', user)
    return tempId
  }
}

export async function updateUser(id, data) {
  const update = { name: data.name, email: data.email, role: data.role }
  if (data.password) {
    update.password_hash = bcrypt.hashSync(data.password, 10)
  }

  if (isOnline) {
    await supabase.from('users').update(update).eq('id', id).eq('lodge_id', lodgeId)
    await refreshAllCaches()
  } else {
    const cached = readCache('users')
    const idx = cached.findIndex((u) => u.id === id)
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('users', cached)
    queueOperation('update', 'users', update, id)
  }
}

export async function deleteUser(id) {
  if (isOnline) {
    await supabase.from('users').delete().eq('id', id).eq('lodge_id', lodgeId)
    await refreshAllCaches()
  } else {
    const cached = readCache('users')
    writeCache('users', cached.filter((u) => u.id !== id))
    queueOperation('delete', 'users', {}, id)
  }
}

// ─── ROOMS ────────────────────────────────────────────────────────────────────

export async function getAllRooms() {
  if (isOnline) {
    const { data } = await supabase.from('rooms').select('*').eq('lodge_id', lodgeId).order('room_number')
    if (data) writeCache('rooms', data)
    return data || []
  }
  return readCache('rooms')
}

export async function getRoomById(id) {
  if (isOnline) {
    const { data } = await supabase.from('rooms').select('*').eq('id', id).eq('lodge_id', lodgeId).single()
    return data
  }
  return readCache('rooms').find((r) => r.id === id)
}

export async function createRoom(data) {
  const room = {
    room_number: data.room_number,
    room_type: data.room_type,
    rate_per_night: data.rate_per_night,
    max_occupancy: data.max_occupancy || 2,
    status: data.status || 'available',
    description: data.description || '',
    lodge_id: lodgeId
  }

  if (isOnline) {
    const { data: result } = await supabase.from('rooms').insert(room).select().single()
    await refreshAllCaches()
    return result?.id
  } else {
    const cached = readCache('rooms')
    const tempId = Date.now()
    cached.push({ ...room, id: tempId, created_at: new Date().toISOString() })
    writeCache('rooms', cached)
    queueOperation('insert', 'rooms', room)
    return tempId
  }
}

export async function updateRoom(id, data) {
  const update = {
    room_number: data.room_number,
    room_type: data.room_type,
    rate_per_night: data.rate_per_night,
    max_occupancy: data.max_occupancy,
    status: data.status,
    description: data.description
  }

  if (isOnline) {
    await supabase.from('rooms').update(update).eq('id', id).eq('lodge_id', lodgeId)
    await refreshAllCaches()
  } else {
    const cached = readCache('rooms')
    const idx = cached.findIndex((r) => r.id === id)
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('rooms', cached)
    queueOperation('update', 'rooms', update, id)
  }
}

export async function updateRoomHousekeeping(id, status, notes) {
  const update = {
    housekeeping_status: status || 'clean',
    housekeeping_notes: notes || ''
  }
  if (isOnline) {
    const { error } = await supabase.from('rooms').update(update).eq('id', id).eq('lodge_id', lodgeId)
    if (error) throw new Error(error.message)
    await refreshAllCaches()
    const room = readCache('rooms').find((r) => r.id === id)
    logActivity('housekeeping_updated', `Room ${room?.room_number || id} marked ${status}${notes ? ' · note saved' : ''}`)
  } else {
    const cached = readCache('rooms')
    const idx = cached.findIndex((r) => r.id === id)
    const room = cached[idx]
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('rooms', cached)
    queueOperation('update', 'rooms', update, id)
    logActivity('housekeeping_updated', `Room ${room?.room_number || id} marked ${status}${notes ? ' · note saved' : ''}`)
  }
}

export async function deleteRoom(id) {
  if (isOnline) {
    await supabase.from('rooms').delete().eq('id', id).eq('lodge_id', lodgeId)
    await refreshAllCaches()
  } else {
    const cached = readCache('rooms')
    writeCache('rooms', cached.filter((r) => r.id !== id))
    queueOperation('delete', 'rooms', {}, id)
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
  const customer = {
    name: data.name,
    email: data.email || '',
    phone: data.phone || '',
    id_number: data.id_number || '',
    nationality: data.nationality || '',
    lodge_id: lodgeId
  }

  if (isOnline) {
    const { data: result } = await supabase.from('customers').insert(customer).select().single()
    await refreshAllCaches()
    return result?.id
  } else {
    const cached = readCache('customers')
    const tempId = Date.now()
    cached.push({ ...customer, id: tempId, created_at: new Date().toISOString() })
    writeCache('customers', cached)
    queueOperation('insert', 'customers', customer)
    return tempId
  }
}

export async function updateCustomerBlacklist(id, is_blacklisted, reason) {
  const update = { is_blacklisted: !!is_blacklisted, blacklist_reason: reason || '' }
  if (isOnline) {
    await supabase.from('customers').update(update).eq('id', id).eq('lodge_id', lodgeId)
    await refreshAllCaches()
  } else {
    const cached = readCache('customers')
    const idx = cached.findIndex((c) => c.id === id)
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('customers', cached)
    queueOperation('update', 'customers', update, id)
  }
}

export async function getCustomerBookings(customerId) {
  const id = Number(customerId)
  if (isOnline) {
    const { data } = await supabase
      .from('bookings')
      .select('*, rooms(room_number, room_type)')
      .eq('lodge_id', lodgeId)
      .eq('customer_id', id)
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
    .filter((b) => b.customer_id === id)
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
    await supabase.from('customers').update(update).eq('id', id).eq('lodge_id', lodgeId)
    await refreshAllCaches()
  } else {
    const cached = readCache('customers')
    const idx = cached.findIndex((c) => c.id === id)
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('customers', cached)
    queueOperation('update', 'customers', update, id)
  }
}

// ─── BOOKINGS ─────────────────────────────────────────────────────────────────

export async function getAllBookings() {
  if (isOnline) {
    const { data } = await supabase
      .from('bookings')
      .select(`*, customers(name, phone), rooms(room_number, room_type, rate_per_night)`)
      .eq('lodge_id', lodgeId)
      .order('check_in', { ascending: false })

    if (data) {
      const mapped = data.map((b) => ({
        ...b,
        customer_name: b.customers?.name,
        customer_phone: b.customers?.phone,
        customer_email: b.customers?.email,
        room_number: b.rooms?.room_number,
        room_type: b.rooms?.room_type,
        rate_per_night: b.rooms?.rate_per_night
      }))
      writeCache('bookings', mapped)
      return mapped
    }
    return []
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

export async function createBooking(data) {
  const existingBookings = isOnline
    ? (
        await supabase
          .from('bookings')
          .select('id, check_in, check_out')
          .eq('lodge_id', lodgeId)
          .eq('room_id', data.room_id)
          .neq('status', 'cancelled')
      ).data || []
    : readCache('bookings').filter(
        (b) => b.room_id === data.room_id && b.status !== 'cancelled'
      )

  const conflict = existingBookings.find(
    (b) => b.check_in < data.check_out && b.check_out > data.check_in
  )
  if (conflict) throw new Error('Room is already booked for these dates')

  const room = await getRoomById(data.room_id)
  const nights = Math.ceil(
    (new Date(data.check_out) - new Date(data.check_in)) / (1000 * 60 * 60 * 24)
  )
  const total = room.rate_per_night * nights

  const deposit = Number(data.deposit_amount) || 0
  const booking = {
    customer_id: data.customer_id,
    room_id: data.room_id,
    check_in: data.check_in,
    check_out: data.check_out,
    adults: data.adults || 1,
    children: data.children || 0,
    total_amount: total,
    status: 'confirmed',
    payment_status: deposit > 0 ? 'partial' : 'unpaid',
    amount_paid: deposit,
    deposit_amount: deposit,
    payment_method: deposit > 0 ? (data.payment_method || 'cash') : null,
    notes: data.notes || '',
    created_by: data.created_by || null,
    lodge_id: lodgeId
  }

  if (isOnline) {
    const { data: result } = await supabase.from('bookings').insert(booking).select().single()
    await refreshAllCaches()
    const _r = readCache('rooms').find((r) => r.id === booking.room_id)
    const _c = readCache('customers').find((c) => c.id === booking.customer_id)
    logActivity('booking_created', `Booking created · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''} · ${booking.check_in} → ${booking.check_out}`)
    createBackup()
    return result?.id
  } else {
    const cached = readCache('bookings')
    const tempId = Date.now()
    cached.push({ ...booking, id: tempId, created_at: new Date().toISOString() })
    writeCache('bookings', cached)
    queueOperation('insert', 'bookings', booking)
    const _r = readCache('rooms').find((r) => r.id === booking.room_id)
    const _c = readCache('customers').find((c) => c.id === booking.customer_id)
    logActivity('booking_created', `Booking created · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''} · ${booking.check_in} → ${booking.check_out}`)
    createBackup()
    return tempId
  }
}

export async function updateBooking(id, data) {
  const room = await getRoomById(data.room_id)
  const nights = Math.ceil(
    (new Date(data.check_out) - new Date(data.check_in)) / (1000 * 60 * 60 * 24)
  )
  const total = room.rate_per_night * nights

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

  if (isOnline) {
    await supabase.from('bookings').update(update).eq('id', id).eq('lodge_id', lodgeId)
    await refreshAllCaches()
  } else {
    const cached = readCache('bookings')
    const idx = cached.findIndex((b) => b.id === id)
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('bookings', cached)
    queueOperation('update', 'bookings', update, id)
  }
}

export async function updateBookingStatus(id, status) {
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
    await supabase.from('bookings').update(update).eq('id', id).eq('lodge_id', lodgeId)
    if (roomStatus && booking?.room_id) {
      await supabase.from('rooms').update({ status: roomStatus }).eq('id', booking.room_id).eq('lodge_id', lodgeId)
    }
    await refreshAllCaches()
    const _r = readCache('rooms').find((r) => r.id === booking?.room_id)
    const _c = readCache('customers').find((c) => c.id === booking?.customer_id)
    logActivity(actionKey, `${actionLabel} · ${_c?.name || 'Guest'} · Room ${_r?.room_number || ''}`)
    if (status === 'checked_in' || status === 'checked_out') createBackup()
  } else {
    const bookings = readCache('bookings')
    const idx = bookings.findIndex((b) => b.id === id)
    const bk = bookings[idx] || {}
    const roomId = bk.room_id
    if (idx >= 0) bookings[idx] = { ...bookings[idx], ...update }
    writeCache('bookings', bookings)
    queueOperation('update', 'bookings', update, id)
    if (roomStatus && roomId) {
      const rooms = readCache('rooms')
      const rIdx = rooms.findIndex((r) => r.id === roomId)
      const room = rooms[rIdx]
      if (rIdx >= 0) rooms[rIdx] = { ...rooms[rIdx], status: roomStatus }
      writeCache('rooms', rooms)
      queueOperation('update', 'rooms', { status: roomStatus }, roomId)
      const _c = readCache('customers').find((c) => c.id === bk.customer_id)
      logActivity(actionKey, `${actionLabel} · ${_c?.name || 'Guest'} · Room ${room?.room_number || ''}`)
    } else {
      logActivity(actionKey, `${actionLabel} · Booking #${id}`)
    }
    if (status === 'checked_in' || status === 'checked_out') createBackup()
  }
}

export async function updateBookingPayment(id, payment_status, amount_paid, payment_method) {
  const update = {
    payment_status,
    amount_paid: Number(amount_paid) || 0,
    payment_method: payment_method || 'cash',
    updated_at: new Date().toISOString()
  }

  if (isOnline) {
    await supabase.from('bookings').update(update).eq('id', id).eq('lodge_id', lodgeId)
    await refreshAllCaches()
    const bk = readCache('bookings').find((b) => b.id === id)
    const _c = readCache('customers').find((c) => c.id === bk?.customer_id)
    logActivity('payment_updated', `Payment updated · ${_c?.name || 'Guest'} · ${payment_status} · ${Number(amount_paid).toFixed(2)} (${payment_method})`)
  } else {
    const cached = readCache('bookings')
    const idx = cached.findIndex((b) => b.id === id)
    const _c = readCache('customers').find((c) => c.id === cached[idx]?.customer_id)
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update }
    writeCache('bookings', cached)
    queueOperation('update', 'bookings', update, id)
    logActivity('payment_updated', `Payment updated · ${_c?.name || 'Guest'} · ${payment_status} · ${Number(amount_paid).toFixed(2)} (${payment_method})`)
  }
}

// ─── EVENT / LODGE BOOKING ────────────────────────────────────────────────────

export async function createEventBooking(data) {
  let customerId
  const contactCustomer = {
    name: data.event_name,
    phone: data.contact_phone || '',
    email: data.contact_email || '',
    id_number: '',
    nationality: '',
    lodge_id: lodgeId
  }

  if (isOnline) {
    const { data: existing } = await supabase
      .from('customers').select('id').eq('lodge_id', lodgeId).eq('name', data.event_name).limit(1)
    if (existing?.length > 0) {
      customerId = existing[0].id
    } else {
      const { data: result } = await supabase.from('customers').insert(contactCustomer).select().single()
      customerId = result?.id
    }
  } else {
    const cached = readCache('customers')
    const existing = cached.find((c) => c.name === data.event_name)
    if (existing) {
      customerId = existing.id
    } else {
      customerId = Date.now()
      cached.push({ ...contactCustomer, id: customerId, created_at: new Date().toISOString() })
      writeCache('customers', cached)
      queueOperation('insert', 'customers', contactCustomer)
    }
  }

  const allRooms = await getAllRooms()
  const conflicting = isOnline
    ? (
        await supabase
          .from('bookings')
          .select('room_id, check_in, check_out')
          .eq('lodge_id', lodgeId)
          .neq('status', 'cancelled')
          .lte('check_in', data.check_out)
          .gt('check_out', data.check_in)
      ).data || []
    : readCache('bookings').filter(
        (b) =>
          b.status !== 'cancelled' &&
          b.check_in < data.check_out &&
          b.check_out > data.check_in
      )

  const conflictRoomIds = new Set(conflicting.map((b) => b.room_id))
  const available = allRooms.filter(
    (r) => r.status !== 'maintenance' && !conflictRoomIds.has(r.id)
  )

  if (available.length === 0) {
    throw new Error('No rooms are available for the selected dates.')
  }

  const nights = Math.ceil(
    (new Date(data.check_out) - new Date(data.check_in)) / (1000 * 60 * 60 * 24)
  )
  const groupId = `evt-${Date.now()}`
  const totalDeposit = Number(data.deposit_amount) || 0
  const depositPerRoom = totalDeposit > 0 ? totalDeposit / available.length : 0
  const eventNotes = `[GROUP:${groupId}]${data.notes ? '\n' + data.notes : ''}`

  for (const room of available) {
    const total = room.rate_per_night * nights
    const booking = {
      customer_id: customerId,
      room_id: room.id,
      check_in: data.check_in,
      check_out: data.check_out,
      adults: 1,
      children: 0,
      total_amount: total,
      status: 'confirmed',
      payment_status: depositPerRoom > 0 ? 'partial' : 'unpaid',
      amount_paid: depositPerRoom,
      deposit_amount: depositPerRoom,
      payment_method: depositPerRoom > 0 ? (data.payment_method || 'cash') : null,
      notes: eventNotes,
      created_by: data.created_by || null,
      lodge_id: lodgeId
    }

    if (isOnline) {
      await supabase.from('bookings').insert(booking)
    } else {
      const cached = readCache('bookings')
      const tempId = Date.now() + Math.round(Math.random() * 1000)
      cached.push({ ...booking, id: tempId, created_at: new Date().toISOString() })
      writeCache('bookings', cached)
      queueOperation('insert', 'bookings', booking)
    }
  }

  if (isOnline) await refreshAllCaches()

  logActivity(
    'event_booking_created',
    `Event booking · ${data.event_name} · ${available.length} room${available.length !== 1 ? 's' : ''} · ${data.check_in} → ${data.check_out}`
  )
  createBackup()

  return {
    count: available.length,
    groupId,
    rooms: available.map((r) => r.room_number)
  }
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────

export async function getOccupancyReport(startDate, endDate) {
  const rooms = await getAllRooms()
  const bookings = isOnline
    ? (
        await supabase
          .from('bookings')
          .select('room_id, check_in, check_out')
          .eq('lodge_id', lodgeId)
          .neq('status', 'cancelled')
          .lte('check_in', endDate)
          .gt('check_out', startDate)
      ).data || []
    : readCache('bookings').filter(
        (b) => b.status !== 'cancelled' && b.check_in <= endDate && b.check_out > startDate
      )

  const totalDays = Math.ceil(
    (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
  )

  return rooms.map((room) => {
    const roomBookings = bookings.filter((b) => b.room_id === room.id)
    let nights = 0
    for (const b of roomBookings) {
      const start = new Date(Math.max(new Date(b.check_in), new Date(startDate)))
      const end = new Date(Math.min(new Date(b.check_out), new Date(endDate)))
      nights += Math.max(0, Math.ceil((end - start) / (1000 * 60 * 60 * 24)))
    }
    return {
      ...room,
      occupied_nights: nights,
      occupancy_rate: totalDays > 0 ? Math.round((nights / totalDays) * 100) : 0
    }
  })
}

export async function getRevenueReport(startDate, endDate) {
  const bookings = isOnline
    ? (
        await supabase
          .from('bookings')
          .select('*')
          .eq('lodge_id', lodgeId)
          .gte('check_in', startDate)
          .lte('check_in', endDate)
      ).data || []
    : readCache('bookings').filter(
        (b) => b.check_in >= startDate && b.check_in <= endDate
      )

  const totalRevenue = bookings.reduce((sum, b) => sum + (b.total_amount || 0), 0)
  const paidRevenue = bookings.reduce((sum, b) => sum + (b.amount_paid || 0), 0)

  return {
    total_revenue: totalRevenue,
    total_bookings: bookings.length,
    avg_booking_value: bookings.length > 0 ? totalRevenue / bookings.length : 0,
    confirmed_count: bookings.filter((b) => b.status === 'confirmed').length,
    checked_in_count: bookings.filter((b) => b.status === 'checked_in').length,
    checked_out_count: bookings.filter((b) => b.status === 'checked_out').length,
    cancelled_count: bookings.filter((b) => b.status === 'cancelled').length,
    paid_count: bookings.filter((b) => b.payment_status === 'paid').length,
    partial_count: bookings.filter((b) => b.payment_status === 'partial').length,
    unpaid_count: bookings.filter((b) => !b.payment_status || b.payment_status === 'unpaid').length,
    paid_revenue: paidRevenue,
    outstanding_amount: totalRevenue - paidRevenue
  }
}

export async function getDashboardStats() {
  const today = new Date().toISOString().split('T')[0]
  const thisMonth = today.substring(0, 7)

  const rooms = await getAllRooms()
  const bookings = isOnline
    ? (await supabase.from('bookings').select('*').eq('lodge_id', lodgeId)).data || []
    : readCache('bookings')

  return {
    total_rooms: rooms.length,
    occupied_today: bookings.filter(
      (b) =>
        ['confirmed', 'checked_in'].includes(b.status) &&
        b.check_in <= today &&
        b.check_out > today
    ).length,
    checkins_today: bookings.filter(
      (b) => b.check_in === today && b.status !== 'cancelled'
    ).length,
    checkouts_today: bookings.filter(
      (b) => b.check_out === today && b.status !== 'cancelled'
    ).length,
    revenue_month: bookings
      .filter((b) => b.check_in?.startsWith(thisMonth) && b.status !== 'cancelled')
      .reduce((sum, b) => sum + (b.total_amount || 0), 0),
    upcoming_bookings: bookings.filter(
      (b) => b.check_in > today && b.status === 'confirmed'
    ).length
  }
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

export async function getTodayActivity() {
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

  const allBookings = isOnline
    ? (await supabase.from('bookings').select('*').eq('lodge_id', lodgeId)).data || []
    : readCache('bookings')

  return {
    checkins_today: allBookings.filter(
      (b) => b.check_in === today && b.status !== 'cancelled'
    ),
    checkouts_today: allBookings.filter(
      (b) => b.check_out === today && b.status !== 'cancelled'
    ),
    checkins_tomorrow: allBookings.filter(
      (b) => b.check_in === tomorrow && b.status !== 'cancelled'
    )
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
      .select('*')
      .eq('lodge_id', lodgeId)
      .eq('booking_id', bookingId)
      .order('created_at')
    return data || []
  }
  return []
}

export async function addBookingCharge(bookingId, data) {
  const charge = {
    booking_id: bookingId,
    lodge_id: lodgeId,
    description: data.description,
    category: data.category || 'other',
    quantity: Number(data.quantity) || 1,
    unit_price: Number(data.unit_price) || 0,
    amount: (Number(data.quantity) || 1) * (Number(data.unit_price) || 0)
  }
  if (isOnline) {
    const { data: result } = await supabase.from('booking_charges').insert(charge).select().single()
    return { success: true, id: result?.id }
  }
  return { success: false, error: 'Charges require an internet connection' }
}

export async function deleteBookingCharge(chargeId) {
  if (isOnline) {
    await supabase.from('booking_charges').delete().eq('id', chargeId).eq('lodge_id', lodgeId)
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
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
    const { data: result } = await supabase.from('room_rate_overrides').insert(override).select().single()
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
    await supabase.from('room_rate_overrides').update(update).eq('id', id).eq('lodge_id', lodgeId)
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function deleteRateOverride(id) {
  if (isOnline) {
    await supabase.from('room_rate_overrides').delete().eq('id', id).eq('lodge_id', lodgeId)
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

export async function getExpenses(startDate, endDate) {
  if (isOnline) {
    let query = supabase.from('expenses').select('*').eq('lodge_id', lodgeId)
    if (startDate) query = query.gte('date', startDate)
    if (endDate) query = query.lte('date', endDate)
    const { data } = await query.order('date', { ascending: false })
    return data || []
  }
  return []
}

export async function createExpense(data) {
  const expense = {
    lodge_id: lodgeId,
    date: data.date,
    category: data.category,
    description: data.description,
    amount: Number(data.amount)
  }
  if (isOnline) {
    const { data: result } = await supabase.from('expenses').insert(expense).select().single()
    return { success: true, id: result?.id }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function updateExpense(id, data) {
  const update = {
    date: data.date,
    category: data.category,
    description: data.description,
    amount: Number(data.amount)
  }
  if (isOnline) {
    await supabase.from('expenses').update(update).eq('id', id).eq('lodge_id', lodgeId)
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function deleteExpense(id) {
  if (isOnline) {
    await supabase.from('expenses').delete().eq('id', id).eq('lodge_id', lodgeId)
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
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
      room_number: t.rooms?.room_number,
      room_type: t.rooms?.room_type
    }))
  }
  return []
}

export async function createMaintenanceTicket(data) {
  const ticket = {
    lodge_id: lodgeId,
    room_id: data.room_id || null,
    title: data.title,
    description: data.description || '',
    status: 'open',
    priority: data.priority || 'medium'
  }
  if (isOnline) {
    const { data: result } = await supabase.from('maintenance_tickets').insert(ticket).select().single()
    // If a room is selected, mark it as maintenance
    if (data.room_id) {
      await supabase.from('rooms').update({ status: 'maintenance' }).eq('id', data.room_id).eq('lodge_id', lodgeId)
      await refreshAllCaches()
    }
    return { success: true, id: result?.id }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function updateMaintenanceTicket(id, data) {
  const update = {
    title: data.title,
    description: data.description || '',
    priority: data.priority,
    status: data.status
  }
  if (isOnline) {
    await supabase.from('maintenance_tickets').update(update).eq('id', id).eq('lodge_id', lodgeId)
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function resolveMaintenanceTicket(id, roomId) {
  if (isOnline) {
    await supabase
      .from('maintenance_tickets')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', id)
      .eq('lodge_id', lodgeId)
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
        await supabase.from('rooms').update({ status: 'available' }).eq('id', roomId).eq('lodge_id', lodgeId)
      }
      await refreshAllCaches()
    }
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

// ─── ID PHOTO ─────────────────────────────────────────────────────────────────

export async function updateCustomerIdPhoto(id, photo) {
  if (isOnline) {
    await supabase.from('customers').update({ id_photo: photo }).eq('id', id).eq('lodge_id', lodgeId)
    await refreshAllCaches()
    return { success: true }
  }
  // Offline: update cache
  const cached = readCache('customers')
  const idx = cached.findIndex((c) => c.id === id)
  if (idx >= 0) cached[idx] = { ...cached[idx], id_photo: photo }
  writeCache('customers', cached)
  return { success: true }
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

export async function getPosMenuItems() {
  if (isOnline) {
    const { data } = await supabase
      .from('pos_menu_items')
      .select('*')
      .eq('lodge_id', lodgeId)
      .order('category')
      .order('name')
    return data || []
  }
  return []
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
    depletion_qty: data.inventory_item_id ? (Number(data.depletion_qty) || 1) : null
  }
  if (isOnline) {
    const { data: result, error } = await supabase.from('pos_menu_items').insert(item).select().single()
    if (error) throw new Error(error.message)
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
    depletion_qty: data.inventory_item_id ? (Number(data.depletion_qty) || 1) : null
  }
  if (isOnline) {
    const { error } = await supabase.from('pos_menu_items').update(update).eq('id', id).eq('lodge_id', lodgeId)
    if (error) throw new Error(error.message)
    return { success: true }
  }
  throw new Error('No internet connection. Please check your connection and try again.')
}

export async function deletePosMenuItem(id) {
  if (!isOnline) throw new Error('No internet connection. Please check your connection and try again.')
  const { error } = await supabase.from('pos_menu_items').delete().eq('id', id).eq('lodge_id', lodgeId)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function getPosOrders(startDate, endDate) {
  if (!isOnline) return []
  let query = supabase
    .from('pos_orders')
    .select('*, pos_order_items(*)')
    .eq('lodge_id', lodgeId)
  if (startDate) query = query.gte('created_at', startDate)
  if (endDate) query = query.lte('created_at', endDate + 'T23:59:59')
  const { data } = await query.order('created_at', { ascending: false })
  return data || []
}

export async function getActiveBookingForRoom(roomId) {
  if (!isOnline) return null
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('bookings')
    .select('id, customer_name, customer_id')
    .eq('lodge_id', lodgeId)
    .eq('room_id', roomId)
    .in('status', ['confirmed', 'checked_in'])
    .lte('check_in', today)
    .gt('check_out', today)
    .limit(1)
    .maybeSingle()
  return data || null
}

export async function createPosOrder(data) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }

  const items = data.items || []
  const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0)

  let bookingId = data.booking_id || null
  if (data.room_id && !bookingId) {
    const booking = await getActiveBookingForRoom(data.room_id)
    bookingId = booking?.id || null
  }

  const order = {
    lodge_id: lodgeId,
    room_id: data.room_id || null,
    booking_id: bookingId,
    walk_in_name: data.walk_in_name || null,
    status: 'completed',
    total,
    notes: data.notes || null,
    payment_method: data.payment_method || 'cash',
    completed_at: new Date().toISOString()
  }

  const { data: orderResult, error: orderErr } = await supabase.from('pos_orders').insert(order).select().single()
  if (orderErr) throw new Error(orderErr.message)
  const orderId = orderResult?.id
  if (!orderId) throw new Error('Failed to create order — no ID returned')

  const orderItems = items.map((i) => ({
    lodge_id: lodgeId,
    order_id: orderId,
    menu_item_id: i.menu_item_id || null,
    item_name: i.item_name,
    quantity: i.quantity,
    unit_price: i.unit_price,
    subtotal: i.quantity * i.unit_price
  }))
  await supabase.from('pos_order_items').insert(orderItems)

  // Auto-add as booking charge if linked to a booking
  if (bookingId) {
    const chargeDesc = items.map((i) => `${i.item_name} x${i.quantity}`).join(', ')
    await supabase.from('booking_charges').insert({
      lodge_id: lodgeId,
      booking_id: bookingId,
      description: `Bar/Kitchen: ${chargeDesc}`,
      category: 'bar_kitchen',
      quantity: 1,
      unit_price: total,
      amount: total
    })
  }

  // Auto-deplete inventory stock for linked menu items
  const itemsWithMenuIds = items.filter((i) => i.menu_item_id)
  if (itemsWithMenuIds.length > 0) {
    const menuItemIds = [...new Set(itemsWithMenuIds.map((i) => i.menu_item_id))]
    const { data: linkedMenuItems } = await supabase
      .from('pos_menu_items')
      .select('id, inventory_item_id, depletion_qty')
      .in('id', menuItemIds)
      .not('inventory_item_id', 'is', null)

    if (linkedMenuItems && linkedMenuItems.length > 0) {
      // Aggregate total depletion per inventory item
      const depletionMap = {}
      for (const oi of itemsWithMenuIds) {
        const menuItem = linkedMenuItems.find((m) => m.id === oi.menu_item_id)
        if (menuItem?.inventory_item_id) {
          const qty = Number(menuItem.depletion_qty || 1) * oi.quantity
          depletionMap[menuItem.inventory_item_id] = (depletionMap[menuItem.inventory_item_id] || 0) + qty
        }
      }
      // Update stock levels
      for (const [invItemId, totalDepletion] of Object.entries(depletionMap)) {
        const { data: invItem } = await supabase
          .from('inventory_items')
          .select('current_stock')
          .eq('id', invItemId)
          .single()
        if (invItem) {
          const newStock = Math.max(0, Number(invItem.current_stock || 0) - totalDepletion)
          await supabase
            .from('inventory_items')
            .update({ current_stock: newStock })
            .eq('id', invItemId)
            .eq('lodge_id', lodgeId)
        }
      }
    }
  }

  return { success: true, id: orderId }
}

export async function voidPosOrder(id) {
  if (isOnline) {
    await supabase.from('pos_orders').update({ status: 'voided' }).eq('id', id).eq('lodge_id', lodgeId)
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

// ─── INVENTORY ────────────────────────────────────────────────────────────────

export async function getInventoryItems() {
  if (isOnline) {
    const { data } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('lodge_id', lodgeId)
      .order('category')
      .order('name')
    return data || []
  }
  return []
}

export async function createInventoryItem(data) {
  const item = {
    lodge_id: lodgeId,
    name: data.name,
    category: data.category || 'Bar',
    unit: data.unit || 'unit',
    current_stock: Number(data.current_stock) || 0,
    reorder_level: Number(data.reorder_level) || 0,
    latest_unit_cost: 0
  }
  if (isOnline) {
    const { data: result } = await supabase.from('inventory_items').insert(item).select().single()
    return { success: true, id: result?.id }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function updateInventoryItem(id, data) {
  const update = {
    name: data.name,
    category: data.category,
    unit: data.unit,
    reorder_level: Number(data.reorder_level) || 0
  }
  if (isOnline) {
    await supabase.from('inventory_items').update(update).eq('id', id).eq('lodge_id', lodgeId)
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function deleteInventoryItem(id) {
  if (!isOnline) throw new Error('No internet connection. Please check your connection and try again.')
  const { error } = await supabase.from('inventory_items').delete().eq('id', id).eq('lodge_id', lodgeId)
  if (error) throw new Error(error.message)
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
  await supabase.from('inventory_purchases').insert(purchase)

  // Update item's stock and latest unit cost
  const { data: item } = await supabase
    .from('inventory_items')
    .select('current_stock')
    .eq('id', data.item_id)
    .eq('lodge_id', lodgeId)
    .single()

  const newStock = (Number(item?.current_stock) || 0) + qty
  await supabase
    .from('inventory_items')
    .update({ current_stock: newStock, latest_unit_cost: unitCost })
    .eq('id', data.item_id)
    .eq('lodge_id', lodgeId)

  return { success: true }
}

export async function getInventoryPurchases(itemId) {
  if (!isOnline) return []
  const { data } = await supabase
    .from('inventory_purchases')
    .select('*')
    .eq('lodge_id', lodgeId)
    .eq('item_id', itemId)
    .order('date', { ascending: false })
  return data || []
}

export async function adjustInventoryStock(itemId, delta, notes) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const { data: item } = await supabase
    .from('inventory_items')
    .select('current_stock')
    .eq('id', itemId)
    .eq('lodge_id', lodgeId)
    .single()
  const newStock = Math.max(0, (Number(item?.current_stock) || 0) + Number(delta))
  await supabase
    .from('inventory_items')
    .update({ current_stock: newStock })
    .eq('id', itemId)
    .eq('lodge_id', lodgeId)
  return { success: true, new_stock: newStock }
}

// ─── ROOM SUPPLIES ────────────────────────────────────────────────────────────

export async function getSupplyItems() {
  if (isOnline) {
    const { data } = await supabase
      .from('supply_items')
      .select('*')
      .eq('lodge_id', lodgeId)
      .order('category')
      .order('name')
    return data || []
  }
  return []
}

export async function createSupplyItem(data) {
  const item = {
    lodge_id: lodgeId,
    name: data.name,
    category: data.category || 'Bathroom',
    unit: data.unit || 'piece',
    latest_unit_cost: 0
  }
  if (isOnline) {
    const { data: result } = await supabase.from('supply_items').insert(item).select().single()
    return { success: true, id: result?.id }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function updateSupplyItem(id, data) {
  const update = { name: data.name, category: data.category, unit: data.unit }
  if (isOnline) {
    await supabase.from('supply_items').update(update).eq('id', id).eq('lodge_id', lodgeId)
    return { success: true }
  }
  return { success: false, error: 'Requires internet connection' }
}

export async function deleteSupplyItem(id) {
  if (!isOnline) throw new Error('No internet connection. Please check your connection and try again.')
  const { error } = await supabase.from('supply_items').delete().eq('id', id).eq('lodge_id', lodgeId)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function addSupplyPurchase(data) {
  if (!isOnline) return { success: false, error: 'Requires internet connection' }
  const qty = Number(data.quantity_purchased)
  const cost = Number(data.total_cost)
  const unitCost = qty > 0 ? cost / qty : 0

  await supabase.from('supply_purchases').insert({
    lodge_id: lodgeId,
    item_id: data.item_id,
    date: data.date,
    quantity_purchased: qty,
    total_cost: cost,
    unit_cost: unitCost,
    notes: data.notes || null
  })
  await supabase
    .from('supply_items')
    .update({ latest_unit_cost: unitCost })
    .eq('id', data.item_id)
    .eq('lodge_id', lodgeId)
  return { success: true, unit_cost: unitCost }
}

export async function getSupplyPurchases(itemId) {
  if (!isOnline) return []
  const { data } = await supabase
    .from('supply_purchases')
    .select('*')
    .eq('lodge_id', lodgeId)
    .eq('item_id', itemId)
    .order('date', { ascending: false })
  return data || []
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

  // Delete existing allocations for this week, then re-insert
  await supabase
    .from('room_supply_allocations')
    .delete()
    .eq('lodge_id', lodgeId)
    .eq('week_start', weekStart)

  if (rows.length > 0) {
    await supabase.from('room_supply_allocations').insert(rows)
  }
  return { success: true }
}

export async function getRoomSupplyAllocations(startDate, endDate) {
  if (!isOnline) return []
  let query = supabase
    .from('room_supply_allocations')
    .select('*, supply_items(name, unit, category), rooms(room_number)')
    .eq('lodge_id', lodgeId)
  if (startDate) query = query.gte('week_start', startDate)
  if (endDate) query = query.lte('week_start', endDate)
  const { data } = await query.order('week_start', { ascending: false })
  return (data || []).map((a) => ({
    ...a,
    supply_name: a.supply_items?.name,
    supply_unit: a.supply_items?.unit,
    supply_category: a.supply_items?.category,
    room_number: a.rooms?.room_number
  }))
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

// ─── ANALYTICS & COST REPORTS ────────────────────────────────────────────────

export async function getPosRevenueSummary(startDate, endDate) {
  if (!isOnline) return null
  const { data: orders } = await supabase
    .from('pos_orders')
    .select('*, pos_order_items(*)')
    .eq('lodge_id', lodgeId)
    .eq('status', 'completed')
    .gte('created_at', `${startDate}T00:00:00`)
    .lte('created_at', `${endDate}T23:59:59`)
  if (!orders) return null

  const total_revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0)
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
      if (!itemMap[li.item_name]) itemMap[li.item_name] = { name: li.item_name, qty: 0, revenue: 0 }
      itemMap[li.item_name].qty += Number(li.quantity || 0)
      itemMap[li.item_name].revenue += Number(li.subtotal || 0)
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

  return { total_revenue, total_orders, avg_order, by_payment, top_items, daily }
}

export async function getInventorySpend(startDate, endDate) {
  if (!isOnline) return { total: 0, by_category: {}, purchases: [] }
  const { data } = await supabase
    .from('inventory_purchases')
    .select('*, inventory_items(name, category)')
    .eq('lodge_id', lodgeId)
    .gte('purchased_at', `${startDate}T00:00:00`)
    .lte('purchased_at', `${endDate}T23:59:59`)
    .order('purchased_at', { ascending: false })
  const purchases = data || []
  const total = purchases.reduce((s, p) => s + Number(p.total_cost || 0), 0)
  const by_category = {}
  for (const p of purchases) {
    const cat = p.inventory_items?.category || 'Uncategorised'
    by_category[cat] = (by_category[cat] || 0) + Number(p.total_cost || 0)
  }
  return { total, by_category, purchases }
}

export async function getSupplySpend(startDate, endDate) {
  if (!isOnline) return { total: 0, purchases: [] }
  const { data } = await supabase
    .from('supply_purchases')
    .select('*, supply_items(name)')
    .eq('lodge_id', lodgeId)
    .gte('purchased_at', `${startDate}T00:00:00`)
    .lte('purchased_at', `${endDate}T23:59:59`)
    .order('purchased_at', { ascending: false })
  const purchases = data || []
  const total = purchases.reduce((s, p) => s + Number(p.total_cost || 0), 0)
  return { total, purchases }
}

export async function getNightAudit(date) {
  if (!isOnline) return null
  const dayStart = `${date}T00:00:00`
  const dayEnd   = `${date}T23:59:59`

  const [
    { data: checkIns },
    { data: checkOuts },
    { data: newBookings },
    { data: posOrders },
    { data: outstanding }
  ] = await Promise.all([
    // Rooms checking in today
    supabase.from('bookings').select('id, booking_number, customer_name, room_number, room_type, total_amount, payment_status, amount_paid, adults, children, notes')
      .eq('lodge_id', lodgeId).eq('check_in', date).neq('status', 'cancelled').order('room_number'),
    // Rooms checking out today
    supabase.from('bookings').select('id, booking_number, customer_name, room_number, room_type, total_amount, payment_status, amount_paid, adults, children')
      .eq('lodge_id', lodgeId).eq('check_out', date).neq('status', 'cancelled').order('room_number'),
    // New bookings created today
    supabase.from('bookings').select('id, booking_number, customer_name, room_number, check_in, check_out, total_amount, payment_status, status')
      .eq('lodge_id', lodgeId).gte('created_at', dayStart).lte('created_at', dayEnd).order('created_at', { ascending: false }),
    // POS orders today
    supabase.from('pos_orders').select('*, pos_order_items(*)')
      .eq('lodge_id', lodgeId).eq('status', 'completed').gte('created_at', dayStart).lte('created_at', dayEnd).order('created_at', { ascending: false }),
    // Outstanding balances (active bookings not fully paid)
    supabase.from('bookings').select('id, booking_number, customer_name, room_number, total_amount, amount_paid, payment_status, check_in, check_out')
      .eq('lodge_id', lodgeId).in('status', ['confirmed', 'checked_in']).neq('payment_status', 'paid').order('check_in')
  ])

  const posRevenue = (posOrders || []).reduce((s, o) => s + Number(o.total || 0), 0)
  const outstandingTotal = (outstanding || []).reduce((s, b) => {
    const paid = Number(b.amount_paid || 0)
    return s + Math.max(0, Number(b.total_amount || 0) - paid)
  }, 0)

  return {
    date,
    check_ins:     checkIns     || [],
    check_outs:    checkOuts    || [],
    new_bookings:  newBookings  || [],
    pos_orders:    posOrders    || [],
    pos_revenue:   posRevenue,
    outstanding:   outstanding  || [],
    outstanding_total: outstandingTotal
  }
}

export async function getLowStockItems() {
  if (!isOnline) return []
  const { data } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('lodge_id', lodgeId)
    .order('name')
  return (data || []).filter(
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
  currency: 'P',
  logo: '',
  business_type: 'lodge',
  setup_complete: false
}

export async function getSettings() {
  if (isOnline) {
    const { data } = await supabase.from('settings').select('*').eq('lodge_id', lodgeId).maybeSingle()
    if (data) {
      writeCache('settings', [data])
      return data
    }
  }
  const cached = readCache('settings')
  return cached[0] || DEFAULT_SETTINGS
}

export async function saveSettings(data) {
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
    currency: data.currency || 'P',
    logo: data.logo || '',
    business_type: data.business_type || 'lodge',
    setup_complete: true,
    updated_at: new Date().toISOString(),
    lodge_id: lodgeId
  }

  if (isOnline) {
    await supabase.from('settings').upsert(settings, { onConflict: 'lodge_id' })
    // Set trial_started_at only on first setup (don't overwrite on subsequent saves)
    await supabase.from('settings')
      .update({ trial_started_at: new Date().toISOString() })
      .eq('lodge_id', lodgeId)
      .is('trial_started_at', null)
  }
  writeCache('settings', [settings])
  return settings
}

export async function getTrialStatus(lodgeId) {
  if (!isOnline) {
    // Offline — check local cache
    const cached = readCache('trial_status')
    if (cached) return cached
    return { status: 'trial', daysLeft: 3, expired: false }
  }
  try {
    // Check for an active license first
    const now = new Date().toISOString()
    const { data: license } = await supabase
      .from('licenses')
      .select('id, expires_at, subscription_plan, monthly_fee, payment_status, next_due_date, currency, lodge_name')
      .eq('lodge_id', lodgeId)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .maybeSingle()

    if (license) {
      const result = {
        status: 'licensed',
        daysLeft: null,
        expired: false,
        plan: license.subscription_plan,
        expires_at: license.expires_at,
        monthly_fee: license.monthly_fee,
        payment_status: license.payment_status,
        next_due_date: license.next_due_date,
        currency: license.currency,
        lodge_name: license.lodge_name
      }
      writeCache('trial_status', result)
      return result
    }

    // No license — check trial
    const { data: settings } = await supabase
      .from('settings')
      .select('trial_started_at')
      .eq('lodge_id', lodgeId)
      .maybeSingle()

    if (!settings?.trial_started_at) {
      const result = { status: 'trial', daysLeft: 3, expired: false }
      writeCache('trial_status', result)
      return result
    }

    const trialEnd = new Date(settings.trial_started_at)
    trialEnd.setDate(trialEnd.getDate() + 3)
    const msLeft = trialEnd - new Date()
    const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24))

    const result = daysLeft > 0
      ? { status: 'trial', daysLeft, expired: false }
      : { status: 'expired', daysLeft: 0, expired: true }
    writeCache('trial_status', result)
    return result
  } catch {
    return { status: 'trial', daysLeft: 3, expired: false }
  }
}

export async function activateLicenseKey(lodgeId, licenseKey) {
  if (!isOnline) throw new Error('Internet connection required to activate license.')
  if (!licenseKey?.trim()) throw new Error('Please enter a license key.')

  const key = licenseKey.trim().toUpperCase()

  // Find the license by key
  const { data: license, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('license_key', key)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!license) throw new Error('License key not found. Please check and try again.')
  if (!license.is_active) throw new Error('This license key has been deactivated.')

  // Check if already assigned to a different lodge
  if (license.lodge_id && license.lodge_id !== 'unassigned' && license.lodge_id !== lodgeId) {
    throw new Error('This license key is already registered to another installation.')
  }

  // Check expiry
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    throw new Error('This license key has expired.')
  }

  // Assign to this lodge
  const { error: updateError } = await supabase
    .from('licenses')
    .update({ lodge_id: lodgeId })
    .eq('id', license.id)

  if (updateError) throw new Error(updateError.message)

  // Invalidate cached trial status so next check returns 'licensed'
  writeCache('trial_status', { status: 'licensed', daysLeft: null, expired: false, plan: license.subscription_plan })

  return {
    success: true,
    plan: license.subscription_plan || 'Starter',
    expires_at: license.expires_at,
    lodge_name: license.lodge_name
  }
}

// ─── MASTER ADMIN ──────────────────────────────────────────────────────────────

export async function checkMasterAdmin(email, password) {
  console.log('[MASTER] checkMasterAdmin called, isOnline:', isOnline, 'email:', email)
  if (!isOnline) {
    console.log('[MASTER] Not online — skipping master admin check')
    return null
  }
  const { data, error } = await supabase
    .from('master_admins')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .limit(1)
  console.log('[MASTER] query data:', JSON.stringify(data), 'error:', error?.message)
  const admin = data?.[0]
  if (!admin) {
    console.log('[MASTER] No admin found for email:', email.toLowerCase().trim())
    return null
  }
  const passwordMatch = bcrypt.compareSync(password, admin.password_hash)
  console.log('[MASTER] password match:', passwordMatch)
  if (!passwordMatch) return null
  return {
    id: admin.id,
    name: admin.name || 'Master Admin',
    email: admin.email,
    role: 'superadmin',
    isMasterAdmin: true
  }
}

export async function masterAdminExists() {
  if (!isOnline) return false
  const { count } = await supabase.from('master_admins').select('id', { count: 'exact', head: true })
  return (count || 0) > 0
}

export async function createMasterAdmin(name, email, password) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { count } = await supabase.from('master_admins').select('id', { count: 'exact', head: true })
  if ((count || 0) > 0) throw new Error('Master admin already exists')
  const password_hash = bcrypt.hashSync(password, 12)
  const { data, error } = await supabase.from('master_admins').insert({
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
  const { data } = await supabase
    .from('settings')
    .select('lodge_id, lodge_name, company_name, business_type, city, country, email, phone, updated_at, setup_complete, trial_started_at')
    .eq('setup_complete', true)
    .order('updated_at', { ascending: false })
  return data || []
}

// ─── ADMIN: Licenses ───────────────────────────────────────────────────────────

function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const seg = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `BB-${seg(4)}-${seg(4)}-${seg(4)}`
}

export async function getLicenses() {
  if (!isOnline) return []
  const { data } = await supabase
    .from('licenses')
    .select('*')
    .order('issued_at', { ascending: false })
  return data || []
}

export async function createLicense({ lodge_id, lodge_name, business_type, expires_at, notes }) {
  if (!isOnline) throw new Error('Requires internet connection')
  const license_key = generateLicenseKey()
  const { data, error } = await supabase.from('licenses').insert({
    lodge_id: lodge_id || 'unassigned',
    license_key,
    lodge_name: lodge_name || '',
    business_type: business_type || 'lodge',
    expires_at: expires_at || null,
    notes: notes || null,
    is_active: true
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateLicense(id, updates) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await supabase.from('licenses').update(updates).eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function deleteLicense(id) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await supabase.from('licenses').delete().eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

// ─── ADMIN: BROADCASTS ────────────────────────────────────────────────────────

export async function getBroadcasts() {
  if (!isOnline) return []
  const { data } = await supabase.from('broadcasts').select('*').order('created_at', { ascending: false })
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
  const { data, error } = await supabase
    .from('broadcasts')
    .insert({ title, message, expires_at: expires_at || null, is_active: true })
    .select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateBroadcast(id, updates) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await supabase.from('broadcasts').update(updates).eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function deleteBroadcast(id) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await supabase.from('broadcasts').delete().eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

// ─── ADMIN: FEATURE FLAGS ──────────────────────────────────────────────────────

export async function getLodgeFeatures(targetLodgeId) {
  if (!isOnline) return []
  const { data } = await supabase
    .from('lodge_features')
    .select('feature_name, enabled')
    .eq('lodge_id', targetLodgeId)
  return data || []
}

export async function setLodgeFeature(targetLodgeId, featureName, enabled) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await supabase
    .from('lodge_features')
    .upsert(
      { lodge_id: targetLodgeId, feature_name: featureName, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'lodge_id,feature_name' }
    )
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function getAllLodgeFeatures() {
  if (!isOnline) return []
  const { data } = await supabase.from('lodge_features').select('*').order('lodge_id')
  return data || []
}

// ─── ADMIN: SUPPORT TICKETS ────────────────────────────────────────────────────

export async function getSupportTickets(filters = {}) {
  if (!isOnline) return []
  let q = supabase.from('support_tickets').select('*')
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.priority) q = q.eq('priority', filters.priority)
  if (filters.lodge_id) q = q.eq('lodge_id', filters.lodge_id)
  const { data } = await q.order('created_at', { ascending: false })
  return data || []
}

export async function createSupportTicket({ lodge_id, lodge_name, title, description, category, priority }) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { data, error } = await supabase
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
    .select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateSupportTicket(id, updates) {
  if (!isOnline) throw new Error('Requires internet connection')
  const payload = { ...updates, updated_at: new Date().toISOString() }
  if (updates.status === 'resolved' && !updates.resolved_at) {
    payload.resolved_at = new Date().toISOString()
  }
  const { error } = await supabase.from('support_tickets').update(payload).eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function deleteSupportTicket(id) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await supabase.from('support_tickets').delete().eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

// ─── ADMIN: ACTIVITY LOGS ──────────────────────────────────────────────────────

export async function logAdminActivity(targetLodgeId, targetLodgeName, action, details = {}) {
  if (!isOnline) return // fire-and-forget, silent
  supabase.from('activity_logs').insert({
    lodge_id: targetLodgeId,
    lodge_name: targetLodgeName || null,
    action,
    details
  }).then(() => {}).catch(() => {})
}

export async function getActivityLogs(filters = {}) {
  if (!isOnline) return []
  let q = supabase.from('activity_logs').select('*')
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
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const [rooms, users, bookings, expenses, maintenance] = await Promise.all([
    supabase.from('rooms').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId).gte('created_at', thirtyDaysAgo),
    supabase.from('expenses').select('amount').eq('lodge_id', targetLodgeId).gte('date', thirtyDaysAgo),
    supabase.from('maintenance_tickets').select('id', { count: 'exact', head: true }).eq('lodge_id', targetLodgeId).eq('status', 'open')
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
  const { error } = await supabase.from('licenses').update(data).eq('id', id)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function getOverdueLicenses() {
  if (!isOnline) return []
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('licenses')
    .select('*')
    .lt('next_due_date', today)
    .neq('payment_status', 'free')
    .eq('is_active', true)
  return data || []
}

// ─── CONFERENCE BOOKINGS ───────────────────────────────────────────────────────

export async function getConferenceBookings(start, end) {
  if (!isOnline) return []
  let q = supabase.from('conference_bookings').select('*').eq('lodge_id', lodgeId)
  if (start) q = q.gte('booking_date', start)
  if (end) q = q.lte('booking_date', end)
  const { data } = await q.order('booking_date', { ascending: false }).order('start_time', { ascending: true })
  return data || []
}

export async function createConferenceBooking(data) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { data: row, error } = await supabase.from('conference_bookings').insert({
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
  }).select().single()
  if (error) throw new Error(error.message)
  await logActivity(`Conference booking created for ${data.client_name}`)
  return row
}

export async function updateConferenceBooking(id, data) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await supabase.from('conference_bookings').update(data).eq('id', id).eq('lodge_id', lodgeId)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function deleteConferenceBooking(id) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await supabase.from('conference_bookings').delete().eq('id', id).eq('lodge_id', lodgeId)
  if (error) throw new Error(error.message)
  return { success: true }
}

// ─── POOL / DAY USE ────────────────────────────────────────────────────────────

export async function getPoolDayUse(start, end) {
  if (!isOnline) return []
  let q = supabase.from('pool_day_use').select('*').eq('lodge_id', lodgeId)
  if (start) q = q.gte('date', start)
  if (end) q = q.lte('date', end)
  const { data } = await q.order('date', { ascending: false }).order('created_at', { ascending: false })
  return data || []
}

export async function addPoolDayUse(data) {
  if (!isOnline) throw new Error('Requires internet connection')
  const total = (data.adults || 0) * (data.fee_per_adult || 0) + (data.children || 0) * (data.fee_per_child || 0)
  const { data: row, error } = await supabase.from('pool_day_use').insert({
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
  }).select().single()
  if (error) throw new Error(error.message)
  await logActivity(`Pool day use added: ${data.guest_name || 'Walk-in'} — P${total}`)
  return row
}

export async function deletePoolDayUse(id) {
  if (!isOnline) throw new Error('Requires internet connection')
  const { error } = await supabase.from('pool_day_use').delete().eq('id', id).eq('lodge_id', lodgeId)
  if (error) throw new Error(error.message)
  return { success: true }
}

export async function getPoolDayUseSummary(date) {
  if (!isOnline) return { total: 0, adults: 0, children: 0, entries: [] }
  const { data } = await supabase.from('pool_day_use').select('*').eq('lodge_id', lodgeId).eq('date', date)
  const entries = data || []
  return {
    total: entries.reduce((s, e) => s + (e.total || 0), 0),
    adults: entries.reduce((s, e) => s + (e.adults || 0), 0),
    children: entries.reduce((s, e) => s + (e.children || 0), 0),
    entries
  }
}

// ─── BULK IMPORT ──────────────────────────────────────────────────────────────

export async function bulkImportBookings(rows) {
  // rows: array of objects with fields already mapped to app schema
  // Returns { imported, skipped, errors: [{ row, guest, error }] }
  if (!isOnline) throw new Error('Internet connection required for bulk import')

  const rooms = await getAllRooms()
  const roomMap = {}
  rooms.forEach((r) => {
    roomMap[String(r.room_number).toLowerCase().trim()] = r
  })

  const results = { imported: 0, skipped: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      // 1. Find or create customer
      let customerId
      const guestName = (row.guest_name || '').trim()
      if (!guestName) throw new Error('Guest name is required')

      const { data: existing } = await supabase
        .from('customers').select('id')
        .eq('lodge_id', lodgeId)
        .ilike('name', guestName)
        .limit(1)

      if (existing?.length > 0) {
        customerId = existing[0].id
      } else {
        const { data: created, error: ce } = await supabase
          .from('customers').insert({
            name: guestName,
            email: row.email || '',
            phone: row.phone || '',
            id_number: row.id_number || '',
            nationality: row.nationality || '',
            lodge_id: lodgeId
          }).select().single()
        if (ce) throw new Error(`Customer error: ${ce.message}`)
        customerId = created.id
      }

      // 2. Look up room by room_number
      const roomKey = String(row.room_number || '').toLowerCase().trim()
      if (!roomKey) throw new Error('Room number is required')
      const room = roomMap[roomKey]
      if (!room) throw new Error(`Room "${row.room_number}" not found`)

      // 3. Validate and parse dates
      const checkIn = row.check_in
      const checkOut = row.check_out
      if (!checkIn || !checkOut) throw new Error('Check-in and check-out dates are required')
      const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24))
      if (isNaN(nights) || nights <= 0) throw new Error(`Invalid dates: ${checkIn} → ${checkOut}`)

      // 4. Calculate amounts
      const total = room.rate_per_night * nights
      const paid = Number(row.amount_paid) || 0
      const paymentStatus = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
      const status = row.status || 'checked_out'

      // 5. Insert booking
      const { error: be } = await supabase.from('bookings').insert({
        customer_id: customerId,
        room_id: room.id,
        check_in: checkIn,
        check_out: checkOut,
        adults: Number(row.adults) || 1,
        children: Number(row.children) || 0,
        total_amount: total,
        status,
        payment_status: paymentStatus,
        amount_paid: paid,
        deposit_amount: paid,
        payment_method: row.payment_method || null,
        notes: row.notes || '',
        lodge_id: lodgeId
      })
      if (be) throw new Error(`Booking error: ${be.message}`)

      results.imported++
    } catch (err) {
      results.skipped++
      results.errors.push({ row: i + 1, guest: row.guest_name || `Row ${i + 1}`, error: err.message })
    }
  }

  if (results.imported > 0) {
    await refreshAllCaches()
    logActivity('bulk_import', `Bulk import: ${results.imported} bookings imported, ${results.skipped} skipped`)
    createBackup()
  }
  return results
}
