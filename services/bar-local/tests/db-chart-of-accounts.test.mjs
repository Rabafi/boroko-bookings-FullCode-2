import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

async function businessDate(h) {
  const result = await h.migrator.query(`SELECT to_char(bar_local.current_business_date(), 'YYYY-MM-DD') AS value`)
  return result.rows[0].value
}

function accountEnvelope(h, payload) {
  return h.envelope('accounting.account.upsert', payload)
}

test('chart accounts are versioned and protect posted financial meaning', async (t) => {
  const h = await createHarness(t)
  const date = await businessDate(h)
  const managerToken = h.managerTokenHash

  const cash = await h.callWith(h.runtime, 'cmd_accounting_account_upsert', accountEnvelope(h, {
    code: '1000', name: 'Cash', type: 'asset'
  }), { tokenHash: managerToken })
  assert.equal(cash.ok, true, JSON.stringify(cash.error))
  assert.equal(cash.result.version, 1)
  assert.equal(cash.result.active, true)

  const utilities = await h.callWith(h.runtime, 'cmd_accounting_account_upsert', accountEnvelope(h, {
    code: '5000', name: 'Utilities', type: 'expense'
  }), { tokenHash: managerToken })
  assert.equal(utilities.ok, true, JSON.stringify(utilities.error))

  const duplicate = await h.callWith(h.runtime, 'cmd_accounting_account_upsert', accountEnvelope(h, {
    code: '5000', name: 'Duplicate', type: 'expense'
  }), { tokenHash: managerToken })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, 'DUPLICATE_RECORD')

  const renamed = await h.callWith(h.runtime, 'cmd_accounting_account_upsert', accountEnvelope(h, {
    code: '5000', name: 'Utilities and power', type: 'expense', expected_version: 1
  }), { tokenHash: managerToken })
  assert.equal(renamed.ok, true, JSON.stringify(renamed.error))
  assert.equal(renamed.result.version, 2)
  assert.equal(renamed.result.name, 'Utilities and power')

  const stale = await h.callWith(h.runtime, 'cmd_accounting_account_upsert', accountEnvelope(h, {
    code: '5000', name: 'Stale', type: 'expense', expected_version: 1
  }), { tokenHash: managerToken })
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'ACCOUNT_VERSION_CONFLICT')

  const expense = await h.callWith(h.runtime, 'cmd_expense_create', h.envelope('expense.create', {
    expense_date: date,
    category: 'Utilities',
    description: 'Electricity for the bar',
    amount: '150.00',
    expense_account_code: '5000',
    payment_account_code: '1000'
  }), { tokenHash: managerToken })
  assert.equal(expense.ok, true, JSON.stringify(expense.error))

  const typeChange = await h.callWith(h.runtime, 'cmd_accounting_account_upsert', accountEnvelope(h, {
    code: '5000', name: 'Utilities and power', type: 'asset', expected_version: 2
  }), { tokenHash: managerToken })
  assert.equal(typeChange.ok, false)
  assert.equal(typeChange.error.code, 'ACCOUNT_IN_USE')

  const deactivated = await h.callWith(h.runtime, 'cmd_accounting_account_upsert', accountEnvelope(h, {
    code: '5000', name: 'Utilities and power', type: 'expense', active: false, expected_version: 2
  }), { tokenHash: managerToken })
  assert.equal(deactivated.ok, true, JSON.stringify(deactivated.error))
  assert.equal(deactivated.result.version, 3)
  assert.equal(deactivated.result.active, false)

  const inactivePosting = await h.callWith(h.runtime, 'cmd_expense_create', h.envelope('expense.create', {
    expense_date: date,
    category: 'Utilities',
    description: 'Inactive account',
    amount: '10.00',
    expense_account_code: '5000',
    payment_account_code: '1000'
  }), { tokenHash: managerToken })
  assert.equal(inactivePosting.ok, false)
  assert.equal(inactivePosting.error.code, 'ACCOUNT_NOT_FOUND')

  const activeList = await h.query('accounting.accounts.list', { type: 'expense' })
  assert.equal(activeList.data.length, 0)
  const allList = await h.query('accounting.accounts.list', { include_inactive: true, search: 'utilities' })
  assert.equal(allList.data.length, 1)
  assert.equal(allList.data[0].account_code, '5000')
  assert.equal(allList.data[0].active, false)
  assert.equal(Number(allList.data[0].debit_total), 150)
  assert.equal(Number(allList.data[0].balance), 150)

  const cashList = await h.query('accounting.accounts.list', { search: 'cash' })
  assert.equal(cashList.data.length, 1)
  assert.equal(Number(cashList.data[0].credit_total), 150)
  assert.equal(Number(cashList.data[0].balance), -150)

  const audit = await h.migrator.query(
    `SELECT action, before, after FROM bar_local.audit_log WHERE action LIKE 'accounting.account.%' ORDER BY id`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), ['accounting.account.created', 'accounting.account.created', 'accounting.account.updated', 'accounting.account.updated'])
  assert.equal(audit.rows[0].before, null)
  assert.equal(audit.rows[1].after.active, true)
  assert.equal(audit.rows[3].before.active, true)
  assert.equal(audit.rows[3].after.active, false)
})
