import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto'
import {BarLocalElectronRuntime} from '../../src/main/bar-local/electronRuntime.js'
import {IntentJournal} from '../../src/main/bar-local/intents.js'
import {openSqliteIntentJournal} from '../../src/main/bar-local/sqliteIntents.js'
import {journalProtection} from '../../src/shared/barLocalJournalProtection.js'

function fixture(t){
 const parent=path.resolve('.tmp/bar-sqlite-tests');fs.mkdirSync(parent,{recursive:true})
 const userDataPath=fs.mkdtempSync(path.join(parent,'runtime-')),root=path.join(userDataPath,'bar-local');fs.mkdirSync(root)
 const key=randomBytes(32),runtimes=[]
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:text=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const value=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),value])},decryptString:value=>{const cipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));cipher.setAuthTag(value.subarray(12,28));return Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString('utf8')}}
 const config={authority_mode:'bar_local',product:'hospitality-pos',business_id:randomUUID(),outlet_ids:[randomUUID()],authority_id:randomUUID(),authority_epoch:1,commissioning_id:'synthetic',base_url:'http://127.0.0.1:45887'};config.active_outlet_id=config.outlet_ids[0]
 const env={contract_version:1,payload_version:1,authority_id:config.authority_id,authority_epoch:1,business_id:config.business_id,outlet_id:config.active_outlet_id,device_id:randomUUID(),operation_id:randomUUID(),command:'catalogue.upsert',payload:{sku:'SYNTHETIC',name:'Synthetic',price:'10.00'}}
 const options={filePath:path.join(root,'intents.sqlite'),legacyFilePath:path.join(root,'intents.jsonl'),protection:journalProtection(safeStorage)}
 t.after(()=>{for(const runtime of runtimes)runtime.close();const actual=fs.realpathSync(userDataPath);assert.ok(actual.startsWith(fs.realpathSync(parent)+path.sep));fs.rmSync(actual,{recursive:true,force:true})})
 return {root,env,options,safeStorage,profile:()=>{fs.writeFileSync(path.join(root,'authority.bin'),safeStorage.encryptString(JSON.stringify(config)));fs.writeFileSync(path.join(root,'device-credential.bin'),safeStorage.encryptString(JSON.stringify({device_id:env.device_id,device_token:'synthetic-device-token-12345678901234567890'})))},open:()=>{const runtime=new BarLocalElectronRuntime({userDataPath,safeStorage,buildProductId:'hospitality-pos'});runtimes.push(runtime);return runtime}}
}
test('committed Modern startup migrates the original uncertain journal into transactional SQLite',t=>{
 const f=fixture(t);f.profile();const legacy=new IntentJournal({filePath:f.options.legacyFilePath,protection:f.options.protection});legacy.createIntent(f.env);legacy.markSending(f.env.operation_id);legacy.close()
 const runtime=f.open();assert.equal(runtime.mode,'bar_local');assert.equal(runtime.adapter.journal.filePath,f.options.filePath)
 assert.equal(runtime.adapter.journal.storage.constructor.name,'SqliteFrameStore')
 assert.deepEqual(runtime.getOpenIntents().map(row=>row.operation_id),[f.env.operation_id]);assert.equal(runtime.adapter.journal.get(f.env.operation_id).state,'outcome_unknown')
})
test('Modern startup refuses orphaned SQLite intents instead of defaulting to cloud',t=>{
 const f=fixture(t),journal=openSqliteIntentJournal(f.options);journal.createIntent(f.env);journal.close()
 assert.throws(()=>f.open(),error=>error.code==='AUTHORITY_PROFILE_MISSING')
})
test('the protected Modern profile refuses lost SQLite and marker files despite a valid retained legacy journal',t=>{
 const f=fixture(t);f.profile();const legacy=new IntentJournal({filePath:f.options.legacyFilePath,protection:f.options.protection});legacy.createIntent(f.env);legacy.close()
 const runtime=f.open();runtime.close();fs.unlinkSync(f.options.filePath)
 fs.unlinkSync(f.options.filePath+'.initialized')
 assert.throws(()=>f.open(),error=>error.code==='INTENT_JOURNAL_CORRUPT')
})
test('failed owner preflight does not commission remotely or leave provisioning latched',async t=>{
 const f=fixture(t),runtime=f.open();fs.writeFileSync(f.options.legacyFilePath,'{broken}\n')
 await assert.rejects(runtime.setupOwner({base_url:'http://127.0.0.1:1',setup_secret:'synthetic-secret',business_name:'Synthetic',outlet_name:'Synthetic',owner_name:'Synthetic',pin:'1234',device_name:'Synthetic'}),error=>error.code==='INTENT_JOURNAL_CORRUPT')
 assert.equal(runtime.provisioning,false);assert.equal(runtime.adapter,null);assert.equal(fs.existsSync(f.options.filePath),false)
})
