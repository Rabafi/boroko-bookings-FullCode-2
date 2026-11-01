import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

test('accounting journals, trial balance, outbox and period locking stay authoritative', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  const businessDate = new Date().toISOString().slice(0, 10)
  const period = businessDate.slice(0, 7)

  await h.migrator.query(
    `INSERT INTO bar_local.accounting_accounts (code, name, type) VALUES
       ('1000','Cash','asset'), ('4000','Sales revenue','revenue')`
  )

  const journalEnvelope = h.envelope('accounting.journal.post', {
    entry_date: businessDate,
    memo: 'Opening cash sale',
    lines: [
      { account_code: '1000', debit: '100.00', credit: '0.00', description: 'Cash received' },
      { account_code: '4000', debit: '0.00', credit: '100.00', description: 'Revenue recognised' }
    ],
    source_type: 'manual.test',
    source_id: null
  })
  const journal = await h.call('cmd_journal_post', journalEnvelope)
  assert.equal(journal.ok, true, JSON.stringify(journal.error))
  assert.equal(Number(journal.result.debits), 100)
  assert.equal(Number(journal.result.credits), 100)

  const unbalanced = await h.call('cmd_journal_post', h.envelope('accounting.journal.post', {
    entry_date: businessDate,
    memo: 'Broken journal',
    lines: [
      { account_code: '1000', debit: '50.00' },
      { account_code: '4000', credit: '40.00' }
    ],
    source_type: 'manual.test'
  }))
  assert.equal(unbalanced.ok, false)
  assert.equal(unbalanced.error.code, 'VALIDATION_FAILED')

  const trial = await h.query('accounting.trial_balance', { from: businessDate, to: businessDate })
  const cash = trial.data.find((row) => row.account_code === '1000')
  const revenue = trial.data.find((row) => row.account_code === '4000')
  assert.equal(typeof cash.debit, 'string')
  assert.equal(typeof cash.credit, 'string')
  assert.equal(typeof cash.balance, 'string')
  assert.equal(cash.debit, '100.00')
  assert.equal(cash.balance, '100.00')
  assert.equal(Number(cash.balance), 100)
  assert.equal(typeof revenue.balance, 'string')
  assert.equal(revenue.balance, '-100.00')
  assert.equal(Number(revenue.balance), -100)

  const excluded = await h.query('accounting.trial_balance', { from: '2000-01-01', to: '2000-01-31' })
  assert.equal(Number(excluded.data.find((row) => row.account_code === '1000').balance), 0)

  const outbox = await h.query('outbox.status', {})
  assert.equal(outbox.data.pending_events >= 1, true)
  assert.equal(outbox.data.cloud_transport, 'disabled')
  assert.equal(outbox.data.latest_commit_sequence >= 1, true)

  const summary = await h.query('reports.sales_summary', { from: businessDate, to: businessDate })
  assert.equal(Array.isArray(summary.data.by_day), true)
  assert.equal(Array.isArray(summary.data.by_tender), true)
  assert.equal(Number(summary.data.totals.net_sales), 0)

  const closeEnvelope = h.envelope('accounting.period.close', { period })
  const closeHash = sha256Json(closeEnvelope.payload)
  closeEnvelope.payload.approval_id = await h.approve('accounting.approve', closeHash, { targetType: 'accounting_period' })
  const closed = await h.call('cmd_period_close', closeEnvelope, { approvalHash: closeHash })
  assert.equal(closed.ok, true, JSON.stringify(closed.error))
  assert.equal(closed.result.status, 'closed')

  const lockedEnvelope = h.envelope('accounting.journal.post', {
    entry_date: businessDate,
    memo: 'Late journal',
    lines: [
      { account_code: '1000', debit: '1.00' },
      { account_code: '4000', credit: '1.00' }
    ],
    source_type: 'manual.test'
  })
  const locked = await h.call('cmd_journal_post', lockedEnvelope)
  assert.equal(locked.ok, false)
  assert.equal(locked.error.code, 'PERIOD_LOCKED')
})
