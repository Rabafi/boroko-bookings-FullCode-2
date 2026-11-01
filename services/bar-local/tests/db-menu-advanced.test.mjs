import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createHarness } from './harness.mjs'

async function callOk(h, fn, command, payload) {
  const result = await h.call(fn, h.envelope(command, payload))
  assert.equal(result.ok, true, `${command}: ${JSON.stringify(result.error)}`)
  return result.result
}

async function createProduct(h, sku, name, price, { tax = '0', track = false, category = 'Food' } = {}) {
  return callOk(h, 'cmd_catalogue_upsert', 'catalogue.upsert', {
    sku, name, category, price, tax_rate: tax, track_stock: track
  })
}

async function receive(h, productId, quantity, unitCost = '0') {
  return callOk(h, 'cmd_stock_receive', 'stock.receive', {
    product_id: productId, quantity, unit_cost: unitCost
  })
}

async function createGroup(h, code, { required = true, min = 1, max = 1 } = {}) {
  return callOk(h, 'cmd_catalogue_modifier_group_upsert', 'catalogue.modifier_group.upsert', {
    code, name: code, required, min_selections: min, max_selections: max
  })
}

async function createOption(h, groupId, code, priceDelta) {
  return callOk(h, 'cmd_catalogue_modifier_option_upsert', 'catalogue.modifier_option.upsert', {
    modifier_group_id: groupId, code, name: code, price_delta: priceDelta
  })
}

async function linkGroups(h, productId, groups) {
  return callOk(h, 'cmd_catalogue_product_modifier_set', 'catalogue.product_modifier.set', {
    product_id: productId, groups
  })
}

async function setRecipe(h, productId, lines) {
  return callOk(h, 'cmd_catalogue_recipe_set', 'catalogue.recipe.set', {
    product_id: productId, lines
  })
}

async function createPromotion(h, payload) {
  return callOk(h, 'cmd_promotion_upsert', 'promotion.upsert', {
    name: payload.code, scope: 'all', minimum_subtotal: '0', active: true, ...payload
  })
}

function cash(amount, tendered = amount) {
  return { method: 'cash', amount, tendered }
}

function saleEnvelope(h, shiftId, items, tender, promotionCode) {
  const payload = {
    shift_id: shiftId,
    items,
    discount_amount: '0',
    tip_amount: '0',
    tenders: [tender]
  }
  if (promotionCode) payload.promotion_code = promotionCode
  return h.envelope('sale.commit', payload)
}

async function stock(h, productId) {
  const result = await h.migrator.query(
    `SELECT quantity FROM bar_local.stock_balances
      WHERE business_id = $1 AND outlet_id = $2 AND product_id = $3`,
    [h.businessId, h.outletId, productId]
  )
  return Number(result.rows[0].quantity)
}

async function refused(h, envelope, code) {
  const result = await h.call('cmd_sale_commit', envelope)
  assert.equal(result.ok, false, `expected ${code} but sale committed`)
  assert.equal(result.error.code, code, JSON.stringify(result.error))
}

test('modifiers, recipes and promotions price atomically and leave auditable evidence', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()

  const burger = await createProduct(h, 'BURGER-1', 'Burger', '20.00', { tax: '0.10', track: true })
  const patty = await createProduct(h, 'PATTY-1', 'Patty', '8.00', { track: true, category: 'Ingredients' })
  const bun = await createProduct(h, 'BUN-1', 'Bun', '2.00', { track: true, category: 'Ingredients' })
  const fries = await createProduct(h, 'FRIES-1', 'Fries', '5.00', { tax: '0.10' })
  await receive(h, burger.product_id, '50', '12.00')
  await receive(h, patty.product_id, '10', '8.00')
  await receive(h, bun.product_id, '20', '2.00')

  const size = await createGroup(h, 'SIZE')
  const large = await createOption(h, size.modifier_group_id, 'LARGE', '3.00')
  const small = await createOption(h, size.modifier_group_id, 'SMALL', '0.00')
  const linked = await linkGroups(h, burger.product_id, [size.modifier_group_id])
  assert.equal(linked.version, 1)
  assert.equal(linked.groups.length, 1)
  const recipe = await setRecipe(h, burger.product_id, [
    { ingredient_product_id: patty.product_id, quantity: '0.25', unit_cost: '8.00' },
    { ingredient_product_id: bun.product_id, quantity: '1', unit_cost: '2.00' }
  ])
  assert.equal(recipe.version, 1)
  assert.equal(Number(recipe.cost), 4)

  const ten10 = await createPromotion(h, { code: 'TEN10', discount_type: 'percent', percent: '10' })
  await createPromotion(h, { code: 'INACTIVE', discount_type: 'percent', percent: '10', active: false })
  await createPromotion(h, { code: 'MINSPEND', discount_type: 'percent', percent: '10', minimum_subtotal: '100' })
  await createPromotion(h, { code: 'FRIESONLY', discount_type: 'percent', percent: '10', scope: 'product', product_id: fries.product_id })
  const dates = await h.migrator.query(
    `SELECT to_char(bar_local.current_business_date() - 1, 'YYYY-MM-DD') AS yesterday,
            to_char(bar_local.current_business_date() + 1, 'YYYY-MM-DD') AS tomorrow`
  )
  await createPromotion(h, { code: 'EXPIRED', discount_type: 'percent', percent: '10', ends_on: dates.rows[0].yesterday })
  await createPromotion(h, { code: 'FUTURE', discount_type: 'percent', percent: '10', starts_on: dates.rows[0].tomorrow })

  const firstSaleEnvelope = saleEnvelope(h, shiftId, [{
    product_id: burger.product_id,
    quantity: '2',
    unit_price: '0.01',
    modifiers: [large.modifier_option_id]
  }], cash('45.54', '50.00'), 'TEN10')
  const sale = await h.call('cmd_sale_commit', firstSaleEnvelope)
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  assert.equal(sale.result.sale_id.length, 36)
  assert.equal(Number(sale.result.receipt.subtotal), 41.4)
  assert.equal(Number(sale.result.receipt.discount), 4.6)
  assert.equal(Number(sale.result.receipt.promotion_discount), 4.6)
  assert.equal(sale.result.receipt.promotion_code, 'TEN10')
  assert.equal(Number(sale.result.receipt.tax), 4.14)
  assert.equal(Number(sale.result.receipt.total), 45.54)
  assert.equal(Number(sale.result.receipt.change), 4.46)

  const line = sale.result.receipt.lines[0]
  assert.equal(Number(line.unit_price), 23)
  assert.equal(Number(line.line_subtotal), 46)
  assert.equal(Number(line.line_discount), 4.6)
  assert.equal(Number(line.line_tax), 4.14)
  assert.equal(Number(line.line_total), 45.54)
  assert.equal(line.modifiers.length, 1)
  assert.equal(line.modifiers[0].option_code, 'LARGE')
  assert.equal(Number(line.modifiers[0].price_delta), 3)
  assert.equal(Number(line.recipe_cost), 8)
  assert.equal(line.recipe.length, 2)

  assert.equal(await stock(h, burger.product_id), 50)
  assert.equal(await stock(h, patty.product_id), 9.5)
  assert.equal(await stock(h, bun.product_id), 18)
  const soldProductMovement = await h.migrator.query(
    `SELECT count(*)::int AS count FROM bar_local.stock_movements
      WHERE business_id = $1 AND outlet_id = $2 AND product_id = $3 AND reason = 'sale.depletion'`,
    [h.businessId, h.outletId, burger.product_id]
  )
  assert.equal(soldProductMovement.rows[0].count, 0)
  const recipeMovements = await h.migrator.query(
    `SELECT product_id, reason, delta FROM bar_local.stock_movements
      WHERE business_id = $1 AND outlet_id = $2 AND reason = 'sale.recipe.depletion'
      ORDER BY product_id`,
    [h.businessId, h.outletId]
  )
  assert.equal(recipeMovements.rows.length, 2)
  assert.equal(recipeMovements.rows.every((row) => row.reason === 'sale.recipe.depletion'), true)

  const storedLine = await h.migrator.query(
    `SELECT modifier_snapshot, recipe_cost, recipe_snapshot, promotion_code, promotion_discount
       FROM bar_local.sale_lines WHERE sale_id = $1`,
    [sale.result.sale_id]
  )
  assert.equal(storedLine.rows[0].modifier_snapshot.length, 1)
  assert.equal(Number(storedLine.rows[0].recipe_cost), 8)
  assert.equal(storedLine.rows[0].recipe_snapshot.length, 2)
  assert.equal(storedLine.rows[0].promotion_code, 'TEN10')
  assert.equal(Number(storedLine.rows[0].promotion_discount), 4.6)

  const replay = await h.call('cmd_sale_commit', firstSaleEnvelope)
  assert.equal(replay.ok, true)
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.sale_id, sale.result.sale_id)
  const replayCounts = await h.migrator.query(
    `SELECT (SELECT count(*)::int FROM bar_local.sales WHERE id = $1) AS sales,
            (SELECT count(*)::int FROM bar_local.promotion_redemptions WHERE sale_id = $1) AS redemptions,
            (SELECT count(*)::int FROM bar_local.stock_movements
              WHERE business_id = $2 AND outlet_id = $3 AND reason = 'sale.recipe.depletion') AS movements`,
    [sale.result.sale_id, h.businessId, h.outletId]
  )
  assert.deepEqual(replayCounts.rows[0], { sales: 1, redemptions: 1, movements: 2 })

  const tab = await callOk(h, 'cmd_tab_open', 'tab.open', { table_label: 'Table 7' })
  const added = await callOk(h, 'cmd_tab_add', 'tab.add', {
    tab_id: tab.tab_id,
    expected_version: 1,
    items: [{ product_id: burger.product_id, quantity: '1', modifiers: [large.modifier_option_id] }]
  })
  assert.equal(added.version, 2)
  const settled = await h.call('cmd_tab_settle', h.envelope('tab.settle', {
    tab_id: tab.tab_id,
    expected_version: 2,
    discount_amount: '0',
    tip_amount: '0',
    promotion_code: 'TEN10',
    tenders: [cash('22.77', '25.00')]
  }))
  assert.equal(settled.ok, true, JSON.stringify(settled.error))
  assert.equal(Number(settled.receipt.total), 22.77)
  assert.equal(Number(settled.receipt.tax), 2.07)
  assert.equal(Number(settled.receipt.promotion_discount), 2.3)
  assert.equal(Number(settled.receipt.change), 2.23)
  assert.equal(settled.receipt.lines[0].modifiers[0].option_code, 'LARGE')
  assert.equal(Number(settled.receipt.lines[0].line_discount), 2.3)
  const tabLine = await h.migrator.query(
    `SELECT status, promotion_code, promotion_discount, modifier_snapshot, recipe_cost
       FROM bar_local.tab_lines WHERE tab_id = $1`,
    [tab.tab_id]
  )
  assert.equal(tabLine.rows[0].status, 'settled')
  assert.equal(tabLine.rows[0].promotion_code, 'TEN10')
  assert.equal(Number(tabLine.rows[0].promotion_discount), 2.3)
  assert.equal(tabLine.rows[0].modifier_snapshot.length, 1)
  assert.equal(Number(tabLine.rows[0].recipe_cost), 4)
  assert.equal(await stock(h, burger.product_id), 50)
  assert.equal(await stock(h, patty.product_id), 9.25)
  assert.equal(await stock(h, bun.product_id), 17)

  const cheap = await createProduct(h, 'CHEAP-1', 'Cheap item', '1.00')
  const dear = await createProduct(h, 'DEAR-1', 'Dear item', '2.00')
  await createPromotion(h, { code: 'PENNY', discount_type: 'amount', amount: '0.01' })
  const penny = await h.call('cmd_sale_commit', saleEnvelope(h, shiftId, [
    { product_id: cheap.product_id, quantity: '1' },
    { product_id: dear.product_id, quantity: '1' }
  ], cash('2.99'), 'PENNY'))
  assert.equal(penny.ok, true, JSON.stringify(penny.error))
  assert.equal(Number(penny.result.receipt.promotion_discount), 0.01)
  assert.equal(Number(penny.result.receipt.total), 2.99)
  assert.equal(Number(penny.result.receipt.lines[0].line_discount), 0)
  assert.equal(Number(penny.result.receipt.lines[1].line_discount), 0.01)

  const beforeRefusals = await h.migrator.query(
    'SELECT count(*)::int AS count FROM bar_local.sales WHERE business_id = $1', [h.businessId]
  )
  const validItem = { product_id: burger.product_id, quantity: '1', modifiers: [large.modifier_option_id] }
  await refused(h, saleEnvelope(h, shiftId, [{ product_id: burger.product_id, quantity: '1' }], cash('23.00')), 'MODIFIER_SELECTION_REQUIRED')
  await refused(h, saleEnvelope(h, shiftId, [{
    product_id: burger.product_id, quantity: '1', modifiers: [randomUUID()]
  }], cash('23.00')), 'MODIFIER_INVALID')
  await refused(h, saleEnvelope(h, shiftId, [{
    product_id: burger.product_id, quantity: '1', modifiers: [large.modifier_option_id, small.modifier_option_id]
  }], cash('23.00')), 'MODIFIER_SELECTION_EXCEEDED')
  await refused(h, saleEnvelope(h, shiftId, [{
    ...validItem, quantity: '100'
  }], cash('2300.00')), 'INSUFFICIENT_STOCK')
  await refused(h, saleEnvelope(h, shiftId, [validItem], cash('23.00'), 'NOPE'), 'PROMOTION_NOT_FOUND')
  await refused(h, saleEnvelope(h, shiftId, [validItem], cash('23.00'), 'INACTIVE'), 'PROMOTION_INACTIVE')
  await refused(h, saleEnvelope(h, shiftId, [validItem], cash('23.00'), 'EXPIRED'), 'PROMOTION_EXPIRED')
  await refused(h, saleEnvelope(h, shiftId, [validItem], cash('23.00'), 'FUTURE'), 'PROMOTION_NOT_STARTED')
  await refused(h, saleEnvelope(h, shiftId, [validItem], cash('23.00'), 'MINSPEND'), 'PROMOTION_MINIMUM_NOT_MET')
  await refused(h, saleEnvelope(h, shiftId, [validItem], cash('23.00'), 'FRIESONLY'), 'PROMOTION_NOT_APPLICABLE')
  const afterRefusals = await h.migrator.query(
    'SELECT count(*)::int AS count FROM bar_local.sales WHERE business_id = $1', [h.businessId]
  )
  assert.equal(afterRefusals.rows[0].count, beforeRefusals.rows[0].count)
  assert.equal(await stock(h, patty.product_id), 9.25)
  assert.equal(await stock(h, bun.product_id), 17)

  const staleGroup = await h.call('cmd_catalogue_modifier_group_upsert', h.envelope('catalogue.modifier_group.upsert', {
    modifier_group_id: size.modifier_group_id, code: 'SIZE', name: 'SIZE', required: true,
    min_selections: 1, max_selections: 1, expected_version: 99
  }))
  assert.equal(staleGroup.ok, false)
  assert.equal(staleGroup.error.code, 'MODIFIER_GROUP_VERSION_CONFLICT')
  const staleOption = await h.call('cmd_catalogue_modifier_option_upsert', h.envelope('catalogue.modifier_option.upsert', {
    modifier_option_id: large.modifier_option_id, modifier_group_id: size.modifier_group_id,
    code: 'LARGE', name: 'LARGE', price_delta: '3.00', expected_version: 99
  }))
  assert.equal(staleOption.ok, false)
  assert.equal(staleOption.error.code, 'MODIFIER_OPTION_VERSION_CONFLICT')
  const staleLink = await h.call('cmd_catalogue_product_modifier_set', h.envelope('catalogue.product_modifier.set', {
    product_id: burger.product_id, groups: [size.modifier_group_id], expected_version: 99
  }))
  assert.equal(staleLink.ok, false)
  assert.equal(staleLink.error.code, 'PRODUCT_MODIFIER_VERSION_CONFLICT')
  const staleRecipe = await h.call('cmd_catalogue_recipe_set', h.envelope('catalogue.recipe.set', {
    product_id: burger.product_id, expected_version: 99, lines: [
      { ingredient_product_id: patty.product_id, quantity: '0.25', unit_cost: '8.00' }
    ]
  }))
  assert.equal(staleRecipe.ok, false)
  assert.equal(staleRecipe.error.code, 'RECIPE_VERSION_CONFLICT')
  const stalePromotion = await h.call('cmd_promotion_upsert', h.envelope('promotion.upsert', {
    promotion_id: ten10.promotion_id, code: 'TEN10', name: 'TEN10',
    discount_type: 'percent', percent: '10', scope: 'all', expected_version: 99
  }))
  assert.equal(stalePromotion.ok, false)
  assert.equal(stalePromotion.error.code, 'PROMOTION_VERSION_CONFLICT')

  const audit = await h.migrator.query(
    `SELECT action, count(*)::int AS count FROM bar_local.audit_log
      WHERE business_id = $1 GROUP BY action`,
    [h.businessId]
  )
  const counts = Object.fromEntries(audit.rows.map((row) => [row.action, row.count]))
  assert.equal(counts['catalogue.modifier_group.upsert'], 1)
  assert.equal(counts['catalogue.modifier_option.upsert'], 2)
  assert.equal(counts['catalogue.product_modifier.set'], 1)
  assert.equal(counts['catalogue.recipe.set'], 1)
  assert.equal(counts['promotion.upsert'], 7)
  assert.equal(counts['sale.committed'], 2)
  assert.equal(counts['tab.settled'], 1)
  const outbox = await h.migrator.query(
    `SELECT count(*)::int AS count FROM bar_local.outbox
      WHERE business_id = $1 AND event_type = 'sale.committed'`,
    [h.businessId]
  )
  assert.equal(outbox.rows[0].count, 3)
})
