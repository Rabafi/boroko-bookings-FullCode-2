import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20260710180000_restaurant_sellability_controls.sql')
const domain = read('src/main/domains/pos.js')
const preload = read('src/preload/index.js')
const main = read('src/main/index.js')
const ui = read('src/renderer/src/components/restaurant/RestaurantCommercialControl.jsx')

test('sellability controls are server-authoritative and restaurant scoped', () => {
  for (const table of ['restaurant_settlement_reconciliations', 'restaurant_reservation_deposits', 'restaurant_customer_feedback']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'))
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  }
  for (const fn of ['record_restaurant_settlement', 'get_restaurant_settlements', 'record_restaurant_reservation_deposit', 'record_restaurant_feedback']) assert.match(migration, new RegExp(`function public\\.${fn}`, 'i'))
  assert.match(migration, /app_require_restaurant_lodge/)
  assert.match(migration, /idempotency key was already used with a different payload/i)
})

test('desktop contract exposes authoritative commercial controls', () => {
  for (const fn of ['recordRestaurantSettlement', 'getRestaurantSettlements', 'recordRestaurantReservationDeposit', 'recordRestaurantFeedback']) assert.match(domain, new RegExp(`export async function ${fn}`))
  assert.match(domain, /Settlement reconciliation requires an online connection/)
  assert.match(domain, /Reservation deposits require an online connection/)
  for (const ipc of ['recordSettlement', 'getSettlements', 'recordReservationDeposit', 'recordFeedback']) {
    assert.match(preload, new RegExp(`pos:${ipc}`))
    assert.match(main, new RegExp(`pos:${ipc}`))
  }
})

test('commercial control exposes settlement, deposits, and feedback', () => {
  for (const label of ['Settlement reconciliation', 'Reservation deposit', 'Customer feedback']) assert.match(ui, new RegExp(label))
  assert.match(ui, /recordSettlement/)
  assert.match(ui, /recordReservationDeposit/)
  assert.match(ui, /recordFeedback/)
})
