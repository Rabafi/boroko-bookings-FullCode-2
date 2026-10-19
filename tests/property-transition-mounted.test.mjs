// Property-transition mounted acceptance (node:test, Agent B).
//
// R6 evidence for the Settings persistence/recovery/refresh slice:
//  1. Production-shaped contract tests: the REAL createTransitionController
//     driven through the EXACT IPC result envelopes the production Settings
//     section receives (commit/status/refreshSettingsFromServer shapes from
//     src/main/index.js handlers + src/main/domains/propertyTransitions.js).
//     Storage-blocked, restart-recovery, late-completion, scope-switch and
//     stale-callback behavior is asserted — no write failure is ever followed
//     by mutation submission.
//  2. The actual production PropertyTypeSection DOM mount, archived status
//     selection and scope-switch recovery live in
//     booking-site/src/test/property-transition-settings-mounted.test.jsx
//     (booking-site Vitest/jsdom); this node:test file covers the controller
//     and exact IPC envelopes without attempting to parse JSX.
//  3. Disposable-database gate: missing credentials are an explicit
//     incomplete gate here; the required command
//     `npm run test:property-transition-db` exits non-zero without a tested
//     database (never a green DB acceptance result).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TransitionStorageError,
  buildCommitPayload,
  buildStorageKey,
  createTransitionController,
  isSameOperation,
  listArchivedTransitionOps
} from '../src/shared/propertyTransitionOperation.js'

const LODGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_LODGE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KEY_A = '11111111-1111-4111-8111-111111111111'
const KEY_B = '22222222-2222-4222-8222-222222222222'
const UPDATED_AT = '2026-10-01T00:00:00.000Z'

function draft(overrides = {}) {
  return {
    targetType: 'camp',
    expectedPropertyType: 'lodge',
    expectedUpdatedAt: UPDATED_AT,
    reason: 're-registered as a camp',
    ...overrides
  }
}

function makeFakeStorage({ failWrite = false, failRead = false } = {}) {
  const map = new Map()
  return {
    getItem(key) {
      if (failRead) throw new Error('storage read blocked')
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      if (failWrite) throw new Error('storage quota exceeded')
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    }
  }
}

// Mirror of the production Settings wiring in
// src/renderer/src/components/Settings.jsx (PropertyTypeSection): the api
// adapters call window.api.settings.commitPropertyTypeChange /
// getPropertyTypeTransitionStatus / refreshSettingsFromServer and return
// their IPC envelopes verbatim. Here the envelopes are replayed from
// production-shaped fixtures instead of a live main process.
function makeProductionWiredController({ storage, commitEnvelope, statusEnvelope, refreshEnvelope, events = null }) {
  const seen = { commits: [], statuses: [], refreshes: 0 }
  const controller = createTransitionController({
    storage,
    api: {
      commit: async (payload) => {
        seen.commits.push(JSON.stringify(payload))
        if (commitEnvelope instanceof Error) throw commitEnvelope
        return commitEnvelope
      },
      status: async (key) => {
        seen.statuses.push(key)
        if (statusEnvelope instanceof Error) throw statusEnvelope
        return statusEnvelope
      },
      refresh: async () => {
        seen.refreshes += 1
        if (refreshEnvelope instanceof Error) {
          const error = refreshEnvelope
          throw error
        }
        return refreshEnvelope
      }
    },
    timers: { commitTimeoutMs: 20000, setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
    scope: { lodgeId: LODGE, userId: 'user-1' },
    generateKey: () => KEY_A,
    onEvent: events ? (name, detail) => events.push({ name, detail }) : null
  })
  return { controller, seen }
}

// Production main-process commit envelope on success: the authoritative RPC
// result PLUS the always-attached truthful refresh flag (see
// src/main/domains/propertyTransitions.js commitPropertyTypeChange).
function productionCommitEnvelope() {
  return {
    success: true,
    replayed: false,
    data: { changed: true, previous_type: 'lodge', target_type: 'camp' },
    refresh: { ok: true, updatedAt: UPDATED_AT }
  }
}

test('mounted-acceptance: production commit envelope retires, archives and refreshes (no resubmit)', async () => {
  const storage = makeFakeStorage()
  const { controller, seen } = makeProductionWiredController({
    storage,
    commitEnvelope: productionCommitEnvelope(),
    refreshEnvelope: { ok: true }
  })
  const op = controller.beginNew(draft())
  const res = await controller.submitCurrent()
  assert.equal(res.retired, true)
  assert.equal(res.refresh.ok, true)
  assert.equal(seen.commits.length, 1)
  assert.equal(seen.refreshes, 1)
  assert.equal(controller.getStored(), null)
  const history = listArchivedTransitionOps(storage, { lodgeId: LODGE, userId: 'user-1' })
  assert.equal(history.length, 1)
  assert.equal(history[0].op.idempotencyKey, KEY_A)
})

test('mounted-acceptance: production resolved-error envelopes never read as success', async () => {
  // Regression shape from the independent review: the main refresh given a
  // normal resolved Supabase {data:null,error:{message:'access denied'}}
  // response returned true with zero cache writes. The production contract
  // now reports {ok:false,reason,...} and the controller surfaces it.
  const { controller, seen } = makeProductionWiredController({
    storage: makeFakeStorage(),
    commitEnvelope: {
      success: true,
      replayed: false,
      data: { changed: true, previous_type: 'lodge', target_type: 'camp' },
      refresh: { ok: false, reason: 'rpc-error', detail: 'access denied' }
    },
    refreshEnvelope: { ok: false, reason: 'rpc-error', detail: 'access denied' }
  })
  controller.beginNew(draft())
  const res = await controller.submitCurrent()
  assert.equal(res.retired, true, 'completed mutation result is retained')
  assert.equal(res.refresh.ok, false)
  assert.equal(res.refresh.reason, 'rpc-error')
  assert.equal(controller.getPhase(), 'refresh-pending')
  assert.equal(seen.commits.length, 1)
})

test('mounted-acceptance: storage-blocked restart recovers nothing and submits nothing', async () => {
  const storage = makeFakeStorage({ failWrite: true })
  const first = makeProductionWiredController({
    storage,
    commitEnvelope: productionCommitEnvelope(),
    refreshEnvelope: { ok: true }
  })
  assert.throws(() => first.controller.beginNew(draft()), (error) => error instanceof TransitionStorageError)
  assert.equal(first.seen.commits.length, 0)
  // Simulated restart: a fresh controller on the same scope recovers nothing
  // (the key was never durably captured) and has nothing submittable.
  const restarted = makeProductionWiredController({
    storage,
    commitEnvelope: productionCommitEnvelope(),
    refreshEnvelope: { ok: true }
  })
  assert.equal(restarted.controller.recover(), null)
  await assert.rejects(() => restarted.controller.submitCurrent(), /No pending property-type operation/)
  assert.equal(restarted.seen.commits.length, 0)
  // A blocked READ surfaces truthfully instead of silently orphaning the key.
  const unreadable = makeProductionWiredController({
    storage: makeFakeStorage({ failRead: true }),
    commitEnvelope: productionCommitEnvelope(),
    refreshEnvelope: { ok: true }
  })
  assert.throws(() => unreadable.controller.recover(), (error) => error instanceof TransitionStorageError)
  assert.equal(unreadable.seen.commits.length, 0)
})

test('mounted-acceptance: remount replays the identical payload under the same key', async () => {
  const storage = makeFakeStorage()
  const first = makeProductionWiredController({
    storage,
    commitEnvelope: productionCommitEnvelope(),
    refreshEnvelope: { ok: true }
  })
  const op = first.controller.beginNew(draft())
  const expectedBytes = JSON.stringify(buildCommitPayload(op))
  // Simulate unmount/remount: a fresh controller adopts the scoped record
  // without submitting, then submits byte-identically.
  const remounted = makeProductionWiredController({
    storage,
    commitEnvelope: productionCommitEnvelope(),
    refreshEnvelope: { ok: true }
  })
  assert.ok(remounted.controller.getStored(), 'constructor adopts the persisted scoped record')
  assert.ok(isSameOperation(remounted.controller.getStored(), op))
  const res = await remounted.controller.submitCurrent()
  assert.equal(res.retired, true)
  assert.equal(remounted.seen.commits.length, 1)
  assert.equal(remounted.seen.commits[0], expectedBytes, 'retry reuses the identical payload bytes and key')
})

test('mounted-acceptance: scope switch fences late callbacks; foreign record untouched', async () => {
  let resolveCommit
  const gate = new Promise((resolve) => { resolveCommit = resolve })
  const storage = makeFakeStorage()
  const seen = { commits: [] }
  const controller = createTransitionController({
    storage,
    api: {
      commit: async (payload) => {
        seen.commits.push(JSON.stringify(payload))
        return gate
      },
      status: async () => ({ success: false, code: 'NOT_FOUND' }),
      refresh: async () => ({ ok: true })
    },
    timers: { commitTimeoutMs: 20000, setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
    scope: { lodgeId: LODGE, userId: 'user-1' },
    generateKey: () => KEY_A
  })
  controller.beginNew(draft())
  const submitting = controller.submitCurrent()
  controller.setScope({ lodgeId: OTHER_LODGE, userId: 'user-1' })
  resolveCommit(productionCommitEnvelope())
  const res = await submitting
  assert.equal(res.retired, false)
  assert.equal(res.stale, true)
  assert.equal(seen.commits.length, 1)
  const kept = storage.getItem(buildStorageKey({ lodgeId: LODGE, userId: 'user-1' }))
  assert.ok(kept, 'the original scope record is preserved for switch-back recovery')
})

test('archived recovery requires exact server lodge and key identity and leaves current op untouched', async () => {
  const makeCase = (statusEnvelope) => {
    const storage = makeFakeStorage()
    let nextKey = KEY_A
    const seen = { commits: [], statuses: [] }
    const controller = createTransitionController({
      storage,
      api: {
        commit: async (payload) => { seen.commits.push(payload); return productionCommitEnvelope() },
        status: async (key) => { seen.statuses.push(key); return statusEnvelope },
        refresh: async () => ({ ok: true })
      },
      scope: { lodgeId: LODGE, userId: 'user-1' },
      generateKey: () => { const key = nextKey; nextKey = KEY_B; return key }
    })
    const archived = controller.beginNew(draft())
    controller.archiveAndSupersede('kept unresolved for recovery test')
    const current = controller.beginNew(draft({ targetType: 'bnb', reason: 'new independent operation' }))
    return { storage, controller, seen, archived, current }
  }
  const matching = makeCase({
    success: true,
    lodge_id: LODGE,
    idempotency_key: KEY_A,
    target_type: 'camp',
    previous_type: 'lodge',
    data: { changed: true, target_type: 'camp', previous_type: 'lodge' }
  })
  const result = await matching.controller.checkArchivedOutcome(KEY_A)
  assert.equal(result.found, true)
  assert.equal(result.stale, undefined)
  assert.equal(matching.controller.getStored().idempotencyKey, KEY_B)
  assert.equal(matching.seen.commits.length, 0)
  assert.deepEqual(matching.seen.statuses, [KEY_A])

  for (const statusEnvelope of [
    { success: true, lodge_id: LODGE, data: { changed: true } },
    { success: true, idempotency_key: KEY_A, data: { changed: true } },
    { success: true, lodge_id: OTHER_LODGE, idempotency_key: KEY_A, data: { changed: true } },
    { success: true, lodge_id: LODGE, idempotency_key: KEY_B, data: { changed: true } }
  ]) {
    const rejected = makeCase(statusEnvelope)
    const mismatched = await rejected.controller.checkArchivedOutcome(KEY_A)
    assert.equal(mismatched.stale, true, 'missing or mismatched identity is not shown as this archived outcome')
    assert.equal(rejected.controller.getStored().idempotencyKey, KEY_B, 'current operation is preserved')
    assert.equal(rejected.controller.getPhase(), 'pending')
    assert.equal(rejected.seen.commits.length, 0, 'archived lookup never resubmits')
  }
})

test('archived recovery fences an A-to-B-to-A scope switch while status is pending', async () => {
  let resolveStatus
  const gate = new Promise((resolve) => { resolveStatus = resolve })
  const storage = makeFakeStorage()
  let nextKey = KEY_A
  const controller = createTransitionController({
    storage,
    api: {
      commit: async () => { assert.fail('archived status must never commit') },
      status: async () => gate,
      refresh: async () => ({ ok: true })
    },
    scope: { lodgeId: LODGE, userId: 'user-1' },
    generateKey: () => { const key = nextKey; nextKey = KEY_B; return key }
  })
  controller.beginNew(draft())
  controller.archiveAndSupersede('kept unresolved for ABA test')
  const current = controller.beginNew(draft({ targetType: 'bnb' }))
  const checking = controller.checkArchivedOutcome(KEY_A)
  controller.setScope({ lodgeId: OTHER_LODGE, userId: 'user-1' })
  controller.setScope({ lodgeId: LODGE, userId: 'user-1' })
  assert.ok(controller.recover(), 'switch-back re-adopts the current operation from this scope')
  resolveStatus({ success: true, lodge_id: LODGE, idempotency_key: KEY_A, data: { changed: true } })
  const result = await checking
  assert.equal(result.stale, true)
  assert.equal(controller.getStored().idempotencyKey, current.idempotencyKey)
  assert.equal(controller.getPhase(), 'pending')
})

test('disposable-database gate (explicit incomplete when credentials absent)', async (t) => {
  const hasCreds = Boolean(process.env.LUNA_REMEDIATION_TEST_DB_URL)
  if (process.env.REQUIRE_TRANSITION_DB === '1' && !hasCreds) {
    assert.fail('BLOCKED: REQUIRE_TRANSITION_DB=1 but no disposable database credentials (LUNA_REMEDIATION_TEST_DB_URL + LUNA_REMEDIATION_TARGET_MARKER=LUNA-REMEDIATION-DISPOSABLE-v1, LUNA_REMEDIATION_EXPECTED_DATABASE, LUNA_REMEDIATION_EXPECTED_PROJECT_REF). No database was tested — refusing green DB acceptance.')
  }
  if (!hasCreds) {
    t.skip('SKIP disposable-DB: LUNA_REMEDIATION_TEST_DB_URL (+ marker vars) absent — the server RPC contract is NOT certified by this run. Use npm run test:property-transition-db, which exits non-zero without a tested database.')
    return
  }
  assert.equal(
    process.env.LUNA_REMEDIATION_TARGET_MARKER,
    'LUNA-REMEDIATION-DISPOSABLE-v1',
    'disposable marker identity must prove the target is not production'
  )
})
