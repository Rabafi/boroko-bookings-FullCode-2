import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { canonicalJson } from '@tsa-bonno/bar-contracts'
import type { ServiceConfig } from '../config.js'
import { callFunction } from '../db.js'
import type { JsonRecord } from '../db.js'

/**
 * Durable, server-only cloud synchronisation worker.
 *
 * The local PostgreSQL authority remains the financial source of truth. This
 * worker only uploads already-committed outbox batches to a receiver and
 * records the receiver's acknowledgement. It never invents totals, never
 * rewrites local financial state, and never treats a local export as a cloud
 * acceptance.
 *
 * Design constraints:
 *   * Only `single_host` (the designated Bar server) uploads.
 *   * One uploader at a time via a PostgreSQL session advisory lock.
 *   * Bounded work per run, oldest committed batch first.
 *   * Every batch is signed with HMAC-SHA256 over
 *     `<key_id>.<batch_id>.<manifest_hash>` and sent as the exact canonical
 *     manifest text produced by PostgreSQL (numeric scale must not change).
 *   * Only a receiver `ingested` state advances the local acknowledgement.
 *   * Failures are durable and visible; nothing is silently discarded.
 */

const LOCK_NAME = 'bar_local.cloud_sync.worker'
const HMAC_ALGORITHM = 'hmac-sha256'
const RECEIVER_STATES = ['received', 'validated', 'ingested'] as const
const MAX_RESPONSE_BYTES = 64 * 1024
const INITIAL_SCHEDULE_DELAY_MS = 5_000
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000
const REQUEST_TIMEOUT_ERROR = 'CLOUD_SYNC_TIMEOUT'
const REQUEST_STOPPED_ERROR = 'CLOUD_SYNC_STOPPED'

export type CloudSyncTransport = 'disabled' | 'local_test' | 'approved'
export type CloudSyncScheduleMode = 'fifteen_minutes' | 'daily'
export type ReceiverState = (typeof RECEIVER_STATES)[number]

export interface CloudSyncLogger {
  info?(record: JsonRecord): void
  error?(record: JsonRecord): void
}

export interface CloudSyncBatch {
  batch_id: string
  business_id: string
  outlet_id: string | null
  authority_id: string | null
  authority_epoch: number | null
  from_sequence: number
  to_sequence: number
  event_count: number
  manifest_hash: string
  manifest: unknown
  manifest_text: string
  attempts?: number
  status_detail?: string
  transport_status?: string
  last_error?: string | null
}

export interface CloudSyncWorkerConfig {
  configured: boolean
  enabled: boolean
  reason?: string
  business_id?: string
  authority_id?: string
  authority_epoch?: number
  receiver_url?: string | null
  schedule_mode?: CloudSyncScheduleMode
  daily_at?: string | null
  batch_limit?: number
  signing_key_id?: string | null
}

export interface CloudSyncStatus extends JsonRecord {
  configured?: boolean
  enabled?: boolean
  pending_events?: number
  prepared_batches?: number
  failed_batches?: number
  acknowledged_watermark?: number | null
  last_check_at?: string | null
  last_success_at?: string | null
  last_error_code?: string | null
  last_error_message?: string | null
  last_final_sync_at?: string | null
  last_final_sync_state?: string | null
  next_due_at?: string | null
}

export interface CloudSyncRunResult {
  status: 'disabled' | 'not_primary' | 'not_configured' | 'busy' | 'ok' | 'failed'
  transport: CloudSyncTransport
  checked_at: string
  uploaded_batches: number
  pending_events: number | null
  last_error_code: string | null
  last_error_message: string | null
  final: boolean
  final_state: 'ingested' | 'pending' | 'failed' | 'disabled' | 'not_primary' | null
  status_detail?: CloudSyncStatus | null
}

export interface CloudSyncController {
  readonly transport: CloudSyncTransport
  start(): void
  stop(): Promise<void>
  status(): Promise<CloudSyncStatus | null>
  runNow(options?: { final?: boolean; reason?: string }): Promise<CloudSyncRunResult>
  requestFinalSync(reason: string): void
}

interface ReceiverAcknowledgement {
  ok?: boolean
  state?: string
  manifest_hash?: string
  receiver_reference?: string | null
  received_at?: string | null
  code?: string
  error?: string
  message?: string
}

interface UploadOutcome {
  ok: boolean
  state?: ReceiverState
  code?: string
  message?: string
}

export interface CloudSyncControllerOptions {
  config: ServiceConfig
  pool: Pool
  logger?: CloudSyncLogger | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
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
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.trim() !== '') return code
  }
  return 'CLOUD_SYNC_FAILED'
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message
  if (typeof error === 'string' && error.trim() !== '') return error
  return 'The cloud synchronisation run failed.'
}

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

/** Read an acknowledgement under the same deadline as the response headers. */
async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw codedError('CLOUD_SYNC_RESPONSE_TOO_LARGE', 'The cloud receiver returned an oversized acknowledgement.')
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw codedError('CLOUD_SYNC_RESPONSE_TOO_LARGE', 'The cloud receiver returned an oversized acknowledgement.')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error
    if (signal.aborted) throw signal.reason ?? error
    throw error
  } finally {
    try { reader.releaseLock() } catch { /* cancellation can leave a locked reader */ }
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function safeLogMessage(value: string): string {
  // Never allow a configured receiver URL with embedded credentials to leak
  // into the durable status or the service log.
  return value.replace(/\/\/[^/@\s]+@/g, '//***@').slice(0, 1000)
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export function nextDueAt(mode: CloudSyncScheduleMode, dailyAt: string | null, now: Date): string {
  if (mode === 'fifteen_minutes') {
    return new Date(now.getTime() + FIFTEEN_MINUTES_MS).toISOString()
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(dailyAt ?? '')
  const hours = match ? Number(match[1]) : 23
  const minutes = match ? Number(match[2]) : 30
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.toISOString()
}

/**
 * Delay before the worker's first automatic pass after service start.
 *
 * A configured authority keeps its committed `next_due_at`. Otherwise the
 * delay follows the configured schedule: a startup must not turn a
 * "once daily" choice into an upload on every restart. Manual "Sync now" and
 * the cash-up final pass remain immediate and do not depend on this delay.
 */
export function firstRunDelay(options: {
  nextDueAt: string | null
  configured: boolean
  enabled: boolean
  scheduleMode: CloudSyncScheduleMode
  dailyAt: string | null
  now: Date
}): number {
  const due = parseTimestamp(options.nextDueAt)
  if (due !== null) {
    return Math.max(INITIAL_SCHEDULE_DELAY_MS, new Date(due).getTime() - options.now.getTime())
  }
  if (options.configured && options.enabled) {
    const next = nextDueAt(options.scheduleMode, options.dailyAt, options.now)
    return Math.max(INITIAL_SCHEDULE_DELAY_MS, new Date(next).getTime() - options.now.getTime())
  }
  return FIFTEEN_MINUTES_MS
}

/**
 * Merge the transport signature fields into the exact canonical manifest text.
 * `manifestText` is produced by PostgreSQL and is not re-encoded through a
 * JavaScript object, so numeric scale (for example `12.50`) is preserved.
 */
export function buildSignedBundleText(manifestText: string, fields: Record<string, string | null>): string {
  const trimmed = manifestText.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw new Error('The prepared batch manifest is not a JSON object.')
  }
  const inner = trimmed.slice(1, -1)
  const prefix = Object.entries(fields)
    .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`)
    .join(',')
  return inner === '' ? `{${prefix}}` : `{${prefix},${inner}}`
}

function withManifestScope(batch: CloudSyncBatch): CloudSyncBatch {
  let manifest = batch.manifest
  if (typeof manifest === 'string') {
    try { manifest = JSON.parse(manifest) } catch { manifest = null }
  }
  const source = isRecord(manifest) ? manifest : {}
  return {
    ...batch,
    authority_id: stringValue(batch.authority_id) ?? stringValue(source.authority_id),
    business_id: stringValue(batch.business_id) ?? stringValue(source.business_id) ?? '',
    outlet_id: stringValue(batch.outlet_id) ?? stringValue(source.outlet_id)
  }
}

export function signManifestHash(secret: string, keyId: string, batchId: string, manifestHash: string): string {
  return createHmac('sha256', secret).update(`${keyId}.${batchId}.${manifestHash}`, 'utf8').digest('hex')
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function createCloudSyncController(options: CloudSyncControllerOptions): CloudSyncController {
  const { config, pool, logger = null } = options
  const transport = config.cloudSync.transport
  const timers = new Set<NodeJS.Timeout>()
  let timer: NodeJS.Timeout | null = null
  let finalTimer: NodeJS.Timeout | null = null
  let active: Promise<CloudSyncRunResult> | null = null
  let finalPending = false
  let stopped = false
  let started = false
  const requestControllers = new Set<AbortController>()

  function unrefTimer(value: NodeJS.Timeout): NodeJS.Timeout {
    if (typeof value.unref === 'function') value.unref()
    timers.add(value)
    return value
  }

  function clearTimer(value: NodeJS.Timeout | null): void {
    if (!value) return
    clearTimeout(value)
    timers.delete(value)
  }

  async function status(): Promise<CloudSyncStatus | null> {
    try {
      const result = await callFunction<CloudSyncStatus>(pool, 'bar_local.cloud_sync_status', [])
      return result ?? null
    } catch (error) {
      logger?.error?.({
        event: 'bar_local.cloud_sync.status_failed',
        code: errorCode(error),
        message: safeLogMessage(errorMessage(error))
      })
      return null
    }
  }

  async function recordRun(
    success: boolean,
    final: boolean,
    state: string,
    code: string | null,
    message: string | null,
    nextDue: string | null
  ): Promise<CloudSyncStatus | null> {
    try {
      return await callFunction<CloudSyncStatus>(pool, 'bar_local.cloud_sync_record_run', [
        { value: success, cast: 'boolean' },
        { value: final, cast: 'boolean' },
        { value: state, cast: 'text' },
        { value: code, cast: 'text' },
        { value: message === null ? null : safeLogMessage(message), cast: 'text' },
        { value: nextDue, cast: 'timestamptz' }
      ])
    } catch (error) {
      logger?.error?.({
        event: 'bar_local.cloud_sync.record_failed',
        code: errorCode(error),
        message: safeLogMessage(errorMessage(error))
      })
      return null
    }
  }

  async function loadWorkerConfig(): Promise<CloudSyncWorkerConfig | null> {
    try {
      return await callFunction<CloudSyncWorkerConfig>(pool, 'bar_local.cloud_sync_worker_config', [])
    } catch (error) {
      logger?.error?.({
        event: 'bar_local.cloud_sync.config_failed',
        code: errorCode(error),
        message: safeLogMessage(errorMessage(error))
      })
      return null
    }
  }

  function receiverUrlFor(worker: CloudSyncWorkerConfig): string {
    const raw = stringValue(worker.receiver_url)
    if (raw === null) throw Object.assign(new Error('No cloud receiver URL is configured.'), { code: 'CLOUD_SYNC_RECEIVER_MISSING' })
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw Object.assign(new Error('The cloud receiver URL is not a valid URL.'), { code: 'CLOUD_SYNC_RECEIVER_INVALID' })
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw Object.assign(new Error('The cloud receiver URL must use http or https.'), { code: 'CLOUD_SYNC_RECEIVER_INVALID' })
    }
    if (transport === 'local_test' && !isLoopbackHost(url.hostname)) {
      throw Object.assign(new Error('The local_test transport only permits a loopback receiver.'), { code: 'CLOUD_SYNC_RECEIVER_NOT_LOOPBACK' })
    }
    return url.toString()
  }

  async function uploadBatch(
    batch: CloudSyncBatch,
    worker: CloudSyncWorkerConfig,
    secret: string,
    keyId: string,
    receiverUrl: string
  ): Promise<UploadOutcome> {
    let batchId = ''
    let uploadedMarked = false
    const fail = async (code: string, message: string): Promise<UploadOutcome> => {
      if (uploadedMarked && batchId !== '') {
        try {
          await callFunction(pool, 'bar_local.cloud_sync_mark_failure', [
            { value: batchId, cast: 'uuid' },
            { value: code, cast: 'text' },
            { value: safeLogMessage(message), cast: 'text' }
          ])
        } catch (markError) {
          logger?.error?.({
            event: 'bar_local.cloud_sync.mark_failure_failed',
            batch_id: batchId,
            code: errorCode(markError),
            message: safeLogMessage(errorMessage(markError))
          })
        }
      }
      return { ok: false, code, message }
    }
    let manifestHash: string
    try {
      batchId = stringValue(batch.batch_id) ?? ''
      manifestHash = stringValue(batch.manifest_hash) ?? ''
      if (!batchId || !manifestHash) {
        return { ok: false, code: 'CLOUD_SYNC_BATCH_INVALID', message: 'The prepared batch is missing its identity or manifest hash.' }
      }
      if (!/^[0-9a-f]{64}$/.test(manifestHash)) {
        return { ok: false, code: 'CLOUD_SYNC_BATCH_INVALID', message: 'The prepared batch manifest hash is invalid.' }
      }
      if (typeof batch.manifest_text !== 'string' || batch.manifest_text.trim() === '') {
        return { ok: false, code: 'CLOUD_SYNC_BATCH_INVALID', message: 'The prepared batch has no canonical manifest text.' }
      }

      const linkNonce = randomUUID()
      const linkRequest = { key_id: keyId, nonce: linkNonce }
      const linkSignature = createHmac('sha256', secret).update(canonicalJson(linkRequest), 'utf8').digest('hex')
      const linkUrl = new URL('/v1/links/status', receiverUrl)
      const linkAbort = new AbortController()
      const linkTimer = setTimeout(() => linkAbort.abort(), config.cloudSync.requestTimeoutMs)
      let linkResponse: Response
      let linkText: string
      try {
        linkResponse = await fetch(linkUrl, {
          method: 'POST', redirect: 'error',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...linkRequest, signature: linkSignature }),
          signal: linkAbort.signal
        })
        linkText = await readBoundedResponse(linkResponse, linkAbort.signal)
      } catch {
        return { ok: false, code: 'CLOUD_SYNC_OWNER_LINK_UNAVAILABLE', message: 'The owner approval status could not be verified. No local Bar data was sent; retry when the receiver is reachable.' }
      } finally {
        clearTimeout(linkTimer)
      }
      let linkBody: unknown
      try { linkBody = linkText ? JSON.parse(linkText) : null } catch { linkBody = null }
      if (!linkResponse.ok || !isRecord(linkBody)) {
        return { ok: false, code: 'CLOUD_SYNC_OWNER_LINK_UNAVAILABLE', message: 'The receiver could not verify this Bar connection. No local Bar data was sent.' }
      }
      const { signature: proofSignature, ...proof } = linkBody
      const expectedProofSignature = createHmac('sha256', secret).update(canonicalJson(proof), 'utf8').digest('hex')
      const validProofSignature = typeof proofSignature === 'string'
        && /^[0-9a-f]{64}$/.test(proofSignature)
        && timingSafeEqual(Buffer.from(proofSignature, 'hex'), Buffer.from(expectedProofSignature, 'hex'))
      if (!validProofSignature || proof.key_id !== keyId || proof.nonce !== linkNonce) {
        return { ok: false, code: 'CLOUD_SYNC_OWNER_LINK_INVALID', message: 'The receiver approval could not be matched to this local Bar. No local Bar data was sent.' }
      }
      if (proof.authority_id !== batch.authority_id) return { ok: false, code: 'CLOUD_SYNC_OWNER_AUTHORITY_MISMATCH', message: 'The receiver owner link does not match this local Bar authority. No local Bar data was sent.' }
      if (proof.business_id !== batch.business_id) return { ok: false, code: 'CLOUD_SYNC_OWNER_BUSINESS_MISMATCH', message: 'The receiver owner link does not match this local Bar business. No local Bar data was sent.' }
      if (proof.outlet_id !== batch.outlet_id) return { ok: false, code: 'CLOUD_SYNC_OWNER_OUTLET_MISMATCH', message: 'The receiver owner link does not match this local Bar outlet. No local Bar data was sent.' }
      if (proof.active !== true || proof.revoked !== false) {
        return { ok: false, code: proof.revoked === true ? 'CLOUD_SYNC_OWNER_LINK_REVOKED' : 'CLOUD_SYNC_OWNER_APPROVAL_REQUIRED', message: 'The Bar owner has not approved this connection. No local Bar data was sent.' }
      }

      const signature = signManifestHash(secret, keyId, batchId, manifestHash)
      await callFunction(pool, 'bar_local.cloud_sync_mark_signed', [
        { value: batchId, cast: 'uuid' },
        { value: signature, cast: 'text' },
        { value: keyId, cast: 'text' },
        { value: HMAC_ALGORITHM, cast: 'text' }
      ])
      const uploading = await callFunction<{ status?: string }>(pool, 'bar_local.cloud_sync_mark_uploading', [
        { value: batchId, cast: 'uuid' }
      ])
      if (uploading?.status === 'acknowledged') {
        return { ok: true, state: 'ingested' }
      }
      uploadedMarked = true

      const body = buildSignedBundleText(batch.manifest_text, {
        manifest_hash: manifestHash,
        signature,
        signature_key_id: keyId,
        signature_algorithm: HMAC_ALGORITHM,
        signature_status: 'signed',
        status: 'ready',
        transport_status: 'uploading'
      })

      const controller = new AbortController()
      requestControllers.add(controller)
      let timedOut = false
      const timeout = setTimeout(() => {
        timedOut = true
        controller.abort(codedError(REQUEST_TIMEOUT_ERROR, 'The cloud receiver did not answer before the request timeout.'))
      }, config.cloudSync.requestTimeoutMs)
      let response: Response
      try {
        response = await fetch(receiverUrl, {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            'x-bar-transport-version': '1',
            'x-bar-key-id': keyId,
            'x-bar-signature': signature,
            'x-bar-manifest-hash': manifestHash,
            'x-bar-batch-id': batchId,
            'x-bar-authority-id': stringValue(batch.authority_id) ?? ''
          },
          body,
          signal: controller.signal
        })
        const text = await readBoundedResponse(response, controller.signal)
        clearTimeout(timeout)
        requestControllers.delete(controller)
        return await processResponse(response, text)
      } catch (error) {
        const code = timedOut
          ? REQUEST_TIMEOUT_ERROR
          : stopped
            ? REQUEST_STOPPED_ERROR
            : (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
                ? error.code
                : 'CLOUD_SYNC_TRANSPORT_ERROR')
        const message = timedOut
          ? 'The cloud receiver did not complete its response before the request timeout.'
          : stopped
            ? 'The cloud sync request was aborted during service shutdown; the batch remains pending for retry.'
            : errorMessage(error)
        return await fail(code, safeLogMessage(message))
      } finally {
        clearTimeout(timeout)
        requestControllers.delete(controller)
      }

      async function processResponse(response: Response, text: string): Promise<UploadOutcome> {
      let payload: ReceiverAcknowledgement | null = null
      try {
        const parsed = text === '' ? null : JSON.parse(text)
        payload = isRecord(parsed) ? (parsed as ReceiverAcknowledgement) : null
      } catch {
        payload = null
      }
      if (!response.ok) {
        return fail(
          payload?.code ?? `CLOUD_SYNC_HTTP_${response.status}`,
          payload?.message ?? payload?.error ?? `The cloud receiver refused the batch with HTTP ${response.status}.`
        )
      }
      if (payload === null) {
        return fail('CLOUD_SYNC_RESPONSE_INVALID', 'The cloud receiver did not return a JSON acknowledgement.')
      }
      if (payload.ok === false) {
        return fail(
          payload.code ?? 'CLOUD_SYNC_RECEIVER_REFUSED',
          payload.message ?? payload.error ?? 'The cloud receiver refused the batch.'
        )
      }
      if (payload.manifest_hash !== manifestHash) {
        return fail('CLOUD_SYNC_ACK_HASH_MISMATCH', 'The cloud receiver acknowledged a different manifest.')
      }
      if (typeof payload.state !== 'string' || !RECEIVER_STATES.includes(payload.state as ReceiverState)) {
        return fail('CLOUD_SYNC_ACK_INVALID', 'The cloud receiver returned an unrecognised acknowledgement state.')
      }
      const state = payload.state as ReceiverState
      const receivedAt = parseTimestamp(payload.received_at) ?? new Date().toISOString()
      await callFunction(pool, 'bar_local.cloud_sync_acknowledge', [
        { value: batchId, cast: 'uuid' },
        { value: manifestHash, cast: 'text' },
        { value: state, cast: 'text' },
        { value: stringValue(payload.receiver_reference), cast: 'text' },
        { value: receivedAt, cast: 'timestamptz' }
      ])
      return { ok: true, state }
      }
    } catch (error) {
      return fail(errorCode(error), safeLogMessage(errorMessage(error)))
    }
  }

  async function drain(
    worker: CloudSyncWorkerConfig,
    secret: string,
    keyId: string,
    receiverUrl: string
  ): Promise<{ uploaded: number; pending: number | null; failure: UploadOutcome | null; pendingState: ReceiverState | null }> {
    let uploaded = 0
    let pendingState: ReceiverState | null = null
    const limit = Math.max(1, Math.min(worker.batch_limit ?? 200, 1000))
    const maxBatches = Math.max(1, config.cloudSync.maxBatchesPerRun)

    for (let index = 0; index < maxBatches; index += 1) {
      let batch: CloudSyncBatch | null = null
      const next = await callFunction<CloudSyncBatch & { status?: string }>(pool, 'bar_local.cloud_sync_next_batch', [])
      if (next && next.status === 'batch_pending') {
        batch = next
      } else {
        const taken = await callFunction<CloudSyncBatch & { status?: string }>(pool, 'bar_local.cloud_sync_take_batch', [
          { value: limit, cast: 'integer' }
        ])
        if (!taken || taken.status !== 'batch_created') break
        batch = taken
      }
      if (!batch) break
      batch = withManifestScope(batch)
      if (!batch.authority_id || !batch.business_id || !batch.outlet_id) {
        const failure = { ok: false as const, code: 'CLOUD_SYNC_BATCH_SCOPE_MISSING', message: 'The committed batch is missing its Bar scope. No data was sent; preserve the outbox and contact support.' }
        return { uploaded, pending: null, failure, pendingState }
      }
      const outcome = await uploadBatch(batch, worker, secret, keyId, receiverUrl)
      if (!outcome.ok) {
        return { uploaded, pending: null, failure: outcome, pendingState }
      }
      if (outcome.state === 'ingested') {
        uploaded += 1
        continue
      }
      pendingState = outcome.state ?? null
      break
    }

    const current = await status()
    return { uploaded, pending: numberValue(current?.pending_events), failure: null, pendingState }
  }

  async function run(options: { final?: boolean; reason?: string }): Promise<CloudSyncRunResult> {
    const final = options.final === true
    const reason = options.reason ?? 'manual'
    const now = new Date()
    const checkedAt = now.toISOString()
    const base: CloudSyncRunResult = {
      status: 'ok',
      transport,
      checked_at: checkedAt,
      uploaded_batches: 0,
      pending_events: null,
      last_error_code: null,
      last_error_message: null,
      final,
      final_state: null,
      status_detail: null
    }

    if (transport === 'disabled') {
      const detail = await recordRun(false, final, 'disabled', 'CLOUD_SYNC_DISABLED', 'Cloud synchronisation transport is disabled on this installation.', null)
      return { ...base, status: 'disabled', final_state: 'disabled', last_error_code: 'CLOUD_SYNC_DISABLED', last_error_message: 'Cloud synchronisation transport is disabled on this installation.', status_detail: detail }
    }
    if (transport === 'approved') {
      // Reserved for a separately authorised hosted deployment. Refusing here
      // guarantees that a configuration toggle cannot start live ingestion.
      const message = 'The approved cloud transport is reserved and requires a separate hosted activation authorisation.'
      const detail = await recordRun(false, final, 'failed', 'CLOUD_SYNC_TRANSPORT_NOT_AUTHORISED', message, nextDueAt('fifteen_minutes', null, now))
      return { ...base, status: 'failed', final_state: 'failed', last_error_code: 'CLOUD_SYNC_TRANSPORT_NOT_AUTHORISED', last_error_message: message, status_detail: detail }
    }
    if (config.networkRole !== 'single_host') {
      const message = 'Only the designated single-host Bar server may upload cloud batches.'
      const detail = await recordRun(false, final, 'not_primary', 'CLOUD_SYNC_NOT_PRIMARY', message, null)
      return { ...base, status: 'not_primary', final_state: 'not_primary', last_error_code: 'CLOUD_SYNC_NOT_PRIMARY', last_error_message: message, status_detail: detail }
    }

    const worker = await loadWorkerConfig()
    if (!worker) {
      return { ...base, status: 'failed', final_state: final ? 'failed' : null, last_error_code: 'CLOUD_SYNC_CONFIG_UNREADABLE', last_error_message: 'The local cloud synchronisation configuration could not be read.', status_detail: await status() }
    }
    if (!worker.configured || !worker.enabled) {
      const message = worker.reason === 'authority_not_commissioned'
        ? 'The local Bar authority has not been commissioned.'
        : 'Cloud synchronisation is not configured or is disabled on this local authority.'
      const code = worker.reason === 'authority_not_commissioned' ? 'AUTHORITY_NOT_COMMISSIONED' : 'CLOUD_SYNC_NOT_CONFIGURED'
      const detail = await recordRun(false, final, 'disabled', code, message, null)
      return { ...base, status: 'not_configured', final_state: final ? 'disabled' : null, last_error_code: code, last_error_message: message, status_detail: detail }
    }

    const secret = config.cloudSync.secret
    if (secret === null || secret.length < 32) {
      const message = 'A cloud sync signing secret of at least 32 characters is not configured on the service.'
      const detail = await recordRun(false, final, 'failed', 'CLOUD_SYNC_SECRET_MISSING', message, nextDueAt('fifteen_minutes', null, now))
      return { ...base, status: 'failed', final_state: final ? 'failed' : null, last_error_code: 'CLOUD_SYNC_SECRET_MISSING', last_error_message: message, status_detail: detail }
    }
    const keyId = stringValue(worker.signing_key_id)
    if (keyId === null) {
      const message = 'No cloud sync signing key identifier is configured on the local authority.'
      const detail = await recordRun(false, final, 'failed', 'CLOUD_SYNC_KEY_ID_MISSING', message, nextDueAt('fifteen_minutes', null, now))
      return { ...base, status: 'failed', final_state: final ? 'failed' : null, last_error_code: 'CLOUD_SYNC_KEY_ID_MISSING', last_error_message: message, status_detail: detail }
    }
    if (config.cloudSync.keyId !== null && config.cloudSync.keyId !== keyId) {
      const message = 'The service signing key identifier does not match the local authority configuration.'
      const detail = await recordRun(false, final, 'failed', 'CLOUD_SYNC_KEY_ID_MISMATCH', message, nextDueAt('fifteen_minutes', null, now))
      return { ...base, status: 'failed', final_state: final ? 'failed' : null, last_error_code: 'CLOUD_SYNC_KEY_ID_MISMATCH', last_error_message: message, status_detail: detail }
    }

    let receiverUrl: string
    try {
      receiverUrl = receiverUrlFor(worker)
    } catch (error) {
      const code = errorCode(error)
      const detail = await recordRun(false, final, 'failed', code, errorMessage(error), nextDueAt('fifteen_minutes', null, now))
      return { ...base, status: 'failed', final_state: final ? 'failed' : null, last_error_code: code, last_error_message: safeLogMessage(errorMessage(error)), status_detail: detail }
    }

    const client: PoolClient = await pool.connect()
    let locked = false
    try {
      const lock = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [LOCK_NAME])
      locked = lock.rows[0]?.locked === true
      if (!locked) {
        return { ...base, status: 'busy', status_detail: await status() }
      }

      let outcome: Awaited<ReturnType<typeof drain>>
      try {
        outcome = await drain(worker, secret, keyId, receiverUrl)
      } catch (error) {
        outcome = {
          uploaded: 0,
          pending: null,
          failure: { ok: false, code: errorCode(error), message: safeLogMessage(errorMessage(error)) },
          pendingState: null
        }
      }

      const after = await status()
      const nextDue = nextDueAt(worker.schedule_mode ?? 'fifteen_minutes', worker.daily_at ?? null, new Date())
      const failure = outcome.failure
      const pending = failure ? numberValue(after?.pending_events) : outcome.pending
      const finalState: CloudSyncRunResult['final_state'] = failure
        ? 'failed'
        : (pending ?? 0) > 0
          ? 'pending'
          : 'ingested'
      const detail = await recordRun(
        failure === null,
        final,
        finalState,
        failure?.code ?? null,
        failure?.message ?? null,
        nextDue
      )
      const result: CloudSyncRunResult = {
        ...base,
        status: failure === null ? 'ok' : 'failed',
        uploaded_batches: outcome.uploaded,
        pending_events: pending,
        last_error_code: failure?.code ?? null,
        last_error_message: failure?.message ?? null,
        final_state: final ? finalState : null,
        status_detail: detail
      }
      logger?.info?.({
        event: 'bar_local.cloud_sync.run',
        reason,
        final,
        status: result.status,
        uploaded_batches: result.uploaded_batches,
        pending_events: result.pending_events,
        last_error_code: result.last_error_code
      })
      return result
    } finally {
      if (locked) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [LOCK_NAME])
        } catch {
          // The session closes on release; PostgreSQL releases the lock then.
        }
      }
      client.release()
    }
  }

  async function runNow(options: { final?: boolean; reason?: string } = {}): Promise<CloudSyncRunResult> {
    if (stopped) {
      return {
        status: 'disabled',
        transport,
        checked_at: new Date().toISOString(),
        uploaded_batches: 0,
        pending_events: null,
        last_error_code: 'CLOUD_SYNC_STOPPED',
        last_error_message: 'The cloud synchronisation worker is stopping.',
        final: options.final === true,
        final_state: null,
        status_detail: null
      }
    }
    if (active) {
      if (options.final === true) finalPending = true
      return active
    }
    active = run(options).finally(() => {
      active = null
      if (finalPending && !stopped) {
        finalPending = false
        void runNow({ final: true, reason: 'final_queued' })
      }
    })
    return active
  }

  function scheduleNext(delayMs?: number): void {
    if (stopped) return
    clearTimer(timer)
    const delay = delayMs ?? FIFTEEN_MINUTES_MS
    timer = unrefTimer(setTimeout(() => {
      timers.delete(timer as NodeJS.Timeout)
      timer = null
      void runNow({ reason: 'schedule' })
        .then(() => undefined)
        .catch((error) => {
          logger?.error?.({
            event: 'bar_local.cloud_sync.schedule_failed',
            code: errorCode(error),
            message: safeLogMessage(errorMessage(error))
          })
        })
        .finally(() => {
          void scheduleFromDurableState()
        })
    }, Math.max(1_000, delay)))
  }

  async function scheduleFromDurableState(): Promise<void> {
    if (stopped) return
    const current = await status()
    const due = parseTimestamp(current?.next_due_at)
    if (due === null) {
      scheduleNext()
      return
    }
    scheduleNext(Math.max(1_000, new Date(due).getTime() - Date.now()))
  }

  return {
    transport,
    start(): void {
      if (started || stopped) return
      started = true
      if (transport === 'disabled') return
      void (async () => {
        const current = await status()
        const worker = await loadWorkerConfig()
        const delay = firstRunDelay({
          nextDueAt: parseTimestamp(current?.next_due_at),
          configured: worker?.configured === true,
          enabled: worker?.enabled === true,
          scheduleMode: worker?.schedule_mode ?? 'fifteen_minutes',
          dailyAt: worker?.daily_at ?? null,
          now: new Date()
        })
        scheduleNext(delay)
      })()
    },
    async stop(): Promise<void> {
      stopped = true
      for (const controller of requestControllers) {
        controller.abort(codedError(REQUEST_STOPPED_ERROR, 'The cloud sync worker is stopping.'))
      }
      started = false
      clearTimer(timer)
      timer = null
      clearTimer(finalTimer)
      finalTimer = null
      for (const pending of timers) clearTimeout(pending)
      timers.clear()
      if (finalTimer) clearTimeout(finalTimer)
      if (active) {
        try {
          await active
        } catch {
          // Shutdown remains best effort; durable state is already recorded.
        }
      }
    },
    status,
    runNow,
    requestFinalSync(reason: string): void {
      if (stopped || transport === 'disabled') return
      if (finalTimer) return
      finalTimer = unrefTimer(setTimeout(() => {
        timers.delete(finalTimer as NodeJS.Timeout)
        finalTimer = null
        void runNow({ final: true, reason }).catch((error) => {
          logger?.error?.({
            event: 'bar_local.cloud_sync.final_failed',
            reason,
            code: errorCode(error),
            message: safeLogMessage(errorMessage(error))
          })
        })
      }, 0))
    }
  }
}
