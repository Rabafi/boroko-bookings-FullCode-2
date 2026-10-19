// Main-Bar multi-till LAN mesh harness. Runs the real production mesh
// modules (src/main/domains/mesh/*) against isolated stores and real
// loopback HTTP peers. No source copying, no mock module tree: the peer
// side is an actual signed HTTP server whose requests are authenticated by
// the same meshSecurity module the shipping mesh server uses, and the till
// side is the real syncMeshQueues/conflict/lock/state code path.
//
// Coverage: HMAC signing and replay/clock-skew refusal; queue schema and
// lodge binding; origin-only approval secrets staying off the mesh; invalid
// operation quarantine; advisory room/tab locks; signed queue import with
// provenance and pending-only projections; signed-summary mismatch
// quarantine; partition/rejoin; delayed and out-of-order delivery; relayed
// duplicates and duplicate device identity; additive-only, secret-refusing
// team state; contract inventory (every offline RPC op allowlisted, no cache
// exchange route); repair/health surfacing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { importDomain, importState, makeTempCacheDir } from './helpers/domain-test-setup.mjs';

const merge = await importDomain('mesh/meshQueueMerge.js');
const conflict = await importDomain('mesh/meshConflict.js');
const security = await importDomain('mesh/meshSecurity.js');
const locks = await importDomain('mesh/meshLocks.js');
const cache = await importDomain('cacheStore.js');
const sync = await importDomain('syncStore.js');
const stateSync = await importDomain('mesh/meshStateSync.js');
const { state } = await importState();
const { meshState, getMeshHealthSnapshot } = await importDomain('mesh/meshState.js');

const LODGE = '11111111-1111-4111-8111-111111111111';
const ROOM_A = '22222222-2222-4222-8222-222222222222';
const ROOM_B = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '66666666-6666-4666-8666-666666666666';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOOKING_A = '44444444-4444-4444-8444-444444444444';
const MENU_WATER = 'menu-water-0000-4000-8000-000000000001';
const STOCK_WATER = '55555555-5555-4555-8555-555555555555';
const SECRET = 'isolated-mesh-harness-secret';
const IN = '2026-11-05';
const OUT = '2026-11-08';

function withIsolatedStore(t) {
  const cacheDir = makeTempCacheDir('mesh-p2p-harness');
  const previousState = { cacheDir: state.cacheDir, lodgeId: state.lodgeId };
  const previousMesh = {
    lodgeId: meshState.lodgeId,
    nodeId: meshState.nodeId,
    lodgeMeshSecret: meshState.lodgeMeshSecret,
    running: meshState.running,
    peers: meshState.peers,
    serverNonceCache: meshState.serverNonceCache,
    activeLocks: meshState.activeLocks,
    lastQueueRepair: meshState.lastQueueRepair,
    lastQueueMergeAt: meshState.lastQueueMergeAt,
    lastTeamSync: /** @type {Record<string, unknown>} */ (meshState).lastTeamSync
  };
  state.cacheDir = cacheDir;
  state.lodgeId = LODGE;
  meshState.lodgeId = LODGE;
  meshState.nodeId = `local-${crypto.randomUUID()}`;
  meshState.lodgeMeshSecret = SECRET;
  meshState.running = true;
  meshState.peers = new Map();
  meshState.serverNonceCache = new Set();
  meshState.activeLocks = [];
  meshState.lastQueueRepair = null;
  meshState.lastQueueMergeAt = null;
  t.after(() => {
    Object.assign(state, previousState);
    Object.assign(meshState, previousMesh);
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });
  return cacheDir;
}

function bookingItem({ queueId = `booking-sync-${crypto.randomUUID()}`, bookingId = BOOKING_A, roomId = ROOM_A, key = crypto.randomUUID(), timestamp = '2026-11-01T08:00:00.000Z', total = 300 } = {}) {
  return {
    type: 'rpc',
    table: 'create_booking',
    _queue_id: queueId,
    timestamp,
    data: {
      p_lodge_id: LODGE,
      p_customer_id: CUSTOMER,
      p_room_id: roomId,
      p_check_in: IN,
      p_check_out: OUT,
      p_booking_id: bookingId,
      p_idempotency_key: key,
      p_total_amount: total,
      p_created_by: ACTOR
    }
  };
}

function posV3Item({ queueId = `pos-sync-${crypto.randomUUID()}`, orderId = 'peer-pos-v3-1', key = crypto.randomUUID(), quantity = 2, timestamp = '2026-11-01T09:00:00.000Z' } = {}) {
  return {
    type: 'rpc',
    table: 'create_pos_order_v3',
    _queue_id: queueId,
    timestamp,
    data: {
      payload: {
        id: orderId,
        lodge_id: LODGE,
        catalog_snapshot_id: 'catalog-1',
        shift_id: 'shift-1',
        source_device_id: 'peer-device',
        create_idempotency_key: key,
        items: [{ menu_item_id: MENU_WATER, quantity, modifier_option_ids: [] }]
      }
    }
  };
}

function intentIdOf(item) {
  const data = item.data || {};
  const payload = data.payload || {};
  return String(
    data.p_idempotency_key || data.p_adjustment_id || payload.operation_id ||
    payload.create_idempotency_key || payload.return_idempotency_key ||
    payload.cashup_id || payload.idempotency_key || ''
  ).trim();
}

function summaryOf(item) {
  return {
    _queue_id: item._queue_id,
    operation: item.table,
    type: item.type,
    createdAt: item.timestamp,
    intentId: intentIdOf(item),
    bodyHash: merge.getQueueItemBodyHash(item),
    operationHash: merge.getQueueItemOperationHash(item)
  };
}

function defaultTeamSnapshot(nodeId) {
  return { version: 1, nodeId, lodgeId: LODGE, at: new Date().toISOString(), attendance: [], cashMovements: [], cashCounts: [], drawerPeriods: [], cashupSubmissions: [] };
}

/**
 * Starts a real signed peer HTTP server backed by the production
 * meshSecurity validator. Returns its port and every received request.
 */
async function startSignedPeer(t, { items = [], teamNodeId = null, reverseItems = false, tamperItems = null, capabilities = { protocolVersion: 2, queueFeatures: ['atomic_multi_room_booking_v1'] } } = {}) {
  const requests = [];
  const nodeId = teamNodeId || `peer-${crypto.randomUUID()}`;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const validation = security.validateIncomingRequest(req.method, req.url, req.headers, body, SECRET);
      requests.push({ method: req.method, url: req.url, valid: validation.isValid });
      if (!validation.isValid) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: validation.error }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/mesh/capabilities') {
        res.end(JSON.stringify(capabilities));
        return;
      }
      if (req.url === '/mesh/queue/summary') {
        res.end(JSON.stringify(items.map(summaryOf)));
        return;
      }
      if (req.url.startsWith('/mesh/queue/items?')) {
        const query = new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1));
        const ids = String(query.get('ids') || '').split(',').filter(Boolean);
        let selected = items.filter((item) => ids.includes(item._queue_id));
        if (reverseItems) selected = [...selected].reverse();
        if (tamperItems) selected = selected.map(tamperItems);
        res.end(JSON.stringify(selected));
        return;
      }
      if (req.url === '/mesh/state/team') {
        res.end(JSON.stringify(defaultTeamSnapshot(nodeId)));
        return;
      }
      if (req.url === '/mesh/locks' || req.url.startsWith('/mesh/locks/')) {
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { nodeId, port: server.address().port, requests };
}

function registerPeer(nodeId, port) {
  meshState.peers.set(nodeId, { nodeId, address: '127.0.0.1', httpPort: port, lastSeenAt: new Date().toISOString(), clockOffsetMs: 0 });
}

test('HMAC request signing binds method, path, query and body; replay and >30s clock skew fail closed', () => {
  const previousLodge = meshState.lodgeId;
  meshState.lodgeId = LODGE;
  try {
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const pathAndQuery = '/mesh/queue/items?ids=booking-1,booking-2';
    const signature = security.generateMeshSignature('GET', pathAndQuery, timestamp, nonce, '', SECRET);
    const headers = {
      'x-boroko-mesh-node-id': 'peer-node-B',
      'x-boroko-mesh-lodge-id': LODGE,
      'x-boroko-mesh-timestamp': timestamp,
      'x-boroko-mesh-nonce': nonce,
      'x-boroko-mesh-signature': signature
    };
    assert.equal(security.validateIncomingRequest('GET', pathAndQuery, headers, '', SECRET).isValid, true);

    const replayed = security.validateIncomingRequest('GET', pathAndQuery, headers, '', SECRET);
    assert.equal(replayed.isValid, false);
    assert.equal(replayed.error, 'Nonce already utilized');

    const tamperedQuery = security.validateIncomingRequest('GET', '/mesh/queue/items?ids=booking-1,booking-3', { ...headers, 'x-boroko-mesh-nonce': crypto.randomUUID() }, '', SECRET);
    assert.equal(tamperedQuery.isValid, false);

    const tamperedBodySignature = security.generateMeshSignature('POST', '/mesh/locks', timestamp, crypto.randomUUID(), '{"roomId":"a"}', SECRET);
    const tamperedBody = security.validateIncomingRequest('POST', '/mesh/locks', { ...headers, 'x-boroko-mesh-timestamp': timestamp, 'x-boroko-mesh-nonce': crypto.randomUUID(), 'x-boroko-mesh-signature': tamperedBodySignature }, '{"roomId":"b"}', SECRET);
    assert.equal(tamperedBody.isValid, false);

    const wrongSecret = security.generateMeshSignature('GET', '/mesh/hello', timestamp, crypto.randomUUID(), '', 'another-secret');
    const rejectedSecret = security.validateIncomingRequest('GET', '/mesh/hello', { ...headers, 'x-boroko-mesh-nonce': crypto.randomUUID(), 'x-boroko-mesh-signature': wrongSecret }, '', SECRET);
    assert.equal(rejectedSecret.isValid, false);

    const foreignLodge = security.validateIncomingRequest('GET', '/mesh/hello', { ...headers, 'x-boroko-mesh-lodge-id': '99999999-9999-4999-8999-999999999999', 'x-boroko-mesh-nonce': crypto.randomUUID() }, '', SECRET);
    assert.equal(foreignLodge.isValid, false);
    assert.equal(foreignLodge.error, 'Lodge ID mismatch');

    const skewedPast = new Date(Date.now() - 45000).toISOString();
    const skewedPastSignature = security.generateMeshSignature('GET', '/mesh/hello', skewedPast, crypto.randomUUID(), '', SECRET);
    const skewedPastValidation = security.validateIncomingRequest('GET', '/mesh/hello', { ...headers, 'x-boroko-mesh-timestamp': skewedPast, 'x-boroko-mesh-nonce': crypto.randomUUID(), 'x-boroko-mesh-signature': skewedPastSignature }, '', SECRET);
    assert.equal(skewedPastValidation.isValid, false);
    assert.match(skewedPastValidation.error, /Timestamp drift exceeds tolerance/);

    const withinTolerance = new Date(Date.now() - 20000).toISOString();
    const withinSignature = security.generateMeshSignature('GET', '/mesh/hello', withinTolerance, crypto.randomUUID(), '', SECRET);
    const withinValidation = security.validateIncomingRequest('GET', '/mesh/hello', { ...headers, 'x-boroko-mesh-timestamp': withinTolerance, 'x-boroko-mesh-nonce': crypto.randomUUID(), 'x-boroko-mesh-signature': withinSignature }, '', SECRET);
    assert.equal(withinValidation.isValid, true, 'a 20s skew stays inside the accepted 30s window');
  } finally {
    meshState.lodgeId = previousLodge;
  }
});

test('queue schema validation enforces allowlist, lodge binding, dates, and keeps origin-only approval secrets off the mesh', () => {
  const previousLodge = meshState.lodgeId;
  meshState.lodgeId = LODGE;
  try {
    const valid = bookingItem();
    assert.equal(merge.validateSyncQueueItem(valid).isValid, true);
    assert.equal(merge.isMeshShareableQueueItem(valid), true);

    const noKey = bookingItem();
    delete noKey.data.p_idempotency_key;
    assert.match(merge.validateSyncQueueItem(noKey).reason, /missing p_idempotency_key/);

    const badDates = bookingItem();
    badDates.data.p_check_out = badDates.data.p_check_in;
    assert.match(merge.validateSyncQueueItem(badDates).reason, /invalid date range/);

    const foreignLodge = bookingItem();
    foreignLodge.data.p_lodge_id = '99999999-9999-4999-8999-999999999999';
    assert.match(merge.validateSyncQueueItem(foreignLodge).reason, /lodge mismatch/);

    const notAllowlisted = { _queue_id: 'x-1', type: 'rpc', table: 'confidential_passwords', data: {} };
    assert.match(merge.validateSyncQueueItem(notAllowlisted).reason, /not allowlisted/);

    const validPos = posV3Item();
    assert.equal(merge.validateSyncQueueItem(validPos).isValid, true);
    assert.equal(merge.isMeshShareableQueueItem(validPos), true);

    const missingDevice = posV3Item();
    delete missingDevice.data.payload.source_device_id;
    assert.match(merge.validateSyncQueueItem(missingDevice).reason, /missing source_device_id/);

    const badQty = posV3Item({ quantity: -2 });
    assert.match(merge.validateSyncQueueItem(badQty).reason, /invalid quantity/);

    const legacyPos = {
      _queue_id: 'pos-legacy-1',
      type: 'rpc',
      table: 'create_pos_order',
      data: {
        payload: {
          id: 'pos-legacy-1',
          lodge_id: LODGE,
          create_idempotency_key: crypto.randomUUID(),
          items: [{ inventory_item_id: STOCK_WATER, item_name: 'Water', quantity: 2, unit_price: 20, depletion_qty: 1 }]
        }
      }
    };
    assert.equal(merge.validateSyncQueueItem(legacyPos).isValid, true);

    const missingDepletion = { ...legacyPos, data: { payload: { ...legacyPos.data.payload, items: [{ inventory_item_id: STOCK_WATER, item_name: 'Water', quantity: 2, unit_price: 20 }] } } };
    assert.match(merge.validateSyncQueueItem(missingDepletion).reason, /invalid depletion quantity/);

    const machineBound = {
      _queue_id: 'pos-return-secret',
      type: 'rpc',
      table: 'create_pos_return_v3',
      data: { payload: { lodge_id: LODGE, approval_pin: { _secure_queue_secret: true, data: 'machine-bound' } } }
    };
    assert.equal(merge.isMeshShareableQueueItem(machineBound), false, 'machine-bound approvals stay on the origin device');

    const originOnlyVoid = {
      _queue_id: 'pos-void-origin',
      type: 'rpc',
      table: 'approve_pos_void_with_pin',
      data: { payload: { lodge_id: LODGE, order_id: 'order-1', override_log_id: 'log-1' } }
    };
    assert.equal(merge.validateSyncQueueItem(originOnlyVoid).isValid, true);
    assert.equal(merge.isMeshShareableQueueItem(originOnlyVoid), false, 'PIN-approved voids are origin-device-only');
  } finally {
    meshState.lodgeId = previousLodge;
  }
});

test('invalid peer operations are quarantined with their reason and never merged', async (t) => {
  const cacheDir = withIsolatedStore(t);
  const badItem = { _queue_id: 'booking-bad-33', type: 'rpc', table: 'invalid_table_name', data: {}, timestamp: new Date().toISOString() };
  const peer = await startSignedPeer(t, { items: [badItem] });
  registerPeer(peer.nodeId, peer.port);

  await merge.syncMeshQueues();

  assert.equal(sync.readSyncQueue().length, 0, 'invalid operations never enter the replay queue');
  const quarantine = JSON.parse(fs.readFileSync(path.join(cacheDir, 'sync-mesh-quarantine.json'), 'utf8'));
  assert.equal(quarantine.length, 1);
  assert.equal(quarantine[0].item._queue_id, 'booking-bad-33');
  assert.match(quarantine[0].reason, /not allowlisted/);
  assert.equal(meshState.lastQueueRepair.missingCount, 1);
  assert.equal(meshState.lastQueueRepair.importedCount, 0);
});

test('advisory locks: local locks broadcast and release, remote locks dedupe, tab locks block the second till, expired locks prune', async (t) => {
  withIsolatedStore(t);
  const lockId = await locks.createLocalLock(ROOM_A, IN, OUT);
  assert.ok(lockId);
  assert.equal(meshState.activeLocks.length, 1);
  assert.equal(meshState.activeLocks[0].sourceNodeId, meshState.nodeId);

  const remoteRoomLock = { lockId: 'remote-lock-1', roomId: ROOM_B, startDate: IN, endDate: OUT, sourceNodeId: 'peer-node-A', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString() };
  assert.equal(locks.registerRemoteLock(remoteRoomLock), true);
  assert.equal(locks.registerRemoteLock(remoteRoomLock), true, 'same lock id re-registers without duplicating');
  assert.equal(meshState.activeLocks.filter((lock) => lock.lockId === 'remote-lock-1').length, 1);

  assert.equal(locks.registerRemoteLock({ ...remoteRoomLock, lockId: 'remote-expired', expiresAt: new Date(Date.now() - 5000).toISOString() }), false, 'already-expired remote locks are refused');

  const remoteTabLock = { lockId: 'remote-tab-1', resourceKind: 'pos-tab', resourceId: 'tab-77', operator: 'Other till', sourceNodeId: 'peer-node-A', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString() };
  assert.equal(locks.registerRemoteLock(remoteTabLock), true);
  const acquired = await locks.createTabLock('tab-77', 'This till');
  assert.equal(acquired.acquired, false);
  assert.equal(acquired.held, true);
  assert.match(String(acquired.heldBy), /Other till/);
  assert.equal(await locks.releaseTabLock(acquired.lockId || 'none'), false, 'a refused tab lock owns no local lock id');

  assert.equal(await locks.releaseLocalLock(lockId), true);
  assert.equal(meshState.activeLocks.some((lock) => lock.lockId === lockId), false);

  const held = meshState.activeLocks.find((lock) => lock.lockId === 'remote-lock-1');
  held.expiresAt = new Date(Date.now() - 1000).toISOString();
  locks.pruneExpiredLocks();
  assert.equal(meshState.activeLocks.some((lock) => lock.lockId === 'remote-lock-1'), false, 'expired locks prune');
  assert.equal(meshState.activeLocks.some((lock) => lock.lockId === 'remote-tab-1'), true, 'unexpired locks survive pruning');
});

test('signed peer sync imports each intent once, stamps provenance, and every projection stays a pending estimate', async (t) => {
  const cacheDir = withIsolatedStore(t);
  cache.writeCache('pos-menu-items', [{ id: MENU_WATER, name: 'Water', inventory_item_id: STOCK_WATER, depletion_qty: 2 }]);
  cache.writeCache('inventory-items', [{ id: STOCK_WATER, name: 'Water', current_stock: 12 }]);

  const booking = bookingItem();
  const pos = posV3Item();
  const peer = await startSignedPeer(t, { items: [booking, pos] });
  registerPeer(peer.nodeId, peer.port);

  await merge.syncMeshQueues();

  const importedQueue = sync.readSyncQueue();
  assert.equal(importedQueue.length, 2);
  for (const entry of importedQueue) {
    assert.equal(entry._mesh_imported, true);
    assert.equal(entry._mesh_source_node_id, peer.nodeId);
    assert.equal(entry._mesh_body_hash, merge.getQueueItemBodyHash(entry));
  }

  const projected = cache.readCache('bookings');
  assert.equal(projected.length, 1);
  assert.equal(projected[0].id, BOOKING_A);
  assert.equal(projected[0].status, 'pending');
  assert.equal(projected[0]._financial_estimate, true);
  assert.equal(projected[0]._pending_sync, true);
  assert.equal(Object.hasOwn(projected[0], 'amount_paid'), false);
  assert.equal(Object.hasOwn(projected[0], 'payment_status'), false);

  const inventory = cache.readCache('inventory-items');
  assert.equal(inventory[0].current_stock, 8, '2 x depletion_qty 2 reserved against the peer sale');
  assert.equal(inventory[0]._sync_state, 'pending');
  assert.equal(inventory[0]._pending_sync, true);

  await merge.syncMeshQueues();
  assert.equal(sync.readSyncQueue().length, 2, 'retransmission must not duplicate operations');
  assert.equal(cache.readCache('bookings').length, 1);
  assert.equal(cache.readCache('inventory-items')[0].current_stock, 8, 'retransmission must not double-deplete stock');
  assert.equal(meshState.lastQueueRepair.importedCount, 0);
  assert.ok(meshState.lastTeamSync && Array.isArray(meshState.lastTeamSync.perPeer));

  const queueFile = path.join(cacheDir, 'sync-queue.json');
  const restarted = spawnSync(process.execPath, ['-e', 'const fs=require("node:fs");const q=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(q.map(x=>x.data.p_idempotency_key||x.data.payload.create_idempotency_key)))', queueFile], { encoding: 'utf8' });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), [booking.data.p_idempotency_key, pos.data.payload.create_idempotency_key], 'a fresh process sees the same two imported intents');
});

test('a peer returning contents that do not match its signed summary is quarantined, surfaced, and never imported', async (t) => {
  const cacheDir = withIsolatedStore(t);
  const local = bookingItem({ queueId: 'booking-shared-id', key: 'key-local-000000000001' });
  const remote = bookingItem({ queueId: 'booking-shared-id', key: 'key-remote-00000000002', total: 999 });
  sync.writeSyncQueue([local]);
  const peer = await startSignedPeer(t, { items: [remote] });
  registerPeer(peer.nodeId, peer.port);

  await merge.syncMeshQueues();

  assert.deepEqual(sync.readSyncQueue().map((entry) => entry.data.p_idempotency_key), [local.data.p_idempotency_key]);
  const quarantine = JSON.parse(fs.readFileSync(path.join(cacheDir, 'sync-mesh-quarantine.json'), 'utf8'));
  assert.equal(quarantine.length, 1);
  assert.match(quarantine[0].reason, /Mesh queue identity conflict/i);
  assert.equal(meshState.lastQueueRepair.conflictCount, 1);
  const snapshot = getMeshHealthSnapshot();
  assert.match(snapshot.warnings.join(' '), /mesh queue identity conflict/i);
  assert.ok(snapshot.lastQueueRepair.perPeer.some((entry) => entry.identityConflictCount === 1));
});

test('partition and rejoin: an unreachable peer records the failure without touching local queues, and reconnect imports normally', async (t) => {
  withIsolatedStore(t);
  const item = bookingItem();
  const local = bookingItem({ queueId: 'local-pending-1', key: 'key-local-pending-1' });
  sync.writeSyncQueue([local]);
  registerPeer('peer-offline', 1);

  await merge.syncMeshQueues();
  assert.deepEqual(sync.readSyncQueue().map((entry) => entry._queue_id), ['local-pending-1'], 'local pending work is untouched while partitioned');
  const offlinePeer = meshState.lastQueueRepair.perPeer.find((entry) => entry.nodeId === 'peer-offline');
  assert.ok(offlinePeer && offlinePeer.lastError, 'the failed peer is recorded with its error');
  assert.equal(meshState.lastQueueRepair.importedCount, 0);

  const peer = await startSignedPeer(t, { items: [item] });
  registerPeer(peer.nodeId, peer.port);
  await merge.syncMeshQueues();

  assert.equal(sync.readSyncQueue().length, 2, 'reconnect imports the peer operation alongside local work');
  assert.equal(sync.readSyncQueue().filter((entry) => entry._queue_id === item._queue_id).length, 1);
  assert.ok(meshState.lastQueueRepair.perPeer.some((entry) => entry.nodeId === peer.nodeId && entry.importedCount === 1));
});

test('delayed and out-of-order batch delivery merges deterministically without duplication', async (t) => {
  withIsolatedStore(t);
  const items = [
    bookingItem({ queueId: 'booking-out-of-order-1', bookingId: BOOKING_A, key: 'key-ooo-0000000000001', timestamp: '2026-11-01T08:00:00.000Z' }),
    bookingItem({ queueId: 'booking-out-of-order-2', bookingId: '99999999-0000-4000-8000-000000000002', roomId: ROOM_B, key: 'key-ooo-0000000000002', timestamp: '2026-11-01T08:01:00.000Z' }),
    bookingItem({ queueId: 'booking-out-of-order-3', bookingId: '99999999-0000-4000-8000-000000000003', key: 'key-ooo-0000000000003', timestamp: '2026-11-01T07:59:00.000Z' })
  ];
  const peer = await startSignedPeer(t, { items, reverseItems: true });
  registerPeer(peer.nodeId, peer.port);

  await merge.syncMeshQueues();

  const importedIds = sync.readSyncQueue().map((entry) => entry._queue_id);
  assert.equal(importedIds.length, 3);
  assert.deepEqual([...importedIds].sort(), items.map((item) => item._queue_id).sort(), 'every operation arrives exactly once regardless of delivery order');
  assert.equal(cache.readCache('bookings').length, 3);

  const itemRequests = peer.requests.filter((request) => request.url.startsWith('/mesh/queue/items?'));
  assert.ok(itemRequests.length >= 1);
  for (const request of itemRequests) {
    assert.equal(request.valid, true, 'batches are fetched over the signed channel');
  }

  await merge.syncMeshQueues();
  assert.equal(sync.readSyncQueue().length, 3);
  assert.equal(cache.readCache('bookings').length, 3);
});

test('relayed duplicates and a duplicated device identity collapse to exactly one local operation', async (t) => {
  withIsolatedStore(t);
  const origin = bookingItem({ queueId: 'booking-relay-origin', key: 'key-relay-0000000000001' });
  const relayA = await startSignedPeer(t, { items: [origin], teamNodeId: 'peer-dup-identity' });
  registerPeer('peer-dup-identity', relayA.port);

  await merge.syncMeshQueues();
  assert.equal(sync.readSyncQueue().length, 1);

  const relayB = await startSignedPeer(t, { items: [origin], teamNodeId: 'peer-dup-identity' });
  registerPeer('peer-dup-identity-secondary', relayB.port);
  await merge.syncMeshQueues();

  assert.equal(sync.readSyncQueue().length, 1, 'a relayed copy with the same operation identity never creates a second local operation');
  assert.equal(cache.readCache('bookings').length, 1);
  assert.equal(meshState.lastQueueRepair.importedCount, 0);
});

test('team state sync is additive-only, bounded, and refuses credential material', async (t) => {
  withIsolatedStore(t);

  const tainted = defaultTeamSnapshot('peer-a');
  tainted.attendance = [{ id: 'att-secret', staff_name: 'A', pin: '1234' }];
  const refusedOutcome = stateSync.applyTeamStateSnapshot('peer-a', tainted);
  assert.equal(refusedOutcome.applied, false);
  assert.match(refusedOutcome.reason, /credential material/);
  assert.deepEqual(cache.readCache('restaurant-shifts'), []);

  const clean = defaultTeamSnapshot('peer-a');
  clean.attendance = [{ id: 'att-1', staff_name: 'Cashier One', clock_in: '2026-11-01T06:00:00.000Z', updated_at: '2026-11-01T06:00:00.000Z' }];
  clean.drawerPeriods = [{ id: 'drawer-1', opening_float: 500, updated_at: '2026-11-01T06:00:00.000Z' }];
  const applied = stateSync.applyTeamStateSnapshot('peer-a', clean);
  assert.equal(applied.applied, true);
  assert.equal(applied.added.attendance, 1);
  const rows = cache.readCache('restaurant-shifts');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._mesh_imported, true);
  assert.equal(rows[0]._mesh_source_node_id, 'peer-a');
  assert.equal(rows[0]._pending_sync, true);
  assert.equal(Object.hasOwn(rows[0], 'pin'), false);

  const reapplied = stateSync.applyTeamStateSnapshot('peer-a', clean);
  assert.deepEqual(reapplied.added, {}, 'existing rows are never overwritten by peer state');

  const oversized = defaultTeamSnapshot('peer-b');
  oversized.cashMovements = Array.from({ length: 501 }, (_, index) => ({ id: `move-${index}` }));
  assert.equal(stateSync.applyTeamStateSnapshot('peer-b', oversized).applied, false);
});

test('contract inventory: every offline RPC operation is mesh-allowlisted or explicitly origin-only, and no cache exchange route exists', async () => {
  const domainDir = path.resolve('src/main/domains');
  const domainFiles = await fs.promises.readdir(domainDir, { withFileTypes: true });
  const queuedOperations = new Set();
  const nonRpcQueueCalls = [];
  for (const entry of domainFiles) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const source = await fs.promises.readFile(path.join(domainDir, entry.name), 'utf8');
    for (const match of source.matchAll(/queueOperation\(\s*['"]rpc['"]\s*,\s*['"]([^'"]+)['"]/g)) {
      queuedOperations.add(match[1]);
    }
    for (const match of source.matchAll(/queueOperation\(\s*['"]([^'"]+)['"]/g)) {
      if (match[1] !== 'rpc') nonRpcQueueCalls.push(`${entry.name}:${match[1]}`);
    }
  }
  assert.deepEqual(nonRpcQueueCalls, [], 'all offline mutations must be RPC operations');
  assert.ok(queuedOperations.size > 20, 'the inventory scan actually found queued operations');

  const meshSource = await fs.promises.readFile(path.join(domainDir, 'mesh', 'meshQueueMerge.js'), 'utf8');
  for (const operation of queuedOperations) {
    assert.ok(meshSource.includes(`'${operation}'`), `${operation} is queued offline but missing from the mesh contract`);
  }

  const serverSource = await fs.promises.readFile(path.join(domainDir, 'mesh', 'meshServer.js'), 'utf8');
  assert.match(serverSource, /validateIncomingRequest/, 'every mesh server request is signature-validated');
  assert.doesNotMatch(serverSource, /mesh\/cache/, 'no cache snapshot exchange route may exist');
  for (const route of ['/mesh/hello', '/mesh/capabilities', '/mesh/queue/summary', '/mesh/queue/items', '/mesh/state/team', '/mesh/locks']) {
    assert.ok(serverSource.includes(route), `expected mesh route ${route}`);
  }
});

test('repair and health metadata surface per-peer results, provenance headers, and frozen operator warnings', async (t) => {
  withIsolatedStore(t);
  const panel = await fs.promises.readFile(path.resolve('src/renderer/src/components/SystemHealthPanel.jsx'), 'utf8');
  assert.match(panel, /Repair pass/);
  assert.match(panel, /meshQueueRepair[\s\S]{0,160}missingCount/);

  const serverSource = await fs.promises.readFile(path.resolve('src/main/domains/mesh/meshServer.js'), 'utf8');
  assert.match(serverSource, /operation: item\.table \|\| null/);
  assert.match(serverSource, /createdAt: item\.createdAt \|\| item\.timestamp \|\| null/);

  const meshMerge = await fs.promises.readFile(path.resolve('src/main/domains/mesh/meshQueueMerge.js'), 'utf8');
  assert.match(meshMerge, /appendOperationJournalEntry\('mesh_imported'/);

  const stateSource = await fs.promises.readFile(path.resolve('src/main/domains/mesh/meshState.js'), 'utf8');
  assert.match(stateSource, /lastQueueRepair: meshState\.lastQueueRepair \|\| null/);
  assert.match(stateSource, /mesh-peers\.json/, 'remembered peers must survive restart');

  const discovery = await fs.promises.readFile(path.resolve('src/main/domains/mesh/meshDiscovery.js'), 'utf8');
  assert.match(discovery, /os\.networkInterfaces\(\)/);
  assert.match(discovery, /probeRememberedMeshPeers/);

  await merge.syncMeshQueues();
  const snapshot = getMeshHealthSnapshot();
  assert.ok(snapshot.lastQueueRepair && typeof snapshot.lastQueueRepair.peerCount === 'number');
  assert.ok(Array.isArray(snapshot.warnings));
});
