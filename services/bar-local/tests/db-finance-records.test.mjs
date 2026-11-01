import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createHarness,sha256Text} from './harness.mjs'
import {loadCompleteBarList} from '../../../src/shared/barLocalPagination.js'

test('finance record reads are complete, scoped, capability checked and preserve decimal strings',async t=>{
 const h=await createHarness(t,{entitlementFeatures:['bar_growth_multi_outlet','bar_accounting_workforce']})
 const account=await h.call('cmd_accounting_account_upsert',h.envelope('accounting.account.upsert',{code:'1100',name:'Synthetic bank asset',type:'asset'}))
 assert.equal(account.ok,true,JSON.stringify(account.error))
 const created=await h.call('cmd_bank_account_upsert',h.envelope('accounting.bank_account.upsert',{
  name:'Synthetic operating account',institution:'Test bank',account_number:'TEST-ONLY',account_code:'1100',active:true
 }))
 assert.equal(created.ok,true,JSON.stringify(created.error))
 const rows=await loadCompleteBarList((name,filters)=>h.query(name,filters),'accounting.records',{kind:'bank_accounts'})
 assert.equal(rows.length,1);assert.equal(rows[0].name,'Synthetic operating account')
 const bank=rows[0].id
 const imported=await h.call('cmd_bank_statement_import',h.envelope('accounting.bank_statement.import',{
  bank_account_id:bank,lines:[{external_ref:'SYNTHETIC-01',statement_date:'2026-10-26',amount:'1234567890.12',description:'Synthetic fixture'}]
 }))
 assert.equal(imported.ok,true,JSON.stringify(imported.error))
 const statements=await h.query('accounting.records',{kind:'bank_statement_lines'})
 assert.equal(statements.data[0].amount,'1234567890.12')
 const otherOutlet=randomUUID(),otherBusiness=randomUUID(),foreignOutlet=randomUUID()
 await h.migrator.query('INSERT INTO bar_local.outlets(id,business_id,name,code) VALUES($1,$2,$3,$4)',[otherOutlet,h.businessId,'Other outlet','OTHER'])
 await h.migrator.query('INSERT INTO bar_local.business(id,name) VALUES($1,$2)',[otherBusiness,'Other synthetic business'])
 await h.migrator.query('INSERT INTO bar_local.outlets(id,business_id,name,code) VALUES($1,$2,$3,$4)',[foreignOutlet,otherBusiness,'Foreign outlet','FOREIGN'])
 const hidden=[]
 for(const [business,outlet] of [[h.businessId,otherOutlet],[otherBusiness,foreignOutlet]]){
  const id=randomUUID();hidden.push(id)
  await h.migrator.query(`INSERT INTO bar_local.bank_accounts(id,business_id,outlet_id,name,account_code,created_by,updated_by,operation_id)
   VALUES($1,$2,$3,'Never visible','1100',$4,$4,$5)`,[id,business,outlet,h.ownerStaffId,randomUUID()])
 }
 const visible=await h.query('accounting.records',{kind:'bank_accounts'})
 assert.deepEqual(visible.data.map(row=>row.id),[bank])
 for(const id of hidden)assert.deepEqual((await h.query('accounting.records',{kind:'bank_accounts',record_id:id})).data,[])
 await assert.rejects(h.query('accounting.records',{kind:'bank_accounts',outlet_id:foreignOutlet}),/outlet/i)
 await assert.rejects(h.query('accounting.records',{kind:'staff; DROP SCHEMA bar_local CASCADE'}),/supported/i)
 const staff=await h.insertStaff('No finance permission','cashier',['pos.view'])
 const token=sha256Text('synthetic-read-denial')
 await h.runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)',[staff,h.deviceId,h.outletId,token])
 await assert.rejects(h.query('accounting.records',{kind:'bank_accounts'},{tokenHash:token}),/capability/i)
 await assert.rejects(h.runtime.query('SELECT bar_local.query_finance_records($1,$2,$3,$4,$5)',[h.ownerTokenHash,h.deviceId,h.authorityId,1,{kind:'bank_accounts'}]),error=>error.code==='42501')
 for(const kind of ['ap_invoices','ap_payments','bank_reconciliations','tax_codes','tax_return_periods','payroll_runs','budgets','journal_entries','suppliers']){
  const result=await h.query('accounting.records',{kind})
  assert.equal(result.complete,true,kind);assert.ok(Array.isArray(result.data),kind)
 }
 // Editing requires the full authoritative lines, not just a summary/version.
 for(const [code,name,type] of [['2000','Payables','liability'],['5000','Expenses','expense']]){
  assert.equal((await h.call('cmd_accounting_account_upsert',h.envelope('accounting.account.upsert',{code,name,type}))).ok,true)
 }
 const supplier=(await h.migrator.query(`INSERT INTO bar_local.suppliers(business_id,name,created_by,updated_by,created_operation_id,updated_operation_id)
  VALUES($1,'Detail supplier',$2,$2,gen_random_uuid(),gen_random_uuid()) RETURNING id`,[h.businessId,h.ownerStaffId])).rows[0].id
 const date=(await h.migrator.query("SELECT bar_local.current_business_date()::text AS value")).rows[0].value
 const invoice=await h.call('cmd_ap_invoice_upsert',h.envelope('accounting.ap.invoice.upsert',{
  supplier_id:supplier,invoice_number:'DETAIL-1',invoice_date:date,payable_account_code:'2000',subtotal:'12.00',tax_total:'0.00',total:'12.00',
  lines:[{description:'Full line',expense_account_code:'5000',quantity:'1.5',unit_price:'8.00',tax_rate:'0'}]
 }))
 assert.equal(invoice.ok,true,JSON.stringify(invoice.error))
 const detail=(await h.query('accounting.records',{kind:'ap_invoices',record_id:invoice.result.id})).data[0]
 assert.deepEqual(detail.lines,[{description:'Full line',expense_account_code:'5000',quantity:'1.500000',unit_price:'8.00',tax_rate:'0.0000'}])
 assert.equal(detail.total,'12.00');assert.equal(detail.version,1)
 const budgetPayload={name:'Versioned detail',period_start:date,period_end:date,lines:[{account_code:'5000',amount:'10.00',description:'Old version'}]}
 const budget=await h.call('cmd_budget_upsert',h.envelope('accounting.budget.upsert',budgetPayload))
 assert.equal(budget.ok,true,JSON.stringify(budget.error))
 const revised=await h.call('cmd_budget_upsert',h.envelope('accounting.budget.upsert',{...budgetPayload,budget_id:budget.result.budget_id,expected_version:1,lines:[{account_code:'5000',amount:'20.25',description:'Current version'}]}))
 assert.equal(revised.ok,true,JSON.stringify(revised.error))
 const budgetDetail=(await h.query('accounting.records',{kind:'budgets',record_id:budget.result.budget_id})).data[0]
 assert.equal(budgetDetail.version,2);assert.deepEqual(budgetDetail.lines,[{account_code:'5000',amount:'20.25',description:'Current version'}])
 for(const [version,rate] of [[1,'0.10'],[2,'0.14']]){
  await h.migrator.query(`INSERT INTO bar_local.tax_codes(business_id,code,name,rate,version,created_by,operation_id)
   VALUES($1,'CURRENT','Versioned tax',$2,$3,$4,gen_random_uuid())`,[h.businessId,rate,version,h.ownerStaffId])
 }
 const tax=(await h.query('accounting.records',{kind:'tax_codes'})).data.filter(row=>row.code==='CURRENT')
 assert.equal(tax.length,1);assert.equal(tax[0].version,2);assert.equal(tax[0].rate,'0.1400')
 // Exercise real pagination and its complete-list consumer.
 for(let i=0;i<3;i++)await h.migrator.query(`INSERT INTO bar_local.bank_accounts(business_id,outlet_id,name,account_code,created_by,updated_by,operation_id)
  VALUES($1,$2,$3,'1100',$4,$4,gen_random_uuid())`,[h.businessId,h.outletId,'Paged bank '+i,h.ownerStaffId])
 const page=await h.query('accounting.records',{kind:'bank_accounts',limit:1})
 assert.equal(page.data.length,1);assert.equal(page.pagination.has_more,true)
 const next=await h.query('accounting.records',{kind:'bank_accounts',limit:1,cursor:page.pagination.next_cursor})
 assert.notEqual(next.data[0].id,page.data[0].id)
 assert.equal((await loadCompleteBarList((name,filters)=>h.query(name,{...filters,limit:1}),'accounting.records',{kind:'bank_accounts'})).length,4)
})
