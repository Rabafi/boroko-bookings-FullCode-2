import test from 'node:test'
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'

async function businessDate(h) {
  const result = await h.migrator.query(`SELECT to_char(bar_local.current_business_date(), 'YYYY-MM-DD') AS value`)
  return result.rows[0].value
}

test('workforce roster and attendance preserve versioned operational evidence', async (t) => {
  const h = await createHarness(t, { entitlementFeatures: ['bar_growth_multi_outlet', 'bar_accounting_workforce'] })
  const date = await businessDate(h)
  const cashierId = await h.insertStaff('Roster Cashier', 'cashier', ['pos.view', 'pos.manage'])

  const createEnvelope = h.envelope('workforce.shift.schedule', {
    staff_id: cashierId,
    work_date: date,
    starts_at: '10:00',
    ends_at: '18:00',
    break_minutes: 30,
    role_label: 'Bar cashier',
    notes: 'Opening coverage'
  })
  const scheduled = await h.call('cmd_workforce_shift_schedule', createEnvelope)
  assert.equal(scheduled.ok, true, JSON.stringify(scheduled.error))
  assert.equal(scheduled.result.status, 'scheduled')
  assert.equal(scheduled.result.version, 1)
  assert.equal(scheduled.result.scheduled_minutes, 450)
  assert.equal(scheduled.result.display_name, 'Roster Cashier')
  const shiftId = scheduled.result.shift_id

  const replay = await h.call('cmd_workforce_shift_schedule', createEnvelope)
  assert.equal(replay.replayed, true)
  assert.equal(replay.result.shift_id, shiftId)

  const updated = await h.call('cmd_workforce_shift_schedule', h.envelope('workforce.shift.schedule', {
    shift_id: shiftId,
    staff_id: cashierId,
    work_date: date,
    starts_at: '09:00',
    ends_at: '17:00',
    break_minutes: 30,
    role_label: 'Bar cashier',
    expected_version: 1
  }))
  assert.equal(updated.ok, true, JSON.stringify(updated.error))
  assert.equal(updated.result.version, 2)
  assert.equal(updated.result.starts_at, '09:00')
  assert.equal(updated.result.scheduled_minutes, 450)

  const stale = await h.call('cmd_workforce_shift_schedule', h.envelope('workforce.shift.schedule', {
    shift_id: shiftId,
    staff_id: cashierId,
    work_date: date,
    starts_at: '11:00',
    ends_at: '19:00',
    expected_version: 1
  }))
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'WORKFORCE_SHIFT_VERSION_CONFLICT')

  const clockInEnvelope = h.envelope('workforce.clock.in', {
    staff_id: cashierId,
    workforce_shift_id: shiftId,
    note: 'Ready for service'
  })
  const clockedIn = await h.call('cmd_workforce_clock_in', clockInEnvelope)
  assert.equal(clockedIn.ok, true, JSON.stringify(clockedIn.error))
  assert.equal(clockedIn.result.status, 'open')
  assert.equal(clockedIn.result.staff_id, cashierId)
  assert.equal(clockedIn.result.workforce_shift_id, shiftId)
  assert.equal(clockedIn.result.display_name, 'Roster Cashier')
  const attendanceId = clockedIn.result.attendance_id

  const clockInReplay = await h.call('cmd_workforce_clock_in', clockInEnvelope)
  assert.equal(clockInReplay.replayed, true)
  assert.equal(clockInReplay.result.attendance_id, attendanceId)

  const duplicateOpen = await h.call('cmd_workforce_clock_in', h.envelope('workforce.clock.in', {
    staff_id: cashierId
  }))
  assert.equal(duplicateOpen.ok, false)
  assert.equal(duplicateOpen.error.code, 'ATTENDANCE_ALREADY_OPEN')

  const current = await h.query('workforce.attendance.current')
  assert.equal(current.data.length, 1)
  assert.equal(current.data[0].attendance_id, attendanceId)

  const ownerIn = await h.call('cmd_workforce_clock_in', h.envelope('workforce.clock.in', {}))
  assert.equal(ownerIn.ok, true, JSON.stringify(ownerIn.error))
  assert.equal(ownerIn.result.staff_id, h.ownerStaffId)

  const bothCurrent = await h.query('workforce.attendance.current')
  assert.equal(bothCurrent.data.length, 2)

  const ownerOut = await h.call('cmd_workforce_clock_out', h.envelope('workforce.clock.out', {
    attendance_id: ownerIn.result.attendance_id,
    note: 'Owner shift complete'
  }))
  assert.equal(ownerOut.ok, true, JSON.stringify(ownerOut.error))
  assert.equal(ownerOut.result.status, 'closed')
  assert.ok(ownerOut.result.clocked_out_at)

  const clockedOut = await h.call('cmd_workforce_clock_out', h.envelope('workforce.clock.out', {
    attendance_id: attendanceId,
    note: 'Shift complete'
  }))
  assert.equal(clockedOut.ok, true, JSON.stringify(clockedOut.error))
  assert.equal(clockedOut.result.status, 'closed')
  assert.equal(clockedOut.result.clock_out_note, 'Shift complete')
  assert.ok(Number.isInteger(clockedOut.result.minutes_worked))

  const duplicateClose = await h.call('cmd_workforce_clock_out', h.envelope('workforce.clock.out', {
    attendance_id: attendanceId
  }))
  assert.equal(duplicateClose.ok, false)
  assert.equal(duplicateClose.error.code, 'ATTENDANCE_STATE_CONFLICT')

  const roster = await h.query('workforce.roster', { from: date, to: date })
  assert.equal(roster.data.length, 1)
  assert.equal(roster.data[0].shift_id, shiftId)
  assert.equal(roster.data[0].attendance.length, 1)
  assert.equal(roster.data[0].attendance[0].status, 'closed')

  const attendance = await h.query('workforce.attendance.list', { from: date, to: date })
  assert.equal(attendance.data.length, 2)
  assert.equal(attendance.data.every((row) => row.status === 'closed'), true)

  const attendancePage = await h.query('workforce.attendance.list', { from: date, to: date, limit: 1 })
  assert.equal(attendancePage.data.length, 1)
  assert.equal(attendancePage.pagination.has_more, true)
  assert.ok(attendancePage.pagination.next_cursor)
  const attendanceNext = await h.query('workforce.attendance.list', {
    from: date,
    to: date,
    limit: 1,
    cursor: attendancePage.pagination.next_cursor
  })
  assert.equal(attendanceNext.data.length, 1)
  assert.equal(attendanceNext.pagination.has_more, false)
  assert.notEqual(attendanceNext.data[0].attendance_id, attendancePage.data[0].attendance_id)

  const cancelled = await h.call('cmd_workforce_shift_cancel', h.envelope('workforce.shift.cancel', {
    shift_id: shiftId,
    expected_version: 2,
    reason: 'Coverage changed'
  }))
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled.error))
  assert.equal(cancelled.result.status, 'cancelled')
  assert.equal(cancelled.result.version, 3)
  assert.equal(cancelled.result.cancellation_reason, 'Coverage changed')

  const duplicateCancel = await h.call('cmd_workforce_shift_cancel', h.envelope('workforce.shift.cancel', {
    shift_id: shiftId,
    expected_version: 3,
    reason: 'Coverage changed again'
  }))
  assert.equal(duplicateCancel.ok, false)
  assert.equal(duplicateCancel.error.code, 'WORKFORCE_SHIFT_STATE_CONFLICT')

  const editCancelled = await h.call('cmd_workforce_shift_schedule', h.envelope('workforce.shift.schedule', {
    shift_id: shiftId,
    staff_id: cashierId,
    work_date: date,
    starts_at: '12:00',
    ends_at: '20:00',
    expected_version: 3
  }))
  assert.equal(editCancelled.ok, false)
  assert.equal(editCancelled.error.code, 'WORKFORCE_SHIFT_STATE_CONFLICT')

  const clockCancelled = await h.call('cmd_workforce_clock_in', h.envelope('workforce.clock.in', {
    staff_id: cashierId,
    workforce_shift_id: shiftId
  }))
  assert.equal(clockCancelled.ok, false)
  assert.equal(clockCancelled.error.code, 'WORKFORCE_SHIFT_STATE_CONFLICT')

  const cancelledRoster = await h.query('workforce.roster', { from: date, to: date, status: 'cancelled' })
  assert.equal(cancelledRoster.data.length, 1)
  assert.equal(cancelledRoster.data[0].status, 'cancelled')

  const overnight = await h.call('cmd_workforce_shift_schedule', h.envelope('workforce.shift.schedule', {
    staff_id: cashierId,
    work_date: date,
    starts_at: '22:00',
    ends_at: '02:00',
    break_minutes: 30
  }))
  assert.equal(overnight.ok, true, JSON.stringify(overnight.error))
  assert.equal(overnight.result.scheduled_minutes, 210)

  const rosterPage = await h.query('workforce.roster', { from: date, to: date, limit: 1 })
  assert.equal(rosterPage.data.length, 1)
  assert.equal(rosterPage.pagination.has_more, true)
  assert.ok(rosterPage.pagination.next_cursor)
  const rosterNext = await h.query('workforce.roster', {
    from: date,
    to: date,
    limit: 1,
    cursor: rosterPage.pagination.next_cursor
  })
  assert.equal(rosterNext.data.length, 1)
  assert.equal(rosterNext.pagination.has_more, false)
  assert.notEqual(rosterNext.data[0].shift_id, rosterPage.data[0].shift_id)

  const audit = await h.migrator.query(
    `SELECT action FROM bar_local.audit_log WHERE action LIKE 'workforce.%' ORDER BY id`
  )
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'workforce.shift.scheduled',
    'workforce.shift.scheduled',
    'workforce.attendance.clocked_in',
    'workforce.attendance.clocked_in',
    'workforce.attendance.clocked_out',
    'workforce.attendance.clocked_out',
    'workforce.shift.cancelled',
    'workforce.shift.scheduled'
  ])

  await h.runtime.query(
    `SELECT bar_local.service_set_entitlement($1,$2,$3,$4,$5)`,
    [h.ownerTokenHash, h.deviceId, 2, ['bar_growth_multi_outlet'], 'test-key']
  )
  await assert.rejects(
    h.query('workforce.roster', { from: date, to: date }),
    (error) => error.detail === 'ENTITLEMENT_DENIED' || /ENTITLEMENT_DENIED/.test(String(error.message))
  )
})
