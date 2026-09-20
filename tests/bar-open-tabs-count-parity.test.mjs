import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const CLOSED_STATUSES = ['closed', 'paid', 'cancelled', 'voided']

test('Till reads the same active-filtered tabs as Open Tabs, never an unfiltered merge', () => {
  const till = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(
    till,
    /getTabs\?\.\(\{\s*status:\s*"active"\s*\}\)/,
    'Till must request the active-filtered tab read so non-pending local orphans cannot inflate its count',
  )
  assert.doesNotMatch(
    till,
    /getTabs\?\.\(\)/,
    'Till must not issue a bare unfiltered tab read anywhere',
  )

  const openChecks = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')
  assert.match(
    openChecks,
    /getTabs\?\.\(\{\s*status:\s*"active"\s*\}\)/,
    'Open Tabs must keep its active-filtered authoritative read',
  )
})

test('Till count, brief and suggestions share Open Tabs’ closed-status predicate', () => {
  const till = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  const openChecks = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')
  const layout = read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')

  for (const status of CLOSED_STATUSES) {
    assert.ok(till.includes(`"${status}"`), `Till predicate must exclude ${status}`)
    assert.ok(openChecks.includes(`"${status}"`), `Open Tabs predicate must exclude ${status}`)
  }
  assert.match(
    layout,
    /!\['closed', 'paid', 'cancelled', 'voided'\]/,
    'Rail badge must keep the same closed-status predicate',
  )
  // The refresh path must reuse the identical predicate, not a second list.
  const predicateOccurrences = (till.match(/closed", "paid", "cancelled", "voided/g) || []).length
  assert.ok(
    predicateOccurrences >= 3,
    `Till initial load, refresh and brief must all share one predicate (found ${predicateOccurrences})`,
  )
})

test('Till tab count refreshes instead of freezing at mount', () => {
  const till = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(till, /refreshOpenTabs/, 'Till must own a tab-count refresh, not just a mount-time load')
  assert.match(till, /setInterval\(refreshOpenTabs,\s*15000\)/, 'Refresh cadence must match Open Tabs (15s)')
  assert.match(till, /visibilitychange/, 'Returning to the Till must re-read tabs immediately')
  assert.match(till, /setOpenTabCount\(open\.length\)/, 'Refresh must recompute the pill count from the fresh read')
})

test('Domain active-tab reads merge pending estimates only, never every local orphan', () => {
  const posDomain = read('src/main/domains/pos.js')
  assert.match(
    posDomain,
    /pendingLocal = applyPosTabFilters\(readPosTabs\(\), filters\)\.filter\(\(row\) => row\?\._pending_sync === true\)/,
    'Active reads must merge only pending-sync locals so settled orphans cannot resurface as open',
  )
  assert.match(
    posDomain,
    /if \(String\(filters\.status \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'active'\)/,
    'The pending-only merge must stay scoped to the active contract',
  )
})

test('Authoritative server read filters active server-side for the active contract', () => {
  const migration = read('supabase/migrations/20260820150000_pos_open_tabs_operational_read_completeness.sql')
  assert.match(
    migration,
    /lower\(p_status\) = 'active' and t\.status in \('open', 'running', 'ready', 'delivered'\)/,
    'Server must return exactly the four active statuses for the active contract both surfaces share',
  )
})
