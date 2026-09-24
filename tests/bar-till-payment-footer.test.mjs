import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')

test('basket list shrinks so Take payment can never be pushed out of view', () => {
  const source = terminal()
  // The scroll list must yield space (minHeight 0); without it a tender
  // error banner pushes the payment footer out of the clipped column and
  // the operator is stuck with an error and no Pay button.
  assert.match(source, /flex: 1, overflowY: "auto", minHeight: 0/)
})

test('Take payment stays rendered and reachable after a tender error', () => {
  const source = terminal()
  // The button is disabled while the breakdown is invalid, never unmounted:
  // WTO a failed Pay keeps error text plus the button on screen. The shared
  // drawer gate also fails closed here (with a visible reason) so the
  // operator never taps into a domain refusal; unresolved-attempt retries
  // keep their own banner action and are never gated.
  assert.match(
    source,
    /disabled=\{\s*submitting \|\|\s*!tenderBreakdownResult\.ok \|\|\s*\(drawerGateNeeded && !recoveredAttempt\)\s*\}/,
  )
  assert.match(source, /minHeight: "60px",/)
  assert.match(source, /Take payment/)
  assert.match(source, /Drawer not open — open it in Staff shift close before taking payment\./)
  assert.match(source, /Open the cash drawer in Staff shift close before taking payment\./)
})

test('single-tender sales skip the repeated breakdown box', () => {
  const source = terminal()
  // One cash tender already shows its total in Collect Cash; repeating it in
  // a breakdown box wastes the space the Pay button needs. The box stays
  // for split/account sales and for live invalid-tender errors.
  assert.match(source, /tenderBreakdownResult\.breakdown\.length > 1/)
  assert.match(source, /aria-label="Tender breakdown"/)
})

test('cart rows show the unit price under the name and one line total', () => {
  const source = terminal()
  // Restores the approved Sell-screen contract: each line carries its
  // P-per-single under the item name plus a single right-aligned line
  // total — the unit price string never merges into the total itself.
  assert.match(source, /\{currency\} \{fmt\(unit\)\} each/)
  assert.doesNotMatch(source, /each · \{currency\}/)
  assert.match(source, /Line total/)
})
