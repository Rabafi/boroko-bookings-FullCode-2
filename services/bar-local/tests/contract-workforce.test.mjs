import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CAPABILITIES, COMMANDS, QUERIES } from '@tsa-bonno/bar-contracts'

test('workforce contracts are staff-managed and version roster edits', () => {
  for (const name of ['workforce.shift.schedule', 'workforce.shift.cancel', 'workforce.clock.in', 'workforce.clock.out']) {
    assert.equal(COMMANDS[name].version, 1)
    assert.equal(COMMANDS[name].capability, CAPABILITIES.STAFF_MANAGE)
    assert.equal(COMMANDS[name].approval, null)
  }
  for (const name of ['workforce.roster', 'workforce.attendance.list', 'workforce.attendance.current']) {
    assert.equal(QUERIES[name].capability, CAPABILITIES.STAFF_MANAGE)
  }
  const recoveryShiftId = randomUUID()
  const reversal = COMMANDS['workforce.tip.payout.reverse'].validate({
    payout_id: randomUUID(), recovery_shift_id: recoveryShiftId, reason: 'Closed drawer correction'
  })
  assert.equal(reversal.recovery_shift_id, recoveryShiftId)
  assert.throws(() => COMMANDS['workforce.tip.payout.reverse'].validate({
    payout_id: randomUUID(), recovery_shift_id: 'other outlet', reason: 'Closed drawer correction'
  }), /recovery_shift_id/)

  const staffId = randomUUID()
  const created = COMMANDS['workforce.shift.schedule'].validate({
    staff_id: staffId,
    work_date: '2026-10-20',
    starts_at: '18:00',
    ends_at: '02:00'
  })
  assert.equal(created.shift_id, null)
  assert.equal(created.expected_version, null)
  assert.equal(created.break_minutes, 0)

  const updated = COMMANDS['workforce.shift.schedule'].validate({
    shift_id: randomUUID(),
    staff_id: staffId,
    work_date: '2026-10-20',
    starts_at: '18:00',
    ends_at: '02:00',
    break_minutes: 30,
    expected_version: 2
  })
  assert.equal(updated.expected_version, 2)
  assert.equal(updated.break_minutes, 30)
  assert.throws(() => COMMANDS['workforce.shift.schedule'].validate({
    shift_id: randomUUID(),
    staff_id: staffId,
    work_date: '2026-10-20',
    starts_at: '18:00',
    ends_at: '02:00'
  }), /expected_version/)
  assert.throws(() => COMMANDS['workforce.shift.schedule'].validate({
    staff_id: staffId,
    work_date: '2026-10-20',
    starts_at: '25:00',
    ends_at: '02:00'
  }), /starts_at/)
  assert.throws(() => COMMANDS['workforce.shift.schedule'].validate({
    staff_id: staffId,
    work_date: '2026-10-20',
    starts_at: '09:00',
    ends_at: '09:00'
  }), /ends_at/)

  assert.throws(() => COMMANDS['workforce.shift.cancel'].validate({
    shift_id: randomUUID(), expected_version: 1, reason: ''
  }), /reason/)

  const clockIn = COMMANDS['workforce.clock.in'].validate({})
  assert.equal(clockIn.staff_id, null)
  assert.equal(clockIn.workforce_shift_id, null)
  assert.equal(clockIn.trading_shift_id, null)

  const clockOut = COMMANDS['workforce.clock.out'].validate({
    attendance_id: randomUUID(), note: 'End of shift'
  })
  assert.equal(clockOut.note, 'End of shift')
})
