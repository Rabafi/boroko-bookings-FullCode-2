import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApiHarness } from './api-harness.mjs'
import { TEST_SETUP_SECRET, sha256Text } from './harness.mjs'

const OWNER_PIN = '1234'
const STAFF_PIN = '2468'

async function bootstrap(t) {
  const h = await createApiHarness(t)
  const setupResponse = await h.request('/v1/setup/owner', {
    body: {
      setup_secret: TEST_SETUP_SECRET,
      business_name: 'API Advanced Bar',
      outlet_name: 'Main Bar',
      owner_name: 'Owner Advanced',
      pin: OWNER_PIN,
      currency: 'BWP',
      timezone: 'Africa/Gaborone',
      device_name: 'Advanced Till',
      device_platform: 'modern'
    }
  })
  assert.equal(setupResponse.status, 201, JSON.stringify(setupResponse.body))
  const setup = { ...setupResponse.body, device_token: setupResponse.stagedDeviceToken }
  const scope = {
    authority_id: setup.authority_id,
    authority_epoch: setup.authority_epoch,
    business_id: setup.business_id,
    outlet_id: setup.outlet_id,
    device_id: setup.device_id
  }
  const login = await h.request('/v1/sessions', {
    deviceToken: setup.device_token,
    body: { email: 'owner@example.test', password: 'test owner password 123' }
  })
  assert.equal(login.status, 201, JSON.stringify(login.body))
  const auth = { token: login.body.session_token, deviceId: setup.device_id }
  await h.migrator.query(
    'SELECT bar_local.service_set_entitlement($1,$2,$3,$4,$5)',
    [sha256Text(auth.token), setup.device_id, 1, ['bar_growth_multi_outlet', 'bar_accounting_workforce'], 'test-key']
  )
  await h.migrator.query(
    `INSERT INTO bar_local.accounting_accounts (code, name, type) VALUES
       ('1000','Cash','asset'), ('1010','Card clearing','asset'), ('1020','Bank','asset'),
       ('1030','Mobile money','asset'), ('1040','External clearing','asset'), ('1100','Customer credit','asset'),
       ('2100','Tax payable','liability'), ('2200','Vouchers','liability'), ('2300','Tips payable','liability'),
       ('4000','Sales revenue','revenue')
     ON CONFLICT (code) DO NOTHING`
  )
  const envelope = (command, payload, operationId = randomUUID()) => ({
    contract_version: 1,
    operation_id: operationId,
    command,
    ...scope,
    payload
  })
  return {
    h,
    setup,
    scope,
    auth,
    envelope,
    ownerStaffId: setup.owner_staff_id,
    deviceToken: setup.device_token
  }
}

function assertCommitted(response, envelope, label) {
  assert.equal(response.status, 200, `${label}: ${JSON.stringify(response.body)}`)
  assert.equal(response.body.ok, true, `${label}: ${JSON.stringify(response.body.error)}`)
  assert.equal(response.body.outcome, 'committed_local')
  assert.equal(response.body.receipt.operation_id, envelope.operation_id)
  assert.equal(response.body.receipt.outcome, 'committed_local')
  assert.equal(response.body.receipt.authority_id, envelope.authority_id)
  assert.equal(response.body.receipt.authority_epoch, envelope.authority_epoch)
  assert.equal(response.body.receipt.business_id, envelope.business_id)
  assert.equal(response.body.receipt.outlet_id, envelope.outlet_id)
  assert.equal(response.body.receipt.device_id, envelope.device_id)
  assert.equal(response.body.receipt.cloud_status, 'integration_disabled')
  assert.equal(typeof response.body.receipt.actor_staff_id, 'string')
  assert.equal(typeof response.body.receipt.commit_sequence, 'number')
  assert.match(response.body.receipt.business_date, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(response.body.receipt.server_committed_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(typeof response.body.result, 'object')
  return response.body
}

function assertBusinessRefusal(response, code) {
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.equal(response.body.ok, false)
  assert.equal(response.body.outcome, 'refused')
  assert.equal(response.body.error.code, code)
  assert.equal(typeof response.body.error.message, 'string')
  assert.equal(response.body.error.retry_same_operation, false)
  assert.equal(typeof response.body.error.requires_manager, 'boolean')
  return response.body
}

function assertHttpRefusal(response, status, code) {
  assert.equal(response.status, status, JSON.stringify(response.body))
  assert.equal(response.body.ok, false)
  assert.equal(response.body.outcome, 'refused')
  assert.equal(response.body.code, code)
  assert.equal(typeof response.body.message, 'string')
  assert.equal(response.body.retry_same_operation, false)
  assert.equal(typeof response.body.requires_manager, 'boolean')
  assert.equal(typeof response.body.correlation_id, 'string')
  return response.body
}

function postCommand(h, auth, envelope) {
  return h.request('/v1/commands', { ...auth, body: envelope })
}

async function createStaff(data, displayName, role, pin) {
  const { h, auth, envelope, deviceToken } = data
  const staffEnvelope = envelope('staff.create', { display_name: displayName, role, pin })
  const created = await postCommand(h, auth, staffEnvelope)
  assertCommitted(created, staffEnvelope, 'staff.create')
  const staffId = created.body.result.staff_id
  const login = await h.request('/v1/sessions', {
    deviceToken,
    body: { staff_id: staffId, pin }
  })
  assert.equal(login.status, 201, JSON.stringify(login.body))
  return {
    staffId,
    auth: { token: login.body.session_token, deviceId: data.scope.device_id }
  }
}

async function requestApproval(h, auth, operation, capability, pin) {
  const approval = await h.request('/v1/approvals', {
    ...auth,
    body: { operation, capability, pin }
  })
  assert.equal(approval.status, 201, JSON.stringify(approval.body))
  assert.equal(approval.body.ok, true)
  assert.equal(typeof approval.body.approval_id, 'string')
  assert.equal(typeof approval.body.operation_hash, 'string')
  return approval.body.approval_id
}

async function createProduct(data, sku, name, price) {
  const productEnvelope = data.envelope('catalogue.upsert', {
    sku,
    name,
    category: 'Food',
    price,
    tax_rate: '0',
    track_stock: false
  })
  const product = await postCommand(data.h, data.auth, productEnvelope)
  assertCommitted(product, productEnvelope, 'catalogue.upsert')
  return product.body.result.product_id
}

async function openShift(data) {
  const shiftEnvelope = data.envelope('shift.open', { opening_float: '100.00' })
  const shift = await postCommand(data.h, data.auth, shiftEnvelope)
  assertCommitted(shift, shiftEnvelope, 'shift.open')
  return shift.body.result.shift_id
}

async function businessDate(h) {
  const result = await h.migrator.query(`SELECT to_char(bar_local.current_business_date(), 'YYYY-MM-DD') AS value`)
  return result.rows[0].value
}

test('advanced catalogue commands commit, replay and reject unauthorized or invalid HTTP requests', async (t) => {
  const data = await bootstrap(t)
  const { h, auth, envelope } = data
  const burgerId = await createProduct(data, 'API-BURGER', 'API Burger', '20.00')
  const pattyId = await createProduct(data, 'API-PATTY', 'API Patty', '8.00')

  const groupEnvelope = envelope('catalogue.modifier_group.upsert', {
    code: 'COOK',
    name: 'Cook level',
    required: true,
    min_selections: 1,
    max_selections: 2
  })
  const group = await postCommand(h, auth, groupEnvelope)
  assertCommitted(group, groupEnvelope, 'catalogue.modifier_group.upsert')
  assert.equal(group.body.result.code, 'COOK')
  assert.equal(group.body.result.max_selections, 2)
  const groupId = group.body.result.modifier_group_id
  assert.equal(typeof groupId, 'string')

  const groupReplay = await postCommand(h, auth, groupEnvelope)
  assert.equal(groupReplay.body.ok, true)
  assert.equal(groupReplay.body.replayed, true)
  assert.equal(groupReplay.body.result.modifier_group_id, groupId)

  const recipeEnvelope = envelope('catalogue.recipe.set', {
    product_id: burgerId,
    lines: [{ ingredient_product_id: pattyId, quantity: '0.5', unit_cost: '8.00' }]
  })
  const recipe = await postCommand(h, auth, recipeEnvelope)
  assertCommitted(recipe, recipeEnvelope, 'catalogue.recipe.set')
  assert.equal(recipe.body.result.version, 1)
  assert.equal(Number(recipe.body.result.cost), 4)

  const invalidEnvelope = envelope('catalogue.recipe.set', {
    product_id: 'not-a-uuid',
    lines: []
  })
  const invalid = await postCommand(h, auth, invalidEnvelope)
  assertHttpRefusal(invalid, 400, 'VALIDATION_FAILED')

  const finance = await createStaff(data, 'Finance Catalogue', 'finance', STAFF_PIN)
  const deniedEnvelope = envelope('catalogue.modifier_group.upsert', {
    code: 'DENIED',
    name: 'Denied group'
  })
  const denied = await postCommand(h, finance.auth, deniedEnvelope)
  assertHttpRefusal(denied, 403, 'CAPABILITY_DENIED')
})

test('promotion.upsert commits through HTTP, replays exactly and rejects unauthorized or duplicate writes', async (t) => {
  const data = await bootstrap(t)
  const { h, auth, envelope } = data

  const promotionEnvelope = envelope('promotion.upsert', {
    code: 'API10',
    name: 'API ten percent',
    discount_type: 'percent',
    percent: '10',
    minimum_subtotal: '0',
    scope: 'all',
    active: true
  })
  const promotion = await postCommand(h, auth, promotionEnvelope)
  assertCommitted(promotion, promotionEnvelope, 'promotion.upsert')
  assert.equal(promotion.body.result.code, 'API10')
  assert.equal(promotion.body.result.version, 1)
  assert.equal(Number(promotion.body.result.percent), 10)
  assert.equal(typeof promotion.body.result.catalogue_version, 'number')

  const replay = await postCommand(h, auth, promotionEnvelope)
  assert.equal(replay.body.ok, true)
  assert.equal(replay.body.replayed, true)
  assert.equal(replay.body.result.promotion_id, promotion.body.result.promotion_id)

  const duplicate = await postCommand(h, auth, envelope('promotion.upsert', {
    code: 'API10',
    name: 'Duplicate API ten percent',
    discount_type: 'percent',
    percent: '5',
    scope: 'all'
  }))
  assertBusinessRefusal(duplicate, 'DUPLICATE_PROMOTION')

  const invalid = await postCommand(h, auth, envelope('promotion.upsert', {
    code: 'API-BAD',
    name: 'Invalid percentage',
    discount_type: 'percent',
    percent: '0',
    scope: 'all'
  }))
  assertHttpRefusal(invalid, 400, 'VALIDATION_FAILED')

  const finance = await createStaff(data, 'Finance Promotion', 'finance', STAFF_PIN)
  const denied = await postCommand(h, finance.auth, envelope('promotion.upsert', {
    code: 'API-DENIED',
    name: 'Denied promotion',
    discount_type: 'amount',
    amount: '1.00',
    scope: 'all'
  }))
  assertHttpRefusal(denied, 403, 'CAPABILITY_DENIED')
})

test('loyalty programme, enrolment, earning and redemption commit through HTTP with replay', async (t) => {
  const data = await bootstrap(t)
  const { h, auth, envelope } = data

  const programEnvelope = envelope('loyalty.program.upsert', {
    name: 'API loyalty',
    earn_rate: '1.25',
    redeem_value: '0.10',
    min_redeem_points: 5,
    active: true
  })
  const program = await postCommand(h, auth, programEnvelope)
  assertCommitted(program, programEnvelope, 'loyalty.program.upsert')
  assert.equal(Number(program.body.result.earn_rate), 1.25)
  assert.equal(Number(program.body.result.redeem_value), 0.1)
  assert.equal(program.body.result.min_redeem_points, 5)
  assert.equal(program.body.result.version, 1)

  const customerEnvelope = envelope('customer.create', { name: 'API Loyalty Guest' })
  const customer = await postCommand(h, auth, customerEnvelope)
  assertCommitted(customer, customerEnvelope, 'customer.create')
  const customerId = customer.body.result.customer_id

  const enrolEnvelope = envelope('loyalty.account.enrol', { customer_id: customerId })
  const enrolled = await postCommand(h, auth, enrolEnvelope)
  assertCommitted(enrolled, enrolEnvelope, 'loyalty.account.enrol')
  assert.equal(enrolled.body.result.customer_id, customerId)
  assert.equal(enrolled.body.result.status, 'active')
  assert.equal(enrolled.body.result.points_balance, 0)
  assert.equal(enrolled.body.result.version, 1)

  const duplicateEnrol = await postCommand(h, auth, envelope('loyalty.account.enrol', { customer_id: customerId }))
  assertBusinessRefusal(duplicateEnrol, 'LOYALTY_ACCOUNT_EXISTS')

  const productId = await createProduct(data, 'API-LOYALTY', 'API Loyalty Item', '10.35')
  const shiftId = await openShift(data)
  const saleEnvelope = envelope('sale.commit', {
    shift_id: shiftId,
    customer_id: customerId,
    items: [{ product_id: productId, quantity: '1' }],
    discount_amount: '0',
    tip_amount: '0',
    tenders: [{ method: 'cash', amount: '10.35', tendered: '10.35' }]
  })
  const sale = await postCommand(h, auth, saleEnvelope)
  assertCommitted(sale, saleEnvelope, 'sale.commit')

  const earnEnvelope = envelope('loyalty.points.earn', {
    sale_id: sale.body.result.sale_id,
    customer_id: customerId
  })
  const earned = await postCommand(h, auth, earnEnvelope)
  assertCommitted(earned, earnEnvelope, 'loyalty.points.earn')
  assert.equal(earned.body.result.points_delta, 12)
  assert.equal(earned.body.result.points_balance, 12)
  assert.equal(Number(earned.body.result.earn_rate), 1.25)

  const earnReplay = await postCommand(h, auth, earnEnvelope)
  assert.equal(earnReplay.body.ok, true)
  assert.equal(earnReplay.body.replayed, true)
  assert.equal(earnReplay.body.result.transaction_id, earned.body.result.transaction_id)

  const redeemEnvelope = envelope('loyalty.points.redeem', {
    customer_id: customerId,
    points: '5',
    reference: 'API-REWARD-1'
  })
  const redeemed = await postCommand(h, auth, redeemEnvelope)
  assertCommitted(redeemed, redeemEnvelope, 'loyalty.points.redeem')
  assert.equal(redeemed.body.result.points_delta, -5)
  assert.equal(redeemed.body.result.points_balance, 7)
  assert.equal(Number(redeemed.body.result.redemption_value), 0.5)
})

test('tip allocation and approved payout commit through HTTP with maker-checker evidence', async (t) => {
  const data = await bootstrap(t)
  const { h, auth, envelope } = data
  const productId = await createProduct(data, 'API-TIP', 'API Tip Item', '10.00')
  const shiftId = await openShift(data)

  const saleEnvelope = envelope('sale.commit', {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '1' }],
    discount_amount: '0',
    tip_amount: '5.00',
    tenders: [{ method: 'cash', amount: '15.00', tendered: '15.00' }]
  })
  const sale = await postCommand(h, auth, saleEnvelope)
  assertCommitted(sale, saleEnvelope, 'sale.commit')

  const allocateEnvelope = envelope('workforce.tip.allocate', {
    sale_id: sale.body.result.sale_id,
    staff_id: data.ownerStaffId,
    amount: '3.00',
    points: '1.5'
  })
  const allocated = await postCommand(h, auth, allocateEnvelope)
  assertCommitted(allocated, allocateEnvelope, 'workforce.tip.allocate')
  assert.equal(Number(allocated.body.result.amount), 3)
  assert.equal(Number(allocated.body.result.allocated_total), 3)
  assert.equal(Number(allocated.body.result.remaining_tip), 2)

  const manager = await createStaff(data, 'Tip Manager', 'manager', '5678')
  const payoutPayload = {
    staff_id: data.ownerStaffId,
    shift_id: shiftId,
    amount: '2.50',
    reason: 'API evening tip share'
  }

  const missingEnvelope = envelope('workforce.tip.payout', payoutPayload)
  const missing = await postCommand(h, manager.auth, missingEnvelope)
  const missingRefusal = assertBusinessRefusal(missing, 'APPROVAL_REQUIRED')
  assert.equal(missingRefusal.error.requires_manager, true)

  const payoutEnvelope = envelope('workforce.tip.payout', payoutPayload)
  payoutEnvelope.payload.approval_id = await requestApproval(h, auth, payoutEnvelope, 'pos.cashup', OWNER_PIN)
  const payout = await postCommand(h, manager.auth, payoutEnvelope)
  assertCommitted(payout, payoutEnvelope, 'workforce.tip.payout')
  assert.equal(payout.body.result.status, 'paid')
  assert.equal(Number(payout.body.result.amount), 2.5)
  assert.equal(Number(payout.body.result.balance_before), 3)
  assert.equal(Number(payout.body.result.balance_after), 0.5)
  assert.equal(typeof payout.body.result.cash_movement_id, 'string')

  const payoutReplay = await postCommand(h, manager.auth, payoutEnvelope)
  assert.equal(payoutReplay.body.ok, true)
  assert.equal(payoutReplay.body.replayed, true)
  assert.equal(payoutReplay.body.result.payout_id, payout.body.result.payout_id)
})

test('accounts payable invoice approval and payment commit through HTTP with replay', async (t) => {
  const data = await bootstrap(t)
  const { h, auth, envelope } = data
  const date = await businessDate(h)

  const supplierEnvelope = envelope('supplier.upsert', { name: 'API Supplier' })
  const supplier = await postCommand(h, auth, supplierEnvelope)
  assertCommitted(supplier, supplierEnvelope, 'supplier.upsert')
  const supplierId = supplier.body.result.supplier_id

  const accounts = [
    { code: '1110', name: 'API Bank', type: 'asset' },
    { code: '2000', name: 'API Accounts payable', type: 'liability' },
    { code: '2110', name: 'API Tax payable', type: 'liability' },
    { code: '5000', name: 'API Cost of sales', type: 'expense' }
  ]
  for (const account of accounts) {
    const accountEnvelope = envelope('accounting.account.upsert', account)
    const created = await postCommand(h, auth, accountEnvelope)
    assertCommitted(created, accountEnvelope, 'accounting.account.upsert')
  }

  const finance = await createStaff(data, 'Finance Approver', 'finance', STAFF_PIN)

  const invoiceEnvelope = envelope('accounting.ap.invoice.upsert', {
    supplier_id: supplierId,
    invoice_number: 'INV-API-1',
    invoice_date: date,
    due_date: date,
    subtotal: '100.00',
    tax_total: '15.00',
    total: '115.00',
    payable_account_code: '2000',
    tax_account_code: '2110',
    lines: [{
      description: 'API kegs',
      quantity: '2',
      unit_price: '50.00',
      tax_rate: '0.15',
      expense_account_code: '5000'
    }]
  })
  const invoice = await postCommand(h, auth, invoiceEnvelope)
  assertCommitted(invoice, invoiceEnvelope, 'accounting.ap.invoice.upsert')
  assert.equal(invoice.body.result.status, 'draft')
  assert.equal(Number(invoice.body.result.total), 115)
  assert.equal(invoice.body.result.line_count, 1)
  const invoiceId = invoice.body.result.id

  const approveEnvelope = envelope('accounting.ap.invoice.approve', { invoice_id: invoiceId })
  approveEnvelope.payload.approval_id = await requestApproval(h, finance.auth, approveEnvelope, 'accounting.approve', STAFF_PIN)
  const approved = await postCommand(h, auth, approveEnvelope)
  assertCommitted(approved, approveEnvelope, 'accounting.ap.invoice.approve')
  assert.equal(approved.body.result.status, 'approved')
  assert.equal(typeof approved.body.result.journal_entry_id, 'string')

  const paymentEnvelope = envelope('accounting.ap.payment.post', {
    invoice_id: invoiceId,
    amount: '50.00',
    payment_date: date,
    payment_account_code: '1110',
    method: 'bank',
    reference: 'PAY-API-1'
  })
  paymentEnvelope.payload.approval_id = await requestApproval(h, finance.auth, paymentEnvelope, 'accounting.approve', STAFF_PIN)
  const payment = await postCommand(h, auth, paymentEnvelope)
  assertCommitted(payment, paymentEnvelope, 'accounting.ap.payment.post')
  assert.equal(payment.body.result.status, 'posted')
  assert.equal(Number(payment.body.result.outstanding), 65)
  assert.equal(typeof payment.body.result.payment_id, 'string')

  const paymentReplay = await postCommand(h, auth, paymentEnvelope)
  assert.equal(paymentReplay.body.ok, true)
  assert.equal(paymentReplay.body.replayed, true)
  assert.equal(paymentReplay.body.result.payment_id, payment.body.result.payment_id)
})

test('support, export, report queries and unknown HTTP commands preserve documented envelopes', async (t) => {
  const data = await bootstrap(t)
  const { h, auth, envelope, scope } = data

  const supportEnvelope = envelope('support.report.create', {
    category: 'bug',
    severity: 'high',
    subject: 'API till froze',
    message: 'The till froze after a card tender. No sale was lost.',
    diagnostics: {
      app_version: '1.2.3',
      password: 'hunter2',
      api_key: 'sk-live-secret',
      nested: { authorization: 'Bearer abc', safe: 'visible' }
    },
    metadata: { device_name: 'Advanced Till' }
  })
  const support = await postCommand(h, auth, supportEnvelope)
  assertCommitted(support, supportEnvelope, 'support.report.create')
  assert.equal(support.body.result.status, 'recorded')
  assert.equal(support.body.result.delivery_status, 'integration_disabled')
  assert.match(support.body.result.checksum, /^[0-9a-f]{64}$/)
  const supportReportId = support.body.result.support_report_id

  const supportReplay = await postCommand(h, auth, supportEnvelope)
  assert.equal(supportReplay.body.ok, true)
  assert.equal(supportReplay.body.replayed, true)
  assert.equal(supportReplay.body.result.support_report_id, supportReportId)
  const outbox = await h.migrator.query(
    'SELECT count(*)::integer AS count FROM bar_local.outbox WHERE operation_id = $1',
    [supportEnvelope.operation_id]
  )
  assert.equal(outbox.rows[0].count, 1)
  const storedSupport = await h.migrator.query(
    'SELECT diagnostics, metadata FROM bar_local.support_reports WHERE id = $1',
    [supportReportId]
  )
  assert.equal(storedSupport.rows[0].diagnostics.password, '[redacted]')
  assert.equal(storedSupport.rows[0].diagnostics.api_key, '[redacted]')
  assert.equal(storedSupport.rows[0].diagnostics.nested.authorization, '[redacted]')
  assert.equal(storedSupport.rows[0].diagnostics.nested.safe, 'visible')

  // Model a multi-event transaction group. A one-group export page must keep
  // every event at this commit_sequence together rather than splitting rows.
  await h.migrator.query(
    `INSERT INTO bar_local.outbox (
       commit_sequence, event_index, business_id, outlet_id, event_type,
       operation_id, authority_epoch, payload, payload_hash
     )
     SELECT source.commit_sequence,
            (SELECT COALESCE(max(event_index), -1) + 1 FROM bar_local.outbox WHERE commit_sequence = source.commit_sequence),
            source.business_id, source.outlet_id, 'support.report.indexed', source.operation_id,
            source.authority_epoch, $2::jsonb,
            bar_local.sha256_hex(bar_local.canonical_jsonb_text($2::jsonb))
       FROM bar_local.outbox source
      WHERE source.operation_id = $1
      ORDER BY source.event_index
      LIMIT 1`,
    [supportEnvelope.operation_id, JSON.stringify({ report_id: supportReportId, fixture: true })]
  )

  const exportEnvelope = envelope('export.bundle.create', { limit: 1 })
  const exported = await postCommand(h, auth, exportEnvelope)
  assertCommitted(exported, exportEnvelope, 'export.bundle.create')
  assert.equal(exported.body.result.status, 'integration_disabled')
  assert.equal(exported.body.result.signature_status, 'unavailable')
  assert.equal(exported.body.result.transport_status, 'integration_disabled')
  assert.equal(exported.body.result.event_count, 2)
  assert.match(exported.body.result.batch_id, /^[0-9a-f-]{36}$/)
  assert.match(exported.body.result.manifest_hash, /^[0-9a-f]{64}$/)
  const batchId = exported.body.result.batch_id

  const exportBundle = await h.request('/v1/queries/outbox.bundle.get', {
    ...auth,
    body: {
      contract_version: 1,
      authority_id: scope.authority_id,
      authority_epoch: scope.authority_epoch,
      filters: { batch_id: batchId }
    }
  })
  assert.equal(exportBundle.status, 200, JSON.stringify(exportBundle.body))
  assert.equal(exportBundle.body.ok, true)
  assert.equal(exportBundle.body.query, 'outbox.bundle.get')
  assert.equal(exportBundle.body.complete, true)
  assert.equal(exportBundle.body.data.batch_id, batchId)
  assert.equal(exportBundle.body.data.manifest_hash, exported.body.result.manifest_hash)
  assert.equal(exportBundle.body.data.events.length, exported.body.result.event_count)
  assert.equal(exportBundle.body.data.signature_status, 'unavailable')
  assert.equal(exportBundle.body.data.transport_status, 'integration_disabled')

  const outboxStatus = await h.request('/v1/queries/outbox.status', {
    ...auth,
    body: {
      contract_version: 1,
      authority_id: scope.authority_id,
      authority_epoch: scope.authority_epoch,
      filters: {}
    }
  })
  assert.equal(outboxStatus.status, 200, JSON.stringify(outboxStatus.body))
  assert.equal(outboxStatus.body.scope.business_id, scope.business_id)
  assert.equal(outboxStatus.body.scope.outlet_id, scope.outlet_id)
  assert.equal(outboxStatus.body.data.cloud_transport, 'disabled')
  assert.equal(outboxStatus.body.data.exported_unacknowledged >= exported.body.result.event_count, true)
  assert.equal(outboxStatus.body.data.exported_watermark >= exported.body.result.checkpoint, true)
  assert.equal(outboxStatus.body.data.acknowledged_watermark, 0)
  const statusBatch = outboxStatus.body.data.batches.find((batch) => batch.batch_id === batchId)
  assert.equal(statusBatch.integrity_valid, true)
  assert.equal(statusBatch.item_count, exported.body.result.event_count)
  assert.equal(statusBatch.linked_event_count, exported.body.result.event_count)

  const tamperedManifest = structuredClone(exportBundle.body.data)
  tamperedManifest.events[0].payload_hash = '0'.repeat(64)
  await h.migrator.query(
    `UPDATE bar_local.export_batches
        SET manifest = $2::jsonb,
            manifest_hash = bar_local.sha256_hex(bar_local.canonical_jsonb_text($2::jsonb))
      WHERE batch_id = $1`,
    [batchId, JSON.stringify(tamperedManifest)]
  )
  const tamperedBundle = await h.request('/v1/queries/outbox.bundle.get', {
    ...auth,
    body: {
      contract_version: 1,
      authority_id: scope.authority_id,
      authority_epoch: scope.authority_epoch,
      filters: { batch_id: batchId }
    }
  })
  assert.equal(tamperedBundle.status, 200, JSON.stringify(tamperedBundle.body))
  assert.equal(tamperedBundle.body.complete, false)
  assert.deepEqual(tamperedBundle.body.unavailable, ['export_bundle_integrity_failed'])
  const tamperedStatus = await h.request('/v1/queries/outbox.status', {
    ...auth,
    body: {
      contract_version: 1,
      authority_id: scope.authority_id,
      authority_epoch: scope.authority_epoch,
      filters: {}
    }
  })
  assert.equal(tamperedStatus.status, 200, JSON.stringify(tamperedStatus.body))
  const tamperedStatusBatch = tamperedStatus.body.data.batches.find((batch) => batch.batch_id === batchId)
  assert.equal(tamperedStatusBatch.integrity_valid, false)

  const missingBundle = await h.request('/v1/queries/outbox.bundle.get', {
    ...auth,
    body: {
      contract_version: 1,
      authority_id: scope.authority_id,
      authority_epoch: scope.authority_epoch,
      filters: { batch_id: randomUUID() }
    }
  })
  assert.equal(missingBundle.status, 200, JSON.stringify(missingBundle.body))
  assert.equal(missingBundle.body.complete, false)
  assert.deepEqual(missingBundle.body.unavailable, ['export_bundle_not_found'])
  const unacknowledged = await h.migrator.query('SELECT acknowledged_at FROM bar_local.export_batches WHERE batch_id = $1', [batchId])
  assert.equal(unacknowledged.rows[0].acknowledged_at, null)

  const exportReplay = await postCommand(h, auth, exportEnvelope)
  assert.equal(exportReplay.body.ok, true)
  assert.equal(exportReplay.body.replayed, true)
  assert.equal(exportReplay.body.result.batch_id, batchId)

  const setupProduct = await h.migrator.query(
    `INSERT INTO bar_local.products (business_id, sku, name, price, tax_rate, active)
     VALUES ($1, 'SHIFT-FIXTURE', 'Shift setup fixture', 1, 0, true) RETURNING id`, [scope.business_id]
  )
  const shiftId = await openShift(data)
  await h.migrator.query('DELETE FROM bar_local.products WHERE id = $1', [setupProduct.rows[0].id])
  const queryBody = {
    contract_version: 1,
    authority_id: scope.authority_id,
    authority_epoch: scope.authority_epoch,
    filters: {}
  }

  const stock = await h.request('/v1/queries/reports.stock', { ...auth, body: queryBody })
  assert.equal(stock.status, 200, JSON.stringify(stock.body))
  assert.equal(stock.body.ok, true)
  assert.equal(stock.body.query, 'reports.stock')
  assert.deepEqual(Object.keys(stock.body.data).sort(), [
    'balances', 'low_stock', 'low_stock_threshold', 'movements', 'period', 'valuation', 'valuation_totals'
  ])
  assert.equal(stock.body.pagination.next_cursor, null)
  assert.equal(stock.body.pagination.has_more, false)
  assert.equal(stock.body.scope.business_id, scope.business_id)
  assert.equal(stock.body.scope.outlet_id, scope.outlet_id)
  assert.equal(stock.body.scope.actor_staff_id, data.ownerStaffId)
  assert.equal(stock.body.scope.role, 'owner')
  assert.equal(stock.body.scope.device_id, scope.device_id)
  assert.equal(typeof stock.body.snapshot_watermark, 'number')
  assert.equal(typeof stock.body.as_of, 'string')
  assert.equal(typeof stock.body.complete, 'boolean')
  assert.equal(Array.isArray(stock.body.unavailable), true)

  const cashup = await h.request('/v1/queries/reports.cashup', { ...auth, body: queryBody })
  assert.equal(cashup.status, 200, JSON.stringify(cashup.body))
  assert.equal(cashup.body.ok, true)
  assert.equal(cashup.body.query, 'reports.cashup')
  assert.equal(cashup.body.pagination.next_cursor, null)
  assert.equal(cashup.body.pagination.has_more, false)
  assert.equal(cashup.body.scope.actor_staff_id, data.ownerStaffId)
  assert.equal(cashup.body.scope.role, 'owner')
  assert.equal(cashup.body.data.shifts.length, 1)
  assert.equal(cashup.body.data.shifts[0].shift_id, shiftId)
  assert.equal(cashup.body.complete, false)
  assert.equal(cashup.body.unavailable.includes('card_provider_settlement_unverified'), true)

  const unknownEnvelope = envelope('unknown.command', {})
  const unknown = await postCommand(h, auth, unknownEnvelope)
  assertHttpRefusal(unknown, 400, 'COMMAND_NOT_REGISTERED')

  const unknownQuery = await h.request('/v1/queries/reports.not_a_real_report', { ...auth, body: queryBody })
  assertHttpRefusal(unknownQuery, 400, 'QUERY_NOT_REGISTERED')
})
