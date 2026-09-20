import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { rewritePendingProductReferences, resolveCurrentOpenShiftId } from '../src/main/domains/syncShared.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
const pos = () => read('src/main/domains/pos.js')
const sync = () => read('src/main/domains/infrastructure.js')

test('offline product save queues a catalog snapshot behind the product', () => {
  const source = pos()
  assert.match(source, /queueLocalPosCatalogSnapshot\(entry\.payload\?\.stock\?\.outlet_id \|\| null, `bar-product-stock-\$\{entry\.operation_key\}`\)/)
})

test('offline sales depend on their provisional products before replay', () => {
  const source = pos()
  assert.match(source, /provisionalProductDeps/)
  assert.match(source, /menuId\.slice\('pending:'\.length\)/)
  assert.match(source, /pos-menu-item-\$\{menuId\}/)
})

test('Till sells provisional products offline and blocks them once back online', () => {
  const source = terminal()
  assert.match(source, /isProvisionalMenuItem/)
  assert.match(source, /provisionalBlock/)
  assert.match(source, /is still syncing\. Sell it after the sync lands\./)
  assert.match(source, /Pending sync — sells offline now/)
  assert.match(source, /Syncing — sells after sync/)
  // Provisional rows stay in the Till catalogue (no pending: exclusion).
  assert.doesNotMatch(source, /startsWith\("pending:"\)\)/)
})

test('replay rewrites provisional identities to real server ids', () => {
  const pending = [
    { _queue_id: 'pos-order-a', data: { payload: { submit_intent_id: 'a', items: [{ menu_item_id: 'pending:op-1', quantity: 80 }] } } },
    { _queue_id: 'pos-order-b', data: { payload: { submit_intent_id: 'b', items: [{ menu_item_id: 'real-id', quantity: 1 }] } } },
    { _queue_id: 'other', data: {} },
  ]
  assert.equal(rewritePendingProductReferences(pending, 'op-1', 'menu-real-1', 'stock-real-1'), 1)
  assert.equal(pending[0].data.payload.items[0].menu_item_id, 'menu-real-1')
  assert.equal(pending[1].data.payload.items[0].menu_item_id, 'real-id')
  assert.equal(rewritePendingProductReferences(pending, 'op-1', 'menu-real-1'), 0)
  assert.equal(rewritePendingProductReferences(null, 'op-1', 'x'), 0)
  assert.equal(rewritePendingProductReferences(pending, '', 'x'), 0)
})

test('replay success resolves duplicate-name products by exact name', () => {
  const source = sync()
  assert.match(source, /rewritePendingProductReferences\(pending, productKey, realMenuId, realInventoryId\)/)
  assert.match(source, /ilike\('name', wanted\)/)
})

test('stale shifts resolve identically on both retry paths', () => {
  const open = { id: 'shift-new', status: 'open', closed_at: null, outlet_id: 'out-1', cashier_id: 'op-1', opened_at: '2026-09-13T14:00:00.000Z' }
  const closed = { id: 'shift-old', status: 'closed', closed_at: '2026-09-13T13:00:00.000Z', outlet_id: 'out-1', cashier_id: 'op-1', opened_at: '2026-09-13T08:00:00.000Z' }
  assert.equal(resolveCurrentOpenShiftId([closed, open], { outletId: 'out-1', cashierId: 'op-1' }), 'shift-new')
  assert.equal(resolveCurrentOpenShiftId([closed], { outletId: 'out-1', cashierId: 'op-1' }), null)
  assert.equal(resolveCurrentOpenShiftId([], {}), null)
  // Wrong outlet never matches.
  assert.equal(resolveCurrentOpenShiftId([open], { outletId: 'out-2', cashierId: 'op-1' }), null)
  const source = pos()
  assert.match(source, /resolveCurrentOpenShiftId\(readCache\('pos-shifts'\)/)
  assert.match(source, /retry_shift_rewritten/)
})

test('Products names pending saves that the Till will sell offline', () => {
  const menu = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
  assert.match(menu, /Pending sync — sells offline now/)
})
