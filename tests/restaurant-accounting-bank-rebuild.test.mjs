import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync(new URL('../supabase/migrations/20260720050000_restaurant_accounting_bank_rebuild.sql',import.meta.url),'utf8')

test('preserves immutable imported statement evidence and hashes',()=>{
 assert.match(sql,/raw_payload jsonb/)
 assert.match(sql,/payload_hash text/)
 assert.match(sql,/statement_import_id uuid references/)
 assert.match(sql,/Imported bank statement evidence is immutable/)
 assert.match(sql,/Imported bank transaction evidence is immutable/)
 assert.match(sql,/Statement idempotency key conflicts with different evidence/)
})
test('validates statement rows and fingerprints server side',()=>{
 assert.match(sql,/one positive debit or credit/)
 assert.match(sql,/v_hash:=encode\(digest/)
 assert.match(sql,/v_fp:=encode\(digest/)
 assert.match(sql,/statement_import_id\)/)
})
test('uses valid direct date subtraction for matching',()=>{
 assert.match(sql,/abs\(bt\.transaction_date-e\.entry_date\)<=3/)
 assert.doesNotMatch(sql,/extract\(day from bt\.transaction_date - e\.entry_date\)/)
})
test('uses durable proposals with independent approval',()=>{
 assert.match(sql,/create or replace function public\.propose_bank_matches_v2/)
 assert.match(sql,/create or replace function public\.review_bank_match_v2/)
 assert.match(sql,/accounting\.bank_approve/)
 assert.match(sql,/Match proposer cannot approve the same match/)
})
test('requires documented exceptions or approved matches',()=>{
 assert.match(sql,/set_bank_transaction_exception/)
 assert.match(sql,/Exception reason is required/)
 assert.match(sql,/reconciled_entry_id is not null or exception_reason is not null/)
})
test('requires journal-backed reconciliation adjustments',()=>{
 assert.match(sql,/restaurant_reconciliation_adjustments/)
 assert.match(sql,/Adjustment requires reason and a lodge journal affecting this bank account/)
})
test('recomputes zero difference and enforces preparer approver separation',()=>{
 assert.match(sql,/Reconciliation preparer cannot complete it/)
 assert.match(sql,/v_r\.statement_balance-v_book/)
 assert.match(sql,/Reconciliation difference must be zero at completion/)
 assert.match(sql,/Earlier unmatched bank transactions prevent completion/)
})
test('locks completed periods against late journals',()=>{
 assert.match(sql,/restaurant_accounting_period_locks/)
 assert.match(sql,/restaurant_journal_period_lock/)
 assert.match(sql,/new\.entry_date<=locked_through/)
 assert.match(sql,/values\(p_lodge_id,v_r\.reconciliation_date,'bank_reconciliation'/)
})
test('keeps all rebuilt bank contracts service-role only',()=>{
 assert.doesNotMatch(sql,/grant execute[\s\S]*to authenticated/i)
 for(const n of ['import_bank_statement_v2','propose_bank_matches_v2','review_bank_match_v2','create_bank_reconciliation_v2','complete_bank_reconciliation_v2'])assert.match(sql,new RegExp(`revoke all on function public\\.${n}`))
})
