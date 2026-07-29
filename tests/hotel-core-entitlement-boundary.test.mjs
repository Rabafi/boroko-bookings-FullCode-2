/**
 * Hotel Core entitlement boundary — clean Core licence must unlock a full hotel day
 * without purchasing optional add-ons.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { getCommercialOffer, COMMERCIAL_PRODUCT_IDS, getCommercialEntitlementKeys, getCommercialAddonOffers } from '../src/shared/commercialEntitlements.js'
import { computeEffectiveFeatures } from '../src/shared/entitlementMerge.js'
import { getPlanFeatureMap } from '../src/main/domains/subscriptionState.js'
import { resolveModuleVisibility, MODULE_VISIBILITY_STATES, getModuleByKey } from '../src/shared/moduleCatalog.js'
import { getAdvertisedEnterpriseAddons } from '../src/shared/commercialPackages.js'
import { getEnterpriseAddonByKey, ENTERPRISE_ADDON_STATUS } from '../src/shared/enterpriseAddons.js'
import { isHotelNavItemLocked } from '../src/renderer/src/components/hotel/hotelNav.js'

const HOTEL_DAY_CORE_FEATURES = [
  'bookings', 'rooms', 'guests', 'quotations', 'invoices', 'housekeeping', 'maintenance',
  'reports', 'expenses', 'staff', 'audit', 'pos', 'inventory', 'supplies',
  'hotel_mode', 'room_types', 'physical_inventory', 'floors_sections', 'room_attributes',
  'front_desk_dashboard', 'room_moves', 'checkin_workflow', 'early_late_checkout', 'cancellation_policies',
  'advanced_housekeeping', 'housekeeping_command_center', 'maintenance_enterprise',
  'folios', 'rate_plans', 'corporate_accounts', 'night_audit_enterprise', 'documents',
  'hotel_roles', 'hotel_kpis'
]

const PREMIUM_ONLY = [
  'channel_manager', 'guest_portal', 'guest_messaging', 'guest_crm',
  'advanced_rates', 'rate_calendar', 'promo_codes', 'advanced_reports',
  'multi_property', 'multi_outlet_pos', 'payment_gateway', 'group_operations',
  'advanced_booking_engine', 'operations_compliance'
]

test('Hotel Core commercial package includes full hotel-day features', () => {
  const offer = getCommercialOffer(COMMERCIAL_PRODUCT_IDS.HOTEL, 'hotel_core')
  assert.ok(offer)
  for (const key of HOTEL_DAY_CORE_FEATURES) {
    assert.ok(offer.includedFeatures.includes(key), `Hotel Core must include ${key}`)
  }
  for (const key of PREMIUM_ONLY) {
    assert.equal(offer.includedFeatures.includes(key), false, `Hotel Core must not include premium ${key}`)
  }
})

test('Enterprise plan map matches Hotel Core for operational necessities', () => {
  const map = getPlanFeatureMap('Enterprise')
  for (const key of [
    'rate_plans', 'corporate_accounts', 'documents', 'hotel_roles', 'room_attributes',
    'night_audit_enterprise', 'checkin_workflow', 'folios', 'room_moves'
  ]) {
    assert.equal(map[key], true, `Enterprise plan must grant ${key}`)
  }
  for (const key of PREMIUM_ONLY) {
    assert.equal(map[key], false, `Enterprise plan must not grant premium ${key} by default`)
  }
})

test('computeEffectiveFeatures without add-ons still unlocks Hotel Core day', () => {
  const features = computeEffectiveFeatures('Enterprise', [])
  for (const key of [
    'rate_plans', 'corporate_accounts', 'documents', 'hotel_roles', 'room_attributes',
    'night_audit_enterprise', 'checkin_workflow', 'folios'
  ]) {
    assert.equal(features[key], true, key)
  }
  assert.equal(features.channel_manager, false)
  assert.equal(features.guest_portal, false)
  assert.equal(features.advanced_rates, false)
})

test('module catalog marks former double-charge modules as non-addon Hotel Core', () => {
  for (const key of ['rate_plans', 'corporate_accounts', 'documents', 'hotel_roles', 'room_attributes']) {
    const mod = getModuleByKey(key)
    assert.ok(mod, key)
    assert.equal(mod.isAddon, false, `${key} must not be a paid add-on module`)
    assert.equal(mod.addonKey, null)
    assert.equal(
      resolveModuleVisibility(key, 'hotel', 'Enterprise', []),
      MODULE_VISIBILITY_STATES.visible,
      `${key} visible on clean Enterprise`
    )
  }
})

test('premium modules stay locked without add-on entitlement', () => {
  for (const key of ['channel_manager', 'guest_portal', 'advanced_rates', 'group_operations']) {
    assert.equal(
      resolveModuleVisibility(key, 'hotel', 'Enterprise', []),
      MODULE_VISIBILITY_STATES.hidden,
      `${key} hidden without add-on`
    )
  }
  assert.equal(
    resolveModuleVisibility('guest_portal', 'hotel', 'Enterprise', ['guest_portal']),
    MODULE_VISIBILITY_STATES.visible
  )
})

test('advertised hotel add-ons no longer include core necessities', () => {
  const keys = getAdvertisedEnterpriseAddons('hotel').map((a) => a.key)
  assert.ok(keys.includes('payment_gateway'))
  assert.ok(keys.includes('advanced_rates'))
  assert.ok(!keys.includes('rate_plans'))
  assert.ok(!keys.includes('corporate_accounts'))
  assert.ok(!keys.includes('advanced_housekeeping_mobile'))
  assert.equal(getEnterpriseAddonByKey('rate_plans').advertise, false)
  assert.equal(getEnterpriseAddonByKey('rate_plans').status, ENTERPRISE_ADDON_STATUS.active)
})

test('commercial addon offers for Hotel exclude core modules', () => {
  const keys = getCommercialAddonOffers(COMMERCIAL_PRODUCT_IDS.HOTEL).map((a) => a.addonKey)
  assert.ok(!keys.includes('rate_plans'))
  assert.ok(!keys.includes('corporate_accounts'))
  assert.ok(keys.includes('payment_gateway'))
})

test('getCommercialEntitlementKeys for hotel_core alone includes night audit and rates', () => {
  const keys = getCommercialEntitlementKeys({
    productId: COMMERCIAL_PRODUCT_IDS.HOTEL,
    commercialPackageKey: 'hotel_core',
    selectedAddonKeys: []
  })
  assert.ok(keys.includes('night_audit_enterprise'))
  assert.ok(keys.includes('rate_plans'))
  assert.ok(keys.includes('checkin_workflow'))
  assert.ok(keys.includes('documents'))
  assert.ok(!keys.includes('channel_manager'))
})

test('hotel nav does not lock rate plans or corporate on clean Core features', () => {
  const features = computeEffectiveFeatures('Enterprise', [])
  assert.equal(
    isHotelNavItemLocked(
      { feature: 'rate_plans', moduleKey: 'rate_plans' },
      { features, addons: [] }
    ),
    false
  )
  assert.equal(
    isHotelNavItemLocked(
      { feature: 'corporate_accounts', moduleKey: 'corporate_accounts' },
      { features, addons: [] }
    ),
    false
  )
  assert.equal(
    isHotelNavItemLocked(
      { feature: 'channel_manager', moduleKey: 'channel_manager', isAddon: true, addonKey: 'channel_manager' },
      { features, addons: [] }
    ),
    true
  )
})
