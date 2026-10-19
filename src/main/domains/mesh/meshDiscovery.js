// @ts-check
import dgram from 'dgram';
import os from 'os';
import { state } from '../../state.js';
import {
  meshState,
  readRememberedMeshPeers,
  registerPeer
} from './meshState.js';
import { performPeerHandshake } from './meshClient.js';
import { MESH_HTTP_PORT_END, MESH_HTTP_PORT_START } from './meshServer.js';

const DISCOVERY_PORT = 53535;
const MULTICAST_ADDR = '239.255.0.1';
const BEACON_INTERVAL_MS = 30000;
const REMEMBERED_PROBE_INTERVAL_MS = 45000;
const HANDSHAKE_COOLDOWN_MS = 15000;
/** @type {ReturnType<typeof setInterval> | null} */
let beaconIntervalId = null;
/** @type {ReturnType<typeof setInterval> | null} */
let rememberedProbeIntervalId = null;
/** @type {ReturnType<typeof setTimeout>[]} */
let startupBeaconTimeouts = [];
const handshakeCooldowns = new Map();

/** @typedef {{ name: string, address: string, netmask: string, network: string, broadcast: string, cidr: string | null, private: boolean }} MeshInterface */
/** @typedef {Omit<typeof meshState, 'localInterfaces' | 'discoveryTargets' | 'discoverySocket' | 'lastDiscoveryError' | 'lastBeaconAt'> & {
 * localInterfaces: MeshInterface[],
 * discoveryTargets: string[],
 * discoverySocket: ReturnType<typeof dgram.createSocket> | null,
 * lastDiscoveryError: string | null,
 * lastBeaconAt: string | null
 * }} DiscoveryMeshState */
const discoveryMeshState = /** @type {DiscoveryMeshState} */ (meshState);

/** @param {unknown} error */
function readDirectThrownMessage(error) {
  return /** @type {{ message: unknown }} */ (error).message;
}

/** @param {string} address */
function ipv4ToInt(address) {
  return address.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

/** @param {number} value */
function intToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

/** @param {unknown} address */
function isPrivateIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127;
}

export function getLocalMeshInterfaces() {
  const rows = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const entry of addresses || []) {
      if (entry.family !== 'IPv4' || entry.internal || !entry.address || !entry.netmask) continue;
      const addressInt = ipv4ToInt(entry.address);
      const maskInt = ipv4ToInt(entry.netmask);
      const networkInt = addressInt & maskInt;
      const broadcastInt = (networkInt | (~maskInt >>> 0)) >>> 0;
      rows.push({
        name,
        address: entry.address,
        netmask: entry.netmask,
        network: intToIpv4(networkInt),
        broadcast: intToIpv4(broadcastInt),
        cidr: entry.cidr || null,
        private: isPrivateIpv4(entry.address)
      });
    }
  }
  return rows.filter((entry) => entry.private);
}

/** @param {string} address */
function isAddressOnLocalSubnet(address) {
  if (!isPrivateIpv4(address)) return false;
  const target = ipv4ToInt(address);
  return discoveryMeshState.localInterfaces.some((entry) =>
    (target & ipv4ToInt(entry.netmask)) === ipv4ToInt(entry.network)
  );
}

/** @param {unknown} value */
function normalizeAddress(value) {
  const address = String(value || '').trim();
  if (!isPrivateIpv4(address)) {
    throw new Error('Enter a private lodge-network IP address, for example 192.168.1.25.');
  }
  return address;
}

/** @param {unknown} nodeId @param {string} address @param {number | string} httpPort @param {Record<string, unknown>} [metadata] */
async function handshakeCandidate(nodeId, address, httpPort, metadata = {}) {
  const key = `${nodeId || address}:${httpPort}`;
  const lastAttempt = handshakeCooldowns.get(key);
  if (!metadata.force && lastAttempt && Date.now() - lastAttempt < HANDSHAKE_COOLDOWN_MS) return null;
  handshakeCooldowns.set(key, Date.now());
  return performPeerHandshake(nodeId, address, Number(httpPort), {
    ...metadata,
    sameSubnet: isAddressOnLocalSubnet(address)
  });
}

/** @param {string} address @param {Record<string, unknown>} [metadata] */
async function scanAddress(address, metadata = {}) {
  const ports = [];
  for (let port = MESH_HTTP_PORT_START; port <= MESH_HTTP_PORT_END; port += 1) ports.push(port);
  const attempts = ports.map((port) =>
    handshakeCandidate(null, address, port, { ...metadata, force: true, silent: true })
      .then((result) => result || Promise.reject(new Error('Handshake cooldown')))
  );
  try {
    return await Promise.any(attempts);
  } catch (error) {
    const errorFields = /** @type {Record<string, unknown> | null | undefined} */ (error);
    const messages = Array.isArray(errorFields?.errors)
      ? errorFields.errors.map((entry) => String((/** @type {Record<string, unknown> | null | undefined} */ (entry))?.message || entry || ''))
      : [];
    if (messages.some((message) => /timestamp drift|clock/i.test(message))) {
      throw new Error(`The clock on ${address} differs too much. Correct the date and time on both computers, then try again.`);
    }
    throw new Error(`No Tsa Bonno device responded at ${address}. Check the IP, Windows Firewall, and extender client isolation.`);
  }
}

/** @param {string} address @param {number | string | null} [port] */
export async function connectManualMeshPeer(address, port = null) {
  const normalizedAddress = normalizeAddress(address);
  const requestedPort = Number(port);
  const result = Number.isInteger(requestedPort) && requestedPort >= MESH_HTTP_PORT_START && requestedPort <= MESH_HTTP_PORT_END
    ? await handshakeCandidate(null, normalizedAddress, requestedPort, {
        manual: true,
        discoverySource: 'manual',
        force: true
      })
    : await scanAddress(normalizedAddress, {
        manual: true,
        discoverySource: 'manual'
      });
  return {
    success: true,
    peer: result,
    sameSubnet: isAddressOnLocalSubnet(normalizedAddress)
  };
}

export async function probeRememberedMeshPeers() {
  if (!meshState.running) return { attempted: 0, connected: 0 };
  const remembered = readRememberedMeshPeers();
  let connected = 0;
  await Promise.all(remembered.map(async (peer) => {
    if (!peer?.address || !peer?.httpPort) return;
    try {
      await handshakeCandidate(peer.nodeId || null, peer.address, peer.httpPort, {
        manual: peer.manual === true,
        discoverySource: peer.manual ? 'manual-remembered' : 'remembered',
        force: true,
        silent: true
      });
      connected++;
    } catch {
      try {
        await scanAddress(peer.address, {
          manual: peer.manual === true,
          discoverySource: 'remembered-port-scan'
        });
        connected++;
      } catch {}
    }
  }));
  return { attempted: remembered.length, connected };
}

export function startMeshDiscovery() {
  if (discoveryMeshState.discoverySocket) {
    console.log('[MeshDiscovery] UDP discovery socket already running.');
    return;
  }

  discoveryMeshState.localInterfaces = getLocalMeshInterfaces();
  discoveryMeshState.discoveryTargets = [
    MULTICAST_ADDR,
    '255.255.255.255',
    ...new Set(discoveryMeshState.localInterfaces.map((entry) => entry.broadcast))
  ];

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    console.error('[MeshDiscovery] UDP Socket Error:', err);
    discoveryMeshState.lastDiscoveryError = `Discovery socket: ${readDirectThrownMessage(err)}`;
    try { socket.close(); } catch {}
    if (discoveryMeshState.discoverySocket === socket) discoveryMeshState.discoverySocket = null;
  });

  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString('utf8'));
      if (data.type !== 'boroko_mesh_hello') return;
      const { nodeId, lodgeId, httpPort } = data;
      if (!nodeId || !lodgeId || !httpPort || nodeId === meshState.nodeId || lodgeId !== state.lodgeId) return;

      const peerAddress = rinfo.address;
      const existing = meshState.peers.get(nodeId);
      if (existing && existing.address === peerAddress && existing.httpPort === httpPort) {
        registerPeer(nodeId, peerAddress, Number(httpPort), existing.clockOffsetMs || 0, {
          manual: existing.manual === true,
          discoverySource: 'broadcast',
          sameSubnet: isAddressOnLocalSubnet(peerAddress)
        });
        return;
      }

      handshakeCandidate(nodeId, peerAddress, Number(httpPort), {
        discoverySource: 'broadcast'
      }).catch((err) => {
        discoveryMeshState.lastDiscoveryError = `Could not reach ${peerAddress}:${httpPort}: ${readDirectThrownMessage(err)}`;
      });
    } catch {
      // Malformed unauthenticated discovery packets are ignored.
    }
  });

  socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
    try {
      socket.setBroadcast(true);
      socket.setMulticastTTL(4);
      socket.setMulticastLoopback(true);
      for (const entry of discoveryMeshState.localInterfaces) {
        try { socket.addMembership(MULTICAST_ADDR, entry.address); } catch {}
      }
      if (discoveryMeshState.localInterfaces.length === 0) {
        try { socket.addMembership(MULTICAST_ADDR); } catch {}
      }
      discoveryMeshState.discoverySocket = socket;
      discoveryMeshState.lastDiscoveryError = null;
      console.log(`[MeshDiscovery] Listening on UDP ${DISCOVERY_PORT}; targets: ${discoveryMeshState.discoveryTargets.join(', ')}`);
      beaconIntervalId = setInterval(broadcastHelloBeacon, BEACON_INTERVAL_MS);
      rememberedProbeIntervalId = setInterval(probeRememberedMeshPeers, REMEMBERED_PROBE_INTERVAL_MS);
      broadcastHelloBeacon();
      startupBeaconTimeouts = [750, 2000, 5000].map((delay) =>
        setTimeout(broadcastHelloBeacon, delay)
      );
      probeRememberedMeshPeers().catch(() => {});
    } catch (err) {
      console.error('[MeshDiscovery] Failed to initialize discovery:', err);
      discoveryMeshState.lastDiscoveryError = `Discovery init: ${readDirectThrownMessage(err)}`;
    }
  });
}

export function stopMeshDiscovery() {
  clearInterval(/** @type {ReturnType<typeof setInterval>} */ (beaconIntervalId));
  clearInterval(/** @type {ReturnType<typeof setInterval>} */ (rememberedProbeIntervalId));
  startupBeaconTimeouts.forEach((timeout) => clearTimeout(timeout));
  startupBeaconTimeouts = [];
  beaconIntervalId = null;
  rememberedProbeIntervalId = null;
  if (discoveryMeshState.discoverySocket) {
    try { discoveryMeshState.discoverySocket.close(); } catch {}
    discoveryMeshState.discoverySocket = null;
  }
}

export function broadcastHelloBeacon() {
  const socket = discoveryMeshState.discoverySocket;
  if (!socket || !meshState.running || !state.lodgeId || !meshState.httpPort) return;

  const payload = Buffer.from(JSON.stringify({
    type: 'boroko_mesh_hello',
    nodeId: meshState.nodeId,
    lodgeId: state.lodgeId,
    httpPort: meshState.httpPort,
    sentAt: new Date().toISOString()
  }));

  for (const target of discoveryMeshState.discoveryTargets) {
    socket.send(payload, 0, payload.length, DISCOVERY_PORT, target, (err) => {
      if (err && target === MULTICAST_ADDR) {
        discoveryMeshState.lastDiscoveryError = `Multicast send failed: ${readDirectThrownMessage(err)}`;
      }
    });
  }
  discoveryMeshState.lastBeaconAt = new Date().toISOString();
}

export async function refreshMeshDiscovery() {
  discoveryMeshState.localInterfaces = getLocalMeshInterfaces();
  discoveryMeshState.discoveryTargets = [
    MULTICAST_ADDR,
    '255.255.255.255',
    ...new Set(discoveryMeshState.localInterfaces.map((entry) => entry.broadcast))
  ];
  broadcastHelloBeacon();
  const remembered = await probeRememberedMeshPeers();
  return {
    success: true,
    remembered,
    localInterfaces: discoveryMeshState.localInterfaces,
    discoveryTargets: discoveryMeshState.discoveryTargets
  };
}
