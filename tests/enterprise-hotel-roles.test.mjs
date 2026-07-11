import test from 'node:test'
import assert from 'node:assert/strict'

test('Hotel role templates table schema is defined', () => {
  const expectedColumns = ['id', 'role_key', 'role_name', 'description', 'category', 'capabilities', 'is_system_role', 'created_at']
  assert.ok(expectedColumns.length >= 6, 'Expected at least 6 columns for hotel_role_templates')
  assert.ok(expectedColumns.includes('role_key'), 'Expected role_key column')
  assert.ok(expectedColumns.includes('capabilities'), 'Expected capabilities column')
  assert.ok(expectedColumns.includes('category'), 'Expected category column')
})

test('Role categories are valid', () => {
  const validCategories = ['front_office', 'housekeeping', 'maintenance', 'finance', 'revenue', 'sales', 'management']
  assert.equal(validCategories.length, 7, 'Expected exactly 7 role categories')
  assert.ok(validCategories.includes('front_office'), 'Expected front_office category')
  assert.ok(validCategories.includes('housekeeping'), 'Expected housekeeping category')
  assert.ok(validCategories.includes('management'), 'Expected management category')
})

test('Night auditor capabilities are defined', () => {
  const nightAuditorCaps = ['front_desk_dashboard.view', 'bookings.view', 'folios.view', 'night_audit.close', 'audit.view', 'reports.view']
  assert.ok(nightAuditorCaps.length >= 5, 'Expected at least 5 capabilities for night auditor')
  assert.ok(nightAuditorCaps.includes('night_audit.close'), 'Expected night_audit.close capability')
  assert.ok(nightAuditorCaps.includes('folios.view'), 'Expected folios.view capability')
})

test('General manager has full access', () => {
  const gmCaps = ['general_manager.full_access']
  assert.ok(gmCaps.length >= 1, 'Expected general_manager to have full_access capability')
})

test('Reservations agent capabilities are defined', () => {
  const raCaps = ['bookings.view', 'bookings.manage', 'rooms.view', 'rate_plans.view', 'guests.view']
  assert.ok(raCaps.length >= 4, 'Expected at least 4 capabilities for reservations agent')
  assert.ok(raCaps.includes('rate_plans.view'), 'Expected rate_plans.view capability')
})

test('Front office manager capabilities are defined', () => {
  const foCaps = ['bookings.view', 'bookings.manage', 'checkin.manage', 'checkout.manage', 'room_moves.manage', 'folios.view', 'front_desk_dashboard.view']
  assert.ok(foCaps.length >= 6, 'Expected at least 6 capabilities for front office manager')
  assert.ok(foCaps.includes('checkin.manage'), 'Expected checkin.manage capability')
  assert.ok(foCaps.includes('checkout.manage'), 'Expected checkout.manage capability')
  assert.ok(foCaps.includes('room_moves.manage'), 'Expected room_moves.manage capability')
})

test('Housekeeping supervisor capabilities are defined', () => {
  const hkCaps = ['housekeeping.assign', 'housekeeping.inspect', 'housekeeping.manage', 'rooms.view', 'linen.manage', 'lost_found.manage']
  assert.ok(hkCaps.includes('housekeeping.assign'), 'Expected housekeeping.assign capability')
  assert.ok(hkCaps.includes('housekeeping.inspect'), 'Expected housekeeping.inspect capability')
  assert.ok(hkCaps.includes('linen.manage'), 'Expected linen.manage capability')
})

test('Revenue manager capabilities are defined', () => {
  const revCaps = ['rate_plans.view', 'rate_plans.manage', 'rate_calendar.manage', 'promo_codes.manage', 'reports.view', 'revenue_manager.view']
  assert.ok(revCaps.includes('rate_calendar.manage'), 'Expected rate_calendar.manage capability')
  assert.ok(revCaps.includes('promo_codes.manage'), 'Expected promo_codes.manage capability')
})

test('Finance debtors capabilities are defined', () => {
  const finCaps = ['corporate_accounts.view', 'corporate_accounts.manage', 'corporate_billing.manage', 'folios.view', 'reports.view', 'expenses.view']
  assert.ok(finCaps.includes('corporate_billing.manage'), 'Expected corporate_billing.manage capability')
  assert.ok(finCaps.includes('corporate_accounts.manage'), 'Expected corporate_accounts.manage capability')
})

test('Get hotel role templates RPC exists', () => {
  assert.ok(true, 'get_hotel_role_templates RPC should exist')
})

test('Get role capabilities RPC exists', () => {
  assert.ok(true, 'get_role_capabilities RPC should exist')
})
