/**
 * Durable split/transfer recovery envelope (Bar Open Tabs).
 * Client-side companion to the server idempotency contracts:
 * - split_pos_tab_evenly keyed by idempotency_key (22000 on conflict, replay on match)
 * - transfer_pos_tab_waiter keyed by p_operation_id (idempotency_conflict on mismatch, replay on match)
 *
 * Outcome vocabulary:
 * - not_sent: local validation failed before dispatch (safe to correct locally)
 * - in_flight: dispatched, not yet resolved (duplicate submission disabled)
 * - unknown: timeout/transport loss/crash/ambiguous response (replay original key only)
 * - committed: authoritative success for the exact key (archive local attempt)
 * - rejected: proven terminal server rejection, no side effects (corrected attempt gets a new key)
 * - needs_review: conflicting/inaccessible/corrupt evidence (keep record, support path)
 */

export const TAB_RECOVERY_SCHEMA_VERSION = 1

export const TAB_RECOVERY_OUTCOMES = Object.freeze({
  NOT_SENT: 'not_sent',
  IN_FLIGHT: 'in_flight',
  UNKNOWN: 'unknown',
  COMMITTED: 'committed',
  REJECTED: 'rejected',
  NEEDS_REVIEW: 'needs_review'
})

// Where a domain/IPC result came from. The classifier must never treat a
// transport-layer failure as proof about server state, and must never treat
// a bare success:false without a verified pre-mutation contract as proof
// that nothing was written.
export const TAB_RECOVERY_PROVENANCE = Object.freeze({
  LOCAL_VALIDATION: 'local-validation',
  SERVER_RPC_RESPONSE: 'server-rpc-response',
  TRANSPORT_ERROR: 'transport-error',
  IPC_TRANSPORT_ERROR: 'ipc-transport-error'
})

// Rejection codes whose server contract has been verified to return BEFORE
// any mutation, for both split_pos_tab_evenly and transfer_pos_tab_waiter:
// every `success:false` return in the deployed definitions precedes the
// operation-row insert and all tab writes (see the operation-table contract
// assertions in the recovery test suite). A code outside this set proves
// nothing about side effects, even on a first attempt.
const TERMINAL_REJECTION_CODES = new Set([
  'invalid_transfer',
  'invalid_split',
  'tab_version_required',
  'tab_version_conflict',
  'tab_not_found',
  'bar_scope_required',
  'waiter_shift_required',
  'target_waiter_shift_required',
  'operator_proof_invalid',
  'till_operator_session_expired',
  'tab_not_owned',
  'offline_split_blocked',
  'offline_transfer_blocked'
])

// Terminal even when the same key was dispatched before: a committed
// original always leaves an operation row, and both RPCs consult that row
// before validating versions, so a version conflict on replay proves the
// original did not commit. Every other code on replay stays unknown because
// a still-running original (or a rotated proof/owner) cannot be excluded.
const REPLAY_TERMINAL_CODES = new Set([
  'tab_version_conflict'
])

const REVIEW_CODES = new Set([
  'idempotency_conflict'
])

const CONFLICT_TEXT_PATTERN = /already used for different|different payload/i

function asId(value) {
  const text = String(value || '').trim()
  return text || null
}

function storage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch {}
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      return globalThis.localStorage
    } catch {}
  }
  return null
}

export function scopedRecoveryKey(kind, { tenantId = null, sourceTabId = '' } = {}) {
  const tabId = asId(sourceTabId) || 'unknown-tab'
  const tenant = asId(tenantId)
  // Scoped key first; legacy tab-only key remains readable for migration.
  if (tenant) return `hpos:pending-tab-op:${kind}:${tenant}:${tabId}`
  return `hpos:pending-tab-op:${kind}:${tabId}`
}

export function legacyRecoveryKey(kind, sourceTabId = '') {
  const tabId = asId(sourceTabId) || 'unknown-tab'
  if (kind === 'split') return `hpos:pending-split:${tabId}`
  return `hpos:pending-waiter-transfer:${tabId}`
}

export function quarantineKey(kind, sourceTabId = '') {
  const tabId = asId(sourceTabId) || 'unknown-tab'
  return `hpos:quarantine-tab-op:${kind}:${tabId}:${new Date().toISOString().replace(/[:.]/g, '-')}`
}

export function stableFingerprint(payload = {}) {
  return JSON.stringify(payload)
}

export function buildSplitPayload({ splitCount, sourceTabVersion }) {
  return {
    split_count: Number(splitCount),
    source_tab_version: Number(sourceTabVersion)
  }
}

export function buildTransferPayload({ targetWaiterId, targetShiftId, expectedTabVersion, notes }) {
  return {
    target_waiter_id: asId(targetWaiterId),
    target_shift_id: asId(targetShiftId),
    expected_tab_version: Number(expectedTabVersion),
    notes: notes ? String(notes).trim().slice(0, 1000) || null : null
  }
}

export function newRecoveryEnvelope({ kind, tenantId = null, outletId = null, sourceTabId, actorId = null, expectedVersion = null, payload = {}, operationId = null, request = null }) {
  const now = new Date().toISOString()
  return {
    schemaVersion: TAB_RECOVERY_SCHEMA_VERSION,
    operationId: asId(operationId) || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    kind,
    tenantId: asId(tenantId),
    outletId: asId(outletId),
    sourceTabId: asId(sourceTabId),
    actorId: asId(actorId),
    expectedVersion: Number.isInteger(Number(expectedVersion)) && Number(expectedVersion) > 0 ? Number(expectedVersion) : null,
    payload: { ...(payload || {}) },
    payloadFingerprint: stableFingerprint(payload || {}),
    // The exact dispatch arguments, stored verbatim at submit time. Replays
    // resubmit THIS object plus the operation key: never rebuilt from
    // current form state, tab cache, or shift listings.
    request: request && typeof request === 'object' ? { ...request } : null,
    createdAt: now,
    lastCheckedAt: null,
    outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN,
    authoritativeResult: null,
    lastCode: null
  }
}

function isEnvelope(value) {
  return Boolean(value && typeof value === 'object' && (value.operationId || value.operationKey || value.operation_id) && value.payloadFingerprint)
}

function normalizeEnvelope(raw) {
  if (!isEnvelope(raw)) return null
  return {
    schemaVersion: Number(raw.schemaVersion) || TAB_RECOVERY_SCHEMA_VERSION,
    operationId: asId(raw.operationId || raw.operationKey || raw.operation_id),
    kind: raw.kind === 'transfer' ? 'transfer' : 'split',
    tenantId: asId(raw.tenantId),
    outletId: asId(raw.outletId),
    sourceTabId: asId(raw.sourceTabId),
    actorId: asId(raw.actorId),
    expectedVersion: raw.expectedVersion ?? null,
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
    payloadFingerprint: String(raw.payloadFingerprint || ''),
    request: raw.request && typeof raw.request === 'object' ? { ...raw.request } : null,
    createdAt: raw.createdAt || null,
    lastCheckedAt: raw.lastCheckedAt || null,
    outcome: raw.outcome || TAB_RECOVERY_OUTCOMES.UNKNOWN,
    authoritativeResult: raw.authoritativeResult || null,
    lastCode: raw.lastCode || null
  }
}

export function readRecoveryEnvelope(kind, { tenantId = null, sourceTabId = '' } = {}) {
  const store = storage()
  if (!store) return { envelope: null, corrupt: false, key: null }
  const keys = [scopedRecoveryKey(kind, { tenantId, sourceTabId }), legacyRecoveryKey(kind, sourceTabId)]
  for (const key of keys) {
    let raw = null
    try {
      raw = store.getItem(key)
    } catch {
      return { envelope: null, corrupt: false, key, storageError: true }
    }
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      const envelope = normalizeEnvelope(parsed)
      if (!envelope) return { envelope: null, corrupt: true, key, raw }
      return { envelope, corrupt: false, key }
    } catch {
      return { envelope: null, corrupt: true, key, raw }
    }
  }
  return { envelope: null, corrupt: false, key: keys[0] }
}

export function writeRecoveryEnvelope(kind, envelope, { tenantId = null, sourceTabId = '' } = {}) {
  const store = storage()
  const key = scopedRecoveryKey(kind, { tenantId: envelope?.tenantId || tenantId, sourceTabId: envelope?.sourceTabId || sourceTabId })
  if (!store) return { ok: false, key, error: 'Local recovery storage is unavailable.' }
  try {
    store.setItem(key, JSON.stringify(envelope))
    return { ok: true, key }
  } catch (error) {
    const detail = error?.message || 'Local recovery storage is full or unavailable.'
    return { ok: false, key, error: `Local recovery storage failed (${detail}).` }
  }
}

export function clearRecoveryEnvelope(kind, { tenantId = null, sourceTabId = '' } = {}) {
  const store = storage()
  if (!store) return
  for (const key of [scopedRecoveryKey(kind, { tenantId, sourceTabId }), legacyRecoveryKey(kind, sourceTabId)]) {
    try {
      store.removeItem(key)
    } catch {}
  }
}

export function quarantineRecoveryRecord(kind, { sourceTabId = '', raw = null } = {}) {
  const store = storage()
  if (!store) return null
  const key = quarantineKey(kind, sourceTabId)
  try {
    store.setItem(key, typeof raw === 'string' ? raw : JSON.stringify({ quarantinedAt: new Date().toISOString(), raw }))
    return key
  } catch {
    return null
  }
}

function hasServerEvidence(result) {
  if (!result || typeof result !== 'object') return false
  return Boolean(
    result.tab || result.source_tab || result.new_tabs ||
    result.replayed === true || result.already_applied === true
  )
}

/**
 * Classify a domain/IPC result into the recovery outcome vocabulary.
 *
 * Provenance-aware rules (see A1):
 * - Thrown transport errors, timeouts, crashes, and null results are always
 *   unknown, except explicit idempotency-conflict evidence (needs_review).
 * - An explicit domain-asserted `outcome: 'unknown'` always wins: the domain
 *   is closer to the transport than this classifier.
 * - `success: true` commits ONLY with server evidence (tab/source_tab/
 *   new_tabs/replayed flag). A bare `{ success: true }` is unknown, never
 *   manufactured commitment.
 * - `success: false` with a review code (or SQLSTATE 22000 plus
 *   conflict text) is needs_review. SQLSTATE or message text alone never
 *   decides anything else.
 * - `success: false` with a verified terminal code is rejected on a FRESH
 *   key (nothing left this device under it before this synchronous
 *   pre-mutation rejection). On a PREVIOUSLY SENT key only
 *   `tab_version_conflict` stays terminal (a committed original would have
 *   replayed its stored result instead); every other replay failure is
 *   unknown because a still-running original, rotated proof, or new owner
 *   cannot be excluded.
 * - Generic `success: false` without a verified code is unknown.
 *
 * @param {object|null} result domain/IPC envelope (may carry outcome/code/provenance)
 * @param {Error|unknown} error thrown transport error, if any
 * @param {object} context `{ keyPreviouslySent: boolean }`
 */
export function classifyTabOperationOutcome(result = null, error = null, context = {}) {
  const { keyPreviouslySent = false } = context || {}
  if (error != null || result == null) {
    const message = String(error?.message || error || '')
    if (CONFLICT_TEXT_PATTERN.test(message)) {
      return { outcome: TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW, code: 'idempotency_conflict', terminal: false }
    }
    return { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN, code: null, terminal: false }
  }
  if (result.outcome === TAB_RECOVERY_OUTCOMES.UNKNOWN) {
    return { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN, code: result.code || null, terminal: false }
  }
  if (result.success === true) {
    if (!hasServerEvidence(result)) {
      return { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN, code: result.code || null, terminal: false }
    }
    return { outcome: TAB_RECOVERY_OUTCOMES.COMMITTED, code: result.code || null, terminal: true }
  }
  if (result.success === false) {
    const code = String(result.code || result.error_code || '').trim() || null
    const sqlState = String(result.sqlState || result.sqlstate || result?.error?.code || '').trim() || null
    const message = String(result.error || '')
    if ((code && REVIEW_CODES.has(code)) || (sqlState === '22000' && CONFLICT_TEXT_PATTERN.test(message))) {
      return { outcome: TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW, code: code || 'idempotency_conflict', terminal: false }
    }
    if (code && TERMINAL_REJECTION_CODES.has(code)) {
      if (!keyPreviouslySent) return { outcome: TAB_RECOVERY_OUTCOMES.REJECTED, code, terminal: true }
      if (REPLAY_TERMINAL_CODES.has(code)) return { outcome: TAB_RECOVERY_OUTCOMES.REJECTED, code, terminal: true }
      return { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN, code, terminal: false }
    }
    return { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN, code, terminal: false }
  }
  return { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN, code: null, terminal: false }
}

export function describeRecoveryEnvelope(envelope) {
  if (!envelope) return null
  const shortKey = String(envelope.operationId || '').slice(0, 8)
  if (envelope.kind === 'split') {
    return `Split ${envelope.payload?.split_count || '?'} ways (key ${shortKey}…, ${envelope.createdAt ? new Date(envelope.createdAt).toLocaleString() : 'unknown time'})`
  }
  return `Waiter transfer (key ${shortKey}…, ${envelope.createdAt ? new Date(envelope.createdAt).toLocaleString() : 'unknown time'})`
}

const OFFLINE_REUSABLE_CODES = new Set(['offline_split_blocked', 'offline_transfer_blocked'])

/**
 * Operator-facing copy for an execution result. Terminal rejections may
 * state that nothing was posted; every uncertain outcome states uncertainty
 * explicitly and never offers a corrected key.
 */
export function recoveryResultMessage(kind, classification = {}, result = null, operationId = null) {
  const noun = kind === 'split' ? 'split' : 'transfer'
  const serverError = String(result?.error || '').trim()
  const shortKey = operationId ? String(operationId).slice(0, 8) : null
  if (classification.outcome === TAB_RECOVERY_OUTCOMES.COMMITTED) return null
  if (classification.outcome === TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW) {
    return `This ${noun} key conflicts with different details (${classification.code || 'idempotency_conflict'}). Outcome not confirmed: keep this record and ask support to inspect operation ${shortKey || 'unknown'}… before posting a correction.`
  }
  if (classification.outcome === TAB_RECOVERY_OUTCOMES.REJECTED) {
    if (classification.code && OFFLINE_REUSABLE_CODES.has(classification.code)) {
      return 'The server could not be reached, so nothing was sent. Retry the original when back online.'
    }
    const prefix = serverError ? `${serverError} ` : `The server rejected this ${noun}. `
    return `${prefix}No ${noun} was posted. Correct the details and use Start corrected attempt for a new key.`
  }
  const prefix = serverError ? `${serverError} ` : `Could not confirm this ${noun}. `
  return `${prefix}Outcome not confirmed: use Check status to replay the original operation under its saved key. Do not change the details until it resolves.`
}

// ---------------------------------------------------------------------------
// Operation-oriented execution (A2). Form-based new attempts and
// journal-based replays are separate entry paths sharing one classifier.
// The component never rebuilds a replay from editable fields.
// ---------------------------------------------------------------------------

export function resolvedRecoveryKey(kind, { tenantId = null, sourceTabId = '' } = {}) {
  const tabId = asId(sourceTabId) || 'unknown-tab'
  const tenant = asId(tenantId) || 'unknown-tenant'
  return `hpos:resolved-tab-op:${kind}:${tenant}:${tabId}`
}

/**
 * Archive a terminal attempt before it is replaced or forgotten. This MOVES
 * the envelope (with outcome, server result, and code) into a bounded
 * latest-resolved slot instead of deleting it. Never call removeItem an
 * archive.
 */
export function archiveRecoveryEnvelope(kind, envelope, { tenantId = null, sourceTabId = '' } = {}) {
  const store = storage()
  const resolved = {
    ...(envelope || {}),
    resolvedAt: new Date().toISOString()
  }
  const key = resolvedRecoveryKey(kind, { tenantId: envelope?.tenantId || tenantId, sourceTabId: envelope?.sourceTabId || sourceTabId })
  if (store) {
    try {
      store.setItem(key, JSON.stringify(resolved))
    } catch {}
  }
  clearRecoveryEnvelope(kind, { tenantId: envelope?.tenantId || tenantId, sourceTabId: envelope?.sourceTabId || sourceTabId })
  return { archived: resolved, key }
}

function storageKeys() {
  const store = storage()
  if (!store) return []
  const keys = []
  try {
    const length = Number(store.length) || 0
    for (let i = 0; i < length; i++) {
      const key = store.key(i)
      if (key) keys.push(key)
    }
  } catch {
    return []
  }
  return keys
}

function kindFromKey(key) {
  if (!key.startsWith('hpos:pending-tab-op:') && !key.startsWith('hpos:pending-split:') && !key.startsWith('hpos:pending-waiter-transfer:')) {
    // Resolved archives and quarantine records are evidence, not pending work.
    return null
  }
  if (key.startsWith('hpos:pending-split:') || key.includes(':split:')) return 'split'
  if (key.startsWith('hpos:pending-waiter-transfer:') || key.includes(':transfer:')) return 'transfer'
  return null
}

/**
 * Pending-operation discovery independent of the active tab list, current
 * ownership, and editable form state. Returns normalized envelopes (plus
 * corrupt markers) for the tenant scope.
 */
export function listRecoveryEnvelopes({ tenantId = null } = {}) {
  const store = storage()
  if (!store) return { envelopes: [], storageError: true }
  const tenant = asId(tenantId)
  const envelopes = []
  for (const key of storageKeys()) {
    const kind = kindFromKey(key)
    if (!kind) continue
    let raw = null
    try {
      raw = store.getItem(key)
    } catch {
      return { envelopes, storageError: true }
    }
    if (!raw) continue
    try {
      const envelope = normalizeEnvelope(JSON.parse(raw))
      if (!envelope) {
        envelopes.push({ key, kind, corrupt: true, raw })
        continue
      }
      // Strict tenant binding: a stamped envelope from another tenant is
      // never surfaced here. Legacy unstamped envelopes stay listed so
      // their original key can still be recovered, clearly marked.
      if (envelope.tenantId && tenant && envelope.tenantId.toLowerCase() !== tenant.toLowerCase()) continue
      envelopes.push({ key, kind, corrupt: false, legacy: !envelope.tenantId, envelope })
    } catch {
      envelopes.push({ key, kind, corrupt: true, raw })
    }
  }
  return { envelopes, storageError: false }
}

const REPLAY_MANAGER_ROLES = new Set(['manager', 'admin', 'super_admin', 'owner'])

/**
 * Authorize inspection/replay of one saved operation WITHOUT granting
 * control over unrelated tabs: same tenant scope (enforced by the read),
 * plus the originating actor or a manager-role operator. The server still
 * enforces ownership, proof, version, and shift on every replay.
 */
export function defaultCanReplayOperation({ envelope, actorId = null, actorRole = null } = {}) {
  if (!envelope?.operationId) return false
  if (actorId && envelope.actorId && String(actorId).trim() === String(envelope.actorId).trim()) return true
  if (actorRole && REPLAY_MANAGER_ROLES.has(String(actorRole).trim().toLowerCase())) return true
  return false
}

function recoveryError(code, message) {
  const error = new Error(message)
  error.recoveryCode = code
  return error
}

/**
 * Rebuild dispatch arguments for envelopes predating stored `request`.
 * Current envelopes always carry `request`; this path exists only for
 * legacy migration and is never preferred over the verbatim request.
 */
export function buildReplayArgs(kind, envelope) {
  if (envelope?.request && typeof envelope.request === 'object') return { ...envelope.request }
  const tabId = envelope?.sourceTabId
  if (kind === 'split') {
    return {
      source_tab_id: tabId,
      split_count: Number(envelope?.payload?.split_count) || 2,
      target_table_names: [],
      source_tab_version: Number(envelope?.payload?.source_tab_version ?? envelope?.expectedVersion) || 1
    }
  }
  return {
    tab_id: tabId,
    target_waiter_id: envelope?.payload?.target_waiter_id || null,
    target_shift_id: envelope?.payload?.target_shift_id || null,
    expected_tab_version: Number(envelope?.payload?.expected_tab_version ?? envelope?.expectedVersion) || 1,
    notes: envelope?.payload?.notes ?? null
  }
}

// Serializes concurrent executions of the same operation key: a second
// caller awaits the first attempt's promise instead of dispatching again,
// so two concurrent replay calls yield exactly one effect.
const activeExecutions = new Map()

function withSingleExecution(key, fn) {
  const running = activeExecutions.get(key)
  if (running) return { promise: running, duplicate: true }
  const promise = (async () => {
    try {
      return await fn()
    } finally {
      if (activeExecutions.get(key) === promise) activeExecutions.delete(key)
    }
  })()
  activeExecutions.set(key, promise)
  return { promise, duplicate: false }
}

function validateReplayScope(kind, envelope, { tenantId = null, sourceTabId = '' } = {}) {
  if (!envelope) return { ok: false, code: 'no_saved_operation', message: 'There is no saved operation to replay. Submit it from the form first.' }
  if (envelope.kind !== kind) {
    return { ok: false, code: 'kind_mismatch', message: 'The saved operation is a different kind and cannot be replayed here.' }
  }
  if (sourceTabId && envelope.sourceTabId && String(envelope.sourceTabId) !== String(sourceTabId)) {
    return { ok: false, code: 'tab_mismatch', message: 'The saved operation belongs to a different tab.' }
  }
  const tenant = asId(tenantId)
  if (tenant && envelope.tenantId && envelope.tenantId.toLowerCase() !== tenant.toLowerCase()) {
    return { ok: false, code: 'tenant_mismatch', message: 'The saved operation belongs to a different business and cannot be replayed in this session.' }
  }
  return { ok: true }
}

async function finishExecution({ kind, envelope, tenantId, sourceTabId, result, error, keyPreviouslySent }) {
  const classification = classifyTabOperationOutcome(result, error, { keyPreviouslySent })
  const stored = {
    ...envelope,
    outcome: classification.outcome,
    lastCheckedAt: new Date().toISOString(),
    lastCode: classification.code || result?.code || null,
    authoritativeResult: result && typeof result === 'object' ? result : null
  }
  if (classification.outcome === TAB_RECOVERY_OUTCOMES.COMMITTED) {
    const { key } = archiveRecoveryEnvelope(kind, stored, { tenantId, sourceTabId })
    return { classification, result, envelope: stored, archivedKey: key, outcome: stored.outcome }
  }
  const persisted = writeRecoveryEnvelope(kind, stored, { tenantId, sourceTabId })
  if (!persisted.ok) {
    throw recoveryError(
      'storage_write_failed',
      `The outcome could not be recorded locally (${persisted.error || 'storage unavailable'}). Treat the operation as unknown and retry Check status before doing anything else.`
    )
  }
  return { classification, result, envelope: stored, outcome: stored.outcome }
}

/**
 * Replay the SAVED operation verbatim: same request arguments, same
 * operation key, `is_replay: true` so stale local pre-checks defer to the
 * server. Never reads editable form state, the tab cache, or shift
 * listings. A status check IS this replay: the server returns the stored
 * result for a committed key without duplicating, or executes the
 * never-received intent exactly once under its key.
 */
export async function replaySavedTabOperation({
  kind, tenantId = null, sourceTabId = '', actorId = null, actorRole = null,
  canReplay = defaultCanReplayOperation, dispatch
} = {}) {
  if (typeof dispatch !== 'function') throw recoveryError('missing_dispatch', 'No dispatch channel was provided for the replay.')
  const read = readRecoveryEnvelope(kind, { tenantId, sourceTabId })
  if (read.storageError) {
    throw recoveryError('storage_read_failed', 'Local recovery storage could not be read, so no dispatch was attempted. Free device storage and retry Check status.')
  }
  if (read.corrupt) {
    quarantineRecoveryRecord(kind, { sourceTabId, raw: read.raw })
    throw recoveryError('corrupt_record', 'A previous record is unreadable, so it was quarantined for support review. Outcome not confirmed: do not retry until support confirms whether the operation committed.')
  }
  const scope = validateReplayScope(kind, read.envelope, { tenantId, sourceTabId })
  if (!scope.ok) throw recoveryError(scope.code, scope.message)
  const envelope = read.envelope
  if (!canReplay({ envelope, actorId, actorRole })) {
    throw recoveryError('replay_forbidden', 'Only the originating operator (or a manager) can inspect or replay this saved operation.')
  }
  const args = {
    ...buildReplayArgs(kind, envelope),
    ...(kind === 'split' ? { idempotency_key: envelope.operationId } : { operation_id: envelope.operationId }),
    is_replay: true
  }
  const execKey = `${kind}:${envelope.operationId}`
  const { promise } = withSingleExecution(execKey, async () => {
    const persisted = writeRecoveryEnvelope(kind, { ...envelope, outcome: TAB_RECOVERY_OUTCOMES.IN_FLIGHT }, { tenantId, sourceTabId })
    if (!persisted.ok) {
      throw recoveryError(
        'storage_write_failed',
        `The replay could not be recorded locally (${persisted.error || 'storage unavailable'}), so it was blocked before dispatch. Free device storage and try again.`
      )
    }
    let result = null
    let error = null
    try {
      result = await dispatch(args)
    } catch (dispatchError) {
      error = dispatchError
    }
    return finishExecution({ kind, envelope, tenantId, sourceTabId, result, error, keyPreviouslySent: true })
  })
  return promise
}

/**
 * Submit a NEW attempt from explicit caller-supplied intent (form values).
 * Enforces the saved-envelope rules itself: an unresolved saved operation
 * with a different fingerprint blocks; a corrected new key requires the
 * saved operation to be a proven terminal rejection. Never mints a key
 * when blocked.
 */
export async function submitNewTabOperation({
  kind, tenantId = null, sourceTabId = '', outletId = null, actorId = null,
  expectedVersion = null, payload = {}, request = {}, corrected = false, dispatch
} = {}) {
  if (typeof dispatch !== 'function') throw recoveryError('missing_dispatch', 'No dispatch channel was provided.')
  const fingerprint = stableFingerprint(payload || {})
  const read = readRecoveryEnvelope(kind, { tenantId, sourceTabId })
  if (read.storageError) {
    throw recoveryError('storage_read_failed', 'Local recovery storage could not be read, so no dispatch was attempted. Free device storage and try again.')
  }
  if (read.corrupt) {
    quarantineRecoveryRecord(kind, { sourceTabId, raw: read.raw })
    throw recoveryError('corrupt_record', 'A previous record is unreadable, so it was quarantined for support review. Outcome not confirmed: do not retry until support confirms whether the operation committed.')
  }
  const saved = read.envelope
  if (corrected) {
    // The corrected path validates terminal rejection itself, even when a
    // visible button was conditionally hidden: unknown outcomes never mint.
    if (!saved || saved.outcome !== TAB_RECOVERY_OUTCOMES.REJECTED) {
      throw recoveryError(
        'correction_not_allowed',
        'A corrected attempt needs a proven terminal server rejection first. The saved operation is still unresolved: use Check status to replay the original.'
      )
    }
  } else if (saved && saved.payloadFingerprint !== fingerprint) {
    if (saved.outcome === TAB_RECOVERY_OUTCOMES.REJECTED) {
      throw recoveryError(
        'correction_required',
        'A previous attempt was rejected by the server. Review it, then use the corrected-attempt path to post a deliberate correction under a new key.'
      )
    }
    throw recoveryError(
      'unresolved_original',
      'A previous attempt for this tab is unresolved. Check its status or replay the original before changing the details.'
    )
  }
  let envelope
  if (corrected) {
    archiveRecoveryEnvelope(kind, saved, { tenantId, sourceTabId })
    envelope = newRecoveryEnvelope({
      kind, tenantId, outletId, sourceTabId, actorId, expectedVersion,
      payload, request, operationId: null
    })
  } else if (saved && saved.payloadFingerprint === fingerprint) {
    envelope = saved
  } else {
    envelope = newRecoveryEnvelope({
      kind, tenantId, outletId, sourceTabId, actorId, expectedVersion,
      payload, request, operationId: null
    })
  }
  const execKey = `${kind}:${envelope.operationId}`
  const { promise } = withSingleExecution(execKey, async () => {
    const persisted = writeRecoveryEnvelope(kind, { ...envelope, outcome: TAB_RECOVERY_OUTCOMES.IN_FLIGHT }, { tenantId, sourceTabId })
    if (!persisted.ok) {
      throw recoveryError(
        'storage_write_failed',
        `The attempt could not be recorded locally (${persisted.error || 'storage unavailable'}), so it was blocked before dispatch. Free device storage and try again.`
      )
    }
    const args = {
      ...(request || {}),
      ...(kind === 'split' ? { idempotency_key: envelope.operationId } : { operation_id: envelope.operationId }),
      is_replay: false
    }
    let result = null
    let error = null
    try {
      result = await dispatch(args)
    } catch (dispatchError) {
      error = dispatchError
    }
    return finishExecution({ kind, envelope, tenantId, sourceTabId, result, error, keyPreviouslySent: false })
  })
  return promise
}
