import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CAPABILITIES, COMMANDS, QUERIES } from '@tsa-bonno/bar-contracts'

test('menu availability contracts require catalogue management and POS view', () => {
  assert.equal(COMMANDS['catalogue.availability.set'].version, 1)
  assert.equal(COMMANDS['catalogue.availability.set'].capability, CAPABILITIES.MENU_MANAGE)
  assert.equal(COMMANDS['catalogue.availability.set'].approval, null)
  assert.equal(QUERIES['menu.availability'].version, 1)
  assert.equal(QUERIES['menu.availability'].capability, CAPABILITIES.POS_VIEW)

  const productId = randomUUID()
  const parsed = COMMANDS['catalogue.availability.set'].validate({
    product_id: productId,
    available: false,
    expected_version: 2
  })
  assert.deepEqual(parsed, { product_id: productId, available: false, expected_version: 2 })

  assert.throws(() => COMMANDS['catalogue.availability.set'].validate({
    product_id: productId,
    available: 'yes'
  }), /available/)

  assert.throws(() => COMMANDS['catalogue.availability.set'].validate({
    product_id: productId,
    available: true,
    expected_version: 0
  }), /expected_version/)

  assert.doesNotThrow(() => QUERIES['menu.availability'].validate({
    outlet_id: randomUUID(),
    available_only: true,
    limit: 50
  }))
})

test('modifier configuration query requires menu management and accepts no caller scope override', () => {
  assert.equal(QUERIES['menu.modifiers'].capability, CAPABILITIES.MENU_MANAGE)
  assert.deepEqual(QUERIES['menu.modifiers'].validate({}), {})
  assert.throws(() => QUERIES['menu.modifiers'].validate({ business_id: 'forged' }), /business_id/)
  assert.throws(() => QUERIES['menu.modifiers'].validate({ outlet_id: 'forged' }), /outlet_id/)
})

test('cashier promotion query is POS-view scoped and rejects caller-supplied filters', () => {
  assert.equal(QUERIES['menu.promotions'].version, 1)
  assert.equal(QUERIES['menu.promotions'].capability, CAPABILITIES.POS_VIEW)
  assert.deepEqual(QUERIES['menu.promotions'].validate({}), {})
  assert.throws(() => QUERIES['menu.promotions'].validate({ business_id: 'forged' }), /business_id/)
  assert.throws(() => QUERIES['menu.promotions'].validate({ outlet_id: 'forged' }), /outlet_id/)
})

test('catalogue edits require an optimistic product version', () => {
  assert.equal(COMMANDS['catalogue.upsert'].capability, CAPABILITIES.MENU_MANAGE)
  const productId = randomUUID()
  const base = { product_id: productId, sku: 'EDIT-1', name: 'Edited item', category: 'Beer', price: '12.50', tax_rate: '0', track_stock: false }
  assert.throws(() => COMMANDS['catalogue.upsert'].validate(base), /expected_version/)
  assert.throws(() => COMMANDS['catalogue.upsert'].validate({ ...base, expected_version: 0 }), /expected_version/)
  assert.throws(() => COMMANDS['catalogue.upsert'].validate({ ...base, product_id: undefined, expected_version: 3 }), /expected_version/)
  assert.deepEqual(COMMANDS['catalogue.upsert'].validate({ ...base, expected_version: 3 }), {
    ...base, expected_version: 3, active: true
  })
})
