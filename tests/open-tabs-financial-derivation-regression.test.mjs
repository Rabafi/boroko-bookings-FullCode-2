import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8')

test('held-tab values are derived from persisted unit price and quantity on the server', async () => {
  const migration = await read(
    'supabase/migrations/20260820170000_pos_tab_server_derived_line_values.sql',
  )

  assert.match(
    migration,
    /create or replace function public\.derive_pos_tab_financial_snapshot\(p_items jsonb\)[\s\S]*?immutable[\s\S]*?security invoker/i,
    'the reusable line-value helper must be immutable and non-privileged',
  )
  assert.match(
    migration,
    /v_line_amount := round\(v_unit_price \* v_quantity, 2\)/,
    'the server must calculate line values from persisted unit price and quantity',
  )
  assert.match(
    migration,
    /'line_subtotal', v_line_amount,[\s\S]*?'line_total', v_line_amount/,
    'the server must write both derived line fields',
  )
  assert.match(
    migration,
    /v_quantity <= 0 or v_unit_price < 0/,
    'non-positive quantities and negative prices must fail closed',
  )
  assert.match(
    migration,
    /if not v_complete then[\s\S]*?'financial_complete', false/,
    'malformed lines must not produce a financial value',
  )
  assert.doesNotMatch(
    migration,
    /coalesce\(nullif\(value->>'line_total'/,
    'the repaired contract must not trust renderer-authored line totals',
  )
})

test('upsert and the operational read share the same server-derived contract', async () => {
  const migration = await read(
    'supabase/migrations/20260820170000_pos_tab_server_derived_line_values.sql',
  )

  assert.match(
    migration,
    /create or replace function public\.get_restaurant_pos_tabs_financial_truth_unscoped[\s\S]*?derive_pos_tab_financial_snapshot\(coalesce\(t\.items, '\[\]'::jsonb\)\)/,
    'the operational read must derive values for existing rows',
  )
  assert.match(
    migration,
    /create or replace function public\.upsert_pos_tab\(payload jsonb\)[\s\S]*?v_financial := public\.derive_pos_tab_financial_snapshot\(coalesce\(payload->'items', '\[\]'::jsonb\)\)/,
    'new and resumed tabs must persist the same derived values',
  )
  assert.match(
    migration,
    /'complete', true[\s\S]*?'financial_complete', v_financial_complete/,
    'operational read completeness must remain separate from row financial completeness',
  )
  assert.match(
    migration,
    /'total', s\.total[\s\S]*?'financial_complete', s\.financial_complete/,
    'the top-level fields consumed by Open Tabs must carry the derived amount',
  )
  assert.match(
    migration,
    /revoke all on function public\.derive_pos_tab_financial_snapshot\(jsonb\)[\s\S]*?grant execute on function public\.derive_pos_tab_financial_snapshot\(jsonb\)\s+to service_role/i,
    'the derivation helper must not be directly callable by app clients',
  )
  assert.match(
    migration,
    /revoke all on function public\.upsert_pos_tab\(jsonb\)[\s\S]*?grant execute on function public\.upsert_pos_tab\(jsonb\)\s+to anon, authenticated, service_role/i,
    'the existing app-session upsert grant must remain explicit',
  )
})
