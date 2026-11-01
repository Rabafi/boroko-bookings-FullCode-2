import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

test('concurrent sales preserve stock truth and operation idempotency', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()

  const productEnvelope = h.envelope('catalogue.upsert', {
    sku: 'LAST-1', name: 'Last Unit', category: 'Test', price: '10.00', tax_rate: '0', track_stock: true
  })
  const product = await h.call('cmd_catalogue_upsert', productEnvelope)
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const productId = product.result.product_id

  const received = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
    product_id: productId, quantity: '1', unit_cost: '5.00'
  }))
  assert.equal(received.ok, true, JSON.stringify(received.error))

  const firstClient = await h.newRuntimeClient()
  const secondClient = await h.newRuntimeClient()
  const salePayload = {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '1' }],
    discount_amount: '0',
    tip_amount: '0',
    tenders: [{ method: 'cash', amount: '10.00', tendered: '10.00' }]
  }
  const firstEnvelope = h.envelope('sale.commit', salePayload)
  const secondEnvelope = h.envelope('sale.commit', salePayload)

  const [first, second] = await Promise.all([
    h.callWith(firstClient, 'cmd_sale_commit', firstEnvelope),
    h.callWith(secondClient, 'cmd_sale_commit', secondEnvelope)
  ])
  const outcomes = [first, second]
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1, JSON.stringify(outcomes))
  assert.equal(outcomes.filter((outcome) => !outcome.ok && outcome.error?.code === 'INSUFFICIENT_STOCK').length, 1, JSON.stringify(outcomes))

  const stockAfterRace = await h.migrator.query(
    'SELECT quantity::text AS quantity FROM bar_local.stock_balances WHERE product_id = $1',
    [productId]
  )
  assert.equal(Number(stockAfterRace.rows[0].quantity), 0)
  const salesAfterRace = await h.migrator.query(
    'SELECT count(*)::int AS count FROM bar_local.sale_lines WHERE product_id = $1',
    [productId]
  )
  assert.equal(salesAfterRace.rows[0].count, 1)

  const restocked = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
    product_id: productId, quantity: '10', unit_cost: '5.00'
  }))
  assert.equal(restocked.ok, true, JSON.stringify(restocked.error))

  const duplicateEnvelope = h.envelope('sale.commit', {
    ...salePayload,
    tenders: [{ method: 'cash', amount: '10.00', tendered: '10.00' }]
  })
  const [duplicateFirst, duplicateSecond] = await Promise.all([
    h.callWith(firstClient, 'cmd_sale_commit', duplicateEnvelope),
    h.callWith(secondClient, 'cmd_sale_commit', duplicateEnvelope)
  ])
  for (const result of [duplicateFirst, duplicateSecond]) {
    const accepted = result.ok === true || result.error?.code === 'OPERATION_EXECUTING'
    assert.equal(accepted, true, JSON.stringify(result))
  }
  const replay = await h.callWith(secondClient, 'cmd_sale_commit', duplicateEnvelope)
  assert.equal(replay.ok, true, JSON.stringify(replay.error))
  assert.equal(replay.replayed, true)
  assert.equal(replay.receipt.operation_id, duplicateEnvelope.operation_id)
  const committedReceipt = [duplicateFirst, duplicateSecond].find((result) => result.ok === true)?.receipt
  assert.equal(sha256Json(replay.receipt), sha256Json(committedReceipt))
  assert.equal(sha256Json(replay.result), sha256Json([duplicateFirst, duplicateSecond].find((result) => result.ok === true)?.result))

  const stockAfterDuplicate = await h.migrator.query(
    'SELECT quantity::text AS quantity FROM bar_local.stock_balances WHERE product_id = $1',
    [productId]
  )
  assert.equal(Number(stockAfterDuplicate.rows[0].quantity), 9)
  const salesAfterDuplicate = await h.migrator.query(
    'SELECT count(*)::int AS count FROM bar_local.sale_lines WHERE product_id = $1',
    [productId]
  )
  assert.equal(salesAfterDuplicate.rows[0].count, 2)
  const committed = await h.migrator.query(
    "SELECT count(*)::int AS count FROM bar_local.operations WHERE command = 'sale.commit' AND status = 'committed'"
  )
  assert.equal(committed.rows[0].count, 2)
})
