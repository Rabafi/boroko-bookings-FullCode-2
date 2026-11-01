import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadConfig, loadWitnessConfig } from '../dist/config.js'
import { compareLsn, createFailoverController } from '../dist/operations/failover.js'
import { startServer } from '../dist/server.js'
import {
  createWitnessRequestHandler,
  signWitnessRequest,
  WitnessClient,
  WitnessError,
  WitnessStore
} from '../dist/operations/witness.js'
import { createWitnessServer } from '../dist/witnessServer.js'

const KEY = 'witness-test-key-0123456789abcdef0123456789'
const CLUSTER = 'bar-test-cluster'

function rootFor(name) {
  const root = path.join(os.tmpdir(), `bar-failover-${name}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(path.join(root, 'backups'), { recursive: true })
  return root
}

function witnessConfig(name, overrides = {}) {
  const root = rootFor(name)
  return loadWitnessConfig({
    BAR_LOCAL_WITNESS_CLUSTER_ID: CLUSTER,
    BAR_LOCAL_WITNESS_KEY: KEY,
    BAR_LOCAL_WITNESS_STATE_FILE: path.join(root, 'witness-state.json'),
    BAR_LOCAL_WITNESS_HTTP_HOST: '127.0.0.1',
    BAR_LOCAL_WITNESS_HTTP_PORT: '8790',
    ...overrides
  }, { root })
}

function failoverConfig(name, role, overrides = {}) {
  const root = rootFor(name)
  return loadConfig({
    BAR_LOCAL_BACKUP_DIR: path.join(root, 'backups'),
    BAR_LOCAL_BACKUP_RETENTION_HOURLY: '12',
    BAR_LOCAL_BACKUP_RETENTION_DAILY: '5',
    BAR_LOCAL_BACKUP_RETENTION_WEEKLY: '3',
    BAR_LOCAL_FAILOVER_MODE: 'witness',
    BAR_LOCAL_FAILOVER_ROLE: role,
    BAR_LOCAL_FAILOVER_CLUSTER_ID: CLUSTER,
    BAR_LOCAL_FAILOVER_INSTANCE_ID: `instance-${role}`,
    BAR_LOCAL_FAILOVER_WITNESS_URL: 'http://127.0.0.1:8790',
    BAR_LOCAL_FAILOVER_KEY: 'failover-test-key-0123456789abcdef0123',
    BAR_LOCAL_FAILOVER_LEASE_TTL_MS: '30000',
    BAR_LOCAL_FAILOVER_RENEW_INTERVAL_MS: '5000',
    BAR_LOCAL_FAILOVER_POLL_INTERVAL_MS: '5000',
    ...(role === 'standby'
      ? { BAR_LOCAL_ADMIN_DATABASE_URL: 'postgres://bar_local_admin:pw@127.0.0.1:5432/bar_local' }
      : {}),
    ...overrides
  }, { root })
}

function snapshot(overrides = {}) {
  return {
    cluster_id: CLUSTER,
    epoch: 1,
    holder_id: null,
    holder_role: null,
    lease_expires_at: null,
    leased: false,
    holder_lsn: '0/100',
    holder_lsn_at: null,
    holder_durability: 'synchronous',
    authority_url: null,
    server_time: Date.now(),
    ...overrides
  }
}

function localState(overrides = {}) {
  return {
    fenced: false,
    fence_epoch: 0,
    fence_reason: null,
    authority_epoch: 1,
    promoted_epoch: null,
    in_recovery: overrides.in_recovery ?? false,
    ...overrides
  }
}

function controllerDeps({ local, position, durability, witness, fenced = [], promoted = [] }) {
  return {
    query: async (sql) => {
      if (sql.includes('service_failover_status')) return { rows: [{ result: local }] }
      if (sql.includes('pg_is_in_recovery')) return { rows: [position] }
      if (sql.includes('synchronous_commit')) return { rows: [durability] }
      if (sql.includes('pg_stat_replication')) return { rows: [{ streaming: 1 }] }
      throw new Error(`Unexpected SQL in failover test: ${sql}`)
    },
    witness,
    fence: async (reason) => { fenced.push(reason) },
    promote: async (epoch, evidence) => { promoted.push({ epoch, evidence }) },
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes('pg_promote')) return { rows: [{ promoted: true }] }
        if (sql.includes('pg_is_in_recovery')) return { rows: [{ in_recovery: false }] }
        return { rows: [{}] }
      },
      end: async () => {}
    }),
    durability: async () => {},
    sleep: async () => {}
  }
}

function fakeWitness(state, grant) {
  const calls = { acquire: [], release: [] }
  return {
    calls,
    async state() { return state.value ?? state },
    async acquire(input) {
      calls.acquire.push(input)
      return grant
    },
    async release(input) {
      calls.release.push(input)
    }
  }
}

// ---------------------------------------------------------------------------
// Witness store
// ---------------------------------------------------------------------------

test('witness store bumps the epoch once per holder change and never for a refresh', () => {
  const config = witnessConfig('epochs')
  const store = WitnessStore.open(config.stateFile, CLUSTER)
  assert.equal(store.snapshot().epoch, 0)

  const first = store.acquire({ holderId: 'host-a', role: 'primary', ttlMs: 30000, lsn: '0/10', durability: 'synchronous' }, 1000)
  assert.equal(first.epoch, 1)

  const refresh = store.acquire({ holderId: 'host-a', role: 'primary', ttlMs: 30000, lsn: '0/20', durability: 'synchronous' }, 2000)
  assert.equal(refresh.epoch, 1)

  assert.throws(
    () => store.acquire({ holderId: 'host-b', role: 'primary', ttlMs: 30000 }, 3000),
    (error) => error instanceof WitnessError && error.code === 'WITNESS_LEASE_HELD'
  )

  // After expiry a different holder receives exactly the next epoch.
  const takeOver = store.acquire({ holderId: 'host-b', role: 'primary', ttlMs: 30000, lsn: '0/30', durability: 'synchronous' }, 60000)
  assert.equal(takeOver.epoch, 2)
  const after = store.snapshot(60000)
  assert.equal(after.holder_id, 'host-b')
  assert.equal(after.holder_durability, 'synchronous')
  // A new holder must not inherit the previous host's WAL position.
  assert.equal(after.holder_lsn, '0/30')
})

test('witness store refuses a stale renew and records durability', () => {
  const config = witnessConfig('renew')
  const store = WitnessStore.open(config.stateFile, CLUSTER)
  store.acquire({ holderId: 'host-a', role: 'primary', ttlMs: 30000, durability: 'single_host' }, 1000)
  const renewed = store.renew({ holderId: 'host-a', epoch: 1, ttlMs: 30000, durability: 'synchronous' }, 2000)
  assert.equal(renewed.epoch, 1)
  assert.equal(store.snapshot(2000).holder_durability, 'synchronous')
  assert.throws(
    () => store.renew({ holderId: 'host-a', epoch: 0, ttlMs: 30000 }, 2500),
    (error) => error instanceof WitnessError && error.code === 'WITNESS_BODY_INVALID'
  )
  assert.throws(
    () => store.renew({ holderId: 'host-b', epoch: 1, ttlMs: 30000 }, 2500),
    (error) => error instanceof WitnessError && error.code === 'WITNESS_LEASE_LOST'
  )
})

test('witness store fails closed on a corrupt, missing or foreign state file', () => {
  const config = witnessConfig('corrupt')
  const store = WitnessStore.open(config.stateFile, CLUSTER)
  store.acquire({ holderId: 'host-a', role: 'primary', ttlMs: 30000 }, 1000)

  const original = JSON.parse(readFileSync(config.stateFile, 'utf8'))
  writeFileSync(config.stateFile, JSON.stringify({ ...original, epoch: 99 }), 'utf8')
  assert.throws(
    () => WitnessStore.open(config.stateFile, CLUSTER),
    (error) => error instanceof WitnessError && error.code === 'WITNESS_STATE_CORRUPT'
  )

  writeFileSync(config.stateFile, JSON.stringify(original), 'utf8')
  assert.throws(
    () => WitnessStore.open(config.stateFile, 'another-cluster'),
    (error) => error instanceof WitnessError && error.code === 'WITNESS_STATE_CLUSTER_MISMATCH'
  )

  rmSync(config.stateFile)
  assert.throws(
    () => WitnessStore.open(config.stateFile, CLUSTER),
    (error) => error instanceof WitnessError && error.code === 'WITNESS_STATE_MISSING'
  )
})

// ---------------------------------------------------------------------------
// HMAC transport
// ---------------------------------------------------------------------------

async function listen(handler) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    void handler(req, res, url, () => new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, port, close: () => new Promise((resolve) => server.close(resolve)) }
}

function signedHeaders({ method, pathname, body, timestamp, nonce, cluster = CLUSTER, key = KEY }) {
  return {
    'content-type': 'application/json',
    'x-bar-witness-cluster': cluster,
    'x-bar-witness-timestamp': String(timestamp),
    'x-bar-witness-nonce': nonce,
    'x-bar-witness-signature': signWitnessRequest(key, { method, path: pathname, timestamp, nonce, body })
  }
}

test('witness HTTP surface authenticates, refuses replay and checks the cluster', async (t) => {
  const config = witnessConfig('http')
  const store = WitnessStore.open(config.stateFile, CLUSTER)
  const server = createWitnessServer(config, store)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`

  const health = await fetch(`${base}/v1/witness/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.json()).status, 'live')

  const unsigned = await fetch(`${base}/v1/witness/state`)
  assert.equal(unsigned.status, 401)

  const now = Date.now()
  const body = JSON.stringify({ holder_id: 'host-a', role: 'primary', ttl_ms: 30000, durability: 'synchronous' })
  const headers = signedHeaders({ method: 'POST', pathname: '/v1/witness/lease/acquire', body, timestamp: now, nonce: 'a'.repeat(32) })
  const acquired = await fetch(`${base}/v1/witness/lease/acquire`, { method: 'POST', body, headers })
  assert.equal(acquired.status, 200)
  const grant = (await acquired.json()).grant
  assert.equal(grant.epoch, 1)

  const replayed = await fetch(`${base}/v1/witness/lease/acquire`, { method: 'POST', body, headers })
  assert.equal(replayed.status, 409)
  assert.equal((await replayed.json()).code, 'WITNESS_REPLAY')

  const foreignBody = JSON.stringify({ holder_id: 'host-b', role: 'primary', ttl_ms: 30000 })
  const foreign = await fetch(`${base}/v1/witness/lease/acquire`, {
    method: 'POST',
    body: foreignBody,
    headers: signedHeaders({
      method: 'POST',
      pathname: '/v1/witness/lease/acquire',
      body: foreignBody,
      timestamp: Date.now(),
      nonce: 'b'.repeat(32),
      cluster: 'other-cluster'
    })
  })
  assert.equal(foreign.status, 403)

  const skewed = await fetch(`${base}/v1/witness/state`, {
    headers: signedHeaders({
      method: 'GET',
      pathname: '/v1/witness/state',
      body: '',
      timestamp: now - 600000,
      nonce: 'c'.repeat(32)
    })
  })
  assert.equal(skewed.status, 401)

  const releaseBody = JSON.stringify({ holder_id: 'host-a', epoch: 1 })
  const released = await fetch(`${base}/v1/witness/lease/release`, {
    method: 'POST',
    body: releaseBody,
    headers: signedHeaders({
      method: 'POST',
      pathname: '/v1/witness/lease/release',
      body: releaseBody,
      timestamp: Date.now(),
      nonce: 'e'.repeat(32)
    })
  })
  assert.equal(released.status, 200)
  assert.equal((await released.json()).state.leased, false)
})

test('witness request handler rejects a tampered signature', async () => {
  const store = WitnessStore.open(witnessConfig('tamper').stateFile, CLUSTER)
  const handle = createWitnessRequestHandler({ store, key: KEY, clusterId: CLUSTER })
  const now = Date.now()
  const body = JSON.stringify({ holder_id: 'host-a', role: 'primary', ttl_ms: 30000 })
  const headers = signedHeaders({ method: 'POST', pathname: '/v1/witness/lease/acquire', body, timestamp: now, nonce: 'd'.repeat(32) })
  headers['x-bar-witness-signature'] = '0'.repeat(64)
  const req = { method: 'POST', headers }
  const res = { writeHead(status) { this.status = status }, end(payload) { this.payload = payload } }
  const handled = await handle(req, res, new URL('http://127.0.0.1/v1/witness/lease/acquire'), async () => body)
  assert.equal(handled, true)
  assert.equal(res.status, 401)
  assert.equal(JSON.parse(res.payload).code, 'WITNESS_AUTH_INVALID')
})

test('real WitnessClient releases its lease through the authenticated canonical route', async (t) => {
  const config = witnessConfig('client-release')
  const store = WitnessStore.open(config.stateFile, CLUSTER)
  const server = createWitnessServer(config, store)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const client = new WitnessClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, clusterId: CLUSTER, key: KEY })
  const grant = await client.acquire({ holderId: 'host-a', role: 'primary', ttlMs: 30000 })
  const released = await client.release({ holderId: 'host-a', epoch: grant.epoch })
  assert.equal(released.leased, false)
  assert.equal((await client.state()).leased, false)
})

test('production service refuses witness mode before opening its listener', async () => {
  const config = failoverConfig('production-refusal', 'primary')
  await assert.rejects(startServer({ config, port: 0, logger: { info() {}, error() {} } }), /Witness automatic failover is unavailable/)
})

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

test('disabled failover keeps the gate open and does not touch the witness', async () => {
  const root = rootFor('disabled')
  const config = loadConfig({
    BAR_LOCAL_BACKUP_DIR: path.join(root, 'backups')
  }, { root })
  const controller = createFailoverController({ config, pool: {} })
  controller.start()
  assert.equal(controller.gate.allowWrites(), true)
  const decision = await controller.checkNow()
  assert.equal(decision.decision, 'DISABLED')
  const status = await controller.status()
  assert.equal(status.automatic_failover.verified, false)
  await controller.stop()
})

test('primary holds the gate open only at the witness epoch', async () => {
  const config = failoverConfig('primary-ok', 'primary')
  let now = 0
  const witness = fakeWitness(
    snapshot({ epoch: 1, holder_id: 'instance-primary', leased: true, lease_expires_at: Date.now() + 30000 }),
    { epoch: 1, holder_id: 'instance-primary', expires_at: Date.now() + 30000, server_time: Date.now() }
  )
  const controller = createFailoverController({
    config,
    pool: {},
    dependencies: {
      ...controllerDeps({
        local: localState(),
        position: { in_recovery: false, lsn: '0/200' },
        durability: { synchronous_commit: 'on', synchronous_standby_names: 'ANY 1 (*)' },
        witness
      }),
      monotonicNow: () => now,
      now: () => new Date()
    }
  })
  controller.start()
  assert.equal(controller.gate.allowWrites(), false, 'a restart must not serve before verification')
  const decision = await controller.checkNow()
  assert.equal(decision.decision, 'HEALTHY_PRIMARY')
  assert.equal(controller.gate.allowWrites(), true)
  assert.equal(witness.calls.acquire[0].durability, 'synchronous')
  const status = await controller.status()
  assert.equal(status.automatic_failover.verified, false)
  assert.equal(status.durability.reported, 'synchronous')
  await controller.stop()
  assert.equal(witness.calls.release.length, 1, 'a planned shutdown releases the lease instead of waiting for the TTL')
})

test('a stale lease closes the write gate even without a controller poll', async () => {
  const config = failoverConfig('stale-gate', 'primary')
  let now = 0
  const witness = fakeWitness(
    snapshot({ epoch: 1, holder_id: 'instance-primary', leased: true, lease_expires_at: Date.now() + 30000 }),
    { epoch: 1, holder_id: 'instance-primary', expires_at: Date.now() + 30000, server_time: Date.now() }
  )
  const controller = createFailoverController({ config, pool: {}, dependencies: {
    ...controllerDeps({ local: localState(), position: { in_recovery: false, lsn: '0/200' },
      durability: { synchronous_commit: 'on', synchronous_standby_names: 'ANY 1 (*)' }, witness }),
    monotonicNow: () => now
  } })
  assert.equal((await controller.checkNow()).decision, 'HEALTHY_PRIMARY')
  assert.equal(controller.gate.allowWrites(), true)
  now = 60000
  assert.equal(controller.gate.allowWrites(), false)
  assert.equal(controller.gate.reason(), 'LEASE_EXPIRED')
  await controller.stop()
})

test('primary closes the gate immediately when the witness lease cannot be renewed', async () => {
  const config = failoverConfig('primary-loss', 'primary')
  let mono = 0
  let serving = true
  const witness = {
    state: async () => {
      if (!serving) throw new WitnessError('WITNESS_UNREACHABLE', 'witness offline')
      return snapshot({ epoch: 1, holder_id: 'instance-primary', leased: true, lease_expires_at: Date.now() + 30000 })
    },
    acquire: async () => ({ epoch: 1, holder_id: 'instance-primary', expires_at: Date.now() + 30000, server_time: Date.now() }),
    release: async () => {}
  }
  const fenced = []
  const controller = createFailoverController({
    config,
    pool: {},
    dependencies: {
      ...controllerDeps({
        local: localState(),
        position: { in_recovery: false, lsn: '0/200' },
        durability: { synchronous_commit: 'on', synchronous_standby_names: 'ANY 1 (*)' },
        witness,
        fenced
      }),
      monotonicNow: () => mono
    }
  })
  controller.start()
  assert.equal((await controller.checkNow()).decision, 'HEALTHY_PRIMARY')
  assert.equal(controller.gate.allowWrites(), true)

  serving = false
  const beforeDeadline = await controller.checkNow()
  assert.equal(beforeDeadline.decision, 'WITNESS_UNREACHABLE')
  assert.equal(controller.gate.allowWrites(), false, 'the gate closes before the lease expires')
  assert.deepEqual(fenced, [])

  mono = 60000
  const afterDeadline = await controller.checkNow()
  assert.equal(afterDeadline.decision, 'LEASE_LOST')
  assert.deepEqual(fenced, ['WITNESS_LEASE_LOST'])
  assert.equal(controller.gate.allowWrites(), false)
  await controller.stop()
})

test('primary fences itself when another host holds the lease', async () => {
  const config = failoverConfig('primary-other', 'primary')
  const witness = fakeWitness(
    snapshot({ epoch: 2, holder_id: 'instance-standby', leased: true, lease_expires_at: Date.now() + 30000 }),
    { epoch: 2, holder_id: 'instance-primary', expires_at: 0, server_time: 0 }
  )
  const fenced = []
  const controller = createFailoverController({
    config,
    pool: {},
    dependencies: controllerDeps({
      local: localState(),
      position: { in_recovery: false, lsn: '0/200' },
      durability: { synchronous_commit: 'on', synchronous_standby_names: 'ANY 1 (*)' },
      witness,
      fenced
    })
  })
  const decision = await controller.checkNow()
  assert.equal(decision.decision, 'LEASE_HELD_BY_OTHER')
  assert.deepEqual(fenced, ['LEASE_HELD_BY_OTHER'])
  assert.equal(controller.gate.allowWrites(), false)
})

test('primary refuses a witness epoch ahead of its database', async () => {
  const config = failoverConfig('primary-stale', 'primary')
  const witness = fakeWitness(snapshot({ epoch: 1, leased: false }), {
    epoch: 2,
    holder_id: 'instance-primary',
    expires_at: Date.now() + 30000,
    server_time: Date.now()
  })
  const fenced = []
  const controller = createFailoverController({
    config,
    pool: {},
    dependencies: controllerDeps({
      local: localState(),
      position: { in_recovery: false, lsn: '0/200' },
      durability: { synchronous_commit: 'on', synchronous_standby_names: 'ANY 1 (*)' },
      witness,
      fenced
    })
  })
  const decision = await controller.checkNow()
  assert.equal(decision.decision, 'WITNESS_EPOCH_AHEAD')
  assert.deepEqual(fenced, ['STALE_AUTHORITY_EPOCH'])
  assert.equal(witness.calls.release.length, 1)
  assert.equal(controller.gate.allowWrites(), false)
})

test('standby waits for replay catch-up instead of promoting', async () => {
  const config = failoverConfig('standby-behind', 'standby')
  const witness = fakeWitness(snapshot({ epoch: 1, holder_lsn: '0/500' }), {
    epoch: 2,
    holder_id: 'instance-standby',
    expires_at: Date.now() + 30000,
    server_time: Date.now()
  })
  const promoted = []
  const controller = createFailoverController({
    config,
    pool: {},
    dependencies: controllerDeps({
      local: localState({ in_recovery: true }),
      position: { in_recovery: true, lsn: '0/100' },
      durability: { synchronous_commit: 'on', synchronous_standby_names: '' },
      witness,
      promoted
    })
  })
  const decision = await controller.checkNow()
  assert.equal(decision.decision, 'WAITING_FOR_CATCHUP')
  assert.ok(decision.blockers.includes('standby_behind_primary_lsn'))
  assert.deepEqual(promoted, [])
  assert.equal(witness.calls.acquire.length, 0)
})

test('standby refuses promotion when the primary was not synchronously durable', async () => {
  const config = failoverConfig('standby-durability', 'standby')
  const witness = fakeWitness(snapshot({ epoch: 1, holder_lsn: '0/100', holder_durability: 'single_host' }), {
    epoch: 2,
    holder_id: 'instance-standby',
    expires_at: Date.now() + 30000,
    server_time: Date.now()
  })
  const promoted = []
  const controller = createFailoverController({
    config,
    pool: {},
    dependencies: controllerDeps({
      local: localState({ in_recovery: true }),
      position: { in_recovery: true, lsn: '0/200' },
      durability: { synchronous_commit: 'on', synchronous_standby_names: '' },
      witness,
      promoted
    })
  })
  const decision = await controller.checkNow()
  assert.equal(decision.decision, 'WAITING_FOR_CATCHUP')
  assert.ok(decision.blockers.includes('primary_durability_not_synchronous'))
  assert.deepEqual(promoted, [])
})

test('standby promotes once, bumps the epoch by one and opens the gate', async () => {
  const config = failoverConfig('standby-promote', 'standby')
  const witness = fakeWitness(snapshot({ epoch: 1, holder_id: 'instance-primary', holder_lsn: '0/100' }), {
    epoch: 2,
    holder_id: 'instance-standby',
    expires_at: Date.now() + 30000,
    server_time: Date.now()
  })
  const promoted = []
  const controller = createFailoverController({
    config,
    pool: {},
    dependencies: controllerDeps({
      local: localState({ in_recovery: true }),
      position: { in_recovery: true, lsn: '0/200' },
      durability: { synchronous_commit: 'on', synchronous_standby_names: '' },
      witness,
      promoted
    })
  })
  controller.start()
  assert.equal(controller.gate.allowWrites(), false)
  const decision = await controller.checkNow()
  assert.equal(decision.decision, 'PROMOTED')
  assert.equal(controller.gate.allowWrites(), true)
  assert.equal(promoted.length, 1)
  assert.equal(promoted[0].epoch, 2)
  assert.equal(promoted[0].evidence.previous_authority_epoch, 1)
  assert.equal(promoted[0].evidence.replay_lsn, '0/200')
  assert.equal(promoted[0].evidence.primary_lsn, '0/100')
  const status = await controller.status()
  assert.equal(status.gate.open, true)
  assert.equal(status.durability.downgraded, true)
  await controller.stop()
})

test('standby refuses an epoch gap and fences instead of promoting', async () => {
  const config = failoverConfig('standby-gap', 'standby')
  const witness = fakeWitness(snapshot({ epoch: 1, holder_lsn: '0/100' }), {
    epoch: 3,
    holder_id: 'instance-standby',
    expires_at: Date.now() + 30000,
    server_time: Date.now()
  })
  const promoted = []
  const fenced = []
  const controller = createFailoverController({
    config,
    pool: {},
    dependencies: controllerDeps({
      local: localState({ in_recovery: true }),
      position: { in_recovery: true, lsn: '0/200' },
      durability: { synchronous_commit: 'on', synchronous_standby_names: '' },
      witness,
      promoted,
      fenced
    })
  })
  const decision = await controller.checkNow()
  assert.equal(decision.decision, 'PROMOTION_REFUSED')
  assert.deepEqual(promoted, [])
  assert.deepEqual(fenced, ['PROMOTION_EPOCH_GAP'])
  assert.equal(controller.gate.allowWrites(), false)
})

test('operator fence closes the gate and reports the reason', async () => {
  const config = failoverConfig('manual-fence', 'primary')
  const witness = fakeWitness(snapshot({ epoch: 1, leased: false }), { epoch: 1, holder_id: 'instance-primary', expires_at: Date.now() + 30000, server_time: Date.now() })
  const fenced = []
  const controller = createFailoverController({
    config,
    pool: {},
    dependencies: controllerDeps({
      local: localState(),
      position: { in_recovery: false, lsn: '0/200' },
      durability: { synchronous_commit: 'on', synchronous_standby_names: 'ANY 1 (*)' },
      witness,
      fenced
    })
  })
  await controller.checkNow()
  assert.equal(controller.gate.allowWrites(), true)
  const status = await controller.fence('OPERATOR_FENCE')
  assert.deepEqual(fenced, ['OPERATOR_FENCE'])
  assert.equal(status.gate.open, false)
  assert.equal(status.gate.reason, 'OPERATOR_FENCE')
  await assert.rejects(() => controller.fence('not-a-code'), /upper-case fence reason/)
})

test('LSN comparison is numeric across the split point', () => {
  assert.equal(compareLsn('0/100', '0/1FF'), -1)
  assert.equal(compareLsn('0/1FF', '0/1FF'), 0)
  assert.equal(compareLsn('1/0', '0/FFFF'), 1)
  assert.equal(compareLsn('A/B', 'A/C'), -1)
  assert.throws(() => compareLsn('not-an-lsn', '0/1'), /LSN/)
})
