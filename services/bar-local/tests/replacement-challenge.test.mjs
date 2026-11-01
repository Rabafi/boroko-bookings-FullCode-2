import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../dist/config.js'
import { createApp } from '../dist/app.js'

async function startChallengeServer(t, overrides = {}) {
  const deviceId = randomUUID()
  const record = {
    token_hash: 'ab'.repeat(32),
    device_id: deviceId,
    device_status: 'active',
    business_id: randomUUID(),
    outlet_id: randomUUID(),
    authority_id: randomUUID(),
    authority_epoch: 3,
    promoted_epoch: 3,
    fenced: false,
    in_recovery: false,
    ...overrides
  }
  const calls = []
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('service_replacement_challenge')) return { rows: [{ result: record }] }
      throw new Error('Unexpected database call in replacement challenge test.')
    }
  }
  const config = loadConfig({
    BAR_LOCAL_DB_NAME: 'bar_local',
    BAR_LOCAL_HTTP_HOST: '127.0.0.1',
    BAR_LOCAL_DB_HOST: '127.0.0.1'
  })
  const server = http.createServer(createApp({ config, pool }))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(async () => {
    const closed = new Promise((resolve) => server.close(() => resolve()))
    // Node's fetch keeps HTTP sockets alive. Explicitly drain these short-lived
    // fake service listeners before the test worker exits (Windows libuv can
    // otherwise assert while closing overlapping keep-alive handles).
    server.closeAllConnections?.()
    await closed
  })
  const address = server.address()
  return { url: `http://127.0.0.1:${address.port}`, record, calls, deviceId }
}

test('replacement challenge signs fresh nonce and binds active device, Bar, outlet and actual endpoint without returning hashes', async (t) => {
  const h = await startChallengeServer(t)
  const response = await fetch(`${h.url}/v1/replacement/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device_id: h.deviceId, client_nonce: 'cd'.repeat(32) })
  })
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.proof.device_id, h.record.device_id)
  assert.equal(result.proof.business_id, h.record.business_id)
  assert.equal(result.proof.outlet_id, h.record.outlet_id)
  assert.equal(result.proof.authority_id, h.record.authority_id)
  assert.equal(result.proof.server_address, '127.0.0.1')
  assert.equal(result.proof.server_port, Number(new URL(h.url).port))
  assert.equal(result.proof.server_fingerprint, null)
  assert.equal(result.proof.client_nonce, 'cd'.repeat(32))
  assert.match(result.signature, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(result).includes(h.record.token_hash), false)
  assert.deepEqual(h.calls[0].params, [h.deviceId])
})

test('replacement challenge refuses unknown, fenced, standby and unpromoted copies and malformed proofs', async (t) => {
  const variants = [
    [{ device_status: 'revoked' }, { device_id: randomUUID(), client_nonce: 'cd'.repeat(32) }, 404],
    [{ fenced: true }, { device_id: randomUUID(), client_nonce: 'cd'.repeat(32) }, 409],
    [{ in_recovery: true }, { device_id: randomUUID(), client_nonce: 'cd'.repeat(32) }, 409],
    [{ promoted_epoch: 2 }, { device_id: randomUUID(), client_nonce: 'cd'.repeat(32) }, 409],
    [{}, { device_id: randomUUID(), client_nonce: 'bad' }, 400]
  ]
  for (const [overrides, body, expectedStatus] of variants) {
    const h = await startChallengeServer(t, overrides)
    const response = await fetch(`${h.url}/v1/replacement/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, device_id: h.deviceId })
    })
    const result = await response.json()
    assert.equal(response.status, expectedStatus)
    assert.equal(result.signature, undefined)
    assert.equal(JSON.stringify(result).includes(h.record.token_hash), false)
  }
})

test('replacement challenge rate limits unauthenticated callers', async (t) => {
  const h = await startChallengeServer(t)
  let last
  for (let index = 0; index < 21; index += 1) {
    last = await fetch(`${h.url}/v1/replacement/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_id: h.deviceId, client_nonce: `${String(index).padStart(2, '0')}${'ef'.repeat(31)}` })
    })
  }
  assert.equal(last.status, 429)
})
