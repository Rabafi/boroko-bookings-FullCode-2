import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalBankReconciliationApi } from '../../src/renderer/src/components/restaurant-accounting/barLocalBankReconciliationApi.js'

const scope = {
  businessId: '11111111-1111-4111-8111-111111111111',
  outletId: '22222222-2222-4222-8222-222222222222',
  staffId: '33333333-3333-4333-8333-333333333333'
}
const ids = {
  account: '44444444-4444-4444-8444-444444444444',
  line: '55555555-5555-4555-8555-555555555555',
  payment: '66666666-6666-4666-8666-666666666666',
  paymentEntry: '77777777-7777-4777-8777-777777777777',
  journalEntry: '88888888-8888-4888-8888-888888888888'
}
const metadata = (watermark = 12) => ({
  complete: true,
  unavailable: [],
  snapshot_watermark: watermark,
  scope: { business_id: scope.businessId, outlet_id: scope.outletId, actor_staff_id: scope.staffId },
  pagination: { has_more: false, next_cursor: null }
})

function fakeBridge({ wrongScope = false, changingWatermark = false } = {}) {
  const account = { id: ids.account, name: 'Operating bank', institution: 'Example Bank', account_number: '1234', account_code: '1000', active: true, version: 1 }
  const line = { id: ids.line, bank_account_id: ids.account, statement_date: '2026-11-05', external_ref: 'BANK-001', description: 'Supplier payment', amount: '-45.00' }
  const payment = { id: ids.payment, journal_entry_id: ids.paymentEntry, payment_account_code: '1000', payment_date: '2026-11-05', reference: 'SUP-1', amount: '45.00', status: 'posted', reverses_payment_id: null }
  const journals = [
    { id: ids.paymentEntry, entry_date: '2026-11-05', description: 'Supplier payment', source_type: 'ap_payment', lines: [{ id: 'line-a', account_code: '1000', debit: '0.00', credit: '45.00' }] },
    { id: ids.journalEntry, entry_date: '2026-11-04', description: 'Cash withdrawal', source_type: 'manual', lines: [{ id: 'line-b', account_code: '1000', debit: '0.00', credit: '45.00' }] }
  ]
  let calls = 0
  return {
    async query(name, filters) {
      calls += 1
      const watermark = changingWatermark ? calls : 12
      const result = metadata(watermark)
      if (wrongScope) result.scope.outlet_id = '99999999-9999-4999-8999-999999999999'
      if (name === 'accounting.accounts.list') result.data = [{ account_code: '1000', name: 'Bank', type: 'asset', active: true, version: 1, balance: '0.00' }]
      else if (name === 'accounting.journal_entries') result.data = journals
      else if (name === 'accounting.records') {
        result.data = ({ bank_accounts: [account], bank_statement_lines: [line], bank_reconciliations: [], ap_payments: [payment] })[filters.kind] || []
      } else throw new Error(`Unexpected local query: ${name}`)
      return result
    },
    async command() { throw new Error('Not used by this query-only fixture') }
  }
}

test('original Bank Reconciliation loads complete same-scope local evidence and suggests exact matches only', async () => {
  const api = createBarLocalBankReconciliationApi(fakeBridge(), scope)
  const data = await api.load()
  assert.equal(data.snapshot_watermark, 12)
  assert.equal(data.ledgerAccounts[0].code, '1000')
  assert.deepEqual(api.getCandidates(data, ids.line).map(({ type, id }) => ({ type, id })), [
    { type: 'ap_payment', id: ids.payment },
    { type: 'journal', id: ids.journalEntry }
  ])
})

test('local bank adapter rejects wrong outlet scope and inconsistent cross-query snapshots', async () => {
  await assert.rejects(createBarLocalBankReconciliationApi(fakeBridge({ wrongScope: true }), scope).load(), /another Bar session/)
  await assert.rejects(createBarLocalBankReconciliationApi(fakeBridge({ changingWatermark: true }), scope).load(), /changed while the bank workspace was loading/)
})

test('local bank adapter rejects a statement line already reconciled or with no exact posted match', async () => {
  const api = createBarLocalBankReconciliationApi(fakeBridge(), scope)
  const data = await api.load()
  assert.throws(() => api.getCandidates(data, '99999999-9999-4999-8999-999999999999'), /missing or already reconciled/)
  data.journals = []
  data.payments = []
  assert.deepEqual(api.getCandidates(data, ids.line), [])
})

test('local bank commands keep the original operation ID and payload after an ambiguous reply', async () => {
  const previousStorage = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
  const calls = []
  let open = []
  const api = createBarLocalBankReconciliationApi({
    async query() { throw new Error('Not used by command recovery fixture') },
    async getOpenIntents() { return open },
    async command(envelope) {
      calls.push(envelope)
      open = [{ operation_id: envelope.operation_id, command: envelope.command }]
      return { outcome: 'unknown' }
    },
    async retryOperation(operationId) {
      calls.push({ operation_id: operationId, retry: true })
      open = []
      return { outcome: 'committed_local' }
    }
  }, scope)
  const payload = { bank_account_id: ids.account, lines: [{ external_ref: 'R-1', statement_date: '2026-11-05', amount: '10.00', description: 'Deposit' }] }
  try {
    await assert.rejects(api.submit('accounting.bank_statement.import', payload, 'statement:retry-fixture'), /unresolved/)
    const operationId = calls[0].operation_id
    assert.match(operationId, /^[0-9a-f-]{36}$/i)
    await assert.rejects(api.submit('accounting.bank_statement.import', { ...payload, bank_account_id: ids.payment }, 'statement:retry-fixture'), /different details/)
    const result = await api.submit('accounting.bank_statement.import', payload, 'statement:retry-fixture')
    assert.equal(result.outcome, 'committed_local')
    assert.deepEqual(calls, [
      { command: 'accounting.bank_statement.import', payload, operation_id: operationId },
      { operation_id: operationId, retry: true }
    ])
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previousStorage
  }
})

