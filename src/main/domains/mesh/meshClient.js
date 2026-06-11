import crypto from 'crypto';
import { meshState, registerPeer, removePeer } from './meshState.js';
import { generateMeshSignature } from './meshSecurity.js';

/**
 * Sends an authenticated, signed HTTP request to a peer node in the local mesh.
 * Automatically injects required Boroko mesh protocol headers and computes HMAC.
 */
export async function sendSignedMeshRequest(peerAddress, peerPort, method, pathname, queryObj = null, body = null) {
  if (!meshState.lodgeMeshSecret) {
    throw new Error('[MeshClient] Local lodge mesh secret is not loaded.');
  }

  const queryStr = queryObj ? '?' + new URLSearchParams(queryObj).toString() : '';
  const fullPathAndQuery = `${pathname}${queryStr}`;
  const url = `http://${peerAddress}:${peerPort}${fullPathAndQuery}`;

  const timestamp = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';

  // Generate signature using exactly the required format
  const signature = generateMeshSignature(
    method,
    fullPathAndQuery,
    timestamp,
    nonce,
    bodyString,
    meshState.lodgeMeshSecret
  );

  const headers = {
    'x-boroko-mesh-node-id': meshState.nodeId,
    'x-boroko-mesh-lodge-id': meshState.lodgeId,
    'x-boroko-mesh-timestamp': timestamp,
    'x-boroko-mesh-nonce': nonce,
    'x-boroko-mesh-signature': signature,
    'Content-Type': 'application/json'
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s network timeout

  try {
    const response = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'DELETE' ? bodyString : undefined,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Performs a P2P security handshake with a newly discovered peer.
 * Sends a signed GET /mesh/hello request, validates response, and measures clock drift.
 */
export async function performPeerHandshake(nodeId, address, httpPort) {
  try {
    const result = await sendSignedMeshRequest(address, httpPort, 'GET', '/mesh/hello');
    
    if (!result || result.nodeId !== nodeId || result.lodgeId !== meshState.lodgeId) {
      throw new Error('Handshake details mismatch or unauthorized');
    }

    // Calculate clock offset to coordinate lock durations and timestamps accurately
    const remoteTime = new Date(result.serverTime).getTime();
    const clockOffsetMs = remoteTime - Date.now();

    console.log(`[MeshClient] Handshake completed successfully with Peer ${nodeId}. Clock Offset: ${clockOffsetMs}ms`);

    // Register active peer with computed clock drift
    registerPeer(nodeId, address, httpPort, clockOffsetMs);

    // Trigger immediate P2P sync queue reconciliation
    import('./meshQueueMerge.js')
      .then((m) => m.syncMeshQueues())
      .catch((err) => console.error('[MeshClient] Failed to trigger syncMeshQueues:', err));

    return true;
  } catch (err) {
    console.warn(`[MeshClient] Handshake failed for peer candidate ${nodeId} at ${address}:${httpPort}:`, err.message);
    removePeer(nodeId);
    throw err;
  }
}

/**
 * Broadcasts a request to all currently connected peers in the mesh.
 */
export async function broadcastToMesh(method, pathname, queryObj = null, body = null) {
  const promises = [];
  for (const [peerId, peer] of meshState.peers.entries()) {
    promises.push(
      sendSignedMeshRequest(peer.address, peer.httpPort, method, pathname, queryObj, body)
        .then((result) => ({ success: true, peerId, result }))
        .catch((err) => {
          console.warn(`[MeshClient] Broadcast to peer ${peerId} failed:`, err.message);
          return { success: false, peerId, error: err.message };
        })
    );
  }
  return Promise.all(promises);
}
