import { app, shell, BrowserWindow, ipcMain, Notification, dialog, Menu, nativeImage, screen } from 'electron'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import crypto from 'crypto'
import * as XLSX from '@e965/xlsx'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import autoUpdaterPkg from 'electron-updater'
const { autoUpdater } = autoUpdaterPkg
import * as db from './database.js'

// A development terminal (or a parent process) can disappear while Electron is
// still running. Node reports that as an asynchronous EPIPE event on stdout or
// stderr, which a try/catch around console.log cannot intercept. Logging must
// never terminate a POS session, mesh replay, or financial operation.
const brokenPipeHandlerInstalled = Symbol.for('tsa-bonno.broken-pipe-handler-installed')
for (const stream of [process.stdout, process.stderr]) {
  if (!stream || stream[brokenPipeHandlerInstalled]) continue
  stream[brokenPipeHandlerInstalled] = true
  stream.on('error', (error) => {
    // There is no safe output destination once the pipe is closed. Deliberately
    // ignore it rather than allowing Node's unhandled stream error to crash the
    // main process.
    if (error?.code === 'EPIPE') return
  })
}

// Guard synchronous console output errors as well.
for (const method of ['warn', 'error', 'log', 'info']) {
  const original = console[method]
  console[method] = (...args) => { try { original(...args) } catch {} }
}
import { state } from './state.js'
import { readCache } from './domains/cacheStore.js'
import { createAiOrchestrator, writeAiAuditLog } from './ai/aiOrchestrator.js'
import { buildCapabilitySnapshot, normalizeAppRole } from '../shared/accessControl.js'
import { isCommercialFeatureIncluded } from '../shared/commercialAccess.js'
import { normalizeDayUseReportRow } from '../shared/dayUseReporting.js'
import {
  getEmailConfig,
  saveEmailConfig,
  testEmailConfig,
  sendNotificationEmail,
  sendLicenseEmail,
  sendInvoiceEmail,
  sendPurchaseOrderEmail,
  sendBookingInvoiceEmail,
  sendQuotationEmail,
  sendBookingConfirmationEmail,
  sendBookingCancellationEmail,
  buildSupportTicketEmail,
  buildUpgradeRequestEmail
} from './emailNotifications.js'
import { assertCommandCentralTarget, assertMasterAdmin, createActorBoundElevationGate } from './commandCentralAuthorization.js'
import { createLocalLock, releaseLocalLock } from './domains/mesh/meshLocks.js'
import {
  connectManualMeshPeer,
  refreshMeshDiscovery
} from './domains/mesh/meshDiscovery.js'
import { getMeshHealthSnapshot } from './domains/mesh/meshState.js'
import {
  normalizePosHardwareSettings,
  openCashDrawer,
  printEscPosReceipt,
  sendPaymentTerminalTotal as sendPaymentTerminalToDevice,
  testPosHardwareDevice
} from './hardware/posHardwareAdapter.js'
import { getProductDefinition, getRuntimeProductId } from '../shared/productIdentity.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const BUILD_PRODUCT_ID = getRuntimeProductId()
const BUILD_PRODUCT = getProductDefinition(BUILD_PRODUCT_ID)
const APP_BRAND_NAME = BUILD_PRODUCT.brandName
const APP_WINDOW_TITLE = APP_BRAND_NAME
const PRODUCT_TITLE_BAR_COLORS = Object.freeze({
  'lodge-camp': '#102a22',
  hotel: '#7a432b',
  'hospitality-pos': '#8f3524'
})
const APP_TITLE_BAR_COLOR = PRODUCT_TITLE_BAR_COLORS[BUILD_PRODUCT_ID] || PRODUCT_TITLE_BAR_COLORS['lodge-camp']
const APP_EXPORT_PREFIX = 'tsa-bonno'
const INPUT_FOCUS_DEBUG = false
const PRODUCT_LOGO_STEMS = Object.freeze({
  'lodge-camp': 'tsa-bonno-lodgingos',
  hotel: 'tsa-bonno-hotelos',
  'hospitality-pos': 'tsa-bonno-restaurant-bar-os'
})
const APP_LOGO_STEM = PRODUCT_LOGO_STEMS[BUILD_PRODUCT_ID] || 'tsa-bonno-hospitalityos'
// Electron nativeImage does not reliably decode SVG files on Windows. Use the
// generated transparent PNG so splash/window branding cannot resolve empty.
const APP_LOGO_FILENAME = `${APP_LOGO_STEM}-logo-color.png`
const APP_DARK_LOGO_FILENAME = `${APP_LOGO_STEM}-logo-light.png`
let activeSplashWindow = null
const SHARED_TILL_OPERATOR_SESSION_MS = 10 * 60 * 1000
const sharedTillOperatorSessions = new Map()

function setSharedTillOperatorSession(webContents, staff, outletId) {
  if (!webContents?.id || !staff?.id) return
  sharedTillOperatorSessions.set(webContents.id, {
    staffId: staff.id,
    staffName: staff.name || staff.email || 'Till operator',
    outletId: outletId || null,
    expiresAt: Date.now() + SHARED_TILL_OPERATOR_SESSION_MS,
  })
}

function getSharedTillOperatorSession(webContents) {
  const session = sharedTillOperatorSessions.get(webContents?.id)
  if (!session || session.expiresAt <= Date.now()) {
    if (webContents?.id) sharedTillOperatorSessions.delete(webContents.id)
    return null
  }
  session.expiresAt = Date.now() + SHARED_TILL_OPERATOR_SESSION_MS
  return session
}

function readStartupJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function hasStartupLodgeProfile(userDataDir) {
  const registry = readStartupJson(join(userDataDir, 'profiles.json'), null)
  return Boolean(registry?.active_lodge_id && Array.isArray(registry?.profiles) && registry.profiles.length > 0)
}

function writeStartupJson(filePath, value) {
  fs.mkdirSync(dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8')
}

function getOrCreateLocalDevMeshSecret(appDataDir) {
  const secretPath = join(appDataDir, 'boroko-bookings-local-mesh-secret.json')
  const existing = String(readStartupJson(secretPath, {})?.lodge_mesh_secret || '').trim()
  if (existing) return existing

  const secret = crypto.randomUUID() + crypto.randomUUID()
  writeStartupJson(secretPath, {
    lodge_mesh_secret: secret,
    created_at: new Date().toISOString(),
    note: 'Local development mesh secret shared by unpackaged Tsa Bonno desk test instances only.'
  })
  return secret
}

function ensureDevDeskMeshSecret(appDataDir, devUserDataDir) {
  try {
    const registry = readStartupJson(join(devUserDataDir, 'profiles.json'), null)
    const activeLodgeId = registry?.active_lodge_id
    if (!activeLodgeId) return

    const settingsPath = join(devUserDataDir, 'boroko-cache', 'profiles', activeLodgeId, 'settings.json')
    const settings = readStartupJson(settingsPath, null)
    const rows = Array.isArray(settings) ? settings : settings ? [settings] : []
    if (!rows.length) return

    const firstRow = rows[0] || {}
    if (String(firstRow.lodge_mesh_secret || '').trim()) return

    rows[0] = {
      ...firstRow,
      lodge_mesh_secret: getOrCreateLocalDevMeshSecret(appDataDir),
      _local_mesh_secret_for_testing: true
    }
    writeStartupJson(settingsPath, rows)
    console.log('[DevDesk] Added shared local development mesh secret to cached settings.')
  } catch (error) {
    console.warn('[DevDesk] Could not prepare local development mesh secret:', error?.message || error)
  }
}

function seedDevDeskFromInstalledApp(installedUserDataDir, devUserDataDir) {
  try {
    if (!installedUserDataDir || !devUserDataDir || installedUserDataDir === devUserDataDir) return
    if (!fs.existsSync(installedUserDataDir) || hasStartupLodgeProfile(devUserDataDir)) return

    fs.mkdirSync(devUserDataDir, { recursive: true })

    for (const fileName of ['profiles.json', 'lodge-id.json']) {
      const sourcePath = join(installedUserDataDir, fileName)
      const targetPath = join(devUserDataDir, fileName)
      if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, targetPath)
    }

    const sourceProfilesDir = join(installedUserDataDir, 'boroko-cache', 'profiles')
    const targetProfilesDir = join(devUserDataDir, 'boroko-cache', 'profiles')
    if (!fs.existsSync(sourceProfilesDir)) return

    const skippedFiles = new Set([
      'mesh-identity.json',
      'sync-queue.json',
      'sync-failed.json',
      'sync-mesh-quarantine.json',
      'session-nonce.json',
      'renderer-errors.log'
    ])

    fs.cpSync(sourceProfilesDir, targetProfilesDir, {
      recursive: true,
      force: true,
      filter: (sourcePath) => !skippedFiles.has(basename(sourcePath))
    })

    console.log('[DevDesk] Seeded terminal desk profile from installed legacy application data.')
  } catch (error) {
    console.warn('[DevDesk] Could not seed terminal desk profile:', error?.message || error)
  }
}

if (process.env.BOROKO_TEST_USER_DATA_DIR) {
  app.setPath('userData', process.env.BOROKO_TEST_USER_DATA_DIR)
} else if (!app.isPackaged) {
  const devDeskName = process.env.BOROKO_DEV_DESK_NAME || `${BUILD_PRODUCT.name} Dev Desk`
  const installedDeskName = process.env.BOROKO_INSTALLED_DESK_NAME || BUILD_PRODUCT.appDataName
  const appDataDir = app.getPath('appData')
  const devUserDataDir = join(appDataDir, devDeskName)
  const installedUserDataDir = join(appDataDir, installedDeskName)
  seedDevDeskFromInstalledApp(installedUserDataDir, devUserDataDir)
  ensureDevDeskMeshSecret(appDataDir, devUserDataDir)
  app.setName(devDeskName)
  app.setPath('userData', devUserDataDir)
}

// -- URL safety guard (used by shell:openExternal and setWindowOpenHandler) ----
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:'])
function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url)
    if (ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return true
    if (parsed.protocol !== 'http:') return false
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  } catch {
    return false
  }
}

function isAllowedAppNavigation(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'file:') return true
    if (parsed.protocol === 'about:') return true
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      return parsed.origin === new URL(process.env['ELECTRON_RENDERER_URL']).origin
    }
    return false
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

function clearRendererErrorLog() {
  try {
    const logPath = join(app.getPath('userData'), 'renderer-errors.log')
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath)
    return { success: true }
  } catch (error) {
    console.error('Renderer error log clear failed:', error.message)
    return { success: false, error: error.message }
  }
}

function getAppLogoPath() {
  const packagedPath = join(process.resourcesPath, 'assets', APP_LOGO_FILENAME)
  if (app.isPackaged && fs.existsSync(packagedPath)) return packagedPath

  const devPath = join(app.getAppPath(), 'src', 'main', 'assets', APP_LOGO_FILENAME)
  if (fs.existsSync(devPath)) return devPath

  return null
}

function getAppDarkLogoPath() {
  const packagedPath = join(process.resourcesPath, 'assets', APP_DARK_LOGO_FILENAME)
  if (app.isPackaged && fs.existsSync(packagedPath)) return packagedPath

  const devPath = join(app.getAppPath(), 'src', 'main', 'assets', APP_DARK_LOGO_FILENAME)
  if (fs.existsSync(devPath)) return devPath

  return getAppLogoPath()
}

function createAppLogoNativeImage() {
  try {
    const icoPath = join(process.resourcesPath, 'assets', 'tsa-bonno-icon.ico')
    const devIcoPath = join(app.getAppPath(), 'src', 'main', 'assets', 'tsa-bonno-icon.ico')
    const cwdIcoPath = join(process.cwd(), 'src', 'main', 'assets', 'tsa-bonno-icon.ico')
    const moduleIcoPath = join(fileURLToPath(import.meta.url), '..', 'assets', 'tsa-bonno-icon.ico')

    let logoPath = null
    if (app.isPackaged && fs.existsSync(icoPath)) {
      logoPath = icoPath
    } else if (fs.existsSync(devIcoPath)) {
      logoPath = devIcoPath
    } else if (fs.existsSync(cwdIcoPath)) {
      logoPath = cwdIcoPath
    } else if (fs.existsSync(moduleIcoPath)) {
      logoPath = moduleIcoPath
    } else {
      logoPath = getAppLogoPath()
    }

    if (!logoPath) {
      console.warn('App logo not found in any expected location')
      return null
    }
    const image = nativeImage.createFromPath(logoPath)
    if (image.isEmpty()) {
      console.warn('App logo image loaded but is empty:', logoPath)
      return null
    }
    return image
  } catch (error) {
    console.warn('App logo image load failed:', error?.message || error)
    return null
  }
}

function normalizeImportHeader(value, fallback) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim()
  return cleaned || fallback
}

function normalizeParsedImportRows(rows = []) {
  const headerMap = new Map()
  const columns = []
  const normalizedRows = rows.map((row) => {
    const next = {}
    Object.entries(row || {}).forEach(([rawKey, value]) => {
      const normalizedKey = normalizeImportHeader(rawKey, '')
      if (!normalizedKey) return
      const count = headerMap.get(normalizedKey) || 0
      const safeKey = count === 0 ? normalizedKey : `${normalizedKey} ${count + 1}`
      headerMap.set(normalizedKey, count + 1)
      if (!columns.includes(safeKey)) columns.push(safeKey)
      next[safeKey] = value
    })
    headerMap.clear()
    return next
  })

  return {
    rows: normalizedRows,
    columns: columns.filter((column) => normalizedRows.some((row) => String(row[column] ?? '').trim() !== ''))
  }
}

function buildImportTemplateWorkbook({ type, fields, sample }) {
  const headerRow = {}
  fields.forEach((f) => { headerRow[f.label] = '' })

  const dataSheet = XLSX.utils.json_to_sheet([{ ...headerRow, ...sample }])
  dataSheet['!cols'] = fields.map((field) => ({
    wch: Math.max(14, Math.min(28, field.label.length + 4))
  }))
  dataSheet['!autofilter'] = { ref: XLSX.utils.encode_range(XLSX.utils.decode_range(dataSheet['!ref'] || 'A1:A1')) }

  const required = fields.filter((field) => field.required).map((field) => field.label).join(', ') || 'None'
  const readMeRows = [
    [`${APP_BRAND_NAME} Import Template`],
    ['Template type', type],
    ['Use this sheet', 'Import Data'],
    ['Required columns', required],
    ['Row limit', 'Import up to 500 rows at a time. Split larger files before importing.'],
    ['Dates', 'Use YYYY-MM-DD where possible. DD/MM/YYYY is also accepted.'],
    ['Safety', 'Imports create new records only. Existing matches are skipped or reported before saving.'],
    ['Tip', 'Keep the header row unchanged for the fastest auto-mapping.']
  ]
  const readMeSheet = XLSX.utils.aoa_to_sheet(readMeRows)
  readMeSheet['!cols'] = [{ wch: 24 }, { wch: 86 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, dataSheet, 'Import Data')
  XLSX.utils.book_append_sheet(wb, readMeSheet, 'Read Me')
  return wb
}

function buildSplashHtml() {
  const logoPath = getAppDarkLogoPath()
  const logoMarkup = logoPath
    ? `<img src="data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}" alt="${escapeHtml(APP_BRAND_NAME)}" />`
    : `<div class="fallback">${escapeHtml(APP_BRAND_NAME)}</div>`

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        html, body {
          width: 100%;
          height: 100%;
          margin: 0;
          background: linear-gradient(180deg, #0f3d2c 0%, #0c2d23 100%);
          overflow: hidden;
          font-family: Arial, Helvetica, sans-serif;
        }
        body {
          display: grid;
          place-items: center;
          color: #ecfdf5;
          opacity: 0;
          animation: fadeIn 420ms ease-out forwards;
        }
        .card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          padding: 28px 32px;
          animation: lift 700ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
        .logo {
          width: 380px;
          height: 150px;
          display: grid;
          place-items: center;
        }
        .logo img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .fallback {
          font-size: 32px;
          font-weight: 700;
          color: #0f3d2c;
        }
        .title {
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(236, 253, 245, 0.92);
        }
        .subtitle {
          margin-top: -6px;
          font-size: 13px;
          color: rgba(209, 250, 229, 0.75);
        }
        .status {
          width: min(320px, 74vw);
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: center;
        }
        .status-text {
          font-size: 12px;
          color: rgba(236, 253, 245, 0.82);
        }
        .progress {
          position: relative;
          width: 100%;
          height: 7px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(236, 253, 245, 0.16);
          box-shadow: inset 0 0 0 1px rgba(236, 253, 245, 0.12);
        }
        .progress::before {
          content: "";
          position: absolute;
          inset: 0 auto 0 0;
          width: 46%;
          border-radius: inherit;
          background: linear-gradient(90deg, rgba(52, 211, 153, 0.25), rgba(236, 253, 245, 0.95), rgba(52, 211, 153, 0.25));
          animation: progressSweep 1.35s ease-in-out infinite;
        }
        .dots {
          display: inline-flex;
          gap: 5px;
          align-items: center;
          height: 12px;
        }
        .dots span {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: rgba(236, 253, 245, 0.85);
          animation: pulse 1.1s infinite ease-in-out;
        }
        .dots span:nth-child(2) { animation-delay: 0.15s; }
        .dots span:nth-child(3) { animation-delay: 0.3s; }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes lift {
          from { transform: translateY(10px) scale(0.985); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes pulse {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes progressSweep {
          0% { transform: translateX(-110%); }
          100% { transform: translateX(230%); }
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">${logoMarkup}</div>
        <div class="title">${escapeHtml(APP_BRAND_NAME)}</div>
        <div class="subtitle">Starting up <span class="dots"><span></span><span></span><span></span></span></div>
        <div class="status" role="status" aria-live="polite">
          <div class="status-text">Checking internet connection and online database access</div>
          <div class="progress" aria-hidden="true"></div>
        </div>
      </div>
    </body>
  </html>`
}

function createStartupSplashWindow() {
  if (activeSplashWindow && !activeSplashWindow.isDestroyed()) {
    return activeSplashWindow
  }

  const appIcon = createAppLogoNativeImage() || undefined
  const splashWindow = new BrowserWindow({
    width: 420,
    height: 420,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    frame: false,
    transparent: true,
    show: true,
    skipTaskbar: true,
    alwaysOnTop: false,
    title: `${APP_WINDOW_TITLE} STARTING`,
    icon: appIcon,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  activeSplashWindow = splashWindow
  splashWindow.once('closed', () => {
    if (activeSplashWindow === splashWindow) activeSplashWindow = null
  })
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildSplashHtml())}`)
  return splashWindow
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

const MANAGER_MANAGED_STAFF_ROLES = new Set(['cashier', 'supervisor', 'receptionist', 'operations'])

function assertManagerStaffScope(actor, targetUser, payload = {}) {
  if (normalizeAppRole(actor?.role) !== 'manager' || actor?.isMasterAdmin) return
  const currentRole = normalizeAppRole(targetUser?.role || payload?.role || 'receptionist')
  const requestedRole = normalizeAppRole(payload?.role || currentRole)
  if (!MANAGER_MANAGED_STAFF_ROLES.has(currentRole) || !MANAGER_MANAGED_STAFF_ROLES.has(requestedRole)) {
    throw new Error('Managers can manage service-team accounts only. An administrator must assign finance, manager, or owner access.')
  }
  if (payload?.capability_overrides && JSON.stringify(payload.capability_overrides) !== JSON.stringify(targetUser?.capability_overrides || {})) {
    throw new Error('Managers cannot set custom permission exceptions. Ask an administrator to make this access change.')
  }
}

function slugifyFilenamePart(value, fallback = 'report') {
  return String(value || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase() || fallback
}

function formatFilenameStamp(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (value) => String(value).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`
}

function buildReportExportFilename({ prefix = APP_EXPORT_PREFIX, reportTitle = 'report', period = '', extension = 'pdf' } = {}) {
  const parts = [
    slugifyFilenamePart(prefix, APP_EXPORT_PREFIX),
    slugifyFilenamePart(reportTitle, 'report'),
    period ? slugifyFilenamePart(period, 'period') : null,
    formatFilenameStamp()
  ].filter(Boolean)
  return `${parts.join('-')}.${extension}`
}

function buildWorkbookMetaRows({ lodgeName, companyName, periodLabel, outletLabel, generatedAt, includeOutlet = false }) {
  const resolvedLodge = lodgeName || companyName || APP_BRAND_NAME
  const rows = [
    ['Lodge', resolvedLodge]
  ]
  if (companyName && companyName !== resolvedLodge) {
    rows.push(['Company', companyName])
  }
  if (periodLabel) {
    rows.push(['Period', periodLabel])
  }
  if (includeOutlet && outletLabel) {
    rows.push(['Outlet', outletLabel])
  }
  if (generatedAt) {
    rows.push(['Generated', generatedAt])
  }
  rows.push([])
  return rows
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatReportMoney(currency, value) {
  return `${currency} ${Number(value || 0).toFixed(2)}`
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPrintableWebContents(webContents, { timeoutMs = 5000, minTextLength = 1 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const state = await webContents.executeJavaScript(`
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const body = document.body
              const text = body ? body.innerText.replace(/\\s+/g, ' ').trim() : ''
              resolve({
                readyState: document.readyState,
                textLength: text.length,
                scrollHeight: body ? body.scrollHeight : 0,
                childCount: body ? body.children.length : 0
              })
            })
          })
        })
      `, true)
      if (
        state?.readyState !== 'loading' &&
        state?.scrollHeight > 0 &&
        (state?.textLength >= minTextLength || state?.childCount > 0)
      ) {
        return true
      }
    } catch {}
    await delay(150)
  }
  return false
}

async function printWebContentsSafely(webContents, printOptions = {}, waitOptions = {}) {
  await waitForPrintableWebContents(webContents, waitOptions)
  await delay(120)
  return await new Promise((resolve) => {
    webContents.print(printOptions, (success, failureReason) => {
      resolve(success ? { success: true } : { success: false, error: failureReason || 'Print failed.' })
    })
  })
}

async function printWebContentsToPdfSafely(webContents, pdfOptions = {}, waitOptions = {}) {
  await waitForPrintableWebContents(webContents, waitOptions)
  await delay(120)
  return await webContents.printToPDF(pdfOptions)
}

async function renderHtmlToPdfBuffer(html, pdfOptions = {}, waitOptions = {}) {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 1600,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await printWebContentsToPdfSafely(pdfWindow.webContents, pdfOptions, waitOptions)
  } finally {
    if (!pdfWindow.isDestroyed()) pdfWindow.destroy()
  }
}

function buildPrepaymentReceiptPdfHtml(receipt = {}) {
  const money = (value) => `${escapeHtml(receipt.currency || 'P')} ${Number(value || 0).toFixed(2)}`
  const logo = String(receipt.logo || '').trim()
  const contact = [receipt.phone, receipt.email, receipt.website].filter(Boolean).map(escapeHtml).join(' - ')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172033; font-family: Arial, Helvetica, sans-serif; font-size: 13px; }
    .page { min-height: 265mm; padding: 4mm; }
    .header { text-align: center; border-bottom: 3px solid #172033; padding-bottom: 18px; }
    .logo { max-width: 190px; max-height: 85px; object-fit: contain; margin: 0 auto 10px; }
    h1 { margin: 0; font-size: 25px; text-transform: uppercase; }
    .muted { color: #64748b; }
    .title { display: flex; justify-content: space-between; margin: 28px 0 18px; }
    .title h2 { margin: 0; font-size: 23px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 18px; background: #f8fafc; border: 1px solid #dbe3ec; border-radius: 10px; }
    .label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 5px; font-size: 15px; font-weight: 700; }
    .amount { margin: 22px 0; padding: 24px; text-align: center; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; }
    .amount strong { display: block; margin: 7px 0; color: #047857; font-size: 34px; }
    .warning { margin-top: 24px; padding: 16px; text-align: center; font-weight: 700; color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; }
    .notes { margin-top: 18px; padding: 15px; border: 1px solid #dbe3ec; border-radius: 10px; }
    .footer { margin-top: 55px; border-top: 1px solid #cbd5e1; padding-top: 12px; text-align: center; color: #64748b; font-size: 11px; }
    .provisional { margin-bottom: 14px; padding: 10px; text-align: center; color: #92400e; background: #fffbeb; font-weight: 700; }
  </style></head><body><div class="page">
    ${receipt.provisional ? '<div class="provisional">PROVISIONAL - PENDING SERVER CONFIRMATION</div>' : ''}
    <div class="header">
      ${logo ? `<img class="logo" src="${escapeHtml(logo)}">` : ''}
      <h1>${escapeHtml(receipt.lodgeName || 'Lodge')}</h1>
      ${receipt.companyName && receipt.companyName !== receipt.lodgeName ? `<p>${escapeHtml(receipt.companyName)}</p>` : ''}
      ${receipt.address ? `<p class="muted">${escapeHtml(receipt.address)}</p>` : ''}
      ${contact ? `<p class="muted">${contact}</p>` : ''}
    </div>
    <div class="title"><div><h2>Advance Payment Receipt</h2><p class="muted">${escapeHtml(receipt.receiptNumber || '')}</p></div>
      <div style="text-align:right"><div class="label">Date issued</div><div class="value">${escapeHtml(new Date(receipt.createdAt || Date.now()).toLocaleString('en-BW'))}</div></div></div>
    <div class="grid">
      <div><div class="label">Customer</div><div class="value">${escapeHtml(receipt.customerName || '')}</div></div>
      <div><div class="label">Payment method</div><div class="value">${escapeHtml(String(receipt.method || 'other').replaceAll('_', ' '))}</div></div>
      <div><div class="label">Reference</div><div class="value">${escapeHtml(receipt.reference || '-')}</div></div>
      <div><div class="label">Receipt number</div><div class="value">${escapeHtml(receipt.receiptNumber || '')}</div></div>
    </div>
    <div class="amount"><span>Amount received</span><strong>${money(receipt.amount)}</strong><span>Remaining customer credit: ${money(receipt.balance)}</span></div>
    ${receipt.notes ? `<div class="notes"><div class="label">Notes</div><div class="value">${escapeHtml(receipt.notes)}</div></div>` : ''}
    <div class="warning">This payment is held as customer credit. It does not reserve accommodation or guarantee room availability until a booking is confirmed.</div>
    <div class="footer">Generated by ${escapeHtml(APP_BRAND_NAME)} - ${escapeHtml(receipt.receiptNumber || '')}</div>
  </div></body></html>`
}

function buildPurchaseOrderPdfHtml({ purchaseOrder, business = {}, currency = 'P' }) {
  const reference = `PO-${String(purchaseOrder?.id || '').slice(-6).toUpperCase() || 'DRAFT'}`
  const businessName = business.lodge_name || business.company_name || APP_BRAND_NAME
  const supplier = purchaseOrder?.supplier || {}
  const formatDate = (value) => value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
  const rows = (purchaseOrder?.items || []).map((item) => `<tr><td>${escapeHtml(item.description || 'Stock item')}</td><td class="number">${Number(item.quantity || 0).toFixed(2)}</td><td class="number">${escapeHtml(currency)} ${Number(item.unit_cost || 0).toFixed(2)}</td><td class="number">${escapeHtml(currency)} ${Number(item.total ?? (Number(item.quantity || 0) * Number(item.unit_cost || 0))).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="4">No stock lines recorded.</td></tr>'
  const isDraft = purchaseOrder?.status === 'draft'
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:#30242a;padding:42px;font-size:12px}header{border-bottom:3px solid #d87945;padding-bottom:20px;display:flex;justify-content:space-between}h1{margin:0;font-size:25px}.muted{color:#76636b}.status{display:inline-block;border-radius:12px;padding:5px 10px;background:${isDraft ? '#fff3df' : '#eaf8f0'};font-weight:bold;text-transform:uppercase;font-size:10px}section{margin-top:25px}table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#35242c;color:#fff;text-align:left;padding:10px;font-size:10px;text-transform:uppercase}td{padding:10px;border-bottom:1px solid #eadedb}.number{text-align:right}.total{margin-top:16px;margin-left:auto;width:280px;border-top:2px solid #35242c;padding-top:10px;font-weight:bold;font-size:16px;text-align:right}.footer{position:fixed;bottom:28px;color:#8b777e;font-size:10px}.draft{margin-top:18px;border:1px solid #efd09e;background:#fff3df;padding:10px;color:#794017}</style></head><body><header><div><h1>${escapeHtml(businessName)}</h1><p class="muted">Purchase order ${escapeHtml(reference)}</p></div><div style="text-align:right"><span class="status">${escapeHtml(purchaseOrder?.status || 'draft')}</span><p class="muted">Issued ${escapeHtml(formatDate(purchaseOrder?.created_at || purchaseOrder?.order_date))}</p></div></header>${isDraft ? '<p class="draft">Draft only — do not treat this as an approved supplier order.</p>' : ''}<section><strong>Supplier</strong><p>${escapeHtml(supplier.name || 'Supplier not recorded')}<br>${escapeHtml(supplier.contact_person || '')}${supplier.email ? `<br>${escapeHtml(supplier.email)}` : ''}${supplier.phone ? `<br>${escapeHtml(supplier.phone)}` : ''}</p></section><section><strong>Order lines</strong><table><thead><tr><th>Description</th><th class="number">Quantity</th><th class="number">Unit cost</th><th class="number">Line total</th></tr></thead><tbody>${rows}</tbody></table><div class="total">Total: ${escapeHtml(currency)} ${Number(purchaseOrder?.total || 0).toFixed(2)}</div></section>${purchaseOrder?.expected_delivery ? `<section><strong>Expected delivery</strong><p>${escapeHtml(formatDate(purchaseOrder.expected_delivery))}</p></section>` : ''}${purchaseOrder?.notes ? `<section><strong>Notes</strong><p>${escapeHtml(purchaseOrder.notes)}</p></section>` : ''}<p class="footer">Generated by ${escapeHtml(APP_BRAND_NAME)} · ${escapeHtml(reference)}</p></body></html>`
}

function buildSubscriptionRequestDocumentPdfHtml(documentPayload = {}) {
  const customer = documentPayload.customer || {}
  const packageInfo = documentPayload.package || {}
  const totals = documentPayload.totals || {}
  const addons = Array.isArray(packageInfo.requested_addons) ? packageInfo.requested_addons : []
  const documentType = documentPayload.document_type === 'invoice' ? 'Pro-forma Invoice' : 'Subscription Quote'
  const money = (value) => `${escapeHtml(totals.currency || 'P')} ${Number(value || 0).toFixed(2)}`
  const addonList = addons.length
    ? addons.map((addon) => `<li>${escapeHtml(String(addon).replaceAll('_', ' '))}</li>`).join('')
    : '<li>No add-ons selected</li>'

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #172033; font-family: Arial, Helvetica, sans-serif; font-size: 13px; }
    .page { min-height: 265mm; padding: 4mm; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 3px solid #172033; padding-bottom: 18px; }
    h1 { margin: 0; font-size: 24px; text-transform: uppercase; }
    h2 { margin: 22px 0 10px; font-size: 15px; text-transform: uppercase; letter-spacing: .06em; color: #334155; }
    .muted { color: #64748b; }
    .docno { text-align: right; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 18px; }
    .box { border: 1px solid #dbe3ec; border-radius: 10px; padding: 14px; background: #f8fafc; }
    .label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 5px; font-size: 15px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: left; }
    th { background: #f1f5f9; color: #475569; font-size: 11px; text-transform: uppercase; }
    .total { margin-top: 22px; padding: 18px; border-radius: 12px; background: #ecfdf5; border: 1px solid #a7f3d0; text-align: right; }
    .total strong { display: block; color: #047857; font-size: 30px; }
    .warning { margin-top: 24px; padding: 14px; color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 10px; font-weight: 700; }
    .footer { margin-top: 55px; border-top: 1px solid #cbd5e1; padding-top: 12px; text-align: center; color: #64748b; font-size: 11px; }
  </style></head><body><div class="page">
    <div class="header">
      <div>
        <h1>${escapeHtml(APP_BRAND_NAME)}</h1>
        <p class="muted">Hospitality operating system package request</p>
      </div>
      <div class="docno">
        <div>${escapeHtml(documentType)}</div>
        <div class="muted">${escapeHtml(documentPayload.document_number || '')}</div>
        <div class="muted">${escapeHtml(new Date(documentPayload.issued_at || Date.now()).toLocaleString('en-BW'))}</div>
      </div>
    </div>
    <div class="grid">
      <div class="box">
        <div class="label">Customer</div>
        <div class="value">${escapeHtml(customer.property_name || customer.company_name || 'Prospect')}</div>
        <p class="muted">${escapeHtml(customer.contact_name || '')}</p>
        <p class="muted">${escapeHtml(customer.contact_email || customer.contact_phone || '')}</p>
      </div>
      <div class="box">
        <div class="label">Requested Package</div>
        <div class="value">${escapeHtml(packageInfo.requested_plan || 'Starter')}</div>
        <p class="muted">${escapeHtml(String(packageInfo.room_count || '-'))} rooms, ${escapeHtml(String(packageInfo.user_count || '-'))} users</p>
      </div>
    </div>
    <h2>Selected Add-ons</h2>
    <div class="box"><ul>${addonList}</ul></div>
    <h2>Commercial Summary</h2>
    <table>
      <thead><tr><th>Item</th><th>Amount</th></tr></thead>
      <tbody>
        <tr><td>Recurring package estimate</td><td>${money(totals.recurring_amount)}</td></tr>
        <tr><td>Setup / onboarding estimate</td><td>${money(totals.setup_amount)}</td></tr>
      </tbody>
    </table>
    <div class="total"><span>Total due now</span><strong>${money(totals.total_due_now)}</strong></div>
    <div class="warning">${escapeHtml(documentPayload.notes || 'Final pricing must be confirmed by Tsa Bonno before payment activation.')}</div>
    ${documentPayload.payment_instructions ? `<div class="box" style="margin-top:18px"><div class="label">Payment instructions</div><p>${escapeHtml(documentPayload.payment_instructions)}</p></div>` : ''}
    <div class="footer">Generated by ${escapeHtml(APP_BRAND_NAME)} Command Central - ${escapeHtml(documentPayload.document_number || '')}</div>
  </div></body></html>`
}

function buildDetailedReportPdfHtml({ lodgeName, companyName, reportType, startDate, endDate, currency, generatedAt, data, reconciliation, outletLabel, extraData = {} }) {
  const sym = currency || 'P'
  const title = {
    bookings: 'Booking Register Report',
    payments: 'Payment Transactions Report',
    outstanding: 'Outstanding Balances Report',
    cancelled: 'Cancelled Bookings Report',
    refunds: 'Refunds Report',
    quotations: 'Quotations Report',
    invoices: 'Invoice Register Report',
    exceptions: 'Financial Exceptions Report',
    reconciliation: 'Reconciliation Controls Report',
    expenses: 'Expenses Report',
    pos: 'POS Sales Report',
    costs: 'Stock Costs Report',
    pl: 'Profit & Loss Statement'
  }[reportType] || 'Detailed Report'

  function money(v) { return `${sym} ${Number(v || 0).toFixed(2)}` }

  function table(headers, rows) {
    const ths = headers.map((h) => `<th style="padding:6px 10px;text-align:left;border-bottom:2px solid #333;font-size:11px;white-space:nowrap;background:#f8fafc">${escapeHtml(h)}</th>`).join('')
    const trs = rows.map((row) => {
      const tds = row.map((cell, i) => {
        const isMoney = typeof cell === 'number'
        return `<td style="padding:5px 10px;border-bottom:1px solid #e2e8f0;font-size:11px;${isMoney ? 'text-align:right;font-variant-numeric:tabular-nums' : ''}">${isMoney ? money(cell) : escapeHtml(String(cell ?? ''))}</td>`
      }).join('')
      return `<tr>${tds}</tr>`
    }).join('')
    return `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-family:system-ui,sans-serif"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`
  }

  let bodyContent = ''

  function summaryCard(label, value, sub, color) {
    const bg = color || '#f8fafc'
    return `<div style="flex:1;min-width:140px;padding:10px 14px;background:${bg};border:1px solid #e2e8f0;border-radius:6px">
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">${escapeHtml(label)}</div>
      <div style="font-size:16px;font-weight:700;color:#1e293b">${escapeHtml(String(value))}</div>
      ${sub ? `<div style="font-size:9px;color:#94a3b8;margin-top:2px">${escapeHtml(String(sub))}</div>` : ''}
    </div>`
  }

  // Report Info Header
  bodyContent += `
    <div style="margin-bottom:24px;padding-bottom:12px;border-bottom:2px solid #166534">
      <h1 style="font-size:18px;font-weight:700;color:#166534;margin:0">${escapeHtml(title)}</h1>
      <p style="font-size:12px;color:#666;margin:4px 0 0">${escapeHtml(lodgeName)}${companyName ? ' - ' + escapeHtml(companyName) : ''}</p>
      <p style="font-size:11px;color:#888;margin:4px 0 0">Period: ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</p>
      ${outletLabel ? `<p style="font-size:11px;color:#888;margin:2px 0 0">Outlet: ${escapeHtml(outletLabel)}</p>` : ''}
      <p style="font-size:10px;color:#999;margin:4px 0 0">Generated: ${escapeHtml(generatedAt)} | Currency: ${escapeHtml(sym)} | Data: Server-authoritative</p>
    </div>`

  // Date Basis
  const DATE_BASIS = {
    bookings: 'Booking check-in date within the selected period.',
    payments: 'Payment paid_at timestamp within the selected period.',
    cancelled: 'Booking cancelled_at timestamp within the selected period.',
    refunds: 'Refund approval created_at timestamp within the selected period.',
    outstanding: 'Current snapshot, limited by booking check-in period rule.',
    quotations: 'Quotation created_at timestamp within the selected period.',
    invoices: 'Invoice issued_at timestamp within the selected period.',
    exceptions: 'Detected across the selected period.',
    reconciliation: 'Summary of financial totals across the selected period.',
    expenses: 'Expense date within the selected period.',
    pos: 'POS order completion timestamp within the selected period.',
    costs: 'Purchase date within the selected period.',
    pl: 'Profit & Loss for the selected period.'
  }
  if (DATE_BASIS[reportType]) {
    bodyContent += `<p style="font-size:10px;color:#555;margin:0 0 16px;font-style:italic">Date basis: ${escapeHtml(DATE_BASIS[reportType])}</p>`
  }

  // Report-specific content
  if (reportType === 'bookings') {
    const bookings = data.bookings
    const rev = extraData.revenue || {}
    const occ = extraData.occupancy || []
    const profit = extraData.profitability || []

    // -- Compute from booking rows (fallback to revenue RPC) ----------------
    const totalRevenue = rev.total_revenue ?? bookings.reduce((s, b) => s + Number(b.gross_total || 0), 0)
    const totalPaid = rev.paid_revenue ?? bookings.reduce((s, b) => s + Number(b.lifetime_amount_paid || 0), 0)
    const totalOutstanding = rev.outstanding_amount ?? bookings.reduce((s, b) => s + Number(b.balance_due || 0), 0)
    const totalBookings = rev.total_bookings ?? bookings.length
    const avgBookingValue = rev.avg_booking_value ?? (totalBookings > 0 ? totalRevenue / totalBookings : 0)
    const confirmedCount = rev.confirmed_count ?? bookings.filter((b) => b.booking_status === 'confirmed').length
    const checkedInCount = rev.checked_in_count ?? bookings.filter((b) => b.booking_status === 'checked_in').length
    const checkedOutCount = rev.checked_out_count ?? bookings.filter((b) => b.booking_status === 'checked_out').length
    const cancelledCount = rev.cancelled_count ?? bookings.filter((b) => b.booking_status === 'cancelled').length
    const totalBookingCount = confirmedCount + checkedInCount + checkedOutCount + cancelledCount
    const paidCount = rev.paid_count ?? bookings.filter((b) => b.payment_status === 'paid').length
    const partialCount = rev.partial_count ?? bookings.filter((b) => b.payment_status === 'partial').length
    const unpaidCount = rev.unpaid_count ?? bookings.filter((b) => !b.payment_status || b.payment_status === 'unpaid').length
    const grossCollected = rev.gross_collected ?? 0
    const refundsIssued = rev.refunds_issued ?? 0
    const retainedRevenue = rev.retained_revenue ?? 0
    const bookingPaymentByMethod = rev.booking_payment_by_method || {}
    const eventCount = rev.event_count ?? bookings.filter((b) => b.booking_type === 'event').length
    const eventBookings = rev.event_bookings ?? []
    const eventRevenue = rev.event_revenue ?? bookings.filter((b) => b.booking_type === 'event').reduce((s, b) => s + Number(b.gross_total || 0), 0)
    const vatEnabled = rev.vat_enabled ?? false
    const vatRate = rev.vat_rate
    const vatAmount = rev.vat_amount ?? 0
    const netRevenue = rev.net_revenue ?? (totalRevenue - vatAmount)

    // -- Occupancy totals ----------------------------------------------------
    const totalOccupiedNights = occ.reduce((s, r) => s + Number(r.occupied_nights || 0), 0)
    const avgOccupancy = occ.length > 0 ? Math.round(occ.reduce((s, r) => s + Number(r.occupancy_rate || 0), 0) / occ.length) : 0
    const totalNights = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1)

    function statusRow(label, count, total, color) {
      const pct = total > 0 ? Math.round((count / total) * 100) : 0
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="width:80px;font-size:11px;color:#64748b">${escapeHtml(label)}</span>
        <div style="flex:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
          <div style="height:8px;width:${pct}%;background:${color};border-radius:4px"></div>
        </div>
        <span style="width:28px;text-align:right;font-size:11px;font-weight:600;color:#334155">${count}</span>
        <span style="width:32px;text-align:right;font-size:10px;color:#94a3b8">${pct}%</span>
      </div>`
    }

    // -- 1. Revenue Summary (6 cards) ---------------------------------------
    bodyContent += `
      <div style="margin:0 0 16px">
        <h2 style="font-size:13px;font-weight:700;color:#166534;margin:0 0 8px">Revenue Summary</h2>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${summaryCard('Total Revenue', `${sym} ${totalRevenue.toFixed(2)}`, `${totalBookings} bookings`)}
          ${summaryCard('Total Bookings', totalBookings, `${eventCount > 0 ? eventCount + ' events, ' : ''}${totalBookings - eventCount} rooms`)}
          ${summaryCard('Avg Booking Value', `${sym} ${avgBookingValue.toFixed(2)}`)}
          ${summaryCard('Avg Occupancy', `${avgOccupancy}%`, `${totalOccupiedNights} occupied nights / ${totalNights} total`)}
          ${summaryCard('Net Cash Collected', `${sym} ${totalPaid.toFixed(2)}`, `Refunds ${sym} ${refundsIssued.toFixed(2)} - kept ${sym} ${retainedRevenue.toFixed(2)}`)}
          ${summaryCard('Outstanding', `${sym} ${totalOutstanding.toFixed(2)}`, `${unpaidCount + partialCount} booking${(unpaidCount + partialCount) === 1 ? '' : 's'} still open`, totalOutstanding > 0 ? '#fff5f5' : '#f8fafc')}
        </div>
      </div>`

    // -- 2. VAT Breakdown ----------------------------------------------------
    if (vatEnabled) {
      const vatLabel = vatRate ? `VAT (${vatRate}% inclusive)` : 'VAT (mixed historical rates)'
      bodyContent += `
        <div style="margin:0 0 16px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px">
          <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:12px">
            <span style="color:#92400e;font-weight:600">${escapeHtml(vatLabel)}</span>
            <span style="color:#475569">Gross: <b style="color:#1e293b">${sym} ${totalRevenue.toFixed(2)}</b></span>
            <span style="color:#475569">VAT portion: <b style="color:#92400e">${sym} ${vatAmount.toFixed(2)}</b></span>
            <span style="color:#475569">Net (excl. VAT): <b style="color:#1e293b">${sym} ${netRevenue.toFixed(2)}</b></span>
          </div>
        </div>`
    }

    // -- 3. Booking Status Breakdown -----------------------------------------
    bodyContent += `
      <div style="margin:0 0 16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
        <h2 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 10px">Booking Status Breakdown</h2>
        ${statusRow('Confirmed', confirmedCount, totalBookingCount, '#3b82f6')}
        ${statusRow('Checked In', checkedInCount, totalBookingCount, '#22c55e')}
        ${statusRow('Checked Out', checkedOutCount, totalBookingCount, '#9ca3af')}
        ${statusRow('Cancelled', cancelledCount, totalBookingCount, '#f87171')}
      </div>`

    // -- 4. Cash Movement & Open Balances ------------------------------------
    bodyContent += `
      <div style="margin:0 0 16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
        <h2 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 10px">Cash Movement & Open Balances</h2>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          ${summaryCard('Net Cash', `${sym} ${totalPaid.toFixed(2)}`, '', '#ecfdf5')}
          ${summaryCard('Gross Receipts', `${sym} ${grossCollected.toFixed(2)}`)}
          ${summaryCard('Refunds', `${sym} ${refundsIssued.toFixed(2)}`, '', '#fff5f5')}
          ${summaryCard('Fees Kept from Refunds', `${sym} ${retainedRevenue.toFixed(2)}`, '', '#fffbeb')}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${summaryCard('Paid', paidCount, '', '#f0fdf4')}
          ${summaryCard('Partial', partialCount, '', '#fefce8')}
          ${summaryCard('Unpaid', unpaidCount, '', '#fff5f5')}
        </div>
        <p style="font-size:9px;color:#94a3b8;margin:8px 0 0">Revenue is based on booked stay value for this period. Cash movement is based on payment events recorded during this period, and fees kept from refunds are shown separately.</p>
      </div>`

    // -- 5. Booking Payment Methods ------------------------------------------
    if (Object.keys(bookingPaymentByMethod).length > 0) {
      const sortedMethods = Object.entries(bookingPaymentByMethod).sort(([, a], [, b]) => Number(b || 0) - Number(a || 0))
      let methodRows = ''
      for (const [method, amount] of sortedMethods) {
        const pct = grossCollected > 0 ? (Number(amount || 0) / grossCollected) * 100 : 0
        methodRows += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="width:100px;font-size:11px;color:#475569">${escapeHtml(method)}</span>
          <div style="flex:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
            <div style="height:8px;width:${Math.max(2, pct)}%;background:#10b981;border-radius:4px"></div>
          </div>
          <span style="width:90px;text-align:right;font-size:11px;font-weight:600;color:#1e293b">${sym} ${Number(amount || 0).toFixed(2)}</span>
          <span style="width:32px;text-align:right;font-size:10px;color:#94a3b8">${Math.round(pct)}%</span>
        </div>`
      }
      bodyContent += `
        <div style="margin:0 0 16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
          <h2 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 4px">Booking Payment Methods</h2>
          <p style="font-size:10px;color:#94a3b8;margin:0 0 10px">How booking money was collected across the selected period.</p>
          ${methodRows}
        </div>`
    }

    // -- 6. Exclusive Events -------------------------------------------------
    if (eventCount > 0) {
      let eventRows = ''
      for (const evt of eventBookings) {
        eventRows += `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:11px;border-bottom:1px solid #e2e8f0">
          <span style="color:#475569">${escapeHtml(evt.check_in)} -> ${escapeHtml(evt.check_out)} <span style="color:#6366f1;font-size:10px">${evt.nights} night${evt.nights !== 1 ? 's' : ''} - ${evt.room_count} room${evt.room_count !== 1 ? 's' : ''}</span></span>
          <span style="font-weight:600;color:#4f46e5">${sym} ${Number(evt.total || 0).toFixed(2)} <span style="color:#a5b4fc;font-size:10px">(${sym} ${Number(evt.daily_rate || 0).toLocaleString()}/night)</span></span>
        </div>`
      }
      bodyContent += `
        <div style="margin:0 0 16px;padding:14px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:6px">
          <h2 style="font-size:13px;font-weight:700;color:#4338ca;margin:0 0 8px">Exclusive Events (${eventCount})</h2>
          ${eventRows}
          <div style="display:flex;justify-content:space-between;padding-top:6px;font-size:12px;font-weight:700;color:#4338ca;border-top:2px solid #c7d2fe;margin-top:4px">
            <span>Event Revenue Total</span>
            <span>${sym} ${Number(eventRevenue).toFixed(2)}</span>
          </div>
        </div>`
    }

    // -- 7. Room Occupancy Table ---------------------------------------------
    if (occ.length > 0) {
      const bestRoom = occ.reduce((best, r) => Number(r.occupancy_rate || 0) > Number(best?.occupancy_rate || 0) ? r : best, null)
      let occRows = ''
      for (const room of occ) {
        const rate = Number(room.rate_per_night || 0)
        const nights = Number(room.occupied_nights || 0)
        const pct = Number(room.occupancy_rate || 0)
        const rev = Number(room.actual_revenue || 0)
        const barColor = pct >= 70 ? '#22c55e' : pct >= 30 ? '#facc15' : '#f87171'
        occRows += `<tr>
          <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:500;color:#1e293b">${room.has_event ? '<span style="background:#e0e7ff;color:#4f46e5;font-size:8px;padding:1px 4px;border-radius:3px;margin-right:4px">EVENT</span>' : ''}Room ${escapeHtml(String(room.room_number || ''))}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#475569">${escapeHtml(String(room.room_type || ''))}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#475569;text-align:right">${sym} ${rate.toFixed(2)}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#475569;text-align:right">${nights} / ${totalNights}</td>
          <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:11px">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:6px;background:#f1f5f9;border-radius:3px;overflow:hidden"><div style="height:6px;width:${pct}%;background:${barColor};border-radius:3px"></div></div>
              <span style="width:32px;text-align:right;font-size:10px;font-weight:600;color:#334155">${pct}%</span>
            </div>
          </td>
          <td style="padding:5px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:500;color:#1e293b;text-align:right">${sym} ${rev.toFixed(2)}</td>
        </tr>`
      }
      const occRevenueTotal = occ.reduce((s, r) => s + Number(r.actual_revenue || 0), 0)
      bodyContent += `
        <div style="margin:0 0 16px">
          <h2 style="font-size:13px;font-weight:700;color:#166534;margin:0 0 4px">Room Occupancy - ${totalNights}-day period</h2>
          ${bestRoom && bestRoom.occupancy_rate > 0 ? `<p style="font-size:10px;color:#22c55e;margin:0 0 8px">Best: Room ${escapeHtml(String(bestRoom.room_number))} (${bestRoom.occupancy_rate}%)</p>` : ''}
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead><tr style="background:#f8fafc">
              <th style="padding:5px 8px;text-align:left;border-bottom:2px solid #333;font-size:10px;color:#64748b">Room</th>
              <th style="padding:5px 8px;text-align:left;border-bottom:2px solid #333;font-size:10px;color:#64748b">Type</th>
              <th style="padding:5px 8px;text-align:right;border-bottom:2px solid #333;font-size:10px;color:#64748b">Rate / Night</th>
              <th style="padding:5px 8px;text-align:right;border-bottom:2px solid #333;font-size:10px;color:#64748b">Nights</th>
              <th style="padding:5px 8px;text-align:left;border-bottom:2px solid #333;font-size:10px;color:#64748b">Occupancy</th>
              <th style="padding:5px 8px;text-align:right;border-bottom:2px solid #333;font-size:10px;color:#64748b">Revenue</th>
            </tr></thead>
            <tbody>${occRows}</tbody>
            <tfoot><tr style="background:#f8fafc;border-top:2px solid #e2e8f0">
              <td colspan="3" style="padding:5px 8px;font-size:10px;font-weight:600;color:#64748b;text-transform:uppercase">Totals / Averages</td>
              <td style="padding:5px 8px;font-size:11px;font-weight:600;color:#334155;text-align:right">${totalOccupiedNights} nights total</td>
              <td style="padding:5px 8px;font-size:11px;font-weight:600;color:#334155">${avgOccupancy}% avg</td>
              <td style="padding:5px 8px;font-size:11px;font-weight:700;color:#16a34a;text-align:right">${sym} ${occRevenueTotal.toFixed(2)}</td>
            </tr></tfoot>
          </table>
        </div>`
    }

    // -- 8. Room Profitability Table -----------------------------------------
    if (profit.length > 0) {
      const topRoom = profit.reduce((best, r) => Number(r.contribution || 0) > Number(best?.contribution || 0) ? r : best, null)
      let profRows = ''
      for (const room of profit) {
        profRows += `<tr>
          <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;font-size:10px;font-weight:500;color:#1e293b">Room ${escapeHtml(String(room.room_number || ''))}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;font-size:10px;color:#475569;text-align:right">${Number(room.occupancy_rate || 0)}%</td>
          <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;font-size:10px;color:#1e293b;text-align:right;font-weight:500">${sym} ${Number(room.revenue || 0).toFixed(2)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;font-size:10px;color:#92400e;text-align:right">${sym} ${Number(room.supply_cost || 0).toFixed(2)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;font-size:10px;color:#b91c1c;text-align:right">${sym} ${Number(room.maintenance_cost || 0).toFixed(2)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;font-size:10px;color:#475569;text-align:right">${sym} ${Number(room.running_cost || 0).toFixed(2)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;font-size:10px;font-weight:600;color:${Number(room.contribution || 0) >= 0 ? '#16a34a' : '#b91c1c'};text-align:right">${sym} ${Number(room.contribution || 0).toFixed(2)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #e2e8f0;font-size:10px;color:#475569;text-align:right">${Number(room.margin_pct || 0)}%</td>
        </tr>`
      }
      bodyContent += `
        <div style="margin:0 0 16px">
          <h2 style="font-size:13px;font-weight:700;color:#166534;margin:0 0 4px">Room Profitability</h2>
          <p style="font-size:9px;color:#94a3b8;margin:0 0 8px">Revenue minus tracked room-supply cost and recorded maintenance cost.</p>
          ${topRoom && topRoom.contribution > 0 ? `<p style="font-size:10px;color:#059669;margin:0 0 6px">Top contribution: Room ${escapeHtml(String(topRoom.room_number))}</p>` : ''}
          <table style="width:100%;border-collapse:collapse;font-size:10px">
            <thead><tr style="background:#f8fafc">
              <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #333;font-size:9px;color:#64748b">Room</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:2px solid #333;font-size:9px;color:#64748b">Occupancy</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:2px solid #333;font-size:9px;color:#64748b">Revenue</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:2px solid #333;font-size:9px;color:#64748b">Supply</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:2px solid #333;font-size:9px;color:#64748b">Maint.</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:2px solid #333;font-size:9px;color:#64748b">Running</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:2px solid #333;font-size:9px;color:#64748b">Contribution</th>
              <th style="padding:4px 6px;text-align:right;border-bottom:2px solid #333;font-size:9px;color:#64748b">Margin</th>
            </tr></thead>
            <tbody>${profRows}</tbody>
          </table>
        </div>`
    }

    // -- 9. Collection Queue (outstanding bookings) --------------------------
    const openBookings = bookings.filter((b) => Number(b.balance_due || 0) > 0.01 && b.booking_status !== 'cancelled')
    if (openBookings.length > 0) {
      const sorted = [...openBookings].sort((a, b) => Number(b.balance_due || 0) - Number(a.balance_due || 0))
      let queueRows = ''
      for (const b of sorted.slice(0, 20)) {
        queueRows += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;margin-bottom:4px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;font-size:11px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <span style="font-weight:600;color:#1e293b">${escapeHtml(b.guest_name || 'Guest')}</span>
              <span style="font-size:9px;padding:1px 6px;border-radius:10px;background:${b.booking_status === 'checked_in' ? '#dcfce7;color:#166534' : b.booking_status === 'checked_out' ? '#f1f5f9;color:#475569' : '#fef3c7;color:#92400e'}">${escapeHtml(String(b.booking_status || 'confirmed').replace(/_/g, ' '))}</span>
              <span style="font-size:9px;padding:1px 6px;border-radius:10px;border:1px solid #fecaca;color:#b91c1c;background:#fff5f5">${sym} ${Number(b.balance_due || 0).toFixed(2)} due</span>
            </div>
            <div style="font-size:9px;color:#94a3b8;margin-top:2px">${b.booking_type === 'event' ? 'Full Lodge' : `Room ${escapeHtml(String(b.room_number || ''))}`} - ${escapeHtml(String(b.check_in || ''))} -> ${escapeHtml(String(b.check_out || ''))}</div>
          </div>
        </div>`
      }
      bodyContent += `
        <div style="margin:0 0 16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
          <h2 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 4px">Collection Queue</h2>
          <p style="font-size:10px;color:#94a3b8;margin:0 0 10px">Most urgent outstanding balances for the selected period.</p>
          ${queueRows}
          ${sorted.length > 20 ? `<p style="font-size:9px;color:#94a3b8;margin:6px 0 0">... and ${sorted.length - 20} more</p>` : ''}
        </div>`
    }

    // -- 10. Booking Details Table -------------------------------------------
    if (bookings.length > 0) {
      bodyContent += `
        <h2 style="font-size:13px;font-weight:700;color:#166534;margin:16px 0 8px">Booking Details</h2>`
      bodyContent += table(
        ['Booking #', 'Invoice #', 'Guest', 'Room', 'Type', 'Check-In', 'Check-Out', 'Nights', 'Status', 'Payment', `Gross (${sym})`, `Paid (${sym})`, `Balance (${sym})`, 'Method'],
        bookings.map((b) => [b.booking_number, b.invoice_number, b.guest_name, `${b.room_number || ''} (${b.room_type || ''})`, b.booking_type, b.check_in, b.check_out, b.nights, b.booking_status, b.payment_status, b.gross_total, b.lifetime_amount_paid, b.balance_due, b.payment_method_summary])
      )
    } else {
      bodyContent += '<p style="color:#888;font-style:italic">No booking records for this period.</p>'
    }
  } else if (reportType === 'payments' && data.payments.length > 0) {
    bodyContent += table(
      ['Timestamp', 'Booking #', 'Invoice #', 'Guest', 'Type', 'Method', `Amount (${sym})`, 'Recorded By'],
      data.payments.map((p) => [p.paid_at, p.booking_number, p.invoice_number, p.guest_name, p.transaction_type, p.payment_method, p.amount, p.recorded_by])
    )
  } else if (reportType === 'outstanding' && data.outstanding.length > 0) {
    bodyContent += table(
      ['Booking #', 'Invoice #', 'Guest', 'Room', 'Check-Out', `Gross (${sym})`, `Paid (${sym})`, `Balance (${sym})`, 'Status', 'Days Overdue', 'Aging'],
      data.outstanding.map((o) => [o.booking_number, o.invoice_number, o.guest_name, o.room_number, o.check_out, o.gross_total, o.amount_paid, o.balance_due, o.payment_status, o.days_overdue, o.aging_bucket])
    )
  } else if (reportType === 'cancelled' && data.cancelled.length > 0) {
    bodyContent += table(
      ['Booking #', 'Guest', 'Room', 'Original Dates', 'Nights', `Original (${sym})`, `Paid (${sym})`, 'Cancelled At', 'Reason', `Refund (${sym})`, `Retained (${sym})`, 'State'],
      data.cancelled.map((c) => [c.booking_number, c.guest_name, c.room_number, `${c.original_check_in} to ${c.original_check_out}`, c.nights, c.original_total, c.amount_paid_before, c.cancelled_at, c.cancellation_reason, c.refund_amount, c.retained_amount, c.final_state])
    )
  } else if (reportType === 'refunds' && data.refunds.length > 0) {
    bodyContent += table(
      ['Timestamp', 'Booking #', 'Guest', `Refund (${sym})`, `Retained (${sym})`, 'Retained %', 'Method', 'Approved By', 'Proof'],
      data.refunds.map((r) => [r.refund_timestamp, r.booking_number, r.guest_name, r.refund_amount, r.retained_amount, `${r.retained_percentage}%`, r.refund_method, r.approved_by, r.proof_reference])
    )
  } else if (reportType === 'quotations' && data.quotations.length > 0) {
    bodyContent += table(
      ['Quotation #', 'Guest', 'Type', 'Event / Group', 'Room', 'Check-In', 'Check-Out', 'Nights', `Daily Rate (${sym})`, `Total (${sym})`, 'Status', 'Created'],
      data.quotations.map((q) => [q.quotation_number, q.guest_name, q.quotation_type === 'exclusive_event' ? 'Event' : 'Room', q.event_group_name || '', q.room_number, q.check_in, q.check_out, q.nights, q.event_daily_rate || '', q.total, q.status, q.created_at])
    )
  } else if (reportType === 'invoices' && data.invoices.length > 0) {
    bodyContent += table(
      ['Invoice #', 'Booking #', 'Guest', 'Room', 'Check-In', 'Check-Out', `Gross (${sym})`, `Paid (${sym})`, `Balance (${sym})`, 'Payment Status', 'Delivery'],
      data.invoices.map((i) => [i.invoice_number, i.booking_number, i.guest_name, i.room_number, i.check_in, i.check_out, i.gross_total, i.amount_paid, i.balance_due, i.payment_status, i.delivery_status])
    )
  } else if (reportType === 'exceptions' && data.exceptions.length > 0) {
    bodyContent += table(
      ['Type', 'Severity', 'Entity', 'Number', 'Description', 'Expected', 'Actual', 'Variance'],
      data.exceptions.map((e) => [e.exception_type, e.severity, e.entity_type, e.entity_number, e.description, e.expected_value, e.actual_value, e.variance])
    )
  } else if (reportType === 'reconciliation') {
    const reconRows = [
      ['Gross Booking Value', money(reconciliation.grossBookingValue)],
      ['Gross Positive Receipts', money(reconciliation.positiveReceipts)],
      ['Refunds Issued', money(reconciliation.refundsIssued)],
      ['Net Cash Movement', money(reconciliation.netCash)],
      ['Retained Fees', money(reconciliation.retainedFees)],
      ['Outstanding Balances', money(reconciliation.outstandingBalances)],
      ['Payment Ledger Total', money(reconciliation.paymentLedgerTotal)],
      ['Booking Amount Paid Snapshot', money(reconciliation.bookingAmountPaidTotal)],
      ['Ledger vs Net Cash Variance', money(reconciliation.ledgerVariance)],
      ['Reconciliation Status', reconciliation.reconciliationStatus]
    ]
    bodyContent += table(['Metric', 'Value'], reconRows)
  } else if (reportType === 'expenses') {
    const expenses = extraData.expenses || []
    const maintenanceRows = extraData.maintenanceRows || []
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
    const totalMaintenance = maintenanceRows.reduce((s, m) => s + Number(m.actual_cost || m.total_cost || 0), 0)
    
    // Summary cards
    if (expenses.length > 0 || maintenanceRows.length > 0) {
      bodyContent += `
        <div style="margin:0 0 16px">
          <h2 style="font-size:13px;font-weight:700;color:#166534;margin:0 0 8px">Expenses Summary</h2>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${summaryCard('Operating Expenses', `${sym} ${totalExpenses.toFixed(2)}`, `${expenses.length} entries`)}
            ${summaryCard('Maintenance Costs', `${sym} ${totalMaintenance.toFixed(2)}`, `${maintenanceRows.length} tickets`)}
            ${summaryCard('Total', `${sym} ${(totalExpenses + totalMaintenance).toFixed(2)}`)}
          </div>
        </div>`
    }
    
    // By category breakdown
    if (expenses.length > 0) {
      const byCategory = {}
      expenses.forEach((e) => { byCategory[e.category || 'Other'] = (byCategory[e.category || 'Other'] || 0) + Number(e.amount || 0) })
      const sortedCats = Object.entries(byCategory).sort((a, b) => b[1] - a[1])
      let catRows = ''
      for (const [cat, amt] of sortedCats) {
        const pct = totalExpenses > 0 ? (amt / totalExpenses) * 100 : 0
        catRows += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="width:140px;font-size:11px;color:#475569">${escapeHtml(cat)}</span>
          <div style="flex:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
            <div style="height:8px;width:${Math.max(2, pct)}%;background:#f59e0b;border-radius:4px"></div>
          </div>
          <span style="width:90px;text-align:right;font-size:11px;font-weight:600;color:#1e293b">${sym} ${amt.toFixed(2)}</span>
          <span style="width:32px;text-align:right;font-size:10px;color:#94a3b8">${Math.round(pct)}%</span>
        </div>`
      }
      bodyContent += `
        <div style="margin:0 0 16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
          <h2 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 10px">By Category</h2>
          ${catRows}
        </div>`
    }
    
    if (expenses.length > 0) {
      bodyContent += '<h2 style="font-size:14px;color:#166534;margin:0 0 8px">Expenses</h2>'
      bodyContent += table(
        ['Date', 'Category', 'Description', `Amount (${sym})`],
        [...expenses.map((e) => [e.date || '', e.category || '', e.description || '', Number(e.amount || 0)]),
         ['TOTAL', '', '', totalExpenses]]
      )
    }
    if (maintenanceRows.length > 0) {
      bodyContent += '<h2 style="font-size:14px;color:#166534;margin:16px 0 8px">Maintenance Costs</h2>'
      bodyContent += table(
        ['Date', 'Title', 'Description', 'Room', 'Status', `Cost (${sym})`],
        [...maintenanceRows.map((m) => [m.reported_date || m.date || '', m.title || '', m.description || '', m.room_number || '', m.status || '', Number(m.actual_cost || m.total_cost || 0)]),
         ['TOTAL', '', '', '', '', totalMaintenance]]
      )
    }
    if (expenses.length === 0 && maintenanceRows.length === 0) {
      bodyContent += '<p style="color:#888;font-style:italic">No expense records for this period.</p>'
    }
  } else if (reportType === 'pos') {
    const posOrders = extraData.posOrders || []
    const posRevenue = extraData.posRevenue
    if (posRevenue) {
      bodyContent += `
        <div style="margin:0 0 16px">
          <h2 style="font-size:13px;font-weight:700;color:#166534;margin:0 0 8px">POS Revenue Summary</h2>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${summaryCard('Total Revenue', `${sym} ${(posRevenue.total_revenue || 0).toFixed(2)}`, `${posRevenue.total_orders || 0} orders`)}
            ${summaryCard('Avg Order Value', `${sym} ${(posRevenue.avg_order || 0).toFixed(2)}`)}
            ${summaryCard('Gross Sales', `${sym} ${(posRevenue.gross_revenue || 0).toFixed(2)}`)}
            ${summaryCard('Discounts', `${sym} ${(posRevenue.discount_total || 0).toFixed(2)}`, '', '#fff5f5')}
            ${summaryCard('Returns', `${sym} ${(posRevenue.returns_total || 0).toFixed(2)}`, '', '#fff5f5')}
            ${summaryCard('Tax/VAT', `${sym} ${(posRevenue.tax_total || 0).toFixed(2)}`)}
            ${summaryCard('Tips', `${sym} ${(posRevenue.tip_total || 0).toFixed(2)}`, '', '#ecfdf5')}
          </div>
        </div>`
      
      // By Payment Method
      const byPayment = posRevenue.by_payment || {}
      if (Object.keys(byPayment).length > 0) {
        const totalPayment = Object.values(byPayment).reduce((s, v) => s + Number(v || 0), 0)
        let methodRows = ''
        for (const [method, amount] of Object.entries(byPayment).sort((a, b) => b[1] - a[1])) {
          const pct = totalPayment > 0 ? (Number(amount || 0) / totalPayment) * 100 : 0
          methodRows += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="width:100px;font-size:11px;color:#475569">${escapeHtml(method)}</span>
            <div style="flex:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
              <div style="height:8px;width:${Math.max(2, pct)}%;background:#10b981;border-radius:4px"></div>
            </div>
            <span style="width:90px;text-align:right;font-size:11px;font-weight:600;color:#1e293b">${sym} ${Number(amount || 0).toFixed(2)}</span>
            <span style="width:32px;text-align:right;font-size:10px;color:#94a3b8">${Math.round(pct)}%</span>
          </div>`
        }
        bodyContent += `
          <div style="margin:0 0 16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
            <h2 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 10px">By Payment Method</h2>
            ${methodRows}
          </div>`
      }
      
      // By Operator
      const byCashier = posRevenue.by_cashier || {}
      if (Object.keys(byCashier).length > 0) {
        let cashierRows = ''
        for (const [name, amount] of Object.entries(byCashier).sort((a, b) => b[1] - a[1])) {
          cashierRows += `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-bottom:1px solid #e2e8f0">
            <span style="color:#475569">${escapeHtml(name)}</span>
            <span style="font-weight:600;color:#1e293b">${sym} ${Number(amount || 0).toFixed(2)}</span>
          </div>`
        }
        bodyContent += `
          <div style="margin:0 0 16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
            <h2 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 10px">By Operator</h2>
            ${cashierRows}
          </div>`
      }
      
      // Top Selling Items
      const topItems = posRevenue.top_items || []
      if (topItems.length > 0) {
        bodyContent += '<h2 style="font-size:13px;font-weight:700;color:#166534;margin:0 0 8px">Top Selling Items</h2>'
        bodyContent += table(
          ['#', 'Item', 'Qty Sold', `Revenue (${sym})`, `Margin (${sym})`],
          topItems.map((item, i) => [i + 1, item.name || '', item.qty || 0, Number(item.revenue || 0), item.margin != null ? Number(item.margin) : ''])
        )
      }
      
      // Daily Sales
      const daily = posRevenue.daily || []
      if (daily.length > 0) {
        let dailyRows = ''
        for (const d of daily) {
          const maxDaily = Math.max(...daily.map((x) => x.total || 0))
          const pct = maxDaily > 0 ? ((d.total || 0) / maxDaily) * 100 : 0
          dailyRows += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="width:80px;font-size:10px;color:#475569">${escapeHtml(d.date || '')}</span>
            <div style="flex:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
              <div style="height:8px;width:${Math.max(2, pct)}%;background:#6366f1;border-radius:4px"></div>
            </div>
            <span style="width:80px;text-align:right;font-size:11px;font-weight:600;color:#1e293b">${sym} ${(d.total || 0).toFixed(2)}</span>
          </div>`
        }
        bodyContent += `
          <div style="margin:0 0 16px;padding:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px">
            <h2 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 10px">Daily Sales</h2>
            ${dailyRows}
          </div>`
      }
    }
    if (posOrders.length > 0) {
      bodyContent += '<h2 style="font-size:14px;color:#166534;margin:16px 0 8px">POS Orders</h2>'
      bodyContent += table(
        ['Order #', 'Date', 'Status', `Total (${sym})`, 'Payment', 'Items'],
        posOrders.map((o) => [o.order_number || o.id || '', o.created_at || '', o.status || '', Number(o.total || 0), o.payment_method || '', (o.pos_order_items || o.items || []).length])
      )
    }
    if (posOrders.length === 0 && !posRevenue) {
      bodyContent += '<p style="color:#888;font-style:italic">No POS records for this period.</p>'
    }
  } else if (reportType === 'costs') {
    const invPurchases = extraData.inventoryPurchases || []
    const supPurchases = extraData.supplyPurchases || []
    const totalInv = invPurchases.reduce((s, p) => s + Number(p.total_cost || p.quantity_purchased * p.unit_cost || 0), 0)
    const totalSup = supPurchases.reduce((s, p) => s + Number(p.total_cost || p.quantity_purchased * p.unit_cost || 0), 0)
    
    // Summary cards
    if (invPurchases.length > 0 || supPurchases.length > 0) {
      bodyContent += `
        <div style="margin:0 0 16px">
          <h2 style="font-size:13px;font-weight:700;color:#166534;margin:0 0 8px">Stock Costs Summary</h2>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${summaryCard('Inventory Purchases', `${sym} ${totalInv.toFixed(2)}`, `${invPurchases.length} entries`)}
            ${summaryCard('Room Supplies', `${sym} ${totalSup.toFixed(2)}`, `${supPurchases.length} entries`)}
            ${summaryCard('Total Stock Costs', `${sym} ${(totalInv + totalSup).toFixed(2)}`)}
          </div>
        </div>`
    }
    
    if (invPurchases.length > 0) {
      bodyContent += '<h2 style="font-size:14px;color:#166534;margin:0 0 8px">Inventory Purchases</h2>'
      bodyContent += table(
        ['Date', 'Item', 'Category', 'Qty', `Unit Cost (${sym})`, `Total (${sym})`],
        [...invPurchases.map((p) => [p.date || p.purchased_at || '', p.item_name || p.inventory_items?.name || '', p.category || p.inventory_items?.category || '', p.quantity_purchased || 0, Number(p.unit_cost || 0), Number(p.total_cost || p.quantity_purchased * p.unit_cost || 0)]),
         ['TOTAL', '', '', '', '', totalInv]]
      )
    }
    if (supPurchases.length > 0) {
      bodyContent += '<h2 style="font-size:14px;color:#166534;margin:16px 0 8px">Room Supply Purchases</h2>'
      bodyContent += table(
        ['Date', 'Item', 'Qty', `Unit Cost (${sym})`, `Total (${sym})`],
        [...supPurchases.map((p) => [p.date || p.purchased_at || '', p.item_name || p.supply_items?.name || '', p.quantity_purchased || 0, Number(p.unit_cost || 0), Number(p.total_cost || p.quantity_purchased * p.unit_cost || 0)]),
         ['TOTAL', '', '', '', totalSup]]
      )
    }
    if (invPurchases.length === 0 && supPurchases.length === 0) {
      bodyContent += '<p style="color:#888;font-style:italic">No purchase records for this period.</p>'
    }
  } else if (reportType === 'pl') {
    const pl = extraData.profitLoss
    if (pl) {
      bodyContent += '<h2 style="font-size:14px;color:#166534;margin:0 0 8px">Profit & Loss Statement</h2>'
      const plRows = [
        ['Booking Revenue', Number(pl.bookingRevenue || 0)],
        ['Fees Kept From Refunds', Number(pl.retainedRevenue || 0)],
        ['POS Revenue', Number(pl.posRevenue || 0)],
      ]
      if (pl.conferenceRevenue > 0) plRows.push(['Conference Revenue', Number(pl.conferenceRevenue)])
      if (pl.poolRevenue > 0) plRows.push(['Day Use / Facility Access', Number(pl.poolRevenue)])
      plRows.push(
        ['Total Revenue', Number(pl.totalRevenue || 0)],
        [],
        ['Operating Expenses', Number(pl.totalExpenses || 0)],
        ['Inventory Purchases', Number(pl.invCosts || 0)],
        ['Room Supplies', Number(pl.supCosts || 0)],
        ['Maintenance Repairs', Number(pl.maintenanceCosts || 0)],
        ['Total Costs', Number(pl.totalCosts || 0)],
        ['Total Outgoings', Number((pl.totalExpenses || 0) + (pl.totalCosts || 0))],
        [],
        ['GROSS PROFIT', Number(pl.grossProfit || 0)],
        ['Gross Margin %', `${Number(pl.grossMarginPct || 0).toFixed(1)}%`]
      )
      bodyContent += table(['Line Item', `Amount (${sym})`], plRows.filter((r) => r.length > 0))
      if (pl.totalBookings > 0) {
        bodyContent += '<h3 style="font-size:12px;color:#555;margin:12px 0 6px">Key Metrics</h3>'
        bodyContent += table(['Metric', 'Value'], [
          ['Bookings', String(pl.totalBookings)],
          [`Avg Booking Value (${sym})`, Number(pl.avgBookingValue || 0).toFixed(2)],
          [`Refunds Issued (${sym})`, Number(pl.refundsIssued || 0).toFixed(2)],
          [`Outstanding (${sym})`, Number(pl.outstandingAmount || 0).toFixed(2)]
        ])
      }
    } else {
      bodyContent += '<p style="color:#888;font-style:italic">No P&L data available for this period.</p>'
    }
  } else if (reportType === 'prepayments') {
    const credits = extraData.credits || []
    if (credits.length > 0) {
      const totalBalance = credits.reduce((s, c) => s + Number(c.balance || 0), 0)
      bodyContent += `
        <div style="margin:0 0 16px">
          <h2 style="font-size:13px;font-weight:700;color:#166534;margin:0 0 8px">Customer Credit Summary</h2>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${summaryCard('Total Liability', `${sym} ${totalBalance.toFixed(2)}`, `${credits.length} customers`)}
          </div>
        </div>`
      bodyContent += table(
        ['Customer', `Received (${sym})`, `Allocated (${sym})`, `Refunded (${sym})`, `Balance (${sym})`, 'Last Activity'],
        credits.map((c) => [c.customer_name || '', Number(c.total_receipts || 0), Number(c.total_allocations || 0), Number(c.total_refunds || 0), Number(c.balance || 0), c.last_activity || ''])
      )
    } else {
      bodyContent += '<p style="color:#888;font-style:italic">No customer credit records for this period.</p>'
    }
  } else {
    bodyContent += '<p style="color:#888;font-style:italic">No data available for this report in the selected period.</p>'
  }

  // Reconciliation footer
  bodyContent += `
    <div style="margin-top:32px;padding-top:12px;border-top:2px solid #e2e8f0;font-size:10px;color:#888">
      <p style="margin:0"><strong>Reconciliation:</strong> ${escapeHtml(reconciliation.reconciliationStatus)} | Ledger variance: ${money(reconciliation.ledgerVariance)}</p>
      <p style="margin:4px 0 0">Server as-of: ${escapeHtml(reconciliation.asOf)} | Generated by: ${escapeHtml(APP_BRAND_NAME)} Desktop v${escapeHtml('2.0')}</p>
      <p style="margin:4px 0 0;font-style:italic">Confidential - For internal use only. This report is server-authoritative.</p>
    </div>`

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} - ${escapeHtml(lodgeName)}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; font-size: 12px; color: #1e293b; line-height: 1.4; margin: 0; padding: 20px; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`
}

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function getPosOrderItems(order = {}) {
  return Array.isArray(order.pos_order_items)
    ? order.pos_order_items
    : Array.isArray(order.items)
      ? order.items
      : []
}

function getPosOrderPayments(order = {}) {
  const payments = parseMaybeJsonArray(order.payment_breakdown)
  if (payments.length) return payments
  return order.payment_method ? [{ method: order.payment_method, amount: Number(order.total || 0), reference: '' }] : []
}

function getPosOrderCustomer(order = {}) {
  if (order.walk_in_name) return order.walk_in_name
  if (order.room_id) return 'Room Guest'
  return ''
}

function getPosOrderOutletName(order = {}) {
  return order.outlets?.name || order.outlet_name || ''
}

function getPosOrderSyncState(order = {}) {
  if (order?._sync_state === 'failed') return 'failed'
  if (order?._sync_state === 'pending') return 'pending'
  if (order?._sync_state === 'manual_review_required') return 'needs_attention'
  if (order?._pending_sync === true) return 'pending'
  return 'synced'
}

function getPosHistorySummary(orders = []) {
  const activeOrders = orders.filter((order) => order.status !== 'voided')
  const voidedOrders = orders.filter((order) => order.status === 'voided')
  const paymentTotals = {}
  for (const order of activeOrders) {
    for (const payment of getPosOrderPayments(order)) {
      const method = payment.method || order.payment_method || 'unknown'
      paymentTotals[method] = (paymentTotals[method] || 0) + Number(payment.amount || 0)
    }
  }
  return {
    orderCount: orders.length,
    activeCount: activeOrders.length,
    voidedCount: voidedOrders.length,
    grossTotal: activeOrders.reduce((sum, order) => sum + Number(order.gross_total || order.total || 0), 0),
    discountTotal: activeOrders.reduce((sum, order) => sum + Number(order.discount_total || 0), 0),
    taxTotal: activeOrders.reduce((sum, order) => sum + Number(order.tax_total || 0), 0),
    tipTotal: activeOrders.reduce((sum, order) => sum + Number(order.tip_total || 0), 0),
    netTotal: activeOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    paymentTotals
  }
}

function buildPosHistoryPdfHtml({
  reportTitle = 'POS History',
  lodgeName = '',
  companyName = '',
  periodLabel = '',
  generatedAt = new Date().toLocaleString(),
  currency = 'P',
  orders = [],
  voidHistory = []
} = {}) {
  const resolvedLodge = lodgeName || companyName || APP_BRAND_NAME
  const summary = getPosHistorySummary(orders)
  const fmt = (value) => formatReportMoney(currency, value)
  const orderRows = orders.length
    ? orders.map((order) => `
      <tr>
        <td>${escapeHtml(order.created_at ? new Date(order.created_at).toLocaleString() : '')}</td>
        <td>${escapeHtml(getPosOrderCustomer(order))}</td>
        <td>${escapeHtml(getPosOrderOutletName(order))}</td>
        <td>${escapeHtml(order.payment_method || '')}</td>
        <td>${escapeHtml(order.status || '')}</td>
        <td class="num">${escapeHtml(fmt(order.total || 0))}</td>
        <td class="num">${escapeHtml(getPosOrderItems(order).length)}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="7" class="empty">No POS orders in this period.</td></tr>'
  const itemRows = orders.flatMap((order) => getPosOrderItems(order).map((item) => ({ order, item }))).slice(0, 250)
  const itemTableRows = itemRows.length
    ? itemRows.map(({ order, item }) => `
      <tr>
        <td>${escapeHtml(order.created_at ? new Date(order.created_at).toLocaleString() : '')}</td>
        <td>${escapeHtml(getPosOrderOutletName(order))}</td>
        <td>${escapeHtml(item.item_name || item.name || '')}</td>
        <td class="num">${escapeHtml(Number(item.quantity || 0))}</td>
        <td class="num">${escapeHtml(fmt(item.unit_price || item.price || 0))}</td>
        <td class="num">${escapeHtml(fmt(item.subtotal || (Number(item.quantity || 0) * Number(item.unit_price || item.price || 0))))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="6" class="empty">No item lines.</td></tr>'
  const voidRows = voidHistory.length
    ? voidHistory.map((row) => `
      <tr>
        <td>${escapeHtml(row.created_at ? new Date(row.created_at).toLocaleString() : '')}</td>
        <td>${escapeHtml(row.order_id || '')}</td>
        <td>${escapeHtml(row.approver_name || row.approved_by || '')}</td>
        <td>${escapeHtml(row.reason || '')}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="4" class="empty">No voids in this period.</td></tr>'
  const paymentCards = Object.entries(summary.paymentTotals).map(([method, amount]) => `
    <div class="card"><div class="label">${escapeHtml(method)}</div><div class="value">${escapeHtml(fmt(amount))}</div></div>
  `).join('')
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(reportTitle)}</title>
      <style>
        @page { size: A4; margin: 14mm; }
        * { box-sizing: border-box; }
        body { color: #0f172a; font-family: Arial, sans-serif; font-size: 11px; margin: 0; }
        header { border-bottom: 2px solid #0f172a; margin-bottom: 16px; padding-bottom: 12px; }
        h1 { font-size: 22px; margin: 0 0 4px; }
        h2 { font-size: 14px; margin: 18px 0 8px; }
        .meta { color: #475569; display: flex; flex-wrap: wrap; gap: 8px 18px; }
        .cards { display: grid; gap: 8px; grid-template-columns: repeat(4, 1fr); margin: 12px 0; }
        .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 9px; }
        .label { color: #64748b; font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
        .value { font-size: 15px; font-weight: 800; margin-top: 4px; }
        table { border-collapse: collapse; page-break-inside: auto; width: 100%; }
        tr { page-break-inside: avoid; }
        th { background: #f1f5f9; color: #475569; font-size: 9px; letter-spacing: .08em; text-align: left; text-transform: uppercase; }
        th, td { border-bottom: 1px solid #e2e8f0; padding: 6px; vertical-align: top; }
        .num { text-align: right; white-space: nowrap; }
        .empty { color: #64748b; padding: 16px; text-align: center; }
        .section { break-inside: avoid; margin-top: 14px; }
      </style>
    </head>
    <body>
      <header>
        <h1>${escapeHtml(resolvedLodge)} - ${escapeHtml(reportTitle)}</h1>
        <div class="meta">
          ${companyName && companyName !== resolvedLodge ? `<div>${escapeHtml(companyName)}</div>` : ''}
          <div>Period: ${escapeHtml(periodLabel)}</div>
          <div>Generated: ${escapeHtml(generatedAt)}</div>
        </div>
      </header>
      <div class="cards">
        <div class="card"><div class="label">Orders</div><div class="value">${escapeHtml(summary.orderCount)}</div></div>
        <div class="card"><div class="label">Active</div><div class="value">${escapeHtml(summary.activeCount)}</div></div>
        <div class="card"><div class="label">Voids</div><div class="value">${escapeHtml(summary.voidedCount)}</div></div>
        <div class="card"><div class="label">Net Total</div><div class="value">${escapeHtml(fmt(summary.netTotal))}</div></div>
      </div>
      ${paymentCards ? `<div class="cards">${paymentCards}</div>` : ''}
      <section class="section">
        <h2>Orders</h2>
        <table>
          <thead><tr><th>Time</th><th>Customer</th><th>Outlet</th><th>Payment</th><th>Status</th><th class="num">Total</th><th class="num">Items</th></tr></thead>
          <tbody>${orderRows}</tbody>
        </table>
      </section>
      <section class="section">
        <h2>Item Lines</h2>
        <table>
          <thead><tr><th>Time</th><th>Outlet</th><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Subtotal</th></tr></thead>
          <tbody>${itemTableRows}</tbody>
        </table>
      </section>
      <section class="section">
        <h2>Voids</h2>
        <table>
          <thead><tr><th>Time</th><th>Order</th><th>Approver</th><th>Reason</th></tr></thead>
          <tbody>${voidRows}</tbody>
        </table>
      </section>
    </body>
  </html>`
}

function buildRoomSuppliesPdfHtml({
  reportTitle,
  lodgeName,
  companyName,
  periodLabel,
  generatedAt,
  currency,
  grandTotal,
  allocations = [],
  byRoom = [],
  byItem = []
} = {}) {
  const resolvedTitle = reportTitle || 'Room Supplies Report'
  const resolvedLodge = lodgeName || companyName || APP_BRAND_NAME
  const resolvedCompany = companyName && companyName !== resolvedLodge ? companyName : ''
  const rows = Array.isArray(allocations) ? allocations : []
  const roomRows = Array.isArray(byRoom) ? byRoom : []
  const itemRows = Array.isArray(byItem) ? byItem : []
  const fmtMoney = (value) => formatReportMoney(currency || 'P', value)
  const usageTable = rows.length
    ? rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.entry_date || row.week_start || '')}</td>
          <td>${escapeHtml(row.room_number || '')}</td>
          <td>${escapeHtml(row.supply_name || '')}</td>
          <td>${escapeHtml(row.supply_category || '')}</td>
          <td class="num">${escapeHtml(Number(row.units_used || 0))}</td>
          <td>${escapeHtml(row.supply_unit || '')}</td>
          <td class="num">${escapeHtml(fmtMoney(row.unit_cost || 0))}</td>
          <td class="num">${escapeHtml(fmtMoney(row.total_cost || 0))}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="8" class="empty">No room supply usage was recorded in this period.</td></tr>'
  const roomTable = roomRows.length
    ? roomRows.map((row) => `
        <tr>
          <td>Room ${escapeHtml(row.room_number || '')}</td>
          <td class="num">${escapeHtml(fmtMoney(row.total || row.total_cost || 0))}</td>
          <td class="num">${escapeHtml(Number(row.item_count || 0))}</td>
          <td class="num">${escapeHtml(Number(row.total_units || 0))}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4" class="empty">No room totals to show for this period.</td></tr>'
  const itemTable = itemRows.length
    ? itemRows.map((row) => `
        <tr>
          <td>${escapeHtml(row.name || '')}</td>
          <td>${escapeHtml(row.unit || '')}</td>
          <td class="num">${escapeHtml(Number(row.total_units || 0))}</td>
          <td class="num">${escapeHtml(Number(row.room_count || 0))}</td>
          <td class="num">${escapeHtml(fmtMoney(row.total_cost || 0))}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="5" class="empty">No supply item totals to show for this period.</td></tr>'

  return `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(resolvedTitle)}</title>
      <style>
        @page { size: A4; margin: 16mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Arial, Helvetica, sans-serif;
          color: #0f172a;
          background: #fff;
          font-size: 12px;
          line-height: 1.45;
        }
        .page { width: 100%; }
        .header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          border-bottom: 2px solid #15803d;
          padding-bottom: 12px;
          margin-bottom: 16px;
        }
        .eyebrow {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: #047857;
          font-weight: 700;
          margin-bottom: 6px;
        }
        h1 {
          margin: 0;
          font-size: 20px;
          line-height: 1.2;
        }
        .meta {
          margin-top: 6px;
          color: #475569;
        }
        .meta div { margin-top: 2px; }
        .generated {
          color: #64748b;
          font-size: 11px;
          text-align: right;
          white-space: nowrap;
        }
        .summary {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 16px;
        }
        .card {
          border: 1px solid #dbe4ee;
          border-radius: 10px;
          padding: 10px 12px;
          background: #f8fafc;
        }
        .card .label {
          color: #64748b;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          font-weight: 700;
        }
        .card .value {
          margin-top: 6px;
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
        }
        .section {
          margin-top: 14px;
          page-break-inside: avoid;
        }
        .section h2 {
          margin: 0 0 8px;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #475569;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }
        th, td {
          border: 1px solid #dbe4ee;
          padding: 6px 8px;
          vertical-align: top;
        }
        th {
          background: #f1f5f9;
          color: #334155;
          text-align: left;
        }
        td.num, th.num { text-align: right; white-space: nowrap; }
        tr:nth-child(even) td { background: #fafcff; }
        .empty {
          text-align: center;
          color: #64748b;
          font-style: italic;
          padding: 12px 8px;
        }
        .note {
          margin-top: 12px;
          color: #64748b;
          font-size: 10px;
        }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="header">
          <div>
            <div class="eyebrow">Report Export</div>
            <h1>${escapeHtml(resolvedLodge)} - ${escapeHtml(resolvedTitle)}</h1>
            ${resolvedCompany ? `<div class="meta"><div>${escapeHtml(resolvedCompany)}</div></div>` : ''}
            <div class="meta"><div>Period: ${escapeHtml(periodLabel || '')}</div></div>
          </div>
          <div class="generated">Generated: ${escapeHtml(generatedAt || new Date().toLocaleString())}</div>
        </div>

        <div class="summary">
          <div class="card"><div class="label">Total Supply Cost</div><div class="value">${escapeHtml(fmtMoney(grandTotal))}</div></div>
          <div class="card"><div class="label">Rooms Captured</div><div class="value">${roomRows.length}</div></div>
          <div class="card"><div class="label">Supply Items Used</div><div class="value">${itemRows.length}</div></div>
          <div class="card"><div class="label">Usage Entries</div><div class="value">${rows.length}</div></div>
        </div>

        <div class="section">
          <h2>Usage Entries</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Room</th>
                <th>Supply Item</th>
                <th>Category</th>
                <th class="num">Units Used</th>
                <th>Unit</th>
                <th class="num">Unit Cost</th>
                <th class="num">Total Cost</th>
              </tr>
            </thead>
            <tbody>${usageTable}</tbody>
          </table>
        </div>

        <div class="section">
          <h2>Cost By Room</h2>
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th class="num">Supply Cost</th>
                <th class="num">Items Logged</th>
                <th class="num">Units Used</th>
              </tr>
            </thead>
            <tbody>${roomTable}</tbody>
          </table>
        </div>

        <div class="section">
          <h2>Cost By Item</h2>
          <table>
            <thead>
              <tr>
                <th>Supply Item</th>
                <th>Unit</th>
                <th class="num">Units Used</th>
                <th class="num">Rooms Logged</th>
                <th class="num">Total Cost</th>
              </tr>
            </thead>
            <tbody>${itemTable}</tbody>
          </table>
        </div>

        <div class="note">Room Supplies cost report generated from live allocation history.</div>
      </div>
    </body>
  </html>`
}

// -- Push notification helper -------------------------------------------------
const EDGE_FN_URL = process.env.SUPABASE_URL
  ? `${process.env.SUPABASE_URL}/functions/v1`
  : null
const PUSH_FUNCTION_SECRET = process.env.PUSH_FUNCTION_SECRET || process.env.BOROKO_PUSH_FUNCTION_SECRET || ''

function notifyLodge(lodgeId, title, body, options = {}) {
  showDesktopNotification({ title, body, sound: true, flash: true })
  if (!EDGE_FN_URL || !lodgeId || !PUSH_FUNCTION_SECRET) return
  fetch(`${EDGE_FN_URL}/send-push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
      'x-boroko-function-secret': PUSH_FUNCTION_SECRET
    },
    body: JSON.stringify({
      lodge_id: lodgeId,
      title,
      body,
      url: options.url,
      tag: options.tag,
      dedupeKey: options.dedupeKey,
      version: options.version
    })
  }).catch(() => {})
}

function showDesktopNotification({ title = APP_BRAND_NAME, body = '', sound = true, flash = true } = {}) {
  const safeTitle = String(title || APP_BRAND_NAME)
  const safeBody = String(body || '')

  try {
    if (sound !== false) shell.beep()
  } catch {}

  try {
    if (flash !== false) {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.flashFrame(true)
          setTimeout(() => {
            try {
              if (!win.isDestroyed()) win.flashFrame(false)
            } catch {}
          }, 4500)
        }
      })
    }
  } catch {}

  try {
    if (Notification.isSupported()) {
      new Notification({
        title: safeTitle,
        body: safeBody,
        silent: sound === false
      }).show()
    }
  } catch (error) {
    console.warn('Desktop notification failed:', error?.message || error)
  }
}

// -- Auto-updater setup -------------------------------------------------------
autoUpdater.autoDownload = false       // let the user review the release before downloading
autoUpdater.autoInstallOnAppQuit = true // install when user quits naturally

const updateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  version: null,
  releaseName: '',
  releaseDate: '',
  releaseNotes: '',
  progress: null,
  error: ''
}

function normalizeReleaseNotes(notes) {
  if (!notes) return ''
  if (typeof notes === 'string') return notes.trim()
  if (Array.isArray(notes)) {
    return notes
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim()
        if (!entry || typeof entry !== 'object') return ''
        return String(entry.note || entry.text || entry.name || '').trim()
      })
      .filter(Boolean)
      .join('\n\n')
      .trim()
  }
  if (typeof notes === 'object') {
    return String(notes.note || notes.text || notes.name || '').trim()
  }
  return String(notes).trim()
}

function setUpdateState(patch = {}) {
  Object.assign(updateState, patch)
  updateState.currentVersion = app.getVersion()
  return { ...updateState }
}

function getDesktopDeviceIdForUpdater() {
  try {
    const source = app?.getPath?.('userData') || 'boroko-desktop'
    return crypto.createHash('sha256').update(String(source)).digest('hex').slice(0, 24)
  } catch { return 'desktop-unknown' }
}

async function gateUpdateCheck() {
  try {
    const res = await db.checkUpdateAvailability(app.getVersion(), getDesktopDeviceIdForUpdater())
    if (!res?.ok) {
      throw new Error(res?.error || 'Command Central update gate was unavailable')
    }
    if (res?.update_available) {
      console.log(`[Updater] RPC gate: update to v${res.latest_version} allowed (force=${res.force_update})`)
      return true
    }
    console.log('[Updater] RPC gate: no update offered by Command Central')
    return false
  } catch (err) {
    console.warn('[Updater] RPC gate check failed, allowing fallback:', err?.message)
    return true // fail-open: if RPC is unreachable, allow normal update flow
  }
}

function setupAutoUpdater(mainWindow) {
  // Only run in production (not dev mode)
  if (is.dev) return

  autoUpdater.on('update-available', (info) => {
    const payload = setUpdateState({
      phase: 'available',
      version: info.version,
      releaseName: info.releaseName || '',
      releaseDate: info.releaseDate || '',
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      progress: null,
      error: ''
    })
    mainWindow.webContents.send('update:available', payload)
  })

  autoUpdater.on('update-not-available', (info) => {
    const payload = setUpdateState({
      phase: 'uptodate',
      version: info?.version || app.getVersion(),
      releaseName: '',
      releaseDate: '',
      releaseNotes: '',
      progress: null,
      error: ''
    })
    mainWindow.webContents.send('update:not-available', payload)
  })

  autoUpdater.on('download-progress', (progress) => {
    const progressPayload = {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    }
    const payload = setUpdateState({
      phase: 'downloading',
      progress: progressPayload,
      error: ''
    })
    mainWindow.webContents.send('update:progress', { ...payload, ...progressPayload })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const payload = setUpdateState({
      phase: 'ready',
      version: info.version,
      releaseName: info.releaseName || updateState.releaseName,
      releaseDate: info.releaseDate || updateState.releaseDate,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes) || updateState.releaseNotes,
      error: ''
    })
    mainWindow.webContents.send('update:ready', payload)
  })

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message)
    const payload = setUpdateState({
      phase: 'error',
      error: err?.message || 'Could not check for updates.'
    })
    mainWindow.webContents.send('update:error', {
      ...payload,
      message: err?.message || 'Could not check for updates.'
    })
  })

  // Check on startup (after a short delay so the app feels snappy)
  setTimeout(async () => {
    if (await gateUpdateCheck()) autoUpdater.checkForUpdates()
  }, 8000)

  // Then re-check every 4 hours (gated through Command Central rollout)
  setInterval(async () => {
    if (await gateUpdateCheck()) autoUpdater.checkForUpdates()
  }, 4 * 60 * 60 * 1000)
}

function createWindow() {
  const existingSplashWindow = activeSplashWindow && !activeSplashWindow.isDestroyed()
    ? activeSplashWindow
    : null
  const appIcon = createAppLogoNativeImage() || undefined
  const splashWindow = existingSplashWindow || createStartupSplashWindow()

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: APP_WINDOW_TITLE,
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: APP_TITLE_BAR_COLOR,
            symbolColor: '#ffffff',
            height: 36
          }
        }
      : {}),
    icon: appIcon,
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      // sandbox: false required - electron-vite preload uses ESM imports resolved
      // via Node module system, incompatible with sandbox: true in dev HTTP mode.
      // Security enforced via contextIsolation: true (contextBridge) + nodeIntegration: false.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  // -- Proactive Ops AI watcher (lightweight) ---------------------------------
  // Emits ai:alert events to the renderer so Ops AI feels "alive" across screens.
  let aiWatcherTimer = null
  let lastAttentionSignature = ''

  const emitAiAlert = (payload) => {
    try {
      mainWindow?.webContents?.send('ai:alert', payload)
    } catch {
      // non-fatal
    }
  }

  const computeAttention = async () => {
    // Keep this lightweight; it reads dashboard data, so avoid hot polling.
    // We start with existing dashboard stats + upcoming checkouts heuristics.
    const stats = await db.getDashboardStats().catch(() => null)
    const upcoming = await db.getUpcomingCheckins().catch(() => ({ today: [], tomorrow: [], dayAfter: [] }))

    const unpaidCount = Number(stats?.unpaid_count || stats?.unpaidCount || 0)
    const outstandingTotal = Number(stats?.outstanding_total || stats?.outstandingTotal || 0)
    const checkoutsToday = Array.isArray(upcoming?.today)
      ? upcoming.today.filter((b) => String(b.check_out || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length
      : 0

    return {
      unpaidCount,
      outstandingTotal,
      checkoutsToday
    }
  }

  const startAiWatcher = () => {
    if (BUILD_PRODUCT_ID === 'hospitality-pos') return
    if (aiWatcherTimer) return
    aiWatcherTimer = setInterval(async () => {
      try {
        const user = db.getCurrentUser?.() || null
        if (!user) return // no session

        const attention = await computeAttention()
        const signature = JSON.stringify(attention)
        if (signature === lastAttentionSignature) return
        lastAttentionSignature = signature

        // Emit targeted alerts (proactive suggestions)
        if (attention.unpaidCount > 0) {
          emitAiAlert({
            key: `unpaid:${attention.unpaidCount}:${Math.round(attention.outstandingTotal)}`,
            type: 'unpaid',
            title: 'Unpaid bookings',
            message: `${attention.unpaidCount} booking(s) still owe money. Outstanding ~${(attention.outstandingTotal || 0).toFixed(2)}.`,
            action: { label: 'Review', prompt: 'Show unpaid bookings.' },
            badge: Math.min(99, attention.unpaidCount)
          })
        }
      } catch {
        // silent: watcher is best-effort
      }
    }, 5 * 60_000)

    // Initial pulse a few seconds after boot
    setTimeout(() => {
      computeAttention().then((attention) => {
        const unpaidCount = Number(attention?.unpaidCount || 0)
        const outstandingTotal = Number(attention?.outstandingTotal || 0)
        if (unpaidCount > 0) {
          emitAiAlert({
            key: `briefing:unpaid:${unpaidCount}:${Math.round(outstandingTotal)}`,
            type: 'briefing',
            title: 'Daily briefing',
            message: `${unpaidCount} unpaid booking(s) detected. Tap to open Ops AI.`,
            action: { label: 'Open', prompt: "What needs my attention right now?" },
            badge: Math.min(99, unpaidCount)
          })
        }
      }).catch(() => {})
    }, 6000)
  }

  let didShowWindow = false
  let splashClosed = false
  const closeSplashWindow = () => {
    if (splashClosed || splashWindow.isDestroyed()) return
    splashClosed = true
    try {
      splashWindow.destroy()
    } catch {
      // best-effort
    }
  }
  const showWindowSafely = (reason) => {
    if (didShowWindow || mainWindow.isDestroyed()) return
    didShowWindow = true
    if (INPUT_FOCUS_DEBUG) console.log('[WINDOW] show requested:', reason)
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.focus()
    closeSplashWindow()
  }

  mainWindow.on('ready-to-show', () => {
    if (INPUT_FOCUS_DEBUG) console.log('[WINDOW] ready-to-show')
    showWindowSafely('ready-to-show')
    closeSplashWindow()
  })

  // If the renderer gets slow or partially fails, do not leave the app hidden forever.
  setTimeout(() => {
    showWindowSafely('startup-timeout')
    closeSplashWindow()
  }, 1800)

  mainWindow.on('show', closeSplashWindow)
  mainWindow.on('closed', closeSplashWindow)
  mainWindow.webContents.on('dom-ready', closeSplashWindow)
  mainWindow.webContents.on('did-finish-load', closeSplashWindow)
  mainWindow.webContents.on('did-stop-loading', closeSplashWindow)

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

  try {
    ipcMain.removeHandler('window:repairInputFocus')
  } catch {
    // handler may not exist yet
  }
  ipcMain.handle('window:repairInputFocus', async (event, reason = 'renderer-request') => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return { success: false, error: 'Window is not available.' }
    try {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
      win.webContents.focus()
      // Send a dummy Shift key event to wake Chromium's compositor/input pipeline
      // when the focused element appears focused but won't accept keyboard input.
      // This is a known Electron-on-Windows issue that minimize/restore normally fixes,
      // but this synthetic event achieves the same reset without visual disruption.
      try {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Shift' })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Shift' })
      } catch {
        // non-fatal - may not be available in all Electron versions
      }
      if (INPUT_FOCUS_DEBUG) console.log('[WINDOW] repaired input focus:', reason)
      return { success: true }
    } catch (error) {
      return { success: false, error: error?.message || 'Could not repair input focus.' }
    }
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

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) shell.openExternal(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(currentDir, '../renderer/index.html'))
  }

  // Start proactive Ops AI watcher once window exists.
  // It emits ai:alert events consumed by the floating UI layer.
  startAiWatcher()

  return mainWindow
}

const POS_DISPLAY_ROUTES = {
  customer: '/pos/customer-display',
  kitchen: '/pos/kitchen-display',
  bar: '/pos/bar-display'
}

const POS_DISPLAY_TITLES = {
  customer: 'Customer Display',
  kitchen: 'Kitchen Tickets',
  bar: 'Bar Tickets'
}

const POS_DISPLAY_LAYOUTS_FILENAME = 'pos-display-layouts.json'

function getDefaultPosDisplaySize(kind) {
  return kind === 'customer'
    ? { width: 1024, height: 720 }
    : { width: 1280, height: 800 }
}

function getPosDisplayLayoutsPath() {
  return join(app.getPath('userData'), POS_DISPLAY_LAYOUTS_FILENAME)
}

function readPosDisplayLayouts() {
  const layouts = readStartupJson(getPosDisplayLayoutsPath(), {})
  return layouts && typeof layouts === 'object' && !Array.isArray(layouts) ? layouts : {}
}

function writePosDisplayLayouts(layouts) {
  writeStartupJson(getPosDisplayLayoutsPath(), layouts && typeof layouts === 'object' ? layouts : {})
}

function normalizeDisplayBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null
  const x = Number(bounds.x)
  const y = Number(bounds.y)
  const width = Number(bounds.width)
  const height = Number(bounds.height)
  if (![x, y, width, height].every(Number.isFinite)) return null
  if (width < 480 || height < 320) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

function getDisplayById(displayId) {
  if (displayId === null || displayId === undefined || displayId === '') return null
  return screen.getAllDisplays().find((display) => String(display.id) === String(displayId)) || null
}

function boundsIntersect(a, b) {
  if (!a || !b) return false
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

function centerBoundsOnDisplay(kind, display, fullScreen) {
  const area = fullScreen ? display.bounds : display.workArea
  if (fullScreen) {
    return {
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height
    }
  }

  const defaultSize = getDefaultPosDisplaySize(kind)
  const width = Math.min(defaultSize.width, area.width)
  const height = Math.min(defaultSize.height, area.height)
  return {
    x: area.x + Math.max(0, Math.round((area.width - width) / 2)),
    y: area.y + Math.max(0, Math.round((area.height - height) / 2)),
    width,
    height
  }
}

function getSavedDisplayWindowState(kind, options = {}) {
  const saved = readPosDisplayLayouts()[kind] || {}
  const requestedDisplay = getDisplayById(options?.displayId)
  const savedFullScreen = saved.fullScreen === true
  const fullScreen = options?.fullScreen === true || (options?.fullScreen === undefined && savedFullScreen)

  if (requestedDisplay) {
    return {
      bounds: centerBoundsOnDisplay(kind, requestedDisplay, fullScreen),
      fullScreen,
      restored: false,
      displayId: requestedDisplay.id
    }
  }

  const savedBounds = normalizeDisplayBounds(saved.bounds)
  const displays = screen.getAllDisplays()
  const savedDisplay = getDisplayById(saved.displayId)
  const boundsStillVisible = savedBounds && displays.some((display) => boundsIntersect(display.bounds, savedBounds))
  if (savedBounds && boundsStillVisible) {
    return {
      bounds: fullScreen && savedDisplay ? centerBoundsOnDisplay(kind, savedDisplay, true) : savedBounds,
      fullScreen,
      restored: true,
      displayId: savedDisplay?.id || screen.getDisplayMatching(savedBounds)?.id || null
    }
  }

  if (savedDisplay) {
    return {
      bounds: centerBoundsOnDisplay(kind, savedDisplay, fullScreen),
      fullScreen,
      restored: true,
      displayId: savedDisplay.id
    }
  }

  return {
    bounds: null,
    fullScreen: options?.fullScreen === true,
    restored: false,
    displayId: null
  }
}

function savePosDisplayWindowLayout(kind, displayWindow) {
  if (!displayWindow || displayWindow.isDestroyed()) return
  const bounds = normalizeDisplayBounds(displayWindow.getBounds())
  if (!bounds) return
  const display = screen.getDisplayMatching(bounds)
  const layouts = readPosDisplayLayouts()
  layouts[kind] = {
    kind,
    displayId: display?.id || null,
    displayLabel: display?.label || '',
    bounds,
    fullScreen: displayWindow.isFullScreen(),
    updated_at: new Date().toISOString()
  }
  writePosDisplayLayouts(layouts)
}

function rememberPosDisplayWindow(kind, displayWindow) {
  let saveTimer = null
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => savePosDisplayWindowLayout(kind, displayWindow), 350)
  }

  for (const eventName of ['move', 'resize', 'enter-full-screen', 'leave-full-screen', 'maximize', 'unmaximize', 'restore']) {
    displayWindow.on(eventName, scheduleSave)
  }
  displayWindow.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    savePosDisplayWindowLayout(kind, displayWindow)
  })
}

function listPosSystemDisplays() {
  const primaryId = screen.getPrimaryDisplay()?.id
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    label: display.label || `Display ${index + 1}`,
    isPrimary: display.id === primaryId,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor
  }))
}

async function getReceiptBusinessSettings(fallback = {}) {
  try {
    const settings = await db.getSettings()
    return { ...(settings || {}), ...(fallback || {}) }
  } catch {
    return fallback || {}
  }
}

function openPosDisplayWindow(kind = 'customer', options = {}) {
  const displayKind = Object.hasOwn(POS_DISPLAY_ROUTES, kind) ? kind : 'customer'
  const windowState = getSavedDisplayWindowState(displayKind, options || {})
  const defaultSize = getDefaultPosDisplaySize(displayKind)
  const windowBounds = windowState.bounds || defaultSize
  const openFullScreen = windowState.fullScreen === true
  const appIcon = createAppLogoNativeImage() || undefined
  const displayWindow = new BrowserWindow({
    ...windowBounds,
    minWidth: 800,
    minHeight: 560,
    autoHideMenuBar: true,
    fullscreen: openFullScreen,
    title: `${APP_BRAND_NAME} - ${POS_DISPLAY_TITLES[displayKind]}`,
    icon: appIcon,
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  rememberPosDisplayWindow(displayKind, displayWindow)

  displayWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })
  displayWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) shell.openExternal(url)
  })

  const route = POS_DISPLAY_ROUTES[displayKind]
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    displayWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
  } else {
    displayWindow.loadFile(join(currentDir, '../renderer/index.html'), { hash: route })
  }
  if (openFullScreen) displayWindow.setFullScreen(true)
  displayWindow.show()
  savePosDisplayWindowLayout(displayKind, displayWindow)
  return {
    success: true,
    kind: displayKind,
    fullScreen: openFullScreen,
    restored: windowState.restored,
    displayId: windowState.displayId || null
  }
}

const EXPORT_SECTION_LABELS = {
  bookings: 'Bookings',
  customers: 'Guests',
  rooms: 'Rooms',
  expenses: 'Expenses',
  posOrders: 'POS Orders',
  bookingInvoices: 'Booking Invoices',
  quotations: 'Quotations',
  maintenance: 'Maintenance',
  inventoryItems: 'Inventory Items',
  inventoryPurchases: 'Inventory Purchases',
  supplyItems: 'Supply Items',
  supplyPurchases: 'Supply Purchases',
  conferenceBookings: 'Conference',
  dayUseEntries: 'Day Use & Facility Access',
  users: 'Staff',
  activityLog: 'Activity Log',
  menuItems: 'Menu Items',
  recipes: 'Recipes',
  suppliers: 'Suppliers',
  purchaseOrders: 'Purchase Orders',
  stockMovements: 'Stock Movements',
  shifts: 'Shifts',
  cashDrawerSessions: 'Cash Drawer Sessions',
  checklists: 'Checklists',
  alerts: 'Alerts'
}

const EXPORT_PRESETS = {
  full: Object.keys(EXPORT_SECTION_LABELS),
  finance: ['bookingInvoices', 'expenses', 'posOrders', 'inventoryPurchases', 'supplyPurchases', 'conferenceBookings', 'dayUseEntries'],
  bookingGuest: ['bookings', 'customers', 'bookingInvoices', 'quotations'],
  operations: ['rooms', 'maintenance', 'inventoryItems', 'inventoryPurchases', 'supplyItems', 'supplyPurchases', 'conferenceBookings', 'dayUseEntries'],
  inventory: ['inventoryItems', 'inventoryPurchases', 'supplyItems', 'supplyPurchases'],
  restaurant_full: ['menuItems', 'recipes', 'inventoryItems', 'inventoryPurchases', 'suppliers', 'purchaseOrders', 'stockMovements', 'posOrders', 'expenses', 'users', 'shifts', 'cashDrawerSessions', 'checklists', 'alerts', 'customers', 'activityLog'],
  restaurant_dailyClose: ['posOrders', 'expenses', 'shifts', 'cashDrawerSessions', 'checklists', 'alerts'],
  restaurant_sales: ['posOrders', 'expenses', 'cashDrawerSessions', 'customers'],
  restaurant_stock: ['inventoryItems', 'inventoryPurchases', 'recipes', 'stockMovements'],
  restaurant_purchasing: ['suppliers', 'purchaseOrders', 'inventoryPurchases'],
  restaurant_staff: ['users', 'shifts', 'activityLog'],
  restaurant_customers: ['customers', 'activityLog']
}

function normalizeExportOptions(options = {}) {
  const preset = Object.hasOwn(EXPORT_PRESETS, options?.preset) ? options.preset : 'full'
  const selected = Array.isArray(options?.sections) && options.sections.length > 0
    ? options.sections.filter((section) => Object.hasOwn(EXPORT_SECTION_LABELS, section))
    : EXPORT_PRESETS[preset]
  return {
    preset,
    sections: [...new Set(selected)],
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(options?.startDate || '')) ? options.startDate : '2000-01-01',
    endDate: /^\d{4}-\d{2}-\d{2}$/.test(String(options?.endDate || '')) ? options.endDate : '2099-12-31',
    privacyMode: options?.privacyMode === true
  }
}

function includesSection(options, key) {
  return options.sections.includes(key)
}

async function collectFullExportData(options = {}) {
  const normalized = normalizeExportOptions(options)
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null
  const progress = (stage, current = null, total = null) => {
    if (onProgress) onProgress({ stage, current, total })
  }
  const safe = async (label, loader, fallback) => {
    try {
      progress(label)
      return await loader()
    } catch (error) {
      console.error(`[EXPORT] ${label} failed:`, error?.message || error)
      return fallback
    }
  }

  const [bookings, customers, rooms, expenses, posOrders, quotations, bookingInvoices, maintenance, inventoryItems, supplyItems, conferenceBookings, dayUseEntries, users, activityLog] = await Promise.all([
    includesSection(normalized, 'bookings') ? safe('bookings', () => db.getAllBookings(), []) : [],
    includesSection(normalized, 'customers') ? safe('customers', () => db.getAllCustomers(), []) : [],
    includesSection(normalized, 'rooms') ? safe('rooms', () => db.getAllRooms(), []) : [],
    includesSection(normalized, 'expenses') ? safe('expenses', () => db.getExpenses(normalized.startDate, normalized.endDate), []) : [],
    includesSection(normalized, 'posOrders') ? safe('posOrders', () => db.getPosOrders(normalized.startDate, normalized.endDate), []) : [],
    includesSection(normalized, 'quotations') ? safe('quotations', () => db.getAllQuotations(), []) : [],
    includesSection(normalized, 'bookingInvoices') ? safe('bookingInvoices', () => db.getBookingInvoices(), []) : [],
    includesSection(normalized, 'maintenance') ? safe('maintenance', () => db.getMaintenanceTickets(), []) : [],
    includesSection(normalized, 'inventoryItems') || includesSection(normalized, 'inventoryPurchases') ? safe('inventoryItems', () => db.getInventoryItems(), []) : [],
    includesSection(normalized, 'supplyItems') || includesSection(normalized, 'supplyPurchases') ? safe('supplyItems', () => db.getSupplyItems(), []) : [],
    includesSection(normalized, 'conferenceBookings') ? safe('conferenceBookings', () => db.getConferenceBookings(normalized.startDate, normalized.endDate), []) : [],
    includesSection(normalized, 'dayUseEntries') ? safe('dayUseEntries', () => db.getPoolDayUse(normalized.startDate, normalized.endDate), []) : [],
    includesSection(normalized, 'users') ? safe('users', () => db.getUsers?.() || [], []) : [],
    includesSection(normalized, 'activityLog') ? safe('activityLog', () => db.getActivityLog?.(5000) || [], []) : []
  ])

  const inventoryNameMap = new Map((inventoryItems || []).map((item) => [item.id, item.name || item.item_name || '']))
  const supplyNameMap = new Map((supplyItems || []).map((item) => [item.id, item.name || item.item_name || '']))
  const inventoryPurchases = includesSection(normalized, 'inventoryPurchases')
    ? (await safe('inventory purchases', () => db.getAllInventoryPurchases(), [])).map((purchase) => ({
        ...purchase,
        item_name: purchase.item_name || inventoryNameMap.get(purchase.item_id) || ''
      }))
    : []
  const supplyPurchases = includesSection(normalized, 'supplyPurchases')
    ? (await safe('supply purchases', () => db.getAllSupplyPurchases(), [])).map((purchase) => ({
        ...purchase,
        item_name: purchase.item_name || supplyNameMap.get(purchase.item_id) || ''
      }))
    : []

  const menuItems = includesSection(normalized, 'menuItems')
    ? (await safe('menu items', () => db.getPosMenuItems?.() || [], []) || [])
    : []
  const recipes = includesSection(normalized, 'recipes')
    ? (await safe('recipes', () => db.getPosRecipes?.() || [], []) || [])
    : []
  const suppliers = includesSection(normalized, 'suppliers')
    ? (await safe('suppliers', () => db.getPosSuppliers?.() || [], []) || [])
    : []
  const purchaseOrders = includesSection(normalized, 'purchaseOrders')
    ? (await safe('purchase orders', () => db.getPosPurchaseOrders?.(normalized.startDate, normalized.endDate) || [], []) || [])
    : []
  const stockMovements = includesSection(normalized, 'stockMovements')
    ? (await safe('stock movements', () => db.getInventoryMovements?.(normalized.startDate, normalized.endDate) || [], []) || [])
    : []
  const shifts = includesSection(normalized, 'shifts')
    ? (await safe('shifts', () => db.getShiftHistory?.(normalized.startDate, normalized.endDate) || [], []) || [])
    : []
  const cashDrawerSessions = includesSection(normalized, 'cashDrawerSessions')
    ? (await safe('cash drawer sessions', () => db.getCashDrawerSessions?.(normalized.startDate, normalized.endDate) || [], []) || [])
    : []
  const checklists = includesSection(normalized, 'checklists')
    ? (await safe('checklists', () => db.getChecklists?.() || [], []) || [])
    : []
  const alerts = includesSection(normalized, 'alerts')
    ? (await safe('alerts', () => db.getExceptionAlerts?.() || [], []) || [])
    : []

  return {
    options: normalized,
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
    dayUseEntries,
    users,
    activityLog,
    menuItems,
    recipes,
    suppliers,
    purchaseOrders,
    stockMovements,
    shifts,
    cashDrawerSessions,
    checklists,
    alerts
  }
}

function buildFullExportWorkbook(data) {
  const wb = XLSX.utils.book_new()
  const hasSection = (key) => !data.options || data.options.sections.includes(key)
  const hidePrivate = data.options?.privacyMode === true

  if (hasSection('bookings')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
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

  if (hasSection('customers')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.customers || []).map(c => ({
      'Name': c.full_name || '',
      'Email': hidePrivate ? '' : (c.email || ''),
      'Phone': hidePrivate ? '' : (c.phone || ''),
      'ID Number': hidePrivate ? '' : (c.id_number || ''),
      'Nationality': c.nationality || '',
      'Blacklisted': c.is_blacklisted ? 'Yes' : 'No'
    }))
  ), 'Guests')

  if (hasSection('rooms')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.rooms || []).map(r => ({
      'Room #': r.room_number || '',
      'Type': r.room_type || '',
      'Rate': Number(r.rate || 0),
      'Max Adults': r.max_adults || '',
      'Max Children': r.max_children || '',
      'Status': r.status || ''
    }))
  ), 'Rooms')

  if (hasSection('expenses')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.expenses || []).map(e => ({
      'Date': e.date || '',
      'Category': e.category || '',
      'Description': e.description || '',
      'Amount': Number(e.amount || 0),
      'Paid By': e.paid_by || ''
    }))
  ), 'Expenses')

  if (hasSection('posOrders')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.posOrders || []).map(o => ({
      'Date': o.created_at || '',
      'Room / Guest': o.walk_in_name || (o.room_number ? `Room ${o.room_number}` : ''),
      'Items': (o.pos_order_items || []).map(i => `${i.quantity}x ${i.item_name}`).join(', '),
      'Payment': o.payment_method || '',
      'Total': Number(o.total || 0)
    }))
  ), 'POS Orders')

  if (hasSection('bookingInvoices')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.bookingInvoices || []).map(inv => ({
      'Invoice #': inv.invoice_number || '',
      'Guest': inv.customer_name || '',
      'Guest Email': hidePrivate ? '' : (inv.customer_email || ''),
      'Guest Phone': hidePrivate ? '' : (inv.customer_phone || ''),
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

  if (hasSection('quotations')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.quotations || []).map(q => ({
      'Quotation #': q.quotation_number || '',
      'Guest': q.customer_name || '',
      'Email': hidePrivate ? '' : (q.customer_email || ''),
      'Phone': hidePrivate ? '' : (q.customer_phone || ''),
      'Booking Type': q.quotation_type === 'exclusive_event' ? 'Event / Full Lodge' : 'Room Stay',
      'Event / Group': q.event_name || '',
      'Room': q.quotation_type === 'exclusive_event' ? 'Full Lodge' : (q.room_name || q.room_number || ''),
      'Check-in': q.check_in || '',
      'Check-out': q.check_out || '',
      'Daily Rate': q.quotation_type === 'exclusive_event' ? Number(q.event_daily_rate || 0) : '',
      'Status': q.status || '',
      'Total': Number(q.total_amount || 0),
      'Created': q.created_at || ''
    }))
  ), 'Quotations')

  if (hasSection('maintenance')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
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

  if (hasSection('inventoryItems')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.inventoryItems || []).map(item => ({
      'Item': item.name || item.item_name || '',
      'Category': item.category || '',
      'Stock': Number(item.current_stock || item.stock_quantity || 0),
      'Reorder Level': Number(item.reorder_level || 0),
      'Unit': item.unit || '',
      'Updated': item.updated_at || ''
    }))
  ), 'Inventory Items')

  if (hasSection('inventoryPurchases')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
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

  if (hasSection('supplyItems')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.supplyItems || []).map(item => ({
      'Item': item.name || item.item_name || '',
      'Category': item.category || '',
      'Stock': Number(item.current_stock || item.stock_quantity || 0),
      'Unit': item.unit || '',
      'Updated': item.updated_at || ''
    }))
  ), 'Supply Items')

  if (hasSection('supplyPurchases')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
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

  if (hasSection('conferenceBookings')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.conferenceBookings || []).map(entry => ({
      'Event': entry.event_name || '',
      'Customer': entry.customer_name || '',
      'Date': entry.event_date || entry.check_in || '',
      'Status': entry.status || '',
      'Guests': entry.guest_count || '',
      'Total': Number(entry.total_amount || 0)
    }))
  ), 'Conference')

  if (hasSection('dayUseEntries')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.dayUseEntries || []).map((entry) => {
      const row = normalizeDayUseReportRow(entry)
      return {
        'Date': row.date,
        'Guest': row.guest,
        'Template': row.templateName,
        'Activity': row.activityLabel,
        'Status': row.statusLabel,
        'Access': row.accessSummary,
        'Start Time': row.startTime,
        'End Time': row.endTime,
        'Duration (hrs)': row.durationHours,
        'Pricing Mode': row.pricingMode,
        'Package': row.packageName,
        'Resource': row.resourceName,
        'Adults': row.adults,
        'Children': row.children,
        'Extras': row.extrasSummary,
        'Extras Total': row.extrasTotal,
        'Deposit': row.depositAmount,
        'Balance Due': row.balanceDue,
        'Total': row.total,
        'Method': row.paymentMethod,
        'Service Notes': row.serviceNotes,
        'Notes': row.notes
      }
    })), 'Day Use & Facility')

  if (hasSection('dayUseEntries')) {
    const templateMap = new Map()
    const resourceMap = new Map()
    const extrasMap = new Map()
    const balances = []
    for (const entry of data.dayUseEntries || []) {
      const row = normalizeDayUseReportRow(entry)
      const templateKey = row.templateName || row.activityLabel
      const templateSummary = templateMap.get(templateKey) || { 'Type': 'Template', 'Label': templateKey, 'Count': 0, 'Quantity': '', 'Revenue': 0, 'Balance': '' }
      templateSummary.Count += 1
      templateSummary.Revenue += row.total
      templateMap.set(templateKey, templateSummary)

      if (row.resourceName) {
        const resourceSummary = resourceMap.get(row.resourceName) || { 'Type': 'Resource', 'Label': row.resourceName, 'Count': 0, 'Quantity': '', 'Revenue': 0, 'Balance': '' }
        resourceSummary.Count += 1
        resourceSummary.Revenue += row.total
        resourceMap.set(row.resourceName, resourceSummary)
      }

      for (const extra of Array.isArray(entry.extras) ? entry.extras : []) {
        const label = String(extra?.name || '').trim()
        if (!label) continue
        const extraSummary = extrasMap.get(label) || { 'Type': 'Extra', 'Label': label, 'Count': '', 'Quantity': 0, 'Revenue': 0, 'Balance': '' }
        extraSummary.Quantity += Number(extra?.quantity || 0)
        extraSummary.Revenue += Number(extra?.quantity || 0) * Number(extra?.unit_price || 0)
        extrasMap.set(label, extraSummary)
      }

      if (row.balanceDue > 0 && row.status !== 'cancelled') {
        balances.push({ 'Type': 'Outstanding Balance', 'Label': row.guest, 'Count': '', 'Quantity': '', 'Revenue': row.total, 'Balance': row.balanceDue })
      }
    }
    const insightRows = [
      ...Array.from(templateMap.values()),
      ...Array.from(resourceMap.values()),
      ...Array.from(extrasMap.values()),
      ...balances
    ]
    if (insightRows.length > 0) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(insightRows), 'Day Use Insights')
    }
  }

  if (hasSection('users')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.users || []).map(u => ({
      'Name': u.name || '',
      'Email': u.email || '',
      'Role': u.role || '',
      'Manager mobile app access': u.pwa_enabled ? 'Yes' : 'No',
      'Created': u.created_at || ''
    }))
  ), 'Staff')

  if (hasSection('activityLog')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.activityLog || []).map(entry => ({
      'Timestamp': entry.timestamp || '',
      'Action': entry.action || '',
      'Details': entry.details || '',
      'User Email': entry.user_email || ''
    }))
  ), 'Activity Log')

  if (hasSection('menuItems')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.menuItems || []).map(item => ({
      'Name': item.name || item.item_name || '',
      'Category': item.category || '',
      'Price': Number(item.selling_price || item.price || 0),
      'Available': item.is_available !== false ? 'Yes' : 'No',
      'Description': item.description || ''
    }))
  ), 'Menu Items')

  if (hasSection('recipes')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.recipes || []).map(r => ({
      'Recipe': r.name || r.recipe_name || '',
      'Menu Item': r.menu_item_name || r.menu_item || '',
      'Ingredient': r.ingredient_name || r.ingredient || '',
      'Quantity': Number(r.quantity || 0),
      'Unit': r.unit || '',
      'Cost': Number(r.unit_cost || r.cost || 0)
    }))
  ), 'Recipes')

  if (hasSection('suppliers')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.suppliers || []).map(s => ({
      'Name': s.name || '',
      'Contact Person': s.contact_person || '',
      'Phone': s.phone || '',
      'Email': s.email || '',
      'Category': s.category || ''
    }))
  ), 'Suppliers')

  if (hasSection('purchaseOrders')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.purchaseOrders || []).map(po => ({
      'PO #': po.po_number || po.id || '',
      'Supplier': po.supplier_name || po.supplier || '',
      'Status': po.status || '',
      'Total': Number(po.total || po.total_amount || 0),
      'Created': po.created_at || '',
      'Approved': po.approved_at || '',
      'Received': po.received_at || ''
    }))
  ), 'Purchase Orders')

  if (hasSection('stockMovements')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.stockMovements || []).map(m => ({
      'Date': m.created_at || m.date || '',
      'Item': m.item_name || m.item || '',
      'Type': m.movement_type || m.type || '',
      'Quantity': Number(m.quantity || 0),
      'Reference': m.reference || '',
      'Notes': m.notes || ''
    }))
  ), 'Stock Movements')

  if (hasSection('shifts')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.shifts || []).map(s => ({
      'Staff': s.staff_name || s.name || '',
      'Role': s.role || '',
      'Clock In': s.clock_in || s.opened_at || '',
      'Clock Out': s.clock_out || s.closed_at || '',
      'Duration': s.clock_out ? `${Math.round((new Date(s.clock_out) - new Date(s.clock_in)) / 3600000)}h` : 'Active'
    }))
  ), 'Shifts')

  if (hasSection('cashDrawerSessions')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.cashDrawerSessions || []).map(s => ({
      'Cashier': s.cashier_name || '',
      'Opened': s.opened_at || '',
      'Closed': s.closed_at || '',
      'Opening Float': Number(s.opening_float || 0),
      'Closing Total': Number(s.closing_total || 0),
      'Declared Total': Number(s.declared_total || 0),
      'Variance': s.variance != null ? Number(s.variance) : ''
    }))
  ), 'Cash Drawer')

  if (hasSection('checklists')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.checklists || []).map(c => ({
      'Type': (c.checklist_type || '').replace(/_/g, ' '),
      'Status': c.status || '',
      'Items Total': Array.isArray(c.items) ? c.items.length : 0,
      'Items Done': Array.isArray(c.items) ? c.items.filter(i => i.is_completed).length : 0,
      'Created': c.created_at || ''
    }))
  ), 'Checklists')

  if (hasSection('alerts')) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
    (data.alerts || []).map(a => ({
      'Severity': a.severity || '',
      'Type': a.alert_type || '',
      'Message': a.message || '',
      'Status': a.status || '',
      'Created': a.created_at || '',
      'Resolved': a.resolved_at || ''
    }))
  ), 'Alerts')

  return wb
}

function formatFileSaveError(filePath, error) {
  const message = error?.message || 'Unknown file save error.'
  const code = error?.code ? ` (${error.code})` : ''
  return `Cannot save file "${filePath}"${code}. ${message} Close the file if it is open, check that the folder is available, then try again.`
}

function writeWorkbookFile(wb, filePath) {
  try {
    fs.mkdirSync(dirname(filePath), { recursive: true })
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    fs.writeFileSync(filePath, buffer)
  } catch (error) {
    throw new Error(formatFileSaveError(filePath, error))
  }
}

async function exportAllDataWorkbookToPath(filePath, options = {}) {
  const data = await collectFullExportData(options)
  if (typeof options?.onProgress === 'function') options.onProgress({ stage: 'writing workbook' })
  const wb = buildFullExportWorkbook(data)
  writeWorkbookFile(wb, filePath)
  if (typeof options?.onProgress === 'function') options.onProgress({ stage: 'complete' })
  return { success: true, filePath, sections: data.options.sections }
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
  db.recordActivity('booking_invoice_emailed', `Invoice emailed - ${invoiceLabel} - ${guestLabel}`)
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
    db.recordActivity('quotation_emailed', `Quotation emailed - ${quotation.quotation_number || quotation.id} - ${quotation.customer_name || quotation.customer_email}`)
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
      db.recordActivity('booking_confirmation_emailed', `Booking confirmation emailed - ${booking.invoice_number || booking.id} - ${booking.customer_name || booking.customer_email}`)
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
      db.recordActivity('booking_cancellation_emailed', `Booking cancellation emailed - ${booking.invoice_number || booking.id} - ${booking.customer_name || booking.customer_email}`)
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
  const excelPath = join(policy.target_dir, `${APP_EXPORT_PREFIX}-full-${stamp}.xlsx`)

  try {
    fs.mkdirSync(policy.target_dir, { recursive: true })
    await exportAllDataWorkbookToPath(excelPath)
    db.recordManagedBackupRun({ success: true, excelPath })
    return { success: true, excelPath }
  } catch (e) {
    db.recordManagedBackupRun({ success: false, error: e.message || 'Managed export failed.', excelPath })
    return { success: false, error: e.message || 'Managed export failed.', excelPath }
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId(BUILD_PRODUCT.appId)

  ipcMain.handle('app:getProduct', () => ({
    id: BUILD_PRODUCT.id,
    name: BUILD_PRODUCT.name,
    brandName: BUILD_PRODUCT.brandName,
    shortName: BUILD_PRODUCT.shortName,
    businessNoun: BUILD_PRODUCT.businessNoun,
    businessNounTitle: BUILD_PRODUCT.businessNounTitle,
    businessNounPlural: BUILD_PRODUCT.businessNounPlural,
    tagline: BUILD_PRODUCT.tagline,
    loginTagline: BUILD_PRODUCT.loginTagline,
    allowedPropertyTypes: BUILD_PRODUCT.allowedPropertyTypes,
    hospitalityModes: BUILD_PRODUCT.hospitalityModes,
    allowedRoutePrefixes: BUILD_PRODUCT.allowedRoutePrefixes,
    defaultHome: BUILD_PRODUCT.defaultHome,
    theme: BUILD_PRODUCT.theme,
    releaseRepo: BUILD_PRODUCT.releaseRepo
  }))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createStartupSplashWindow()

  // Init DB
  await db.initDatabase()

  // -- Auth ------------------------------------------------------------------
  ipcMain.handle('auth:login', async (_, email, password, selectedLodgeId = null) => {
    try {
      console.log('[AUTH] Login attempt')

      // Master admin check
      let masterAdmin = null
      try {
        masterAdmin = await db.checkMasterAdmin(email, password)
        console.log('[AUTH] Master admin result:', masterAdmin ? 'FOUND' : 'NOT FOUND')
      } catch (err) {
        console.error('[AUTH] Master admin check failed:', err.message)
        if (err?.code === 'MASTER_ADMIN_LOCKED') {
          return { ok: false, code: 'master_admin_locked', error: err.message }
        }
      }

      if (masterAdmin) {
        console.log('[AUTH] Logging in as MASTER ADMIN')
        db.clearBackendSession()
        db.setCurrentUser(masterAdmin)
        db.runScheduledFinancialValidation('startup').catch(() => {})
        db.createSessionNonce(masterAdmin, password)
        return { ok: true, code: null, user: masterAdmin, mode: 'online' }
      }

      // Regular user login
      console.log('[AUTH] Trying regular user login...')
      const result = await db.loginUser(email, password, selectedLodgeId)

      if (result?.user) {
        console.log('[AUTH] SUCCESS')
        db.setCurrentUser(result.user)
        db.runScheduledFinancialValidation('startup').catch(() => {})
        db.createSessionNonce(result.user, password)

        return {
          ok: true,
          code: null,
          user: result.user,
          mode: result.mode,
          warning: result.warning
        }
      }

      console.warn('[AUTH] FAILED:', result?.error)

      return { ok: false, code: result?.code || 'sign_in_failed', error: result?.error || 'Sign-in failed.', memberships: result?.memberships || [] }
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

  ipcMain.handle('auth:sendPasswordReset', async (_, email) => {
    try { return await db.sendPasswordResetEmail(email) }
    catch (e) { return { success: false, error: e.message || 'Could not send password reset email.' } }
  })

  // Restores main-process session using a nonce issued during login.
  // Identity is derived from the nonce file - renderer cannot influence which user is restored.
  ipcMain.handle('auth:restoreSession', (_, nonce) => {
    try {
      const restored = db.restoreUserSession(nonce)
      if (restored) db.runScheduledFinancialValidation('startup').catch(() => {})
      return restored
    } catch { return null }
  })

  ipcMain.handle('auth:restoreSavedSession', (_, email, password) => {
    try {
      const restored = db.restoreSavedTrustedSession(email, password)
      if (restored?.user) db.runScheduledFinancialValidation('startup').catch(() => {})
      return restored
    } catch { return { user: null, nonce: '' } }
  })

  ipcMain.handle('auth:restoreCurrentSession', () => {
    try {
      const restored = db.restoreCurrentTrustedSession?.()
      if (restored) db.runScheduledFinancialValidation('startup').catch(() => {})
      return restored
    } catch { return null }
  })

  ipcMain.handle('auth:validateSession', async () => {
    try { return await db.validateCurrentSession() } catch { return null }
  })

  // Clears the active app session on logout, but keeps the trusted device session.
  // Offline-first front desks must be able to log out and reopen while offline.
  ipcMain.handle('auth:logout', () => {
    commandCentralElevation.clear()
    try { db.logoutCurrentUser(); return { ok: true } } catch { return { ok: true } }
  })

  // -- Lodge Profiles --------------------------------------------------------
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

  // -- Role enforcement helper ------------------------------------------------
  const commandCentralElevation = createActorBoundElevationGate()

  function getCurrentUserOrRestore() {
    const existing = db.getCurrentUser()
    if (existing) return existing

    try {
      const storedNonce = db.readSessionNonce?.()
      const nonce = typeof storedNonce?.nonce === 'string' ? storedNonce.nonce : ''
      if (!nonce) return null
      return db.restoreUserSession?.(nonce) || null
    } catch {
      return null
    }
  }

  function requireRole(...roles) {
    const user = getCurrentUserOrRestore()
    if (!user) throw new Error('Not authenticated')
    if (roles.length === 1 && roles[0] === 'super_admin') {
      return assertMasterAdmin(user)
    }
    if (user.isMasterAdmin) return
    if (roles.length > 0 && !roles.includes(normalizeAppRole(user.role))) {
      throw new Error('Unauthorized')
    }
  }

  function requireMasterAdmin() {
    return assertMasterAdmin(getCurrentUserOrRestore())
  }

  function requireFreshCommandCentralReauth() {
    const user = requireMasterAdmin()
    commandCentralElevation.assertFresh(user.id)
    return user
  }

  function requireCurrentLodgeOrSuperAdmin(targetLodgeId) {
    const user = getCurrentUserOrRestore()
    if (user?.isMasterAdmin === true) return

    const activeProfile = db.getActiveProfile?.()
    const currentLodgeId = String(activeProfile?.lodge_id || '').trim().toLowerCase()
    const requestedLodgeId = String(targetLodgeId || '').trim().toLowerCase()

    if (currentLodgeId && requestedLodgeId && currentLodgeId === requestedLodgeId) {
      return
    }

    throw new Error('Unauthorized')
  }

  async function getAccessSnapshot() {
    const user = getCurrentUserOrRestore()
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
        features: entitlement?.effective_features || {},
        productId: entitlement?.product_id || null,
        commercialPackageKey: entitlement?.commercial_package_key || null
      }),
      entitlement
    }
  }

  async function requireCommercialFeature(featureKey, errorMessage) {
    const snapshot = await getAccessSnapshot()
    const productId = snapshot?.entitlement?.product_id || snapshot?.productId || null
    const commercialPackageKey = snapshot?.entitlement?.commercial_package_key || snapshot?.commercialPackageKey || null
    if (productId && commercialPackageKey && !isCommercialFeatureIncluded(productId, commercialPackageKey, featureKey)) {
      throw new Error(errorMessage || 'This feature is not included in the current commercial package.')
    }
    return snapshot
  }

  async function requireFeature(featureName) {
    const user = getCurrentUserOrRestore()
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

  const DEV_ENTERPRISE_PREVIEW_CAPABILITIES = new Set([
    'front_desk_dashboard.view',
    'room_moves.view',
    'room_types.view',
    'floors_sections.view',
    'folios.view',
    'hotel_kpis.view',
    'advanced_housekeeping.view',
    'corporate_accounts.view',
    'rate_plans.view',
    'channel_manager.view',
    'channel_manager.manage',
    'documents.view',
    'documents.manage',
    'documents.generate',
    'hotel_roles.view',
    'payment_gateway.view',
    'payment_gateway.manage',
    'guest_messaging.manage',
    'guest_messaging.send',
    'guest_portal.configure',
    'guest_crm.view',
    'guest_crm.manage',
    'guest_crm.vip',
    'guest_crm.blacklist',
    'night_audit.close',
    'night_audit.reopen',
    'night_audit.checks',
    'checkin.manage',
    'checkout.manage',
    'early_checkin.manage',
    'late_checkout.manage',
    'cancellation.manage',
    'cancellation.approve',
    'room_attributes.view',
    'room_attributes.manage',
    'advanced_rates.view'
  ])

  async function requireCapabilityOrDevEnterprisePreview(capabilityName, errorMessage) {
    try {
      return await requireCapability(capabilityName, errorMessage)
    } catch (error) {
      const canPreview = !app.isPackaged && DEV_ENTERPRISE_PREVIEW_CAPABILITIES.has(capabilityName)
      if (!canPreview) throw error
      console.warn(`[Enterprise Preview] Allowing local development read for ${capabilityName}:`, error?.message || error)
      return await getAccessSnapshot().catch(() => null)
    }
  }

  // -- AI Ops Agent ----------------------------------------------------------
  const ai = createAiOrchestrator({
    appUserDataPath: app.getPath('userData'),
    db,
    requireCapability,
    requireCommercialFeature
  })

  ipcMain.handle('ai:turn', async (_, payload = {}) => {
    try {
      await requireCapability('dashboard.view')
      const message = String(payload?.message || '').trim()
      if (!message) return { success: false, error: 'Message is required.' }
      const model = payload?.model || null
      const route = String(payload?.route || '').trim() || null
      const threadId = String(payload?.threadId || '').trim() || 'default'
      const uiContext = payload?.uiContext && typeof payload.uiContext === 'object' ? payload.uiContext : null
      const result = await ai.turn({ message, model, route, threadId, uiContext })
      return { success: true, ...result }
    } catch (e) {
      return { success: false, error: e.message || 'AI request failed.' }
    }
  })

  ipcMain.handle('ai:catalog', async () => {
    try {
      await requireCapability('dashboard.view')
      return { success: true, items: ai.getLocalCatalog() }
    } catch (e) {
      return { success: false, error: e.message || 'Could not load assistant topics.', items: [] }
    }
  })

  ipcMain.handle('ai:execute', async (_, payload = {}) => {
    try {
      await requireCapability('dashboard.view')
      const proposalId = String(payload?.proposalId || '').trim()
      if (!proposalId) return { success: false, error: 'proposalId is required.' }
      const result = await ai.execute({ proposalId })
      return { success: true, ...result }
    } catch (e) {
      return { success: false, error: e.message || 'AI action failed.' }
    }
  })

  // -- Collections: Preview (read-only, no AI call) ---------------------------
  // Returns a structured preview of what bulk_record_payment would collect.
  // The UI must show this to the user and require explicit confirmation before
  // calling ai:collections:execute.
  ipcMain.handle('ai:collections:preview', async (_, payload = {}) => {
    try {
      await requireCapability('payments.record')
      const bookingIds = Array.isArray(payload?.booking_ids) ? payload.booking_ids : []
      const method = String(payload?.method || 'cash')
      const HIGH_VALUE_THRESHOLD = 5000

      const allBookings = await db.getAllBookings().catch(() => [])
      const today = new Date().toISOString().slice(0, 10)
      const bookingMap = new Map((Array.isArray(allBookings) ? allBookings : []).map((b) => [b.id, b]))

      const items = []
      let totalAmount = 0
      let skippedCount = 0

      // If no specific IDs passed, use all eligible unpaid bookings
      const idsToProcess = bookingIds.length > 0
        ? bookingIds
        : (Array.isArray(allBookings) ? allBookings : [])
            .filter((b) => b && (b.status || '') !== 'cancelled')
            .map((b) => b.id)

      for (const bookingId of idsToProcess) {
        const b = bookingMap.get(bookingId)
        if (!b) { skippedCount++; continue }
        if ((b.status || '') === 'cancelled') { skippedCount++; continue }

        const total = Number(b.total_amount || 0) + Number(b.charges_total || 0)
        const paid = Number(b.amount_paid || 0)
        const balance = Math.max(0, total - paid)
        if (balance < 0.01) { skippedCount++; continue }

        const checkOut = (b.check_out || '').slice(0, 10)
        const checkIn = (b.check_in || '').slice(0, 10)
        let bucket = 'future'
        if (checkOut < today) bucket = 'overdue'
        else if (checkIn <= today && checkOut >= today) bucket = 'due_today'

        items.push({
          booking_id: bookingId,
          guest: b.customer_name || b.guest_name || 'Guest',
          room_number: b.room_number || null,
          amount: balance,
          bucket,
          check_in: b.check_in,
          check_out: b.check_out,
          status: b.status
        })
        totalAmount += balance
      }

      return {
        success: true,
        type: 'payment_preview',
        total: totalAmount,
        count: items.length,
        skipped: skippedCount,
        method,
        high_value: totalAmount >= HIGH_VALUE_THRESHOLD,
        high_value_threshold: HIGH_VALUE_THRESHOLD,
        items
      }
    } catch (e) {
      return { success: false, error: e.message || 'Preview failed.' }
    }
  })

  // -- Collections: Execute (RPC-safe, streaming via IPC events) -------------
  // Iterates items from a confirmed preview, calls updateBookingPayment for each,
  // and emits progress events to the renderer after every booking.
  ipcMain.handle('ai:collections:execute', async (event, payload = {}) => {
    try {
      await requireCapability('payments.record')

      // P0.6: Bulk actions gate - must also respect AI_ACTIONS_ENABLED
      if (process.env.BOROKO_AI_ACTIONS_ENABLED !== 'true') {
        return { success: false, error: 'AI actions are currently disabled for safety. You can still ask questions and request summaries.' }
      }

      const items = Array.isArray(payload?.items) ? payload.items : []
      const method = String(payload?.method || 'cash')
      const batchKey = `ai:batch:${new Date().toISOString()}`
      const seenIds = new Set()

      if (items.length === 0) return { success: false, error: 'No items to process.' }

      const emit = (data) => {
        try { event.sender.send('ai:collections:progress', { ...data, timestamp: data.timestamp || Date.now() }) } catch { /* window closed */ }
      }

      emit({ type: 'started', total: items.length, timestamp: Date.now() })

      const results = []
      let successCount = 0
      let skipCount = 0
      let errorCount = 0

      const allBookings = await db.getAllBookings().catch(() => [])
      const bookingMap = new Map((Array.isArray(allBookings) ? allBookings : []).map((b) => [b.id, b]))

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const { booking_id, guest, amount } = item

        emit({ type: 'processing', index: i, booking_id, guest, amount, total: items.length, timestamp: Date.now() })

        if (seenIds.has(booking_id)) {
          results.push({ booking_id, guest, status: 'skipped', reason: 'duplicate' })
          skipCount++
          emit({ type: 'skipped', index: i, booking_id, guest, reason: 'duplicate', timestamp: Date.now() })
          continue
        }
        seenIds.add(booking_id)

        if (!booking_id || !amount || amount < 0.01) {
          results.push({ booking_id, guest, status: 'skipped', reason: 'invalid_data' })
          skipCount++
          emit({ type: 'skipped', index: i, booking_id, guest, reason: 'invalid_data', timestamp: Date.now() })
          continue
        }

        const existing = bookingMap.get(booking_id)
        if (existing && (existing.status || '') === 'cancelled') {
          results.push({ booking_id, guest, status: 'skipped', reason: 'cancelled' })
          skipCount++
          emit({ type: 'skipped', index: i, booking_id, guest, reason: 'cancelled', timestamp: Date.now() })
          continue
        }
        if (existing && (existing.status || '') === 'checked_out') {
          results.push({ booking_id, guest, status: 'skipped', reason: 'already_checked_out' })
          skipCount++
          emit({ type: 'skipped', index: i, booking_id, guest, reason: 'already_checked_out', timestamp: Date.now() })
          continue
        }

        try {
          const intentKey = `${batchKey}:${booking_id}`
          const res = await db.updateBookingPayment(booking_id, amount, method, 'payment', null, intentKey)
          results.push({ booking_id, guest, amount, status: 'paid', ...res })
          successCount++
          emit({ type: 'success', index: i, booking_id, guest, amount, timestamp: Date.now() })
        } catch (e) {
          const errMsg = e.message || 'Payment failed'
          results.push({ booking_id, guest, amount, status: 'error', error: errMsg })
          errorCount++
          emit({ type: 'error', index: i, booking_id, guest, amount, error: errMsg, timestamp: Date.now() })
        }
      }

      const summary = {
        success: true,
        total_processed: items.length,
        success_count: successCount,
        skip_count: skipCount,
        error_count: errorCount,
        results
      }

      emit({ type: 'complete', ...summary, timestamp: Date.now() })

      const user = db.getCurrentUser?.() || null
      const lodgeId = db.getActiveProfile?.()?.lodge_id || user?.lodge_id || null
      // P0-6: Distinct audit event for bulk collections execution
      writeAiAuditLog({
        user, lodgeId, event: 'ai.collections.execute',
        payload: {
          source: 'bulk_workflow',
          total_processed: items.length,
          success_count: successCount,
          skip_count: skipCount,
          error_count: errorCount,
          affected_booking_ids: (results || []).filter(r => r.status === 'paid').map(r => r.booking_id).slice(0, 50),
          error_summaries: (results || []).filter(r => r.status === 'error').map(r => ({ booking_id: r.booking_id, error: r.error })).slice(0, 20),
          method
        }
      }, { userDataPath: app.getPath('userData') })

      return summary
    } catch (e) {
      const user = db.getCurrentUser?.() || null
      const lodgeId = db.getActiveProfile?.()?.lodge_id || user?.lodge_id || null
      writeAiAuditLog({
        user, lodgeId, event: 'ai.collections.execute.failed',
        payload: { source: 'bulk_workflow', error: e.message || 'Execution failed.' }
      }, { userDataPath: app.getPath('userData') })
      return { success: false, error: e.message || 'Execution failed.' }
    }
  })

  // -- Overdue Checkouts: Preview ------------------------------------------------
  ipcMain.handle('ai:overdue:preview', async (_, payload = {}) => {
    try {
      await requireCapability('bookings.view')
      const bookingIds = Array.isArray(payload?.booking_ids) ? payload.booking_ids : []
      const allBookings = await db.getAllBookings().catch(() => [])
      const todayStr = new Date().toISOString().slice(0, 10)

      const overdue = (Array.isArray(allBookings) ? allBookings : [])
        .filter(b => b.check_out && b.check_out.slice(0, 10) < todayStr && (b.status === 'checked_in' || b.status === 'confirmed'))
        .filter(b => bookingIds.length === 0 || bookingIds.includes(b.id))

      const bookings = overdue.map(b => ({
        id: b.id,
        guest: b.customer_name || b.guest_name || 'Guest',
        room: b.room_number || null,
        check_in: b.check_in,
        check_out: b.check_out,
        status: b.status,
        balance: Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0))
      }))

      return {
        success: true,
        count: bookings.length,
        bookings
      }
    } catch (e) {
      return { success: false, error: e.message || 'Overdue preview failed.' }
    }
  })

  // -- Overdue Checkouts: Execute (streaming progress) --------------------------
  ipcMain.handle('ai:overdue:execute', async (event, payload = {}) => {
    try {
      await requireCapability('bookings.manage')

      // P0.6: Bulk actions gate - must also respect AI_ACTIONS_ENABLED
      if (process.env.BOROKO_AI_ACTIONS_ENABLED !== 'true') {
        return { success: false, error: 'AI actions are currently disabled for safety. You can still ask questions and request summaries.' }
      }

      const bookingIds = [...new Set(Array.isArray(payload?.booking_ids) ? payload.booking_ids : [])]
      if (!bookingIds.length) return { success: false, error: 'No booking IDs provided.' }

      const allBookings = await db.getAllBookings().catch(() => [])
      const bookingMap = new Map((Array.isArray(allBookings) ? allBookings : []).map((b) => [b.id, b]))

      const emit = (data) => {
        try { event.sender.send('ai:overdue:progress', { ...data, timestamp: data.timestamp || Date.now() }) } catch { /* window closed */ }
      }

      emit({ type: 'started', total: bookingIds.length, timestamp: Date.now() })

      const results = []
      let successCount = 0
      let skipCount = 0
      let errorCount = 0

      for (let i = 0; i < bookingIds.length; i++) {
        const id = bookingIds[i]
        emit({ type: 'processing', index: i, booking_id: id, total: bookingIds.length, timestamp: Date.now() })

        const existing = bookingMap.get(id)
        if (existing && (existing.status || '') === 'cancelled') {
          results.push({ booking_id: id, status: 'skipped', reason: 'cancelled' })
          skipCount++
          emit({ type: 'skipped', index: i, booking_id: id, reason: 'cancelled', timestamp: Date.now() })
          continue
        }
        if (existing && (existing.status || '') === 'checked_out') {
          results.push({ booking_id: id, status: 'skipped', reason: 'already_checked_out' })
          skipCount++
          emit({ type: 'skipped', index: i, booking_id: id, reason: 'already_checked_out', timestamp: Date.now() })
          continue
        }

        try {
          await db.updateBookingStatus(id, 'checked_out')
          results.push({ booking_id: id, status: 'checked_out' })
          successCount++
          emit({ type: 'success', index: i, booking_id: id, timestamp: Date.now() })
        } catch (e) {
          const errMsg = e.message || 'Checkout failed'
          results.push({ booking_id: id, status: 'error', error: errMsg })
          errorCount++
          emit({ type: 'error', index: i, booking_id: id, error: errMsg, timestamp: Date.now() })
        }
      }

      const summary = {
        success: true,
        total_processed: bookingIds.length,
        success_count: successCount,
        skip_count: skipCount,
        error_count: errorCount,
        results
      }
      emit({ type: 'complete', ...summary, timestamp: Date.now() })

      const user = db.getCurrentUser?.() || null
      const lodgeId = db.getActiveProfile?.()?.lodge_id || user?.lodge_id || null
      // P0-6: Distinct audit event for bulk overdue checkout execution
      writeAiAuditLog({
        user, lodgeId, event: 'ai.overdue.execute',
        payload: {
          source: 'bulk_workflow',
          total_processed: bookingIds.length,
          success_count: successCount,
          skip_count: skipCount,
          error_count: errorCount,
          affected_booking_ids: bookingIds.slice(0, 50),
          error_summaries: (results || []).filter(r => r.status === 'error').map(r => ({ booking_id: r.booking_id, error: r.error })).slice(0, 20)
        }
      }, { userDataPath: app.getPath('userData') })

      return summary
    } catch (e) {
      const user = db.getCurrentUser?.() || null
      const lodgeId = db.getActiveProfile?.()?.lodge_id || user?.lodge_id || null
      writeAiAuditLog({
        user, lodgeId, event: 'ai.overdue.execute.failed',
        payload: { source: 'bulk_workflow', error: e.message || 'Execution failed.' }
      }, { userDataPath: app.getPath('userData') })
      return { success: false, error: e.message || 'Execution failed.' }
    }
  })


  // -- Master Admin Setup -----------------------------------------------------
  ipcMain.handle('admin:exists', async () => db.masterAdminExists().catch(() => false))
  ipcMain.handle('admin:getCommandCentralReauthStatus', async () => {
    const user = requireMasterAdmin()
    const status = commandCentralElevation.status(user.id)
    return { ok: true, verified: status.verified, expires_at: status.expiresAt }
  })
  ipcMain.handle('admin:reauthenticateCommandCentral', async (_, password) => {
    try {
      const user = requireMasterAdmin()
      if (!String(password || '')) throw new Error('Master password is required')
      const verified = await db.checkMasterAdmin(user.email, String(password))
      if (!verified?.isMasterAdmin || verified.id !== user.id) throw new Error('Master password was not accepted')
      const status = commandCentralElevation.grant(user.id)
      return { ok: true, verified: true, expires_at: status.expiresAt }
    } catch (error) {
      commandCentralElevation.clear()
      return { ok: false, verified: false, error: error?.message || 'Could not re-authenticate Command Central' }
    }
  })
  ipcMain.handle('admin:setup', async (_, name, email, password) => {
    try { return await db.createMasterAdmin(name, email, password) }
    catch (e) { return { success: false, error: e.message } }
  })

  // -- Admin: Company & License Management -----------------------------------
  ipcMain.handle('admin:getCompanies', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.companies.manage'); return await db.getAllCompanies() }
    catch (e) { console.error('[admin:getCompanies]', e?.message || e); throw e }
  })
  ipcMain.handle('admin:getLicenses', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.licensing.manage'); return await db.getLicenses() }
    catch (e) { console.error('[admin:getLicenses]', e?.message || e); throw e }
  })
  // These legacy channels are intentionally retained as explicit refusals for
  // older renderer builds. They must not remain alternate write paths around
  // the governed commercial subscription RPC and its operation/audit envelope.
  const legacyLicenseMutationRefusal = 'Direct license mutation is disabled. Use the Command Central commercial subscription assignment workflow.'
  ipcMain.handle('admin:createLicense', async () => ({ success: false, error: legacyLicenseMutationRefusal }))
  ipcMain.handle('admin:assignCommercialSubscription', async (_, payload) => {
    try { requireFreshCommandCentralReauth(); return await db.assignCommercialSubscription(payload || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:issueSubscriptionContract', async () => ({ success: false, error: legacyLicenseMutationRefusal }))
  ipcMain.handle('admin:updateLicense', async () => ({ success: false, error: legacyLicenseMutationRefusal }))
  ipcMain.handle('admin:deleteLicense', async () => ({ success: false, error: 'Direct license deletion is disabled. Use the governed company lifecycle or subscription workflow.' }))

  // -- Admin: Broadcasts -----------------------------------------------------
  ipcMain.handle('admin:getBroadcasts', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getBroadcasts() }
    catch (error) { throw new Error(error?.message || 'Unable to load Command Central broadcasts') }
  })
  ipcMain.handle('admin:getActiveBroadcasts', async () => db.getActiveBroadcasts().catch(() => []))
  ipcMain.handle('admin:getExpenses', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getAdminExpenses() }
    catch (error) { throw new Error(error?.message || 'Unable to load Command Central expenses') }
  })
  ipcMain.handle('admin:createExpense', async (_, data) => {
    try { requireFreshCommandCentralReauth(); return await db.createAdminExpense(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateExpense', async (_, id, data) => {
    try { requireFreshCommandCentralReauth(); return await db.updateAdminExpense(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:deleteExpense', async (_, id) => {
    try { requireFreshCommandCentralReauth(); return await db.deleteAdminExpense(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:createBroadcast', async (_, data) => {
    try {
      requireFreshCommandCentralReauth()
      return await db.createBroadcast(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateBroadcast', async (_, id, data) => {
    try {
      requireFreshCommandCentralReauth()
      return await db.updateBroadcast(id, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:deleteBroadcast', async (_, id) => {
    try {
      requireFreshCommandCentralReauth()
      return await db.deleteBroadcast(id)
    } catch (e) { return { success: false, error: e.message } }
  })

  // -- Admin: Feature Flags --------------------------------------------------
  ipcMain.handle('admin:getLodgeFeatures', async (_, lodgeId) => {
    try { requireCurrentLodgeOrSuperAdmin(lodgeId); return await db.getLodgeFeatures(lodgeId) }
    catch (error) { throw new Error(error?.message || 'Unable to load lodge feature overrides') }
  })
  ipcMain.handle('admin:setLodgeFeature', async (_, lodgeId, name, enabled, metadata) => {
    try {
      requireFreshCommandCentralReauth()
      return await db.setLodgeFeature(lodgeId, name, enabled, metadata || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:clearLodgeFeature', async (_, lodgeId, name) => {
    try {
      requireFreshCommandCentralReauth()
      return await db.clearLodgeFeature(lodgeId, name)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getAllLodgeFeatures', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.companies.manage'); return await db.getAllLodgeFeatures() }
    catch (error) { throw new Error(error?.message || 'Unable to load lodge feature overrides') }
  })
  ipcMain.handle('admin:getTestDataResetPreview', async (_, lodgeId, payload) => {
    try {
      requireMasterAdmin()
      await requireCapability('command_central.destructive.manage')
      assertCommandCentralTarget(lodgeId)
      return await db.getTestDataResetPreview(lodgeId, payload || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:runTestDataReset', async (_, lodgeId, payload) => {
    try {
      requireFreshCommandCentralReauth()
      return await db.runTestDataReset(lodgeId, payload || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getTestDataResetAudit', async (_, lodgeId, limit) => {
    try {
      requireMasterAdmin()
      await requireCapability('command_central.destructive.manage')
      assertCommandCentralTarget(lodgeId)
      return await db.getTestDataResetAudit(lodgeId, limit || 20)
    } catch (error) { throw new Error(error?.message || 'Unable to load reset audit history') }
  })

  // -- Admin: Support Tickets ------------------------------------------------
  ipcMain.handle('admin:getSupportTickets', async (_, filters) => {
    try { requireMasterAdmin(); await requireCapability('command_central.support.manage'); return await db.getSupportTickets(filters || {}) }
    catch (error) { throw new Error(error?.message || 'Unable to load support tickets') }
  })
  ipcMain.handle('admin:createSupportTicket', async (_, data) => {
    try {
      requireRole()
      const user = getCurrentUserOrRestore()
      const submitted = data && typeof data === 'object' ? data : {}
      const activeProfile = db.getActiveProfile?.()
      // A normal lodge session may report only against its current company.
      // Command Central retains the explicit target selection needed to support
      // another company, but it is already behind the master-admin boundary.
      const ticketData = user?.isMasterAdmin
        ? submitted
        : {
            ...submitted,
            lodge_id: user?.lodge_id || activeProfile?.lodge_id || null,
            lodge_name: activeProfile?.lodge_name || activeProfile?.company_name || null
          }
      if (!ticketData.lodge_id) throw new Error('An active company is required to create a support request')
      const result = await db.createSupportTicket(ticketData)
      // Fire-and-forget email notification
      const isUpgrade = ticketData.category === 'Upgrade Request'
      const { subject, html } = isUpgrade
        ? buildUpgradeRequestEmail(ticketData)
        : buildSupportTicketEmail(ticketData)
      sendNotificationEmail(subject, html).catch(() => {})
      return result
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateSupportTicket', async (_, id, updates) => {
    try { requireFreshCommandCentralReauth(); return await db.updateSupportTicket(id, updates) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:addSupportTicketMessage', async (_, id, payload) => {
    try { requireFreshCommandCentralReauth(); return await db.addSupportTicketMessage(id, payload || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:deleteSupportTicket', async (_, id) => {
    try { requireFreshCommandCentralReauth(); return await db.deleteSupportTicket(id) }
    catch (e) { return { success: false, error: e.message } }
  })

  // -- Admin: Activity Logs --------------------------------------------------
  ipcMain.handle('admin:getActivityLogs', async (_, filters) => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getActivityLogs(filters || {}) }
    catch (error) { throw new Error(error?.message || 'Unable to load Command Central activity') }
  })

  ipcMain.handle('admin:getAuditSummary', async (_, filters) => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getAuditSummary(filters || {}) }
    catch (error) { throw new Error(error?.message || 'Unable to load Command Central audit summary') }
  })
  ipcMain.handle('admin:recordCommandCentralHealthRun', async (_, payload = {}) => {
    try {
      const actor = requireMasterAdmin()
      return await db.recordCommandCentralHealthRun({ ...payload, actor_id: actor.id, actor_email: actor.email })
    } catch (error) { return { ok: false, error: error?.message || 'Unable to record Command Central diagnostic run' } }
  })
  ipcMain.handle('admin:listCommandCentralHealthRuns', async (_, limit) => {
    try { requireMasterAdmin(); return await db.listCommandCentralHealthRuns(limit || 20) }
    catch (error) { throw new Error(error?.message || 'Unable to load Command Central diagnostic history') }
  })

  // -- Admin Notifications --------------------------------------------------
  ipcMain.handle('admin:createNotification', async (_, payload) => {
    try { requireFreshCommandCentralReauth(); return { ok: true, id: await db.createNotification(payload) } }
    catch (error) { return { ok: false, error: error?.message || 'Failed to create notification' } }
  })
  ipcMain.handle('admin:getNotifications', async (_, filters) => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getNotifications(filters || {}) }
    catch (error) { throw new Error(error?.message || 'Unable to load Command Central notifications') }
  })
  ipcMain.handle('admin:getUnreadCount', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getUnreadCount() }
    catch { return 0 }
  })
  ipcMain.handle('admin:markNotificationsRead', async (_, ids) => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return { count: await db.markNotificationsRead(ids) } }
    catch { return { count: 0 } }
  })
  ipcMain.handle('admin:cleanupNotifications', async (_, days) => {
    try { requireFreshCommandCentralReauth(); return { ok: true, count: await db.cleanupNotifications(days) } }
    catch (e) { return { ok: false, count: 0, error: e.message } }
  })

  // -- Release Control --------------------------------------------------------
  ipcMain.handle('admin:getScheduledReleases', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.releases.manage'); return await db.getScheduledReleases() }
    catch (error) { throw new Error(error?.message || 'Unable to load scheduled releases') }
  })
  ipcMain.handle('admin:expireOverdueFeatures', async () => {
    try { requireFreshCommandCentralReauth(); return { ok: true, count: await db.expireOverdueFeatures() } }
    catch (e) { return { ok: false, count: 0, error: e.message } }
  })

  // -- Notification Automation ----------------------------------------------
  ipcMain.handle('admin:getNotificationRules', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getNotificationRules() }
    catch (error) { throw new Error(error?.message || 'Unable to load notification automation rules') }
  })
  ipcMain.handle('admin:upsertNotificationRule', async (_, rule) => {
    try { requireFreshCommandCentralReauth(); return await db.upsertNotificationRule(rule) }
    catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('admin:evaluateRule', async (_, ruleKey) => {
    try { requireFreshCommandCentralReauth(); return await db.evaluateRule(ruleKey) }
    catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('admin:evaluateAllRules', async () => {
    try { requireFreshCommandCentralReauth(); return await db.evaluateAllRules() }
    catch (e) { return { ok: false, error: e.message, results: [] } }
  })
  ipcMain.handle('admin:getNotificationEvents', async (_, opts) => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getNotificationEvents(opts || {}) }
    catch { return [] }
  })
  ipcMain.handle('admin:getNotificationEventSummary', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getNotificationEventSummary() }
    catch { return { total_events: 0, undispatched: 0, active_rules: 0, events_by_rule_7d: {} } }
  })
  ipcMain.handle('admin:markEventsDispatched', async (_, eventIds) => {
    try { requireFreshCommandCentralReauth(); return await db.markEventsDispatched(eventIds) }
    catch (e) { return { ok: false, error: e.message } }
  })

  // -- Accounting ----------------------------------------------------------
  ipcMain.handle('admin:getMrrSummary', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); return await db.getMrrSummary() }
    catch (error) { return { ok: false, error: error?.message || 'Unable to load commercial subscription summary', mrr: 0, arr: 0, lodge_count: 0, trials_active: 0, by_plan: {} } }
  })
  ipcMain.handle('admin:getRevenueSummary', async (_, days) => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); return await db.getRevenueSummary(days) }
    catch (error) { return { ok: false, error: error?.message || 'Unable to load customer booking revenue summary', daily: [], total_revenue: 0, payment_count: 0, avg_daily: 0 } }
  })
  ipcMain.handle('admin:getLodgeFinancialSummary', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); return await db.getLodgeFinancialSummary() }
    catch (error) { return { ok: false, error: error?.message || 'Unable to load customer booking balances', lodges: [] } }
  })
  ipcMain.handle('admin:getCollectionsQueue', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); return await db.getCollectionsQueue() }
    catch (error) { return { ok: false, error: error?.message || 'Unable to load customer booking collections', queue: [] } }
  })
  ipcMain.handle('admin:getRevenueByMethod', async (_, days) => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); return await db.getRevenueByMethod(days) }
    catch (error) { return { ok: false, error: error?.message || 'Unable to load customer booking payment methods', methods: [] } }
  })
  ipcMain.handle('admin:generateCommercialInvoice', async (_, payload) => {
    try {
      const admin = requireFreshCommandCentralReauth()
      return await db.generateCommercialInvoice({ ...payload, actor_id: admin.id, actor_email: admin.email })
    } catch (error) {
      return { success: false, error: error?.message || 'Unable to generate commercial invoice' }
    }
  })
  ipcMain.handle('admin:recordCommercialPayment', async (_, payload) => {
    try {
      const admin = requireFreshCommandCentralReauth()
      return await db.recordCommercialPayment({ ...payload, actor_id: admin.id, actor_email: admin.email })
    } catch (error) {
      return { success: false, error: error?.message || 'Unable to record commercial payment' }
    }
  })
  ipcMain.handle('admin:getCommercialInvoices', async (_, filters = {}) => {
    try {
      requireMasterAdmin()
      await requireCapability('command_central.billing.manage')
      if (filters?.lodgeId) assertCommandCentralTarget(filters.lodgeId)
      return await db.listCommercialInvoices(filters)
    } catch (error) {
      throw new Error(error?.message || 'Unable to load commercial invoices')
    }
  })
  ipcMain.handle('admin:getCommercialBillingSummary', async () => {
    try {
      requireMasterAdmin()
      await requireCapability('command_central.billing.manage')
      return await db.getCommercialBillingSummary()
    } catch (error) {
      throw new Error(error?.message || 'Unable to load commercial billing summary')
    }
  })

  // -- Task Center ---------------------------------------------------------
  ipcMain.handle('admin:getAdminToday', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getAdminToday() }
    catch { return { ok: false, error: 'Failed to load', summary: {}, overdue_bookings: [], trials_ending: [], failed_devices: [], urgent_tickets: [], lead_followups: [], recent_payments: [] } }
  })

  // -- Global Search -------------------------------------------------------
  ipcMain.handle('admin:globalSearch', async (_, query, limit) => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.globalSearch(query, limit) }
    catch { return { ok: true, results: [] } }
  })

  // -- Bulk Actions --------------------------------------------------------
  ipcMain.handle('admin:bulkUpdateStatus', async (_, entityType, entityIds, newStatus) => {
    try { requireFreshCommandCentralReauth(); return await db.bulkUpdateStatus(entityType, entityIds, newStatus) }
    catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('admin:bulkDelete', async (_, entityType, entityIds) => {
    try { requireFreshCommandCentralReauth(); return await db.bulkDelete(entityType, entityIds) }
    catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('admin:bulkNotify', async (_, entityType, entityIds, message) => {
    try { requireFreshCommandCentralReauth(); return await db.bulkNotify(entityType, entityIds, message) }
    catch (e) { return { ok: false, error: e.message } }
  })

  // -- Deep Fleet Health + App Update Control ------------------------------
  ipcMain.handle('admin:pushUpdateNotification', async (_, version, message, force) => {
    try { requireFreshCommandCentralReauth(); return await db.pushUpdateNotification(version, message, force) }
    catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('admin:getSyncQueueStatus', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getSyncQueueStatus() }
    catch (error) { return { ok: false, error: error?.message || 'Unable to load sync queue status', devices: [], stale_count: null, total_devices: null } }
  })

  // -- Release Rollout Control --------------------------------------------
  ipcMain.handle('admin:createRelease', async (_, release) => {
    try { requireFreshCommandCentralReauth(); return await db.createRelease(release) }
    catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('admin:updateRelease', async (_, version, updates) => {
    try { requireFreshCommandCentralReauth(); return await db.updateRelease(version, updates) }
    catch (e) { return { ok: false, error: e.message } }
  })
  ipcMain.handle('admin:checkUpdateAvailability', async (_, currentVersion, deviceId) => {
    try { requireMasterAdmin(); await requireCapability('command_central.releases.manage'); return await db.checkUpdateAvailability(currentVersion, deviceId) }
    catch (error) { return { ok: false, error: error?.message || 'Unable to check the product update gate', update_available: false } }
  })
  ipcMain.handle('admin:getReleases', async (_, productId) => {
    try { requireMasterAdmin(); return await db.getReleases(productId || BUILD_PRODUCT_ID) }
    catch (error) { throw new Error(error?.message || 'Unable to load product releases') }
  })
  ipcMain.handle('admin:getSurfaceIntelligence', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getSurfaceIntelligence() }
    catch (e) { return { ok: false, error: e.message, surfaces: [], totals: {} } }
  })

  // -- Admin: Company Stats --------------------------------------------------
  ipcMain.handle('admin:getCompanyStats', async (_, lodgeId) => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); assertCommandCentralTarget(lodgeId); return await db.getCompanyStats(lodgeId) }
    catch (error) { throw new Error(error?.message || 'Unable to load company statistics') }
  })

  // -- Admin: Billing --------------------------------------------------------
  ipcMain.handle('admin:updateLicenseBilling', async () => ({ success: false, error: legacyLicenseMutationRefusal }))
  ipcMain.handle('admin:getOverdueLicenses', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); return await db.getOverdueLicenses() }
    catch (error) { throw new Error(error?.message || 'Unable to load overdue licenses') }
  })

  // -- Invoices --------------------------------------------------------------
  ipcMain.handle('admin:getNextInvoiceNumber', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); return await db.getNextInvoiceNumber() }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('admin:createInvoice', async (_, data) => {
    try { requireFreshCommandCentralReauth(); return await db.createInvoice(data) }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('admin:getInvoices', async (_, filters) => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); return await db.getInvoices(filters) }
    catch (error) { throw new Error(error?.message || 'Unable to load invoices') }
  })
  ipcMain.handle('admin:getInvoicesByLodge', async (_, lodgeId) => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); return await db.getInvoicesByLodge(lodgeId) }
    catch (error) { throw new Error(error?.message || 'Unable to load booking invoices') }
  })
  ipcMain.handle('admin:getClientBookingInvoices', async (_, lodgeId) => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); assertCommandCentralTarget(lodgeId); return await db.getClientBookingInvoices(lodgeId) }
    catch (e) { throw new Error(e.message) }
  })
  ipcMain.handle('admin:updateInvoice', async (_, id, data) => {
    try { requireFreshCommandCentralReauth(); return await db.updateInvoice(id, data) }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('admin:deleteInvoice', async (_, id) => {
    try { requireFreshCommandCentralReauth(); await db.deleteInvoice(id); return { success: true } }
    catch (e) { return { error: e.message } }
  })
  ipcMain.handle('admin:getInvoiceSummary', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.billing.manage'); return await db.getInvoiceSummary() }
    catch (error) { throw new Error(error?.message || 'Unable to load invoice summary') }
  })
  ipcMain.handle('admin:updateCompany', async (_, lodgeId, updates) => {
    try {
      const admin = requireFreshCommandCentralReauth()
      assertCommandCentralTarget(lodgeId)
      const payload = updates && typeof updates === 'object' ? updates : {}
      const reason = String(payload.reason || '').trim()
      if (reason.length < 8) throw new Error('A reason of at least 8 characters is required for company settings changes')
      return await db.updateCompany(lodgeId, {
        ...payload,
        operation_id: payload.operation_id || crypto.randomUUID(),
        reason,
        actor_id: admin.id,
        actor_email: admin.email
      })
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:archiveCompany', async (_, lodgeId) => {
    try { requireMasterAdmin(); assertCommandCentralTarget(lodgeId); return { success: false, error: 'Use the governed company lifecycle workflow with a recorded reason.' } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:restoreCompany', async (_, lodgeId) => {
    try { requireMasterAdmin(); assertCommandCentralTarget(lodgeId); return { success: false, error: 'Use the governed company lifecycle workflow with a recorded reason.' } }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:applyCompanyLifecycle', async (_, payload) => {
    try {
      const admin = requireFreshCommandCentralReauth()
      assertCommandCentralTarget(payload?.lodge_id)
      return await db.applyCompanyLifecycle({ ...payload, actor_id: admin.id, actor_email: admin.email })
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:permanentlyDeleteCompany', async (_, lodgeId) => {
    try {
      requireMasterAdmin()
      assertCommandCentralTarget(lodgeId)
      return { success: false, error: 'Permanent company deletion is disabled while the governed lifecycle workflow is being implemented.' }
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:repairDuplicateEventBookings', async (_, lodgeId) => {
    try { requireFreshCommandCentralReauth(); return await db.repairDuplicateEventBookings(lodgeId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getCompanyUsers', async (_, lodgeId) => {
    try { requireMasterAdmin(); await requireCapability('command_central.security.manage'); assertCommandCentralTarget(lodgeId); return await db.getCompanyUsers(lodgeId) }
    catch (error) { throw new Error(error?.message || 'Unable to load company users') }
  })
  ipcMain.handle('admin:resetCompanyUserPassword', async (_, lodgeId, userId, password) => {
    try { requireFreshCommandCentralReauth(); return await db.resetCompanyUserPassword(lodgeId, userId, password) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateCompanyUserPwaAccess', async (_, lodgeId, userId, payload) => {
    try { requireFreshCommandCentralReauth(); return await db.updateCompanyUserPwaAccess(lodgeId, userId, payload || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:sendInvoiceEmail', async (_, payload) => {
    try { requireFreshCommandCentralReauth(); return await sendInvoiceEmail(payload) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getMarketingLeads', async (_, filters) => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getMarketingLeads(filters || {}) }
    catch (e) { throw new Error(e?.message || 'Unable to load marketing leads') }
  })
  ipcMain.handle('admin:updateMarketingLeadStatus', async (_, id, status) => {
    try { requireFreshCommandCentralReauth(); return await db.updateMarketingLeadStatus(id, status) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateLeadCrm', async (_, id, fields) => {
    try { requireFreshCommandCentralReauth(); return await db.updateLeadCrm(id, fields || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:getSalesPipelineSummary', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getSalesPipelineSummary() }
    catch (e) { throw new Error(e?.message || 'Unable to load sales pipeline') }
  })

  // -- Generic Admin Excel Export --------------------------------------------
  ipcMain.handle('admin:exportExcel', async (event, payload = {}) => {
    const { title = 'Export', rows = [], sheetName, columns } = payload
    const win = BrowserWindow.fromWebContents(event.sender)
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: `Export ${title} to Excel`,
      defaultPath: `${APP_EXPORT_PREFIX}-${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false }
    try {
      const wb = XLSX.utils.book_new()
      const cols = columns || (rows.length ? Object.keys(rows[0]).map(k => ({ key: k, header: k })) : [])
      const headers = cols.map(c => c.header)
      const data = rows.map(row => cols.map(c => row[c.key] ?? ''))
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
      if (cols.length) ws['!cols'] = cols.map(c => ({ wch: c.width || Math.max(12, (c.header || '').length + 4) }))
      XLSX.utils.book_append_sheet(wb, ws, sheetName || title.slice(0, 31))
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
      fs.writeFileSync(filePath, buffer)
      return { success: true, filePath }
    } catch (e) { return { success: false, error: e.message } }
  })

  // -- Generic Admin PDF Export (print-to-PDF) ------------------------------
  ipcMain.handle('admin:exportPdf', async (event, payload = {}) => {
    const { title = 'Export', rows = [], columns } = payload
    const cols = columns || (rows.length ? Object.keys(rows[0]).map(k => ({ key: k, header: k })) : [])
    const win = BrowserWindow.fromWebContents(event.sender)
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: `Export ${title} to PDF`,
      defaultPath: `${APP_EXPORT_PREFIX}-${title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return { success: false }
    const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    const headers = cols.map(c => `<th style="padding:8px 12px;border-bottom:2px solid #333;text-align:left;font-size:11px;color:#666;">${escapeHtml(c.header)}</th>`).join('')
    const bodyRows = rows.map(row =>
      `<tr>${cols.map(c => `<td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:12px;">${escapeHtml(String(row[c.key] ?? ''))}</td>`).join('')}</tr>`
    ).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,sans-serif;padding:40px;color:#111;}
      h1{font-size:18px;margin-bottom:4px;} p.sub{font-size:12px;color:#888;margin-top:0;}
      table{width:100%;border-collapse:collapse;margin-top:16px;}
    </style></head><body>
      <h1>${escapeHtml(title)}</h1><p class="sub">${escapeHtml(APP_BRAND_NAME)} - Generated ${escapeHtml(new Date().toLocaleString())}</p>
      <table><thead><tr>${headers}</tr></thead><tbody>${bodyRows}</tbody></table>
    </body></html>`
    await printWin.loadURL(`data:text/html,${encodeURIComponent(html)}`)
    const pdfData = await printWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    fs.writeFileSync(filePath, pdfData)
    printWin.destroy()
    return { success: true, filePath }
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
    } catch (e) {
      if (/not authenticated/i.test(e?.message || '')) return []
      throw new Error(e?.message || 'Failed to load critical error history')
    }
  })
  ipcMain.handle('reports:clearCriticalErrors', async () => {
    try {
      await requireCapability('system.health')
      return db.clearCriticalErrorLog()
    } catch (e) { throw new Error(e?.message || 'Failed to clear critical error history') }
  })
  ipcMain.handle('reports:saveSupportBundle', async (event, limit = 20) => {
    try {
      await requireCapability('system.health')
      const win = BrowserWindow.fromWebContents(event.sender)
      const today = new Date().toISOString().slice(0, 10)
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Support Bundle',
        defaultPath: `${APP_EXPORT_PREFIX}-support-bundle-${today}.json`,
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
  ipcMain.handle('reports:getSupportBundle', async (_, limit = 20) => {
    try {
      await requireCapability('system.health')
      const payload = {
        ...(await db.getSupportBundle(limit)),
        renderer_errors: getRendererErrorLog(limit)
      }
      return { success: true, bundle: payload }
    } catch (e) {
      return { success: false, error: e?.message || 'Failed to get support bundle' }
    }
  })
  ipcMain.handle('reports:exportOfflineSafetyManifest', async (event) => {
    try {
      await requireCapability('bookings.view')
      const win = BrowserWindow.fromWebContents(event.sender)
      const today = new Date().toISOString().slice(0, 10)
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Offline Safety Manifest',
        defaultPath: `offline-safety-manifest-${today}.xlsx`,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      const manifest = await db.getOfflineSafetyData()
      const wb = XLSX.utils.book_new()
      ;[
        ['Arrivals', manifest?.arrivals || []],
        ['Departures', manifest?.departures || []],
        ['In House', manifest?.inHouse || []],
        ['Upcoming', manifest?.upcoming || []]
      ].forEach(([name, rows]) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name)
      })
      XLSX.writeFile(wb, result.filePath)
      return { success: true, filePath: result.filePath }
    } catch (e) {
      return { success: false, error: e?.message || 'Failed to export offline safety manifest' }
    }
  })
  ipcMain.handle('reports:runFinancialValidation', async () => {
    try {
      await requireCapability('system.health')
      return await db.runFinancialValidation({ triggerSource: 'manual' })
    } catch (e) { return { success: false, error: e.message } }
  })

  // -- Email Notifications ---------------------------------------------------
  ipcMain.handle('email:getConfig', () => {
    const config = getEmailConfig()
    if (!config) return null
    // Mask password before sending to renderer
    return { ...config, pass: config.pass ? '********' : '' }
  })
  ipcMain.handle('email:saveConfig', async (_, config) => {
    requireRole('admin', 'super_admin')
    // If pass is masked (user didn't change it), keep existing password
    if (config.pass === '********') {
      const existing = getEmailConfig()
      config.pass = existing?.pass || ''
    }
    return saveEmailConfig(config)
  })
  ipcMain.handle('email:test', async (_, config) => {
    requireRole('admin', 'super_admin')
    // Unmask pass if needed
    if (config.pass === '********') {
      const existing = getEmailConfig()
      config.pass = existing?.pass || ''
    }
    return testEmailConfig(config)
  })
  ipcMain.handle('email:sendLicense', async (_, payload) => {
    try { requireMasterAdmin(); await requireCapability('command_central.licensing.manage'); return await sendLicenseEmail(payload) }
    catch (e) { return { success: false, error: e.message } }
  })

  // -- Users -----------------------------------------------------------------
  ipcMain.handle('users:getAll', async () => {
    try { await requireCapability('staff.view'); return await db.getAllUsers() }
    catch { return [] }
  })
  ipcMain.handle('users:create', async (_, data) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('staff.manage')
      const actor = db.getCurrentUser?.()
      assertManagerStaffScope(actor, null, data)
      if (normalizeAppRole(actor?.role) !== 'manager' && data?.role && normalizeAppRole(data.role) !== 'receptionist') {
        await requireCapability('staff.permissions')
      }
      return { success: true, id: await db.createUser(data) }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('users:update', async (_, id, data) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('staff.manage')
      const actor = db.getCurrentUser?.()
      const targetUser = await assertResourceBelongsToCurrentLodge('User', id, db.getUserById)
      assertManagerStaffScope(actor, targetUser, data)
      if (normalizeAppRole(actor?.role) !== 'manager' && data?.role) {
        await requireCapability('staff.permissions')
      }
      await db.updateUser(id, data); return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('users:resetPassword', async (_, id, password) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('staff.manage')
      const targetUser = await assertResourceBelongsToCurrentLodge('User', id, db.getUserById)
      assertManagerStaffScope(db.getCurrentUser?.(), targetUser)
      await db.resetUserPassword(id, password); return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('users:delete', async (_, id) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('staff.manage')
      const targetUser = await assertResourceBelongsToCurrentLodge('User', id, db.getUserById)
      assertManagerStaffScope(db.getCurrentUser?.(), targetUser)
      await db.deleteUser(id); return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('users:getAccessAudit', async () => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('staff.manage')
      return { success: true, entries: await db.getStaffAccessAudit(100) }
    } catch (e) { return { success: false, error: e.message, entries: [] } }
  })

  // -- Staff Scheduling & Attendance --------------------------------------------
  ipcMain.handle('staffScheduling:getSchedule', async (_, date) => {
    try { return await db.getStaffSchedule(date) }
    catch (e) { return [] }
  })
  ipcMain.handle('staffScheduling:getScheduleRange', async (_, startDate, endDate) => {
    try { return await db.getStaffScheduleRange(startDate, endDate) }
    catch (e) { return [] }
  })
  ipcMain.handle('staffScheduling:upsertSchedule', async (_, staffId, scheduleDate, shiftLabel, startTime, endTime, roleAtShift, notes) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('staff.manage')
      return await db.upsertStaffSchedule(staffId, scheduleDate, shiftLabel, startTime, endTime, roleAtShift, notes)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffScheduling:deleteEntry', async (_, id) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('staff.manage')
      return await db.deleteStaffScheduleEntry(id)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffScheduling:getAttendanceToday', async () => {
    try { return await db.getStaffAttendanceToday() }
    catch (e) { return [] }
  })
  ipcMain.handle('staffScheduling:getAttendanceRange', async (_, startDate, endDate, staffId) => {
    try { return await db.getStaffAttendanceRange(startDate, endDate, staffId) }
    catch (e) { return [] }
  })
  ipcMain.handle('staffScheduling:getAttendanceDashboard', async () => {
    try { return await db.getStaffAttendanceDashboard() }
    catch (e) { return null }
  })
  ipcMain.handle('staffScheduling:clockIn', async (_, staffId, shiftLabel, notes) => {
    try {
      await requireCapability('staff.manage')
      return await db.clockInStaffHotel(staffId, shiftLabel, notes)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffScheduling:clockOut', async (_, attendanceId, notes) => {
    try {
      await requireCapability('staff.manage')
      return await db.clockOutStaffHotel(attendanceId, notes)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffScheduling:getLeaveRequests', async (_, status, staffId) => {
    try { return await db.getStaffLeaveRequests(status, staffId) }
    catch (e) { return [] }
  })
  ipcMain.handle('staffScheduling:requestLeave', async (_, staffId, leaveType, startDate, endDate, reason) => {
    try {
      await requireCapability('staff.manage')
      return await db.requestStaffLeave(staffId, leaveType, startDate, endDate, reason)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffScheduling:approveLeave', async (_, id, status, rejectionReason) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('staff.manage')
      return await db.approveStaffLeave(id, status, rejectionReason)
    } catch (e) { return { success: false, error: e.message } }
  })

  // -- Staff Operations (Phase 4 depth) ------------------------------------
  ipcMain.handle('staffOperations:getStaffDepartments', async () => {
    try { await requireCapability('workforce_scheduling.view'); return await db.getStaffDepartments() }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:createStaffDepartment', async (_, name, description, color) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.createStaffDepartment(name, description, color) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:updateStaffDepartment', async (_, id, payload) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.updateStaffDepartment(id, payload) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:deleteStaffDepartment', async (_, id) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.deleteStaffDepartment(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:getShiftTemplates', async (_, departmentId) => {
    try { await requireCapability('workforce_scheduling.view'); return await db.getShiftTemplates(departmentId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:createShiftTemplate', async (_, payload) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.createShiftTemplate(payload) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:updateShiftTemplate', async (_, id, payload) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.updateShiftTemplate(id, payload) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:deleteShiftTemplate', async (_, id) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.deleteShiftTemplate(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:getTaskCategories', async () => {
    try { await requireCapability('workforce_scheduling.view'); return await db.getTaskCategories() }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:createTaskCategory', async (_, name, color) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.createTaskCategory(name, color) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:getTaskAssignments', async (_, staffId, status, date) => {
    try { await requireCapability('workforce_scheduling.view'); return await db.getTaskAssignments(staffId, status, date) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:createTaskAssignment', async (_, payload) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.createTaskAssignment(payload) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:updateTaskAssignment', async (_, id, payload) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.updateTaskAssignment(id, payload) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:completeTaskAssignment', async (_, id, notes) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.completeTaskAssignment(id, notes) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:getTrainingChecklists', async (_, departmentId) => {
    try { await requireCapability('workforce_scheduling.view'); return await db.getTrainingChecklists(departmentId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:createTrainingChecklist', async (_, payload) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.createTrainingChecklist(payload) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:recordTrainingCompletion', async (_, staffId, checklistId, notes) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.recordTrainingCompletion(staffId, checklistId, notes) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:getTrainingRecords', async (_, staffId) => {
    try { await requireCapability('workforce_scheduling.view'); return await db.getTrainingRecords(staffId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:createShiftHandover', async (_, payload) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.createShiftHandover(payload) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:getShiftHandovers', async (_, date) => {
    try { await requireCapability('workforce_scheduling.view'); return await db.getShiftHandovers(date) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:getStaffProductivityDashboard', async (_, startDate, endDate) => {
    try { await requireCapability('workforce_scheduling.view'); return await db.getStaffProductivityDashboard(startDate, endDate) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:publishWeeklySchedule', async (_, weekStart) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('workforce_scheduling.manage'); return await db.publishWeeklySchedule(weekStart) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('staffOperations:getScheduleConflicts', async (_, weekStart) => {
    try { await requireCapability('workforce_scheduling.view'); return await db.getScheduleConflicts(weekStart) }
    catch (e) { return { success: false, error: e.message } }
  })

  // -- Rooms -----------------------------------------------------------------
  ipcMain.handle('rooms:getAll', async () => {
    try {
      await requireCapability('rooms.view')
      return await db.getAllRooms()
    } catch (error) {
      console.warn('[Rooms] rooms:getAll using cache fallback:', error?.message || error)
      try {
        return await db.getAllRooms()
      } catch {
        return []
      }
    }
  })
  ipcMain.handle('rooms:getCached', async () => {
    try {
      await requireCapability('rooms.view')
      return readCache('rooms')
    } catch {
      return []
    }
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

  // -- Customers -------------------------------------------------------------
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

  // -- Bookings --------------------------------------------------------------
  ipcMain.handle('bookings:getAll', async () => {
    try { await requireCapability('bookings.view'); return await db.getAllBookings() }
    catch { return [] }
  })
  ipcMain.handle('bookings:getCollectionsSummary', async () => {
    try { await requireCapability('bookings.view'); return await db.getCollectionsSummary() }
    catch { return { count: 0, amount: 0 } }
  })
  ipcMain.handle('bookings:getCachedByDateRange', async (_, start, end) => {
    try {
      await requireCapability('bookings.view')
      const bookings = readCache('bookings')
      const customers = readCache('customers')
      const rooms = readCache('rooms')
      return bookings
        .filter((booking) => (
          booking?.status !== 'cancelled' &&
          booking?.check_in <= end &&
          booking?.check_out > start
        ))
        .map((booking) => {
          const customer = customers.find((entry) => entry.id === booking.customer_id)
          const room = rooms.find((entry) => entry.id === booking.room_id)
          return {
            ...booking,
            customer_name: booking.customer_name || customer?.name,
            customer_phone: booking.customer_phone || customer?.phone,
            customer_email: booking.customer_email || customer?.email,
            room_number: booking.room_number || room?.room_number,
            room_type: booking.room_type || room?.room_type,
            rate_per_night: booking.rate_per_night || room?.rate_per_night
          }
        })
        .sort((a, b) => String(a.room_number || '').localeCompare(String(b.room_number || '')))
    } catch {
      return []
    }
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
      notifyLodge(data.lodge_id, 'ðŸ“‹ New booking created', `Guest arriving ${data.check_in || ''}`, {
        tag: `booking-created:${id}`,
        dedupeKey: `booking-created:${id}`,
        version: id,
        url: '/#/bookings'
      })
      return { success: true, id }
    } catch (e) {
      if (e.code === 'DEPOSIT_FAILED') {
        notifyLodge(data.lodge_id, 'ðŸ“‹ New booking created', `Guest arriving ${data.check_in || ''}`, {
          tag: `booking-created:${e.booking_id}`,
          dedupeKey: `booking-created:${e.booking_id}`,
          version: e.booking_id,
          url: '/#/bookings'
        })
        return { success: true, id: e.booking_id, depositWarning: e.message }
      }
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('bookings:createMultiRoom', async (_, data) => {
    try {
      await requireCapability('bookings.manage')
      const result = await db.createMultiRoomBooking(data)
      notifyLodge(data.lodge_id, 'ðŸ“‹ Multi-room booking created', `${result.bookings?.length || result.booking_ids?.length || 0} rooms arriving ${data.check_in || ''}`, {
        tag: `booking-group-created:${result.group_id}`,
        dedupeKey: `booking-group-created:${result.group_id}`,
        version: result.group_id,
        url: '/#/bookings'
      })
      return { success: true, ...result }
    } catch (e) {
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
      return await db.updateBookingPayment(id, amount, method, 'payment', null, intentKey)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('bookings:updateGroupPayment', async (_, groupId, amount, method, intentKey) => {
    try {
      await requireCapability('payments.record')
      return await db.updateGroupInvoicePayment(groupId, amount, method, intentKey)
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
  ipcMain.handle('bookings:refundGroup', async (_, groupId, payload) => {
    try {
      await requireCapability('payments.refund')
      return await db.refundGroupInvoice(groupId, payload)
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
        // Room bookings were created - only deposit recording failed.
        // Return success so the operator knows the event exists; depositWarning signals action needed.
        const eventDedupeId = e.booking_id || `${data.event_name || 'event'}:${data.check_in || ''}:${data.check_out || ''}`
        notifyLodge(data.lodge_id, 'ðŸ“‹ Event booking created', `${data.event_name || ''} - deposit not recorded`, {
          tag: `event-booking-deposit-warning:${eventDedupeId}`,
          dedupeKey: `event-booking-deposit-warning:${eventDedupeId}`,
          version: eventDedupeId,
          url: '/#/bookings'
        })
        return { success: true, depositWarning: e.message }
      }
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('bookings:reschedule', async (_, bookingId, data) => {
    try {
      await requireCapability('bookings.manage')
      await assertResourceBelongsToCurrentLodge('Booking', bookingId, db.getBookingById)
      return await db.rescheduleBooking(bookingId, {
        newRoomId: data.new_room_id || data.newRoomId,
        newCheckIn: data.new_check_in || data.newCheckIn,
        newCheckOut: data.new_check_out || data.newCheckOut,
        reason: data.reason,
        overpaymentAction: data.overpayment_action || data.overpaymentAction || 'reject',
        allowTotalOverride: data.allow_total_override || data.allowTotalOverride || false,
        overrideTotal: data.override_total || data.overrideTotal || null
      })
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // -- Customer Credit ------------------------------------------------------
  ipcMain.handle('customerCredit:getBalance', async (_, customerId) => {
    try {
      await requireCapability('invoices.view')
      return await db.getCustomerCreditBalance(customerId)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('customerCredit:getHistory', async (_, customerId, limit, offset) => {
    try {
      await requireCapability('invoices.view')
      return await db.getCustomerCreditHistory(customerId, limit, offset)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('customerCredit:getSummary', async (_, search, limit, offset) => {
    try {
      await requireCapability('invoices.view')
      return await db.getCustomerCreditSummary(search, limit, offset)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('customerCredit:record', async (_, data) => {
    try {
      await requireCapability('payments.record')
      return await db.recordCustomerCredit(data)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('customerCredit:applyToBooking', async (_, data) => {
    try {
      await requireCapability('payments.record')
      if (data.bookingId) await assertResourceBelongsToCurrentLodge('Booking', data.bookingId, db.getBookingById)
      return await db.applyCustomerCreditToBooking(data)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('customerCredit:refund', async (_, data) => {
    try {
      await requireCapability('payments.refund')
      return await db.refundCustomerCredit(data)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('customerCredit:reverse', async (_, data) => {
    try {
      await requireCapability('payments.refund')
      return await db.reverseCustomerCreditEntry(data)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // -- Quotations ------------------------------------------------------------
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

  // -- Reports ---------------------------------------------------------------
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
  ipcMain.handle('reports:maintenanceRows', async (_, start, end) => {
    try { await requireCapability('reports.view'); return await db.getMaintenanceRowsForPeriod(start, end) }
    catch (e) { throw new Error(e?.message || 'Failed to load maintenance costs report') }
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
  ipcMain.handle('requests:markRead', async (_, id, audience, messageId) => {
    try {
      requireRole('receptionist', 'manager', 'admin', 'super_admin')
      await assertResourceBelongsToCurrentLodge('Support request', id, db.getLodgeSupportTicketById)
      return await db.markLodgeSupportTicketRead(id, audience || 'front_desk', messageId || null)
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('requests:addMessage', async (_, id, payload) => {
    try {
      requireRole('receptionist', 'manager', 'admin', 'super_admin')
      await assertResourceBelongsToCurrentLodge('Support request', id, db.getLodgeSupportTicketById)
      return await db.addLodgeSupportTicketMessage(id, payload || {})
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
  ipcMain.handle('reports:savePDF', async (event, payload = {}) => {
    await requireCapability('reports.view')
    const win = BrowserWindow.fromWebContents(event.sender)
    const {
      reportType = 'report',
      reportTitle = 'Report',
      start = '',
      end = '',
      date = ''
    } = payload || {}
    const period = start && end ? `${start}-to-${end}` : date || ''
    const result = await dialog.showSaveDialog(win, {
      title: `Save ${reportTitle} as PDF`,
      defaultPath: buildReportExportFilename({ prefix: APP_EXPORT_PREFIX, reportTitle: reportTitle || reportType, period, extension: 'pdf' }),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      const pdfBuffer = await printWebContentsToPdfSafely(win.webContents, {
        pageSize: 'A4',
        printBackground: false,
        margins: { marginType: 'default' }
      }, { minTextLength: 20 })
      fs.writeFileSync(result.filePath, pdfBuffer)
      return { success: true, filePath: result.filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('reports:printCurrent', async (event) => {
    try {
      await requireCapability('reports.view')
      const win = BrowserWindow.fromWebContents(event.sender)
      return await printWebContentsSafely(win.webContents, {
        silent: false,
        printBackground: true,
        margins: { marginType: 'default' }
      }, { minTextLength: 20 })
    } catch (e) {
      return { success: false, error: e?.message || 'Print failed.' }
    }
  })

  // -- Notifications ---------------------------------------------------------
  ipcMain.handle('notifications:today', async () => {
    try { await requireCapability('dashboard.view'); return await db.getTodayActivity() }
    catch { return [] }
  })
  ipcMain.handle('notifications:upcoming', async () => {
    try { await requireCapability('dashboard.view'); return await db.getUpcomingCheckins() }
    catch { return [] }
  })

  ipcMain.handle('db:getSyncStatus', async () => { try { return db.getSyncStatus() } catch (e) { return { pending: 0, failed: 0, isOnline: false, failedBookingIds: [] } } })

  // -- Shell -----------------------------------------------------------------
  ipcMain.handle('shell:openExternal', async (_, url) => {
    if (!isSafeExternalUrl(url)) return { success: false, error: 'Blocked: unsafe URL protocol' }
    await shell.openExternal(url)
    return { success: true }
  })

  ipcMain.handle('app:setTestOfflineMode', async (_, forceOffline) => {
    if (app.isPackaged && !process.env.BOROKO_TEST_USER_DATA_DIR) {
      return { success: false, error: 'Test offline mode is disabled in production builds.' }
    }
    process.env.BOROKO_TEST_FORCE_OFFLINE = forceOffline ? 'true' : 'false'
    await db.checkOnline?.().catch(() => false)
    return { success: true, forceOffline: process.env.BOROKO_TEST_FORCE_OFFLINE === 'true' }
  })

  // -- Excel Export ----------------------------------------------------------
  ipcMain.handle('reports:saveExcel', async (event, payload = {}) => {
    await requireCapability('reports.view')
    const win = BrowserWindow.fromWebContents(event.sender)
    const {
      occupancy = [],
      revenue = null,
      expenses = [],
      posSales = null,
      invSpend = null,
      supSpend = null,
      profitLoss = null,
      start = '',
      end = '',
      currency,
      reportTitle = 'Finance Workbook',
      lodgeName = '',
      companyName = '',
      outletLabel = '',
      generatedAt = new Date().toLocaleString()
    } = payload || {}
    const period = start && end ? `${start}-to-${end}` : ''
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: `Export ${reportTitle} to Excel`,
      defaultPath: buildReportExportFilename({ prefix: APP_EXPORT_PREFIX, reportTitle, period, extension: 'xlsx' }),
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false }
    try {
      const wb = XLSX.utils.book_new()
      const sym = currency || 'P'
      const totalDays = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000))
      const resolvedLodge = lodgeName || companyName || APP_BRAND_NAME
      const sharedMeta = { lodgeName: resolvedLodge, companyName, periodLabel: `${start} to ${end}`, generatedAt }
      const outletMeta = { ...sharedMeta, outletLabel }

      // Revenue Summary sheet
      const revRows = [
        [`${resolvedLodge} - Revenue Report`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['Metric', 'Value'],
        ['Total Revenue',      `${sym} ${Number(revenue?.total_revenue || 0).toFixed(2)}`],
        ['Regular Bookings',   (revenue?.total_bookings || 0) - (revenue?.event_count || 0)],
        ['Exclusive Events',   revenue?.event_count || 0],
        ['Total Bookings',     revenue?.total_bookings || 0],
        ['Avg Booking Value',  `${sym} ${Number(revenue?.avg_booking_value || 0).toFixed(2)}`]
      ]
      if ((revenue?.event_count || 0) > 0) {
        revRows.push([], ['EXCLUSIVE EVENTS'])
        revRows.push(['Event', 'Dates', 'Nights', 'Rooms', `Daily Rate (${sym})`, `Total (${sym})`])
        ;(revenue.event_bookings || []).forEach((evt, i) => {
          revRows.push([
            `Event ${i + 1}`,
            `${evt.check_in} -> ${evt.check_out}`,
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
        ['Fees Kept From Refunds', `${sym} ${Number(revenue?.retained_revenue || 0).toFixed(2)}`],
        ['Outstanding',        `${sym} ${Number(revenue?.outstanding_amount || 0).toFixed(2)}`]
      )
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(revRows), 'Revenue Summary')

      // Room Occupancy sheet
      const occRows = [
        [`${resolvedLodge} - Room Occupancy Report`],
        ...buildWorkbookMetaRows(sharedMeta),
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
          [`${resolvedLodge} - Expenses Report`],
          ...buildWorkbookMetaRows({ ...outletMeta, includeOutlet: true }),
          ['Date', 'Category', 'Description', `Amount (${sym})`],
          ...expenses.map((e) => [e.date || '', e.category || '', e.description || '', Number(e.amount || 0).toFixed(2)]),
          [],
          ['TOTAL', '', '', expenses.reduce((s, e) => s + Number(e.amount || 0), 0).toFixed(2)]
        ]
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(expRows), 'Expenses')
      }

      // POS Sales sheet
      if (posSales) {
        const posRows = [
          [`${resolvedLodge} - POS Sales Report`],
          ...buildWorkbookMetaRows({ ...outletMeta, includeOutlet: true }),
          ['Metric', 'Value'],
          ['Total Revenue',  `${sym} ${Number(posSales.total_revenue || 0).toFixed(2)}`],
          ['Total Orders',   posSales.total_orders || 0],
          ['Avg Order Value',`${sym} ${Number(posSales.avg_order || 0).toFixed(2)}`]
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
          [`${resolvedLodge} - Stock Costs Report`],
          ...buildWorkbookMetaRows({ ...outletMeta, includeOutlet: true }),
          ['Category', `Amount (${sym})`],
          ['Inventory Purchases', Number(invSpend?.total || 0).toFixed(2)],
          ['Room Supplies', Number(supSpend?.total || 0).toFixed(2)],
          ['TOTAL', (Number(invSpend?.total || 0) + Number(supSpend?.total || 0)).toFixed(2)]
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
          [`${resolvedLodge} - Profit & Loss Statement`],
          ...buildWorkbookMetaRows(sharedMeta),
          ['REVENUE', `${sym}`],
          ['Booking Revenue',  Number(pl.bookingRevenue || 0).toFixed(2)],
        ]
        if (pl.regularRevenue > 0 || pl.eventRevenue > 0) {
          plRows.push(['  Regular Revenue', Number(pl.regularRevenue || 0).toFixed(2)])
          if (pl.eventRevenue > 0) plRows.push(['  Event Revenue', Number(pl.eventRevenue || 0).toFixed(2)])
        }
        plRows.push(
          ['Fees Kept From Refunds', Number(pl.retainedRevenue || 0).toFixed(2)],
          ['POS Revenue',      Number(pl.posRevenue || 0).toFixed(2)]
        )
        if (pl.conferenceRevenue > 0) plRows.push(['Conference Revenue', Number(pl.conferenceRevenue).toFixed(2)])
        if (pl.poolRevenue > 0) plRows.push(['Day Use / Facility Access', Number(pl.poolRevenue).toFixed(2)])
        plRows.push(['Total Revenue',    Number(pl.totalRevenue || 0).toFixed(2)])
        if (pl.vatEnabled) {
          plRows.push([`VAT (${pl.vatRate}% inclusive)`, `-${Number(pl.vatAmount || 0).toFixed(2)}`])
          plRows.push(['Net Revenue (excl. VAT)', Number(pl.netRevenue || 0).toFixed(2)])
        }
        plRows.push(
          [],
          ['KEY METRICS', ''],
          ['Bookings', String(pl.totalBookings || 0)],
          ['Avg Booking Value', Number(pl.avgBookingValue || 0).toFixed(2)],
          ['Refunds Issued', Number(pl.refundsIssued || 0).toFixed(2)],
          ['Outstanding', Number(pl.outstandingAmount || 0).toFixed(2)],
          [],
          ['EXPENSES', ''],
          ['Operating Expenses', Number(pl.totalExpenses || 0).toFixed(2)],
          ['Inventory Purchases', Number(pl.invCosts || 0).toFixed(2)],
          ['Room Supplies',      Number(pl.supCosts || 0).toFixed(2)],
          ['Maintenance Repairs', Number(pl.maintenanceCosts || 0).toFixed(2)],
          ['Total Stock & Maintenance Costs', Number(pl.totalCosts || 0).toFixed(2)],
          ['Total Outgoings',    Number((pl.totalExpenses || 0) + (pl.totalCosts || 0)).toFixed(2)],
          [],
          ['GROSS PROFIT', Number(pl.grossProfit || 0).toFixed(2)],
          ['Gross Margin %', `${Number(pl.grossMarginPct || 0).toFixed(1)}%`]
        )
        if (pl.expByCategory && Object.keys(pl.expByCategory).length > 0) {
          plRows.push([], ['EXPENSE BREAKDOWN'])
          for (const [cat, amt] of Object.entries(pl.expByCategory)) {
            plRows.push([cat, Number(amt).toFixed(2)])
          }
        }
        if (pl.bookingPaymentByMethod && Object.keys(pl.bookingPaymentByMethod).length > 0) {
          plRows.push([], ['REVENUE BY PAYMENT METHOD'])
          for (const [method, amt] of Object.entries(pl.bookingPaymentByMethod)) {
            plRows.push([method.charAt(0).toUpperCase() + method.slice(1), Number(amt).toFixed(2)])
          }
        }
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(plRows), 'P&L')
      }

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
      fs.mkdirSync(dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, buffer)
      if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        throw new Error('File was not written successfully')
      }
      return { success: true, filePath, size: fs.statSync(filePath).size }
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EACCES') {
        return { success: false, error: `Cannot save file: ${e.code === 'EBUSY' ? 'the destination file is open or locked' : 'permission denied'}. Please close the file and try again.` }
      }
      return { success: false, error: e.message }
    }
  })

  // -- Detailed Reports Export (Server-Authoritative Excel) --------------------
  ipcMain.handle('reports:exportDetailedExcel', async (event, payload = {}) => {
    await requireCapability('reports.view')
    const win = BrowserWindow.fromWebContents(event.sender)
    const {
      startDate = '',
      endDate = '',
      currency = 'P',
      lodgeName = '',
      companyName = '',
      outletLabel = '',
      activeTab = 'bookings'
    } = payload || {}
    if (!startDate || !endDate) return { success: false, error: 'Date range is required.' }
    const period = `${startDate}-to-${endDate}`
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Export Detailed Reports to Excel',
      defaultPath: buildReportExportFilename({ prefix: APP_EXPORT_PREFIX, reportTitle: 'detailed-reports', period, extension: 'xlsx' }),
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false, canceled: true }
    try {
      const data = await db.loadDetailedReportData(state.lodgeId, startDate, endDate, outletLabel)
      const reconciliation = db.computeReconciliation(data)
      const generatedAt = new Date().toLocaleString()
      const sym = currency || 'P'
      const resolvedLodge = lodgeName || companyName || APP_BRAND_NAME
      const wb = XLSX.utils.book_new()

      const sharedMeta = { lodgeName: resolvedLodge, companyName, periodLabel: `${startDate} to ${endDate}`, currency: sym, outletLabel, generatedAt, asOf: reconciliation.asOf, reconciliationStatus: reconciliation.reconciliationStatus, exportVersion: db.EXPORT_VERSION }

      function addSheetWithFormatting(sheetName, aoa, opts = {}) {
        const sheet = XLSX.utils.aoa_to_sheet(aoa)
        const numCols = aoa.reduce((max, r) => Math.max(max, Array.isArray(r) ? r.length : 0), 0)
        const headerRow = Number.isInteger(opts.headerRow)
          ? opts.headerRow
          : aoa.findIndex((row) => Array.isArray(row) && row.length >= 3)
        const widths = Array.from({ length: numCols }, (_, i) => {
          let maxLen = 10
          for (const row of aoa.slice(0, 50)) {
            if (!Array.isArray(row)) continue
            const cell = row[i]
            if (cell != null) maxLen = Math.max(maxLen, Math.min(String(cell).length + 2, 60))
          }
          return { wch: maxLen }
        })
        sheet['!cols'] = widths
        if (headerRow >= 0 && aoa.length > headerRow + 1) {
          sheet['!freeze'] = { xSplit: 0, ySplit: headerRow + 1 }
        }
        if (opts.filter !== false && headerRow >= 0 && aoa.length > headerRow + 1) {
          sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: aoa.length - 1, c: numCols - 1 } }) }
        }
        if (headerRow >= 0) {
          const headers = aoa[headerRow] || []
          for (let c = 0; c < headers.length; c++) {
            const header = String(headers[c] || '')
            const isDate = /(date|timestamp|check-in|check-out|created|cancelled|issued|due|last payment)/i.test(header)
            const isMoney = header.includes(`(${sym})`) || /(amount|balance|gross|subtotal|tax|cost|revenue|refund|retained|paid|variance)/i.test(header)
            for (let r = headerRow + 1; r < aoa.length; r++) {
              const cell = sheet[XLSX.utils.encode_cell({ r, c })]
              if (!cell) continue
              if (isDate && typeof cell.v === 'string' && /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/.test(cell.v)) {
                const parsed = new Date(cell.v)
                if (!Number.isNaN(parsed.getTime())) {
                  cell.t = 'd'
                  cell.v = parsed
                  cell.z = parsed.getUTCHours() || parsed.getUTCMinutes() ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd'
                }
              } else if (isMoney && typeof cell.v === 'number') {
                cell.z = '#,##0.00;[Red]-#,##0.00'
              }
            }
          }
        }
        XLSX.utils.book_append_sheet(wb, sheet, db.safeSheetName(sheetName))
      }

      function addEmptySheet(sheetName, meta, headers) {
        const aoa = [
          ...meta,
          headers,
          ['No records for this period']
        ]
        addSheetWithFormatting(sheetName, aoa, { filter: false })
      }

      function money(v) { return `${sym} ${Number(v || 0).toFixed(2)}` }

      // 1. Report Information sheet
      const infoRows = [
        ...db.buildExportMetaRows(sharedMeta),
        ['REPORT DATE RULES'],
        ['Booking Register', db.DATE_BASIS.bookings],
        ['Payment Transactions', db.DATE_BASIS.payments],
        ['Cancelled Bookings', db.DATE_BASIS.cancellations],
        ['Refunds', db.DATE_BASIS.refunds],
        ['Outstanding Balances', db.DATE_BASIS.outstanding],
        ['Quotations', db.DATE_BASIS.quotations],
        ['Invoice Register', db.DATE_BASIS.invoices],
        [],
        ['RECONCILIATION CONTROLS'],
        ['Per-booking ledger', reconciliation.controls?.perBooking?.status || 'N/A', reconciliation.controls?.perBooking?.variance != null ? money(reconciliation.controls.perBooking.variance) : ''],
        ['Cash reconciliation', reconciliation.controls?.cash?.status || 'N/A', reconciliation.controls?.cash?.variance != null ? money(reconciliation.controls.cash.variance) : ''],
        ['Outstanding reconciliation', reconciliation.controls?.outstanding?.status || 'N/A'],
        ['Refund reconciliation', reconciliation.controls?.refund?.status || 'N/A', reconciliation.controls?.refund?.variance != null ? money(reconciliation.controls.refund.variance) : ''],
        ['Register gross reconciliation', reconciliation.controls?.register?.status || 'N/A'],
        [],
        ['RECONCILIATION SUMMARY'],
        ['Gross Booking Value', money(reconciliation.grossBookingValue)],
        ['Gross Positive Receipts', money(reconciliation.positiveReceipts)],
        ['Refunds Issued', money(reconciliation.refundsIssued)],
        ['Net Cash Movement', money(reconciliation.netCash)],
        ['Retained Fees', money(reconciliation.retainedFees)],
        ['Outstanding Balances', money(reconciliation.outstandingBalances)],
        ['Payment Ledger Total', money(reconciliation.paymentLedgerTotal)],
        ['Booking Amount Paid Snapshot', money(reconciliation.bookingAmountPaidTotal)],
        ['Ledger vs Net Cash Variance', money(reconciliation.ledgerVariance)],
        ['Reconciliation Status', reconciliation.reconciliationStatus]
      ]
      addSheetWithFormatting('Report Info', db.sanitizeRow(infoRows), { filter: false })

      // 2. Booking Register (always create)
      {
        const bkHeaders = ['Booking Number', 'Invoice Number', 'Guest Name', 'Guest Phone', 'Guest Email', 'Room Number', 'Room Type', 'Booking Type', 'Booking Source', 'Quotation Number', 'Check-In', 'Check-Out', 'Nights', 'Adults', 'Children', 'Booking Status', 'Payment Status', 'Payment Method Summary', `Accommodation (${sym})`, `Folio Charges (${sym})`, `Gross Total (${sym})`, `Lifetime Paid (${sym})`, `Balance Due (${sym})`, 'VAT Rate', `VAT Amount (${sym})`, `Net Excl VAT (${sym})`, 'Created At', 'Created By', 'Notes']
        const bkRows = data.bookings.map((b) => [
          b.booking_number || '', b.invoice_number || '', b.guest_name || '', b.guest_phone || '', b.guest_email || '',
          b.room_number || '', b.room_type || '', b.booking_type || '', b.booking_source || '', b.quotation_number || '',
          b.check_in || '', b.check_out || '', b.nights || 0, b.adults || 0, b.children || 0,
          b.booking_status || '', b.payment_status || '', b.payment_method_summary || 'None',
          Number(b.accommodation_amount || 0), Number(b.folio_charges || 0), Number(b.gross_total || 0),
          Number(b.lifetime_amount_paid || 0), Number(b.balance_due || 0),
          Number(b.vat_rate || 0), Number(b.vat_amount || 0), Number(b.net_excluding_vat || 0),
          b.created_at || '', b.created_by || '', b.notes || ''
        ])
        const aoa = [...db.buildExportMetaRows(sharedMeta), bkHeaders, ...bkRows.map(db.sanitizeRow)]
        if (bkRows.length === 0) aoa.push(['No records for this period'])
        addSheetWithFormatting('Booking Register', aoa)
      }

      // 3. Payment Transactions (always create)
      {
        const ptHeaders = ['Payment ID', 'Timestamp', 'Booking Number', 'Invoice Number', 'Guest', 'Transaction Type', 'Payment Method', `Amount (${sym})`, 'Recorded By', 'Idempotency Key', 'Notes']
        const ptRows = data.payments.map((p) => [
          p.payment_id || '', p.paid_at || '', p.booking_number || '', p.invoice_number || '',
          p.guest_name || '', p.transaction_type || '', p.payment_method || '',
          Number(p.amount || 0), p.recorded_by || '', p.idempotency_key || '', p.notes || ''
        ])
        const aoa = [...db.buildExportMetaRows(sharedMeta), ptHeaders, ...ptRows.map(db.sanitizeRow)]
        if (ptRows.length === 0) aoa.push(['No records for this period'])
        addSheetWithFormatting('Payment Transactions', aoa)
      }

      // 4. Outstanding Balances (always create)
      {
        const obHeaders = ['Booking Number', 'Invoice Number', 'Guest', 'Room', 'Check-In', 'Check-Out', `Gross Total (${sym})`, `Amount Paid (${sym})`, `Balance Due (${sym})`, 'Payment Status', 'Booking Status', 'Due Date', 'Days Overdue', 'Aging Bucket', 'Last Payment Date', 'Last Payment Method']
        const obRows = data.outstanding.map((o) => [
          o.booking_number || '', o.invoice_number || '', o.guest_name || '', o.room_number || '',
          o.check_in || '', o.check_out || '', Number(o.gross_total || 0), Number(o.amount_paid || 0),
          Number(o.balance_due || 0), o.payment_status || '', o.booking_status || '',
          o.due_date || '', o.days_overdue || 0, o.aging_bucket || '',
          o.last_payment_date || '', o.last_payment_method || ''
        ])
        const aoa = [...db.buildExportMetaRows(sharedMeta), obHeaders, ...obRows.map(db.sanitizeRow)]
        if (obRows.length === 0) aoa.push(['No records for this period'])
        addSheetWithFormatting('Outstanding Balances', aoa)
      }

      // 5. Cancelled Bookings (always create)
      {
        const cbHeaders = ['Booking Number', 'Invoice Number', 'Guest', 'Room', 'Original Check-In', 'Original Check-Out', 'Nights', `Original Total (${sym})`, `Amount Paid Before (${sym})`, 'Cancelled At', 'Cancellation Reason', 'Cancelled By', `Refund Amount (${sym})`, `Retained Amount (${sym})`, 'Final State', 'Booking Source', 'Notes']
        const cbRows = data.cancelled.map((c) => [
          c.booking_number || '', c.invoice_number || '', c.guest_name || '', c.room_number || '',
          c.original_check_in || '', c.original_check_out || '', c.nights || 0,
          Number(c.original_total || 0), Number(c.amount_paid_before || 0),
          c.cancelled_at || '', c.cancellation_reason || '', c.cancelled_by || '',
          Number(c.refund_amount || 0), Number(c.retained_amount || 0),
          c.final_state || '', c.booking_source || '', c.notes || ''
        ])
        const aoa = [...db.buildExportMetaRows(sharedMeta), cbHeaders, ...cbRows.map(db.sanitizeRow)]
        if (cbRows.length === 0) aoa.push(['No records for this period'])
        addSheetWithFormatting('Cancelled Bookings', aoa)
      }

      // 6. Refunds (always create)
      {
        const rfHeaders = ['Refund ID', 'Refund Timestamp', 'Booking Number', 'Invoice Number', 'Guest', `Amount Paid Before (${sym})`, `Refund Amount (${sym})`, `Retained Amount (${sym})`, 'Retained %', 'Refund Method', 'Requested By', 'Approved By', 'Proof Reference', 'Approval Note', 'Notes', 'Related Payment ID']
        const rfRows = data.refunds.map((r) => [
          r.refund_id || '', r.refund_timestamp || '', r.booking_number || '', r.invoice_number || '',
          r.guest_name || '', Number(r.amount_paid_before || 0), Number(r.refund_amount || 0),
          Number(r.retained_amount || 0), Number(r.retained_percentage || 0),
          r.refund_method || '', r.requested_by || '', r.approved_by || '',
          r.proof_reference || '', r.approval_note || '', r.general_notes || '',
          r.related_payment_id || ''
        ])
        const aoa = [...db.buildExportMetaRows(sharedMeta), rfHeaders, ...rfRows.map(db.sanitizeRow)]
        if (rfRows.length === 0) aoa.push(['No records for this period'])
        addSheetWithFormatting('Refunds', aoa)
      }

      // 7. Quotations (always create)
      {
        const qtHeaders = ['Quotation Number', 'Guest', 'Phone', 'Email', 'Type', 'Event/Group Name', 'Daily Rate', 'Room', 'Check-In', 'Check-Out', 'Nights', 'Adults', 'Children', `Subtotal (${sym})`, `Tax (${sym})`, `Total (${sym})`, 'Currency', 'Status', 'Valid Until', 'Created At', 'Created By', 'Parent Quotation', 'Converted Booking', 'Converted Invoice', 'Notes']
        const qtRows = data.quotations.map((q) => [
          q.quotation_number || '', q.guest_name || '', q.guest_phone || '', q.guest_email || '',
          q.quotation_type === 'exclusive_event' ? 'Event' : (q.quotation_type || 'Room'), q.event_group_name || '', Number(q.event_daily_rate || 0),
          q.room_number || '',
          q.check_in || '', q.check_out || '', q.nights || 0, q.adults || 0, q.children || 0,
          Number(q.subtotal || 0), Number(q.tax || 0), Number(q.total || 0),
          q.currency || '', q.status || '', q.valid_until || '', q.created_at || '',
          q.created_by || '', q.parent_quotation_number || '',
          q.converted_booking_number || '', q.converted_invoice_number || '', q.notes || ''
        ])
        const aoa = [...db.buildExportMetaRows(sharedMeta), qtHeaders, ...qtRows.map(db.sanitizeRow)]
        if (qtRows.length === 0) aoa.push(['No records for this period'])
        addSheetWithFormatting('Quotations', aoa)
      }

      // 8. Invoice Register (always create)
      {
        const ivHeaders = ['Invoice Number', 'Booking Number', 'Guest', 'Room', 'Check-In', 'Check-Out', 'Nights', 'Issued Date', 'Due Date', `Accommodation (${sym})`, `Folio Charges (${sym})`, `Gross Total (${sym})`, `Amount Paid (${sym})`, `Balance Due (${sym})`, 'Payment Status', 'Booking Status', 'Payment Count', 'Last Payment Date', 'Delivery Status']
        const ivRows = data.invoices.map((i) => [
          i.invoice_number || '', i.booking_number || '', i.guest_name || '', i.room_number || '',
          i.check_in || '', i.check_out || '', i.nights || 0, i.issued_date || '',
          i.due_date || '', Number(i.accommodation_amount || 0), Number(i.folio_charges || 0),
          Number(i.gross_total || 0), Number(i.amount_paid || 0), Number(i.balance_due || 0),
          i.payment_status || '', i.booking_status || '', Number(i.payment_count || 0),
          i.last_payment_date || '', i.delivery_status || ''
        ])
        const aoa = [...db.buildExportMetaRows(sharedMeta), ivHeaders, ...ivRows.map(db.sanitizeRow)]
        if (ivRows.length === 0) aoa.push(['No records for this period'])
        addSheetWithFormatting('Invoice Register', aoa)
      }

      // 9. Financial Exceptions (always create)
      {
        const feHeaders = ['Exception Type', 'Severity', 'Entity Type', 'Entity ID', 'Entity Number', 'Description', 'Expected Value', 'Actual Value', 'Variance', 'Detected At']
        const feRows = data.exceptions.map((e) => [
          e.exception_type || '', e.severity || '', e.entity_type || '', e.entity_id || '',
          e.entity_number || '', e.description || '',
          e.expected_value != null ? Number(e.expected_value) : '',
          e.actual_value != null ? Number(e.actual_value) : '',
          e.variance != null ? Number(e.variance) : '',
          e.detected_at || ''
        ])
        const aoa = [...db.buildExportMetaRows(sharedMeta), feHeaders, ...feRows.map(db.sanitizeRow)]
        if (feRows.length === 0) aoa.push(['No records for this period'])
        addSheetWithFormatting('Financial Exceptions', aoa)
      }

      // 10. Reconciliation Controls (always create)
      {
        const rcHeaders = ['Control', 'Status', `Variance (${sym})`, 'Notes']
        const rcRows = [
          ['Per-booking ledger reconciliation', reconciliation.controls?.perBooking?.status || 'N/A', Number(reconciliation.controls?.perBooking?.variance || 0), 'Sum of |booking.amount_paid - signed payment ledger|'],
          ['Cash reconciliation', reconciliation.controls?.cash?.status || 'N/A', Number(reconciliation.controls?.cash?.variance || 0), 'Signed payment ledger total vs gross receipts minus refunds'],
          ['Outstanding reconciliation', reconciliation.controls?.outstanding?.status || 'N/A', Number(reconciliation.controls?.outstanding?.variance || 0), 'Base booking balance total vs Outstanding Balances report output'],
          ['Refund reconciliation', reconciliation.controls?.refund?.status || 'N/A', Number(reconciliation.controls?.refund?.variance || 0), 'Refund approval total vs absolute refund payment total'],
          ['Booking register gross', reconciliation.controls?.register?.status || 'N/A', Number(reconciliation.controls?.register?.variance || 0), 'Booking Register gross total vs server booking summary']
        ]
        const rcAoa = [
          ...db.buildExportMetaRows(sharedMeta),
          ['OVERALL STATUS', reconciliation.reconciliationStatus],
          [],
          rcHeaders,
          ...rcRows.map(db.sanitizeRow),
          [],
          ['SUMMARY METRICS'],
          ['Gross Booking Value', 'info', Number(reconciliation.grossBookingValue), ''],
          ['Gross Positive Receipts', 'info', Number(reconciliation.positiveReceipts), ''],
          ['Refunds Issued', 'info', Number(reconciliation.refundsIssued), ''],
          ['Net Cash Movement', 'info', Number(reconciliation.netCash), ''],
          ['Retained Fees', 'info', Number(reconciliation.retainedFees), ''],
          ['Outstanding Balances', 'info', Number(reconciliation.outstandingBalances), ''],
          ['Payment Ledger Total', 'info', Number(reconciliation.paymentLedgerTotal), ''],
          ['Booking Amount Paid Snapshot', 'info', Number(reconciliation.bookingAmountPaidTotal), '']
        ]
        addSheetWithFormatting('Reconciliation', rcAoa)
      }

      if (activeTab === 'expenses') {
        try {
          const [expenses, maintenanceRows] = await Promise.all([
            db.getExpenses(startDate, endDate, outletLabel || 'all'),
            db.getMaintenanceRowsForPeriod(startDate, endDate)
          ])
          const expRows = (expenses || []).map((e) => [e.date || '', e.category || '', e.description || '', Number(e.amount || 0)])
          const expAoa = [...db.buildExportMetaRows(sharedMeta), ['Date', 'Category', 'Description', `Amount (${sym})`], ...expRows.map(db.sanitizeRow)]
          if (expRows.length === 0) expAoa.push(['No expense records for this period'])
          addSheetWithFormatting('Expenses', expAoa)

          const maintRows = (maintenanceRows || []).map((m) => [m.reported_date || m.date || '', m.title || '', m.description || '', m.room_number || '', m.status || '', Number(m.total_cost || 0)])
          const maintAoa = [...db.buildExportMetaRows(sharedMeta), ['Date', 'Title', 'Description', 'Room', 'Status', `Cost (${sym})`], ...maintRows.map(db.sanitizeRow)]
          if (maintRows.length === 0) maintAoa.push(['No maintenance records for this period'])
          addSheetWithFormatting('Maintenance', maintAoa)

          const totalExpenses = (expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0)
          const totalMaintenance = (maintenanceRows || []).reduce((s, m) => s + Number(m.total_cost || 0), 0)
          const summaryAoa = [
            ...db.buildExportMetaRows(sharedMeta),
            ['EXPENSES SUMMARY'],
            ['Total Operating Expenses', money(totalExpenses)],
            ['Total Maintenance Costs', money(totalMaintenance)],
            ['Combined Total', money(totalExpenses + totalMaintenance)]
          ]
          addSheetWithFormatting('Summary', summaryAoa, { filter: false })
        } catch {}
      }

      if (activeTab === 'pos') {
        try {
          const posRevenue = await db.getPosRevenueSummary(startDate, endDate, outletLabel || 'all')
          if (posRevenue) {
            const posSummaryAoa = [
              ...db.buildExportMetaRows(sharedMeta),
              ['POS REVENUE SUMMARY'],
              ['Total Revenue', money(posRevenue.total_revenue || 0)],
              ['Gross Sales', money(posRevenue.gross_revenue || 0)],
              ['Discounts', money(posRevenue.discount_total || 0)],
              ['Returns', money(posRevenue.returns_total || 0)],
              ['Tax/VAT', money(posRevenue.tax_total || 0)],
              ['Tips', money(posRevenue.tip_total || 0)],
              ['Total Orders', String(posRevenue.total_orders || 0)],
              ['Avg Order Value', money(posRevenue.avg_order || 0)]
            ]
            addSheetWithFormatting('POS Summary', posSummaryAoa, { filter: false })

            const byPayment = posRevenue.by_payment || {}
            if (Object.keys(byPayment).length > 0) {
              const payRows = Object.entries(byPayment).sort((a, b) => b[1] - a[1]).map(([method, amt]) => [method, money(amt)])
              addSheetWithFormatting('By Payment Method', [...db.buildExportMetaRows(sharedMeta), ['Method', `Revenue (${sym})`], ...payRows.map(db.sanitizeRow)])
            }

            const byCashier = posRevenue.by_cashier || {}
            if (Object.keys(byCashier).length > 0) {
              const cashierRows = Object.entries(byCashier).sort((a, b) => b[1] - a[1]).map(([name, amt]) => [name, money(amt)])
              addSheetWithFormatting('By Operator', [...db.buildExportMetaRows(sharedMeta), ['Operator', `Revenue (${sym})`], ...cashierRows.map(db.sanitizeRow)])
            }

            const topItems = posRevenue.top_items || []
            if (topItems.length > 0) {
              const itemRows = topItems.map((item) => [item.name || '', item.qty || 0, money(item.revenue), item.cost != null ? money(item.cost) : '', item.margin != null ? money(item.margin) : ''])
              addSheetWithFormatting('Top Selling Items', [...db.buildExportMetaRows(sharedMeta), ['Item', 'Qty Sold', `Revenue (${sym})`, `Cost (${sym})`, `Margin (${sym})`], ...itemRows.map(db.sanitizeRow)])
            }

            const daily = posRevenue.daily || []
            if (daily.length > 0) {
              const dailyRows = daily.map((d) => [d.date || '', money(d.total)])
              addSheetWithFormatting('Daily Sales', [...db.buildExportMetaRows(sharedMeta), ['Date', `Total (${sym})`], ...dailyRows.map(db.sanitizeRow)])
            }
          }
        } catch {}
      }

      if (activeTab === 'costs') {
        try {
          const [invSpend, supSpend] = await Promise.all([
            db.getInventorySpend(startDate, endDate, outletLabel || 'all'),
            db.getSupplySpend(startDate, endDate)
          ])
          if (invSpend && invSpend.purchases) {
            const invRows = invSpend.purchases.map((p) => [
              p.date || p.purchased_at || '', p.inventory_items?.name || p.item_name || '',
              p.inventory_items?.category || p.category || '', p.quantity_purchased || 0,
              Number(p.unit_cost || 0), Number(p.total_cost || 0)
            ])
            addSheetWithFormatting('Inventory Purchases', [...db.buildExportMetaRows(sharedMeta), ['Date', 'Item', 'Category', 'Qty', `Unit Cost (${sym})`, `Total (${sym})`], ...invRows.map(db.sanitizeRow)])

            const byCategory = invSpend.by_category || {}
            if (Object.keys(byCategory).length > 0) {
              const catRows = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => [cat, money(amt)])
              addSheetWithFormatting('Inventory by Category', [...db.buildExportMetaRows(sharedMeta), ['Category', `Amount (${sym})`], ...catRows.map(db.sanitizeRow)])
            }
          }
          if (supSpend && supSpend.purchases) {
            const supRows = supSpend.purchases.map((p) => [
              p.date || p.purchased_at || '', p.supply_items?.name || p.item_name || '',
              p.quantity_purchased || 0, Number(p.unit_cost || 0), Number(p.total_cost || 0)
            ])
            addSheetWithFormatting('Room Supplies', [...db.buildExportMetaRows(sharedMeta), ['Date', 'Item', 'Qty', `Unit Cost (${sym})`, `Total (${sym})`], ...supRows.map(db.sanitizeRow)])
          }
          const totalInv = invSpend?.total || 0
          const totalSup = supSpend?.total || 0
          addSheetWithFormatting('Costs Summary', [...db.buildExportMetaRows(sharedMeta), ['STOCK COSTS SUMMARY'], ['Inventory Purchases', money(totalInv)], ['Room Supplies', money(totalSup)], ['Total Stock Costs', money(totalInv + totalSup)]], { filter: false })
        } catch {}
      }

      if (activeTab === 'pl') {
        try {
          const pl = await db.getProfitLoss(startDate, endDate)
          if (pl) {
            const plRows = [
              ['REVENUE', `${sym}`],
              ['Booking Revenue', Number(pl.bookingRevenue || 0).toFixed(2)],
            ]
            if (pl.regularRevenue > 0 || pl.eventRevenue > 0) {
              plRows.push(['  Regular Revenue', Number(pl.regularRevenue || 0).toFixed(2)])
              if (pl.eventRevenue > 0) plRows.push(['  Event Revenue', Number(pl.eventRevenue || 0).toFixed(2)])
            }
            plRows.push(
              ['Fees Kept From Refunds', Number(pl.retainedRevenue || 0).toFixed(2)],
              ['POS Revenue', Number(pl.posRevenue || 0).toFixed(2)]
            )
            if (pl.conferenceRevenue > 0) plRows.push(['Conference Revenue', Number(pl.conferenceRevenue).toFixed(2)])
            if (pl.poolRevenue > 0) plRows.push(['Day Use / Facility Access', Number(pl.poolRevenue).toFixed(2)])
            plRows.push(['Total Revenue', Number(pl.totalRevenue || 0).toFixed(2)])
            if (pl.vatEnabled) {
              plRows.push([`VAT (${pl.vatRate}% inclusive)`, `-${Number(pl.vatAmount || 0).toFixed(2)}`])
              plRows.push(['Net Revenue (excl. VAT)', Number(pl.netRevenue || 0).toFixed(2)])
            }
            plRows.push(
              [],
              ['KEY METRICS', ''],
              ['Bookings', String(pl.totalBookings || 0)],
              ['Avg Booking Value', Number(pl.avgBookingValue || 0).toFixed(2)],
              ['Refunds Issued', Number(pl.refundsIssued || 0).toFixed(2)],
              ['Outstanding', Number(pl.outstandingAmount || 0).toFixed(2)],
              [],
              ['EXPENSES', ''],
              ['Operating Expenses', Number(pl.totalExpenses || 0).toFixed(2)],
              ['Inventory Purchases', Number(pl.invCosts || 0).toFixed(2)],
              ['Room Supplies', Number(pl.supCosts || 0).toFixed(2)],
              ['Maintenance Repairs', Number(pl.maintenanceCosts || 0).toFixed(2)],
              ['Total Stock & Maintenance Costs', Number(pl.totalCosts || 0).toFixed(2)],
              ['Total Outgoings', Number((pl.totalExpenses || 0) + (pl.totalCosts || 0)).toFixed(2)],
              [],
              ['GROSS PROFIT', Number(pl.grossProfit || 0).toFixed(2)],
              ['Gross Margin %', `${Number(pl.grossMarginPct || 0).toFixed(1)}%`]
            )
            if (pl.expByCategory && Object.keys(pl.expByCategory).length > 0) {
              plRows.push([], ['EXPENSE BREAKDOWN'])
              for (const [cat, amt] of Object.entries(pl.expByCategory)) {
                plRows.push([cat, Number(amt).toFixed(2)])
              }
            }
            if (pl.bookingPaymentByMethod && Object.keys(pl.bookingPaymentByMethod).length > 0) {
              plRows.push([], ['REVENUE BY PAYMENT METHOD'])
              for (const [method, amt] of Object.entries(pl.bookingPaymentByMethod)) {
                plRows.push([method.charAt(0).toUpperCase() + method.slice(1), Number(amt).toFixed(2)])
              }
            }
            addSheetWithFormatting('P&L', [...db.buildExportMetaRows(sharedMeta), ...plRows.map(db.sanitizeRow)])
          }
        } catch {}
      }

      if (activeTab === 'prepayments') {
        try {
          const credits = await db.getCustomerCreditSummary(null, 500, 0)
          if (credits && credits.length > 0) {
            const creditRows = credits.map((c) => [
              c.customer_name || '', Number(c.total_receipts || 0), Number(c.total_allocations || 0),
              Number(c.total_refunds || 0), Number(c.balance || 0), c.last_activity || ''
            ])
            addSheetWithFormatting('Customer Credit', [...db.buildExportMetaRows(sharedMeta), ['Customer', `Received (${sym})`, `Allocated (${sym})`, `Refunded (${sym})`, `Balance (${sym})`, 'Last Activity'], ...creditRows.map(db.sanitizeRow)])
            const totalBalance = credits.reduce((s, c) => s + Number(c.balance || 0), 0)
            addSheetWithFormatting('Summary', [...db.buildExportMetaRows(sharedMeta), ['PREPAYMENTS SUMMARY'], ['Total Liability', money(totalBalance)], ['Customers with Credit', String(credits.length)]], { filter: false })
          } else {
            addSheetWithFormatting('Customer Credit', [...db.buildExportMetaRows(sharedMeta), ['Customer', `Received (${sym})`, `Allocated (${sym})`, `Refunded (${sym})`, `Balance (${sym})`, 'Last Activity'], ['No customer credit records for this period']], { filter: false })
          }
        } catch {}
      }

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
      fs.mkdirSync(dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, buffer)
      if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        throw new Error('File was not written successfully')
      }

      // Verify workbook by reopening
      try {
        const verifyWb = XLSX.read(buffer, { type: 'buffer' })
        const requiredSheets = ['Report Info', 'Booking Register', 'Payment Transactions', 'Outstanding Balances', 'Cancelled Bookings', 'Refunds', 'Quotations', 'Invoice Register', 'Financial Exceptions', 'Reconciliation']
        for (const name of requiredSheets) {
          if (!verifyWb.SheetNames.includes(name)) {
            throw new Error(`Workbook verification failed: missing sheet "${name}"`)
          }
        }
      } catch (verifyErr) {
        if (verifyErr.message?.includes('verification failed')) throw verifyErr
      }

      return { success: true, filePath, size: fs.statSync(filePath).size, reconciliationStatus: reconciliation.reconciliationStatus }
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EACCES') {
        return { success: false, error: `Cannot save file: ${e.code === 'EBUSY' ? 'the destination file is open or locked' : 'permission denied'}. Please close the file and try again.` }
      }
      return { success: false, error: e.message }
    }
  })

  // -- Detailed Reports PDF Export ---------------------------------------------
  ipcMain.handle('reports:exportDetailedPDF', async (event, payload = {}) => {
    await requireCapability('reports.view')
    const win = BrowserWindow.fromWebContents(event.sender)
    const {
      startDate = '',
      endDate = '',
      currency = 'P',
      lodgeName = '',
      companyName = '',
      outletLabel = '',
      reportType = 'bookings'
    } = payload || {}
    if (!startDate || !endDate) return { success: false, error: 'Date range is required.' }
    const period = `${startDate}-to-${endDate}`
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Detailed Report as PDF',
      defaultPath: buildReportExportFilename({ prefix: APP_EXPORT_PREFIX, reportTitle: `${reportType}-report`, period, extension: 'pdf' }),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    try {
      const data = await db.loadDetailedReportData(state.lodgeId, startDate, endDate, outletLabel)
      const reconciliation = db.computeReconciliation(data)
      const sym = currency || 'P'
      const resolvedLodge = lodgeName || companyName || APP_BRAND_NAME
      const generatedAt = new Date().toLocaleString()

      // For tabs that need additional data, load it from existing report functions
      let extraData = {}
      if (reportType === 'bookings') {
        try {
          const [revenueData, occupancyData, profitData] = await Promise.all([
            db.getRevenueReport(startDate, endDate).catch(() => null),
            db.getOccupancyReport(startDate, endDate).catch(() => []),
            db.getRoomProfitabilityReport(startDate, endDate).catch(() => [])
          ])
          extraData = { revenue: revenueData || null, occupancy: occupancyData || [], profitability: profitData || [] }
        } catch {}
      } else if (reportType === 'expenses') {
        try {
          const [expenses, maintenanceRows] = await Promise.all([
            db.getExpenses(startDate, endDate, outletLabel || 'all'),
            db.getMaintenanceRowsForPeriod(startDate, endDate)
          ])
          extraData = { expenses: expenses || [], maintenanceRows: maintenanceRows || [] }
        } catch {}
      } else if (reportType === 'pos') {
        try {
          const [posOrders, posRevenue] = await Promise.all([
            db.getPosOrders(startDate, endDate, outletLabel || null),
            db.getPosRevenueSummary(startDate, endDate, outletLabel || 'all')
          ])
          extraData = { posOrders: posOrders || [], posRevenue: posRevenue || null }
        } catch {}
      } else if (reportType === 'costs') {
        try {
          const [invPurchases, supPurchases] = await Promise.all([
            db.getAllInventoryPurchases().catch(() => []),
            db.getAllSupplyPurchases().catch(() => [])
          ])
          const invFiltered = (invPurchases || []).filter((p) => p.date >= startDate && p.date <= endDate)
          const supFiltered = (supPurchases || []).filter((p) => p.date >= startDate && p.date <= endDate)
          extraData = { inventoryPurchases: invFiltered, supplyPurchases: supFiltered }
        } catch {}
      } else if (reportType === 'pl') {
        try {
          const profitLoss = await db.getProfitLoss(startDate, endDate)
          extraData = { profitLoss: profitLoss || null }
        } catch {}
      } else if (reportType === 'prepayments') {
        try {
          const credits = await db.getCustomerCreditSummary(null, 500, 0)
          extraData = { credits: credits || [] }
        } catch {}
      }

      const html = buildDetailedReportPdfHtml({
        lodgeName: resolvedLodge,
        companyName,
        reportType,
        startDate,
        endDate,
        currency: sym,
        generatedAt,
        data,
        reconciliation,
        outletLabel,
        extraData
      })

      const pdfBuffer = await renderHtmlToPdfBuffer(html, {
        pageSize: 'A4',
        landscape: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: '<div style="width:100%;font-size:8px;color:#64748b;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
        margins: { marginType: 'default' }
      }, { minTextLength: 20 })

      fs.mkdirSync(dirname(result.filePath), { recursive: true })
      fs.writeFileSync(result.filePath, pdfBuffer)
      if (!fs.existsSync(result.filePath) || fs.statSync(result.filePath).size === 0) {
        throw new Error('PDF was not written successfully')
      }
      return { success: true, filePath: result.filePath, reconciliationStatus: reconciliation.reconciliationStatus }
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EACCES') {
        return { success: false, error: `Cannot save PDF: ${e.code === 'EBUSY' ? 'the destination file is open or locked' : 'permission denied'}. Please close the file and try again.` }
      }
      return { success: false, error: e.message }
    }
  })

  // -- Full Data Export -------------------------------------------------------
  ipcMain.handle('data:exportAll', async (event, options = {}) => {
    await requireCapability('data.export')
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      const today = new Date().toISOString().split('T')[0]
      const normalized = normalizeExportOptions(options)
      const presetLabel = String(normalized.preset || 'full').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      const rangeLabel = normalized.startDate === '2000-01-01' && normalized.endDate === '2099-12-31'
        ? 'all-dates'
        : `${normalized.startDate}-to-${normalized.endDate}`
      const privacyLabel = normalized.privacyMode ? '-redacted' : ''
      const { filePath, canceled } = await dialog.showSaveDialog(win, {
        title: 'Export All Lodge Data',
        defaultPath: `${APP_EXPORT_PREFIX}-${presetLabel}-export-${rangeLabel}-${today}${privacyLabel}.xlsx`,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
      })
      if (canceled || !filePath) return { canceled: true }
      const sender = event.sender
      const result = await exportAllDataWorkbookToPath(filePath, {
        ...normalized,
        onProgress: (progress) => {
          try { sender.send('data:exportProgress', progress) } catch {}
        }
      })
      if (result?.success) {
        try {
          await db.recordRestaurantSetupEvidence({
            evidence_key: 'data_export',
            details: { preset: normalized.preset, start_date: normalized.startDate, end_date: normalized.endDate }
          })
        } catch (evidenceError) {
          console.warn('[SETUP READINESS] Export succeeded but setup evidence could not be recorded:', evidenceError?.message || evidenceError)
        }
      }
      return result
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
          title: 'ðŸ•ï¸ Check-ins Today',
          body: `${checkins_today.length} guest${checkins_today.length > 1 ? 's' : ''} checking in today.`
        }).show()
      }
      if (checkouts_today.length > 0) {
        new Notification({
          title: 'ðŸ•ï¸ Check-outs Today',
          body: `${checkouts_today.length} guest${checkouts_today.length > 1 ? 's' : ''} checking out today.`
        }).show()
      }
      if (checkins_tomorrow.length > 0) {
        new Notification({
          title: 'ðŸ•ï¸ Tomorrow\'s Arrivals',
          body: `${checkins_tomorrow.length} guest${checkins_tomorrow.length > 1 ? 's' : ''} arriving tomorrow.`
        }).show()
      }
    } catch (e) {
      console.error('Notification error:', e)
    }
  }, 4000)

  // -- Activity Log ----------------------------------------------------------
  ipcMain.handle('activity:getAll', async () => {
    try { await requireCapability('settings.view'); return await db.getActivityLog() }
    catch { return [] }
  })
  ipcMain.handle('activity:clear', async () => {
    try { await requireCapability('sync.manage'); db.clearActivityLog(); return { success: true } }
    catch (e) { return { success: false, error: e.message } }
  })

  // -- Backups ---------------------------------------------------------------
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
  ipcMain.handle('backup:verify', async (_, name) => {
    try {
      await requireCapability('backup.manage')
      return db.verifyLocalBackup(name)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('backup:previewRestore', async (_, name) => {
    try {
      await requireCapability('backup.manage')
      return db.previewLocalBackupRestore(name)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('backup:createRestoreRehearsal', async (_, name) => {
    try {
      await requireCapability('backup.manage')
      return db.createRestoreRehearsalPackage(name)
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

  // -- Booking Charges (Folio) -----------------------------------------------
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

  // -- Rate Overrides (Seasonal Pricing) ------------------------------------
  ipcMain.handle('rateOverrides:getAll', async () => {
    try { await requireCapability('rooms.manage'); return await db.getRateOverrides() }
    catch { return [] }
  })
  ipcMain.handle('rateOverrides:create', async (_, data) => {
    try {
      try { requireRole('manager', 'admin', 'super_admin') } catch { throw new Error('Only managers and admins can create rate overrides. Please ask a manager or admin to do this.') }
      return await db.createRateOverride(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rateOverrides:update', async (_, id, data) => {
    try {
      try { requireRole('manager', 'admin', 'super_admin') } catch { throw new Error('Only managers and admins can edit rate overrides. Please ask a manager or admin to do this.') }
      await assertResourceBelongsToCurrentLodge('Rate override', id, db.getRateOverrideById)
      return await db.updateRateOverride(id, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rateOverrides:delete', async (_, id) => {
    try {
      try { requireRole('manager', 'admin', 'super_admin') } catch { throw new Error('Only managers and admins can delete rate overrides. Please ask a manager or admin to do this.') }
      await assertResourceBelongsToCurrentLodge('Rate override', id, db.getRateOverrideById)
      return await db.deleteRateOverride(id)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('rateOverrides:getApplicable', async (_, roomId, checkIn, checkOut) =>
    db.getApplicableRate(roomId, checkIn, checkOut)
  )

  // -- Expenses --------------------------------------------------------------
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

  // -- Maintenance -----------------------------------------------------------
  ipcMain.handle('maintenance:getAll', async () => {
    try { await requireCapability('maintenance.view'); return await db.getMaintenanceTickets() }
    catch (error) { throw new Error(error?.message || 'Failed to load maintenance tickets') }
  })
  ipcMain.handle('maintenance:create', async (_, data) => {
    try {
      await requireCapability('maintenance.manage')
      const result = await db.createMaintenanceTicket(data)
      notifyLodge(data.lodge_id, 'ðŸ”§ New maintenance request', data.issue || data.description || 'A maintenance ticket was raised', {
        tag: `maintenance-created:${result?.id || data.id || data.issue || data.description || 'unknown'}`,
        dedupeKey: `maintenance-created:${result?.id || data.id || data.issue || data.description || 'unknown'}`,
        version: result?.id || data.id || `${data.issue || ''}:${data.description || ''}`,
        url: '/#/alerts'
      })
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

  // -- ID Photo --------------------------------------------------------------
  ipcMain.handle('customers:updateIdPhoto', async (_, id, photo) => {
    try {
      requireRole()
      await assertResourceBelongsToCurrentLodge('Customer', id, db.getCustomerById)
      return await db.updateCustomerIdPhoto(id, photo)
    }
    catch (e) { return { success: false, error: e.message } }
  })

  // -- Forecast --------------------------------------------------------------
  ipcMain.handle('dashboard:forecast', async (_, days) => {
    try { await requireCapability('dashboard.view'); return await db.getForecast(days || 30) }
    catch { return null }
  })

  // -- Receipt PDF Save ------------------------------------------------------
  ipcMain.handle('receipts:savePDF', async (event, guestName) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const receiptPayload = typeof guestName === 'object' && guestName !== null ? guestName : { guestName }
    const safe = (receiptPayload?.defaultFilename || receiptPayload?.guestName || 'receipt').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const isPrepayment = receiptPayload?.documentType === 'prepayment'
    const result = await dialog.showSaveDialog(win, {
      title: isPrepayment ? 'Save Advance Payment Receipt as PDF' : 'Save Invoice as PDF',
      defaultPath: `${isPrepayment ? 'advance-payment-receipt' : 'invoice'}-${safe}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return { success: false }
    try {
      const pdfBuffer = isPrepayment && receiptPayload.receipt
        ? await renderHtmlToPdfBuffer(
          buildPrepaymentReceiptPdfHtml(receiptPayload.receipt),
          { pageSize: 'A4', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
          { minTextLength: 80 }
        )
        : await printWebContentsToPdfSafely(win.webContents, { pageSize: 'A4', printBackground: true }, { minTextLength: 20 })
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
  ipcMain.handle('receipts:listPrinters', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender)
      return await win.webContents.getPrintersAsync()
    } catch {
      return []
    }
  })
  ipcMain.handle('receipts:printCurrent', async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const hardware = normalizePosHardwareSettings(await db.getPosHardwareSettings().catch(() => ({})))
    const business = await getReceiptBusinessSettings(options?.business || {})
    if ((options?.mode === 'escpos' || hardware.receipt_print_mode === 'escpos') && options?.order) {
      const directResult = await printEscPosReceipt({
        order: options.order,
        business,
        settings: hardware,
        openDrawer: options?.openDrawer === true
      })
      await db.recordPosHardwareEvent?.('receipt_print_escpos', {
        success: directResult.success === true,
        transport: directResult.transport || null,
        target: directResult.target || null,
        error: directResult.error || null,
        order_id: options.order?.id || null,
        entity_id: options.order?.id || null
      }).catch(() => {})
      if (directResult.success || options?.fallbackToBrowser === false) return directResult
    }
    const deviceName = String(options?.deviceName || hardware.receipt_printer_name || '').trim()
    const silent = options?.silent === true && !!deviceName
    return await new Promise((resolve) => {
      printWebContentsSafely(win.webContents, {
        silent,
        deviceName: deviceName || undefined,
        printBackground: true,
        margins: { marginType: 'none' }
      }, { minTextLength: 20 }).then(resolve)
    })
  })

  // -- Quotation PDF Save ----------------------------------------------------
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
      const pdfBuffer = await printWebContentsToPdfSafely(win.webContents, { pageSize: 'A4', printBackground: true }, { minTextLength: 20 })
      fs.writeFileSync(result.filePath, pdfBuffer)
      // Auto-mark as 'sent' in backend - more reliable than relying on frontend
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

  // -- Quotation Duplicate ---------------------------------------------------
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

  // -- POS --------------------------------------------------------------------
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
  ipcMain.handle('pos:exportHistoryExcel', async (event, payload = {}) => {
    try {
      await requireCapability('pos.view')
      const parentWin = BrowserWindow.fromWebContents(event.sender)
      const start = payload.start || ''
      const end = payload.end || ''
      const period = start && end ? `${start}-to-${end}` : ''
      const { filePath, canceled } = await dialog.showSaveDialog(parentWin, {
        title: 'Export POS History to Excel',
        defaultPath: buildReportExportFilename({ prefix: APP_EXPORT_PREFIX, reportTitle: 'pos-history', period, extension: 'xlsx' }),
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
      })
      if (canceled || !filePath) return { success: false }

      const outletFilter = db.getUserPosOutletFilter()
      const [orders, voidHistory, settings] = await Promise.all([
        db.getPosOrders(start, end, outletFilter),
        db.getPosVoidHistory(start, end, outletFilter).catch(() => []),
        db.getSettings().catch(() => ({}))
      ])
      const currency = settings?.currency || 'P'
      const resolvedLodge = settings?.lodge_name || settings?.company_name || APP_BRAND_NAME
      const periodLabel = start && end ? `${start} to ${end}` : 'All dates'
      const generatedAt = new Date().toLocaleString()
      const summary = getPosHistorySummary(orders || [])

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        [`${resolvedLodge} - POS History`],
        ...buildWorkbookMetaRows({
          lodgeName: settings?.lodge_name || resolvedLodge,
          companyName: settings?.company_name || '',
          periodLabel,
          generatedAt
        }),
        ['Metric', 'Value'],
        ['Orders', summary.orderCount],
        ['Active Orders', summary.activeCount],
        ['Voided Orders', summary.voidedCount],
        [`Gross Total (${currency})`, Number(summary.grossTotal).toFixed(2)],
        [`Discounts (${currency})`, Number(summary.discountTotal).toFixed(2)],
        [`Tax/VAT (${currency})`, Number(summary.taxTotal).toFixed(2)],
        [`Tips (${currency})`, Number(summary.tipTotal).toFixed(2)],
        [`Net Total (${currency})`, Number(summary.netTotal).toFixed(2)],
        [],
        ['Payment Method', `Amount (${currency})`],
        ...Object.entries(summary.paymentTotals).map(([method, amount]) => [method, Number(amount).toFixed(2)])
      ]), 'Summary')

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((orders || []).map((order) => ({
        'Order ID': order.id || '',
        'Receipt Number': order.receipt_number || '',
        'Created At': order.created_at || '',
        'Customer': getPosOrderCustomer(order),
        'Room ID': order.room_id || '',
        'Booking ID': order.booking_id || '',
        'Outlet': getPosOrderOutletName(order),
        'Service Mode': order.service_mode || '',
        'Table': order.table_name || order.tab_name || '',
        'Cashier': order.cashier_name || '',
        'Waiter': order.waiter_name || '',
        'Payment Method': order.payment_method || '',
        'Status': order.status || '',
        'Sync State': getPosOrderSyncState(order),
        [`Gross (${currency})`]: Number(order.gross_total || order.total || 0),
        [`Discount (${currency})`]: Number(order.discount_total || 0),
        [`Tax/VAT (${currency})`]: Number(order.tax_total || 0),
        [`Tip (${currency})`]: Number(order.tip_total || 0),
        [`Total (${currency})`]: Number(order.total || 0),
        'Notes': order.notes || ''
      }))), 'Orders')

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((orders || []).flatMap((order) => (
        getPosOrderItems(order).map((item) => ({
          'Order ID': order.id || '',
          'Created At': order.created_at || '',
          'Outlet': getPosOrderOutletName(order),
          'Customer': getPosOrderCustomer(order),
          'Item': item.item_name || item.name || '',
          'Quantity': Number(item.quantity || 0),
          [`Unit Price (${currency})`]: Number(item.unit_price || item.price || 0),
          [`Subtotal (${currency})`]: Number(item.subtotal || (Number(item.quantity || 0) * Number(item.unit_price || item.price || 0))),
          'Notes': item.item_notes || ''
        }))
      ))), 'Item Lines')

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((orders || []).flatMap((order) => (
        getPosOrderPayments(order).map((payment) => ({
          'Order ID': order.id || '',
          'Created At': order.created_at || '',
          'Outlet': getPosOrderOutletName(order),
          'Customer': getPosOrderCustomer(order),
          'Method': payment.method || order.payment_method || '',
          [`Amount (${currency})`]: Number(payment.amount || 0),
          'Reference': payment.reference || payment.approval_code || ''
        }))
      ))), 'Payments')

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((voidHistory || []).map((row) => ({
        'Void ID': row.id || '',
        'Order ID': row.order_id || '',
        'Created At': row.created_at || '',
        'Outlet ID': row.outlet_id || '',
        'Requested By': row.requested_by || '',
        'Approved By': row.approver_name || row.approved_by || '',
        'Reason': row.reason || ''
      }))), 'Voids')

      XLSX.writeFile(wb, filePath)
      return { success: true, filePath, rows: (orders || []).length }
    } catch (e) {
      return { success: false, error: e?.message || 'Could not export POS history.' }
    }
  })
  ipcMain.handle('pos:exportHistoryPdf', async (event, payload = {}) => {
    try {
      await requireCapability('pos.view')
      const parentWin = BrowserWindow.fromWebContents(event.sender)
      const start = payload.start || ''
      const end = payload.end || ''
      const period = start && end ? `${start}-to-${end}` : ''
      const { filePath, canceled } = await dialog.showSaveDialog(parentWin, {
        title: 'Export POS History as PDF',
        defaultPath: buildReportExportFilename({ prefix: APP_EXPORT_PREFIX, reportTitle: 'pos-history', period, extension: 'pdf' }),
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { success: false }

      const outletFilter = db.getUserPosOutletFilter()
      const [orders, voidHistory, settings] = await Promise.all([
        db.getPosOrders(start, end, outletFilter),
        db.getPosVoidHistory(start, end, outletFilter).catch(() => []),
        db.getSettings().catch(() => ({}))
      ])
      const html = buildPosHistoryPdfHtml({
        reportTitle: 'POS History',
        lodgeName: settings?.lodge_name || '',
        companyName: settings?.company_name || '',
        periodLabel: start && end ? `${start} to ${end}` : 'All dates',
        generatedAt: new Date().toLocaleString(),
        currency: settings?.currency || 'P',
        orders: orders || [],
        voidHistory: voidHistory || []
      })
      const pdfBuffer = await renderHtmlToPdfBuffer(html, {
        pageSize: 'A4',
        printBackground: true,
        margins: { marginType: 'default' }
      }, { minTextLength: 20 })
      fs.writeFileSync(filePath, pdfBuffer)
      return { success: true, filePath, rows: (orders || []).length }
    } catch (e) {
      return { success: false, error: e?.message || 'Could not export POS history PDF.' }
    }
  })
  ipcMain.handle('pos:createOrder', async (_, data) => {
    try {
      await requireCapability('pos.manage')
      // Enforce outlet access - cashier/supervisor can only create orders for their assigned outlets
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
  ipcMain.handle('pos:approveDiscountWithPin', async (_, data) => {
    try {
      await requireCapability('pos.view')
      const outletFilter = db.getUserPosOutletFilter()
      if (outletFilter !== null && data?.outlet_id && !outletFilter.includes(data.outlet_id)) {
        return { success: false, error: 'Access denied: you do not have access to this outlet.' }
      }
      return await db.approvePosDiscountWithPin(data)
    } catch (e) {
      console.error('pos:approveDiscountWithPin failed:', e)
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('pos:createPartialReturnWithPin', async (_, data) => {
    try {
      await requireCapability('pos.view')
      const outletFilter = db.getUserPosOutletFilter()
      if (outletFilter !== null && data?.outlet_id && !outletFilter.includes(data.outlet_id)) {
        return { success: false, error: 'Access denied: you do not have access to this outlet.' }
      }
      return await db.createPosPartialReturnWithPin(data)
    } catch (e) {
      console.error('pos:createPartialReturnWithPin failed:', e)
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('pos:getCashupSummary', async (_, filters) => {
    try {
      await requireCapability('pos.view')
      const outletFilter = db.getUserPosOutletFilter()
      if (outletFilter !== null && filters?.outlet_id && !outletFilter.includes(filters.outlet_id)) {
        return { success: false, error: 'Access denied: you do not have access to this outlet.' }
      }
      return await db.getPosCashupSummary({ ...(filters || {}), outlet_filter: outletFilter })
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('pos:getCashups', async (_, limit, filters) => {
    try {
      await requireCapability('pos.view')
      return await db.getPosCashups(limit, db.getUserPosOutletFilter(), filters || {})
    } catch {
      return []
    }
  })
  ipcMain.handle('pos:createCashup', async (_, data) => {
    try {
      await requireCapability('pos.view')
      const outletFilter = db.getUserPosOutletFilter()
      if (outletFilter !== null && data?.outlet_id && !outletFilter.includes(data.outlet_id)) {
        return { success: false, error: 'Access denied: you do not have access to this outlet.' }
      }
      return await db.createPosCashupSession({ ...(data || {}), outlet_filter: outletFilter })
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('pos:getTabs', async (_, filters) => {
    try { await requireCapability('pos.view'); return await db.getPosTabs(filters) }
    catch { return [] }
  })
  ipcMain.handle('pos:saveTab', async (_, data) => {
    try {
      await requireCapability('pos.manage')
      const outletFilter = db.getUserPosOutletFilter()
      if (outletFilter !== null && data?.outlet_id && !outletFilter.includes(data.outlet_id)) {
        return { success: false, error: 'Access denied: you do not have access to this outlet.' }
      }
      return await db.savePosTab(data || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:closeTab', async (_, id) => {
    try { await requireCapability('pos.manage'); return await db.closePosTab(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:updateTabStatus', async (_, id, status) => {
    try { await requireCapability('pos.manage'); return await db.updatePosTabStatus(id, status) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:overrideTableTab', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.overridePosTableTab(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:splitBillByItems', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.splitBillByItems(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:splitBillEvenly', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.splitBillEvenly(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getTablesWithStatus', async (_, outletId) => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('tables'); return await db.getPosTablesWithStatus(outletId || null) }
    catch { return [] }
  })
  ipcMain.handle('pos:getActiveTableTab', async (_, tableName, outletId) => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('tables'); return await db.getActivePosTableTab(tableName, outletId || null) }
    catch { return null }
  })
  ipcMain.handle('pos:openTableSession', async (_, data) => {
    try {
      await requireCapability('pos.manage')
      await requireCommercialFeature('tables')
      const outletFilter = db.getUserPosOutletFilter()
      if (outletFilter !== null && data?.outlet_id && !outletFilter.includes(data.outlet_id)) {
        return { success: false, error: 'Access denied: you do not have access to this outlet.' }
      }
      return await db.openPosTableSession(data || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getTables', async () => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('tables'); return await db.getPosTables() }
    catch { return [] }
  })
  ipcMain.handle('pos:saveTable', async (_, data) => {
    try {
      await requireCapability('pos.manage')
      await requireCommercialFeature('tables')
      const outletFilter = db.getUserPosOutletFilter()
      if (outletFilter !== null && data?.outlet_id && !outletFilter.includes(data.outlet_id)) {
        return { success: false, error: 'Access denied: you do not have access to this outlet.' }
      }
      return await db.savePosTable(data || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:deleteTable', async (_, id) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('tables'); return await db.deletePosTable(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getStations', async () => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('kitchen_tickets'); return await db.getPosStations() }
    catch { return [] }
  })
  ipcMain.handle('pos:saveStation', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('kitchen_tickets'); return await db.savePosStation(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:deleteStation', async (_, id) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('kitchen_tickets'); return await db.deletePosStation(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getTickets', async (_, filters) => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('kitchen_tickets'); return await db.getPosTickets(filters || {}) }
    catch { return [] }
  })
  ipcMain.handle('pos:updateTicketStatus', async (_, id, status) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('kitchen_tickets'); return await db.updatePosTicketStatus(id, status) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getCurrentShift', async (_, outletId, cashierId) => {
    try { await requireCapability('pos.view'); return await db.getCurrentPosShift(outletId || null, cashierId || null) }
    catch { return null }
  })
  ipcMain.handle('pos:openShift', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.openPosShift(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:closeShift', async (_, data) => {
    try { await requireCapability('pos.view'); return await db.closePosShift(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getHardwareSettings', async () => {
    try { await requireCapability('pos.view'); return await db.getPosHardwareSettings() }
    catch { return {} }
  })
  ipcMain.handle('pos:saveHardwareSettings', async (_, data) => {
    try { await requireCapability('pos.view'); return await db.savePosHardwareSettings(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:testHardware', async (_, kind) => {
    try {
      await requireCapability('pos.view')
      const settings = await db.getPosHardwareSettings()
      const business = await getReceiptBusinessSettings()
      const result = await testPosHardwareDevice(kind || 'receipt', settings, business)
      await db.recordPosHardwareEvent?.('hardware_test', {
        kind: kind || 'receipt',
        success: result.success === true,
        error: result.error || null,
        message: result.message || null,
        transport: result.transport || null,
        target: result.target || null
      }).catch(() => {})
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('pos:verifyBarcodeScanner', async (_, data) => {
    try {
      await requireCapability('pos.view')
      return await db.verifyPosBarcodeScanner(data || {})
    } catch (e) {
      return { success: false, error: e.message || 'Barcode scanner verification failed.' }
    }
  })
  ipcMain.handle('pos:getStaff', async () => {
    try { await requireCapability('pos.view'); return await db.getPosStaff() }
    catch { return [] }
  })
  ipcMain.handle('pos:selectStaffWithPin', async (_, data) => {
    try { await requireCapability('pos.view'); return await db.selectPosStaffWithPin(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getModifierGroups', async () => {
    try { await requireCapability('pos.view'); return await db.getPosModifierGroups() }
    catch { return [] }
  })
  ipcMain.handle('pos:saveModifierGroup', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.savePosModifierGroup(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getPromotions', async () => {
    try { await requireCapability('pos.view'); return await db.getPosPromotions() }
    catch { return [] }
  })
  ipcMain.handle('pos:savePromotion', async (_, data) => {
    try { await requireCapability('pos.discount'); return await db.savePosPromotion(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getFloorLayout', async () => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('tables'); return await db.getPosFloorLayout() }
    catch { return { areas: [] } }
  })
  ipcMain.handle('pos:saveFloorLayout', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('tables'); return await db.savePosFloorLayout(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getRecipes', async () => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('recipes'); return await db.getPosRecipes() }
    catch { return [] }
  })
  ipcMain.handle('pos:saveRecipe', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('recipes'); return await db.savePosRecipe(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:deleteRecipe', async (_, recipeId) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('recipes'); return await db.deletePosRecipe(recipeId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getCustomers', async () => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('customer_accounts'); return await db.getPosCustomers() }
    catch { return [] }
  })
  ipcMain.handle('pos:saveCustomer', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('customer_accounts'); return await db.savePosCustomer(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:awardLoyalty', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('loyalty'); return await db.awardLoyaltyPoints(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:redeemLoyalty', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('loyalty'); return await db.redeemLoyaltyPoints(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:chargeCustomerAccount', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('customer_accounts'); return await db.chargeCustomerAccount(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:redeemVoucher', async (_, code, amount) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('vouchers'); return await db.redeemVoucher(code, amount) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:recordDelivery', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('delivery_tracking'); return await db.recordDelivery(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:clockInStaff', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.clockInStaff(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:clockOutStaff', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.clockOutStaff(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:clockInStaffWithAttendancePin', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.clockInStaffWithAttendancePin(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getSharedTillHistory', async (event, start, end, options = {}) => {
    try {
      await requireCapability('pos.view')
      const operator = getSharedTillOperatorSession(event.sender)
      if (!operator) throw new Error('Unlock Till with your Staff PIN to view your sales history.')
      const outletFilter = db.getUserPosOutletFilter()
      return await db.getSharedTillOperatorOrders(start, end, outletFilter, operator.staffId, {
        refresh: options?.refresh === true,
      })
    } catch (e) {
      throw new Error(e?.message || 'Could not load the PIN-verified Till history')
    }
  })
  ipcMain.handle('pos:getMyOrders', async (_, start, end) => {
    try {
      await requireCapability('pos.view')
      const currentUser = await db.getCurrentUser()
      if (!currentUser?.id) throw new Error('Sign in again before requesting a sale correction.')
      const outletFilter = db.getUserPosOutletFilter()
      const rows = await db.getPosOrders(start, end, outletFilter)
      return (rows || []).filter((order) => order.cashier_id === currentUser.id)
    } catch (e) {
      throw new Error(e?.message || 'Failed to load your Till sales')
    }
  })
  ipcMain.handle('pos:getStaffOpenShift', async (_, staffId) => {
    try { await requireCapability('pos.manage'); return await db.getStaffOpenPosShift(staffId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getStaffCashupSubmission', async (_, shiftId) => {
    try { await requireCapability('pos.manage'); return await db.getStaffPosCashupSubmission(shiftId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:activateSharedTillOperator', async (event, data) => {
    try {
      await requireCapability('pos.manage')
      const result = await db.activateSharedTillOperator(data || {})
      if (result?.success && result?.staff?.id) setSharedTillOperatorSession(event.sender, result.staff, data?.outlet_id || data?.outletId)
      return result
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:lockSharedTillOperator', async (event) => {
    sharedTillOperatorSessions.delete(event.sender?.id)
    return { success: true }
  })
  ipcMain.handle('pos:linkMyShiftAttendance', async (_, data) => { try { await requireCapability('pos.manage'); return await db.linkMyPosShiftToAttendance(data || {}) } catch (e) { return { success:false,error:e.message } } })
  ipcMain.handle('pos:clockInSelfForPos', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.clockInSelfForPos(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:clockOutStaffWithAttendancePin', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.clockOutStaffWithAttendancePin(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getActiveShifts', async () => {
    try { await requireCapability('pos.view'); return await db.getActiveShifts() }
    catch { return [] }
  })
  ipcMain.handle('pos:openCashDrawerSession', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.openCashDrawerSession(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:closeCashDrawerSession', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.closeCashDrawerSession(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getOpenCashDrawer', async () => {
    try { await requireCapability('pos.view'); return await db.getOpenCashDrawer() }
    catch { return null }
  })
  ipcMain.handle('pos:getSuppliers', async () => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('suppliers'); return await db.getPosSuppliers() }
    catch { return [] }
  })
  ipcMain.handle('pos:createSupplier', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('suppliers'); return await db.createPosSupplier(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:submitCashup', async (_, data) => {
    try {
      await requireCapability('pos.manage')
      return await db.submitPosCashup(data || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:submitCashupWithAttendancePin', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.submitPosCashupWithAttendancePin(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getMyCashupSubmission', async (_, shiftId) => {
    try { await requireCapability('pos.view'); return await db.getMyPosCashupSubmission(shiftId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getPendingCashupSubmissions', async () => {
    try { await requireCapability('pos.cashup'); return await db.getPendingPosCashupSubmissions() }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:reviewCashupSubmission', async (_, data) => {
    try { await requireCapability('pos.cashup'); return await db.reviewPosCashupSubmission(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:updateSupplier', async (_, supplierId, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('suppliers'); return await db.updatePosSupplier(supplierId, data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:createPurchaseOrder', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('purchasing'); return await db.createPurchaseOrder(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:updatePurchaseOrderDraft', async (_, orderId, data) => {
    try { await requireCapability('inventory.manage'); await requireCommercialFeature('purchasing'); return await db.updatePurchaseOrderDraft(orderId, data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  const getPurchaseOrderForDocument = async (orderId) => {
    const orders = await db.getPosPurchaseOrders()
    const order = (orders || []).find((row) => row.id === orderId)
    if (!order) throw new Error('Purchase order was not found for this business.')
    const settings = await db.getSettings().catch(() => ({}))
    return { order, settings: settings || {} }
  }
  ipcMain.handle('pos:savePurchaseOrderPdf', async (event, orderId) => {
    try {
      await requireCapability('inventory.view'); await requireCommercialFeature('purchasing')
      const { order, settings } = await getPurchaseOrderForDocument(orderId)
      const reference = `po-${String(order.id).slice(-6).toLowerCase()}`
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showSaveDialog(win, { title: 'Save purchase order as PDF', defaultPath: `${reference}.pdf`, filters: [{ name: 'PDF Files', extensions: ['pdf'] }] })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      const pdf = await renderHtmlToPdfBuffer(buildPurchaseOrderPdfHtml({ purchaseOrder: order, business: settings, currency: settings.currency || 'P' }), { pageSize: 'A4', printBackground: true }, { minTextLength: 40 })
      fs.writeFileSync(result.filePath, pdf)
      return { success: true, filePath: result.filePath }
    } catch (error) { return { success: false, error: error?.message || 'Could not save purchase order PDF.' } }
  })
  ipcMain.handle('pos:sendPurchaseOrderEmail', async (_, orderId) => {
    try {
      await requireCapability('inventory.manage'); await requireCommercialFeature('purchasing')
      const { order, settings } = await getPurchaseOrderForDocument(orderId)
      if (order.status !== 'approved') return { success: false, error: 'Approve this purchase order before sending it to the supplier.' }
      const recipient = String(order.supplier?.email || '').trim()
      if (!recipient) return { success: false, error: 'Add an email address to this supplier before sending the purchase order.' }
      const reference = `po-${String(order.id).slice(-6).toLowerCase()}.pdf`
      const pdf = await renderHtmlToPdfBuffer(buildPurchaseOrderPdfHtml({ purchaseOrder: order, business: settings, currency: settings.currency || 'P' }), { pageSize: 'A4', printBackground: true }, { minTextLength: 40 })
      const sent = await sendPurchaseOrderEmail({ to: recipient, purchaseOrder: order, businessName: settings.lodge_name || settings.company_name, currency: settings.currency || 'P', pdfBuffer: pdf, filename: reference })
      if (sent?.success) Promise.resolve(db.recordActivity?.('purchase_order_emailed', `Purchase order ${String(order.id).slice(-6).toUpperCase()} emailed to ${recipient}`)).catch(() => {})
      return sent
    } catch (error) { return { success: false, error: error?.message || 'Could not email purchase order.' } }
  })
  ipcMain.handle('pos:approvePurchaseOrder', async (_, orderId) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('purchasing'); return await db.approvePurchaseOrder(orderId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:receivePurchaseOrder', async (_, orderId, stockLocationId) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('purchasing'); return await db.receivePurchaseOrder(orderId, stockLocationId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:createStockTransfer', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('stock_transfers'); return await db.createStockTransfer(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:createChecklist', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('checklists'); return await db.createDailyChecklist(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:completeChecklistItem', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('checklists'); return await db.completeChecklistItem(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getActiveAlerts', async () => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('alerts'); return await db.getActiveAlerts() }
    catch { return [] }
  })
  ipcMain.handle('pos:recordAlert', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('alerts'); return await db.recordExceptionAlert(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:resolveAlert', async (_, alertId) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('alerts'); return await db.resolveExceptionAlert(alertId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getPurchaseOrders', async (_, startDate, endDate) => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('purchasing'); return await db.getPosPurchaseOrders(startDate, endDate) }
    catch { return [] }
  })
  ipcMain.handle('pos:getPurchasingSnapshot', async () => {
    try {
      await requireCapability('pos.view')
      await requireCapability('inventory.view')
      await requireCommercialFeature('suppliers')
      await requireCommercialFeature('purchasing')
      const [suppliers, orders, inventoryItems] = await Promise.all([
        db.getPosSuppliers().catch(() => []),
        db.getPosPurchaseOrders().catch(() => []),
        db.getInventoryItems().catch(() => [])
      ])
      // Electron IPC must receive a structured-clone-safe value. This explicit
      // JSON normalisation prevents a stale cache or SDK relation object from
      // breaking the entire Purchasing refresh with "could not be cloned".
      return JSON.stringify({
        suppliers: Array.isArray(suppliers) ? suppliers : [],
        orders: Array.isArray(orders) ? orders : [],
        inventoryItems: Array.isArray(inventoryItems) ? inventoryItems : []
      })
    } catch (e) {
      return JSON.stringify({ suppliers: [], orders: [], inventoryItems: [], error: e?.message || 'Purchasing data could not be loaded.' })
    }
  })
  ipcMain.handle('pos:getShiftHistory', async (_, startDate, endDate) => {
    try { await requireCapability('pos.view'); return await db.getShiftHistory(startDate, endDate) }
    catch { return [] }
  })
  ipcMain.handle('pos:getCashDrawerSessions', async (_, startDate, endDate) => {
    try { await requireCapability('pos.view'); return await db.getCashDrawerSessions(startDate, endDate) }
    catch { return [] }
  })
  ipcMain.handle('pos:getChecklists', async () => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('checklists'); return await db.getChecklists() }
    catch { return [] }
  })
  ipcMain.handle('pos:getExceptionAlerts', async () => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('alerts'); return await db.getExceptionAlerts() }
    catch { return [] }
  })
  ipcMain.handle('pos:generateOwnerDigest', async () => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('owner_digest'); return await db.generateOwnerDigest() }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getRestaurantShiftPlans', async (_, startDate, endDate) => {
    try { await requireCapability('pos.view'); return await db.getRestaurantShiftPlans(startDate, endDate) } catch { return [] }
  })
  ipcMain.handle('pos:saveRestaurantShiftPlan', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.saveRestaurantShiftPlan(data || {}) } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:deleteRestaurantShiftPlan', async (_, id) => {
    try { await requireCapability('pos.manage'); return await db.deleteRestaurantShiftPlan(id) } catch (e) { return { success: false, error: e.message } }
  })
  // ── Phase 6.1: Reservations ──────────────────────────────────────────────
  ipcMain.handle('pos:getRestaurantReservations', async (_, startDate, endDate, outletId) => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('tables'); return await db.getRestaurantReservations(startDate, endDate, outletId) }
    catch { return [] }
  })
  ipcMain.handle('pos:createRestaurantReservation', async (_, data) => {
    try { await requireCapability('pos.service'); await requireCommercialFeature('tables'); return await db.createRestaurantReservation(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:updateRestaurantReservation', async (_, id, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('tables'); return await db.updateRestaurantReservation(id, data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:cancelRestaurantReservation', async (_, id, reason) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('tables'); return await db.cancelRestaurantReservation(id, reason) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:seatRestaurantReservation', async (_, id, tableId) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('tables'); return await db.seatRestaurantReservation(id, tableId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:markRestaurantReservationNoShow', async (_, id, reason) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('tables'); return await db.markRestaurantReservationNoShow(id, reason) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getRestaurantWaitlist', async (_, outletId, includeReservationWaitlist) => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('tables'); return await db.getRestaurantWaitlist(outletId, Boolean(includeReservationWaitlist)) }
    catch { return [] }
  })
  ipcMain.handle('pos:createRestaurantWaitlistEntry', async (_, data) => {
    try { await requireCapability('pos.service'); await requireCommercialFeature('tables'); return await db.createRestaurantWaitlistEntry(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:updateRestaurantWaitlistEntry', async (_, id, data) => {
    try { await requireCapability('pos.service'); await requireCommercialFeature('tables'); return await db.updateRestaurantWaitlistEntry(id, data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:removeRestaurantWaitlistEntry', async (_, id, reason) => {
    try { await requireCapability('pos.service'); await requireCommercialFeature('tables'); return await db.removeRestaurantWaitlistEntry(id, reason) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:seatRestaurantWaitlistEntry', async (_, id, tableId) => {
    try { await requireCapability('pos.service'); await requireCommercialFeature('tables'); return await db.seatRestaurantWaitlistEntry(id, tableId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:serviceRestaurantReservationAction', async (_, id, action, tableIds) => {
    try { await requireCapability('pos.service'); await requireCommercialFeature('tables'); return await db.serviceRestaurantReservationAction(id, action, tableIds) }
    catch (e) { return { success: false, error: e.message } }
  })
  // ── Phase 6.2: Combos ────────────────────────────────────────────────────
  ipcMain.handle('pos:getRestaurantCombos', async (_, outletId) => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('recipes'); return await db.getRestaurantCombos(outletId) }
    catch { return [] }
  })
  ipcMain.handle('pos:saveRestaurantCombo', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('recipes'); return await db.saveRestaurantCombo(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:deleteRestaurantCombo', async (_, comboId) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('recipes'); return await db.deleteRestaurantCombo(comboId) }
    catch (e) { return { success: false, error: e.message } }
  })
  // ── Phase 6.3: Recipe Variance ───────────────────────────────────────────
  ipcMain.handle('pos:getRecipeVarianceReport', async (_, startDate, endDate, outletId) => {
    try { await requireCapability('reports.view'); await requireCommercialFeature('variance'); return await db.getRecipeVarianceReport(startDate, endDate, outletId) }
    catch { return [] }
  })
  ipcMain.handle('pos:getRecipePreparationLosses', async (_, startDate, endDate, outletId) => {
    try { await requireCapability('reports.view'); await requireCommercialFeature('variance'); return await db.getRecipePreparationLosses(startDate, endDate, outletId) }
    catch { return [] }
  })
  ipcMain.handle('pos:getRecipePreparationLossIngredientSummary', async (_, startDate, endDate, outletId) => {
    try { await requireCapability('reports.view'); await requireCommercialFeature('variance'); return await db.getRecipePreparationLossIngredientSummary(startDate, endDate, outletId) }
    catch { return [] }
  })
  // ── Phase 6.5: Prep Batches ──────────────────────────────────────────────
  ipcMain.handle('pos:getRestaurantPrepItems', async () => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('prep'); return await db.getRestaurantPrepItems() }
    catch { return [] }
  })
  ipcMain.handle('pos:saveRestaurantPrepItem', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('prep'); return await db.saveRestaurantPrepItem(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getRestaurantPrepBatches', async (_, startDate, endDate, outletId) => {
    try { await requireCapability('pos.view'); await requireCommercialFeature('prep'); return await db.getRestaurantPrepBatches(startDate, endDate, outletId) }
    catch { return [] }
  })
  ipcMain.handle('pos:createRestaurantPrepBatch', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('prep'); return await db.createRestaurantPrepBatch(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:postRestaurantPrepBatch', async (_, batchId) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('prep'); return await db.postRestaurantPrepBatch(batchId) }
    catch (e) { return { success: false, error: e.message } }
  })
  // ── Phase 6.6: Kitchen Timing ────────────────────────────────────────────
  ipcMain.handle('pos:recordTicketStatusEvent', async (_, data) => {
    try { await requireCapability('pos.manage'); await requireCommercialFeature('kitchen_tickets'); return await db.recordTicketStatusEvent(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getKitchenTimingReport', async (_, startDate, endDate, outletId, station) => {
    try { await requireCapability('reports.view'); await requireCommercialFeature('performance'); return await db.getKitchenTimingReport(startDate, endDate, outletId, station) }
    catch { return [] }
  })
  // ── Phase 6.7: Purchase Suggestions ──────────────────────────────────────
  ipcMain.handle('pos:getLowStockPurchaseSuggestions', async (_, outletId) => {
    try { await requireCapability('inventory.view'); await requireCommercialFeature('stock_control'); return await db.getLowStockPurchaseSuggestions(outletId) }
    catch { return [] }
  })
  ipcMain.handle('pos:setPreferredSupplierForInventoryItem', async (_, inventoryItemId, supplierId, lastUnitCost) => {
    try { await requireCapability('inventory.manage'); await requireCommercialFeature('purchasing'); return await db.setPreferredSupplierForInventoryItem(inventoryItemId, supplierId, lastUnitCost) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:convertPurchaseSuggestionsToPo', async (_, supplierId, suggestions, notes) => {
    try { await requireCapability('inventory.manage'); await requireCommercialFeature('purchasing'); return await db.convertPurchaseSuggestionsToPo(supplierId, suggestions, notes) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:recordSettlement', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.recordRestaurantSettlement(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getSettlements', async (_, businessDate) => {
    try { await requireCapability('reports.view'); return await db.getRestaurantSettlements(businessDate) }
    catch { return [] }
  })
  ipcMain.handle('pos:recordReservationDeposit', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.recordRestaurantReservationDeposit(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getSettlementExpectedTotal', async (_, startDate, endDate, channel) => {
    try { await requireCapability('reports.view'); return await db.getRestaurantSettlementExpectedTotal(startDate, endDate, channel) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getReservationDeposits', async (_, days) => {
    try { await requireCapability('pos.manage'); return await db.getRestaurantReservationDeposits(days) }
    catch { return [] }
  })
  ipcMain.handle('pos:getRestaurantOutletControls', async () => {
    try { await requireCapability('pos.manage'); return await db.getRestaurantOutletControls() }
    catch (e) { throw new Error(e?.message || 'Could not load outlet control.') }
  })
  ipcMain.handle('pos:getRestaurantStockLocations', async () => {
    try { await requireCapability('pos.manage'); return await db.getRestaurantStockLocations() }
    catch (e) { throw new Error(e?.message || 'Could not load stock locations.') }
  })
  ipcMain.handle('pos:getRestaurantStockLocationBalances', async () => {
    try { await requireCapability('inventory.view'); return await db.getRestaurantStockLocationBalances() }
    catch (e) { throw new Error(e?.message || 'Could not load stock balances.') }
  })
  ipcMain.handle('pos:createRestaurantStockLocation', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.createRestaurantStockLocation(data || {}) }
    catch (e) { return { success: false, error: e?.message || 'Could not create stock location.' } }
  })
  ipcMain.handle('pos:updateRestaurantStockLocation', async (_, locationId, data) => {
    try { await requireCapability('pos.manage'); return await db.updateRestaurantStockLocation(locationId, data || {}) }
    catch (e) { return { success: false, error: e?.message || 'Could not update stock location.' } }
  })
  ipcMain.handle('pos:deleteRestaurantStockLocation', async (_, locationId) => {
    try { await requireCapability('pos.manage'); return await db.deleteRestaurantStockLocation(locationId) }
    catch (e) { return { success: false, error: e?.message || 'Could not delete stock location.' } }
  })
  ipcMain.handle('pos:setRestaurantOutletStockLocation', async (_, outletId, stockLocationId) => {
    try { await requireCapability('pos.manage'); return await db.setRestaurantOutletStockLocation(outletId, stockLocationId) }
    catch (e) { return { success: false, error: e?.message || 'Could not update stock source.' } }
  })
  ipcMain.handle('pos:createRestaurantOutlet', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.createRestaurantOutlet(data || {}) }
    catch (e) { return { success: false, error: e?.message || 'Could not create outlet.' } }
  })
  ipcMain.handle('pos:updateRestaurantOutlet', async (_, outletId, data) => {
    try { await requireCapability('pos.manage'); return await db.updateRestaurantOutlet(outletId, data || {}) }
    catch (e) { return { success: false, error: e?.message || 'Could not update outlet.' } }
  })
  ipcMain.handle('pos:recordFeedback', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.recordRestaurantFeedback(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:submitStaffFeedback', async (_, data) => {
    try { await requireCapability('pos.view'); return await db.recordRestaurantFeedback(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getFeedback', async (_, days) => {
    try { await requireCapability('pos.manage'); return await db.getRestaurantFeedback(days) }
    catch { return [] }
  })
  ipcMain.handle('pos:getSetupProgress', async () => {
    try { await requireCapability('pos.manage'); return await db.getRestaurantSetupProgress() }
    catch (e) { throw new Error(e.message || 'Could not load setup progress') }
  })
  ipcMain.handle('pos:setSetupStage', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.setRestaurantSetupStage(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:createGiftCard', async (_, data) => { try { await requireCapability('pos.manage'); return await db.createRestaurantGiftCard(data || {}) } catch (e) { return { success: false, error: e.message } } })
  ipcMain.handle('pos:recordTipPayout', async (_, data) => { try { await requireCapability('pos.manage'); return await db.recordRestaurantTipPayout(data || {}) } catch (e) { return { success: false, error: e.message } } })
  ipcMain.handle('pos:getTipPayouts', async (_, days) => { try { await requireCapability('pos.manage'); return await db.getRestaurantTipPayouts(days) } catch (e) { return [] } })
  ipcMain.handle('pos:getTipBalances', async (_, days) => { try { await requireCapability('pos.manage'); return await db.getRestaurantTipBalances(days) } catch (e) { return [] } })
  ipcMain.handle('pos:saveReservationPolicy', async (_, data) => { try { await requireCapability('pos.manage'); return await db.saveRestaurantReservationPolicy(data || {}) } catch (e) { return { success: false, error: e.message } } })
  ipcMain.handle('pos:recordInventoryLot', async (_, data) => { try { await requireCapability('inventory.manage'); await requireCommercialFeature('stock_control'); return await db.recordRestaurantInventoryLot(data || {}) } catch (e) { return { success: false, error: e.message } } })
  ipcMain.handle('pos:updateInventoryLotExpiry', async (_, lotId, data) => { try { await requireCapability('inventory.manage'); await requireCommercialFeature('stock_control'); return await db.updateRestaurantInventoryLotExpiry(lotId, data || {}) } catch (e) { return { success: false, error: e.message } } })
  ipcMain.handle('pos:writeOffExpiredInventoryLot', async (_, lotId, data) => { try { await requireCapability('inventory.manage'); await requireCommercialFeature('stock_control'); return await db.writeOffExpiredRestaurantInventoryLot(lotId, data || {}) } catch (e) { return { success: false, error: e.message } } })
  ipcMain.handle('pos:getExpiryLots', async (_, days) => { try { await requireCapability('inventory.view'); await requireCommercialFeature('stock_control'); return await db.getRestaurantExpiryLots(days) } catch { return [] } })
  ipcMain.handle('pos:updateCustomerDisplay', async (_, data) => {
    try { await requireCapability('pos.view'); return await db.updatePosCustomerDisplay(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getCustomerDisplay', async () => {
    try { await requireCapability('pos.view'); return await db.getPosCustomerDisplay() }
    catch { return null }
  })
  ipcMain.handle('pos:openDisplay', async (_, kind, options) => {
    try {
      await requireCapability('pos.view')
      return openPosDisplayWindow(kind || 'customer', options || {})
    } catch (e) {
      return { success: false, error: e?.message || 'Could not open POS display.' }
    }
  })
  ipcMain.handle('pos:openCashDrawer', async (_, data = {}) => {
    try {
      await requireCapability('pos.view')
      const settings = await db.getPosHardwareSettings()
      const result = await openCashDrawer(settings)
      await db.recordPosHardwareEvent?.('cash_drawer_open', {
        success: result.success === true,
        error: result.error || null,
        reason: data.reason || null,
        order_id: data.order_id || null,
        amount: data.amount || null,
        transport: result.transport || null,
        target: result.target || null,
        entity_id: data.order_id || null
      }).catch(() => {})
      return result
    } catch (e) {
      return { success: false, error: e?.message || 'Could not open cash drawer.' }
    }
  })
  ipcMain.handle('pos:listDisplays', async () => {
    try {
      await requireCapability('pos.view')
      return listPosSystemDisplays()
    } catch {
      return []
    }
  })
  ipcMain.handle('pos:sendPaymentTerminalTotal', async (_, data) => {
    try {
      await requireCapability('pos.view')
      const settings = await db.getPosHardwareSettings()
      const business = await getReceiptBusinessSettings()
      const result = await sendPaymentTerminalToDevice(settings, {
        ...(data || {}),
        currency: data?.currency || business?.currency || 'BWP'
      })
      await db.recordPosHardwareEvent?.('payment_terminal_send_total', {
        success: result.success === true,
        approved: result.approved === true,
        declined: result.declined === true,
        manual: result.manual === true,
        amount: data?.amount || 0,
        reference: result.reference || data?.reference || null,
        approval_code: result.approval_code || null,
        provider: settings?.payment_terminal_provider || null,
        mode: settings?.payment_terminal_mode || 'manual',
        error: result.error || null
      }).catch(() => {})
      return result
    } catch (e) {
      return { success: false, error: e.message }
    }
  })
  ipcMain.handle('pos:getAuditLog', async (_, limit) => {
    try { await requireCapability('pos.view'); return await db.getPosAuditLog(limit || 100) }
    catch { return [] }
  })
  ipcMain.handle('pos:getActiveBookingForRoom', async (_, roomId) => {
    try { await requireCapability('pos.view'); await assertResourceBelongsToCurrentLodge('Room', roomId, db.getRoomById); return await db.getActiveBookingForRoom(roomId).catch(() => null) }
    catch { return null }
  })
  ipcMain.handle('pos:getActiveEvents', async () => {
    try {
      await requireCapability('pos.view');
      const lodgeId = getCurrentLodgeId();
      const { data, error } = await state.supabase
        .from('conference_bookings')
        .select('id, event_name, event_type, booking_date, start_time, end_time, status, amount_paid, total_amount, balance_due, currency')
        .eq('lodge_id', lodgeId)
        .in('status', ['reserved', 'confirmed', 'active'])
        .order('booking_date', { ascending: true })
        .limit(100);
      if (error) throw new Error(error.message);
      return data || [];
    }
    catch { return [] }
  })

  // -- Outlets ----------------------------------------------------------------
  ipcMain.handle('outlets:getAll', async () => {
    try { return await db.getOutlets() }
    catch { return [] }
  })

  // -- Inventory --------------------------------------------------------------
  ipcMain.handle('inventory:getItems', async () => {
    try { await requireCapability('inventory.view'); return await db.getInventoryItems() }
    catch (e) {
      console.error('inventory:getItems failed:', e)
      throw new Error(e?.message || 'Could not load inventory items right now.')
    }
  })
  ipcMain.handle('inventory:getBarStockAging', async (_, outletId) => {
    try {
      await requireCapability('inventory.view')
      return await db.getBarStockAging(outletId || null)
    } catch (e) {
      console.error('inventory:getBarStockAging failed:', e)
      throw new Error(e?.message || 'Could not load stock aging right now.')
    }
  })
  ipcMain.handle('users:sendInvite', async (_, id) => {
    try {
      await requireCapability('staff.manage')
      const targetUser = await assertResourceBelongsToCurrentLodge('User', id, db.getUserById)
      assertManagerStaffScope(db.getCurrentUser?.(), targetUser)
      return await db.sendUserInviteOrReset(id)
    } catch (e) { return { success: false, error: e.message } }
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
  ipcMain.handle('inventory:discardDraft', async (_, id) => {
    try {
      await requireCapability('inventory.manage')
      return await db.discardDraft(id)
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
  ipcMain.handle('inventory:adjustStock', async (_, itemId, delta, notes, managerPin, adjustmentId) => {
    try {
      await requireCapability('inventory.manage')
      await assertResourceBelongsToCurrentLodge('Inventory item', itemId, db.getInventoryItemById)
      return await db.adjustInventoryStock(itemId, delta, notes, adjustmentId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('inventory:getMovements', async (_, filters) => {
    try {
      await requireCapability('inventory.view')
      if (filters?.item_id) await assertResourceBelongsToCurrentLodge('Inventory item', filters.item_id, db.getInventoryItemById)
      return await db.getInventoryMovements(filters || {})
    } catch (e) {
      console.error('inventory:getMovements failed:', e)
      return []
    }
  })
  ipcMain.handle('inventory:getStocktakes', async (_, limit) => {
    try { await requireCapability('inventory.view'); return await db.getInventoryStocktakes(limit) }
    catch (e) {
      console.error('inventory:getStocktakes failed:', e)
      return []
    }
  })
  ipcMain.handle('inventory:getRestaurantStockSnapshot', async (_, movementDate) => {
    try {
      await requireCapability('inventory.view')
      const [items, lowStock, movements, stocktakes] = await Promise.all([
        db.getInventoryItems().catch(() => []),
        db.getLowStockItems().catch(() => []),
        db.getInventoryMovements({ limit: 200, start_date: movementDate, end_date: movementDate }).catch(() => []),
        db.getInventoryStocktakes(12).catch(() => [])
      ])
      // A single JSON string keeps the live stock dashboard resilient when a
      // cached row or database client value is not structured-cloneable.
      return JSON.stringify({
        items: Array.isArray(items) ? items : [],
        lowStock: Array.isArray(lowStock) ? lowStock : [],
        movements: Array.isArray(movements) ? movements : [],
        stocktakes: Array.isArray(stocktakes) ? stocktakes : []
      })
    } catch (e) {
      return JSON.stringify({ items: [], lowStock: [], movements: [], stocktakes: [], error: e?.message || 'Could not load restaurant inventory.' })
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

  // -- Room Supplies ----------------------------------------------------------
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
  ipcMain.handle('supplies:adjustStock', async (_, itemId, delta, notes, managerPin) => {
    try {
      await requireCapability('supplies.manage')
      await assertResourceBelongsToCurrentLodge('Supply item', itemId, db.getSupplyItemById)
      return await db.adjustSupplyStock(itemId, delta, notes, managerPin)
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
      const reportTitle = payload.reportTitle || 'Room Supplies Cost Report'
      const period = payload.start && payload.end ? `${payload.start}-to-${payload.end}` : ''
      const { filePath, canceled } = await dialog.showSaveDialog(win, {
        title: `Export ${reportTitle} to Excel`,
        defaultPath: buildReportExportFilename({ prefix: APP_EXPORT_PREFIX, reportTitle, period, extension: 'xlsx' }),
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
      })
      if (canceled || !filePath) return { success: false }

      const currency = payload.currency || 'P'
      const allocations = Array.isArray(payload.allocations) ? payload.allocations : []
      const byRoom = Array.isArray(payload.byRoom) ? payload.byRoom : []
      const byItem = Array.isArray(payload.byItem) ? payload.byItem : []
      const grandTotal = Number(payload.grandTotal || 0)
      const resolvedLodge = payload.lodgeName || payload.companyName || APP_BRAND_NAME
      const resolvedCompany = payload.companyName && payload.companyName !== resolvedLodge ? payload.companyName : ''
      const generatedAt = payload.generatedAt || new Date().toLocaleString()

      const wb = XLSX.utils.book_new()

      const summaryRows = [
        [`${resolvedLodge} - ${reportTitle}`],
        ...buildWorkbookMetaRows({
          lodgeName: resolvedLodge,
          companyName: resolvedCompany,
          periodLabel: `${payload.start || ''} to ${payload.end || ''}`,
          generatedAt
        }),
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
  ipcMain.handle('supplies:exportReportPdf', async (event, payload = {}) => {
    try {
      await requireCapability('supplies.view')
      const parentWin = BrowserWindow.fromWebContents(event.sender)
      const reportTitle = payload.reportTitle || 'Room Supplies Cost Report'
      const period = payload.start && payload.end ? `${payload.start}-to-${payload.end}` : ''
      const { filePath, canceled } = await dialog.showSaveDialog(parentWin, {
        title: `Export ${reportTitle} as PDF`,
        defaultPath: buildReportExportFilename({ prefix: APP_EXPORT_PREFIX, reportTitle, period, extension: 'pdf' }),
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { success: false }

      const html = buildRoomSuppliesPdfHtml({
        reportTitle,
        lodgeName: payload.lodgeName || '',
        companyName: payload.companyName || '',
        periodLabel: `${payload.start || ''} to ${payload.end || ''}`,
        generatedAt: payload.generatedAt || new Date().toLocaleString(),
        currency: payload.currency || 'P',
        grandTotal: Number(payload.grandTotal || 0),
        allocations: Array.isArray(payload.allocations) ? payload.allocations : [],
        byRoom: Array.isArray(payload.byRoom) ? payload.byRoom : [],
        byItem: Array.isArray(payload.byItem) ? payload.byItem : []
      })
      const pdfBuffer = await renderHtmlToPdfBuffer(html, {
        pageSize: 'A4',
        printBackground: true,
        margins: { marginType: 'default' }
      }, { minTextLength: 20 })
      fs.writeFileSync(filePath, pdfBuffer)
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

  // -- Conference Bookings ----------------------------------------------------
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
  ipcMain.handle('conference:updatePayment', async (_, id, amount, method, intentKey) => {
    await requireCapability('payments.record')
    await assertResourceBelongsToCurrentLodge('Conference booking', id, db.getConferenceBookingById)
    return await db.updateConferenceBookingPayment(id, amount, method, 'payment', null, intentKey)
  })

  // -- Events & Venues -----------------------------------------------------
  ipcMain.handle('events:getAll', async (_, start, end) => {
    try { await requireCapability('conference.view'); return await db.getEventBookings(start, end).catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('events:getById', async (_, id) => {
    await requireCapability('conference.view')
    return await db.getEventBookingById(id)
  })
  ipcMain.handle('events:getDetails', async (_, id) => {
    await requireCapability('conference.view')
    return await db.getEventBookingDetails(id)
  })
  ipcMain.handle('events:create', async (_, data) => {
    await requireCapability('conference.manage')
    return await db.createEventVenueBooking(data)
  })
  ipcMain.handle('events:update', async (_, id, data) => {
    await requireCapability('conference.manage')
    await assertResourceBelongsToCurrentLodge('Event booking', id, db.getEventBookingById)
    return await db.updateEventBooking(id, data)
  })
  ipcMain.handle('events:cancel', async (_, id, reason, cancelLinkedRooms) => {
    await requireCapability('conference.manage')
    await assertResourceBelongsToCurrentLodge('Event booking', id, db.getEventBookingById)
    return await db.cancelEventBooking(id, reason, cancelLinkedRooms)
  })
  ipcMain.handle('events:addLineItem', async (_, data) => {
    await requireCapability('conference.manage')
    return await db.addEventLineItem(data)
  })
  ipcMain.handle('events:voidLineItem', async (_, lineItemId, reason) => {
    await requireCapability('payments.record')
    return await db.voidEventLineItem(lineItemId, reason)
  })
  ipcMain.handle('events:updatePayment', async (_, id, amount, method, type, intentKey) => {
    await requireCapability('payments.record')
    await assertResourceBelongsToCurrentLodge('Event booking', id, db.getEventBookingById)
    return await db.updateEventPayment(id, amount, method, type, intentKey)
  })
  ipcMain.handle('events:checkAvailability', async (_, resourceKey, startAt, endAt, excludeEventId) => {
    await requireCapability('conference.view')
    return await db.checkEventResourceAvailability(resourceKey, startAt, endAt, excludeEventId)
  })
  ipcMain.handle('events:getVenuePackages', async (_, category, activeOnly) => {
    try { return await db.getVenuePackages(category, activeOnly) }
    catch { return [] }
  })
  ipcMain.handle('events:createVenuePackage', async (_, data) => {
    try {
      await requireCapability('conference.manage')
      return await db.createVenuePackage(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('events:updateVenuePackage', async (_, id, data) => {
    try {
      await requireCapability('conference.manage')
      return await db.updateVenuePackage(id, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('events:deleteVenuePackage', async (_, id) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('conference.manage')
      return await db.deleteVenuePackage(id)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('events:applyPackage', async (_, packageId, eventBookingId, quantity, intentKey) => {
    try {
      await requireCapability('conference.manage')
      return await db.applyVenuePackageToEvent(packageId, eventBookingId, quantity, intentKey)
    } catch (e) { return { success: false, error: e.message } }
  })

  // -- Venue Management (Phase 6 depth) ------------------------------------
  ipcMain.handle('venueManagement:getEventLeads', async (_, status) => {
    try { await requireCapability('venue_management.view'); return await db.getEventLeads(status) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:createEventLead', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.createEventLead(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:updateEventLead', async (_, id, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.updateEventLead(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:convertLeadToBooking', async (_, leadId) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.convertLeadToBooking(leadId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:getVenueAvailabilityRules', async (_, resourceKey) => {
    try { await requireCapability('venue_management.view'); return await db.getVenueAvailabilityRules(resourceKey) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:upsertVenueAvailabilityRule', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.upsertVenueAvailabilityRule(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:getVenueAvailabilityCalendar', async (_, resourceKey, startDate, endDate) => {
    try { await requireCapability('venue_management.view'); return await db.getVenueAvailabilityCalendar(resourceKey, startDate, endDate) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:getRunSheet', async (_, eventBookingId) => {
    try { await requireCapability('venue_management.view'); return await db.getRunSheet(eventBookingId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:createRunSheet', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.createRunSheet(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:updateRunSheet', async (_, id, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.updateRunSheet(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:finalizeRunSheet', async (_, id) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.finalizeRunSheet(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:executeRunSheet', async (_, id) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.executeRunSheet(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:getEventSuppliers', async (_, eventBookingId) => {
    try { await requireCapability('venue_management.view'); return await db.getEventSuppliers(eventBookingId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:createSupplierEntry', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.createSupplierEntry(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:updateSupplierEntry', async (_, id, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.updateSupplierEntry(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:updateSupplierStatus', async (_, id, status, actualAmount) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.updateSupplierStatus(id, status, actualAmount) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:getDepositMilestones', async (_, eventBookingId) => {
    try { await requireCapability('venue_management.view'); return await db.getDepositMilestones(eventBookingId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:createDepositMilestone', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.createDepositMilestone(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:markMilestonePaid', async (_, id, paidDate, method, reference) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.markMilestonePaid(id, paidDate, method, reference) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:waiveMilestone', async (_, id, reason) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.waiveMilestone(id, reason) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:settleEvent', async (_, eventBookingId, idempotencyKey, adjustmentAmount, adjustmentType, adjustmentReason, notes) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('venue_management.manage'); return await db.settleEvent(eventBookingId, idempotencyKey, adjustmentAmount, adjustmentType, adjustmentReason, notes) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:getEventProfitability', async (_, eventBookingId) => {
    try { await requireCapability('venue_management.view'); return await db.getEventProfitability(eventBookingId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('venueManagement:getVenueProfitabilityReport', async (_, startDate, endDate) => {
    try { await requireCapability('venue_management.view'); return await db.getVenueProfitabilityReport(startDate, endDate) }
    catch (e) { return { success: false, error: e.message } }
  })

  // -- Day Use Entries -------------------------------------------------------
  ipcMain.handle('dayuse:getAll', async (_, start, end) => {
    try { await requireCapability('pool.view'); return await db.getDayUseEntries(start, end).catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('dayuse:add', async (_, data) => {
    await requireCapability('pool.manage')
    return await db.addDayUseEntry(data)
  })
  ipcMain.handle('dayuse:delete', async (_, id) => {
    await requireCapability('pool.manage')
    await assertResourceBelongsToCurrentLodge('Day use entry', id, db.getDayUseEntryById)
    return await db.deleteDayUseEntry(id)
  })
  ipcMain.handle('dayuse:updateStatus', async (_, id, status) => {
    await requireCapability('pool.manage')
    await assertResourceBelongsToCurrentLodge('Day use entry', id, db.getDayUseEntryById)
    return await db.updateDayUseEntryStatus(id, status)
  })
  ipcMain.handle('dayuse:settleBalance', async (_, id, method, markCompleted = true) => {
    await requireCapability('payments.record')
    await assertResourceBelongsToCurrentLodge('Day use entry', id, db.getDayUseEntryById)
    return await db.settleDayUseEntryBalance(id, method, markCompleted)
  })
  ipcMain.handle('dayuse:summary', async (_, date) => {
    try { await requireCapability('pool.view'); return await db.getDayUseEntrySummary(date).catch(() => ({ total: 0, adults: 0, children: 0, entries: [] })) }
    catch { return { total: 0, adults: 0, children: 0, entries: [] } }
  })
  ipcMain.handle('dayuse:getInventoryItems', async () => {
    try { await requireCapability('pool.manage'); return await db.getDayUseInventoryItems().catch(() => []) }
    catch { return [] }
  })
  ipcMain.handle('dayuse:getConfig', async () => {
    try { await requireCapability('pool.view'); return await db.getDayUseConfig() }
    catch { return db.getDayUseConfig().catch(() => ({ templates: [], resources: [] })) }
  })
  ipcMain.handle('dayuse:saveConfig', async (_, data) => {
    await requireCapability('pool.manage')
    return await db.saveDayUseConfig(data)
  })

  // -- Analytics & Cost Reports -----------------------------------------------
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

  ipcMain.handle('reports:saveNightAuditExcel', async (event, payload = {}) => {
    await requireCapability('audit.view')
    const win = BrowserWindow.fromWebContents(event.sender)
    const {
      data = {},
      date = '',
      currency,
      lodgeName = '',
      companyName = '',
      generatedAt = new Date().toLocaleString(),
      reportTitle = 'Night Audit'
    } = payload || {}
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: `Export ${reportTitle} to Excel`,
      defaultPath: buildReportExportFilename({ prefix: APP_EXPORT_PREFIX, reportTitle, period: date, extension: 'xlsx' }),
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false }
    try {
      const wb = XLSX.utils.book_new()
      const sym = currency || 'P'
      const safeData = data || {}
      const resolvedLodge = lodgeName || companyName || APP_BRAND_NAME
      const sharedMeta = {
        lodgeName: resolvedLodge,
        companyName,
        periodLabel: date ? `Date: ${date}` : '',
        generatedAt
      }

      // 1. Summary
      const summaryRows = [
        [`${resolvedLodge} - Night Audit Summary`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['Category', 'Count', `Revenue (${sym})`],
        ['Check-ins Today', (safeData.check_ins || []).length, '-'],
        ['Check-outs Today', (safeData.check_outs || []).length, '-'],
        ['New Bookings Created', (safeData.new_bookings || []).length, '-'],
        ['POS Orders Completed', (safeData.pos_orders || []).length, Number(safeData.pos_revenue || 0).toFixed(2)],
        ['Outstanding Balances', (safeData.outstanding || []).length, Number(safeData.outstanding_total || 0).toFixed(2)]
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')

      // 2. Check-ins
      const checkinRows = [
        [`${resolvedLodge} - Check-ins`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['#', 'Guest', 'Room', 'Type', 'Adults', 'Children', `Total (${sym})`, `Paid (${sym})`, 'Status']
      ]
      ;(safeData.check_ins || []).forEach((b) => {
        const roomDisp = b._event_group ? `${b.room_count} rooms` : (b.room_number ? `Room ${b.room_number}` : '-')
        checkinRows.push([
          b.booking_number || '-', b.customer_name, roomDisp, b.room_type || '-',
          b.adults, b.children, Number(b.total_amount || 0).toFixed(2), Number(b.amount_paid || 0).toFixed(2), b.payment_status
        ])
      })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(checkinRows), 'Check-ins')

      // 3. Check-outs
      const checkoutRows = [
        [`${resolvedLodge} - Check-outs`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['#', 'Guest', 'Room', 'Type', 'Adults', 'Children', `Total (${sym})`, `Paid (${sym})`, 'Status']
      ]
      ;(safeData.check_outs || []).forEach((b) => {
        const roomDisp = b._event_group ? `${b.room_count} rooms` : (b.room_number ? `Room ${b.room_number}` : '-')
        checkoutRows.push([
          b.booking_number || '-', b.customer_name, roomDisp, b.room_type || '-',
          b.adults, b.children, Number(b.total_amount || 0).toFixed(2), Number(b.amount_paid || 0).toFixed(2), b.payment_status
        ])
      })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(checkoutRows), 'Check-outs')

      // 4. New Bookings
      const newBookRows = [
        [`${resolvedLodge} - New Bookings`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['#', 'Guest', 'Room', 'Check-in', 'Check-out', `Total (${sym})`, 'Status']
      ]
      ;(safeData.new_bookings || []).forEach((b) => {
        const roomDisp = b._event_group ? `${b.room_count} rooms` : (b.room_number ? `Room ${b.room_number}` : '-')
        newBookRows.push([
          b.booking_number || '-', b.customer_name, roomDisp, b.check_in, b.check_out,
          Number(b.total_amount || 0).toFixed(2), b.status
        ])
      })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(newBookRows), 'New Bookings')

      // 5. POS
      const posRows = [
        [`${resolvedLodge} - POS Orders`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['Time', 'Guest/Room', 'Payment', `Total (${sym})`, 'Items']
      ]
      ;(safeData.pos_orders || []).forEach((o) => {
        const time = new Date(o.created_at).toLocaleTimeString()
        const items = (o.pos_order_items || []).map((i) => `${i.quantity}x ${i.item_name}`).join(', ')
        posRows.push([time, o.walk_in_name || (o.room_number ? `Room ${o.room_number}` : 'Walk-in'), o.payment_method, Number(o.total || 0).toFixed(2), items])
      })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(posRows), 'POS Orders')

      // 6. Outstanding
      const outstandingRows = [
        [`${resolvedLodge} - Outstanding Balances`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['#', 'Guest', 'Room', 'Check-in', 'Check-out', `Total (${sym})`, `Paid (${sym})`, `Balance (${sym})`]
      ]
      ;(safeData.outstanding || []).forEach((b) => {
        const balance = Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0))
        const roomDisp = b._event_group ? `${b.room_count} rooms` : (b.room_number ? `Room ${b.room_number}` : '-')
        outstandingRows.push([
          b.booking_number || '-', b.customer_name, roomDisp, b.check_in, b.check_out,
          Number(b.total_amount || 0).toFixed(2), Number(b.amount_paid || 0).toFixed(2), balance.toFixed(2)
        ])
      })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(outstandingRows), 'Outstanding')

      XLSX.writeFile(wb, filePath)
      return { success: true, filePath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // -- Settings --------------------------------------------------------------
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
  ipcMain.handle('settings:updateOperatingProfile', async (_, profile) => {
    try { return { success: true, data: await db.updateOperatingProfile(profile) } }
    catch (e) { return { success: false, error: e.message } }
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
  ipcMain.handle('settings:getSystemHealth', async (_, options = {}) => {
    try {
      await requireCapability('system.health')
      return await db.getSystemHealth(options)
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
      requireMasterAdmin()
      await requireCapability('command_central.destructive.manage')
      return { success: true, lodge_id: db.resetToNewLodge() }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('setup:initializeCompany', async (_, payload) => {
    try { return { success: true, data: await db.initializeCompanySetup(payload) } }
    catch (e) { return { success: false, code: e.code || 'setup_failed', error: e.message || 'Setup failed.' } }
  })
  ipcMain.handle('sync:getStatus', async () => {
    try { return await Promise.resolve(db.getSyncStatus()) }
    catch { return { pending: 0, failed: 0, isOnline: false } }
  })
  ipcMain.handle('sync:getDetails', async () => {
    try { await requireCapability('system.health'); return await db.getSyncDetails() }
    catch { return { pending: [], failed: [] } }
  })
  ipcMain.handle('sync:getOfflineMode', async () => {
    try { await requireCapability('system.health'); return db.getOfflineModeState() }
    catch (e) { return { enabled: false, error: e.message } }
  })
  ipcMain.handle('sync:setOfflineMode', async (_, payload) => {
    try {
      await requireCapability('sync.manage')
      return db.setOfflineModeState(payload || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('sync:exportOfflineOperations', async () => {
    try {
      await requireCapability('sync.manage')
      const today = new Date().toISOString().slice(0, 10)
      const defaultPath = join(app.getPath('documents'), `${APP_EXPORT_PREFIX}-offline-operations-${today}.json`)
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Save Offline Operations Bundle',
        defaultPath,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (canceled || !filePath) return { success: false, canceled: true }
      return db.exportOfflineOperationsBundle(filePath, {
        appVersion: app.getVersion(),
        exportedBy: state.currentUser?.id || null
      })
    } catch (e) { return { success: false, error: e.message } }
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
  ipcMain.handle('sync:runNow', async () => {
    try {
      await requireCapability('sync.manage')
      return await db.runSyncNow()
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('sync:clearHealthFault', async (_, id) => {
    try {
      await requireCapability('sync.manage')
      return db.clearHealthFault(id)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('sync:getDeviceHealthRollup', async () => {
    try {
      await requireCapability('system.health')
      return await db.getDeviceHealthRollup()
    } catch { return { available: false, devices: [] } }
  })
  ipcMain.handle('admin:getFleetHealthRollup', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getFleetHealthRollup() }
    catch (error) { throw new Error(error?.message || 'Unable to load fleet health rollup') }
  })
  ipcMain.handle('admin:getFleetHealthSummary', async () => {
    try { requireMasterAdmin(); await requireCapability('command_central.view'); return await db.getFleetHealthSummary() }
    catch (error) { throw new Error(error?.message || 'Unable to load fleet health summary') }
  })
  ipcMain.handle('trial:getStatus', async (_, lodgeId) => {
    try { return await db.getTrialStatus(lodgeId) }
    catch { return null }
  })
  ipcMain.handle('usage:getSnapshot', async (_, options) => {
    try {
      return await db.getUsageLimitSnapshot(options || {})
    } catch (error) {
      return { error: error.message || 'Could not load usage snapshot.' }
    }
  })
  ipcMain.handle('trial:activateKey', async (_, lodgeId, key) => {
    try {
      await requireCapability('settings.manage_subscription')
      return await db.activateLicenseKey(lodgeId, key)
    }
    catch (e) { return { success: false, error: e.message } }
  })

  // -- Data Import (Excel) ---------------------------------------------------
  ipcMain.handle('import:parseExcel', async (event, providedFilePath = '') => {
    await requireCapability('data.import')
    try {
      let filePath = String(providedFilePath || '').trim()
      if (!filePath) {
        const win = BrowserWindow.fromWebContents(event.sender)
        const result = await dialog.showOpenDialog(win, {
          title: 'Select Excel File to Import',
          filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
          properties: ['openFile']
        })
        if (result.canceled || !result.filePaths[0]) return null
        filePath = result.filePaths[0]
      }
      const ext = String(filePath.split('.').pop() || '').toLowerCase()
      if (ext !== 'xlsx') return { error: 'Choose an Excel file ending in .xlsx.' }

      const stats = fs.statSync(filePath)
      if (stats.size <= 0) return { error: 'The selected Excel file is empty.' }
      if (stats.size > 10 * 1024 * 1024) return { error: 'The selected Excel file is too large. Keep imports under 10 MB.' }

      const workbook = XLSX.read(fs.readFileSync(filePath), {
        type: 'buffer',
        cellDates: false,
        bookVBA: false,
        sheetRows: 501
      })
      const sheetName = workbook.SheetNames.find((name) => {
        const ref = workbook.Sheets[name]?.['!ref']
        return ref && XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: '', blankrows: false }).length > 0
      }) || workbook.SheetNames[0]
      if (!sheetName) return { error: 'No worksheets were found in this Excel file.' }

      const sheet = workbook.Sheets[sheetName]
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', blankrows: false })
      if (rawRows.length === 0) return { error: 'The selected worksheet has headers only or no data rows.' }
      const { rows, columns } = normalizeParsedImportRows(rawRows)
      if (columns.length === 0) return { error: 'No column headers were found. Put field names in the first row.' }
      return {
        fileName: filePath.split(/[\\/]/).pop(),
        sheetName,
        columns,
        rows: rows.slice(0, 500),
        totalRows: rows.length,
        truncated: rows.length > 500
      }
    } catch (e) {
      return { error: e?.message ? `Could not read this Excel file: ${e.message}` : 'Could not read this Excel file.' }
    }
  })

  ipcMain.handle('import:execute', async (event, mappedRows, filename, type = 'bookings') => {
    try {
      await requireCapability('data.import')
      const sender = event.sender
      return await db.bulkImportTyped(type, mappedRows, {
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

  ipcMain.handle('import:dryRun', async (_, mappedRows, type = 'bookings') => {
    try {
      await requireCapability('data.import')
      return db.dryRunImport(type, mappedRows || [])
    } catch (e) { return { error: e.message } }
  })

  ipcMain.handle('import:exportErrors', async (event, payload = {}) => {
    await requireCapability('data.import')
    const win = BrowserWindow.fromWebContents(event.sender)
    const rows = Array.isArray(payload.rows) ? payload.rows : []
    const errors = Array.isArray(payload.errors) ? payload.errors : []
    if (!errors.length) return { error: 'Run a dry check first. No row issues were found to export.' }

    const errorRows = errors.map((entry) => {
      const rowNumber = Number(entry.row || 0)
      const source = rows[rowNumber - 1] || {}
      const messages = Array.isArray(entry.errors) ? entry.errors : [entry.error].filter(Boolean)
      return {
        Row: rowNumber || '',
        Issue: messages.join(' '),
        Suggestion: entry.suggestions?.room_number?.length ? `Try room ${entry.suggestions.room_number.join(', ')}` : '',
        ...source
      }
    })
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(errorRows)
    ws['!cols'] = Object.keys(errorRows[0] || { Row: '', Issue: '' }).map((key) => ({ wch: Math.max(12, Math.min(42, key.length + 8)) }))
    XLSX.utils.book_append_sheet(wb, ws, 'Rows To Fix')
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Import Issues Workbook',
      defaultPath: `${APP_EXPORT_PREFIX}-import-issues-${new Date().toISOString().slice(0, 10)}.xlsx`,
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

  ipcMain.handle('import:getTypes', async () => {
    try {
      await requireCapability('data.import')
      return db.getSupportedImportTypes()
    } catch { return [{ key: 'bookings', label: 'Bookings', executable: true }] }
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

  ipcMain.handle('import:downloadTemplate', async (event, type = 'bookings') => {
    await requireCapability('data.import')
    const win = BrowserWindow.fromWebContents(event.sender)
    const fields = db.generateImportTemplate(type)
    const samples = {
      bookings: {
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
      },
      guests: { 'Guest Name': 'John Smith', 'Email': 'john@example.com', 'Phone': '+675 7000 0000', 'ID / Passport No': 'A12345678', 'Nationality': 'Papua New Guinea' },
      rooms: { 'Room Number': '101', 'Room Type': 'Standard', 'Rate': 650, 'Max Adults': 2, 'Max Children': 1 },
      inventory: { 'Item Name': 'Coke 330ml', 'Category': 'Drinks', 'Unit': 'bottle', 'Current Stock': 24, 'Reorder Level': 6 },
      supplies: { 'Supply Item': 'Bath Towel', 'Category': 'Linen', 'Unit': 'piece', 'Current Stock': 30, 'Reorder Level': 8 },
      expenses: { 'Date': '2026-04-23', 'Category': 'Repairs', 'Description': 'Plumbing repair', 'Amount': 450, 'Paid By': 'Cash' },
      menu_items: { 'Name': 'Classic Burger', 'Category': 'Food', 'Selling Price': 85.00, 'Cost Price': 32.00, 'Unit': 'portion', 'Available': 'Yes' },
      customers: { 'Name': 'Neo Dube', 'Phone': '+267 7200 0001', 'Email': '', 'Notes': 'loyalty member' },
      ingredients: { 'Name': 'Beef Patty', 'Category': 'Food', 'Unit': 'piece', 'Current Stock': 50, 'Reorder Level': 10, 'Cost Per Unit': 12.00 },
      recipes: { 'Menu Item': 'Classic Burger', 'Ingredient': 'Beef Patty', 'Quantity': 1, 'Unit': 'piece', 'Wastage %': 0 },
      suppliers: { 'Name': 'Fresh Farms', 'Contact Person': 'Thabo', 'Phone': '+267 7300 0001', 'Email': 'thabo@freshfarms.co.bw', 'Category': 'produce' },
      staff: { 'Name': 'Kabelo Moagi', 'Role': 'cashier', 'Email': '', 'Phone': '+267 7400 0001' }
    }
    const wb = buildImportTemplateWorkbook({
      type: String(type || 'bookings'),
      fields,
      sample: samples[type] || samples.bookings
    })
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Import Template',
      defaultPath: `${APP_EXPORT_PREFIX}-${String(type || 'bookings')}-import-template.xlsx`,
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
  }, 6 * 60 * 60 * 1000)

  // Keep Command Central fleet health current while this desktop app is active.
  setTimeout(() => {
    db.publishDeviceHealth().catch((error) => {
      console.warn('Initial device health heartbeat failed:', error?.message || error)
    })
  }, 60_000)

  setInterval(() => {
    db.publishDeviceHealth().catch((error) => {
      console.warn('Scheduled device health heartbeat failed:', error?.message || error)
    })
  }, 5 * 60_000)

  // -- Notification Automation Scheduler --------------------------------------
  setTimeout(() => {
    db.evaluateAllRules().catch((error) => {
      console.error('Initial notification automation check failed:', error?.message || error)
    })
  }, 5 * 60_000)

  setInterval(() => {
    db.evaluateAllRules().catch((error) => {
      console.error('Scheduled notification automation check failed:', error?.message || error)
    })
  }, 60 * 60 * 1000)

  // -- Update IPC --------------------------------------------------------------
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true) // isSilent=false, isForceRunAfter=true
  })
  ipcMain.handle('update:check', async () => {
    if (is.dev) return { success: true, updateAvailable: false, dev: true }
    try {
      setUpdateState({ phase: 'checking', error: '' })
      const allowed = await gateUpdateCheck()
      if (!allowed) {
        return { success: true, updateAvailable: false, gated: true, state: { ...updateState } }
      }
      const result = await autoUpdater.checkForUpdates()
      const info = result?.updateInfo || {}
      const latestVersion = info.version
      const updateAvailable = latestVersion && latestVersion !== app.getVersion()
      return {
        success: true,
        updateAvailable,
        latestVersion,
        releaseName: info.releaseName || '',
        releaseDate: info.releaseDate || '',
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        state: { ...updateState }
      }
    }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('update:download', async () => {
    if (is.dev) return { success: true, dev: true }
    try {
      setUpdateState({ phase: 'downloading', error: '' })
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (e) {
      setUpdateState({ phase: 'error', error: e.message || 'Download failed.' })
      return { success: false, error: e.message || 'Download failed.' }
    }
  })
  ipcMain.handle('update:getState', () => ({ ...updateState }))
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:notify', async (_, payload = {}) => {
    showDesktopNotification({
      title: payload?.title || APP_BRAND_NAME,
      body: payload?.body || '',
      sound: payload?.sound !== false,
      flash: payload?.flash !== false
    })
    return { success: true }
  })
  ipcMain.handle('mesh:lockRoom', async (_, roomId, startDate, endDate) => {
    try {
      const lockId = await createLocalLock(roomId, startDate, endDate);
      return { success: !!lockId, lockId };
    } catch (e) {
      return { success: false, error: e.message };
    }
  })
  ipcMain.handle('mesh:unlockRoom', async (_, lockId) => {
    try {
      const released = await releaseLocalLock(lockId);
      return { success: released };
    } catch (e) {
      return { success: false, error: e.message };
    }
  })
  ipcMain.handle('mesh:getDiagnostics', () => getMeshHealthSnapshot())
  ipcMain.handle('mesh:refreshDiscovery', async () => {
    try {
      await refreshMeshDiscovery()
      return { success: true, mesh: getMeshHealthSnapshot() }
    } catch (e) {
      return { success: false, error: e.message, mesh: getMeshHealthSnapshot() }
    }
  })
  ipcMain.handle('mesh:connectManualPeer', async (_, address, port) => {
    try {
      const result = await connectManualMeshPeer(address, port)
      return { ...result, mesh: getMeshHealthSnapshot() }
    } catch (e) {
      return { success: false, error: e.message, mesh: getMeshHealthSnapshot() }
    }
  })
  ipcMain.handle('app:logRendererError', async (_, payload) => appendRendererErrorLog(payload || {}))
  ipcMain.handle('app:getRendererErrors', async (_, limit) => getRendererErrorLog(limit))
  ipcMain.handle('app:clearRendererErrors', async () => clearRendererErrorLog())

  // -- Hotel Domain --------------------------------------------------------
  ipcMain.handle('hotel:getDashboardStats', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('front_desk_dashboard.view')
      return await db.getHotelDashboardStats()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load hotel dashboard stats')
    }
  })
  ipcMain.handle('hotel:getArrivals', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('front_desk_dashboard.view')
      return await db.getHotelArrivals()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load hotel arrivals')
    }
  })
  ipcMain.handle('hotel:getDepartures', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('front_desk_dashboard.view')
      return await db.getHotelDepartures()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load hotel departures')
    }
  })
  ipcMain.handle('hotel:getInHouse', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('front_desk_dashboard.view')
      return await db.getHotelInHouse()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load in-house guests')
    }
  })
  ipcMain.handle('hotel:getNoShows', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('front_desk_dashboard.view')
      return await db.getHotelNoShows()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load no-show guests')
    }
  })
  ipcMain.handle('hotel:getKpis', async (_, days = 7) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('hotel_kpis.view')
      return await db.getHotelKpis(days)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load hotel KPIs')
    }
  })

  // -- Room Types ----------------------------------------------------------
  ipcMain.handle('roomTypes:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('room_types.view')
      return await db.getAllRoomTypes()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load room types')
    }
  })
  ipcMain.handle('roomTypes:create', async (_, data) => {
    try {
      await requireCapability('room_types.manage')
      return { success: true, id: await db.createRoomType(data) }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('roomTypes:update', async (_, id, data) => {
    try {
      await requireCapability('room_types.manage')
      await assertResourceBelongsToCurrentLodge('Room type', id, db.getRoomTypeById)
      await db.updateRoomType(id, data)
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('roomTypes:delete', async (_, id) => {
    try {
      await requireCapability('room_types.manage')
      await assertResourceBelongsToCurrentLodge('Room type', id, db.getRoomTypeById)
      await db.deleteRoomType(id)
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })

  // -- Room Attributes -------------------------------------------------------
  ipcMain.handle('roomAttributes:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('room_attributes.view')
      return await db.getAllRoomAttributes()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load room attributes')
    }
  })
  ipcMain.handle('roomAttributes:create', async (_, data) => {
    try {
      await requireCapability('room_attributes.manage')
      return { success: true, id: await db.createRoomAttribute(data) }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('roomAttributes:update', async (_, id, data) => {
    try {
      await requireCapability('room_attributes.manage')
      await db.updateRoomAttribute(id, data)
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('roomAttributes:delete', async (_, id) => {
    try {
      await requireCapability('room_attributes.manage')
      await db.deleteRoomAttribute(id)
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })

  // -- Floors & Sections -----------------------------------------------------
  ipcMain.handle('floorSections:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('floors_sections.view')
      return await db.getAllFloorSections()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load floors and sections')
    }
  })
  ipcMain.handle('floorSections:create', async (_, data) => {
    try {
      await requireCapability('floors_sections.manage')
      return { success: true, id: await db.createFloorSection(data) }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('floorSections:update', async (_, id, data) => {
    try {
      await requireCapability('floors_sections.manage')
      await assertResourceBelongsToCurrentLodge('Floor or section', id, db.getFloorSectionById)
      await db.updateFloorSection(id, data)
      return { success: true }
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('floorSections:delete', async (_, id) => {
    try {
      await requireCapability('floors_sections.manage')
      await assertResourceBelongsToCurrentLodge('Floor or section', id, db.getFloorSectionById)
      const result = await db.deleteFloorSection(id)
      return { success: true, ...result }
    } catch (e) { return { success: false, error: e.message } }
  })

  // ── Phase 10: Operational Modules ─────────────────────────────────────────
  ipcMain.handle('lostFound:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('lost_found.view')
      return await db.getAllLostFoundItems()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load lost & found items')
    }
  })
  ipcMain.handle('lostFound:create', async (_, data) => {
    try {
      await requireCapability('lost_found.manage')
      return await db.createLostFoundItem(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create lost & found item')
    }
  })
  ipcMain.handle('lostFound:update', async (_, id, data) => {
    try {
      await requireCapability('lost_found.manage')
      return await db.updateLostFoundItem(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update lost & found item')
    }
  })
  ipcMain.handle('lostFound:delete', async (_, id) => {
    try {
      await requireCapability('lost_found.manage')
      return await db.deleteLostFoundItem(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete lost & found item')
    }
  })
  ipcMain.handle('incidents:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('incident_log.view')
      return await db.getAllIncidents()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load incidents')
    }
  })
  ipcMain.handle('incidents:create', async (_, data) => {
    try {
      await requireCapability('incident_log.manage')
      return await db.createIncident(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create incident')
    }
  })
  ipcMain.handle('incidents:update', async (_, id, data) => {
    try {
      await requireCapability('incident_log.manage')
      return await db.updateIncident(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update incident')
    }
  })
  ipcMain.handle('visitors:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('visitor_register.view')
      return await db.getAllVisitors()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load visitors')
    }
  })
  ipcMain.handle('visitors:create', async (_, data) => {
    try {
      await requireCapability('visitor_register.manage')
      return await db.createVisitor(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create visitor')
    }
  })
  ipcMain.handle('visitors:checkout', async (_, id) => {
    try {
      await requireCapability('visitor_register.manage')
      return await db.checkoutVisitor(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to checkout visitor')
    }
  })
  ipcMain.handle('linen:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('linen_laundry.view')
      return await db.getAllLinenItems()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load linen items')
    }
  })
  ipcMain.handle('linen:create', async (_, data) => {
    try {
      await requireCapability('linen_laundry.manage')
      return await db.createLinenItem(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create linen item')
    }
  })
  ipcMain.handle('linen:getBatches', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('linen_laundry.view')
      return await db.getAllLinenBatches()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load linen batches')
    }
  })
  ipcMain.handle('linen:createBatch', async (_, data) => {
    try {
      await requireCapability('linen_laundry.manage')
      return await db.createLinenBatch(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create linen batch')
    }
  })

  // ── Group Blocks, Master Folios, Rooming Lists ─────────────────────────
  ipcMain.handle('groupBlocks:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('corporate_accounts.view')
      return await db.getAllGroupBlocks()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load group blocks')
    }
  })
  ipcMain.handle('groupBlocks:create', async (_, data) => {
    try {
      await requireCapability('corporate_accounts.manage')
      return await db.createGroupBlock(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create group block')
    }
  })
  ipcMain.handle('groupBlocks:update', async (_, id, data) => {
    try {
      await requireCapability('corporate_accounts.manage')
      return await db.updateGroupBlock(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update group block')
    }
  })
  ipcMain.handle('groupBlocks:delete', async (_, id) => {
    try {
      await requireCapability('corporate_accounts.manage')
      return await db.deleteGroupBlock(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete group block')
    }
  })
  ipcMain.handle('masterFolios:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('corporate_accounts.view')
      return await db.getAllMasterFolios()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load master folios')
    }
  })
  ipcMain.handle('masterFolios:create', async (_, data) => {
    try {
      await requireCapability('corporate_accounts.manage')
      return await db.createMasterFolio(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create master folio')
    }
  })
  ipcMain.handle('masterFolios:getDebtorAging', async (_, corporateAccountId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('corporate_accounts.view')
      return await db.getDebtorAging(corporateAccountId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load debtor aging')
    }
  })
  ipcMain.handle('masterFolios:checkCreditLimit', async (_, corporateAccountId, additionalAmount) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('corporate_accounts.view')
      return await db.checkCreditLimit(corporateAccountId, additionalAmount)
    } catch (error) {
      throw new Error(error?.message || 'Failed to check credit limit')
    }
  })
  ipcMain.handle('masterFolios:generateStatement', async (_, corporateAccountId, periodStart, periodEnd) => {
    try {
      await requireCapability('corporate_accounts.manage')
      return await db.generateCompanyStatement(corporateAccountId, periodStart, periodEnd)
    } catch (error) {
      throw new Error(error?.message || 'Failed to generate statement')
    }
  })
  ipcMain.handle('roomingLists:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('corporate_accounts.view')
      return await db.getAllRoomingLists()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load rooming lists')
    }
  })
  ipcMain.handle('roomingLists:process', async (_, entries, corporateAccountId, groupBlockId, importName) => {
    try {
      await requireCapability('corporate_accounts.manage')
      return await db.processRoomingList(entries, corporateAccountId, groupBlockId, importName)
    } catch (error) {
      throw new Error(error?.message || 'Failed to process rooming list')
    }
  })
  ipcMain.handle('roomingLists:parseCSV', async (_, csvText) => {
    try {
      return await db.parseRoomingListCSV(csvText)
    } catch (error) {
      throw new Error(error?.message || 'Failed to parse CSV')
    }
  })

  // ── Corporate Billing ────────────────────────────────────────────────────
  ipcMain.handle('corporateBilling:charge', async (_, accountId, bookingId, amount, description, intentId) => {
    try {
      await requireCapability('corporate_billing.charge')
      return await db.chargeToCorporateAccount(accountId, bookingId, amount, description, { idempotencyKey: intentId })
    } catch (error) {
      throw new Error(error?.message || 'Failed to charge corporate account')
    }
  })
  ipcMain.handle('corporateBilling:getOutstanding', async (_, accountId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('corporate_accounts.view')
      return await db.getCorporateOutstanding(accountId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get outstanding')
    }
  })
  ipcMain.handle('corporateBilling:recordPayment', async (_, accountId, invoiceIds, amount, method, reference, intentId) => {
    try {
      await requireCapability('corporate_billing.manage')
      return await db.recordCorporatePayment(accountId, invoiceIds, amount, method, reference, { idempotencyKey: intentId })
    } catch (error) {
      throw new Error(error?.message || 'Failed to record payment')
    }
  })
  ipcMain.handle('corporateBilling:getStatement', async (_, accountId, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('corporate_accounts.view')
      return await db.getCorporateStatement(accountId, start, end)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get statement')
    }
  })
  ipcMain.handle('corporateBilling:checkCreditLimit', async (_, accountId, pendingAmount) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('corporate_accounts.view')
      return await db.checkCreditLimitWithPending(accountId, pendingAmount)
    } catch (error) {
      throw new Error(error?.message || 'Failed to check credit limit')
    }
  })
  ipcMain.handle('corporateBilling:suspend', async (_, accountId, reason) => {
    try {
      await requireCapability('corporate_billing.manage')
      return await db.suspendCorporateAccount(accountId, reason)
    } catch (error) {
      throw new Error(error?.message || 'Failed to suspend account')
    }
  })
  ipcMain.handle('corporateBilling:reactivate', async (_, accountId) => {
    try {
      await requireCapability('corporate_billing.manage')
      return await db.reactivateCorporateAccount(accountId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to reactivate account')
    }
  })

  // ── Group Operations ────────────────────────────────────────────────────
  ipcMain.handle('groupOperations:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('group_operations.manage')
      return await db.getAllGroupOperations()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load group operations')
    }
  })
  ipcMain.handle('groupOperations:checkinBlock', async (_, blockId) => {
    try {
      await requireCapability('group_operations.manage')
      return await db.checkinGroupBlock(blockId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to check in group')
    }
  })
  ipcMain.handle('groupOperations:checkoutBlock', async (_, blockId) => {
    try {
      await requireCapability('group_operations.manage')
      return await db.checkoutGroupBlock(blockId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to check out group')
    }
  })
  ipcMain.handle('groupOperations:getPickup', async (_, blockId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('corporate_accounts.view')
      return await db.getGroupBlockPickup(blockId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get pickup')
    }
  })
  ipcMain.handle('groupOperations:releaseUnsold', async (_, blockId) => {
    try {
      await requireCapability('group_operations.manage')
      return await db.releaseUnsoldGroupRooms(blockId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to release unsold rooms')
    }
  })
  ipcMain.handle('groupOperations:createFromRoomingList', async (_, listId) => {
    try {
      await requireCapability('group_operations.manage')
      return await db.createBookingsFromRoomingList(listId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create bookings from rooming list')
    }
  })

  // ── Multi-Property ──────────────────────────────────────────────────────
  ipcMain.handle('multiProperty:getAllGroups', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('multi_property.view')
      return await db.getAllPropertyGroups()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load property groups')
    }
  })
  ipcMain.handle('multiProperty:createGroup', async (_, data) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.createPropertyGroup(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create group')
    }
  })
  ipcMain.handle('multiProperty:updateGroup', async (_, id, data) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.updatePropertyGroup(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update group')
    }
  })
  ipcMain.handle('multiProperty:deleteGroup', async (_, id) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.deletePropertyGroup(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete group')
    }
  })
  ipcMain.handle('multiProperty:getProperties', async (_, groupId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('multi_property.view')
      return await db.getGroupProperties(groupId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get properties')
    }
  })
  ipcMain.handle('multiProperty:addProperty', async (_, groupId, lodgeId, role) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.addPropertyToGroup(groupId, lodgeId, role)
    } catch (error) {
      throw new Error(error?.message || 'Failed to add property')
    }
  })
  ipcMain.handle('multiProperty:removeProperty', async (_, groupId, lodgeId) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.removePropertyFromGroup(groupId, lodgeId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to remove property')
    }
  })
  ipcMain.handle('multiProperty:getConsolidatedDashboard', async (_, groupId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('multi_property.view')
      return await db.getConsolidatedDashboard(groupId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get consolidated dashboard')
    }
  })
  ipcMain.handle('multiProperty:getConsolidatedOccupancy', async (_, groupId, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('multi_property.view')
      return await db.getConsolidatedOccupancyReport(groupId, start, end)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get occupancy report')
    }
  })
  ipcMain.handle('multiProperty:getConsolidatedFinancial', async (_, groupId, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('multi_property.view')
      return await db.getConsolidatedFinancialSummary(groupId, start, end)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get financial summary')
    }
  })
  ipcMain.handle('multiProperty:switchProperty', async (_, lodgeId) => {
    try {
      await requireCapability('multi_property.switch')
      return await db.switchActiveProperty(lodgeId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to switch property')
    }
  })
  ipcMain.handle('multiProperty:getGroupSettings', async (_, groupId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('multi_property.view')
      return await db.getGroupSettings(groupId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get group settings')
    }
  })
  ipcMain.handle('multiProperty:updateGroupSettings', async (_, groupId, key, value) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.updateGroupSettings(groupId, key, value)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update group settings')
    }
  })

  ipcMain.handle('multiProperty:getSharedGuestProfiles', async (_, groupId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('multi_property.view')
      return await db.getSharedGuestProfiles(groupId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get shared guest profiles')
    }
  })
  ipcMain.handle('multiProperty:shareGuestProfile', async (_, groupId, guestId, notes) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.shareGuestProfile(groupId, guestId, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to share guest profile')
    }
  })
  ipcMain.handle('multiProperty:unshareGuestProfile', async (_, groupId, guestId) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.unshareGuestProfile(groupId, guestId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to unshare guest profile')
    }
  })
  ipcMain.handle('multiProperty:getSharedBlacklist', async (_, groupId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('multi_property.view')
      return await db.getSharedBlacklist(groupId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get shared blacklist')
    }
  })
  ipcMain.handle('multiProperty:addBlacklistEntry', async (_, groupId, guestId, email, phone, reason) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.addBlacklistEntry(groupId, guestId, email, phone, reason)
    } catch (error) {
      throw new Error(error?.message || 'Failed to add blacklist entry')
    }
  })
  ipcMain.handle('multiProperty:removeBlacklistEntry', async (_, groupId, entryId) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.removeBlacklistEntry(groupId, entryId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to remove blacklist entry')
    }
  })
  ipcMain.handle('multiProperty:getSharedCorporateAccounts', async (_, groupId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('multi_property.view')
      return await db.getSharedCorporateAccounts(groupId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get shared corporate accounts')
    }
  })
  ipcMain.handle('multiProperty:shareCorporateAccount', async (_, groupId, corporateAccountId, shareLevel) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.shareCorporateAccount(groupId, corporateAccountId, shareLevel)
    } catch (error) {
      throw new Error(error?.message || 'Failed to share corporate account')
    }
  })
  ipcMain.handle('multiProperty:unshareCorporateAccount', async (_, groupId, corporateAccountId) => {
    try {
      await requireCapability('multi_property.manage')
      return await db.unshareCorporateAccount(groupId, corporateAccountId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to unshare corporate account')
    }
  })
  ipcMain.handle('multiProperty:getGroupMemberLodges', async (_, groupId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('multi_property.view')
      return await db.getGroupMemberLodges(groupId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get group member lodges')
    }
  })

  // ── Enterprise operations contracts ────────────────────────────────────
  ipcMain.handle('enterpriseOperations:getRecords', async (_, workflowKey, lodgeId = null) => {
    try {
      if (lodgeId) {
        requireMasterAdmin()
        assertCommandCentralTarget(lodgeId)
      } else {
        await requireCapabilityOrDevEnterprisePreview('front_desk_dashboard.view')
      }
      return await db.getEnterpriseWorkflowRecords(workflowKey, lodgeId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load Enterprise workflow records')
    }
  })
  ipcMain.handle('enterpriseOperations:upsertRecord', async (_, workflowKey, record, lodgeId = null) => {
    try {
      requireFreshCommandCentralReauth()
      if (lodgeId) assertCommandCentralTarget(lodgeId)
      await requireCapability('command_central.companies.manage')
      return await db.upsertEnterpriseWorkflowRecord(workflowKey, record, lodgeId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to save Enterprise workflow record')
    }
  })
  ipcMain.handle('enterpriseOperations:appendEvent', async (_, workflowKey, event, lodgeId = null) => {
    try {
      requireFreshCommandCentralReauth()
      if (lodgeId) assertCommandCentralTarget(lodgeId)
      await requireCapability('command_central.companies.manage')
      return await db.appendEnterpriseWorkflowEvent(workflowKey, event, lodgeId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to append Enterprise workflow event')
    }
  })
  ipcMain.handle('enterpriseOperations:createPaymentLinkRequest', async (_, payload) => {
    try {
      await requireCapability('payment_gateway.view')
      return await db.createPaymentLinkRequest(payload)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create payment link request')
    }
  })
  ipcMain.handle('enterpriseOperations:createChannelSyncItem', async (_, payload) => {
    try {
      await requireCapability('channel_manager.view')
      return await db.createChannelSyncItem(payload)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create channel sync item')
    }
  })
  ipcMain.handle('enterpriseOperations:createDocument', async (_, payload) => {
    try {
      await requireCapability('settings.view')
      return await db.createEnterpriseDocument(payload)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create Enterprise document')
    }
  })

  // ── Guest Messaging ────────────────────────────────────────────────────────────────────────
  ipcMain.handle('guestMessaging:getTemplates', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_messaging.manage')
      return await db.getGuestMessageTemplates()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load message templates')
    }
  })
  ipcMain.handle('guestMessaging:createTemplate', async (_, data) => {
    try {
      await requireCapability('guest_messaging.manage')
      return await db.createMessageTemplate(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create template')
    }
  })
  ipcMain.handle('guestMessaging:updateTemplate', async (_, id, data) => {
    try {
      await requireCapability('guest_messaging.manage')
      return await db.updateMessageTemplate(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update template')
    }
  })
  ipcMain.handle('guestMessaging:deleteTemplate', async (_, id) => {
    try {
      await requireCapability('guest_messaging.manage')
      return await db.deleteMessageTemplate(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete template')
    }
  })
  ipcMain.handle('guestMessaging:getTriggers', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_messaging.manage')
      return await db.getGuestMessageTriggers()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load triggers')
    }
  })
  ipcMain.handle('guestMessaging:createTrigger', async (_, data) => {
    try {
      await requireCapability('guest_messaging.manage')
      return await db.createMessageTrigger(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create trigger')
    }
  })
  ipcMain.handle('guestMessaging:updateTrigger', async (_, id, data) => {
    try {
      await requireCapability('guest_messaging.manage')
      return await db.updateMessageTrigger(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update trigger')
    }
  })
  ipcMain.handle('guestMessaging:deleteTrigger', async (_, id) => {
    try {
      await requireCapability('guest_messaging.manage')
      return await db.deleteMessageTrigger(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete trigger')
    }
  })
  ipcMain.handle('guestMessaging:renderTemplate', async (_, templateId, variables) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_messaging.manage')
      return await db.renderMessageTemplate(templateId, variables)
    } catch (error) {
      throw new Error(error?.message || 'Failed to render template')
    }
  })
  ipcMain.handle('guestMessaging:getDeliveryStatus', async (_, status) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_messaging.send')
      return await db.getMessageDeliveryStatus(status)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load delivery status')
    }
  })
  ipcMain.handle('guestMessaging:getChannelReadiness', async (_, channel) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_messaging.manage')
      return channel
        ? db.getGuestMessageChannelReadiness(channel)
        : db.getGuestMessageAllChannelReadiness()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load channel readiness')
    }
  })
  ipcMain.handle('guestMessaging:dispatchMessage', async (_, messageId, options) => {
    try {
      await requireCapability('guest_messaging.send')
      return await db.dispatchGuestMessage(messageId, options || {})
    } catch (error) {
      throw new Error(error?.message || 'Failed to dispatch guest message')
    }
  })
  // ── Guest Portal ──────────────────────────────────────────────────────────────────────────
  ipcMain.handle('guestPortal:getConfig', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_portal.configure')
      return await db.getGuestPortalConfig()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load portal config')
    }
  })
  ipcMain.handle('guestPortal:updateConfig', async (_, config) => {
    try {
      await requireCapability('guest_portal.configure')
      return await db.updateGuestPortalConfig(config)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update portal config')
    }
  })
  ipcMain.handle('guestPortal:createSession', async (_, email, bookingRef) => {
    try {
      await requireCapability('guest_portal.configure')
      return await db.createGuestPortalSession(email, bookingRef)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create portal session')
    }
  })
  ipcMain.handle('guestPortal:validateSession', async (_, token) => {
    try {
      return await db.validateGuestPortalSession(token)
    } catch (error) {
      throw new Error(error?.message || 'Failed to validate session')
    }
  })
  ipcMain.handle('guestPortal:getPendingRequests', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_portal.configure')
      return await db.getPendingGuestPortalRequests()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load portal requests')
    }
  })
  // ── Guest CRM ──────────────────────────────────────────────────────────────────────────────
  ipcMain.handle('guestCRM:getProfile', async (_, customerId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_crm.view')
      return await db.getGuestCRMProfile(customerId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load CRM profile')
    }
  })
  ipcMain.handle('guestCRM:updateProfile', async (_, customerId, data) => {
    try {
      await requireCapability('guest_crm.manage')
      return await db.updateGuestCRMProfile(customerId, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update CRM profile')
    }
  })
  ipcMain.handle('guestCRM:setVipLevel', async (_, customerId, level) => {
    try {
      await requireCapability('guest_crm.vip')
      const currentUser = await db.getCurrentUser()
      return await db.setVipLevel(customerId, level, currentUser?.id || null)
    } catch (error) {
      throw new Error(error?.message || 'Failed to set VIP level')
    }
  })
  ipcMain.handle('guestCRM:addPreference', async (_, customerId, key, value) => {
    try {
      await requireCapability('guest_crm.manage')
      return await db.addGuestPreference(customerId, key, value)
    } catch (error) {
      throw new Error(error?.message || 'Failed to add preference')
    }
  })
  ipcMain.handle('guestCRM:setBlacklist', async (_, customerId, blacklisted, reason) => {
    try {
      await requireCapability('guest_crm.blacklist')
      return await db.setBlacklistStatus(customerId, blacklisted, reason)
    } catch (error) {
      throw new Error(error?.message || 'Failed to set blacklist')
    }
  })
  ipcMain.handle('guestCRM:getStayHistory', async (_, customerId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_crm.view')
      return await db.getGuestStayHistory(customerId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load stay history')
    }
  })
  ipcMain.handle('guestCRM:recordConsent', async (_, customerId, consentType, granted) => {
    try {
      await requireCapability('guest_crm.manage')
      return await db.recordGuestConsent(customerId, consentType, granted)
    } catch (error) {
      throw new Error(error?.message || 'Failed to record consent')
    }
  })
  ipcMain.handle('guestCRM:search', async (_, query) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_crm.view')
      return await db.searchGuestsCRM(query)
    } catch (error) {
      throw new Error(error?.message || 'Failed to search')
    }
  })
  ipcMain.handle('guestCRM:listNotes', async (_, customerId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_crm.view')
      return await db.listGuestNotes(customerId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load CRM notes')
    }
  })
  ipcMain.handle('guestCRM:addNote', async (_, customerId, noteText, noteType) => {
    try {
      await requireCapability('guest_crm.manage')
      return await db.addGuestNote(customerId, noteText, noteType)
    } catch (error) {
      throw new Error(error?.message || 'Failed to add CRM note')
    }
  })
  ipcMain.handle('guestCRM:getVipList', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('guest_crm.vip')
      return await db.getVIPList()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load VIP list')
    }
  })
  // ── Payment Foundation ────────────────────────────────────────────────────────────────────
  ipcMain.handle('payments:getProviderConfig', async (_, provider, lodgeId = null) => {
    try {
      if (lodgeId) {
        requireMasterAdmin()
        assertCommandCentralTarget(lodgeId)
      } else {
        await requireCapability('settings.view')
      }
      return await db.getPaymentProviderConfig(lodgeId, provider)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load payment provider config')
    }
  })
  ipcMain.handle('payments:saveProviderConfig', async (_, payload, lodgeId = null) => {
    try {
      if (lodgeId) {
        requireFreshCommandCentralReauth()
        assertCommandCentralTarget(lodgeId)
      } else {
        await requireCapability('payment_gateway.manage')
      }
      return await db.savePaymentProviderConfig(payload, lodgeId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to save payment provider config')
    }
  })
  ipcMain.handle('subscriptionRequests:submit', async (_, request = {}) => {
    try {
      await requireCapability('settings.view')
      return await db.submitSubscriptionRequest(request)
    } catch (error) {
      throw new Error(error?.message || 'Failed to submit subscription request')
    }
  })
  ipcMain.handle('subscriptionRequests:getAll', async (_, status, limit, offset) => {
    try {
      requireMasterAdmin()
      await requireCapability('command_central.licensing.manage')
      return await db.getSubscriptionRequests(status, limit, offset)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load subscription requests')
    }
  })
  ipcMain.handle('subscriptionRequests:getById', async (_, requestId) => {
    try {
      requireMasterAdmin()
      await requireCapability('command_central.licensing.manage')
      return await db.getSubscriptionRequestById(requestId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load subscription request')
    }
  })
  ipcMain.handle('subscriptionRequests:updateStatus', async (_, requestId, status, reviewedBy, rejectionReason) => {
    try {
      requireMasterAdmin()
      await requireCapability('command_central.licensing.manage')
      return await db.updateSubscriptionRequestStatus(requestId, status, reviewedBy, rejectionReason)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update subscription request status')
    }
  })
  ipcMain.handle('subscriptionRequests:createDocument', async (_, requestId, type, documentInput) => {
    try {
      requireMasterAdmin()
      await requireCapability('command_central.licensing.manage')
      return await db.createSubscriptionRequestDocument(requestId, type, documentInput)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create subscription request document')
    }
  })
  ipcMain.handle('subscriptionRequests:exportDocumentPdf', async (event, documentPayload = {}) => {
    try {
      requireMasterAdmin()
      await requireCapability('command_central.licensing.manage')
      const win = BrowserWindow.fromWebContents(event.sender)
      const docNumber = String(documentPayload.document_number || 'subscription-document').replace(/[^\w.-]+/g, '-')
      const result = await dialog.showSaveDialog(win, {
        title: 'Save subscription document PDF',
        defaultPath: `${docNumber}.pdf`,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      const pdfBuffer = await renderHtmlToPdfBuffer(
        buildSubscriptionRequestDocumentPdfHtml(documentPayload),
        { pageSize: 'A4', printBackground: true },
        { minTextLength: 20 }
      )
      fs.writeFileSync(result.filePath, pdfBuffer)
      return { success: true, filePath: result.filePath }
    } catch (error) {
      throw new Error(error?.message || 'Failed to export subscription document PDF')
    }
  })
  ipcMain.handle('subscriptionRequests:activate', async (_, requestId, activatedBy, activationPayload) => {
    try {
      requireMasterAdmin()
      await requireCapability('command_central.licensing.manage')
      return await db.activateSubscriptionRequest(requestId, activatedBy, activationPayload)
    } catch (error) {
      throw new Error(error?.message || 'Failed to activate subscription request')
    }
  })

  // -- Room Moves -------------------------------------------------------------
  ipcMain.handle('roomMoves:getAvailable', async (_, currentRoomId, checkIn, checkOut) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('room_moves.view')
      return await db.getAvailableRoomsForMove(currentRoomId, checkIn, checkOut)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load available rooms')
    }
  })
  ipcMain.handle('roomMoves:execute', async (_, bookingId, targetRoomId, reason, actorName) => {
    try {
      await requireCapability('room_moves.manage')
      return await db.executeRoomMove(bookingId, targetRoomId, reason, actorName)
    } catch (error) {
      throw new Error(error?.message || 'Room move failed')
    }
  })

  // -- Corporate Accounts -----------------------------------------------------
  ipcMain.handle('corporateAccounts:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('corporate_accounts.view')
      return await db.getAllCorporateAccounts()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load corporate accounts')
    }
  })
  ipcMain.handle('corporateAccounts:create', async (_, data) => {
    try {
      await requireCapability('corporate_accounts.view')
      return await db.createCorporateAccount(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create corporate account')
    }
  })
  ipcMain.handle('corporateAccounts:update', async (_, id, data) => {
    try {
      await requireCapability('corporate_accounts.view')
      return await db.updateCorporateAccount(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update corporate account')
    }
  })
  ipcMain.handle('corporateAccounts:delete', async (_, id) => {
    try {
      await requireCapability('corporate_accounts.view')
      return await db.deleteCorporateAccount(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete corporate account')
    }
  })

  // -- Rate Plans -------------------------------------------------------------
  ipcMain.handle('ratePlans:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('rate_plans.view')
      return await db.getAllRatePlans()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load rate plans')
    }
  })
  ipcMain.handle('ratePlans:create', async (_, data) => {
    try {
      await requireCapability('rate_plans.view')
      return await db.createRatePlan(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create rate plan')
    }
  })
  ipcMain.handle('ratePlans:update', async (_, id, data) => {
    try {
      await requireCapability('rate_plans.view')
      return await db.updateRatePlan(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update rate plan')
    }
  })
  ipcMain.handle('ratePlans:delete', async (_, id) => {
    try {
      await requireCapability('rate_plans.view')
      return await db.deleteRatePlan(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete rate plan')
    }
  })
  ipcMain.handle('ratePlans:quoteRoomStay', async (_, roomId, checkIn, checkOut, corporateAccountId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('rate_plans.view')
      return await db.quoteRoomStayFromPlans(roomId, checkIn, checkOut, corporateAccountId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to quote room stay')
    }
  })

  // -- Channel Manager -------------------------------------------------------
  ipcMain.handle('channelManager:getDashboard', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('channel_manager.view')
      return await db.getChannelDashboard()
    } catch (error) {
      throw new Error(error?.message || 'Failed to get channel dashboard')
    }
  })
  ipcMain.handle('channelManager:getMappings', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('channel_manager.view')
      return await db.getAllMappings()
    } catch (error) {
      throw new Error(error?.message || 'Failed to get mappings')
    }
  })
  ipcMain.handle('channelManager:createMapping', async (_, channelKey, sourceType, localId, channelCode, channelName) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.createMapping(channelKey, sourceType, localId, channelCode, channelName)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create mapping')
    }
  })
  ipcMain.handle('channelManager:updateMapping', async (_, id, channelCode, channelName) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.updateMapping(id, channelCode, channelName)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update mapping')
    }
  })
  ipcMain.handle('channelManager:deleteMapping', async (_, id) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.deleteMapping(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete mapping')
    }
  })
  ipcMain.handle('channelManager:getConfigs', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('channel_manager.view')
      return await db.getAllConfigs()
    } catch (error) {
      throw new Error(error?.message || 'Failed to get configs')
    }
  })
  ipcMain.handle('channelManager:createConfig', async (_, channelKey, channelLabel, enabled, syncAvailability, syncRates, importReservations) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.createConfig(channelKey, channelLabel, enabled, syncAvailability, syncRates, importReservations)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create config')
    }
  })
  ipcMain.handle('channelManager:updateConfig', async (_, id, payload) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.updateConfig(id, payload)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update config')
    }
  })
  ipcMain.handle('channelManager:enableChannel', async (_, channelKey) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.enableChannel(channelKey)
    } catch (error) {
      throw new Error(error?.message || 'Failed to enable channel')
    }
  })
  ipcMain.handle('channelManager:disableChannel', async (_, channelKey) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.disableChannel(channelKey)
    } catch (error) {
      throw new Error(error?.message || 'Failed to disable channel')
    }
  })
  ipcMain.handle('channelManager:processSyncQueue', async (_, channelKey) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.processSyncQueue(channelKey)
    } catch (error) {
      throw new Error(error?.message || 'Failed to process sync queue')
    }
  })
  ipcMain.handle('channelManager:pushAvailability', async (_, channelKey, payload) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.pushChannelAvailability(channelKey, payload)
    } catch (error) {
      throw new Error(error?.message || 'Failed to push channel availability')
    }
  })
  ipcMain.handle('channelManager:pushRates', async (_, channelKey, payload) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.pushChannelRates(channelKey, payload)
    } catch (error) {
      throw new Error(error?.message || 'Failed to push channel rates')
    }
  })
  ipcMain.handle('channelManager:fetchReservations', async (_, channelKey, since) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.fetchChannelReservations(channelKey, since)
    } catch (error) {
      throw new Error(error?.message || 'Failed to fetch channel reservations')
    }
  })
  ipcMain.handle('channelManager:importReservation', async (_, payload) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.importReservation(payload)
    } catch (error) {
      throw new Error(error?.message || 'Failed to import reservation')
    }
  })
  ipcMain.handle('channelManager:confirmImport', async (_, importId) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.confirmImport(importId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to confirm import')
    }
  })
  ipcMain.handle('channelManager:rejectImport', async (_, importId, reason) => {
    try {
      await requireCapability('channel_manager.manage')
      return await db.rejectImport(importId, reason)
    } catch (error) {
      throw new Error(error?.message || 'Failed to reject import')
    }
  })

  // -- Document System -------------------------------------------------------
  ipcMain.handle('documentSystem:getTemplates', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('documents.view')
      return await db.getAllTemplates()
    } catch (error) {
      throw new Error(error?.message || 'Failed to get templates')
    }
  })
  ipcMain.handle('documentSystem:createTemplate', async (_, templateKey, name, documentType, contentTemplate, variables, branding, numberingPrefix) => {
    try {
      await requireCapability('documents.manage')
      return await db.createTemplate(templateKey, name, documentType, contentTemplate, variables, branding, numberingPrefix)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create template')
    }
  })
  ipcMain.handle('documentSystem:updateTemplate', async (_, id, payload) => {
    try {
      await requireCapability('documents.manage')
      return await db.updateTemplate(id, payload)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update template')
    }
  })
  ipcMain.handle('documentSystem:deleteTemplate', async (_, id) => {
    try {
      await requireCapability('documents.manage')
      return await db.deleteTemplate(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete template')
    }
  })
  ipcMain.handle('documentSystem:renderDocument', async (_, templateKey, subjectType, subjectId) => {
    try {
      await requireCapability('documents.generate')
      return await db.renderDocument(templateKey, subjectType, subjectId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to render document')
    }
  })
  ipcMain.handle('documentSystem:publishDocument', async (_, documentId) => {
    try {
      await requireCapability('documents.manage')
      return await db.publishDocument(documentId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to publish document')
    }
  })
  ipcMain.handle('documentSystem:getDocumentHistory', async (_, subjectType, subjectId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('documents.view')
      return await db.getDocumentHistory(subjectType, subjectId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get document history')
    }
  })
  ipcMain.handle('documentSystem:getDocumentDashboard', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('documents.view')
      return await db.getDocumentDashboard()
    } catch (error) {
      throw new Error(error?.message || 'Failed to get document dashboard')
    }
  })

  // -- Hotel Roles ------------------------------------------------------------
  ipcMain.handle('hotelRoles:getTemplates', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('hotel_roles.view')
      return await db.getHotelRoleTemplates()
    } catch (error) {
      throw new Error(error?.message || 'Failed to get role templates')
    }
  })
  ipcMain.handle('hotelRoles:getRoleCapabilities', async (_, roleKey) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('hotel_roles.view')
      return await db.getRoleCapabilities(roleKey)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get role capabilities')
    }
  })

  // -- Payment Gateway Extensions --------------------------------------------
  ipcMain.handle('payments:getPaymentDashboard', async (_, lodgeId = null) => {
    try {
      if (lodgeId) {
        requireMasterAdmin()
        assertCommandCentralTarget(lodgeId)
      } else {
        await requireCapabilityOrDevEnterprisePreview('payment_gateway.view')
      }
      return await db.getPaymentDashboard(lodgeId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get payment dashboard')
    }
  })
  ipcMain.handle('payments:verifyWebhookSignature', async (_, provider, signature, payloadRaw) => {
    try {
      return await db.verifyWebhookSignature(provider, signature, payloadRaw)
    } catch (error) {
      throw new Error(error?.message || 'Failed to verify webhook signature')
    }
  })
  // -- Abandoned Payment Recovery ---------------------------------------------
  ipcMain.handle('abandonedPayments:logSession', async (_, bookingId, amount, provider, sessionToken, expiresAt) => {
    try {
      await requireCapability('payment_gateway.manage')
      return await db.logAbandonedSession(bookingId, amount, provider, sessionToken, expiresAt)
    } catch (error) {
      throw new Error(error?.message || 'Failed to log abandoned payment session')
    }
  })
  ipcMain.handle('abandonedPayments:getSessions', async (_, statusFilter) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('payment_gateway.view')
      return await db.getAbandonedSessions(statusFilter)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get abandoned payment sessions')
    }
  })
  ipcMain.handle('abandonedPayments:recoverSession', async (_, sessionToken) => {
    try {
      await requireCapability('payment_gateway.manage')
      return await db.recoverSession(sessionToken)
    } catch (error) {
      throw new Error(error?.message || 'Failed to recover abandoned payment session')
    }
  })
  ipcMain.handle('abandonedPayments:expireSessions', async () => {
    try {
      await requireCapability('payment_gateway.manage')
      return await db.expireSessions()
    } catch (error) {
      throw new Error(error?.message || 'Failed to expire abandoned payment sessions')
    }
  })
  ipcMain.handle('abandonedPayments:getPendingRecovery', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('payment_gateway.view')
      return await db.getPendingRecoverySessions()
    } catch (error) {
      throw new Error(error?.message || 'Failed to get pending recovery sessions')
    }
  })

  // -- Rate Calendar ----------------------------------------------------------
  ipcMain.handle('rateCalendar:get', async (_, roomTypeId, startDate, endDate) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('rate_calendar.manage')
      return await db.getRateCalendar(roomTypeId, startDate, endDate)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load rate calendar')
    }
  })
  ipcMain.handle('rateCalendar:setEntry', async (_, roomTypeId, date, amount, currency) => {
    try {
      await requireCapability('rate_calendar.manage')
      return await db.setRateCalendarEntry(roomTypeId, date, amount, currency)
    } catch (error) {
      throw new Error(error?.message || 'Failed to set rate entry')
    }
  })
  ipcMain.handle('rateCalendar:setBulk', async (_, entries) => {
    try {
      await requireCapability('rate_calendar.manage')
      return await db.setRateCalendarBulk(entries)
    } catch (error) {
      throw new Error(error?.message || 'Failed to set bulk rates')
    }
  })
  ipcMain.handle('rateCalendar:setRestriction', async (_, roomTypeId, date, restrictions) => {
    try {
      await requireCapability('rate_calendar.manage')
      return await db.setRateRestriction(roomTypeId, date, restrictions)
    } catch (error) {
      throw new Error(error?.message || 'Failed to set restriction')
    }
  })
  ipcMain.handle('rateCalendar:getConflicts', async (_, roomTypeId, startDate, endDate) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('rate_calendar.manage')
      return await db.getRateConflicts(roomTypeId, startDate, endDate)
    } catch (error) {
      throw new Error(error?.message || 'Failed to check conflicts')
    }
  })
  ipcMain.handle('rateCalendar:getApplicableRate', async (_, roomTypeId, date) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('rate_calendar.manage')
      return await db.getRateCalendarApplicableRate(roomTypeId, date)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get applicable rate')
    }
  })
  ipcMain.handle('rateCalendar:quoteStayTotal', async (_, roomId, checkIn, checkOut, corporateAccountId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('rate_calendar.manage')
      return await db.quoteRateCalendarStayTotal(roomId, checkIn, checkOut, corporateAccountId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to quote stay total')
    }
  })

  // -- Yield Rules -----------------------------------------------------------
  ipcMain.handle('rateCalendar:getYieldRules', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_rates.view')
      return await db.getYieldRules()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load yield rules')
    }
  })
  ipcMain.handle('rateCalendar:createYieldRule', async (_, data) => {
    try {
      await requireCapability('advanced_rates.manage')
      return await db.createYieldRule(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create yield rule')
    }
  })
  ipcMain.handle('rateCalendar:updateYieldRule', async (_, id, data) => {
    try {
      await requireCapability('advanced_rates.manage')
      return await db.updateYieldRule(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update yield rule')
    }
  })
  ipcMain.handle('rateCalendar:deleteYieldRule', async (_, id) => {
    try {
      await requireCapability('advanced_rates.manage')
      return await db.deleteYieldRule(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete yield rule')
    }
  })
  ipcMain.handle('rateCalendar:getApplicableYieldAdjustment', async (_, date, currentOccupancyPct) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_rates.view')
      return await db.getApplicableYieldAdjustment(date, currentOccupancyPct)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get yield adjustment')
    }
  })
  ipcMain.handle('rateCalendar:calculateOccupancyBasedRate', async (_, baseRate, date, roomTypeId) => {
    try {
      await requireCapability('advanced_rates.manage')
      return await db.calculateOccupancyBasedRate(baseRate, date, roomTypeId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to calculate occupancy based rate')
    }
  })
  ipcMain.handle('rateCalendar:getOccupancyForecast', async (_, startDate, endDate) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_rates.view')
      return await db.getOccupancyForecast(startDate, endDate)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get occupancy forecast')
    }
  })

  // -- Promo Codes -----------------------------------------------------------
  ipcMain.handle('promoCodes:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('promo_codes.manage')
      return await db.getAllPromoCodes()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load promo codes')
    }
  })
  ipcMain.handle('promoCodes:create', async (_, data) => {
    try {
      await requireCapability('promo_codes.manage')
      return await db.createPromoCode(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create promo code')
    }
  })
  ipcMain.handle('promoCodes:update', async (_, id, data) => {
    try {
      await requireCapability('promo_codes.manage')
      return await db.updatePromoCode(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update promo code')
    }
  })
  ipcMain.handle('promoCodes:delete', async (_, id) => {
    try {
      await requireCapability('promo_codes.manage')
      return await db.deletePromoCode(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete promo code')
    }
  })
  ipcMain.handle('promoCodes:validate', async (_, code, roomTypeId, nights) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('promo_codes.manage')
      return await db.validatePromoCode(code, roomTypeId, nights)
    } catch (error) {
      throw new Error(error?.message || 'Failed to validate promo code')
    }
  })

  // -- Season Labels ---------------------------------------------------------
  ipcMain.handle('seasonLabels:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('rate_calendar.manage')
      return await db.getAllSeasonLabels()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load season labels')
    }
  })
  ipcMain.handle('seasonLabels:create', async (_, data) => {
    try {
      await requireCapability('rate_calendar.manage')
      return await db.createSeasonLabel(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create season label')
    }
  })
  ipcMain.handle('seasonLabels:update', async (_, id, data) => {
    try {
      await requireCapability('rate_calendar.manage')
      return await db.updateSeasonLabel(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update season label')
    }
  })
  ipcMain.handle('seasonLabels:delete', async (_, id) => {
    try {
      await requireCapability('rate_calendar.manage')
      return await db.deleteSeasonLabel(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete season label')
    }
  })

  // -- Revenue Manager -------------------------------------------------------
  ipcMain.handle('revenueManager:getForecast', async (_, startDate, endDate) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('revenue_manager.view')
      return await db.getRevenueForecast(startDate, endDate)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load revenue forecast')
    }
  })
  ipcMain.handle('revenueManager:upsertForecast', async (_, date, occupancyPct, adr, notes) => {
    try {
      await requireCapability('revenue_manager.view')
      return await db.upsertForecastEntry(date, occupancyPct, adr, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to save forecast entry')
    }
  })
  ipcMain.handle('revenueManager:getCompetitorNotes', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('revenue_manager.view')
      return await db.getCompetitorNotes()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load competitor notes')
    }
  })
  ipcMain.handle('revenueManager:createCompetitorNote', async (_, competitorName, roomTypeId, notedRate, notes) => {
    try {
      await requireCapability('revenue_manager.view')
      return await db.createCompetitorNote(competitorName, roomTypeId, notedRate, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create competitor note')
    }
  })
  ipcMain.handle('revenueManager:getDemandEvents', async (_, startDate, endDate) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('revenue_manager.view')
      return await db.getDemandEvents(startDate, endDate)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load demand events')
    }
  })
  ipcMain.handle('revenueManager:createDemandEvent', async (_, eventName, eventDate, expectedImpact, notes) => {
    try {
      await requireCapability('revenue_manager.view')
      return await db.createDemandEvent(eventName, eventDate, expectedImpact, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create demand event')
    }
  })
  ipcMain.handle('revenueManager:getRecommendations', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('revenue_manager.view')
      return await db.getRevenueRecommendations()
    } catch (error) {
      throw new Error(error?.message || 'Failed to get revenue recommendations')
    }
  })
  ipcMain.handle('revenueManager:approveRecommendation', async (_, recommendation, notes) => {
    try {
      await requireCapability('revenue_manager.view')
      return await db.approveRevenueRecommendation(recommendation, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to approve revenue recommendation')
    }
  })
  ipcMain.handle('revenueManager:rejectRecommendation', async (_, recommendation, reason) => {
    try {
      await requireCapability('revenue_manager.view')
      return await db.rejectRevenueRecommendation(recommendation, reason)
    } catch (error) {
      throw new Error(error?.message || 'Failed to reject revenue recommendation')
    }
  })
  ipcMain.handle('revenueManager:applyRecommendation', async (_, recommendation) => {
    try {
      await requireCapability('revenue_manager.view')
      // Always fail closed — never silently apply rates
      return await db.applyRevenueRecommendation(recommendation)
    } catch (error) {
      throw new Error(error?.message || 'Failed to apply revenue recommendation')
    }
  })

  // ── Night Audit (Enterprise) ──────────────────────────────────────────────
  ipcMain.handle('nightAudit:runChecks', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('night_audit.checks')
      return await db.runNightAuditChecks()
    } catch (error) {
      throw new Error(error?.message || 'Night audit checks failed')
    }
  })
  ipcMain.handle('nightAudit:close', async (_, closedBy, notes, force = false) => {
    try {
      await requireCapability('night_audit.close')
      return await db.closeNightAudit(closedBy, notes, force)
    } catch (error) {
      throw new Error(error?.message || 'Night audit close failed')
    }
  })
  ipcMain.handle('nightAudit:reopen', async (_, closeId, reopenedBy, reason) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('night_audit.reopen')
      return await db.reopenNightAudit(closeId, reopenedBy, reason)
    } catch (error) {
      throw new Error(error?.message || 'Night audit reopen failed')
    }
  })
  ipcMain.handle('nightAudit:summary', async (_, date) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('night_audit.checks')
      return await db.getNightAuditSummary(date)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get night audit summary')
    }
  })
  ipcMain.handle('nightAudit:history', async (_, limit) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('night_audit.checks')
      return await db.getNightAuditHistory(limit)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get night audit history')
    }
  })
  ipcMain.handle('nightAudit:resolveException', async (_, exceptionId, resolvedBy, notes) => {
    try {
      await requireCapability('night_audit.close')
      return await db.resolveNightAuditException(exceptionId, resolvedBy, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to resolve exception')
    }
  })

  // ── Check-in Workflow ─────────────────────────────────────────────────────
  ipcMain.handle('checkinWorkflow:getChecklist', async (_, bookingId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('checkin.manage')
      return await db.getCheckinChecklist(bookingId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load check-in checklist')
    }
  })
  ipcMain.handle('checkinWorkflow:completeStep', async (_, stepId, completedBy, data) => {
    try {
      await requireCapability('checkin.manage')
      return await db.completeCheckinStep(stepId, completedBy, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to complete check-in step')
    }
  })
  ipcMain.handle('checkinWorkflow:resetStep', async (_, stepId) => {
    try {
      await requireCapability('checkin.manage')
      return await db.resetCheckinStep(stepId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to reset check-in step')
    }
  })
  ipcMain.handle('checkinWorkflow:getConfig', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('checkin.manage')
      return await db.getCheckinConfig()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load check-in config')
    }
  })
  ipcMain.handle('checkinWorkflow:updateConfig', async (_, config) => {
    try {
      await requireCapability('checkin.manage')
      return await db.updateCheckinConfig(config)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update check-in config')
    }
  })
  ipcMain.handle('checkinWorkflow:completeHotelCheckin', async (_, bookingId) => {
    try {
      await requireCapability('checkin.manage')
      return await db.completeHotelCheckin(bookingId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to complete hotel check-in')
    }
  })
  ipcMain.handle('checkinWorkflow:completeHotelCheckinWithOverride', async (_, bookingId, overrideReason) => {
    try {
      // Manager override needs desk manage capability; reason is audited on step data + activity log
      await requireCapability('checkin.manage')
      return await db.completeHotelCheckinWithOverride(bookingId, overrideReason)
    } catch (error) {
      throw new Error(error?.message || 'Failed to complete hotel check-in with override')
    }
  })
  ipcMain.handle('checkoutWorkflow:completeHotelCheckout', async (_, bookingId) => {
    try {
      await requireCapability('checkout.manage')
      return await db.completeHotelCheckout(bookingId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to complete hotel check-out')
    }
  })
  ipcMain.handle('hotel:getApplicableRoomRate', async (_, roomId, date, corporateAccountId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('bookings.view')
      return await db.getApplicableRoomRate(roomId, date, corporateAccountId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to resolve room rate')
    }
  })
  ipcMain.handle('hotel:quoteRoomStay', async (_, roomId, checkIn, checkOut, corporateAccountId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('bookings.view')
      return await db.quoteRoomStay(roomId, checkIn, checkOut, corporateAccountId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to quote room stay')
    }
  })

  // ── Check-out Workflow ────────────────────────────────────────────────────
  ipcMain.handle('checkoutWorkflow:getChecklist', async (_, bookingId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('checkout.manage')
      return await db.getCheckoutChecklist(bookingId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load check-out checklist')
    }
  })
  ipcMain.handle('checkoutWorkflow:completeStep', async (_, stepId, completedBy, data) => {
    try {
      await requireCapability('checkout.manage')
      return await db.completeCheckoutStep(stepId, completedBy, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to complete check-out step')
    }
  })
  ipcMain.handle('checkoutWorkflow:resetStep', async (_, stepId) => {
    try {
      await requireCapability('checkout.manage')
      return await db.resetCheckoutStep(stepId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to reset check-out step')
    }
  })

  // ── Early Check-in / Late Checkout ────────────────────────────────────────
  ipcMain.handle('earlyLateCheckout:getEarlyPolicies', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('early_checkin.manage')
      return await db.getEarlyPolicies()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load early check-in policies')
    }
  })
  ipcMain.handle('earlyLateCheckout:createEarlyPolicy', async (_, data) => {
    try {
      await requireCapability('early_checkin.manage')
      return await db.createEarlyPolicy(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create early check-in policy')
    }
  })
  ipcMain.handle('earlyLateCheckout:updateEarlyPolicy', async (_, id, data) => {
    try {
      await requireCapability('early_checkin.manage')
      return await db.updateEarlyPolicy(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update early check-in policy')
    }
  })
  ipcMain.handle('earlyLateCheckout:deleteEarlyPolicy', async (_, id) => {
    try {
      await requireCapability('early_checkin.manage')
      return await db.deleteEarlyPolicy(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete early check-in policy')
    }
  })
  ipcMain.handle('earlyLateCheckout:getLatePolicies', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('late_checkout.manage')
      return await db.getLatePolicies()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load late checkout policies')
    }
  })
  ipcMain.handle('earlyLateCheckout:createLatePolicy', async (_, data) => {
    try {
      await requireCapability('late_checkout.manage')
      return await db.createLatePolicy(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create late checkout policy')
    }
  })
  ipcMain.handle('earlyLateCheckout:updateLatePolicy', async (_, id, data) => {
    try {
      await requireCapability('late_checkout.manage')
      return await db.updateLatePolicy(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update late checkout policy')
    }
  })
  ipcMain.handle('earlyLateCheckout:deleteLatePolicy', async (_, id) => {
    try {
      await requireCapability('late_checkout.manage')
      return await db.deleteLatePolicy(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete late checkout policy')
    }
  })
  ipcMain.handle('earlyLateCheckout:getEarlyRequests', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('early_checkin.manage')
      return await db.getEarlyRequests()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load early check-in requests')
    }
  })
  ipcMain.handle('earlyLateCheckout:createEarlyRequest', async (_, bookingId, policyId, time, notes) => {
    try {
      await requireCapability('early_checkin.manage')
      return await db.createEarlyRequest(bookingId, policyId, time, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create early check-in request')
    }
  })
  ipcMain.handle('earlyLateCheckout:approveEarlyRequest', async (_, id) => {
    try {
      await requireCapability('early_checkin.manage')
      return await db.approveEarlyRequest(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to approve early check-in request')
    }
  })
  ipcMain.handle('earlyLateCheckout:rejectEarlyRequest', async (_, id, notes) => {
    try {
      await requireCapability('early_checkin.manage')
      return await db.rejectEarlyRequest(id, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to reject early check-in request')
    }
  })
  ipcMain.handle('earlyLateCheckout:getLateRequests', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('late_checkout.manage')
      return await db.getLateRequests()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load late checkout requests')
    }
  })
  ipcMain.handle('earlyLateCheckout:createLateRequest', async (_, bookingId, policyId, time, notes) => {
    try {
      await requireCapability('late_checkout.manage')
      return await db.createLateRequest(bookingId, policyId, time, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create late checkout request')
    }
  })
  ipcMain.handle('earlyLateCheckout:approveLateRequest', async (_, id) => {
    try {
      await requireCapability('late_checkout.manage')
      return await db.approveLateRequest(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to approve late checkout request')
    }
  })
  ipcMain.handle('earlyLateCheckout:rejectLateRequest', async (_, id, notes) => {
    try {
      await requireCapability('late_checkout.manage')
      return await db.rejectLateRequest(id, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to reject late checkout request')
    }
  })
  ipcMain.handle('earlyLateCheckout:calculateEarlyFee', async (_, bookingId, time) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('early_checkin.manage')
      return await db.calculateEarlyFee(bookingId, time)
    } catch (error) {
      throw new Error(error?.message || 'Failed to calculate early check-in fee')
    }
  })
  ipcMain.handle('earlyLateCheckout:calculateLateFee', async (_, bookingId, time) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('late_checkout.manage')
      return await db.calculateLateFee(bookingId, time)
    } catch (error) {
      throw new Error(error?.message || 'Failed to calculate late checkout fee')
    }
  })

  // ── Cancellation Policies ─────────────────────────────────────────────────
  ipcMain.handle('cancellationPolicies:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('cancellation.manage')
      return await db.getAllCancellationPolicies()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load cancellation policies')
    }
  })
  ipcMain.handle('cancellationPolicies:create', async (_, data) => {
    try {
      await requireCapability('cancellation.manage')
      return await db.createCancellationPolicy(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create cancellation policy')
    }
  })
  ipcMain.handle('cancellationPolicies:update', async (_, id, data) => {
    try {
      await requireCapability('cancellation.manage')
      return await db.updateCancellationPolicy(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update cancellation policy')
    }
  })
  ipcMain.handle('cancellationPolicies:delete', async (_, id) => {
    try {
      await requireCapability('cancellation.manage')
      return await db.deleteCancellationPolicy(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete cancellation policy')
    }
  })
  ipcMain.handle('cancellationPolicies:calculateFee', async (_, bookingId, reason) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('cancellation.manage')
      return await db.calculateCancellationFee(bookingId, reason)
    } catch (error) {
      throw new Error(error?.message || 'Failed to calculate cancellation fee')
    }
  })
  ipcMain.handle('cancellationPolicies:process', async (_, requestId, approvedBy) => {
    try {
      await requireCapability('cancellation.approve')
      return await db.processCancellation(requestId, approvedBy)
    } catch (error) {
      throw new Error(error?.message || 'Failed to process cancellation')
    }
  })
  ipcMain.handle('cancellationPolicies:getRequests', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('cancellation.manage')
      return await db.getAllCancellationRequests()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load cancellation requests')
    }
  })
  ipcMain.handle('cancellationPolicies:approve', async (_, requestId, approvedBy) => {
    try {
      await requireCapability('cancellation.approve')
      return await db.approveCancellation(requestId, approvedBy)
    } catch (error) {
      throw new Error(error?.message || 'Failed to approve cancellation')
    }
  })

  // -- Advanced Reports -------------------------------------------------------
  ipcMain.handle('advancedReports:getOccupancy', async (_, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getOccupancy(start, end)
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getPace', async (_, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getPace(start, end)
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getPickup', async (_, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getPickup(start, end)
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getChannelSource', async (_, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getChannelSource(start, end)
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getDebtorAging', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getAdvancedReportDebtorAging()
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getRatePerformance', async (_, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getRatePerformance(start, end)
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getHousekeepingProductivity', async (_, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getHousekeepingProductivity(start, end)
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getRoomDowntime', async (_, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getRoomDowntime(start, end)
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getGroupPickup', async (_, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getGroupPickup(start, end)
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getCancellationNoShow', async (_, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getCancellationNoShow(start, end)
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getTaxVat', async (_, start, end) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getTaxVat(start, end)
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getDepositLiability', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getDepositLiability()
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })
  ipcMain.handle('advancedReports:getFolioExceptions', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_reports.view')
      return await db.getFolioExceptions()
    } catch (error) {
      return { data: null, error: error?.message || 'Failed' }
    }
  })

  // -- Hotel Folios ----------------------------------------------------------
  ipcMain.handle('folios:getAll', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('folios.view')
      return await db.getHotelFolios()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load hotel folios')
    }
  })
  ipcMain.handle('folios:getEntries', async (_, bookingId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('folios.view')
      return await db.getHotelFolioEntries(bookingId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load folio entries')
    }
  })
  ipcMain.handle('folios:postCharge', async (_, bookingId, data) => {
    try {
      await requireCapability('folios.manage')
      return await db.postHotelFolioCharge(bookingId, data)
    } catch (e) { return { success: false, error: e.message } }
  })

  // -- Hotel Folio Ledger (independent folio ledger) -------------------------
  ipcMain.handle('folioLedger:getFolios', async (_, bookingId) => {
    try {
      await requireCapability('folios.view')
      return await db.folioLedger.getFolios(bookingId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load ledger folios')
    }
  })
  ipcMain.handle('folioLedger:getLineItems', async (_, folioId) => {
    try {
      await requireCapability('folios.view')
      return await db.folioLedger.getLineItems(folioId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load ledger line items')
    }
  })
  ipcMain.handle('folioLedger:createFolio', async (_, bookingId, guestId, folioType, label, intentId) => {
    try {
      await requireCapability('folios.manage')
      return await db.folioLedger.createFolio(bookingId, guestId, folioType, label, intentId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('folioLedger:addCharge', async (_, folioId, amount, description, referenceType, referenceId, intentId) => {
    try {
      await requireCapability('folios.manage')
      return await db.folioLedger.addCharge(folioId, amount, description, referenceType, referenceId, intentId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('folioLedger:addPayment', async (_, folioId, amount, description, intentId) => {
    try {
      await requireCapability('folios.manage')
      return await db.folioLedger.addPayment(folioId, amount, description, intentId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('folioLedger:transferCharge', async (_, sourceFolioId, targetFolioId, amount, description, intentId) => {
    try {
      await requireCapability('folios.manage')
      return await db.folioLedger.transferCharge(sourceFolioId, targetFolioId, amount, description, intentId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('folioLedger:splitFolio', async (_, sourceFolioId, targetFolioType, targetLabel, amount, description, intentId) => {
    try {
      await requireCapability('folios.manage')
      return await db.folioLedger.splitFolio(sourceFolioId, targetFolioType, targetLabel, amount, description, intentId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('folioLedger:voidLineItem', async (_, lineItemId, reason, intentId) => {
    try {
      await requireCapability('folios.manage')
      return await db.folioLedger.voidLineItem(lineItemId, reason, intentId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('folioLedger:closeFolio', async (_, folioId, intentId) => {
    try {
      await requireCapability('folios.manage')
      return await db.folioLedger.closeFolio(folioId, intentId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('folioLedger:reopenFolio', async (_, folioId, intentId) => {
    try {
      await requireCapability('folios.manage')
      return await db.folioLedger.reopenFolio(folioId, intentId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('folioLedger:lockFolio', async (_, folioId, intentId) => {
    try {
      await requireCapability('folios.manage')
      return await db.folioLedger.lockFolio(folioId, intentId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('folioLedger:getBalance', async (_, folioId) => {
    try {
      await requireCapability('folios.view')
      return await db.folioLedger.getBalance(folioId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get folio balance')
    }
  })

  // ── Housekeeping Command Center IPC ───────────────────────────────────────
  ipcMain.handle('housekeepingCommandCenter:getDashboard', async (_, date) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_housekeeping.view')
      return await db.getHousekeepingDashboard(date)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load housekeeping dashboard')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:createAssignment', async (_, roomId, assignedTo, date, shift) => {
    try {
      await requireCapability('housekeeping.assign')
      return await db.createAssignment(roomId, assignedTo, date, shift)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create assignment')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:updateAssignmentStatus', async (_, id, status, notes) => {
    try {
      await requireCapability('housekeeping.assign')
      return await db.updateAssignmentStatus(id, status, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update assignment')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:createInspection', async (_, roomId, inspectedBy, checklistResults) => {
    try {
      await requireCapability('housekeeping.inspect')
      return await db.createInspection(roomId, inspectedBy, checklistResults)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create inspection')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:startTurnaround', async (_, bookingId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_housekeeping.view')
      return await db.startTurnaround(bookingId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to start turnaround')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:completeTurnaround', async (_, turnaroundId) => {
    try {
      await requireCapability('housekeeping.assign')
      return await db.completeTurnaround(turnaroundId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to complete turnaround')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:getTurnaroundTimes', async (_, startDate, endDate) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_housekeeping.view')
      return await db.getTurnaroundTimes(startDate, endDate)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load turnaround times')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:getProductivity', async (_, startDate, endDate) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_housekeeping.view')
      return await db.getProductivity(startDate, endDate)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load productivity data')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:getChecklistItems', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_housekeeping.view')
      return await db.getChecklistItems()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load checklist items')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:createChecklistItem', async (_, data) => {
    try {
      await requireCapability('housekeeping.inspect')
      return await db.createChecklistItem(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create checklist item')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:updateChecklistItem', async (_, id, data) => {
    try {
      await requireCapability('housekeeping.inspect')
      return await db.updateChecklistItem(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update checklist item')
    }
  })
  ipcMain.handle('housekeepingCommandCenter:deleteChecklistItem', async (_, id) => {
    try {
      await requireCapability('housekeeping.inspect')
      return await db.deleteChecklistItem(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete checklist item')
    }
  })

  // ── Maintenance Enterprise IPC ────────────────────────────────────────────
  ipcMain.handle('maintenanceEnterprise:getAllPreventiveSchedules', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('maintenance.view')
      return await db.getAllPreventiveSchedules()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load preventive schedules')
    }
  })
  ipcMain.handle('maintenanceEnterprise:createPreventiveSchedule', async (_, data) => {
    try {
      await requireCapability('maintenance.preventive')
      return await db.createPreventiveSchedule(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create preventive schedule')
    }
  })
  ipcMain.handle('maintenanceEnterprise:updatePreventiveSchedule', async (_, id, data) => {
    try {
      await requireCapability('maintenance.preventive')
      return await db.updatePreventiveSchedule(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update preventive schedule')
    }
  })
  ipcMain.handle('maintenanceEnterprise:deletePreventiveSchedule', async (_, id) => {
    try {
      await requireCapability('maintenance.preventive')
      return await db.deletePreventiveSchedule(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete preventive schedule')
    }
  })
  ipcMain.handle('maintenanceEnterprise:getDuePreventive', async (_, date) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('maintenance.view')
      return await db.getDuePreventiveMaintenance(date)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load due preventive maintenance')
    }
  })
  ipcMain.handle('maintenanceEnterprise:completePreventive', async (_, id, completedBy, notes) => {
    try {
      await requireCapability('maintenance.preventive')
      return await db.completePreventiveMaintenance(id, completedBy, notes)
    } catch (error) {
      throw new Error(error?.message || 'Failed to complete preventive maintenance')
    }
  })
  ipcMain.handle('maintenanceEnterprise:setRoomOutOfOrder', async (_, roomId, startDate, reason, endDate, ticketId) => {
    try {
      await requireCapability('maintenance.ooo')
      return await db.setRoomOutOfOrder(roomId, startDate, reason, endDate, ticketId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to set room out of order')
    }
  })
  ipcMain.handle('maintenanceEnterprise:setRoomOutOfService', async (_, roomId, startDate, reason, endDate, ticketId) => {
    try {
      await requireCapability('maintenance.ooo')
      return await db.setRoomOutOfService(roomId, startDate, reason, endDate, ticketId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to set room out of service')
    }
  })
  ipcMain.handle('maintenanceEnterprise:returnRoomToService', async (_, downtimeId) => {
    try {
      await requireCapability('maintenance.ooo')
      return await db.returnRoomToService(downtimeId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to return room to service')
    }
  })
  ipcMain.handle('maintenanceEnterprise:getRoomDowntimeHistory', async (_, roomId) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('maintenance.view')
      return await db.getRoomDowntimeHistory(roomId)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load downtime history')
    }
  })
  ipcMain.handle('maintenanceEnterprise:getMaintenanceDashboard', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('maintenance.view')
      return await db.getMaintenanceDashboard()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load maintenance dashboard')
    }
  })
  ipcMain.handle('maintenanceEnterprise:getDowntimeReport', async (_, startDate, endDate) => {
    try {
      await requireCapability('maintenance.preventive')
      return await db.getDowntimeReport(startDate, endDate)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load downtime report')
    }
  })

  // ── Asset Registry & Vendors IPC ──────────────────────────────────────────
  ipcMain.handle('assetRegistry:getAssets', async (_, assetType, status) => {
    try { return await db.getPropertyAssets(assetType, status) }
    catch (e) { return [] }
  })
  ipcMain.handle('assetRegistry:createAsset', async (_, data) => {
    try {
      await requireCapability('maintenance.manage')
      return await db.createPropertyAsset(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetRegistry:updateAsset', async (_, id, data) => {
    try {
      await requireCapability('maintenance.manage')
      return await db.updatePropertyAsset(id, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetRegistry:deleteAsset', async (_, id) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('maintenance.manage')
      return await db.deletePropertyAsset(id)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetRegistry:getMaintenanceHistory', async (_, assetId) => {
    try { return await db.getAssetMaintenanceHistory(assetId) }
    catch (e) { return [] }
  })
  ipcMain.handle('assetRegistry:logMaintenance', async (_, assetId, ticketId, description, cost, vendorId) => {
    try {
      await requireCapability('maintenance.manage')
      return await db.logAssetMaintenance(assetId, ticketId, description, cost, vendorId)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetRegistry:getVendors', async (_, specialisation) => {
    try { return await db.getMaintenanceVendors(specialisation) }
    catch (e) { return [] }
  })
  ipcMain.handle('assetRegistry:createVendor', async (_, data) => {
    try {
      await requireCapability('maintenance.manage')
      return await db.createMaintenanceVendor(data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetRegistry:updateVendor', async (_, id, data) => {
    try {
      await requireCapability('maintenance.manage')
      return await db.updateMaintenanceVendor(id, data)
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetRegistry:deleteVendor', async (_, id) => {
    try {
      requireRole('manager', 'admin', 'super_admin')
      await requireCapability('maintenance.manage')
      return await db.deleteMaintenanceVendor(id)
    } catch (e) { return { success: false, error: e.message } }
  })

  // -- Asset Management (Phase 5 depth) ------------------------------------
  ipcMain.handle('assetManagement:getAssetCategories', async () => {
    try { await requireCapability('asset_registry.view'); return await db.getAssetCategories() }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:createAssetCategory', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.createAssetCategory(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:updateAssetCategory', async (_, id, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.updateAssetCategory(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:deleteAssetCategory', async (_, id) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.deleteAssetCategory(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:getAssetWarranties', async (_, assetId) => {
    try { await requireCapability('asset_registry.view'); return await db.getAssetWarranties(assetId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:createAssetWarranty', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.createAssetWarranty(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:updateAssetWarranty', async (_, id, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.updateAssetWarranty(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:deleteAssetWarranty', async (_, id) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.deleteAssetWarranty(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:getAssetInspections', async (_, assetId) => {
    try { await requireCapability('asset_registry.view'); return await db.getAssetInspections(assetId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:createAssetInspection', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.createAssetInspection(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:deleteAssetInspection', async (_, id) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.deleteAssetInspection(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:getAssetAttachments', async (_, assetId) => {
    try { await requireCapability('asset_registry.view'); return await db.getAssetAttachments(assetId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:createAssetAttachment', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.createAssetAttachment(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:deleteAssetAttachment', async (_, id) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.deleteAssetAttachment(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:getAssetCosts', async (_, assetId) => {
    try { await requireCapability('asset_registry.view'); return await db.getAssetCosts(assetId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:recordAssetCost', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.recordAssetCost(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:getAssetCostSummary', async (_, startDate, endDate) => {
    try { await requireCapability('asset_registry.view'); return await db.getAssetCostSummary(startDate, endDate) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:getPreventiveTemplates', async (_, categoryId) => {
    try { await requireCapability('asset_registry.view'); return await db.getPreventiveTemplates(categoryId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:createPreventiveTemplate', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.createPreventiveTemplate(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:updatePreventiveTemplate', async (_, id, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.updatePreventiveTemplate(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:deletePreventiveTemplate', async (_, id) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.deletePreventiveTemplate(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:getPreventiveAssignments', async (_, assetId, status) => {
    try { await requireCapability('asset_registry.view'); return await db.getPreventiveAssignments(assetId, status) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:createPreventiveAssignment', async (_, data) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.createPreventiveAssignment(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:completePreventiveAssignment', async (_, id, notes) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.completePreventiveAssignment(id, notes) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:skipPreventiveAssignment', async (_, id, notes) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.skipPreventiveAssignment(id, notes) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:generatePreventiveAssignments', async () => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.generatePreventiveAssignments() }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:getAssetDashboard', async () => {
    try { await requireCapability('asset_registry.view'); return await db.getAssetDashboard() }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('assetManagement:setAssetRoomSellability', async (_, assetId, affectsSellability, sellabilityNotes) => {
    try { requireRole('manager', 'admin', 'super_admin'); await requireCapability('asset_registry.manage'); return await db.setAssetRoomSellability(assetId, affectsSellability, sellabilityNotes) }
    catch (e) { return { success: false, error: e.message } }
  })

  // ── Operations Compliance IPC ─────────────────────────────────────────────
  ipcMain.handle('operationsCompliance:createLinenStocktake', async (_, items) => {
    try {
      await requireCapability('linen.manage')
      return await db.createLinenStocktake(items)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create linen stocktake')
    }
  })
  ipcMain.handle('operationsCompliance:getLinenDashboard', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('linen_laundry.view')
      return await db.getLinenDashboard()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load linen dashboard')
    }
  })
  ipcMain.handle('operationsCompliance:reportDamagedLinen', async (_, itemId, quantity, reason) => {
    try {
      await requireCapability('linen.manage')
      return await db.reportDamagedLinen(itemId, quantity, reason)
    } catch (error) {
      throw new Error(error?.message || 'Failed to report damaged linen')
    }
  })
  ipcMain.handle('operationsCompliance:chargeDamagedLinen', async (_, bookingId, linenItemId, quantity, amount) => {
    try {
      await requireCapability('linen.manage')
      return await db.chargeDamagedLinen(bookingId, linenItemId, quantity, amount)
    } catch (error) {
      throw new Error(error?.message || 'Failed to charge damaged linen')
    }
  })
  ipcMain.handle('operationsCompliance:claimLostFoundItem', async (_, itemId, claimerName, claimerContact, disposition) => {
    try {
      await requireCapability('lost_found.manage')
      return await db.claimLostFoundItem(itemId, claimerName, claimerContact, disposition)
    } catch (error) {
      throw new Error(error?.message || 'Failed to claim lost & found item')
    }
  })
  ipcMain.handle('operationsCompliance:getLostFoundDashboard', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('lost_found.view')
      return await db.getLostFoundDashboard()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load lost & found dashboard')
    }
  })
  ipcMain.handle('operationsCompliance:resolveIncident', async (_, id, resolution, resolvedBy) => {
    try {
      await requireCapability('incidents.manage')
      return await db.resolveIncident(id, resolution, resolvedBy)
    } catch (error) {
      throw new Error(error?.message || 'Failed to resolve incident')
    }
  })
  ipcMain.handle('operationsCompliance:getIncidentDashboard', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('incident_log.view')
      return await db.getIncidentDashboard()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load incident dashboard')
    }
  })
  ipcMain.handle('operationsCompliance:getVisitorDashboard', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('visitor_register.view')
      return await db.getVisitorDashboard()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load visitor dashboard')
    }
  })
  ipcMain.handle('operationsCompliance:getVisitorHistory', async (_, startDate, endDate) => {
    try {
      await requireCapability('visitors.manage')
      return await db.getVisitorHistory(startDate, endDate)
    } catch (error) {
      throw new Error(error?.message || 'Failed to load visitor history')
    }
  })
  ipcMain.handle('operationsCompliance:getEvacuationList', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('emergency_list.view')
      return await db.getEvacuationList()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load evacuation list')
    }
  })
  ipcMain.handle('operationsCompliance:exportEvacuationReport', async () => {
    try {
      await requireCapability('emergency.view')
      return await db.exportEvacuationReport()
    } catch (error) {
      throw new Error(error?.message || 'Failed to export evacuation report')
    }
  })
  ipcMain.handle('operationsCompliance:createShiftHandover', async (_, data) => {
    try {
      await requireCapability('shift_handover.manage')
      return await db.createComplianceShiftHandover(data)
    } catch (error) {
      return { success: false, error: error?.message || 'Failed to create shift handover' }
    }
  })
  ipcMain.handle('operationsCompliance:completeShiftHandover', async (_, id) => {
    try {
      await requireCapability('shift_handover.manage')
      return await db.completeShiftHandover(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to complete shift handover')
    }
  })
  ipcMain.handle('operationsCompliance:getShiftHandoverHistory', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('shift_handover.manage')
      return await db.getShiftHandoverHistory()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load shift handover history')
    }
  })

  // ── Advanced Booking Engine ──────────────────────────────────────────────
  ipcMain.handle('bookingEngine:calculatePrice', async (_, roomTypeId, checkIn, checkOut, numGuests) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_booking_engine.view')
      return await db.calculateBookingPrice(roomTypeId, checkIn, checkOut, numGuests)
    } catch (error) {
      throw new Error(error?.message || 'Failed to calculate price')
    }
  })
  ipcMain.handle('bookingEngine:checkAvailability', async (_, roomTypeId, checkIn, checkOut, numRooms) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_booking_engine.view')
      return await db.checkBookingAvailability(roomTypeId, checkIn, checkOut, numRooms)
    } catch (error) {
      throw new Error(error?.message || 'Failed to check availability')
    }
  })
  ipcMain.handle('bookingEngine:getUpsells', async (_, roomTypeId, checkIn, checkOut, numGuests) => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_booking_engine.view')
      return await db.getBookingUpsells(roomTypeId, checkIn, checkOut, numGuests)
    } catch (error) {
      throw new Error(error?.message || 'Failed to get booking upsells')
    }
  })
  ipcMain.handle('bookingEngine:createIntent', async (_, roomTypeId, checkIn, checkOut, numGuests, priceEstimate, options) => {
    try {
      await requireCapability('advanced_booking_engine.manage')
      return await db.createBookingEngineIntent(roomTypeId, checkIn, checkOut, numGuests, priceEstimate, options)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create booking intent')
    }
  })
  ipcMain.handle('bookingEngine:confirmIntent', async (_, intentOrId, confirmation) => {
    try {
      await requireCapability('advanced_booking_engine.manage')
      return await db.confirmBookingEngineIntent(intentOrId, confirmation)
    } catch (error) {
      throw new Error(error?.message || 'Failed to confirm booking intent')
    }
  })
  ipcMain.handle('bookingEngine:getRules', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_booking_engine.view')
      return await db.getBookingEngineRules()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load booking engine rules')
    }
  })
  ipcMain.handle('bookingEngine:createRule', async (_, data) => {
    try {
      await requireCapability('advanced_booking_engine.manage')
      return await db.createBookingEngineRule(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create booking engine rule')
    }
  })
  ipcMain.handle('bookingEngine:updateRule', async (_, id, data) => {
    try {
      await requireCapability('advanced_booking_engine.manage')
      return await db.updateBookingEngineRule(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update booking engine rule')
    }
  })
  ipcMain.handle('bookingEngine:deleteRule', async (_, id) => {
    try {
      await requireCapability('advanced_booking_engine.manage')
      return await db.deleteBookingEngineRule(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete booking engine rule')
    }
  })
  ipcMain.handle('bookingEngine:getUpsellsList', async () => {
    try {
      await requireCapabilityOrDevEnterprisePreview('advanced_booking_engine.view')
      return await db.getBookingUpsellsList()
    } catch (error) {
      throw new Error(error?.message || 'Failed to load booking engine upsells')
    }
  })
  ipcMain.handle('bookingEngine:createUpsell', async (_, data) => {
    try {
      await requireCapability('advanced_booking_engine.manage')
      return await db.createBookingUpsell(data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to create booking engine upsell')
    }
  })
  ipcMain.handle('bookingEngine:updateUpsell', async (_, id, data) => {
    try {
      await requireCapability('advanced_booking_engine.manage')
      return await db.updateBookingUpsell(id, data)
    } catch (error) {
      throw new Error(error?.message || 'Failed to update booking engine upsell')
    }
  })
  ipcMain.handle('bookingEngine:deleteUpsell', async (_, id) => {
    try {
      await requireCapability('advanced_booking_engine.manage')
      return await db.deleteBookingUpsell(id)
    } catch (error) {
      throw new Error(error?.message || 'Failed to delete booking engine upsell')
    }
  })

  const restaurantAccountingV2Operations = {
    getAccounts: ['accounting.read', db.getRestaurantAccountsV2],
    createAccount: ['accounting.manage', db.createRestaurantAccountV2],
    updateAccount: ['accounting.manage', db.updateRestaurantAccountV2],
    setCashFlow: ['accounting.manage', db.setRestaurantAccountCashFlowV2],
    deleteAccount: ['accounting.manage', db.deleteRestaurantAccountV2],
    seedAccounts: ['accounting.manage', db.seedRestaurantAccountsV2],
    postOpeningBalance: ['accounting.manage', db.postRestaurantOpeningBalanceV2],
    getLedger: ['accounting.read', db.getRestaurantLedgerWorkspaceV2],
    createJournal: ['accounting.manage', db.createRestaurantJournalV2],
    reverseJournal: ['accounting.manage', db.reverseRestaurantJournalV2],
    getPosMappings: ['accounting.read', db.getRestaurantPosMappingsV2],
    setPosMapping: ['accounting.manage', db.setRestaurantPosMappingV2],
    postPosOrder: ['accounting.manage', db.postRestaurantPosOrderV2],
    getAp: ['accounting.read', db.getRestaurantApWorkspaceV2],
    setApSettings: ['accounting.manage', db.setRestaurantApGlSettingsV2],
    createBill: ['accounting.manage', db.createRestaurantBillV2],
    submitBill: ['accounting.manage', db.submitRestaurantBillV2],
    approveBill: ['accounting.manage', db.approveRestaurantBillV2],
    payBill: ['accounting.ap_pay', db.payRestaurantBillV2],
    saveBankAccount: ['accounting.manage', db.saveRestaurantBankAccountV2],
    getBank: ['accounting.read', db.getRestaurantBankWorkspaceV2],
    importBank: ['accounting.manage', db.importRestaurantBankStatementV2],
    proposeBank: ['accounting.manage', db.proposeRestaurantBankMatchesV2],
    reviewBank: ['accounting.bank_approve', db.reviewRestaurantBankMatchV2],
    exceptBank: ['accounting.manage', db.exceptRestaurantBankTransactionV2],
    createReconciliation: ['accounting.manage', db.createRestaurantBankReconciliationV2],
    completeReconciliation: ['accounting.bank_approve', db.completeRestaurantBankReconciliationV2],
    getTax: ['accounting.read', db.getRestaurantTaxWorkspaceV2],
    setTaxConfig: ['accounting.manage', db.setRestaurantTaxConfigurationV2],
    generateTax: ['accounting.manage', db.generateRestaurantTaxWorkingPaperV2],
    reviewTax: ['accounting.manage', db.reviewRestaurantTaxWorkingPaperV2],
    approveTax: ['accounting.tax_file', db.approveRestaurantTaxWorkingPaperV2],
    fileTax: ['accounting.tax_file', db.fileRestaurantTaxWorkingPaperV2],
    getBudgets: ['accounting.read', db.getRestaurantBudgetMatrixV2],
    saveBudgets: ['accounting.manage', db.saveRestaurantBudgetMatrixV2],
    createBudgetTemplate: ['accounting.manage', db.createRestaurantBudgetTemplateV2],
    applyBudgetTemplate: ['accounting.manage', db.applyRestaurantBudgetTemplateV2],
    getStatements: ['accounting.read', db.getRestaurantFinancialStatementsV2],
    getPayroll: ['accounting.payroll_view', db.getRestaurantPayrollWorkspaceV2],
    getPayrollRecords: ['accounting.payroll_view', db.getRestaurantPayrollRecordsV2],
    setPayrollTerms: ['accounting.payroll_manage', db.setRestaurantPayrollTermsV2],
    setPayrollConfig: ['accounting.payroll_manage', db.setRestaurantPayrollConfigurationV2],
    createPayPeriod: ['accounting.payroll_manage', db.createRestaurantPayPeriodV2],
    setPayrollTime: ['accounting.payroll_manage', db.setRestaurantPayrollTimeV2],
    approvePayrollTime: ['accounting.payroll_manage', db.approveRestaurantPayrollTimeV2],
    calculatePayroll: ['accounting.payroll_manage', db.calculateRestaurantPayrollV2],
    approvePayroll: ['accounting.payroll_manage', db.approveRestaurantPayrollV2],
    exportPayroll: ['accounting.payroll_manage', db.exportRestaurantPayrollPaymentsV2],
    setPayrollGl: ['accounting.payroll_manage', db.setRestaurantPayrollGlSettingsV2],
    postPayroll: ['accounting.payroll_manage', db.postRestaurantPayrollV2]
  }
  ipcMain.handle('restaurantAccountingV2:invoke', async (_, operation, args = []) => {
    const contract = restaurantAccountingV2Operations[operation]
    if (!contract) throw new Error('Unsupported Restaurant Accounting operation')
    const [capability, handler] = contract
    try {
      await requireCapability(capability)
      return await handler(...(Array.isArray(args) ? args : []))
    } catch (error) {
      throw new Error(error?.message || `Restaurant Accounting ${operation} failed`)
    }
  })


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
