import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const MIGRATION = 'supabase/migrations/20260711180000_hotel_enterprise_uuid_complete.sql'

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('Hotel enterprise UUID complete', () => {
  it('rebuilds hotel folio ledger on uuid lodge_id', () => {
    const sql = read(MIGRATION)
    assert.ok(sql.includes('create table public.hotel_folios'))
    assert.ok(sql.includes('lodge_id uuid not null'))
    assert.ok(!sql.includes('lodge_id BIGINT NOT NULL'))
    assert.ok(sql.includes('create or replace function public.create_hotel_folio'))
    assert.ok(sql.includes('create or replace function public.split_folio'))
    assert.ok(sql.includes('create or replace function public.transfer_folio_charge'))
    assert.ok(sql.includes('ensure_guest_folio_for_booking'))
  })

  it('rebuilds check-in/out workflow on uuid with final check-in/out RPCs', () => {
    const sql = read(MIGRATION)
    assert.ok(sql.includes('create table public.checkin_config'))
    assert.ok(sql.includes('create or replace function public.complete_hotel_checkin'))
    assert.ok(sql.includes('create or replace function public.complete_hotel_checkout'))
    assert.ok(sql.includes('get_applicable_room_rate'))
  })

  it('desktop domains call uuid hotel RPCs', () => {
    const folio = read('src/main/domains/folioLedger.js')
    // callFolioRpc wrapper still invokes create_hotel_folio / get folio payload
    assert.ok(folio.includes("'create_hotel_folio'") || folio.includes('create_hotel_folio'))
    assert.ok(folio.includes('data?.folio') || folio.includes('data.folio'))

    const checkin = read('src/main/domains/checkinWorkflow.js')
    assert.ok(checkin.includes('complete_hotel_checkin'))
    assert.ok(checkin.includes('complete_hotel_checkout'))

    const hotel = read('src/main/domains/hotel.js')
    assert.ok(
      hotel.includes('get_applicable_room_rate') || checkin.includes('get_applicable_room_rate'),
      'applicable room rate must remain on desktop hotel/check-in path'
    )
  })

  it('exposes hotel front desk and check-in routes', () => {
    const app = read('src/renderer/src/App.jsx')
    assert.ok(app.includes('path="hotel-dashboard"'))
    assert.ok(app.includes('HotelDashboard'))
    assert.ok(app.includes('path="checkin-workflow"'))
    assert.ok(app.includes('CheckinWorkflow'))
    assert.ok(!app.includes('checkin-workflow" element={<Navigate'))
  })

  it('hotel navigation is owned by the isolated Hotel product shell', () => {
    const nav = read('src/renderer/src/components/hotel/hotelNav.js')
    assert.ok(nav.includes('HOTEL_STANDALONE'))
    assert.ok(nav.includes('HOTEL_NAV_GROUPS'))
    assert.ok(nav.includes("to: '/checkin-workflow'"))
    assert.ok(nav.includes("to: '/folios'"))
    assert.ok(nav.includes("to: '/night-audit-enterprise'"))

    const app = read('src/renderer/src/App.jsx')
    assert.ok(app.includes('IS_HOTEL_PRODUCT'))
    assert.ok(app.includes('<HotelLayout />'))
  })
})
