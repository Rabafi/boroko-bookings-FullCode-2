import dgram from 'dgram';
import { state } from '../../state.js';
import { meshState, registerPeer, removePeer } from './meshState.js';
import { performPeerHandshake } from './meshClient.js';

const DISCOVERY_PORT = 53535;
const MULTICAST_ADDR = '239.255.0.1';
const BEACON_INTERVAL_MS = 30000;
const HANDSHAKE_COOLDOWN_MS = 60000;
let beaconIntervalId = null;
const handshakeCooldowns = new Map();

/**
 * Initializes and starts the UDP discovery socket for local LAN mesh peers.
 */
export function startMeshDiscovery() {
  if (meshState.discoverySocket) {
    console.log('[MeshDiscovery] UDP discovery socket already running.');
    return;
  }

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    console.error('[MeshDiscovery] UDP Socket Error:', err);
    meshState.lastError = `Discovery Socket: ${err.message}`;
    try {
      socket.close();
    } catch (_) {}
    if (meshState.discoverySocket === socket) {
      meshState.discoverySocket = null;
    }
  });

  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString('utf8'));
      if (data.type !== 'boroko_mesh_hello') return;

      const { nodeId, lodgeId, httpPort } = data;

      // 1. Verify mandatory fields
      if (!nodeId || !lodgeId || !httpPort) return;

      // 2. Ignore self-beacons
      if (nodeId === meshState.nodeId) return;

      // 3. Verify it belongs to the same lodge profile
      if (lodgeId !== state.lodgeId) return;

      // 4. Record/Update peer in local registry
      const peerAddress = rinfo.address;

      // Cooldown check: prevent handshake retry storms for the same peer
      const lastAttempt = handshakeCooldowns.get(nodeId);
      if (lastAttempt && (Date.now() - lastAttempt) < HANDSHAKE_COOLDOWN_MS) return;

      // Check if we already have this peer, if not, perform dynamic HTTP handshake to verify HMAC and compute clock drift
      const existing = meshState.peers.get(nodeId);
      if (!existing || existing.address !== peerAddress || existing.httpPort !== httpPort) {
        handshakeCooldowns.set(nodeId, Date.now());
        console.log(`[MeshDiscovery] Discovered peer candidate: ${nodeId} at ${peerAddress}:${httpPort}. Initiating HTTP handshake...`);
        // Trigger non-blocking handshake
        performPeerHandshake(nodeId, peerAddress, httpPort).catch((err) => {
          console.warn(`[MeshDiscovery] Handshake failed with peer candidate ${nodeId}:`, err.message);
        });
      } else {
        // Just refresh the last seen timestamp
        registerPeer(nodeId, peerAddress, httpPort, existing.clockOffsetMs || 0);
      }
    } catch (err) {
      // Ignore malformed UDP packets silently
    }
  });

  socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
    try {
      socket.setBroadcast(true);
      socket.setMulticastTTL(4);
      // Enable loopback so we can run multiple instances locally for testing
      socket.setMulticastLoopback(true);
      socket.addMembership(MULTICAST_ADDR);

      meshState.discoverySocket = socket;
      console.log(`[MeshDiscovery] UDP discovery listening on port ${DISCOVERY_PORT}, joined multicast group ${MULTICAST_ADDR}`);

      // Start broadcasting periodic hello beacons
      beaconIntervalId = setInterval(broadcastHelloBeacon, BEACON_INTERVAL_MS);
      // Broadcast immediately on startup
      broadcastHelloBeacon();
    } catch (err) {
      console.error('[MeshDiscovery] Failed to set up multicast/broadcast membership:', err);
      meshState.lastError = `Discovery Init: ${err.message}`;
    }
  });
}

/**
 * Stops the UDP discovery socket and clears the broadcast interval.
 */
export function stopMeshDiscovery() {
  if (beaconIntervalId) {
    clearInterval(beaconIntervalId);
    beaconIntervalId = null;
  }

  if (meshState.discoverySocket) {
    try {
      meshState.discoverySocket.close();
      console.log('[MeshDiscovery] UDP discovery socket closed.');
    } catch (err) {
      console.error('[MeshDiscovery] Error closing discovery socket:', err);
    }
    meshState.discoverySocket = null;
  }
}

/**
 * Broadcasts a hello beacon to the local network containing nodeId and lodgeId.
 */
function broadcastHelloBeacon() {
  const socket = meshState.discoverySocket;
  if (!socket || !meshState.running || !state.lodgeId || !meshState.httpPort) return;

  try {
    const payload = JSON.stringify({
      type: 'boroko_mesh_hello',
      nodeId: meshState.nodeId,
      lodgeId: state.lodgeId,
      httpPort: meshState.httpPort,
      sentAt: new Date().toISOString()
    });

    const buffer = Buffer.from(payload, 'utf8');

    // Send via multicast
    socket.send(buffer, 0, buffer.length, DISCOVERY_PORT, MULTICAST_ADDR, (err) => {
      if (err) {
        console.warn('[MeshDiscovery] Failed to send multicast hello beacon:', err.message);
      }
    });

    // Also send via standard subnet broadcast fallback to cover devices where multicast is blocked
    socket.send(buffer, 0, buffer.length, DISCOVERY_PORT, '255.255.255.255', (err) => {
      if (err) {
        // broadcast might fail if subnet doesn't support or permission is denied, safe to ignore
      }
    });
  } catch (err) {
    console.error('[MeshDiscovery] Error during hello beacon transmission:', err);
  }
}
