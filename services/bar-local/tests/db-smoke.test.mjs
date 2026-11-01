import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { assertClusterIdentity, connectionConfig, loadTarget } from '../scripts/lib/db-target.mjs'
import { resetSchema, runMigrations, seedSetupSecret, seedTestGuard } from '../scripts/lib/migrate.mjs'

const { Client } = pg

const secret = 'db-test-setup-secret-0123456789abcdef'
const secretHash = createHash('sha256').update(secret, 'utf8').digest('hex')
const sha = (value) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')

async function openClient(target, user, password) {
  const client = new Client(connectionConfig({ ...target, user, password, maintenance: false }))
  await client.connect()
  return client
}

test('local Bar authority commits, replays and reverses a sale', async (t) => {
  const target = loadTarget()
  const migratorUser = process.env.BAR_LOCAL_MIGRATOR_USER || 'bar_local_migrator'
  const migrator = await openClient(target, migratorUser)
  const runtime = await openClient(target, process.env.BAR_LOCAL_RUNTIME_USER || 'bar_local_runtime')
  t.after(async () => {
    await runtime.end()
    await migrator.end()
  })

  await assertClusterIdentity(migrator, target, { allowUnreadableDataDirectory: true, allowAbsentMarker: true })
  await resetSchema(migrator)
  await runMigrations(migrator)
  await seedTestGuard(migrator, target.clusterData)
  await seedSetupSecret(migrator, secretHash)
  await assertClusterIdentity(migrator, target, { allowUnreadableDataDirectory: true })

  const authorityId = randomUUID()
  const businessId = randomUUID()
  const outletId = randomUUID()
  const deviceId = randomUUID()
  const ownerToken = `test-owner-token-${randomUUID()}`
  const managerToken = `test-manager-token-${randomUUID()}`
  const ownerTokenHash = createHash('sha256').update(ownerToken).digest('hex')
  const managerTokenHash = createHash('sha256').update(managerToken).digest('hex')

  const commission = await runtime.query(
    `SELECT bar_local.commission_owner($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result`,
    [authorityId, businessId, outletId, 'Test Bar', 'Main Bar', 'Owner One',
     createHash('sha256').update('1234').digest('hex'), 'test-salt', 100000, secretHash, 'BWP', 'Africa/Gaborone']
  )
  const ownerStaffId = commission.rows[0].result.owner_staff_id
  assert.equal(commission.rows[0].result.authority_epoch, 1)

  await migrator.query(
    `INSERT INTO bar_local.devices (id, business_id, outlet_id, name, platform, certificate_fingerprint, token_hash)
     VALUES ($1,$2,$3,'Till 1','modern','test-fingerprint',$4)`,
    [deviceId, businessId, outletId, createHash('sha256').update('device-token').digest('hex')]
  )
  const managerStaff = await migrator.query(
    `INSERT INTO bar_local.staff (business_id, display_name, role, capabilities, pin_hash, pin_salt, pin_iterations)
     VALUES ($1,'Manager One','manager',ARRAY['pos.view','pos.manage','pos.void','pos.cashup','pos.reports'],$2,'test-salt',100000)
     RETURNING id`,
    [businessId, createHash('sha256').update('5678').digest('hex')]
  )
  const managerStaffId = managerStaff.rows[0].id

  await runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [ownerStaffId, deviceId, outletId, ownerTokenHash])
  await runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [managerStaffId, deviceId, outletId, managerTokenHash])

  const envelope = (command, payload, operationId = randomUUID()) => ({
    contract_version: 1,
    operation_id: operationId,
    command,
    authority_id: authorityId,
    authority_epoch: 1,
    business_id: businessId,
    outlet_id: outletId,
    device_id: deviceId,
    payload
  })

  const call = async (fn, env, hash = sha(env.payload), approvalHash = null) => {
    const result = await runtime.query(
      `SELECT bar_local.${fn}($1,$2,$3::jsonb,$4,$5) AS result`,
      [ownerTokenHash, deviceId, JSON.stringify(env), hash, approvalHash]
    )
    return result.rows[0].result
  }

  const setupProduct = await migrator.query(
    `INSERT INTO bar_local.products (business_id, sku, name, price, tax_rate, active)
     VALUES ($1, 'SHIFT-FIXTURE', 'Shift setup fixture', 1, 0, true) RETURNING id`, [businessId]
  )
  const shiftEnvelope = envelope('shift.open', { opening_float: '100.00' })
  const shift = await call('cmd_shift_open', shiftEnvelope)
  await migrator.query('DELETE FROM bar_local.products WHERE id = $1', [setupProduct.rows[0].id])
  assert.equal(shift.ok, true)
  assert.equal(shift.outcome, 'committed_local')
  const shiftId = shift.result.shift_id

  const bootstrap = await runtime.query(
    `SELECT bar_local.query_dispatch($1,$2,$3,$4,'bootstrap','{}'::jsonb) AS result`,
    [ownerTokenHash, deviceId, authorityId, 1]
  )
  assert.equal(bootstrap.rows[0].result.data.current_shift.shift_id, shiftId)
  assert.equal(bootstrap.rows[0].result.data.business.currency, 'BWP')

  const productEnvelope = envelope('catalogue.upsert', {
    sku: 'BEER-330', name: 'Stout 330ml', category: 'Beer', price: '10.00', tax_rate: '0.14', track_stock: false
  })
  const product = await call('cmd_catalogue_upsert', productEnvelope)
  assert.equal(product.ok, true)
  const productId = product.result.product_id

  const saleEnvelope = envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '2' }],
    discount_amount: '0',
    tip_amount: '0',
    tenders: [{ method: 'cash', amount: '22.80', tendered: '25.00' }]
  })
  const sale = await call('cmd_sale_commit', saleEnvelope)
  assert.equal(sale.ok, true, JSON.stringify(sale))
  assert.equal(Number(sale.result.receipt.total), 22.8)
  assert.equal(Number(sale.result.receipt.change), 2.2)
  assert.equal(sale.receipt.cloud_status, 'integration_disabled')
  assert.equal(sale.receipt.commit_sequence, 3)
  const saleId = sale.result.sale_id

  const replay = await call('cmd_sale_commit', saleEnvelope)
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.sale_id, saleId)

  await assert.rejects(
    () => call('cmd_sale_commit', { ...saleEnvelope, payload: { ...saleEnvelope.payload, tip_amount: '1.00' } }),
    (error) => error.detail === 'IDEMPOTENCY_PAYLOAD_CONFLICT'
  )

  const returnEnvelope = envelope('sale.return', {
    sale_id: saleId,
    lines: [{ sale_line_id: sale.result.receipt.lines[0].sale_line_id, quantity: '2' }],
    reason: 'Customer changed mind',
    disposition: 'restock'
  })
  const returnHash = sha(returnEnvelope.payload)
  const approval = await runtime.query(
    `SELECT bar_local.service_create_approval($1,$2,$3,'pos.void',$4,'sale',$5) AS result`,
    [managerTokenHash, deviceId, managerStaffId, returnHash, saleId]
  )
  returnEnvelope.payload.approval_id = approval.rows[0].result.approval_id
  const returned = await call('cmd_sale_return', returnEnvelope, sha(returnEnvelope.payload), returnHash)
  assert.equal(returned.ok, true, JSON.stringify(returned))
  assert.equal(Number(returned.receipt.total), -22.8)

  const readback = await runtime.query(
    `SELECT bar_local.query_dispatch($1,$2,$3,$4,'sales.list',$5::jsonb) AS result`,
    [ownerTokenHash, deviceId, authorityId, 1, JSON.stringify({ limit: 10 })]
  )
  assert.equal(readback.rows[0].result.data.length >= 2, true)
  const summaries = readback.rows[0].result.data
  assert.equal(summaries.some((row) => row.sale_id === saleId && row.status === 'returned'), true)
})
