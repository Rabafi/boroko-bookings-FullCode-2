import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const layout = readFileSync('src/renderer/src/components/hospitality-pos/HposLayout.jsx', 'utf8')
const checks = readFileSync('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx', 'utf8')

test('layout skips its duplicate tab poll while Open Tabs owns the rows', () => {
  assert.match(layout, /onChecksPage/, 'the layout detects the Open Tabs route')
  assert.match(layout, /\/hpos\/checks/, 'the skip targets the checks route')
  assert.match(
    layout,
    /onChecksPage\s*\?\s*Promise\.resolve\(null\)/,
    'the layout tabs fetch stands down on the checks page',
  )
  assert.match(
    layout,
    /setLiveCounts\(\(previous\) => \(\{\s*\.\.\.previous,\s*kitchen:/,
    'the checks badge keeps its last-known value instead of flickering to zero',
  )
  assert.match(layout, /\[barOnly, location\.pathname\]/, 'leaving the page repolls via the pathname dependency')
})

test('Open Tabs keeps owning its own refresh cadence', () => {
  assert.match(checks, /getTabs\?\.\(\{\s*status:\s*"active"\s*\}\)/, 'the page still fetches active tabs')
  assert.match(checks, /setInterval\(\(\) =>/, 'the page keeps its quiet poll')
  assert.match(checks, /visibilitychange/, 'the page keeps its visibility refetch')
})
