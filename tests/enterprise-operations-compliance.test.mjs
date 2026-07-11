import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { CAPABILITY_LABELS } from '../src/shared/accessControl.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── SQL migration file existence ─────────────────────────────────────────────

test('operations compliance full migration file exists', () => {
  const file = path.join(__dirname, '..', 'supabase', 'migrations', '20260705145000_operations_compliance_full.sql')
  assert.equal(fs.existsSync(file), true, 'Migration file must exist')
})

// ── SQL migration declarations ───────────────────────────────────────────────

test('operations compliance migration declares shift_handover_logs table', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260705145000_operations_compliance_full.sql'),
    'utf-8'
  )
  assert.match(sql, /CREATE TABLE.*shift_handover_logs/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
})

test('operations compliance migration declares all required RPCs', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260705145000_operations_compliance_full.sql'),
    'utf-8'
  )
  const rpcs = ['create_linen_stocktake', 'get_linen_dashboard', 'report_damaged_linen',
    'charge_damaged_linen_to_booking', 'claim_lost_found_item', 'get_lost_found_dashboard',
    'resolve_incident', 'get_incident_dashboard', 'get_visitor_dashboard', 'get_visitor_history',
    'get_evacuation_list', 'export_evacuation_report', 'create_shift_handover',
    'complete_shift_handover', 'get_shift_handover_history']
  for (const rpc of rpcs) {
    assert.match(sql, new RegExp(`FUNCTION.*${rpc}`), `RPC ${rpc} must be declared`)
  }
})

// ── IPC handler declarations ─────────────────────────────────────────────────

test('IPC handlers registered for operations compliance', () => {
  const indexJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf-8')
  const handlers = ['operationsCompliance:createLinenStocktake', 'operationsCompliance:getLinenDashboard',
    'operationsCompliance:reportDamagedLinen', 'operationsCompliance:chargeDamagedLinen',
    'operationsCompliance:claimLostFoundItem', 'operationsCompliance:getLostFoundDashboard',
    'operationsCompliance:resolveIncident', 'operationsCompliance:getIncidentDashboard',
    'operationsCompliance:getVisitorDashboard', 'operationsCompliance:getVisitorHistory',
    'operationsCompliance:getEvacuationList', 'operationsCompliance:exportEvacuationReport',
    'operationsCompliance:createShiftHandover', 'operationsCompliance:completeShiftHandover',
    'operationsCompliance:getShiftHandoverHistory']
  for (const handler of handlers) {
    assert.match(indexJs, new RegExp(`ipcMain\\.handle\\('${handler}`), `IPC handler ${handler} must be registered`)
  }
})

// ── Preload API bridge ──────────────────────────────────────────────────────

test('preload exports operations compliance API bridge', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'index.js'), 'utf-8')
  assert.match(preload, /operationsCompliance:/)
})

// ── Shared module updates ───────────────────────────────────────────────────

test('accessControl defines new operations compliance capabilities', () => {
  assert.equal(typeof CAPABILITY_LABELS['linen.manage'], 'string')
  assert.equal(typeof CAPABILITY_LABELS['lost_found.manage'], 'string')
  assert.equal(typeof CAPABILITY_LABELS['incidents.manage'], 'string')
  assert.equal(typeof CAPABILITY_LABELS['visitors.manage'], 'string')
  assert.equal(typeof CAPABILITY_LABELS['emergency.view'], 'string')
  assert.equal(typeof CAPABILITY_LABELS['shift_handover.manage'], 'string')
})
