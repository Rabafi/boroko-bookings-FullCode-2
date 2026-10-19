import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync(new URL('../supabase/migrations/20261013010000_restaurant_ledger_source_identity_gate.sql', import.meta.url), 'utf8')

function body(name) {
  const marker = 'create or replace function public.' + name
  const start = migration.indexOf(marker)
  assert.notEqual(start, -1, 'expected forward migration to define ' + name)
  const end = migration.indexOf('$$;', start)
  assert.notEqual(end, -1, 'expected ' + name + ' body terminator')
  return migration.slice(start, end + 3)
}

test('ledger coverage maps every implemented source family to authoritative row identity and business date', () => {
  const expected = body('restaurant_financial_source_expected_ids_v3')
  for (const sourceType of [
    'pos_sale', 'pos_return', 'pos_void', 'voucher_redemption', 'voucher_return',
    'customer_account_charge', 'inventory_depletion', 'direct_expense', 'ap_bill',
    'ap_payment', 'ap_credit_note', 'inventory_receipt', 'inventory_count',
    'settlement_and_fees', 'cashup_variance', 'payroll_accrual',
    'payroll_settlement', 'tax_adjustment', 'manual_journal'
  ]) {
    assert.ok(expected.includes("p_source_type='" + sourceType + "'"), 'missing exact source identity mapping: ' + sourceType)
  }
  assert.match(expected, /returns table\(source_id uuid, business_date date\)/)
  assert.match(expected, /p_lodge_id/)
})

test('coverage cannot count a different same-day posting as the expected source row', () => {
  const coverage = body('get_restaurant_financial_source_coverage_v2')
  assert.match(coverage, /s\.source_id=e\.source_id and s\.business_date=e\.business_date/)
  assert.match(coverage, /count\(distinct e\.source_id\) filter\(where s\.status='posted' and je\.id is not null\)/)
  assert.match(coverage, /expected_rows>posted_rows/)
  assert.doesNotMatch(coverage, /s\.business_date between p_start_date and p_end_date\s+group by/)
})

test('linked journals must be posted in the same lodge on the source business date', () => {
  const coverage = body('get_restaurant_financial_source_coverage_v2')
  assert.match(coverage, /je\.id=s\.journal_entry_id and je\.lodge_id=p_lodge_id and je\.is_posted and je\.entry_date=s\.business_date/)
  assert.match(coverage, /posted source has no same-lodge posted journal entry on the source business date/)
  assert.match(coverage, /s\.journal_entry_id is null or je\.id is null/)
})

test('whole-order POS aggregates cannot certify tender-specific or inventory-cost source coverage', () => {
  assert.match(migration, /set posting_contract='unsupported'/)
  for (const sourceType of ['voucher_redemption', 'voucher_return', 'customer_account_charge', 'inventory_depletion']) {
    assert.ok(migration.includes("'" + sourceType + "'"), 'missing fail-closed source family: ' + sourceType)
  }
  assert.ok(migration.includes('tender-specific or') && migration.includes('cost-specific amount'))
  const coverage = body('get_restaurant_financial_source_coverage_v2')
  assert.match(coverage, /when posting_contract='unsupported' then 'unsupported'/)
})

test('ledger coverage remains service-role-only and keeps unknown sources fail-closed', () => {
  assert.match(migration, /revoke all on function public\.restaurant_financial_source_expected_ids_v3\(uuid,text,date,date\) from public,anon,authenticated/i)
  assert.match(migration, /grant execute on function public\.restaurant_financial_source_expected_ids_v3\(uuid,text,date,date\) to service_role/i)
  assert.match(migration, /revoke all on function public\.get_restaurant_financial_source_coverage_v2\(uuid,date,date\) from public,anon,authenticated/i)
  assert.match(migration, /grant execute on function public\.get_restaurant_financial_source_coverage_v2\(uuid,date,date\) to service_role/i)
  const coverage = body('get_restaurant_financial_source_coverage_v2')
  assert.match(coverage, /posting_contract='unsupported'/)
  assert.match(coverage, /v_complete:=v_effective is not null and jsonb_array_length\(v_missing\)=0/)
})
