import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalPurchasingApi } from '../../src/renderer/src/components/restaurant/barLocalPurchasingApi.js'

const BUSINESS = '11111111-1111-4111-8111-111111111111'
const OUTLET = '22222222-2222-4222-8222-222222222222'
const STAFF = '33333333-3333-4333-8333-333333333333'
const SUPPLIER = '44444444-4444-4444-8444-444444444444'
const PRODUCT = '55555555-5555-4555-8555-555555555555'
const ORDER_LINE = '66666666-6666-4666-8666-666666666666'

function storage() {
  const values = new Map()
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) }
  }
}

function bridge() {
  const calls = []
  return {
    calls,
    getOpenIntents: async () => [],
    requestApprovalForCommand: async (request) => { calls.push(['approve', request]); return { approval_id: '77777777-7777-4777-8777-777777777777' } },
    command: async (request) => { calls.push(['command', request]); return { outcome: 'committed_local', result: { status: 'received' } } },
    retryOperation: async (id) => { calls.push(['retry', id]); return { outcome: 'committed_local' } }
  }
}

const scope = { businessId: BUSINESS, outletId: OUTLET, staffId: STAFF }

test('supplier writes use the local command with expected version for edits', async () => {
  const apiBridge = bridge()
  const api = createBarLocalPurchasingApi(apiBridge, scope)
  await api.saveSupplier(storage(), { name: 'Local supplier', contact_person: 'Buyer', phone: '123', email: '', address: 'Town' })
  const first = apiBridge.calls.find(([kind]) => kind === 'command')[1]
  assert.equal(first.command, 'supplier.upsert')
  assert.equal(first.payload.name, 'Local supplier')
  assert.equal(first.payload.contact_name, 'Buyer')
  assert.equal(first.payload.address, 'Town')
  apiBridge.calls.length = 0
  await api.saveSupplier(storage(), { id: SUPPLIER, version: 4, name: 'Local supplier Ltd' })
  const edit = apiBridge.calls.find(([kind]) => kind === 'command')[1]
  assert.deepEqual([edit.payload.supplier_id, edit.payload.expected_version], [SUPPLIER, 4])
})

test('purchase order creation asks manager approval for the exact command and retains its stable approved payload after uncertainty', async () => {
  const apiBridge = bridge()
  apiBridge.command = async (request) => { apiBridge.calls.push(['command', request]); throw new Error('lost after dispatch') }
  const store = storage()
  const api = createBarLocalPurchasingApi(apiBridge, scope)
  await assert.rejects(api.createPurchaseOrder(store, {
    supplier_id: SUPPLIER, supplier_version: 3, expected_delivery: '2026-12-01', notes: 'weekly',
    items: [{ inventory_item_id: PRODUCT, quantity: '10', unit_cost: '4.25' }]
  }, '1234'), /result is uncertain/)
  const approval = apiBridge.calls.find(([kind]) => kind === 'approve')[1]
  const command = apiBridge.calls.find(([kind]) => kind === 'command')[1]
  assert.equal(approval.command, 'purchase_order.create')
  assert.equal(approval.operation_id, command.operation_id)
  assert.equal(command.payload.approval_id, '77777777-7777-4777-8777-777777777777')
  assert.equal(command.payload.lines[0].product_id, PRODUCT)
  const pending = api.pending(store)
  assert.equal(pending.operation_id, command.operation_id)
  assert.equal(pending.payload.approval_id, command.payload.approval_id)
  apiBridge.getOpenIntents = async () => [{ operation_id: command.operation_id }]
  await api.retry(store)
  assert.deepEqual(apiBridge.calls.at(-1), ['retry', command.operation_id])
  assert.equal(api.pending(store), null)
})

test('partial receipt sends exact ordered-line identity and leaves amount validation to atomic authority', async () => {
  const api = createBarLocalPurchasingApi(bridge(), scope)
  const result = await api.receivePurchaseOrder(storage(), { id: PRODUCT, version: 2 }, {
    supplier_reference: 'INV-3', lines: [{ id: ORDER_LINE, quantity: '3.5', lot_code: 'BATCH-A', expires_on: '2027-04-01' }]
  })
  assert.equal(result.outcome, 'committed_local')
})

test('purchasing blocks unrelated open operations and incomplete supplier versions', async () => {
  const apiBridge = bridge()
  const api = createBarLocalPurchasingApi(apiBridge, scope)
  apiBridge.getOpenIntents = async () => [{ operation_id: 'unrelated' }]
  await assert.rejects(api.saveSupplier(storage(), { name: 'Vendor' }), /Resolve the existing local operation/)
  assert.equal(apiBridge.calls.filter(([kind]) => kind === 'command').length, 0)
  apiBridge.getOpenIntents = async () => []
  assert.throws(() => api.createPurchaseOrder(storage(), {
    supplier_id: SUPPLIER, supplier_version: 0, items: [{ inventory_item_id: PRODUCT, quantity: '1', unit_cost: '2' }]
  }, '1234'), /active supplier/)
})
