import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import {
  clearCashupSubmissionRound,
  getCashupSubmissionRound
} from '../src/renderer/src/utils/cashupSubmission.js'

for (const functionName of ['submitPosCashup', 'submitPosCashupWithAttendancePin']) {
  test(`${functionName} waits for cash-affecting returns and voids before offline submission`, async () => {
    const source = readFileSync('src/main/domains/pos.js', 'utf8')
    const start = source.indexOf(`export async function ${functionName}(`)
    const end = source.indexOf('\nexport ', start + 1)
    const shift = { id: 'shift-1', lodge_id: 'lodge-1', outlet_id: 'outlet-1', cashier_id: 'staff-1', status: 'open' }
    const rpc = (table, id, payload) => ({ type: 'rpc', table, _queue_id: id, data: { payload: { lodge_id: 'lodge-1', ...payload } } })
    const queue = [
      rpc('create_pos_order_v3', 'sale-1', { shift_id: 'shift-1' }),
      rpc('create_pos_return_v3', 'return-1', { shift_id: 'shift-1', order_id: 'older-sale' }),
      rpc('approve_pos_void_with_pin', 'void-1', { order_id: 'original-sale', outlet_id: 'outlet-1' }),
      rpc('create_pos_return_v3', 'other-return', { shift_id: 'shift-2' }),
      rpc('approve_pos_void_with_pin', 'other-void', { order_id: 'other-sale', outlet_id: 'outlet-2' }),
    ]
    let recorded
    const scope = {
      state: { isOnline: false, lodgeId: 'lodge-1', currentUser: { id: 'staff-1' } },
      readPosShifts: () => [shift],
      readPosCashupSubmissions: () => [],
      upsertPosCashupSubmission: (row) => row,
      readSyncQueue: () => queue,
      readFailedSyncQueue: () => [],
      readCache: () => [
        { id: 'original-sale', lodge_id: 'lodge-1', outlet_id: 'outlet-1', shift_id: 'shift-1' },
        { id: 'other-sale', lodge_id: 'lodge-1', outlet_id: 'outlet-2', shift_id: 'shift-2' },
      ],
      normalizeMoney: Number,
      randomUUID: () => 'submission-1',
      validateCachedPosPin: () => ({ success: true, staff: { name: 'Staff' } }),
      getDesktopPosDeviceId: () => 'device-1',
      queueOperation: (...args) => { recorded = args },
    }
    const helperStart = source.indexOf('function getPosCashupQueueDependencies(')
    const helperEnd = source.indexOf('\nexport async function submitPosCashup(', helperStart)
    const helper = helperStart < 0 ? '' : source.slice(helperStart, helperEnd)
    const submit = vm.runInNewContext(`${helper}\n${source.slice(start, end).replace('export ', '')}\n${functionName}`, scope)
    const result = await submit({ shift_id: 'shift-1', counted_by_method: { cash: 80 }, pin: '1234', idempotency_key: 'count-1' })
    assert.equal(result.success, true)
    assert.deepEqual(Array.from(recorded[4]._depends_on_all).sort(), ['return-1', 'sale-1', 'void-1'])
    assert.equal(recorded[2].payload.idempotency_key, 'count-1')
    assert.equal(result.submission.expected_cash_drawer, null)
  })
}

function storage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
}

function throwingStorage() {
  return { getItem: () => null, setItem: () => { throw new Error('quota exceeded') }, removeItem: () => {} }
}

const context = {
  lodgeId: 'lodge-1',
  shiftId: 'shift-1',
  actorId: 'staff-1',
  submissionType: 'cashier'
}

test('cash-up exact retries reuse the persisted key and payload fingerprint', () => {
  const store = storage()
  const payload = { shift_id: 'shift-1', counted_by_method: { cash: 100 }, notes: 'handover' }
  const first = getCashupSubmissionRound({ ...context, payload, storage: store })
  const retry = getCashupSubmissionRound({ ...context, payload, storage: store })

  assert.ok(first.round.idempotencyKey)
  assert.equal(retry.round.idempotencyKey, first.round.idempotencyKey)
  assert.equal(retry.reused, true)
})

test('changed cash-up details cannot reuse an unresolved round', () => {
  const store = storage()
  getCashupSubmissionRound({ ...context, payload: { cash: 100, notes: 'one' }, storage: store })
  const changed = getCashupSubmissionRound({ ...context, payload: { cash: 101, notes: 'two' }, storage: store })

  assert.equal(changed.conflict, true)
  assert.match(changed.error, /original count and notes/i)
})

test('only a rejection matching the saved operation key rotates the round key', () => {
  const store = storage()
  const first = getCashupSubmissionRound({ ...context, payload: { cash: 100 }, storage: store })
  const rotated = getCashupSubmissionRound({
    ...context,
    payload: { cash: 101 },
    serverStatus: 'rejected',
    serverIdempotencyKey: first.round.idempotencyKey,
    storage: store
  })

  assert.notEqual(rotated.round.idempotencyKey, first.round.idempotencyKey)
  assert.equal(rotated.rotated, true)
})

test('a stale rejection cannot rotate a corrected round after response loss', () => {
  const store = storage()
  const payload = { cash: 101, notes: 'corrected' }
  const corrected = getCashupSubmissionRound({
    ...context,
    payload,
    serverStatus: 'rejected',
    serverIdempotencyKey: 'the-previous-rejected-round',
    storage: store
  })
  const retry = getCashupSubmissionRound({
    ...context,
    payload,
    serverStatus: 'rejected',
    serverIdempotencyKey: 'the-previous-rejected-round',
    storage: store
  })

  assert.equal(retry.round.idempotencyKey, corrected.round.idempotencyKey)
  assert.equal(retry.reused, true)
  assert.equal(retry.rotated, undefined)
})

test('a rejection without an authoritative operation key fails safe and reuses the exact round', () => {
  const store = storage()
  const payload = { cash: 101 }
  const corrected = getCashupSubmissionRound({ ...context, payload, serverStatus: 'rejected', storage: store })
  const retry = getCashupSubmissionRound({ ...context, payload, serverStatus: 'rejected', storage: store })

  assert.equal(retry.round.idempotencyKey, corrected.round.idempotencyKey)
  assert.equal(retry.reused, true)
})

test('cash-up read contracts expose only the operation key needed for rejection correlation', () => {
  const sql = readFileSync('supabase/migrations/20260806110000_cashup_retry_resolution_keys.sql', 'utf8')
  const myCashup = readFileSync('src/renderer/src/components/hospitality-pos/HposMyCashup.jsx', 'utf8')
  const sharedCashup = readFileSync('src/renderer/src/components/hospitality-pos/HposSharedCashup.jsx', 'utf8')
  const posDomain = readFileSync('src/main/domains/pos.js', 'utf8')

  assert.match(sql, /get_my_pos_cashup_submission[\s\S]*?'idempotency_key', v_row\.idempotency_key/i)
  assert.match(sql, /get_staff_pos_cashup_submission[\s\S]*?'idempotency_key', v_row\.idempotency_key/i)
  assert.match(myCashup, /serverIdempotencyKey: submission\?\.idempotency_key/)
  assert.match(sharedCashup, /serverIdempotencyKey: submission\?\.idempotency_key/)
  assert.match(posDomain, /idempotency_key: data\.submission\.idempotency_key/)
  assert.doesNotMatch(sql.match(/create or replace function public\.get_my_pos_cashup_submission[\s\S]*?end;\s*\$\$;/i)?.[0] || '', /expected_cash_drawer|variance_by_method|expected_by_method/i)
})

test('authoritative success clears the round for a future submission', () => {
  const store = storage()
  const first = getCashupSubmissionRound({ ...context, payload: { cash: 100 }, storage: store })
  const cleared = getCashupSubmissionRound({ ...context, payload: { cash: 100 }, serverStatus: 'submitted', storage: store })
  const next = getCashupSubmissionRound({ ...context, payload: { cash: 100 }, storage: store })

  assert.equal(cleared.cleared, true)
  assert.notEqual(next.round.idempotencyKey, first.round.idempotencyKey)
  clearCashupSubmissionRound({ ...context, storage: store })
})

test('storage write failure fails closed before a cash-up round is returned', () => {
  const result = getCashupSubmissionRound({ ...context, payload: { cash: 100 }, storage: throwingStorage() })
  assert.equal(result.conflict, true)
  assert.equal(result.durable, false)
  assert.match(result.error, /durably saved|storage/i)
})

test('read-back mismatch fails closed', () => {
  const values = new Map()
  const store = {
    getItem: (key) => values.get(key) || null,
    setItem: (key) => values.set(key, JSON.stringify({ tampered: true })),
    removeItem: (key) => values.delete(key)
  }
  const result = getCashupSubmissionRound({ ...context, payload: { cash: 100 }, storage: store })
  assert.equal(result.conflict, true)
  assert.equal(result.durable, false)
})

test('missing financial scope IDs never create a round', () => {
  for (const key of ['lodgeId', 'shiftId', 'actorId']) {
    const input = { ...context, payload: { cash: 100 }, storage: storage() }
    input[key] = key === 'lodgeId' ? 'current' : ''
    const result = getCashupSubmissionRound(input)
    assert.equal(result.conflict, true)
    assert.equal(result.durable, false)
  }
})

test('an authenticated manager change is blocked while a shared round is unresolved', () => {
  const store = storage()
  const first = getCashupSubmissionRound({ ...context, submissionType: 'shared_terminal', operatorId: 'staff-9', payload: { cash: 100 }, storage: store })
  const changedManager = getCashupSubmissionRound({ ...context, actorId: 'manager-2', submissionType: 'shared_terminal', operatorId: 'staff-9', payload: { cash: 100 }, storage: store })
  assert.ok(first.round)
  assert.equal(changedManager.conflict, true)
  assert.match(changedManager.error, /manager changed/i)
})

test('restart recovery retains the original identities, payload and key', () => {
  const store = storage()
  const payload = { shift_id: 'shift-1', counted_by_method: { cash: 100 }, notes: 'original', actor_id: 'manager-1', operator_id: 'staff-1' }
  const first = getCashupSubmissionRound({ ...context, actorId: 'manager-1', operatorId: 'staff-1', submissionType: 'shared_terminal', payload, storage: store })
  const recovered = getCashupSubmissionRound({ ...context, actorId: 'manager-1', operatorId: 'staff-1', submissionType: 'shared_terminal', payload, storage: store })
  assert.equal(recovered.round.idempotencyKey, first.round.idempotencyKey)
  assert.deepEqual(recovered.round.payload, payload)
  assert.equal(recovered.round.operatorId, 'staff-1')
})
