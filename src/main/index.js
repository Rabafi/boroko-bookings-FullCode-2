import { app, shell, BrowserWindow, ipcMain, Notification, dialog, Menu, nativeImage } from 'electron'
import { join, dirname, basename } from 'path'
import fs from 'fs'
import crypto from 'crypto'
import * as XLSX from '@e965/xlsx'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import autoUpdaterPkg from 'electron-updater'
const { autoUpdater } = autoUpdaterPkg
import * as db from './database.js'
import { readCache } from './domains/cacheStore.js'
import { createAiOrchestrator, writeAiAuditLog } from './ai/aiOrchestrator.js'
import { buildCapabilitySnapshot, normalizeAppRole } from '../shared/accessControl.js'
import { normalizeDayUseReportRow } from '../shared/dayUseReporting.js'
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
import { createLocalLock, releaseLocalLock } from './domains/mesh/meshLocks.js'

const INPUT_FOCUS_DEBUG = false
const APP_LOGO_FILENAME = 'boroko-bookings-logo.svg'
const APP_DARK_LOGO_FILENAME = 'boroko-bookings-logo-dark.png'
let activeSplashWindow = null

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
    note: 'Local development mesh secret shared by unpackaged Boroko desk test instances only.'
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

    console.log('[DevDesk] Seeded terminal desk profile from installed Boroko Bookings data.')
  } catch (error) {
    console.warn('[DevDesk] Could not seed terminal desk profile:', error?.message || error)
  }
}

if (process.env.BOROKO_TEST_USER_DATA_DIR) {
  app.setPath('userData', process.env.BOROKO_TEST_USER_DATA_DIR)
} else if (!app.isPackaged) {
  const devDeskName = process.env.BOROKO_DEV_DESK_NAME || 'Boroko Bookings Dev Desk'
  const installedDeskName = process.env.BOROKO_INSTALLED_DESK_NAME || 'boroko-bookings'
  const appDataDir = app.getPath('appData')
  const devUserDataDir = join(appDataDir, devDeskName)
  const installedUserDataDir = join(appDataDir, installedDeskName)
  seedDevDeskFromInstalledApp(installedUserDataDir, devUserDataDir)
  ensureDevDeskMeshSecret(appDataDir, devUserDataDir)
  app.setName(devDeskName)
  app.setPath('userData', devUserDataDir)
}

// ── URL safety guard (used by shell:openExternal and setWindowOpenHandler) ────
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
    const icoPath = join(process.resourcesPath, 'assets', 'boroko-bookings-icon.ico')
    const devIcoPath = join(app.getAppPath(), 'src', 'main', 'assets', 'boroko-bookings-icon.ico')
    const logoPath = (app.isPackaged && fs.existsSync(icoPath))
      ? icoPath
      : fs.existsSync(devIcoPath)
        ? devIcoPath
        : getAppLogoPath()
    if (!logoPath) return null
    return nativeImage.createFromPath(logoPath)
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
    ['Boroko Bookings Import Template'],
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
    ? `<img src="data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}" alt="Boroko Bookings" />`
    : '<div class="fallback">Boroko</div>'

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
        <div class="title">Boroko Bookings</div>
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
    title: 'Boroko Bookings Starting',
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

function buildReportExportFilename({ prefix = 'boroko', reportTitle = 'report', period = '', extension = 'pdf' } = {}) {
  const parts = [
    slugifyFilenamePart(prefix, 'boroko'),
    slugifyFilenamePart(reportTitle, 'report'),
    period ? slugifyFilenamePart(period, 'period') : null,
    formatFilenameStamp()
  ].filter(Boolean)
  return `${parts.join('-')}.${extension}`
}

function buildWorkbookMetaRows({ lodgeName, companyName, periodLabel, outletLabel, generatedAt, includeOutlet = false }) {
  const resolvedLodge = lodgeName || companyName || 'Boroko Lodge'
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
  const resolvedLodge = lodgeName || companyName || 'Boroko Lodge'
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

// ── Push notification helper ─────────────────────────────────────────────────
const EDGE_FN_URL = process.env.SUPABASE_URL
  ? `${process.env.SUPABASE_URL}/functions/v1`
  : null
const PUSH_FUNCTION_SECRET = process.env.PUSH_FUNCTION_SECRET || process.env.BOROKO_PUSH_FUNCTION_SECRET || ''

function notifyLodge(lodgeId, title, body) {
  showDesktopNotification({ title, body, sound: true, flash: true })
  if (!EDGE_FN_URL || !lodgeId || !PUSH_FUNCTION_SECRET) return
  fetch(`${EDGE_FN_URL}/send-push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
      'x-boroko-function-secret': PUSH_FUNCTION_SECRET
    },
    body: JSON.stringify({ lodge_id: lodgeId, title, body })
  }).catch(() => {})
}

function showDesktopNotification({ title = 'Boroko Bookings', body = '', sound = true, flash = true } = {}) {
  const safeTitle = String(title || 'Boroko Bookings')
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

// ── Auto-updater setup ───────────────────────────────────────────────────────
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
  setTimeout(() => autoUpdater.checkForUpdates(), 8000)

  // Then re-check every 4 hours
  setInterval(() => autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000)
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
    maximized: true,
    show: false,
    autoHideMenuBar: true,
    title: 'Boroko Bookings',
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      // sandbox: false required — electron-vite preload uses ESM imports resolved
      // via Node module system, incompatible with sandbox: true in dev HTTP mode.
      // Security enforced via contextIsolation: true (contextBridge) + nodeIntegration: false.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  // ── Proactive Ops AI watcher (lightweight) ─────────────────────────────────
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
    // Keep this extremely lightweight (runs every 30s).
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
    }, 30_000)

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
    if (!mainWindow.isMaximized()) mainWindow.maximize()
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
        // non-fatal — may not be available in all Electron versions
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
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Start proactive Ops AI watcher once window exists.
  // It emits ai:alert events consumed by the floating UI layer.
  startAiWatcher()

  return mainWindow
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
  activityLog: 'Activity Log'
}

const EXPORT_PRESETS = {
  full: Object.keys(EXPORT_SECTION_LABELS),
  finance: ['bookingInvoices', 'expenses', 'posOrders', 'inventoryPurchases', 'supplyPurchases', 'conferenceBookings', 'dayUseEntries'],
  bookingGuest: ['bookings', 'customers', 'bookingInvoices', 'quotations'],
  operations: ['rooms', 'maintenance', 'inventoryItems', 'inventoryPurchases', 'supplyItems', 'supplyPurchases', 'conferenceBookings', 'dayUseEntries'],
  inventory: ['inventoryItems', 'inventoryPurchases', 'supplyItems', 'supplyPurchases']
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
    activityLog
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
      'Items': (o.pos_order_items || []).map(i => `${i.quantity}× ${i.item_name}`).join(', '),
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
      'Room': q.room_number || '',
      'Check-in': q.check_in || '',
      'Check-out': q.check_out || '',
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
  const excelPath = join(policy.target_dir, `boroko-full-${stamp}.xlsx`)

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
  electronApp.setAppUserModelId('com.boroko.bookings')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createStartupSplashWindow()

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
      console.log('[AUTH] Login attempt')

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
        db.createSessionNonce(masterAdmin, password)
        return { ok: true, code: null, user: masterAdmin, mode: 'online' }
      }

      // Regular user login
      console.log('[AUTH] Trying regular user login...')
      const result = await db.loginUser(email, password)

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

  ipcMain.handle('auth:sendPasswordReset', async (_, email) => {
    try { return await db.sendPasswordResetEmail(email) }
    catch (e) { return { success: false, error: e.message || 'Could not send password reset email.' } }
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
    try { db.logoutCurrentUser(); return { ok: true } } catch { return { ok: true } }
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
    if (user.isMasterAdmin) return
    if (roles.length > 0 && !roles.includes(normalizeAppRole(user.role))) {
      throw new Error('Unauthorized')
    }
  }

  function requireCurrentLodgeOrSuperAdmin(targetLodgeId) {
    const user = getCurrentUserOrRestore()
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
        features: entitlement?.effective_features || {}
      }),
      entitlement
    }
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

  // ── AI Ops Agent ──────────────────────────────────────────────────────────
  const ai = createAiOrchestrator({
    appUserDataPath: app.getPath('userData'),
    db,
    requireCapability
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

  // ── Collections: Preview (read-only, no AI call) ───────────────────────────
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

  // ── Collections: Execute (RPC-safe, streaming via IPC events) ─────────────
  // Iterates items from a confirmed preview, calls updateBookingPayment for each,
  // and emits progress events to the renderer after every booking.
  ipcMain.handle('ai:collections:execute', async (event, payload = {}) => {
    try {
      await requireCapability('payments.record')

      // P0.6: Bulk actions gate — must also respect AI_ACTIONS_ENABLED
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

  // ── Overdue Checkouts: Preview ────────────────────────────────────────────────
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

  // ── Overdue Checkouts: Execute (streaming progress) ──────────────────────────
  ipcMain.handle('ai:overdue:execute', async (event, payload = {}) => {
    try {
      await requireCapability('bookings.manage')

      // P0.6: Bulk actions gate — must also respect AI_ACTIONS_ENABLED
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
  ipcMain.handle('admin:getExpenses', async () => {
    try { requireRole('super_admin'); return await db.getAdminExpenses() }
    catch { return [] }
  })
  ipcMain.handle('admin:createExpense', async (_, data) => {
    try { requireRole('super_admin'); return await db.createAdminExpense(data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:updateExpense', async (_, id, data) => {
    try { requireRole('super_admin'); return await db.updateAdminExpense(id, data) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:deleteExpense', async (_, id) => {
    try { requireRole('super_admin'); return await db.deleteAdminExpense(id) }
    catch (e) { return { success: false, error: e.message } }
  })
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
  ipcMain.handle('admin:archiveCompany', async (_, lodgeId) => {
    try { requireRole('super_admin'); return await db.archiveCompany(lodgeId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:restoreCompany', async (_, lodgeId) => {
    try { requireRole('super_admin'); return await db.restoreCompany(lodgeId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:permanentlyDeleteCompany', async (_, lodgeId) => {
    try { requireRole('super_admin'); return await db.permanentlyDeleteCompany(lodgeId) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('admin:repairDuplicateEventBookings', async (_, lodgeId) => {
    try { requireRole('super_admin'); return await db.repairDuplicateEventBookings(lodgeId) }
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
      return await db.updateBookingPayment(id, amount, method, 'payment', null, intentKey)
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
      defaultPath: buildReportExportFilename({ prefix: 'boroko', reportTitle: reportTitle || reportType, period, extension: 'pdf' }),
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

  ipcMain.handle('app:setTestOfflineMode', async (_, forceOffline) => {
    if (app.isPackaged && !process.env.BOROKO_TEST_USER_DATA_DIR) {
      return { success: false, error: 'Test offline mode is disabled in production builds.' }
    }
    process.env.BOROKO_TEST_FORCE_OFFLINE = forceOffline ? 'true' : 'false'
    await db.checkOnline?.().catch(() => false)
    return { success: true, forceOffline: process.env.BOROKO_TEST_FORCE_OFFLINE === 'true' }
  })

  // ── Excel Export ──────────────────────────────────────────────────────────
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
      defaultPath: buildReportExportFilename({ prefix: 'boroko', reportTitle, period, extension: 'xlsx' }),
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false }
    try {
      const wb = XLSX.utils.book_new()
      const sym = currency || 'P'
      const totalDays = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000))
      const resolvedLodge = lodgeName || companyName || 'Boroko Lodge'
      const sharedMeta = { lodgeName: resolvedLodge, companyName, periodLabel: `${start} to ${end}`, generatedAt }
      const outletMeta = { ...sharedMeta, outletLabel }

      // Revenue Summary sheet
      const revRows = [
        [`${resolvedLodge} — Revenue Report`],
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
        ['Fees Kept From Refunds', `${sym} ${Number(revenue?.retained_revenue || 0).toFixed(2)}`],
        ['Outstanding',        `${sym} ${Number(revenue?.outstanding_amount || 0).toFixed(2)}`]
      )
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(revRows), 'Revenue Summary')

      // Room Occupancy sheet
      const occRows = [
        [`${resolvedLodge} — Room Occupancy Report`],
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
          [`${resolvedLodge} — Expenses Report`],
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
          [`${resolvedLodge} — POS Sales Report`],
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
          [`${resolvedLodge} — Stock Costs Report`],
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
          [`${resolvedLodge} — Profit & Loss Statement`],
          ...buildWorkbookMetaRows(sharedMeta),
          ['REVENUE', `${sym}`],
          ['Booking Revenue',  Number(pl.bookingRevenue || 0).toFixed(2)],
          ['Fees Kept From Refunds', Number(pl.retainedRevenue || 0).toFixed(2)],
          ['POS Revenue',      Number(pl.posRevenue || 0).toFixed(2)],
          ['Total Revenue',    Number(pl.totalRevenue || 0).toFixed(2)]
        ]
        if (pl.vatEnabled) {
          plRows.push([`VAT (${pl.vatRate}% inclusive)`, `-${Number(pl.vatAmount || 0).toFixed(2)}`])
          plRows.push(['Net Revenue (excl. VAT)', Number(pl.netRevenue || 0).toFixed(2)])
        }
        plRows.push(
          [],
          ['EXPENSES', ''],
          ['Operating Expenses', Number(pl.totalExpenses || 0).toFixed(2)],
          ['Inventory Purchases', Number(pl.invCosts || 0).toFixed(2)],
          ['Room Supplies',      Number(pl.supCosts || 0).toFixed(2)],
          ['Maintenance Repairs', Number(pl.maintenanceCosts || 0).toFixed(2)],
          ['Total Stock & Maintenance Costs', Number(pl.totalCosts || 0).toFixed(2)],
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
        defaultPath: `boroko-${presetLabel}-export-${rangeLabel}-${today}${privacyLabel}.xlsx`,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
      })
      if (canceled || !filePath) return { canceled: true }
      const sender = event.sender
      return await exportAllDataWorkbookToPath(filePath, {
        ...normalized,
        onProgress: (progress) => {
          try { sender.send('data:exportProgress', progress) } catch {}
        }
      })
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
    const deviceName = String(options?.deviceName || '').trim()
    const silent = options?.silent === true && !!deviceName
    return await new Promise((resolve) => {
      win.webContents.print({
        silent,
        deviceName: deviceName || undefined,
        printBackground: true,
        margins: { marginType: 'none' }
      }, (success, failureReason) => {
        resolve(success ? { success: true } : { success: false, error: failureReason || 'Print failed.' })
      })
    })
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
  ipcMain.handle('pos:getTabs', async () => {
    try { await requireCapability('pos.view'); return await db.getPosTabs() }
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
  ipcMain.handle('pos:getTablesWithStatus', async (_, outletId) => {
    try { await requireCapability('pos.view'); return await db.getPosTablesWithStatus(outletId || null) }
    catch { return [] }
  })
  ipcMain.handle('pos:getActiveTableTab', async (_, tableName, outletId) => {
    try { await requireCapability('pos.view'); return await db.getActivePosTableTab(tableName, outletId || null) }
    catch { return null }
  })
  ipcMain.handle('pos:openTableSession', async (_, data) => {
    try {
      await requireCapability('pos.manage')
      const outletFilter = db.getUserPosOutletFilter()
      if (outletFilter !== null && data?.outlet_id && !outletFilter.includes(data.outlet_id)) {
        return { success: false, error: 'Access denied: you do not have access to this outlet.' }
      }
      return await db.openPosTableSession(data || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getTables', async () => {
    try { await requireCapability('pos.view'); return await db.getPosTables() }
    catch { return [] }
  })
  ipcMain.handle('pos:saveTable', async (_, data) => {
    try {
      await requireCapability('pos.view')
      const outletFilter = db.getUserPosOutletFilter()
      if (outletFilter !== null && data?.outlet_id && !outletFilter.includes(data.outlet_id)) {
        return { success: false, error: 'Access denied: you do not have access to this outlet.' }
      }
      return await db.savePosTable(data || {})
    } catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:deleteTable', async (_, id) => {
    try { await requireCapability('pos.view'); return await db.deletePosTable(id) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getTickets', async (_, filters) => {
    try { await requireCapability('pos.view'); return await db.getPosTickets(filters || {}) }
    catch { return [] }
  })
  ipcMain.handle('pos:updateTicketStatus', async (_, id, status) => {
    try { await requireCapability('pos.manage'); return await db.updatePosTicketStatus(id, status) }
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
    try { await requireCapability('pos.view'); return await db.testPosHardware(kind || 'receipt') }
    catch (e) { return { success: false, error: e.message } }
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
    try { await requireCapability('pos.view'); return await db.getPosFloorLayout() }
    catch { return { areas: [] } }
  })
  ipcMain.handle('pos:saveFloorLayout', async (_, data) => {
    try { await requireCapability('pos.manage'); return await db.savePosFloorLayout(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:updateCustomerDisplay', async (_, data) => {
    try { await requireCapability('pos.view'); return await db.updatePosCustomerDisplay(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getCustomerDisplay', async () => {
    try { await requireCapability('pos.view'); return await db.getPosCustomerDisplay() }
    catch { return null }
  })
  ipcMain.handle('pos:sendPaymentTerminalTotal', async (_, data) => {
    try { await requireCapability('pos.view'); return await db.sendPaymentTerminalTotal(data || {}) }
    catch (e) { return { success: false, error: e.message } }
  })
  ipcMain.handle('pos:getAuditLog', async (_, limit) => {
    try { await requireCapability('pos.view'); return await db.getPosAuditLog(limit || 100) }
    catch { return [] }
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
      throw new Error(e?.message || 'Could not load inventory items right now.')
    }
  })
  ipcMain.handle('users:sendInvite', async (_, id) => {
    try {
      await requireCapability('staff.manage')
      await assertResourceBelongsToCurrentLodge('User', id, db.getUserById)
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
  ipcMain.handle('inventory:adjustStock', async (_, itemId, delta, notes, managerPin) => {
    try {
      await requireCapability('inventory.manage')
      await assertResourceBelongsToCurrentLodge('Inventory item', itemId, db.getInventoryItemById)
      return await db.adjustInventoryStock(itemId, delta, notes, managerPin)
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
        defaultPath: buildReportExportFilename({ prefix: 'boroko', reportTitle, period, extension: 'xlsx' }),
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
      })
      if (canceled || !filePath) return { success: false }

      const currency = payload.currency || 'P'
      const allocations = Array.isArray(payload.allocations) ? payload.allocations : []
      const byRoom = Array.isArray(payload.byRoom) ? payload.byRoom : []
      const byItem = Array.isArray(payload.byItem) ? payload.byItem : []
      const grandTotal = Number(payload.grandTotal || 0)
      const resolvedLodge = payload.lodgeName || payload.companyName || 'Boroko Lodge'
      const resolvedCompany = payload.companyName && payload.companyName !== resolvedLodge ? payload.companyName : ''
      const generatedAt = payload.generatedAt || new Date().toLocaleString()

      const wb = XLSX.utils.book_new()

      const summaryRows = [
        [`${resolvedLodge} — ${reportTitle}`],
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
        defaultPath: buildReportExportFilename({ prefix: 'boroko', reportTitle, period, extension: 'pdf' }),
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return { success: false }

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
        await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        const pdfBuffer = await pdfWindow.webContents.printToPDF({
          pageSize: 'A4',
          printBackground: true,
          margins: { marginType: 'default' }
        })
        fs.writeFileSync(filePath, pdfBuffer)
        return { success: true, filePath }
      } finally {
        if (!pdfWindow.isDestroyed()) pdfWindow.destroy()
      }
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
  ipcMain.handle('conference:updatePayment', async (_, id, amount, method, intentKey) => {
    await requireCapability('payments.record')
    await assertResourceBelongsToCurrentLodge('Conference booking', id, db.getConferenceBookingById)
    return await db.updateConferenceBookingPayment(id, amount, method, 'payment', null, intentKey)
  })

  // ── Day Use Entries ───────────────────────────────────────────────────────
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
      defaultPath: buildReportExportFilename({ prefix: 'boroko', reportTitle, period: date, extension: 'xlsx' }),
      filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return { success: false }
    try {
      const wb = XLSX.utils.book_new()
      const sym = currency || 'P'
      const safeData = data || {}
      const resolvedLodge = lodgeName || companyName || 'Boroko Lodge'
      const sharedMeta = {
        lodgeName: resolvedLodge,
        companyName,
        periodLabel: date ? `Date: ${date}` : '',
        generatedAt
      }

      // 1. Summary
      const summaryRows = [
        [`${resolvedLodge} — Night Audit Summary`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['Category', 'Count', `Revenue (${sym})`],
        ['Check-ins Today', (safeData.check_ins || []).length, '—'],
        ['Check-outs Today', (safeData.check_outs || []).length, '—'],
        ['New Bookings Created', (safeData.new_bookings || []).length, '—'],
        ['POS Orders Completed', (safeData.pos_orders || []).length, Number(safeData.pos_revenue || 0).toFixed(2)],
        ['Outstanding Balances', (safeData.outstanding || []).length, Number(safeData.outstanding_total || 0).toFixed(2)]
      ]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')

      // 2. Check-ins
      const checkinRows = [
        [`${resolvedLodge} — Check-ins`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['#', 'Guest', 'Room', 'Type', 'Adults', 'Children', `Total (${sym})`, `Paid (${sym})`, 'Status']
      ]
      ;(safeData.check_ins || []).forEach((b) => {
        const roomDisp = b._event_group ? `${b.room_count} rooms` : (b.room_number ? `Room ${b.room_number}` : '—')
        checkinRows.push([
          b.booking_number || '—', b.customer_name, roomDisp, b.room_type || '—',
          b.adults, b.children, Number(b.total_amount || 0).toFixed(2), Number(b.amount_paid || 0).toFixed(2), b.payment_status
        ])
      })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(checkinRows), 'Check-ins')

      // 3. Check-outs
      const checkoutRows = [
        [`${resolvedLodge} — Check-outs`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['#', 'Guest', 'Room', 'Type', 'Adults', 'Children', `Total (${sym})`, `Paid (${sym})`, 'Status']
      ]
      ;(safeData.check_outs || []).forEach((b) => {
        const roomDisp = b._event_group ? `${b.room_count} rooms` : (b.room_number ? `Room ${b.room_number}` : '—')
        checkoutRows.push([
          b.booking_number || '—', b.customer_name, roomDisp, b.room_type || '—',
          b.adults, b.children, Number(b.total_amount || 0).toFixed(2), Number(b.amount_paid || 0).toFixed(2), b.payment_status
        ])
      })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(checkoutRows), 'Check-outs')

      // 4. New Bookings
      const newBookRows = [
        [`${resolvedLodge} — New Bookings`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['#', 'Guest', 'Room', 'Check-in', 'Check-out', `Total (${sym})`, 'Status']
      ]
      ;(safeData.new_bookings || []).forEach((b) => {
        const roomDisp = b._event_group ? `${b.room_count} rooms` : (b.room_number ? `Room ${b.room_number}` : '—')
        newBookRows.push([
          b.booking_number || '—', b.customer_name, roomDisp, b.check_in, b.check_out,
          Number(b.total_amount || 0).toFixed(2), b.status
        ])
      })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(newBookRows), 'New Bookings')

      // 5. POS
      const posRows = [
        [`${resolvedLodge} — POS Orders`],
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
        [`${resolvedLodge} — Outstanding Balances`],
        ...buildWorkbookMetaRows(sharedMeta),
        ['#', 'Guest', 'Room', 'Check-in', 'Check-out', `Total (${sym})`, `Paid (${sym})`, `Balance (${sym})`]
      ]
      ;(safeData.outstanding || []).forEach((b) => {
        const balance = Math.max(0, Number(b.total_amount || 0) + Number(b.charges_total || 0) - Number(b.amount_paid || 0))
        const roomDisp = b._event_group ? `${b.room_count} rooms` : (b.room_number ? `Room ${b.room_number}` : '—')
        outstandingRows.push([
          b.booking_number || '—', b.customer_name, roomDisp, b.check_in, b.check_out,
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
    try { return await Promise.resolve(db.getSyncStatus()) }
    catch { return { pending: 0, failed: 0, isOnline: false } }
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

  // ── Data Import (Excel) ───────────────────────────────────────────────────
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
      defaultPath: `boroko-import-issues-${new Date().toISOString().slice(0, 10)}.xlsx`,
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
      expenses: { 'Date': '2026-04-23', 'Category': 'Repairs', 'Description': 'Plumbing repair', 'Amount': 450, 'Paid By': 'Cash' }
    }
    const wb = buildImportTemplateWorkbook({
      type: String(type || 'bookings'),
      fields,
      sample: samples[type] || samples.bookings
    })
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Import Template',
      defaultPath: `boroko-${String(type || 'bookings')}-import-template.xlsx`,
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
    if (is.dev) return { success: true, updateAvailable: false, dev: true }
    try {
      setUpdateState({ phase: 'checking', error: '' })
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
      title: payload?.title || 'Boroko Bookings',
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
  ipcMain.handle('app:logRendererError', async (_, payload) => appendRendererErrorLog(payload || {}))
  ipcMain.handle('app:getRendererErrors', async (_, limit) => getRendererErrorLog(limit))
  ipcMain.handle('app:clearRendererErrors', async () => clearRendererErrorLog())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
