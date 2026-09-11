// Accounting activation: real validator, real approve domain function, and
// wiring assertions for the approve-cutover path, route, and recovery copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  importDomain,
  importState,
  makeTempCacheDir,
  scriptRpcSuccess
} from './helpers/domain-test-setup.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

const { validateOpeningBalances } = await import('./helpers/domain-test-setup.mjs')
  .then(() => import('../src/renderer/src/components/restaurant-accounting/RestaurantAccountingActivation.jsx'))

const {
  compareActivationState,
  resolveApplyOutcome,
  resolveApproveOutcome,
  reviewMatchesFresh,
  snapshotActivationRequest,
  snapshotReviewedEvidence,
  validateSafetyConfig
} = await import('../src/shared/accountingActivation.js')

test('opening-balance validation rejects blanks, zeros, and duplicate accounts', () => {
  assert.deepEqual(validateOpeningBalances([
    { accountId: 'a1', equityAccountId: 'e1', entryDate: '2026-09-01', amount: 1500 }
  ]), [])
  const errors = validateOpeningBalances([
    { accountId: 'a1', equityAccountId: 'e1', entryDate: '2026-09-01', amount: 1500 },
    { accountId: 'a1', equityAccountId: 'e1', entryDate: '2026-09-01', amount: 200 },
    { accountId: '', equityAccountId: '', entryDate: '', amount: 0 }
  ])
  assert.ok(errors.some((message) => /only one posting per account/i.test(message)))
  assert.ok(errors.some((message) => /balance-sheet account/i.test(message)))
  assert.ok(errors.some((message) => /non-zero amount/i.test(message)))
})

test('approve-cutover domain function maps exact server arguments', async () => {
  const accounting = await importDomain('restaurantAccountingV2.js')
  const { state, resetState } = await importState()
  resetState()
  state.isOnline = true
  state.lodgeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  state.cacheDir = makeTempCacheDir('activation-approve')
  let seen = null
  state.supabase = scriptRpcSuccess({
    approve_restaurant_historical_cutover: (args) => {
      seen = args
      return { success: true, data: { id: 'batch-1', status: 'approved' } }
    }
  })
  const result = await accounting.approveRestaurantHistoricalCutoverV2({
    batchId: 'batch-1',
    reviewNotes: 'Verified against source exports.',
    expectedOpeningPayloadHash: 'hashabc',
    expectedSourceManifestHash: 'src1',
    expectedPreparedBy: 'user-aaaa'
  })
  assert.equal(seen.p_batch_id, 'batch-1')
  assert.equal(seen.p_review_notes, 'Verified against source exports.')
  assert.equal(seen.p_expected_opening_payload_hash, 'hashabc')
  assert.equal(seen.p_expected_source_manifest_hash, 'src1')
  assert.equal(seen.p_expected_prepared_by, 'user-aaaa')
  assert.equal(result?.success ?? result?.data?.status === 'approved', true)
})

test('approve-cutover domain function preserves explicit null reviewed source', async () => {
  const accounting = await importDomain('restaurantAccountingV2.js')
  const { state, resetState } = await importState()
  resetState()
  state.isOnline = true
  state.lodgeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  state.cacheDir = makeTempCacheDir('activation-approve-null-source')
  let seen = null
  state.supabase = scriptRpcSuccess({
    approve_restaurant_historical_cutover: (args) => {
      seen = args
      return { success: true, data: { id: 'batch-1', status: 'approved' } }
    }
  })
  await accounting.approveRestaurantHistoricalCutoverV2({
    batchId: 'batch-1',
    reviewNotes: 'Verified against source exports.',
    expectedOpeningPayloadHash: 'hashabc',
    expectedSourceManifestHash: null,
    expectedPreparedBy: 'user-aaaa'
  })
  assert.equal(seen.p_expected_source_manifest_hash, null)
  assert.equal(seen.p_expected_prepared_by, 'user-aaaa')
})

test('approve-cutover is IPC-mapped behind management access', () => {
  const main = read('src/main/index.js')
  assert.match(main, /approveCutover: \['accounting\.manage', db\.approveRestaurantHistoricalCutoverV2\]/)
  assert.match(main, /applyCutover: \['accounting\.manage', db\.applyRestaurantHistoricalCutoverV2\]/)
  assert.match(main, /getCutoverBatches: \['accounting\.read', db\.getRestaurantHistoricalCutoverBatchesV2\]/)
  assert.match(main, /getCutoverBatch: \['accounting\.read', db\.getRestaurantHistoricalCutoverBatchV2\]/)
  assert.match(main, /getActivationState: \['accounting\.read', db\.getRestaurantAccountingActivationStateV2\]/)
})

test('activation route, entry link, and uncertain-response recovery are wired', () => {
  const app = read('src/renderer/src/App.jsx')
  assert.match(app, /path="restaurant\/accounting-setup"/)
  assert.match(app, /RestaurantAccountingActivation/)
  const ui = read('src/renderer/src/components/restaurant-accounting/RestaurantAccountingUi.jsx')
  assert.match(ui, /to="\/restaurant\/accounting-setup"/)
  const page = read('src/renderer/src/components/restaurant-accounting/RestaurantAccountingActivation.jsx')
  assert.match(page, /Outcome not confirmed/)
  assert.match(page, /read-back authoritative state|reading back authoritative state/)
  assert.match(page, /retained/)
  assert.match(page, /preparer.*approver|approver.*preparer/i)
})

test('authorization matrix covers the approve-cutover path', () => {
  const matrix = read('docs/ACCOUNTING_RPC_AUTHORIZATION_MATRIX.md')
  assert.match(matrix, /\| approveCutover \| accounting\.manage \| approveRestaurantHistoricalCutoverV2 \| approve_restaurant_historical_cutover \|/)
  assert.match(matrix, /\| applyCutover \| accounting\.manage \| applyRestaurantHistoricalCutoverV2 \| apply_restaurant_historical_cutover \|/)
  assert.match(matrix, /\| getCutoverBatches \| accounting\.read \| getRestaurantHistoricalCutoverBatchesV2 \|/)
  assert.match(matrix, /\| getCutoverBatch \| accounting\.read \| getRestaurantHistoricalCutoverBatchV2 \|/)
  assert.match(matrix, /\| getActivationState \| accounting\.read \| getRestaurantAccountingActivationStateV2 \|/)
})

test('activation request snapshots freeze; comparator reconciles the full tuple', () => {
  const requested = snapshotActivationRequest({
    lodgeId: '  LODGE-1 ', effectiveFrom: '2026-09-01', configurationVersion: ' v1 ',
    policyVersion: 'bar-accounting-financial-truth-v1', cutoverBatchId: null
  })
  assert.ok(Object.isFrozen(requested))
  assert.deepEqual({ ...requested }, {
    lodgeId: 'LODGE-1', effectiveFrom: '2026-09-01', configurationVersion: 'v1',
    policyVersion: 'bar-accounting-financial-truth-v1', cutoverBatchId: null
  })
  const exact = compareActivationState(requested, {
    lodge_id: 'lodge-1', status: 'active', active: true, effective_from: '2026-09-01',
    configuration_version: 'v1', policy_version: 'bar-accounting-financial-truth-v1',
    historical_cutover_batch_id: null
  })
  assert.equal(exact.verdict, 'exact-match')
  // An older active configuration never confirms the requested change.
  const different = compareActivationState(requested, {
    lodge_id: 'lodge-1', status: 'active', active: true, effective_from: '2026-08-01',
    configuration_version: 'v0', policy_version: 'bar-accounting-financial-truth-v1',
    historical_cutover_batch_id: null
  })
  assert.equal(different.verdict, 'active-different')
  assert.deepEqual(different.mismatches.sort(), ['configuration version', 'effective date'])
  // Inactive and malformed states stay distinct from confirmation. The
  // inactive case carries an explicitly present null cutover identity: a
  // missing key is unreadable evidence under F2, never an implicit match.
  assert.equal(compareActivationState(requested, { lodge_id: 'lodge-1', status: 'draft', active: false, historical_cutover_batch_id: null }).verdict, 'inactive')
  assert.equal(compareActivationState(requested, null).verdict, 'unreadable')
  assert.equal(compareActivationState(requested, { status: 'active', active: true }).verdict, 'unreadable')
  // A requested cutover batch with no authoritative identity never confirms.
  const withBatch = snapshotActivationRequest({ lodgeId: 'lodge-1', effectiveFrom: '2026-09-01', configurationVersion: 'v1', policyVersion: 'p', cutoverBatchId: 'batch-9' })
  assert.equal(compareActivationState(withBatch, {
    lodge_id: 'lodge-1', status: 'active', active: true, effective_from: '2026-09-01',
    configuration_version: 'v1', policy_version: 'p', historical_cutover_batch_id: null
  }).verdict, 'unreadable')
  // Tenant mismatch never confirms, even when everything else matches.
  assert.equal(compareActivationState(requested, {
    lodge_id: 'other-lodge', status: 'active', active: true, effective_from: '2026-09-01',
    configuration_version: 'v1', policy_version: 'bar-accounting-financial-truth-v1',
    historical_cutover_batch_id: null
  }).verdict, 'active-different')
})

test('cutover batch and apply domain functions map exact server arguments', async () => {
  const accounting = await importDomain('restaurantAccountingV2.js')
  const { state, resetState } = await importState()
  resetState()
  state.isOnline = true
  state.lodgeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  state.cacheDir = makeTempCacheDir('activation-wiring')
  const seen = {}
  state.supabase = scriptRpcSuccess({
    get_restaurant_historical_cutover_batches: (args) => { seen.batches = args; return { success: true, data: [] } },
    get_restaurant_historical_cutover_batch: (args) => { seen.batch = args; return { success: true, data: null } },
    apply_restaurant_historical_cutover: (args) => { seen.apply = args; return { success: true, data: { id: 'b', status: 'applied', replayed: false, opening_postings: [] } } },
    get_restaurant_accounting_activation_state: (args) => { seen.state = args; return { success: true, data: null } }
  })
  await accounting.getRestaurantHistoricalCutoverBatchesV2(50)
  assert.equal(seen.batches.p_limit, 50)
  // p_lodge_id always comes from trusted main-process state, never arguments.
  assert.equal(seen.batches.p_lodge_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await accounting.getRestaurantHistoricalCutoverBatchV2('batch-1')
  assert.equal(seen.batch.p_batch_id, 'batch-1')
  assert.equal(seen.batch.p_lodge_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  assert.throws(() => accounting.getRestaurantHistoricalCutoverBatchV2('  '), /batch ID is required/)
  const applied = await accounting.applyRestaurantHistoricalCutoverV2('batch-1')
  assert.equal(seen.apply.p_batch_id, 'batch-1')
  assert.equal(applied.data.status, 'applied')
  await accounting.getRestaurantAccountingActivationStateV2()
  assert.equal(seen.state.p_lodge_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
})

test('forward migration carries timestamp repairs, scoped reads, and least-privilege grants', () => {  const migration = read('supabase/migrations/20260907010000_accounting_cutover_reads_and_activation_grants.sql')
  assert.match(migration, /add column if not exists approved_at timestamptz/)
  assert.match(migration, /add column if not exists applied_at timestamptz/)
  assert.match(migration, /create or replace function public\.get_restaurant_historical_cutover_batches\(\s*p_lodge_id uuid,\s*p_limit integer default 20\s*\)/s)
  assert.match(migration, /create or replace function public\.get_restaurant_historical_cutover_batch\(\s*p_lodge_id uuid,\s*p_batch_id uuid\s*\)/s)
  assert.match(migration, /create or replace function public\.get_restaurant_accounting_activation_state\(\s*p_lodge_id uuid\s*\)/s)
  assert.match(migration, /security definer/)
  assert.match(migration, /set search_path = public/)
  assert.match(migration, /_restaurant_require_capability\(p_lodge_id, 'accounting\.read'\)/)
  assert.match(migration, /grant execute on function public\.apply_restaurant_historical_cutover\(uuid, uuid\) to authenticated;/)
  assert.match(migration, /grant execute on function public\.get_restaurant_accounting_activation_state\(uuid\) to authenticated;/)
  assert.doesNotMatch(migration, /to anon/)
  assert.doesNotMatch(migration, /service-role key|service_role.*key/i)
})

test('G1 revision-binding migration replaces the weak overload atomically', () => {
  const binding = read('supabase/migrations/20260908010000_accounting_approve_revision_binding.sql')
  // The weaker 4-argument overload is dropped so it stays unexecutable.
  assert.match(binding, /drop function if exists public\.approve_restaurant_historical_cutover\(uuid, uuid, text, text\);/)
  // Single strong 6-argument form with required reviewed identities.
  assert.match(binding, /create or replace function public\.approve_restaurant_historical_cutover\(\s*p_lodge_id uuid,\s*p_batch_id uuid,\s*p_review_notes text,\s*p_expected_opening_payload_hash text,\s*p_expected_source_manifest_hash text,\s*p_expected_prepared_by uuid\s*\)/s)
  // Null-safe revision binding under the row lock (IS DISTINCT FROM
  // rejects null-vs-value in either direction; plain <> would not).
  assert.match(binding, /p_expected_opening_payload_hash is distinct from v_opening_hash/)
  assert.match(binding, /p_expected_source_manifest_hash is distinct from v_batch\.source_manifest_hash/)
  assert.match(binding, /p_expected_prepared_by is distinct from v_batch\.prepared_by/)
  assert.match(binding, /for update/)
  // Prior guards preserved: status, preparer≠approver, audit completeness,
  // stored-vs-audit drift, balance shape.
  assert.match(binding, /The cutover preparer cannot approve the same batch/)
  assert.match(binding, /Historical source manifest changed after preparation/)
  assert.match(binding, /Historical cutover audit has blockers/)
  assert.match(binding, /security definer/)
  assert.match(binding, /set search_path = public/)
  // Least privilege: authenticated + service_role on the new signature
  // only; anon/public revoked; no weaker overload left to grant.
  assert.match(binding, /grant execute on function public\.approve_restaurant_historical_cutover\(uuid, uuid, text, text, text, uuid\) to authenticated, service_role;/)
  assert.match(binding, /revoke all on function public\.approve_restaurant_historical_cutover\(uuid, uuid, text, text, text, uuid\) from public, anon;/)
  assert.doesNotMatch(binding, /to anon,/)
})

test('F1 evidence-binding migration requires the reviewed hash and keeps mutation-time guards', () => {
  const binding = read('supabase/migrations/20260908000000_accounting_approve_evidence_binding.sql')
  // A null/blank expected hash is rejected instead of bypassing review.
  assert.match(binding, /p_expected_opening_payload_hash.*is null then/s)
  assert.match(binding, /Reviewed opening-balance evidence is required/)
  assert.match(binding, /errcode = '22023'/)
  // The strict comparison replaces the null-skipping guard.
  assert.doesNotMatch(binding, /p_expected_opening_payload_hash is not null and/)
  // Mutation-time validation under the row lock is preserved verbatim.
  assert.match(binding, /for update/)
  assert.match(binding, /The cutover preparer cannot approve the same batch/)
  assert.match(binding, /Opening-balance payload hash does not match the prepared batch/)
  assert.match(binding, /Historical source manifest changed after preparation/)
  assert.match(binding, /security definer/)
  assert.match(binding, /set search_path = public/)
  // The repair grants nothing new.
  assert.doesNotMatch(binding, /grant execute/i)
  assert.match(binding, /revoke all on function public\.approve_restaurant_historical_cutover\(uuid, uuid, text, text\) from public, anon;/)
})

// F2 regressions: the comparator must fail closed. Each case below
// reproduced a false confirmation (or a silent alias pick) on the old code.
test('F2 comparator requires explicit cutover identity and boolean active', () => {
  const requested = snapshotActivationRequest({
    lodgeId: 'lodge-1', effectiveFrom: '2026-09-01', configurationVersion: 'v1',
    policyVersion: 'p', cutoverBatchId: null
  })
  const base = {
    lodge_id: 'lodge-1', status: 'active', active: true, effective_from: '2026-09-01',
    configuration_version: 'v1', policy_version: 'p', historical_cutover_batch_id: null
  }
  // Absent cutover identity is unreadable even when the request is null:
  // only an explicitly present null matches a no-cutover request.
  const { historical_cutover_batch_id: _dropped, ...absentCutover } = base
  assert.equal(compareActivationState(requested, absentCutover).verdict, 'unreadable')
  // Explicit null still matches a no-cutover request.
  assert.equal(compareActivationState(requested, base).verdict, 'exact-match')
  // active:false with status:active is scheduled/not-yet-active, never a
  // confirmation of current activation.
  const scheduled = compareActivationState(requested, { ...base, active: false })
  assert.equal(scheduled.verdict, 'inactive')
  assert.equal(scheduled.scheduled, true)
  // Missing or malformed active is unreadable: status alone never confirms.
  const { active: _droppedActive, ...missingActive } = base
  assert.equal(compareActivationState(requested, missingActive).verdict, 'unreadable')
  assert.equal(compareActivationState(requested, { ...base, active: 'yes' }).verdict, 'unreadable')
  assert.equal(compareActivationState(requested, { ...base, active: 1 }).verdict, 'unreadable')
  // Conflicting cutover aliases are rejected, not silently resolved.
  assert.equal(compareActivationState(requested, {
    ...base, historical_cutover_batch_id: 'batch-a', cutover_batch_id: 'batch-b'
  }).verdict, 'unreadable')
  // A compatible alias still reads through one canonical field.
  assert.equal(compareActivationState(requested, {
    lodge_id: 'lodge-1', status: 'active', active: true, effective_from: '2026-09-01',
    configuration_version: 'v1', policy_version: 'p', cutover_batch_id: null
  }).verdict, 'exact-match')
  // Malformed identity values are unreadable, never coerced into evidence.
  assert.equal(compareActivationState(requested, { ...base, lodge_id: 42 }).verdict, 'unreadable')
  assert.equal(compareActivationState(requested, { ...base, effective_from: { date: 'x' } }).verdict, 'unreadable')
  // Array responses are unreadable.
  assert.equal(compareActivationState(requested, [base]).verdict, 'unreadable')
})

test('F2 comparator keeps the full tuple matrix and scheduled wording support', () => {
  const requested = snapshotActivationRequest({
    lodgeId: 'lodge-1', effectiveFrom: '2026-09-01', configurationVersion: 'v1',
    policyVersion: 'p', cutoverBatchId: 'batch-9'
  })
  const match = {
    lodge_id: 'lodge-1', status: 'active', active: true, effective_from: '2026-09-01',
    configuration_version: 'v1', policy_version: 'p', historical_cutover_batch_id: 'batch-9'
  }
  assert.equal(compareActivationState(requested, match).verdict, 'exact-match')
  assert.equal(compareActivationState(requested, match).scheduled, false)
  const wrongBatch = compareActivationState(requested, { ...match, historical_cutover_batch_id: 'batch-8' })
  assert.equal(wrongBatch.verdict, 'active-different')
  assert.deepEqual(wrongBatch.mismatches, ['cutover batch'])
  const inactiveMismatch = compareActivationState(requested, { ...match, active: false, status: 'draft', effective_from: '2026-08-01' })
  assert.equal(inactiveMismatch.verdict, 'inactive')
  assert.equal(inactiveMismatch.scheduled, false)
  // Future-effective scheduled state carries the detail for honest copy.
  const future = compareActivationState(requested, { ...match, active: false, status: 'active', effective_from: '2026-10-01' })
  assert.equal(future.verdict, 'inactive')
  assert.equal(future.scheduled, true)
  assert.ok(future.mismatches.some((m) => /scheduled|not yet active/i.test(m)))
})

// F1 regressions: approval binds to the evidence actually reviewed.
test('F1 reviewed-evidence snapshot requires complete displayed evidence', () => {
  const detail = {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }
  const scope = { lodgeId: 'lodge-1', batchId: 'batch-1' }
  const snapshot = snapshotReviewedEvidence(detail, scope)
  assert.ok(Object.isFrozen(snapshot))
  assert.deepEqual({ ...snapshot }, {
    lodgeId: 'lodge-1', batchId: 'batch-1', status: 'prepared', preparedBy: 'user-a',
    openingPayloadHash: 'H1', sourceManifestHash: 'S1'
  })
  // Missing identity or a missing opening hash cannot form review evidence.
  assert.equal(snapshotReviewedEvidence(null, scope), null)
  assert.equal(snapshotReviewedEvidence({ ...detail, id: null }, scope), null)
  assert.equal(snapshotReviewedEvidence({ ...detail, opening_payload_hash: null }, scope), null)
  assert.equal(snapshotReviewedEvidence({ ...detail, opening_payload_hash: '   ' }, scope), null)
  assert.equal(snapshotReviewedEvidence({ ...detail, status: null }, scope), null)
  // A missing source hash is recorded as reviewed-absent, not as a match.
  const noSource = snapshotReviewedEvidence({ ...detail, source_manifest_hash: null }, scope)
  assert.equal(noSource.sourceManifestHash, null)
})

test('F1 preflight compare rejects unseen changes without auto-submitting', () => {
  const scope = { lodgeId: 'lodge-1', batchId: 'batch-1' }
  const reviewed = snapshotReviewedEvidence({
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }, scope)
  assert.deepEqual(reviewMatchesFresh(reviewed, {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }), { ok: true, reasons: [] })
  // Concurrent preparation change (H1 -> H2) blocks approval of H1.
  const drifted = reviewMatchesFresh(reviewed, {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H2', source_manifest_hash: 'S1'
  })
  assert.equal(drifted.ok, false)
  assert.ok(drifted.reasons.some((r) => /opening.*hash/i.test(r)))
  // Source drift blocks even when the opening hash is unchanged.
  const sourceDrift = reviewMatchesFresh(reviewed, {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S2'
  })
  assert.equal(sourceDrift.ok, false)
  // Changed preparer, status, batch identity, or tenant all block.
  assert.equal(reviewMatchesFresh(reviewed, {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-c',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }).ok, false)
  assert.equal(reviewMatchesFresh(reviewed, {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'approved', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }).ok, false)
  assert.equal(reviewMatchesFresh(reviewed, {
    id: 'batch-2', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }).ok, false)
  assert.equal(reviewMatchesFresh(reviewed, {
    id: 'batch-1', lodge_id: 'other-lodge', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }).ok, false)
  // A vanished batch (null read) blocks with an explicit reason.
  const gone = reviewMatchesFresh(reviewed, null)
  assert.equal(gone.ok, false)
  assert.ok(gone.reasons.length > 0)
  // A fresh null source hash against reviewed-absent stays consistent.
  assert.equal(reviewMatchesFresh(
    snapshotReviewedEvidence({
      id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
      opening_payload_hash: 'H1', source_manifest_hash: null
    }, scope),
    {
      id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
      opening_payload_hash: 'H1', source_manifest_hash: null
    }
  ).ok, true)
})

// F4 regressions: only complete authoritative applied evidence confirms.
test('F4 apply reconciliation confirms solely from same-batch applied detail', () => {
  const appliedDetail = { id: 'batch-1', lodge_id: 'lodge-1', status: 'applied', opening_postings: [{ account_id: 'a1', idempotency_key: 'k' }] }
  const confirmed = resolveApplyOutcome({ batchId: 'batch-1', rpcResult: { success: true, data: { id: 'batch-1' } }, detail: appliedDetail })
  assert.equal(confirmed.confirmed, true)
  assert.deepEqual(confirmed.postings, appliedDetail.opening_postings)
  // Nominal and timeout paths share one rule: RPC shape never confirms on
  // its own. Malformed or missing RPC envelopes with complete applied
  // detail still confirm through readback evidence; anything less stays
  // unconfirmed with the batch ID retained for same-batch retry.
  for (const rpcResult of [undefined, null, {}, { data: {} }, { success: false, error: 'x' }, { success: 'yes' }]) {
    const viaReadback = resolveApplyOutcome({ batchId: 'batch-1', rpcResult, detail: appliedDetail })
    assert.equal(viaReadback.confirmed, true, `applied detail must confirm despite RPC ${JSON.stringify(rpcResult)}`)
    assert.equal(viaReadback.evidence, 'readback')
    const unconfirmed = resolveApplyOutcome({ batchId: 'batch-1', rpcResult, detail: { id: 'batch-1', status: 'approved' } })
    assert.equal(unconfirmed.confirmed, false, `non-applied detail must not confirm with RPC ${JSON.stringify(rpcResult)}`)
    assert.equal(unconfirmed.batchId, 'batch-1')
  }
  // A nominal success with null, failed, wrong-batch, or non-applied detail
  // stays unconfirmed; the batch ID is retained for same-batch retry.
  const rpc = { success: true, data: { id: 'batch-1', status: 'applied' } }
  for (const detail of [null, undefined, { success: false }, { id: 'batch-2', status: 'applied' }, { id: 'batch-1', status: 'approved' }, { id: 'batch-1', status: 'prepared' }, []]) {
    const outcome = resolveApplyOutcome({ batchId: 'batch-1', rpcResult: rpc, detail })
    assert.equal(outcome.confirmed, false, `detail ${JSON.stringify(detail)} must not confirm`)
    assert.equal(outcome.batchId, 'batch-1')
  }
  // Timeout-after-commit with matching applied readback confirms via evidence.
  const afterTimeout = resolveApplyOutcome({ batchId: 'batch-1', rpcResult: null, detail: appliedDetail })
  assert.equal(afterTimeout.confirmed, true)
  assert.equal(afterTimeout.evidence, 'readback')
})

// G3 regressions: blank identity is malformed, never an implicit null.
test('G3 blank cutover identity is unreadable, distinct from explicit null', () => {
  const noCutover = snapshotActivationRequest({
    lodgeId: 'lodge-1', effectiveFrom: '2026-09-01', configurationVersion: 'v1',
    policyVersion: 'p', cutoverBatchId: null
  })
  const base = {
    lodge_id: 'lodge-1', status: 'active', active: true, effective_from: '2026-09-01',
    configuration_version: 'v1', policy_version: 'p'
  }
  // Whitespace where a null-cutover request expects explicit null: unreadable.
  assert.equal(compareActivationState(noCutover, { ...base, historical_cutover_batch_id: '   ' }).verdict, 'unreadable')
  assert.equal(compareActivationState(noCutover, { ...base, historical_cutover_batch_id: '' }).verdict, 'unreadable')
  // Whitespace where a batch was requested: unreadable, never a match.
  const withBatch = snapshotActivationRequest({ lodgeId: 'lodge-1', effectiveFrom: '2026-09-01', configurationVersion: 'v1', policyVersion: 'p', cutoverBatchId: 'batch-9' })
  assert.equal(compareActivationState(withBatch, { ...base, historical_cutover_batch_id: '  ' }).verdict, 'unreadable')
  // Blank lodge/effective values are malformed evidence, not wildcards.
  assert.equal(compareActivationState(noCutover, { ...base, historical_cutover_batch_id: null, lodge_id: '  ' }).verdict, 'unreadable')
  assert.equal(compareActivationState(noCutover, { ...base, historical_cutover_batch_id: null, effective_from: '' }).verdict, 'unreadable')
})

// G3 regressions: a review snapshot requires fully identified evidence in
// the current tenant/scope. Absence is never recorded as equality.
test('G3 review snapshot requires tenant, preparer, and reviewed source identity', () => {
  const scope = { lodgeId: 'lodge-1', batchId: 'batch-1' }
  const full = {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }
  const snapshot = snapshotReviewedEvidence(full, scope)
  assert.ok(snapshot && Object.isFrozen(snapshot))
  assert.equal(snapshot.preparedBy, 'user-a')
  assert.equal(snapshot.sourceManifestHash, 'S1')
  // Each missing required field refuses the snapshot.
  assert.equal(snapshotReviewedEvidence({ ...full, lodge_id: undefined }, scope), null)
  assert.equal(snapshotReviewedEvidence({ ...full, lodge_id: '  ' }, scope), null)
  assert.equal(snapshotReviewedEvidence({ ...full, prepared_by: null }, scope), null)
  assert.equal(snapshotReviewedEvidence({ ...full, prepared_by: '  ' }, scope), null)
  assert.equal(snapshotReviewedEvidence({ ...full, opening_payload_hash: '  ' }, scope), null)
  assert.equal(snapshotReviewedEvidence({ ...full, status: '' }, scope), null)
  // A null source hash is the one documented nullable case: real batches
  // carry no source manifest when no pre-cutover history exists. It is
  // recorded as reviewed-absent and bound null-safely server-side.
  const noSource = snapshotReviewedEvidence({ ...full, source_manifest_hash: null }, scope)
  assert.equal(noSource.sourceManifestHash, null)
  // Scope mismatch never records review: wrong tenant or wrong batch.
  assert.equal(snapshotReviewedEvidence(full, { lodgeId: 'other-lodge', batchId: 'batch-1' }), null)
  assert.equal(snapshotReviewedEvidence(full, { lodgeId: 'lodge-1', batchId: 'batch-2' }), null)
  assert.equal(snapshotReviewedEvidence(full, null), null)
})

// G3 regressions: missing fresh fields are unavailable evidence, not proof
// that nothing changed.
test('G3 preflight treats missing fresh fields as changed evidence', () => {
  const reviewed = snapshotReviewedEvidence({
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }, { lodgeId: 'lodge-1', batchId: 'batch-1' })
  const fresh = {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }
  assert.deepEqual(reviewMatchesFresh(reviewed, fresh), { ok: true, reasons: [] })
  for (const [label, partial] of [
    ['status', { id: 'batch-1', lodge_id: 'lodge-1', prepared_by: 'user-a', opening_payload_hash: 'H1', source_manifest_hash: 'S1' }],
    ['preparer', { id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', opening_payload_hash: 'H1', source_manifest_hash: 'S1' }],
    ['tenant', { id: 'batch-1', status: 'prepared', prepared_by: 'user-a', opening_payload_hash: 'H1', source_manifest_hash: 'S1' }]
  ]) {
    const outcome = reviewMatchesFresh(reviewed, partial)
    assert.equal(outcome.ok, false, `missing fresh ${label} must block`)
    assert.ok(outcome.reasons.length > 0)
  }
})

// G4 regressions: only authoritative matching approved evidence permits an
// approval success notice.
test('G4 approval reconciles same-batch approved evidence against review', () => {
  const reviewed = snapshotReviewedEvidence({
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }, { lodgeId: 'lodge-1', batchId: 'batch-1' })
  const approvedDetail = {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'approved', prepared_by: 'user-a',
    approved_by: 'user-b', opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }
  const confirmed = resolveApproveOutcome({
    batchId: 'batch-1', lodgeId: 'lodge-1', reviewed,
    rpcResult: { success: true, data: { id: 'batch-1', status: 'approved' } },
    detail: approvedDetail
  })
  assert.equal(confirmed.confirmed, true)
  assert.equal(confirmed.evidence, 'response')
  // Undefined/empty/lying responses with null or non-approved readback stay
  // unconfirmed with the original batch retained.
  const rpcs = [undefined, null, {}, { data: {} }, { success: false, error: 'x' }, { success: true, data: { id: 'batch-1', status: 'approved' } }]
  const details = [null, undefined, { success: false }, { id: 'batch-2', lodge_id: 'lodge-1', status: 'approved', approved_by: 'user-b', opening_payload_hash: 'H1', source_manifest_hash: 'S1' }, { id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a', opening_payload_hash: 'H1', source_manifest_hash: 'S1' }]
  for (const rpcResult of rpcs) {
    for (const detail of details) {
      const outcome = resolveApproveOutcome({ batchId: 'batch-1', lodgeId: 'lodge-1', reviewed, rpcResult, detail })
      assert.equal(outcome.confirmed, false, `rpc ${JSON.stringify(rpcResult)} + detail ${JSON.stringify(detail)} must not confirm`)
      assert.equal(outcome.batchId, 'batch-1')
    }
  }
  // Lost response (transport null) with confirmed same evidence confirms via
  // readback; mismatched evidence after a nominal success does not.
  const lost = resolveApproveOutcome({ batchId: 'batch-1', lodgeId: 'lodge-1', reviewed, rpcResult: null, detail: approvedDetail })
  assert.equal(lost.confirmed, true)
  assert.equal(lost.evidence, 'readback')
  const drifted = resolveApproveOutcome({
    batchId: 'batch-1', lodgeId: 'lodge-1', reviewed,
    rpcResult: { success: true, data: { id: 'batch-1', status: 'approved' } },
    detail: { ...approvedDetail, source_manifest_hash: 'S2' }
  })
  assert.equal(drifted.confirmed, false)
  const wrongTenant = resolveApproveOutcome({
    batchId: 'batch-1', lodgeId: 'lodge-1', reviewed,
    rpcResult: { success: true, data: { id: 'batch-1', status: 'approved' } },
    detail: { ...approvedDetail, lodge_id: 'other-lodge' }
  })
  assert.equal(wrongTenant.confirmed, false)
})

// G2 regressions: the safety validator is pure and testable without a
// database connection.
test('G2 safety configuration validator fails closed on injected values', () => {
  assert.equal(validateSafetyConfig({ flag: '1', url: 'postgresql://postgres:pw@127.0.0.1:54322/postgres', ack: 'destroy-data-on:127.0.0.1:54322' }), null)
  assert.match(validateSafetyConfig({ flag: '0', url: 'postgresql://x@h/db', ack: 'destroy-data-on:h' }), /opt-in/)
  assert.match(validateSafetyConfig({ flag: '1', url: '', ack: '' }), /explicit.*target/i)
  assert.match(validateSafetyConfig({ flag: '1', url: 'not-a-url', ack: 'x' }), /explicit.*target/i)
  assert.match(validateSafetyConfig({ flag: '1', url: 'postgresql://postgres:pw@127.0.0.1:54322/postgres', ack: 'wrong' }), /acknowledgement/)
  assert.match(validateSafetyConfig({}), /opt-in/)
})

// H3 regressions: readback must prove the FULL reviewed revision —
// preparation identity included — with strictly present source evidence.
test('H3 approval readback compares preparation identity and strict source', () => {
  const scope = { lodgeId: 'lodge-1', batchId: 'batch-1' }
  const reviewed = snapshotReviewedEvidence({
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }, scope)
  const rpc = { success: true, data: { id: 'batch-1', status: 'approved' } }
  const approved = {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'approved', prepared_by: 'user-a',
    approved_by: 'user-b', opening_payload_hash: 'H1', source_manifest_hash: 'S1'
  }
  const confirm = (detail, extra = {}) => resolveApproveOutcome({
    batchId: 'batch-1', lodgeId: 'lodge-1', reviewed, rpcResult: rpc, detail, ...extra
  })
  // Matching full revision confirms.
  assert.equal(confirm(approved).confirmed, true)
  // Changed or missing preparer never confirms.
  assert.equal(confirm({ ...approved, prepared_by: 'user-c' }).confirmed, false)
  assert.equal(confirm({ ...approved, prepared_by: null }).confirmed, false)
  const { prepared_by: _dropped, ...noPreparer } = approved
  assert.equal(confirm(noPreparer).confirmed, false)
  // Absent, blank, or wrong-type source never confirms.
  const { source_manifest_hash: _s, ...noSource } = approved
  assert.equal(confirm(noSource).confirmed, false)
  assert.equal(confirm({ ...approved, source_manifest_hash: undefined }).confirmed, false)
  assert.equal(confirm({ ...approved, source_manifest_hash: '  ' }).confirmed, false)
  assert.equal(confirm({ ...approved, source_manifest_hash: 42 }).confirmed, false)
  assert.equal(confirm({ ...approved, source_manifest_hash: { hash: 'S1' } }).confirmed, false)
  // Conflicting aliases never confirm, even when one side matches.
  assert.equal(confirm({ ...approved, sourceManifestHash: 'S-other' }).confirmed, false)
  // Explicit-null source confirms only against reviewed-absent.
  const reviewedBare = snapshotReviewedEvidence({
    id: 'batch-1', lodge_id: 'lodge-1', status: 'prepared', prepared_by: 'user-a',
    opening_payload_hash: 'H1', source_manifest_hash: null
  }, scope)
  assert.equal(resolveApproveOutcome({
    batchId: 'batch-1', lodgeId: 'lodge-1', reviewed: reviewedBare, rpcResult: rpc,
    detail: { ...approved, source_manifest_hash: null }
  }).confirmed, true)
  assert.equal(resolveApproveOutcome({
    batchId: 'batch-1', lodgeId: 'lodge-1', reviewed, rpcResult: rpc,
    detail: { ...approved, source_manifest_hash: null }
  }).confirmed, false)
  // Snapshot scope mismatch never confirms.
  assert.equal(resolveApproveOutcome({
    batchId: 'batch-2', lodgeId: 'lodge-1', reviewed, rpcResult: rpc, detail: approved
  }).confirmed, false)
  assert.equal(resolveApproveOutcome({
    batchId: 'batch-1', lodgeId: 'other-lodge', reviewed, rpcResult: rpc, detail: approved
  }).confirmed, false)
  // Approver trail: nobody recorded, or approver equal to preparer
  // (self-approval the server must reject), never confirms.
  assert.equal(confirm({ ...approved, approved_by: null }).confirmed, false)
  assert.equal(confirm({ ...approved, approved_by: 'user-a' }).confirmed, false)
  // Another reviewer approving the SAME revision still confirms the
  // revision (recovery policy), without claiming this request caused it.
  assert.equal(confirm({ ...approved, approved_by: 'user-z' }).confirmed, true)
  // Lost response with matching detail confirms via readback.
  assert.equal(resolveApproveOutcome({
    batchId: 'batch-1', lodgeId: 'lodge-1', reviewed, rpcResult: null, detail: approved
  }).evidence, 'readback')
  // Rejection followed by a later differently prepared approval: the
  // original review stays unconfirmed against the new revision.
  const laterRevision = {
    id: 'batch-1', lodge_id: 'lodge-1', status: 'approved', prepared_by: 'user-c',
    approved_by: 'user-b', opening_payload_hash: 'H2', source_manifest_hash: 'S2'
  }
  assert.equal(confirm(laterRevision).confirmed, false)
})

// H3 regressions: the strict source reader is shared and explicit.
test('H3 strict source reader distinguishes absent, null, and malformed', async () => {
  const { readSourceEvidence } = await import('../src/shared/accountingActivation.js')
  assert.deepEqual(readSourceEvidence({ source_manifest_hash: 'S1' }), { present: true, value: 'S1', malformed: false, conflict: false })
  assert.deepEqual(readSourceEvidence({ source_manifest_hash: null }), { present: true, value: null, malformed: false, conflict: false })
  assert.deepEqual(readSourceEvidence({}), { present: false, value: undefined, malformed: false, conflict: false })
  assert.equal(readSourceEvidence({ source_manifest_hash: '  ' }).malformed, true)
  assert.equal(readSourceEvidence({ source_manifest_hash: 42 }).malformed, true)
  assert.equal(readSourceEvidence({ source_manifest_hash: { h: 1 } }).malformed, true)
  assert.equal(readSourceEvidence({ source_manifest_hash: 'S1', sourceManifestHash: 'S2' }).conflict, true)
  assert.deepEqual(readSourceEvidence({ source_manifest_hash: 'S1', sourceManifestHash: 'S1' }), { present: true, value: 'S1', malformed: false, conflict: false })
  assert.equal(readSourceEvidence(null).malformed, true)
})

// Task A regressions: managed-role fixture prerequisites are evaluated
// precisely, without any superuser assumption and without a connection.
test('Task A prerequisite evaluator accepts sufficient managed and local profiles', async () => {
  const { requiredFixturePrerequisites, evaluateFixturePrerequisites } = await import('./helpers/disposable-prerequisites.mjs')
  const required = requiredFixturePrerequisites()
  assert.ok(required.tables.length > 0 && required.functions.length > 0 && required.roleswitch.length > 0)
  const fullGrant = (privileges) => Object.fromEntries(privileges.map((privilege) => [privilege, true]))
  const buildProfile = (overrides = {}) => ({
    user: 'postgres',
    isSuperuser: false,
    tables: Object.fromEntries(required.tables.map((need) => [need.table, fullGrant(need.privileges)])),
    functions: Object.fromEntries(required.functions.map((need) => [need.signature, true])),
    roleswitch: Object.fromEntries(required.roleswitch.map((need) => [need.role, true])),
    authHelper: true,
    ...overrides
  })
  // Allowed managed-role profile (NOT superuser) with every grant: passes.
  const managed = evaluateFixturePrerequisites(buildProfile({ user: 'managed_postgres', isSuperuser: false }))
  assert.equal(managed.ok, true)
  assert.deepEqual(managed.missing, [])
  assert.equal(managed.bypass, null)
  // Allowed local superuser profile: passes explicitly as documented bypass.
  const local = evaluateFixturePrerequisites(buildProfile({ isSuperuser: true }))
  assert.equal(local.ok, true)
  assert.equal(local.bypass, 'superuser')
  // Missing table privilege names the table, right, and operation.
  const noUpdate = buildProfile()
  noUpdate.tables['public.restaurant_historical_cutover_batches'] = { SELECT: true, UPDATE: false }
  const missingUpdate = evaluateFixturePrerequisites(noUpdate)
  assert.equal(missingUpdate.ok, false)
  assert.ok(missingUpdate.missing.some((line) => /restaurant_historical_cutover_batches.*UPDATE.*drift\/rollback/i.test(line)), JSON.stringify(missingUpdate.missing))
  // Missing function EXECUTE names the exact signature.
  const noExecute = buildProfile()
  noExecute.functions['public.prepare_restaurant_historical_cutover(uuid,date,jsonb,jsonb,text)'] = false
  const missingExecute = evaluateFixturePrerequisites(noExecute)
  assert.equal(missingExecute.ok, false)
  assert.ok(missingExecute.missing.some((line) => /prepare_restaurant_historical_cutover.*EXECUTE/i.test(line)))
  // Unassumable assertion role names the role.
  const noAnon = buildProfile()
  noAnon.roleswitch = { authenticated: true, anon: false }
  const missingRole = evaluateFixturePrerequisites(noAnon)
  assert.equal(missingRole.ok, false)
  assert.ok(missingRole.missing.some((line) => /SET ROLE anon/i.test(line)))
  // Missing auth helper is reported, not assumed.
  const noHelper = buildProfile({ authHelper: false })
  const missingHelper = evaluateFixturePrerequisites(noHelper)
  assert.equal(missingHelper.ok, false)
  assert.ok(missingHelper.missing.some((line) => /auth\.role/i.test(line)))
  // Empty profile fails with a complete gap list, never an exception.
  const empty = evaluateFixturePrerequisites({})
  assert.equal(empty.ok, false)
  assert.ok(empty.missing.length >= required.tables.length + required.functions.length + required.roleswitch.length + 1)
})
