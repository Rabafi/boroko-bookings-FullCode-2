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
  // WTO a failed Pay keeps error text plus the button on screen.
  assert.match(source, /disabled=\{submitting \|\| !tenderBreakdownResult\.ok\}/)
  assert.match(source, /minHeight: "60px",/)
  assert.match(source, /Take payment/)
})

test('single-tender sales skip the repeated breakdown box', () => {
  const source = terminal()
  // One cash tender already shows its total in Collect Cash; repeating it in
  // a breakdown box wastes the space the Pay button needs. The box stays
  // for split/account sales and for live invalid-tender errors.
  assert.match(source, /tenderBreakdownResult\.breakdown\.length > 1/)
  assert.match(source, /aria-label="Tender breakdown"/)
})

test('cart rows carry one inline line total, no repeated unit-price line', () => {
  const source = terminal()
  assert.doesNotMatch(source, /each · \{currency\}/)
  assert.match(source, /Line total/)
})
