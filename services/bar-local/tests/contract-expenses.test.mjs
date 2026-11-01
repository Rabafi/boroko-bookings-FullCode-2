import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CAPABILITIES, COMMANDS, QUERIES } from '@tsa-bonno/bar-contracts'

test('expense contracts require accounting management and approved reversals', () => {
  assert.equal(COMMANDS['expense.create'].version, 1)
  assert.equal(COMMANDS['expense.create'].capability, CAPABILITIES.ACCOUNTING_MANAGE)
  assert.equal(COMMANDS['expense.create'].approval, null)
  assert.equal(COMMANDS['expense.void'].version, 1)
  assert.equal(COMMANDS['expense.void'].capability, CAPABILITIES.ACCOUNTING_MANAGE)
  assert.equal(COMMANDS['expense.void'].approval, CAPABILITIES.ACCOUNTING_APPROVE)
  assert.equal(QUERIES['expenses.list'].capability, CAPABILITIES.ACCOUNTING_READ)
  assert.equal(QUERIES['expense.get'].capability, CAPABILITIES.ACCOUNTING_READ)

  const create = COMMANDS['expense.create'].validate({
    expense_date: '2026-10-20',
    category: ' Utilities ',
    description: ' Electricity bill ',
    amount: '150.00',
    expense_account_code: '5000',
    payment_account_code: '1000',
    supplier_id: randomUUID(),
    reference: ' BILL-1 '
  })
  assert.equal(create.category, 'Utilities')
  assert.equal(create.description, 'Electricity bill')
  assert.equal(create.reference, 'BILL-1')
  assert.ok(create.supplier_id)

  assert.throws(() => COMMANDS['expense.create'].validate({
    expense_date: '2026-02-30',
    category: 'Utilities',
    description: 'Invalid date',
    amount: '1.00',
    expense_account_code: '5000',
    payment_account_code: '1000'
  }), /expense_date/)

  assert.throws(() => COMMANDS['expense.create'].validate({
    expense_date: '2026-10-20',
    category: 'Utilities',
    description: 'Missing account',
    amount: '1.00',
    expense_account_code: '5000'
  }), /payment_account_code/)

  const voidPayload = COMMANDS['expense.void'].validate({
    expense_id: randomUUID(),
    expected_version: 1,
    reason: 'Duplicate bill',
    approval_id: randomUUID()
  })
  assert.equal(voidPayload.expected_version, 1)
  assert.equal(voidPayload.reason, 'Duplicate bill')
  assert.ok(voidPayload.approval_id)
})
