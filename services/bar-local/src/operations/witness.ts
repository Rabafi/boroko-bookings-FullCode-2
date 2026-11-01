import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'

/**
 * Witness / arbiter for Bar automatic failover.
 *
 * The witness is deliberately small: it owns one durable, monotonically
 * increasing epoch and one time-limited lease. It never sees financial data and
 * never decides what to promote. A host may only write while it holds a live
 * lease, and a promotion always consumes a new epoch, so two hosts cannot both
 * hold the right to write for the same epoch.
 *
 * Failure policy: the witness fails closed. A missing, corrupt or unreadable
 * state file refuses to start instead of resetting the epoch to zero, because
 * a reset epoch could grant the same fencing token twice.
 */

export type WitnessRole = 'primary' | 'standby'

/** Durability the leaseholder reported when it last took or renewed the lease.
 *  A standby must not promote on top of a primary that was writing without
 *  synchronous replication, because the last acknowledged sales could be lost. */
export type WitnessDurability = 'synchronous' | 'single_host'

export type WitnessErrorCode =
  | 'WITNESS_STATE_MISSING'
  | 'WITNESS_STATE_CORRUPT'
  | 'WITNESS_STATE_CLUSTER_MISMATCH'
  | 'WITNESS_CLUSTER_MISMATCH'
  | 'WITNESS_AUTH_INVALID'
  | 'WITNESS_TIMESTAMP_INVALID'
  | 'WITNESS_REPLAY'
  | 'WITNESS_BODY_INVALID'
  | 'WITNESS_ROUTE_NOT_FOUND'
  | 'WITNESS_METHOD_INVALID'
  | 'WITNESS_LEASE_HELD'
  | 'WITNESS_LEASE_LOST'
  | 'WITNESS_EPOCH_MISMATCH'
  | 'WITNESS_UNREACHABLE'
  | 'WITNESS_PROTOCOL_INVALID'
  | 'WITNESS_REFUSED'
  | 'WITNESS_INTERNAL'

export class WitnessError extends Error {
  readonly code: WitnessErrorCode
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(code: WitnessErrorCode, message: string, options: { status?: number; details?: Record<string, unknown> } = {}) {
    super(message)
    this.name = 'WitnessError'
    this.code = code
    this.status = options.status ?? 500
    this.details = options.details ?? {}
  }
}

export interface WitnessState {
  version: 1
  cluster_id: string
  epoch: number
  holder_id: string | null
  holder_role: WitnessRole | null
  lease_expires_at: number | null
  holder_lsn: string | null
  holder_lsn_at: number | null
  holder_durability: WitnessDurability | null
  authority_url: string | null
  updated_at: number
  checksum: string
}

export interface WitnessSnapshot {
  cluster_id: string
  epoch: number
  holder_id: string | null
  holder_role: WitnessRole | null
  lease_expires_at: number | null
  leased: boolean
  holder_lsn: string | null
  holder_lsn_at: number | null
  holder_durability: WitnessDurability | null
  authority_url: string | null
  server_time: number
}

export interface WitnessLeaseGrant {
  epoch: number
  holder_id: string
  expires_at: number
  server_time: number
}

const LEASE_TTL_FLOOR_MS = 5000
const TIMESTAMP_WINDOW_MS = 120_000
const MAX_NONCE_ENTRIES = 20_000
const MAX_BODY_BYTES = 8192
const STATE_VERSION = 1

function checksumFor(state: Omit<WitnessState, 'checksum'>): string {
  const canonical = [
    state.version,
    state.cluster_id,
    state.epoch,
    state.holder_id ?? '',
    state.holder_role ?? '',
    state.lease_expires_at ?? '',
    state.holder_lsn ?? '',
    state.holder_lsn_at ?? '',
    state.holder_durability ?? '',
    state.authority_url ?? '',
    state.updated_at
  ].join('|')
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function assertSafeToken(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value) || value.length > max) {
    throw new WitnessError('WITNESS_BODY_INVALID', `${field} is not a valid witness identifier.`, { status: 400 })
  }
  return value
}

function assertRole(value: unknown): WitnessRole {
  if (value !== 'primary' && value !== 'standby') {
    throw new WitnessError('WITNESS_BODY_INVALID', 'role must be primary or standby.', { status: 400 })
  }
  return value
}

function optionalUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') {
    throw new WitnessError('WITNESS_BODY_INVALID', 'authority_url must be a string.', { status: 400 })
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new WitnessError('WITNESS_BODY_INVALID', 'authority_url is not a valid URL.', { status: 400 })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WitnessError('WITNESS_BODY_INVALID', 'authority_url must use http or https.', { status: 400 })
  }
  if (url.username || url.password) {
    throw new WitnessError('WITNESS_BODY_INVALID', 'authority_url must not embed credentials.', { status: 400 })
  }
  return url.toString()
}

function optionalLsn(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^[0-9A-Fa-f]{1,8}\/[0-9A-Fa-f]{1,8}$/.test(value)) {
    throw new WitnessError('WITNESS_BODY_INVALID', 'lsn must be a PostgreSQL LSN such as 0/1A2B3C.', { status: 400 })
  }
  return value.toUpperCase()
}

function optionalDurability(value: unknown): WitnessDurability | null {
  if (value === undefined || value === null || value === '') return null
  if (value !== 'synchronous' && value !== 'single_host') {
    throw new WitnessError('WITNESS_BODY_INVALID', 'durability must be synchronous or single_host.', { status: 400 })
  }
  return value
}

function ttl(value: unknown, maxMs: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < LEASE_TTL_FLOOR_MS || parsed > maxMs) {
    throw new WitnessError('WITNESS_BODY_INVALID', `ttl_ms must be an integer between ${LEASE_TTL_FLOOR_MS} and ${maxMs}.`, { status: 400 })
  }
  return parsed
}

export class WitnessStore {
  readonly file: string
  readonly clusterId: string
  private state: WitnessState

  private constructor(file: string, clusterId: string, state: WitnessState) {
    this.file = file
    this.clusterId = clusterId
    this.state = state
  }

  static open(file: string, clusterId: string): WitnessStore {
    const resolved = path.resolve(file)
    const backup = `${resolved}.bak`
    if (!existsSync(resolved)) {
      if (existsSync(backup)) {
        throw new WitnessError(
          'WITNESS_STATE_MISSING',
          'The witness state file is missing but a previous copy exists. Refusing to reset the epoch; restore the state file before starting the witness.',
          { details: { state_file: resolved, backup_file: backup } }
        )
      }
      const initial: Omit<WitnessState, 'checksum'> = {
        version: STATE_VERSION,
        cluster_id: clusterId,
        epoch: 0,
        holder_id: null,
        holder_role: null,
        lease_expires_at: null,
        holder_lsn: null,
        holder_lsn_at: null,
        holder_durability: null,
        authority_url: null,
        updated_at: Date.now()
      }
      const state: WitnessState = { ...initial, checksum: checksumFor(initial) }
      persist(resolved, state, null)
      return new WitnessStore(resolved, clusterId, state)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(resolved, 'utf8'))
    } catch {
      throw new WitnessError('WITNESS_STATE_CORRUPT', 'The witness state file is not valid JSON. Refusing to start; restore a verified copy.', {
        details: { state_file: resolved }
      })
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new WitnessError('WITNESS_STATE_CORRUPT', 'The witness state file is not a state object.', { details: { state_file: resolved } })
    }
    const candidate = parsed as Record<string, unknown>
    if (
      candidate.version !== STATE_VERSION
      || typeof candidate.cluster_id !== 'string'
      || typeof candidate.epoch !== 'number'
      || !Number.isInteger(candidate.epoch)
      || candidate.epoch < 0
      || typeof candidate.updated_at !== 'number'
      || typeof candidate.checksum !== 'string'
    ) {
      throw new WitnessError('WITNESS_STATE_CORRUPT', 'The witness state file is missing required fields. Refusing to start.', {
        details: { state_file: resolved }
      })
    }
    const state = candidate as unknown as WitnessState
    if (checksumFor({ ...state, checksum: undefined } as unknown as Omit<WitnessState, 'checksum'>) !== state.checksum) {
      throw new WitnessError('WITNESS_STATE_CORRUPT', 'The witness state checksum does not match. Refusing to start; restore a verified copy.', {
        details: { state_file: resolved }
      })
    }
    if (state.cluster_id !== clusterId) {
      throw new WitnessError('WITNESS_STATE_CLUSTER_MISMATCH', 'The witness state belongs to a different cluster.', {
        details: { expected: clusterId, recorded: state.cluster_id }
      })
    }
    if (state.holder_durability !== 'synchronous' && state.holder_durability !== 'single_host') {
      state.holder_durability = null
    }
    return new WitnessStore(resolved, clusterId, state)
  }

  snapshot(now: number = Date.now()): WitnessSnapshot {
    return {
      cluster_id: this.state.cluster_id,
      epoch: this.state.epoch,
      holder_id: this.state.holder_id,
      holder_role: this.state.holder_role,
      lease_expires_at: this.state.lease_expires_at,
      leased: this.state.lease_expires_at !== null && this.state.lease_expires_at > now,
      holder_lsn: this.state.holder_lsn,
      holder_lsn_at: this.state.holder_lsn_at,
      holder_durability: this.state.holder_durability,
      authority_url: this.state.authority_url,
      server_time: now
    }
  }

  acquire(input: {
    holderId: string
    role: WitnessRole
    expectedEpoch?: number | null
    ttlMs: number
    lsn?: string | null
    durability?: WitnessDurability | null
    authorityUrl?: string | null
  }, now: number = Date.now(), maxLeaseTtlMs = 120_000): WitnessLeaseGrant {
    const holderId = assertSafeToken(input.holderId, 'holder_id', 127)
    const role = assertRole(input.role)
    const ttlMs = ttl(input.ttlMs, maxLeaseTtlMs)
    const lsn = optionalLsn(input.lsn)
    const durability = optionalDurability(input.durability)
    const authorityUrl = optionalUrl(input.authorityUrl)
    const current = this.state
    const leased = current.lease_expires_at !== null && current.lease_expires_at > now

    if (current.holder_id !== null && current.holder_id !== holderId && leased) {
      throw new WitnessError('WITNESS_LEASE_HELD', 'Another host holds a live witness lease.', {
        status: 409,
        details: {
          epoch: current.epoch,
          holder_id: current.holder_id,
          lease_expires_at: current.lease_expires_at
        }
      })
    }
    if (input.expectedEpoch !== undefined && input.expectedEpoch !== null && input.expectedEpoch !== current.epoch) {
      throw new WitnessError('WITNESS_EPOCH_MISMATCH', 'The expected epoch no longer matches the witness.', {
        status: 409,
        details: { expected: input.expectedEpoch, observed: current.epoch }
      })
    }

    const sameHolder = current.holder_id === holderId
    const epoch = sameHolder ? current.epoch : current.epoch + 1
    const next: Omit<WitnessState, 'checksum'> = {
      version: STATE_VERSION,
      cluster_id: this.clusterId,
      epoch,
      holder_id: holderId,
      holder_role: role,
      lease_expires_at: now + ttlMs,
      holder_lsn: lsn ?? (sameHolder ? current.holder_lsn : null),
      holder_lsn_at: lsn !== null ? now : (sameHolder ? current.holder_lsn_at : null),
      holder_durability: durability ?? (sameHolder ? current.holder_durability : null),
      authority_url: authorityUrl ?? (sameHolder ? current.authority_url : null),
      updated_at: now
    }
    this.commit(next)
    return { epoch, holder_id: holderId, expires_at: now + ttlMs, server_time: now }
  }

  renew(input: {
    holderId: string
    epoch: number
    ttlMs: number
    lsn?: string | null
    durability?: WitnessDurability | null
    authorityUrl?: string | null
  }, now: number = Date.now(), maxLeaseTtlMs = 120_000): WitnessLeaseGrant {
    const holderId = assertSafeToken(input.holderId, 'holder_id', 127)
    const ttlMs = ttl(input.ttlMs, maxLeaseTtlMs)
    if (!Number.isInteger(input.epoch) || input.epoch <= 0) {
      throw new WitnessError('WITNESS_BODY_INVALID', 'epoch must be a positive integer.', { status: 400 })
    }
    if (this.state.holder_id !== holderId || this.state.epoch !== input.epoch) {
      throw new WitnessError('WITNESS_LEASE_LOST', 'This host no longer owns the witness lease.', {
        status: 409,
        details: {
          holder_id: this.state.holder_id,
          epoch: this.state.epoch,
          lease_expires_at: this.state.lease_expires_at
        }
      })
    }
    const lsn = optionalLsn(input.lsn)
    const durability = optionalDurability(input.durability)
    const authorityUrl = optionalUrl(input.authorityUrl)
    const next: Omit<WitnessState, 'checksum'> = {
      ...this.state,
      lease_expires_at: now + ttlMs,
      holder_lsn: lsn ?? this.state.holder_lsn,
      holder_lsn_at: lsn !== null ? now : this.state.holder_lsn_at,
      holder_durability: durability ?? this.state.holder_durability,
      authority_url: authorityUrl ?? this.state.authority_url,
      updated_at: now
    }
    this.commit(next)
    return { epoch: this.state.epoch, holder_id: holderId, expires_at: now + ttlMs, server_time: now }
  }

  release(input: { holderId: string; epoch: number }, now: number = Date.now()): WitnessSnapshot {
    const holderId = assertSafeToken(input.holderId, 'holder_id', 127)
    if (this.state.holder_id !== holderId || this.state.epoch !== input.epoch) {
      throw new WitnessError('WITNESS_LEASE_LOST', 'This host no longer owns the witness lease.', {
        status: 409,
        details: { holder_id: this.state.holder_id, epoch: this.state.epoch }
      })
    }
    const next: Omit<WitnessState, 'checksum'> = {
      ...this.state,
      lease_expires_at: now,
      updated_at: now
    }
    this.commit(next)
    return this.snapshot(now)
  }

  private commit(next: Omit<WitnessState, 'checksum'>): void {
    const state: WitnessState = { ...next, checksum: checksumFor(next) }
    persist(this.file, state, this.state)
    this.state = state
  }
}

function persist(file: string, state: WitnessState | null, previous: WitnessState | null): void {
  const directory = path.dirname(file)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (state === null) return

  const payload = `${JSON.stringify(state, null, 2)}\n`
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`
  writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o600 })
  const fd = openSync(temporary, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  if (previous !== null) {
    // A second copy lets a later start distinguish "never initialised" from
    // "the state file was deleted", which must never reset the epoch.
    writeFileSync(`${file}.bak`, `${JSON.stringify(previous, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }
  renameSync(temporary, file)
  try {
    const dirFd = openSync(directory, 'r')
    try {
      fsyncSync(dirFd)
    } finally {
      closeSync(dirFd)
    }
  } catch {
    // Directory fsync is not available on every Windows filesystem.
  }
}

export function signWitnessRequest(
  key: string,
  input: { method: string; path: string; timestamp: number; nonce: string; body: string }
): string {
  const bodyHash = createHash('sha256').update(input.body, 'utf8').digest('hex')
  const canonical = ['v1', input.method.toUpperCase(), input.path, String(input.timestamp), input.nonce, bodyHash].join('\n')
  return createHmac('sha256', key).update(canonical, 'utf8').digest('hex')
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface WitnessServerOptions {
  store: WitnessStore
  key: string
  clusterId: string
  maxLeaseTtlMs?: number
  now?: () => number
  logger?: { info?(record: Record<string, unknown>): void; error?(record: Record<string, unknown>): void } | null
}

interface HandlerResult {
  status: number
  body: Record<string, unknown>
}

export function createWitnessRequestHandler(options: WitnessServerOptions) {
  const now = options.now ?? (() => Date.now())
  const maxLeaseTtlMs = options.maxLeaseTtlMs ?? 120_000
  const nonces = new Map<string, number>()

  function pruneNonces(at: number): void {
    if (nonces.size < MAX_NONCE_ENTRIES) return
    for (const [nonce, seen] of nonces) {
      if (at - seen > TIMESTAMP_WINDOW_MS * 2) nonces.delete(nonce)
    }
    if (nonces.size >= MAX_NONCE_ENTRIES) {
      const oldest = [...nonces.entries()].sort((a, b) => a[1] - b[1]).slice(0, Math.floor(MAX_NONCE_ENTRIES / 2))
      for (const [nonce] of oldest) nonces.delete(nonce)
    }
  }

  function authenticate(req: IncomingMessage, pathname: string, body: string): void {
    const cluster = req.headers['x-bar-witness-cluster']
    const timestamp = req.headers['x-bar-witness-timestamp']
    const nonce = req.headers['x-bar-witness-nonce']
    const signature = req.headers['x-bar-witness-signature']
    if (typeof cluster !== 'string' || typeof timestamp !== 'string' || typeof nonce !== 'string' || typeof signature !== 'string') {
      throw new WitnessError('WITNESS_AUTH_INVALID', 'The witness request is not signed.', { status: 401 })
    }
    if (cluster !== options.clusterId) {
      throw new WitnessError('WITNESS_CLUSTER_MISMATCH', 'The witness request targets a different cluster.', { status: 403 })
    }
    if (!/^\d{10,16}$/.test(timestamp) || !/^[0-9a-f]{32}$/i.test(nonce)) {
      throw new WitnessError('WITNESS_AUTH_INVALID', 'The witness request signature envelope is malformed.', { status: 401 })
    }
    const observed = now()
    const sent = Number(timestamp)
    if (Math.abs(observed - sent) > TIMESTAMP_WINDOW_MS) {
      throw new WitnessError('WITNESS_TIMESTAMP_INVALID', 'The witness request timestamp is outside the accepted window.', { status: 401 })
    }
    pruneNonces(observed)
    if (nonces.has(nonce)) {
      throw new WitnessError('WITNESS_REPLAY', 'The witness request nonce was already used.', { status: 409 })
    }
    const expected = signWitnessRequest(options.key, {
      method: req.method ?? 'GET',
      path: pathname,
      timestamp: sent,
      nonce,
      body
    })
    if (!safeEqualHex(expected, signature)) {
      throw new WitnessError('WITNESS_AUTH_INVALID', 'The witness request signature is not valid.', { status: 401 })
    }
    nonces.set(nonce, observed)
  }

  return async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    readBody: () => Promise<string>
  ): Promise<boolean> {
    const pathname = url.pathname
    const known =
      (req.method === 'POST' && pathname === '/v1/witness/lease/acquire')
      || (req.method === 'POST' && pathname === '/v1/witness/lease/renew')
      || (req.method === 'POST' && pathname === '/v1/witness/lease/release')
      || (req.method === 'GET' && pathname === '/v1/witness/state')
      || (req.method === 'GET' && pathname === '/v1/witness/health')
    if (!known) return false

    let result: HandlerResult
    try {
      if (pathname === '/v1/witness/health') {
        result = { status: 200, body: { ok: true, status: 'live', cluster_id: options.clusterId, epoch: options.store.snapshot(now()).epoch } }
        send(res, result)
        return true
      }
      const body = req.method === 'GET' ? '' : await readBody()
      authenticate(req, pathname, body)
      const parsed = body === '' ? {} : parseBody(body)

      if (pathname === '/v1/witness/state') {
        result = { status: 200, body: { ok: true, state: options.store.snapshot(now()) } }
      } else if (pathname === '/v1/witness/lease/acquire') {
        const grant = options.store.acquire({
          holderId: record(parsed).holder_id as string,
          role: record(parsed).role as WitnessRole,
          expectedEpoch: parsed.expected_epoch === undefined || parsed.expected_epoch === null ? null : Number(parsed.expected_epoch),
          ttlMs: Number(parsed.ttl_ms),
          lsn: parsed.lsn as string | null | undefined,
          durability: parsed.durability as WitnessDurability | null | undefined,
          authorityUrl: parsed.authority_url as string | null | undefined
        }, now(), maxLeaseTtlMs)
        result = { status: 200, body: { ok: true, grant, state: options.store.snapshot(now()) } }
      } else if (pathname === '/v1/witness/lease/renew') {
        const grant = options.store.renew({
          holderId: record(parsed).holder_id as string,
          epoch: Number(parsed.epoch),
          ttlMs: Number(parsed.ttl_ms),
          lsn: parsed.lsn as string | null | undefined,
          durability: parsed.durability as WitnessDurability | null | undefined,
          authorityUrl: parsed.authority_url as string | null | undefined
        }, now(), maxLeaseTtlMs)
        result = { status: 200, body: { ok: true, grant, state: options.store.snapshot(now()) } }
      } else {
        const state = options.store.release({
          holderId: record(parsed).holder_id as string,
          epoch: Number(parsed.epoch)
        }, now())
        result = { status: 200, body: { ok: true, state } }
      }
    } catch (error) {
      result = errorResult(error)
    }
    send(res, result)
    return true
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WitnessError('WITNESS_BODY_INVALID', 'The witness request body must be a JSON object.', { status: 400 })
  }
  return value as Record<string, unknown>
}

function parseBody(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new WitnessError('WITNESS_BODY_INVALID', 'The witness request body is too large.', { status: 413 })
  }
  try {
    return record(JSON.parse(text))
  } catch (error) {
    if (error instanceof WitnessError) throw error
    throw new WitnessError('WITNESS_BODY_INVALID', 'The witness request body is not valid JSON.', { status: 400 })
  }
}

function errorResult(error: unknown): HandlerResult {
  if (error instanceof WitnessError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message, ...error.details } }
  }
  return { status: 500, body: { ok: false, code: 'WITNESS_INTERNAL', message: 'The witness could not complete the request.' } }
}

function send(res: ServerResponse, result: HandlerResult): void {
  const payload = JSON.stringify(result.body)
  res.writeHead(result.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  })
  res.end(payload)
}

export interface WitnessClientOptions {
  baseUrl: string
  clusterId: string
  key: string
  timeoutMs?: number
  now?: () => number
  nonce?: () => string
  request?: typeof httpRequest
}

export class WitnessClient {
  private readonly baseUrl: URL
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly nonce: () => string

  constructor(private readonly options: WitnessClientOptions) {
    this.baseUrl = new URL(options.baseUrl)
    this.timeoutMs = options.timeoutMs ?? 5000
    this.now = options.now ?? (() => Date.now())
    this.nonce = options.nonce ?? (() => randomUUID().replaceAll('-', ''))
  }

  state(): Promise<WitnessSnapshot> {
    return this.request('GET', '/v1/witness/state', null).then((body) => snapshotObject(body.state))
  }

  acquire(input: {
    holderId: string
    role: WitnessRole
    expectedEpoch?: number | null
    ttlMs: number
    lsn?: string | null
    durability?: WitnessDurability | null
    authorityUrl?: string | null
  }): Promise<WitnessLeaseGrant> {
    return this.request('POST', '/v1/witness/lease/acquire', {
      holder_id: input.holderId,
      role: input.role,
      expected_epoch: input.expectedEpoch ?? null,
      ttl_ms: input.ttlMs,
      lsn: input.lsn ?? null,
      durability: input.durability ?? null,
      authority_url: input.authorityUrl ?? null
    }).then((body) => grantObject(body.grant))
  }

  renew(input: { holderId: string; epoch: number; ttlMs: number; lsn?: string | null; durability?: WitnessDurability | null; authorityUrl?: string | null }): Promise<WitnessLeaseGrant> {
    return this.request('POST', '/v1/witness/lease/renew', {
      holder_id: input.holderId,
      epoch: input.epoch,
      ttl_ms: input.ttlMs,
      lsn: input.lsn ?? null,
      durability: input.durability ?? null,
      authority_url: input.authorityUrl ?? null
    }).then((body) => grantObject(body.grant))
  }

  release(input: { holderId: string; epoch: number }): Promise<WitnessSnapshot> {
    return this.request('POST', '/v1/witness/lease/release', {
      holder_id: input.holderId,
      epoch: input.epoch
    }).then((body) => snapshotObject(body.state))
  }

  private request(method: 'GET' | 'POST', pathname: string, bodyValue: Record<string, unknown> | null): Promise<Record<string, unknown>> {
    const body = bodyValue === null ? '' : JSON.stringify(bodyValue)
    const timestamp = this.now()
    const nonce = this.nonce()
    const signature = signWitnessRequest(this.options.key, { method, path: pathname, timestamp, nonce, body })
    const url = new URL(pathname, this.baseUrl)
    const requester = url.protocol === 'https:' ? httpsRequest : httpRequest
    return new Promise((resolve, reject) => {
      const request = requester(url, {
        method,
        timeout: this.timeoutMs,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-bar-witness-cluster': this.options.clusterId,
          'x-bar-witness-timestamp': String(timestamp),
          'x-bar-witness-nonce': nonce,
          'x-bar-witness-signature': signature
        }
      }, (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size <= 65_536) chunks.push(chunk)
        })
        response.on('end', () => {
          let parsed: Record<string, unknown>
          try {
            parsed = recordObject(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new WitnessError('WITNESS_PROTOCOL_INVALID', 'The witness returned a non-JSON response.'))
            return
          }
          const status = response.statusCode ?? 0
          if (status >= 200 && status < 300 && parsed.ok === true) {
            resolve(parsed)
            return
          }
          const code = typeof parsed.code === 'string' ? parsed.code : 'WITNESS_REFUSED'
          reject(new WitnessError(code as WitnessErrorCode, typeof parsed.message === 'string' ? parsed.message : 'The witness refused the request.', {
            status,
            details: parsed
          }))
        })
      })
      request.once('timeout', () => request.destroy(new WitnessError('WITNESS_UNREACHABLE', 'The witness request timed out.')))
      request.once('error', (error) => {
        reject(error instanceof WitnessError ? error : new WitnessError('WITNESS_UNREACHABLE', 'The witness is unreachable.'))
      })
      if (body !== '') request.write(body)
      request.end()
    })
  }
}

function recordObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WitnessError('WITNESS_PROTOCOL_INVALID', 'The witness response shape is not valid.')
  }
  return value as Record<string, unknown>
}

function snapshotObject(value: unknown): WitnessSnapshot {
  const state = recordObject(value)
  if (typeof state.epoch !== 'number' || !Number.isInteger(state.epoch) || state.epoch < 0
    || typeof state.server_time !== 'number') {
    throw new WitnessError('WITNESS_PROTOCOL_INVALID', 'The witness state is missing required fields.')
  }
  return {
    cluster_id: typeof state.cluster_id === 'string' ? state.cluster_id : '',
    epoch: state.epoch,
    holder_id: typeof state.holder_id === 'string' ? state.holder_id : null,
    holder_role: state.holder_role === 'primary' || state.holder_role === 'standby' ? state.holder_role : null,
    lease_expires_at: typeof state.lease_expires_at === 'number' ? state.lease_expires_at : null,
    leased: state.leased === true,
    holder_lsn: typeof state.holder_lsn === 'string' ? state.holder_lsn : null,
    holder_lsn_at: typeof state.holder_lsn_at === 'number' ? state.holder_lsn_at : null,
    holder_durability: state.holder_durability === 'synchronous' || state.holder_durability === 'single_host' ? state.holder_durability : null,
    authority_url: typeof state.authority_url === 'string' ? state.authority_url : null,
    server_time: state.server_time
  }
}

function grantObject(value: unknown): WitnessLeaseGrant {
  const grant = recordObject(value)
  if (typeof grant.epoch !== 'number' || !Number.isInteger(grant.epoch) || grant.epoch <= 0
    || typeof grant.expires_at !== 'number' || typeof grant.server_time !== 'number') {
    throw new WitnessError('WITNESS_PROTOCOL_INVALID', 'The witness lease grant is missing required fields.')
  }
  return {
    epoch: grant.epoch,
    holder_id: typeof grant.holder_id === 'string' ? grant.holder_id : '',
    expires_at: grant.expires_at,
    server_time: grant.server_time
  }
}
