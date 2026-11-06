import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLocalHposTeam } from '../../src/renderer/src/components/hospitality-pos/bar-local/hposTeamLocalApi.js'

const scope = { outletId: 'outlet-1', staffId: 'manager-1' }
const envelope = (data, outletId = 'outlet-1') => ({ data, complete: true,
  pagination: { has_more: false, next_cursor: null },
  scope: { business_id: 'business-1', outlet_id: outletId, actor_staff_id: 'manager-1', role: 'manager', device_id: 'device-1' } })

test('Team board reads scoped staff and active attendance from the local service', async () => {
  const calls = []
  const result = await loadLocalHposTeam({
    async query(name, filters) {
      calls.push([name, filters])
      if (name === 'staff.list') return envelope([
        { staff_id: 'manager-1', display_name: 'Manager', role: 'manager', status: 'active', version: 1 },
        { staff_id: 'old-1', display_name: 'Old account', role: 'cashier', status: 'suspended', version: 2 }
      ])
      return envelope([{ attendance_id: 'attendance-1', staff_id: 'cashier-1', display_name: 'Cashier',
        staff_role: 'cashier', clocked_in_at: '2026-11-05T08:00:00Z', status: 'open' }])
    }
  }, scope)
  assert.deepEqual(calls, [['staff.list', { include_suspended: false }], ['workforce.attendance.current', { outlet_id: 'outlet-1' }]])
  assert.deepEqual(result.staff, [{ id: 'manager-1', name: 'Manager', role: 'manager', status: 'active', version: 1 }])
  assert.deepEqual(result.shifts, [{ id: 'attendance-1', staff_user_id: 'cashier-1', staff_name: 'Cashier',
    role: 'cashier', clock_in: '2026-11-05T08:00:00Z', status: 'open' }])
})

test('Team board fails closed on partial, wrong-scope or malformed workforce data', async () => {
  const mismatched = { query: async (name) => name === 'staff.list'
    ? envelope([]) : envelope([], 'outlet-2') }
  await assert.rejects(loadLocalHposTeam(mismatched, scope), /incomplete staff or attendance data/)
  const partial = { query: async (name) => ({ ...envelope([]), complete: name !== 'staff.list' }) }
  await assert.rejects(loadLocalHposTeam(partial, scope), /incomplete staff or attendance data/)
  const malformed = { query: async (name) => envelope(name === 'staff.list' ? [{ staff_id: 'x', display_name: 'X', role: 'untrusted', status: 'active' }] : []) }
  await assert.rejects(loadLocalHposTeam(malformed, scope), /invalid staff row/)
})
