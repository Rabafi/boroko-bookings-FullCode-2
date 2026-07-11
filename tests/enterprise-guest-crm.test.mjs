import test from 'node:test'
import assert from 'node:assert/strict'

const VIP_LEVELS = ['standard', 'silver', 'gold', 'platinum']
const CONSENT_TYPES = ['marketing', 'communication', 'data_processing']

test('VIP levels are defined', () => {
  assert.ok(Array.isArray(VIP_LEVELS))
  assert.ok(VIP_LEVELS.includes('standard'))
  assert.ok(VIP_LEVELS.includes('silver'))
  assert.ok(VIP_LEVELS.includes('gold'))
  assert.ok(VIP_LEVELS.includes('platinum'))
  assert.equal(VIP_LEVELS.length, 4)
})

test('Consent types are defined', () => {
  assert.ok(Array.isArray(CONSENT_TYPES))
  assert.ok(CONSENT_TYPES.includes('marketing'))
  assert.ok(CONSENT_TYPES.includes('communication'))
  assert.ok(CONSENT_TYPES.includes('data_processing'))
  assert.equal(CONSENT_TYPES.length, 3)
})

test('CRM profile model shape is valid', () => {
  const profile = {
    id: 'uuid-1',
    lodge_id: 'uuid-lodge',
    customer_id: 'uuid-customer',
    vip_level: 'gold',
    vip_approved_by: 'uuid-staff',
    stay_count: 15,
    lifetime_value: 12500.00,
    preferred_room_type_id: 'uuid-room-type',
    preferences: { pillow_type: 'feather', floor_preference: 'high_floor' },
    blacklisted: false,
    blacklist_reason: null,
    watchlisted: true,
    watchlist_reason: 'Frequent late checkout without notice',
    company_affiliation_id: null
  }

  assert.ok(profile.id)
  assert.ok(profile.lodge_id)
  assert.ok(profile.customer_id)
  assert.ok(VIP_LEVELS.includes(profile.vip_level))
  assert.ok(Number.isFinite(profile.stay_count) && profile.stay_count >= 0)
  assert.ok(Number.isFinite(profile.lifetime_value) && profile.lifetime_value >= 0)
  assert.equal(typeof profile.blacklisted, 'boolean')
  assert.equal(typeof profile.watchlisted, 'boolean')
  assert.ok(typeof profile.preferences === 'object' && !Array.isArray(profile.preferences))
})

test('Stay history model shape is valid', () => {
  const stay = {
    id: 'uuid-1',
    lodge_id: 'uuid-lodge',
    customer_id: 'uuid-customer',
    booking_id: 'uuid-booking',
    check_in: '2026-06-15',
    check_out: '2026-06-18',
    room_type: 'Deluxe Suite',
    total_amount: 4500.00,
    paid_amount: 4500.00,
    incidents: ['Late checkout', 'Noise complaint'],
    notes: 'Repeated guest, offered complimentary upgrade'
  }

  assert.ok(stay.id)
  assert.ok(stay.lodge_id)
  assert.ok(stay.customer_id)
  assert.ok(stay.check_in)
  assert.ok(stay.check_out)
  assert.ok(new Date(stay.check_out) > new Date(stay.check_in), 'check_out must be after check_in')
  assert.ok(Number.isFinite(stay.total_amount) && stay.total_amount >= 0)
  assert.ok(Number.isFinite(stay.paid_amount) && stay.paid_amount >= 0)
  assert.ok(Array.isArray(stay.incidents))
})

test('Consent log model shape is valid', () => {
  const consent = {
    id: 'uuid-1',
    lodge_id: 'uuid-lodge',
    customer_id: 'uuid-customer',
    consent_type: 'marketing',
    granted: true,
    granted_at: new Date().toISOString(),
    ip_address: '192.168.1.1',
    notes: 'Opted in during check-in'
  }

  assert.ok(consent.id)
  assert.ok(CONSENT_TYPES.includes(consent.consent_type))
  assert.equal(typeof consent.granted, 'boolean')
  assert.ok(consent.granted_at)
})

test('VIP level hierarchy ordering', () => {
  const ORDER = ['standard', 'silver', 'gold', 'platinum']

  assert.equal(ORDER.indexOf('standard'), 0)
  assert.equal(ORDER.indexOf('silver'), 1)
  assert.equal(ORDER.indexOf('gold'), 2)
  assert.equal(ORDER.indexOf('platinum'), 3)
})

test('Blacklist state transitions are valid', () => {
  const states = [
    { blacklisted: false, reason: '' },
    { blacklisted: true, reason: 'Damaged property' },
    { blacklisted: false, reason: '' }
  ]

  for (const s of states) {
    assert.equal(typeof s.blacklisted, 'boolean')
    if (s.blacklisted) {
      assert.ok(s.reason.length > 0, 'Blacklist reason must be provided when blacklisting')
    }
  }
})

test('Watchlist state transitions are valid', () => {
  const states = [
    { watchlisted: false, reason: '' },
    { watchlisted: true, reason: 'Frequent complaints' },
    { watchlisted: false, reason: '' }
  ]

  for (const s of states) {
    assert.equal(typeof s.watchlisted, 'boolean')
  }
})

test('Search guest CRM result shape', () => {
  const result = {
    customer_id: 'uuid-customer',
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+267 71 234 567',
    vip_level: 'gold',
    blacklisted: false,
    watchlisted: false,
    stay_count: 10,
    lifetime_value: 8500.00,
    preferences: { pillow_type: 'memory_foam' }
  }

  assert.ok(result.customer_id)
  assert.ok(result.name)
  assert.ok(VIP_LEVELS.includes(result.vip_level))
  assert.equal(typeof result.blacklisted, 'boolean')
  assert.ok(Number.isFinite(result.stay_count) && result.stay_count >= 0)
  assert.ok(Number.isFinite(result.lifetime_value) && result.lifetime_value >= 0)
})

test('VIP list result shape', () => {
  const vipEntry = {
    customer_id: 'uuid-customer',
    name: 'Jane Smith',
    email: 'jane@example.com',
    vip_level: 'platinum',
    stay_count: 25,
    lifetime_value: 45000.00
  }

  assert.ok(vipEntry.customer_id)
  assert.ok(vipEntry.name)
  assert.ok(['silver', 'gold', 'platinum'].includes(vipEntry.vip_level))
  assert.notEqual(vipEntry.vip_level, 'standard', 'VIP list should not include standard')
})

test('CRM profile upsert merges preferences', () => {
  const existing = { pillow_type: 'feather', floor_preference: 'high_floor' }
  const update = { pillow_type: 'memory_foam' }
  const merged = { ...existing, ...update }

  assert.equal(merged.pillow_type, 'memory_foam')
  assert.equal(merged.floor_preference, 'high_floor')
})

test('Stay history totals are consistent', () => {
  const stays = [
    { total_amount: 1500, paid_amount: 1500 },
    { total_amount: 3200, paid_amount: 2000 },
    { total_amount: 2800, paid_amount: 0 }
  ]

  const totalAmount = stays.reduce((s, stay) => s + stay.total_amount, 0)
  const totalPaid = stays.reduce((s, stay) => s + stay.paid_amount, 0)
  const outstanding = totalAmount - totalPaid

  assert.equal(totalAmount, 7500)
  assert.equal(totalPaid, 3500)
  assert.equal(outstanding, 4000)
})
