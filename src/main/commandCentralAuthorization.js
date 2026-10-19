// @ts-check

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const DEFAULT_ELEVATION_TTL_MS = 10 * 60 * 1000
export const MASTER_ADMIN_SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000

/**
 * @param {Record<string, unknown> | null | undefined} record
 * @param {{ trustedUnlock?: boolean, currentSessionMaxAgeMs?: number, trustedSessionMaxAgeMs?: number }} [options]
 * @returns {number}
 */
export function getSessionMaxAgeMs(record, { trustedUnlock = false, currentSessionMaxAgeMs = 7 * 24 * 60 * 60 * 1000, trustedSessionMaxAgeMs = 60 * 24 * 60 * 60 * 1000 } = {}) {
  if (record?.isMasterAdmin) return MASTER_ADMIN_SESSION_MAX_AGE_MS
  return trustedUnlock ? trustedSessionMaxAgeMs : currentSessionMaxAgeMs
}

/**
 * @param {{ ttlMs?: number, now?: () => number }} [options]
 * @returns {{ clear: () => void, grant: (requestedActorId: string) => { verified: true, expiresAt: number }, assertFresh: (requestedActorId: string) => true, status: (requestedActorId: string) => { verified: boolean, expiresAt: number | null } }}
 */
export function createActorBoundElevationGate({ ttlMs = DEFAULT_ELEVATION_TTL_MS, now = () => Date.now() } = {}) {
  /** @type {string | null} */
  let actorId = null
  let expiresAt = 0
  function clear() { actorId = null; expiresAt = 0 }
  /** @param {string} requestedActorId @returns {{ verified: boolean, expiresAt: number | null }} */
  function status(requestedActorId) {
    const verified = Boolean(requestedActorId) && actorId === requestedActorId && now() < expiresAt
    if (!verified) clear()
    return { verified, expiresAt: verified ? expiresAt : null }
  }
  return {
    clear,
    grant(requestedActorId) {
      if (!requestedActorId) throw new Error('A master administrator is required')
      actorId = requestedActorId
      expiresAt = now() + ttlMs
      return { verified: true, expiresAt }
    },
    assertFresh(requestedActorId) {
      if (!status(requestedActorId).verified) throw new Error('Re-authenticate Command Central before making this sensitive change.')
      return true
    },
    status
  }
}

/**
 * @param {{ maxFailures?: number, windowMs?: number, lockMs?: number, now?: () => number }} [options]
 * @returns {{ clear: (identity: unknown) => void, get: (identity: unknown) => { blocked: boolean, retryAfterMs: number, failures: number }, recordFailure: (identity: unknown) => { blocked: boolean, retryAfterMs: number, failures: number } }}
 */
export function createLoginFailureLimiter({ maxFailures = 5, windowMs = 15 * 60 * 1000, lockMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
  /** @type {Map<string, { failures: number, windowStartedAt: number, lockedUntil: number }>} */
  const attempts = new Map()
  /** @param {unknown} identity @returns {string} */
  const keyFor = (identity) => String(identity || '').trim().toLowerCase()
  /** @param {unknown} identity @returns {{ blocked: boolean, retryAfterMs: number, failures: number }} */
  function get(identity) {
    const key = keyFor(identity)
    const entry = attempts.get(key)
    if (!entry) return { blocked: false, retryAfterMs: 0, failures: 0 }
    const current = now()
    if (entry.lockedUntil > current) return { blocked: true, retryAfterMs: entry.lockedUntil - current, failures: entry.failures }
    if (current - entry.windowStartedAt >= windowMs) {
      attempts.delete(key)
      return { blocked: false, retryAfterMs: 0, failures: 0 }
    }
    return { blocked: false, retryAfterMs: 0, failures: entry.failures }
  }
  return {
    clear(identity) { attempts.delete(keyFor(identity)) },
    get,
    recordFailure(identity) {
      const key = keyFor(identity)
      const current = now()
      const prior = attempts.get(key)
      const entry = !prior || current - prior.windowStartedAt >= windowMs ? { failures: 0, windowStartedAt: current, lockedUntil: 0 } : prior
      entry.failures += 1
      if (entry.failures >= maxFailures) entry.lockedUntil = current + lockMs
      attempts.set(key, entry)
      return get(identity)
    }
  }
}

/** Command Central is a platform control plane, not a lodge-level role. */
/** @param {Record<string, unknown> | null | undefined} user @returns {Record<string, unknown>} */
export function assertMasterAdmin(user) {
  if (!user) throw new Error('Not authenticated')
  if (user.isMasterAdmin !== true) throw new Error('Command Central requires a master administrator session')
  return user
}

/** Reject ambiguous renderer input before a cross-company operation begins. */
/** @param {unknown} targetLodgeId @returns {string} */
export function assertCommandCentralTarget(targetLodgeId) {
  const normalized = String(targetLodgeId || '').trim()
  if (!UUID_PATTERN.test(normalized)) throw new Error('A valid target company is required')
  return normalized
}

export const COMMAND_CENTRAL_CAPABILITIES = Object.freeze([
  'command_central.view',
  'command_central.companies.manage',
  'command_central.licensing.manage',
  'command_central.billing.manage',
  'command_central.releases.manage',
  'command_central.support.manage',
  'command_central.security.manage',
  'command_central.destructive.manage',
  'command_central.recovery.manage'
])
