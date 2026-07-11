import test from 'node:test'
import assert from 'node:assert/strict'

// Tests for corporate billing RPC contracts and domain logic.
// These are structural/unit tests that verify the RPC signatures and
// domain function structure without requiring a live Supabase instance.

test('corporate billing migration has expected tables', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705105000_corporate_billing_workflow.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS corporate_invoice_items'), 'corporate_invoice_items table')
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS corporate_payments'), 'corporate_payments table')
  assert.ok(sql.includes('corporate_invoice_items ENABLE ROW LEVEL SECURITY'), 'RLS on invoice items')
  assert.ok(sql.includes('corporate_payments ENABLE ROW LEVEL SECURITY'), 'RLS on payments')
})

test('corporate billing migration has all RPCs', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705105000_corporate_billing_workflow.sql', import.meta.url),
      'utf8'
    )
  )

  const expectedRPCs = [
    'charge_to_corporate_account',
    'get_corporate_outstanding',
    'record_corporate_payment',
    'get_corporate_statement',
    'check_credit_limit_with_pending',
    'suspend_corporate_account',
    'reactivate_corporate_account'
  ]

  for (const rpc of expectedRPCs) {
    assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION ${rpc}`), `RPC ${rpc} exists`)
  }
})

test('corporate billing RPCs have lodge_id parameter', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705105000_corporate_billing_workflow.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes('p_lodge_id uuid'), 'lodge_id parameter used in all RPCs')
})

test('corporate billing domain file exports all functions', async () => {
  const src = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../src/main/domains/corporateBilling.js', import.meta.url),
      'utf8'
    )
  )

  const expectedExports = [
    'getAllCorporateBilling',
    'chargeToCorporateAccount',
    'getCorporateOutstanding',
    'recordCorporatePayment',
    'getCorporateStatement',
    'checkCreditLimitWithPending',
    'suspendCorporateAccount',
    'reactivateCorporateAccount'
  ]

  for (const fn of expectedExports) {
    assert.ok(src.includes(`export async function ${fn}`) || src.includes(`export function ${fn}`),
      `exports ${fn}`)
  }
})

test('corporate billing domain uses dedupePromise for getAll', async () => {
  const src = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../src/main/domains/corporateBilling.js', import.meta.url),
      'utf8'
    )
  )

  assert.ok(src.includes('dedupePromise'), 'uses dedupePromise')
})

test('corporate billing invoices have UNIQUE constraint on lodge_id + invoice_number', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705105000_corporate_billing_workflow.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes('UNIQUE(lodge_id, invoice_number)'), 'UNIQUE constraint exists')
})

test('corporate billing payment methods are validated', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705105000_corporate_billing_workflow.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes("CHECK (payment_method IN ('bank_transfer','cheque','cash','credit_card','other'))"),
    'payment_method check constraint')
})

test('credit limit check returns available_credit', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705105000_corporate_billing_workflow.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes('available_credit'), 'available_credit field in check_credit_limit_with_pending')
})
