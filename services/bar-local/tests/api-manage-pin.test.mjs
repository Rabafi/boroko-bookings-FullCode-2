import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'

for (const ownerPin of ['1234567', '123456789012']) {
  test(`owner setup PIN of ${ownerPin.length} digits verifies Manage with identity, denial and session guards`, async (t) => {
    const h = await createApiHarness(t)
    const setup = await h.request('/v1/setup/owner', { body: {
      setup_secret: TEST_SETUP_SECRET, business_name: 'PIN contract test Bar', outlet_name: 'Main Bar',
      owner_name: 'Local Owner', pin: ownerPin, device_name: 'Test Till'
    } })
    assert.equal(setup.status, 201, JSON.stringify(setup.body))
    const login = await h.request('/v1/sessions', { deviceToken: setup.stagedDeviceToken,
      body: { email: 'owner@example.test', password: 'test owner password 123' } })
    assert.equal(login.status, 201, JSON.stringify(login.body))
    const auth = { token: login.body.session_token, deviceId: setup.body.device_id }
    const staffId = login.body.staff.staff_id || login.body.staff.id
    assert.equal(typeof staffId, 'string')
    const before = (await h.migrator.query('SELECT id,staff_id,device_id,outlet_id,authority_epoch,revoked_at FROM bar_local.sessions ORDER BY id')).rows
    const mismatch = await h.request('/v1/manager-pin/verify', { ...auth, body: { staff_id: randomUUID(), pin: ownerPin } })
    assert.equal(mismatch.status, 403)
    assert.equal(mismatch.body.code, 'CAPABILITY_DENIED')
    const truncated = await h.request('/v1/manager-pin/verify', { ...auth, body: { staff_id: staffId, pin: ownerPin.slice(0, 6) } })
    assert.equal(truncated.status, 401)
    const verified = await h.request('/v1/manager-pin/verify', { ...auth, body: { staff_id: staffId, pin: ownerPin } })
    assert.equal(verified.status, 200, JSON.stringify(verified.body))
    assert.equal(verified.body.verified, true)
    assert.equal(verified.body.staff_id, staffId)
    assert.equal(verified.body.session_token, undefined, 'Manage verification does not replace the signed-in session')
    assert.equal((await h.migrator.query('SELECT count(*)::integer AS count FROM bar_local.approvals')).rows[0].count, 0,
      'a navigation unlock does not grant a transferable command approval')
    if (ownerPin.length === 12) {
      let limited = null
      for (let i = 0; i < 21; i++) {
        const result = await h.request('/v1/manager-pin/verify', { ...auth, body: { staff_id: staffId, pin: ownerPin } })
        if (result.status === 429) { limited = result; break }
        assert.equal(result.status, 200)
      }
      assert.ok(limited, 'the local Manage verifier must rate-limit repeated PIN checks')
    }
    const bootstrap = await h.request('/v1/queries/bootstrap', { ...auth, body: {
      contract_version: 1, authority_id: setup.body.authority_id, authority_epoch: setup.body.authority_epoch, filters: {}
    } })
    assert.equal(bootstrap.status, 200, 'PIN denial/rate limiting must preserve the active local session')
    assert.equal(bootstrap.body.scope.actor_staff_id, staffId)
    const after = (await h.migrator.query('SELECT id,staff_id,device_id,outlet_id,authority_epoch,revoked_at FROM bar_local.sessions ORDER BY id')).rows
    assert.deepEqual(after, before)
    if (ownerPin.length === 12) {
      const cashier = await h.request('/v1/commands', { ...auth, body: {
        contract_version: 1, operation_id: randomUUID(), command: 'staff.create',
        authority_id: setup.body.authority_id, authority_epoch: setup.body.authority_epoch,
        business_id: setup.body.business_id, outlet_id: setup.body.outlet_id, device_id: setup.body.device_id,
        payload: { display_name: 'Cashier', role: 'cashier', pin: '6789' }
      } })
      assert.equal(cashier.body.ok, true, JSON.stringify(cashier.body))
      const cashierLogin = await h.request('/v1/sessions', { deviceToken: setup.stagedDeviceToken,
        body: { staff_id: cashier.body.result.staff_id, pin: '6789' } })
      assert.equal(cashierLogin.status, 201)
      const denied = await h.request('/v1/manager-pin/verify', {
        token: cashierLogin.body.session_token, deviceId: setup.body.device_id,
        body: { staff_id: cashier.body.result.staff_id, pin: '6789' }
      })
      assert.equal(denied.status, 403, 'a selling capability does not grant the Manage navigation unlock')
      assert.equal(denied.body.code, 'CAPABILITY_DENIED')
    }
  })
}
