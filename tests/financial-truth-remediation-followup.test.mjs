import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { calculatePosFinancialTruth } from '../src/shared/posFinancialTruth.js'

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8')
const remediation = read('supabase/migrations/20260807560000_financial_truth_remediation_followup.sql')
const main = read('src/main/index.js')

test('return tender controls use the signed return amount exactly once', () => {
  const result = calculatePosFinancialTruth([
    { id: 'sale', status: 'completed', transaction_type: 'sale', total: 100, payment_breakdown: [{ method: 'cash', amount: 100 }] },
    { id: 'return', status: 'completed', transaction_type: 'return', total: -40, payment_breakdown: [{ method: 'cash', amount: -40 }] }
  ], { dataset_complete: true })
  assert.equal(result.controls.net_recorded_sales, 60)
  assert.equal(result.controls.tender_totals.cash, 60)
  assert.match(remediation, /Tender signs must match the authoritative POS order sign/)
  assert.match(remediation, /round\(v_total-coalesce\(new\.total,0\),2\)/)
})

test('POS returns cannot post before cumulative tender reconciliation', () => {
  assert.match(remediation, /restaurant_pos_return_tender_reversals/)
  assert.match(remediation, /restaurant_post_reconciled_pos_return_to_gl/)
  assert.match(remediation, /if public\.restaurant_accounting_is_active\(new\.lodge_id\) then return new; end if;/)
})

test('the remediation preserves public RPC identities for existing callers', () => {
  assert.doesNotMatch(remediation, /alter function public\.get_pos_financial_report_export_v2\(uuid,date,date,uuid\)\s+rename/i)
  assert.doesNotMatch(remediation, /alter function public\.get_restaurant_financial_statements_v2\(uuid,date,date\)\s+rename/i)
  assert.match(remediation, /create or replace function public\.get_pos_financial_report_export_v2\(/)
  assert.match(remediation, /create or replace function public\.get_restaurant_financial_statements_v2\(/)
})

test('customer DTO and operational report artifacts are scoped to their authenticated actor', () => {
  assert.match(remediation, /get_restaurant_customer_account_dto/)
  assert.match(remediation, /_restaurant_require_operational_report_access\(p_lodge_id,'pos\.view'\)/)
  assert.match(remediation, /v_run\.generated_by is distinct from v_actor/)
  assert.match(remediation, /v_run\.report_key<>'pos_financial_detail_v2'/)
})

test('statements retain cumulative earnings and the account-row DTO expected by the UI', () => {
  assert.match(remediation, /v_cumulative_revenue/)
  assert.match(remediation, /v_total_equity:=v_stock_equity\+v_cumulative_revenue-v_cumulative_expense/)
  assert.match(remediation, /'assets',v_assets_rows,'liabilities',v_liability_rows,'equity',v_equity_rows/)
  assert.match(remediation, /v_cash_flow_complete:=not\(v_cash_flow \? 'unclassified'\)/)
})

test('bank split allocation checks current locked availability, and exports inspect local pending work', () => {
  assert.match(remediation, /if v_amount>v_available then raise exception 'Journal amount is overallocated'/)
  assert.match(remediation, /if v_amount>v_available then raise exception 'Bank row is overallocated'/)
  assert.match(remediation, /review_bank_match_allocation_v1/)
  assert.doesNotMatch(remediation, /status in \('proposed','rejected'\)/)
  assert.match(main, /assertCompletePosHistoryExport\(orders, voidHistory, localOrders\)/g)
  assert.match(main, /db\.getPosOrders\(start, end, outletFilter\)/g)
})
