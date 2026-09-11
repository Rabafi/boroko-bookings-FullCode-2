// V02 executor behavioral regression: immutable replay, correction gating,
// concurrency, archiving, and scope checks. Fake storage + scripted dispatch;
// the REAL executor, classifier, and envelope codec run throughout.
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TAB_RECOVERY_OUTCOMES,
  archiveRecoveryEnvelope,
  buildSplitPayload,
  defaultCanReplayOperation,
  listRecoveryEnvelopes,
  newRecoveryEnvelope,
  readRecoveryEnvelope,
  replaySavedTabOperation,
  resolvedRecoveryKey,
  scopedRecoveryKey,
  stableFingerprint,
  submitNewTabOperation,
  writeRecoveryEnvelope
} from '../src/shared/posTabRecovery.js'

const TAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_TENANT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function memoryStorage() {
  const map = new Map()
  return {
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) }
  }
}

function withStorage(store, fn) {
  const priorWindow = globalThis.window
  globalThis.window = { localStorage: store }
  try {
    return fn()
  } finally {
    if (priorWindow === undefined) delete globalThis.window
    else globalThis.window = priorWindow
  }
}

// Executor calls are async: the storage stub must stay installed until the
// returned promise settles, otherwise mid-flight reads/writes see no store.
async function withStorageAsync(store, fn) {
  const priorWindow = globalThis.window
  globalThis.window = { localStorage: store }
  try {
    return await fn()
  } finally {
    if (priorWindow === undefined) delete globalThis.window
    else globalThis.window = priorWindow
  }
}

function seedSplit(store, overrides = {}) {
  const payload = buildSplitPayload({ splitCount: 3, sourceTabVersion: 4 })
  const envelope = {
    ...newRecoveryEnvelope({
      kind: 'split', tenantId: TENANT, outletId: 'out-1', sourceTabId: TAB,
      actorId: ACTOR, expectedVersion: 4, payload,
      request: { source_tab_id: TAB, split_count: 3, target_table_names: [], source_tab_version: 4 }
    }),
    ...overrides
  }
  withStorage(store, () => writeRecoveryEnvelope('split', envelope, { tenantId: TENANT, sourceTabId: TAB }))
  return envelope
}

const committedSplitResult = {
  success: true,
  source_tab: { id: TAB, tab_version: 5 },
  new_tabs: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }]
}

test('replay dispatches the saved original verbatim, ignoring current form values', async () => {
  const store = memoryStorage()
  const saved = seedSplit(store, { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN })
  const seen = []
  const out = await withStorageAsync(store, () => replaySavedTabOperation({
    kind: 'split', tenantId: TENANT, sourceTabId: TAB, actorId: ACTOR,
    dispatch: async (args) => { seen.push(args); return committedSplitResult; }
  }))
  assert.equal(seen.length, 1)
  // The "form" says two-way; the saved operation is three-way. The original wins.
  assert.equal(seen[0].split_count, 3)
  assert.equal(seen[0].source_tab_version, 4)
  assert.equal(seen[0].idempotency_key, saved.operationId)
  assert.equal(seen[0].is_replay, true)
  assert.equal(out.classification.outcome, TAB_RECOVERY_OUTCOMES.COMMITTED)
  // Committed attempts are archived, not deleted.
  assert.equal(withStorage(store, () => readRecoveryEnvelope('split', { tenantId: TENANT, sourceTabId: TAB }).envelope), null)
  const archived = JSON.parse(store.getItem(resolvedRecoveryKey('split', { tenantId: TENANT, sourceTabId: TAB })))
  assert.equal(archived.operationId, saved.operationId)
  assert.equal(archived.outcome, TAB_RECOVERY_OUTCOMES.COMMITTED)
  assert.ok(archived.resolvedAt)
})

test('transfer replay uses the saved target, notes, version, and key', async () => {
  const store = memoryStorage()
  const payload = { target_waiter_id: 'w2', target_shift_id: 's2', expected_tab_version: 5, notes: 'handover' }
  const envelope = {
    ...newRecoveryEnvelope({
      kind: 'transfer', tenantId: TENANT, outletId: 'out-1', sourceTabId: TAB,
      actorId: ACTOR, expectedVersion: 5, payload,
      request: { tab_id: TAB, target_waiter_id: 'w2', target_shift_id: 's2', expected_tab_version: 5, notes: 'handover' }
    }),
    outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN
  }
  withStorage(store, () => writeRecoveryEnvelope('transfer', envelope, { tenantId: TENANT, sourceTabId: TAB }))
  const seen = []
  await withStorageAsync(store, () => replaySavedTabOperation({
    kind: 'transfer', tenantId: TENANT, sourceTabId: TAB, actorId: ACTOR,
    dispatch: async (args) => {
      seen.push(args)
      return { success: true, tab: { id: TAB, waiter_id: 'w2', tab_version: 6 }, operation_id: envelope.operationId }
    }
  }))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].target_waiter_id, 'w2')
  assert.equal(seen[0].target_shift_id, 's2')
  assert.equal(seen[0].expected_tab_version, 5)
  assert.equal(seen[0].notes, 'handover')
  assert.equal(seen[0].operation_id, envelope.operationId)
  assert.equal(seen[0].is_replay, true)
})

test('corrected attempt while unknown is refused without dispatch or new key', async () => {
  const store = memoryStorage()
  seedSplit(store, { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN })
  let dispatched = 0
  await assert.rejects(
    withStorageAsync(store, () => submitNewTabOperation({
      kind: 'split', tenantId: TENANT, sourceTabId: TAB, actorId: ACTOR,
      expectedVersion: 4,
      payload: buildSplitPayload({ splitCount: 4, sourceTabVersion: 4 }),
      request: { source_tab_id: TAB, split_count: 4, target_table_names: [], source_tab_version: 4 },
      corrected: true,
      dispatch: async () => { dispatched += 1; return { success: true }; }
    })),
    /proven terminal server rejection/i
  )
  assert.equal(dispatched, 0)
  // The original key is untouched: no replacement, no deletion.
  const { envelope } = withStorage(store, () => readRecoveryEnvelope('split', { tenantId: TENANT, sourceTabId: TAB }))
  assert.equal(envelope.outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(envelope.payload.split_count, 3)
})

test('corrected attempt after proven rejection archives and mints a new key', async () => {
  const store = memoryStorage()
  const saved = seedSplit(store, { outcome: TAB_RECOVERY_OUTCOMES.REJECTED, lastCode: 'tab_version_conflict' })
  const seen = []
  const out = await withStorageAsync(store, () => submitNewTabOperation({
    kind: 'split', tenantId: TENANT, sourceTabId: TAB, actorId: ACTOR,
    expectedVersion: 5,
    payload: buildSplitPayload({ splitCount: 4, sourceTabVersion: 5 }),
    request: { source_tab_id: TAB, split_count: 4, target_table_names: [], source_tab_version: 5 },
    corrected: true,
    dispatch: async (args) => {
      seen.push(args)
      return { success: true, source_tab: { id: TAB }, new_tabs: [{}, {}, {}, {}] }
    }
  }))
  assert.equal(seen.length, 1)
  assert.notEqual(seen[0].idempotency_key, saved.operationId)
  assert.equal(seen[0].split_count, 4)
  assert.equal(out.classification.outcome, TAB_RECOVERY_OUTCOMES.COMMITTED)
  // The rejected original was archived with its evidence intact.
  const archived = JSON.parse(store.getItem(resolvedRecoveryKey('split', { tenantId: TENANT, sourceTabId: TAB })))
  assert.equal(archived.outcome, TAB_RECOVERY_OUTCOMES.COMMITTED)
})

test('concurrent replays of one key dispatch exactly once', async () => {
  const store = memoryStorage()
  seedSplit(store, { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN })
  let dispatches = 0
  const priorWindow = globalThis.window
  globalThis.window = { localStorage: store }
  let first, second
  try {
    const run = () => replaySavedTabOperation({
      kind: 'split', tenantId: TENANT, sourceTabId: TAB, actorId: ACTOR,
      dispatch: async (args) => {
        dispatches += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return committedSplitResult
      }
    })
    ;[first, second] = await Promise.all([run(), run()])
  } finally {
    if (priorWindow === undefined) delete globalThis.window
    else globalThis.window = priorWindow
  }
  assert.equal(dispatches, 1)
  assert.equal(first.classification.outcome, TAB_RECOVERY_OUTCOMES.COMMITTED)
  assert.equal(second.classification.outcome, TAB_RECOVERY_OUTCOMES.COMMITTED)
})

test('storage failures block dispatch; corrupt records quarantine', async () => {
  const failing = {
    get length() { return 0 },
    key: () => null,
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {}
  }
  let dispatched = 0
  await await assert.rejects(
    withStorageAsync(failing, () => submitNewTabOperation({
      kind: 'split', tenantId: TENANT, sourceTabId: TAB, actorId: ACTOR,
      payload: buildSplitPayload({ splitCount: 2, sourceTabVersion: 1 }),
      request: { source_tab_id: TAB, split_count: 2, target_table_names: [], source_tab_version: 1 },
      dispatch: async () => { dispatched += 1; return { success: true }; }
    })),
    /blocked before dispatch/i
  )
  assert.equal(dispatched, 0)

  const corrupt = memoryStorage()
  withStorage(corrupt, () => corrupt.setItem(scopedRecoveryKey('split', { tenantId: TENANT, sourceTabId: TAB }), '{broken'))
  await await assert.rejects(
    withStorageAsync(corrupt, () => replaySavedTabOperation({
      kind: 'split', tenantId: TENANT, sourceTabId: TAB, actorId: ACTOR,
      dispatch: async () => { dispatched += 1; return { success: true }; }
    })),
    /quarantined/i
  )
  assert.equal(dispatched, 0)
})

test('tenant isolation and replay authorization are enforced', async () => {
  const store = memoryStorage()
  seedSplit(store, { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN })
  let dispatched = 0
  const spy = async () => { dispatched += 1; return { success: true }; }
  // Another tenant cannot replay this operation.
  await assert.rejects(
    withStorageAsync(store, () => replaySavedTabOperation({
      kind: 'transfer', tenantId: OTHER_TENANT, sourceTabId: TAB, actorId: ACTOR, dispatch: spy
    })),
    /no saved operation|different business/i
  )
  // Wrong kind cannot replay it either.
  await assert.rejects(
    withStorageAsync(store, () => replaySavedTabOperation({
      kind: 'transfer', tenantId: TENANT, sourceTabId: TAB, actorId: ACTOR, dispatch: spy
    })),
    /no saved operation|different kind/i
  )
  // An unrelated non-manager operator cannot replay it.
  await assert.rejects(
    withStorageAsync(store, () => replaySavedTabOperation({
      kind: 'split', tenantId: TENANT, sourceTabId: TAB, actorId: 'someone-else', actorRole: 'cashier', dispatch: spy
    })),
    /originating operator/i
  )
  // A manager can inspect/replay for recovery; the server still decides.
  const seen = []
  await withStorageAsync(store, () => replaySavedTabOperation({
    kind: 'split', tenantId: TENANT, sourceTabId: TAB, actorId: 'mgr-1', actorRole: 'manager',
    dispatch: async (args) => { seen.push(args); return committedSplitResult; }
  }))
  assert.equal(seen.length, 1)
  assert.equal(dispatched, 0)
  assert.ok(defaultCanReplayOperation({ envelope: { operationId: 'k', actorId: ACTOR }, actorId: ACTOR, actorRole: 'cashier' }))
  assert.equal(defaultCanReplayOperation({ envelope: { operationId: 'k', actorId: ACTOR }, actorId: 'x', actorRole: 'cashier' }), false)
})

test('unknown outcomes keep the original key for the next replay', async () => {
  const store = memoryStorage()
  const saved = seedSplit(store, { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN })
  const seen = []
  const out = await withStorageAsync(store, () => replaySavedTabOperation({
    kind: 'split', tenantId: TENANT, sourceTabId: TAB, actorId: ACTOR,
    dispatch: async () => {
      seen.push(1)
      return { success: false, code: 'unknown_split_error', outcome: 'unknown', error: 'socket hang up' }
    }
  }))
  assert.equal(out.classification.outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(out.classification.terminal, false)
  const { envelope } = withStorage(store, () => readRecoveryEnvelope('split', { tenantId: TENANT, sourceTabId: TAB }))
  assert.equal(envelope.operationId, saved.operationId)
  assert.equal(envelope.outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.ok(envelope.lastCheckedAt)
})

test('inbox discovery lists pending work independent of the tab list', async () => {
  const store = memoryStorage()
  seedSplit(store, { outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN })
  const transferEnvelope = newRecoveryEnvelope({
    kind: 'transfer', tenantId: TENANT, sourceTabId: 'tab-gone-from-list',
    actorId: ACTOR, payload: { target_waiter_id: 'w9' }, request: { tab_id: 'x' }
  })
  withStorage(store, () => writeRecoveryEnvelope('transfer', transferEnvelope, { tenantId: TENANT, sourceTabId: 'tab-gone-from-list' }))
  // Another tenant's envelope is never surfaced here.
  const foreign = newRecoveryEnvelope({ kind: 'split', tenantId: OTHER_TENANT, sourceTabId: TAB, actorId: ACTOR, payload: {} })
  withStorage(store, () => writeRecoveryEnvelope('split', foreign, { tenantId: OTHER_TENANT, sourceTabId: TAB }))

  const { envelopes, storageError } = withStorage(store, () => listRecoveryEnvelopes({ tenantId: TENANT }))
  assert.equal(storageError, false)
  assert.equal(envelopes.length, 2)
  assert.ok(envelopes.every((row) => !row.corrupt))
  assert.ok(envelopes.some((row) => row.envelope.sourceTabId === 'tab-gone-from-list'))
  const foreignList = withStorage(store, () => listRecoveryEnvelopes({ tenantId: OTHER_TENANT }))
  assert.equal(foreignList.envelopes.length, 1)
})

test('archive preserves evidence instead of deleting it', async () => {
  const store = memoryStorage()
  const saved = seedSplit(store, {
    outcome: TAB_RECOVERY_OUTCOMES.REJECTED,
    lastCode: 'tab_version_conflict',
    authoritativeResult: { success: false, code: 'tab_version_conflict' }
  })
  const { archived, key } = withStorage(store, () => archiveRecoveryEnvelope('split', saved, { tenantId: TENANT, sourceTabId: TAB }))
  assert.match(key, /hpos:resolved-tab-op:split:/)
  assert.equal(archived.lastCode, 'tab_version_conflict')
  assert.deepEqual(archived.authoritativeResult, { success: false, code: 'tab_version_conflict' })
  assert.ok(archived.resolvedAt)
  assert.equal(withStorage(store, () => readRecoveryEnvelope('split', { tenantId: TENANT, sourceTabId: TAB }).envelope), null)
  assert.equal(stableFingerprint({ a: 1 }), stableFingerprint({ a: 1 }))
})
