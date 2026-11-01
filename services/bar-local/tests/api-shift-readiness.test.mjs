import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'

test('shift opening through the API refuses an empty catalogue and preserves replay outcomes', async (t) => {
  const h = await createApiHarness(t)
  const setup = await h.request('/v1/setup/owner', { body: {
    setup_secret: TEST_SETUP_SECRET, business_name: 'Readiness Bar', outlet_name: 'Main Bar',
    owner_name: 'Owner', pin: '1234', device_name: 'Readiness Till', device_platform: 'modern'
  } })
  assert.equal(setup.status, 201, JSON.stringify(setup.body))
  const login = await h.request('/v1/sessions', {
    deviceToken: setup.stagedDeviceToken, body: { staff_id: setup.body.owner_staff_id, pin: '1234' }
  })
  assert.equal(login.status, 201, JSON.stringify(login.body))
  const auth = { token: login.body.session_token, deviceId: setup.body.device_id }
  const envelope = (command, payload) => ({
    contract_version: 1, operation_id: randomUUID(), command,
    authority_id: setup.body.authority_id, authority_epoch: setup.body.authority_epoch,
    business_id: setup.body.business_id, outlet_id: setup.body.outlet_id,
    device_id: setup.body.device_id, payload
  })
  const blocked = envelope('shift.open', { opening_float: '0.00' })
  const first = await h.request('/v1/commands', { ...auth, body: blocked })
  assert.equal(first.body.ok, false, JSON.stringify(first.body))
  assert.equal(first.body.error.code, 'CATALOGUE_REQUIRED')
  assert.equal((await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.shifts')).rows[0].n, 0)

  const product = await h.request('/v1/commands', { ...auth, body: envelope('catalogue.upsert', {
    sku: 'OPEN-API-1', name: 'Opening product', category: 'Test', price: '10.00', tax_rate: '0', track_stock: false
  }) })
  assert.equal(product.body.ok, true, JSON.stringify(product.body))
  const refusedReplay = await h.request('/v1/commands', { ...auth, body: blocked })
  assert.equal(refusedReplay.body.ok, false)
  assert.equal(refusedReplay.body.replayed, true)
  assert.equal(refusedReplay.body.error.code, 'CATALOGUE_REQUIRED')

  const fresh = envelope('shift.open', { opening_float: '0.00' })
  const opened = await h.request('/v1/commands', { ...auth, body: fresh })
  assert.equal(opened.body.ok, true, JSON.stringify(opened.body))
  await h.migrator.query('UPDATE bar_local.products SET active = false WHERE business_id = $1', [setup.body.business_id])
  const committedReplay = await h.request('/v1/commands', { ...auth, body: fresh })
  assert.equal(committedReplay.body.ok, true, JSON.stringify(committedReplay.body))
  assert.equal(committedReplay.body.replayed, true)
  assert.deepEqual(committedReplay.body.receipt, opened.body.receipt)
  assert.equal((await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.shifts')).rows[0].n, 1)
})
