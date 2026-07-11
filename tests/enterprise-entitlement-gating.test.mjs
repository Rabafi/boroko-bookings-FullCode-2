import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCapabilitySnapshot
} from '../src/shared/accessControl.js'
import {
  computeEffectiveFeatures
} from '../src/shared/entitlementMerge.js'

const {
  resolveModuleVisibility,
  MODULE_VISIBILITY_STATES,
  MODULE_CATALOG
} = await import('../src/shared/moduleCatalog.js')

test('Enterprise lodge with only guest_portal add-on does NOT see Guest Messaging', () => {
  const result = resolveModuleVisibility('guest_messaging', 'hotel', 'Enterprise', ['guest_portal'])
  assert.equal(result, MODULE_VISIBILITY_STATES.hidden,
    'guest_messaging should be hidden without guest_messaging addon')
})

test('Enterprise lodge with only guest_portal add-on does NOT see Guest CRM', () => {
  const result = resolveModuleVisibility('guest_crm', 'hotel', 'Enterprise', ['guest_portal'])
  assert.equal(result, MODULE_VISIBILITY_STATES.hidden,
    'guest_crm should be hidden without guest_crm addon')
})

test('Enterprise lodge with guest_portal + guest_messaging sees Guest Messaging as visible', () => {
  const result = resolveModuleVisibility('guest_messaging', 'hotel', 'Enterprise', ['guest_portal', 'guest_messaging'])
  assert.equal(result, MODULE_VISIBILITY_STATES.visible,
    'guest_messaging should be visible when guest_messaging addon is enabled')
})

test('Enterprise lodge with guest_portal + guest_crm sees Guest CRM as visible', () => {
  const result = resolveModuleVisibility('guest_crm', 'hotel', 'Enterprise', ['guest_portal', 'guest_crm'])
  assert.equal(result, MODULE_VISIBILITY_STATES.visible,
    'guest_crm should be visible when guest_crm addon is enabled')
})

test('Enterprise lodge with only rate_plans does NOT see advanced_rates unless explicitly enabled', () => {
  const withoutAdvRates = resolveModuleVisibility('advanced_rates', 'hotel', 'Enterprise', ['rate_plans'])
  assert.equal(withoutAdvRates, MODULE_VISIBILITY_STATES.hidden,
    'advanced_rates should be hidden when only rate_plans addon is enabled')

  const withAdvRates = resolveModuleVisibility('advanced_rates', 'hotel', 'Enterprise', ['advanced_rates'])
  assert.equal(withAdvRates, MODULE_VISIBILITY_STATES.visible,
    'advanced_rates should be visible when advanced_rates addon is enabled')
})

test('Enterprise add-on features remain locked until their add-on is enabled', () => {
  const base = computeEffectiveFeatures('Enterprise', [])
  assert.equal(base.advanced_reports, false)
  assert.equal(base.documents, false)
  assert.equal(base.hotel_roles, false)
  assert.equal(base.room_attributes, false)
  assert.equal(base.advanced_booking_engine, false)

  const enabled = computeEffectiveFeatures('Enterprise', [
    'advanced_reports',
    'documents',
    'hotel_roles',
    'room_attributes',
    'advanced_booking_engine'
  ])
  assert.equal(enabled.advanced_reports, true)
  assert.equal(enabled.documents, true)
  assert.equal(enabled.hotel_roles, true)
  assert.equal(enabled.room_attributes, true)
  assert.equal(enabled.advanced_booking_engine, true)
})

test('Enterprise feature-disabled capabilities are blocked even for admin role defaults', () => {
  const features = {
    maintenance_enterprise: false,
    group_operations: false,
    night_audit_enterprise: false,
    checkin_workflow: false,
    early_late_checkout: false,
    cancellation_policies: false
  }
  const snapshot = buildCapabilitySnapshot({ role: 'admin', features })
  assert.equal(snapshot.capabilities['maintenance.preventive'], false)
  assert.equal(snapshot.capabilities['maintenance.ooo'], false)
  assert.equal(snapshot.capabilities['group_operations.manage'], false)
  assert.equal(snapshot.capabilities['night_audit.close'], false)
  assert.equal(snapshot.capabilities['checkin.manage'], false)
  assert.equal(snapshot.capabilities['late_checkout.manage'], false)
  assert.equal(snapshot.capabilities['cancellation.manage'], false)
})
