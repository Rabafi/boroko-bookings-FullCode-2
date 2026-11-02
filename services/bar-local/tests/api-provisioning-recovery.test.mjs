import test from 'node:test'
import assert from 'node:assert/strict'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'

test('owner setup retry returns the original authority only with the original staged proof', async (t) => {
  const h = await createApiHarness(t)
  const setupRequest = {
    setup_secret: TEST_SETUP_SECRET,
    provisioning_id: '11111111-1111-4111-8111-111111111111',
    device_token: `bld_${'a'.repeat(48)}`,
    business_name: 'Recoverable Bar',
    outlet_name: 'Main Bar',
    owner_name: 'Owner',
    owner_email: 'owner@recoverable.example.test',
    owner_password: 'recoverable owner password 123',
    pin: '1234',
    device_name: 'Owner till',
    device_platform: 'modern'
  }
  const missing = await h.request('/v1/setup/owner', {
    body: { ...setupRequest, provisioning_id: undefined, device_token: undefined },
    stageProvisioning: false
  })
  assert.equal(missing.status, 400)
  assert.equal(missing.body.code, 'VALIDATION_FAILED')

  const first = await h.request('/v1/setup/owner', { body: setupRequest })
  assert.equal(first.status, 201, JSON.stringify(first.body))
  assert.equal(first.body.device_token, undefined, 'service response must not reveal the staged secret')
  assert.equal(first.stagedDeviceToken, setupRequest.device_token)

  const ownerLogin = await h.request('/v1/sessions', {
    body: { email: setupRequest.owner_email, password: setupRequest.owner_password },
    deviceToken: setupRequest.device_token
  })
  assert.equal(ownerLogin.status, 201, JSON.stringify(ownerLogin.body))
  assert.equal(ownerLogin.body.staff.role, 'owner')
  const ownerPinLogin = await h.request('/v1/sessions', {
    body: { staff_id: first.body.owner_staff_id, pin: setupRequest.pin },
    deviceToken: setupRequest.device_token
  })
  assert.equal(ownerPinLogin.status, 401, 'owner must use email/password for sign-in')

  const invalidReset = await h.request('/v1/owner/password/recover', {
    body: { owner_email: setupRequest.owner_email, new_password: 'replacement owner password 456', recovery_secret: 'incorrect-recovery-secret' }
  })
  assert.equal(invalidReset.status, 401, 'loopback alone must not authorize password recovery')
  const passwordReset = await h.request('/v1/owner/password/recover', {
    body: { owner_email: setupRequest.owner_email, new_password: 'replacement owner password 456', recovery_secret: TEST_SETUP_SECRET }
  })
  assert.equal(passwordReset.status, 200, JSON.stringify(passwordReset.body))
  const oldPasswordLogin = await h.request('/v1/sessions', {
    body: { email: setupRequest.owner_email, password: setupRequest.owner_password },
    deviceToken: setupRequest.device_token
  })
  assert.equal(oldPasswordLogin.status, 401)
  const newPasswordLogin = await h.request('/v1/sessions', {
    body: { email: setupRequest.owner_email, password: 'replacement owner password 456' },
    deviceToken: setupRequest.device_token
  })
  assert.equal(newPasswordLogin.status, 201, JSON.stringify(newPasswordLogin.body))
  const changedPassword = await h.request('/v1/owner/password/change', {
    token: newPasswordLogin.body.session_token, deviceId: first.body.device_id,
    body: { current_password: 'replacement owner password 456', new_password: 'third local owner password 789' }
  })
  assert.equal(changedPassword.status, 200, JSON.stringify(changedPassword.body))

  // Model the client losing the successful response and retrying its durable,
  // unchanged setup intent after restart.
  const replay = await h.request('/v1/setup/owner', { body: setupRequest })
  assert.equal(replay.status, 201, JSON.stringify(replay.body))
  for (const field of ['authority_id', 'authority_epoch', 'business_id', 'outlet_id', 'device_id', 'owner_staff_id']) {
    assert.equal(replay.body[field], first.body[field], `${field} must be the original committed result`)
  }
  const afterReplayLogin = await h.request('/v1/sessions', {
    body: { email: setupRequest.owner_email, password: 'third local owner password 789' },
    deviceToken: setupRequest.device_token
  })
  assert.equal(afterReplayLogin.status, 201, 'setup replay must not restore an old password')

  const changedPayload = await h.request('/v1/setup/owner', {
    body: { ...setupRequest, business_name: 'Changed Bar' }
  })
  assert.equal(changedPayload.status, 409)
  assert.equal(changedPayload.body.code, 'PROVISIONING_CONFLICT')
  const guessedIntent = await h.request('/v1/setup/owner', {
    body: { ...setupRequest, device_token: `bld_${'b'.repeat(48)}` }
  })
  assert.equal(guessedIntent.status, 409)
  assert.equal(guessedIntent.body.code, 'PROVISIONING_CONFLICT')

  const counts = await h.migrator.query(
    `SELECT (SELECT count(*)::int FROM bar_local.authority) AS authorities,
            (SELECT count(*)::int FROM bar_local.devices) AS devices,
            (SELECT count(*)::int FROM bar_local.provisioning_intents) AS intents`
  )
  assert.deepEqual(counts.rows[0], { authorities: 1, devices: 1, intents: 1 })
})

test('pairing retry with staged proof returns one device and arbitrary reuse is refused', async (t) => {
  const h = await createApiHarness(t)
  const setup = await h.request('/v1/setup/owner', {
    body: {
      setup_secret: TEST_SETUP_SECRET,
      business_name: 'Pair Recovery Bar',
      outlet_name: 'Main',
      owner_name: 'Owner',
      owner_email: 'owner@pairing.example.test',
      owner_password: 'pairing owner password 123',
      pin: '1234',
      device_name: 'Primary'
    }
  })
  assert.equal(setup.status, 201, JSON.stringify(setup.body))
  const login = await h.request('/v1/sessions', {
    deviceToken: setup.stagedDeviceToken,
    body: { email: 'owner@pairing.example.test', password: 'pairing owner password 123' }
  })
  assert.equal(login.status, 201, JSON.stringify(login.body))
  const code = await h.request('/v1/pairing/start', {
    token: login.body.session_token,
    deviceId: setup.body.device_id,
    body: {}
  })
  assert.equal(code.status, 201, JSON.stringify(code.body))
  const pairingRequest = {
    provisioning_id: '22222222-2222-4222-8222-222222222222',
    device_token: `bld_${'c'.repeat(48)}`,
    pairing_code: code.body.pairing_code,
    name: 'Second till',
    platform: 'legacy'
  }
  const first = await h.request('/v1/pairing/complete', { body: pairingRequest })
  assert.equal(first.status, 201, JSON.stringify(first.body))
  assert.equal(first.body.device_token, undefined)
  const replay = await h.request('/v1/pairing/complete', { body: pairingRequest })
  assert.equal(replay.status, 201, JSON.stringify(replay.body))
  assert.equal(replay.body.device_id, first.body.device_id)

  const changed = await h.request('/v1/pairing/complete', {
    body: { ...pairingRequest, name: 'Different till' }
  })
  assert.equal(changed.status, 409)
  assert.equal(changed.body.code, 'PROVISIONING_CONFLICT')
  const wrongProof = await h.request('/v1/pairing/complete', {
    body: { ...pairingRequest, device_token: `bld_${'d'.repeat(48)}` }
  })
  assert.equal(wrongProof.status, 409)
  assert.equal(wrongProof.body.code, 'PROVISIONING_CONFLICT')
  const arbitraryReuse = await h.request('/v1/pairing/complete', {
    body: { ...pairingRequest, provisioning_id: '33333333-3333-4333-8333-333333333333' }
  })
  assert.equal(arbitraryReuse.status, 401)
  assert.equal(arbitraryReuse.body.code, 'PAIRING_CODE_USED')

  const counts = await h.migrator.query(
    `SELECT (SELECT count(*)::int FROM bar_local.devices) AS devices,
            (SELECT count(*)::int FROM bar_local.provisioning_intents) AS intents`
  )
  assert.deepEqual(counts.rows[0], { devices: 2, intents: 2 })
})
