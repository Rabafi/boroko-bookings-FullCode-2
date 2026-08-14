import { readFileSync } from 'fs'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
const migration = read('supabase/migrations/20260714210000_staff_scheduling_and_attendance.sql')

const indexJs = read('src/main/index.js')
const preloadJs = read('src/preload/index.js')
const databaseJs = read('src/main/database.js')

describe('Staff Scheduling & Attendance', () => {
  describe('SQL Migration', () => {
    it('creates staff_schedules table', () => {
      assert.match(migration, /CREATE TABLE.*staff_schedules/)
    })
    it('creates staff_attendance table', () => {
      assert.match(migration, /CREATE TABLE.*staff_attendance/)
    })
    it('creates staff_leave table', () => {
      assert.match(migration, /CREATE TABLE.*staff_leave/)
    })
    it('creates get_staff_schedule RPC', () => {
      assert.match(migration, /get_staff_schedule/)
    })
    it('creates get_staff_schedule_range RPC', () => {
      assert.match(migration, /get_staff_schedule_range/)
    })
    it('creates upsert_staff_schedule RPC', () => {
      assert.match(migration, /upsert_staff_schedule/)
    })
    it('creates delete_staff_schedule_entry RPC', () => {
      assert.match(migration, /delete_staff_schedule_entry/)
    })
    it('creates clock_in_staff_hotel RPC', () => {
      assert.match(migration, /clock_in_staff_hotel/)
    })
    it('creates clock_out_staff_hotel RPC', () => {
      assert.match(migration, /clock_out_staff_hotel/)
    })
    it('creates get_staff_attendance_today RPC', () => {
      assert.match(migration, /get_staff_attendance_today/)
    })
    it('creates get_staff_attendance_range RPC', () => {
      assert.match(migration, /get_staff_attendance_range/)
    })
    it('creates get_staff_attendance_dashboard RPC', () => {
      assert.match(migration, /get_staff_attendance_dashboard/)
    })
    it('creates request_staff_leave RPC', () => {
      assert.match(migration, /request_staff_leave/)
    })
    it('creates approve_staff_leave RPC', () => {
      assert.match(migration, /approve_staff_leave/)
    })
    it('creates get_staff_leave_requests RPC', () => {
      assert.match(migration, /get_staff_leave_requests/)
    })
    it('enables RLS on all tables', () => {
      const rlsCount = (migration.match(/ENABLE ROW LEVEL SECURITY/g) || []).length
      assert.ok(rlsCount >= 3, `Expected at least 3 RLS statements, found ${rlsCount}`)
    })
    it('grants EXECUTE to authenticated on all RPCs', () => {
      const grantCount = (migration.match(/GRANT EXECUTE/g) || []).length
      assert.ok(grantCount >= 12, `Expected at least 12 GRANT EXECUTE statements, found ${grantCount}`)
    })
    it('uses app_require_feature in all RPCs', () => {
      const roleCheckCount = (migration.match(/app_require_feature/g) || []).length
      assert.ok(roleCheckCount >= 12, `Expected at least 12 app_require_feature calls, found ${roleCheckCount}`)
    })
    it('has SECURITY DEFINER on all RPCs', () => {
      const securityDefinerCount = (migration.match(/SECURITY DEFINER/g) || []).length
      assert.ok(securityDefinerCount >= 12, `Expected at least 12 SECURITY DEFINER, found ${securityDefinerCount}`)
    })
    it('no placeholder patterns remain', () => {
      assert.doesNotMatch(migration, /TODO|FIXME|placeholder|replace_me/i)
    })
  })

  describe('IPC Handlers', () => {
    it('registers staffScheduling:getSchedule handler', () => {
      assert.match(indexJs, /staffScheduling:getSchedule/)
    })
    it('registers staffScheduling:getScheduleRange handler', () => {
      assert.match(indexJs, /staffScheduling:getScheduleRange/)
    })
    it('registers staffScheduling:upsertSchedule handler', () => {
      assert.match(indexJs, /staffScheduling:upsertSchedule/)
    })
    it('registers staffScheduling:deleteEntry handler', () => {
      assert.match(indexJs, /staffScheduling:deleteEntry/)
    })
    it('registers staffScheduling:getAttendanceToday handler', () => {
      assert.match(indexJs, /staffScheduling:getAttendanceToday/)
    })
    it('registers staffScheduling:getAttendanceRange handler', () => {
      assert.match(indexJs, /staffScheduling:getAttendanceRange/)
    })
    it('registers staffScheduling:getAttendanceDashboard handler', () => {
      assert.match(indexJs, /staffScheduling:getAttendanceDashboard/)
    })
    it('registers staffScheduling:clockIn handler', () => {
      assert.match(indexJs, /staffScheduling:clockIn/)
    })
    it('registers staffScheduling:clockOut handler', () => {
      assert.match(indexJs, /staffScheduling:clockOut/)
    })
    it('registers staffScheduling:getLeaveRequests handler', () => {
      assert.match(indexJs, /staffScheduling:getLeaveRequests/)
    })
    it('registers staffScheduling:requestLeave handler', () => {
      assert.match(indexJs, /staffScheduling:requestLeave/)
    })
    it('registers staffScheduling:approveLeave handler', () => {
      assert.match(indexJs, /staffScheduling:approveLeave/)
    })
    it('requires manager/admin/super_admin role for upsertSchedule', () => {
      assert.match(indexJs, /requireRole\('manager', 'admin', 'super_admin'\)/)
    })
    it('requires staff.manage capability for mutation handlers', () => {
      const manageCount = (indexJs.match(/requireCapability\('staff\.manage'\)/g) || []).length
      assert.ok(manageCount >= 5, `Expected at least 5 staff.manage capability checks, found ${manageCount}`)
    })
  })

  describe('Preload Bridge', () => {
    it('exports staffScheduling section', () => {
      assert.match(preloadJs, /staffScheduling:/)
    })
    it('has getSchedule method', () => {
      assert.match(preloadJs, /getSchedule:/)
    })
    it('has upsertSchedule method', () => {
      assert.match(preloadJs, /upsertSchedule:/)
    })
    it('has clockIn method', () => {
      assert.match(preloadJs, /clockIn:/)
    })
    it('has getLeaveRequests method', () => {
      assert.match(preloadJs, /getLeaveRequests:/)
    })
    it('has requestLeave method', () => {
      assert.match(preloadJs, /requestLeave:/)
    })
    it('has approveLeave method', () => {
      assert.match(preloadJs, /approveLeave:/)
    })
  })

  describe('Database Facade', () => {
    it('re-exports getStaffSchedule', () => {
      assert.match(databaseJs, /getStaffSchedule/)
    })
    it('re-exports getStaffScheduleRange', () => {
      assert.match(databaseJs, /getStaffScheduleRange/)
    })
    it('re-exports upsertStaffSchedule', () => {
      assert.match(databaseJs, /upsertStaffSchedule/)
    })
    it('re-exports getStaffAttendanceToday', () => {
      assert.match(databaseJs, /getStaffAttendanceToday/)
    })
    it('re-exports clockInStaffHotel', () => {
      assert.match(databaseJs, /clockInStaffHotel/)
    })
    it('re-exports getStaffLeaveRequests', () => {
      assert.match(databaseJs, /getStaffLeaveRequests/)
    })
    it('re-exports requestStaffLeave', () => {
      assert.match(databaseJs, /requestStaffLeave/)
    })
    it('re-exports approveStaffLeave', () => {
      assert.match(databaseJs, /approveStaffLeave/)
    })
  })

  describe('Domain Module', () => {
    it('staffScheduling domain file exists', () => {
      try {
        read('src/main/domains/staffScheduling.js')
        assert.ok(true)
      } catch {
        assert.ok(false, 'staffScheduling.js not found')
      }
    })
  })
})
