import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'

test('authenticated API commands refuse forged tenant, outlet, authority and device scopes', async (t) => {
  const h = await createApiHarness(t)
  const setup = await h.request('/v1/setup/owner', {
    body: {
      setup_secret: TEST_SETUP_SECRET,
      business_name: 'Scope Isolation Test',
      outlet_name: 'Main Bar',
      owner_name: 'Owner',
      pin: '1234',
      device_name: 'Scope Test Till',
      device_platform: 'modern'
    }
  })
  assert.equal(setup.status, 201, JSON.stringify(setup.body))
  const login = await h.request('/v1/sessions', {
    deviceToken: setup.stagedDeviceToken,
    body: { email: 'owner@example.test', password: 'test owner password 123' }
  })
  assert.equal(login.status, 201, JSON.stringify(login.body))

  const auth = { token: login.body.session_token, deviceId: setup.body.device_id }
  const scope = {
    authority_id: setup.body.authority_id,
    authority_epoch: setup.body.authority_epoch,
    business_id: setup.body.business_id,
    outlet_id: setup.body.outlet_id,
    device_id: setup.body.device_id
  }

  // The local DB is one tenant per authority. Seed a second valid outlet to
  // distinguish an existing but unauthorised outlet from an unknown UUID.
  const otherOutletId = randomUUID()
  await h.migrator.query(
    `INSERT INTO bar_local.outlets (id, business_id, name, code)
     VALUES ($1, $2, 'Other Bar', 'OTHER')`,
    [otherOutletId, setup.body.business_id]
  )

  const attempts = [
    { field: 'business_id', value: randomUUID(), status: 403, code: 'OUTLET_SCOPE_MISMATCH' },
    { field: 'outlet_id', value: otherOutletId, status: 403, code: 'OUTLET_SCOPE_MISMATCH' },
    { field: 'authority_id', value: randomUUID(), status: 409, code: 'WRONG_AUTHORITY' },
    { field: 'device_id', value: randomUUID(), status: 401, code: 'AUTH_INVALID' }
  ]

  for (const { field, value, status, code } of attempts) {
    const envelope = {
      contract_version: 1,
      operation_id: randomUUID(),
      command: 'catalogue.upsert',
      ...scope,
      payload: {
        sku: `FORGED-${field.toUpperCase()}`,
        name: 'Must not be written',
        category: 'Test',
        price: '1.00',
        tax_rate: '0',
        track_stock: false
      },
      [field]: value
    }
    const response = await h.request('/v1/commands', { ...auth, body: envelope })
    assert.equal(response.status, status, `${field}: ${JSON.stringify(response.body)}`)
    assert.equal(response.body.ok, false, `${field} scope must not commit`)
    assert.equal(response.body.code, code, `${field} must retain its reviewed API error code`)
  }

  const forgedRows = await h.migrator.query(
    `SELECT count(*)::int AS count FROM bar_local.products
      WHERE sku LIKE 'FORGED-%'`
  )
  assert.equal(forgedRows.rows[0].count, 0, 'no forged scope may create catalogue rows')
})
