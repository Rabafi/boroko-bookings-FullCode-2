const {app,safeStorage}=require('electron')
const fs=require('node:fs')
const path=require('node:path')
const assert=require('node:assert/strict')
const {randomUUID}=require('node:crypto')
const {openSqliteIntentJournal,journalProtection}=require(process.argv[2])
const parent=fs.realpathSync(process.argv[3])
const dir=fs.mkdtempSync(path.join(parent,'native-'))
app.setPath('userData',dir)
app.disableHardwareAcceleration()
app.whenReady().then(()=>{
 if(!safeStorage.isEncryptionAvailable())throw Error('OS secure storage is unavailable; this test is not skipped.')
 const filePath=path.join(dir,'intents.sqlite'),protection=journalProtection(safeStorage)
 let journal
 try{
  const env={contract_version:1,payload_version:1,authority_id:randomUUID(),authority_epoch:1,business_id:randomUUID(),outlet_id:randomUUID(),device_id:randomUUID(),operation_id:randomUUID(),command:'staff.create',payload:{display_name:'Synthetic only',pin:'synthetic-storage-test-secret'}}
  journal=openSqliteIntentJournal({filePath,protection})
  journal.createIntent(env);journal.markSending(env.operation_id);journal.markOutcomeUnknown(env.operation_id,'SYNTHETIC_TIMEOUT');journal.close()
  journal=openSqliteIntentJournal({filePath,protection})
  assert.equal(journal.get(env.operation_id).payload.pin,env.payload.pin)
  journal.markSending(env.operation_id);journal.markCommitted(env.operation_id,{operation_id:env.operation_id,total:'12.50'})
  const final=journal.get(env.operation_id),backend=journal.storage.constructor.name
  journal.close();journal=null
  assert.equal(fs.readFileSync(filePath).includes(Buffer.from(env.payload.pin)),false)
  process.stdout.write(JSON.stringify({electron:process.versions.electron,node:process.versions.node,backend,state:final.state,revision:final.revision,operation_id:final.operation_id,os_secure_storage:true,synthetic_directory:dir,scope:'Actual Electron main process and OS secure storage on this development PC only; no installed service, peripherals or physical fault qualification'})+'\n',()=>app.quit())
 }finally{journal?.close()}
}).catch(error=>{console.error(error);app.exit(1)})
