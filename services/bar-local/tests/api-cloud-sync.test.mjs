import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createApiHarness } from './api-harness.mjs'
import { sha256Text, TEST_SETUP_SECRET } from './harness.mjs'
import { canonicalJson } from '../dist/export.js'

const SECRET = 'admin-cloud-sync-secret-0123456789abcdef0123456789ab'
const KEY_ID = 'admin-test-key'

function envelope(setup, payload, overrides = {}) {
  return {
    contract_version: 1,
    operation_id: randomUUID(),
    command: 'catalogue.upsert',
    authority_id: setup.authority_id,
    authority_epoch: 1,
    business_id: setup.business_id,
    outlet_id: setup.outlet_id,
    device_id: setup.device_id,
    payload,
    ...overrides
  }
}

test('cloud sync admin routes enforce capability, redact credentials, validate loopback and report transport failure honestly', async (t) => {
  const h = await createApiHarness(t, {
    env: {
      BAR_LOCAL_CLOUD_SYNC_TRANSPORT: 'local_test',
      BAR_LOCAL_CLOUD_SYNC_KEY: SECRET,
      BAR_LOCAL_CLOUD_SYNC_KEY_ID: KEY_ID,
      BAR_LOCAL_CLOUD_SYNC_TIMEOUT_MS: '1000',
      BAR_LOCAL_CLOUD_SYNC_MAX_BATCHES: '2'
    }
  })

  const setup = await h.request('/v1/setup/owner', {
    body: {
      setup_secret: TEST_SETUP_SECRET,
      business_name: 'Cloud Admin Bar',
      outlet_name: 'Main Bar',
      owner_name: 'Owner Cloud',
      pin: '1234',
      device_name: 'Till Cloud',
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
  const token = login.body.session_token
  const auth = { token, deviceId }
  const admin = (route, options = {}) => h.request(route, { ...auth, ...options })

  const unauthenticated = await h.request('/v1/admin/cloud-sync', { method: 'GET' })
  assert.equal(unauthenticated.status, 401)

  const limited = await h.migrator.query(
    `INSERT INTO bar_local.staff (business_id, display_name, role, capabilities, pin_hash, pin_salt, pin_iterations)
     VALUES ($1, 'Cloud Cashier', 'cashier', ARRAY['pos.view'], 'unused', 'unused', 100000) RETURNING id`,
    [setup.body.business_id]
  )
  const limitedToken = `bls_${process.pid}_cloud_limited`
  await h.migrator.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [
    limited.rows[0].id, deviceId, setup.body.outlet_id, sha256Text(limitedToken)
  ])
  const denied = await h.request('/v1/admin/cloud-sync', { method: 'GET', token: limitedToken, deviceId })
  assert.equal(denied.status, 403)
  const deniedConfig = await h.request('/v1/admin/cloud-sync/config', {
    token: limitedToken,
    deviceId,
    body: { enabled: false }
  })
  assert.equal(deniedConfig.status, 403)
  const deniedRun = await h.request('/v1/admin/cloud-sync/run', {
    token: limitedToken,
    deviceId,
    body: { final: false }
  })
  assert.equal(deniedRun.status, 403)

  const initial = await admin('/v1/admin/cloud-sync', { method: 'GET' })
  assert.equal(initial.status, 200, JSON.stringify(initial.body))
  assert.equal(initial.body.ok, true)
  assert.equal(initial.body.status.transport, 'local_test')
  assert.equal(initial.body.status.configured, false)
  assert.equal(initial.body.status.enabled, false)
  assert.equal(initial.body.status.receiver_url, null)
  assert.equal(Object.prototype.hasOwnProperty.call(initial.body.status, 'secret'), false)

  const nonLoopback = await admin('/v1/admin/cloud-sync/config', {
    body: {
      enabled: true,
      receiver_url: 'https://example.com/v1/cloud/batches',
      schedule_mode: 'fifteen_minutes',
      daily_at: '23:30',
      batch_limit: 3,
      signing_key_id: KEY_ID
    }
  })
  assert.equal(nonLoopback.status, 400, JSON.stringify(nonLoopback.body))
  assert.equal(nonLoopback.body.code, 'VALIDATION_FAILED')

  const badSchedule = await admin('/v1/admin/cloud-sync/config', {
    body: {
      enabled: true,
      receiver_url: 'http://127.0.0.1:9/v1/cloud/batches',
      schedule_mode: 'hourly',
      daily_at: '23:30',
      batch_limit: 3,
      signing_key_id: KEY_ID
    }
  })
  assert.equal(badSchedule.status, 400, JSON.stringify(badSchedule.body))

  const configured = await admin('/v1/admin/cloud-sync/config', {
    body: {
      enabled: true,
      receiver_url: 'http://user:password@127.0.0.1:9/v1/cloud/batches',
      schedule_mode: 'daily',
      daily_at: '22:15',
      batch_limit: 5,
      signing_key_id: KEY_ID
    }
  })
  assert.equal(configured.status, 200, JSON.stringify(configured.body))
  assert.equal(configured.body.status.configured, true)
  assert.equal(configured.body.status.enabled, true)
  assert.equal(configured.body.status.schedule_mode, 'daily')
  assert.equal(configured.body.status.daily_at, '22:15')
  assert.equal(configured.body.status.batch_limit, 5)
  assert.equal(configured.body.status.signing_key_id, KEY_ID)
  assert.match(configured.body.status.receiver_url, /127\.0\.0\.1:9/)
  assert.equal(configured.body.status.receiver_url.includes('password'), false)
  assert.equal(JSON.stringify(configured.body).includes('password@'), false)

  // A partial save keeps every omitted value, so an operator changing one
  // setting cannot silently clear the receiver address or signing key.
  const partial = await admin('/v1/admin/cloud-sync/config', { body: { batch_limit: 7 } })
  assert.equal(partial.status, 200, JSON.stringify(partial.body))
  assert.equal(partial.body.status.batch_limit, 7)
  assert.equal(partial.body.status.enabled, true)
  assert.equal(partial.body.status.schedule_mode, 'daily')
  assert.equal(partial.body.status.daily_at, '22:15')
  assert.equal(partial.body.status.signing_key_id, KEY_ID)
  assert.match(partial.body.status.receiver_url, /127\.0\.0\.1:9/)
  const cleared = await admin('/v1/admin/cloud-sync/config', { body: { receiver_url: null, enabled: false } })
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body))
  assert.equal(cleared.body.status.receiver_url, null)
  assert.equal(cleared.body.status.enabled, false)
  assert.equal(cleared.body.status.batch_limit, 7)
  const reenabled = await admin('/v1/admin/cloud-sync/config', {
    body: {
      enabled: true,
      receiver_url: 'http://127.0.0.1:9/v1/cloud/batches',
      signing_key_id: KEY_ID
    }
  })
  assert.equal(reenabled.status, 200, JSON.stringify(reenabled.body))
  assert.equal(reenabled.body.status.enabled, true)
  assert.equal(reenabled.body.status.schedule_mode, 'daily')
  assert.equal(reenabled.body.status.batch_limit, 7)

  // A committed local command creates outbox work. The configured receiver is
  // deliberately unreachable, so Sync now must return an honest failure while
  // leaving the local batch pending and retryable.
  const payload = { sku: 'CLOUD-API-1', name: 'Cloud API Ale', category: 'Beer', price: '9.50', tax_rate: '0.14', track_stock: true }
  const command = envelope(setup.body, payload)
  const committed = await h.running.pool.query(
    'SELECT bar_local.cmd_catalogue_upsert($1,$2,$3::jsonb,$4,$5) AS result',
    [sha256Text(token), deviceId, JSON.stringify(command), sha256Text(canonicalJson(payload)), null]
  )
  assert.equal(committed.rows[0].result.ok, true, JSON.stringify(committed.rows[0].result.error))

  const run = await admin('/v1/admin/cloud-sync/run', { body: { final: true } })
  assert.equal(run.status, 200, JSON.stringify(run.body))
  assert.equal(run.body.ok, false)
  assert.equal(run.body.status, 'failed')
  assert.equal(run.body.status_detail.last_error_code, 'CLOUD_SYNC_TRANSPORT_ERROR')
  assert.equal(run.body.status_detail.pending_events > 0, true)
  assert.equal(run.body.status_detail.last_final_sync_state, 'failed')
  assert.equal(run.body.uploaded_batches, 0)

  const pending = await h.migrator.query(
    `SELECT status, transport_status, last_error, attempts FROM bar_local.export_batches ORDER BY from_sequence`
  )
  assert.equal(pending.rows.length > 0, true)
  assert.equal(pending.rows[0].status, 'ready')
  assert.equal(pending.rows[0].transport_status, 'transport_error')
  assert.match(pending.rows[0].last_error, /CLOUD_SYNC_TRANSPORT_ERROR/)
  assert.equal(Number(pending.rows[0].attempts), 1)

  const after = await admin('/v1/admin/cloud-sync', { method: 'GET' })
  assert.equal(after.status, 200)
  assert.equal(after.body.status.last_error_code, 'CLOUD_SYNC_TRANSPORT_ERROR')
  assert.equal(after.body.status.failed_batches > 0, true)
  assert.equal(after.body.status.pending_events > 0, true)
  assert.equal(after.body.status.last_success_at, null)
})
