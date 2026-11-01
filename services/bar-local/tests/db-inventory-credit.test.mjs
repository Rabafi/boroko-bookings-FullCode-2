import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createHarness, sha256Json } from './harness.mjs'

test('stock, credit, vouchers and settings stay consistent locally', async (t) => {
  const h = await createHarness(t)
  const shiftId = await h.openShift()

  const productEnvelope = h.envelope('catalogue.upsert', {
    sku: 'RUM-750', name: 'Rum 750ml', category: 'Spirits', price: '10.00', tax_rate: '0.14', track_stock: true
  })
  const product = await h.call('cmd_catalogue_upsert', productEnvelope)
  assert.equal(product.ok, true, JSON.stringify(product.error))
  const productId = product.result.product_id

  const receiveEnvelope = h.envelope('stock.receive', {
    product_id: productId, quantity: '10', unit_cost: '6.00', supplier_ref: 'GRN-1'
  })
  const received = await h.call('cmd_stock_receive', receiveEnvelope)
  assert.equal(received.ok, true, JSON.stringify(received.error))
  assert.equal(Number(received.result.quantity), 10)

  const invalidReceive = h.envelope('stock.receive', { product_id: productId, quantity: '-5' })
  const refusedReceive = await h.call('cmd_stock_receive', invalidReceive)
  assert.equal(refusedReceive.ok, false)
  assert.equal(refusedReceive.error.code, 'VALIDATION_FAILED')

  const saleEnvelope = h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '2' }],
    discount_amount: '0',
    tip_amount: '0',
    tenders: [{ method: 'cash', amount: '22.80', tendered: '22.80' }]
  })
  const sale = await h.call('cmd_sale_commit', saleEnvelope)
  assert.equal(sale.ok, true, JSON.stringify(sale.error))

  const badTender = await h.call('cmd_sale_commit', h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '1' }],
    tenders: [{ method: 'bitcoin', amount: '11.40' }]
  }))
  assert.equal(badTender.ok, false)
  assert.equal(badTender.error.code, 'VALIDATION_FAILED')

  const insufficient = h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '100' }],
    tenders: [{ method: 'cash', amount: '1140.00' }]
  })
  const refusedSale = await h.call('cmd_sale_commit', insufficient)
  assert.equal(refusedSale.ok, false)
  assert.equal(refusedSale.error.code, 'INSUFFICIENT_STOCK')
  const refusedReplay = await h.call('cmd_sale_commit', insufficient)
  assert.equal(refusedReplay.replayed, true)
  assert.equal(refusedReplay.outcome, 'refused')

  const customerEnvelope = h.envelope('customer.create', {
    name: 'Credit Customer', phone: '+26770000000', credit_limit: '100.00'
  })
  const customer = await h.call('cmd_customer_create', customerEnvelope)
  assert.equal(customer.ok, true, JSON.stringify(customer.error))
  const customerId = customer.result.customer_id

  const creditSaleEnvelope = h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '3' }],
    customer_id: customerId,
    tenders: [{ method: 'customer_credit', amount: '34.20', customer_id: customerId }]
  })
  const creditSale = await h.call('cmd_sale_commit', creditSaleEnvelope)
  assert.equal(creditSale.ok, true, JSON.stringify(creditSale.error))

  const paymentEnvelope = h.envelope('customer.credit_payment', {
    customer_id: customerId, amount: '10.00', method: 'cash', shift_id: shiftId, reference: 'RC-1'
  })
  const payment = await h.call('cmd_credit_payment', paymentEnvelope)
  assert.equal(payment.ok, true, JSON.stringify(payment.error))
  assert.equal(Number(payment.result.outstanding), 24.2)

  const voucherEnvelope = h.envelope('voucher.issue', {
    amount: '50.00', customer_id: customerId, expires_on: null
  })
  const voucherHash = sha256Json(voucherEnvelope.payload)
  voucherEnvelope.payload.approval_id = await h.approve('vouchers.manage', voucherHash, { targetType: 'voucher' })
  const voucher = await h.call('cmd_voucher_issue', voucherEnvelope, { approvalHash: voucherHash })
  assert.equal(voucher.ok, true, JSON.stringify(voucher.error))
  assert.equal(Number(voucher.result.balance), 50)

  const voucherSaleEnvelope = h.envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '1' }],
    customer_id: customerId,
    tenders: [{ method: 'voucher', amount: '11.40', voucher_code: voucher.result.code }]
  })
  const voucherSale = await h.call('cmd_sale_commit', voucherSaleEnvelope)
  assert.equal(voucherSale.ok, true, JSON.stringify(voucherSale.error))

  const returnEnvelope = h.envelope('sale.return', {
    sale_id: voucherSale.result.sale_id,
    lines: [{ sale_line_id: voucherSale.result.receipt.lines[0].sale_line_id, quantity: '1' }],
    reason: 'Voucher sale reversed',
    disposition: 'restock'
  })
  const returnHash = sha256Json(returnEnvelope.payload)
  returnEnvelope.payload.approval_id = await h.approve('pos.void', returnHash, { targetType: 'sale', targetId: voucherSale.result.sale_id })
  const returned = await h.call('cmd_sale_return', returnEnvelope, { approvalHash: returnHash })
  assert.equal(returned.ok, true, JSON.stringify(returned.error))

  const voucherList = await h.query('vouchers.list', {})
  const voucherRow = voucherList.data.find((row) => row.voucher_id === voucher.result.voucher_id)
  assert.equal(Number(voucherRow.balance), 50)

  const secondOutletId = randomUUID()
  await h.migrator.query(
    `INSERT INTO bar_local.outlets (id, business_id, name, code) VALUES ($1,$2,'Terrace','TERRACE')`,
    [secondOutletId, h.businessId]
  )
  const transferEnvelope = h.envelope('stock.transfer', {
    product_id: productId, quantity: '4', to_outlet_id: secondOutletId
  })
  const transfer = await h.call('cmd_stock_transfer', transferEnvelope)
  assert.equal(transfer.ok, true, JSON.stringify(transfer.error))

  const balances = await h.migrator.query(
    `SELECT outlet_id, quantity FROM bar_local.stock_balances WHERE product_id = $1 ORDER BY outlet_id`,
    [productId]
  )
  const byOutlet = new Map(balances.rows.map((row) => [row.outlet_id, Number(row.quantity)]))
  assert.equal(byOutlet.get(h.outletId), 1)
  assert.equal(byOutlet.get(secondOutletId), 4)

  const menu = await h.query('menu.list', {})
  const menuRow = menu.data.find((row) => row.product_id === productId)
  assert.equal(Number(menuRow.stock_quantity), 1)

  const badSetting = h.envelope('settings.update', { key: 'currency', value: 'usd' })
  const refusedSetting = await h.call('cmd_settings_update', badSetting)
  assert.equal(refusedSetting.ok, false)
  assert.equal(refusedSetting.error.code, 'VALIDATION_FAILED')

  const readiness = await h.runtime.query('SELECT bar_local.service_readiness($1,$2) AS result', [h.ownerTokenHash, h.deviceId])
  assert.equal(readiness.rows[0].result.ready, true)
  assert.equal(readiness.rows[0].result.cloud_export, 'integration_disabled')

  const status = await h.runtime.query('SELECT bar_local.service_operation_status($1,$2,$3) AS result', [
    h.ownerTokenHash, h.deviceId, saleEnvelope.operation_id
  ])
  assert.equal(status.rows[0].result.status, 'committed')
  assert.equal(status.rows[0].result.outcome, 'committed_local')
})

