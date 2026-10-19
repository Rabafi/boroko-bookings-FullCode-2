import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { discoverRestaurantSuites } from './run-restaurant-suite.mjs'
import { connectLedgerDisposableDatabase } from './helpers/ledger-disposable-connection.mjs'

const sql = fs.readFileSync(new URL('../supabase/migrations/20261013020000_restaurant_ledger_provenance_gate.sql', import.meta.url), 'utf8')
const sqlTests = fs.readFileSync(new URL('./restaurant-accounting-ledger-provenance-sql.test.mjs', import.meta.url), 'utf8')
const runner = fs.readFileSync(new URL('../scripts/accounting-ledger-disposable-v4.mjs', import.meta.url), 'utf8')
const registrySql = fs.readFileSync(new URL('../supabase/migrations/20260807460000_financial_source_coverage_registry.sql', import.meta.url), 'utf8')
const contractRegister = fs.readFileSync(new URL('../docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/SOURCE_CONTRACT_REGISTER_20261013.md', import.meta.url), 'utf8')
function body(name) { return sql.slice(sql.indexOf('create or replace function public.' + name), sql.indexOf('$$;', sql.indexOf('create or replace function public.' + name))) }
test('preserves original candidate and adds a separate forward migration', () => {
  const old = fs.readFileSync(new URL('../supabase/migrations/20261013010000_restaurant_ledger_source_identity_gate.sql', import.meta.url))
  assert.equal(crypto.createHash('sha256').update(old).digest('hex'), '10a89246e8dde59330febce7615524306abea30a248e30ab3a1b489deef09a87')
  assert.match(sql, /begin;[\s\S]*commit;\s*$/)
})
test('snapshot and IDs have one exact shared source population', () => {
  for (const name of ['restaurant_financial_source_snapshot', 'restaurant_financial_source_expected_ids_v3']) assert.match(body(name), /restaurant_financial_source_population_v4\(p_lodge_id,p_source_type,p_start_date,p_end_date\)/)
  assert.match(body('restaurant_financial_source_snapshot'), /'source_ids'/)
  const population = body('restaurant_financial_source_population_v4')
  assert.doesNotMatch(population, /created_at|paid_at|posted_at|current_date|get_lodge_business_date/)
  assert.match(population, /o\.business_date is null/)
  assert.match(population, /select x.id, null::date/)
})
test('manual producer identity uses governed draft UUID and original canonical hash recipes', () => {
  const manual = body('restaurant_manual_journal_evidence_v4')
  assert.match(manual, /'source_id',d.id/)
  assert.match(manual, /d\.payload_hash=canonical_hash/)
  assert.match(manual, /d\.approved_by<>d\.created_by/)
  assert.match(manual, /'operation_id',d.operation_id/)
  assert.match(manual, /'reversal_of',null/)
  assert.doesNotMatch(manual, /digest\(to_jsonb\(/)
  assert.match(sql, /before update on public\.restaurant_manual_journal_drafts/)
  assert.match(sql, /old\.operation_id,old\.payload_hash/)
})
test('reconciles exact account/debit/credit multisets, retaining equal-valued lines', () => {
  const checker = body('restaurant_financial_evidence_check_v4')
  assert.equal((checker.match(/except all/g) || []).length, 2)
  for (const field of ['source_version','source_payload_hash','journal_payload_hash','journal_entry_id','journal_date','journal_source_id','journal_lodge_id','shared_journal_count']) assert.ok(checker.includes("a->>'" + field + "'"))
  assert.doesNotMatch(sql, /sum\s*\(\s*distinct/i)
})
test('actual census retains exceptional/orphan/unmapped/shared/stale postings and untracked journals', () => {
  const census = body('restaurant_financial_posting_exceptions_v4')
  assert.match(census, /from public\.restaurant_financial_source_postings s left join/)
  for (const reason of ['unexpected_or_orphan_posting','ambiguous_posting_alias','stale_or_duplicate_source_version','duplicate_alias_or_shared_journal','journal_without_governed_source_evidence']) assert.ok(census.includes(reason))
  assert.match(census, /status<>'posted'/)
})
test('unproven and unknown families remain incomplete even without source rows', () => {
  const coverage = body('get_restaurant_financial_source_coverage_v2')
  assert.match(coverage, /when r\.source_type<>'manual_journal'/)
  assert.match(coverage, /if r\.enabled and reason is not null/)
  assert.match(coverage, /jsonb_array_length\(exceptions\)>0/)
  assert.match(coverage, /no_enabled_verified_source_registry/)
  assert.match(coverage, /'subledger_total'.*else null end/)
  assert.match(coverage, /language plpgsql stable security definer/)
})
test('desktop/close wrapper delegates to v4 with existing capability and unchanged public ACL', () => {
  const wrapper = body('get_restaurant_financial_source_coverage(')
  assert.match(wrapper, /_restaurant_require_capability\(p_lodge_id,'accounting.read'\)/)
  assert.match(wrapper, /return public.get_restaurant_financial_source_coverage_v2/)
  assert.doesNotMatch(sql, /grant execute[^;]+to (anon|authenticated)/is)
  assert.match(sql, /from public,anon,authenticated/)
})
test('source and SQL behavior suites are actually discoverable by maintained Restaurant runner', () => {
  const discovered = discoverRestaurantSuites()
  for (const name of ['restaurant-accounting-ledger-provenance-contract.test.mjs','restaurant-accounting-ledger-provenance-sql.test.mjs','restaurant-accounting-remediation-regressions.test.mjs']) assert.ok(discovered.includes(name))
})
test('ordered migration runner verifies the genuine staff wrapper before dispatch', () => {
  const sessionCheck = runner.indexOf('LUNA_REMEDIATION_LEDGER_STAFF_SESSION')
  const wrapperCheck = runner.indexOf('genuine_staff_wrapper_preflight')
  const dispatch = runner.indexOf('report.migration_application_attempted = true')
  assert.ok(sessionCheck >= 0 && wrapperCheck > sessionCheck && dispatch > wrapperCheck)
  assert.match(runner, /begin read only[\s\S]*set local role anon[\s\S]*get_restaurant_financial_source_coverage/)
  assert.match(runner, /server details suppressed/)
})
test('prepared SQL acceptance covers exact manual eligibility and independent posting diagnostics', () => {
  for (const phrase of [
    'manual expected population is exactly posted governed drafts',
    'every non-manual family remains unverified',
    'wrong manual operation payload hash',
    'wrong manual journal posting key',
    'independent posting census must not depend on expected-source membership',
    'failed',
    'shared journal cannot certify or double-count',
    'approved genuine operator wrapper/Statements/export/close remain fail-closed'
  ]) assert.ok(sqlTests.includes(phrase), phrase)
})
test('every omitted registry population has an explicit fail-closed contract record', () => {
  const stop = registrySql.indexOf('on conflict(source_type)')
  const registry = [...registrySql.slice(0, stop).matchAll(/\('([^']+)','[^']+','[^']+'/g)].map(match => match[1])
  const population = [...body('restaurant_financial_source_population_v4').matchAll(/p_source_type='([^']+)'/g)].map(match => match[1])
  const omitted = registry.filter(type => !population.includes(type)).sort()
  const expected = ['booking_folio_charge','booking_invoice','booking_payment','booking_refund','conference_event_revenue',
    'customer_account_payment','customer_account_refund','customer_credit_allocation','customer_credit_receipt',
    'customer_credit_refund','day_use_revenue','inventory_writeoff','maintenance_cost','supplies_purchase','voucher_expiry','voucher_issue'].sort()
  assert.deepEqual(omitted, expected)
  for (const type of omitted) assert.ok(contractRegister.includes('`' + type + '`'), type)
})
const guardedEnv = { LUNA_REMEDIATION_TARGET_MARKER: 'LUNA-REMEDIATION-DISPOSABLE-v1', LUNA_REMEDIATION_EXPECTED_DATABASE: 'postgres', LUNA_REMEDIATION_EXPECTED_PROJECT_REF: 'repsrmlomedqrmrdsbga' }
test('executable connection guard refuses missing SQL settings before connection', async () => {
  await assert.rejects(connectLedgerDisposableDatabase(guardedEnv), /required; no database fallback/)
})
test('executable connection guard refuses localhost even with approved project label', async () => {
  await assert.rejects(connectLedgerDisposableDatabase({ ...guardedEnv, LUNA_REMEDIATION_TEST_DB_URL: 'postgres://fixture@localhost/postgres' }), /no localhost fallback/)
})
test('executable connection guard refuses another project and linked production', async () => {
  await assert.rejects(connectLedgerDisposableDatabase({ ...guardedEnv, LUNA_REMEDIATION_EXPECTED_PROJECT_REF: 'anotherdisposable', LUNA_REMEDIATION_TEST_DB_URL: 'postgres://fixture@db.anotherdisposable.supabase.co/postgres' }), /Only repsrmlomedqrmrdsbga/)
  await assert.rejects(connectLedgerDisposableDatabase({ ...guardedEnv, LUNA_REMEDIATION_TEST_DB_URL: 'postgres://fixture@db.oicgpknsmtvcsjacymum.supabase.co/postgres' }), /explicitly denied/)
})
test('executable connection guard refuses an incorrect marker without a network request', async () => {
  await assert.rejects(connectLedgerDisposableDatabase({ ...guardedEnv, LUNA_REMEDIATION_TARGET_MARKER: 'incorrect', LUNA_REMEDIATION_TEST_DB_URL: 'postgres://fixture@db.repsrmlomedqrmrdsbga.supabase.co/postgres' }), /verified disposable target/)
})
