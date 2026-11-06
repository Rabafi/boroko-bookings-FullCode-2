import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

test('non-stock Bar products remain sellable without creating a phantom stock identity', async (t) => {
  const h = await createHarness(t)
  const saved = await h.call('cmd_catalogue_bar_product_save', h.envelope('catalogue.bar_product.save', {
    name: 'Table service', category: 'Other', price: '3.00', stock_mode: 'create', track_stock: false,
    stock_name: 'Table service', stock_category: 'Other', stock_unit: 'unit',
    opening_stock: '0', reorder_level: '0', unit_cost: '0', selling_price: '3.00'
  }))
  assert.equal(saved.ok, true, JSON.stringify(saved.error))
  const menu = await h.query('menu.availability', { include_inactive: true, limit: 200 })
  const product = menu.data.find((row) => row.product_id === saved.result.menu_item_id)
  assert.ok(product)
  assert.equal(product.track_stock, false)
  assert.equal(product.inventory_item_id, null)
  const stock = await h.query('stock.list', { limit: 200 })
  assert.equal(stock.data.some((row) => row.product_id === product.product_id), false)
})

test('Bar product, shared pack stock and one-time opening receipt commit atomically and replay by the same operation', async (t) => {
  const h = await createHarness(t)
  const envelope = h.envelope('catalogue.bar_product.save', {
    name: 'Bottled Water', category: 'Drinks', price: '12.00', barcode: 'WATER-BASE',
    depletion_qty: '1', is_available: true, stock_mode: 'create', track_stock: true,
    stock_name: 'Bottled Water', stock_category: 'Drinks', stock_unit: 'bottle',
    stock_barcode: 'WATER-BASE', opening_stock: '50', reorder_level: '5',
    unit_cost: '4.2500', selling_price: '12.00',
    packs: [{ pack_size: 6, enabled: true, barcode: 'WATER-6' }]
  })
  const first = await h.call('cmd_catalogue_bar_product_save', envelope)
  assert.equal(first.ok, true, JSON.stringify(first.error))
  const replay = await h.call('cmd_catalogue_bar_product_save', envelope)
  assert.equal(replay.ok, true, JSON.stringify(replay.error))
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.result, first.result)

  const menu = await h.query('menu.availability', { include_inactive: true, limit: 200 })
  const base = menu.data.find((row) => row.product_id === first.result.menu_item_id)
  const pack = menu.data.find((row) => row.template_kind === 'bar_pack' && row.template_pack_size === 6)
  assert.ok(base)
  assert.ok(pack)
  assert.equal(pack.inventory_item_id, base.inventory_item_id)
  assert.equal(pack.barcode, 'WATER-6')

  const ingredient = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'OTHER-INGREDIENT', name: 'Other ingredient', category: 'Drinks', price: '0', tax_rate: '0', track_stock: true
  }))
  assert.equal(ingredient.ok, true)
  const modifierConfig = await h.query('menu.modifiers', {})
  const baseRecipe = modifierConfig.data.products.find((row) => row.product_id === base.product_id)
  const forgedRecipe = await h.call('cmd_catalogue_recipe_set', h.envelope('catalogue.recipe.set', {
    product_id: base.product_id, expected_version: baseRecipe.recipe_version,
    lines: [{ ingredient_product_id: ingredient.result.product_id, quantity: '2', unit_cost: '1.00' }]
  }))
  assert.equal(forgedRecipe.ok, false)
  assert.equal(forgedRecipe.error.code, 'STOCK_LINK_RECIPE_LOCKED')

  const opening = await h.migrator.query(
    `SELECT count(*)::int AS count, sum(delta)::numeric AS quantity
       FROM bar_local.stock_movements WHERE business_id=$1 AND operation_id=$2 AND reason='opening_stock'`,
    [h.businessId, envelope.operation_id]
  )
  assert.equal(opening.rows[0].count, 1)
  assert.equal(Number(opening.rows[0].quantity), 50)
  const balance = await h.migrator.query(
    `SELECT quantity FROM bar_local.stock_balances WHERE business_id=$1 AND outlet_id=$2 AND product_id=$3`,
    [h.businessId, h.outletId, base.inventory_item_id]
  )
  assert.equal(Number(balance.rows[0].quantity), 50)

  const changedPayload = { ...envelope, payload: { ...envelope.payload, price: '13.00' } }
  await assert.rejects(h.call('cmd_catalogue_bar_product_save', changedPayload),
    (error) => error.detail === 'IDEMPOTENCY_PAYLOAD_CONFLICT')

  const shiftId = await h.openShift()
  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId, items: [{ product_id: pack.product_id, quantity: '1' }],
    tenders: [{ method: 'cash', amount: '72.00', tendered: '72.00' }], discount_amount: '0', tip_amount: '0'
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  const afterSale = await h.migrator.query(
    `SELECT quantity FROM bar_local.stock_balances WHERE business_id=$1 AND outlet_id=$2 AND product_id=$3`,
    [h.businessId, h.outletId, base.inventory_item_id]
  )
  assert.equal(Number(afterSale.rows[0].quantity), 44)

  const freshMenu = await h.query('menu.availability', { include_inactive: true, limit: 200 })
  const freshBase = freshMenu.data.find((row) => row.product_id === first.result.menu_item_id)

  const edited = await h.call('cmd_catalogue_bar_product_save', h.envelope('catalogue.bar_product.save', {
    menu_item_id: freshBase.product_id, expected_menu_version: freshBase.product_version,
    inventory_item_id: freshBase.inventory_item_id, expected_stock_version: freshBase.stock_version,
    name: 'Bottled Water', category: 'Drinks', price: '12.00', barcode: 'WATER-BASE',
    depletion_qty: '1', is_available: false, stock_mode: 'link', track_stock: true,
    stock_name: 'Bottled Water', stock_category: 'Drinks', stock_unit: 'bottle',
    stock_barcode: 'WATER-BASE', opening_stock: '0', reorder_level: '5',
    unit_cost: '4.2500', selling_price: '12.00',
    packs: [{ pack_size: 6, enabled: true, barcode: 'WATER-6' }]
  }))
  assert.equal(edited.ok, true, JSON.stringify(edited.error))
  assert.equal(edited.result.inventory_item_id, base.inventory_item_id, 'a link-mode edit must retain the locked stock identity')
  const editedMenu = await h.query('menu.availability', { include_inactive: true, limit: 200 })
  const editedPack = editedMenu.data.find((row) => row.product_id === pack.product_id)
  assert.equal(editedPack.inventory_item_id, base.inventory_item_id, 'packs remain linked to the shared stock identity after edits')
  const hidden = await h.query('menu.availability', { include_inactive: true, limit: 200 })
  assert.equal(hidden.data.find((row) => row.product_id === freshBase.product_id).available, false)
  const packStockMode = await h.migrator.query(
    `SELECT track_stock FROM bar_local.products WHERE business_id=$1 AND id=$2`,
    [h.businessId, pack.product_id]
  )
  assert.equal(packStockMode.rows[0].track_stock, false, 'pack SKUs consume shared base stock and do not carry their own balance')
  const unchanged = await h.migrator.query(
    `SELECT quantity FROM bar_local.stock_balances WHERE business_id=$1 AND outlet_id=$2 AND product_id=$3`,
    [h.businessId, h.outletId, base.inventory_item_id]
  )
  assert.equal(Number(unchanged.rows[0].quantity), 44, 'an edit must never replay opening stock')
  const audit = await h.migrator.query(
    `SELECT count(*)::int AS count FROM bar_local.audit_log WHERE business_id=$1 AND action='catalogue.bar_product.save'`,
    [h.businessId]
  )
  assert.equal(audit.rows[0].count, 2)
})

test('Bar product link save refuses a forged different outlet before changing stock', async (t) => {
  const h = await createHarness(t)
  const stock = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'LINK-BASE', name: 'Link base', category: 'Drinks', price: '0', tax_rate: '0', track_stock: true
  }))
  assert.equal(stock.ok, true)
  const forgedOutlet = await h.call('cmd_catalogue_bar_product_save', h.envelope('catalogue.bar_product.save', {
    name: 'Linked Sale Item', category: 'Drinks', price: '8.00', stock_mode: 'link', track_stock: true,
    inventory_item_id: stock.result.product_id, expected_stock_version: 0,
    stock_name: 'Link base', stock_category: 'Drinks', stock_unit: 'bottle',
    outlet_id: '00000000-0000-4000-8000-000000000999', opening_stock: '0', reorder_level: '0',
    unit_cost: '1.00', selling_price: '8.00'
  }))
  assert.equal(forgedOutlet.ok, false)
  assert.equal(forgedOutlet.error.code, 'OUTLET_SCOPE_MISMATCH')
  const products = await h.migrator.query(`SELECT count(*)::int AS count FROM bar_local.products WHERE business_id=$1`, [h.businessId])
  assert.equal(products.rows[0].count, 1)
})
