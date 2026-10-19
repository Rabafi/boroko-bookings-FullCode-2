import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connection, PROJECT } from '../tmp/bar-online-assessment-2026-10-07/disposable-client.mjs'

const expectedProject = 'repsrmlomedqrmrdsbga'
const expectedProduction = 'oicgpknsmtvcsjacymum'
const expectedMarker = 'LUNA-REMEDIATION-DISPOSABLE-v1'
const lodge = '4509e4c0-a10f-406a-9918-b83664e8bbee'
const maker = '6184abcd-d736-4ced-ac0e-064d4132ec69'
const product = '8a0fceab-6f01-439f-9865-b6a877d2531a'
const outlet = '7aa09f98-a0c1-4cca-a97f-3266de5871f8'
if (PROJECT !== expectedProject) throw new Error('Explicit disposable project mismatch')
const productionLink = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
if (productionLink !== expectedProduction || productionLink === PROJECT) throw new Error('Production link separation guard failed')
const connected = await connection()
const db = connected.client
try {
  if (connected.identity.database_name !== 'postgres' || connected.identity.database_user !== 'postgres') throw new Error('Fixture setup role assumption failed')
  await db.query('begin')
  await db.query("set local statement_timeout='30s'")
  const marker = (await db.query('select marker,project_ref,environment_kind,database_name,allow_mutation from public.luna_remediation_db_marker where singleton=true')).rows[0]
  if (marker?.marker !== expectedMarker || marker.project_ref !== expectedProject || marker.environment_kind !== 'disposable' || marker.database_name !== 'postgres' || marker.allow_mutation !== true) throw new Error('Exact disposable marker guard failed')
  const user = (await db.query('select id,lodge_id,role,status,(pin_hash is not null) as has_pin from public.users where id=$1 and lodge_id=$2 for update',[maker,lodge])).rows[0]
  if (!user || user.role !== 'admin' || user.status !== 'active' || user.has_pin !== true) throw new Error('Maker PIN state does not match the just-recorded test mutation')
  const activeAttendance = (await db.query("select id from public.restaurant_shifts where lodge_id=$1 and staff_user_id=$2 and status='active' and clock_out is null",[lodge,maker])).rows
  if (activeAttendance.length !== 0) throw new Error('Active attendance appeared; stop and preserve it')
  const orderCount = Number((await db.query('select count(distinct o.id)::int as count from public.pos_orders o join public.pos_order_items i on i.order_id=o.id and i.lodge_id=o.lodge_id where o.lodge_id=$1 and i.menu_item_id=$2',[lodge,product])).rows[0]?.count || 0)
  if (orderCount !== 0) throw new Error('A POS sale appeared; do not run PIN cleanup with a financial row present')
  const openShifts = (await db.query("select id,cashier_id,outlet_id,status,opening_float from public.pos_shifts where lodge_id=$1 and outlet_id=$2 and status='open'",[lodge,outlet])).rows
  if (openShifts.length !== 1 || openShifts[0].id !== 'b1dc793a-63d5-4e60-99b4-b566b764408b' || openShifts[0].cashier_id !== maker || Number(openShifts[0].opening_float) !== 0) throw new Error('Exact retained Till shift changed; no cleanup mutation performed')
  const auditBefore = Number((await db.query("select count(*)::int as count from public.staff_access_audit where lodge_id=$1 and staff_user_id=$2 and action='staff_approval_pin_changed'",[lodge,maker])).rows[0]?.count || 0)
  const updated = (await db.query('update public.users set pin_hash=null where id=$1 and lodge_id=$2 and pin_hash is not null returning id,lodge_id,(pin_hash is null) as has_pin',[maker,lodge])).rows
  if (updated.length !== 1 || updated[0].has_pin !== true) throw new Error('PIN baseline cleanup did not clear exactly one value')
  const staffSafe = (await db.query('select id,has_pin,status,role from public.users_safe where lodge_id=$1 and id=$2',[lodge,maker])).rows[0]
  if (staffSafe?.has_pin !== false || staffSafe.status !== 'active') throw new Error('users_safe did not confirm the restored no-PIN baseline')
  const auditAfter = Number((await db.query("select count(*)::int as count from public.staff_access_audit where lodge_id=$1 and staff_user_id=$2 and action='staff_approval_pin_changed'",[lodge,maker])).rows[0]?.count || 0)
  await db.query('commit')
  const report = {
    checked_at: new Date().toISOString(),
    project: PROJECT,
    guard: { marker_verified_before_cleanup: true, marker: marker.marker, environment_kind: marker.environment_kind, database: marker.database_name, setup_role: connected.identity.database_user, production_link_preserved: productionLink },
    cleanup: { target_user_id: maker, prior_pin_state_from_latest_readonly_probe: true, pin_plaintext_or_hash_read: false, cleared_to_pre_attempt_null_baseline: true, users_safe_has_pin_after: staffSafe.has_pin, actor_privilege_or_role_changed: false, active_attendance: 0, pos_orders_for_retained_product: orderCount, retained_open_shift_id: openShifts[0].id, staff_pin_audit_count_before: auditBefore, staff_pin_audit_count_after: auditAfter, audit_history_preserved: auditAfter >= auditBefore },
    financial_rows_changed: false
  }
  const path = resolve('docs/audits/2026-10-08/accounting-independent-review/evidence/accounting-pos-pin-baseline-reset-20261012.json')
  mkdirSync(resolve('docs/audits/2026-10-08/accounting-independent-review/evidence'), { recursive: true })
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ evidence: path, project: PROJECT, guard: report.guard, cleanup: report.cleanup, financial_rows_changed: false }))
} catch (error) {
  await db.query('rollback').catch(() => {})
  throw error
} finally {
  await db.end()
}
