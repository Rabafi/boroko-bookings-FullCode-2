import test from 'node:test'
import assert from 'node:assert/strict'
import { readNativeHposMenu, retryNativeHposBarProduct, saveNativeHposBarProduct } from '../../../src/main/bar-local/nativeHposMenu.js'

test('original Hpos product save uses one local command and preserves the wizard operation key', async () => {
  const calls = []
  const runtime = {
    command: async (request) => { calls.push(request); return { outcome: 'committed_local', result: { menu_item_id: 'menu-id', inventory_item_id: 'stock-id' } } },
    retryOperation: async () => { throw new Error('unexpected retry') }
  }
  const result = await saveNativeHposBarProduct(runtime, {
    operation_key: 'f2d766e4-bd7d-4c36-82e6-e8790254aef3',
    name: 'Bottled Water', category: 'Drinks', price: 12, stock_mode: 'create',
    stock_name: 'Bottled Water', stock_category: 'Drinks', stock_unit: 'bottle',
    track_stock: true, pack6: true, pack6Barcode: 'PACK-6'
  })
  assert.equal(result.success, true)
  assert.equal(result.id, 'menu-id')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'catalogue.bar_product.save')
  assert.equal(calls[0].operation_id, 'f2d766e4-bd7d-4c36-82e6-e8790254aef3')
  assert.equal(calls[0].payload.operation_key, undefined)
  assert.equal(calls[0].payload.pack6, true)
})

test('native Hpos product outcome uncertainty stays explicitly retryable on the same ID', async () => {
  const runtime = {
    command: async () => ({ outcome: 'unknown', operation_id: 'f2d766e4-bd7d-4c36-82e6-e8790254aef3', error: { message: 'The local outcome is unknown.' } }),
    retryOperation: async (id) => ({ outcome: 'committed_local', result: { menu_item_id: id } })
  }
  const id = 'f2d766e4-bd7d-4c36-82e6-e8790254aef3'
  const first = await saveNativeHposBarProduct(runtime, { operation_key: id, name: 'Water' })
  assert.equal(first.success, false)
  assert.equal(first.outcome, 'unknown')
  assert.equal(first.operation_key, id)
  const retried = await retryNativeHposBarProduct(runtime, id)
  assert.equal(retried.success, true)
  assert.equal(retried.id, id)
})

test('native Hpos read adapter rejects incomplete local menu snapshots', async () => {
  const runtime = { query: async () => ({ complete: false, data: [], unavailable: [] }) }
  await assert.rejects(readNativeHposMenu(runtime, 'menu'), /incomplete/)
})

test('native Hpos menu read maps the versioned local product and stock identity', async () => {
  const runtime = { query: async (name) => ({
    complete: true, unavailable: [], pagination: { has_more: false }, snapshot_watermark: 9,
    scope: { business_id: 'business', outlet_id: 'outlet' },
    data: name === 'menu.availability' ? [{ product_id: 'product-id', sku: 'BAR-1', name: 'Water', category: 'Drinks',
      price: '12.00', tax_rate: '0.14', barcode: '123', track_stock: false, product_active: true, product_version: 4,
      inventory_item_id: 'stock-id', depletion_qty: '1', stock_version: 2, available: true }] : []
  }) }
  const result = await readNativeHposMenu(runtime, 'menu')
  assert.equal(result.complete, true)
  assert.equal(result.rows[0].id, 'product-id')
  assert.equal(result.rows[0].inventory_item_id, 'stock-id')
  assert.equal(result.rows[0].product_version, 4)
  assert.equal(result.rows[0].barcode, '123')
  assert.equal(result.rows[0].tax_rate, '0.14')
  assert.equal(result.rows[0].track_stock, false, 'the product field remains distinct from its linked inventory identity')
})

test('native Hpos menu keeps a non-stock sellable item out of stock-link workflows', async () => {
  const runtime = { query: async () => ({
    complete: true, unavailable: [], pagination: { has_more: false }, snapshot_watermark: 9,
    scope: { business_id: 'business', outlet_id: 'outlet' },
    data: [{ product_id: 'product-id', sku: 'BAR-2', name: 'Service charge', category: 'Other', price: '3.00',
      track_stock: false, product_active: true, product_version: 1, available: true, inventory_item_id: null }]
  }) }
  const result = await readNativeHposMenu(runtime, 'menu')
  assert.equal(result.rows[0].inventory_item_id, null)
  assert.equal(result.rows[0].track_stock, false)
})

test('native Hpos modifier read returns editable local config and protects direct stock-link recipes', async () => {
  const runtime = { query: async (name) => ({
    complete: true, unavailable: [], pagination: { has_more: false }, snapshot_watermark: 12,
    scope: { business_id: 'business', outlet_id: 'outlet' },
    data: name === 'menu.modifiers'
      ? { groups: [{ modifier_group_id: 'group-id', name: 'Size', options: [] }],
        products: [
          { product_id: 'product-id', sku: 'BAR-1', name: 'Water', recipe_lines: [{ ingredient_product_id: 'stock-id', quantity: '1' }] },
          { product_id: 'pack-id', sku: 'BAR-1-PACK6', name: 'Water 6-pack', recipe_lines: [{ ingredient_product_id: 'stock-id', quantity: '6' }] },
          { product_id: 'meal-id', sku: 'BAR-2', name: 'Prepared meal', recipe_lines: [{ ingredient_product_id: 'stock-id', quantity: '0.2' }] }
        ],
        promotions: [] }
      : [
        { product_id: 'product-id', sku: 'BAR-1', inventory_item_id: 'stock-id' },
        { product_id: 'pack-id', sku: 'BAR-1-PACK6', inventory_item_id: 'stock-id' },
        { product_id: 'meal-id', sku: 'BAR-2', inventory_item_id: null }
      ]
  }) }
  const result = await readNativeHposMenu(runtime, 'modifiers')
  assert.equal(result.complete, true)
  assert.equal(result.groups[0].id, 'group-id')
  assert.equal(result.config.products[0].stock_linked, true)
  assert.equal(result.config.products[1].stock_linked, true, 'generated pack depletion also retains its shared stock identity')
  assert.deepEqual(result.config.promotions, [])
  assert.deepEqual(result.recipes.map((recipe) => recipe.menu_item_id), ['meal-id'], 'generated stock-link depletion recipes are not classified as authored recipes')
})

test('native Hpos recipe edit preserves the current tax, stock tracking and archive state', async () => {
  const calls = []
  const runtime = {
    command: async (request) => { calls.push(request); return { outcome: 'committed_local', result: { product_id: request.payload.product_id } } },
    retryOperation: async () => { throw new Error('unexpected retry') }
  }
  const saved = await saveNativeHposBarProduct(runtime, {
    operation_key: 'bcb9b4e0-63d9-42a5-b2e8-5acfb237274f', local_recipe_update: true,
    menu_item_id: 'product-id', expected_menu_version: 3, sku: 'BAR-TAXED', name: 'Taxed item',
    category: 'Drinks', price: '10.00', tax_rate: '0.14', track_stock: true, active: false
  })
  assert.equal(saved.success, true)
  assert.deepEqual(calls[0].payload, {
    product_id: 'product-id', expected_version: 3, sku: 'BAR-TAXED', name: 'Taxed item',
    category: 'Drinks', price: '10.00', tax_rate: '0.14', track_stock: true, active: false
  })
})

test('shared Hpos wizard stock-only mode creates only counted stock under its original operation', async () => {
  let command
  const result = await saveNativeHposBarProduct({ command: async (request) => {
    command = request
    return { outcome: 'committed_local', result: { product_id: 'stock-id', inventory_item_id: 'stock-id' } }
  } }, { operation_key: 'bcb9b4e0-63d9-42a5-b2e8-5acfb237274f', local_stock_only: true,
    name: 'Ingredient', unit: 'kg', opening_stock: '5' })
  assert.equal(result.success, true)
  assert.equal(result.id, 'stock-id')
  assert.equal(command.command, 'catalogue.stock_item.save')
  assert.equal(command.operation_id, 'bcb9b4e0-63d9-42a5-b2e8-5acfb237274f')
  assert.equal(Object.hasOwn(command.payload, 'local_stock_only'), false)
  assert.equal(Object.hasOwn(command.payload, 'menu_item_id'), false)
})
