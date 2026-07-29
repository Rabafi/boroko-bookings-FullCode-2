import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync(new URL('../supabase/migrations/20260720030000_restaurant_accounting_pos_event_posting.sql', import.meta.url), 'utf8')

test('posts one immutable journal per POS order event', () => {
  assert.match(sql, /create or replace function public\.post_pos_order_to_gl/)
  assert.match(sql, /where id = p_order_id and lodge_id = p_lodge_id/)
  assert.match(sql, /concat\('pos-order:', v_order\.id::text\)/)
  assert.doesNotMatch(sql, /group by[^;]*business_date/i)
})

test('requires completed sale or return state', () => {
  assert.match(sql, /status not in \('completed', 'settled'\)/)
  assert.match(sql, /transaction_type, 'sale'\) not in \('sale', 'return'\)/)
  assert.match(sql, /for share/)
})

test('reconciles persisted order, item, and tender totals', () => {
  assert.match(sql, /Persisted POS totals do not reconcile/)
  assert.match(sql, /POS item gross does not reconcile to order gross/)
  assert.match(sql, /POS tender breakdown does not reconcile to order total/)
})

test('requires explicit category and tender mappings', () => {
  assert.match(sql, /mapping_type in \('category', 'tender', 'discount', 'tax', 'tips'\)/)
  assert.match(sql, /No active GL revenue mapping for POS category/)
  assert.match(sql, /No active GL tender mapping for/)
  assert.match(sql, /No active default GL mapping for/)
})

test('maps discounts, tax, tips, and return direction explicitly', () => {
  assert.match(sql, /values \('discount', v_discount\), \('tax', v_tax\), \('tips', v_tips\)/)
  assert.match(sql, /when v_category\.mapping_type = 'discount' and not v_is_return then v_category\.amount/)
  assert.match(sql, /when v_category\.mapping_type <> 'discount' and v_is_return then v_category\.amount/)
})

test('validates mapping account types and lodge scope', () => {
  assert.match(sql, /a\.lodge_id = p_lodge_id and a\.is_active and a\.account_type = 'revenue'/)
  assert.match(sql, /a\.lodge_id = p_lodge_id and a\.is_active and a\.account_type = 'asset'/)
  assert.match(sql, /Tax and tips mappings require liability accounts/)
})

test('keeps POS posting and mapping service-role only', () => {
  assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/i)
  assert.match(sql, /POS GL rebuild restored operator privileges prematurely/)
  assert.match(sql, /revoke all on table public\.restaurant_pos_gl_mappings from public, anon, authenticated/)
})
