import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { evaluateBookingCreationAllowance } from '../src/shared/subscriptionPlans.js'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('only selected check-in month usage blocks booking creation', () => {
  const creationMonthFull = evaluateBookingCreationAllowance({
    plan: 'Starter',
    targetMonthUsed: 4,
    createdMonthUsed: 122
  })
  assert.equal(creationMonthFull.isBlocked, false)
  assert.equal(creationMonthFull.blockReason, null)
  assert.equal(creationMonthFull.creationMonthStatus.isBlocked, false)
  assert.equal(creationMonthFull.creationMonthStatus.enforced, false)
  assert.equal(creationMonthFull.creationMonthStatus.badgeLabel, 'Informational only')

  const selectedMonthFull = evaluateBookingCreationAllowance({
    plan: 'Starter',
    targetMonthUsed: 122,
    createdMonthUsed: 4
  })
  assert.equal(selectedMonthFull.isBlocked, true)
  assert.equal(selectedMonthFull.blockReason, 'target_month')
})

test('desktop enforcement uses check-in month and preflights multi-room units', async () => {
  const usageDomain = await read('src/main/domains/usage.js')
  const bookingsDomain = await read('src/main/domains/bookings.js')

  assert.match(bookingsDomain, /monthDate:\s*data\?\.check_in\s*\?\s*new Date\(data\.check_in\)/)
  assert.match(bookingsDomain, /requestedUnits:\s*roomLines\.length/)
  assert.match(usageDomain, /used \+ requestedUnits > effectiveLimit/)
  assert.match(usageDomain, /selected check-in month/)
})

test('database serializes and enforces selected check-in month acquisitions only', async () => {
  const sql = await read('supabase/migrations/20260828090000_booking_check_in_month_usage_enforcement.sql')

  assert.match(sql, /new\.created_at := now\(\)/)
  assert.match(sql, /v_target_month_start := date_trunc\('month', new\.check_in::timestamp\)::date/)
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock/)
  assert.match(sql, /b\.check_in >= v_target_month_start/)
  assert.match(sql, /Booking limit reached for the selected check-in month/)
  assert.match(sql, /v_booking_limit := 120/)
  assert.match(sql, /v_booking_limit := 400/)
  assert.match(sql, /v_booking_limit := 600/)
  assert.doesNotMatch(sql, /if v_plan = 'Pro' then\s+return new/)
  assert.match(sql, /before insert or update of status, check_in, lodge_id, is_exclusive_event on public\.bookings/)
  assert.match(sql, /old\.lodge_id is not distinct from new\.lodge_id/)
  assert.doesNotMatch(sql, /v_creation_month/)
  assert.doesNotMatch(sql, /b\.created_at\s*[<>]=?\s*v_/)
  assert.doesNotMatch(sql, /Monthly booking creation limit reached/)
})
