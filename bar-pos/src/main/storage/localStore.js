import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'

let dataDir = null

function getDataDir() {
  if (dataDir) return dataDir
  dataDir = path.join(app.getPath('userData'), 'bar-pos-data')
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  return dataDir
}

function storePath(collection) {
  return path.join(getDataDir(), `${collection}.jsonl`)
}

function readLines(collection) {
  const p = storePath(collection)
  if (!fs.existsSync(p)) return []
  const raw = fs.readFileSync(p, 'utf-8').trim()
  if (!raw) return []
  return raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

function writeLines(collection, rows) {
  const p = storePath(collection)
  const data = rows.map(r => JSON.stringify(r)).join('\n')
  fs.writeFileSync(p, data + (data ? '\n' : ''), 'utf-8')
}

function appendLine(collection, row) {
  const p = storePath(collection)
  fs.appendFileSync(p, JSON.stringify(row) + '\n', 'utf-8')
}

function generateId() {
  return randomUUID()
}

function now() {
  return new Date().toISOString()
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export function getUsers() {
  return readLines('users')
}

export function getUserByEmail(email) {
  return readLines('users').find(u => u.email === email) || null
}

export function createUser({ email, name, passwordHash, role }) {
  const user = { id: generateId(), email, name, password_hash: passwordHash, role: role || 'cashier', created_at: now(), updated_at: now() }
  appendLine('users', user)
  return { id: user.id, email: user.email, name: user.name, role: user.role }
}

export function updateUser(id, updates) {
  const users = readLines('users')
  const idx = users.findIndex(u => u.id === id)
  if (idx === -1) return null
  users[idx] = { ...users[idx], ...updates, updated_at: now() }
  writeLines('users', users)
  return users[idx]
}

export function saveTrustedSession(userId, token) {
  const sessions = readLines('trusted_sessions')
  const existing = sessions.findIndex(s => s.user_id === userId)
  const entry = { user_id: userId, token, created_at: now() }
  if (existing >= 0) {
    sessions[existing] = entry
    writeLines('trusted_sessions', sessions)
  } else {
    appendLine('trusted_sessions', entry)
  }
}

export function getTrustedSession(userId) {
  return readLines('trusted_sessions').find(s => s.user_id === userId) || null
}

export function clearTrustedSession(userId) {
  const sessions = readLines('trusted_sessions').filter(s => s.user_id !== userId)
  writeLines('trusted_sessions', sessions)
}

// ── Config / Settings ────────────────────────────────────────────────────────

export function getSettings() {
  const rows = readLines('settings')
  return rows[0] || null
}

export function saveSettings(settings) {
  const existing = readLines('settings')
  const entry = { ...(existing[0] || {}), ...settings, updated_at: now() }
  writeLines('settings', [entry])
  return entry
}

// ── Menu Items ───────────────────────────────────────────────────────────────

export function getMenuItems() {
  return readLines('menu_items')
}

export function getMenuItemById(id) {
  return readLines('menu_items').find(m => m.id === id) || null
}

export function createMenuItem(data) {
  const item = { id: generateId(), ...data, is_available: data.is_available !== false, created_at: now(), updated_at: now() }
  appendLine('menu_items', item)
  return item
}

export function updateMenuItem(id, data) {
  const items = readLines('menu_items')
  const idx = items.findIndex(m => m.id === id)
  if (idx === -1) return null
  items[idx] = { ...items[idx], ...data, updated_at: now() }
  writeLines('menu_items', items)
  return items[idx]
}

export function deleteMenuItem(id) {
  const items = readLines('menu_items').filter(m => m.id !== id)
  writeLines('menu_items', items)
}

// ── Inventory ────────────────────────────────────────────────────────────────

export function getInventoryItems() {
  return readLines('inventory_items')
}

export function createInventoryItem(data) {
  const item = { id: generateId(), ...data, current_stock: Number(data.current_stock || 0), created_at: now(), updated_at: now() }
  appendLine('inventory_items', item)
  return item
}

export function updateInventoryItem(id, data) {
  const items = readLines('inventory_items')
  const idx = items.findIndex(m => m.id === id)
  if (idx === -1) return null
  items[idx] = { ...items[idx], ...data, updated_at: now() }
  writeLines('inventory_items', items)
  return items[idx]
}

export function adjustInventoryStock(id, delta, reason) {
  const items = readLines('inventory_items')
  const idx = items.findIndex(m => m.id === id)
  if (idx === -1) return null
  items[idx].current_stock = Math.max(0, Number(items[idx].current_stock || 0) + delta)
  items[idx].updated_at = now()
  writeLines('inventory_items', items)
  appendLine('stock_movements', { inventory_item_id: id, delta, reason, balance: items[idx].current_stock, created_at: now() })
  return items[idx]
}

// ── Orders ───────────────────────────────────────────────────────────────────

export function getOrders(filters = {}) {
  let orders = readLines('orders')
  if (filters.outlet_id) orders = orders.filter(o => o.outlet_id === filters.outlet_id)
  if (filters.date) {
    const d = filters.date.slice(0, 10)
    orders = orders.filter(o => (o.created_at || '').slice(0, 10) === d)
  }
  return orders.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
}

export function getOrderById(id) {
  return readLines('orders').find(o => o.id === id) || null
}

export function createOrder(data) {
  const order = { id: generateId(), ...data, status: 'completed', created_at: now(), updated_at: now() }
  appendLine('orders', order)
  return order
}

export function voidOrder(id, reason, voidedBy) {
  const orders = readLines('orders')
  const idx = orders.findIndex(o => o.id === id)
  if (idx === -1) return null
  orders[idx] = { ...orders[idx], status: 'voided', void_reason: reason, voided_by: voidedBy, voided_at: now(), updated_at: now() }
  writeLines('orders', orders)
  return orders[idx]
}

export function getTodaySales() {
  const today = now().slice(0, 10)
  return readLines('orders').filter(o => (o.created_at || '').slice(0, 10) === today && o.status !== 'voided')
}

// ── Cash Up ──────────────────────────────────────────────────────────────────

export function getCashUps(filters = {}) {
  let rows = readLines('cashups')
  if (filters.outlet_id) rows = rows.filter(c => c.outlet_id === filters.outlet_id)
  return rows.sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || ''))
}

export function createCashUp(data) {
  const entry = { id: generateId(), ...data, created_at: now() }
  appendLine('cashups', entry)
  return entry
}

export function getLastCashUp(outletId) {
  const rows = readLines('cashups').filter(c => c.outlet_id === outletId).sort((a, b) => (b.closed_at || '').localeCompare(a.closed_at || ''))
  return rows[0] || null
}

// ── Staff / Shifts ───────────────────────────────────────────────────────────

export function getShifts() {
  return readLines('shifts').sort((a, b) => (b.clock_in || '').localeCompare(a.clock_in || ''))
}

export function getActiveShifts() {
  return readLines('shifts').filter(s => !s.clock_out)
}

export function clockIn(userId, outletId) {
  const shift = { id: generateId(), user_id: userId, outlet_id: outletId, clock_in: now(), clock_out: null }
  appendLine('shifts', shift)
  return shift
}

export function clockOut(shiftId) {
  const shifts = readLines('shifts')
  const idx = shifts.findIndex(s => s.id === shiftId)
  if (idx === -1) return null
  shifts[idx].clock_out = now()
  shifts[idx].updated_at = now()
  writeLines('shifts', shifts)
  return shifts[idx]
}

// ── Sync Queue ───────────────────────────────────────────────────────────────

export function getQueuedItems() {
  return readLines('sync_queue').filter(q => q.status !== 'synced')
}

export function addQueueItem(item) {
  appendLine('sync_queue', item)
}

export function updateQueueItem(id, updates) {
  const items = readLines('sync_queue')
  const idx = items.findIndex(q => q.id === id)
  if (idx === -1) return
  items[idx] = { ...items[idx], ...updates }
  writeLines('sync_queue', items)
}

export function getDbStats() {
  const collections = ['users', 'settings', 'menu_items', 'inventory_items', 'orders', 'cashups', 'shifts', 'stock_movements', 'sync_queue']
  const stats = {}
  for (const c of collections) {
    try { stats[c] = readLines(c).length } catch { stats[c] = 0 }
  }
  return stats
}
