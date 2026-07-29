import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync(new URL('../supabase/migrations/20260720040000_restaurant_accounting_ap_atomic_rebuild.sql',import.meta.url),'utf8')

test('creates bill header and validated lines atomically with server totals',()=>{
 assert.match(sql,/create or replace function public\.create_restaurant_bill_v2/)
 assert.match(sql,/v_line := round\(v_qty\*v_unit,2\)/)
 assert.match(sql,/v_subtotal\+v_tax_total/)
 assert.match(sql,/Bill line account must be an active lodge asset or expense/)
})
test('enforces lodge supplier invoice uniqueness and payload-safe retries',()=>{
 assert.match(sql,/restaurant_bills_supplier_invoice_uidx/)
 assert.match(sql,/restaurant_bills_creation_idempotency_uidx/)
 assert.match(sql,/creation_payload_hash is distinct from v_hash/)
 assert.match(sql,/Bill idempotency key conflicts with a different payload/)
})
test('locks bill state transitions and uses maker checker approval',()=>{
 assert.match(sql,/where id=p_bill_id and lodge_id=p_lodge_id for update/)
 assert.match(sql,/Only a draft bill can be submitted/)
 assert.match(sql,/Only submitted bills can be approved/)
 assert.match(sql,/Bill creator cannot approve the same bill/)
})
test('posts an accrual journal on approval',()=>{
 assert.match(sql,/expense_account_id,'debit',amount/)
 assert.match(sql,/input_tax_account_id,'debit',v_bill\.tax_amount/)
 assert.match(sql,/payable_account_id,'debit',0,'credit',v_bill\.total/)
 assert.match(sql,/accrual_journal_entry_id=v_entry/)
})
test('locks and prevents duplicate or excessive bill payments',()=>{
 assert.match(sql,/create or replace function public\.record_restaurant_bill_payment_v2/)
 assert.match(sql,/accounting\.ap_pay/)
 assert.match(sql,/Payment idempotency key conflicts with a different payload/)
 assert.match(sql,/Payment exceeds outstanding balance/)
})
test('posts payment journal and records its immutable link',()=>{
 assert.match(sql,/payable_account_id,'debit',round\(p_amount,2\)/)
 assert.match(sql,/p_payment_account_id,'debit',0,'credit',round\(p_amount,2\)/)
 assert.match(sql,/journal_entry_id,idempotency_key/)
 assert.match(sql,/ap_payment\.recorded/)
})
test('keeps rebuilt AP contracts service-role only',()=>{
 assert.doesNotMatch(sql,/grant execute[\s\S]*to authenticated/i)
 for(const n of ['create_restaurant_bill_v2','submit_restaurant_bill','approve_restaurant_bill','record_restaurant_bill_payment_v2'])assert.match(sql,new RegExp(`revoke all on function public\\.${n}`))
})
