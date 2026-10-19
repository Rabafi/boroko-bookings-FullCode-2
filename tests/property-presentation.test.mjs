// Experience workstream: shared property-presentation resolver contract.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SUPPORTED_LODGING_PROPERTY_TYPES,
  SUPPORTED_LODGING_TYPES,
  LODGING_BUSINESS_LABELS,
  toSupportedLodgingType,
  isSupportedLodgingType,
  isSameProductTransition,
  getLodgingBusinessLabel,
  getLodgingTypeOptions,
  getPropertyPresentation,
  summarizeAccommodationMix,
  getPresentationUnitName,
  describePresentationDiff,
  mapPropertyTransitionError
} from '../src/shared/propertyPresentation.js'

test('supported lodging types are exactly the five same-product types', () => {
  assert.deepEqual([...SUPPORTED_LODGING_PROPERTY_TYPES], ['guest_house', 'bnb', 'lodge', 'camp', 'motel'])
  assert.ok(Object.isFrozen(SUPPORTED_LODGING_PROPERTY_TYPES))
  assert.deepEqual([...SUPPORTED_LODGING_TYPES], [...SUPPORTED_LODGING_PROPERTY_TYPES])
})

test('isSupportedLodgingType accepts the five types and camp aliases only', () => {
  for (const type of ['guest_house', 'bnb', 'lodge', 'camp', 'motel']) {
    assert.equal(isSupportedLodgingType(type), true, type)
  }
  for (const alias of ['guesthouse', 'camping', 'campsite']) {
    assert.equal(isSupportedLodgingType(alias), true, alias)
  }
  for (const other of ['hotel', 'resort', 'restaurant', 'bar', 'pos_only', 'hostel', '', 'weird', null, undefined]) {
    assert.equal(isSupportedLodgingType(other), false, String(other))
  }
})

test('toSupportedLodgingType never coerces cross-product types to lodge', () => {
  assert.equal(toSupportedLodgingType('hotel'), null)
  assert.equal(toSupportedLodgingType('restaurant'), null)
  assert.equal(toSupportedLodgingType('mystery-type'), null)
  assert.equal(toSupportedLodgingType('camp'), 'camp')
  assert.equal(toSupportedLodgingType('guesthouse'), 'guest_house')
})

test('isSameProductTransition is true only inside the five', () => {
  const types = [...SUPPORTED_LODGING_PROPERTY_TYPES]
  for (const from of types) {
    for (const to of types) {
      assert.equal(isSameProductTransition(from, to), true, `${from} -> ${to}`)
    }
  }
  for (const cross of ['hotel', 'resort', 'restaurant', 'bar', 'pos_only', 'hostel', '', null]) {
    assert.equal(isSameProductTransition('lodge', cross), false, `lodge -> ${cross}`)
    assert.equal(isSameProductTransition(cross, 'camp'), false, `${cross} -> camp`)
  }
})

test('each supported type gets its business label and exclusive-use wording', () => {
  const expected = {
    guest_house: { business: 'Guest House', exclusive: 'Full guest house', board: 'Room Board', inventory: 'Rooms' },
    bnb: { business: 'Bed & Breakfast', exclusive: 'Full B&B', board: 'Room Board', inventory: 'Rooms' },
    lodge: { business: 'Lodge', exclusive: 'Full Lodge', board: 'Room Board', inventory: 'Rooms' },
    camp: { business: 'Camp', exclusive: 'Full camp', board: 'Stay Board', inventory: 'Sites & Units' },
    motel: { business: 'Motel', exclusive: 'Full motel', board: 'Room Board', inventory: 'Rooms' }
  }
  for (const [type, want] of Object.entries(expected)) {
    const presentation = getPropertyPresentation({ propertyType: type })
    assert.equal(presentation.type, type)
    assert.equal(presentation.businessLabel, want.business, type)
    assert.equal(presentation.exclusiveUseLabel, want.exclusive, type)
    assert.equal(presentation.navHints.boardLabel, want.board, type)
    assert.equal(presentation.inventoryLabel, want.inventory, type)
    assert.equal(presentation.housekeepingLabel, 'Housekeeping', `${type} keeps the Housekeeping title`)
  }
})

test('legacy profiles without mix data fall back to safe room wording', () => {
  for (const input of [{}, { propertyType: null }, { propertyType: 'lodge' }, { propertyType: 'guest_house', operatingProfile: {} }]) {
    const presentation = getPropertyPresentation(input)
    assert.equal(presentation.inventoryLabel, 'Rooms', JSON.stringify(input))
    assert.equal(presentation.unitNoun, 'Room', JSON.stringify(input))
    assert.equal(presentation.navHints.boardLabel, 'Room Board', JSON.stringify(input))
    assert.equal(presentation.mix.source === 'fallback' || presentation.mix.source === 'defaults', true)
  }
  assert.equal(getLodgingBusinessLabel('unknown-type'), 'Property')
})

test('accommodation mix derives sites-only, rooms-only and mixed wording', () => {
  const sitesOnly = getPropertyPresentation({
    propertyType: 'camp',
    accommodationMix: [{ accommodation_kind: 'campsite' }, { kind: 'site' }]
  })
  assert.deepEqual([sitesOnly.mix.hasRooms, sitesOnly.mix.hasSites], [false, true])
  assert.equal(sitesOnly.mix.kind, 'sites')
  assert.equal(sitesOnly.unitNoun, 'Site')
  assert.equal(sitesOnly.inventoryLabel, 'Sites')
  assert.equal(sitesOnly.navHints.boardLabel, 'Site Board')
  assert.equal(sitesOnly.navHints.showRooms, false)
  assert.equal(sitesOnly.navHints.showSites, true)

  const mixed = getPropertyPresentation({
    propertyType: 'camp',
    accommodationMix: [{ accommodation_kind: 'room' }, { accommodation_kind: 'campsite' }, { accommodation_kind: 'tent' }]
  })
  assert.equal(mixed.mix.kind, 'mixed')
  assert.equal(mixed.unitNoun, 'Stay unit')
  assert.equal(mixed.inventoryLabel, 'Sites & Units')
  assert.equal(mixed.navHints.boardLabel, 'Stay Board')

  const roomsOnly = getPropertyPresentation({
    propertyType: 'camp',
    accommodationMix: [{ accommodation_kind: 'room' }, { accommodation_kind: 'unit' }]
  })
  assert.equal(roomsOnly.mix.kind, 'rooms')
  assert.equal(roomsOnly.inventoryLabel, 'Rooms')
  assert.equal(roomsOnly.navHints.boardLabel, 'Room Board')
})

test('mix object and campsite-profile shapes are understood', () => {
  const fromFlags = getPropertyPresentation({ propertyType: 'lodge', accommodationMix: { rooms_or_units: true, campsites: true } })
  assert.equal(fromFlags.mix.kind, 'mixed')

  const fromCounts = getPropertyPresentation({ propertyType: 'camp', accommodationMix: { rooms: 0, campsites: 6 } })
  assert.equal(fromCounts.mix.kind, 'sites')
  assert.equal(fromCounts.inventoryLabel, 'Sites')

  const fromProfile = getPropertyPresentation({
    propertyType: 'lodge',
    operatingProfile: { accommodation_mix: { rooms_or_units: false, campsites: true } }
  })
  assert.equal(fromProfile.mix.kind, 'sites')
  assert.equal(fromProfile.mix.source, 'profile')
})

test('precedence: explicit services add visibility, profile flags never grant or remove', () => {
  // A lodge that configured campsite services shows site wording too.
  const withService = getPropertyPresentation({
    propertyType: 'lodge',
    accommodationMix: { rooms_or_units: true, campsites: false },
    entitledModules: ['campsites']
  })
  assert.equal(withService.navHints.showSites, true)
  assert.equal(withService.navHints.showRooms, true)

  // A campsite-looking profile flag cannot hide real rooms from the mix.
  const keepsRooms = getPropertyPresentation({
    propertyType: 'camp',
    accommodationMix: [{ accommodation_kind: 'room' }],
    operatingProfile: { operation_style: 'simple', enabled_modules: ['bookings'] }
  })
  assert.equal(keepsRooms.navHints.showRooms, true)
  assert.equal(keepsRooms.inventoryLabel, 'Rooms')
})

test('per-row unit names keep business nouns separate from unit nouns', () => {
  assert.equal(getPresentationUnitName({ room_number: '101', accommodation_kind: 'room' }), 'Room 101')
  assert.equal(getPresentationUnitName({ room_number: 'A12', accommodation_kind: 'campsite' }), 'Campsite A12')
  assert.equal(getPresentationUnitName({ site_number: 'B3', kind: 'site' }), 'Campsite B3')
  assert.equal(getPresentationUnitName({ room_number: 'T4', accommodation_kind: 'tent' }), 'Permanent tent T4')
  assert.equal(getPresentationUnitName({ room_number: 'C2', accommodation_kind: 'cabin' }), 'Unit / Cabin C2')
  assert.equal(getPresentationUnitName(null), '')
})

test('mix summary and wording diff support the Settings journey', () => {
  assert.equal(summarizeAccommodationMix({ rooms_or_units: true, campsites: true }), 'Mixed: rooms/units and sites')
  assert.equal(summarizeAccommodationMix({ rooms_or_units: false, campsites: true }), 'Sites only')
  assert.equal(summarizeAccommodationMix(null, null), 'Inventory mix not recorded yet (room wording in use)')

  const diff = describePresentationDiff('lodge', 'camp')
  assert.ok(diff.some((line) => line.includes('Lodge') && line.includes('Camp')))
  assert.ok(diff.some((line) => line.includes('Full Lodge') && line.includes('Full camp')))
  const same = describePresentationDiff('lodge', 'lodge')
  assert.equal(same.length, 1)

  assert.equal(getLodgingTypeOptions().length, 5)
  assert.deepEqual(getLodgingTypeOptions().map((option) => option.value), [...SUPPORTED_LODGING_PROPERTY_TYPES])
  for (const label of Object.values(LODGING_BUSINESS_LABELS)) {
    assert.ok(getLodgingTypeOptions().some((option) => option.label === label), label)
  }
})

test('transition errors map to actionable recovery kinds', () => {
  assert.equal(mapPropertyTransitionError({ code: 'property_transition_offline' }).kind, 'offline')
  assert.equal(mapPropertyTransitionError({ code: 'CAPABILITY_DENIED', message: 'Only a lodge administrator can preview.' }).kind, 'denied')
  assert.equal(mapPropertyTransitionError({ code: 'LODGE_SCOPE_DENIED', message: 'Access denied for this lodge.' }).kind, 'denied')
  assert.equal(mapPropertyTransitionError({ code: 'expected_state_conflict', message: 'changed since the preview' }).kind, 'stale')
  assert.equal(mapPropertyTransitionError({ code: 'SETUP_INCOMPLETE', message: 'Complete setup first.' }).kind, 'blocker')
  assert.equal(mapPropertyTransitionError({ code: 'idempotency_key_reuse_mismatch', message: 'already used' }).kind, 'conflict')
  assert.equal(mapPropertyTransitionError({ code: 'cross_product_rejected', message: 'stay inside LodgingOS' }).kind, 'conflict')
  assert.equal(mapPropertyTransitionError({ code: 'NOT_FOUND', message: 'No property-type transition is recorded.' }).retryable, true)
  const timeout = mapPropertyTransitionError({ code: 'settings_save_timeout', message: 'Saving settings timed out.' })
  assert.equal(timeout.kind, 'timeout')
  assert.equal(timeout.retryable, true)
})
