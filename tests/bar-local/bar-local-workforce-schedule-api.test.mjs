import test from 'node:test'
import assert from 'node:assert/strict'
import { createBarLocalWorkforceScheduleApi } from '../../src/renderer/src/components/restaurant/barLocalWorkforceScheduleApi.js'

const scope = {
  businessId: '11111111-1111-4111-8111-111111111111',
  outletId: '22222222-2222-4222-8222-222222222222',
  staffId: '33333333-3333-4333-8333-333333333333'
}
const targetStaff = '44444444-4444-4444-8444-444444444444'
const shiftId = '55555555-5555-4555-8555-555555555555'
const envelope = (data) => ({ data, complete: true, unavailable: [], snapshot_watermark: 4,
  pagination: { has_more: false, next_cursor: null },
  scope: { business_id: scope.businessId, outlet_id: scope.outletId, actor_staff_id: scope.staffId } })
const memoryStorage = () => {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key) }
}

test('original roster adapter reads complete scoped staff and scheduled shifts', async () => {
  const calls = []
  const api = createBarLocalWorkforceScheduleApi({
    async command() { return { outcome: 'committed_local' } },
    async query(name, filters) {
      calls.push([name, filters])
      return name === 'staff.list'
        ? envelope([{ staff_id: targetStaff, display_name: 'Bartender', status: 'active', role: 'bartender' }])
        : envelope([{ shift_id: shiftId, staff_id: targetStaff, display_name: 'Bartender', work_date: '2026-11-16',
          starts_at: '10:00', ends_at: '18:00', status: 'scheduled', version: 2, role_label: 'Bar lead', notes: null }])
    }
  }, scope)
  const result = await api.load(memoryStorage(), '2026-11-16', '2026-11-22')
  assert.deepEqual(calls, [['staff.list', { include_suspended: false }],
    ['workforce.roster', { from: '2026-11-16', to: '2026-11-22', status: 'scheduled', limit: 200 }]])
  assert.deepEqual(result.staff, [{ id: targetStaff, name: 'Bartender', status: 'active', role: 'bartender' }])
  assert.deepEqual(result.rows, [{ id: shiftId, staff_id: targetStaff, staff_name: 'Bartender', schedule_date: '2026-11-16',
    start_time: '10:00', end_time: '18:00', role_at_shift: 'Bar lead', notes: '', status: 'scheduled', version: 2 }])
})

test('roster adapter rejects incomplete, foreign-scope and over-limit snapshots', async () => {
  for (const query of [
    async () => ({ ...envelope([]), complete: false }),
    async (name) => ({ ...envelope([]), scope: { ...envelope([]).scope, outlet_id: name === 'staff.list' ? scope.outletId : '66666666-6666-4666-8666-666666666666' } }),
    async (name) => ({ ...envelope([]), pagination: { has_more: name === 'workforce.roster', next_cursor: 'more' } })
  ]) {
    const api = createBarLocalWorkforceScheduleApi({ query, command() {} }, scope)
    await assert.rejects(api.load(memoryStorage(), '2026-11-16', '2026-11-22'), /incomplete or belongs to a different Bar session|exceeds the safe result limit/)
  }
})

test('schedule ambiguity persists and retries the identical local operation', async () => {
  const storage = memoryStorage()
  const commands = []
  let outcome = 'uncertain'
  const api = createBarLocalWorkforceScheduleApi({
    query() {},
    async getOpenIntents() { return [] },
    async command(command) { commands.push(command); return { outcome } }
  }, scope)
  const payload = { staff_id: targetStaff, work_date: '2026-11-16', starts_at: '10:00', ends_at: '18:00', role_label: 'Bar lead', notes: '' }
  await assert.rejects(api.schedule(storage, payload), /result is uncertain/)
  const saved = JSON.parse([...Array(1)].map(() => storage.getItem(`bar-local:workforce-roster:${scope.businessId}:${scope.outletId}:${scope.staffId}:pending`))[0])
  assert.equal(saved.command, 'workforce.shift.schedule')
  outcome = 'committed_local'
  await api.retry(storage)
  assert.equal(storage.getItem(`bar-local:workforce-roster:${scope.businessId}:${scope.outletId}:${scope.staffId}:pending`), null)
  assert.deepEqual(commands.map(({ operation_id, payload: body }) => [operation_id, body]), [
    [saved.operation_id, saved.payload], [saved.operation_id, saved.payload]
  ])
})

test('cancel uses the current row version, requires a reason, and validates local scope', async () => {
  const commands = []
  const api = createBarLocalWorkforceScheduleApi({ query() {}, async getOpenIntents() { return [] },
    async command(command) { commands.push(command); return { outcome: 'committed_local' } } }, scope)
  const storage = memoryStorage()
  assert.throws(() => api.cancel(storage, { id: shiftId, version: 3 }, '  '), /reason of 1–500 characters/)
  await api.cancel(storage, { id: shiftId, version: 3 }, 'Staff member unavailable')
  assert.equal(commands[0].command, 'workforce.shift.cancel')
  assert.deepEqual(commands[0].payload, { shift_id: shiftId, expected_version: 3, reason: 'Staff member unavailable' })
  assert.throws(() => createBarLocalWorkforceScheduleApi({ query() {}, command() {} }, { ...scope, outletId: 'bad' }), /could not be verified/)
})
