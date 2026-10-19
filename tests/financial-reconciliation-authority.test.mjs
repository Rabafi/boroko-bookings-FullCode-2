import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import { importDomain, importState, makeTempCacheDir } from './helpers/domain-test-setup.mjs'

const { state } = await importState()
const finance = await importDomain('finance.js')
const LODGE = '11111111-1111-4111-8111-111111111111'

function setup(t, result) {
  const keys = ['cacheDir', 'lodgeId', 'supabase', 'isOnline', 'currentUser']
  const previous = Object.fromEntries(keys.map((key) => [key, state[key]]))
  const cacheDir = makeTempCacheDir('financial-reconciliation-authority')
  state.cacheDir = cacheDir
  state.lodgeId = LODGE
  state.isOnline = true
  state.currentUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
  const calls = []
  const emptyQuery = () => ({
    select() { return this }, eq() { return this }, limit() { return Promise.resolve({ data: [], error: null }) },
    order() { return this }, gte() { return this }, lte() { return this },
    then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject) }
  })
  state.supabase = {
    from: emptyQuery,
    rpc: async (name, args) => { calls.push({ name, args }); return { data: result, error: null } }
  }
  t.after(() => { Object.assign(state, previous); import('node:fs').then((fs) => fs.rmSync(cacheDir, { recursive: true, force: true })) })
  return calls
}

function completeSnapshot(overrides = {}) {
  return {
    success: true,
    schema_version: 1,
    calculation_version: 'financial-reconciliation-v1',
    complete: true,
    lodge_id: LODGE,
    generated_at: '2026-10-05T00:00:00.000Z',
    examined_counts: { bookings: 1001, payments: 2001, charges: 2001, invoices: 1001, pos_orders: 1001, pos_returns: 25, customer_credit_entries: 500 },
    mismatch_counts: { payment_mismatches: 1, charge_mismatches: 0, invoice_gaps: 0, duplicate_invoices: 0, orphan_invoices: 0, folio_pos_mismatches: 0, pos_return_mismatches: 0, credit_mismatches: 0, pos_void_mismatches: 0 },
    totals: { booking_total_amount: '100.00', booking_amount_paid: '10.00', payment_ledger_net: '10.00', booking_charges_total: '0.00', active_booking_charge_net: '0.00', pos_net_total: '20.00', customer_credit_net: '0.00' },
    samples: { payment_mismatches: [{ booking_id: 'booking-1001', difference: 999 }], charge_mismatches: [], invoice_gaps: [], duplicate_invoices: [], orphan_invoices: [], folio_pos_mismatches: [], pos_return_mismatches: [], credit_mismatches: [], pos_void_mismatches: [] },
    sample_limit: 50,
    samples_truncated: false,
    ...overrides
  }
}

test('complete reconciliation comes from the server snapshot and preserves exact counts above old caps', async (t) => {
  const calls = setup(t, completeSnapshot())
  const result = await finance.getFinancialReconciliation()
  assert.equal(calls.length, 1, 'one server statement must define the full consistent reconciliation snapshot')
  assert.equal(calls[0].name, 'get_financial_reconciliation_v1')
  assert.equal(calls[0].args.p_lodge_id, LODGE)
  assert.equal(result.valid, false, 'the mismatch beyond row 1000 must make the result invalid')
  assert.equal(result.complete, true)
  assert.equal(result.summary.paymentMismatches, 1)
  assert.equal(result.examined_counts.bookings, 1001)
  assert.equal(result.paymentMismatches[0].booking_id, 'booking-1001')
})

test('incomplete or malformed snapshots can never report a healthy zero-mismatch result', async (t) => {
  setup(t, completeSnapshot({ complete: false, examined_counts: null, mismatch_counts: null, totals: null, samples: null }))
  const result = await finance.getFinancialReconciliation()
  assert.equal(result.valid, false)
  assert.equal(result.complete, false)
  assert.equal(result.unavailable, true)
  assert.equal(result.complete, false)
})

test('statement timeout is explicitly unavailable and never a current healthy result', async (t) => {
  const calls = setup(t, null)
  state.supabase.rpc = async (name, args) => {
    calls.push({ name, args })
    return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
  }
  const result = await finance.getFinancialReconciliation()
  assert.equal(result.valid, false)
  assert.equal(result.complete, false)
  assert.equal(result.unavailable, true)
  assert.equal(result.timeout, true)
  assert.match(result.message, /timed out/i)
  assert.equal(calls[0].name, 'get_financial_reconciliation_v1')
})
test('permission, timeout, offline and scope failures remain unavailable instead of zero', async (t) => {
  const calls = setup(t, null)
  state.supabase.rpc = async (name, args) => {
    calls.push({ name, args })
    return { data: null, error: { code: '42501', message: 'permission denied' } }
  }
  const result = await finance.getFinancialReconciliation()
  assert.equal(result.valid, false)
  assert.equal(result.unavailable, true)
  assert.match(result.message, /permission|access|rerun/i)
})

test('reconciliation covers event-folio POS charges and void state', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261005030000_luna_financial_reconciliation_v1.sql', import.meta.url), 'utf8')
  assert.match(sql, /event_booking_line_items/i, 'event folio receipts must be reconciled against their authoritative event ledger row')
  assert.match(sql, /event_booking_id/i, 'event folio scope must be validated in the same lodge')
  assert.match(sql, /voided_at/i, 'event folio charge state must be checked against POS void state')
})