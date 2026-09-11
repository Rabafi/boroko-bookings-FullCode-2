import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatStockMutationNotice,
  validateSingleStockQuantity,
} from '../src/renderer/src/components/hospitality-pos/hposStockState.js'
import { summarizeWasteMovements, WASTE_MOVEMENT_PREFIX } from '../src/shared/wasteSummary.js'

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
  // The notice stacks instead of squeezing into the generic flex row, and
  // its button uses the visible secondary style; without a manager the
  // notice points at Products instead of a dead end.
  assert.match(source, /hpos-inline-notice is-stack/)
  assert.match(source, /className="hpos-secondary-action"/)
  assert.match(source, /Manage groups in Products/)
  const menuSource = menu()
  assert.match(menuSource, /modifierGroups=\{modifierGroups\}/)
  assert.match(menuSource, /onManageModifiers/)
  const styles = read('src/renderer/src/styles/hospitality-pos.css')
  assert.match(styles, /\.hpos-inline-notice\.is-stack\{display:block\}/)
  assert.match(styles, /\.hpos-inline-notice\.is-stack \.hpos-secondary-action/)
})

test('wizard notices stack with visible buttons instead of squeezing', () => {
  const source = wizard()
  // The generic notice is a single flex row, which crushes long text and
  // buttons; every long or button-bearing wizard notice must stack.
  for (const marker of ['is-stack" role="status"', 'is-wide is-stack']) {
    assert.ok(source.includes(marker), `missing stacked notice ${marker}`)
  }
  assert.match(source, /No stock tracking\.<\/strong>/)
  assert.match(source, /<strong>Review:<\/strong>/)
  assert.match(source, /<strong>Already exists:<\/strong>/)
  assert.match(source, /<strong>Outcome unknown/)
  // Action buttons inside notices use the visible secondary style.
  const buttons = [...source.matchAll(/<button type="button" className="hpos-secondary-action"/g)].length
  assert.ok(buttons >= 4, `expected stacked notice buttons, found ${buttons}`)
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
  assert.match(source, /\$\{WASTE_MOVEMENT_PREFIX\} reason_code=/)
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

test('review sentence uses the linked stock unit, not the form default', () => {
  const source = wizard()
  assert.match(source, /\(form\.stockChoice === "link" \? linkedStock\?\.unit : null\) \|\| form\.unit/)
})

test('Till cards show a matching icon and tone per Bar category', () => {  const shared = profile()
  // Every Bar category has a visual; drink categories never share one icon.
  for (const category of ['Beer', 'Cider', 'Spirits', 'Softs', 'Wine', 'Snacks', 'Simple Food', 'Other']) {
    assert.ok(shared.includes(`${category.toLowerCase()}: Object.freeze({ icon:`) || shared.includes(`'${category.toLowerCase()}': Object.freeze({ icon:`), `missing visual for ${category}`)
  }
  const icons = [...shared.matchAll(/icon: '(\w+)'/g)].map((match) => match[1])
  for (const icon of ['beer', 'apple', 'martini', 'cupSoda', 'wine']) {
    assert.ok(icons.includes(icon), `missing icon ${icon}`)
  }
  assert.equal(new Set(icons).size, icons.length)
  const tones = [...shared.matchAll(/tone: '(#[0-9a-f]{6})'/g)].map((match) => match[1])
  assert.ok(tones.length >= 8)
  // No new colors: every visual reuses the existing Till card palette.
  const palette = new Set(['#f3c981', '#c8dfd9', '#f2b5aa', '#e6be69', '#d8dec0', '#efe2cf'])
  for (const tone of tones) assert.ok(palette.has(tone), `new color ${tone}`)
  // Beer must never share its tone with food: the Till's main split.
  const visualFor = (key) => shared.match(new RegExp(`${key}: Object\\.freeze\\(\\{ icon: '\\w+', tone: '(#[0-9a-f]{6})'`))?.[1]
  assert.notEqual(visualFor('beer'), visualFor("'simple food'"))
  assert.notEqual(visualFor('beer'), visualFor('snacks'))
  // The Till resolves Bar visuals first and keeps the restaurant chain.
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(terminal, /BAR_CATEGORY_VISUALS/)
  assert.match(terminal, /BAR_CATEGORY_ICON_COMPONENTS\[barVisual\.icon\]/)
  assert.match(terminal, /barVisual\?\.tone/)
  assert.match(terminal, /normalizedCategory\.includes\("drink"\)/)
})

test('save-and-add-another reloads lists so new stock is linkable', () => {
  const source = wizard()
  assert.match(source, /const refreshLists = async \(\)/)
  assert.match(source, /getMenuItems\?\.\(\) \?\? \[\]/)
  assert.match(source, /await refreshLists\(\)\.catch\(\(\) => \{\}\)/)
})

test('matching stock gets its own editable name, not the variant name', () => {
  const source = wizard()
  assert.match(source, /Stock item name/)
  assert.match(source, /stockName/)
  assert.match(source, /stock_name: String\(form\.stockName \|\| ""\)\.trim\(\) \|\| form\.name\.trim\(\)/)
  assert.match(source, /Name the counted thing, not the variation/)
  // A clashing stock name is caught before save, by barcode or by name.
  assert.match(source, /is already a stock item — link it instead/)
})

test('sales report carries a quantity-only waste summary on certified reads', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposReports.jsx')
  assert.match(source, /canViewWaste = canAccessCapability\(access, 'inventory\.view'\)/)
  assert.match(source, /getMovementsWithReadStatus\?\.\(\{ start_date: start, end_date: end, limit: 500 \}\)/)
  assert.match(source, /<h2>Waste<\/h2>/)
  assert.match(source, /Waste needs the stock permission\./)
  assert.match(source, /No recorded waste in this period\./)
  assert.match(source, /Quantities only; no cost values\./)
  // Uncertified reads never render: the card needs a complete server ledger.
  assert.match(source, /waste\.source !== 'server' \|\| waste\.complete !== true/)
  // Aggregation is shared with the exports, never local math here.
  assert.match(source, /summarizeWasteMovements\(waste\.rows\)\.items\.slice\(0, 8\)/)
})

test('waste summary counts Waste-action quantities with no money anywhere', () => {
  assert.equal(WASTE_MOVEMENT_PREFIX, 'Waste ·')
  const summary = summarizeWasteMovements([
    { item_id: 'a', item_name: 'Fries', item_unit: 'portion', movement_type: 'adjustment_decrease', quantity: -2, notes: 'Waste · reason_code=burnt_spoilt · Burnt / spoilt food · batch', created_at: '2026-09-11T10:00:00Z' },
    { item_id: 'a', item_name: 'Fries', item_unit: 'portion', movement_type: 'adjustment_decrease', quantity: -1, notes: 'Waste · reason_code=expired · Expired · old tray', created_at: '2026-09-11T11:00:00Z' },
    // Other decreases must not inflate waste, even with waste-like notes.
    { item_id: 'b', item_name: 'Milk', item_unit: 'l', movement_type: 'adjustment_decrease', quantity: -5, notes: 'Simple delivery · reason_code=delivery_received · Delivery received · x', created_at: '2026-09-11T12:00:00Z' },
    { item_id: 'c', item_name: 'Beer', item_unit: 'bottle', movement_type: 'adjustment_increase', quantity: 10, notes: 'Waste · reason_code=breakage · Breakage · x', created_at: '2026-09-11T13:00:00Z' },
    { item_id: 'd', item_name: 'Soda', item_unit: 'can', movement_type: 'adjustment_decrease', quantity: 0, notes: 'Waste · reason_code=spillage · Spillage · x', created_at: '2026-09-11T14:00:00Z' },
  ])
  assert.equal(summary.totalEntries, 2)
  assert.deepEqual(summary.items, [{ label: 'Fries', unit: 'portion', quantity: 3, entries: 2, topReason: 'Burnt / spoilt food' }])
  assert.equal(summary.detail.length, 2)
  assert.equal(summary.detail[0].reason, 'Expired')
  assert.ok(!('total_cost' in summary.items[0]) && !('unit_cost' in summary.items[0]))
  assert.deepEqual(summarizeWasteMovements(null), { items: [], detail: [], totalEntries: 0 })
})

test('pos history exports carry detailed waste sections without money', () => {  const main = read('src/main/index.js')
  assert.match(main, /buildWasteExportSection\(movementRead/)
  assert.match(main, /getInventoryMovementsWithReadStatus\(\{ start_date: start, end_date: end, limit: 500 \}\)/)
  assert.match(main, /requireCapability\('inventory\.view'\)/)
  // Excel: summary plus line-level detail, fixed headers without currency.
  assert.match(main, /\['Item', 'Unit', 'Quantity Wasted', 'Top Reason', 'Entries'\]/)
  assert.match(main, /\['Date', 'Item', 'Unit', 'Quantity', 'Reason', 'Note'\]/)
  assert.match(main, /\]\), 'Waste Summary'\)/)
  assert.match(main, /\]\), 'Waste Detail'\)/)
  // PDF section plus additive companion keys.
  assert.match(main, /<h2>Waste \(quantities only, no cost values\)<\/h2>/)
  assert.match(main, /waste_status: wasteSection\.status/)
  assert.match(main, /waste_summary: wasteSection\.items/)
  assert.match(main, /waste_detail: wasteSection\.detail/)
})

test('sales report flags slow movers from certified stock reads', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposReports.jsx')
  assert.match(source, /getItemsWithReadStatus\?\.\(\)/)
  assert.match(source, /getBarStockAging\?\.\(null\)/)
  assert.match(source, /<h2>Slow movers<\/h2>/)
  assert.match(source, /Nothing idle: every stocked item sold in the last 14 days\./)
  assert.match(source, /No sale in the last 14 days\. Quantities only\./)
  assert.match(source, /last_sold_at/)
  assert.match(source, /14 \* 24 \* 60 \* 60 \* 1000/)
  // Descriptive quantities only: no money, no reorder advice, no costs.
  const block = source.match(/slowMovers = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[barOnly, canViewWaste, slowStock\]\);/)[0]
  assert.match(block, /current_stock/)
  assert.doesNotMatch(block, /money\(|total_cost|unit_cost|reorder|suggest/i)
})

test('my shift shows a money-free handover for the open shift', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposMyShift.jsx')
  assert.match(source, /aria-label="Shift handover"/)
  assert.match(source, /getCertifiedReportHistory\?\.\(openDate, today\)/)
  assert.match(source, /getTabs\?\.\(\{ status: 'active' \}\)/)
  assert.match(source, /summarizeWasteMovements\(rows\)/)
  assert.match(source, /Sales completed/)
  assert.match(source, /Waste this shift/)
  assert.match(source, /Needs stock permission/)
  assert.match(source, /classifyPosTransaction\(order\) === 'sale'/)
  // Blind cash-up: the handover reports counts and names, never takings.
  const block = source.match(/if \(!shift\?\.id\)[\s\S]*?return \(\) => \{ active = false \}/)[0]
  assert.match(block, /salesCount/)
  assert.match(block, /wasteText/)
  assert.doesNotMatch(block, /currency|tender|expected_cash|netTotal|money\(/i)
})
