// @ts-check
import crypto from 'crypto';
import { meshState } from './meshState.js';
import { broadcastToMesh } from './meshClient.js';
import { broadcastSyncStatus } from '../connectivity.js';

/** @typedef {Record<string, unknown> & {lockId: unknown, sourceNodeId: unknown, expiresAt: unknown}} MeshLock */
/** The state initializer leaves this array empty; runtime fills room/tab lock records. */
const meshStateWithLocks = /** @type {Omit<typeof meshState, 'activeLocks'> & {activeLocks: MeshLock[]}} */ (meshState);

// Run lock pruning every 10 seconds to auto-expire stale locks.
const lockPruneInterval = setInterval(pruneExpiredLocks, 10000);
lockPruneInterval.unref?.();

/**
 * Creates an advisory room lock locally and broadcasts it to all P2P peers.
 * Advisory locks expire automatically after 2 minutes.
 * @param {unknown} roomId
 * @param {unknown} startDate
 * @param {unknown} endDate
 */
export async function createLocalLock(roomId, startDate, endDate) {
  if (!meshState.running || !meshState.nodeId) {
    return null;
  }

  const lockId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = new Date(now + 120000).toISOString(); // 2-minute lifespan

  const lock = {
    lockId,
    roomId,
    startDate,
    endDate,
    sourceNodeId: meshState.nodeId,
    createdAt: new Date(now).toISOString(),
    expiresAt
  };

  meshStateWithLocks.activeLocks.push(lock);
  
  // Trigger local UI update
  broadcastSyncStatus();

  // Broadcast to peers in background
  broadcastToMesh('POST', '/mesh/locks', null, lock).catch((err) => {
    console.warn('[MeshLocks] Failed to broadcast lock to mesh:', err.message);
  });

  return lockId;
}

const TAB_LOCK_TTL_MS = 120000; // 2 minutes: covers one settle, never a shift.

/**
 * Advisory tab-settlement lock: one till settling a tab holds it while the
 * other till sees "settling on the other till" instead of charging twice.
 * The server still refuses genuine double settlements; this lock only stops
 * the confusing second attempt. Expires on its own; release on settle done.
 */
/** @param {unknown} tabId @param {unknown} [operatorLabel] */
export async function createTabLock(tabId, operatorLabel = '') {
  const resourceId = String(tabId || '').trim();
  if (!resourceId) return { acquired: false, error: 'A tab reference is required.' };
  const held = meshStateWithLocks.activeLocks.find((lock) =>
    lock.resourceKind === 'pos-tab'
    && String(lock.resourceId || '') === resourceId
    && new Date(lock.expiresAt).getTime() > Date.now()
    && lock.sourceNodeId !== meshState.nodeId,
  );
  if (held) {
    return { acquired: false, held: true, heldBy: held.operator || 'the other till', lockId: held.lockId };
  }
  const now = Date.now();
  const lock = {
    lockId: crypto.randomUUID(),
    resourceKind: 'pos-tab',
    resourceId,
    operator: String(operatorLabel || '').slice(0, 80),
    sourceNodeId: meshState.nodeId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TAB_LOCK_TTL_MS).toISOString(),
  };
  meshStateWithLocks.activeLocks.push(lock);
  broadcastSyncStatus();
  broadcastToMesh('POST', '/mesh/locks', null, lock).catch((err) => {
    console.warn('[MeshLocks] Failed to broadcast tab lock to mesh:', err.message);
  });
  return { acquired: true, lockId: lock.lockId };
}

/** @param {unknown} lockId */
export async function releaseTabLock(lockId) {
  const id = String(lockId || '').trim();
  if (!id) return false;
  const index = meshStateWithLocks.activeLocks.findIndex((l) =>
    l.lockId === id && l.resourceKind === 'pos-tab' && l.sourceNodeId === meshState.nodeId);
  if (index === -1) return false;
  meshStateWithLocks.activeLocks.splice(index, 1);
  broadcastSyncStatus();
  broadcastToMesh('DELETE', `/mesh/locks/${id}`).catch((err) => {
    console.warn(`[MeshLocks] Failed to broadcast release of tab lock ${id}:`, err.message);
  });
  return true;
}

/**
 * Releases a locally held lock and broadcasts the release to all peers.
 */
/** @param {unknown} lockId */
export async function releaseLocalLock(lockId) {
  const index = meshStateWithLocks.activeLocks.findIndex((l) => l.lockId === lockId && l.sourceNodeId === meshState.nodeId);
  if (index !== -1) {
    meshStateWithLocks.activeLocks.splice(index, 1);
    broadcastSyncStatus();

    // Broadcast delete to peers
    broadcastToMesh('DELETE', `/mesh/locks/${lockId}`).catch((err) => {
      console.warn(`[MeshLocks] Failed to broadcast release of lock ${lockId}:`, err.message);
    });
    return true;
  }
  return false;
}

/**
 * Registers an advisory lock received from a remote mesh peer.
 * Room locks keep their shape; tab-settlement locks carry
 * resourceKind/resourceId instead of a room.
 */
/** @param {unknown} lock */
export function registerRemoteLock(lock) {
  const incomingFields = /** @type {Record<string, unknown> | null | undefined} */ (lock);
  const isTabLock = incomingFields?.resourceKind === 'pos-tab' && String(incomingFields?.resourceId || '').trim() !== '';
  if (!lock || !incomingFields?.lockId || !incomingFields.sourceNodeId) {
    return false;
  }
  const fields = /** @type {Record<string, unknown>} */ (lock);
  if (!isTabLock && !fields.roomId) {
    return false;
  }

  // Deduplicate: remove existing lock with same ID if present
  meshStateWithLocks.activeLocks = meshStateWithLocks.activeLocks.filter((l) => l.lockId !== fields.lockId);

  // Schema verification and sanity bounds
  const expiresTime = new Date(fields.expiresAt).getTime();
  if (isNaN(expiresTime) || expiresTime <= Date.now()) {
    return false; // Already expired or invalid date format
  }

  meshStateWithLocks.activeLocks.push(isTabLock ? {
    lockId: fields.lockId,
    resourceKind: 'pos-tab',
    resourceId: String(fields.resourceId),
    operator: String(fields.operator || '').slice(0, 80),
    sourceNodeId: fields.sourceNodeId,
    createdAt: fields.createdAt,
    expiresAt: fields.expiresAt
  } : {
    lockId: fields.lockId,
    roomId: fields.roomId,
    startDate: fields.startDate,
    endDate: fields.endDate,
    sourceNodeId: fields.sourceNodeId,
    createdAt: fields.createdAt,
    expiresAt: fields.expiresAt
  });

  broadcastSyncStatus();
  return true;
}

/**
 * Releases an advisory lock registered from a remote peer.
 */
/** @param {unknown} lockId */
export function releaseRemoteLock(lockId) {
  const initialLength = meshStateWithLocks.activeLocks.length;
  meshStateWithLocks.activeLocks = meshStateWithLocks.activeLocks.filter((l) => l.lockId !== lockId);
  
  if (meshStateWithLocks.activeLocks.length !== initialLength) {
    broadcastSyncStatus();
    return true;
  }
  return false;
}

/**
 * Periodically prunes expired locks from memory.
 */
export function pruneExpiredLocks() {
  const now = Date.now();
  const initialLength = meshStateWithLocks.activeLocks.length;
  
  meshStateWithLocks.activeLocks = meshStateWithLocks.activeLocks.filter((lock) => {
    const expiresTime = new Date(lock.expiresAt).getTime();
    return !isNaN(expiresTime) && expiresTime > now;
  });

  if (meshStateWithLocks.activeLocks.length !== initialLength) {
    console.log(`[MeshLocks] Pruned ${initialLength - meshStateWithLocks.activeLocks.length} expired lock(s).`);
    broadcastSyncStatus();
  }
}
