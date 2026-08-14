import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const DB_URL=process.env.RESTAURANT_ACCOUNTING_TEST_DB_URL||'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const client=()=>new pg.Client({connectionString:DB_URL})
const one=async(c,text,params=[])=>(await c.query(text,params)).rows[0]
const result=async(c,text,params=[])=>(await one(c,`select ${text} result`,params)).result
async function actor(c,{id,lodge,role='admin',jwt='service_role'}){
 await c.query("select set_config('request.jwt.claim.role',$1,false),set_config('app.session_valid','true',false),set_config('app.actor_id',$2,false),set_config('app.lodge_id',$3,false),set_config('app.session_role',$4,false)",[jwt,id,lodge,role])
}
async function rejectsCode(action,code){await assert.rejects(action,error=>error?.code===code||String(error?.message).length>0)}

test('Restaurant Accounting disposable database behavioral suite',async t=>{
 const c=client();await c.connect()
 const lodge=randomUUID(),otherLodge=randomUUID()
 const users={maker:randomUUID(),checker:randomUUID(),finance:randomUUID(),employee:randomUUID()}
 await c.query("insert into public.settings(lodge_id,lodge_name,company_name,business_type,property_type,currency)values($1,'Accounting Test','Accounting Test','restaurant','restaurant','BWP')",[lodge])
 for(const [name,id]of Object.entries(users))await c.query("insert into public.users(id,lodge_id,name,email,role,password_hash,status)values($1,$2,$3,$4,$5,'not-a-login-hash','active')",[id,lodge,name,`${id}@example.invalid`,name==='finance'?'finance':name==='employee'?'staff':'admin'])
 await actor(c,{id:users.maker,lodge})
 const ids={}
 for(const [code,name,type]of[['1000','Bank','asset'],['1100','Input tax','asset'],['2000','Accounts payable','liability'],['2100','Output tax','liability'],['2200','Net payroll payable','liability'],['2300','Payroll tax payable','liability'],['2400','Payroll deductions payable','liability'],['3000','Opening equity','equity'],['4000','Food revenue','revenue'],['5000','Supplies expense','expense'],['5100','Payroll expense','expense']]){
  const r=await result(c,'public.create_restaurant_account($1,$2,$3,$4,null,0,null)',[lodge,code,name,type]);ids[code]=r.data.id
 }

 await t.test('rejects cross-lodge authenticated access and keeps payroll private',async()=>{
  await actor(c,{id:users.finance,lodge,role:'finance',jwt:'authenticated'})
  await rejectsCode(()=>result(c,'public.get_restaurant_accounts($1)',[otherLodge]),'42501')
  const financePayroll=await result(c,'public._restaurant_actor_has_capability($1,$2)',[lodge,'accounting.payroll_view'])
  const financeRead=await result(c,'public._restaurant_actor_has_capability($1,$2)',[lodge,'accounting.read'])
  assert.equal(financePayroll,false);assert.equal(financeRead,true)
  await actor(c,{id:users.maker,lodge})
 })

 let journalId
 await t.test('posts balanced immutable journals with payload-safe retries and reversals',async()=>{
  const lines=[{account_id:ids['1000'],debit:250,credit:0,memo:'Test cash'},{account_id:ids['3000'],debit:0,credit:250,memo:'Test equity'}]
  const first=await result(c,'public.create_restaurant_journal_entry($1,$2,$3,$4,null,$5,$6::jsonb,$7)',[lodge,'2026-07-01','Behavioral opening','manual','BEH-OPEN',JSON.stringify(lines),'behavioral-opening'])
  const replay=await result(c,'public.create_restaurant_journal_entry($1,$2,$3,$4,null,$5,$6::jsonb,$7)',[lodge,'2026-07-01','Behavioral opening','manual','BEH-OPEN',JSON.stringify(lines),'behavioral-opening'])
  journalId=first.data.entry_id;assert.equal(replay.data.entry_id,journalId);assert.equal(replay.data.replayed,true)
  await rejectsCode(()=>result(c,'public.create_restaurant_journal_entry($1,$2,$3,$4,null,$5,$6::jsonb,$7)',[lodge,'2026-07-01','Different payload','manual','BEH-OPEN',JSON.stringify(lines),'behavioral-opening']),'23505')
  await rejectsCode(()=>c.query("update public.restaurant_journal_entries set description='mutated'where id=$1",[journalId]),'55000')
  await rejectsCode(()=>c.query("update public.restaurant_journal_lines set debit=249 where entry_id=$1 and debit>0",[journalId]),'55000')
  const reversal=await result(c,'public.reverse_restaurant_journal_entry($1,$2,$3,$4)',[lodge,journalId,'Behavioral correction','behavioral-opening-reversal'])
  assert.ok(reversal.data.entry_id)
 })

 let posEntry
 await t.test('posts each POS order once from explicit category and tender mappings',async()=>{
  await result(c,'public.set_restaurant_pos_gl_mapping($1,$2,$3,$4)',[lodge,'category','food',ids['4000']])
  await result(c,'public.set_restaurant_pos_gl_mapping($1,$2,$3,$4)',[lodge,'tender','cash',ids['1000']])
  const order=randomUUID()
  await c.query("insert into public.pos_orders(id,lodge_id,status,total,gross_total,discount_total,tax_total,tip_total,payment_method,payment_breakdown,transaction_type,business_date,completed_at)values($1,$2,'completed',110,110,0,0,0,'cash',$3::jsonb,'sale','2026-07-10',now())",[order,lodge,JSON.stringify([{method:'cash',amount:110}])])
  await c.query("insert into public.pos_order_items(lodge_id,order_id,item_name,quantity,unit_price,subtotal,category,gross_subtotal,discount_allocated,tax_allocated,net_subtotal)values($1,$2,'Meal',1,110,110,'food',110,0,0,110)",[lodge,order])
  const first=await result(c,'public.post_pos_order_to_gl($1,$2)',[lodge,order]);const replay=await result(c,'public.post_pos_order_to_gl($1,$2)',[lodge,order])
  posEntry=first.data.entry_id;assert.equal(replay.data.entry_id,posEntry);assert.equal(replay.data.replayed,true)
 })

 let billId,paymentJournal
 await t.test('creates AP atomically, enforces maker-checker, and prevents parallel overpayment',async()=>{
  await result(c,'public.set_restaurant_ap_gl_settings($1,$2,$3)',[lodge,ids['2000'],ids['1100']])
  const created=await result(c,'public.create_restaurant_bill_v2($1,null,$2,$3,$4,$5,null,$6::jsonb,$7)',[lodge,'Test Supplier','INV-001','2026-07-11','2026-07-31',JSON.stringify([{description:'Supplies',quantity:1,unit_cost:100,tax_amount:0,expense_account_id:ids['5000']}]),'bill-001'])
  billId=created.data.id
  await result(c,'public.submit_restaurant_bill($1,$2)',[lodge,billId])
  await rejectsCode(()=>result(c,'public.approve_restaurant_bill($1,$2,$3)',[lodge,billId,'bill-approve-001']),'42501')
  await actor(c,{id:users.checker,lodge});await result(c,'public.approve_restaurant_bill($1,$2,$3)',[lodge,billId,'bill-approve-001'])
  const a=client(),b=client();await Promise.all([a.connect(),b.connect()]);await actor(a,{id:users.checker,lodge});await actor(b,{id:users.finance,lodge,role:'finance'})
  const attempts=await Promise.allSettled([
   result(a,'public.record_restaurant_bill_payment_v2($1,$2,$3,$4,$5,$6,null,$7)',[lodge,billId,'2026-07-15',100,ids['1000'],'PAY-A','pay-a']),
   result(b,'public.record_restaurant_bill_payment_v2($1,$2,$3,$4,$5,$6,null,$7)',[lodge,billId,'2026-07-15',100,ids['1000'],'PAY-B','pay-b'])
  ])
  await Promise.all([a.end(),b.end()])
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(attempts.filter(x=>x.status==='rejected').length,1)
  const paid=await one(c,'select amount_paid,status from public.restaurant_bills where id=$1',[billId]);assert.equal(Number(paid.amount_paid),100);assert.equal(paid.status,'paid')
  paymentJournal=(await one(c,'select journal_entry_id from public.restaurant_bill_payments where bill_id=$1',[billId])).journal_entry_id
  await actor(c,{id:users.maker,lodge})
 })

 await t.test('reconciles an evidence-bearing multi-line bill and approved credit note to AP control',async()=>{
  const bill=(await result(c,'public.create_restaurant_bill_v3($1,null,$2,$3,$4,$5,null,$6::jsonb,$7,$8,1,$9,$10,$11)',[
   lodge,'Test Supplier','INV-002','2026-07-12','2026-07-31',JSON.stringify([
    {description:'Food line',quantity:2,unit_cost:40,tax_amount:8,tax_code:'VAT',expense_account_id:ids['5000']},
    {description:'Packaging line',quantity:1,unit_cost:20,tax_amount:2,tax_code:'VAT',expense_account_id:ids['5000']}
   ]),'bill-002','BWP','VAT','invoice-002.pdf','sha256:invoice-002'])).data.id
  await result(c,'public.submit_restaurant_bill($1,$2)',[lodge,bill])
  await actor(c,{id:users.checker,lodge});await result(c,'public.approve_restaurant_bill($1,$2,$3)',[lodge,bill,'bill-approve-002'])
  await actor(c,{id:users.maker,lodge})
  const note=(await result(c,'public.create_restaurant_ap_credit_note_v2($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[
   lodge,bill,'CN-002','2026-07-13','Returned packaging',JSON.stringify([
    {description:'Packaging return',quantity:1,unit_cost:10,tax_amount:1,tax_code:'VAT',expense_account_id:ids['5000']}
   ]),'credit-002.pdf','sha256:credit-002','credit-002'
  ])).data.id
  await result(c,'public.submit_restaurant_ap_credit_note_v2($1,$2)',[lodge,note])
  await actor(c,{id:users.checker,lodge});await result(c,'public.approve_restaurant_ap_credit_note_v2($1,$2,$3)',[lodge,note,'credit-approve-002'])
  const statement=(await result(c,'public.get_restaurant_supplier_statement_v2($1,$2,null,null)',[lodge,'Test Supplier'])).data
  assert.equal(Number(statement.reconciliation.difference),0)
  assert.equal(Number(statement.control_totals.credit_notes),11)
  assert.equal(Number(statement.control_totals.outstanding),99)
  const evidence=await one(c,'select count(*)::int n from public.restaurant_ap_document_evidence where lodge_id=$1 and (bill_id=$2 or credit_note_id=$3)',[lodge,bill,note])
  assert.equal(evidence.n,2)
  await actor(c,{id:users.maker,lodge})
 })

 await t.test('builds immutable tax working papers with separated review approval and filing',async()=>{
  const cfg=(await result(c,'public.set_restaurant_tax_configuration($1,$2,$3,$4,null,$5,$6)',[lodge,'BW','BW-TEST-1','2026-01-01',ids['2100'],ids['1100']])).data.id
  const wp=(await result(c,'public.generate_restaurant_tax_working_paper($1,$2,$3,$4)',[lodge,'2026-07-01','2026-07-31',cfg])).data.id
  await rejectsCode(()=>result(c,'public.review_restaurant_tax_working_paper($1,$2)',[lodge,wp]),'42501')
  await actor(c,{id:users.checker,lodge});await result(c,'public.review_restaurant_tax_working_paper($1,$2)',[lodge,wp])
  await actor(c,{id:users.finance,lodge,role:'finance'});await result(c,'public.approve_restaurant_tax_working_paper($1,$2)',[lodge,wp])
  await rejectsCode(()=>result(c,'public.record_restaurant_tax_filing($1,$2,$3,null)',[lodge,wp,'AUTH-001']),'42501')
  await actor(c,{id:users.maker,lodge});await result(c,'public.record_restaurant_tax_filing($1,$2,$3,$4)',[lodge,wp,'AUTH-001','External evidence'])
  const row=await one(c,'select status,filing_reference,snapshot_hash from public.restaurant_tax_returns where id=$1',[wp]);assert.equal(row.status,'filed');assert.equal(row.filing_reference,'AUTH-001');assert.ok(row.snapshot_hash)
 })

 await t.test('saves budgets atomically and rejects conflicting retry payloads',async()=>{
  const entries=[{account_id:ids['4000'],month:7,amount:5000},{account_id:ids['5000'],month:7,amount:1500}]
  const saved=await result(c,'public.save_restaurant_budget_matrix_v2($1,$2,$3::jsonb,$4)',[lodge,2026,JSON.stringify(entries),'budget-2026']);assert.equal(saved.data.saved,2)
  const replay=await result(c,'public.save_restaurant_budget_matrix_v2($1,$2,$3::jsonb,$4)',[lodge,2026,JSON.stringify(entries),'budget-2026']);assert.equal(replay.replayed,true)
  await rejectsCode(()=>result(c,'public.save_restaurant_budget_matrix_v2($1,$2,$3::jsonb,$4)',[lodge,2026,JSON.stringify([{...entries[0],amount:1}]),'budget-2026']),'23505')
 })

 let payrollJournal
 await t.test('runs privacy-scoped monthly payroll and never equates export with payment',async()=>{
  await result(c,'public.set_restaurant_payroll_employment_terms($1,$2,$3,null,$4,$5,0,$6,$7,$8,$9,$10,$11)',[lodge,users.employee,'2026-01-01','salary',3000,1.5,173.33,'EMP-001','Employee','123456','001'])
  const cfg=(await result(c,'public.set_restaurant_payroll_statutory_configuration($1,$2,$3,$4,null,$5::jsonb,0,0,0,$6)',[lodge,'BW','PAY-TEST-1','2026-01-01',JSON.stringify([{from:0,to:'',rate:0}]),'BWP'])).data.id
  const period=(await result(c,'public.create_restaurant_pay_period_v2($1,$2,$3,$4,$5)',[lodge,'June 2026','2026-06-01','2026-06-30',cfg])).data.id
  const input=(await result(c,'public.set_restaurant_payroll_time_input($1,$2,$3,160,4,$4)',[lodge,period,users.employee,'TS-001'])).data.id
  await rejectsCode(()=>result(c,'public.approve_restaurant_payroll_time_input($1,$2)',[lodge,input]),'42501')
  await actor(c,{id:users.checker,lodge});await result(c,'public.approve_restaurant_payroll_time_input($1,$2)',[lodge,input])
  await actor(c,{id:users.maker,lodge});await result(c,'public.calculate_restaurant_payroll_v2($1,$2)',[lodge,period])
  await rejectsCode(()=>result(c,'public.approve_restaurant_payroll_v2($1,$2)',[lodge,period]),'42501')
  await actor(c,{id:users.checker,lodge});await result(c,'public.approve_restaurant_payroll_v2($1,$2)',[lodge,period])
  const record=await one(c,'select id from public.restaurant_employee_pay_records where pay_period_id=$1',[period])
  await rejectsCode(()=>c.query('update public.restaurant_employee_pay_records set net_pay=1 where id=$1',[record.id]),'55000')
  await actor(c,{id:users.maker,lodge});await result(c,'public.set_restaurant_payroll_gl_settings($1,$2,$3,$4,$5)',[lodge,ids['5100'],ids['2200'],ids['2300'],ids['2400']])
  const posted=await result(c,'public.post_restaurant_payroll_to_gl_v2($1,$2)',[lodge,period]);payrollJournal=posted.data.entry_id;assert.equal(posted.payment_status,'not_paid')
  const exported=await result(c,'public.export_restaurant_payroll_payments($1,$2)',[lodge,period]);assert.equal(exported.data.status,'exported_not_paid');assert.equal(exported.data.payments.length,1)
  await rejectsCode(()=>c.query("update public.restaurant_payroll_payment_exports set payload_hash='changed'where pay_period_id=$1",[period]),'55000')
  const partial=(await result(c,'public.create_restaurant_pay_period_v2($1,$2,$3,$4,$5)',[lodge,'Partial August','2026-08-05','2026-08-20',cfg])).data.id
  const partialInput=(await result(c,'public.set_restaurant_payroll_time_input($1,$2,$3,80,0,$4)',[lodge,partial,users.employee,'TS-002'])).data.id
  await actor(c,{id:users.checker,lodge});await result(c,'public.approve_restaurant_payroll_time_input($1,$2)',[lodge,partialInput])
  await actor(c,{id:users.maker,lodge});await rejectsCode(()=>result(c,'public.calculate_restaurant_payroll_v2($1,$2)',[lodge,partial]),'23514')
 })

 await t.test('derives balanced statements solely from posted journals',async()=>{
  const statements=(await result(c,'public.get_restaurant_financial_statements_v2($1,$2,$3)',[lodge,'2026-01-01','2026-12-31'])).data
  assert.equal(Number(statements.balance_sheet.difference),0);assert.ok(statements.income_statement);assert.ok(statements.cash_flow)
  const count=await one(c,'select count(*)::int n from public.restaurant_journal_entries where lodge_id=$1 and is_posted',[lodge]);assert.ok(count.n>=5)
 })

 await t.test('matches bank evidence independently, reconciles to zero, and closes the period through the close workflow',async()=>{
  const bank=(await result(c,'public.save_restaurant_bank_account_v2($1,null,$2,$3,$4,$5,$6,true)',[lodge,ids['1000'],'Operating bank','Test Bank','001','checking'])).data.id
  const imported=await result(c,'public.import_bank_statement_v2($1,$2,$3::jsonb,$4,$5)',[lodge,bank,JSON.stringify([{transaction_date:'2026-07-15',description:'Supplier payment',debit:100,credit:0,balance_after:260,reference_number:'PAY-A'}]),'statement.csv','statement-001'])
  const replay=await result(c,'public.import_bank_statement_v2($1,$2,$3::jsonb,$4,$5)',[lodge,bank,JSON.stringify([{transaction_date:'2026-07-15',description:'Supplier payment',debit:100,credit:0,balance_after:260,reference_number:'PAY-A'}]),'statement.csv','statement-001']);assert.equal(replay.data.replayed,true)
  await result(c,'public.propose_bank_matches_v2($1,$2)',[lodge,bank])
  const proposal=await one(c,'select id,bank_transaction_id from public.restaurant_match_proposals where bank_account_id=$1 and status=$2',[bank,'pending']);assert.ok(proposal)
  await actor(c,{id:users.checker,lodge});await result(c,'public.review_bank_match_v2($1,$2,true)',[lodge,proposal.id])
  const book=Number((await one(c,'select coalesce(sum(l.debit-l.credit),0) balance from public.restaurant_journal_lines l join public.restaurant_journal_entries e on e.id=l.entry_id where l.account_id=$1 and e.is_posted',[ids['1000']])).balance)
  await actor(c,{id:users.maker,lodge});const recon=await result(c,'public.create_bank_reconciliation_v2($1,$2,$3,$4,$5,$6::uuid[],$7::jsonb)',[lodge,bank,imported.data.id,book,'2026-07-15',[proposal.bank_transaction_id],JSON.stringify([])]);assert.equal(Number(recon.data.difference),0)
  await rejectsCode(()=>result(c,'public.complete_bank_reconciliation_v2($1,$2,null)',[lodge,recon.data.id]),'42501')
  await actor(c,{id:users.checker,lodge});const completed=await result(c,'public.complete_bank_reconciliation_v2($1,$2,$3)',[lodge,recon.data.id,'Checked']);assert.equal(completed.data.period_lock_created,false);assert.ok(completed.data.packet_id);assert.ok(completed.data.packet_hash)
  await actor(c,{id:users.maker,lodge});const prepared=await result(c,'public.prepare_restaurant_period_close($1,$2,$3,$4)',[lodge,'2026-01-01','2026-12-31','close-2026']);assert.equal(prepared.data.status,'prepared')
  await actor(c,{id:users.checker,lodge});const closed=await result(c,'public.approve_restaurant_period_close($1,$2)',[lodge,prepared.data.id]);assert.equal(closed.data.status,'closed')
  await actor(c,{id:users.maker,lodge});await rejectsCode(()=>result(c,'public.create_restaurant_journal_entry($1,$2,$3,$4,null,null,$5::jsonb,$6)',[lodge,'2026-07-14','Late journal','manual',JSON.stringify([{account_id:ids['1000'],debit:1,credit:0},{account_id:ids['3000'],debit:0,credit:1}]),'late-after-close']),'55000')
  const reopened=await result(c,'public.reopen_restaurant_period_close($1,$2,$3)',[lodge,prepared.data.id,'Controlled correction']);assert.equal(reopened.data.status,'reopened');assert.equal(reopened.data.affected_reports_invalidated,true)
  const reopenedJournal=await result(c,'public.create_restaurant_journal_entry($1,$2,$3,$4,null,null,$5::jsonb,$6)',[lodge,'2026-07-14','Reopened correction','manual',JSON.stringify([{account_id:ids['1000'],debit:1,credit:0},{account_id:ids['3000'],debit:0,credit:1}]),'after-reopen']);assert.ok(reopenedJournal.data.entry_id)
 })

 await c.end()
})

