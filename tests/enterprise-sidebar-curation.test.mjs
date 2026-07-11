import test from 'node:test'
import assert from 'node:assert/strict'

const { getDesktopNavItems } = await import('../src/renderer/src/navigation/desktopNav.js')

const fullAccess = {
  allowedByRole: new Proxy({}, { get: () => true })
}

const enabledEnterpriseAddons = [
  'corporate_accounts',
  'rate_plans',
  'payment_gateway',
  'channel_manager',
  'guest_messaging',
  'guest_portal',
  'multi_property',
  'advanced_rates',
  'advanced_reports',
  'multi_outlet_pos',
  'guest_crm',
  'operations_compliance',
  'documents',
  'hotel_roles',
  'advanced_booking_engine',
  'room_attributes'
]

function labelsFor(propertyType) {
  return getDesktopNavItems('lodge', fullAccess, propertyType, 'Enterprise', enabledEnterpriseAddons)
    .map((item) => item.label)
}

test('hotel sidebar hides duplicate and setup-only Enterprise pages', () => {
  const labels = labelsFor('hotel')

  for (const hiddenLabel of [
    'Hotel Dashboard',
    'Hotel KPIs',
    'Advanced Housekeeping',
    'Housekeeping Command',
    'Maintenance (Enterprise)',
    'Corporate Billing',
    'Rate Calendar',
    'Revenue Manager',
    'Promo Codes',
    'Room Attributes',
    'Documents',
    'Hotel Roles',
    'Night Audit (Enterprise)',
    'Check-in Workflow',
    'Early / Late Checkout',
    'Cancellation Policies',
    'Booking Engine',
    'Payment Links',
    'Payment Gateway',
    'Custom Website',
    'Enterprise Reports'
  ]) {
    assert.equal(labels.includes(hiddenLabel), false, `${hiddenLabel} should not appear as a hotel-mode sidebar item`)
  }

  for (const visibleLabel of [
    'Dashboard',
    'Bookings',
    'Housekeeping',
    'Maintenance',
    'Rooms',
    'Folios',
    'Corporate Accounts',
    'Rate Plans',
    'Channel Manager',
    'Guest Portal'
  ]) {
    assert.equal(labels.includes(visibleLabel), true, `${visibleLabel} should remain visible in hotel mode`)
  }
})

test('custom website is not a client sidebar workspace', () => {
  assert.equal(labelsFor('lodge').includes('Custom Website'), false)
  assert.equal(labelsFor('hotel').includes('Custom Website'), false)
})
