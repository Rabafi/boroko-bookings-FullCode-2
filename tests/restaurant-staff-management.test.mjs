import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const staffPage = readFileSync('src/renderer/src/components/Staff.jsx', 'utf8')
const sharedModal = readFileSync('src/renderer/src/components/shared/Modal.jsx', 'utf8')
const main = readFileSync('src/main/index.js', 'utf8')
const preload = readFileSync('src/preload/index.js', 'utf8')
const authUsers = readFileSync('src/main/domains/authUsers.js', 'utf8')
const migration = readFileSync('supabase/migrations/20260715015000_staff_access_audit_and_manager_scope.sql', 'utf8')
const statusFeedbackMigration = readFileSync('supabase/migrations/20260715016000_staff_login_status_feedback.sql', 'utf8')
const authLogin = readFileSync('src/main/domains/authLogin.js', 'utf8')

describe('Restaurant staff management', () => {
  it('uses restaurant service-team labels and removes hotel-only roles from its route', () => {
    assert.match(staffPage, /Waiter \/ till operator/)
    assert.match(staffPage, /Service supervisor/)
    assert.match(staffPage, /hasHotelRoles && !restaurantMode/)
  })

  it('guides outlet-scoped staff setup instead of allowing a dead-end account', () => {
    assert.match(staffPage, /Set up an outlet before assigning service access/)
    assert.match(staffPage, /navigate\('\/multi-outlet-pos'\)/)
    assert.match(staffPage, /Outlet access is still loading/)
  })

  it('keeps the long staff setup form usable in a normal desktop window', () => {
    assert.match(staffPage, /footer=\{\(/)
    assert.match(staffPage, /form="staff-member-form"/)
    assert.match(staffPage, /Custom permission exceptions/)
    assert.match(sharedModal, /max-h-\[calc\(100dvh-1\.5rem\)\]/)
    assert.match(sharedModal, /overflow-y-auto overscroll-contain/)
  })

  it('shows a server-backed staff access audit, not a clearable local activity log', () => {
    assert.match(staffPage, /Server-backed access audit/)
    assert.match(staffPage, /window\.api\.users\.getAccessAudit\(\)/)
    assert.match(preload, /getAccessAudit: \(\) => ipcRenderer\.invoke\('users:getAccessAudit'\)/)
    assert.match(main, /ipcMain\.handle\('users:getAccessAudit'/)
    assert.match(authUsers, /export async function getStaffAccessAudit/)
  })

  it('keeps manager access useful without allowing privilege escalation', () => {
    assert.match(main, /requireRole\('manager', 'admin', 'super_admin'\)/)
    assert.match(main, /assertManagerStaffScope/)
    assert.match(authUsers, /Managers can manage service-team accounts only/)
    assert.match(migration, /v_role not in \('cashier', 'supervisor', 'receptionist', 'operations'\)/)
    assert.match(migration, /Managers cannot set custom permission exceptions/)
  })

  it('keeps staff account changes authoritative, scoped, and secret-safe', () => {
    assert.match(migration, /create table if not exists public\.staff_access_audit/)
    assert.match(migration, /create trigger staff_access_audit_users_trigger/)
    assert.match(migration, /array\['password_hash', 'pin_hash', 'pwa_password_hash'\]/)
    assert.match(migration, /Every selected outlet must belong to this business/)
    assert.match(migration, /Archive the staff account before permanently deleting it/)
    assert.match(migration, /You cannot remove or archive the last admin in this business/)
  })

  it('reports a suspended staff account as suspended instead of hiding its company membership', () => {
    assert.doesNotMatch(statusFeedbackMigration, /coalesce\(u\.status, 'active'\) = 'active'/)
    assert.match(statusFeedbackMigration, /status text/)
    assert.match(statusFeedbackMigration, /lower\(btrim\(coalesce\(v_user\.status, 'active'\)\)\)/)
    assert.ok(
      authLogin.indexOf('if (!isStaffAccountActive(normalized))') < authLogin.indexOf('if (!normalized.authenticated || !normalized.session_token)'),
      'account lifecycle must be checked before a missing session token is reported'
    )
  })
})
