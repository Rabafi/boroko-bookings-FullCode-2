import test from 'node:test'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { journalProtection } from '../../src/shared/barLocalJournalProtection.js'
import { IntentJournal as Modern } from '../../src/main/bar-local/intents.js'
import { IntentJournal as Legacy } from '../../legacy-pos/src/main/bar-local/intents.js'

function protection() {
 const key=randomBytes(32)
 return journalProtection({isEncryptionAvailable:()=>true,
  encryptString(text){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),data])},
  decryptString(buffer){const d=createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));d.setAuthTag(buffer.subarray(12,28));return Buffer.concat([d.update(buffer.subarray(28)),d.final()]).toString('utf8')}
 })
}
function envelope(){return {contract_version:1,operation_id:randomUUID(),authority_id:randomUUID(),authority_epoch:1,business_id:randomUUID(),outlet_id:randomUUID(),device_id:randomUUID(),payload_version:1,command:'staff.create',payload:{display_name:'Synthetic staff',role:'cashier',pin:'739281'}}}
for(const [name,Journal] of [['Modern',Modern],['Legacy',Legacy]]){
 test(`${name} fences further writes after a partial disk failure and recovers the original identity on restart`,()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'bar-partial-write-')),filePath=path.join(dir,'journal.jsonl'),env=envelope(),codec=protection()
  const originalWrite=fs.writeSync
  try{
   const journal=new Journal({filePath,protection:codec})
   fs.writeSync=(fd,buffer,offset,length,position)=>{
    originalWrite(fd,buffer,offset,Math.min(17,length),position)
    throw Object.assign(new Error('Synthetic full disk'),{code:'ENOSPC'})
   }
   syncBuiltinESMExports()
   const save=()=>name==='Modern'?journal.createIntent(env):journal.createIntent({operationId:env.operation_id,envelope:env})
   assert.throws(save,/storage failed/i)
   fs.writeSync=originalWrite;syncBuiltinESMExports()
   const failedBytes=readFileSync(filePath)
   assert.throws(save,/closed|storage failed/i)
   assert.deepEqual(readFileSync(filePath),failedBytes,'a failed journal must never append behind a torn frame')
   journal.close?.()
   const recovered=new Journal({filePath,protection:codec})
   const saved=name==='Modern'?recovered.createIntent(env):recovered.createIntent({operationId:env.operation_id,envelope:env})
   assert.equal(saved.operation_id,env.operation_id)
   recovered.close?.()
  }finally{fs.writeSync=originalWrite;syncBuiltinESMExports();rmSync(dir,{recursive:true,force:true})}
 })
 test(`${name} protects staff credentials before append and preserves exact retry data`,()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'bar-pin-test-')),filePath=path.join(dir,'journal.jsonl'),codec=protection(),env=envelope()
  try{
   const journal=new Journal({filePath,protection:codec})
   if(name==='Modern')journal.createIntent(env);else journal.createIntent({operationId:env.operation_id,envelope:env})
   const saved=readFileSync(filePath,'utf8')
   assert.ok(!saved.includes('739281'));assert.ok(saved.includes('protected_journal_record'))
   journal.close?.()
   writeFileSync(filePath, saved.trimEnd())
   assert.throws(()=>new Journal({filePath}),/protected.*journal/i)
   assert.equal(readFileSync(filePath,'utf8'),saved.trimEnd(),'missing key must not discard the operation')
   const reopened=new Journal({filePath,protection:codec})
   const intent=name==='Modern'?reopened.get(env.operation_id):reopened.getIntent(env.operation_id)
   assert.equal(intent.envelope.payload.pin,'739281');assert.equal(intent.operation_id,env.operation_id)
   reopened.close?.()
   const plaintext = readFileSync(filePath,'utf8').trim().split('\n').map(line=>{
    const record=JSON.parse(line)
    return record.protected_journal_record===1 ? codec.decrypt(record.encrypted_record) : line
   }).join('\n')+'\n'
   writeFileSync(filePath,plaintext)
   assert.ok(plaintext.includes('739281'))
   const upgraded=new Journal({filePath,protection:codec})
   assert.ok(!readFileSync(filePath,'utf8').includes('739281'),'older plaintext journals must be protected on load')
   const recovered=name==='Modern'?upgraded.get(env.operation_id):upgraded.getIntent(env.operation_id)
   assert.equal(recovered.envelope.payload.pin,'739281')
   upgraded.close?.()
  }finally{rmSync(dir,{recursive:true,force:true})}
 })
 test(`${name} refuses credential journalling when OS protection is unavailable`,()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'bar-pin-refusal-')),filePath=path.join(dir,'journal.jsonl'),env=envelope()
  try{const journal=new Journal({filePath});assert.throws(()=>name==='Modern'?journal.createIntent(env):journal.createIntent({operationId:env.operation_id,envelope:env}),/protected.*storage/i);journal.close?.()}finally{rmSync(dir,{recursive:true,force:true})}
 })
}
