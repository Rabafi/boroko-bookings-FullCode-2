import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const profile = () => read('src/shared/barModeProfile.js')
const wizard = () => read('src/renderer/src/components/hospitality-pos/HposProductWizard.jsx')
const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
const reports = () => read('src/renderer/src/components/hospitality-pos/HposReports.jsx')

test('Pool category exists for per-table daily cash collection', () => {
  const shared = profile()
  assert.ok(shared.includes(`'Pool'`), 'missing Pool category')
  assert.ok(shared.includes('POOL_COLLECTION_UNIT_PRICE'), 'missing P1 collection constant')
  assert.ok(shared.includes('POOL_CATEGORY'), 'missing pool category constant')
  assert.ok(shared.includes('isPoolCategory'), 'missing pool helper')
  // P1 so quantity typed at the Till equals pula collected (80 = P80).
  assert.match(shared, /POOL_COLLECTION_UNIT_PRICE = 1/)
})

test('Pool Till card has its own billiard-ball icon and a soft felt-green tone', () => {
  const shared = profile()
  assert.match(shared, /pool: Object\.freeze\(\{ icon: 'circleDot'/)
  // Soft pool-felt green from the existing Till palette (no new colours).
  // It no longer shares Softs teal, so Pool tables never read as Coke.
  const poolTone = shared.match(/pool: Object\.freeze\(\{ icon: '\w+', tone: '(#[0-9a-f]{6})'/)?.[1]
  assert.equal(poolTone, '#d8dec0')
  // Till resolves the new icon key.
  assert.match(terminal(), /circleDot: CircleDot/)
})

test('wizard locks Pool tables to P1 with stock disabled', () => {
  const source = wizard()
  assert.match(source, /Pool tables must use No stock tracking/)
  assert.match(source, /Pool tables do not use packs/)
  assert.match(source, /Pool table cash\./)
  assert.match(source, /One table = one product \(Pool Table 1, Pool Table 2\)/)
  // Choosing Pool defaults price and stock choice for a fast setup.
  assert.match(source, /String\(next \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'pool'/)
  // Price box is locked to P1 and the stock box is locked to no tracking.
  assert.match(source, /value=\{isPool \? "1" : form\.price\}/)
  assert.match(source, /disabled=\{isPool\}/)
  assert.match(source, /Pool price is fixed P1\. You type the cash as quantity at night\./)
  assert.match(source, /value=\{isPool \? "none" : form\.stockChoice\}/)
  assert.match(source, /Pool tables never track stock\. Cash only\. This box is locked\./)
})

test('Till explains quantity means pula when Pool lines are in the basket', () => {
  const source = terminal()
  assert.match(source, /Pool tables: quantity means pula collected/)
  assert.match(source, /Table 1 quantity 80 = P80/)
  assert.match(source, /String\(line\.category \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'pool'/)
})

test('Till basket keeps one compact row per item with a small quantity box', () => {
  const source = terminal()
  assert.match(source, /One compact row so several items fit without scrolling/)
  assert.match(source, /width: "54px"/)
  assert.match(source, /repeat\(auto-fill, minmax\(150px, 1fr\)\)/)
  // Touch targets stay 44px.
  assert.match(source, /Decrease \$\{line\.item_name\} quantity/)
  assert.match(source, /Quantity for \$\{line\.item_name\}/)
  // Pool lines never offer modifier options.
  assert.match(source, /isPoolLine/)
})

test('pool sales offer cash only at the Till and fail closed in the domain', () => {
  const till = terminal()
  assert.match(till, /hasPoolLines/)
  assert.match(till, /Pool tables pay Cash only/)
  assert.match(till, /\.filter\(\(pm\) => !hasPoolLines \|\| pm\.id === "cash"\)/)
  assert.match(till, /!\s*hasPoolLines && \(\s*\n?\s*<button[\s\S]*?Split payment/)
  const domain = read('src/main/domains/pos.js')
  assert.match(domain, /hasPoolLines/)
  assert.match(domain, /Pool tables pay Cash only/)
})

test('Sales report carries a per-table Pool card with a daily total', () => {
  const source = reports()
  assert.match(source, /aria-label="Pool tables"/)
  assert.match(source, /<h2>Pool tables<\/h2>/)
  assert.match(source, /poolTables/)
  assert.match(source, /poolTotal/)
  assert.match(source, /All pool tables/)
  assert.match(source, /collected<\/strong>/)
  assert.match(source, /quantity means pula/)
  // Fails soft on uncertified reads, like the category card.
  assert.match(source, /Unavailable until the server certifies complete item detail\./)
  // Empty state guides setup (Products, price P1, night quantity entry).
  assert.match(source, /No pool cash in this period/)
})
