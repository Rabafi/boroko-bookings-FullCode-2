import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import {randomUUID} from 'node:crypto'
import {createApiHarness} from '../../../../../../services/bar-local/tests/api-harness.mjs'
import {TEST_SETUP_SECRET} from '../../../../../../services/bar-local/tests/harness.mjs'
import {buildRuntimeSecurityStatements} from '../../../../../../services/bar-local/dist/operations/backup.js'

test('review reproduction: committed first-owner reply loss has no resumable credential recovery',async t=>{
 const h=await createApiHarness(t)
 const body={setup_secret:TEST_SETUP_SECRET,business_name:'Synthetic reply-loss bar',outlet_name:'Test',owner_name:'Owner',pin:'1234',device_name:'Test device'}
 // Forward the real setup request, wait for its real committed response, then
 // destroy the caller socket without forwarding any credential bytes.
 const proxy=http.createServer(async(req,res)=>{
  req.resume()
  const upstream=await fetch(h.baseUrl+'/v1/setup/owner',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  assert.equal(upstream.status,201)
  await upstream.arrayBuffer()
  res.destroy()
 })
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r))
 t.after(async()=>{proxy.closeAllConnections();await new Promise(r=>proxy.close(r))})
 await assert.rejects(fetch(`http://127.0.0.1:${proxy.address().port}/setup`,{method:'POST',body:'{}'}))
 const retry=await h.request('/v1/setup/owner',{body})
 assert.equal(retry.status,409)
 assert.equal(retry.body.code,'AUTHORITY_ALREADY_COMMISSIONED')
 const count=(await h.migrator.query('SELECT (SELECT count(*) FROM bar_local.authority)::int AS authorities,(SELECT count(*) FROM bar_local.devices)::int AS devices')).rows[0]
 assert.equal(count.authorities,1);assert.equal(count.devices,1)
 const login=await h.request('/v1/sessions',{body:{staff_id:'10000000-0000-4000-8000-000000000001',pin:'1234'}})
 assert.equal(login.status,401)
 console.log('REPRODUCED: setup committed; caller received no credential; same setup retry is fenced; login requires the missing paired-device credential.')
})

test('review reproduction: restore hardening removes cloud-sync runtime permissions',async t=>{
 const h=await createApiHarness(t)
 const access=async()=> (await h.migrator.query("SELECT has_function_privilege('bar_local_runtime','bar_local.cloud_sync_status()','EXECUTE') AS status,has_function_privilege('bar_local_runtime','bar_local.cloud_sync_worker_config()','EXECUTE') AS worker")).rows[0]
 assert.deepEqual(await access(),{status:true,worker:true})
 for(const sql of buildRuntimeSecurityStatements({migrationOwner:'bar_local_migrator',runtimeRole:'bar_local_runtime'}))await h.migrator.query(sql)
 assert.deepEqual(await access(),{status:false,worker:false})
 console.log('REPRODUCED: migrated runtime can execute cloud sync; actual restore hardening revokes both status and worker functions because migration0064 omits allowlist registration.')
})

test('review scope probe checks every forged scope even when denial HTTP contracts differ',async t=>{
 const h=await createApiHarness(t)
 const setup=await h.request('/v1/setup/owner',{body:{setup_secret:TEST_SETUP_SECRET,business_name:'Synthetic scope bar',outlet_name:'Test',owner_name:'Owner',pin:'1234',device_name:'Test device'}})
 assert.equal(setup.status,201)
 const login=await h.request('/v1/sessions',{deviceToken:setup.body.device_token,body:{staff_id:setup.body.owner_staff_id,pin:'1234'}})
 assert.equal(login.status,201)
 const scope=Object.fromEntries(['authority_id','authority_epoch','business_id','outlet_id','device_id'].map(k=>[k,setup.body[k]]))
 const otherOutlet=randomUUID()
 await h.migrator.query("INSERT INTO bar_local.outlets(id,business_id,name,code) VALUES($1,$2,'Other','OTHER')",[otherOutlet,setup.body.business_id])
 for(const field of ['business_id','outlet_id','authority_id','device_id']){
  const envelope={contract_version:1,operation_id:randomUUID(),command:'catalogue.upsert',...scope,[field]:field==='outlet_id'?otherOutlet:randomUUID(),payload:{sku:'FORGED-'+field,name:'Must not commit',category:'Test',price:'1.00',tax_rate:'0',track_stock:false}}
  const res=await h.request('/v1/commands',{token:login.body.session_token,deviceId:setup.body.device_id,body:envelope})
  assert.equal(res.body.ok,false,field+': '+JSON.stringify(res.body))
  assert.ok([200,400,401,403,409].includes(res.status))
  if(res.status===200)assert.equal(res.body.outcome,'refused')
  console.log('SCOPE_DENIED',field,res.status,res.body.code??res.body.error?.code)
 }
 assert.equal((await h.migrator.query("SELECT count(*)::int AS n FROM bar_local.products WHERE sku LIKE 'FORGED-%'")).rows[0].n,0)
})

