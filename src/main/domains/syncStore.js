import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { state } from '../state.js';

const SYNC_META_FILE = 'sync-meta.json';
const HEALTH_FAULTS_FILE = 'health-faults.json';
const OFFLINE_OPERATION_LOG_FILE = 'offline-operation-log.jsonl';
const OFFLINE_MODE_FILE = 'lodge-offline-mode.json';
export const SYNC_DRIFT_FAULT_TYPES = ['customer_drift', 'room_drift', 'quotation_drift', 'pos_drift'];
const HEALTH_FAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const HEALTH_FAULT_MAX_MESSAGE_LENGTH = 1200;
const HEALTH_FAULT_MAX_STRING_LENGTH = 500;
const HEALTH_FAULT_MAX_KEYS = 40;
const HEALTH_FAULT_MAX_ARRAY_ITEMS = 20;
const HEALTH_FAULT_MAX_DEPTH = 4;
const HEALTH_FAULT_SENSITIVE_KEY_PATTERN = /(password|passphrase|token|secret|authorization|api[-_]?key|private[-_]?key|credential|cookie|nonce|pin|hash)/i;

function requireCacheDir(label = 'local sync store') {
  if (!state.cacheDir) {
    throw new Error(`${label} failed: cache directory is not initialized`);
  }
  return state.cacheDir;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashObject(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function redactHealthFaultText(value, maxLength = HEALTH_FAULT_MAX_STRING_LENGTH) {
  const text = String(value ?? '');
  const redacted = text
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:password|passphrase|token|secret|authorization|api[-_]?key|private[-_]?key|credential|cookie|nonce|pin|hash)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

function sanitizeHealthFaultValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactHealthFaultText(value);
  if (depth >= HEALTH_FAULT_MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, HEALTH_FAULT_MAX_ARRAY_ITEMS)
      .map((entry) => sanitizeHealthFaultValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort().slice(0, HEALTH_FAULT_MAX_KEYS)) {
      output[key] = HEALTH_FAULT_SENSITIVE_KEY_PATTERN.test(key)
        ? '[REDACTED]'
        : sanitizeHealthFaultValue(value[key], depth + 1);
    }
    return output;
  }
  return redactHealthFaultText(value);
}

function buildHealthFaultFingerprint(entry) {
  return hashObject({
    type: redactHealthFaultText(entry.type, 160),
    scope: redactHealthFaultText(entry.scope, 160),
    severity: entry.severity === 'error' ? 'error' : 'warn',
    message: redactHealthFaultText(entry.message, HEALTH_FAULT_MAX_MESSAGE_LENGTH),
    context: sanitizeHealthFaultValue(entry.context || {})
  });
}

function getQueueIntentId(item = {}) {
  return String(
    item.intentId ||
    item.data?.p_idempotency_key ||
    item.data?.payload?.create_idempotency_key ||
    item.data?.payload?.idempotency_key ||
    item.data?.payload?.return_idempotency_key ||
    item.data?.payload?.cashup_id ||
    item._queue_id ||
    ''
  ).trim();
}

function redactSecureQueueSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecureQueueSecrets);
  if (!value || typeof value !== 'object') return value;
  if (value._secure_queue_secret === true) {
    return {
      _secure_queue_secret: true,
      encrypted: value.encrypted === true,
      redacted: true
    };
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactSecureQueueSecrets(entry)])
  );
}

function appendJsonLineDurable(filePath, entry) {
  const line = `${JSON.stringify(entry)}\n`;
  const fd = fs.openSync(filePath, 'a');
  try {
    fs.writeFileSync(fd, line, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function quarantineBadJsonFile(filePath, reason = 'corrupt JSON') {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const quarantinePath = `${filePath}.corrupt.${Date.now()}.bak`;
  try {
    fs.renameSync(filePath, quarantinePath);
    console.warn(`[Sync Queue] Quarantined ${path.basename(filePath)} -> ${path.basename(quarantinePath)} (${reason})`);
    return quarantinePath;
  } catch (error) {
    console.error('[Sync Queue] Failed to quarantine corrupt file:', error);
    return null;
  }
}

function replaceFileSync(tmpPath, filePath, label = 'file') {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (renameError) {
      lastError = renameError;
      try {
        fs.copyFileSync(tmpPath, filePath);
        const destinationFd = fs.openSync(filePath, 'r');
        try {
          fs.fsyncSync(destinationFd);
        } finally {
          fs.closeSync(destinationFd);
        }
        try {fs.unlinkSync(tmpPath);} catch {/* keep recovery copy if unlink is blocked */}
        return;
      } catch (copyError) {
        lastError = copyError;
      }
    }
  }
  throw new Error(`${label} replace failed: ${lastError?.message || 'unknown error'}`);
}

function writeJsonFileDurable(filePath, value, label) {
  const tmpPath = filePath + '.tmp';
  const serialized = JSON.stringify(value, null, 2);
  const tmpFd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(tmpFd, serialized, 'utf-8');
    fs.fsyncSync(tmpFd);
  } finally {
    fs.closeSync(tmpFd);
  }
  replaceFileSync(tmpPath, filePath, label);
}

function normalizeQueueRows(parsed, scope = 'sync-queue') {
  const rows = Array.isArray(parsed) ?
  parsed :
  Array.isArray(parsed?.queue) ?
  parsed.queue :
  Array.isArray(parsed?.items) ?
  parsed.items :
  Array.isArray(parsed?.pending) ?
  parsed.pending :
  null;

  if (!rows) {
    appendHealthFault({
      type: 'queue_corrupt',
      scope,
      message: `${scope}.json contained non-array JSON and was treated as empty.`,
      at: new Date().toISOString()
    });
    return [];
  }

  const validRows = rows.filter((item) => item && typeof item === 'object');
  if (validRows.length !== rows.length) {
    appendHealthFault({
      type: 'queue_corrupt',
      scope,
      message: `${scope}.json contained ${rows.length - validRows.length} malformed item(s); malformed entries were ignored.`,
      at: new Date().toISOString()
    });
  }
  return validRows;
}

export function appendOperationJournalEntry(event, item = {}, extra = {}) {
  if (!state.cacheDir) return null;
  const now = new Date().toISOString();
  const queueItem = item && typeof item === 'object' ? item : {};
  const entry = {
    schemaVersion: 1,
    event: String(event || 'unknown'),
    at: now,
    lodge_id: extra.lodge_id || queueItem.data?.p_lodge_id || queueItem.data?.payload?.lodge_id || queueItem.lodge_id || state.lodgeId || null,
    queue_id: queueItem._queue_id || null,
    operation: queueItem.table || null,
    type: queueItem.type || null,
    intent_id: getQueueIntentId(queueItem) || null,
    payload_hash: hashObject({
      type: queueItem.type || null,
      table: queueItem.table || null,
      data: queueItem.data || null,
      id: queueItem.id || null
    }),
    dependency: queueItem._depends_on || null,
    source_node_id: queueItem._mesh_source_node_id || extra.source_node_id || null,
    imported_from_mesh: queueItem._mesh_imported === true || extra.imported_from_mesh === true,
    financial: extra.financial === true,
    state: queueItem._state || extra.state || null,
    retryCount: Number(queueItem.retryCount || 0),
    message: extra.message || queueItem.lastError || '',
    snapshot: extra.includeSnapshot === false ? undefined : redactSecureQueueSecrets(queueItem)
  };
  try {
    appendJsonLineDurable(path.join(state.cacheDir, OFFLINE_OPERATION_LOG_FILE), entry);
    return entry;
  } catch (error) {
    appendHealthFault({
      type: 'operation_journal_write_failed',
      scope: 'offline-operation-log',
      severity: 'error',
      message: `Local operation journal could not be written. Error: ${error.message}`,
      at: now
    });
    return null;
  }
}

export function readOperationJournal({ limit = 500 } = {}) {
  if (!state.cacheDir) return [];
  const filePath = path.join(state.cacheDir, OFFLINE_OPERATION_LOG_FILE);
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
    const selected = Number.isFinite(Number(limit)) && Number(limit) > 0 ? lines.slice(-Number(limit)) : lines;
    return selected.map((line) => JSON.parse(line)).filter((entry) => entry && typeof entry === 'object');
  } catch (error) {
    if (fs.existsSync(filePath)) {
      appendHealthFault({
        type: 'operation_journal_read_failed',
        scope: 'offline-operation-log',
        severity: 'warn',
        message: `Local operation journal could not be read. Error: ${error.message}`,
        at: new Date().toISOString()
      });
    }
    return [];
  }
}

export function getOperationJournalSummary() {
  const entries = readOperationJournal({ limit: 0 });
  const byEvent = {};
  const byOperation = {};
  let oldestAt = null;
  let newestAt = null;
  for (const entry of entries) {
    byEvent[entry.event] = (byEvent[entry.event] || 0) + 1;
    if (entry.operation) byOperation[entry.operation] = (byOperation[entry.operation] || 0) + 1;
    if (entry.at && (!oldestAt || Date.parse(entry.at) < Date.parse(oldestAt))) oldestAt = entry.at;
    if (entry.at && (!newestAt || Date.parse(entry.at) > Date.parse(newestAt))) newestAt = entry.at;
  }
  return {
    total: entries.length,
    oldestAt,
    newestAt,
    byEvent,
    byOperation,
    file: state.cacheDir ? path.join(state.cacheDir, OFFLINE_OPERATION_LOG_FILE) : null
  };
}

export function readOfflineModeState() {
  if (!state.cacheDir) {
    return {
      enabled: false,
      reason: '',
      startedAt: null,
      endedAt: null,
      acknowledgedRisksAt: null,
      lastBackupAt: null,
      lastBackupPath: null
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(state.cacheDir, OFFLINE_MODE_FILE), 'utf-8'));
    return {
      enabled: parsed?.enabled === true,
      reason: String(parsed?.reason || ''),
      startedAt: parsed?.startedAt || null,
      endedAt: parsed?.endedAt || null,
      acknowledgedRisksAt: parsed?.acknowledgedRisksAt || null,
      lastBackupAt: parsed?.lastBackupAt || null,
      lastBackupPath: parsed?.lastBackupPath || null,
      updatedAt: parsed?.updatedAt || null,
      updatedBy: parsed?.updatedBy || null
    };
  } catch {
    return {
      enabled: false,
      reason: '',
      startedAt: null,
      endedAt: null,
      acknowledgedRisksAt: null,
      lastBackupAt: null,
      lastBackupPath: null
    };
  }
}

export function writeOfflineModeState(updates = {}) {
  const cacheDir = requireCacheDir('Offline mode state write');
  const current = readOfflineModeState();
  const now = new Date().toISOString();
  const enabling = updates.enabled === true;
  const disabling = updates.enabled === false;
  const restartingOfflineWindow = enabling && current.enabled !== true;
  const next = {
    ...current,
    ...updates,
    enabled: enabling ? true : disabling ? false : current.enabled,
    startedAt: enabling ? (restartingOfflineWindow ? now : current.startedAt || now) : current.startedAt,
    endedAt: disabling ? now : enabling ? null : current.endedAt,
    acknowledgedRisksAt: enabling ? (updates.acknowledgedRisksAt || now) : current.acknowledgedRisksAt,
    updatedAt: now
  };
  writeJsonFileDurable(path.join(cacheDir, OFFLINE_MODE_FILE), next, 'offline mode state');
  return next;
}

export function noteOfflineOperationsBackup(pathname) {
  const current = readOfflineModeState();
  return writeOfflineModeState({
    lastBackupAt: new Date().toISOString(),
    lastBackupPath: pathname || current.lastBackupPath || null
  });
}

export function buildLocalOperationsBundle(extra = {}) {
  const queue = readSyncQueue();
  const failed = readFailedSyncQueue();
  const journal = readOperationJournal({ limit: 0 });
  const syncMeta = readSyncMeta();
  const healthFaults = readHealthFaults();
  let cacheFreshness = {};
  try {
    cacheFreshness = JSON.parse(fs.readFileSync(path.join(state.cacheDir, 'cache-freshness.json'), 'utf-8')) || {};
  } catch {}
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    lodge_id: state.lodgeId || null,
    cacheDir: state.cacheDir || null,
    offlineMode: readOfflineModeState(),
    syncMeta,
    cacheFreshness,
    healthFaults,
    operationJournalSummary: getOperationJournalSummary(),
    pendingQueue: queue.map(redactSecureQueueSecrets),
    failedQueue: failed.map(redactSecureQueueSecrets),
    operationJournal: journal,
    ...extra
  };
}

export function writeLocalOperationsBundle(filePath, extra = {}) {
  if (!filePath) throw new Error('No export path was selected.');
  const bundle = buildLocalOperationsBundle(extra);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeJsonFileDurable(filePath, bundle, 'offline operations export');
  noteOfflineOperationsBackup(filePath);
  return {
    success: true,
    path: filePath,
    pending: bundle.pendingQueue.length,
    failed: bundle.failedQueue.length,
    journalEntries: bundle.operationJournal.length
  };
}

export function readSyncQueue() {
  if (!state.cacheDir) return [];
  const filePath = path.join(state.cacheDir, 'sync-queue.json');
  const tmpPath = filePath + '.tmp';
  // Crash recovery: if a .tmp file exists, it was written atomically just before
  // a crash-interrupted renameSync. Prefer it — it may contain queued financial
  // operations (payments, bookings) that would otherwise be lost permanently.
  if (fs.existsSync(tmpPath)) {
    let tmpData;
    try {
      tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
    } catch (error) {
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-queue',
        message: `sync-queue.json.tmp could not be parsed and was discarded. Error: ${error.message}`,
        at: new Date().toISOString()
      });
      try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
    }
    if (tmpData !== undefined) {
      try {
      replaceFileSync(tmpPath, filePath, 'sync-queue crash recovery');
      console.warn('[Sync Queue] Crash-recovery: promoted sync-queue.tmp to main file');
      return normalizeQueueRows(tmpData, 'sync-queue');
      } catch (error) {
        appendHealthFault({
          type: 'queue_write_failed',
          scope: 'sync-queue',
          severity: 'error',
          message: `sync-queue.json.tmp is valid but could not be promoted. The recovery copy was kept. Error: ${error.message}`,
          at: new Date().toISOString()
        });
        return normalizeQueueRows(tmpData, 'sync-queue');
      }
    }
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return normalizeQueueRows(JSON.parse(data), 'sync-queue');
  } catch (e) {
    if (fs.existsSync(filePath)) {
      console.warn('[Sync Queue] Parse failed — returning []. Error:', e.message);
      const quarantinePath = quarantineBadJsonFile(filePath, e.message);
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-queue',
        message: `sync-queue.json could not be parsed and was quarantined. Queued operations need manual recovery from ${quarantinePath || 'the corrupt queue backup'}. Error: ${e.message}`,
        at: new Date().toISOString()
      });
      writeSyncQueue([]);
    }
    return [];
  }
}

export function writeSyncQueue(queue) {
  if (!state.cacheDir) {
    throw new Error('Sync queue write failed: cache directory is not initialized');
  }
  const filePath = path.join(state.cacheDir, 'sync-queue.json');
  try {
    writeJsonFileDurable(filePath, Array.isArray(queue) ? queue : [], 'sync queue');
  } catch (e) {
    console.error('Sync queue write failed:', e);
    throw new Error(`Sync queue write failed: ${e.message}`, { cause: e });
  }
}

export function readFailedSyncQueue() {
  if (!state.cacheDir) return [];
  const filePath = path.join(state.cacheDir, 'sync-failed.json');
  const tmpPath = filePath + '.tmp';
  if (fs.existsSync(tmpPath)) {
    let tmpData;
    try {
      tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
    } catch (error) {
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-failed',
        message: `sync-failed.json.tmp could not be parsed and was discarded. Error: ${error.message}`,
        at: new Date().toISOString()
      });
      try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
    }
    if (tmpData !== undefined) {
      try {
      replaceFileSync(tmpPath, filePath, 'sync-failed crash recovery');
      console.warn('[Sync Queue] Crash-recovery: promoted sync-failed.tmp to main file');
      return normalizeQueueRows(tmpData, 'sync-failed');
      } catch (error) {
        appendHealthFault({
          type: 'queue_write_failed',
          scope: 'sync-failed',
          severity: 'error',
          message: `sync-failed.json.tmp is valid but could not be promoted. The recovery copy was kept. Error: ${error.message}`,
          at: new Date().toISOString()
        });
        return normalizeQueueRows(tmpData, 'sync-failed');
      }
    }
  }

  try {
    return normalizeQueueRows(JSON.parse(fs.readFileSync(filePath, 'utf-8')), 'sync-failed');
  } catch (e) {
    if (fs.existsSync(filePath)) {
      const quarantinePath = quarantineBadJsonFile(filePath, e.message);
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-failed',
        message: `sync-failed.json could not be parsed and was quarantined. Dead-lettered operations need manual recovery from ${quarantinePath || 'the corrupt failed-queue backup'}. Error: ${e.message}`,
        at: new Date().toISOString()
      });
      writeFailedSyncQueue([]);
    }
    return [];
  }
}

export function writeFailedSyncQueue(items) {
  if (!state.cacheDir) {
    throw new Error('Failed sync queue write failed: cache directory is not initialized');
  }
  const filePath = path.join(state.cacheDir, 'sync-failed.json');
  try {
    writeJsonFileDurable(filePath, Array.isArray(items) ? items : [], 'sync failed queue');
  } catch (e) {
    console.error('[Sync] Failed-queue write failed:', e);
    throw new Error(`Failed sync queue write failed: ${e.message}`, { cause: e });
  }
}

export function readSyncMeta() {
  if (!state.cacheDir) return {};
  try {
    const raw = fs.readFileSync(path.join(state.cacheDir, SYNC_META_FILE), 'utf-8');
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

export function writeSyncMeta(updates = {}) {
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, SYNC_META_FILE);
  try {
    const current = readSyncMeta();
    const next = { ...current, ...updates };
    writeJsonFileDurable(filePath, next, 'sync meta');
  } catch (e) {
    console.error('[Sync Meta] Write failed:', e);
  }
}

export function appendHealthFault(fault = {}) {
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, HEALTH_FAULTS_FILE);
  try {
    let existing = [];
    try {existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));} catch {/* start fresh */}
    if (!Array.isArray(existing)) existing = [];
    const safeType = redactHealthFaultText(fault.type || 'unknown', 160);
    const safeScope = redactHealthFaultText(fault.scope || 'unknown', 160);
    const safeSeverity = fault.severity === 'error' ? 'error' : 'warn';
    const safeMessage = redactHealthFaultText(
      fault.message || 'An integrity fault was detected.',
      HEALTH_FAULT_MAX_MESSAGE_LENGTH
    );
    const safeContext = fault.context && typeof fault.context === 'object'
      ? sanitizeHealthFaultValue(fault.context)
      : {};
    const suppliedAt = typeof fault.at === 'string' && fault.at.length <= 80 ? fault.at : null;
    const entry = {
      id: randomUUID(),
      type: safeType,
      scope: safeScope,
      severity: safeSeverity,
      message: safeMessage,
      at: suppliedAt || new Date().toISOString(),
      context: safeContext,
      fingerprint: buildHealthFaultFingerprint({
        type: safeType,
        scope: safeScope,
        severity: safeSeverity,
        message: safeMessage,
        context: safeContext
      })
    };
    // Deduplicate only exact fingerprints within ten minutes. A changed
    // message/context for the same type and scope is a distinct incident.
    const now = Date.now();
    const isDuplicate = existing.some((e) => {
      const at = Date.parse(e?.at || '');
      if (!Number.isFinite(at) || now - at < 0 || now - at >= HEALTH_FAULT_DEDUPE_WINDOW_MS) return false;
      const fingerprint = e?.fingerprint || buildHealthFaultFingerprint(e);
      return fingerprint === entry.fingerprint;
    });
    if (isDuplicate) return;
    const next = [entry, ...existing].slice(0, 50);
    writeJsonFileDurable(filePath, next, 'health faults');
    console.error('[Health Fault]', entry);
  } catch (e) {
    console.error('[Health Fault] Write failed:', e);
  }
}

function isBenignBookingDriftFault(fault = {}) {
  if (fault?.type !== 'booking_drift') return false;
  const drifts = Array.isArray(fault?.context?.drifts) ?
  fault.context.drifts :
  String(fault?.message || '').split(';').map((entry) => entry.trim()).filter(Boolean);
  if (drifts.length === 0) return false;
  return drifts.every((entry) =>
  /^(customer_id|room_id): local (undefined|null|) ?→ server [0-9a-f-]+$/i.test(String(entry || '').trim())
  );
}

export function readHealthFaults() {
  if (!state.cacheDir) return [];
  const filePath = path.join(state.cacheDir, HEALTH_FAULTS_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    const next = parsed.filter((fault) => !isBenignBookingDriftFault(fault));
    if (next.length !== parsed.length) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8');
      } catch (writeError) {
        console.warn('[Health Fault] Could not prune benign booking drift faults:', writeError?.message || writeError);
      }
    }
    return next;
  } catch {
    return [];
  }
}
