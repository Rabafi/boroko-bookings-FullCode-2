import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {DatabaseSync} from 'node:sqlite'
import {SqliteFrameStore} from '../../src/main/bar-local/sqliteFrameStore.ts'

function fixture(t){
 const parent=path.resolve('.tmp/bar-sqlite-tests');fs.mkdirSync(parent,{recursive:true})
 const dir=fs.mkdtempSync(path.join(parent,'synthetic-')),stores=[]
 t.after(()=>{
  for(const store of stores)store.close()
  const actual=fs.realpathSync(dir)
  assert.ok(actual.startsWith(fs.realpathSync(parent)+path.sep))
  fs.rmSync(actual,{recursive:true,force:true})
 })
 const file=path.join(dir,'intents.sqlite')
 return {file,dir,open:(legacy)=>{const store=new SqliteFrameStore(file,legacy);stores.push(store);return store}}
}
const frame=(revision,operation_id='synthetic-operation')=>({operation_id,revision,frame:JSON.stringify({operation_id,revision,amount:'12.50'})})

test('SQLite journal durably preserves every frame across reopen and never reimports a migrated legacy journal',t=>{
 const f=fixture(t);let imports=0
 const store=f.open(()=>{imports++;return [frame(1)]})
 store.append(frame(2));assert.equal(store.read().length,2);store.close()
 const reopened=f.open(()=>{throw Error('Old journal must never become a fallback')})
 assert.deepEqual(reopened.read(),[frame(1),frame(2)]);assert.equal(imports,1)
})
test('SQLite journal rejects stale revisions atomically and excludes a second active writer',t=>{
 const f=fixture(t),store=f.open();store.append(frame(1))
 assert.throws(()=>store.append(frame(1)),/changed concurrently/)
 assert.deepEqual(store.read(),[frame(1)])
 assert.throws(()=>f.open(),/could not be opened/)
 store.append(frame(2));assert.deepEqual(store.read(),[frame(1),frame(2)])
})
test('missing initialized SQLite storage fences recovery instead of importing an older journal',t=>{
 const f=fixture(t),store=f.open();store.append(frame(1));store.close()
 fs.unlinkSync(f.file)
 assert.throws(()=>f.open(()=>{throw Error('Fallback attempted')}),/missing|damaged/)
})
test('foreign SQLite files are rejected without changing their journal mode or data',t=>{
 const f=fixture(t),foreign=new DatabaseSync(f.file)
 foreign.exec("CREATE TABLE customer_data(value TEXT); INSERT INTO customer_data VALUES('preserve');")
 foreign.close();assert.throws(()=>f.open(),/unsupported identity/)
 const verify=new DatabaseSync(f.file)
 try{assert.equal(verify.prepare('SELECT value FROM customer_data').get().value,'preserve');assert.equal(verify.prepare('PRAGMA journal_mode').get().journal_mode,'delete')}finally{verify.close()}
})
test('a failed legacy migration never publishes a partial SQLite database',t=>{
 const f=fixture(t)
 assert.throws(()=>f.open(()=>[frame(2)]),/could not be opened/)
 assert.equal(fs.existsSync(f.file),false);assert.equal(fs.existsSync(f.file+'.initialized'),false)
 const retried=f.open(()=>[frame(1)]);assert.deepEqual(retried.read(),[frame(1)])
})
for(const committed of [false,true])test(`process death ${committed?'after':'before'} SQLite commit preserves exactly the durable frames`,{timeout:30000},async t=>{
 const f=fixture(t),store=f.open();store.append(frame(1));store.close()
 const helper=path.join(f.dir,'synthetic-crash.mjs')
 fs.writeFileSync(helper,`import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync(process.argv[2]);db.exec('PRAGMA synchronous=FULL;BEGIN IMMEDIATE');db.prepare('INSERT INTO intent_frames(operation_id,revision,frame)VALUES(?,?,?)').run('synthetic-operation',2,${JSON.stringify(frame(2).frame)});${committed?"db.exec('COMMIT');":''}process.stdout.write('READY\\n');setInterval(()=>{},1000);`)
 const child=spawn(process.execPath,[helper,f.file],{windowsHide:true,stdio:['ignore','pipe','pipe']})
 const exited=once(child,'exit');let diagnostic=''
 child.stderr.on('data',chunk=>{diagnostic+=chunk})
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Synthetic writer did not become ready: '+diagnostic)),20000)
   child.stdout.on('data',chunk=>{if(String(chunk).includes('READY')){clearTimeout(timer);resolve()}})
   child.once('error',error=>{clearTimeout(timer);reject(error)})
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Synthetic writer exited early: '+diagnostic))})
  })
 }finally{child.kill('SIGKILL');await exited}
 assert.deepEqual(f.open().read(),committed?[frame(1),frame(2)]:[frame(1)])
})
