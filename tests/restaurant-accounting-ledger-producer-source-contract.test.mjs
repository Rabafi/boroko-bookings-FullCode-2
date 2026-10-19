import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const provenance = read('../supabase/migrations/20261013020000_restaurant_ledger_provenance_gate.sql')
const population = provenance.slice(
  provenance.indexOf('create or replace function public.restaurant_financial_source_population_v4'),
  provenance.indexOf('$$;', provenance.indexOf('create or replace function public.restaurant_financial_source_population_v4'))
)
const coverage = provenance.slice(
  provenance.indexOf('create or replace function public.get_restaurant_financial_source_coverage_v2'),
  provenance.indexOf('$$;', provenance.indexOf('create or replace function public.get_restaurant_financial_source_coverage_v2'))
)

test('producer-mapped families use the reviewed source relations and remain non-manual fail-closed', () => {
  const expected = {
    pos_sale: /from public\.pos_orders o[\s\S]*?p_source_type='pos_sale'/,
    pos_return: /from public\.pos_orders o[\s\S]*?p_source_type='pos_return'/,
    pos_void: /from public\.pos_orders o[\s\S]*?p_source_type='pos_void'/,
    voucher_redemption: /from public\.pos_orders o[\s\S]*?p_source_type='voucher_redemption'/,
    voucher_return: /from public\.pos_orders o[\s\S]*?p_source_type='voucher_return'/,
    customer_account_charge: /from public\.pos_orders o[\s\S]*?p_source_type='customer_account_charge'/,
    inventory_depletion: /from public\.pos_orders o[\s\S]*?p_source_type='inventory_depletion'/,
    direct_expense: /from public\.expenses e[\s\S]*?p_source_type='direct_expense'/,
    ap_bill: /from public\.restaurant_bills b[\s\S]*?p_source_type='ap_bill'/,
    ap_payment: /from public\.restaurant_bill_payments bp[\s\S]*?p_source_type='ap_payment'/,
    ap_credit_note: /from public\.restaurant_ap_credit_notes n[\s\S]*?p_source_type='ap_credit_note'/,
    inventory_receipt: /from public\.inventory_purchases p[\s\S]*?p_source_type='inventory_receipt'/,
    inventory_count: /from public\.inventory_stocktakes x[\s\S]*?p_source_type='inventory_count'/,
    settlement_and_fees: /from public\.restaurant_settlement_reconciliations s[\s\S]*?p_source_type='settlement_and_fees'/,
    cashup_variance: /from public\.pos_cashup_sessions c[\s\S]*?p_source_type='cashup_variance'/,
    payroll_accrual: /from public\.restaurant_pay_periods p[\s\S]*?p_source_type='payroll_accrual'/,
    payroll_settlement: /from public\.restaurant_pay_periods p[\s\S]*?p_source_type='payroll_settlement'/,
    tax_adjustment: /from public\.restaurant_tax_adjustments a[\s\S]*?p_source_type='tax_adjustment'/,
    manual_journal: /from public\.restaurant_manual_journal_drafts d[\s\S]*?p_source_type='manual_journal'/
  }
  for (const [source, relation] of Object.entries(expected)) {
    assert.match(population, relation, `${source} must map to its producer relation`)
  }
  assert.match(coverage, /if r\.source_type='manual_journal' then[\s\S]*?else\s+result:=jsonb_build_object\('complete',false/)
  assert.match(coverage, /'subledger_total',case when r\.source_type='manual_journal'/)
  assert.match(coverage, /'gl_total',case when r\.source_type='manual_journal'/)
})

test('POS population follows terminal order state, tender aliases, and stored business date', () => {
  const pos = read('../supabase/migrations/20260807120000_bar_accounting_financial_truth_control_plane.sql')
  const writer = pos.slice(pos.indexOf('create or replace function public._restaurant_post_pos_order_to_gl_v2'))
  assert.match(population, /o\.business_date between p_start_date and p_end_date or o\.business_date is null/)
  assert.match(population, /o\.status in \('completed','settled'\)/)
  assert.match(population, /o\.status='voided'/)
  assert.match(population, /payment_breakdown/)
  assert.match(writer, /business_date:=coalesce\(o\.business_date,[\s\S]*o\.completed_at[\s\S]*public\.get_lodge_business_date/)
  assert.match(writer, /record_restaurant_source_posting\(p_lodge,'pos_order',p_order_id,business_date/)
  assert.match(writer, /operation_id,payload_hash,1,o\.outlet_id,'posted'/)
  assert.match(writer, /payload_hash:=encode\(digest\(to_jsonb\(o\)::text\|\|coalesce\(o\.payment_breakdown/)
})

test('expense, AP, and inventory producer evidence is not promoted to immutable class proof', () => {
  const expenses = read('../supabase/migrations/20260807320000_expense_tax_detail_posting.sql')
  const ap = read('../supabase/migrations/20260807410000_ap_supplier_controls_and_credit_notes.sql')
  const sourceTriggers = read('../supabase/migrations/20260807120000_bar_accounting_financial_truth_control_plane.sql')
  const inv = read('../supabase/migrations/20260807310000_inventory_purchase_and_stocktake_gl_posting.sql')
  assert.match(expenses, /record_restaurant_source_posting\(p_lodge_id,'expense',p_id,v_business_date[\s\S]*v_hash,1/)
  assert.match(sourceTriggers, /new\.bill_date[\s\S]*digest\(to_jsonb\(new\)::text,'sha256'\)/)
  assert.match(sourceTriggers, /new\.payment_date[\s\S]*digest\(to_jsonb\(new\)::text,'sha256'\)/)
  assert.match(ap, /approval_payload_hash = v_hash/)
  assert.match(ap, /record_restaurant_source_posting\([\s\S]*'ap_credit_note'/)
  assert.match(inv, /record_restaurant_source_posting\([\s\S]*'inventory_purchase'/)
  assert.match(inv, /record_restaurant_source_posting\([\s\S]*'inventory_stocktake'/)
  assert.match(inv, /encode\(digest\(v_lines::text,'sha256'\),'hex'\)/)
  assert.match(population, /select x\.id, null::date[\s\S]*p_source_type='inventory_count'/)
  assert.match(population, /select p\.id, null::date[\s\S]*p_source_type='payroll_settlement'/)
})

test('settlement, cash-up, payroll, and tax producers retain aliases without certifying allocations', () => {
  const settlement = read('../supabase/migrations/20260807330000_settlement_source_gl_posting.sql')
  const cashup = read('../supabase/migrations/20260807340000_cashup_variance_source_gl_posting.sql')
  const payroll = read('../supabase/migrations/20260720080000_restaurant_accounting_payroll_rebuild.sql')
  const payrollSettlement = read('../supabase/migrations/20260807240000_payroll_payment_batches_and_idempotency.sql')
  const tax = read('../supabase/migrations/20260807350000_tax_amendment_and_adjustment_lifecycle.sql')
  assert.match(settlement, /record_restaurant_source_posting\([\s\S]*'settlement'/)
  assert.match(population, /coalesce\(s\.settlement_date,s\.business_date\)/)
  assert.match(cashup, /record_restaurant_source_posting\([\s\S]*'cashup'/)
  assert.match(population, /cash_over_short,0\)<>0/)
  assert.match(payroll, /post_restaurant_payroll_to_gl_v2/)
  assert.match(payrollSettlement, /coalesce\(p_settlement_date, v_period\.end_date\)/)
  assert.match(payrollSettlement, /insert into public\.restaurant_financial_source_postings[\s\S]*'payroll_settlement'/)
  assert.match(population, /p\.settlement_status in \('settled','reconciled'\)/)
  assert.match(tax, /create or replace function public\.approve_restaurant_tax_adjustment/)
  assert.match(population, /p_source_type='tax_adjustment'[\s\S]*a\.status='approved'/)
  assert.match(coverage, /when r\.source_type<>'manual_journal' then/)
})
