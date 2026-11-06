import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalBudgetsApi } from '../../src/renderer/src/components/restaurant-accounting/barLocalBudgetsApi.js'

const scope = { businessId: '11111111-1111-4111-8111-111111111111', outletId: '22222222-2222-4222-8222-222222222222', staffId: '33333333-3333-4333-8333-333333333333' }
const budgetId = '44444444-4444-4444-8444-444444444444'
const journalId = '55555555-5555-4555-8555-555555555555'
const budget = { id: budgetId, name: 'Annual plan', period_start: '2026-01-01', period_end: '2026-12-31', active: true, version: 2,
  lines: [{ account_code: '4000', amount: '150.00', description: 'Sales' }, { account_code: '5000', amount: '50.00', description: 'Kitchen' }] }
const accounts = [
  { account_code: '4000', name: 'Sales', type: 'revenue', active: true, version: 1, balance: '0.00' },
  { account_code: '5000', name: 'Kitchen', type: 'expense', active: true, version: 1, balance: '0.00' }
]

function fixture({ wrongScope = false, changingWatermark = false } = {}) {
  let calls = 0
  return {
    async query(name, filters) {
      calls += 1
      const watermark = changingWatermark ? calls : 40
      const data = name === 'accounting.accounts.list' ? accounts
        : name === 'accounting.journal_entries' ? [{ id: journalId, entry_date: '2026-06-01', description: 'Sale', lines: [
          { account_code: '4000', debit: '0.00', credit: '100.00' }, { account_code: '5000', debit: '30.00', credit: '0.00' }
        ] }]
        : filters.record_id ? [{ ...budget }] : [{ id: budgetId, name: budget.name, period_start: budget.period_start, period_end: budget.period_end, active: true, version: budget.version }]
      return { data, complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null }, snapshot_watermark: watermark,
        scope: { business_id: scope.businessId, outlet_id: wrongScope ? '99999999-9999-4999-8999-999999999999' : scope.outletId, actor_staff_id: scope.staffId } }
    },
    async command() { return { outcome: 'committed_local' } },
    async getOpenIntents() { return [] },
    async retryOperation() { return { outcome: 'committed_local' } }
  }
}

test('local budget detail combines complete same-outlet journal actuals using normal account balances', async () => {
  const api = createBarLocalBudgetsApi(fixture(), scope)
  const snapshot = await api.load()
  assert.equal(snapshot.budgets[0].id, budgetId)
  assert.deepEqual(snapshot.accounts.map(row => row.code), ['4000', '5000'])
  const detail = await api.loadBudget(budgetId)
  assert.equal(detail.lines[0].actual_amount, '100.00')
  assert.equal(detail.lines[0].variance, '-50.00')
  assert.equal(detail.lines[1].actual_amount, '30.00')
  assert.equal(detail.lines[1].variance, '-20.00')
})

test('local budget adapter refuses foreign scope, changing snapshots and invalid writes', async () => {
  await assert.rejects(createBarLocalBudgetsApi(fixture({ wrongScope: true }), scope).load(), /another Bar session/)
  await assert.rejects(createBarLocalBudgetsApi(fixture({ changingWatermark: true }), scope).load(), /changed while budgets were loading/)
  const api = createBarLocalBudgetsApi(fixture(), scope)
  await assert.rejects(api.submit({ ...budget, lines: [{ account_code: '4000', amount: '-1.00' }] }, 'budget:bad'), /non-negative amount/)
})

test('local budget upsert retains an operation ID and exact payload through the command bridge', async () => {
  const previous = globalThis.localStorage
  const values = new Map(), commands = []
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const bridge = fixture()
  bridge.command = async envelope => { commands.push(envelope); return { outcome: 'committed_local' } }
  try {
    const api = createBarLocalBudgetsApi(bridge, scope)
    const payload = { name: 'Annual plan', period_start: '2026-01-01', period_end: '2026-12-31', active: true, lines: [{ account_code: '4000', amount: '150.00' }] }
    const result = await api.submit(payload, 'annual-plan:v0')
    assert.equal(result.outcome, 'committed_local')
    assert.equal(commands[0].command, 'accounting.budget.upsert')
    assert.deepEqual(commands[0].payload, payload)
    assert.match(commands[0].operation_id, /^[0-9a-f-]{36}$/i)
    assert.equal(values.size, 0)
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
})
