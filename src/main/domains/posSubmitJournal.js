// @ts-check
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { state } from '../state.js'

const POS_SUBMIT_ATTEMPTS_FILE = 'pos-submit-attempts.json'
const POS_SUBMIT_JOURNAL_BLOCKED_FILE = 'pos-submit-attempts.blocked.json'
const COMMITTED_RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_COMMITTED_ATTEMPTS = 200
const journalRecoveryBlocks = new Map()

/** @typedef {Record<string, unknown>} AttemptReadView */

/** @param {unknown} value @param {string} key @returns {unknown} */
function readOptional(value, key) {
  return /** @type {AttemptReadView | null | undefined} */ (value)?.[key]
}

/** @param {unknown} value @param {string} key @returns {unknown} */
function readDirect(value, key) {
  return /** @type {AttemptReadView} */ (value)[key]
}

/** @param {unknown} value @returns {string | undefined} */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  const fields = /** @type {AttemptReadView} */ (value)
  return `{${Object.keys(fields).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(fields[key])}`).join(',')}}`
}

/** @param {unknown} value */
function hashPayload(value) {
  return createHash('sha256').update(/** @type {string} */ (stableStringify(value || {}))).digest('hex')
}

function attemptFilePath() {
  if (!state.cacheDir) throw new Error('POS submit attempt journal failed: cache directory is not initialized')
  return path.join(state.cacheDir, POS_SUBMIT_ATTEMPTS_FILE)
}

function blockedFilePath() {
  if (!state.cacheDir) throw new Error('POS submit attempt journal failed: cache directory is not initialized')
  return path.join(state.cacheDir, POS_SUBMIT_JOURNAL_BLOCKED_FILE)
}

/** @returns {Error & { code: string; requiresRecovery: boolean }} */
function journalRecoveryError(reason = 'the journal could not be read') {
  const error = new Error(
    `POS sale recovery is unavailable because ${reason}. Do not create a new sale; contact a manager or support to reconcile the original submission journal.`
  )
  const fields = /** @type {Error & { code: string; requiresRecovery: boolean }} */ (error)
  fields.code = 'pos_submit_journal_unavailable'
  fields.requiresRecovery = true
  return fields
}

/** @param {string} filePath @param {string} quarantinePath @param {unknown} [reason] */
function quarantineBadFile(filePath, quarantinePath, reason = 'corrupt JSON') {
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    fs.renameSync(filePath, quarantinePath)
    console.warn(`[POS Submit Journal] Quarantined ${path.basename(filePath)} (${reason})`)
    return quarantinePath
  } catch (error) {
    console.error('[POS Submit Journal] Failed to quarantine corrupt file:', error)
    return null
  }
}

/** @param {string} filePath @param {unknown} value */
function writeDurable(filePath, value) {
  const tmpPath = `${filePath}.tmp`
  const tmpFd = fs.openSync(tmpPath, 'w')
  try {
    fs.writeFileSync(tmpFd, /** @type {string} */ (JSON.stringify(value, null, 2)), 'utf-8')
    fs.fsyncSync(tmpFd)
  } finally {
    fs.closeSync(tmpFd)
  }
  try {
    fs.renameSync(tmpPath, filePath)
  } catch (renameError) {
    try {
      fs.copyFileSync(tmpPath, filePath)
      const destinationFd = fs.openSync(filePath, 'r')
      try {
        fs.fsyncSync(destinationFd)
      } finally {
        fs.closeSync(destinationFd)
      }
      try { fs.unlinkSync(tmpPath) } catch { /* keep recovery copy if unlink is blocked */ }
    } catch (copyError) {
      throw new Error(`POS submit attempt journal write failed: ${readOptional(copyError, 'message') || readOptional(renameError, 'message') || 'unknown error'}`)
    }
  }
}

/** @param {string} filePath @param {unknown} reason @param {string | null} [corruptPath] */
function blockJournal(filePath, reason, corruptPath = null) {
  const block = {
    reason: String(reason || 'corrupt journal'),
    corruptPath,
    detectedAt: new Date().toISOString()
  }
  // Latch the process before touching the corrupt evidence. Even if the
  // durable marker cannot be written, this process must never treat the
  // quarantined/missing journal as a clean first run.
  journalRecoveryBlocks.set(filePath, block)
  writeDurable(blockedFilePath(), block)
  return block
}

/** @param {string} filePath @param {unknown} reason @returns {never} */
function rejectCorruptJournal(filePath, reason) {
  const quarantinePath = `${filePath}.corrupt.${Date.now()}.bak`
  try {
    // Persist the recovery sentinel before moving the only source evidence.
    // If this write fails, the corrupt journal remains in place so a restart
    // encounters it again and fails closed.
    blockJournal(filePath, reason, quarantinePath)
  } catch (error) {
    console.error('[POS Submit Journal] Failed to persist recovery block:', readOptional(error, 'message') || error)
    throw journalRecoveryError('the corrupt local submission journal could not be durably blocked; its original evidence was retained')
  }
  quarantineBadFile(filePath, quarantinePath, reason)
  throw journalRecoveryError('the local submission journal is corrupt')
}

/** @returns {unknown[]} */
function readAttempts() {
  const filePath = attemptFilePath()
  if (fs.existsSync(blockedFilePath())) {
    journalRecoveryBlocks.set(filePath, { reason: 'durable recovery marker exists' })
    throw journalRecoveryError('the local submission journal was quarantined after a previous corruption failure')
  }
  if (journalRecoveryBlocks.has(filePath)) {
    throw journalRecoveryError('the local submission journal is blocked for manager or support recovery')
  }
  if (!fs.existsSync(filePath)) return []
  try {
    const parsed = /** @type {unknown} */ (JSON.parse(fs.readFileSync(filePath, 'utf-8')))
    if (!Array.isArray(parsed)) {
      rejectCorruptJournal(filePath, 'the journal root was not an array')
    }
    const parsedRows = /** @type {unknown[]} */ (parsed)
    const malformed = parsedRows.some((entry) => {
      if (!entry || typeof entry !== 'object') return true
      const fields = /** @type {AttemptReadView} */ (entry)
      return !asId(fields.submitIntentId) ||
        !asId(fields.orderId) ||
        !['pending', 'provisional', 'committed'].includes(String(fields.status || '')) ||
        !fields.payload ||
        !fields.digest
    })
    if (malformed) {
      rejectCorruptJournal(filePath, 'the journal contains an incomplete financial attempt')
    }
    return parsedRows
  } catch (error) {
    if (readOptional(error, 'code') === 'pos_submit_journal_unavailable') throw error
    console.error('[POS Submit Journal] Read failed:', readOptional(error, 'message') || error)
    rejectCorruptJournal(filePath, readOptional(error, 'message') || 'invalid JSON')
  }
}

/** @param {unknown[]} attempts @returns {unknown[]} */
function writeAttempts(attempts) {
  const now = Date.now()
  const pending = attempts.filter((attempt) => readOptional(attempt, 'status') !== 'committed')
  const committed = attempts
    .filter((attempt) => readOptional(attempt, 'status') === 'committed')
    .filter((attempt) => {
      const age = now - Date.parse(/** @type {string} */ (readOptional(attempt, 'lastAttemptAt') || readOptional(attempt, 'committedAt') || readOptional(attempt, 'firstAttemptAt') || ''))
      // An invalid timestamp is retained fail-closed. It is safer to keep an
      // old settled record than to make its original operation unrecoverable.
      return !Number.isFinite(age) || age < COMMITTED_RETENTION_MS
    })
    .sort((left, right) => String(readDirect(right, 'lastAttemptAt') || readDirect(right, 'committedAt') || readDirect(right, 'firstAttemptAt') || '').localeCompare(String(readDirect(left, 'lastAttemptAt') || readDirect(left, 'committedAt') || readDirect(left, 'firstAttemptAt') || '')))
    .slice(0, MAX_COMMITTED_ATTEMPTS)
  const pruned = [...pending, ...committed]
  writeDurable(attemptFilePath(), pruned)
  return pruned
}

/** @param {unknown[]} attempts @param {unknown} submitIntentId @returns {unknown | null} */
function findAttempt(attempts, submitIntentId) {
  return attempts.find((attempt) => String(readOptional(attempt, 'submitIntentId') || '') === String(submitIntentId || '')) || null
}

/** @param {unknown} value @returns {string | null} */
function asId(value) {
  const text = String(value || '').trim()
  return text || null
}

// Records the first submission of an order attempt and resolves retries.
// Retries must reuse the exact same envelope (same submitIntentId, order id and
// client_created_at) so the server idempotency contract returns the original
// result instead of creating a second sale.
/** @param {{ submitIntentId: unknown; orderId: unknown; lodgeId: unknown; userId: unknown; payload: unknown }} input */
export function resolvePosSubmitAttempt({ submitIntentId, orderId, lodgeId, userId, payload }) {
  const normalizedIntentId = asId(submitIntentId)
  const normalizedOrderId = asId(orderId)
  if (!normalizedIntentId) {
    return { conflict: true, error: 'A stable submit intent id is required to record a POS order.' }
  }
  const nowIso = new Date().toISOString()
  const digest = hashPayload(payload)
  const attempts = readAttempts()
  const existing = findAttempt(attempts, normalizedIntentId)
  if (existing) {
    if (readDirect(existing, 'digest') !== digest) {
      return {
        conflict: true,
        reused: false,
        error: 'This sale attempt was already submitted with different details. Retrying a changed sale would double-charge; keep and reconcile the original sale.'
      }
    }
    const reused = {
      ...existing,
      lastAttemptAt: nowIso
    }
    const updated = attempts.map((attempt) => readDirect(attempt, 'submitIntentId') === normalizedIntentId ? reused : attempt)
    writeAttempts(updated)
    return { attempt: reused, reused: true, conflict: false, error: null }
  }
  const normalizedLodgeId = asId(lodgeId) || state.lodgeId || null
  const normalizedUserId = asId(userId) || state.currentUser?.id || null
  const unresolvedAttempt = attempts.find((attempt) =>
    readOptional(attempt, 'status') === 'pending' &&
    // Older journals may not contain both scope fields. They cannot be
    // proven to belong to a different operator/company, so keep the Till
    // fail-closed instead of permitting a potentially duplicate intent.
    (!readDirect(attempt, 'lodgeId') || !normalizedLodgeId || readDirect(attempt, 'lodgeId') === normalizedLodgeId) &&
    (!readDirect(attempt, 'userId') || !normalizedUserId || readDirect(attempt, 'userId') === normalizedUserId)
  )
  if (unresolvedAttempt) {
    return {
      conflict: true,
      reused: false,
      code: 'pos_submit_recovery_required',
      error: `Sale attempt ${readDirect(unresolvedAttempt, 'submitIntentId')} is still unresolved. Reconcile or retry that exact attempt before starting a new sale.`
    }
  }
  const attempt = {
    submitIntentId: normalizedIntentId,
    orderId: normalizedOrderId,
    lodgeId: normalizedLodgeId,
    userId: normalizedUserId,
    createdAtClient: readOptional(payload, 'created_at_client') || readOptional(payload, 'client_created_at') || null,
    digest,
    payload,
    status: 'pending',
    firstAttemptAt: nowIso,
    lastAttemptAt: nowIso
  }
  writeAttempts([attempt, ...attempts])
  return { attempt, reused: false, conflict: false, error: null }
}

/** @param {unknown} submitIntentId */
export function hasPosSubmitAttempt(submitIntentId) {
    const normalizedIntentId = asId(submitIntentId);
    if (!normalizedIntentId) return false;
    return findAttempt(readAttempts(), normalizedIntentId) !== null;
  }

  // Read-only accessor for retry paths: a same-intent retry must reuse the
  // originally journalled bytes instead of digesting a rebuilt envelope
  // (fresh catalog snapshot, recomputed totals) that can never hash equal.
  /** @param {unknown} submitIntentId */
  export function getPosSubmitAttempt(submitIntentId) {
    const normalizedIntentId = asId(submitIntentId);
    if (!normalizedIntentId) return null;
    return findAttempt(readAttempts(), normalizedIntentId);
  }

/** @param {unknown} submitIntentId */
export function commitPosSubmitAttempt(submitIntentId) {  const normalizedIntentId = asId(submitIntentId)
  if (!normalizedIntentId) return null
  const attempts = readAttempts()
  const existing = findAttempt(attempts, normalizedIntentId)
  if (!existing) return null
  const updated = attempts.map((attempt) =>
    readDirect(attempt, 'submitIntentId') === normalizedIntentId
      ? { .../** @type {AttemptReadView} */ (attempt), status: 'committed', lastAttemptAt: new Date().toISOString() }
      : attempt
  )
  writeAttempts(updated)
  return updated.find((attempt) => readDirect(attempt, 'submitIntentId') === normalizedIntentId) || null
}

// Offline success records the sale locally and queues the server replay.
// The outcome is no longer unknown, so the attempt leaves 'pending' for
// 'provisional': recovery banners and new-sale blocks ignore it while the
// queue owns it. Replay success commits it; dead-letter reopens it.
/** @param {unknown} submitIntentId @param {unknown} [queueId] */
export function markPosSubmitAttemptProvisional(submitIntentId, queueId = null) {
  const normalizedIntentId = asId(submitIntentId)
  if (!normalizedIntentId) return null
  const attempts = readAttempts()
  const existing = findAttempt(attempts, normalizedIntentId)
  if (!existing || readDirect(existing, 'status') !== 'pending') return existing || null
  const updated = attempts.map((attempt) =>
    readDirect(attempt, 'submitIntentId') === normalizedIntentId
      ? { .../** @type {AttemptReadView} */ (attempt), status: 'provisional', queueId: queueId || readDirect(attempt, 'queueId') || null, lastAttemptAt: new Date().toISOString() }
      : attempt
  )
  writeAttempts(updated)
  return updated.find((attempt) => readDirect(attempt, 'submitIntentId') === normalizedIntentId) || null
}

// A provisional attempt whose queue replay reached a dead end returns to
// 'pending' so manager recovery surfaces it again instead of losing it.
/** @param {unknown} submitIntentId @param {unknown} [reason] */
export function reopenPosSubmitAttempt(submitIntentId, reason = null) {
  const normalizedIntentId = asId(submitIntentId)
  if (!normalizedIntentId) return null
  const attempts = readAttempts()
  const existing = findAttempt(attempts, normalizedIntentId)
  if (!existing || readDirect(existing, 'status') !== 'provisional') return existing || null
  const updated = attempts.map((attempt) =>
    readDirect(attempt, 'submitIntentId') === normalizedIntentId
      ? { .../** @type {AttemptReadView} */ (attempt), status: 'pending', reopenReason: reason || readDirect(attempt, 'reopenReason') || null, lastAttemptAt: new Date().toISOString() }
      : attempt
  )
  writeAttempts(updated)
  return updated.find((attempt) => readDirect(attempt, 'submitIntentId') === normalizedIntentId) || null
}

// Used when an order was already created server-side (for example by an
// earlier queue replay) so a retried attempt resolves to the original result.
/** @param {{ submitIntentId: unknown; orderId: unknown }} input */
export function findCommittedPosSubmitAttempt({ submitIntentId, orderId }) {
  const attempts = readAttempts()
  const byIntent = findAttempt(attempts, submitIntentId)
  if (byIntent && readDirect(byIntent, 'status') === 'committed') return byIntent
  if (orderId) {
    const byOrder = attempts.find((attempt) =>
      readDirect(attempt, 'orderId') === asId(orderId) && readDirect(attempt, 'status') === 'committed'
    )
    if (byOrder) return byOrder
  }
  return null
}

// Renderer reload recovery: the newest unresolved attempt for this lodge/user
// is returned so the renderer can offer to retry the original sale instead of
// silently starting a second one.
/** @param {{ lodgeId?: unknown; userId?: unknown }} [scope] */
export function countPendingPosSubmitAttempts({ lodgeId, userId } = {}) {
  return readAttempts().filter((attempt) =>
    readDirect(attempt, 'status') === 'pending' &&
    (!lodgeId || readDirect(attempt, 'lodgeId') === asId(lodgeId)) &&
    (!userId || readDirect(attempt, 'userId') === asId(userId))
  ).length;
}

/** @param {{ lodgeId?: unknown; userId?: unknown }} scope */
export function getPendingPosSubmitAttempt({ lodgeId, userId }) {
  const attempts = readAttempts()
  const candidates = attempts.filter((attempt) =>
    readDirect(attempt, 'status') === 'pending' &&
    (!lodgeId || readDirect(attempt, 'lodgeId') === asId(lodgeId)) &&
    (!userId || readDirect(attempt, 'userId') === asId(userId))
  )
  candidates.sort((a, b) => String(readDirect(b, 'lastAttemptAt') || '').localeCompare(String(readDirect(a, 'lastAttemptAt') || '')))
  return candidates[0] || null
}

/** @param {unknown} submitIntentId */
export function clearPosSubmitAttempt(submitIntentId) {
  const normalizedIntentId = asId(submitIntentId)
  if (!normalizedIntentId) return
  const attempts = readAttempts().filter((attempt) => readDirect(attempt, 'submitIntentId') !== normalizedIntentId)
  writeAttempts(attempts)
}

export function prunePosSubmitAttempts() {
  return writeAttempts(readAttempts()).length
}
