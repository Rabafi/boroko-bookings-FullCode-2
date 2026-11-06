// Follow-up to the original independent reproduction. Preserve that historical
// script; execute its same synthetic fixtures with corrected expectations.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readNativeHposMenu, saveNativeHposBarProduct } from '../../../../../src/main/bar-local/nativeHposMenu.js'

const menu = { product_id: 'menu-1', sku: 'BAR-1', name: 'Water', inventory_item_id: 'stock-1',
  product_active: true, available: true, track_stock: false, price: '12.00', tax_rate: '0.14', depletion_qty: '1' }
const runtime = { query: async name => ({
  complete: true, unavailable: [], snapshot_watermark: 9,
  scope: { business_id: 'business-1', outlet_id: 'outlet-1' }, pagination: { has_more: false },
  data: name === 'menu.modifiers'
    ? { groups: [], promotions: [], products: [{ product_id: menu.product_id, recipe_lines: [{ ingredient_product_id: 'stock-1', quantity: '1' }] }] }
    : [menu]
}) }
const products = await readNativeHposMenu(runtime, 'menu')
const modifiers = await readNativeHposMenu(runtime, 'modifiers')
const recipeIds = new Set(modifiers.recipes.filter(recipe => recipe.menu_item_id && recipe.ingredients.some(line => Number(line.quantity || 0) > 0)).map(recipe => recipe.menu_item_id))
const item = products.rows[0]
const classification = item.stock_method === 'non_stock' ? 'non_stock'
  : item.inventory_item_id && recipeIds.has(item.id) ? 'conflict'
    : item.inventory_item_id ? 'direct' : recipeIds.has(item.id) ? 'recipe' : 'missing'
assert.equal(modifiers.config.products[0].stock_linked, true)
assert.equal(classification, 'direct')
assert.equal(recipeIds.has(item.id), false)
assert.equal(item.track_stock, false)
assert.equal(item.tax_rate, '0.14')
console.log('PASS: original fixture now classifies direct stock correctly and preserves actual product fields')

let captured
await saveNativeHposBarProduct({ command: async request => {
  captured = request
  return { outcome: 'committed_local', result: { product_id: menu.product_id } }
} }, { operation_key: '499e92d7-eb20-4399-95bd-a72006261b82', local_recipe_update: true,
  menu_item_id: menu.product_id, expected_menu_version: 2, sku: menu.sku,
  name: menu.name, category: 'Drinks', price: menu.price, tax_rate: item.tax_rate,
  track_stock: item.track_stock, active: false })
assert.equal(captured.payload.tax_rate, '0.14')
assert.equal(captured.payload.track_stock, false)
assert.equal(captured.payload.active, false)
console.log('PASS: original recipe-edit fixture preserves tax, stock and archived state in outgoing command')

const source = await readFile(new URL('../../../../../src/renderer/src/components/hospitality-pos/HposMenu.jsx', import.meta.url), 'utf8')
const archive = source.slice(source.indexOf('`archive:${item.id}`'), source.indexOf("setActionNotice('Product archived locally"))
assert.ok(archive.includes("tax_rate: String(item.tax_rate ?? '0')"))
assert.ok(archive.includes('track_stock: item.track_stock === true'))
console.log('PASS: archive source sends current tax and actual product stock flag (not database execution)')
