import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { getSyncItemScope, normalizeQueuedSyncItemForReplay } from '../src/main/domains/syncShared.js'

const read = (file) => fs.readFileSync(file, 'utf8')
const migration = read('supabase/migrations/20260820120000_bar_base_atomic_stock_operations.sql')
const domain = read('src/main/domains/inventory.js')
const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
const printer = read('src/main/hardware/posHardwareAdapter.js')
const preload = read('src/preload/index.js')
const mesh = read('src/main/domains/mesh/meshQueueMerge.js')

test('Bar Base stock mutations use single atomic idempotent RPC contracts', () => {
  assert.match(migration, /create table if not exists public\.bar_stock_operation_idempotency/)
  assert.match(migration, /create or replace function public\.post_bar_physical_count/)
  assert.match(migration, /create or replace function public\.post_bar_simple_delivery/)
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('bar-stock:/)
  assert.match(migration, /for update/)
  assert.match(migration, /stale_expected_quantity/)
  assert.match(migration, /payload_hash/)
  assert.match(migration, /expected_qty numeric/)
  assert.match(migration, /actual_qty numeric/)
})

test('simple delivery stays outside purchasing and fails closed with Accounting active', () => {
  assert.match(migration, /accounting_purchase_receiving_required/)
  assert.match(migration, /Use the audited Purchase Receiving workflow for deliveries/)
  assert.match(domain, /postBarSimpleDelivery/)
  const simpleDeliveryBody = migration.split('create or replace function public.post_bar_simple_delivery')[1].split('create or replace function public.get_bar_stock_count_history')[0]
  assert.doesNotMatch(simpleDeliveryBody, /payload->>'supplier'|payload->>'purchase_order'|payload->>'lot_id'|payload->>'expiry/i)
})

test('desktop and mesh replay expose the exact batch contracts', () => {
  assert.match(domain, /queueOperation\('rpc', 'post_bar_physical_count'/)
  assert.match(domain, /queueOperation\('rpc', 'post_bar_simple_delivery'/)
  assert.match(preload, /postBarPhysicalCount: \(payload\) => invoke\('inventory:postBarPhysicalCount'/)
  assert.match(preload, /postBarSimpleDelivery: \(payload\) => invoke\('inventory:postBarSimpleDelivery'/)
  assert.match(mesh, /'post_bar_physical_count'/)
  assert.match(mesh, /'post_bar_simple_delivery'/)
})

test('Count All requires certified versioned stock and reviews all lines before posting', () => {
  assert.match(stock, /itemsRead\.complete && scopedItems\.length > 0 && scopedItems\.every\(\(item\) => Boolean\(item\?\.updated_at\)\)/)
  assert.match(stock, /Review Count All/)
  assert.match(stock, /postBarPhysicalCount\(/)
  assert.match(stock, /server rejects the whole operation/)
  assert.match(stock, /expected_qty/)
  assert.match(stock, /actual_qty/)
  assert.match(stock, /String\(line\.actual_qty \?\? ''\)\.trim\(\) === ''/)
  assert.match(stock, /setCountLines\(scopedItems\.map/)
  assert.match(stock, /disabled=\{loading \|\| !stockCountsReady \|\| !scopedItems\.length\}/)
  assert.match(domain, /actualRaw == null \|\| String\(actualRaw\)\.trim\(\) === ''/)
  assert.match(migration, /missing_stock_version/)
})

test('barcode receiving and verified output-path label printing have recovery paths', () => {
  assert.match(domain, /findInventoryItemByBarcode/)
  assert.match(stock, /Barcode lookup/)
  assert.match(stock, /Print label/)
  assert.match(preload, /printBarcodeLabels: \(labels\) => invoke\('inventory:printBarcodeLabels'/)
})

test('mesh validator accepts the exact batch envelope and rejects unsafe or incomplete variants', () => {
  const start = mesh.indexOf('export function validateSyncQueueItem(item)')
  const end = mesh.indexOf('function applyImportedBookingCacheEffects', start)
  assert.ok(start >= 0 && end > start)
  const validator = new Function('ALLOWED_RPC_TABLES', 'meshState', 'isPlainObject', 'isUuid', 'isFiniteNumber', mesh.slice(start, end).trimEnd().replace('export ', '') + '; return validateSyncQueueItem;')(
    new Set(['post_bar_physical_count', 'post_bar_simple_delivery']),
    { lodgeId: '11111111-1111-4111-8111-111111111111' },
    (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
    (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim()),
    (value) => Number.isFinite(Number(value))
  )
  const valid = {
    _queue_id: 'bar-stock-count-22222222-2222-4222-8222-222222222222',
    type: 'rpc', table: 'post_bar_physical_count',
    data: {
      p_lodge_id: '11111111-1111-4111-8111-111111111111',
      p_operation_id: '22222222-2222-4222-8222-222222222222', p_outlet_id: null,
      p_lines: [{ item_id: '33333333-3333-4333-8333-333333333333', expected_qty: 2, actual_qty: 2, expected_updated_at: '2026-08-20T10:00:00.000Z', reason: '', reason_code: 'routine_count' }], p_notes: null
    }
  }
  assert.equal(validator(valid).isValid, true)
  assert.equal(validator({ ...valid, data: { ...valid.data, p_lines: [{ ...valid.data.p_lines[0], actual_qty: '' }] } }).isValid, false)
  assert.equal(validator({ ...valid, data: { ...valid.data, p_lines: [{ ...valid.data.p_lines[0], expected_updated_at: '' }] } }).isValid, false)
  assert.equal(validator({ ...valid, table: 'post_bar_simple_delivery', data: { ...valid.data, p_lines: [{ item_id: valid.data.p_lines[0].item_id, quantity: 1, reason: '', reason_code: 'delivery_received', supplier: 'leak' }] } }).isValid, false)
})

test('offline batch dependencies point only to real queued item creates', () => {
  assert.match(domain, /const dependencies = queuedBarBatchDependencies\(normalizedLines\)\s+markLocalBarBatchPending/)
  assert.match(domain, /readSyncQueue\(\)\s+\.filter\(\(item\) => item\?\.type === 'rpc' && item\?\.table === 'create_inventory_item'/)
  assert.match(domain, /queuedCreates\.has\(dependency\)/)
})

test('barcode output counts only rows that the adapter can actually emit', () => {
  assert.match(printer, /const validRows = rows\.filter/)
  assert.match(printer, /!\/\[\^\\x20-\\x7e\]\/.test\(barcode\)/)
  assert.match(printer, /printed: validRows\.length/)
})

test('offline replay keeps the batch object and canonical line order', () => {
  const item = {
    type: 'rpc', table: 'post_bar_physical_count', _queue_id: 'bar-stock-count-22222222-2222-4222-8222-222222222222',
    data: { p_operation_id: '22222222-2222-4222-8222-222222222222', p_lines: [{ item_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, { item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] }
  }
  const replay = normalizeQueuedSyncItemForReplay(item)
  assert.equal(typeof replay, 'object')
  assert.deepEqual(replay.data.p_lines.map((line) => line.item_id), ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'])
  assert.equal(getSyncItemScope(item), 'bar-stock-operation:22222222-2222-4222-8222-222222222222')
})
