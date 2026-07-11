import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MODULE_CATALOG,
  MODULE_VISIBILITY_STATES,
  resolveModuleVisibility,
  getModuleByKey,
  getAddonModules,
  getEnterpriseModules
} from '../src/shared/moduleCatalog.js'
import { getDesktopNavItems } from '../src/renderer/src/navigation/desktopNav.js'

const ALL_ACCESS = { allowedByRole: new Proxy({}, { get: () => true }) }

function findItem(items, label) {
  return items.find(i => i.label === label)
}

test('Starter hotel has no Enterprise modules visible', async () => {
  const enterpriseKeys = [
    'front_desk_dashboard', 'rate_plans', 'multi_property', 'guest_portal',
    'guest_crm', 'channel_manager', 'payment_gateway', 'documents',
    'hotel_roles', 'advanced_housekeeping', 'room_types', 'floors_sections',
    'night_audit_enterprise', 'corporate_accounts'
  ]
  for (const key of enterpriseKeys) {
    const result = resolveModuleVisibility(key, 'hotel', 'Starter')
    assert.ok(
      result === MODULE_VISIBILITY_STATES.locked || result === MODULE_VISIBILITY_STATES.hidden,
      `Expected ${key} to be locked or hidden for hotel + Starter, got ${result}`
    )
  }
})

test('Pro hotel has Enterprise modules locked', async () => {
  const enterpriseKeys = [
    'front_desk_dashboard', 'room_types', 'floors_sections', 'hotel_kpis'
  ]
  for (const key of enterpriseKeys) {
    const result = resolveModuleVisibility(key, 'hotel', 'Pro')
    assert.equal(result, MODULE_VISIBILITY_STATES.locked, `Expected ${key} to be locked for hotel + Pro, got ${result}`)
  }
})

test('Enterprise hotel has all modules visible', async () => {
  const enterpriseKeys = [
    'front_desk_dashboard', 'room_types', 'floor_sections', 'hotel_kpis',
    'night_audit_enterprise', 'checkin_workflow', 'early_late_checkout',
    'cancellation_policies', 'folios', 'corporate_accounts', 'rate_plans',
    'multi_property'
  ]
  for (const key of enterpriseKeys) {
    const mod = getModuleByKey(key)
    if (!mod) continue
    if (mod.isAddon) {
      const addonKeys = [mod.addonKey]
      const result = resolveModuleVisibility(key, 'hotel', 'Enterprise', addonKeys)
      assert.equal(result, MODULE_VISIBILITY_STATES.visible, `Expected addon ${key} to be visible for hotel + Enterprise with addon, got ${result}`)
    } else {
      const result = resolveModuleVisibility(key, 'hotel', 'Enterprise')
      assert.equal(result, MODULE_VISIBILITY_STATES.visible, `Expected ${key} to be visible for hotel + Enterprise, got ${result}`)
    }
  }
})

test('Starter bnb hides hotel-only modules', async () => {
  const hotelOnlyKeys = ['room_types', 'floor_sections', 'hotel_kpis', 'corporate_accounts']
  for (const key of hotelOnlyKeys) {
    const result = resolveModuleVisibility(key, 'bnb', 'Starter')
    assert.equal(result, MODULE_VISIBILITY_STATES.hidden, `Expected ${key} to be hidden for bnb + Starter, got ${result}`)
  }
})

test('Starter restaurant shows no hotel modules', async () => {
  const hotelOnlyKeys = ['room_types', 'floor_sections', 'hotel_kpis', 'corporate_accounts']
  for (const key of hotelOnlyKeys) {
    const result = resolveModuleVisibility(key, 'restaurant', 'Starter')
    assert.equal(result, MODULE_VISIBILITY_STATES.hidden, `Expected ${key} to be hidden for restaurant + Starter, got ${result}`)
  }
})

test('getDesktopNavItems Starter hotel has only Enterprise items locked', async () => {
  const items = getDesktopNavItems('lodge', ALL_ACCESS, 'hotel', 'Starter')
  const labels = items.map(i => i.label)
  const lockedItems = items.filter(i => i.isLocked)
  const lockedLabels = lockedItems.map(i => i.label)

  assert.ok(labels.includes('Dashboard'), 'Dashboard should be present')
  assert.ok(labels.includes('Bookings'), 'Bookings should be present')
  assert.ok(labels.includes('Room Board'), 'Room Board should be present')
  assert.ok(labels.includes('Planning'), 'Planning should be present')
  assert.ok(labels.includes('Guests'), 'Guests should be present')
  assert.ok(labels.includes('Rooms'), 'Rooms should be present')
  assert.ok(labels.includes('Housekeeping'), 'Housekeeping should be present')
  assert.ok(labels.includes('Settings'), 'Settings should be present')

  const coreItems = ['Dashboard', 'Bookings', 'Room Board', 'Planning', 'Guests', 'Rooms', 'Housekeeping', 'Quotations', 'Invoices', 'Maintenance']
  for (const label of coreItems) {
    const item = findItem(items, label)
    if (item) {
      assert.equal(item.isLocked, false, `${label} should not be locked`)
    }
  }

  const enterpriseLabels = ['Hotel Dashboard', 'Room Types', 'Floors & Sections', 'Folios', 'Hotel KPIs', 'Advanced Housekeeping', 'Room Moves', 'Corporate Accounts', 'Rate Plans', 'Custom Website', 'Payment Links', 'Channel Manager', 'Guest Portal', 'Guest Messaging', 'Multi-Property', 'Revenue Manager', 'Guest CRM', 'Operations Compliance', 'Multi-Outlet POS']
  for (const label of enterpriseLabels) {
    if (labels.includes(label)) {
      const item = findItem(items, label)
      assert.ok(item, `${label} should be present in nav`)
      assert.equal(item.isLocked, true, `${label} should be locked for Starter`)
    }
  }
})

test('getDesktopNavItems Pro hotel has Enterprise items locked', async () => {
  const items = getDesktopNavItems('lodge', ALL_ACCESS, 'hotel', 'Pro')
  const labels = items.map(i => i.label)

  assert.ok(labels.includes('Dashboard'), 'Dashboard should be present')
  assert.ok(labels.includes('Bookings'), 'Bookings should be present')

  const enterpriseLabels = ['Hotel Dashboard', 'Room Types', 'Floors & Sections', 'Folios', 'Hotel KPIs', 'Advanced Housekeeping']
  for (const label of enterpriseLabels) {
    if (labels.includes(label)) {
      const item = findItem(items, label)
      assert.ok(item, `${label} should be present in nav`)
      assert.equal(item.isLocked, true, `${label} should be locked for Pro`)
    }
  }

  const coreItems = ['Dashboard', 'Bookings', 'Room Board', 'Planning', 'Guests', 'Rooms', 'Housekeeping']
  for (const label of coreItems) {
    const item = findItem(items, label)
    if (item) {
      assert.equal(item.isLocked, false, `${label} should not be locked`)
    }
  }
})

test('getDesktopNavItems Enterprise hotel has Enterprise items unlocked', async () => {
  const items = getDesktopNavItems('lodge', ALL_ACCESS, 'hotel', 'Enterprise')
  const labels = items.map(i => i.label)

  const enterpriseLabels = ['Hotel Dashboard', 'Room Types', 'Floors & Sections', 'Folios', 'Hotel KPIs', 'Advanced Housekeeping', 'Room Moves']
  for (const label of enterpriseLabels) {
    if (labels.includes(label)) {
      const item = findItem(items, label)
      assert.ok(item, `${label} should be present in nav`)
      assert.equal(item.isLocked, false, `${label} should be unlocked for Enterprise`)
    }
  }

  const coreItems = ['Dashboard', 'Bookings', 'Rooms', 'Housekeeping']
  for (const label of coreItems) {
    const item = findItem(items, label)
    if (item) {
      assert.equal(item.isLocked, false, `${label} should not be locked`)
    }
  }
})

test('getAddonModules returns all addons for Enterprise', async () => {
  const addons = getAddonModules()
  const keys = addons.map(m => m.key)
  const expectedKeys = [
    'room_attributes', 'corporate_accounts', 'rate_plans', 'custom_website',
    'payment_gateway', 'channel_manager', 'multi_property', 'advanced_rates',
    'guest_messaging', 'guest_portal', 'guest_crm', 'multi_outlet_pos',
    'linen_laundry', 'lost_found', 'incident_log', 'visitor_register',
    'emergency_list', 'documents', 'hotel_roles'
  ]
  for (const key of expectedKeys) {
    assert.ok(keys.includes(key), `Expected addon module ${key} to be in getAddonModules()`)
  }
})

test('no enterprise module is always visible', async () => {
  const enterpriseModules = getEnterpriseModules()
  for (const mod of enterpriseModules) {
    if (mod.key === 'subscription_builder') continue
    assert.notEqual(mod.visibility, 'always', `Enterprise module ${mod.key} should not have visibility 'always'`)
  }
})
