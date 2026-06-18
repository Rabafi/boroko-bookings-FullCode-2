import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { state } from '../../state.js';
import { broadcastSyncStatus } from '../connectivity.js';

export const meshState = {
  enabled: false,
  running: false,
  nodeId: null,
  lodgeId: null,
  lodgeMeshSecret: null,
  httpPort: null,
  peers: new Map(), // nodeId -> peer object { nodeId, address, httpPort, lastSeenAt, clockOffsetMs }
  activeLocks: [], // local and remote locks { lockId, roomId, startDate, endDate, sourceNodeId, createdAt, expiresAt }
  lastError: null,
  server: null, // HTTP server instance
  discoverySocket: null, // UDP Socket
  serverNonceCache: new Set(), // Received nonces (HMAC replay protection)
  lastQueueMergeAt: null
};

/**
 * Returns a stable local nodeId per profile, persisted in the profile cache directory.
 */
export function getOrCreateLocalNodeId() {
  if (meshState.nodeId) {
    return meshState.nodeId;
  }

  const cacheDir = state.cacheDir;
  if (!cacheDir) {
    throw new Error('[MeshState] Cache directory not initialized in global state.');
  }

  const identityPath = path.join(cacheDir, 'mesh-identity.json');
  try {
    if (fs.existsSync(identityPath)) {
      const data = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
      if (data && data.nodeId) {
        meshState.nodeId = data.nodeId;
        return data.nodeId;
      }
    }
  } catch (err) {
    console.error('[MeshState] Error reading P2P mesh identity file:', err);
  }

  // Generate new stable node ID
  const nodeId = crypto.randomUUID();
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(identityPath, JSON.stringify({
      nodeId,
      createdAt: new Date().toISOString()
    }, null, 2), 'utf8');
    meshState.nodeId = nodeId;
    console.log('[MeshState] Generated new stable nodeId:', nodeId);
    return nodeId;
  } catch (err) {
    console.error('[MeshState] Failed to persist stable nodeId:', err);
    // Fallback in-memory
    meshState.nodeId = nodeId;
    return nodeId;
  }
}

/**
 * Exposes a clean health snapshot of the P2P mesh.
 */
export function getMeshHealthSnapshot() {
  const peersArray = [];
  const now = Date.now();
  
  // Beacons are sent every 30 seconds. Keep peers long enough to survive one
  // missed beacon without making the UI and queue exchange flap.
  for (const [peerId, peer] of meshState.peers.entries()) {
    if (now - new Date(peer.lastSeenAt).getTime() > 75000) {
      meshState.peers.delete(peerId);
      console.log(`[MeshState] Expired inactive peer: ${peerId}`);
    } else {
      peersArray.push({
        nodeId: peer.nodeId,
        address: peer.address,
        httpPort: peer.httpPort,
        lastSeenAt: peer.lastSeenAt,
        clockOffsetMs: peer.clockOffsetMs ?? 0
      });
    }
  }

  return {
    enabled: meshState.enabled,
    running: meshState.running,
    nodeId: meshState.nodeId,
    peerCount: peersArray.length,
    peers: peersArray,
    activeLockCount: meshState.activeLocks.length,
    activeLocks: meshState.activeLocks,
    lastQueueMergeAt: meshState.lastQueueMergeAt ? meshState.lastQueueMergeAt.toISOString() : null,
    lastError: meshState.lastError
  };
}

/**
 * Registers/updates a peer in the local mesh registry.
 */
export function registerPeer(nodeId, address, httpPort, clockOffsetMs = 0) {
  meshState.peers.set(nodeId, {
    nodeId,
    address,
    httpPort,
    lastSeenAt: new Date().toISOString(),
    clockOffsetMs
  });
  broadcastSyncStatus();
}

/**
 * Removes a peer from the local mesh registry.
 */
export function removePeer(nodeId) {
  if (meshState.peers.has(nodeId)) {
    meshState.peers.delete(nodeId);
    console.log(`[MeshState] Peer disconnected: ${nodeId}`);
    broadcastSyncStatus();
  }
}
