import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const actorMigration = readFileSync(
  new URL('../supabase/migrations/20260714247000_actor_identity_and_workforce_integrity.sql', import.meta.url),
  'utf8'
).toLowerCase()
const uniqueMigration = readFileSync(
  new URL('../supabase/migrations/20260714248000_event_settlement_unique_invariant.sql', import.meta.url),
  'utf8'
).toLowerCase()
const eventsDomain = readFileSync(new URL('../src/main/domains/events.js', import.meta.url), 'utf8')

test('workforce and financial actor foreign keys use public.users', () => {
  for (const constraint of [
    'staff_schedules_staff_id_fkey',
    'staff_attendance_staff_id_fkey',
    'staff_leave_staff_id_fkey',
    'event_settlements_settled_by_fkey',
    'financial_ledger_created_by_fkey'
  ]) {
    const start = actorMigration.indexOf(`add constraint ${constraint}`)
    assert.notEqual(start, -1, `${constraint} must be recreated`)
    assert.match(actorMigration.slice(start, start + 220), /references public\.users\(id\)/)
  }
  assert.doesNotMatch(actorMigration, /references auth\.users\(id\)/)
})

test('existing actor IDs are translated through auth_user_id without deleting rows', () => {
  assert.match(actorMigration, /u\.auth_user_id = s\.staff_id/)
  assert.match(actorMigration, /u\.auth_user_id = a\.staff_id/)
  assert.match(actorMigration, /u\.auth_user_id = l\.staff_id/)
  assert.match(actorMigration, /raise exception 'cannot migrate staff_schedules/)
  assert.doesNotMatch(actorMigration, /delete\s+from\s+public\.(staff_|event_settlements|financial_ledger)/)
})

test('clock-in compares and records canonical application user IDs', () => {
  const fn = actorMigration.match(/create or replace function public\.enforce_self_clock_in\(\)[\s\S]*?\n\$\$;/)?.[0] || ''
  assert.match(fn, /v_actor_id uuid := public\.app_current_user_id\(\)/)
  assert.match(fn, /new\.clocked_in_by := v_actor_id/)
  assert.match(fn, /v_actor_id = new\.staff_id/)
  assert.doesNotMatch(fn, /auth\.uid\(\)/)
})

test('package replay is claimed before terminal-state rejection', () => {
  const fn = actorMigration.match(/create or replace function public\.apply_venue_package_to_event\([\s\S]*?\n\$\$;/)?.[0] || ''
  const claim = fn.indexOf('_claim_financial_operation')
  const replay = fn.indexOf("v_claim->>'found'")
  const terminal = fn.indexOf("in ('completed', 'cancelled')")
  assert.ok(claim > 0 && replay > claim && terminal > replay)
  assert.match(fn, /for update/)
  assert.match(fn, /idempotency key must be 8 to 128 characters/)
})

test('package client requires and forwards a stable intent key', () => {
  const start = eventsDomain.indexOf('export async function applyVenuePackageToEvent')
  const fn = eventsDomain.slice(start, eventsDomain.indexOf('\n}\n', start) + 3)
  assert.match(fn, /intentKey\.length < 8 \|\| intentKey\.length > 128/)
  assert.match(fn, /p_idempotency_key: intentKey/)
  assert.doesNotMatch(fn, /Date\.now\(\)/)
})

test('settlement uniqueness migration aborts on duplicates before adding constraint', () => {
  const duplicateAudit = uniqueMigration.indexOf('having count(*) > 1')
  const addConstraint = uniqueMigration.indexOf('add constraint event_settlements_unique_event')
  assert.ok(duplicateAudit > 0 && addConstraint > duplicateAudit)
  assert.match(uniqueMigration, /unique \(lodge_id, event_booking_id\)/)
  assert.doesNotMatch(uniqueMigration, /delete\s+from\s+public\.event_settlements/)
})

