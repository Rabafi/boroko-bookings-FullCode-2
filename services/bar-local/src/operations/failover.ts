import { performance } from 'node:perf_hooks'
import type { Pool } from 'pg'
import type { ServiceConfig } from '../config.js'
import { callFunction } from '../db.js'
import type { JsonRecord } from '../db.js'
import { connectPostgres, ReplicationError, setDurability } from './replication.js'
import type { ReplicationClient, ReplicationDependencies, ReplicationSettings } from './replication.js'
import { WitnessClient, WitnessError } from './witness.js'
import type { WitnessLeaseGrant, WitnessSnapshot } from './witness.js'

/**
 * Witness-gated automatic failover.
 *
 * The local PostgreSQL authority remains the only financial writer. This
 * controller never invents totals and never promotes a host that cannot prove
 * it is current. The safety argument is:
 *
 *   1. A primary may write only while it holds a live witness lease whose epoch
 *      equals its local authority epoch.
 *   2. If the lease cannot be renewed, the primary closes its in-process write
 *      gate immediately and fences the database before the lease expires.
 *   3. A standby promotes only after the lease has expired, its replay position
 *      covers the primary's last reported WAL position, synchronous durability
 *      was in force, and the witness grants a strictly newer epoch.
 *   4. Promotion advances the authority epoch by exactly one and revokes every
 *      session. A stale or partitioned host therefore cannot re-join by simply
 *      restarting: its epoch no longer matches and it is fenced.
 *
 * Known bound: a command already executing on the old primary when the fence
 * lands can still commit. The lease TTL is required to exceed the database
 * statement timeout plus a renewal margin, and the standby does not promote
 * until the lease has expired, so that window is bounded by configuration.
 */

export type FailoverMode = 'disabled' | 'witness'
export type FailoverRole = 'primary' | 'standby'

export type FailoverDecisionCode =
  | 'DISABLED'
  | 'HEALTHY_PRIMARY'
  | 'PROMOTED'
  | 'ALREADY_PRIMARY'
  | 'WAITING_FOR_PRIMARY'
  | 'WAITING_FOR_LEASE'
  | 'WAITING_FOR_CATCHUP'
  | 'AUTHORITY_NOT_COMMISSIONED'
  | 'STANDBY_NOT_IN_RECOVERY'
  | 'ROLE_MISMATCH'
  | 'LEASE_HELD_BY_OTHER'
  | 'LEASE_REVOKED'
  | 'LEASE_LOST'
  | 'WITNESS_UNREACHABLE'
  | 'LOCAL_DATABASE_UNAVAILABLE'
  | 'WITNESS_EPOCH_AHEAD'
  | 'WITNESS_EPOCH_BEHIND'
  | 'FENCED'
  | 'PROMOTION_REFUSED'
  | 'PROMOTION_FAILED'
  | 'PROMOTION_EPOCH_FAILED'

export interface FailoverLogger {
  info?(record: JsonRecord): void
  error?(record: JsonRecord): void
}

export interface AuthorityGate {
  allowWrites(): boolean
  reason(): string | null
}

export interface FailoverStatus extends JsonRecord {
  mode: FailoverMode
  role: FailoverRole
  instance_id: string | null
  cluster_id: string | null
  witness_url: string | null
  authority_url: string | null
  gate: { open: boolean; reason: string | null }
  automatic_failover: { verified: boolean; detail: string }
  lease: {
    held: boolean
    epoch: number | null
    holder_id: string | null
    holder_matches: boolean
    expires_at: string | null
    remaining_ms: number | null
  }
  witness: WitnessSnapshot | null
  local: {
    fenced: boolean
    fence_epoch: number
    fence_reason: string | null
    authority_epoch: number | null
    promoted_epoch: number | null
    in_recovery: boolean | null
  } | null
  durability: { downgraded: boolean; detail: string | null; reported: 'synchronous' | 'single_host' | null }
  last_success_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  last_decision: FailoverDecisionCode | null
  blockers: string[]
  checked_at: string
}

export interface FailoverDecision {
  decision: FailoverDecisionCode
  blockers: string[]
  retry_after_ms?: number
}

export interface LocalAuthorityState {
  fenced: boolean
  fence_epoch: number
  fence_reason: string | null
  authority_epoch: number | null
  promoted_epoch: number | null
  in_recovery: boolean | null
}

export interface FailoverQueryHost {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export interface FailoverDependencies {
  witness?: WitnessClient | null
  query?: FailoverQueryHost['query']
  connect?: (url: string, applicationName: string) => Promise<ReplicationClient>
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  monotonicNow?: () => number
  durability?: (settings: ReplicationSettings) => Promise<void>
  /** Test/embedding seam: fence the local database. Defaults to the trusted
   *  `service_failover_fence` function. */
  fence?: (reason: string) => Promise<void>
  /** Test/embedding seam: apply the promotion epoch. Defaults to the trusted
   *  `service_failover_promote` function. */
  promote?: (epoch: number, evidence: Record<string, unknown>) => Promise<void>
  replicationDependencies?: ReplicationDependencies
}

export interface FailoverControllerOptions {
  config: ServiceConfig
  pool: Pool
  logger?: FailoverLogger | null
  dependencies?: FailoverDependencies
}

export interface FailoverController {
  readonly mode: FailoverMode
  readonly role: FailoverRole
  readonly gate: AuthorityGate
  start(): void
  stop(): Promise<void>
  status(): Promise<FailoverStatus>
  checkNow(): Promise<FailoverDecision>
  fence(reason: string): Promise<FailoverStatus>
}

const LSN_RE = /^[0-9A-Fa-f]{1,8}\/[0-9A-Fa-f]{1,8}$/

export function compareLsn(left: string, right: string): number {
  if (!LSN_RE.test(left) || !LSN_RE.test(right)) {
    throw new Error('An LSN must look like 0/1A2B3C.')
  }
  const [leftHigh, leftLow] = left.toUpperCase().split('/')
  const [rightHigh, rightLow] = right.toUpperCase().split('/')
  const lh = BigInt(`0x${leftHigh}`)
  const ll = BigInt(`0x${leftLow}`)
  const rh = BigInt(`0x${rightHigh}`)
  const rl = BigInt(`0x${rightLow}`)
  if (lh !== rh) return lh < rh ? -1 : 1
  if (ll === rl) return 0
  return ll < rl ? -1 : 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function errorCode(error: unknown): string {
  if (error instanceof WitnessError) return error.code
  if (error instanceof ReplicationError) return error.code
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.trim() !== '') return code
  }
  return 'FAILOVER_FAILED'
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  return 'The failover operation failed.'
}

function redactUrl(value: string | null): string | null {
  if (value === null) return null
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

function isoOrNull(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

export function createFailoverController(options: FailoverControllerOptions): FailoverController {
  const { config, pool, logger = null } = options
  const settings = config.failover
  const deps = options.dependencies ?? {}
  const now = deps.now ?? (() => new Date())
  const monoNow = deps.monotonicNow ?? (() => performance.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const witness = deps.witness ?? (
    settings.mode === 'witness' && settings.witnessUrl && settings.clusterId && settings.secret
      ? new WitnessClient({
          baseUrl: settings.witnessUrl,
          clusterId: settings.clusterId,
          key: settings.secret,
          timeoutMs: settings.requestTimeoutMs
        })
      : null
  )

  const query: FailoverQueryHost['query'] = deps.query ?? ((sql, params) => pool.query(sql, params ? [...params] : undefined).then((result) => ({ rows: result.rows as Record<string, unknown>[] })))

  let started = false
  let stopped = false
  let timer: NodeJS.Timeout | null = null
  let inFlight: Promise<FailoverDecision> | null = null
  let gateOpen = settings.mode === 'disabled'
  let gateReason: string | null = settings.mode === 'disabled' ? null : 'FAILOVER_NOT_VERIFIED'
  let leaseEpoch: number | null = null
  let leaseDeadlineMono: number | null = null
  let durabilityDowngraded = false
  let durabilityDetail: string | null = null
  let lastSuccessAt: string | null = null
  let lastErrorCode: string | null = null
  let lastErrorMessage: string | null = null
  let lastDecision: FailoverDecisionCode | null = null
  let lastBlockers: string[] = []
  let witnessSnapshot: WitnessSnapshot | null = null
  let reportedDurability: 'synchronous' | 'single_host' | null = null
  let databaseFailureStreak = 0

  const gate: AuthorityGate = {
    allowWrites: () => {
      if (settings.mode === 'witness' && (leaseDeadlineMono === null || monoNow() >= leaseDeadlineMono)) {
        setGate(false, 'LEASE_EXPIRED')
      }
      return gateOpen
    },
    reason: () => gateReason
  }

  const safetyMs = Math.max(2000, Math.floor(settings.renewIntervalMs * 1.5))

  function setGate(open: boolean, reason: string | null): void {
    if (gateOpen === open && gateReason === reason) return
    gateOpen = open
    gateReason = open ? null : reason
    logger?.info?.({
      event: 'bar_local.failover.gate',
      open,
      reason,
      role: settings.role,
      instance_id: settings.instanceId
    })
  }

  function recordFailure(code: string, message: string, decision: FailoverDecisionCode): void {
    lastErrorCode = code
    lastErrorMessage = message
    lastDecision = decision
    logger?.error?.({ event: 'bar_local.failover.decision', decision, code, message, role: settings.role })
  }

  function recordSuccess(decision: FailoverDecisionCode): void {
    lastSuccessAt = now().toISOString()
    lastErrorCode = null
    lastErrorMessage = null
    lastDecision = decision
    lastBlockers = []
    logger?.info?.({ event: 'bar_local.failover.decision', decision, role: settings.role })
  }

  async function readLocal(): Promise<LocalAuthorityState | null> {
    const result = await query('SELECT bar_local.service_failover_status() AS result')
    const value = result.rows[0]?.result
    if (!isRecord(value)) return null
    return {
      fenced: booleanValue(value.fenced),
      fence_epoch: numberValue(value.fence_epoch) ?? 0,
      fence_reason: stringValue(value.fence_reason),
      authority_epoch: numberValue(value.authority_epoch),
      promoted_epoch: numberValue(value.promoted_epoch),
      in_recovery: typeof value.in_recovery === 'boolean' ? value.in_recovery : null
    }
  }

  async function readPosition(): Promise<{ in_recovery: boolean | null; lsn: string | null }> {
    const result = await query(
      `SELECT pg_is_in_recovery() AS in_recovery,
              CASE WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn()::text
                   ELSE pg_current_wal_lsn()::text END AS lsn`
    )
    const row = result.rows[0] ?? {}
    return {
      in_recovery: typeof row.in_recovery === 'boolean' ? row.in_recovery : null,
      lsn: stringValue(row.lsn)
    }
  }

  async function readDurability(): Promise<{ synchronous_commit: string | null; synchronous_standby_names: string | null }> {
    const result = await query(
      `SELECT current_setting('synchronous_commit') AS synchronous_commit,
              current_setting('synchronous_standby_names') AS synchronous_standby_names`
    )
    const row = result.rows[0] ?? {}
    return {
      synchronous_commit: stringValue(row.synchronous_commit),
      synchronous_standby_names: stringValue(row.synchronous_standby_names)
    }
  }

  /**
   * After promotion there is no standby until one is re-enrolled. If
   * synchronous_standby_names is still configured with no caught-up standby,
   * every command's `SET LOCAL synchronous_commit = on` would hang, so the gate
   * must stay closed instead of accepting work it can never commit.
   */
  async function promotedDurabilityUsable(): Promise<boolean> {
    try {
      const durability = await readDurability()
      if (durability.synchronous_commit !== 'on') return true
      if (durability.synchronous_standby_names === null || durability.synchronous_standby_names.trim() === '') return true
      const result = await query(
        `SELECT count(*)::int AS streaming FROM pg_stat_replication WHERE state = 'streaming'`
      )
      return numberValue(result.rows[0]?.streaming) !== null && Number(result.rows[0]?.streaming) >= 1
    } catch {
      return false
    }
  }

  function deadlineFrom(grant: WitnessLeaseGrant): number {
    const remaining = Math.max(0, grant.expires_at - grant.server_time)
    return monoNow() + Math.max(0, remaining - safetyMs)
  }

  function classifyDurability(value: { synchronous_commit: string | null; synchronous_standby_names: string | null }): 'synchronous' | 'single_host' {
    return value.synchronous_commit === 'on'
      && value.synchronous_standby_names !== null
      && value.synchronous_standby_names.trim() !== ''
      ? 'synchronous'
      : 'single_host'
  }

  async function releaseLease(): Promise<void> {
    if (leaseEpoch === null || !witness) {
      leaseEpoch = null
      leaseDeadlineMono = null
      return
    }
    try {
      await witness.release({ holderId: settings.instanceId as string, epoch: leaseEpoch })
    } catch {
      // The lease expires naturally; never wait on a release before fencing.
    }
    leaseEpoch = null
    leaseDeadlineMono = null
  }

  async function primaryDatabaseFailure(error: unknown): Promise<FailoverDecision> {
    databaseFailureStreak += 1
    setGate(false, 'LOCAL_DATABASE_UNAVAILABLE')
    recordFailure(errorCode(error), errorMessage(error), 'LOCAL_DATABASE_UNAVAILABLE')
    if (databaseFailureStreak >= 3) {
      // This host cannot serve and cannot prove it still owns the data. Stop
      // holding the lease so a healthy, caught-up standby is not blocked
      // forever behind a primary that is not trading.
      await releaseLease()
    }
    return { decision: 'LOCAL_DATABASE_UNAVAILABLE', blockers: ['local_database_unavailable'], retry_after_ms: settings.renewIntervalMs }
  }

  async function fenceDatabase(reason: string): Promise<void> {
    setGate(false, reason)
    try {
      if (deps.fence) {
        await deps.fence(reason)
      } else {
        await callFunction(pool, 'bar_local.service_failover_fence', [{ value: reason }])
      }
    } catch (error) {
      // The in-process gate is already closed. If the database cannot be
      // reached, it cannot accept a financial write either. The epoch check on
      // the next start remains the authoritative guard.
      logger?.error?.({
        event: 'bar_local.failover.fence_failed',
        reason,
        code: errorCode(error),
        message: errorMessage(error)
      })
    }
  }

  async function primaryCycle(): Promise<FailoverDecision> {
    let local: LocalAuthorityState | null
    try {
      local = await readLocal()
      databaseFailureStreak = 0
    } catch (error) {
      return primaryDatabaseFailure(error)
    }
    if (!local || local.authority_epoch === null) {
      setGate(false, 'AUTHORITY_NOT_COMMISSIONED')
      return { decision: 'AUTHORITY_NOT_COMMISSIONED', blockers: ['authority_not_commissioned'] }
    }
    if (local.in_recovery === true) {
      setGate(false, 'PRIMARY_CONFIGURED_BUT_DATABASE_IN_RECOVERY')
      recordFailure('FAILOVER_ROLE_MISMATCH', 'This host is configured as primary but its database is in recovery.', 'ROLE_MISMATCH')
      return { decision: 'ROLE_MISMATCH', blockers: ['database_in_recovery'] }
    }
    if (local.fenced) {
      setGate(false, local.fence_reason ?? 'AUTHORITY_FENCED')
      recordFailure('AUTHORITY_FENCED', 'This authority copy is fenced. Re-enrol it as a standby from the current primary before it can serve.', 'FENCED')
      return { decision: 'FENCED', blockers: ['authority_fenced'] }
    }
    if (!witness) {
      setGate(false, 'WITNESS_NOT_CONFIGURED')
      return { decision: 'WITNESS_UNREACHABLE', blockers: ['witness_not_configured'] }
    }

    let observed: WitnessSnapshot
    try {
      observed = await witness.state()
      witnessSnapshot = observed
    } catch (error) {
      // No lease has been granted yet: stay closed and retry. If a lease was
      // already held, keep renewing until the deadline, then fence.
      if (leaseDeadlineMono !== null && monoNow() >= leaseDeadlineMono) {
        await fenceDatabase('WITNESS_LEASE_LOST')
        recordFailure('FAILOVER_LEASE_LOST', 'The witness could not be reached before the lease deadline; this primary fenced itself.', 'LEASE_LOST')
        return { decision: 'LEASE_LOST', blockers: ['witness_unreachable', 'lease_expired'] }
      }
      setGate(false, 'WITNESS_UNREACHABLE')
      recordFailure(errorCode(error), errorMessage(error), 'WITNESS_UNREACHABLE')
      return { decision: 'WITNESS_UNREACHABLE', blockers: ['witness_unreachable'], retry_after_ms: settings.renewIntervalMs }
    }

    if (observed.leased && observed.holder_id !== null && observed.holder_id !== settings.instanceId) {
      await fenceDatabase('LEASE_HELD_BY_OTHER')
      recordFailure('FAILOVER_LEASE_HELD', 'Another host holds the live witness lease; this primary fenced itself.', 'LEASE_HELD_BY_OTHER')
      return { decision: 'LEASE_HELD_BY_OTHER', blockers: ['lease_held_by_other'] }
    }

    let position: { in_recovery: boolean | null; lsn: string | null }
    let durability: { synchronous_commit: string | null; synchronous_standby_names: string | null }
    try {
      position = await readPosition()
      durability = await readDurability()
    } catch (error) {
      return primaryDatabaseFailure(error)
    }
    if (position.in_recovery === true) {
      setGate(false, 'PRIMARY_CONFIGURED_BUT_DATABASE_IN_RECOVERY')
      return { decision: 'ROLE_MISMATCH', blockers: ['database_in_recovery'] }
    }
    reportedDurability = classifyDurability(durability)

    let grant: WitnessLeaseGrant
    try {
      grant = await witness.acquire({
        holderId: settings.instanceId as string,
        role: 'primary',
        expectedEpoch: observed.epoch,
        ttlMs: settings.leaseTtlMs,
        lsn: position.lsn,
        durability: reportedDurability,
        authorityUrl: settings.authorityUrl
      })
    } catch (error) {
      if (error instanceof WitnessError && error.code === 'WITNESS_LEASE_HELD') {
        await fenceDatabase('LEASE_HELD_BY_OTHER')
        recordFailure('FAILOVER_LEASE_HELD', 'Another host acquired the witness lease first; this primary fenced itself.', 'LEASE_HELD_BY_OTHER')
        return { decision: 'LEASE_HELD_BY_OTHER', blockers: ['lease_held_by_other'] }
      }
      if (leaseDeadlineMono !== null && monoNow() >= leaseDeadlineMono) {
        await fenceDatabase('WITNESS_LEASE_LOST')
        recordFailure('FAILOVER_LEASE_LOST', 'The witness lease could not be renewed before the deadline; this primary fenced itself.', 'LEASE_LOST')
        return { decision: 'LEASE_LOST', blockers: ['witness_unreachable', 'lease_expired'] }
      }
      setGate(false, 'WITNESS_UNREACHABLE')
      recordFailure(errorCode(error), errorMessage(error), 'WITNESS_UNREACHABLE')
      return { decision: 'WITNESS_UNREACHABLE', blockers: ['witness_unreachable'], retry_after_ms: 1000 }
    }

    leaseEpoch = grant.epoch
    leaseDeadlineMono = deadlineFrom(grant)
    witnessSnapshot = observed

    if (grant.epoch !== local.authority_epoch) {
      // The witness and this database disagree about which epoch may write.
      // Never "fix" this by bumping the database: a stale primary must not be
      // legitimised. Fence and release the lease so a current host can serve.
      const ahead = grant.epoch > local.authority_epoch
      await fenceDatabase(ahead ? 'STALE_AUTHORITY_EPOCH' : 'WITNESS_EPOCH_BEHIND')
      try {
        await witness.release({ holderId: settings.instanceId as string, epoch: grant.epoch })
      } catch {
        // The lease expires naturally.
      }
      leaseEpoch = null
      leaseDeadlineMono = null
      recordFailure(
        ahead ? 'FAILOVER_STALE_EPOCH' : 'FAILOVER_WITNESS_BEHIND',
        ahead
          ? 'This database is behind the witness epoch and cannot be the primary. Re-enrol it as a standby.'
          : 'The witness epoch is behind this database. Refusing to write until the witness and database agree.',
        ahead ? 'WITNESS_EPOCH_AHEAD' : 'WITNESS_EPOCH_BEHIND'
      )
      return { decision: ahead ? 'WITNESS_EPOCH_AHEAD' : 'WITNESS_EPOCH_BEHIND', blockers: [ahead ? 'stale_authority_epoch' : 'witness_epoch_behind'] }
    }

    setGate(true, null)
    recordSuccess('HEALTHY_PRIMARY')
    return { decision: 'HEALTHY_PRIMARY', blockers: [] }
  }

  async function standbyBlockers(local: LocalAuthorityState, observed: WitnessSnapshot, position: { in_recovery: boolean | null; lsn: string | null }): Promise<string[]> {
    const blockers: string[] = []
    if (local.authority_epoch === null) blockers.push('authority_not_commissioned')
    if (observed.holder_lsn === null) blockers.push('primary_lsn_unrecorded')
    if (position.lsn === null) blockers.push('standby_lsn_unrecorded')
    if (local.authority_epoch !== null && observed.epoch !== local.authority_epoch) {
      blockers.push('authority_epoch_gap')
    }
    if (position.lsn !== null && observed.holder_lsn !== null) {
      try {
        if (compareLsn(position.lsn, observed.holder_lsn) < 0) blockers.push('standby_behind_primary_lsn')
      } catch {
        blockers.push('lsn_unreadable')
      }
    }
    // Durability must be evidenced by the *primary* that gave up the lease. A
    // standby's own settings cannot prove how the primary acknowledged sales,
    // so the witness records the primary's last reported durability.
    if (observed.holder_durability === null) blockers.push('primary_durability_unrecorded')
    else if (observed.holder_durability !== 'synchronous') blockers.push('primary_durability_not_synchronous')
    return blockers
  }

  async function promoteLocalCluster(): Promise<{ downgraded: boolean; detail: string | null }> {
    if (!config.replication.adminDatabaseUrl) {
      throw new ReplicationError('REPLICATION_CONFIG_MISSING', 'Promotion requires BAR_LOCAL_ADMIN_DATABASE_URL for this host.')
    }
    const connect = deps.connect ?? connectPostgres
    const client = await connect(config.replication.adminDatabaseUrl, 'bar-local-failover-promote')
    try {
      await client.query("SELECT set_config('synchronous_commit', 'local', true)")
      const promoted = await client.query('SELECT pg_promote(false) AS promoted')
      if (promoted.rows[0]?.promoted === false) {
        throw new ReplicationError('REPLICATION_PROMOTION_FAILED', 'PostgreSQL refused to promote the standby.')
      }
      const deadline = monoNow() + settings.promoteTimeoutSeconds * 1000
      let writable = false
      while (monoNow() <= deadline) {
        const recovery = await client.query('SELECT pg_is_in_recovery() AS in_recovery')
        if (recovery.rows[0]?.in_recovery === false) {
          writable = true
          break
        }
        await sleep(500)
      }
      if (!writable) {
        throw new ReplicationError('REPLICATION_PROMOTION_FAILED', 'The standby did not leave recovery before the promotion deadline.')
      }
      await client.query("SET synchronous_commit = 'local'")
      await client.query('ALTER SYSTEM SET default_transaction_read_only = off')
      await client.query('SELECT pg_reload_conf()')
    } finally {
      await client.end().catch(() => undefined)
    }

    // With no standby attached, a synchronous commit would wait for a WAL
    // sender that cannot exist until the old host is re-enrolled. Downgrading
    // is deliberate, visible in status, and must succeed before the write gate
    // opens.
    try {
      if (deps.durability) {
        await deps.durability(config.replication)
      } else {
        await setDurability(config.replication, 'single_host', deps.replicationDependencies)
      }
      durabilityDowngraded = true
      durabilityDetail = 'Automatic promotion downgraded local durability to single_host until a standby is re-enrolled.'
      return { downgraded: true, detail: durabilityDetail }
    } catch (error) {
      durabilityDowngraded = false
      durabilityDetail = errorMessage(error)
      return { downgraded: false, detail: durabilityDetail }
    }
  }

  async function promoteEpoch(epoch: number, evidence: Record<string, unknown>): Promise<void> {
    if (deps.promote) {
      await deps.promote(epoch, evidence)
      return
    }
    await callFunction(pool, 'bar_local.service_failover_promote', [
      { value: epoch, cast: 'bigint' },
      { value: JSON.stringify(evidence), cast: 'jsonb' }
    ])
  }

  async function standbyCycle(): Promise<FailoverDecision> {
    let local: LocalAuthorityState | null
    let position: { in_recovery: boolean | null; lsn: string | null }
    try {
      local = await readLocal()
      position = await readPosition()
    } catch (error) {
      setGate(false, 'LOCAL_DATABASE_UNAVAILABLE')
      recordFailure(errorCode(error), errorMessage(error), 'LOCAL_DATABASE_UNAVAILABLE')
      return { decision: 'LOCAL_DATABASE_UNAVAILABLE', blockers: ['local_database_unavailable'], retry_after_ms: settings.pollIntervalMs }
    }
    if (!local || local.authority_epoch === null) {
      setGate(false, 'AUTHORITY_NOT_COMMISSIONED')
      return { decision: 'AUTHORITY_NOT_COMMISSIONED', blockers: ['authority_not_commissioned'] }
    }
    if (!witness) {
      setGate(false, 'WITNESS_NOT_CONFIGURED')
      return { decision: 'WITNESS_UNREACHABLE', blockers: ['witness_not_configured'] }
    }

    let observed: WitnessSnapshot
    try {
      observed = await witness.state()
      witnessSnapshot = observed
    } catch (error) {
      setGate(false, 'WITNESS_UNREACHABLE')
      recordFailure(errorCode(error), errorMessage(error), 'WITNESS_UNREACHABLE')
      return { decision: 'WITNESS_UNREACHABLE', blockers: ['witness_unreachable'], retry_after_ms: settings.pollIntervalMs }
    }

    // A standby whose database is already writable but whose gate is closed is
    // either mid-promotion or misconfigured. Finish a promotion whose epoch bump
    // did not complete; never open the gate on a different epoch.
    if (position.in_recovery === false) {
      const usable = await promotedDurabilityUsable()
      if (observed.holder_id === settings.instanceId && observed.epoch === local.authority_epoch) {
        if (!usable) {
          setGate(false, 'DURABILITY_NOT_USABLE')
          recordFailure('FAILOVER_DURABILITY_BLOCKED', 'This promoted host has synchronous commits configured without a caught-up standby, so trading would hang. Restore single_host durability or re-enrol a standby.', 'ALREADY_PRIMARY')
          return { decision: 'ALREADY_PRIMARY', blockers: ['durability_not_usable'] }
        }
        setGate(true, null)
        recordSuccess('ALREADY_PRIMARY')
        return { decision: 'ALREADY_PRIMARY', blockers: [] }
      }
      if (observed.holder_id === settings.instanceId && observed.epoch === local.authority_epoch + 1) {
        try {
          await promoteEpoch(observed.epoch, {
            witness_epoch: observed.epoch,
            previous_authority_epoch: local.authority_epoch,
            retry: true,
            promoted_at: now().toISOString()
          })
        } catch (error) {
          setGate(false, 'PROMOTION_EPOCH_FAILED')
          recordFailure(errorCode(error), errorMessage(error), 'PROMOTION_EPOCH_FAILED')
          return { decision: 'PROMOTION_EPOCH_FAILED', blockers: ['epoch_bump_failed'] }
        }
        if (!usable) {
          setGate(false, 'DURABILITY_NOT_USABLE')
          recordFailure('FAILOVER_DURABILITY_BLOCKED', 'The interrupted promotion completed its epoch bump but synchronous commits have no caught-up standby.', 'PROMOTED')
          return { decision: 'PROMOTED', blockers: ['durability_not_usable'] }
        }
        setGate(true, null)
        recordSuccess('PROMOTED')
        return { decision: 'PROMOTED', blockers: [] }
      }
      setGate(false, 'STANDBY_DATABASE_WRITABLE')
      return { decision: 'ROLE_MISMATCH', blockers: ['database_not_in_recovery'] }
    }

    if (observed.leased && observed.holder_id !== null && observed.holder_id !== settings.instanceId) {
      setGate(false, 'PRIMARY_ACTIVE')
      recordSuccess('WAITING_FOR_PRIMARY')
      return { decision: 'WAITING_FOR_PRIMARY', blockers: [] }
    }

    const blockers = await standbyBlockers(local, observed, position)
    if (blockers.length > 0) {
      lastBlockers = blockers
      setGate(false, 'WAITING_FOR_CATCHUP')
      recordSuccess('WAITING_FOR_CATCHUP')
      return { decision: 'WAITING_FOR_CATCHUP', blockers, retry_after_ms: settings.pollIntervalMs }
    }

    let grant: WitnessLeaseGrant
    try {
      grant = await witness.acquire({
        holderId: settings.instanceId as string,
        role: 'primary',
        expectedEpoch: observed.epoch,
        ttlMs: settings.leaseTtlMs,
        lsn: position.lsn,
        durability: observed.holder_durability ?? 'single_host',
        authorityUrl: settings.authorityUrl
      })
    } catch (error) {
      if (error instanceof WitnessError && error.code === 'WITNESS_LEASE_HELD') {
        setGate(false, 'PRIMARY_ACTIVE')
        recordSuccess('WAITING_FOR_PRIMARY')
        return { decision: 'WAITING_FOR_PRIMARY', blockers: [] }
      }
      setGate(false, 'WAITING_FOR_LEASE')
      recordFailure(errorCode(error), errorMessage(error), 'WAITING_FOR_LEASE')
      return { decision: 'WAITING_FOR_LEASE', blockers: ['lease_not_granted'], retry_after_ms: settings.pollIntervalMs }
    }
    leaseEpoch = grant.epoch
    leaseDeadlineMono = deadlineFrom(grant)

    if (grant.epoch !== local.authority_epoch + 1) {
      await fenceDatabase('PROMOTION_EPOCH_GAP')
      await releaseLease()
      recordFailure('FAILOVER_EPOCH_GAP', 'The witness epoch does not advance this standby by exactly one; refusing to promote.', 'PROMOTION_REFUSED')
      return { decision: 'PROMOTION_REFUSED', blockers: ['epoch_gap'] }
    }

    setGate(false, 'PROMOTION_IN_PROGRESS')
    let promotion: { downgraded: boolean; detail: string | null }
    try {
      promotion = await promoteLocalCluster()
    } catch (error) {
      await releaseLease()
      recordFailure(errorCode(error), errorMessage(error), 'PROMOTION_FAILED')
      return { decision: 'PROMOTION_FAILED', blockers: ['promotion_failed'] }
    }

    try {
      await promoteEpoch(grant.epoch, {
        witness_epoch: grant.epoch,
        witness_cluster: settings.clusterId,
        previous_authority_epoch: local.authority_epoch,
        replay_lsn: position.lsn,
        primary_lsn: observed.holder_lsn,
        durability_downgraded: promotion.downgraded,
        durability_detail: promotion.detail,
        promoted_at: now().toISOString()
      })
    } catch (error) {
      // PostgreSQL is already promoted. Keep the gate closed and keep the lease
      // so the next cycle can retry the epoch bump without another host
      // stealing the authority.
      setGate(false, 'PROMOTION_EPOCH_FAILED')
      recordFailure(errorCode(error), errorMessage(error), 'PROMOTION_EPOCH_FAILED')
      return { decision: 'PROMOTION_EPOCH_FAILED', blockers: ['epoch_bump_failed'], retry_after_ms: 1000 }
    }

    if (!promotion.downgraded) {
      setGate(false, 'DURABILITY_DOWNGRADE_FAILED')
      recordFailure('FAILOVER_DURABILITY_DOWNGRADE_FAILED', promotion.detail ?? 'Durability could not be downgraded after promotion.', 'PROMOTED')
      return { decision: 'PROMOTED', blockers: ['durability_downgrade_failed'] }
    }

    setGate(true, null)
    recordSuccess('PROMOTED')
    return { decision: 'PROMOTED', blockers: [] }
  }

  async function cycle(): Promise<FailoverDecision> {
    if (settings.mode === 'disabled') {
      setGate(true, null)
      recordSuccess('DISABLED')
      return { decision: 'DISABLED', blockers: [] }
    }
    try {
      return settings.role === 'standby' ? await standbyCycle() : await primaryCycle()
    } catch (error) {
      // Any unexpected error closes the gate. Never leave writes enabled after
      // a failover decision could not be completed.
      setGate(false, 'FAILOVER_CHECK_FAILED')
      recordFailure(errorCode(error), errorMessage(error), 'WITNESS_UNREACHABLE')
      return { decision: 'WITNESS_UNREACHABLE', blockers: ['failover_check_failed'], retry_after_ms: settings.pollIntervalMs }
    }
  }

  function runCycle(): Promise<FailoverDecision> {
    if (inFlight) return inFlight
    inFlight = cycle().finally(() => { inFlight = null })
    return inFlight
  }

  function nextDelayFor(decision: FailoverDecision): number {
    if (decision.retry_after_ms !== undefined) return decision.retry_after_ms
    if (decision.decision === 'HEALTHY_PRIMARY' || decision.decision === 'PROMOTED' || decision.decision === 'ALREADY_PRIMARY') {
      return settings.role === 'standby' ? settings.pollIntervalMs : settings.renewIntervalMs
    }
    return settings.pollIntervalMs
  }

  function scheduleNext(delayMs: number): void {
    if (stopped) return
    if (timer) clearTimeout(timer)
    const delay = Math.max(250, delayMs)
    timer = setTimeout(() => {
      timer = null
      void runCycle()
        .then((decision) => {
          lastDecision = decision.decision
          lastBlockers = decision.blockers
          scheduleNext(nextDelayFor(decision))
        })
        .catch(() => scheduleNext(settings.pollIntervalMs))
    }, delay)
    if (typeof timer.unref === 'function') timer.unref()
  }

  async function status(): Promise<FailoverStatus> {
    let local: LocalAuthorityState | null = null
    try {
      local = await readLocal()
    } catch {
      local = null
    }
    let observed: WitnessSnapshot | null = witnessSnapshot
    if (witness) {
      try {
        observed = await witness.state()
        witnessSnapshot = observed
      } catch {
        // Keep the last observed snapshot; the status is explicit about errors.
      }
    }
    const remaining = leaseDeadlineMono === null ? null : Math.max(0, Math.round(leaseDeadlineMono - monoNow()))
    const leaseHeld = observed !== null && observed.leased && observed.holder_id === settings.instanceId
    // Reachable witness evidence is not proof of safe automatic failover.
    // Production startup rejects witness mode until the missing fencing and
    // in-flight transaction guarantees are independently established.
    const verified = false
    const automaticDetail = settings.mode === 'disabled'
      ? 'Witness failover is disabled; this host is a single authority.'
      : 'Automatic failover is unavailable: witness reachability does not establish transaction fencing or safe promotion.'
    return {
      mode: settings.mode,
      role: settings.role,
      instance_id: settings.instanceId,
      cluster_id: settings.clusterId,
      witness_url: redactUrl(settings.witnessUrl),
      authority_url: settings.authorityUrl,
      gate: { open: gateOpen, reason: gateReason },
      automatic_failover: { verified, detail: automaticDetail },
      lease: {
        held: leaseHeld,
        epoch: leaseEpoch ?? observed?.epoch ?? null,
        holder_id: observed?.holder_id ?? null,
        holder_matches: observed?.holder_id === settings.instanceId,
        expires_at: isoOrNull(observed?.lease_expires_at ?? null),
        remaining_ms: remaining
      },
      witness: observed,
      local,
      durability: { downgraded: durabilityDowngraded, detail: durabilityDetail, reported: reportedDurability },
      last_success_at: lastSuccessAt,
      last_error_code: lastErrorCode,
      last_error_message: lastErrorMessage,
      last_decision: lastDecision,
      blockers: lastBlockers,
      checked_at: now().toISOString()
    }
  }

  return {
    mode: settings.mode,
    role: settings.role,
    gate,
    start(): void {
      if (started || stopped) return
      started = true
      if (settings.mode === 'disabled') {
        setGate(true, null)
        recordSuccess('DISABLED')
        return
      }
      // The gate starts closed. The first successful lease check opens it, so a
      // restart can never serve a stale authority before verification.
      setGate(false, 'FAILOVER_NOT_VERIFIED')
      scheduleNext(0)
    },
    async stop(): Promise<void> {
      stopped = true
      started = false
      if (timer) clearTimeout(timer)
      timer = null
      setGate(false, 'SERVICE_STOPPING')
      // Let any in-flight verification finish before releasing, otherwise a late
      // acquire could hold the lease after this process has stopped trading.
      if (inFlight) {
        try {
          await inFlight
        } catch {
          // Shutdown is best effort; the release below still runs.
        }
      }
      if (settings.role === 'primary') {
        // A planned shutdown should hand over promptly rather than making the
        // standby wait for the full lease TTL.
        await releaseLease()
      }
    },
    status,
    async checkNow(): Promise<FailoverDecision> {
      const decision = await runCycle()
      lastDecision = decision.decision
      lastBlockers = decision.blockers
      return decision
    },
    async fence(reason: string): Promise<FailoverStatus> {
      if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(reason)) {
        throw new Error('A stable upper-case fence reason code is required.')
      }
      await fenceDatabase(reason)
      recordFailure(reason, 'The authority was fenced by an operator or by lease loss.', 'FENCED')
      return status()
    }
  }
}
