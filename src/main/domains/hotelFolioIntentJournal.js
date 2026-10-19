// @ts-check
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { state } from '../state.js'

/** @typedef {'create' | 'charge' | 'payment' | 'booking_charge' | 'transfer' | 'split' | 'void' | 'close' | 'reopen' | 'lock'} HotelFolioOperationKind */
/** @typedef {'prepared' | 'submitting' | 'unknown' | 'rejected' | 'confirmed'} HotelFolioIntentStatus */
/** @typedef {{intentId: string, lodgeId: string, actorId: string, operationKind: HotelFolioOperationKind, payload: Record<string, unknown>, payloadHash: string, status: HotelFolioIntentStatus, createdAt: string, updatedAt: string, serverReceipt: unknown, lastError: unknown, [field: string]: unknown}} HotelFolioIntent */
/** @typedef {{version: number, intents: HotelFolioIntent[]}} HotelFolioJournal */
/** @typedef {{status?: HotelFolioIntentStatus, lastError?: unknown, lastAttemptAt?: string, serverReceipt?: unknown, serverConfirmedAt?: string}} HotelFolioIntentUpdate */
/** @typedef {Record<string, unknown>} JournalPropertyView */

const JOURNAL_FILE = 'hotel-folio-intents.json'
const JOURNAL_VERSION = 1
const MAX_INTENTS = 500
const inFlight = new Map()

/** @param {unknown} value @returns {string | undefined} */
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  const fields = /** @type {JournalPropertyView} */ (value)
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(fields[key])).join(',') + '}'
}

/** @param {unknown} value */
function payloadHash(value) {
  // This function is called with the object envelope below; the assertion is
  // erased and retains crypto's existing failure if a caller supplies a value
  // whose canonical form is undefined.
  return createHash('sha256').update(/** @type {string} */ (canonicalJson(value))).digest('hex')
}

/** @returns {string} */
function journalPath() {
  if (!state.cacheDir) throw new Error('Hotel folio recovery journal is unavailable: cache directory is not initialized.')
  return path.join(state.cacheDir, JOURNAL_FILE)
}

/** @param {string} message */
function recoveryError(message) {
  const error = /** @type {Error & {code: string, requiresRecovery: boolean}} */ (new Error('Hotel folio recovery is blocked because ' + message + '. Do not submit a new payment or charge; contact a manager or support to reconcile the saved intent.'))
  error.code = 'hotel_folio_journal_unavailable'
  error.requiresRecovery = true
  return error
}

/** @returns {HotelFolioJournal} */
function readJournal() {
  const file = journalPath()
  if (!fs.existsSync(file)) return { version: JOURNAL_VERSION, intents: [] }
  /** @type {unknown} */
  let data
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    const errorView = /** @type {JournalPropertyView | null | undefined} */ (error)
    throw recoveryError('the local journal could not be read (' + (errorView?.message || 'invalid JSON') + ')')
  }
  if (!data || typeof data !== 'object') {
    throw recoveryError('the local journal has an unsupported or incomplete format')
  }
  const journal = /** @type {JournalPropertyView} */ (data)
  if (journal.version !== JOURNAL_VERSION || !Array.isArray(journal.intents)) {
    throw recoveryError('the local journal has an unsupported or incomplete format')
  }
  const allowedKinds = new Set(['create', 'charge', 'payment', 'booking_charge', 'transfer', 'split', 'void', 'close', 'reopen', 'lock'])
  const malformed = journal.intents.some((rawEntry) => {
    if (!rawEntry || typeof rawEntry !== 'object') return true
    // Preserve the current property reads for arrays and objects. The checks
    // below are the journal's existing runtime validation before the typed view.
    const entry = /** @type {JournalPropertyView} */ (rawEntry)
    return (
    !entry || typeof entry !== 'object' ||
    !/^[0-9a-f-]{36}$/i.test(String(entry.intentId || '')) ||
    !String(entry.lodgeId || '').trim() ||
    !String(entry.actorId || '').trim() ||
    !allowedKinds.has(/** @type {string} */ (entry.operationKind)) ||
    !entry.payload || typeof entry.payload !== 'object' || Array.isArray(entry.payload) ||
    !/^[0-9a-f]{64}$/i.test(String(entry.payloadHash || '')) ||
    entry.payloadHash !== payloadHash({ lodgeId: entry.lodgeId, actorId: entry.actorId, operationKind: entry.operationKind, payload: entry.payload }) ||
    !['prepared', 'submitting', 'unknown', 'rejected', 'confirmed'].includes(/** @type {string} */ (entry.status))
    )
  })
  if (malformed) throw recoveryError('the local journal contains a malformed operation; evidence was retained')
  // Journal shape and every persisted field used below were validated above.
  return /** @type {HotelFolioJournal} */ (journal)
}

/** @param {HotelFolioJournal} journal */
function writeJournal(journal) {
  const file = journalPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = file + '.' + process.pid + '.' + randomUUID() + '.tmp'
  let fd
  try {
    fd = fs.openSync(temp, 'wx')
    fs.writeFileSync(fd, JSON.stringify(journal, null, 2), 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(temp, file)
  } catch (error) {
    if (fd !== undefined && fd !== null) {
      try { fs.closeSync(fd) } catch { /* preserve original write failure */ }
    }
    try { fs.unlinkSync(temp) } catch { /* retain whatever recovery evidence exists */ }
    const errorView = /** @type {JournalPropertyView | null | undefined} */ (error)
    throw recoveryError('the local operation could not be written durably (' + (errorView?.message || 'write failed') + ')')
  }
}

/** @returns {{lodgeId: string, actorId: string}} */
function currentScope() {
  const lodgeId = String(state.lodgeId || '').trim()
  const actorId = String(state.currentUser?.id || '').trim()
  if (!lodgeId || !actorId) throw new Error('Hotel folio intents require an authenticated user and active lodge.')
  return { lodgeId, actorId }
}

/** @param {HotelFolioIntent} entry */
function matchingScope(entry) {
  const { lodgeId, actorId } = currentScope()
  if (entry.lodgeId !== lodgeId || entry.actorId !== actorId) {
    throw new Error('This Hotel folio intent belongs to another signed-in user or lodge. Switch to its original authorized session to recover it.')
  }
}

/** @param {string} intentId @param {HotelFolioIntentUpdate} update */
function updateIntent(intentId, update) {
  const journal = readJournal()
  const index = journal.intents.findIndex((entry) => entry.intentId === intentId)
  if (index < 0) throw recoveryError('the requested operation is missing from the journal')
  const next = { ...journal.intents[index], ...update, updatedAt: new Date().toISOString() }
  journal.intents[index] = next
  writeJournal(journal)
  return next
}

/** @param {{intentId?: string, operationKind: HotelFolioOperationKind, payload: Record<string, unknown>}} input */
export function prepareHotelFolioIntent({ intentId = randomUUID(), operationKind, payload }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(intentId || ''))) throw new Error('A valid Hotel folio intent UUID is required.')
  const { lodgeId, actorId } = currentScope()
  const journal = readJournal()
  const existing = journal.intents.find((entry) => entry.intentId === intentId)
  const hash = payloadHash({ lodgeId, actorId, operationKind, payload })
  if (existing) {
    matchingScope(existing)
    if (existing.payloadHash !== hash || existing.operationKind !== operationKind) {
      throw new Error('This Hotel folio intent key was already used with different details. Keep the original intent for recovery.')
    }
    return existing
  }
  const unresolved = journal.intents.find((entry) => entry.lodgeId === lodgeId && ['prepared','submitting','unknown'].includes(entry.status))
  if (unresolved) {
    const owner = unresolved.actorId === actorId ? 'your saved' : 'another authorized user’s'
    throw new Error('Recover ' + owner + ' Hotel folio operation before submitting a new charge or payment. Use the same saved intent to check its outcome.')
  }
  if (journal.intents.filter((entry) => entry.status !== 'confirmed' && entry.status !== 'rejected').length >= MAX_INTENTS) {
    throw recoveryError('too many unresolved operations require review')
  }
  /** @type {HotelFolioIntent} */
  const entry = {
    intentId,
    lodgeId,
    actorId,
    operationKind,
    payload,
    payloadHash: hash,
    status: 'prepared',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    serverReceipt: null,
    lastError: null
  }
  journal.intents.push(entry)
  if (journal.intents.length > MAX_INTENTS) {
    journal.intents = journal.intents.filter((item) => item.status !== 'confirmed' && item.status !== 'rejected').concat(
      journal.intents.filter((item) => item.status === 'confirmed' || item.status === 'rejected').slice(-100)
    )
  }
  writeJournal(journal)
  return entry
}

/** @param {string} intentId @param {HotelFolioIntentUpdate} update */
export function markHotelFolioIntent(intentId, update) {
  return updateIntent(intentId, update)
}

/** @param {string} intentId */
export function getHotelFolioIntent(intentId) {
  const entry = readJournal().intents.find((item) => item.intentId === intentId)
  if (!entry) throw recoveryError('the requested operation is missing from the journal')
  matchingScope(entry)
  return entry
}

export function listHotelFolioRecoveryIntents() {
  const { lodgeId, actorId } = currentScope()
  return readJournal().intents
    .filter((entry) => entry.lodgeId === lodgeId && entry.actorId === actorId && ['prepared', 'submitting', 'unknown'].includes(entry.status))
    .map(({ intentId, operationKind, payloadHash: hash, status, createdAt, updatedAt, lastError }) => ({
      intentId, operationKind, payloadHash: hash, status, createdAt, updatedAt,
      lastError: lastError || null
    }))
}

/** @template T @param {string} intentId @param {() => T | PromiseLike<T>} work @returns {Promise<Awaited<T>>} */
export function runHotelFolioIntentOnce(intentId, work) {
  if (inFlight.has(intentId)) return inFlight.get(intentId)
  const promise = /** @type {Promise<Awaited<T>>} */ (Promise.resolve().then(work)).finally(() => {
    if (inFlight.get(intentId) === promise) inFlight.delete(intentId)
  })
  inFlight.set(intentId, promise)
  return promise
}

export { payloadHash as hotelFolioPayloadHash }
