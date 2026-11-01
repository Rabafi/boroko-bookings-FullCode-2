import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, realpathSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'
import { createModernBarLocalAdapter, createHttpTransport, BarLocalAdapterError } from '../../../src/main/bar-local/index.js'
import { LegacyBarLocalClient } from '../../../legacy-pos/src/main/bar-local/client.js'
import { IntentJournal } from '../../../legacy-pos/src/main/bar-local/intents.js'
import { loadCompleteBarList } from '../../../src/shared/barLocalPagination.js'
import { openSqliteIntentJournal } from '../../../src/main/bar-local/sqliteIntents.js'

test('production Modern and Legacy clients trade through HTTP and recover a lost committed reply using the original journal',async(t)=>{
 const h=await createApiHarness(t)
 const temp=mkdtempSync(path.join(os.tmpdir(),'bar-real-clients-'))
 let modern,legacy
 t.after(()=>{
  modern?.close();legacy?.journal?.close?.();legacy?.transport.close()
  const actual=realpathSync(temp)
  assert.ok(actual.startsWith(realpathSync(os.tmpdir())+path.sep)&&path.basename(actual).startsWith('bar-real-clients-'))
  rmSync(actual,{recursive:true,force:true})
 })
 const setup=await h.request('/v1/setup/owner',{body:{setup_secret:TEST_SETUP_SECRET,business_name:'Real Client Test',outlet_name:'Main',owner_name:'Owner',pin:'1234',device_name:'Test till'}})
 assert.equal(setup.status,201,JSON.stringify(setup.body))
 const s={...setup.body,device_token:setup.stagedDeviceToken}
 const authority={authority_mode:'bar_local',product:'hospitality-pos',business_id:s.business_id,outlet_ids:[s.outlet_id],active_outlet_id:s.outlet_id,authority_id:s.authority_id,authority_epoch:s.authority_epoch,commissioning_id:'isolated-test',base_url:h.baseUrl}
 const transport=createHttpTransport({base_url:h.baseUrl})
 let loseSaleReply=false
 const wrapped={...transport,async post(url,body,options){
  const response=await transport.post(url,body,options)
  if(loseSaleReply&&url==='/v1/commands'&&body.command==='sale.commit'){
   loseSaleReply=false
   assert.equal(response.body.ok,true)
   throw new BarLocalAdapterError('REQUEST_TIMEOUT','Synthetic lost reply after real DB commit',{outcomeUnknown:true,retrySameOperation:true})
  }
  return response
 }}
 const makeModern=()=>createModernBarLocalAdapter({authority_config:authority,journal:openSqliteIntentJournal({filePath:path.join(temp,'modern.sqlite'),legacyFilePath:path.join(temp,'modern.jsonl')}),device_credential:{device_id:s.device_id,device_token:s.device_token},transport:wrapped})
 modern=makeModern()
 const client=modern.requireClient()
 await client.login({staff_id:s.owner_staff_id,pin:'1234'})
 const product=await client.command({command:'catalogue.upsert',payload:{sku:'LIVE-CLIENT',name:'Actual transport item',price:'10.00',tax_rate:'0',track_stock:true}})
 const productId=product.result.product_id
 await client.healthReady()
 const stock=await client.command({command:'stock.receive',payload:{product_id:productId,quantity:'10',lot_code:'REAL-LOT',expires_on:'2030-01-01'}})
 assert.equal(stock.outcome,'committed_local')
 const shift=await client.command({command:'shift.open',payload:{opening_float:'0'}})
 const operationId=randomUUID()
 const payload={shift_id:shift.result.shift_id,items:[{product_id:productId,quantity:'1'}],tenders:[{method:'cash',amount:'10.00',tendered:'10.00'}]}
 loseSaleReply=true
 await assert.rejects(client.command({command:'sale.commit',operation_id:operationId,payload}))
 assert.equal(modern.journal.get(operationId).state,'outcome_unknown')
 assert.equal(readFileSync(path.join(temp,'modern.sqlite')).subarray(0,15).toString(),'SQLite format 3')
 modern.close()
 modern=makeModern()
 await modern.requireClient().login({staff_id:s.owner_staff_id,pin:'1234'})
 await modern.requireClient().healthReady()
 const recovered=await modern.requireClient().retryOperation(operationId)
 assert.equal(recovered.outcome,'committed_local')
 assert.equal(recovered.receipt.operation_id,operationId)
 const modernBalances=await loadCompleteBarList((name,filters)=>modern.requireClient().query(name,filters),'stock.lot_balances')
 assert.equal(modernBalances.find((row)=>row.product_id===productId&&row.lot_code==='REAL-LOT')?.remaining_quantity,'9.000000')
 legacy=new LegacyBarLocalClient({scope:{authority_id:s.authority_id,authority_epoch:s.authority_epoch,business_id:s.business_id,outlet_id:s.outlet_id,device_id:s.device_id,deviceToken:s.device_token},baseUrl:h.baseUrl,journal:new IntentJournal({filePath:path.join(temp,'legacy.jsonl')})})
 await legacy.login(s.owner_staff_id,'1234')
 const lots=await loadCompleteBarList((name,filters)=>legacy.query(name,filters),'stock.lot_expiry')
 assert.equal(lots[0].lot_code,'REAL-LOT')
 const balances=await loadCompleteBarList((name,filters)=>legacy.query(name,filters),'stock.lot_balances')
 assert.equal(balances.find((row)=>row.product_id===productId&&row.lot_code==='REAL-LOT')?.remaining_quantity,'9.000000')
 const legacySale=await legacy.command('sale.commit',payload)
 assert.equal(legacySale.outcome,'committed_local')
 const afterLegacySale=await loadCompleteBarList((name,filters)=>legacy.query(name,filters),'stock.lot_balances')
 assert.equal(afterLegacySale.find((row)=>row.product_id===productId&&row.lot_code==='REAL-LOT')?.remaining_quantity,'8.000000')
 const count=await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.sales')
 assert.equal(count.rows[0].n,2)
 const balance=(await h.migrator.query('SELECT quantity::text FROM bar_local.stock_balances WHERE product_id=$1',[productId])).rows[0]
 assert.equal(Number(balance.quantity),8)
})
