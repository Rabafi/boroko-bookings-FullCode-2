import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('Bar stock aging is an outlet-scoped authoritative read contract', () => {
  const migration = read('supabase/migrations/20260729130000_bar_stock_aging_read_model.sql')
  assert.match(migration, /get_bar_stock_aging/)
  assert.match(migration, /p_lodge_id uuid/)
  assert.match(migration, /p_outlet_id uuid default null/)
  assert.match(migration, /app_require_lodge_role\(/)
  assert.match(migration, /ii\.lodge_id = p_lodge_id/)
  assert.match(migration, /ii\.outlet_id is null or ii\.outlet_id = p_outlet_id/)
  assert.match(migration, /app_require_pos_outlet_access\(p_lodge_id, p_outlet_id\)/)
  assert.match(migration, /p_outlet_id is null and v_role in \('cashier', 'supervisor'\)/)
  assert.match(migration, /Outlet context is required for this operator/)
  assert.match(migration, /last_received_at/)
  assert.match(migration, /last_sold_at/)
  assert.match(migration, /age_bucket/)
  assert.match(migration, /grant execute on function public\.get_bar_stock_aging\(uuid, uuid\) to authenticated, service_role/)
  assert.doesNotMatch(migration, /delete\s+from|update\s+public\.inventory_items/i)
})

test('Desktop Bar stock page exposes server age and remains honest offline', () => {
  const domain = read('src/main/domains/inventory.js')
  const database = read('src/main/database.js')
  const main = read('src/main/index.js')
  const preload = read('src/preload/index.js')
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')

  assert.match(domain, /export async function getBarStockAging\(outletId = null\)/)
  assert.match(domain, /rpc\('get_bar_stock_aging'/)
  assert.match(domain, /Stock aging requires an online connection/)
  assert.match(database, /getBarStockAging,/)
  assert.match(main, /inventory:getBarStockAging/)
  assert.match(main, /requireCapability\('inventory\.view'\)/)
  assert.match(preload, /getBarStockAging: \(outletId\) => ipcRenderer\.invoke\('inventory:getBarStockAging'/)
  assert.match(stock, /getBarStockAging/)
  assert.match(stock, /allowedOutletIds/)
  assert.match(stock, /outlets\?\.getAll/)
  assert.match(stock, /Assigned outlet only/)
  assert.match(stock, /No assigned outlet/)
  assert.match(stock, /outlet_id: outletId \|\| null/)
  assert.match(stock, /getBarStockAging\?\.\(nextOutletId \|\| null\)/)
  assert.doesNotMatch(stock, /getBarStockAging\?\.\(\)/)
  assert.match(stock, /Stock age/)
  assert.match(stock, /Current on-hand quantities remain visible/)
  assert.match(stock, /last_sold_at/)
})
