import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { importDomain, importState, makeTempCacheDir } from './helpers/domain-test-setup.mjs'

const { state } = await importState()
const finance = await importDomain('finance.js')
const LODGE = '11111111-1111-4111-8111-111111111111'

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}'
  return JSON.stringify(value)
}
function completeReconciliation() {
  return {
    success: true, schema_version: 1, calculation_version: 'financial-reconciliation-v1',
    complete: true, lodge_id: LODGE, report_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', report_hash: 'a'.repeat(64), generated_at: '2026-10-05T00:00:00.000Z',
    examined_counts: { bookings: 0, payments: 0, charges: 0, invoices: 0, pos_orders: 0, pos_returns: 0, customer_credit_entries: 0 },
    mismatch_counts: { payment_mismatches: 0, charge_mismatches: 0, invoice_gaps: 0, duplicate_invoices: 0, orphan_invoices: 0, folio_pos_mismatches: 0, pos_return_mismatches: 0, credit_mismatches: 0, pos_void_mismatches: 0 },
    totals: { booking_total_amount: '0.00', booking_amount_paid: '0.00', payment_ledger_net: '0.00', booking_charges_total: '0.00', active_booking_charge_net: '0.00', pos_net_total: '0.00', customer_credit_net: '0.00' },
    samples: { payment_mismatches: [], charge_mismatches: [], invoice_gaps: [], duplicate_invoices: [], orphan_invoices: [], folio_pos_mismatches: [], pos_return_mismatches: [], credit_mismatches: [], pos_void_mismatches: [] },
    sample_limit: 50, samples_truncated: false
  }
}
test('a returned permission error never labels the validation run server-recorded', async (t) => {
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('financial-validation-persistence')
  state.cacheDir = cacheDir
  state.lodgeId = LODGE
  state.currentUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Synthetic Tester' }
  state.isOnline = true
  const rpcCalls = []
  const query = () => ({
    select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
    gte() { return this }, lte() { return this },
    then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject) }
  })
  state.supabase = {
    from: query,
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      if (name === 'prepare_financial_validation_report_v1') {
        return {
          data: {
            success: true, schema_version: 1, calculation_version: 'financial-reconciliation-v1',
            complete: true, lodge_id: LODGE, report_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', report_hash: 'a'.repeat(64), generated_at: '2026-10-05T00:00:00.000Z',
            examined_counts: { bookings: 0, payments: 0, charges: 0, invoices: 0, pos_orders: 0, pos_returns: 0, customer_credit_entries: 0 },
            mismatch_counts: { payment_mismatches: 0, charge_mismatches: 0, invoice_gaps: 0, duplicate_invoices: 0, orphan_invoices: 0, folio_pos_mismatches: 0, pos_return_mismatches: 0, credit_mismatches: 0, pos_void_mismatches: 0 },
            totals: { booking_total_amount: '0.00', booking_amount_paid: '0.00', payment_ledger_net: '0.00', booking_charges_total: '0.00', active_booking_charge_net: '0.00', pos_net_total: '0.00', customer_credit_net: '0.00' },
            samples: { payment_mismatches: [], charge_mismatches: [], invoice_gaps: [], duplicate_invoices: [], orphan_invoices: [], folio_pos_mismatches: [], pos_return_mismatches: [], credit_mismatches: [], pos_void_mismatches: [] },
            sample_limit: 50, samples_truncated: false
          },
          error: null
        }
      }
      return { data: { success: false, code: '42501', error: 'permission denied' }, error: null }
    }
  }
  t.after(() => { Object.assign(state, previous); fs.rmSync(cacheDir, { recursive: true, force: true }) })

  const result = await finance.runFinancialValidation({ triggerSource: 'manual' })
  assert.equal(result.run.calculation_state, 'complete')
  assert.equal(result.run.persistence_state, 'rejected')
  assert.equal(result.run.server_confirmed, false)
  assert.equal(result.run.local_only, true)
  assert.ok(result.run.id, 'the rejected report remains locally recoverable under its original run id')
  const local = JSON.parse(fs.readFileSync(path.join(cacheDir, 'financial-validation-runs.json'), 'utf8'))
  const rows = Array.isArray(local) ? local : local.runs
  assert.ok(rows.some((row) => row.id === result.run.id && row.persistence_state === 'rejected'))
  const recordCall = rpcCalls.find((call) => call.name === 'record_financial_validation_run_v2')
  assert.ok(recordCall)
  assert.equal(recordCall.args.p_summary.report_id, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  assert.equal(recordCall.args.p_summary.report_hash, 'a'.repeat(64))
})

test('validation persistence retry reuses the saved run id and exact immutable report', async (t) => {
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('financial-validation-retry')
  state.cacheDir = cacheDir
  state.lodgeId = LODGE
  state.currentUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  state.isOnline = true
  const report = completeReconciliation()
  const saved = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lodge_id: LODGE, triggered_by: state.currentUser.id,
    trigger_source: 'manual', summary: report, report_hash: createHash('sha256').update(stableJson(report)).digest('hex'), calculation_state: 'complete',
    persistence_state: 'unknown', local_only: true, server_confirmed: false, created_at: '2026-10-05T00:00:00.000Z'
  }
  fs.writeFileSync(path.join(cacheDir, 'financial-validation-runs.json'), JSON.stringify([saved]))
  const calls = []
  state.supabase = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { success: true, run_id: args.p_run_id, report_hash: args.p_report_hash, recorded: true }, error: null } } }
  t.after(() => { Object.assign(state, previous); fs.rmSync(cacheDir, { recursive: true, force: true }) })

  const result = await finance.retryFinancialValidationRun(saved.id)
  assert.equal(result.run.id, saved.id)
  assert.equal(result.run.persistence_state, 'confirmed')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args.p_run_id, saved.id)
  assert.deepEqual(calls[0].args.p_summary, report)
  assert.equal(calls[0].args.p_report_hash, saved.report_hash)
})

test('a lost validation acknowledgement is recovered from the same server report ID and hash', async (t) => {
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('financial-validation-lost-response')
  state.cacheDir = cacheDir
  state.lodgeId = LODGE
  state.currentUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Synthetic Tester' }
  state.isOnline = true
  const calls = []
  let run
  state.supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args })
      if (name === 'prepare_financial_validation_report_v1') return { data: completeReconciliation(), error: null }
      if (name === 'get_financial_audit_log') return { data: [], error: null }
      if (name === 'record_financial_validation_run_v2') throw new Error('fetch failed after commit')
      if (name === 'get_financial_validation_runs_v2') {
        return { data: [{ id: run.id, lodge_id: LODGE, triggered_by: state.currentUser.id, trigger_source: run.trigger_source, summary: run.summary, report_hash: run.report_hash, idempotency_key: run.id, persistence_state: 'confirmed', server_confirmed: true, created_at: '2026-10-05T00:00:02.000Z' }], error: null }
      }
      throw new Error('unexpected RPC ' + name)
    }
  }
  t.after(() => { Object.assign(state, previous); fs.rmSync(cacheDir, { recursive: true, force: true }) })

  const attempted = await finance.runFinancialValidation({ triggerSource: 'manual' })
  run = attempted.run
  assert.equal(run.persistence_state, 'unknown')
  assert.equal(run.local_only, true)
  const history = await finance.getFinancialValidationRuns(10)
  assert.equal(history[0].id, run.id)
  assert.equal(history[0].server_confirmed, true)
  assert.equal(history[0].persistence_state, 'confirmed')
  const local = JSON.parse(fs.readFileSync(path.join(cacheDir, 'financial-validation-runs.json'), 'utf8'))
  assert.equal(local[0].server_confirmed, true)
  assert.equal(local[0].report_hash, run.report_hash)
  assert.ok(calls.some((call) => call.name === 'get_financial_validation_runs_v2'))
})

test('a local journal write failure stops before validation recording is dispatched', async (t) => {
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const parent = makeTempCacheDir('financial-validation-write-failure')
  const cachePath = path.join(parent, 'not-a-directory')
  fs.writeFileSync(cachePath, 'blocking-file')
  state.cacheDir = cachePath
  state.lodgeId = LODGE
  state.currentUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  state.isOnline = true
  const calls = []
  state.supabase = {
    rpc: async (name) => {
      calls.push(name)
      if (name === 'prepare_financial_validation_report_v1') return { data: completeReconciliation(), error: null }
      if (name === 'get_financial_audit_log') return { data: [], error: null }
      throw new Error('Validation recorder must not be reached')
    }
  }
  t.after(() => { Object.assign(state, previous); fs.rmSync(parent, { recursive: true, force: true }) })

  const result = await finance.runFinancialValidation()
  assert.equal(result.success, false)
  assert.equal(result.run.persistence_state, 'unavailable')
  assert.match(result.error, /not submitted/i)
  assert.equal(calls.includes('record_financial_validation_run_v2'), false)
})

test('validation is not dispatched without a server-issued immutable report receipt', async (t) => {
  const keys = ['cacheDir', 'lodgeId', 'currentUser', 'supabase', 'isOnline']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('financial-validation-missing-receipt')
  state.cacheDir = cacheDir
  state.lodgeId = LODGE
  state.currentUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  state.isOnline = true
  const calls = []
  const query = () => ({
    select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
    gte() { return this }, lte() { return this },
    then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject) }
  })
  state.supabase = {
    from: query,
    rpc: async (name) => {
      calls.push(name)
      if (name === 'prepare_financial_validation_report_v1') {
        const report = completeReconciliation()
        delete report.report_id
        delete report.report_hash
        return { data: report, error: null }
      }
      if (name === 'get_financial_audit_log') return { data: [], error: null }
      throw new Error('No persistence RPC should run without a server report receipt')
    }
  }
  t.after(() => { Object.assign(state, previous); fs.rmSync(cacheDir, { recursive: true, force: true }) })

  const result = await finance.runFinancialValidation({ triggerSource: 'manual' })
  assert.equal(result.success, false)
  assert.equal(result.run, null)
  assert.match(result.error, /immutable reconciliation report receipt/i)
  assert.equal(calls.includes('record_financial_validation_run_v2'), false)
})
test('server validation recorder binds the supplied hash to its immutable report', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20261005040000_luna_financial_validation_run_v2.sql', import.meta.url), 'utf8')
  const start = migration.indexOf('create or replace function public.record_financial_validation_run_v2(')
  const end = migration.indexOf('create or replace function public.get_financial_validation_runs_v2(', start)
  assert.ok(start >= 0 && end > start)
  const recorder = migration.slice(start, end)
  assert.match(recorder, /v_source\.report_hash\s+is distinct from\s+p_report_hash/i,
    'the top-level report_hash argument must match the immutable server report row')
})
