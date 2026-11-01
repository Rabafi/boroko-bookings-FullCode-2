const {app,safeStorage}=require('electron')
const fs=require('node:fs')
const path=require('node:path')
const assert=require('node:assert/strict')
const {openSqliteIntentJournal,journalProtection}=require(process.argv[2])
const parent=fs.realpathSync(process.argv[3]),dir=fs.realpathSync(process.argv[4]),operationId=process.argv[5]
assert.ok(dir.startsWith(parent+path.sep)&&path.basename(dir).startsWith('native-'))
app.setPath('userData',dir);app.disableHardwareAcceleration()
app.whenReady().then(()=>{
 if(!safeStorage.isEncryptionAvailable())throw Error('OS secure storage is unavailable after process restart; this test is not skipped.')
 const journal=openSqliteIntentJournal({filePath:path.join(dir,'intents.sqlite'),protection:journalProtection(safeStorage)})
 try{
  const record=journal.get(operationId)
  assert.ok(record);assert.equal(record.payload.pin,'synthetic-storage-test-secret');assert.equal(record.receipt.total,'12.50')
  assert.equal(record.revision,5);assert.equal(record.state,'committed_local')
  process.stdout.write(JSON.stringify({electron:process.versions.electron,node:process.versions.node,backend:journal.storage.constructor.name,state:record.state,revision:record.revision,operation_id:record.operation_id,os_secure_storage:true,process_restart:true,scope:'Synthetic protected journal reopened by a separate Electron main process on this development PC; not installed Windows or multi-till qualification'})+'\n',()=>app.quit())
 }finally{journal.close()}
}).catch(error=>{console.error(error);app.exit(1)})
