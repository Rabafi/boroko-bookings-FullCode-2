import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Manager POS reporting is calculated in read-only database RPCs', async () => {
  const migration = await read('supabase/migrations/20260618220000_manager_pwa_pos_reporting.sql')

  assert.match(migration, /create or replace function public\.get_manager_pos_snapshot/i)
  assert.match(migration, /create or replace function public\.get_manager_pos_transactions/i)
  assert.match(migration, /public\.app_require_lodge_role/)
  assert.match(migration, /array\['manager', 'admin', 'super_admin'\]/)
  assert.match(migration, /po\.status in \('completed', 'settled'\)/)
  assert.match(migration, /'returns_total'/)
  assert.match(migration, /'by_payment'/)
  assert.match(migration, /'by_outlet'/)
  assert.match(migration, /'items'/)
  assert.doesNotMatch(migration, /\b(update|insert into|delete from)\s+public\.pos_orders/i)
})

test('Manager PWA exposes POS snapshot and transaction history', async () => {
  const api = await read('manager-pwa/src/lib/api.js')
  const page = await read('manager-pwa/src/pages/PosSales.jsx')
  const app = await read('manager-pwa/src/App.jsx')
  const menu = await read('manager-pwa/src/pages/More.jsx')
  const dashboard = await read('manager-pwa/src/pages/Dashboard.jsx')

  assert.match(api, /getManagerPosSnapshot/)
  assert.match(api, /getManagerPosTransactions/)
  assert.match(api, /assertCapability\('pos\.reports'\)/)
  assert.match(page, /Live sales snapshot and transaction history/)
  assert.match(page, /Transaction history/)
  assert.match(page, /Payment methods/)
  assert.match(page, /Sales by outlet/)
  assert.match(page, /Top items/)
  assert.match(app, /path="\/pos"/)
  assert.match(app, /capability="pos\.reports"/)
  assert.match(menu, /to: '\/pos'/)
  assert.match(dashboard, /to="\/pos"/)
})
