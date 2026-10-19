// @ts-check
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { state } from '../../state.js';
import { broadcastSyncStatus } from '../connectivity.js';
import { readHealthFaults } from '../syncStore.js';

/** @typedef {{ nodeId: unknown, address: string, httpPort: number, lastSeenAt: string, clockOffsetMs: number, manual: boolean, discoverySource: unknown, sameSubnet: unknown }} MeshPeer */
/** @typedef {{ name: string, address: string, netmask: string, network: string, broadcast: string, cidr: string | null, private: boolean }} MeshInterface */

export const meshState = {
  enabled: false,
  running: false,
  nodeId: /** @type {unknown} */ (null),
  lodgeId: /** @type {string | null} */ (null),
  lodgeMeshSecret: /** @type {string | null} */ (null),
  httpPort: /** @type {number | null} */ (null),
  peers: /** @type {Map<unknown, MeshPeer>} */ (new Map()), // nodeId -> peer object { nodeId, address, httpPort, lastSeenAt, clockOffsetMs }
  activeLocks: /** @type {unknown[]} */ ([]), // local and remote locks { lockId, roomId, startDate, endDate, sourceNodeId, createdAt, expiresAt }
  lastError: /** @type {unknown} */ (null),
  server: null, // HTTP server instance
  discoverySocket: /** @type {unknown} */ (null), // UDP Socket
  serverNonceCache: new Set(), // Received nonces (HMAC replay protection)
  lastQueueMergeAt: /** @type {Date | null} */ (null),
  lastQueueRepair: null,
  localInterfaces: /** @type {MeshInterface[]} */ ([]),
  discoveryTargets: /** @type {string[]} */ ([]),
  lastBeaconAt: /** @type {string | null} */ (null),
  lastPeerSeenAt: /** @type {string | null} */ (null),
  lastDiscoveryError: /** @type {string | null} */ (null)
};
/** @type {typeof meshState & { lastTeamSync?: unknown }} */
const meshStateWithTeamSync = meshState;

const REMEMBERED_PEERS_FILE = 'mesh-peers.json';

function rememberedPeersPath() {
  return state.cacheDir ? path.join(state.cacheDir, REMEMBERED_PEERS_FILE) : null;
}

export function readRememberedMeshPeers() {
  const filePath = rememberedPeersPath();
  if (!filePath) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((peer) => {
      const peerFields = /** @type {Record<string, unknown>} */ (peer);
      return peer && typeof peerFields.address === 'string' && Number.isInteger(Number(peerFields.httpPort));
    }) : [];
  } catch {
    return [];
  }
}

export function rememberMeshPeer(peer = {}) {
  const peerFields = /** @type {Record<string, unknown>} */ (peer);
  const filePath = rememberedPeersPath();
  if (!filePath || !peerFields.address || !Number.isInteger(Number(peerFields.httpPort))) return;
  const existing = readRememberedMeshPeers();
  const key = peerFields.nodeId || `${peerFields.address}:${peerFields.httpPort}`;
  const nextPeer = {
    nodeId: peerFields.nodeId || null,
    address: peerFields.address,
    httpPort: Number(peerFields.httpPort),
    manual: peerFields.manual === true,
    lastSeenAt: peerFields.lastSeenAt || new Date().toISOString()
  };
  const next = [
    nextPeer,
    ...existing.filter((entry) =>
      (/** @type {Record<string, unknown>} */ (entry).nodeId || `${/** @type {Record<string, unknown>} */ (entry).address}:${/** @type {Record<string, unknown>} */ (entry).httpPort}`) !== key &&
      `${/** @type {Record<string, unknown>} */ (entry).address}:${/** @type {Record<string, unknown>} */ (entry).httpPort}` !== `${nextPeer.address}:${nextPeer.httpPort}`
    )
  ].slice(0, 12);
  try {
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8');
  } catch (error) {
    const errorFields = /** @type {Record<string, unknown> | null | undefined} */ (error);
    console.warn('[MeshState] Could not remember peer:', errorFields?.message || error);
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
      const data = /** @type {unknown} */ (JSON.parse(fs.readFileSync(identityPath, 'utf8')));
      const identityFields = /** @type {Record<string, unknown> | null | undefined} */ (data);
      if (data && identityFields?.nodeId) {
        meshState.nodeId = identityFields.nodeId;
        return identityFields.nodeId;
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
  const persistentMeshReview = readHealthFaults().filter((fault) => ['mesh_queue_identity_conflict','mesh_peer_protocol_incompatible'].includes(fault?.type));
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
    lastQueueRepair: meshState.lastQueueRepair || null,
    lastTeamSync: meshStateWithTeamSync.lastTeamSync || null,
    lastError: meshState.lastError,
    lastDiscoveryError: meshState.lastDiscoveryError,
    lastBeaconAt: meshState.lastBeaconAt,
    lastPeerSeenAt: meshState.lastPeerSeenAt,
    httpPort: meshState.httpPort,
    localInterfaces: meshState.localInterfaces,
    discoveryTargets: meshState.discoveryTargets,
    rememberedPeerCount: readRememberedMeshPeers().length,
    warnings: [
      ...(persistentMeshReview.some((fault) => fault.type === 'mesh_queue_identity_conflict') ? ['Mesh queue identity conflict is quarantined. A manager must review local sync details before creating or retrying the affected operation.'] : []),
      ...(persistentMeshReview.some((fault) => fault.type === 'mesh_peer_protocol_incompatible') ? ['A nearby device has an incompatible multi-room queue item. Keep its source device online and have a manager review it; do not recreate the group.'] : []),
      ...(meshState.localInterfaces.length === 0 ? ['No active private IPv4 network adapter was found.'] : []),
      ...(meshState.running && peersArray.length === 0
        ? ['No nearby Tsa Bonno devices found. If another device is online, check extender AP/client isolation or add its IP manually.']
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
/** @param {unknown} nodeId @param {string} address @param {number} httpPort @param {number} [clockOffsetMs] @param {Record<string, unknown>} [metadata] */
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
/** @param {unknown} nodeId */
export function removePeer(nodeId) {
  if (meshState.peers.has(nodeId)) {
    meshState.peers.delete(nodeId);
    console.log(`[MeshState] Peer disconnected: ${nodeId}`);
    broadcastSyncStatus();
  }
}
