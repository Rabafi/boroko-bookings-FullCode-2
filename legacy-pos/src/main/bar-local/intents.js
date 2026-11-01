// @ts-check
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { encodeJournalRecord, decodeJournalRecord, hasJournalSecret, protectExistingJournal } from '../../../../src/shared/barLocalJournalProtection.js';

export const INTENT_JOURNAL_VERSION = 1;
export const INTENT_AUTHORITY_MODE = 'bar_local';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const TERMINAL_STATES = new Set(['committed', 'refused']);
const ALLOWED_TRANSITIONS = Object.freeze({
  pending: new Set(['submitting', 'uncertain', 'refused']),
  // A till can die between writing `submitting` and receiving the reply. The
  // same operation identifier must be re-attempted after restart, never re-keyed.
  submitting: new Set(['submitting', 'committed', 'refused', 'uncertain']),
  uncertain: new Set(['submitting', 'committed', 'refused']),
  committed: new Set(),
  refused: new Set()
});

/** @param {unknown} value @returns {value is string} */
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function randomUuid() {
  const runtime = /** @type {typeof globalThis & {crypto?: {randomUUID?: () => string}}} */ (globalThis);
  if (runtime.crypto && typeof runtime.crypto.randomUUID === 'function') {
    return runtime.crypto.randomUUID();
  }
  return crypto.randomUUID();
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasUnpairedSurrogate(text) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Canonical JSON accepts arbitrary input and rejects unsupported structures
 * while walking them; the input is deliberately unknown until each branch is
 * narrowed here.
 * @param {unknown} value
 * @param {string} location
 * @param {Set<object>} seen
 * @returns {string}
 */
function canonicalValue(value, location, seen) {
  if (value === null) return 'null';
  const type = typeof value;
  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) {
      throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', `${location} contains an unpaired UTF-16 surrogate`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', `${location} must be a safe integer; use decimal strings for money`);
    }
    return String(value);
  }
  if (typeof value === 'undefined') {
    throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', `${location} is undefined`);
  }
  if (type !== 'object' || value === null) {
    throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', `${location} has unsupported type ${type}`);
  }
  if (seen.has(value)) {
    throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', `${location} contains a cycle`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      /** @type {string[]} */
      const parts = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', `${location}[${index}] is a sparse array hole`);
        }
        parts.push(canonicalValue(value[index], `${location}[${index}]`, seen));
      }
      return `[${parts.join(',')}]`;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', `${location} must be a plain object`);
    }
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key], `${location}.${key}`, seen)}`);
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return canonicalValue(value, '$', new Set());
}

/**
 * @param {unknown} value Values are stringified using the existing runtime
 *   conversion before hashing; this does not validate or normalize them.
 * @returns {string}
 */
export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function operationPayloadHash(envelope) {
  return sha256Hex(canonicalJson({
    contract_version: envelope && envelope.contract_version,
    command: envelope && envelope.command,
    payload_version: envelope && envelope.payload_version,
    authority_id: envelope && envelope.authority_id,
    authority_epoch: envelope && envelope.authority_epoch,
    business_id: envelope && envelope.business_id,
    outlet_id: envelope && envelope.outlet_id,
    device_id: envelope && envelope.device_id,
    payload: envelope && envelope.payload
  }));
}

export class IntentJournalError extends Error {
  constructor(code, message, options) {
    super(message);
    this.name = 'IntentJournalError';
    this.code = code;
    this.details = (options && options.details) || null;
    this.recovered = Boolean(options && options.recovered);
    if (options && options.cause) this.cause = options.cause;
  }
}

function checksumFor(record) {
  const body = { ...record };
  delete body.checksum;
  return sha256Hex(canonicalJson(body));
}

function assertObject(value, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IntentJournalError('JOURNAL_CORRUPT', `${location} must be a JSON object`);
  }
  return value;
}

function assertCommittedOutcome(intent, outcome) {
  const receipt = outcome && outcome.receipt;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', 'A committed local intent requires its verified service receipt');
  }
  if (receipt.outcome !== 'committed_local' || receipt.operation_id !== intent.operation_id) {
    throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', 'The service receipt does not belong to this local intent');
  }
  for (const field of ['authority_id', 'authority_epoch', 'business_id', 'outlet_id', 'device_id']) {
    if (receipt[field] !== intent[field]) {
      throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', `The service receipt does not match the intent ${field}`);
    }
  }
  if (!Number.isSafeInteger(receipt.commit_sequence) || receipt.commit_sequence < 1) {
    throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', 'The service receipt has no valid commit sequence');
  }
  if (!isUuid(receipt.actor_staff_id) || typeof receipt.business_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(receipt.business_date)
    || typeof receipt.server_committed_at !== 'string'
    || receipt.cloud_status !== 'integration_disabled') {
    throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', 'The service receipt is incomplete');
  }
  const result = outcome.result;
  if (result !== undefined && result !== null && (typeof result !== 'object' || Array.isArray(result))) {
    throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', 'A committed local result must be a JSON object');
  }
}

function assertRefusal(error) {
  if (!error || typeof error !== 'object' || Array.isArray(error)
    || typeof error.code !== 'string' || error.code.length < 1
    || typeof error.message !== 'string' || error.message.length < 1
    || error.retry_same_operation === true) {
    throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', 'A terminal refusal requires a code, message and false retry flag');
  }
}

function validateJournalRecord(value, location) {
  const record = assertObject(value, location);
  if (record.record_version !== INTENT_JOURNAL_VERSION) {
    throw new IntentJournalError('JOURNAL_CORRUPT', `${location} has an unsupported record version`);
  }
  if (typeof record.journal_id !== 'string' || !isUuid(record.journal_id)) {
    throw new IntentJournalError('JOURNAL_CORRUPT', `${location} has an invalid journal identifier`);
  }
  if (typeof record.checksum !== 'string' || !HASH_RE.test(record.checksum)) {
    throw new IntentJournalError('JOURNAL_CORRUPT', `${location} has an invalid checksum`);
  }
  if (checksumFor(record) !== record.checksum) {
    throw new IntentJournalError('JOURNAL_CORRUPT', `${location} checksum does not match its contents`);
  }
  if (record.record_type === 'journal') {
    return record;
  }
  if (record.record_type === 'intent') {
    if (!isUuid(record.operation_id)) {
      throw new IntentJournalError('JOURNAL_CORRUPT', `${location} has an invalid operation identifier`);
    }
    if (!record.envelope || typeof record.envelope !== 'object' || Array.isArray(record.envelope)) {
      throw new IntentJournalError('JOURNAL_CORRUPT', `${location} has no command envelope`);
    }
    if (typeof record.payload_hash !== 'string' || !HASH_RE.test(record.payload_hash)) {
      throw new IntentJournalError('JOURNAL_CORRUPT', `${location} has an invalid payload hash`);
    }
    if (record.state !== 'pending') {
      throw new IntentJournalError('JOURNAL_CORRUPT', `${location} must start in the pending state`);
    }
    return record;
  }
  if (record.record_type === 'intent_state') {
    if (!isUuid(record.operation_id)) {
      throw new IntentJournalError('JOURNAL_CORRUPT', `${location} has an invalid operation identifier`);
    }
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, record.state)) {
      throw new IntentJournalError('JOURNAL_CORRUPT', `${location} has an unsupported intent state`);
    }
    return record;
  }
  throw new IntentJournalError('JOURNAL_CORRUPT', `${location} has an unknown record type`);
}

function truncateDurably(filePath, length) {
  const fd = fs.openSync(filePath, 'r+');
  try {
    fs.ftruncateSync(fd, length);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function appendDurably(filePath, text) {
  const fd = fs.openSync(filePath, 'a');
  try {
    const buffer = Buffer.from(text, 'utf8');
    let offset = 0;
    while (offset < buffer.length) {
      const written = fs.writeSync(fd, buffer, offset, buffer.length - offset, null);
      if (written <= 0) throw new IntentJournalError('JOURNAL_WRITE_FAILED', 'The intent journal write made no progress');
      offset += written;
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function readJournal(filePath, protection = null) {
  if (!fs.existsSync(filePath)) {
    return { records: [], truncated_bytes: 0, recovered: false, repaired_newline: false };
  }
  const raw = fs.readFileSync(filePath);
  const records = [];
  let offset = 0;
  let validEnd = 0;
  let lineNumber = 0;
  let trailing = null;
  let needsProtection = false;

  while (offset < raw.length) {
    const newline = raw.indexOf(0x0a, offset);
    if (newline === -1) {
      trailing = raw.subarray(offset);
      break;
    }
    lineNumber += 1;
    const line = raw.subarray(offset, newline).toString('utf8').replace(/\r$/, '');
    const location = `line ${lineNumber}`;
    if (line.trim() === '') {
      throw new IntentJournalError('JOURNAL_CORRUPT', `${location} is an unexpected blank record`);
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new IntentJournalError('JOURNAL_CORRUPT', `${location} is not valid JSON`, { cause: error });
    }
    records.push(validateJournalRecord(decodeJournalRecord(parsed, protection), location));
    if (parsed.protected_journal_record !== 1 && hasJournalSecret(parsed)) needsProtection = true;
    validEnd = newline + 1;
    offset = newline + 1;
  }

  let recovered = false;
  let repairedNewline = false;
  let truncatedBytes = 0;

  if (trailing !== null) {
    const text = trailing.toString('utf8');
    if (text.trim() === '') {
      if (raw.length > validEnd) {
        truncatedBytes = raw.length - validEnd;
        truncateDurably(filePath, validEnd);
        recovered = true;
      }
    } else {
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (parsed !== null) {
        // A complete frame with a bad checksum or unavailable encryption key
        // is corruption/recovery work, not a disposable torn write.
        records.push(validateJournalRecord(decodeJournalRecord(parsed, protection), `line ${lineNumber + 1}`));
        if (parsed.protected_journal_record !== 1 && hasJournalSecret(parsed)) needsProtection = true;
        appendDurably(filePath, '\n');
        validEnd = raw.length + 1;
        repairedNewline = true;
      } else {
        truncatedBytes = raw.length - validEnd;
        truncateDurably(filePath, validEnd);
        recovered = true;
      }
    }
  }

  return {
    records,
    needs_protection: needsProtection,
    truncated_bytes: truncatedBytes,
    recovered: recovered || repairedNewline,
    repaired_newline: repairedNewline
  };
}

export function recoverIntentJournal(filePath, protection = null) {
  const result = readJournal(filePath, protection);
  const header = result.records.find((record) => record.record_type === 'journal') || null;
  return {
    ...result,
    journal_id: header ? header.journal_id : null
  };
}

function stateRecord(journalId, operationId, state, fields) {
  return {
    record_version: INTENT_JOURNAL_VERSION,
    journal_id: journalId,
    record_id: randomUuid(),
    recorded_at: new Date().toISOString(),
    record_type: 'intent_state',
    operation_id: operationId,
    state,
    ...fields
  };
}

export class IntentJournal {
  constructor(options) {
    const filePath = options && options.filePath;
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new IntentJournalError('JOURNAL_PATH_REQUIRED', 'A durable intent journal path is required');
    }
    this.filePath = path.resolve(filePath);
    this.protection = options.protection || null;
    this.writeFailed = false;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.journalId = null;
    this.nextSequence = 1;
    this.intents = new Map();
    this.lastRecovery = null;
    this._load();
  }

  _load() {
    const result = recoverIntentJournal(this.filePath, this.protection);
    if (result.needs_protection) protectExistingJournal(this.filePath, result.records, this.protection);
    this.lastRecovery = {
      recovered: result.recovered,
      truncated_bytes: result.truncated_bytes,
      repaired_newline: result.repaired_newline
    };

    let header = result.records.find((record) => record.record_type === 'journal');
    if (!header) {
      if (result.records.length > 0) {
        throw new IntentJournalError('JOURNAL_CORRUPT', 'The intent journal has records but no journal header');
      }
      header = {
        record_version: INTENT_JOURNAL_VERSION,
        journal_id: randomUuid(),
        record_id: randomUuid(),
        recorded_at: new Date().toISOString(),
        record_type: 'journal',
        created_at: new Date().toISOString()
      };
      header.checksum = checksumFor(header);
      appendDurably(this.filePath, `${JSON.stringify(header)}\n`);
      result.records.push(header);
    }

    this.journalId = header.journal_id;
    let maxSequence = 0;

    for (const record of result.records) {
      if (record.record_type === 'journal') continue;
      if (record.journal_id !== this.journalId) {
        throw new IntentJournalError('JOURNAL_CORRUPT', 'The intent journal contains records from another journal');
      }
      maxSequence = Math.max(maxSequence, Number(record.seq) || 0);
      if (record.record_type === 'intent') {
        if (this.intents.has(record.operation_id)) {
          throw new IntentJournalError('JOURNAL_CORRUPT', `Operation ${record.operation_id} has duplicate intent records`);
        }
        this.intents.set(record.operation_id, {
          operation_id: record.operation_id,
          journal_id: this.journalId,
          authority_mode: record.authority_mode || INTENT_AUTHORITY_MODE,
          authority_id: record.authority_id || null,
          authority_epoch: record.authority_epoch || null,
          business_id: record.business_id || null,
          outlet_id: record.outlet_id || null,
          device_id: record.device_id || null,
          command: record.command || (record.envelope && record.envelope.command) || null,
          payload_version: record.payload_version || null,
          payload_hash: record.payload_hash,
          envelope: record.envelope,
          state: 'pending',
          attempts: 0,
          created_at: record.recorded_at,
          updated_at: record.recorded_at,
          receipt: null,
          result: null,
          error: null
        });
      } else if (record.record_type === 'intent_state') {
        const intent = this.intents.get(record.operation_id);
        if (!intent) {
          throw new IntentJournalError('JOURNAL_CORRUPT', `Operation ${record.operation_id} has state before its intent record`);
        }
        if (TERMINAL_STATES.has(intent.state)) {
          throw new IntentJournalError('JOURNAL_CORRUPT', `Operation ${record.operation_id} has a state after a terminal state`);
        }
        const allowed = ALLOWED_TRANSITIONS[intent.state];
        if (!allowed || !allowed.has(record.state)) {
          throw new IntentJournalError('JOURNAL_CORRUPT', `Operation ${record.operation_id} has an invalid transition ${intent.state} -> ${record.state}`);
        }
        intent.state = record.state;
        intent.updated_at = record.recorded_at;
        if (typeof record.attempts === 'number') intent.attempts = record.attempts;
        if (record.receipt !== undefined) intent.receipt = record.receipt;
        if (record.result !== undefined) intent.result = record.result;
        if (record.error !== undefined) intent.error = record.error;
      }
    }

    this.nextSequence = maxSequence + 1;
  }

  newOperationId() {
    return randomUuid();
  }

  _record(type, fields) {
    return {
      record_version: INTENT_JOURNAL_VERSION,
      journal_id: this.journalId,
      record_id: randomUuid(),
      recorded_at: new Date().toISOString(),
      seq: this.nextSequence,
      record_type: type,
      ...fields
    };
  }

  _append(record) {
    if (this.writeFailed) throw new IntentJournalError('JOURNAL_WRITE_FAILED', 'Saved-operation storage failed. Restore disk space and restart this till before continuing.');
    const complete = { ...record, checksum: checksumFor(record) };
    const line = `${encodeJournalRecord(complete, this.protection)}\n`;
    try { appendDurably(this.filePath, line); }
    catch (cause) {
      this.writeFailed = true;
      throw new IntentJournalError('JOURNAL_WRITE_FAILED', 'Saved-operation storage failed. Trading is paused. Restore disk space and restart this till to recover its original operations.');
    }
    this.nextSequence += 1;
    return complete;
  }

  _cloneIntent(intent) {
    return intent ? JSON.parse(JSON.stringify(intent)) : null;
  }

  getIntent(operationId) {
    return this._cloneIntent(this.intents.get(operationId));
  }

  listOpenIntents() {
    const open = [];
    for (const intent of this.intents.values()) {
      if (!TERMINAL_STATES.has(intent.state)) open.push(this._cloneIntent(intent));
    }
    return open;
  }

  listIntents() {
    return [...this.intents.values()].map((intent) => this._cloneIntent(intent));
  }

  createIntent(options) {
    const operationId = options.operationId || randomUuid();
    if (!isUuid(operationId)) {
      throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', 'operationId must be a UUID');
    }
    const envelope = options.envelope;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', 'A command envelope is required');
    }
    if (envelope.operation_id !== operationId) {
      throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', 'The envelope operation identifier does not match the intent');
    }
    const payloadHash = options.payloadHash || operationPayloadHash(envelope);
    if (typeof payloadHash !== 'string' || !HASH_RE.test(payloadHash)) {
      throw new IntentJournalError('JOURNAL_VALIDATION_FAILED', 'A valid payload hash is required');
    }

    const existing = this.intents.get(operationId);
    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        throw new IntentJournalError(
          'IDEMPOTENCY_PAYLOAD_CONFLICT',
          'This operation identifier was already recorded with different command content. Keep the original payload and operation identifier.'
        );
      }
      return this._cloneIntent(existing);
    }

    if (options.authorityMode && options.authorityMode !== INTENT_AUTHORITY_MODE) {
      throw new IntentJournalError('LOCAL_INTENT_AUTHORITY_REQUIRED', 'Local intent journals only accept bar_local operations');
    }

    const record = this._record('intent', {
      operation_id: operationId,
      authority_mode: INTENT_AUTHORITY_MODE,
      authority_id: envelope.authority_id || null,
      authority_epoch: envelope.authority_epoch || null,
      business_id: envelope.business_id || null,
      outlet_id: envelope.outlet_id || null,
      device_id: envelope.device_id || null,
      command: envelope.command || null,
      payload_version: envelope.payload_version || null,
      payload_hash: payloadHash,
      envelope,
      state: 'pending'
    });
    this._append(record);
    this.intents.set(operationId, {
      operation_id: operationId,
      journal_id: this.journalId,
      authority_mode: INTENT_AUTHORITY_MODE,
      authority_id: envelope.authority_id || null,
      authority_epoch: envelope.authority_epoch || null,
      business_id: envelope.business_id || null,
      outlet_id: envelope.outlet_id || null,
      device_id: envelope.device_id || null,
      command: envelope.command || null,
      payload_version: envelope.payload_version || null,
      payload_hash: payloadHash,
      envelope,
      state: 'pending',
      attempts: 0,
      created_at: record.recorded_at,
      updated_at: record.recorded_at,
      receipt: null,
      result: null,
      error: null
    });
    return this.getIntent(operationId);
  }

  _transition(operationId, state, fields) {
    const intent = this.intents.get(operationId);
    if (!intent) {
      throw new IntentJournalError('JOURNAL_OPERATION_NOT_FOUND', `Operation ${operationId} is not in the local intent journal`);
    }
    if (TERMINAL_STATES.has(intent.state)) {
      throw new IntentJournalError('JOURNAL_TERMINAL_STATE', `Operation ${operationId} is already ${intent.state}`);
    }
    const allowed = ALLOWED_TRANSITIONS[intent.state];
    if (!allowed || !allowed.has(state)) {
      throw new IntentJournalError('JOURNAL_INVALID_TRANSITION', `Operation ${operationId} cannot move from ${intent.state} to ${state}`);
    }
    const record = this._record('intent_state', {
      operation_id: operationId,
      state,
      attempts: fields && typeof fields.attempts === 'number' ? fields.attempts : intent.attempts,
      ...(fields && fields.receipt !== undefined ? { receipt: fields.receipt } : {}),
      ...(fields && fields.result !== undefined ? { result: fields.result } : {}),
      ...(fields && fields.error !== undefined ? { error: fields.error } : {})
    });
    this._append(record);
    intent.state = state;
    intent.updated_at = record.recorded_at;
    if (fields && typeof fields.attempts === 'number') intent.attempts = fields.attempts;
    if (fields && fields.receipt !== undefined) intent.receipt = fields.receipt;
    if (fields && fields.result !== undefined) intent.result = fields.result;
    if (fields && fields.error !== undefined) intent.error = fields.error;
    return this.getIntent(operationId);
  }

  beginAttempt(operationId) {
    const intent = this.intents.get(operationId);
    if (!intent) {
      throw new IntentJournalError('JOURNAL_OPERATION_NOT_FOUND', `Operation ${operationId} is not in the local intent journal`);
    }
    return this._transition(operationId, 'submitting', { attempts: intent.attempts + 1 });
  }

  markUncertain(operationId, error) {
    const intent = this.intents.get(operationId);
    const attempts = intent ? intent.attempts : 0;
    return this._transition(operationId, 'uncertain', { attempts, error });
  }

  markCommitted(operationId, outcome) {
    const intent = this.intents.get(operationId);
    if (!intent) {
      throw new IntentJournalError('JOURNAL_OPERATION_NOT_FOUND', `Operation ${operationId} is not in the local intent journal`);
    }
    assertCommittedOutcome(intent, outcome);
    return this._transition(operationId, 'committed', {
      receipt: outcome.receipt,
      result: outcome.result === undefined ? null : outcome.result,
      error: null
    });
  }

  markRefused(operationId, error) {
    assertRefusal(error);
    return this._transition(operationId, 'refused', { error });
  }
}

export function classifyLegacyWorkItem(item) {
  if (!item || typeof item !== 'object') {
    return {
      accepted: false,
      code: 'UNRECOGNISED_LEGACY_WORK_FENCED',
      reason: 'This work item has no verifiable legacy or local intent identity.',
      replay_to_local: false,
      requires_manual_review: true
    };
  }
  const mesh = Boolean(item._mesh_imported || item._mesh_source_node_id || item._mesh_imported_at
    || item.transport === 'mesh' || item.origin === 'mesh' || item.source === 'mesh');
  if (mesh) {
    return {
      accepted: false,
      code: 'LEGACY_MESH_QUEUE_FENCED',
      reason: 'Mesh-imported operations are not local Bar authority commands and must not be replayed into the local journal.',
      replay_to_local: false,
      requires_manual_review: true
    };
  }
  if (item.authority_mode === INTENT_AUTHORITY_MODE && item.journal_kind === 'bar_local_intent') {
    return {
      accepted: true,
      code: 'LOCAL_BAR_INTENT',
      reason: 'This is a local Bar intent and may be recovered from its own journal.',
      replay_to_local: true,
      requires_manual_review: false
    };
  }
  if (item.type === 'rpc' || item.functionName || item.table || item.payload !== undefined) {
    return {
      accepted: false,
      code: 'LEGACY_CLOUD_QUEUE_FENCED',
      reason: 'The old cloud/mesh submission queue cannot be replayed into local Bar authority. Resolve it in cloud mode only.',
      replay_to_local: false,
      requires_manual_review: true
    };
  }
  return {
    accepted: false,
    code: 'UNRECOGNISED_LEGACY_WORK_FENCED',
    reason: 'Unrecognised legacy work is fenced rather than guessed into local financial authority.',
    replay_to_local: false,
    requires_manual_review: true
  };
}

export function fenceLegacyWorkItem(item) {
  return { item, ...classifyLegacyWorkItem(item) };
}

export function fenceLegacyWorkItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => fenceLegacyWorkItem(item));
}

export function assertLocalIntent(intent, scope) {
  if (!intent || intent.authority_mode !== INTENT_AUTHORITY_MODE) {
    throw new IntentJournalError('LOCAL_INTENT_AUTHORITY_REQUIRED', 'Only journaled bar_local intents may be replayed against local authority');
  }
  if (!scope) return true;
  const fields = ['authority_id', 'authority_epoch', 'business_id', 'outlet_id', 'device_id'];
  for (const field of fields) {
    if (scope[field] !== undefined && intent[field] !== scope[field]) {
      throw new IntentJournalError('LOCAL_INTENT_SCOPE_MISMATCH', `The local intent does not belong to the commissioned ${field}`);
    }
  }
  return true;
}

export function assertCloudReplayForbidden(intent) {
  if (intent && intent.authority_mode === INTENT_AUTHORITY_MODE) {
    throw new IntentJournalError(
      'LOCAL_INTENT_CLOUD_REPLAY_FORBIDDEN',
      'Local Bar intents must never be replayed to cloud or mesh authority.'
    );
  }
  return true;
}

export function partitionKey(scope) {
  return [
    scope && (scope.authority_mode || INTENT_AUTHORITY_MODE),
    scope && scope.authority_id,
    scope && scope.authority_epoch,
    scope && scope.business_id,
    scope && scope.outlet_id
  ].map((value) => (value === undefined || value === null ? '' : String(value))).join(':');
}
