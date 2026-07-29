import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

const COA_SQL = 'supabase/migrations/20260717010000_restaurant_chart_of_accounts.sql'
const GL_SQL = 'supabase/migrations/20260717020000_restaurant_general_ledger.sql'
const BR_SQL = 'supabase/migrations/20260717030000_restaurant_bank_reconciliation.sql'
const AP_SQL = 'supabase/migrations/20260717040000_restaurant_accounts_payable.sql'
const BUDGET_SQL = 'supabase/migrations/20260717060000_restaurant_budgets.sql'
const BS_SQL = 'supabase/migrations/20260717070000_restaurant_balance_sheet.sql'
const PAYROLL_SQL = 'supabase/migrations/20260717080000_restaurant_payroll.sql'
const P1_SQL = 'supabase/migrations/20260718010000_restaurant_accounting_p1_hardening.sql'

const PRELOAD = 'src/preload/index.js'
const BR_JSX = 'src/renderer/src/components/restaurant-accounting/RestaurantBankReconciliation.jsx'
const DESKTOP_NAV = 'src/renderer/src/navigation/desktopNav.js'
const BAR_MODE = 'src/shared/barModeProfile.js'

const GL_DOMAIN = 'src/main/domains/restaurantGeneralLedger.js'
const BR_DOMAIN = 'src/main/domains/restaurantBankReconciliation.js'
const PR_DOMAIN = 'src/main/domains/restaurantPayroll.js'

function exportsAny(name, ...patterns) {
  const src = read(GL_DOMAIN)
  for (const p of patterns) {
    if (src.includes(p)) return true
  }
  return false
}

describe('Restaurant Accounting Module Integrity', () => {

  describe('1.1 SQL RPC creation', () => {
    const fn = (sql, name) => {
      const content = read(sql)
      return content.includes(`create or replace function public.${name}`)
    }

    it('chart_of_accounts: delete_restaurant_account', () => {
      assert.ok(fn(COA_SQL, 'delete_restaurant_account'))
    })
    it('chart_of_accounts: get_restaurant_accounts', () => {
      assert.ok(fn(COA_SQL, 'get_restaurant_accounts'))
    })
    it('chart_of_accounts: create_restaurant_account', () => {
      assert.ok(fn(COA_SQL, 'create_restaurant_account'))
    })
    it('chart_of_accounts: update_restaurant_account', () => {
      assert.ok(fn(COA_SQL, 'update_restaurant_account'))
    })

    it('general_ledger: get_restaurant_journal_entries', () => {
      assert.ok(fn(GL_SQL, 'get_restaurant_journal_entries'))
    })
    it('general_ledger: create_restaurant_journal_entry', () => {
      assert.ok(fn(GL_SQL, 'create_restaurant_journal_entry'))
    })
    it('general_ledger: get_restaurant_general_ledger', () => {
      assert.ok(fn(GL_SQL, 'get_restaurant_general_ledger'))
    })
    it('general_ledger: get_restaurant_trial_balance', () => {
      assert.ok(fn(GL_SQL, 'get_restaurant_trial_balance'))
    })
    it('general_ledger: post_pos_sales_to_gl', () => {
      assert.ok(fn(GL_SQL, 'post_pos_sales_to_gl'))
    })
    it('general_ledger: post_expenses_to_gl', () => {
      assert.ok(fn(GL_SQL, 'post_expenses_to_gl'))
    })
    it('general_ledger: get_restaurant_profit_and_loss', () => {
      assert.ok(fn(GL_SQL, 'get_restaurant_profit_and_loss'))
    })

    it('bank_reconciliation: get_restaurant_bank_accounts', () => {
      assert.ok(fn(BR_SQL, 'get_restaurant_bank_accounts'))
    })
    it('bank_reconciliation: create_restaurant_bank_account', () => {
      assert.ok(fn(BR_SQL, 'create_restaurant_bank_account'))
    })
    it('bank_reconciliation: update_restaurant_bank_account', () => {
      assert.ok(fn(BR_SQL, 'update_restaurant_bank_account'))
    })
    it('bank_reconciliation: import_bank_statement', () => {
      assert.ok(fn(BR_SQL, 'import_bank_statement'))
    })
    it('bank_reconciliation: get_bank_transactions', () => {
      assert.ok(fn(BR_SQL, 'get_bank_transactions'))
    })
    it('bank_reconciliation: create_bank_reconciliation', () => {
      assert.ok(fn(BR_SQL, 'create_bank_reconciliation'))
    })
    it('bank_reconciliation: complete_bank_reconciliation', () => {
      assert.ok(fn(BR_SQL, 'complete_bank_reconciliation'))
    })
    it('bank_reconciliation: get_bank_reconciliations', () => {
      assert.ok(fn(BR_SQL, 'get_bank_reconciliations'))
    })

    it('accounts_payable: get_restaurant_bills', () => {
      assert.ok(fn(AP_SQL, 'get_restaurant_bills'))
    })
    it('accounts_payable: create_restaurant_bill', () => {
      assert.ok(fn(AP_SQL, 'create_restaurant_bill'))
    })
    it('accounts_payable: update_bill_status', () => {
      assert.ok(fn(AP_SQL, 'update_bill_status'))
    })
    it('accounts_payable: record_bill_payment', () => {
      assert.ok(fn(AP_SQL, 'record_bill_payment'))
    })

    it('budgets: set_restaurant_budget', () => {
      assert.ok(fn(BUDGET_SQL, 'set_restaurant_budget'))
    })
    it('budgets: get_budget_vs_actual', () => {
      assert.ok(fn(BUDGET_SQL, 'get_budget_vs_actual'))
    })
    it('budgets: get_budget_vs_actual_summary', () => {
      assert.ok(fn(BUDGET_SQL, 'get_budget_vs_actual_summary'))
    })
    it('budgets: get_restaurant_budget_templates', () => {
      assert.ok(fn(BUDGET_SQL, 'get_restaurant_budget_templates'))
    })

    it('balance_sheet: get_restaurant_balance_sheet', () => {
      assert.ok(fn(BS_SQL, 'get_restaurant_balance_sheet'))
    })
    it('balance_sheet: get_restaurant_income_statement', () => {
      assert.ok(fn(BS_SQL, 'get_restaurant_income_statement'))
    })
    it('balance_sheet: get_restaurant_cash_flow_statement', () => {
      assert.ok(fn(BS_SQL, 'get_restaurant_cash_flow_statement'))
    })
    it('balance_sheet: get_restaurant_financial_statements', () => {
      assert.ok(fn(BS_SQL, 'get_restaurant_financial_statements'))
    })

    it('payroll: get_restaurant_payroll_settings', () => {
      assert.ok(fn(PAYROLL_SQL, 'get_restaurant_payroll_settings'))
    })
    it('payroll: update_restaurant_payroll_settings', () => {
      assert.ok(fn(PAYROLL_SQL, 'update_restaurant_payroll_settings'))
    })
    it('payroll: create_pay_period', () => {
      assert.ok(fn(PAYROLL_SQL, 'create_pay_period'))
    })
    it('payroll: get_pay_periods', () => {
      assert.ok(fn(PAYROLL_SQL, 'get_pay_periods'))
    })
    it('payroll: calculate_payroll', () => {
      assert.ok(fn(PAYROLL_SQL, 'calculate_payroll'))
    })
    it('payroll: get_pay_period_records', () => {
      assert.ok(fn(PAYROLL_SQL, 'get_pay_period_records'))
    })
    it('payroll: update_employee_pay_record', () => {
      assert.ok(fn(PAYROLL_SQL, 'update_employee_pay_record'))
    })
    it('payroll: approve_payroll', () => {
      assert.ok(fn(PAYROLL_SQL, 'approve_payroll'))
    })
    it('payroll: generate_payslip', () => {
      assert.ok(fn(PAYROLL_SQL, 'generate_payslip'))
    })
    it('payroll: post_payroll_to_gl', () => {
      assert.ok(fn(PAYROLL_SQL, 'post_payroll_to_gl'))
    })
  })

  describe('1.2 No broken column refs in migrations', () => {
    const MIGRATIONS = [COA_SQL, GL_SQL, BR_SQL, AP_SQL, BUDGET_SQL, BS_SQL, PAYROLL_SQL]

    for (const m of MIGRATIONS) {
      it(`${m} does not contain debit_account_id`, () => {
        const sql = read(m)
        assert.ok(!sql.includes('debit_account_id'), `${m} should not contain debit_account_id`)
      })
      it(`${m} does not contain credit_account_id`, () => {
        const sql = read(m)
        assert.ok(!sql.includes('credit_account_id'), `${m} should not contain credit_account_id`)
      })
      it(`${m} does not contain debit_amount`, () => {
        const sql = read(m)
        assert.ok(!sql.includes('debit_amount'), `${m} should not contain debit_amount`)
      })
      it(`${m} does not contain credit_amount`, () => {
        const sql = read(m)
        assert.ok(!sql.includes('credit_amount'), `${m} should not contain credit_amount`)
      })
    }
  })

  describe('1.3 P0/P1 guard calls', () => {
    it('chart_of_accounts uses app_require_feature', () => {
      const sql = read(COA_SQL)
      assert.ok(sql.includes('app_require_feature'), 'COA must use app_require_feature')
    })
    it('budgets calls app_require_feature with feature_key', () => {
      const sql = read(BUDGET_SQL)
      assert.ok(sql.includes("app_require_feature(p_lodge_id, 'restaurant_accounting'"), 'Budgets must pass feature key')
    })
    it('balance_sheet calls app_require_feature with feature_key', () => {
      const sql = read(BS_SQL)
      assert.ok(sql.includes("app_require_feature(p_lodge_id, 'restaurant_accounting'"), 'Balance sheet must pass feature key')
    })
    it('p1 migration creates audit log table', () => {
      const sql = read(P1_SQL)
      assert.ok(sql.includes('restaurant_financial_audit_log'), 'P1 migration must create audit log')
    })
    it('p1 migration drops insert policies', () => {
      const sql = read(P1_SQL)
      assert.ok(sql.includes('drop policy if exists'), 'P1 migration must drop write policies')
    })
    it('p1 migration has propose_bank_matches', () => {
      const sql = read(P1_SQL)
      assert.ok(sql.includes('propose_bank_matches'), 'P1 migration must have propose_bank_matches')
    })
    it('p1 migration has approve_bank_match', () => {
      const sql = read(P1_SQL)
      assert.ok(sql.includes('approve_bank_match'), 'P1 migration must have approve_bank_match')
    })
    it('post_pos_sales_to_gl uses lodge timezone', () => {
      const gl = read(GL_SQL)
      const p1 = read(P1_SQL)
      assert.ok(gl.includes('v_timezone') || p1.includes('v_timezone'),
        'post_pos_sales_to_gl must use v_timezone (in GL or P1 migration)')
    })
    it('post_pos_sales_to_gl handles tips', () => {
      const gl = read(GL_SQL)
      const p1 = read(P1_SQL)
      const hasTips = gl.includes('tip_total') || gl.includes('tips_payable') || gl.includes('v_account_tips')
        || p1.includes('tip_total') || p1.includes('tips_payable') || p1.includes('v_account_tips')
      assert.ok(hasTips, 'post_pos_sales_to_gl must handle tips (in GL or P1 migration)')
    })
    it('update_bill_status blocks direct paid transition', () => {
      const sql = read(AP_SQL)
      assert.ok(sql.includes('record_bill_payment') && (sql.includes('Use record_bill_payment') || sql.includes('p_status = \'paid\'')),
        'AP must block direct paid transition')
    })
  })

  describe('2. Domain Layer Exports', () => {
    it('restaurantGeneralLedger.js exports getJournalEntries', () => {
      const src = read(GL_DOMAIN)
      assert.ok(src.includes('getJournalEntries'))
    })
    it('restaurantGeneralLedger.js exports createJournalEntry', () => {
      const src = read(GL_DOMAIN)
      assert.ok(src.includes('createJournalEntry'))
    })
    it('restaurantGeneralLedger.js exports getGeneralLedger', () => {
      const src = read(GL_DOMAIN)
      assert.ok(src.includes('getGeneralLedger'))
    })
    it('restaurantGeneralLedger.js exports getTrialBalance', () => {
      const src = read(GL_DOMAIN)
      assert.ok(src.includes('getTrialBalance'))
    })
    it('restaurantGeneralLedger.js exports postPosSalesToGL', () => {
      const src = read(GL_DOMAIN)
      assert.ok(src.includes('postPosSalesToGL'))
    })
    it('restaurantGeneralLedger.js exports postExpensesToGL', () => {
      const src = read(GL_DOMAIN)
      assert.ok(src.includes('postExpensesToGL'))
    })
    it('restaurantGeneralLedger.js exports getProfitAndLoss', () => {
      const src = read(GL_DOMAIN)
      assert.ok(src.includes('getProfitAndLoss'))
    })
    it('restaurantGeneralLedger.js imports dedupePromise from infrastructure', () => {
      const src = read(GL_DOMAIN)
      assert.ok(src.includes("dedupePromise"))
      assert.ok(src.includes("'./infrastructure.js'"))
    })

    it('restaurantBankReconciliation.js exports getBankAccounts', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('getBankAccounts'))
    })
    it('restaurantBankReconciliation.js exports createBankAccount', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('createBankAccount'))
    })
    it('restaurantBankReconciliation.js exports updateBankAccount', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('updateBankAccount'))
    })
    it('restaurantBankReconciliation.js exports importBankStatement', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('importBankStatement'))
    })
    it('restaurantBankReconciliation.js exports getBankTransactions', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('getBankTransactions'))
    })
    it('restaurantBankReconciliation.js exports proposeBankMatches', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('proposeBankMatches'))
    })
    it('restaurantBankReconciliation.js exports approveBankMatch', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('approveBankMatch'))
    })
    it('restaurantBankReconciliation.js exports createBankReconciliation', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('createBankReconciliation'))
    })
    it('restaurantBankReconciliation.js exports completeBankReconciliation', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('completeBankReconciliation'))
    })
    it('restaurantBankReconciliation.js exports getBankReconciliations', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('getBankReconciliations'))
    })
    it('restaurantBankReconciliation.js imports dedupePromise from infrastructure', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes("dedupePromise"))
      assert.ok(src.includes("'./infrastructure.js'"))
    })

    it('restaurantPayroll.js exports getPayrollSettings', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('getPayrollSettings'))
    })
    it('restaurantPayroll.js exports updatePayrollSettings', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('updatePayrollSettings'))
    })
    it('restaurantPayroll.js exports createPayPeriod', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('createPayPeriod'))
    })
    it('restaurantPayroll.js exports getPayPeriods', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('getPayPeriods'))
    })
    it('restaurantPayroll.js exports calculatePayroll', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('calculatePayroll'))
    })
    it('restaurantPayroll.js exports getPayPeriodRecords', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('getPayPeriodRecords'))
    })
    it('restaurantPayroll.js exports updateEmployeePayRecord', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('updateEmployeePayRecord'))
    })
    it('restaurantPayroll.js exports approvePayroll', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('approvePayroll'))
    })
    it('restaurantPayroll.js exports generatePayslip', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('generatePayslip'))
    })
    it('restaurantPayroll.js exports postPayrollToGL', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('postPayrollToGL'))
    })
    it('restaurantPayroll.js imports dedupePromise from infrastructure', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes("dedupePromise"))
      assert.ok(src.includes("'./infrastructure.js'"))
    })
  })

  describe('3. Preload shutdown', () => {
    it('does not expose Restaurant Accounting namespaces while the module is unavailable', () => {
      const preload = read(PRELOAD)
      assert.ok(!preload.includes('restaurantBankReconciliation'))
      assert.ok(!preload.includes('restaurantAccounting:'))
      assert.ok(!preload.includes('restaurantPayroll:'))
    })
  })

  describe('4. Navigation Capabilities', () => {
    it('no nav entries use capability pos.reports', () => {
      const nav = read(DESKTOP_NAV)
      assert.ok(!nav.includes("capability: 'pos.reports'"), 'pos.reports capability should not exist')
    })

    it('keeps Accounting out of base navigation and exposes it only as a commercial add-on route', () => {
      const nav = read(DESKTOP_NAV)
      const bar = read(BAR_MODE)
      assert.ok(!nav.includes('/restaurant/chart-of-accounts'))
      assert.ok(!nav.includes('/restaurant/payroll'))
      assert.match(bar, /route: '\/restaurant\/chart-of-accounts'.*feature: 'restaurant_accounting'/)
      assert.match(bar, /route: '\/restaurant\/payroll'.*feature: 'payroll'/)
    })
  })

  describe('5. Data Validation', () => {
    it('postPosSalesToGL throws on missing startDate/endDate', () => {
      const src = read(GL_DOMAIN)
      const idx = src.indexOf('async function postPosSalesToGL')
      const body = src.slice(idx, idx + 500)
      assert.ok(body.includes('throw') && body.includes('required'), 'postPosSalesToGL must validate required params')
    })

    it('getGeneralLedger throws on missing accountId', () => {
      const src = read(GL_DOMAIN)
      const idx = src.indexOf('_getGeneralLedger')
      const body = src.slice(idx, idx + 500)
      assert.ok(body.includes('throw') && body.includes('required'), 'getGeneralLedger must validate accountId')
    })

    it('createPayPeriod validates name, startDate, endDate', () => {
      const src = read(PR_DOMAIN)
      const idx = src.indexOf('async function createPayPeriod')
      const body = src.slice(idx, idx + 500)
      assert.ok(body.includes('throw') && body.includes('required'), 'createPayPeriod must validate required params')
    })

    it('calculatePayroll validates payPeriodId', () => {
      const src = read(PR_DOMAIN)
      const idx = src.indexOf('async function calculatePayroll')
      const body = src.slice(idx, idx + 500)
      assert.ok(body.includes('throw') && body.includes('required'), 'calculatePayroll must validate payPeriodId')
    })
  })

  describe('6. Mutation Dedup Removed', () => {
    it('GL mutations are direct async functions', () => {
      const src = read(GL_DOMAIN)
      assert.ok(src.includes('export async function createJournalEntry'), 'createJournalEntry must be direct async')
      assert.ok(src.includes('export async function postPosSalesToGL'), 'postPosSalesToGL must be direct async')
      assert.ok(src.includes('export async function postExpensesToGL'), 'postExpensesToGL must be direct async')
    })
    it('BR mutations are direct async functions', () => {
      const src = read(BR_DOMAIN)
      assert.ok(src.includes('export async function createBankAccount'), 'createBankAccount must be direct async')
      assert.ok(src.includes('export async function updateBankAccount'), 'updateBankAccount must be direct async')
      assert.ok(src.includes('export async function importBankStatement'), 'importBankStatement must be direct async')
      assert.ok(src.includes('export async function proposeBankMatches'), 'proposeBankMatches must be direct async')
      assert.ok(src.includes('export async function approveBankMatch'), 'approveBankMatch must be direct async')
    })
    it('PR mutations are direct async functions', () => {
      const src = read(PR_DOMAIN)
      assert.ok(src.includes('export async function updatePayrollSettings'), 'updatePayrollSettings must be direct async')
      assert.ok(src.includes('export async function createPayPeriod'), 'createPayPeriod must be direct async')
      assert.ok(src.includes('export async function calculatePayroll'), 'calculatePayroll must be direct async')
      assert.ok(src.includes('export async function approvePayroll'), 'approvePayroll must be direct async')
      assert.ok(src.includes('export async function postPayrollToGL'), 'postPayrollToGL must be direct async')
    })
    it('read functions use parameterized dedup keys', () => {
      const src = read(GL_DOMAIN)
      assert.ok(src.includes('gl:getJournalEntries:'), 'getJournalEntries must use parameterized key')
    })
  })
})
