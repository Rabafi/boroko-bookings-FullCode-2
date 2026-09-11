import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatStockMutationNotice,
  validateSingleStockQuantity,
} from '../src/renderer/src/components/hospitality-pos/hposStockState.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const wizard = () => read('src/renderer/src/components/hospitality-pos/HposProductWizard.jsx')
const menu = () => read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
const stock = () => read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
const profile = () => read('src/shared/barModeProfile.js')

test('base Bar offers weighed/measured counted units without the recipes add-on', () => {
  const shared = profile()
  for (const unit of ['kg', 'g', 'l', 'ml', 'bottle', 'can', 'keg', 'packet', 'portion', 'each']) {
    assert.ok(shared.includes(`value: '${unit}'`), `missing counted unit ${unit}`)
  }
  // Both creation surfaces bind the same shared list (no divergent hardcoding).
  assert.match(wizard(), /BAR_COUNTED_UNITS/)
  assert.match(stock(), /BAR_COUNTED_UNITS/)
  assert.match(wizard(), /BAR_COUNTED_UNITS\.map\(\(option\)/)
  assert.match(stock(), /BAR_COUNTED_UNITS\.map\(\(option\)/)
})

test('wizard explains weighed depletion for food like Fries', () => {
  const source = wizard()
  assert.match(source, /0\.3/)
  assert.match(source, /potatoes per Fries/i)
  assert.match(source, /One sale removes/)
})

test('wizard Flow question stays plain-language with stable option contracts', () => {
  const source = wizard()
  assert.match(source, /What are you adding\?/)
  assert.match(source, /For sale at the Till/)
  assert.match(source, /whether sales deplete stock or sell without tracking/)
  assert.match(source, /Stock only \(not sold directly\)/)
  assert.match(source, /Stock-only: counted but not sold directly/)
})

test('wizard surfaces sizes & extras from existing modifier groups', () => {
  const source = wizard()
  assert.match(source, /modifierGroups/)
  assert.match(source, /onManageModifiers/)
  assert.match(source, /Sizes &amp; extras/)
  assert.match(source, /applicableModifiers/)
  assert.match(source, /Manage sizes &amp; extras/)
  const menuSource = menu()
  assert.match(menuSource, /modifierGroups=\{modifierGroups\}/)
  assert.match(menuSource, /onManageModifiers/)
})

test('packs stay 6/12/24 and the copy admits portion bundles', () => {
  const source = wizard()
  assert.match(source, /BAR_PACK_SIZES/)
  assert.match(source, /6-pack of fatcake portions removes 6 portions/)
  assert.match(source, /Sizes stay 6, 12 and 24/)
})

test('server contract already allows weighed direct depletion (no migration)', () => {  const sql = read('supabase/migrations/20260909000000_bar_atomic_product_with_stock.sql')
  // Any positive decimal depletion is accepted server-side.
  assert.match(sql, /Stock consumed per sale must be greater than zero/)
  // The unit is free text with a fallback, never an allowlist.
  assert.match(sql, /coalesce\(nullif\(btrim\(v_stock->>'unit'\),''\),'unit'\)/)
  // Pack sizes remain server-pinned: the client must not invent new ones.
  assert.match(sql, /not in \(6,12,24\)/)
  // This change ships no migration: nothing in the bar_food/bar_waste namespace.
  const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
  assert.equal(migrations.filter((file) => /bar_(food|waste)|food_depletion|base_waste/.test(file)).length, 0)
})

test('base Stock offers a waste action on the audited adjustment contract', () => {
  const source = stock()
  assert.match(source, /STOCK_ACTION_REASONS/)
  assert.match(source, /waste: \[/)
  assert.match(source, /burnt_spoilt/)
  assert.match(source, /openWasteAction/)
  assert.match(source, /mode: 'waste'/)
  assert.match(source, /Record waste/)
  assert.match(source, /Quantity wasted/)
  // Waste posts a negative delta through the existing idempotent adjustment
  // RPC (same capability, lodge assertion and operation key as Receive).
  assert.match(source, /-entered/)
  assert.match(source, /Waste · reason_code=/)
  assert.match(source, />Waste<\/button>/)
})

test('waste quantities validate positive and report honestly', () => {
  assert.equal(validateSingleStockQuantity('', 'waste').code, 'blank')
  assert.match(validateSingleStockQuantity('', 'waste').message, /wasted/)
  assert.equal(validateSingleStockQuantity('0', 'waste').code, 'not_positive')
  assert.equal(validateSingleStockQuantity('-2', 'waste').code, 'not_positive')
  assert.deepEqual(validateSingleStockQuantity('2', 'waste'), { ok: true, code: 'valid', quantity: 2 })
  // Receive/count behavior is unchanged by the waste branch.
  assert.equal(validateSingleStockQuantity('0', 'receive').code, 'not_positive')
  assert.equal(validateSingleStockQuantity('0', 'count').code, 'valid')
  assert.match(formatStockMutationNotice('waste', 'Fries', { success: true }), /^Waste for Fries was posted/)
  assert.match(formatStockMutationNotice('waste', 'Fries', { offline: true }), /provisionally/)
  assert.match(formatStockMutationNotice('receive', 'Milk', { success: true }), /^Delivery for Milk was posted/)
})

test('wizard offers no-stock tracking for in-house food like fatcakes', () => {
  const source = wizard()
  assert.match(source, /No stock tracking — sell without depleting anything/)
  assert.match(source, /stockChoice === "none"/)
  assert.match(source, /No stock tracking: each sale records revenue only/)
  assert.match(source, /mark it unavailable when the tray is empty/)
  // Depletion, packs and the create-stock fields stay hidden without stock.
  assert.match(source, /form\.stockChoice !== "none" && \(/)
  assert.match(source, /SERVER_RECIPE_FORCED_CATEGORIES/)
  assert.match(source, /needs a recipe with ingredients/)
  // Stock-only mode can never combine with no tracking.
  assert.match(source, /Stock-only items always create counted stock/)
})

test('no-stock saves use the plain menu-item contract, never the atomic one', () => {
  const source = wizard()
  assert.match(source, /stock_method: "non_stock"/)
  assert.match(source, /createMenuItem\?\.\(payload\)/)
  assert.match(source, /updateMenuItem\?\.\(initialProduct\.id, payload\)/)
  assert.match(source, /never replayed blindly/)
  // Editing a non-stock product reopens the wizard in the none choice.
  assert.match(source, /initialProduct\.stock_method === "non_stock" \? "none"/)
  // Linking from a stockless product offers the selected row's version.
  assert.match(source, /linkedStock\?\.updated_at \|\| initialStock\?\.updated_at/)
})

test('menu list read carries stock_method so non-stock never reads as missing', () => {
  const domain = read('src/main/domains/pos.js')
  assert.match(domain, /barcode, stock_method, inventory_item_id/)
})

test('save-and-add-another reloads lists so new stock is linkable', () => {
  const source = wizard()
  assert.match(source, /const refreshLists = async \(\)/)
  assert.match(source, /getMenuItems\?\.\(\) \?\? \[\]/)
  assert.match(source, /await refreshLists\(\)\.catch\(\(\) => \{\}\)/)
})
