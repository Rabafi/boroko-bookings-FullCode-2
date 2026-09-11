import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')

test('basket quantity and remove controls meet the 44px touch target', () => {
  const source = terminal()
  assert.match(source, /Decrease \$\{line\.item_name\} quantity/)
  assert.match(source, /Increase \$\{line\.item_name\} quantity/)
  assert.match(source, /Remove \$\{line\.item_name\}/)
  const qtySizes = source.match(/width: "44px",\s*\n\s*height: "44px",/g) || []
  assert.ok(qtySizes.length >= 2, `expected +/- buttons at 44px, found ${qtySizes.length}`)
  assert.match(source, /minWidth: "44px",\s*\n\s*height: "44px",/)
})

test('category and service-mode controls meet the 44px touch target', () => {
  const source = terminal()
  assert.match(source, /minHeight: "44px",\s*\n\s*padding: "12px 18px",/)
  assert.match(source, /fontSize: 14,\s*\n\s*fontWeight: 700,/)
  assert.match(source, /minHeight: "44px",\s*\n\s*padding: "10px 14px",/)
  assert.match(source, /aria-pressed=\{activeCategory === category\}/)
  assert.match(source, /aria-pressed=\{serviceMode === mode\.id\}/)
})

test('payment buttons are large primary targets without hover-only behavior', () => {
  const source = terminal()
  const largePay = source.match(/minHeight: "56px",/g) || []
  assert.ok(largePay.length >= 2, `expected Cash/Card/Mobile/Split at 56px, found ${largePay.length}`)
  assert.match(source, /minHeight: "60px",/)
  assert.match(source, /fontSize: "16px",\s*\n\s*fontWeight: 800,/)
  assert.equal(
    /currentTarget\.style\.background = `\$\{pm\.color\}15`/.test(source),
    false,
    'pay-method hover background mutation must not remain',
  )
})

test('product cards have readable labels and no hover-lift trap', () => {
  const source = terminal()
  assert.equal(
    source.includes('e.currentTarget.style.transform = "translateY(-3px)"'),
    false,
    'touch taps must not trigger a sticky hover lift',
  )
  assert.equal(
    source.includes('e.currentTarget.style.opacity = "1"'),
    false,
    'trash opacity hover handlers must not remain',
  )
  assert.match(source, /fontSize: "12px",\s*\n\s*fontWeight: 700,\s*\n\s*color: "#b84a38",/)
})

test('keyboard focus stays visible in the Bar product', () => {
  const css = read('src/renderer/src/styles/hospitality-pos.css')
  assert.match(css, /button:focus-visible/)
})
