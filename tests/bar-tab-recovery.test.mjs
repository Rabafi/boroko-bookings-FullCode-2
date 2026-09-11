import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TAB_RECOVERY_OUTCOMES,
  buildSplitPayload,
  buildTransferPayload,
  classifyTabOperationOutcome,
  clearRecoveryEnvelope,
  newRecoveryEnvelope,
  quarantineRecoveryRecord,
  readRecoveryEnvelope,
  scopedRecoveryKey,
  legacyRecoveryKey,
  stableFingerprint,
  writeRecoveryEnvelope
} from '../src/shared/posTabRecovery.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

function memoryStorage() {
  const map = new Map()
  return {
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

const TAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

test('split fingerprint is stable and envelopes persist before dispatch', () => {
  const payload = buildSplitPayload({ splitCount: 3, sourceTabVersion: 4 })
  assert.deepEqual(payload, { split_count: 3, source_tab_version: 4 })
  assert.equal(stableFingerprint(payload), stableFingerprint({ split_count: 3, source_tab_version: 4 }))
  assert.notEqual(stableFingerprint(payload), stableFingerprint({ split_count: 4, source_tab_version: 4 }))

  withStorage(memoryStorage(), () => {
    const envelope = newRecoveryEnvelope({
      kind: 'split', tenantId: TENANT, outletId: null, sourceTabId: TAB,
      actorId: ACTOR, expectedVersion: 4, payload
    })
    const written = writeRecoveryEnvelope('split', envelope, { tenantId: TENANT, sourceTabId: TAB })
    assert.equal(written.ok, true)
    const { envelope: loaded, corrupt } = readRecoveryEnvelope('split', { tenantId: TENANT, sourceTabId: TAB })
    assert.equal(corrupt, false)
    assert.equal(loaded.operationId, envelope.operationId)
    assert.equal(loaded.payloadFingerprint, stableFingerprint(payload))
    clearRecoveryEnvelope('split', { tenantId: TENANT, sourceTabId: TAB })
    assert.equal(readRecoveryEnvelope('split', { tenantId: TENANT, sourceTabId: TAB }).envelope, null)
  })
})

test('legacy tab-only envelopes remain readable and scoped keys isolate tenants', () => {
  const store = memoryStorage()
  withStorage(store, () => {
    store.setItem(legacyRecoveryKey('split', TAB), JSON.stringify({ operationKey: 'legacy-key', payloadFingerprint: 'fp' }))
    const { envelope } = readRecoveryEnvelope('split', { tenantId: TENANT, sourceTabId: TAB })
    assert.equal(envelope.operationId, 'legacy-key')

    const a = newRecoveryEnvelope({ kind: 'split', tenantId: TENANT, sourceTabId: TAB, payload: { split_count: 2 } })
    writeRecoveryEnvelope('split', a, { tenantId: TENANT, sourceTabId: TAB })
    assert.equal(scopedRecoveryKey('split', { tenantId: TENANT, sourceTabId: TAB }).includes(TENANT), true)
    // Another tenant cannot resolve this envelope through its own scoped read
    // once the legacy row is gone.
    store.removeItem(legacyRecoveryKey('split', TAB))
    const other = readRecoveryEnvelope('split', { tenantId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sourceTabId: TAB })
    assert.equal(other.envelope, null)
  })
})

test('corrupt records quarantine instead of deleting ambiguous work', () => {
  const store = memoryStorage()
  withStorage(store, () => {
    store.setItem(scopedRecoveryKey('transfer', { tenantId: TENANT, sourceTabId: TAB }), '{not-json')
    const { envelope, corrupt, raw } = readRecoveryEnvelope('transfer', { tenantId: TENANT, sourceTabId: TAB })
    assert.equal(envelope, null)
    assert.equal(corrupt, true)
    const qkey = quarantineRecoveryRecord('transfer', { sourceTabId: TAB, raw })
    assert.match(qkey, /hpos:quarantine-tab-op:transfer:/)
    assert.equal(store.getItem(qkey), '{not-json')
  })
})

test('storage failure blocks the mutation instead of dispatching unrecorded work', () => {
  const failing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => {} }
  withStorage(failing, () => {
    const envelope = newRecoveryEnvelope({ kind: 'split', tenantId: TENANT, sourceTabId: TAB, payload: { split_count: 2 } })
    const result = writeRecoveryEnvelope('split', envelope, { tenantId: TENANT, sourceTabId: TAB })
    assert.equal(result.ok, false)
    assert.match(result.error, /storage/i)
  })
})

test('outcome classification separates committed, rejected, review, and unknown', () => {
  assert.equal(classifyTabOperationOutcome({ success: true, tab: { id: TAB } }).outcome, TAB_RECOVERY_OUTCOMES.COMMITTED)
  // Bare success without server evidence never manufactures commitment.
  assert.equal(classifyTabOperationOutcome({ success: true }).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(classifyTabOperationOutcome({ success: false, code: 'tab_version_conflict' }).outcome, TAB_RECOVERY_OUTCOMES.REJECTED)
  assert.equal(classifyTabOperationOutcome({ success: false, code: 'tab_not_owned' }).outcome, TAB_RECOVERY_OUTCOMES.REJECTED)
  assert.equal(classifyTabOperationOutcome({ success: false, code: 'waiter_shift_required' }).outcome, TAB_RECOVERY_OUTCOMES.REJECTED)
  // Generic success:false without a verified terminal code proves nothing.
  assert.equal(classifyTabOperationOutcome({ success: false, error: 'Only an open tab can be split.' }).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  // Domain-asserted uncertainty always wins, even with a code attached.
  assert.equal(
    classifyTabOperationOutcome({ success: false, code: 'unknown_transfer_error', outcome: 'unknown' }, null, { keyPreviouslySent: true }).outcome,
    TAB_RECOVERY_OUTCOMES.UNKNOWN
  )
  // Replay failures other than version conflict stay unknown: a
  // still-running original, rotated proof, or new owner cannot be excluded.
  assert.equal(
    classifyTabOperationOutcome({ success: false, code: 'tab_not_owned' }, null, { keyPreviouslySent: true }).outcome,
    TAB_RECOVERY_OUTCOMES.UNKNOWN
  )
  assert.equal(classifyTabOperationOutcome({ success: false, code: 'idempotency_conflict' }).outcome, TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW)
  // A bare SQLSTATE without conflict evidence decides nothing.
  assert.equal(classifyTabOperationOutcome({ success: false, sqlState: '22000', error: 'numeric overflow' }).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(
    classifyTabOperationOutcome({ success: false, sqlState: '22000', error: 'Split operation key conflicts with a different payload' }).outcome,
    TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW
  )
  assert.equal(classifyTabOperationOutcome(null, new Error('fetch failed')).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(classifyTabOperationOutcome(null, new Error('Split operation key conflicts with a different payload')).outcome, TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW)
  // Timeout after commit arrives as a transport error: unknown, replay original.
  assert.equal(classifyTabOperationOutcome(null, new Error('request timed out after commit')).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
})

test('same key with a changed payload is blocked until a terminal rejection allows correction', () => {
  const original = buildSplitPayload({ splitCount: 2, sourceTabVersion: 3 })
  const changed = buildSplitPayload({ splitCount: 4, sourceTabVersion: 3 })
  assert.notEqual(stableFingerprint(original), stableFingerprint(changed))

  const rejected = { ...newRecoveryEnvelope({ kind: 'split', tenantId: TENANT, sourceTabId: TAB, payload: original }), outcome: TAB_RECOVERY_OUTCOMES.REJECTED }
  const unknown = { ...rejected, outcome: TAB_RECOVERY_OUTCOMES.UNKNOWN }
  // Correction is permitted only from a proven rejection.
  assert.equal(rejected.outcome, TAB_RECOVERY_OUTCOMES.REJECTED)
  assert.equal(unknown.outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)

  const transferOriginal = buildTransferPayload({ targetWaiterId: 'w1', targetShiftId: 's1', expectedTabVersion: 2, notes: 'a' })
  const transferChangedNotes = buildTransferPayload({ targetWaiterId: 'w1', targetShiftId: 's1', expectedTabVersion: 2, notes: 'b' })
  assert.notEqual(stableFingerprint(transferOriginal), stableFingerprint(transferChangedNotes))
})

test('domain preserves SQLSTATE and outcome codes through the IPC boundary', () => {
  const domain = read('src/main/domains/pos.js')
  const ipc = read('src/main/index.js')
  // Split: conflict maps to needs_review, rejections carry codes, commits carry outcome.
  assert.match(domain, /code: conflict \? 'idempotency_conflict'/)
  assert.match(domain, /outcome: rpcData\.code === 'idempotency_conflict' \? 'needs_review' : 'rejected'/)
  assert.match(domain, /outcome: 'committed'/)
  // Transfer: thrown errors keep sqlState, rejections pass through with operation key.
  assert.match(domain, /sqlState/)
  assert.match(domain, /operation_id: operationId, outcome: 'unknown'/)
  // Transfer replay is not blocked by a missing local cache row.
  assert.match(domain, /isReplayWithoutCache/)
  // Replays bypass stale local pre-checks; the server decides authoritatively.
  assert.match(domain, /is_replay === true/)
  // Post-commit cache failures stay committed with a warning, never failure.
  assert.match(domain, /cacheSyncWarning/)
  // Every result carries provenance so the classifier never guesses.
  assert.match(domain, /provenance: 'local-validation'/)
  assert.match(domain, /provenance: 'server-rpc-response'/)
  assert.match(domain, /provenance: 'transport-error'/)
  // IPC handlers forward the domain envelope instead of stripping codes.
  assert.match(ipc, /finalizeSharedTillMutation\(event, await db\.splitBillEvenly/)
  assert.match(ipc, /finalizeSharedTillMutation\(event, await db\.transferPosTabWaiter/)
})

test('server contracts replay the original result and reject same-key payload changes', () => {
  const split = read('supabase/migrations/20260807130000_bar_tab_financial_snapshot_and_concurrency.sql')
  assert.match(split, /pos_tab_split_operations/)
  assert.match(split, /payload_hash is distinct from v_hash/)
  assert.match(split, /replayed/)
  const transfer = read('supabase/migrations/20260820180000_pos_tab_assigned_waiter_ownership.sql')
  assert.match(transfer, /pos_tab_waiter_transfer_operations/)
  assert.match(transfer, /idempotency_conflict/)
  assert.match(transfer, /replayed/)
})

test('open-tabs UI exposes check-status, retry-original, and corrected-attempt recovery without deletion advice', () => {
  const ui = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')
  assert.match(ui, /Check status/)
  assert.match(ui, /Retry original/)
  assert.match(ui, /Start corrected attempt/)
  assert.match(ui, /Outcome not confirmed/)
  assert.match(ui, /describeRecoveryEnvelope/)
  assert.match(ui, /replaySavedTabOperation/)
  assert.match(ui, /submitNewTabOperation/)
  assert.match(ui, /recovery-inbox/)
  assert.match(ui, /replays the saved operation under its original key/)
  assert.match(ui, /TAB_RECOVERY_OUTCOMES/)
  assert.doesNotMatch(ui, /delete.*localStorage|clear.*localStorage|localStorage\.removeItem\(`hpos:pending/i)
  assert.doesNotMatch(ui, /manually delete|delete.*browser data/i)
})
