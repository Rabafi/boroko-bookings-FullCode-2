import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const migration = readFileSync('supabase/migrations/20260917000000_clockout_pin_anon_grant.sql', 'utf8')
const posDomain = readFileSync('src/main/domains/pos.js', 'utf8')
const shiftClose = readFileSync('src/renderer/src/components/hospitality-pos/HposSharedShiftClose.jsx', 'utf8')
const kiosk = readFileSync('src/renderer/src/components/hospitality-pos/HposAttendanceKiosk.jsx', 'utf8')
const sharedCashup = readFileSync('src/renderer/src/components/hospitality-pos/HposSharedCashup.jsx', 'utf8')
const myCashup = readFileSync('src/renderer/src/components/hospitality-pos/HposMyCashup.jsx', 'utf8')
const myShift = readFileSync('src/renderer/src/components/hospitality-pos/HposMyShift.jsx', 'utf8')

test('clock-out anon grant is restored without redefining the function', () => {
  assert.match(migration, /grant execute on function public\.clock_out_staff_with_attendance_pin\(jsonb\)/)
  assert.match(migration, /to anon, authenticated, service_role/)
  assert.doesNotMatch(migration, /create or replace function/i, 'grant-only file must not redefine the RPC')
  assert.doesNotMatch(migration, /revoke all/i, 'restoring a dropped grantee needs no revoke')
})

test('attendance PIN clock in/out map a bare permission-denied into recovery guidance', () => {
  assert.match(posDomain, /withAttendancePermissionGuidance/)
  assert.match(posDomain, /permission denied for function/i)
  assert.match(posDomain, /Your shift stays open and any cash-up is kept/)
  assert.match(posDomain, /withAttendancePermissionGuidance\(error\.message, 'in'\)/)
  assert.match(posDomain, /withAttendancePermissionGuidance\(error\.message, 'out'\)/)
})

test('shift and cash-up screens bring a new error into view instead of hiding it above the card', () => {
  for (const [label, source] of [
    ['shift-close', shiftClose],
    ['kiosk', kiosk],
    ['shared-cashup', sharedCashup],
    ['my-cashup', myCashup],
    ['my-shift', myShift],
  ]) {
    assert.match(source, /errorAnchorRef/, `${label} tracks an error anchor`)
    assert.match(source, /scrollIntoView\(\{ behavior: 'smooth', block: 'center' \}\)/, `${label} scrolls to the error`)
    assert.match(source, /tabIndex=\{-1\}/, `${label} focuses the error for assistive tech`)
  }
  assert.match(shiftClose, /data-testid="shared-shift-close-error-anchor"/)
  assert.match(kiosk, /data-testid="attendance-kiosk-error-anchor"/)
  assert.match(sharedCashup, /data-testid="shared-cashup-error-anchor"/)
  assert.match(myCashup, /data-testid="my-cashup-error-anchor"/)
  assert.match(myShift, /data-testid="my-shift-error-anchor"/)
})
