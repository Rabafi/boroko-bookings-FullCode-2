// @ts-check
/**
 * Unattended Bar trading recovery backups.
 *
 * Mirrors the accepted Starter automation contract: safeStorage-held
 * passphrase, lodge-scoped config/status/runs under the cache root, a
 * lodge+window run lock, verify-after-write, retryable failure status and
 * bounded retention. Unlike the Starter weekly job, Bar trading data is
 * local-first, so an offline terminal still captures (and records that the
 * capture happened offline). Archives that omit renderer-owned draft state
 * stay explicitly incomplete instead of silently passing as complete.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { randomUUID } from 'crypto'
import { state } from '../state.js'
import {
  buildBarTradingSnapshot,
  buildBarTradingPackageName,
  writeBarTradingPackageToPath,
  applyBarTradingRetention,
  getBarTradingBackupHealth
} from './barTradingBackup.js'

const AUTOMATION_CONFIG_VERSION = 1
const DEFAULT_INTERVAL_HOURS = 24
const MIN_INTERVAL_HOURS = 1
const MAX_INTERVAL_HOURS = 168
const SNOOZE_MS = 24 * 60 * 60 * 1000
const RUN_LOCK_STALE_MS = 6 * 60 * 60 * 1000
const DEFAULT_RETENTION = Object.freeze({ hourly: 24, daily: 7, weekly: 4 })

// Electron exposes this as a named API in the main process, while Node's
// headless test loader exposes the CommonJS module through its default export.
import electron from 'electron'
const { safeStorage } = electron || {}

function canUseSafeStorage() {
  try { return Boolean(safeStorage?.isEncryptionAvailable?.()) } catch { return false }
}

function encryptWithSafeStorage(value) {
  if (!canUseSafeStorage()) throw new Error('OS secure storage is unavailable.')
  return safeStorage.encryptString(String(value)).toString('base64')
}

function decryptWithSafeStorage(b64) {
  if (!canUseSafeStorage()) throw new Error('OS secure storage is unavailable.')
  return safeStorage.decryptString(Buffer.from(String(b64), 'base64'))
}

function getAutomationRoot(lodgeId) {
  const base = String(state.cacheRootDir || state.cacheDir || '').trim() || String(process.env.APPDATA || process.cwd())
  const safeLodge = String(lodgeId || state.lodgeId || 'unknown-lodge').replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(base, 'bar-trading-backup-automation', safeLodge)
}

function getConfigPath(lodgeId) { return path.join(getAutomationRoot(lodgeId), 'automation-config.json') }
function getStatusPath(lodgeId) { return path.join(getAutomationRoot(lodgeId), 'automation-status.json') }
function getRunsPath(lodgeId) { return path.join(getAutomationRoot(lodgeId), 'runs.json') }
function getCredentialPath(lodgeId) { return path.join(getAutomationRoot(lodgeId), 'automation-credential.json') }

function resolveNow(options = {}) {
  if (options.now instanceof Date) return new Date(options.now.getTime())
  if (options.nowMs !== undefined) return new Date(Number(options.nowMs))
  if (options.now !== undefined) return new Date(String(options.now))
  return new Date()
}

function nowIso(options = {}) {
  const value = resolveNow(options)
  return Number.isFinite(value.getTime()) ? value.toISOString() : new Date().toISOString()
}

function resolveLodgeId(candidate) {
  const requested = String(candidate || '').trim()
  // state.lodgeId is the authoritative active-lodge context; an explicit
  // candidate that contradicts it fails closed instead of silently retargeting.
  const active = String(state.lodgeId || '').trim()
  if (active && requested && active !== requested) {
    throw new Error('This backup action is limited to the active lodge.')
  }
  const lodgeId = active || requested
  if (!lodgeId) throw new Error('An active lodge profile is required for Bar trading backup automation.')
  return lodgeId
}

function fsyncFile(filePath) {
  try {
    const handle = fs.openSync(filePath, 'r+')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  } catch {}
}

function fsyncDir(dirPath) {
  try {
    const handle = fs.openSync(dirPath, 'r')
    try { fs.fsyncSync(handle) } finally { fs.closeSync(handle) }
  } catch {}
}

function writeAtomicJson(filePath, data) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${filePath}.${randomUUID()}.tmp`
  const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
  fs.writeFileSync(tmp, bytes, { flag: 'wx' })
  fsyncFile(tmp)
  fs.renameSync(tmp, filePath)
  fsyncDir(dir)
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch { return fallback }
}

function readAutomationConfig(lodgeId) {
  return readJson(getConfigPath(lodgeId), null)
}

function normalizeRetention(payload = {}) {
  const retention = payload.retention && typeof payload.retention === 'object' ? payload.retention : payload
  const pick = (value, fallback) => {
    const number = Number(value)
    return Number.isFinite(number) ? Math.min(Math.max(Math.trunc(number), 1), 500) : fallback
  }
  return {
    hourly: pick(retention.retention_hourly ?? retention.hourly, DEFAULT_RETENTION.hourly),
    daily: pick(retention.retention_daily ?? retention.daily, DEFAULT_RETENTION.daily),
    weekly: pick(retention.retention_weekly ?? retention.weekly, DEFAULT_RETENTION.weekly)
  }
}

function normalizeIntervalHours(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_INTERVAL_HOURS
  return Math.min(Math.max(number, MIN_INTERVAL_HOURS), MAX_INTERVAL_HOURS)
}

function readAutomationStatus(lodgeId) {
  return readJson(getStatusPath(lodgeId), {
    lodge_id: lodgeId || state.lodgeId || null,
    last_success_at: null,
    last_success_sha256: null,
    last_success_destination: null,
    last_verified_at: null,
    last_complete: null,
    last_unresolved_count: null,
    captured_offline: null,
    next_due_at: null,
    last_failure_at: null,
    last_failure_reason: null,
    snoozed_until: null,
    automation_capability: 'pos_manage'
  })
}

function readRuns(lodgeId) {
  const runs = readJson(getRunsPath(lodgeId), [])
  return Array.isArray(runs) ? runs : []
}

function writeRuns(lodgeId, runs) {
  writeAtomicJson(getRunsPath(lodgeId), runs.slice(0, 50))
}

function storePassphrase(lodgeId, passphrase) {
  if (!canUseSafeStorage()) throw new Error('OS secure storage is unavailable. Enable the operating system secure-storage provider, then set up automation again.')
  const value = String(passphrase || '')
  if (value.length < 12) throw new Error('Use an encryption passphrase with at least 12 characters.')
  if (value.length > 1024) throw new Error('The encryption passphrase is too long.')
  const envelope = { _encrypted: true, v: 1, alg: 'electron-safeStorage', data: encryptWithSafeStorage(value) }
  writeAtomicJson(getCredentialPath(lodgeId), envelope)
}

function retrievePassphrase(lodgeId) {
  if (!canUseSafeStorage()) throw new Error('OS secure storage is unavailable.')
  const envelope = readJson(getCredentialPath(lodgeId), null)
  if (!envelope || envelope._encrypted !== true || envelope.alg !== 'electron-safeStorage' || typeof envelope.data !== 'string') {
    throw new Error('Automation credential not found. Reconfigure the scheduled recovery backup and enter the passphrase again.')
  }
  try {
    return decryptWithSafeStorage(envelope.data)
  } catch { throw new Error('Automation credential could not be decrypted. Reconfigure the scheduled recovery backup.') }
}

function clearCredential(lodgeId) {
  try { fs.unlinkSync(getCredentialPath(lodgeId)) } catch {}
}

function assertDestinationFolder(destinationFolder, { probe = true } = {}) {
  const target = path.resolve(String(destinationFolder || '').trim())
  if (!target) throw new Error('Choose a destination folder for scheduled recovery backups.')
  try {
    const stat = fs.statSync(target)
    if (!stat.isDirectory()) throw new Error('The configured recovery destination is not a folder.')
    fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK)
    if (probe) {
      const probePath = path.join(target, `.bar-trading-write-test-${randomUUID()}.tmp`)
      fs.writeFileSync(probePath, 'probe', { flag: 'wx' })
      fsyncFile(probePath)
      fs.unlinkSync(probePath)
      fsyncDir(target)
    }
  } catch (error) {
    if (error?.message === 'The configured recovery destination is not a folder.') throw error
    const code = error?.code || 'unavailable'
    throw new Error(`The configured recovery destination is unavailable or not writable. Choose another folder. (${code})`)
  }
  return target
}

function acquireRunLock(lodgeId, windowId, options = {}) {
  const safeWindowId = String(windowId || 'default-window').replace(/[^a-zA-Z0-9_-]/g, '_')
  const lockPath = path.join(getAutomationRoot(lodgeId), `run-${safeWindowId}.lock`)
  const nowMs = resolveNow(options).getTime()
  const staleAfterMs = Number(options.staleAfterMs || RUN_LOCK_STALE_MS)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true })
      fs.writeFileSync(lockPath, JSON.stringify({ lodge_id: lodgeId, window_id: String(windowId), pid: process.pid, started_at: nowIso(options) }) + '\n', { flag: 'wx' })
      fsyncFile(lockPath)
      fsyncDir(path.dirname(lockPath))
      return lockPath
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let stale = false
      try {
        const stat = fs.statSync(lockPath)
        stale = Number.isFinite(nowMs) && nowMs - stat.mtimeMs >= staleAfterMs
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue
      }
      if (stale) {
        try { fs.unlinkSync(lockPath); fsyncDir(path.dirname(lockPath)); continue } catch {}
      }
      throw new Error('EEXIST: a recovery backup for this lodge and window is already running.')
    }
  }
  throw new Error('A recovery backup for this lodge and window is already running.')
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath) } catch {}
}

function computeNextDue(lastSuccessAt, intervalHours, nowValue = new Date()) {
  if (!lastSuccessAt) return new Date(nowValue).toISOString()
  const base = new Date(lastSuccessAt).getTime()
  if (!Number.isFinite(base)) return new Date(nowValue).toISOString()
  return new Date(base + Number(intervalHours) * 60 * 60 * 1000).toISOString()
}

function isDue(status, intervalHours, nowMs) {
  if (!status.last_success_at) return true
  const due = new Date(status.next_due_at || computeNextDue(status.last_success_at, intervalHours)).getTime()
  if (!Number.isFinite(due)) return true
  return nowMs >= due
}

function isSnoozed(status, nowMs) {
  if (!status.snoozed_until) return false
  const until = new Date(status.snoozed_until).getTime()
  return Number.isFinite(until) && nowMs < until
}

export function getBarTradingBackupAutomationStatus(lodgeIdOverride, options = {}) {
  const lodgeId = resolveLodgeId(lodgeIdOverride)
  const config = readAutomationConfig(lodgeId)
  const status = readAutomationStatus(lodgeId)
  const runs = readRuns(lodgeId)
  const nowMs = resolveNow(options).getTime()
  const intervalHours = config ? normalizeIntervalHours(config.interval_hours) : DEFAULT_INTERVAL_HOURS
  const targetDir = config ? String(config.destination_folder || '') : ''
  const health = targetDir || config
    ? getBarTradingBackupHealth({ targetDir, lodgeId, cacheDir: state.cacheDir, now: resolveNow(options) })
    : getBarTradingBackupHealth({ targetDir: '', lodgeId, cacheDir: state.cacheDir, now: resolveNow(options) })
  return {
    success: true,
    lodge_id: lodgeId,
    enabled: config ? config.enabled === true : false,
    config: config
      ? {
          destination_folder: config.destination_folder,
          destination_label: config.destination_label,
          interval_hours: intervalHours,
          retention: { hourly: config.retention_hourly, daily: config.retention_daily, weekly: config.retention_weekly },
          created_at: config.created_at,
          updated_at: config.updated_at
        }
      : null,
    // Never expose passphrase or credential material.
    status: {
      last_success_at: status.last_success_at,
      last_success_sha256: status.last_success_sha256,
      last_success_destination: status.last_success_destination,
      last_verified_at: status.last_verified_at,
      last_complete: status.last_complete,
      last_unresolved_count: status.last_unresolved_count,
      captured_offline: status.captured_offline,
      next_due_at: status.next_due_at || computeNextDue(status.last_success_at, intervalHours, resolveNow(options)),
      last_failure_at: status.last_failure_at,
      last_failure_reason: status.last_failure_reason,
      snoozed_until: status.snoozed_until,
      state: !config || config.enabled !== true
        ? 'disabled'
        : isSnoozed(status, nowMs)
          ? 'snoozed'
          : !status.last_success_at
            // A recorded failure with no success yet is a retryable "due", not
            // a misleading "never attempted".
            ? (status.last_failure_at ? 'due' : 'never')
            : isDue(status, intervalHours, nowMs)
              ? 'due'
              : 'current'
    },
    health,
    latest_run: runs[0] || null,
    runs: runs.slice(0, 10)
  }
}

export function configureBarTradingBackupAutomation(payload = {}) {
  const lodgeId = resolveLodgeId(payload.lodge_id || payload.lodgeId)
  const destinationFolder = String(payload.destination_folder || payload.destinationFolder || '').trim()
  if (!destinationFolder) throw new Error('Choose a destination folder for scheduled recovery backups.')
  const passphrase = String(payload.passphrase || '')
  const confirmPassphrase = String(payload.confirm_passphrase || payload.confirmPassphrase || '')
  if (passphrase.length < 12) throw new Error('Use an encryption passphrase with at least 12 characters.')
  if (confirmPassphrase && passphrase !== confirmPassphrase) throw new Error('Passphrase confirmation does not match.')
  const automationEnabled = payload.enabled !== false
  if (!canUseSafeStorage()) throw new Error('OS secure storage is unavailable. Enable the operating system secure-storage provider before configuring automation.')
  // A missing destination is an operator error, not a reason to create a new
  // folder silently. This also makes a moved/disconnected backup drive visible.
  const normalizedDestinationFolder = assertDestinationFolder(destinationFolder)
  const destinationLabel = payload.destination_label || payload.destinationLabel || path.basename(normalizedDestinationFolder) || normalizedDestinationFolder
  const retention = normalizeRetention(payload)
  const previousConfig = readAutomationConfig(lodgeId)
  const previousCredential = readJson(getCredentialPath(lodgeId), null)
  const config = {
    version: AUTOMATION_CONFIG_VERSION,
    lodge_id: lodgeId,
    destination_folder: normalizedDestinationFolder,
    destination_label: String(destinationLabel).slice(0, 128),
    interval_hours: normalizeIntervalHours(payload.interval_hours ?? payload.intervalHours),
    retention_hourly: retention.hourly,
    retention_daily: retention.daily,
    retention_weekly: retention.weekly,
    enabled: automationEnabled,
    created_at: previousConfig?.created_at || nowIso(payload),
    updated_at: nowIso(payload),
    automation_capability: 'pos_manage'
  }
  // Store the secret first. If enabling the config fails, restore the previous
  // pair (or leave automation disabled) so an enabled config can never exist
  // without a usable credential.
  storePassphrase(lodgeId, passphrase)
  try {
    writeAtomicJson(getConfigPath(lodgeId), config)
  } catch (error) {
    try {
      if (previousCredential && previousCredential._encrypted === true) writeAtomicJson(getCredentialPath(lodgeId), previousCredential)
      else clearCredential(lodgeId)
      if (previousConfig) writeAtomicJson(getConfigPath(lodgeId), previousConfig)
      else writeAtomicJson(getConfigPath(lodgeId), { ...config, enabled: false, updated_at: nowIso(payload) })
    } catch {}
    throw new Error(`Recovery backup automation could not be enabled safely. ${error?.message || 'Try again.'}`)
  }
  const currentStatus = readAutomationStatus(lodgeId)
  if (!currentStatus.lodge_id) {
    writeAtomicJson(getStatusPath(lodgeId), {
      lodge_id: lodgeId,
      last_success_at: null,
      last_success_sha256: null,
      last_success_destination: null,
      last_verified_at: null,
      last_complete: null,
      last_unresolved_count: null,
      captured_offline: null,
      next_due_at: nowIso(payload),
      last_failure_at: null,
      last_failure_reason: null,
      snoozed_until: null
    })
  }
  return {
    success: true,
    lodge_id: lodgeId,
    config: {
      destination_folder: config.destination_folder,
      destination_label: config.destination_label,
      interval_hours: config.interval_hours,
      enabled: config.enabled
    }
  }
}

export function disableBarTradingBackupAutomation(lodgeIdOverride) {
  const lodgeId = resolveLodgeId(lodgeIdOverride)
  const config = readAutomationConfig(lodgeId)
  if (!config) return { success: true, disabled: true }
  config.enabled = false
  config.updated_at = nowIso()
  writeAtomicJson(getConfigPath(lodgeId), config)
  clearCredential(lodgeId)
  return { success: true, disabled: true }
}

export function snoozeBarTradingBackupAutomation(lodgeIdOverride, options = {}) {
  const lodgeId = resolveLodgeId(lodgeIdOverride)
  const status = readAutomationStatus(lodgeId)
  status.snoozed_until = new Date(resolveNow(options).getTime() + SNOOZE_MS).toISOString()
  writeAtomicJson(getStatusPath(lodgeId), status)
  return { success: true, snoozed_until: status.snoozed_until }
}

export function clearBarTradingBackupAutomationSnooze(lodgeIdOverride) {
  const lodgeId = resolveLodgeId(lodgeIdOverride)
  const status = readAutomationStatus(lodgeId)
  status.snoozed_until = null
  writeAtomicJson(getStatusPath(lodgeId), status)
  return { success: true }
}

function retentionEntriesFromRuns(destinationFolder, lodgeId, runs) {
  const root = path.resolve(String(destinationFolder || '').trim())
  const entries = []
  for (const entry of Array.isArray(runs) ? runs : []) {
    if (!entry || entry.state !== 'verified') continue
    const fileName = String(entry.fileName || '')
    if (!fileName) continue
    const full = path.join(root, fileName)
    if (path.dirname(path.resolve(full)) !== root) continue
    try {
      const stat = fs.statSync(full)
      if (!stat.isFile()) continue
      entries.push({
        fileName,
        path: full,
        bytes: stat.size,
        createdAt: String(entry.finished_at || stat.mtime.toISOString()),
        verified: true,
        unresolvedIds: Array.isArray(entry.unresolved_ids) ? entry.unresolved_ids : []
      })
    } catch {}
  }
  return entries
}

export async function runBarTradingBackupAutomationOnce(options = {}) {
  const lodgeId = resolveLodgeId(options.lodgeId)
  const now = resolveNow(options)
  const nowMs = now.getTime()
  const config = readAutomationConfig(lodgeId)
  if (!config || config.enabled !== true) throw new Error('Scheduled recovery backups are not enabled for this lodge. Complete setup first.')
  const status = readAutomationStatus(lodgeId)
  const intervalHours = normalizeIntervalHours(config.interval_hours)
  if (isSnoozed(status, nowMs)) throw new Error('The scheduled recovery backup is snoozed. Clear the snooze or wait until it expires.')
  if (!isDue(status, intervalHours, nowMs) && !options.force) throw new Error('A scheduled recovery backup is not yet due.')

  const dependencies = options.dependencies || {}
  const writePackage = dependencies.writePackage || writeBarTradingPackageToPath
  const buildSnapshot = dependencies.buildSnapshot || buildBarTradingSnapshot
  const getPassphrase = dependencies.retrievePassphrase || retrievePassphrase
  const collectRendererState = dependencies.collectRendererState || null
  const applyRetention = dependencies.applyRetention || applyBarTradingRetention
  const pruneEnabled = dependencies.disableRetention !== true

  const destinationFolder = path.resolve(String(config.destination_folder || '').trim())
  const windowId = `window-${now.toISOString().slice(0, 13)}`
  const runId = randomUUID()
  const lockPath = acquireRunLock(lodgeId, windowId, { now })
  const runRecord = { run_id: runId, window_id: windowId, lodge_id: lodgeId, started_at: now.toISOString(), state: 'started' }
  const fileName = buildBarTradingPackageName(lodgeId, now)
  const filePath = path.join(destinationFolder, fileName)
  let artifactVerified = false
  try {
    // A disconnected/moved destination must be visible before any capture work.
    assertDestinationFolder(destinationFolder)
    writeRuns(lodgeId, [runRecord, ...readRuns(lodgeId)])

    // Renderer-owned draft state: collected when the caller supplies a seam.
    // A missing seam or a failing collector is disclosed, never silently
    // claimed as covered.
    let rendererState = null
    let rendererCollectionError = null
    if (collectRendererState) {
      try { rendererState = await collectRendererState() } catch (error) { rendererCollectionError = error?.message || 'renderer_state_collection_failed' }
    }

    let snapshot = buildSnapshot({
      lodgeId,
      cacheDir: state.cacheDir,
      now: now.toISOString(),
      appVersion: options.appVersion,
      rendererState: rendererState || undefined,
      expectRendererState: true
    })
    // Concurrent till writes are normal traffic, not corruption: retry the
    // coherent snapshot once before failing the window closed.
    if (Array.isArray(snapshot.drift) && snapshot.drift.length > 0) {
      snapshot = buildSnapshot({
        lodgeId,
        cacheDir: state.cacheDir,
        now: new Date().toISOString(),
        appVersion: options.appVersion,
        rendererState: rendererState || undefined,
        expectRendererState: true
      })
    }
    if (Array.isArray(snapshot.drift) && snapshot.drift.length > 0) {
      throw new Error(`The trading snapshot was not coherent (${snapshot.drift.join(', ')} changed during capture). The scheduled backup will retry.`)
    }

    const passphrase = getPassphrase(lodgeId)
    assertDestinationFolder(destinationFolder)
    const result = writePackage(filePath, snapshot, { passphrase })
    artifactVerified = true

    runRecord.finished_at = now.toISOString()
    runRecord.state = 'verified'
    runRecord.destination = result.destination
    runRecord.fileName = result.fileName
    runRecord.sha256 = result.sha256
    runRecord.complete = result.complete === true
    runRecord.unresolved_ids = Array.isArray(snapshot.unresolved?.identities) ? snapshot.unresolved.identities : []
    runRecord.unresolved_count = snapshot.unresolved?.count || 0
    runRecord.captured_offline = options.isOnline === undefined ? !state.isOnline : !options.isOnline
    if (rendererCollectionError) runRecord.renderer_collection_error = rendererCollectionError

    status.last_success_at = now.toISOString()
    status.last_success_sha256 = result.sha256
    status.last_success_destination = result.destination
    status.last_verified_at = now.toISOString()
    status.last_complete = result.complete === true
    status.last_unresolved_count = runRecord.unresolved_count
    status.captured_offline = runRecord.captured_offline
    status.next_due_at = computeNextDue(status.last_success_at, intervalHours, now)
    status.last_failure_at = null
    status.last_failure_reason = null
    status.snoozed_until = null
    writeAtomicJson(getStatusPath(lodgeId), status)
    writeRuns(lodgeId, [runRecord, ...readRuns(lodgeId).filter((entry) => entry.run_id !== runId)])

    let retention = null
    if (pruneEnabled) {
      try {
        const entries = retentionEntriesFromRuns(destinationFolder, lodgeId, readRuns(lodgeId).filter((entry) => entry.run_id !== runId || entry.state === 'verified'))
        retention = applyRetention(destinationFolder, entries, {
          now: now.toISOString(),
          hourly: config.retention_hourly,
          daily: config.retention_daily,
          weekly: config.retention_weekly
        })
      } catch (error) {
        // Retention is maintenance; a prune failure must never invalidate a
        // verified archive. It is recorded for the next run instead.
        retention = { deleted: [], kept: [], error: error?.message || 'retention_failed' }
      }
    }

    return {
      success: true,
      lodge_id: lodgeId,
      destination: result.destination,
      fileName: result.fileName,
      sha256: result.sha256,
      complete: result.complete === true,
      unresolved_count: runRecord.unresolved_count,
      captured_offline: runRecord.captured_offline,
      next_due_at: status.next_due_at,
      retention
    }
  } catch (error) {
    runRecord.finished_at = now.toISOString()
    runRecord.state = 'failed'
    runRecord.error = error?.message || 'Scheduled recovery backup failed.'
    if (!artifactVerified) {
      try { fs.unlinkSync(filePath) } catch {}
    }
    try { writeRuns(lodgeId, [runRecord, ...readRuns(lodgeId).filter((entry) => entry.run_id !== runId)]) } catch {}
    try {
      status.last_failure_at = runRecord.finished_at
      status.last_failure_reason = runRecord.error
      status.next_due_at = runRecord.finished_at
      writeAtomicJson(getStatusPath(lodgeId), status)
    } catch {}
    throw new Error(runRecord.error)
  } finally {
    releaseLock(lockPath)
  }
}

export function evaluateBarTradingBackupAutomationDueAtStartup(lodgeIdOverride, options = {}) {
  let lodgeId
  try { lodgeId = resolveLodgeId(lodgeIdOverride) } catch { return { due: false, reason: 'wrong_lodge' } }
  const config = readAutomationConfig(lodgeId)
  if (!config || config.enabled !== true) return { due: false, reason: 'disabled' }
  const status = readAutomationStatus(lodgeId)
  const nowMs = resolveNow(options).getTime()
  const intervalHours = normalizeIntervalHours(config.interval_hours)
  if (isSnoozed(status, nowMs)) return { due: false, reason: 'snoozed', snoozed_until: status.snoozed_until }
  if (isDue(status, intervalHours, nowMs)) {
    return { due: true, reason: 'due', last_success_at: status.last_success_at, next_due_at: status.next_due_at || computeNextDue(status.last_success_at, intervalHours, resolveNow(options)) }
  }
  return { due: false, reason: 'not_yet_due', next_due_at: status.next_due_at || computeNextDue(status.last_success_at, intervalHours, resolveNow(options)) }
}

// Health/readiness reads the configured trading target from the automation
// config (the single operator-facing source of truth). Never throws so the
// health payload stays renderable when no lodge/config exists yet.
export function readBarTradingBackupAutomationTargetForHealth() {
  try {
    const lodgeId = String(state.lodgeId || '').trim()
    if (!lodgeId) return ''
    const config = readAutomationConfig(lodgeId)
    return config && typeof config.destination_folder === 'string' ? config.destination_folder : ''
  } catch { return '' }
}

// Staged restores live beside the automation state for the active lodge so a
// later app session can resume/activate the same operation id.
export function getBarTradingRestoreStagingRoot(lodgeIdOverride) {
  const lodgeId = resolveLodgeId(lodgeIdOverride)
  return path.join(getAutomationRoot(lodgeId), 'restore-staging')
}

// Kept intentionally small and side-effect free for focused main-process tests.
// These are not part of the renderer/database public facade.
export const __barTradingBackupAutomationTestables = {
  acquireRunLock,
  releaseLock,
  resolveLodgeId,
  assertDestinationFolder,
  computeNextDue,
  isDue,
  normalizeRetention,
  normalizeIntervalHours,
  getAutomationRoot,
  getConfigPath,
  getStatusPath,
  getRunsPath,
  getCredentialPath,
  writeAtomicJson,
  readJson
}
