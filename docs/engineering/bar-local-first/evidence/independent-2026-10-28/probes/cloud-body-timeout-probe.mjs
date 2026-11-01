import assert from 'node:assert/strict'
import http from 'node:http'
import {writeFileSync} from 'node:fs'
import {createCloudSyncController} from '../../../../../../services/bar-local/dist/operations/cloudSync.js'
let pendingResponse,headersReceived
const ready=new Promise(r=>headersReceived=r)
const server=http.createServer((req,res)=>{req.resume();res.writeHead(200,{'content-type':'application/json'});res.flushHeaders();res.write('{"ok":');pendingResponse=res;headersReceived()})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const url=`http://127.0.0.1:${server.address().port}/receiver`
let released=false,settled=false
const worker={configured:true,enabled:true,receiver_url:url,signing_key_id:'probe',batch_limit:1,schedule_mode:'fifteen_minutes'}
const batch={status:'batch_pending',batch_id:'10000000-0000-4000-8000-000000000001',manifest_hash:'a'.repeat(64),manifest_text:'{}'}
const pool={async query(sql){
 let result={}
 if(sql.includes('cloud_sync_worker_config'))result=worker
 if(sql.includes('cloud_sync_next_batch'))result=batch
 if(sql.includes('cloud_sync_status')||sql.includes('cloud_sync_record_run'))result={pending_events:1}
 return {rows:[{result}]}
},async connect(){return {async query(sql){return {rows:[{locked:true}]}},release(){released=true}}}}
const controller=createCloudSyncController({config:{networkRole:'single_host',cloudSync:{transport:'local_test',secret:'p'.repeat(40),keyId:'probe',requestTimeoutMs:1000,maxBatchesPerRun:1}},pool})
try{
 const started=Date.now()
 const active=controller.runNow().then(r=>{settled=true;return r})
 await ready
 await new Promise(r=>setTimeout(r,1600))
 const evidence={request_timeout_ms:1000,elapsed_ms:Date.now()-started,settled_after_deadline:settled,advisory_client_released:released,receiver:'fresh owned loopback HTTP server, no real database or hosted request'}
 assert.equal(settled,false,'Current bug: response body is not covered by the configured timeout')
 assert.equal(released,false,'Uploader retains its lock client while response body stalls')
 pendingResponse.end('false}')
 evidence.final_result=await active
 assert.equal(released,true)
 writeFileSync('docs/engineering/bar-local-first/evidence/independent-2026-10-28/cloud-body-timeout-probe.json',JSON.stringify(evidence,null,2))
 console.log(JSON.stringify(evidence))
}finally{pendingResponse?.end();server.closeAllConnections();await new Promise(r=>server.close(r))}

