import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCompleteBarList } from '../../src/shared/barLocalPagination.js'
const scope = {business_id:'business',outlet_id:'outlet',device_id:'device',actor_staff_id:'staff'}
const page = (data, next=null, version=1) => ({data,complete:true,scope,snapshot_watermark:version,pagination:{has_more:next!==null,next_cursor:next}})
test('complete lists consume every page and preserve empty lists', async()=>{
 const calls=[]
 const rows=await loadCompleteBarList(async(name,filters)=>{calls.push(filters);return filters.cursor?page([{id:2}]):page([{id:1}],'next')},'stock.list')
 assert.deepEqual(rows,[{id:1},{id:2}]);assert.equal(calls[1].cursor,'next')
 assert.deepEqual(await loadCompleteBarList(async()=>page([]),'stock.list'),[])
})
test('complete lists restart concurrent snapshots instead of mixing them',async()=>{
 let n=0
 assert.deepEqual(await loadCompleteBarList(async()=>[page([{id:1}],'next'),page([{id:2}],null,2),page([{id:3}],null,2)][n++],'stock.list'),[{id:3}])
})
test('incomplete, looping, changing-scope and persistently changing lists fail closed',async()=>{
 await assert.rejects(loadCompleteBarList(async()=>({...page([]),complete:false}),'stock.list'),/incomplete/)
 await assert.rejects(loadCompleteBarList(async()=>page([{id:1}],'same'),'stock.list'),/finish/)
 let n=0;await assert.rejects(loadCompleteBarList(async()=>n++===0?page([{id:1}],'next'):{...page([{id:2}]),scope:{...scope,outlet_id:'other'}},'stock.list'),/business/)
 n=0;await assert.rejects(loadCompleteBarList(async()=>page([{id:++n}],'next',n),'stock.list'),/changed while/)
})
