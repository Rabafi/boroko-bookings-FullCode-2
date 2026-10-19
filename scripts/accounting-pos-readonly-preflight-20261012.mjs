import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connection, PROJECT } from '../tmp/bar-online-assessment-2026-10-07/disposable-client.mjs'

const expectedProject = 'repsrmlomedqrmrdsbga'
const expectedProduction = 'oicgpknsmtvcsjacymum'
const expectedMarker = 'LUNA-REMEDIATION-DISPOSABLE-v1'
const lodge = '4509e4c0-a10f-406a-9918-b83664e8bbee'
const product = '8a0fceab-6f01-439f-9865-b6a877d2531a'
const outlet = '7aa09f98-a0c1-4cca-a97f-3266de5871f8'
const maker = '6184abcd-d736-4ced-ac0e-064d4132ec69'
if (PROJECT !== expectedProject) throw new Error('Explicit disposable project mismatch')
const productionLink = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
if (productionLink !== expectedProduction || productionLink === PROJECT) throw new Error('Production link separation guard failed')
const connected = await connection()
const db = connected.client
try {
  if (connected.identity.database_name !== 'postgres' || connected.identity.database_user !== 'postgres') throw new Error('Fixture setup role assumption failed')
  await db.query('begin read only')
  await db.query("set local statement_timeout='30s'")
  const marker = (await db.query('select marker,project_ref,environment_kind,database_name,allow_mutation from public.luna_remediation_db_marker where singleton=true')).rows[0]
  if (marker?.marker !== expectedMarker || marker.project_ref !== expectedProject || marker.environment_kind !== 'disposable' || marker.database_name !== 'postgres' || marker.allow_mutation !== true) throw new Error('Exact disposable marker guard failed')
  const productRow = (await db.query('select id,name,category,price,is_available,stock_method,outlet_id,archived_at from public.pos_menu_items where id=$1 and lodge_id=$2',[product,lodge])).rows[0] || null
  const activeSnapshot = (await db.query("select id,outlet_id,version_number,created_at,payload_hash,payload from public.pos_catalog_snapshots where lodge_id=$1 and outlet_id=$2 and retired_at is null order by version_number desc,created_at desc limit 1",[lodge,outlet])).rows[0] || null
  const orderCount = Number((await db.query('select count(distinct o.id)::int as count from public.pos_orders o join public.pos_order_items i on i.order_id=o.id and i.lodge_id=o.lodge_id where o.lodge_id=$1 and i.menu_item_id=$2',[lodge,product])).rows[0]?.count || 0)
  const shifts = (await db.query("select to_jsonb(p) as row from public.pos_shifts p where p.lodge_id=$1 and p.outlet_id=$2 and p.status='open'",[lodge,outlet])).rows.map(({row})=>({id:row.id,cashier_id:row.cashier_id,outlet_id:row.outlet_id,status:row.status,opening_float:Number(row.opening_float),created_at:row.created_at||row.opened_at||null}))
  const staff = (await db.query('select id,has_pin,status,role from public.users_safe where lodge_id=$1 and id=$2',[lodge,maker])).rows[0] || null
  const attendance = (await db.query("select to_jsonb(s) as row from public.restaurant_shifts s where s.lodge_id=$1 and (to_jsonb(s)->>'staff_user_id'=$2 or to_jsonb(s)->>'user_id'=$2)",[lodge,maker])).rows.map(({row})=>({id:row.id||null,user_id:row.user_id||row.staff_user_id||null,status:row.status||null,clock_in_at:row.clock_in_at||row.started_at||null,clock_out_at:row.clock_out_at||row.ended_at||null,role:row.role||null}))
  const latestMigration = (await db.query('select version from supabase_migrations.schema_migrations order by version desc limit 1').catch(()=>({rows:[]}))).rows[0]?.version || null
  const report = {
    checked_at: new Date().toISOString(), project: PROJECT,
    guard: { marker_verified: true, marker: marker.marker, environment_kind: marker.environment_kind, database: marker.database_name, fixture_setup_role: connected.identity.database_user, production_link_preserved: productionLink, mutation_authorized: marker.allow_mutation, read_only_transaction: true },
    latest_migration: latestMigration,
    product: productRow,
    active_bar_snapshot: activeSnapshot ? { id:activeSnapshot.id,outlet_id:activeSnapshot.outlet_id,version_number:activeSnapshot.version_number,created_at:activeSnapshot.created_at,payload_hash:activeSnapshot.payload_hash,item_count:Array.isArray(activeSnapshot.payload?.items)?activeSnapshot.payload.items.length:null,contains_retained_product:Array.isArray(activeSnapshot.payload?.items)?activeSnapshot.payload.items.some(item=>item?.id===product):false } : null,
    target_product_order_count: orderCount, open_bar_shifts: shifts, maker: staff, maker_attendance: attendance,
    privileged_values_written_to_report: false
  }
  await db.query('rollback')
  const output = resolve('docs/audits/2026-10-08/accounting-independent-review/evidence/pos-current-inventory-20261012.json')
  mkdirSync(resolve('docs/audits/2026-10-08/accounting-independent-review/evidence'),{recursive:true})
  writeFileSync(output,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({ evidence:output, project:report.project, guard:report.guard, latest_migration:latestMigration, product:productRow, active_bar_snapshot:report.active_bar_snapshot, target_product_order_count:orderCount, open_bar_shifts:shifts, maker:staff, maker_attendance:attendance }))
} catch (error) {
  await db.query('rollback').catch(()=>{})
  throw error
} finally {
  await db.end()
}
