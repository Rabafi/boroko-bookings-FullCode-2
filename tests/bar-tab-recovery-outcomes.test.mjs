// V01 behavioral regression: provenance-aware outcome classification.
// Exercises the REAL classifier and the REAL domain functions (Electron
// stubbed, Supabase scripted, isolated temp cache). No source-text asserts.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs';
import path from 'node:path';

import {
  TAB_RECOVERY_OUTCOMES,
  TAB_RECOVERY_PROVENANCE,
  classifyTabOperationOutcome
} from '../src/shared/posTabRecovery.js'
import {
  importDomain,
  importState,
  makeTempCacheDir,
  scriptRpcSuccess
} from './helpers/domain-test-setup.mjs'

const setup = await import('./helpers/domain-test-setup.mjs').catch(() => null)
void setup

const { state, resetState } = await importState()
const pos = await importDomain('pos.js')

const TAB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LODGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FRESH = { keyPreviouslySent: false }
const REPLAY = { keyPreviouslySent: true }

function onlineWith(rpcMap, cacheDir) {
  resetState()
  state.isOnline = true
  state.lodgeId = LODGE_ID
  state.cacheDir = cacheDir
  state.supabase = scriptRpcSuccess(rpcMap)
}

function seedTabs(cacheDir, rows) {
  fs.writeFileSync(path.join(cacheDir, 'pos-tabs.json'), JSON.stringify(rows))
}

// ---- classifier: the independent verification repro cases ----

test('V01 repro: unknown outcomes stay unknown, never terminal rejection', () => {
  const transferUnknown = classifyTabOperationOutcome({
    success: false,
    code: 'unknown_transfer_error',
    outcome: 'unknown',
    error: 'network timeout'
  }, null, REPLAY)
  assert.equal(transferUnknown.outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(transferUnknown.terminal, false)

  const splitUnknown = classifyTabOperationOutcome({
    success: false,
    code: 'unknown_split_error',
    outcome: 'unknown',
    error: 'network timeout'
  }, null, REPLAY)
  assert.equal(splitUnknown.outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  // Even on a fresh key, an explicit domain unknown wins over the code.
  assert.equal(
    classifyTabOperationOutcome({ success: false, code: 'unknown_split_error', outcome: 'unknown' }, null, FRESH).outcome,
    TAB_RECOVERY_OUTCOMES.UNKNOWN
  )
})

test('transport failures, missing codes, and malformed shapes are unknown', () => {
  assert.equal(classifyTabOperationOutcome(null, new Error('fetch failed'), FRESH).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(classifyTabOperationOutcome(null, new Error('request timed out after commit'), REPLAY).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(classifyTabOperationOutcome(null, null, FRESH).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(classifyTabOperationOutcome({ weird: 1 }, null, FRESH).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  // Generic success:false without a verified code proves nothing.
  assert.equal(classifyTabOperationOutcome({ success: false, error: 'boom' }, null, FRESH).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(classifyTabOperationOutcome({ success: false }, null, FRESH).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  // A bare SQLSTATE without conflict evidence decides nothing.
  assert.equal(
    classifyTabOperationOutcome({ success: false, sqlState: '22000', error: 'numeric field overflow' }, null, FRESH).outcome,
    TAB_RECOVERY_OUTCOMES.UNKNOWN
  )
})

test('malformed success never manufactures commitment', () => {
  assert.equal(classifyTabOperationOutcome({ success: true }, null, FRESH).outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(
    classifyTabOperationOutcome({ success: true, tab: { id: TAB_ID } }, null, FRESH).outcome,
    TAB_RECOVERY_OUTCOMES.COMMITTED
  )
  assert.equal(
    classifyTabOperationOutcome({ success: true, new_tabs: [], source_tab: { id: TAB_ID } }, null, FRESH).outcome,
    TAB_RECOVERY_OUTCOMES.COMMITTED
  )
})

test('terminal version rejection is rejected fresh, unknown on replay', () => {
  const fresh = classifyTabOperationOutcome(
    { success: false, code: 'tab_version_conflict', provenance: TAB_RECOVERY_PROVENANCE.SERVER_RPC_RESPONSE, error: 'changed' },
    null, FRESH
  )
  assert.equal(fresh.outcome, TAB_RECOVERY_OUTCOMES.REJECTED)
  assert.equal(fresh.terminal, true)

  const replay = classifyTabOperationOutcome(
    { success: false, code: 'tab_version_conflict', provenance: TAB_RECOVERY_PROVENANCE.SERVER_RPC_RESPONSE, error: 'changed' },
    null, REPLAY
  )
  // tab_version_conflict is replay-convergent: a committed original would
  // have replayed its stored result instead, so this stays terminal.
  assert.equal(replay.outcome, TAB_RECOVERY_OUTCOMES.REJECTED)

  const replayOwned = classifyTabOperationOutcome(
    { success: false, code: 'tab_not_owned', provenance: TAB_RECOVERY_PROVENANCE.SERVER_RPC_RESPONSE, error: 'not owner' },
    null, REPLAY
  )
  assert.equal(replayOwned.outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(replayOwned.terminal, false)
})

test('idempotency conflicts need review on fresh and replayed keys', () => {
  for (const ctx of [FRESH, REPLAY]) {
    assert.equal(
      classifyTabOperationOutcome({ success: false, code: 'idempotency_conflict', error: 'used' }, null, ctx).outcome,
      TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW
    )
  }
  assert.equal(
    classifyTabOperationOutcome(
      { success: false, sqlState: '22000', error: 'Split operation key conflicts with a different payload' }, null, FRESH
    ).outcome,
    TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW
  )
  assert.equal(
    classifyTabOperationOutcome(null, new Error('Split operation key conflicts with a different payload'), FRESH).outcome,
    TAB_RECOVERY_OUTCOMES.NEEDS_REVIEW
  )
})

// ---- real domain functions ----

test('real splitBillEvenly: fresh terminal rejection carries server provenance', async () => {
  const cacheDir = makeTempCacheDir('v01-split')
  onlineWith({
    split_pos_tab_evenly: { success: false, code: 'tab_version_conflict', error: 'This tab changed on another terminal.', tab: { id: TAB_ID } }
  }, cacheDir)
  const result = await pos.splitBillEvenly({
    source_tab_id: TAB_ID, split_count: 2, source_tab_version: 3, idempotency_key: '11111111-1111-4111-8111-111111111111'
  })
  assert.equal(result.success, false)
  assert.equal(result.code, 'tab_version_conflict')
  assert.equal(result.provenance, TAB_RECOVERY_PROVENANCE.SERVER_RPC_RESPONSE)
  const classification = classifyTabOperationOutcome(result, null, FRESH)
  assert.equal(classification.outcome, TAB_RECOVERY_OUTCOMES.REJECTED)
  assert.equal(classification.terminal, true)
  // The same server response on a replayed key is NOT a correction license.
  const replayClassification = classifyTabOperationOutcome(
    { success: false, code: 'tab_not_owned', provenance: TAB_RECOVERY_PROVENANCE.SERVER_RPC_RESPONSE }, null, REPLAY)
  assert.equal(replayClassification.terminal, false)
})

test('real splitBillEvenly: transport error preserves unknown end to end', async () => {
  const cacheDir = makeTempCacheDir('v01-split-rpcerr')
  onlineWith({
    split_pos_tab_evenly: async () => { const error = new Error('ECONNRESET'); error.code = 'ECONNRESET'; throw error; }
  }, cacheDir)
  // scriptRpcSuccess throws for unexpected RPCs; emulate a throwing rpc:
  state.supabase = { rpc: async () => { throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); } }
  const result = await pos.splitBillEvenly({
    source_tab_id: TAB_ID, split_count: 2, source_tab_version: 3, idempotency_key: '22222222-2222-4222-8222-222222222222'
  })
  assert.equal(result.success, false)
  assert.equal(result.outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(result.provenance, TAB_RECOVERY_PROVENANCE.TRANSPORT_ERROR)
  const classification = classifyTabOperationOutcome(result, null, REPLAY)
  assert.equal(classification.outcome, TAB_RECOVERY_OUTCOMES.UNKNOWN)
  assert.equal(classification.terminal, false)
})

test('real splitBillEvenly: commit survives a post-commit local cache failure', async () => {
  const committed = {
    success: true,
    source_tab: { id: TAB_ID, tab_version: 4 },
    new_tabs: [{ id: 'n1' }, { id: 'n2' }]
  }
  // cacheDir unset: every cache path throws, including post-commit
  // reconciliation. The commit must still be reported as committed.
  onlineWith({ split_pos_tab_evenly: committed }, undefined)
  const result = await pos.splitBillEvenly({
    source_tab_id: TAB_ID, split_count: 2, source_tab_version: 3, idempotency_key: '33333333-3333-4333-8333-333333333333'
  })
  assert.equal(result.success, true)
  assert.ok(result.cacheSyncWarning, 'a non-fatal cache warning is recorded')
  assert.equal(classifyTabOperationOutcome(result, null, FRESH).outcome, TAB_RECOVERY_OUTCOMES.COMMITTED)
})

test('real transferPosTabWaiter: fresh rejection, replay ambiguity, and replay bypass', async () => {
  const cacheDir = makeTempCacheDir('v01-transfer')
  seedTabs(cacheDir, [{ id: TAB_ID, lodge_id: LODGE_ID, outlet_id: 'out-1', waiter_id: 'waiter-a', tab_version: 5, status: 'open' }])
  const waiterB = 'waiter-b', shiftB = 'shift-b'
  onlineWith({
    transfer_pos_tab_waiter: { success: false, code: 'waiter_shift_required', error: 'Target waiter has no open shift.' }
  }, cacheDir)
  const freshArgs = {
    tab_id: TAB_ID, target_waiter_id: waiterB, target_shift_id: shiftB,
    expected_tab_version: 5, operation_id: '44444444-4444-4444-8444-444444444444'
  }
  const fresh = await pos.transferPosTabWaiter(freshArgs)
  assert.equal(fresh.success, false)
  assert.equal(fresh.provenance, TAB_RECOVERY_PROVENANCE.SERVER_RPC_RESPONSE)
  assert.equal(classifyTabOperationOutcome(fresh, null, FRESH).outcome, TAB_RECOVERY_OUTCOMES.REJECTED)

  // Replay of the same key reaching a claim about ownership is ambiguous.
  assert.equal(
    classifyTabOperationOutcome(
      { success: false, code: 'tab_not_owned', provenance: TAB_RECOVERY_PROVENANCE.SERVER_RPC_RESPONSE }, null, REPLAY
    ).outcome,
    TAB_RECOVERY_OUTCOMES.UNKNOWN
  )

  // A replay is not blocked by a refreshed cache that already shows the
  // saved target as owner: the server replays authoritatively.
  seedTabs(cacheDir, [{ id: TAB_ID, lodge_id: LODGE_ID, outlet_id: 'out-1', waiter_id: waiterB, tab_version: 6, status: 'open' }])
  let seenArgs = null
  state.supabase = scriptRpcSuccess({
    transfer_pos_tab_waiter: (args) => {
      seenArgs = args
      return { success: true, tab: { id: TAB_ID, waiter_id: waiterB, tab_version: 6 }, operation_id: freshArgs.operation_id }
    }
  })
  const replayed = await pos.transferPosTabWaiter({ ...freshArgs, is_replay: true })
  assert.equal(replayed.success, true)
  assert.equal(seenArgs.p_operation_id, freshArgs.operation_id)
  assert.equal(seenArgs.p_target_waiter_id, waiterB)
  assert.equal(classifyTabOperationOutcome(replayed, null, REPLAY).outcome, TAB_RECOVERY_OUTCOMES.COMMITTED)
})

test('real transferPosTabWaiter: local validation never dispatches', async () => {
  const cacheDir = makeTempCacheDir('v01-transfer-local')
  onlineWith({}, cacheDir)
  let dispatched = false
  state.supabase = { rpc: async () => { dispatched = true; return { data: null, error: null }; } }
  const result = await pos.transferPosTabWaiter({ tab_id: '', target_waiter_id: 'w', target_shift_id: 's', expected_tab_version: 1 })
  assert.equal(result.success, false)
  assert.equal(result.provenance, TAB_RECOVERY_PROVENANCE.LOCAL_VALIDATION)
  assert.equal(dispatched, false)
  assert.equal(classifyTabOperationOutcome(result, null, FRESH).outcome, TAB_RECOVERY_OUTCOMES.REJECTED)
})
