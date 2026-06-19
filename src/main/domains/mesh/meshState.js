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
  lastQueueMergeAt: null,
  localInterfaces: [],
  discoveryTargets: [],
  lastBeaconAt: null,
  lastPeerSeenAt: null,
  lastDiscoveryError: null
};

const REMEMBERED_PEERS_FILE = 'mesh-peers.json';

function rememberedPeersPath() {
  return state.cacheDir ? path.join(state.cacheDir, REMEMBERED_PEERS_FILE) : null;
}

export function readRememberedMeshPeers() {
  const filePath = rememberedPeersPath();
  if (!filePath) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((peer) =>
      peer && typeof peer.address === 'string' && Number.isInteger(Number(peer.httpPort))
    ) : [];
  } catch {
    return [];
  }
}

export function rememberMeshPeer(peer = {}) {
  const filePath = rememberedPeersPath();
  if (!filePath || !peer.address || !Number.isInteger(Number(peer.httpPort))) return;
  const existing = readRememberedMeshPeers();
  const key = peer.nodeId || `${peer.address}:${peer.httpPort}`;
  const nextPeer = {
    nodeId: peer.nodeId || null,
    address: peer.address,
    httpPort: Number(peer.httpPort),
    manual: peer.manual === true,
    lastSeenAt: peer.lastSeenAt || new Date().toISOString()
  };
  const next = [
    nextPeer,
    ...existing.filter((entry) =>
      (entry.nodeId || `${entry.address}:${entry.httpPort}`) !== key &&
      `${entry.address}:${entry.httpPort}` !== `${nextPeer.address}:${nextPeer.httpPort}`
    )
  ].slice(0, 12);
  try {
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    console.warn('[MeshState] Could not remember peer:', error?.message || error);
  }
}

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
        clockOffsetMs: peer.clockOffsetMs ?? 0,
        manual: peer.manual === true,
        discoverySource: peer.discoverySource || 'broadcast',
        sameSubnet: peer.sameSubnet ?? null
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
    lastError: meshState.lastError,
    lastDiscoveryError: meshState.lastDiscoveryError,
    lastBeaconAt: meshState.lastBeaconAt,
    lastPeerSeenAt: meshState.lastPeerSeenAt,
    httpPort: meshState.httpPort,
    localInterfaces: meshState.localInterfaces,
    discoveryTargets: meshState.discoveryTargets,
    rememberedPeerCount: readRememberedMeshPeers().length,
    warnings: [
      ...(meshState.localInterfaces.length === 0 ? ['No active private IPv4 network adapter was found.'] : []),
      ...(meshState.running && peersArray.length === 0
        ? ['No nearby Boroko devices found. If another device is online, check extender AP/client isolation or add its IP manually.']
        : []),
      ...(meshState.lastDiscoveryError ? [meshState.lastDiscoveryError] : []),
      ...peersArray
        .filter((peer) => Math.abs(Number(peer.clockOffsetMs || 0)) > 15000)
        .map((peer) => `Clock differs by more than 15 seconds from ${peer.address}.`),
      ...peersArray
        .filter((peer) => peer.sameSubnet === false)
        .map((peer) => `${peer.address} is on a different subnet; automatic discovery may depend on router/extender settings.`)
    ]
  };
}

/**
 * Registers/updates a peer in the local mesh registry.
 */
export function registerPeer(nodeId, address, httpPort, clockOffsetMs = 0, metadata = {}) {
  const peer = {
    nodeId,
    address,
    httpPort,
    lastSeenAt: new Date().toISOString(),
    clockOffsetMs,
    manual: metadata.manual === true,
    discoverySource: metadata.discoverySource || 'broadcast',
    sameSubnet: metadata.sameSubnet ?? null
  };
  meshState.peers.set(nodeId, peer);
  meshState.lastPeerSeenAt = peer.lastSeenAt;
  meshState.lastDiscoveryError = null;
  rememberMeshPeer(peer);
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
