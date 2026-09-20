import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('offline Till replay remaps operator proofs before the shift id', () => {
  const sql = read('supabase/migrations/20260914000000_fix_offline_till_proof_remap.sql')
  assert.match(sql, /create or replace function public\.activate_shared_till_operator_offline/i)
  assert.match(sql, /pos_till_operator_proofs/i)
  assert.match(
    sql,
    /update public\.pos_till_operator_proofs set pos_shift_id\s*=\s*v_requested[\s\S]*update public\.pos_shifts set id\s*=\s*v_requested/i
  )
  assert.match(sql, /already_open/i)
  assert.match(sql, /remap_skipped/i)
  assert.match(sql, /security definer/i)
  assert.match(sql, /search_path\s*=\s*public/i)
  assert.doesNotMatch(sql, /drop\s+table/i)
  assert.doesNotMatch(sql, /\bdelete\s+from\s+public\.pos_shifts/i)
  assert.match(sql, /revoke all on function public\.activate_shared_till_operator_offline/i)
  assert.match(sql, /grant execute on function public\.activate_shared_till_operator_offline/i)
})

test('offline Till replay never remaps a pre-existing open shift', () => {
  const sql = read('supabase/migrations/20260914000000_fix_offline_till_proof_remap.sql')
  assert.match(sql, /create_idempotency_key is distinct from v_key/i)
  assert.match(sql, /The Till shift could not be confirmed/i)
})

test('offline Till unlock refuses a duplicate open for the same staff and outlet', () => {
  const pos = read('src/main/domains/pos.js')
  assert.match(pos, /never queue a duplicate Till open/i)
  assert.match(pos, /existingOpenTill/i)
  assert.match(pos, /already_open:\s*true,\s*offline:\s*true/)
  assert.match(pos, /activate_shared_till_operator_offline/)
})

test('offline clock-in with a pending clock-out fails closed instead of queuing', () => {
  const pos = read('src/main/domains/pos.js')
  assert.match(pos, /optimistic local clock-out still pending sync/i)
  assert.match(pos, /clockout_pending/)
  assert.match(pos, /still syncing\. Wait for sync before clocking in again/i)
})

test('offline clock-out mirrors the cash-up guard before mutating cache', () => {
  const pos = read('src/main/domains/pos.js')
  assert.match(pos, /Offline fail-closed mirror of the server cash-up guard/i)
  assert.match(pos, /localOpenTill/)
  assert.match(pos, /Submit My Cash-up before clocking out/)
  // The local completed-flip must only happen after the cash-up check
  // inside clockOutStaffWithAttendancePin.
  const start = pos.indexOf('export async function clockOutStaffWithAttendancePin')
  assert.ok(start >= 0)
  const end = pos.indexOf('export async function', start + 10)
  const fn = pos.slice(start, end > start ? end : undefined)
  assert.ok(fn.indexOf('localOpenTill') >= 0)
  assert.ok(fn.indexOf('localOpenTill') < fn.indexOf("status: 'completed'"))
})

test('queue replay can still reattribute sales to the current open shift', () => {
  const shared = read('src/main/domains/syncShared.js')
  assert.match(shared, /export function resolveCurrentOpenShiftId/)
  const infra = read('src/main/domains/infrastructure.js')
  assert.match(infra, /resolveCurrentOpenShiftId/)
})

test('offline clock-out waits for its provisional cash-up in the replay order', () => {
  const pos = read('src/main/domains/pos.js')
  const start = pos.indexOf('export async function clockOutStaffWithAttendancePin')
  assert.ok(start >= 0)
  const end = pos.indexOf('export async function', start + 10)
  const fn = pos.slice(start, end > start ? end : undefined)
  // Without an explicit dependency the clock-out could replay before its own
  // provisional cash-up and dead-letter while the cash-up still queues.
  assert.match(fn, /provisionalCashupQueueId/)
  assert.match(fn, /_depends_on_all/)
  assert.ok(fn.indexOf('provisionalCashupQueueId') < fn.indexOf("queueOperation('rpc', 'clock_out_staff_with_attendance_pin'"))
})
