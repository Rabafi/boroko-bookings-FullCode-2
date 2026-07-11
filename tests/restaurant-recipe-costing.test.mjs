import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateRecipeCost,
  calculateRecipeUsage,
  calculateStockVariance,
  convertQuantity,
  getUnitFamily
} from '../src/shared/restaurantRecipeCosting.js'

const burgerRecipe = {
  id: 'burger',
  version: 3,
  ingredients: [
    { inventory_item_id: 'bun', inventory_item_name: 'Burger bun', quantity: 1, unit: 'each', cost_per_base_unit: 2.5 },
    { inventory_item_id: 'patty', inventory_item_name: 'Beef patty', quantity: 1, unit: 'each', cost_per_base_unit: 8 },
    { inventory_item_id: 'lettuce', inventory_item_name: 'Lettuce', quantity: 20, unit: 'g', waste_percent: 10, cost_per_base_unit: 0.03 },
    { inventory_item_id: 'sauce', inventory_item_name: 'Burger sauce', quantity: 15, unit: 'ml', cost_per_base_unit: 0.04 },
    { inventory_item_id: 'cheese', inventory_item_name: 'Cheese slice', quantity: 1, unit: 'each', cost_per_base_unit: 1.5 }
  ]
}

test('unit conversion supports restaurant mass, volume, and count units', () => {
  assert.equal(getUnitFamily('kg'), 'mass')
  assert.equal(getUnitFamily('ml'), 'volume')
  assert.equal(getUnitFamily('each'), 'count')
  assert.equal(convertQuantity(1.5, 'kg', 'g'), 1500)
  assert.equal(convertQuantity(2, 'l', 'ml'), 2000)
  assert.equal(convertQuantity(12, 'pieces', 'each'), 12)
  assert.throws(() => convertQuantity(1, 'kg', 'ml'), /Cannot convert/)
})

test('selling burgers calculates ingredient usage with recipe version and wastage', () => {
  const usage = calculateRecipeUsage(burgerRecipe, 2)
  assert.equal(usage.length, 5)
  assert.deepEqual(
    usage.find((row) => row.inventory_item_id === 'bun'),
    {
      recipe_id: 'burger',
      recipe_version: 3,
      inventory_item_id: 'bun',
      inventory_item_name: 'Burger bun',
      quantity: 2,
      unit: 'each',
      movement_reason: 'pos_sale',
      theoretical_cost: 5
    }
  )
  assert.equal(usage.find((row) => row.inventory_item_id === 'lettuce').quantity, 44)
})

test('recipe costing returns expected cost for a sale quantity', () => {
  assert.equal(calculateRecipeCost(burgerRecipe, 1), 13.26)
  assert.equal(calculateRecipeCost(burgerRecipe, 2), 26.52)
})

test('stock variance compares theoretical usage against actual counts', () => {
  const theoretical = calculateRecipeUsage(burgerRecipe, 10)
  const variance = calculateStockVariance({
    theoretical,
    actual: [
      { inventory_item_id: 'bun', quantity: 8 },
      { inventory_item_id: 'patty', quantity: 10 },
      { inventory_item_id: 'lettuce', quantity: 230 },
      { inventory_item_id: 'sauce', quantity: 140 },
      { inventory_item_id: 'cheese', quantity: 12 }
    ]
  })

  assert.equal(variance.find((row) => row.inventory_item_id === 'bun').variance_quantity, -2)
  assert.equal(variance.find((row) => row.inventory_item_id === 'lettuce').expected_quantity, 220)
  assert.equal(variance.find((row) => row.inventory_item_id === 'lettuce').variance_quantity, 10)
})

test('invalid recipe input fails closed', () => {
  assert.throws(() => calculateRecipeUsage({ ingredients: [{ quantity: 1 }] }, 1), /inventory_item_id/)
  assert.throws(() => calculateRecipeUsage({ ingredients: [{ inventory_item_id: 'x', quantity: 0 }] }, 1), /greater than zero/)
  assert.throws(() => calculateRecipeUsage(burgerRecipe, 0), /Sale quantity/)
})
