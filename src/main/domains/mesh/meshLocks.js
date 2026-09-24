import crypto from 'crypto';
import { meshState } from './meshState.js';
import { broadcastToMesh } from './meshClient.js';
import { broadcastSyncStatus } from '../connectivity.js';

// Run lock pruning every 10 seconds to auto-expire stale locks.
const lockPruneInterval = setInterval(pruneExpiredLocks, 10000);
lockPruneInterval.unref?.();

/**
 * Creates an advisory room lock locally and broadcasts it to all P2P peers.
 * Advisory locks expire automatically after 2 minutes.
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

  meshState.activeLocks.push(lock);
  
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
export async function createTabLock(tabId, operatorLabel = '') {
  const resourceId = String(tabId || '').trim();
  if (!resourceId) return { acquired: false, error: 'A tab reference is required.' };
  const held = meshState.activeLocks.find((lock) =>
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
  meshState.activeLocks.push(lock);
  broadcastSyncStatus();
  broadcastToMesh('POST', '/mesh/locks', null, lock).catch((err) => {
    console.warn('[MeshLocks] Failed to broadcast tab lock to mesh:', err.message);
  });
  return { acquired: true, lockId: lock.lockId };
}

export async function releaseTabLock(lockId) {
  const id = String(lockId || '').trim();
  if (!id) return false;
  const index = meshState.activeLocks.findIndex((l) =>
    l.lockId === id && l.resourceKind === 'pos-tab' && l.sourceNodeId === meshState.nodeId);
  if (index === -1) return false;
  meshState.activeLocks.splice(index, 1);
  broadcastSyncStatus();
  broadcastToMesh('DELETE', `/mesh/locks/${id}`).catch((err) => {
    console.warn(`[MeshLocks] Failed to broadcast release of tab lock ${id}:`, err.message);
  });
  return true;
}

/**
 * Releases a locally held lock and broadcasts the release to all peers.
 */
export async function releaseLocalLock(lockId) {
  const index = meshState.activeLocks.findIndex((l) => l.lockId === lockId && l.sourceNodeId === meshState.nodeId);
  if (index !== -1) {
    meshState.activeLocks.splice(index, 1);
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
export function registerRemoteLock(lock) {
  const isTabLock = lock?.resourceKind === 'pos-tab' && String(lock?.resourceId || '').trim() !== '';
  if (!lock || !lock.lockId || !lock.sourceNodeId) {
    return false;
  }
  if (!isTabLock && !lock.roomId) {
    return false;
  }

  // Deduplicate: remove existing lock with same ID if present
  meshState.activeLocks = meshState.activeLocks.filter((l) => l.lockId !== lock.lockId);

  // Schema verification and sanity bounds
  const expiresTime = new Date(lock.expiresAt).getTime();
  if (isNaN(expiresTime) || expiresTime <= Date.now()) {
    return false; // Already expired or invalid date format
  }

  meshState.activeLocks.push(isTabLock ? {
    lockId: lock.lockId,
    resourceKind: 'pos-tab',
    resourceId: String(lock.resourceId),
    operator: String(lock.operator || '').slice(0, 80),
    sourceNodeId: lock.sourceNodeId,
    createdAt: lock.createdAt,
    expiresAt: lock.expiresAt
  } : {
    lockId: lock.lockId,
    roomId: lock.roomId,
    startDate: lock.startDate,
    endDate: lock.endDate,
    sourceNodeId: lock.sourceNodeId,
    createdAt: lock.createdAt,
    expiresAt: lock.expiresAt
  });

  broadcastSyncStatus();
  return true;
}

/**
 * Releases an advisory lock registered from a remote peer.
 */
export function releaseRemoteLock(lockId) {
  const initialLength = meshState.activeLocks.length;
  meshState.activeLocks = meshState.activeLocks.filter((l) => l.lockId !== lockId);
  
  if (meshState.activeLocks.length !== initialLength) {
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
  const initialLength = meshState.activeLocks.length;
  
  meshState.activeLocks = meshState.activeLocks.filter((lock) => {
    const expiresTime = new Date(lock.expiresAt).getTime();
    return !isNaN(expiresTime) && expiresTime > now;
  });

  if (meshState.activeLocks.length !== initialLength) {
    console.log(`[MeshLocks] Pruned ${initialLength - meshState.activeLocks.length} expired lock(s).`);
    broadcastSyncStatus();
  }
}
