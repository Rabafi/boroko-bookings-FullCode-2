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

// ── Migration tests ────────────────────────────────────────────────────────

test('night_audit_close migration SQL creates expected tables', () => {
  const sql = readSQL('20260705100000_night_audit_close.sql')
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS night_audit_close'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS night_audit_exceptions'))
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION run_night_audit_checks'))
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION close_night_audit'))
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION reopen_night_audit'))
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION get_night_audit_summary'))
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION get_night_audit_history'))
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION resolve_exception'))
})

test('night_audit migration has role checks, RLS, grants, indexes', () => {
  const sql = readSQL('20260705100000_night_audit_close.sql')
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS idx_night_audit_close_lodge'))
  assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS idx_night_audit_close_business_date'))
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION'))

  const roleRPCs = ['run_night_audit_checks', 'close_night_audit', 'reopen_night_audit']
  for (const fn of roleRPCs) {
    assert.ok(sql.includes(`app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']`), `${fn} has role check`)
  }
})

// ── Domain file tests ──────────────────────────────────────────────────────

test('nightAudit domain file exists and has correct imports/exports', () => {
  const domain = readSource('src/main/domains/nightAudit.js')
  assert.ok(domain.includes("import { state } from '../state.js'"))
  assert.ok(domain.includes("import { readCache, writeCache, dedupePromise } from './infrastructure.js'"))

  const rpcs = ['run_night_audit_checks', 'close_night_audit', 'reopen_night_audit', 'get_night_audit_summary', 'get_night_audit_history', 'resolve_exception']
  for (const rpc of rpcs) assert.ok(domain.includes(rpc), `calls ${rpc}`)

  const exports = ['runAuditChecks', 'closeNightAudit', 'reopenNightAudit', 'getNightAuditSummary', 'getNightAuditHistory', 'resolveException']
  for (const exp of exports) assert.ok(domain.includes(`export const ${exp}`), `export ${exp}`)
})

// ── IPC handler tests ──────────────────────────────────────────────────────

test('nightAudit IPC handlers exist in main/index.js', () => {
  const main = readSource('src/main/index.js')
  const handlers = ['nightAudit:runChecks', 'nightAudit:close', 'nightAudit:reopen', 'nightAudit:summary', 'nightAudit:history', 'nightAudit:resolveException']
  for (const h of handlers) assert.ok(main.includes(`ipcMain.handle('${h}'`), `IPC handler ${h}`)
})

// ── Preload bridge tests ───────────────────────────────────────────────────

test('nightAudit preload bridges exist', () => {
  const preload = readSource('src/preload/index.js')
  assert.ok(preload.includes('nightAudit:'))
  assert.ok(preload.includes("ipcRenderer.invoke('nightAudit:runChecks')"))
  assert.ok(preload.includes("ipcRenderer.invoke('nightAudit:close'"))
  assert.ok(preload.includes("ipcRenderer.invoke('nightAudit:reopen'"))
  assert.ok(preload.includes("ipcRenderer.invoke('nightAudit:summary'"))
  assert.ok(preload.includes("ipcRenderer.invoke('nightAudit:history'"))
  assert.ok(preload.includes("ipcRenderer.invoke('nightAudit:resolveException'"))
})

// ── Access control tests ───────────────────────────────────────────────────

test('nightAudit capabilities registered in accessControl', () => {
  const ac = readSource('src/shared/accessControl.js')
  assert.ok(ac.includes("'night_audit.close': 'Close night audit'"))
  assert.ok(ac.includes("'night_audit.reopen': 'Reopen night audit'"))
  assert.ok(ac.includes("'night_audit.checks': 'Run night audit checks'"))
})

// ── Module catalog tests ───────────────────────────────────────────────────

test('nightAudit module registered in moduleCatalog', () => {
  const mc = readSource('src/shared/moduleCatalog.js')
  assert.ok(mc.includes("'night_audit_enterprise'"))
  assert.ok(mc.includes("'night_audit.close'"))
  assert.ok(mc.includes("'/night-audit-enterprise'"))
})

// ── Database facade tests ──────────────────────────────────────────────────

test('database.js exports night audit domain', () => {
  const db = readSource('src/main/database.js')
  assert.ok(db.includes('runAuditChecks as runNightAuditChecks'))
  assert.ok(db.includes('closeNightAudit'))
  assert.ok(db.includes('reopenNightAudit'))
  assert.ok(db.includes('getNightAuditSummary'))
  assert.ok(db.includes('getNightAuditHistory'))
  assert.ok(db.includes('resolveException as resolveNightAuditException'))
  assert.ok(db.includes("'./domains/nightAudit.js'"))
})

// ── Dev preview tests ──────────────────────────────────────────────────────

test('DEV_ENTERPRISE_PREVIEW includes night audit caps', () => {
  const main = readSource('src/main/index.js')
  assert.ok(main.includes("'night_audit.close'"))
  assert.ok(main.includes("'night_audit.reopen'"))
  assert.ok(main.includes("'night_audit.checks'"))
})
