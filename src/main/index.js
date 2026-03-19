import { app, shell, BrowserWindow, ipcMain, Notification, dialog, Menu } from 'electron'
import { join } from 'path'
import fs from 'fs'
import * as XLSX from 'xlsx'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import * as db from './database.js'
import {
  getEmailConfig,
  saveEmailConfig,
  testEmailConfig,
  sendNotificationEmail,
  sendLicenseEmail,
  buildSupportTicketEmail,
  buildUpgradeRequestEmail
} from './emailNotifications.js'

// ── Push notification helper ─────────────────────────────────────────────────
const EDGE_FN_URL = process.env.SUPABASE_URL
  ? `${process.env.SUPABASE_URL}/functions/v1`
  : null

function notifyLodge(lodgeId, title, body) {
  if (!EDGE_FN_URL || !lodgeId) return
  fetch(`${EDGE_FN_URL}/send-push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`
    },
    body: JSON.stringify({ lodge_id: lodgeId, title, body })
  }).catch(() => {})
}

// ── Auto-updater setup ───────────────────────────────────────────────────────
autoUpdater.autoDownload = true        // download silently in background
autoUpdater.autoInstallOnAppQuit = true // install when user quits naturally

function setupAutoUpdater(mainWindow) {
  // Only run in production (not dev mode)
  if (is.dev) return

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update:available', {
      version: info.version,
      releaseNotes: info.releaseNotes || ''
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update:ready', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    // Silent — don't bother the user with update errors
    console.error('Auto-updater error:', err.message)
  })

  // Check on startup (after a short delay so the app feels snappy)
  setTimeout(() => autoUpdater.checkForUpdates(), 8000)

  // Then re-check every 4 hours
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000)
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Boroko Bookings',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Right-click context menu with cut/copy/paste/select-all
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const items = []
    if (params.isEditable) {
      if (params.selectionText.length > 0) items.push({ label: 'Cut', role: 'cut' })
      items.push({ label: 'Copy', role: 'copy', enabled: params.selectionText.length > 0 })
      items.push({ label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste })
      items.push({ type: 'separator' })
      items.push({ label: 'Select All', role: 'selectAll' })
    } else if (params.selectionText.length > 0) {
      items.push({ label: 'Copy', role: 'copy' })
    }
    if (items.length > 0) Menu.buildFromTemplate(items).popup(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.boroko.bookings')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Init DB
  await db.initDatabase()

  // ── Auth ──────────────────────────────────────────────────────────────────
  ipcMain.handle('auth:login', async (_, email, password) => {
    // Check master admin first (works regardless of lodge_id)
    let masterAdmin = null
    try {
      masterAdmin = await db.checkMasterAdmin(email, password)
      console.log('[AUTH] checkMasterAdmin result:', JSON.stringify(masterAdmin))
    } catch (err) {
      console.error('[AUTH] checkMasterAdmin threw:', err.message)
    }
    if (masterAdmin) { db.setCurrentUser(masterAdmin); return masterAdmin }
    // Regular user login
    const user = await db.loginUser(email, password)
    if (user) db.setCurrentUser(user)
    return user
  })

  // ── Master Admin Setup ─────────────────────────────────────────────────────
  ipcMain.handle('admin:exists', async () => db.masterAdminExists().catch(() => false))
  ipcMain.handle('admin:setup', async (_, name, email, password) => {
    try { return await db.createMasterAdmin(name, email, password) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Admin: Company & License Management ───────────────────────────────────
  ipcMain.handle('admin:getCompanies', async () => db.getAllCompanies().catch(() => []))
  ipcMain.handle('admin:getLicenses', async () => db.getLicenses().catch(() => []))
  ipcMain.handle('admin:createLicense', async (_, data) => {
    try { return await db.createLicense(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateLicense', async (_, id, updates) => {
    try { return await db.updateLicense(id, updates) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:deleteLicense', async (_, id) => {
    try { return await db.deleteLicense(id) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Admin: Broadcasts ─────────────────────────────────────────────────────
  ipcMain.handle('admin:getBroadcasts', async () => db.getBroadcasts().catch(() => []))
  ipcMain.handle('admin:getActiveBroadcasts', async () => db.getActiveBroadcasts().catch(() => []))
  ipcMain.handle('admin:createBroadcast', async (_, data) => {
    try { return await db.createBroadcast(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateBroadcast', async (_, id, data) => {
    try { return await db.updateBroadcast(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:deleteBroadcast', async (_, id) => {
    try { return await db.deleteBroadcast(id) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Admin: Feature Flags ──────────────────────────────────────────────────
  ipcMain.handle('admin:getLodgeFeatures', async (_, lodgeId) => db.getLodgeFeatures(lodgeId).catch(() => []))
  ipcMain.handle('admin:setLodgeFeature', async (_, lodgeId, name, enabled) => {
    try { return await db.setLodgeFeature(lodgeId, name, enabled) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getAllLodgeFeatures', async () => db.getAllLodgeFeatures().catch(() => []))

  // ── Admin: Support Tickets ────────────────────────────────────────────────
  ipcMain.handle('admin:getSupportTickets', async (_, filters) => db.getSupportTickets(filters || {}).catch(() => []))
  ipcMain.handle('admin:createSupportTicket', async (_, data) => {
    try {
      const result = await db.createSupportTicket(data)
      // Fire-and-forget email notification
      const isUpgrade = data.category === 'Upgrade Request'
      const { subject, html } = isUpgrade
        ? buildUpgradeRequestEmail(data)
        : buildSupportTicketEmail(data)
      sendNotificationEmail(subject, html).catch(() => {})
      return result
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateSupportTicket', async (_, id, updates) => {
    try { return await db.updateSupportTicket(id, updates) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:deleteSupportTicket', async (_, id) => {
    try { return await db.deleteSupportTicket(id) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Admin: Activity Logs ──────────────────────────────────────────────────
  ipcMain.handle('admin:getActivityLogs', async (_, filters) => db.getActivityLogs(filters || {}).catch(() => []))

  // ── Admin: Company Stats ──────────────────────────────────────────────────
  ipcMain.handle('admin:getCompanyStats', async (_, lodgeId) => db.getCompanyStats(lodgeId).catch(() => null))

  // ── Admin: Billing ────────────────────────────────────────────────────────
  ipcMain.handle('admin:updateLicenseBilling', async (_, id, data) => {
    try { return await db.updateLicenseBilling(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getOverdueLicenses', async () => db.getOverdueLicenses().catch(() => []))

  // ── Email Notifications ───────────────────────────────────────────────────
  ipcMain.handle('email:getConfig', () => {
    const config = getEmailConfig()
    if (!config) return null
    // Mask password before sending to renderer
    return { ...config, pass: config.pass ? '••••••••' : '' }
  })
  ipcMain.handle('email:saveConfig', async (_, config) => {
    // If pass is masked (user didn't change it), keep existing password
    if (config.pass === '••••••••') {
      const existing = getEmailConfig()
      config.pass = existing?.pass || ''
    }
    return saveEmailConfig(config)
  })
  ipcMain.handle('email:test', async (_, config) => {
    // Unmask pass if needed
    if (config.pass === '••••••••') {
      const existing = getEmailConfig()
      config.pass = existing?.pass || ''
    }
    return testEmailConfig(config)
  })
  ipcMain.handle('email:sendLicense', async (_, payload) => {
    try { return await sendLicenseEmail(payload) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Users ─────────────────────────────────────────────────────────────────
  ipcMain.handle('users:getAll', async () => db.getAllUsers())
  ipcMain.handle('users:create', async (_, data) => {
    try { return { success: true, id: await db.createUser(data) } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('users:update', async (_, id, data) => {
    try { await db.updateUser(id, data); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('users:delete', async (_, id) => {
    try { await db.deleteUser(id); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Rooms ─────────────────────────────────────────────────────────────────
  ipcMain.handle('rooms:getAll', async () => db.getAllRooms())
  ipcMain.handle('rooms:create', async (_, data) => {
    try { return { success: true, id: await db.createRoom(data) } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rooms:update', async (_, id, data) => {
    try { await db.updateRoom(id, data); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rooms:delete', async (_, id) => {
    try { await db.deleteRoom(id); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rooms:updateHousekeeping', async (_, id, status, notes) => {
    try { await db.updateRoomHousekeeping(id, status, notes); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Customers ─────────────────────────────────────────────────────────────
  ipcMain.handle('customers:getAll', async () => db.getAllCustomers())
  ipcMain.handle('customers:create', async (_, data) => {
    try { return { success: true, id: await db.createCustomer(data) } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('customers:update', async (_, id, data) => {
    try { await db.updateCustomer(id, data); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('customers:updateBlacklist', async (_, id, is_blacklisted, reason) => {
    try { await db.updateCustomerBlacklist(id, is_blacklisted, reason); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('customers:getBookings', async (_, id) => db.getCustomerBookings(id))

  // ── Bookings ──────────────────────────────────────────────────────────────
  ipcMain.handle('bookings:getAll', async () => db.getAllBookings())
  ipcMain.handle('bookings:getByDateRange', async (_, start, end) =>
    db.getBookingsByDateRange(start, end)
  )
  ipcMain.handle('bookings:create', async (_, data) => {
    try {
      const id = await db.createBooking(data)
      notifyLodge(data.lodge_id, '📋 New booking created', `Guest arriving ${data.check_in || ''}`)
      return { success: true, id }
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('bookings:update', async (_, id, data) => {
    try { await db.updateBooking(id, data); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('bookings:updateStatus', async (_, id, status) => {
    try { await db.updateBookingStatus(id, status); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('bookings:updatePayment', async (_, id, payment_status, amount_paid, payment_method) => {
    try { await db.updateBookingPayment(id, payment_status, amount_paid, payment_method); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('bookings:createEvent', async (_, data) => {
    try { return { success: true, ...(await db.createEventBooking(data)) } }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Reports ───────────────────────────────────────────────────────────────
  ipcMain.handle('reports:occupancy', async (_, start, end) => db.getOccupancyReport(start, end))
  ipcMain.handle('reports:revenue', async (_, start, end) => db.getRevenueReport(start, end))
  ipcMain.handle('dashboard:stats', async () => db.getDashboardStats())
  ipcMain.handle('reports:savePDF', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const today = new Date().toISOString().split('T')[0]
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Report as PDF',
      defaultPath: `boroko-report-${today}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      const pdfBuffer = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: false,
        margins: { marginType: 'default' }
      })
      fs.writeFileSync(result.filePath, pdfBuffer)
      return { success: true, filePath: result.filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ── Notifications ─────────────────────────────────────────────────────────
  ipcMain.handle('notifications:today', async () => db.getTodayActivity())
  ipcMain.handle('notifications:upcoming', async () => db.getUpcomingCheckins())

  // ── Shell ─────────────────────────────────────────────────────────────────
  ipcMain.handle('shell:openExternal', async (_, url) => {
    await shell.openExternal(url)
    return { success: true }
  })

  // ── Excel Export ──────────────────────────────────────────────────────────
  ipcMain.handle('reports:saveExcel', async (event, { occupancy, revenue, start, end, currency }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const today = new Date().toISOString().split('T')[0]
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Export Report to Excel',
      defaultPath: `boroko-report-${today}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false }
    try {
      const wb = XLSX.utils.book_new()
      const sym = currency || 'P'
      const totalDays = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000))

      // Revenue Summary sheet
      const revSheet = XLSX.utils.aoa_to_sheet([
        ['Boroko Bookings — Revenue Report'],
        [`Period: ${start}  to  ${end}`],
        [],
        ['Metric', 'Value'],
        ['Total Revenue',      `${sym} ${Number(revenue?.total_revenue || 0).toFixed(2)}`],
        ['Total Bookings',     revenue?.total_bookings || 0],
        ['Avg Booking Value',  `${sym} ${Number(revenue?.avg_booking_value || 0).toFixed(2)}`],
        [],
        ['BOOKING STATUS'],
        ['Confirmed',          revenue?.confirmed_count   || 0],
        ['Checked In',         revenue?.checked_in_count  || 0],
        ['Checked Out',        revenue?.checked_out_count || 0],
        ['Cancelled',          revenue?.cancelled_count   || 0],
        [],
        ['PAYMENT SUMMARY'],
        ['Paid Bookings',      revenue?.paid_count    || 0],
        ['Partial Payments',   revenue?.partial_count || 0],
        ['Unpaid',             revenue?.unpaid_count  || 0],
        ['Amount Collected',   `${sym} ${Number(revenue?.paid_revenue      || 0).toFixed(2)}`],
        ['Outstanding',        `${sym} ${Number(revenue?.outstanding_amount || 0).toFixed(2)}`]
      ])
      XLSX.utils.book_append_sheet(wb, revSheet, 'Revenue Summary')

      // Room Occupancy sheet
      const occRows = [
        ['Room Occupancy Report'],
        [`Period: ${start}  to  ${end}  (${totalDays} days)`],
        [],
        ['Room', 'Type', `Rate/Night (${sym})`, 'Nights Occupied', 'Total Period Days', 'Occupancy %', `Est. Revenue (${sym})`],
        ...(occupancy || []).map((r) => [
          `Room ${r.room_number}`,
          r.room_type,
          Number(r.rate_per_night).toFixed(2),
          r.occupied_nights,
          totalDays,
          `${r.occupancy_rate}%`,
          (r.rate_per_night * r.occupied_nights).toFixed(2)
        ])
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(occRows), 'Room Occupancy')

      XLSX.writeFile(wb, filePath)
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // Show check-in/check-out reminders shortly after startup
  setTimeout(async () => {
    try {
      const { checkins_today, checkouts_today, checkins_tomorrow } = await db.getTodayActivity()
      if (checkins_today.length > 0) {
        new Notification({
          title: '🏕️ Check-ins Today',
          body: `${checkins_today.length} guest${checkins_today.length > 1 ? 's' : ''} checking in today.`
        }).show()
      }
      if (checkouts_today.length > 0) {
        new Notification({
          title: '🏕️ Check-outs Today',
          body: `${checkouts_today.length} guest${checkouts_today.length > 1 ? 's' : ''} checking out today.`
        }).show()
      }
      if (checkins_tomorrow.length > 0) {
        new Notification({
          title: '🏕️ Tomorrow\'s Arrivals',
          body: `${checkins_tomorrow.length} guest${checkins_tomorrow.length > 1 ? 's' : ''} arriving tomorrow.`
        }).show()
      }
    } catch (e) {
      console.error('Notification error:', e)
    }
  }, 4000)

  // ── Activity Log ──────────────────────────────────────────────────────────
  ipcMain.handle('activity:getAll', async () => db.getActivityLog())
  ipcMain.handle('activity:clear', async () => {
    try { db.clearActivityLog(); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Backups ───────────────────────────────────────────────────────────────
  ipcMain.handle('backup:getInfo', async () => db.getBackupInfo())
  ipcMain.handle('backup:openFolder', async () => {
    const info = db.getBackupInfo()
    if (info.backupDir) {
      const fs2 = fs
      if (!fs2.existsSync(info.backupDir)) fs2.mkdirSync(info.backupDir, { recursive: true })
      await shell.openPath(info.backupDir)
    }
    return { success: true }
  })

  // ── Booking Charges (Folio) ───────────────────────────────────────────────
  ipcMain.handle('charges:getByBooking', async (_, bookingId) => db.getBookingCharges(bookingId))
  ipcMain.handle('charges:add', async (_, bookingId, data) => {
    try { return await db.addBookingCharge(bookingId, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('charges:delete', async (_, id) => {
    try { return await db.deleteBookingCharge(id) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Rate Overrides (Seasonal Pricing) ────────────────────────────────────
  ipcMain.handle('rateOverrides:getAll', async () => db.getRateOverrides())
  ipcMain.handle('rateOverrides:create', async (_, data) => {
    try { return await db.createRateOverride(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rateOverrides:update', async (_, id, data) => {
    try { return await db.updateRateOverride(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rateOverrides:delete', async (_, id) => {
    try { return await db.deleteRateOverride(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rateOverrides:getApplicable', async (_, roomId, checkIn, checkOut) =>
    db.getApplicableRate(roomId, checkIn, checkOut)
  )

  // ── Expenses ──────────────────────────────────────────────────────────────
  ipcMain.handle('expenses:getAll', async (_, start, end) => db.getExpenses(start, end))
  ipcMain.handle('expenses:create', async (_, data) => {
    try { return await db.createExpense(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('expenses:update', async (_, id, data) => {
    try { return await db.updateExpense(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('expenses:delete', async (_, id) => {
    try { return await db.deleteExpense(id) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Maintenance ───────────────────────────────────────────────────────────
  ipcMain.handle('maintenance:getAll', async () => db.getMaintenanceTickets())
  ipcMain.handle('maintenance:create', async (_, data) => {
    try {
      const result = await db.createMaintenanceTicket(data)
      notifyLodge(data.lodge_id, '🔧 New maintenance request', data.issue || data.description || 'A maintenance ticket was raised')
      return result
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('maintenance:update', async (_, id, data) => {
    try { return await db.updateMaintenanceTicket(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('maintenance:resolve', async (_, id, roomId) => {
    try { return await db.resolveMaintenanceTicket(id, roomId) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── ID Photo ──────────────────────────────────────────────────────────────
  ipcMain.handle('customers:updateIdPhoto', async (_, id, photo) => {
    try { return await db.updateCustomerIdPhoto(id, photo) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Forecast ──────────────────────────────────────────────────────────────
  ipcMain.handle('dashboard:forecast', async (_, days) => db.getForecast(days || 30))

  // ── Receipt PDF Save ──────────────────────────────────────────────────────
  ipcMain.handle('receipts:savePDF', async (event, guestName) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const safe = (guestName || 'receipt').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Invoice as PDF',
      defaultPath: `invoice-${safe}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      const pdfBuffer = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: false })
      fs.writeFileSync(result.filePath, pdfBuffer)
      return { success: true, filePath: result.filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ── POS ────────────────────────────────────────────────────────────────────
  // NOTE: write handlers intentionally do NOT catch — errors propagate as rejected
  // IPC promises so the renderer's catch blocks fire correctly.
  ipcMain.handle('pos:getMenuItems', async () => db.getPosMenuItems().catch(() => []))
  ipcMain.handle('pos:createMenuItem', async (_, data) => db.createPosMenuItem(data))
  ipcMain.handle('pos:updateMenuItem', async (_, id, data) => db.updatePosMenuItem(id, data))
  ipcMain.handle('pos:deleteMenuItem', async (_, id) => db.deletePosMenuItem(id))
  ipcMain.handle('pos:getOrders', async (_, start, end) => db.getPosOrders(start, end).catch(() => []))
  ipcMain.handle('pos:createOrder', async (_, data) => db.createPosOrder(data))
  ipcMain.handle('pos:voidOrder', async (_, id) => db.voidPosOrder(id))
  ipcMain.handle('pos:getActiveBookingForRoom', async (_, roomId) => db.getActiveBookingForRoom(roomId).catch(() => null))

  // ── Inventory ──────────────────────────────────────────────────────────────
  ipcMain.handle('inventory:getItems', async () => db.getInventoryItems().catch(() => []))
  ipcMain.handle('inventory:createItem', async (_, data) => db.createInventoryItem(data))
  ipcMain.handle('inventory:updateItem', async (_, id, data) => db.updateInventoryItem(id, data))
  ipcMain.handle('inventory:deleteItem', async (_, id) => db.deleteInventoryItem(id))
  ipcMain.handle('inventory:addPurchase', async (_, data) => db.addInventoryPurchase(data))
  ipcMain.handle('inventory:getPurchases', async (_, itemId) => db.getInventoryPurchases(itemId).catch(() => []))
  ipcMain.handle('inventory:adjustStock', async (_, itemId, delta, notes) => db.adjustInventoryStock(itemId, delta, notes))

  // ── Room Supplies ──────────────────────────────────────────────────────────
  ipcMain.handle('supplies:getItems', async () => db.getSupplyItems().catch(() => []))
  ipcMain.handle('supplies:createItem', async (_, data) => db.createSupplyItem(data))
  ipcMain.handle('supplies:updateItem', async (_, id, data) => db.updateSupplyItem(id, data))
  ipcMain.handle('supplies:deleteItem', async (_, id) => db.deleteSupplyItem(id))
  ipcMain.handle('supplies:addPurchase', async (_, data) => db.addSupplyPurchase(data))
  ipcMain.handle('supplies:getPurchases', async (_, itemId) => db.getSupplyPurchases(itemId).catch(() => []))
  ipcMain.handle('supplies:saveAllocations', async (_, weekStart, allocations) => db.saveRoomSupplyAllocations(weekStart, allocations))
  ipcMain.handle('supplies:getAllocations', async (_, start, end) => db.getRoomSupplyAllocations(start, end).catch(() => []))
  ipcMain.handle('supplies:getWeekAllocations', async (_, weekStart) => db.getSupplyAllocationsForWeek(weekStart).catch(() => []))

  // ── Conference Bookings ────────────────────────────────────────────────────
  ipcMain.handle('conference:getAll', async (_, start, end) => db.getConferenceBookings(start, end).catch(() => []))
  ipcMain.handle('conference:create', async (_, data) => db.createConferenceBooking(data))
  ipcMain.handle('conference:update', async (_, id, data) => db.updateConferenceBooking(id, data))
  ipcMain.handle('conference:delete', async (_, id) => db.deleteConferenceBooking(id))

  // ── Pool / Day Use ─────────────────────────────────────────────────────────
  ipcMain.handle('dayuse:getAll', async (_, start, end) => db.getPoolDayUse(start, end).catch(() => []))
  ipcMain.handle('dayuse:add', async (_, data) => db.addPoolDayUse(data))
  ipcMain.handle('dayuse:delete', async (_, id) => db.deletePoolDayUse(id))
  ipcMain.handle('dayuse:summary', async (_, date) => db.getPoolDayUseSummary(date).catch(() => ({ total: 0, adults: 0, children: 0, entries: [] })))

  // ── Analytics & Cost Reports ───────────────────────────────────────────────
  ipcMain.handle('reports:posSales', async (_, start, end) => db.getPosRevenueSummary(start, end).catch(() => null))
  ipcMain.handle('reports:inventorySpend', async (_, start, end) => db.getInventorySpend(start, end).catch(() => ({ total: 0, by_category: {}, purchases: [] })))
  ipcMain.handle('reports:supplySpend', async (_, start, end) => db.getSupplySpend(start, end).catch(() => ({ total: 0, purchases: [] })))
  ipcMain.handle('inventory:getLowStock', async () => db.getLowStockItems().catch(() => []))
  ipcMain.handle('reports:nightAudit', async (_, date) => db.getNightAudit(date).catch(() => null))

  // ── Settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', async () => db.getSettings())
  ipcMain.handle('settings:save', async (_, data) => {
    try { return { success: true, data: await db.saveSettings(data) } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('trial:getStatus', async (_, lodgeId) => db.getTrialStatus(lodgeId))
  ipcMain.handle('trial:activateKey', async (_, lodgeId, key) => {
    try { return await db.activateLicenseKey(lodgeId, key) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Data Import (Excel) ───────────────────────────────────────────────────
  ipcMain.handle('import:parseExcel', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win, {
      title: 'Select Excel File to Import',
      filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    try {
      const workbook = XLSX.readFile(result.filePaths[0])
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { fileName: result.filePaths[0].split(/[\\/]/).pop(), sheetName, columns, rows: rows.slice(0, 500) }
    } catch (e) {
      return { error: e.message }
    }
  })

  ipcMain.handle('import:execute', async (_, mappedRows) => {
    try { return await db.bulkImportBookings(mappedRows) }
    catch (e) { return { error: e.message } }
  })

  const mainWindow = createWindow()
  setupAutoUpdater(mainWindow)

  // ── Update IPC ──────────────────────────────────────────────────────────────
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true) // isSilent=false, isForceRunAfter=true
  })
  ipcMain.handle('update:check', async () => {
    if (is.dev) return { updateAvailable: false, dev: true }
    try {
      const result = await autoUpdater.checkForUpdates()
      const latestVersion = result?.updateInfo?.version
      const updateAvailable = latestVersion && latestVersion !== app.getVersion()
      return { success: true, updateAvailable, latestVersion }
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('app:getVersion', () => app.getVersion())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
