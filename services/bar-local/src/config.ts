import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { NetworkRole } from './operations/network.js'
import type { ReplicationCoordinator, ReplicationSettings } from './operations/replication.js'

export const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SERVICE_VERSION = '0.1.0'
const SERVICE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function installedServiceVersion(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(SERVICE_ROOT, 'package.json'), 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const version = (parsed as Record<string, unknown>).version
      if (typeof version === 'string' && SERVICE_VERSION_PATTERN.test(version)) return version
    }
  } catch {
    // Development and diagnostics remain runnable when package metadata is absent.
  }
  return DEFAULT_SERVICE_VERSION
}

export const SERVICE_VERSION = installedServiceVersion()

export interface BackupSettings {
  readonly dir: string
  readonly copyToDir: string | null
  readonly keyFile: string | null
  readonly keyConfigured: boolean
  readonly retention: {
    readonly hourly: number
    readonly daily: number
    readonly weekly: number
  }
  readonly pgBin: string | null
  readonly pgDump: string
  readonly pgRestore: string
  readonly pgInitdb: string
  readonly pgCtl: string
  readonly databaseUrl: string | null
  readonly logDir: string
  readonly taskStateFile: string | null
  readonly drillRoot: string
  readonly migrationsDir: string
}

export interface FailoverSettings {
  /** `disabled` keeps the current single-host authority. `witness` requires a
   *  reachable witness lease before this host may write. */
  readonly mode: 'disabled' | 'witness'
  readonly role: 'primary' | 'standby'
  readonly clusterId: string | null
  readonly instanceId: string | null
  readonly witnessUrl: string | null
  /** Stable address tills may be pointed at for the active authority. */
  readonly authorityUrl: string | null
  readonly secret: string | null
  readonly leaseTtlMs: number
  readonly renewIntervalMs: number
  readonly pollIntervalMs: number
  readonly catchupTimeoutMs: number
  readonly promoteTimeoutSeconds: number
  readonly requestTimeoutMs: number
}

export interface WitnessServerSettings {
  readonly clusterId: string | null
  readonly secret: string | null
  readonly stateFile: string
  readonly maxLeaseTtlMs: number
  readonly http: {
    readonly host: string
    readonly port: number
    readonly tls: { readonly keyFile: string; readonly certFile: string } | null
    readonly bodyLimitBytes: number
    readonly requestTimeoutMs: number
  }
}

export interface UpdateSettings {
  /** Where an operator drops signed offline update packages. */
  readonly inboxDir: string
  /** Where a verified package is held until an operator applies it. */
  readonly stagingDir: string
  /** Directory whose files the signed manifest is allowed to replace. */
  readonly installDir: string
  /** Pinned Ed25519 release public key in PEM form. */
  readonly publicKeyFile: string | null
  /** The only signing key identifier accepted for offline updates. */
  readonly keyId: string | null
  /** Applying an update is refused unless this is explicitly enabled. */
  readonly applyEnabled: boolean
  /** Trading, recovery and database directories the updater must never touch. */
  readonly dataDirs: readonly string[]
}

export interface CloudSyncSettings {
  /** `disabled` starts no uploader. `local_test` accepts loopback receivers only.
   *  `approved` is reserved for a separately authorised hosted receiver. */
  readonly transport: 'disabled' | 'local_test' | 'approved'
  readonly keyId: string | null
  readonly secret: string | null
  readonly requestTimeoutMs: number
  readonly maxBatchesPerRun: number
}

export interface ServiceConfig {
  readonly training?: { readonly instanceId: string } | null
  readonly recovery?: { readonly enabled: boolean; readonly walDir: string; readonly walKeyFile: string | null; readonly replicationUser: string | null; readonly replicationPassword: string | null }
  readonly service: { readonly version: string; readonly root: string }
  readonly http: {
    readonly host: string
    readonly port: number
    readonly tls: { readonly keyFile: string; readonly certFile: string } | null
    readonly bodyLimitBytes: number
    readonly requestTimeoutMs: number
    readonly allowedOrigins: readonly string[]
  }
  readonly db: {
    readonly host: string
    readonly port: number
    readonly database: string
    readonly user: string
    readonly password: string | null
    readonly max: number
    readonly statementTimeoutMs: number
    readonly lockTimeoutMs: number
  }
  readonly setupSecret: string | null
  readonly security: {
    readonly pinIterations: number
    readonly sessionTtlSeconds: number
    readonly pairingTtlSeconds: number
    readonly commandRetries: number
  }
  readonly networkRole: NetworkRole
  readonly backup: BackupSettings
  readonly replication: ReplicationSettings
  readonly failover: FailoverSettings
  readonly updates: UpdateSettings
  readonly cloudSync: CloudSyncSettings
}

export type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

function text(value: unknown): string | null
function text(value: unknown, fallback: string): string
function text(value: unknown, fallback: string | null = null): string | null {
  if (value === undefined || value === null) return fallback
  const trimmed = String(value).trim()
  return trimmed === '' ? fallback : trimmed
}

interface IntegerOptions {
  min: number
  max: number
  field: string
}

function integer(value: unknown, fallback: number, options: IntegerOptions): number {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new Error(`${options.field} must be an integer between ${options.min} and ${options.max}.`)
  }
  return parsed
}

function boolean(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host)
}

function assertSeparatedDirectories(firstName: string, firstPath: string, secondName: string, secondPath: string): void {
  const first = resolveWithRealAncestors(firstPath)
  const second = resolveWithRealAncestors(secondPath)
  const firstRelative = path.relative(first, second)
  const secondRelative = path.relative(second, first)
  const isWithin = (relative: string) => relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  if (isWithin(firstRelative) || isWithin(secondRelative)) {
    throw new Error(`${firstName} and ${secondName} must be separate directories with no nesting.`)
  }
}

/** Resolve existing junction/symlink ancestors as well as lexical path segments.
 *  A configured backup path must not bypass the separation checks by pointing
 *  through a Windows junction into the live PostgreSQL or primary backup tree.
 */
function resolveWithRealAncestors(value: string): string {
  let cursor = path.resolve(value)
  const suffix: string[] = []
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    suffix.unshift(path.basename(cursor))
    cursor = parent
  }
  let canonical: string
  try {
    canonical = realpathSync.native(cursor)
  } catch {
    canonical = cursor
  }
  return path.resolve(canonical, ...suffix)
}

const NETWORK_ROLES: readonly NetworkRole[] = ['single_host', 'client', 'replica', 'voter']
const COORDINATOR_MODES: readonly Exclude<ReplicationCoordinator, null>[] = ['manual', 'automatic']

function networkRole(value: unknown): NetworkRole {
  const role = text(value, 'single_host')
  if (!NETWORK_ROLES.includes(role as NetworkRole)) {
    throw new Error(`BAR_LOCAL_NETWORK_ROLE must be one of: ${NETWORK_ROLES.join(', ')}.`)
  }
  return role as NetworkRole
}

function replicationCoordinator(value: unknown): ReplicationCoordinator {
  const mode = text(value)
  if (mode === null) return null
  if (!COORDINATOR_MODES.includes(mode as Exclude<ReplicationCoordinator, null>)) {
    throw new Error('BAR_LOCAL_REPLICATION_COORDINATOR must be manual, automatic or unset.')
  }
  return mode as ReplicationCoordinator
}

function failoverMode(value: unknown): FailoverSettings['mode'] {
  const mode = text(value, 'disabled') as FailoverSettings['mode']
  if (mode !== 'disabled' && mode !== 'witness') {
    throw new Error('BAR_LOCAL_FAILOVER_MODE must be disabled or witness.')
  }
  return mode
}

function failoverRole(value: unknown, fallback: FailoverSettings['role']): FailoverSettings['role'] {
  const role = text(value)
  if (role === null) return fallback
  if (role !== 'primary' && role !== 'standby') {
    throw new Error('BAR_LOCAL_FAILOVER_ROLE must be primary or standby.')
  }
  return role
}

function safeToken(value: unknown, field: string, max: number): string | null {
  const raw = text(value)
  if (raw === null) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(raw) || raw.length > max) {
    throw new Error(`${field} must contain only letters, digits, dot, colon, underscore or dash, and be at most ${max} characters.`)
  }
  return raw
}

function witnessUrl(value: unknown): string | null {
  const raw = text(value)
  if (raw === null) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('BAR_LOCAL_FAILOVER_WITNESS_URL must be a valid URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('BAR_LOCAL_FAILOVER_WITNESS_URL must use http or https.')
  }
  if (url.username || url.password) {
    throw new Error('BAR_LOCAL_FAILOVER_WITNESS_URL must not embed credentials; use BAR_LOCAL_FAILOVER_KEY.')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.protocol === 'http:' && !isLoopback(host) && !isPrivateHostname(host)) {
    throw new Error('BAR_LOCAL_FAILOVER_WITNESS_URL may use plain http only on a loopback or private network address.')
  }
  return url.toString()
}

function isPrivateHostname(host: string): boolean {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  const match = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host)
  if (match) {
    const second = Number.parseInt(match[1], 10)
    return second >= 16 && second <= 31
  }
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')
}

function readSecret(env: Environment, directKey: string, fileKey: string): string | null {
  const direct = text(env[directKey])
  if (direct) return direct
  const file = text(env[fileKey])
  if (!file) return null
  try {
    const value = readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, '').trim()
    return value || null
  } catch {
    return null
  }
}

function loopbackDatabaseUrl(value: unknown, field: string): string | null {
  const raw = text(value)
  if (raw === null) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${field} must be a valid PostgreSQL connection URL.`)
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${field} must use the postgres or postgresql protocol.`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!isLoopback(host)) {
    throw new Error(`${field} must point at a loopback PostgreSQL host; remote administrative targets are refused.`)
  }
  const port = url.port === '' ? 5432 : Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${field} must include a valid PostgreSQL port between 1 and 65535.`)
  }
  if (!url.username) {
    throw new Error(`${field} must include a PostgreSQL user.`)
  }
  if (!decodeURIComponent(url.pathname.replace(/^\//, ''))) {
    throw new Error(`${field} must include a database name.`)
  }
  return url.toString()
}

function pgTool(explicit: unknown, pgBin: string | null, name: string): string {
  const supplied = text(explicit)
  if (supplied) return supplied
  if (pgBin) return path.join(pgBin, process.platform === 'win32' ? `${name}.exe` : name)
  return name
}

/**
 * The scheduled-backup marker is written by install-backup-task.ps1 after the
 * Task Scheduler registration succeeds. It is optional: an absent marker is
 * reported honestly as "schedule not installed" rather than assumed healthy.
 */
function taskStateFile(explicit: string | null): string | null {
  if (!explicit) return null
  return path.resolve(explicit)
}

function readSetupSecret(env: Environment, root: string): string | null {
  const direct = text(env.BAR_LOCAL_SETUP_SECRET)
  if (direct) return direct
  const file = path.resolve(text(env.BAR_LOCAL_SETUP_SECRET_FILE, path.join(root, '.local', 'setup-secret.txt')))
  try {
    const value = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim()
    return value || null
  } catch {
    return null
  }
}

function cloudSyncTransport(value: unknown): CloudSyncSettings['transport'] {
  const mode = text(value, 'disabled') as CloudSyncSettings['transport']
  if (!['disabled', 'local_test', 'approved'].includes(mode)) {
    throw new Error('BAR_LOCAL_CLOUD_SYNC_TRANSPORT must be disabled, local_test or approved.')
  }
  return mode
}

function readCloudSyncSecret(env: Environment, root: string): string | null {
  const direct = text(env.BAR_LOCAL_CLOUD_SYNC_KEY)
  if (direct) return direct
  const file = text(env.BAR_LOCAL_CLOUD_SYNC_KEY_FILE)
  if (!file) return null
  try {
    const value = readFileSync(path.resolve(file), 'utf8').replace(/^\uFEFF/, '').trim()
    return value || null
  } catch {
    return null
  }
}

/**
 * Independent configuration for the witness process. The witness host does not
 * run a Bar database, so this deliberately reads only witness settings and
 * never the Bar database, backup or cloud-sync environment.
 */
export function loadWitnessConfig(env: Environment = process.env, options: { root?: string } = {}): WitnessServerSettings {
  const root = options.root ?? SERVICE_ROOT
  const clusterId = safeToken(env.BAR_LOCAL_WITNESS_CLUSTER_ID, 'BAR_LOCAL_WITNESS_CLUSTER_ID', 63)
  if (!clusterId || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(clusterId)) {
    throw new Error('The witness requires BAR_LOCAL_WITNESS_CLUSTER_ID (3-63 letters, digits, underscores or dashes).')
  }
  const secret = readSecret(env, 'BAR_LOCAL_WITNESS_KEY', 'BAR_LOCAL_WITNESS_KEY_FILE')
  if (!secret || secret.length < 32) {
    throw new Error('The witness requires a shared BAR_LOCAL_WITNESS_KEY (or _KEY_FILE) of at least 32 characters.')
  }
  const host = text(env.BAR_LOCAL_WITNESS_HTTP_HOST, '127.0.0.1')
  const port = integer(env.BAR_LOCAL_WITNESS_HTTP_PORT, 8790, { min: 1, max: 65535, field: 'BAR_LOCAL_WITNESS_HTTP_PORT' })
  const tlsKeyFile = text(env.BAR_LOCAL_WITNESS_TLS_KEY_FILE)
  const tlsCertFile = text(env.BAR_LOCAL_WITNESS_TLS_CERT_FILE)
  if ((tlsKeyFile && !tlsCertFile) || (!tlsKeyFile && tlsCertFile)) {
    throw new Error('BAR_LOCAL_WITNESS_TLS_KEY_FILE and BAR_LOCAL_WITNESS_TLS_CERT_FILE must be supplied together.')
  }
  if (!isLoopback(host) && !tlsCertFile) {
    throw new Error('The witness refuses a non-loopback bind without TLS certificate and key files.')
  }
  return Object.freeze({
    clusterId,
    secret,
    stateFile: path.resolve(text(env.BAR_LOCAL_WITNESS_STATE_FILE, path.join(root, '.local', 'witness', 'state.json'))),
    maxLeaseTtlMs: integer(env.BAR_LOCAL_WITNESS_LEASE_MAX_MS, 120000, { min: 5000, max: 600000, field: 'BAR_LOCAL_WITNESS_LEASE_MAX_MS' }),
    http: Object.freeze({
      host,
      port,
      tls: tlsKeyFile && tlsCertFile ? Object.freeze({ keyFile: path.resolve(tlsKeyFile), certFile: path.resolve(tlsCertFile) }) : null,
      bodyLimitBytes: integer(env.BAR_LOCAL_WITNESS_BODY_LIMIT_BYTES, 8192, { min: 1024, max: 65536, field: 'BAR_LOCAL_WITNESS_BODY_LIMIT_BYTES' }),
      requestTimeoutMs: integer(env.BAR_LOCAL_WITNESS_REQUEST_TIMEOUT_MS, 5000, { min: 500, max: 30000, field: 'BAR_LOCAL_WITNESS_REQUEST_TIMEOUT_MS' })
    })
  })
}

export function loadConfig(env: Environment = process.env, options: { root?: string } = {}): ServiceConfig {
  const root = options.root ?? SERVICE_ROOT
  const trainingId = text(env.BAR_LOCAL_TRAINING_ID)
  const training = env.BAR_LOCAL_TRAINING === '1'
  if (training && (!trainingId || !/^[0-9a-f-]{36}$/.test(trainingId)
      || env.BAR_LOCAL_DB_NAME !== 'bar_local_training'
      || text(env.BAR_LOCAL_HTTP_HOST, '127.0.0.1') !== '127.0.0.1'
      || text(env.BAR_LOCAL_CLOUD_SYNC_TRANSPORT, 'disabled') !== 'disabled'
      || boolean(env.BAR_LOCAL_UPDATE_APPLY_ENABLED)
      || text(env.BAR_LOCAL_FAILOVER_MODE, 'disabled') !== 'disabled')) {
    throw new Error('Training requires its own database, loopback service and disabled cloud, update and failover transports.')
  }
  const httpHost = text(env.BAR_LOCAL_HTTP_HOST, '127.0.0.1')
  const httpPort = integer(env.BAR_LOCAL_HTTP_PORT, 8787, { min: 1, max: 65535, field: 'BAR_LOCAL_HTTP_PORT' })
  const dbHost = text(env.BAR_LOCAL_DB_HOST, '127.0.0.1')
  if (!isLoopback(dbHost)) {
    throw new Error('The local Bar service only connects to a loopback PostgreSQL cluster. Remote database hosts are not allowed.')
  }
  const database = text(env.BAR_LOCAL_DB_NAME, 'bar_local')
  if (!/^bar_local(?:_|$)/.test(database)) {
    throw new Error('BAR_LOCAL_DB_NAME must be a dedicated local Bar database beginning with bar_local.')
  }
  if (/^bar_local_test/.test(database) && !boolean(env.BAR_LOCAL_ALLOW_TEST_DB)) {
    throw new Error('A bar_local_test database requires BAR_LOCAL_ALLOW_TEST_DB=1; the service refuses to trade against disposable test data.')
  }
  const tlsKeyFile = text(env.BAR_LOCAL_TLS_KEY_FILE)
  const tlsCertFile = text(env.BAR_LOCAL_TLS_CERT_FILE)
  if ((tlsKeyFile && !tlsCertFile) || (!tlsKeyFile && tlsCertFile)) {
    throw new Error('BAR_LOCAL_TLS_KEY_FILE and BAR_LOCAL_TLS_CERT_FILE must be supplied together.')
  }
  if (!isLoopback(httpHost) && !tlsCertFile) {
    throw new Error('The local Bar service refuses a non-loopback bind without TLS certificate and key files.')
  }
  const allowedOrigins = (env.BAR_LOCAL_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const adminDatabaseUrl = loopbackDatabaseUrl(env.BAR_LOCAL_ADMIN_DATABASE_URL, 'BAR_LOCAL_ADMIN_DATABASE_URL')
  const standbyAdminDatabaseUrl = loopbackDatabaseUrl(env.BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL, 'BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL')
  const pgBin = text(env.BAR_LOCAL_PG_BIN)
  const pgBinPath = pgBin ? path.resolve(pgBin) : null
  const backupDir = path.resolve(text(env.BAR_LOCAL_BACKUP_DIR, path.join(root, '.local', 'backups')))
  const backupCopyToDirRaw = text(env.BAR_LOCAL_BACKUP_COPY_TO)
  const backupCopyToDir = backupCopyToDirRaw ? path.resolve(backupCopyToDirRaw) : null
  const pgDataDir = path.resolve(text(env.BAR_LOCAL_PG_DATA_DIR, path.join(root, '.local', 'pgdata')))
  const drillRoot = path.resolve(text(env.BAR_LOCAL_RESTORE_DRILL_DIR, path.join(root, '.local', 'restore-drills')))
  if (backupCopyToDir) {
    assertSeparatedDirectories('BackupDir', backupDir, 'BackupCopyToDir', backupCopyToDir)
    assertSeparatedDirectories('PgDataDir', pgDataDir, 'BackupCopyToDir', backupCopyToDir)
  }
  assertSeparatedDirectories('PgDataDir', pgDataDir, 'RestoreDrillDir', drillRoot)
  assertSeparatedDirectories('BackupDir', backupDir, 'RestoreDrillDir', drillRoot)
  const backupKeyFile = text(env.BAR_LOCAL_BACKUP_KEY_FILE)
  const backupKeyFileResolved = backupKeyFile ? path.resolve(backupKeyFile) : null
  const backupKeyConfigured = Boolean(backupKeyFileResolved || text(env.BAR_LOCAL_BACKUP_KEY))
  const statementTimeoutMs = integer(env.BAR_LOCAL_DB_STATEMENT_TIMEOUT_MS, 15000, { min: 1000, max: 120000, field: 'BAR_LOCAL_DB_STATEMENT_TIMEOUT_MS' })
  const updateStagingDir = path.resolve(text(env.BAR_LOCAL_UPDATE_STAGING_DIR, path.join(root, '.local', 'updates')))
  const updateInboxDir = path.resolve(text(env.BAR_LOCAL_UPDATE_INBOX_DIR, path.join(root, '.local', 'update-inbox')))
  const updateInstallDir = path.resolve(text(env.BAR_LOCAL_UPDATE_INSTALL_DIR, root))
  const updatePublicKeyFileRaw = text(env.BAR_LOCAL_UPDATE_PUBLIC_KEY_FILE)
  const updatePublicKeyFile = updatePublicKeyFileRaw ? path.resolve(updatePublicKeyFileRaw) : null
  const updateKeyId = text(env.BAR_LOCAL_UPDATE_KEY_ID)
  const replication = Object.freeze({
    role: networkRole(env.BAR_LOCAL_NETWORK_ROLE),
    coordinator: replicationCoordinator(env.BAR_LOCAL_REPLICATION_COORDINATOR),
    adminDatabaseUrl,
    standbyAdminDatabaseUrl,
    pgDataDir,
    pgBin: pgBinPath,
    pgDump: pgTool(env.BAR_LOCAL_PG_DUMP, pgBinPath, 'pg_dump'),
    pgRestore: pgTool(env.BAR_LOCAL_PG_RESTORE, pgBinPath, 'pg_restore')
  })

  const failoverModeValue = failoverMode(env.BAR_LOCAL_FAILOVER_MODE)
  const failoverRoleValue = failoverRole(
    env.BAR_LOCAL_FAILOVER_ROLE,
    replication.role === 'replica' || replication.role === 'voter' ? 'standby' : 'primary'
  )
  const failoverClusterId = safeToken(env.BAR_LOCAL_FAILOVER_CLUSTER_ID, 'BAR_LOCAL_FAILOVER_CLUSTER_ID', 63)
  const failoverInstanceId = safeToken(env.BAR_LOCAL_FAILOVER_INSTANCE_ID, 'BAR_LOCAL_FAILOVER_INSTANCE_ID', 127)
  const failoverWitnessUrl = witnessUrl(env.BAR_LOCAL_FAILOVER_WITNESS_URL)
  const failoverSecret = readSecret(env, 'BAR_LOCAL_FAILOVER_KEY', 'BAR_LOCAL_FAILOVER_KEY_FILE')
  const leaseTtlMs = integer(env.BAR_LOCAL_FAILOVER_LEASE_TTL_MS, 30000, { min: 5000, max: 300000, field: 'BAR_LOCAL_FAILOVER_LEASE_TTL_MS' })
  const renewIntervalMs = integer(env.BAR_LOCAL_FAILOVER_RENEW_INTERVAL_MS, 5000, { min: 500, max: 60000, field: 'BAR_LOCAL_FAILOVER_RENEW_INTERVAL_MS' })
  if (renewIntervalMs * 2 >= leaseTtlMs) {
    throw new Error('BAR_LOCAL_FAILOVER_RENEW_INTERVAL_MS must be less than half of BAR_LOCAL_FAILOVER_LEASE_TTL_MS.')
  }
  if (failoverModeValue === 'witness') {
    if (!failoverClusterId || !failoverInstanceId || !failoverWitnessUrl) {
      throw new Error('Witness failover requires BAR_LOCAL_FAILOVER_CLUSTER_ID, BAR_LOCAL_FAILOVER_INSTANCE_ID and BAR_LOCAL_FAILOVER_WITNESS_URL.')
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(failoverClusterId)) {
      throw new Error('BAR_LOCAL_FAILOVER_CLUSTER_ID must be 3-63 letters, digits, underscores or dashes.')
    }
    if (!failoverSecret || failoverSecret.length < 32) {
      throw new Error('Witness failover requires a shared BAR_LOCAL_FAILOVER_KEY (or _KEY_FILE) of at least 32 characters.')
    }
    if (failoverRoleValue === 'standby' && !adminDatabaseUrl) {
      throw new Error('A standby in witness failover mode requires BAR_LOCAL_ADMIN_DATABASE_URL to promote the local PostgreSQL cluster.')
    }
    if (leaseTtlMs <= statementTimeoutMs + Math.max(5000, renewIntervalMs * 2)) {
      throw new Error('BAR_LOCAL_FAILOVER_LEASE_TTL_MS must exceed BAR_LOCAL_DB_STATEMENT_TIMEOUT_MS plus the renewal safety margin, so an in-flight command cannot outlive the lease.')
    }
  }
  const failover = Object.freeze({
    mode: failoverModeValue,
    role: failoverRoleValue,
    clusterId: failoverClusterId,
    instanceId: failoverInstanceId,
    witnessUrl: failoverWitnessUrl,
    authorityUrl: witnessUrl(env.BAR_LOCAL_FAILOVER_AUTHORITY_URL),
    secret: failoverSecret,
    leaseTtlMs,
    renewIntervalMs,
    pollIntervalMs: integer(env.BAR_LOCAL_FAILOVER_POLL_INTERVAL_MS, 5000, { min: 500, max: 60000, field: 'BAR_LOCAL_FAILOVER_POLL_INTERVAL_MS' }),
    catchupTimeoutMs: integer(env.BAR_LOCAL_FAILOVER_CATCHUP_TIMEOUT_MS, 60000, { min: 5000, max: 600000, field: 'BAR_LOCAL_FAILOVER_CATCHUP_TIMEOUT_MS' }),
    promoteTimeoutSeconds: integer(env.BAR_LOCAL_FAILOVER_PROMOTE_TIMEOUT_SECONDS, 60, { min: 5, max: 600, field: 'BAR_LOCAL_FAILOVER_PROMOTE_TIMEOUT_SECONDS' }),
    requestTimeoutMs: integer(env.BAR_LOCAL_FAILOVER_REQUEST_TIMEOUT_MS, 5000, { min: 500, max: 30000, field: 'BAR_LOCAL_FAILOVER_REQUEST_TIMEOUT_MS' })
  })

  return Object.freeze({
    service: Object.freeze({ version: SERVICE_VERSION, root }),
    training: training ? Object.freeze({ instanceId: trainingId! }) : null,
    recovery: Object.freeze({
      enabled: !training && boolean(env.BAR_LOCAL_PHYSICAL_RECOVERY_ENABLED),
      walDir: path.resolve(text(env.BAR_LOCAL_WAL_ARCHIVE_DIR, path.join(backupDir, 'wal-archive'))),
      walKeyFile: text(env.BAR_LOCAL_WAL_KEY_FILE),
      replicationUser: text(env.BAR_LOCAL_RECOVERY_REPLICATION_USER),
      replicationPassword: readSecret(env, 'BAR_LOCAL_RECOVERY_REPLICATION_PASSWORD', 'BAR_LOCAL_RECOVERY_REPLICATION_PASSWORD_FILE')
    }),
    http: Object.freeze({
      host: httpHost,
      port: httpPort,
      tls: tlsKeyFile && tlsCertFile ? Object.freeze({ keyFile: path.resolve(tlsKeyFile), certFile: path.resolve(tlsCertFile) }) : null,
      bodyLimitBytes: integer(env.BAR_LOCAL_BODY_LIMIT_BYTES, 1024 * 1024, { min: 1024, max: 16 * 1024 * 1024, field: 'BAR_LOCAL_BODY_LIMIT_BYTES' }),
      requestTimeoutMs: integer(env.BAR_LOCAL_REQUEST_TIMEOUT_MS, 20000, { min: 1000, max: 120000, field: 'BAR_LOCAL_REQUEST_TIMEOUT_MS' }),
      allowedOrigins: Object.freeze(allowedOrigins)
    }),
    db: Object.freeze({
      host: dbHost,
      port: integer(env.BAR_LOCAL_DB_PORT, 5432, { min: 1, max: 65535, field: 'BAR_LOCAL_DB_PORT' }),
      database,
      user: text(env.BAR_LOCAL_RUNTIME_USER, 'bar_local_runtime'),
      password: text(env.BAR_LOCAL_RUNTIME_PASSWORD) ?? text(env.BAR_LOCAL_DB_PASSWORD),
      max: integer(env.BAR_LOCAL_DB_POOL_MAX, 10, { min: 1, max: 50, field: 'BAR_LOCAL_DB_POOL_MAX' }),
      statementTimeoutMs,
      lockTimeoutMs: integer(env.BAR_LOCAL_DB_LOCK_TIMEOUT_MS, 5000, { min: 500, max: 60000, field: 'BAR_LOCAL_DB_LOCK_TIMEOUT_MS' })
    }),
    setupSecret: readSetupSecret(env, root),
    security: Object.freeze({
      pinIterations: integer(env.BAR_LOCAL_PIN_ITERATIONS, 210000, { min: 100000, max: 1000000, field: 'BAR_LOCAL_PIN_ITERATIONS' }),
      sessionTtlSeconds: integer(env.BAR_LOCAL_SESSION_TTL_SECONDS, 43200, { min: 300, max: 604800, field: 'BAR_LOCAL_SESSION_TTL_SECONDS' }),
      pairingTtlSeconds: integer(env.BAR_LOCAL_PAIRING_TTL_SECONDS, 300, { min: 60, max: 900, field: 'BAR_LOCAL_PAIRING_TTL_SECONDS' }),
      commandRetries: integer(env.BAR_LOCAL_COMMAND_RETRIES, 2, { min: 0, max: 5, field: 'BAR_LOCAL_COMMAND_RETRIES' })
    }),
    networkRole: replication.role,
    backup: Object.freeze({
      dir: backupDir,
      copyToDir: backupCopyToDir,
      keyFile: backupKeyFileResolved,
      keyConfigured: backupKeyConfigured,
      retention: Object.freeze({
        hourly: integer(env.BAR_LOCAL_BACKUP_RETENTION_HOURLY, 24, { min: 0, max: 10000, field: 'BAR_LOCAL_BACKUP_RETENTION_HOURLY' }),
        daily: integer(env.BAR_LOCAL_BACKUP_RETENTION_DAILY, 7, { min: 0, max: 10000, field: 'BAR_LOCAL_BACKUP_RETENTION_DAILY' }),
        weekly: integer(env.BAR_LOCAL_BACKUP_RETENTION_WEEKLY, 4, { min: 0, max: 10000, field: 'BAR_LOCAL_BACKUP_RETENTION_WEEKLY' })
      }),
      pgBin: pgBinPath,
      pgDump: pgTool(env.BAR_LOCAL_PG_DUMP, pgBinPath, 'pg_dump'),
      pgRestore: pgTool(env.BAR_LOCAL_PG_RESTORE, pgBinPath, 'pg_restore'),
      pgInitdb: pgTool(env.BAR_LOCAL_PG_INITDB, pgBinPath, 'initdb'),
      pgCtl: pgTool(env.BAR_LOCAL_PG_CTL, pgBinPath, 'pg_ctl'),
      databaseUrl: adminDatabaseUrl,
      logDir: path.resolve(text(env.BAR_LOCAL_LOG_DIR, path.join(root, '.local', 'logs'))),
      taskStateFile: taskStateFile(text(env.BAR_LOCAL_BACKUP_TASK_STATE_FILE)),
      drillRoot,
      migrationsDir: path.resolve(text(env.BAR_LOCAL_MIGRATIONS_DIR, path.join(root, 'db', 'migrations')))
    }),
    replication,
    failover,
    updates: Object.freeze({
      inboxDir: updateInboxDir,
      stagingDir: updateStagingDir,
      installDir: updateInstallDir,
      publicKeyFile: updatePublicKeyFile,
      keyId: updateKeyId,
      applyEnabled: boolean(env.BAR_LOCAL_UPDATE_APPLY_ENABLED),
      dataDirs: Object.freeze([...new Set([backupDir, pgDataDir, drillRoot, updateStagingDir, updateInboxDir])])
    }),
    cloudSync: Object.freeze({
      transport: cloudSyncTransport(env.BAR_LOCAL_CLOUD_SYNC_TRANSPORT),
      keyId: text(env.BAR_LOCAL_CLOUD_SYNC_KEY_ID),
      secret: readCloudSyncSecret(env, root),
      requestTimeoutMs: integer(env.BAR_LOCAL_CLOUD_SYNC_TIMEOUT_MS, 20000, { min: 1000, max: 120000, field: 'BAR_LOCAL_CLOUD_SYNC_TIMEOUT_MS' }),
      maxBatchesPerRun: integer(env.BAR_LOCAL_CLOUD_SYNC_MAX_BATCHES, 20, { min: 1, max: 200, field: 'BAR_LOCAL_CLOUD_SYNC_MAX_BATCHES' })
    })
  })
}
