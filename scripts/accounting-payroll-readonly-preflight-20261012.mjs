import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connection, PROJECT } from '../tmp/bar-online-assessment-2026-10-07/disposable-client.mjs'
const expectedProject='repsrmlomedqrmrdsbga',expectedProduction='oicgpknsmtvcsjacymum',expectedMarker='LUNA-REMEDIATION-DISPOSABLE-v1'
const lodge='4509e4c0-a10f-406a-9918-b83664e8bbee',maker='6184abcd-d736-4ced-ac0e-064d4132ec69'
if(PROJECT!==expectedProject)throw new Error('Explicit disposable project mismatch')
const productionLink=readFileSync('supabase/.temp/project-ref','utf8').trim()
if(productionLink!==expectedProduction||productionLink===PROJECT)throw new Error('Production link separation guard failed')
const connected=await connection(),db=connected.client
try{
 if(connected.identity.database_name!=='postgres'||connected.identity.database_user!=='postgres')throw new Error('Fixture setup role assumption failed')
 await db.query('begin read only');await db.query("set local statement_timeout='12s'");await db.query("set local lock_timeout='5s'")
 const marker=(await db.query('select marker,project_ref,environment_kind,database_name,allow_mutation from public.luna_remediation_db_marker where singleton=true')).rows[0]
 if(marker?.marker!==expectedMarker||marker.project_ref!==expectedProject||marker.environment_kind!=='disposable'||marker.database_name!=='postgres'||marker.allow_mutation!==true)throw new Error('Exact disposable marker guard failed')
 const inventorySql=`select
 (select count(*)::int from public.restaurant_pay_periods where lodge_id=$1) period_count,
 (select coalesce(jsonb_object_agg(value,count),'{}'::jsonb) from (select status as value,count(*)::int as count from public.restaurant_pay_periods where lodge_id=$1 group by status) q) period_statuses,
 (select count(*)::int from public.restaurant_payroll_employment_terms where lodge_id=$1) employment_terms,
 (select coalesce(jsonb_agg(jsonb_build_object('approval_status',approval_status,'count',count,'with_source',with_source,'with_independent_approver',with_independent_approver) order by approval_status),'[]'::jsonb) from (select approval_status,count(*)::int count,count(*) filter(where source_document_id is not null)::int with_source,count(*) filter(where policy_approved_by is not null)::int with_independent_approver from public.restaurant_payroll_statutory_configurations where lodge_id=$1 group by approval_status) q) statutory_configurations,
 (select jsonb_build_object('total',count(*)::int,'statutory_sources',count(*) filter(where document_kind='statutory_rule')::int,'independently_verified_statutory_sources',count(*) filter(where document_kind='statutory_rule' and independently_verified_at is not null)::int) from public.restaurant_payroll_source_documents where lodge_id=$1) source_documents,
 (select count(*)::int from public.restaurant_payroll_gl_settings where lodge_id=$1) gl_settings,
 (select jsonb_build_object('total',count(*)::int,'approved',count(*) filter(where approved_at is not null)::int,'pending',count(*) filter(where approved_at is null)::int) from public.restaurant_payroll_time_inputs where lodge_id=$1) time_inputs,
 (select count(*)::int from public.restaurant_payroll_attendance_reconciliations where lodge_id=$1) attendance_reconciliations,
 (select count(*)::int from public.restaurant_payroll_expected_workers where lodge_id=$1) expected_worker_rows,
 (select count(*)::int from public.restaurant_employee_pay_records where lodge_id=$1) pay_records,
 (select count(*)::int from public.restaurant_payroll_payment_batches where lodge_id=$1) payment_batches,
 (select count(*)::int from public.restaurant_payroll_payment_exports where lodge_id=$1) payment_exports,
 (select count(*)::int from public.restaurant_payroll_raw_export_audit where lodge_id=$1) raw_export_audits,
 (select jsonb_build_object('rows',count(*)::int,'active',count(*) filter(where to_jsonb(s)->>'status'='active')::int) from public.restaurant_shifts s where s.lodge_id=$1 and coalesce(to_jsonb(s)->>'staff_user_id',to_jsonb(s)->>'user_id')=$2) retained_maker_attendance`
 const inventory=(await db.query(inventorySql,[lodge,maker])).rows[0]
 const latest=(await db.query('select version from supabase_migrations.schema_migrations order by version desc limit 1')).rows[0]?.version||null
 await db.query('rollback')
 const report={checked_at:new Date().toISOString(),project:PROJECT,guard:{marker_verified:true,marker:marker.marker,environment_kind:marker.environment_kind,database:marker.database_name,fixture_setup_role:connected.identity.database_user,production_link_preserved:productionLink,mutation_authorized:marker.allow_mutation,read_only_transaction:true},latest_migration:latest,payroll:inventory,retained_pos_maker_attendance:{user_id:maker,...inventory.retained_maker_attendance,modified:false},pii_included:false,privileged_values_written_to_report:false}
 const output=resolve('docs/audits/2026-10-08/accounting-independent-review/evidence/payroll-readonly-preflight-20261012.json')
 mkdirSync(resolve('docs/audits/2026-10-08/accounting-independent-review/evidence'),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({evidence:output,project:report.project,guard:report.guard,latest_migration:latest,payroll:report.payroll,retained_pos_maker_attendance:report.retained_pos_maker_attendance,pii_included:false}))
}catch(error){await db.query('rollback').catch(()=>{});throw error}finally{await db.end()}