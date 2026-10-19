// Historical sale replay contract (Work package B).
//
// The defect: queued/interrupted `create_pos_order_v3` replays rewrote
// `payload.shift_id` to today's open shift under the original operation key.
// For a committed sale that changes the canonical payload hash and turns a
// legitimate reconciliation into an idempotency conflict; for an uncommitted
// sale it silently moves revenue into the wrong cash-up. These tests execute
// the real production replay loop (`infrastructure.js::processSyncQueue`) with
// real JSON/JSONL stores and a scripted Supabase transport. They are NOT a
// substitute for the SQL fixtures that require Codex migration review.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import {
  importDomain,
  importState,
  makeTempCacheDir,
  scriptSupabase
} from './helpers/domain-test-setup.mjs'
import {
  POS_HISTORICAL_REPLAY_RPC,
  REPLAY_OUTCOME,
  REPLAY_OUTCOME_SOURCE,
  buildHistoricalReplayRequest,
  buildReplayFailureMetadata,
  classifyReplayOutcome,
  classifyReplayOutcomeDetailed,
  classifySaleReplayRoute,
  isHistoricalReplayContractMissing,
  isRetryableReplayOutcome,
  isShiftClosureSaleRefusal,
  shouldRetainPosSubmitJournal
} from '../src/main/domains/syncShared.js'

const { state } = await importState()
const infrastructure = await importDomain('infrastructure.js')
const syncStore = await importDomain('syncStore.js')
const cacheStore = await importDomain('cacheStore.js')
const journal = await importDomain('posSubmitJournal.js')

const LODGE = '11111111-1111-4111-8111-111111111111'
const OUTLET = '22222222-2222-4222-8222-222222222222'
const ORDER = '33333333-3333-4333-8333-333333333333'
const ORIGINAL_SHIFT = '44444444-4444-4444-8444-444444444444'
const CURRENT_SHIFT = '55555555-5555-4555-8555-555555555555'
const CASHIER = '66666666-6666-4666-8666-666666666666'

function isolatedQueue(t, rpc, { online = true } = {}) {
  const keys = [
    'cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline', 'replayAuthReady',
    'syncInProgress', 'syncQueuePromise', 'historicalReplayContractAvailable', 'historicalReplayContractCheckedAt'
  ]
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('bar-historical-replay')
  Object.assign(state, {
    cacheDir,
    lodgeId: LODGE,
    currentUser: { id: CASHIER },
    supabase: scriptSupabase(rpc),
    isOnline: online,
    replayAuthReady: true,
    syncInProgress: false,
    syncQueuePromise: null,
    historicalReplayContractAvailable: undefined,
    historicalReplayContractCheckedAt: undefined
  })
  t.after(() => {
    Object.assign(state, previous)
    fs.rmSync(cacheDir, { recursive: true, force: true })
  })
  return { cacheDir }
}

const originalPayload = (overrides = {}) => ({
  id: ORDER,
  submit_intent_id: `intent-${ORDER}`,
  lodge_id: LODGE,
  catalog_snapshot_id: '77777777-7777-4777-8777-777777777777',
  shift_id: ORIGINAL_SHIFT,
  source_device_id: 'device-till-1',
  outlet_id: OUTLET,
  cashier_id: CASHIER,
  waiter_id: CASHIER,
  client_created_at: '2026-09-15T12:00:00.000Z',
  payment_method: 'cash',
  payment_breakdown: [{ method: 'cash', amount: 40 }],
  gross_total: 40,
  discount_total: 0,
  tax_total: 0,
  total: 40,
  tip_total: 0,
  create_idempotency_key: `pos-order:intent-${ORDER}`,
  items: [
    { menu_item_id: '88888888-8888-4888-8888-888888888888', item_name: 'Stout 500ml', quantity: 2, unit_price: 20 }
  ],
  ...overrides
})

const queuedSale = (payload = originalPayload(), extra = {}) => ({
  type: 'rpc',
  table: 'create_pos_order_v3',
  _queue_id: `pos-order-${ORDER}`,
  _state: 'pending',
  data: { payload },
  ...extra
})

const closedOriginalShift = { id: ORIGINAL_SHIFT, status: 'closed', closed_at: '2026-09-15T14:00:00.000Z', outlet_id: OUTLET, cashier_id: CASHIER, opened_at: '2026-09-15T08:00:00.000Z' }
const todayOpenShift = { id: CURRENT_SHIFT, status: 'open', closed_at: null, outlet_id: OUTLET, cashier_id: CASHIER, opened_at: '2026-10-15T08:00:00.000Z' }

// ─── Pure routing/identity helpers ──────────────────────────────────────────

test('closed and unknown originating shifts route to the historical contract, never to today', () => {
  assert.equal(classifySaleReplayRoute([closedOriginalShift, todayOpenShift], originalPayload()), 'historical')
  assert.equal(classifySaleReplayRoute([], originalPayload()), 'historical')
  assert.equal(
    classifySaleReplayRoute([{ ...closedOriginalShift, status: 'open', closed_at: null }], originalPayload()),
    'open_shift'
  )
  assert.equal(classifySaleReplayRoute([todayOpenShift], originalPayload({ shift_id: '' })), 'historical')
})

test('historical replay request keeps original bytes and derives a stable key from the operation', () => {
  const payload = originalPayload()
  const request = buildHistoricalReplayRequest(queuedSale(payload), payload)
  assert.equal(request.payload, payload, 'the exact original payload object is forwarded (no copy, no rewrite)')
  assert.equal(request.p_replay_key, `hist-replay:${payload.create_idempotency_key}`)
  // Without an operation key the queue identity is used rather than a fresh UUID.
  const fallback = buildHistoricalReplayRequest(
    { _queue_id: 'queue-fallback-1' },
    originalPayload({ create_idempotency_key: '' })
  )
  assert.equal(fallback.p_replay_key, 'hist-replay:queue-fallback-1')
})

test('missing-contract detection requires the named function and a schema-cache answer', () => {
  assert.equal(isHistoricalReplayContractMissing({
    code: 'PGRST202',
    message: 'Could not find the function public.replay_pos_order_v3_historical_v1(payload, p_replay_key) in the schema cache'
  }), true)
  assert.equal(isHistoricalReplayContractMissing({
    code: 'PGRST202',
    message: 'Could not find the function public.some_other_rpc(...) in the schema cache'
  }), false, 'an unrelated missing RPC is never misclassified as the historical prerequisite')
  assert.equal(isHistoricalReplayContractMissing({ code: '42501', message: 'permission denied for function replay_pos_order_v3_historical_v1' }), false)
})

test('outcome classification separates uncertainty from definitive refusal', () => {
  assert.equal(classifyReplayOutcome({ message: 'fetch failed' }), REPLAY_OUTCOME.TRANSPORT_UNCERTAIN)
  assert.equal(isRetryableReplayOutcome(REPLAY_OUTCOME.TRANSPORT_UNCERTAIN), true)
  assert.equal(classifyReplayOutcome({ code: '429', message: 'Too Many Requests' }), REPLAY_OUTCOME.THROTTLED)
  assert.equal(classifyReplayOutcome({ message: 'JWT expired' }), REPLAY_OUTCOME.AUTH_EXPIRED)
  assert.equal(classifyReplayOutcome({ code: '42501', message: 'permission denied' }), REPLAY_OUTCOME.PERMISSION_DENIED)
  assert.equal(classifyReplayOutcome({ code: '23505', message: 'duplicate key value' }), REPLAY_OUTCOME.VALIDATION_REJECTED)
  assert.equal(classifyReplayOutcome({ message: 'idempotency_conflict' }), REPLAY_OUTCOME.BUSINESS_CONFLICT)
  assert.equal(classifyReplayOutcome({
    code: 'PGRST202',
    message: 'Could not find the function public.replay_pos_order_v3_historical_v1(payload, p_replay_key) in the schema cache'
  }), REPLAY_OUTCOME.CONTRACT_MISSING)
  for (const parked of [REPLAY_OUTCOME.BUSINESS_CONFLICT, REPLAY_OUTCOME.PERMISSION_DENIED, REPLAY_OUTCOME.VALIDATION_REJECTED, REPLAY_OUTCOME.CONTRACT_MISSING]) {
    assert.equal(isRetryableReplayOutcome(parked), false)
  }
})

test('scheduling metadata is bounded, additive and preserves the first failure time', () => {
  const metadata = buildReplayFailureMetadata(
    { retryCount: 3, _first_failed_at: '2026-09-15T12:00:00.000Z' },
    { outcomeClass: REPLAY_OUTCOME.TRANSPORT_UNCERTAIN, code: 'ETIMEDOUT', message: 'timed out', now: new Date('2026-09-15T12:10:00.000Z') }
  )
  assert.equal(metadata._replay_schema, 1)
  assert.equal(metadata._outcome_class, 'transport_uncertain')
  assert.equal(metadata._first_failed_at, '2026-09-15T12:00:00.000Z')
  assert.equal(metadata._next_retry_at, '2026-09-15T12:10:04.000Z')
  assert.equal(metadata._review_reason, null)
  const parked = buildReplayFailureMetadata({}, { outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, message: 'changed payload for the operation key' })
  assert.equal(parked._next_retry_at, null)
  assert.match(parked._review_reason, /changed payload/)
})

test('structured server codes classify before any transport wording', () => {
  assert.equal(
    classifyReplayOutcome({ code: 'IDEMPOTENCY_CONFLICT', message: 'fetch failed' }),
    REPLAY_OUTCOME.BUSINESS_CONFLICT,
    'an explicit refusal code is never re-read as a transport failure'
  )
  assert.equal(classifyReplayOutcome({ code: 'HISTORICAL_WINDOW_EXPIRED', message: '' }), REPLAY_OUTCOME.BUSINESS_CONFLICT)
  assert.equal(classifyReplayOutcome({ code: '503', message: 'shift_not_open' }), REPLAY_OUTCOME.SERVER_UNAVAILABLE)
  assert.equal(classifyReplayOutcome({ code: 'PGRST301', message: 'user is offline' }), REPLAY_OUTCOME.AUTH_EXPIRED)
  assert.equal(classifyReplayOutcome({ code: 'P0001', message: 'unexpected plumbing failure' }), REPLAY_OUTCOME.UNKNOWN)
})

test('retry scheduling carries stable bounded jitter and schedules parent skips', () => {
  const options = { outcomeClass: REPLAY_OUTCOME.TRANSPORT_UNCERTAIN, now: new Date('2026-09-15T12:00:00.000Z') }
  const first = buildReplayFailureMetadata({ _queue_id: 'pos-order-till-a', retryCount: 1 }, options)
  const again = buildReplayFailureMetadata({ _queue_id: 'pos-order-till-a', retryCount: 1 }, options)
  assert.equal(first._next_retry_at, again._next_retry_at, 'the same operation always schedules the same window')
  const delayMs = Date.parse(first._next_retry_at) - options.now.getTime()
  assert.ok(delayMs >= 1000 && delayMs < 11000, `jitter stays bounded (got ${delayMs}ms)`)
  const noIdentity = buildReplayFailureMetadata({ retryCount: 1 }, options)
  assert.equal(Date.parse(noIdentity._next_retry_at) - options.now.getTime(), 1000, 'rows without identity keep the exact backoff')

  assert.equal(isRetryableReplayOutcome(REPLAY_OUTCOME.PARENT_PENDING), true, 'a child of a pending parent auto-retries')
  const child = buildReplayFailureMetadata({ _queue_id: 'child-1', retryCount: 1 }, {
    outcomeClass: REPLAY_OUTCOME.PARENT_PENDING,
    message: 'Skipped: parent operation failed'
  })
  assert.ok(child._next_retry_at, 'dependency skips persist their own retry deadline')
  assert.equal(child._review_reason, null)
})

// ─── Production replay loop behavior ────────────────────────────────────────

test('closed-shift sale replays through the historical contract with the original shift and bytes', async (t) => {
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    return { data: { success: true, id: ORDER, total: 40, receipt_number: 'R-0042', historical_replay: true }, error: null }
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift, todayOpenShift])
  syncStore.writeSyncQueue([queuedSale()])

  await infrastructure.processSyncQueue()

  assert.deepEqual(calls.map((call) => call.name), [POS_HISTORICAL_REPLAY_RPC])
  const forwarded = calls[0].args.payload
  assert.equal(forwarded.shift_id, ORIGINAL_SHIFT, 'the original shift is preserved, not today\'s')
  assert.equal(forwarded.cashier_id, CASHIER)
  assert.equal(forwarded.client_created_at, '2026-09-15T12:00:00.000Z')
  assert.equal(forwarded.create_idempotency_key, `pos-order:intent-${ORDER}`)
  assert.equal(forwarded.total, 40)
  assert.deepEqual(forwarded.items, originalPayload().items)
  assert.equal(calls[0].args.p_replay_key, `hist-replay:pos-order:intent-${ORDER}`)
  assert.deepEqual(syncStore.readSyncQueue(), [], 'confirmed replay is consumed')
  assert.deepEqual(syncStore.readFailedSyncQueue(), [])
})

test('the replay drops only the expired operator proof, never business fields', async (t) => {
  let forwarded = null
  isolatedQueue(t, async (name, args) => {
    forwarded = args.payload
    return { data: { success: true, id: ORDER, total: 40 }, error: null }
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  const payload = originalPayload({ _operator_proof: 'expired-proof-token' })
  syncStore.writeSyncQueue([queuedSale(payload)])

  await infrastructure.processSyncQueue()

  assert.ok(forwarded)
  assert.equal(Object.prototype.hasOwnProperty.call(forwarded, '_operator_proof'), false)
  const expected = originalPayload()
  for (const key of Object.keys(expected)) {
    assert.deepEqual(forwarded[key], expected[key], `business field ${key} must survive byte-identically`)
  }
  assert.deepEqual(Object.keys(forwarded).sort(), Object.keys(expected).sort(), 'no other field may be added or removed')
})

test('open-shift sale replay still uses the ordinary authoritative RPC with original bytes', async (t) => {
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    return { data: { success: true, id: ORDER, total: 40 }, error: null }
  })
  cacheStore.writeCache('pos-shifts', [{ ...closedOriginalShift, status: 'open', closed_at: null }])
  syncStore.writeSyncQueue([queuedSale()])

  await infrastructure.processSyncQueue()

  assert.deepEqual(calls.map((call) => call.name), ['create_pos_order_v3'])
  assert.equal(calls[0].args.payload.shift_id, ORIGINAL_SHIFT)
})

test('same operation key replayed twice produces exactly one server effect and reconciles both runs', async (t) => {
  const commits = new Map()
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push(name)
    const key = args.p_replay_key || args.payload?.create_idempotency_key
    if (commits.has(key)) {
      return { data: { success: true, id: ORDER, total: 40, receipt_number: 'R-0042', replayed: true, server_effect: commits.get(key) }, error: null }
    }
    commits.set(key, `effect-${commits.size + 1}`)
    if (commits.size > 1) throw new Error('a second effect for the same operation key was created')
    return { data: { success: true, id: ORDER, total: 40, receipt_number: 'R-0042' }, error: null }
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  syncStore.writeSyncQueue([queuedSale()])
  await infrastructure.processSyncQueue()
  // A second till replays the identical operation after a lost response.
  syncStore.writeSyncQueue([queuedSale()])
  await infrastructure.processSyncQueue()

  assert.deepEqual(calls, [POS_HISTORICAL_REPLAY_RPC, POS_HISTORICAL_REPLAY_RPC])
  assert.equal(commits.size, 1, 'exactly one committed effect for the stable operation key')
  assert.deepEqual(syncStore.readSyncQueue(), [])
})

test('a committed receipt reconciles even though the originating shift is closed and the catalogue moved on', async (t) => {
  let forwarded = null
  isolatedQueue(t, async (name, args) => {
    forwarded = args.payload
    return {
      data: {
        success: true,
        id: ORDER,
        total: 40,
        receipt_number: 'R-0042',
        replayed: true,
        receipt: { order_id: ORDER, create_idempotency_key: args.payload.create_idempotency_key, shift_id: ORIGINAL_SHIFT, business_date: '2026-09-15' }
      },
      error: null
    }
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  syncStore.writeSyncQueue([queuedSale()])

  await infrastructure.processSyncQueue()

  assert.equal(forwarded.shift_id, ORIGINAL_SHIFT)
  assert.deepEqual(syncStore.readSyncQueue(), [], 'the receipt acknowledgement consumes the replay without re-execution')
})

test('a missing historical contract parks the sale with its original identity instead of rewriting it', async (t) => {
  isolatedQueue(t, async (name) => {
    if (name === POS_HISTORICAL_REPLAY_RPC) {
      return {
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.replay_pos_order_v3_historical_v1(payload, p_replay_key) in the schema cache'
        }
      }
    }
    throw new Error(`unexpected RPC ${name}`)
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift, todayOpenShift])
  const sale = queuedSale()
  const expectedPayload = JSON.parse(JSON.stringify(sale.data.payload))
  syncStore.writeSyncQueue([sale])
  // The provisional journal attempt must be reopened when replay cannot settle.
  journal.resolvePosSubmitAttempt({
    submitIntentId: `intent-${ORDER}`,
    orderId: ORDER,
    lodgeId: LODGE,
    userId: CASHIER,
    payload: expectedPayload
  })
  journal.markPosSubmitAttemptProvisional(`intent-${ORDER}`, sale._queue_id)

  await infrastructure.processSyncQueue()

  assert.deepEqual(syncStore.readSyncQueue(), [])
  const failed = syncStore.readFailedSyncQueue()
  assert.equal(failed.length, 1)
  const parked = failed[0]
  assert.equal(parked._outcome_class, REPLAY_OUTCOME.CONTRACT_MISSING)
  assert.equal(parked.manualRetryOnly, true)
  assert.equal(parked.retryCount, 5)
  assert.deepEqual(parked.data.payload, expectedPayload, 'the original bytes, shift, key and business date are retained')
  const attempt = journal.getPosSubmitAttempt(`intent-${ORDER}`)
  assert.equal(attempt?.status, 'pending', 'unresolved sale reopens the submit journal')
})

test('parked contract sales requeue with original identity once the contract probe succeeds', async (t) => {
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    if (args?.payload === null) return { data: { success: false, error: 'payload required' }, error: null }
    return { data: { success: true, id: ORDER, total: 40 }, error: null }
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  const sale = queuedSale(originalPayload(), {
    manualRetryOnly: true,
    retryCount: 5,
    _outcome_class: REPLAY_OUTCOME.CONTRACT_MISSING,
    _next_retry_at: null,
    lastError: 'historical replay contract missing'
  })
  syncStore.writeSyncQueue([])
  syncStore.writeFailedSyncQueue([sale])

  await infrastructure.processSyncQueue()

  assert.equal(calls[0].name, POS_HISTORICAL_REPLAY_RPC, 'the probe runs before the parked sale')
  assert.equal(calls[0].args.payload, null)
  assert.equal(calls[1].name, POS_HISTORICAL_REPLAY_RPC, 'the parked sale replays through the contract')
  assert.equal(calls[1].args.payload.shift_id, ORIGINAL_SHIFT)
  assert.deepEqual(syncStore.readFailedSyncQueue(), [])
  assert.deepEqual(syncStore.readSyncQueue(), [])
})

test('parked contract requeue persists the destination before pruning the recovery copy', async (t) => {
  const { cacheDir } = isolatedQueue(t, async (name, args) => {
    if (args?.payload === null) return { data: { success: false, error: 'payload required' }, error: null }
    return { data: { success: true, id: ORDER, total: 40 }, error: null }
  })
  const sale = queuedSale(originalPayload(), {
    manualRetryOnly: true,
    retryCount: 5,
    _outcome_class: REPLAY_OUTCOME.CONTRACT_MISSING
  })
  syncStore.writeSyncQueue([])
  syncStore.writeFailedSyncQueue([sale])
  // Block the destination write (a directory at the tmp path fails the durable
  // write). The requeue must fail towards keeping the only recovery copy.
  fs.mkdirSync(path.join(cacheDir, 'sync-queue.json.tmp'))

  await infrastructure.processSyncQueue()

  const failed = syncStore.readFailedSyncQueue()
  assert.equal(failed.length, 1, 'the recovery copy survives a blocked destination write')
  assert.equal(failed[0]._queue_id, sale._queue_id)
  assert.equal(failed[0].data.payload.shift_id, ORIGINAL_SHIFT)
  assert.deepEqual(syncStore.readSyncQueue(), [], 'no half-requeued copy was published')
})

test('transport uncertainty keeps the sale retryable, scheduled, and recovers with the same key', async (t) => {
  let outcome = 'fail'
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    if (outcome === 'fail') throw new TypeError('fetch failed')
    return { data: { success: true, id: ORDER, total: 40 }, error: null }
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  syncStore.writeSyncQueue([queuedSale()])

  await infrastructure.processSyncQueue()

  const queued = syncStore.readSyncQueue()
  assert.equal(queued.length, 1, 'an uncertain outcome is never silently dropped')
  assert.equal(queued[0]._outcome_class, REPLAY_OUTCOME.TRANSPORT_UNCERTAIN)
  assert.equal(queued[0].manualRetryOnly, false, 'uncertain outcomes stay auto-retryable')
  assert.equal(queued[0].retryCount, 1, 'exactly one attempt per pass; the persisted schedule paces retries')
  assert.ok(queued[0]._next_retry_at, 'a bounded next attempt is scheduled')
  assert.equal(queued[0].data.payload.shift_id, ORIGINAL_SHIFT)
  assert.deepEqual(syncStore.readFailedSyncQueue(), [])

  // R7: the persisted retry time controls execution. An immediate re-run must
  // not attempt the sale again before it is due.
  await infrastructure.processSyncQueue()
  assert.equal(calls.length, 1, 'no attempt before the persisted retry time')

  // The retry time elapses (the row as the supervisor would have aged it):
  // the same operation key resumes the replay.
  const dueAt = Date.parse(queued[0]._next_retry_at)
  assert.ok(Number.isFinite(dueAt), 'the schedule is a real parseable deadline')
  syncStore.writeSyncQueue([{ ...queued[0], _next_retry_at: new Date(dueAt - 60000).toISOString() }])
  outcome = 'succeed'
  await infrastructure.processSyncQueue()

  assert.deepEqual(syncStore.readSyncQueue(), [])
  assert.deepEqual(syncStore.readFailedSyncQueue(), [])
  const forwarded = calls.at(-1).args.payload
  assert.equal(forwarded.create_idempotency_key, `pos-order:intent-${ORDER}`, 'the same stable key resumes the retry')
  assert.equal(forwarded.shift_id, ORIGINAL_SHIFT)
  assert.equal(calls.at(-1).name, POS_HISTORICAL_REPLAY_RPC)
})

test('changed-payload reuse is parked for review, never acknowledged or re-keyed', async (t) => {
  isolatedQueue(t, async () => ({
    data: { success: false, code: 'idempotency_conflict', error: 'Idempotency conflict: the stored payload hash differs from this operation.' },
    error: null
  }))
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  const sale = queuedSale()
  const expectedPayload = JSON.parse(JSON.stringify(sale.data.payload))
  syncStore.writeSyncQueue([sale])

  await infrastructure.processSyncQueue()

  const failed = syncStore.readFailedSyncQueue()
  assert.equal(failed.length, 1)
  assert.equal(failed[0]._outcome_class, REPLAY_OUTCOME.BUSINESS_CONFLICT)
  assert.equal(failed[0].manualRetryOnly, true)
  assert.deepEqual(failed[0].data.payload, expectedPayload, 'the changed/replayed payload is preserved for authorized review')
  assert.equal(failed[0].data.payload.create_idempotency_key, `pos-order:intent-${ORDER}`, 'no replacement key is minted')
})

test('the capability probe never runs on an ordinary sync with no parked sales', async (t) => {
  const calls = []
  isolatedQueue(t, async (name) => {
    calls.push(name)
    return { data: { success: true, id: ORDER, total: 40 }, error: null }
  })
  cacheStore.writeCache('pos-shifts', [{ ...closedOriginalShift, status: 'open', closed_at: null }])
  syncStore.writeSyncQueue([queuedSale()])

  await infrastructure.processSyncQueue()

  assert.deepEqual(calls, ['create_pos_order_v3'], 'no probe network call for a normal drain')
})

// ─── R7-A/B/C: structured outcome authority, wait budgets, code matrix ──────

test('known contract refusal codes classify from structured evidence, never unknown', () => {
  // The matrix the probe exercised: every code emitted by the deployed
  // sale/settlement, void and historical-replay contracts must produce the
  // same verdict whether or not the free-text message repeats the code.
  const reviewCodes = [
    'TAB_VERSION_REQUIRED',
    'IDEMPOTENCY_EXPIRED',
    'IDEMPOTENCY_RECEIPT_UNAVAILABLE',
    'OPERATION_KEY_REQUIRED',
    'ACTOR_REQUIRED',
    'OUTLET_SCOPE_CONFLICT',
    'REPLAY_KEY_REQUIRED'
  ]
  for (const code of reviewCodes) {
    assert.deepEqual(
      classifyReplayOutcomeDetailed({ code, message: 'HTTP 503 service unavailable' }),
      { outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE },
      `${code} must park for review even when conflicting wording accompanies it`
    )
    assert.equal(
      classifyReplayOutcome({ code, message: 'Something unexpected happened' }),
      REPLAY_OUTCOME.BUSINESS_CONFLICT,
      `${code} with a neutral message is never unknown`
    )
  }
  // Structured evidence wins over conflicting prose for every source class.
  assert.deepEqual(
    classifyReplayOutcomeDetailed({ code: '503', message: 'catalog_refresh_required' }),
    { outcomeClass: REPLAY_OUTCOME.SERVER_UNAVAILABLE, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE }
  )
  assert.deepEqual(
    classifyReplayOutcomeDetailed({ message: 'fetch failed' }),
    { outcomeClass: REPLAY_OUTCOME.TRANSPORT_UNCERTAIN, source: REPLAY_OUTCOME_SOURCE.WORDING }
  )
  assert.deepEqual(
    classifyReplayOutcomeDetailed({ code: '408', message: 'Request Timeout' }),
    { outcomeClass: REPLAY_OUTCOME.TRANSPORT_UNCERTAIN, source: REPLAY_OUTCOME_SOURCE.STRUCTURED_CODE }
  )
  assert.deepEqual(
    classifyReplayOutcomeDetailed({ manualReviewRequired: true, code: '503', message: '' }),
    { outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, source: REPLAY_OUTCOME_SOURCE.MANUAL_FLAG }
  )
  assert.deepEqual(
    classifyReplayOutcomeDetailed({}),
    { outcomeClass: REPLAY_OUTCOME.UNKNOWN, source: REPLAY_OUTCOME_SOURCE.NONE }
  )
})

test('journal retention follows the structured outcome, not prose', () => {
  assert.equal(shouldRetainPosSubmitJournal({ outcomeClass: REPLAY_OUTCOME.SERVER_UNAVAILABLE, code: '503', legacyWordingUncertain: true }), true)
  assert.equal(shouldRetainPosSubmitJournal({ outcomeClass: REPLAY_OUTCOME.UNKNOWN }), true)
  assert.equal(shouldRetainPosSubmitJournal({ outcomeClass: REPLAY_OUTCOME.CONTRACT_MISSING }), true)
  assert.equal(shouldRetainPosSubmitJournal({ outcomeClass: REPLAY_OUTCOME.PERMISSION_DENIED }), true)
  for (const code of [
    'idempotency_conflict',
    'IDEMPOTENCY_EXPIRED',
    'idempotency_receipt_unavailable',
    'REPLAY_KEY_REQUIRED',
    'replay_key_mismatch',
    'HISTORICAL_EVIDENCE_INCOMPLETE',
    'tab_version_required'
  ]) {
    assert.equal(shouldRetainPosSubmitJournal({ outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, code }), true, code)
  }
  assert.equal(shouldRetainPosSubmitJournal({ outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, code: 'insufficient_stock' }), false)
  assert.equal(shouldRetainPosSubmitJournal({ outcomeClass: REPLAY_OUTCOME.VALIDATION_REJECTED, code: '23505' }), false)
  assert.equal(shouldRetainPosSubmitJournal({ outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, code: null, legacyWordingUncertain: true }), true)
  assert.equal(shouldRetainPosSubmitJournal({ outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, code: null, legacyWordingUncertain: false }), false)
})

test('a structured temporary refusal never dead-letters the sale or clears its journal', async (t) => {
  let calls = 0
  let mode = 'temporary'
  isolatedQueue(t, async (name) => {
    calls += 1
    if (name !== POS_HISTORICAL_REPLAY_RPC) throw new Error(`unexpected RPC ${name}`)
    if (mode === 'temporary') {
      return { data: { success: false, code: '503', error: 'catalog_refresh_required' }, error: null }
    }
    return { data: { success: true, replayed: true, order_id: ORDER }, error: null }
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  const sale = queuedSale()
  syncStore.writeSyncQueue([sale])
  journal.resolvePosSubmitAttempt({
    submitIntentId: `intent-${ORDER}`,
    orderId: ORDER,
    lodgeId: LODGE,
    userId: CASHIER,
    payload: sale.data.payload
  })
  journal.markPosSubmitAttemptProvisional(`intent-${ORDER}`, sale._queue_id)

  await infrastructure.processSyncQueue()

  const queued = syncStore.readSyncQueue()
  assert.equal(queued.length, 1, 'the structured 503 never dead-letters the resumable sale')
  assert.equal(queued[0]._outcome_class, REPLAY_OUTCOME.SERVER_UNAVAILABLE, 'the structured code controls the outcome class')
  assert.equal(queued[0].manualRetryOnly, false, 'business wording in the message cannot force manual review')
  assert.equal(queued[0].retryCount, 1, 'exactly one scheduled attempt')
  assert.ok(queued[0]._next_retry_at, 'the attempt is scheduled, not parked')
  assert.deepEqual(syncStore.readFailedSyncQueue(), [], 'nothing was dead-lettered')
  assert.equal(journal.getPosSubmitAttempt(`intent-${ORDER}`)?.status, 'provisional', 'the uncertain journal is retained')

  // Restart: a fresh pass before the persisted schedule is due must not
  // attempt the sale again and must not park it.
  await infrastructure.processSyncQueue()
  assert.equal(calls, 1, 'no attempt before the persisted retry time')
  assert.equal(journal.getPosSubmitAttempt(`intent-${ORDER}`)?.status, 'provisional')

  // Due: the same operation key resumes and the receipt commits the journal.
  mode = 'replayed'
  const dueAt = Date.parse(queued[0]._next_retry_at)
  syncStore.writeSyncQueue([{ ...queued[0], _next_retry_at: new Date(dueAt - 60000).toISOString() }])
  await infrastructure.processSyncQueue()

  assert.deepEqual(syncStore.readSyncQueue(), [])
  assert.deepEqual(syncStore.readFailedSyncQueue(), [])
  assert.equal(journal.getPosSubmitAttempt(`intent-${ORDER}`)?.status, 'committed', 'the same-key reconciliation commits the original attempt')
})

test('a parent wait never spends the child sale attempt budget or dead-letters it', async (t) => {
  const calls = []
  let parentMode = 'dead'
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    if (name === 'update_pos_tab_status') {
      if (parentMode === 'dead') throw new TypeError('fetch failed')
      return { data: { success: true, tab_id: 'parent-tab' }, error: null }
    }
    if (name === POS_HISTORICAL_REPLAY_RPC) return { data: { success: true, replayed: true, order_id: ORDER }, error: null }
    throw new Error(`unexpected RPC ${name}`)
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  const parent = {
    type: 'rpc',
    table: 'update_pos_tab_status',
    _queue_id: 'tab-status-parent',
    _state: 'failed',
    retryCount: 1,
    manualRetryOnly: false,
    lastAttemptedAt: new Date().toISOString(),
    data: { payload: { tab_id: 'parent-tab' } }
  }
  const child = queuedSale(originalPayload(), {
    retryCount: 4,
    _depends_on: 'tab-status-parent'
  })
  syncStore.writeSyncQueue([child])
  syncStore.writeFailedSyncQueue([parent])

  await infrastructure.processSyncQueue()

  assert.equal(calls.length, 0, 'neither the child nor the recent parent was attempted')
  const waiting = syncStore.readSyncQueue()
  assert.equal(waiting.length, 1)
  assert.equal(waiting[0].retryCount, 4, 'the wait never consumes the child dispatch budget')
  assert.equal(waiting[0]._parent_wait_count, 1, 'the wait is tracked separately')
  assert.equal(waiting[0]._outcome_class, REPLAY_OUTCOME.PARENT_PENDING)
  assert.equal(waiting[0].manualRetryOnly, false, 'a retryable parent wait never parks the child')
  assert.ok(waiting[0]._next_retry_at, 'the wait has its own bounded schedule')
  assert.equal(syncStore.readFailedSyncQueue().length, 1, 'the child is not dead-lettered without a dispatched attempt')

  // The parent auto-requeues after the dead-letter window and recovers: the
  // child is released and dispatched with its original identity.
  parentMode = 'alive'
  syncStore.writeFailedSyncQueue([{ ...parent, lastAttemptedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() }])
  await infrastructure.processSyncQueue()

  assert.deepEqual(calls.map((call) => call.name), ['update_pos_tab_status', POS_HISTORICAL_REPLAY_RPC])
  const forwarded = calls.at(-1).args.payload
  assert.equal(forwarded.create_idempotency_key, `pos-order:intent-${ORDER}`)
  assert.equal(forwarded.shift_id, ORIGINAL_SHIFT)
  assert.deepEqual(syncStore.readSyncQueue(), [])
  assert.deepEqual(syncStore.readFailedSyncQueue(), [])
})

test('a child behind a terminal parent parks under the terminal rule without dispatch', async (t) => {
  const calls = []
  isolatedQueue(t, async (name) => {
    calls.push(name)
    throw new Error(`no RPC may run: ${name}`)
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  const deadParent = {
    type: 'rpc',
    table: 'update_pos_tab_status',
    _queue_id: 'tab-status-parent',
    _state: 'failed',
    retryCount: 5,
    manualRetryOnly: true,
    lastAttemptedAt: new Date().toISOString(),
    data: { payload: { tab_id: 'parent-tab' } }
  }
  const child = queuedSale(originalPayload(), {
    retryCount: 4,
    _depends_on: 'tab-status-parent'
  })
  syncStore.writeSyncQueue([child])
  syncStore.writeFailedSyncQueue([deadParent])

  await infrastructure.processSyncQueue()

  assert.equal(calls.length, 0, 'the child is never dispatched against a terminal parent')
  const failed = syncStore.readFailedSyncQueue()
  const parkedChild = failed.find((row) => row._queue_id === child._queue_id)
  assert.ok(parkedChild, 'the child is parked for review')
  assert.equal(parkedChild.manualRetryOnly, true)
  assert.equal(parkedChild.retryCount, 5)
  assert.match(parkedChild.lastError, /can no longer succeed/)
  assert.deepEqual(syncStore.readSyncQueue(), [])
})

test('probe errors keep the contract unknown; only a clean answer resumes parked sales', async (t) => {
  let probeMode = 'unavailable'
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    if (name !== POS_HISTORICAL_REPLAY_RPC) throw new Error(`unexpected RPC ${name}`)
    if (args?.payload === null) {
      if (probeMode === 'unavailable') return { data: null, error: { code: '503', message: 'service unavailable' } }
      if (probeMode === 'permission') return { data: null, error: { code: '42501', message: 'permission denied for function replay_pos_order_v3_historical_v1' } }
      if (probeMode === 'auth') return { data: null, error: { code: '401', message: 'jwt expired' } }
      if (probeMode === 'transport') throw new TypeError('fetch failed')
      return { data: { success: false, code: 'replay_key_required', error: 'payload required' }, error: null }
    }
    return { data: { success: true, replayed: true, order_id: ORDER }, error: null }
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  const parkedSale = queuedSale(originalPayload(), {
    manualRetryOnly: true,
    retryCount: 5,
    _outcome_class: REPLAY_OUTCOME.CONTRACT_MISSING,
    _next_retry_at: null,
    lastError: 'historical replay contract missing'
  })
  syncStore.writeSyncQueue([])
  syncStore.writeFailedSyncQueue([parkedSale])

  for (const mode of ['unavailable', 'permission', 'auth', 'transport']) {
    probeMode = mode
    await infrastructure.processSyncQueue()
    assert.equal(state.historicalReplayContractAvailable, undefined, `${mode} must leave the capability unknown`)
    assert.equal(syncStore.readFailedSyncQueue().length, 1, `${mode} must not requeue the parked sale`)
    assert.deepEqual(syncStore.readSyncQueue(), [])
  }

  probeMode = 'available'
  await infrastructure.processSyncQueue()

  assert.equal(state.historicalReplayContractAvailable, true)
  assert.deepEqual(syncStore.readFailedSyncQueue(), [])
  assert.deepEqual(syncStore.readSyncQueue(), [], 'the requeued sale replayed and settled')
  const replayedSale = calls.find((call) => call.args?.payload)
  assert.equal(replayedSale.args.payload.shift_id, ORIGINAL_SHIFT, 'original bytes survive the wait')
})

test('queue changes during the contract probe are reconciled, never dropped', async (t) => {
  const calls = []
  const parkedSale = queuedSale(originalPayload(), {
    manualRetryOnly: true,
    retryCount: 5,
    _outcome_class: REPLAY_OUTCOME.CONTRACT_MISSING,
    _next_retry_at: null,
    lastError: 'historical replay contract missing'
  })
  const concurrentAdd = {
    type: 'rpc',
    table: 'create_booking',
    _queue_id: 'concurrent-booking-added',
    _state: 'failed',
    data: { p_booking_id: 'added-booking' },
    lastAttemptedAt: new Date().toISOString()
  }
  const concurrentRemove = {
    type: 'rpc',
    table: 'create_expense',
    _queue_id: 'concurrent-expense-removed',
    _state: 'failed',
    data: {},
    lastAttemptedAt: new Date().toISOString()
  }
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    if (name !== POS_HISTORICAL_REPLAY_RPC) throw new Error(`unexpected RPC ${name}`)
    if (args?.payload === null) {
      // A concurrent action lands while the probe is in flight: one failed
      // entry is cleared and a new one appears.
      syncStore.writeFailedSyncQueue([parkedSale, concurrentAdd])
      return { data: { success: false, code: 'replay_key_required', error: 'payload required' }, error: null }
    }
    return { data: { success: true, replayed: true, order_id: ORDER }, error: null }
  })
  cacheStore.writeCache('pos-shifts', [closedOriginalShift])
  syncStore.writeSyncQueue([])
  syncStore.writeFailedSyncQueue([parkedSale, concurrentRemove])

  await infrastructure.processSyncQueue()

  const failedIds = syncStore.readFailedSyncQueue().map((row) => row._queue_id)
  assert.ok(failedIds.includes('concurrent-booking-added'), 'an addition during the probe survives the requeue')
  assert.ok(!failedIds.includes('concurrent-expense-removed'), 'a removal during the probe is not resurrected')
  assert.ok(!failedIds.includes(parkedSale._queue_id), 'the parked sale leaves the recovery queue')
  const replayedSale = calls.find((call) => call.args?.payload)
  assert.equal(replayedSale.args.payload.shift_id, ORIGINAL_SHIFT, 'the requeued sale keeps its original bytes')
  assert.deepEqual(syncStore.readSyncQueue(), [])
})

test('edits or identity collisions during the contract probe fail closed', async (t) => {
  const parkedSale = queuedSale(originalPayload(), {
    manualRetryOnly: true,
    retryCount: 5,
    _outcome_class: REPLAY_OUTCOME.CONTRACT_MISSING,
    _next_retry_at: null,
    lastError: 'historical replay contract missing'
  })
  isolatedQueue(t, async (name, args) => {
    if (name !== POS_HISTORICAL_REPLAY_RPC) throw new Error(`unexpected RPC ${name}`)
    if (args?.payload === null) {
      syncStore.writeFailedSyncQueue([{ ...parkedSale, data: { payload: { ...originalPayload(), total: 999 } } }])
      return { data: { success: false, code: 'replay_key_required', error: 'payload required' }, error: null }
    }
    throw new Error('an edited recovery copy must never be replayed')
  })
  syncStore.writeSyncQueue([])
  syncStore.writeFailedSyncQueue([parkedSale])

  await infrastructure.requeueContractParkedHistoricalReplayItems()

  const edited = syncStore.readFailedSyncQueue()
  assert.equal(edited.length, 1, 'a concurrent edit stays in recovery for review')
  assert.equal(edited[0].data.payload.total, 999)
  assert.deepEqual(syncStore.readSyncQueue(), [])

  // A pending entry with the same identity but different content blocks the
  // requeue instead of overwriting a concurrent intent.
  const colliding = queuedSale(originalPayload({ total: 123 }))
  syncStore.writeSyncQueue([colliding])
  syncStore.writeFailedSyncQueue([parkedSale])

  await infrastructure.requeueContractParkedHistoricalReplayItems()

  const failedAfter = syncStore.readFailedSyncQueue()
  assert.equal(failedAfter.length, 1, 'the parked sale stays in recovery on identity collision')
  assert.equal(failedAfter[0].data.payload.total, 40)
  const pendingAfter = syncStore.readSyncQueue()
  assert.equal(pendingAfter.length, 1)
  assert.equal(pendingAfter[0].data.payload.total, 123, 'the pending colliding entry is untouched')
})

// ─── R5: stale open-shift cache → bounded same-key historical fallback ──────

test('shift-closure and tab-settlement refusals retain the submit journal (R3 extension)', () => {
  for (const code of ['SHIFT_NOT_OPEN', 'TAB_ALREADY_SETTLED', 'TAB_NOT_OWNED', 'TAB_VERSION_CONFLICT']) {
    assert.equal(
      shouldRetainPosSubmitJournal({ outcomeClass: REPLAY_OUTCOME.BUSINESS_CONFLICT, code }),
      true,
      `${code} can be answered after a committed receipt and must not release the sale`
    )
  }
})

test('only stale-shift refusals qualify for the bounded historical fallback', () => {
  assert.equal(isShiftClosureSaleRefusal({ code: 'shift_not_open', message: 'No valid open shift is available for this sale.' }), true)
  assert.equal(isShiftClosureSaleRefusal({ code: 'till_shift_closed', message: '' }), true)
  assert.equal(isShiftClosureSaleRefusal({ code: 'P0001', message: 'shift_not_open: the originating shift is closed' }), true)
  assert.equal(isShiftClosureSaleRefusal({ message: 'A valid open shift is required for this sale' }), true)
  assert.equal(
    isShiftClosureSaleRefusal({ code: 'idempotency_conflict', message: 'shift_not_open' }),
    false,
    'a different structured refusal is never masked by shift wording'
  )
  assert.equal(isShiftClosureSaleRefusal({ code: 'tab_already_settled', message: '' }), false)
  assert.equal(isShiftClosureSaleRefusal({ code: 'shift_not_open', manual_review_required: true }), false, 'an explicit review flag controls')
  assert.equal(isShiftClosureSaleRefusal({ message: 'fetch failed' }), false)
})

test('a stale open-shift cache recovers a closed-shift sale through one same-key historical attempt', async (t) => {
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    if (name === 'create_pos_order_v3') {
      return { data: { success: false, code: 'shift_not_open', error: 'No valid open shift is available for this sale.' }, error: null }
    }
    if (name === POS_HISTORICAL_REPLAY_RPC) {
      return { data: { success: true, id: ORDER, total: 40, receipt_number: 'R-0042', historical_replay: true }, error: null }
    }
    throw new Error(`unexpected RPC ${name}`)
  })
  cacheStore.writeCache('pos-shifts', [{ ...closedOriginalShift, status: 'open', closed_at: null }])
  const sale = queuedSale()
  const expectedPayload = JSON.parse(JSON.stringify(sale.data.payload))
  syncStore.writeSyncQueue([sale])
  journal.resolvePosSubmitAttempt({
    submitIntentId: `intent-${ORDER}`,
    orderId: ORDER,
    lodgeId: LODGE,
    userId: CASHIER,
    payload: expectedPayload
  })
  journal.markPosSubmitAttemptProvisional(`intent-${ORDER}`, sale._queue_id)

  await infrastructure.processSyncQueue()

  assert.deepEqual(
    calls.map((call) => call.name),
    ['create_pos_order_v3', POS_HISTORICAL_REPLAY_RPC],
    'exactly one bounded fallback attempt, never a loop'
  )
  const fallback = calls[1].args
  assert.equal(fallback.p_replay_key, `hist-replay:pos-order:intent-${ORDER}`, 'the stable operation key is reused, never replaced')
  assert.deepEqual(fallback.payload, expectedPayload, 'the original bytes are forwarded unchanged')
  assert.equal(fallback.payload.shift_id, ORIGINAL_SHIFT, 'the original shift is preserved, not today\'s')
  assert.deepEqual(syncStore.readSyncQueue(), [], 'the reconciled sale is consumed')
  assert.deepEqual(syncStore.readFailedSyncQueue(), [])
  assert.equal(journal.getPosSubmitAttempt(`intent-${ORDER}`)?.status, 'committed', 'the reconciled receipt commits the original attempt')
})

test('fallback contract absence parks the stale-cache sale and preserves its journal', async (t) => {
  const calls = []
  isolatedQueue(t, async (name, args) => {
    calls.push({ name, args })
    if (name === 'create_pos_order_v3') {
      return { data: { success: false, code: 'shift_not_open', error: 'No valid open shift is available for this sale.' }, error: null }
    }
    if (name === POS_HISTORICAL_REPLAY_RPC) {
      return {
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.replay_pos_order_v3_historical_v1(payload, p_replay_key) in the schema cache'
        }
      }
    }
    throw new Error(`unexpected RPC ${name}`)
  })
  cacheStore.writeCache('pos-shifts', [{ ...closedOriginalShift, status: 'open', closed_at: null }])
  const sale = queuedSale()
  const expectedPayload = JSON.parse(JSON.stringify(sale.data.payload))
  syncStore.writeSyncQueue([sale])
  journal.resolvePosSubmitAttempt({
    submitIntentId: `intent-${ORDER}`,
    orderId: ORDER,
    lodgeId: LODGE,
    userId: CASHIER,
    payload: expectedPayload
  })
  journal.markPosSubmitAttemptProvisional(`intent-${ORDER}`, sale._queue_id)

  await infrastructure.processSyncQueue()

  assert.deepEqual(calls.map((call) => call.name), ['create_pos_order_v3', POS_HISTORICAL_REPLAY_RPC], 'one fallback attempt only')
  assert.deepEqual(syncStore.readSyncQueue(), [])
  const failed = syncStore.readFailedSyncQueue()
  assert.equal(failed.length, 1)
  assert.equal(failed[0]._outcome_class, REPLAY_OUTCOME.CONTRACT_MISSING, 'the missing prerequisite, not the shift refusal, is the state')
  assert.equal(failed[0].manualRetryOnly, true, 'the sale is parked for automatic resume after deployment')
  assert.deepEqual(failed[0].data.payload, expectedPayload, 'no rewrite to today\'s shift; original bytes retained')
  assert.equal(journal.getPosSubmitAttempt(`intent-${ORDER}`)?.status, 'pending', 'the unresolved sale keeps its recovery journal')
})

test('a structured non-shift refusal never triggers the historical fallback', async (t) => {
  const calls = []
  isolatedQueue(t, async (name) => {
    calls.push(name)
    if (name === 'create_pos_order_v3') {
      return { data: { success: false, code: 'tab_already_settled', error: 'This tab has already been settled.' }, error: null }
    }
    throw new Error(`unexpected RPC ${name}`)
  })
  cacheStore.writeCache('pos-shifts', [{ ...closedOriginalShift, status: 'open', closed_at: null }])
  const sale = queuedSale()
  syncStore.writeSyncQueue([sale])
  journal.resolvePosSubmitAttempt({
    submitIntentId: `intent-${ORDER}`,
    orderId: ORDER,
    lodgeId: LODGE,
    userId: CASHIER,
    payload: sale.data.payload
  })
  journal.markPosSubmitAttemptProvisional(`intent-${ORDER}`, sale._queue_id)

  await infrastructure.processSyncQueue()

  assert.deepEqual(calls, ['create_pos_order_v3'], 'the structural refusal controls; no fallback is attempted')
  const failed = syncStore.readFailedSyncQueue()
  assert.equal(failed.length, 1)
  assert.equal(failed[0]._outcome_class, REPLAY_OUTCOME.BUSINESS_CONFLICT)
  assert.equal(failed[0].manualRetryOnly, true)
  assert.equal(
    journal.getPosSubmitAttempt(`intent-${ORDER}`)?.status,
    'pending',
    'a post-commit-capable refusal keeps the journal for reconciliation'
  )
})
