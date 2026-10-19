import fs from 'node:fs'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { connectLedgerDisposableDatabase } from '../tests/helpers/ledger-disposable-connection.mjs'

const version = '20261013030000'
const path = 'supabase/migrations/' + version + '_restaurant_manual_journal_post_actor_binding.sql'
const evidence = 'docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/ledger-v4-postgresql-result.json'
const sql = fs.readFileSync(path, 'utf8')
const migrationChain = [
  { version: '20261013010000', name: 'restaurant_ledger_source_identity_gate', path: 'supabase/migrations/20261013010000_restaurant_ledger_source_identity_gate.sql' },
  { version: '20261013020000', name: 'restaurant_ledger_provenance_gate', path: 'supabase/migrations/20261013020000_restaurant_ledger_provenance_gate.sql' },
  { version, name: 'restaurant_manual_journal_post_actor_binding', path }
].map(migration => ({ ...migration, sql: fs.readFileSync(migration.path, 'utf8') }))
const sha = text => crypto.createHash('sha256').update(text).digest('hex')
if (sha(migrationChain[0].sql) !== '10a89246e8dde59330febce7615524306abea30a248e30ab3a1b489deef09a87') throw new Error('Preserved first candidate changed; stop for history review.')
if (sha(migrationChain[1].sql) !== 'f2d072fad3a862616be483ff4477e7d8b998a929a8df6666c3dfcea925e8d86a') throw new Error('Preserved second candidate changed; stop for history review.')
const report = { at: new Date().toISOString(), evidence_kind: 'guarded_postgresql_acceptance', target: 'repsrmlomedqrmrdsbga', migration: version,
  candidate_sha256: sha(sql), migration_chain: migrationChain.map(m => ({ version: m.version, file: m.path, sha256: sha(m.sql) })),
  migration_applied: false, migration_application_attempted: false, applied_migrations: [], test_started: false, mutation_performed: false }
let connection
try {
  connection = await connectLedgerDisposableDatabase()
  report.identity = connection.identity
  report.marker_verified = true
  const staffSession = String(process.env.LUNA_REMEDIATION_LEDGER_STAFF_SESSION || '').trim()
  if (!staffSession) throw new Error('LUNA_REMEDIATION_LEDGER_STAFF_SESSION is required before migration dispatch.')
  // Prove the actual capability-guarded operator wrapper works before DDL.
  // This is a read-only request under anon with the supplied genuine app
  // session; the CLI postgres role remains separate from assertion roles.
  await connection.client.query('begin read only')
  try {
    await connection.client.query('set local role anon')
    await connection.client.query("select set_config('request.jwt.claim.role','anon',true),set_config('app.session_token',$1,true)", [staffSession])
    await connection.client.query("select public.get_restaurant_financial_source_coverage($1,'2199-01-01','2199-01-02')", ['4509e4c0-a10f-406a-9918-b83664e8bbee'])
    await connection.client.query('rollback')
    report.genuine_staff_wrapper_preflight = 'passed_read_only'
  } catch (error) {
    await connection.client.query('rollback').catch(() => {})
    throw new Error('Approved genuine staff-session wrapper preflight failed (' + (error?.code || 'authorization') + '); server details suppressed.')
  }
  const versions = migrationChain.map(m => m.version)
  const history = (await connection.client.query('select version,statements from supabase_migrations.schema_migrations where version=any($1::text[]) order by version', [versions])).rows
  report.versions_before = history.map(r => r.version)
  for (const [index, migration] of migrationChain.entries()) {
    const rows = history.filter(row => row.version === migration.version)
    if (rows.length > 1 || (rows.length === 1 && (rows[0].statements?.length !== 1 || rows[0].statements[0] !== migration.sql))) {
      throw new Error('Applied migration history differs from a preserved candidate. Stop; do not overwrite migration history.')
    }
    if (!rows.length && history.some(row => migrationChain.slice(index + 1).some(later => later.version === row.version))) {
      throw new Error('Applied migration history has a gap before a later candidate. Stop for history review.')
    }
  }
  const applied = history.filter(r => r.version === version)
  if (!applied.length) {
    if (!process.argv.includes('--apply-candidate')) throw new Error('Candidate is not applied. Explicit --apply-candidate is required after marker verification.')
    const pending = migrationChain.filter(migration => !history.some(row => row.version === migration.version))
    // EXPLICITLY normalize the outer file boundaries into ONE atomic deployment
    // transaction. This is not an assumption that outer ROLLBACK undoes COMMIT.
    // Predecessor + correction + exact history commit together, in ID order.
    let statement = "begin;\nselect pg_advisory_xact_lock(hashtextextended('luna-ledger-v4-migration-chain',0));\n"
    for (const candidate of pending) {
      if ((candidate.sql.match(/^begin;\s*$/gm) || []).length !== 1 || !/commit;\s*$/.test(candidate.sql)) throw new Error('Unexpected candidate transaction boundaries.')
      const delimiter = '$ledger_migration_' + candidate.version + '$'
      if (candidate.sql.includes(delimiter)) throw new Error('Migration history delimiter conflict.')
      statement += candidate.sql.replace(/^begin;\s*$/m, '').replace(/commit;\s*$/, '')
      statement += `\ninsert into supabase_migrations.schema_migrations(version,name,statements) values ('${candidate.version}','${candidate.name}',array[${delimiter}${candidate.sql}${delimiter}]);\n`
    }
    statement += 'commit;\n'
    report.migration_application_attempted = true
    await connection.client.query(statement)
    report.migration_applied = true
    report.applied_migrations = pending.map(r => r.version)
    report.application_transaction = 'explicitly normalized file boundaries; ordered unapplied chain and history commit atomically; no business fixture rollback claim'
    report.mutation_performed = true
  } else {
    if (applied.length !== 1 || applied[0].statements?.length !== 1 || applied[0].statements[0] !== sql) throw new Error('Applied migration history differs from candidate. Stop; use a new forward migration.')
    report.previously_applied_exact_candidate = true
  }
  const historyAfter = (await connection.client.query('select version,statements from supabase_migrations.schema_migrations where version=any($1::text[]) order by version', [versions])).rows
  report.versions_after = historyAfter.map(r => r.version)
  for (const expected of [
    ...migrationChain
  ]) {
    const rows = historyAfter.filter(r => r.version === expected.version)
    if (rows.length !== 1 || rows[0].statements?.length !== 1 || rows[0].statements[0] !== expected.sql) {
      throw new Error('Post-application migration history does not exactly match all ordered candidates.')
    }
  }
  await connection.client.end()
  connection = null
  report.test_started = true
  const test = spawnSync(process.execPath, ['tests/run-restaurant-suite.mjs', '--suite=restaurant-accounting-ledger-provenance-sql.test.mjs'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: false })
  // Tests print labels/counts only, never server messages, sessions or passwords.
  fs.writeFileSync(evidence.replace('.json', '.txt'), (test.stdout || '') + (test.stderr || ''))
  report.test_exit = test.status
  const transcript = (test.stdout || '') + '\n' + (test.stderr || '')
  const readCount = (...patterns) => {
    for (const pattern of patterns) {
      const match = transcript.match(pattern)
      if (match) return Number(match[1])
    }
    return null
  }
  report.test_counts = {
    tests: readCount(/(?:ℹ\s*tests|#\s*tests)\s+(\d+)/),
    passed: readCount(/(?:ℹ\s*pass|#\s*pass)\s+(\d+)/),
    failed: readCount(/(?:ℹ\s*fail|#\s*fail)\s+(\d+)/),
    skipped: readCount(/(?:ℹ\s*skipped|#\s*skipped)\s+(\d+)/)
  }
  report.status = test.status === 0 && !test.error && !test.signal ? 'passed' : 'failed_or_blocked'
  process.exitCode = report.status === 'passed' ? 0 : 1
} catch (error) {
  report.status = 'blocked'
  report.reason = error?.name === 'DisposableDatabaseBlocked' ? error.message : 'Migration/test precondition failed; details suppressed. Inspect approved SQL prerequisites and exact history.'
  report.sqlstate = error?.code || null
  if (report.migration_application_attempted && !report.migration_applied) {
    report.status = 'unknown_migration_response'
    report.migration_applied = null
    report.mutation_performed = null
    report.reason = 'Migration dispatch outcome is uncertain; reconnect to the same verified disposable target and inspect exact original IDs/history before retry. Do not assume rollback or create replacement migration IDs.'
  }
  process.exitCode = 2
} finally {
  await connection?.client.end().catch(() => {})
  report.production_link = fs.readFileSync('supabase/.temp/project-ref', 'utf8').trim()
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
