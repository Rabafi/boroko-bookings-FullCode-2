// Reviewer-only probes: execute the current adapter with synthetic query/command
// boundaries. No service, database, customer profile or application is opened.
import assert from 'node:assert/strict'
import { readNativeHposMenu, saveNativeHposBarProduct } from '../../../../../src/main/bar-local/nativeHposMenu.js'

const menu = { product_id: 'menu-1', sku: 'BAR-1', name: 'Water', inventory_item_id: 'stock-1',
  product_active: true, available: true, price: '12.00', tax_rate: '0.14', depletion_qty: '1' }
const runtime = { query: async name => ({
  complete: true, unavailable: [], snapshot_watermark: 9,
  scope: { business_id: 'business-1', outlet_id: 'outlet-1' }, pagination: { has_more: false },
  data: name === 'menu.modifiers'
    ? { groups: [], promotions: [], products: [{ product_id: menu.product_id, recipe_lines: [{ ingredient_product_id: 'stock-1', quantity: '1' }] }] }
    : [menu]
}) }
const products = await readNativeHposMenu(runtime, 'menu')
const modifiers = await readNativeHposMenu(runtime, 'modifiers')
// Same recipe-ID and stock-method predicates as the original HposMenu.
const recipeIds = new Set(modifiers.recipes.filter(recipe => recipe.menu_item_id && recipe.ingredients.some(line => Number(line.quantity || 0) > 0)).map(recipe => recipe.menu_item_id))
const item = products.rows[0]
const classification = item.stock_method === 'non_stock' ? 'non_stock'
  : item.inventory_item_id && recipeIds.has(item.id) ? 'conflict'
    : item.inventory_item_id ? 'direct' : recipeIds.has(item.id) ? 'recipe' : 'missing'
assert.equal(modifiers.config.products[0].stock_linked, true)
assert.equal(classification, 'conflict')
assert.equal(recipeIds.has(item.id), true)
console.log(JSON.stringify({ reproduced_issue: 'direct_link_classified_as_recipe_conflict', classification, wizard_has_recipe: recipeIds.has(item.id) }))

let captured
await saveNativeHposBarProduct({ command: async request => {
  captured = request
  return { outcome: 'committed_local', result: { product_id: menu.product_id } }
} }, { operation_key: '499e92d7-eb20-4399-95bd-a72006261b82', local_recipe_update: true,
  menu_item_id: menu.product_id, expected_menu_version: 2, sku: menu.sku,
  name: menu.name, category: 'Drinks', price: menu.price, tax_rate: menu.tax_rate })
assert.equal(captured.payload.tax_rate, '0')
console.log(JSON.stringify({ reproduced_issue: 'recipe_edit_forces_zero_tax', command: captured.command, previous_tax_rate: menu.tax_rate, submitted_tax_rate: captured.payload.tax_rate }))
