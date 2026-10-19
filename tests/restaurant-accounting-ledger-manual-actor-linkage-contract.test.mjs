import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { discoverRestaurantSuites } from './run-restaurant-suite.mjs'

const migrationPath = new URL('../supabase/migrations/20261013030000_restaurant_manual_journal_post_actor_binding.sql', import.meta.url)
const migration = readFileSync(migrationPath, 'utf8')
const sqlSuite = readFileSync(new URL('./restaurant-accounting-ledger-provenance-sql.test.mjs', import.meta.url), 'utf8')
const runner = readFileSync(new URL('../scripts/accounting-ledger-disposable-v4.mjs', import.meta.url), 'utf8')

test('manual journal actor binding is a forward migration after preserved ledger candidates', () => {
  assert.match(migration, /\bbegin;\s*\n/i)
  assert.match(migration, /commit;\s*$/i)
  assert.match(migration, /restaurant_manual_journal_actor_match_v5/)
  assert.match(migration, /p_draft_poster\s*=\s*p_journal_creator/i)
  assert.match(migration, /restaurant_manual_journal_evidence_v4\(p_lodge_id uuid,p_source_id uuid\)/)
  assert.match(migration, /restaurant_manual_journal_actor_match_v5\(d\.posted_by,journal_creator\)/)
  assert.match(migration, /posted_actor_journal_creator_mismatch/)
  assert.match(migration, /where j\.id=d\.journal_entry_id and j\.lodge_id=p_lodge_id/)
  assert.doesNotMatch(migration, /restaurant_financial_source_coverage_v2\s*\(/)
})

test('disposable candidate runner orders preserved migrations before actor-binding correction', () => {
  assert.match(runner, /20261013010000_restaurant_ledger_source_identity_gate\.sql/)
  assert.match(runner, /20261013020000_restaurant_ledger_provenance_gate\.sql/)
  assert.match(runner, /version = '20261013030000'/)
  assert.match(runner, /version \+ '_restaurant_manual_journal_post_actor_binding\.sql'/)
  assert.match(runner, /migrationChain\.filter\(migration => !history\.some/)
  assert.match(runner, /historyAfter[\s\S]*where version=any\(\$1::text\[\]\)[\s\S]*\[versions\]/)
})

test('maintained Restaurant discovery includes source guard and prepared PostgreSQL actor regression', () => {
  const discovered = discoverRestaurantSuites()
  assert.ok(discovered.includes('restaurant-accounting-ledger-manual-actor-linkage-contract.test.mjs'))
  assert.ok(discovered.includes('restaurant-accounting-ledger-provenance-sql.test.mjs'))
  assert.match(sqlSuite, /manual journal actor-link guard rejects a journal creator different from the draft poster/)
  assert.match(sqlSuite, /restaurant_manual_journal_actor_match_v5\(\$1::uuid,\$2::uuid\)/)
  assert.match(sqlSuite, /d\.posted_by,j\.created_by/)
})
