import test from 'node:test'
import assert from 'node:assert/strict'
import {createHarness,sha256Json} from './harness.mjs'

test('missing and malformed approval hashes cannot consume a valid approval or authorise an action',async t=>{
 const h=await createHarness(t)
 const hash=sha256Json({synthetic:'exact approved action'})
 const approval=await h.approve('pos.void',hash)
 for(const supplied of [null,'','invalid','0'.repeat(63)]){
  await assert.rejects(h.migrator.query('SELECT bar_local.consume_approval($1,$2,$3,$4,$5,$6)',
   [approval,supplied,'pos.void',h.businessId,h.outletId,h.ownerStaffId]),error=>error.detail==='APPROVAL_SCOPE_MISMATCH')
 }
 const unchanged=(await h.migrator.query('SELECT consumed_at FROM bar_local.approvals WHERE id=$1',[approval])).rows[0]
 assert.equal(unchanged.consumed_at,null)
 const accepted=await h.migrator.query('SELECT bar_local.consume_approval($1,$2,$3,$4,$5,$6) AS id',
  [approval,hash,'pos.void',h.businessId,h.outletId,h.ownerStaffId])
 assert.equal(accepted.rows[0].id,approval)
 await assert.rejects(h.migrator.query('SELECT bar_local.consume_approval($1,$2,$3,$4,$5,$6)',
  [approval,hash,'pos.void',h.businessId,h.outletId,h.ownerStaffId]),error=>error.detail==='APPROVAL_CONSUMED')
 await assert.rejects(h.runtime.query('SELECT bar_local.consume_approval_before_hash_guard($1,$2,$3,$4,$5,$6)',
  [approval,null,'pos.void',h.businessId,h.outletId,h.ownerStaffId]),error=>error.code==='42501')
 const stale=await h.approve('pos.void',hash)
 await h.migrator.query("UPDATE bar_local.staff SET capabilities=ARRAY[]::text[] WHERE id=$1",[h.managerStaffId])
 await assert.rejects(h.migrator.query('SELECT bar_local.consume_approval($1,$2,$3,$4,$5,$6)',
  [stale,hash,'pos.void',h.businessId,h.outletId,h.ownerStaffId]),error=>error.detail==='APPROVAL_INVALID')
 assert.equal((await h.migrator.query('SELECT consumed_at FROM bar_local.approvals WHERE id=$1',[stale])).rows[0].consumed_at,null)
})
