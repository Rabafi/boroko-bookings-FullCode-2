import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalRecipesApi } from '../../src/renderer/src/components/restaurant/barLocalRecipesApi.js'

const BUSINESS = '11111111-1111-4111-8111-111111111111'
const OUTLET = '22222222-2222-4222-8222-222222222222'
const STAFF = '33333333-3333-4333-8333-333333333333'
const MENU = '44444444-4444-4444-8444-444444444444'
const STOCK = '55555555-5555-4555-8555-555555555555'
const SCOPE = { business_id: BUSINESS, outlet_id: OUTLET, actor_staff_id: STAFF }

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

function baseBridge(overrides = {}) {
  const queries = {
    'menu.availability': { data: [{ product_id: MENU, name: 'House cocktail', price: '12.00', product_active: true }] },
    'stock.list': { data: [{ product_id: STOCK, name: 'Gin', track_stock: true, active: true, unit: 'ml', quantity: '400', unit_cost: '0.10' }] },
    'menu.modifiers': { data: { products: [{ product_id: MENU, recipe_version: 1, recipe_lines: [{ ingredient_product_id: STOCK, name: 'Gin', quantity: '30.000000', unit_cost: '0.10' }] }] } }
  }
  return {
    queries,
    query: async (name) => ({ complete: true, data: queries[name].data, scope: SCOPE, snapshot_watermark: 9, pagination: { has_more: false, next_cursor: null }, ...overrides[name] }),
    getOpenIntents: async () => [],
    command: async () => ({ outcome: 'committed_local' }),
    retryOperation: async () => ({ outcome: 'committed_local' })
  }
}

test('recipe load accepts only coherent complete scoped local menu, stock, and recipe snapshots', async () => {
  const api = createBarLocalRecipesApi(baseBridge(), { businessId: BUSINESS, outletId: OUTLET, staffId: STAFF })
  const result = await api.load()
  assert.equal(result.watermark, 9)
  assert.deepEqual(result.menuItems.map((row) => row.id), [MENU])
  assert.deepEqual(result.inventoryItems.map((row) => [row.id, row.unit, row.latest_unit_cost]), [[STOCK, 'ml', '0.10']])
  assert.deepEqual(result.recipes[0].ingredients.map((row) => [row.inventory_item_id, row.quantity, row.unit_cost]), [[STOCK, '30.000000', '0.10']])
})

test('recipe load refuses a wrong operator scope, mixed watermark, and malformed partial rows', async () => {
  const wrongActor = baseBridge()
  wrongActor.query = async (name) => ({ ...await baseBridge().query(name), scope: { ...SCOPE, actor_staff_id: '66666666-6666-4666-8666-666666666666' } })
  await assert.rejects(createBarLocalRecipesApi(wrongActor, { businessId: BUSINESS, outletId: OUTLET, staffId: STAFF }).load(), /incomplete or belong to another Bar session/)
  const changed = baseBridge()
  changed.query = async (name) => ({ ...await baseBridge().query(name), snapshot_watermark: name === 'stock.list' ? 10 : 9 })
  await assert.rejects(createBarLocalRecipesApi(changed, { businessId: BUSINESS, outletId: OUTLET, staffId: STAFF }).load(), /snapshots do not match/)
  const malformed = baseBridge()
  malformed.queries['stock.list'].data.push(null)
  await assert.rejects(createBarLocalRecipesApi(malformed, { businessId: BUSINESS, outletId: OUTLET, staffId: STAFF }).load(), /invalid row/)
})

test('unknown recipe result keeps its exact stable operation for retry and rejects changed payloads', async () => {
  const bridge = baseBridge()
  const saved = []
  bridge.getOpenIntents = async () => saved
  bridge.command = async (request) => { saved.push({ operation_id: request.operation_id }); throw new Error('connection lost after dispatch') }
  const store = storage()
  const api = createBarLocalRecipesApi(bridge, { businessId: BUSINESS, outletId: OUTLET, staffId: STAFF })
  const payload = { product_id: MENU, expected_version: 1, lines: [{ ingredient_product_id: STOCK, quantity: '30', unit_cost: '0.10' }] }
  await assert.rejects(api.save(store, payload), /result is uncertain/)
  const pending = api.pendingAll(store)
  assert.equal(pending.length, 1)
  await assert.rejects(api.save(store, { ...payload, lines: [{ ...payload.lines[0], quantity: '31' }] }), /different recipe operation is unresolved/)
  let retriedId = ''
  bridge.retryOperation = async (id) => { retriedId = id; return { outcome: 'committed_local' } }
  await api.retry(store, MENU)
  assert.equal(retriedId, pending[0].operationId)
  assert.equal(api.pendingAll(store).length, 0)
})

test('recipe save blocks unrelated open operations and validates exact expected versions and costs', async () => {
  const bridge = baseBridge()
  bridge.getOpenIntents = async () => [{ operation_id: 'unrelated' }]
  const api = createBarLocalRecipesApi(bridge, { businessId: BUSINESS, outletId: OUTLET, staffId: STAFF })
  const store = storage()
  const payload = { product_id: MENU, expected_version: 0, lines: [{ ingredient_product_id: STOCK, quantity: '1', unit_cost: '1.00' }] }
  await assert.rejects(api.save(store, payload), /Resolve the existing local operation/)
  assert.equal(store.length, 0)
  bridge.getOpenIntents = async () => []
  await assert.rejects(api.save(store, { ...payload, expected_version: -1 }), /validated product version/)
  await assert.rejects(api.save(store, { ...payload, lines: [{ ...payload.lines[0], unit_cost: '-1' }] }), /valid local stock product/)
})
