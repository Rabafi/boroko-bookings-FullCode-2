import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtemp, open, readdir, rm, stat, statfs } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BAR_LOCAL_ERROR_CODES, BarLocalError, CONTRACT_VERSION, enumeration, string } from '@tsa-bonno/bar-contracts'
import type { BarLocalErrorCode } from '@tsa-bonno/bar-contracts'
import type { Pool } from 'pg'
import type { BackupSettings, ServiceConfig } from './config.js'
import { callFunction } from './db.js'
import { readJson, sendJson, isLoopbackRequest } from './http.js'
import {
  BackupToolError,
  createEncryptedBackup,
  createPgDumpSpec,
  decryptFile,
  loadEncryptionKey,
  readBackupManifest,
  verifyBackupPackage
} from './operations/backup.js'
import type { BackupManifest, BackupReport } from './operations/backup.js'
import { runRestoreDrill } from './operations/restoreDrill.js'
import { exportRecoveryKeys, recoveryStatus } from './operations/recovery.js'
import { recoveryJobStatus, startRecoveryJob } from './operations/recoveryJobs.js'
import { setRecoveryCopyDestination } from './operations/recoveryDestination.js'
import {
  applyUpdatePackage,
  describeUpdateTrust,
  listUpdateInbox,
  readLastUpdateFailure,
  readLastUpdateReport,
  readStagedUpdate,
  stageUpdatePackage
} from './operations/updateService.js'
import { UpdateValidationError } from './operations/updates.js'
import { buildNetworkStatus } from './operations/network.js'
import type { FailoverController } from './operations/failover.js'
import {
  inspectReplication,
  ReplicationError,
  setDurability,
  switchover
} from './operations/replication.js'
import type {
  ReplicationDependencies,
  SqlQuery,
  SwitchoverReport
} from './operations/replication.js'
import type { CloudSyncController, CloudSyncStatus } from './operations/cloudSync.js'

export interface AdminLogger {
  info?(context: Record<string, unknown>): void
  error?(context: Record<string, unknown>): void
}

export interface AdminRequestContext {
  config: ServiceConfig
  pool: Pool
  logger?: AdminLogger | null
}

export interface AdminSession {
  /** SHA-256 of the caller's session token, used by session-scoped SQL functions. */
  tokenHash: string
  deviceId: string
  context: {
    business_id: string
    outlet_id: string
    staff_id: string
    capabilities: readonly string[]
  }
}

export type AdminAuthenticate = (ctx: AdminRequestContext, req: IncomingMessage) => Promise<AdminSession>

export interface AdminHandlerOptions {
  query?: SqlQuery
  replicationDependencies?: ReplicationDependencies
  now?: () => Date
  cloudSync?: CloudSyncController | null
  failover?: FailoverController | null
  /** Restart the service after a successful update apply, once the HTTP response has flushed. */
  requestRestart?: (() => void) | null
}

export interface AdminHandler {
  (ctx: AdminRequestContext, req: IncomingMessage, res: ServerResponse, correlationId: string, url: URL): Promise<boolean>
}

interface BackupPackageSummary {
  file_name: string
  manifest_name: string
  created_at: string
  label: string | null
  bytes: number
  sha256: string
  plaintext_sha256: string
  source: BackupManifest['source']
  encryption: BackupManifest['encryption']
}

const ADMIN_STARTED_AT = Date.now()
const ADMIN_CAPABILITY = 'settings.manage'
const BACKUP_CAPABILITY = 'backup.manage'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function allowOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(body)) {
    if (!allowedSet.has(key)) {
      throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `The request body field "${key}" is not accepted.`, { httpStatus: 400 })
    }
  }
}

function stringField(body: Record<string, unknown>, name: string, options: { min?: number; max?: number; optional?: boolean } = {}): string | null {
  const value = body[name]
  if (value === undefined || value === null) {
    if (options.optional) return null
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${name} is required.`)
  }
  if (typeof value !== 'string') {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${name} must be a string.`)
  }
  const trimmed = value.trim()
  const min = options.min ?? 1
  const max = options.max ?? 200
  if (trimmed.length < min || trimmed.length > max) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `${name} must be between ${min} and ${max} characters.`)
  }
  return trimmed
}

function requireCapability(auth: AdminSession, capability: string): void {
  if (!auth.context.capabilities.includes(capability)) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.CAPABILITY_DENIED, `The ${capability} capability is required for this administration action.`, {
      httpStatus: 403,
      details: { required_capability: capability }
    })
  }
}

function requireLoopback(req: IncomingMessage): void {
  if (!isLoopbackRequest(req)) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.CAPABILITY_DENIED, 'This administration action is only available from the local machine.', {
      httpStatus: 403
    })
  }
}

function backupErrorStatus(code: string): number {
  if (code === 'BACKUP_FILE_MISSING' || code === 'BACKUP_MANIFEST_MISSING') return 404
  if (code === 'RESTORE_DRILL_IN_PROGRESS') return 409
  if (code === 'RESTORE_AUTHORIZATION_REQUIRED' || code === 'RESTORE_AUTHORIZATION_MISMATCH') return 400
  if (code.includes('VERIFY') || code.includes('TAMPER') || code.includes('SHA') || code.includes('DECRYPT')) return 409
  if (code.includes('INVALID') || code.includes('UNSAFE')) return 400
  if (code.includes('UNAVAILABLE') || code.includes('DISK')) return 503
  return 500
}

function updateErrorStatus(code: string): number {
  if (code === 'UPDATE_PACKAGE_MISSING') return 404
  if (code === 'UPDATE_BUSY' || code === 'UPDATE_NOT_STAGED' || code === 'UPDATE_CHECKPOINT_REQUIRED'
    || code === 'UPDATE_CHECKPOINT_MISSING' || code === 'UPDATE_APPLY_FAILED'
    || code === 'UPDATE_ROLLBACK_FAILED' || code === 'UPDATE_UNRESOLVED_WORK') return 409
  if (code === 'UPDATE_APPLY_DISABLED' || code === 'UPDATE_SIGNING_UNAVAILABLE'
    || code === 'UPDATE_PREFLIGHT_UNAVAILABLE' || code === 'UPDATE_SCHEMA_UNKNOWN') return 503
  if (code === 'UPDATE_DISK_SPACE_INSUFFICIENT') return 507
  if (code.includes('INCOMPATIBLE') || code.includes('DOWNGRADE') || code.includes('NOT_NEWER')) return 409
  if (code.includes('SIGNATURE') || code.includes('MANIFEST') || code.includes('ARTIFACT')
    || code.includes('PACKAGE') || code.includes('TARGET') || code.includes('VERSION')
    || code.includes('STAGING') || code.includes('INSTALL') || code.includes('CHECKPOINT')) return 400
  return 500
}

function replicationErrorStatus(code: string): number {
  if (code === 'COORDINATOR_UNVERIFIED') return 409
  if (code === 'REPLICATION_CONFIRMATION_REQUIRED' || code === 'REPLICATION_DATA_DIR_NOT_EMPTY') return 400
  if (code === 'REPLICATION_PRIMARY_HOST_REFUSED' || code === 'REPLICATION_IDENTIFIER_INVALID') return 400
  if (code === 'REPLICATION_CONFIG_MISSING' || code === 'REPLICATION_CONNECT_FAILED') return 503
  if (code === 'REPLICATION_CATCHUP_TIMEOUT' || code === 'REPLICATION_STREAMING_TIMEOUT') return 504
  if (code === 'REPLICATION_FENCE_FAILED' || code === 'REPLICATION_PROMOTION_FAILED') return 500
  return 409
}

function asBarLocalError(error: unknown): BarLocalError {
  if (error instanceof BarLocalError) return error
  if (error instanceof ReplicationError) {
    return new BarLocalError(error.code as unknown as BarLocalErrorCode, error.message, {
      httpStatus: replicationErrorStatus(error.code),
      details: error.details,
      cause: error
    })
  }
  if (error instanceof BackupToolError) {
    return new BarLocalError(error.code as unknown as BarLocalErrorCode, error.message, {
      httpStatus: backupErrorStatus(error.code),
      cause: error
    })
  }
  if (error instanceof UpdateValidationError) {
    return new BarLocalError(error.code as unknown as BarLocalErrorCode, error.message, {
      httpStatus: updateErrorStatus(error.code),
      details: { update_error_code: error.code },
      cause: error
    })
  }
  return new BarLocalError(BAR_LOCAL_ERROR_CODES.INTERNAL_ERROR, 'The local Bar administration action could not be completed.', { cause: error })
}

function sendAdminError(res: ServerResponse, error: unknown, correlationId: string): void {
  const normalized = asBarLocalError(error)
  sendJson(res, normalized.httpStatus, normalized.toResponse(correlationId) as unknown as Record<string, unknown>, correlationId)
}

function postgresTargetFromUrl(value: string): { host: string; port: number; database: string; user: string; password: string | null } {
  const parsed = new URL(value)
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port === '' ? 5432 : Number(parsed.port),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    user: decodeURIComponent(parsed.username),
    password: parsed.password ? decodeURIComponent(parsed.password) : null
  }
}

function numericSchemaVersion(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d+)/.exec(value)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isSafeInteger(parsed) ? parsed : null
}

async function queryOne(query: SqlQuery | null, sql: string, params?: readonly unknown[]): Promise<Record<string, unknown> | null> {
  if (!query) {
    throw new BarLocalError('ADMIN_DATABASE_UNAVAILABLE' as BarLocalErrorCode, 'The local Bar database status could not be checked.', { httpStatus: 503 })
  }
  try {
    return (await query(sql, params)).rows[0] ?? null
  } catch (error) {
    throw new BarLocalError('ADMIN_DATABASE_UNAVAILABLE' as BarLocalErrorCode, 'The local Bar database status could not be checked. Retry after the service is healthy.', {
      httpStatus: 503,
      cause: error
    })
  }
}

interface UpdateSchemaState {
  readonly schemaMigration: string | null
  readonly schemaVersion: number | null
}

async function readUpdateSchemaState(ctx: AdminRequestContext): Promise<UpdateSchemaState> {
  const metadataRow = await queryOne(
    (sql, params) => ctx.pool.query(sql, params ? [...params] : undefined).then((result) => ({ rows: result.rows as Record<string, unknown>[] })),
    'SELECT bar_local.service_admin_status() AS result'
  )
  const metadata = isRecord(metadataRow?.result) ? metadataRow.result : null
  const schemaMigration = typeof metadata?.schema_migration === 'string' ? metadata.schema_migration : null
  return { schemaMigration, schemaVersion: numericSchemaVersion(schemaMigration) }
}

/**
 * An update may only replace service files while the live authority has no
 * half-finished financial command. A crashed `executing` row can hide a receipt
 * that never committed, so the update fails closed and points the operator at
 * reconciliation instead of promoting code over uncertain work.
 */
async function assertNoUnresolvedUpdateWork(ctx: AdminRequestContext): Promise<void> {
  if (ctx.config.failover.role === 'standby') {
    throw new BarLocalError(
      'UPDATE_AUTHORITY_REQUIRED' as BarLocalErrorCode,
      'This host is configured as a standby. Apply the update on the active authority host instead.',
      { httpStatus: 409, details: { failover_role: ctx.config.failover.role } }
    )
  }
  let unresolved: number
  try {
    const result = await ctx.pool.query(
      `SELECT count(*)::int AS unresolved
         FROM bar_local.operations
        WHERE status = 'executing'`
    )
    unresolved = Number(isRecord(result.rows[0]) ? result.rows[0].unresolved : NaN)
  } catch (error) {
    throw new BarLocalError(
      'UPDATE_PREFLIGHT_UNAVAILABLE' as BarLocalErrorCode,
      'Unresolved local financial work could not be checked, so the update was refused. Confirm the local database is reachable and retry.',
      { httpStatus: 503, cause: error }
    )
  }
  if (!Number.isFinite(unresolved)) {
    throw new BarLocalError(
      'UPDATE_PREFLIGHT_UNAVAILABLE' as BarLocalErrorCode,
      'The local authority returned an unreadable unresolved-work count, so the update was refused.',
      { httpStatus: 503 }
    )
  }
  if (unresolved > 0) {
    throw new BarLocalError(
      'UPDATE_UNRESOLVED_WORK' as BarLocalErrorCode,
      `${unresolved} local financial operation(s) are still marked as executing. Reconcile or retry them in the till, confirm their final state, then stage and apply the update again.`,
      { httpStatus: 409, details: { unresolved_operations: unresolved } }
    )
  }
}

async function listBackupPackages(settings: BackupSettings): Promise<BackupPackageSummary[]> {
  let names: string[]
  try {
    names = await readdir(settings.dir)
  } catch (error) {
    throw new BackupToolError('BACKUP_DIRECTORY_UNAVAILABLE', `The backup destination could not be read: ${error instanceof Error ? error.message : 'unknown filesystem error'}`)
  }
  const packages: BackupPackageSummary[] = []
  for (const manifestName of names.filter((name) => name.endsWith('.manifest.json'))) {
    const manifestPath = path.join(settings.dir, manifestName)
    try {
      const manifest = await readBackupManifest(manifestPath)
      const backupPath = path.join(settings.dir, manifest.file.name)
      const info = await stat(backupPath)
      if (!info.isFile()) continue
      packages.push({
        file_name: manifest.file.name,
        manifest_name: manifestName,
        created_at: manifest.created_at,
        label: manifest.label,
        bytes: manifest.file.bytes,
        sha256: manifest.file.sha256,
        plaintext_sha256: manifest.file.plaintext_sha256,
        source: manifest.source,
        encryption: manifest.encryption
      })
    } catch (error) {
      throw new BackupToolError('BACKUP_MANIFEST_INVALID', `A backup manifest could not be checked (${manifestName}): ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }
  return packages.sort((left, right) => right.created_at.localeCompare(left.created_at))
}

const BACKUP_TASK_STATE_FORMAT = 'bar-local-backup-task-v1'
const BACKUP_HEALTH_LOG_TAIL_BYTES = 256 * 1024

interface BackupScheduleHealth {
  readonly schedule_installed: boolean
  readonly schedule_state: 'ready' | 'not_installed' | 'unreadable' | 'disabled' | 'unknown'
  readonly schedule_message: string
  readonly task_name: string | null
  readonly registered_at: string | null
  readonly hourly_every_hours: number | null
  readonly daily_at: string | null
  readonly log_path: string | null
  readonly last_run_at: string | null
  readonly last_run_result: 'ok' | 'failed' | 'interrupted' | 'unknown'
  readonly last_run_message: string | null
  readonly latest_backup_at: string | null
  readonly latest_backup_age_hours: number | null
  readonly stale_after_hours: number | null
  readonly health: 'healthy' | 'stale' | 'never' | 'failed' | 'schedule_missing' | 'destination_unavailable'
  readonly pitr_available: false
  readonly warning: string
}

async function readSmallJsonFile(filePath: string, maxBytes = 64 * 1024): Promise<unknown> {
  const handle = await open(filePath, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxBytes) throw new Error('Unexpected file size or type')
    const buffer = Buffer.alloc(info.size)
    await handle.read(buffer, 0, info.size, 0)
    return JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''))
  } finally {
    await handle.close().catch(() => {})
  }
}

async function readLogTail(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile()) return ''
    const length = Math.min(info.size, maxBytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, info.size - length)
    return buffer.toString('utf8')
  } finally {
    await handle.close().catch(() => {})
  }
}

function backupLogHealth(text: string): { last_run_at: string | null; last_run_result: BackupScheduleHealth['last_run_result']; last_run_message: string | null } {
  const lines = text.split(/\r?\n/).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+(.*)$/.exec(lines[index])
    if (!match) continue
    const message = match[2].trim()
    if (/^backup complete$/i.test(message)) return { last_run_at: match[1], last_run_result: 'ok', last_run_message: 'The most recent scheduled run completed.' }
    if (/^backup failed:/i.test(message)) return { last_run_at: match[1], last_run_result: 'failed', last_run_message: message.slice(0, 500) }
    if (/^backup starting$/i.test(message)) return { last_run_at: match[1], last_run_result: 'interrupted', last_run_message: 'The most recent scheduled run started but did not log an outcome. Check the backup log and destination before relying on it.' }
  }
  return { last_run_at: null, last_run_result: 'unknown', last_run_message: null }
}

async function buildBackupScheduleHealth(settings: BackupSettings, latest: BackupPackageSummary | null, now: Date): Promise<BackupScheduleHealth> {
  const base = {
    pitr_available: false as const,
    warning: 'Scheduled backups are encrypted full local snapshots. They are not WAL archiving or point-in-time recovery, and a backup on this PC is not an off-site copy. Keep a verified copy on independent media.'
  }
  let marker: Record<string, unknown> | null = null
  let markerError: string | null = null
  if (!settings.taskStateFile) {
    markerError = 'The backup task state marker is not configured, so this service cannot confirm that scheduled backups are installed.'
  } else {
    try {
      const parsed = await readSmallJsonFile(settings.taskStateFile)
      if (isRecord(parsed) && parsed.format === BACKUP_TASK_STATE_FORMAT) marker = parsed
      else markerError = 'The backup task state marker is present but does not use the supported format.'
    } catch (error) {
      markerError = error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
        ? 'No scheduled backup task is registered on this PC.'
        : 'The backup task state marker could not be read; treat scheduled backups as unconfirmed.'
    }
  }

  const taskName = marker && typeof marker.task_name === 'string' ? marker.task_name.slice(0, 120) : null
  const registeredAt = marker && typeof marker.registered_at === 'string' && !Number.isNaN(Date.parse(marker.registered_at))
    ? new Date(marker.registered_at).toISOString()
    : null
  const hourly = marker && Number.isInteger(marker.hourly_every_hours) && Number(marker.hourly_every_hours) > 0 && Number(marker.hourly_every_hours) <= 24
    ? Number(marker.hourly_every_hours)
    : null
  const dailyAt = marker && typeof marker.daily_at === 'string' && /^([01]\d|2[0-3]):[0-5][0-9]$/.test(marker.daily_at) ? marker.daily_at : null
  const logDir = marker && typeof marker.log_dir === 'string' ? marker.log_dir : (settings.logDir ?? null)
  const logPath = logDir ? path.join(logDir, 'backup.log') : null
  let log = { last_run_at: null as string | null, last_run_result: 'unknown' as BackupScheduleHealth['last_run_result'], last_run_message: null as string | null }
  if (logPath) {
    try {
      log = backupLogHealth(await readLogTail(logPath, BACKUP_HEALTH_LOG_TAIL_BYTES))
    } catch {
      // A missing log is normal before the first run and must not be reported as corruption.
    }
  }

  const installed = marker !== null
  const scheduleState: BackupScheduleHealth['schedule_state'] = installed
    ? (typeof marker?.task_state === 'string' && /disabled/i.test(marker.task_state) ? 'disabled' : 'ready')
    : (markerError && /not configured|No scheduled/.test(markerError) ? 'not_installed' : 'unknown')
  const scheduleMessage = installed
    ? `Scheduled task ${taskName ?? 'BarLocalBackup'} is registered. Last run: ${log.last_run_result}.`
    : markerError ?? 'Scheduled backups are not installed.'

  const latestAt = latest ? new Date(latest.created_at) : null
  const latestValid = latestAt && !Number.isNaN(latestAt.getTime()) ? latestAt : null
  const ageHours = latestValid ? Math.max(0, (now.getTime() - latestValid.getTime()) / 3_600_000) : null
  const staleAfterHours = hourly ? Math.max(6, hourly * 3) : 26

  let health: BackupScheduleHealth['health']
  if (!installed) health = 'schedule_missing'
  else if (scheduleState === 'disabled') health = 'failed'
  else if (log.last_run_result === 'failed') health = latestValid && log.last_run_at && latestValid.getTime() > Date.parse(log.last_run_at) ? 'healthy' : 'failed'
  else if (!latestValid) health = 'never'
  else if (ageHours !== null && ageHours > staleAfterHours) health = 'stale'
  else health = 'healthy'

  return {
    ...base,
    schedule_installed: installed,
    schedule_state: scheduleState,
    schedule_message: scheduleMessage,
    task_name: taskName,
    registered_at: registeredAt,
    hourly_every_hours: hourly,
    daily_at: dailyAt,
    log_path: logPath,
    last_run_at: log.last_run_at,
    last_run_result: log.last_run_result,
    last_run_message: log.last_run_message,
    latest_backup_at: latest?.created_at ?? null,
    latest_backup_age_hours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    stale_after_hours: staleAfterHours,
    health,
    pitr_available: false,
    warning: base.warning
  }
}


export async function buildAdminStatus(
  config: ServiceConfig,
  options: { query?: SqlQuery | null; now?: Date; uptimeSeconds?: number; failover?: Record<string, unknown> | null } = {}
): Promise<Record<string, unknown>> {
  const now = options.now ?? new Date()
  const query = options.query ?? null
  const databaseRow = await queryOne(query, 'SELECT 1 AS reachable')
  const reachable = databaseRow !== null
  const replication = await inspectReplication(query ? { query } : null, config.replication, { query: query ?? undefined, now: () => now })
  const failover = options.failover ?? null
  const failoverAutomatic = isRecord(failover) && isRecord(failover.automatic_failover) ? failover.automatic_failover : null
  const failoverLease = isRecord(failover) && isRecord(failover.lease) ? failover.lease : null
  const failoverEvidence = failoverAutomatic?.verified === true
    ? {
        verified: true,
        evidenceRef: `witness:${typeof failover?.cluster_id === 'string' ? failover.cluster_id : 'unknown'}@epoch:${typeof failoverLease?.epoch === 'number' ? failoverLease.epoch : 'unknown'}`
      }
    : null
  const network = await buildNetworkStatus({
    role: config.networkRole,
    bindHost: config.http.host,
    port: config.http.port,
    tlsCertFile: config.http.tls?.certFile ?? null,
    database: { reachable, name: config.db.database },
    evidence: failoverEvidence ? { automaticFailover: failoverEvidence } : null,
    now
  })
  const metadataRow = await queryOne(query, 'SELECT bar_local.service_admin_status() AS result')
  const metadata = isRecord(metadataRow?.result) ? metadataRow.result : null
  const metadataDevices = isRecord(metadata?.devices) ? metadata.devices : null
  const schemaMigration = typeof metadata?.schema_migration === 'string' ? metadata.schema_migration : null
  let packages: BackupPackageSummary[] = []
  let backupDestinationStatus: 'available' | 'unavailable' = 'available'
  let backupDestinationError: string | null = null
  try {
    packages = await listBackupPackages(config.backup)
  } catch (error) {
    backupDestinationStatus = 'unavailable'
    backupDestinationError = error instanceof BackupToolError ? error.code : 'BACKUP_DIRECTORY_UNAVAILABLE'
  }
  const latest = packages[0] ?? null
  let copyDestinationStatus: 'not_configured' | 'available' | 'unavailable' = config.backup.copyToDir ? 'available' : 'not_configured'
  let copyDestinationError: string | null = null
  let copyPackages: BackupPackageSummary[] = []
  if (config.backup.copyToDir) {
    try {
      copyPackages = await listBackupPackages({ ...config.backup, dir: config.backup.copyToDir })
    } catch (error) {
      copyDestinationStatus = 'unavailable'
      copyDestinationError = error instanceof BackupToolError ? error.code : 'BACKUP_COPY_DESTINATION_UNAVAILABLE'
    }
  }
  const backupSchedule = await buildBackupScheduleHealth(config.backup, latest, now)

  return {
    ok: true,
    status: {
      service: {
        version: config.service.version,
        uptime_seconds: options.uptimeSeconds ?? Math.max(0, Math.floor((Date.now() - ADMIN_STARTED_AT) / 1000))
      },
      network,
      replication: withFailoverEvidence(replication, failover),
      failover,
      backup: {
        configured: Boolean(config.backup.databaseUrl && config.backup.keyConfigured),
        destination: config.backup.dir,
        destination_status: backupDestinationStatus,
        destination_error: backupDestinationError,
        copy_destination: config.backup.copyToDir,
        copy_destination_status: copyDestinationStatus,
        copy_destination_error: copyDestinationError,
        copy_latest: copyPackages[0] ?? null,
        key_configured: config.backup.keyConfigured,
        latest,
        retention: config.backup.retention,
        schedule_installed: backupSchedule.schedule_installed,
        schedule: backupSchedule
      },
      update: {
        service_version: config.service.version,
        schema_version: numericSchemaVersion(schemaMigration),
        schema_migration: schemaMigration,
        contract_version: CONTRACT_VERSION
      },
      devices: {
        count: typeof metadataDevices?.count === 'number' ? metadataDevices.count : 0,
        active: typeof metadataDevices?.active === 'number' ? metadataDevices.active : 0
      },
      database: {
        reachable,
        database: config.db.database,
        port: config.db.port
      }
    }
  }
}

function isBackupFileName(value: string): boolean {
  return /\.(blbkup|blb)$/i.test(value) && path.basename(value) === value
}

function manifestPathForBackupName(directory: string, fileName: string): string {
  return path.join(directory, `${fileName.replace(/\.(blbkup|blb)$/i, '')}.manifest.json`)
}

async function backupSummaryFromName(settings: BackupSettings, fileName: string): Promise<BackupPackageSummary | null> {
  const packages = await listBackupPackages(settings)
  return packages.find((entry) => entry.file_name === fileName) ?? null
}

async function createBackupReport(ctx: AdminRequestContext, label: string | null): Promise<BackupReport> {
  if (!ctx.config.backup.databaseUrl) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.SERVICE_UNAVAILABLE, 'BAR_LOCAL_ADMIN_DATABASE_URL is not configured for backup creation.', { httpStatus: 503 })
  }
  if (!ctx.config.backup.keyConfigured) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.SERVICE_UNAVAILABLE, 'A backup encryption key is not configured.', { httpStatus: 503 })
  }
  const key = loadEncryptionKey({
    keyFile: ctx.config.backup.keyFile,
    env: process.env
  })
  const target = postgresTargetFromUrl(ctx.config.backup.databaseUrl)
  const dumpSpec = createPgDumpSpec(target, { command: ctx.config.backup.pgDump })
  const dumpEnv: NodeJS.ProcessEnv = { ...(dumpSpec.env ?? process.env) }
  delete dumpEnv.BAR_LOCAL_ADMIN_DATABASE_URL
  delete dumpEnv.BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL
  delete dumpEnv.BAR_LOCAL_REPLICATION_PASSWORD
  delete dumpEnv.BAR_LOCAL_SETUP_SECRET
  return createEncryptedBackup({
    target,
    destinationDir: ctx.config.backup.dir,
    copyToDir: ctx.config.backup.copyToDir,
    encryptionKey: key,
    label,
    command: { ...dumpSpec, env: dumpEnv },
    allowTestDatabase: false,
    retention: ctx.config.backup.retention,
    now: new Date()
  })
}

async function createBackup(ctx: AdminRequestContext, body: Record<string, unknown>, correlationId: string, auth: AdminSession): Promise<Record<string, unknown>> {
  allowOnlyKeys(body, ['label'])
  const label = body.label === undefined || body.label === null ? null : stringField(body, 'label', { max: 120 })
  await audit(ctx, correlationId, 'admin.backup.create_started', { label }, auth)
  const report = await createBackupReport(ctx, label)
  const summary = await backupSummaryFromName(ctx.config.backup, report.backup.file_name)
  await audit(ctx, correlationId, 'admin.backup.created', {
    file_name: report.backup.file_name,
    manifest_path: report.backup.manifest_path,
    bytes: report.backup.bytes
  }, auth)
  return {
    ok: true,
    command: 'backup',
    generated_at: report.generated_at,
    backup: report.backup,
    copy: report.copy,
    package: summary,
    source: report.source,
    encryption: report.encryption,
    retention: report.retention
  }
}

async function verifyBackup(
  ctx: AdminRequestContext,
  body: Record<string, unknown>,
  correlationId: string,
  auth: AdminSession
): Promise<Record<string, unknown>> {
  allowOnlyKeys(body, ['file_name'])
  const fileName = stringField(body, 'file_name', { max: 255 })
  if (!fileName || !isBackupFileName(fileName)) {
    throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'file_name must be a backup package basename ending in .blbkup or .blb.', {
      httpStatus: 400
    })
  }
  const filePath = path.join(ctx.config.backup.dir, fileName)
  const info = await stat(filePath).catch(() => null)
  if (!info?.isFile()) {
    throw new BarLocalError('BACKUP_FILE_MISSING' as BarLocalErrorCode, 'The requested backup package does not exist.', { httpStatus: 404 })
  }
  const summary = await backupSummaryFromName(ctx.config.backup, fileName)
  const manifestPath = summary
    ? path.join(ctx.config.backup.dir, summary.manifest_name)
    : manifestPathForBackupName(ctx.config.backup.dir, fileName)
  const verified = await verifyBackupPackage(manifestPath)
  if (verified.manifest.file.name !== fileName) {
    throw new BarLocalError('BACKUP_MANIFEST_INVALID' as BarLocalErrorCode, 'The backup manifest describes a different package.', { httpStatus: 409 })
  }
  const key = loadEncryptionKey({ keyFile: ctx.config.backup.keyFile, env: process.env })
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'bar-local-backup-verify-'))
  const plaintextPath = path.join(tempDirectory, 'authenticated.pgcustom')
  try {
    const available = await statfs(tempDirectory)
    const availableBytes = BigInt(available.bavail) * BigInt(available.bsize)
    if (availableBytes < BigInt(verified.manifest.file.plaintext_bytes)) {
      throw new BackupToolError('BACKUP_VERIFY_DISK_SPACE', 'There is not enough temporary disk space to authenticate this backup package.')
    }
    await decryptFile({
      encryptedPath: verified.backupPath,
      outputPath: plaintextPath,
      key,
      expectedSha256: verified.manifest.file.sha256,
      expectedPlaintextSha256: verified.manifest.file.plaintext_sha256
    })
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
  await audit(ctx, correlationId, 'admin.backup.verified', {
    file_name: fileName,
    manifest_name: path.basename(manifestPath),
    bytes: verified.bytes
  }, auth)
  return {
    ok: true,
    command: 'backup-verify',
    file_name: fileName,
    manifest_name: path.basename(manifestPath),
    bytes: verified.bytes,
    sha256: verified.manifest.file.sha256,
    plaintext_sha256: verified.manifest.file.plaintext_sha256,
    created_at: verified.manifest.created_at,
    source: verified.manifest.source,
    encryption: verified.manifest.encryption,
    integrity_verified: true,
    checksum_verified: true,
    authenticated: true,
    restore_verified: false,
    message: 'Package integrity is verified. A restore test on an isolated target is still required.',
    package: summary
  }
}

async function audit(
  ctx: AdminRequestContext,
  correlationId: string,
  action: string,
  after: Record<string, unknown>,
  auth?: AdminSession
): Promise<void> {
  const event = {
    event: 'bar_local.admin.audit',
    action,
    correlation_id: correlationId,
    device_id: auth?.deviceId ?? null,
    staff_id: auth?.context.staff_id ?? null,
    business_id: auth?.context.business_id ?? null,
    outlet_id: auth?.context.outlet_id ?? null,
    after
  }
  ctx.logger?.info?.(event)
  try {
    await ctx.pool.query(
      `SELECT bar_local.service_admin_audit($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::jsonb)`,
      [auth?.context.business_id ?? null, auth?.context.outlet_id ?? null, auth?.context.staff_id ?? null, auth?.deviceId ?? null, action, JSON.stringify(after)]
    )
  } catch (error) {
    ctx.logger?.error?.({
      event: 'bar_local.admin.audit_failed',
      action,
      correlation_id: correlationId,
      message: error instanceof Error ? error.message : 'Unknown audit failure.'
    })
    throw new BarLocalError('ADMIN_AUDIT_WRITE_FAILED' as BarLocalErrorCode, 'The operation result could not be written to the local audit log. Review the service log before retrying; the requested action may already have completed.', {
      httpStatus: 503,
      details: { action, correlation_id: correlationId, action_may_have_completed: true },
      cause: error
    })
  }
}

function replicationConfigView(config: ServiceConfig): Record<string, unknown> {
  return {
    role: config.replication.role,
    coordinator: config.replication.coordinator,
    admin_database_configured: Boolean(config.replication.adminDatabaseUrl),
    standby_admin_database_configured: Boolean(config.replication.standbyAdminDatabaseUrl),
    pg_data_dir: config.replication.pgDataDir,
    pg_bin: config.replication.pgBin
  }
}

function withFailoverEvidence<T extends { automatic_failover: { verified: boolean; detail: string } }>(
  report: T,
  failover: Record<string, unknown> | null
): T {
  const automatic = isRecord(failover) && isRecord(failover.automatic_failover) ? failover.automatic_failover : null
  if (automatic?.verified !== true || typeof automatic.detail !== 'string') return report
  return { ...report, automatic_failover: { verified: true, detail: automatic.detail } }
}

function failoverConfigView(config: ServiceConfig): Record<string, unknown> {
  const witnessUrl = config.failover.witnessUrl
  let witnessOrigin: string | null = null
  if (witnessUrl) {
    try {
      witnessOrigin = new URL(witnessUrl).origin
    } catch {
      witnessOrigin = null
    }
  }
  return {
    mode: config.failover.mode,
    role: config.failover.role,
    cluster_id: config.failover.clusterId,
    instance_id: config.failover.instanceId,
    witness_origin: witnessOrigin,
    authority_url: config.failover.authorityUrl,
    lease_ttl_ms: config.failover.leaseTtlMs,
    renew_interval_ms: config.failover.renewIntervalMs,
    poll_interval_ms: config.failover.pollIntervalMs,
    catchup_timeout_ms: config.failover.catchupTimeoutMs,
    promote_timeout_seconds: config.failover.promoteTimeoutSeconds,
    manual_switchover_available: true
  }
}

function switchoverRecovery(report: SwitchoverReport): Record<string, unknown> {
  return {
    ok: false,
    command: 'replication-switchover',
    coordinator: report.coordinator,
    authority_state: report.authority_state,
    client_repoint_required: report.client_repoint_required,
    fenced: report.fenced,
    promoted: report.promoted,
    operations: report.operations,
    error: report.error,
    checked_at: report.checked_at,
    recovery: {
      message: report.authority_state === 'fenced_no_promotion'
        ? 'The previous primary has been fenced but the standby was not promoted. Keep all clients stopped, inspect the postgres logs, and complete promotion manually under the documented recovery procedure.'
        : 'Fencing could not be verified. Keep all clients stopped and complete manual recovery before resuming trade.',
      do_not_rollback: true,
      do_not_restart_clients: true
    }
  }
}

function redactReceiverUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const url = new URL(value)
    if (url.username || url.password) {
      url.username = '***'
      url.password = '***'
    }
    return url.toString()
  } catch {
    return null
  }
}

function cloudSyncStatusView(status: CloudSyncStatus | null, transport: string, secretConfigured: boolean): Record<string, unknown> {
  if (!status) {
    return { available: false, transport, signing_secret_configured: secretConfigured }
  }
  return {
    available: true,
    transport,
    signing_secret_configured: secretConfigured,
    ...status,
    receiver_url: redactReceiverUrl(status.receiver_url)
  }
}

export function createAdminHandler(authenticate: AdminAuthenticate, options: AdminHandlerOptions = {}) {
  return async function handleAdmin(
    ctx: AdminRequestContext,
    req: IncomingMessage,
    res: ServerResponse,
    correlationId: string,
    url: URL
  ): Promise<boolean> {
    const pathname = url.pathname
    const isAdminPath = pathname === '/v1/admin' || pathname.startsWith('/v1/admin/')
    if (!isAdminPath) return false

    const method = req.method ?? 'GET'
    const known =
      (method === 'GET' && pathname === '/v1/admin/status') ||
      (method === 'GET' && pathname === '/v1/admin/replacement') ||
      (method === 'GET' && pathname === '/v1/admin/backup') ||
      (method === 'POST' && pathname === '/v1/admin/backup') ||
      (method === 'POST' && pathname === '/v1/admin/backup/verify') ||
      (method === 'POST' && pathname === '/v1/admin/backup/restore-drill') ||
      (method === 'GET' && pathname === '/v1/admin/recovery') ||
      (method === 'GET' && pathname === '/v1/admin/recovery/job') ||
      (method === 'POST' && pathname === '/v1/admin/recovery/base') ||
      (method === 'POST' && pathname === '/v1/admin/recovery/copy') ||
      (method === 'POST' && pathname === '/v1/admin/recovery/destination') ||
      (method === 'POST' && pathname === '/v1/admin/recovery/drill') ||
      (method === 'POST' && pathname === '/v1/admin/recovery/keys') ||
      (method === 'GET' && pathname === '/v1/admin/replication') ||
      (method === 'POST' && pathname === '/v1/admin/replication/durability') ||
      (method === 'POST' && pathname === '/v1/admin/replication/switchover') ||
      (method === 'GET' && pathname === '/v1/admin/failover') ||
      (method === 'POST' && pathname === '/v1/admin/failover/fence') ||
      (method === 'GET' && pathname === '/v1/admin/cloud-sync') ||
      (method === 'POST' && pathname === '/v1/admin/cloud-sync/config') ||
      (method === 'POST' && pathname === '/v1/admin/cloud-sync/run') ||
      (method === 'GET' && pathname === '/v1/admin/update') ||
      (method === 'POST' && pathname === '/v1/admin/update/stage') ||
      (method === 'POST' && pathname === '/v1/admin/update/apply')
    if (!known) return false

    const query: SqlQuery = options.query ?? ((sql, params) => ctx.pool.query(sql, params ? [...params] : undefined).then((result) => ({ rows: result.rows as Record<string, unknown>[] })))
    const now = options.now ?? (() => new Date())

    try {
      if (pathname === '/v1/admin/replication/durability' || pathname === '/v1/admin/replication/switchover' || pathname === '/v1/admin/failover/fence') {
        requireLoopback(req)
      }
      const auth = await authenticate(ctx, req)

      if (pathname === '/v1/admin/replacement') {
        requireCapability(auth, ADMIN_CAPABILITY)
        const replacement = await queryOne(query, 'SELECT bar_local.service_failover_status() AS result')
        sendJson(res, 200, { ok: true, replacement: replacement?.result ?? null }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/recovery' || pathname.startsWith('/v1/admin/recovery/')) {
        requireCapability(auth, BACKUP_CAPABILITY)
        if (method === 'GET') {
          const response = pathname.endsWith('/job') ? { job: await recoveryJobStatus(ctx.config, url.searchParams.get('id') ?? '') } : { recovery: await recoveryStatus(ctx.config) }
          sendJson(res, 200, { ok: true, ...response }, correlationId)
          return true
        }
        requireLoopback(req)
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        if (pathname.endsWith('/destination')) {
          allowOnlyKeys(body, ['folder', 'confirm'])
          if (body.confirm !== 'SET_RECOVERY_DESTINATION') throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'Confirm SET_RECOVERY_DESTINATION before choosing a recovery folder.')
          const identity = await queryOne(query, 'SELECT bar_local.service_failover_status() AS result')
          const authority = isRecord(identity?.result) ? identity.result.authority_id : null
          if (typeof authority !== 'string') throw new BarLocalError(BAR_LOCAL_ERROR_CODES.SERVICE_UNAVAILABLE, 'The commissioned authority is unavailable.')
          const result = await setRecoveryCopyDestination(ctx.config, string(body.folder, 'folder', { min: 1, max: 4096 }), authority)
          await audit(ctx, correlationId, 'admin.recovery.destination_changed', { destination: result.destination }, auth)
          sendJson(res, 200, { ok: true, result }, correlationId)
          return true
        }
        allowOnlyKeys(body, ['confirm', 'reason', 'base_id', 'target_time', 'passphrase', 'request_id'])
        const reason = stringField(body, 'reason', { min: 8, max: 500 })
        const confirm = stringField(body, 'confirm', { max: 50 })
        const expected = pathname.endsWith('/base') ? 'CREATE_RECOVERY_BASE' : pathname.endsWith('/copy') ? 'COPY_RECOVERY_SET' : pathname.endsWith('/keys') ? 'EXPORT_RECOVERY_KEYS' : 'VERIFY_RECOVERY_POINT'
        if (confirm !== expected) throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, `Type ${expected} to confirm this recovery action.`)
        await audit(ctx, correlationId, 'admin.recovery.requested', { action: expected, reason }, auth)
        try {
          const result = pathname.endsWith('/keys') ? await exportRecoveryKeys(ctx.config, string(body.passphrase, 'passphrase', { min: 12, max: 1024 }))
            : await startRecoveryJob(ctx.config, { id: string(body.request_id, 'request_id', { min: 36, max: 36 }), kind: pathname.endsWith('/base') ? 'base' : pathname.endsWith('/copy') ? 'copy' : 'drill', reason: reason!, ...(pathname.endsWith('/drill') ? { base_id: string(body.base_id, 'base_id', { min: 36, max: 36 }), target_time: string(body.target_time, 'target_time', { min: 20, max: 40 }) } : {}) })
          // Never audit passphrases, key bundles or database connection details.
          await audit(ctx, correlationId, pathname.endsWith('/keys') ? 'admin.recovery.keys_exported' : 'admin.recovery.job_started', { action: expected, reason }, auth)
          sendJson(res, 200, { ok: true, result }, correlationId)
          return true
        } catch (error) {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.SERVICE_UNAVAILABLE, error instanceof Error ? error.message : 'Recovery could not be verified. Keep the original files and retry after resolving the cause.', { httpStatus: 503 })
        }
      }

      if (pathname === '/v1/admin/status') {
        requireCapability(auth, ADMIN_CAPABILITY)
        const failoverStatus = options.failover
          ? await options.failover.status().catch(() => null)
          : null
        sendJson(res, 200, await buildAdminStatus(ctx.config, { query, now: now(), failover: failoverStatus }), correlationId)
        return true
      }

      if (pathname === '/v1/admin/backup' && method === 'GET') {
        requireCapability(auth, BACKUP_CAPABILITY)
        const packages = await listBackupPackages(ctx.config.backup)
        let copyPackages: BackupPackageSummary[] | null = []
        let copyDestinationStatus: 'not_configured' | 'available' | 'unavailable' = ctx.config.backup.copyToDir ? 'available' : 'not_configured'
        let copyDestinationError: string | null = null
        if (ctx.config.backup.copyToDir) {
          try {
            copyPackages = await listBackupPackages({ ...ctx.config.backup, dir: ctx.config.backup.copyToDir })
          } catch (error) {
            copyPackages = null
            copyDestinationStatus = 'unavailable'
            copyDestinationError = error instanceof BackupToolError ? error.code : 'BACKUP_COPY_DESTINATION_UNAVAILABLE'
          }
        }
        const schedule = await buildBackupScheduleHealth(ctx.config.backup, packages[0] ?? null, now())
        sendJson(res, 200, {
          ok: true,
          command: 'backup-list',
          configured: Boolean(ctx.config.backup.databaseUrl && ctx.config.backup.keyConfigured),
          destination: ctx.config.backup.dir,
          copy_destination: ctx.config.backup.copyToDir,
          copy_destination_status: copyDestinationStatus,
          copy_destination_error: copyDestinationError,
          key_configured: ctx.config.backup.keyConfigured,
          retention: ctx.config.backup.retention,
          schedule_installed: schedule.schedule_installed,
          schedule,
          latest: packages[0] ?? null,
          packages,
          copy_packages: copyPackages
        }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/backup' && method === 'POST') {
        requireCapability(auth, BACKUP_CAPABILITY)
        req.setTimeout(0)
        res.setTimeout(0)
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        sendJson(res, 200, await createBackup(ctx, body, correlationId, auth), correlationId)
        return true
      }

      if (pathname === '/v1/admin/backup/verify') {
        requireCapability(auth, BACKUP_CAPABILITY)
        req.setTimeout(0)
        res.setTimeout(0)
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        sendJson(res, 200, await verifyBackup(ctx, body, correlationId, auth), correlationId)
        return true
      }

      if (pathname === '/v1/admin/backup/restore-drill') {
        requireCapability(auth, BACKUP_CAPABILITY)
        requireLoopback(req)
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        allowOnlyKeys(body, ['file_name', 'authorized_by', 'reason', 'confirm'])
        const confirm = stringField(body, 'confirm', { max: 40 })
        if (confirm !== 'RESTORE_DRILL') {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'confirm must be the exact value RESTORE_DRILL.', { httpStatus: 400 })
        }
        const fileName = stringField(body, 'file_name', { max: 255 })
        if (!fileName || !/\.(blbkup|blb)$/i.test(fileName)) {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'file_name must be a backup package basename ending in .blbkup or .blb.', { httpStatus: 400 })
        }
        const authorizedBy = stringField(body, 'authorized_by', { min: 3, max: 120 }) ?? ''
        const reason = stringField(body, 'reason', { min: 8, max: 500 }) ?? ''
        req.setTimeout(0)
        res.setTimeout(0)
        // Record intent before creating any temporary cluster. If this audit
        // cannot be written, nothing has been restored yet and the operator can
        // retry safely.
        await audit(ctx, correlationId, 'admin.backup.restore_drill_started', { file_name: fileName, authorized_by: authorizedBy, reason }, auth)
        let report: Awaited<ReturnType<typeof runRestoreDrill>>
        try {
          report = await runRestoreDrill({
            config: ctx.config,
            fileName,
            authorizedBy,
            reason,
            now
          })
        } catch (error) {
          const code = error instanceof BackupToolError ? error.code : 'RESTORE_DRILL_FAILED'
          try {
            await audit(ctx, correlationId, 'admin.backup.restore_drill_failed', {
              file_name: fileName,
              authorized_by: authorizedBy,
              reason,
              error_code: code,
              message: error instanceof Error ? error.message.slice(0, 500) : 'unknown restore drill failure'
            }, auth)
          } catch (auditError) {
            ctx.logger?.error?.({
              event: 'bar_local.admin.audit_failed',
              action: 'admin.backup.restore_drill_failed',
              correlation_id: correlationId,
              message: auditError instanceof Error ? auditError.message : 'Unknown audit failure.'
            })
          }
          throw error
        }
        await audit(ctx, correlationId, 'admin.backup.restore_drill_verified', {
          file_name: fileName,
          checks: report.checks,
          evidence_path: report.evidence_path,
          package_sha256: report.package.sha256,
          authorized_by: authorizedBy,
          reason
        }, auth)
        sendJson(res, 200, report as unknown as Record<string, unknown>, correlationId)
        return true
      }

      if (pathname === '/v1/admin/replication' && method === 'GET') {
        requireCapability(auth, ADMIN_CAPABILITY)
        const inspected = await inspectReplication({ query }, ctx.config.replication, {
          ...options.replicationDependencies,
          query,
          now
        })
        const failoverStatus = options.failover ? await options.failover.status().catch(() => null) : null
        const replication = withFailoverEvidence(inspected, failoverStatus)
        sendJson(res, 200, {
          ok: true,
          command: 'replication-status',
          replication,
          config: replicationConfigView(ctx.config)
        }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/replication/durability') {
        requireCapability(auth, ADMIN_CAPABILITY)
        requireLoopback(req)
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        allowOnlyKeys(body, ['profile'])
        const profile = stringField(body, 'profile', { max: 40 })
        if (profile !== 'single_host' && profile !== 'synchronous_one_standby') {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'profile must be single_host or synchronous_one_standby.')
        }
        req.setTimeout(0)
        res.setTimeout(0)
        await audit(ctx, correlationId, 'admin.replication.durability_started', { profile }, auth)
        const report = await setDurability(ctx.config.replication, profile, options.replicationDependencies)
        await audit(ctx, correlationId, 'admin.replication.durability_set', { ...report }, auth)
        sendJson(res, 200, { command: 'replication-durability', ...report }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/replication/switchover') {
        requireCapability(auth, ADMIN_CAPABILITY)
        requireLoopback(req)
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        allowOnlyKeys(body, ['confirm', 'reason'])
        const confirm = stringField(body, 'confirm', { max: 40 })
        if (confirm !== 'SWITCHOVER') {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'confirm must be the exact value SWITCHOVER.')
        }
        const reason = stringField(body, 'reason', { min: 3, max: 500 })
        req.setTimeout(0)
        res.setTimeout(0)
        await audit(ctx, correlationId, 'admin.replication.switchover_started', { reason }, auth)
        const report = await switchover(ctx.config.replication, options.replicationDependencies)
        await audit(ctx, correlationId, 'admin.replication.switchover', {
          authority_state: report.authority_state,
          client_repoint_required: report.client_repoint_required,
          fenced: report.fenced,
          promoted: report.promoted,
          error: report.error,
          reason
        }, auth)
        if (!report.ok) {
          sendJson(res, 409, switchoverRecovery(report), correlationId)
          return true
        }
        sendJson(res, 200, {
          ok: true,
          command: 'replication-switchover',
          coordinator: report.coordinator,
          authority_state: report.authority_state,
          client_repoint_required: report.client_repoint_required,
          fenced: report.fenced,
          promoted: report.promoted,
          operations: report.operations,
          checked_at: report.checked_at
        }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/failover' && method === 'GET') {
        requireCapability(auth, ADMIN_CAPABILITY)
        if (!options.failover) {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.SERVICE_UNAVAILABLE, 'Automatic failover is not running in this process.', { httpStatus: 503 })
        }
        sendJson(res, 200, {
          ok: true,
          command: 'failover-status',
          failover: await options.failover.status(),
          config: failoverConfigView(ctx.config)
        }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/failover/fence') {
        requireCapability(auth, ADMIN_CAPABILITY)
        requireLoopback(req)
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        allowOnlyKeys(body, ['confirm', 'reason'])
        const confirm = stringField(body, 'confirm', { max: 40 })
        if (confirm !== 'FENCE') {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'confirm must be the exact value FENCE.')
        }
        const reasonField = stringField(body, 'reason', { min: 3, max: 80 })
        if (reasonField === null || !/^[A-Z][A-Z0-9_]{2,80}$/.test(reasonField)) {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'reason must be an upper-case code such as OPERATOR_FENCE, 3 to 80 characters.')
        }
        const reason = reasonField
        if (!options.failover) {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.SERVICE_UNAVAILABLE, 'Automatic failover is not running in this process.', { httpStatus: 503 })
        }
        // Record intent before fencing. If the audit cannot be written, nothing
        // has been fenced yet and the operator can retry safely.
        await audit(ctx, correlationId, 'admin.failover.fence_requested', { reason }, auth)
        const status = await options.failover.fence(reason)
        let auditRecorded = true
        try {
          await audit(ctx, correlationId, 'admin.failover.fence', {
            reason,
            gate: status.gate,
            local: status.local,
            lease: status.lease
          }, auth)
        } catch (error) {
          auditRecorded = false
          ctx.logger?.error?.({
            event: 'bar_local.admin.audit_failed',
            action: 'admin.failover.fence',
            correlation_id: correlationId,
            message: error instanceof Error ? error.message : 'Unknown audit failure.'
          })
        }
        sendJson(res, 200, {
          ok: true,
          command: 'failover-fence',
          audit_recorded: auditRecorded,
          failover: status,
          // The fence stops this copy only; tills must be repointed after the
          // standby is promoted, otherwise they will keep retrying a dead host.
          client_repoint_required: true,
          recovery: 'Do not unfence this host. Enrol it again as a standby from the promoted primary, then repoint tills to the stable authority address.'
        }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/cloud-sync' && method === 'GET') {
        requireCapability(auth, ADMIN_CAPABILITY)
        if (!options.cloudSync) {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.SERVICE_UNAVAILABLE, 'The cloud synchronisation worker is not available in this process.', { httpStatus: 503 })
        }
        const status = await options.cloudSync.status()
        sendJson(res, 200, {
          ok: true,
          command: 'cloud-sync-status',
          status: cloudSyncStatusView(status, options.cloudSync.transport, Boolean(ctx.config.cloudSync.secret && ctx.config.cloudSync.secret.length >= 32))
        }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/cloud-sync/config') {
        requireCapability(auth, ADMIN_CAPABILITY)
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        allowOnlyKeys(body, ['enabled', 'receiver_url', 'schedule_mode', 'daily_at', 'batch_limit', 'signing_key_id'])
        if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'enabled must be true or false.')
        }
        // Save only the fields the operator actually changed. Omitted keys keep
        // their committed value, so a partial form cannot silently clear the
        // receiver address, schedule, batch limit or signing key identifier.
        const config: Record<string, unknown> = {}
        if (body.enabled !== undefined) {
          config.enabled = body.enabled
        }
        if (body.receiver_url !== undefined) {
          const receiverUrl = body.receiver_url === null ? null : stringField(body, 'receiver_url', { max: 500 })
          if (receiverUrl !== null) {
            let parsed: URL
            try {
              parsed = new URL(receiverUrl)
            } catch {
              throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'receiver_url must be a valid http or https URL.')
            }
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'receiver_url must use http or https.')
            }
            if (ctx.config.cloudSync.transport === 'local_test') {
              const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
              if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
                throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'The local_test transport only permits a loopback receiver URL.')
              }
            }
          }
          config.receiver_url = receiverUrl
        }
        if (body.schedule_mode !== undefined) {
          config.schedule_mode = enumeration(body.schedule_mode, 'schedule_mode', ['fifteen_minutes', 'daily'])
        }
        if (body.daily_at !== undefined) {
          config.daily_at = body.daily_at === null
            ? null
            : string(body.daily_at, 'daily_at', { min: 5, max: 5, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ })
        }
        if (body.batch_limit !== undefined) {
          const parsed = Number(body.batch_limit)
          if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
            throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'batch_limit must be a whole number between 1 and 1000.')
          }
          config.batch_limit = parsed
        }
        if (body.signing_key_id !== undefined) {
          config.signing_key_id = body.signing_key_id === null ? null : stringField(body, 'signing_key_id', { max: 120 })
        }
        const status = await callFunction<CloudSyncStatus>(ctx.pool, 'bar_local.cloud_sync_config_set', [
          { value: auth.tokenHash, cast: 'text' },
          { value: auth.deviceId, cast: 'uuid' },
          {
            value: JSON.stringify(config),
            cast: 'jsonb'
          }
        ])
        sendJson(res, 200, {
          ok: true,
          command: 'cloud-sync-config',
          status: cloudSyncStatusView(status, ctx.config.cloudSync.transport, Boolean(ctx.config.cloudSync.secret && ctx.config.cloudSync.secret.length >= 32))
        }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/cloud-sync/run') {
        requireCapability(auth, ADMIN_CAPABILITY)
        if (!options.cloudSync) {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.SERVICE_UNAVAILABLE, 'The cloud synchronisation worker is not available in this process.', { httpStatus: 503 })
        }
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        allowOnlyKeys(body, ['final'])
        if (body.final !== undefined && typeof body.final !== 'boolean') {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'final must be true or false.')
        }
        req.setTimeout(0)
        res.setTimeout(0)
        const result = await options.cloudSync.runNow({ final: body.final === true, reason: 'admin_sync_now' })
        const detail = result.status_detail ?? null
        const { status_detail: _statusDetail, ...publicResult } = result
        sendJson(res, 200, {
          ok: result.status !== 'failed',
          command: 'cloud-sync-run',
          ...publicResult,
          status_detail: cloudSyncStatusView(detail, ctx.config.cloudSync.transport, Boolean(ctx.config.cloudSync.secret && ctx.config.cloudSync.secret.length >= 32))
        }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/update') {
        requireCapability(auth, ADMIN_CAPABILITY)
        const schemaState = await readUpdateSchemaState(ctx)
        const trust = await describeUpdateTrust(ctx.config)
        const staged = await readStagedUpdate(ctx.config)
        const inbox = await listUpdateInbox(ctx.config).catch(() => null)
        const lastApply = await readLastUpdateReport(ctx.config)
        const lastFailure = await readLastUpdateFailure(ctx.config)
        const restartRequired = typeof lastApply?.version === 'string' && lastApply.version !== ctx.config.service.version
        const stagedPresent = staged.state === 'staged' && staged.staged !== null
        sendJson(res, 200, {
          ok: true,
          command: 'update-status',
          service_version: ctx.config.service.version,
          schema_version: schemaState.schemaVersion,
          schema_migration: schemaState.schemaMigration,
          contract_version: CONTRACT_VERSION,
          staging_dir: ctx.config.updates.stagingDir,
          inbox_dir: ctx.config.updates.inboxDir,
          install_dir: ctx.config.updates.installDir,
          apply_enabled: ctx.config.updates.applyEnabled,
          trust,
          inbox: inbox ? inbox.packages : [],
          inbox_truncated: inbox ? inbox.truncated : false,
          inbox_error: inbox ? null : 'The update inbox could not be read.',
          staged_state: staged.state,
          staged: staged.staged,
          staged_message: staged.message,
          staged_error_code: staged.error_code,
          lock_present: staged.lock_present,
          last_apply: lastApply,
          last_failure: lastFailure,
          restart_required: restartRequired,
          restart_scheduled: restartRequired && Boolean(options.requestRestart),
          status: staged.state === 'staged' ? 'staged' : staged.state === 'invalid' ? 'invalid' : 'idle',
          availability_checked: false,
          update_available: stagedPresent,
          automatic_install_supported: false,
          message: restartRequired
            ? (options.requestRestart ? 'The last update applied and the Bar service restart is scheduled.' : 'The last update applied, but the Bar service version has not changed yet. Restart the service from Windows Services before trading.')
            : staged.message
        }, correlationId)
        return true
      }

      if (pathname === '/v1/admin/update/stage') {
        requireCapability(auth, ADMIN_CAPABILITY)
        requireLoopback(req)
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        allowOnlyKeys(body, ['package', 'confirm'])
        const confirm = stringField(body, 'confirm', { max: 40 })
        if (confirm !== 'STAGE_UPDATE') {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'confirm must be the exact value STAGE_UPDATE.', { httpStatus: 400 })
        }
        const packageName = stringField(body, 'package', { max: 160 }) ?? ''
        const schemaState = await readUpdateSchemaState(ctx)
        if (schemaState.schemaVersion === null) {
          throw new BarLocalError(
            'UPDATE_SCHEMA_UNKNOWN' as BarLocalErrorCode,
            'The current local schema version could not be read, so update compatibility cannot be proven.',
            { httpStatus: 503 }
          )
        }
        await audit(ctx, correlationId, 'admin.update.stage_started', { package: packageName }, auth)
        try {
          const result = await stageUpdatePackage(ctx.config, {
            packageName,
            currentSchemaVersion: schemaState.schemaVersion,
            currentContractVersion: CONTRACT_VERSION
          }, { now })
          await audit(ctx, correlationId, 'admin.update.staged', {
            package: result.staged.package,
            version: result.staged.version,
            manifest_sha256: result.staged.manifest_sha256,
            signature_key_id: result.staged.signature_key_id,
            schema_version: schemaState.schemaVersion,
            contract_version: CONTRACT_VERSION
          }, auth)
          sendJson(res, 200, { ...result }, correlationId)
        } catch (error) {
          await audit(ctx, correlationId, 'admin.update.stage_failed', {
            package: packageName,
            error_code: error instanceof UpdateValidationError ? error.code : 'UPDATE_STAGE_FAILED',
            message: error instanceof Error ? error.message.slice(0, 500) : 'unknown staging failure'
          }, auth).catch(() => {})
          throw error
        }
        return true
      }

      if (pathname === '/v1/admin/update/apply') {
        requireCapability(auth, ADMIN_CAPABILITY)
        requireLoopback(req)
        const body = await readJson(req, { limitBytes: ctx.config.http.bodyLimitBytes })
        allowOnlyKeys(body, ['confirm', 'authorized_by', 'reason'])
        const confirm = stringField(body, 'confirm', { max: 40 })
        if (confirm !== 'APPLY_UPDATE') {
          throw new BarLocalError(BAR_LOCAL_ERROR_CODES.VALIDATION_FAILED, 'confirm must be the exact value APPLY_UPDATE.', { httpStatus: 400 })
        }
        const authorizedBy = stringField(body, 'authorized_by', { min: 3, max: 120 }) ?? ''
        const reason = stringField(body, 'reason', { min: 8, max: 500 }) ?? ''
        const schemaState = await readUpdateSchemaState(ctx)
        if (schemaState.schemaVersion === null) {
          throw new BarLocalError(
            'UPDATE_SCHEMA_UNKNOWN' as BarLocalErrorCode,
            'The current local schema version could not be read, so update compatibility cannot be proven.',
            { httpStatus: 503 }
          )
        }
        req.setTimeout(0)
        res.setTimeout(0)
        await audit(ctx, correlationId, 'admin.update.apply_started', {
          authorized_by: authorizedBy,
          reason,
          schema_version: schemaState.schemaVersion,
          contract_version: CONTRACT_VERSION
        }, auth)
        let checkpointPath: string | null = null
        try {
          const result = await applyUpdatePackage(ctx.config, {
            currentSchemaVersion: schemaState.schemaVersion,
            currentContractVersion: CONTRACT_VERSION,
            authorizedBy,
            reason
          }, {
            now,
            assertNoUnresolvedWork: () => assertNoUnresolvedUpdateWork(ctx),
            createCheckpoint: async (context) => {
              const report = await createBackupReport(ctx, `pre-update-${context.version}`)
              const verifiedCheckpoint = await verifyBackupPackage(report.backup.manifest_path)
              if (verifiedCheckpoint.sha256 !== report.backup.sha256
                || path.resolve(verifiedCheckpoint.backupPath) !== path.resolve(report.backup.file_path)) {
                throw new BackupToolError('BACKUP_TAMPERED', 'The encrypted pre-update checkpoint changed after creation. The update was stopped before changing installed files.')
              }
              checkpointPath = report.backup.file_path
              await audit(ctx, correlationId, 'admin.update.checkpoint_created', {
                version: context.version,
                file_name: report.backup.file_name,
                sha256: verifiedCheckpoint.sha256,
                manifest_sha256: context.manifestSha256
              }, auth)
              return { path: verifiedCheckpoint.backupPath, sha256: verifiedCheckpoint.sha256 }
            }
          })
          await audit(ctx, correlationId, 'admin.update.applied', {
            authorized_by: authorizedBy,
            reason,
            version: result.version,
            installed_version: result.installed_version,
            applied_files: result.applied_files,
            checkpoint_path: result.checkpoint_path,
            checkpoint_sha256: result.checkpoint_sha256,
            signature_key_id: result.signature_key_id,
            staged_package_removed: result.staged_package_removed
          }, auth)
          if (options.requestRestart) {
            res.once('finish', () => {
              const timer = setTimeout(options.requestRestart!, 1000)
              timer.unref?.()
            })
          }
          sendJson(res, 200, { ...result }, correlationId)
        } catch (error) {
          await audit(ctx, correlationId, 'admin.update.apply_failed', {
            authorized_by: authorizedBy,
            reason,
            error_code: error instanceof UpdateValidationError ? error.code : 'UPDATE_APPLY_FAILED',
            message: error instanceof Error ? error.message.slice(0, 500) : 'unknown update failure',
            checkpoint_path: checkpointPath
          }, auth).catch(() => {})
          throw error
        }
        return true
      }

      return false
    } catch (error) {
      sendAdminError(res, error, correlationId)
      return true
    }
  }
}
