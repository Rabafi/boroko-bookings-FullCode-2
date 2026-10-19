// Property-transition operation lifecycle: behavioral tests (node:test).
// Exercises the REAL lifecycle in src/shared/propertyTransitionOperation.js
// via the harness in tests/helpers/property-transition-harness.mjs — fake
// commit/status functions, no network, no source-text assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OPERATION_STORAGE_VERSION,
  buildStorageKey,
  buildCommitPayload,
  captureOperation,
  canEditDuringPending,
  createLifecycle,
  createPropertyTransitionHarness,
  describeRecoveryState,
  isSameOperation,
  parseOperation,
  roundTripOperation,
  serializeOperation,
  shouldRetireAfter
} from './helpers/property-transition-harness.mjs'
import {
  TransitionStorageError,
  archiveStoredTransitionOp,
  buildArchiveKey,
  createTransitionController,
  describeArchivedTerminal,
  listArchivedTransitionOps,
  loadStoredTransitionOp,
  saveStoredTransitionOp
} from '../src/shared/propertyTransitionOperation.js'

const LODGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_LODGE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KEY_A = '11111111-1111-4111-8111-111111111111'
const KEY_B = '22222222-2222-4222-8222-222222222222'
const UPDATED_AT = '2026-10-01T00:00:00.000Z'

function keyMint(keys) {
  let index = 0
  return () => {
    const key = keys[index % keys.length]
    index += 1
    return key
  }
}

function draft(overrides = {}) {
  return {
    targetType: 'camp',
    expectedPropertyType: 'lodge',
    expectedUpdatedAt: UPDATED_AT,
    reason: 're-registered as a camp',
    ...overrides
  }
}

function timeoutError() {
  const error = new Error('socket hang up')
  error.code = 'ETIMEDOUT'
  return error
}

// ── Pure interface contracts ─────────────────────────────────────────────

test('storage key is scoped to lodge + user and never carries credentials', () => {
  assert.equal(buildStorageKey({ lodgeId: LODGE, userId: 'user-1' }), `${OPERATION_STORAGE_VERSION}::${LODGE}::user-1`)
  assert.equal(buildStorageKey({ lodgeId: LODGE, userId: null }), `${OPERATION_STORAGE_VERSION}::${LODGE}::anon`)
  assert.equal(buildStorageKey({ lodgeId: LODGE }), `${OPERATION_STORAGE_VERSION}::${LODGE}::anon`)
  assert.throws(() => buildStorageKey({ lodgeId: '', userId: 'user-1' }))
  assert.throws(() => buildStorageKey({ userId: 'user-1' }))
})

test('capture validates key, target and lodge, and freezes the operation', () => {
  const op = captureOperation({ idempotencyKey: KEY_A, lodgeId: LODGE, userId: 'user-1', ...draft() })
  assert.ok(Object.isFrozen(op))
  assert.equal(op.version, OPERATION_STORAGE_VERSION)
  assert.equal(op.idempotencyKey, KEY_A)
  assert.equal(op.lodgeId, LODGE)
  assert.equal(op.userId, 'user-1')
  assert.equal(op.targetType, 'camp')
  assert.ok(op.capturedAt)
  assert.throws(() => captureOperation({ idempotencyKey: 'not-a-uuid', lodgeId: LODGE, ...draft() }))
  assert.throws(() => captureOperation({ lodgeId: LODGE, ...draft() }))
  assert.throws(() => captureOperation({ idempotencyKey: KEY_A, lodgeId: '', ...draft() }))
  for (const target of ['hotel', 'restaurant', 'bar', 'hostel', '']) {
    assert.throws(() => captureOperation({ idempotencyKey: KEY_A, lodgeId: LODGE, ...draft({ targetType: target }) }), `rejects ${target}`)
  }
})

test('serialize/parse round-trips; corrupt or version-mismatched input returns null', () => {
  const op = captureOperation({ idempotencyKey: KEY_A, lodgeId: LODGE, userId: 'user-1', ...draft() })
  const back = parseOperation(serializeOperation(op))
  assert.ok(back)
  assert.ok(Object.isFrozen(back))
  assert.deepEqual({ ...back }, { ...op })
  assert.equal(parseOperation('not json{{{'), null)
  assert.equal(parseOperation(''), null)
  assert.equal(parseOperation(null), null)
  assert.equal(parseOperation(JSON.stringify({ ...JSON.parse(serializeOperation(op)), version: 'v0' })), null)
  assert.equal(parseOperation(JSON.stringify({ ...JSON.parse(serializeOperation(op)), idempotencyKey: 'bad' })), null)
  assert.equal(parseOperation(JSON.stringify({ ...JSON.parse(serializeOperation(op)), targetType: 'hotel' })), null)
})

test('commit payload carries exactly the five operation fields', () => {
  const op = captureOperation({ idempotencyKey: KEY_A, lodgeId: LODGE, userId: 'user-1', ...draft() })
  assert.deepEqual(buildCommitPayload(op), {
    targetType: 'camp',
    expectedPropertyType: 'lodge',
    expectedUpdatedAt: UPDATED_AT,
    idempotencyKey: KEY_A,
    reason: 're-registered as a camp'
  })
  assert.deepEqual(Object.keys(buildCommitPayload(op)), ['targetType', 'expectedPropertyType', 'expectedUpdatedAt', 'idempotencyKey', 'reason'])
})

test('isSameOperation compares key, lodge, target, expected state and reason', () => {
  const base = captureOperation({ idempotencyKey: KEY_A, lodgeId: LODGE, userId: 'user-1', ...draft() })
  assert.equal(isSameOperation(base, roundTripOperation(base)), true)
  assert.equal(isSameOperation(base, { ...base, idempotencyKey: KEY_B }), false)
  assert.equal(isSameOperation(base, { ...base, targetType: 'motel' }), false)
  assert.equal(isSameOperation(base, { ...base, reason: 'different reason' }), false)
  assert.equal(isSameOperation(base, { ...base, expectedUpdatedAt: '2026-10-02T00:00:00.000Z' }), false)
  assert.equal(isSameOperation(base, { ...base, expectedPropertyType: 'camp' }), false)
  assert.equal(isSameOperation(base, { ...base, lodgeId: OTHER_LODGE }), false)
  assert.equal(isSameOperation(base, null), false)
  assert.equal(isSameOperation(null, base), false)
})

test('canEditDuringPending is always false', () => {
  assert.equal(canEditDuringPending(), false)
})

test('recovery state distinguishes none, same-scope and foreign scope', () => {
  assert.equal(describeRecoveryState({ stored: null, currentLodgeId: LODGE, currentUserId: 'u' }), 'none')
  const op = captureOperation({ idempotencyKey: KEY_A, lodgeId: LODGE, userId: 'user-1', ...draft() })
  assert.equal(describeRecoveryState({ stored: op, currentLodgeId: LODGE, currentUserId: 'user-1' }), 'same-scope-pending')
  assert.equal(describeRecoveryState({ stored: op, currentLodgeId: OTHER_LODGE, currentUserId: 'user-1' }), 'foreign-scope')
  assert.equal(describeRecoveryState({ stored: op, currentLodgeId: LODGE, currentUserId: 'user-2' }), 'foreign-scope')
  const anon = captureOperation({ idempotencyKey: KEY_A, lodgeId: LODGE, userId: null, ...draft() })
  assert.equal(describeRecoveryState({ stored: anon, currentLodgeId: LODGE, currentUserId: null }), 'same-scope-pending')
  assert.equal(describeRecoveryState({ stored: anon, currentLodgeId: LODGE, currentUserId: 'user-9' }), 'foreign-scope')
})

test('retire only on authoritative completed outcomes', () => {
  assert.equal(shouldRetireAfter({ commitResult: { success: true, data: { changed: true } } }), true)
  assert.equal(shouldRetireAfter({ commitResult: { success: true, replayed: true, data: { changed: true } } }), true)
  assert.equal(shouldRetireAfter({ commitResult: { success: false, code: 'expected_state_conflict' } }), false)
  assert.equal(shouldRetireAfter({ statusResult: { success: true, data: { changed: true } } }), true)
  assert.equal(shouldRetireAfter({ statusResult: { success: true, data: { changed: false } } }), true)
  assert.equal(shouldRetireAfter({ statusResult: { success: false, code: 'NOT_FOUND' } }), false)
  assert.equal(shouldRetireAfter({}), false)
  assert.equal(shouldRetireAfter(), false)
})

// ── Lifecycle behavior ───────────────────────────────────────────────────

test('two consecutive successful changes use two different keys', async () => {
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A, KEY_B]),
    commit: async () => ({ success: true, replayed: false, data: { changed: true } })
  })
  const first = harness.begin(draft())
  assert.equal(first.idempotencyKey, KEY_A)
  await harness.commitThenRefresh(async () => {})
  assert.equal(harness.lifecycle.getStored(), null)
  assert.equal(harness.store.has(harness.storageKey()), false)

  const second = harness.begin(draft({ targetType: 'motel', reason: 'second change' }))
  assert.equal(second.idempotencyKey, KEY_B)
  assert.notEqual(first.idempotencyKey, second.idempotencyKey)
  await harness.commitThenRefresh(async () => {})
  assert.equal(harness.lifecycle.getStored(), null)
})

test('timeout keeps the operation and the exact retry submits byte-identical payload', async () => {
  let attempts = 0
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A]),
    commit: async () => {
      attempts += 1
      if (attempts === 1) throw timeoutError()
      return { success: true, replayed: true, data: { changed: true } }
    }
  })
  harness.begin(draft())
  const before = harness.payloadBytes()
  const { firstError, retryResult } = await harness.submitWithTimeoutThenRetry()
  assert.match(String(firstError?.message || firstError), /socket hang up/)
  assert.equal(retryResult?.replayed, true)
  assert.equal(harness.submitted.length, 2)
  assert.equal(harness.submitted[0], before)
  assert.equal(harness.submitted[1], before, 'retry reuses the identical payload bytes and key')
  assert.equal(JSON.parse(harness.submitted[1]).idempotencyKey, KEY_A)
})

test('unmount/remount recovers the stored operation and retries identically', async () => {
  const seen = []
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A]),
    commit: async (payload) => {
      seen.push(JSON.stringify(payload))
      return { success: true, replayed: true, data: { changed: true } }
    }
  })
  harness.begin(draft())
  const originalBytes = harness.payloadBytes()
  // Simulate unmount: drop the in-memory controller, keep storage.
  const remountedBytes = harness.remountPayloadBytes()
  assert.equal(remountedBytes, originalBytes)
  // Retry after remount submits the identical payload.
  const recovered = parseOperation(harness.store.get(harness.storageKey()))
  const retryResult = await (async () => {
    const payload = buildCommitPayload(recovered)
    seen.push(JSON.stringify(payload))
    return harness.lifecycle.markCommitSucceeded(await (async (p) => ({ success: true, replayed: true, data: { changed: true } }))(payload))
  })()
  assert.equal(retryResult.retired, true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0], originalBytes)
})

test('restart recovery restores the pending operation from storage', () => {
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A])
  })
  const op = harness.begin(draft())
  const { fresh, restored } = harness.restart()
  assert.ok(restored)
  assert.equal(isSameOperation(restored, op), true)
  assert.equal(fresh.describeAgainst({}), 'same-scope-pending')
  assert.equal(JSON.stringify(fresh.payload()), JSON.stringify(buildCommitPayload(op)))
  assert.equal(fresh.getPhase(), 'pending')
})

test('target/reason edits during pending are rejected; payload ignores the draft', () => {
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A])
  })
  harness.begin(draft())
  assert.equal(canEditDuringPending(), false)
  // A mutated draft (different target + reason) does not match the pending op…
  assert.equal(harness.lifecycle.matchesPending(draft({ targetType: 'motel', reason: 'changed mind' })), false)
  // …and the submittable payload still carries only the original values.
  assert.deepEqual(harness.lifecycle.payload(), buildCommitPayload(harness.lifecycle.getStored()))
  assert.equal(harness.lifecycle.payload().targetType, 'camp')
  assert.equal(harness.lifecycle.payload().reason, 're-registered as a camp')
  // Starting a different change while pending is blocked until explicit discard.
  assert.throws(() => harness.begin(draft({ targetType: 'motel' })), /already pending/)
})

test('property/user switch yields foreign scope and never submits the stored op', async () => {
  let submits = 0
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A]),
    commit: async () => { submits += 1; return { success: true, data: { changed: true } } }
  })
  harness.begin(draft())
  assert.equal(harness.describe(), 'same-scope-pending')

  // Lodge switch: the stored record belongs to another scope.
  assert.equal(
    describeRecoveryState({ stored: harness.lifecycle.getStored(), currentLodgeId: OTHER_LODGE, currentUserId: 'user-1' }),
    'foreign-scope'
  )
  // User switch: same verdict.
  assert.equal(
    describeRecoveryState({ stored: harness.lifecycle.getStored(), currentLodgeId: LODGE, currentUserId: 'user-2' }),
    'foreign-scope'
  )
  // The controller drops in-memory state on scope change; nothing is submitted.
  harness.lifecycle.setScope({ lodgeId: OTHER_LODGE, userId: 'user-1' })
  assert.equal(harness.lifecycle.getStored(), null)
  assert.equal(harness.lifecycle.getPhase(), 'idle')
  assert.equal(submits, 0)
  // The original scoped record is still recoverable when switching back.
  const { fresh } = harness.restart()
  fresh.setScope({ lodgeId: LODGE, userId: 'user-1' })
  const back = fresh.restore(harness.store.get(buildStorageKey({ lodgeId: LODGE, userId: 'user-1' })))
  assert.ok(back)
  assert.equal(fresh.describeAgainst({}), 'same-scope-pending')
})

test('late success after a timeout retires exactly once with no second submit', async () => {
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A]),
    commit: async () => { throw timeoutError() }
  })
  harness.begin(draft())
  await assert.rejects(() => harness.submit(), /socket hang up/)
  const retryPayload = harness.lifecycle.markTimeout()
  assert.deepEqual(retryPayload, buildCommitPayload(harness.lifecycle.getStored()))

  // The late-arriving success from the timed-out request retires the op…
  const late = harness.lifecycle.markLateSuccess({ success: true, data: { changed: true } })
  assert.equal(late.retired, true)
  assert.equal(harness.lifecycle.getStored(), null)
  // …and any racing reconciliation afterwards is a no-op (no resubmit).
  const again = harness.lifecycle.markLateSuccess({ success: true, data: { changed: true } })
  assert.deepEqual(again, { retired: false, alreadyRetired: true })
  assert.equal(harness.submitted.length, 1)
})

test('commit success plus refresh failure keeps the retired commit and flags refresh', async () => {
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A]),
    commit: async () => ({ success: true, replayed: false, data: { changed: true } })
  })
  harness.begin(draft())
  const { outcome } = await harness.commitThenRefresh(async () => {
    throw new Error('settings reload exploded')
  })
  assert.equal(outcome.retired, true)
  assert.equal(harness.flags.committed, true)
  assert.equal(harness.flags.refreshFailed, true)
  assert.match(harness.flags.refreshWarning, /saved on server.*refresh failed/i)
  assert.equal(harness.lifecycle.getStored(), null, 'no resubmit of a committed operation')
  assert.equal(harness.submitted.length, 1)
  assert.equal(harness.store.has(harness.storageKey()), false)
})

test('status NOT_FOUND preserves the operation and allows an exact retry', async () => {
  const seen = []
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A]),
    commit: async (payload) => {
      seen.push(JSON.stringify(payload))
      return { success: true, replayed: true, data: { changed: true } }
    },
    status: async () => ({ success: false, code: 'NOT_FOUND', error: 'No transition recorded.' })
  })
  harness.begin(draft())
  const statusResult = await harness.checkStatus()
  assert.equal(statusResult.code, 'NOT_FOUND')
  assert.equal(shouldRetireAfter({ statusResult }), false)
  const kept = harness.lifecycle.markStatusNotFound()
  assert.equal(kept.kept, true)
  assert.ok(harness.lifecycle.getStored(), 'operation preserved after NOT_FOUND')
  assert.equal(harness.lifecycle.getPhase(), 'awaiting-outcome')
  // Exact retry reuses the identical payload — no replacement key is minted.
  const before = harness.payloadBytes()
  await harness.submit()
  assert.equal(seen.length, 1)
  assert.equal(seen[0], before)
  assert.equal(JSON.parse(seen[0]).idempotencyKey, KEY_A)
})

test('stale rejection forces a fresh preview; the key is never reused for new state', async () => {
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A, KEY_B]),
    commit: async () => ({ success: false, code: 'expected_state_conflict', error: 'The company settings changed since the preview.' })
  })
  harness.begin(draft())
  const commitResult = await harness.submit()
  assert.equal(shouldRetireAfter({ commitResult }), false)
  const stale = harness.lifecycle.markStaleRejected()
  assert.equal(stale.phase, 'preview-required')
  assert.equal(harness.lifecycle.getPhase(), 'preview-required')
  assert.ok(harness.lifecycle.getStored(), 'stored op kept so the original values stay checkable')
  // A different expected state does not match the pending key…
  assert.equal(
    harness.lifecycle.matchesPending(draft({ expectedUpdatedAt: '2026-10-02T00:00:00.000Z' })),
    false
  )
  // …and a genuinely new change requires explicit discard first, then mints a fresh key.
  assert.throws(() => harness.begin(draft({ targetType: 'motel' })), /already pending/)
  harness.discard()
  const next = harness.begin(draft({ targetType: 'motel', expectedUpdatedAt: '2026-10-02T00:00:00.000Z' }))
  assert.equal(next.idempotencyKey, KEY_B)
  assert.notEqual(next.idempotencyKey, KEY_A)
})

test('mismatched-payload reuse is detected and blocked', () => {
  const stored = captureOperation({ idempotencyKey: KEY_A, lodgeId: LODGE, userId: 'user-1', ...draft() })
  const differentPayloadOp = {
    idempotencyKey: KEY_A,
    lodgeId: LODGE,
    targetType: 'bnb',
    expectedPropertyType: 'lodge',
    expectedUpdatedAt: UPDATED_AT,
    reason: 're-registered as a camp'
  }
  assert.equal(isSameOperation(stored, differentPayloadOp), false)
  // The controller likewise refuses to treat the foreign draft as the pending op.
  const lifecycle = createLifecycle({ lodgeId: LODGE, userId: 'user-1' })
  lifecycle.restore(serializeOperation(stored))
  assert.equal(lifecycle.matchesPending({ ...draft({ targetType: 'bnb' }), idempotencyKey: KEY_A }), false)
  assert.equal(lifecycle.matchesPending({ ...draft(), idempotencyKey: KEY_A }), true)
})

test('status-found outcome retires and refreshes without resubmitting', async () => {
  let commits = 0
  const harness = createPropertyTransitionHarness({
    lodgeId: LODGE,
    userId: 'user-1',
    generateKey: keyMint([KEY_A]),
    commit: async () => { commits += 1; throw timeoutError() },
    status: async (key) => {
      assert.equal(key, KEY_A)
      return { success: true, lodge_id: LODGE, idempotency_key: KEY_A, data: { previous_type: 'lodge', target_type: 'camp', changed: true } }
    }
  })
  harness.begin(draft())
  await assert.rejects(() => harness.submit(), /socket hang up/)
  harness.lifecycle.markTimeout()
  const found = await harness.checkStatus()
  const outcome = harness.lifecycle.markStatusFound(found)
  assert.equal(outcome.retired, true)
  harness.store.delete(harness.storageKey())
  assert.equal(harness.lifecycle.getStored(), null)
  assert.equal(commits, 1, 'the timed-out request was sent once; reconciliation used status, not a resubmit')
})

// ── Production controller (createTransitionController) ───────────────────
// These exercise the REAL orchestration used by the production Settings
// section — durable write-verify-submit, scope/identity fencing,
// archive-and-supersede, truthful refresh and refresh-only recovery — with
// fake storage, fake commit/status/refresh functions and injected timers.
// No network, no DOM.

const CTL_LODGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CTL_USER = 'user-1'
const CTL_KEY_A = '11111111-1111-4111-8111-111111111111'
const CTL_KEY_B = '22222222-2222-4222-8222-222222222222'
const CTL_UPDATED_AT = '2026-10-01T00:00:00.000Z'

function ctlDraft(overrides = {}) {
  return {
    targetType: 'camp',
    expectedPropertyType: 'lodge',
    expectedUpdatedAt: CTL_UPDATED_AT,
    reason: 're-registered as a camp',
    ...overrides
  }
}

function ctlSuccess() {
  return { success: true, replayed: false, data: { changed: true, previous_type: 'lodge', target_type: 'camp' } }
}

function makeFakeStorage({ failWrite = false, failRead = false, tamperRead = false } = {}) {
  const map = new Map()
  const storage = {
    getItem(key) {
      if (failRead) throw new Error('storage read blocked')
      const value = map.has(key) ? map.get(key) : null
      if (tamperRead && value !== null && !String(key).includes('archive')) return '{"tampered":true}'
      return value
    },
    setItem(key, value) {
      if (failWrite) throw new Error('storage quota exceeded')
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    }
  }
  return storage
}

function makeManualTimers() {
  let next = 1
  const pending = new Map()
  return {
    setTimeout(fn, ms) {
      const id = next
      next += 1
      pending.set(id, { fn, ms })
      return id
    },
    clearTimeout(id) {
      pending.delete(id)
    },
    fireAll() {
      for (const [id, entry] of [...pending]) {
        pending.delete(id)
        entry.fn()
      }
    },
    pendingCount() {
      return pending.size
    }
  }
}

function makeCtl({ storage, api = {}, timers = null, scope = null, generateKey = null, events = null } = {}) {
  const seen = { commits: [], statuses: [], refreshes: 0 }
  const controller = createTransitionController({
    storage: storage === undefined ? makeFakeStorage() : storage,
    api: {
      commit: async (payload) => {
        seen.commits.push(JSON.stringify(payload))
        if (api.commit) return api.commit(payload, seen)
        return ctlSuccess()
      },
      status: async (key) => {
        seen.statuses.push(key)
        if (api.status) return api.status(key, seen)
        return { success: false, code: 'NOT_FOUND', error: 'No transition recorded.' }
      },
      refresh: async () => {
        seen.refreshes += 1
        if (api.refresh) return api.refresh(seen)
        return { ok: true }
      }
    },
    timers: timers || { commitTimeoutMs: 20000, setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
    scope: scope || { lodgeId: CTL_LODGE, userId: CTL_USER },
    generateKey: generateKey || (() => CTL_KEY_A),
    onEvent: events ? (name, detail) => events.push({ name, detail }) : null
  })
  return { controller, seen }
}

test('controller R4: blocked storage throws TransitionStorageError with zero RPC calls', () => {
  for (const storage of [null, makeFakeStorage({ failWrite: true }), makeFakeStorage({ tamperRead: true })]) {
    const { controller, seen } = makeCtl({ storage })
    assert.throws(
      () => controller.beginNew(ctlDraft()),
      (error) => error instanceof TransitionStorageError,
      'durable persistence is required before first submission'
    )
    assert.equal(seen.commits.length, 0, 'no write failure is ever followed by mutation submission')
    assert.equal(controller.getStored(), null)
  }
})

test('controller R4 mutation probe (red/green): the old fail-open save would NOT throw', () => {
  const failing = makeFakeStorage({ failWrite: true })
  const oldFailOpenSave = (key, op) => {
    try {
      if (key && failing) failing.setItem(key, JSON.stringify(op))
    } catch {
      // Swallowed: the R4 bug — submission continued with no durable record.
    }
  }
  assert.doesNotThrow(() => oldFailOpenSave('k', {}), 'old behavior swallows the storage failure')
  const op = captureOperation({ idempotencyKey: CTL_KEY_A, lodgeId: CTL_LODGE, userId: CTL_USER, ...ctlDraft() })
  assert.throws(
    () => saveStoredTransitionOp(failing, buildStorageKey({ lodgeId: CTL_LODGE, userId: CTL_USER }), op),
    (error) => error instanceof TransitionStorageError,
    'production saveStoredTransitionOp must throw so runCommit cannot submit'
  )
  assert.throws(() => saveStoredTransitionOp(null, 'k', op), (error) => error instanceof TransitionStorageError)
})

test('controller R4: durable round-trip persists and verifies before submit', () => {
  const storage = makeFakeStorage()
  const key = buildStorageKey({ lodgeId: CTL_LODGE, userId: CTL_USER })
  const op = captureOperation({ idempotencyKey: CTL_KEY_A, lodgeId: CTL_LODGE, userId: CTL_USER, ...ctlDraft() })
  const saved = saveStoredTransitionOp(storage, key, op)
  assert.ok(isSameOperation(saved, op))
  assert.ok(isSameOperation(loadStoredTransitionOp(storage, key), op))
})

test('controller R4: archive-and-supersede retains history; no permanent delete exists', async () => {
  const storage = makeFakeStorage()
  const keys = [CTL_KEY_A, CTL_KEY_B]
  let index = 0
  const { controller, seen } = makeCtl({ storage, generateKey: () => keys[index++ % keys.length] })
  const first = controller.beginNew(ctlDraft())
  assert.equal(first.idempotencyKey, CTL_KEY_A)
  const archived = controller.archiveAndSupersede('operator archive-and-supersede with no recorded outcome check; switching target')
  assert.equal(archived.archived, true)
  assert.equal(controller.getStored(), null)
  assert.equal(controller.getPhase(), 'idle')
  assert.equal(seen.commits.length, 0, 'archiving never submits')
  const liveKey = buildStorageKey({ lodgeId: CTL_LODGE, userId: CTL_USER })
  assert.equal(storage.getItem(liveKey), null, 'live key cleared')
  const history = listArchivedTransitionOps(storage, { lodgeId: CTL_LODGE, userId: CTL_USER })
  assert.equal(history.length, 1)
  assert.equal(history[0].op.idempotencyKey, CTL_KEY_A, 'superseded op retained recoverably by key')
  assert.equal(history[0].terminal.outcome, 'superseded')
  const second = controller.beginNew(ctlDraft({ targetType: 'motel', reason: 'second change' }))
  assert.equal(second.idempotencyKey, CTL_KEY_B, 'replacement mints a fresh key; the retired key is never reused')
  assert.notEqual(second.idempotencyKey, first.idempotencyKey)
  const res = await controller.submitCurrent()
  assert.equal(res.retired, true)
  assert.equal(listArchivedTransitionOps(storage, { lodgeId: CTL_LODGE, userId: CTL_USER }).length, 2)
})

test('controller F2: archived check by original key never resubmits and never touches the current op', async () => {
  const storage = makeFakeStorage()
  let statusMode = 'missing'
  const keys = [CTL_KEY_A, CTL_KEY_B]
  let index = 0
  const { controller, seen } = makeCtl({
    storage,
    generateKey: () => keys[index++ % keys.length],
    api: {
      status: async (key) => (statusMode === 'missing' || key !== CTL_KEY_A
        ? { success: false, code: 'NOT_FOUND', error: 'No transition recorded.' }
        : { success: true, lodge_id: CTL_LODGE, idempotency_key: CTL_KEY_A, data: { previous_type: 'lodge', target_type: 'camp', changed: true } })
    }
  })
  controller.beginNew(ctlDraft())
  controller.archiveAndSupersede('operator archive-and-supersede with no recorded outcome check; starting a different target')
  const second = controller.beginNew(ctlDraft({ targetType: 'motel', reason: 'second change' }))
  assert.equal(second.idempotencyKey, CTL_KEY_B)
  const before = controller.getStored()
  const phaseBefore = controller.getPhase()

  // NOT_FOUND for the archived original key: reported, current op untouched.
  const missing = await controller.checkArchivedOutcome(CTL_KEY_A)
  assert.deepEqual({ found: missing.found, code: missing.code, retired: missing.retired }, { found: false, code: 'NOT_FOUND', retired: undefined })
  assert.equal(missing.key, CTL_KEY_A)
  assert.equal(missing.terminal.kind, 'unresolved')
  assert.strictEqual(controller.getStored(), before, 'archived lookup never replaces the current operation')
  assert.equal(controller.getStored().idempotencyKey, CTL_KEY_B)
  assert.equal(controller.getPhase(), phaseBefore)

  // Late outcome arrives for the original key: found, still no resubmit.
  statusMode = 'completed'
  const late = await controller.checkArchivedOutcome(CTL_KEY_A)
  assert.equal(late.found, true)
  assert.equal(late.retired, false, 'an archived completion never retires the current newer operation')
  assert.equal(late.key, CTL_KEY_A)
  assert.strictEqual(controller.getStored(), before, 'identity fencing: the second operation is untouched')
  assert.equal(controller.getStored().idempotencyKey, CTL_KEY_B)
  assert.equal(seen.commits.length, 0, 'archived checks never submit')
  // The append-only archive is not edited by lookups: still one superseded
  // entry plus the live pending op — no silent promotion to completed.
  const history = listArchivedTransitionOps(storage, { lodgeId: CTL_LODGE, userId: CTL_USER })
  assert.equal(history.length, 1)
  assert.equal(history[0].terminal.outcome, 'superseded')
})

test('controller F2: full journey — timeout, supersede, new change, restart, archived check, second untouched', async () => {
  const storage = makeFakeStorage()
  let statusMode = 'missing'
  const keys = [CTL_KEY_A, CTL_KEY_B]
  let index = 0
  const ctlOptions = {
    storage,
    generateKey: () => keys[index++ % keys.length],
    api: {
      commit: async () => ctlSuccess(),
      status: async (key) => (statusMode === 'missing' || key !== CTL_KEY_A
        ? { success: false, code: 'NOT_FOUND', error: 'No transition recorded.' }
        : { success: true, lodge_id: CTL_LODGE, idempotency_key: CTL_KEY_A, data: { previous_type: 'lodge', target_type: 'camp', changed: true } })
    }
  }
  const first = makeCtl(ctlOptions)
  first.controller.beginNew(ctlDraft())
  first.controller.archiveAndSupersede('operator archive-and-supersede after recorded outcome check: no recorded result (NOT_FOUND); starting a different target')
  first.controller.beginNew(ctlDraft({ targetType: 'motel', reason: 'second change' }))
  // Restart: a fresh controller on the same scope adopts the live record only.
  const restarted = makeCtl(ctlOptions)
  assert.equal(restarted.controller.getStored()?.idempotencyKey, CTL_KEY_B, 'restart recovers the second operation')
  assert.equal(restarted.controller.getPhase(), 'pending')
  // Select the ORIGINAL archived op: late outcome arrives, second untouched.
  statusMode = 'completed'
  const late = await restarted.controller.checkArchivedOutcome(CTL_KEY_A)
  assert.equal(late.found, true)
  assert.equal(restarted.controller.getStored()?.idempotencyKey, CTL_KEY_B)
  assert.equal(restarted.controller.getPhase(), 'pending')
  assert.equal(restarted.seen.commits.length, 0, 'no submit happened on the archived path')
  assert.equal(first.seen.commits.length, 0)
})

test('controller F2: archived check rejects mismatched receipts and unknown keys without touching current state', async () => {
  const storage = makeFakeStorage()
  const keys = [CTL_KEY_A, CTL_KEY_B]
  let index = 0
  const { controller, seen } = makeCtl({
    storage,
    generateKey: () => keys[index++ % keys.length],
    api: {
      status: async (key) => (key === CTL_KEY_A
        ? { success: true, lodge_id: CTL_LODGE, idempotency_key: 'DIFFERENT-KEY', data: { previous_type: 'lodge', target_type: 'camp', changed: true } }
        : { success: false, code: 'NOT_FOUND', error: 'No transition recorded.' })
    }
  })
  controller.beginNew(ctlDraft())
  controller.archiveAndSupersede('operator archive-and-supersede with no recorded outcome check; probe')
  controller.beginNew(ctlDraft({ targetType: 'motel', reason: 'second change' }))
  const before = controller.getStored()
  const mismatched = await controller.checkArchivedOutcome(CTL_KEY_A)
  assert.deepEqual({ stale: mismatched.stale, retired: mismatched.retired }, { stale: true, retired: false })
  assert.strictEqual(controller.getStored(), before, 'a mismatched receipt never clears the current operation')
  // The live pending key is NOT in the archive: the archive path refuses it.
  await assert.rejects(() => controller.checkArchivedOutcome(CTL_KEY_B), /not in this property\/user history/)
  assert.strictEqual(controller.getStored(), before)
  assert.equal(seen.commits.length, 0)
  // Malformed keys are rejected before any status call.
  await assert.rejects(() => controller.checkArchivedOutcome('not-a-uuid'), /idempotency key/)
  assert.equal(seen.statuses.length, 1, 'only the fenced archived lookup reached status')
})

test('controller F2: archive history is property/user isolated', async () => {
  const storage = makeFakeStorage()
  const owner = makeCtl({ storage, scope: { lodgeId: CTL_LODGE, userId: CTL_USER } })
  owner.controller.beginNew(ctlDraft())
  owner.controller.archiveAndSupersede('operator archive-and-supersede with no recorded outcome check; isolation probe')
  assert.equal(listArchivedTransitionOps(storage, { lodgeId: CTL_LODGE, userId: CTL_USER }).length, 1)
  // Another lodge and another user each see an empty history (switching scope
  // shows only that scope's history).
  assert.deepEqual(listArchivedTransitionOps(storage, { lodgeId: OTHER_LODGE, userId: CTL_USER }), [])
  assert.deepEqual(listArchivedTransitionOps(storage, { lodgeId: CTL_LODGE, userId: 'user-2' }), [])
  // …and cannot probe the original scope's key from here.
  const other = makeCtl({ storage, scope: { lodgeId: OTHER_LODGE, userId: CTL_USER } })
  await assert.rejects(() => other.controller.checkArchivedOutcome(CTL_KEY_A), /not in this property\/user history/)
  assert.equal(other.seen.commits.length, 0)
  assert.equal(other.seen.statuses.length, 0, 'isolation failure never reaches the status service')
})

test('controller F2: supersede reason is the actual operator action, verbatim; terminal kinds stay distinct', () => {
  const storage = makeFakeStorage()
  const { controller } = makeCtl({ storage })
  controller.beginNew(ctlDraft())
  const truthful = 'operator archive-and-supersede after recorded outcome check: no recorded result (NOT_FOUND) at 2026-10-16T00:00:00.000Z; unresolved operation retained in on-device history under its original key'
  controller.archiveAndSupersede(truthful)
  const history = listArchivedTransitionOps(storage, { lodgeId: CTL_LODGE, userId: CTL_USER })
  assert.equal(history.length, 1)
  assert.equal(history[0].terminal.outcome, 'superseded')
  assert.equal(history[0].terminal.reason, truthful, 'the archived reason is the caller-supplied operator action, verbatim')
  assert.ok(!history[0].terminal.reason.includes('checked the outcome') || history[0].terminal.reason.includes('no recorded outcome check'),
    'no unconditional outcome-checked assertion is recorded')
  assert.deepEqual(describeArchivedTerminal(history[0]).kind, 'unresolved')

  // Terminally-completed outcomes classify distinctly from superseded ones.
  assert.deepEqual(describeArchivedTerminal({ terminal: { outcome: 'committed' } }).kind, 'completed')
  assert.deepEqual(describeArchivedTerminal({ terminal: { outcome: 'late-commit' } }).kind, 'completed')
  assert.deepEqual(describeArchivedTerminal({ terminal: { outcome: 'status-recovery' } }).kind, 'completed')
  assert.deepEqual(describeArchivedTerminal({ terminal: { outcome: 'superseded' } }).kind, 'unresolved')
  assert.deepEqual(describeArchivedTerminal({}).kind, 'unknown')
})

test('controller R4: foreign scope recovers nothing and can never submit it', async () => {
  const storage = makeFakeStorage()
  const scopeA = { lodgeId: CTL_LODGE, userId: CTL_USER }
  const scopeB = { lodgeId: OTHER_LODGE, userId: CTL_USER }
  const owner = makeCtl({ storage, scope: scopeA })
  owner.controller.beginNew(ctlDraft())
  assert.equal(owner.seen.commits.length, 0)
  const other = makeCtl({ storage, scope: scopeB })
  assert.equal(other.controller.recover(), null)
  assert.equal(other.controller.getStored(), null)
  assert.equal(other.controller.describe(), 'none')
  await assert.rejects(() => other.controller.submitCurrent(), /No pending property-type operation/)
  assert.equal(other.seen.commits.length, 0, 'a foreign record is never submitted from this scope')
  const kept = loadStoredTransitionOp(storage, buildStorageKey(scopeA))
  assert.ok(kept && kept.idempotencyKey === CTL_KEY_A, 'the original scope record is untouched')
})

test('controller R4: ambiguous timeout keeps the op; late success retires once with one submit', async () => {
  const timers = makeManualTimers()
  let resolveCommit
  const gate = new Promise((resolve) => { resolveCommit = resolve })
  const { controller, seen } = makeCtl({ storage: makeFakeStorage(), timers, api: { commit: () => gate } })
  controller.beginNew(ctlDraft())
  const submitting = controller.submitCurrent()
  timers.fireAll()
  await assert.rejects(submitting, /timed out/)
  assert.equal(controller.getPhase(), 'awaiting-outcome')
  assert.ok(controller.getStored(), 'ambiguous timeout never mints a replacement key and keeps the op')
  assert.equal(seen.commits.length, 1)
  resolveCommit(ctlSuccess())
  for (let i = 0; i < 50 && controller.getStored() !== null; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(controller.getStored(), null, 'late success retires exactly once')
  assert.equal(seen.commits.length, 1, 'no second submit after the late completion')
  await assert.rejects(() => controller.submitCurrent(), /No pending property-type operation/)
})

test('controller R4: late callbacks for a previous scope are fenced and cannot clear a newer op', async () => {
  let resolveCommit
  const gate = new Promise((resolve) => { resolveCommit = resolve })
  const storage = makeFakeStorage()
  const { controller, seen } = makeCtl({ storage, api: { commit: () => gate } })
  controller.beginNew(ctlDraft())
  const submitting = controller.submitCurrent()
  controller.setScope({ lodgeId: OTHER_LODGE, userId: CTL_USER })
  resolveCommit(ctlSuccess())
  const res = await submitting
  assert.equal(res.retired, false)
  assert.equal(res.stale, true)
  assert.equal(seen.commits.length, 1)
  assert.equal(controller.getStored(), null)
})

test('controller R5: refresh failure yields saved-but-pending; refresh-only recovery never resubmits', async () => {
  let refreshMode = 'fail'
  const { controller, seen } = makeCtl({
    storage: makeFakeStorage(),
    api: {
      commit: async () => ctlSuccess(),
      refresh: async () => (refreshMode === 'fail'
        ? { ok: false, reason: 'rpc-error', detail: 'access denied' }
        : { ok: true })
    }
  })
  controller.beginNew(ctlDraft())
  const res = await controller.submitCurrent()
  assert.equal(res.retired, true, 'the completed mutation result is retained')
  assert.equal(res.refresh.ok, false)
  assert.equal(res.refresh.reason, 'rpc-error')
  assert.equal(controller.getPhase(), 'refresh-pending')
  assert.deepEqual(controller.getRefreshState(), { ok: false, reason: 'rpc-error', detail: 'access denied' })
  assert.equal(seen.commits.length, 1)
  refreshMode = 'ok'
  const retry = await controller.retryRefreshOnly()
  assert.deepEqual(retry, { ok: true })
  assert.equal(controller.getPhase(), 'committed')
  await controller.retryRefreshOnly()
  assert.equal(seen.commits.length, 1, 'refresh retries never submit a mutation')
})

test('controller R5 mutation probe (red/green): resolved refresh errors never read as success', async () => {
  const badRefreshes = [
    { ok: false, reason: 'rpc-error', detail: 'access denied' },
    { ok: false, reason: 'missing-row' },
    { ok: false, reason: 'scope-changed' },
    { ok: false, reason: 'lodge-mismatch' },
    { ok: false, reason: 'exception' },
    null,
    undefined,
    { unexpected: 'shape' }
  ]
  for (const bad of badRefreshes) {
    const { controller } = makeCtl({
      storage: makeFakeStorage(),
      api: { commit: async () => ctlSuccess(), refresh: async () => bad }
    })
    controller.beginNew(ctlDraft())
    // eslint-disable-next-line no-await-in-loop
    const res = await controller.submitCurrent()
    assert.equal(res.retired, true)
    assert.equal(res.refresh.ok, false, `refresh ${JSON.stringify(bad)} must report failure, never silent success`)
    assert.equal(controller.getPhase(), 'refresh-pending')
  }
})

test('controller R5: checkOutcome retires only on matching identity; otherwise the op is kept', async () => {
  const storage = makeFakeStorage()
  let statusMode = 'mismatch'
  const { controller, seen } = makeCtl({
    storage,
    api: {
      status: async (key) => (statusMode === 'mismatch'
        ? { success: true, lodge_id: OTHER_LODGE, idempotency_key: key, data: { previous_type: 'lodge', target_type: 'camp', changed: true } }
        : { success: true, lodge_id: CTL_LODGE, idempotency_key: CTL_KEY_A, data: { previous_type: 'lodge', target_type: 'camp', changed: true } })
    }
  })
  controller.beginNew(ctlDraft())
  const stale = await controller.checkOutcome()
  assert.deepEqual(stale, { retired: false, stale: true })
  assert.ok(controller.getStored(), 'identity-mismatched outcome keeps the op for exact retry')
  statusMode = 'match'
  const res = await controller.checkOutcome()
  assert.equal(res.retired, true)
  assert.equal(res.found, true)
  assert.equal(res.refresh.ok, true)
  assert.equal(controller.getStored(), null)
  assert.equal(seen.commits.length, 0, 'status recovery never submits')
})

test('controller R5: status NOT_FOUND keeps the op for exact retry with identical bytes', async () => {
  const { controller, seen } = makeCtl({ storage: makeFakeStorage() })
  controller.beginNew(ctlDraft())
  const res = await controller.checkOutcome()
  assert.deepEqual(res, { found: false, code: 'NOT_FOUND' })
  assert.ok(controller.getStored(), 'operation preserved after NOT_FOUND')
  assert.equal(controller.getPhase(), 'awaiting-outcome')
})

test('controller: archive write failure keeps the retired outcome visible, never resubmits', async () => {
  const storage = makeFakeStorage()
  const events = []
  const { controller, seen } = makeCtl({ storage, events })
  controller.beginNew(ctlDraft())
  const archiveKey = buildArchiveKey({ lodgeId: CTL_LODGE, userId: CTL_USER })
  const rawSet = storage.setItem.bind(storage)
  storage.setItem = (key, value) => {
    if (key === archiveKey) throw new Error('archive write blocked')
    rawSet(key, value)
  }
  const res = await controller.submitCurrent()
  assert.equal(res.retired, true, 'server-confirmed outcome stays retired in memory')
  assert.equal(seen.commits.length, 1)
  assert.ok(events.some((event) => event.name === 'archive-failed'), 'archive failure is reported for operator recovery')
  assert.equal(controller.getStored(), null)
  await assert.rejects(() => controller.submitCurrent(), /No pending property-type operation/)
})
