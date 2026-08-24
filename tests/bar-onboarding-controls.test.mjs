import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('Bar setup readiness requires staff identity, a completed shift, and verified devices', () => {
  const screen = read('src/renderer/src/components/hospitality-pos/HposSetupReadiness.jsx')
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx')
  const profile = read('src/shared/barModeProfile.js')
  const migration = read('supabase/migrations/20260820110000_bar_setup_readiness_controls.sql')

  assert.match(screen, /staff_accounts/)
  assert.match(screen, /staff_roles/)
  assert.match(screen, /staff_pins/)
  assert.match(screen, /first_completed_shift/)
  assert.match(screen, /hardware_last_test_success === true/)
  assert.match(screen, /hpos\/system-health\?tab=devices/)
  assert.match(health, /requestedTab = searchParams\.get\('tab'\)/)
  assert.match(health, /requestedTab === 'audit' && canAudit/)
  assert.match(profile, /'first_completed_shift'/)
  assert.match(migration, /restaurant_shifts/)
  assert.match(migration, /status = 'completed'/)
  assert.match(migration, /Every active staff account has a role assignment/)
})

test('hardware verification fields cannot be self-attested by renderer settings', () => {
  const domain = read('src/main/domains/pos.js')
  const adapter = read('src/main/hardware/posHardwareAdapter.js')
  const main = read('src/main/index.js')
  assert.match(domain, /Verification fields are written only by the trusted main-process hardware\s+\/\/ test event below/)
  assert.match(domain, /hardware_last_test_success: details\.success === true/)
  assert.match(domain, /hardware_last_test_success: _ignoredSuccess/)
  assert.match(adapter, /verified: false/)
  assert.match(adapter, /success: true, verified: true/)
  assert.match(adapter, /no receipt was sent/)
  assert.match(main, /result\.success === true && result\.verified === true/)
})

test('daily close uses detected checklist state and protected Bar clock-out uses the PIN RPC', () => {
  const close = read('src/renderer/src/components/restaurant/RestaurantDailyClose.jsx')
  const team = read('src/renderer/src/components/hospitality-pos/HposTeam.jsx')
  assert.doesNotMatch(close, /checklistsComplete: true\s*\n\s*\}/)
  assert.match(close, /window\.api\.pos\.getChecklists\(\)/)
  assert.match(close, /operationalChecklists\.every/)
  assert.match(close, /!barOnly && checklistsComplete !== true/)
  assert.match(close, /if \(!barOnly && checklistsComplete !== true\) reasons\.push/)
  assert.match(team, /clockOutStaffWithAttendancePin/)
  assert.match(team, /setClockOutTarget\(\{ shift, idempotencyKey: crypto\.randomUUID\(\) \}\)/)
  assert.match(team, /idempotency_key: clockOutTarget\.idempotencyKey/)
  assert.match(team, /Private attendance PIN/)
  assert.match(team, /On-shift team/)
  assert.doesNotMatch(team, /clockOutStaff\?\.\(/)
})
