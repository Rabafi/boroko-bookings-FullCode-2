import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const wizard = () => read('src/renderer/src/components/hospitality-pos/HposProductWizard.jsx')
const menu = () => read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
const stock = () => read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')

test('wizard keeps Products and Stock as views over one flow', () => {
  const source = wizard()
  // What: shared category source, price, optional barcode.
  assert.match(source, /BAR_PRODUCT_CATEGORIES/)
  assert.match(source, /Selling price/)
  assert.match(source, /Single barcode \(optional\)/)
  // Stock: create-matching default or link existing; unit/outlet/opening.
  assert.match(source, /Create matching stock/)
  assert.match(source, /Link existing stock/)
  assert.match(source, /Opening quantity/)
  // Packs with early outlet validation.
  assert.match(source, /BAR_PACK_SIZES/)
  assert.match(source, /Packs need an active Bar outlet/)
  // Plain-language review.
  assert.match(source, /One sale removes/)
  // Save & add another retains defaults.
  assert.match(source, /Save & add another/)
  // Barcode scanning per field; singles and packs never bulk-overwritten.
  assert.match(source, /never bulk-overwritten/)
  // Opening stock never replayed on edit.
  assert.match(source, /opening stock is never replayed/i)
  assert.match(source, /opening_stock: editing \? 0/)
  // Early duplicate detection with recovery.
  assert.match(source, /Already exists/)
  assert.match(source, /Use existing product/)
  // No staged legacy fallback: a missing atomic contract preserves the
  // request and names the required update instead of writing legacy rows.
  assert.equal(/saveLegacyStaged|compatibility mode/i.test(source), false)
  assert.match(source, /Legacy writes must never run silently/)
  // Failed keys retire only when values change; explicit retries replay.
  assert.match(source, /retires only when the operator/)
  assert.match(source, /I checked — retry/)
  // Unchanged edits preserve packs, barcodes and availability.
  assert.match(source, /initialPacks/)
  assert.match(source, /initialAvailable/)
  assert.match(source, /Available for sale/)
  // Publication retry surfaced, never silent.
  assert.match(source, /Retry publication/)
})

test('wizard keeps a stock-only path and read-only recipe recovery', () => {
  const source = wizard()
  assert.match(source, /Stock only \(not sold directly\)/)
  assert.match(source, /Stock-only: counted but not sold directly/)
  assert.match(source, /Recipe product \(Included with Stock add-on\)\./)
  assert.match(source, /no casual conversion contract exists/i)
  // Recipe edits touch price/barcode/availability only.
  assert.match(source, /updateMenuItem\?\.\(initialProduct\.id/)
  // No conversion writer exists anywhere in the wizard.
  assert.equal(/convert.{0,20}to.{0,20}direct/i.test(source.replace(/no casual conversion contract exists/i, '')), false)
})

test('Products routes Bar creation through the wizard with deep links', () => {
  const source = menu()
  assert.match(source, /HposProductWizard/)
  assert.match(source, /createBarcode/)
  assert.match(source, /receiveStockId/)
  assert.match(source, /Receive stock for/)
  assert.match(source, /navigate\("\/hpos\/stock", \{ state: \{ receiveStockId/)
  // Interrupted saves stay recoverable after the modal closes.
  assert.match(source, /getProductRequestStatus/)
  assert.match(source, /retryProductRequest/)
  assert.match(source, /interrupted save/)
  assert.match(source, /Retry this save/)
})

test('Stock routes Bar creation through the wizard with receive links', () => {
  const source = stock()
  assert.match(source, /HposProductWizard/)
  assert.match(source, /setShowWizard\(true\)/)
  assert.match(source, /receiveStockId/)
  assert.match(source, /mode: 'receive'/)
})

test('Till unknown scans offer permission-gated creation', () => {
  const source = terminal()
  assert.match(source, /lastNotFoundBarcode/)
  assert.match(source, /canAccessCapability\(access, "pos\.menu_manage"\)/)
  assert.match(source, /canAccessCapability\(access, "inventory\.manage"\)/)
  assert.match(source, /Create product/)
  assert.match(source, /state: \{ createBarcode: code \}/)
})

test('opening float is explicit every shift on both surfaces', () => {
  const till = terminal()
  assert.match(till, /Enter the opening cash float to start the shift\./)
  assert.match(till, /String\(shiftFloat \?\? ""\)\.trim\(\) === ""/)
  const myShift = read('src/renderer/src/components/hospitality-pos/HposMyShift.jsx')
  assert.match(myShift, /Enter the opening cash float to start the shift/)
  assert.match(myShift, /String\(openingFloat \?\? ''\)\.trim\(\) === ''/)
})

test('Open Tabs sorts and Cash & close links unresolved tabs', () => {
  const checks = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx')
  assert.match(checks, /Sort open tabs/)
  assert.match(checks, /Newest first/)
  assert.match(checks, /Oldest first/)
  assert.match(checks, /Highest value/)
  assert.match(checks, /Lowest value/)
  const cash = read('src/renderer/src/components/hospitality-pos/HposCashClose.jsx')
  assert.match(cash, /openTabsCount/)
  assert.match(cash, /still unsettled/)
  assert.match(cash, /Review open tabs/)
})

test('readiness groups Bar stages without changing evidence', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposSetupReadiness.jsx')
  assert.match(source, /BAR_STAGE_GROUPS/)
  assert.match(source, /'Stock & products'/)
  assert.match(source, /hpos-setup-group-title/)
  // Progress math and retirement behavior untouched.
  assert.match(source, /completed\} \/ \$\{stages\.length\}/)
  assert.match(source, /navigate\('\/hpos\/manage', \{ replace: true \}\)/)
})
