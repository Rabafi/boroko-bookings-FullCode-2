import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateBarCashDueCents, formatBarLocalMoney, validateBarPromotionSnapshot } from '../../src/shared/barLocalCashEstimate.js'

test('cash estimate applies the shared per-line PostgreSQL tax rounding rule', () => {
  const lines = [
    { product: { price: '10.00', tax_rate: '0.14' }, quantity: 1 },
    { product: { price: '0.05', tax_rate: '0.10' }, quantity: 1 }
  ]
  const cents = estimateBarCashDueCents(lines)
  assert.equal(cents, 1146n)
  assert.equal(formatBarLocalMoney(cents), '11.46')
})

test('cash estimate refuses fractional quantity and excess non-zero financial precision', () => {
  assert.throws(() => estimateBarCashDueCents([
    { product: { price: '1.00', tax_rate: '0.00' }, quantity: 0.5 }
  ]), /positive whole number/)
  assert.throws(() => estimateBarCashDueCents([
    { product: { price: '1.001', tax_rate: '0.00' }, quantity: 1 }
  ]), /more precision/)
})

test('cash estimate includes selected modifier prices and refuses incomplete modifier groups', () => {
  const product = {
    price: '10.00',
    tax_rate: '0.14',
    modifier_groups: [{
      modifier_group_id: 'group-1',
      name: 'Size',
      required: true,
      min_selections: 1,
      max_selections: 1,
      options: [
        { option_id: 'small', price_delta: '0.00' },
        { option_id: 'large', price_delta: '2.50' }
      ]
    }]
  }
  assert.equal(estimateBarCashDueCents([{ product, quantity: 1, modifiers: ['large'] }]), 1425n)
  assert.throws(() => estimateBarCashDueCents([{ product, quantity: 1, modifiers: [] }]), /Choose between 1 and 1/)
})

test('promotion cash estimate uses scoped eligible subtotal and service-compatible rounding', () => {
  const lines = [
    { product: { product_id: 'eligible', category: 'Beer', price: '10.00', tax_rate: '0.14' }, quantity: 1 },
    { product: { product_id: 'other', category: 'Food', price: '5.00', tax_rate: '0.14' }, quantity: 1 }
  ]
  assert.equal(estimateBarCashDueCents(lines, {
    code: 'HAPPYHOUR', discount_type: 'percent', percent: '10.0000', amount: '0.00',
    minimum_subtotal: '10.00', scope: 'product', product_id: 'eligible'
  }), 1610n)
  assert.equal(estimateBarCashDueCents(lines, {
    code: 'FIXED', discount_type: 'amount', amount: '20.00', minimum_subtotal: '0.00', scope: 'all'
  }), 210n)
  assert.throws(() => estimateBarCashDueCents(lines, {
    code: 'CATEGORY', discount_type: 'amount', amount: '1.00', minimum_subtotal: '0.00', scope: 'category', category: 'Spirits'
  }), /does not apply/)
  assert.throws(() => estimateBarCashDueCents(lines, {
    code: 'MINIMUM', discount_type: 'percent', percent: '10', minimum_subtotal: '11.00', scope: 'product', product_id: 'eligible'
  }), /minimum/)
})

test('cashier promotion snapshot validates business/outlet scope, exact values and discount policy', () => {
  const snapshot = {
    complete: true, unavailable: [], scope: { business_id: 'business-1', outlet_id: 'outlet-1' },
    data: {
      promotions: [{ promotion_id: '12345678-1234-4234-9234-123456789012', code: 'HAPPYHOUR', discount_type: 'percent', percent: '10.0000', amount: '0.00', minimum_subtotal: '5.00', scope: 'all' }],
      discount_policy: { approval_threshold_percent: '10', maximum_percent: '25' }
    }
  }
  assert.equal(validateBarPromotionSnapshot(snapshot, 'business-1', 'outlet-1').promotions.length, 1)
  assert.throws(() => validateBarPromotionSnapshot(snapshot, 'foreign-business', 'outlet-1'), /scope/)
  assert.throws(() => validateBarPromotionSnapshot({ ...snapshot, data: { ...snapshot.data, discount_policy: { maximum_percent: '25' } } }, 'business-1', 'outlet-1'), /malformed/)
})
