import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import pg from 'pg'
import type { ServiceConfig } from '../config.js'
import {
  BackupToolError,
  loadEncryptionKey,
  restoreBackupPackageToDatabase,
  verifyBackupPackage,
  verifyRestoredDatabase
} from './backup.js'
import type { RestoreVerificationReport, VerificationClient } from './backup.js'

const { Client: PgClient } = pg

const DRILL_DATABASE = 'bar_local_test_restore_drill'
const MIGRATION_OWNER = 'bar_local_migrator'
const DRILL_LOCK_NAME = 'restore-drill.lock'
const DRILL_MIN_FREE_BYTES = 320 * 1024 * 1024
const DRILL_TIMEOUT_MS = 15 * 60 * 1000
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/

export interface RestoreDrillOptions {
  readonly config: ServiceConfig
  readonly fileName: string
  readonly authorizedBy: string
  readonly reason: string
  readonly now?: () => Date
}

export interface RestoreDrillReport {
  readonly ok: true
  readonly command: 'backup-restore-drill'
  readonly status: 'verified'
  readonly file_name: string
  readonly manifest_name: string
  readonly started_at: string
  readonly completed_at: string
  readonly target: { readonly host: string; readonly port: number; readonly database: string }
  readonly package: {
    readonly created_at: string
    readonly bytes: number
    readonly sha256: string
    readonly plaintext_sha256: string
    readonly source_database: string
  }
  readonly verification: RestoreVerificationReport
  readonly checks: { readonly total: number; readonly passed: number; readonly failed: number }
  readonly cleanup: { readonly cluster_stopped: boolean; readonly data_removed: boolean }
  readonly evidence_path: string
  readonly message: string
  readonly pitr_available: false
}

type RestoreDrillBaseReport = Omit<RestoreDrillReport, 'cleanup' | 'ok' | 'command' | 'status'>

function assertBackupFileName(value: string): string {
  const name = value.trim()
  if (!/\.(blbkup|blb)$/i.test(name) || path.basename(name) !== name) {
    throw new BackupToolError('RESTORE_DRILL_PACKAGE_INVALID', 'Choose a backup package basename ending in .blbkup or .blb from the configured destination.')
  }
  return name
}

async function findManifest(directory: string, fileName: string): Promise<{ manifestName: string; manifestPath: string }> {
  const names = await readdir(directory)
  const matches: string[] = []
  for (const name of names.filter((entry) => entry.endsWith('.manifest.json'))) {
    const manifestPath = path.join(directory, name)
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as { file?: { name?: unknown } }
      if (parsed.file?.name === fileName) matches.push(name)
    } catch {
      // A malformed manifest is reported by verifyBackupPackage when it is selected.
    }
  }
  if (matches.length === 0) {
    throw new BackupToolError('RESTORE_DRILL_MANIFEST_MISSING', 'No manifest in the backup destination describes that package. Verify the destination and choose a complete backup.')
  }
  if (matches.length > 1) {
    throw new BackupToolError('RESTORE_DRILL_MANIFEST_AMBIGUOUS', 'More than one manifest describes that package. Preserve the destination and resolve the duplicate manifests before running a drill.')
  }
  return { manifestName: matches[0], manifestPath: path.join(directory, matches[0]) }
}

function freeLoopbackPort(avoidPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        if (error) reject(error)
        else if (!Number.isInteger(port) || port < 1024 || port === avoidPort || port === 5432) reject(new Error('The operating system did not return a safe loopback port for the drill cluster.'))
        else resolve(port)
      })
    })
  })
}

async function connectClient(options: { host: string; port: number; database: string; user: string; password?: string }): Promise<VerificationClient & { end: () => Promise<void> }> {
  const client = new PgClient({
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    password: options.password ?? '',
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
    application_name: 'bar-local-restore-drill'
  })
  await client.connect()
  return {
    query: async (sql, params) => {
      const result = await client.query(sql, params ? [...params] : undefined)
      return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount }
    },
    end: () => client.end()
  }
}

async function waitForCluster(options: { host: string; port: number; user: string }, deadline: number): Promise<void> {
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      const client = await connectClient({ ...options, database: 'postgres' })
      await client.end()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new BackupToolError('RESTORE_DRILL_START_FAILED', `The temporary PostgreSQL drill cluster did not accept connections: ${lastError instanceof Error ? lastError.message : 'unknown error'}`)
}

/**
 * Run a PostgreSQL control tool (initdb, pg_ctl) with output discarded.
 *
 * pg_ctl start launches a long-lived postgres server that inherits the parent
 * process handles on Windows. Capturing the tool's stdout/stderr would keep the
 * pipe open for the lifetime of the server and the command would appear to hang
 * forever even after a timeout. These tools report through their log file and
 * exit code, so their output is intentionally ignored here.
 *
 * The timeout settles the wait immediately instead of waiting for a close event
 * that a grandchild process may never release.
 */
function runTool(name: string, command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env },
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true
    })
    let settled = false
    const settle = (error: Error | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      child.kill()
      settle(new BackupToolError('RESTORE_DRILL_TOOL_FAILED', `${name} exceeded its ${Math.round(timeoutMs / 1000)} second timeout. Stop any leftover drill cluster before retrying.`))
    }, timeoutMs)
    timer.unref?.()
    child.once('error', (error: NodeJS.ErrnoException) => {
      settle(new BackupToolError('RESTORE_DRILL_TOOL_FAILED', `${name} could not be started (${error.code ?? 'UNKNOWN'}): ${command}`))
    })
    child.once('close', (code) => {
      if (code === 0) settle(null)
      else settle(new BackupToolError('RESTORE_DRILL_TOOL_FAILED', `${name} failed with exit code ${code ?? 'unknown'}.`))
    })
  })
}

async function writeReport(root: string, report: Record<string, unknown>): Promise<string> {
  const directory = path.join(root, 'reports')
  await mkdir(directory, { recursive: true })
  const finalPath = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`)
  const temporary = `${finalPath}.tmp`
  await writeFile(temporary, JSON.stringify(report, null, 2), 'utf8')
  await rename(temporary, finalPath)
  return finalPath
}

async function acquireLock(root: string, fileName: string): Promise<{ release: () => Promise<void> }> {
  await mkdir(root, { recursive: true })
  const lockPath = path.join(root, DRILL_LOCK_NAME)
  try {
    const handle = await open(lockPath, 'wx')
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, file_name: fileName, started_at: new Date().toISOString() }), 'utf8')
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'EEXIST') {
      throw new BackupToolError('RESTORE_DRILL_IN_PROGRESS', `Another restore drill lock exists at ${lockPath}. Wait for the running drill to finish. If no drill is running, inspect the lock and remove it deliberately before retrying.`)
    }
    throw error
  }
  return {
    release: async () => {
      await rm(lockPath, { force: true }).catch(() => {})
    }
  }
}

function summarizeVerification(report: RestoreVerificationReport): { total: number; passed: number; failed: number } {
  const checks = Array.isArray(report.checks) ? report.checks : []
  const passed = checks.filter((check) => check.status === 'pass').length
  return { total: checks.length, passed, failed: checks.length - passed }
}

export async function runRestoreDrill(options: RestoreDrillOptions): Promise<RestoreDrillReport> {
  const { config } = options
  const now = options.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const fileName = assertBackupFileName(options.fileName)
  const authorizedBy = options.authorizedBy.trim()
  const reason = options.reason.trim()
  if (authorizedBy.length < 3) throw new BackupToolError('RESTORE_AUTHORIZATION_REQUIRED', 'The authorising owner/manager name must be at least 3 characters.')
  if (reason.length < 8) throw new BackupToolError('RESTORE_AUTHORIZATION_REQUIRED', 'A restore drill reason of at least 8 characters is required for audit evidence.')
  if (!config.backup.keyConfigured) throw new BackupToolError('RESTORE_DRILL_KEY_REQUIRED', 'A backup encryption key is not configured, so the drill package cannot be authenticated.')

  const lock = await acquireLock(config.backup.drillRoot, fileName)
  let dataDir: string | null = null
  let logPath: string | null = null
  let port = 0
  let clusterStarted = false
  let clusterStopped = false
  let dataRemoved = false
  let resultBase: RestoreDrillBaseReport | null = null
  let manifestName = ''
  let verified: Awaited<ReturnType<typeof verifyBackupPackage>>
  try {
    if (!config.backup.pgBin) throw new BackupToolError('RESTORE_DRILL_TOOLING_UNAVAILABLE', 'The bundled PostgreSQL tools are not configured for this service, so an isolated drill cluster cannot be started.')
    for (const tool of [config.backup.pgInitdb, config.backup.pgCtl, config.backup.pgRestore]) {
      const info = await stat(tool).catch(() => null)
      if (!info?.isFile()) throw new BackupToolError('RESTORE_DRILL_TOOLING_UNAVAILABLE', `Required PostgreSQL tool is missing: ${path.basename(tool)}. Repair the installed service before running a drill.`)
    }
    const migrationsInfo = await stat(config.backup.migrationsDir).catch(() => null)
    if (!migrationsInfo?.isDirectory()) throw new BackupToolError('RESTORE_DRILL_MIGRATIONS_UNAVAILABLE', 'The installed migration directory is missing, so restored schema checksums cannot be compared. Repair the installed service before running a drill.')

    const packagePath = path.join(config.backup.dir, fileName)
    const packageInfo = await stat(packagePath).catch(() => null)
    if (!packageInfo?.isFile()) throw new BackupToolError('BACKUP_FILE_MISSING', 'The requested backup package does not exist in the configured destination.')
    const manifest = await findManifest(config.backup.dir, fileName)
    manifestName = manifest.manifestName
    const manifestPath = manifest.manifestPath
    verified = await verifyBackupPackage(manifestPath)
    if (verified.manifest.file.name !== fileName) throw new BackupToolError('RESTORE_DRILL_PACKAGE_INVALID', 'The selected manifest describes a different package.')

    const free = await statfs(config.backup.drillRoot)
    const freeBytes = BigInt(free.bavail) * BigInt(free.bsize)
    const required = BigInt(verified.manifest.file.plaintext_bytes) + BigInt(DRILL_MIN_FREE_BYTES)
    if (freeBytes < required) {
      throw new BackupToolError('RESTORE_DRILL_DISK_SPACE', `The drill needs at least ${required} bytes free in ${config.backup.drillRoot}; only ${freeBytes} bytes are available. Free disk space and retry. The live database and backups were not touched.`)
    }

    const root = await mkdtemp(path.join(config.backup.drillRoot, 'drill-'))
    dataDir = path.join(root, 'cluster')
    logPath = path.join(root, 'postgres.log')
    port = await freeLoopbackPort(config.db.port)
    const deadline = Date.now() + DRILL_TIMEOUT_MS

    await runTool('initdb', config.backup.pgInitdb, ['-D', dataDir, '-U', MIGRATION_OWNER, '-A', 'trust', '--encoding=UTF8', '--no-locale'], 120_000)
    await writeFile(path.join(dataDir, 'postgresql.conf'), [
      "listen_addresses='127.0.0.1'",
      `port=${port}`,
      'max_connections=20',
      'shared_buffers=64MB',
      'fsync=on',
      'full_page_writes=on',
      'synchronous_commit=on',
      "log_min_messages='warning'",
      ''
    ].join('\n'), { flag: 'a' })
    await runTool('pg_ctl start', config.backup.pgCtl, ['-D', dataDir, '-l', logPath, '-w', '-t', '60', 'start'], 90_000)
    clusterStarted = true
    await waitForCluster({ host: '127.0.0.1', port, user: MIGRATION_OWNER }, Math.min(deadline, Date.now() + 45_000))

    const admin = await connectClient({ host: '127.0.0.1', port, database: 'postgres', user: MIGRATION_OWNER })
    try {
      const runtimeRole = config.db.user
      if (!IDENTIFIER.test(runtimeRole)) throw new BackupToolError('RESTORE_DRILL_ROLE_INVALID', 'The configured runtime database role is not a safe PostgreSQL identifier.')
      const existing = await admin.query('SELECT 1 AS present FROM pg_roles WHERE rolname = $1', [runtimeRole])
      if (existing.rows.length === 0) {
        await admin.query(`CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`)
      }
      await admin.query(`CREATE DATABASE ${DRILL_DATABASE} OWNER ${MIGRATION_OWNER}`)
    } finally {
      await admin.end()
    }

    const target = { host: '127.0.0.1', port, database: DRILL_DATABASE, user: MIGRATION_OWNER, password: null }
    const preflight = await connectClient({ host: target.host, port: target.port, database: target.database, user: target.user })
    const security = await connectClient({ host: target.host, port: target.port, database: target.database, user: target.user })
    let verification: RestoreVerificationReport
    let restored: Awaited<ReturnType<typeof restoreBackupPackageToDatabase>>
    try {
      restored = await restoreBackupPackageToDatabase({
        manifestPath,
        encryptionKey: loadEncryptionKey({ keyFile: config.backup.keyFile, env: process.env }),
        target,
        verification: {
          host: target.host,
          port: target.port,
          database: target.database,
          user: target.user,
          password: '',
          testOptIn: true,
          sourceDatabase: verified.manifest.source.database,
          liveDatabases: []
        },
        authorization: { authorized_by: authorizedBy, reason, target_database: DRILL_DATABASE, confirmed: true },
        preflightClient: preflight,
        securityClient: security,
        security: { runtimeRole: config.db.user, migrationOwner: MIGRATION_OWNER, schema: 'bar_local' },
        pgRestoreCommand: config.backup.pgRestore,
        timeoutMs: Math.max(60_000, Math.min(10 * 60_000, deadline - Date.now()))
      })
      verification = await verifyRestoredDatabase(security, {
        migrationsDir: config.backup.migrationsDir,
        database: DRILL_DATABASE,
        runtimeRole: config.db.user,
        expectedMigrationOwner: MIGRATION_OWNER,
        runtimeProbe: { connect: () => connectClient({ host: target.host, port: target.port, database: target.database, user: config.db.user }) }
      })
    } finally {
      await preflight.end().catch(() => {})
      await security.end().catch(() => {})
    }
    const checks = summarizeVerification(verification)
    if (!verification.ok || checks.failed > 0) {
      const failedNames = (Array.isArray(verification.checks) ? verification.checks : [])
        .filter((check) => check.status !== 'pass')
        .slice(0, 5)
        .map((check) => check.name)
      const firstFailure = (Array.isArray(verification.checks) ? verification.checks : [])
        .find((check) => check.status !== 'pass')
      const firstDetail = firstFailure && typeof firstFailure.detail === 'string' ? ` First failure: ${firstFailure.detail.slice(0, 300)}` : ''
      throw new BackupToolError(
        'RESTORE_DRILL_VERIFICATION_FAILED',
        `The restored database failed ${checks.failed} of ${checks.total} financial or security checks${failedNames.length ? ` (${failedNames.join(', ')})` : ''}.${firstDetail} Do not rely on this package for recovery. Keep the package, correct the cause and repeat the drill.`
      )
    }

    const completedAt = now().toISOString()
    const base: RestoreDrillBaseReport = {
      file_name: fileName,
      manifest_name: manifestName,
      started_at: startedAt,
      completed_at: completedAt,
      target: { host: target.host, port: target.port, database: target.database },
      package: {
        created_at: verified.manifest.created_at,
        bytes: verified.manifest.file.bytes,
        sha256: verified.manifest.file.sha256,
        plaintext_sha256: verified.manifest.file.plaintext_sha256,
        source_database: verified.manifest.source.database
      },
      verification,
      checks,
      evidence_path: '',
      message: 'The encrypted package restored into a disposable same-PC cluster and passed financial and runtime-security verification. This proves package readability and database integrity on this PC; it is not an off-site recovery or point-in-time recovery test.',
      pitr_available: false
    }
    const evidencePath = await writeReport(config.backup.drillRoot, {
      command: 'backup-restore-drill',
      status: 'verified',
      ...base,
      restored: { security: restored.security, restored_to: restored.restored_to },
      authorized_by: authorizedBy,
      reason
    })
    resultBase = { ...base, evidence_path: evidencePath }
  } finally {
    if (clusterStarted && dataDir) {
      clusterStopped = await runTool('pg_ctl stop', config.backup.pgCtl, ['-D', dataDir, '-m', 'immediate', '-w', '-t', '60', 'stop'], 90_000)
        .then(() => true)
        .catch(() => false)
    }
    if (dataDir) {
      const root = path.dirname(dataDir)
      dataRemoved = await rm(root, { recursive: true, force: true }).then(() => true).catch(() => false)
    }
    await lock.release()
  }
  if (!resultBase) throw new BackupToolError('RESTORE_DRILL_FAILED', 'The restore drill ended without producing a verification report. Inspect the service log before retrying.')
  return {
    ok: true,
    command: 'backup-restore-drill',
    status: 'verified',
    ...resultBase,
    cleanup: { cluster_stopped: clusterStopped, data_removed: dataRemoved }
  }
}
