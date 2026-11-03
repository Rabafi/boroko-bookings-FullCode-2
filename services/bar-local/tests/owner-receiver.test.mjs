import assert from 'node:assert/strict'
import { randomUUID, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import pg from 'pg'
import { createHarness } from './harness.mjs'
import { connectionConfig, loadTarget, assertClusterIdentity } from '../scripts/lib/db-target.mjs'
import { startOwnerReceiver } from '../dist/ownerReceiver.js'
import { sign } from '../dist/ownerCrypto.js'

const { Client, Pool } = pg
const SECRET = 'bar-owner-receiver-secret-0123456789abcdef0123456789'
const PWA_ORIGIN = 'http://127.0.0.1:4173'
const here = path.dirname(fileURLToPath(import.meta.url))
const sql = (name) => readFileSync(path.join(here, '..', 'db', 'cloud-receiver', name), 'utf8')
const availablePort = () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close((error) => error ? reject(error) : resolve(address.port))
  })
})

test('committed local Bar sale reaches the isolated owner receiver and existing-PWA read contract', async (t) => {
  const h = await createHarness(t)
  const target = loadTarget({ maintenance: true })
  const admin = new Client(connectionConfig(target))
  await admin.connect()
  const receiverDatabase = `bar_local_test_owner_${randomUUID().replaceAll('-', '').slice(0, 16)}`
  let receiverPool
  let receiver
  await assertClusterIdentity(admin, target, { allowUnreadableDataDirectory: true, allowAbsentMarker: true })
  await admin.query((await admin.query("SELECT format('CREATE DATABASE %I OWNER %I',$1::text,$2::text)", [receiverDatabase, process.env.BAR_LOCAL_MIGRATOR_USER || 'bar_local_migrator'])).rows[0].format)
  try {
    receiverPool = new Pool({ ...connectionConfig({ ...h.target, database: receiverDatabase, user: process.env.BAR_LOCAL_MIGRATOR_USER || 'bar_local_migrator', maintenance: false }), max: 6 })
    await receiverPool.query(sql('0001_cloud_ingest.sql'))
    await receiverPool.query(sql('0002_owner_portal.sql'))
    const verificationLinks = []
    const receiverPort = await availablePort()
    receiver = await startOwnerReceiver({
      pool: receiverPool,
      masterKey: 'isolated-owner-receiver-master-key-0000000000000000000000',
      publicUrl: `http://127.0.0.1:${receiverPort}`,
      pwaOrigin: PWA_ORIGIN,
      host: '127.0.0.1',
      allowTestDatabase: true,
      port: receiverPort,
      deliverVerification: async (_email, value) => { verificationLinks.push(value) }
    })
    const receiverUrl = `http://127.0.0.1:${receiverPort}`
    const ownerFetch = (url, { token, body, method = body === undefined ? 'GET' : 'POST', origin = PWA_ORIGIN } = {}) => fetch(`${receiverUrl}${url}`, {
      method,
      headers: {
        ...(origin ? { Origin: origin } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })

    const registration = await ownerFetch('/v1/register', { body: { email: 'owner@example.test', password: 'synthetic-owner-password-123' } })
    assert.equal(registration.status, 202)
    assert.equal(verificationLinks.length, 1)
    const verifyUrl = new URL(verificationLinks[0])
    const verified = await fetch(verifyUrl, { redirect: 'manual' })
    assert.equal(verified.status, 303)
    assert.equal(verified.headers.get('location'), PWA_ORIGIN)

    const login = await ownerFetch('/v1/login', { body: { email: 'owner@example.test', password: 'synthetic-owner-password-123' } })
    assert.equal(login.status, 200)
    const session = (await login.json()).token
    const enrollmentResponse = await ownerFetch('/v1/owner/enrollment', { token: session, body: {} })
    assert.equal(enrollmentResponse.status, 201)
    const enrollment = await enrollmentResponse.json()
    const keyId = randomUUID()
    const claim = await ownerFetch('/v1/links/claim', { body: {
      enrollment_code: enrollment.enrollment_code,
      key_id: keyId,
      authority_id: h.authorityId,
      business_id: h.businessId,
      outlet_id: h.outletId,
      secret: SECRET,
      business_name: 'Synthetic Local Bar'
    } })
    assert.equal(claim.status, 200)
    assert.equal((await claim.json()).pending_approval, true)

    const approval = await ownerFetch(`/v1/owner/links/${keyId}/approve`, { token: session, body: {} })
    assert.equal(approval.status, 200)
    const nonce = randomUUID()
    const linkStatus = await ownerFetch('/v1/links/status', { body: { key_id: keyId, nonce, signature: sign(SECRET, { key_id: keyId, nonce }) } })
    assert.equal(linkStatus.status, 200)
    const statusBody = await linkStatus.json()
    assert.equal(statusBody.active, true)
    assert.equal(statusBody.authority_id, h.authorityId)

    const shiftId = await h.openShift('100.00')
    const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
      sku: 'OWNER-SYNC-ALE', name: 'Owner Sync Ale', category: 'Beer', price: '25.00', tax_rate: '0.1400', track_stock: true
    }))
    assert.equal(product.ok, true, JSON.stringify(product.error))
    const receivedStock = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
      product_id: product.result.product_id, quantity: '5', unit_cost: '10.00', supplier_ref: 'OWNER-SYNC-GRN'
    }))
    assert.equal(receivedStock.ok, true, JSON.stringify(receivedStock.error))
    const committed = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
      shift_id: shiftId,
      items: [{ product_id: product.result.product_id, quantity: '2' }],
      tenders: [{ method: 'cash', amount: '57.00', tendered: '60.00' }]
    }))
    assert.equal(committed.ok, true, JSON.stringify(committed.error))
    const shiftClose = await h.call('cmd_shift_close', h.envelope('shift.close', { shift_id: shiftId, counted_cash: '157.00' }))
    assert.equal(shiftClose.ok, true, JSON.stringify(shiftClose.error))
    const cashupCommit = await h.call('cmd_cashup_submit', h.envelope('cashup.submit', {
      shift_id: shiftId, counted_cash: '157.00', counted_card: '0', notes: 'synthetic balanced owner report', proof_refs: []
    }))
    assert.equal(cashupCommit.ok, true, JSON.stringify(cashupCommit.error))

    const cloudConfig = await h.runtime.query('SELECT bar_local.cloud_sync_config_set($1,$2,$3::jsonb) AS result', [
      h.ownerTokenHash, h.deviceId, JSON.stringify({
        enabled: true,
        receiver_url: `${receiverUrl}/v1/cloud/batches`,
        schedule_mode: 'fifteen_minutes', daily_at: '23:30', batch_limit: 20,
        signing_key_id: keyId
      })
    ])
    assert.equal(cloudConfig.rows[0].result.enabled, true)

    const today = (await h.migrator.query('SELECT business_date::text FROM bar_local.sales WHERE operation_id=$1', [committed.result?.operation_id ?? committed.receipt?.operation_id])).rows[0]?.business_date
      ?? (await h.migrator.query('SELECT business_date::text FROM bar_local.sales WHERE id=$1', [committed.result.sale_id])).rows[0].business_date
    const pending = await ownerFetch('/v1/owner/bars', { token: session })
    assert.equal(pending.status, 200)
    assert.equal((await pending.json()).bars[0].active, true)

    const config = (await import('../dist/config.js')).loadConfig({
      BAR_LOCAL_ALLOW_TEST_DB: '1', BAR_LOCAL_NETWORK_ROLE: 'single_host', BAR_LOCAL_HTTP_HOST: '127.0.0.1',
      BAR_LOCAL_DB_HOST: h.target.host, BAR_LOCAL_DB_PORT: String(h.target.port), BAR_LOCAL_DB_NAME: h.target.database,
      BAR_LOCAL_RUNTIME_USER: process.env.BAR_LOCAL_RUNTIME_USER || 'bar_local_runtime',
      BAR_LOCAL_RUNTIME_PASSWORD: process.env.BAR_LOCAL_RUNTIME_PASSWORD ?? process.env.BAR_LOCAL_DB_PASSWORD,
      BAR_LOCAL_CLOUD_SYNC_TRANSPORT: 'local_test', BAR_LOCAL_CLOUD_SYNC_KEY: SECRET,
      BAR_LOCAL_CLOUD_SYNC_KEY_ID: keyId, BAR_LOCAL_CLOUD_SYNC_MAX_BATCHES: '10', BAR_LOCAL_CLOUD_SYNC_TIMEOUT_MS: '5000'
    })
    const { createPool, closePool } = await import('../dist/db.js')
    const { createCloudSyncController } = await import('../dist/operations/cloudSync.js')
    const localPool = createPool(config)
    const cloudSync = createCloudSyncController({ config, pool: localPool })
    t.after(async () => { await cloudSync.stop(); await closePool(localPool) })
    const upload = await cloudSync.runNow({ reason: 'isolated_owner_projection_test' })
    assert.equal(upload.status, 'ok', JSON.stringify(upload))
    assert.equal(upload.pending_events, 0)

    const salesResponse = await ownerFetch(`/v1/owner/bars/${keyId}/sales?from=${today}&to=${today}`, { token: session })
    assert.equal(salesResponse.status, 200)
    assert.equal(salesResponse.headers.get('access-control-allow-origin'), PWA_ORIGIN)
    const sales = await salesResponse.json()
    assert.equal(sales.complete, true)
    assert.equal(sales.bar.business_id, h.businessId)
    assert.equal(sales.totals.committed_sales, 1)
    assert.equal(Number(sales.totals.gross_sales), 57)
    assert.equal(Number(sales.totals.net_sales), 57)
    assert.equal(sales.transactions.length, 1)
    assert.equal(sales.transactions[0].status, 'completed')
    assert.ok(sales.last_ingested_at)

    const operationsResponse = await ownerFetch(`/v1/owner/bars/${keyId}/operations?from=${today}&to=${today}`, { token: session })
    assert.equal(operationsResponse.status, 200)
    const operations = await operationsResponse.json()
    assert.equal(operations.complete, true)
    assert.equal(operations.summary.cashup_count, 1)
    assert.equal(Number(operations.summary.submitted_variance_total), 0)
    assert.equal(operations.cashups.length, 1)
    assert.equal(operations.cashups[0].status, 'submitted')
    assert.ok(operations.summary.stock_movement_count >= 1)
    assert.ok(operations.stock_movements.some((row) => Number(row.delta) === 5))

    const preflight = await fetch(`${receiverUrl}/v1/owner/bars`, {
      method: 'OPTIONS', headers: { Origin: PWA_ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' }
    })
    assert.equal(preflight.status, 204)
    const hostileOrigin = await ownerFetch('/v1/owner/bars', { token: session, origin: 'https://untrusted.example' })
    assert.equal(hostileOrigin.status, 403)

    const secondRegistration = await ownerFetch('/v1/register', { body: { email: 'other@example.test', password: 'another-synthetic-password-123' } })
    assert.equal(secondRegistration.status, 202)
    const secondVerify = await fetch(verificationLinks[1], { redirect: 'manual' })
    assert.equal(secondVerify.status, 303)
    const secondLogin = await ownerFetch('/v1/login', { body: { email: 'other@example.test', password: 'another-synthetic-password-123' } })
    const otherSession = (await secondLogin.json()).token
    const wrongOwner = await ownerFetch(`/v1/owner/bars/${keyId}/sales?from=${today}&to=${today}`, { token: otherSession })
    assert.equal(wrongOwner.status, 404)
    const barsForOtherOwner = await ownerFetch('/v1/owner/bars', { token: otherSession })
    assert.deepEqual((await barsForOtherOwner.json()).bars, [])

    const replayBundleText = (await receiverPool.query('SELECT manifest::text FROM cloud_ingest.batch_receipts ORDER BY received_at LIMIT 1')).rows[0].manifest
    const replayBundle = JSON.parse(replayBundleText)
    const replay = await fetch(`${receiverUrl}/v1/cloud/batches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'x-bar-key-id': keyId,
        'x-bar-signature': createHmac('sha256', SECRET).update(`${keyId}.${replayBundle.batch_id}.${replayBundle.manifest_hash}`).digest('hex'),
        'x-bar-manifest-hash': replayBundle.manifest_hash, 'x-bar-batch-id': replayBundle.batch_id,
        'x-bar-authority-id': h.authorityId
      }, body: replayBundleText
    })
    assert.equal(replay.status, 200)
    assert.equal((await replay.json()).state, 'ingested')
    assert.equal((await receiverPool.query("SELECT count(*)::integer AS n FROM cloud_ingest.events WHERE event_type='sale.committed'")).rows[0].n, sales.transactions.filter((row) => row.event_type === 'sale.committed').length)

    const revoke = await ownerFetch(`/v1/owner/links/${keyId}/revoke`, { token: session, body: {} })
    assert.equal(revoke.status, 200)
    const revokedRead = await ownerFetch(`/v1/owner/bars/${keyId}/sales?from=${today}&to=${today}`, { token: session })
    assert.equal(revokedRead.status, 403)
    const revokedOperations = await ownerFetch(`/v1/owner/bars/${keyId}/operations?from=${today}&to=${today}`, { token: session })
    assert.equal(revokedOperations.status, 403)

    const laterStock = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
      product_id: product.result.product_id, quantity: '1', unit_cost: '10.00', supplier_ref: 'OWNER-SYNC-AFTER-REVOKE'
    }))
    assert.equal(laterStock.ok, true, JSON.stringify(laterStock.error))
    const eventsBeforeRevokedSync = Number((await receiverPool.query('SELECT count(*)::text AS n FROM cloud_ingest.events')).rows[0].n)
    const revokedSync = await cloudSync.runNow({ reason: 'revoked_link_test' })
    assert.equal(revokedSync.status, 'failed')
    assert.equal(revokedSync.last_error_code, 'CLOUD_SYNC_OWNER_LINK_REVOKED')
    assert.ok(revokedSync.pending_events > 0)
    const eventsAfterRevokedSync = Number((await receiverPool.query('SELECT count(*)::text AS n FROM cloud_ingest.events')).rows[0].n)
    assert.equal(eventsAfterRevokedSync, eventsBeforeRevokedSync, 'revoked links must be rejected before financial event bodies are sent')
  } finally {
    await receiver?.close()
    await receiverPool?.end()
    await assertClusterIdentity(admin, target, { allowUnreadableDataDirectory: true, allowAbsentMarker: true })
    const drop = (await admin.query("SELECT format('DROP DATABASE IF EXISTS %I', $1::text) AS statement", [receiverDatabase])).rows[0].statement
    await admin.query(drop)
    await admin.end()
  }
})
