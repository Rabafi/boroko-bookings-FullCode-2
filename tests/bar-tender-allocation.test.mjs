import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildBarTenderBreakdown, tenderBreakdownTotal } from '../src/shared/barTenderAllocation.js'

const tender = (options = {}) => buildBarTenderBreakdown({ total: 30, ...options })
const terminalSource = readFileSync('src/renderer/src/components/hospitality-pos/HposTerminal.jsx', 'utf8')

test('Bar tender allocation keeps voucher, cash, and card in one exact envelope', () => {
  const result = tender({
    voucherCode: 'audit-voucher',
    voucherAmount: '5.00',
    paymentMethod: 'split',
    splitCashAmount: '10.00',
    splitRemainderMethod: 'card',
    paymentReferences: { card: 'AUDIT-REF' },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.breakdown, [
    { method: 'voucher', amount: 5, code: 'AUDIT-VOUCHER', reference: null },
    { method: 'cash', amount: 10, reference: null },
    { method: 'card', amount: 15, reference: 'AUDIT-REF' },
  ])
  assert.equal(tenderBreakdownTotal(result.breakdown), result.total)
})

test('Bar tender allocation supports pure tenders, split tenders, account charge, and voucher combinations', () => {
  assert.deepEqual(tender({ paymentMethod: 'cash' }).breakdown, [
    { method: 'cash', amount: 30, reference: null },
  ])
  assert.deepEqual(tender({ paymentMethod: 'card', paymentReferences: { card: '' } }).breakdown, [
    { method: 'card', amount: 30, reference: null },
  ])
  assert.deepEqual(tender({ paymentMethod: 'mobile_money', paymentReferences: { mobile_money: 'MM-1' } }).breakdown, [
    { method: 'mobile_money', amount: 30, reference: 'MM-1' },
  ])
  assert.deepEqual(tender({ paymentMethod: 'split', splitCashAmount: 10, splitRemainderMethod: 'mobile_money' }).breakdown, [
    { method: 'cash', amount: 10, reference: null },
    { method: 'mobile_money', amount: 20, reference: null },
  ])
  assert.deepEqual(tender({ voucherCode: 'V-CASH', voucherAmount: 5, paymentMethod: 'cash' }).breakdown, [
    { method: 'voucher', amount: 5, code: 'V-CASH', reference: null },
    { method: 'cash', amount: 25, reference: null },
  ])
  assert.deepEqual(tender({ voucherCode: 'V-CARD', voucherAmount: 5, paymentMethod: 'card' }).breakdown, [
    { method: 'voucher', amount: 5, code: 'V-CARD', reference: null },
    { method: 'card', amount: 25, reference: null },
  ])
  assert.deepEqual(tender({ voucherCode: 'V-MOBILE', voucherAmount: 5, paymentMethod: 'mobile_money' }).breakdown, [
    { method: 'voucher', amount: 5, code: 'V-MOBILE', reference: null },
    { method: 'mobile_money', amount: 25, reference: null },
  ])
  assert.deepEqual(tender({ chargeToAccount: true, selectedCustomerId: 'customer-1' }).breakdown, [
    { method: 'account', amount: 30, customer_id: 'customer-1', reference: null },
  ])
})

test('full voucher and zero remainder never create a zero-valued tender row', () => {
  const fullVoucher = tender({ voucherCode: 'FULL', voucherAmount: 30, paymentMethod: 'card' })
  assert.equal(fullVoucher.ok, true)
  assert.deepEqual(fullVoucher.breakdown, [
    { method: 'voucher', amount: 30, code: 'FULL', reference: null },
  ])

  const voucherAndCash = tender({
    voucherCode: 'CASH-ONLY',
    voucherAmount: 20,
    paymentMethod: 'cash',
  })
  assert.equal(voucherAndCash.ok, true)
  assert.deepEqual(voucherAndCash.breakdown, [
    { method: 'voucher', amount: 20, code: 'CASH-ONLY', reference: null },
    { method: 'cash', amount: 10, reference: null },
  ])
  assert.equal(voucherAndCash.breakdown.some((row) => row.amount === 0), false)
})

test('Bar tender allocation rejects non-finite, fractional-cent, negative, and over-allocated inputs', () => {
  for (const value of [NaN, Infinity, -Infinity, 'not-a-number']) {
    assert.equal(tender({ paymentMethod: 'cash', total: value }).ok, false)
  }
  assert.equal(tender({ paymentMethod: 'cash', total: true }).code, 'invalid_amount')
  assert.equal(tender({ paymentMethod: 'cash', total: [] }).code, 'invalid_amount')
  assert.equal(tender({ paymentMethod: 'cash', total: Number.MAX_SAFE_INTEGER }).code, 'amount_out_of_range')
  assert.equal(tender({ paymentMethod: 'cash', total: '30.001' }).code, 'amount_must_be_cents')
  assert.equal(tender({ paymentMethod: 'cash', voucherCode: 'BAD', voucherAmount: true }).code, 'invalid_amount')
  assert.equal(tender({ paymentMethod: 'split', splitCashAmount: Infinity }).code, 'invalid_amount')
  assert.equal(tender({ paymentMethod: 'cash', voucherCode: 'NEG', voucherAmount: -1 }).code, 'negative_voucher')
  assert.equal(tender({ paymentMethod: 'cash', voucherCode: 'OVER', voucherAmount: 31 }).code, 'voucher_over_allocation')
  assert.equal(tender({ paymentMethod: 'split', splitCashAmount: 0 }).code, 'split_cash_required')
  assert.equal(tender({ paymentMethod: 'split', splitCashAmount: 31 }).code, 'split_over_allocation')
  assert.equal(tender({ paymentMethod: 'cash', voucherAmount: 5 }).code, 'voucher_code_required')
  assert.equal(tender({ paymentMethod: 'cash', voucherCode: 'MISSING', voucherAmount: 0 }).code, 'voucher_amount_required')
  assert.equal(tender({ paymentMethod: 'split', splitCashAmount: 30 }).code, 'split_zero_remainder')
})

test('provider references remain optional but are bounded to 120 characters', () => {
  assert.equal(tender({ paymentMethod: 'card', paymentReferences: { card: '' } }).ok, true)
  assert.equal(tender({ paymentMethod: 'mobile_money', paymentReferences: { mobile_money: 'x'.repeat(120) } }).ok, true)
  assert.equal(tender({ paymentMethod: 'card', paymentReferences: { card: 'x'.repeat(121) } }).code, 'provider_reference_too_long')
  assert.equal(tender({ paymentMethod: 'mobile_money', paymentReferences: { mobile_money: 'x'.repeat(121) } }).code, 'provider_reference_too_long')
})

test('Till preview and submission consume the same canonical breakdown object', () => {
  assert.match(terminalSource, /buildBarTenderBreakdown\(/)
  assert.match(terminalSource, /aria-label="Tender breakdown"/)
  assert.match(terminalSource, /tenderBreakdownResult\.breakdown\.map/)
  assert.match(terminalSource, /payment_breakdown: paymentBreakdown/)
  assert.match(terminalSource, /total: tenderBreakdownResult\.total/)
})
