import assert from 'node:assert/strict'
import {
  patchQueuedInventoryDraftPayload,
  removeQueuedInventoryDraft
} from '../src/main/domains/inventoryDrafts.js'
import {
  getDayUseActivityLabel,
  getDayUseAccessSummary,
  normalizeDayUseReportRow,
  summarizeDayUseExtras
} from '../src/shared/dayUseReporting.js'
import {
  computeDayUseBaseTotal,
  computeDayUseEndTime,
  findDayUseResourceConflict,
  normalizeDayUseExtraPreset,
  normalizeDayUsePricingMode,
  normalizeDayUseStatus,
  normalizeDayUseTemplate
} from '../src/shared/dayUseConfig.js'
import { patchQueuedDayUseEntryPayload } from '../src/main/domains/dayUseDrafts.js'

function buildQueuedInventoryCreate(id, overrides = {}) {
  return {
    _queue_id: `inventory-item-${id}`,
    type: 'rpc',
    table: 'create_inventory_item',
    timestamp: '2026-05-21T10:00:00.000Z',
    data: {
      payload: {
        id,
        lodge_id: 'lodge-1',
        name: 'Firewood',
        category: 'Braai',
        unit: 'bundle',
        current_stock: 20,
        reorder_level: 3,
        selling_price: 75,
        outlet_id: null
      }
    },
    ...overrides
  }
}

function testQueuedDraftPatch() {
  const draftId = 'draft-1'
  const queue = [
    buildQueuedInventoryCreate(draftId),
    buildQueuedInventoryCreate('other-draft', { _queue_id: 'inventory-item-other-draft' })
  ]

  const result = patchQueuedInventoryDraftPayload(queue, draftId, {
    name: 'Premium Firewood',
    selling_price: 90
  })

  assert.equal(result.updated, true)
  assert.equal(result.queue[0].data.payload.name, 'Premium Firewood')
  assert.equal(result.queue[0].data.payload.selling_price, 90)
  assert.equal(result.queue[0].data.payload.category, 'Braai')
  assert.equal(result.queue[0]._queue_id, `inventory-item-${draftId}`)
  assert.equal(result.queue[1].data.payload.name, 'Firewood')
}

function testQueuedDraftPatchMiss() {
  const queue = [buildQueuedInventoryCreate('draft-2')]
  const result = patchQueuedInventoryDraftPayload(queue, 'missing-draft', { name: 'Charcoal' })
  assert.equal(result.updated, false)
  assert.deepEqual(result.queue, queue)
}

function testQueuedDraftRemoval() {
  const queue = [
    buildQueuedInventoryCreate('draft-a'),
    buildQueuedInventoryCreate('draft-b')
  ]
  const result = removeQueuedInventoryDraft(queue, 'draft-a')
  assert.equal(result.removed, true)
  assert.equal(result.queue.length, 1)
  assert.equal(result.queue[0]._queue_id, 'inventory-item-draft-b')
}

function testQueuedDraftRemovalMiss() {
  const queue = [buildQueuedInventoryCreate('draft-c')]
  const result = removeQueuedInventoryDraft(queue, 'draft-z')
  assert.equal(result.removed, false)
  assert.deepEqual(result.queue, queue)
}

function testDayUseReportNormalization() {
  const row = normalizeDayUseReportRow({
    date: '2026-05-21',
    guest_name: 'Kagiso',
    activity_type: 'braai',
    includes_pool: false,
    includes_facility_access: true,
    includes_braai: true,
    adults: 2,
    children: 1,
    extras_total: 155,
    total: 355,
    payment_method: 'cash',
    notes: 'Late checkout crowd',
    extras: [
      { name: 'Firewood', quantity: 2 },
      { name: 'Meat pack', quantity: 1 }
    ]
  })

  assert.equal(row.guest, 'Kagiso')
  assert.equal(row.activityLabel, 'Braai / barbecue')
  assert.equal(row.accessSummary, 'Facility, Braai')
  assert.equal(row.extrasSummary, 'Firewood x2, Meat pack x1')
  assert.equal(row.extrasTotal, 155)
  assert.equal(row.total, 355)
}

function testDayUseReportFallbacks() {
  assert.equal(getDayUseActivityLabel({ activity_type: 'facility' }), 'Facility chill')
  assert.equal(getDayUseAccessSummary({ includes_pool: true, includes_facility_access: true }), 'Pool, Facility')
  assert.equal(summarizeDayUseExtras([{ name: 'Firewood', quantity: 0 }, { name: 'Meat', quantity: 3 }]), 'Meat x3')

  const fallbackRow = normalizeDayUseReportRow({
    created_at: '2026-05-20T12:00:00.000Z',
    customer_name: 'Walk-in Guest',
    amount: 120
  })
  assert.equal(fallbackRow.date, '2026-05-20')
  assert.equal(fallbackRow.guest, 'Walk-in Guest')
  assert.equal(fallbackRow.activityLabel, 'Pool access')
  assert.equal(fallbackRow.total, 120)
}

function testDayUsePricingHelpers() {
  assert.equal(normalizeDayUsePricingMode('hourly'), 'hourly')
  assert.equal(normalizeDayUseStatus('completed'), 'completed')
  assert.equal(computeDayUseBaseTotal({ pricing_mode: 'per_person', adults: 2, children: 1, fee_per_adult: 100, fee_per_child: 50 }), 250)
  assert.equal(computeDayUseBaseTotal({ pricing_mode: 'flat', flat_fee: 300 }), 300)
  assert.equal(computeDayUseBaseTotal({ pricing_mode: 'hourly', hourly_rate: 120, duration_hours: 2.5 }), 300)
  assert.equal(computeDayUseBaseTotal({ pricing_mode: 'package', package_fee: 650 }), 650)
  assert.equal(computeDayUseEndTime('10:30', 2.5), '13:00')
}

function testDayUseTemplateBundlesAndConflictHelpers() {
  const template = normalizeDayUseTemplate({
    name: 'Braai for 6',
    bundled_extras: [
      { inventory_item_id: 'item-1', name: 'Firewood', quantity: 2, unit_price: 75 },
      { name: 'Setup', quantity: 1, unit_price: 0 }
    ]
  })
  assert.equal(template.bundled_extras.length, 2)
  assert.equal(template.bundled_extras[0].inventory_item_id, 'item-1')
  assert.equal(normalizeDayUseExtraPreset({ name: 'Charcoal', quantity: 3 }).quantity, 3)

  const conflict = findDayUseResourceConflict([
    {
      id: 'existing-1',
      date: '2026-05-21',
      resource_key: 'gazebo-1',
      resource_name: 'Gazebo 1',
      start_time: '10:00',
      duration_hours: 3,
      status: 'reserved'
    }
  ], {
    date: '2026-05-21',
    resource_key: 'gazebo-1',
    start_time: '11:00',
    duration_hours: 2
  })

  assert.equal(conflict?.id, 'existing-1')
  assert.equal(findDayUseResourceConflict([{ date: '2026-05-21', resource_key: 'gazebo-2', start_time: '10:00', duration_hours: 2, status: 'cancelled' }], {
    date: '2026-05-21',
    resource_key: 'gazebo-2',
    start_time: '10:00',
    duration_hours: 2
  }), null)
}

function testQueuedDayUseDraftPatch() {
  const queue = [{
    _queue_id: 'dayuse-entry-1',
    type: 'rpc',
    table: 'add_pool_day_use',
    data: {
      payload: {
        id: 'entry-1',
        guest_name: 'Kagiso',
        status: 'checked_in'
      }
    }
  }]

  const result = patchQueuedDayUseEntryPayload(queue, 'entry-1', {
    status: 'completed',
    service_notes: 'Closed by front desk'
  })

  assert.equal(result.updated, true)
  assert.equal(result.queue[0].data.payload.status, 'completed')
  assert.equal(result.queue[0].data.payload.service_notes, 'Closed by front desk')
  assert.equal(result.queue[0].data.payload.guest_name, 'Kagiso')
}

function testDayUseReportRichFields() {
  const row = normalizeDayUseReportRow({
    date: '2026-05-21',
    guest_name: 'Neo',
    template_name: 'Braai Package',
    status: 'active',
    start_time: '10:00',
    end_time: '14:00',
    duration_hours: 4,
    pricing_mode: 'package',
    package_name: 'Family Braai',
    resource_name: 'Gazebo 1',
    deposit_amount: 100,
    balance_due: 250,
    service_notes: 'Set up chairs',
    total: 350
  })

  assert.equal(row.templateName, 'Braai Package')
  assert.equal(row.statusLabel, 'Active')
  assert.equal(row.startTime, '10:00')
  assert.equal(row.endTime, '14:00')
  assert.equal(row.durationHours, 4)
  assert.equal(row.pricingMode, 'package')
  assert.equal(row.packageName, 'Family Braai')
  assert.equal(row.resourceName, 'Gazebo 1')
  assert.equal(row.depositAmount, 100)
  assert.equal(row.balanceDue, 250)
  assert.equal(row.serviceNotes, 'Set up chairs')
}

function run() {
  testQueuedDraftPatch()
  testQueuedDraftPatchMiss()
  testQueuedDraftRemoval()
  testQueuedDraftRemovalMiss()
  testQueuedDayUseDraftPatch()
  testDayUseReportNormalization()
  testDayUseReportFallbacks()
  testDayUsePricingHelpers()
  testDayUseTemplateBundlesAndConflictHelpers()
  testDayUseReportRichFields()
  console.log('\x1b[32m%s\x1b[0m', '✓ Inventory draft sync and day-use reporting checks passed!')
}

run()
