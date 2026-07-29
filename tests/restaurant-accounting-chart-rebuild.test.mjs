import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync(new URL('../supabase/migrations/20260720020000_restaurant_accounting_chart_rebuild.sql', import.meta.url), 'utf8')

test('derives account balances exclusively from posted journal lines', () => {
  assert.match(sql, /sum\(l\.debit\)/)
  assert.match(sql, /sum\(l\.credit\)/)
  assert.match(sql, /and e\.is_posted/)
  assert.doesNotMatch(sql, /'ledger_balance',[\s\S]{0,300}opening_balance/)
})

test('rejects scalar opening balances on account create and update', () => {
  assert.match(sql, /Opening balances must be posted with post_restaurant_opening_balance/)
  assert.match(sql, /Opening balances are immutable ledger postings, not account fields/)
})

test('posts dated balanced opening journals against explicit equity', () => {
  assert.match(sql, /create or replace function public\.post_restaurant_opening_balance/)
  assert.match(sql, /account_type = 'equity'/)
  assert.match(sql, /'opening_balance', v_account\.id/)
  assert.match(sql, /public\._restaurant_post_journal/)
  assert.match(sql, /p_idempotency_key/)
})

test('validates account parent and opening accounts within the lodge', () => {
  assert.match(sql, /id = p_parent_id and lodge_id = p_lodge_id/)
  assert.match(sql, /id = p_account_id and lodge_id = p_lodge_id and is_active/)
  assert.match(sql, /id = p_equity_account_id and lodge_id = p_lodge_id and is_active/)
})

test('provides explicit cash-flow classifications', () => {
  assert.match(sql, /cash_flow_classification in \('cash', 'operating', 'investing', 'financing'\)/)
  for (const value of ['cash', 'operating', 'investing', 'financing']) {
    assert.ok(sql.includes(`'${value}'`))
  }
})

test('keeps all rebuilt chart RPCs service-role only', () => {
  assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/i)
  for (const name of ['get_restaurant_accounts', 'create_restaurant_account', 'update_restaurant_account', 'delete_restaurant_account', 'post_restaurant_opening_balance', 'seed_restaurant_default_accounts']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}`))
  }
})
