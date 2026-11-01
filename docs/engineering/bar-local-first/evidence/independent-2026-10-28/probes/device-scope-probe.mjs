import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {executeCommand} from '../../../../../../services/bar-local/dist/commands.js'
let dbCalls=0
const envelope={contract_version:1,operation_id:randomUUID(),command:'catalogue.upsert',authority_id:randomUUID(),authority_epoch:1,business_id:randomUUID(),outlet_id:randomUUID(),device_id:randomUUID(),payload:{sku:'PROBE',name:'Probe',category:'Test',price:'1.00',tax_rate:'0',track_stock:false}}
let caught
try{await executeCommand({pool:{query(){dbCalls++;throw Error('DB must not be reached')}},config:{},tokenHash:'00'.repeat(32),deviceId:randomUUID(),envelope})}catch(e){caught=e}
assert.equal(caught?.code,'AUTH_INVALID')
assert.equal(caught?.httpStatus,401)
assert.equal(dbCalls,0)
const result={pass:true,code:caught.code,httpStatus:caught.httpStatus,database_calls:dbCalls,note:'Forged device is denied before DB execution. api-scope-isolation.test.mjs incorrectly expects HTTP200/refused for every scope field.'}
writeFileSync('docs/engineering/bar-local-first/evidence/independent-2026-10-28/device-scope-probe.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result))

