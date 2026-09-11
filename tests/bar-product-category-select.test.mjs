import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('Bar category list still carries Softs for Coke', () => {
  const profile = read('src/shared/barModeProfile.js')
  for (const category of ['Beer', 'Spirits', 'Softs', 'Wine', 'Snacks', 'Simple Food', 'Other']) {
    assert.ok(profile.includes(`'${category}'`), `missing category ${category}`)
  }
})

test('wizard Category uses a real select so every option stays visible', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposProductWizard.jsx')
  // No filtered datalist: with value="Beer" Chromium only offered Beer.
  assert.doesNotMatch(source, /bar-product-wizard-categories/)
  assert.doesNotMatch(source, /<datalist/)
  assert.doesNotMatch(source, /list="bar-product-wizard-categories"/)
  // Real dropdown bound to the shared list.
  assert.match(source, /Category \(shared with stock\)/)
  assert.match(source, /<select value=\{form\.category\}/)
  assert.match(source, /visibleCategories\.map\(\(category\)/)
  assert.match(source, /Coke uses Softs/)
})

test('wizard preserves a legacy custom category while editing', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposProductWizard.jsx')
  assert.match(source, /visibleCategories/)
  assert.match(source, /BAR_PRODUCT_CATEGORIES\.includes\(current\)/)
  assert.match(source, /Choose a category\./)
})
