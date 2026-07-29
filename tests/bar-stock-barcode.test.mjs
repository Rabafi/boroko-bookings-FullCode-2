import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBarcodeScannerDecoder, normalizeBarcode } from '../src/shared/barcodeScanner.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('barcode identifiers preserve leading zeroes and reject unsafe values', () => {
  assert.equal(normalizeBarcode(' 00012345 '), '00012345')
  assert.equal(normalizeBarcode(''), null)
  assert.equal(normalizeBarcode('1'.repeat(129)), null)
  assert.equal(normalizeBarcode('123\n456'), null)
})

test('stock setup captures a scanner value and keeps explicit clear semantics', () => {
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  const domain = read('src/main/domains/inventory.js')
  assert.match(stock, /createBarcodeScannerDecoder/)
  assert.match(stock, /barcodeInputRef/)
  assert.match(stock, /Barcode captured/)
  assert.match(stock, /Leading zeroes are preserved/)
  assert.match(stock, /barcodeTouched/)
  assert.match(stock, /barcode: String\(newItem\.barcode \|\| ''\)\.trim\(\) \|\| null/)
  assert.match(domain, /normalizeBarcode/)
  assert.match(domain, /barcode: barcode \?\? null/)
  assert.match(domain, /\.\.\.\(barcode !== undefined \? \{ barcode \} : \{\}\)/)
})

test('menu setup can scan and safely inherit a direct stock barcode', () => {
  const menu = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
  assert.match(menu, /createBarcodeScannerDecoder/)
  assert.match(menu, /Scan product barcode/)
  assert.match(menu, /Leading zeroes are preserved/)
  assert.match(menu, /stockItem\?\.barcode/)
  assert.match(menu, /draft\.barcode\.trim\(\) \? draft\.barcode/)
  assert.match(menu, /Singles and physical packs may use different barcodes/)
  assert.match(menu, /pack6Barcode/)
  assert.match(menu, /pack12Barcode/)
  assert.match(menu, /pack24Barcode/)
  assert.match(menu, /setBarPackTemplate\([\s\S]*barcode:/)
})

test('pack template migration carries distinct package barcodes and preserves single sync', () => {
  const migration = read('supabase/migrations/20260729170000_bar_pack_template_barcodes.sql')
  const domain = read('src/main/domains/pos.js')
  assert.match(migration, /v_barcode_present boolean := payload \? 'barcode'/)
  assert.match(migration, /insert into public\.pos_menu_items \([\s\S]*barcode,/)
  assert.match(migration, /barcode = case when v_barcode_present then v_barcode else barcode end/)
  assert.match(migration, /ii\.barcode/)
  assert.match(migration, /normalize_pos_barcode\(v_item\.barcode\)/)
  assert.match(domain, /set_bar_pos_pack_template/)
  assert.match(domain, /barcode: rawBarcode \|\| null/)
})

test('shared decoder consumes Enter and preserves zero-prefixed scanned values', () => {
  const decoder = createBarcodeScannerDecoder({ interKeyMs: 120 })
  const value = '00012345'
  value.split('').forEach((key, index) => decoder.consumeKey({ key, timeStamp: index * 4 }))
  const completed = decoder.consumeKey({ key: 'Enter', timeStamp: value.length * 4 })
  assert.equal(completed.type, 'completed')
  assert.equal(completed.result.success, true)
  assert.equal(completed.result.barcode, value)
})
