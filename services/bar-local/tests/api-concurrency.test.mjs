import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'

test('100 simultaneous identical-key API requests produce one sale and one receipt', async (t) => {
  const h = await createApiHarness(t)
  const setup = await h.request('/v1/setup/owner', {
    body: {
      setup_secret: TEST_SETUP_SECRET,
      business_name: 'Concurrency Bar',
      outlet_name: 'Main Bar',
      owner_name: 'Owner Concurrent',
      pin: '1234',
      device_name: 'Till Concurrent'
    }
  })
  assert.equal(setup.status, 201, JSON.stringify(setup.body))
  const deviceId = setup.body.device_id
  const login = await h.request('/v1/sessions', {
    deviceToken: setup.stagedDeviceToken,
    body: { email: 'owner@example.test', password: 'test owner password 123' }
  })
  assert.equal(login.status, 201, JSON.stringify(login.body))
  const auth = { token: login.body.session_token, deviceId }
  const scope = {
    authority_id: setup.body.authority_id,
    authority_epoch: setup.body.authority_epoch,
    business_id: setup.body.business_id,
    outlet_id: setup.body.outlet_id,
    device_id: deviceId
  }
  const envelope = (command, payload, operationId = randomUUID()) => ({
    contract_version: 1,
    operation_id: operationId,
    command,
    ...scope,
    payload
  })

  const product = await h.request('/v1/commands', {
    ...auth,
    body: envelope('catalogue.upsert', {
      sku: 'CONCURRENT-1',
      name: 'Concurrency Product',
      category: 'Test',
      price: '10.00',
      tax_rate: '0',
      track_stock: true
    })
  })
  assert.equal(product.body.ok, true, JSON.stringify(product.body.error))
  const productId = product.body.result.product_id

  const received = await h.request('/v1/commands', {
    ...auth,
    body: envelope('stock.receive', { product_id: productId, quantity: '200', unit_cost: '5.00' })
  })
  assert.equal(received.body.ok, true, JSON.stringify(received.body.error))

  const shift = await h.request('/v1/commands', {
    ...auth,
    body: envelope('shift.open', { opening_float: '100.00' })
  })
  assert.equal(shift.body.ok, true, JSON.stringify(shift.body.error))

  const saleEnvelope = envelope('sale.commit', {
    shift_id: shift.body.result.shift_id,
    items: [{ product_id: productId, quantity: '2' }],
    tenders: [{ method: 'cash', amount: '20.00', tendered: '20.00' }]
  })
  const responses = await Promise.all(Array.from({ length: 100 }, () => h.request('/v1/commands', {
    ...auth,
    body: saleEnvelope
  })))

  for (const response of responses) {
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.equal(response.body.ok, true, JSON.stringify(response.body.error))
    assert.equal(response.body.outcome, 'committed_local')
    assert.equal(response.body.receipt.operation_id, saleEnvelope.operation_id)
  }
  assert.equal(responses.filter((response) => response.body.replayed !== true).length, 1)
  const receipts = new Set(responses.map((response) => JSON.stringify(response.body.receipt)))
  assert.equal(receipts.size, 1)
  const saleIds = new Set(responses.map((response) => response.body.result.sale_id))
  assert.equal(saleIds.size, 1)

  const conflict = await h.request('/v1/commands', {
    ...auth,
    body: {
      ...saleEnvelope,
      payload: {
        ...saleEnvelope.payload,
        items: [{ product_id: productId, quantity: '3' }],
        tenders: [{ method: 'cash', amount: '30.00', tendered: '30.00' }]
      }
    }
  })
  assert.equal(conflict.status, 409, JSON.stringify(conflict.body))
  assert.equal(conflict.body.code, 'IDEMPOTENCY_PAYLOAD_CONFLICT')

  const saleLines = await h.migrator.query(
    'SELECT count(*)::int AS count FROM bar_local.sale_lines WHERE product_id = $1',
    [productId]
  )
  assert.equal(saleLines.rows[0].count, 1)
  const operations = await h.migrator.query(
    `SELECT count(*)::int AS count FROM bar_local.operations
      WHERE operation_id = $1 AND command = 'sale.commit' AND status = 'committed'`,
    [saleEnvelope.operation_id]
  )
  assert.equal(operations.rows[0].count, 1)
  const audit = await h.migrator.query(
    `SELECT count(*)::int AS count FROM bar_local.audit_log WHERE action = 'sale.committed'`
  )
  assert.equal(audit.rows[0].count, 1)
  const stock = await h.migrator.query(
    'SELECT quantity::text AS quantity FROM bar_local.stock_balances WHERE product_id = $1',
    [productId]
  )
  assert.equal(Number(stock.rows[0].quantity), 198)
})
