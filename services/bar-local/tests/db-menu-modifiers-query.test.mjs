import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createHarness } from './harness.mjs'

async function callOk(h, fn, command, payload) {
  const result = await h.call(fn, h.envelope(command, payload))
  assert.equal(result.ok, true, `${command}: ${JSON.stringify(result.error)}`)
  return result.result
}

async function createProduct(h, sku, name, price = '10.00') {
  return callOk(h, 'cmd_catalogue_upsert', 'catalogue.upsert', {
    sku,
    name,
    category: 'Food',
    price,
    tax_rate: '0',
    track_stock: false
  })
}

async function createGroup(h, code, { required = false, min = 0, max = 1, active = true } = {}) {
  return callOk(h, 'cmd_catalogue_modifier_group_upsert', 'catalogue.modifier_group.upsert', {
    code,
    name: code,
    required,
    min_selections: min,
    max_selections: max,
    active
  })
}

async function createOption(h, groupId, code, priceDelta, { sortOrder = 0, active = true } = {}) {
  return callOk(h, 'cmd_catalogue_modifier_option_upsert', 'catalogue.modifier_option.upsert', {
    modifier_group_id: groupId,
    code,
    name: code,
    price_delta: priceDelta,
    sort_order: sortOrder,
    active
  })
}

async function linkGroups(h, productId, groups) {
  return callOk(h, 'cmd_catalogue_product_modifier_set', 'catalogue.product_modifier.set', {
    product_id: productId,
    groups
  })
}

function assertEnvelope(page) {
  assert.equal(typeof page, 'object')
  assert.notEqual(page, null)
  assert.equal(Array.isArray(page.data), true)
  assert.equal(typeof page.pagination, 'object')
  assert.equal(typeof page.pagination.has_more, 'boolean')
  assert.ok('next_cursor' in page.pagination)
  assert.equal(typeof page.snapshot_watermark, 'number')
  assert.equal(typeof page.as_of, 'string')
  assert.equal(page.complete, true)
  assert.deepEqual(page.unavailable, [])
  assert.equal(typeof page.scope, 'object')
}

test('menu.availability emits active linked modifiers without changing pagination or scope', async (t) => {
  const h = await createHarness(t)

  const plainOne = await createProduct(h, 'MOD-1', 'Plain one')
  const plainTwo = await createProduct(h, 'MOD-2', 'Plain two')
  const plainThree = await createProduct(h, 'MOD-3', 'Plain three')
  const target = await createProduct(h, 'MOD-4', 'Modifier burger', '20.00')
  await createProduct(h, 'MOD-5', 'Plain five')

  const size = await createGroup(h, 'SIZE', { required: true, min: 1, max: 2 })
  const extras = await createGroup(h, 'EXTRAS', { required: false, min: 0, max: 1 })
  const hidden = await createGroup(h, 'HIDDEN', { required: false, min: 0, max: 1, active: false })
  const unlinked = await createGroup(h, 'UNLINKED', { required: false, min: 0, max: 1 })

  await createOption(h, size.modifier_group_id, 'LARGE', '3.00', { sortOrder: 2 })
  await createOption(h, size.modifier_group_id, 'SMALL', '0.00', { sortOrder: 1 })
  await createOption(h, size.modifier_group_id, 'UNAVAILABLE', '1.00', { sortOrder: 3, active: false })
  await createOption(h, extras.modifier_group_id, 'CHEESE', '1.50')
  await createOption(h, hidden.modifier_group_id, 'HIDDEN-OPTION', '0.00')
  await createOption(h, unlinked.modifier_group_id, 'SECRET', '9.99')

  await linkGroups(h, target.product_id, [
    { modifier_group_id: extras.modifier_group_id, sort_order: 20 },
    { modifier_group_id: hidden.modifier_group_id, sort_order: 30 },
    { modifier_group_id: size.modifier_group_id, sort_order: 10 }
  ])

  const pages = []
  let cursor = null
  for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
    const filters = { limit: 2 }
    if (cursor !== null) filters.cursor = cursor
    const page = await h.query('menu.availability', filters)
    assertEnvelope(page)
    assert.equal(page.scope.business_id, h.businessId)
    assert.equal(page.scope.outlet_id, h.outletId)
    assert.equal(page.scope.actor_staff_id, h.ownerStaffId)
    pages.push(page)
    if (!page.pagination.has_more) break
    cursor = page.pagination.next_cursor
    assert.equal(typeof cursor, 'string')
  }

  assert.equal(pages.length, 3)
  assert.deepEqual(pages.map((page) => page.pagination.has_more), [true, true, false])
  assert.deepEqual(pages.map((page) => page.pagination.next_cursor), ['MOD-2', 'MOD-4', null])
  assert.equal(new Set(pages.map((page) => page.snapshot_watermark)).size, 1)

  const combined = pages.flatMap((page) => page.data)
  assert.deepEqual(combined.map((row) => row.sku), ['MOD-1', 'MOD-2', 'MOD-3', 'MOD-4', 'MOD-5'])
  assert.equal(new Set(combined.map((row) => row.product_id)).size, 5)

  const pageWithTarget = pages.find((page) => page.data.some((row) => row.product_id === target.product_id))
  assert.notEqual(pageWithTarget, undefined)
  const pagedTarget = pageWithTarget.data.find((row) => row.product_id === target.product_id)
  assert.equal(Array.isArray(pagedTarget.modifier_groups), true)
  assert.equal(pagedTarget.modifier_groups.length, 2)

  const full = await h.query('menu.availability', {})
  assertEnvelope(full)
  const row = full.data.find((entry) => entry.product_id === target.product_id)
  assert.notEqual(row, undefined)
  assert.equal(Array.isArray(row.modifier_groups), true)
  assert.deepEqual(
    row.modifier_groups.map((group) => group.modifier_group_id),
    [size.modifier_group_id, extras.modifier_group_id]
  )
  assert.deepEqual(row.modifier_groups.map((group) => group.sort_order), [10, 20])

  const sizeGroup = row.modifier_groups[0]
  assert.equal(sizeGroup.code, 'SIZE')
  assert.equal(sizeGroup.name, 'SIZE')
  assert.equal(sizeGroup.required, true)
  assert.equal(sizeGroup.min_selections, 1)
  assert.equal(sizeGroup.max_selections, 2)
  assert.equal(sizeGroup.active, true)
  assert.equal(sizeGroup.version, 1)
  assert.equal(Array.isArray(sizeGroup.options), true)
  assert.deepEqual(sizeGroup.options.map((option) => option.code), ['SMALL', 'LARGE'])
  assert.equal(sizeGroup.options.some((option) => option.code === 'UNAVAILABLE'), false)
  assert.equal(sizeGroup.options.some((option) => option.code === 'SECRET'), false)
  assert.equal(sizeGroup.options[0].modifier_group_id, size.modifier_group_id)
  assert.equal(sizeGroup.options[0].group_id, size.modifier_group_id)
  assert.equal(sizeGroup.options[0].active, true)
  assert.equal(sizeGroup.options[0].sort_order, 1)
  assert.equal(sizeGroup.options[0].version, 1)
  assert.equal(Number(sizeGroup.options[0].price_delta), 0)
  assert.equal(Number(sizeGroup.options[1].price_delta), 3)

  const extrasGroup = row.modifier_groups[1]
  assert.equal(extrasGroup.code, 'EXTRAS')
  assert.equal(extrasGroup.required, false)
  assert.equal(extrasGroup.min_selections, 0)
  assert.equal(extrasGroup.max_selections, 1)
  assert.deepEqual(extrasGroup.options.map((option) => option.code), ['CHEESE'])

  assert.equal(row.modifier_groups.some((group) => group.code === 'UNLINKED'), false)
  assert.equal(row.modifier_groups.some((group) => group.code === 'HIDDEN'), false)
  assert.equal(row.modifier_groups.some((group) => group.options.some((option) => option.code === 'HIDDEN-OPTION')), false)

  for (const plainProduct of [plainOne, plainTwo, plainThree]) {
    const plainRow = full.data.find((entry) => entry.product_id === plainProduct.product_id)
    assert.notEqual(plainRow, undefined)
    assert.equal(Object.prototype.hasOwnProperty.call(plainRow, 'modifier_groups'), false)
  }

  await assert.rejects(
    () => h.query('menu.availability', { outlet_id: randomUUID() }),
    (error) => error.code === 'BL001' && error.detail === 'OUTLET_SCOPE_MISMATCH'
  )
})
