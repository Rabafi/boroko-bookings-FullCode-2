// @ts-check

import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { BarLocalAdapterError, requireInteger, requireString, requireUuid } from './authority.js'
import { encodeJournalRecord, decodeJournalRecord, hasJournalSecret, protectExistingJournal } from '../../shared/barLocalJournalProtection.js'

export const INTENT_JOURNAL_VERSION = 1

export const INTENT_STATES = Object.freeze({
  DRAFT: 'draft',
  DURABLE_INTENT: 'durable_intent',
  SENDING: 'sending',
  OUTCOME_UNKNOWN: 'outcome_unknown',
  COMMITTED_LOCAL: 'committed_local',
  TERMINAL_REFUSAL: 'terminal_refusal',
  CANCELLED: 'cancelled'
})

/** @type {Readonly<Record<string, readonly string[]>>} */
const ALLOWED_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['durable_intent', 'cancelled']),
  durable_intent: Object.freeze(['sending', 'cancelled']),
  sending: Object.freeze(['committed_local', 'terminal_refusal', 'outcome_unknown']),
  outcome_unknown: Object.freeze(['sending', 'committed_local', 'terminal_refusal']),
  committed_local: Object.freeze([]),
  terminal_refusal: Object.freeze([]),
  cancelled: Object.freeze([])
})

const TERMINAL_STATES = new Set([INTENT_STATES.COMMITTED_LOCAL, INTENT_STATES.TERMINAL_REFUSAL, INTENT_STATES.CANCELLED])
const HASH_RE = /^[0-9a-f]{64}$/

/**
 * @typedef {Record<string, unknown>} Payload
 */

/**
 * @typedef {Object} CommandEnvelope
 * @property {number} contract_version
 * @property {string} authority_id
 * @property {number} authority_epoch
 * @property {string} business_id
 * @property {string} outlet_id
 * @property {string} device_id
 * @property {string} operation_id
 * @property {string} command
 * @property {number} payload_version
 * @property {Payload} payload
 * @property {Payload} [expected_versions]
 * @property {string[]} [dependencies]
 * @property {string|null} [client_occurred_at]
 */

/**
 * @typedef {Object} IntentRecord
 * @property {number} version
 * @property {string} operation_id
 * @property {'bar_local'} authority
 * @property {string} authority_id
 * @property {number} authority_epoch
 * @property {string} business_id
 * @property {string} outlet_id
 * @property {string} device_id
 * @property {string} command
 * @property {number} payload_version
 * @property {Payload} payload
 * @property {Payload} expected_versions
 * @property {string[]} dependencies
 * @property {string|null} client_occurred_at
 * @property {CommandEnvelope} envelope
 * @property {string} payload_hash
 * @property {string} approval_hash
 * @property {string} state
 * @property {number} revision
 * @property {number} attempt_count
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string|null} last_error_code
 * @property {Payload|null} receipt
 * @property {Payload|null} result
 * @property {Payload|null} refusal
 * @property {string} checksum
 */

/**
 * @typedef {Object} IntentJournalRecovery
 * @property {number} records_loaded
 * @property {number} torn_tail_bytes
 * @property {boolean} repaired
 */

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Canonical JSON used for hashing only. Rejects non-integer numbers, sparse
 * arrays, undefined values, cycles and non-plain objects.
 * @param {unknown} value
 * @param {string} [path]
 * @param {Set<object>} [seen]
 * @returns {string}
 */
export function canonicalJson(value, path = '$', seen = new Set()) {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', `${path} must be an integer; use a decimal string for money and quantities.`)
    }
    return String(value)
  }
  if (typeof value === 'undefined') {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `${path} is undefined.`)
  }
  if (typeof value !== 'object' || value === null) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `${path} has an unsupported type.`)
  }
  if (seen.has(value)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `${path} contains a cycle.`)
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const parts = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new BarLocalAdapterError('VALIDATION_FAILED', `${path}[${index}] is a sparse array hole.`)
        }
        parts.push(canonicalJson(value[index], `${path}[${index}]`, seen))
      }
      return `[${parts.join(',')}]`
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', `${path} must be a plain object.`)
    }
    const record = /** @type {Record<string, unknown>} */ (value)
    const names = Object.keys(record).sort()
    const parts = names.map((name) => `${JSON.stringify(name)}:${canonicalJson(record[name], `${path}.${name}`, seen)}`)
    return `{${parts.join(',')}}`
  } finally {
    seen.delete(value)
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function hashCanonical(value) {
  return sha256Hex(canonicalJson(value))
}

/**
 * @param {CommandEnvelope|Record<string, unknown>} envelope
 * @returns {string}
 */
export function payloadHashForEnvelope(envelope) {
  return hashCanonical({
    contract_version: envelope.contract_version,
    command: envelope.command,
    payload_version: envelope.payload_version,
    authority_id: envelope.authority_id,
    authority_epoch: envelope.authority_epoch,
    business_id: envelope.business_id,
    outlet_id: envelope.outlet_id,
    device_id: envelope.device_id,
    payload: envelope.payload
  })
}

/**
 * Approval hash excludes approval_id itself so a manager can approve the
 * exact action before the approval reference is attached.
 * @param {CommandEnvelope|Record<string, unknown>} envelope
 * @returns {string}
 */
export function approvalHashForEnvelope(envelope) {
  const payload = envelope.payload
  const filtered = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.fromEntries(Object.entries(/** @type {Record<string, unknown>} */ (payload)).filter(([key]) => key !== 'approval_id'))
    : payload
  return payloadHashForEnvelope({ ...envelope, payload: filtered })
}

/**
 * @param {unknown} envelope
 * @returns {CommandEnvelope}
 */
export function assertCommandEnvelope(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The command envelope must be an object.')
  }
  const record = /** @type {Record<string, unknown>} */ (envelope)
  if (record.contract_version !== INTENT_JOURNAL_VERSION) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', `contract_version must be ${INTENT_JOURNAL_VERSION}.`)
  }
  const payload = record.payload
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'The command payload must be an object.')
  }
  const expectedVersions = record.expected_versions === undefined
    ? {}
    : record.expected_versions
  if (expectedVersions === null || typeof expectedVersions !== 'object' || Array.isArray(expectedVersions)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'expected_versions must be an object.')
  }
  const dependenciesRaw = record.dependencies === undefined ? [] : record.dependencies
  if (!Array.isArray(dependenciesRaw)) {
    throw new BarLocalAdapterError('VALIDATION_FAILED', 'dependencies must be an array.')
  }
  const dependencies = dependenciesRaw.map((value, index) => requireUuid(value, `dependencies[${index}]`))
  const clientOccurredAt = record.client_occurred_at === undefined || record.client_occurred_at === null
    ? null
    : requireString(record.client_occurred_at, 'client_occurred_at', { max: 40 })
  return {
    contract_version: INTENT_JOURNAL_VERSION,
    authority_id: requireUuid(record.authority_id, 'authority_id'),
    authority_epoch: requireInteger(record.authority_epoch, 'authority_epoch', { min: 1 }),
    business_id: requireUuid(record.business_id, 'business_id'),
    outlet_id: requireUuid(record.outlet_id, 'outlet_id'),
    device_id: requireUuid(record.device_id, 'device_id'),
    operation_id: requireUuid(record.operation_id, 'operation_id'),
    command: requireString(record.command, 'command', { max: 80 }),
    payload_version: requireInteger(record.payload_version ?? INTENT_JOURNAL_VERSION, 'payload_version', { min: 1 }),
    payload: /** @type {Payload} */ (payload),
    expected_versions: /** @type {Payload} */ (expectedVersions),
    dependencies,
    client_occurred_at: clientOccurredAt
  }
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
function checksumFor(record) {
  const copy = { ...record }
  delete copy.checksum
  return hashCanonical(copy)
}

/**
 * @param {unknown} raw
 * @param {string} lineField
 * @returns {IntentRecord}
 */
function parseJournalRecord(raw, lineField) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT', `${lineField} is not a JSON object.`)
  }
  const record = /** @type {Record<string, unknown>} */ (raw)
  if (record.version !== INTENT_JOURNAL_VERSION) {
    throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT', `${lineField} has an unsupported journal version.`)
  }
  if (record.authority !== 'bar_local') {
    throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT', `${lineField} is not a bar_local intent.`)
  }
  const envelope = assertCommandEnvelope(record.envelope)
  const payloadHash = typeof record.payload_hash === 'string' ? record.payload_hash : ''
  if (!HASH_RE.test(payloadHash)) {
    throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT', `${lineField} has an invalid payload hash.`)
  }
  if (payloadHashForEnvelope(envelope) !== payloadHash) {
    throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT', `${lineField} payload hash does not match its envelope.`)
  }
  const approvalHash = typeof record.approval_hash === 'string' ? record.approval_hash : ''
  if (!HASH_RE.test(approvalHash)) {
    throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT', `${lineField} has an invalid approval hash.`)
  }
  const state = requireString(record.state, `${lineField}.state`, { max: 40 })
  if (!(state in ALLOWED_TRANSITIONS)) {
    throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT', `${lineField} has an unknown intent state.`)
  }
  const revision = requireInteger(record.revision, `${lineField}.revision`, { min: 1 })
  const attemptCount = requireInteger(record.attempt_count, `${lineField}.attempt_count`, { min: 0 })
  const checksum = typeof record.checksum === 'string' ? record.checksum : ''
  if (!HASH_RE.test(checksum) || checksumFor(record) !== checksum) {
    throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT', `${lineField} failed its integrity checksum.`)
  }
  return {
    version: INTENT_JOURNAL_VERSION,
    operation_id: envelope.operation_id,
    authority: 'bar_local',
    authority_id: envelope.authority_id,
    authority_epoch: envelope.authority_epoch,
    business_id: envelope.business_id,
    outlet_id: envelope.outlet_id,
    device_id: envelope.device_id,
    command: envelope.command,
    payload_version: envelope.payload_version,
    payload: envelope.payload,
    expected_versions: envelope.expected_versions ?? {},
    dependencies: envelope.dependencies ?? [],
    client_occurred_at: envelope.client_occurred_at ?? null,
    envelope,
    payload_hash: payloadHash,
    approval_hash: approvalHash,
    state,
    revision,
    attempt_count: attemptCount,
    created_at: requireString(record.created_at, `${lineField}.created_at`, { max: 40 }),
    updated_at: requireString(record.updated_at, `${lineField}.updated_at`, { max: 40 }),
    last_error_code: record.last_error_code === undefined || record.last_error_code === null
      ? null
      : requireString(record.last_error_code, `${lineField}.last_error_code`, { max: 80 }),
    receipt: record.receipt === undefined || record.receipt === null
      ? null
      : /** @type {Payload} */ (record.receipt),
    result: record.result === undefined || record.result === null
      ? null
      : /** @type {Payload} */ (record.result),
    refusal: record.refusal === undefined || record.refusal === null
      ? null
      : /** @type {Payload} */ (record.refusal),
    checksum
  }
}

export class IntentJournal {
  /**
   * @param {{ filePath?: string, fsync?: boolean, clock?: () => Date, protection?: {encrypt(text: string): string, decrypt(text: string): string}, storage?: import('./sqliteFrameStore.ts').IntentFrameStore }} [options]
   */
  constructor(options = {}) {
    if (options.filePath !== undefined) {
      requireString(options.filePath, 'filePath', { max: 4096 })
    }
    this.storage = options.storage ?? null
    this.filePath = this.storage?.filePath ?? options.filePath ?? null
    this.fsync = this.storage ? true : options.fsync ?? true
    this.clock = options.clock ?? (() => new Date())
    this.protection = options.protection ?? null
    /** @type {Map<string, IntentRecord>} */
    this.records = new Map()
    /** @type {IntentJournalRecovery} */
    this.recovery = { records_loaded: 0, torn_tail_bytes: 0, repaired: false }
    this.closed = false
    if (this.filePath !== null) {
      if(this.storage){
        try{this.#loadStoredFrames()}catch(error){this.closed=true;this.storage.close();throw error}
      }else this.#load()
    }
  }

  #loadStoredFrames() {
    const storage=this.storage
    if(!storage)throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT','Saved-operation storage is unavailable.')
    for(const frame of storage.read()){
      let raw
      try{raw=JSON.parse(frame.frame)}catch(cause){throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT','A saved SQLite operation frame is invalid JSON.',{cause})}
      const record=parseJournalRecord(decodeJournalRecord(raw,this.protection),'SQLite intent frame')
      if(record.operation_id!==frame.operation_id||record.revision!==frame.revision)throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT','SQLite operation metadata does not match its protected frame.')
      if(raw.protected_journal_record!==1&&hasJournalSecret(record))throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT','A SQLite operation contains an unprotected credential. Preserve the journal for repair.')
      const previous=this.records.get(record.operation_id)
      if(record.revision!==(previous?.revision??0)+1||(previous&&TERMINAL_STATES.has(previous.state)))throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT','SQLite operation history is incomplete or advances a terminal operation.')
      this.records.set(record.operation_id,record)
    }
    this.recovery.records_loaded=this.records.size
  }

  #load() {
    const filePath = /** @type {string} */ (this.filePath)
    if (!existsSync(filePath)) return
    const buffer = readFileSync(filePath)
    let start = 0
    let lastComplete = 0
    let lineNumber = 0
    let needsProtection = false
    /** @type {Record<string, unknown>[]} */
    const history = []
    while (start < buffer.length) {
      let end = buffer.indexOf(0x0a, start)
      const unterminated = end === -1
      if (unterminated) {
        // A complete final frame remains recoverable even if its newline was lost.
        try { JSON.parse(buffer.subarray(start).toString('utf8')) } catch { break }
        end = buffer.length
      }
      const line = buffer.subarray(start, end).toString('utf8')
      start = unterminated ? end : end + 1
      lastComplete = start
      lineNumber += 1
      if (line.trim() === '') continue
      let parsed
      try {
        parsed = JSON.parse(line)
      } catch {
        throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT', `The intent journal line ${lineNumber} is not valid JSON.`)
      }
      const record = parseJournalRecord(decodeJournalRecord(parsed, this.protection), `intent journal line ${lineNumber}`)
      if (parsed.protected_journal_record !== 1 && hasJournalSecret(record)) needsProtection = true
      history.push(record)
      const previous = this.records.get(record.operation_id)
      if (previous && (record.revision <= previous.revision || TERMINAL_STATES.has(previous.state))) {
        throw new BarLocalAdapterError('INTENT_JOURNAL_CORRUPT', `The intent journal line ${lineNumber} does not advance its operation.`)
      }
      this.records.set(record.operation_id, record)
      if (unterminated) {
        const fd = openSync(filePath, 'a')
        try { writeSync(fd, '\n'); if (this.fsync) fsyncSync(fd) } finally { closeSync(fd) }
        this.recovery.repaired = true
      }
    }
    if (start < buffer.length) {
      const fd = openSync(filePath, 'r+')
      try {
        ftruncateSync(fd, lastComplete)
        if (this.fsync) fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      this.recovery.torn_tail_bytes = buffer.length - lastComplete
      this.recovery.repaired = true
    }
    if (needsProtection) protectExistingJournal(filePath, history, this.protection)
    this.recovery.records_loaded = this.records.size
  }

  #assertOpen() {
    if (this.closed) {
      throw new BarLocalAdapterError('INTERNAL_ERROR', 'The intent journal is closed.')
    }
  }

  /**
   * @param {IntentRecord} record
   * @returns {IntentRecord}
   */
  #append(record) {
    this.#assertOpen()
    const withChecksum = { ...record, checksum: checksumFor(/** @type {Record<string, unknown>} */ (record)) }
    if(this.storage){
      try{
        this.storage.append({operation_id:withChecksum.operation_id,revision:withChecksum.revision,frame:encodeJournalRecord(withChecksum,this.protection)})
      }catch(cause){
        this.closed=true
        throw new BarLocalAdapterError('JOURNAL_WRITE_FAILED','Saved-operation SQLite storage failed. Trading is paused. Preserve the original journal and restart this till to recover its original operations.',{cause})
      }
    }else if (this.filePath !== null) {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const line = Buffer.from(`${encodeJournalRecord(withChecksum, this.protection)}\n`, 'utf8')
      const fd = openSync(this.filePath, 'a')
      try {
        let offset = 0
        while (offset < line.length) {
          const written = writeSync(fd, line, offset, line.length - offset, null)
          if (written <= 0) throw new BarLocalAdapterError('JOURNAL_WRITE_FAILED', 'The intent journal write made no progress. No operation was dispatched.')
          offset += written
        }
        if (this.fsync) fsyncSync(fd)
      } catch (cause) {
        // A partial frame may now exist. Do not append another frame behind it;
        // reopening validates/repairs the tail before any further dispatch.
        this.closed = true
        throw new BarLocalAdapterError('JOURNAL_WRITE_FAILED', 'Saved-operation storage failed. Trading is paused. Restore free disk space and restart this till to recover its original operations.', { cause })
      } finally {
        closeSync(fd)
      }
    }
    this.records.set(withChecksum.operation_id, withChecksum)
    return withChecksum
  }

  /**
   * Persists the original envelope before any network dispatch. Reusing the
   * same operation id with a changed payload is rejected, never re-keyed.
   * @param {CommandEnvelope} envelope
   * @returns {IntentRecord}
   */
  createIntent(envelope) {
    this.#assertOpen()
    const validated = assertCommandEnvelope(envelope)
    const payloadHash = payloadHashForEnvelope(validated)
    const existing = this.records.get(validated.operation_id)
    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        throw new BarLocalAdapterError('IDEMPOTENCY_PAYLOAD_CONFLICT', 'This operation id was already used with a different payload.', {
          operationId: validated.operation_id
        })
      }
      return existing
    }
    const now = this.clock().toISOString()
    const record = {
      version: INTENT_JOURNAL_VERSION,
      operation_id: validated.operation_id,
      authority: /** @type {'bar_local'} */ ('bar_local'),
      authority_id: validated.authority_id,
      authority_epoch: validated.authority_epoch,
      business_id: validated.business_id,
      outlet_id: validated.outlet_id,
      device_id: validated.device_id,
      command: validated.command,
      payload_version: validated.payload_version,
      payload: validated.payload,
      expected_versions: validated.expected_versions ?? {},
      dependencies: validated.dependencies ?? [],
      client_occurred_at: validated.client_occurred_at ?? null,
      envelope: validated,
      payload_hash: payloadHash,
      approval_hash: approvalHashForEnvelope(validated),
      state: INTENT_STATES.DURABLE_INTENT,
      revision: 1,
      attempt_count: 0,
      created_at: now,
      updated_at: now,
      last_error_code: null,
      receipt: null,
      result: null,
      refusal: null,
      checksum: ''
    }
    return this.#append(record)
  }

  /**
   * @param {string} operationId
   * @param {string} nextState
   * @param {{ receipt?: Payload|null, result?: Payload|null, refusal?: Payload|null, last_error_code?: string|null }} [patch]
   * @returns {IntentRecord}
   */
  transition(operationId, nextState, patch = {}) {
    this.#assertOpen()
    const id = requireUuid(operationId, 'operation_id')
    const current = this.records.get(id)
    if (!current) {
      throw new BarLocalAdapterError('OPERATION_NOT_FOUND', 'No durable intent exists for this operation id.', { operationId: id })
    }
    const allowed = ALLOWED_TRANSITIONS[current.state] ?? []
    if (!allowed.includes(nextState)) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', `An intent in state ${current.state} cannot move to ${nextState}.`, { operationId: id })
    }
    if (nextState === INTENT_STATES.COMMITTED_LOCAL) {
      if (!patch.receipt || typeof patch.receipt !== 'object') {
        throw new BarLocalAdapterError('VALIDATION_FAILED', 'A committed intent requires its authoritative receipt.', { operationId: id })
      }
      if (patch.receipt.operation_id !== id) {
        throw new BarLocalAdapterError('VALIDATION_FAILED', 'The receipt operation id does not match the durable intent.', { operationId: id })
      }
    }
    if (nextState === INTENT_STATES.TERMINAL_REFUSAL && (!patch.refusal || typeof patch.refusal !== 'object')) {
      throw new BarLocalAdapterError('VALIDATION_FAILED', 'A refused intent requires its refusal envelope.', { operationId: id })
    }
    const now = this.clock().toISOString()
    const next = {
      ...current,
      state: nextState,
      revision: current.revision + 1,
      attempt_count: nextState === INTENT_STATES.SENDING ? current.attempt_count + 1 : current.attempt_count,
      updated_at: now,
      last_error_code: patch.last_error_code === undefined ? current.last_error_code : patch.last_error_code,
      receipt: patch.receipt === undefined ? current.receipt : patch.receipt,
      result: patch.result === undefined ? current.result : patch.result,
      refusal: patch.refusal === undefined ? current.refusal : patch.refusal,
      checksum: ''
    }
    return this.#append(next)
  }

  /** @param {string} operationId */
  markSending(operationId) {
    return this.transition(operationId, INTENT_STATES.SENDING, { last_error_code: null })
  }

  /**
   * @param {string} operationId
   * @param {Payload} receipt
   * @param {Payload|null} [result]
   */
  markCommitted(operationId, receipt, result = null) {
    return this.transition(operationId, INTENT_STATES.COMMITTED_LOCAL, { receipt, result, last_error_code: null })
  }

  /**
   * @param {string} operationId
   * @param {Payload} refusal
   */
  markRefused(operationId, refusal) {
    return this.transition(operationId, INTENT_STATES.TERMINAL_REFUSAL, { refusal, last_error_code: null })
  }

  /**
   * @param {string} operationId
   * @param {string} code
   */
  markOutcomeUnknown(operationId, code) {
    return this.transition(operationId, INTENT_STATES.OUTCOME_UNKNOWN, { last_error_code: code })
  }

  /** @param {string} operationId */
  get(operationId) {
    const id = requireUuid(operationId, 'operation_id')
    return this.records.get(id) ?? null
  }

  /** @param {string} operationId */
  has(operationId) {
    return this.records.has(requireUuid(operationId, 'operation_id'))
  }

  list() {
    return Array.from(this.records.values())
  }

  get size() {
    return this.records.size
  }

  close() {
    this.closed = true
    this.storage?.close()
  }
}

/**
 * Opens (and repairs any torn tail of) the modern client intent journal.
 * @param {{ filePath?: string, fsync?: boolean, clock?: () => Date, protection?: {encrypt(text: string): string, decrypt(text: string): string} }} [options]
 * @returns {IntentJournal}
 */
export function openIntentJournal(options = {}) {
  return new IntentJournal(options)
}

/**
 * @returns {string}
 */
export function newOperationId() {
  return randomUUID()
}
