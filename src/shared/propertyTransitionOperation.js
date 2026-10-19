// @ts-check
/**
 * LodgingOS property-type transition operation lifecycle (Settings agent).
 *
 * Pure shared interface for the controlled same-product property-type change.
 * No DOM, no Electron, no network: importable from node:test and from the
 * desktop renderer. The desktop domain (`src/main/domains/propertyTransitions.js`)
 * and the Supabase RPCs remain the only submission path; this module only
 * captures, persists, rebuilds and compares the operation so every retry and
 * status check submits byte-identical payload under one stable idempotency key.
 *
 * Lifecycle rules enforced here:
 * - One operation key per operation. A second property change MUST mint a
 *   fresh UUID; reusing a key with a different payload is a server
 *   payload-hash mismatch (`idempotency_key_reuse_mismatch`).
 * - An ambiguous timeout NEVER mints a replacement key. The stored operation
 *   is preserved and retried byte-identically, or reconciled via status.
 * - Target/reason are immutable while an operation is pending
 *   (`canEditDuringPending()` is always false). Changing them requires an
 *   explicit discard of the pending operation first.
 * - Operations are scoped to (lodge, user). A stored operation from another
 *   scope is never submitted and its details are never displayed; it can only
 *   be discarded explicitly.
 *
 * Storage note: only identifiers (lodge id, user id, target type, expected
 * state, reason, key) are persisted. Never pass credentials or tokens as
 * `userId`; `buildStorageKey` never embeds them either.
 */

/** @typedef {'guest_house' | 'bnb' | 'lodge' | 'camp' | 'motel'} PropertyTransitionType */
/** @typedef {'idle' | 'pending' | 'awaiting-outcome' | 'preview-required' | 'committed'} PropertyTransitionPhase */
/** @typedef {Error & { code?: string, details?: unknown }} PropertyTransitionError */
/** @typedef {{ version: string, idempotencyKey: string, lodgeId: string, userId: string | null, targetType: string, expectedPropertyType: string, expectedUpdatedAt: unknown, reason: string, capturedAt: string | null }} CapturedPropertyTransitionOperation */
/** @typedef {{ targetType: string, expectedPropertyType: string, expectedUpdatedAt: unknown, idempotencyKey: string, reason: string }} PropertyTransitionCommitPayload */
/** @typedef {'none' | 'same-scope-pending' | 'foreign-scope'} PropertyTransitionRecoveryState */
/** @typedef {{ lodgeId: string | null, userId: string | null }} PropertyTransitionScope */

/**
 * @typedef {Object} PropertyTransitionLifecycle
 * @property {() => CapturedPropertyTransitionOperation | null} getStored
 * @property {() => PropertyTransitionPhase} getPhase
 * @property {() => PropertyTransitionScope} getScope
 * @property {() => boolean} isCommitted
 * @property {() => boolean} isRefreshFailed
 * @property {(draft?: { targetType?: unknown, expectedPropertyType?: unknown, expectedUpdatedAt?: unknown, reason?: unknown, idempotencyKey?: unknown }) => CapturedPropertyTransitionOperation} begin
 * @property {() => PropertyTransitionCommitPayload} payload
 * @property {() => string} payloadBytes
 * @property {(draft?: { targetType?: unknown, expectedPropertyType?: unknown, expectedUpdatedAt?: unknown, reason?: unknown, idempotencyKey?: unknown }) => boolean} matchesPending
 * @property {() => PropertyTransitionCommitPayload | null} markTimeout
 * @property {(commitResult: unknown) => { retired: false } | { retired: true, op: CapturedPropertyTransitionOperation | null }} markCommitSucceeded
 * @property {(statusResult: unknown) => { retired: false } | { retired: true, op: CapturedPropertyTransitionOperation | null }} markStatusFound
 * @property {() => { kept: false } | { kept: true, payload: PropertyTransitionCommitPayload }} markStatusNotFound
 * @property {() => { phase: PropertyTransitionPhase }} markStaleRejected
 * @property {(lateResult: unknown) => { retired: false, alreadyRetired: boolean } | { retired: true, op: CapturedPropertyTransitionOperation | null }} markLateSuccess
 * @property {() => { committed: boolean, refreshFailed: boolean }} markRefreshFailed
 * @property {() => { discarded: boolean, op: CapturedPropertyTransitionOperation | null }} discard
 * @property {(opOrJson: unknown) => CapturedPropertyTransitionOperation | null} restore
 * @property {(next?: { lodgeId?: unknown, userId?: unknown }) => PropertyTransitionScope} setScope
 * @property {(current?: { currentLodgeId?: unknown, currentUserId?: unknown }) => PropertyTransitionRecoveryState} describeAgainst
 */

/** Storage namespace for the pending property-transition operation. */
export const OPERATION_STORAGE_VERSION = 'bb_property_transition_pending_v1'

/** The five supported same-product LodgingOS property types. */
/** @type {ReadonlyArray<PropertyTransitionType>} */
export const SUPPORTED_PROPERTY_TRANSITION_TYPES = Object.freeze([
  'guest_house',
  'bnb',
  'lodge',
  'camp',
  'motel'
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** @param {unknown} value @returns {string} */
function cleanText(value) {
  return String(value ?? '').trim()
}

/** @param {unknown} userId @returns {string} */
function userScopeOf(userId) {
  const scope = cleanText(userId)
  return scope === '' ? 'anon' : scope
}

/** @param {string} code @param {string} message @param {unknown} [details] @returns {PropertyTransitionError} */
function transitionError(code, message, details) {
  /** The assertion records custom fields assigned immediately below; it does not change the Error or its mutations. */
  const error = /** @type {PropertyTransitionError} */ (new Error(message))
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

/** @param {unknown} idempotencyKey @returns {string} */
function assertValidKey(idempotencyKey) {
  const key = cleanText(idempotencyKey)
  if (!UUID_RE.test(key)) {
    throw transitionError(
      'property_transition_key_required',
      'A stable idempotency key (UUID) is required. Generate one UUID per operation and reuse it on every retry; never replace it after an ambiguous timeout.'
    )
  }
  return key
}

/** @param {unknown} lodgeId @returns {string} */
function assertValidLodge(lodgeId) {
  const lodge = cleanText(lodgeId)
  if (!lodge) {
    throw transitionError(
      'property_transition_no_lodge',
      'A lodge scope is required before capturing a property-type operation.'
    )
  }
  return lodge
}

/** @param {unknown} targetType @returns {PropertyTransitionType} */
function assertValidTarget(targetType) {
  const target = cleanText(targetType).toLowerCase()
  // The cast is only the Array.includes parameter type; membership below is
  // the runtime proof before this value is returned as a supported type.
  if (!SUPPORTED_PROPERTY_TRANSITION_TYPES.includes(/** @type {PropertyTransitionType} */ (target))) {
    throw transitionError(
      'cross_product_rejected',
      'Property type changes stay inside LodgingOS (guest house, B&B, lodge, camp, motel).'
    )
  }
  // The successful membership check above is the runtime proof for this return type.
  return /** @type {PropertyTransitionType} */ (target)
}

/**
 * Build the scoped localStorage key for a pending operation.
 * Never includes credentials/tokens: only the version namespace, lodge id
 * and a non-secret user scope (`userId` or `'anon'`).
 * @param {{ lodgeId?: unknown, userId?: unknown }} scope
 */
export function buildStorageKey({ lodgeId, userId } = {}) {
  const lodge = assertValidLodge(lodgeId)
  return `${OPERATION_STORAGE_VERSION}::${lodge}::${userScopeOf(userId)}`
}

/**
 * Capture one immutable property-transition operation. The returned object is
 * frozen; callers must persist it (via `serializeOperation`) BEFORE submitting.
 * Throws on missing/invalid input (UUID key required, target must be one of
 * the five LodgingOS types, lodge required).
 * @param {{ idempotencyKey?: unknown, lodgeId?: unknown, userId?: unknown, targetType?: unknown, expectedPropertyType?: unknown, expectedUpdatedAt?: unknown, reason?: unknown }} [operation]
 * @returns {CapturedPropertyTransitionOperation}
 */
export function captureOperation({
  idempotencyKey,
  lodgeId,
  userId,
  targetType,
  expectedPropertyType,
  expectedUpdatedAt,
  reason
} = {}) {
  const key = assertValidKey(idempotencyKey)
  const lodge = assertValidLodge(lodgeId)
  const target = assertValidTarget(targetType)
  const expectedType = cleanText(expectedPropertyType)
  if (!expectedType) {
    throw transitionError(
      'expected_state_required',
      'The expected current property type is required so a stale preview cannot commit against changed settings.'
    )
  }
  const user = cleanText(userId) === '' ? null : cleanText(userId)
  return Object.freeze({
    version: OPERATION_STORAGE_VERSION,
    idempotencyKey: key,
    lodgeId: lodge,
    userId: user,
    targetType: target,
    expectedPropertyType: expectedType,
    expectedUpdatedAt: expectedUpdatedAt ?? null,
    reason: cleanText(reason),
    capturedAt: new Date().toISOString()
  })
}

/**
 * Serialize an operation for scoped local persistence. The object guard is
 * the existing runtime check; this view does not validate persisted fields.
 * @param {unknown} op
 * @returns {string}
 */
export function serializeOperation(op) {
  if (!op || typeof op !== 'object') {
    throw transitionError('property_transition_invalid_operation', 'Cannot serialize a missing property-transition operation.')
  }
  // These local type views preserve the original property reads; the guard does not validate their values.
  return JSON.stringify({
    version: OPERATION_STORAGE_VERSION,
    idempotencyKey: (/** @type {Record<string, unknown>} */ (op)).idempotencyKey,
    lodgeId: (/** @type {Record<string, unknown>} */ (op)).lodgeId,
    userId: (/** @type {Record<string, unknown>} */ (op)).userId ?? null,
    targetType: (/** @type {Record<string, unknown>} */ (op)).targetType,
    expectedPropertyType: (/** @type {Record<string, unknown>} */ (op)).expectedPropertyType,
    expectedUpdatedAt: (/** @type {Record<string, unknown>} */ (op)).expectedUpdatedAt ?? null,
    reason: String((/** @type {Record<string, unknown>} */ (op)).reason ?? ''),
    capturedAt: (/** @type {Record<string, unknown>} */ (op)).capturedAt ?? null
  })
}

/**
 * Parse a stored operation. Returns the frozen operation on success, or null
 * on corrupt input / version mismatch. Never throws to the calling UI.
 * @param {unknown} json
 * @returns {CapturedPropertyTransitionOperation | null}
 */
export function parseOperation(json) {
  try {
    if (typeof json !== 'string' || json.trim() === '') return null
    const value = JSON.parse(json)
    if (!value || typeof value !== 'object') return null
    // JSON.parse remains unknown. These views only permit the existing property reads after the existing object check; field checks below remain the runtime validation.
    if ((/** @type {Record<string, unknown>} */ (value)).version !== OPERATION_STORAGE_VERSION) return null
    if (!UUID_RE.test(cleanText((/** @type {Record<string, unknown>} */ (value)).idempotencyKey))) return null
    if (!cleanText((/** @type {Record<string, unknown>} */ (value)).lodgeId)) return null
    if (!SUPPORTED_PROPERTY_TRANSITION_TYPES.includes(/** @type {PropertyTransitionType} */ (cleanText((/** @type {Record<string, unknown>} */ (value)).targetType).toLowerCase()))) return null
    if (!cleanText((/** @type {Record<string, unknown>} */ (value)).expectedPropertyType)) return null
    const user = cleanText((/** @type {Record<string, unknown>} */ (value)).userId) === '' ? null : cleanText((/** @type {Record<string, unknown>} */ (value)).userId)
    return Object.freeze({
      version: OPERATION_STORAGE_VERSION,
      idempotencyKey: cleanText((/** @type {Record<string, unknown>} */ (value)).idempotencyKey),
      lodgeId: cleanText((/** @type {Record<string, unknown>} */ (value)).lodgeId),
      userId: user,
      targetType: cleanText((/** @type {Record<string, unknown>} */ (value)).targetType).toLowerCase(),
      expectedPropertyType: cleanText((/** @type {Record<string, unknown>} */ (value)).expectedPropertyType),
      expectedUpdatedAt: (/** @type {Record<string, unknown>} */ (value)).expectedUpdatedAt ?? null,
      reason: String((/** @type {Record<string, unknown>} */ (value)).reason ?? ''),
      capturedAt: typeof (/** @type {Record<string, unknown>} */ (value)).capturedAt === 'string' ? (/** @type {Record<string, unknown>} */ (value)).capturedAt : null
    })
  } catch {
    return null
  }
}

/**
 * Build the ONLY payload ever submitted for an operation. Every retry and
 * status reconciliation uses this exact shape under the same key.
 * @param {unknown} op a captured (or parsed) operation; its fields remain unvalidated here
 * @returns {PropertyTransitionCommitPayload}
 */
export function buildCommitPayload(op) {
  if (!op || typeof op !== 'object') {
    throw transitionError('property_transition_invalid_operation', 'Cannot build a commit payload without a captured operation.')
  }
  // Type views preserve the original reads and do not validate arbitrary object fields.
  assertValidKey((/** @type {Record<string, unknown>} */ (op)).idempotencyKey)
  assertValidTarget((/** @type {Record<string, unknown>} */ (op)).targetType)
  return {
    targetType: cleanText((/** @type {Record<string, unknown>} */ (op)).targetType).toLowerCase(),
    expectedPropertyType: cleanText((/** @type {Record<string, unknown>} */ (op)).expectedPropertyType),
    expectedUpdatedAt: (/** @type {Record<string, unknown>} */ (op)).expectedUpdatedAt ?? null,
    idempotencyKey: cleanText((/** @type {Record<string, unknown>} */ (op)).idempotencyKey),
    reason: String((/** @type {Record<string, unknown>} */ (op)).reason ?? '')
  }
}

/**
 * True iff both operations describe the identical submission (key, lodge,
 * target, expected state and reason all equal). A `false` result against a
 * pending operation means the draft MUST NOT be submitted under that key.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function isSameOperation(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  // The original object guards permit arrays and do not prove field shapes; these views preserve the existing comparisons.
  const left = /** @type {Record<string, unknown>} */ (a)
  const right = /** @type {Record<string, unknown>} */ (b)
  return cleanText(left.idempotencyKey) === cleanText(right.idempotencyKey)
    && cleanText(left.lodgeId) === cleanText(right.lodgeId)
    && cleanText(left.targetType).toLowerCase() === cleanText(right.targetType).toLowerCase()
    && cleanText(left.expectedPropertyType) === cleanText(right.expectedPropertyType)
    && (left.expectedUpdatedAt ?? null) === (right.expectedUpdatedAt ?? null)
    && String(left.reason ?? '') === String(right.reason ?? '')
}

/**
 * Target/reason inputs must be blocked while a pending operation exists.
 * Always false: callers disable the inputs and require an explicit discard
 * before a different change can start. Exported for testability.
 */
export function canEditDuringPending() {
  return false
}

/**
 * Classify a stored operation against the current scope.
 * - `'none'`: nothing stored.
 * - `'same-scope-pending'`: stored scope matches; safe to check/retry.
 * - `'foreign-scope'`: different lodge or user. Never submit it and never
 *   display its target/reason; only offer an explicit discard.
 * @param {{ stored?: unknown, currentLodgeId?: unknown, currentUserId?: unknown }} [scope]
 * @returns {PropertyTransitionRecoveryState}
 */
export function describeRecoveryState({ stored, currentLodgeId, currentUserId } = {}) {
  if (!stored || typeof stored !== 'object') return 'none'
  // Existing object guard permits arbitrary values; no stored field is asserted valid by this view.
  const record = /** @type {Record<string, unknown>} */ (stored)
  if (!cleanText(record.idempotencyKey) || !cleanText(record.lodgeId)) return 'none'
  const lodgeMatches = cleanText(currentLodgeId) !== '' && cleanText(record.lodgeId) === cleanText(currentLodgeId)
  const scopeMatches = userScopeOf(record.userId) === userScopeOf(currentUserId)
  if (lodgeMatches && scopeMatches) return 'same-scope-pending'
  return 'foreign-scope'
}

/**
 * True when an authoritative completed outcome exists and the stored operation
 * must be retired: a successful commit result, or a status lookup that found
 * a stored outcome with a boolean `changed` verdict.
 * @param {{ commitResult?: unknown, statusResult?: unknown }} [results]
 * @returns {boolean}
 */
export function shouldRetireAfter({ commitResult, statusResult } = {}) {
  // These casts only permit the existing checks after object tests; results remain unvalidated RPC values.
  if (commitResult && typeof commitResult === 'object'
    && /** @type {Record<string, unknown>} */ (commitResult).success === true) {
    return true
  }
  if (statusResult && typeof statusResult === 'object') {
    const status = /** @type {Record<string, unknown>} */ (statusResult)
    const found = status.success === true || status.found === true
    if (found) {
      const data = (status.data && typeof status.data === 'object')
        ? /** @type {Record<string, unknown>} */ (status.data)
        : status
      if (data.changed === true || data.changed === false) return true
    }
  }
  return false
}

/** Short display form of an operation key (`<first-8>…`). Never the full key in headings. */
/** @param {unknown} idempotencyKey @returns {string} */
export function shortOperationKey(idempotencyKey) {
  const key = cleanText(idempotencyKey)
  if (!UUID_RE.test(key)) return 'unknown'
  return `${key.slice(0, 8)}…`
}
/**
 * Minimal transition state machine driving the pure functions above.
 * Storage-agnostic: the caller (renderer or test harness) owns persistence
 * and the RPC calls, and notifies this controller of outcomes. No DOM, no
 * network, no timers.
 *
 * Phases: `'idle'` (no operation) → `'pending'` (captured, may submit/retry)
 * → `'awaiting-outcome'` (ambiguous timeout or NOT_FOUND; exact retry only)
 * → `'preview-required'` (stale rejection; fresh preview + explicit discard
 * before any new key) → `'committed'` (authoritative outcome; retired).
 * @param {{ lodgeId?: unknown, userId?: unknown, generateKey?: (() => unknown) | null }} [scope]
 * @returns {PropertyTransitionLifecycle}
 */
export function createLifecycle({ lodgeId = null, userId = null, generateKey = null } = {}) {
  let scopeLodgeId = lodgeId == null ? null : cleanText(lodgeId) === '' ? null : cleanText(lodgeId)
  let scopeUserId = userId == null ? null : cleanText(userId)
  /** @type {CapturedPropertyTransitionOperation | null} */
  let stored = null
  /** @type {PropertyTransitionPhase} */
  let phase = 'idle'
  let committed = false
  let refreshFailed = false

  /** @type {PropertyTransitionLifecycle} */
  const controller = {
    getStored() {
      return stored
    },
    getPhase() {
      return phase
    },
    getScope() {
      return { lodgeId: scopeLodgeId, userId: scopeUserId === '' ? null : scopeUserId }
    },
    isCommitted() {
      return committed
    },
    isRefreshFailed() {
      return refreshFailed
    },
    /** Capture + hold a new operation. Throws while another is pending. */
    begin({ targetType, expectedPropertyType, expectedUpdatedAt, reason, idempotencyKey } = {}) {
      if (stored) {
        throw transitionError(
          'pending_operation_exists',
          'A property-type operation is already pending. Check its outcome or discard it explicitly before starting a different change.'
        )
      }
      const key = cleanText(idempotencyKey) !== ''
        ? cleanText(idempotencyKey)
        : (typeof generateKey === 'function' ? cleanText(generateKey()) : '')
      const op = captureOperation({
        idempotencyKey: key,
        lodgeId: scopeLodgeId,
        userId: scopeUserId === '' ? null : scopeUserId,
        targetType,
        expectedPropertyType,
        expectedUpdatedAt,
        reason
      })
      stored = op
      phase = 'pending'
      return op
    },
    /** The exact payload to submit (byte-identical on every retry). */
    payload() {
      if (!stored) {
        throw transitionError('property_transition_no_pending_operation', 'No pending property-type operation to submit.')
      }
      return buildCommitPayload(stored)
    },
    payloadBytes() {
      return JSON.stringify(controller.payload())
    },
    /**
     * True iff a draft (target/expected/reason, or a candidate key) matches
     * the pending operation. False means the draft must NOT be submitted
     * under the pending key.
     */
    matchesPending({ targetType, expectedPropertyType, expectedUpdatedAt, reason, idempotencyKey } = {}) {
      if (!stored) return false
      return isSameOperation(stored, {
        idempotencyKey: cleanText(idempotencyKey) !== '' ? cleanText(idempotencyKey) : stored.idempotencyKey,
        lodgeId: stored.lodgeId,
        targetType,
        expectedPropertyType,
        expectedUpdatedAt,
        reason: String(reason ?? '')
      })
    },
    /** Ambiguous timeout: keep the operation, move to exact-retry discipline. */
    markTimeout() {
      if (!stored) return null
      phase = 'awaiting-outcome'
      return controller.payload()
    },
    /** Successful commit outcome: retire exactly once. */
    markCommitSucceeded(commitResult) {
      if (!shouldRetireAfter({ commitResult })) return { retired: false }
      const retired = stored
      stored = null
      phase = 'committed'
      committed = true
      return { retired: true, op: retired }
    },
    /** Status lookup found the authoritative outcome: retire exactly once. */
    markStatusFound(statusResult) {
      if (!shouldRetireAfter({ statusResult })) return { retired: false }
      const retired = stored
      stored = null
      phase = 'committed'
      committed = true
      return { retired: true, op: retired }
    },
    /** Status lookup found nothing yet: keep the operation for exact retry. */
    markStatusNotFound() {
      if (!stored) return { kept: false }
      phase = 'awaiting-outcome'
      return { kept: true, payload: controller.payload() }
    },
    /** Stale-version rejection: force a fresh preview; key stays bound until discard. */
    markStaleRejected() {
      if (stored) phase = 'preview-required'
      return { phase }
    },
    /**
     * Late success arriving after a timeout UI was already shown: retire once.
     * A second call (or a racing status path) is a no-op returning
     * `{ retired: false, alreadyRetired: true }` so no duplicate submit occurs.
     */
    markLateSuccess(lateResult) {
      if (!stored) return { retired: false, alreadyRetired: true }
      if (!shouldRetireAfter({ commitResult: lateResult, statusResult: lateResult })) {
        return { retired: false, alreadyRetired: false }
      }
      const retired = stored
      stored = null
      phase = 'committed'
      committed = true
      return { retired: true, op: retired }
    },
    /** Commit succeeded but the local refresh threw: keep retired, flag warning. */
    markRefreshFailed() {
      refreshFailed = true
      return { committed, refreshFailed }
    },
    /** Explicit user-confirmed discard. Storage removal is the caller's job. */
    discard() {
      const discarded = stored
      stored = null
      phase = 'idle'
      return { discarded: Boolean(discarded), op: discarded }
    },
    /** Restore a parsed stored operation (reopen/restart recovery). */
    restore(opOrJson) {
      const op = typeof opOrJson === 'string' ? parseOperation(opOrJson) : opOrJson
      if (!op || typeof op !== 'object') return null
      try {
      // Existing object guard permits arbitrary fields; the casts only type these reads before captureOperation validates its required values.
        const normalized = captureOperation({
          idempotencyKey: /** @type {Record<string, unknown>} */ (op).idempotencyKey,
          lodgeId: /** @type {Record<string, unknown>} */ (op).lodgeId,
          userId: /** @type {Record<string, unknown>} */ (op).userId,
          targetType: /** @type {Record<string, unknown>} */ (op).targetType,
          expectedPropertyType: /** @type {Record<string, unknown>} */ (op).expectedPropertyType,
          expectedUpdatedAt: /** @type {Record<string, unknown>} */ (op).expectedUpdatedAt,
          reason: /** @type {Record<string, unknown>} */ (op).reason
        })
        stored = Object.freeze({ ...normalized, capturedAt: typeof /** @type {Record<string, unknown>} */ (op).capturedAt === 'string' ? /** @type {Record<string, unknown>} */ (op).capturedAt : normalized.capturedAt })
      } catch {
        return null
      }
      phase = 'pending'
      return stored
    },
    /** Scope switch (lodge/user change): in-memory state clears; storage keys differ. */
    setScope(next = {}) {
      if ('lodgeId' in next) scopeLodgeId = next.lodgeId == null || cleanText(next.lodgeId) === '' ? null : cleanText(next.lodgeId)
      if ('userId' in next) scopeUserId = next.userId == null ? null : cleanText(next.userId)
      stored = null
      phase = 'idle'
      return controller.getScope()
    },
    describeAgainst(current = {}) {
      return describeRecoveryState({
        stored,
        currentLodgeId: 'currentLodgeId' in current ? current.currentLodgeId : scopeLodgeId,
        currentUserId: 'currentUserId' in current ? current.currentUserId : scopeUserId
      })
    }
  }
  return controller
}

// ── Durable storage layer (production path) ─────────────────────────────
// The pure helpers above never touch storage. The functions below are the
// ONLY persistence entry points the production Settings section may use.
// They fail closed: any missing, blocked or failing storage throws a
// TransitionStorageError BEFORE any mutation is submitted, so a timeout
// followed by an app restart can never lose the original key/payload.
// No silent swallows exist on this path. Permanent deletion is not offered:
// terminal operations are retired into an append-only archive and stay
// recoverable by key.

/** Versioned namespace for the append-only terminal-operation archive. */
export const TRANSITION_ARCHIVE_VERSION = 'bb_property_transition_archive_v1'

/**
 * Thrown when a transition operation cannot be durably persisted, read back,
 * or archived. Carries the lodge/user scope and storage key for actionable
 * recovery guidance; never carries credentials or tokens.
 */
export class TransitionStorageError extends Error {
  /**
   * @param {string} message actionable operator/developer guidance
   * @param {{ scope?: unknown, key?: unknown, cause?: unknown }} [info]
   */
  constructor(message, { scope = null, key = null, cause = null } = {}) {
    super(message)
    this.name = 'TransitionStorageError'
    this.code = 'property_transition_storage_unavailable'
    this.scope = scope
    this.key = typeof key === 'string' ? key : null
    if (cause !== null && cause !== undefined) this.cause = cause
  }
}

/**
 * @param {unknown} storage localStorage-compatible adapter (or null when absent)
 * @param {unknown} storageKey scoped key being accessed
 * @returns {asserts storage is { getItem: Function, setItem: Function, removeItem: Function }}
 */
function assertUsableStorage(storage, storageKey) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
    throw new TransitionStorageError(
      'Local recovery storage is unavailable, so the property-type change was NOT submitted. Enable local storage for this app (or free device space) and try again — nothing was sent to the server.',
      { scope: null, key: typeof storageKey === 'string' ? storageKey : null, cause: 'missing-or-blocked-storage' }
    )
  }
}

/**
 * Build the scoped archive key for terminal (retired/superseded) operations.
 * Same lodge/user scoping as the live key; archive entries are append-only.
 * @param {{ lodgeId?: unknown, userId?: unknown }} scope
 */
export function buildArchiveKey({ lodgeId, userId } = {}) {
  const lodge = assertValidLodge(lodgeId)
  return `${TRANSITION_ARCHIVE_VERSION}::${lodge}::${userScopeOf(userId)}`
}

/**
 * Durably persist an operation and verify it by re-reading. Throws
 * TransitionStorageError on missing/blocked/failing storage or when the
 * re-read does not match — callers MUST NOT submit before this resolves.
 * @param {unknown} storage localStorage-compatible adapter
 * @param {unknown} storageKey scoped key from buildStorageKey
 * @param {unknown} op captured operation
 * @returns {CapturedPropertyTransitionOperation} the persisted operation
 */
export function saveStoredTransitionOp(storage, storageKey, op) {
  assertUsableStorage(storage, storageKey)
  if (typeof storageKey !== 'string' || storageKey === '') {
    throw new TransitionStorageError(
      'Local recovery storage has no scope for this property-type change, so it was NOT submitted. Reload settings and try again — nothing was sent to the server.',
      { scope: null, key: null, cause: 'missing-storage-key' }
    )
  }
  const bytes = serializeOperation(op)
  try {
    storage.setItem(storageKey, bytes)
  } catch (cause) {
    throw new TransitionStorageError(
      'The property-type change could not be saved on this device (storage write failed), so it was NOT submitted. Free device space or re-enable local storage and try again — nothing was sent to the server.',
      { scope: null, key: storageKey, cause }
    )
  }
  let roundTripped = null
  try {
    roundTripped = parseOperation(storage.getItem(storageKey))
  } catch (cause) {
    throw new TransitionStorageError(
      'The property-type change could not be verified on this device (storage re-read failed), so it was NOT submitted. Try again — nothing was sent to the server.',
      { scope: null, key: storageKey, cause }
    )
  }
  if (!roundTripped || !isSameOperation(roundTripped, op)) {
    throw new TransitionStorageError(
      'The property-type change did not persist on this device (verification mismatch), so it was NOT submitted. Try again — nothing was sent to the server.',
      { scope: null, key: storageKey, cause: 'persist-verify-mismatch' }
    )
  }
  return roundTripped
}

/**
 * Load the operation stored under a scoped key. Throws TransitionStorageError
 * when storage itself is missing/blocked; returns null when no (or only a
 * corrupt) record exists — corrupt bytes are never surfaced as an operation.
 * @param {unknown} storage localStorage-compatible adapter
 * @param {unknown} storageKey scoped key from buildStorageKey
 * @returns {CapturedPropertyTransitionOperation | null}
 */
export function loadStoredTransitionOp(storage, storageKey) {
  assertUsableStorage(storage, storageKey)
  if (typeof storageKey !== 'string' || storageKey === '') return null
  let raw = null
  try {
    raw = storage.getItem(storageKey)
  } catch (cause) {
    throw new TransitionStorageError(
      'Local recovery storage could not be read, so no pending property-type operation can be recovered on this device right now. Use “Check outcome” with the original operation key before retrying.',
      { scope: null, key: storageKey, cause }
    )
  }
  return parseOperation(raw)
}

/**
 * List archived (terminal) operations for a scope, oldest first. The archive
 * is append-only: entries are never edited or deleted by this module.
 * @param {unknown} storage localStorage-compatible adapter
 * @param {{ lodgeId?: unknown, userId?: unknown }} scope
 * @returns {Array<Record<string, unknown>>}
 */
export function listArchivedTransitionOps(storage, scope = {}) {
  const archiveKey = buildArchiveKey(scope)
  assertUsableStorage(storage, archiveKey)
  let raw = null
  try {
    raw = storage.getItem(archiveKey)
  } catch (cause) {
    throw new TransitionStorageError(
      'The archived property-type history could not be read on this device.',
      { scope: { ...scope }, key: archiveKey, cause }
    )
  }
  if (raw == null || String(raw).trim() === '') return []
  try {
    const parsed = JSON.parse(String(raw))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Classify one append-only archive record for operator display.
 * - `'unresolved'`: superseded while its server outcome was never confirmed.
 *   Still recoverable: offer a status check by its ORIGINAL key.
 * - `'completed'`: an authoritatively completed outcome (commit, late commit
 *   after a timeout, or status recovery). Never resubmit.
 * The archive record itself is never edited; a fresh status lookup for an
 * unresolved entry is reported alongside — not written into — this terminal.
 * @param {unknown} record one entry from listArchivedTransitionOps
 * @returns {{ kind: 'unresolved' | 'completed' | 'unknown', label: string, outcome: string | null }}
 */
export function describeArchivedTerminal(record) {
  const terminal = record && typeof record === 'object'
    ? /** @type {Record<string, unknown>} */ (record).terminal
    : null
  const outcome = terminal && typeof terminal === 'object'
    ? cleanText(/** @type {Record<string, unknown>} */ (terminal).outcome)
    : ''
  if (outcome === 'superseded') {
    return { kind: 'unresolved', label: 'Archived unresolved — outcome never confirmed', outcome }
  }
  if (outcome === 'committed' || outcome === 'late-commit' || outcome === 'status-recovery') {
    const how = outcome === 'late-commit'
      ? ' (late arrival after a timeout)'
      : outcome === 'status-recovery'
        ? ' (found by status check)'
        : ''
    return { kind: 'completed', label: `Completed on the server${how}`, outcome }
  }
  return { kind: 'unknown', label: outcome === '' ? 'Archived (outcome not recorded)' : `Archived (${outcome})`, outcome: outcome === '' ? null : outcome }
}

/**
 * Append an immutable terminal record to the scope archive, then clear the
 * live pending key. Existing archive entries are preserved untouched; the
 * archived record stays recoverable by its idempotency key.
 * The terminal `reason` must be the ACTUAL operator action at supersede time
 * (captured by the caller — e.g. whether an outcome check was recorded for
 * this key). Never assert an outcome check that did not happen.
 * @param {unknown} storage localStorage-compatible adapter
 * @param {{ lodgeId?: unknown, userId?: unknown }} scope
 * @param {unknown} op the terminal operation
 * @param {{ outcome?: unknown, reason?: unknown, at?: unknown }} [terminalInfo]
 * @returns {Record<string, unknown>} the appended archive record
 */
export function archiveStoredTransitionOp(storage, scope = {}, op, terminalInfo = {}) {
  const archiveKey = buildArchiveKey(scope)
  assertUsableStorage(storage, archiveKey)
  if (!op || typeof op !== 'object') {
    throw new TransitionStorageError('Cannot archive a missing property-type operation.', { scope: { ...scope }, key: archiveKey, cause: 'missing-operation' })
  }
  const liveKey = (() => {
    try {
      return buildStorageKey(scope)
    } catch {
      return null
    }
  })()
  const record = Object.freeze({
    version: TRANSITION_ARCHIVE_VERSION,
    op: { ...(/** @type {Record<string, unknown>} */ (op)) },
    terminal: {
      outcome: terminalInfo && typeof terminalInfo === 'object' ? (/** @type {Record<string, unknown>} */ (terminalInfo)).outcome ?? null : null,
      reason: terminalInfo && typeof terminalInfo === 'object' ? String((/** @type {Record<string, unknown>} */ (terminalInfo)).reason ?? '') : '',
      at: terminalInfo && typeof terminalInfo === 'object' && typeof (/** @type {Record<string, unknown>} */ (terminalInfo)).at === 'string'
        ? (/** @type {Record<string, unknown>} */ (terminalInfo)).at
        : new Date().toISOString()
    }
  })
  let existing = []
  try {
    const raw = storage.getItem(archiveKey)
    if (raw != null && String(raw).trim() !== '') {
      const parsed = JSON.parse(String(raw))
      if (!Array.isArray(parsed)) {
        throw new TransitionStorageError(
          'The archived property-type history on this device is corrupt, so the terminal operation was kept pending instead of being archived. Resolve it via “Check outcome” before starting a new change.',
          { scope: { ...scope }, key: archiveKey, cause: 'archive-corrupt' }
        )
      }
      existing = parsed
    }
  } catch (error) {
    if (error instanceof TransitionStorageError) throw error
    throw new TransitionStorageError('The archived property-type history could not be read on this device.', { scope: { ...scope }, key: archiveKey, cause: error })
  }
  const next = [...existing, record]
  try {
    storage.setItem(archiveKey, JSON.stringify(next))
  } catch (cause) {
    throw new TransitionStorageError(
      'The property-type change could not be archived on this device (storage write failed), so it stays pending. Resolve it via “Check outcome” before starting a new change.',
      { scope: { ...scope }, key: archiveKey, cause }
    )
  }
  if (liveKey) {
    try {
      storage.removeItem(liveKey)
    } catch {
      // Best-effort: the archive record is durable; a leftover live key only
      // re-presents the same operation for outcome checking, never a new op.
    }
  }
  return record
}

/** @typedef {'idle' | 'pending' | 'awaiting-outcome' | 'preview-required' | 'committed' | 'refresh-pending'} TransitionControllerPhase */

/**
 * The REAL production orchestration for the Settings property-type section.
 * Unlike createLifecycle (pure, storage/RPC-agnostic), this controller owns
 * the durable write-verify-submit discipline end to end:
 *
 * - ensureDurable(op): persist + verify by re-read; throws before any submit.
 * - submitCurrent(): builds the payload via buildCommitPayload(storedOp)
 *   exactly once per in-flight request; an ambiguous timeout races via the
 *   injected timers, marks awaiting-outcome and KEEPS the op (never mints a
 *   replacement key). Late completions retire exactly once.
  * - checkOutcome(): status lookup; retires + archives only on an
  *   authoritative completed outcome whose identity matches the current op.
  * - checkArchivedOutcome(key): read-only status lookup for an ARCHIVED op by
  *   its ORIGINAL key. Never submits (api.commit is never called) and never
  *   creates, retires, clears or otherwise touches the current stored op —
  *   even when the archived lookup resolves completed. The key must belong
  *   to THIS scope's archive (property/user isolation).
  * - beginNew(): allowed only when no unresolved op exists; mints a fresh key.
  *   archiveAndSupersede(reason) archives the old op (outcome `superseded`,
  *   retained in the append-only archive) so a new change may begin. The
  *   reason must describe the ACTUAL operator action at supersede time
  *   (e.g. whether an outcome check was recorded for that key) — never an
  *   unconditional "outcome checked" assertion.
 * - Every async settlement is fenced by (scope, opKey): late/stale results
 *   for a previous scope or superseded key are ignored and can never clear
 *   a newer operation.
 * - After commit/status success the controller runs api.refresh() (the
 *   awaited authoritative settings read, never a cache-first get) and always
 *   reports refresh:{ok,...}. A refresh failure yields a saved-but-pending
 *   state with refresh-only recovery (retryRefreshOnly); a completed
 *   mutation is NEVER resubmitted to repair a refresh failure.
 *
 * @param {{
 *   storage?: unknown,
 *   api?: { commit?: (payload: PropertyTransitionCommitPayload) => Promise<unknown>, status?: (idempotencyKey: string) => Promise<unknown>, refresh?: () => Promise<{ ok: boolean, reason?: string, detail?: unknown, settings?: unknown, updatedAt?: unknown }> },
 *   timers?: { commitTimeoutMs?: unknown, setTimeout?: unknown, clearTimeout?: unknown },
 *   scope?: { lodgeId?: unknown, userId?: unknown },
 *   generateKey?: (() => unknown) | null,
 *   onEvent?: ((name: string, detail?: unknown) => void) | null
 * }} [options]
 */
export function createTransitionController({ storage = null, api = {}, timers = {}, scope = {}, generateKey = null, onEvent = null } = {}) {
  let scopeLodgeId = scope.lodgeId == null || cleanText(scope.lodgeId) === '' ? null : cleanText(scope.lodgeId)
  let scopeUserId = scope.userId == null ? null : cleanText(scope.userId)
  /** @type {CapturedPropertyTransitionOperation | null} */
  let stored = null
  /** @type {TransitionControllerPhase} */
  let phase = 'idle'
  /** @type {{ ok: boolean, reason?: string, detail?: unknown } | null} */
  let refreshState = null
  /** @type {{ ticket: string, payload: PropertyTransitionCommitPayload } | null} */
  let inflight = null
  let epoch = 0

  const emit = (name, detail) => {
    try {
      if (typeof onEvent === 'function') onEvent(name, detail)
    } catch {
      // Event listeners are UI best-effort; orchestration never depends on them.
    }
  }

  const storageKeyFor = (lodgeId, userId) => {
    try {
      return buildStorageKey({ lodgeId, userId })
    } catch {
      return null
    }
  }

  const currentKey = () => storageKeyFor(scopeLodgeId, scopeUserId === '' ? null : scopeUserId)
  const currentScope = () => ({ lodgeId: scopeLodgeId, userId: scopeUserId === '' ? null : scopeUserId })
  const ticketFor = (op) => `${currentKey() || ''}::${op ? cleanText(op.idempotencyKey) : ''}::${epoch}`
  const isCurrentTicket = (ticket) => stored != null && ticket === ticketFor(stored)

  const commitTimeoutMs = Number(timers.commitTimeoutMs ?? 20000) > 0 ? Number(timers.commitTimeoutMs ?? 20000) : 20000
  const setTimeoutFn = typeof timers.setTimeout === 'function' ? timers.setTimeout : globalThis.setTimeout?.bind(globalThis)
  const clearTimeoutFn = typeof timers.clearTimeout === 'function' ? timers.clearTimeout : globalThis.clearTimeout?.bind(globalThis)

  /** Fresh UUID per operation; never reused across operations. */
  const mintKey = () => {
    if (typeof generateKey === 'function') {
      const candidate = cleanText(generateKey())
      if (candidate !== '') return assertValidKey(candidate)
    }
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
    const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1)
    return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`.toLowerCase()
  }

  /**
   * Read an RPC-shaped result: {success:true,...} or a thrown error mapped to
   * a classified failure. Returns { ok, result?, error?, kind? } where kind is
   * one of 'committed' | 'stale' | 'conflict' | 'timeout' | 'unknown'.
   */
  const readOutcome = (res) => {
    if (res && typeof res === 'object' && res.success === true) return { ok: true, result: res }
    const code = typeof res?.code === 'string' ? res.code : ''
    const message = res?.error || res?.message || 'The property-type service rejected this request.'
    const error = new Error(message)
    error.code = /expected_state|stale/i.test(code + message) ? 'expected_state_conflict' : (code || 'property_transition_rejected')
    return { ok: false, error }
  }

  const classifyFailure = (error) => {
    const code = String(error?.code || '')
    const message = String(error?.message || '')
    if (/ETIMEDOUT|timeout|socket hang up|settings_save_timeout|timed out/i.test(code + ' ' + message)) return 'timeout'
    if (/expected_state_conflict|stale/i.test(code + ' ' + message)) return 'stale'
    if (/idempotency_key_reuse_mismatch|payload.*mismatch|already.*different|23505/i.test(code + ' ' + message)) return 'conflict'
    if (/property_transition_offline|offline/i.test(code)) return 'offline'
    if (/CAPABILITY_DENIED|LODGE_SCOPE_DENIED|cross_product_rejected|UNAUTHENTICATED/i.test(code)) return 'denied'
    return 'unknown'
  }

  /** Retire + archive the current op. Only call with a fenced ticket. */
  const retireCurrent = (terminalInfo) => {
    const retired = stored
    if (!retired) return null
    try {
      archiveStoredTransitionOp(storage, currentScope(), retired, terminalInfo)
    } catch (archiveError) {
      // Archiving must never resurrect a server-confirmed mutation into a
      // resubmittable op: keep it retired in memory, clear the live key
      // best-effort, and report the archive failure for operator recovery.
      const key = currentKey()
      if (key) {
        try {
          storage?.removeItem?.(key)
        } catch {}
      }
      stored = null
      phase = 'committed'
      inflight = null
      emit('archive-failed', { error: archiveError, op: retired })
      return retired
    }
    stored = null
    phase = 'committed'
    inflight = null
    emit('retired', { op: retired, terminal: terminalInfo })
    return retired
  }

  const runRefresh = async () => {
    if (typeof api.refresh !== 'function') {
      refreshState = { ok: false, reason: 'refresh-unavailable' }
      return refreshState
    }
    try {
      const res = await api.refresh()
      if (res && typeof res === 'object' && res.ok === true) {
        refreshState = { ok: true }
      } else if (res && typeof res === 'object' && res.ok === false) {
        refreshState = { ok: false, reason: String(res.reason || 'refresh-failed'), detail: res.detail }
      } else {
        refreshState = { ok: false, reason: 'refresh-failed' }
      }
    } catch (error) {
      refreshState = { ok: false, reason: 'exception', detail: error?.message || String(error) }
    }
    return refreshState
  }

  /** Settle a fenced commit resolution (success path shared by submit + late). */
  const settleCommitSuccess = async (ticket, result, { late = false } = {}) => {
    if (!isCurrentTicket(ticket)) {
      emit('stale-ignored', { late })
      return { retired: false, stale: true }
    }
    if (!shouldRetireAfter({ commitResult: result })) {
      return { retired: false, result }
    }
    const op = stored
    retireCurrent({ outcome: late ? 'late-commit' : 'committed', at: new Date().toISOString() })
    const refresh = await runRefresh()
    if (refresh.ok !== true) {
      phase = 'refresh-pending'
      emit('refresh-pending', { op })
      return { retired: true, op, refresh: { ok: false, reason: refresh.reason, detail: refresh.detail }, result }
    }
    emit(late ? 'late-retired' : 'committed', { op })
    return { retired: true, op, refresh: { ok: true }, result }
  }

  const controller = {
    getStored() {
      return stored
    },
    getPhase() {
      return phase
    },
    getScope() {
      return currentScope()
    },
    getRefreshState() {
      return refreshState
    },
    isCommitted() {
      return phase === 'committed'
    },
    describe() {
      return describeRecoveryState({ stored, currentLodgeId: scopeLodgeId, currentUserId: scopeUserId })
    },
    /** Recover the scoped record into memory (reopen/restart). No submission. */
    recover() {
      const key = currentKey()
      const found = loadStoredTransitionOp(storage, key)
      if (found) {
        stored = found
        phase = 'pending'
        refreshState = null
        emit('recovered', { op: found })
      }
      return stored
    },
    /**
     * Persist + verify by re-read. Throws TransitionStorageError before any
     * submit when storage is missing, blocked or failing.
     */
    ensureDurable(op) {
      const key = currentKey()
      const saved = saveStoredTransitionOp(storage, key, op)
      stored = saved
      if (phase === 'idle' || phase === 'committed') phase = 'pending'
      refreshState = null
      emit('persisted', { op: saved })
      return saved
    },
    /**
     * Begin a new change. Throws while an unresolved op exists (use
     * checkOutcome, or archiveAndSupersede for an explicit archived
     * replacement). Mints a FRESH key; the retired key is never reused.
     */
    beginNew({ targetType, expectedPropertyType, expectedUpdatedAt, reason } = {}) {
      if (stored) {
        throw transitionError(
          'pending_operation_exists',
          'A property-type operation is already pending. Check its outcome, or archive it explicitly before starting a different change.'
        )
      }
      const op = captureOperation({
        idempotencyKey: mintKey(),
        lodgeId: scopeLodgeId,
        userId: scopeUserId === '' ? null : scopeUserId,
        targetType,
        expectedPropertyType,
        expectedUpdatedAt,
        reason
      })
      return controller.ensureDurable(op)
    },
    /**
     * Submit the CURRENT stored operation. The payload comes from
     * buildCommitPayload(storedOp), computed once per in-flight request and
     * reused byte-identically on retry. At most one request is in flight;
     * an ambiguous timeout keeps the op (awaiting-outcome) instead of
     * minting a replacement key.
     */
    async submitCurrent() {
      if (!stored) {
        throw transitionError('property_transition_no_pending_operation', 'No pending property-type operation to submit.')
      }
      if (inflight) {
        throw transitionError('property_transition_submit_in_flight', 'A property-type request for this operation is already in flight. Wait for its outcome instead of submitting again.')
      }
      if (typeof api.commit !== 'function') {
        throw transitionError('property_transition_unavailable', 'The property-type commit service is unavailable in this build.')
      }
      const op = stored
      const ticket = ticketFor(op)
      const payload = buildCommitPayload(op)
      let timer = null
      const commitPromise = api.commit(payload)
      const timeoutPromise = new Promise((_, reject) => {
        if (typeof setTimeoutFn !== 'function') return
        timer = setTimeoutFn(() => {
          const error = new Error('The property-type request timed out with an unknown outcome. The operation is kept — check its outcome before retrying. No duplicate was submitted.')
          error.code = 'property_transition_timeout'
          reject(error)
        }, commitTimeoutMs)
      })
      inflight = { ticket, payload }
      emit('submitted', { op })
      let res
      try {
        res = typeof setTimeoutFn === 'function'
          ? await Promise.race([commitPromise, timeoutPromise])
          : await commitPromise
      } catch (error) {
        if (!isCurrentTicket(ticket)) {
          emit('stale-ignored', { late: false })
          throw error
        }
        const kind = classifyFailure(error)
        if (kind === 'timeout') {
          phase = 'awaiting-outcome'
          inflight = null
          // The original request may still land: reconcile it without a new
          // submit when it settles.
          try {
            Promise.resolve(commitPromise).then(
              (lateRes) => { void settleCommitSuccess(ticket, lateRes, { late: true }) },
              () => {}
            )
          } catch {}
          emit('timeout', { op })
          throw error
        }
        inflight = null
        if (kind === 'stale') {
          phase = 'preview-required'
          emit('stale', { op, error })
          throw error
        }
        emit('submit-failed', { op, error, kind })
        throw error
      } finally {
        try {
          if (timer != null && typeof clearTimeoutFn === 'function') clearTimeoutFn(timer)
        } catch {}
      }
      if (!isCurrentTicket(ticket)) {
        emit('stale-ignored', { late: false })
        return { retired: false, stale: true, result: res }
      }
      inflight = null
      const read = readOutcome(res)
      if (!read.ok) {
        const kind = classifyFailure(read.error)
        if (kind === 'stale') {
          phase = 'preview-required'
          emit('stale', { op, error: read.error })
        } else {
          emit('submit-failed', { op, error: read.error, kind })
        }
        throw read.error
      }
      return settleCommitSuccess(ticket, read.result)
    },
    /**
     * Status lookup for the current op. Retires + archives only on an
     * authoritative completed outcome whose identity matches the current op
     * (lodge + key); anything else keeps the op for exact retry.
     */
    async checkOutcome() {
      if (!stored) {
        throw transitionError('property_transition_no_pending_operation', 'No property-type operation has been started yet, so there is no outcome to check.')
      }
      if (typeof api.status !== 'function') {
        throw transitionError('property_transition_unavailable', 'The property-type status service is unavailable in this build.')
      }
      const op = stored
      const ticket = ticketFor(op)
      const res = await api.status(op.idempotencyKey)
      if (!isCurrentTicket(ticket)) {
        emit('stale-ignored', { late: true })
        return { retired: false, stale: true }
      }
      const read = readOutcome(res)
      if (!read.ok) {
        const code = String(read.error?.code || '')
        if (/NOT_FOUND/i.test(code)) {
          phase = 'awaiting-outcome'
          emit('status-not-found', { op })
          return { found: false, code: 'NOT_FOUND' }
        }
        emit('status-failed', { op, error: read.error })
        throw read.error
      }
      const outcome = read.result && typeof read.result === 'object' ? read.result : {}
      const data = outcome.data && typeof outcome.data === 'object' ? outcome.data : outcome
      const resultLodge = cleanText(outcome.lodge_id ?? data.lodge_id ?? '')
      const resultKey = cleanText(outcome.idempotency_key ?? outcome.idempotencyKey ?? data.idempotency_key ?? '')
      if (resultLodge !== '' && resultLodge !== cleanText(op.lodgeId)) {
        emit('stale-ignored', { late: true })
        return { retired: false, stale: true }
      }
      if (resultKey !== '' && resultKey !== cleanText(op.idempotencyKey)) {
        emit('stale-ignored', { late: true })
        return { retired: false, stale: true }
      }
      if (!shouldRetireAfter({ statusResult: read.result })) {
        emit('status-incomplete', { op })
        return { found: true, retired: false, result: read.result }
      }
      retireCurrent({ outcome: 'status-recovery', at: new Date().toISOString() })
      const refresh = await runRefresh()
      if (refresh.ok !== true) {
        phase = 'refresh-pending'
        emit('refresh-pending', { op })
        return { retired: true, op, found: true, refresh: { ok: false, reason: refresh.reason, detail: refresh.detail }, result: read.result }
      }
      emit('status-retired', { op })
      return { retired: true, op, found: true, refresh: { ok: true }, result: read.result }
    },
    /**
     * Refresh-only recovery: re-runs the authoritative settings read without
     * submitting any mutation. Asserts (by construction) that api.commit is
     * never called here — tests verify the commit count stays at exactly one
     * across refresh retries.
     */
    async retryRefreshOnly() {
      const refresh = await runRefresh()
      if (refresh.ok === true) {
        if (phase === 'refresh-pending') phase = 'committed'
        emit('refresh-recovered', {})
        return { ok: true }
      }
      emit('refresh-pending', {})
      return { ok: false, reason: refresh.reason, detail: refresh.detail }
    },
    /**
     * Read-only recovery check for an ARCHIVED operation by its ORIGINAL key.
     * Used by the scoped archive/history UI. Guarantees:
     * - api.commit is NEVER called on this path (no resubmission, even when
     *   the archived outcome resolves completed);
     * - the current stored op, phase, inflight request and refresh state are
     *   left untouched (fenced by op identity: the result carries its own key
     *   and callers must match it to the selected archive entry);
     * - the key must exist in THIS scope's archive (lodge/user isolation: a
     *   scope can never probe another scope's history from here).
     * The append-only archive is never edited: a fresh lookup result is
     * returned alongside the stored terminal, never written into it.
     * @param {unknown} idempotencyKey the ORIGINAL archived operation key
     */
    async checkArchivedOutcome(idempotencyKey) {
      const key = assertValidKey(idempotencyKey)
      const lookupEpoch = epoch
      const lookupScopeKey = currentKey()
      if (typeof api.status !== 'function') {
        throw transitionError('property_transition_unavailable', 'The property-type status service is unavailable in this build.')
      }
      let entries = []
      try {
        entries = listArchivedTransitionOps(storage, currentScope())
      } catch (error) {
        if (error instanceof TransitionStorageError) throw error
        throw new TransitionStorageError(
          'The archived property-type history could not be read on this device.',
          { scope: currentScope(), key: null, cause: error }
        )
      }
      const archived = entries.find((entry) => entry
        && typeof entry === 'object'
        && entry.op
        && typeof entry.op === 'object'
        && cleanText(entry.op.idempotencyKey) === key) || null
      if (!archived) {
        throw transitionError(
          'property_transition_archive_unknown_key',
          'That operation key is not in this property/user history on this device. Switch back to the property and user that started it to check its outcome.'
        )
      }
      const res = await api.status(key)
      if (lookupEpoch !== epoch || lookupScopeKey !== currentKey()) {
        emit('stale-ignored', { late: true })
        return { key, retired: false, stale: true, terminal: describeArchivedTerminal(archived) }
      }
      // Fenced by construction: stored/phase/inflight/refreshState are never
      // assigned on this path — verify nothing leaked by returning the key
      // with the result so the UI can match it to its selected entry.
      const read = readOutcome(res)
      if (!read.ok) {
        const code = String(read.error?.code || '')
        if (/NOT_FOUND/i.test(code)) {
          emit('archive-status-not-found', { key })
          return { key, found: false, code: 'NOT_FOUND', terminal: describeArchivedTerminal(archived) }
        }
        emit('archive-status-failed', { key, error: read.error })
        throw read.error
      }
      const outcome = read.result && typeof read.result === 'object' ? read.result : {}
      const data = outcome.data && typeof outcome.data === 'object' ? outcome.data : outcome
      const resultLodge = cleanText(outcome.lodge_id ?? data.lodge_id ?? '')
      const resultKey = cleanText(outcome.idempotency_key ?? outcome.idempotencyKey ?? data.idempotency_key ?? '')
      if (resultLodge !== cleanText(archived.op.lodgeId)
        || resultLodge !== cleanText(currentScope().lodgeId)
        || resultKey !== key) {
        // A mismatched receipt must never be displayed as this entry's
        // outcome, and must never touch the current operation.
        emit('stale-ignored', { late: true })
        return { key, retired: false, stale: true, mismatched: true, terminal: describeArchivedTerminal(archived) }
      }
      emit('archive-status-found', { key })
      return { key, found: true, retired: false, result: read.result, terminal: describeArchivedTerminal(archived) }
    },
    /**
     * Explicit archive-and-supersede: archives the unresolved op (outcome
     * `superseded`, archive retained, recovery via key still possible) and
     * clears it so beginNew() may mint a fresh key. This is the ONLY way to
     * abandon an operation — there is no permanent-delete path.
     * The reason must describe the ACTUAL operator action at supersede time
     * (captured by the caller); never assert an outcome check that did not
     * happen. The archived record keeps `superseded-unresolved` distinct
     * from terminally-completed outcomes (see describeArchivedTerminal).
     */
    archiveAndSupersede(reason = '') {
      if (!stored) {
        throw transitionError('property_transition_no_pending_operation', 'No pending property-type operation to archive.')
      }
      const op = stored
      archiveStoredTransitionOp(storage, currentScope(), op, { outcome: 'superseded', reason: String(reason || 'superseded'), at: new Date().toISOString() })
      stored = null
      phase = 'idle'
      inflight = null
      refreshState = null
      emit('superseded', { op })
      return { archived: true, op }
    },
    /** Scope switch (lodge/user change): memory clears, storage keys differ. */
    setScope(next = {}) {
      epoch += 1
      if ('lodgeId' in next) scopeLodgeId = next.lodgeId == null || cleanText(next.lodgeId) === '' ? null : cleanText(next.lodgeId)
      if ('userId' in next) scopeUserId = next.userId == null ? null : cleanText(next.userId)
      stored = null
      phase = 'idle'
      inflight = null
      refreshState = null
      return controller.getScope()
    }
  }

  // Adopt any previously persisted scoped record without submitting.
  try {
    const key = currentKey()
    if (key && storage && typeof storage.getItem === 'function') {
      const found = parseOperation(storage.getItem(key))
      if (found) {
        stored = found
        phase = 'pending'
      }
    }
  } catch {
    // Recovery is best-effort here; explicit recover() throws truthfully.
  }
  return controller
}
