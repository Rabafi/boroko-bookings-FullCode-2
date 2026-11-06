import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const legacyScreen = readFileSync(path.join(root, 'legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx'), 'utf8')
const legacyPanel = readFileSync(path.join(root, 'legacy-pos/src/renderer/src/components/BarLocalOperationsPanel.jsx'), 'utf8')
const contracts = readFileSync(path.join(root, 'packages/bar-contracts/src/registry.ts'), 'utf8')
const migration = readFileSync(path.join(root, 'services/bar-local/db/migrations/0047_stock_lot_expiry_report.sql'), 'utf8')
const { QUERIES } = await import(pathToFileURL(path.join(root, 'packages/bar-contracts/dist/index.js')).href)
const { getCommand } = await import(pathToFileURL(path.join(root, 'packages/bar-contracts/dist/index.js')).href)

test('Legacy local workspace exposes FEFO balances separately from immutable receipt history', () => {
  assert.match(legacyScreen, /stock\.lot_balances/)
  assert.match(legacyScreen, /stock\.lot_expiry/)
  assert.match(legacyScreen, /Current lot balances and FEFO status/)
  assert.match(legacyScreen, /Pre-existing stock without a recorded lot remains labelled as unknown provenance/)
  assert.match(legacyScreen, /received_quantity/)
  assert.match(legacyScreen, /remaining_quantity/)
  assert.match(legacyScreen, /expires_on/)
})

test('live lot-balance query has a separate inventory-view contract and server authority', () => {
  assert.equal(typeof QUERIES['stock.lot_balances'], 'object')
  assert.match(contracts, /'stock\.lot_balances'.*CAPABILITIES\.INVENTORY_VIEW/)
  const lotLedger = readFileSync(path.join(root, 'services/bar-local/db/migrations/0069_stock_lot_ledger_fefo.sql'), 'utf8')
  assert.match(lotLedger, /CREATE TABLE bar_local\.stock_lots/)
  assert.match(lotLedger, /CREATE TABLE bar_local\.stock_lot_events/)
  assert.match(lotLedger, /ORDER BY expires_on ASC NULLS LAST,created_at,id/)
  assert.match(lotLedger, /INSUFFICIENT_LOT_STOCK/)
  assert.match(lotLedger, /legacy_unallocated/)
  assert.match(lotLedger, /sale_return_quarantine/)
})

test('both local stock panels expose manager-approved exact-lot waste and inspected quarantine release', () => {
  assert.match(legacyPanel, /stock\.lot\.waste/)
  assert.match(legacyPanel, /stock\.lot\.release/)
  const waste = getCommand('stock.lot.waste').validate({ lot_id: '51000000-0000-4000-8000-000000000001', product_id: '51000000-0000-4000-8000-000000000002', expected_version: 2, quantity: '1.25', reason: 'Damaged packaging' })
  assert.equal(waste.expected_version, 2)
  const release = getCommand('stock.lot.release').validate({ lot_id: '51000000-0000-4000-8000-000000000001', expected_version: 2, verified_lot_code: 'INSPECTED-1', verified_expires_on: '2030-01-01', no_expiry_confirmed: false, reason: 'Inspected packaging' })
  assert.equal(release.no_expiry_confirmed, false)
  const functions = readFileSync(path.join(root, 'services/bar-local/src/commands.ts'), 'utf8')
  assert.match(functions, /'stock\.lot\.waste': 'bar_local\.cmd_stock_lot_waste'/)
  assert.match(functions, /'stock\.lot\.release': 'bar_local\.cmd_stock_lot_release'/)
})

test('lot expiry query is inventory-view scoped and its database report returns receipt records only', () => {
  assert.equal(typeof QUERIES['stock.lot_expiry'], 'object')
  assert.match(contracts, /'stock\.lot_expiry'.*CAPABILITIES\.INVENTORY_VIEW/)
  assert.match(migration, /bar_local\.query_outlet/)
  assert.match(migration, /m\.reason IN \('stock\.receive', 'purchase\.receive'\)/)
  assert.match(migration, /'received_quantity_only; remaining on-hand by lot is not tracked'/)
  assert.match(migration, /REVOKE ALL ON FUNCTION bar_local\.query_dispatch_lot_expiry_previous/)
})
