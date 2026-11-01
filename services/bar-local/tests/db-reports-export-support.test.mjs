import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Text } from './harness.mjs'

async function readReport(h, fn, filters = {}) {
  const result = await h.migrator.query(
    `SELECT bar_local.${fn}($1,$2,$3,$4,$5::jsonb) AS result`,
    [h.ownerTokenHash, h.deviceId, h.authorityId, 1, JSON.stringify(filters)]
  )
  return result.rows[0].result
}

test('local reports, audit search, export bundles and support reports preserve scope and honesty', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift('100.00')

  const productA = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'REP-A', name: 'Report Ale', category: 'Beer', price: '10.00', tax_rate: '0.14', track_stock: true
  }))
  assert.equal(productA.ok, true, JSON.stringify(productA.error))
  const productAId = productA.result.product_id

  const productB = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'REP-B', name: 'Uncosted Bitters', category: 'Beer', price: '5.00', tax_rate: '0', track_stock: true
  }))
  assert.equal(productB.ok, true, JSON.stringify(productB.error))
  const productBId = productB.result.product_id

  const productC = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku: 'REP-C', name: 'Low Stock Stout', category: 'Beer', price: '1.00', tax_rate: '0', track_stock: true
  }))
  assert.equal(productC.ok, true, JSON.stringify(productC.error))
  const productCId = productC.result.product_id

  const receiveA = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
    product_id: productAId, quantity: '10', unit_cost: '6.00', supplier_ref: 'GRN-REP-1'
  }))
  assert.equal(receiveA.ok, true, JSON.stringify(receiveA.error))

  const receiveB = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
    product_id: productBId, quantity: '5'
  }))
  assert.equal(receiveB.ok, true, JSON.stringify(receiveB.error))

  const receiveC = await h.call('cmd_stock_receive', h.envelope('stock.receive', {
    product_id: productCId, quantity: '1', unit_cost: '0.50'
  }))
  assert.equal(receiveC.ok, true, JSON.stringify(receiveC.error))

  await h.migrator.query(
    `INSERT INTO bar_local.settings (key, value) VALUES ('low_stock_threshold', '2'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = bar_local.settings.version + 1, updated_at = now()`
  )

  const sale = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productAId, quantity: '2' }],
    discount_amount: '0',
    tip_amount: '2.00',
    tenders: [
      { method: 'cash', amount: '12.40', tendered: '12.40' },
      { method: 'card', amount: '12.40', reference: 'CARD-REP-1' }
    ]
  }))
  assert.equal(sale.ok, true, JSON.stringify(sale.error))
  assert.equal(Number(sale.receipt.total), 24.8)

  const stock = await readReport(h, 'stock_report')
  assert.equal(stock.snapshot_watermark > 0, true)
  assert.equal(stock.scope.outlet_id, h.outletId)
  assert.equal(stock.complete, false)
  assert.deepEqual(stock.unavailable, ['valuation_missing_cost'])

  const balanceA = stock.data.balances.find((row) => row.product_id === productAId)
  assert.equal(Number(balanceA.quantity), 8)
  const valuationA = stock.data.valuation.find((row) => row.product_id === productAId)
  assert.equal(Number(valuationA.unit_cost), 6)
  assert.equal(Number(valuationA.valuation_amount), 48)
  assert.equal(valuationA.cost_status, 'valued')
  const valuationB = stock.data.valuation.find((row) => row.product_id === productBId)
  assert.equal(valuationB.unit_cost, null)
  assert.equal(valuationB.valuation_amount, null)
  assert.equal(valuationB.cost_status, 'missing_cost')
  const lowSkus = stock.data.low_stock.map((row) => row.sku)
  assert.equal(lowSkus.includes('REP-C'), true)
  assert.equal(lowSkus.includes('REP-A'), false)
  assert.equal(lowSkus.includes('REP-B'), false)
  const movementReasons = stock.data.movements
    .filter((row) => row.product_id === productAId)
    .map((row) => row.reason)
  assert.equal(movementReasons.includes('stock.receive'), true)
  assert.equal(movementReasons.includes('sale.depletion'), true)

  const lowStockView = await h.migrator.query(
    `SELECT sku FROM bar_local.stock_report_low_stock WHERE business_id = $1 AND outlet_id = $2`,
    [h.businessId, h.outletId]
  )
  assert.deepEqual(lowStockView.rows.map((row) => row.sku), ['REP-C'])

  const close = await h.call('cmd_shift_close', h.envelope('shift.close', {
    shift_id: shiftId, counted_cash: '112.40'
  }))
  assert.equal(close.ok, true, JSON.stringify(close.error))
  assert.equal(Number(close.result.expected_cash), 112.4)
  assert.equal(Number(close.result.variance), 0)

  const cashup = await h.call('cmd_cashup_submit', h.envelope('cashup.submit', {
    shift_id: shiftId, counted_cash: '112.40', counted_card: '12.40', notes: 'balanced report', proof_refs: []
  }))
  assert.equal(cashup.ok, true, JSON.stringify(cashup.error))
  assert.equal(Number(cashup.result.variance), 0)

  const cash = await readReport(h, 'cashup_report')
  const cashRow = cash.data.shifts.find((row) => row.shift_id === shiftId)
  assert.equal(cashRow.cashup_status, 'submitted')
  assert.equal(Number(cashRow.expected_cash), 112.4)
  assert.equal(Number(cashRow.counted_cash), 112.4)
  assert.equal(Number(cashRow.cash_variance), 0)
  assert.equal(Number(cashRow.expected_card), 12.4)
  assert.equal(Number(cashRow.counted_card), 12.4)
  assert.equal(Number(cashRow.card_variance), 0)
  assert.equal(Number(cashRow.tips), 2)
  assert.equal(cashRow.counted_cash_source, 'cashup')
  assert.equal(cashRow.complete, true)
  assert.equal(cashRow.unavailable.includes('card_provider_settlement_unverified'), true)
  assert.equal(cash.complete, true)
  assert.equal(Number(cash.data.totals.counted_cash), 112.4)
  assert.equal(Number(cash.data.totals.counted_card), 12.4)
  assert.equal(Number(cash.data.totals.cash_variance), 0)
  assert.equal(Number(cash.data.totals.card_variance), 0)
  assert.equal(Number(cash.data.totals.tips), 2)
  const tenderMap = new Map(cashRow.tenders.map((row) => [row.method, Number(row.amount)]))
  assert.equal(tenderMap.get('cash'), 12.4)
  assert.equal(tenderMap.get('card'), 12.4)

  const firstAudit = await readReport(h, 'audit_search', { limit: '2' })
  assert.equal(firstAudit.data.length, 2)
  assert.equal(firstAudit.pagination.has_more, true)
  assert.notEqual(firstAudit.pagination.next_cursor, null)
  const secondAudit = await readReport(h, 'audit_search', {
    limit: '2', cursor: String(firstAudit.pagination.next_cursor)
  })
  const firstIds = new Set(firstAudit.data.map((row) => row.id))
  assert.equal(secondAudit.data.some((row) => firstIds.has(row.id)), false)

  const cashupAudit = await readReport(h, 'audit_search', { action: 'cashup.submitted' })
  assert.equal(cashupAudit.complete, true)
  const cashupAuditRow = cashupAudit.data.find((row) => row.operation_id === cashup.result.operation_id)
  assert.notEqual(cashupAuditRow, undefined)
  assert.equal(cashupAuditRow.before, null)
  assert.equal(Number(cashupAuditRow.after.variance), 0)

  const supportEnvelope = h.envelope('support.report', {
    category: 'bug',
    severity: 'high',
    subject: 'Till display froze',
    message: 'The till froze after a card tender. No sale was lost.',
    diagnostics: {
      app_version: '1.2.3',
      password: 'hunter2',
      pin: 'pin-9988',
      api_key: 'sk-live-secret',
      nested: {
        authorization: 'Bearer abc',
        token: 'secret-token',
        safe: 'visible'
      }
    },
    metadata: {
      device_name: 'Till 1',
      authorization_header: 'Bearer metadata-secret'
    }
  })
  const support = await h.call('cmd_support_report_create', supportEnvelope)
  assert.equal(support.ok, true, JSON.stringify(support.error))
  assert.equal(support.result.status, 'recorded')
  assert.equal(support.result.delivery_status, 'integration_disabled')
  assert.match(support.result.checksum, /^[0-9a-f]{64}$/)

  const storedSupport = await h.migrator.query(
    `SELECT diagnostics, metadata, checksum, status, delivery_status
       FROM bar_local.support_reports WHERE id = $1`,
    [support.result.support_report_id]
  )
  assert.equal(storedSupport.rows.length, 1)
  const diagnostics = storedSupport.rows[0].diagnostics
  assert.equal(diagnostics.password, '[redacted]')
  assert.equal(diagnostics.pin, '[redacted]')
  assert.equal(diagnostics.api_key, '[redacted]')
  assert.equal(diagnostics.nested.authorization, '[redacted]')
  assert.equal(diagnostics.nested.token, '[redacted]')
  assert.equal(diagnostics.nested.safe, 'visible')
  assert.equal(storedSupport.rows[0].metadata.authorization_header, '[redacted]')
  assert.equal(storedSupport.rows[0].metadata.device_name, 'Till 1')
  assert.equal(storedSupport.rows[0].checksum, support.result.checksum)
  assert.equal(storedSupport.rows[0].delivery_status, 'integration_disabled')
  assert.equal(JSON.stringify(storedSupport.rows[0]).includes('hunter2'), false)
  assert.equal(JSON.stringify(storedSupport.rows[0]).includes('secret-token'), false)
  assert.equal(JSON.stringify(storedSupport.rows[0]).includes('sk-live-secret'), false)

  const supportReplay = await h.call('cmd_support_report_create', supportEnvelope)
  assert.equal(supportReplay.replayed, true)
  assert.equal(supportReplay.result.support_report_id, support.result.support_report_id)

  const supportHistory = await h.query('support.reports.list', { limit: 1 })
  assert.equal(supportHistory.complete, true)
  assert.equal(supportHistory.scope.business_id, h.businessId)
  assert.equal(supportHistory.scope.outlet_id, h.outletId)
  assert.equal(supportHistory.data.length, 1)
  assert.equal(supportHistory.data[0].id, support.result.support_report_id)
  assert.equal(supportHistory.data[0].subject, 'Till display froze')
  assert.equal(supportHistory.data[0].diagnostics.password, '[redacted]')
  assert.equal(supportHistory.data[0].delivery_status, 'integration_disabled')
  assert.equal(supportHistory.pagination.has_more, false)
  await assert.rejects(h.runtime.query('SELECT * FROM bar_local.support_reports'), (error) => error.code === '42501')

  const supportOutbox = await h.migrator.query(
    `SELECT count(*)::integer AS count FROM bar_local.outbox WHERE operation_id = $1`,
    [supportEnvelope.operation_id]
  )
  assert.equal(supportOutbox.rows[0].count, 1)

  const cashierId = await h.insertStaff('Support Cashier', 'cashier', ['pos.view'])
  const cashierTokenHash = sha256Text(`support-cashier-${cashierId}`)
  await h.runtime.query('SELECT bar_local.service_create_session($1,$2,$3,$4)', [
    cashierId, h.deviceId, h.outletId, cashierTokenHash
  ])
  await assert.rejects(
    h.call('cmd_support_report_create', h.envelope('support.report', {
      category: 'bug', subject: 'Denied support', message: 'This should be denied.'
    }), { tokenHash: cashierTokenHash }),
    /settings\.manage/
  )
  await assert.rejects(h.query('support.reports.list', {}, { tokenHash: cashierTokenHash }), /settings\.manage/)
  await assert.rejects(
    h.call('cmd_export_bundle_create', h.envelope('export.bundle.create', { limit: 1 }), {
      tokenHash: cashierTokenHash
    }),
    /export\.manage/
  )

  const exportEnvelope = h.envelope('export.bundle.create', { limit: 3 })
  const exported = await h.call('cmd_export_bundle_create', exportEnvelope)
  assert.equal(exported.ok, true, JSON.stringify(exported.error))
  assert.equal(exported.result.event_count, 3)
  assert.match(exported.result.batch_id, /^[0-9a-f-]{36}$/)
  assert.match(exported.result.manifest_hash, /^[0-9a-f]{64}$/)
  assert.equal(exported.result.status, 'integration_disabled')
  assert.equal(exported.result.signature_status, 'unavailable')
  assert.equal(exported.result.transport_status, 'integration_disabled')

  const storedBatch = await h.migrator.query(
    `SELECT id, batch_id, from_sequence, to_sequence, event_count, manifest_hash, manifest,
            payload_hash, status, checkpoint, signature, key_id, signature_key_id,
            signature_status, transport_status
       FROM bar_local.export_batches WHERE batch_id = $1`,
    [exported.result.batch_id]
  )
  assert.equal(storedBatch.rows.length, 1)
  const batch = storedBatch.rows[0]
  assert.equal(batch.id, batch.batch_id)
  assert.equal(Number(batch.event_count), 3)
  assert.equal(Number(batch.checkpoint), Number(batch.to_sequence))
  assert.equal(batch.payload_hash, batch.manifest_hash)
  assert.equal(batch.status, 'integration_disabled')
  assert.equal(batch.signature, null)
  assert.equal(batch.key_id, null)
  assert.equal(batch.signature_key_id, null)
  assert.equal(batch.signature_status, 'unavailable')
  assert.equal(batch.transport_status, 'integration_disabled')
  assert.equal(batch.manifest.schema, 'bar-local-export-bundle')
  assert.equal(batch.manifest.events.length, 3)
  assert.equal(batch.manifest.event_count, 3)

  const batchHash = await h.migrator.query(
    `SELECT bar_local.sha256_hex(bar_local.canonical_jsonb_text(manifest)) AS calculated
       FROM bar_local.export_batches WHERE batch_id = $1`,
    [exported.result.batch_id]
  )
  assert.equal(batchHash.rows[0].calculated, batch.manifest_hash)

  const itemCount = await h.migrator.query(
    `SELECT count(*)::integer AS count FROM bar_local.export_batch_items WHERE batch_id = $1`,
    [exported.result.batch_id]
  )
  assert.equal(itemCount.rows[0].count, 3)
  const markedOutbox = await h.migrator.query(
    `SELECT count(*)::integer AS count FROM bar_local.outbox WHERE export_batch_id = $1`,
    [exported.result.batch_id]
  )
  assert.equal(markedOutbox.rows[0].count, 3)

  const exportReplay = await h.call('cmd_export_bundle_create', exportEnvelope)
  assert.equal(exportReplay.replayed, true)
  assert.equal(exportReplay.result.batch_id, exported.result.batch_id)
  const batchCount = await h.migrator.query('SELECT count(*)::integer AS count FROM bar_local.export_batches')
  assert.equal(batchCount.rows[0].count, 1)

  const secondExport = await h.call('cmd_export_bundle_create', h.envelope('export.bundle.create', { limit: 2 }))
  assert.equal(secondExport.ok, true, JSON.stringify(secondExport.error))
  assert.equal(secondExport.result.event_count, 2)
  assert.notEqual(secondExport.result.batch_id, exported.result.batch_id)

  const overlaps = await h.migrator.query(
    `SELECT event_id FROM bar_local.export_batch_items
      GROUP BY event_id HAVING count(*) > 1`
  )
  assert.equal(overlaps.rows.length, 0)

  const remaining = await h.migrator.query(
    `SELECT count(*)::integer AS count FROM bar_local.outbox
      WHERE business_id = $1 AND outlet_id = $2 AND export_batch_id IS NULL`,
    [h.businessId, h.outletId]
  )
  if (remaining.rows[0].count > 0) {
    const drain = await h.call('cmd_export_bundle_create', h.envelope('export.bundle.create', { limit: 1000 }))
    assert.equal(drain.ok, true, JSON.stringify(drain.error))
  }

  const exportedSupport = await h.migrator.query(
    `SELECT export_batch_id FROM bar_local.outbox WHERE operation_id = $1`,
    [supportEnvelope.operation_id]
  )
  assert.notEqual(exportedSupport.rows[0].export_batch_id, null)

  const noPending = await h.call('cmd_export_bundle_create', h.envelope('export.bundle.create', { limit: 10 }))
  assert.equal(noPending.ok, true, JSON.stringify(noPending.error))
  assert.equal(noPending.result.event_count, 0)
  assert.equal(noPending.result.batch_id, null)
  assert.equal(noPending.result.status, 'no_pending_events')
})
