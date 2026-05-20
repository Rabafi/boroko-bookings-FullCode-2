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
 */
export function registerRemoteLock(lock) {
  if (!lock || !lock.lockId || !lock.roomId || !lock.sourceNodeId) {
    return false;
  }

  // Deduplicate: remove existing lock with same ID if present
  meshState.activeLocks = meshState.activeLocks.filter((l) => l.lockId !== lock.lockId);

  // Schema verification and sanity bounds
  const expiresTime = new Date(lock.expiresAt).getTime();
  if (isNaN(expiresTime) || expiresTime <= Date.now()) {
    return false; // Already expired or invalid date format
  }

  meshState.activeLocks.push({
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
