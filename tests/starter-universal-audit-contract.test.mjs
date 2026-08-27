import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const migration = read('supabase/migrations/20260824070000_starter_universal_audit_recording.sql')
const index = read('src/main/index.js')
const database = read('src/main/database.js')
const starterAudit = read('src/main/domains/starterAudit.js')
const staffAudit = read('supabase/migrations/20260715015000_staff_access_audit_and_manager_scope.sql')
const financialAudit = read('supabase/migrations/20260618130000_financial_mutation_idempotency_and_booking_audit.sql')

test('ordinary Starter lodge operations use one append-only, lodge-scoped audit log', () => {
  assert.match(migration, /create table if not exists public\.starter_operational_audit_log/)
  assert.match(migration, /lodge_id uuid not null/)
  assert.match(migration, /public\.app_current_user_id\(\)/)
  assert.match(migration, /starter_audit_redact/)
  assert.match(migration, /jsonb_array_elements\(p_value\)/)
  assert.match(migration, /starter_operational_audit_\%1\$I/)
  for (const table of ['rooms', 'housekeeping_log', 'customers', 'quotations', 'invoices', 'maintenance_tickets']) {
    assert.match(migration, new RegExp(`'${table}'`), `${table} must be covered`)
  }
})

test('audit evidence cannot be changed by distributed clients', () => {
  assert.match(migration, /before update or delete on public\.starter_operational_audit_log/)
  assert.match(migration, /append-only/)
  assert.match(migration, /revoke all on table public\.starter_operational_audit_log from public, anon, authenticated/)
  assert.match(migration, /grant select on table public\.starter_operational_audit_log to service_role/)
  assert.match(migration, /revoke insert, update, delete, truncate on table public\.starter_operational_audit_log from service_role/)
  assert.doesNotMatch(migration, /grant select, insert on table public\.starter_operational_audit_log/)
  assert.match(migration, /using \(public\.app_lodge_access\(lodge_id\)\)/)
})

test('financial and Starter staff audit ledgers remain authoritative and separate', () => {
  assert.match(financialAudit, /financial_audit_log/)
  assert.match(staffAudit, /staff_access_audit/)
  assert.match(staffAudit, /password_hash.*pin_hash.*pwa_password_hash/s)
  assert.match(migration, /Bookings\/payments and users.*existing authoritative audit contracts/s)
  assert.doesNotMatch(migration, /create trigger.*on public\.(bookings|payments|users)/s)
})

test('Starter backup and basic report artifacts require server audit recording', () => {
  assert.match(migration, /record_starter_artifact_audit/)
  for (const action of ['starter_backup_created', 'starter_report_pdf_saved', 'starter_report_printed']) {
    assert.match(migration, new RegExp(action))
    assert.match(index, new RegExp(`action: '${action}'`))
  }
  assert.match(index, /authoritative audit recording failed/)
  assert.match(index, /fileWritten: true, auditRecorded: false/)
  assert.match(index, /fileName: basename\(filePath\)/)
  assert.match(index, /if \(printResult\?\.success === false\) return \{ \.\.\.printResult, auditRecorded: false \}/)
  assert.doesNotMatch(index, /return \{ success: false, filePath, bytes:/)
  assert.match(database, /recordStarterArtifactAudit/)
  assert.match(starterAudit, /state\.supabase\.rpc\('record_starter_artifact_audit'/)
  assert.match(starterAudit, /Connect to the internet/)
})

test('artifact RPC authorization matches Starter backup and report capability roles', () => {
  const artifactRpc = migration.match(/create or replace function public\.record_starter_artifact_audit\([\s\S]*?\n\$\$;/)?.[0] || ''
  assert.match(artifactRpc, /v_action = 'starter_backup_created'[\s\S]*public\.app_require_feature\([\s\S]*'starter_backup'/)
  assert.match(artifactRpc, /public\._restaurant_require_operational_report_access\([\s\S]*'reports\.basic_view'/)
  assert.match(artifactRpc, /array\['owner', 'admin', 'manager', 'finance', 'super_admin'\]/)
  assert.doesNotMatch(artifactRpc, /\b(?:receptionist|operations)\b/)
})

test('Starter report print audit identity is stable across IPC retries', () => {
  const ui = read('src/renderer/src/components/BasicReports.jsx')
  const preload = read('src/preload/index.js')
  assert.match(ui, /operationId: crypto\.randomUUID\(\)/)
  assert.match(preload, /basicPrint: \(payload\) => invoke\('reports:basicPrint', payload\)/)
  assert.match(index, /STARTER_PRINT_OPERATION_ID_PATTERN\.test\(operationId\)/)
  assert.match(index, /artifactId: `print-\$\{operationId\}`/)
  assert.match(index, /printed: true, auditRecorded: false/)
  assert.match(migration, /\^print-\[0-9a-f\]/)
})
