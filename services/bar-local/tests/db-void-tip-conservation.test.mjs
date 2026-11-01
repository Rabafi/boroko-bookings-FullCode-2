import test from 'node:test'
import assert from 'node:assert/strict'
import {createHarness,sha256Json} from './harness.mjs'

test('void refunds the unallocated tip with the original tenders and preserves allocated tip liabilities',async t=>{
 const h=await createHarness(t,{entitlementFeatures:['bar_growth_multi_outlet','bar_accounting_workforce']})
 await h.migrator.query(`INSERT INTO bar_local.accounting_accounts(code,name,type) VALUES
  ('1000','Cash','asset'),('2300','Tips payable','liability'),('4000','Sales revenue','revenue')`)
 const shift=await h.openShift('0.00')
 const product=await h.call('cmd_catalogue_upsert',h.envelope('catalogue.upsert',{sku:'TIP-VOID',name:'Synthetic tipped sale',price:'10.00',tax_rate:'0',track_stock:false}))
 assert.equal(product.ok,true,JSON.stringify(product.error))
 const sell=()=>h.call('cmd_sale_commit',h.envelope('sale.commit',{shift_id:shift,items:[{product_id:product.result.product_id,quantity:'1'}],tip_amount:'5.00',tenders:[{method:'cash',amount:'15.00',tendered:'15.00'}]}))
 const sale=await sell();assert.equal(sale.ok,true,JSON.stringify(sale.error))
 const payload={sale_id:sale.result.sale_id,reason:'Cancel the entire tipped sale'},hash=sha256Json(payload)
 const approval=await h.approve('pos.void',hash),env=h.envelope('sale.void',{...payload,approval_id:approval})
 const result=await h.call('cmd_sale_void',env,{approvalHash:hash})
 assert.equal(result.ok,true,JSON.stringify(result.error))
 assert.equal(Number(result.result.total),-15)
 assert.equal(Number(result.result.tip),-5)
 assert.equal(Number((await h.query('cashup.summary',{shift_id:shift})).data.expected_cash),0)
 const replay=await h.call('cmd_sale_void',env,{approvalHash:hash})
 assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,result.receipt)
 assert.equal(replay.result.sale_id,result.result.sale_id);assert.equal(replay.result.total,result.result.total)
 const tenders=await h.migrator.query('SELECT sum(t.amount)::text AS total FROM bar_local.sale_tenders t JOIN bar_local.sales s ON s.id=t.sale_id WHERE s.id=$1 OR s.original_sale_id=$1',[sale.result.sale_id])
 assert.equal(Number(tenders.rows[0].total),0)
 const drift=await h.migrator.query(`SELECT jl.account_code FROM bar_local.journal_lines jl
  JOIN bar_local.journal_entries je ON je.id=jl.entry_id
  WHERE je.source_id IN ($1,$2) GROUP BY jl.account_code HAVING sum(jl.debit-jl.credit)<>0`,[sale.result.sale_id,result.result.sale_id])
 assert.deepEqual(drift.rows,[],'the sale and its void must cancel each GL account, including tips payable')
 const allocated=await sell();assert.equal(allocated.ok,true,JSON.stringify(allocated.error))
 const allocation=await h.call('cmd_workforce_tip_allocate',h.envelope('workforce.tip.allocate',{sale_id:allocated.result.sale_id,staff_id:h.ownerStaffId,amount:'5.00'}))
 assert.equal(allocation.ok,true,JSON.stringify(allocation.error))
 const blockedPayload={sale_id:allocated.result.sale_id,reason:'Allocated liability must be reconciled'},blockedHash=sha256Json(blockedPayload)
 const blockedProof=await h.approve('pos.void',blockedHash)
 const refused=await h.call('cmd_sale_void',h.envelope('sale.void',{...blockedPayload,approval_id:blockedProof}),{approvalHash:blockedHash})
 assert.equal(refused.ok,false);assert.equal(refused.error.code,'TIP_RECONCILIATION_REQUIRED')
 assert.equal((await h.migrator.query('SELECT status FROM bar_local.sales WHERE id=$1',[allocated.result.sale_id])).rows[0].status,'completed')
 assert.equal((await h.migrator.query('SELECT consumed_at FROM bar_local.approvals WHERE id=$1',[blockedProof])).rows[0].consumed_at,null)
 assert.equal(Number((await h.query('cashup.summary',{shift_id:shift})).data.expected_cash),15)
})
