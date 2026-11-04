import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, realpathSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET } from './harness.mjs'
import { createModernBarLocalAdapter, createHttpTransport, BarLocalAdapterError } from '../../../src/main/bar-local/index.js'
import { LegacyBarLocalClient } from '../../../legacy-pos/src/main/bar-local/client.js'
import { IntentJournal } from '../../../legacy-pos/src/main/bar-local/intents.js'
import { loadCompleteBarList } from '../../../src/shared/barLocalPagination.js'
import { openSqliteIntentJournal } from '../../../src/main/bar-local/sqliteIntents.js'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..')

test('production Modern and Legacy clients trade through HTTP and recover lost replies and a process crash using original journals',{timeout:120000},async(t)=>{
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
 await client.login({email:'owner@example.test',password:'test owner password 123'})
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
 await modern.requireClient().login({email:'owner@example.test',password:'test owner password 123'})
 await modern.requireClient().healthReady()
 const recovered=await modern.requireClient().retryOperation(operationId)
 assert.equal(recovered.outcome,'committed_local')
 assert.equal(recovered.receipt.operation_id,operationId)
 const modernBalances=await loadCompleteBarList((name,filters)=>modern.requireClient().query(name,filters),'stock.lot_balances')
 assert.equal(modernBalances.find((row)=>row.product_id===productId&&row.lot_code==='REAL-LOT')?.remaining_quantity,'9.000000')
 legacy=new LegacyBarLocalClient({scope:{authority_id:s.authority_id,authority_epoch:s.authority_epoch,business_id:s.business_id,outlet_id:s.outlet_id,device_id:s.device_id,deviceToken:s.device_token},baseUrl:h.baseUrl,journal:new IntentJournal({filePath:path.join(temp,'legacy.jsonl')})})
 await legacy.login({email:'owner@example.test',password:'test owner password 123'})
 const lots=await loadCompleteBarList((name,filters)=>legacy.query(name,filters),'stock.lot_expiry')
 assert.equal(lots[0].lot_code,'REAL-LOT')
 const balances=await loadCompleteBarList((name,filters)=>legacy.query(name,filters),'stock.lot_balances')
 assert.equal(balances.find((row)=>row.product_id===productId&&row.lot_code==='REAL-LOT')?.remaining_quantity,'9.000000')
 const legacySale=await legacy.command('sale.commit',payload)
 assert.equal(legacySale.outcome,'committed_local')
 const afterLegacySale=await loadCompleteBarList((name,filters)=>legacy.query(name,filters),'stock.lot_balances')
 assert.equal(afterLegacySale.find((row)=>row.product_id===productId&&row.lot_code==='REAL-LOT')?.remaining_quantity,'8.000000')
 const crashOperationId=randomUUID()
 const crashJournalPath=path.join(temp,'crashed-modern.sqlite')
 const crashSpec={
  baseUrl:h.baseUrl,authority,device:s,operationId:crashOperationId,payload,
  journalPath:crashJournalPath,
  mainModule:new URL('../../../src/main/bar-local/index.js',import.meta.url).href,
  sqliteModule:new URL('../../../src/main/bar-local/sqliteIntents.js',import.meta.url).href
 }
 const childSource=`
  const spec=${JSON.stringify(crashSpec)};
  const {createModernBarLocalAdapter,createHttpTransport}=await import(spec.mainModule);
  const {openSqliteIntentJournal}=await import(spec.sqliteModule);
  const base=createHttpTransport({base_url:spec.baseUrl});
  const transport={...base,async post(url,body,options){
   const response=await base.post(url,body,options);
   if(url==='/v1/commands'&&body.command==='sale.commit'&&body.operation_id===spec.operationId&&response.body?.ok===true)process.exit(77);
   return response;
  }};
  const adapter=createModernBarLocalAdapter({
   authority_config:spec.authority,
   journal:openSqliteIntentJournal({filePath:spec.journalPath,legacyFilePath:spec.journalPath+'.jsonl'}),
   device_credential:{device_id:spec.device.device_id,device_token:spec.device.device_token},
   transport
  });
  const client=adapter.requireClient();
  await client.login({email:'owner@example.test',password:'test owner password 123'});
  await client.healthReady();
  await client.command({command:'sale.commit',operation_id:spec.operationId,payload:spec.payload});
  process.exit(78);
 `
 const childResult=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',childSource],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']})
  let stdout='';let stderr=''
  child.stdout.on('data',(chunk)=>{stdout+=chunk})
  child.stderr.on('data',(chunk)=>{stderr+=chunk})
  child.once('error',reject)
  child.once('exit',(code,signal)=>resolve({code,signal,stdout,stderr}))
 })
 assert.equal(childResult.code,77,JSON.stringify(childResult))
 const crashedModern=createModernBarLocalAdapter({
  authority_config:authority,
  journal:openSqliteIntentJournal({filePath:crashJournalPath,legacyFilePath:crashJournalPath+'.jsonl'}),
  device_credential:{device_id:s.device_id,device_token:s.device_token},
  transport:createHttpTransport({base_url:h.baseUrl})
 })
 await crashedModern.requireClient().login({email:'owner@example.test',password:'test owner password 123'})
 const crashRecovery=await crashedModern.requireClient().retryOperation(crashOperationId)
 assert.equal(crashRecovery.outcome,'committed_local')
 assert.equal(crashRecovery.replayed,true)
 assert.equal(crashRecovery.receipt.operation_id,crashOperationId)
 crashedModern.close()
 const count=await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.sales')
 assert.equal(count.rows[0].n,3)
 const balance=(await h.migrator.query('SELECT quantity::text FROM bar_local.stock_balances WHERE product_id=$1',[productId])).rows[0]
 assert.equal(Number(balance.quantity),7)
})
