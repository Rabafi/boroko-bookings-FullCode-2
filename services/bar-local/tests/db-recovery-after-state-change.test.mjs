import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

test('committed sale recovery survives menu removal and shift close while unsubmitted and new work are refused', async t => {
  const h = await createHarness(t)
  const shift = await h.openShift('0.00')
  const product = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku:'RECOVERY-ONLY', name:'Synthetic recovery product', price:'10.00', tax_rate:'0', track_stock:false
  }))
  assert.equal(product.ok,true,JSON.stringify(product.error))
  const payload = {shift_id:shift,items:[{product_id:product.result.product_id,quantity:'1'}],
    tenders:[{method:'cash',amount:'10.00',tendered:'10.00'}]}
  const operation = h.envelope('sale.commit',payload)
  const committed = await h.call('cmd_sale_commit',operation)
  assert.equal(committed.ok,true,JSON.stringify(committed.error))
  const unavailable = await h.call('cmd_catalogue_availability_set',h.envelope('catalogue.availability.set',{
    product_id:product.result.product_id,available:false
  }))
  assert.equal(unavailable.ok,true,JSON.stringify(unavailable.error))
  const unsubmitted = h.envelope('sale.commit', payload)
  const originalShift = (await h.migrator.query('SELECT business_date::text AS business_date FROM bar_local.shifts WHERE id=$1', [shift])).rows[0]
  const closed = await h.call('cmd_shift_close',h.envelope('shift.close',{shift_id:shift,counted_cash:'10.00'}))
  assert.equal(closed.ok,true,JSON.stringify(closed.error))
  const restartedClient = await h.newRuntimeClient()
  const replay = await h.callWith(restartedClient,'cmd_sale_commit',operation)
  assert.equal(replay.ok,true,JSON.stringify(replay.error))
  assert.equal(replay.replayed,true)
  assert.deepEqual(replay.receipt,committed.receipt)
  assert.deepEqual(replay.result,committed.result)
  const delayed = await h.callWith(restartedClient,'cmd_sale_commit',unsubmitted)
  assert.equal(delayed.ok,false)
  assert.equal(delayed.error.code,'SHIFT_CLOSED')
  const delayedRecord = (await h.migrator.query('SELECT status, payload, business_date FROM bar_local.operations WHERE operation_id=$1', [unsubmitted.operation_id])).rows[0]
  assert.equal(delayedRecord.status,'refused')
  assert.equal(delayedRecord.payload.shift_id,shift)
  assert.equal(delayedRecord.business_date,null,'an uncommitted sale must not be assigned a different business date during recovery')
  const currentShift = (await h.migrator.query('SELECT business_date::text AS business_date, status FROM bar_local.shifts WHERE id=$1', [shift])).rows[0]
  assert.equal(currentShift.business_date, originalShift.business_date)
  assert.equal(currentShift.status,'closed')
  const fresh = await h.callWith(restartedClient,'cmd_sale_commit',h.envelope('sale.commit',payload))
  assert.equal(fresh.ok,false)
  assert.equal(fresh.error.code,'SHIFT_CLOSED')
  const counts = (await h.migrator.query(`SELECT
    (SELECT count(*)::int FROM bar_local.sales) AS sales,
    (SELECT count(*)::int FROM bar_local.operations WHERE command='sale.commit' AND status='committed') AS committed,
    (SELECT count(*)::int FROM bar_local.operations WHERE command='sale.commit' AND status='refused') AS refused`)).rows[0]
  assert.deepEqual(counts,{sales:1,committed:1,refused:2})
})
