import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {IntentJournal} from '../../src/main/bar-local/intents.js'
import {openSqliteIntentJournal} from '../../src/main/bar-local/sqliteIntents.js'

const protection={encrypt:text=>Buffer.from(text).toString('base64'),decrypt:text=>Buffer.from(text,'base64').toString('utf8')}
const envelope=()=>({contract_version:1,payload_version:1,authority_id:randomUUID(),authority_epoch:1,business_id:randomUUID(),outlet_id:randomUUID(),device_id:randomUUID(),operation_id:randomUUID(),command:'staff.create',payload:{display_name:'Synthetic operator',pin:'synthetic-secret-pin'}})
function fixture(t){
 const parent=path.resolve('.tmp/bar-sqlite-tests');fs.mkdirSync(parent,{recursive:true})
 const dir=fs.mkdtempSync(path.join(parent,'intent-')),journals=[]
 const filePath=path.join(dir,'intents.sqlite'),legacyFilePath=path.join(dir,'intents.jsonl')
 t.after(()=>{for(const journal of journals)journal.close();const actual=fs.realpathSync(dir);assert.ok(actual.startsWith(fs.realpathSync(parent)+path.sep));fs.rmSync(actual,{recursive:true,force:true})})
 return {filePath,legacyFilePath,open:()=>{const journal=openSqliteIntentJournal({filePath,legacyFilePath,protection});journals.push(journal);return journal}}
}
test('Modern SQLite migration preserves original uncertain envelopes, secret protection and every revision without dual writes',t=>{
 const f=fixture(t),env=envelope(),legacy=new IntentJournal({filePath:f.legacyFilePath,protection})
 legacy.createIntent(env);legacy.markSending(env.operation_id);legacy.markOutcomeUnknown(env.operation_id,'NETWORK_TIMEOUT');legacy.close()
 const original=fs.readFileSync(f.legacyFilePath)
 const journal=f.open();assert.equal(journal.get(env.operation_id).state,'outcome_unknown');assert.deepEqual(journal.get(env.operation_id).envelope,{...env,expected_versions:{},dependencies:[],client_occurred_at:null})
 journal.markSending(env.operation_id);journal.markCommitted(env.operation_id,{operation_id:env.operation_id,total:'12.50'});journal.close()
 assert.deepEqual(fs.readFileSync(f.legacyFilePath),original)
 assert.equal(fs.readFileSync(f.filePath).subarray(0,15).toString(),'SQLite format 3')
 const reopened=f.open();assert.equal(reopened.get(env.operation_id).revision,5);assert.equal(reopened.get(env.operation_id).state,'committed_local')
 assert.equal(fs.readFileSync(f.filePath).includes(Buffer.from('synthetic-secret-pin')),false)
 assert.throws(()=>reopened.createIntent({...env,payload:{...env.payload,display_name:'Changed'}}),error=>error.code==='IDEMPOTENCY_PAYLOAD_CONFLICT')
})
test('SQLite receipt checkpoint failures fence further dispatch and reopening marks an interrupted send uncertain',t=>{
 const f=fixture(t),env=envelope(),journal=f.open();journal.createIntent(env);journal.markSending(env.operation_id)
 journal.storage.append=()=>{throw Error('Synthetic disk failure')}
 assert.throws(()=>journal.markCommitted(env.operation_id,{operation_id:env.operation_id}),error=>error.code==='JOURNAL_WRITE_FAILED')
 assert.equal(journal.closed,true);assert.throws(()=>journal.createIntent(envelope()))
 journal.close();const recovered=f.open();assert.equal(recovered.get(env.operation_id).state,'outcome_unknown');assert.equal(recovered.get(env.operation_id).last_error_code,'PROCESS_RESTART');assert.equal(recovered.get(env.operation_id).payload_hash,journal.get(env.operation_id).payload_hash)
})
test('reopening a JSONL journal also marks an interrupted send uncertain without changing its envelope',t=>{
 const f=fixture(t),env=envelope(),journal=new IntentJournal({filePath:f.legacyFilePath,fsync:true,protection})
 journal.createIntent(env);journal.markSending(env.operation_id);journal.close()
 const recovered=new IntentJournal({filePath:f.legacyFilePath,fsync:true,protection})
 assert.equal(recovered.get(env.operation_id).state,'outcome_unknown')
 assert.equal(recovered.get(env.operation_id).last_error_code,'PROCESS_RESTART')
 assert.deepEqual(recovered.get(env.operation_id).envelope,{...env,expected_versions:{},dependencies:[],client_occurred_at:null})
 recovered.close()
})
test('damaged SQLite operation frames never fall back to the retained valid legacy journal',t=>{
 const f=fixture(t),env=envelope(),legacy=new IntentJournal({filePath:f.legacyFilePath,protection});legacy.createIntent(env);legacy.close()
 const journal=f.open();journal.close()
 const db=new DatabaseSync(f.filePath)
 try{db.exec('DROP TRIGGER intent_frames_no_update');db.prepare('UPDATE intent_frames SET frame=?').run('{"corrupt":true}')}finally{db.close()}
 assert.throws(()=>f.open(),error=>error.code==='INTENT_JOURNAL_CORRUPT')
 assert.ok(fs.existsSync(f.legacyFilePath))
})
test('plaintext credential migration requires protection before any SQLite publication',t=>{
 const f=fixture(t),env=envelope(),memory=new IntentJournal();const record=memory.createIntent(env)
 fs.writeFileSync(f.legacyFilePath,JSON.stringify(record)+'\n');memory.close()
 assert.throws(()=>openSqliteIntentJournal({filePath:f.filePath,legacyFilePath:f.legacyFilePath}),error=>/secure|protect|encrypt/i.test(error.message))
 assert.equal(fs.existsSync(f.filePath),false)
 const journal=f.open();assert.equal(journal.get(env.operation_id).state,'durable_intent');assert.equal(fs.readFileSync(f.legacyFilePath,'utf8').includes('synthetic-secret-pin'),false)
})
