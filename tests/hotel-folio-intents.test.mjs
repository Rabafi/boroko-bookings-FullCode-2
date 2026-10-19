import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { importDomain, importState, makeTempCacheDir, scriptSupabase } from './helpers/domain-test-setup.mjs'

const { state } = await importState()
const folios = await importDomain('folioLedger.js')
const LODGE = '11111111-1111-4111-8111-111111111111'
const FOLIO = '22222222-2222-4222-8222-222222222222'
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function receiptFor(args, receipt = { result: { line_item_id: 'line-1' } }) {
  return {
    success: true,
    operation_id: args.p_idempotency_key,
    operation_type: 'hotel_folio_' + args.p_operation_kind + '_v1',
    payload_hash: 'a'.repeat(64),
    lodge_id: LODGE,
    actor_id: ACTOR,
    request_payload: args.p_payload,
    receipt
  }
}

function setup(t, { cacheDir = null, rpc } = {}) {
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const directory = cacheDir || makeTempCacheDir('hotel-folio-intents')
  Object.assign(state, {
    cacheDir: directory,
    lodgeId: LODGE,
    currentUser: { id: ACTOR },
    isOnline: true,
    supabase: scriptSupabase(rpc || (async (name, args) => ({
      data: receiptFor(args),
      error: null
    })))
  })
  t.after(() => {
    Object.assign(state, previous)
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

test('Hotel folio financial mutations reject offline without dispatch or queueing', async (t) => {
  let calls = 0
  setup(t, { rpc: async () => { calls += 1; return { data: receiptFor({ p_operation_kind: 'payment', p_payload: {} }), error: null } } })
  state.isOnline = false
  const key = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  await assert.rejects(
    folios.addPayment(FOLIO, 20, 'Offline attempt', key),
    /requires an internet connection.*cannot be queued offline/i
  )
  assert.equal(calls, 0, 'online-only finance must stop before RPC dispatch')
  const journal = path.join(state.cacheDir, 'hotel-folio-intents.json')
  assert.equal(fs.existsSync(journal), false, 'offline attempts must not create a speculative financial intent')
})
test('Hotel transfer preserves the exact supplied operation key through the real domain', async (t) => {
  const calls = []
  setup(t, { rpc: async (name, args) => { calls.push({ name, args }); return { data: receiptFor(args), error: null } } })
  const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11'
  await folios.transferCharge(FOLIO, '33333333-3333-4333-8333-333333333333', 25, 'Move charge', key)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args.p_idempotency_key, key, 'the supplied key must not be stripped, padded, truncated or replaced')
})

test('Hotel financial intent without a caller key never fabricates a content-derived key', async (t) => {
  let calls = 0
  setup(t, { rpc: async () => { calls += 1; return { data: { success: true }, error: null } } })
  await assert.rejects(
    folios.transferCharge(FOLIO, '33333333-3333-4333-8333-333333333333', 25, 'Move charge'),
    /intent|idempotency key/i
  )
  assert.equal(calls, 0, 'invalid/missing identity must fail before RPC dispatch')
})

test('an ambiguous Hotel payment survives restart and retry uses the original immutable envelope', async (t) => {
  const directory = setup(t)
  const journalPath = path.join(directory, 'hotel-folio-intents.json')
  const firstCalls = []
  state.supabase = scriptSupabase(async (name, args) => {
    firstCalls.push({ name, args })
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
    assert.equal(journal.intents[0].status, 'submitting', 'prepared envelope and submit marker must be durable before network dispatch')
    assert.equal(args.p_idempotency_key, journal.intents[0].intentId)
    throw Object.assign(new Error('fetch failed after server commit'), { code: 'ECONNRESET' })
  })

  const first = await folios.submitIntent('payment', { folioId: FOLIO, amount: 42.5, description: 'Room deposit' })
  assert.equal(first.status, 'unknown')
  assert.ok(first.intentId)
  const persisted = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  assert.equal(persisted.intents[0].status, 'unknown')
  const originalHash = persisted.intents[0].payloadHash

  state.isOnline = true
  state.supabase = scriptSupabase(async (name, args) => {
    firstCalls.push({ name, args })
    return { data: receiptFor(args, { line_item_id: 'line-from-original-operation' }), error: null }
  })
  const retried = await folios.retryIntent(first.intentId)
  assert.equal(retried.status, 'confirmed')
  assert.equal(retried.intentId, first.intentId)
  assert.equal(firstCalls[0].args.p_idempotency_key, firstCalls[1].args.p_idempotency_key)
  assert.deepEqual(firstCalls[0].args, firstCalls[1].args)
  const confirmed = JSON.parse(fs.readFileSync(journalPath, 'utf8')).intents[0]
  assert.equal(confirmed.payloadHash, originalHash)
  assert.equal(confirmed.status, 'confirmed')
  assert.equal(confirmed.serverReceipt.receipt.line_item_id, 'line-from-original-operation')
})

test('a Hotel intent journal write failure prevents financial dispatch', async (t) => {
  const root = makeTempCacheDir('hotel-folio-journal-block')
  const blocker = path.join(root, 'not-a-directory')
  fs.writeFileSync(blocker, 'not a directory')
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  Object.assign(state, {
    cacheDir: blocker,
    lodgeId: LODGE,
    currentUser: { id: ACTOR },
    isOnline: true
  })
  let calls = 0
  state.supabase = scriptSupabase(async () => { calls += 1; return { data: { success: true }, error: null } })
  t.after(() => { Object.assign(state, previous); fs.rmSync(root, { recursive: true, force: true }) })
  await assert.rejects(folios.submitIntent('payment', { folioId: FOLIO, amount: 10, description: 'Deposit' }), /journal|persist/i)
  assert.equal(calls, 0)
})

test('two deliberate identical Hotel payments have distinct main-process intent keys', async (t) => {
  const calls = []
  setup(t, { rpc: async (name, args) => {
    calls.push({ name, args })
    return { data: receiptFor(args, { result: { line_item_id: 'line-' + calls.length } }), error: null }
  } })
  const payload = { folioId: FOLIO, amount: 30, description: 'Payment' }
  const first = await folios.submitIntent('payment', payload)
  const second = await folios.submitIntent('payment', payload)
  assert.equal(first.status, 'confirmed')
  assert.equal(second.status, 'confirmed')
  assert.notEqual(first.intentId, second.intentId)
  assert.notEqual(calls[0].args.p_idempotency_key, calls[1].args.p_idempotency_key)
})

test('a mismatched Hotel receipt scope or payload remains unknown and is never confirmed', async (t) => {
  let calls = 0
  setup(t, { rpc: async (name, args) => {
    calls += 1
    const receipt = receiptFor(args)
    receipt.request_payload = { ...args.p_payload, amount: 999 }
    return { data: receipt, error: null }
  } })
  const result = await folios.submitIntent('payment', { folioId: FOLIO, amount: 40, description: 'Room payment' })
  assert.equal(result.status, 'unknown')
  assert.equal(result.pendingRecovery, true)
  assert.equal(calls, 1)
  assert.equal(folios.getPendingIntentRecovery().length, 1)
})

test('a damaged persisted Hotel payload is quarantined from dispatch by hash validation', async (t) => {
  const directory = setup(t)
  const journalPath = path.join(directory, 'hotel-folio-intents.json')
  let calls = 0
  state.supabase = scriptSupabase(async () => { calls += 1; throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }) })
  const pending = await folios.submitIntent('payment', { folioId: FOLIO, amount: 17, description: 'Saved payment' })
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  journal.intents[0].payload.amount = 18
  fs.writeFileSync(journalPath, JSON.stringify(journal))
  await assert.rejects(folios.retryIntent(pending.intentId), /malformed|journal/i)
  assert.equal(calls, 1, 'the corrupted envelope must never reach the server')
})

test('server success with local receipt-write failure stays recoverable and retries the original key', async (t) => {
  const directory = setup(t)
  const journalPath = path.join(directory, 'hotel-folio-intents.json')
  const originalRename = fs.renameSync
  let renameCalls = 0
  fs.renameSync = function (...args) {
    renameCalls += 1
    if (renameCalls === 3) throw new Error('injected acknowledgement rename failure')
    return originalRename.apply(this, args)
  }
  t.after(() => { fs.renameSync = originalRename })
  const calls = []
  state.supabase = scriptSupabase(async (name, args) => { calls.push({ name, args }); return { data: receiptFor(args), error: null } })
  const submitted = await folios.submitIntent('payment', { folioId: FOLIO, amount: 27, description: 'Receipt failure case' })
  assert.equal(submitted.status, 'unknown')
  assert.equal(submitted.pendingRecovery, true)
  assert.equal(JSON.parse(fs.readFileSync(journalPath, 'utf8')).intents[0].status, 'submitting')
  await assert.rejects(folios.submitIntent('payment', { folioId: FOLIO, amount: 28, description: 'New operation while pending' }), /recover.*operation/i)
  const recovered = await folios.retryIntent(submitted.intentId)
  assert.equal(recovered.status, 'confirmed')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].args.p_idempotency_key, calls[1].args.p_idempotency_key)
  assert.deepEqual(calls[0].args, calls[1].args)
})
test('Hotel integrity diagnostic migration body is correctly dollar-quoted', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261005010000_luna_hotel_folio_intent_contract.sql', import.meta.url), 'utf8')
  const start = migration.indexOf('create or replace function public.get_hotel_folio_integrity_diagnostics(')
  const end = migration.indexOf('-- Legacy mutations remain available', start)
  assert.ok(start >= 0 && end > start, 'integrity diagnostic function and following migration boundary must exist')
  const definition = migration.slice(start, end)
  assert.match(definition, /returns jsonb[\s\S]*?\bas\s+\$\$/i, 'PL/pgSQL body must open with a dollar quote')
  assert.match(definition, /\bend;\s*\$\$;\s*$/i, 'PL/pgSQL body must close before subsequent migration statements')
})

test('Hotel folio reads are not granted to PUBLIC or anon', () => {
  const sql = fs.readFileSync(path.resolve('supabase/migrations/20261005010000_luna_hotel_folio_intent_contract.sql'), 'utf8')
  assert.match(sql, /revoke all on function public\.get_folio_line_items\(uuid,uuid\) from public,\s*anon/i)
  assert.match(sql, /revoke all on function public\.get_hotel_folio_integrity_diagnostics\(uuid\) from public,\s*anon/i)
})
test('forward Hotel diagnostic fixes UUID leg aggregation without weakening leg and reversal counts', () => {
  const sql = fs.readFileSync(path.resolve('supabase/migrations/20261007010000_hotel_folio_integrity_diagnostics.sql'), 'utf8')
  assert.match(sql, /max\(li\.folio_id::text\)\s*filter\s*\(where\s+li\.line_type\s*=\s*'transfer_out'\)\)::uuid/i)
  assert.match(sql, /max\(li\.folio_id::text\)\s*filter\s*\(where\s+li\.line_type\s*=\s*'transfer_in'\)\)::uuid/i)
  assert.doesNotMatch(sql, /max\(li\.folio_id\s*\)/i, 'PostgreSQL has no max(uuid) aggregate')
  assert.match(sql, /count\(\*\)\s*filter\s*\(where\s+li\.line_type\s*=\s*'transfer_out'\)/i)
  assert.match(sql, /count\(\*\)\s*filter\s*\(where\s+li\.line_type\s*=\s*'transfer_in'\)/i)
  assert.match(sql, /transfer_reversals\s+as\s+materialized/i, 'reversal aggregation must remain independent of leg aggregation')
  assert.match(sql, /app_require_lodge_role\(p_lodge_id,array\['manager','admin','super_admin','finance'\]\)/i)
  assert.match(sql, /set search_path\s*=\s*public/i)
})
