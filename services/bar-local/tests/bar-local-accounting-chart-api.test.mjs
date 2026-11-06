import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalAccountingApi } from '../../../src/renderer/src/components/restaurant-accounting/barLocalAccountingApi.js'
const scope={businessId:'11111111-1111-4111-8111-111111111111',outletId:'22222222-2222-4222-8222-222222222222',staffId:'33333333-3333-4333-8333-333333333333'}
const accountScope={business_id:scope.businessId,outlet_id:scope.outletId,actor_staff_id:scope.staffId,device_id:'55555555-5555-4555-8555-555555555555'}
const page=(data,overrides={})=>({data,complete:true,pagination:{has_more:false,next_cursor:null},scope:accountScope,snapshot_watermark:7,...overrides})
function storage(){const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}

test('local accounting chart accepts only complete records scoped to the current Bar',async t=>{
 const api=createBarLocalAccountingApi({query:async()=>page([{account_code:'1010',name:'Cash',type:'asset',active:true,version:1,balance:42.5}])},scope)
 assert.deepEqual(await api.list(),[{id:'1010',code:'1010',name:'Cash',account_type:'asset',is_active:true,version:1,balance:42.5}])
 for(const [name,override] of [['cross business',{scope:{...accountScope,business_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}}],['incomplete',{complete:false}]]) await t.test(name,async()=>{
   const broken=createBarLocalAccountingApi({query:async()=>page([],override)},scope)
   await assert.rejects(broken.list(),/incomplete|another Bar session/)
 })
})

test('local chart create and deactivate use a saved versioned authority command and retry the same ID',async()=>{
 const storageValue=storage(),commands=[]
 const api=createBarLocalAccountingApi({
   async query(){return page([])},
   async command(intent){commands.push(intent);throw new Error('reply lost')},
   async retryOperation(id){assert.equal(id,commands[0].operation_id);return {outcome:'committed_local'}}
 },scope)
 const payload={code:'1010',name:'Cash',type:'asset',active:true}
 await assert.rejects(api.save(storageValue,payload),/reply lost/)
 const saved=[...storageValue.values.values()].map(JSON.parse)[0]
 assert.deepEqual(commands[0],{command:'accounting.account.upsert',operation_id:saved.operation_id,payload})
 assert.deepEqual(await api.retry(storageValue),{outcome:'committed_local'})
 assert.equal(api.hasPending(storageValue),null)
})

test('opening balance creates an exact balanced journal and rejects invalid amounts',async t=>{
 const storageValue=storage(),commands=[]
 const api=createBarLocalAccountingApi({async query(){return page([])},async command(intent){commands.push(intent);return {outcome:'committed_local'}}},scope)
 await api.postOpening(storageValue,{account_code:'1010',account_type:'asset',equity_code:'3000',entry_date:'2026-11-05',amount:'12.5'})
 assert.equal(commands[0].command,'accounting.journal.post')
 assert.deepEqual(commands[0].payload.lines,[
  {account_code:'1010',debit:'12.50',credit:'0.00',description:'Opening balance'},
  {account_code:'3000',debit:'0.00',credit:'12.50',description:'Opening balance equity offset'}
 ])
 await api.postOpening(storageValue,{account_code:'2100',account_type:'liability',equity_code:'3000',entry_date:'2026-11-05',amount:'8'})
 assert.deepEqual(commands[1].payload.lines,[
  {account_code:'2100',debit:'0.00',credit:'8.00',description:'Opening balance'},
  {account_code:'3000',debit:'8.00',credit:'0.00',description:'Opening balance equity offset'}
 ])
 for(const amount of ['0','1.999','1,00','-1']) await t.test(amount,()=>assert.throws(()=>api.postOpening(storageValue,{account_code:'1010',account_type:'asset',equity_code:'3000',entry_date:'2026-11-05',amount})))
})

