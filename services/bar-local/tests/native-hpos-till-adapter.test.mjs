import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalHposTillApi, estimateNativeHposTill, nativeHposReceipt } from '../../../src/renderer/src/components/hospitality-pos/bar-local/nativeTillApi.js'

const receipt = { sale_id: 'sale', receipt_number: 'B-1', lines: [{ sale_line_id: 'line', name: 'Water', line_subtotal: '10.00' }],
  tenders: [{ method: 'cash', amount: '11.40' }], total: '11.40', tax: '1.40', subtotal: '10.00', discount: '0.00', tip: '0.00' }

test('committed original sale is recovered before current price, shift or readiness reads', async () => {
  const api = createLocalHposTillApi({ getOperation: async (id) => {
    assert.equal(id, 'original');return { status: 'committed', receipt }
  }, refreshReadiness: () => assert.fail('replay must not reprice') }, {})
  const result = await api.pos.createOrder({ submit_intent_id: 'original', total: '999', items: [] })
  assert.equal(result.total, '11.40')
  assert.equal(result.tax_total, '1.40')
  assert.equal(result.items[0].item_name, 'Water')
})

test('unknown outcome retries the original journal identity without constructing a new sale', async () => {
  let calls = 0
  const api = createLocalHposTillApi({ retryOperation: async (id) => {
    calls++;assert.equal(id, 'saved');return { outcome: 'unknown' }
  } }, {})
  await assert.rejects(api.pos.createOrder({ id: 'saved', __barLocalSaleRecovery: true }), /original saved operation/)
  assert.equal(calls, 1)
})

test('an ambiguous status lookup does not submit a fresh financial mutation', async () => {
  const api = createLocalHposTillApi({ getOperation: async () => { throw Object.assign(new Error('lost reply'), { code: 'UNKNOWN_OUTCOME' }) },
    command: () => assert.fail('must not submit') }, {})
  await assert.rejects(api.pos.createOrder({ id: 'same' }), /lost reply/)
})

test('receipt projection refuses incomplete financial authority', () => {
  assert.throws(() => nativeHposReceipt({ sale_id: 'sale', total: '11.40' }), /complete sale receipt/)
  const result = nativeHposReceipt({ receipt: { ...receipt, tenders: [{ method: 'cash', amount: '11.40', change: '8.60' }] } })
  assert.equal(result.change_due, '8.60')
  assert.equal(result.total, '11.40')
})

test('counter estimates use per-product tax and modifier identity with required-choice enforcement', () => {
  const menu = [{ id: 'water', price: '10.00', tax_rate: '0.14', modifier_groups: [{ required: true, min_selections: 1, max_selections: 1,
    options: [{ option_id: 'ice', price_delta: '2.00' }] }] }]
  const line = { menu_item_id: 'water', base_unit_price: '10.00', quantity: 1, modifiers: [] }
  assert.equal(estimateNativeHposTill([line], menu).totalCents, 1140n)
  assert.throws(() => estimateNativeHposTill([line], menu, null, true), /Choose between/)
  const estimate = estimateNativeHposTill([{ ...line, modifiers: [{ id: 'ice' }] }], menu, null, true)
  assert.equal(estimate.totalCents, 1368n)
  assert.equal(estimate.taxCents, 168n)
})

test('unresolved stock operation fences sale recovery with an actionable workflow message', async () => {
  const api = createLocalHposTillApi({ getOpenIntents: async () => [{ command: 'stock.batch.record', operation_id: 'stock-id' }] }, {})
  const result = await api.pos.getPendingPosSubmitAttempt()
  assert.equal(result.success, false)
  assert.match(result.error, /stock.batch.record.*stock-id/)
})
