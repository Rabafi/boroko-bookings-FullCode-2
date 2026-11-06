import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalAccountsPayableApi } from '../../src/renderer/src/components/restaurant-accounting/barLocalAccountsPayableApi.js'

const scope = { business_id: '11111111-1111-4111-8111-111111111111', outlet_id: '22222222-2222-4222-8222-222222222222', actor_staff_id: '33333333-3333-4333-8333-333333333333', device_id: '44444444-4444-4444-8444-444444444444' }
const invoiceId = '55555555-5555-4555-8555-555555555555'
const supplierId = '66666666-6666-4666-8666-666666666666'
const operationId = '88888888-8888-4888-8888-888888888888'
const paymentOperationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const base = {
  ap_invoices: [{ id: invoiceId, supplier_id: supplierId, invoice_number: 'INV-1', invoice_date: '2026-11-01', due_date: '2026-12-01', total: '100.00', status: 'approved' }],
  ap_payments: [{ id: '77777777-7777-4777-8777-777777777777', ap_invoice_id: invoiceId, amount: '25.00', status: 'posted' }],
  suppliers: [{ id: supplierId, name: 'Local Supplier', active: true }],
  accounts: [{ account_code: '5000', name: 'Food purchases', type: 'expense', active: true }, { account_code: '2100', name: 'Accounts payable', type: 'liability', active: true }],
  invoiceLines: [{ description: 'Produce', expense_account_code: '5000', quantity: '2', unit_price: '50.00', tax_rate: '0.00' }]
}

function fixture({ wrongOutlet = false, watermarkFor = () => 7 } = {}) {
  const calls = []
  return {
    calls,
    query: async (name, filters) => {
      calls.push([name, filters])
      if (name === 'accounting.accounts.list') return { data: base.accounts, complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null }, snapshot_watermark: watermarkFor('accounts'), scope }
      const kind = filters.kind
      const rows = filters.record_id ? [{ ...base.ap_invoices[0], lines: base.invoiceLines }] : base[kind]
      return {
        data: rows, complete: true, unavailable: [], pagination: { has_more: false, next_cursor: null },
        snapshot_watermark: watermarkFor(kind),
        scope: { ...scope, ...(wrongOutlet && kind === 'ap_invoices' ? { outlet_id: '99999999-9999-4999-8999-999999999999' } : {}) }
      }
    }
  }
}

const api = bridge => createBarLocalAccountsPayableApi(bridge, { businessId: scope.business_id, outletId: scope.outlet_id, staffId: scope.actor_staff_id })

test('original Accounts Payable adapter derives outstanding values from one complete local snapshot', async () => {
  const bridge = fixture()
  const result = await api(bridge).load()
  assert.equal(result.bills[0].supplier_name, 'Local Supplier')
  assert.equal(result.bills[0].outstanding, 75)
  assert.equal(result.bills[0].status, 'partially_paid')
  assert.equal(result.summary.total_outstanding, 75)
  assert.equal(result.summary.open_bills, 1)
  assert.equal(result.accounts[0].code, '5000')
  assert.equal(result.bills[0].items[0].description, 'Produce')
  assert.equal(bridge.calls.length, 5)
  assert.equal(bridge.calls.filter(([name]) => name === 'accounting.records').length, 4)
})

test('Accounts Payable creates only an idempotent local invoice draft with server-derived line totals', async () => {
  const previousStorage = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  try {
  const commands = []
  const bridge = fixture()
  bridge.getOpenIntents = async () => []
  bridge.command = async (request) => { commands.push(request); return { outcome: 'committed_local', result: { id: invoiceId } } }
  const result = await api(bridge).createDraft({
    supplier_id: supplierId, invoice_number: 'INV-2', invoice_date: '2026-11-01', due_date: '2026-12-01',
    payable_account_code: '2100', tax_account_code: '1150',
    lines: [{ description: 'Produce', quantity: 2, unit_cost: 10.25, tax_rate: 0.14, expense_account_id: '5000' }]
  }, operationId)
  assert.equal(result.outcome, 'committed_local')
  assert.equal(commands.length, 1)
  assert.equal(commands[0].command, 'accounting.ap.invoice.upsert')
  assert.equal(commands[0].operation_id, operationId)
  assert.equal(commands[0].payload.subtotal, '20.50')
  assert.equal(commands[0].payload.tax_total, '2.87')
  assert.equal(commands[0].payload.total, '23.37')
  assert.throws(() => api(bridge).createDraft({ supplier_id: supplierId, invoice_number: 'INV-3', invoice_date: '2026-11-01', payable_account_code: '2100', lines: [{ description: 'x', quantity: 1, unit_cost: 1, tax_rate: 0.14, expense_account_id: '5000' }] }, operationId), /tax account/)
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previousStorage
  }
})

test('local AP approvals reuse the stored proof and original operation after an ambiguous command failure', async () => {
  const previousStorage = globalThis.localStorage
  const values = new Map()
  globalThis.localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  try {
    let approvalCalls = 0
    let commandCalls = 0
    const payload = { invoice_id: invoiceId }
    const bridge = {
      query: async () => ({}),
      getOpenIntents: async () => [],
      requestApprovalForCommand: async request => { approvalCalls += 1; assert.match(request.pin, /^\d{4}$/); return { approval_id: '99999999-9999-4999-8999-999999999999' } },
      command: async request => {
        commandCalls += 1
        assert.equal(request.payload.approval_id, '99999999-9999-4999-8999-999999999999')
        if (request.command === 'accounting.ap.payment.post') {
          assert.equal(request.payload.amount, '50.00')
          assert.equal(request.payload.payment_account_code, '1000')
          assert.equal(request.payload.method, 'bank')
        }
        if (commandCalls === 1) throw new Error('simulated lost response')
        return { outcome: 'committed_local', result: { invoice_id: invoiceId } }
      },
      retryOperation: async () => ({ outcome: 'committed_local', result: { invoice_id: invoiceId } })
    }
    const payable = api(bridge)
    await assert.rejects(payable.approveInvoice(invoiceId, '1234', operationId), /simulated lost response/)
    const recovered = await payable.approveInvoice(invoiceId, '', operationId)
    assert.equal(recovered.outcome, 'committed_local')
    assert.equal(approvalCalls, 1)
    assert.equal(commandCalls, 2)
    const paid = await payable.postPayment({ invoice_id: invoiceId, payment_date: '2026-11-05', amount: '50', payment_account_code: '1000', method: 'bank' }, '5678', paymentOperationId)
    assert.equal(paid.outcome, 'committed_local')
    assert.equal(approvalCalls, 2)
    assert.equal(commandCalls, 3)
    assert.equal(values.size, 0)
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previousStorage
  }
})

test('Accounts Payable fails closed on wrong outlet, incomplete lists and cross-list snapshot drift', async () => {
  await assert.rejects(api(fixture({ wrongOutlet: true })).load(), /scope/)
  await assert.rejects(api({ query: async () => ({ complete: false, data: [], scope, snapshot_watermark: 1, pagination: { has_more: false } }) }).load(), /incomplete/)
  let reads = 0
  const changing = fixture({ watermarkFor: () => (++reads % 3 === 0) ? 8 : 7 })
  await assert.rejects(api(changing).load(), /changed during both snapshot attempts/)
})
