import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { importDomain, importState, makeTempCacheDir } from './helpers/domain-test-setup.mjs'

const merge = await importDomain('mesh/meshQueueMerge.js')
const conflict = await importDomain('mesh/meshConflict.js')
const security = await importDomain('mesh/meshSecurity.js')
const cache = await importDomain('cacheStore.js')
const sync = await importDomain('syncStore.js')
const { state } = await importState()
const { meshState, getMeshHealthSnapshot } = await importDomain('mesh/meshState.js')
const LODGE = '11111111-1111-4111-8111-111111111111'
const ROOM_A = '22222222-2222-4222-8222-222222222222'
const ROOM_B = '33333333-3333-4333-8333-333333333333'
const ROOM_C = '99999999-9999-4999-8999-999999999999'
const CUSTOMER = '66666666-6666-4666-8666-666666666666'
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LOCAL_CHILD_A = '44444444-4444-4444-8444-444444444444'
const LOCAL_CHILD_B = '55555555-5555-4555-8555-555555555555'
const SECRET = 'isolated-mesh-test-secret'
const IN = '2026-11-05'
const OUT = '2026-11-08'

function groupItem({ queueId = 'booking-group-aaaaaaaa', childIds = [LOCAL_CHILD_A, LOCAL_CHILD_B], rooms = [ROOM_A, ROOM_B], timestamp = '2026-11-02T00:00:00.000Z', groupId = '77777777-7777-4777-8777-777777777777', key = '88888888-8888-4888-8888-888888888888' } = {}) {
  return {
    type: 'rpc',
    table: 'create_multi_room_booking',
    _queue_id: queueId,
    _origin_lodge_id: LODGE,
    _local_booking_ids: childIds,
    _depends_on: "customer-" + CUSTOMER,
    timestamp,
    data: {
      p_lodge_id: LODGE,
      p_customer_id: CUSTOMER,
      p_check_in: IN,
      p_check_out: OUT,
      p_rooms: rooms.map((room_id, index) => ({ room_id, adults: index ? 1 : 2, children: index ? 1 : 0, tents: 0, vehicles: 0 })),
      p_total_amount: null,
      p_deposit_amount: 50,
      p_deposit_method: 'cash',
      p_notes: '[STAY_GROUP] demo',
      p_created_by: ACTOR,
      p_group_key: groupId,
      p_idempotency_key: key
    }
  }
}

function withIsolatedStore(t) {
  const cacheDir = makeTempCacheDir('mesh-multi-room')
  const previousState = { cacheDir: state.cacheDir, lodgeId: state.lodgeId }
  const previousMesh = {
    lodgeId: meshState.lodgeId,
    nodeId: meshState.nodeId,
    lodgeMeshSecret: meshState.lodgeMeshSecret,
    running: meshState.running,
    peers: meshState.peers,
    serverNonceCache: meshState.serverNonceCache
  }
  state.cacheDir = cacheDir
  state.lodgeId = LODGE
  meshState.lodgeId = LODGE
  t.after(() => {
    Object.assign(state, previousState)
    Object.assign(meshState, previousMesh)
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })
  return cacheDir
}

function roomsCache() {
  return [
    { id: ROOM_A, room_number: 'A', room_type: 'Standard', rate_per_night: 100 },
    { id: ROOM_B, room_number: 'B', room_type: 'Standard', rate_per_night: 110 },
    { id: ROOM_C, room_number: 'C', room_type: 'Deluxe', rate_per_night: 160 }
  ]
}

test('the real mesh validator accepts one signed group intent with every room and its stable key', () => {
  const originalLodge = meshState.lodgeId
  meshState.lodgeId = LODGE
  try {
    const item = groupItem()
    assert.equal(merge.isMeshShareableQueueItem(item), true)
    assert.equal(merge.validateSyncQueueItem(item).isValid, true)
  } finally {
    meshState.lodgeId = originalLodge
  }
})

test('the real mesh validator rejects incomplete, duplicate-room, duplicate-child, and foreign-lodge group intents', () => {
  const originalLodge = meshState.lodgeId
  meshState.lodgeId = LODGE
  try {
    const noKey = groupItem()
    delete noKey.data.p_idempotency_key
    const noRooms = groupItem({ rooms: [] })
    const duplicateRooms = groupItem({ rooms: [ROOM_A, ROOM_A] })
    const duplicateChildren = groupItem({ childIds: [LOCAL_CHILD_A, LOCAL_CHILD_A] })
    const foreign = groupItem()
    foreign.data.p_lodge_id = '99999999-9999-4999-8999-999999999999'
    assert.equal(merge.validateSyncQueueItem(noKey).isValid, false)
    assert.equal(merge.validateSyncQueueItem(noRooms).isValid, false)
    assert.equal(merge.validateSyncQueueItem(duplicateRooms).isValid, false)
    assert.equal(merge.validateSyncQueueItem(duplicateChildren).isValid, false)
    assert.equal(merge.validateSyncQueueItem(foreign).isValid, false)
  } finally {
    meshState.lodgeId = originalLodge
  }
})

test('signed peer queue sync imports one durable group intent and projects every room as an estimate', async (t) => {
  const cacheDir = withIsolatedStore(t)
  const item = groupItem({ timestamp: '2026-11-02T00:00:00.000Z' })
  const bodyHash = merge.getQueueItemBodyHash(item)
  const peerNode = 'peer-node-hotel-a'
  const capturedRequests = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const validation = security.validateIncomingRequest(req.method, req.url, req.headers, body, SECRET)
      capturedRequests.push({ method: req.method, path: req.url, headers: { ...req.headers }, body, valid: validation.isValid })
      if (!validation.isValid) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: validation.error }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url === '/mesh/capabilities') {
        res.end(JSON.stringify({ protocolVersion: 2, queueFeatures: ['atomic_multi_room_booking_v1'] }))
      } else if (req.url === '/mesh/queue/summary') {
        res.end(JSON.stringify([{ _queue_id: item._queue_id, operation: item.table, type: item.type, createdAt: item.timestamp, intentId: item.data.p_idempotency_key, bodyHash, operationHash: merge.getQueueItemOperationHash(item) }]))
      } else if (req.url.startsWith('/mesh/queue/items?')) {
        res.end(JSON.stringify([item]))
      } else if (req.url === '/mesh/state/team') {
        res.end(JSON.stringify({ version: 1, nodeId: peerNode, lodgeId: LODGE, at: new Date().toISOString(), attendance: [], cashMovements: [], cashCounts: [], drawerPeriods: [], cashupSubmissions: [] }))
      } else {
        res.end(JSON.stringify({ error: 'unexpected route' }))
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const port = server.address().port
  meshState.nodeId = 'local-node-hotel-b'
  meshState.lodgeMeshSecret = SECRET
  meshState.running = true
  meshState.peers = new Map([[peerNode, { nodeId: peerNode, address: '127.0.0.1', httpPort: port }]])
  meshState.serverNonceCache = new Set()
  cache.writeCache('rooms', roomsCache())

  await merge.syncMeshQueues()

  const importedQueue = sync.readSyncQueue()
  assert.equal(importedQueue.length, 1)
  assert.equal(importedQueue[0].table, 'create_multi_room_booking')
  assert.equal(importedQueue[0].data.p_idempotency_key, item.data.p_idempotency_key)
  assert.deepEqual(importedQueue[0]._local_booking_ids, item._local_booking_ids)
  assert.equal(importedQueue[0]._depends_on, 'customer-' + CUSTOMER)
  const projected = cache.readCache('bookings')
  assert.equal(projected.length, 2)
  assert.deepEqual(projected.map((row) => row.room_id).sort(), [ROOM_A, ROOM_B].sort())
  for (const row of projected) {
    assert.equal(row._financial_estimate, true)
    assert.equal(row._pending_sync, true)
    assert.equal(Object.hasOwn(row, 'total_amount'), false)
    assert.equal(Object.hasOwn(row, 'amount_paid'), false)
    assert.equal(Object.hasOwn(row, 'payment_status'), false)
  }
  assert.ok(capturedRequests.length >= 3)
  assert.ok(capturedRequests.every((request) => request.valid), 'the fake peer verified every actual HMAC request')
  const replayedNonce = security.validateIncomingRequest(
    capturedRequests[0].method,
    capturedRequests[0].path,
    capturedRequests[0].headers,
    capturedRequests[0].body,
    SECRET
  )
  assert.equal(replayedNonce.isValid, false, 'peer request nonce replay is rejected')

  await merge.syncMeshQueues()
  assert.equal(sync.readSyncQueue().length, 1, 'retransmitted peer state must not create a second group operation')
  assert.equal(cache.readCache('bookings').length, 2, 'retransmission must not duplicate child holds')
  const queueFile = path.join(cacheDir, 'sync-queue.json')
  const child = spawnSync(process.execPath, ['-e', 'const fs=require("node:fs");const q=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(JSON.stringify(q.map(x=>({id:x._queue_id,key:x.data.p_idempotency_key,children:x._local_booking_ids}))))', queueFile], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  assert.deepEqual(JSON.parse(child.stdout), [{ id: item._queue_id, key: item.data.p_idempotency_key, children: item._local_booking_ids }], 'a fresh process sees the same one-item group intent after restart')
})

test('a reused mesh queue ID with a changed payload is quarantined and visible for manager review', async (t) => {
  withIsolatedStore(t)
  const local = groupItem()
  const remote = groupItem({ key: '12121212-1212-4121-8121-121212121212', groupId: '13131313-1313-4131-8131-131313131313' })
  const remoteHash = merge.getQueueItemBodyHash(remote)
  const peerNode = 'peer-node-changed-payload'
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const validation = security.validateIncomingRequest(req.method, req.url, req.headers, body, SECRET)
      if (!validation.isValid) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: validation.error }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url === '/mesh/capabilities') {
        res.end(JSON.stringify({ protocolVersion: 2, queueFeatures: ['atomic_multi_room_booking_v1'] }))
      } else if (req.url === '/mesh/queue/summary') {
        res.end(JSON.stringify([{ _queue_id: local._queue_id, operation: remote.table, type: remote.type, createdAt: remote.timestamp, intentId: remote.data.p_idempotency_key, bodyHash: remoteHash, operationHash: merge.getQueueItemOperationHash(remote) }]))
      } else if (req.url.startsWith('/mesh/queue/items?')) {
        res.end(JSON.stringify([remote]))
      } else if (req.url === '/mesh/state/team') {
        res.end(JSON.stringify({ version: 1, nodeId: peerNode, lodgeId: LODGE, at: new Date().toISOString(), attendance: [], cashMovements: [], cashCounts: [], drawerPeriods: [], cashupSubmissions: [] }))
      } else {
        res.writeHead(404)
        res.end('{}')
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  meshState.nodeId = 'local-node-conflict-review'
  meshState.lodgeMeshSecret = SECRET
  meshState.running = true
  meshState.peers = new Map([[peerNode, { nodeId: peerNode, address: '127.0.0.1', httpPort: server.address().port, lastSeenAt: new Date().toISOString() }]])
  meshState.serverNonceCache = new Set()
  sync.writeSyncQueue([local])

  await merge.syncMeshQueues()

  assert.deepEqual(sync.readSyncQueue().map((entry) => entry.data.p_idempotency_key), [local.data.p_idempotency_key])
  const quarantine = JSON.parse(fs.readFileSync(path.join(state.cacheDir, 'sync-mesh-quarantine.json'), 'utf8'))
  assert.equal(quarantine.length, 1)
  assert.match(quarantine[0].reason, /queue ID.*different operation contents/i)
  assert.equal(meshState.lastQueueRepair.conflictCount, 1)
  assert.match(getMeshHealthSnapshot().warnings.join(' '), /mesh queue identity conflict/i)
})
test('a conflicting imported group is quarantined as one operation and every child hold needs review', async (t) => {
  withIsolatedStore(t)
  const item = groupItem({ timestamp: '2026-11-02T00:00:00.000Z' })
  const single = { id: 'local-single-room-booking', room_id: ROOM_A, check_in: IN, check_out: OUT, status: 'confirmed', created_at: '2026-11-01T00:00:00.000Z' }
  cache.writeCache('rooms', roomsCache())
  cache.writeCache('bookings', [single])
  sync.writeSyncQueue([item])
  merge.applyImportedBookingCacheEffects([item])

  await conflict.detectConflicts()

  const pending = sync.readSyncQueue()
  const failed = sync.readFailedSyncQueue()
  assert.equal(pending.length, 0)
  assert.equal(failed.length, 1)
  assert.equal(failed[0].table, 'create_multi_room_booking')
  assert.equal(failed[0].data.p_idempotency_key, item.data.p_idempotency_key)
  assert.equal(failed[0].manualRetryOnly, true)
  const children = cache.readCache('bookings').filter((row) => item._local_booking_ids.includes(row.id))
  assert.equal(children.length, 2)
  assert.ok(children.every((row) => row._sync_state === 'manual_review_required'))
  assert.ok(children.every((row) => row._financial_estimate === true))
})

test('overlapping multi-room groups remain two atomic operations and the deterministic loser is reviewed', async (t) => {
  withIsolatedStore(t)
  const earlier = groupItem({ queueId: 'booking-group-earlier', childIds: [LOCAL_CHILD_A, LOCAL_CHILD_B], timestamp: '2026-11-01T00:00:00.000Z', groupId: '77777777-7777-4777-8777-777777777777', key: '88888888-8888-4888-8888-888888888888' })
  const later = groupItem({ queueId: 'booking-group-later', childIds: ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'], timestamp: '2026-11-02T00:00:00.000Z', groupId: '99999999-8888-4777-8777-777777777777', key: '99999999-8888-4888-8888-888888888888' })
  cache.writeCache('rooms', roomsCache())
  sync.writeSyncQueue([earlier, later])
  merge.applyImportedBookingCacheEffects([earlier, later])

  await conflict.detectConflicts()

  const pending = sync.readSyncQueue()
  const failed = sync.readFailedSyncQueue()
  assert.equal(pending.length, 1)
  assert.equal(pending[0]._queue_id, earlier._queue_id)
  assert.equal(failed.length, 1)
  assert.equal(failed[0]._queue_id, later._queue_id)
  const childIds = new Set(later._local_booking_ids)
  const reviewed = cache.readCache('bookings').filter((row) => childIds.has(row.id))
  assert.equal(reviewed.length, 2)
  assert.ok(reviewed.every((row) => row._sync_state === 'manual_review_required'))
  assert.equal(sync.readSyncQueue().filter((row) => row.table === 'create_booking').length, 0, 'children never become independent booking operations')
})