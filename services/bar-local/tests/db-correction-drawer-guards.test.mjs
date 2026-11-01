import test from 'node:test'
import assert from 'node:assert/strict'
import {createHarness,sha256Json} from './harness.mjs'

test('corrections respect the original drawer, preserve closed-period recovery and refuse cash shortage atomically',async t=>{
 const h=await createHarness(t)
 const exact=(await h.migrator.query(`SELECT bar_local.decimal_json_transport('{"quantity":1.123456,"large":9007199254740993,"version":2,"negative":-2.50,"nested":[null,true,0.1400]}'::jsonb) AS value`)).rows[0].value
 assert.deepEqual(exact,{quantity:'1.123456',large:'9007199254740993',version:2,negative:'-2.50',nested:[null,true,'0.1400']})
 await assert.rejects(h.runtime.query("SELECT bar_local.decimal_json_transport('{}'::jsonb)"),error=>error.code==='42501')
 const shift=await h.openShift('0.00')
 const product=await h.call('cmd_catalogue_upsert',h.envelope('catalogue.upsert',{sku:'CORRECTION-GUARD',name:'Synthetic item',price:'10.00',tax_rate:'0',track_stock:false}))
 assert.equal(product.ok,true,JSON.stringify(product.error))
 const sale=await h.call('cmd_sale_commit',h.envelope('sale.commit',{shift_id:shift,items:[{product_id:product.result.product_id,quantity:'1'}],tenders:[{method:'cash',amount:'10.00',tendered:'10.00'}]}))
 assert.equal(sale.ok,true,JSON.stringify(sale.error))
 const detail=await h.query('sale.get',{sale_id:sale.result.sale_id})
 assert.ok(Array.isArray(detail.data?.lines)&&detail.data.lines.length>0,'sale.get must include the authoritative sale lines')
 const payload={sale_id:sale.result.sale_id,lines:[{sale_line_id:detail.data.lines[0].sale_line_id??detail.data.lines[0].id,quantity:'0.25'}],reason:'Quarter refund',disposition:'restock'}
 const hash=sha256Json(payload),approval=await h.approve('pos.void',hash)
 const env=h.envelope('sale.return',{...payload,approval_id:approval})
 const partial=await h.call('cmd_sale_return',env,{approvalHash:hash})
 assert.equal(partial.ok,true,JSON.stringify(partial.error));assert.equal(partial.result.total,'-2.50')
 const closed=await h.call('cmd_shift_close',h.envelope('shift.close',{shift_id:shift,counted_cash:'7.50'}))
 assert.equal(closed.ok,true,JSON.stringify(closed.error));assert.equal(closed.result.expected_cash,'7.50')
 const replay=await h.call('cmd_sale_return',env,{approvalHash:hash})
 assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,partial.receipt)
 assert.equal(replay.result.sale_id,partial.result.sale_id);assert.equal(replay.result.total,partial.result.total)
 const voidPayload={sale_id:sale.result.sale_id,reason:'Closed period must be reconciled'},voidHash=sha256Json(voidPayload)
 const voidEnv=h.envelope('sale.void',{...voidPayload,approval_id:await h.approve('pos.void',voidHash)})
 const refused=await h.call('cmd_sale_void',voidEnv,{approvalHash:voidHash})
 assert.equal(refused.ok,false);assert.equal(refused.error.code,'SHIFT_CLOSED')
 assert.equal((await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.sales WHERE original_sale_id=$1',[sale.result.sale_id])).rows[0].n,1)
 // A shortage must roll back the proposed refund, its stock/GL changes and proof consumption.
 const next=await h.openShift('0.00')
 const second=await h.call('cmd_sale_commit',h.envelope('sale.commit',{shift_id:next,items:[{product_id:product.result.product_id,quantity:'1'}],tenders:[{method:'cash',amount:'10.00',tendered:'10.00'}]}))
 assert.equal(second.ok,true)
 assert.equal((await h.call('cmd_drawer_movement',h.envelope('drawer.movement',{shift_id:next,type:'paid_out',amount:'10.00',reason:'Cash removed before refund'}))).ok,true)
 const secondPayload={sale_id:second.result.sale_id,reason:'No physical cash remains'},secondHash=sha256Json(secondPayload)
 const secondApproval=await h.approve('pos.void',secondHash)
 const shortage=await h.call('cmd_sale_void',h.envelope('sale.void',{...secondPayload,approval_id:secondApproval}),{approvalHash:secondHash})
 assert.equal(shortage.ok,false);assert.equal(shortage.error.code,'DRAWER_AMOUNT_INVALID')
 assert.equal((await h.migrator.query('SELECT status FROM bar_local.sales WHERE id=$1',[second.result.sale_id])).rows[0].status,'completed')
 assert.equal((await h.migrator.query('SELECT consumed_at FROM bar_local.approvals WHERE id=$1',[secondApproval])).rows[0].consumed_at,null)
})
