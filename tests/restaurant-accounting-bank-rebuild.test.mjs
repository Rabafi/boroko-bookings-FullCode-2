import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const baseSql = fs.readFileSync(new URL('../supabase/migrations/20260807300000_bank_evidence_lock_and_packet_export.sql', import.meta.url), 'utf8')
const legacySql = fs.readFileSync(new URL('../supabase/migrations/20260720050000_restaurant_accounting_bank_rebuild.sql', import.meta.url), 'utf8')
const sql = fs.readFileSync(new URL('../supabase/migrations/20260807470000_bank_reconciliation_semantics.sql', import.meta.url), 'utf8')
const periodCloseSql = fs.readFileSync(new URL('../supabase/migrations/20260807180000_typed_mappings_and_period_close.sql', import.meta.url), 'utf8')
const lockdownSql = fs.readFileSync(new URL('../supabase/migrations/20260807420000_accounting_no_ship_grant_lockdown.sql', import.meta.url), 'utf8')

test('preserves immutable imported statement evidence and hashes', () => {
  assert.match(baseSql, /raw_payload/)
  assert.match(baseSql, /payload_hash/)
  assert.match(baseSql, /statement_import_id/)
  assert.match(legacySql, /Imported bank statement evidence is immutable/)
  assert.match(legacySql, /Imported bank transaction evidence is immutable/)
  assert.match(legacySql, /Statement idempotency key conflicts with different evidence/)
  assert.match(sql, /opening_balance numeric/)
  assert.match(sql, /closing_balance numeric/)
  assert.match(sql, /balance_policy text/)
})

test('normalizes debit and credit with signed_amount = credit - debit', () => {
  assert.match(sql, /exactly one non-negative debit or credit amount/)
  assert.match(sql, /new\.signed_amount:=round\(coalesce\(new\.credit,0\)-coalesce\(new\.debit,0\),2\)/)
  assert.match(sql, /previous_balance \+ credit - debit/)
  assert.match(sql, /every_row_balance_after/)
})

test('imports explicit opening/closing evidence and validates running balances', () => {
  assert.match(sql, /import_bank_statement_v3/)
  assert.match(sql, /v_after:=nullif\(v_row->>'balance_after',''\)::numeric/)
  assert.match(sql, /v_prev\+v_credit-v_debit/)
  assert.match(sql, /v_prev-p_closing_balance/)
  assert.match(sql, /payload_hash/)
})

test('uses allocation matching with independent approval and locks', () => {
  assert.match(sql, /restaurant_bank_match_allocations/)
  assert.match(sql, /propose_bank_match_allocations_v1/)
  assert.match(sql, /review_bank_match_allocation_v1/)
  assert.match(sql, /where id=p_bank_transaction_id and lodge_id=p_lodge_id for update/)
  assert.match(sql, /The proposer cannot approve the same bank allocation/)
  assert.match(sql, /Bank row is overallocated/)
  assert.match(sql, /Journal amount is overallocated/)
})

test('retains immutable packet, exception and adjustment evidence', () => {
  assert.match(legacySql, /set_bank_transaction_exception/)
  assert.match(legacySql, /Exception reason is required/)
  assert.match(baseSql, /reconciled_entry_id is not null or exception_reason is not null/)
  assert.match(baseSql, /restaurant_reconciliation_adjustments/)
  assert.match(legacySql, /Adjustment requires reason and a lodge journal affecting this bank account/)
})

test('keeps bank reconciliation independent from period close', () => {
  assert.match(baseSql, /period_lock_created.*false/)
  assert.doesNotMatch(baseSql, /insert into public\.restaurant_accounting_period_locks/)
  assert.match(periodCloseSql, /prepare_restaurant_period_close/)
  assert.match(periodCloseSql, /approve_restaurant_period_close/)
  assert.match(periodCloseSql, /reopen_restaurant_period_close/)
  assert.match(periodCloseSql, /restaurant_block_closed_accounting_period/)
})

test('keeps all Accounting bank contracts in the no-ship lockdown', () => {
  for (const name of ['import_bank_statement_v2', 'propose_bank_matches_v2', 'review_bank_match_v2', 'create_bank_reconciliation_v2', 'complete_bank_reconciliation_v2', 'import_bank_statement_v3', 'propose_bank_match_allocations_v1', 'review_bank_match_allocation_v1']) assert.match(lockdownSql + sql, new RegExp(name))
  assert.match(lockdownSql, /revoke all on function/i)
  assert.match(lockdownSql, /to service_role/i)
})
