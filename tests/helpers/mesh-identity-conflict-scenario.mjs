import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { importDomain, importState, makeTempCacheDir } from './domain-test-setup.mjs'

const LODGE = '11111111-1111-4111-8111-111111111111'
const SECRET = 'isolated-bar-guide-mesh-test-secret'

function orderItem({ total = 111, itemName = 'River Lager' } = {}) {
  return {
    type: 'rpc',
    table: 'create_pos_order_v3',
    _queue_id: 'bar-pos-sale-intent-0001',
    _state: 'pending',
    _origin_lodge_id: LODGE,
    timestamp: '2026-10-06T07:45:00.000Z',
    data: {
      p_lodge_id: LODGE,
      payload: {
        id: 'demo-pos-order-0001',
        lodge_id: LODGE,
        catalog_snapshot_id: 'demo-catalog-snapshot-0001',
        shift_id: 'demo-bar-shift-0001',
        source_device_id: 'local-bar-demo-01',
        create_idempotency_key: 'bar-sale-stable-intent-00000001',
        total,
        items: [{ menu_item_id: 'demo-river-lager', item_name: itemName, quantity: 2, unit_price: 28 }]
      }
    }
  }
}

export async function createSignedPeerIdentityConflictSnapshot() {
  const merge = await importDomain('mesh/meshQueueMerge.js')
  const security = await importDomain('mesh/meshSecurity.js')
  const syncStore = await importDomain('syncStore.js')
  const syncDomain = await importDomain('sync.js')
  const statusDomain = await importDomain('syncStatus.js')
  const { state } = await importState()
  const { meshState, getMeshHealthSnapshot } = await importDomain('mesh/meshState.js')
  const { BrowserWindow } = await import('electron')
  const previousGetAllWindows = BrowserWindow.getAllWindows
  const cacheDir = makeTempCacheDir('bar-mesh-identity-guide')
  const previousState = Object.fromEntries(['cacheDir', 'lodgeId', 'isOnline', 'syncInProgress'].map((key) => [key, state[key]]))
  const previousMesh = Object.fromEntries(['lodgeId', 'nodeId', 'lodgeMeshSecret', 'running', 'peers', 'serverNonceCache', 'lastQueueMergeAt', 'lastQueueRepair', 'lastTeamSync', 'localInterfaces', 'lastError', 'lastDiscoveryError'].map((key) => [key, meshState[key]]))
  const peerNode = 'peer-bar-demo-02'
  const local = orderItem()
  const remote = orderItem({ total: 112 })
  const remoteHash = merge.getQueueItemBodyHash(remote)
  let server

  try {
    Object.assign(state, { cacheDir, lodgeId: LODGE, isOnline: true, syncInProgress: false })
    BrowserWindow.getAllWindows = () => []
    Object.assign(meshState, {
      lodgeId: LODGE,
      nodeId: 'local-bar-demo-01',
      lodgeMeshSecret: SECRET,
      running: true,
      peers: new Map(),
      serverNonceCache: new Set(),
      lastQueueMergeAt: null,
      lastQueueRepair: null,
      lastTeamSync: null,
      localInterfaces: [{ address: '192.168.1.10', family: 'IPv4', internal: false }],
      lastError: null,
      lastDiscoveryError: null
    })

    server = http.createServer((req, res) => {
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
          res.end(JSON.stringify([{
            _queue_id: local._queue_id,
            operation: remote.table,
            type: remote.type,
            createdAt: remote.timestamp,
            intentId: remote.data.payload.create_idempotency_key,
            bodyHash: remoteHash,
            operationHash: merge.getQueueItemOperationHash(remote)
          }]))
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
    meshState.peers = new Map([[peerNode, { nodeId: peerNode, address: '127.0.0.1', httpPort: server.address().port, lastSeenAt: new Date().toISOString() }]])
    syncStore.writeSyncQueue([local])

    await merge.syncMeshQueues()

    const details = syncDomain.getSyncDetails()
    const status = statusDomain.buildSyncStatusSnapshot()
    const diagnostics = getMeshHealthSnapshot()
    const quarantine = JSON.parse(fs.readFileSync(path.join(cacheDir, 'sync-mesh-quarantine.json'), 'utf8'))
    const queueShape = (row) => ({
      _queue_id: row._queue_id,
      table: row.table,
      type: row.type,
      _state: row._state || 'pending',
      isFinancial: row.isFinancial === true,
      displayError: row.displayError || undefined,
      dependencyLabel: row.dependencyLabel || undefined,
      data: {
        p_lodge_id: row.data?.p_lodge_id,
        p_idempotency_key: row.data?.p_idempotency_key || row.data?.payload?.create_idempotency_key,
        payload: row.data?.payload ? {
          operation_id: row.data.payload.operation_id,
          order_id: row.data.payload.order_id,
          total: row.data.payload.total
        } : undefined
      }
    })
    return JSON.parse(JSON.stringify({
      scenario: 'signed-peer-pos-identity-conflict',
      generatedAt: new Date().toISOString(),
      syncStatus: {
        pending: status.pending,
        failed: status.failed,
        isOnline: status.isOnline,
        mesh: status.mesh ? {
          warnings: status.mesh.warnings,
          conflictCount: status.mesh.lastQueueRepair?.conflictCount || 0
        } : null
      },
      syncDetails: {
        pendingCount: details.pendingCount,
        failedCount: details.failedCount,
        pending: details.pending.map(queueShape),
        failed: details.failed.map(queueShape),
        faults: details.faults.map((fault) => ({ type: fault.type, severity: fault.severity, message: fault.message, context: fault.context }))
      },
      meshDiagnostics: {
        running: diagnostics.running,
        httpPort: diagnostics.httpPort,
        peerCount: diagnostics.peerCount,
        lastQueueMergeAt: diagnostics.lastQueueMergeAt,
        lastQueueRepair: {
          importedCount: diagnostics.lastQueueRepair?.importedCount || 0,
          conflictCount: diagnostics.lastQueueRepair?.conflictCount || 0,
          perPeer: diagnostics.lastQueueRepair?.perPeer?.map((peer) => ({ identityConflictCount: peer.identityConflictCount || 0 })) || []
        },
        warnings: diagnostics.warnings,
        peers: diagnostics.peers.map((peer) => ({ nodeId: peer.nodeId, address: peer.address, lastSeenAt: peer.lastSeenAt }))
      },
      quarantine: quarantine.map((entry) => ({
        reason: entry.reason,
        queue_id: entry.item?._queue_id,
        operation: entry.item?.table,
        intent_id: entry.item?.data?.p_idempotency_key || entry.item?.data?.payload?.create_idempotency_key,
        incoming_total: entry.item?.data?.payload?.total
      }))
    }))
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve))
    Object.assign(state, previousState)
    Object.assign(meshState, previousMesh)
    if (previousGetAllWindows === undefined) delete BrowserWindow.getAllWindows
    else BrowserWindow.getAllWindows = previousGetAllWindows
    fs.rmSync(cacheDir, { recursive: true, force: true })
  }
}
