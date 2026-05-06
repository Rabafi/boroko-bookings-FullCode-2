import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { state } from '../state.js';

const SYNC_META_FILE = 'sync-meta.json';
const HEALTH_FAULTS_FILE = 'health-faults.json';
export const SYNC_DRIFT_FAULT_TYPES = ['customer_drift', 'room_drift', 'quotation_drift', 'pos_drift'];

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

export function readSyncQueue() {
  if (!state.cacheDir) return [];
  const filePath = path.join(state.cacheDir, 'sync-queue.json');
  const tmpPath = filePath + '.tmp';
  // Crash recovery: if a .tmp file exists, it was written atomically just before
  // a crash-interrupted renameSync. Prefer it — it may contain queued financial
  // operations (payments, bookings) that would otherwise be lost permanently.
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
      fs.renameSync(tmpPath, filePath);
      console.warn('[Sync Queue] Crash-recovery: promoted sync-queue.tmp to main file');
      return normalizeQueueRows(tmpData, 'sync-queue');
    } catch (error) {
      // .tmp is corrupt — discard it and fall through to main file
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-queue',
        message: `sync-queue.json.tmp could not be parsed and was discarded. Error: ${error.message}`,
        at: new Date().toISOString()
      });
      try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
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
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, 'sync-queue.json');
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(Array.isArray(queue) ? queue : [], null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error('Sync queue write failed:', e);
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
  }
}

export function readFailedSyncQueue() {
  if (!state.cacheDir) return [];
  const filePath = path.join(state.cacheDir, 'sync-failed.json');
  const tmpPath = filePath + '.tmp';
  if (fs.existsSync(tmpPath)) {
    try {
      const tmpData = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
      fs.renameSync(tmpPath, filePath);
      console.warn('[Sync Queue] Crash-recovery: promoted sync-failed.tmp to main file');
      return normalizeQueueRows(tmpData, 'sync-failed');
    } catch (error) {
      appendHealthFault({
        type: 'queue_corrupt',
        scope: 'sync-failed',
        message: `sync-failed.json.tmp could not be parsed and was discarded. Error: ${error.message}`,
        at: new Date().toISOString()
      });
      try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
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
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, 'sync-failed.json');
  const tmpPath = filePath + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(Array.isArray(items) ? items : [], null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error('[Sync] Failed-queue write failed:', e);
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
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
  const tmpPath = filePath + '.tmp';
  try {
    const current = readSyncMeta();
    const next = { ...current, ...updates };
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    console.error('[Sync Meta] Write failed:', e);
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
  }
}

export function appendHealthFault(fault = {}) {
  if (!state.cacheDir) return;
  const filePath = path.join(state.cacheDir, HEALTH_FAULTS_FILE);
  const tmpPath = filePath + '.tmp';
  try {
    let existing = [];
    try {existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));} catch {/* start fresh */}
    if (!Array.isArray(existing)) existing = [];
    const entry = {
      id: randomUUID(),
      type: fault.type || 'unknown',
      scope: fault.scope || 'unknown',
      severity: fault.severity || 'warn',
      message: fault.message || 'An integrity fault was detected.',
      at: fault.at || new Date().toISOString(),
      ...(fault.context && typeof fault.context === 'object' ? { context: fault.context } : {})
    };
    // Deduplicate: don't append a fault with the same type+scope within 10 minutes
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const isDuplicate = existing.some(
      (e) => e.type === entry.type && e.scope === entry.scope && Date.parse(e.at) > tenMinutesAgo
    );
    if (isDuplicate) return;
    const next = [entry, ...existing].slice(0, 50);
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
    console.error('[Health Fault]', entry);
  } catch (e) {
    console.error('[Health Fault] Write failed:', e);
    try {fs.unlinkSync(tmpPath);} catch {/* ignore */}
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
