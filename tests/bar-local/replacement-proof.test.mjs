import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { verifyBarReplacement } from '../../src/shared/barLocalReplacement.js'

test('replacement binding requires original Bar/device, fresh owner proof and promoted unfenced epoch', async () => {
  const current = { authority_id: '11111111-1111-4111-8111-111111111111', authority_epoch: 1, business_id: '22222222-2222-4222-8222-222222222222', outlet_id: '33333333-3333-4333-8333-333333333333' }
  const credential = { device_id: '44444444-4444-4444-8444-444444444444', device_token: 'original protected device credential' }
  const request = { staff_id: '55555555-5555-4555-8555-555555555555', pin: '1234', confirm: 'RECONNECT_SERVER' }
  const endpoint = { base_url: 'http://127.0.0.1:4317', fingerprint: null }
  for (const variant of ['valid', 'valid-password', 'wrong-proof-business', 'wrong-proof-device', 'wrong-proof-port', 'wrong-proof-signature', 'challenge-unavailable', 'wrong-business', 'wrong-device', 'cashier', 'old-epoch', 'wrong-authority', 'fenced', 'standby', 'unpromoted']) {
    const loginRequest = variant === 'valid-password' ? { confirm: 'RECONNECT_SERVER', email: 'owner@example.test', password: 'replacement owner password 123' } : request
    const revoked = []
    const routes = []
    let releasedSecrets = 0
    const exchange = async (method, route, options) => {
      routes.push({ method, route })
      if (route.endsWith('/revoke')) { revoked.push(options.body.session_id); return { status: 200, body: {} } }
      if (route === '/v1/replacement/challenge') {
        const proof = {
          client_nonce: options.body.client_nonce,
          device_id: variant === 'wrong-proof-device' ? 'other' : credential.device_id,
          authority_id: current.authority_id,
          business_id: variant === 'wrong-proof-business' ? 'other' : current.business_id,
          outlet_id: current.outlet_id,
          server_address: '127.0.0.1',
          server_port: variant === 'wrong-proof-port' ? 4318 : 4317,
          server_fingerprint: null
        }
        const key = createHash('sha256').update(credential.device_token).digest()
        return {
          status: variant === 'challenge-unavailable' ? 404 : 200,
          body: { proof, signature: createHmac('sha256', variant === 'wrong-proof-signature' ? Buffer.alloc(32) : key).update(JSON.stringify(proof)).digest('hex') }
        }
      }
      if (route === '/v1/sessions') {
        if (variant === 'valid-password') {
          assert.equal(options.body.email, loginRequest.email)
          assert.equal(options.body.password, loginRequest.password)
          assert.equal(options.body.pin, undefined)
        }
        releasedSecrets += Number(options.deviceToken === credential.device_token && options.body.pin === request.pin)
        return { status: 201, body: { session_token: 'a'.repeat(32), session_id: 'session', authority_epoch: variant === 'old-epoch' ? 1 : 2, business_id: variant === 'wrong-business' ? 'other' : current.business_id, outlet_id: current.outlet_id, staff: { staff_id: request.staff_id, role: variant === 'cashier' ? 'cashier' : 'owner' }, device: { device_id: variant === 'wrong-device' ? 'other' : credential.device_id } } }
      }
      return { status: 200, body: { replacement: { ...current, authority_id: variant === 'wrong-authority' ? 'other' : current.authority_id, authority_epoch: 2, promoted_epoch: variant === 'unpromoted' ? 0 : 2, fenced: variant === 'fenced', in_recovery: variant === 'standby' } } }
    }
    if (variant === 'valid' || variant === 'valid-password') assert.equal((await verifyBarReplacement(current, credential, loginRequest, exchange, endpoint)).authority_epoch, 2)
    else await assert.rejects(verifyBarReplacement(current, credential, loginRequest, exchange, endpoint), { code: 'REPLACEMENT_NOT_VERIFIED' }, variant)
    if (['wrong-proof-business', 'wrong-proof-device', 'wrong-proof-port', 'wrong-proof-signature', 'challenge-unavailable'].includes(variant)) {
      assert.equal(releasedSecrets, 0, 'no device token or owner PIN is released without a valid endpoint-bound challenge')
      assert.deepEqual(revoked, [])
    } else assert.deepEqual(revoked, ['session'], 'temporary owner session is revoked even when post-login proof fails')
    assert.equal(routes[0]?.route, '/v1/replacement/challenge')
  }
})

test('replacement refuses an unpinned HTTPS endpoint and non-loopback HTTP before network exchange', async () => {
  const current = { authority_id: '11111111-1111-4111-8111-111111111111', authority_epoch: 1, business_id: '22222222-2222-4222-8222-222222222222', outlet_id: '33333333-3333-4333-8333-333333333333' }
  const credential = { device_id: '44444444-4444-4444-8444-444444444444', device_token: 'original protected device credential' }
  const request = { staff_id: '55555555-5555-4555-8555-555555555555', pin: '1234', confirm: 'RECONNECT_SERVER' }
  let calls = 0
  const exchange = async () => { calls += 1; return { status: 200, body: {} } }
  await assert.rejects(verifyBarReplacement(current, credential, request, exchange, { base_url: 'https://bar.example:8787', fingerprint: null }), { code: 'REPLACEMENT_NOT_VERIFIED' })
  await assert.rejects(verifyBarReplacement(current, credential, request, exchange, { base_url: 'http://bar.example:8787', fingerprint: null }), { code: 'REPLACEMENT_NOT_VERIFIED' })
  assert.equal(calls, 0)
})

test('Modern and Legacy reconnect callers bind proof to the verified transport endpoint', () => {
  const modern = readFileSync(new URL('../../src/main/bar-local/electronRuntime.js', import.meta.url), 'utf8')
  const legacy = readFileSync(new URL('../../legacy-pos/src/main/bar-local/runtime.js', import.meta.url), 'utf8')
  for (const [surface, source] of [['Modern', modern], ['Legacy', legacy]]) {
    const method = source.indexOf('async reconnectServer(request)')
    const end = source.indexOf('\n  async ', method + 10)
    assert.ok(method >= 0 && end > method, `${surface} reconnect method must exist`)
    const call = source.slice(method, end)
    assert.match(call, /verifyBarReplacement\(/)
    assert.match(call, /base_url:\s*transport\.baseUrl/)
    assert.match(call, /fingerprint:\s*transport\.fingerprint/)
  }
})
