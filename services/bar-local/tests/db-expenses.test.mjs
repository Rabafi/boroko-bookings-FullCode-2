import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

async function businessDate(h) {
  const result = await h.migrator.query(`SELECT to_char(bar_local.current_business_date(), 'YYYY-MM-DD') AS value`)
  return result.rows[0].value
}

function createEnvelope(h, amount = '150.00', overrides = {}) {
  return h.envelope('expense.create', {
    expense_date: overrides.expense_date,
    category: 'Utilities',
    description: 'Electricity for the bar',
    amount,
    expense_account_code: '5000',
    payment_account_code: '1000',
    supplier_id: null,
    reference: 'BILL-100'
  })
}

test('expenses post balanced journals and require approved append-only reversals', async (t) => {
  const h = await createHarness(t)
  const date = await businessDate(h)
  await h.migrator.query(
    `INSERT INTO bar_local.accounting_accounts (code, name, type)
     VALUES ('1000','Cash','asset'), ('1100','Bank','asset'), ('4000','Sales revenue','revenue'),
            ('5000','Utilities expense','expense')`
  )

  const managerToken = h.managerTokenHash
  const firstEnvelope = createEnvelope(h, '150.00', { expense_date: date })
  const first = await h.callWith(h.runtime, 'cmd_expense_create', firstEnvelope, { tokenHash: managerToken })
  assert.equal(first.ok, true, JSON.stringify(first.error))
  assert.equal(first.result.amount, 150)
  assert.equal(first.result.status, 'posted')
  assert.equal(first.result.version, 1)
  assert.equal(first.result.period, date.slice(0, 7))
  assert.ok(first.result.journal_entry_id)

  const replay = await h.callWith(h.runtime, 'cmd_expense_create', firstEnvelope, { tokenHash: managerToken })
  assert.equal(replay.ok, true)
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.expense_id, first.result.expense_id)

  const listed = await h.query('expenses.list', { from: date, to: date })
  assert.equal(listed.data.length, 1)
  assert.equal(listed.data[0].expense_id, first.result.expense_id)
  assert.equal(listed.data[0].supplier_id, null)
  assert.equal(listed.data[0].reference, 'BILL-100')

  const detail = await h.query('expense.get', { expense_id: first.result.expense_id })
  assert.equal(detail.data.journal_entry.lines.length, 2)
  const debit = detail.data.journal_entry.lines.find((line) => line.account_code === '5000')
  const credit = detail.data.journal_entry.lines.find((line) => line.account_code === '1000')
  assert.equal(Number(debit.debit), 150)
  assert.equal(Number(credit.credit), 150)
  assert.equal(detail.data.reversal_journal_entry, null)

  const invalidAccount = await h.callWith(h.runtime, 'cmd_expense_create', h.envelope('expense.create', {
    expense_date: date,
    category: 'Utilities',
    description: 'Wrong account',
    amount: '10.00',
    expense_account_code: '1000',
    payment_account_code: '1100'
  }), { tokenHash: managerToken })
  assert.equal(invalidAccount.ok, false)
  assert.equal(invalidAccount.error.code, 'ACCOUNT_NOT_FOUND')

  const future = await h.callWith(h.runtime, 'cmd_expense_create', createEnvelope(h, '10.00', {
    expense_date: '2999-01-01'
  }), { tokenHash: managerToken })
  assert.equal(future.ok, false)
  assert.equal(future.error.code, 'VALIDATION_FAILED')

  const voidEnvelope = h.envelope('expense.void', {
    expense_id: first.result.expense_id,
    expected_version: 1,
    reason: 'Duplicate supplier bill'
  })
  const voidHash = sha256Json(voidEnvelope.payload)
  voidEnvelope.payload.approval_id = await h.approve('accounting.approve', voidHash, {
    approverStaffId: h.ownerStaffId,
    targetType: 'expense'
  })
  const voided = await h.callWith(h.runtime, 'cmd_expense_void', voidEnvelope, {
    tokenHash: managerToken,
    approvalHash: voidHash
  })
  assert.equal(voided.ok, true, JSON.stringify(voided.error))
  assert.equal(voided.result.status, 'voided')
  assert.equal(voided.result.version, 2)
  assert.ok(voided.result.reversal_journal_entry_id)

  const voidedDetail = await h.query('expense.get', { expense_id: first.result.expense_id })
  assert.equal(voidedDetail.data.status, 'voided')
  assert.equal(voidedDetail.data.void_reason, 'Duplicate supplier bill')
  assert.equal(voidedDetail.data.reversal_journal_entry.lines.length, 2)
  const reversalDebit = voidedDetail.data.reversal_journal_entry.lines.find((line) => line.account_code === '1000')
  const reversalCredit = voidedDetail.data.reversal_journal_entry.lines.find((line) => line.account_code === '5000')
  assert.equal(Number(reversalDebit.debit), 150)
  assert.equal(Number(reversalCredit.credit), 150)

  const filteredOut = await h.query('expenses.list', { status: 'posted' })
  assert.equal(filteredOut.data.length, 0)
  const filteredVoid = await h.query('expenses.list', { status: 'voided' })
  assert.equal(filteredVoid.data.length, 1)

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log WHERE action IN ('expense.created','expense.voided') ORDER BY id`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), ['expense.created', 'expense.voided'])
})
