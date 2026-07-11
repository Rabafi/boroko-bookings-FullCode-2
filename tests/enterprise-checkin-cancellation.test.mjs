import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import { cwd } from 'process'

const root = cwd()

function readSQL(name) {
  return readFileSync(join(root, 'supabase', 'migrations', name), 'utf8')
}

function readSource(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

// ── Check-in Workflow Migration ────────────────────────────────────────────

test('checkinWorkflow migration creates expected tables', () => {
  const sql = readSQL('20260705120500_checkin_checkout_workflow.sql')
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS checkin_config'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS checkin_checklist_items'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS checkout_checklist_items'))
})

test('checkinWorkflow migration has all RPCs', () => {
  const sql = readSQL('20260705120500_checkin_checkout_workflow.sql')
  const rpcs = [
    'get_checkin_checklist', 'complete_checkin_step', 'reset_checkin_step',
    'get_checkin_config', 'update_checkin_config',
    'get_checkout_checklist', 'complete_checkout_step', 'reset_checkout_step'
  ]
  for (const rpc of rpcs) assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION ${rpc}`), rpc)
})

test('checkinWorkflow migration has RLS and GRANTs', () => {
  const sql = readSQL('20260705120500_checkin_checkout_workflow.sql')
  assert.ok(sql.includes('ALTER TABLE checkin_config ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('ALTER TABLE checkin_checklist_items ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('ALTER TABLE checkout_checklist_items ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION'))
})

test('checkinWorkflow domain file exists', () => {
  const domain = readSource('src/main/domains/checkinWorkflow.js')
  assert.ok(domain.includes("import { state } from '../state.js'"))
  const exports = ['getCheckinChecklist', 'completeCheckinStep', 'resetCheckinStep', 'getCheckoutChecklist', 'completeCheckoutStep', 'resetCheckoutStep', 'getCheckinConfig', 'updateCheckinConfig']
  for (const exp of exports) assert.ok(domain.includes(`export const ${exp}`), `export ${exp}`)
})

test('checkinWorkflow IPC handlers and preload bridges exist', () => {
  const main = readSource('src/main/index.js')
  const preload = readSource('src/preload/index.js')
  const handlers = ['checkinWorkflow:getChecklist', 'checkinWorkflow:completeStep', 'checkinWorkflow:resetStep', 'checkinWorkflow:getConfig', 'checkinWorkflow:updateConfig', 'checkoutWorkflow:getChecklist', 'checkoutWorkflow:completeStep', 'checkoutWorkflow:resetStep']
  for (const h of handlers) assert.ok(main.includes(`ipcMain.handle('${h}'`), `handler ${h}`)
  assert.ok(preload.includes('checkinWorkflow:'))
  assert.ok(preload.includes('checkoutWorkflow:'))
})

// ── Early/Late Checkout Migration ──────────────────────────────────────────

test('earlyLateCheckout migration creates expected tables', () => {
  const sql = readSQL('20260705140500_early_late_checkout_policies.sql')
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS early_checkin_policies'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS late_checkout_policies'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS early_checkin_requests'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS late_checkout_requests'))
})

test('earlyLateCheckout migration has all RPCs and RLS', () => {
  const sql = readSQL('20260705140500_early_late_checkout_policies.sql')
  const rpcs = [
    'get_early_checkin_policies', 'create_early_checkin_policy', 'update_early_checkin_policy', 'delete_early_checkin_policy',
    'get_late_checkout_policies', 'create_late_checkout_policy', 'update_late_checkout_policy', 'delete_late_checkout_policy',
    'get_early_checkin_requests', 'create_early_checkin_request', 'approve_early_checkin_request', 'reject_early_checkin_request',
    'get_late_checkout_requests', 'create_late_checkout_request', 'approve_late_checkout_request', 'reject_late_checkout_request',
    'calculate_early_checkin_fee', 'calculate_late_checkout_fee'
  ]
  for (const rpc of rpcs) assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION ${rpc}`), rpc)
  assert.ok(sql.includes('ALTER TABLE early_checkin_policies ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('ALTER TABLE late_checkout_policies ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION'))
})

test('earlyLateCheckout domain file exists', () => {
  const domain = readSource('src/main/domains/earlyLateCheckout.js')
  assert.ok(domain.includes("import { state } from '../state.js'"))
  const exports = ['getEarlyPolicies', 'createEarlyPolicy', 'updateEarlyPolicy', 'deleteEarlyPolicy', 'getLatePolicies', 'createLatePolicy', 'updateLatePolicy', 'deleteLatePolicy', 'getEarlyRequests', 'getLateRequests', 'calculateEarlyFee', 'calculateLateFee']
  for (const exp of exports) assert.ok(domain.includes(`export const ${exp}`) || domain.includes(`export const ${exp} =`), `export ${exp}`)
})

test('earlyLateCheckout IPC handlers exist', () => {
  const main = readSource('src/main/index.js')
  const handlers = [
    'earlyLateCheckout:getEarlyPolicies', 'earlyLateCheckout:createEarlyPolicy', 'earlyLateCheckout:updateEarlyPolicy', 'earlyLateCheckout:deleteEarlyPolicy',
    'earlyLateCheckout:getLatePolicies', 'earlyLateCheckout:createLatePolicy', 'earlyLateCheckout:updateLatePolicy', 'earlyLateCheckout:deleteLatePolicy',
    'earlyLateCheckout:getEarlyRequests', 'earlyLateCheckout:createEarlyRequest', 'earlyLateCheckout:approveEarlyRequest', 'earlyLateCheckout:rejectEarlyRequest',
    'earlyLateCheckout:getLateRequests', 'earlyLateCheckout:createLateRequest', 'earlyLateCheckout:approveLateRequest', 'earlyLateCheckout:rejectLateRequest',
    'earlyLateCheckout:calculateEarlyFee', 'earlyLateCheckout:calculateLateFee'
  ]
  for (const h of handlers) assert.ok(main.includes(`ipcMain.handle('${h}'`), `handler ${h}`)
})

// ── Cancellation Policies Migration ────────────────────────────────────────

test('cancellationPolicies migration creates tables and RPCs', () => {
  const sql = readSQL('20260705160000_cancellation_policies.sql')
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS cancellation_policies'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS cancellation_requests'))
  assert.ok(sql.includes('ALTER TABLE cancellation_policies ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('ALTER TABLE cancellation_requests ENABLE ROW LEVEL SECURITY'))

  const rpcs = [
    'get_cancellation_policies', 'create_cancellation_policy', 'update_cancellation_policy', 'delete_cancellation_policy',
    'calculate_cancellation_fee', 'create_cancellation_request', 'get_cancellation_requests', 'approve_cancellation'
  ]
  for (const rpc of rpcs) assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION ${rpc}`), rpc)
})

test('cancellationPolicies migration has role checks', () => {
  const sql = readSQL('20260705160000_cancellation_policies.sql')
  assert.ok(sql.includes("app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin'"))
  assert.ok(sql.includes("app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist'"))
})

test('cancellationPolicies domain file exists', () => {
  const domain = readSource('src/main/domains/cancellationPolicies.js')
  const exports = ['getAllCancellationPolicies', 'createCancellationPolicy', 'updateCancellationPolicy', 'deleteCancellationPolicy', 'calculateCancellationFee', 'getAllCancellationRequests', 'approveCancellation']
  for (const exp of exports) assert.ok(domain.includes(`export const ${exp}`) || domain.includes(`export const ${exp} =`), `export ${exp}`)
})

test('cancellationPolicies IPC handlers exist', () => {
  const main = readSource('src/main/index.js')
  const handlers = ['cancellationPolicies:getAll', 'cancellationPolicies:create', 'cancellationPolicies:update', 'cancellationPolicies:delete', 'cancellationPolicies:calculateFee', 'cancellationPolicies:getRequests', 'cancellationPolicies:approve']
  for (const h of handlers) assert.ok(main.includes(`ipcMain.handle('${h}'`), `handler ${h}`)
})

// ── Shared Module Registry ─────────────────────────────────────────────────

test('enterprise modules registered in moduleCatalog', () => {
  const mc = readSource('src/shared/moduleCatalog.js')
  assert.ok(mc.includes("'checkin_workflow'"))
  assert.ok(mc.includes("'early_late_checkout'"))
  assert.ok(mc.includes("'cancellation_policies'"))
  assert.ok(mc.includes("'/checkin-workflow'"))
  assert.ok(mc.includes("'/early-late-checkout'"))
  assert.ok(mc.includes("'/cancellation-policies'"))
})

test('enterprise capabilities registered in accessControl', () => {
  const ac = readSource('src/shared/accessControl.js')
  const caps = [
    "'checkin.manage': 'Manage check-in workflow'",
    "'checkout.manage': 'Manage check-out workflow'",
    "'early_checkin.manage': 'Manage early check-in'",
    "'late_checkout.manage': 'Manage late checkout'",
    "'cancellation.manage': 'Manage cancellation policies'",
    "'cancellation.approve': 'Approve cancellations'"
  ]
  for (const cap of caps) assert.ok(ac.includes(cap), cap)
})

test('database.js exports all new domains', () => {
  const db = readSource('src/main/database.js')
  assert.ok(db.includes("'./domains/checkinWorkflow.js'"))
  assert.ok(db.includes("'./domains/earlyLateCheckout.js'"))
  assert.ok(db.includes("'./domains/cancellationPolicies.js'"))
  assert.ok(db.includes('getCheckinChecklist'))
  assert.ok(db.includes('getEarlyPolicies'))
  assert.ok(db.includes('getAllCancellationPolicies'))
})

test('DEV_ENTERPRISE_PREVIEW_CAPABILITIES includes new capabilities', () => {
  const main = readSource('src/main/index.js')
  const caps = ["'night_audit.close'", "'night_audit.reopen'", "'night_audit.checks'", "'checkin.manage'", "'checkout.manage'", "'early_checkin.manage'", "'late_checkout.manage'", "'cancellation.manage'", "'cancellation.approve'"]
  for (const cap of caps) assert.ok(main.includes(cap), cap)
})

test('React components exist', () => {
  const components = ['CheckinWorkflow.jsx', 'EarlyLateCheckout.jsx', 'CancellationPolicies.jsx', 'RevenueManager.jsx', 'NightAudit.jsx']
  for (const comp of components) {
    const filePath = join(root, 'src', 'renderer', 'src', 'components', comp)
    const content = readFileSync(filePath, 'utf8')
    assert.ok(content.length > 0, `Component ${comp} exists and is non-empty`)
  }
})
