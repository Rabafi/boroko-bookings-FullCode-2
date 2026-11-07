import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalBalanceSheetApi } from '../../src/renderer/src/components/restaurant-accounting/barLocalBalanceSheetApi.js'

const scope = { businessId: '11111111-1111-4111-8111-111111111111', outletId: '22222222-2222-4222-8222-222222222222', staffId: '33333333-3333-4333-8333-333333333333' }
const accounts = [
  { account_code: '1000', name: 'Cash', type: 'asset', active: true, version: 1 },
  { account_code: '2000', name: 'Payables', type: 'liability', active: true, version: 1 },
  { account_code: '3000', name: 'Equity', type: 'equity', active: true, version: 1 },
  { account_code: '4000', name: 'Sales', type: 'revenue', active: true, version: 1 },
  { account_code: '5000', name: 'Costs', type: 'expense', active: true, version: 1 }
]
const journals = [{ id: '44444444-4444-4444-8444-444444444444', entry_date: '2026-01-15', description: 'January activity', lines: [
  { account_code: '1000', debit: '100.00', credit: '0.00' }, { account_code: '4000', debit: '0.00', credit: '100.00' },
  { account_code: '5000', debit: '20.00', credit: '0.00' }, { account_code: '1000', debit: '0.00', credit: '20.00' }
] }]

function bridge({ wrongScope = false, changingWatermark = false } = {}) {
  let calls = 0
  return { async query(name) {
    calls += 1
    return { data: name === 'accounting.accounts.list' ? accounts : journals, complete: true, unavailable: [],
      pagination: { has_more: false, next_cursor: null }, snapshot_watermark: changingWatermark ? calls : 9,
      scope: { business_id: scope.businessId, outlet_id: wrongScope ? '99999999-9999-4999-8999-999999999999' : scope.outletId, actor_staff_id: scope.staffId } }
  } }
}

test('local financial statements balance and derive income from the complete outlet journal snapshot', async () => {
  const result = await createBarLocalBalanceSheetApi(bridge(), scope).load('2026-01-01', '2026-01-31')
  assert.equal(result.balance_sheet.assets_total, '80.00')
  assert.equal(result.balance_sheet.current_period_earnings, '80.00')
  assert.equal(result.balance_sheet.difference, '0.00')
  assert.equal(result.income_statement.revenue_total, '100.00')
  assert.equal(result.income_statement.expense_total, '20.00')
  assert.equal(result.cash_flow_available, false)
})

test('local financial statements reject invalid range, foreign scope and changing snapshots', async () => {
  const api = createBarLocalBalanceSheetApi(bridge(), scope)
  await assert.rejects(api.load('2026-02-01', '2026-01-01'), /valid financial statement date range/)
  await assert.rejects(createBarLocalBalanceSheetApi(bridge({ wrongScope: true }), scope).load('2026-01-01', '2026-01-31'), /another Bar session/)
  await assert.rejects(createBarLocalBalanceSheetApi(bridge({ changingWatermark: true }), scope).load('2026-01-01', '2026-01-31'), /changed while the statement was loading/)
})
