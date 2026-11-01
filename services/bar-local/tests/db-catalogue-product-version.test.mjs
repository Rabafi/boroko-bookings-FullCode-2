import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

test('catalogue edits increment the product version and refuse stale writes', async (t) => {
  const h = await createHarness(t)
  const created = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'VERSION-1', name: 'Versioned product', category: 'Beer', price: '10.00', tax_rate: '0', track_stock: false
  }))
  assert.equal(created.ok, true, JSON.stringify(created.error))
  assert.equal(created.result.version, 1)

  const productId = created.result.product_id
  const edited = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    product_id: productId, expected_version: 1, sku: 'VERSION-1', name: 'Updated product',
    category: 'Beer', price: '12.50', tax_rate: '0', track_stock: false, active: true
  }))
  assert.equal(edited.ok, true, JSON.stringify(edited.error))
  assert.equal(edited.result.version, 2)

  const stale = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    product_id: productId, expected_version: 1, sku: 'VERSION-1', name: 'Stale overwrite',
    category: 'Beer', price: '1.00', tax_rate: '0', track_stock: false, active: true
  }))
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'PRODUCT_VERSION_CONFLICT')

  const current = await h.query('menu.list', { include_inactive: true })
  const row = current.data.find((product) => product.product_id === productId)
  assert.equal(row.name, 'Updated product')
  assert.equal(row.price, '12.50')
  assert.equal(row.version, 2)

  const audit = await h.migrator.query(
    `SELECT before, after FROM bar_local.audit_log WHERE action = 'catalogue.upsert' ORDER BY id`
  )
  assert.equal(audit.rows.length, 2)
  assert.equal(audit.rows[0].before, null)
  assert.equal(audit.rows[1].before.version, 1)
  assert.equal(audit.rows[1].after.version, 2)
})
