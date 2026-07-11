import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { CAPABILITY_LABELS } from '../src/shared/accessControl.js'
import { getModuleByKey } from '../src/shared/moduleCatalog.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── SQL migration file existence ─────────────────────────────────────────────

test('housekeeping command center migration file exists', () => {
  const file = path.join(__dirname, '..', 'supabase', 'migrations', '20260705107000_housekeeping_command_center.sql')
  assert.equal(fs.existsSync(file), true, 'Migration file must exist')
})

test('maintenance enterprise migration file exists', () => {
  const file = path.join(__dirname, '..', 'supabase', 'migrations', '20260705127000_maintenance_enterprise.sql')
  assert.equal(fs.existsSync(file), true, 'Migration file must exist')
})

// ── SQL migration table declarations ────────────────────────────────────────

test('housekeeping migration declares all required tables', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260705107000_housekeeping_command_center.sql'),
    'utf-8'
  )
  assert.match(sql, /CREATE TABLE.*housekeeping_assignments/)
  assert.match(sql, /CREATE TABLE.*housekeeping_inspections/)
  assert.match(sql, /CREATE TABLE.*housekeeping_inspection_checklist_items/)
  assert.match(sql, /CREATE TABLE.*turnaround_tracking/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
})

test('housekeeping migration declares all required RPCs', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260705107000_housekeeping_command_center.sql'),
    'utf-8'
  )
  const rpcs = ['create_housekeeping_assignment', 'update_housekeeping_assignment_status',
    'start_turnaround', 'complete_turnaround', 'create_housekeeping_inspection',
    'get_housekeeping_dashboard', 'get_turnaround_times', 'get_housekeeping_productivity',
    'get_housekeeping_checklist_items', 'create_housekeeping_checklist_item',
    'update_housekeeping_checklist_item', 'delete_housekeeping_checklist_item']
  for (const rpc of rpcs) {
    assert.match(sql, new RegExp(`FUNCTION.*${rpc}`), `RPC ${rpc} must be declared`)
  }
})

test('maintenance enterprise migration declares all required tables', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260705127000_maintenance_enterprise.sql'),
    'utf-8'
  )
  assert.match(sql, /CREATE TABLE.*maintenance_preventive_schedules/)
  assert.match(sql, /CREATE TABLE.*maintenance_downtime_log/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
})

test('maintenance enterprise migration declares all required RPCs', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260705127000_maintenance_enterprise.sql'),
    'utf-8'
  )
  const rpcs = ['create_preventive_schedule', 'update_preventive_schedule', 'delete_preventive_schedule',
    'get_due_preventive_maintenance', 'complete_preventive_maintenance',
    'set_room_out_of_order', 'set_room_out_of_service', 'return_room_to_service',
    'get_room_downtime_history', 'get_maintenance_dashboard', 'get_downtime_report',
    'get_preventive_schedules']
  for (const rpc of rpcs) {
    assert.match(sql, new RegExp(`FUNCTION.*${rpc}`), `RPC ${rpc} must be declared`)
  }
})

// ── IPC handler declaration ──────────────────────────────────────────────────

test('IPC handlers registered for housekeeping command center', () => {
  const indexJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8')
  const handlers = ['housekeepingCommandCenter:getDashboard', 'housekeepingCommandCenter:createAssignment',
    'housekeepingCommandCenter:updateAssignmentStatus', 'housekeepingCommandCenter:createInspection',
    'housekeepingCommandCenter:startTurnaround', 'housekeepingCommandCenter:completeTurnaround',
    'housekeepingCommandCenter:getTurnaroundTimes', 'housekeepingCommandCenter:getProductivity',
    'housekeepingCommandCenter:getChecklistItems', 'housekeepingCommandCenter:createChecklistItem',
    'housekeepingCommandCenter:updateChecklistItem', 'housekeepingCommandCenter:deleteChecklistItem']
  for (const handler of handlers) {
    assert.match(indexJs, new RegExp(`ipcMain\\.handle\\('${handler}`), `IPC handler ${handler} must be registered`)
  }
})

test('IPC handlers registered for maintenance enterprise', () => {
  const indexJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8')
  const handlers = ['maintenanceEnterprise:getAllPreventiveSchedules', 'maintenanceEnterprise:createPreventiveSchedule',
    'maintenanceEnterprise:updatePreventiveSchedule', 'maintenanceEnterprise:deletePreventiveSchedule',
    'maintenanceEnterprise:getDuePreventive', 'maintenanceEnterprise:completePreventive',
    'maintenanceEnterprise:setRoomOutOfOrder', 'maintenanceEnterprise:setRoomOutOfService',
    'maintenanceEnterprise:returnRoomToService', 'maintenanceEnterprise:getRoomDowntimeHistory',
    'maintenanceEnterprise:getMaintenanceDashboard', 'maintenanceEnterprise:getDowntimeReport']
  for (const handler of handlers) {
    assert.match(indexJs, new RegExp(`ipcMain\\.handle\\('${handler}`), `IPC handler ${handler} must be registered`)
  }
})

// ── Preload API bridge ──────────────────────────────────────────────────────

test('preload exports housekeeping command center API bridge', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf-8')
  assert.match(preload, /housekeepingCommandCenter:/)
  assert.match(preload, /maintenanceEnterprise:/)
})

// ── Shared module updates ───────────────────────────────────────────────────

test('accessControl defines new capabilities', () => {
  assert.equal(typeof CAPABILITY_LABELS['housekeeping.assign'], 'string')
  assert.equal(typeof CAPABILITY_LABELS['housekeeping.inspect'], 'string')
  assert.equal(typeof CAPABILITY_LABELS['maintenance.preventive'], 'string')
  assert.equal(typeof CAPABILITY_LABELS['maintenance.ooo'], 'string')
})

test('moduleCatalog updates advanced_housekeeping capabilities', () => {
  const mod = getModuleByKey('advanced_housekeeping')
  assert.ok(mod.capabilities.includes('housekeeping.assign'))
  assert.ok(mod.capabilities.includes('housekeeping.inspect'))
})

test('moduleCatalog updates maintenance capabilities', () => {
  const mod = getModuleByKey('maintenance')
  assert.ok(mod.capabilities.includes('maintenance.preventive'))
  assert.ok(mod.capabilities.includes('maintenance.ooo'))
})

test('moduleCatalog gates maintenance enterprise route as Enterprise hotel module', () => {
  const mod = getModuleByKey('maintenance_enterprise')
  assert.ok(mod, 'maintenance_enterprise module should exist')
  assert.equal(mod.requiredPlan, 'Enterprise')
  assert.equal(mod.visibility, 'hotel_only')
  assert.deepEqual(mod.routes, ['/maintenance-enterprise'])
  assert.ok(mod.capabilities.includes('maintenance.preventive'))
  assert.ok(mod.capabilities.includes('maintenance.ooo'))
})
