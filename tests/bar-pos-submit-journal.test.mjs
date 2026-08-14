import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { state } from '../src/main/state.js'
import {
  resolvePosSubmitAttempt,
  commitPosSubmitAttempt,
  getPendingPosSubmitAttempt,
  prunePosSubmitAttempts
} from '../src/main/domains/posSubmitJournal.js'

const buildPayload = (overrides = {}) => ({
  id: 'intent-1',
  submit_intent_id: 'intent-1',
  created_at_client: '2026-08-05T08:00:00.000Z',
  outlet_id: 'outlet-1',
  shift_id: 'shift-1',
  cashier_id: 'staff-1',
  items: [{ menu_item_id: 'm-1', quantity: 2 }],
  payment_method: 'cash',
  payment_breakdown: [{ method: 'cash', amount: 20 }],
  total: 20,
  ...overrides
})

function withJournalFile(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-submit-journal-test-'))
  const previous = state.cacheDir
  state.cacheDir = dir
  try {
    return run()
  } finally {
    state.cacheDir = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('the first submission records a pending envelope with the exact client timestamp', () =>
  withJournalFile(() => {
    const resolution = resolvePosSubmitAttempt({
      submitIntentId: 'intent-1',
      orderId: 'intent-1',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload()
    })
    assert.equal(resolution.conflict, false)
    assert.equal(resolution.reused, false)
    assert.equal(resolution.attempt.status, 'pending')
    assert.equal(resolution.attempt.createdAtClient, '2026-08-05T08:00:00.000Z')
    const recovered = getPendingPosSubmitAttempt({ lodgeId: 'lodge-1', userId: 'user-1' })
    assert.equal(recovered?.submitIntentId, 'intent-1')
  }))

test('an exact retry reuses the envelope and keeps the original client timestamp', () =>
  withJournalFile(() => {
    const first = resolvePosSubmitAttempt({
      submitIntentId: 'intent-2',
      orderId: 'intent-2',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload({ id: 'intent-2', submit_intent_id: 'intent-2' })
    })
    const retry = resolvePosSubmitAttempt({
      submitIntentId: 'intent-2',
      orderId: 'intent-2',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload({ id: 'intent-2', submit_intent_id: 'intent-2' })
    })
    assert.equal(retry.conflict, false)
    assert.equal(retry.reused, true)
    assert.equal(retry.attempt.submitIntentId, first.attempt.submitIntentId)
    assert.equal(retry.attempt.createdAtClient, first.attempt.createdAtClient)
    assert.equal(retry.attempt.digest, first.attempt.digest)
  }))

test('a retry with a changed payload fails closed as an idempotency conflict', () =>
  withJournalFile(() => {
    resolvePosSubmitAttempt({
      submitIntentId: 'intent-3',
      orderId: 'intent-3',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload({ id: 'intent-3', submit_intent_id: 'intent-3', total: 20 })
    })
    const changed = resolvePosSubmitAttempt({
      submitIntentId: 'intent-3',
      orderId: 'intent-3',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload({ id: 'intent-3', submit_intent_id: 'intent-3', total: 40 })
    })
    assert.equal(changed.conflict, true)
    assert.ok(changed.error.includes('double-charge'))
    assert.equal(changed.reused, false)
  }))

test('committed attempts settle the envelope and are no longer returned as pending', () =>
  withJournalFile(() => {
    resolvePosSubmitAttempt({
      submitIntentId: 'intent-4',
      orderId: 'intent-4',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload({ id: 'intent-4', submit_intent_id: 'intent-4' })
    })
    commitPosSubmitAttempt('intent-4')
    assert.equal(getPendingPosSubmitAttempt({ lodgeId: 'lodge-1', userId: 'user-1' }), null)
    const retry = resolvePosSubmitAttempt({
      submitIntentId: 'intent-4',
      orderId: 'intent-4',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload({ id: 'intent-4', submit_intent_id: 'intent-4' })
    })
    assert.equal(retry.reused, true)
  }))

test('pending attempts are scoped to the lodge and user that created them', () =>
  withJournalFile(() => {
    resolvePosSubmitAttempt({
      submitIntentId: 'intent-5',
      orderId: 'intent-5',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload({ id: 'intent-5', submit_intent_id: 'intent-5' })
    })
    assert.equal(getPendingPosSubmitAttempt({ lodgeId: 'lodge-2', userId: 'user-1' }), null)
    assert.equal(getPendingPosSubmitAttempt({ lodgeId: 'lodge-1', userId: 'user-2' }), null)
    assert.equal(getPendingPosSubmitAttempt({ lodgeId: 'lodge-1', userId: 'user-1' })?.submitIntentId, 'intent-5')
  }))

test('the newest pending attempt remains recoverable after more than 200 attempts', () =>
  withJournalFile(() => {
    for (let index = 0; index < 201; index += 1) {
      const id = `pending-${index}`
      resolvePosSubmitAttempt({
        submitIntentId: id,
        orderId: id,
        lodgeId: 'lodge-1',
        userId: 'user-1',
        payload: buildPayload({ id, submit_intent_id: id })
      })
    }
    const recovered = getPendingPosSubmitAttempt({ lodgeId: 'lodge-1', userId: 'user-1' })
    assert.equal(recovered?.submitIntentId, 'pending-200')
    const journal = JSON.parse(fs.readFileSync(path.join(state.cacheDir, 'pos-submit-attempts.json'), 'utf8'))
    assert.equal(journal.length, 201)
    assert.ok(journal.some((attempt) => attempt.submitIntentId === 'pending-200'))
  }))

test('pending attempts are never evicted to make room for committed attempts', () =>
  withJournalFile(() => {
    for (let index = 0; index < 201; index += 1) {
      const id = `pending-${index}`
      resolvePosSubmitAttempt({
        submitIntentId: id,
        orderId: id,
        lodgeId: 'lodge-1',
        userId: 'user-1',
        payload: buildPayload({ id, submit_intent_id: id })
      })
    }
    for (let index = 0; index < 205; index += 1) {
      const id = `committed-${index}`
      resolvePosSubmitAttempt({
        submitIntentId: id,
        orderId: id,
        lodgeId: 'lodge-1',
        userId: 'user-1',
        payload: buildPayload({ id, submit_intent_id: id })
      })
      commitPosSubmitAttempt(id)
    }
    const journal = JSON.parse(fs.readFileSync(path.join(state.cacheDir, 'pos-submit-attempts.json'), 'utf8'))
    assert.equal(journal.filter((attempt) => attempt.status === 'pending').length, 201)
    assert.equal(journal.filter((attempt) => attempt.status === 'committed').length, 200)
    assert.ok(journal.some((attempt) => attempt.submitIntentId === 'pending-0'))
    assert.ok(journal.some((attempt) => attempt.submitIntentId === 'committed-204'))
    assert.ok(!journal.some((attempt) => attempt.submitIntentId === 'committed-0'))
  }))

test('old committed entries are pruned while recent committed entries remain', () =>
  withJournalFile(() => {
    const old = new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString()
    const recent = new Date(Date.now() - (60 * 1000)).toISOString()
    fs.writeFileSync(path.join(state.cacheDir, 'pos-submit-attempts.json'), JSON.stringify([
      { submitIntentId: 'old', orderId: 'old', lodgeId: 'lodge-1', userId: 'user-1', status: 'committed', firstAttemptAt: old, lastAttemptAt: old, payload: buildPayload({ id: 'old', submit_intent_id: 'old' }), digest: 'old-digest' },
      { submitIntentId: 'recent', orderId: 'recent', lodgeId: 'lodge-1', userId: 'user-1', status: 'committed', firstAttemptAt: recent, lastAttemptAt: recent, payload: buildPayload({ id: 'recent', submit_intent_id: 'recent' }), digest: 'recent-digest' }
    ]))
    prunePosSubmitAttempts()
    const journal = JSON.parse(fs.readFileSync(path.join(state.cacheDir, 'pos-submit-attempts.json'), 'utf8'))
    assert.deepEqual(journal.map((attempt) => attempt.submitIntentId), ['recent'])
  }))

test('a corrupt journal blocks recovery instead of silently permitting a new sale', () =>
  withJournalFile(() => {
    fs.writeFileSync(path.join(state.cacheDir, 'pos-submit-attempts.json'), '{not-json')
    assert.throws(() => resolvePosSubmitAttempt({
      submitIntentId: 'corrupt-first',
      orderId: 'corrupt-first',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload({ id: 'corrupt-first', submit_intent_id: 'corrupt-first' })
    }), (error) => error?.code === 'pos_submit_journal_unavailable' && /Do not create a new sale/.test(error.message))
    assert.throws(() => resolvePosSubmitAttempt({
      submitIntentId: 'corrupt-second',
      orderId: 'corrupt-second',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload({ id: 'corrupt-second', submit_intent_id: 'corrupt-second' })
    }), /quarantined after a previous corruption failure/)
    assert.ok(fs.existsSync(path.join(state.cacheDir, 'pos-submit-attempts.blocked.json')))
  }))

test('a recovery-marker write failure retains corrupt evidence and keeps the process blocked', () =>
  withJournalFile(() => {
    const journalPath = path.join(state.cacheDir, 'pos-submit-attempts.json')
    const blockedPath = path.join(state.cacheDir, 'pos-submit-attempts.blocked.json')
    fs.writeFileSync(journalPath, '{not-json')
    const originalOpenSync = fs.openSync
    fs.openSync = (filePath, ...args) => {
      if (String(filePath).includes('pos-submit-attempts.blocked.json')) {
        throw new Error('simulated marker write failure')
      }
      return originalOpenSync(filePath, ...args)
    }
    try {
      assert.throws(() => resolvePosSubmitAttempt({
        submitIntentId: 'marker-write-failed',
        orderId: 'marker-write-failed',
        lodgeId: 'lodge-1',
        userId: 'user-1',
        payload: buildPayload({ id: 'marker-write-failed', submit_intent_id: 'marker-write-failed' })
      }), (error) => error?.code === 'pos_submit_journal_unavailable' && /original evidence was retained/i.test(error.message))
    } finally {
      fs.openSync = originalOpenSync
    }

    assert.equal(fs.existsSync(blockedPath), false)
    assert.equal(fs.existsSync(journalPath), true)
    assert.equal(fs.readFileSync(journalPath, 'utf8'), '{not-json')
    assert.equal(fs.readdirSync(state.cacheDir).some((name) => name.includes('.corrupt.')), false)
    assert.throws(() => resolvePosSubmitAttempt({
      submitIntentId: 'must-stay-blocked',
      orderId: 'must-stay-blocked',
      lodgeId: 'lodge-1',
      userId: 'user-1',
      payload: buildPayload({ id: 'must-stay-blocked', submit_intent_id: 'must-stay-blocked' })
    }), (error) => error?.code === 'pos_submit_journal_unavailable' && /blocked for manager or support recovery/i.test(error.message))
  }))
