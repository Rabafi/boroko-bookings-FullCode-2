// @ts-check
const UNIT_FAMILIES = {
  mass: {
    base: 'g',
    factors: {
      g: 1,
      gram: 1,
      grams: 1,
      kg: 1000,
      kilogram: 1000,
      kilograms: 1000
    }
  },
  volume: {
    base: 'ml',
    factors: {
      ml: 1,
      milliliter: 1,
      milliliters: 1,
      l: 1000,
      liter: 1000,
      liters: 1000
    }
  },
  count: {
    base: 'each',
    factors: {
      each: 1,
      ea: 1,
      unit: 1,
      units: 1,
      piece: 1,
      pieces: 1
    }
  }
}

/** @typedef {'mass' | 'volume' | 'count'} UnitFamily */
/** @typedef {{inventory_item_id: unknown, quantity: unknown, inventory_item_name?: unknown, unit?: unknown}} RecipeQuantityRow */

/** @param {unknown} value @param {string} key @returns {unknown} */
function readField(value, key) {
  if (value === null || value === undefined) {
    throw new TypeError(`Cannot read properties of ${value} (reading '${key}')`)
  }
  return Reflect.get(Object(value), key, value)
}

/** @param {unknown} unit @returns {string} */
function normalizeUnit(unit) {
  return String(unit || 'each').trim().toLowerCase()
}

/** @param {unknown} unit @returns {UnitFamily | null} */
export function getUnitFamily(unit) {
  const normalized = normalizeUnit(unit)
  for (const [family, config] of Object.entries(UNIT_FAMILIES)) {
    if (Object.prototype.hasOwnProperty.call(config.factors, normalized)) {
      // The three configuration keys above are the complete family set.
      return /** @type {UnitFamily} */ (family)
    }
  }
  return null
}

/** @param {unknown} quantity @param {unknown} fromUnit @param {unknown} toUnit @returns {number} */
export function convertQuantity(quantity, fromUnit, toUnit) {
  const numeric = Number(quantity)
  if (!Number.isFinite(numeric)) throw new Error('Quantity must be a finite number.')

  const from = normalizeUnit(fromUnit)
  const to = normalizeUnit(toUnit)
  const fromFamily = getUnitFamily(from)
  const toFamily = getUnitFamily(to)

  if (!fromFamily || !toFamily || fromFamily !== toFamily) {
    throw new Error(`Cannot convert ${fromUnit || 'unknown'} to ${toUnit || 'unknown'}.`)
  }

  const family = UNIT_FAMILIES[/** @type {UnitFamily} */ (fromFamily)]
  // The family checks above prove both normalized units are present in this
  // finite factor map; keep the runtime lookup and its existing failure path.
  const factors = /** @type {Record<string, number>} */ (family.factors)
  return (numeric * factors[from]) / factors[to]
}

/** @param {unknown} [ingredient] */
export function normalizeRecipeIngredient(ingredient = {}) {
  const quantity = Number(readField(ingredient, 'quantity'))
  const inventoryItemId = readField(ingredient, 'inventory_item_id')
  if (!inventoryItemId) throw new Error('Recipe ingredient is missing inventory_item_id.')
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Recipe ingredient quantity must be greater than zero.')

  return {
    inventory_item_id: readField(ingredient, 'inventory_item_id'),
    inventory_item_name: readField(ingredient, 'inventory_item_name') || readField(ingredient, 'name') || '',
    quantity,
    unit: normalizeUnit(readField(ingredient, 'unit') || 'each'),
    waste_percent: Math.max(0, Number(readField(ingredient, 'waste_percent') || 0)),
    cost_per_base_unit: Number.isFinite(Number(readField(ingredient, 'cost_per_base_unit'))) ? Number(readField(ingredient, 'cost_per_base_unit')) : null
  }
}

/** @param {unknown} [recipe] @param {unknown} [saleQuantity] */
export function calculateRecipeUsage(recipe = {}, saleQuantity = 1) {
  const sold = Number(saleQuantity)
  if (!Number.isFinite(sold) || sold <= 0) throw new Error('Sale quantity must be greater than zero.')

  const recipeId = readField(recipe, 'id') || readField(recipe, 'recipe_id') || null
  const recipeVersion = readField(recipe, 'version') || readField(recipe, 'recipe_version') || 1
  const rawIngredients = readField(recipe, 'ingredients')
  const ingredients = Array.isArray(rawIngredients) ? /** @type {unknown[]} */ (rawIngredients) : []

  return ingredients.map((raw) => {
    const ingredient = normalizeRecipeIngredient(raw)
    const wasteMultiplier = 1 + ingredient.waste_percent / 100
    const theoretical_quantity = roundQuantity(ingredient.quantity * sold * wasteMultiplier)
    const theoretical_cost = ingredient.cost_per_base_unit == null
      ? null
      : roundMoney(theoretical_quantity * ingredient.cost_per_base_unit)

    return {
      recipe_id: recipeId,
      recipe_version: recipeVersion,
      inventory_item_id: ingredient.inventory_item_id,
      inventory_item_name: ingredient.inventory_item_name,
      quantity: theoretical_quantity,
      unit: ingredient.unit,
      movement_reason: 'pos_sale',
      theoretical_cost
    }
  })
}

/** @param {unknown} [recipe] @param {unknown} [saleQuantity] @returns {number} */
export function calculateRecipeCost(recipe = {}, saleQuantity = 1) {
  return calculateRecipeUsage(recipe, saleQuantity).reduce((sum, row) => {
    if (row.theoretical_cost == null) return sum
    return roundMoney(sum + row.theoretical_cost)
  }, 0)
}

/** @param {{theoretical?: RecipeQuantityRow[], actual?: RecipeQuantityRow[]}} [input] */
export function calculateStockVariance({ theoretical = [], actual = [] } = {}) {
  const actualByItem = new Map((actual || []).map((row) => [row.inventory_item_id, Number(row.quantity || 0)]))
  return (theoretical || []).map((row) => {
    const expected = Number(row.quantity || 0)
    const counted = actualByItem.has(row.inventory_item_id) ? actualByItem.get(row.inventory_item_id) : null
    const variance = counted == null ? null : roundQuantity(counted - expected)
    return {
      inventory_item_id: row.inventory_item_id,
      inventory_item_name: row.inventory_item_name || '',
      expected_quantity: expected,
      actual_quantity: counted,
      variance_quantity: variance,
      unit: row.unit || 'each'
    }
  })
}

/** @param {unknown} value @returns {number} */
function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

/** @param {unknown} value @returns {number} */
function roundQuantity(value) {
  return Math.round(Number(value || 0) * 10000) / 10000
}
