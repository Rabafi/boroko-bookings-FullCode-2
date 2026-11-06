import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalTaxReturnsApi } from '../../src/renderer/src/components/restaurant-accounting/barLocalTaxReturnsApi.js'

const scope = { businessId: '11111111-1111-4111-8111-111111111111', outletId: '22222222-2222-4222-8222-222222222222', staffId: '33333333-3333-4333-8333-333333333333' }
const codeId = '44444444-4444-4444-8444-444444444444'
const returnId = '55555555-5555-4555-8555-555555555555'
const hash = 'a'.repeat(64)

function response(data, watermark = 20) {
  return { complete: true, unavailable: [], data, snapshot_watermark: watermark,
    pagination: { has_more: false, next_cursor: null },
    scope: { business_id: scope.businessId, outlet_id: scope.outletId, actor_staff_id: scope.staffId } }
}

function bridge({ wrongScope = false, changingWatermark = false } = {}) {
  let queryCount = 0
  return {
    async query(_name, filters) {
      queryCount += 1
      const result = response(filters.kind === 'tax_codes'
        ? [{ id: codeId, code: 'VAT', name: 'VAT standard', rate: '0.1400', active: true, version: 2 }]
        : [{ id: returnId, period: '2026-10', period_start: '2026-10-01', period_end: '2026-10-31', output_tax: '100.00', input_tax: '20.00', net_due: '80.00', status: 'draft', statutory_submission: 'external_required', snapshot_hash: hash, revision: 1 }], changingWatermark ? queryCount : 20)
      if (wrongScope) result.scope.outlet_id = '99999999-9999-4999-8999-999999999999'
      return result
    },
    async command() { return { outcome: 'committed_local' } },
    async getOpenIntents() { return [] },
    async retryOperation() { return { outcome: 'committed_local' } }
  }
}

test('local tax adapter loads complete, matching outlet snapshots and validates draft/hash fields', async () => {
  const data = await createBarLocalTaxReturnsApi(bridge(), scope).load()
  assert.equal(data.codes[0].rate, '0.1400')
  assert.equal(data.returns[0].net_due, '80.00')
  assert.equal(data.returns[0].snapshot_hash, hash)
})

test('local tax adapter rejects wrong scope, changing watermarks and malformed rates', async () => {
  await assert.rejects(createBarLocalTaxReturnsApi(bridge({ wrongScope: true }), scope).load(), /another Bar session/)
  await assert.rejects(createBarLocalTaxReturnsApi(bridge({ changingWatermark: true }), scope).load(), /changed while loading/)
  const invalid = bridge()
  invalid.query = async (_name, filters) => response(filters.kind === 'tax_codes'
    ? [{ id: codeId, code: 'VAT', name: 'VAT', rate: '1.0001', active: true, version: 1 }]
    : [])
  await assert.rejects(createBarLocalTaxReturnsApi(invalid, scope).load(), /invalid record/)
})

test('local tax draft commands accept only supported command and stable operation identity', async () => {
  const calls = []
  const storage = globalThis.localStorage
  const saved = new Map()
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }
  const b = bridge()
  b.command = async envelope => { calls.push(envelope); return { outcome: 'committed_local' } }
  try {
    const api = createBarLocalTaxReturnsApi(b, scope)
    await assert.rejects(api.submit('accounting.tax_return.approve', { period: '2026-10' }, 'return:2026-10'), /invalid and was not submitted/)
    const result = await api.submit('accounting.tax_return.prepare', { period: '2026-10' }, 'return:2026-10')
    assert.equal(result.outcome, 'committed_local')
    assert.equal(calls[0].command, 'accounting.tax_return.prepare')
    assert.equal(calls[0].payload.period, '2026-10')
    assert.match(calls[0].operation_id, /^[0-9a-f-]{36}$/i)
    assert.equal(saved.size, 0)
  } finally {
    if (storage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = storage
  }
})
