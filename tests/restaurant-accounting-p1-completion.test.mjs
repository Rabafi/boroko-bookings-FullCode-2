import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const sql = read('supabase/migrations/20260718030000_restaurant_accounting_p1_completion.sql')
const bankUi = read('src/renderer/src/components/restaurant-accounting/RestaurantBankReconciliation.jsx')
const apUi = read('src/renderer/src/components/restaurant-accounting/RestaurantAccountsPayable.jsx')
const apDomain = read('src/main/domains/restaurantAccountsPayable.js')

describe('Restaurant Accounting P1 completion', () => {
  it('removes direct client access to the audit helper and accounting writes', () => {
    assert.match(sql, /revoke all on function public\.log_restaurant_financial_action[\s\S]*authenticated;/)
    assert.match(sql, /revoke insert, update, delete on public\.restaurant_accounts[\s\S]*restaurant_payroll_payments from public, anon, authenticated;/)
  })

  it('uses one canonical import signature and row-level unique fingerprints', () => {
    assert.match(sql, /drop function if exists public\.import_bank_statement\(uuid, uuid, jsonb\);/)
    assert.match(sql, /restaurant_bank_transactions_account_fingerprint_uidx/)
    assert.match(sql, /exception when unique_violation then\s+v_skipped := v_skipped \+ 1;/)
  })

  it('keeps match approval separate from reconciliation completion', () => {
    assert.match(sql, /A different authorised user must approve a proposed match/)
    assert.match(sql, /set reconciled_entry_id = v_proposal\.journal_entry_id[\s\S]*is_reconciled = false/)
    assert.match(sql, /set is_reconciled = true where reconciliation_id = p_id/)
  })

  it('uses the GL-linked account balance for a reconciliation draft', () => {
    assert.match(sql, /join public\.restaurant_journal_lines jl on jl\.entry_id = je\.id/)
    assert.match(sql, /jl\.account_id = v_account\.account_id/)
  })

  it('makes AP payments idempotent, locked, and non-overpayable', () => {
    assert.match(sql, /_claim_financial_operation\(p_lodge_id, p_idempotency_key, 'restaurant_bill_payment'/)
    assert.match(sql, /for update;/)
    assert.match(sql, /Payment exceeds the outstanding balance/)
    assert.match(sql, /_record_financial_operation\(p_lodge_id,p_idempotency_key,'restaurant_bill_payment'/)
  })

  it('keeps renderer, bridge, and AP RPC parameter contracts aligned', () => {
    assert.doesNotMatch(bankUi, /confirmBankMatch/)
    assert.match(bankUi, /accountingInvoke\('reviewBankAllocation',id,approve,reason\)/)
    assert.match(bankUi, /accountingInvoke\('proposeBankAllocation'/)
    assert.match(bankUi, /runIdempotent\(`bank-import:/)
    assert.match(bankUi, /statement evidence imported immutably/i)
    assert.match(apUi, /runIdempotent\(`bill-payment:/)
    assert.match(apDomain, /p_idempotency_key: paymentData\.idempotency_key/)
  })
})
