import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { randomUUID } from 'crypto'
import { state } from '../state.js'
import { writeStarterBackupToPath, verifyStarterBackupAtPath, getStarterBackupHistory, captureBackupContext } from './starterBackup.js'

const AUTOMATION_CONFIG_VERSION = 1
const AUTOMATION_WINDOW_DAYS = 7
const AUTOMATION_MAX_RETAINED = 8 // latest verified + 7 weekly
const SNOOZE_MS = 24 * 60 * 60 * 1000
const RUN_LOCK_STALE_MS = 6 * 60 * 60 * 1000

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
  return path.join(base, 'starter-backup-automation', safeLodge)
}

function getConfigPath(lodgeId) { return path.join(getAutomationRoot(lodgeId), 'automation-config.json') }
function getStatusPath(lodgeId) { return path.join(getAutomationRoot(lodgeId), 'automation-status.json') }
function getRunsPath(lodgeId) { return path.join(getAutomationRoot(lodgeId), 'runs.json') }
function getCredentialPath(lodgeId) { return path.join(getAutomationRoot(lodgeId), 'automation-credential.json') }
function getHistoryPath(lodgeId) { return path.join(getAutomationRoot(lodgeId), 'starter-backup-history.json') }

function resolveNow(options = {}) {
  if (typeof options.clock?.now === 'function') {
    const value = options.clock.now()
    if (value instanceof Date) return new Date(value.getTime())
    if (typeof value === 'number') return new Date(value)
    return new Date(String(value))
  }
  if (options.now instanceof Date) return new Date(options.now.getTime())
  if (options.nowMs !== undefined) return new Date(Number(options.nowMs))
  if (options.now !== undefined) return new Date(String(options.now))
  return new Date()
}

function nowIso(options = {}) {
  const value = resolveNow(options)
  return Number.isFinite(value.getTime()) ? value.toISOString() : new Date().toISOString()
}

function resolveLodgeId(candidate, options = {}) {
  const requested = String(candidate || '').trim()
  // state.lodgeId is the authoritative active-lodge context. The explicit hook is
  // useful to callers that own the context (and to tests), but never overrides state.
  const active = String(state.lodgeId || options.activeLodgeId || '').trim()
  if (active && requested && active !== requested) {
    throw new Error('This backup action is limited to the active lodge.')
  }
  const lodgeId = active || requested
  if (!lodgeId) throw new Error('An active lodge profile is required for backup automation.')
  return lodgeId
}

function assertDestinationFolder(destinationFolder, { probe = true } = {}) {
  const target = path.resolve(String(destinationFolder || '').trim())
  if (!target) throw new Error('Choose a destination folder for scheduled backups.')
  try {
    const stat = fs.statSync(target)
    if (!stat.isDirectory()) throw new Error('The configured backup destination is not a folder.')
    fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK)
    if (probe) {
      const probePath = path.join(target, `.write-test-${randomUUID()}.tmp`)
      fs.writeFileSync(probePath, 'probe', { flag: 'wx' })
      fsyncFile(probePath)
      fs.unlinkSync(probePath)
      fsyncDir(target)
    }
  } catch (error) {
    if (error?.message === 'The configured backup destination is not a folder.') throw error
    const code = error?.code || 'unavailable'
    throw new Error(`The configured backup destination is unavailable or not writable. Choose another folder. (${code})`)
  }
  return target
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

function readAutomationStatus(lodgeId) {
  return readJson(getStatusPath(lodgeId), { lodge_id: lodgeId || state.lodgeId || null, last_success_at: null, last_success_sha256: null, last_success_destination: null, last_verified_at: null, next_due_at: null, last_failure_at: null, last_failure_reason: null, snoozed_until: null, automation_capability: 'starter_backup_automation' })
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
    throw new Error('Automation credential not found. Reconfigure the scheduled backup and enter the passphrase again.')
  }
  try {
    return decryptWithSafeStorage(envelope.data)
  } catch { throw new Error('Automation credential could not be decrypted. Reconfigure the scheduled backup.') }
}

function clearCredential(lodgeId) {
  try { fs.unlinkSync(getCredentialPath(lodgeId)) } catch {}
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
      // Preserve the underlying EEXIST meaning in diagnostics for support logs.
      throw new Error('EEXIST: a backup for this lodge and backup window is already running.')
    }
  }
  throw new Error('A backup for this lodge and backup window is already running.')
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath) } catch {}
}

function computeNextDue(lastSuccessAt, nowValue = new Date()) {
  if (!lastSuccessAt) return new Date(nowValue).toISOString()
  const base = new Date(lastSuccessAt).getTime()
  if (!Number.isFinite(base)) return new Date(nowValue).toISOString()
  return new Date(base + AUTOMATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

function isDue(status, nowMs) {
  if (status.audit_state === 'audit_unconfirmed') return true
  if (!status.last_success_at) return true
  const due = new Date(status.next_due_at || computeNextDue(status.last_success_at)).getTime()
  if (!Number.isFinite(due)) return true
  return nowMs >= due
}

function isSnoozed(status, nowMs) {
  if (!status.snoozed_until) return false
  const until = new Date(status.snoozed_until).getTime()
  return Number.isFinite(until) && nowMs < until
}

export function getStarterBackupAutomationStatus(lodgeIdOverride, options = {}) {
  const lodgeId = resolveLodgeId(lodgeIdOverride, options)
  const config = readAutomationConfig(lodgeId)
  const status = readAutomationStatus(lodgeId)
  const history = getStarterBackupHistory(getHistoryPath(lodgeId), { lodgeId })
  const latest = history[0] || null
  // Lodge-scoped history overrides status when the history file is the source of truth.
  const lastVerified = status.last_verified_at
  return {
    success: true,
    lodge_id: lodgeId,
    enabled: config ? config.enabled === true : false,
    config: config ? { destination_folder: config.destination_folder, destination_label: config.destination_label, retained_copies: config.retained_copies || AUTOMATION_MAX_RETAINED, created_at: config.created_at, updated_at: config.updated_at } : null,
    // Never expose passphrase or credential material.
    status: {
      last_success_at: status.last_success_at,
      last_success_sha256: status.last_success_sha256,
      last_success_destination: status.last_success_destination,
      last_verified_at: lastVerified,
      next_due_at: status.next_due_at || computeNextDue(status.last_success_at, resolveNow(options)),
      last_failure_at: status.last_failure_at,
      last_failure_reason: status.last_failure_reason,
      snoozed_until: status.snoozed_until,
      audit_state: status.audit_state || null,
      state: !config || config.enabled !== true ? 'disabled' : !status.last_success_at ? 'never' : isSnoozed(status, resolveNow(options).getTime()) ? 'snoozed' : isDue(status, resolveNow(options).getTime()) ? 'due' : 'current'
    },
    history,
    latest_history_entry: latest
  }
}

export function configureStarterBackupAutomation(payload = {}) {
  const lodgeId = resolveLodgeId(payload.lodge_id || payload.lodgeId, payload)
  const destinationFolder = String(payload.destination_folder || payload.destinationFolder || '').trim()
  if (!destinationFolder) throw new Error('Choose a destination folder for scheduled backups.')
  const passphrase = String(payload.passphrase || '')
  const confirmPassphrase = String(payload.confirm_passphrase || payload.confirmPassphrase || '')
  if (passphrase.length < 12) throw new Error('Use an encryption passphrase with at least 12 characters.')
  if (confirmPassphrase && passphrase !== confirmPassphrase) throw new Error('Passphrase confirmation does not match.')
  // Capability gate: separate Starter automation feature. We do not enter the managed-backup path.
  // The existing `starter_backup` entitlement is the baseline; automation requires its own flag.
  // If the caller has not been granted `starter_backup_automation`, the IPC layer will have
  // already rejected the request. This function enforces the same boundary defensively.
  const automationEnabled = payload.enabled !== false
  // Fail closed if credential storage is unavailable.
  if (!canUseSafeStorage()) throw new Error('OS secure storage is unavailable. Enable the operating system secure-storage provider before configuring automation.')
  // A missing destination is an operator error, not a reason to create a new
  // folder silently. This also makes a moved/disconnected backup drive visible.
  const normalizedDestinationFolder = assertDestinationFolder(destinationFolder)
  const destinationLabel = payload.destination_label || payload.destinationLabel || path.basename(normalizedDestinationFolder) || normalizedDestinationFolder
  const previousConfig = readAutomationConfig(lodgeId)
  const previousCredential = readJson(getCredentialPath(lodgeId), null)
  const config = {
    version: AUTOMATION_CONFIG_VERSION,
    lodge_id: lodgeId,
    destination_folder: normalizedDestinationFolder,
    destination_label: String(destinationLabel).slice(0, 128),
    retained_copies: Math.min(Math.max(Number(payload.retained_copies || AUTOMATION_MAX_RETAINED), 2), AUTOMATION_MAX_RETAINED),
    enabled: automationEnabled,
    created_at: previousConfig?.created_at || nowIso(payload),
    updated_at: nowIso(payload),
    automation_capability: 'starter_backup_automation'
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
    throw new Error(`Backup automation could not be enabled safely. ${error?.message || 'Try again.'}`)
  }
  // Initialize status if absent; never overwrite last success here.
  const currentStatus = readAutomationStatus(lodgeId)
  if (!currentStatus.lodge_id) {
    const initial = { lodge_id: lodgeId, last_success_at: null, last_success_sha256: null, last_success_destination: null, last_verified_at: null, next_due_at: nowIso(payload), last_failure_at: null, last_failure_reason: null, snoozed_until: null, audit_state: null }
    writeAtomicJson(getStatusPath(lodgeId), initial)
  }
  return { success: true, lodge_id: lodgeId, config: { destination_folder: config.destination_folder, destination_label: config.destination_label, enabled: config.enabled } }
}

export function disableStarterBackupAutomation(lodgeIdOverride, options = {}) {
  const lodgeId = resolveLodgeId(lodgeIdOverride, options)
  const config = readAutomationConfig(lodgeId)
  if (!config) return { success: true, disabled: true }
  config.enabled = false
  config.updated_at = nowIso(options)
  writeAtomicJson(getConfigPath(lodgeId), config)
  clearCredential(lodgeId)
  return { success: true, disabled: true }
}

export function snoozeStarterBackupAutomation(lodgeIdOverride, options = {}) {
  const lodgeId = resolveLodgeId(lodgeIdOverride, options)
  const status = readAutomationStatus(lodgeId)
  status.snoozed_until = new Date(resolveNow(options).getTime() + SNOOZE_MS).toISOString()
  writeAtomicJson(getStatusPath(lodgeId), status)
  return { success: true, snoozed_until: status.snoozed_until }
}

export function clearStarterBackupAutomationSnooze(lodgeIdOverride, options = {}) {
  const lodgeId = resolveLodgeId(lodgeIdOverride, options)
  const status = readAutomationStatus(lodgeId)
  status.snoozed_until = null
  writeAtomicJson(getStatusPath(lodgeId), status)
  return { success: true }
}

function buildAutomationFileName(lodgeId, now = new Date()) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safeLodge = String(lodgeId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24)
  const windowId = randomUUID().slice(0, 8)
  return `tsa-bonno-core-data-${safeLodge}-${stamp}-${windowId}.tbbackup`
}

function fileSha256(filePath) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') } catch { return null }
}

function pruneRetention(destinationFolder, lodgeId, currentSha256, retainedCopies = AUTOMATION_MAX_RETAINED, runs = readRuns(lodgeId)) {
  // Only files with a scheduler run record, exact lodge ownership, an in-folder
  // destination, and a matching persisted hash are eligible. Filename patterns
  // alone are never sufficient because customers may keep manual exports beside
  // automated ones.
  const root = path.resolve(String(destinationFolder || '').trim())
  if (!root || !fs.existsSync(root) || !currentSha256) return { deleted: [], kept: [] }
  const safeLodge = String(lodgeId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24)
  const ownedPrefix = `tsa-bonno-core-data-${safeLodge}-`
  const states = new Set(['verified', 'audit_unconfirmed'])
  const candidates = new Map()
  for (const entry of Array.isArray(runs) ? runs : []) {
    if (!entry || String(entry.lodge_id || '') !== String(lodgeId) || !states.has(String(entry.state || ''))) continue
    const full = path.resolve(String(entry.destination || ''))
    const name = path.basename(full)
    if (path.dirname(full) !== root || !name.startsWith(ownedPrefix) || !name.endsWith('.tbbackup')) continue
    if (entry.fileName && path.basename(String(entry.fileName)) !== name) continue
    const expectedHash = String(entry.sha256 || '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || fileSha256(full) !== expectedHash) continue
    try {
      const stat = fs.statSync(full)
      if (!stat.isFile()) continue
      candidates.set(full, { full, name, sha256: expectedHash, mtime: stat.mtimeMs, finishedAt: String(entry.finished_at || '') })
    } catch {}
  }
  const entries = [...candidates.values()].sort((a, b) => {
    const byTime = new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime()
    return Number.isFinite(byTime) && byTime !== 0 ? byTime : b.mtime - a.mtime
  })
  const keepCount = Math.max(2, Math.min(AUTOMATION_MAX_RETAINED, Number(retainedCopies) || AUTOMATION_MAX_RETAINED))
  // Never prune unless the current verified artifact is positively represented;
  // this protects the newest backup during a late persistence failure.
  const current = entries.find((entry) => entry.sha256 === String(currentSha256).toLowerCase())
  if (!current || entries.length <= keepCount) return { deleted: [], kept: entries.map((entry) => entry.name) }
  const keep = entries.slice(0, keepCount)
  const keepSet = new Set(keep.map((entry) => entry.full))
  const deleted = []
  for (const entry of entries.slice(keepCount)) {
    if (keepSet.has(entry.full)) continue
    try { fs.unlinkSync(entry.full); deleted.push(entry.name) } catch {}
  }
  return { deleted, kept: keep.map((entry) => entry.name) }
}

export async function runStarterBackupAutomationOnce(options = {}) {
  const lodgeId = resolveLodgeId(options.lodgeId, options)
  const now = resolveNow(options)
  const nowMs = now.getTime()
  const config = readAutomationConfig(lodgeId)
  if (!config || config.enabled !== true) throw new Error('Scheduled backups are not enabled for this lodge. Complete setup first.')
  const status = readAutomationStatus(lodgeId)
  if (isSnoozed(status, nowMs)) throw new Error('Scheduled backup is snoozed. Clear the snooze or wait until it expires.')
  // Window ID is durable per 7-day period: reuse the same window if a verified copy
  // has not yet been produced for it, so crash recovery does not double-schedule.
  if (!isDue(status, nowMs) && !options.force) throw new Error('A scheduled backup is not yet due.')
  const dependencies = options.dependencies || {}
  const captureContext = dependencies.captureBackupContext || captureBackupContext
  const writeBackup = dependencies.writeBackup || writeStarterBackupToPath
  const verifyBackup = dependencies.verifyBackup || verifyStarterBackupAtPath
  const getPassphrase = dependencies.retrievePassphrase || retrievePassphrase
  const recordAudit = dependencies.recordAudit || null
  const recordHistory = dependencies.recordHistory || null
  // Immutable capture: do not re-read global state mid-run.
  const backupContext = captureContext({ lodgeId, isOnline: options.isOnline !== undefined ? Boolean(options.isOnline) : Boolean(state.isOnline), supabase: state.supabase, cacheDir: state.cacheDir, appVersion: options.appVersion })
  if (!backupContext.isOnline) {
    // Label explicitly as local/incomplete; do not certify. Record failure as actionable, not silent.
    const failure = { lodge_id: lodgeId, at: now.toISOString(), error: 'Scheduled backup deferred: application is offline. It will retry at startup or reconnect.', offline: true }
    status.last_failure_at = failure.at
    status.last_failure_reason = failure.error
    status.next_due_at = failure.at
    writeAtomicJson(getStatusPath(lodgeId), status)
    const runs = readRuns(lodgeId)
    writeRuns(lodgeId, [{ run_id: randomUUID(), window_id: `offline-${now.toISOString().slice(0, 10)}`, lodge_id: lodgeId, started_at: failure.at, finished_at: failure.at, state: 'deferred_offline', error: failure.error }, ...runs])
    throw new Error(failure.error)
  }
  const windowId = `window-${now.toISOString().slice(0, 10)}`
  const runId = randomUUID()
  const lockPath = acquireRunLock(lodgeId, windowId, { now })
  const runs = readRuns(lodgeId)
  const runRecord = { run_id: runId, window_id: windowId, lodge_id: lodgeId, started_at: now.toISOString(), state: 'started' }
  const destinationFolder = path.resolve(String(config.destination_folder || '').trim())
  const fileName = buildAutomationFileName(lodgeId, now)
  const filePath = path.join(destinationFolder, fileName)
  let artifactVerified = false
  try {
    assertDestinationFolder(destinationFolder)
    writeRuns(lodgeId, [runRecord, ...runs])
    const passphrase = getPassphrase(lodgeId)
    // Recheck immediately before writing so a disconnected/moved destination
    // never gets recreated by the generic atomic writer.
    assertDestinationFolder(destinationFolder)
    // writeStarterBackupToPath now accepts immutable context via _backupContext.
    const result = await writeBackup(filePath, { passphrase, appVersion: backupContext.appVersion, _backupContext: backupContext })
    // Immediately reopen and verify encryption/checksum/lodge identity/completeness.
    const verification = await verifyBackup(filePath, { passphrase, expectedLodgeId: lodgeId })
    if (!verification?.success) {
      try { fs.unlinkSync(filePath) } catch {}
      throw new Error(verification?.error || 'Scheduled backup verification failed.')
    }
    artifactVerified = true
    // Authoritative artifact audit: record with distinct verified vs audit_unconfirmed states.
    let auditState = 'audit_unconfirmed'
    try {
      if (recordAudit) await recordAudit({ action: 'starter_backup_created', artifactId: result.sha256, metadata: { schema: result.manifest?.format || 'tsa-bonno-starter-backup-package/v2', bytes: result.bytes, complete: result.complete, counts: result.counts, encrypted: result.encrypted === true, automated: true, window_id: windowId, run_id: runId } })
      else {
        const { recordStarterArtifactAudit } = await import('./starterAudit.js')
        await recordStarterArtifactAudit({ action: 'starter_backup_created', artifactId: result.sha256, metadata: { schema: result.manifest?.format || 'tsa-bonno-starter-backup-package/v2', bytes: result.bytes, complete: result.complete, counts: result.counts, encrypted: result.encrypted === true, automated: true, window_id: windowId, run_id: runId } })
      }
      auditState = 'verified'
    } catch {
      // The encrypted artifact remains valid, but must stay immediately due so
      // the audit can be retried rather than being certified for seven days.
      auditState = 'audit_unconfirmed'
    }
    try {
      if (recordHistory) await recordHistory({ lodgeId, fileName, destination: filePath, at: now.toISOString(), sha256: result.sha256, complete: result.complete, counts: result.counts, encrypted: result.encrypted === true, automated: true, window_id: windowId, run_id: runId })
      else {
        const { recordStarterBackupHistory } = await import('./starterBackup.js')
        recordStarterBackupHistory(getHistoryPath(lodgeId), { lodgeId, fileName, destination: filePath, at: now.toISOString(), sha256: result.sha256, complete: result.complete, counts: result.counts, encrypted: result.encrypted === true, automated: true, window_id: windowId, run_id: runId })
      }
    } catch {
      // Run metadata below is still the retention source of truth.
    }
    status.last_success_at = now.toISOString()
    status.last_success_sha256 = result.sha256
    status.last_success_destination = filePath
    status.last_verified_at = now.toISOString()
    status.next_due_at = auditState === 'verified' ? computeNextDue(status.last_success_at) : now.toISOString()
    status.last_failure_at = auditState === 'verified' ? null : now.toISOString()
    status.last_failure_reason = auditState === 'verified' ? null : 'Backup is encrypted and locally verified, but audit confirmation failed. Retrying now.'
    status.snoozed_until = null
    status.audit_state = auditState
    runRecord.finished_at = now.toISOString()
    runRecord.state = auditState
    runRecord.destination = filePath
    runRecord.fileName = fileName
    runRecord.sha256 = result.sha256
    runRecord.audit_state = auditState
    writeAtomicJson(getStatusPath(lodgeId), status)
    writeRuns(lodgeId, [runRecord, ...readRuns(lodgeId).filter((entry) => entry.run_id !== runId)])
    const retention = pruneRetention(destinationFolder, lodgeId, result.sha256, config.retained_copies, [runRecord, ...readRuns(lodgeId).filter((entry) => entry.run_id !== runId)])
    return { success: true, lodge_id: lodgeId, destination: filePath, fileName, sha256: result.sha256, audit_state: auditState, next_due_at: status.next_due_at, retention }
  } catch (error) {
    // Persist a retryable failure, but do not let status persistence hide the
    // original action error. The outer finally always releases the lock.
    runRecord.finished_at = now.toISOString()
    runRecord.state = 'failed'
    runRecord.error = error?.message || 'Scheduled backup failed.'
    if (!artifactVerified) {
      try { fs.unlinkSync(filePath) } catch {}
    }
    try { writeRuns(lodgeId, [runRecord, ...readRuns(lodgeId).filter((entry) => entry.run_id !== runId)]) } catch {}
    try {
      status.last_failure_at = runRecord.finished_at
      status.last_failure_reason = runRecord.error
      status.next_due_at = runRecord.finished_at
      status.audit_state = 'failed'
      writeAtomicJson(getStatusPath(lodgeId), status)
    } catch {}
    throw new Error(runRecord.error)
  } finally {
    releaseLock(lockPath)
  }
}

export function evaluateAutomationDueAtStartup(lodgeIdOverride, options = {}) {
  let lodgeId
  try { lodgeId = resolveLodgeId(lodgeIdOverride, options) } catch { return { due: false, reason: 'wrong_lodge' } }
  if (!lodgeId) return { due: false, reason: 'no_lodge' }
  const config = readAutomationConfig(lodgeId)
  if (!config || config.enabled !== true) return { due: false, reason: 'disabled' }
  const status = readAutomationStatus(lodgeId)
  const nowMs = resolveNow(options).getTime()
  if (isSnoozed(status, nowMs)) return { due: false, reason: 'snoozed', snoozed_until: status.snoozed_until }
  if (isDue(status, nowMs)) return { due: true, reason: 'due', last_success_at: status.last_success_at, next_due_at: status.next_due_at || computeNextDue(status.last_success_at, resolveNow(options)) }
  return { due: false, reason: 'not_yet_due', next_due_at: status.next_due_at || computeNextDue(status.last_success_at, resolveNow(options)) }
}

// Kept intentionally small and side-effect free for focused main-process tests.
// These are not part of the renderer/database public facade.
export const __starterBackupAutomationTestables = {
  acquireRunLock,
  releaseLock,
  pruneRetention,
  resolveLodgeId,
  assertDestinationFolder,
  getAutomationRoot,
  getConfigPath,
  getStatusPath,
  getRunsPath,
  getCredentialPath,
  writeAtomicJson,
  readJson,
  isDue
}
