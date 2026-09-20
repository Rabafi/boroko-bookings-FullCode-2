const PREFIX = 'tsa-bonno-pos-drawer-period:'
const SUCCESS_STATUSES = new Set(['approved'])

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function storageOrDefault(storage) {
  if (storage) return storage
  if (typeof window !== 'undefined') return window.localStorage
  return null
}

function requiredId(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized || ['current', 'unknown', 'null', 'undefined'].includes(normalized.toLowerCase())) {
    const error = new Error(`A real ${label} is required before saving a drawer cash-up.`)
    error.code = 'drawer_round_scope_required'
    throw error
  }
  return normalized
}

function contextKey({ lodgeId, periodId } = {}) {
  return `${PREFIX}${[lodgeId, periodId].map((value) => encodeURIComponent(String(value))).join(':')}`
}

function newOperationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `drawer-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function drawerSubmissionFingerprint(payload = {}) {
  return stableStringify(payload)
}

function readRound(storage, key) {
  if (!storage) throw new Error('Durable local storage is unavailable.')
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    const round = JSON.parse(raw)
    if (!round || typeof round !== 'object' || !round.idempotencyKey || !round.fingerprint) throw new Error('drawer cash-up round is invalid')
    return round
  } catch (error) {
    const wrapped = new Error(`The saved drawer cash-up could not be read safely: ${error.message}. Do not submit a new count until a manager reviews this device.`)
    wrapped.code = 'drawer_round_unavailable'
    throw wrapped
  }
}

function writeRound(storage, key, round) {
  if (!storage) return false
  const serialized = JSON.stringify(round)
  try {
    storage.setItem(key, serialized)
    if (storage.getItem(key) !== serialized) return false
    const stored = JSON.parse(storage.getItem(key))
    return stored?.idempotencyKey === round?.idempotencyKey && stored?.fingerprint === round?.fingerprint
  } catch {
    return false
  }
}

function clearRoundStorage(storage, key) {
  if (!storage) return false
  try {
    storage.removeItem(key)
    return storage.getItem(key) === null
  } catch {
    return false
  }
}

function invalidRound(key, error) {
  return { key, round: null, conflict: true, durable: false, error: error?.message || String(error) }
}

// Stable per-period submit round: exact retries reuse the persisted key and
// original payload; changed counts refuse until the server confirms rejection
// of the saved key; an approved period clears the round.
export function getDrawerSubmissionRound({
  lodgeId,
  periodId,
  actorId,
  operatorId = null,
  payload = {},
  serverStatus = null,
  serverIdempotencyKey = null,
  storage
} = {}) {
  let normalizedLodge
  let normalizedPeriod
  let normalizedActor
  try {
    normalizedLodge = requiredId(lodgeId, 'lodge ID')
    normalizedPeriod = requiredId(periodId, 'drawer period ID')
    normalizedActor = requiredId(actorId, 'authenticated actor ID')
  } catch (error) {
    return invalidRound(null, error)
  }
  const targetStorage = storageOrDefault(storage)
  let key
  try {
    key = contextKey({ lodgeId: normalizedLodge, periodId: normalizedPeriod })
    const fingerprint = drawerSubmissionFingerprint(payload)
    const existing = readRound(targetStorage, key)
    const status = String(serverStatus || '').toLowerCase()

    // A rejection is an explicit server decision on the current round: the
    // operator recounts and the next submit always starts a fresh round.
    // (Unlike per-shift cash-up there is no cross-round key to correlate —
    // the state read is authoritative at submit time, and any committed
    // correction already moved the status to submitted.)
    if (status === 'rejected') {
      clearRoundStorage(targetStorage, key)
    }

    if (SUCCESS_STATUSES.has(status)) {
      if (!clearRoundStorage(targetStorage, key)) {
        return invalidRound(key, new Error('The confirmed drawer cash-up could not be cleared from durable storage. Do not submit another count.'))
      }
      return { key, round: null, cleared: true, conflict: false, durable: true }
    }

    const liveExisting = status === 'rejected' ? readRound(targetStorage, key) : existing
    if (liveExisting) {
      if (liveExisting.actorId !== normalizedActor) {
        return {
          key,
          round: liveExisting,
          conflict: true,
          durable: true,
          error: 'The signed-in account changed while this drawer cash-up was unresolved. Sign back in as the original account or have a manager reconcile the saved round.'
        }
      }
      if (liveExisting.fingerprint !== fingerprint) {
        return {
          key,
          round: liveExisting,
          conflict: true,
          durable: true,
          error: 'The previous drawer count is still unresolved. Retry its original count and notes before changing the submission.'
        }
      }
      return { key, round: liveExisting, conflict: false, reused: true, durable: true }
    }
    const round = {
      idempotencyKey: `pos-drawer-submit:${normalizedPeriod}:${newOperationId()}`,
      lodgeId: normalizedLodge,
      periodId: normalizedPeriod,
      actorId: normalizedActor,
      operatorId: operatorId ? requiredId(operatorId, 'staff operator ID') : null,
      fingerprint,
      payload: JSON.parse(JSON.stringify(payload)),
      createdAt: new Date().toISOString(),
      status: 'pending'
    }
    const durable = writeRound(targetStorage, key, round)
    if (!durable) return invalidRound(key, new Error('The drawer cash-up could not be durably saved. The server call was not sent.'))
    return { key, round, conflict: false, reused: false, durable, rotated: status === 'rejected' }
  } catch (error) {
    return invalidRound(key, error)
  }
}

export function clearDrawerSubmissionRound({ lodgeId, periodId, storage } = {}) {
  try {
    const normalizedLodge = requiredId(lodgeId, 'lodge ID')
    const normalizedPeriod = requiredId(periodId, 'drawer period ID')
    const targetStorage = storageOrDefault(storage)
    return clearRoundStorage(targetStorage, contextKey({ lodgeId: normalizedLodge, periodId: normalizedPeriod }))
  } catch {
    return false
  }
}

// ---- Per-attempt stable retry keys (drawer open / movements / handovers) ----
// A drawer takes many movements and handover counts per period, so each tap
// needs its own idempotency key — but an ambiguous timeout (request lost
// after the server committed) must replay the SAME key or the retry records
// the money twice. Fingerprint the money intent only (never the Staff PIN or
// device id) and persist {key, fingerprint} per scope: an identical retry
// reuses the key (safe replay on the server, conflict on genuine mismatch),
// a changed intent rotates to a fresh key, and success clears the scope so
// the next movement starts clean. Corrupt storage fails closed: no key is
// issued and no server call may be sent.
const ATTEMPT_PREFIX = 'tsa-bonno-pos-drawer-attempt:'

function attemptScopeKey(scope) {
  const normalized = String(scope || '').trim()
  if (!normalized) {
    const error = new Error('A retry scope is required before issuing a drawer retry key.')
    error.code = 'drawer_attempt_scope_required'
    throw error
  }
  return `${ATTEMPT_PREFIX}${encodeURIComponent(normalized)}`
}

export function drawerAttemptFingerprint(payload = {}) {
  const intent = { ...(payload || {}) }
  delete intent.pin
  delete intent.pin_hash
  delete intent.device_id
  delete intent.deviceId
  delete intent.idempotency_key
  delete intent.idempotencyKey
  return stableStringify(intent)
}

function readAttempt(storage, key) {
  if (!storage) throw new Error('Durable local storage is unavailable.')
  const raw = storage.getItem(key)
  if (!raw) return null
  const attempt = JSON.parse(raw)
  if (!attempt || typeof attempt !== 'object' || !attempt.key || !attempt.fingerprint) {
    throw new Error('drawer retry key is invalid')
  }
  return attempt
}

function writeAttempt(storage, key, attempt) {
  if (!storage) return false
  const serialized = JSON.stringify(attempt)
  try {
    storage.setItem(key, serialized)
    if (storage.getItem(key) !== serialized) return false
    const stored = JSON.parse(storage.getItem(key))
    return stored?.key === attempt?.key && stored?.fingerprint === attempt?.fingerprint
  } catch {
    return false
  }
}

function invalidAttempt(key, error) {
  return { key, scopeKey: key, attemptKey: null, reused: false, durable: false, error: error?.message || String(error) }
}

export function getDrawerAttemptKey({ scope, keyPrefix = 'pos-drawer-attempt', fingerprint, storage } = {}) {
  let scopeKey = null
  try {
    scopeKey = attemptScopeKey(scope)
    const normalizedFingerprint = String(fingerprint ?? '')
    if (!normalizedFingerprint) throw new Error('A money-intent fingerprint is required before issuing a drawer retry key.')
    const targetStorage = storageOrDefault(storage)
    const existing = readAttempt(targetStorage, scopeKey)
    if (existing) {
      if (existing.fingerprint === normalizedFingerprint) {
        return { key: existing.key, scopeKey, attemptKey: existing.key, fingerprint: normalizedFingerprint, reused: true, durable: true }
      }
      // Changed intent while the previous attempt is unresolved: the previous
      // key may already be committed server-side (ambiguous timeout), so the
      // new intent must NOT reuse it. Rotate below and overwrite.
    }
    const attempt = {
      key: `${String(keyPrefix || 'pos-drawer-attempt')}:${newOperationId()}`,
      fingerprint: normalizedFingerprint,
      createdAt: new Date().toISOString(),
    }
    if (!writeAttempt(targetStorage, scopeKey, attempt)) {
      return invalidAttempt(scopeKey, new Error('The drawer retry key could not be durably saved. The server call was not sent.'))
    }
    return { key: attempt.key, scopeKey, attemptKey: attempt.key, fingerprint: normalizedFingerprint, reused: false, durable: true, rotated: Boolean(existing) }
  } catch (error) {
    return invalidAttempt(scopeKey, error)
  }
}

export function clearDrawerAttemptKey({ scope, storage } = {}) {
  try {
    const targetStorage = storageOrDefault(storage)
    return clearRoundStorage(targetStorage, attemptScopeKey(scope))
  } catch {
    return false
  }
}
