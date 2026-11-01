import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, sha256Json } from './harness.mjs'

const MANAGER_CAPABILITIES = ['pos.view', 'pos.manage', 'pos.discount', 'staff.manage']

async function product(h, sku, price) {
  const result = await h.call('cmd_catalogue_upsert', h.envelope('catalogue.upsert', {
    sku, name: sku, category: 'Test', price, tax_rate: '0', track_stock: false
  }))
  assert.equal(result.ok, true, JSON.stringify(result.error))
  return result.result.product_id
}

function salePayload(shiftId, productId, { discount = '0.00', promotion = null, tender = '100.00' } = {}) {
  const payload = {
    shift_id: shiftId,
    items: [{ product_id: productId, quantity: '1' }],
    discount_amount: discount,
    tip_amount: '0',
    tenders: [{ method: 'cash', amount: tender, tendered: tender }]
  }
  if (promotion) payload.promotion_code = promotion
  return payload
}

async function approvedCall(h, fn, command, payload, capability, options = {}) {
  const approvalHash = sha256Json(payload)
  const approvalId = await h.approve(capability, approvalHash, options)
  const approvedPayload = { ...payload, approval_id: approvalId }
  const envelope = h.envelope(command, approvedPayload)
  const callOptions = { hash: sha256Json(approvedPayload), approvalHash }
  return { result: await h.call(fn, envelope, callOptions), envelope, callOptions }
}

test('discount above the approval threshold needs a second operator and then commits', async (t) => {
  const h = await createHarness(t, { managerCapabilities: MANAGER_CAPABILITIES })
  const shiftId = await h.openShift()
  const itemId = await product(h, 'DISCOUNT-THRESHOLD', '100.00')
  const payload = salePayload(shiftId, itemId, { discount: '20.00', tender: '80.00' })

  const refused = await h.call('cmd_sale_commit', h.envelope('sale.commit', payload))
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'APPROVAL_REQUIRED')

  const { result: approved, envelope, callOptions } = await approvedCall(
    h, 'cmd_sale_commit', 'sale.commit', payload, 'pos.discount'
  )
  assert.equal(approved.ok, true, JSON.stringify(approved.error))
  assert.equal(Number(approved.result.receipt.total), 80)
  assert.equal(Number(approved.result.receipt.discount), 20)

  const replay = await h.call('cmd_sale_commit', envelope, callOptions)
  assert.equal(replay.ok, true, JSON.stringify(replay.error))
  assert.equal(replay.replayed, true)
})

test('discount above the configured maximum is refused even with an approval', async (t) => {
  const h = await createHarness(t, { managerCapabilities: MANAGER_CAPABILITIES })
  const shiftId = await h.openShift()
  const itemId = await product(h, 'DISCOUNT-MAXIMUM', '100.00')
  const payload = salePayload(shiftId, itemId, { discount: '30.00', tender: '70.00' })
  const { result } = await approvedCall(h, 'cmd_sale_commit', 'sale.commit', payload, 'pos.discount')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'VALIDATION_FAILED')
})

test('promotion discounts follow the same approval policy', async (t) => {
  const h = await createHarness(t, { managerCapabilities: MANAGER_CAPABILITIES })
  const shiftId = await h.openShift()
  const itemId = await product(h, 'PROMOTION-THRESHOLD', '100.00')
  const promotion = await h.call('cmd_promotion_upsert', h.envelope('promotion.upsert', {
    name: 'Twenty Percent', code: 'TWENTY20', scope: 'all',
    discount_type: 'percent', percent: '20', minimum_subtotal: '0', active: true
  }))
  assert.equal(promotion.ok, true, JSON.stringify(promotion.error))
  const payload = salePayload(shiftId, itemId, { promotion: 'TWENTY20', tender: '80.00' })

  const refused = await h.call('cmd_sale_commit', h.envelope('sale.commit', payload))
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'APPROVAL_REQUIRED')

  const { result: approved } = await approvedCall(
    h, 'cmd_sale_commit', 'sale.commit', payload, 'pos.discount'
  )
  assert.equal(approved.ok, true, JSON.stringify(approved.error))
  assert.equal(Number(approved.result.receipt.total), 80)
})

test('discount maximum setting is enforced by the authoritative policy', async (t) => {
  const h = await createHarness(t, { managerCapabilities: MANAGER_CAPABILITIES })
  const shiftId = await h.openShift()
  const itemId = await product(h, 'DISCOUNT-CONFIGURED-MAX', '100.00')
  const setting = await h.call('cmd_settings_update', h.envelope('settings.update', {
    key: 'discount_max_percent', value: '15.0000'
  }))
  assert.equal(setting.ok, true, JSON.stringify(setting.error))

  const payload = salePayload(shiftId, itemId, { discount: '20.00', tender: '80.00' })
  const { result } = await approvedCall(h, 'cmd_sale_commit', 'sale.commit', payload, 'pos.discount')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'VALIDATION_FAILED')
})

test('staff status changes cannot escalate or bypass maker-checker', async (t) => {
  const h = await createHarness(t, { managerCapabilities: MANAGER_CAPABILITIES })
  const cashierId = await h.insertStaff('Status Cashier', 'cashier', ['pos.view'])

  const managerTargetsOwner = await h.callWith(h.runtime, 'cmd_staff_status', h.envelope('staff.status', {
    staff_id: h.ownerStaffId, status: 'suspended', reason: 'Escalation attempt'
  }), { tokenHash: h.managerTokenHash })
  assert.equal(managerTargetsOwner.ok, false)
  assert.equal(managerTargetsOwner.error.code, 'CAPABILITY_DENIED')

  const managerTargetsManager = await h.callWith(h.runtime, 'cmd_staff_status', h.envelope('staff.status', {
    staff_id: h.managerStaffId, status: 'suspended', reason: 'Peer attempt'
  }), { tokenHash: h.managerTokenHash })
  assert.equal(managerTargetsManager.ok, false)
  assert.equal(managerTargetsManager.error.code, 'CAPABILITY_DENIED')

  const ownerSelf = await h.callWith(h.runtime, 'cmd_staff_status', h.envelope('staff.status', {
    staff_id: h.ownerStaffId, status: 'suspended', reason: 'Self attempt'
  }), { tokenHash: h.ownerTokenHash })
  assert.equal(ownerSelf.ok, false)
  assert.equal(ownerSelf.error.code, 'MAKER_CHECKER_VIOLATION')

  const payload = { staff_id: cashierId, status: 'suspended', reason: 'Approved suspension' }
  const approvalHash = sha256Json(payload)
  const approvalId = await h.approve('staff.manage', approvalHash, { approverStaffId: h.ownerStaffId })
  const approvedPayload = { ...payload, approval_id: approvalId }
  const allowed = await h.callWith(h.runtime, 'cmd_staff_status', h.envelope('staff.status', approvedPayload), {
    tokenHash: h.managerTokenHash,
    hash: sha256Json(approvedPayload),
    approvalHash
  })
  assert.equal(allowed.ok, true, JSON.stringify(allowed.error))
  const status = await h.migrator.query('SELECT status FROM bar_local.staff WHERE id = $1', [cashierId])
  assert.equal(status.rows[0].status, 'suspended')
})
