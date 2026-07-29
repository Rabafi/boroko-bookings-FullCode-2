import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const main = read('src/main/index.js')
const bankUi = read('src/renderer/src/components/restaurant-accounting/RestaurantBankReconciliation.jsx')
const containment = read('supabase/migrations/20260718050000_restaurant_accounting_p2_financial_write_containment.sql')

const containedFunctions = [
  'post_pos_sales_to_gl\\(uuid, date, date\\)',
  'post_expenses_to_gl\\(uuid, date, date\\)',
  'approve_bank_match\\(uuid, uuid, boolean\\)',
  'complete_bank_reconciliation\\(uuid, uuid, text\\)',
  'update_bill_status\\(uuid, uuid, text\\)',
  'record_bill_payment\\(uuid, uuid, date, numeric, text, text, text, text\\)',
  'update_tax_return\\(uuid, uuid, text, text\\)',
  'create_pay_period\\(uuid, text, date, date\\)',
  'calculate_payroll\\(uuid, uuid\\)',
  'update_employee_pay_record\\(uuid, uuid, jsonb\\)',
  'approve_payroll\\(uuid, uuid\\)',
  'post_payroll_to_gl\\(uuid, uuid\\)'
]

describe('Restaurant Accounting P2 financial containment', () => {
  it('removes the Accounting IPC handlers now that the module is unavailable', () => {
    assert.doesNotMatch(main, /restaurantAccounting:getAccounts/)
    assert.doesNotMatch(main, /restaurantGeneralLedger:createJournalEntry/)
    assert.doesNotMatch(main, /restaurantPayroll:postPayrollToGL/)
  })

  it('unwraps the chart-of-accounts RPC result before rendering bank-account options', () => {
    assert.match(bankUi, /setGlAccounts\(Array\.isArray\(result\?\.data\) \? result\.data : \[\]\)/)
    assert.match(bankUi, /setPreviewTxns\(\[\]\)/)
    assert.match(bankUi, /disabled=\{Boolean\(editAccount\)\}/)
  })

  it('removes authenticated execution from every temporarily contained financial transition', () => {
    for (const signature of containedFunctions) {
      assert.match(containment, new RegExp(`revoke execute on function public\\.${signature} from authenticated;`))
      assert.match(containment, new RegExp(`grant execute on function public\\.${signature} to service_role;`))
    }
  })
})