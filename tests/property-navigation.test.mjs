// Experience workstream: property presentation in desktop navigation.
// Labels/keywords adapt to the accommodation mix; visibility, locking,
// capability gating and plan enforcement must be untouched.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getDesktopNavItems,
  applyPropertyPresentationToNavItems
} from '../src/renderer/src/navigation/desktopNav.js'

const FULL_ACCESS = { allowedByRole: new Proxy({}, { get: () => true }) }
const LODGE_PRODUCT = 'lodge-camp'

function nav(type, { plan = 'Pro', profile = null, addons = [] } = {}) {
  return getDesktopNavItems('lodge', FULL_ACCESS, type, plan, addons, profile, LODGE_PRODUCT)
}

function byRoute(items, route) {
  return items.find((item) => item.to === route)
}

function routeSet(items) {
  return items.map((item) => item.to).sort()
}

function lockMap(items) {
  return Object.fromEntries(items.map((item) => [item.to, item.isLocked === true]))
}

test('rooms-only types keep familiar Rooms / Room Board labels', () => {
  for (const type of ['guest_house', 'bnb', 'lodge', 'motel']) {
    const items = nav(type)
    assert.equal(byRoute(items, '/rooms')?.label, 'Rooms', type)
    assert.equal(byRoute(items, '/roomgrid')?.label, 'Room Board', type)
  }
})

test('camp with mixed profile shows Sites & Units / Stay Board', () => {
  const items = nav('camp', { profile: { accommodation_mix: { rooms_or_units: true, campsites: true } } })
  assert.equal(byRoute(items, '/rooms')?.label, 'Sites & Units')
  assert.equal(byRoute(items, '/roomgrid')?.label, 'Stay Board')
})

test('sites-only mix shows Sites / Site Board with camp keywords', () => {
  const items = nav('camp', { profile: { accommodation_mix: { rooms_or_units: false, campsites: true } } })
  const rooms = byRoute(items, '/rooms')
  const board = byRoute(items, '/roomgrid')
  assert.equal(rooms?.label, 'Sites')
  assert.equal(board?.label, 'Site Board')
  for (const keyword of ['site', 'sites', 'campsite', 'campsites', 'camp']) {
    assert.ok(rooms.keywords.includes(keyword), `rooms keywords include ${keyword}`)
    assert.ok(board.keywords.includes(keyword), `board keywords include ${keyword}`)
  }
  const housekeeping = byRoute(items, '/housekeeping')
  assert.ok(housekeeping.keywords.includes('sites'), 'housekeeping gains site keywords when sites exist')
})

test('rooms-only mix keeps room keywords and no site terms', () => {
  const items = nav('lodge')
  const rooms = byRoute(items, '/rooms')
  assert.ok(rooms.keywords.includes('rooms'), 'room keyword kept')
  for (const keyword of ['campsite', 'campsites', 'pitch']) {
    assert.equal(rooms.keywords.includes(keyword), false, `no ${keyword} for rooms-only`)
  }
})

test('presentation never changes visibility, locking or membership', () => {
  for (const type of ['guest_house', 'bnb', 'lodge', 'camp', 'motel']) {
    const plain = nav(type)
    const mixed = nav(type, { profile: { accommodation_mix: { rooms_or_units: true, campsites: true } } })
    assert.deepEqual(routeSet(plain), routeSet(mixed), `${type}: same routes with and without mix`)
    assert.deepEqual(lockMap(plain), lockMap(mixed), `${type}: same locked flags with and without mix`)
    for (const item of mixed) {
      const original = byRoute(plain, item.to)
      assert.equal(item.visibility, original.visibility, `${type} ${item.to}: visibility untouched`)
      assert.equal(item.group ?? null, original.group ?? null, `${type} ${item.to}: group untouched`)
      assert.equal(item.capability ?? null, original.capability ?? null, `${type} ${item.to}: capability untouched`)
    }
  }
})

test('guest_house and bnb keep entitled optional services (presentation adds nothing, removes nothing)', () => {
  // Standard plan + full role access: lodge sees events/day-use/F&B surfaces.
  // Configured-service alignment: entitled conference/pool stay visible for
  // guest_house/bnb too (moduleCatalog eligibility — no server/commercial
  // property-type prohibition exists; plan/role/capability locks still apply).
  // Presentation itself still adds/removes nothing (pinned by the test above).
  const lodge = nav('lodge', { plan: 'Standard' })
  const guestHouse = nav('guest_house', { plan: 'Standard' })
  const bnb = nav('bnb', { plan: 'Standard' })
  assert.ok(byRoute(lodge, '/conference'), 'lodge sees Events & Venues when entitled')
  assert.ok(byRoute(lodge, '/dayuse'), 'lodge sees Day Use when entitled')
  for (const [label, items] of [['guest_house', guestHouse], ['bnb', bnb]]) {
    const conference = byRoute(items, '/conference')
    const dayuse = byRoute(items, '/dayuse')
    assert.ok(conference, `${label} sees Events & Venues when entitled`)
    assert.ok(dayuse, `${label} sees Day Use when entitled`)
    assert.equal(conference.isLocked, false, `${label} conference is usable, not an upsell lock`)
    assert.equal(dayuse.isLocked, false, `${label} day use is usable, not an upsell lock`)
  }
  // ...but presentation must not drop anything the catalog grants.
  for (const item of guestHouse) {
    assert.ok(item.to, 'every guest_house item keeps its route')
  }
  assert.ok(routeSet(guestHouse).includes('/rooms'), 'guest_house keeps inventory nav')
  assert.ok(routeSet(guestHouse).includes('/housekeeping'), 'guest_house keeps housekeeping nav')
})

test('starter locks stay locked regardless of property wording', () => {
  const items = nav('camp', {
    plan: 'Starter',
    profile: { accommodation_mix: { rooms_or_units: true, campsites: true } }
  })
  const reports = byRoute(items, '/reports')
  assert.ok(reports, 'reports surface exists on Starter')
  assert.equal(reports.isLocked, true, 'reports stay locked on Starter even for camp')
  assert.equal(byRoute(items, '/rooms')?.label, 'Sites & Units', 'labels still adapt while locked')
})

test('applyPropertyPresentationToNavItems is safe for unknown and stale inputs', () => {
  const items = [{ to: '/rooms', label: 'Rooms', keywords: ['inventory'], capability: 'rooms.view', moduleKey: 'rooms' }]
  const unknown = applyPropertyPresentationToNavItems(items, { propertyType: 'hotel' })
  assert.equal(unknown[0].label, 'Rooms', 'hotel keeps existing labels')
  assert.equal(unknown[0].capability, 'rooms.view', 'capability preserved')
  assert.equal(unknown[0].moduleKey, 'rooms', 'moduleKey preserved')

  assert.deepEqual(applyPropertyPresentationToNavItems(null, { propertyType: 'camp' }), [])
  const empty = applyPropertyPresentationToNavItems([], { propertyType: 'camp' })
  assert.deepEqual(empty, [])

  // Original array is never mutated.
  const source = [{ to: '/roomgrid', label: 'Room Board', keywords: ['grid'] }]
  applyPropertyPresentationToNavItems(source, { propertyType: 'camp', accommodationMix: [{ accommodation_kind: 'campsite' }] })
  assert.equal(source[0].label, 'Room Board')
  assert.deepEqual(source[0].keywords, ['grid'])
})
