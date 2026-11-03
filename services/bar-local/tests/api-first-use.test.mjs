import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'
import { createModernBarLocalAdapter, createHttpTransport } from '../../../src/main/bar-local/index.js'
import { openSqliteIntentJournal } from '../../../src/main/bar-local/sqliteIntents.js'
import { loadCompleteBarList } from '../../../src/shared/barLocalPagination.js'

test('first local Bar use survives restart, permits verified empty-menu setup, then commits audited stock and a sale', async (t) => {
  const h = await createApiHarness(t)
  const temp = mkdtempSync(path.join(os.tmpdir(), 'bar-first-use-'))
  let modern
  t.after(() => {
    modern?.close()
    const actual = realpathSync(temp)
    assert.ok(actual.startsWith(`${realpathSync(os.tmpdir())}${path.sep}`) && path.basename(actual).startsWith('bar-first-use-'))
    rmSync(actual, { recursive: true, force: true })
  })

  const setup = await h.request('/v1/setup/owner', { body: {
    setup_secret: TEST_SETUP_SECRET,
    business_name: 'Synthetic First Use Bar',
    outlet_name: 'Main',
    owner_name: 'Synthetic Owner',
    owner_email: 'owner@example.test',
    owner_password: 'test owner password 123',
    pin: '1234',
    device_name: 'Synthetic till'
  } })
  assert.equal(setup.status, 201, JSON.stringify(setup.body))
  const s = { ...setup.body, device_token: setup.stagedDeviceToken }
  const authority = {
    authority_mode: 'bar_local', product: 'hospitality-pos', business_id: s.business_id,
    outlet_ids: [s.outlet_id], active_outlet_id: s.outlet_id, authority_id: s.authority_id,
    authority_epoch: s.authority_epoch, commissioning_id: 'isolated-first-use', base_url: h.baseUrl
  }
  const makeModern = () => createModernBarLocalAdapter({
    authority_config: authority,
    journal: openSqliteIntentJournal({
      filePath: path.join(temp, 'bar.sqlite'),
      legacyFilePath: path.join(temp, 'bar.jsonl')
    }),
    device_credential: { device_id: s.device_id, device_token: s.device_token },
    transport: createHttpTransport({ base_url: h.baseUrl })
  })

  // A fresh adapter and authenticated owner session model closing and reopening the desktop app.
  modern = makeModern()
  let client = modern.requireClient()
  await client.login({ email: 'owner@example.test', password: 'test owner password 123' })
  const firstReadiness = await client.healthReady()
  assert.equal(firstReadiness.ready, false)
  assert.ok(firstReadiness.blockers.includes('empty_catalogue'))
  const empty = await client.refreshCatalogueSnapshot({ force: true })
  assert.equal(empty.snapshot.complete, true)
  assert.deepEqual(empty.snapshot.products, [])
  const emptyMenu = await loadCompleteBarList((name, filters) => client.query(name, filters), 'menu.availability')
  assert.deepEqual(emptyMenu, [])
  await assert.rejects(client.command({ command: 'shift.open', payload: { opening_float: '0.00' } }), /ready|catalogue|service unavailable/i)
  await assert.rejects(client.command({ command: 'stock.receive', payload: { product_id: randomUUID(), quantity: '1' } }), /ready|catalogue|service unavailable|product/i)

  const productResult = await client.command({ command: 'catalogue.upsert', payload: {
    sku: 'FIRST-ITEM', name: 'First synthetic drink', category: 'Drinks', price: '25.00', tax_rate: '0.0000', track_stock: true, active: true
  } })
  assert.equal(productResult.outcome, 'committed_local')
  const productId = productResult.result.product_id
  assert.equal((await client.healthReady()).ready, true)
  const stockResult = await client.command({ command: 'stock.receive', payload: {
    product_id: productId, quantity: '6', lot_code: 'FIRST-LOT', expires_on: '2030-01-01', unit_cost: '8.00'
  } })
  assert.equal(stockResult.outcome, 'committed_local')
  const shiftResult = await client.command({ command: 'shift.open', payload: { opening_float: '100.00' } })
  assert.equal(shiftResult.outcome, 'committed_local')
  const operationId = randomUUID()
  const sale = await client.command({ command: 'sale.commit', operation_id: operationId, payload: {
    shift_id: shiftResult.result.shift_id,
    items: [{ product_id: productId, quantity: '1' }],
    tenders: [{ method: 'cash', amount: '25.00', tendered: '25.00' }]
  } })
  assert.equal(sale.outcome, 'committed_local')
  assert.equal(sale.receipt.operation_id, operationId)

  const balances = await loadCompleteBarList((name, filters) => client.query(name, filters), 'stock.lot_balances')
  assert.equal(balances.find((row) => row.product_id === productId && row.lot_code === 'FIRST-LOT')?.remaining_quantity, '5.000000')
  assert.equal(modern.journal.get(operationId).state, 'committed_local')
  const dbSale = await h.migrator.query('SELECT id, operation_id FROM bar_local.sales WHERE operation_id=$1', [operationId])
  assert.equal(dbSale.rows.length, 1)
  const audit = await h.migrator.query("SELECT count(*)::int AS n FROM bar_local.audit_log WHERE operation_id=$1", [operationId])
  assert.ok(audit.rows[0].n >= 1)
  const journal = await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.operations WHERE operation_id=$1', [operationId])
  assert.equal(journal.rows[0].n, 1)
})
