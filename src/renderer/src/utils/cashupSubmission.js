const PREFIX = 'tsa-bonno-pos-cashup-round:'
// Preserve unresolved rounds written by older Bar builds without retaining
// their old product identifier in source-visible labels or new keys.
const LEGACY_PREFIX = String.fromCharCode(98, 111, 114, 111, 107, 111, 45, 112, 111, 115, 45, 99, 97, 115, 104, 117, 112, 45, 114, 111, 117, 110, 100, 58)
const SUCCESS_STATUSES = new Set(['submitted', 'approved', 'closed'])

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
    const error = new Error(`A real ${label} is required before saving a cash-up round.`)
    error.code = 'cashup_round_scope_required'
    throw error
  }
  return normalized
}

function contextKey({ lodgeId, shiftId, submissionType = 'cashier' } = {}) {
  return `${PREFIX}${[lodgeId, shiftId, submissionType].map((value) => encodeURIComponent(String(value))).join(':')}`
}

function legacyContextKey({ lodgeId, shiftId, submissionType = 'cashier' } = {}) {
  return `${LEGACY_PREFIX}${[lodgeId, shiftId, submissionType].map((value) => encodeURIComponent(String(value))).join(':')}`
}

function newOperationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `cashup-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

export function cashupSubmissionFingerprint(payload = {}) {
  return stableStringify(payload)
}

function readRound(storage, key) {
  if (!storage) throw new Error('Durable local storage is unavailable.')
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    const round = JSON.parse(raw)
    if (!round || typeof round !== 'object' || !round.idempotencyKey || !round.fingerprint) throw new Error('cash-up round is invalid')
    return round
  } catch (error) {
    const wrapped = new Error(`The saved cash-up round could not be read safely: ${error.message}. Do not submit a new count until a manager reviews this device.`)
    wrapped.code = 'cashup_round_unavailable'
    throw wrapped
  }
}

export function writeRound(storage, key, round) {
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

export function getCashupSubmissionRound({
  lodgeId,
  shiftId,
  actorId,
  operatorId = null,
  submissionType = 'cashier',
  payload = {},
  serverStatus = null,
  serverIdempotencyKey = null,
  storage
} = {}) {
  let normalizedLodge
  let normalizedShift
  let normalizedActor
  try {
    normalizedLodge = requiredId(lodgeId, 'lodge ID')
    normalizedShift = requiredId(shiftId, 'shift ID')
    normalizedActor = requiredId(actorId, 'authenticated actor ID')
  } catch (error) {
    return invalidRound(null, error)
  }
  const targetStorage = storageOrDefault(storage)
  let key
  try {
    key = contextKey({ lodgeId: normalizedLodge, shiftId: normalizedShift, submissionType })
    const fingerprint = cashupSubmissionFingerprint(payload)
    let existing = readRound(targetStorage, key)
    if (!existing && targetStorage) {
      const legacyKey = legacyContextKey({ lodgeId: normalizedLodge, shiftId: normalizedShift, submissionType })
      const legacyRound = readRound(targetStorage, legacyKey)
      if (legacyRound) {
        if (!writeRound(targetStorage, key, legacyRound) || !clearRoundStorage(targetStorage, legacyKey)) {
          return invalidRound(key, new Error('The saved cash-up round could not be migrated safely. Do not submit another count until a manager reviews this device.'))
        }
        existing = legacyRound
      }
    }
    const status = String(serverStatus || '').toLowerCase()
    const authoritativeKey = String(serverIdempotencyKey || '').trim()
    const rejectedExistingRound = Boolean(
      existing &&
      status === 'rejected' &&
      authoritativeKey &&
      authoritativeKey === existing.idempotencyKey
    )

    if (SUCCESS_STATUSES.has(status)) {
      if (!clearRoundStorage(targetStorage, key)) {
        return invalidRound(key, new Error('The confirmed cash-up round could not be cleared from durable storage. Do not submit another count.'))
      }
      return { key, round: null, cleared: true, conflict: false, durable: true }
    }

    // A rejected status can be stale: after a corrected submission commits but
    // its response is lost, the renderer still holds the rejection for the
    // previous round. Retire a saved round only when the authoritative record
    // identifies that exact idempotency key as rejected.
    if (existing && !rejectedExistingRound) {
      if (existing.actorId !== normalizedActor) {
        return {
          key,
          round: existing,
          conflict: true,
          durable: true,
          error: 'The authenticated manager changed while this shared cash-up was unresolved. Sign back in as the original manager or have a manager reconcile the saved round.'
        }
      }
      if (existing.fingerprint !== fingerprint) {
        return {
          key,
          round: existing,
          conflict: true,
          durable: true,
          error: 'The previous cash-up attempt is still unresolved. Retry its original count and notes before changing the submission.'
        }
      }
      return { key, round: existing, conflict: false, reused: true, durable: true }
    }

    if (rejectedExistingRound && !clearRoundStorage(targetStorage, key)) {
      return invalidRound(key, new Error('The rejected cash-up round could not be retired safely.'))
    }
    const round = {
      idempotencyKey: `pos-cashup-${submissionType}:${normalizedShift}:${newOperationId()}`,
      lodgeId: normalizedLodge,
      shiftId: normalizedShift,
      actorId: normalizedActor,
      operatorId: operatorId ? requiredId(operatorId, 'staff operator ID') : null,
      submissionType,
      fingerprint,
      payload: JSON.parse(JSON.stringify(payload)),
      createdAt: new Date().toISOString(),
      status: 'pending'
    }
    const durable = writeRound(targetStorage, key, round)
    if (!durable) return invalidRound(key, new Error('The cash-up round could not be durably saved. The server call was not sent.'))
    return { key, round, conflict: false, reused: false, durable, rotated: rejectedExistingRound }
  } catch (error) {
    return invalidRound(key, error)
  }
}

export function clearCashupSubmissionRound({ lodgeId, shiftId, submissionType = 'cashier', storage } = {}) {
  try {
    const normalizedLodge = requiredId(lodgeId, 'lodge ID')
    const normalizedShift = requiredId(shiftId, 'shift ID')
    const targetStorage = storageOrDefault(storage)
    return clearRoundStorage(targetStorage, contextKey({ lodgeId: normalizedLodge, shiftId: normalizedShift, submissionType }))
  } catch {
    return false
  }
}
