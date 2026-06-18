import crypto from 'crypto';
import dgram from 'dgram';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { URL } from 'url';

const DISCOVERY_PORT = 53535;
const MULTICAST_ADDRESS = '239.255.0.1';
const REQUEST_TOLERANCE_MS = 30_000;
const PEER_STALE_MS = 75_000;
const SHAREABLE_POS_OPERATIONS = new Set([
  'create_pos_order_v3',
  'finalize_pos_shift_cashup_v2',
  'upsert_pos_tab',
  'update_pos_tab_status',
  'upsert_pos_table',
  'open_pos_shift_with_id',
  'close_pos_shift_with_id',
  'create_pos_menu_item',
  'update_pos_menu_item',
  'delete_pos_menu_item',
  'set_bar_pos_pack_template',
  'update_pos_prep_ticket_status',
  'upsert_pos_modifier_groups',
  'upsert_pos_promotions',
  'upsert_pos_floor_layout'
]);

function computeBodyHash(body = '') {
  return crypto.createHash('sha256').update(typeof body === 'string' ? body : JSON.stringify(body)).digest('hex');
}

function signRequest(method, requestPath, timestamp, nonce, body, secret) {
  const input = `${String(method).toUpperCase()}\n${requestPath}\n${timestamp}\n${nonce}\n${computeBodyHash(body)}`;
  return crypto.createHmac('sha256', secret).update(input).digest('hex');
}

function hasMachineBoundSecret(value) {
  if (Array.isArray(value)) return value.some(hasMachineBoundSecret);
  if (!value || typeof value !== 'object') return false;
  if (value._secure_queue_secret === true) return true;
  return Object.values(value).some(hasMachineBoundSecret);
}

function isShareableLegacyItem(item = {}) {
  return ['pending', 'failed', 'syncing'].includes(String(item.status || 'pending')) &&
    SHAREABLE_POS_OPERATIONS.has(item.functionName) &&
    !hasMachineBoundSecret(item.payload);
}

function canonicalizeLegacyItem(item = {}) {
  return {
    _queue_id: item.id,
    type: 'rpc',
    table: item.functionName,
    data: item.payload,
    id: item.entityId || null,
    timestamp: item.createdAt,
    _depends_on: item.dependsOn || null,
    _legacy_entity_type: item.entityType || null,
    _legacy_entity_id: item.entityId || null
  };
}

function canonicalIntent(item = {}) {
  return String(
    item.data?.p_idempotency_key ||
    item.data?.payload?.create_idempotency_key ||
    item.data?.payload?.return_idempotency_key ||
    item.data?.payload?.cashup_id ||
    item.data?.payload?.idempotency_key ||
    ''
  ).trim();
}

function validateCanonicalPosItem(item, lodgeId) {
  if (!item || item.type !== 'rpc' || !item._queue_id || !SHAREABLE_POS_OPERATIONS.has(item.table)) return false;
  if (!item.data || typeof item.data !== 'object' || Array.isArray(item.data)) return false;
  if (hasMachineBoundSecret(item.data)) return false;
  const payloadLodgeId = item.data?.payload?.lodge_id || item.data?.p_lodge_id || null;
  if (payloadLodgeId && payloadLodgeId !== lodgeId) return false;
  return JSON.stringify(item).length <= 102400;
}

function readOrCreateNodeId(cacheDir) {
  const filePath = path.join(cacheDir, 'legacy-mesh-identity.json');
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (existing?.node_id) return existing.node_id;
  } catch {}
  const nodeId = crypto.randomUUID();
  fs.writeFileSync(filePath, JSON.stringify({ node_id: nodeId, created_at: new Date().toISOString() }, null, 2), 'utf8');
  return nodeId;
}

export function createLegacyMeshController({
  cacheDir,
  getLodgeId,
  getMeshSecret,
  readQueue,
  importCanonicalItems,
  onStatus
}) {
  const mesh = {
    running: false,
    lodgeId: null,
    secret: null,
    nodeId: readOrCreateNodeId(cacheDir),
    httpPort: null,
    server: null,
    socket: null,
    peers: new Map(),
    nonces: new Map(),
    lastMergeAt: null,
    lastError: ''
  };
  let beaconTimer = null;
  let syncTimer = null;
  let ensureTimer = null;

  const status = () => {
    const now = Date.now();
    for (const [id, peer] of mesh.peers.entries()) {
      if (now - peer.lastSeenAt > PEER_STALE_MS) mesh.peers.delete(id);
    }
    return {
      running: mesh.running,
      nodeId: mesh.nodeId,
      peerCount: mesh.peers.size,
      lastMergeAt: mesh.lastMergeAt,
      lastError: mesh.lastError
    };
  };
  const publishStatus = () => onStatus?.(status());

  function validateRequest(req, body) {
    const timestamp = String(req.headers['x-boroko-mesh-timestamp'] || '');
    const nonce = String(req.headers['x-boroko-mesh-nonce'] || '');
    const signature = String(req.headers['x-boroko-mesh-signature'] || '');
    const lodgeId = String(req.headers['x-boroko-mesh-lodge-id'] || '');
    if (!timestamp || !nonce || !signature || lodgeId !== mesh.lodgeId) return false;
    const requestTime = Date.parse(timestamp);
    if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > REQUEST_TOLERANCE_MS) return false;
    if (mesh.nonces.has(nonce)) return false;
    const expected = signRequest(req.method, req.url, timestamp, nonce, body, mesh.secret);
    const actualBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;
    mesh.nonces.set(nonce, requestTime + REQUEST_TOLERANCE_MS);
    return true;
  }

  function canonicalQueue() {
    return readQueue().filter(isShareableLegacyItem).map(canonicalizeLegacyItem);
  }

  function startServer() {
    mesh.server = http.createServer((req, res) => {
      const chunks = [];
      let length = 0;
      req.on('data', (chunk) => {
        length += chunk.length;
        if (length <= 102400) chunks.push(chunk);
      });
      req.on('end', () => {
        if (length > 102400) {
          res.writeHead(413).end();
          return;
        }
        const body = Buffer.concat(chunks).toString('utf8');
        if (!validateRequest(req, body)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized mesh request' }));
          return;
        }
        const parsed = new URL(req.url, 'http://127.0.0.1');
        if (req.method === 'GET' && parsed.pathname === '/mesh/hello') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ version: 1, nodeId: mesh.nodeId, lodgeId: mesh.lodgeId, serverTime: new Date().toISOString() }));
          return;
        }
        if (req.method === 'GET' && parsed.pathname === '/mesh/queue/summary') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(canonicalQueue().map((item) => ({
            _queue_id: item._queue_id,
            intentId: canonicalIntent(item) || null,
            bodyHash: computeBodyHash(item)
          }))));
          return;
        }
        if (req.method === 'GET' && parsed.pathname === '/mesh/queue/items') {
          const ids = new Set(String(parsed.searchParams.get('ids') || '').split(',').filter(Boolean));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(canonicalQueue().filter((item) => ids.has(item._queue_id))));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Route not found' }));
      });
    });
    mesh.server.listen(0, '0.0.0.0', () => {
      mesh.httpPort = mesh.server.address().port;
      mesh.running = true;
      publishStatus();
      broadcastBeacon();
    });
    mesh.server.on('error', (error) => {
      mesh.lastError = error.message;
      publishStatus();
    });
  }

  async function signedRequest(peer, requestPath) {
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const signature = signRequest('GET', requestPath, timestamp, nonce, '', mesh.secret);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(`http://${peer.address}:${peer.httpPort}${requestPath}`, {
        headers: {
          'x-boroko-mesh-node-id': mesh.nodeId,
          'x-boroko-mesh-lodge-id': mesh.lodgeId,
          'x-boroko-mesh-timestamp': timestamp,
          'x-boroko-mesh-nonce': nonce,
          'x-boroko-mesh-signature': signature
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Mesh peer returned HTTP ${response.status}`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function handshake(nodeId, address, httpPort) {
    const peer = { nodeId, address, httpPort, lastSeenAt: Date.now() };
    const hello = await signedRequest(peer, '/mesh/hello');
    if (hello?.nodeId !== nodeId || hello?.lodgeId !== mesh.lodgeId) throw new Error('Mesh handshake identity mismatch');
    mesh.peers.set(nodeId, peer);
    publishStatus();
    await syncQueues();
  }

  function broadcastBeacon() {
    if (!mesh.socket || !mesh.running || !mesh.httpPort) return;
    const payload = Buffer.from(JSON.stringify({
      type: 'boroko_mesh_hello',
      nodeId: mesh.nodeId,
      lodgeId: mesh.lodgeId,
      httpPort: mesh.httpPort,
      clientType: 'legacy-pos'
    }));
    mesh.socket.send(payload, DISCOVERY_PORT, MULTICAST_ADDRESS, () => {});
    mesh.socket.send(payload, DISCOVERY_PORT, '255.255.255.255', () => {});
  }

  function startDiscovery() {
    mesh.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    mesh.socket.on('message', (message, remote) => {
      try {
        const hello = JSON.parse(message.toString('utf8'));
        if (hello.type !== 'boroko_mesh_hello' || hello.nodeId === mesh.nodeId || hello.lodgeId !== mesh.lodgeId || !hello.httpPort) return;
        const existing = mesh.peers.get(hello.nodeId);
        if (existing && existing.address === remote.address && existing.httpPort === hello.httpPort) {
          existing.lastSeenAt = Date.now();
          return;
        }
        handshake(hello.nodeId, remote.address, Number(hello.httpPort)).catch((error) => {
          mesh.lastError = error.message;
          publishStatus();
        });
      } catch {}
    });
    mesh.socket.on('error', (error) => {
      mesh.lastError = error.message;
      publishStatus();
    });
    mesh.socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
      mesh.socket.setBroadcast(true);
      mesh.socket.setMulticastLoopback(true);
      mesh.socket.setMulticastTTL(4);
      mesh.socket.addMembership(MULTICAST_ADDRESS);
      broadcastBeacon();
    });
    beaconTimer = setInterval(broadcastBeacon, 30_000);
  }

  async function syncQueues() {
    if (!mesh.running || mesh.peers.size === 0) return;
    const local = canonicalQueue();
    const localIds = new Set(local.map((item) => item._queue_id));
    const localIntents = new Set(local.map(canonicalIntent).filter(Boolean));
    for (const peer of mesh.peers.values()) {
      try {
        const summary = await signedRequest(peer, '/mesh/queue/summary');
        const missing = (Array.isArray(summary) ? summary : []).filter((row) =>
          row?._queue_id && !localIds.has(row._queue_id) && (!row.intentId || !localIntents.has(row.intentId))
        );
        for (let index = 0; index < missing.length; index += 30) {
          const ids = missing.slice(index, index + 30).map((row) => row._queue_id);
          const remoteItems = await signedRequest(peer, `/mesh/queue/items?ids=${encodeURIComponent(ids.join(','))}`);
          const valid = (Array.isArray(remoteItems) ? remoteItems : []).filter((item) => validateCanonicalPosItem(item, mesh.lodgeId));
          if (valid.length > 0) {
            const imported = importCanonicalItems(valid.map((item) => ({
              ...item,
              _mesh_imported: true,
              _mesh_source_node_id: peer.nodeId,
              _mesh_imported_at: new Date().toISOString()
            })));
            if (imported > 0) {
              mesh.lastMergeAt = new Date().toISOString();
              for (const item of valid) {
                localIds.add(item._queue_id);
                const intent = canonicalIntent(item);
                if (intent) localIntents.add(intent);
              }
            }
          }
        }
        peer.lastSeenAt = Date.now();
      } catch (error) {
        mesh.lastError = error.message;
      }
    }
    publishStatus();
  }

  function stopRuntime() {
    clearInterval(beaconTimer);
    clearInterval(syncTimer);
    beaconTimer = null;
    syncTimer = null;
    try { mesh.socket?.close(); } catch {}
    try { mesh.server?.close(); } catch {}
    mesh.socket = null;
    mesh.server = null;
    mesh.httpPort = null;
    mesh.running = false;
    mesh.peers.clear();
  }

  function ensureStarted() {
    const lodgeId = String(getLodgeId() || '').trim();
    const secret = String(getMeshSecret() || '').trim();
    if (!lodgeId || !secret) {
      if (mesh.running) stopRuntime();
      mesh.lastError = !lodgeId ? 'Waiting for lodge login' : 'Mesh disabled: missing lodge_mesh_secret';
      publishStatus();
      return;
    }
    if (mesh.running && mesh.lodgeId === lodgeId && mesh.secret === secret) return;
    stopRuntime();
    mesh.lodgeId = lodgeId;
    mesh.secret = secret;
    mesh.lastError = '';
    startServer();
    startDiscovery();
    syncTimer = setInterval(syncQueues, 15_000);
  }

  return {
    start() {
      ensureStarted();
      ensureTimer = setInterval(ensureStarted, 15_000);
    },
    stop() {
      clearInterval(ensureTimer);
      ensureTimer = null;
      stopRuntime();
    },
    syncNow: syncQueues,
    getStatus: status
  };
}
