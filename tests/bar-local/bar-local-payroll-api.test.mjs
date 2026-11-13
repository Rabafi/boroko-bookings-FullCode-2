import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalPayrollApi } from '../../src/renderer/src/components/restaurant-accounting/barLocalPayrollApi.js'

const scope = {
  business_id: '11111111-1111-4111-8111-111111111111',
  outlet_id: '22222222-2222-4222-8222-222222222222',
  actor_staff_id: '33333333-3333-4333-8333-333333333333'
}
const runId = '44444444-4444-4444-8444-444444444444'
const run = {
  id: runId, period_start: '2026-11-01', period_end: '2026-11-30', pay_date: '2026-12-05',
  status: 'prepared', version: 2, gross_total: '1000.00', deductions_total: '100.00', net_total: '900.00',
  snapshot_hash: 'a'.repeat(64), journal_entry_id: null, payment_status: 'external_required', filing_status: 'external_required'
}
const lines = [{ employee_ref: 'STAFF-001', gross: '1000.00', deductions: '100.00', net: '900.00' }]
const accounts = [
  { account_code: '6000', name: 'Payroll expense', type: 'expense', active: true, version: 1 },
  { account_code: '2100', name: 'Payroll payable', type: 'liability', active: true, version: 1 }
]

function storage() {
  const values = new Map()
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) }
  }
}

function bridge(overrides = {}) {
  const calls = { queries: [], commands: [], retries: [], approvals: [] }
  const value = {
    async query(name, filters) {
      calls.queries.push([name, filters])
      const row = name === 'accounting.accounts.list' ? accounts : filters.record_id ? [{ ...run, lines }] : []
      return { data: row, complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null }, scope, snapshot_watermark: 17 }
    },
    async command(request) { calls.commands.push(request); return { outcome: 'committed_local', result: { payroll_run_id: runId } } },
    async getOpenIntents() { return [] },
    async retryOperation(id) { calls.retries.push(id); return { outcome: 'committed_local', result: { payroll_run_id: runId } } },
    async requestApprovalForCommand(request) { calls.approvals.push(request); return { approval_id: '55555555-5555-4555-8555-555555555555' } },
    ...overrides
  }
  return { value, calls }
}

function makeApi(b) {
  return createBarLocalPayrollApi(b.value, { businessId: scope.business_id, outletId: scope.outlet_id, staffId: scope.actor_staff_id })
}

test('local payroll reads complete scoped runs, chart accounts and manager-only line detail', async () => {
  const b = bridge({
    async query(name, filters) {
      b.calls.queries.push([name, filters])
      const rows = name === 'accounting.accounts.list' ? accounts : filters.record_id ? [{ ...run, lines }] : [run]
      return { data: rows, complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null }, scope, snapshot_watermark: 17 }
    }
  })
  const api = makeApi(b)
  const snapshot = await api.load()
  assert.equal(snapshot.runs[0].id, runId)
  assert.equal(snapshot.accounts.length, 2)
  assert.equal(snapshot.snapshot_watermark, 17)
  const detail = await api.getRun(runId, 17)
  assert.deepEqual(detail.lines, lines)
  assert.ok(b.calls.queries.some(([name, filters]) => name === 'accounting.records' && filters.record_id === runId))
})

test('local payroll refuses a result from a different outlet or operator', async () => {
  const b = bridge({ async query() { return { data: [run], complete: true, unavailable: [], pagination: { has_more: false }, scope: { ...scope, outlet_id: '99999999-9999-4999-8999-999999999999' }, snapshot_watermark: 17 } } })
  await assert.rejects(makeApi(b).load(), /different Bar session or outlet/)
})

test('ambiguous draft creation retries the exact saved payroll command and ID', async () => {
  const store = storage(), requests = [], retryIds = []
  let open = []
  const b = bridge({
    async command(request) { requests.push(request); return { outcome: 'unknown' } },
    async getOpenIntents() { return open },
    async retryOperation(id) { retryIds.push(id); return { outcome: 'committed_local', result: { payroll_run_id: runId } } }
  })
  const api = makeApi(b)
  const payload = {
    period_start: '2026-11-01', period_end: '2026-11-30', pay_date: '2026-12-05',
    expense_account_code: '6000', payable_account_code: '2100', deductions_account_code: '',
    lines: [{ employee_ref: 'STAFF-001', gross: '1000', deductions: '100' }]
  }
  await assert.rejects(api.create(store, payload), /unresolved/)
  const pending = api.pending(store)
  assert.ok(pending)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].payload.lines[0].gross, '1000.00')
  open = [{ operation_id: pending.operation_id, command: 'accounting.payroll_run.create' }]
  const result = await api.retry(store)
  assert.equal(result.outcome, 'committed_local')
  assert.deepEqual(retryIds, [pending.operation_id])
  assert.equal(api.pending(store), null)
})

test('payroll finalisation retains the manager approval and reuses it after an ambiguous reply', async () => {
  const store = storage(), commands = [], approvals = [], retryIds = []
  let open = []
  const b = bridge({
    async requestApprovalForCommand(request) { approvals.push(request); return { approval_id: '55555555-5555-4555-8555-555555555555' } },
    async command(request) { commands.push(request); return { outcome: 'unknown' } },
    async getOpenIntents() { return open },
    async retryOperation(id) { retryIds.push(id); return { outcome: 'committed_local', result: { payroll_run_id: runId } } }
  })
  const api = makeApi(b)
  await assert.rejects(api.finalise(store, run, '1234'), /unresolved/)
  const saved = api.pending(store)
  assert.ok(saved?.approval_id)
  assert.equal(approvals.length, 1)
  assert.equal(commands[0].payload.approval_id, saved.approval_id)
  open = [{ operation_id: saved.operation_id, command: 'accounting.payroll_run.finalise' }]
  const result = await api.retry(store)
  assert.equal(result.outcome, 'committed_local')
  assert.deepEqual(retryIds, [saved.operation_id])
  assert.equal(api.pending(store), null)
})
