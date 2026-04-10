import { app, shell, BrowserWindow, ipcMain, Notification, dialog, Menu } from 'electron'
import { join, dirname } from 'path'
import fs from 'fs'
import * as XLSX from 'xlsx'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import autoUpdaterPkg from 'electron-updater'
const { autoUpdater } = autoUpdaterPkg
import * as db from './database.js'
import { buildCapabilitySnapshot, normalizeAppRole } from '../shared/accessControl.js'
import {
  getEmailConfig,
  saveEmailConfig,
  testEmailConfig,
  sendNotificationEmail,
  sendLicenseEmail,
  sendInvoiceEmail,
  sendBookingInvoiceEmail,
  sendQuotationEmail,
  sendBookingConfirmationEmail,
  sendBookingCancellationEmail,
  buildSupportTicketEmail,
  buildUpgradeRequestEmail
} from './emailNotifications.js'

const INPUT_FOCUS_DEBUG = false

// ── URL safety guard (used by shell:openExternal and setWindowOpenHandler) ────
const ALLOWED_PROTOCOLS = ['https:', 'http:']
function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url)
    return ALLOWED_PROTOCOLS.includes(parsed.protocol)
  } catch {
    return false
  }
}

function appendRendererErrorLog(payload) {
  try {
    const logPath = join(app.getPath('userData'), 'renderer-errors.log')
    const entry = {
      at: new Date().toISOString(),
      ...payload
    }
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8')
    return { success: true }
  } catch (error) {
    console.error('Renderer error log write failed:', error.message)
    return { success: false, error: error.message }
  }
}

function getRendererErrorLog(limit = 10) {
  try {
    const logPath = join(app.getPath('userData'), 'renderer-errors.log')
    if (!fs.existsSync(logPath)) return []
    const lines = fs.readFileSync(logPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-Math.max(1, Number(limit) || 10))
      .reverse()
    return lines.map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { at: new Date().toISOString(), message: 'Unreadable renderer error entry', raw: line }
      }
    })
  } catch (error) {
    console.error('Renderer error log read failed:', error.message)
    return []
  }
}

async function assertResourceBelongsToCurrentLodge(resourceLabel, resourceId, loader) {
  if (!resourceId) throw new Error(`${resourceLabel} id is required`)
  const currentUser = db.getCurrentUser?.()
  if (currentUser?.isMasterAdmin) return null

  const activeProfile = db.getActiveProfile?.()
  const expectedLodgeId = currentUser?.lodge_id || activeProfile?.lodge_id || null
  const resource = await loader(resourceId)

  if (!resource) {
    throw new Error(`${resourceLabel} not found`)
  }

  if (expectedLodgeId && resource?.lodge_id && resource.lodge_id !== expectedLodgeId) {
    throw new Error(`Access denied: ${resourceLabel.toLowerCase()} belongs to another lodge`)
  }

  return resource
}

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
    console.error('Auto-updater error:', err.message)
    mainWindow.webContents.send('update:error', {
      message: err?.message || 'Could not check for updates.'
    })
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
      preload: join(__dirname, '../preload/index.mjs'),
      // sandbox: false required — electron-vite preload uses ESM imports resolved
      // via Node module system, incompatible with sandbox: true in dev HTTP mode.
      // Security enforced via contextIsolation: true (contextBridge) + nodeIntegration: false.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  let didShowWindow = false
  const showWindowSafely = (reason) => {
    if (didShowWindow || mainWindow.isDestroyed()) return
    didShowWindow = true
    if (INPUT_FOCUS_DEBUG) console.log('[WINDOW] show requested:', reason)
    mainWindow.show()
  }

  mainWindow.on('ready-to-show', () => {
    if (INPUT_FOCUS_DEBUG) console.log('[WINDOW] ready-to-show')
    showWindowSafely('ready-to-show')
  })

  // If the renderer gets slow or partially fails, do not leave the app hidden forever.
  setTimeout(() => {
    showWindowSafely('startup-timeout')
  }, 2500)

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[WINDOW] did-finish-load', mainWindow.webContents.getURL())
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[WINDOW] did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[WINDOW] render-process-gone', details)
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level <= 2 || String(message || '').includes('preload')) {
      console.log('[RENDERER]', { level, message, line, sourceId })
    }
  })

  const sendFocusRecovery = (reason) => {
    if (mainWindow.isDestroyed()) return
    if (INPUT_FOCUS_DEBUG) {
      console.log('[WINDOW] focus recovery signal:', {
        reason,
        visible: mainWindow.isVisible(),
        focused: mainWindow.isFocused(),
        minimized: mainWindow.isMinimized()
      })
    }
    mainWindow.webContents.send('window:focus-recovery', {
      reason,
      at: new Date().toISOString()
    })
  }

  mainWindow.on('focus', () => {
    if (INPUT_FOCUS_DEBUG) console.log('[WINDOW] focus')
    sendFocusRecovery('focus')
  })
  mainWindow.on('blur', () => {
    if (INPUT_FOCUS_DEBUG) console.log('[WINDOW] blur')
  })
  mainWindow.on('minimize', () => {
    if (INPUT_FOCUS_DEBUG) console.log('[WINDOW] minimize')
  })
  mainWindow.on('restore', () => {
    if (INPUT_FOCUS_DEBUG) console.log('[WINDOW] restore')
    sendFocusRecovery('restore')
  })
  mainWindow.on('show', () => {
    if (INPUT_FOCUS_DEBUG) console.log('[WINDOW] show')
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
    if (isSafeExternalUrl(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

async function collectFullExportData() {
  const safe = async (label, loader, fallback) => {
    try {
      return await loader()
    } catch (error) {
      console.error(`[EXPORT] ${label} failed:`, error?.message || error)
      return fallback
    }
  }

  const [bookings, customers, rooms, expenses, posOrders, quotations, bookingInvoices, maintenance, inventoryItems, supplyItems, conferenceBookings, dayUseEntries] = await Promise.all([
    safe('bookings', () => db.getAllBookings(), []),
    safe('customers', () => db.getAllCustomers(), []),
    safe('rooms', () => db.getAllRooms(), []),
    safe('expenses', () => db.getExpenses('2000-01-01', '2099-12-31'), []),
    safe('posOrders', () => db.getPosOrders('2000-01-01', '2099-12-31'), []),
    safe('quotations', () => db.getAllQuotations(), []),
    safe('bookingInvoices', () => db.getBookingInvoices(), []),
    safe('maintenance', () => db.getMaintenanceTickets(), []),
    safe('inventoryItems', () => db.getInventoryItems(), []),
    safe('supplyItems', () => db.getSupplyItems(), []),
    safe('conferenceBookings', () => db.getConferenceBookings('2000-01-01', '2099-12-31'), []),
    safe('dayUseEntries', () => db.getPoolDayUse('2000-01-01', '2099-12-31'), [])
  ])

  const inventoryPurchases = []
  for (const item of inventoryItems || []) {
    const purchases = await db.getInventoryPurchases(item.id).catch(() => [])
    inventoryPurchases.push(...(purchases || []).map((purchase) => ({
      ...purchase,
      item_name: item.name || item.item_name || ''
    })))
  }

  const supplyPurchases = []
  for (const item of supplyItems || []) {
    const purchases = await db.getSupplyPurchases(item.id).catch(() => [])
    supplyPurchases.push(...(purchases || []).map((purchase) => ({
      ...purchase,
      item_name: item.name || item.item_name || ''
    })))
  }

  return {
    bookings,
    customers,
    rooms,
    expenses,
    posOrders,
    quotations,
    bookingInvoices,
    maintenance,
    inventoryItems,
    inventoryPurchases,
    supplyItems,
    supplyPurchases,
    conferenceBookings,
    dayUseEntries
  }
}

function buildFullExportWorkbook(data) {
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.bookings || []).map(b => ({
      'Booking #': b.booking_number || '',
      'Guest': b.customer_name || '',
      'Room': b.room_number || '',
      'Check-in': b.check_in || '',
      'Check-out': b.check_out || '',
      'Status': b.status || '',
      'Payment Status': b.payment_status || '',
      'Total': Number(b.total_amount || 0) + Number(b.charges_total || 0),
      'Paid': Number(b.amount_paid || 0),
      'Balance': Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0)),
      'Payment Method': b.payment_method || '',
      'Notes': b.notes || '',
      'Created': b.created_at || ''
    }))
  ), 'Bookings')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.customers || []).map(c => ({
      'Name': c.full_name || '',
      'Email': c.email || '',
      'Phone': c.phone || '',
      'ID Number': c.id_number || '',
      'Nationality': c.nationality || '',
      'Blacklisted': c.is_blacklisted ? 'Yes' : 'No'
    }))
  ), 'Guests')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.rooms || []).map(r => ({
      'Room #': r.room_number || '',
      'Type': r.room_type || '',
      'Rate': Number(r.rate || 0),
      'Max Adults': r.max_adults || '',
      'Max Children': r.max_children || '',
      'Status': r.status || ''
    }))
  ), 'Rooms')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.expenses || []).map(e => ({
      'Date': e.date || '',
      'Category': e.category || '',
      'Description': e.description || '',
      'Amount': Number(e.amount || 0),
      'Paid By': e.paid_by || ''
    }))
  ), 'Expenses')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.posOrders || []).map(o => ({
      'Date': o.created_at || '',
      'Room / Guest': o.walk_in_name || (o.room_number ? `Room ${o.room_number}` : ''),
      'Items': (o.pos_order_items || []).map(i => `${i.quantity}× ${i.item_name}`).join(', '),
      'Payment': o.payment_method || '',
      'Total': Number(o.total || 0)
    }))
  ), 'POS Orders')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.bookingInvoices || []).map(inv => ({
      'Invoice #': inv.invoice_number || '',
      'Guest': inv.customer_name || '',
      'Guest Email': inv.customer_email || '',
      'Guest Phone': inv.customer_phone || '',
      'Room': inv.room_number || '',
      'Check-in': inv.check_in || '',
      'Check-out': inv.check_out || '',
      'Booking Status': inv.status || '',
      'Payment Status': inv.payment_status || '',
      'Total': Number(inv.total_amount || 0),
      'Paid': Number(inv.amount_paid || 0),
      'Balance': Number(inv.balance_due || 0),
      'Issued': inv.issued_at || ''
    }))
  ), 'Booking Invoices')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.quotations || []).map(q => ({
      'Quotation #': q.quotation_number || '',
      'Guest': q.customer_name || '',
      'Email': q.customer_email || '',
      'Phone': q.customer_phone || '',
      'Room': q.room_number || '',
      'Check-in': q.check_in || '',
      'Check-out': q.check_out || '',
      'Status': q.status || '',
      'Total': Number(q.total_amount || 0),
      'Created': q.created_at || ''
    }))
  ), 'Quotations')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.maintenance || []).map(ticket => ({
      'Created': ticket.created_at || '',
      'Room': ticket.room_number || '',
      'Issue': ticket.issue || ticket.description || '',
      'Priority': ticket.priority || '',
      'Status': ticket.status || '',
      'Assigned To': ticket.assigned_to_name || '',
      'Resolved At': ticket.resolved_at || ''
    }))
  ), 'Maintenance')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.inventoryItems || []).map(item => ({
      'Item': item.name || item.item_name || '',
      'Category': item.category || '',
      'Stock': Number(item.current_stock || item.stock_quantity || 0),
      'Reorder Level': Number(item.reorder_level || 0),
      'Unit': item.unit || '',
      'Updated': item.updated_at || ''
    }))
  ), 'Inventory Items')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.inventoryPurchases || []).map(purchase => ({
      'Item': purchase.item_name || '',
      'Date': purchase.purchase_date || purchase.created_at || '',
      'Quantity': Number(purchase.quantity || purchase.quantity_purchased || 0),
      'Unit Cost': Number(purchase.unit_cost || 0),
      'Total': Number(purchase.total_cost || purchase.total || 0),
      'Supplier': purchase.supplier || '',
      'Notes': purchase.notes || ''
    }))
  ), 'Inventory Purchases')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.supplyItems || []).map(item => ({
      'Item': item.name || item.item_name || '',
      'Category': item.category || '',
      'Stock': Number(item.current_stock || item.stock_quantity || 0),
      'Unit': item.unit || '',
      'Updated': item.updated_at || ''
    }))
  ), 'Supply Items')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.supplyPurchases || []).map(purchase => ({
      'Item': purchase.item_name || '',
      'Date': purchase.purchase_date || purchase.created_at || '',
      'Quantity': Number(purchase.quantity || purchase.quantity_purchased || 0),
      'Unit Cost': Number(purchase.unit_cost || 0),
      'Total': Number(purchase.total_cost || purchase.total || 0),
      'Supplier': purchase.supplier || '',
      'Notes': purchase.notes || ''
    }))
  ), 'Supply Purchases')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.conferenceBookings || []).map(entry => ({
      'Event': entry.event_name || '',
      'Customer': entry.customer_name || '',
      'Date': entry.event_date || entry.check_in || '',
      'Status': entry.status || '',
      'Guests': entry.guest_count || '',
      'Total': Number(entry.total_amount || 0)
    }))
  ), 'Conference')

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.dayUseEntries || []).map(entry => ({
      'Date': entry.date || entry.created_at || '',
      'Guest': entry.customer_name || entry.walk_in_name || '',
      'Adults': entry.adults || 0,
      'Children': entry.children || 0,
      'Amount': Number(entry.total_amount || entry.amount || 0),
      'Method': entry.payment_method || ''
    }))
  ), 'Pool Day Use')

  return wb
}

async function exportAllDataWorkbookToPath(filePath) {
  const data = await collectFullExportData()
  const wb = buildFullExportWorkbook(data)
  fs.mkdirSync(dirname(filePath), { recursive: true })
  XLSX.writeFile(wb, filePath)
  return { success: true, filePath }
}

function emailAutomationEnabled(key) {
  const config = getEmailConfig()
  return Boolean(config?.host && config?.user && config?.pass && config?.[key] === true)
}

async function getCurrentLodgeSettings() {
  try {
    return await db.getSettings()
  } catch {
    return null
  }
}

async function getBookingEmailContext(bookingId) {
  const [bookings, invoices, settings] = await Promise.all([
    db.getAllBookings().catch(() => []),
    db.getBookingInvoices().catch(() => []),
    getCurrentLodgeSettings()
  ])
  return {
    booking: (bookings || []).find((entry) => entry.id === bookingId),
    invoice: (invoices || []).find((entry) => entry.booking_id === bookingId),
    settings
  }
}

async function recordSuccessfulInvoiceDelivery(invoice, result) {
  const guestLabel = invoice?.customer_name || invoice?.customer_email || 'guest'
  const invoiceLabel = invoice?.invoice_number || 'invoice'
  db.recordActivity('booking_invoice_emailed', `Invoice emailed · ${invoiceLabel} · ${guestLabel}`)
  await db.recordInvoiceDelivery({
    booking_id: invoice?.booking_id || null,
    invoice_number: invoice?.invoice_number || null,
    delivery_type: 'invoice_email',
    delivery_status: 'completed',
    recipient: invoice?.customer_email || null,
    render_version: 'booking-invoice-v1',
    metadata: {
      subject: result?.subject || null,
      guest_name: invoice?.customer_name || null
    }
  }).catch(() => {})
}

async function recordFailedInvoiceDelivery(invoice, errorMessage) {
  await db.recordInvoiceDelivery({
    booking_id: invoice?.booking_id || null,
    invoice_number: invoice?.invoice_number || null,
    delivery_type: 'invoice_email',
    delivery_status: 'failed',
    recipient: invoice?.customer_email || null,
    render_version: 'booking-invoice-v1',
    metadata: {
      error: errorMessage || 'Could not send invoice email'
    }
  }).catch(() => {})
}

async function sendBookingInvoiceEmailWithAudit(invoice) {
  try {
    const result = await sendBookingInvoiceEmail({
      to: invoice?.customer_email,
      invoice,
      lodgeName: invoice?.lodge_name || invoice?.settings?.lodge_name || undefined,
      currency: invoice?.currency || invoice?.settings?.currency || 'P'
    })
    if (result?.success) {
      await recordSuccessfulInvoiceDelivery(invoice, result)
    } else {
      await recordFailedInvoiceDelivery(invoice, result?.error || 'Could not send invoice email')
    }
    return result
  } catch (e) {
    await recordFailedInvoiceDelivery(invoice, e.message || 'Could not send invoice email')
    return { success: false, error: e.message }
  }
}

async function maybeSendQuotationEmail(quotationId, previousStatus = '') {
  if (!emailAutomationEnabled('auto_send_quotations')) return
  if (String(previousStatus || '').toLowerCase() === 'sent') return

  const [quotations, settings] = await Promise.all([
    db.getAllQuotations().catch(() => []),
    getCurrentLodgeSettings()
  ])
  const quotation = (quotations || []).find((entry) => entry.id === quotationId)
  if (!quotation?.customer_email) return
  if (String(quotation.status || '').toLowerCase() !== 'sent') return

  const result = await sendQuotationEmail({
    to: quotation.customer_email,
    quotation,
    lodgeName: settings?.lodge_name || undefined,
    settings: settings || {}
  }).catch((error) => ({ success: false, error: error?.message || 'Could not send quotation email' }))

  if (result?.success) {
    db.recordActivity('quotation_emailed', `Quotation emailed · ${quotation.quotation_number || quotation.id} · ${quotation.customer_name || quotation.customer_email}`)
  }
}

async function maybeSendBookingLifecycleEmails(bookingId, status) {
  const normalizedStatus = String(status || '').toLowerCase()
  if (!['confirmed', 'cancelled'].includes(normalizedStatus)) return

  const { booking, invoice, settings } = await getBookingEmailContext(bookingId)
  if (!booking?.customer_email) return

  if (normalizedStatus === 'confirmed' && emailAutomationEnabled('auto_send_booking_confirmation')) {
    const result = await sendBookingConfirmationEmail({
      to: booking.customer_email,
      booking,
      lodgeName: settings?.lodge_name || undefined,
      settings: settings || {},
      currency: settings?.currency || 'P'
    }).catch((error) => ({ success: false, error: error?.message || 'Could not send booking confirmation email' }))

    if (result?.success) {
      db.recordActivity('booking_confirmation_emailed', `Booking confirmation emailed · ${booking.invoice_number || booking.id} · ${booking.customer_name || booking.customer_email}`)
    }
  }

  if (normalizedStatus === 'confirmed' && emailAutomationEnabled('auto_send_booking_invoice') && invoice?.customer_email) {
    await sendBookingInvoiceEmailWithAudit(invoice)
  }

  if (normalizedStatus === 'cancelled' && emailAutomationEnabled('auto_send_booking_cancellation')) {
    const result = await sendBookingCancellationEmail({
      to: booking.customer_email,
      booking,
      lodgeName: settings?.lodge_name || undefined,
      settings: settings || {}
    }).catch((error) => ({ success: false, error: error?.message || 'Could not send booking cancellation email' }))

    if (result?.success) {
      db.recordActivity('booking_cancellation_emailed', `Booking cancellation emailed · ${booking.invoice_number || booking.id} · ${booking.customer_name || booking.customer_email}`)
    }
  }
}

async function runManagedBackupPolicy(force = false) {
  const policy = db.getManagedBackupPolicy?.()
  const status = db.getBackupInfo?.()?.policy
  if (!policy?.enabled || !policy?.target_dir) {
    return { success: false, skipped: true, reason: 'Managed backup policy is disabled or not configured.' }
  }
  if (!force && status && !status.overdue && status.has_recent_success) {
    return { success: true, skipped: true, reason: 'Managed backup policy is not due yet.' }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const jsonPath = policy.export_json ? join(policy.target_dir, `boroko-full-${stamp}.json`) : null
  const excelPath = policy.export_excel ? join(policy.target_dir, `boroko-full-${stamp}.xlsx`) : null

  try {
    fs.mkdirSync(policy.target_dir, { recursive: true })
    if (jsonPath) await db.writeExpandedBackupToPath(jsonPath)
    if (excelPath) await exportAllDataWorkbookToPath(excelPath)
    db.recordManagedBackupRun({ success: true, jsonPath, excelPath })
    return { success: true, jsonPath, excelPath }
  } catch (e) {
    db.recordManagedBackupRun({ success: false, error: e.message || 'Managed backup failed.', jsonPath, excelPath })
    return { success: false, error: e.message || 'Managed backup failed.', jsonPath, excelPath }
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.boroko.bookings')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Init DB
  await db.initDatabase()

  // Start recurring financial validation (every 2 hours while app is open)
  setInterval(() => {
    db.runScheduledFinancialValidation('scheduled').catch((err) => {
      console.warn('[Financial Validation] Scheduled run failed:', err?.message || err)
    })
  }, 2 * 60 * 60 * 1000)

  // ── Auth ──────────────────────────────────────────────────────────────────
  ipcMain.handle('auth:login', async (_, email, password) => {
    try {
      console.log('\n[AUTH LOGIN ATTEMPT]')
      console.log('Email:', email)
      console.log('[AUTH TRACE] main auth:login input', {
        email,
        normalizedEmail: String(email || '').trim().toLowerCase(),
        passwordLength: typeof password === 'string' ? password.length : null,
        hasPassword: typeof password === 'string' ? password.length > 0 : false
      })

      // Master admin check
      let masterAdmin = null
      try {
        masterAdmin = await db.checkMasterAdmin(email, password)
        console.log('[AUTH] Master admin result:', masterAdmin ? 'FOUND' : 'NOT FOUND')
      } catch (err) {
        console.error('[AUTH] Master admin check failed:', err.message)
      }

      if (masterAdmin) {
        console.log('[AUTH] Logging in as MASTER ADMIN')
        db.clearBackendSession()
        db.setCurrentUser(masterAdmin)
        db.runScheduledFinancialValidation('startup').catch(() => {})
        const nonce = db.createSessionNonce(masterAdmin)
        return { ok: true, code: null, user: masterAdmin, mode: 'online', nonce }
      }

      // Regular user login
      console.log('[AUTH] Trying regular user login...')
      const result = await db.loginUser(email, password)

      console.log('[AUTH] loginUser result:', result)
      console.log('[AUTH TRACE] main auth:login result', result)

      if (result?.user) {
        console.log('[AUTH] SUCCESS - user found:', result.user.email)
        db.setCurrentUser(result.user)
        db.runScheduledFinancialValidation('startup').catch(() => {})
        const nonce = db.createSessionNonce(result.user)

        return {
          ok: true,
          code: null,
          user: result.user,
          mode: result.mode,
          warning: result.warning,
          nonce
        }
      }

      console.warn('[AUTH] FAILED:', result?.error)

      return { ok: false, code: result?.code || 'sign_in_failed', error: result?.error || 'Sign-in failed.' }
    } catch (err) {
      console.error('[AUTH DEBUG][MAIN ERROR]', {
        message: err?.message,
        code: err?.code,
        stack: err?.stack
      })
      console.error('[AUTH TRACE] main auth:login result', {
        ok: false,
        code: err?.code || 'auth_ipc_failed',
        error: err?.message || 'Main process login failed'
      })
      return {
        ok: false,
        code: err?.code || 'auth_ipc_failed',
        error: err?.message || 'Main process login failed'
      }
    }
  })

  ipcMain.handle('auth:healthCheck', async (_, email) => {
    try { return await db.runAuthHealthCheck(email) }
    catch (e) { return { ok: false, code: 'health_check_failed', error: e.message || 'Could not validate auth health.', online: false } }
  })

  // Restores main-process session using a nonce issued during login.
  // Identity is derived from the nonce file — renderer cannot influence which user is restored.
  ipcMain.handle('auth:restoreSession', (_, nonce) => {
    try {
      const restored = db.restoreUserSession(nonce)
      if (restored) db.runScheduledFinancialValidation('startup').catch(() => {})
      return restored
    } catch { return null }
  })

  ipcMain.handle('auth:validateSession', async () => {
    try { return await db.validateCurrentSession() } catch { return null }
  })

  // Clears main-process session on logout
  ipcMain.handle('auth:logout', () => {
    try { db.restoreUserSession(null); return { ok: true } } catch { return { ok: true } }
  })

  // ── Lodge Profiles ────────────────────────────────────────────────────────
  ipcMain.handle('profiles:list', async () => {
    try { return db.getProfiles() }
    catch { return [] }
  })
  ipcMain.handle('profiles:getActive', async () => {
    try { return db.getActiveProfile() }
    catch { return null }
  })
  ipcMain.handle('profiles:select', async (_, lodgeId) => {
    try { return { success: true, data: await db.selectProfile(lodgeId) } }
    catch (e) { return { success: false, error: e.message || 'Could not switch lodge.' } }
  })
  ipcMain.handle('profiles:createDraft', async () => {
    try { return { success: true, data: await db.createDraftProfile() } }
    catch (e) { return { success: false, error: e.message || 'Could not create a new lodge profile.' } }
  })
  ipcMain.handle('profiles:removeDraft', async (_, lodgeId) => {
    try { return await db.removeDraftProfile(lodgeId) }
    catch (e) { return { success: false, code: e.code || 'remove_draft_failed', error: e.message || 'Could not remove the draft lodge.' } }
  })

  // ── Role enforcement helper ────────────────────────────────────────────────
  function requireRole(...roles) {
    const user = db.getCurrentUser()
    if (!user) throw new Error('Not authenticated')
    if (user.isMasterAdmin) return
    if (roles.length > 0 && !roles.includes(normalizeAppRole(user.role))) {
      throw new Error('Unauthorized')
    }
  }

  function requireCurrentLodgeOrSuperAdmin(targetLodgeId) {
    const user = db.getCurrentUser()
    if (normalizeAppRole(user?.role) === 'super_admin') return

    const activeProfile = db.getActiveProfile?.()
    const currentLodgeId = String(activeProfile?.lodge_id || '').trim().toLowerCase()
    const requestedLodgeId = String(targetLodgeId || '').trim().toLowerCase()

    if (currentLodgeId && requestedLodgeId && currentLodgeId === requestedLodgeId) {
      return
    }

    throw new Error('Unauthorized')
  }

  async function getAccessSnapshot() {
    const user = db.getCurrentUser()
    if (!user) throw new Error('Not authenticated')
    if (user.isMasterAdmin) {
      return buildCapabilitySnapshot({ isMasterAdmin: true })
    }

    const activeProfile = db.getActiveProfile?.()
    const currentLodgeId = activeProfile?.lodge_id
    const entitlement = currentLodgeId
      ? await db.getTrialStatus(currentLodgeId)
      : { effective_features: {} }

    return {
      ...buildCapabilitySnapshot({
        role: normalizeAppRole(user.role),
        features: entitlement?.effective_features || {}
      }),
      entitlement
    }
  }

  async function requireFeature(featureName) {
    const user = db.getCurrentUser()
    if (!user) throw new Error('Not authenticated')
    if (user.isMasterAdmin || normalizeAppRole(user?.role) === 'super_admin') return

    const activeProfile = db.getActiveProfile?.()
    const currentLodgeId = activeProfile?.lodge_id
    if (!currentLodgeId) throw new Error('No active lodge profile selected')

    const entitlement = await db.getTrialStatus(currentLodgeId)
    if (entitlement?.expired) {
      throw new Error('This subscription has expired. Activate or renew the lodge license to continue.')
    }

    if (featureName && entitlement?.effective_features?.[featureName] === false) {
      throw new Error('This feature is not included in the current subscription plan.')
    }
  }

  async function requireCapability(capabilityName, errorMessage) {
    const snapshot = await getAccessSnapshot()
    if (!capabilityName || snapshot?.capabilities?.[capabilityName] === true) return snapshot

    if (snapshot?.blockedByFeature?.[capabilityName]) {
      throw new Error(errorMessage || 'This action is not included in the current subscription plan.')
    }

    throw new Error(errorMessage || 'Your role does not have access to this action.')
  }

  // ── Master Admin Setup ─────────────────────────────────────────────────────
  ipcMain.handle('admin:exists', async () => db.masterAdminExists().catch(() => false))
  ipcMain.handle('admin:setup', async (_, name, email, password) => {
    try { return await db.createMasterAdmin(name, email, password) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Admin: Company & License Management ───────────────────────────────────
  ipcMain.handle('admin:getCompanies', async () => {
    try { requireRole('super_admin'); return await db.getAllCompanies() }
    catch { return [] }
  })
  ipcMain.handle('admin:getLicenses', async () => {
    try { requireRole('super_admin'); return await db.getLicenses() }
    catch { return [] }
  })
  ipcMain.handle('admin:createLicense', async (_, data) => {
    try { requireRole('super_admin'); return await db.createLicense(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:issueSubscriptionContract', async (_, payload) => {
    try { requireRole('super_admin'); return await db.issueSubscriptionContract(payload || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateLicense', async (_, id, updates) => {
    try { requireRole('super_admin'); return await db.updateLicense(id, updates) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:deleteLicense', async (_, id) => {
    try { requireRole('super_admin'); return await db.deleteLicense(id) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Admin: Broadcasts ─────────────────────────────────────────────────────
  ipcMain.handle('admin:getBroadcasts', async () => {
    try { requireRole('super_admin'); return await db.getBroadcasts() }
    catch { return [] }
  })
  ipcMain.handle('admin:getActiveBroadcasts', async () => db.getActiveBroadcasts().catch(() => []))
  ipcMain.handle('admin:createBroadcast', async (_, data) => {
    try {
      requireRole('super_admin')
      return await db.createBroadcast(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateBroadcast', async (_, id, data) => {
    try {
      requireRole('super_admin')
      return await db.updateBroadcast(id, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:deleteBroadcast', async (_, id) => {
    try {
      requireRole('super_admin')
      return await db.deleteBroadcast(id)
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Admin: Feature Flags ──────────────────────────────────────────────────
  ipcMain.handle('admin:getLodgeFeatures', async (_, lodgeId) => {
    try { requireCurrentLodgeOrSuperAdmin(lodgeId); return await db.getLodgeFeatures(lodgeId) }
    catch { return [] }
  })
  ipcMain.handle('admin:setLodgeFeature', async (_, lodgeId, name, enabled, metadata) => {
    try {
      requireRole('super_admin')
      return await db.setLodgeFeature(lodgeId, name, enabled, metadata || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:clearLodgeFeature', async (_, lodgeId, name) => {
    try {
      requireRole('super_admin')
      return await db.clearLodgeFeature(lodgeId, name)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getAllLodgeFeatures', async () => {
    try { requireRole('super_admin'); return await db.getAllLodgeFeatures() }
    catch { return [] }
  })
  ipcMain.handle('admin:getTestDataResetPreview', async (_, lodgeId, payload) => {
    try {
      requireRole('super_admin')
      return await db.getTestDataResetPreview(lodgeId, payload || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:runTestDataReset', async (_, lodgeId, payload) => {
    try {
      requireRole('super_admin')
      return await db.runTestDataReset(lodgeId, payload || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getTestDataResetAudit', async (_, lodgeId, limit) => {
    try {
      requireRole('super_admin')
      return await db.getTestDataResetAudit(lodgeId, limit || 20)
    } catch { return [] }
  })

  // ── Admin: Support Tickets ────────────────────────────────────────────────
  ipcMain.handle('admin:getSupportTickets', async (_, filters) => {
    try { requireRole('super_admin'); return await db.getSupportTickets(filters || {}) }
    catch { return [] }
  })
  ipcMain.handle('admin:createSupportTicket', async (_, data) => {
    try {
      requireRole()
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
    try { requireRole('super_admin'); return await db.updateSupportTicket(id, updates) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:deleteSupportTicket', async (_, id) => {
    try { requireRole('super_admin'); return await db.deleteSupportTicket(id) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Admin: Activity Logs ──────────────────────────────────────────────────
  ipcMain.handle('admin:getActivityLogs', async (_, filters) => {
    try { requireRole('super_admin'); return await db.getActivityLogs(filters || {}) }
    catch { return [] }
  })

  // ── Admin: Company Stats ──────────────────────────────────────────────────
  ipcMain.handle('admin:getCompanyStats', async (_, lodgeId) => {
    try { requireRole('super_admin'); return await db.getCompanyStats(lodgeId) }
    catch { return null }
  })

  // ── Admin: Billing ────────────────────────────────────────────────────────
  ipcMain.handle('admin:updateLicenseBilling', async (_, id, data) => {
    try { requireRole('super_admin'); return await db.updateLicenseBilling(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getOverdueLicenses', async () => {
    try { requireRole('super_admin'); return await db.getOverdueLicenses() }
    catch { return [] }
  })

  // ── Invoices ──────────────────────────────────────────────────────────────
  ipcMain.handle('admin:getNextInvoiceNumber', async () => {
    try { requireRole('super_admin'); return await db.getNextInvoiceNumber() }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('admin:createInvoice', async (_, data) => {
    try { requireRole('super_admin'); return await db.createInvoice(data) }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('admin:getInvoices', async (_, filters) => {
    try { requireRole('super_admin'); return await db.getInvoices(filters) }
    catch { return [] }
  })
  ipcMain.handle('admin:getInvoicesByLodge', async (_, lodgeId) => {
    try { requireRole('super_admin'); return await db.getInvoicesByLodge(lodgeId) }
    catch { return [] }
  })
  ipcMain.handle('admin:updateInvoice', async (_, id, data) => {
    try { requireRole('super_admin'); return await db.updateInvoice(id, data) }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('admin:deleteInvoice', async (_, id) => {
    try { requireRole('super_admin'); await db.deleteInvoice(id); return { success: true } }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('admin:getInvoiceSummary', async () => {
    try { requireRole('super_admin'); return await db.getInvoiceSummary() }
    catch { return { total: 0, byPlan: {}, byMonth: [], allRows: [] } }
  })
  ipcMain.handle('admin:updateCompany', async (_, lodgeId, updates) => {
    try { requireRole('super_admin'); await db.updateCompany(lodgeId, updates); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getCompanyUsers', async (_, lodgeId) => {
    try { requireRole('super_admin'); return await db.getCompanyUsers(lodgeId) }
    catch { return [] }
  })
  ipcMain.handle('admin:resetCompanyUserPassword', async (_, lodgeId, userId, password) => {
    try { requireRole('super_admin'); return await db.resetCompanyUserPassword(lodgeId, userId, password) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateCompanyUserPwaAccess', async (_, lodgeId, userId, payload) => {
    try { requireRole('super_admin'); return await db.updateCompanyUserPwaAccess(lodgeId, userId, payload || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:sendInvoiceEmail', async (_, payload) => {
    try { requireRole('super_admin'); return await sendInvoiceEmail(payload) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('trial:getInvoices', async (_, lodgeId) => {
    try {
      requireCurrentLodgeOrSuperAdmin(lodgeId)
      await requireCapability('settings.manage_subscription')
      return await db.getInvoicesByLodge(lodgeId)
    }
    catch { return [] }
  })
  ipcMain.handle('invoices:getBookingInvoices', async () => {
    try {
      await requireCapability('invoices.view')
      return await db.getBookingInvoices()
    } catch {
      return []
    }
  })
  ipcMain.handle('invoices:sendBookingInvoiceEmail', async (_, invoice) => {
    try {
      await requireCapability('invoices.send')
      if (invoice?.booking_id) {
        await assertResourceBelongsToCurrentLodge('Booking', invoice.booking_id, db.getBookingById)
      }
      return await sendBookingInvoiceEmailWithAudit(invoice)
    } catch (e) {
      await recordFailedInvoiceDelivery(invoice, e.message || 'Could not send invoice email')
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('invoices:recordDelivery', async (_, payload = {}) => {
    try {
      await requireCapability('invoices.send')
      if (payload?.booking_id) {
        await assertResourceBelongsToCurrentLodge('Booking', payload.booking_id, db.getBookingById)
      }
      return await db.recordInvoiceDelivery(payload || {})
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('reports:invoiceDeliveryHistory', async (_, payload = {}) => {
    try {
      await requireCapability('invoices.view')
      return await db.getInvoiceDeliveryHistory(payload || {})
    } catch (e) { throw new Error(e?.message || 'Failed to load invoice delivery history') }
  })
  ipcMain.handle('reports:financialAudit', async (_, payload = {}) => {
    try {
      await requireCapability('reports.view')
      return await db.getFinancialAuditLog(payload || {})
    } catch (e) { throw new Error(e?.message || 'Failed to load financial audit log') }
  })
  ipcMain.handle('reports:financialReconciliation', async () => {
    try {
      await requireCapability('reports.view')
      return await db.getFinancialReconciliation()
    } catch (e) { throw new Error(e?.message || 'Failed to load reconciliation summary') }
  })
  ipcMain.handle('reports:financialValidation', async () => {
    try {
      await requireCapability('reports.view')
      return await db.getFinancialValidationSummary()
    } catch (e) { throw new Error(e?.message || 'Failed to load financial validation summary') }
  })
  ipcMain.handle('reports:financialValidationRuns', async (_, limit = 30) => {
    try {
      await requireCapability('reports.view')
      return await db.getFinancialValidationRuns(limit)
    } catch (e) { throw new Error(e?.message || 'Failed to load financial validation history') }
  })
  ipcMain.handle('reports:financialValidationAlerts', async (_, limit = 30) => {
    try {
      await requireCapability('reports.view')
      return db.getFinancialValidationAlerts(limit)
    } catch (e) { throw new Error(e?.message || 'Failed to load financial validation alerts') }
  })
  ipcMain.handle('reports:criticalErrors', async (_, limit = 100) => {
    try {
      await requireCapability('system.health')
      return db.getCriticalErrorLog(limit)
    } catch (e) { throw new Error(e?.message || 'Failed to load critical error history') }
  })
  ipcMain.handle('reports:saveSupportBundle', async (event, limit = 20) => {
    try {
      await requireCapability('system.health')
      const win = BrowserWindow.fromWebContents(event.sender)
      const today = new Date().toISOString().slice(0, 10)
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Support Bundle',
        defaultPath: `boroko-support-bundle-${today}.json`,
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { success: false }

      const payload = {
        ...(await db.getSupportBundle(limit)),
        renderer_errors: getRendererErrorLog(limit)
      }
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
      return { success: true, filePath: result.filePath }
    } catch (e) {
      return { success: false, error: e?.message || 'Failed to export support bundle' }
    }
  })
  ipcMain.handle('reports:runFinancialValidation', async () => {
    try {
      await requireCapability('system.health')
      return await db.runFinancialValidation({ triggerSource: 'manual' })
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Email Notifications ───────────────────────────────────────────────────
  ipcMain.handle('email:getConfig', () => {
    const config = getEmailConfig()
    if (!config) return null
    // Mask password before sending to renderer
    return { ...config, pass: config.pass ? '••••••••' : '' }
  })
  ipcMain.handle('email:saveConfig', async (_, config) => {
    requireRole('admin', 'super_admin')
    // If pass is masked (user didn't change it), keep existing password
    if (config.pass === '••••••••') {
      const existing = getEmailConfig()
      config.pass = existing?.pass || ''
    }
    return saveEmailConfig(config)
  })
  ipcMain.handle('email:test', async (_, config) => {
    requireRole('admin', 'super_admin')
    // Unmask pass if needed
    if (config.pass === '••••••••') {
      const existing = getEmailConfig()
      config.pass = existing?.pass || ''
    }
    return testEmailConfig(config)
  })
  ipcMain.handle('email:sendLicense', async (_, payload) => {
    try { requireRole('super_admin'); return await sendLicenseEmail(payload) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Users ─────────────────────────────────────────────────────────────────
  ipcMain.handle('users:getAll', async () => {
    try { await requireCapability('staff.view'); return await db.getAllUsers() }
    catch { return [] }
  })
  ipcMain.handle('users:create', async (_, data) => {
    try {
      await requireCapability('staff.manage')
      if (data?.role && normalizeAppRole(data.role) !== 'receptionist') {
        await requireCapability('staff.permissions')
      }
      return { success: true, id: await db.createUser(data) }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('users:update', async (_, id, data) => {
    try {
      await requireCapability('staff.manage')
      if (data?.role) {
        await requireCapability('staff.permissions')
      }
      await assertResourceBelongsToCurrentLodge('User', id, db.getUserById)
      await db.updateUser(id, data); return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('users:resetPassword', async (_, id, password) => {
    try {
      await requireCapability('staff.manage')
      await assertResourceBelongsToCurrentLodge('User', id, db.getUserById)
      await db.resetUserPassword(id, password); return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('users:delete', async (_, id) => {
    try {
      await requireCapability('staff.manage')
      await assertResourceBelongsToCurrentLodge('User', id, db.getUserById)
      await db.deleteUser(id); return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Rooms ─────────────────────────────────────────────────────────────────
  ipcMain.handle('rooms:getAll', async () => {
    try { await requireCapability('rooms.view'); return await db.getAllRooms() }
    catch { return [] }
  })
  ipcMain.handle('rooms:create', async (_, data) => {
    try {
      await requireCapability('rooms.manage')
      return { success: true, id: await db.createRoom(data) }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rooms:update', async (_, id, data) => {
    try {
      await requireCapability('rooms.manage')
      await assertResourceBelongsToCurrentLodge('Room', id, db.getRoomById)
      await db.updateRoom(id, data); return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rooms:delete', async (_, id) => {
    try {
      await requireCapability('rooms.manage')
      await assertResourceBelongsToCurrentLodge('Room', id, db.getRoomById)
      await db.deleteRoom(id); return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rooms:updateHousekeeping', async (_, id, status, notes) => {
    try { await requireCapability('housekeeping.manage'); await assertResourceBelongsToCurrentLodge('Room', id, db.getRoomById); await db.updateRoomHousekeeping(id, status, notes); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Customers ─────────────────────────────────────────────────────────────
  ipcMain.handle('customers:getAll', async () => {
    try { await requireCapability('guests.view'); return await db.getAllCustomers() }
    catch { return [] }
  })
  ipcMain.handle('customers:create', async (_, data) => {
    try {
      await requireCapability('guests.manage')
      return { success: true, id: await db.createCustomer(data) }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('customers:update', async (_, id, data) => {
    try {
      await requireCapability('guests.manage')
      await assertResourceBelongsToCurrentLodge('Customer', id, db.getCustomerById)
      await db.updateCustomer(id, data); return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('customers:updateBlacklist', async (_, id, is_blacklisted, reason) => {
    try {
      await requireCapability('guests.blacklist')
      await assertResourceBelongsToCurrentLodge('Customer', id, db.getCustomerById)
      await db.updateCustomerBlacklist(id, is_blacklisted, reason); return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('customers:getBookings', async (_, id) => {
    try { await requireCapability('guests.view'); await assertResourceBelongsToCurrentLodge('Customer', id, db.getCustomerById); return await db.getCustomerBookings(id) }
    catch { return [] }
  })

  // ── Bookings ──────────────────────────────────────────────────────────────
  ipcMain.handle('bookings:getAll', async () => {
    try { await requireCapability('bookings.view'); return await db.getAllBookings() }
    catch { return [] }
  })
  ipcMain.handle('bookings:getPendingOnline', async () => {
    try {
      await requireCapability('bookings.view')
      return await db.getPendingOnlineBookings()
    }
    catch { return [] }
  })
  ipcMain.handle('bookings:getByDateRange', async (_, start, end) =>
    requireCapability('bookings.view').then(() => db.getBookingsByDateRange(start, end)).catch(() => [])
  )
  ipcMain.handle('bookings:create', async (_, data) => {
    try {
      await requireCapability('bookings.manage')
      const id = await db.createBooking(data)
      notifyLodge(data.lodge_id, '📋 New booking created', `Guest arriving ${data.check_in || ''}`)
      return { success: true, id }
    } catch (e) {
      if (e.code === 'DEPOSIT_FAILED') {
        notifyLodge(data.lodge_id, '📋 New booking created', `Guest arriving ${data.check_in || ''}`)
        return { success: true, id: e.booking_id, depositWarning: e.message }
      }
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('bookings:update', async (_, id, data) => {
    try {
      await requireCapability('bookings.manage')
      await assertResourceBelongsToCurrentLodge('Booking', id, db.getBookingById)
      await db.updateBooking(id, data)
      return { success: true }
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('bookings:updateStatus', async (_, id, status) => {
    try {
      await requireCapability('bookings.manage')
      await assertResourceBelongsToCurrentLodge('Booking', id, db.getBookingById)
      await db.updateBookingStatus(id, status)
      maybeSendBookingLifecycleEmails(id, status).catch(() => {})
      return { success: true }
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('bookings:updatePayment', async (_, id, amount, method, intentKey) => {
    try {
      await requireCapability('payments.record')
      await assertResourceBelongsToCurrentLodge('Booking', id, db.getBookingById)
      await db.updateBookingPayment(id, amount, method, 'payment', null, intentKey)
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('bookings:getPayments', async (_, bookingId) => {
    try {
      await requireCapability('invoices.view')
      await assertResourceBelongsToCurrentLodge('Booking', bookingId, db.getBookingById)
      return await db.getBookingPayments(bookingId)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('bookings:refund', async (_, bookingId, payload) => {
    try {
      await requireCapability('payments.refund')
      await assertResourceBelongsToCurrentLodge('Booking', bookingId, db.getBookingById)
      return await db.refundBooking(bookingId, payload)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('bookings:createEvent', async (_, data) => {
    try {
      await requireCapability('bookings.manage')
      return { success: true, ...(await db.createEventBooking(data)) }
    } catch (e) {
      if (e.code === 'DEPOSIT_FAILED') {
        // Room bookings were created — only deposit recording failed.
        // Return success so the operator knows the event exists; depositWarning signals action needed.
        notifyLodge(data.lodge_id, '📋 Event booking created', `${data.event_name || ''} — deposit not recorded`)
        return { success: true, depositWarning: e.message }
      }
      return { success: false, error: e.message }
    }
  })

  // ── Quotations ────────────────────────────────────────────────────────────
  ipcMain.handle('quotations:getAll', async () => {
    try { await requireCapability('quotations.view'); return await db.getAllQuotations() }
    catch (e) {
      console.error('quotations:getAll failed:', e)
      throw new Error(e?.message || 'Failed to load quotations')
    }
  })
  ipcMain.handle('quotations:create', async (_, data) => {
    try {
      await requireCapability('quotations.manage')
      const result = await db.createQuotation(data)
      return { success: true, ...result }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('quotations:update', async (_, id, data) => {
    try {
      await requireCapability('quotations.manage')
      await assertResourceBelongsToCurrentLodge('Quotation', id, db.getQuotationById)
      const previousQuotation = (await db.getAllQuotations().catch(() => [])).find((entry) => entry.id === id)
      await db.updateQuotation(id, data)
      if (String(data?.status || '').toLowerCase() === 'sent') {
        maybeSendQuotationEmail(id, previousQuotation?.status || '').catch(() => {})
      }
      return { success: true }
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('quotations:convert', async (_, quotationId, depositAmount, paymentMethod) => {
    try {
      await requireCapability('quotations.manage')
      await assertResourceBelongsToCurrentLodge('Quotation', quotationId, db.getQuotationById)
      const result = await db.convertQuotationToBooking(quotationId, depositAmount, paymentMethod)
      return { success: true, ...result }
    } catch (e) {
      if (e.code === 'DEPOSIT_FAILED') {
        return { success: true, booking_id: e.booking_id, invoice_number: e.invoice_number, depositWarning: e.message }
      }
      return { success: false, error: e.message }
    }
  })

  // ── Reports ───────────────────────────────────────────────────────────────
  ipcMain.handle('reports:occupancy', async (_, start, end) => {
    try { await requireCapability('reports.view'); return await db.getOccupancyReport(start, end) }
    catch (e) { throw new Error(e?.message || 'Failed to load occupancy report') }
  })
  ipcMain.handle('reports:revenue', async (_, start, end) => {
    try { await requireCapability('reports.view'); return await db.getRevenueReport(start, end) }
    catch (e) { throw new Error(e?.message || 'Failed to load revenue report') }
  })
  ipcMain.handle('reports:snapshot', async (_, today) => {
    try { await requireCapability('reports.view'); return await db.getReportsSnapshot(today) }
    catch (e) { throw new Error(e?.message || 'Failed to load reports snapshot') }
  })
  ipcMain.handle('reports:profitLoss', async (_, start, end) => {
    try { await requireCapability('reports.view'); return await db.getProfitLoss(start, end) }
    catch (e) { throw new Error(e?.message || 'Failed to load profit and loss report') }
  })
  ipcMain.handle('reports:outletProfitLoss', async (_, start, end) => {
    try {
      await requireCapability('reports.view')
      await requireCapability('pos.combined_reports')
      return await db.getOutletProfitLoss(start, end)
    } catch (e) { console.error('reports:outletProfitLoss failed:', e); throw new Error(e?.message || 'Failed to load outlet profit and loss report') }
  })
  ipcMain.handle('dashboard:bookingPaymentsToday', async () => {
    try { return await db.getTodayBookingPaymentMix() }
    catch { return { total_collected: 0, by_method: {}, payment_count: 0, date: null } }
  })
  ipcMain.handle('requests:getAll', async (_, limit) => {
    try {
      requireRole('receptionist', 'manager', 'admin', 'super_admin')
      return await db.getLodgeSupportTickets(limit)
    } catch {
      return []
    }
  })
  ipcMain.handle('requests:update', async (_, id, updates) => {
    try {
      requireRole('receptionist', 'manager', 'admin', 'super_admin')
      await assertResourceBelongsToCurrentLodge('Support request', id, db.getLodgeSupportTicketById)
      return await db.updateLodgeSupportTicket(id, updates || {})
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('reports:roomProfitability', async (_, start, end) => {
    try { await requireCapability('reports.view'); return await db.getRoomProfitabilityReport(start, end) }
    catch (e) { console.error('reports:roomProfitability failed:', e); throw new Error(e?.message || 'Failed to load room profitability report') }
  })
  ipcMain.handle('dashboard:stats', async () => {
    try { await requireCapability('dashboard.view'); return await db.getDashboardStats() }
    catch { return null }
  })
  ipcMain.handle('reports:savePDF', async (event) => {
    await requireCapability('reports.view')
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
  ipcMain.handle('notifications:today', async () => {
    try { await requireCapability('dashboard.view'); return await db.getTodayActivity() }
    catch { return [] }
  })
  ipcMain.handle('notifications:upcoming', async () => {
    try { await requireCapability('dashboard.view'); return await db.getUpcomingCheckins() }
    catch { return [] }
  })

  ipcMain.handle('db:getSyncStatus', async () => { try { return db.getSyncStatus() } catch (e) { return { pending: 0, failed: 0, isOnline: false, failedBookingIds: [] } } })

  // ── Shell ─────────────────────────────────────────────────────────────────
  ipcMain.handle('shell:openExternal', async (_, url) => {
    if (!isSafeExternalUrl(url)) return { success: false, error: 'Blocked: unsafe URL protocol' }
    await shell.openExternal(url)
    return { success: true }
  })

  // ── Excel Export ──────────────────────────────────────────────────────────
  ipcMain.handle('reports:saveExcel', async (event, { occupancy, revenue, expenses, posSales, invSpend, supSpend, profitLoss, start, end, currency }) => {
    await requireCapability('reports.view')
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
      const revRows = [
        ['Boroko Bookings — Revenue Report'],
        [`Period: ${start}  to  ${end}`],
        [],
        ['Metric', 'Value'],
        ['Total Revenue',      `${sym} ${Number(revenue?.total_revenue || 0).toFixed(2)}`],
        ['Regular Bookings',   (revenue?.total_bookings || 0) - (revenue?.event_count || 0)],
        ['Exclusive Events',   revenue?.event_count || 0],
        ['Total Bookings',     revenue?.total_bookings || 0],
        ['Avg Booking Value',  `${sym} ${Number(revenue?.avg_booking_value || 0).toFixed(2)}`],
      ]
      if ((revenue?.event_count || 0) > 0) {
        revRows.push([], ['EXCLUSIVE EVENTS'])
        revRows.push(['Event', 'Dates', 'Nights', 'Rooms', `Daily Rate (${sym})`, `Total (${sym})`])
        ;(revenue.event_bookings || []).forEach((evt, i) => {
          revRows.push([
            `Event ${i + 1}`,
            `${evt.check_in} → ${evt.check_out}`,
            evt.nights,
            evt.room_count,
            Number(evt.daily_rate).toFixed(2),
            Number(evt.total).toFixed(2)
          ])
        })
        revRows.push(['Event Revenue Total', '', '', '', '', `${sym} ${Number(revenue.event_revenue || 0).toFixed(2)}`])
      }
      if (revenue?.vat_enabled) {
        revRows.push([], ['VAT BREAKDOWN'])
        revRows.push([`VAT Rate`, `${revenue.vat_rate}%`])
        revRows.push([`VAT Amount (inclusive)`, `${sym} ${Number(revenue.vat_amount || 0).toFixed(2)}`])
        revRows.push([`Net Revenue (excl. VAT)`, `${sym} ${Number(revenue.net_revenue || 0).toFixed(2)}`])
      }
      revRows.push(
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
        ['Net Cash Collected', `${sym} ${Number(revenue?.paid_revenue      || 0).toFixed(2)}`],
        ['Gross Cash Received',`${sym} ${Number(revenue?.gross_collected   || 0).toFixed(2)}`],
        ['Refunds Issued',     `${sym} ${Number(revenue?.refunds_issued    || 0).toFixed(2)}`],
        ['Outstanding',        `${sym} ${Number(revenue?.outstanding_amount || 0).toFixed(2)}`]
      )
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(revRows), 'Revenue Summary')

      // Room Occupancy sheet
      const occRows = [
        ['Room Occupancy Report'],
        [`Period: ${start}  to  ${end}  (${totalDays} days)`],
        [],
        ['Room', 'Type', `Rate/Night (${sym})`, 'Nights Occupied', 'Total Period Days', 'Occupancy %', `Revenue (${sym})`, 'Note'],
        ...(occupancy || []).map((r) => [
          `Room ${r.room_number}`,
          r.room_type,
          Number(r.rate_per_night).toFixed(2),
          r.occupied_nights,
          totalDays,
          `${r.occupancy_rate}%`,
          Number(r.actual_revenue || 0).toFixed(2),
          r.has_event ? 'Incl. exclusive event' : ''
        ])
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(occRows), 'Room Occupancy')

      // Expenses sheet
      if (expenses && expenses.length > 0) {
        const expRows = [
          ['Expenses Report'],
          [`Period: ${start}  to  ${end}`],
          [],
          ['Date', 'Category', 'Description', `Amount (${sym})`],
          ...expenses.map(e => [e.date || '', e.category || '', e.description || '', Number(e.amount || 0).toFixed(2)]),
          [],
          ['TOTAL', '', '', expenses.reduce((s, e) => s + Number(e.amount || 0), 0).toFixed(2)]
        ]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expRows), 'Expenses')
      }

      // POS Sales sheet
      if (posSales) {
        const posRows = [
          ['POS Sales Report'],
          [`Period: ${start}  to  ${end}`],
          [],
          ['Metric', 'Value'],
          ['Total Revenue',  `${sym} ${Number(posSales.total_revenue || 0).toFixed(2)}`],
          ['Total Orders',   posSales.total_orders || 0],
          ['Avg Order Value',`${sym} ${Number(posSales.avg_order || 0).toFixed(2)}`],
        ]
        if (posSales.by_payment && Object.keys(posSales.by_payment).length > 0) {
          posRows.push([], ['PAYMENT METHOD BREAKDOWN'])
          for (const [method, amt] of Object.entries(posSales.by_payment)) {
            posRows.push([method, `${sym} ${Number(amt).toFixed(2)}`])
          }
        }
        if (posSales.top_items && posSales.top_items.length > 0) {
          posRows.push([], ['TOP SELLING ITEMS'], ['Item', 'Qty Sold', `Revenue (${sym})`])
          for (const item of posSales.top_items) {
            posRows.push([item.item_name, item.qty, Number(item.revenue || 0).toFixed(2)])
          }
        }
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(posRows), 'POS Sales')
      }

      // Stock Costs sheet
      if (invSpend || supSpend) {
        const costRows = [
          ['Stock Costs Report'],
          [`Period: ${start}  to  ${end}`],
          [],
          ['Category', `Amount (${sym})`],
          ['Inventory Purchases', Number(invSpend?.total || 0).toFixed(2)],
          ['Room Supplies', Number(supSpend?.total || 0).toFixed(2)],
          ['TOTAL', (Number(invSpend?.total || 0) + Number(supSpend?.total || 0)).toFixed(2)],
        ]
        if (invSpend?.by_category && Object.keys(invSpend.by_category).length > 0) {
          costRows.push([], ['INVENTORY BY CATEGORY'])
          for (const [cat, amt] of Object.entries(invSpend.by_category)) {
            costRows.push([cat, Number(amt).toFixed(2)])
          }
        }
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(costRows), 'Stock Costs')
      }

      // P&L Summary sheet
      if (profitLoss) {
        const pl = profitLoss
        const plRows = [
          ['Profit & Loss Statement'],
          [`Period: ${start}  to  ${end}`],
          [],
          ['REVENUE', `${sym}`],
          ['Booking Revenue',  Number(pl.bookingRevenue || 0).toFixed(2)],
          ['POS Revenue',      Number(pl.posRevenue || 0).toFixed(2)],
          ['Total Revenue',    Number(pl.totalRevenue || 0).toFixed(2)],
        ]
        if (pl.vatEnabled) {
          plRows.push([`VAT (${pl.vatRate}% inclusive)`, `-${Number(pl.vatAmount || 0).toFixed(2)}`])
          plRows.push(['Net Revenue (excl. VAT)', Number(pl.netRevenue || 0).toFixed(2)])
        }
        plRows.push(
          [],
          ['EXPENSES', ''],
          ['Operating Expenses', Number(pl.totalExpenses || 0).toFixed(2)],
          ['Stock Costs',        Number(pl.totalCosts || 0).toFixed(2)],
          ['Total Outgoings',    Number((pl.totalExpenses || 0) + (pl.totalCosts || 0)).toFixed(2)],
          [],
          ['GROSS PROFIT', Number(pl.grossProfit || 0).toFixed(2)]
        )
        if (pl.expByCategory && Object.keys(pl.expByCategory).length > 0) {
          plRows.push([], ['EXPENSE BREAKDOWN'])
          for (const [cat, amt] of Object.entries(pl.expByCategory)) {
            plRows.push([cat, Number(amt).toFixed(2)])
          }
        }
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plRows), 'P&L')
      }

      XLSX.writeFile(wb, filePath)
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ── Full Data Export ───────────────────────────────────────────────────────
  ipcMain.handle('data:exportAll', async (event) => {
    await requireCapability('data.import')
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      const today = new Date().toISOString().split('T')[0]
      const { filePath, canceled } = await dialog.showSaveDialog(win, {
        title: 'Export All Lodge Data',
        defaultPath: `lodge-data-export-${today}.xlsx`,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
      })
      if (canceled || !filePath) return { canceled: true }
      return await exportAllDataWorkbookToPath(filePath)
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
  ipcMain.handle('activity:getAll', async () => {
    try { await requireCapability('settings.view'); return await db.getActivityLog() }
    catch { return [] }
  })
  ipcMain.handle('activity:clear', async () => {
    try { await requireCapability('sync.manage'); db.clearActivityLog(); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Backups ───────────────────────────────────────────────────────────────
  ipcMain.handle('backup:getInfo', async () => {
    try { await requireCapability('system.health'); return await db.getBackupInfo() }
    catch { return { backups: [], backupDir: null } }
  })
  ipcMain.handle('backup:chooseTargetFolder', async (event) => {
    try {
      await requireCapability('backup.manage')
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win, {
        title: 'Choose Managed Backup Folder',
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths?.[0]) return { success: false, canceled: true }
      return { success: true, path: result.filePaths[0] }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('backup:savePolicy', async (_, updates) => {
    try {
      await requireCapability('backup.manage')
      return { success: true, policy: db.saveManagedBackupPolicy(updates || {}) }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('backup:runManagedNow', async () => {
    try {
      await requireCapability('backup.manage')
      return await runManagedBackupPolicy(true)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('backup:createManual', async () => {
    try {
      await requireCapability('backup.manage')
      return await db.createManualBackup()
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('backup:openFolder', async () => {
    const info = db.getBackupInfo()
    if (info.backupDir) {
      const fs2 = fs
      if (!fs2.existsSync(info.backupDir)) fs2.mkdirSync(info.backupDir, { recursive: true })
      await shell.openPath(info.backupDir)
    }
    return { success: true }
  })
  ipcMain.handle('backup:openManagedFolder', async () => {
    const policy = db.getManagedBackupPolicy?.()
    if (policy?.target_dir) {
      const fs2 = fs
      if (!fs2.existsSync(policy.target_dir)) fs2.mkdirSync(policy.target_dir, { recursive: true })
      await shell.openPath(policy.target_dir)
    }
    return { success: true }
  })

  // ── Booking Charges (Folio) ───────────────────────────────────────────────
  ipcMain.handle('charges:getByBooking', async (_, bookingId) => {
    try {
      await requireCapability('bookings.view')
      await assertResourceBelongsToCurrentLodge('Booking', bookingId, db.getBookingById)
      return await db.getBookingCharges(bookingId)
    }
    catch { return [] }
  })
  ipcMain.handle('charges:add', async (_, bookingId, data) => {
    try {
      requireRole('receptionist', 'manager', 'admin', 'super_admin')
      await assertResourceBelongsToCurrentLodge('Booking', bookingId, db.getBookingById)
      return await db.addBookingCharge(bookingId, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('charges:delete', async (_, id, reason) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await assertResourceBelongsToCurrentLodge('Charge', id, db.getBookingChargeById)
      return await db.deleteBookingCharge(id, reason)
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Rate Overrides (Seasonal Pricing) ────────────────────────────────────
  ipcMain.handle('rateOverrides:getAll', async () => {
    try { await requireCapability('rooms.manage'); return await db.getRateOverrides() }
    catch { return [] }
  })
  ipcMain.handle('rateOverrides:create', async (_, data) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      return await db.createRateOverride(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rateOverrides:update', async (_, id, data) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await assertResourceBelongsToCurrentLodge('Rate override', id, db.getRateOverrideById)
      return await db.updateRateOverride(id, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rateOverrides:delete', async (_, id) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await assertResourceBelongsToCurrentLodge('Rate override', id, db.getRateOverrideById)
      return await db.deleteRateOverride(id)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rateOverrides:getApplicable', async (_, roomId, checkIn, checkOut) =>
    db.getApplicableRate(roomId, checkIn, checkOut)
  )

  // ── Expenses ──────────────────────────────────────────────────────────────
  ipcMain.handle('expenses:getAll', async (_, start, end, outletId) => {
    try { await requireCapability('expenses.view'); return await db.getExpenses(start, end, outletId) }
    catch (e) {
      console.error('expenses:getAll failed:', e)
      throw new Error(e?.message || 'Failed to load expenses')
    }
  })
  ipcMain.handle('expenses:create', async (_, data) => {
    try {
      await requireCapability('expenses.manage')
      return await db.createExpense(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('expenses:update', async (_, id, data) => {
    try {
      await requireCapability('expenses.manage')
      await assertResourceBelongsToCurrentLodge('Expense', id, db.getExpenseById)
      return await db.updateExpense(id, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('expenses:delete', async (_, id) => {
    try {
      await requireCapability('expenses.manage')
      await assertResourceBelongsToCurrentLodge('Expense', id, db.getExpenseById)
      return await db.deleteExpense(id)
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Maintenance ───────────────────────────────────────────────────────────
  ipcMain.handle('maintenance:getAll', async () => {
    try { await requireCapability('maintenance.view'); return await db.getMaintenanceTickets() }
    catch { return [] }
  })
  ipcMain.handle('maintenance:create', async (_, data) => {
    try {
      await requireCapability('maintenance.manage')
      const result = await db.createMaintenanceTicket(data)
      notifyLodge(data.lodge_id, '🔧 New maintenance request', data.issue || data.description || 'A maintenance ticket was raised')
      return result
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('maintenance:update', async (_, id, data) => {
    try {
      await requireCapability('maintenance.manage')
      await assertResourceBelongsToCurrentLodge('Maintenance ticket', id, db.getMaintenanceTicketById)
      return await db.updateMaintenanceTicket(id, data)
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('maintenance:resolve', async (_, id, roomId) => {
    try {
      await requireCapability('maintenance.manage')
      await assertResourceBelongsToCurrentLodge('Maintenance ticket', id, db.getMaintenanceTicketById)
      return await db.resolveMaintenanceTicket(id, roomId)
    }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── ID Photo ──────────────────────────────────────────────────────────────
  ipcMain.handle('customers:updateIdPhoto', async (_, id, photo) => {
    try {
      requireRole()
      await assertResourceBelongsToCurrentLodge('Customer', id, db.getCustomerById)
      return await db.updateCustomerIdPhoto(id, photo)
    }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Forecast ──────────────────────────────────────────────────────────────
  ipcMain.handle('dashboard:forecast', async (_, days) => {
    try { await requireCapability('dashboard.view'); return await db.getForecast(days || 30) }
    catch { return null }
  })

  // ── Receipt PDF Save ──────────────────────────────────────────────────────
  ipcMain.handle('receipts:savePDF', async (event, guestName) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const receiptPayload = typeof guestName === 'object' && guestName !== null ? guestName : { guestName }
    const safe = (receiptPayload?.guestName || 'receipt').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Invoice as PDF',
      defaultPath: `invoice-${safe}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      const pdfBuffer = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true })
      fs.writeFileSync(result.filePath, pdfBuffer)
      db.recordInvoiceDelivery({
        booking_id: receiptPayload?.bookingId || null,
        invoice_number: receiptPayload?.invoiceNumber || null,
        delivery_type: 'receipt_pdf',
        delivery_status: 'completed',
        recipient: receiptPayload?.guestName || null,
        file_path: result.filePath,
        render_version: 'receipt-v1',
        metadata: {
          customer_name: receiptPayload?.guestName || null
        }
      }).catch(() => {})
      return { success: true, filePath: result.filePath }
    } catch (e) {
      db.recordInvoiceDelivery({
        booking_id: receiptPayload?.bookingId || null,
        invoice_number: receiptPayload?.invoiceNumber || null,
        delivery_type: 'receipt_pdf',
        delivery_status: 'failed',
        recipient: receiptPayload?.guestName || null,
        file_path: result?.filePath || null,
        render_version: 'receipt-v1',
        metadata: {
          error: e.message || 'Could not save PDF'
        }
      }).catch(() => {})
      return { success: false, error: e.message }
    }
  })

  // ── Quotation PDF Save ────────────────────────────────────────────────────
  // quotationId is used to reliably auto-set status='sent' in the backend
  ipcMain.handle('quotations:savePDF', async (event, quotationId, quotationNumber, customerName) => {
    const win      = BrowserWindow.fromWebContents(event.sender)
    const safeName = (customerName    || '').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const safeNum  = (quotationNumber || 'quotation').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const safe     = safeName ? `${safeNum}-${safeName}` : safeNum
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Quotation as PDF',
      defaultPath: `${safe}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      if (quotationId) {
        await assertResourceBelongsToCurrentLodge('Quotation', quotationId, db.getQuotationById)
      }
      const pdfBuffer = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true })
      fs.writeFileSync(result.filePath, pdfBuffer)
      // Auto-mark as 'sent' in backend — more reliable than relying on frontend
      if (quotationId) {
        const previousQuotation = (await db.getAllQuotations().catch(() => [])).find((entry) => entry.id === quotationId)
        try { await db.markQuotationSent(quotationId) } catch (_) { /* non-fatal */ }
        if (String(previousQuotation?.status || '').toLowerCase() !== 'sent') {
          maybeSendQuotationEmail(quotationId, previousQuotation?.status || '').catch(() => {})
        }
      }
      return { success: true, filePath: result.filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ── Quotation Duplicate ───────────────────────────────────────────────────
  ipcMain.handle('quotations:duplicate', async (_, id) => {
    try {
      await requireCapability('quotations.manage')
      await assertResourceBelongsToCurrentLodge('Quotation', id, db.getQuotationById)
      const result = await db.duplicateQuotation(id)
      return { success: true, ...result }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ── POS ────────────────────────────────────────────────────────────────────
  ipcMain.handle('pos:getMenuItems', async () => {
    try {
      await requireCapability('pos.view')
      const outletFilter = db.getUserPosOutletFilter()
      return await db.getPosMenuItems(outletFilter).catch(() => [])
    } catch { return [] }
  })
  ipcMain.handle('pos:createMenuItem', async (_, data) => {
    try {
      await requireCapability('pos.menu_manage')
      return await db.createPosMenuItem(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:updateMenuItem', async (_, id, data) => {
    try {
      await requireCapability('pos.menu_manage')
      await assertResourceBelongsToCurrentLodge('POS menu item', id, db.getPosMenuItemById)
      return await db.updatePosMenuItem(id, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:deleteMenuItem', async (_, id) => {
    try {
      await requireCapability('pos.menu_manage')
      await assertResourceBelongsToCurrentLodge('POS menu item', id, db.getPosMenuItemById)
      return await db.deletePosMenuItem(id)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:setBarPackTemplate', async (_, data) => {
    try {
      await requireCapability('pos.menu_manage')
      return await db.setBarPosPackTemplate(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getOrders', async (_, start, end) => {
    try {
      await requireCapability('pos.view')
      const outletFilter = db.getUserPosOutletFilter()
      return await db.getPosOrders(start, end, outletFilter)
    } catch (e) {
      throw new Error(e?.message || 'Failed to load POS orders')
    }
  })
  ipcMain.handle('pos:getVoidHistory', async (_, start, end) => {
    try {
      await requireCapability('pos.view')
      const outletFilter = db.getUserPosOutletFilter()
      return await db.getPosVoidHistory(start, end, outletFilter)
    } catch (e) {
      throw new Error(e?.message || 'Failed to load POS void history')
    }
  })
  ipcMain.handle('pos:createOrder', async (_, data) => {
    try {
      await requireCapability('pos.manage')
      // Enforce outlet access — cashier/supervisor can only create orders for their assigned outlets
      const outletFilter = db.getUserPosOutletFilter()
      if (outletFilter !== null && data.outlet_id && !outletFilter.includes(data.outlet_id)) {
        return { success: false, error: 'Access denied: you do not have access to this outlet.' }
      }
      if (data?.booking_id) await assertResourceBelongsToCurrentLodge('Booking', data.booking_id, db.getBookingById)
      if (data?.room_id) await assertResourceBelongsToCurrentLodge('Room', data.room_id, db.getRoomById)
      return await db.createPosOrder(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:voidOrder', async (_, id) => {
    try {
      await requireCapability('pos.void')
      await assertResourceBelongsToCurrentLodge('POS order', id, db.getPosOrderById)
      return await db.voidPosOrder(id)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:approveVoidWithPin', async (_, data) => {
    try {
      await requireCapability('pos.view')
      return await db.approvePosVoidWithPin(data)
    } catch (e) {
      console.error('pos:approveVoidWithPin failed:', e)
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('pos:getActiveBookingForRoom', async (_, roomId) => {
    try { await requireCapability('pos.view'); await assertResourceBelongsToCurrentLodge('Room', roomId, db.getRoomById); return await db.getActiveBookingForRoom(roomId).catch(() => null) }
    catch { return null }
  })

  // ── Outlets ────────────────────────────────────────────────────────────────
  ipcMain.handle('outlets:getAll', async () => {
    try { return await db.getOutlets() }
    catch { return [] }
  })

  // ── Inventory ──────────────────────────────────────────────────────────────
  ipcMain.handle('inventory:getItems', async () => {
    try { await requireCapability('inventory.view'); return await db.getInventoryItems() }
    catch (e) {
      console.error('inventory:getItems failed:', e)
      return []
    }
  })
  ipcMain.handle('inventory:createItem', async (_, data) => {
    try {
      await requireCapability('inventory.manage')
      return await db.createInventoryItem(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('inventory:updateItem', async (_, id, data) => {
    try {
      await requireCapability('inventory.manage')
      await assertResourceBelongsToCurrentLodge('Inventory item', id, db.getInventoryItemById)
      return await db.updateInventoryItem(id, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('inventory:deleteItem', async (_, id) => {
    try {
      await requireCapability('inventory.manage')
      await assertResourceBelongsToCurrentLodge('Inventory item', id, db.getInventoryItemById)
      return await db.deleteInventoryItem(id)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('inventory:addPurchase', async (_, data) => {
    try {
      await requireCapability('inventory.manage')
      await assertResourceBelongsToCurrentLodge('Inventory item', data?.item_id, db.getInventoryItemById)
      return await db.addInventoryPurchase(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('inventory:getPurchases', async (_, itemId) => {
    try { await requireCapability('inventory.view'); await assertResourceBelongsToCurrentLodge('Inventory item', itemId, db.getInventoryItemById); return await db.getInventoryPurchases(itemId) }
    catch (e) {
      console.error('inventory:getPurchases failed:', e)
      return []
    }
  })
  ipcMain.handle('inventory:adjustStock', async (_, itemId, delta, notes) => {
    try {
      await requireCapability('inventory.manage')
      await assertResourceBelongsToCurrentLodge('Inventory item', itemId, db.getInventoryItemById)
      return await db.adjustInventoryStock(itemId, delta, notes)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('inventory:getStocktakes', async (_, limit) => {
    try { await requireCapability('inventory.view'); return await db.getInventoryStocktakes(limit) }
    catch (e) {
      console.error('inventory:getStocktakes failed:', e)
      return []
    }
  })
  ipcMain.handle('inventory:createStocktake', async (_, data) => {
    try {
      await requireCapability('inventory.manage')
      return await db.createInventoryStocktakeSession(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('inventory:getStocktake', async (_, stocktakeId) => {
    try { await requireCapability('inventory.view'); await assertResourceBelongsToCurrentLodge('Inventory stocktake', stocktakeId, db.getInventoryStocktakeById); return await db.getInventoryStocktakeSession(stocktakeId) }
    catch (e) {
      console.error('inventory:getStocktake failed:', e)
      return null
    }
  })
  ipcMain.handle('inventory:saveStocktakeCounts', async (_, stocktakeId, lines) => {
    try {
      await requireCapability('inventory.manage')
      await assertResourceBelongsToCurrentLodge('Inventory stocktake', stocktakeId, db.getInventoryStocktakeById)
      return await db.saveInventoryStocktakeCounts(stocktakeId, lines)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('inventory:postStocktake', async (_, stocktakeId, notes) => {
    try {
      await requireCapability('inventory.manage')
      await assertResourceBelongsToCurrentLodge('Inventory stocktake', stocktakeId, db.getInventoryStocktakeById)
      return await db.postInventoryStocktakeSession(stocktakeId, notes)
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Room Supplies ──────────────────────────────────────────────────────────
  ipcMain.handle('supplies:getItems', async () => {
    try { await requireCapability('supplies.view'); return await db.getSupplyItems().catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('supplies:createItem', async (_, data) => {
    await requireCapability('supplies.manage')
    return await db.createSupplyItem(data)
  })
  ipcMain.handle('supplies:updateItem', async (_, id, data) => {
    await requireCapability('supplies.manage')
    await assertResourceBelongsToCurrentLodge('Supply item', id, db.getSupplyItemById)
    return await db.updateSupplyItem(id, data)
  })
  ipcMain.handle('supplies:deleteItem', async (_, id) => {
    await requireCapability('supplies.manage')
    await assertResourceBelongsToCurrentLodge('Supply item', id, db.getSupplyItemById)
    return await db.deleteSupplyItem(id)
  })
  ipcMain.handle('supplies:addPurchase', async (_, data) => {
    await requireCapability('supplies.manage')
    await assertResourceBelongsToCurrentLodge('Supply item', data?.item_id, db.getSupplyItemById)
    return await db.addSupplyPurchase(data)
  })
  ipcMain.handle('supplies:getPurchases', async (_, itemId) => {
    try { await requireCapability('supplies.view'); await assertResourceBelongsToCurrentLodge('Supply item', itemId, db.getSupplyItemById); return await db.getSupplyPurchases(itemId).catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('supplies:adjustStock', async (_, itemId, delta, notes) => {
    try {
      await requireCapability('supplies.manage')
      await assertResourceBelongsToCurrentLodge('Supply item', itemId, db.getSupplyItemById)
      return await db.adjustSupplyStock(itemId, delta, notes)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('supplies:getRoomStock', async () => {
    try { await requireCapability('supplies.view'); return await db.getRoomSupplyStock().catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('supplies:loadToRoom', async (_, data) => {
    try {
      await requireCapability('supplies.manage')
      await assertResourceBelongsToCurrentLodge('Supply item', data?.item_id, db.getSupplyItemById)
      await assertResourceBelongsToCurrentLodge('Room', data?.room_id, db.getRoomById)
      return await db.loadSupplyToRoom(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('supplies:useInRoom', async (_, data) => {
    try {
      await requireCapability('supplies.manage')
      await assertResourceBelongsToCurrentLodge('Supply item', data?.item_id, db.getSupplyItemById)
      await assertResourceBelongsToCurrentLodge('Room', data?.room_id, db.getRoomById)
      return await db.useSupplyInRoom(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('supplies:returnFromRoom', async (_, data) => {
    try {
      await requireCapability('supplies.manage')
      await assertResourceBelongsToCurrentLodge('Supply item', data?.item_id, db.getSupplyItemById)
      await assertResourceBelongsToCurrentLodge('Room', data?.room_id, db.getRoomById)
      return await db.returnSupplyFromRoom(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('supplies:getMovements', async (_, limit) => {
    try { await requireCapability('supplies.view'); return await db.getSupplyMovements(limit).catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('supplies:saveAllocations', async (_, weekStart, allocations) => {
    await requireCapability('supplies.manage')
    return await db.saveRoomSupplyAllocations(weekStart, allocations)
  })
  ipcMain.handle('supplies:getAllocations', async (_, start, end) => {
    try { await requireCapability('supplies.view'); return await db.getRoomSupplyAllocations(start, end).catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('supplies:getWeekAllocations', async (_, weekStart) => {
    try { await requireCapability('supplies.view'); return await db.getSupplyAllocationsForWeek(weekStart).catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('supplies:exportReport', async (event, payload = {}) => {
    try {
      await requireCapability('supplies.view')
      const win = BrowserWindow.fromWebContents(event.sender)
      const today = new Date().toISOString().split('T')[0]
      const { filePath, canceled } = await dialog.showSaveDialog(win, {
        title: 'Export Room Supplies Report',
        defaultPath: `room-supplies-report-${today}.xlsx`,
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
      })
      if (canceled || !filePath) return { success: false }

      const currency = payload.currency || 'P'
      const allocations = Array.isArray(payload.allocations) ? payload.allocations : []
      const byRoom = Array.isArray(payload.byRoom) ? payload.byRoom : []
      const byItem = Array.isArray(payload.byItem) ? payload.byItem : []
      const grandTotal = Number(payload.grandTotal || 0)

      const wb = XLSX.utils.book_new()

      const summaryRows = [
        ['Boroko Bookings — Room Supplies Report'],
        [`Period: ${payload.start || ''} to ${payload.end || ''}`],
        [],
        ['Metric', 'Value'],
        ['Total Supply Cost', `${currency} ${grandTotal.toFixed(2)}`],
        ['Rooms Captured', byRoom.length],
        ['Supply Items Used', byItem.length],
        ['Usage Entries Logged', allocations.length]
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')

      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          allocations.map((row) => ({
            'Date': row.entry_date || row.week_start || '',
            'Room': row.room_number || '',
            'Supply Item': row.supply_name || '',
            'Category': row.supply_category || '',
            'Units Used': Number(row.units_used || 0),
            'Unit': row.supply_unit || '',
            [`Unit Cost (${currency})`]: Number(row.unit_cost || 0),
            [`Total Cost (${currency})`]: Number(row.total_cost || 0)
          }))
        ),
        'Usage Entries'
      )

      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          byRoom.map((row) => ({
            'Room': row.room_number || '',
            [`Supply Cost (${currency})`]: Number(row.total || row.total_cost || 0),
            'Items Logged': Number(row.item_count || 0),
            'Units Used': Number(row.total_units || 0)
          }))
        ),
        'Cost By Room'
      )

      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          byItem.map((row) => ({
            'Supply Item': row.name || '',
            'Unit': row.unit || '',
            'Units Used': Number(row.total_units || 0),
            'Rooms Logged': Number(row.room_count || 0),
            [`Total Cost (${currency})`]: Number(row.total_cost || 0)
          }))
        ),
        'Cost By Item'
      )

      XLSX.writeFile(wb, filePath)
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('supplies:getStocktakes', async (_, limit) => {
    try { await requireCapability('supplies.view'); return await db.getSupplyStocktakes(limit) }
    catch (e) {
      console.error('supplies:getStocktakes failed:', e)
      return []
    }
  })
  ipcMain.handle('supplies:getRoomStocktakes', async (_, limit) => {
    try { await requireCapability('supplies.view'); return await db.getRoomSupplyStocktakes(limit) }
    catch (e) {
      console.error('supplies:getRoomStocktakes failed:', e)
      return []
    }
  })
  ipcMain.handle('supplies:createStocktake', async (_, data) => {
    try {
      await requireCapability('supplies.manage')
      return await db.createSupplyStocktakeSession(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('supplies:createRoomStocktake', async (_, data) => {
    try {
      await requireCapability('supplies.manage')
      return await db.createRoomSupplyStocktakeSession(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('supplies:getStocktake', async (_, stocktakeId) => {
    try { await requireCapability('supplies.view'); await assertResourceBelongsToCurrentLodge('Supply stocktake', stocktakeId, db.getSupplyStocktakeById); return await db.getSupplyStocktakeSession(stocktakeId) }
    catch (e) {
      console.error('supplies:getStocktake failed:', e)
      return null
    }
  })
  ipcMain.handle('supplies:getRoomStocktake', async (_, stocktakeId) => {
    try { await requireCapability('supplies.view'); await assertResourceBelongsToCurrentLodge('Room supply stocktake', stocktakeId, db.getRoomSupplyStocktakeById); return await db.getRoomSupplyStocktakeSession(stocktakeId) }
    catch (e) {
      console.error('supplies:getRoomStocktake failed:', e)
      return null
    }
  })
  ipcMain.handle('supplies:saveStocktakeCounts', async (_, stocktakeId, lines) => {
    try {
      await requireCapability('supplies.manage')
      await assertResourceBelongsToCurrentLodge('Supply stocktake', stocktakeId, db.getSupplyStocktakeById)
      return await db.saveSupplyStocktakeCounts(stocktakeId, lines)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('supplies:saveRoomStocktakeCounts', async (_, stocktakeId, lines) => {
    try {
      await requireCapability('supplies.manage')
      await assertResourceBelongsToCurrentLodge('Room supply stocktake', stocktakeId, db.getRoomSupplyStocktakeById)
      return await db.saveRoomSupplyStocktakeCounts(stocktakeId, lines)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('supplies:postStocktake', async (_, stocktakeId, notes) => {
    try {
      await requireCapability('supplies.manage')
      await assertResourceBelongsToCurrentLodge('Supply stocktake', stocktakeId, db.getSupplyStocktakeById)
      return await db.postSupplyStocktakeSession(stocktakeId, notes)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('supplies:postRoomStocktake', async (_, stocktakeId, notes) => {
    try {
      await requireCapability('supplies.manage')
      await assertResourceBelongsToCurrentLodge('Room supply stocktake', stocktakeId, db.getRoomSupplyStocktakeById)
      return await db.postRoomSupplyStocktakeSession(stocktakeId, notes)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('supplies:addRoomStocktakeLine', async (_, stocktakeId, data) => {
    try {
      await requireCapability('supplies.manage')
      await assertResourceBelongsToCurrentLodge('Room supply stocktake', stocktakeId, db.getRoomSupplyStocktakeById)
      if (data?.item_id) await assertResourceBelongsToCurrentLodge('Supply item', data.item_id, db.getSupplyItemById)
      if (data?.room_id) await assertResourceBelongsToCurrentLodge('Room', data.room_id, db.getRoomById)
      return await db.addRoomSupplyStocktakeLine(stocktakeId, data)
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Conference Bookings ────────────────────────────────────────────────────
  ipcMain.handle('conference:getAll', async (_, start, end) => {
    try { await requireCapability('conference.view'); return await db.getConferenceBookings(start, end).catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('conference:create', async (_, data) => {
    await requireCapability('conference.manage')
    return await db.createConferenceBooking(data)
  })
  ipcMain.handle('conference:update', async (_, id, data) => {
    await requireCapability('conference.manage')
    await assertResourceBelongsToCurrentLodge('Conference booking', id, db.getConferenceBookingById)
    return await db.updateConferenceBooking(id, data)
  })
  ipcMain.handle('conference:delete', async (_, id) => {
    await requireCapability('conference.manage')
    await assertResourceBelongsToCurrentLodge('Conference booking', id, db.getConferenceBookingById)
    return await db.deleteConferenceBooking(id)
  })

  // ── Pool / Day Use ─────────────────────────────────────────────────────────
  ipcMain.handle('dayuse:getAll', async (_, start, end) => {
    try { await requireCapability('pool.view'); return await db.getPoolDayUse(start, end).catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('dayuse:add', async (_, data) => {
    await requireCapability('pool.manage')
    return await db.addPoolDayUse(data)
  })
  ipcMain.handle('dayuse:delete', async (_, id) => {
    await requireCapability('pool.manage')
    await assertResourceBelongsToCurrentLodge('Pool day-use entry', id, db.getPoolDayUseById)
    return await db.deletePoolDayUse(id)
  })
  ipcMain.handle('dayuse:summary', async (_, date) => {
    try { await requireCapability('pool.view'); return await db.getPoolDayUseSummary(date).catch(() => ({ total: 0, adults: 0, children: 0, entries: [] })) }
    catch { return { total: 0, adults: 0, children: 0, entries: [] } }
  })

  // ── Analytics & Cost Reports ───────────────────────────────────────────────
  ipcMain.handle('reports:posSales', async (_, start, end, outletId) => {
    try { await requireCapability('pos.view'); return await db.getPosRevenueSummary(start, end, outletId) }
    catch (e) { throw new Error(e?.message || 'Failed to load POS sales report') }
  })
  ipcMain.handle('reports:inventorySpend', async (_, start, end, outletId) => {
    try { await requireCapability('inventory.view'); return await db.getInventorySpend(start, end, outletId) }
    catch (e) { throw new Error(e?.message || 'Failed to load inventory spend report') }
  })
  ipcMain.handle('reports:supplySpend', async (_, start, end) => {
    try { await requireCapability('supplies.view'); return await db.getSupplySpend(start, end) }
    catch (e) { throw new Error(e?.message || 'Failed to load supply spend report') }
  })
  ipcMain.handle('inventory:getLowStock', async () => {
    try { await requireCapability('inventory.view'); return await db.getLowStockItems().catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('reports:nightAudit', async (_, date) => {
    try { await requireCapability('audit.view'); return await db.getNightAudit(date) }
    catch (e) { throw new Error(e?.message || 'Failed to load night audit report') }
  })

  // ── Settings ──────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', async () => {
    try { return await db.getSettings() }
    catch { return null }
  })
  ipcMain.handle('settings:save', async (_, data) => {
    try {
      await requireCapability('settings.manage_general')
      return { success: true, data: await db.saveSettings(data) }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('auth:status', async (_, email) => {
    try { return await db.getAuthStatus(email) }
    catch { return { online: false, hasOfflineAccess: false, message: 'Could not read sign-in status right now.' } }
  })
  ipcMain.handle('settings:getDiagnostics', async (_, expectedLodgeId) => {
    try {
      await requireCapability('system.health')
      return await db.getLodgeDiagnostics(expectedLodgeId)
    }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('settings:getSystemHealth', async () => {
    try {
      await requireCapability('system.health')
      return await db.getSystemHealth()
    }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('settings:relinkLodge', async (_, newLodgeId) => {
    try {
      await requireCapability('settings.manage_general')
      return await db.relinkLodge(newLodgeId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('settings:resetToNewLodge', async () => {
    try {
      requireRole('super_admin')
      return { success: true, lodge_id: db.resetToNewLodge() }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('setup:initializeCompany', async (_, payload) => {
    try { return { success: true, data: await db.initializeCompanySetup(payload) } }
    catch (e) { return { success: false, code: e.code || 'setup_failed', error: e.message || 'Setup failed.' } }
  })
  ipcMain.handle('sync:getStatus', async () => {
    try { await requireCapability('system.health'); return await db.getSyncStatus() }
    catch { return { pending: 0, failed: 0 } }
  })
  ipcMain.handle('sync:getDetails', async () => {
    try { await requireCapability('system.health'); return await db.getSyncDetails() }
    catch { return { pending: [], failed: [] } }
  })
  ipcMain.handle('sync:retryFailed', async (_, queueIds) => {
    try {
      await requireCapability('sync.manage')
      return await db.retrySyncItems(queueIds)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('sync:clearFailed', async (_, queueIds) => {
    try {
      await requireCapability('sync.manage')
      return db.clearSyncFailed(queueIds)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('trial:getStatus', async (_, lodgeId) => {
    try { return await db.getTrialStatus(lodgeId) }
    catch { return null }
  })
  ipcMain.handle('trial:activateKey', async (_, lodgeId, key) => {
    try {
      await requireCapability('settings.manage_subscription')
      return await db.activateLicenseKey(lodgeId, key)
    }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Data Import (Excel) ───────────────────────────────────────────────────
  ipcMain.handle('import:parseExcel', async (event) => {
    await requireCapability('data.import')
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

  ipcMain.handle('import:execute', async (event, mappedRows, filename) => {
    try {
      await requireCapability('data.import')
      const sender = event.sender
      return await db.bulkImportBookings(mappedRows, {
        filename,
        onProgress: (progress) => {
          try { sender.send('import:progress', progress) } catch {}
        }
      })
    }
    catch (e) {
      const msg = String(e.message || '')
      const friendly = msg.includes('Internet connection') ? msg
        : msg.includes('capability') || msg.includes('permission') ? 'You do not have permission to import data.'
        : 'Import could not be started. Please restart the app and try again.'
      return { error: friendly }
    }
  })

  ipcMain.handle('import:checkDuplicates', async (_, rows) => {
    try {
      await requireCapability('data.import')
      return await db.checkImportDuplicates(rows)
    }
    catch (e) { return { error: e.message, duplicates: [] } }
  })

  ipcMain.handle('import:undoBatch', async (_, batchId) => {
    try {
      await requireCapability('data.import')
      return await db.undoImportBatch(batchId)
    }
    catch (e) { return { error: e.message } }
  })

  ipcMain.handle('import:getBatches', async () => {
    try {
      await requireCapability('data.import')
      return await db.getImportBatches()
    }
    catch (e) { return [] }
  })

  ipcMain.handle('import:downloadTemplate', async (event) => {
    await requireCapability('data.import')
    const win = BrowserWindow.fromWebContents(event.sender)
    const fields = db.generateImportTemplate()
    const headerRow = {}
    fields.forEach((f) => { headerRow[f.label] = '' })
    const sampleRow = {
      'Guest Name': 'John Smith',
      'Email': 'john@example.com',
      'Phone': '+675 7000 0000',
      'ID / Passport No': 'A12345678',
      'Nationality': 'Papua New Guinea',
      'Room Number': '101',
      'Check-In Date': '2025-01-15',
      'Check-Out Date': '2025-01-18',
      'Adults': 2,
      'Children': 0,
      'Total Amount': '',
      'Amount Paid': 500,
      'Payment Method': 'Cash',
      'Booking Status': 'checked_out',
      'Notes': 'Early check-in'
    }
    const ws = XLSX.utils.json_to_sheet([sampleRow])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Booking Import Template')
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Import Template',
      defaultPath: 'boroko-import-template.xlsx',
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    try {
      XLSX.writeFile(wb, result.filePath)
      return { success: true, filePath: result.filePath }
    } catch (e) {
      return { error: e.message }
    }
  })

  const mainWindow = createWindow()
  setupAutoUpdater(mainWindow)

  setTimeout(() => {
    runManagedBackupPolicy(false).catch((error) => {
      console.error('Managed weekly backup check failed:', error?.message || error)
    })
  }, 20_000)

  setInterval(() => {
    runManagedBackupPolicy(false).catch((error) => {
      console.error('Managed weekly backup check failed:', error?.message || error)
    })
  }, 60 * 60 * 1000)

  setTimeout(() => {
    db.runScheduledFinancialValidation('startup').catch((error) => {
      console.error('Startup financial validation check failed:', error?.message || error)
    })
  }, 30_000)

  setInterval(() => {
    db.runScheduledFinancialValidation('scheduled').catch((error) => {
      console.error('Scheduled financial validation check failed:', error?.message || error)
    })
  }, 60 * 60 * 1000)

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
  ipcMain.handle('app:logRendererError', async (_, payload) => appendRendererErrorLog(payload || {}))
  ipcMain.handle('app:getRendererErrors', async (_, limit) => getRendererErrorLog(limit))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
