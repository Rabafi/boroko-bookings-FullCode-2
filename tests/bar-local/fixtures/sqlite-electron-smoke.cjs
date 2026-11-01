const fs=require('node:fs')
const path=require('node:path')
const assert=require('node:assert/strict')
const {randomUUID,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto')
const {openSqliteIntentJournal}=require(process.argv[2])
const parent=fs.realpathSync(process.argv[3])
const dir=fs.mkdtempSync(path.join(parent,'data-'))
const key=randomBytes(32)
const protection={encrypt:text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const value=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),value]).toString('base64')},decrypt:text=>{const value=Buffer.from(text,'base64'),cipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));cipher.setAuthTag(value.subarray(12,28));return Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString('utf8')}}
const filePath=path.join(dir,'intents.sqlite')
let journal
try{
 const env={contract_version:1,payload_version:1,authority_id:randomUUID(),authority_epoch:1,business_id:randomUUID(),outlet_id:randomUUID(),device_id:randomUUID(),operation_id:randomUUID(),command:'staff.create',payload:{display_name:'Synthetic',pin:'synthetic-credential-only'}}
 journal=openSqliteIntentJournal({filePath,protection})
 journal.createIntent(env);journal.markSending(env.operation_id);journal.markOutcomeUnknown(env.operation_id,'SYNTHETIC_TIMEOUT');journal.close()
 journal=openSqliteIntentJournal({filePath,protection})
 assert.equal(journal.get(env.operation_id).state,'outcome_unknown')
 assert.equal(journal.get(env.operation_id).payload.pin,'synthetic-credential-only')
 journal.markSending(env.operation_id);journal.markCommitted(env.operation_id,{operation_id:env.operation_id,total:'12.50'})
 const final=journal.get(env.operation_id),backend=journal.storage.constructor.name
 journal.close();journal=null
 assert.equal(fs.readFileSync(filePath).subarray(0,15).toString(),'SQLite format 3')
 assert.equal(fs.readFileSync(filePath).includes(Buffer.from('synthetic-credential-only')),false)
 console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,backend,state:final.state,revision:final.revision,operation_id:final.operation_id,bundled_module:true,scope:'Synthetic bundled module only; no installed service, Windows DPAPI, peripherals or physical fault qualification'}))
}finally{
 journal?.close()
 const actual=fs.realpathSync(dir)
 assert.ok(actual.startsWith(parent+path.sep)&&path.basename(actual).startsWith('data-'))
 fs.rmSync(actual,{recursive:true,force:true})
}
