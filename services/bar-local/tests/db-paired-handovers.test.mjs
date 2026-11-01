import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createHarness,sha256Json} from './harness.mjs'

test('paired handovers conserve both drawers, bind outgoing identity, replay once and serialize competing transfers',async t=>{
 const h=await createHarness(t)
 await h.seedShiftCatalogue()
 const target=await h.openShift('10.00')
 const sourceResult=await h.call('cmd_shift_open',h.envelope('shift.open',{opening_float:'100.00'}),{tokenHash:h.managerTokenHash})
 assert.equal(sourceResult.ok,true,JSON.stringify(sourceResult.error))
 const source=sourceResult.result.shift_id
 const list=await h.query('drawer.open_shifts')
 assert.equal(list.complete,true);assert.deepEqual(list.data.map(row=>row.shift_id),[source])
 assert.deepEqual(Object.keys(list.data[0]).sort(),['display_name','opened_at','shift_id','staff_id'])
 await assert.rejects(h.runtime.query('SELECT bar_local.query_open_drawers($1,$2,$3,$4,$5)',[h.ownerTokenHash,h.deviceId,h.authorityId,1,{}]),error=>error.code==='42501')
 const balances=async()=> (await h.migrator.query('SELECT bar_local.expected_shift_cash($1)::text AS source,bar_local.expected_shift_cash($2)::text AS target',[source,target])).rows[0]
 const approved=async(amount,patch={},approver=h.managerStaffId)=>{
  const payload={shift_id:target,source_shift_id:source,type:'handover',amount,reason:'Synthetic paired cash count',receiver_confirmed:true,...patch}
  const hash=sha256Json(payload)
  const id=await h.approve('pos.cashup',hash,{approverStaffId:approver})
  return {env:h.envelope('drawer.movement',{...payload,approval_id:id}),hash,id}
 }
 const first=await approved('30.00')
 const result=await h.call('cmd_drawer_movement',first.env,{approvalHash:first.hash})
 assert.equal(result.ok,true,JSON.stringify(result.error));assert.equal(result.result.source_expected_cash,'70.00')
 assert.equal(result.result.receiver_expected_cash,'40.00');assert.deepEqual(await balances(),{source:'70.00',target:'40.00'})
 const replay=await h.call('cmd_drawer_movement',first.env,{approvalHash:first.hash})
 assert.equal(replay.replayed,true);assert.deepEqual(replay.result,result.result)
 assert.equal((await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.cash_movements WHERE operation_id=$1',[first.env.operation_id])).rows[0].n,2)
 assert.equal((await h.migrator.query('SELECT count(*)::int AS n FROM bar_local.audit_log WHERE operation_id=$1',[first.env.operation_id])).rows[0].n,1)
 const missingHash=await approved('1.00')
 const deniedHash=await h.call('cmd_drawer_movement',missingHash.env)
 assert.equal(deniedHash.ok,false);assert.equal(deniedHash.error.code,'APPROVAL_SCOPE_MISMATCH')
 const wrong=await approved('1.00',{},h.ownerStaffId)
 const deniedActor=await h.call('cmd_drawer_movement',wrong.env,{approvalHash:wrong.hash})
 assert.equal(deniedActor.ok,false);assert.equal(deniedActor.error.code,'APPROVAL_INVALID')
 for(const patch of [{receiver_confirmed:false},{source_shift_id:target},{source_shift_id:randomUUID()}]){
  const item=await approved('1.00',patch)
  assert.equal((await h.call('cmd_drawer_movement',item.env,{approvalHash:item.hash})).ok,false)
 }
 const tooMuch=await approved('70.01')
 assert.equal((await h.call('cmd_drawer_movement',tooMuch.env,{approvalHash:tooMuch.hash})).ok,false)
 assert.deepEqual(await balances(),{source:'70.00',target:'40.00'})
 const a=await approved('40.00'),b=await approved('40.00'),other=await h.newRuntimeClient()
 const competing=await Promise.all([
  h.call('cmd_drawer_movement',a.env,{approvalHash:a.hash}),
  h.callWith(other,'cmd_drawer_movement',b.env,{approvalHash:b.hash})
 ])
 assert.equal(competing.filter(value=>value.ok).length,1)
 assert.deepEqual(await balances(),{source:'30.00',target:'80.00'})
 const mismatch={...first.env,payload:{...first.env.payload,amount:'31.00'}}
 await assert.rejects(h.call('cmd_drawer_movement',mismatch),/idempotency|payload|different/i)
 const stale=await approved('1.00')
 await h.migrator.query("UPDATE bar_local.staff SET status='suspended' WHERE id=$1",[h.managerStaffId])
 assert.equal((await h.call('cmd_drawer_movement',stale.env,{approvalHash:stale.hash})).ok,false)
 assert.deepEqual((await h.query('drawer.open_shifts')).data,[])
 assert.deepEqual(await balances(),{source:'30.00',target:'80.00'})
})
