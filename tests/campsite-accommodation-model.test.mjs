import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  computeStayTotal,
  isCampsiteUnit,
  normalizeAccommodationKind,
  splitAccommodationInventory
} from '../src/shared/accommodation.js'
import { isCampPropertyType, normalizePropertyType, buildOperatingProfile } from '../src/shared/propertyTypes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const MIGRATION = 'supabase/migrations/20260711140000_campsite_accommodation_model.sql'
const PRICING_MIGRATION = 'supabase/migrations/20260711200000_campsite_booking_pricing_contract.sql'

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('Campsite accommodation model', () => {
  it('migration adds campsite fields and pricing helpers', () => {
    const sql = read(MIGRATION)
    assert.ok(sql.includes('accommodation_kind'))
    assert.ok(sql.includes('is_powered'))
    assert.ok(sql.includes('rate_mode'))
    assert.ok(sql.includes('rate_per_person'))
    assert.ok(sql.includes('max_tents'))
    assert.ok(sql.includes('max_vehicles'))
    assert.ok(sql.includes('compute_accommodation_stay_total'))
    assert.ok(sql.includes("create or replace function public.create_room"))
    assert.ok(sql.includes('campsites'))
    assert.ok(sql.includes('public_offer_campsites'))
  })

  it('authoritative pricing contract carries occupancy and protects idempotency', () => {
    const sql = read(PRICING_MIGRATION)
    assert.match(sql, /create or replace function public\.accommodation_booking_expected_total/)
    assert.match(sql, /create or replace function public\.create_campsite_booking/)
    assert.match(sql, /Idempotency key was already used with different campsite occupancy/)
    assert.match(sql, /booking_accommodation_details/)
    assert.match(sql, /calculated_total/)
    assert.match(sql, /create_online_booking/) 
    assert.match(sql, /v_tents := greatest/)
    assert.match(sql, /v_vehicles := greatest/)
  })

  it('keeps camp as a first-class property type', () => {
    assert.equal(normalizePropertyType('camp'), 'camp')
    assert.equal(isCampPropertyType('camp'), true)
    const profile = buildOperatingProfile('camp', 'Pro')
    assert.equal(profile.campsite_profile.enabled, true)
    assert.equal(profile.accommodation_mix.campsites, true)
  })

  it('shared helpers classify campsites and compute rates', () => {
    assert.equal(normalizeAccommodationKind('pitch'), 'campsite')
    assert.equal(isCampsiteUnit({ accommodation_kind: 'campsite' }), true)
    const { rooms, campsites } = splitAccommodationInventory([
      { id: 1, accommodation_kind: 'room' },
      { id: 2, accommodation_kind: 'campsite' }
    ])
    assert.equal(rooms.length, 1)
    assert.equal(campsites.length, 1)

    const siteTotal = computeStayTotal({ rate_mode: 'site', rate_per_night: 100 }, { nights: 2 })
    assert.equal(siteTotal, 200)

    const personTotal = computeStayTotal(
      { rate_mode: 'person', rate_per_person: 50, capacity_adults: 2 },
      { nights: 2, adults: 3 }
    )
    assert.equal(personTotal, 300)
  })

  it('desktop rooms domain selects and writes campsite fields', () => {
    const js = read('src/main/domains/rooms.js')
    assert.ok(js.includes('accommodation_kind'))
    assert.ok(js.includes('is_powered'))
    assert.ok(js.includes('rate_per_person'))
    assert.ok(js.includes('max_tents'))
  })

  it('rooms UI exposes campsite controls', () => {
    const jsx = read('src/renderer/src/components/Rooms.jsx')
    assert.ok(jsx.includes('accommodation_kind'))
    assert.ok(jsx.includes('Powered site') || jsx.includes('is_powered'))
    assert.ok(jsx.includes('max_tents'))
    assert.ok(jsx.includes('rate_mode'))
  })

  it('booking site splits campsites from rooms', () => {
    const page = read('booking-site/src/pages/LodgePage.jsx')
    assert.ok(page.includes('setCampsites'))
    assert.ok(page.includes('campsites'))
    assert.ok(page.includes("variant=\"campsite\""))
  })
})
