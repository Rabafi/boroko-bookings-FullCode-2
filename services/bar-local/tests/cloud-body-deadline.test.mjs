import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import http from 'node:http'
import test from 'node:test'
import { canonicalJson } from '@tsa-bonno/bar-contracts'
import { loadConfig } from '../dist/config.js'
import { createCloudSyncController } from '../dist/operations/cloudSync.js'

const BATCH_ID = 'e9b20d88-4a32-426e-a620-9c3a1b79aec2'
const HASH = 'a'.repeat(64)
const SECRET = 'local-cloud-sync-test-secret-0123456789'
const LINK_IDENTITY = {
  authority_id: 'a84ed73a-7f4d-44b1-b79d-3b456d358b64',
  business_id: '2b0f02b8-1383-41a5-bbc2-27c086e8f3b8',
  outlet_id: 'c8eef181-08d1-49fe-9c62-117add474a0a'
}

async function answerOwnerLinkStatus(req, res) {
  if (req.url !== '/v1/links/status') return false
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const proofBase = { key_id: 'test-key', nonce: body.nonce, ...LINK_IDENTITY, active: true, revoked: false }
  const signature = createHmac('sha256', SECRET).update(canonicalJson(proofBase), 'utf8').digest('hex')
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ ...proofBase, signature }))
  return true
}

function testConfig(timeoutMs = 1_000) {
  return loadConfig({
    BAR_LOCAL_ALLOW_TEST_DB: '1',
    BAR_LOCAL_NETWORK_ROLE: 'single_host',
    BAR_LOCAL_CLOUD_SYNC_TRANSPORT: 'local_test',
    BAR_LOCAL_CLOUD_SYNC_KEY: SECRET,
    BAR_LOCAL_CLOUD_SYNC_KEY_ID: 'test-key',
    BAR_LOCAL_CLOUD_SYNC_TIMEOUT_MS: String(timeoutMs),
    BAR_LOCAL_CLOUD_SYNC_MAX_BATCHES: '1'
  })
}

function syntheticPool(receiverUrl) {
  const calls = []
  const status = { pending_events: 3, last_error_code: null, next_due_at: null }
  let servedBatch = false
  const batch = {
    batch_id: BATCH_ID,
    business_id: '2b0f02b8-1383-41a5-bbc2-27c086e8f3b8',
    outlet_id: 'c8eef181-08d1-49fe-9c62-117add474a0a',
    authority_id: 'a84ed73a-7f4d-44b1-b79d-3b456d358b64',
    authority_epoch: 1,
    from_sequence: 1,
    to_sequence: 1,
    event_count: 1,
    manifest_hash: HASH,
    manifest: {},
    manifest_text: '{"events":[]}'
  }

  function resultFor(sql, params) {
    const match = /SELECT\s+bar_local\.([a-z_]+)\(/i.exec(sql)
    if (!match) return { rows: [{ locked: true }] }
    const name = match[1]
    calls.push({ name, params })
    switch (name) {
      case 'cloud_sync_status': return { rows: [{ result: status }] }
      case 'cloud_sync_worker_config': return { rows: [{ result: {
        configured: true,
        enabled: true,
        receiver_url: receiverUrl,
        schedule_mode: 'fifteen_minutes',
        batch_limit: 1,
        signing_key_id: 'test-key'
      } }] }
      case 'cloud_sync_next_batch':
        if (servedBatch) return { rows: [{ result: null }] }
        servedBatch = true
        return { rows: [{ result: { ...batch, status: 'batch_pending' } }] }
      case 'cloud_sync_mark_signed': return { rows: [{ result: { status: 'signed' } }] }
      case 'cloud_sync_mark_uploading': return { rows: [{ result: { status: 'uploading' } }] }
      case 'cloud_sync_mark_failure':
        status.last_error_code = params[1]
        status.last_error_message = params[2]
        return { rows: [{ result: { status: 'failed' } }] }
      case 'cloud_sync_record_run':
        status.last_error_code = params[3]
        status.last_error_message = params[4]
        status.next_due_at = params[5]
        return { rows: [{ result: status }] }
      default: return { rows: [{ result: null }] }
    }
  }

  return {
    calls,
    query: async (sql, params = []) => resultFor(sql, params),
    connect: async () => ({
      query: async (sql) => /pg_try_advisory_lock/.test(sql)
        ? { rows: [{ locked: true }] }
        : { rows: [{ unlocked: true }] },
      release: () => { calls.push({ name: 'client.release', params: [] }) }
    }),
    end: async () => undefined
  }
}

async function listen(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/sync`,
    server,
    close: async () => {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(() => resolve()))
    }
  }
}

test('cloud response body is covered by the request deadline and failure is durable before lock release', async (t) => {
  let responseClosed = false
  const receiver = await listen(async (req, res) => {
    if (await answerOwnerLinkStatus(req, res)) return
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write('{"ok":true,')
    res.on('close', () => { responseClosed = true })
  })
  t.after(receiver.close)
  const pool = syntheticPool(receiver.url)
  const controller = createCloudSyncController({ config: testConfig(), pool })
  t.after(() => controller.stop())

  const startedAt = Date.now()
  const result = await controller.runNow()
  const elapsed = Date.now() - startedAt

  assert.equal(result.status, 'failed')
  assert.equal(result.last_error_code, 'CLOUD_SYNC_TIMEOUT')
  assert.ok(elapsed < 2_500, `body read exceeded the bounded deadline (${elapsed} ms)`)
  assert.equal(pool.calls.filter((call) => call.name === 'cloud_sync_mark_failure').length, 1)
  assert.equal(pool.calls.find((call) => call.name === 'cloud_sync_mark_failure').params[1], 'CLOUD_SYNC_TIMEOUT')
  assert.ok(pool.calls.findIndex((call) => call.name === 'cloud_sync_mark_failure') < pool.calls.findIndex((call) => call.name === 'client.release'))
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(responseClosed, true, 'aborting a stalled body must close the receiver response')
})

test('cloud response body is byte-bounded and cancelled when a chunk crosses the acknowledgement limit', async (t) => {
  let responseClosed = false
  const receiver = await listen(async (req, res) => {
    if (await answerOwnerLinkStatus(req, res)) return
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write(Buffer.alloc(64 * 1024, 0x20))
    res.write(Buffer.alloc(1024, 0x20))
    res.on('close', () => { responseClosed = true })
  })
  t.after(receiver.close)
  const pool = syntheticPool(receiver.url)
  const controller = createCloudSyncController({ config: testConfig(2_000), pool })
  t.after(() => controller.stop())

  const result = await controller.runNow()

  assert.equal(result.status, 'failed')
  assert.equal(result.last_error_code, 'CLOUD_SYNC_RESPONSE_TOO_LARGE')
  assert.equal(pool.calls.find((call) => call.name === 'cloud_sync_mark_failure').params[1], 'CLOUD_SYNC_RESPONSE_TOO_LARGE')
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(responseClosed, true, 'oversized streaming acknowledgement must be cancelled')
})

test('worker shutdown aborts a stalled response body, records failure and releases the uploader lock', async (t) => {
  let responseClosed = false
  const receiver = await listen(async (req, res) => {
    if (await answerOwnerLinkStatus(req, res)) return
    res.writeHead(200, { 'content-type': 'application/json' })
    res.write('{"ok":true,')
    res.on('close', () => { responseClosed = true })
  })
  t.after(receiver.close)
  const pool = syntheticPool(receiver.url)
  const controller = createCloudSyncController({ config: testConfig(5_000), pool })

  const running = controller.runNow()
  await new Promise((resolve) => setTimeout(resolve, 60))
  await controller.stop()
  const result = await running

  assert.equal(result.status, 'failed')
  assert.equal(result.last_error_code, 'CLOUD_SYNC_STOPPED')
  assert.equal(pool.calls.find((call) => call.name === 'cloud_sync_mark_failure').params[1], 'CLOUD_SYNC_STOPPED')
  assert.ok(pool.calls.findIndex((call) => call.name === 'cloud_sync_mark_failure') < pool.calls.findIndex((call) => call.name === 'client.release'))
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(responseClosed, true)
})
