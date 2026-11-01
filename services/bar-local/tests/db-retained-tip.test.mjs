import test from 'node:test'
import assert from 'node:assert/strict'
import {createHarness, sha256Json} from './harness.mjs'

test('a fully item-returned sale can allocate its retained tip without changing financial history', async t => {
 const h=await createHarness(t,{entitlementFeatures:['bar_growth_multi_outlet','bar_accounting_workforce']})
 await h.migrator.query(`INSERT INTO bar_local.accounting_accounts(code,name,type) VALUES ('1000','Cash','asset'),('2300','Tips payable','liability'),('4000','Sales revenue','revenue')`)
 const security=await h.migrator.query(`SELECT p.prosecdef, p.proconfig, r.rolname AS owner,
  has_function_privilege('bar_local_runtime',p.oid,'EXECUTE') AS runtime_execute,
  EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
  WHERE n.nspname='bar_local' AND p.proname='cmd_workforce_tip_allocate'`)
 assert.equal(security.rows[0].prosecdef,true);assert.ok(security.rows[0].proconfig.includes('search_path=pg_catalog, bar_local'))
 assert.equal(security.rows[0].owner,'bar_local_migrator');assert.equal(security.rows[0].runtime_execute,true);assert.equal(security.rows[0].public_execute,false)
 const shift=await h.openShift('0')
 const product=await h.call('cmd_catalogue_upsert',h.envelope('catalogue.upsert',{sku:'RETAINED-TIP',name:'Tip item',price:'10.00',tax_rate:'0',track_stock:false}))
 assert.equal(product.ok,true,JSON.stringify(product.error))
 const sale=await h.call('cmd_sale_commit',h.envelope('sale.commit',{shift_id:shift,items:[{product_id:product.result.product_id,quantity:'1'}],tip_amount:'5.00',tenders:[{method:'cash',amount:'15.00',tendered:'15.00'}]}))
 assert.equal(sale.ok,true,JSON.stringify(sale.error))
 const saleId=sale.result.sale_id
 const line=(await h.migrator.query('SELECT id FROM bar_local.sale_lines WHERE sale_id=$1',[saleId])).rows[0].id
 const payload={sale_id:saleId,lines:[{sale_line_id:line,quantity:'1'}],reason:'Return the item only',disposition:'restock'}
 const hash=sha256Json(payload), approval=await h.approve('pos.void',hash,{targetType:'sale',targetId:saleId})
 const returned=await h.call('cmd_sale_return',h.envelope('sale.return',{...payload,approval_id:approval}),{approvalHash:hash})
 assert.equal(returned.ok,true,JSON.stringify(returned.error))
 assert.equal(Number(returned.result.tip),0)
 const before=(await h.migrator.query('SELECT id,status,tip,total FROM bar_local.sales WHERE id=$1 OR original_sale_id=$1 ORDER BY receipt_number',[saleId])).rows
 assert.equal(before[0].status,'returned')
 const refundAttempt=await h.call('cmd_workforce_tip_allocate',h.envelope('workforce.tip.allocate',{sale_id:returned.result.sale_id,staff_id:h.ownerStaffId,amount:'1.00'}))
 assert.equal(refundAttempt.ok,false);assert.equal(refundAttempt.error.code,'SALE_NOT_COMPLETED')
 const env=h.envelope('workforce.tip.allocate',{sale_id:saleId,staff_id:h.ownerStaffId,amount:'5.00'})
 const allocated=await h.call('cmd_workforce_tip_allocate',env)
 assert.equal(allocated.ok,true,JSON.stringify(allocated.error));assert.equal(Number(allocated.result.remaining_tip),0)
 const replay=await h.call('cmd_workforce_tip_allocate',env)
 assert.equal(replay.replayed,true);assert.equal(replay.result.allocation_id,allocated.result.allocation_id)
 await assert.rejects(()=>h.call('cmd_workforce_tip_allocate',{...env,payload:{...env.payload,amount:'4.00'}}),error=>error.detail==='IDEMPOTENCY_PAYLOAD_CONFLICT')
 const excessive=await h.call('cmd_workforce_tip_allocate',h.envelope('workforce.tip.allocate',{sale_id:saleId,staff_id:h.managerStaffId,amount:'0.01'}))
 assert.equal(excessive.ok,false);assert.equal(excessive.error.code,'TIP_ALLOCATION_EXCEEDS_SALE_TIP')
 assert.deepEqual((await h.migrator.query('SELECT id,status,tip,total FROM bar_local.sales WHERE id=$1 OR original_sale_id=$1 ORDER BY receipt_number',[saleId])).rows,before)
 assert.equal(Number((await h.migrator.query('SELECT bar_local.staff_tip_balance($1,$2,$3) AS balance',[h.businessId,h.outletId,h.ownerStaffId])).rows[0].balance),5)
 assert.equal(Number((await h.query('cashup.summary',{shift_id:shift})).data.expected_cash),5)
 // Allocation and void serialize on the same original sale row: only one wins.
 const rival=await h.call('cmd_sale_commit',h.envelope('sale.commit',{shift_id:shift,items:[{product_id:product.result.product_id,quantity:'1'}],tip_amount:'5.00',tenders:[{method:'cash',amount:'15.00',tendered:'15.00'}]}))
 assert.equal(rival.ok,true,JSON.stringify(rival.error))
 const voidPayload={sale_id:rival.result.sale_id,reason:'Concurrent cancellation'},voidHash=sha256Json(voidPayload)
 const voidApproval=await h.approve('pos.void',voidHash)
 const a=await h.newRuntimeClient(),b=await h.newRuntimeClient()
 const [allocation,voided]=await Promise.all([
  h.callWith(a,'cmd_workforce_tip_allocate',h.envelope('workforce.tip.allocate',{sale_id:rival.result.sale_id,staff_id:h.managerStaffId,amount:'5.00'})),
  h.callWith(b,'cmd_sale_void',h.envelope('sale.void',{...voidPayload,approval_id:voidApproval}),{approvalHash:voidHash})
 ])
 assert.equal(Number(allocation.ok)+Number(voided.ok),1)
 if(allocation.ok) assert.equal(voided.error.code,'TIP_RECONCILIATION_REQUIRED')
 else assert.equal(allocation.error.code,'SALE_NOT_COMPLETED')

})

