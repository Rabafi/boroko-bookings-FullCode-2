import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Electron splash uses a distinct theme per product, not one lodging green', () => {
  const main = read('src/main/index.js')
  assert.match(main, /PRODUCT_SPLASH_THEMES/)
  assert.match(main, /getSplashTheme/)
  assert.match(main, /function buildSplashHtml\(productId = BUILD_PRODUCT_ID\)/)
  // All three products have an explicit theme entry.
  assert.match(main, /'lodge-camp': Object\.freeze\(\{/)
  assert.match(main, /hotel: Object\.freeze\(\{/)
  assert.match(main, /'hospitality-pos': Object\.freeze\(\{/)
  // Lodge keeps its established deep-green splash; the other two must differ.
  assert.match(main, /#0f3d2c 0%, #0c2d23 100%/)
  assert.match(main, /#241c17 0%, #1a1512 100%/)
  assert.match(main, /#2f222a 0%, #211920 100%/)
  // Template consumes the resolved theme instead of hardcoded lodge tokens.
  assert.match(main, /background: \$\{theme\.background\}/)
  assert.match(main, /color: \$\{theme\.text\}/)
  assert.match(main, /background: \$\{theme\.bar\}/)
  assert.match(main, /background: \$\{theme\.dot\}/)
})

test('renderer loading surfaces use per-product accents instead of shared lodge green', () => {
  const app = read('src/renderer/src/App.jsx')
  assert.match(app, /PRODUCT_THEME_COLORS/)
  assert.match(app, /'lodge-camp': '#0f3d2c'/)
  assert.match(app, /hotel: '#1a1512'/)
  assert.match(app, /'hospitality-pos': '#2f222a'/)
  assert.match(app, /meta\[name="theme-color"\]/)
  assert.match(app, /const accent = productId === 'hospitality-pos' \? '#c95635' : productId === 'hotel' \? '#b8734a' : '#174c3a'/)
  assert.doesNotMatch(app, /border-2 border-\[#174c3a\] border-t-transparent" \/>/)
})
