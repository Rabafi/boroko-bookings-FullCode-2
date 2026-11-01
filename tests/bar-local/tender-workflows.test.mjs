import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addTenderRow,
  centsToMoney,
  evaluateTenders,
  makeTenderRow,
  moneyToCents,
  removeTenderRow,
  updateTenderRow
} from '../../src/renderer/src/components/hospitality-pos/bar-local/tenderMath.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const workspace = join(root, 'src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx')
const client = join(root, 'src/main/bar-local/client.js')
const tenderEditor = join(root, 'src/renderer/src/components/hospitality-pos/bar-local/BarLocalTenderEditor.jsx')

test('money conversion round-trips exact minor units', () => {
  assert.equal(moneyToCents('11.46'), 1146)
  assert.equal(moneyToCents('0'), 0)
  assert.equal(moneyToCents('1.005'), null)
  assert.equal(moneyToCents('-1.00'), null)
  assert.equal(centsToMoney(1146), '11.46')
  assert.equal(centsToMoney(0), '0.00')
  assert.throws(() => centsToMoney(1.5), /whole minor units/)
})

test('a single blank cash tender fills the exact amount due', () => {
  const evaluation = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow()] })
  assert.equal(evaluation.error, '')
  assert.deepEqual(evaluation.tenders, [{ method: 'cash', amount: '25.00', tendered: '25.00', provider_status: 'not_applicable' }])
  assert.equal(evaluation.changeCents, 0)
})

test('split cash and card tenders balance with only locally asserted provider status', () => {
  const rows = [
    makeTenderRow({ method: 'cash', amount: '10.00', tendered: '20.00' }),
    makeTenderRow({ method: 'card', amount: '15.00', reference: 'AUTH-1', provider_status: 'locally_asserted' })
  ]
  const evaluation = evaluateTenders({ totalCents: 2500, rows })
  assert.equal(evaluation.error, '')
  assert.equal(evaluation.changeCents, 1000)
  assert.deepEqual(evaluation.tenders, [
    { method: 'cash', amount: '10.00', tendered: '20.00', provider_status: 'not_applicable' },
    { method: 'card', amount: '15.00', provider_status: 'locally_asserted', reference: 'AUTH-1' }
  ])
})

test('client cannot assert provider confirmation without a trusted integration', () => {
  const evaluation = evaluateTenders({ totalCents: 2500, rows: [
    makeTenderRow({ method: 'card', amount: '25.00', reference: 'AUTH-1', provider_status: 'provider_confirmed' })
  ] })
  assert.match(evaluation.error, /provider confirmation is unavailable/)
  assert.deepEqual(evaluation.tenders, [])
})

test('local room charges are refused with the required hotel-authority boundary', () => {
  const evaluation = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'room_charge', amount: '25.00', reference: 'ROOM-1' })] })
  assert.match(evaluation.error, /unavailable in local Bar.*hotel authority/)
  assert.deepEqual(evaluation.tenders, [])
})

test('Modern tender editor labels external status locally and offers no provider-confirmed control', () => {
  const source = readFileSync(tenderEditor, 'utf8')
  assert.match(source, /Recorded locally only/)
  assert.match(source, /cannot verify provider authorisation or settlement/)
  assert.doesNotMatch(source, /value="provider_confirmed"/)
  assert.match(source, /value="room_charge" disabled/)
  assert.match(source, /Room charges require the hotel authority/)
})

test('short, excess, and over-tendered non-cash tenders are refused with actionable errors', () => {
  const short = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'cash', amount: '10.00' })] })
  assert.match(short.error, /short by 15\.00/)
  assert.equal(short.tenders.length, 0)

  const excess = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'card', amount: '30.00', reference: 'A', provider_status: 'locally_asserted' })] })
  assert.match(excess.error, /exceed the amount due/)

  const shortTendered = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'cash', amount: '25.00', tendered: '20.00' })] })
  assert.match(shortTendered.error, /cannot be less than the cash amount applied/)

  const cashChangeOnCard = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'card', amount: '25.00', reference: 'A', provider_status: 'locally_asserted' })] })
  assert.equal(cashChangeOnCard.error, '')
})

test('non-cash tenders require the reference and authorisation evidence the contract demands', () => {
  const missingReference = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'bank_transfer', amount: '25.00', provider_status: 'locally_asserted' })] })
  assert.match(missingReference.error, /reference/)

  const missingStatus = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'mobile_money', amount: '25.00', reference: 'MM-1', provider_status: '' })] })
  assert.match(missingStatus.error, /provider confirmation is unavailable/)

  const missingCustomer = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'customer_credit', amount: '25.00' })] })
  assert.match(missingCustomer.error, /select the customer account/)

  const missingVoucher = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'voucher', amount: '25.00' })] })
  assert.match(missingVoucher.error, /voucher code/)
})

test('customer credit and voucher tenders carry their identifiers and normalize the voucher code', () => {
  const credit = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'customer_credit', amount: '25.00', customer_id: 'cust-1' })] })
  assert.equal(credit.error, '')
  assert.deepEqual(credit.tenders, [{ method: 'customer_credit', amount: '25.00', provider_status: 'not_applicable', customer_id: 'cust-1' }])

  const voucher = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'voucher', amount: '25.00', voucher_code: 'bar-10' })] })
  assert.equal(voucher.error, '')
  assert.deepEqual(voucher.tenders, [{ method: 'voucher', amount: '25.00', provider_status: 'not_applicable', voucher_code: 'BAR-10' }])
})

test('tender row helpers keep at least one row and cap the contract maximum', () => {
  let rows = [makeTenderRow()]
  rows = addTenderRow(rows, { method: 'card' })
  assert.equal(rows.length, 2)
  rows = updateTenderRow(rows, rows[1].id, { amount: '5.00' })
  assert.equal(rows[1].amount, '5.00')
  rows = removeTenderRow(rows, rows[0].id)
  assert.equal(rows.length, 1)
  assert.equal(removeTenderRow(rows, rows[0].id).length, 1)
})

test('the counter sale builds tenders from the shared evaluator and never authors payment state', () => {
  const source = readFileSync(workspace, 'utf8')
  assert.match(source, /evaluateTenders\(\{ totalCents, rows: saleTenderRows \}\)/)
  assert.match(source, /tenders: evaluation\.tenders/)
  assert.match(source, /onApprovedCommand=\{submitApprovedCommand\}/)
  assert.match(source, /requestApprovalForCommand\(\{ command, payload, pin: approvalPin, operation_id: operationId \}\)/)
  assert.doesNotMatch(source, /payment_status\s*:/)
  assert.doesNotMatch(source, /amount_paid/)
})

test('the workspace mounts the split-tender, tabs, and operations surfaces', () => {
  const source = readFileSync(workspace, 'utf8')
  assert.match(source, /<BarLocalTenderEditor/)
  assert.match(source, /<BarLocalTabsPanel/)
  assert.match(source, /<BarLocalOperationsPanel/)
  assert.match(source, /canUseStoreCredit=\{canUseCustomers\}/)
  assert.match(source, /canUseVoucher=\{canUseVouchers\}/)
})

test('approval-bearing commands remain allowlisted and mapped to a capability', () => {
  const source = readFileSync(client, 'utf8')
  for (const command of ['stock.adjust', 'stock.waste', 'purchase_order.create', 'purchase_order.cancel', 'voucher.issue', 'expense.void', 'staff.status', 'accounting.period.close', 'tab.transfer', 'tab.split', 'tab.merge']) {
    assert.match(source, new RegExp(`'${command.replace('.', '\\.')}'`))
  }
  assert.match(source, /'stock\.adjust': 'inventory\.approve'/)
  assert.match(source, /'purchase_order\.create': 'inventory\.approve'/)
  assert.match(source, /'expense\.void': 'accounting\.approve'/)
  assert.match(source, /'accounting\.period\.close': 'accounting\.approve'/)
})
