import assert from 'node:assert/strict'
import { randomUUID, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import pg from 'pg'
import { createHarness, sha256Text } from './harness.mjs'
import { connectionConfig, loadTarget, assertClusterIdentity } from '../scripts/lib/db-target.mjs'
import { startOwnerReceiver } from '../dist/ownerReceiver.js'
import { canonicalJson } from '../dist/export.js'
import { sign } from '../dist/ownerCrypto.js'

const { Client, Pool } = pg
const SECRET = 'bar-owner-receiver-secret-0123456789abcdef0123456789'
const PWA_ORIGIN = 'http://127.0.0.1:4173'
const here = path.dirname(fileURLToPath(import.meta.url))
const sql = (name) => readFileSync(path.join(here, '..', 'db', 'cloud-receiver', name), 'utf8')
const migrationSql = (name) => readFileSync(path.join(here, '..', 'db', 'migrations', name), 'utf8')
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
    const keyId = 'owner-key:test_01'
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

    const secondaryOutletId = randomUUID()
    await h.migrator.query('INSERT INTO bar_local.outlets(id,business_id,name,code) VALUES($1,$2,$3,$4)', [
      secondaryOutletId, h.businessId, 'Synthetic Second Outlet', `S-${secondaryOutletId.slice(0, 8)}`
    ])
    const secondarySequence = (await h.migrator.query('SELECT commit_sequence FROM bar_local.allocate_sequence()')).rows[0].commit_sequence
    const secondaryOperationId = randomUUID()
    const secondaryEvent = (await h.migrator.query(`
      INSERT INTO bar_local.outbox(commit_sequence,event_index,business_id,outlet_id,event_type,operation_id,authority_epoch,payload,payload_hash)
      VALUES($1,0,$2,$3,'sale.committed',$4,1,'{}'::jsonb,$5) RETURNING event_id
    `, [secondarySequence, h.businessId, secondaryOutletId, secondaryOperationId, sha256Text('{}')])).rows[0]
    const oldBatchId = randomUUID()
    const oldManifest = {
      schema: 'bar-local-export-bundle', schema_version: 1, batch_id: oldBatchId,
      authority_id: h.authorityId, authority_epoch: 1, business_id: h.businessId, outlet_id: secondaryOutletId,
      from_sequence: Number(secondarySequence), to_sequence: Number(secondarySequence), checkpoint: Number(secondarySequence),
      event_count: 1, created_at: '2026-11-03T00:00:00.000Z',
      events: [{ event_id: secondaryEvent.event_id, commit_sequence: Number(secondarySequence), event_index: 0,
        event_type: 'sale.committed', operation_id: secondaryOperationId, authority_epoch: 1,
        payload: {}, payload_hash: sha256Text('{}'), business_date: '2026-11-03', created_at: '2026-11-03T00:00:00.000Z' }]
    }
    const oldManifestHash = sha256Text(canonicalJson(oldManifest))
    await h.migrator.query(`
      INSERT INTO bar_local.export_batches
        (batch_id,from_sequence,to_sequence,event_count,manifest_hash,signature,key_id,file_name,status,checkpoint,
         payload_hash,signature_key_id,signature_status,transport_status,manifest,business_id,outlet_id,authority_id,authority_epoch)
      VALUES($1,$2,$2,1,$3,'old-prepared-signature','old-outlet-key','old-outlet-batch.json','ready',$2,
        $3,'old-outlet-key','signed','prepared',$4::jsonb,$5,$6,$7,1)
    `, [oldBatchId, secondarySequence, oldManifestHash, JSON.stringify(oldManifest), h.businessId, secondaryOutletId, h.authorityId])
    await h.migrator.query('UPDATE bar_local.outbox SET export_batch_id=$1 WHERE event_id=$2', [oldBatchId, secondaryEvent.event_id])
    await h.migrator.query(`
      INSERT INTO bar_local.export_batch_items(batch_id,commit_sequence,event_index,event_id,payload_hash)
      VALUES($1,$2,0,$3,$4)
    `, [oldBatchId, secondarySequence, secondaryEvent.event_id, sha256Text('{}')])

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
    const legacyNextBatch = migrationSql('0064_cloud_sync.sql').match(/CREATE OR REPLACE FUNCTION bar_local\.cloud_sync_next_batch\(\)[\s\S]*?\$\$;/)?.[0]
    assert.ok(legacyNextBatch, 'the 0064 pre-outlet retry function must be available for upgrade coverage')
    await h.migrator.query(legacyNextBatch)
    await h.migrator.query(migrationSql('0079_cloud_sync_event_business_date.sql'))
    await h.migrator.query(migrationSql('0080_cloud_sync_owner_outlet_scope.sql'))
    const beforeRetryScope = (await h.runtime.query('SELECT bar_local.cloud_sync_next_batch() AS result')).rows[0].result
    assert.equal(beforeRetryScope.batch_id, oldBatchId, 'the pre-0081 retry selector must reproduce the old-outlet blockage')
    await h.migrator.query(migrationSql('0081_cloud_sync_retry_outlet_scope.sql'))
    const afterRetryScope = (await h.runtime.query('SELECT bar_local.cloud_sync_next_batch() AS result')).rows[0].result
    assert.equal(afterRetryScope.status, 'no_pending_batch', 'the upgrade must skip and preserve an older batch from another outlet')

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
    const otherOutletPending = await h.migrator.query('SELECT export_batch_id FROM bar_local.outbox WHERE operation_id=$1', [secondaryOperationId])
    assert.equal(otherOutletPending.rows.length, 1)
    assert.equal(otherOutletPending.rows[0].export_batch_id, oldBatchId, 'the old other-outlet batch must retain its outbox ownership')
    const oldBatch = (await h.migrator.query('SELECT status,transport_status,acknowledged_at FROM bar_local.export_batches WHERE batch_id=$1', [oldBatchId])).rows[0]
    assert.deepEqual(oldBatch, { status: 'ready', transport_status: 'prepared', acknowledged_at: null }, 'the excluded batch must remain untouched')

    const cashupId = cashupCommit.result.cashup_id
    const reviewedBy = randomUUID()
    const syntheticEvents = [
      { type: 'cashup.reviewed', payload: { cashup_id: cashupId, status: 'approved', reviewed_by: reviewedBy } },
      { type: 'stock.lot.wasted', payload: { product_id: product.result.product_id, lot_id: randomUUID(), delta: '-1', remaining_quantity: '3', reason: 'synthetic projection check' } },
      { type: 'stock.lot.released', payload: { product_id: product.result.product_id, lot_id: randomUUID(), remaining_quantity: '3', status: 'released' } }
    ]
    for (const [eventIndex, event] of syntheticEvents.entries()) {
      await receiverPool.query(`
        INSERT INTO cloud_ingest.events
          (authority_id,event_id,batch_id,commit_sequence,event_index,event_type,operation_id,authority_epoch,business_id,outlet_id,business_date,payload,payload_hash)
        SELECT $1,$2,$3,COALESCE(max(commit_sequence),0)+1,$4,$5,$6,1,$7,$8,$9,$10::jsonb,repeat('a',64)
        FROM cloud_ingest.events WHERE authority_id=$1
      `, [h.authorityId, randomUUID(), randomUUID(), eventIndex, event.type, randomUUID(), h.businessId, h.outletId, today,
        JSON.stringify(event.payload)])
    }

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
    assert.equal(operationsResponse.status, 200, await operationsResponse.clone().text())
    const operations = await operationsResponse.json()
    assert.equal(operations.complete, true)
    assert.equal(operations.summary.cashup_count, 1)
    assert.equal(Number(operations.summary.submitted_variance_total), 0)
    assert.equal(operations.cashups.length, 2)
    const reviewedCashup = operations.cashups.find((row) => row.event_type === 'cashup.reviewed')
    assert.equal(reviewedCashup.status, 'approved')
    assert.equal(reviewedCashup.reviewed_by, reviewedBy)
    assert.equal(reviewedCashup.counted_cash, operations.cashups.find((row) => row.event_type === 'cashup.submitted').counted_cash)
    assert.ok(operations.summary.stock_movement_count >= 1)
    assert.ok(operations.stock_movements.some((row) => Number(row.delta) === 5))
    const wasteMovement = operations.stock_movements.find((row) => row.event_type === 'stock.lot.wasted')
    assert.equal(wasteMovement.quantity, null)
    assert.equal(wasteMovement.remaining_quantity, '3')
    assert.equal(operations.stock_lot_events.length, 1)

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
