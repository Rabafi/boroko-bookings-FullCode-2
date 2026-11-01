import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

async function businessDate(h) {
  const result = await h.migrator.query(`SELECT to_char(bar_local.current_business_date(), 'YYYY-MM-DD') AS value`)
  return result.rows[0].value
}

async function seedAccounts(h) {
  await h.migrator.query(
    `INSERT INTO bar_local.accounting_accounts (code, name, type) VALUES
       ('1000','Cash','asset'), ('1100','Bank','asset'), ('2000','Accounts payable','liability'),
       ('2100','Tax payable','liability'), ('4000','Sales revenue','revenue'),
       ('5000','Cost of sales','expense'), ('6000','Wages expense','expense'),
       ('6100','Payroll payable','liability'), ('6200','Payroll deductions','liability')`
  )
}

async function seedSupplier(h, name = 'Test Supplier') {
  const result = await h.migrator.query(
    `INSERT INTO bar_local.suppliers
       (business_id, name, created_by, updated_by, created_operation_id, updated_operation_id)
     VALUES ($1,$2,$3,$3,gen_random_uuid(),gen_random_uuid()) RETURNING id`,
    [h.businessId, name, h.ownerStaffId]
  )
  return result.rows[0].id
}

async function addApproval(h, envelope, approverStaffId = h.ownerStaffId) {
  const hash = sha256Json(envelope.payload)
  envelope.payload.approval_id = await h.approve('accounting.approve', hash, { approverStaffId })
  return hash
}

test('AP invoices, approvals, payment locks and reversals stay balanced and period bound', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  const date = await businessDate(h)
  const period = date.slice(0, 7)
  await seedAccounts(h)
  const supplierId = await seedSupplier(h)

  const invoicePayload = {
    supplier_id: supplierId,
    invoice_number: 'INV-100',
    invoice_date: date,
    due_date: date,
    subtotal: '100.00',
    tax_total: '15.00',
    total: '115.00',
    payable_account_code: '2000',
    tax_account_code: '2100',
    lines: [
      { description: 'Kegs', quantity: '2', unit_price: '50.00', tax_rate: '0.15', expense_account_code: '5000' }
    ]
  }
  const invoiceEnvelope = h.envelope('accounting.ap.invoice.upsert', invoicePayload)
  const created = await h.callWith(h.runtime, 'cmd_ap_invoice_upsert', invoiceEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  assert.equal(created.result.status, 'draft')
  assert.equal(created.result.total, 115)
  assert.equal(created.result.line_count, 1)
  const invoiceId = created.result.id

  const replay = await h.callWith(h.runtime, 'cmd_ap_invoice_upsert', invoiceEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(replay.ok, true)
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.id, invoiceId)

  const duplicate = await h.callWith(h.runtime, 'cmd_ap_invoice_upsert', h.envelope('accounting.ap.invoice.upsert', {
    ...invoicePayload,
    total: '115.00'
  }), { tokenHash: h.managerTokenHash })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error.code, 'DUPLICATE_INVOICE')

  const mismatched = await h.callWith(h.runtime, 'cmd_ap_invoice_upsert', h.envelope('accounting.ap.invoice.upsert', {
    ...invoicePayload,
    invoice_number: 'INV-101',
    tax_total: '99.00',
    total: '199.00'
  }), { tokenHash: h.managerTokenHash })
  assert.equal(mismatched.ok, false)
  assert.equal(mismatched.error.code, 'AP_AMOUNT_MISMATCH')

  const approveEnvelope = h.envelope('accounting.ap.invoice.approve', { invoice_id: invoiceId })
  const approveHash = await addApproval(h, approveEnvelope)
  const approved = await h.callWith(h.runtime, 'cmd_ap_invoice_approve', approveEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: approveHash
  })
  assert.equal(approved.ok, true, JSON.stringify(approved.error))
  assert.equal(approved.result.status, 'approved')
  const invoiceJournalId = approved.result.journal_entry_id
  const invoiceActors = await h.migrator.query(
    'SELECT created_by, approved_by FROM bar_local.ap_invoices WHERE id = $1',
    [invoiceId]
  )
  assert.equal(invoiceActors.rows[0].created_by, h.managerStaffId)
  assert.equal(invoiceActors.rows[0].approved_by, h.ownerStaffId)

  const journal = await h.migrator.query(
    `SELECT account_code, debit, credit FROM bar_local.journal_lines WHERE entry_id = $1 ORDER BY id`,
    [invoiceJournalId]
  )
  const debits = journal.rows.reduce((sum, row) => sum + Number(row.debit), 0)
  const credits = journal.rows.reduce((sum, row) => sum + Number(row.credit), 0)
  assert.equal(debits, 115)
  assert.equal(credits, 115)
  assert.equal(journal.rows.some((row) => row.account_code === '2100' && Number(row.debit) === 15), true)

  const makerDraft = await h.callWith(h.runtime, 'cmd_ap_invoice_upsert', h.envelope('accounting.ap.invoice.upsert', {
    ...invoicePayload,
    invoice_number: 'INV-MAKER'
  }), { tokenHash: h.managerTokenHash })
  assert.equal(makerDraft.ok, true, JSON.stringify(makerDraft.error))
  const makerUpdatePayload = {
    ...invoicePayload,
    invoice_id: makerDraft.result.id,
    invoice_number: 'INV-MAKER',
    expected_version: 1
  }
  const makerUpdated = await h.callWith(h.runtime, 'cmd_ap_invoice_upsert', h.envelope('accounting.ap.invoice.upsert', makerUpdatePayload), {
    tokenHash: h.managerTokenHash
  })
  assert.equal(makerUpdated.ok, true, JSON.stringify(makerUpdated.error))
  assert.equal(makerUpdated.result.version, 2)

  const staleUpdate = await h.callWith(h.runtime, 'cmd_ap_invoice_upsert', h.envelope('accounting.ap.invoice.upsert', makerUpdatePayload), {
    tokenHash: h.managerTokenHash
  })
  assert.equal(staleUpdate.ok, false)
  assert.equal(staleUpdate.error.code, 'AP_INVOICE_VERSION_CONFLICT')

  const makerApprove = h.envelope('accounting.ap.invoice.approve', { invoice_id: makerDraft.result.id })
  const makerHash = sha256Json(makerApprove.payload)
  makerApprove.payload.approval_id = await h.approve('accounting.approve', makerHash, {
    approverStaffId: h.managerStaffId,
    targetType: 'operation'
  })
  const denied = await h.callWith(h.runtime, 'cmd_ap_invoice_approve', makerApprove, {
    tokenHash: h.ownerTokenHash,
    approvalHash: makerHash
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'MAKER_CHECKER_VIOLATION')

  const paymentPayload = {
    invoice_id: invoiceId,
    payment_date: date,
    amount: '50.00',
    method: 'bank',
    payment_account_code: '1100',
    reference: 'PAY-1'
  }
  const paymentEnvelope = h.envelope('accounting.ap.payment.post', paymentPayload)
  const paymentHash = await addApproval(h, paymentEnvelope)
  const payment = await h.callWith(h.runtime, 'cmd_ap_payment_post', paymentEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: paymentHash
  })
  assert.equal(payment.ok, true, JSON.stringify(payment.error))
  assert.equal(payment.result.status, 'posted')
  assert.equal(Number(payment.result.outstanding), 65)
  const paymentId = payment.result.payment_id

  const paymentReplay = await h.callWith(h.runtime, 'cmd_ap_payment_post', paymentEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: paymentHash
  })
  assert.equal(paymentReplay.replayed, true)
  assert.equal(paymentReplay.result.payment_id, paymentId)

  const overpayEnvelope = h.envelope('accounting.ap.payment.post', {
    ...paymentPayload,
    amount: '70.00',
    reference: 'PAY-OVER'
  })
  const overpayHash = await addApproval(h, overpayEnvelope)
  const overpay = await h.callWith(h.runtime, 'cmd_ap_payment_post', overpayEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: overpayHash
  })
  assert.equal(overpay.ok, false)
  assert.equal(overpay.error.code, 'PAYMENT_EXCEEDS_OUTSTANDING')

  const finalEnvelope = h.envelope('accounting.ap.payment.post', {
    ...paymentPayload,
    amount: '65.00',
    reference: 'PAY-2'
  })
  const finalHash = await addApproval(h, finalEnvelope)
  const finalPayment = await h.callWith(h.runtime, 'cmd_ap_payment_post', finalEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: finalHash
  })
  assert.equal(finalPayment.ok, true, JSON.stringify(finalPayment.error))
  assert.equal(Number(finalPayment.result.outstanding), 0)

  const reverseEnvelope = h.envelope('accounting.ap.payment.reverse', {
    payment_id: paymentId,
    reversal_date: date,
    reason: 'Duplicate supplier payment'
  })
  const reverseHash = await addApproval(h, reverseEnvelope)
  const reversal = await h.callWith(h.runtime, 'cmd_ap_payment_reverse', reverseEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: reverseHash
  })
  assert.equal(reversal.ok, true, JSON.stringify(reversal.error))
  assert.equal(reversal.result.status, 'reversal')
  assert.equal(Number(reversal.result.outstanding), 50)

  const reverseAgainEnvelope = h.envelope('accounting.ap.payment.reverse', {
    payment_id: paymentId,
    reversal_date: date,
    reason: 'Reverse twice'
  })
  const reverseAgainHash = await addApproval(h, reverseAgainEnvelope)
  const reverseAgain = await h.callWith(h.runtime, 'cmd_ap_payment_reverse', reverseAgainEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: reverseAgainHash
  })
  assert.equal(reverseAgain.ok, false)
  assert.equal(reverseAgain.error.code, 'AP_PAYMENT_ALREADY_REVERSED')

  const totals = await h.migrator.query(
    `SELECT COALESCE(sum(jl.debit), 0) AS debits, COALESCE(sum(jl.credit), 0) AS credits
       FROM bar_local.journal_lines jl
       JOIN bar_local.journal_entries je ON je.id = jl.entry_id
      WHERE je.business_id = $1`,
    [h.businessId]
  )
  assert.equal(Number(totals.rows[0].debits), Number(totals.rows[0].credits))

  const closeEnvelope = h.envelope('accounting.period.close', { period })
  const closeHash = await addApproval(h, closeEnvelope)
  const closed = await h.callWith(h.runtime, 'cmd_period_close', closeEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: closeHash
  })
  assert.equal(closed.ok, true, JSON.stringify(closed.error))

  const locked = await h.callWith(h.runtime, 'cmd_ap_invoice_upsert', h.envelope('accounting.ap.invoice.upsert', {
    ...invoicePayload,
    invoice_number: 'INV-LOCKED'
  }), { tokenHash: h.managerTokenHash })
  assert.equal(locked.ok, false)
  assert.equal(locked.error.code, 'PERIOD_LOCKED')

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log WHERE action LIKE 'accounting.ap.%' ORDER BY id`
  )
  const actions = audit.rows.map((row) => row.action)
  assert.equal(actions.includes('accounting.ap.invoice.created'), true)
  assert.equal(actions.includes('accounting.ap.invoice.approved'), true)
  assert.equal(actions.includes('accounting.ap.payment.posted'), true)
  assert.equal(actions.includes('accounting.ap.payment.reversed'), true)
})

test('bank statements import idempotently and reconcile evidence exactly once', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  const date = await businessDate(h)
  await seedAccounts(h)

  const accountEnvelope = h.envelope('accounting.bank.account.upsert', {
    name: 'Main Bank',
    institution: 'Test Bank',
    account_number: '123456789',
    account_code: '1100'
  })
  const account = await h.callWith(h.runtime, 'cmd_bank_account_upsert', accountEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(account.ok, true, JSON.stringify(account.error))
  assert.equal(account.result.version, 1)
  const bankAccountId = account.result.id

  const accountReplay = await h.callWith(h.runtime, 'cmd_bank_account_upsert', accountEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(accountReplay.replayed, true)
  assert.equal(accountReplay.result.id, bankAccountId)

  const importPayload = {
    bank_account_id: bankAccountId,
    lines: [
      { external_ref: 'STM-1', statement_date: date, description: 'Keg purchase', amount: '-115.00' },
      { external_ref: 'STM-2', statement_date: date, description: 'Deposit', amount: '200.00' }
    ]
  }
  const importEnvelope = h.envelope('accounting.bank.statement.import', importPayload)
  const imported = await h.callWith(h.runtime, 'cmd_bank_statement_import', importEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(imported.ok, true, JSON.stringify(imported.error))
  assert.equal(imported.result.imported, 2)
  assert.equal(imported.result.skipped, 0)

  const importReplay = await h.callWith(h.runtime, 'cmd_bank_statement_import', importEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(importReplay.replayed, true)
  assert.equal(importReplay.result.imported, 2)

  const secondImport = await h.callWith(h.runtime, 'cmd_bank_statement_import', h.envelope('accounting.bank.statement.import', importPayload), {
    tokenHash: h.managerTokenHash
  })
  assert.equal(secondImport.ok, true, JSON.stringify(secondImport.error))
  assert.equal(secondImport.result.imported, 0)
  assert.equal(secondImport.result.skipped, 2)

  const conflicting = await h.callWith(h.runtime, 'cmd_bank_statement_import', h.envelope('accounting.bank.statement.import', {
    bank_account_id: bankAccountId,
    lines: [
      { external_ref: 'STM-2', statement_date: date, description: 'Deposit', amount: '201.00' }
    ]
  }), { tokenHash: h.managerTokenHash })
  assert.equal(conflicting.ok, false)
  assert.equal(conflicting.error.code, 'BANK_STATEMENT_CONFLICT')

  const journalEnvelope = h.envelope('accounting.journal.post', {
    entry_date: date,
    memo: 'Bank deposit',
    source_type: 'manual.test',
    lines: [
      { account_code: '1100', debit: '200.00', credit: '0.00' },
      { account_code: '4000', debit: '0.00', credit: '200.00' }
    ]
  })
  const journal = await h.callWith(h.runtime, 'cmd_journal_post', journalEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(journal.ok, true, JSON.stringify(journal.error))

  const statement = await h.migrator.query(
    `SELECT id FROM bar_local.bank_statement_lines WHERE bank_account_id = $1 AND external_ref = 'STM-2'`,
    [bankAccountId]
  )
  const statementLineId = statement.rows[0].id

  const reconcileEnvelope = h.envelope('accounting.bank.reconcile', {
    statement_line_id: statementLineId,
    journal_entry_id: journal.result.entry_id,
    reconciled_on: date
  })
  const reconciled = await h.callWith(h.runtime, 'cmd_bank_reconcile', reconcileEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(reconciled.ok, true, JSON.stringify(reconciled.error))
  assert.equal(reconciled.result.evidence_type, 'journal')
  assert.equal(Number(reconciled.result.amount), 200)

  const reconcileAgain = await h.callWith(h.runtime, 'cmd_bank_reconcile', h.envelope('accounting.bank.reconcile', {
    statement_line_id: statementLineId,
    journal_entry_id: journal.result.entry_id
  }), { tokenHash: h.managerTokenHash })
  assert.equal(reconcileAgain.ok, false)
  assert.equal(reconcileAgain.error.code, 'BANK_ALREADY_RECONCILED')

  const wrongEvidence = await h.callWith(h.runtime, 'cmd_bank_reconcile', h.envelope('accounting.bank.reconcile', {
    statement_line_id: statementLineId,
    journal_entry_id: journal.result.entry_id,
    force: true
  }), { tokenHash: h.managerTokenHash })
  assert.equal(wrongEvidence.ok, false)

  const lines = await h.migrator.query(
    `SELECT count(*)::integer AS count FROM bar_local.bank_statement_lines WHERE bank_account_id = $1`,
    [bankAccountId]
  )
  assert.equal(lines.rows[0].count, 2)
  const reconciledRows = await h.migrator.query(
    `SELECT count(*)::integer AS count FROM bar_local.bank_reconciliations WHERE bank_account_id = $1`,
    [bankAccountId]
  )
  assert.equal(reconciledRows.rows[0].count, 1)
})

test('tax codes version and tax return drafts snapshot only real local sources', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  const date = await businessDate(h)
  const period = date.slice(0, 7)
  await seedAccounts(h)
  const supplierId = await seedSupplier(h, 'Tax Supplier')

  const codeEnvelope = h.envelope('accounting.tax.code.upsert', {
    code: 'VAT',
    name: 'Value added tax',
    rate: '0.15'
  })
  const code = await h.callWith(h.runtime, 'cmd_tax_code_upsert', codeEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(code.ok, true, JSON.stringify(code.error))
  assert.equal(code.result.version, 1)

  const versioned = await h.callWith(h.runtime, 'cmd_tax_code_upsert', h.envelope('accounting.tax.code.upsert', {
    code: 'VAT',
    name: 'Value added tax',
    rate: '0.14',
    expected_version: 1
  }), { tokenHash: h.managerTokenHash })
  assert.equal(versioned.ok, true, JSON.stringify(versioned.error))
  assert.equal(versioned.result.version, 2)
  const codeRows = await h.migrator.query(
    `SELECT count(*)::integer AS count FROM bar_local.tax_codes WHERE business_id = $1 AND code = 'VAT'`,
    [h.businessId]
  )
  assert.equal(codeRows.rows[0].count, 2)

  const product = await h.migrator.query(
    `INSERT INTO bar_local.products (business_id, sku, name, price, tax_rate)
     VALUES ($1,'TAX-SKU','Taxed item',115,0.15) RETURNING id`,
    [h.businessId]
  )
  const shiftId = await h.openShift()
  const sale = await h.migrator.query(
    `INSERT INTO bar_local.sales
       (business_id, outlet_id, shift_id, device_id, actor_staff_id, receipt_number, receipt_series,
        business_date, status, subtotal, discount, tax, tip, total, operation_id)
     VALUES ($1,$2,$3,$4,$5,1,'BAR',$6,'completed',100,0,15,0,115,gen_random_uuid())
     RETURNING id`,
    [h.businessId, h.outletId, shiftId, h.deviceId, h.ownerStaffId, date]
  )
  await h.migrator.query(
    `INSERT INTO bar_local.sale_lines
       (sale_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
        line_subtotal, line_discount, line_tax, line_total, operation_id)
     VALUES ($1,1,$2,'Taxed item','TAX-SKU',1,100,0.15,100,0,15,115,gen_random_uuid())`,
    [sale.rows[0].id, product.rows[0].id]
  )
  await h.migrator.query(
    `INSERT INTO bar_local.ap_invoices
       (business_id, outlet_id, supplier_id, invoice_number, invoice_date, subtotal, tax_total, total,
        payable_account_code, tax_account_code, status, created_by, operation_id)
     VALUES ($1,$2,$3,'TAX-AP-1',$4,100,10,110,'2000','2100','approved',$5,gen_random_uuid())`,
    [h.businessId, h.outletId, supplierId, date, h.ownerStaffId]
  )

  const prepareEnvelope = h.envelope('accounting.tax.return.prepare', { period })
  const prepared = await h.callWith(h.runtime, 'cmd_tax_return_prepare', prepareEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error))
  assert.equal(prepared.result.status, 'draft')
  assert.equal(prepared.result.statutory_submission, 'external_required')
  assert.equal(Number(prepared.result.output_tax), 15)
  assert.equal(Number(prepared.result.input_tax), 10)
  assert.equal(Number(prepared.result.net_due), 5)
  assert.equal(prepared.result.snapshot.sales_count, 1)
  assert.equal(prepared.result.snapshot.ap_invoice_count, 1)
  assert.equal(prepared.result.snapshot.completeness.missing_sources_fabricated, false)
  assert.equal(prepared.result.snapshot.tax_codes[0].version, 2)
  assert.match(prepared.result.snapshot_hash, /^[0-9a-f]{64}$/)

  const replay = await h.callWith(h.runtime, 'cmd_tax_return_prepare', prepareEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.tax_return_id, prepared.result.tax_return_id)

  const empty = await h.callWith(h.runtime, 'cmd_tax_return_prepare', h.envelope('accounting.tax.return.prepare', {
    period: '2000-01'
  }), { tokenHash: h.managerTokenHash })
  assert.equal(empty.ok, true, JSON.stringify(empty.error))
  assert.equal(Number(empty.result.output_tax), 0)
  assert.equal(Number(empty.result.input_tax), 0)
  assert.equal(empty.result.snapshot.sales_count, 0)
  assert.equal(empty.result.snapshot.ap_invoice_count, 0)

  const stored = await h.migrator.query(
    `SELECT status, snapshot_hash, statutory_submission FROM bar_local.tax_return_periods WHERE id = $1`,
    [prepared.result.tax_return_id]
  )
  assert.equal(stored.rows[0].status, 'draft')
  assert.equal(stored.rows[0].statutory_submission, 'external_required')
  assert.match(stored.rows[0].snapshot_hash, /^[0-9a-f]{64}$/)
})

test('payroll stores minimised lines and finalises only with approval and open periods', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  const date = await businessDate(h)
  const period = date.slice(0, 7)
  await seedAccounts(h)

  const createEnvelope = h.envelope('accounting.payroll.run.create', {
    period_start: date,
    period_end: date,
    pay_date: date,
    expense_account_code: '6000',
    payable_account_code: '6100',
    deductions_account_code: '6200',
    lines: [
      { employee_ref: 'EMP-001', gross: '1000.00', deductions: '150.00' },
      { employee_ref: 'EMP-002', gross: '800.00', deductions: '80.00' }
    ]
  })
  const created = await h.callWith(h.runtime, 'cmd_payroll_run_create', createEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  assert.equal(created.result.status, 'draft')
  assert.equal(Number(created.result.gross_total), 1800)
  assert.equal(Number(created.result.net_total), 1570)
  assert.equal(created.result.payment_status, 'external_required')
  assert.equal(created.result.filing_status, 'external_required')
  const runId = created.result.payroll_run_id

  const createReplay = await h.callWith(h.runtime, 'cmd_payroll_run_create', createEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(createReplay.replayed, true)
  assert.equal(createReplay.result.payroll_run_id, runId)

  const columns = await h.migrator.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'bar_local' AND table_name = 'payroll_lines' ORDER BY ordinal_position`
  )
  const names = columns.rows.map((row) => row.column_name)
  assert.deepEqual(names, [
    'id', 'payroll_run_id', 'line_number', 'employee_ref', 'gross', 'deductions', 'net', 'created_at'
  ])
  assert.equal(names.some((name) => /name|email|phone|address|bank|tax_id|national/i.test(name)), false)

  const prepareEnvelope = h.envelope('accounting.payroll.run.prepare', {
    payroll_run_id: runId,
    expected_version: 1
  })
  const prepared = await h.callWith(h.runtime, 'cmd_payroll_run_prepare', prepareEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error))
  assert.equal(prepared.result.status, 'prepared')
  assert.equal(prepared.result.version, 2)
  assert.match(prepared.result.snapshot_hash, /^[0-9a-f]{64}$/)

  const noApproval = await h.callWith(h.runtime, 'cmd_payroll_run_finalise', h.envelope('accounting.payroll.run.finalise', {
    payroll_run_id: runId,
    expected_version: 2
  }), { tokenHash: h.managerTokenHash })
  assert.equal(noApproval.ok, false)
  assert.equal(noApproval.error.code, 'APPROVAL_REQUIRED')

  const finaliseEnvelope = h.envelope('accounting.payroll.run.finalise', {
    payroll_run_id: runId,
    expected_version: 2
  })
  const finaliseHash = await addApproval(h, finaliseEnvelope)
  const finalised = await h.callWith(h.runtime, 'cmd_payroll_run_finalise', finaliseEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: finaliseHash
  })
  assert.equal(finalised.ok, true, JSON.stringify(finalised.error))
  assert.equal(finalised.result.status, 'finalised')
  assert.equal(finalised.result.payment_status, 'external_required')
  assert.equal(finalised.result.filing_status, 'external_required')

  const payrollJournal = await h.migrator.query(
    `SELECT account_code, debit, credit FROM bar_local.journal_lines WHERE entry_id = $1 ORDER BY id`,
    [finalised.result.journal_entry_id]
  )
  const debits = payrollJournal.rows.reduce((sum, row) => sum + Number(row.debit), 0)
  const credits = payrollJournal.rows.reduce((sum, row) => sum + Number(row.credit), 0)
  assert.equal(debits, 1800)
  assert.equal(credits, 1800)
  assert.equal(payrollJournal.rows.some((row) => row.account_code === '6200' && Number(row.credit) === 230), true)

  const runLine = await h.migrator.query(
    `SELECT employee_ref, gross, deductions, net FROM bar_local.payroll_lines
      WHERE payroll_run_id = $1 ORDER BY employee_ref`,
    [runId]
  )
  assert.deepEqual(runLine.rows.map((row) => row.employee_ref), ['EMP-001', 'EMP-002'])
  assert.equal(Number(runLine.rows[0].net), 850)

  const finaliseReplay = await h.callWith(h.runtime, 'cmd_payroll_run_finalise', finaliseEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: finaliseHash
  })
  assert.equal(finaliseReplay.replayed, true)
  assert.equal(finaliseReplay.result.payroll_run_id, runId)

  const closeEnvelope = h.envelope('accounting.period.close', { period })
  const closeHash = await addApproval(h, closeEnvelope)
  const closed = await h.callWith(h.runtime, 'cmd_period_close', closeEnvelope, {
    tokenHash: h.managerTokenHash,
    approvalHash: closeHash
  })
  assert.equal(closed.ok, true, JSON.stringify(closed.error))

  const locked = await h.callWith(h.runtime, 'cmd_payroll_run_create', h.envelope('accounting.payroll.run.create', {
    period_start: date,
    period_end: date,
    pay_date: date,
    expense_account_code: '6000',
    payable_account_code: '6100',
    lines: [{ employee_ref: 'EMP-003', gross: '100.00', deductions: '0.00' }]
  }), { tokenHash: h.managerTokenHash })
  assert.equal(locked.ok, false)
  assert.equal(locked.error.code, 'PERIOD_LOCKED')

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log WHERE action LIKE 'accounting.payroll.%' ORDER BY id`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'accounting.payroll.run.created',
    'accounting.payroll.run.prepared',
    'accounting.payroll.run.finalised'
  ])
})

test('budgets keep historical line versions and calculate actuals from journals', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  const date = await businessDate(h)
  await seedAccounts(h)
  const yearStart = `${date.slice(0, 4)}-01-01`
  const yearEnd = `${date.slice(0, 4)}-12-31`

  const budgetEnvelope = h.envelope('accounting.budget.upsert', {
    name: 'Operating budget',
    period_start: yearStart,
    period_end: yearEnd,
    lines: [
      { account_code: '5000', amount: '1000.00', description: 'Cost of sales' },
      { account_code: '4000', amount: '2000.00', description: 'Sales' }
    ]
  })
  const created = await h.callWith(h.runtime, 'cmd_budget_upsert', budgetEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(created.ok, true, JSON.stringify(created.error))
  assert.equal(created.result.version, 1)
  assert.equal(Number(created.result.budget_total), 3000)
  const budgetId = created.result.budget_id

  const replay = await h.callWith(h.runtime, 'cmd_budget_upsert', budgetEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.budget_id, budgetId)

  const journal = await h.callWith(h.runtime, 'cmd_journal_post', h.envelope('accounting.journal.post', {
    entry_date: date,
    memo: 'Cost of sales',
    source_type: 'manual.test',
    lines: [
      { account_code: '5000', debit: '150.00', credit: '0.00' },
      { account_code: '1000', debit: '0.00', credit: '150.00' }
    ]
  }), { tokenHash: h.managerTokenHash })
  assert.equal(journal.ok, true, JSON.stringify(journal.error))

  const actuals = await h.migrator.query(
    `SELECT account_code, budget_amount, actual_amount, variance
       FROM bar_local.budget_actuals($1) ORDER BY account_code`,
    [budgetId]
  )
  const cost = actuals.rows.find((row) => row.account_code === '5000')
  const revenue = actuals.rows.find((row) => row.account_code === '4000')
  assert.equal(Number(cost.budget_amount), 1000)
  assert.equal(Number(cost.actual_amount), 150)
  assert.equal(Number(cost.variance), -850)
  assert.equal(Number(revenue.actual_amount), 0)
  assert.equal(Number(revenue.variance), -2000)

  const updateEnvelope = h.envelope('accounting.budget.upsert', {
    budget_id: budgetId,
    name: 'Operating budget',
    period_start: yearStart,
    period_end: yearEnd,
    expected_version: 1,
    lines: [
      { account_code: '5000', amount: '900.00', description: 'Cost of sales' }
    ]
  })
  const updated = await h.callWith(h.runtime, 'cmd_budget_upsert', updateEnvelope, { tokenHash: h.managerTokenHash })
  assert.equal(updated.ok, true, JSON.stringify(updated.error))
  assert.equal(updated.result.version, 2)

  const versionRows = await h.migrator.query(
    `SELECT budget_version, count(*)::integer AS count FROM bar_local.budget_lines
      WHERE budget_id = $1 GROUP BY budget_version ORDER BY budget_version`,
    [budgetId]
  )
  assert.deepEqual(versionRows.rows.map((row) => [row.budget_version, row.count]), [[1, 2], [2, 1]])

  const revised = await h.migrator.query(
    `SELECT account_code, budget_amount, actual_amount, variance
       FROM bar_local.budget_actuals($1) ORDER BY account_code`,
    [budgetId]
  )
  assert.equal(revised.rows.length, 1)
  assert.equal(Number(revised.rows[0].budget_amount), 900)
  assert.equal(Number(revised.rows[0].actual_amount), 150)
  assert.equal(Number(revised.rows[0].variance), -750)

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log WHERE action LIKE 'accounting.budget.%' ORDER BY id`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'accounting.budget.created',
    'accounting.budget.updated'
  ])
})

test('accounting tables and payroll details are not directly readable by the runtime role', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  await assert.rejects(
    () => h.runtime.query('SELECT 1 FROM bar_local.ap_invoices LIMIT 1'),
    /permission denied/i
  )
  await assert.rejects(
    () => h.runtime.query('SELECT 1 FROM bar_local.payroll_lines LIMIT 1'),
    /permission denied/i
  )
  await assert.rejects(
    () => h.runtime.query('SELECT 1 FROM bar_local.budget_lines LIMIT 1'),
    /permission denied/i
  )
})
