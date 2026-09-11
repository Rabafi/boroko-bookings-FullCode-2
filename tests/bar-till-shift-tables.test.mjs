import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { shouldLoadTillTables } from '../src/shared/barModeProfile.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('shouldLoadTillTables skips floor tables for Bar-only service', () => {
  assert.equal(shouldLoadTillTables(true), false)
  assert.equal(shouldLoadTillTables(false), true)
  assert.equal(shouldLoadTillTables({ commercial_package_key: 'bar_pos' }), false)
  assert.equal(shouldLoadTillTables({ hospitality_mode: 'bar_only' }), false)
  assert.equal(shouldLoadTillTables({ hospitality_mode: 'restaurant_bar' }), true)
  assert.equal(shouldLoadTillTables({}), true)
  assert.equal(shouldLoadTillTables(null), true)
  assert.equal(shouldLoadTillTables(undefined), true)
})

test('Bar Till gates only the floor-table read; shift loading stays unconditional', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(terminal, /shouldLoadTillTables,\s*\n\} from "\.\.\/\.\.\/\.\.\/\.\.\/shared\/barModeProfile"/)
  // The tables fetch is conditional on the Bar helper ...
  assert.match(terminal, /const tablePromise = shouldLoadTillTables\(barOnly\)/)
  // ... while the shift fetch is not: it must run for Bar too so the
  // operator/outlet shift is never lost when tables are skipped.
  assert.match(
    terminal,
    /window\.api\?\.pos\?\.getCurrentShift\?\.\(selectedOutlet\.id, shiftCashierId\)/,
  )
  // The outlet effect re-runs when the hospitality mode flips.
  assert.match(
    terminal,
    /\[selectedOutlet\?\.id, sharedTerminalMode, user\?\.id, verifiedOperator\?\.id, barOnly\]/,
  )
  // Post-action refreshes after hold and payment are gated the same way.
  const gatedRefreshes = terminal.match(/if \(shouldLoadTillTables\(barOnly\)\) \{/g) || []
  assert.ok(
    gatedRefreshes.length >= 2,
    `expected hold + payment table refreshes to be gated, found ${gatedRefreshes.length}`,
  )
})

test('Bar tab-name suggestions come from the tab list, not floor tables', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(terminal, /const \[openTabNames, setOpenTabNames\] = useState\(\[\]\)/)
  assert.match(terminal, /setOpenTabNames\(/)
  assert.match(terminal, /tab\?\.tab_name \|\| tab\?\.table_name/)
  assert.match(terminal, /barOnly\s*\n?\s*\? openTabNames\.map\(\(name\) =>/)
})

test('stale voucher values clear when the sale leaves walk-up counter mode', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  // Mirrors the voucher row render condition (counter modes without a
  // selected customer), so hidden codes can never reach the breakdown.
  assert.match(terminal, /serviceMode === "tab" \|\|/)
  assert.match(terminal, /serviceMode === "table" \|\|/)
  assert.match(terminal, /Boolean\(selectedCustomerId\)/)
  assert.match(terminal, /\}, \[serviceMode, selectedCustomerId\]\);/)
})
