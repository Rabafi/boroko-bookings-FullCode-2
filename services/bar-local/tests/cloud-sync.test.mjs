import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { canonicalJson } from '@tsa-bonno/bar-contracts'
import { createHarness } from './harness.mjs'
import { connectionConfig } from '../scripts/lib/db-target.mjs'
import { loadConfig } from '../dist/config.js'
import { createPool, closePool } from '../dist/db.js'
import { createCloudSyncController, firstRunDelay, nextDueAt } from '../dist/operations/cloudSync.js'

const { Client, Pool } = pg
const SECRET = 'cloud-sync-test-secret-0123456789abcdef0123456789abcdef'
const KEY_ID = 'test-key-1'

function receiverContractSql() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return readFileSync(path.join(here, '..', 'db', 'cloud-receiver', '0001_cloud_ingest.sql'), 'utf8')
}

function startReceiver(client, { secret = SECRET, keyId = KEY_ID, identity } = {}) {
  const state = { mode: 'ingest', bodies: [], requests: 0, linkProofs: [] }
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'POST' && url.pathname === '/v1/links/status') {
      const chunks = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const expected = createHmac('sha256', secret).update(canonicalJson({ key_id: body.key_id, nonce: body.nonce }), 'utf8').digest('hex')
      if (body.key_id !== keyId || body.signature !== expected) {
        res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false })); return
      }
      const proof = { key_id: keyId, nonce: body.nonce, ...identity, active: state.linkActive !== false, revoked: false }
      const signature = createHmac('sha256', secret).update(canonicalJson(proof), 'utf8').digest('hex')
      state.linkProofs.push({ request: body, proof })
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ...proof, signature })); return
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/cloud/batches') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND' }))
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8')
    state.requests += 1
    state.bodies.push(body)
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, code: 'BODY_INVALID' }))
      return
    }
    const batchId = parsed.batch_id
    const manifestHash = parsed.manifest_hash
    const signature = req.headers['x-bar-signature']
    const expected = createHmac('sha256', secret).update(`${keyId}.${batchId}.${manifestHash}`, 'utf8').digest('hex')
    if (signature !== expected) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, code: 'SIGNATURE_INVALID' }))
      return
    }
    if (req.headers['x-bar-manifest-hash'] !== manifestHash) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, code: 'MANIFEST_HEADER_MISMATCH' }))
      return
    }
    try {
      const received = await client.query('SELECT cloud_ingest.receive($1::jsonb) AS result', [body])
      const receiveResult = received.rows[0].result
      if (state.mode === 'received') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ...receiveResult, received_at: new Date().toISOString() }))
        return
      }
      const validated = await client.query('SELECT cloud_ingest.validate($1::jsonb) AS result', [body])
      const validateResult = validated.rows[0].result
      if (state.mode === 'validated') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ...validateResult, received_at: new Date().toISOString() }))
        return
      }
      const ingested = await client.query('SELECT cloud_ingest.ingest($1::jsonb) AS result', [body])
      const ingestResult = ingested.rows[0].result
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...ingestResult, received_at: new Date().toISOString() }))
    } catch (error) {
      res.writeHead(409, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        ok: false,
        code: error.detail || 'RECEIVER_REJECTED',
        message: error.message
      }))
    }
  })
  return {
    state,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      return `http://127.0.0.1:${address.port}/v1/cloud/batches`
    },
    async close() {
      await new Promise((resolve) => server.close(() => resolve()))
    }
  }
}

function serviceConfig(target) {
  return loadConfig({
    BAR_LOCAL_ALLOW_TEST_DB: '1',
    BAR_LOCAL_NETWORK_ROLE: 'single_host',
    BAR_LOCAL_HTTP_HOST: '127.0.0.1',
    BAR_LOCAL_DB_HOST: target.host,
    BAR_LOCAL_DB_PORT: String(target.port),
    BAR_LOCAL_DB_NAME: target.database,
    BAR_LOCAL_RUNTIME_USER: process.env.BAR_LOCAL_RUNTIME_USER || 'bar_local_runtime',
    BAR_LOCAL_RUNTIME_PASSWORD: process.env.BAR_LOCAL_RUNTIME_PASSWORD ?? process.env.BAR_LOCAL_DB_PASSWORD,
    BAR_LOCAL_SESSION_TTL_SECONDS: '3600',
    BAR_LOCAL_PIN_ITERATIONS: '100000',
    BAR_LOCAL_CLOUD_SYNC_TRANSPORT: 'local_test',
    BAR_LOCAL_CLOUD_SYNC_KEY: SECRET,
    BAR_LOCAL_CLOUD_SYNC_KEY_ID: KEY_ID,
    BAR_LOCAL_CLOUD_SYNC_MAX_BATCHES: '1',
    BAR_LOCAL_CLOUD_SYNC_TIMEOUT_MS: '5000'
  })
}

async function configureLocalCloud(h, receiverUrl, overrides = {}) {
  const result = await h.runtime.query(
    'SELECT bar_local.cloud_sync_config_set($1,$2,$3::jsonb) AS result',
    [h.ownerTokenHash, h.deviceId, JSON.stringify({
      enabled: true,
      receiver_url: receiverUrl,
      schedule_mode: 'fifteen_minutes',
      daily_at: '23:30',
      // One commit group per batch keeps the bounded pass deterministic and
      // proves that a batch never splits a financial commit.
      batch_limit: 1,
      signing_key_id: KEY_ID,
      ...overrides
    })]
  )
  return result.rows[0].result
}

async function queueSaleEvents(h, suffix, existing = {}) {
  const shiftId = existing.shiftId ?? await h.openShift('100.00')
  let productId = existing.productId
  if (!productId) {
    const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
      sku: `SYNC-${suffix}`,
      name: `Sync Ale ${suffix}`,
      category: 'Beer',
      price: '12.50',
      tax_rate: '0.14',
      track_stock: true
    }))
    assert.equal(product.ok, true, JSON.stringify(product.error))
    productId = product.result.product_id
    const receive = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
      product_id: productId,
      quantity: '10',
      unit_cost: '6.25',
      supplier_ref: `SYNC-GRN-${suffix}`
    }))
    assert.equal(receive.ok, true, JSON.stringify(receive.error))
  }
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '2' }],
    discount_amount: '0',
    tip_amount: '1.25',
    tenders: [{ method: 'cash', amount: '29.75', tendered: '30.00' }]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  // A second committed sale guarantees more than one bounded batch even when
  // one commit emits only a few events.
  const second = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '1' }],
    discount_amount: '0',
    tip_amount: '0.50',
    tenders: [{ method: 'card', amount: '14.75', reference: `SYNC-CARD-${suffix}` }]
  }))
  assert.equal(second.ok, true, JSON.stringify(second.error))
  return { shiftId, productId, sale: second }
}

test('cloud sync uploads committed events through the receiver contract, is bounded and only acknowledges ingestion', async (t) => {
  const h = await createHarness(t)
  await h.migrator.query('DROP SCHEMA IF EXISTS cloud_ingest CASCADE')
  await h.migrator.query(receiverContractSql())

  const receiverClient = new Client(connectionConfig({
    ...h.target,
    user: process.env.BAR_LOCAL_MIGRATOR_USER || 'bar_local_migrator',
    maintenance: false
  }))
  await receiverClient.connect()
  const receiver = startReceiver(receiverClient, { identity: { authority_id: h.authorityId, business_id: h.businessId, outlet_id: h.outletId } })
  const receiverUrl = await receiver.start()
  t.after(async () => {
    await receiver.close()
    await receiverClient.end()
  })

  const seeded = await queueSaleEvents(h, 'A')
  await configureLocalCloud(h, receiverUrl)
  const config = serviceConfig(h.target)
  const pool = createPool(config)
  const controller = createCloudSyncController({ config, pool })
  t.after(async () => {
    await controller.stop()
    await closePool(pool)
  })

  const first = await controller.runNow({ reason: 'test' })
  assert.equal(first.status, 'ok', JSON.stringify({ first, linkProofs: receiver.state.linkProofs, expectedIdentity: { authority_id: h.authorityId, business_id: h.businessId, outlet_id: h.outletId } }))
  assert.equal(first.uploaded_batches, 1, 'max_batches_per_run must bound the work')
  assert.equal(first.pending_events > 0, true, 'events beyond the bounded batch must remain pending')
  assert.equal(first.final_state, null)

  const statusAfterFirst = await controller.status()
  assert.equal(statusAfterFirst.pending_events > 0, true)
  assert.equal(statusAfterFirst.last_error_code, null)
  assert.ok(statusAfterFirst.last_success_at)

  let runs = 1
  let last = first
  while (last.pending_events > 0 && runs < 20) {
    last = await controller.runNow({ reason: 'test-drain' })
    assert.equal(last.status, 'ok', JSON.stringify(last))
    runs += 1
  }
  assert.equal(last.pending_events, 0)
  assert.equal(runs > 1, true)

  const batches = await h.migrator.query(
    `SELECT batch_id, status, transport_status, acknowledged_at, receiver_reference, manifest_hash, manifest
       FROM bar_local.export_batches ORDER BY from_sequence`
  )
  assert.equal(batches.rows.length > 0, true)
  for (const batch of batches.rows) {
    assert.equal(batch.status, 'acknowledged')
    assert.equal(batch.transport_status, 'ingested')
    assert.ok(batch.acknowledged_at)
    assert.ok(batch.receiver_reference)
  }
  // Every batch must carry whole commit groups; with a one-group limit each
  // batch holds exactly one commit sequence.
  const splitGroups = await h.migrator.query(
    `SELECT b.batch_id, count(DISTINCT i.commit_sequence)::integer AS groups
       FROM bar_local.export_batches b
       JOIN bar_local.export_batch_items i USING (batch_id)
      GROUP BY b.batch_id
     HAVING count(DISTINCT i.commit_sequence) <> 1`
  )
  assert.deepEqual(splitGroups.rows, [], 'a cloud upload batch must never split a commit group')

  const receipts = await h.migrator.query(
    `SELECT receiver_state, count(*)::integer AS count FROM bar_local.cloud_sync_receipts GROUP BY receiver_state`
  )
  assert.deepEqual(receipts.rows, [{ receiver_state: 'ingested', count: batches.rows.length }])

  const ingested = await h.migrator.query('SELECT count(*)::integer AS count FROM cloud_ingest.events')
  assert.equal(ingested.rows[0].count > 0, true)
  const watermarks = await h.migrator.query('SELECT ingested_events, max_ingested_sequence FROM cloud_ingest.watermarks')
  assert.equal(watermarks.rows.length, 1)
  assert.equal(Number(watermarks.rows[0].ingested_events), ingested.rows[0].count)

  // Replaying the exact same transport body must be idempotent and must not
  // create duplicate receiver events.
  const originalBody = receiver.state.bodies[0]
  const replay = await fetch(receiverUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bar-manifest-hash': JSON.parse(originalBody).manifest_hash,
      'x-bar-signature': createHmac('sha256', SECRET)
        .update(`${KEY_ID}.${JSON.parse(originalBody).batch_id}.${JSON.parse(originalBody).manifest_hash}`, 'utf8')
        .digest('hex')
    },
    body: originalBody
  })
  assert.equal(replay.status, 200)
  const replayBody = await replay.json()
  assert.equal(replayBody.ok, true)
  assert.equal(replayBody.state, 'ingested')
  const afterReplay = await h.migrator.query('SELECT count(*)::integer AS count FROM cloud_ingest.events')
  assert.equal(afterReplay.rows[0].count, ingested.rows[0].count)

  // A changed body under an unchanged manifest hash must be refused.
  const tampered = JSON.parse(originalBody)
  tampered.events[0].payload = { tampered: true }
  const tamperedResponse = await fetch(receiverUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-bar-manifest-hash': tampered.manifest_hash,
      'x-bar-signature': createHmac('sha256', SECRET)
        .update(`${KEY_ID}.${tampered.batch_id}.${tampered.manifest_hash}`, 'utf8')
        .digest('hex')
    },
    body: JSON.stringify(tampered)
  })
  assert.equal(tamperedResponse.status, 409)
  const tamperedBody = await tamperedResponse.json()
  assert.equal(tamperedBody.ok, false)
  assert.match(tamperedBody.code, /HASH_MISMATCH|PAYLOAD_CONFLICT/)

  // Receipt-only and validation-only acknowledgements must leave the local
  // work pending, and a later ingestion must complete it.
  await queueSaleEvents(h, 'B', seeded)
  receiver.state.mode = 'received'
  const receiptOnly = await controller.runNow({ reason: 'test-receipt' })
  assert.equal(receiptOnly.status, 'ok', JSON.stringify(receiptOnly))
  assert.equal(receiptOnly.pending_events > 0, true)
  const pendingBatch = await h.migrator.query(
    `SELECT status, transport_status, acknowledged_at FROM bar_local.export_batches
      WHERE status <> 'acknowledged' ORDER BY from_sequence LIMIT 1`
  )
  assert.equal(pendingBatch.rows.length, 1)
  assert.equal(pendingBatch.rows[0].status !== 'acknowledged', true)
  assert.equal(pendingBatch.rows[0].transport_status, 'received')

  receiver.state.mode = 'validated'
  const validationOnly = await controller.runNow({ reason: 'test-validate' })
  assert.equal(validationOnly.status, 'ok', JSON.stringify(validationOnly))
  assert.equal(validationOnly.pending_events > 0, true)

  receiver.state.mode = 'ingest'
  let finalResult = await controller.runNow({ final: true, reason: 'test-final' })
  let finalRuns = 1
  while ((finalResult.pending_events ?? 0) > 0 && finalRuns < 20) {
    finalResult = await controller.runNow({ final: true, reason: 'test-final-drain' })
    finalRuns += 1
  }
  assert.equal(finalResult.status, 'ok', JSON.stringify(finalResult))
  assert.equal(finalResult.final_state, 'ingested')
  assert.equal(finalResult.pending_events, 0)
  const finalStatus = await controller.status()
  assert.equal(finalStatus.pending_events, 0)
  assert.equal(finalStatus.last_final_sync_state, 'ingested')
  assert.ok(finalStatus.last_final_sync_at)
})

test('cloud sync fails closed for disabled, non-primary and unapproved transports without touching a receiver', async (t) => {
  const h = await createHarness(t)
  const targetConfig = serviceConfig(h.target)

  const disabledConfig = { ...targetConfig, cloudSync: { ...targetConfig.cloudSync, transport: 'disabled' } }
  const disabledPool = createPool(disabledConfig)
  const disabled = createCloudSyncController({ config: disabledConfig, pool: disabledPool })
  t.after(async () => {
    await disabled.stop()
    await closePool(disabledPool)
  })
  const disabledResult = await disabled.runNow({ final: true })
  assert.equal(disabledResult.status, 'disabled')
  assert.equal(disabledResult.final_state, 'disabled')

  const clientConfig = { ...targetConfig, networkRole: 'client' }
  const clientPool = createPool(clientConfig)
  const client = createCloudSyncController({ config: clientConfig, pool: clientPool })
  t.after(async () => {
    await client.stop()
    await closePool(clientPool)
  })
  const clientResult = await client.runNow({ final: true })
  assert.equal(clientResult.status, 'not_primary')
  assert.equal(clientResult.final_state, 'not_primary')

  const approvedConfig = { ...targetConfig, cloudSync: { ...targetConfig.cloudSync, transport: 'approved' } }
  const approvedPool = createPool(approvedConfig)
  const approved = createCloudSyncController({ config: approvedConfig, pool: approvedPool })
  t.after(async () => {
    await approved.stop()
    await closePool(approvedPool)
  })
  const approvedResult = await approved.runNow({ final: true })
  assert.equal(approvedResult.status, 'failed')
  assert.equal(approvedResult.last_error_code, 'CLOUD_SYNC_TRANSPORT_NOT_AUTHORISED')
  assert.equal(approvedResult.uploaded_batches, 0)
})

test('receiver records late sequences and rejects duplicate events or changed batch identity', async (t) => {
  const h = await createHarness(t)
  await h.migrator.query('DROP SCHEMA IF EXISTS cloud_ingest CASCADE')
  await h.migrator.query(receiverContractSql())

  const authorityId = h.authorityId
  const businessId = h.businessId
  const outletId = h.outletId

  async function hash(value) {
    const result = await h.migrator.query(
      'SELECT cloud_ingest.sha256_hex(cloud_ingest.canonical_jsonb_text($1::jsonb)) AS hash',
      [JSON.stringify(value)]
    )
    return result.rows[0].hash
  }

  async function bundle({ batchId, sequence, payload, eventId = randomUUID(), epoch = 1 }) {
    const payloadHash = await hash(payload)
    const event = {
      event_id: eventId,
      commit_sequence: sequence,
      event_index: 0,
      event_type: 'sale.committed',
      operation_id: randomUUID(),
      authority_epoch: epoch,
      business_date: '2026-10-27',
      payload,
      payload_hash: payloadHash,
      created_at: '2026-10-27T10:00:00.000Z'
    }
    const manifest = {
      schema: 'bar-local-export-bundle',
      schema_version: 1,
      batch_id: batchId,
      authority_id: authorityId,
      authority_epoch: epoch,
      business_id: businessId,
      outlet_id: outletId,
      from_sequence: sequence,
      to_sequence: sequence,
      checkpoint: sequence,
      event_count: 1,
      created_at: '2026-10-27T10:01:00.000Z',
      events: [event]
    }
    const manifestHash = await hash(manifest)
    return { ...manifest, manifest_hash: manifestHash }
  }

  async function ingest(value) {
    await h.migrator.query('SELECT cloud_ingest.receive($1::jsonb)', [JSON.stringify(value)])
    await h.migrator.query('SELECT cloud_ingest.validate($1::jsonb)', [JSON.stringify(value)])
    const result = await h.migrator.query('SELECT cloud_ingest.ingest($1::jsonb) AS result', [JSON.stringify(value)])
    return result.rows[0].result
  }

  const firstBatchId = randomUUID()
  const firstEventId = randomUUID()
  const first = await bundle({ batchId: firstBatchId, sequence: 10, payload: { amount: '12.50' }, eventId: firstEventId })
  const firstResult = await ingest(first)
  assert.equal(firstResult.state, 'ingested')
  assert.equal(firstResult.late_sequence, false)

  // A lower commit sequence can legitimately commit after a higher one. It is
  // recorded as a late batch, not treated as a gap or a duplicate.
  const late = await bundle({ batchId: randomUUID(), sequence: 5, payload: { amount: '3.75' } })
  const lateResult = await ingest(late)
  assert.equal(lateResult.state, 'ingested')
  assert.equal(lateResult.late_sequence, true)
  const watermark = await h.migrator.query(
    'SELECT ingested_events, max_ingested_sequence, late_sequence_batches FROM cloud_ingest.watermarks WHERE authority_id = $1',
    [authorityId]
  )
  assert.equal(Number(watermark.rows[0].ingested_events), 2)
  assert.equal(Number(watermark.rows[0].max_ingested_sequence), 10)
  assert.equal(Number(watermark.rows[0].late_sequence_batches), 1)

  // The same event identity with a different payload is a conflict, never an
  // overwrite.
  const conflictingEvent = await bundle({
    batchId: randomUUID(),
    sequence: 11,
    eventId: firstEventId,
    payload: { amount: '99.99' }
  })
  await h.migrator.query('SELECT cloud_ingest.receive($1::jsonb)', [JSON.stringify(conflictingEvent)])
  await h.migrator.query('SELECT cloud_ingest.validate($1::jsonb)', [JSON.stringify(conflictingEvent)])
  await assert.rejects(
    h.migrator.query('SELECT cloud_ingest.ingest($1::jsonb)', [JSON.stringify(conflictingEvent)]),
    /EVENT_PAYLOAD_CONFLICT|already received with different content/
  )
  const eventsAfterConflict = await h.migrator.query('SELECT count(*)::integer AS count FROM cloud_ingest.events')
  assert.equal(eventsAfterConflict.rows[0].count, 2)

  // The same batch identity with a changed manifest is also a conflict.
  const changedBatch = await bundle({ batchId: firstBatchId, sequence: 10, payload: { amount: '1.00' }, eventId: randomUUID() })
  await assert.rejects(
    h.migrator.query('SELECT cloud_ingest.receive($1::jsonb)', [JSON.stringify(changedBatch)]),
    /BATCH_PAYLOAD_CONFLICT|different content/
  )
})

test('worker start follows the configured schedule instead of uploading on every restart', () => {
  const midday = new Date(2026, 9, 27, 12, 0, 0, 0)
  const daily = firstRunDelay({
    nextDueAt: null,
    configured: true,
    enabled: true,
    scheduleMode: 'daily',
    dailyAt: '23:30',
    now: midday
  })
  assert.equal(new Date(midday.getTime() + daily).getHours(), 23)
  assert.equal(new Date(midday.getTime() + daily).getMinutes(), 30)

  const frequent = firstRunDelay({
    nextDueAt: null,
    configured: true,
    enabled: true,
    scheduleMode: 'fifteen_minutes',
    dailyAt: null,
    now: midday
  })
  assert.equal(frequent, 15 * 60 * 1000)

  // A committed due time wins, but a stale due time cannot fire in the past.
  const committed = firstRunDelay({
    nextDueAt: new Date(midday.getTime() + 120_000).toISOString(),
    configured: true,
    enabled: true,
    scheduleMode: 'daily',
    dailyAt: '23:30',
    now: midday
  })
  assert.equal(committed, 120_000)
  const overdue = firstRunDelay({
    nextDueAt: new Date(midday.getTime() - 600_000).toISOString(),
    configured: true,
    enabled: true,
    scheduleMode: 'daily',
    dailyAt: '23:30',
    now: midday
  })
  assert.equal(overdue, 5_000)

  // An unconfigured authority waits for the next check rather than recording a
  // misleading upload failure five seconds after every start.
  const unconfigured = firstRunDelay({
    nextDueAt: null,
    configured: false,
    enabled: false,
    scheduleMode: 'daily',
    dailyAt: '23:30',
    now: midday
  })
  assert.equal(unconfigured, 15 * 60 * 1000)
})

test('daily scheduling computes the next local occurrence and never schedules the past', () => {  const midday = new Date(2026, 9, 27, 12, 0, 0, 0)
  const laterSameDay = new Date(nextDueAt('daily', '23:30', midday))
  assert.equal(laterSameDay.getFullYear(), 2026)
  assert.equal(laterSameDay.getMonth(), 9)
  assert.equal(laterSameDay.getDate(), 27)
  assert.equal(laterSameDay.getHours(), 23)
  assert.equal(laterSameDay.getMinutes(), 30)

  const late = new Date(2026, 9, 27, 23, 45, 0, 0)
  const nextDay = new Date(nextDueAt('daily', '23:30', late))
  assert.equal(nextDay.getDate(), 28)
  assert.equal(nextDay.getHours(), 23)
  assert.equal(nextDay.getMinutes(), 30)

  const fifteen = new Date(nextDueAt('fifteen_minutes', null, midday))
  assert.equal(fifteen.getTime() - midday.getTime(), 15 * 60 * 1000)
})
