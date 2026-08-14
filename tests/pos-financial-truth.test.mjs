import test from 'node:test'
import assert from 'node:assert/strict'
import { assertPosTenderTotal, calculatePosFinancialTruth, classifyPosTransaction, hasRecordedPosTenderEnvelope, posTenderRows } from '../src/shared/posFinancialTruth.js'

function sale(index, overrides = {}) {
  return {
    id: `sale-${index}`,
    business_date: index % 2 ? '2026-08-06' : '2026-08-07',
    created_at: `2026-08-06T${String(index % 24).padStart(2, '0')}:30:00+02:00`,
    status: 'completed',
    transaction_type: 'sale',
    total: 100,
    gross_total: 110,
    discount_total: 10,
    tax_total: 12,
    tip_total: 5,
    payment_breakdown: [{ tender_id: `cash-${index}`, method: 'cash', amount: 60 }, { tender_id: `card-${index}`, method: 'card', amount: 40 }],
    pos_order_items: [{ id: `item-${index}`, item_name: 'Tonic', quantity: 2, unit_price: 55, subtotal: 110, discount_allocated: 10, tax_allocated: 12, cost_snapshot: 30 }],
    ...overrides
  }
}

test('classifies cancelled, void, return, pending and manual-review states', () => {
  assert.equal(classifyPosTransaction(sale(1)), 'sale')
  assert.equal(classifyPosTransaction(sale(2, { status: 'cancelled', total: 900 })), 'cancelled')
  assert.equal(classifyPosTransaction(sale(3, { status: 'voided', total: 900 })), 'void')
  assert.equal(classifyPosTransaction(sale(4, { transaction_type: 'return', total: -50 })), 'return')
  assert.equal(classifyPosTransaction(sale(5, { _sync_state: 'pending' })), 'pending')
  assert.equal(classifyPosTransaction(sale(6, { status: 'failed' })), 'failed/manual review')
  assert.equal(classifyPosTransaction(sale(7, { status: '' })), 'failed/manual review')
})

test('keeps split-tender identity and item cost snapshots', () => {
  const order = sale(1)
  const tenders = posTenderRows(order)
  assert.deepEqual(tenders.map((row) => [row.tender_id, row.method, row.amount]), [['cash-1', 'cash', 60], ['card-1', 'card', 40]])
  assert.equal(assertPosTenderTotal(order), true)
  const result = calculatePosFinancialTruth([order], { dataset_complete: true })
  assert.equal(result.rows[0].item_rows[0].cost, 30)
  assert.deepEqual(result.controls.tender_totals, { cash: 60, card: 40 })
})

test('excludes void/cancelled rows, nets returns, and uses sale-only average', () => {
  const result = calculatePosFinancialTruth([
    sale(1),
    sale(2, { status: 'voided', total: 999, gross_total: 999, discount_total: 99 }),
    sale(3, { status: 'cancelled', total: 999, gross_total: 999 }),
    sale(4, { transaction_type: 'return', total: -50, gross_total: -55, tax_total: -6, tip_total: -2, payment_breakdown: [{ tender_id: 'cash-return', method: 'cash', amount: -50 }] })
  ])
  assert.equal(result.controls.completed_sale_count, 1)
  assert.equal(result.controls.void_count, 1)
  assert.equal(result.controls.cancelled_count, 1)
  assert.equal(result.controls.return_count, 1)
  assert.equal(result.controls.net_recorded_sales, 50)
  assert.equal(result.controls.average_completed_sale, 100)
  assert.equal(result.controls.gross_sales, 110)
  assert.equal(result.controls.discounts, 10)
  assert.equal(result.controls.tender_totals.cash, 10)
})

test('handles more than 5,000 records without a screen cap and preserves business date', () => {
  const orders = Array.from({ length: 5001 }, (_, index) => sale(index))
  const result = calculatePosFinancialTruth(orders, { dataset_complete: true })
  assert.equal(result.rows.length, 5001)
  assert.equal(result.controls.dataset_row_count, 5001)
  assert.equal(result.controls.dataset_complete, true)
  assert.equal(result.rows[0].business_date, '2026-08-07')
  assert.equal(result.rows[0].technical_created_at, orders[0].created_at)
})

test('does not certify renderer-computed rows or accept a sign-flipped tender', () => {
  const row = sale(9, { payment_breakdown: [{ method: 'cash', amount: -100 }] })
  assert.equal(assertPosTenderTotal(row), false)
  const result = calculatePosFinancialTruth([sale(10)])
  assert.equal(result.controls.dataset_complete, false)
  assert.equal(result.controls.dataset_status, 'uncertified')
})

test('does not turn a legacy payment method and order total into a synthetic tender', () => {
  const legacy = sale(11, { payment_breakdown: null, payment_method: 'cash' })
  assert.deepEqual(posTenderRows(legacy), [])
  assert.equal(hasRecordedPosTenderEnvelope(legacy), false)
  assert.equal(assertPosTenderTotal(legacy), false)
  const result = calculatePosFinancialTruth([legacy], { dataset_complete: true })
  assert.deepEqual(result.controls.tender_totals, {})
  assert.equal(result.rows[0].tender_envelope_complete, false)
})

test('does not reconstruct missing item money from quantity and unit price', () => {
  const result = calculatePosFinancialTruth([sale(12, {
    pos_order_items: [{ item_name: 'Unpriced line', quantity: 3, unit_price: 25, subtotal: null, gross_subtotal: null, net_subtotal: null }]
  })])
  assert.equal(result.rows[0].item_rows[0].gross, null)
  assert.equal(result.rows[0].item_rows[0].net, null)
})
