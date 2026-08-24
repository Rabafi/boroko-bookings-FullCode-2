import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8')

test('Open Tabs keeps named tabs in the active operational result', async () => {
  const pos = await read('src/main/domains/pos.js')
  const openChecks = await read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')

  assert.match(
    pos,
    /function isActivePosTab\(row = \{\}\) \{[\s\S]*?ACTIVE_TABLE_TAB_STATUSES\.has\(normalizeTabStatus\(row\.status\)\)/,
    'active POS filtering must include named tabs without a table_name',
  )
  assert.match(
    pos,
    /if \(status === 'active'\) return isActivePosTab\(row\)/,
    'the active tab query must use the POS-tab predicate',
  )
  assert.match(
    pos,
    /function isActiveTableTab\(row = \{\}\) \{[\s\S]*?normalizeTableName\(row\.table_name\)/,
    'table occupancy detection must retain its table_name requirement',
  )
  assert.match(
    openChecks,
    /getTabs\?\.\(\{ status: ["']active["'] \}\)/,
    'Open Tabs must request active server tabs',
  )
})

test('tab read completeness is operational while financial completeness stays row-scoped', async () => {
  const migration = await read(
    'supabase/migrations/20260820150000_pos_open_tabs_operational_read_completeness.sql',
  )

  assert.match(
    migration,
    /'complete', true/,
    'a complete operational tab read must remain usable when a line amount is unavailable',
  )
  assert.match(
    migration,
    /'financial_complete', v_financial_complete/,
    'the read must retain a separate aggregate financial-completeness signal',
  )
  assert.match(
    migration,
    /financial_complete\s+from jsonb_array_elements/,
    'each returned tab must still carry its row-level financial certification',
  )
})
