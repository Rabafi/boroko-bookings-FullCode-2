import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
const checks = () => read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')

test('Till favourites are per-outlet pins with a Top sellers view', () => {
  const source = terminal()
  assert.match(source, /hpos-till-favourites:/)
  assert.match(source, /MAX_FAVOURITES = 30/)
  assert.match(source, /TOP_SELLER_POPULARITY = 80/)
  // Ordering is operator-driven, never hardcoded per drink type.
  assert.match(source, /★ Favourites/)
  assert.match(source, /Top sellers/)
  assert.match(source, /onToggleFavourite/)
  assert.match(source, /aria-pressed=\{isFavourite === true\}/)
  assert.equal(
    /Beer.*Spirits.*first|order.*Beer.*Spirits/i.test(
      source.match(/const categories = useMemo\(\(\) => \{[\s\S]{0,600\}/)?.[0] || '',
    ),
    false,
    'category order must not hardcode drink types first',
  )
})

test('basket supports direct quantity entry without imposing new rules', () => {
  const source = terminal()
  assert.match(source, /onSetQty/)
  assert.match(source, /inputMode="decimal"/)
  // Zero/negative removes, non-numeric is ignored, positives pass through:
  // integer policy stays downstream where it already lives.
  assert.match(source, /if \(qty <= 0\) \{\s*\n\s*setCart\(\(prev\) => prev\.filter/)
  assert.match(source, /if \(!Number\.isFinite\(qty\)\) return;/)
  assert.equal(/Number\.isInteger\(qty\)/.test(source), false)
})

test('basket lines distinguish packs, highlight the last add, and offer Undo', () => {
  const source = terminal()
  assert.match(source, /packBadgeLabel/)
  assert.match(source, /template_pack_size/)
  assert.match(source, /scrollIntoView\?\.?\(\{ block: "nearest" \}\)/)
  assert.match(source, /Removed \{lastRemoved\.line\.item_name\}/)
  assert.match(source, /Clear this sale\? All unpaid lines will be removed\./)
  assert.match(source, /prev\.some\(\(c\) => c\.id === line\.id\)/)
})

test('Till shows the open-tab count and resumed-tab identity', () => {
  const source = terminal()
  assert.match(source, /openTabCount/)
  assert.match(source, /Open tabs · \{openTabCount\}/)
  assert.match(source, /navigate\("\/hpos\/checks"\)/)
  assert.match(source, /Ready to continue —/)
  assert.match(source, /Tab changed — refresh required\. Re-open it from Open tabs/)
  assert.match(source, /setShowPayment\(true\);\s*\n\s*\}\s*\n\s*setSuccessMessage/)
})

test('Open Tabs keeps Resume distinct from Settle', () => {
  const source = checks()
  assert.match(source, /resumeIntent: true,\s*\n\s*settle: true,/)
  assert.match(source, /Resume tab →/)
  // Settle accepts an uncertified offline estimate (marked); the Till
  // rebuilds the basket and the server prices at replay.
  assert.match(source, /disabled=\{!canControl\(tab\) \|\| tabSettleValue\(tab\) === null\}/)
  assert.match(source, /tabSettleEstimated/)
})

test('Till warns when the shared drawer has no open period', () => {
  const source = terminal()
  // Guidance only, on the open-tabs pill cadence: the domain refuses at Pay,
  // the pill never blocks. Personal outlets never show it.
  assert.match(source, /drawerGateNeeded/)
  assert.match(source, /Drawer not open/)
  assert.match(source, /getDrawerPeriodState/)
  assert.match(source, /navigate\("\/hpos\/shift-close"\)/)
  assert.match(source, /cash_model !== "shared_drawer"/)
})
