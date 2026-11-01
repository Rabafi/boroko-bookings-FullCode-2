import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadWitnessConfig } from '../dist/config.js'
import { startWitnessServer } from '../dist/witnessServer.js'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'

const KEY = 'api-failover-shared-key-0123456789abcdef'
const CLUSTER = 'bar-api-failover'

async function waitForGate(h, auth, expected) {
  let last = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    last = await h.request('/v1/admin/failover', { method: 'GET', ...auth })
    if (last.body?.failover?.gate?.open === expected) return last
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return last
}

test('test-only witness controller gates HTTP trading and exposes an audited fence route', async (t) => {
  const witnessRoot = path.join(os.tmpdir(), `bar-witness-api-${process.pid}-${Date.now()}`)
  mkdirSync(witnessRoot, { recursive: true })
  const witnessConfig = loadWitnessConfig({
    BAR_LOCAL_WITNESS_CLUSTER_ID: CLUSTER,
    BAR_LOCAL_WITNESS_KEY: KEY,
    BAR_LOCAL_WITNESS_STATE_FILE: path.join(witnessRoot, 'state.json'),
    BAR_LOCAL_WITNESS_HTTP_HOST: '127.0.0.1'
  }, { root: witnessRoot })
  const witness = await startWitnessServer({
    config: witnessConfig,
    port: 0,
    logger: { info() {}, error() {} }
  })
  t.after(() => witness.close())
  const witnessPort = witness.server.address().port

  const h = await createApiHarness(t, {
    testOnlyWitnessController: true,
    env: {
      BAR_LOCAL_FAILOVER_MODE: 'witness',
      BAR_LOCAL_FAILOVER_ROLE: 'primary',
      BAR_LOCAL_FAILOVER_CLUSTER_ID: CLUSTER,
      BAR_LOCAL_FAILOVER_INSTANCE_ID: 'api-primary',
      BAR_LOCAL_FAILOVER_WITNESS_URL: `http://127.0.0.1:${witnessPort}`,
      BAR_LOCAL_FAILOVER_KEY: KEY,
      BAR_LOCAL_FAILOVER_LEASE_TTL_MS: '30000',
      BAR_LOCAL_FAILOVER_RENEW_INTERVAL_MS: '1000',
      BAR_LOCAL_FAILOVER_POLL_INTERVAL_MS: '500'
    }
  })

  const setup = await h.request('/v1/setup/owner', {
    body: {
      setup_secret: TEST_SETUP_SECRET,
      business_name: 'Failover API Bar',
      outlet_name: 'Main Bar',
      owner_name: 'Owner Failover',
      pin: '1234',
      device_name: 'Till Failover',
      device_platform: 'modern'
    }
  })
  assert.equal(setup.status, 201, JSON.stringify(setup.body))
  const deviceId = setup.body.device_id
  const login = await h.request('/v1/sessions', {
    deviceToken: setup.stagedDeviceToken,
    body: { staff_id: setup.body.owner_staff_id, pin: '1234' }
  })
  assert.equal(login.status, 201, JSON.stringify(login.body))
  const auth = { token: login.body.session_token, deviceId }

  const opened = await waitForGate(h, auth, true)
  assert.equal(opened.status, 200, JSON.stringify(opened.body))
  assert.equal(opened.body.failover.mode, 'witness')
  assert.equal(opened.body.failover.automatic_failover.verified, false)
  assert.equal(opened.body.failover.lease.holder_id, 'api-primary')
  assert.equal(opened.body.config.cluster_id, CLUSTER)
  assert.equal(opened.body.config.witness_origin, `http://127.0.0.1:${witnessPort}`)

  const adminStatus = await h.request('/v1/admin/status', { method: 'GET', ...auth })
  assert.equal(adminStatus.status, 200, JSON.stringify(adminStatus.body))
  assert.equal(adminStatus.body.status.failover.gate.open, true)
  assert.equal(adminStatus.body.status.network.capabilities.automatic_failover.status, 'unavailable')
  assert.equal(adminStatus.body.status.replication.automatic_failover.verified, false)

  const missingConfirm = await h.request('/v1/admin/failover/fence', {
    ...auth,
    body: { reason: 'API_TEST_FENCE' }
  })
  assert.equal(missingConfirm.status, 400)
  assert.equal(missingConfirm.body.code, 'VALIDATION_FAILED')

  const lowerCaseReason = await h.request('/v1/admin/failover/fence', {
    ...auth,
    body: { confirm: 'FENCE', reason: 'api test fence' }
  })
  assert.equal(lowerCaseReason.status, 400)

  const fenced = await h.request('/v1/admin/failover/fence', {
    ...auth,
    body: { confirm: 'FENCE', reason: 'API_TEST_FENCE' }
  })
  assert.equal(fenced.status, 200, JSON.stringify(fenced.body))
  assert.equal(fenced.body.failover.gate.open, false)
  assert.equal(fenced.body.failover.gate.reason, 'API_TEST_FENCE')
  assert.equal(fenced.body.client_repoint_required, true)
  assert.equal(fenced.body.audit_recorded, true)

  const refused = await h.request('/v1/commands', { ...auth, body: {} })
  assert.equal(refused.status, 503, JSON.stringify(refused.body))
  assert.equal(refused.body.code, 'AUTHORITY_FENCED')

  const readiness = await h.request('/v1/health/ready', { method: 'GET', ...auth })
  assert.equal(readiness.status, 503, JSON.stringify(readiness.body))
  assert.equal(readiness.body.fenced, true)
  assert.equal(readiness.body.blockers.includes('authority_fenced'), true)

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log WHERE action LIKE 'admin.failover.%' ORDER BY action`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'admin.failover.fence',
    'admin.failover.fence_requested'
  ])
})
