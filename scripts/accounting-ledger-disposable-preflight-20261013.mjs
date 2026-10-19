import fs from 'node:fs'
import { DisposableDatabaseBlocked } from '../tests/helpers/luna-disposable-database.mjs'
import { connectLedgerDisposableDatabase } from '../tests/helpers/ledger-disposable-connection.mjs'

const target = 'repsrmlomedqrmrdsbga'
const output = 'docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/ledger-sql-preflight.json'
const report = { checked_at: new Date().toISOString(), target, evidence_kind: 'read_only_sql_connection_preflight', mutation_performed: false, production_link: fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim() }
let connection
try {
  const required = ['LUNA_REMEDIATION_TEST_DB_URL', 'LUNA_REMEDIATION_TARGET_MARKER', 'LUNA_REMEDIATION_EXPECTED_DATABASE', 'LUNA_REMEDIATION_EXPECTED_PROJECT_REF', 'LUNA_REMEDIATION_LEDGER_STAFF_SESSION']
  report.missing_settings = required.filter(name => !process.env[name])
  if (report.missing_settings.length) throw new DisposableDatabaseBlocked('Approved disposable SQL connection settings are missing.')
  if (process.env.LUNA_REMEDIATION_EXPECTED_PROJECT_REF !== target || process.env.LUNA_REMEDIATION_EXPECTED_DATABASE !== 'postgres') throw new DisposableDatabaseBlocked('Only the approved disposable project and postgres database are permitted.')
  const parsed = new URL(process.env.LUNA_REMEDIATION_TEST_DB_URL)
  if (!parsed.hostname.endsWith('.supabase.co') && !parsed.hostname.endsWith('.supabase.com')) throw new DisposableDatabaseBlocked('Localhost and non-Supabase connection targets are prohibited.')
  if (!parsed.hostname.includes(target) && !decodeURIComponent(parsed.username).includes(target)) throw new DisposableDatabaseBlocked('SQL connection host/user does not identify the approved project.')
  connection = await connectLedgerDisposableDatabase()
  await connection.client.query('begin read only')
  try {
    await connection.client.query('set local role anon')
    await connection.client.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token',$1,true)", [process.env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION])
    await connection.client.query("select public.get_restaurant_financial_source_coverage($1,'2199-01-01','2199-01-02')", ['4509e4c0-a10f-406a-9918-b83664e8bbee'])
    await connection.client.query('rollback')
    report.genuine_staff_wrapper = 'passed_read_only_as_anon'
  } catch {
    await connection.client.query('rollback').catch(() => {})
    throw new DisposableDatabaseBlocked('Genuine staff-session accounting.read wrapper preflight failed; server details suppressed.')
  }
  const history = await connection.client.query("select version from supabase_migrations.schema_migrations where version in ('20261013010000','20261013020000','20261013030000') order by version")
  report.status = 'verified'
  report.identity = connection.identity
  report.marker = { marker: 'LUNA-REMEDIATION-DISPOSABLE-v1', environment_kind: 'disposable', database_name: 'postgres', allow_mutation: true }
  report.candidate_versions_applied = history.rows.map(row => row.version)
  console.log(JSON.stringify({ status: report.status, target, candidate_versions_applied: report.candidate_versions_applied }))
} catch (error) {
  report.status = 'blocked'
  report.reason = error instanceof DisposableDatabaseBlocked ? error.message : 'SQL identity preflight failed; server details suppressed.'
  report.error_code = error?.code || null
  console.log(JSON.stringify({ status: report.status, reason: report.reason, missing_settings: report.missing_settings }))
  process.exitCode = 2
} finally {
  await connection?.client.end()
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
}
