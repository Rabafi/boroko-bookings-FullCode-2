import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

test('menu add-on management and cashier promotion queries enforce separate capabilities and scope', async (t) => {
  const h = await createHarness(t)
  const group = await h.call('cmd_catalogue_modifier_group_upsert', h.envelope('catalogue.modifier_group.upsert', {
    code: 'SIZE', name: 'Size', required: true, min_selections: 1, max_selections: 1
  }))
  assert.equal(group.ok, true, JSON.stringify(group.error))
  const option = await h.call('cmd_catalogue_modifier_option_upsert', h.envelope('catalogue.modifier_option.upsert', {
    modifier_group_id: group.result.modifier_group_id, code: 'LARGE', name: 'Large', price_delta: '2.00'
  }))
  assert.equal(option.ok, true, JSON.stringify(option.error))
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'DRINK-1', name: 'Drink', category: 'Drinks', price: '10.00', tax_rate: '0', track_stock: false
  }))
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const linked = await h.call('cmd_catalogue_product_modifier_set', h.envelope('catalogue.product_modifier.set', {
    product_id: product.result.product_id, groups: [group.result.modifier_group_id]
  }))
  assert.equal(linked.ok, true, JSON.stringify(linked.error))
  const ingredient = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'INGREDIENT-1', name: 'Ingredient', category: 'Ingredients', price: '1.25', tax_rate: '0', track_stock: true
  }))
  assert.equal(ingredient.ok, true, JSON.stringify(ingredient.error))
  const recipe = await h.call('cmd_catalogue_recipe_set', h.envelope('catalogue.recipe.set', {
    product_id: product.result.product_id,
    lines: [{ ingredient_product_id: ingredient.result.product_id, quantity: '0.5', unit_cost: '0.75' }]
  }))
  assert.equal(recipe.ok, true, JSON.stringify(recipe.error))
  const promotion = await h.call('cmd_promotion_upsert', h.envelope('promotion.upsert', {
    code: 'HAPPYHOUR', name: 'Happy hour', discount_type: 'percent', percent: '10', amount: '0.00',
    minimum_subtotal: '5.00', scope: 'all', active: true
  }))
  assert.equal(promotion.ok, true, JSON.stringify(promotion.error))
  const futurePromotion = await h.call('cmd_promotion_upsert', h.envelope('promotion.upsert', {
    code: 'FUTURE', name: 'Future offer', discount_type: 'percent', percent: '5', amount: '0.00',
    minimum_subtotal: '0.00', scope: 'all', active: true, starts_on: '2099-01-01'
  }))
  assert.equal(futurePromotion.ok, true, JSON.stringify(futurePromotion.error))

  const result = await h.query('menu.modifiers')
  assert.equal(result.complete, true)
  assert.equal(result.scope.business_id, h.businessId)
  assert.equal(result.scope.outlet_id, h.outletId)
  assert.equal(result.data.groups[0].options[0].modifier_option_id, option.result.modifier_option_id)
  assert.equal(result.data.products[0].product_id, product.result.product_id)
  assert.equal(result.data.products[0].version, 1)
  assert.equal(result.data.products[0].groups[0].modifier_group_id, group.result.modifier_group_id)
  assert.equal(result.data.products[0].recipe_version, 1)
  assert.deepEqual(result.data.products[0].recipe_lines.map((line) => ({ id: line.ingredient_product_id, quantity: line.quantity, unit_cost: line.unit_cost })), [
    { id: ingredient.result.product_id, quantity: '0.500000', unit_cost: '0.75' }
  ])
  const managerPromotion = result.data.promotions.find((row) => row.code === 'HAPPYHOUR')
  assert.equal(managerPromotion.promotion_id, promotion.result.promotion_id)
  assert.equal(managerPromotion.percent, '10.0000')
  assert.equal(managerPromotion.minimum_subtotal, '5.00')

  // The manager fixture has POS view but not menu-management capability.
  const cashierPromotions = await h.query('menu.promotions', {}, { tokenHash: h.managerTokenHash })
  assert.equal(cashierPromotions.complete, true)
  assert.equal(cashierPromotions.scope.business_id, h.businessId)
  assert.equal(cashierPromotions.scope.outlet_id, h.outletId)
  assert.deepEqual(cashierPromotions.data.promotions.map((row) => row.code), ['HAPPYHOUR'])
  assert.equal(cashierPromotions.data.promotions[0].promotion_id, promotion.result.promotion_id)
  assert.equal(cashierPromotions.data.promotions[0].percent, '10.0000')
  assert.equal(cashierPromotions.data.discount_policy.approval_threshold_percent, '10.0000')
  assert.equal(cashierPromotions.data.discount_policy.maximum_percent, '25.0000')
})
