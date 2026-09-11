import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const layout = readFileSync('src/renderer/src/components/hospitality-pos/HposLayout.jsx', 'utf8')
const css = readFileSync('src/renderer/src/styles/hospitality-pos.css', 'utf8')

test('only the live Till locks the viewport; Cash & close stays scrollable', () => {
  assert.match(layout, /isTillRoute \? 'is-pos' : ''/, 'the locked viewport class follows till routes only')
  assert.doesNotMatch(layout, /isPosRoute \? 'is-pos' : ''/, 'review routes must not inherit the locked viewport')
  assert.match(layout, /'\/hpos\/cash'/, 'Cash & close keeps its New Order suppression via POS_ROUTE_PREFIXES')
})

test('the locked Till viewport and the scrollable default both survive', () => {
  const locked = css.match(/\.hpos-app-main\.is-pos\s*\{[^}]*\}/)?.[0] || ''
  assert.match(locked, /overflow:\s*hidden/, 'the Till keeps its fixed viewport')
  const base = css.match(/\.hpos-app-main\s*\{[^}]*\}/)?.[0] || ''
  assert.match(base, /overflow:\s*auto/, 'review pages keep a scrollable main')
})
