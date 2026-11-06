import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalHposStockApi } from '../../../src/renderer/src/components/hospitality-pos/bar-local/nativeStockApi.js'
import { COMMANDS } from '@tsa-bonno/bar-contracts'

const productId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const operationId = '33333333-3333-4333-8333-333333333333'

test('original Stock count sends one stable atomic batch with every loaded stock version', async () => {
  const calls = []
  const api = createLocalHposStockApi({ command: async (request) => { calls.push(request); return { outcome: 'committed_local', result: {} } } })
  const result = await api.inventory.postBarPhysicalCount({ operation_id: operationId, notes: 'Weekly count', lines: [
    { item_id: productId, actual_qty: '5.25', expected_updated_at: '8', reason_code: 'routine_count', reason: 'Counted' },
    { item_id: otherId, actual_qty: '0', expected_updated_at: '0', reason_code: 'routine_count', reason: 'Empty shelf' }
  ] })
  assert.equal(result.success, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'stock.batch.record')
  assert.equal(calls[0].operation_id, operationId)
  assert.deepEqual(calls[0].payload.lines.map((line) => [line.product_id, line.expected_stock_version]), [[productId, 8], [otherId, 0]])
  assert.doesNotThrow(() => COMMANDS['stock.batch.record'].validate(calls[0].payload))
})

test('original Stock detail edit preserves barcode and carries authoritative product version without changing on-hand', async () => {
  let request
  const api = createLocalHposStockApi({
    readHposMenu: async () => ({ complete: true, rows: [{ id: productId, barcode: '000123', product_version: 7 }] }),
    command: async (value) => { request = value; return { outcome: 'committed_local', result: {} } }
  })
  await api.inventory.getItemsWithReadStatus()
  await api.inventory.updateItem(productId, { name: 'Renamed', category: 'Drinks', unit: 'bottle', reorder_level: 2 })
  assert.equal(request.command, 'catalogue.stock_item.save')
  assert.equal(request.payload.barcode, '000123')
  assert.equal(request.payload.expected_version, 7)
  assert.equal(request.payload.unit_cost, null, 'a blank cost preserves the current authoritative cost')
  assert.equal(request.payload.opening_stock, '0')
  assert.equal(Object.hasOwn(request.payload, 'current_stock'), false)
  assert.doesNotThrow(() => COMMANDS['catalogue.stock_item.save'].validate(request.payload))
})

test('original Stock waste binds manager approval and dispatch to the same operation', async () => {
  const calls = []
  const api = createLocalHposStockApi({
    requestApprovalForCommand: async (request) => { calls.push(['approval', request]); return { approval_id: otherId } },
    command: async (request) => { calls.push(['command', request]); return { outcome: 'unknown', operation_id: operationId } }
  })
  assert.throws(() => api.inventory.adjustStock(productId, -2, 'Breakage', null, operationId), /manager/)
  const result = await api.inventory.adjustStock(productId, -2, 'Breakage', null, operationId, '5678')
  assert.equal(result.success, false)
  assert.match(result.error, /saved operation/)
  assert.equal(calls[0][1].operation_id, operationId)
  assert.equal(calls[1][1].operation_id, operationId)
  assert.equal(calls[1][1].payload.approval_id, otherId)
  assert.equal(Object.hasOwn(calls[1][1].payload, 'pin'), false)
})

test('native Stock contracts reject duplicate products, stale-count omissions and repeated opening balances', () => {
  const batch = COMMANDS['stock.batch.record']
  assert.throws(() => batch.validate({ mode: 'count', lines: [{ product_id: productId, quantity: '1', reason: 'Counted' }] }), /expected_stock_version/)
  assert.throws(() => batch.validate({ mode: 'receive', lines: [1, 2].map(() => ({ product_id: productId, quantity: '1', reason: 'Received' })) }), /repeat/)
  assert.throws(() => batch.validate({ mode: 'receive', lines: [{ product_id: productId, quantity: '-1', reason: 'Received' }] }), /negative/)
  assert.throws(() => COMMANDS['catalogue.stock_item.save'].validate({ product_id: productId, expected_version: 1,
    name: 'Stock', unit: 'bottle', opening_stock: '5' }), /opening_stock/)
})
