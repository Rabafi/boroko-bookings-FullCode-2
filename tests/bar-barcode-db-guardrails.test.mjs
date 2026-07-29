import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('barcode database guardrail migration normalizes and locks assignments', () => {
  const sql = read('supabase/migrations/20260729160000_barcode_scanner_guardrails.sql')
  assert.match(sql, /normalize_pos_barcode/)
  assert.match(sql, /128 characters or fewer/)
  assert.match(sql, /unsupported control characters/)
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended/)
  assert.match(sql, /inventory_items_barcode_guard/)
  assert.match(sql, /pos_menu_items_barcode_guard/)
  assert.match(sql, /barcode_conflict/)
  assert.match(sql, /p_outlet_id is null or .*outlet_id is null/s)
  assert.match(sql, /check_barcode_assignment/)
})
test('scanner verification is exposed through the authoritative desktop bridge', () => {
  const adapter = read('src/main/hardware/posHardwareAdapter.js')
  const domain = read('src/main/domains/pos.js')
  const database = read('src/main/database.js')
  const main = read('src/main/index.js')
  const preload = read('src/preload/index.js')
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx')
  for (const field of ['barcode_scanner_enabled', 'barcode_scanner_min_length', 'scanner_last_verified_at']) {
    assert.match(adapter, new RegExp(field))
  }
  assert.match(domain, /verifyPosBarcodeScanner/)
  assert.match(domain, /barcode_sha256/)
  assert.match(database, /verifyPosBarcodeScanner/)
  assert.match(main, /pos:verifyBarcodeScanner/)
  assert.match(preload, /verifyBarcodeScanner/)
  assert.match(health, /Verify scanner input/)
  assert.match(health, /createBarcodeScannerDecoder/)
})
