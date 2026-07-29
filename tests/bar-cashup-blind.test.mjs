import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync('supabase/migrations/20260729010000_blind_cashup_operator_preview.sql', 'utf8')
const myCashup = readFileSync('src/renderer/src/components/hospitality-pos/HposMyCashup.jsx', 'utf8')
const sharedCashup = readFileSync('src/renderer/src/components/hospitality-pos/HposSharedCashup.jsx', 'utf8')

test('cash-up preview redacts server expectations for the active cashier', () => {
  assert.match(migration, /v_role in \('cashier', 'bar', 'bartender', 'operator', 'waiter'\)/)
  assert.match(migration, /'blind', true/)
  assert.match(migration, /_get_pos_shift_cashup_preview_full_v1/)
  assert.match(migration, /grant execute on function public\.get_pos_shift_cashup_preview_v2/) // managers retain review access
})

test('cash-up submission server normalises to a physical cash count', () => {
  assert.match(migration, /new\.counted_by_method := coalesce\(new\.expected_by_method, '\{\}'::jsonb\)/)
  assert.match(migration, /Physical cash count cannot be negative/)
  assert.match(myCashup, /counted_by_method: \{ cash: count \}/)
  assert.match(sharedCashup, /counted_by_method: \{ cash: Number\(cash\) \}/)
})

test('operator cash-up screens do not render expected drawer or live variance', () => {
  assert.doesNotMatch(myCashup, /Expected cash to hand over/)
  assert.doesNotMatch(myCashup, /hpos-my-cashup-variance/)
  assert.doesNotMatch(myCashup, /getCashupSummary/)
  assert.doesNotMatch(sharedCashup, /Expected cash to hand over/)
  assert.doesNotMatch(sharedCashup, /expected_cash_drawer/)
})
