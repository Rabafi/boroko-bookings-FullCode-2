import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import { createHarness } from './harness.mjs'
import { loadTarget, assertClusterIdentity } from '../scripts/lib/db-target.mjs'
import { loadConfig, SERVICE_ROOT } from '../dist/config.js'
import { createRecoveryBase, runPointInTimeDrill, recoveryStatus } from '../dist/operations/recovery.js'

const exec = promisify(execFile)
test('real encrypted physical base and archived WAL recover before later commit without changing live data', { timeout: 900000 }, async t => {
  const target = loadTarget()
  const h = await createHarness(t)
  await h.runtime.end(); await h.migrator.end()
  // Keep native Windows PostgreSQL paths below MAX_PATH even in a long checkout.
  const root = path.resolve(SERVICE_ROOT, '../../.tmp', `pr-${randomUUID().slice(0, 8)}`)
  const walDir = path.join(root, 'wal'), keyFile = path.join(root, 'backup.key'), walKey = path.join(root, 'wal.key')
  await mkdir(root, { recursive: true }); await mkdir(walDir)
  await writeFile(path.join(root, 'fixture-owner.json'), JSON.stringify({ source_data: target.clusterData, database: target.database }))
  await writeFile(keyFile, randomBytes(32).toString('hex')); await writeFile(walKey, randomBytes(32).toString('hex'))
  const connect = async () => { const c = new pg.Client({ host: target.host, port: target.port, database: target.database, user: 'postgres', password: process.env.BAR_LOCAL_BOOTSTRAP_PASSWORD }); await c.connect(); await assertClusterIdentity(c, target); return c }
  let admin = await connect()
  const q = value => `'${value.replaceAll("'", "''")}'`
  const command = `"${process.execPath.replaceAll('\\', '/')}" "${path.join(SERVICE_ROOT, 'scripts/wal-archive.mjs').replaceAll('\\', '/')}" archive --wal-name "%f" --source "%p" --archive-dir "${walDir.replaceAll('\\', '/')}" --key-file "${walKey.replaceAll('\\', '/')}"`
  await admin.query('ALTER SYSTEM SET archive_mode = on')
  await admin.query(`ALTER SYSTEM SET archive_command = ${q(command)}`)
  await admin.end()
  await exec(path.join(process.env.BAR_LOCAL_PG_BIN, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl'), ['-D', target.clusterData, '-l', path.join(root, 'source-postgres.log'), '-w', 'restart'], { windowsHide: true, timeout: 90000 })
  admin = await connect(); t.after(() => admin.end())
  await admin.query('CREATE TABLE public.recovery_probe (id int primary key)')
  await admin.query('INSERT INTO public.recovery_probe VALUES (1)')
  const url = new URL(`postgresql://127.0.0.1:${target.port}/${target.database}`); url.username = 'postgres'; url.password = process.env.BAR_LOCAL_BOOTSTRAP_PASSWORD ?? ''
  const config = loadConfig({ ...process.env, BAR_LOCAL_ALLOW_TEST_DB: '1', BAR_LOCAL_ADMIN_DATABASE_URL: url.href, BAR_LOCAL_PG_DATA_DIR: target.clusterData, BAR_LOCAL_BACKUP_DIR: root, BAR_LOCAL_BACKUP_KEY_FILE: keyFile, BAR_LOCAL_WAL_KEY_FILE: walKey, BAR_LOCAL_WAL_ARCHIVE_DIR: walDir, BAR_LOCAL_PHYSICAL_RECOVERY_ENABLED: '1' })
  const base = await createRecoveryBase(config)
  console.log('physical base encrypted and verified:', base.id)
  assert.equal(base.encrypted, true)
  await admin.query('INSERT INTO public.recovery_probe VALUES (2)')
  const targetTime = new Date().toISOString()
  await new Promise(resolve => setTimeout(resolve, 1100))
  await admin.query('INSERT INTO public.recovery_probe VALUES (3)')
  const switched = (await admin.query('SELECT pg_walfile_name(pg_current_wal_lsn()) AS name')).rows[0].name
  await admin.query('SELECT pg_switch_wal()')
  for (let i = 0; i < 100; i++) { if ((await readdir(walDir)).some(name => name.startsWith(switched))) break; await new Promise(resolve => setTimeout(resolve, 500)) }
  assert.ok((await readdir(walDir)).some(name => name.startsWith(switched)), 'native PostgreSQL archiver must produce encrypted WAL')
  const report = await runPointInTimeDrill(config, base.id, targetTime, async copy => {
    assert.deepEqual((await copy.query('SELECT id FROM public.recovery_probe ORDER BY id')).rows.map(row => row.id), [1, 2])
    assert.equal((await copy.query('SELECT pg_is_in_recovery() AS recovering')).rows[0].recovering, true)
  })
  assert.equal(report.verified, true); assert.equal(report.promoted, false)
  assert.deepEqual((await admin.query('SELECT id FROM public.recovery_probe ORDER BY id')).rows.map(row => row.id), [1, 2, 3])
  assert.equal((await recoveryStatus(config)).archive.enabled, true)
})
