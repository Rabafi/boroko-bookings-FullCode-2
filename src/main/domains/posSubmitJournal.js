import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { state } from '../state.js'

const POS_SUBMIT_ATTEMPTS_FILE = 'pos-submit-attempts.json'
const POS_SUBMIT_JOURNAL_BLOCKED_FILE = 'pos-submit-attempts.blocked.json'
const COMMITTED_RETENTION_MS = 24 * 60 * 60 * 1000
const MAX_COMMITTED_ATTEMPTS = 200
const journalRecoveryBlocks = new Map()

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function hashPayload(value) {
  return createHash('sha256').update(stableStringify(value || {})).digest('hex')
}

function attemptFilePath() {
  if (!state.cacheDir) throw new Error('POS submit attempt journal failed: cache directory is not initialized')
  return path.join(state.cacheDir, POS_SUBMIT_ATTEMPTS_FILE)
}

function blockedFilePath() {
  if (!state.cacheDir) throw new Error('POS submit attempt journal failed: cache directory is not initialized')
  return path.join(state.cacheDir, POS_SUBMIT_JOURNAL_BLOCKED_FILE)
}

function journalRecoveryError(reason = 'the journal could not be read') {
  const error = new Error(
    `POS sale recovery is unavailable because ${reason}. Do not create a new sale; contact a manager or support to reconcile the original submission journal.`
  )
  error.code = 'pos_submit_journal_unavailable'
  error.requiresRecovery = true
  return error
}

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

function writeDurable(filePath, value) {
  const tmpPath = `${filePath}.tmp`
  const tmpFd = fs.openSync(tmpPath, 'w')
  try {
    fs.writeFileSync(tmpFd, JSON.stringify(value, null, 2), 'utf-8')
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
      throw new Error(`POS submit attempt journal write failed: ${copyError?.message || renameError?.message || 'unknown error'}`)
    }
  }
}

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

function rejectCorruptJournal(filePath, reason) {
  const quarantinePath = `${filePath}.corrupt.${Date.now()}.bak`
  try {
    // Persist the recovery sentinel before moving the only source evidence.
    // If this write fails, the corrupt journal remains in place so a restart
    // encounters it again and fails closed.
    blockJournal(filePath, reason, quarantinePath)
  } catch (error) {
    console.error('[POS Submit Journal] Failed to persist recovery block:', error?.message || error)
    throw journalRecoveryError('the corrupt local submission journal could not be durably blocked; its original evidence was retained')
  }
  quarantineBadFile(filePath, quarantinePath, reason)
  throw journalRecoveryError('the local submission journal is corrupt')
}

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
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!Array.isArray(parsed)) {
      rejectCorruptJournal(filePath, 'the journal root was not an array')
    }
    const malformed = parsed.some((entry) => (
      !entry ||
      typeof entry !== 'object' ||
      !asId(entry.submitIntentId) ||
      !asId(entry.orderId) ||
      !['pending', 'committed'].includes(String(entry.status || '')) ||
      !entry.payload ||
      !entry.digest
    ))
    if (malformed) {
      rejectCorruptJournal(filePath, 'the journal contains an incomplete financial attempt')
    }
    return parsed
  } catch (error) {
    if (error?.code === 'pos_submit_journal_unavailable') throw error
    console.error('[POS Submit Journal] Read failed:', error?.message || error)
    rejectCorruptJournal(filePath, error?.message || 'invalid JSON')
  }
}

function writeAttempts(attempts) {
  const now = Date.now()
  const pending = attempts.filter((attempt) => attempt?.status !== 'committed')
  const committed = attempts
    .filter((attempt) => attempt?.status === 'committed')
    .filter((attempt) => {
      const age = now - Date.parse(attempt?.lastAttemptAt || attempt?.committedAt || attempt?.firstAttemptAt || '')
      // An invalid timestamp is retained fail-closed. It is safer to keep an
      // old settled record than to make its original operation unrecoverable.
      return !Number.isFinite(age) || age < COMMITTED_RETENTION_MS
    })
    .sort((left, right) => String(right.lastAttemptAt || right.committedAt || right.firstAttemptAt || '').localeCompare(String(left.lastAttemptAt || left.committedAt || left.firstAttemptAt || '')))
    .slice(0, MAX_COMMITTED_ATTEMPTS)
  const pruned = [...pending, ...committed]
  writeDurable(attemptFilePath(), pruned)
  return pruned
}

function findAttempt(attempts, submitIntentId) {
  return attempts.find((attempt) => String(attempt?.submitIntentId || '') === String(submitIntentId || '')) || null
}

function asId(value) {
  const text = String(value || '').trim()
  return text || null
}

// Records the first submission of an order attempt and resolves retries.
// Retries must reuse the exact same envelope (same submitIntentId, order id and
// client_created_at) so the server idempotency contract returns the original
// result instead of creating a second sale.
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
    if (existing.digest !== digest) {
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
    const updated = attempts.map((attempt) => attempt.submitIntentId === normalizedIntentId ? reused : attempt)
    writeAttempts(updated)
    return { attempt: reused, reused: true, conflict: false, error: null }
  }
  const normalizedLodgeId = asId(lodgeId) || state.lodgeId || null
  const normalizedUserId = asId(userId) || state.currentUser?.id || null
  const unresolvedAttempt = attempts.find((attempt) =>
    attempt?.status === 'pending' &&
    // Older journals may not contain both scope fields. They cannot be
    // proven to belong to a different operator/company, so keep the Till
    // fail-closed instead of permitting a potentially duplicate intent.
    (!attempt.lodgeId || !normalizedLodgeId || attempt.lodgeId === normalizedLodgeId) &&
    (!attempt.userId || !normalizedUserId || attempt.userId === normalizedUserId)
  )
  if (unresolvedAttempt) {
    return {
      conflict: true,
      reused: false,
      code: 'pos_submit_recovery_required',
      error: `Sale attempt ${unresolvedAttempt.submitIntentId} is still unresolved. Reconcile or retry that exact attempt before starting a new sale.`
    }
  }
  const attempt = {
    submitIntentId: normalizedIntentId,
    orderId: normalizedOrderId,
    lodgeId: normalizedLodgeId,
    userId: normalizedUserId,
    createdAtClient: payload?.created_at_client || payload?.client_created_at || null,
    digest,
    payload,
    status: 'pending',
    firstAttemptAt: nowIso,
    lastAttemptAt: nowIso
  }
  writeAttempts([attempt, ...attempts])
  return { attempt, reused: false, conflict: false, error: null }
}

export function commitPosSubmitAttempt(submitIntentId) {
  const normalizedIntentId = asId(submitIntentId)
  if (!normalizedIntentId) return null
  const attempts = readAttempts()
  const existing = findAttempt(attempts, normalizedIntentId)
  if (!existing) return null
  const updated = attempts.map((attempt) =>
    attempt.submitIntentId === normalizedIntentId
      ? { ...attempt, status: 'committed', lastAttemptAt: new Date().toISOString() }
      : attempt
  )
  writeAttempts(updated)
  return updated.find((attempt) => attempt.submitIntentId === normalizedIntentId) || null
}

// Used when an order was already created server-side (for example by an
// earlier queue replay) so a retried attempt resolves to the original result.
export function findCommittedPosSubmitAttempt({ submitIntentId, orderId }) {
  const attempts = readAttempts()
  const byIntent = findAttempt(attempts, submitIntentId)
  if (byIntent && byIntent.status === 'committed') return byIntent
  if (orderId) {
    const byOrder = attempts.find((attempt) =>
      attempt.orderId === asId(orderId) && attempt.status === 'committed'
    )
    if (byOrder) return byOrder
  }
  return null
}

// Renderer reload recovery: the newest unresolved attempt for this lodge/user
// is returned so the renderer can offer to retry the original sale instead of
// silently starting a second one.
export function getPendingPosSubmitAttempt({ lodgeId, userId }) {
  const attempts = readAttempts()
  const candidates = attempts.filter((attempt) =>
    attempt.status === 'pending' &&
    (!lodgeId || attempt.lodgeId === asId(lodgeId)) &&
    (!userId || attempt.userId === asId(userId))
  )
  candidates.sort((a, b) => String(b.lastAttemptAt || '').localeCompare(String(a.lastAttemptAt || '')))
  return candidates[0] || null
}

export function clearPosSubmitAttempt(submitIntentId) {
  const normalizedIntentId = asId(submitIntentId)
  if (!normalizedIntentId) return
  const attempts = readAttempts().filter((attempt) => attempt.submitIntentId !== normalizedIntentId)
  writeAttempts(attempts)
}

export function prunePosSubmitAttempts() {
  return writeAttempts(readAttempts()).length
}
