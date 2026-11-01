// @ts-check
import {existsSync,readFileSync} from 'node:fs'
import {IntentJournal} from './intents.js'
import {SqliteFrameStore,SqliteIntentStorageError} from './sqliteFrameStore.ts'
import {decodeJournalRecord} from '../../shared/barLocalJournalProtection.js'

/**
 * Migrates only a fully validated old journal. Original JSONL history remains
 * available for recovery, but is never read again once SQLite is published.
 * @param {{filePath:string,legacyFilePath?:string,clock?:()=>Date,protection?:{encrypt(text:string):string,decrypt(text:string):string}}} options
 */
export function openSqliteIntentJournal(options){
 const storage=new SqliteFrameStore(options.filePath,()=>{
  if(!options.legacyFilePath||!existsSync(options.legacyFilePath))return []
  try{
   const legacy=new IntentJournal({filePath:options.legacyFilePath,fsync:true,...(options.protection?{protection:options.protection}:{})})
   legacy.close()
   return readFileSync(options.legacyFilePath,'utf8').split('\n').filter(line=>line.trim()!=='').map(frame=>{
    const record=decodeJournalRecord(JSON.parse(frame),options.protection??null)
    if(typeof record.operation_id!=='string'||typeof record.revision!=='number'||!Number.isSafeInteger(record.revision))throw new Error('The existing journal frame identity is invalid.')
    return {operation_id:record.operation_id,revision:record.revision,frame}
   })
  }catch(cause){throw new SqliteIntentStorageError('The existing operation journal could not be safely migrated. OS-protected storage and an intact original journal are required. Preserve the original file and Windows profile for recovery.',{cause})}
 })
 try{return new IntentJournal({storage,...(options.clock?{clock:options.clock}:{}),...(options.protection?{protection:options.protection}:{})})}
 catch(error){storage.close();throw error}
}
