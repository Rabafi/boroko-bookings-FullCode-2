import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {getCommand,getQuery} from '@tsa-bonno/bar-contracts'

test('handover contracts require both drawers and receipt confirmation without silently dropping handover fields',()=>{
 const definition=getCommand('drawer.movement')
 const payload={shift_id:randomUUID(),source_shift_id:randomUUID(),type:'handover',amount:'10.25',reason:'Counted cash',receiver_confirmed:true}
 assert.equal(definition.validate(payload).source_shift_id,payload.source_shift_id)
 assert.equal(definition.approval,'pos.cashup')
 assert.equal(getQuery('drawer.open_shifts').capability,'pos.cashup')
 for(const patch of [{receiver_confirmed:false},{receiver_confirmed:undefined},{source_shift_id:undefined},{amount:'0.00'},{amount:'10.251'}]){
  assert.throws(()=>definition.validate({...payload,...patch}))
 }
 for(const type of ['paid_in','paid_out','count','float']){
  assert.throws(()=>definition.validate({...payload,type}),/handover fields/)
  assert.equal(definition.validate({shift_id:payload.shift_id,type,amount:'10.25',reason:'Ordinary movement'}).type,type)
 }
 assert.throws(()=>definition.validate({shift_id:payload.shift_id,type:'tip_payout',amount:'10.25',reason:'Use the approved workforce payout contract'}))
})
