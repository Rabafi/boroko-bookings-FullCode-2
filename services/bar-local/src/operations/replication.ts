import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from 'pg'

export type ReplicationCoordinator = 'manual' | 'automatic' | null

export interface ReplicationSettings {
  readonly role: string
  readonly coordinator: ReplicationCoordinator
  readonly adminDatabaseUrl: string | null
  readonly standbyAdminDatabaseUrl: string | null
  readonly pgDataDir: string
  readonly pgBin: string | null
  readonly pgDump: string
  readonly pgRestore: string
}

export type SqlRow = Record<string, unknown>
export interface SqlResult {
  rows: SqlRow[]
}
export type SqlQuery = (sql: string, params?: readonly unknown[]) => Promise<SqlResult>

export interface ReplicationQueryHost {
  query(sql: string, params?: readonly unknown[]): Promise<SqlResult>
}

export interface ReplicationClient extends ReplicationQueryHost {
  end(): Promise<void>
}

export type ReplicationErrorCode =
  | 'COORDINATOR_UNVERIFIED'
  | 'REPLICATION_CONFIG_MISSING'
  | 'REPLICATION_CONNECT_FAILED'
  | 'REPLICATION_ROLE_UNVERIFIED'
  | 'REPLICATION_PRIMARY_NOT_PRIMARY'
  | 'REPLICATION_STANDBY_REQUIRED'
  | 'REPLICATION_STANDBY_NOT_STREAMING'
  | 'REPLICATION_CATCHUP_TIMEOUT'
  | 'REPLICATION_FENCE_FAILED'
  | 'REPLICATION_PROMOTION_FAILED'
  | 'REPLICATION_DURABILITY_FAILED'
  | 'REPLICATION_IDENTIFIER_INVALID'
  | 'REPLICATION_CONFIRMATION_REQUIRED'
  | 'REPLICATION_PRIMARY_HOST_REFUSED'
  | 'REPLICATION_DATA_DIR_NOT_EMPTY'
  | 'REPLICATION_DATA_DIR_UNAVAILABLE'
  | 'REPLICATION_BASEBACKUP_FAILED'
  | 'REPLICATION_START_FAILED'
  | 'REPLICATION_STREAMING_TIMEOUT'
  | 'REPLICATION_COMMAND_TIMEOUT'

export class ReplicationError extends Error {
  readonly code: ReplicationErrorCode
  readonly details: Record<string, unknown>

  constructor(code: ReplicationErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ReplicationError'
    this.code = code
    this.details = details
  }
}

export interface ReplicationStandby {
  application_name: string
  state: string | null
  sync_state: string | null
  sent_lsn: string | null
  flush_lsn: string | null
  replay_lsn: string | null
  replay_lag_bytes: number | null
}

export interface ReplicationReport {
  role: 'primary' | 'standby' | 'unknown'
  in_recovery: boolean | null
  current_lsn: string | null
  receive_lsn: string | null
  replay_lsn: string | null
  replay_lag_bytes: number | null
  synchronous_commit: string | null
  synchronous_standby_names: string | null
  streaming_standbys: ReplicationStandby[]
  caught_up_standbys: number
  last_replay: string | null
  automatic_failover: { verified: boolean; detail: string }
  limitations: string[]
}

export interface ReplicationDependencies {
  query?: SqlQuery
  connect?: (url: string, applicationName: string) => Promise<ReplicationClient>
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  runCommand?: RunCommand
  catchupTimeoutMs?: number
  promoteTimeoutSeconds?: number
  fenceTimeoutMs?: number
}

export interface CommandRunResult {
  exit_code: number
  stderr: string
}

export interface RunCommandOptions {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export type RunCommand = (command: string, args: readonly string[], options?: RunCommandOptions) => Promise<CommandRunResult>

export interface DurabilityReport {
  ok: true
  profile: 'single_host' | 'synchronous_one_standby'
  synchronous_commit: string | null
  synchronous_standby_names: string | null
  caught_up_standbys: number
  checked_at: string
}

export interface SwitchoverOperation {
  target: string
  sql: string
  at: string
}

export interface SwitchoverReport {
  ok: boolean
  coordinator: 'manual'
  authority_state: 'promoted' | 'fenced_no_promotion' | 'fence_failed'
  client_repoint_required: boolean
  fenced: { verified: true; at: string } | null
  promoted: { verified: true; lsn: string | null; at: string } | null
  operations: SwitchoverOperation[]
  error: { code: string; message: string } | null
  checked_at: string
}

export interface EnrollStandbyOptions {
  standbyDataDir: string
  primaryHost: string
  primaryPort: number
  replicationUser: string
  password?: string | null
  standbyDatabaseUrl?: string | null
  confirm: boolean
  allowPrivatePrimary?: boolean
  pgBaseBackup?: string
  pgCtl?: string
  timeoutMs?: number
}

export interface EnrollStandbyReport {
  ok: true
  standby_data_dir: string
  primary: { host: string; port: number }
  streaming_verified: true
  completed_at: string
}

export type ReplicationCommand = 'status' | 'set-durability' | 'switchover' | 'enroll-standby'

const DEFAULT_CATCHUP_TIMEOUT_MS = 60_000
const DEFAULT_PROMOTE_TIMEOUT_SECONDS = 60
const CAUGHT_UP_LAG_BYTES = 1024 * 1024
const SERVICE_APPLICATION_NAME = 'bar-local-service'

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const parsed = String(value)
  return parsed === '' ? null : parsed
}

function dateValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown replication error.'
}

async function safeRows(
  query: SqlQuery,
  sql: string,
  params: readonly unknown[] | undefined,
  limitations: string[],
  label: string
): Promise<SqlRow[]> {
  try {
    return (await query(sql, params)).rows
  } catch {
    limitations.push(`${label} could not be read.`)
    return []
  }
}

function sleepDefault(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function redact(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1***@')
    .replace(/(password\s*=\s*)[^\s;]+/gi, '$1***')
}

export async function connectPostgres(url: string, applicationName: string): Promise<ReplicationClient> {
  const client = new Client({
    connectionString: url,
    application_name: applicationName,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    query_timeout: 30000
  })
  try {
    await client.connect()
  } catch (error) {
    await client.end().catch(() => undefined)
    throw new ReplicationError('REPLICATION_CONNECT_FAILED', `Could not connect to the PostgreSQL administrative target: ${errorMessage(error)}`)
  }
  return {
    async query(sql: string, params?: readonly unknown[]): Promise<SqlResult> {
      const result = await client.query(sql, params ? [...params] : undefined)
      return { rows: result.rows as SqlRow[] }
    },
    async end(): Promise<void> {
      await client.end()
    }
  }
}

function defaultRunCommand(command: string, args: readonly string[], options: RunCommandOptions = {}): Promise<CommandRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: options.env,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      timeout: options.timeoutMs
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 64_000) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      reject(new ReplicationError('REPLICATION_START_FAILED', `Could not start ${path.basename(command)}: ${error.message}`))
    })
    // pg_ctl's detached postgres child may inherit the stderr handle on
    // Windows. Waiting for pipe close can hang until the entire server stops.
    child.on('exit', (code, signal) => {
      child.stderr?.destroy()
      if (signal === 'SIGTERM' && options.timeoutMs) {
        resolve({ exit_code: 124, stderr: redact(stderr) })
        return
      }
      resolve({ exit_code: code === null ? 1 : code, stderr: redact(stderr) })
    })
  })
}

export async function inspectReplication(
  host: ReplicationQueryHost | { query?: SqlQuery } | null,
  settings: Pick<ReplicationSettings, 'coordinator'> & Partial<Pick<ReplicationSettings, 'role'>>,
  deps: ReplicationDependencies = {}
): Promise<ReplicationReport> {
  const query = deps.query ?? host?.query
  const limitations: string[] = [
    'Replication inspection uses PostgreSQL SQL only; it does not prove durable data storage.',
    'No automatic failover, consensus or leader election is implemented by this service.'
  ]

  if (settings.coordinator === 'automatic') {
    limitations.push('A coordinator mode is configured but no coordination evidence is available; automatic failover remains unverified.')
  } else {
    limitations.push('Manual coordinator mode; automatic failover is not implemented.')
  }

  if (!query) {
    limitations.push('No PostgreSQL administrative connection is configured; replication role is unknown.')
    return {
      role: 'unknown',
      in_recovery: null,
      current_lsn: null,
      receive_lsn: null,
      replay_lsn: null,
      replay_lag_bytes: null,
      synchronous_commit: null,
      synchronous_standby_names: null,
      streaming_standbys: [],
      caught_up_standbys: 0,
      last_replay: null,
      automatic_failover: { verified: false, detail: 'No PostgreSQL administrative connection is configured.' },
      limitations
    }
  }

  const roleRows = await safeRows(
    query,
    `SELECT pg_is_in_recovery() AS in_recovery,
            pg_last_wal_receive_lsn()::text AS receive_lsn,
            pg_last_wal_replay_lsn()::text AS replay_lsn,
            pg_last_xact_replay_timestamp() AS last_replay`,
    undefined,
    limitations,
    'Replication role'
  )
  if (roleRows.length === 0) {
    limitations.push('This host must not be assumed to be a safe primary.')
    return {
      role: 'unknown',
      in_recovery: null,
      current_lsn: null,
      receive_lsn: null,
      replay_lsn: null,
      replay_lag_bytes: null,
      synchronous_commit: null,
      synchronous_standby_names: null,
      streaming_standbys: [],
      caught_up_standbys: 0,
      last_replay: null,
      automatic_failover: { verified: false, detail: 'Replication role could not be determined.' },
      limitations
    }
  }

  const roleRow = roleRows[0]
  const inRecovery = roleRow?.in_recovery === true
  const settingsRows = await safeRows(
    query,
    `SELECT current_setting('synchronous_commit') AS synchronous_commit,
            current_setting('synchronous_standby_names') AS synchronous_standby_names`,
    undefined,
    limitations,
    'Synchronous replication settings'
  )
  const settingsRow = settingsRows[0] ?? {}
  let currentLsn: string | null = null
  let replayLag: number | null = null
  const standbys: ReplicationStandby[] = []

  if (inRecovery) {
    const recoveryRows = await safeRows(
      query,
      `SELECT pg_last_wal_replay_lsn()::text AS replay_lsn,
              CASE WHEN pg_last_wal_receive_lsn() IS NULL OR pg_last_wal_replay_lsn() IS NULL THEN NULL
                   ELSE pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn())::text END AS replay_lag_bytes`,
      undefined,
      limitations,
      'Standby replay position'
    )
    replayLag = numberValue(recoveryRows[0]?.replay_lag_bytes)
    limitations.push('This host is in recovery and must not accept Bar writes.')
  } else {
    const primaryRows = await safeRows(
      query,
      `SELECT pg_current_wal_lsn()::text AS current_lsn`,
      undefined,
      limitations,
      'Primary write position'
    )
    currentLsn = stringValue(primaryRows[0]?.current_lsn)
    replayLag = null
    const standbyRows = await safeRows(
      query,
      `SELECT application_name, state, sync_state,
              sent_lsn::text AS sent_lsn, flush_lsn::text AS flush_lsn, replay_lsn::text AS replay_lsn,
              CASE WHEN replay_lsn IS NULL THEN NULL
                   ELSE pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)::text END AS replay_lag_bytes
         FROM pg_stat_replication
        ORDER BY application_name`,
      undefined,
      limitations,
      'Streaming standby list'
    )
    for (const row of standbyRows) {
      standbys.push({
        application_name: stringValue(row.application_name) ?? '',
        state: stringValue(row.state),
        sync_state: stringValue(row.sync_state),
        sent_lsn: stringValue(row.sent_lsn),
        flush_lsn: stringValue(row.flush_lsn),
        replay_lsn: stringValue(row.replay_lsn),
        replay_lag_bytes: numberValue(row.replay_lag_bytes)
      })
    }
    if (!inRecovery && standbys.length === 0) {
      limitations.push('No streaming standby is connected; local data has no replication evidence.')
    }
  }

  const caughtUp = standbys.filter(
    (standby) => standby.state === 'streaming' && standby.replay_lag_bytes !== null && standby.replay_lag_bytes <= CAUGHT_UP_LAG_BYTES
  ).length

  return {
    role: inRecovery ? 'standby' : 'primary',
    in_recovery: inRecovery,
    current_lsn: currentLsn,
    receive_lsn: stringValue(roleRow?.receive_lsn),
    replay_lsn: stringValue(roleRow?.replay_lsn),
    replay_lag_bytes: replayLag,
    synchronous_commit: stringValue(settingsRow.synchronous_commit),
    synchronous_standby_names: stringValue(settingsRow.synchronous_standby_names),
    streaming_standbys: standbys,
    caught_up_standbys: caughtUp,
    last_replay: dateValue(roleRow?.last_replay),
    automatic_failover: { verified: false, detail: 'No supported automatic failover coordinator is evidenced by this host.' },
    limitations
  }
}

function requireAdminUrl(settings: ReplicationSettings): string {
  if (!settings.adminDatabaseUrl) {
    throw new ReplicationError('REPLICATION_CONFIG_MISSING', 'BAR_LOCAL_ADMIN_DATABASE_URL is required for this replication operation.')
  }
  return settings.adminDatabaseUrl
}

async function withClient<T>(
  url: string,
  applicationName: string,
  deps: ReplicationDependencies,
  action: (client: ReplicationClient) => Promise<T>
): Promise<T> {
  const client = deps.connect ? await deps.connect(url, applicationName) : await connectPostgres(url, applicationName)
  try {
    return await action(client)
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function runSql(client: ReplicationClient, sql: string, params?: readonly unknown[]): Promise<SqlRow[]> {
  return (await client.query(sql, params)).rows
}

async function inspectWithClient(client: ReplicationClient, settings: ReplicationSettings, deps: ReplicationDependencies): Promise<ReplicationReport> {
  return inspectReplication({ query: client.query.bind(client) }, settings, deps)
}

function durabilityApplied(report: ReplicationReport, profile: 'single_host' | 'synchronous_one_standby'): boolean {
  if (report.synchronous_commit !== 'on') return false
  if (profile === 'synchronous_one_standby') {
    return report.synchronous_standby_names === 'ANY 1 (*)' && report.caught_up_standbys >= 1
  }
  return report.synchronous_standby_names === null || report.synchronous_standby_names === ''
}

export async function setDurability(
  settings: ReplicationSettings,
  profile: 'single_host' | 'synchronous_one_standby',
  deps: ReplicationDependencies = {}
): Promise<DurabilityReport> {
  if (profile !== 'single_host' && profile !== 'synchronous_one_standby') {
    throw new ReplicationError('REPLICATION_DURABILITY_FAILED', 'Unsupported durability profile.')
  }
  const url = requireAdminUrl(settings)
  return withClient(url, 'bar-local-admin-durability', deps, async (client) => {
    const report = await inspectWithClient(client, settings, deps)
    if (report.role !== 'primary') {
      throw new ReplicationError('REPLICATION_PRIMARY_NOT_PRIMARY', 'The administrative target is not a writable primary.')
    }

    if (profile === 'synchronous_one_standby') {
      if (report.caught_up_standbys < 1) {
        throw new ReplicationError('REPLICATION_STANDBY_REQUIRED', 'synchronous_one_standby requires at least one caught-up streaming standby.')
      }
      await runSql(client, `ALTER SYSTEM SET synchronous_commit = 'on'`)
      await runSql(client, `ALTER SYSTEM SET synchronous_standby_names = 'ANY 1 (*)'`)
    } else {
      await runSql(client, `ALTER SYSTEM SET synchronous_commit = 'on'`)
      await runSql(client, `ALTER SYSTEM RESET synchronous_standby_names`)
    }
    await runSql(client, 'SELECT pg_reload_conf()')

    const sleep = deps.sleep ?? sleepDefault
    const reloadDeadline = Date.now() + 5000
    let verified = await inspectWithClient(client, settings, deps)
    while (!durabilityApplied(verified, profile) && Date.now() <= reloadDeadline) {
      await sleep(250)
      verified = await inspectWithClient(client, settings, deps)
    }
    if (!durabilityApplied(verified, profile)) {
      if (verified.synchronous_commit !== 'on') {
        throw new ReplicationError('REPLICATION_DURABILITY_FAILED', 'PostgreSQL did not apply synchronous_commit=on.', { observed: verified.synchronous_commit })
      }
      if (profile === 'synchronous_one_standby') {
        throw new ReplicationError('REPLICATION_DURABILITY_FAILED', 'Synchronous one-standby durability could not be verified.', {
          synchronous_standby_names: verified.synchronous_standby_names,
          caught_up_standbys: verified.caught_up_standbys
        })
      }
      throw new ReplicationError('REPLICATION_DURABILITY_FAILED', 'Single-host durability could not clear synchronous_standby_names.', {
        synchronous_standby_names: verified.synchronous_standby_names
      })
    }

    return {
      ok: true,
      profile,
      synchronous_commit: verified.synchronous_commit,
      synchronous_standby_names: verified.synchronous_standby_names,
      caught_up_standbys: verified.caught_up_standbys,
      checked_at: (deps.now?.() ?? new Date()).toISOString()
    }
  })
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(value)) {
    throw new ReplicationError('REPLICATION_IDENTIFIER_INVALID', 'The administrative database name is not a safe SQL identifier.')
  }
  return `"${value}"`
}

function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url)
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''))
}

function operation(report: SwitchoverReport, target: string, sql: string, now: () => Date): void {
  report.operations.push({ target, sql, at: now().toISOString() })
}

async function fencePrimary(
  client: ReplicationClient,
  database: string,
  report: SwitchoverReport,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number
): Promise<void> {
  const commands = [
    // A read-only default alone is not a writer fence: existing sessions can
    // retain their old setting. Deny reconnects before draining every runtime
    // backend, regardless of its application_name.
    `ALTER ROLE bar_local_runtime NOLOGIN`,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND usename = 'bar_local_runtime' AND pid <> pg_backend_pid()`,
    `SELECT bar_local.service_failover_fence('PLANNED_SERVER_REPLACEMENT')`,
    `ALTER SYSTEM SET default_transaction_read_only = on`,
    `ALTER DATABASE ${quoteIdentifier(database)} SET default_transaction_read_only = on`,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND application_name = '${SERVICE_APPLICATION_NAME}' AND pid <> pg_backend_pid()`,
    `SELECT pg_reload_conf()`
  ]
  for (const sql of commands) {
    operation(report, 'primary', sql, now)
    await runSql(client, sql, sql.includes('datname = $1') ? [database] : undefined)
  }

  const deadline = Date.now() + Math.max(0, timeoutMs)
  let ro: string | null = null
  let activeWriters = 0
  let inRecovery: unknown = null
  do {
    const readOnly = await runSql(client, `SELECT current_setting('default_transaction_read_only') AS read_only`)
    const writers = await runSql(
      client,
      `SELECT count(*)::int AS writers FROM pg_stat_activity WHERE datname = $1 AND usename = 'bar_local_runtime' AND pid <> pg_backend_pid()`,
      [database]
    )
    const recovery = await runSql(client, 'SELECT pg_is_in_recovery() AS in_recovery')
    ro = stringValue(readOnly[0]?.read_only)
    activeWriters = numberValue(writers[0]?.writers) ?? 0
    inRecovery = recovery[0]?.in_recovery ?? null
    const role = await runSql(client, "SELECT rolcanlogin FROM pg_roles WHERE rolname = 'bar_local_runtime'")
    const fence = await runSql(client, 'SELECT bar_local.authority_fenced() AS fenced')
    if (ro === 'on' && activeWriters === 0 && inRecovery === false && role[0]?.rolcanlogin === false && fence[0]?.fenced === true) return
    await sleep(250)
  } while (Date.now() < deadline)

  throw new ReplicationError('REPLICATION_FENCE_FAILED', 'Primary fencing could not be verified.', {
    read_only: ro,
    active_service_writers: activeWriters,
    in_recovery: inRecovery
  })
}

async function promoteStandby(
  standby: ReplicationClient,
  database: string,
  report: SwitchoverReport,
  now: () => Date,
  promoteTimeoutSeconds: number,
  sleep: (ms: number) => Promise<void>
): Promise<string | null> {
  operation(report, 'standby', 'SELECT pg_promote(false) AS promoted', now)
  const promoted = await runSql(standby, 'SELECT pg_promote(false) AS promoted')
  if (promoted[0]?.promoted === false) {
    throw new ReplicationError('REPLICATION_PROMOTION_FAILED', 'PostgreSQL refused to promote the standby.')
  }

  const deadline = Date.now() + Math.max(1, Math.floor(promoteTimeoutSeconds)) * 1000
  let recovered = false
  while (Date.now() <= deadline) {
    const recovery = await runSql(standby, 'SELECT pg_is_in_recovery() AS in_recovery')
    if (recovery[0]?.in_recovery === false) {
      recovered = true
      break
    }
    await sleep(500)
  }
  if (!recovered) {
    throw new ReplicationError('REPLICATION_PROMOTION_FAILED', 'The standby did not leave recovery before the promotion deadline.')
  }

  // Promotion is irreversible even if later configuration fails. Preserve
  // that fact in the recovery report rather than claiming no promotion.
  const promotedLsn = await runSql(standby, 'SELECT pg_current_wal_lsn()::text AS lsn')
  report.promoted = { verified: true, lsn: stringValue(promotedLsn[0]?.lsn), at: now().toISOString() }

  // These administrative configuration commits must not wait for a new
  // standby that cannot join until configuration finishes. This connection
  // performs no financial commands. Trading connections retain synchronous
  // durability and are never downgraded by this session-local setting.
  operation(report, 'standby', "SET synchronous_commit = 'local'", now)
  await runSql(standby, "SET synchronous_commit = 'local'")

  const commands = [
    `SET default_transaction_read_only = off`,
    `ALTER SYSTEM SET default_transaction_read_only = off`,
    `ALTER DATABASE ${quoteIdentifier(database)} SET default_transaction_read_only = off`,
    `SELECT pg_reload_conf()`
  ]
  for (const sql of commands) {
    operation(report, 'standby', sql, now)
    await runSql(standby, sql)
  }

  const readOnly = await runSql(standby, `SELECT current_setting('default_transaction_read_only') AS read_only`)
  if (stringValue(readOnly[0]?.read_only) !== 'off') {
    throw new ReplicationError('REPLICATION_PROMOTION_FAILED', 'Standby promotion could not be verified.', {
      in_recovery: false,
      read_only: stringValue(readOnly[0]?.read_only)
    })
  }
  const lsnRows = await runSql(standby, 'SELECT pg_current_wal_lsn()::text AS lsn')
  return stringValue(lsnRows[0]?.lsn)
}

export async function switchover(settings: ReplicationSettings, deps: ReplicationDependencies = {}): Promise<SwitchoverReport> {
  const now = deps.now ?? (() => new Date())
  const sleep = deps.sleep ?? sleepDefault
  const report: SwitchoverReport = {
    ok: false,
    coordinator: 'manual',
    authority_state: 'fence_failed',
    client_repoint_required: false,
    fenced: null,
    promoted: null,
    operations: [],
    error: null,
    checked_at: now().toISOString()
  }

  if (settings.coordinator !== 'manual') {
    throw new ReplicationError('COORDINATOR_UNVERIFIED', 'Switchover requires BAR_LOCAL_REPLICATION_COORDINATOR=manual; automatic coordination is unverified.', {
      coordinator: settings.coordinator
    })
  }
  const primaryUrl = requireAdminUrl(settings)
  if (!settings.standbyAdminDatabaseUrl) {
    throw new ReplicationError('REPLICATION_CONFIG_MISSING', 'BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL is required for switchover.')
  }
  const standbyUrl = settings.standbyAdminDatabaseUrl
  const database = databaseNameFromUrl(primaryUrl)

  return withClient(primaryUrl, 'bar-local-admin-switchover-primary', deps, async (primary) => {
    const primaryReport = await inspectWithClient(primary, settings, deps)
    if (primaryReport.role !== 'primary') {
      throw new ReplicationError('REPLICATION_PRIMARY_NOT_PRIMARY', 'The configured primary is not a writable primary.')
    }

    return withClient(standbyUrl, 'bar-local-admin-switchover-standby', deps, async (standby) => {
      const standbyReport = await inspectWithClient(standby, settings, deps)
      if (standbyReport.role !== 'standby') {
        throw new ReplicationError('REPLICATION_ROLE_UNVERIFIED', 'The configured standby is not in recovery.')
      }
      if (standbyReport.synchronous_standby_names !== primaryReport.synchronous_standby_names
        || standbyReport.synchronous_commit !== primaryReport.synchronous_commit) {
        throw new ReplicationError('REPLICATION_DURABILITY_FAILED', 'The standby must be provisioned with the same durability settings before promotion. Configuration files are not streamed with the database.')
      }
      const receiver = await runSql(standby, 'SELECT status FROM pg_stat_wal_receiver LIMIT 1')
      const receiverStatus = stringValue(receiver[0]?.status)
      if (receiverStatus !== 'streaming') {
        throw new ReplicationError('REPLICATION_STANDBY_NOT_STREAMING', 'The standby WAL receiver is not streaming.', { status: receiverStatus })
      }
      const primaryIdentity = await runSql(primary, 'SELECT system_identifier::text AS id FROM pg_control_system()')
      const standbyIdentity = await runSql(standby, 'SELECT system_identifier::text AS id FROM pg_control_system()')
      if (!primaryIdentity[0]?.id || primaryIdentity[0].id !== standbyIdentity[0]?.id || databaseNameFromUrl(standbyUrl) !== database) {
        throw new ReplicationError('REPLICATION_ROLE_UNVERIFIED', 'Replacement must be a physical replica of this exact PostgreSQL cluster and database.')
      }
      const authority = await runSql(primary, 'SELECT authority_id::text AS id, authority_epoch::text AS epoch FROM bar_local.authority WHERE singleton')
      if (!authority[0]?.id || !/^\d+$/.test(String(authority[0].epoch))) throw new ReplicationError('REPLICATION_ROLE_UNVERIFIED', 'A commissioned authority epoch is required for replacement.')
      const nextEpoch = (BigInt(String(authority[0].epoch)) + 1n).toString()
      const prepared = await runSql(primary, 'SELECT count(*)::int AS count FROM pg_prepared_xacts WHERE database = $1', [database])
      if (Number(prepared[0]?.count) !== 0) throw new ReplicationError('REPLICATION_FENCE_FAILED', 'Resolve prepared transactions before replacing this server.')
      const catchupTimeoutMs = deps.catchupTimeoutMs ?? DEFAULT_CATCHUP_TIMEOUT_MS
      const deadline = Date.now() + catchupTimeoutMs
      let caughtUp = false
      let lastPrimaryLsn: string | null = null
      while (Date.now() <= deadline) {
        const lsnRows = await runSql(primary, 'SELECT pg_current_wal_lsn()::text AS lsn')
        const primaryLsn = stringValue(lsnRows[0]?.lsn)
        const currentStandby = await inspectWithClient(standby, settings, deps)
        let lag: number | null = null
        if (primaryLsn && currentStandby.replay_lsn) {
          const lagRows = await runSql(
            primary,
            'SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::text AS lag_bytes',
            [primaryLsn, currentStandby.replay_lsn]
          )
          lag = numberValue(lagRows[0]?.lag_bytes)
        }
        lastPrimaryLsn = primaryLsn
        if (lag !== null && lag <= CAUGHT_UP_LAG_BYTES && currentStandby.role === 'standby') {
          caughtUp = true
          break
        }
        await sleep(1000)
      }
      if (!caughtUp) {
        throw new ReplicationError('REPLICATION_CATCHUP_TIMEOUT', 'The standby did not catch up before the switchover deadline.', {
          target_lsn: lastPrimaryLsn
        })
      }

      try {
        await fencePrimary(primary, database, report, now, sleep, deps.fenceTimeoutMs ?? 5000)
        report.fenced = { verified: true, at: now().toISOString() }
      } catch (error) {
        report.authority_state = 'fence_failed'
        report.error = { code: error instanceof ReplicationError ? error.code : 'REPLICATION_FENCE_FAILED', message: errorMessage(error) }
        report.checked_at = now().toISOString()
        return report
      }

      report.authority_state = 'fenced_no_promotion'
      report.client_repoint_required = true
      const finalDeadline = Date.now() + catchupTimeoutMs
      let finalLsn: string | null = null
      let finalCaughtUp = false
      while (Date.now() <= finalDeadline) {
        const finalRows = await runSql(primary, 'SELECT pg_current_wal_lsn()::text AS lsn')
        const observedFinal = stringValue(finalRows[0]?.lsn)
        const currentStandby = await inspectWithClient(standby, settings, deps)
        let lag: number | null = null
        if (observedFinal && currentStandby.replay_lsn) {
          const lagRows = await runSql(
            primary,
            'SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::text AS lag_bytes',
            [observedFinal, currentStandby.replay_lsn]
          )
          lag = numberValue(lagRows[0]?.lag_bytes)
        }
        if (observedFinal && lag !== null && lag <= 0 && finalLsn === observedFinal) {
          finalCaughtUp = true
          break
        }
        finalLsn = observedFinal
        await sleep(500)
      }
      if (!finalCaughtUp) {
        report.ok = false
        report.authority_state = report.promoted ? 'promoted' : 'fenced_no_promotion'
        report.client_repoint_required = true
        report.error = {
          code: 'REPLICATION_CATCHUP_TIMEOUT',
          message: 'The standby did not replay all WAL from the fenced primary before the promotion deadline.'
        }
        report.checked_at = now().toISOString()
        return report
      }

      try {
        const lsn = await promoteStandby(standby, database, report, now, deps.promoteTimeoutSeconds ?? DEFAULT_PROMOTE_TIMEOUT_SECONDS, sleep)
        const epoch = await runSql(standby, 'SELECT bar_local.service_failover_promote($1::bigint, $2::jsonb) AS result', [nextEpoch, JSON.stringify({ method: 'planned_physical_replacement', source_fenced: true, authority_id: authority[0].id, final_replayed_lsn: finalLsn })])
        if (String((epoch[0]?.result as Record<string, unknown> | undefined)?.authority_epoch) !== nextEpoch) throw new ReplicationError('REPLICATION_PROMOTION_FAILED', 'Replacement epoch could not be verified. Keep both servers stopped for trading.')
        await runSql(standby, 'ALTER ROLE bar_local_runtime LOGIN')
        report.ok = true
        report.authority_state = 'promoted'
        report.promoted = { verified: true, lsn, at: now().toISOString() }
      } catch (error) {
        report.ok = false
        report.authority_state = report.promoted ? 'promoted' : 'fenced_no_promotion'
        report.client_repoint_required = true
        report.error = {
          code: error instanceof ReplicationError ? error.code : 'REPLICATION_PROMOTION_FAILED',
          message: errorMessage(error)
        }
      }
      report.checked_at = now().toISOString()
      return report
    })
  })
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}

function isPrivateHost(host: string): boolean {
  const value = host.toLowerCase()
  if (/^10\./.test(value) || /^192\.168\./.test(value)) return true
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(value)) return true
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true
  return false
}

function validatePrimaryHost(host: string, allowPrivate: boolean): void {
  if (isLoopbackHost(host)) return
  if (allowPrivate && isPrivateHost(host)) return
  throw new ReplicationError('REPLICATION_PRIMARY_HOST_REFUSED', 'The primary host is not loopback; private hosts require an explicit override and public hosts are always refused.', {
    host
  })
}

function toolName(explicit: string | undefined, pgBin: string | null, name: string): string {
  if (explicit) return explicit
  if (pgBin) return path.join(pgBin, process.platform === 'win32' ? `${name}.exe` : name)
  return name
}

function cleanEnvironment(password: string | null | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of [
    'BAR_LOCAL_ADMIN_DATABASE_URL',
    'BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL',
    'BAR_LOCAL_BACKUP_KEY',
    'BAR_LOCAL_BACKUP_KEY_FILE',
    'BAR_LOCAL_SETUP_SECRET',
    'BAR_LOCAL_RUNTIME_PASSWORD',
    'BAR_LOCAL_DB_PASSWORD',
    'BAR_LOCAL_REPLICATION_PASSWORD',
    'PGPASSWORD'
  ]) {
    delete env[key]
  }
  if (password) env.PGPASSWORD = password
  return env
}

export async function enrollStandby(
  options: EnrollStandbyOptions,
  settings: Pick<ReplicationSettings, 'pgBin'>,
  deps: ReplicationDependencies = {}
): Promise<EnrollStandbyReport> {
  if (!options.confirm) {
    throw new ReplicationError('REPLICATION_CONFIRMATION_REQUIRED', 'Standby enrollment requires explicit confirmation.')
  }
  if (!Number.isInteger(options.primaryPort) || options.primaryPort < 1 || options.primaryPort > 65535) {
    throw new ReplicationError('REPLICATION_CONNECT_FAILED', 'The primary port is invalid.')
  }
  validatePrimaryHost(options.primaryHost, options.allowPrivatePrimary === true)
  if (!options.replicationUser.trim()) {
    throw new ReplicationError('REPLICATION_CONNECT_FAILED', 'A replication user is required.')
  }
  if (!options.standbyDatabaseUrl) {
    throw new ReplicationError('REPLICATION_CONFIG_MISSING', 'BAR_LOCAL_STANDBY_ADMIN_DATABASE_URL is required to verify streaming after enrollment.')
  }

  const dataDir = path.resolve(options.standbyDataDir)
  try {
    mkdirSync(dataDir, { recursive: true })
    if (readdirSync(dataDir).length > 0) {
      throw new ReplicationError('REPLICATION_DATA_DIR_NOT_EMPTY', 'The standby data directory must be empty; existing data is never deleted.', { data_dir: dataDir })
    }
  } catch (error) {
    if (error instanceof ReplicationError) throw error
    throw new ReplicationError('REPLICATION_DATA_DIR_UNAVAILABLE', 'The standby data directory is not usable.', { data_dir: dataDir })
  }

  const runCommand = deps.runCommand ?? defaultRunCommand
  const pgBaseBackup = toolName(options.pgBaseBackup, settings.pgBin, 'pg_basebackup')
  const pgCtl = toolName(options.pgCtl, settings.pgBin, 'pg_ctl')
  const env = cleanEnvironment(options.password)

  const basebackup = await runCommand(
    pgBaseBackup,
    ['-h', options.primaryHost, '-p', String(options.primaryPort), '-U', options.replicationUser, '-D', dataDir, '-Fp', '-Xs', '-R', '-P', '--checkpoint=fast'],
    { env, timeoutMs: options.timeoutMs ?? 15 * 60_000 }
  )
  if (basebackup.exit_code !== 0) {
    throw new ReplicationError('REPLICATION_BASEBACKUP_FAILED', 'pg_basebackup failed; the standby was not enrolled.', {
      exit_code: basebackup.exit_code,
      stderr: basebackup.stderr.slice(-4000)
    })
  }

  const localTarget = new URL(options.standbyDatabaseUrl)
  if (!isLoopbackHost(localTarget.hostname.replace(/^\[|\]$/g, ''))) throw new ReplicationError('REPLICATION_CONFIG_MISSING', 'Enrollment verifies and starts the standby on this computer over loopback.')
  const localPort = Number(localTarget.port || 5432)
  if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535 || (isLoopbackHost(options.primaryHost) && localPort === options.primaryPort)) throw new ReplicationError('REPLICATION_CONFIG_MISSING', 'Choose a distinct local standby port; the primary listener must not be reused.')
  // A physical copy includes the primary's configuration. Never start that
  // copy on the primary port or expose an inherited network listener/cert path.
  await appendFile(path.join(dataDir, 'postgresql.auto.conf'), `\nlisten_addresses='127.0.0.1'\nport=${localPort}\nssl=off\n`, { mode: 0o600 })

  const start = await runCommand(
    pgCtl,
    ['-D', dataDir, '-l', `${dataDir}.startup.log`, '-w', '-t', String(Math.max(5, Math.floor((options.timeoutMs ?? 120_000) / 1000))), 'start'],
    { env, timeoutMs: (options.timeoutMs ?? 120_000) + 15_000 }
  )
  if (start.exit_code !== 0) {
    throw new ReplicationError('REPLICATION_START_FAILED', 'The standby server did not start.', {
      exit_code: start.exit_code,
      stderr: start.stderr.slice(-4000)
    })
  }

  await withClient(options.standbyDatabaseUrl, 'bar-local-admin-enroll-verify', deps, async (standby) => {
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_CATCHUP_TIMEOUT_MS)
    const sleep = deps.sleep ?? sleepDefault
    while (Date.now() <= deadline) {
      const role = await runSql(standby, 'SELECT pg_is_in_recovery() AS in_recovery')
      const receiver = await runSql(standby, 'SELECT status FROM pg_stat_wal_receiver LIMIT 1')
      if (role[0]?.in_recovery === true && stringValue(receiver[0]?.status) === 'streaming') return
      await sleep(1000)
    }
    throw new ReplicationError('REPLICATION_STREAMING_TIMEOUT', 'The standby did not report a streaming WAL receiver before the deadline.')
  })

  return {
    ok: true,
    standby_data_dir: dataDir,
    primary: { host: options.primaryHost, port: options.primaryPort },
    streaming_verified: true,
    completed_at: (deps.now?.() ?? new Date()).toISOString()
  }
}
