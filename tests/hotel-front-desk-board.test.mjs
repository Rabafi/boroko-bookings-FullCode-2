/**
 * Front-desk board contract: no silent empty success, exception lists present,
 * KPI sources labelled as estimates.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const hotelJs = readFileSync(resolve('src/main/domains/hotel.js'), 'utf8')
const homeJsx = readFileSync(resolve('src/renderer/src/components/hotel/HotelHome.jsx'), 'utf8')

test('hotel dashboard stats expose exception lists and labelled estimate sources', () => {
  assert.ok(hotelJs.includes('balanceSource'))
  assert.ok(hotelJs.includes('occupancySource'))
  assert.ok(hotelJs.includes('booking_ledger_estimate'))
  assert.ok(hotelJs.includes('room_status_estimate'))
  for (const key of [
    'unassignedArrivals',
    'dirtyBlockers',
    'maintenanceBlockers',
    'outstandingBalances',
    'vipArrivals',
    'pendingArrivals',
    'pendingDepartures'
  ]) {
    assert.ok(hotelJs.includes(key), `dashboard stats must include ${key}`)
  }
})

test('HotelHome does not swallow all board query failures as empty success', () => {
  assert.ok(!homeJsx.includes(".catch(() => [])"), 'must not blank errors into empty arrays')
  assert.ok(homeJsx.includes('Partial board load') || homeJsx.includes('warnings'), 'must surface partial failures')
  assert.ok(homeJsx.includes('getDashboardStats'), 'must prefer dashboard stats API')
  assert.ok(homeJsx.includes('booking_ledger_estimate') || homeJsx.includes('balanceSource'), 'must label balance source')
})

test('HotelHome exception cards and KPI cards are actionable', () => {
  for (const path of ['/housekeeping', '/maintenance', '/folios', '/checkin-workflow', '/night-audit-enterprise', '/roomgrid']) {
    assert.ok(homeJsx.includes(path), `board must link to ${path}`)
  }
  assert.ok(homeJsx.includes('Dirty-room blockers') || homeJsx.includes('dirtyBlockers'))
  assert.ok(homeJsx.includes('Outstanding balances') || homeJsx.includes('outstandingBalances'))
  assert.ok(homeJsx.includes('Unassigned rooms') || homeJsx.includes('unassignedArrivals'))
})
