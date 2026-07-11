import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import bcrypt from 'bcryptjs'
import { createClient } from '@supabase/supabase-js'
import {
  getUsers, getUserByEmail, createUser, updateUser, saveTrustedSession, getTrustedSession, clearTrustedSession,
  getSettings, saveSettings,
  getMenuItems, getMenuItemById, createMenuItem, updateMenuItem, deleteMenuItem,
  getInventoryItems, createInventoryItem, updateInventoryItem, adjustInventoryStock,
  getOrders, getOrderById, createOrder, voidOrder, getTodaySales,
  getCashUps, createCashUp, getLastCashUp,
  getShifts, getActiveShifts, clockIn, clockOut,
  getQueuedItems, addQueueItem, updateQueueItem, getDbStats
} from './storage/localStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow = null
let supabase = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Boroko Bar POS',
    backgroundColor: '#0c0a09',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => { mainWindow.show() })
  mainWindow.on('closed', () => { mainWindow = null })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function initSupabase() {
  try {
    const url = process.env.VITE_SUPABASE_URL
    const key = process.env.VITE_SUPABASE_ANON_KEY
    if (url && key) supabase = createClient(url, key)
  } catch { supabase = null }
}

async function seedDefaultAdmin() {
  const users = getUsers()
  if (users.length === 0) {
    const hash = await bcrypt.hash('admin', 10)
    createUser({ email: 'admin@bar.local', name: 'Manager', passwordHash: hash, role: 'manager' })
    createUser({ email: 'cashier@bar.local', name: 'Cashier', passwordHash: await bcrypt.hash('cashier', 10), role: 'cashier' })
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers() {

  // Config
  ipcMain.handle('bar:get-config', () => {
    return { configured: getUsers().length > 0, appName: 'Boroko Bar POS', version: app.getVersion() }
  })

  // Auth
  ipcMain.handle('bar:login', async (_event, { email, password }) => {
    const user = getUserByEmail(email)
    if (!user) throw new Error('Invalid email or password')
    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) throw new Error('Invalid email or password')
    const token = crypto.randomUUID()
    saveTrustedSession(user.id, token)
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, token, lodgeId: 'local' }
  })

  ipcMain.handle('bar:restore-session', async () => {
    const users = getUsers()
    if (users.length === 0) return null
    for (const u of users) {
      const session = getTrustedSession(u.id)
      if (session) return { user: { id: u.id, email: u.email, name: u.name, role: u.role }, lodgeId: 'local' }
    }
    return null
  })

  ipcMain.handle('bar:logout', async (_event, userId) => {
    clearTrustedSession(userId)
    return true
  })

  ipcMain.handle('bar:get-users', () => getUsers().map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role })))

  ipcMain.handle('bar:create-user', async (_event, { email, name, password, role }) => {
    if (getUserByEmail(email)) throw new Error('Email already exists')
    const hash = await bcrypt.hash(password, 10)
    return createUser({ email, name, passwordHash: hash, role })
  })

  // Settings
  ipcMain.handle('bar:get-settings', () => getSettings())

  ipcMain.handle('bar:save-settings', (_event, settings) => saveSettings(settings))

  // Menu Items
  ipcMain.handle('bar:get-menu-items', () => getMenuItems())

  ipcMain.handle('bar:get-menu-item-by-id', (_event, id) => getMenuItemById(id))

  ipcMain.handle('bar:create-menu-item', (_event, data) => createMenuItem(data))

  ipcMain.handle('bar:update-menu-item', (_event, id, data) => updateMenuItem(id, data))

  ipcMain.handle('bar:delete-menu-item', (_event, id) => { deleteMenuItem(id); return true })

  // Inventory
  ipcMain.handle('bar:get-inventory', () => getInventoryItems())

  ipcMain.handle('bar:create-inventory-item', (_event, data) => createInventoryItem(data))

  ipcMain.handle('bar:update-inventory-item', (_event, id, data) => updateInventoryItem(id, data))

  ipcMain.handle('bar:adjust-stock', (_event, { id, delta, reason }) => adjustInventoryStock(id, delta, reason))

  // Orders
  ipcMain.handle('bar:create-order', (_event, data) => createOrder(data))

  ipcMain.handle('bar:get-orders', (_event, filters) => getOrders(filters))

  ipcMain.handle('bar:get-order-by-id', (_event, id) => getOrderById(id))

  ipcMain.handle('bar:void-order', (_event, { id, reason, voidedBy }) => voidOrder(id, reason, voidedBy))

  ipcMain.handle('bar:get-today-sales', () => getTodaySales())

  // Cash Up
  ipcMain.handle('bar:create-cashup', (_event, data) => createCashUp(data))

  ipcMain.handle('bar:get-cashups', (_event, filters) => getCashUps(filters))

  ipcMain.handle('bar:get-last-cashup', (_event, outletId) => getLastCashUp(outletId))

  // Staff / Shifts
  ipcMain.handle('bar:get-shifts', () => getShifts())

  ipcMain.handle('bar:get-active-shifts', () => getActiveShifts())

  ipcMain.handle('bar:clock-in', (_event, { userId, outletId }) => clockIn(userId, outletId))

  ipcMain.handle('bar:clock-out', (_event, shiftId) => clockOut(shiftId))

  // Sync / Status
  ipcMain.handle('bar:get-is-online', () => false)

  ipcMain.handle('bar:get-db-stats', () => getDbStats())

  ipcMain.handle('bar:get-sync-queue', () => getQueuedItems())
}

// ── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  initSupabase()
  await seedDefaultAdmin()
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
