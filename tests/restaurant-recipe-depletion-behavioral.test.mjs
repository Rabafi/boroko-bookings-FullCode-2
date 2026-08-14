import assert from 'node:assert/strict'
import pg from 'pg'
import test from 'node:test'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.RESTAURANT_ACCOUNTING_TEST_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const client = () => new pg.Client({ connectionString: DB_URL })

async function setActor(connection, actorId, lodgeId) {
  await connection.query(
    "select set_config('request.jwt.claim.role','service_role',false), set_config('app.session_valid','true',false), set_config('app.actor_id',$1,false), set_config('app.lodge_id',$2,false), set_config('app.session_role','admin',false)",
    [actorId, lodgeId]
  )
}

async function createSaleLine(connection, { lodgeId, orderId, menuItemId, itemName, quantity, outletId, transactionType = 'sale' }) {
  await connection.query('begin')
  try {
    await connection.query(
      `insert into public.pos_orders
        (id, lodge_id, status, total, outlet_id, transaction_type, payment_method, payment_breakdown, completed_at)
       values ($1, $2, 'completed', 10, $3, $4, 'cash', '[{"method":"cash","amount":10}]'::jsonb, now())`,
      [orderId, lodgeId, outletId, transactionType]
    )
    await connection.query(
      `insert into public.pos_order_items
        (id, lodge_id, order_id, menu_item_id, item_name, quantity, unit_price, subtotal, inventory_item_id)
       values ($1, $2, $3, $4, $5, $6, 10, 10, null)`,
      [randomUUID(), lodgeId, orderId, menuItemId, itemName, quantity]
    )
    await connection.query('commit')
    return { success: true }
  } catch (error) {
    await connection.query('rollback').catch(() => {})
    return { success: false, error }
  }
}

test('recipe depletion is atomic, authoritative and serialized in PostgreSQL', async () => {
  const connection = client()
  await connection.connect()
  const lodgeId = randomUUID()
  const actorId = randomUUID()
  const outletId = randomUUID()
  const locationId = randomUUID()
  const inventoryId = randomUUID()
  const menuItemId = randomUUID()
  const recipeId = randomUUID()
  const concurrentInventoryId = randomUUID()
  const concurrentMenuItemId = randomUUID()
  const concurrentRecipeId = randomUUID()

  try {
    await connection.query(`
      insert into public.settings(lodge_id, lodge_name, company_name, business_type, property_type, currency)
      values ($1, 'Recipe Test', 'Recipe Test', 'restaurant', 'restaurant', 'BWP');
      insert into public.users(id, lodge_id, name, email, role, password_hash, status)
      values ($2, $1, 'Recipe Test Manager', $2::text || '@example.invalid', 'admin', 'unused', 'active');
      insert into public.outlets(id, lodge_id, name, type)
      values ($3, $1, 'Recipe Outlet', 'food');
      insert into public.restaurant_stock_locations(id, lodge_id, name, is_default)
      values ($4, $1, 'Recipe Location', true);
      insert into public.restaurant_outlet_stock_locations(lodge_id, outlet_id, stock_location_id)
      values ($1, $3, $4);
      insert into public.inventory_items(id, lodge_id, outlet_id, name, category, unit, current_stock, latest_unit_cost)
      values ($5, $1, $3, 'Recipe Ingredient', 'Food', 'each', 20, 2),
             ($8, $1, $3, 'Concurrent Ingredient', 'Food', 'each', 5, 2);
      insert into public.restaurant_stock_location_balances(lodge_id, inventory_item_id, stock_location_id, quantity)
      values ($1, $5, $4, 20), ($1, $8, $4, 5);
      insert into public.pos_menu_items(id, lodge_id, outlet_id, name, category, price, is_available)
      values ($6, $1, $3, 'Recipe Meal', 'Food', 10, true),
             ($9, $1, $3, 'Concurrent Meal', 'Food', 10, true);
      insert into public.restaurant_recipes(id, lodge_id, menu_item_id, name, version, active)
      values ($7, $1, $6, 'Recipe Meal Formula', 1, true),
             ($10, $1, $9, 'Concurrent Formula', 1, true);
      insert into public.restaurant_recipe_ingredients(lodge_id, recipe_id, inventory_item_id, quantity, unit, sort_order)
      values ($1, $7, $5, 2, 'each', 1), ($1, $7, $5, 3, 'each', 2),
             ($1, $10, $8, 3, 'each', 1);
    `, [lodgeId, actorId, outletId, locationId, inventoryId, menuItemId, recipeId, concurrentInventoryId, concurrentMenuItemId, concurrentRecipeId])
    await setActor(connection, actorId, lodgeId)

    const firstOrder = randomUUID()
    const first = await createSaleLine(connection, { lodgeId, orderId: firstOrder, menuItemId, itemName: 'Recipe Meal', quantity: 2, outletId })
    assert.equal(first.success, true, first.error?.message)
    const afterFirst = await connection.query('select current_stock from public.inventory_items where id = $1', [inventoryId])
    assert.equal(Number(afterFirst.rows[0].current_stock), 10, 'two portions must consume two authoritative recipe lines: 2 + 3 per portion')
    const movementCount = await connection.query('select count(*)::int as count from public.restaurant_recipe_stock_movements where order_id = $1', [firstOrder])
    const ledgerCount = await connection.query("select count(*)::int as count from public.inventory_movements where reference_type = 'restaurant_recipe_sale' and reference_id = $1", [firstOrder])
    assert.equal(movementCount.rows[0].count, 1, 'duplicate recipe rows for one ingredient must aggregate')
    assert.equal(ledgerCount.rows[0].count, 1, 'inventory ledger must commit with the recipe ledger')

    const replay = await connection.query(
      `select public.record_recipe_stock_depletion($1::jsonb) as result`,
      [JSON.stringify({ lodge_id: lodgeId, order_id: firstOrder, quantity: 999, items: [{ menu_item_id: menuItemId, quantity: 999 }] })]
    )
    assert.equal(replay.rows[0].result.replayed, true)
    const afterReplay = await connection.query('select current_stock from public.inventory_items where id = $1', [inventoryId])
    assert.equal(Number(afterReplay.rows[0].current_stock), 10)

    const secondOrder = randomUUID()
    const second = await createSaleLine(connection, { lodgeId, orderId: secondOrder, menuItemId, itemName: 'Recipe Meal', quantity: 1, outletId })
    assert.equal(second.success, true, second.error?.message)
    const lineCount = await connection.query('select count(*)::int as count from public.restaurant_recipe_stock_movements where inventory_item_id = $1 and order_id in ($2, $3)', [inventoryId, firstOrder, secondOrder])
    assert.equal(lineCount.rows[0].count, 2, 'multiple authoritative order lines must each deplete')

    const insufficientOrder = randomUUID()
    const insufficient = await createSaleLine(connection, { lodgeId, orderId: insufficientOrder, menuItemId, itemName: 'Recipe Meal', quantity: 3, outletId })
    assert.equal(insufficient.success, false)
    const rollbackCheck = await connection.query('select count(*)::int as orders from public.pos_orders where id = $1', [insufficientOrder])
    const rollbackMoves = await connection.query('select count(*)::int as moves from public.restaurant_recipe_stock_movements where order_id = $1', [insufficientOrder])
    assert.equal(rollbackCheck.rows[0].orders, 0, 'insufficient stock must roll back the order')
    assert.equal(rollbackMoves.rows[0].moves, 0, 'insufficient stock must roll back recipe movements')

    const nonPositiveOrder = randomUUID()
    const nonPositive = await createSaleLine(connection, { lodgeId, orderId: nonPositiveOrder, menuItemId, itemName: 'Recipe Meal', quantity: -1, outletId })
    assert.equal(nonPositive.success, true, nonPositive.error?.message)
    const nonPositiveMoves = await connection.query('select count(*)::int as moves from public.restaurant_recipe_stock_movements where order_id = $1', [nonPositiveOrder])
    assert.equal(nonPositiveMoves.rows[0].moves, 0)

    // A direct-stock line is explicitly linked to its inventory item and must
    // not be treated as a recipe line a second time.
    const directOrder = randomUUID()
    await connection.query('begin')
    await connection.query("insert into public.pos_orders(id, lodge_id, status, total, outlet_id, transaction_type) values ($1, $2, 'completed', 10, $3, 'sale')", [directOrder, lodgeId, outletId])
    await connection.query("insert into public.pos_order_items(id, lodge_id, order_id, menu_item_id, item_name, quantity, unit_price, subtotal, inventory_item_id) values ($1, $2, $3, $4, 'Direct', 1, 10, 10, $5)", [randomUUID(), lodgeId, directOrder, menuItemId, inventoryId])
    await connection.query('commit')
    const directMoves = await connection.query('select count(*)::int as moves from public.restaurant_recipe_stock_movements where order_id = $1', [directOrder])
    assert.equal(directMoves.rows[0].moves, 0)

    // Two transactions competing for the remaining five units: one succeeds
    // and the other observes the locked, reduced balance and rolls back.
    const a = client()
    const b = client()
    await Promise.all([a.connect(), b.connect()])
    await Promise.all([setActor(a, actorId, lodgeId), setActor(b, actorId, lodgeId)])
    const concurrent = await Promise.all([
      createSaleLine(a, { lodgeId, orderId: randomUUID(), menuItemId: concurrentMenuItemId, itemName: 'Concurrent Meal', quantity: 1, outletId }),
      createSaleLine(b, { lodgeId, orderId: randomUUID(), menuItemId: concurrentMenuItemId, itemName: 'Concurrent Meal', quantity: 1, outletId })
    ])
    await Promise.all([a.end(), b.end()])
    assert.equal(concurrent.filter((entry) => entry.success).length, 1)
    assert.equal(concurrent.filter((entry) => !entry.success).length, 1)
  } finally {
    await connection.query('delete from public.restaurant_recipe_stock_movements where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.inventory_movements where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.pos_order_items where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.pos_orders where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.restaurant_recipe_ingredients where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.restaurant_recipes where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.pos_menu_items where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.restaurant_stock_location_balances where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.restaurant_outlet_stock_locations where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.restaurant_stock_locations where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.inventory_items where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.outlets where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.users where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.query('delete from public.settings where lodge_id = $1', [lodgeId]).catch(() => {})
    await connection.end()
  }
})
