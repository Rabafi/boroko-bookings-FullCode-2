import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

async function createProduct(h, sku, name) {
  const env = h.envelope('catalogue.upsert', {
    sku,
    name,
    category: 'Beer',
    price: '10.00',
    tax_rate: '0',
    track_stock: false
  })
  const result = await h.call('cmd_catalogue_upsert', env)
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.result
}

function saleEnvelope(h, shiftId, productId) {
  return h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '1' }],
    tenders: [{ method: 'cash', amount: '10.00', tendered: '10.00' }]
  })
}

test('outlet menu availability gates sales and preserves optimistic versions', async (t) => {
  const h = await createHarness(t)
  const product = await createProduct(h, 'AVAIL-1', 'Availability Beer')
  const shiftId = await h.openShift()

  const initial = await h.query('menu.availability', {})
  const initialRow = initial.data.find((row) => row.product_id === product.product_id)
  assert.equal(initialRow.available, true)
  assert.equal(initialRow.override_available, null)
  assert.equal(initialRow.availability_version, 0)
  assert.equal(initialRow.product_active, true)

  const soldOutEnvelope = h.envelope('catalogue.availability.set', {
    product_id: product.product_id,
    available: false
  })
  const soldOut = await h.call('cmd_catalogue_availability_set', soldOutEnvelope)
  assert.equal(soldOut.ok, true, JSON.stringify(soldOut.error))
  assert.equal(soldOut.result.available, false)
  assert.equal(soldOut.result.version, 1)
  assert.equal(soldOut.result.outlet_id, h.outletId)

  const replay = await h.call('cmd_catalogue_availability_set', soldOutEnvelope)
  assert.equal(replay.ok, true)
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.version, 1)

  const availableOnly = await h.query('menu.availability', { available_only: true })
  assert.equal(availableOnly.data.some((row) => row.product_id === product.product_id), false)

  const all = await h.query('menu.availability', {})
  const hidden = all.data.find((row) => row.product_id === product.product_id)
  assert.equal(hidden.available, false)
  assert.equal(hidden.override_available, false)
  assert.equal(hidden.availability_version, 1)

  const refusedSale = await h.call('cmd_sale_commit', saleEnvelope(h, shiftId, product.product_id))
  assert.equal(refusedSale.ok, false)
  assert.equal(refusedSale.error.code, 'PRODUCT_UNAVAILABLE')

  const stale = await h.call('cmd_catalogue_availability_set', h.envelope('catalogue.availability.set', {
    product_id: product.product_id,
    available: true,
    expected_version: 99
  }))
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'PRODUCT_AVAILABILITY_VERSION_CONFLICT')

  const reopened = await h.call('cmd_catalogue_availability_set', h.envelope('catalogue.availability.set', {
    product_id: product.product_id,
    available: true,
    expected_version: 1
  }))
  assert.equal(reopened.ok, true, JSON.stringify(reopened.error))
  assert.equal(reopened.result.version, 2)

  const sale = await h.call('cmd_sale_commit', saleEnvelope(h, shiftId, product.product_id))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  assert.equal(sale.result.receipt.total, 10)

  const missing = await h.call('cmd_catalogue_availability_set', h.envelope('catalogue.availability.set', {
    product_id: '00000000-0000-4000-8000-000000000000',
    available: false
  }))
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'PRODUCT_NOT_FOUND')

  const audit = await h.migrator.query(
    `SELECT action, before, after FROM bar_local.audit_log
      WHERE action = 'catalogue.availability.updated' ORDER BY id`
  )
  assert.equal(audit.rows.length, 2)
  assert.equal(audit.rows[0].before, null)
  assert.equal(audit.rows[0].after.available, false)
  assert.equal(audit.rows[1].before.available, false)
  assert.equal(audit.rows[1].after.available, true)
})
