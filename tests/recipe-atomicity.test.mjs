import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('recipe depletion is triggered inside the order transaction and uses one authoritative helper', async () => {
  const sql = await read('supabase/migrations/20260805090000_pos_recipe_stock_depletion_server_atomic.sql')

  assert.match(sql, /restaurant_deplete_recipe_for_order_item\(p_order_item_id uuid\)/)
  assert.match(sql, /after insert on public\.pos_order_items/)
  assert.match(sql, /perform public\.restaurant_deplete_recipe_for_order_item\(new\.id\)/)
  assert.match(sql, /for update of ii/)
  assert.match(sql, /required\.required_quantity/)
  assert.match(sql, /sum\(\s*public\.restaurant_recipe_quantity_in_inventory_unit/i)
  assert.match(sql, /restaurant_apply_stock_location_balance/)
  assert.match(sql, /restaurant_recipe_stock_movements/)
  assert.match(sql, /inventory_movements/)
})

test('recipe depletion cannot treat direct-stock lines or client quantities as recipe authority', async () => {
  const sql = await read('supabase/migrations/20260805090000_pos_recipe_stock_depletion_server_atomic.sql')

  assert.match(sql, /v_line\.inventory_item_id is not null or coalesce\(v_line\.quantity, 0\) <= 0/)
  assert.match(sql, /v_line\.quantity/)
  assert.doesNotMatch(sql, /payload->>'quantity'/i)
  assert.match(sql, /replayed', v_count = 0/)
})

test('the reconciliation report remains manual review only and does not backfill with today’s recipe', async () => {
  const sql = await read('supabase/migrations/20260805090000_pos_recipe_stock_depletion_server_atomic.sql')

  const report = sql.slice(sql.indexOf('create or replace function public.get_pos_orders_missing_recipe_movements'))
  assert.match(report, /get_pos_orders_missing_recipe_movements/)
  assert.match(sql, /manual review/i)
  assert.doesNotMatch(report, /insert into public\.restaurant_recipe_stock_movements/)
})
