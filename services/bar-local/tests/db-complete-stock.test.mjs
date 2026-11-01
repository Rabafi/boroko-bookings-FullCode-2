import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'
import { loadCompleteBarList } from '../../../src/shared/barLocalPagination.js'

test('stock and receipt-lot lists return every row with consistent pagination and no direct helper access', async(t)=>{
 const h=await createHarness(t)
 await h.migrator.query(`INSERT INTO bar_local.products(business_id,sku,name,price,tax_rate,track_stock)
 SELECT $1, 'PAGE-'||n, 'Reverse name '||(600-n), 1, 0, true FROM generate_series(1,503) AS n`,[h.businessId])
 const rows=await loadCompleteBarList((name,filters)=>h.query(name,filters),'stock.list')
 assert.equal(rows.length,503);assert.equal(new Set(rows.map(r=>r.product_id)).size,503)
 const product=rows[0].product_id
 const receive=await h.call('cmd_stock_receive',h.envelope('stock.receive',{product_id:product,quantity:'1',lot_code:'FIRST',expires_on:'2030-01-01'}))
 assert.equal(receive.ok,true,JSON.stringify(receive.error))
 await h.migrator.query(`INSERT INTO bar_local.stock_movements(business_id,outlet_id,product_id,delta,reason,operation_id,business_date,lot_code,expires_on)
 SELECT $1,$2,$3,1,'stock.receive',gen_random_uuid(),bar_local.current_business_date(),'LOT-'||n,'2030-01-01'::date
 FROM generate_series(1,503) AS n`,[h.businessId,h.outletId,product])
 const lots=await loadCompleteBarList((name,filters)=>h.query(name,filters),'stock.lot_expiry')
 assert.equal(lots.length,504);assert.equal(new Set(lots.map(r=>r.movement_id)).size,504)
 assert.equal(typeof lots[0].received_quantity,'string')
 await assert.rejects(h.query('stock.list',{outlet_id:'99999999-9999-4999-8999-999999999999'}),/outlet/i)
 const access=await h.migrator.query(`SELECT has_function_privilege('bar_local_runtime','bar_local.stock_lot_expiry_report(text,uuid,uuid,bigint,jsonb)','EXECUTE') AS allowed`)
 assert.equal(access.rows[0].allowed,false)
})

test('new writes force synchronous commit while immutable receipt recovery survives a read-only connection',async(t)=>{
 const h=await createHarness(t)
 await h.seedShiftCatalogue()
 await h.runtime.query('SET synchronous_commit=off')
 await h.runtime.query('BEGIN')
 try{
  const env=h.envelope('shift.open',{opening_float:'0.00'})
  const first=await h.call('cmd_shift_open',env)
  assert.equal(first.ok,true)
  assert.equal((await h.runtime.query('SHOW synchronous_commit')).rows[0].synchronous_commit,'on')
  await h.runtime.query('COMMIT')
  await h.runtime.query('SET default_transaction_read_only=on')
  const ready=(await h.runtime.query('SELECT bar_local.service_readiness($1,$2) AS r',[h.ownerTokenHash,h.deviceId])).rows[0].r
  assert.ok(ready.blockers.includes('authority_read_only'))
  const status=(await h.runtime.query('SELECT bar_local.service_operation_status($1,$2,$3) AS r',[h.ownerTokenHash,h.deviceId,env.operation_id])).rows[0].r
  assert.equal(status.receipt.operation_id,env.operation_id)
 }finally{
  await h.runtime.query('ROLLBACK')
  await h.runtime.query('SET default_transaction_read_only=off')
 }
})
