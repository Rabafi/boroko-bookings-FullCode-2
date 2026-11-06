import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalGeneralLedgerApi } from '../../src/renderer/src/components/restaurant-accounting/barLocalGeneralLedgerApi.js'

const scope = { businessId: 'business-a', outletId: 'outlet-a', staffId: 'staff-a' }
const metadata = (watermark = 7) => ({ complete: true, snapshot_watermark: watermark,
  scope: { business_id: scope.businessId, outlet_id: scope.outletId, actor_staff_id: scope.staffId } })
const journal = { id: 'entry-a', entry_date: '2026-11-05', description: 'Opening balance',
  source_type: 'opening_balance', source_id: null, posting_key: 'operation-a', reference_number: null,
  lines: [{ id: '1', account_code: '1000', account_name: 'Cash', debit: '10.00', credit: '0.00' }] }

test('original General Ledger adapter loads a scoped, consistent local journal and trial-balance snapshot', async () => {
  const calls = []
  const api = createBarLocalGeneralLedgerApi({ async query(name, filters) {
    calls.push([name, filters])
    if (name === 'accounting.journal_entries') return { ...metadata(), data: [journal], pagination: { next_cursor: null, has_more: false } }
    return { ...metadata(), data: [{ account_code: '1000', name: 'Cash', debit: '10.00', credit: '0.00', balance: '10.00' }] }
  } }, scope)

  const result = await api.loadFirstPage({ from: '2026-11-01', to: '2026-11-30', account_code: '1000' })
  assert.deepEqual(result.entries, [journal])
  assert.equal(result.has_more, false)
  assert.deepEqual(result.trialBalance, [{ account_code: '1000', name: 'Cash', debit: 10, credit: 0,
    balance: 10, account_id: '1000', code: '1000' }])
  assert.deepEqual(calls, [
    ['accounting.journal_entries', { from: '2026-11-01', to: '2026-11-30', account_code: '1000', limit: 100 }],
    ['accounting.trial_balance', { from: '2026-11-01', to: '2026-11-30' }]
  ])
})

test('ledger snapshot retries once when concurrent commits split journal and trial-balance reads', async () => {
  let balanceReads = 0
  const api = createBarLocalGeneralLedgerApi({ async query(name) {
    if (name === 'accounting.journal_entries') return { ...metadata(2), data: [], pagination: { next_cursor: null, has_more: false } }
    balanceReads += 1
    return { ...metadata(balanceReads === 1 ? 1 : 2), data: [] }
  } }, scope)
  assert.equal((await api.loadFirstPage({ from: '2026-11-01', to: '2026-11-30' })).snapshot_watermark, 2)
  assert.equal(balanceReads, 2)
})

test('ledger and trial-balance data fail closed on scope or journal-line corruption', async () => {
  const wrongScopeApi = createBarLocalGeneralLedgerApi({ async query(name) {
    const row = metadata()
    if (name === 'accounting.trial_balance') row.scope.outlet_id = 'outlet-b'
    return name === 'accounting.journal_entries'
      ? { ...row, data: [], pagination: { next_cursor: null, has_more: false } }
      : { ...row, data: [] }
  } }, scope)
  await assert.rejects(wrongScopeApi.loadFirstPage({ from: '2026-11-01', to: '2026-11-30' }), /another Bar session/)

  const corruptApi = createBarLocalGeneralLedgerApi({ async query(name) {
    return name === 'accounting.journal_entries'
      ? { ...metadata(), data: [{ ...journal, lines: [{ id: '1', account_code: '1000', account_name: 'Cash', debit: 'NaN', credit: '0.00' }] }], pagination: { next_cursor: null, has_more: false } }
      : { ...metadata(), data: [] }
  } }, scope)
  await assert.rejects(corruptApi.loadFirstPage({ from: '2026-11-01', to: '2026-11-30' }), /invalid journal line/)
})

test('ledger page rejects snapshot drift and requires the same watermark when paging', async () => {
  const api = createBarLocalGeneralLedgerApi({ async query(name) {
    return name === 'accounting.journal_entries'
      ? { ...metadata(8), data: [], pagination: { next_cursor: null, has_more: false } }
      : { ...metadata(7), data: [] }
  } }, scope)
  await assert.rejects(api.loadFirstPage({ from: '2026-11-01', to: '2026-11-30' }), /changed while its totals were loading/)
})

test('ledger pagination carries the stable cursor and refuses a newer snapshot', async () => {
  const calls = []
  let ledgerCalls = 0
  const api = createBarLocalGeneralLedgerApi({ async query(name, filters) {
    calls.push([name, filters])
    if (name === 'accounting.trial_balance') return { ...metadata(), data: [] }
    ledgerCalls += 1
    return { ...metadata(ledgerCalls === 1 ? 7 : 8), data: [],
      pagination: ledgerCalls === 1 ? { next_cursor: '2026-11-05|entry-a', has_more: true } : { next_cursor: null, has_more: false } }
  } }, scope)
  const first = await api.loadFirstPage({ from: '2026-11-01', to: '2026-11-30' })
  assert.equal(first.has_more, true)
  assert.equal(first.next_cursor, '2026-11-05|entry-a')
  const second = await api.readNextPage({ from: '2026-11-01', to: '2026-11-30', cursor: first.next_cursor })
  assert.equal(second.snapshot_watermark, 8)
  assert.deepEqual(calls.at(-1), ['accounting.journal_entries', {
    from: '2026-11-01', to: '2026-11-30', limit: 100, cursor: '2026-11-05|entry-a'
  }])
})
