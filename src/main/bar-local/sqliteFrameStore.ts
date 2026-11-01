import {DatabaseSync} from 'node:sqlite'
import {closeSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync,renameSync,unlinkSync,writeFileSync} from 'node:fs'
import {dirname,isAbsolute} from 'node:path'
import {randomUUID} from 'node:crypto'

export interface IntentFrame {operation_id:string;revision:number;frame:string}
export interface IntentFrameStore {
 readonly filePath:string
 read():IntentFrame[]
 append(frame:IntentFrame):void
 close():void
}
export class SqliteIntentStorageError extends Error {
 readonly code='INTENT_JOURNAL_CORRUPT'
 constructor(message:string,options?:ErrorOptions){super(message,options);this.name='SqliteIntentStorageError'}
}
const APPLICATION_ID=0x42494e54
const SCHEMA_VERSION=1
const MARKER='bar-local-sqlite-intents-v1\n'

/** A device-local operation journal, never a shared till database or financial authority. */
export class SqliteFrameStore implements IntentFrameStore {
 readonly filePath:string
 private db:DatabaseSync|null=null
 constructor(filePath:string,importLegacy:()=>IntentFrame[]=()=>[]){
  if(!isAbsolute(filePath)||filePath.startsWith('\\\\'))throw new SqliteIntentStorageError('Saved-operation SQLite storage must use an absolute local path.')
  this.filePath=filePath
  const marker=filePath+'.initialized'
  if(existsSync(marker)){
   if(readFileSync(marker,'utf8')!==MARKER||!existsSync(filePath))throw new SqliteIntentStorageError('Saved-operation storage is missing or its initialization marker is damaged. Preserve the journal and recover this till; do not create a replacement sale.')
  }
  mkdirSync(dirname(filePath),{recursive:true})
  try{
   if(!existsSync(filePath))this.initialize(importLegacy())
   this.db=this.connect(filePath)
   const application=this.db.prepare('PRAGMA application_id').get()?.application_id
   const version=this.db.prepare('PRAGMA user_version').get()?.user_version
   if(application!==APPLICATION_ID||version!==SCHEMA_VERSION)throw new SqliteIntentStorageError('Saved-operation storage has an unsupported identity or schema. Preserve it for recovery.')
   if(this.db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw new SqliteIntentStorageError('Saved-operation SQLite integrity verification failed. Trading is paused.')
   // Ensure the exclusive connection lock has been acquired before returning.
   this.db.exec('BEGIN IMMEDIATE; COMMIT;')
   if(!existsSync(marker)){
    const fd=openSync(marker,'wx',0o600)
    try{writeFileSync(fd,MARKER);fsyncSync(fd)}finally{closeSync(fd)}
   }
  }catch(cause){
   try{this.db?.close()}catch{}
   this.db=null
   if(cause instanceof SqliteIntentStorageError)throw cause
   throw new SqliteIntentStorageError('Saved-operation SQLite storage could not be opened. Close another instance of this till or recover its original storage. Cloud fallback is disabled.',{cause})
  }
 }
 private connect(filePath:string,expectedIdentity=true):DatabaseSync{
  const db=new DatabaseSync(filePath,{timeout:1000})
  try{
   if(expectedIdentity&&(db.prepare('PRAGMA application_id').get()?.application_id!==APPLICATION_ID||db.prepare('PRAGMA user_version').get()?.user_version!==SCHEMA_VERSION))throw new SqliteIntentStorageError('Saved-operation storage has an unsupported identity or schema. Preserve it for recovery.')
   db.exec('PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
   if(db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='wal'||db.prepare('PRAGMA synchronous').get()?.synchronous!==2)throw new Error('Required journal durability was not established')
   return db
  }catch(cause){db.close();throw cause}
 }
 private initialize(frames:IntentFrame[]):void{
  // Publish only a fully committed, checkpointed migration. A failed staging
  // file is retained; it never replaces the original JSONL journal.
  const reservation=this.filePath+'.creating'
  const reservationFd=openSync(reservation,'wx',0o600)
  try{this.initializeReserved(frames)}finally{closeSync(reservationFd);unlinkSync(reservation)}
 }
 private initializeReserved(frames:IntentFrame[]):void{
  const staging=this.filePath+'.migrating-'+randomUUID()
  const db=this.connect(staging,false)
  try{
   db.exec(`BEGIN IMMEDIATE;
    PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};
    CREATE TABLE intent_frames(sequence INTEGER PRIMARY KEY,operation_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),frame TEXT NOT NULL,UNIQUE(operation_id,revision)) STRICT;
    CREATE TRIGGER intent_frames_no_update BEFORE UPDATE ON intent_frames BEGIN SELECT RAISE(ABORT,'Intent history is immutable'); END;
    CREATE TRIGGER intent_frames_no_delete BEFORE DELETE ON intent_frames BEGIN SELECT RAISE(ABORT,'Intent history is immutable'); END;`)
   const insert=db.prepare('INSERT INTO intent_frames(operation_id,revision,frame) VALUES(?,?,?)')
   const revisions=new Map<string,number>()
   for(const frame of frames){
    if(!Number.isSafeInteger(frame.revision)||frame.revision!==(revisions.get(frame.operation_id)??0)+1)throw new Error('Legacy journal revisions are incomplete')
    insert.run(frame.operation_id,frame.revision,frame.frame)
    revisions.set(frame.operation_id,frame.revision)
   }
   db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE);')
  }catch(cause){try{db.exec('ROLLBACK')}catch{};throw cause}
  finally{db.close()}
  const fd=openSync(staging,'r+')
  try{fsyncSync(fd)}finally{closeSync(fd)}
  if(existsSync(this.filePath))throw new SqliteIntentStorageError('Another process initialized saved-operation storage. Restart this till before trading.')
  renameSync(staging,this.filePath)
 }
 read():IntentFrame[]{
  if(!this.db)throw new SqliteIntentStorageError('Saved-operation storage is closed.')
  return this.db.prepare('SELECT operation_id,revision,frame FROM intent_frames ORDER BY sequence').all().map(row=>{
   if(typeof row.operation_id!=='string'||typeof row.revision!=='number'||typeof row.frame!=='string')throw new SqliteIntentStorageError('Saved-operation storage contains malformed frames.')
   return {operation_id:row.operation_id,revision:row.revision,frame:row.frame}
  })
 }
 append(frame:IntentFrame):void{
  if(!this.db)throw new SqliteIntentStorageError('Saved-operation storage is closed.')
  try{
   this.db.exec('BEGIN IMMEDIATE')
   const current=this.db.prepare('SELECT max(revision) AS revision FROM intent_frames WHERE operation_id=?').get(frame.operation_id)?.revision??0
   if(typeof current!=='number'||!Number.isSafeInteger(frame.revision)||frame.revision!==current+1)throw new SqliteIntentStorageError('Saved-operation history changed concurrently. Restart this till to recover its original operations.')
   this.db.prepare('INSERT INTO intent_frames(operation_id,revision,frame) VALUES(?,?,?)').run(frame.operation_id,frame.revision,frame.frame)
   this.db.exec('COMMIT')
  }catch(cause){try{this.db.exec('ROLLBACK')}catch{};throw cause}
 }
 close():void{const db=this.db;this.db=null;db?.close()}
}
