import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { COLLECTIONS, inspectExport } from '../scripts/dry-run-transition-import.mjs'

function fixture() {
  const collections = Object.fromEntries(COLLECTIONS.map((name) => [name, []]))
  collections.businesses.push({ source_id: 'business-1', business_id: 'business-1', name: 'Synthetic Bar' })
  collections.outlets.push({ source_id: 'outlet-1', business_id: 'business-1', outlet_id: 'outlet-1', name: 'Main' })
  collections.products.push({ source_id: 'product-1', business_id: 'business-1', outlet_id: 'outlet-1', sku: 'A', stock_uom: 'each', opening_value: '12.35' })
  return {
    format: 'tsa-bonno-bar-transition-export', version: 1,
    source: { business_id: 'business-1', outlet_ids: ['outlet-1'] },
    snapshot: { exported_at: '2026-10-28T12:00:00.000Z', complete: true },
    collections,
    relationships: [],
    reconciliations: [],
    control_totals: {
      collection_counts: Object.fromEntries(COLLECTIONS.map((name) => [name, collections[name].length])),
      measures: [{ name: 'product_cost_control', collection: 'products', field: 'opening_value', scale: 2, rows: 1, total: '12.35' }]
    }
  }
}

function updateCounts(input) {
  input.control_totals.collection_counts = Object.fromEntries(COLLECTIONS.map((name) => [name, input.collections[name].length]))
}

test('synthetic complete export creates a deterministic rehearsal receipt without importing', () => {
  const input = fixture()
  const first = inspectExport(input)
  const second = inspectExport(input)
  assert.deepEqual(first.errors, [])
  assert.equal(first.report.accepted_for_rehearsal, true)
  assert.equal(first.report.import_performed, false)
  assert.equal(first.report.database_contacted, false)
  assert.equal(first.report.source_sha256, second.report.source_sha256)
  assert.equal(first.report.control_totals.collection_counts.products, 1)
  assert.equal(first.report.control_totals.collection_counts.pending_operations, 0)
  assert.equal(first.report.control_totals.measures[0].total, '12.35')
})

test('incomplete snapshots, duplicate source IDs, foreign scope and wrong control totals are refused', () => {
  const input = fixture()
  input.snapshot.complete = false
  input.collections.products.push({ source_id: 'product-1', business_id: 'other-business', outlet_id: 'other-outlet' })
  input.control_totals.collection_counts.products = 1
  const result = inspectExport(input)
  assert.equal(result.report.accepted_for_rehearsal, false)
  assert.match(result.errors.join(' '), /Incomplete source snapshots/)
  assert.match(result.errors.join(' '), /Control measure product_cost_control does not reconcile/)
  assert.deepEqual(new Set(result.report.rejected_rows.map((row) => row.reason)), new Set([
    'duplicate_source_id_in_collection', 'foreign_business_scope', 'foreign_outlet_scope', 'control_measure_invalid:product_cost_control'
  ]))
})

test('missing collections and unresolved source intent remain visible as rejected input', () => {
  const input = fixture()
  delete input.collections.tenders
  input.collections.pending_operations.push({ source_id: 'operation-1', business_id: 'business-1', outlet_id: 'outlet-1', status: 'unknown' })
  const result = inspectExport(input)
  assert.equal(result.report.accepted_for_rehearsal, false)
  assert.match(result.errors.join(' '), /collections.tenders/)
  assert.deepEqual(new Set(result.report.rejected_rows.map((row) => row.reason)), new Set(['unresolved_source_operation']))
})

test('source inventory must include exactly the declared business/outlets and an explicit export timestamp', () => {
  const input = fixture()
  input.collections.outlets.length = 0
  input.snapshot.exported_at = 'yesterday'
  const result = inspectExport(input)
  assert.equal(result.report.accepted_for_rehearsal, false)
  assert.match(result.errors.join(' '), /exactly the declared source outlet set/)
  assert.match(result.errors.join(' '), /valid ISO-8601 timestamp/)
})

test('every exported row must declare its owning business', () => {
  const input = fixture()
  delete input.collections.products[0].business_id
  const result = inspectExport(input)
  assert.equal(result.report.accepted_for_rehearsal, false)
  assert.deepEqual(result.report.rejected_rows.map((row) => row.reason), ['business_scope_missing'])
})

test('outlet-owned operational rows must declare an outlet inside the export scope', () => {
  const input = fixture()
  input.collections.sales.push({ source_id: 'sale-1', business_id: 'business-1', outlet_id: '' })
  updateCounts(input)
  const missing = inspectExport(input)
  assert.deepEqual(missing.report.rejected_rows.map((row) => row.reason), ['outlet_scope_missing'])

  input.collections.sales[0].outlet_id = 'outside-outlet'
  const foreign = inspectExport(input)
  assert.deepEqual(foreign.report.rejected_rows.map((row) => row.reason), ['foreign_outlet_scope'])
})

test('declared source relationships resolve to one in-scope record and report linked counts', () => {
  const input = fixture()
  input.collections.customers.push({ source_id: 'customer-1', business_id: 'business-1', outlet_id: 'outlet-1' })
  input.collections.sales.push({ source_id: 'sale-1', business_id: 'business-1', outlet_id: 'outlet-1', customer_ref: 'customer-1' })
  input.relationships.push({ name: 'sale_customer', source_collection: 'sales', source_field: 'customer_ref', target_collection: 'customers', nullable: true, scope: 'same_outlet' })
  updateCounts(input)
  const result = inspectExport(input)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.report.relationships, [{ name: 'sale_customer', source_collection: 'sales', source_field: 'customer_ref', target_collection: 'customers', scope: 'same_outlet', linked_rows: 1, nullable_rows: 0 }])
})

test('financial parent totals reconcile exactly to scoped child rows and refuse mismatches', () => {
  const input = fixture()
  input.collections.sales.push({ source_id: 'sale-1', business_id: 'business-1', outlet_id: 'outlet-1', total: '10.00' })
  input.collections.tenders.push(
    { source_id: 'tender-1', business_id: 'business-1', outlet_id: 'outlet-1', sale_ref: 'sale-1', amount: '4.25' },
    { source_id: 'tender-2', business_id: 'business-1', outlet_id: 'outlet-1', sale_ref: 'sale-1', amount: '5.75' }
  )
  input.reconciliations.push({ name: 'sale_tenders', parent_collection: 'sales', parent_key: 'source_id', parent_field: 'total', child_collection: 'tenders', child_fk: 'sale_ref', child_field: 'amount', scale: 2, scope: 'same_outlet' })
  updateCounts(input)
  const balanced = inspectExport(input)
  assert.deepEqual(balanced.errors, [])
  assert.deepEqual(balanced.report.reconciliations, [{ name: 'sale_tenders', parent_collection: 'sales', child_collection: 'tenders', parents: 1, children: 2, balanced_parents: 1, accepted: true }])

  input.collections.tenders[1].amount = '5.74'
  const mismatch = inspectExport(input)
  assert.equal(mismatch.report.accepted_for_rehearsal, false)
  assert.ok(mismatch.errors.some((error) => error.includes('Reconciliation sale_tenders does not balance')))
  assert.equal(mismatch.report.reconciliations[0].accepted, false)

  input.collections.tenders[1].amount = '5.75'
  input.source.outlet_ids.push('outlet-2')
  input.collections.outlets.push({ source_id: 'outlet-2', business_id: 'business-1', outlet_id: 'outlet-2', name: 'Second' })
  input.collections.tenders[1].outlet_id = 'outlet-2'
  updateCounts(input)
  const crossOutlet = inspectExport(input)
  assert.equal(crossOutlet.report.accepted_for_rehearsal, false)
  assert.ok(crossOutlet.report.rejected_rows.some((row) => row.reason === 'reconciliation_scope_mismatch:sale_tenders'))
})

test('dangling and cross-outlet declared relationships are rejected', () => {
  const input = fixture()
  input.collections.customers.push({ source_id: 'customer-1', business_id: 'business-1', outlet_id: 'outlet-1' })
  input.collections.sales.push(
    { source_id: 'sale-1', business_id: 'business-1', outlet_id: 'outlet-1', customer_ref: 'missing-customer' },
    { source_id: 'sale-2', business_id: 'business-1', outlet_id: 'outlet-2', customer_ref: 'customer-1' }
  )
  input.source.outlet_ids.push('outlet-2')
  input.collections.outlets.push({ source_id: 'outlet-2', business_id: 'business-1', outlet_id: 'outlet-2', name: 'Second' })
  input.relationships.push({ name: 'sale_customer', source_collection: 'sales', source_field: 'customer_ref', target_collection: 'customers', nullable: false, scope: 'same_outlet' })
  updateCounts(input)
  const result = inspectExport(input)
  assert.equal(result.report.accepted_for_rehearsal, false)
  assert.deepEqual(new Set(result.report.rejected_rows.map((row) => row.reason)), new Set([
    'relationship_target_missing:sale_customer', 'relationship_outlet_scope:sale_customer'
  ]))
})

test('nullable links may be absent but required links may not', () => {
  const input = fixture()
  input.collections.customers.push({ source_id: 'customer-1', business_id: 'business-1', outlet_id: 'outlet-1' })
  input.collections.sales.push(
    { source_id: 'sale-optional', business_id: 'business-1', outlet_id: 'outlet-1', customer_ref: null },
    { source_id: 'sale-required', business_id: 'business-1', outlet_id: 'outlet-1', customer_ref: 'customer-1', required_customer_ref: 'customer-1' }
  )
  input.relationships.push(
    { name: 'optional_customer', source_collection: 'sales', source_field: 'customer_ref', target_collection: 'customers', nullable: true, scope: 'same_outlet' },
    { name: 'required_customer', source_collection: 'sales', source_field: 'required_customer_ref', target_collection: 'customers', nullable: false, scope: 'business' }
  )
  updateCounts(input)
  const result = inspectExport(input)
  assert.equal(result.report.accepted_for_rehearsal, false)
  assert.deepEqual(result.report.relationships.map((row) => row.nullable_rows), [1, 0])
  assert.deepEqual(result.report.rejected_rows.map((row) => row.reason), ['relationship_missing:required_customer'])
})

test('invalid decimal scales are refused even when the measured collection is empty', () => {
  const input = fixture()
  input.control_totals.measures = [{ name: 'empty_measure', collection: 'tenders', field: 'amount', scale: 99, rows: 0, total: '0' }]
  const result = inspectExport(input)
  assert.equal(result.report.accepted_for_rehearsal, false)
  assert.ok(result.errors.includes('Control measure empty_measure has an invalid decimal scale.'))

  input.control_totals.measures = [{ name: 'empty_field', collection: 'tenders', field: ' ', scale: 2, rows: 0, total: '0' }]
  const emptyFieldResult = inspectExport(input)
  assert.equal(emptyFieldResult.report.accepted_for_rehearsal, false)
  assert.ok(emptyFieldResult.errors.includes('Control measure empty_field names an unknown collection or field.'))
})

test('CLI writes an explicit dry-run receipt and refuses to overwrite an existing receipt', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bar-transition-dry-run-'))
  t.after(async () => {
    if (path.basename(dir).startsWith('bar-transition-dry-run-')) await rm(dir, { recursive: true, force: true })
  })
  const sourcePath = path.join(dir, 'synthetic.json')
  const receiptPath = path.join(dir, 'receipt.json')
  await writeFile(sourcePath, JSON.stringify(fixture()))
  const script = fileURLToPath(new URL('../scripts/dry-run-transition-import.mjs', import.meta.url))
  const run = () => spawnSync(process.execPath, [script, sourcePath, receiptPath], { encoding: 'utf8' })
  const first = run()
  assert.equal(first.status, 0, first.stderr)
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  assert.equal(receipt.import_performed, false)
  assert.equal(receipt.database_contacted, false)
  const second = run()
  assert.notEqual(second.status, 0, 'existing receipt must never be overwritten')

  const invalidSourcePath = path.join(dir, 'invalid-synthetic.json')
  const refusalReceiptPath = path.join(dir, 'refusal-receipt.json')
  const invalid = fixture()
  invalid.control_totals.measures = [{ name: 'empty_measure', collection: 'tenders', field: 'amount', scale: 99, rows: 0, total: '0' }]
  await writeFile(invalidSourcePath, JSON.stringify(invalid))
  const refusal = spawnSync(process.execPath, [script, invalidSourcePath, refusalReceiptPath], { encoding: 'utf8' })
  assert.equal(refusal.status, 1, refusal.stderr)
  const refusedReceipt = JSON.parse(await readFile(refusalReceiptPath, 'utf8'))
  assert.equal(refusedReceipt.accepted_for_rehearsal, false)
  assert.equal(refusedReceipt.database_contacted, false)
  assert.ok(refusedReceipt.errors.includes('Control measure empty_measure has an invalid decimal scale.'))
})
