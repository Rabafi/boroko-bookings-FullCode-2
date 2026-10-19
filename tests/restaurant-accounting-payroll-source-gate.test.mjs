import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (name) => fs.readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')
const provenance = read('20260807490000_payroll_pii_and_statutory_gate.sql')
const payment = read('20260807240000_payroll_payment_batches_and_idempotency.sql')
const capability = read('20261007040000_restaurant_accounting_export_capability_parity.sql')
const payrollUi = fs.readFileSync(new URL('../src/renderer/src/components/restaurant-accounting/RestaurantPayroll.jsx', import.meta.url), 'utf8')
const mainIpc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
const payrollDomain = fs.readFileSync(new URL('../src/main/domains/restaurantAccountingV2.js', import.meta.url), 'utf8')

function body(sql, name) {
  const marker = 'create or replace function public.' + name
  const start = sql.indexOf(marker)
  assert.notEqual(start, -1, 'expected current forward migration to define ' + name)
  const end = sql.indexOf('$$;', start)
  assert.notEqual(end, -1, 'expected ' + name + ' body terminator')
  return sql.slice(start, end + 3)
}

test('Payroll source-document registration validates provenance and remains service-role-only', () => {
  const register = body(provenance, 'register_restaurant_payroll_source_document_v1')
  assert.match(register, /auth\.role\(\)<>'service_role'/)
  assert.match(register, /p_sha256 !~ '\^\[0-9a-fA-F\]\{64\}\$'/)
  assert.match(register, /coalesce\(p_byte_count,0\)<=0/)
  assert.match(register, /p_governed_version/)
  assert.match(register, /p_effective_from is null/)
  assert.match(provenance, /revoke all on table public\.restaurant_payroll_source_documents from public, anon, authenticated/i)
})

test('Payroll source verification is lodge-scoped and rejects the registering actor', () => {
  const verify = body(provenance, 'verify_restaurant_payroll_source_document_v1')
  assert.match(verify, /where id=p_document_id and lodge_id=p_lodge_id for update/)
  assert.match(verify, /registered_by=v_actor/)
  assert.match(verify, /independently_verified_by=v_actor,independently_verified_at=now\(\)/)
  assert.match(verify, /auth\.role\(\)<>'service_role'/)
})

test('statutory approval binds an independent approver, verified document, rule version, dates and professional reference', () => {
  const approve = body(provenance, 'approve_restaurant_payroll_statutory_configuration_v1')
  assert.match(approve, /where id=p_configuration_id and lodge_id=p_lodge_id for update/)
  assert.match(approve, /document_kind<>'statutory_rule' or v_doc\.independently_verified_at is null/)
  assert.match(approve, /v_cfg\.configured_by=v_actor or v_doc\.registered_by=v_actor/)
  assert.match(approve, /v_doc\.governed_version<>v_cfg\.rule_version/)
  assert.match(approve, /v_doc\.effective_from<>v_cfg\.effective_from/)
  assert.match(approve, /Professional approval reference is required/)
  assert.match(approve, /approved_rule_hash=v_doc\.sha256/)
  assert.match(approve, /approval_status='approved'/)
})

test('Payroll calculation refuses missing independent approval and unapproved time inputs', () => {
  const calculate = body(provenance, 'calculate_restaurant_payroll_v3')
  assert.match(calculate, /auth\.role\(\)<>'service_role'/)
  assert.match(calculate, /approval_status<>'approved'/)
  assert.match(calculate, /source_document_id is null/)
  assert.match(calculate, /policy_approved_by is null/)
  assert.match(calculate, /source_document_hash !~ '\^\[0-9a-fA-F\]\{64\}\$'/)
  assert.match(calculate, /approved_at is null/)
  assert.match(calculate, /calculate_restaurant_payroll_v2\(p_lodge_id,p_pay_period_id\)/)
  assert.match(calculate, /statutory_evidence/)
})

test('Payroll workspace excludes raw bank fields and exposes only a masked account number', () => {
  const workspace = body(provenance, 'get_restaurant_payroll_workspace_v3')
  assert.match(workspace, /auth\.role\(\)<>'service_role'/)
  assert.match(workspace, /to_jsonb\(t\) - 'bank_account_name' - 'bank_account_number' - 'bank_branch_code'/)
  assert.match(workspace, /bank_account_number_masked/)
  assert.match(workspace, /right\(t\.bank_account_number,4\)/)
  assert.match(workspace, /bank_details','masked'/)
})

test('raw payment export is capability-checked, reasoned and audited by payload hash', () => {
  const exportPayments = body(provenance, 'export_restaurant_payroll_payments_v4')
  assert.match(exportPayments, /_restaurant_require_capability\(p_lodge_id,'accounting\.payroll_export'\)/)
  assert.match(exportPayments, /A reason is required for raw payroll payment export/)
  assert.match(exportPayments, /export_restaurant_payroll_payments_v3\(p_lodge_id,p_pay_period_id,p_operation_id,p_debit_account_id\)/)
  assert.match(exportPayments, /restaurant_payroll_raw_export_audit/)
  assert.match(exportPayments, /payload_hash/)
  assert.match(exportPayments, /restricted_export',true/)
  assert.match(exportPayments, /Contains raw bank details/)
})

test('payment lifecycle RPCs serialize by the original operation idempotency key', () => {
  assert.match(payment, /function public\._restaurant_payroll_operation_lock\(p_lodge_id uuid, p_operation_id uuid\)/)
  for (const name of ['approve_restaurant_payroll_v3', 'export_restaurant_payroll_payments_v3', 'settle_restaurant_payroll_v3', 'reconcile_restaurant_payroll_settlement_v3', 'close_restaurant_payroll_v3']) {
    const operation = body(payment, name)
    assert.match(operation, /_restaurant_payroll_operation_lock\(p_lodge_id,\s*p_operation_id\)/, name + ' must lock on the stable operation id')
    assert.match(operation, /operation_id/)
  }
  assert.match(payment, /'exported_not_paid'/)
  assert.match(payment, /'settled'/)
  assert.match(payment, /'reconciled'/)
  assert.match(payment, /'closed'/)
})

test('raw payroll payment export requires its own capability and audited reason while preserving retry identity', () => {
  assert.ok(payrollUi.includes("canExport=canAccessCapability(access,'accounting.payroll_export')"))
  assert.ok(payrollUi.includes("canExport&&p.status==='approved'"))
  assert.ok(payrollUi.includes('Reason for raw payroll payment export is required and will be audited'))
  assert.ok(payrollUi.includes('Export cancelled: an audit reason is required.'))
  assert.ok(payrollUi.includes("runIdempotent(`payroll-export:${id}`,key=>accountingInvoke('exportPayroll',id,key,paymentAccountId,reason.trim()))"))
  assert.ok(!payrollUi.includes("accountingInvoke('exportPayroll',id,key,paymentAccountId))"))
  assert.ok(mainIpc.includes("exportPayroll: ['accounting.payroll_export', db.exportRestaurantPayrollPaymentsV2]"))
  assert.ok(payrollDomain.includes("p_reason:reason"))
  assert.ok(provenance.includes("_restaurant_require_capability(p_lodge_id,'accounting.payroll_export')"))
})

test('server defaults keep Payroll private across cashier, manager, finance and admin roles', () => {
  const actorCapability = body(capability, '_restaurant_actor_has_capability')
  assert.match(actorCapability, /where u\.id\s*=\s*v_actor and u\.lodge_id\s*=\s*p_lodge_id and coalesce\(u\.status,'active'\)\s*=\s*'active'/)
  assert.match(actorCapability, /when 'accounts' then 'finance'[\s\S]*when 'accounting' then 'finance'/)
  for (const cap of ['accounting.payroll_view', 'accounting.payroll_manage', 'accounting.payroll_export']) {
    const escaped = cap.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(actorCapability, new RegExp(`when '${escaped}' then v_role in \\('admin','super_admin'\\)`))
  }
  assert.match(actorCapability, /when 'accounting\.read' then v_role in \('finance','manager','admin','super_admin'\)/)
  assert.match(actorCapability, /when 'accounting\.manage' then v_role in \('finance','admin','super_admin'\)/)
  assert.match(actorCapability, /v_override is not null and jsonb_typeof\(v_override\) = 'boolean'[\s\S]*return \(v_override::text\)::boolean/)
  assert.match(actorCapability, /else false/)
})

test('Payroll IPC keeps view, management, export and bank approval capabilities separate', () => {
  const map = mainIpc.slice(mainIpc.indexOf('const restaurantAccountingV2Operations = {'), mainIpc.indexOf("ipcMain.handle('restaurantAccountingV2:invoke'"))
  for (const [operation, capability] of [
    ['getPayroll', 'accounting.payroll_view'],
    ['getPayrollRecords', 'accounting.payroll_view'],
    ['getPayrollReadiness', 'accounting.payroll_manage'],
    ['setPayrollTerms', 'accounting.payroll_manage'],
    ['approvePayroll', 'accounting.payroll_manage'],
    ['exportPayrollRegister', 'accounting.payroll_export'],
    ['exportPayroll', 'accounting.payroll_export'],
    ['reconcilePayrollSettlement', 'accounting.bank_approve']
  ]) assert.match(map, new RegExp(`${operation}: \\['${capability.replaceAll('.', '\\.')}'`))
  assert.match(payrollUi, /canManage=canAccessCapability\(access,'accounting\.payroll_manage'\)/)
  assert.match(payrollUi, /canExport=canAccessCapability\(access,'accounting\.payroll_export'\)/)
})
