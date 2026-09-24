import { readCache, writeCache } from '../cacheStore.js';
import { meshState } from './meshState.js';

// Visible-only team state sharing between tills. This is NOT the replay
// queue: rows merged here are never executed, only seen. The origin till
// remains the sole replayer of its own PIN-bound operations.
//
// The hard rule: secrets never leave the building till. Sanitization happens
// here, at snapshot build time on the SOURCE device — receivers additionally
// refuse anything that smells like credential material, so a compromised
// peer cannot smuggle PINs into another till's views.

const SECRET_KEY_PATTERN = /^(pin|password|passwd|secret|token|approval_pin|manager_pin|_secure|credential|auth_token|session_nonce)$/i;

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key || '').trim());
}

function sanitizeValue(value, depth = 0) {
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, depth));
  if (!value || typeof value !== 'object') return value;
  const clean = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSecretKey(key)) continue;
    if (entry === true && String(key) === '_secure_queue_secret') continue;
    if (entry && typeof entry === 'object') {
      if (entry._secure_queue_secret === true) continue;
      clean[key] = depth < 2 ? sanitizeValue(entry, depth + 1) : '[redacted]';
      continue;
    }
    clean[key] = entry;
  }
  return clean;
}

function containsSecretMaterial(value, depth = 0) {
  if (Array.isArray(value)) return value.some((entry) => containsSecretMaterial(entry, depth));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, entry]) => {
    if (isSecretKey(key)) return true;
    if (entry === true && String(key) === '_secure_queue_secret') return true;
    if (entry && typeof entry === 'object') {
      if (entry._secure_queue_secret === true) return true;
      return depth < 2 && containsSecretMaterial(entry, depth + 1);
    }
    return false;
  });
}

function recentRows(name, { limit = 200, sinceMs = 7 * 24 * 3600 * 1000 } = {}) {
  const rows = readCache(name);
  if (!Array.isArray(rows)) return [];
  const cutoff = Date.now() - sinceMs;
  return rows
    .filter((row) => row && typeof row === 'object' && row.id)
    .filter((row) => {
      const at = Date.parse(row.updated_at || row.created_at || row.clock_in || row.submitted_at || 0);
      return Number.isNaN(at) || at >= cutoff;
    })
    .slice(0, limit)
    .map((row) => sanitizeValue(row));
}

/**
 * Builds the sanitized team snapshot served to mesh peers. Only
 * presence-and-money-visibility rows: who is in shift, drawer movements and
 * counts, drawer periods, and cash-up submissions — all without PINs.
 */
export function buildTeamStateSnapshot() {
  return {
    version: 1,
    nodeId: meshState.nodeId,
    lodgeId: meshState.lodgeId,
    at: new Date().toISOString(),
    attendance: recentRows('restaurant-shifts', { limit: 100 }),
    cashMovements: recentRows('pos-cash-movements', { limit: 200 }),
    cashCounts: recentRows('pos-cash-counts', { limit: 200 }),
    drawerPeriods: recentRows('pos-drawer-periods', { limit: 50 }),
    cashupSubmissions: recentRows('pos-cashup-submissions', { limit: 100 })
  };
}

const SNAPSHOT_SECTIONS = ['attendance', 'cashMovements', 'cashCounts', 'drawerPeriods', 'cashupSubmissions'];
const SECTION_CACHES = {
  attendance: 'restaurant-shifts',
  cashMovements: 'pos-cash-movements',
  cashCounts: 'pos-cash-counts',
  drawerPeriods: 'pos-drawer-periods',
  cashupSubmissions: 'pos-cashup-submissions'
};

export function validateTeamStateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return { isValid: false, reason: 'Snapshot is not an object' };
  if (snapshot.version !== 1) return { isValid: false, reason: 'Unsupported team snapshot version' };
  for (const section of SNAPSHOT_SECTIONS) {
    const rows = snapshot[section];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || rows.length > 500) return { isValid: false, reason: `${section} must be a bounded list` };
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !row.id) return { isValid: false, reason: `${section} contains an unidentifiable row` };
      if (containsSecretMaterial(row)) return { isValid: false, reason: `${section} carries credential material and is refused` };
    }
  }
  return { isValid: true };
}

/**
 * Additive-only merge: fills rows this till is missing, never overwrites
 * rows it already has (each device owns its rows; the server reconciles at
 * replay). Returns counts per section for diagnostics.
 */
export function applyTeamStateSnapshot(peerNodeId, snapshot) {
  const validation = validateTeamStateSnapshot(snapshot);
  if (!validation.isValid) return { applied: false, reason: validation.reason, added: {} };
  const added = {};
  const now = new Date().toISOString();
  for (const section of SNAPSHOT_SECTIONS) {
    const rows = Array.isArray(snapshot[section]) ? snapshot[section] : [];
    if (rows.length === 0) continue;
    const cacheName = SECTION_CACHES[section];
    const existing = readCache(cacheName);
    if (!Array.isArray(existing)) continue;
    const known = new Set(existing.map((row) => String(row?.id || '')));
    const fresh = rows.filter((row) => !known.has(String(row?.id || '')));
    if (fresh.length === 0) continue;
    writeCache(cacheName, [
      ...fresh.map((row) => ({
        ...row,
        _pending_sync: true,
        _sync_state: row._sync_state || 'pending',
        _mesh_imported: true,
        _mesh_source_node_id: peerNodeId || null,
        _mesh_state_at: now
      })),
      ...existing
    ]);
    added[section] = fresh.length;
  }
  return { applied: true, added };
}
