import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync(
  new URL('../supabase/migrations/20260720010000_restaurant_accounting_ledger_foundation.sql', import.meta.url),
  'utf8'
)

test('defines separate accounting and payroll capabilities', () => {
  for (const capability of [
    'accounting.read', 'accounting.manage', 'accounting.ap_pay',
    'accounting.bank_approve', 'accounting.tax_file',
    'accounting.payroll_view', 'accounting.payroll_manage'
  ]) {
    assert.ok(sql.includes(`when '${capability}'`), `missing ${capability}`)
  }
  assert.match(sql, /u\.lodge_id = p_lodge_id/)
  assert.match(sql, /u\.capability_overrides/)
})

test('keeps private authorization helpers operator-inaccessible', () => {
  assert.match(sql, /revoke all on function public\._restaurant_actor_has_capability\(uuid, text\)[\s\S]*from public, anon, authenticated/)
  assert.match(sql, /revoke all on function public\._restaurant_require_capability\(uuid, text\)[\s\S]*from public, anon, authenticated/)
})

test('makes posted journal headers and lines immutable', () => {
  assert.match(sql, /before update or delete on public\.restaurant_journal_entries/)
  assert.match(sql, /before update or delete on public\.restaurant_journal_lines/)
  assert.match(sql, /create a reversal journal/)
})

test('requires stable posting keys and payload hashes', () => {
  assert.match(sql, /restaurant_journal_entries_posting_key_uidx/)
  assert.match(sql, /posting_key is not null/)
  assert.match(sql, /payload_hash/)
  assert.match(sql, /Posting key was already used for a different journal/)
})

test('validates balanced one-sided lines and lodge-scoped active accounts', () => {
  assert.match(sql, /A journal requires at least two lines/)
  assert.match(sql, /one positive debit or credit/)
  assert.match(sql, /a\.lodge_id = p_lodge_id/)
  assert.match(sql, /and a\.is_active/)
  assert.match(sql, /Journal must balance to a non-zero amount/)
})

test('records authoritative journal audit evidence', () => {
  assert.match(sql, /insert into public\.restaurant_financial_audit_log/)
  assert.match(sql, /actor_user_id, new_data, metadata/)
  assert.match(sql, /'posting_key', p_posting_key/)
  assert.match(sql, /'payload_hash', v_hash/)
})

test('implements reversal journals instead of edits', () => {
  assert.match(sql, /create or replace function public\.reverse_restaurant_journal_entry/)
  assert.match(sql, /'debit', l\.credit/)
  assert.match(sql, /'credit', l\.debit/)
  assert.match(sql, /p_reversal_of/)
  assert.match(sql, /restaurant_journal_entries_reversal_uidx/)
})

test('restores no authenticated execution during foundation deployment', () => {
  assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/i)
  assert.match(sql, /grant execute on function public\.create_restaurant_journal_entry[\s\S]*to service_role/)
  assert.match(sql, /grant execute on function public\.reverse_restaurant_journal_entry[\s\S]*to service_role/)
})
